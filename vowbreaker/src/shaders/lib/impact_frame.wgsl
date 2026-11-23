// Impact frames (vbImpact): the one or two drawn frames an anime cuts to on a blow that matters.
// The finished frame is redrawn from the G-buffer: fighters become flat silhouettes with thick,
// boiling ink edges, the world behind them is replaced by a flat field with focus lines and shock
// rings bursting from the hit, and each style paints it its own way:
//
//   1 ink         white paper, black silhouettes rimmed in white, black focus lines
//   2 negative    black, white silhouettes hatched in black, white focus lines
//   3 black spark black and crimson: a red burst, red-rimmed black silhouettes, lightning cracking
//                 across the frame, the colour channels torn apart
//   4 sketch      the real frame redrawn in rough pencil on paper, shadows hatched, a red accent
//   5 shatter     the frame breaks into shards that drift apart with white cracks between them
//   6 burst       posterised bands of the attacker's colour radiating, silhouettes in its dark
//   7 smear       the frame streaked along the blow's direction, speed lines over it
//   8 panel       a manga panel: screentone, a jagged sound-effect balloon at the hit
//
// The frame boils on twos (its lines and shapes jump every other frame) like hand drawing.

const IMPACT_INK = 1;
const IMPACT_NEGATIVE = 2;
const IMPACT_SPARK = 3;
const IMPACT_SKETCH = 4;
const IMPACT_SHATTER = 5;
const IMPACT_BURST = 6;
const IMPACT_SMEAR = 7;
const IMPACT_PANEL = 8;
const IMPACT_INKSPLASH = 9;
const IMPACT_TIMESTOP = 10;
const IMPACT_KANJI = 11;
const IMPACT_TEAR = 12;

struct ImpactGeo {
    isChar: f32,      // 1 on a fighter
    edge: f32,        // ink edge strength (silhouette and inner lines)
    depth: f32,       // view depth (m)
    n: vec3f,         // view normal
}

// is this G-buffer id a fighter's (character id blocks start at 1000)
fn impactIsChar(id: f32) -> f32 {
    return step(999.5, id) * step(id, 1999.5);
}

// the G-buffer read for the impact frame: who is a fighter, where the lines are. `r` is the line
// radius in pixels; `boil` jitters the samples so the line wobbles like a hand-drawn one
fn impactGeometry(gb: texture_2d<f32>, gbs: sampler, uv: vec2f, px: vec2f, r: f32, boil: f32) -> ImpactGeo {
    var g: ImpactGeo;
    let c = textureSampleLevel(gb, gbs, uv, 0.0);
    g.depth = c.b;
    g.n = octDecode(c.rg);
    g.isChar = impactIsChar(c.a);
    var edge = 0.0;
    for (var i = 0; i < 8; i++) {
        let a = f32(i) / 8.0 * TAU + boil * 0.7;
        let wob = 0.75 + 0.5 * hash12(uv * 517.0 + vec2f(f32(i), boil));
        let o = vec2f(cos(a), sin(a)) * r * wob * px;
        let s = textureSampleLevel(gb, gbs, uv + o, 0.0);
        // silhouettes (a fighter against anything else), depth breaks, creases
        let sil = abs(impactIsChar(s.a) - g.isChar);
        let dd = abs(s.b - c.b) / max(min(s.b, c.b), 0.1);
        let crease = 1.0 - dot(octDecode(s.rg), g.n);
        edge = max(edge, max(sil, max(smoothstep(0.06, 0.12, dd), smoothstep(0.35, 0.6, crease) * g.isChar)));
    }
    g.edge = edge;
    return g;
}

// the frame shakes and punches in toward the hit while it holds
fn impactWarp(uv: vec2f, center: vec2f, t: f32, amount: f32, seed: f32) -> vec2f {
    let zoom = 1.0 - 0.06 * amount * (1.0 - t);
    let step2 = floor(t * 6.0);
    let shake = (hash22(vec2f(step2, seed)) - 0.5) * 0.012 * amount * (1.0 - t);
    return center + (uv - center) * zoom + shake;
}

// focus lines from the hit (thick wedges, varied, flickering on twos)
fn impactFocus(uv: vec2f, center: vec2f, aspect: f32, innerR: f32, density: f32, seed: f32) -> f32 {
    let d = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let r = length(d);
    let a = atan2(d.y, d.x) / TAU + 0.5;
    let k = a * density;
    let idx = floor(k);
    let h = hash11(idx + seed * 31.0);
    let h2 = hash11(idx * 1.7 + seed * 7.0);
    // a wedge: wide at the edge of the frame, a point near the hit
    let w = (0.15 + h * 0.4) * smoothstep(innerR * 0.6, 1.2, r);
    let stripe = 1.0 - smoothstep(w * 0.8, w, abs(fract(k) - 0.5) * 2.0);
    let start = innerR * (0.6 + h2 * 0.9);
    return stripe * smoothstep(start, start + 0.08, r) * step(0.3, h);
}

// rings of air pushed out by the blow
fn impactRings(uv: vec2f, center: vec2f, aspect: f32, t: f32, seed: f32) -> f32 {
    let d = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let r = length(d);
    var ring = 0.0;
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let rr = (0.08 + fi * 0.12) + t * (0.25 + fi * 0.1);
        let w = 0.006 + 0.01 * (1.0 - t);
        let wob = (valueNoise2(vec2f(atan2(d.y, d.x) * 3.0, seed + fi)) - 0.5) * 0.02;
        ring = max(ring, 1.0 - smoothstep(w * 0.5, w, abs(r - rr - wob)));
    }
    return ring;
}

// the spark at the point of contact: an eight-point star, long rays on the axes
fn impactStar(uv: vec2f, center: vec2f, aspect: f32, size: f32, t: f32, seed: f32) -> f32 {
    let d = rotate2(vec2f((uv.x - center.x) * aspect, uv.y - center.y), seed * 3.0);
    let s = size * (1.0 + 0.6 * (1.0 - t));
    let main = sdStar(d, s, 4.0, 4.5);
    let second = sdStar(rotate2(d, PI * 0.25), s * 0.55, 4.0, 3.0);
    return 1.0 - smoothstep(-0.002, 0.002, min(main, second));
}

// lightning cracking across the frame from the hit: jagged polylines with forks
fn impactBolts(uv: vec2f, center: vec2f, aspect: f32, seed: f32, width: f32) -> f32 {
    let p = vec2f(uv.x * aspect, uv.y);
    let c = vec2f(center.x * aspect, center.y);
    var best = 1e9;
    for (var b = 0; b < 5; b++) {
        let fb = f32(b);
        let ang = hash11(fb * 3.1 + seed) * TAU;
        var a = c;
        var dir = vec2f(cos(ang), sin(ang));
        for (var s = 0; s < 7; s++) {
            let fs = f32(s);
            let turn = (hash11(fb * 13.0 + fs * 1.7 + seed * 5.0) - 0.5) * 1.3;
            dir = rotate2(dir, turn);
            let len = 0.06 + hash11(fb + fs * 3.3 + seed) * 0.08;
            let nb = a + dir * len;
            best = min(best, sdSegment2(p, a, nb) / (1.0 - fs * 0.11));
            // a fork off every other segment
            if (s % 2 == 1) {
                let fd = rotate2(dir, select(-0.8, 0.8, hash11(fs + fb * 7.0 + seed) > 0.5));
                best = min(best, sdSegment2(p, nb, nb + fd * len * 0.6) * 1.6);
            }
            a = nb;
        }
    }
    return 1.0 - smoothstep(width * 0.5, width, best);
}

// the frame as shards: which shard this pixel belongs to, how far it has drifted, the crack line
struct ImpactShard {
    uv: vec2f,
    crack: f32,
    shade: f32,
}

fn impactShatter(uv: vec2f, center: vec2f, aspect: f32, t: f32, seed: f32) -> ImpactShard {
    var s: ImpactShard;
    let p = vec2f(uv.x * aspect, uv.y);
    // shards are small near the hit and large far from it
    let dc = length(p - vec2f(center.x * aspect, center.y));
    let scale = mix(14.0, 5.0, smoothstep(0.0, 0.7, dc));
    let w = worley2(p * scale + seed * 9.0, 1.0);
    let id = w.id;
    // each shard drifts away from the hit and turns a little
    let away = normalize(p - vec2f(center.x * aspect, center.y) + vec2f(1e-4));
    let drift = away * t * (0.02 + id.x * 0.05) + (id - 0.5) * 0.01 * t;
    let local = p - drift;
    let rot = (id.y - 0.5) * 0.12 * t;
    let pc = vec2f(center.x * aspect, center.y);
    let q = pc + rotate2(local - pc, rot);
    s.uv = vec2f(q.x / aspect, q.y);
    s.crack = 1.0 - smoothstep(0.0, 0.035 + 0.02 * t, w.edge);
    s.shade = 0.85 + 0.3 * id.x;
    return s;
}

// a smear: the frame dragged back along the blow, strongest near the hit
fn impactSmear(src: texture_2d<f32>, ss: sampler, uv: vec2f, dir: vec2f, center: vec2f, amount: f32) -> vec3f {
    var acc = vec3f(0.0);
    var wsum = 0.0;
    let fall = 1.0 - smoothstep(0.0, 0.8, length(uv - center));
    for (var i = 0; i < 12; i++) {
        let f = f32(i) / 11.0;
        let o = -dir * f * 0.12 * amount * (0.3 + fall);
        let w = 1.0 - f * 0.7;
        acc = acc + textureSampleLevel(src, ss, uv + o, 0.0).rgb * w;
        wsum = wsum + w;
    }
    return acc / wsum;
}

// rough pencil: graphite strokes along a direction, darker where the tone is
fn impactPencil(pixel: vec2f, tone: f32, angle: f32, seed: f32) -> f32 {
    let q = rotate2(pixel, angle);
    let stroke = valueNoise2(vec2f(q.x * 0.03, q.y * 0.6) + seed);
    let line = smoothstep(0.55 - tone * 0.5, 0.75 - tone * 0.5, stroke);
    return line * smoothstep(0.1, 0.3, tone);
}

// a jagged sound-effect balloon (manga): spiky outline, white inside, black rim
fn impactBalloon(uv: vec2f, center: vec2f, aspect: f32, size: f32, seed: f32) -> vec2f {
    let d = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let sd = sdStarburst(d, size, 14.0, 0.9, seed);
    let fill = 1.0 - smoothstep(-0.002, 0.002, sd);
    let rim = 1.0 - smoothstep(0.0, 0.006, abs(sd));
    return vec2f(fill, rim);
}

// the drawn frame for one style, given the scene colour at the (warped) pixel and the geometry
fn impactStyle(style: i32, col: vec3f, geo: ImpactGeo, uv: vec2f, pixel: vec2f, center: vec2f, aspect: f32, t: f32, seed: f32,
               accent: vec3f, accentDark: vec3f) -> vec3f {
    let l = luma(col);
    let focus = impactFocus(uv, center, aspect, 0.12, 70.0, seed);
    let rings = impactRings(uv, center, aspect, t, seed);
    let star = impactStar(uv, center, aspect, 0.05, t, seed);
    let ink = smoothstep(0.35, 0.7, geo.edge);
    // light from the hit: the side of a fighter facing the impact is lit, the far side dark
    let toHit = normalize(vec3f((center - uv) * vec2f(aspect, 1.0), 0.35));
    let litSide = step(0.15, dot(geo.n, toHit));
    switch style {
        case 1: {
            // ink: paper ground, black figures with a white cut where the light hits them
            var c = vec3f(0.97, 0.95, 0.9);
            c = mix(c, vec3f(0.02), max(focus * 0.9, rings));
            c = mix(c, vec3f(0.03), geo.isChar);
            c = mix(c, vec3f(0.97, 0.95, 0.9), geo.isChar * litSide * step(0.65, l));
            c = mix(c, vec3f(0.02), ink * (1.0 - geo.isChar * litSide));
            c = mix(c, vec3f(1.0), star);
            return c;
        }
        case 2: {
            // negative: black ground, white figures hatched where they turn from the hit
            var c = vec3f(0.02);
            c = mix(c, vec3f(0.96), max(focus * 0.8, rings));
            let hatch = step(0.5, fract((pixel.x + pixel.y) * 0.18)) * (1.0 - litSide);
            c = mix(c, vec3f(0.95) * (1.0 - hatch * 0.85), geo.isChar);
            c = mix(c, vec3f(0.0), ink * geo.isChar);
            c = mix(c, vec3f(1.0), ink * (1.0 - geo.isChar));
            c = mix(c, vec3f(1.0), star);
            return c;
        }
        case 3: {
            // Black Spark: black, a crimson burst, red-rimmed black figures, lightning
            let d = length(vec2f((uv.x - center.x) * aspect, uv.y - center.y));
            var c = mix(vec3f(0.55, 0.0, 0.04), vec3f(0.02, 0.0, 0.01), smoothstep(0.0, 0.6, d));
            c = mix(c, vec3f(0.0), focus * 0.85);
            c = mix(c, vec3f(1.0, 0.15, 0.15), rings * 0.8);
            c = mix(c, vec3f(0.01, 0.0, 0.0), geo.isChar);
            c = mix(c, vec3f(0.95, 0.05, 0.1), ink);
            c = mix(c, vec3f(0.85, 0.02, 0.06), geo.isChar * litSide * step(0.6, l) * 0.6);
            let bolt = impactBolts(uv, center, aspect, seed, 0.006);
            let boltCore = impactBolts(uv, center, aspect, seed, 0.0022);
            c = mix(c, vec3f(1.0, 0.1, 0.15), bolt);
            c = mix(c, vec3f(0.0), boltCore);
            c = mix(c, vec3f(1.0, 0.85, 0.85), star);
            return c;
        }
        case 4: {
            // sketch: the real frame in pencil on paper, a red accent at the hit
            let paper = vec3f(0.96, 0.94, 0.88) * (0.97 + 0.03 * valueNoise2(pixel * 0.5));
            let tone = 1.0 - l;
            let h1 = impactPencil(pixel, tone, 0.6 + seed, seed);
            let h2 = impactPencil(pixel, tone - 0.35, -0.7 + seed, seed + 3.0);
            var c = paper * (1.0 - h1 * 0.45) * (1.0 - h2 * 0.35);
            c = mix(c, vec3f(0.12, 0.11, 0.13), ink * 0.9);
            c = mix(c, c * vec3f(1.0, 0.4, 0.35), max(star, rings * 0.6));
            return c;
        }
        case 6: {
            // burst: bands of the attacker's colour radiating, dark figures
            let d = length(vec2f((uv.x - center.x) * aspect, uv.y - center.y));
            let band = floor(fract(d * 5.0 - t * 2.0) * 3.0) / 2.0;
            var c = mix(accent, accent * 0.45 + vec3f(0.05), band);
            c = mix(c, vec3f(1.0), focus * 0.5);
            c = mix(c, accentDark, geo.isChar);
            c = mix(c, accent * 1.2 + vec3f(0.2), geo.isChar * litSide * step(0.55, l) * 0.7);
            c = mix(c, vec3f(0.02), ink);
            c = mix(c, vec3f(1.0), star);
            return c;
        }
        case 9: {
            return impactInkSplash(col, geo, uv, pixel, center, aspect, t, seed, accent);
        }
        case 10: {
            return impactTimeStop(col, geo, uv, pixel, center, aspect, t, seed);
        }
        case 11: {
            return impactKanji(col, geo, uv, pixel, center, aspect, t, seed, accent);
        }
        case 8: {
            // panel: screentone shading, black lines, a sound balloon at the hit
            let tone = clamp(1.0 - l * 1.2, 0.0, 1.0);
            let dots = halftoneDots(pixel, 5.0, 0.785, tone);
            var c = vec3f(0.97) * (1.0 - dots * 0.85);
            c = mix(c, vec3f(0.03), ink);
            c = mix(c, vec3f(0.03), focus * 0.6 * (1.0 - geo.isChar));
            let b = impactBalloon(uv, center + vec2f(0.06, 0.08), aspect, 0.09, seed);
            c = mix(c, vec3f(0.98), b.x);
            c = mix(c, vec3f(0.03), b.y);
            return c;
        }
        default: {
            return col;
        }
    }
}

// --- more styles: ink splash, time stop ---------------------------------------------------------------------
//
//   9 ink splash  a burst of black ink thrown across the frame from the hit, the fighters white
//                 shapes cut out of it, droplets flung outward, the paper showing at the edges
//  10 time stop   the world freezes: the frame drained to a cold cyan monochrome, a clock face's
//                 ticks and hands drawn round the hit, the fighters held in the light, everything
//                 else under a fine grid of stopped rain

// the splash: a jagged radial blot with fingers reaching outward and droplets beyond them
fn impactInkBlot(uv: vec2f, center: vec2f, aspect: f32, t: f32, seed: f32) -> f32 {
    let d = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let r = length(d);
    let a = atan2(d.y, d.x);
    // the body of the splash grows quickly, its fingers reach further
    let reach = 0.25 + 0.6 * easeOutCubic(min(t * 2.5, 1.0));
    let fingers = pow(valueNoise2(vec2f(a * 4.0 + seed * 9.0, seed)), 2.0) * 0.6 + valueNoise2(vec2f(a * 13.0, seed * 3.0)) * 0.25;
    let edge = reach * (0.45 + fingers);
    var blot = 1.0 - smoothstep(edge - 0.004, edge + 0.004, r);
    // droplets flung past the fingers
    let cell = floor(vec2f(a * 9.0, r * 14.0) + seed * 5.0);
    let h = hash22(cell);
    let fr = fract(vec2f(a * 9.0, r * 14.0) + seed * 5.0) - 0.5 - (h - 0.5) * 0.5;
    let drop = (1.0 - smoothstep(0.08, 0.12, length(fr * vec2f(1.0, 0.6)))) * step(0.6, h.x) * step(edge, r) * step(r, edge * 1.6);
    blot = max(blot, drop);
    return blot;
}

fn impactInkSplash(col: vec3f, geo: ImpactGeo, uv: vec2f, pixel: vec2f, center: vec2f, aspect: f32, t: f32, seed: f32, accent: vec3f) -> vec3f {
    let paper = vec3f(0.96, 0.94, 0.88) * (0.96 + 0.06 * valueNoise2(pixel * 0.4));
    let blot = impactInkBlot(uv, center, aspect, t, seed);
    let ink = vec3f(0.02, 0.018, 0.025);
    var c = mix(paper, ink, blot);
    // fighters cut out of the ink in white, inked outlines
    c = mix(c, paper, geo.isChar * blot);
    c = mix(c, ink, geo.isChar * (1.0 - blot) * 0.9);
    c = mix(c, mix(ink, paper, blot), smoothstep(0.35, 0.7, geo.edge));
    // a splash of the attacker's colour at the heart of it
    let heart = 1.0 - smoothstep(0.0, 0.08, length(vec2f((uv.x - center.x) * aspect, uv.y - center.y)));
    c = mix(c, accent, heart * 0.8 * (1.0 - geo.isChar));
    return c;
}

// the clock: a ring of ticks round the hit, two hands, the second hand caught mid-step
fn impactClock(uv: vec2f, center: vec2f, aspect: f32, seed: f32) -> f32 {
    let d = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let r = length(d);
    let a = atan2(d.y, d.x);
    let R = 0.28;
    let ring = 1.0 - smoothstep(0.0, 0.003, abs(r - R));
    let tickA = abs(fract(a / TAU * 12.0) - 0.5);
    let ticks = (1.0 - smoothstep(0.0, 0.012, tickA * R * TAU / 12.0)) * step(R - 0.03, r) * step(r, R);
    let hourA = seed * TAU;
    let minA = seed * TAU * 7.0;
    let hour = 1.0 - smoothstep(0.0, 0.004, sdSegment2(d, vec2f(0.0), vec2f(cos(hourA), sin(hourA)) * R * 0.5));
    let minute = 1.0 - smoothstep(0.0, 0.003, sdSegment2(d, vec2f(0.0), vec2f(cos(minA), sin(minA)) * R * 0.85));
    return max(max(ring, ticks), max(hour, minute));
}

fn impactTimeStop(col: vec3f, geo: ImpactGeo, uv: vec2f, pixel: vec2f, center: vec2f, aspect: f32, t: f32, seed: f32) -> vec3f {
    let l = luma(col);
    // a cold monochrome, the fighters held in a pale light
    var c = mix(vec3f(0.02, 0.08, 0.12), vec3f(0.75, 0.95, 1.0), smoothstep(0.05, 0.9, l));
    c = mix(c, mix(vec3f(0.1, 0.2, 0.25), vec3f(1.0), smoothstep(0.1, 0.8, l)), geo.isChar);
    // stopped rain: a fine grid of short vertical streaks hanging in the air
    let cell = floor(pixel / vec2f(9.0, 26.0));
    let h = hash12(cell + seed);
    let f = fract(pixel / vec2f(9.0, 26.0));
    let streak = step(0.7, h) * (1.0 - smoothstep(0.0, 0.08, abs(f.x - 0.5))) * step(0.2, f.y) * step(f.y, 0.6);
    c = mix(c, vec3f(0.85, 0.97, 1.0), streak * 0.5 * (1.0 - geo.isChar));
    // the clock round the hit
    c = mix(c, vec3f(0.9, 1.0, 1.0), impactClock(uv, center, aspect, seed) * 0.8);
    // ink lines stay
    c = mix(c, vec3f(0.02, 0.05, 0.07), smoothstep(0.4, 0.75, geo.edge));
    return c;
}

// --- kanji stamp, paper tear ----------------------------------------------------------------------------------
//
//  11 kanji stamp  a huge brushed character slams onto the frame in red ink over the hit, the world
//                  behind it pale and still, the stamp's edge spattered
//  12 paper tear   the frame tears in two along the blow's direction: two halves pulled apart, the
//                  torn edges ragged and fibrous, white paper showing between them

fn impactKanji(col: vec3f, geo: ImpactGeo, uv: vec2f, pixel: vec2f, center: vec2f, aspect: f32, t: f32, seed: f32, accent: vec3f) -> vec3f {
    // the world drained pale behind the stamp
    var c = mix(col, vec3f(0.95, 0.93, 0.88) * (0.7 + 0.3 * luma(col)), 0.75);
    c = mix(c, vec3f(0.1), smoothstep(0.4, 0.75, geo.edge));
    // the character: a glyph from the brush library, slammed in large (it shrinks onto the page)
    let land = 1.0 + 0.6 * (1.0 - easeOutCubic(min(t * 4.0, 1.0)));
    let q = vec2f((uv.x - center.x) * aspect, uv.y - center.y) / (0.32 * land);
    let g = sdGlyph(q, floor(seed * 40.0));
    let ink = 1.0 - smoothstep(-0.01, 0.025, g);
    // spatter at the stamp's edge
    let sp = step(0.82, valueNoise2(q * 9.0 + seed * 3.0)) * (1.0 - smoothstep(0.0, 0.25, g)) * step(0.0, g);
    let red = mix(vec3f(0.75, 0.05, 0.06), accent * 0.6 + vec3f(0.4, 0.0, 0.0), 0.3);
    c = mix(c, red, max(ink, sp) * 0.95);
    return c;
}

fn impactPaperTear(src: texture_2d<f32>, ss: sampler, uv: vec2f, pixel: vec2f, dir: vec2f, center: vec2f, aspect: f32, t: f32, seed: f32) -> vec3f {
    // the tear runs through the hit along the blow; each half is pulled away across it
    let n = vec2f(-dir.y, dir.x);
    let p = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let along = dot(p, dir);
    let across = dot(p, n);
    let rag = (valueNoise2(vec2f(along * 18.0, seed)) - 0.5) * 0.05 + (valueNoise2(vec2f(along * 70.0, seed * 3.0)) - 0.5) * 0.012;
    let side = select(-1.0, 1.0, across > rag);
    let gap = easeOutCubic(min(t * 2.5, 1.0)) * 0.05;
    let shifted = across - side * gap;
    // pixels inside the gap show the paper behind; the fibres fray from the torn edges
    let inGap = step(abs(across - rag), gap);
    let fibre = step(0.7, valueNoise2(vec2f(along * 200.0, abs(across - rag) * 300.0))) * (1.0 - smoothstep(0.0, gap * 1.6 + 0.004, abs(across - rag) - gap * 0.5));
    let o = n * side * gap;
    let suv = uv - vec2f(o.x / aspect, o.y);
    var c = textureSampleLevel(src, ss, suv, 0.0).rgb;
    // each half tilts a little, shading it
    c = c * (1.0 - 0.15 * step(0.0, side) * t);
    let paper = vec3f(0.96, 0.94, 0.88) * (0.95 + 0.05 * valueNoise2(pixel * 0.5));
    c = mix(c, paper, max(inGap, fibre * 0.8));
    return c;
}
