// tbCommon — constants and small helpers used everywhere.

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;
const INV_PI: f32 = 0.318309886183791;

fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn saturate3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.0), vec3f(1.0)); }
fn remap(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + (d - c) * (x - a) / (b - a); }
fn remapc(x: f32, a: f32, b: f32) -> f32 { return saturate((x - a) / (b - a)); }
fn sq(x: f32) -> f32 { return x * x; }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn max3(v: vec3f) -> f32 { return max(v.x, max(v.y, v.z)); }
fn min3(v: vec3f) -> f32 { return min(v.x, min(v.y, v.z)); }

// smooth minimum / maximum (polynomial)
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }

// antialiased step for a signed distance `d` whose screen-space footprint is `w` (fwidth)
fn aastep(d: f32, w: f32) -> f32 { return saturate(0.5 - d / max(w, 1e-6)); }

fn rot2(a: f32) -> mat2x2f {
  let c = cos(a);
  let s = sin(a);
  return mat2x2f(c, s, -s, c);
}

// colour spaces -------------------------------------------------------------------------------------
fn srgbToLinear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
fn linearToSrgb(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

fn rgb2hsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4f(c.gb, K.xy), vec4f(c.bg, K.wz), c.g < c.b);
  let q = select(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), c.r < p.x);
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, saturate3(p - K.xxx), c.y);
}

// Oklab (perceptual mixing for gradients and grading)
fn linToOklab(c: vec3f) -> vec3f {
  let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  let l_ = pow(max(l, 0.0), 1.0 / 3.0);
  let m_ = pow(max(m, 0.0), 1.0 / 3.0);
  let s_ = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3f(0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
               1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
               0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_);
}
fn oklabToLin(c: vec3f) -> vec3f {
  let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return vec3f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
               -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
               -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
fn mixOklab(a: vec3f, b: vec3f, t: f32) -> vec3f { return oklabToLin(mix(linToOklab(a), linToOklab(b), t)); }

fn saturateColor(c: vec3f, s: f32) -> vec3f {
  let l = luma(c);
  return max(mix(vec3f(l), c, s), vec3f(0.0));
}

// normal packing (octahedral) -----------------------------------------------------------------------
fn octWrap(v: vec2f) -> vec2f { return (1.0 - abs(v.yx)) * select(vec2f(-1.0), vec2f(1.0), v >= vec2f(0.0)); }
fn encodeNormal(n: vec3f) -> vec2f {
  var p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.z < 0.0) { p = octWrap(p); }
  return p * 0.5 + 0.5;
}
fn decodeNormal(e: vec2f) -> vec3f {
  let f = e * 2.0 - 1.0;
  var n = vec3f(f, 1.0 - abs(f.x) - abs(f.y));
  let t = saturate(-n.z);
  n = vec3f(n.xy + select(vec2f(t), vec2f(-t), n.xy >= vec2f(0.0)), n.z);
  return normalize(n);
}

// Ordered dither used to break up banding in gradients
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
