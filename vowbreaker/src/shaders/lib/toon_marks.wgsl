// Marks on a fighter (toon.fragment), in object space so they stay put on the body as it moves.
//
//   sigils    the Vow's curse: rings of brushed glyphs and thorny lines crawl up from the hands and
//             across the chest as the vow burns (energy.z), glowing red at their leading edge,
//             pulsing like a heartbeat
//   scuffs    a long fight shows: short scratch lines on skin and cloth, grime in the folds, rips in
//             the cloth with a dark inside, growing with damage (surface.z)
//   trickle   at high damage a thin line of dark ink from the corner of the mouth or a cut brow
//             (stylised; the game draws hurt as ink, not blood)

// the Vow's sigils: returns (ink coverage, glow at the leading edge)
fn marksSigils(objPos: vec3f, figureH: f32, amount: f32, time: f32) -> vec2f {
    if (amount <= 0.0) {
        return vec2f(0.0);
    }
    let p = objPos / max(figureH, 0.1);
    // the curse starts at the hands (|x| large, y mid) and spreads toward the heart
    let fromHands = min(length(vec2f(abs(p.x) - 0.42, p.y - 0.5)), 1.0);
    let toHeart = length(vec2f(p.x, p.y - 0.72));
    let spread = min(fromHands * 1.1, toHeart * 2.2 + 0.2);
    let front = amount * 1.2;
    let inside = 1.0 - smoothstep(front - 0.05, front, spread);
    // rings of glyph-like marks round the limbs, thorny lines between them
    let ang = atan2(p.z, p.x);
    let ringCoord = vec2f(ang * 3.0, p.y * 18.0);
    let ring = abs(fract(ringCoord.y) - 0.5);
    let ringLine = 1.0 - smoothstep(0.02, 0.05, abs(ring - 0.35));
    let gl = sdGlyph(vec2f(fract(ringCoord.x) - 0.5, (fract(ringCoord.y) - 0.5) * 1.6), floor(ringCoord.x) + floor(ringCoord.y) * 7.0);
    let glyph = 1.0 - smoothstep(0.0, 0.05, gl);
    let thorn = 1.0 - smoothstep(0.0, 0.03, abs(valueNoise2(vec2f(ang * 6.0, p.y * 9.0)) - 0.5));
    let ink = clamp(max(max(ringLine * 0.8, glyph * step(0.5, fract(ringCoord.y + 0.25))), thorn * 0.6), 0.0, 1.0) * inside;
    let beat = 0.7 + 0.3 * pow(max(sin(time * 7.5), 0.0), 8.0);
    let edge = (1.0 - smoothstep(0.0, 0.08, abs(spread - front))) * beat;
    return vec2f(ink, edge * ink + edge * 0.3);
}

// scratches: short straight strokes scattered on the body (object space)
fn marksScratches(objPos: vec3f, n: vec3f, amount: f32) -> f32 {
    if (amount <= 0.0) {
        return 0.0;
    }
    let q = objPos * 9.0;
    let cell = floor(q);
    let h = hash33(cell);
    if (h.x > amount * 0.6) {
        return 0.0;
    }
    let f = fract(q) - 0.5;
    // a short stroke in the plane facing out of the surface
    let t = normalize(cross(n, vec3f(h.y - 0.5, 1.0, h.z - 0.5)));
    let along = dot(f, t);
    let across = length(f - t * along);
    return (1.0 - smoothstep(0.015, 0.03, across)) * (1.0 - smoothstep(0.25, 0.32, abs(along)));
}

// grime in the folds (low AO) and on the lower body
fn marksGrime(objPos: vec3f, ao: f32, figureH: f32, amount: f32) -> f32 {
    let low = 1.0 - smoothstep(0.0, 0.45, objPos.y / max(figureH, 0.1));
    let n = vfbm2(objPos.xy * 6.0 + objPos.zz * 3.0, 3);
    return clamp((low * 0.6 + (1.0 - ao) * 0.8) * amount * smoothstep(0.3, 0.7, n), 0.0, 1.0);
}

// rips in the cloth: jagged slits with a dark inside and a frayed pale edge
fn marksRips(objPos: vec3f, amount: f32) -> vec2f {
    if (amount < 0.35) {
        return vec2f(0.0);
    }
    let q = objPos * vec3f(5.0, 3.0, 5.0);
    let cell = floor(q);
    let h = hash33(cell + 17.0);
    if (h.x > (amount - 0.35) * 0.9) {
        return vec2f(0.0);
    }
    let f = fract(q) - 0.5;
    let jag = (valueNoise2(f.xz * 30.0 + h.yz * 10.0) - 0.5) * 0.04;
    let slit = abs(f.y + (f.x + f.z) * (h.y - 0.5) * 0.6 + jag) - 0.02 * (0.5 + h.z);
    let len = 1.0 - smoothstep(0.25, 0.35, length(f.xz));
    let inside = (1.0 - smoothstep(0.0, 0.006, slit)) * len;
    let fray = (1.0 - smoothstep(0.006, 0.02, abs(slit))) * len;
    return vec2f(inside, fray);
}

// a thin trickle of dark ink from the corner of the mouth or a cut brow (head height region)
fn marksTrickle(objPos: vec3f, figureH: f32, headH: f32, amount: f32) -> f32 {
    if (amount < 0.55) {
        return 0.0;
    }
    let y = objPos.y / max(figureH, 0.1);
    let face = step(0.0, objPos.z);
    // starting at the mouth's corner, running down the chin
    let x0 = 0.022 * figureH;
    let top = (headH - 0.12) ;
    let line = 1.0 - smoothstep(0.0025, 0.004, abs(objPos.x - x0 - sin(y * 60.0) * 0.002));
    let run = smoothstep(top - 0.06 * (amount - 0.55) * 2.0, top - 0.005, y) * (1.0 - smoothstep(top, top + 0.005, y));
    return line * run * face;
}
