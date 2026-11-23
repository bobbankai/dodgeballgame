varying vUV: vec2f;
var colorTexSampler: sampler;
var colorTex: texture_2d<f32>;
var gbufTexSampler: sampler;
var gbufTex: texture_2d<f32>;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let c = textureSample(colorTex, colorTexSampler, input.vUV);
  let g = textureSample(gbufTex, gbufTexSampler, input.vUV);
  let edge = select(0.0, 1.0, input.vUV.x > 0.5);
  fragmentOutputs.color = vec4f(mix(c.rgb, g.rgb, edge), 1.0);
}
