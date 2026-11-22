// ============================================================================================
// vb_clouds: anime skies are mostly clouds. Three kinds, all stylised:
//   cumulus   raymarched through a slab of sky: a few Perlin-Worley steps for the shape, light
//             gathered with a short march toward the sun, then quantised into three painted
//             tones (lit face, mid, shadowed belly) with a bright silver lining on the rim
//   layered   flat painted cloud banks at the horizon (sunset streaks, the city haze)
//   cirrus    thin high wisps stretched by the wind
// plus god-ray "fingers" through gaps and the cloud colour of each time of day.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_noise2.
// ============================================================================================

struct CloudParams {
    cover: f32,        // 0..1 how much of the sky
    base: f32,         // slab bottom, in units of the sky dome (about 1 = horizon distance)
    thickness: f32,
    windDir: vec2f,
    time: f32,
    litColor: vec3f,
    midColor: vec3f,
    shadowColor: vec3f,
    rimColor: vec3f,
    sunDir: vec3f,
    bands: f32,        // 0 = smooth, 3 = three painted tones
}

fn cloudDefault(lit: vec3f, shadow: vec3f, sun: vec3f, cover: f32, time: f32) -> CloudParams {
    let mid = mix(shadow, lit, 0.55);
    return CloudParams(cover, 1.2, 0.9, vec2f(1.0, 0.35), time, lit, mid, shadow, mix(lit, vec3f(1.0), 0.6), sun, 3.0);
}

// cloud density at a point in the slab (p in sky units)
fn cloudDensity(p: vec3f, c: CloudParams) -> f32 {
    let drift = vec3f(c.windDir.x, 0.0, c.windDir.y) * c.time * 0.012;
    let q = p * 0.9 + drift;
    let h = clamp((p.y - c.base) / c.thickness, 0.0, 1.0);
    // a flat bottom and a billowing top
    let profile = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.55, 1.0, h));
    // billow shape from cheap value-noise fbm, eroded by one worley layer (cells read as puffs)
    let shape = vfbm3(q * 1.3, 3);
    let cells = 1.0 - clamp(worley3(q * 3.2, 1.0).x, 0.0, 1.0);
    var d = remap(shape * 0.75 + cells * 0.35, 1.0 - c.cover, 1.1, 0.0, 1.0);
    d = d - (1.0 - cells) * 0.2 * (1.0 - h);
    return clamp(d * profile, 0.0, 1.0);
}

// light reaching a point inside the cloud: a short march toward the sun (Beer-powder)
fn cloudLight(p: vec3f, c: CloudParams) -> f32 {
    var acc = 0.0;
    let stepLen = c.thickness * 0.12;
    for (var i = 1; i <= 2; i++) {
        acc = acc + cloudDensity(p + c.sunDir * stepLen * f32(i) * 1.6, c) * 1.6;
    }
    let beer = exp(-acc * 1.6);
    let powder = 1.0 - exp(-acc * 3.0);
    return beer * mix(1.0, powder, 0.5);
}

// painted tones: quantise the light into lit / mid / shadow with soft but definite edges
fn cloudTone(light: f32, c: CloudParams) -> vec3f {
    if (c.bands <= 0.0) {
        return mix(c.shadowColor, c.litColor, light);
    }
    let a = smoothstep(0.28, 0.34, light);
    let b = smoothstep(0.62, 0.68, light);
    return mix(mix(c.shadowColor, c.midColor, a), c.litColor, b);
}

// march the slab along a view direction from the dome centre; returns colour and alpha
fn cloudsCumulus(d: vec3f, c: CloudParams) -> vec4f {
    if (d.y <= 0.02 || c.cover <= 0.0) {
        return vec4f(0.0);
    }
    let t0 = c.base / d.y;
    let t1 = (c.base + c.thickness) / d.y;
    let steps = 10;
    let dt = (t1 - t0) / f32(steps);
    var col = vec3f(0.0);
    var alpha = 0.0;
    var t = t0 + dt * 0.5;
    for (var i = 0; i < steps; i++) {
        let p = d * t;
        let den = cloudDensity(p, c);
        if (den > 0.01) {
            let light = cloudLight(p, c);
            var tone = cloudTone(light, c);
            // silver lining where thin cloud is lit from behind
            let behind = pow(max(dot(d, c.sunDir), 0.0), 8.0);
            tone = tone + c.rimColor * behind * (1.0 - den) * 1.5;
            let a = clamp(den * dt * 3.5, 0.0, 1.0);
            col = col + tone * a * (1.0 - alpha);
            alpha = alpha + a * (1.0 - alpha);
            if (alpha > 0.97) {
                break;
            }
        }
        t = t + dt;
    }
    // fade toward the horizon (the slab gets very long there)
    let fade = smoothstep(0.02, 0.15, d.y);
    return vec4f(col, alpha * fade);
}

// low painted banks along the horizon (sunset streaks, distant haze)
fn cloudsLayered(d: vec3f, c: CloudParams) -> vec4f {
    let el = d.y;
    if (el < -0.05 || el > 0.35) {
        return vec4f(0.0);
    }
    let az = atan2(d.z, d.x);
    var a = 0.0;
    var col = vec3f(0.0);
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let h = 0.03 + fi * 0.06;
        let n = fbm2(vec2f(az * (3.0 + fi * 2.0) + c.time * 0.003 * (fi + 1.0), fi * 7.3), 4, 2.0, 0.5) * 0.5 + 0.5;
        let thick = 0.015 + 0.025 * n;
        let band = (1.0 - smoothstep(thick * 0.6, thick, abs(el - h - (n - 0.5) * 0.03))) * smoothstep(0.35, 0.6, n);
        let lit = smoothstep(-0.2, 0.4, dot(normalize(vec3f(d.x, 0.0, d.z)), normalize(vec3f(c.sunDir.x, 0.0, c.sunDir.z))));
        let tone = mix(c.shadowColor, c.litColor, lit * (0.6 + 0.4 * n));
        col = mix(col, tone, band * (1.0 - a));
        a = a + band * (1.0 - a);
    }
    return vec4f(col, a);
}

// thin high cirrus stretched along the wind
fn cloudsCirrus(d: vec3f, c: CloudParams, amount: f32) -> vec4f {
    if (d.y <= 0.05 || amount <= 0.0) {
        return vec4f(0.0);
    }
    let p = d.xz / d.y;
    let w = normalize(c.windDir + vec2f(1e-4));
    let along = dot(p, w);
    let across = dot(p, vec2f(-w.y, w.x));
    let n = fbm2(vec2f(along * 0.5 + c.time * 0.004, across * 4.0), 4, 2.1, 0.5) * 0.5 + 0.5;
    let wisps = smoothstep(0.55, 0.8, n) * smoothstep(0.05, 0.25, d.y) * amount;
    let lit = 0.6 + 0.4 * pow(max(dot(d, c.sunDir), 0.0), 2.0);
    return vec4f(mix(c.midColor, c.litColor, lit), wisps * 0.6);
}

// light fingers fanning from the sun through gaps between clouds
fn cloudsGodFingers(d: vec3f, c: CloudParams, amount: f32) -> f32 {
    if (amount <= 0.0) {
        return 0.0;
    }
    let toSun = d - c.sunDir * dot(d, c.sunDir);
    let ang = atan2(toSun.z, toSun.x);
    let fan = smoothstep(0.55, 0.9, valueNoise2(vec2f(ang * 9.0, c.time * 0.05)));
    let near = pow(max(dot(d, c.sunDir), 0.0), 3.0);
    return fan * near * amount;
}

// the full cloud stack over a sky colour
fn cloudsComposite(sky: vec3f, d: vec3f, c: CloudParams, cirrus: f32, fingers: f32) -> vec3f {
    var col = sky;
    let ci = cloudsCirrus(d, c, cirrus);
    col = mix(col, ci.rgb, ci.a);
    let la = cloudsLayered(d, c);
    col = mix(col, la.rgb, la.a);
    let cu = cloudsCumulus(d, c);
    col = mix(col, cu.rgb / max(cu.a, 1e-4), cu.a);
    col = col + c.rimColor * cloudsGodFingers(d, c, fingers) * 0.25;
    return col;
}
