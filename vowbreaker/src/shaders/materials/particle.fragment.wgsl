// GPU particles: a drawn shape per kind (vb_psim lists the kinds). Additive pool (GLOW) for
// light: sparks, embers, dust motes, fireflies, glyphs burning out. Alpha pool for matter: debris,
// petals, paper, smoke, ash, drops, ink, snow, rain, bubbles, feathers, leaves, tears. Flat cards
// shade their back side darker; resting things fade over their last moments.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_vfx>
#include<vb_psim>

varying vUV: vec2f;
varying vColor: vec4f;
varying vInfo: vec4f;
varying vInfo2: vec4f;

uniform time: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let p = uv * 2.0 - 1.0;
    let kind = i32(fragmentInputs.vInfo.x + 0.5);
    let age = fragmentInputs.vInfo.y;
    let seed = fragmentInputs.vInfo.z;
    let speed = fragmentInputs.vInfo.w;
    let state = fragmentInputs.vInfo2.x;
    let facing = fragmentInputs.vInfo2.z;
    let px = max(length(fwidth(p)), 0.02);
    var col = fragmentInputs.vColor.rgb;
    var a = 0.0;
    // the back of a flat card is in its own shadow
    let back = 1.0 - 0.35 * smoothstep(0.6, 0.2, facing);
    switch kind {
        case 0: {
            // spark streak: hot white core into the colour
            let w = abs(p.x);
            let core = smoothstep(0.6, 0.0, w) * smoothstep(1.0, 0.3, abs(p.y));
            col = mix(col, vec3f(1.0), smoothstep(0.4, 0.0, w)) * 2.0;
            a = core;
        }
        case 1: {
            // ember: a flickering dot, its colour cooling with its heat
            let r = length(p);
            let heat = clamp(fragmentInputs.vInfo2.y, 0.0, 1.0);
            let flick = 0.7 + 0.3 * sin(seed * 40.0 + uniforms.time * 25.0);
            a = sqr(clamp(1.0 - r, 0.0, 1.0)) * flick;
            col = mix(col * 0.6, mix(col, vec3f(1.0, 0.95, 0.8), smoothstep(0.5, 0.0, r)) * 1.8, 0.4 + 0.6 * heat);
        }
        case 2: {
            // debris chunk: an irregular polygon with a lit face and a dark face
            let q = rotate2(p, seed * 6.0 + fragmentInputs.vInfo2.w);
            let d = sdHexagon(q * vec2f(1.0, 1.4), 0.6 + seed * 0.2);
            a = sdFill(d, px);
            col = col * select(0.45, 1.0, q.y - q.x * 0.5 > 0.0);
            col = mix(col, vec3f(0.05), 1.0 - smoothstep(-0.12, -0.04, d));
        }
        case 3: {
            // sakura petal: a notched oval, paler at its base, a darker vein
            let d = psPetal(p);
            a = sdFill(d, px);
            let vein = 1.0 - smoothstep(0.0, 0.06, abs(p.x)) * 0.2;
            col = col * (0.85 + 0.15 * (1.0 - uv.y)) * vein * back;
        }
        case 4: {
            // paper scrap with a brushed stroke on its front
            let d = sdBox2(p, vec2f(0.6, 0.85));
            a = sdFill(d, px);
            let stroke = sdFill(sdGlyph(p * vec2f(0.7, 0.5), floor(seed * 50.0)), 0.05) * step(0.5, facing);
            col = mix(col, vec3f(0.1, 0.08, 0.09), stroke * 0.8) * back;
        }
        case 5: {
            // smoke: a cel puff, lit from above
            let n = vfbm2(p * 2.2 + vec2f(seed * 7.0, age), 3);
            let r = length(p) + (n - 0.5) * 0.6;
            a = smoothstep(1.0, 0.75, r) * (1.0 - age) * 0.75;
            let lit = smoothstep(0.0, 0.2, p.y + (n - 0.5) * 0.4);
            col = col * mix(0.65, 1.05, lit);
        }
        case 6: {
            a = sdFill(sdRhombus(rotate2(p, seed * 5.0), vec2f(0.5, 0.8)), px) ;
            col = col * back;
        }
        case 7: {
            // a drop with a highlight
            let d = sdCircle(p, 0.6);
            a = sdFill(d, px);
            let hi = 1.0 - smoothstep(0.0, 0.25, length(p - vec2f(-0.2, 0.25)));
            col = col + vec3f(0.6) * hi;
        }
        case 8: {
            // ink blot, stretched along the flight
            let n = valueNoise2(p * 3.0 + seed * 9.0);
            a = smoothstep(0.85, 0.6, length(p) + (n - 0.5) * 0.5);
            col = col * 0.25;
        }
        case 9: {
            // bell dust: a small four-point twinkle
            let r = length(p);
            let tw = exp(-abs(p.x) * 12.0) * exp(-abs(p.y) * 3.0) + exp(-abs(p.y) * 12.0) * exp(-abs(p.x) * 3.0);
            a = clamp(tw + exp(-r * r * 10.0), 0.0, 1.0);
            col = col * 2.0;
        }
        case 10: {
            // snowflake
            a = sdFill(psSnow(rotate2(p, seed * 3.0)), px * 1.5);
            col = vec3f(0.92, 0.95, 1.0) * mix(0.8, 1.0, facing);
        }
        case 11: {
            // rain: a thin bright streak
            a = (1.0 - smoothstep(0.0, 0.8, abs(p.x))) * (1.0 - smoothstep(0.6, 1.0, abs(p.y))) * 0.55;
            col = mix(col, vec3f(0.85, 0.9, 1.0), 0.6);
        }
        case 12: {
            // bubble: a thin ring with a highlight, popping at the end
            let r = length(p);
            let ring = 1.0 - smoothstep(0.0, 0.1, abs(r - 0.75));
            let hi = 1.0 - smoothstep(0.0, 0.18, length(p - vec2f(-0.3, 0.35)));
            let pop = 1.0 - smoothstep(0.9, 1.0, age);
            a = clamp(ring * 0.7 + hi * 0.8 + 0.08 * step(r, 0.75), 0.0, 1.0) * pop;
            col = mix(col, vec3f(1.0), hi);
        }
        case 13: {
            // firefly: a soft glow that blinks
            let r = length(p);
            let blink = smoothstep(0.2, 1.0, sin(uniforms.time * (1.5 + seed * 2.0) + seed * 30.0));
            a = exp(-r * r * 6.0) * blink;
            col = mix(col, vec3f(1.0, 1.0, 0.8), exp(-r * r * 30.0)) * 2.0;
        }
        case 14: {
            let f = psFeather(p);
            a = sdFill(f.x, px);
            col = col * (0.85 + 0.15 * f.y) * back;
        }
        case 15: {
            // a talisman character burning away from its edges
            let g = sdGlyph(p * 0.55, floor(seed * 60.0));
            let n = valueNoise2(p * 4.0 + seed * 11.0);
            let burn = dissolve(n, smoothstep(0.4, 1.0, age), 0.2);
            a = sdFill(g, 0.05) * burn.x + burn.y * sdFill(g - 0.04, 0.05);
            col = mix(col, vec3f(1.0, 0.6, 0.2) * 2.0, burn.y);
        }
        case 16: {
            let l = psLeaf(rotate2(p, 0.4));
            a = sdFill(l.x, px);
            col = col * (1.0 - l.y * 0.25) * back;
        }
        case 17: {
            a = sdFill(psTear(p), px);
            let hi = 1.0 - smoothstep(0.0, 0.2, length(p - vec2f(-0.15, -0.2)));
            col = mix(col, vec3f(0.95, 0.98, 1.0), hi * 0.8);
        }
        default: {
            a = smoothstep(1.0, 0.0, length(p));
        }
    }
    // resting things fade over the last fifth of their life
    if (state > 0.5) {
        a = a * (1.0 - smoothstep(0.8, 1.0, age));
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
