// ============================================================================================
// vb_env_detail: the life a place has lived, layered over the base surface patterns. Every stage
// surface knows its pattern id (brick, plaster, planks, stone, roof, asphalt...) and gets the
// wear that belongs to it: moss in the joints of old stone and on the north side of walls, water
// stains running down plaster from sills, rust bleeding from metal seams, cracks across concrete,
// chalk and paint on walls, posters peeling in an alley, oil stains on asphalt, fallen leaves and
// petals collecting where floors meet walls, lichen on graves, soot over doorways, scuffs where
// people walk. Each layer returns a tint, a height change and a gloss change.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_sdf2d, vb_noise2, vb_patterns,
// vb_surface.
// ============================================================================================

struct Detail {
    tint: vec3f,       // multiplied into albedo
    add: vec3f,        // added to albedo (paint, chalk, petals)
    height: f32,       // added to the bump height
    gloss: f32,        // added gloss (oil, puddle edges)
    emissive: vec3f,
}

fn detailNone() -> Detail {
    return Detail(vec3f(1.0), vec3f(0.0), 0.0, 0.0, vec3f(0.0));
}

fn detailMix(a: Detail, b: Detail, k: f32) -> Detail {
    return Detail(mix(a.tint, b.tint, k), mix(a.add, b.add, k), mix(a.height, b.height, k), mix(a.gloss, b.gloss, k), mix(a.emissive, b.emissive, k));
}

// --- generic weathering ------------------------------------------------------------------------------

// moss: in crevices, on surfaces facing up and away from the sun, more near the ground
fn detailMoss(p: vec3f, n: vec3f, ao: f32, amount: f32) -> Detail {
    var d = detailNone();
    if (amount <= 0.0) {
        return d;
    }
    let up = clamp(n.y * 0.6 + 0.4, 0.0, 1.0);
    let ground = 1.0 - smoothstep(0.0, 2.5, p.y);
    let crev = 1.0 - smoothstep(0.4, 0.8, ao);
    let n1 = vfbm3(p * 1.7, 4);
    let n2 = valueNoise3(p * 18.0);
    let m = smoothstep(0.55, 0.7, n1 + crev * 0.3 + ground * 0.15 + up * 0.1 - (1.0 - amount) * 0.4);
    d.tint = mix(vec3f(1.0), vec3f(0.42, 0.55, 0.28) * (0.8 + 0.4 * n2), m);
    d.height = m * 0.15 * n2;
    return d;
}

// water stains streaking down from edges (sills, roof eaves), on vertical surfaces
fn detailStreaks(p: vec3f, n: vec3f, amount: f32) -> Detail {
    var d = detailNone();
    let vertical = 1.0 - abs(n.y);
    if (amount <= 0.0 || vertical < 0.3) {
        return d;
    }
    let u = dot(p.xz, normalize(vec2f(-n.z, n.x) + vec2f(1e-4)));
    let col = floor(u * 3.0);
    let h = hash11(col * 13.7);
    let len = 0.5 + h * 2.5;
    let top = fract(p.y / 3.2 + hash11(col)) * 3.2;
    let k = smoothstep(len, 0.0, top) * step(0.45, h) * (1.0 - smoothstep(0.2, 0.5, abs(fract(u * 3.0) - 0.5) * 2.0));
    let s = k * vertical * amount * (0.6 + 0.4 * valueNoise2(vec2f(u * 20.0, p.y * 2.0)));
    d.tint = mix(vec3f(1.0), vec3f(0.72, 0.7, 0.66), s);
    return d;
}

// soot darkening above doors, windows and lanterns (anything that burned for years)
fn detailSoot(p: vec3f, n: vec3f, amount: f32) -> Detail {
    var d = detailNone();
    if (amount <= 0.0) {
        return d;
    }
    let s = smoothstep(0.55, 0.85, vfbm3(p * vec3f(0.6, 0.25, 0.6), 3)) * smoothstep(1.5, 3.5, p.y) * (1.0 - abs(n.y));
    d.tint = mix(vec3f(1.0), vec3f(0.35, 0.33, 0.32), s * amount);
    return d;
}

// scuffed paths where feet go: worn lighter, smoother
fn detailScuff(p: vec3f, n: vec3f, center: vec2f, radius: f32, amount: f32) -> Detail {
    var d = detailNone();
    if (amount <= 0.0 || n.y < 0.7) {
        return d;
    }
    let r = length(p.xz - center) / max(radius, 0.1);
    let path = (1.0 - smoothstep(0.4, 1.0, r)) * (0.6 + 0.4 * vfbm2(p.xz * 0.8, 3));
    d.tint = mix(vec3f(1.0), vec3f(1.08, 1.06, 1.02), path * amount);
    d.height = -path * 0.05 * amount;
    d.gloss = path * 0.05 * amount;
    return d;
}

// --- per surface -------------------------------------------------------------------------------------

fn detailBrick(p: vec3f, n: vec3f, ao: f32, age: f32) -> Detail {
    var d = detailMoss(p, n, ao, age * 0.5);
    // efflorescence: white salt blooming out of the mortar near the ground
    let salt = smoothstep(0.6, 0.8, vfbm3(p * 3.0, 3)) * (1.0 - smoothstep(0.0, 1.2, p.y)) * age;
    d.add = d.add + vec3f(0.25, 0.24, 0.22) * salt;
    // a few chipped bricks
    let chip = step(0.93, hash13(floor(p * vec3f(4.0, 12.0, 4.0))));
    d.tint = d.tint * mix(vec3f(1.0), vec3f(0.85, 0.8, 0.76), chip);
    d.height = d.height - chip * 0.2;
    return d;
}

fn detailPlaster(p: vec3f, n: vec3f, ao: f32, age: f32) -> Detail {
    var d = detailStreaks(p, n, age);
    // cracks spidering from corners
    let c = crackle2(p.xy * 1.3 + p.zy * 1.1, 0.025);
    let cracked = c * smoothstep(0.55, 0.75, vfbm3(p * 0.7, 2)) * age;
    d.tint = d.tint * (1.0 - cracked * 0.45);
    d.height = d.height - cracked * 0.3;
    // patches where the plaster fell away showing brick beneath
    let patchN = vfbm3(p * 0.9 + vec3f(7.0), 3);
    let fallen = smoothstep(0.72, 0.74, patchN) * age;
    d.tint = mix(d.tint, vec3f(0.75, 0.48, 0.38), fallen);
    d.height = d.height - fallen * 0.4;
    return d;
}

fn detailWood(p: vec3f, n: vec3f, ao: f32, age: f32) -> Detail {
    var d = detailMoss(p, n, ao, age * 0.25);
    // greyed, sun-bleached on faces toward the sky; darker and wetter near the ground
    let bleach = clamp(n.y, 0.0, 1.0) * age * 0.4;
    d.tint = d.tint * mix(vec3f(1.0), vec3f(1.1, 1.08, 1.12), bleach);
    let damp = (1.0 - smoothstep(0.0, 0.6, p.y)) * age;
    d.tint = d.tint * mix(vec3f(1.0), vec3f(0.7, 0.66, 0.62), damp);
    // nail heads in rows
    let nail = step(0.82, 1.0 - length(fract(p.xz * vec2f(2.0, 8.0)) - 0.5) * 6.0);
    d.add = d.add + vec3f(0.08, 0.07, 0.06) * nail * age;
    return d;
}

fn detailStone(p: vec3f, n: vec3f, ao: f32, age: f32) -> Detail {
    var d = detailMoss(p, n, ao, age);
    // lichen: round pale green-grey spots
    let li = spots(p.xz * 2.0 + p.yy * 1.3, 3.0, 0.3) * age;
    d.tint = mix(d.tint, vec3f(0.8, 0.85, 0.72), li * 0.6);
    // weathered softening: a slight grain
    d.height = d.height + (valueNoise3(p * 30.0) - 0.5) * 0.06 * patClarity(0.033);
    return d;
}

fn detailMetal(p: vec3f, n: vec3f, age: f32) -> Detail {
    var d = detailNone();
    let rust = smoothstep(0.55, 0.75, vfbm3(p * 2.5, 4) + (1.0 - smoothstep(0.0, 1.5, p.y)) * 0.25) * age;
    let bleed = detailStreaks(p * 1.7, n, age).tint;
    d.tint = mix(vec3f(1.0), vec3f(0.62, 0.33, 0.18), rust) * mix(vec3f(1.0), vec3f(0.85, 0.65, 0.5), 1.0 - bleed.r);
    d.gloss = -rust * 0.5;
    d.height = rust * 0.2 * valueNoise3(p * 40.0);
    return d;
}

fn detailConcrete(p: vec3f, n: vec3f, ao: f32, age: f32) -> Detail {
    var d = detailStreaks(p, n, age * 0.7);
    let cr = crackedEarth(p.xz * 0.35 + p.yy * 0.2, 1.0).x * smoothstep(0.5, 0.7, vfbm3(p * 0.3, 2)) * age;
    d.tint = d.tint * (1.0 - cr * 0.5);
    d.height = d.height - cr * 0.3;
    let oil = smoothstep(0.7, 0.8, vfbm2(p.xz * 0.5, 3)) * step(0.9, n.y) * age;
    d.tint = d.tint * mix(vec3f(1.0), vec3f(0.55, 0.55, 0.6), oil);
    d.gloss = d.gloss + oil * 0.4;
    return d;
}

// posters and stickers on alley walls: rectangles of colour, half torn, with printed text bars
fn detailPosters(p: vec3f, n: vec3f, seed: f32, amount: f32) -> Detail {
    var d = detailNone();
    let vertical = 1.0 - abs(n.y);
    if (amount <= 0.0 || vertical < 0.8 || p.y < 0.6 || p.y > 2.4) {
        return d;
    }
    let u = dot(p.xz, normalize(vec2f(-n.z, n.x) + vec2f(1e-4)));
    let cell = floor(vec2f(u / 0.9, p.y / 0.7));
    let h = hash22(cell + vec2f(seed * 17.0));
    if (h.x > 0.45 * amount) {
        return d;
    }
    let local = vec2f(fract(u / 0.9), fract(p.y / 0.7)) - 0.5;
    let inside = step(abs(local.x), 0.32) * step(abs(local.y), 0.4);
    let torn = step(valueNoise2(local * 14.0 + cell) * 0.6 + local.y, 0.55);
    let col = hsvToRgb(vec3f(h.y, 0.55, 0.85));
    let bars = step(0.6, fract(local.y * 12.0)) * step(abs(local.x), 0.25) * step(local.y, 0.1);
    let paper = mix(col, vec3f(0.1), bars);
    d.add = (paper - vec3f(0.5)) * inside * torn;
    d.tint = mix(vec3f(1.0), vec3f(0.5), inside * torn);
    return d;
}

// graffiti tags: thick sprayed strokes along walls at hand height
fn detailGraffiti(p: vec3f, n: vec3f, seed: f32, amount: f32) -> Detail {
    var d = detailNone();
    let vertical = 1.0 - abs(n.y);
    if (amount <= 0.0 || vertical < 0.8 || p.y > 2.2) {
        return d;
    }
    let u = dot(p.xz, normalize(vec2f(-n.z, n.x) + vec2f(1e-4)));
    let seg = floor(u / 3.0);
    if (hash11(seg + seed * 7.0) > amount * 0.5) {
        return d;
    }
    let q = vec2f(fract(u / 3.0) * 3.0 - 1.5, p.y - 1.2);
    let wave = sin(q.x * 5.0 + hash11(seg) * 6.0) * 0.18 + sin(q.x * 13.0) * 0.06;
    let stroke = 1.0 - smoothstep(0.03, 0.06, abs(q.y - wave));
    let outline = (1.0 - smoothstep(0.06, 0.08, abs(q.y - wave))) * (1.0 - stroke);
    let inRange = step(abs(q.x), 1.2);
    let col = hsvToRgb(vec3f(hash11(seg + 3.0), 0.8, 0.9));
    d.add = ((col - vec3f(0.5)) * stroke + vec3f(-0.4) * outline) * inRange;
    d.tint = mix(vec3f(1.0), vec3f(0.6), (stroke + outline) * inRange);
    d.gloss = stroke * inRange * 0.15;
    return d;
}

// leaves and petals drifting into corners and along the foot of walls
fn detailLitter(p: vec3f, n: vec3f, ao: f32, season: f32, amount: f32) -> Detail {
    var d = detailNone();
    if (amount <= 0.0 || n.y < 0.8) {
        return d;
    }
    let corner = 1.0 - smoothstep(0.35, 0.75, ao);
    let cell = worley2(p.xz * 9.0, 1.0);
    let drift = smoothstep(0.45, 0.7, vfbm2(p.xz * 0.35, 3));
    // (fading out far off, where single leaves would only sparkle)
    let leaf = (1.0 - smoothstep(0.07, 0.11, cell.f1)) * step(0.93 - corner * 0.45 - drift * 0.25, cell.id.x) * amount * patClarity(0.11);
    // season: 0 spring (pink petals), 0.5 summer (green), 1 autumn (amber)
    let spring = vec3f(0.98, 0.75, 0.82);
    let summer = vec3f(0.35, 0.55, 0.25);
    let autumn = vec3f(0.85, 0.45, 0.15);
    var c = mix(spring, summer, smoothstep(0.0, 0.5, season));
    c = mix(c, autumn, smoothstep(0.5, 1.0, season));
    c = c * (0.75 + 0.35 * cell.id.y);
    d.tint = mix(vec3f(1.0), vec3f(0.0), leaf);
    d.add = c * leaf;
    d.height = leaf * 0.2;
    return d;
}

// chalk marks: a child's hopscotch, a sorcerer's warding circle drawn on the floor
fn detailChalk(p: vec3f, n: vec3f, center: vec2f, kind: f32, amount: f32) -> Detail {
    var d = detailNone();
    if (amount <= 0.0 || n.y < 0.8) {
        return d;
    }
    let q = p.xz - center;
    var m = 0.0;
    if (kind < 0.5) {
        let ring = sdStroke(sdCircle(q, 2.4), 0.03, 0.01) + sdStroke(sdCircle(q, 2.1), 0.02, 0.01);
        let a = atan2(q.y, q.x);
        let glyphs = sdFill(sdGlyph(vec2f(fract(a / TAU * 16.0) - 0.5, (length(q) - 2.25) * 6.0), floor(a / TAU * 16.0)), 0.02)
            * step(abs(length(q) - 2.25), 0.12);
        m = max(ring, glyphs);
    } else {
        let cells = sdBox2(fract(q * vec2f(1.0, 0.8)) - 0.5, vec2f(0.42));
        m = sdStroke(cells, 0.03, 0.01) * step(abs(q.x), 0.6) * step(abs(q.y), 3.5);
    }
    let dry = 0.6 + 0.4 * valueNoise2(p.xz * 60.0);
    d.add = vec3f(0.6) * m * dry * amount;
    return d;
}

// the layer a pattern id gets, with the stage's age and decoration amounts
fn detailFor(id: i32, p: vec3f, n: vec3f, ao: f32, seed: f32, age: f32, urban: f32, season: f32, litter: f32) -> Detail {
    var d = detailNone();
    switch id {
        case 1: {
            d = detailBrick(p, n, ao, age);
            let ps = detailPosters(p, n, seed, urban);
            d = Detail(d.tint * ps.tint, d.add + ps.add, d.height, d.gloss, d.emissive);
            let gr = detailGraffiti(p, n, seed, urban);
            d = Detail(d.tint * gr.tint, d.add + gr.add, d.height, d.gloss + gr.gloss, d.emissive);
        }
        case 10: {
            d = detailPlaster(p, n, ao, age);
            let ps = detailPosters(p, n, seed, urban * 0.5);
            d = Detail(d.tint * ps.tint, d.add + ps.add, d.height, d.gloss, d.emissive);
        }
        case 3, 9, 15: {
            d = detailWood(p, n, ao, age);
        }
        case 14, 6: {
            d = detailStone(p, n, ao, age);
        }
        case 11, 26: {
            d = detailMetal(p, n, age);
        }
        case 4, 5, 22: {
            d = detailConcrete(p, n, ao, age);
            let gr = detailGraffiti(p, n, seed, urban * 0.6);
            d = Detail(d.tint * gr.tint, d.add + gr.add, d.height, d.gloss + gr.gloss, d.emissive);
        }
        case 7: {
            d = detailMoss(p, n, ao, age * 0.8);
        }
        default: {
            d = detailNone();
        }
    }
    let lt = detailLitter(p, n, ao, season, litter);
    d = Detail(d.tint * lt.tint, d.add + lt.add, d.height + lt.height, d.gloss, d.emissive);
    return d;
}

fn detailApply(albedo: vec3f, d: Detail) -> vec3f {
    return max(albedo * d.tint + d.add, vec3f(0.0));
}
