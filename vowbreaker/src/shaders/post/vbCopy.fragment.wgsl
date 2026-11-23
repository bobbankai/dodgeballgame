// A plain copy (captures the snapshot a scene transition breaks away).
#define DISABLE_UNIFORMITY_ANALYSIS

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    fragmentOutputs.color = vec4f(textureSampleLevel(source, sourceSampler, fragmentInputs.vUV, 0.0).rgb, 1.0);
}
