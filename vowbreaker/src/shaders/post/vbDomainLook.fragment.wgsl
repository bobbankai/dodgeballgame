// Domain looks (vb_domain_looks): the frame takes on the open domain's nature, faded in with its
// reveal and centred on the caster.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_domain_looks>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;

uniform screenParams: vec4f;       // width, height, 1/width, 1/height
uniform domainLookParams: vec4f;   // domain id + 1 (0 none), amount, time, -
uniform domainLookCenter: vec2f;   // the caster on screen

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let base = textureSampleLevel(source, sourceSampler, uv, 0.0).rgb;
    let id = i32(uniforms.domainLookParams.x + 0.5) - 1;
    let amount = uniforms.domainLookParams.y;
    if (id < 0 || amount <= 0.001) {
        fragmentOutputs.color = vec4f(base, 1.0);
        return fragmentOutputs;
    }
    var i: DomainLookIn;
    i.uv = uv;
    i.aspect = uniforms.screenParams.x / uniforms.screenParams.y;
    i.time = uniforms.domainLookParams.z;
    i.amount = amount;
    i.center = uniforms.domainLookCenter;
    i.px = uniforms.screenParams.zw;
    let pixel = uv * uniforms.screenParams.xy;
    var c = base;
    switch id {
        case 0: {
            c = lookBell(textureSampleLevel(source, sourceSampler, lookBellUV(i), 0.0).rgb, i);
        }
        case 1: {
            c = lookPrayers(base, i, pixel);
        }
        case 2: {
            let mirror = textureSampleLevel(source, sourceSampler, lakeMirrorUV(i, 0.46), 0.0).rgb;
            c = lookLake(base, mirror, i);
        }
        case 3: {
            // ghosts: the frame trailing itself
            let g1 = textureSampleLevel(source, sourceSampler, uv + vec2f(0.012, 0.004), 0.0).rgb;
            let g2 = textureSampleLevel(source, sourceSampler, uv + vec2f(0.026, 0.007), 0.0).rgb;
            c = lookParade(base, max(g1 * 0.7, g2 * 0.45), i);
        }
        case 4: {
            c = lookBurning(textureSampleLevel(source, sourceSampler, memoryShimmerUV(i), 0.0).rgb, i);
        }
        default: {
            c = base;
        }
    }
    fragmentOutputs.color = vec4f(mix(base, c, amount), 1.0);
}
