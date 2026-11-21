// Bloom, one shader for all three steps (selected by `mode`):
//   0 prefilter: soft-knee threshold + Karis-weighted 13-tap downsample (no fireflies)
//   1 downsample: 13-tap filter (Jimenez 2014)
//   2 upsample: 9-tap tent of the smaller level, added onto this level's downsample
// The chain is mip-like: full -> 1/2 -> 1/4 ... -> 1/64 and back up.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_color>
#include<vb_sampling>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var higher: texture_2d<f32>;
var higherSampler: sampler;

uniform texel: vec2f;            // texel size of `source`
uniform bloomParams: vec4f;      // threshold, knee, mode, upsample radius
uniform scatter: f32;            // how much of the small levels spreads into the big ones

fn softThreshold(c: vec3f, threshold: f32, knee: f32) -> vec3f {
    let br = maxc3(c);
    var rq = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    rq = (rq * rq) / (4.0 * knee + 1e-5);
    let w = max(rq, br - threshold) / max(br, 1e-5);
    return c * w;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let mode = i32(uniforms.bloomParams.z);
    var c = vec3f(0.0);
    if (mode == 0) {
        c = downsample13(source, sourceSampler, uv, uniforms.texel, true);
        c = softThreshold(c, uniforms.bloomParams.x, uniforms.bloomParams.y);
        // keep bloom from ever going infinite on degenerate pixels
        c = min(c, vec3f(64.0));
    } else if (mode == 1) {
        c = downsample13(source, sourceSampler, uv, uniforms.texel, false);
    } else {
        let small = upsampleTent(source, sourceSampler, uv, uniforms.texel, uniforms.bloomParams.w);
        let here = textureSampleLevel(higher, higherSampler, uv, 0.0).rgb;
        c = mix(here, small, uniforms.scatter) + small * (1.0 - uniforms.scatter) * 0.5;
    }
    fragmentOutputs.color = vec4f(c, 1.0);
}
