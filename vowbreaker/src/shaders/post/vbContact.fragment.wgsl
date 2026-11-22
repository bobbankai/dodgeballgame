// Screen-space contact shadows (vb_sslight), half resolution: r = 1 lit .. 0 in a contact shadow.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_math>
#include<vb_sslight>

varying vUV: vec2f;

var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform projParams: vec4f;
uniform lightView: vec3f;       // the sun's direction in view space
uniform contactParams: vec4f;   // ray length (m), thickness (m), frame, -

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let jitter = interleavedGradientNoiseAnimated(fragmentInputs.position.xy, uniforms.contactParams.z);
    let s = sslContactShadow(gbuffer, gbufferSampler, fragmentInputs.vUV, uniforms.projParams, normalize(uniforms.lightView),
                             uniforms.contactParams.x, uniforms.contactParams.y, jitter);
    fragmentOutputs.color = vec4f(s, s, s, 1.0);
}
