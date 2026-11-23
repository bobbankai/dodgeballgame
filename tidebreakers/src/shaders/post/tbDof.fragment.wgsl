// tbDof — cinematic depth of field at half resolution for cutscene close-ups. Each pixel's circle of
// confusion comes from its distance to the focus plane; the colour is gathered over a golden-angle disc and
// each tap only counts if its own blur would reach this pixel (scatter-as-gather), so sharp foreground
// edges don't smear into a blurred background and blurred foreground still bleeds over focused subjects.
// Bright taps are weighted up a little to bloom into round bokeh highlights.
#include<tbGlobals>
#include<tbCommon>
varying vUV: vec2f;
var colorTexSampler: sampler;
var colorTex: texture_2d<f32>;
var gbufTexSampler: sampler;
var gbufTex: texture_2d<f32>;
uniform dof: vec4f;    // x focus distance, y focus range, z max radius (px, half res), w near blur scale
uniform texel: vec4f;  // xy 1 / half-res size

const TAPS: i32 = 28;
const GOLDEN: f32 = 2.39996323;

fn coc(z: f32) -> f32 {
  if (z <= 0.0) { return 1.0; }             // sky: fully out of focus
  let d = z - uniforms.dof.x;
  let far = saturate(d / max(uniforms.dof.y, 0.01));
  let near = saturate(-d / max(uniforms.dof.y * 0.5, 0.01)) * uniforms.dof.w;
  return max(far, near);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let z = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0).z;
  let c0 = coc(z);
  let maxR = uniforms.dof.z;
  var acc = textureSampleLevel(colorTex, colorTexSampler, uv, 0.0).rgb;
  var wsum = 1.0;
  for (var i = 0; i < TAPS; i++) {
    let fi = f32(i) + 0.5;
    let r = sqrt(fi / f32(TAPS));
    let a = fi * GOLDEN;
    let o = vec2f(cos(a), sin(a)) * r * maxR * uniforms.texel.xy;
    let suv = uv + o;
    let sz = textureSampleLevel(gbufTex, gbufTexSampler, suv, 0.0).z;
    let sc = coc(sz);
    // the tap contributes if its blur radius covers this pixel; behind-focus taps can't cover a sharper
    // nearer pixel
    let reach = select(min(sc, c0 + 0.2), sc, sz > 0.0 && sz < z);
    let w = smoothstep(r - 0.12, r + 0.05, reach);
    let col = textureSampleLevel(colorTex, colorTexSampler, suv, 0.0).rgb;
    let hl = 1.0 + smoothstep(1.0, 3.0, luma(col)) * 1.5;
    acc = acc + col * w * hl;
    wsum = wsum + w * hl;
  }
  fragmentOutputs.color = vec4f(acc / wsum, c0);
}
