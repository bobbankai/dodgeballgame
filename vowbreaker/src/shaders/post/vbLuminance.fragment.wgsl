// Auto exposure, step 1: the log luminance of the scene into a small target, ignoring the sky
// (which would otherwise drag night scenes bright) and weighting the centre of the frame, where
// the fight is, more than the edges. Steps 2 and 3 (vbReduce, vbAdapt) average and adapt it.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_color>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform lumParams: vec4f;        // source texel x, y, centre weight, sky weight

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let t = uniforms.lumParams.xy;
    var acc = 0.0;
    var wsum = 0.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let suv = uv + vec2f(f32(i), f32(j)) * t * 4.0;
            let c = textureSampleLevel(source, sourceSampler, suv, 0.0).rgb;
            let z = textureSampleLevel(gbuffer, gbufferSampler, suv, 0.0).b;
            let sky = step(500.0, z);
            let w = mix(1.0, uniforms.lumParams.w, sky);
            acc = acc + log2(max(luma(c), 1e-4)) * w;
            wsum = wsum + w;
        }
    }
    let centre = 1.0 + uniforms.lumParams.z * (1.0 - smoothstep(0.0, 0.6, length(uv - 0.5)));
    fragmentOutputs.color = vec4f(acc / max(wsum, 1e-4), centre, 0.0, 1.0);
}
