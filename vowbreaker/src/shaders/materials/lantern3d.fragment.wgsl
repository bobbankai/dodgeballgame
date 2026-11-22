// Rising lanterns (vb_lanterns3d): paper lit from inside, ribs and seams against the light, the
// open bottom glowing brightest; cursed ones red with a black sigil.
#define DISABLE_UNIFORMITY_ANALYSIS
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_lanterns3d>

varying vLocal: vec3f;
varying vInfo: vec4f;

uniform lanternParams: vec4f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let p = fragmentInputs.vLocal;
    let ang = atan2(p.z, p.x);
    let seed = fragmentInputs.vInfo.x;
    let cursed = fragmentInputs.vInfo.y;
    var col = lanternGlow(p.y, ang, uniforms.lanternParams.x, seed, 0.0) * 2.2;
    // the dark wooden frame top and bottom rims
    let rim = step(0.46, abs(p.y));
    col = mix(col, vec3f(0.06, 0.03, 0.02), rim);
    // cursed lanterns are black lacquer: dark against the burning sky, the sigil and the seams
    // glowing red through it, the open bottom a red ember
    if (cursed > 0.5) {
        let sig = lanternSigil(p.y, ang, seed);
        let seams = step(0.93, fract(ang / TAU * 8.0)) + step(0.9, fract(p.y * 6.0 + 0.5));
        let ember = smoothstep(-0.2, -0.5, p.y);
        let flick = 0.75 + 0.25 * valueNoise2(vec2f(uniforms.lanternParams.x * 6.0, seed * 40.0));
        col = vec3f(0.05, 0.015, 0.015) + vec3f(2.4, 0.15, 0.08) * (sig + clamp(seams, 0.0, 1.0) * 0.5 + ember * 0.8) * flick;
        col = mix(col, vec3f(0.03, 0.01, 0.01), rim);
    }
    fragmentOutputs.color = vec4f(col, 1.0);
}
