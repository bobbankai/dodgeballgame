// One bounce of screen-space indirect light (vb_sslight), half resolution, rgb = bounce light.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_math>
#include<vb_sslight>

varying vUV: vec2f;

var sceneTex: texture_2d<f32>;
var sceneTexSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform projParams: vec4f;
uniform giParams: vec4f;        // radius (m), frame, -, -

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let rot = interleavedGradientNoiseAnimated(fragmentInputs.position.xy, uniforms.giParams.y) * 6.2831;
    let b = sslBounce(sceneTex, sceneTexSampler, gbuffer, gbufferSampler, fragmentInputs.vUV, uniforms.projParams, uniforms.giParams.x, rot);
    fragmentOutputs.color = vec4f(b, 1.0);
}
