// Aura, step 2 (half resolution): flames off the marked silhouettes. For every pixel outside a
// fighter, the nearest marked pixel (vb_aura auraNearest, reaching further down than up) gives a
// distance; the distance cuts a field of rising noise (or crackle, smoke, a halo, by style); the
// field is posterised into the fighter's palette and a thin dark line is drawn at its edge.
// Nothing is drawn inside the silhouette, so the fighter stays readable.
// Output: premultiplied light (rgb), coverage (a); vbFinal adds it before tone mapping.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_toon>
#include<vb_vfx>
#include<vb_vfx_core>
#include<vb_aura>

varying vUV: vec2f;

var mask: texture_2d<f32>;
var maskSampler: sampler;

uniform auraColors: array<vec4f, 4>;   // rgb body colour, w = style + strength (style + 0..0.99)
uniform auraEdges: array<vec4f, 4>;    // rgb edge colour, w = reach in half-res pixels
uniform auraParams: vec4f;             // time, aspect, global strength, -
uniform texel: vec2f;                  // half-resolution texel

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let time = uniforms.auraParams.x;
    let aspect = uniforms.auraParams.y;
    // the widest reach of any active slot bounds the search
    var reach = 0.0;
    for (var k = 0; k < 4; k++) {
        reach = max(reach, uniforms.auraEdges[k].w);
    }
    if (reach <= 0.0) {
        fragmentOutputs.color = vec4f(0.0);
        return fragmentOutputs;
    }
    let near = auraNearest(mask, maskSampler, uv, uniforms.texel, reach);
    let slot = i32(near.slot + 0.5) - 1;
    if (slot < 0 || near.dist >= 1.0) {
        fragmentOutputs.color = vec4f(0.0);
        return fragmentOutputs;
    }
    let ac = uniforms.auraColors[slot];
    let ae = uniforms.auraEdges[slot];
    let style = i32(floor(ac.w));
    let strength = fract(ac.w) * 1.01 * uniforms.auraParams.z;
    // the search reach of this slot (a smaller aura gives up sooner)
    let dist = near.dist * reach / max(ae.w, 1.0);
    if (dist >= 1.0 || strength <= 0.0) {
        fragmentOutputs.color = vec4f(0.0);
        return fragmentOutputs;
    }
    let seed = f32(slot) * 3.7;
    var f = 0.0;
    switch style {
        case 1: { f = auraStatic(uv, dist, time, seed, aspect); }
        case 2: { f = auraSmoke(uv, dist, time, seed, aspect); }
        case 3: { f = auraHalo(dist, time); }
        default: { f = auraFlame(uv, dist, time, seed, aspect); }
    }
    // nothing is drawn over the fighter: the aura lives outside the silhouette
    f = f * (1.0 - near.inside);
    var o: VfxOut;
    if (style == 2) {
        // smoke is dark: a near-black body with the colour only at its rim
        let body = smoothstep(0.2, 0.3, f);
        let rim = smoothstep(0.2, 0.3, f) * (1.0 - smoothstep(0.32, 0.45, f));
        let rgb = mix(vec3f(0.0), ac.rgb * 2.0, rim);
        // dark smoke subtracts light: encoded as negative premultiplied colour on its body
        fragmentOutputs.color = vec4f(rgb * body - vec3f(0.25) * body * (1.0 - rim), body) * strength;
        return fragmentOutputs;
    }
    o = vfxRamp(f, ae.rgb, ac.rgb * 1.7, mix(ac.rgb, vec3f(1.0), 0.7) * 2.6, 0.12, 0.42, 0.75, 0.04);
    let line = (1.0 - smoothstep(0.0, 0.04, abs(f - 0.12))) * 0.6;
    o.rgb = mix(o.rgb, ae.rgb * 0.3, line);
    fragmentOutputs.color = vec4f(o.rgb * o.a, o.a) * strength;
}
