// Lens flare (quarter resolution): ghosts and a halo from every bright thing on screen (pseudo
// lens flare from a blurred bloom mip), tinted by the lens coatings and dispersed into colour
// fringes; anamorphic streaks for neon and headlights; and a starburst round the sun or moon
// when it is in frame. Added to the image in the final pass, multiplied by procedural lens dirt.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_lens>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;

uniform screenParams: vec4f;     // width, height, 1/w, 1/h (of this pass)
uniform flareParams: vec4f;      // ghost count, spacing, threshold, dispersal
uniform flareParams2: vec4f;     // halo width, halo amount, anamorphic amount, anamorphic length
uniform sunUV: vec4f;            // xy sun / moon screen position, z on screen, w starburst amount

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let aspect = uniforms.screenParams.x * uniforms.screenParams.w;
    let threshold = uniforms.flareParams.z;
    var col = lensGhosts(source, sourceSampler, uv, i32(uniforms.flareParams.x), uniforms.flareParams.y, threshold, uniforms.flareParams.w) * lensGhostTint(uv);
    col = col + lensHalo(source, sourceSampler, uv, uniforms.flareParams2.x, threshold, aspect) * uniforms.flareParams2.y * vec3f(0.9, 0.85, 1.0);
    if (uniforms.flareParams2.z > 0.0) {
        col = col + lensAnamorphic(source, sourceSampler, uv, uniforms.screenParams.z, uniforms.flareParams2.w, threshold * 1.5) * uniforms.flareParams2.z;
    }
    if (uniforms.sunUV.z > 0.0 && uniforms.sunUV.w > 0.0) {
        let burst = lensStarburst(uv, uniforms.sunUV.xy, aspect, 6.0, 0.3);
        col = col + vec3f(1.0, 0.92, 0.8) * burst * uniforms.sunUV.w * 0.3;
    }
    fragmentOutputs.color = vec4f(col, 1.0);
}
