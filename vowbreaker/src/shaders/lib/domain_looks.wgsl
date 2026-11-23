// Domain looks (vbDomainLook): while a domain is open the whole frame takes on its nature, on top
// of the world the dome paints (domain.fragment). Applied to the graded frame, faded in with the
// domain's reveal, centred on the caster.
//
//   0 the Unrung Bell      every toll sends a ring of sound through the frame that bends the
//                          picture as it passes; bronze in the highlights; ash settling on the lens
//   1 Folded Prayers       the frame is paper: creases fold across it, its edges curl and darken,
//                          ink bleeds in from the borders; the red sun blooms
//   2 Mirror Lake          stillness: a faint second image of the frame mirrored about the horizon,
//                          ripples crossing it, the colour drained to moonlight blue with silver
//                          highlights, and now and then a moment where everything holds its breath
//   3 Night Parade         lantern bokeh drifting across the foreground, ghosts trailing the
//                          frame, a red-black vignette framed by torii silhouettes at the edges
//   4 the burning memory   heat shimmer rising, embers on the lens, the frame's edges charring

struct DomainLookIn {
    uv: vec2f,
    aspect: f32,
    time: f32,
    amount: f32,
    center: vec2f,     // the caster on screen
    px: vec2f,
}

// --- 0 the bell ---------------------------------------------------------------------------------------------

// rings of sound: one every toll period, each expanding from the caster and fading
fn bellRings(i: DomainLookIn, period: f32) -> vec2f {
    let d = vec2f((i.uv.x - i.center.x) * i.aspect, i.uv.y - i.center.y);
    let r = length(d);
    var bend = 0.0;
    var ring = 0.0;
    for (var k = 0; k < 3; k++) {
        let age = fract(i.time / period + f32(k) / 3.0);
        let rr = age * 1.6;
        let w = 0.02 + age * 0.05;
        let x = (r - rr) / w;
        let shape = exp(-x * x);
        let fade = 1.0 - age;
        // the wavefront pushes the picture outward then pulls it back (derivative of a bump)
        bend = bend + -x * shape * fade * 0.012;
        ring = max(ring, shape * fade);
    }
    return vec2f(bend, ring);
}

fn dlookBellUV(i: DomainLookIn) -> vec2f {
    let br = bellRings(i, 2.6);
    let d = vec2f((i.uv.x - i.center.x) * i.aspect, i.uv.y - i.center.y);
    let dir = normalize(d + vec2f(1e-4));
    return i.uv + vec2f(dir.x / i.aspect, dir.y) * br.x * i.amount;
}

fn dlookBell(c0: vec3f, i: DomainLookIn) -> vec3f {
    var c = c0;
    let br = bellRings(i, 2.6);
    // bronze in the highlights, a faint gold on the ring as it passes
    let l = luma(c);
    c = mix(c, c * vec3f(1.15, 0.95, 0.65), smoothstep(0.4, 0.9, l) * 0.6);
    c = c + vec3f(1.0, 0.75, 0.35) * br.y * 0.12;
    // ash on the lens: soft grey flecks that settle and slide
    let cell = floor(i.uv * vec2f(i.aspect, 1.0) * 14.0);
    let h = hash12(cell + floor(i.time * 0.2));
    let f = fract(i.uv * vec2f(i.aspect, 1.0) * 14.0) - 0.5 - (hash22(cell) - 0.5) * 0.6;
    let fleck = (1.0 - smoothstep(0.02, 0.05, length(f))) * step(0.9, h);
    c = mix(c, vec3f(0.55, 0.52, 0.5), fleck * 0.5);
    return c;
}

// --- 1 folded prayers -----------------------------------------------------------------------------------------

fn paperCreases(i: DomainLookIn) -> vec2f {
    // a few straight folds across the frame: a lit side and a shaded side along each
    let p = vec2f(i.uv.x * i.aspect, i.uv.y);
    var shade = 0.0;
    var line = 0.0;
    for (var k = 0; k < 4; k++) {
        let fk = f32(k);
        let a = hash11(fk * 3.7 + 1.0) * PI;
        let n = vec2f(cos(a), sin(a));
        let o = hash11(fk * 5.3 + 2.0) * (i.aspect * 0.7) + 0.15;
        let d = dot(p, n) - o * 0.8;
        line = max(line, 1.0 - smoothstep(0.0, 0.0025, abs(d)));
        shade = shade + select(-1.0, 1.0, d > 0.0) * (1.0 - smoothstep(0.0, 0.25, abs(d))) * 0.04;
    }
    return vec2f(shade, line);
}

fn dlookPrayers(c0: vec3f, i: DomainLookIn, pixel: vec2f) -> vec3f {
    var c = c0;
    // paper fibre over everything
    let fibre = valueNoise2(vec2f(pixel.x * 0.03, pixel.y * 0.5)) * valueNoise2(vec2f(pixel.x * 0.5, pixel.y * 0.03));
    c = c * (0.94 + fibre * 0.1);
    let cr = paperCreases(i);
    c = c * (1.0 + cr.x);
    c = mix(c, c * 0.75, cr.y * 0.6);
    // ink bleeding in from the borders, ragged
    let e = min(min(i.uv.x, 1.0 - i.uv.x) * i.aspect, min(i.uv.y, 1.0 - i.uv.y));
    let bleed = vfbm2(i.uv * vec2f(i.aspect, 1.0) * 6.0 + i.time * 0.02, 4);
    let ink = 1.0 - smoothstep(0.0, 0.08, e + (bleed - 0.5) * 0.08);
    c = mix(c, vec3f(0.04, 0.035, 0.04), ink * 0.85);
    // the red sun's bloom: reds glow
    let red = smoothstep(0.2, 0.5, c.r - max(c.g, c.b));
    c = c + vec3f(0.6, 0.05, 0.03) * red * 0.4;
    return c;
}

// --- 2 mirror lake ---------------------------------------------------------------------------------------------

// where the frame is mirrored: about a horizon line, with ripples running across the reflection
fn lakeMirrorUV(i: DomainLookIn, horizon: f32) -> vec2f {
    let mirrored = vec2f(i.uv.x, 2.0 * horizon - i.uv.y);
    let ripple = sin(i.uv.y * 120.0 - i.time * 2.0) * 0.002 + sin(i.uv.x * 40.0 + i.time) * 0.0015;
    return mirrored + vec2f(ripple, ripple * 0.5);
}

// a held breath: every few seconds the frame stops dead for a moment (the colour goes still)
fn lakeStillness(time: f32) -> f32 {
    let t = fract(time / 7.0);
    return smoothstep(0.0, 0.03, t) * (1.0 - smoothstep(0.1, 0.2, t));
}

fn dlookLake(c0: vec3f, mirror: vec3f, i: DomainLookIn) -> vec3f {
    var c = mix(c0, max(c0, mirror * 0.9), 0.22);
    // moonlight: drained to blue, silver in the highlights
    let l = luma(c);
    let moon = mix(vec3f(0.05, 0.08, 0.18), vec3f(0.75, 0.85, 1.0), smoothstep(0.0, 1.0, l));
    c = mix(c, moon, 0.45);
    c = c + vec3f(0.8, 0.9, 1.0) * smoothstep(0.75, 1.0, l) * 0.2;
    // the held breath: a cold flash and a stillness
    let still = lakeStillness(i.time);
    c = mix(c, vec3f(luma(c)) * vec3f(0.85, 0.95, 1.1), still * 0.6);
    return c;
}

// --- 3 night parade --------------------------------------------------------------------------------------------

// lantern bokeh: big soft discs of warm light drifting across the foreground
fn paradeBokeh(i: DomainLookIn) -> vec3f {
    var acc = vec3f(0.0);
    for (var k = 0; k < 10; k++) {
        let fk = f32(k);
        let h = hash22(vec2f(fk, 3.3));
        let speed = 0.02 + h.y * 0.03;
        let x = fract(h.x + i.time * speed) * (i.aspect + 0.4) - 0.2;
        let y = 0.15 + hash11(fk * 7.1) * 0.7 + sin(i.time * 0.5 + fk) * 0.02;
        let r = 0.04 + hash11(fk * 2.9) * 0.06;
        let d = length(vec2f(i.uv.x * i.aspect - x, i.uv.y - y));
        // a disc with a brighter rim (lens bokeh), hexagonal-ish
        let disc = 1.0 - smoothstep(r * 0.9, r, d);
        let rim = (1.0 - smoothstep(0.0, r * 0.12, abs(d - r * 0.9))) * 0.6;
        let col = mix(vec3f(1.0, 0.45, 0.12), vec3f(1.0, 0.2, 0.1), hash11(fk * 4.4));
        acc = acc + col * (disc * 0.12 + rim * 0.1);
    }
    return acc;
}

// torii silhouettes at the edges of the frame, as if seen past the avenue's gates
fn paradeTorii(i: DomainLookIn) -> f32 {
    let p = vec2f(i.uv.x * i.aspect, i.uv.y);
    var t = 0.0;
    for (var side = 0; side < 2; side++) {
        let x0 = select(i.aspect + 0.02, -0.02, side == 0);
        let pillar = 1.0 - smoothstep(0.0, 0.004, abs(p.x - x0) - 0.06);
        let beam = (1.0 - smoothstep(0.0, 0.004, abs(p.y - 0.93) - 0.025)) * (1.0 - smoothstep(0.0, 0.004, abs(p.x - x0) - 0.22));
        let beam2 = (1.0 - smoothstep(0.0, 0.004, abs(p.y - 0.84) - 0.012)) * (1.0 - smoothstep(0.0, 0.004, abs(p.x - x0) - 0.17));
        t = max(t, max(pillar, max(beam, beam2)));
    }
    return t;
}

fn dlookParade(c0: vec3f, ghost: vec3f, i: DomainLookIn) -> vec3f {
    var c = mix(c0, max(c0, ghost), 0.35);
    c = c + paradeBokeh(i);
    // red-black vignette
    let v = length(vec2f((i.uv.x - 0.5) * i.aspect, i.uv.y - 0.5));
    c = mix(c, c * vec3f(0.35, 0.05, 0.05), smoothstep(0.45, 1.0, v) * 0.8);
    // the gates frame it
    c = mix(c, vec3f(0.08, 0.0, 0.01), paradeTorii(i) * 0.9);
    return c;
}

// --- 4 burning memory -------------------------------------------------------------------------------------------

fn memoryShimmerUV(i: DomainLookIn) -> vec2f {
    let n = valueNoise2(vec2f(i.uv.x * 30.0, i.uv.y * 12.0 - i.time * 3.0)) - 0.5;
    return i.uv + vec2f(n * 0.004, abs(n) * 0.003) * (0.5 + (1.0 - i.uv.y));
}

fn dlookBurning(c0: vec3f, i: DomainLookIn) -> vec3f {
    var c = c0 * vec3f(1.1, 0.92, 0.8);
    // embers stuck on the lens, glowing and dimming
    let cell = floor(i.uv * vec2f(i.aspect, 1.0) * 22.0);
    let h = hash12(cell);
    let f = fract(i.uv * vec2f(i.aspect, 1.0) * 22.0) - 0.5 - (hash22(cell + 1.0) - 0.5) * 0.6;
    let glow = 0.5 + 0.5 * sin(i.time * (2.0 + h * 4.0) + h * 20.0);
    let ember = (1.0 - smoothstep(0.0, 0.06, length(f))) * step(0.93, h) * glow;
    c = c + vec3f(1.0, 0.4, 0.08) * ember * 1.5;
    // charring at the frame's edges
    let e = min(min(i.uv.x, 1.0 - i.uv.x) * i.aspect, min(i.uv.y, 1.0 - i.uv.y));
    let n = vfbm2(i.uv * vec2f(i.aspect, 1.0) * 5.0 - vec2f(0.0, i.time * 0.05), 4);
    let char = 1.0 - smoothstep(0.0, 0.07, e + (n - 0.5) * 0.06);
    c = mix(c, vec3f(0.06, 0.03, 0.02), smoothstep(0.4, 1.0, char));
    c = c + vec3f(1.0, 0.45, 0.1) * (1.0 - smoothstep(0.0, 0.12, abs(char - 0.4))) * 0.7;
    return c;
}
