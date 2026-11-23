// ============================================================================================
// vb_manga: the grammar of manga panels, drawn over the frame when a moment needs it.
// Screentones (round dots, lines, gradient tones, the sandy "noise" tone) that replace flat
// shadow; focus lines converging on a face; speed lines streaming behind a dash; the black
// "beta" fill of a dramatic silhouette; sparkle (kira) marks round something precious; gloom
// lines (zuun) hanging over a shocked face; a sound-effect burst painted across the panel; the
// white gutters and black borders of panels when the screen splits for a cut-in.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_sdf2d, vb_toon, vb_vfx.
// ============================================================================================

// --- screentones -------------------------------------------------------------------------------

// dot tone whose dot size follows darkness; tone in 0 (paper) .. 1 (full)
fn toneDots(pixel: vec2f, tone: f32, cellPx: f32, angle: f32) -> f32 {
    return halftoneDots(pixel, cellPx, angle, tone);
}

// line tone (hatching screentone)
fn toneLines(pixel: vec2f, tone: f32, cellPx: f32, angle: f32) -> f32 {
    return halftoneLines(pixel, cellPx, angle, tone);
}

// gradient tone: dots that grow across the frame (dramatic skies, a fading memory)
fn toneGradient(pixel: vec2f, uv: vec2f, dir: vec2f, start: f32, end: f32, cellPx: f32) -> f32 {
    let t = clamp((dot(uv, normalize(dir)) - start) / max(end - start, 1e-4), 0.0, 1.0);
    return halftoneDots(pixel, cellPx, 0.785, t);
}

// sand tone: an irregular stipple
fn toneSand(pixel: vec2f, tone: f32) -> f32 {
    let h = hash12(floor(pixel * 0.7));
    return step(1.0 - tone * 0.85, h);
}

// replace the darkest values of an image with screentone (black ink on white)
fn toneShadows(c: vec3f, pixel: vec2f, threshold: f32, cellPx: f32, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let l = luma(c);
    let shade = 1.0 - smoothstep(threshold * 0.4, threshold, l);
    let dots = toneDots(pixel, shade * 0.85, cellPx, 0.785);
    return mix(c, c * (1.0 - dots * 0.6), amount * shade);
}

// --- lines ----------------------------------------------------------------------------------------

// focus lines: dense radial strokes converging on a point, broken by noise, clear in the middle
fn focusLines(uv: vec2f, center: vec2f, aspect: f32, innerR: f32, density: f32, seed: f32) -> f32 {
    let d = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let r = length(d);
    let a = atan2(d.y, d.x);
    let idx = floor(a / TAU * density);
    let h = hash11(idx + seed * 13.0);
    let width = 0.25 + h * 0.5;
    let stripe = 1.0 - smoothstep(width * 0.4, width * 0.5, abs(fract(a / TAU * density) - 0.5));
    let start = innerR * (0.7 + h * 0.6);
    let taper = smoothstep(start, start + 0.15, r);
    return stripe * taper * step(0.35, h);
}

// speed lines: horizontal (or any direction) streaks of varied length and weight
fn speedLinesDir(uv: vec2f, dir: vec2f, aspect: f32, time: f32, density: f32, seed: f32) -> f32 {
    let d = normalize(dir);
    let p = vec2f(uv.x * aspect, uv.y);
    let across = dot(p, vec2f(-d.y, d.x)) * density;
    let along = dot(p, d);
    let row = floor(across);
    let h = hash21(row + seed * 7.0);
    let len = 0.15 + h.x * 0.5;
    let pos = fract(along * (0.6 + h.y) - time * (2.0 + h.x * 3.0) + h.y * 5.0);
    let thick = 1.0 - smoothstep(0.08, 0.3 + h.y * 0.2, abs(fract(across) - 0.5));
    return thick * smoothstep(0.0, 0.05, pos) * (1.0 - smoothstep(len - 0.05, len, pos)) * step(0.45, h.y);
}

// --- marks ------------------------------------------------------------------------------------------

// sparkle "kira": four-point stars round a centre
fn kiraMarks(uv: vec2f, center: vec2f, aspect: f32, radius: f32, time: f32) -> f32 {
    var acc = 0.0;
    for (var i = 0; i < 6; i++) {
        let fi = f32(i);
        let h = hash21(fi * 3.7);
        let a = fi / 6.0 * TAU + time * 0.4;
        let pos = center + vec2f(cos(a) / aspect, sin(a)) * radius * (0.7 + h.x * 0.6);
        let q = vec2f((uv.x - pos.x) * aspect, uv.y - pos.y);
        let s = 0.012 + h.y * 0.012;
        let pulse = 0.6 + 0.4 * sin(time * 5.0 + fi * 2.0);
        let star = sdStar(q, s * pulse, 4.0, 3.5);
        acc = max(acc, sdFill(star, 0.002));
    }
    return acc;
}

// gloom lines "zuun": vertical strokes hanging from the top of the panel over a head
fn gloomLines(uv: vec2f, centerX: f32, width: f32, depth: f32, seed: f32) -> f32 {
    let x = (uv.x - centerX) / max(width, 1e-4);
    if (abs(x) > 1.0) {
        return 0.0;
    }
    let col = floor(x * 9.0);
    let h = hash11(col + seed);
    let len = depth * (0.5 + h * 0.5) * (1.0 - x * x);
    let line = 1.0 - smoothstep(0.1, 0.35, abs(fract(x * 9.0) - 0.5));
    return line * step(1.0 - len, uv.y) * step(0.3, h);
}

// a sound-effect burst: a jagged starburst panel with brush glyph strokes inside
fn sfxBurst(uv: vec2f, center: vec2f, aspect: f32, size: f32, seed: f32) -> vec2f {
    let q = vec2f((uv.x - center.x) * aspect, uv.y - center.y) / max(size, 1e-4);
    let burst = sdStarburst(q, 0.8, 14.0, 0.25, seed);
    let fill = sdFill(burst, 0.01);
    let edge = sdStroke(burst, 0.04, 0.01);
    var glyph = 0.0;
    for (var i = 0; i < 3; i++) {
        let gq = (q - vec2f(-0.4 + f32(i) * 0.4, 0.0)) * 2.4;
        glyph = max(glyph, sdFill(sdGlyph(gq, seed + f32(i)), 0.03));
    }
    return vec2f(fill, max(edge, glyph * fill));
}

// --- panels -------------------------------------------------------------------------------------------

// split the screen into slanted panels for a cut-in: returns (panel index, border mask)
fn panelLayout(uv: vec2f, aspect: f32, kind: i32, gutter: f32) -> vec2f {
    let q = vec2f(uv.x * aspect, uv.y);
    var idx = 0.0;
    var border = 0.0;
    if (kind == 1) {
        // two panels split by a diagonal
        let s = q.x - aspect * 0.5 - (q.y - 0.5) * 0.35;
        idx = step(0.0, s);
        border = 1.0 - smoothstep(gutter * 0.5, gutter * 0.5 + 0.002, abs(s));
    } else if (kind == 2) {
        // three panels: a tall left panel, two stacked on the right
        let s1 = q.x - aspect * 0.42 - (q.y - 0.5) * 0.2;
        let s2 = q.y - 0.5 - (q.x - aspect * 0.7) * 0.1;
        idx = select(0.0, select(1.0, 2.0, s2 > 0.0), s1 > 0.0);
        border = max(1.0 - smoothstep(gutter * 0.5, gutter * 0.5 + 0.002, abs(s1)),
                     (1.0 - smoothstep(gutter * 0.5, gutter * 0.5 + 0.002, abs(s2))) * step(0.0, s1));
    } else if (kind == 3) {
        // three horizontal strips (eyes, eyes, eyes -- a stand-off)
        let row = uv.y * 3.0;
        idx = floor(row);
        border = 1.0 - smoothstep(gutter * 1.5, gutter * 1.5 + 0.004, abs(fract(row) - 0.5) - 0.5 + gutter * 3.0);
    }
    return vec2f(idx, border);
}

// black "beta" fill: crush everything below a threshold to solid ink (silhouettes against a sky)
fn betaFill(c: vec3f, threshold: f32, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let l = luma(c);
    let ink = 1.0 - smoothstep(threshold - 0.02, threshold + 0.02, l);
    return mix(c, vec3f(0.015, 0.01, 0.015), ink * amount);
}

// the manga page: paper white highlights, ink blacks, one screentone mid layer (memory stills)
fn mangaPage(c: vec3f, pixel: vec2f, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let l = luma(c);
    let ink = 1.0 - smoothstep(0.12, 0.16, l);
    let mid = smoothstep(0.16, 0.2, l) * (1.0 - smoothstep(0.45, 0.5, l));
    let dots = toneDots(pixel, 0.45, 5.0, 0.785) * mid;
    let page = vec3f(0.96, 0.95, 0.92) * (1.0 - dots * 0.9) * (1.0 - ink);
    return mix(c, page, amount);
}
