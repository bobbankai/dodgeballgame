// Sky: a stylised gradient with the story's moods, then everything that hangs in it.
//   base       zenith-horizon-ground gradient with horizon glow (vb_atmosphere.evalSky)
//   clouds     raymarched toon cumulus with painted tones and silver linings, horizon banks,
//              cirrus wisps, light fingers through gaps (vb_clouds)
//   celestial  sun disc with lens glow, phased moon with craters and halo, twinkling stars and a
//              Milky Way band, shooting stars, festival fireworks, a spring rainbow, sky lanterns
//              rising for the Night Parade, city / village glow under the horizon (vb_celestial)
//   moods      the cursed red sky of the Grand Vow (black sun, burning corona, ribbons of grief)
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_atmosphere>
#include<vb_toon>
#include<vb_noise2>
#include<vb_clouds>
#include<vb_celestial>
#include<vb_sky_events>
#include<vb_sky_backdrop>

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
uniform skyParams3: vec4f;     // cirrus, light fingers, fireworks, rainbow
uniform skyParams4: vec4f;     // sky lanterns, shooting stars, rain curtains, -
uniform skyParams5: vec4f;     // lightning flash, bolt seed, aurora, crows
uniform skyParams6: vec4f;     // sunburst, backdrop kind, backdrop amount, backdrop seed
uniform cursedColor: vec3f;
uniform festivalColor: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let d = normalize(fragmentInputs.vDir);
    let time = uniforms.skyParams.x;
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
    p.time = time;
    p.cloudCover = 0.0;            // clouds are drawn here, not by evalSky
    p.starAmount = 0.0;
    p.sunSize = 0.0;
    p.moonPhase = uniforms.skyParams2.x;
    p.horizonGlow = uniforms.skyParams2.y;
    var col = evalSky(d, p);

    // stars, the Milky Way, shooting stars (behind everything else)
    col = col + celStars(d, time, uniforms.skyParams.z);
    col = col + celShootingStar(d, time, uniforms.skyParams4.y);

    // sun and moon
    if (uniforms.skyParams.w > 0.0) {
        col = col + celSun(d, p.sunDir, uniforms.skyParams.w, p.sunColor);
    }
    if (maxc3(uniforms.moonColor) > 0.0) {
        let m = celMoon(d, p.moonDir, 0.045, p.moonPhase + 0.5, uniforms.moonColor, time);
        col = mix(col, m.rgb, m.a) + m.rgb * (1.0 - m.a);
    }
    col = col + celRainbow(d, p.sunDir, uniforms.skyParams3.w);
    col = col + skyAurora(d, time, uniforms.skyParams5.z);

    // clouds over the sun, moon and stars
    let cp = cloudDefault(uniforms.cloudColor, uniforms.cloudShadow, select(p.sunDir, p.moonDir, maxc3(uniforms.moonColor) > 0.0 && p.sunDir.y < 0.1),
                          uniforms.skyParams.y, time);
    col = cloudsComposite(col, d, cp, uniforms.skyParams3.x, uniforms.skyParams3.y);

    // far showers hanging from the clouds over the horizon, lit now and then by the lightning
    if (uniforms.skyParams4.z > 0.0) {
        let rc = skyRainCurtains(d, time, uniforms.skyParams4.z, uniforms.horizon, uniforms.skyParams5.x, 0.71);
        col = mix(col, rc.rgb, rc.a);
    }

    // the far scenery painted round the horizon: ranges, skylines, temple hills, islands, forest
    let bk = i32(uniforms.skyParams6.y + 0.5);
    if (bk > 0 && d.y < 0.4) {
        let night = clamp(max(uniforms.skyParams.z, smoothstep(0.1, -0.12, p.sunDir.y)), 0.0, 1.0);
        let px = max(length(fwidth(d)), 1e-4) * 1.2;
        let bd = skyBackdrop(bk, d, px, uniforms.horizon, uniforms.zenith, p.sunColor, p.sunDir, night, uniforms.festivalColor * 1.5, time,
                             uniforms.skyParams6.w, 0.6);
        let amt = uniforms.skyParams6.z;
        col = mix(col, bd.color, bd.cover * amt) + bd.emissive * amt;
    }

    // events: rays from a low sun, a lightning strike with the clouds lit round it, crows at dusk
    col = col + skySunburst(d, p.sunDir, p.sunColor, uniforms.skyParams6.x, time);
    let flash = uniforms.skyParams5.x;
    if (flash > 0.0) {
        col = col + skyBolt(d, flash, uniforms.skyParams5.y);
        col = col + vec3f(0.35, 0.4, 0.55) * flash * smoothstep(0.0, 0.4, d.y) * 0.6;
    }
    col = mix(col, vec3f(0.02, 0.015, 0.025), skyCrows(d, time, uniforms.skyParams5.w));

    // festival night: the village's lantern glow along the horizon, fireworks, lanterns rising
    let fest = uniforms.skyParams2.w;
    col = col + celHorizonGlow(d, uniforms.festivalColor, fest, time);
    col = col + celFireworks(d, time, uniforms.skyParams3.z);
    col = col + celSkyLanterns(d, time, uniforms.skyParams4.x, uniforms.festivalColor * 1.4);

    // the Grand Vow: the sky bleeds, a black sun with a burning corona, ribbons of grief
    let cursed = uniforms.skyParams2.z;
    if (cursed > 0.0) {
        let up = clamp(d.y, 0.0, 1.0);
        var cc = mix(uniforms.cursedColor * 1.4, uniforms.cursedColor * 0.12, pow(up, 0.6));
        let swirl = warpedFbm2(d.xz / max(d.y + 0.25, 0.1) * 0.7, time * 0.4);
        cc = cc * (0.65 + 0.6 * swirl);
        let sd = dot(d, p.sunDir);
        let disc = smoothstep(cos(0.09), cos(0.085), sd);
        let corona = pow(max(sd, 0.0), 120.0) * 3.0 + pow(max(sd, 0.0), 12.0) * 0.4;
        cc = mix(cc + uniforms.cursedColor * corona * 2.0, vec3f(0.0), disc);
        cc = cc + skyRibbons(d, time, uniforms.cursedColor * 1.5);
        cc = cc + celSkyLanterns(d, time * 1.3, uniforms.skyParams4.x, vec3f(1.2, 0.3, 0.1));
        col = mix(col, cc, cursed);
    }
    fragmentOutputs.color = vec4f(col, 1.0);
}
