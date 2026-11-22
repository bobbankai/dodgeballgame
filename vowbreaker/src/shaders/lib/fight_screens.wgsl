// Fight screens (vbStylize): the frame dressed for the moments that frame a fight.
//
//   versus   as a fight begins: two great brush strokes sweep in from opposite corners, each in its
//            fighter's colour, and clash in a diagonal slash across the middle; speed lines race
//            along them; then the strokes tear apart and the fight is on
//   victory  the fight won: the colour drains from everything but the warmest things, a red sun
//            rises behind the middle of the frame, gold sparks drift up, ink beads along the top
//   defeat   the fight lost: ink floods in from the edges, the colour goes to grey, the frame cracks
//   danger   the player near the end of their strength: red veins creep in from the edges with a
//            heartbeat, the colour thins at each beat

// a broad dry-brush band along a line through the frame (signed distance across it in `w` units)
fn fightBand(p: vec2f, origin: vec2f, dir: vec2f, width: f32, reach: f32, seed: f32) -> f32 {
    let n = vec2f(-dir.y, dir.x);
    let along = dot(p - origin, dir);
    let across = dot(p - origin, n);
    // its length grows to `reach`; the leading end is ragged
    let rag = (valueNoise2(vec2f(across * 30.0, seed)) - 0.5) * 0.08;
    let lengthMask = 1.0 - smoothstep(reach - 0.05 + rag, reach + rag, along);
    let start = smoothstep(-0.05, 0.0, along);
    // dry-brush hairs along its length, breaking up at its edges
    let hairs = valueNoise2(vec2f(across * 90.0 + seed * 7.0, along * 1.5));
    let edge = abs(across) / width;
    let body = 1.0 - smoothstep(0.75 + (hairs - 0.5) * 0.4, 1.0, edge);
    return body * lengthMask * start;
}

fn fightVersus(col: vec3f, uv: vec2f, aspect: f32, t: f32, colA: vec3f, colB: vec3f, time: f32) -> vec3f {
    if (t < 0.0 || t >= 1.0) {
        return col;
    }
    let p = vec2f(uv.x * aspect, uv.y);
    let dir = normalize(vec2f(aspect, -1.0));
    // the strokes sweep in (0..0.3), hold and clash (0.3..0.75), tear apart (0.75..1)
    let sweep = easeOutCubic(clamp(t / 0.3, 0.0, 1.0));
    let tear = easeInCubic(clamp((t - 0.75) / 0.25, 0.0, 1.0));
    let reach = sweep * (aspect + 1.2);
    let off = tear * 0.6;
    let a = fightBand(p, vec2f(0.0, 1.0) + vec2f(-dir.y, dir.x) * (0.18 + off), dir, 0.22, reach, 1.0);
    let b = fightBand(p, vec2f(aspect, 0.0) - vec2f(-dir.y, dir.x) * (0.18 + off), -dir, 0.22, reach, 2.0);
    // the frame behind darkened while the strokes hold
    let hold = smoothstep(0.0, 0.15, t) * (1.0 - tear);
    var c = mix(col, col * 0.45, hold * 0.6);
    // speed lines racing along the strokes
    let along = dot(p, dir);
    let lines = step(0.92, valueNoise2(vec2f(dot(p, vec2f(-dir.y, dir.x)) * 140.0, along * 2.0 - time * 12.0))) * hold;
    c = mix(c, vec3f(1.0), lines * 0.5);
    c = mix(c, colA * 1.1, a * (1.0 - tear * 0.5));
    c = mix(c, colB * 1.1, b * (1.0 - tear * 0.5));
    // the clash: a white slash between the two strokes, flaring as they meet
    let n = vec2f(-dir.y, dir.x);
    let mid = dot(p - vec2f(aspect * 0.5, 0.5), n);
    let flare = smoothstep(0.25, 0.32, t) * (1.0 - smoothstep(0.45, 0.8, t));
    let slash = (1.0 - smoothstep(0.0, 0.012 + flare * 0.02, abs(mid))) * smoothstep(0.2, 0.3, t) * (1.0 - tear);
    c = mix(c, vec3f(1.0, 0.98, 0.94), slash);
    return c;
}

fn fightVictory(col: vec3f, uv: vec2f, aspect: f32, t: f32, time: f32) -> vec3f {
    let k = smoothstep(0.0, 0.4, t);
    // drain everything but the warm, bright colours
    let l = luma(col);
    let hsv = rgbToHsv(col);
    let warm = smoothstep(0.85, 1.0, max(1.0 - abs(hsv.x - 0.06) * 6.0, 0.0)) * smoothstep(0.3, 0.6, hsv.y);
    var c = mix(col, mix(vec3f(l), col, warm), k * 0.75);
    // the red sun behind the middle
    let d = length(vec2f((uv.x - 0.5) * aspect, uv.y - 0.58));
    let sunR = 0.22 * easeOutCubic(clamp(t / 0.5, 0.0, 1.0));
    let sun = 1.0 - smoothstep(sunR - 0.004, sunR, d);
    // (strongest behind the darker shapes, still clear over bright ground)
    c = mix(c, mix(c * vec3f(1.2, 0.3, 0.25), vec3f(0.85, 0.12, 0.1), 0.6), sun * k * mix(0.55, 0.9, 1.0 - smoothstep(0.1, 0.4, l)));
    // gold sparks drifting up
    let cell = floor(vec2f(uv.x * aspect * 30.0, uv.y * 30.0 - time * 3.0));
    let h = hash12(cell);
    let f = fract(vec2f(uv.x * aspect * 30.0, uv.y * 30.0 - time * 3.0)) - 0.5;
    let spark = (1.0 - smoothstep(0.03, 0.08, length(f))) * step(0.96, h);
    c = c + vec3f(1.0, 0.8, 0.35) * spark * k;
    // ink beading along the top edge
    let drip = smoothstep(0.0, 0.08, (1.0 - uv.y) - (valueNoise2(vec2f(uv.x * 30.0, 0.0)) * 0.08 * k));
    c = mix(vec3f(0.03, 0.02, 0.03), c, mix(1.0, drip, k));
    return c;
}

fn fightDefeat(col: vec3f, uv: vec2f, aspect: f32, t: f32, time: f32) -> vec3f {
    let k = smoothstep(0.0, 0.8, t);
    var c = mix(col, vec3f(luma(col)) * vec3f(0.9, 0.9, 1.0), k * 0.85);
    // ink floods in from the edges, ragged
    let e = min(min(uv.x, 1.0 - uv.x) * aspect, min(uv.y, 1.0 - uv.y));
    let n = vfbm2(uv * vec2f(aspect, 1.0) * 4.0 + time * 0.05, 4);
    let flood = 1.0 - smoothstep(0.0, 0.04, e - k * 0.25 + (n - 0.5) * 0.12);
    c = mix(c, vec3f(0.02, 0.015, 0.02), flood);
    // the frame cracks from the middle
    let w = worley2(vec2f(uv.x * aspect, uv.y) * 5.0, 1.0);
    let crack = (1.0 - smoothstep(0.0, 0.01, w.edge)) * smoothstep(0.5, 1.0, t) * (1.0 - smoothstep(0.0, 0.6, length(vec2f((uv.x - 0.5) * aspect, uv.y - 0.5)) - t * 0.6));
    c = mix(c, vec3f(0.0), crack * 0.8);
    return c;
}

fn fightDanger(col: vec3f, uv: vec2f, aspect: f32, amount: f32, time: f32) -> vec3f {
    if (amount <= 0.0) {
        return col;
    }
    // a heartbeat: two quick pulses a second
    let beat = fract(time * 1.1);
    let pulse = exp(-beat * 12.0) + exp(-max(beat - 0.22, 0.0) * 12.0) * step(0.22, beat) * 0.7;
    // red veins creeping in from the edges
    let e = min(min(uv.x, 1.0 - uv.x) * aspect, min(uv.y, 1.0 - uv.y));
    let n = abs(vfbm2(uv * vec2f(aspect, 1.0) * 6.0, 4) - 0.5) * 2.0;
    let reach = 0.05 + amount * 0.15 + pulse * 0.03;
    let vein = (1.0 - smoothstep(0.0, 0.05, n)) * (1.0 - smoothstep(0.0, reach, e));
    let glow = 1.0 - smoothstep(0.0, reach * 1.4, e);
    var c = mix(col, vec3f(luma(col)), amount * pulse * 0.35);
    c = mix(c, c * vec3f(0.6, 0.15, 0.15), glow * amount * 0.5);
    c = mix(c, vec3f(0.7, 0.02, 0.05), vein * amount);
    return c;
}

fn fightScreens(col: vec3f, uv: vec2f, aspect: f32, p: vec4f, colA: vec3f, colB: vec3f, time: f32) -> vec3f {
    var c = fightDanger(col, uv, aspect, p.w, time);
    c = fightVersus(c, uv, aspect, p.x, colA, colB, time);
    let kind = i32(p.z + 0.5);
    if (kind == 1) {
        c = fightVictory(c, uv, aspect, p.y, time);
    } else if (kind == 2) {
        c = fightDefeat(c, uv, aspect, p.y, time);
    }
    return c;
}
