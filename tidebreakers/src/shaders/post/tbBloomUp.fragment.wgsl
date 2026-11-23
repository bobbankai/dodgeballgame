// tbBloomUp — 9-tap tent upsample of the smaller level, added to this level's downsample.
varying vUV: vec2f;
var lowSampler: sampler;
var low: texture_2d<f32>;
var curSampler: sampler;
var cur: texture_2d<f32>;
uniform texel: vec4f;   // xy low-res texel, z radius, w this level's weight

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let t = uniforms.texel.xy * uniforms.texel.z;
  var u = textureSampleLevel(low, lowSampler, uv, 0.0).rgb * 4.0;
  u = u + (textureSampleLevel(low, lowSampler, uv + vec2f(-t.x, 0.0), 0.0).rgb + textureSampleLevel(low, lowSampler, uv + vec2f(t.x, 0.0), 0.0).rgb
         + textureSampleLevel(low, lowSampler, uv + vec2f(0.0, -t.y), 0.0).rgb + textureSampleLevel(low, lowSampler, uv + vec2f(0.0, t.y), 0.0).rgb) * 2.0;
  u = u + textureSampleLevel(low, lowSampler, uv - t, 0.0).rgb + textureSampleLevel(low, lowSampler, uv + t, 0.0).rgb
        + textureSampleLevel(low, lowSampler, uv + vec2f(t.x, -t.y), 0.0).rgb + textureSampleLevel(low, lowSampler, uv + vec2f(-t.x, t.y), 0.0).rgb;
  u = u / 16.0;
  let c = textureSampleLevel(cur, curSampler, uv, 0.0).rgb;
  fragmentOutputs.color = vec4f(c * uniforms.texel.w + u, 1.0);
}
