// Afterimages, history update (vb_afterimage): the last ghosts decay; on strobe frames the pixels of
// dashing fighters (G-buffer id blocks, as for the auras) are captured from the scene, tinted with
// their energy colour and laid into the history.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_aura>
#include<vb_afterimage>

varying vUV: vec2f;

var sceneTex: texture_2d<f32>;
var sceneTexSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;
var history: texture_2d<f32>;
var historySampler: sampler;

uniform ghostIds: vec4f;           // the dashing fighters' id bases (-1 unused)
uniform ghostColors: array<vec4f, 4>;
uniform ghostParams: vec4f;        // decay this frame, capture (1 on strobe frames), texel x, texel y

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    var h = ghostDecay(textureSampleLevel(history, historySampler, uv, 0.0), uniforms.ghostParams.x);
    if (uniforms.ghostParams.y > 0.5) {
        let g = textureSampleLevel(gbuffer, gbufferSampler, uv, 0.0);
        let slot = i32(auraSlot(g.a, uniforms.ghostIds) + 0.5) - 1;
        if (slot >= 0) {
            // the figure's edge (where a neighbour is not this fighter) is kept brighter
            let t = uniforms.ghostParams.zw * 2.0;
            var edge = 0.0;
            for (var k = 0; k < 4; k++) {
                let o = vec2f(f32(k % 2) * 2.0 - 1.0, f32(k / 2) * 2.0 - 1.0) * t;
                let gn = textureSampleLevel(gbuffer, gbufferSampler, uv + o, 0.0);
                edge = max(edge, select(0.0, 1.0, i32(auraSlot(gn.a, uniforms.ghostIds) + 0.5) - 1 != slot));
            }
            let scene = textureSampleLevel(sceneTex, sceneTexSampler, uv, 0.0).rgb;
            let c = ghostTint(scene, uniforms.ghostColors[slot].rgb, edge);
            h = vec4f(c, 1.0);
        }
    }
    fragmentOutputs.color = h;
}
