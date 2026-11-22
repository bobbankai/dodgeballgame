// Impact frames (vb_impact_frame): after the graded frame, for the one or two frames an anime cuts
// to on a blow that matters. The frame punches in and shakes, then is redrawn in the chosen style
// from the G-buffer (silhouettes, boiling ink edges, focus lines, shock rings, the contact star),
// or broken into shards (shatter), or dragged along the blow (smear). Black Spark tears the colour
// channels apart along the fighters' outlines.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_toon>
#include<vb_manga>
#include<vb_impact_frame>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform screenParams: vec4f;     // width, height, 1/width, 1/height
uniform impactParams: vec4f;     // style, progress through the hold (0..1), amount, seed
uniform impactGeo: vec4f;        // the hit on screen (uv), the blow's direction on screen
uniform impactAccent: vec3f;     // the attacker's colour
uniform impactAccentDark: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let base = textureSampleLevel(source, sourceSampler, uv, 0.0).rgb;
    let style = i32(uniforms.impactParams.x + 0.5);
    let t = uniforms.impactParams.y;
    let amount = uniforms.impactParams.z;
    if (style <= 0 || amount <= 0.0) {
        fragmentOutputs.color = vec4f(base, 1.0);
        return fragmentOutputs;
    }
    let seed = uniforms.impactParams.w;
    let center = uniforms.impactGeo.xy;
    let dir = normalize(uniforms.impactGeo.zw + vec2f(1e-4, 0.0));
    let aspect = uniforms.screenParams.x / uniforms.screenParams.y;
    let px = uniforms.screenParams.zw;
    let pixel = uv * uniforms.screenParams.xy;
    // drawn on twos: shapes and lines jump every other frame of the hold
    let boil = floor(t * 8.0) + seed * 10.0;
    let wuv = impactWarp(uv, center, t, amount, seed);
    var col = textureSampleLevel(source, sourceSampler, wuv, 0.0).rgb;
    let lineR = 2.2 * uniforms.screenParams.y / 720.0;
    if (style == IMPACT_SHATTER) {
        let sh = impactShatter(wuv, center, aspect, t, seed);
        col = textureSampleLevel(source, sourceSampler, sh.uv, 0.0).rgb * sh.shade;
        // the broken frame is drained of colour a little and flashed
        col = mix(col, vec3f(luma(col)), 0.35) * (1.0 + 0.4 * (1.0 - t));
        col = mix(col, vec3f(1.0), sh.crack);
        col = mix(col, vec3f(1.0), impactStar(uv, center, aspect, 0.04, t, seed));
    } else if (style == IMPACT_SMEAR) {
        col = impactSmear(source, sourceSampler, wuv, dir, center, amount);
        let lines = speedLinesDir(uv, dir, aspect, boil, 55.0, seed);
        col = mix(col, vec3f(1.0), lines * 0.7);
    } else {
        let geo = impactGeometry(gbuffer, gbufferSampler, wuv, px, lineR, boil);
        col = impactStyle(style, col, geo, wuv, pixel, center, aspect, t, seed, uniforms.impactAccent, uniforms.impactAccentDark);
        if (style == IMPACT_SPARK) {
            // the channels torn apart round the fighters
            let off = dir * px * 6.0 * (1.0 - t * 0.5);
            let rC = impactIsChar(textureSampleLevel(gbuffer, gbufferSampler, wuv + off, 0.0).a);
            let bC = impactIsChar(textureSampleLevel(gbuffer, gbufferSampler, wuv - off, 0.0).a);
            col.r = mix(col.r, 1.0, clamp(rC - geo.isChar, 0.0, 1.0) * 0.9);
            col.b = mix(col.b, 0.9, clamp(bC - geo.isChar, 0.0, 1.0) * 0.7);
        }
    }
    fragmentOutputs.color = vec4f(mix(base, col, amount), 1.0);
}
