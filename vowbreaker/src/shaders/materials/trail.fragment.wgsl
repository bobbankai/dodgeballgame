// Slash trails (vb_trail_styles): each technique palette draws its ribbon its own way (energy
// bands, folded paper, water, flame tongues, a starry void, Black Spark lightning, a dry-brush
// curse stroke). Output is premultiplied: rgb is added light, alpha how much it covers.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_vfx>
#include<vb_trail_styles>

varying vUV: vec2f;

uniform trailParams: vec4f;    // palette, intensity (fades out), black spark (0/1), time
uniform trailParams2: vec4f;   // seed, -, -, -

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let u = clamp(fragmentInputs.vUV.x, 0.0, 1.0);
    let v = fragmentInputs.vUV.y;
    let palette = i32(uniforms.trailParams.x + 0.5);
    let pal = paletteFor(palette);
    var style = trailStyleFor(palette);
    if (uniforms.trailParams.z > 0.5) {
        style = 5;
    }
    let k = trailEval(style, u, v, uniforms.trailParams.w, pal.core, pal.body, pal.edge, uniforms.trailParams2.x);
    let fade = clamp(uniforms.trailParams.y, 0.0, 1.0);
    fragmentOutputs.color = vec4f(k.light * fade, clamp(k.cover * fade, 0.0, 1.0));
}
