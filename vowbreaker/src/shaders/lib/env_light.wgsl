// ============================================================================================
// vb_env_light: light on a stage beyond the sun and its shadow map. Cloud shadows slide across
// the ground; light through leaves falls in dapples (komorebi) that shimmer as the wind moves the
// canopy; a shoji screen casts its grid onto the floor behind it; lantern-lit streets glow warm
// near every lantern; neon spills its colour onto wet tarmac; windows throw their light out onto
// the street at night; the ground bounces its colour up onto walls; and the sky's colour fills
// the shadows from above, cooler where the sky is open.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_lighting.
// ============================================================================================

// cloud shadows: an fbm field projected along the sun direction, drifting with the wind
fn envCloudShadow(p: vec3f, sunDir: vec3f, wind: vec2f, time: f32, coverage: f32, scale: f32) -> f32 {
    if (coverage <= 0.0) {
        return 1.0;
    }
    let along = p.xz - sunDir.xz / max(sunDir.y, 0.15) * p.y;
    let q = along * scale - wind * time * 0.05;
    let n = fbm2(q, 4, 2.0, 0.5) * 0.5 + 0.5;
    let shadow = smoothstep(1.0 - coverage, 1.0 - coverage + 0.12, n);
    return 1.0 - shadow * 0.65;
}

// light through leaves: overlapping round sun-images whose brightness flickers with the wind
fn envDapples(p: vec3f, n: vec3f, sunDir: vec3f, time: f32, amount: f32, wind: f32) -> f32 {
    if (amount <= 0.0) {
        return 1.0;
    }
    let along = p.xz - sunDir.xz / max(sunDir.y, 0.2) * p.y;
    var light = 0.0;
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let q = along * (1.3 + fi * 0.7) + vec2f(fi * 3.7, fi * 1.9);
        let c = worley2(q, 1.0);
        let sway = sin(time * (1.5 + fi) + c.id.x * 20.0) * 0.06 * wind;
        let spot = 1.0 - smoothstep(0.22 + sway, 0.3 + sway, c.f1);
        let on = step(0.45, c.id.y);
        light = max(light, spot * on);
    }
    let facing = smoothstep(0.0, 0.5, dot(n, sunDir));
    return mix(1.0, 0.35 + 0.65 * light, amount * facing);
}

// a shoji grid's shadow thrown across the floor from a lit screen (plane given by point + normal)
fn envShojiShadow(p: vec3f, screenPoint: vec3f, screenNormal: vec3f, lightDir: vec3f, cell: vec2f, amount: f32) -> f32 {
    if (amount <= 0.0) {
        return 1.0;
    }
    let denom = dot(lightDir, screenNormal);
    if (abs(denom) < 1e-3) {
        return 1.0;
    }
    let t = dot(screenPoint - p, screenNormal) / denom;
    if (t < 0.0) {
        return 1.0;
    }
    let hit = p + lightDir * t;
    let right = normalize(cross(vec3f(0.0, 1.0, 0.0), screenNormal));
    let uv = vec2f(dot(hit - screenPoint, right), hit.y - screenPoint.y) / cell;
    let f = abs(fract(uv) - 0.5);
    let bar = step(0.44, max(f.x, f.y));
    return 1.0 - bar * amount * 0.6;
}

// a warm pool of light round every lantern-like point (cheap, no shadows)
fn envLanternPool(p: vec3f, n: vec3f, lightPos: vec3f, col: vec3f, radius: f32) -> vec3f {
    let d = lightPos - p;
    let dist = length(d);
    let k = max(dot(n, d / max(dist, 1e-4)), 0.0) * glowFalloff(dist, radius);
    return col * quantizeSoft(k, 4.0, 0.15);
}

// neon spill: a coloured glow on floors and walls near a sign, smeared along wet ground
fn envNeonSpill(p: vec3f, n: vec3f, signPos: vec3f, col: vec3f, radius: f32, wet: f32) -> vec3f {
    let d = p - signPos;
    let flatD = length(vec2f(d.x, d.z));
    let falloff = exp(-flatD * flatD / max(radius * radius, 1e-3));
    let floorK = smoothstep(0.7, 0.95, n.y) * (0.5 + 1.5 * wet);
    let wallK = (1.0 - abs(n.y)) * 0.6;
    return col * falloff * (floorK + wallK) * 0.5;
}

// windows at night throw their light out as stretched rectangles on the street below
fn envWindowLight(p: vec3f, n: vec3f, time: f32, amount: f32, col: vec3f) -> vec3f {
    if (amount <= 0.0 || n.y < 0.8) {
        return vec3f(0.0);
    }
    let cell = floor(p.xz / vec2f(3.0, 2.0));
    let h = hash22(cell);
    let lit = step(0.55, h.x);
    let local = fract(p.xz / vec2f(3.0, 2.0)) - 0.5;
    let rect = (1.0 - smoothstep(0.25, 0.3, abs(local.x))) * (1.0 - smoothstep(0.18, 0.24, abs(local.y + 0.1)));
    let flick = 0.9 + 0.1 * sin(time * (0.3 + h.y) + h.x * 30.0);
    return col * rect * lit * flick * amount * 0.35;
}

// ground colour bounced up onto the lower parts of walls
fn envBounce(n: vec3f, p: vec3f, groundCol: vec3f, sunCol: vec3f, strength: f32) -> vec3f {
    let facingDown = clamp(-n.y * 0.5 + 0.5, 0.0, 1.0);
    let low = 1.0 - smoothstep(0.0, 3.0, p.y);
    return groundCol * sunCol * facingDown * low * strength * 0.25;
}

// sky fill: cooler and stronger where a surface sees more sky (AO says how much)
fn envSkyFill(n: vec3f, ao: f32, skyCol: vec3f, horizonCol: vec3f) -> vec3f {
    let up = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    return mix(horizonCol, skyCol, up) * ao * (0.35 + 0.65 * up);
}

// "god's eye" light patches: a few big bright shapes where the sun breaks through, painterly
fn envSunPatches(p: vec3f, sunDir: vec3f, time: f32, amount: f32) -> f32 {
    if (amount <= 0.0) {
        return 1.0;
    }
    let along = p.xz - sunDir.xz / max(sunDir.y, 0.2) * p.y;
    let n = fbm2(along * 0.06 + vec2f(time * 0.01, 0.0), 3, 2.0, 0.5);
    return 1.0 + smoothstep(0.25, 0.4, n) * amount * 0.35;
}

// a fire's flickering orange light on everything near it (the burning village)
fn envFireLight(p: vec3f, n: vec3f, firePos: vec3f, radius: f32, time: f32, strength: f32) -> vec3f {
    if (strength <= 0.0) {
        return vec3f(0.0);
    }
    let d = firePos - p;
    let dist = length(d);
    let k = max(dot(n, d / max(dist, 1e-4)) * 0.6 + 0.4, 0.0) * glowFalloff(dist, radius);
    let flick = 0.75 + 0.15 * sin(time * 13.0 + firePos.x) + 0.1 * sin(time * 29.0 + firePos.z);
    return vec3f(1.0, 0.45, 0.12) * k * flick * strength;
}

// the moon's cold light: blue, soft, with a faint silver sheen on wet or glossy floors
fn envMoonlight(n: vec3f, v: vec3f, moonDir: vec3f, gloss: f32, strength: f32) -> vec3f {
    if (strength <= 0.0) {
        return vec3f(0.0);
    }
    let diff = clamp(dot(n, moonDir) * 0.5 + 0.5, 0.0, 1.0);
    let spec = toonSpecular(n, moonDir, v, 0.02, 0.01) * gloss;
    return vec3f(0.55, 0.65, 0.95) * (diff * 0.25 + spec) * strength;
}
