// tbBilateral — separable depth-aware blur for the half-resolution AO (r: obscurance, g: contact,
// b: view depth carried along). Taps across a depth discontinuity are rejected so the blur never bleeds
// a character's occlusion onto the wall behind them.
#include<tbCommon>
varying vUV: vec2f;
var srcSampler: sampler;
var src: texture_2d<f32>;
uniform dir: vec4f;    // xy step in uv, z depth sharpness, w unused

const W: array<f32, 5> = array<f32, 5>(0.2270270, 0.1945946, 0.1216216, 0.0540540, 0.0162162);

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let c = textureSampleLevel(src, srcSampler, uv, 0.0);
  let z0 = c.z;
  if (z0 <= 0.0) {
    fragmentOutputs.color = c;
    return fragmentOutputs;
  }
  var acc = c.xy * W[0];
  var wsum = W[0];
  for (var i = 1; i < 5; i++) {
    for (var s = -1; s <= 1; s += 2) {
      let o = uniforms.dir.xy * f32(i * s) * 1.5;
      let t = textureSampleLevel(src, srcSampler, uv + o, 0.0);
      let dz = abs(t.z - z0) / max(z0, 0.1);
      let w = W[i] * exp(-dz * dz * uniforms.dir.z) * select(1.0, 0.0, t.z <= 0.0);
      acc = acc + t.xy * w;
      wsum = wsum + w;
    }
  }
  fragmentOutputs.color = vec4f(acc / max(wsum, 1e-4), z0, 1.0);
}
