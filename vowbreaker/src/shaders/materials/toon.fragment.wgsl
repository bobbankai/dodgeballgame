// Character toon shader: fragment stage.
//
// Every character surface is shaded by material family (painted into the vertex colour alpha):
// skin and face (warm scattering shadow edge, head-space face shadows, blush that survives in
// shadow), hair (two-tone with a deep underside, angel ring broken into strands, two-lobe sheen),
// eyes (never dead in shadow, caustic iris, pure highlights), cloth (wool velvet, silk sheen,
// leather grain, weave, painted fold cores), metal (painted environment band, stepped highlights),
// paper (light passes through) and emissive marks. On top: rain, dust, battle damage and sweat;
// the story's transformations (paper creeping up a body, memory drawings, Stillwater's grey); the
// fight's effects (cursed energy flowing in palette bands, the Black Spark crackle, the Vow's red,
// hit flashes and impact-frame inversions, dissolves into ash) and the domain wash.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_lighting>
#include<vb_shadow>
#include<vb_toon>
#include<vb_vfx>
#include<vb_atmosphere>
#include<vb_water>
#include<vb_patterns>
#include<vb_surface>
#include<vb_brdf>
#include<vb_noise2>
#include<vb_toon_ramp>
#include<vb_toon_skin>
#include<vb_toon_hair>
#include<vb_toon_eye>
#include<vb_toon_cloth>
#include<vb_toon_metal>
#include<vb_toon_fx>
#include<vb_toon_marks>

varying vWorldPos: vec3f;
varying vNormalW: vec3f;
varying vNormalV: vec3f;
varying vColor: vec4f;
varying vData: vec4f;
varying vObjPos: vec3f;

uniform cameraPosition: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform skyColor: vec3f;
uniform groundColor: vec3f;
uniform shadowColor: vec3f;
uniform rimColor: vec3f;
uniform tint: vec4f;
uniform flash: vec4f;
uniform toonParams: vec4f;
uniform toonParams2: vec4f;
uniform energy: vec4f;
uniform headRight: vec3f;
uniform headUp: vec3f;
uniform headForward: vec3f;
uniform lightViewProj: mat4x4f;
uniform shadowParams: vec4f;
uniform pointPos: array<vec4f, 4>;
uniform pointCol: array<vec4f, 4>;
uniform domainParams: vec4f;
uniform surface: vec4f;
uniform surface2: vec4f;
uniform heights: vec4f;

var shadowMap: texture_2d<f32>;

fn sampleShadow(worldPos: vec3f, n: vec3f, l: vec3f, pixel: vec2f) -> f32 {
    if (uniforms.shadowParams.w < 0.5) {
        return 1.0;
    }
    let bias = shadowBias(n, l, uniforms.shadowParams.y, uniforms.shadowParams.y * 2.0);
    let s = shadowProject(worldPos + n * 0.015, uniforms.lightViewProj, uniforms.shadowParams.x);
    let rot = interleavedGradientNoise(pixel) * TAU;
    let sh = shadowPCF(shadowMap, s, bias, uniforms.shadowParams.z, rot);
    return shadowEdgeFade(s, sh);
}

// a ramp for each family, with the artist-facing look parameters folded in
fn rampFor(matId: i32) -> ToonRamp {
    var r = rampDefault();
    if (matId == MAT_SKIN || matId == MAT_FACE) {
        r = rampSkin();
    } else if (matId == MAT_HAIR) {
        r = rampHair();
    } else if (matId == MAT_METAL) {
        r = rampMetal();
    } else if (matId == MAT_PAPER) {
        r = rampPaper();
    } else if (matId == MAT_CLOTH) {
        r = rampCloth();
    }
    r.threshold = r.threshold + (uniforms.toonParams.x - 0.5);
    r.softness = max(r.softness, uniforms.toonParams.y * 0.5);
    r.aoInfluence = r.aoInfluence * (uniforms.toonParams.z / 0.45);
    return r;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let time = uniforms.toonParams2.w;
    let matId = decodeMaterialId(fragmentInputs.vColor.a);
    let pixel = fragmentInputs.position.xy;
    let objPos = fragmentInputs.vObjPos;
    let figureH = uniforms.heights.x;

    // --- endings: dissolves (curses exorcised, the Little Bell letting go) -------------------------
    var dissolveEdge = 0.0;
    if (uniforms.energy.w > 0.0) {
        let d = fxDissolveAsh(objPos, uniforms.energy.w, figureH);
        if (d.x < 0.5) {
            discard;
        }
        dissolveEdge = d.y;
    }

    var albedo = fragmentInputs.vColor.rgb * uniforms.tint.rgb;
    albedo = adjustSaturation(albedo, uniforms.tint.a);
    let N = normalize(fragmentInputs.vNormalW);
    let toCam = uniforms.cameraPosition - fragmentInputs.vWorldPos;
    let viewDist = length(toCam);
    let V = toCam / max(viewDist, 1e-4);
    let L = normalize(uniforms.sunDir);
    let ao = fragmentInputs.vData.x;
    let sunCol = uniforms.sunColor;

    // --- light arriving ------------------------------------------------------------------------------
    let r = rampFor(matId);
    let sh = sampleShadow(fragmentInputs.vWorldPos, N, L, pixel);
    let edgeN = rampEdgeNoise(objPos, 14.0);
    var lit = toonGather(r, N, L, sunCol, sh, ao, edgeN, uniforms.skyColor, uniforms.groundColor);
    for (var i = 0; i < 4; i++) {
        let lp = uniforms.pointPos[i];
        let lc = uniforms.pointCol[i];
        if (lc.w > 0.0) {
            lit = toonAddPoint(lit, N, fragmentInputs.vWorldPos, lp.xyz, lp.w, lc.rgb * lc.w, 3.0);
        }
    }

    // --- material families --------------------------------------------------------------------------
    var col = vec3f(0.0);
    switch matId {
        case 5: {
            // the face: shadow shape from head-space thresholds
            let lightHead = vec3f(dot(L, uniforms.headRight), dot(L, uniforms.headUp), dot(L, uniforms.headForward));
            let face = faceShadow(fragmentInputs.vData.z, fragmentInputs.vData.w, lightHead, 0.015);
            col = skinFace(skinDefault(), albedo, face, sh, N, V, L, lit.ambient, sunCol, uniforms.shadowColor, lit.points);
            col = skinDamage(col, objPos, uniforms.surface.z * 0.6);
            col = skinSweat(col, N, V, L, objPos, uniforms.surface.w, sunCol);
        }
        case 1: {
            col = skinShade(skinDefault(), albedo, N, V, L, lit, sunCol, uniforms.shadowColor, ao);
            col = col + skinTranslucency(N, V, L, ao, skinDefault(), sunCol) * (1.0 - lit.lit);
            col = skinDamage(col, objPos, uniforms.surface.z);
            col = skinSweat(col, N, V, L, objPos, uniforms.surface.w, sunCol);
        }
        case 2: {
            col = hairShade(albedo, N, V, L, uniforms.headUp, objPos, lit, sunCol, uniforms.shadowColor, ao, uniforms.toonParams2.y);
            col = hairWet(col, N, V, L, uniforms.surface.x, sunCol);
            if (uniforms.energy.x > 0.0) {
                let pal = paletteFor(i32(uniforms.energy.y));
                col = hairEnergy(col, objPos, uniforms.heights.y, uniforms.energy.x, paletteRamp(pal, 0.8), time);
            }
        }
        case 3: {
            var ep = eyeDefault();
            if (uniforms.energy.x > 0.0) {
                let pal = paletteFor(i32(uniforms.energy.y));
                ep.glow = uniforms.energy.x * 0.6;
                ep.glowColor = paletteRamp(pal, 0.85);
            }
            col = eyeShade(albedo, N, L, lit.lit, sunCol, lit.ambient, ep, time, objPos);
            col = eyeEmpty(col, albedo, uniforms.heights.w);
        }
        case 4: {
            col = metalShade(albedo, N, V, L, lit, sunCol, uniforms.skyColor, uniforms.groundColor);
        }
        case 6: {
            // painted emissive marks (cursed seals, lantern paper, glowing eyes)
            col = albedo * (1.0 + uniforms.toonParams2.z * 3.0);
        }
        case 7: {
            col = paperShade(albedo, N, V, L, lit, sunCol, uniforms.shadowColor);
        }
        default: {
            col = clothShade(albedo, N, V, L, objPos, lit, sunCol, uniforms.shadowColor, ao, viewDist);
            col = clothWet(col, N, V, L, uniforms.surface.x, sunCol);
            col = clothWear(col, objPos, objPos.y / max(figureH, 0.1), uniforms.surface.y, uniforms.surface.z);
            col = col + toonSpecular(N, L, V, 0.012, 0.004) * lit.lit * uniforms.toonParams2.x * albedo * sunCol * 0.6;
        }
    }

    // --- rims ------------------------------------------------------------------------------------------
    if (matId != MAT_EYE && matId != MAT_EMISSIVE) {
        col = col + rimBack(N, V, L, 0.13, uniforms.rimColor, albedo) * uniforms.toonParams.w;
        col = col + rimWrap(N, V, L, sunCol * albedo, 0.12) * lit.lit;
        // weather and wear on everyone
        col = fxRain(col, N, V, L, objPos, uniforms.surface.x, time, sunCol);
        col = fxDust(col, objPos, N, uniforms.surface.y * 0.5);
    }

    // --- story transformations ----------------------------------------------------------------------------
    col = fxPaperCreep(col, objPos, N, uniforms.surface2.x);
    col = fxMemory(col, lit.lit, uniforms.surface2.y);

    // --- the fight ----------------------------------------------------------------------------------------
    if (uniforms.energy.x > 0.0) {
        col = fxEnergyFlow(col, N, V, objPos, uniforms.energy.x, i32(uniforms.energy.y), time);
    }
    col = fxBlackSpark(col, objPos, uniforms.surface2.z, time);
    col = fxVow(col, N, V, L, lit.lit, uniforms.energy.z, time);
    // the Vow's sigils crawl from the hands toward the heart
    let sig = marksSigils(objPos, figureH, uniforms.energy.z, time);
    col = mix(col, vec3f(0.05, 0.0, 0.01), sig.x * 0.85) + vec3f(1.2, 0.05, 0.08) * sig.y;
    // a long fight shows on the body: scratches, grime, rips, a trickle of ink
    let dmg = uniforms.surface.z;
    if (dmg > 0.05 && matId != MAT_EYE && matId != MAT_EMISSIVE) {
        col = mix(col, col * 0.55, marksGrime(objPos, ao, figureH, dmg) * 0.5);
        col = mix(col, col * 0.45 + vec3f(0.12, 0.02, 0.03), marksScratches(objPos, N, dmg) * 0.7);
        if (matId != MAT_SKIN && matId != MAT_FACE) {
            let rip = marksRips(objPos, dmg);
            col = mix(col, vec3f(0.03, 0.02, 0.025), rip.x);
            col = mix(col, col * 1.25 + vec3f(0.06), rip.y * 0.6);
        }
        if (matId == MAT_FACE || matId == MAT_SKIN) {
            col = mix(col, vec3f(0.05, 0.01, 0.02), marksTrickle(objPos, figureH, uniforms.heights.y / max(figureH, 0.1), dmg));
        }
    }
    col = col + fxHurtRim(N, V, -uniforms.headForward, uniforms.heights.z);
    col = fxDissolveGlow(col, dissolveEdge, i32(uniforms.energy.y));
    if (uniforms.domainParams.x > 0.0) {
        col = fxDomainWash(col, uniforms.domainParams.x, i32(uniforms.domainParams.y));
    }
    col = fxStillwater(col, fragmentInputs.vWorldPos, vec3f(0.0), uniforms.surface2.w, time);
    col = fxHitFlash(col, uniforms.flash);
    fragmentOutputs.color = vec4f(max(col, vec3f(0.0)), 1.0);
}
