// Stylize (display-referred, after the final pass): the hand-made layer over the image.
//   lens       raindrops sitting and running on the lens refract the image behind them (rain
//              stages); frost creeps in from the edges (the estate, Stillwater)
//   painting   memories are repainted with a generalised Kuwahara filter (flat watercolour
//              shapes that keep their edges), pooled at colour edges and laid on paper
//   ink        a luminance-edge pass darkens and thickens contours slightly (inked cels)
//   tone       manga screentone in the darkest shadows; the manga page look for still frames
//   film       old film for flashbacks: gate weave, shutter flicker, dust, hairs, scratches,
//              light leaks
//   manga      focus lines on a face, sparkles, gloom lines, panel splits, a sound effect burst
//   fluid      ink in water over the screen (compute/fluid.wgsl): the dye laid on as banded ink with
//              pooled edges, the velocity bending the image under it
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_toon>
#include<vb_vfx>
#include<vb_ink>
#include<vb_lens>
#include<vb_film>
#include<vb_manga>
#include<vb_fluid>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var fluidDye: texture_2d<f32>;
var fluidDyeSampler: sampler;
var fluidVel: texture_2d<f32>;
var fluidVelSampler: sampler;

uniform screenParams: vec4f;     // width, height, 1/w, 1/h
uniform styleParams: vec4f;      // screentone, paper, ink edges, painterly (kuwahara) amount
uniform styleParams2: vec4f;     // old film, lens rain, frost, light leak
uniform mangaParams: vec4f;      // focus lines, sparkle, gloom, panel layout (0 none)
uniform mangaParams2: vec4f;     // manga page amount, sfx burst amount, beta fill, time
uniform mangaCenter: vec4f;      // focus / sparkle centre xy, sfx centre zw
uniform paperColor: vec3f;
uniform fluidParams: vec4f;     // ink amount, refraction, wash bands, -

fn src(uv: vec2f) -> vec3f {
    return textureSampleLevel(source, sourceSampler, clamp(uv, vec2f(0.0005), vec2f(0.9995)), 0.0).rgb;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    var uv = fragmentInputs.vUV;
    let time = uniforms.mangaParams2.w;
    let pixel = uv * uniforms.screenParams.xy;
    let aspect = uniforms.screenParams.x * uniforms.screenParams.w;
    let texel = uniforms.screenParams.zw;

    // --- film transport: the frame itself wobbles in old footage ---------------------------------
    let film = uniforms.styleParams2.x;
    if (film > 0.0) {
        uv = filmWeave(uv, time, 18.0, film);
    }

    // --- rain and frost on the lens -------------------------------------------------------------------
    var lensHi = 0.0;
    var frost = vec2f(0.0);
    if (uniforms.styleParams2.y > 0.0) {
        let a = lensRainStatic(uv, aspect, time, uniforms.styleParams2.y);
        let b = lensRainRunning(uv, aspect, time, uniforms.styleParams2.y * 0.6);
        uv = uv + a.xy + b.xy;
        lensHi = a.w + b.w;
    }
    if (uniforms.styleParams2.z > 0.0) {
        frost = lensFrost(uv, aspect, uniforms.styleParams2.z);
        uv = uv + (hash22(floor(pixel * 0.5)) - 0.5) * frost.x * 0.006;
    }

    // --- the fluid bends the image under it -----------------------------------------------------------------
    let fluidAmt = uniforms.fluidParams.x;
    if (fluidAmt > 0.0) {
        let fv = textureSampleLevel(fluidVel, fluidVelSampler, fragmentInputs.vUV, 0.0).xy;
        uv = uv + fv * texel * uniforms.fluidParams.y * 0.08;
    }

    var col = src(uv);

    // --- painting: memories become watercolour ---------------------------------------------------------
    let paint = uniforms.styleParams.w;
    if (paint > 0.0) {
        let k = kuwaharaSmooth(source, sourceSampler, uv, texel, 3.0 + paint * 3.0);
        let c1 = src(uv + vec2f(texel.x, 0.0));
        let c2 = src(uv + vec2f(0.0, texel.y));
        let grad = length(k - c1) + length(k - c2);
        let paper = paperTexture(pixel, 0.6);
        var w = paperPooling(k, grad, paper, 0.9);
        w = granulate(w, paper, 0.6);
        col = mix(col, w, paint);
    }

    // --- ink in water: the fluid's dye, banded like a wash, darker where it pools at its edges --------------
    if (fluidAmt > 0.0) {
        let dv = textureSampleLevel(fluidDye, fluidDyeSampler, fragmentInputs.vUV, 0.0);
        let ink = fluidInk(dv, max(uniforms.fluidParams.z, 2.0));
        let dx = textureSampleLevel(fluidDye, fluidDyeSampler, fragmentInputs.vUV + vec2f(texel.x * 3.0, 0.0), 0.0).a - dv.a;
        let dy = textureSampleLevel(fluidDye, fluidDyeSampler, fragmentInputs.vUV + vec2f(0.0, texel.y * 3.0), 0.0).a - dv.a;
        let pooled = clamp(length(vec2f(dx, dy)) * 6.0, 0.0, 1.0);
        let grain = paperTexture(pixel, 0.5);
        // a wash, not paint: thin where the dye is thin, and kept lighter over the middle of the screen
        // where the fight is, so ink frames the action instead of hiding it
        let centre = smoothstep(0.12, 0.55, length((fragmentInputs.vUV - 0.5) * vec2f(aspect, 1.0)));
        let wash = smoothstep(0.04, 0.8, ink.a) * (0.93 + 0.1 * grain);
        let a = clamp(wash * mix(0.5, 0.92, centre) + pooled * ink.a * 0.45, 0.0, 0.95) * fluidAmt;
        col = mix(col, ink.rgb * (1.0 - pooled * 0.4), a);
    }

    // --- ink: darken luminance edges a touch (thicker, softer contours) ----------------------------------
    let inkAmt = uniforms.styleParams.z;
    if (inkAmt > 0.0) {
        let l = luma(col);
        let lx = luma(src(uv + vec2f(texel.x, 0.0))) - luma(src(uv - vec2f(texel.x, 0.0)));
        let ly = luma(src(uv + vec2f(0.0, texel.y))) - luma(src(uv - vec2f(0.0, texel.y)));
        let edge = smoothstep(0.08, 0.3, length(vec2f(lx, ly)));
        col = col * (1.0 - edge * inkAmt * 0.3 * (1.0 - l * 0.5));
    }

    // --- screentone in the darkest shadows -----------------------------------------------------------------
    col = toneShadows(col, pixel, 0.18, 4.0 * (uniforms.screenParams.y / 720.0), uniforms.styleParams.x);

    // --- manga page (stills), beta fill ---------------------------------------------------------------------
    col = mangaPage(col, pixel, uniforms.mangaParams2.x);
    col = betaFill(col, 0.12, uniforms.mangaParams2.z);

    // --- paper under everything ---------------------------------------------------------------------------------
    if (uniforms.styleParams.y > 0.0) {
        let paper = paperTexture(pixel, 0.8);
        col = paperMultiply(col, paper, uniforms.paperColor, uniforms.styleParams.y);
    }

    // --- old film ------------------------------------------------------------------------------------------------
    if (film > 0.0) {
        col = col * filmFlicker(time, 18.0, film);
        col = col * (1.0 - filmDust(uv, time, 18.0, film) * 0.8);
        col = mix(col, vec3f(0.92, 0.9, 0.85), filmScratches(uv, time, film) * 0.5);
        col = col + filmLightLeak(uv, time, uniforms.styleParams2.w);
    } else if (uniforms.styleParams2.w > 0.0) {
        col = col + filmLightLeak(uv, time, uniforms.styleParams2.w);
    }

    // --- manga marks ---------------------------------------------------------------------------------------------
    let mc = uniforms.mangaCenter.xy;
    if (uniforms.mangaParams.x > 0.0) {
        let fl = focusLines(fragmentInputs.vUV, mc, aspect, 0.28, 140.0, floor(time * 8.0));
        col = mix(col, vec3f(0.02), fl * uniforms.mangaParams.x);
    }
    if (uniforms.mangaParams.y > 0.0) {
        let k = kiraMarks(fragmentInputs.vUV, mc, aspect, 0.18, time);
        col = mix(col, vec3f(1.0), k * uniforms.mangaParams.y);
    }
    if (uniforms.mangaParams.z > 0.0) {
        let g = gloomLines(fragmentInputs.vUV, mc.x, 0.18, 0.4, 3.0);
        col = mix(col, col * 0.15, g * uniforms.mangaParams.z);
    }
    if (uniforms.mangaParams2.y > 0.0) {
        let b = sfxBurst(fragmentInputs.vUV, uniforms.mangaCenter.zw, aspect, 0.16, floor(time * 4.0));
        col = mix(col, vec3f(1.0), b.x * uniforms.mangaParams2.y);
        col = mix(col, vec3f(0.02), b.y * uniforms.mangaParams2.y);
    }
    let panelKind = i32(uniforms.mangaParams.w);
    if (panelKind > 0) {
        let pl = panelLayout(fragmentInputs.vUV, aspect, panelKind, 0.012);
        col = mix(col, vec3f(0.97, 0.96, 0.93), pl.y);
    }

    // --- lens highlights and frost on top ---------------------------------------------------------------------------
    col = col * (1.0 + min(lensHi, 0.0)) + vec3f(max(lensHi, 0.0) * 0.3);
    if (frost.x > 0.0) {
        col = mix(col, vec3f(0.85, 0.9, 0.96), frost.x * 0.35 + frost.y * 0.25);
    }
    fragmentOutputs.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
