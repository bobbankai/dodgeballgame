// tbBloomDown — 13-tap downsample (Jimenez 2014). On the first pass a soft-knee threshold picks
// what blooms; Karis averaging there stops single hot pixels (sparks) from flickering.
#include<tbCommon>
varying vUV: vec2f;
var srcSampler: sampler;
var src: texture_2d<f32>;
uniform texel: vec4f;     // xy source texel size, z first pass (threshold on), w threshold
uniform knee: vec4f;      // x soft knee, y clamp

fn s(uv: vec2f) -> vec3f { return textureSampleLevel(src, srcSampler, uv, 0.0).rgb; }
fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + luma(c)); }
fn thresh(c: vec3f) -> vec3f {
  let t = uniforms.texel.w;
  let k = uniforms.knee.x;
  let br = max3(c);
  var soft = br - t + k;
  soft = clamp(soft, 0.0, 2.0 * k);
  soft = soft * soft / (4.0 * k + 1e-5);
  let contrib = max(soft, br - t) / max(br, 1e-5);
  return min(c * contrib, vec3f(uniforms.knee.y));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let t = uniforms.texel.xy;
  let a = s(uv + t * vec2f(-2.0, -2.0)); let b = s(uv + t * vec2f(0.0, -2.0)); let c = s(uv + t * vec2f(2.0, -2.0));
  let d = s(uv + t * vec2f(-1.0, -1.0)); let e = s(uv + t * vec2f(1.0, -1.0));
  let f = s(uv + t * vec2f(-2.0, 0.0)); let g = s(uv); let h = s(uv + t * vec2f(2.0, 0.0));
  let i = s(uv + t * vec2f(-1.0, 1.0)); let j = s(uv + t * vec2f(1.0, 1.0));
  let k = s(uv + t * vec2f(-2.0, 2.0)); let l = s(uv + t * vec2f(0.0, 2.0)); let m = s(uv + t * vec2f(2.0, 2.0));
  var o = vec3f(0.0);
  if (uniforms.texel.z > 0.5) {
    let g0 = (d + e + i + j) * 0.25; let g1 = (a + b + f + g) * 0.25; let g2 = (b + c + g + h) * 0.25;
    let g3 = (f + g + k + l) * 0.25; let g4 = (g + h + l + m) * 0.25;
    let w0 = karis(g0) * 0.5; let w1 = karis(g1) * 0.125; let w2 = karis(g2) * 0.125; let w3 = karis(g3) * 0.125; let w4 = karis(g4) * 0.125;
    o = (thresh(g0) * w0 + thresh(g1) * w1 + thresh(g2) * w2 + thresh(g3) * w3 + thresh(g4) * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    o = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + g * 0.125;
  }
  fragmentOutputs.color = vec4f(o, 1.0);
}
