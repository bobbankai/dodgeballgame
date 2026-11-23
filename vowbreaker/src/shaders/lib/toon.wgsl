// ============================================================================================
// vb_toon: the pieces that make the look "anime" rather than "lit 3D":
//   * per-vertex face-shadow thresholds (the Genshin-style face shadow, baked in Blender)
//   * material ids packed in vertex colour alpha
//   * hatching, halftone dots, manga screen tones, paper grain
//   * colour line (outline) colour from the base colour (Guilty Gear's coloured lines)
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math.
// ============================================================================================

// material ids (vertex colour alpha * 8, rounded)
const MAT_CLOTH: i32 = 0;
const MAT_SKIN: i32 = 1;
const MAT_HAIR: i32 = 2;
const MAT_EYE: i32 = 3;
const MAT_METAL: i32 = 4;
const MAT_FACE: i32 = 5;
const MAT_EMISSIVE: i32 = 6;
const MAT_PAPER: i32 = 7;

fn decodeMaterialId(a: f32) -> i32 {
    return i32(round(clamp(a, 0.0, 1.0) * 8.0));
}

// --- face shadow -----------------------------------------------------------------------------------
// thrL / thrR: the light "frontness" above which this point of the face is lit, for a light on the
// character's left / right (baked per vertex in Blender so the nose and cheeks cast clean shapes).
// lightHead: the light direction in head space (x = character's left, y = up, z = forward).
fn faceShadow(thrL: f32, thrR: f32, lightHead: vec3f, softness: f32) -> f32 {
    let flat = normalize(vec3f(lightHead.x, 0.0, lightHead.z) + vec3f(0.0, 0.0, 1e-4));
    // frontness: 1 with the light straight ahead, 0 from the side, below 0 from behind
    let front = flat.z;
    let thr = select(thrR, thrL, flat.x >= 0.0);
    // map frontness -1..1 onto the threshold's 0..1 scale (light from behind darkens everything)
    let f = front * 0.5 + 0.5;
    // overhead or under-lighting flattens the effect toward fully lit / fully dark
    let vertical = abs(lightHead.y);
    let lit = smoothstep(thr - softness, thr + softness, f);
    return mix(lit, step(0.0, lightHead.y) * 0.85, smoothstep(0.85, 0.98, vertical));
}

// --- coloured lines ------------------------------------------------------------------------------------

// line colour derived from the surface colour: darker, more saturated, hue nudged toward red,
// so lines read as drawn ink that belongs to each colour (not a flat black)
fn inkLineColor(base: vec3f, darkness: f32, warmth: f32) -> vec3f {
    let hsv = rgbToHsv(max(base, vec3f(0.0)));
    let h = fract(hsv.x - warmth * 0.03);
    let s = clamp(hsv.y * 1.35 + 0.12, 0.0, 1.0);
    let v = hsv.z * (1.0 - darkness);
    return hsvToRgb(vec3f(h, s, v));
}

// --- hatching ----------------------------------------------------------------------------------------------

// one set of parallel pencil strokes in 2D space p, direction angle a, spacing in p units,
// stroke `weight` 0..1; strokes wobble and break like hand-drawn graphite
fn hatchLines(p: vec2f, a: f32, spacing: f32, weight: f32, seed: f32) -> f32 {
    let q = rotate2(p, a) / spacing;
    let row = floor(q.y);
    let jitter = (hash11(row + seed) - 0.5) * 0.35;
    let wob = valueNoise2(vec2f(q.x * 0.35, row * 1.7 + seed)) * 0.25;
    let d = abs(fract(q.y + jitter + wob) - 0.5);
    let breakup = smoothstep(0.25, 0.55, valueNoise2(vec2f(q.x * 0.12 + seed, row * 3.1)));
    let w = weight * 0.5 * mix(0.45, 1.0, breakup);
    return 1.0 - smoothstep(w * 0.5, w * 0.5 + 0.08, d);
}

// tonal art map: darkness 0..1 -> 0..3 layers of crossing hatches
fn hatchTone(p: vec2f, darkness: f32, spacing: f32, seed: f32) -> f32 {
    let l1 = hatchLines(p, 0.785, spacing, smoothstep(0.08, 0.4, darkness), seed);
    let l2 = hatchLines(p, -0.62, spacing * 1.05, smoothstep(0.4, 0.7, darkness), seed + 3.0);
    let l3 = hatchLines(p, 1.57, spacing * 0.8, smoothstep(0.7, 0.95, darkness), seed + 7.0);
    return max(max(l1, l2), l3);
}

// world-space hatching projected triplanar so it sticks to the surface
fn hatchTriplanar(worldPos: vec3f, n: vec3f, darkness: f32, spacing: f32) -> f32 {
    let w = pow(abs(n), vec3f(4.0));
    let ws = w / (w.x + w.y + w.z);
    let hx = hatchTone(worldPos.zy, darkness, spacing, 1.0);
    let hy = hatchTone(worldPos.xz, darkness, spacing, 2.0);
    let hz = hatchTone(worldPos.xy, darkness, spacing, 3.0);
    return hx * ws.x + hy * ws.y + hz * ws.z;
}

// --- halftone and screen tones ---------------------------------------------------------------------------------

// round dots on a rotated grid; `amount` 0..1 sets dot area (comic-book shading)
fn halftoneDots(px: vec2f, cellPx: f32, angle: f32, amount: f32) -> f32 {
    let q = rotate2(px, angle) / cellPx;
    let c = fract(q) - 0.5;
    let r = sqrt(clamp(amount, 0.0, 1.0)) * 0.62;
    let d = length(c);
    let aa = 1.2 / cellPx;
    return 1.0 - smoothstep(r - aa, r + aa, d);
}

// line screen (manga "tone" of parallel lines)
fn halftoneLines(px: vec2f, cellPx: f32, angle: f32, amount: f32) -> f32 {
    let q = rotate2(px, angle) / cellPx;
    let d = abs(fract(q.y) - 0.5);
    let w = clamp(amount, 0.0, 1.0) * 0.5;
    let aa = 1.2 / cellPx;
    return 1.0 - smoothstep(w - aa, w + aa, d);
}

// CMYK-style halftone of a colour (pop-art impact frames)
fn halftoneCmyk(px: vec2f, col: vec3f, cellPx: f32) -> vec3f {
    let k = 1.0 - maxc3(col);
    let cyan = (1.0 - col.r - k) / max(1.0 - k, 1e-3);
    let mag = (1.0 - col.g - k) / max(1.0 - k, 1e-3);
    let yel = (1.0 - col.b - k) / max(1.0 - k, 1e-3);
    let dc = halftoneDots(px, cellPx, 0.261799, cyan);
    let dm = halftoneDots(px, cellPx, 1.309, mag);
    let dy = halftoneDots(px, cellPx, 0.0, yel);
    let dk = halftoneDots(px, cellPx, 0.785398, k);
    var c = vec3f(1.0);
    c = c * (1.0 - dc * vec3f(1.0, 0.0, 0.0));
    c = c * (1.0 - dm * vec3f(0.0, 1.0, 0.0));
    c = c * (1.0 - dy * vec3f(0.0, 0.0, 1.0));
    return c * (1.0 - dk);
}

// gradient screen tone: dots that grow across a gradient value (manga skies and backgrounds)
fn screenTone(px: vec2f, value: f32, cellPx: f32) -> f32 {
    return halftoneDots(px, cellPx, 0.785398, 1.0 - clamp(value, 0.0, 1.0));
}

// --- paper ---------------------------------------------------------------------------------------------------------

// washi-like paper: fibres, slight mottling and a tooth that catches dry brush
fn paperGrain(p: vec2f) -> f32 {
    let fibres = fiberNoise(p * 2.0, vec2f(0.8, 0.6), 6.0) * 0.5 + fiberNoise(p * 3.1, vec2f(-0.3, 0.95), 5.0) * 0.5;
    let mottle = vfbm2(p * 0.6, 3);
    let tooth = valueNoise2(p * 40.0);
    return clamp(0.55 + (fibres - 0.5) * 0.35 + (mottle - 0.5) * 0.25 + (tooth - 0.5) * 0.12, 0.0, 1.0);
}

// how strongly a dry wash catches on the paper (for watercolour edges in flashbacks)
fn paperTooth(p: vec2f, wetness: f32) -> f32 {
    return smoothstep(0.35 - wetness * 0.3, 0.75, paperGrain(p));
}

// --- toon helpers ---------------------------------------------------------------------------------------------------

// two-tone with a crisp, slightly painterly edge broken by a screen-space noise
fn paintedStep(x: f32, threshold: f32, softness: f32, noise: f32, roughness: f32) -> f32 {
    return smoothstep(threshold - softness, threshold + softness, x + (noise - 0.5) * roughness);
}

// specular "shape" for anime eyes: two catch lights in view space, independent of lighting
fn eyeCatchLights(viewNormal: vec3f) -> f32 {
    let a = 1.0 - smoothstep(0.08, 0.11, length(viewNormal.xy - vec2f(-0.28, 0.33)));
    let b = 1.0 - smoothstep(0.035, 0.05, length(viewNormal.xy - vec2f(0.24, -0.22)));
    return max(a, b * 0.8);
}

// stepped time: hold values on 2s/3s like limited animation (fps e.g. 12)
fn steppedTime(t: f32, fps: f32) -> f32 {
    return floor(t * fps) / fps;
}

// a boil: tiny per-step offset that makes static lines feel hand drawn
fn boilOffset(p: vec2f, t: f32, fps: f32, amp: f32) -> vec2f {
    let s = floor(t * fps);
    return (vec2f(valueNoise2(p * 0.7 + s * 3.17), valueNoise2(p * 0.7 + s * 5.31 + 9.0)) - 0.5) * amp;
}
