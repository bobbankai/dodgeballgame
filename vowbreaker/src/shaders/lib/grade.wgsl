// ============================================================================================
// vb_grade: colour grading. Primary controls (curves, colour wheels for shadows / mids /
// highlights), secondaries (hue-vs-hue, hue-vs-saturation, luma-vs-saturation by sector), film
// stock emulations, and the named looks each chapter of Vowbreaker is graded with:
//   0 neutral          5 cursed (the Grand Vow: red in everything, blacks crushed warm)
//   1 dawn academy     6 festival night (warm highlights, violet shadows, glowing)
//   2 rain night       7 spring (soft pastels, lifted blacks, cyan sky)
//   3 moonlit chapel   8 fire (orange highlights, deep red shadows, heavy contrast)
//   4 memory           9 bleach bypass (the underpass: silver, low saturation, high contrast)
// Depends on vb_common, vb_color.
// ============================================================================================

// --- primaries -----------------------------------------------------------------------------------

// a smooth tone curve through (0,0), (0.25, s), (0.5, m), (0.75, h), (1,1) on log-ish values
fn gradeCurve(x: f32, s: f32, m: f32, h: f32) -> f32 {
    let xs = clamp(x, 0.0, 1.0);
    var y = 0.0;
    if (xs < 0.25) {
        y = mix(0.0, s, smoothstep(0.0, 0.25, xs) * 0.5 + xs / 0.25 * 0.5);
    } else if (xs < 0.5) {
        y = mix(s, m, (xs - 0.25) / 0.25);
    } else if (xs < 0.75) {
        y = mix(m, h, (xs - 0.5) / 0.25);
    } else {
        y = mix(h, 1.0, (xs - 0.75) / 0.25);
    }
    return y + max(x - 1.0, 0.0);
}

fn gradeCurve3(c: vec3f, s: f32, m: f32, h: f32) -> vec3f {
    return vec3f(gradeCurve(c.r, s, m, h), gradeCurve(c.g, s, m, h), gradeCurve(c.b, s, m, h));
}

// colour wheels: offsets weighted by tonal range
fn gradeWheels(c: vec3f, shadows: vec3f, mids: vec3f, highs: vec3f) -> vec3f {
    let l = luma(c);
    let ws = 1.0 - smoothstep(0.0, 0.35, l);
    let wh = smoothstep(0.4, 0.9, l);
    let wm = clamp(1.0 - ws - wh, 0.0, 1.0);
    return max(c + shadows * ws + mids * wm + highs * wh, vec3f(0.0));
}

// --- secondaries ------------------------------------------------------------------------------------

// hue-vs-hue and hue-vs-sat on six sectors (red, yellow, green, cyan, blue, magenta)
struct HueSectors {
    shift: array<f32, 6>,
    sat: array<f32, 6>,
}

fn hueSectorsNeutral() -> HueSectors {
    var h: HueSectors;
    for (var i = 0; i < 6; i++) {
        h.shift[i] = 0.0;
        h.sat[i] = 1.0;
    }
    return h;
}

fn gradeHueSectors(c: vec3f, h: HueSectors) -> vec3f {
    var hsv = rgbToHsv(max(c, vec3f(0.0)));
    let pos = hsv.x * 6.0;
    let i0 = i32(floor(pos)) % 6;
    let i1 = (i0 + 1) % 6;
    let t = fract(pos);
    let w = smoothstep(0.0, 1.0, t);
    let shift = mix(h.shift[i0], h.shift[i1], w);
    let sat = mix(h.sat[i0], h.sat[i1], w);
    hsv.x = fract(hsv.x + shift);
    hsv.y = clamp(hsv.y * sat, 0.0, 1.0);
    return hsvToRgb(hsv);
}

// saturation by luminance: rich mids, cleaner shadows and highlights
fn gradeLumaSat(c: vec3f, shadowSat: f32, midSat: f32, highSat: f32) -> vec3f {
    let l = luma(c);
    let ws = 1.0 - smoothstep(0.0, 0.3, l);
    let wh = smoothstep(0.5, 0.95, l);
    let s = mix(mix(midSat, shadowSat, ws), highSat, wh);
    return adjustSaturation(c, s);
}

// --- film stocks ----------------------------------------------------------------------------------------

// warm portrait stock: gentle contrast, warm skin, cool-cyan shadows
fn filmPortrait(c: vec3f) -> vec3f {
    var o = gradeWheels(c, vec3f(-0.01, 0.0, 0.015), vec3f(0.01, 0.0, -0.01), vec3f(0.02, 0.01, -0.01));
    o = gradeCurve3(o, 0.22, 0.5, 0.78);
    return gradeLumaSat(o, 0.85, 1.05, 0.9);
}

// high saturation slide stock: deep blues and greens, punchy contrast
fn filmSlide(c: vec3f) -> vec3f {
    var o = gradeCurve3(c, 0.18, 0.5, 0.82);
    o = adjustSaturation(o, 1.3);
    var h = hueSectorsNeutral();
    h.sat[2] = 1.2;
    h.sat[4] = 1.25;
    return gradeHueSectors(o, h);
}

// tungsten cinema stock with halation: warm practical lights glow red at their edges
fn filmTungsten(c: vec3f) -> vec3f {
    var o = whiteBalance(c, -0.25, 0.05);
    o = gradeCurve3(o, 0.2, 0.5, 0.8);
    return gradeWheels(o, vec3f(0.0, 0.01, 0.02), vec3f(0.0), vec3f(0.03, 0.0, -0.02));
}

// bleach bypass: silver retained -- contrast up, saturation down, highlights hard
fn filmBleachBypass(c: vec3f, amount: f32) -> vec3f {
    let l = luma(c);
    let blend = vec3f(l);
    let overlayed = select(1.0 - 2.0 * (1.0 - blend) * (1.0 - c), 2.0 * blend * c, blend < vec3f(0.5));
    return mix(c, mix(c, overlayed, 0.8) * 0.95, amount);
}

// cross processed: magenta highlights, green-yellow shadows (a dream)
fn filmCross(c: vec3f) -> vec3f {
    let r = gradeCurve(c.r, 0.2, 0.55, 0.85);
    let g = gradeCurve(c.g, 0.28, 0.52, 0.76);
    let b = gradeCurve(c.b, 0.32, 0.48, 0.66);
    return vec3f(r, g, b);
}

// --- the looks ---------------------------------------------------------------------------------------------

fn gradeLook(c: vec3f, look: i32, amount: f32) -> vec3f {
    if (amount <= 0.0 || look == 0) {
        return c;
    }
    var o = c;
    switch look {
        case 1: {
            // dawn at the academy: warm highlights, lavender shadows, airy
            o = gradeWheels(o, vec3f(0.01, -0.005, 0.03), vec3f(0.01, 0.005, 0.0), vec3f(0.035, 0.015, -0.01));
            o = gradeCurve3(o, 0.24, 0.52, 0.8);
            o = gradeLumaSat(o, 0.9, 1.08, 0.92);
        }
        case 2: {
            // rain night: cyan-teal shadows, neon magenta kept, crushed but not dead blacks
            o = gradeWheels(o, vec3f(-0.015, 0.01, 0.03), vec3f(-0.01, 0.0, 0.015), vec3f(0.02, -0.01, 0.02));
            var h = hueSectorsNeutral();
            h.sat[5] = 1.35;
            h.sat[0] = 1.15;
            h.sat[2] = 0.7;
            o = gradeHueSectors(o, h);
            o = gradeCurve3(o, 0.2, 0.48, 0.8);
        }
        case 3: {
            // moonlit chapel: blue everything but skin, silver highlights
            o = whiteBalance(o, -0.2, 0.0);
            o = gradeWheels(o, vec3f(-0.01, 0.0, 0.03), vec3f(0.0), vec3f(0.02, 0.02, 0.03));
            o = gradeLumaSat(o, 0.7, 0.9, 0.6);
        }
        case 4: {
            // memory: warm, faded, low contrast, lifted blacks
            o = filmPortrait(o);
            o = mix(o, vec3f(luma(o)) * vec3f(1.08, 1.0, 0.85), 0.35);
            o = o * 0.9 + vec3f(0.06, 0.05, 0.035);
        }
        case 5: {
            // cursed: red bleeding into every channel, warm crushed blacks
            o = gradeWheels(o, vec3f(0.04, -0.01, -0.01), vec3f(0.05, -0.02, -0.02), vec3f(0.05, 0.0, -0.03));
            var h = hueSectorsNeutral();
            h.shift[2] = -0.12;
            h.shift[3] = -0.25;
            h.shift[4] = 0.15;
            h.sat[0] = 1.3;
            o = gradeHueSectors(o, h);
            o = gradeCurve3(o, 0.16, 0.48, 0.82);
        }
        case 6: {
            // festival night: warm lantern highlights, violet shadows, a glow
            o = gradeWheels(o, vec3f(0.015, -0.01, 0.035), vec3f(0.015, 0.0, 0.0), vec3f(0.05, 0.02, -0.02));
            o = gradeLumaSat(o, 1.0, 1.15, 1.0);
        }
        case 7: {
            // spring: soft pastels, lifted blacks, cyan sky, pink kept
            o = gradeCurve3(o, 0.28, 0.54, 0.8);
            var h = hueSectorsNeutral();
            h.shift[3] = -0.02;
            h.sat[5] = 1.15;
            h.sat[2] = 0.9;
            o = gradeHueSectors(o, h);
            o = o * 0.94 + vec3f(0.03, 0.03, 0.04);
        }
        case 8: {
            // fire: orange highlights, deep red shadows, heavy contrast
            o = filmTungsten(o);
            o = gradeWheels(o, vec3f(0.03, -0.01, -0.01), vec3f(0.03, 0.0, -0.03), vec3f(0.05, 0.02, -0.04));
            o = gradeCurve3(o, 0.15, 0.48, 0.84);
        }
        case 9: {
            o = filmBleachBypass(o, 0.8);
            o = whiteBalance(o, -0.1, 0.12);
        }
        default: {}
    }
    return mix(c, max(o, vec3f(0.0)), amount);
}

// posterise into a few painted steps while keeping hue (a cel "flat" look for flashback stills)
fn gradePosterHue(c: vec3f, steps: f32) -> vec3f {
    let l = max(luma(c), 1e-4);
    let q = floor(l * steps + 0.5) / steps;
    return c * (q / l);
}

// a gentle colour bleed: each channel nudged toward its neighbours (cheap print look)
fn gradeBleed(c: vec3f, amount: f32) -> vec3f {
    let m = (c.r + c.g + c.b) / 3.0;
    return mix(c, vec3f(c.r * 0.9 + c.g * 0.1, c.g * 0.9 + c.b * 0.1, c.b * 0.9 + c.r * 0.1), amount) * 0.5 + mix(c, vec3f(m), amount * 0.2) * 0.5;
}
