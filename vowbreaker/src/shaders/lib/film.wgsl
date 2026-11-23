// ============================================================================================
// vb_film: the texture of the image. Grain that lives in the mids (per channel, a little
// clumped, re-rolled every frame), halation (red light bleeding round hard highlights on film),
// a gate weave and exposure flicker for memories shot on an old camera, light leaks drifting
// across the frame, dust and hairs, the paper a painting is on (fibres, tooth, a wash pooling at
// the edges), and cel layers (the faint line where a painted background meets a cel).
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math.
// ============================================================================================

// grain: per-channel, strongest in the mid tones, clumped by a little low-frequency noise
fn filmGrain(c: vec3f, pixel: vec2f, frame: f32, amount: f32, size: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let p = pixel / max(size, 1.0);
    let r = hash12(floor(p) + vec2f(frame * 1.37, 0.0)) - 0.5;
    let g = hash12(floor(p) + vec2f(frame * 2.11, 17.0)) - 0.5;
    let b = hash12(floor(p) + vec2f(frame * 3.07, 41.0)) - 0.5;
    let clump = valueNoise2(p * 0.35 + vec2f(frame * 0.7)) * 0.6 + 0.4;
    let l = luma(c);
    let mids = 4.0 * l * (1.0 - l);
    let n = vec3f(r, g * 0.9 + r * 0.1, b * 0.8 + r * 0.2) * clump;
    return max(c + n * amount * (0.35 + 0.65 * mids), vec3f(0.0));
}

// halation: highlights bleed a red-orange glow into their surroundings (from a blurred source)
fn filmHalation(c: vec3f, blurred: vec3f, threshold: f32, amount: f32) -> vec3f {
    let hot = max(blurred - vec3f(threshold), vec3f(0.0));
    let glow = vec3f(hot.r * 1.0 + hot.g * 0.25, hot.r * 0.18 + hot.g * 0.08, hot.r * 0.04) * amount;
    return c + glow;
}

// gate weave: the frame drifts by a pixel or two, jumping at frame boundaries
fn filmWeave(uv: vec2f, time: f32, fps: f32, amount: f32) -> vec2f {
    let f = floor(time * fps);
    let jx = (hash11(f * 1.7) - 0.5) * 0.0025 * amount;
    let jy = (hash11(f * 2.9 + 3.0) - 0.5) * 0.0035 * amount;
    let drift = vec2f(sin(time * 0.7), cos(time * 0.5)) * 0.001 * amount;
    return uv + vec2f(jx, jy) + drift;
}

// exposure flicker from an old shutter
fn filmFlicker(time: f32, fps: f32, amount: f32) -> f32 {
    let f = floor(time * fps);
    return 1.0 + (hash11(f * 5.3) - 0.5) * 0.14 * amount + sin(time * 13.0) * 0.015 * amount;
}

// a light leak: a warm orange-red wash drifting in from one edge
fn filmLightLeak(uv: vec2f, time: f32, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return vec3f(0.0);
    }
    let edge = 1.0 - smoothstep(0.0, 0.55, uv.x + sin(time * 0.3) * 0.08 + fbm2(uv * 2.0 + vec2f(time * 0.05, 0.0), 3, 2.0, 0.5) * 0.2);
    let top = 1.0 - smoothstep(0.2, 1.0, uv.y);
    let col = mix(vec3f(1.0, 0.35, 0.1), vec3f(1.0, 0.75, 0.3), uv.y);
    return col * edge * (0.5 + 0.5 * top) * amount * 0.6;
}

// dust specks and hairs on the frame (dark on positive film)
fn filmDust(uv: vec2f, time: f32, fps: f32, amount: f32) -> f32 {
    if (amount <= 0.0) {
        return 0.0;
    }
    let f = floor(time * fps);
    var acc = 0.0;
    for (var i = 0; i < 4; i++) {
        let h = hash31(f * 7.0 + f32(i) * 31.0);
        if (h.z > 0.55) {
            let p = h.xy;
            let r = 0.002 + h.z * 0.004;
            acc = max(acc, 1.0 - smoothstep(r * 0.5, r, length(uv - p)));
        }
    }
    // a hair: a thin curved line, present for a few frames at a time
    let hh = hash31(floor(time * 2.0) * 13.0);
    if (hh.x > 0.75) {
        let q = uv - hh.yz;
        let curve = q.y - sin(q.x * 30.0 + hh.x * 6.0) * 0.01;
        let hair = (1.0 - smoothstep(0.0, 0.0012, abs(curve))) * step(abs(q.x), 0.06);
        acc = max(acc, hair);
    }
    return acc * amount;
}

// vertical scratches running through the frame
fn filmScratches(uv: vec2f, time: f32, amount: f32) -> f32 {
    if (amount <= 0.0) {
        return 0.0;
    }
    let f = floor(time * 6.0);
    var acc = 0.0;
    for (var i = 0; i < 2; i++) {
        let h = hash21(f + f32(i) * 19.0);
        if (h.y > 0.6) {
            let x = h.x + sin(uv.y * 5.0 + f) * 0.003;
            acc = max(acc, (1.0 - smoothstep(0.0, 0.0009, abs(uv.x - x))) * (0.5 + 0.5 * valueNoise2(vec2f(uv.y * 40.0, f))));
        }
    }
    return acc * amount;
}

// --- paper -------------------------------------------------------------------------------------

// the paper a painting sits on: fibres, tooth, slight colour variation
fn paperTexture(pixel: vec2f, scale: f32) -> f32 {
    let p = pixel * scale;
    let tooth = valueNoise2(p * 0.5) * 0.5 + valueNoise2(p * 1.3) * 0.3 + valueNoise2(p * 3.1) * 0.2;
    let fibres = fiberNoise(p * 0.08, normalize(vec2f(0.8, 0.3)), 8.0) * 0.5 + fiberNoise(p * 0.11 + 7.0, normalize(vec2f(-0.4, 0.9)), 6.0) * 0.3;
    return clamp(tooth * 0.7 + fibres * 0.3, 0.0, 1.0);
}

// a watercolour wash pooling darker at the edges of colour regions (from a local gradient)
fn paperPooling(c: vec3f, gradient: f32, paper: f32, amount: f32) -> vec3f {
    let pool = smoothstep(0.02, 0.15, gradient) * amount;
    let granule = (paper - 0.5) * 0.2 * amount;
    return c * (1.0 - pool * 0.35) * (1.0 - granule);
}

// multiply the image onto paper: whites become the paper colour, darks keep their colour
fn paperMultiply(c: vec3f, paper: f32, paperCol: vec3f, amount: f32) -> vec3f {
    let surface = paperCol * (0.92 + paper * 0.1);
    return mix(c, c * surface, amount);
}

// the edge of a cel over a painted background: a faint light line inside characters' silhouettes
fn celLayerEdge(c: vec3f, edge: f32, amount: f32) -> vec3f {
    return c + vec3f(edge * amount * 0.08);
}

// a slow vertical "camera pan over a painted background" parallax shimmer for memory stills
fn filmPaintedPan(uv: vec2f, time: f32, amount: f32) -> vec2f {
    return uv + vec2f(time * 0.004, 0.0) * amount;
}
