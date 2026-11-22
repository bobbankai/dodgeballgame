// Scene transitions on real frames (vb_scene_trans): the snapshot of the old scene covers the new
// one and breaks away (shatter, ink, burn, slash, talismans). Runs after FXAA, before sharpening,
// on display-referred colour; idle passes straight through.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_scene_trans>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var snapshot: texture_2d<f32>;
var snapshotSampler: sampler;

uniform transParams: vec4f;     // kind, progress 0..1 (negative = idle), aspect, seed
uniform transImpact: vec2f;     // where the shatter starts (uv)

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    var col = textureSampleLevel(source, sourceSampler, uv, 0.0).rgb;
    let t = uniforms.transParams.y;
    if (t >= 0.0 && t < 1.0) {
        let ts = transEval(i32(uniforms.transParams.x + 0.5), uv, t, uniforms.transParams.z, uniforms.transImpact, uniforms.transParams.w);
        if (ts.cover > 0.0) {
            let old = textureSampleLevel(snapshot, snapshotSampler, clamp(ts.uv, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
            col = mix(col, old * ts.tint, ts.cover);
        }
        col = col + ts.add * select(1.0, ts.cover, i32(uniforms.transParams.x + 0.5) != 3);
    }
    fragmentOutputs.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
