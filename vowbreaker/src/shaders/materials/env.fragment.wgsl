// Environment shader: fragment stage.
// Procedural pattern by id (bricks, tatami, shoji, asphalt...), surface-gradient bump from the
// pattern's height, two-tone toon light with the sun's shadow map and a painterly edge, cool
// hemispheric fill, AO, stepped coloured point lights, emissive patterns, rain wetness with
// puddles and ripple normals, graphite hatching in the shadows, glowing battle cracks on floors.
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
uniform glowColor: vec3f;       // colour behind shoji / in lanterns / neon base
uniform tintColor: vec4f;       // multiplies the whole stage (flashback paper, domain), a = amount
uniform cracks: array<vec4f, 8>; // xz centre, radius, palette id (palette < 0: unused)
uniform domainParams: vec4f;    // amount, palette

var shadowMap: texture_2d<f32>;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let time = uniforms.envParams.x;
    let wet = uniforms.envParams.y;
    let id = decodePatternId(fragmentInputs.vColor.a);
    let P = fragmentInputs.vWorldPos;
    var N = normalize(fragmentInputs.vNormalW);
    let V = normalize(uniforms.cameraPosition - P);
    let L = normalize(uniforms.sunDir);
    let pixel = fragmentInputs.position.xy;

    // --- pattern and bump ------------------------------------------------------------------------------
    let pat = evalPattern(id, P, N, time, wet, fragmentInputs.vSeed, uniforms.glowColor);
    var albedo = fragmentInputs.vColor.rgb * pat.tint;
    albedo = adjustSaturation(albedo, uniforms.envParams2.w);
    N = bumpFromHeight(P, N, pat.height, uniforms.envParams2.x * 0.012);

    // --- rain: wet darkening, puddles on floors with ripples ---------------------------------------------
    var gloss = pat.gloss;
    var puddle = 0.0;
    if (wet > 0.0) {
        let up = smoothstep(0.75, 0.95, N.y);
        albedo = wetAlbedo(albedo, wet * (0.5 + 0.5 * up), 0.6);
        gloss = max(gloss, wet * 0.6 * up);
        puddle = puddleMask(P.xz, uniforms.envParams2.y * wet) * up * (1.0 - pat.line);
        if (puddle > 0.0) {
            let rip = rainRipples(P.xz, time, 2.5);
            N = normalize(mix(N, normalize(vec3f(rip.x, 1.0, rip.y)), puddle));
            gloss = mix(gloss, 1.0, puddle);
        }
    }

    // --- light ----------------------------------------------------------------------------------------------
    var sh = 1.0;
    if (uniforms.shadowParams.w > 0.5) {
        let s = shadowProject(P + N * 0.04, uniforms.lightViewProj, uniforms.shadowParams.x);
        let bias = shadowBias(N, L, uniforms.shadowParams.y, uniforms.shadowParams.y * 3.0);
        sh = shadowEdgeFade(s, shadowPCF5(shadowMap, s, bias, uniforms.shadowParams.z));
        sh = stylizeShadowEdge(sh, P, 6.0, 0.35);
    }
    let hl = halfLambert(N, L);
    let ao = fragmentInputs.vAO;
    let lit = celStep(hl, uniforms.envParams.w, 0.03, ao, 0.35) * sh;
    let ambient = hemiAmbient(N, uniforms.skyColor, uniforms.groundColor);
    let shadowCol = shadowTint(albedo, uniforms.shadowColor, 0.15) * (ambient + vec3f(0.05));
    let litCol = albedo * (uniforms.sunColor + ambient * 0.4);
    var col = mix(shadowCol, litCol, lit) * mix(0.7, 1.0, ao);

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

    // coloured point lights (lanterns, techniques), stepped
    for (var i = 0; i < 4; i++) {
        let lc = uniforms.pointCol[i];
        if (lc.w > 0.0) {
            let lp = uniforms.pointPos[i];
            let k = toonPointLight(N, P, lp.xyz, lp.w, 4.0);
            col = col + albedo * lc.rgb * lc.w * k;
            if (gloss > 0.0) {
                let R = reflect(-V, N);
                let toL = normalize(lp.xyz - P);
                col = col + lc.rgb * lc.w * pow(max(dot(R, toL), 0.0), 60.0) * gloss * glowFalloff(distance(lp.xyz, P), lp.w * 1.5);
            }
        }
    }

    // emissive patterns
    col = col + pat.emissive * (1.0 + uniforms.envParams2.z);

    // --- battle damage: glowing cracks where techniques hit the floor -------------------------------------------
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
