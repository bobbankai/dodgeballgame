// Ground marks: the scars a fight leaves on the floor, kept for the whole round.
//
// A square of the arena floor (src/render/Marks.ts, compute/marks.wgsl) is held in two rgba16f
// textures. Fight events stamp shapes into them; the environment shader reads them back and paints
// the floor (marksSurface below). Channels:
//
//   A.r  scorch      burnt black where fire and techniques struck
//   A.g  crack       a distance-like field of crack lines: 1 on a line falling to 0 a crack width
//                    away, so the floor shader can threshold it into crisp lines between texels
//   A.b  splatter    ink (the game's blood is ink): 1 inside a drop, falling off at its edge
//   A.a  scuff       dust scraped up and smeared: skids from dashes, debris round craters
//   B.r  frost       ice left by cold techniques, melting slowly
//   B.g  depth       how far the floor is pushed in: craters, footprints in snow
//   B.b  heat        glow in fresh cracks and scorch, cooling over seconds
//   B.a  palette     which technique palette the heat glows in ((id + 0.5) / 8)
//
// A stamp is three vec4s: (x, z, radius, angle), (kind, strength, seed, palette),
// (length, width, extra0, extra1).

const MARK_CRATER = 0;
const MARK_SCORCH = 1;
const MARK_SPLATTER = 2;
const MARK_SKID = 3;
const MARK_FOOTPRINT = 4;
const MARK_FROST = 5;
const MARK_SLASH = 6;
const MARK_SEAL = 7;
const MARK_CLEAR = 8;
const MARK_SCATTER = 9;

struct MarkStamp {
    pos: vec2f,
    radius: f32,
    angle: f32,
    kind: i32,
    strength: f32,
    seed: f32,
    palette: f32,
    len: f32,
    width: f32,
    extra0: f32,
    extra1: f32,
}

fn markStampFrom(s0: vec4f, s1: vec4f, s2: vec4f) -> MarkStamp {
    var s: MarkStamp;
    s.pos = s0.xy;
    s.radius = s0.z;
    s.angle = s0.w;
    s.kind = i32(s1.x + 0.5);
    s.strength = s1.y;
    s.seed = s1.z;
    s.palette = s1.w;
    s.len = s2.x;
    s.width = s2.y;
    s.extra0 = s2.z;
    s.extra1 = s2.w;
    return s;
}

// What one stamp adds at a point (combined into the field by max, except clear).
struct MarkField {
    a: vec4f,
    b: vec4f,
}

fn markFieldNone() -> MarkField {
    var f: MarkField;
    f.a = vec4f(0.0);
    f.b = vec4f(0.0);
    return f;
}

// how far from the stamp's centre it can reach (to skip texels quickly)
fn markReach(s: MarkStamp) -> f32 {
    switch s.kind {
        case 0: {
            return s.radius * 1.9;
        }
        case 2: {
            return s.radius * 3.5;
        }
        case 3, 6: {
            return s.len + s.width * 2.0 + 0.5;
        }
        case 8: {
            return select(s.radius, 1e9, s.radius < 0.0);
        }
        default: {
            return s.radius * 1.4;
        }
    }
}

// the stamp's own frame: x along its direction, y across
fn markLocal(p: vec2f, s: MarkStamp) -> vec2f {
    let q = p - s.pos;
    let c = cos(s.angle);
    let sn = sin(s.angle);
    return vec2f(q.x * c + q.y * sn, -q.x * sn + q.y * c);
}

// --- crack lines ------------------------------------------------------------------------------------------------

// one jagged crack from the centre outward at angle a0, to radius r1 (metres); returns the
// line field (1 on the line) at polar (r, a)
fn markCrackRay(r: f32, a: f32, a0: f32, r0: f32, r1: f32, width: f32, seed: f32) -> f32 {
    if (r < r0 || r > r1 * 1.05) {
        return 0.0;
    }
    // the crack wanders: its angle drifts with distance, in short straight-ish segments
    let t = r / max(r1, 1e-3);
    let seg = floor(r * 3.0 + seed * 7.0);
    let f = fract(r * 3.0 + seed * 7.0);
    let w0 = (hash11(seg + seed * 31.0) - 0.5) * 0.35;
    let w1 = (hash11(seg + 1.0 + seed * 31.0) - 0.5) * 0.35;
    let wander = mix(w0, w1, smoothstep(0.0, 1.0, f)) / max(r, 0.3);
    var da = a - (a0 + wander);
    da = da - TAU * floor(da / TAU + 0.5);
    let d = abs(da) * r;
    // the crack is widest near the impact and tapers to a hairline at its end
    let w = width * mix(1.0, 0.15, t) * (0.8 + 0.4 * hash11(seg * 1.7 + seed));
    return clamp(1.0 - d / max(w, 1e-3), 0.0, 1.0);
}

// a branch splitting off a crack partway along it
fn markCrackBranch(r: f32, a: f32, a0: f32, rStart: f32, len: f32, turn: f32, width: f32, seed: f32) -> f32 {
    if (r < rStart || r > rStart + len) {
        return 0.0;
    }
    let t = (r - rStart) / max(len, 1e-3);
    let ab = a0 + turn * t / max(r, 0.3) * rStart;
    var da = a - ab;
    da = da - TAU * floor(da / TAU + 0.5);
    let d = abs(da) * r;
    let w = width * mix(0.7, 0.1, t);
    return clamp(1.0 - d / max(w, 1e-3), 0.0, 1.0) * (1.0 - smoothstep(0.85, 1.0, t));
}

// the broken ring a heavy impact leaves (an arc fractured into pieces)
fn markCrackRing(r: f32, a: f32, ringR: f32, width: f32, seed: f32) -> f32 {
    let wob = (valueNoise2(vec2f(a * 3.0 + seed * 5.0, seed)) - 0.5) * ringR * 0.18;
    let d = abs(r - ringR - wob);
    let gaps = step(0.35, valueNoise2(vec2f(a * 2.2 + seed * 13.0, seed * 3.0)));
    return clamp(1.0 - d / max(width, 1e-3), 0.0, 1.0) * gaps;
}

// --- the stamps -------------------------------------------------------------------------------------------------

// a crater: a pushed-in bowl, a broken ring, jagged cracks running out with branches, a burnt
// rim, debris thrown round it, the cracks glowing with the technique's colour
fn markCrater(p: vec2f, s: MarkStamp) -> MarkField {
    var f = markFieldNone();
    let q = p - s.pos;
    let rm = length(q);
    let R = max(s.radius, 0.05);
    let r = rm / R;
    let a = atan2(q.y, q.x);
    let st = s.strength;
    // the bowl
    f.b.y = (1.0 - smoothstep(0.0, 0.8, r)) * (0.5 + 0.5 * (1.0 - r * r)) * st;
    // cracks: 6-11 main rays, each with a branch
    let n = 6 + i32(hash11(s.seed * 3.1) * 6.0);
    var crack = 0.0;
    let w = 0.07 + 0.04 * R * st;
    for (var i = 0; i < 11; i++) {
        if (i >= n) {
            break;
        }
        let fi = f32(i);
        let h = hash22(vec2f(fi, s.seed * 17.0));
        let a0 = (fi + h.x * 0.6) / f32(n) * TAU + s.seed * 6.0;
        let r1 = R * (0.9 + h.y * 0.9) * (0.7 + 0.3 * st);
        crack = max(crack, markCrackRay(rm, a, a0, R * 0.12, r1, w, s.seed + fi));
        let bs = r1 * (0.35 + 0.3 * h.x);
        crack = max(crack, markCrackBranch(rm, a, a0, bs, r1 * 0.45, (h.y - 0.5) * 1.6, w, s.seed + fi * 3.0));
    }
    crack = max(crack, markCrackRing(rm, a, R * 0.45, w * 0.8, s.seed) * step(0.5, st));
    f.a.y = crack;
    // the burnt rim and the scorched floor inside
    let nEdge = valueNoise2(vec2f(a * 2.0, s.seed * 9.0)) - 0.5;
    f.a.x = (1.0 - smoothstep(0.35, 1.1, r + nEdge * 0.35)) * 0.55 * st;
    // thrown debris and dust
    let ring = 1.0 - smoothstep(0.0, 0.35, abs(r - 1.15 - nEdge * 0.3));
    let clods = step(0.55, valueNoise2(q * 6.0 + s.seed * 11.0));
    f.a.w = ring * (0.4 + 0.6 * clods) * st;
    // heat: the centre and the cracks glow, then cool
    f.b.z = max((1.0 - smoothstep(0.0, 0.6, r)) * st, crack * st * (1.0 - smoothstep(0.5, 1.6, r)));
    f.b.w = (s.palette + 0.5) / 8.0;
    return f;
}

// a scorch: burnt black with a ragged edge, a brown halo of singed floor, embers in it
fn markScorch(p: vec2f, s: MarkStamp) -> MarkField {
    var f = markFieldNone();
    let q = p - s.pos;
    let R = max(s.radius, 0.05);
    let r = length(q) / R;
    let n = vfbm2(q / R * 2.5 + s.seed * 7.0, 3) - 0.5;
    let burn = 1.0 - smoothstep(0.45, 1.0, r + n * 0.6);
    let singe = 1.0 - smoothstep(0.8, 1.3, r + n * 0.5);
    f.a.x = max(burn * 0.95, singe * 0.35) * s.strength;
    let embers = step(0.6, valueNoise2(q * 7.0 + s.seed * 3.0));
    f.b.z = burn * s.strength * (0.35 + 0.65 * embers);
    f.b.w = (s.palette + 0.5) / 8.0;
    return f;
}

// ink thrown by a blow: a main blot, drops of falling size flung along the blow, thin streaks
fn markSplatter(p: vec2f, s: MarkStamp) -> MarkField {
    var f = markFieldNone();
    let l = markLocal(p, s);
    let R = max(s.radius, 0.03);
    // the main blot: a wobbly disc
    let ang = atan2(l.y, l.x);
    let wob = (valueNoise2(vec2f(ang * 2.5 + s.seed * 4.0, s.seed)) - 0.5) * 0.35 + (valueNoise2(vec2f(ang * 7.0, s.seed * 2.0)) - 0.5) * 0.15;
    var d = length(l) / R - (0.55 + wob);
    // drops flung along +x (the blow's direction), elongated along their flight
    for (var i = 0; i < 12; i++) {
        let fi = f32(i);
        let h = hash22(vec2f(fi * 1.3, s.seed * 7.7));
        let dist = R * (0.6 + h.x * h.x * 2.6);
        let side = (h.y - 0.5) * R * (0.4 + h.x * 1.4);
        let c = vec2f(dist, side);
        let rr = R * (0.22 - h.x * 0.17) * (0.6 + 0.6 * hash11(fi + s.seed));
        let e = l - c;
        // a teardrop: stretched back toward the blot
        let stretch = 1.0 + h.x * 1.5;
        let ed = length(vec2f(e.x / stretch, e.y)) / max(rr, 1e-3) - 1.0;
        d = min(d, ed);
    }
    // streaks: fine lines of ink from the blot outward
    let streakAng = atan2(l.y, max(l.x, 1e-3));
    let streak = step(0.7, valueNoise2(vec2f(streakAng * 25.0, s.seed * 5.0))) * step(R * 0.5, l.x) * (1.0 - smoothstep(R * 1.5, R * 3.0, l.x)) * step(0.0, l.x);
    let lineD = abs(fract(streakAng * 25.0 / TAU * 6.0) - 0.5);
    d = min(d, mix(1.0, lineD * 4.0 - 0.6, streak));
    f.a.z = clamp(0.5 - d * 2.0, 0.0, 1.0) * s.strength;
    return f;
}

// a skid: a dash or a slide scrapes the floor: dust smeared along the path, two gouges
fn markSkid(p: vec2f, s: MarkStamp) -> MarkField {
    var f = markFieldNone();
    let l = markLocal(p, s);
    let L = max(s.len, 0.05);
    let t = l.x / L;
    if (t < -0.05 || t > 1.05) {
        return f;
    }
    let W = s.width * mix(1.0, 0.45, clamp(t, 0.0, 1.0));
    let across = abs(l.y) / max(W, 1e-3);
    let streaks = valueNoise2(vec2f(l.x * 1.5, l.y * 30.0 + s.seed * 5.0));
    let body = (1.0 - smoothstep(0.55, 1.0, across)) * smoothstep(-0.05, 0.08, t) * (1.0 - smoothstep(0.85, 1.05, t));
    f.a.w = body * (0.6 + 0.4 * streaks) * s.strength;
    // gouges: where the feet dug in
    let g = max(1.0 - abs(abs(l.y) - W * 0.35) / 0.07, 0.0) * step(0.35, streaks);
    f.a.y = g * body * 0.8 * s.strength;
    f.b.y = body * 0.15 * s.strength;
    return f;
}

// a footprint: a shoe's sole pushed into soft ground (snow, sand, ash); extra0 = left (0) / right (1)
fn markFootprint(p: vec2f, s: MarkStamp) -> MarkField {
    var f = markFieldNone();
    var l = markLocal(p, s);
    let size = max(s.radius, 0.05);
    if (s.extra0 > 0.5) {
        l.y = -l.y;
    }
    let q = l / size;
    // sole: a ball (front) and a heel joined by a waist, slightly turned out
    let ball = length((q - vec2f(0.32, 0.03)) * vec2f(1.0, 1.25)) - 0.2;
    let heel = length((q - vec2f(-0.3, 0.0)) * vec2f(1.0, 1.35)) - 0.15;
    let waist = sdSegment2(q, vec2f(-0.3, 0.0), vec2f(0.32, 0.03)) - 0.11;
    let sole = min(min(ball, heel), waist);
    let inside = 1.0 - smoothstep(-0.02, 0.02, sole);
    // tread lines across the sole
    let tread = 0.75 + 0.25 * step(0.5, fract(q.x * 9.0));
    f.b.y = inside * tread * s.strength * 0.6;
    // the snow or sand thrown up round the print
    f.a.w = (1.0 - smoothstep(0.0, 0.08, abs(sole - 0.04))) * 0.35 * s.strength;
    return f;
}

// frost: ice spreading in feathered crystals from a point
fn markFrost(p: vec2f, s: MarkStamp) -> MarkField {
    var f = markFieldNone();
    let q = p - s.pos;
    let R = max(s.radius, 0.05);
    let r = length(q) / R;
    let a = atan2(q.y, q.x);
    // six-fold crystal arms with feathering
    let arms = abs(cos(a * 3.0 + s.seed * 6.0));
    let feather = abs(sin((r * 14.0 + a * 2.0) * 3.0)) * 0.3;
    let n = vfbm2(q / R * 3.0 + s.seed, 3);
    let cover = 1.0 - smoothstep(0.35, 1.0, r - arms * 0.25 - feather * 0.2 + (n - 0.5) * 0.4);
    f.b.x = cover * s.strength;
    // fine cracks in the ice
    let ic = 1.0 - smoothstep(0.0, 0.04, abs(fract(a * 6.0 / TAU + r * 0.5 + n * 0.3) - 0.5) * r * 0.5);
    f.a.y = ic * cover * 0.35 * s.strength;
    return f;
}

// a slash cut into the floor: a long thin gash along the blade's path, glowing, tapered at both ends
fn markSlash(p: vec2f, s: MarkStamp) -> MarkField {
    var f = markFieldNone();
    let l = markLocal(p, s);
    let L = max(s.len, 0.1);
    let t = l.x / L + 0.5;
    if (t < 0.0 || t > 1.0) {
        return f;
    }
    let taper = sin(t * PI);
    let curve = sin(t * PI) * s.extra0 * L * 0.12;
    let W = s.width * taper;
    let d = abs(l.y - curve);
    let jag = (valueNoise2(vec2f(l.x * 8.0, s.seed * 3.0)) - 0.5) * W * 0.6;
    let line = clamp(1.0 - (d + jag) / max(W, 1e-3), 0.0, 1.0);
    f.a.y = line * s.strength;
    f.b.y = line * 0.4 * s.strength;
    f.a.x = (1.0 - smoothstep(0.0, W * 4.0, d)) * 0.35 * taper * s.strength;
    f.b.z = line * s.strength;
    f.b.w = (s.palette + 0.5) / 8.0;
    return f;
}

// a seal burnt into the floor: a technique's circle (two rings, ticks, a star inside)
fn markSeal(p: vec2f, s: MarkStamp) -> MarkField {
    var f = markFieldNone();
    let l = markLocal(p, s);
    let R = max(s.radius, 0.1);
    let r = length(l) / R;
    let a = atan2(l.y, l.x);
    let w = 0.03 / R + 0.012;
    var line = max(1.0 - abs(r - 0.95) / w, 0.0);
    line = max(line, 1.0 - abs(r - 0.78) / (w * 0.7));
    // ticks between the rings
    let tick = step(abs(fract(a / TAU * 24.0) - 0.5), 0.08) * step(0.78, r) * step(r, 0.95);
    line = max(line, tick);
    // a five-pointed star joining points on the inner ring
    for (var i = 0; i < 5; i++) {
        let a0 = f32(i) / 5.0 * TAU;
        let a1 = f32(i + 2) / 5.0 * TAU;
        let p0 = vec2f(cos(a0), sin(a0)) * 0.78;
        let p1 = vec2f(cos(a1), sin(a1)) * 0.78;
        line = max(line, 1.0 - sdSegment2(l / R, p0, p1) / (w * 0.6));
    }
    line = clamp(line, 0.0, 1.0);
    f.a.x = line * 0.7 * s.strength;
    f.a.y = line * 0.5 * s.strength;
    f.b.z = line * s.strength;
    f.b.w = (s.palette + 0.5) / 8.0;
    return f;
}

// scattered debris: chips and dust thrown across the floor by a blast
fn markScatter(p: vec2f, s: MarkStamp) -> MarkField {
    var f = markFieldNone();
    let q = p - s.pos;
    let R = max(s.radius, 0.1);
    let r = length(q) / R;
    let cell = floor(q * 5.0 + s.seed * 13.0);
    let h = hash22(cell);
    let fr = fract(q * 5.0 + s.seed * 13.0) - 0.5 - (h - 0.5) * 0.5;
    let chip = (1.0 - smoothstep(0.06, 0.1, length(fr) * (1.0 + h.x))) * step(0.55, h.y);
    let fall = 1.0 - smoothstep(0.4, 1.0, r);
    f.a.w = max(chip, fall * 0.25 * valueNoise2(q * 3.0)) * fall * s.strength;
    return f;
}

fn markEval(p: vec2f, s: MarkStamp) -> MarkField {
    switch s.kind {
        case 0: {
            return markCrater(p, s);
        }
        case 1: {
            return markScorch(p, s);
        }
        case 2: {
            return markSplatter(p, s);
        }
        case 3: {
            return markSkid(p, s);
        }
        case 4: {
            return markFootprint(p, s);
        }
        case 5: {
            return markFrost(p, s);
        }
        case 6: {
            return markSlash(p, s);
        }
        case 7: {
            return markSeal(p, s);
        }
        case 9: {
            return markScatter(p, s);
        }
        default: {
            return markFieldNone();
        }
    }
}

// fold a stamp into what the floor already holds: marks only ever add (max), heat takes the
// palette of whichever stamp is hotter, and a clear stamp wipes its circle
fn markCombine(a0: vec4f, b0: vec4f, p: vec2f, s: MarkStamp) -> MarkField {
    var o: MarkField;
    o.a = a0;
    o.b = b0;
    if (s.kind == MARK_CLEAR) {
        var k = 0.0;
        if (s.radius > 0.0) {
            k = smoothstep(s.radius * 0.7, s.radius, length(p - s.pos));
        }
        o.a = a0 * k;
        o.b = vec4f(b0.xyz * k, b0.w);
        return o;
    }
    let f = markEval(p, s);
    o.a = max(a0, f.a);
    o.b = vec4f(max(b0.x, f.b.x), max(b0.y, f.b.y), max(b0.z, f.b.z), select(b0.w, f.b.w, f.b.z > b0.z && f.b.z > 0.02));
    return o;
}

// time passing: heat cools (embers die in a few seconds), frost melts, fresh dust settles a little
fn markAge(a0: vec4f, b0: vec4f, dt: f32) -> MarkField {
    var o: MarkField;
    o.a = vec4f(a0.x, a0.y, a0.z, a0.w * exp(-dt * 0.01));
    o.b = vec4f(b0.x * exp(-dt * 0.03), b0.y, b0.z * exp(-dt * 0.45), b0.w);
    return o;
}

// --- drawing the marks on the floor (env.fragment) --------------------------------------------------------------

struct MarkSurface {
    albedo: vec3f,
    n: vec3f,
    gloss: f32,
    emissive: vec3f,
    melt: f32,        // how much snow and ash the heat has melted or blown away here
}

// the floor's colour, normal and glow with the marks painted in. `depthGrad` is the gradient of
// the depth channel (metres of push per metre), `px` the world size of a screen pixel here.
fn marksSurface(albedo0: vec3f, n0: vec3f, p: vec3f, a: vec4f, b: vec4f, depthGrad: vec2f, palBody: vec3f, palCore: vec3f, palEdge: vec3f, snow: f32, time: f32, px: f32) -> MarkSurface {
    var m: MarkSurface;
    var albedo = albedo0;
    var n = n0;
    // craters and prints: bend the normal by the depth's slope
    n = normalize(n + vec3f(depthGrad.x, 0.0, depthGrad.y) * 0.6);
    // in snow a pushed-in print shows the blue shadowed snow underneath
    albedo = mix(albedo, albedo * vec3f(0.72, 0.8, 0.95), clamp(b.y * 1.5, 0.0, 1.0) * snow);
    // scuffs: pale dust smeared over the floor
    let dust = clamp(a.w, 0.0, 1.0);
    albedo = mix(albedo, mix(albedo, vec3f(0.66, 0.62, 0.56), 0.6), dust * 0.7);
    // scorch: charcoal black with a brown singed halo and a fine grain of ash
    let sc = clamp(a.x, 0.0, 1.0);
    let ash = valueNoise2(p.xz * 22.0);
    let singed = mix(albedo, albedo * vec3f(0.45, 0.32, 0.22), smoothstep(0.0, 0.4, sc));
    albedo = mix(singed, vec3f(0.05, 0.045, 0.04) * (0.7 + 0.6 * ash), smoothstep(0.35, 0.9, sc));
    // ink: dark crimson-black, crisp edged, glossy while wet
    let ink = smoothstep(0.42, 0.5 + px * 2.0, a.z);
    albedo = mix(albedo, vec3f(0.06, 0.005, 0.015), ink * 0.92);
    // frost: pale blue ice with a white rime at its edge
    let fr = clamp(b.x, 0.0, 1.0);
    let rime = smoothstep(0.1, 0.3, fr) * (1.0 - smoothstep(0.3, 0.6, fr));
    albedo = mix(albedo, vec3f(0.72, 0.85, 0.95), smoothstep(0.25, 0.7, fr) * 0.8);
    albedo = mix(albedo, vec3f(0.95, 0.98, 1.0), rime * 0.6);
    // cracks: crisp dark lines (the field is 1 on a line), the inside of a deep crack nearly black
    let lw = clamp(px * 6.0, 0.02, 0.25);
    let crack = smoothstep(0.45 - lw, 0.45 + lw, a.y);
    albedo = mix(albedo, albedo * 0.12, crack);
    m.albedo = albedo;
    m.n = n;
    m.gloss = max(ink * 0.8, smoothstep(0.3, 0.8, fr) * 0.7);
    // heat: cracks and scorch glow in the technique's colour, flickering as they cool
    let heat = clamp(b.z, 0.0, 1.5);
    let flick = 0.75 + 0.25 * valueNoise2(vec2f(p.x * 3.0 + time * 2.0, p.z * 3.0 - time * 1.7));
    let glowCracks = crack * heat * flick;
    let spark = valueNoise2(p.xz * 40.0 + vec2f(0.0, time * 0.5));
    let glowEmbers = smoothstep(0.6, 0.95, sc) * smoothstep(0.72, 0.85, spark) * heat * flick;
    let core = mix(palBody, palCore, smoothstep(0.6, 1.2, heat));
    // embers burn orange-red whatever the technique's colour; the cracks carry its colour
    let ember = mix(vec3f(0.9, 0.18, 0.03), vec3f(1.0, 0.55, 0.12), flick);
    m.emissive = core * glowCracks * 2.5 + ember * glowEmbers * 1.4 + mix(palEdge, ember, 0.5) * heat * smoothstep(0.2, 0.8, sc) * 0.08;
    m.melt = clamp(max(heat, sc * 0.8), 0.0, 1.0);
    return m;
}
