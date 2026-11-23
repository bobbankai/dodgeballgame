// ============================================================================================
// vb_atmosphere: fog, aerial perspective, phase functions and the stylized sky.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_sdf2d.
// ============================================================================================

struct SkyParams {
    zenith: vec3f,
    horizon: vec3f,
    ground: vec3f,
    sunDir: vec3f,
    sunColor: vec3f,
    moonDir: vec3f,
    moonColor: vec3f,
    cloudColor: vec3f,
    cloudShadow: vec3f,
    time: f32,
    cloudCover: f32,   // 0..1
    starAmount: f32,   // 0..1
    sunSize: f32,      // angular radius-ish, e.g. 0.03
    moonPhase: f32,    // 0 = full .. 1 = new
    horizonGlow: f32,
}

// --- phase functions ------------------------------------------------------------------------------

fn phaseRayleigh(cosTheta: f32) -> f32 {
    return 3.0 / (16.0 * PI) * (1.0 + cosTheta * cosTheta);
}

fn phaseHenyeyGreenstein(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5));
}

fn phaseSchlick(cosTheta: f32, k: f32) -> f32 {
    let d = 1.0 + k * cosTheta;
    return (1.0 - k * k) / (4.0 * PI * d * d);
}

// --- fog --------------------------------------------------------------------------------------------

fn fogExp(dist: f32, density: f32) -> f32 {
    return 1.0 - exp(-dist * density);
}

fn fogExp2(dist: f32, density: f32) -> f32 {
    let d = dist * density;
    return 1.0 - exp(-d * d);
}

// analytic exponential height fog integrated along the view ray (Wenzel / Quilez)
fn heightFog(camPos: vec3f, worldPos: vec3f, density: f32, falloff: f32, baseHeight: f32) -> f32 {
    let rd = worldPos - camPos;
    let dist = length(rd);
    let dirY = rd.y / max(dist, 1e-4);
    let h0 = camPos.y - baseHeight;
    var amount: f32;
    if (abs(dirY) < 1e-4) {
        amount = density * exp(-h0 * falloff) * dist;
    } else {
        amount = density * exp(-h0 * falloff) * (1.0 - exp(-dist * dirY * falloff)) / (dirY * falloff);
    }
    return clamp(1.0 - exp(-max(amount, 0.0)), 0.0, 1.0);
}

// fog colour that brightens toward the sun (in-scattering)
fn fogColorWithSun(fogCol: vec3f, sunCol: vec3f, viewDir: vec3f, sunDir: vec3f, power: f32) -> vec3f {
    let s = pow(max(dot(viewDir, sunDir), 0.0), power);
    return fogCol + sunCol * s;
}

// stylized aerial perspective: distance fades toward the horizon colour, losing saturation and
// contrast first (painted backgrounds: flatter and bluer with distance)
fn aerialPerspective(col: vec3f, dist: f32, start: f32, end: f32, horizon: vec3f, desat: f32) -> vec3f {
    let t = smoothstep(start, end, dist);
    let flat = mix(col, vec3f(luma(col)), t * desat);
    return mix(flat, horizon, t * 0.85);
}

// drifting ground mist (2D noise sheets in world space)
fn groundMist(worldPos: vec3f, time: f32, height: f32, scale: f32) -> f32 {
    let p = worldPos.xz * scale + vec2f(time * 0.05, time * 0.03);
    let n = vfbm2(p, 4);
    let h = 1.0 - smoothstep(0.0, height, worldPos.y);
    return clamp((n - 0.35) * 2.0, 0.0, 1.0) * h;
}

// --- sky ----------------------------------------------------------------------------------------------

fn skyGradient(d: vec3f, p: SkyParams) -> vec3f {
    let y = d.y;
    let up = pow(clamp(y, 0.0, 1.0), 0.45);
    var col = mix(p.horizon, p.zenith, up);
    // below the horizon: blend down into the ground colour quickly
    col = mix(col, p.ground, smoothstep(0.0, -0.08, y));
    // horizon glow band, stronger toward the sun
    let sunAz = max(dot(normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-4)), normalize(vec3f(p.sunDir.x, 0.0, p.sunDir.z) + vec3f(1e-4))), 0.0);
    let band = exp(-abs(y) * 9.0) * (0.35 + 0.65 * pow(sunAz, 3.0));
    col = col + p.sunColor * band * p.horizonGlow;
    return col;
}

fn skySun(d: vec3f, p: SkyParams) -> vec3f {
    let c = dot(d, p.sunDir);
    let disc = smoothstep(cos(p.sunSize), cos(p.sunSize * 0.85), c);
    let halo = pow(max(c, 0.0), 220.0) * 0.6 + pow(max(c, 0.0), 18.0) * 0.12;
    return p.sunColor * (disc * 6.0 + halo);
}

// the moon: a lit disc with phase and painted maria, plus a soft glow
fn skyMoon(d: vec3f, p: SkyParams) -> vec3f {
    let m = p.moonDir;
    let r = 0.045;
    let b = basisFromNormal(m);
    let local = vec2f(dot(d, b[0]), dot(d, b[1])) / r;
    let facing = dot(d, m);
    if (facing <= 0.0) {
        return vec3f(0.0);
    }
    let disc = sdCircle(local, 1.0);
    let shadowDisc = sdCircle(local - vec2f(p.moonPhase * 2.0, 0.0), 1.0);
    let lit = clamp(0.5 - disc * 8.0, 0.0, 1.0) * clamp(0.5 + shadowDisc * 8.0 * sign(p.moonPhase + 1e-3), 0.0, 1.0);
    let maria = 0.75 + 0.25 * vfbm2(local * 2.5 + 3.0, 3);
    let glow = pow(max(facing, 0.0), 900.0) * 0.6 + pow(max(facing, 0.0), 60.0) * 0.08;
    return p.moonColor * (lit * maria * 2.5 + glow);
}

// twinkling stars on a sphere: one candidate per cell, brightness from a hash, colour by temperature
fn skyStars(d: vec3f, time: f32, amount: f32) -> vec3f {
    if (amount <= 0.0 || d.y < -0.02) {
        return vec3f(0.0);
    }
    var col = vec3f(0.0);
    for (var layer = 0; layer < 2; layer++) {
        let scale = select(260.0, 140.0, layer == 0);
        let q = d * scale;
        let cell = floor(q);
        let h = ihash33(vec3i(cell) + vec3i(layer * 101));
        let starPos = cell + 0.2 + h * 0.6;
        let dist = length(q - starPos);
        let bright = pow(h.x, 18.0) * 3.0 + pow(h.y, 40.0) * 8.0;
        let tw = 0.65 + 0.35 * sin(time * (1.5 + h.z * 3.0) + h.y * 40.0);
        let core = exp(-dist * dist * 9.0);
        let temp = mix(vec3f(0.75, 0.85, 1.0), vec3f(1.0, 0.85, 0.7), h.z);
        col = col + temp * core * bright * tw;
    }
    return col * amount * smoothstep(-0.02, 0.2, d.y);
}

// stylized clouds on a virtual plane: noise sheets with toon-stepped density and a lit edge
fn skyClouds(d: vec3f, p: SkyParams) -> vec4f {
    if (d.y <= 0.01 || p.cloudCover <= 0.0) {
        return vec4f(0.0);
    }
    let t = 1.0 / d.y;
    let uv = d.xz * t * 0.35 + vec2f(p.time * 0.004, p.time * 0.0015);
    let base = vfbm2(uv * 1.3, 5);
    let detail = vfbm2(uv * 5.0 - vec2f(p.time * 0.01, 0.0), 3);
    let dens = base * 0.8 + detail * 0.2;
    let cover = 1.0 - p.cloudCover;
    let c = smoothstep(cover, cover + 0.12, dens);
    // toon banding: two tones and a bright rim facing the sun
    let toSun = normalize(vec2f(p.sunDir.x, p.sunDir.z) + vec2f(1e-4));
    let lightSample = vfbm2((uv + toSun * 0.04) * 1.3, 5) * 0.8 + detail * 0.2;
    let shade = smoothstep(0.0, 0.08, dens - lightSample);
    let lit = mix(p.cloudColor, p.cloudShadow, step(0.5, shade));
    let rim = smoothstep(cover + 0.02, cover, dens - 0.06) * (1.0 - shade);
    let fade = smoothstep(0.01, 0.15, d.y);
    return vec4f(lit + p.sunColor * rim * 0.4, c * fade);
}

fn evalSky(d: vec3f, p: SkyParams) -> vec3f {
    var col = skyGradient(d, p);
    col = col + skyStars(d, p.time, p.starAmount);
    col = col + skyMoon(d, p);
    col = col + skySun(d, p);
    let cl = skyClouds(d, p);
    col = mix(col, cl.rgb, cl.a);
    return col;
}

// aurora-like ribbons (used for the cursed sky above the Grand Vow)
fn skyRibbons(d: vec3f, time: f32, col: vec3f) -> vec3f {
    if (d.y < 0.0) {
        return vec3f(0.0);
    }
    var acc = vec3f(0.0);
    for (var i = 0; i < 6; i++) {
        let fi = f32(i);
        let h = 0.25 + fi * 0.08;
        let t = h / max(d.y, 0.02);
        let p = d.xz * t;
        let wave = sin(p.x * 0.6 + time * 0.2 + fi * 1.3) * 0.6 + simplex2(p * 0.3 + vec2f(time * 0.05, fi)) * 0.8;
        let band = exp(-abs(p.y + wave + fi * 0.6 - 2.0) * 3.0);
        acc = acc + col * band * (0.25 - fi * 0.03) * smoothstep(0.0, 0.3, d.y);
    }
    return acc;
}
