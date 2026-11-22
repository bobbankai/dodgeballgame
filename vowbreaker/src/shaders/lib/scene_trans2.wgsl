// More scene transitions (vbTransition, dispatched from vb_scene_trans transEval):
//
//   5 fold     the old frame is folded like origami: the right half over the left, then the top
//              over the bottom, and the little folded square flies off like a released crane
//   6 petals   the old frame comes apart into sakura petals that peel off and blow away
//   7 brush    one great stroke of a dry ink brush sweeps across, the old frame ahead of it, the
//              new scene behind, the stroke's hairs breaking up at its edges
//   8 blinds   a bamboo blind rolls up from the bottom, slat by slat, revealing the new scene
//   9 ripple   the old frame dissolves outward in rings, like a reflection broken by a stone

const PAPER_BACK = vec3f(0.94, 0.91, 0.84);

// --- fold -----------------------------------------------------------------------------------------------------

fn transFold(uv: vec2f, t: f32, aspect: f32, seed: f32) -> TransSample {
    var r = transNone(uv);
    // phase A: the right half folds over onto the left around x = 0.5
    let ta = clamp(t / 0.38, 0.0, 1.0);
    let tb = clamp((t - 0.38) / 0.3, 0.0, 1.0);
    let tc = clamp((t - 0.68) / 0.32, 0.0, 1.0);
    // phase C: the folded quarter flies off up-left, turning and shrinking
    var p = uv;
    if (tc > 0.0) {
        let e = easeInCubic(tc);
        let c = vec2f(0.25, 0.25);
        let center = c + vec2f(-0.6, 0.9) * e;
        let q = rotate2((p - center) * vec2f(aspect, 1.0), e * 2.5) / vec2f(aspect, 1.0);
        p = c + q / max(1.0 - e * 0.7, 0.05);
    }
    // the folded page after A and B covers [0,0.5]x[0,0.5]; work back through the folds
    var shade = 1.0;
    var back = 0.0;
    // undo B: the top half (y > 0.5) folded down over the bottom
    let thetaB = easeInOutCubic(tb) * PI;
    let cb = cos(thetaB);
    var y = p.y;
    var coveredB = true;
    if (tb > 0.0) {
        if (cb >= 0.0) {
            // the folding top half is still on its way down: compressed above the crease
            if (y > 0.5) {
                let h = 0.5 * cb;
                if (y > 0.5 + h) {
                    coveredB = false;
                } else {
                    y = 0.5 + (y - 0.5) / max(cb, 1e-3);
                    shade = 0.6 + 0.4 * cb;
                }
            }
        } else {
            // past vertical: its back (plain paper) lies over the bottom half
            let h = 0.5 * -cb;
            if (y > 0.5) {
                coveredB = false;
            } else if (y > 0.5 - h) {
                back = 1.0;
                shade = 0.75 + 0.25 * -cb;
            }
        }
    }
    // undo A: the right half folded over the left
    let thetaA = easeInOutCubic(ta) * PI;
    let ca = cos(thetaA);
    var x = p.x;
    var coveredA = true;
    if (ca >= 0.0) {
        if (x > 0.5) {
            let w = 0.5 * ca;
            if (x > 0.5 + w) {
                coveredA = false;
            } else {
                x = 0.5 + (x - 0.5) / max(ca, 1e-3);
                shade = shade * (0.6 + 0.4 * ca);
            }
        }
    } else {
        let w = 0.5 * -ca;
        if (x > 0.5) {
            coveredA = false;
        } else if (x > 0.5 - w && back < 0.5) {
            back = 1.0;
            // the flap is lit across its width as it lies down (brightest at its free edge)
            let across = (x - (0.5 - w)) / max(w, 1e-3);
            shade = shade * (0.7 + 0.3 * -ca) * (0.85 + 0.2 * (1.0 - across));
        }
    }
    let inside = all(p >= vec2f(0.0)) && all(p <= vec2f(1.0));
    if (!coveredA || !coveredB || !inside) {
        return r;
    }
    r.cover = 1.0;
    r.uv = vec2f(x, y);
    // the back of the paper is blank; the crease lines are drawn
    let crease = max(1.0 - smoothstep(0.0, 0.003, abs(p.x - 0.5)) * step(ta, 0.999), 1.0 - smoothstep(0.0, 0.003, abs(p.y - 0.5)) * step(0.001, tb));
    r.tint = mix(vec3f(shade), vec3f(0.0), back);
    // the back of the paper: washi fibre, a faint print of the frame bleeding through
    let fibre = valueNoise2(vec2f(uv.x * 900.0, uv.y * 40.0) + seed) * valueNoise2(vec2f(uv.x * 40.0, uv.y * 900.0) + seed * 2.0);
    let washi = PAPER_BACK * (0.93 + fibre * 0.12);
    r.add = washi * shade * back - vec3f(0.25) * crease * 0.5;
    // a thin shadow line where the flap's edge lies on the page
    r.add = r.add - vec3f(0.3) * back * (1.0 - smoothstep(0.0, 0.006, abs(p.x - (0.5 - 0.5 * max(-ca, 0.0))))) * step(ta, 0.999);
    return r;
}

// --- petals ---------------------------------------------------------------------------------------------------

fn sdPetalShape(p: vec2f, size: f32) -> f32 {
    // a sakura petal: a rounded teardrop with a notch at its tip
    let q = vec2f(abs(p.x), p.y);
    let body = length(q * vec2f(1.0, 0.8) - vec2f(0.0, size * 0.1)) - size * 0.55;
    let notch = length(q - vec2f(0.0, size * 0.7)) - size * 0.18;
    return max(body, -notch);
}

fn transPetals(uv: vec2f, t: f32, aspect: f32, seed: f32) -> TransSample {
    var r = transNone(uv);
    let cells = 18.0;
    let p = vec2f(uv.x * aspect, uv.y) * cells;
    let size = 1.0;
    var best = 0.0;
    var bestUV = uv;
    var bestShade = 1.0;
    // a petal detaches (left to right with jitter), drifts right and up, tumbles and shrinks
    for (var j = -1; j <= 1; j++) {
        for (var i = -3; i <= 0; i++) {
            let cell = floor(p) + vec2f(f32(i), f32(j));
            let h = hash22(cell + seed * 17.0);
            let start = clamp(cell.x / (cells * aspect), 0.0, 1.0) * 0.55 + h.x * 0.2;
            let tc = clamp((t - start) / 0.4, 0.0, 1.0);
            let centre = cell + 0.5 + vec2f(tc * 3.0, tc * (1.2 + h.y)) + vec2f(sin(tc * 6.0 + h.x * 6.0) * 0.3, 0.0);
            let rot = tc * (4.0 + h.y * 4.0) * select(-1.0, 1.0, h.x > 0.5);
            let q = rotate2(p - centre, rot);
            // a square while attached, becoming a petal as it lifts, shrinking as it goes
            let s = mix(0.0, 0.6, smoothstep(0.0, 0.25, tc));
            let sq = sdBox2(q, vec2f(0.5 + 0.02)) * (1.0 - s);
            let pet = sdPetalShape(q / max(1.0 - tc * 0.5, 0.05), size) * (1.0 - tc * 0.5);
            let d = mix(sq, pet, smoothstep(0.0, 0.25, tc));
            if (d < 0.0 && tc < 1.0) {
                let inPiece = q + cell + 0.5;
                // the petal keeps showing the bit of frame it came from, flushed pink as it goes
                best = 1.0;
                bestUV = vec2f(inPiece.x / cells / aspect, inPiece.y / cells);
                bestShade = 1.0 - tc * 0.2;
            }
        }
    }
    if (best <= 0.0) {
        return r;
    }
    r.cover = 1.0;
    r.uv = bestUV;
    r.tint = vec3f(bestShade) * mix(vec3f(1.0), vec3f(1.05, 0.88, 0.92), 1.0 - bestShade);
    return r;
}

// --- brush ----------------------------------------------------------------------------------------------------

fn transBrushSweep(uv: vec2f, t: f32, aspect: f32, seed: f32) -> TransSample {
    var r = transNone(uv);
    // the stroke's front moves left to right, slightly curved, its width the whole screen
    let front = mix(-0.35, 1.35, easeInOutCubic(t)) + sin(uv.y * 3.0 + seed * 6.0) * 0.04;
    let x = uv.x;
    // the stroke body: black ink, its back edge dry and breaking up into hairs
    let hairs = valueNoise2(vec2f(uv.y * 160.0 + seed * 30.0, x * 2.0));
    let back = front - 0.28 - hairs * 0.12;
    if (x > front) {
        r.cover = 1.0;
        // the wet front edge darkens the old frame just ahead of the brush
        let wet = 1.0 - smoothstep(0.0, 0.03, x - front);
        r.tint = vec3f(1.0 - wet * 0.5);
        return r;
    }
    if (x > back) {
        // inside the stroke: ink, with dry streaks where the paper shows through as it thins
        let dry = smoothstep(0.55, 0.8, hairs) * smoothstep(back + 0.15, back, x);
        r.cover = 1.0 - dry;
        r.tint = vec3f(0.0);
        r.add = vec3f(0.04, 0.035, 0.04) * (1.0 - dry);
        return r;
    }
    return r;
}

// --- blinds ---------------------------------------------------------------------------------------------------

fn transBlinds(uv: vec2f, t: f32, aspect: f32, seed: f32) -> TransSample {
    var r = transNone(uv);
    // the blind's bottom edge rises; above it the slats still hang, below it the new scene
    let edge = easeInOutQuad(t) * 1.08;
    if (uv.y < edge - 0.04) {
        return r;
    }
    let slats = 70.0;
    let f = fract(uv.y * slats);
    // the roll at the bottom edge: a bundle of slats, shaded round
    if (uv.y < edge) {
        let k = (uv.y - (edge - 0.04)) / 0.04;
        r.cover = 1.0;
        r.uv = uv;
        r.tint = vec3f(0.0);
        r.add = vec3f(0.55, 0.42, 0.22) * (0.6 + 0.4 * sin(k * PI)) * (0.85 + 0.15 * step(0.5, fract(uv.y * slats * 3.0)));
        return r;
    }
    // hanging slats: the old frame seen between thin bamboo strips and the cords
    r.cover = 1.0;
    let strip = 1.0 - smoothstep(0.0, 0.12, abs(f - 0.5) - 0.38);
    let cord = (1.0 - smoothstep(0.0, 0.002, abs(fract(uv.x * 4.0) - 0.5) - 0.002));
    r.tint = vec3f(1.0 - strip * 0.55) * (1.0 - cord * 0.5);
    r.add = vec3f(0.35, 0.26, 0.12) * strip * 0.4 + vec3f(0.3, 0.05, 0.04) * cord * 0.4;
    return r;
}

// --- ripple ---------------------------------------------------------------------------------------------------

fn transRipple(uv: vec2f, t: f32, aspect: f32, center: vec2f) -> TransSample {
    var r = transNone(uv);
    let d = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let dist = length(d);
    let front = easeInOutQuad(t) * 1.25;
    // inside the front the new scene; at the front a bright ring; outside, the old frame rippling
    if (dist < front - 0.02) {
        return r;
    }
    let k = dist - front;
    let wave = sin(k * 70.0 - t * 20.0) * exp(-k * 6.0) * (1.0 - t);
    let dir = d / max(dist, 1e-4);
    r.cover = smoothstep(-0.02, 0.02, k);
    r.uv = uv + vec2f(dir.x / aspect, dir.y) * wave * 0.012;
    r.add = vec3f(0.85, 0.92, 1.0) * (1.0 - smoothstep(0.0, 0.015, abs(k))) * 0.8;
    r.tint = vec3f(1.0 + wave * 0.6);
    return r;
}

// --- shoji, lanterns ------------------------------------------------------------------------------------------
//
//  10 shoji     two paper doors slide shut over the old frame from the sides, meet, then slide open
//               on the new scene (the frame behind changes while they are shut)
//  11 lanterns  the old frame breaks into a grid of paper lanterns that light from within and float
//               upward, each at its own pace

fn transShoji(uv: vec2f, t: f32, aspect: f32, seed: f32) -> TransSample {
    var r = transNone(uv);
    // closing (0..0.45) the doors hide the old frame; opening (0.55..1) they reveal the new
    let close = easeInOutCubic(clamp(t / 0.45, 0.0, 1.0));
    let open = easeInOutCubic(clamp((t - 0.55) / 0.45, 0.0, 1.0));
    let half = 0.5 * close * (1.0 - open);
    let door = step(uv.x, half) + step(1.0 - half, uv.x);
    // before they meet, the uncovered middle still shows the old frame
    r.cover = select(0.0, 1.0, t < 0.5);
    if (door > 0.5) {
        // the doors: a lattice of thin wooden bars over lit paper
        let lx = select(uv.x - (half - 0.5), uv.x - (1.0 - half), uv.x > 0.5);
        let gx = abs(fract(lx * 8.0) - 0.5);
        let gy = abs(fract(uv.y * 6.0) - 0.5);
        let bars = max(1.0 - smoothstep(0.0, 0.03, 0.5 - gx), 1.0 - smoothstep(0.0, 0.03, 0.5 - gy));
        let paper = vec3f(0.95, 0.9, 0.78) * (0.92 + 0.08 * valueNoise2(uv * vec2f(aspect, 1.0) * 60.0));
        r.cover = 1.0;
        r.tint = vec3f(0.0);
        r.add = mix(paper, vec3f(0.32, 0.22, 0.14), bars);
    }
    return r;
}

fn transLanterns(uv: vec2f, t: f32, aspect: f32, seed: f32) -> TransSample {
    var r = transNone(uv);
    let cols = 10.0;
    let rows = 6.0;
    var best = 0.0;
    // (a lantern can have risen from up to nine rows below)
    for (var dj = -9; dj <= 0; dj++) {
        let p = vec2f(uv.x * cols, uv.y * rows);
        let cell = floor(p) + vec2f(0.0, f32(dj));
        let h = hash22(cell + seed * 9.0);
        let start = h.x * 0.45;
        let tc = clamp((t - start) / 0.55, 0.0, 1.0);
        let rise = easeInQuad(tc) * 1.4;
        let local = p - cell - vec2f(0.5, 0.5 + rise * rows);
        // each piece rounds into a lantern as it lifts, and shrinks with distance
        let s = 1.0 - tc * 0.5;
        let q = local / vec2f(0.5 * s, 0.5 * s);
        let box = max(abs(q.x), abs(q.y));
        let lantern = length(vec2f(q.x, q.y * 0.8));
        let d = mix(box, lantern, smoothstep(0.0, 0.3, tc));
        if (d < 1.0 && tc < 1.0) {
            best = 1.0;
            r.uv = (cell + vec2f(0.5) + local) / vec2f(cols, rows);
            // lit from inside as it rises: warm glow, ribs
            let glow = smoothstep(0.0, 0.4, tc);
            let ribs = step(0.8, fract(q.y * 3.0)) * glow;
            r.tint = mix(vec3f(1.0), vec3f(1.2, 0.7, 0.35), glow * 0.8) * (1.0 - ribs * 0.4);
            r.add = vec3f(1.0, 0.45, 0.12) * glow * (1.0 - d) * 0.6;
        }
    }
    r.cover = best;
    return r;
}
