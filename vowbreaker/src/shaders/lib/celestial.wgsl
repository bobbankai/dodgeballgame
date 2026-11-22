// ============================================================================================
// vb_celestial: what hangs in an anime sky. The sun as a disc with limb darkening and a soft
// lens glow and starburst; the moon with its phase, painted maria and craters, an earthshine on
// the dark side and a halo ring in thin cloud; stars that twinkle in a few sizes with a Milky Way
// band; shooting stars; festival fireworks blooming and falling as glitter (the lantern festival);
// a rainbow after the rain (spring); sky lanterns rising for the Night Parade; and the warm
// city glow under the horizon.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_sdf2d.
// ============================================================================================

fn celSun(d: vec3f, sunDir: vec3f, size: f32, col: vec3f) -> vec3f {
    let c = dot(d, sunDir);
    let ang = acos(clamp(c, -1.0, 1.0));
    let r = ang / max(size, 1e-4);
    let disc = 1.0 - smoothstep(0.92, 1.0, r);
    let limb = 0.7 + 0.3 * sqrt(max(1.0 - r * r, 0.0));
    let glow = exp(-ang * 18.0) * 0.6 + exp(-ang * 4.0) * 0.15;
    // a soft four-point starburst
    let up = vec3f(0.0, 1.0, 0.0);
    let right = normalize(cross(up, sunDir) + vec3f(1e-4));
    let upv = cross(sunDir, right);
    let q = vec2f(dot(d, right), dot(d, upv));
    let burst = pow(max(1.0 - abs(q.x) * 30.0, 0.0), 6.0) + pow(max(1.0 - abs(q.y) * 30.0, 0.0), 6.0);
    return col * (disc * limb * 8.0 + glow + burst * exp(-ang * 6.0) * 0.4);
}

// the moon: phase 0 new .. 0.5 full .. 1 new; returns colour and coverage
fn celMoon(d: vec3f, moonDir: vec3f, size: f32, phase: f32, col: vec3f, time: f32) -> vec4f {
    let right = normalize(cross(vec3f(0.0, 1.0, 0.0), moonDir) + vec3f(1e-4));
    let up = cross(moonDir, right);
    let q = vec2f(dot(d, right), dot(d, up)) / max(size, 1e-4);
    let r = length(q);
    let front = dot(d, moonDir);
    if (front < 0.0) {
        return vec4f(0.0);
    }
    let disc = 1.0 - smoothstep(0.97, 1.0, r);
    var lightCol = vec3f(0.0);
    if (disc > 0.0) {
        let z = sqrt(max(1.0 - r * r, 0.0));
        let n = vec3f(q.x, q.y, z);
        let a = (phase - 0.5) * TAU;
        let l = vec3f(sin(a), 0.0, cos(a));
        let lit = smoothstep(-0.05, 0.05, dot(n, l));
        let maria = smoothstep(0.45, 0.6, fbm2(q * 2.2 + vec2f(3.1, 1.7), 4, 2.0, 0.5) * 0.5 + 0.5);
        let cr = worley2(q * 5.0, 1.0);
        let crater = (1.0 - smoothstep(0.0, 0.05, abs(cr.f1 - 0.2))) * step(0.6, cr.id.x) * 0.25;
        let surface = (0.95 - maria * 0.3 - crater) * (0.8 + 0.2 * z);
        let earthshine = 0.06;
        lightCol = col * surface * mix(earthshine, 1.0, lit);
    }
    let halo = (1.0 - smoothstep(0.0, 0.25, abs(r - 3.2))) * 0.06 + exp(-max(r - 1.0, 0.0) * 1.2) * 0.12 * (1.0 - disc);
    return vec4f(lightCol + col * halo * 0.6, disc);
}

fn celStars(d: vec3f, time: f32, amount: f32) -> vec3f {
    if (amount <= 0.0 || d.y < -0.05) {
        return vec3f(0.0);
    }
    var acc = vec3f(0.0);
    for (var layer = 0; layer < 3; layer++) {
        let fl = f32(layer);
        let scale = 90.0 + fl * 80.0;
        let p = d * scale;
        let cell = floor(p);
        let h = hash33(cell + vec3f(fl * 31.0));
        let center = cell + h;
        let dist = length(p - center);
        let size = 0.06 + h.z * 0.08 - fl * 0.02;
        let star = 1.0 - smoothstep(0.0, size, dist);
        let twinkle = 0.6 + 0.4 * sin(time * (2.0 + h.x * 5.0) + h.y * 40.0);
        let present = step(0.88 - fl * 0.03, h.x);
        let tint = mix(vec3f(0.75, 0.82, 1.0), vec3f(1.0, 0.9, 0.75), h.y);
        acc = acc + tint * star * twinkle * present * (1.5 - fl * 0.4);
    }
    // the Milky Way: a faint dusty band across the sky
    let galN = normalize(vec3f(0.3, 0.85, 0.42));
    let band = exp(-pow(dot(d, galN) * 4.0, 2.0));
    let dust = fbm2(vec2f(atan2(d.z, d.x) * 6.0, d.y * 8.0), 5, 2.0, 0.5) * 0.5 + 0.5;
    acc = acc + vec3f(0.55, 0.6, 0.8) * band * dust * 0.12;
    return acc * amount * smoothstep(-0.05, 0.15, d.y);
}

fn celShootingStar(d: vec3f, time: f32, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return vec3f(0.0);
    }
    let slot = floor(time / 7.0);
    let h = hash31(slot);
    let t = fract(time / 7.0) * 7.0;
    if (t > 0.9 || h.z > amount) {
        return vec3f(0.0);
    }
    let start = normalize(vec3f(h.x * 2.0 - 1.0, 0.5 + h.y * 0.4, 0.6));
    let dir = normalize(vec3f(-0.6, -0.35, 0.2));
    let head = normalize(start + dir * t * 0.6);
    let tail = normalize(start + dir * max(t - 0.25, 0.0) * 0.6);
    let pd = distToSegment(d, tail, head);
    let along = clamp(dot(d - tail, head - tail) / max(dot(head - tail, head - tail), 1e-6), 0.0, 1.0);
    return vec3f(1.0, 0.95, 0.85) * (1.0 - smoothstep(0.0, 0.002, pd)) * along * (1.0 - t / 0.9) * 3.0;
}

// fireworks over the festival: shells burst into rings of sparks that fall and fade
fn celFireworks(d: vec3f, time: f32, amount: f32) -> vec3f {
    if (amount <= 0.0 || d.y < 0.0) {
        return vec3f(0.0);
    }
    var acc = vec3f(0.0);
    for (var i = 0; i < 4; i++) {
        let fi = f32(i);
        let period = 3.2 + fi * 0.7;
        let slot = floor((time + fi * 1.3) / period);
        let h = hash31(slot * 7.0 + fi * 13.0);
        let t = fract((time + fi * 1.3) / period) * period;
        let center = normalize(vec3f(h.x * 1.6 - 0.8, 0.35 + h.y * 0.35, 0.75 + h.z * 0.2));
        let right = normalize(cross(vec3f(0.0, 1.0, 0.0), center));
        let up = cross(center, right);
        let q = vec2f(dot(d, right), dot(d, up));
        let burst = clamp(t / 1.6, 0.0, 1.0);
        let r = easeOutCubic(burst) * (0.12 + h.y * 0.06);
        let fall = burst * burst * 0.05;
        let qq = q + vec2f(0.0, fall);
        let ang = atan2(qq.y, qq.x);
        let rays = 24.0;
        let spoke = abs(fract(ang / TAU * rays) - 0.5) * 2.0;
        let ring = 1.0 - smoothstep(0.0, 0.01, abs(length(qq) - r));
        let sparks = ring * (1.0 - smoothstep(0.0, 0.25, 1.0 - spoke)) + ring * 0.2;
        let trails = (1.0 - smoothstep(0.0, 0.004, abs(spoke - 1.0) * length(qq))) * step(length(qq), r) * 0.3;
        let fade = (1.0 - burst) * step(0.05, t);
        let glitter = step(0.6, hash12(floor(qq * 400.0) + vec2f(floor(t * 20.0))));
        let col = hsvToRgb(vec3f(h.z, 0.75, 1.0));
        acc = acc + col * (sparks * (0.6 + 0.4 * glitter) + trails) * fade * 3.0;
    }
    return acc * amount;
}

// a rainbow opposite the sun after the rain
fn celRainbow(d: vec3f, sunDir: vec3f, amount: f32) -> vec3f {
    if (amount <= 0.0 || d.y < -0.02) {
        return vec3f(0.0);
    }
    let anti = -sunDir;
    let ang = acos(clamp(dot(d, anti), -1.0, 1.0));
    let r = (ang - 0.7) / 0.04;
    if (r < 0.0 || r > 1.0) {
        return vec3f(0.0);
    }
    let col = hsvToRgb(vec3f(0.8 - r * 0.8, 0.7, 1.0));
    let edge = smoothstep(0.0, 0.15, r) * smoothstep(1.0, 0.85, r);
    return col * edge * amount * 0.25 * smoothstep(-0.02, 0.2, d.y);
}

// sky lanterns rising (the Night Parade): warm dots drifting up and swaying
fn celSkyLanterns(d: vec3f, time: f32, amount: f32, col: vec3f) -> vec3f {
    if (amount <= 0.0 || d.y < 0.0) {
        return vec3f(0.0);
    }
    var acc = vec3f(0.0);
    for (var layer = 0; layer < 2; layer++) {
        let fl = f32(layer);
        let az = atan2(d.z, d.x);
        let p = vec2f(az * (16.0 + fl * 10.0), d.y * (14.0 + fl * 8.0) - time * (0.15 + fl * 0.08));
        let cell = floor(p);
        let h = hash22(cell + vec2f(fl * 9.0));
        let c = cell + vec2f(0.5 + sin(time * 0.6 + h.x * 20.0) * 0.2, h.y);
        let q = (p - c) * vec2f(1.0, 0.8);
        let lamp = 1.0 - smoothstep(0.06, 0.12, length(q));
        let present = step(0.7, h.x);
        let flicker = 0.8 + 0.2 * sin(time * 9.0 + h.y * 30.0);
        acc = acc + col * lamp * present * flicker * (1.2 - fl * 0.4);
    }
    return acc * amount;
}

// the glow of a city or a burning village under the horizon
fn celHorizonGlow(d: vec3f, col: vec3f, amount: f32, time: f32) -> vec3f {
    if (amount <= 0.0) {
        return vec3f(0.0);
    }
    let band = exp(-max(d.y, 0.0) * 8.0) * smoothstep(-0.08, 0.01, d.y);
    let flick = 0.85 + 0.15 * valueNoise2(vec2f(atan2(d.z, d.x) * 6.0, time * 0.5));
    return col * band * amount * flick;
}
