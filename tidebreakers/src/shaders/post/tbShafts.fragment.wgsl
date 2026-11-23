// tbShafts — screen-space light shafts (crepuscular rays) at quarter resolution. Bright sky pixels near the
// sun are marched toward the sun's screen position; geometry (anything with depth) blocks them, so
// clouds of masts, columns and cliffs cut the light into rays. Strength fades as the sun leaves the screen.
#include<tbGlobals>
#include<tbCommon>
varying vUV: vec2f;
var colorTexSampler: sampler;
var colorTex: texture_2d<f32>;
var gbufTexSampler: sampler;
var gbufTex: texture_2d<f32>;
uniform sun: vec4f;     // xy sun position (uv), z on-screen fade, w strength
uniform shaftC: vec4f;  // rgb tint, w decay

const STEPS: i32 = 40;

fn skyMask(uv: vec2f) -> f32 {
  let z = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0).z;
  if (z > 0.0) { return 0.0; }
  let c = textureSampleLevel(colorTex, colorTexSampler, uv, 0.0).rgb;
  return smoothstep(0.6, 1.6, luma(c));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let toSun = uniforms.sun.xy - uv;
  let dist = length(toSun * vec2f(globals.viewport.x / globals.viewport.y, 1.0));
  let stepv = toSun / f32(STEPS) * min(1.0, 0.85 / max(dist, 1e-3));
  var p = uv + stepv * ign(input.position.xy);
  var illum = 0.0;
  var decay = 1.0;
  for (var i = 0; i < STEPS; i++) {
    if (any(p < vec2f(0.0)) || any(p > vec2f(1.0))) { break; }
    illum = illum + skyMask(p) * decay;
    decay = decay * uniforms.shaftC.w;
    p = p + stepv;
  }
  let falloff = 1.0 - smoothstep(0.0, 0.9, dist);
  let s = illum / f32(STEPS) * falloff * uniforms.sun.z * uniforms.sun.w;
  fragmentOutputs.color = vec4f(uniforms.shaftC.rgb * s, 1.0);
}
