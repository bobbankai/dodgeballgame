// ============================================================================================
// vb_tonemap: from scene light to display values. Anime is graded for flat, saturated colour that
// still holds a highlight -- a strong toe for rich darks, a gentle shoulder that keeps hue instead
// of washing to white, and a "paper white" ceiling (lit paper, not a light bulb). This library has
// the operators the looks choose from, hue-preserving variants, exposure helpers for the auto
// exposure pass, and a few display utilities.
// Depends on vb_common, vb_color.
// ============================================================================================

// --- exposure ---------------------------------------------------------------------------------------

fn ev100FromLuminance(avgLum: f32) -> f32 {
    return log2(max(avgLum, 1e-5) * 100.0 / 12.5);
}

fn exposureFromEv100(ev100: f32) -> f32 {
    return 1.0 / (1.2 * exp2(ev100));
}

// auto exposure: scale so the scene's average log luminance lands on `key`, clamped to a range
fn autoExposureScale(avgLogLum: f32, key: f32, minEv: f32, maxEv: f32) -> f32 {
    let avg = exp2(avgLogLum);
    let ev = clamp(log2(key / max(avg, 1e-5)), minEv, maxEv);
    return exp2(ev);
}

// eye adaptation: exponential approach, faster when it gets brighter (the eye closes quickly)
fn adaptLuminance(prev: f32, goal: f32, dt: f32, speedUp: f32, speedDown: f32) -> f32 {
    let speed = select(speedDown, speedUp, goal > prev);
    return prev + (goal - prev) * (1.0 - exp(-dt * speed));
}

// --- curves -----------------------------------------------------------------------------------------

// a filmic curve with explicit toe and shoulder (Hable-style with artist parameters)
fn filmicCurve(x: f32, toeStrength: f32, toeLength: f32, shoulderStrength: f32, shoulderLength: f32, whitePoint: f32) -> f32 {
    let x0 = toeLength * 0.5;
    let x1 = 1.0 - shoulderLength * 0.5;
    var y = x;
    if (x < x0) {
        let t = x / max(x0, 1e-4);
        y = x0 * pow(t, 1.0 + toeStrength);
    } else if (x > x1) {
        let t = (x - x1) / max(whitePoint - x1, 1e-4);
        y = x1 + (1.0 - x1) * (1.0 - exp(-t * (1.0 + shoulderStrength * 3.0))) / (1.0 - exp(-(1.0 + shoulderStrength * 3.0)));
    }
    return clamp(y, 0.0, 1.0);
}

fn filmicCurve3(c: vec3f, toe: f32, toeLen: f32, sh: f32, shLen: f32, white: f32) -> vec3f {
    return vec3f(filmicCurve(c.r, toe, toeLen, sh, shLen, white), filmicCurve(c.g, toe, toeLen, sh, shLen, white), filmicCurve(c.b, toe, toeLen, sh, shLen, white));
}

fn tonemapReinhardJodie(c: vec3f) -> vec3f {
    let l = luma(c);
    let tc = c / (1.0 + c);
    return mix(c / (1.0 + l), tc, tc);
}

fn tonemapHejlBurgess(c: vec3f) -> vec3f {
    let x = max(vec3f(0.0), c - 0.004);
    let y = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
    return srgbToLinear(y);
}

// a neutral operator in the spirit of Khronos PBR Neutral: keeps hue and saturation of
// in-gamut colours, only compresses what goes past the shoulder
fn tonemapNeutral(c0: vec3f) -> vec3f {
    let startCompression = 0.8 - 0.04;
    let desaturation = 0.15;
    let x = minc3(c0);
    let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
    var c = c0 - offset;
    let peak = maxc3(c);
    if (peak < startCompression) {
        return c;
    }
    let d = 1.0 - startCompression;
    let newPeak = 1.0 - d * d / (peak + d - startCompression);
    c = c * (newPeak / peak);
    let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(c, vec3f(newPeak), g);
}

// hue-preserving: tonemap the max channel, scale the colour by the same ratio, then desaturate
// only the part that would have clipped (bright fire stays orange, not yellow-white)
fn tonemapHuePreserving(c: vec3f, shoulder: f32, desat: f32) -> vec3f {
    let m = maxc3(c);
    if (m <= 1e-5) {
        return c;
    }
    let mapped = 1.0 - exp(-m * (1.0 + shoulder));
    var o = c * (mapped / m);
    let over = clamp((m - 1.0) * 0.5, 0.0, 1.0);
    o = mix(o, vec3f(luma(o) * 1.05), over * desat);
    return o;
}

// the paper look: ink can't get darker than ink, paper can't get whiter than paper
fn tonemapPaper(c: vec3f, inkBlack: f32, paperWhite: vec3f) -> vec3f {
    let t = tonemapHuePreserving(c, 0.5, 0.4);
    return mix(vec3f(inkBlack), paperWhite, t);
}

// AgX with looks (punchy for fights, golden for memories)
fn agxDefaultContrast(x: vec3f) -> vec3f {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn agxLook(c0: vec3f, look: i32) -> vec3f {
    let agxIn = mat3x3f(vec3f(0.842479, 0.0784336, 0.0792237), vec3f(0.0423303, 0.878468, 0.0791661), vec3f(0.0423757, 0.0784336, 0.879142));
    let agxOut = mat3x3f(vec3f(1.19688, -0.0980209, -0.0990297), vec3f(-0.0528969, 1.15190, -0.0989612), vec3f(-0.0529716, -0.0980435, 1.15107));
    var c = agxIn * max(c0, vec3f(1e-10));
    c = clamp(log2(c), vec3f(-12.47393), vec3f(4.026069));
    c = (c + 12.47393) / 16.500999;
    c = agxDefaultContrast(c);
    var slope = vec3f(1.0);
    var power = vec3f(1.0);
    var sat = 1.0;
    if (look == 1) {
        // punchy
        power = vec3f(1.35);
        sat = 1.4;
    } else if (look == 2) {
        // golden
        slope = vec3f(1.0, 0.9, 0.5);
        power = vec3f(0.8);
        sat = 1.3;
    }
    let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    c = pow(max(c * slope, vec3f(0.0)), power);
    c = l + sat * (c - l);
    c = agxOut * c;
    return srgbToLinear(clamp(c, vec3f(0.0), vec3f(1.0)));
}

// --- display ------------------------------------------------------------------------------------------

// gamut compression: pull out-of-gamut (negative) channels back in smoothly, keeping luminance
fn gamutCompress(c: vec3f) -> vec3f {
    let l = luma(c);
    let mn = minc3(c);
    if (mn >= 0.0) {
        return c;
    }
    let t = l / max(l - mn, 1e-5);
    return l + (c - l) * t;
}

// the toe lift that stops flat anime blacks crushing on cheap displays
fn blackLift(c: vec3f, lift: f32) -> vec3f {
    return c * (1.0 - lift) + lift;
}

// a soft clip for values just over 1 (UI glow, highlights)
fn softClip(c: vec3f, knee: f32) -> vec3f {
    let over = max(c - (1.0 - knee), vec3f(0.0));
    return min(c, vec3f(1.0 - knee)) + knee * (1.0 - exp(-over / max(knee, 1e-4)));
}

// pick an operator by index (the post chain's tonemapCurve setting)
//   0 anime (existing tonemapAnime), 1 AgX, 2 ACES fitted, 3 neutral, 4 hue preserving,
//   5 AgX punchy, 6 AgX golden, 7 paper
fn tonemapSelect(c: vec3f, curve: i32, shoulder: f32, desat: f32) -> vec3f {
    switch curve {
        case 1: {
            return agxLook(c, 0);
        }
        case 2: {
            return tonemapAcesFitted(c);
        }
        case 3: {
            return tonemapNeutral(c);
        }
        case 4: {
            return tonemapHuePreserving(c, shoulder, desat);
        }
        case 5: {
            return agxLook(c, 1);
        }
        case 6: {
            return agxLook(c, 2);
        }
        case 7: {
            return tonemapPaper(c, 0.025, vec3f(0.97, 0.95, 0.9));
        }
        default: {
            return tonemapAnime(c, shoulder, desat);
        }
    }
}
