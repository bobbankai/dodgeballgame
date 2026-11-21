// Sky: stylized gradient, sun and moon, stars, toon clouds; plus the moods the story needs:
// the cursed red sky of the Grand Vow (black sun, ribbons of grief), festival night glow on the
// horizon, rain murk, and a flashback paper sky.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_atmosphere>
#include<vb_toon>

varying vDir: vec3f;

uniform zenith: vec3f;
uniform horizon: vec3f;
uniform ground: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform moonDir: vec3f;
uniform moonColor: vec3f;
uniform cloudColor: vec3f;
uniform cloudShadow: vec3f;
uniform skyParams: vec4f;      // time, cloud cover, stars, sun size
uniform skyParams2: vec4f;     // moon phase, horizon glow, cursed amount, festival glow
uniform cursedColor: vec3f;
uniform festivalColor: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let d = normalize(fragmentInputs.vDir);
    var p: SkyParams;
    p.zenith = uniforms.zenith;
    p.horizon = uniforms.horizon;
    p.ground = uniforms.ground;
    p.sunDir = normalize(uniforms.sunDir);
    p.sunColor = uniforms.sunColor;
    p.moonDir = normalize(uniforms.moonDir);
    p.moonColor = uniforms.moonColor;
    p.cloudColor = uniforms.cloudColor;
    p.cloudShadow = uniforms.cloudShadow;
    p.time = uniforms.skyParams.x;
    p.cloudCover = uniforms.skyParams.y;
    p.starAmount = uniforms.skyParams.z;
    p.sunSize = uniforms.skyParams.w;
    p.moonPhase = uniforms.skyParams2.x;
    p.horizonGlow = uniforms.skyParams2.y;
    var col = evalSky(d, p);

    // festival night: a warm glow rising from the city / village lanterns along the horizon
    let fest = uniforms.skyParams2.w;
    if (fest > 0.0) {
        let band = exp(-max(d.y, 0.0) * 7.0) * smoothstep(-0.05, 0.02, d.y);
        let flick = 0.85 + 0.15 * valueNoise2(vec2f(atan2(d.z, d.x) * 6.0, p.time * 0.5));
        col = col + uniforms.festivalColor * band * fest * flick;
    }

    // the Grand Vow: the sky bleeds, a black sun with a burning corona, ribbons of grief
    let cursed = uniforms.skyParams2.z;
    if (cursed > 0.0) {
        let up = clamp(d.y, 0.0, 1.0);
        var cc = mix(uniforms.cursedColor * 1.4, uniforms.cursedColor * 0.12, pow(up, 0.6));
        let swirl = warpedFbm2(d.xz / max(d.y + 0.25, 0.1) * 0.7, p.time * 0.4);
        cc = cc * (0.65 + 0.6 * swirl);
        let sd = dot(d, p.sunDir);
        let disc = smoothstep(cos(0.09), cos(0.085), sd);
        let corona = pow(max(sd, 0.0), 120.0) * 3.0 + pow(max(sd, 0.0), 12.0) * 0.4;
        cc = mix(cc + uniforms.cursedColor * corona * 2.0, vec3f(0.0), disc);
        cc = cc + skyRibbons(d, p.time, uniforms.cursedColor * 1.5);
        col = mix(col, cc, cursed);
    }
    fragmentOutputs.color = vec4f(col, 1.0);
}
