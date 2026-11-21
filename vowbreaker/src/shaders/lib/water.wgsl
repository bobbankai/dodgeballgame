// ============================================================================================
// vb_water: Gerstner waves, rain ripples, caustics and toon water shading pieces.
// Depends on vb_common, vb_hash, vb_noise, vb_color.
// ============================================================================================

struct WaveResult {
    offset: vec3f,
    normal: vec3f,
    foam: f32,
}

// one Gerstner wave: dir (unit xz), wavelength, steepness 0..1, speed
fn gerstnerWave(p: vec2f, dir: vec2f, wavelength: f32, steepness: f32, time: f32) -> vec4f {
    let k = TAU / wavelength;
    let c = sqrt(9.8 / k);
    let a = steepness / k;
    let f = k * (dot(dir, p) - c * time);
    let cf = cos(f);
    let sf = sin(f);
    // xyz displacement in .xyz, crest sharpness proxy in .w
    return vec4f(dir.x * a * cf, a * sf, dir.y * a * cf, steepness * sf);
}

fn gerstnerSum(p: vec2f, time: f32, scale: f32) -> WaveResult {
    var off = vec3f(0.0);
    var crest = 0.0;
    let dirs = array<vec2f, 4>(vec2f(1.0, 0.2), vec2f(0.6, 0.8), vec2f(-0.3, 1.0), vec2f(0.9, -0.5));
    let lens = array<f32, 4>(9.0, 5.3, 3.1, 1.7);
    let steep = array<f32, 4>(0.22, 0.18, 0.14, 0.1);
    for (var i = 0; i < 4; i++) {
        let w = gerstnerWave(p, normalize(dirs[i]), lens[i] * scale, steep[i], time);
        off = off + w.xyz;
        crest = crest + w.w;
    }
    // normal by finite differences of the height
    let e = 0.05;
    var hx = 0.0;
    var hz = 0.0;
    for (var i = 0; i < 4; i++) {
        hx = hx + gerstnerWave(p + vec2f(e, 0.0), normalize(dirs[i]), lens[i] * scale, steep[i], time).y;
        hz = hz + gerstnerWave(p + vec2f(0.0, e), normalize(dirs[i]), lens[i] * scale, steep[i], time).y;
    }
    var r: WaveResult;
    r.offset = off;
    r.normal = normalize(vec3f(off.y - hx, e, off.y - hz));
    r.foam = clamp(crest * 1.6 - 0.35, 0.0, 1.0);
    return r;
}

// expanding rings where raindrops hit (cells of random drops at random times); returns a normal
// perturbation in xz and a ring mask
fn rainRipples(p: vec2f, time: f32, density: f32) -> vec3f {
    var grad = vec2f(0.0);
    var mask = 0.0;
    let q = p * density;
    let cell = floor(q);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let c = cell + vec2f(f32(i), f32(j));
            let h = ihash22(vec2i(c));
            let phase = fract(time * (0.7 + h.x * 0.6) + h.y);
            let center = c + 0.2 + h * 0.6;
            let d = length(q - center);
            let r = phase * 0.9;
            let ring = exp(-sqr((d - r) * 14.0)) * (1.0 - phase);
            let dir = (q - center) / max(d, 1e-4);
            let wave = sin((d - r) * 40.0) * ring;
            grad = grad + dir * wave;
            mask = mask + ring;
        }
    }
    return vec3f(grad * 0.35, clamp(mask, 0.0, 1.0));
}

// caustic web (two scrolling warped worley layers multiplied)
fn caustics(p: vec2f, time: f32) -> f32 {
    let a = worley2(p * 1.5 + vec2f(time * 0.15, time * 0.1), 1.0).edge;
    let b = worley2(p * 1.9 - vec2f(time * 0.12, -time * 0.08) + 3.7, 1.0).edge;
    let ca = 1.0 - smoothstep(0.0, 0.08, a);
    let cb = 1.0 - smoothstep(0.0, 0.08, b);
    return ca * cb + (ca + cb) * 0.15;
}

// toon water colour by depth below the surface: shallow, mid, deep bands
fn waterDepthColor(depth: f32, shallow: vec3f, mid: vec3f, deep: vec3f) -> vec3f {
    let t1 = smoothstep(0.1, 0.4, depth);
    let t2 = smoothstep(1.2, 3.5, depth);
    let banded = vec2f(floor(t1 * 3.0) / 3.0, floor(t2 * 3.0) / 3.0);
    return mix(mix(shallow, mid, banded.x), deep, banded.y);
}

// the white line where water meets geometry: depth difference in metres, animated
fn shoreFoam(depthDiff: f32, worldXZ: vec2f, time: f32, width: f32) -> f32 {
    let n = valueNoise2(worldXZ * 2.0 + vec2f(time * 0.3, 0.0));
    let band = 1.0 - smoothstep(0.0, width * (0.6 + 0.6 * n), depthDiff);
    let lines = step(0.5, fract(depthDiff / width * 2.0 - time * 0.4 + n * 0.5)) * (1.0 - smoothstep(0.0, width * 3.0, depthDiff));
    return max(step(0.5, band), lines * 0.6);
}

// sparkling stepped highlight on water (sun or moon glitter path)
fn waterGlints(n: vec3f, v: vec3f, l: vec3f, worldXZ: vec2f, time: f32) -> f32 {
    let h = normalize(l + v);
    let nh = max(dot(n, h), 0.0);
    let path = smoothstep(0.985, 0.995, nh);
    let sp = step(0.82, valueNoise2(worldXZ * 6.0 + vec2f(time * 1.3, -time)));
    return path * (0.4 + 0.6 * sp);
}

// puddle mask for wet streets: low spots from noise, sharp edges
fn puddleMask(worldXZ: vec2f, amount: f32) -> f32 {
    let n = vfbm2(worldXZ * 0.18, 4) * 0.7 + valueNoise2(worldXZ * 1.3) * 0.3;
    let t = 1.0 - amount;
    return smoothstep(t, t + 0.04, n);
}
