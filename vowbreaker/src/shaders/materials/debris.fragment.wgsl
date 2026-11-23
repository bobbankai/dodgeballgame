// Debris chunks (vb_debris): flat toon facets (the facet normal from screen derivatives), lit by
// the sun with a painted shadow colour and a sky/ground fill, a rim of light, the chunk's own
// colour by kind (stone, wood grain, glazed tile, ice, paper, ink), and glowing seams on chunks
// thrown out of a technique's crater. With INK defined it is the flat ink of the hull.
#define DISABLE_UNIFORMITY_ANALYSIS
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_debris>

varying vWorldPos: vec3f;
varying vLocal: vec3f;
varying vColor: vec4f;
varying vInfo: vec4f;

uniform cameraPosition: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform skyColor: vec3f;
uniform groundColor: vec3f;
uniform shadowColor: vec3f;
uniform heatBody: vec3f;
uniform heatCore: vec3f;
uniform inkColor: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
#ifdef INK
    fragmentOutputs.color = vec4f(uniforms.inkColor, 1.0);
#else
    let P = fragmentInputs.vWorldPos;
    // a facet's normal: flat shading reads as broken stone
    var N = normalize(cross(dpdx(P), dpdy(P)));
    let V = normalize(uniforms.cameraPosition - P);
    if (dot(N, V) < 0.0) {
        N = -N;
    }
    let L = normalize(uniforms.sunDir);
    let kind = i32(fragmentInputs.vColor.w + 0.5);
    let seed = fragmentInputs.vInfo.x;
    let albedo = debrisAlbedo(fragmentInputs.vColor.rgb, kind, fragmentInputs.vLocal, N, seed);
    // two tones with a short soft step, a lighter band where the light turns
    let ndl = dot(N, L);
    let lit = smoothstep(0.0, 0.08, ndl);
    let band = smoothstep(0.55, 0.62, ndl) * 0.12;
    let fill = mix(uniforms.groundColor, uniforms.skyColor, N.y * 0.5 + 0.5) * 0.45;
    let shade = mix(albedo * uniforms.shadowColor * 0.9 + albedo * fill, albedo * (uniforms.sunColor * (1.0 + band) + fill * 0.5), lit);
    // a thin rim of sky light on the edges facing away from the camera
    let rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0) * 0.25;
    var col = shade + uniforms.skyColor * rim * albedo;
    // ice and glazed tile catch a sharp glint
    if (kind == DEBRIS_ICE || kind == DEBRIS_TILE) {
        let h = normalize(L + V);
        col = col + uniforms.sunColor * step(0.97, dot(N, h)) * lit * 0.8;
    }
    col = col + debrisHeatGlow(fragmentInputs.vLocal, fragmentInputs.vInfo.y, uniforms.heatBody, uniforms.heatCore, seed);
    fragmentOutputs.color = vec4f(col, 1.0);
#endif
}
