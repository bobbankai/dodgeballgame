// Curse surfaces (toon.fragment): the curses are not people and should not shade like people.
// Each kind (CharacterLook.curse.x) repaints the body after the cel light:
//   1 mud        Mudhand: mud flowing down the body in sheets, glossy wet bands, drips, bubbles
//                that swell and pop, dark handprints pressed into it
//   2 umbrella   the Red Umbrella: oiled paper, ribs radiating from the crown, glowing red where
//                light comes through, rain beading and running
//   3 ghost      the Weeping Bride: half there (screen-door transparency that breathes), the hem
//                dissolving into mist, lace shimmering across the veil, a pale cold rim
//   4 paper      Shiragami: paper with its fibres and folds, rows of glyphs crawling across the body,
//                the edges charring when it is hurt
//   5 acolyte    the lantern acolytes: a band of glyphs glowing round the robe, the third eye on the
//                mask opening and pulsing, lantern light flickering from below

struct CurseOut {
    col: vec3f,
    cut: f32,        // 1 = discard (ghosts)
}

fn curseNone(col: vec3f) -> CurseOut {
    var o: CurseOut;
    o.col = col;
    o.cut = 0.0;
    return o;
}

// --- mud --------------------------------------------------------------------------------------------------

fn curseMud(col: vec3f, objPos: vec3f, n: vec3f, v: vec3f, l: vec3f, lit: f32, time: f32, figureH: f32) -> vec3f {
    let p = objPos / max(figureH, 0.1);
    // sheets flowing down: noise scrolled downward, faster where the body is steep
    let flow = vfbm2(vec2f(atan2(p.z, p.x) * 2.0, p.y * 6.0 + time * 0.35), 4);
    let mud = mix(vec3f(0.16, 0.11, 0.07), vec3f(0.3, 0.21, 0.13), flow);
    var c = mud * mix(0.45, 1.0, lit);
    // wet bands: a stepped highlight sliding down with the flow
    let h = normalize(l + v);
    let spec = smoothstep(0.9, 0.93, dot(n, h)) * smoothstep(0.45, 0.6, flow);
    c = c + vec3f(0.55, 0.5, 0.42) * spec * lit;
    // drips: thin darker runnels
    let runnel = 1.0 - smoothstep(0.0, 0.03, abs(fract(atan2(p.z, p.x) * 5.0 + flow * 0.4) - 0.5));
    c = mix(c, mud * 0.5, runnel * 0.5);
    // bubbles: swelling rings that pop
    let cell = floor(p * 14.0 + vec3f(0.0, time * 0.3, 0.0));
    let hb = hash13(cell);
    let life = fract(time * 0.4 + hb * 5.0);
    let bp = fract(p * 14.0 + vec3f(0.0, time * 0.3, 0.0)) - 0.5;
    let ring = 1.0 - smoothstep(0.0, 0.05, abs(length(bp.xz) - life * 0.35));
    c = c + vec3f(0.35, 0.3, 0.25) * ring * step(0.8, hb) * (1.0 - life);
    // handprints pressed into it: dark palm-and-finger shapes
    let hp = vec2f(atan2(p.z, p.x) * 1.6, p.y * 3.0);
    let hid = floor(hp);
    let hh = hash12(hid + 3.0);
    if (hh > 0.7) {
        let q = (fract(hp) - 0.5) * vec2f(1.0, 1.3);
        var hand = length(q - vec2f(0.0, -0.08)) - 0.16;
        for (var k = 0; k < 4; k++) {
            let fx = (f32(k) - 1.5) * 0.08;
            hand = min(hand, sdSegment2(q, vec2f(fx, 0.0), vec2f(fx * 1.3, 0.25 + f32(k % 2) * 0.03)) - 0.035);
        }
        hand = min(hand, sdSegment2(q, vec2f(0.14, -0.08), vec2f(0.26, 0.05)) - 0.035);
        c = mix(c, mud * 0.3, (1.0 - smoothstep(-0.01, 0.01, hand)) * 0.85);
    }
    return mix(col, c, 0.9);
}

// --- umbrella ------------------------------------------------------------------------------------------------

fn curseUmbrella(col: vec3f, objPos: vec3f, n: vec3f, v: vec3f, l: vec3f, lit: f32, time: f32, figureH: f32, sunCol: vec3f) -> vec3f {
    let p = objPos / max(figureH, 0.1);
    let ang = atan2(p.z, p.x);
    // ribs radiating from the crown
    let rib = 1.0 - smoothstep(0.0, 0.04, abs(fract(ang / TAU * 16.0) - 0.5));
    var c = col * (1.0 - rib * 0.35);
    // light through the oiled paper: glowing red where the light is behind
    let back = pow(clamp(dot(v, -l), 0.0, 1.0), 3.0);
    c = c + vec3f(0.9, 0.12, 0.08) * sunCol * back * 0.6;
    // rain beading and running: small bright beads sliding down
    let g = vec2f(ang * 6.0, p.y * 20.0 + time * 1.5);
    let cell = floor(g);
    let h = hash12(cell);
    let f = fract(g) - vec2f(0.5, 0.5 + (h - 0.5) * 0.4);
    let bead = (1.0 - smoothstep(0.08, 0.12, length(f * vec2f(1.0, 0.7)))) * step(0.75, h);
    c = c + vec3f(0.8) * bead * 0.6 * (0.5 + 0.5 * lit);
    return c;
}

// --- ghost ---------------------------------------------------------------------------------------------------

fn curseGhost(col: vec3f, objPos: vec3f, n: vec3f, v: vec3f, time: f32, figureH: f32, pixel: vec2f) -> CurseOut {
    var o = curseNone(col);
    let p = objPos / max(figureH, 0.1);
    let fres = 1.0 - clamp(dot(n, v), 0.0, 1.0);
    // half there: a screen-door pattern whose density breathes, thinner at the hem (mist below)
    let breath = 0.5 + 0.15 * sin(time * 1.3);
    let hem = smoothstep(0.25, 0.0, p.y);
    let density = clamp(breath + fres * 0.4 - hem * 0.8, 0.0, 1.0);
    let dither = interleavedGradientNoiseAnimated(pixel, floor(time * 12.0));
    let mist = vfbm2(vec2f(p.x * 6.0, p.y * 6.0 - time * 0.3), 3);
    if (dither > density + (mist - 0.5) * 0.3) {
        o.cut = 1.0;
        return o;
    }
    // lace shimmering across the veil, a pale cold rim, everything washed toward white
    let lace = step(0.6, valueNoise2(vec2f(atan2(p.z, p.x) * 30.0, p.y * 60.0 + time * 0.5)));
    var c = mix(col, vec3f(0.85, 0.9, 1.0), 0.45);
    c = c + vec3f(0.6, 0.7, 0.9) * pow(fres, 2.0) * 0.8;
    c = c + vec3f(0.5) * lace * step(0.55, p.y) * 0.3;
    o.col = c;
    return o;
}

// --- paper ---------------------------------------------------------------------------------------------------

fn cursePaper(col: vec3f, objPos: vec3f, n: vec3f, time: f32, figureH: f32, hurt: f32) -> vec3f {
    let p = objPos / max(figureH, 0.1);
    let fibre = valueNoise2(vec2f(p.x * 80.0, p.y * 4.0)) * valueNoise2(vec2f(p.x * 4.0, p.y * 80.0));
    var c = col * (0.94 + fibre * 0.1);
    // folds: creases where the normal turns sharply
    let crease = smoothstep(0.25, 0.6, length(fwidth(n)));
    c = c * (1.0 - crease * 0.25);
    // rows of glyphs crawling sideways across the body
    let row = floor(p.y * 14.0);
    let gx = atan2(p.z, p.x) * 4.0 + time * (0.3 + hash11(row) * 0.4) * select(-1.0, 1.0, hash11(row + 5.0) > 0.5);
    let q = vec2f(fract(gx) - 0.5, fract(p.y * 14.0) - 0.5);
    let g = sdGlyph(q * vec2f(1.0, 1.2), floor(gx) + row * 13.0);
    let glyph = (1.0 - smoothstep(0.0, 0.04, g)) * step(0.45, hash11(row * 3.1));
    c = mix(c, vec3f(0.08, 0.06, 0.07), glyph * 0.8);
    // charring at the edges when hurt
    let edgeN = vfbm2(p.xy * 9.0 + p.zz * 4.0, 3);
    let burn = smoothstep(1.0 - hurt * 0.8, 1.05 - hurt * 0.8, edgeN);
    c = mix(c, vec3f(0.08, 0.05, 0.03), burn);
    c = c + vec3f(1.6, 0.6, 0.15) * (1.0 - smoothstep(0.0, 0.03, abs(edgeN - (1.0 - hurt * 0.8)))) * step(0.05, hurt);
    return c;
}

// --- acolyte -------------------------------------------------------------------------------------------------

fn curseAcolyte(col: vec3f, objPos: vec3f, n: vec3f, time: f32, figureH: f32, headH: f32) -> vec3f {
    let p = objPos / max(figureH, 0.1);
    var c = col;
    // a band of glyphs round the robe at the waist, glowing
    let band = step(abs(p.y - 0.45), 0.03);
    let gx = atan2(p.z, p.x) * 8.0;
    let g = sdGlyph(vec2f(fract(gx) - 0.5, (p.y - 0.45) * 14.0), floor(gx) * 7.0);
    let glyph = (1.0 - smoothstep(0.0, 0.05, g)) * band;
    let pulse = 0.7 + 0.3 * sin(time * 3.0 + gx);
    c = c + vec3f(1.6, 0.6, 0.15) * glyph * pulse;
    // the third eye on the mask's brow
    let eyeC = vec2f(0.0, headH + 0.03);
    let q = vec2f(p.x * 10.0, (p.y - eyeC.y) * 14.0) * step(0.0, p.z);
    let open = 0.5 + 0.5 * sin(time * 0.9);
    let lid = sdVesica(q, 0.5, 0.5 - open * 0.3);
    let iris = length(q) - 0.18 * open;
    c = mix(c, vec3f(0.95, 0.85, 0.6), (1.0 - smoothstep(-0.02, 0.02, lid)) * step(0.0, p.z));
    c = mix(c, vec3f(1.8, 0.4, 0.1), (1.0 - smoothstep(-0.02, 0.02, iris)) * step(0.0, p.z));
    // lantern light flickering from below
    let under = clamp(-n.y, 0.0, 1.0);
    let flick = 0.8 + 0.2 * valueNoise2(vec2f(time * 9.0, 0.0));
    c = c + vec3f(1.0, 0.45, 0.12) * under * 0.4 * flick;
    return c;
}

fn curseSurface(kind: i32, col: vec3f, objPos: vec3f, n: vec3f, v: vec3f, l: vec3f, lit: f32, time: f32, figureH: f32, headH: f32,
                hurt: f32, sunCol: vec3f, pixel: vec2f) -> CurseOut {
    switch kind {
        case 1: { return curseNone(curseMud(col, objPos, n, v, l, lit, time, figureH)); }
        case 2: { return curseNone(curseUmbrella(col, objPos, n, v, l, lit, time, figureH, sunCol)); }
        case 3: { return curseGhost(col, objPos, n, v, time, figureH, pixel); }
        case 4: { return curseNone(cursePaper(col, objPos, n, time, figureH, hurt)); }
        case 5: { return curseNone(curseAcolyte(col, objPos, n, time, figureH, headH)); }
        default: { return curseNone(col); }
    }
}
