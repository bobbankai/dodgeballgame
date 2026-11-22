// ============================================================================================
// vb_lens: the camera as an object. Ghosts and a halo from bright sources (pseudo lens flare,
// sampled from a blurred bloom mip mirrored through the centre), a chromatic dispersion of the
// ghosts, a starburst from the aperture blades, anamorphic streaks, lens dirt that lights up when
// a bright source is near, raindrops sitting and running on the lens (refracting what is behind
// them), and frost creeping in from the edges.
// Depends on vb_common, vb_hash, vb_noise, vb_math.
// ============================================================================================

// pseudo lens flare (Chapman): ghosts along the line through the centre, plus a halo ring
fn lensGhosts(t: texture_2d<f32>, s: sampler, uv: vec2f, count: i32, spacing: f32, threshold: f32, dispersal: f32) -> vec3f {
    let flipped = vec2f(1.0) - uv;
    let ghostVec = (vec2f(0.5) - flipped) * spacing;
    var acc = vec3f(0.0);
    for (var i = 0; i < count; i++) {
        let off = fract(flipped + ghostVec * f32(i));
        let w = pow(1.0 - length(vec2f(0.5) - off) / 0.7071, 10.0);
        let dir = normalize(ghostVec + vec2f(1e-5));
        let r = textureSampleLevel(t, s, off + dir * dispersal, 0.0).r;
        let g = textureSampleLevel(t, s, off, 0.0).g;
        let b = textureSampleLevel(t, s, off - dir * dispersal, 0.0).b;
        acc = acc + max(vec3f(r, g, b) - threshold, vec3f(0.0)) * w;
    }
    return acc;
}

fn lensHalo(t: texture_2d<f32>, s: sampler, uv: vec2f, width: f32, threshold: f32, aspect: f32) -> vec3f {
    let flipped = vec2f(1.0) - uv;
    var dir = vec2f(0.5) - flipped;
    dir = normalize(vec2f(dir.x * aspect, dir.y) + vec2f(1e-5));
    dir.x = dir.x / aspect;
    let off = flipped + dir * width;
    let w = pow(1.0 - length(vec2f(0.5) - fract(off)) / 0.7071, 5.0);
    return max(textureSampleLevel(t, s, off, 0.0).rgb - threshold, vec3f(0.0)) * w;
}

// a tint ramp across the ghosts (real flares are coloured by the lens coatings)
fn lensGhostTint(uv: vec2f) -> vec3f {
    let d = length(uv - 0.5) * 2.0;
    return mix(vec3f(1.0, 0.7, 0.45), vec3f(0.45, 0.7, 1.0), smoothstep(0.0, 1.0, d));
}

// the aperture's starburst around a bright point in screen space
fn lensStarburst(uv: vec2f, center: vec2f, aspect: f32, blades: f32, rotation: f32) -> f32 {
    let d = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let r = length(d);
    let a = atan2(d.y, d.x) + rotation;
    let spikes = pow(abs(cos(a * blades * 0.5)), 40.0);
    let fine = pow(abs(cos(a * blades * 2.0 + 0.4)), 120.0) * 0.4;
    return (spikes + fine) * exp(-r * 6.0) + exp(-r * 30.0);
}

// anamorphic streak: a long horizontal smear of bright pixels (sampled along x)
fn lensAnamorphic(t: texture_2d<f32>, s: sampler, uv: vec2f, texelX: f32, length_: f32, threshold: f32) -> vec3f {
    var acc = vec3f(0.0);
    var wsum = 0.0;
    for (var i = -8; i <= 8; i++) {
        let fi = f32(i);
        let w = exp(-abs(fi) / 3.0);
        let c = textureSampleLevel(t, s, uv + vec2f(fi * texelX * length_, 0.0), 0.0).rgb;
        acc = acc + max(c - threshold, vec3f(0.0)) * w;
        wsum = wsum + w;
    }
    return acc / wsum * vec3f(0.6, 0.75, 1.0);
}

// procedural lens dirt: smudges and specks, lit by nearby brightness
fn lensDirt(uv: vec2f, aspect: f32) -> f32 {
    let p = vec2f(uv.x * aspect, uv.y);
    let smudge = smoothstep(0.55, 0.85, fbm2(p * 3.0 + 4.1, 4, 2.0, 0.5) * 0.5 + 0.5) * 0.6;
    let c = worley2(p * 14.0, 1.0);
    let specks = (1.0 - smoothstep(0.02, 0.06, c.f1)) * step(0.7, c.id.x) * 0.8;
    let ring = (1.0 - smoothstep(0.0, 0.02, abs(c.f1 - 0.1))) * step(0.92, c.id.y) * 0.5;
    return smudge + specks + ring;
}

// barrel distortion with a per-channel offset (cheap chromatic aberration at the edges)
fn lensDistortUV(uv: vec2f, k: f32, channel: f32) -> vec2f {
    let d = uv - 0.5;
    let r2 = dot(d, d);
    return 0.5 + d * (1.0 + (k + channel * 0.01) * r2);
}

// natural vignette: cos^4 falloff, aspect-corrected
fn lensNaturalVignette(uv: vec2f, aspect: f32, strength: f32) -> f32 {
    let d = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
    let c = 1.0 / sqrt(1.0 + dot(d, d) * strength * 2.0);
    return c * c * c * c;
}

// --- rain on the lens ------------------------------------------------------------------------------------

// static drops sitting on the glass: returns (refraction offset xy, drop mask, highlight)
fn lensRainStatic(uv: vec2f, aspect: f32, time: f32, amount: f32) -> vec4f {
    let p = vec2f(uv.x * aspect, uv.y) * 7.0;
    let cell = floor(p);
    let h = hash22(cell);
    let center = cell + 0.2 + h * 0.6;
    let born = fract(h.x * 13.0 + time * 0.05);
    let rad = (0.05 + h.y * 0.12) * smoothstep(0.0, 0.1, born) * step(1.0 - amount * 0.7, h.y);
    let d = p - center;
    let r = length(d);
    let mask = 1.0 - smoothstep(rad * 0.85, rad, r);
    let n = d / max(rad, 1e-4);
    // a small specular glint up-left, a dark meniscus round the rim (the drop reads as water, not snow)
    let hi = smoothstep(0.22, 0.0, length(n - vec2f(-0.38, 0.4))) * mask;
    let rim = smoothstep(0.55, 0.95, r / max(rad, 1e-4)) * mask;
    return vec4f(-n * mask * 0.012, mask, hi * 0.8 - rim * 0.12);
}

// drops running down the glass in tracks, leaving small beads behind
fn lensRainRunning(uv: vec2f, aspect: f32, time: f32, amount: f32) -> vec4f {
    let p = vec2f(uv.x * aspect * 4.0, uv.y);
    let col = floor(p.x);
    let h = hash21(col);
    if (h.x > amount) {
        return vec4f(0.0);
    }
    let x = fract(p.x) - 0.5 + sin(uv.y * 30.0 + h.y * 10.0) * 0.08;
    let speed = 0.15 + h.y * 0.25;
    let headY = 1.0 - fract(time * speed + h.x * 7.0) * 1.3;
    let dy = (uv.y - headY) * 8.0;
    let head = (1.0 - smoothstep(0.05, 0.12, length(vec2f(x, dy * 0.2))));
    let trail = (1.0 - smoothstep(0.02, 0.05, abs(x))) * step(headY, uv.y) * (1.0 - smoothstep(0.0, 0.4, uv.y - headY)) * 0.4;
    let mask = max(head, trail);
    let glint = (1.0 - smoothstep(0.0, 0.035, length(vec2f(x + 0.03, dy * 0.2 + 0.03)))) * head;
    let rim = smoothstep(0.06, 0.11, length(vec2f(x, dy * 0.2))) * head + smoothstep(0.025, 0.045, abs(x)) * trail;
    return vec4f(vec2f(-x, 0.2) * mask * 0.03, mask, glint * 0.6 - rim * 0.1);
}

// frost on the lens from the edges inward (the estate's winter morning, Stillwater's frozen time)
fn lensFrost(uv: vec2f, aspect: f32, amount: f32) -> vec2f {
    let d = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
    let edge = smoothstep(0.35, 0.9, length(d) + (fbm2(uv * 9.0, 4, 2.0, 0.5) * 0.15));
    let crystals = crackle2(uv * vec2f(aspect, 1.0) * 40.0, 0.06);
    let mask = clamp(edge * amount * 1.4, 0.0, 1.0);
    return vec2f(mask, crystals * mask);
}
