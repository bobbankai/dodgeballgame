// ============================================================================================
// vb_noise: value, gradient (Perlin), simplex, cellular (Worley/Voronoi) noise in 2D/3D/4D,
// fractal sums (fbm, ridged, billow, turbulence), domain warping, curl and flow noise.
// Depends on vb_common and vb_hash.
// ============================================================================================

// --- interpolants -----------------------------------------------------------------------------

fn quintic2(f: vec2f) -> vec2f { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }
fn quintic3(f: vec3f) -> vec3f { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }
fn quinticDeriv2(f: vec2f) -> vec2f { return 30.0 * f * f * (f * (f - 2.0) + 1.0); }
fn quinticDeriv3(f: vec3f) -> vec3f { return 30.0 * f * f * (f * (f - 2.0) + 1.0); }
fn hermite2(f: vec2f) -> vec2f { return f * f * (3.0 - 2.0 * f); }
fn hermite3(f: vec3f) -> vec3f { return f * f * (3.0 - 2.0 * f); }

// --- value noise ----------------------------------------------------------------------------------

fn valueNoise2(p: vec2f) -> f32 {
    let i = vec2i(floor(p));
    let f = fract(p);
    let u = quintic2(f);
    let a = ihash21(i);
    let b = ihash21(i + vec2i(1, 0));
    let c = ihash21(i + vec2i(0, 1));
    let d = ihash21(i + vec2i(1, 1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn valueNoise3(p: vec3f) -> f32 {
    let i = vec3i(floor(p));
    let f = fract(p);
    let u = quintic3(f);
    let n000 = ihash31(i);
    let n100 = ihash31(i + vec3i(1, 0, 0));
    let n010 = ihash31(i + vec3i(0, 1, 0));
    let n110 = ihash31(i + vec3i(1, 1, 0));
    let n001 = ihash31(i + vec3i(0, 0, 1));
    let n101 = ihash31(i + vec3i(1, 0, 1));
    let n011 = ihash31(i + vec3i(0, 1, 1));
    let n111 = ihash31(i + vec3i(1, 1, 1));
    let x00 = mix(n000, n100, u.x);
    let x10 = mix(n010, n110, u.x);
    let x01 = mix(n001, n101, u.x);
    let x11 = mix(n011, n111, u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// value noise with analytic derivatives: (value, d/dx, d/dy), value in [0, 1]
fn valueNoiseD2(p: vec2f) -> vec3f {
    let i = vec2i(floor(p));
    let f = fract(p);
    let u = quintic2(f);
    let du = quinticDeriv2(f);
    let a = ihash21(i);
    let b = ihash21(i + vec2i(1, 0));
    let c = ihash21(i + vec2i(0, 1));
    let d = ihash21(i + vec2i(1, 1));
    let k0 = a;
    let k1 = b - a;
    let k2 = c - a;
    let k4 = a - b - c + d;
    let v = k0 + k1 * u.x + k2 * u.y + k4 * u.x * u.y;
    let dv = du * vec2f(k1 + k4 * u.y, k2 + k4 * u.x);
    return vec3f(v, dv);
}

// --- gradient (Perlin) noise ------------------------------------------------------------------

fn grad2(i: vec2i) -> vec2f {
    let a = ihash21(i) * TAU;
    return vec2f(cos(a), sin(a));
}

fn grad3(i: vec3i) -> vec3f {
    let h = ihash33(i);
    return normalize(h * 2.0 - 1.0 + vec3f(1e-4));
}

// returns roughly [-1, 1]
fn perlin2(p: vec2f) -> f32 {
    let i = vec2i(floor(p));
    let f = fract(p);
    let u = quintic2(f);
    let ga = grad2(i);
    let gb = grad2(i + vec2i(1, 0));
    let gc = grad2(i + vec2i(0, 1));
    let gd = grad2(i + vec2i(1, 1));
    let va = dot(ga, f);
    let vb = dot(gb, f - vec2f(1.0, 0.0));
    let vc = dot(gc, f - vec2f(0.0, 1.0));
    let vd = dot(gd, f - vec2f(1.0, 1.0));
    return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * SQRT2;
}

// periodic Perlin noise: tiles every `period` cells (for seamless textures and looping animation)
fn perlinPeriodic2(p: vec2f, period: vec2f) -> f32 {
    let pi = floor(p);
    let f = fract(p);
    let u = quintic2(f);
    let per = vec2i(period);
    let i0 = vec2i(fmod2(pi, period));
    let i1 = vec2i(fmod2(pi + 1.0, period));
    let ga = grad2(vec2i(i0.x, i0.y));
    let gb = grad2(vec2i(i1.x, i0.y));
    let gc = grad2(vec2i(i0.x, i1.y));
    let gd = grad2(vec2i(i1.x, i1.y));
    let va = dot(ga, f);
    let vb = dot(gb, f - vec2f(1.0, 0.0));
    let vc = dot(gc, f - vec2f(0.0, 1.0));
    let vd = dot(gd, f - vec2f(1.0, 1.0));
    _ = per;
    return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * SQRT2;
}

fn perlin3(p: vec3f) -> f32 {
    let i = vec3i(floor(p));
    let f = fract(p);
    let u = quintic3(f);
    let n000 = dot(grad3(i), f);
    let n100 = dot(grad3(i + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
    let n010 = dot(grad3(i + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
    let n110 = dot(grad3(i + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
    let n001 = dot(grad3(i + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
    let n101 = dot(grad3(i + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
    let n011 = dot(grad3(i + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
    let n111 = dot(grad3(i + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
    let x00 = mix(n000, n100, u.x);
    let x10 = mix(n010, n110, u.x);
    let x01 = mix(n001, n101, u.x);
    let x11 = mix(n011, n111, u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z) * 1.1547;
}

// --- simplex noise (after Ashima Arts / Stefan Gustavson, MIT) --------------------------------------

fn permute3(x: vec3f) -> vec3f { return fmod3(((x * 34.0) + 10.0) * x, vec3f(289.0)); }
fn permute4(x: vec4f) -> vec4f { return (((x * 34.0) + 10.0) * x) - floor((((x * 34.0) + 10.0) * x) / 289.0) * 289.0; }
fn taylorInvSqrt4(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }
fn mod289_2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289_3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289_4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }

fn simplex2(v: vec2f) -> f32 {
    let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    var i = floor(v + dot(v, C.yy));
    let x0 = v - i + dot(i, C.xx);
    let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
    let x12a = x0.xyxy + C.xxzz;
    let x12 = vec4f(x12a.xy - i1, x12a.zw);
    i = mod289_2(i);
    let p = permute3(permute3(i.y + vec3f(0.0, i1.y, 1.0)) + i.x + vec3f(0.0, i1.x, 1.0));
    var m = max(0.5 - vec3f(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
    m = m * m;
    m = m * m;
    let x = 2.0 * fract(p * C.www) - 1.0;
    let h = abs(x) - 0.5;
    let ox = floor(x + 0.5);
    let a0 = x - ox;
    m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));
    let g = vec3f(a0.x * x0.x + h.x * x0.y, a0.y * x12.x + h.y * x12.y, a0.z * x12.z + h.z * x12.w);
    return 130.0 * dot(m, g);
}

fn simplex3(v: vec3f) -> f32 {
    let C = vec2f(1.0 / 6.0, 1.0 / 3.0);
    let D = vec4f(0.0, 0.5, 1.0, 2.0);
    var i = floor(v + dot(v, C.yyy));
    let x0 = v - i + dot(i, C.xxx);
    let g = step(x0.yzx, x0.xyz);
    let l = 1.0 - g;
    let i1 = min(g.xyz, l.zxy);
    let i2 = max(g.xyz, l.zxy);
    let x1 = x0 - i1 + C.xxx;
    let x2 = x0 - i2 + C.yyy;
    let x3 = x0 - D.yyy;
    i = mod289_3(i);
    let p = permute4(permute4(permute4(i.z + vec4f(0.0, i1.z, i2.z, 1.0)) + i.y + vec4f(0.0, i1.y, i2.y, 1.0)) + i.x + vec4f(0.0, i1.x, i2.x, 1.0));
    let n_ = 0.142857142857;
    let ns = n_ * D.wyz - D.xzx;
    let j = p - 49.0 * floor(p * ns.z * ns.z);
    let x_ = floor(j * ns.z);
    let y_ = floor(j - 7.0 * x_);
    let x = x_ * ns.x + ns.yyyy;
    let y = y_ * ns.x + ns.yyyy;
    let h = 1.0 - abs(x) - abs(y);
    let b0 = vec4f(x.xy, y.xy);
    let b1 = vec4f(x.zw, y.zw);
    let s0 = floor(b0) * 2.0 + 1.0;
    let s1 = floor(b1) * 2.0 + 1.0;
    let sh = -step(h, vec4f(0.0));
    let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    let a1 = b1.xzyw + s1.xzyw * sh.zzww;
    var p0 = vec3f(a0.xy, h.x);
    var p1 = vec3f(a0.zw, h.y);
    var p2 = vec3f(a1.xy, h.z);
    var p3 = vec3f(a1.zw, h.w);
    let norm = taylorInvSqrt4(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 = p0 * norm.x;
    p1 = p1 * norm.y;
    p2 = p2 * norm.z;
    p3 = p3 * norm.w;
    var m = max(0.5 - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4f(0.0));
    m = m * m;
    return 105.0 * dot(m * m, vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// 3D simplex noise with its analytic gradient: returns (gradient.xyz, value)
fn simplexGrad3(v: vec3f) -> vec4f {
    let C = vec2f(1.0 / 6.0, 1.0 / 3.0);
    let D = vec4f(0.0, 0.5, 1.0, 2.0);
    var i = floor(v + dot(v, C.yyy));
    let x0 = v - i + dot(i, C.xxx);
    let g = step(x0.yzx, x0.xyz);
    let l = 1.0 - g;
    let i1 = min(g.xyz, l.zxy);
    let i2 = max(g.xyz, l.zxy);
    let x1 = x0 - i1 + C.xxx;
    let x2 = x0 - i2 + C.yyy;
    let x3 = x0 - D.yyy;
    i = mod289_3(i);
    let p = permute4(permute4(permute4(i.z + vec4f(0.0, i1.z, i2.z, 1.0)) + i.y + vec4f(0.0, i1.y, i2.y, 1.0)) + i.x + vec4f(0.0, i1.x, i2.x, 1.0));
    let n_ = 0.142857142857;
    let ns = n_ * D.wyz - D.xzx;
    let j = p - 49.0 * floor(p * ns.z * ns.z);
    let x_ = floor(j * ns.z);
    let y_ = floor(j - 7.0 * x_);
    let x = x_ * ns.x + ns.yyyy;
    let y = y_ * ns.x + ns.yyyy;
    let h = 1.0 - abs(x) - abs(y);
    let b0 = vec4f(x.xy, y.xy);
    let b1 = vec4f(x.zw, y.zw);
    let s0 = floor(b0) * 2.0 + 1.0;
    let s1 = floor(b1) * 2.0 + 1.0;
    let sh = -step(h, vec4f(0.0));
    let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    let a1 = b1.xzyw + s1.xzyw * sh.zzww;
    var p0 = vec3f(a0.xy, h.x);
    var p1 = vec3f(a0.zw, h.y);
    var p2 = vec3f(a1.xy, h.z);
    var p3 = vec3f(a1.zw, h.w);
    let norm = taylorInvSqrt4(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 = p0 * norm.x;
    p1 = p1 * norm.y;
    p2 = p2 * norm.z;
    p3 = p3 * norm.w;
    let m = max(0.6 - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4f(0.0));
    let m2 = m * m;
    let m4 = m2 * m2;
    let pdotx = vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
    let temp = m2 * m * pdotx;
    var grad = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
    grad = grad + m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
    return 42.0 * vec4f(grad, dot(m4, pdotx));
}

fn simplex4(v: vec4f) -> f32 {
    let C = vec4f(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
    let F4 = 0.309016994374947451;
    var i = floor(v + dot(v, vec4f(F4)));
    let x0 = v - i + dot(i, C.xxxx);
    var i0: vec4f;
    let isX = step(x0.yzw, x0.xxx);
    let isYZ = step(x0.zww, x0.yyz);
    i0.x = isX.x + isX.y + isX.z;
    let yzw = 1.0 - isX;
    i0.y = yzw.x + isYZ.x + isYZ.y;
    i0.z = yzw.y + (1.0 - isYZ.x) + isYZ.z;
    i0.w = yzw.z + (1.0 - isYZ.y) + (1.0 - isYZ.z);
    let i3 = clamp(i0, vec4f(0.0), vec4f(1.0));
    let i2 = clamp(i0 - 1.0, vec4f(0.0), vec4f(1.0));
    let i1 = clamp(i0 - 2.0, vec4f(0.0), vec4f(1.0));
    let x1 = x0 - i1 + C.xxxx;
    let x2 = x0 - i2 + C.yyyy;
    let x3 = x0 - i3 + C.zzzz;
    let x4 = x0 + C.wwww;
    i = mod289_4(i);
    let j0 = permute4(permute4(permute4(permute4(vec4f(i.w)) + i.z) + i.y) + i.x).x;
    let j1 = permute4(permute4(permute4(permute4(i.w + vec4f(i1.w, i2.w, i3.w, 1.0)) + i.z + vec4f(i1.z, i2.z, i3.z, 1.0)) + i.y + vec4f(i1.y, i2.y, i3.y, 1.0)) + i.x + vec4f(i1.x, i2.x, i3.x, 1.0));
    let ip = vec4f(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);
    var p0 = grad4(j0, ip);
    var p1 = grad4(j1.x, ip);
    var p2 = grad4(j1.y, ip);
    var p3 = grad4(j1.z, ip);
    var p4 = grad4(j1.w, ip);
    let norm = taylorInvSqrt4(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 = p0 * norm.x;
    p1 = p1 * norm.y;
    p2 = p2 * norm.z;
    p3 = p3 * norm.w;
    p4 = p4 * (1.79284291400159 - 0.85373472095314 * dot(p4, p4));
    var m0 = max(0.6 - vec3f(dot(x0, x0), dot(x1, x1), dot(x2, x2)), vec3f(0.0));
    var m1 = max(0.6 - vec2f(dot(x3, x3), dot(x4, x4)), vec2f(0.0));
    m0 = m0 * m0;
    m1 = m1 * m1;
    return 49.0 * (dot(m0 * m0, vec3f(dot(p0, x0), dot(p1, x1), dot(p2, x2))) + dot(m1 * m1, vec2f(dot(p3, x3), dot(p4, x4))));
}

fn grad4(j: f32, ip: vec4f) -> vec4f {
    let ones = vec4f(1.0, 1.0, 1.0, -1.0);
    var p: vec4f;
    let pxyz = floor(fract(vec3f(j) * ip.xyz) * 7.0) * ip.z - 1.0;
    let pw = 1.5 - dot(abs(pxyz), ones.xyz);
    p = vec4f(pxyz, pw);
    let s = select(vec4f(0.0), vec4f(1.0), p < vec4f(0.0));
    let xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
    return vec4f(xyz, pw);
}

// --- cellular noise ----------------------------------------------------------------------------

struct Cell2 {
    f1: f32,        // distance to the nearest feature point
    f2: f32,        // distance to the second nearest
    id: vec2f,      // a random id of the nearest cell, in [0, 1)
    edge: f32,      // distance to the nearest cell border (exact, two-pass)
    nearest: vec2f, // offset from p to the nearest feature point
}

fn worley2(p: vec2f, jitter: f32) -> Cell2 {
    let n = floor(p);
    let f = fract(p);
    var f1 = 8.0;
    var f2 = 8.0;
    var mr = vec2f(0.0);
    var mg = vec2f(0.0);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let g = vec2f(f32(i), f32(j));
            let o = ihash22(vec2i(n + g)) * jitter + 0.5 * (1.0 - jitter);
            let r = g + o - f;
            let d = dot(r, r);
            if (d < f1) {
                f2 = f1;
                f1 = d;
                mr = r;
                mg = g;
            } else if (d < f2) {
                f2 = d;
            }
        }
    }
    // second pass: distance to the border between the nearest cell and its neighbours
    var md = 8.0;
    for (var j = -2; j <= 2; j++) {
        for (var i = -2; i <= 2; i++) {
            let g = mg + vec2f(f32(i), f32(j));
            let o = ihash22(vec2i(n + g)) * jitter + 0.5 * (1.0 - jitter);
            let r = g + o - f;
            if (dot(mr - r, mr - r) > 0.00001) {
                md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
            }
        }
    }
    var c: Cell2;
    c.f1 = sqrt(f1);
    c.f2 = sqrt(f2);
    c.id = ihash22(vec2i(n + mg) + vec2i(17, 59));
    c.edge = md;
    c.nearest = mr;
    return c;
}

fn worley3(p: vec3f, jitter: f32) -> vec2f {
    let n = floor(p);
    let f = fract(p);
    var f1 = 8.0;
    var f2 = 8.0;
    for (var k = -1; k <= 1; k++) {
        for (var j = -1; j <= 1; j++) {
            for (var i = -1; i <= 1; i++) {
                let g = vec3f(f32(i), f32(j), f32(k));
                let o = ihash33(vec3i(n + g)) * jitter + 0.5 * (1.0 - jitter);
                let r = g + o - f;
                let d = dot(r, r);
                if (d < f1) {
                    f2 = f1;
                    f1 = d;
                } else if (d < f2) {
                    f2 = d;
                }
            }
        }
    }
    return sqrt(vec2f(f1, f2));
}

// cheap crackle: 1 at cell borders (cracked ground, shattered glass, cell lines)
fn crackle2(p: vec2f, width: f32) -> f32 {
    let c = worley2(p, 1.0);
    return 1.0 - smoothstep(0.0, width, c.edge);
}

// smooth voronoi (iq): a blobby cellular field without hard creases
fn smoothVoronoi2(p: vec2f, k: f32) -> f32 {
    let n = floor(p);
    let f = fract(p);
    var res = 0.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let g = vec2f(f32(i), f32(j));
            let o = ihash22(vec2i(n + g));
            let r = g - f + o;
            let d = dot(r, r);
            res = res + exp2(-k * d);
        }
    }
    return -(1.0 / k) * log2(res);
}

// --- fractal sums ----------------------------------------------------------------------------------

const FBM_ROT2: mat2x2f = mat2x2f(0.80, 0.60, -0.60, 0.80);
const FBM_ROT3: mat3x3f = mat3x3f(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

fn fbm2(p0: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var p = p0;
    var a = 0.5;
    var sum = 0.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        sum = sum + a * simplex2(p);
        norm = norm + a;
        p = FBM_ROT2 * p * lacunarity + vec2f(17.13, -3.71);
        a = a * gain;
    }
    return sum / norm;
}

fn fbm3(p0: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var p = p0;
    var a = 0.5;
    var sum = 0.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        sum = sum + a * simplex3(p);
        norm = norm + a;
        p = FBM_ROT3 * p * lacunarity + vec3f(5.2, 1.3, -7.7);
        a = a * gain;
    }
    return sum / norm;
}

// value-noise fbm in [0, 1]: cheap, used for clouds, wash variation and dissolves
fn vfbm2(p0: vec2f, octaves: i32) -> f32 {
    var p = p0;
    var a = 0.5;
    var sum = 0.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        sum = sum + a * valueNoise2(p);
        norm = norm + a;
        p = FBM_ROT2 * p * 2.03 + vec2f(1.7, 9.2);
        a = a * 0.5;
    }
    return sum / norm;
}

fn vfbm3(p0: vec3f, octaves: i32) -> f32 {
    var p = p0;
    var a = 0.5;
    var sum = 0.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        sum = sum + a * valueNoise3(p);
        norm = norm + a;
        p = FBM_ROT3 * p * 2.01 + vec3f(3.1, -1.7, 8.3);
        a = a * 0.5;
    }
    return sum / norm;
}

// ridged multifractal (Musgrave): sharp crests, for lightning-like veins, mountains, cracks
fn ridged2(p0: vec2f, octaves: i32, lacunarity: f32, gain: f32, offset: f32) -> f32 {
    var p = p0;
    var sum = 0.0;
    var freqAmp = 0.5;
    var prev = 1.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        var n = offset - abs(simplex2(p));
        n = n * n;
        sum = sum + n * freqAmp * prev;
        norm = norm + freqAmp;
        prev = n;
        p = FBM_ROT2 * p * lacunarity;
        freqAmp = freqAmp * gain;
    }
    return sum / norm;
}

fn ridged3(p0: vec3f, octaves: i32, lacunarity: f32, gain: f32, offset: f32) -> f32 {
    var p = p0;
    var sum = 0.0;
    var freqAmp = 0.5;
    var prev = 1.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        var n = offset - abs(simplex3(p));
        n = n * n;
        sum = sum + n * freqAmp * prev;
        norm = norm + freqAmp;
        prev = n;
        p = FBM_ROT3 * p * lacunarity;
        freqAmp = freqAmp * gain;
    }
    return sum / norm;
}

fn billow2(p0: vec2f, octaves: i32) -> f32 {
    var p = p0;
    var a = 0.5;
    var sum = 0.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        sum = sum + a * (abs(simplex2(p)) * 2.0 - 1.0);
        norm = norm + a;
        p = FBM_ROT2 * p * 2.0;
        a = a * 0.5;
    }
    return sum / norm;
}

fn turbulence3(p0: vec3f, octaves: i32) -> f32 {
    var p = p0;
    var a = 0.5;
    var sum = 0.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        sum = sum + a * abs(simplex3(p));
        norm = norm + a;
        p = FBM_ROT3 * p * 2.0;
        a = a * 0.5;
    }
    return sum / norm;
}

// fbm whose octaves are damped where the slope is steep (iq): erosion-like terrain, smoke edges
fn erosionFbm2(p0: vec2f, octaves: i32) -> f32 {
    var p = p0;
    var a = 0.0;
    var b = 1.0;
    var d = vec2f(0.0);
    for (var i = 0; i < octaves; i++) {
        let n = valueNoiseD2(p);
        d = d + n.yz;
        a = a + b * n.x / (1.0 + dot(d, d));
        b = b * 0.5;
        p = FBM_ROT2 * p * 2.0;
    }
    return a;
}

// --- domain warping (iq) -------------------------------------------------------------------------------

fn warp2(p: vec2f, strength: f32, t: f32) -> vec2f {
    let q = vec2f(fbm2(p + vec2f(0.0, 0.0) + t * 0.1, 4, 2.0, 0.5), fbm2(p + vec2f(5.2, 1.3) - t * 0.08, 4, 2.0, 0.5));
    let r = vec2f(fbm2(p + 4.0 * q + vec2f(1.7, 9.2) + t * 0.15, 4, 2.0, 0.5), fbm2(p + 4.0 * q + vec2f(8.3, 2.8) - t * 0.12, 4, 2.0, 0.5));
    return p + strength * r;
}

fn warpedFbm2(p: vec2f, t: f32) -> f32 {
    return fbm2(warp2(p, 1.6, t), 5, 2.0, 0.5);
}

fn warp3(p: vec3f, strength: f32) -> vec3f {
    let q = vec3f(fbm3(p, 3, 2.0, 0.5), fbm3(p + vec3f(5.2, 1.3, 2.8), 3, 2.0, 0.5), fbm3(p + vec3f(1.7, 9.2, 4.4), 3, 2.0, 0.5));
    return p + strength * q;
}

// --- curl noise: divergence-free flow fields for smoke, embers, spirit wisps ---------------------------

fn curl2(p: vec2f) -> vec2f {
    let e = 0.01;
    let n1 = simplex2(p + vec2f(0.0, e));
    let n2 = simplex2(p - vec2f(0.0, e));
    let n3 = simplex2(p + vec2f(e, 0.0));
    let n4 = simplex2(p - vec2f(e, 0.0));
    return vec2f(n1 - n2, -(n3 - n4)) / (2.0 * e);
}

// Bridson's curl of a vector potential built from three offset simplex gradients
fn curl3(p: vec3f) -> vec3f {
    let a = simplexGrad3(p).xyz;
    let b = simplexGrad3(p + vec3f(31.416, -47.853, 12.793)).xyz;
    let c = simplexGrad3(p + vec3f(-233.145, -113.408, -185.31)).xyz;
    return vec3f(c.y - b.z, a.z - c.x, b.x - a.y);
}

// flow noise (Perlin & Neyret): rotating gradients give swirling, non-sliding motion
fn flowNoise2(p: vec2f, angle: f32) -> f32 {
    let i = vec2i(floor(p));
    let f = fract(p);
    let u = quintic2(f);
    let ca = cos(angle);
    let sa = sin(angle);
    var g: array<vec2f, 4>;
    let offs = array<vec2i, 4>(vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(1, 1));
    for (var k = 0; k < 4; k++) {
        let base = grad2(i + offs[k]);
        let dir = select(-1.0, 1.0, ihash21(i + offs[k] + vec2i(91, 7)) > 0.5);
        let s = sa * dir;
        g[k] = vec2f(base.x * ca - base.y * s, base.x * s + base.y * ca);
    }
    let va = dot(g[0], f);
    let vb = dot(g[1], f - vec2f(1.0, 0.0));
    let vc = dot(g[2], f - vec2f(0.0, 1.0));
    let vd = dot(g[3], f - vec2f(1.0, 1.0));
    return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * SQRT2;
}

// --- texture-like noises ------------------------------------------------------------------------------------

// fibrous paper / brush grain: stretched value noise along a direction
fn fiberNoise(p: vec2f, dir: vec2f, stretch: f32) -> f32 {
    let d = normalize(dir);
    let q = vec2f(dot(p, d) / stretch, dot(p, vec2f(-d.y, d.x)));
    return vfbm2(q * 3.0, 3);
}

// brush-stroke mask: streaks with ragged dry-brush ends, for washes and sumi-e ink effects
fn brushStroke(p: vec2f, dir: vec2f, density: f32, dryness: f32) -> f32 {
    let d = normalize(dir);
    let along = dot(p, d);
    let across = dot(p, vec2f(-d.y, d.x));
    let fibers = valueNoise2(vec2f(along * 0.6, across * density));
    let gaps = valueNoise2(vec2f(along * 4.0, across * density * 3.0));
    return smoothstep(dryness, dryness + 0.25, fibers * 0.7 + gaps * 0.3);
}

// sparkle field for glints (water, snow, magic): mostly 0, sharp random spikes
fn sparkle3(p: vec3f, density: f32, sharpness: f32) -> f32 {
    let c = floor(p * density);
    let h = ihash33(vec3i(c));
    let f = fract(p * density) - h;
    let d = length(f - 0.5);
    return pow(max(1.0 - d * 2.0, 0.0), sharpness) * step(0.85, h.z);
}
