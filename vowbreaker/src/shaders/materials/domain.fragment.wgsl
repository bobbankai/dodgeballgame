// Domain dome: the world a domain paints round the fighters, raymarched behind them.
// The worlds themselves live in the domain_* libraries (one file per domain, domain_core for the
// shared marching, cel light, ink and air, domain_scenes to dispatch):
//   0 Temple of the Unrung Bell          bronze bells on chains over an ash sea in an endless dusk
//   1 Garden of Folded Prayers           paper torii, folded cranes, a sumi-e sky with a red sun
//   2 Mirror Lake of Ten Thousand Moons  a night of moons doubled in still water, stone lanterns
//   3 Night Parade Without End           a torii avenue, the yokai procession, a black sun
//   4 the burning memory                 an endless apartment corridor on fire (flashbacks)
// The dome is revealed outward from the caster (reveal 0..1) behind a burning front.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_sdf3d>
#include<vb_lighting>
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

varying vWorld: vec3f;

uniform cameraPosition: vec3f;
uniform domainParams: vec4f;   // id, reveal (0..1), time, intensity
uniform domainCenter: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let id = i32(uniforms.domainParams.x + 0.5);
    let reveal = uniforms.domainParams.y;
    let t = uniforms.domainParams.z;
    let rv = domainReveal(fragmentInputs.vWorld, uniforms.domainCenter, reveal, 70.0);
    if (rv.x < 0.5) {
        discard;
    }
    let ro = uniforms.cameraPosition;
    let rd = normalize(fragmentInputs.vWorld - ro);
    // the dome's own distance bounds the march (it is the far wall of the world)
    let maxT = 170.0;
    var col = domainRender(id, ro, rd, t, maxT, 64);
    // flakes in the air
    let motes = domainMotes(id, ro, rd, t, maxT);
    col = mix(col, domainMoteColor(id), motes.a);
    col = col + motes.rgb;
    // the burning edge of the front as it sweeps outward, in the caster's colours
    let pal = paletteFor(select(id, 0, id == 4));
    col = col + pal.body * rv.y * 3.0 + pal.core * rv.y * rv.y * 2.0;
    fragmentOutputs.color = vec4f(max(col, vec3f(0.0)) * uniforms.domainParams.w, 1.0);
}
