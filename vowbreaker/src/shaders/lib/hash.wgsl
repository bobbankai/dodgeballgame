// ============================================================================================
// vb_hash: integer and float hashes, low-discrepancy sequences and sampling patterns.
// The integer hashes (PCG family, Jarzynski & Olano 2020) are stable across GPUs, unlike sin-hashes.
// ============================================================================================

fn pcgHash(v: u32) -> u32 {
    let state = v * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn pcg2d(vin: vec2u) -> vec2u {
    var v = vin * 1664525u + 1013904223u;
    v.x = v.x + v.y * 1664525u;
    v.y = v.y + v.x * 1664525u;
    v = v ^ (v >> vec2u(16u));
    v.x = v.x + v.y * 1664525u;
    v.y = v.y + v.x * 1664525u;
    v = v ^ (v >> vec2u(16u));
    return v;
}

fn pcg3d(vin: vec3u) -> vec3u {
    var v = vin * 1664525u + 1013904223u;
    v.x = v.x + v.y * v.z;
    v.y = v.y + v.z * v.x;
    v.z = v.z + v.x * v.y;
    v = v ^ (v >> vec3u(16u));
    v.x = v.x + v.y * v.z;
    v.y = v.y + v.z * v.x;
    v.z = v.z + v.x * v.y;
    return v;
}

fn pcg4d(vin: vec4u) -> vec4u {
    var v = vin * 1664525u + 1013904223u;
    v.x = v.x + v.y * v.w;
    v.y = v.y + v.z * v.x;
    v.z = v.z + v.x * v.y;
    v.w = v.w + v.y * v.z;
    v = v ^ (v >> vec4u(16u));
    v.x = v.x + v.y * v.w;
    v.y = v.y + v.z * v.x;
    v.z = v.z + v.x * v.y;
    v.w = v.w + v.y * v.z;
    return v;
}

fn wangHash(seed: u32) -> u32 {
    var s = (seed ^ 61u) ^ (seed >> 16u);
    s = s * 9u;
    s = s ^ (s >> 4u);
    s = s * 0x27d4eb2du;
    s = s ^ (s >> 15u);
    return s;
}

fn xxhash32(p: u32) -> u32 {
    let PRIME32_2 = 2246822519u;
    let PRIME32_3 = 3266489917u;
    let PRIME32_4 = 668265263u;
    let PRIME32_5 = 374761393u;
    var h32 = p + PRIME32_5;
    h32 = PRIME32_4 * ((h32 << 17u) | (h32 >> 15u));
    h32 = PRIME32_2 * (h32 ^ (h32 >> 15u));
    h32 = PRIME32_3 * (h32 ^ (h32 >> 13u));
    return h32 ^ (h32 >> 16u);
}

// u32 -> [0, 1)
fn u2f(x: u32) -> f32 {
    return f32(x >> 8u) * (1.0 / 16777216.0);
}

fn u2f2(x: vec2u) -> vec2f {
    return vec2f(x >> vec2u(8u)) * (1.0 / 16777216.0);
}

fn u2f3(x: vec3u) -> vec3f {
    return vec3f(x >> vec3u(8u)) * (1.0 / 16777216.0);
}

fn u2f4(x: vec4u) -> vec4f {
    return vec4f(x >> vec4u(8u)) * (1.0 / 16777216.0);
}

// float inputs are hashed through their bit patterns, offset so that -0 and 0 agree
fn fbits2(p: vec2f) -> vec2u {
    return bitcast<vec2u>(p + vec2f(0.0001));
}

fn fbits3(p: vec3f) -> vec3u {
    return bitcast<vec3u>(p + vec3f(0.0001));
}

// integer-lattice hashes for noise: use floor()'d coordinates as i32
fn ihash11(p: i32) -> f32 { return u2f(pcgHash(bitcast<u32>(p))); }
fn ihash21(p: vec2i) -> f32 { return u2f(pcg2d(bitcast<vec2u>(p)).x); }
fn ihash22(p: vec2i) -> vec2f { return u2f2(pcg2d(bitcast<vec2u>(p))); }
fn ihash31(p: vec3i) -> f32 { return u2f(pcg3d(bitcast<vec3u>(p)).x); }
fn ihash33(p: vec3i) -> vec3f { return u2f3(pcg3d(bitcast<vec3u>(p))); }
fn ihash41(p: vec4i) -> f32 { return u2f(pcg4d(bitcast<vec4u>(p)).x); }
fn ihash44(p: vec4i) -> vec4f { return u2f4(pcg4d(bitcast<vec4u>(p))); }

// float hashes (arbitrary positions, e.g. per-object seeds)
fn hash11(p: f32) -> f32 { return u2f(pcgHash(bitcast<u32>(p + 0.0001))); }
fn hash12(p: vec2f) -> f32 { return u2f(pcg2d(fbits2(p)).x); }
fn hash13(p: vec3f) -> f32 { return u2f(pcg3d(fbits3(p)).x); }
fn hash21(p: f32) -> vec2f { return u2f2(pcg2d(vec2u(bitcast<u32>(p + 0.0001), 0x9e3779b9u))); }
fn hash22(p: vec2f) -> vec2f { return u2f2(pcg2d(fbits2(p))); }
fn hash23(p: vec3f) -> vec2f { return u2f3(pcg3d(fbits3(p))).xy; }
fn hash31(p: f32) -> vec3f { return u2f3(pcg3d(vec3u(bitcast<u32>(p + 0.0001), 0x9e3779b9u, 0x85ebca6bu))); }
fn hash32(p: vec2f) -> vec3f {
    let b = fbits2(p);
    return u2f3(pcg3d(vec3u(b.x, b.y, b.x ^ 0x5bd1e995u)));
}
fn hash33(p: vec3f) -> vec3f { return u2f3(pcg3d(fbits3(p))); }
fn hash44(p: vec4f) -> vec4f { return u2f4(pcg4d(bitcast<vec4u>(p + vec4f(0.0001)))); }

// signed versions in [-1, 1)
fn shash22(p: vec2f) -> vec2f { return hash22(p) * 2.0 - 1.0; }
fn shash33(p: vec3f) -> vec3f { return hash33(p) * 2.0 - 1.0; }

// Jorge Jimenez' interleaved gradient noise: a dither pattern that hides banding and TAA-friendly
fn interleavedGradientNoise(pixel: vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
}

fn interleavedGradientNoiseAnimated(pixel: vec2f, frame: f32) -> f32 {
    let p = pixel + 5.588238 * fmod1(frame, 64.0);
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

// Roberts' R2 low-discrepancy sequence: sample n of an evenly spread 2D sequence
fn r2Sequence(n: f32) -> vec2f {
    return fract(vec2f(0.5) + n * vec2f(0.75487766624669276, 0.56984029099805326));
}

fn r1Sequence(n: f32) -> f32 {
    return fract(0.5 + n * 0.61803398875);
}

// a 4x4 Bayer matrix as a dither threshold in [0, 1)
fn bayer4(pixel: vec2f) -> f32 {
    let p = vec2u(fmod2(floor(pixel), vec2f(4.0)));
    var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return (m[p.y * 4u + p.x] + 0.5) / 16.0;
}

fn bayer8(pixel: vec2f) -> f32 {
    let a = bayer4(floor(pixel * 0.5));
    let p = vec2u(fmod2(floor(pixel), vec2f(2.0)));
    var m = array<f32, 4>(0.0, 2.0, 3.0, 1.0);
    return (m[p.y * 2u + p.x] + a) / 4.0;
}

// --- sampling patterns -------------------------------------------------------------------------

// i-th of n points of a Vogel (sunflower) disk, rotated by phi: evenly fills the unit disk
fn vogelDisk(i: i32, n: i32, phi: f32) -> vec2f {
    let r = sqrt((f32(i) + 0.5) / f32(n));
    let theta = f32(i) * GOLDEN_ANGLE + phi;
    return vec2f(cos(theta), sin(theta)) * r;
}

fn sampleDiskUniform(u: vec2f) -> vec2f {
    let r = sqrt(u.x);
    let a = u.y * TAU;
    return vec2f(cos(a), sin(a)) * r;
}

// Shirley-Chiu concentric mapping: square to disk with low distortion
fn concentricDisk(u: vec2f) -> vec2f {
    let o = 2.0 * u - 1.0;
    if (o.x == 0.0 && o.y == 0.0) {
        return vec2f(0.0);
    }
    var r: f32;
    var theta: f32;
    if (abs(o.x) > abs(o.y)) {
        r = o.x;
        theta = (PI / 4.0) * (o.y / o.x);
    } else {
        r = o.y;
        theta = HALF_PI - (PI / 4.0) * (o.x / o.y);
    }
    return r * vec2f(cos(theta), sin(theta));
}

fn sampleSphereUniform(u: vec2f) -> vec3f {
    let z = 1.0 - 2.0 * u.x;
    let r = sqrt(max(0.0, 1.0 - z * z));
    let a = TAU * u.y;
    return vec3f(r * cos(a), r * sin(a), z);
}

fn sampleHemisphereUniform(u: vec2f) -> vec3f {
    let z = u.x;
    let r = sqrt(max(0.0, 1.0 - z * z));
    let a = TAU * u.y;
    return vec3f(r * cos(a), r * sin(a), z);
}

fn cosineHemisphere(u: vec2f) -> vec3f {
    let d = concentricDisk(u);
    let z = sqrt(max(0.0, 1.0 - dot(d, d)));
    return vec3f(d.x, d.y, z);
}

fn randomUnitVector(seed: vec3f) -> vec3f {
    return sampleSphereUniform(hash23(seed));
}

// spiral of samples on a sphere (Fibonacci lattice)
fn fibonacciSphere(i: f32, n: f32) -> vec3f {
    let y = 1.0 - (i + 0.5) / n * 2.0;
    let r = sqrt(max(0.0, 1.0 - y * y));
    let theta = GOLDEN_ANGLE * i;
    return vec3f(cos(theta) * r, y, sin(theta) * r);
}
