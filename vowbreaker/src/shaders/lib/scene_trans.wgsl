// Scene transitions on real frames (vbTransition). The last frame of the old scene is captured
// (a snapshot); the new scene is set up underneath while the snapshot still covers the screen; then
// the snapshot is broken away. Every function returns, for a pixel, how the snapshot covers it:
//   TransSample.cover   0 = show the new scene, 1 = show the snapshot
//   TransSample.uv      where to sample the snapshot (shards move, halves slide)
//   TransSample.add     light or colour laid on top (glass glints, embers, the slash's flash)
//   TransSample.tint    multiply on the snapshot (charring, shading of tilted shards)
//
//   0 shatter   the frame breaks into glass shards from an impact point; they tip and fall
//   1 ink       ink blooms over the old frame until it is black, then pulls back off the new one
//   2 burn      the old frame burns away like paper from its edges, an ember line, char behind it
//   3 slash     a diagonal cut; the two halves slide apart along it with a white flash
//   4 talisman  paper slips cover the old frame, then fly off upward one by one
//   5-9         fold, petals, brush, blinds, ripple (vb_scene_trans2)

struct TransSample {
    cover: f32,
    uv: vec2f,
    add: vec3f,
    tint: vec3f,
}

fn transNone(uv: vec2f) -> TransSample {
    var s: TransSample;
    s.cover = 0.0;
    s.uv = uv;
    s.add = vec3f(0.0);
    s.tint = vec3f(1.0);
    return s;
}

// --- shatter -----------------------------------------------------------------------------------------------

// a shard: one triangle of a jittered grid cell (two per cell, split along a random diagonal)
struct Shard {
    a: vec2f,
    b: vec2f,
    c: vec2f,
    id: f32,
}

fn transCellCorner(c: vec2f, cell: vec2f) -> vec2f {
    let h = hash22(c + vec2f(31.0, 17.0)) - 0.5;
    // corners on the screen's border stay on it so the frame breaks cleanly at its edges
    return (c + h * 0.7) * cell;
}

fn transShard(cell: vec2f, size: vec2f, half: i32) -> Shard {
    let p00 = transCellCorner(cell, size);
    let p10 = transCellCorner(cell + vec2f(1.0, 0.0), size);
    let p01 = transCellCorner(cell + vec2f(0.0, 1.0), size);
    let p11 = transCellCorner(cell + vec2f(1.0, 1.0), size);
    let diag = hash12(cell + vec2f(5.0, 9.0)) > 0.5;
    var s: Shard;
    if (diag) {
        if (half == 0) { s.a = p00; s.b = p10; s.c = p11; } else { s.a = p00; s.b = p11; s.c = p01; }
    } else {
        if (half == 0) { s.a = p00; s.b = p10; s.c = p01; } else { s.a = p10; s.b = p11; s.c = p01; }
    }
    s.id = hash12(cell * 3.1 + f32(half) * 7.7);
    return s;
}

fn transInTri(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> vec3f {
    let v0 = b - a;
    let v1 = c - a;
    let v2 = p - a;
    let d = v0.x * v1.y - v1.x * v0.y;
    let u = (v2.x * v1.y - v1.x * v2.y) / d;
    let v = (v0.x * v2.y - v2.x * v0.y) / d;
    return vec3f(u, v, 1.0 - u - v);
}

fn transGlassShatter(uv: vec2f, t: f32, impact: vec2f, aspect: f32) -> TransSample {
    var res = transNone(uv);
    // work in an aspect-corrected space so shards are not stretched
    let P = vec2f(uv.x * aspect, uv.y);
    let size = vec2f(0.11, 0.11);
    let cellP = floor(P / size);
    let maxFall = 1.4;
    var bestZ = -1.0;
    // a shard can only have fallen down into this pixel: search the column above it
    for (var dy = -1; dy <= 9; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let cell = cellP + vec2f(f32(dx), f32(dy));
            for (var half = 0; half < 2; half++) {
                let sh = transShard(cell, size, half);
                let centre = (sh.a + sh.b + sh.c) / 3.0;
                // shards near the impact go first
                let impactP = vec2f(impact.x * aspect, impact.y);
                let delay = length(centre - impactP) * 0.45 + sh.id * 0.08;
                let tc = max(t * 1.6 - delay, 0.0);
                if (tc <= 0.0) {
                    // not moving yet: the pixel is covered by the unmoved shard if it is inside it
                    let bc = transInTri(P, sh.a, sh.b, sh.c);
                    if (min(bc.x, min(bc.y, bc.z)) >= 0.0 && dy >= -1 && dy <= 1) {
                        let edge = min(bc.x, min(bc.y, bc.z));
                        res.cover = 1.0;
                        res.uv = uv;
                        res.add = vec3f(1.0) * (1.0 - smoothstep(0.0, 0.03, edge)) * smoothstep(0.0, 0.05, t) * 0.6;
                        res.tint = vec3f(1.0);
                        bestZ = 1.0;
                    }
                    continue;
                }
                // the shard falls, drifts away from the impact and turns about its centre
                let away = normalize(centre - impactP + vec2f(1e-4)) * 0.15 * tc;
                let fall = vec2f(0.0, -1.6 * tc * tc);
                let ang = (sh.id - 0.5) * 4.0 * tc;
                let scale = 1.0 - tc * 0.25;
                let moved = centre + away + fall;
                if (moved.y < -maxFall) {
                    continue;
                }
                // inverse transform of the pixel into the shard's original frame
                let q = rotate2((P - moved) / max(scale, 0.05), -ang) + centre;
                let bc = transInTri(q, sh.a, sh.b, sh.c);
                if (min(bc.x, min(bc.y, bc.z)) >= 0.0) {
                    let z = sh.id;
                    if (z > bestZ) {
                        bestZ = z;
                        let edge = min(bc.x, min(bc.y, bc.z));
                        res.cover = 1.0;
                        res.uv = vec2f(q.x / aspect, q.y);
                        // tilted glass: one face darker, a bright glint on the edges catching light
                        let shade = 0.75 + 0.25 * cos(ang * 2.0 + sh.id * 6.0);
                        res.tint = vec3f(shade);
                        res.add = vec3f(1.0, 1.0, 1.05) * (1.0 - smoothstep(0.0, 0.025, edge)) * 0.9 + vec3f(0.6) * pow(max(sin(ang * 3.0 + sh.id * 10.0), 0.0), 8.0) * 0.4;
                    }
                }
            }
        }
    }
    return res;
}

// --- ink -------------------------------------------------------------------------------------------------------

fn transInk(uv: vec2f, t: f32, aspect: f32, seed: f32) -> TransSample {
    var res = transNone(uv);
    let p = vec2f(uv.x * aspect, uv.y);
    // a few blots growing from scattered points, their edges warped by noise
    var d = 1e3;
    for (var k = 0; k < 6; k++) {
        let c = hash22(vec2f(f32(k), seed)) * vec2f(aspect, 1.0);
        d = min(d, length(p - c) - hash12(vec2f(f32(k), seed + 3.0)) * 0.1);
    }
    d = d + (vfbm2(p * 6.0 + seed, 4) - 0.5) * 0.25;
    // grow over the old frame until it is black (t < 0.5), then recede off the new one
    let grow = smoothstep(0.0, 0.5, t) * 1.3;
    let recede = smoothstep(0.5, 1.0, t) * 1.3;
    let inkOld = 1.0 - smoothstep(grow - 0.02, grow + 0.02, d);
    let inkNew = 1.0 - smoothstep(recede - 0.02, recede + 0.02, d);
    if (t < 0.5) {
        res.cover = 1.0;
        res.tint = mix(vec3f(1.0), vec3f(0.02, 0.015, 0.03), inkOld);
        // the wet edge pooled darker, a faint sheen
        res.add = vec3f(0.08) * (1.0 - smoothstep(0.0, 0.03, abs(d - grow))) * inkOld;
    } else {
        // the new scene shows where the ink has pulled back; elsewhere it is still black ink,
        // with the wet edge of the retreating ink a shade lighter
        res.cover = 1.0 - inkNew;
        res.tint = vec3f(0.0);
        res.add = vec3f(0.02, 0.015, 0.03) + vec3f(0.08) * (1.0 - smoothstep(0.0, 0.03, abs(d - recede)));
    }
    return res;
}

// --- burn ---------------------------------------------------------------------------------------------------------

fn transBurn(uv: vec2f, t: f32, aspect: f32, seed: f32) -> TransSample {
    var res = transNone(uv);
    let p = vec2f(uv.x * aspect, uv.y);
    // burns in from the edges and the corners
    let edgeD = min(min(uv.x, 1.0 - uv.x) * aspect, min(uv.y, 1.0 - uv.y));
    let n = vfbm2(p * 5.0 + seed, 5);
    let v = edgeD * 1.3 + n * 0.35;
    let front = t * 1.05;
    if (v < front) {
        return res;
    }
    res.cover = 1.0;
    let behind = v - front;
    // the glowing ember line, a charred brown band, then the paper browning ahead of the fire
    let ember = 1.0 - smoothstep(0.0, 0.012, behind);
    let char = 1.0 - smoothstep(0.012, 0.05, behind);
    let brown = 1.0 - smoothstep(0.05, 0.16, behind);
    res.tint = mix(vec3f(1.0), vec3f(0.62, 0.45, 0.28), brown * 0.6);
    res.tint = mix(res.tint, vec3f(0.08, 0.05, 0.03), char);
    res.add = vec3f(2.4, 0.9, 0.2) * ember * (0.7 + 0.3 * valueNoise2(p * 80.0 + t * 20.0));
    return res;
}

// --- slash --------------------------------------------------------------------------------------------------------

fn transSlash(uv: vec2f, t: f32, aspect: f32, angle: f32) -> TransSample {
    var res = transNone(uv);
    let c = vec2f(0.5 * aspect, 0.5);
    let p = vec2f(uv.x * aspect, uv.y) - c;
    let dir = vec2f(cos(angle), sin(angle));
    let nrm = vec2f(-dir.y, dir.x);
    let side = sign(dot(p, nrm));
    // the cut appears in the first moment (a white line), then the halves slide apart
    let cut = smoothstep(0.0, 0.15, t);
    let slide = easeInCubic(clamp((t - 0.15) / 0.85, 0.0, 1.0));
    let off = dir * side * slide * 1.4 + nrm * side * slide * 0.08;
    let q = p - off;
    // the half this pixel shows must lie on the same side of the cut after sliding back
    if (sign(dot(q, nrm)) != side) {
        return res;
    }
    let src = q + c;
    if (src.x < 0.0 || src.x > aspect || src.y < 0.0 || src.y > 1.0) {
        return res;
    }
    res.cover = 1.0;
    res.uv = vec2f(src.x / aspect, src.y);
    let lineD = abs(dot(q, nrm));
    res.add = vec3f(3.0, 3.0, 3.2) * (1.0 - smoothstep(0.0, 0.006 + 0.02 * (1.0 - cut), lineD)) * (1.0 - slide);
    res.tint = vec3f(1.0 - slide * 0.3);
    return res;
}

// --- talismans -----------------------------------------------------------------------------------------------------

fn transTalisman(uv: vec2f, t: f32, aspect: f32, seed: f32) -> TransSample {
    var res = transNone(uv);
    let cols = 14.0;
    let w = 1.0 / cols;
    let col = floor(uv.x / w);
    let h = hash12(vec2f(col, seed));
    // each slip flies upward in turn, with a little turn
    let start = h * 0.5;
    let tc = clamp((t - start) / 0.5, 0.0, 1.0);
    let lift = easeInCubic(tc) * 1.3;
    let local = vec2f((fract(uv.x / w) - 0.5) * w * aspect, uv.y - 0.5 - lift);
    let q = rotate2(local, (h - 0.5) * tc * 1.2);
    if (abs(q.x) > w * aspect * 0.5 || abs(q.y) > 0.5) {
        return res;
    }
    res.cover = 1.0;
    // the slip shows the old frame, with a red border and a brushed glyph as it lifts
    let src = vec2f((col + 0.5) * w + q.x / aspect, q.y + 0.5);
    res.uv = src;
    let border = step(0.42, abs(q.x) / (w * aspect)) + step(0.48, abs(q.y));
    let glyph = sdFill(sdGlyph(vec2f(q.x / (w * aspect) * 1.2, (q.y - 0.1) * 2.5), col + seed), 0.03) * step(0.0, tc - 0.01);
    res.tint = mix(vec3f(1.0), vec3f(0.95, 0.92, 0.85), smoothstep(0.0, 0.3, tc));
    res.add = vec3f(0.7, 0.05, 0.04) * clamp(border, 0.0, 1.0) * smoothstep(0.0, 0.2, tc) + vec3f(-0.6) * glyph * smoothstep(0.0, 0.3, tc);
    return res;
}

fn transEval(kind: i32, uv: vec2f, t: f32, aspect: f32, impact: vec2f, seed: f32) -> TransSample {
    switch kind {
        case 0: { return transGlassShatter(uv, t, impact, aspect); }
        case 1: { return transInk(uv, t, aspect, seed); }
        case 2: { return transBurn(uv, t, aspect, seed); }
        case 3: { return transSlash(uv, t, aspect, seed * 6.28); }
        case 5: { return transFold(uv, t, aspect, seed); }
        case 6: { return transPetals(uv, t, aspect, seed); }
        case 7: { return transBrushSweep(uv, t, aspect, seed); }
        case 8: { return transBlinds(uv, t, aspect, seed); }
        case 9: { return transRipple(uv, t, aspect, impact); }
        case 10: { return transShoji(uv, t, aspect, seed); }
        case 11: { return transLanterns(uv, t, aspect, seed); }
        default: { return transTalisman(uv, t, aspect, seed); }
    }
}
