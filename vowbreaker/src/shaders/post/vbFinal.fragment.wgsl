// Final pass: lens, motion, grading, tone mapping and the anime screen effects, written to the canvas.
// Order: distortion (shockwaves, heat, domain twist) -> camera & radial motion blur with chromatic
// aberration -> depth of field -> bloom and light shafts -> white balance, CDL / lift-gamma-gain,
// split toning, flashback filter -> tone curve -> impact frames, speed lines, hit flashes ->
// vignette, grain, letterbox, fades and ink wipes -> sRGB with dither.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_toon>
#include<vb_vfx>

varying vUV: vec2f;

var compositeTex: texture_2d<f32>;
var compositeTexSampler: sampler;
var bloomTex: texture_2d<f32>;
var bloomTexSampler: sampler;
var raysTex: texture_2d<f32>;
var raysTexSampler: sampler;
var dofTex: texture_2d<f32>;
var dofTexSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform screenParams: vec4f;     // width, height, 1/w, 1/h
uniform projParams: vec4f;       // tan(fovY/2), aspect, near, far
uniform invView: mat4x4f;
uniform prevViewProj: mat4x4f;
uniform motionParams: vec4f;     // camera blur, radial blur, radial centre xy
uniform caParams: vec4f;         // chromatic aberration strength, lens distortion, -, -
uniform bloomParams: vec4f;      // intensity, -, -, -
uniform bloomTint: vec3f;
uniform raysColor: vec3f;
uniform dofParams: vec4f;        // amount, -, -, -
uniform grade1: vec4f;           // exposure (EV), contrast, saturation, vibrance
uniform grade2: vec4f;           // temperature, tint, hue shift, split strength
uniform lift: vec3f;
uniform gamma: vec3f;
uniform gain: vec3f;
uniform splitShadow: vec3f;
uniform splitHighlight: vec3f;
uniform tonemapParams: vec4f;    // shoulder, bright desaturation, curve (0 anime, 1 agx, 2 aces), -
uniform fxParams: vec4f;         // impact mode, impact amount, speed lines, desaturation pulse
uniform fxParams2: vec4f;        // flash amount, vignette, grain, letterbox (0..1)
uniform fxCenter: vec2f;
uniform flashColor: vec3f;
uniform flashback: vec4f;        // amount, kept hue, paper, halftone
uniform transition: vec4f;       // to black, to white, wipe progress, wipe kind
uniform shockwaves: array<vec4f, 4>;
uniform extraParams: vec4f;      // vow vignette, domain twist, heat haze, time
uniform domainTint: vec4f;       // rgb, amount

fn sampleScene(uv: vec2f) -> vec3f {
    return textureSampleLevel(compositeTex, compositeTexSampler, clamp(uv, vec2f(0.0005), vec2f(0.9995)), 0.0).rgb;
}

fn worldPosAt(uv: vec2f, z: f32) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    let vp = vec3f(ndc.x * uniforms.projParams.x * uniforms.projParams.y * z, ndc.y * uniforms.projParams.x * z, z);
    return (uniforms.invView * vec4f(vp, 1.0)).xyz;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let time = uniforms.extraParams.w;
    var uv = fragmentInputs.vUV;
    let aspect = uniforms.screenParams.x * uniforms.screenParams.w;
    let pixel = uv * uniforms.screenParams.xy;

    // --- distortions ---------------------------------------------------------------------------------
    for (var i = 0; i < 4; i++) {
        let s = uniforms.shockwaves[i];
        if (s.w > 0.0) {
            let d = aspectCentered(uv, s.xy, aspect);
            let r = length(d);
            let ring = shockRing(r, s.z, 0.03 + s.z * 0.08);
            uv = uv - (d / max(r, 1e-4)) * vec2f(1.0 / aspect, 1.0) * ring * s.w * 0.035;
        }
    }
    if (uniforms.extraParams.z > 0.0) {
        let n = vec2f(valueNoise2(pixel * 0.02 + vec2f(0.0, time * 3.0)), valueNoise2(pixel * 0.02 + vec2f(7.0, time * 2.6))) - 0.5;
        uv = uv + n * uniforms.extraParams.z * 0.006;
    }
    if (uniforms.extraParams.y > 0.0) {
        // the domain unveiling: the world twists into the caster's heart
        uv = twirlUV(uv, vec2f(0.5), uniforms.extraParams.y * 6.0 * (1.0 - length(uv - 0.5)));
    }
    if (uniforms.caParams.y != 0.0) {
        let d = uv - 0.5;
        uv = 0.5 + d * (1.0 + uniforms.caParams.y * dot(d, d));
    }

    // --- motion blur (camera reprojection + radial impact blur) with chromatic aberration -------------
    let z = textureSampleLevel(gbuffer, gbufferSampler, uv, 0.0).b;
    var vel = vec2f(0.0);
    if (uniforms.motionParams.x > 0.0) {
        let wp = worldPosAt(uv, min(z, 300.0));
        let prev = uniforms.prevViewProj * vec4f(wp, 1.0);
        let prevUv = prev.xy / prev.w * 0.5 + 0.5;
        vel = (uv - prevUv) * uniforms.motionParams.x;
        let vl = length(vel);
        vel = vel * min(1.0, 0.05 / max(vl, 1e-5));
    }
    var radial = vec2f(0.0);
    if (uniforms.motionParams.y > 0.0) {
        radial = (uv - uniforms.motionParams.zw) * uniforms.motionParams.y * 0.12;
    }
    let blurVec = vel + radial;
    let ca = uniforms.caParams.x * (uv - 0.5) * length(uv - 0.5) * 0.02;
    var col = vec3f(0.0);
    let taps = select(1, 10, length(blurVec) * uniforms.screenParams.x > 1.0);
    let jitter = interleavedGradientNoise(pixel) - 0.5;
    for (var i = 0; i < taps; i++) {
        let t = select(0.0, (f32(i) + jitter) / f32(taps) - 0.5, taps > 1);
        let suv = uv + blurVec * t;
        if (uniforms.caParams.x > 0.0) {
            col = col + vec3f(sampleScene(suv + ca).r, sampleScene(suv).g, sampleScene(suv - ca).b);
        } else {
            col = col + sampleScene(suv);
        }
    }
    col = col / f32(taps);

    // --- depth of field ------------------------------------------------------------------------------------
    if (uniforms.dofParams.x > 0.0) {
        let d = textureSampleLevel(dofTex, dofTexSampler, uv, 0.0);
        col = mix(col, d.rgb, clamp(d.a * 1.6, 0.0, 1.0) * uniforms.dofParams.x);
    }

    // --- bloom and light shafts --------------------------------------------------------------------------------
    let bloom = textureSampleLevel(bloomTex, bloomTexSampler, uv, 0.0).rgb;
    col = col + bloom * uniforms.bloomTint * uniforms.bloomParams.x;
    let rays = textureSampleLevel(raysTex, raysTexSampler, uv, 0.0).rgb;
    col = col + rays * uniforms.raysColor;

    // --- grading (linear) -----------------------------------------------------------------------------------------
    col = adjustExposure(col, uniforms.grade1.x);
    if (uniforms.grade2.x != 0.0 || uniforms.grade2.y != 0.0) {
        col = max(whiteBalance(col, uniforms.grade2.x, uniforms.grade2.y), vec3f(0.0));
    }
    col = liftGammaGain(col, uniforms.lift, uniforms.gamma, uniforms.gain);
    col = adjustContrast(col, uniforms.grade1.y, 0.18);
    col = adjustSaturation(col, uniforms.grade1.z);
    col = adjustVibrance(col, uniforms.grade1.w);
    if (uniforms.grade2.z != 0.0) {
        col = max(hueRotate(col, uniforms.grade2.z), vec3f(0.0));
    }
    if (uniforms.grade2.w > 0.0) {
        col = splitTone(col, uniforms.splitShadow, uniforms.splitHighlight, 0.0, uniforms.grade2.w);
    }
    if (uniforms.domainTint.a > 0.0) {
        col = mix(col, col * uniforms.domainTint.rgb, uniforms.domainTint.a);
    }
    // desaturation pulse on heavy hits (everything drains but the energy colours)
    if (uniforms.fxParams.w > 0.0) {
        col = selectiveColor(col, 0.0, 0.08, uniforms.fxParams.w);
    }

    // --- tone mapping ---------------------------------------------------------------------------------------------
    let curve = i32(uniforms.tonemapParams.z);
    if (curve == 1) {
        col = tonemapAgx(col, 0.6);
    } else if (curve == 2) {
        col = tonemapAcesFitted(col);
    } else {
        col = tonemapAnime(col, uniforms.tonemapParams.x, uniforms.tonemapParams.y);
    }

    // --- flashback: monochrome paper, one colour kept (Mio's red, Hina's lanterns) --------------------------------
    if (uniforms.flashback.x > 0.0) {
        let fb = uniforms.flashback;
        var m = selectiveColor(col, fb.y, 0.07, 0.92);
        let grain = paperGrain(pixel * 0.012);
        m = m * mix(vec3f(1.0), vec3f(1.04, 0.98, 0.88) * (0.85 + grain * 0.3), fb.z);
        if (fb.w > 0.0) {
            let l = luma(m);
            let dots = halftoneDots(pixel, 4.0, 0.785, 1.0 - l);
            m = mix(m, m * (1.0 - dots * 0.35), fb.w);
        }
        col = mix(col, m, fb.x);
    }

    // --- impact frames ---------------------------------------------------------------------------------------------
    let impact = i32(uniforms.fxParams.x);
    if (impact > 0 && uniforms.fxParams.y > 0.0) {
        let l = luma(col);
        // hard black-and-white split with an inked edge, the classic one- or two-frame "hit"
        let t = smoothstep(0.32, 0.36, l);
        var ic = vec3f(t);
        if (impact == 2) {
            ic = vec3f(1.0 - t);
        } else if (impact == 3) {
            ic = mix(vec3f(0.02, 0.0, 0.01), vec3f(0.95, 0.06, 0.08), t);
        } else if (impact == 4) {
            ic = halftoneCmyk(pixel, col, 6.0);
        }
        let lines = speedLines(uv, uniforms.fxCenter, aspect, time, 90.0, 0.08);
        ic = mix(ic, vec3f(1.0) - ic, lines * 0.85);
        col = mix(col, ic, uniforms.fxParams.y);
    }
    if (uniforms.fxParams.z > 0.0) {
        let lines = speedLines(uv, uniforms.fxCenter, aspect, time, 70.0, 0.22);
        col = mix(col, vec3f(1.0), lines * uniforms.fxParams.z * 0.75);
    }
    if (uniforms.fxParams2.x > 0.0) {
        col = mix(col, uniforms.flashColor, uniforms.fxParams2.x);
    }

    // --- lens and film -------------------------------------------------------------------------------------------------
    let vd = aspectCentered(uv, vec2f(0.5), aspect);
    let vig = 1.0 - smoothstep(0.45, 1.25, length(vd)) * uniforms.fxParams2.y;
    col = col * vig;
    if (uniforms.extraParams.x > 0.0) {
        // the Vow: the screen's edges burn red
        let edge = smoothstep(0.35, 1.0, length(vd));
        let flick = 0.8 + 0.2 * valueNoise2(vec2f(time * 6.0, 0.0));
        col = mix(col, vec3f(0.55, 0.0, 0.03), edge * uniforms.extraParams.x * flick * 0.8);
    }
    if (uniforms.fxParams2.z > 0.0) {
        let gr = hash12(pixel + vec2f(fract(time * 23.0) * 100.0)) - 0.5;
        let lum = luma(col);
        col = col + gr * uniforms.fxParams2.z * (0.6 + 0.4 * (1.0 - lum));
    }

    // --- letterbox, fades and wipes ----------------------------------------------------------------------------------------
    let bars = uniforms.fxParams2.w * 0.12;
    if (fragmentInputs.vUV.y < bars || fragmentInputs.vUV.y > 1.0 - bars) {
        col = vec3f(0.0);
    }
    col = mix(col, vec3f(0.0), uniforms.transition.x);
    col = mix(col, vec3f(1.0), uniforms.transition.y);
    if (uniforms.transition.z > 0.0) {
        // an ink wipe: a brush-edged band of black sweeping across (kind 0) or closing in (kind 1)
        let n = fbm2(fragmentInputs.vUV * vec2f(3.0, 12.0) + 3.1, 4, 2.0, 0.5) * 0.12;
        var cover = 0.0;
        if (uniforms.transition.w < 0.5) {
            cover = step(fragmentInputs.vUV.x + n, uniforms.transition.z * 1.3 - 0.1);
        } else {
            cover = step(1.0 - uniforms.transition.z * 1.2, length(vd) * 0.9 + n);
        }
        col = mix(col, vec3f(0.01, 0.005, 0.01), cover);
    }

    col = clamp(col, vec3f(0.0), vec3f(1.0));
    var outc = linearToSrgb(col);
    outc = ditherTriangular(outc, hash22(pixel + fract(time)));
    fragmentOutputs.color = vec4f(outc, 1.0);
}
