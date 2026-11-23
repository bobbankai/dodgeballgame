// Flocks (vb_flock): flat-faceted little birds (the facet normal from screen derivatives), each
// kind in its own colours: folded paper cranes, butterflies' patterned wings, crows with a sheen,
// small brown birds. Dithered out with distance.
#define DISABLE_UNIFORMITY_ANALYSIS
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_flock>

varying vWorldPos: vec3f;
varying vPart: vec2f;
varying vKind: vec2f;
varying vFade: f32;

uniform cameraPosition: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform skyColor: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    if (fragmentInputs.vFade < hash12(fragmentInputs.position.xy)) {
        discard;
    }
    let P = fragmentInputs.vWorldPos;
    var N = normalize(cross(dpdx(P), dpdy(P)));
    let V = normalize(uniforms.cameraPosition - P);
    if (dot(N, V) < 0.0) {
        N = -N;
    }
    let lit = smoothstep(0.0, 0.15, dot(N, normalize(uniforms.sunDir))) * 0.7 + 0.3;
    let col = birdColor(i32(fragmentInputs.vKind.x + 0.5), fragmentInputs.vPart.x, fragmentInputs.vPart.y, fragmentInputs.vKind.y, lit, uniforms.sunColor, uniforms.skyColor);
    fragmentOutputs.color = vec4f(col, 1.0);
}
