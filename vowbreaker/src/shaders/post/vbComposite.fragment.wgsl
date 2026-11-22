// Composite: the lit scene plus everything that needs the G-buffer.
//   * ambient obscurance applied as a cool wash, never as grey
//   * ink lines from depth, normal and object-id discontinuities, with distance-based weight, a
//     hand-drawn boil (the sampling jitters on 2s) and dry-brush break-up
//   * height fog with sun in-scattering and painted aerial perspective
//   * the domain's repaint front: a glowing ring that sweeps out from the caster
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_toon>
#include<vb_atmosphere>
#include<vb_vfx>
#include<vb_lineart>

varying vUV: vec2f;

var sceneTex: texture_2d<f32>;
var sceneTexSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;
var aoTex: texture_2d<f32>;
var aoTexSampler: sampler;
var contactTex: texture_2d<f32>;
var contactTexSampler: sampler;
var giTex: texture_2d<f32>;
var giTexSampler: sampler;

uniform projParams: vec4f;      // tan(fovY/2), aspect, near, far
uniform screenParams: vec4f;    // width, height, 1/width, 1/height
uniform invView: mat4x4f;
uniform cameraPos: vec3f;
uniform aoParams: vec4f;        // strength, -, -, -
uniform aoTint: vec3f;
uniform ssParams: vec4f;        // contact shadow strength, bounce light strength, -, -
uniform contactTint: vec3f;     // the colour a contact shadow takes (the stage's shadow colour)
uniform lineParams: vec4f;      // width px, depth threshold, normal threshold, strength
uniform lineParams2: vec4f;     // boil fps, boil amount px, breakup, far fade distance
uniform lineColor: vec3f;
uniform lineParams3: vec4f;     // fighter line weight, colour-from-surface amount, manga hatching, -
uniform fogParams: vec4f;       // density, height falloff, base height, max opacity
uniform fogColor: vec3f;
uniform aerialParams: vec4f;    // start, end, desaturate, strength
uniform horizonColor: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform domainParams: vec4f;    // amount (0..1 progress of the repaint front), radius, palette id, active
uniform domainCenter: vec3f;
uniform time: f32;

fn viewPosAt(uv: vec2f, z: f32) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    return vec3f(ndc.x * uniforms.projParams.x * uniforms.projParams.y * z, ndc.y * uniforms.projParams.x * z, z);
}

fn gb(uv: vec2f) -> vec4f {
    return textureSampleLevel(gbuffer, gbufferSampler, uv, 0.0);
}

// edge strength between the centre texel and one neighbour
fn edgeTerm(c: vec4f, o: vec4f) -> f32 {
    let zc = c.b;
    let zo = o.b;
    let skyC = step(500.0, zc);
    let skyO = step(500.0, zo);
    if (skyC > 0.5 && skyO > 0.5) {
        return 0.0;
    }
    // silhouettes against the sky
    if (skyC + skyO > 0.5) {
        return 1.0;
    }
    // depth: a relative jump (scaled so grazing floors don't fire)
    let dz = abs(zc - zo) / max(min(zc, zo), 0.1);
    let depthEdge = smoothstep(uniforms.lineParams.y, uniforms.lineParams.y * 2.0, dz);
    // normals
    let nc = octDecode(c.rg);
    let no = octDecode(o.rg);
    let normalEdge = smoothstep(uniforms.lineParams.z, uniforms.lineParams.z * 1.8, 1.0 - dot(nc, no));
    // different objects or painted parts
    let idEdge = step(0.5, abs(c.a - o.a));
    return max(max(depthEdge, normalEdge * 0.85), idEdge * 0.9);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    var col = textureSampleLevel(sceneTex, sceneTexSampler, uv, 0.0).rgb;
    let g = gb(uv);
    let z = g.b;
    let isSky = z > 500.0;
    let pixel = uv * uniforms.screenParams.xy;

    // --- ambient obscurance as a cool wash ---------------------------------------------------------
    if (!isSky) {
        let ao = textureSampleLevel(aoTex, aoTexSampler, uv, 0.0).r;
        let occl = (1.0 - ao) * uniforms.aoParams.x;
        col = col * mix(vec3f(1.0), uniforms.aoTint, clamp(occl, 0.0, 1.0));
        // contact shadows: the small shadows under feet and hands the shadow map cannot resolve
        if (uniforms.ssParams.x > 0.0) {
            let cs = textureSampleLevel(contactTex, contactTexSampler, uv, 0.0).r;
            col = col * mix(vec3f(1.0), uniforms.contactTint, (1.0 - cs) * uniforms.ssParams.x);
        }
        // one bounce of colour from the surroundings
        if (uniforms.ssParams.y > 0.0) {
            let gi = textureSampleLevel(giTex, giTexSampler, uv, 0.0).rgb;
            col = col + gi * uniforms.ssParams.y;
        }
    }

    // --- ink lines -------------------------------------------------------------------------------------
    if (uniforms.lineParams.w > 0.0) {
        let boil = boilOffset(pixel * 0.02, uniforms.time, uniforms.lineParams2.x, uniforms.lineParams2.y);
        // lines thin out with distance, like a pen lifting off for the background
        let distW = mix(1.0, 0.45, smoothstep(4.0, uniforms.lineParams2.w, min(z, 200.0)));
        let w = uniforms.lineParams.x * distW;
        let px = uniforms.screenParams.zw * w;
        let c = gb(uv + boil * uniforms.screenParams.zw);
        // the line's weight depends on what it outlines: sample at the widest weight it could have,
        // keep a neighbour's edge only if this pixel lies within that edge's own weight
        var e = 0.0;
        for (var k = 0; k < 8; k++) {
            let a = f32(k) * 0.785398;
            let dir = vec2f(cos(a), sin(a));
            let far = gb(uv + dir * px * uniforms.lineParams3.x * 1.35);
            let near = gb(uv + dir * px);
            let ew = lineWeight(c, far, uniforms.lineParams3.x);
            let le = lineEdge(c, far, uniforms.lineParams.y, uniforms.lineParams.z);
            let ln = lineEdge(c, near, uniforms.lineParams.y, uniforms.lineParams.z);
            let reach = select(0.0, 1.0, ew > 1.15);
            let diag = select(1.0, 0.75, k % 2 == 1);
            e = max(e, max(ln.strength, le.strength * reach) * diag);
        }
        // stroke confidence: weak edges thin and break, strong ones stay solid
        e = lineConfidence(e, pixel, uniforms.time, uniforms.lineParams2.x);
        // dry-brush break-up along the stroke
        let brk = valueNoise2(pixel * 0.08 + vec2f(floor(uniforms.time * uniforms.lineParams2.x) * 7.3));
        e = e * mix(1.0, smoothstep(0.15, 0.55, brk), uniforms.lineParams2.z);
        // coloured ink: a deep shade of the surface it borders, fading in the distance
        let ink = mix(uniforms.lineColor, lineColorFor(col, inkLineColor(col, 0.85, 1.0) * 0.5, 0.6), uniforms.lineParams3.y);
        let fade = 1.0 - smoothstep(uniforms.lineParams2.w * 0.6, uniforms.lineParams2.w * 1.6, min(z, 300.0)) * 0.7;
        col = mix(col, ink, clamp(e * uniforms.lineParams.w * fade, 0.0, 1.0));
        // manga hatching in the deep shadows on fighters (dramatic moments)
        if (uniforms.lineParams3.z > 0.0 && lineIsFighter(c.a)) {
            let dark = 1.0 - smoothstep(0.03, 0.25, luma(col));
            col = mix(col, ink * 0.6, lineHatch(pixel, dark, uniforms.screenParams.y / 720.0) * uniforms.lineParams3.z * 0.7);
        }
    }

    // --- fog and aerial perspective ------------------------------------------------------------------------
    if (!isSky) {
        let vp = viewPosAt(uv, z);
        let wp = (uniforms.invView * vec4f(vp, 1.0)).xyz;
        let dist = length(wp - uniforms.cameraPos);
        let vdir = normalize(wp - uniforms.cameraPos);
        col = aerialPerspective(col, dist, uniforms.aerialParams.x, uniforms.aerialParams.y, uniforms.horizonColor, uniforms.aerialParams.z * uniforms.aerialParams.w);
        let fog = heightFog(uniforms.cameraPos, wp, uniforms.fogParams.x, uniforms.fogParams.y, uniforms.fogParams.z) * uniforms.fogParams.w;
        let fc = fogColorWithSun(uniforms.fogColor, uniforms.sunColor * 0.35, vdir, uniforms.sunDir, 8.0);
        col = mix(col, fc, fog);

        // --- the domain's repaint front ----------------------------------------------------------------------
        if (uniforms.domainParams.w > 0.5) {
            let d = length(wp.xz - uniforms.domainCenter.xz);
            let front = uniforms.domainParams.x * uniforms.domainParams.y;
            let ring = shockRing(d, front, 0.6 + front * 0.04);
            let pal = paletteFor(i32(uniforms.domainParams.z));
            let n = valueNoise2(wp.xz * 1.5 + uniforms.time);
            col = col + paletteRamp(pal, 0.8 + 0.2 * n) * ring * 3.0 * (1.0 - uniforms.domainParams.x * 0.5);
        }
    }
    fragmentOutputs.color = vec4f(col, 1.0);
}
