// tbNoise — hashes, value / gradient / simplex noise, fbm, ridged, voronoi, curl. Deterministic (no textures).

fn hash11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x = x * (x + 33.33);
  x = x * (x + x);
  return fract(x);
}
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash13(p: vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 = p3 + dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
fn hash33(p: vec3f) -> vec3f {
  var p3 = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// value noise ---------------------------------------------------------------------------------------
fn vnoise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i);
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i);
  let n100 = hash13(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3f(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

// gradient noise (Perlin-like, -1..1) ----------------------------------------------------------------
fn gnoise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let ga = hash22(i) * 2.0 - 1.0;
  let gb = hash22(i + vec2f(1.0, 0.0)) * 2.0 - 1.0;
  let gc = hash22(i + vec2f(0.0, 1.0)) * 2.0 - 1.0;
  let gd = hash22(i + vec2f(1.0, 1.0)) * 2.0 - 1.0;
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * 1.4;
}
fn gnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var acc = array<f32, 8>();
  for (var k = 0; k < 8; k++) {
    let o = vec3f(f32(k & 1), f32((k >> 1) & 1), f32((k >> 2) & 1));
    let g = hash33(i + o) * 2.0 - 1.0;
    acc[k] = dot(g, f - o);
  }
  return mix(mix(mix(acc[0], acc[1], u.x), mix(acc[2], acc[3], u.x), u.y), mix(mix(acc[4], acc[5], u.x), mix(acc[6], acc[7], u.x), u.y), u.z) * 1.2;
}

// 2D simplex noise (-1..1) ----------------------------------------------------------------------------
fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289v2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute3(x: vec3f) -> vec3f { return mod289v3(((x * 34.0) + 1.0) * x); }
fn snoise2(v: vec2f) -> f32 {
  let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  var i = floor(v + dot(v, C.yy));
  let x0 = v - i + dot(i, C.xx);
  let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
  var x12 = x0.xyxy + C.xxzz;
  x12 = vec4f(x12.xy - i1, x12.zw);
  i = mod289v2(i);
  let p = permute3(permute3(i.y + vec3f(0.0, i1.y, 1.0)) + i.x + vec3f(0.0, i1.x, 1.0));
  var m = max(0.5 - vec3f(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
  m = m * m;
  m = m * m;
  let x = 2.0 * fract(p * C.www) - 1.0;
  let h = abs(x) - 0.5;
  let ox = floor(x + 0.5);
  let a0 = x - ox;
  m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));
  let g = vec3f(a0.x * x0.x + h.x * x0.y, a0.yz * x12.xz + h.yz * x12.yw);
  return 130.0 * dot(m, g);
}

// fractal sums --------------------------------------------------------------------------------------
fn fbm2(p: vec2f, oct: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < oct; i++) {
    s = s + a * gnoise2(q);
    q = rot2(0.6) * q * 2.03 + vec2f(1.7, 9.2);
    a = a * 0.5;
  }
  return s;
}
fn fbm3(p: vec3f, oct: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < oct; i++) {
    s = s + a * gnoise3(q);
    q = q * 2.02 + vec3f(3.1, 1.7, 5.3);
    a = a * 0.5;
  }
  return s;
}
fn ridged2(p: vec2f, oct: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  var prev = 1.0;
  for (var i = 0; i < oct; i++) {
    let n = 1.0 - abs(gnoise2(q));
    s = s + a * n * n * prev;
    prev = n;
    q = rot2(0.5) * q * 2.1;
    a = a * 0.5;
  }
  return s;
}

// voronoi: x = distance to nearest cell point, y = distance to second, z = cell id hash ------------------
fn voronoi2(p: vec2f) -> vec3f {
  let n = floor(p);
  let f = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  var id = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = hash22(n + g);
      let r = g + o - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hash12(n + g); } else if (d < d2) { d2 = d; }
    }
  }
  return vec3f(sqrt(d1), sqrt(d2), id);
}
fn voronoi3(p: vec3f) -> vec2f {
  let n = floor(p);
  let f = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  for (var k = -1; k <= 1; k++) {
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let g = vec3f(f32(i), f32(j), f32(k));
        let r = g + hash33(n + g) - f;
        let d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    }
  }
  return vec2f(sqrt(d1), sqrt(d2));
}

// curl of a 2D noise potential (swirling smoke, wind streaks)
fn curl2(p: vec2f) -> vec2f {
  let e = 0.01;
  let n1 = snoise2(p + vec2f(0.0, e));
  let n2 = snoise2(p - vec2f(0.0, e));
  let n3 = snoise2(p + vec2f(e, 0.0));
  let n4 = snoise2(p - vec2f(e, 0.0));
  return vec2f(n1 - n2, -(n3 - n4)) / (2.0 * e);
}

// domain-warped fbm (painterly cloud / marble / flow patterns)
fn warpFbm2(p: vec2f, t: f32) -> f32 {
  let q = vec2f(fbm2(p + vec2f(0.0, t * 0.1), 4), fbm2(p + vec2f(5.2, 1.3 - t * 0.1), 4));
  return fbm2(p + 1.8 * q, 4);
}
