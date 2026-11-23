// Curse rot (compute/curse_rot.wgsl, src/render/Marks.ts): where curses strike, a rot grows across
// the floor and keeps growing for the rest of the round. It is a Gray-Scott reaction-diffusion
// system on a square over the arena: two chemicals, A (the clean floor) and B (the rot), B feeding
// on A and spreading; with the feed and kill rates chosen here it grows as branching veins and
// coral fronds rather than spots. Seeds are dropped where curse techniques land; purifying light
// (a clear) kills it back.
//
// Texel: r = A, g = B, b = age (how long B has been here, for the colour), a = unused

struct RotParams {
    grid: vec2f,
    centre: vec2f,
    worldSize: f32,
    dt: f32,
    feed: f32,
    kill: f32,
    diffA: f32,
    diffB: f32,
    count: f32,
    pad0: f32,
    seeds: array<vec4f, 8>,     // x, z, radius, strength (negative = cleanse)
}

// the five-point Laplacian with diagonal weights (isotropic enough for organic shapes)
fn rotLaplacian(src: texture_2d<f32>, c: vec2i, size: vec2i) -> vec2f {
    var acc = vec2f(0.0);
    let here = textureLoad(src, c, 0).rg;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            if (i == 0 && j == 0) {
                continue;
            }
            let w = select(0.05, 0.2, i == 0 || j == 0);
            let q = clamp(c + vec2i(i, j), vec2i(0), size - vec2i(1));
            acc = acc + textureLoad(src, q, 0).rg * w;
        }
    }
    return acc - here;
}

// one Gray-Scott step
fn rotStep(ab: vec2f, lap: vec2f, feed: f32, kill: f32, dA: f32, dB: f32, dt: f32) -> vec2f {
    let a = ab.x;
    let b = ab.y;
    let r = a * b * b;
    let na = a + (dA * lap.x - r + feed * (1.0 - a)) * dt;
    let nb = b + (dB * lap.y + r - (kill + feed) * b) * dt;
    return clamp(vec2f(na, nb), vec2f(0.0), vec2f(1.0));
}

// the feed and kill rates vary a little across the floor so the rot is not uniform
fn rotRates(p: vec2f, feed: f32, kill: f32) -> vec2f {
    let n = valueNoise2(p * 0.15) - 0.5;
    return vec2f(feed + n * 0.006, kill + n * 0.002);
}

// --- drawing it on the floor (env.fragment) -------------------------------------------------------------------

struct RotLook {
    albedo: vec3f,
    emissive: vec3f,
    height: f32,
}

// B sampled with its gradient: veins are where B is high; their edges glow violet, old rot goes
// black and swollen, fresh rot glistens
fn rotSurface(albedo0: vec3f, rot: vec4f, grad: vec2f, time: f32, p: vec3f) -> RotLook {
    var o: RotLook;
    let b = rot.g;
    let age = clamp(rot.b, 0.0, 1.0);
    // B runs from 0 (clean) to about 0.35 in the veins: draw the veins and their rims crisply
    let vein = smoothstep(0.17, 0.24, b);
    let edge = smoothstep(0.1, 0.17, b) * (1.0 - vein);
    // the flesh of the rot: dark violet-black, older is blacker
    let flesh = mix(vec3f(0.16, 0.04, 0.18), vec3f(0.03, 0.01, 0.04), age);
    // the floor near the rot is stained and sickly
    let stain = smoothstep(0.03, 0.12, b) * 0.45;
    var c = mix(albedo0, albedo0 * vec3f(0.7, 0.62, 0.75), stain);
    c = mix(c, flesh, vein);
    o.albedo = c;
    // the living edge pulses
    let pulse = 0.6 + 0.4 * sin(time * 2.5 - length(p.xz) * 1.5);
    o.emissive = vec3f(0.6, 0.1, 0.9) * edge * pulse * 0.7 + vec3f(0.35, 0.05, 0.5) * vein * (1.0 - age) * 0.25;
    o.height = vein * (0.5 + 0.5 * age);
    return o;
}
