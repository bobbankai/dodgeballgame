// Environment shader: fragment stage.
//
// Procedural pattern by id (bricks, tatami, shoji, asphalt...), then the life the place has lived
// (vb_env_detail: moss, stains, rust, cracks, posters, graffiti, fallen leaves and petals), a
// surface-gradient bump from the combined height, then weather (vb_weather: soaking by exposure,
// streaks, puddles with rain rings and wind ripples, drips, splashes, snow, ash with embers,
// frost, lightning), then light: the sun through its shadow map with a painted edge, cloud
// shadows, dapples through leaves, sky fill by openness, ground bounce, the moon, fire, lantern
// pools, window light on the street, stepped coloured point lights, glossy and wet reflections of
// the sky, graphite hatching in the shadows, emissive patterns, glowing battle cracks, the
// domain wash and the stage-wide tint.
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
#include<vb_water>
#include<vb_vfx>
#include<vb_patterns>
#include<vb_surface>
#include<vb_noise2>
#include<vb_env_detail>
#include<vb_weather>
#include<vb_env_light>
#include<vb_env_foliage>

varying vWorldPos: vec3f;
varying vNormalW: vec3f;
varying vColor: vec4f;
varying vAO: f32;
varying vSeed: f32;

uniform cameraPosition: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform skyColor: vec3f;
uniform groundColor: vec3f;
uniform shadowColor: vec3f;
uniform lightViewProj: mat4x4f;
uniform shadowParams: vec4f;
uniform pointPos: array<vec4f, 4>;
uniform pointCol: array<vec4f, 4>;
uniform envParams: vec4f;       // time, wetness, hatching amount, toon threshold
uniform envParams2: vec4f;      // bump strength, puddles, glow boost, saturation
uniform envParams3: vec4f;      // age, urban decoration, season (0 spring .. 1 autumn), litter
uniform envParams4: vec4f;      // rain, snow, ash, frost
uniform envParams5: vec4f;      // cloud coverage, dapples, window light, lightning flash
uniform envParams6: vec4f;      // moonlight, fire light strength, wind x, wind z
uniform firePos: vec4f;         // xyz, radius
uniform glowColor: vec3f;       // colour behind shoji / in lanterns / neon base
uniform tintColor: vec4f;       // multiplies the whole stage (flashback paper, domain), a = amount
uniform cracks: array<vec4f, 8>; // xz centre, radius, palette id (palette < 0: unused)
uniform domainParams: vec4f;    // amount, palette

var shadowMap: texture_2d<f32>;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let time = uniforms.envParams.x;
    let id = decodePatternId(fragmentInputs.vColor.a);
    let P = fragmentInputs.vWorldPos;
    var N = normalize(fragmentInputs.vNormalW);
    let V = normalize(uniforms.cameraPosition - P);
    let L = normalize(uniforms.sunDir);
    let ao = fragmentInputs.vAO;
    let wind = uniforms.envParams6.zw;
    let w = weatherOf(uniforms.envParams4.x, uniforms.envParams.y, uniforms.envParams4.y, uniforms.envParams4.z, uniforms.envParams4.w,
                      uniforms.envParams5.w, wind);

    // --- pattern, the place's history, bump -------------------------------------------------------------
    let wetHere = weatherWetness(w, N, ao, P, time);
    let pat = evalPattern(id, P, N, time, wetHere, fragmentInputs.vSeed, uniforms.glowColor);
    let det = detailFor(id, P, N, ao, fragmentInputs.vSeed, uniforms.envParams3.x, uniforms.envParams3.y, uniforms.envParams3.z, uniforms.envParams3.w);
    var albedo = detailApply(fragmentInputs.vColor.rgb * pat.tint, det);
    albedo = adjustSaturation(albedo, uniforms.envParams2.w);
    N = bumpFromHeight(P, N, pat.height + det.height, uniforms.envParams2.x * 0.012);

    // --- foliage: clumped crowns, leafy silhouettes, blossoms, the season ------------------------------------
    let isLeaf = id == PAT_FOLIAGE;
    var leafGlint = 0.0;
    if (isLeaf) {
        let fo = foliageShade(P, N, V, albedo, uniforms.envParams3.z, time, length(wind), fragmentInputs.vSeed);
        if (fo.cut > 0.5) {
            discard;
        }
        N = fo.n;
        albedo = fo.albedo;
        leafGlint = fo.glint;
    }

    // --- weather: soaking, puddles, splashes -------------------------------------------------------------
    var gloss = clamp(pat.gloss + det.gloss, 0.0, 1.0);
    var puddle = 0.0;
    if (wetHere > 0.0) {
        albedo = weatherWetAlbedo(albedo, wetHere, 0.6);
        gloss = max(gloss, wetHere * 0.6 * smoothstep(0.75, 0.95, N.y));
        let pd = weatherPuddle(w, P, N, time, uniforms.envParams2.y * (1.0 - pat.line));
        puddle = pd.x;
        if (puddle > 0.0) {
            N = normalize(mix(N, normalize(vec3f(pd.y, 1.0, pd.z)), puddle));
            gloss = mix(gloss, 1.0, puddle);
        }
    }

    // --- light -------------------------------------------------------------------------------------------
    var sh = 1.0;
    if (uniforms.shadowParams.w > 0.5) {
        let s = shadowProject(P + N * 0.04, uniforms.lightViewProj, uniforms.shadowParams.x);
        let bias = shadowBias(N, L, uniforms.shadowParams.y, uniforms.shadowParams.y * 3.0);
        sh = shadowEdgeFade(s, shadowPCF5(shadowMap, s, bias, uniforms.shadowParams.z));
        sh = stylizeShadowEdge(sh, P, 6.0, 0.35);
    }
    sh = sh * envCloudShadow(P, L, wind, time, uniforms.envParams5.x, 0.035);
    sh = sh * envDapples(P, N, L, time, uniforms.envParams5.y, length(wind));
    let hl = halfLambert(N, L);
    let lit = celStep(hl, uniforms.envParams.w, 0.03, ao, 0.35) * sh;
    let ambient = hemiAmbient(N, uniforms.skyColor, uniforms.groundColor) * 0.6 + envSkyFill(N, ao, uniforms.skyColor, uniforms.groundColor) * 0.4;
    let shadowCol = shadowTint(albedo, uniforms.shadowColor, 0.15) * (ambient + vec3f(0.05));
    let litCol = albedo * (uniforms.sunColor * envSunPatches(P, L, time, uniforms.envParams5.y * 0.5) + ambient * 0.4);
    var col = mix(shadowCol, litCol, lit) * mix(0.7, 1.0, ao);
    if (isLeaf) {
        col = foliageShadowTint(col, lit);
        col = col + foliageTranslucency(N, V, L, uniforms.sunColor, albedo) * (1.0 - lit * 0.7);
        col = col + uniforms.sunColor * leafGlint * lit * 0.6;
    }
    col = col + albedo * envBounce(N, P, uniforms.groundColor, uniforms.sunColor, 1.0);
    col = col + albedo * envMoonlight(N, V, normalize(vec3f(-0.3, 0.8, 0.5)), gloss, uniforms.envParams6.x);
    col = col + albedo * envFireLight(P, N, uniforms.firePos.xyz, uniforms.firePos.w, time, uniforms.envParams6.y);
    col = col + envWindowLight(P, N, time, uniforms.envParams5.z, uniforms.glowColor) * albedo * 2.0;

    // graphite hatching in the shadows (very light: a sketchbook texture, not a pencil drawing)
    if (uniforms.envParams.z > 0.0) {
        let dark = (1.0 - lit) * (1.0 - luma(col) * 0.8);
        let h = hatchTriplanar(P * 6.0, N, dark, 1.0);
        col = col * (1.0 - h * 0.18 * uniforms.envParams.z);
    }

    // glossy / wet: a stepped reflection of the sky and a sharp sun glint
    if (gloss > 0.0) {
        let R = reflect(-V, N);
        let skyRefl = mix(uniforms.groundColor, uniforms.skyColor * 1.4, smoothstep(-0.2, 0.4, R.y));
        let fres = fresnelSchlick(max(dot(N, V), 0.0), 0.04);
        col = mix(col, skyRefl, gloss * (0.15 + 0.6 * fres) * (0.5 + 0.5 * puddle));
        let glint = toonSpecular(N, L, V, 0.015, 0.004) * sh;
        col = col + uniforms.sunColor * glint * gloss * 2.0;
    }

    // coloured point lights (lanterns, techniques), stepped, with pools and wet-floor streaks
    for (var i = 0; i < 4; i++) {
        let lc = uniforms.pointCol[i];
        if (lc.w > 0.0) {
            let lp = uniforms.pointPos[i];
            col = col + albedo * envLanternPool(P, N, lp.xyz, lc.rgb * lc.w, lp.w);
            col = col + envNeonSpill(P, N, lp.xyz, lc.rgb * lc.w, lp.w * 0.5, wetHere) * albedo;
            if (gloss > 0.0) {
                let R = reflect(-V, N);
                let toL = normalize(lp.xyz - P);
                col = col + lc.rgb * lc.w * pow(max(dot(R, toL), 0.0), 60.0) * gloss * glowFalloff(distance(lp.xyz, P), lp.w * 1.5);
            }
        }
    }

    // drips and splashes catch the light
    col = col + (uniforms.sunColor * 0.5 + uniforms.skyColor) * (weatherDrips(w, P, N, ao, time) + weatherSplashes(w, P, N, time)) * 0.6;

    // emissive patterns and details
    col = col + (pat.emissive + det.emissive) * (1.0 + uniforms.envParams2.z);

    // snow, ash, frost, lightning
    col = weatherSnow(w, col, P, N, ao, V, L);
    col = weatherAsh(w, col, P, N, time);
    col = weatherFrost(w, col, P, N, ao);
    col = weatherLightning(w, col, albedo, N);

    // --- battle damage: glowing cracks where techniques hit the floor -------------------------------------
    if (N.y > 0.6) {
        for (var i = 0; i < 8; i++) {
            let c = uniforms.cracks[i];
            if (c.w >= 0.0 && c.z > 0.0) {
                let pal = paletteFor(i32(c.w));
                let cr = crackOverlay(P.xz, c.xy, c.z, pal.body * 3.0);
                col = mix(col, col * 0.25, cr.a * 0.8) + cr.rgb;
            }
        }
    }

    // domain wash and stage-wide tint (flashbacks)
    if (uniforms.domainParams.x > 0.0) {
        let pal = paletteFor(i32(uniforms.domainParams.y));
        col = mix(col, pal.dark + col * pal.body * 0.6, uniforms.domainParams.x * 0.6);
    }
    col = mix(col, col * uniforms.tintColor.rgb, uniforms.tintColor.a);
    fragmentOutputs.color = vec4f(max(col, vec3f(0.0)), 1.0);
}
