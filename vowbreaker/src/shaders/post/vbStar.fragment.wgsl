// Star filter (vb_star_filter): rays from the highlights, read from the first bloom level and
// written at quarter resolution for vbFinal to add.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_star_filter>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var wide: texture_2d<f32>;
var wideSampler: sampler;

uniform starParams: vec4f;     // rays, length (texels), angle, chroma
uniform starParams2: vec4f;    // threshold, texel x, texel y, -

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let texel = uniforms.starParams2.yz;
    let c = starFilter(source, sourceSampler, wide, wideSampler, uv, texel, i32(uniforms.starParams.x + 0.5), uniforms.starParams.y, uniforms.starParams.z, uniforms.starParams.w);
    fragmentOutputs.color = vec4f(starIsolate(c, uniforms.starParams2.x), 1.0);
}
