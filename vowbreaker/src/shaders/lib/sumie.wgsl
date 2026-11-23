// Sumi-e: the memories (flashbacks) painted as ink on rice paper (vbSumie, before the stylize pass).
//
// The scene is read for its values and its edges and repainted:
//   washes     the image's value becomes four tones of ink (paper, pale wash, mid wash, dark);
//              each wash bleeds a little into the paper, darkens at its wet edge where pigment
//              collects, and granulates where the paper's tooth catches it
//   strokes    edges (depth and normal breaks from the G-buffer, plus strong value changes) become
//              brush strokes: dark and full near the eye, thin and broken far away, their texture
//              stretched along the edge so they read as one sweep of a brush, never a line
//   colour     memories are mostly monochrome; one colour can be kept (Mio's red, Hina's lantern
//              orange) and a faint wash of the original colour stays where the memory is warmest
//   paper      rice paper fibre, a soft deckled border where the brush did not reach, a red seal

struct SumieInk {
    tone: f32,       // 0 paper .. 1 black
    stroke: f32,     // brush stroke coverage
    keep: f32,       // how much of the original colour survives here
}

// value -> wash tone, banded, with the band edges softened by noise (a hand laying washes)
fn sumieWash(l: f32, n: f32) -> f32 {
    let v = clamp(1.0 - l * 1.45, 0.0, 1.0) + (n - 0.5) * 0.12;
    let bands = 4.0;
    let q = floor(v * bands) / bands;
    let f = fract(v * bands);
    // soft step between bands: most of a band is flat, the transition is short
    return q + smoothstep(0.75, 0.95, f) / bands;
}

// the wet edge: pigment collects where a wash ends (darker rim along band changes)
fn sumieWetEdge(t: f32, tx: f32, ty: f32) -> f32 {
    return clamp(abs(t - tx) + abs(t - ty), 0.0, 1.0);
}

// granulation: pigment settling in the paper's tooth
fn sumieGranulate(tone: f32, pixel: vec2f, seed: f32) -> f32 {
    let g = valueNoise2(pixel * 0.7 + seed) * 0.6 + valueNoise2(pixel * 0.23 + seed * 3.0) * 0.4;
    return clamp(tone * (0.85 + 0.3 * g), 0.0, 1.0);
}

// a brush stroke's texture along an edge: noise stretched along the edge direction
fn sumieStrokeTexture(pixel: vec2f, dir: vec2f, seed: f32) -> f32 {
    let t = normalize(dir + vec2f(1e-5));
    let along = dot(pixel, vec2f(t.y, -t.x));
    let across = dot(pixel, t);
    let hairs = valueNoise2(vec2f(across * 0.6, along * 0.04) + seed);
    let breaks = valueNoise2(vec2f(across * 0.05, along * 0.015) + seed * 7.0);
    return smoothstep(0.25, 0.55, hairs) * smoothstep(0.2, 0.45, breaks);
}

// rice paper: long fibres and soft blotches
fn sumiePaper(pixel: vec2f, seed: f32) -> f32 {
    let fibre = valueNoise2(vec2f(pixel.x * 0.02, pixel.y * 0.6) + seed) * valueNoise2(vec2f(pixel.x * 0.6, pixel.y * 0.02) + seed * 2.0);
    let blot = vfbm2(pixel * 0.004 + seed, 3);
    return 0.92 + fibre * 0.1 + (blot - 0.5) * 0.06;
}

// the deckled border: the painting fades out before the paper's edge, raggedly
fn sumieBorder(uv: vec2f, aspect: f32, seed: f32) -> f32 {
    let e = min(min(uv.x, 1.0 - uv.x) * aspect, min(uv.y, 1.0 - uv.y));
    let n = vfbm2(uv * vec2f(aspect, 1.0) * 6.0 + seed, 4);
    return smoothstep(0.02, 0.09, e + (n - 0.5) * 0.06);
}

// keep one hue (0..1 around the wheel; negative = none): how close a colour is to it
fn sumieKeepHue(c: vec3f, hue: f32) -> f32 {
    if (hue < 0.0) {
        return 0.0;
    }
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    let sat = (mx - mn) / max(mx, 1e-4);
    var h = 0.0;
    if (mx - mn > 1e-4) {
        if (mx == c.r) {
            h = (c.g - c.b) / (mx - mn);
        } else if (mx == c.g) {
            h = 2.0 + (c.b - c.r) / (mx - mn);
        } else {
            h = 4.0 + (c.r - c.g) / (mx - mn);
        }
        h = fract(h / 6.0 + 1.0);
    }
    let dh = min(abs(h - hue), 1.0 - abs(h - hue));
    return (1.0 - smoothstep(0.04, 0.1, dh)) * smoothstep(0.25, 0.5, sat);
}

// the ink colour: a warm black, slightly blue where it is diluted (real sumi does this)
fn sumieInkColor(tone: f32) -> vec3f {
    let dilute = vec3f(0.34, 0.36, 0.42);
    let full = vec3f(0.06, 0.05, 0.055);
    return mix(dilute, full, smoothstep(0.3, 1.0, tone));
}
