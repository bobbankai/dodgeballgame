// Domain floor: the ground of each domain (domain_* libraries), lit in the same cel style as the
// dome, receiving the fighters' shadows in the domain's own shadow colour, sinking into the
// domain's air with distance, and revealed outward from the caster behind a burning front.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_sdf3d>
#include<vb_lighting>
#include<vb_shadow>
#include<vb_toon>
#include<vb_atmosphere>
#include<vb_vfx>
#include<vb_domain_core>
#include<vb_domain_bell>
#include<vb_domain_garden>
#include<vb_domain_lake>
#include<vb_domain_parade>
#include<vb_domain_memory>
#include<vb_domain_scenes>
#include<vb_domain_growth>

varying vWorld: vec3f;

uniform cameraPosition: vec3f;
uniform domainParams: vec4f;   // id, reveal, time, intensity
uniform domainCenter: vec3f;
uniform lightViewProj: mat4x4f;
uniform shadowParams: vec4f;
uniform growthParams: vec4f;   // the growth field: centre x, z, 1 / size, on

var shadowMap: texture_2d<f32>;
var growth: texture_2d<f32>;
var growthSampler: sampler;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let id = i32(uniforms.domainParams.x + 0.5);
    let reveal = uniforms.domainParams.y;
    let t = uniforms.domainParams.z;
    let P = fragmentInputs.vWorld;
    let rv = domainReveal(P, uniforms.domainCenter, reveal, 70.0);
    if (rv.x < 0.5) {
        discard;
    }
    var sh = 1.0;
    if (uniforms.shadowParams.w > 0.5) {
        let s = shadowProject(P + vec3f(0.0, 0.03, 0.0), uniforms.lightViewProj, uniforms.shadowParams.x);
        sh = shadowEdgeFade(s, shadowPCF5(shadowMap, s, 0.002, 1.5));
        sh = stylizeShadowEdge(sh, P, 5.0, 0.3);
    }
    let look = domainLookOf(id);
    let V = normalize(uniforms.cameraPosition - P);
    var col = domainFloorOf(id, P, uniforms.domainCenter, t, V, 1.4);
    // what grows across the floor from the caster's feet (vb_domain_growth)
    var growGlow = vec3f(0.0);
    if (uniforms.growthParams.w > 0.5) {
        let guv = (P.xz - uniforms.growthParams.xy) * uniforms.growthParams.z + 0.5;
        if (all(guv > vec2f(0.002)) && all(guv < vec2f(0.998))) {
            let g = textureSampleLevel(growth, growthSampler, guv, 0.0);
            let gl = domainGrowthLook(id, col, g, P, t);
            col = gl.col;
            growGlow = gl.glow;
        }
    }
    // the fighters' shadows take the domain's shadow colour (the lake's mirror darkens less)
    let shadowTint = mix(look.shadowCol * 0.9, vec3f(1.0), sh);
    col = col * select(shadowTint, mix(vec3f(0.55), vec3f(1.0), sh), id == 2);
    // the domain's air
    let dist = length(P - uniforms.cameraPosition);
    col = domainFog(col, dist, uniforms.cameraPosition, -V, look);
    let pal = paletteFor(select(id, 0, id == 4));
    col = col + pal.body * rv.y * 3.0 + growGlow;
    fragmentOutputs.color = vec4f(max(col, vec3f(0.0)) * uniforms.domainParams.w, 1.0);
}
