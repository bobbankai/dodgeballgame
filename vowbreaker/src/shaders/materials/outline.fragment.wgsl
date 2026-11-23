// Ink outline colour: derived from the surface colour (darker, richer, warmer), so a red scarf gets
// a deep crimson line and skin a brown one; the line glows with the energy palette when charged.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_toon>
#include<vb_vfx>

varying vColor: vec4f;
varying vObjPos: vec3f;

uniform tint: vec4f;
uniform flash: vec4f;
uniform energy: vec4f;
uniform lineColor: vec4f;   // rgb override colour, a = how much of it to use

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    if (uniforms.energy.w > 0.0) {
        let n = vfbm3(fragmentInputs.vObjPos * 5.0, 3) * 0.75 + (1.0 - clamp(fragmentInputs.vObjPos.y / 2.0, 0.0, 1.0)) * 0.25;
        if (dissolve(n, uniforms.energy.w, 0.08).x < 0.5) {
            discard;
        }
    }
    let base = fragmentInputs.vColor.rgb * uniforms.tint.rgb;
    var col = inkLineColor(base, 0.72, 1.0) * 0.6;
    col = mix(col, uniforms.lineColor.rgb, uniforms.lineColor.a);
    if (uniforms.energy.x > 0.0) {
        let pal = paletteFor(i32(uniforms.energy.y));
        col = mix(col, pal.body * 1.5, clamp(uniforms.energy.x, 0.0, 1.0) * 0.8);
    }
    if (uniforms.energy.z > 0.0) {
        col = mix(col, vec3f(0.6, 0.0, 0.04), uniforms.energy.z * 0.8);
    }
    col = mix(col, uniforms.flash.rgb * 0.5, uniforms.flash.a);
    fragmentOutputs.color = vec4f(col, 1.0);
}
