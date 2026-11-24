// tbShadow — two-cascade sun shadows with rotated Poisson PCF.
// Requires tbGlobals. Materials that receive shadows declare samplers "shadowTex0" and "shadowTex1"
// (r32float, light-space depth 0..1 written by tbShadowDepth).

var shadowTex0Sampler: sampler;
var shadowTex0: texture_2d<f32>;
var shadowTex1Sampler: sampler;
var shadowTex1: texture_2d<f32>;

const POISSON12 = array<vec2f, 12>(
  vec2f(-0.326, -0.406), vec2f(-0.840, -0.074), vec2f(-0.696, 0.457), vec2f(-0.203, 0.621),
  vec2f(0.962, -0.195), vec2f(0.473, -0.480), vec2f(0.519, 0.767), vec2f(0.185, -0.893),
  vec2f(0.507, 0.064), vec2f(0.896, 0.412), vec2f(-0.322, -0.933), vec2f(-0.792, -0.598)
);

fn shadowCoord(m: mat4x4f, wp: vec3f) -> vec3f {
  let c = m * vec4f(wp, 1.0);
  let ndc = c.xyz / c.w;
  return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z);
}

fn pcfTex0(uv: vec2f, z: f32, radius: f32, rot: f32) -> f32 {
  var lit = 0.0;
  let r = rot2(rot);
  for (var i = 0; i < 12; i++) {
    let o = r * POISSON12[i] * radius;
    let d = textureSampleLevel(shadowTex0, shadowTex0Sampler, uv + o, 0.0).r;
    lit = lit + select(0.0, 1.0, z <= d);
  }
  return lit / 12.0;
}
fn pcfTex1(uv: vec2f, z: f32, radius: f32, rot: f32) -> f32 {
  var lit = 0.0;
  let r = rot2(rot);
  for (var i = 0; i < 8; i++) {
    let o = r * POISSON12[i] * radius;
    let d = textureSampleLevel(shadowTex1, shadowTex1Sampler, uv + o, 0.0).r;
    lit = lit + select(0.0, 1.0, z <= d);
  }
  return lit / 8.0;
}

// Shadows of clouds passing over: soft, domain-warped blotches on a layer high above, projected along the
// sun so they slide over hills and walls the right way, drifting with the wind. Needs tbNoise.
fn cloudShadow(wp: vec3f) -> f32 {
  let amt = globals.shadowSplit.z;
  if (amt <= 0.0) { return 1.0; }
  let l = globals.sunDir.xyz;
  let layer = 160.0 - wp.y;
  let p = wp.xz + l.xz / max(l.y, 0.25) * layer;
  let drift = normalize(globals.wind.xy + vec2f(1e-3, 0.0)) * globals.time.x * (2.5 + globals.wind.z * 2.0);
  let q = (p - drift) * globals.shadowSplit.w;
  let w = vec2f(fbm2(q * 0.7 + vec2f(3.1, 1.7), 2), fbm2(q * 0.7 + vec2f(8.3, 2.8), 2));
  let c = fbm2(q + w * 1.2, 4);
  return 1.0 - amt * smoothstep(0.02, 0.22, c);
}

// Returns 1 lit .. 0 in shadow. `n` is the world normal (normal-offset biasing), `fragXY` screen position.
fn sunShadow(wp: vec3f, n: vec3f, fragXY: vec2f) -> f32 {
  return sunShadowMap(wp, n, fragXY) * cloudShadow(wp);
}

fn sunShadowMap(wp: vec3f, n: vec3f, fragXY: vec2f) -> f32 {
  if (globals.shadowParams.w <= 0.0) { return 1.0; }
  let ndl = dot(n, globals.sunDir.xyz);
  let off = wp + n * globals.shadowParams.z * (1.0 - saturate(ndl) * 0.6);
  let rot = ign(fragXY) * TAU;
  let c0 = shadowCoord(globals.shadowMat, off);
  let inside0 = all(c0.xy > vec2f(0.02)) && all(c0.xy < vec2f(0.98)) && c0.z < 1.0;
  let c1 = shadowCoord(globals.shadowMat1, off);
  let ts = globals.shadowParams.x;
  let bias = globals.shadowParams.y;
  let s1 = pcfTex1(c1.xy, c1.z - bias * 3.0, ts * 1.5, rot);
  var s = s1;
  if (inside0) {
    let s0 = pcfTex0(c0.xy, c0.z - bias, ts * 1.6, rot);
    let edge = max(abs(c0.x - 0.5), abs(c0.y - 0.5));
    s = mix(s0, s1, remapc(edge, 0.4, 0.48));
  }
  let outside1 = any(c1.xy < vec2f(0.0)) || any(c1.xy > vec2f(1.0)) || c1.z > 1.0;
  if (outside1 && !inside0) { s = 1.0; }
  return mix(1.0, s, globals.shadowParams.w);
}
