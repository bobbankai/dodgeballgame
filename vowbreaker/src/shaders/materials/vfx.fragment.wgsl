// Mesh effects (src/render/Vfx.ts): fragment stage. Builds the VfxIn every effect function reads,
// dispatches on the kind (numbers match VK in Vfx.ts), softens where the effect cuts into the
// scene (against the G-buffer's view depth) and writes premultiplied light (additive batch) or
// colour and coverage (alpha batch).
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
#include<vb_vfx_blade>
#include<vb_vfx_shock>
#include<vb_vfx_flame>
#include<vb_vfx_bolt>
#include<vb_vfx_matter>
#include<vb_vfx_arcane>

varying vUV: vec2f;
varying vLocal: vec3f;
varying vNormalW: vec3f;
varying vWorld: vec3f;
varying vViewZ: f32;

uniform cameraPosition: vec3f;
uniform vfxTime: vec4f;
uniform vfxA: vec4f;
uniform vfxB: vec4f;
uniform vfxC: vec4f;
uniform vfxD: vec4f;
uniform body: vec3f;
uniform core: vec3f;
uniform edge: vec3f;

var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

fn vfxDispatch(kind: i32, i: VfxIn) -> VfxOut {
    switch kind {
        case 0: { return vfxSlashArc(i); }
        case 1: { return vfxShockDome(i); }
        case 2: { return vfxGroundRing(i); }
        case 3: { return vfxCrater(i); }
        case 4: { return vfxBell(i); }
        case 5: { return vfxFlame(i); }
        case 6: { return vfxAura(i); }
        case 7: { return vfxFirenado(i); }
        case 8: { return vfxBolt(i); }
        case 9: { return vfxArcs(i); }
        case 10: { return vfxBeam(i); }
        case 11: { return vfxColumn(i); }
        case 12: { return vfxPillar(i); }
        case 13: { return vfxSmoke(i); }
        case 14: { return vfxInk(i); }
        case 15: { return vfxPaperStorm(i); }
        case 16: { return vfxSplash(i); }
        case 17: { return vfxTendril(i); }
        case 18: { return vfxCraneTrail(i); }
        case 19: { return vfxSeal(i); }
        case 20: { return vfxPortal(i); }
        case 21: { return vfxGravity(i); }
        case 22: { return vfxVeil(i); }
        case 23: { return vfxClaw(i); }
        case 24: { return vfxThrust(i); }
        case 25: { return vfxCrossCut(i); }
        default: { return vfxNone(); }
    }
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    var i: VfxIn;
    i.uv = fragmentInputs.vUV;
    i.local = fragmentInputs.vLocal;
    i.world = fragmentInputs.vWorld;
    var n = normalize(fragmentInputs.vNormalW);
    i.v = normalize(uniforms.cameraPosition - fragmentInputs.vWorld);
    // two-sided shells: the inside of a dome faces the eye too
    if (dot(n, i.v) < 0.0) {
        n = -n;
    }
    i.n = n;
    i.fres = 1.0 - clamp(dot(n, i.v), 0.0, 1.0);
    i.age = clamp(uniforms.vfxA.y, 0.0, 1.0);
    i.seed = uniforms.vfxA.z;
    i.time = uniforms.vfxTime.x;
    i.st = steppedTime(uniforms.vfxTime.x, 12.0);
    i.inten = uniforms.vfxA.w;
    i.p = uniforms.vfxB;
    i.q = uniforms.vfxC;
    i.body = uniforms.body;
    i.core = uniforms.core;
    i.edge = uniforms.edge;
    i.px = max(length(fwidth(fragmentInputs.vUV)), 1e-4);

    var o = vfxDispatch(i32(uniforms.vfxA.x + 0.5), i);
    // debug: q.w = -1 paints the shape's uv (red = u, green = v), -2 its fresnel
    if (uniforms.vfxC.w < -1.5) {
        o = vfxOut(vec3f(i.fres), 1.0);
    } else if (uniforms.vfxC.w < -0.5) {
        o = vfxOut(vec3f(i.uv, 0.0), 1.0);
    }

    // soft where the effect meets the scene
    let screen = uniforms.vfxTime.yz;
    let suv = vec2f(fragmentInputs.position.x / screen.x, 1.0 - fragmentInputs.position.y / screen.y);
    let sceneZ = textureSampleLevel(gbuffer, gbufferSampler, suv, 0.0).b;
    let soft = vfxSoftDepth(sceneZ, fragmentInputs.vViewZ, uniforms.vfxD.y);

    if (uniforms.vfxTime.w > 0.5) {
        if (o.a * soft < 0.003) {
            discard;
        }
        fragmentOutputs.color = vec4f(max(o.rgb, vec3f(0.0)), o.a * soft);
    } else {
        fragmentOutputs.color = vec4f(max(o.rgb, vec3f(0.0)) * soft, 1.0);
    }
}
