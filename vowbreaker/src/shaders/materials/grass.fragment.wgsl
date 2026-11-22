// Grass blades (vb_grass): banded from the ground's colour at the root to a pale tip, shadowed by
// the sun's shadow map, glowing when seen against the sun, wildflowers on some tips.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_shadow>
#include<vb_grass>

varying vT: f32;
varying vAcross: f32;
varying vWorld: vec3f;
varying vSeed: f32;
varying vFlower: f32;
varying vFade: f32;

uniform cameraPosition: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform skyColor: vec3f;
uniform groundColor: vec3f;
uniform bladeColor: vec3f;
uniform tipColor: vec3f;
uniform lightViewProj: mat4x4f;
uniform shadowParams: vec4f;

var shadowMap: texture_2d<f32>;

// dithered fade with distance (no blending needed for thousands of blades)
fn vFadeCheck(fade: f32, seed: f32) -> bool {
    return fade < hash11(seed * 91.7 + 0.13);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    if (vFadeCheck(fragmentInputs.vFade, fragmentInputs.vSeed)) {
        discard;
    }
    let P = fragmentInputs.vWorld;
    var sh = 1.0;
    if (uniforms.shadowParams.w > 0.5) {
        let s = shadowProject(P + vec3f(0.0, 0.05, 0.0), uniforms.lightViewProj, uniforms.shadowParams.x);
        sh = shadowEdgeFade(s, shadowPCF5(shadowMap, s, uniforms.shadowParams.y * 2.0, 1.0));
    }
    let lit = sh * (0.6 + 0.4 * clamp(uniforms.sunDir.y, 0.0, 1.0));
    var col = grassShade(fragmentInputs.vT, lit, uniforms.groundColor, uniforms.bladeColor, uniforms.tipColor, fragmentInputs.vSeed);
    col = col * uniforms.sunColor * 0.55 + col * uniforms.skyColor * 0.45;
    // against the sun the blade glows from behind
    let V = normalize(uniforms.cameraPosition - P);
    let back = pow(clamp(dot(V, -normalize(uniforms.sunDir)), 0.0, 1.0), 6.0);
    col = col + uniforms.sunColor * uniforms.tipColor * back * fragmentInputs.vT * sh * 0.6;
    // wildflowers: a small round head on the tip
    if (fragmentInputs.vFlower > 0.5 && fragmentInputs.vT > 0.82) {
        col = grassFlowerColor(fragmentInputs.vFlower) * mix(0.6, 1.1, lit);
    }
    fragmentOutputs.color = vec4f(col, 1.0);
}
