// Character toon shader: fragment stage.
// Two-tone cel shading with artist-controlled thresholds (AO in the vertex data pushes creases into
// shadow), cool shadow colours that keep the base hue, a warm terminator and scattered red on skin,
// per-vertex face shadows in head space, an anime hair ring, stepped highlights, a back rim,
// stepped point lights from cursed energy, an energy aura, the Vow's red, dissolves and hit flashes.
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

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let time = uniforms.toonParams2.w;
    let matId = decodeMaterialId(fragmentInputs.vColor.a);
    let pixel = fragmentInputs.position.xy;

    // --- dissolve (curses fading out, the Little Bell letting go) -------------------------------
    var dissolveEdge = 0.0;
    if (uniforms.energy.w > 0.0) {
        let n = vfbm3(fragmentInputs.vObjPos * 5.0, 3) * 0.75 + (1.0 - clamp(fragmentInputs.vObjPos.y / 2.0, 0.0, 1.0)) * 0.25;
        let d = dissolve(n, uniforms.energy.w, 0.08);
        if (d.x < 0.5) {
            discard;
        }
        dissolveEdge = d.y;
    }

    var albedo = fragmentInputs.vColor.rgb * uniforms.tint.rgb;
    albedo = adjustSaturation(albedo, uniforms.tint.a);
    let N = normalize(fragmentInputs.vNormalW);
    let V = normalize(uniforms.cameraPosition - fragmentInputs.vWorldPos);
    let L = normalize(uniforms.sunDir);
    let ao = fragmentInputs.vData.x;

    let threshold = uniforms.toonParams.x;
    let softness = uniforms.toonParams.y;
    let aoInfluence = uniforms.toonParams.z;

    // --- key light --------------------------------------------------------------------------------
    let sh = sampleShadow(fragmentInputs.vWorldPos, N, L, pixel);
    let hl = halfLambert(N, L);
    var lit = celStep(hl, threshold, softness, ao, aoInfluence) * sh;
    if (matId == MAT_FACE) {
        let lightHead = vec3f(dot(L, uniforms.headRight), dot(L, uniforms.headUp), dot(L, uniforms.headForward));
        let face = faceShadow(fragmentInputs.vData.z, fragmentInputs.vData.w, lightHead, 0.015);
        // the face ignores most cast shadow (hair shadow on the face reads as noise) but a fighter
        // standing in a building's shadow still goes dark
        lit = face * mix(1.0, sh, 0.75);
    }

    let ambient = hemiAmbient(N, uniforms.skyColor, uniforms.groundColor);
    let shadowCol = shadowTint(albedo, uniforms.shadowColor, 0.2) * (ambient + vec3f(0.08)) ;
    let litCol = albedo * (uniforms.sunColor + ambient * 0.35);
    var col = mix(shadowCol, litCol, lit);

    // warm terminator: a narrow band of saturated colour where light turns to shadow
    let band = terminatorBand(hl, threshold + (1.0 - ao) * aoInfluence, softness * 3.0 + 0.04) * sh;
    col = col + adjustSaturation(albedo, 1.6) * uniforms.sunColor * band * 0.12;

    switch matId {
        case 1, 5: {
            // skin: red scattered into the shadow edge, a soft cheek blush stays in shadow too
            col = col + skinScatter(hl, threshold, vec3f(0.75, 0.18, 0.12) * albedo, 0.12) * uniforms.sunColor * 0.5;
        }
        case 2: {
            // hair: Kajiya-Kay along the strands (they run down, roughly -Y in object space) plus
            // the crisp angel ring, broken into strands
            let strandAngle = atan2(fragmentInputs.vObjPos.z, fragmentInputs.vObjPos.x);
            let strand = valueNoise2(vec2f(strandAngle * 22.0, fragmentInputs.vObjPos.y * 2.0));
            let ring = angelRing(N, V, uniforms.headUp, 0.45, 0.16, strand);
            let kk = kajiyaKay(-uniforms.headUp, L, V, (strand - 0.5) * 0.3, N, 80.0);
            let hiCol = mix(albedo, vec3f(1.0), 0.55) * uniforms.sunColor;
            col = col + hiCol * (step(0.5, ring) * 0.55 + smoothstep(0.5, 0.7, kk) * 0.25 * lit) * uniforms.toonParams2.y;
        }
        case 3: {
            // eyes: painted, mostly unlit so they never go dead in shadow
            col = albedo * mix(0.78, 1.0, lit) * (uniforms.sunColor * 0.25 + vec3f(0.75));
        }
        case 4: {
            // metal: a big stepped highlight and a fake environment band
            let spec = toonSpecular(N, L, V, 0.12, 0.02) * lit;
            let env = smoothstep(-0.1, 0.3, reflect(-V, N).y);
            col = mix(col * 0.7, col * 1.3, env) + uniforms.sunColor * spec * 1.5;
        }
        case 6: {
            // painted emissive marks (cursed seals, lantern light on robes)
            col = albedo * (1.0 + uniforms.toonParams2.z * 3.0);
        }
        case 7: {
            // paper: light passes through, so the shadow side stays bright and warm
            let through = pow(clamp(dot(-V, L), 0.0, 1.0), 4.0);
            col = mix(col, albedo * uniforms.sunColor * 1.1, 0.35) + albedo * through * 0.6;
        }
        default: {
            let spec = toonSpecular(N, L, V, 0.04, 0.01) * lit * uniforms.toonParams2.x;
            col = col + uniforms.sunColor * spec * 0.35;
        }
    }

    // --- back rim: crisp band of rim colour on the side away from the key light --------------------
    let rim = toonRim(N, V, -L, 0.22, 0.02, 0.7) * uniforms.toonParams.w;
    col = col + uniforms.rimColor * rim * (0.6 + 0.4 * luma(albedo));

    // --- cursed energy lights (techniques, lanterns, the bell), stepped into bands -----------------
    for (var i = 0; i < 4; i++) {
        let lp = uniforms.pointPos[i];
        let lc = uniforms.pointCol[i];
        if (lc.w > 0.0) {
            let k = toonPointLight(N, fragmentInputs.vWorldPos, lp.xyz, lp.w, 3.0);
            col = col + albedo * lc.rgb * lc.w * k;
            col = col + lc.rgb * lc.w * toonRim(N, V, normalize(lp.xyz - fragmentInputs.vWorldPos), 0.18, 0.03, 1.0) * glowFalloff(distance(lp.xyz, fragmentInputs.vWorldPos), lp.w) * 0.6;
        }
    }

    // --- energy aura over the body ------------------------------------------------------------------
    if (uniforms.energy.x > 0.0) {
        let pal = paletteFor(i32(uniforms.energy.y));
        let f = energyFlame(fragmentInputs.vObjPos, vec3f(0.0, 1.0, 0.0), steppedTime(time, 12.0), 2.4);
        let fres = fresnelRim(N, V, 1.6);
        let heat = energyBands(f * fres * 1.4 * uniforms.energy.x, 0.25, 0.5, 0.78);
        col = mix(col, paletteRamp(pal, heat) * 2.0, step(0.3, heat) * 0.85);
    }

    // --- the Vow: a burning red overlay and darker shadows ------------------------------------------
    if (uniforms.energy.z > 0.0) {
        let v = uniforms.energy.z;
        col = mix(col, col * vec3f(1.25, 0.55, 0.55), v * (1.0 - lit) * 0.7);
        col = col + vec3f(0.9, 0.05, 0.08) * toonRim(N, V, L, 0.3, 0.02, 0.0) * v * 0.9;
    }

    // dissolve edge glows in the curse's palette
    if (dissolveEdge > 0.0) {
        let pal = paletteFor(i32(uniforms.energy.y));
        col = col + paletteRamp(pal, 0.9) * dissolveEdge * 4.0;
    }

    // domain: the caster's palette washes over everyone inside
    if (uniforms.domainParams.x > 0.0) {
        let pal = paletteFor(i32(uniforms.domainParams.y));
        col = mix(col, col * mix(vec3f(1.0), pal.body * 1.4, 0.5), uniforms.domainParams.x * 0.35);
    }

    col = mix(col, uniforms.flash.rgb, uniforms.flash.a);
    fragmentOutputs.color = vec4f(max(col, vec3f(0.0)), 1.0);
}
