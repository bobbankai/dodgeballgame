// Domain clash (vb_domain_clash): the newest frame drawn inside each of two domains, split along a
// seam where space is breaking. Each side is pushed away from the seam; the seam burns white with
// each domain's colour on its side, lightning crawls along it and forks into both, cracks run out
// of it with the other domain showing through, sparks fly, shock rings pulse from it.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_domain_clash>

varying vUV: vec2f;

var clashA: texture_2d<f32>;
var clashASampler: sampler;
var clashB: texture_2d<f32>;
var clashBSampler: sampler;

uniform screenParams: vec4f;    // width, height, 1/width, 1/height
uniform clashParams: vec4f;     // amount, balance (-1 A winning .. 1 B winning), time, seed
uniform clashCenters: vec4f;    // caster A (uv), caster B (uv)
uniform clashColorA: vec3f;
uniform clashColorB: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let amount = uniforms.clashParams.x;
    let balance = uniforms.clashParams.y;
    let time = uniforms.clashParams.z;
    let seed = uniforms.clashParams.w;
    let aspect = uniforms.screenParams.x / uniforms.screenParams.y;
    let a = uniforms.clashCenters.xy;
    let b = uniforms.clashCenters.zw;
    let cf = clashFieldAt(uv, a, b, aspect, balance, time, seed);
    let f = cf.f;
    // pressure: each side's picture bends away from the seam
    let push = (1.0 - smoothstep(0.0, 0.12, abs(f))) * 0.012 * amount;
    let n = vec2f(cf.normal.x / aspect, cf.normal.y);
    let uvA = uv - n * push;
    let uvB = uv + n * push;
    let colA = textureSampleLevel(clashA, clashASampler, uvA, 0.0).rgb;
    let colB = textureSampleLevel(clashB, clashBSampler, uvB, 0.0).rgb;
    // a soft edge a few pixels wide, then the cracks where the other side shows through
    let px = uniforms.screenParams.w;
    var k = smoothstep(-px * 1.5, px * 1.5, f);
    let cracks = clashCracks(uv, f, aspect, seed, amount);
    k = mix(k, 1.0 - k, cracks);
    var col = mix(colA, colB, k);
    // the seam
    let seam = clashSeamColor(f, uniforms.clashColorA, uniforms.clashColorB, 0.012);
    col = col + seam.rgb * seam.a;
    let bolt = clashLightning(cf.along, f, time, seed);
    col = mix(col, vec3f(1.0), bolt.x);
    col = col + mix(uniforms.clashColorA, uniforms.clashColorB, step(0.0, f)) * bolt.y * 0.8;
    col = col + vec3f(1.0, 0.95, 0.85) * clashSparks(cf.along, f, time, seed) * 1.5;
    // shock rings from the seam's midpoint when the balance swings
    let mid = mix(a, b, 0.5 + balance * 0.25);
    col = col + mix(uniforms.clashColorA, uniforms.clashColorB, 0.5) * clashPulse(uv, mid, aspect, time * 0.8) * 0.8;
    // crack lines glow white
    col = col + vec3f(0.9) * cracks * 0.5;
    let base = mix(colA, colB, 0.0);
    fragmentOutputs.color = vec4f(mix(base, col, amount), 1.0);
}
