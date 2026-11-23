// VFX core: what every mesh effect shares (the vfx material, src/render/Vfx.ts).
//
// An effect is a small mesh (arc, disc, dome, sphere, cylinder, ribbon, quad) whose surface is
// painted procedurally. The look follows the character art: shapes are posterised into three or
// four flat bands (core, body, edge) instead of smooth gradients, carry an ink line where the
// shape ends, and boil on twos (the noise is re-seeded 12 times a second like hand-drawn effects
// animation). Light effects are additive and push past 1.0 so the bloom catches them; matter
// effects (ink, smoke, paper, water) are alpha blended and lit as cels.
//
// Every effect kind is a function `vfxXxx(i: VfxIn) -> VfxOut`, dispatched in vfx.fragment.

struct VfxIn {
    uv: vec2f,          // the shape's own parameterisation (see each shape in Vfx.ts)
    local: vec3f,       // object-space position (unit shapes)
    n: vec3f,           // world normal
    v: vec3f,           // world direction to the eye
    world: vec3f,       // world position
    fres: f32,          // 1 at silhouettes, 0 facing the eye
    age: f32,           // 0 at birth .. 1 at death
    seed: f32,          // per-effect random
    time: f32,          // seconds
    st: f32,            // time stepped to 12 fps (boil)
    inten: f32,         // brightness multiplier
    p: vec4f,           // kind parameters
    q: vec4f,           // more kind parameters
    body: vec3f,        // palette: main colour
    core: vec3f,        //          hot centre
    edge: vec3f,        //          rim / contrast
    px: f32,            // uv size of one screen pixel (for antialiasing)
}

struct VfxOut {
    rgb: vec3f,
    a: f32,
}

fn vfxNone() -> VfxOut {
    var o: VfxOut;
    o.rgb = vec3f(0.0);
    o.a = 0.0;
    return o;
}

fn vfxOut(rgb: vec3f, a: f32) -> VfxOut {
    var o: VfxOut;
    o.rgb = rgb;
    o.a = clamp(a, 0.0, 1.0);
    return o;
}

// layer b over a (alpha "over")
fn vfxOver(a: VfxOut, b: VfxOut) -> VfxOut {
    let outA = b.a + a.a * (1.0 - b.a);
    let rgb = (b.rgb * b.a + a.rgb * a.a * (1.0 - b.a)) / max(outA, 1e-4);
    return vfxOut(rgb, outA);
}

// add light (additive effects composed in one shader)
fn vfxAdd(a: VfxOut, rgb: vec3f, k: f32) -> VfxOut {
    return vfxOut(a.rgb + rgb * k, max(a.a, clamp(k, 0.0, 1.0)));
}

// --- life curves -------------------------------------------------------------------------------------------

// fast in, hold, slow out (most light effects)
fn vfxLifeFade(age: f32, inT: f32, outT: f32) -> f32 {
    return smoothstep(0.0, max(inT, 1e-4), age) * (1.0 - smoothstep(1.0 - outT, 1.0, age));
}

// the punchy curve of a hit: overshoots bright on the first frames, then decays
fn vfxPunch(age: f32) -> f32 {
    return (1.0 + 2.0 * exp(-age * 30.0)) * (1.0 - smoothstep(0.35, 1.0, age));
}

// expansion with a soft overshoot (shockwaves, rings)
fn vfxExpand(age: f32, k: f32) -> f32 {
    return 1.0 - exp(-age * k);
}

// --- the anime energy ramp ---------------------------------------------------------------------------------

// a scalar field (0 outside .. 1 hottest) posterised into edge / body / core bands with soft
// antialiased steps; returns colour and coverage. `t` are the band thresholds.
fn vfxRamp(f: f32, edgeC: vec3f, bodyC: vec3f, coreC: vec3f, t0: f32, t1: f32, t2: f32, aa: f32) -> VfxOut {
    let e = smoothstep(t0 - aa, t0 + aa, f);
    let b = smoothstep(t1 - aa, t1 + aa, f);
    let c = smoothstep(t2 - aa, t2 + aa, f);
    var rgb = mix(edgeC, bodyC, b);
    rgb = mix(rgb, coreC, c);
    return vfxOut(rgb, e);
}

// HDR push for light effects: the core goes past white so bloom flares it, the body glows
fn vfxGlowRamp(f: f32, edgeC: vec3f, bodyC: vec3f, coreC: vec3f, inten: f32, aa: f32) -> VfxOut {
    var o = vfxRamp(f, edgeC, bodyC * 1.6, coreC * 3.0, 0.15, 0.45, 0.78, aa);
    o.rgb = o.rgb * inten;
    return o;
}

// the ink line round a field's threshold, from screen-space derivatives (width in pixels)
fn vfxInkLine(f: f32, threshold: f32, widthPx: f32) -> f32 {
    let g = max(fwidth(f), 1e-5);
    let d = abs(f - threshold) / g;
    return 1.0 - smoothstep(widthPx * 0.5, widthPx * 0.5 + 1.0, d);
}

// dry-brush break-up for ink lines and paper edges (stepped so it boils on twos)
fn vfxDryBrush(uv: vec2f, st: f32, seed: f32, amount: f32) -> f32 {
    let n = valueNoise2(uv * vec2f(60.0, 8.0) + vec2f(st * 3.1 + seed * 17.0, seed * 5.0));
    return mix(1.0, smoothstep(0.2, 0.6, n), amount);
}

// boiling uv: the effect's outline jitters a little every twelfth of a second
fn vfxBoil(uv: vec2f, st: f32, seed: f32, amp: f32) -> vec2f {
    let k = floor(st * 12.0 + 0.5) + seed * 31.0;
    let o = vec2f(valueNoise2(uv * 6.0 + vec2f(k, 0.0)), valueNoise2(uv * 6.0 + vec2f(0.0, k * 1.7))) - 0.5;
    return uv + o * amp;
}

// on-twos flicker (0..1), never fully off
fn vfxFlicker(st: f32, seed: f32, depth: f32) -> f32 {
    let k = floor(st * 12.0 + 0.5);
    return 1.0 - depth * hash12(vec2f(k, seed * 13.0));
}

// --- dissolves -----------------------------------------------------------------------------------------------

// dissolve a shape away with a burning rim: returns (coverage, rim)
fn vfxBurnAway(noise: f32, t: f32, rim: f32) -> vec2f {
    return dissolve(noise, clamp(t, 0.0, 1.0), rim);
}

// dissolve that starts from one end (u = 0) and runs along
fn vfxWipe(u: f32, noise: f32, t: f32, soft: f32) -> f32 {
    let x = u + (noise - 0.5) * soft;
    return smoothstep(t - soft * 0.5, t + soft * 0.5, x);
}

// --- flow fields on shapes --------------------------------------------------------------------------------------

// flame-tongue noise scrolling up a surface: (around, up), rising speed, scale
fn vfxRisingNoise(uv: vec2f, time: f32, speed: f32, scale: vec2f, seed: f32) -> f32 {
    let q = vec2f(uv.x * scale.x, uv.y * scale.y - time * speed) + vec2f(seed * 7.0, 0.0);
    let w = vec2f(fbm2(q * 0.7 + vec2f(0.0, time * 0.3), 3, 2.0, 0.5), fbm2(q * 0.7 + vec2f(5.2, 1.3), 3, 2.0, 0.5));
    return fbm2(q + w * 0.8, 4, 2.0, 0.5) * 0.5 + 0.5;
}

// wrap-safe noise around a cylinder's circumference (u in 0..1 is periodic)
fn vfxCylNoise(u: f32, v: f32, freq: f32, vScale: f32, time: f32) -> f32 {
    let a = u * TAU;
    let p = vec3f(cos(a) * freq, sin(a) * freq, v * vScale - time);
    return fbm3(p, 4, 2.0, 0.5) * 0.5 + 0.5;
}

// spiral bands wound round a cylinder
fn vfxSpiral(uv: vec2f, turns: f32, count: f32, time: f32, width: f32) -> f32 {
    let s = fract((uv.x + uv.y * turns) * count - time);
    return 1.0 - smoothstep(width * 0.5, width, abs(s - 0.5) * 2.0 * 0.5);
}

// speckles: small bright dots strewn on a surface that blink on twos (embers, sparkle in energy)
fn vfxSpeckles(uv: vec2f, density: f32, size: f32, st: f32, seed: f32) -> f32 {
    let g = uv * density;
    let cell = floor(g);
    let h = hash22(cell + vec2f(seed * 3.0, floor(st * 12.0)));
    let d = length(fract(g) - 0.5 - (h - 0.5) * 0.6);
    return (1.0 - smoothstep(size * 0.5, size, d)) * step(0.72, h.x);
}

// speed streaks along u (motion lines inside slashes and dashes)
fn vfxStreaks(u: f32, v: f32, count: f32, seed: f32, len: f32) -> f32 {
    let lane = floor(v * count);
    let h = hash12(vec2f(lane, seed));
    let start = h * (1.0 - len);
    let inLane = 1.0 - smoothstep(0.3, 0.5, abs(fract(v * count) - 0.5));
    return inLane * smoothstep(start, start + 0.05, u) * (1.0 - smoothstep(start + len - 0.05, start + len, u)) * step(0.45, hash12(vec2f(lane, seed + 9.0)));
}

// --- light and cels for matter effects -----------------------------------------------------------------------

// two-tone cel for alpha effects (smoke, ink blobs, water): a fixed key light from above-front
fn vfxCel(n: vec3f, lit: vec3f, shade: vec3f, rimC: vec3f, fres: f32) -> vec3f {
    let key = normalize(vec3f(0.35, 0.85, 0.4));
    let ndl = dot(n, key) * 0.5 + 0.5;
    var c = mix(shade, lit, smoothstep(0.45, 0.52, ndl));
    c = mix(c, rimC, smoothstep(0.62, 0.7, fres) * 0.6);
    return c;
}

// the darker tone of a palette for matter effects
fn vfxDark(c: vec3f) -> vec3f {
    return c * vec3f(0.18, 0.15, 0.22) + vec3f(0.02, 0.015, 0.03);
}

// soften where an effect cuts into the scene (scene and effect view depths)
fn vfxSoftDepth(sceneZ: f32, z: f32, softness: f32) -> f32 {
    if (softness <= 0.0) {
        return 1.0;
    }
    return clamp((sceneZ - z) / softness, 0.0, 1.0);
}
