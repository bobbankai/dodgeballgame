// Fire cards (vb_fire_sim): the simulated heat posterised into blackbody bands with an ink line round
// the tongues, smoke above, softened where the card cuts into the scene, faded at the card's sides.
// Output is premultiplied (flames add light, smoke covers).
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_fire_sim>

varying vUV: vec2f;
varying vCard: vec4f;
varying vViewZ: f32;

uniform screenSize: vec2f;
uniform time: f32;

var fireTex: texture_2d<f32>;
var fireTexSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    // each card shows its own slice of the fire, mirrored by its seed
    // (a window over the burning middle of the grid, never wrapping: a wrap would be a hard seam)
    var u = 0.14 + uv.x * 0.56 + fragmentInputs.vCard.x * 0.16;
    if (fragmentInputs.vCard.y > 0.5) {
        u = 1.0 - u;
    }
    // skip the fuel rows at the very bottom; taper the fire toward the card's sides
    let cell = textureSampleLevel(fireTex, fireTexSampler, vec2f(u, 0.05 + uv.y * 0.95), 0.0);
    let seed = fragmentInputs.vCard.x * 7.0 + fragmentInputs.vCard.y;
    let fh = fireCardHeat(uv, cell.r, seed, uniforms.time);
    let heat = fh.x * fragmentInputs.vCard.z;
    let smoke = fireCardSmoke(uv, fh.y, cell.g, seed, uniforms.time);
    let flame = smoothstep(0.1, 0.16, heat);
    var col = fireColor(heat) * flame;
    // the ink line round the tongues
    let g = max(fwidth(heat), 1e-4);
    let line = 1.0 - smoothstep(0.5, 1.5, abs(heat - 0.13) / g);
    col = mix(col, vec3f(0.25, 0.03, 0.0), line * 0.7 * step(0.08, heat));
    let smokeA = smoke * 0.6 * (1.0 - flame);
    col = col + fireSmokeColor(smoke, heat) * smokeA;
    var a = max(smokeA, flame * 0.7);
    // soft where the card meets the scene, faded at its sides and top
    let suv = vec2f(fragmentInputs.position.x / uniforms.screenSize.x, 1.0 - fragmentInputs.position.y / uniforms.screenSize.y);
    let sceneZ = textureSampleLevel(gbuffer, gbufferSampler, suv, 0.0).b;
    let soft = clamp((sceneZ - fragmentInputs.vViewZ) / 0.6, 0.0, 1.0);
    let edges = smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x) * smoothstep(1.0, 0.8, uv.y);
    let k = soft * edges;
    fragmentOutputs.color = vec4f(col * k, a * k);
}
