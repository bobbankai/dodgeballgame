// Ambient weather sprites (vb_ambient_weather): a drawn shape per kind, flat cards shaded by the sun
// and darker on their backs, embers cooling as they climb, fireflies blinking, dust sparkling where
// the light crosses it, everything brightened by a lightning flash.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_vfx>
#include<vb_ambient_weather>

varying vUV: vec2f;
varying vInfo: vec4f;
varying vInfo2: vec4f;

uniform ambientColor: vec4f;
uniform ambientParams: vec4f;
uniform ambientParams2: vec4f;
uniform sunColor: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let kind = i32(fragmentInputs.vInfo.x + 0.5);
    let uv = fragmentInputs.vUV;
    let p = uv * 2.0 - 1.0;
    let seed = fragmentInputs.vInfo.y;
    let splash = fragmentInputs.vInfo.w;
    let t = uniforms.ambientParams.y;
    let card = ambientCardLight(fragmentInputs.vInfo2.x, fragmentInputs.vInfo2.y);
    var a = 0.0;
    var col = uniforms.ambientColor.rgb;
    if (splash > 0.0) {
        a = ambientSplash(p, 1.0 - splash) * 0.7;
        col = mix(col, vec3f(0.9, 0.95, 1.0), 0.5);
    } else {
        switch kind {
            case 0, 10: {
                a = smoothstep(1.0, 0.0, abs(p.x)) * smoothstep(1.0, 0.2, abs(p.y)) * select(0.45, 0.6, kind == 10);
                if (kind == 10) {
                    col = mix(col, vec3f(0.95), 0.5);
                }
            }
            case 1: {
                a = 1.0 - smoothstep(-0.04, 0.04, ambientPetal(p));
                col = col * (0.85 + 0.25 * seed) * card;
            }
            case 2: {
                a = sdFill(sdRhombus(p, vec2f(0.5, 0.8)), 0.1) * 0.8;
                col = col * (0.6 + 0.4 * seed) * card;
            }
            case 3: {
                a = smoothstep(1.0, 0.2, length(p));
            }
            case 4: {
                // embers cool as they climb (seed decides how far through its life)
                let r = length(p);
                let cool = fract(seed * 7.0 + t * 0.2);
                a = sqr(clamp(1.0 - r, 0.0, 1.0)) * (0.7 + 0.3 * sin(t * 20.0 + seed * 50.0));
                col = mix(mix(col, vec3f(1.0, 0.9, 0.7), smoothstep(0.5, 0.0, r)) * 2.0, vec3f(0.5, 0.06, 0.02), cool * 0.7);
            }
            case 5: {
                let r = length(p);
                a = sqr(clamp(1.0 - r, 0.0, 1.0));
                col = mix(col, vec3f(1.0, 0.9, 0.7), smoothstep(0.5, 0.0, r)) * 2.0;
            }
            case 6: {
                // fireflies blink slowly, each on its own beat
                let r = length(p);
                let blink = smoothstep(0.3, 1.0, sin(t * (0.8 + seed) + seed * 40.0));
                a = exp(-r * r * 5.0) * blink;
                col = mix(vec3f(0.6, 1.0, 0.4), vec3f(1.0, 1.0, 0.8), exp(-r * r * 30.0)) * 2.5;
            }
            case 7: {
                let l = ambientLeaf(p);
                a = 1.0 - smoothstep(-0.04, 0.04, l.x);
                let leafCol = mix(vec3f(0.75, 0.3, 0.08), vec3f(0.85, 0.6, 0.15), seed);
                col = leafCol * (1.0 - l.y * 0.25) * card;
            }
            case 8: {
                let s = ambientSlip(p, fragmentInputs.vInfo2.z);
                a = 1.0 - smoothstep(-0.03, 0.03, s.x);
                col = vec3f(0.96, 0.94, 0.88) * card;
                col = mix(col, vec3f(0.1, 0.08, 0.09), clamp(s.y, 0.0, 1.0) * step(s.y, 1.5) * step(0.5, fragmentInputs.vInfo2.x));
                col = mix(col, vec3f(0.75, 0.08, 0.06), step(1.5, s.y));
            }
            case 9: {
                // dust: a faint speck that sparkles now and then
                let r = length(p);
                let sparkle = step(0.97, fract(seed * 13.0 + t * 0.15));
                a = exp(-r * r * 8.0) * (0.25 + sparkle * 0.75);
                col = mix(col, vec3f(1.0, 0.95, 0.8) * 2.0, sparkle);
            }
            default: {
                a = 0.0;
            }
        }
    }
    // a lightning flash lights everything in the air
    col = col * (1.0 + uniforms.ambientParams2.x * 2.5);
    a = a * fragmentInputs.vInfo.z * uniforms.ambientColor.a;
    if (a < 0.02) {
        discard;
    }
    fragmentOutputs.color = vec4f(col, a);
}
