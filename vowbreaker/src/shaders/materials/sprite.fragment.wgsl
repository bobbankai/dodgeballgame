// Effect sprites: every effect is drawn procedurally from distance fields and noise, on 2s like the
// characters (the shapes boil at 12 fps). Additive batch (GLOW defined) for light, alpha batch for
// matter (smoke, paper, ink).
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
varying vColor: vec4f;
varying vData: vec4f;
varying vViewZ: f32;
varying vWorld: vec3f;

uniform time: f32;

const K_STARBURST: i32 = 0;
const K_RING: i32 = 1;
const K_FLARE: i32 = 2;
const K_SEAL: i32 = 3;
const K_SMOKE: i32 = 4;
const K_GLYPH: i32 = 5;
const K_SLASH: i32 = 6;
const K_BOLT: i32 = 7;
const K_CRANE: i32 = 8;
const K_LANTERN: i32 = 9;
const K_ORB: i32 = 10;
const K_TALISMAN: i32 = 11;
const K_DUST: i32 = 12;
const K_STREAK: i32 = 13;
const K_FIRE: i32 = 14;
const K_DROP: i32 = 15;
const K_RIPPLE: i32 = 16;
const K_MOON: i32 = 17;
const K_GRAVITY: i32 = 18;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let p = uv * 2.0 - 1.0;
    let kind = i32(fragmentInputs.vData.x + 0.5);
    let age = clamp(fragmentInputs.vData.y, 0.0, 1.0);
    let seed = fragmentInputs.vData.w;
    let col = fragmentInputs.vColor.rgb;
    let inten = fragmentInputs.vColor.a;
    let st = steppedTime(uniforms.time, 12.0);
    let px = 2.0 / 128.0;
    var rgb = vec3f(0.0);
    var a = 0.0;

    switch kind {
        case 0: {
            // comic impact: a jagged starburst, white core, coloured rim, shrinking hole as it fades
            let grow = easeOutBack(min(age * 3.0, 1.0));
            let d = sdStarburst(p / max(grow, 0.05), 0.75, 11.0 + floor(seed * 5.0), 0.9, seed * 17.0 + floor(st * 2.0));
            let hole = sdCircle(p, age * age * 0.9);
            let shape = max(d, -hole);
            let fill = sdFill(shape, px * 2.0);
            let rim = sdStroke(shape, 0.06, px * 2.0);
            rgb = mix(col, vec3f(1.0), 0.65) * fill + col * rim * 1.5;
            a = max(fill, rim) * (1.0 - smoothstep(0.7, 1.0, age));
        }
        case 1: {
            // shockwave ring
            let r = length(p);
            let ring = tollRing(r, age, 0.95);
            let n = valueNoise2(vec2f(atan2(p.y, p.x) * 6.0, st * 3.0));
            rgb = col * ring * (0.7 + 0.6 * n);
            a = ring;
        }
        case 2: {
            // flare: soft core + four streaks, the anime "hit light"
            let r = length(p);
            let core = exp(-r * r * 18.0);
            let rq = rotate2(p, seed * 3.0);
            let streak = exp(-abs(rq.y) * 40.0) * exp(-abs(rq.x) * 2.5) + exp(-abs(rq.x) * 40.0) * exp(-abs(rq.y) * 2.5);
            let fade = 1.0 - age;
            rgb = (col * streak * 0.8 + mix(col, vec3f(1.0), 0.7) * core * 2.0) * fade;
            a = clamp(core + streak, 0.0, 1.0) * fade;
        }
        case 3: {
            // the bell seal (Itsuki's mark)
            let s = bellSeal(p * 1.05, uniforms.time + seed * 3.0, px * 2.0);
            let appear = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.85, 1.0, age));
            rgb = col * s * 1.6;
            a = s * appear;
        }
        case 4: {
            // smoke puff: lumpy noise disc that thins as it rises
            let n = vfbm2(p * 2.0 + vec2f(seed * 10.0, -age * 1.5), 4);
            let r = length(p) * (1.0 + age * 0.3);
            let d = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.8);
            let tone = posterizeLuma(col * (0.7 + 0.5 * n), 3.0);
            rgb = tone;
            a = d * (1.0 - age) * inten;
        }
        case 5: {
            // manga onomatopoeia: a heavy ink glyph with a white outline, popping in
            let pop = easeOutBack(min(age * 4.0, 1.0)) * (1.0 + 0.1 * sin(age * 30.0));
            let q = rotate2(p, -0.2) / max(pop, 0.05) * 1.3;
            let g = min(sdGlyph(q * vec2f(0.9, 1.0) + vec2f(0.35, 0.0), seed), sdGlyph(q - vec2f(0.45, 0.05), seed + 7.0));
            let ink = sdFill(g - 0.04, px * 2.0);
            let outline = sdFill(g - 0.11, px * 2.0);
            rgb = mix(vec3f(1.0), col * 0.15, ink);
            a = outline * (1.0 - smoothstep(0.75, 1.0, age));
        }
        case 6: {
            // slash crescent with a hot leading edge
            let q = vec2f(p.x, p.y + 0.35);
            let outer = sdCircle(q, 0.95);
            let inner = sdCircle(q - vec2f(0.0, -0.25 - age * 0.3), 0.95);
            let moon = max(outer, -inner);
            let side = smoothstep(-1.0, 1.0, p.x);
            let fill = sdFill(moon, px * 2.0) * smoothstep(0.0, 0.15, p.y + 0.4);
            let edge = sdStroke(outer, 0.02, px * 2.0);
            rgb = (col * fill * (0.5 + side) + vec3f(1.0) * edge) * (1.0 - age);
            a = max(fill, edge) * (1.0 - age);
        }
        case 7: {
            // lightning strip (Black Spark when the colour is near black)
            let b = lightningBolt(vec2f(uv.x, uv.y), uniforms.time + seed * 10.0, seed, 0.18);
            let dark = luma(col) < 0.05;
            let edgeCol = select(col, vec3f(1.0, 0.05, 0.12), dark);
            rgb = select(col * b.x * 3.0 + col * b.y * 0.8, edgeCol * b.y * 2.5 - vec3f(b.x), dark);
            a = clamp(b.x + b.y * 0.8, 0.0, 1.0) * (1.0 - age);
        }
        case 8: {
            // paper crane (projectile): white folded paper with a vermilion fold line
            let flap = sin(uniforms.time * 14.0 + seed * 6.0) * 0.15;
            let q = vec2f(p.x, p.y * (1.0 + flap));
            let d = sdCraneShape(q, 0.95);
            let fill = sdFill(d, px * 2.0);
            let fold = sdStroke(q.y - q.x * 0.2, 0.015, px * 2.0) * fill;
            let shade = 0.85 + 0.15 * step(0.0, q.y);
            rgb = mix(vec3f(0.97, 0.95, 0.9) * shade, vec3f(0.8, 0.1, 0.08), fold) + col * 0.15;
            a = max(fill, sdStroke(d, 0.03, px * 2.0) * 0.9);
            rgb = mix(vec3f(0.12, 0.05, 0.08), rgb, fill);
        }
        case 9: {
            // floating lantern with a face of fire (Sojin's curses)
            let d = sdLanternShape(p * vec2f(1.0, 1.0), 0.6, 0.8);
            let fill = sdFill(d, px * 2.0);
            let ribs = 0.8 + 0.2 * step(0.5, fract(p.y * 5.0));
            let flick = 0.8 + 0.2 * valueNoise2(vec2f(uniforms.time * 8.0, seed * 9.0));
            let glow = exp(-length(p) * 2.2) * flick;
            let eyes = sdFill(min(sdCircle(p - vec2f(-0.18, 0.1), 0.07), sdCircle(p - vec2f(0.18, 0.1), 0.07)), px * 2.0);
            rgb = col * (fill * ribs * 1.3 + glow) * flick - vec3f(eyes * 0.8);
            a = max(fill, glow * 0.7);
        }
        case 10: {
            // energy orb with a turbulent rim (bells, brands, embers)
            let r = length(p);
            let n = fbm2(p * 3.0 + vec2f(st * 2.0, seed * 5.0), 3, 2.0, 0.5);
            let rim = smoothstep(0.75, 0.55, r + n * 0.15) - smoothstep(0.55, 0.25, r);
            let core = smoothstep(0.5, 0.0, r);
            let pal = mix(col, vec3f(1.0), core * 0.8);
            rgb = pal * (core * 1.5 + rim * 1.2 + exp(-r * 3.0) * 0.5) * inten;
            a = clamp(core + rim + exp(-r * 3.0) * 0.4, 0.0, 1.0);
        }
        case 11: {
            let t = talisman(uv, seed * 13.0);
            rgb = t.rgb;
            a = t.a;
        }
        case 12: {
            // ground dust: a flat lumpy ring blown outward
            let r = length(p);
            let n = valueNoise2(vec2f(atan2(p.y, p.x) * 5.0 + seed * 7.0, age * 2.0));
            let band = smoothstep(age * 0.8 - 0.2, age * 0.8 + 0.1, r) * smoothstep(1.0, 0.7 + n * 0.2, r);
            rgb = col * (0.8 + 0.4 * n);
            a = band * (1.0 - age) * 0.8 * inten;
        }
        case 13: {
            // speed streak
            let x = uv.x;
            let w = abs(uv.y - 0.5) * 2.0;
            let s = smoothstep(1.0, 0.2, w) * smoothstep(0.0, 0.3, x) * smoothstep(1.0, 0.6, x);
            rgb = col * s;
            a = s * (1.0 - age) * inten;
        }
        case 14: {
            // a tongue of fire on 2s
            let f = flameShape(uv, st, seed * 10.0);
            let heat = f * (1.0 - uv.y * 0.6);
            rgb = mix(col, vec3f(1.0, 0.9, 0.6), smoothstep(0.6, 1.0, heat)) * heat * 2.0;
            a = f * (1.0 - smoothstep(0.7, 1.0, age));
        }
        case 15: {
            // a drop (tears, rain splashes)
            let q = vec2f(p.x, p.y + 0.2);
            let d = min(sdCircle(q, 0.45), sdTriangle2(q, vec2f(-0.38, 0.22), vec2f(0.38, 0.22), vec2f(0.0, 1.0)));
            rgb = col * (0.6 + 0.4 * smoothstep(0.3, -0.3, p.x));
            a = sdFill(d, px * 2.0) * (1.0 - age);
        }
        case 16: {
            // Stillwater ripple: concentric rings spreading on the water of time
            let r = length(p);
            var w = 0.0;
            for (var i = 0; i < 3; i++) {
                let ph = fract(age * 1.5 + f32(i) / 3.0);
                w = w + shockRing(r, ph * 0.95, 0.025 + ph * 0.02) * (1.0 - ph);
            }
            rgb = col * w;
            a = w;
        }
        case 17: {
            // Moonfall: a falling disc of moonlight
            let r = length(p);
            let disc = smoothstep(0.5, 0.45, r);
            let halo = exp(-r * 3.0);
            rgb = col * (disc * 1.5 + halo);
            a = clamp(disc + halo * 0.6, 0.0, 1.0) * (1.0 - age);
        }
        case 18: {
            // Gravebrand well: inward-spiralling violet bands
            let pr = toPolar(p);
            let spiral = sin(pr.y * 3.0 + log(max(pr.x, 0.01)) * 8.0 + uniforms.time * 6.0);
            let well = smoothstep(1.0, 0.3, pr.x) * (0.5 + 0.5 * spiral);
            let core = smoothstep(0.25, 0.0, pr.x);
            rgb = col * well - vec3f(core);
            a = clamp(well + core, 0.0, 1.0) * (1.0 - smoothstep(0.8, 1.0, age));
        }
        default: {
            let r = length(p);
            a = smoothstep(1.0, 0.0, r);
            rgb = col * a;
        }
    }
#ifdef GLOW
    fragmentOutputs.color = vec4f(rgb * inten * a, 0.0);
#else
    if (a < 0.01) {
        discard;
    }
    fragmentOutputs.color = vec4f(rgb, a);
#endif
}
