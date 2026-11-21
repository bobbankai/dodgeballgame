// GPU particles: per-kind sprites. Additive pool (GLOW): sparks, embers, bell dust, energy motes.
// Alpha pool: debris, petals, paper scraps, smoke, ash, droplets, ink.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_vfx>

varying vUV: vec2f;
varying vColor: vec4f;
varying vInfo: vec4f;

uniform time: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let p = uv * 2.0 - 1.0;
    let kind = i32(fragmentInputs.vInfo.x + 0.5);
    let age = fragmentInputs.vInfo.y;
    let seed = fragmentInputs.vInfo.z;
    var col = fragmentInputs.vColor.rgb;
    var a = 0.0;
    switch kind {
        case 0: {
            // spark streak: hot white core into the colour
            let w = abs(p.x);
            let core = smoothstep(0.6, 0.0, w) * smoothstep(1.0, 0.3, abs(p.y));
            col = mix(col, vec3f(1.0), smoothstep(0.4, 0.0, w)) * 2.0;
            a = core;
        }
        case 1: {
            // ember: a flickering dot
            let r = length(p);
            let flick = 0.7 + 0.3 * sin(fragmentInputs.vInfo.z * 40.0 + age * 30.0);
            a = pow(clamp(1.0 - r, 0.0, 1.0), 2.0) * flick;
            col = mix(col, vec3f(1.0, 0.95, 0.8), smoothstep(0.5, 0.0, r)) * 1.6;
        }
        case 2: {
            // debris chunk: an irregular polygon, dark, catching a rim of colour
            let d = sdHexagon(rotate2(p, seed * 6.0) * vec2f(1.0, 1.4), 0.6 + seed * 0.2);
            a = sdFill(d, 0.08);
            col = col * (0.5 + 0.5 * step(0.0, p.y - p.x));
        }
        case 3: {
            a = spritePetal(uv);
            col = col * (0.85 + 0.15 * uv.y);
        }
        case 4: {
            // paper scrap
            let d = sdBox2(p, vec2f(0.6, 0.85));
            a = sdFill(d, 0.06);
            col = col * (0.9 + 0.1 * step(0.0, p.x * p.y));
        }
        case 5: {
            let n = vfbm2(p * 2.2 + vec2f(seed * 7.0, age), 3);
            a = smoothstep(1.0, 0.1, length(p) + (n - 0.5) * 0.6) * (1.0 - age) * 0.7;
            col = col * (0.75 + 0.4 * n);
        }
        case 6: {
            // ash flake
            a = sdFill(sdRhombus(rotate2(p, seed * 5.0), vec2f(0.5, 0.8)), 0.08);
        }
        case 7: {
            let d = sdCircle(p, 0.6);
            a = sdFill(d, 0.1);
        }
        case 8: {
            // ink blot (curses bleeding)
            let n = valueNoise2(p * 3.0 + seed * 9.0);
            a = smoothstep(0.85, 0.6, length(p) + (n - 0.5) * 0.5);
            col = col * 0.25;
        }
        case 9: {
            // bell dust: a tiny four-point twinkle
            let r = length(p);
            let tw = exp(-abs(p.x) * 12.0) * exp(-abs(p.y) * 3.0) + exp(-abs(p.y) * 12.0) * exp(-abs(p.x) * 3.0);
            a = clamp(tw + exp(-r * r * 10.0), 0.0, 1.0);
            col = col * 2.0;
        }
        default: {
            a = smoothstep(1.0, 0.0, length(p));
        }
    }
    a = a * fragmentInputs.vColor.a;
#ifdef GLOW
    fragmentOutputs.color = vec4f(col * a, 0.0);
#else
    if (a < 0.02) {
        discard;
    }
    fragmentOutputs.color = vec4f(col, a);
#endif
}
