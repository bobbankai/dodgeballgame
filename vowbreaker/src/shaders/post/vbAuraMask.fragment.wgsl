// Aura, step 1 (half resolution): mark the pixels belonging to the fighters whose aura burns.
// r = aura slot (1..4, 0 = none), taken from the G-buffer's object id; the nearest of a 2x2
// footprint wins so thin limbs are not lost at half resolution.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_aura>

varying vUV: vec2f;

var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform auraIds: vec4f;          // the four fighters' id bases (-1 = slot unused)
uniform texel: vec2f;            // full-resolution texel

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    var slot = 0.0;
    var nearZ = 1e9;
    for (var j = 0; j < 2; j++) {
        for (var i = 0; i < 2; i++) {
            let o = (vec2f(f32(i), f32(j)) - 0.5) * uniforms.texel;
            let g = textureSampleLevel(gbuffer, gbufferSampler, fragmentInputs.vUV + o, 0.0);
            let s = auraSlot(g.a, uniforms.auraIds);
            if (s > 0.0 && g.b < nearZ) {
                slot = s;
                nearZ = g.b;
            }
        }
    }
    fragmentOutputs.color = vec4f(slot, nearZ * step(0.5, slot), 0.0, 1.0);
}
