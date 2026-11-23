// Memories painted other ways than sumi-e (vb_memory_styles): shadow-puppet theatre, an old
// photograph, watercolour, a child's crayon drawing, stained glass, a woodblock print. Faded in
// and out with the flashback, keeping the memory's one colour where the style allows.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_toon>
#include<vb_memory_styles>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform screenParams: vec4f;    // width, height, 1/width, 1/height
uniform memoryParams: vec4f;    // style, amount, time, seed
uniform memoryParams2: vec4f;   // kept hue (0 none), -, -, -

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let base = textureSampleLevel(source, sourceSampler, uv, 0.0).rgb;
    let style = i32(uniforms.memoryParams.x + 0.5);
    let amount = uniforms.memoryParams.y;
    if (style <= 0 || amount <= 0.001) {
        fragmentOutputs.color = vec4f(base, 1.0);
        return fragmentOutputs;
    }
    let time = uniforms.memoryParams.z;
    let seed = uniforms.memoryParams.w;
    let aspect = uniforms.screenParams.x / uniforms.screenParams.y;
    let px = uniforms.screenParams.zw;
    let pixel = uv * uniforms.screenParams.xy;
    let lineR = 1.6 * uniforms.screenParams.y / 720.0;
    let geo = memGeometry(gbuffer, gbufferSampler, uv, px, lineR, 0.6, seed + floor(time * 4.0));
    let keep = memKeep(base, uniforms.memoryParams2.x);
    var col = base;
    switch style {
        case 1: {
            col = memKage(base, geo, uv, pixel, aspect, time, seed, keep);
        }
        case 2: {
            col = memPhoto(base, uv, pixel, aspect, time, seed, keep);
        }
        case 3: {
            col = memWatercolor(source, sourceSampler, uv, pixel, px, geo, time, seed, keep);
        }
        case 4: {
            col = memCrayon(base, geo, uv, pixel, aspect, time, seed);
        }
        case 5: {
            col = memGlass(source, sourceSampler, uv, pixel, aspect, geo, time, seed, keep);
        }
        case 6: {
            col = memWoodblock(source, sourceSampler, uv, pixel, px, geo, seed, keep);
        }
        case 7: {
            col = memHomeMovie(source, sourceSampler, uv, pixel, aspect, time, seed, keep);
        }
        case 8: {
            col = memCharcoal(source, sourceSampler, uv, pixel, px, geo, time, seed);
        }
        case 9: {
            col = memManga(source, sourceSampler, uv, pixel, aspect, gbuffer, gbufferSampler, px, seed);
        }
        default: {
            col = base;
        }
    }
    fragmentOutputs.color = vec4f(mix(base, col, amount), 1.0);
}
