// Calligraphy: brushwork drawn over the screen for the title and the chapter cards (vbStylize).
// The HTML text sits on top; this is the ink behind it.
//
// A stroke is a quadratic curve with a pressure profile (a heavy landing blob, a thinner body, a
// flicked tail) drawn on over time; its body is broken by dry-brush hair streaks running along it,
// it bleeds a little into the paper, and its ends throw splatter. An ensō is one circular stroke
// that does not quite close. The hanko is a red seal stamped with a carved glyph, worn at its edges.

struct Ink {
    cover: f32,      // 0..1 ink
    bleed: f32,      // the wet halo round it
    tone: f32,       // 0 black .. 1 the accent colour (red strokes, the seal)
}

fn inkNone() -> Ink {
    var k: Ink;
    k.cover = 0.0;
    k.bleed = 0.0;
    k.tone = 0.0;
    return k;
}

fn inkOver(a: Ink, b: Ink) -> Ink {
    var k: Ink;
    k.cover = max(a.cover, b.cover);
    k.bleed = max(a.bleed, b.bleed);
    k.tone = select(a.tone, b.tone, b.cover > a.cover);
    return k;
}

fn bezier2(a: vec2f, b: vec2f, c: vec2f, t: f32) -> vec2f {
    let u = 1.0 - t;
    return a * u * u + b * 2.0 * u * t + c * t * t;
}

// pressure along a stroke: a heavy landing, a lighter body, a tapering flick
fn brushPressure(t: f32, land: f32, tail: f32) -> f32 {
    let landing = 1.0 + land * exp(-t * 14.0);
    let body = 0.75 + 0.25 * sin(t * 3.14159);
    let flick = 1.0 - smoothstep(1.0 - tail, 1.0, t);
    return landing * body * flick;
}

// one brush stroke along a quadratic curve, drawn on up to `progress`; returns ink
fn callStroke(p: vec2f, a: vec2f, b: vec2f, c: vec2f, width: f32, progress: f32, seed: f32) -> Ink {
    var k = inkNone();
    if (progress <= 0.0) {
        return k;
    }
    // nearest point on the curve by sampling (24 segments, refined on the best one)
    var bestD = 1e9;
    var bestT = 0.0;
    var prev = a;
    for (var i = 1; i <= 24; i++) {
        let t1 = f32(i) / 24.0;
        let cur = bezier2(a, b, c, t1);
        let seg = cur - prev;
        let h = clamp(dot(p - prev, seg) / max(dot(seg, seg), 1e-8), 0.0, 1.0);
        let d = length(p - prev - seg * h);
        if (d < bestD) {
            bestD = d;
            bestT = (f32(i - 1) + h) / 24.0;
        }
        prev = cur;
    }
    if (bestT > progress) {
        return k;
    }
    // the fresh end of a stroke being drawn is round and full of ink
    let w = width * brushPressure(bestT, 0.6, 0.25) * mix(1.0, 1.15, smoothstep(progress - 0.05, progress, bestT) * step(progress, 0.999));
    // dry-brush hairs: streaks along the stroke where the brush ran out, more toward the tail
    let across = bestD / max(w, 1e-4);
    let hairs = valueNoise2(vec2f(across * 9.0 + seed * 13.0, bestT * 3.0));
    let dryness = smoothstep(0.45, 1.0, bestT) * 0.75 + 0.1;
    let dry = smoothstep(dryness - 0.15, dryness + 0.1, hairs) * step(0.25, across);
    // ragged edge
    let edgeN = (valueNoise2(vec2f(bestT * 60.0, seed * 7.0)) - 0.5) * 0.18;
    let edge = 1.0 - smoothstep(0.9 + edgeN, 1.0 + edgeN, across);
    k.cover = edge * (1.0 - dry * 0.85);
    k.bleed = (1.0 - smoothstep(1.0, 1.6, across)) * 0.35;
    return k;
}

// an ensō: one circular stroke starting at `start` (radians) going round by `sweep`
fn brushEnso(p: vec2f, centre: vec2f, radius: f32, width: f32, start: f32, sweep: f32, progress: f32, seed: f32) -> Ink {
    var k = inkNone();
    let q = p - centre;
    let r = length(q);
    var ang = atan2(q.y, q.x) - start;
    ang = ang - TAU * floor(ang / TAU);
    let t = ang / sweep;
    if (t > 1.0 || t > progress) {
        return k;
    }
    // the circle wobbles like a hand-drawn one and thins as the brush lifts
    let wob = (valueNoise2(vec2f(t * 5.0, seed)) - 0.5) * radius * 0.06;
    let w = width * brushPressure(t, 0.8, 0.35);
    let d = abs(r - radius - wob);
    let across = d / max(w, 1e-4);
    let hairs = valueNoise2(vec2f(across * 8.0 + seed * 3.0, t * 6.0));
    let dryness = smoothstep(0.35, 1.0, t) * 0.8 + 0.05;
    let dry = smoothstep(dryness - 0.12, dryness + 0.1, hairs) * step(0.2, across);
    let edgeN = (valueNoise2(vec2f(t * 80.0, seed * 3.0)) - 0.5) * 0.2;
    k.cover = (1.0 - smoothstep(0.88 + edgeN, 1.0 + edgeN, across)) * (1.0 - dry * 0.9);
    k.bleed = (1.0 - smoothstep(1.0, 1.7, across)) * 0.3;
    return k;
}

// splatter thrown off a point in a direction (droplets of falling size)
fn brushSplatter(p: vec2f, origin: vec2f, dir: vec2f, spread: f32, size: f32, seed: f32, progress: f32) -> Ink {
    var k = inkNone();
    for (var i = 0; i < 9; i++) {
        let fi = f32(i);
        let h = hash22(vec2f(fi, seed));
        let ang = atan2(dir.y, dir.x) + (h.x - 0.5) * spread;
        let dist = (0.02 + h.y * 0.12) * length(dir);
        let c = origin + vec2f(cos(ang), sin(ang)) * dist;
        let r = size * (1.0 - h.y * 0.7) * smoothstep(fi * 0.06, fi * 0.06 + 0.1, progress);
        let d = length(p - c) - r;
        k.cover = max(k.cover, 1.0 - smoothstep(-r * 0.15, r * 0.15, d));
    }
    return k;
}

// a hanko: a red square seal with a carved glyph and worn edges
fn brushSeal(p: vec2f, centre: vec2f, size: f32, seed: f32, stamped: f32) -> Ink {
    var k = inkNone();
    if (stamped <= 0.0) {
        return k;
    }
    let q = (p - centre) / size;
    let box = sdBox2(q, vec2f(0.5));
    let wear = valueNoise2(q * 18.0 + seed * 5.0);
    let inside = 1.0 - smoothstep(-0.02, 0.02, box + (wear - 0.5) * 0.06);
    let frame = sdBox2(q, vec2f(0.42));
    let carved = sdFill(sdGlyph(q * 1.1, seed * 31.0), 0.03) * step(frame, 0.0);
    let speckle = step(0.83, valueNoise2(q * 40.0 + seed));
    // the stamp lands: slightly over-inked at first, then settles
    k.cover = inside * (1.0 - carved) * (1.0 - speckle * 0.6) * clamp(stamped * 1.2, 0.0, 1.0);
    k.tone = 1.0;
    return k;
}

// --- compositions --------------------------------------------------------------------------------------------

// the title: a great ensō behind the logo, a sweeping red stroke under it, splatter, the seal
fn callTitle(uv: vec2f, aspect: f32, t: f32, seed: f32) -> Ink {
    let p = vec2f(uv.x * aspect, uv.y);
    // a great ensō round the logo, in a deep red that holds on the dark title ground
    var k = brushEnso(p, vec2f(0.3 * aspect, 0.86), 0.2, 0.026, 2.4, 5.75, smoothstep(0.0, 0.55, t), seed);
    k.tone = 0.65;
    // a sweeping red stroke under the logo and its splatter
    var red = callStroke(p, vec2f(0.04 * aspect, 0.765), vec2f(0.24 * aspect, 0.735), vec2f(0.5 * aspect, 0.775), 0.012, smoothstep(0.45, 0.8, t), seed + 1.0);
    red.tone = 1.0;
    k = inkOver(k, red);
    var spl = brushSplatter(p, vec2f(0.5 * aspect, 0.775), vec2f(0.1, 0.04), 1.2, 0.005, seed + 2.0, smoothstep(0.75, 0.9, t));
    spl.tone = 1.0;
    k = inkOver(k, spl);
    // the seal stamped at the end of the logo
    k = inkOver(k, brushSeal(p, vec2f(0.56 * aspect, 0.9), 0.05, seed, smoothstep(0.85, 0.95, t)));
    return k;
}

// a chapter card: a horizontal sweep under the title, a small ensō round the number, the seal
fn callChapter(uv: vec2f, aspect: f32, t: f32, seed: f32) -> Ink {
    let p = vec2f(uv.x * aspect, uv.y);
    let cx = 0.5 * aspect;
    var sweep = callStroke(p, vec2f(cx - 0.36, 0.43), vec2f(cx, 0.4 + (hash11(seed) - 0.5) * 0.04), vec2f(cx + 0.36, 0.445), 0.03, smoothstep(0.05, 0.45, t), seed);
    sweep.tone = 1.0;
    var k = brushEnso(p, vec2f(cx, 0.64), 0.065, 0.009, 1.0 + seed, 5.9, smoothstep(0.0, 0.3, t), seed + 4.0);
    // on the card's dark ground everything is in the accent ink
    k.tone = 1.0;
    k = inkOver(k, sweep);
    var spl = brushSplatter(p, vec2f(cx + 0.36, 0.445), vec2f(0.1, -0.02), 0.9, 0.006, seed + 5.0, smoothstep(0.4, 0.55, t));
    spl.tone = 1.0;
    k = inkOver(k, spl);
    k = inkOver(k, brushSeal(p, vec2f(cx + 0.3, 0.3), 0.045, seed + 6.0, smoothstep(0.55, 0.65, t)));
    return k;
}

// how the ink sits on the image: a dark wash where it bleeds, black or the accent where it is
fn callApply(col: vec3f, k: Ink, accent: vec3f, paper: vec3f, amount: f32) -> vec3f {
    var c = mix(col, col * mix(vec3f(1.0), paper * 0.6, 0.5), k.bleed * amount);
    let inkC = mix(vec3f(0.03, 0.025, 0.035), accent, k.tone);
    c = mix(c, inkC, k.cover * amount);
    return c;
}
