// ============================================================================================
// vb_sdf2d: exact 2D signed distance functions (after Inigo Quilez) and boolean / domain ops.
// Used for VFX sprites (starbursts, rings, seals, cranes), the HUD-in-world glyphs, the domain
// skies' painted silhouettes and the procedural patterns.
// Depends on vb_common, vb_math.
// ============================================================================================

fn sdCircle(p: vec2f, r: f32) -> f32 {
    return length(p) - r;
}

fn sdBox2(p: vec2f, b: vec2f) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sdRoundBox2(p: vec2f, b: vec2f, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
}

fn sdSegment2(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// a stroke with tapered ends, like a brush mark: width w0 at a, w1 at b
fn sdTaperedSegment2(p: vec2f, a: vec2f, b: vec2f, w0: f32, w1: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - mix(w0, w1, h);
}

fn sdEquilateralTriangle(p0: vec2f, r: f32) -> f32 {
    let k = SQRT3;
    var p = vec2f(abs(p0.x) - r, p0.y + r / k);
    if (p.x + k * p.y > 0.0) {
        p = vec2f(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    }
    p.x = p.x - clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

fn sdTriangle2(p: vec2f, p0: vec2f, p1: vec2f, p2: vec2f) -> f32 {
    let e0 = p1 - p0;
    let e1 = p2 - p1;
    let e2 = p0 - p2;
    let v0 = p - p0;
    let v1 = p - p1;
    let v2 = p - p2;
    let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    let s = sign(e0.x * e2.y - e0.y * e2.x);
    let d0 = vec2f(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x));
    let d1 = vec2f(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x));
    let d2 = vec2f(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x));
    let d = min(min(d0, d1), d2);
    return -sqrt(d.x) * sign(d.y);
}

fn sdRhombus(p0: vec2f, b: vec2f) -> f32 {
    let p = abs(p0);
    let ndot = b.x * (b.x - 2.0 * p.x) - b.y * (b.y - 2.0 * p.y);
    let h = clamp(ndot / dot(b, b), -1.0, 1.0);
    let d = length(p - 0.5 * b * vec2f(1.0 - h, 1.0 + h));
    return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}

fn sdHexagon(p0: vec2f, r: f32) -> f32 {
    let k = vec3f(-0.866025404, 0.5, 0.577350269);
    var p = abs(p0);
    p = p - 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p = p - vec2f(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}

fn sdOctagon(p0: vec2f, r: f32) -> f32 {
    let k = vec3f(-0.9238795325, 0.3826834323, 0.4142135623);
    var p = abs(p0);
    p = p - 2.0 * min(dot(vec2f(k.x, k.y), p), 0.0) * vec2f(k.x, k.y);
    p = p - 2.0 * min(dot(vec2f(-k.x, k.y), p), 0.0) * vec2f(-k.x, k.y);
    p = p - vec2f(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}

// n-pointed star, m in [2, n] sets how pointy the spikes are
fn sdStar(p0: vec2f, r: f32, n: f32, m: f32) -> f32 {
    let an = PI / n;
    let en = PI / m;
    let acs = vec2f(cos(an), sin(an));
    let ecs = vec2f(cos(en), sin(en));
    let bn = fmod1(atan2(p0.x, p0.y), 2.0 * an) - an;
    var p = length(p0) * vec2f(cos(bn), abs(sin(bn)));
    p = p - r * acs;
    p = p + ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
}

// irregular comic starburst: spikes of random lengths (hit sparks, "impact" flashes)
fn sdStarburst(p: vec2f, r: f32, spikes: f32, jag: f32, seed: f32) -> f32 {
    let a = atan2(p.y, p.x);
    let sector = floor((a + PI) / TAU * spikes);
    let local = fract((a + PI) / TAU * spikes);
    let len = r * (1.0 + jag * (hash11(sector + seed) - 0.3));
    let shape = mix(r * 0.55, len, 1.0 - abs(local * 2.0 - 1.0));
    return length(p) - shape;
}

fn sdRing(p: vec2f, r: f32, w: f32) -> f32 {
    return abs(length(p) - r) - w;
}

// arc of angular half-aperture `ap` around +y, radius ra, thickness rb
fn sdArc(p0: vec2f, ap: f32, ra: f32, rb: f32) -> f32 {
    let sc = vec2f(sin(ap), cos(ap));
    let p = vec2f(abs(p0.x), p0.y);
    let k = select(length(p), dot(p, vec2f(sc.x, sc.y)), sc.y * p.x > sc.x * p.y);
    _ = k;
    if (sc.y * p.x > sc.x * p.y) {
        return length(p - sc * ra) - rb;
    }
    return abs(length(p) - ra) - rb;
}

fn sdPie(p0: vec2f, ap: f32, r: f32) -> f32 {
    let c = vec2f(sin(ap), cos(ap));
    let p = vec2f(abs(p0.x), p0.y);
    let l = length(p) - r;
    let m = length(p - c * clamp(dot(p, c), 0.0, r));
    return max(l, m * sign(c.y * p.x - c.x * p.y));
}

fn sdVesica(p0: vec2f, r: f32, d: f32) -> f32 {
    let p = abs(p0);
    let b = sqrt(r * r - d * d);
    if ((p.y - b) * d > p.x * b) {
        return length(p - vec2f(0.0, b));
    }
    return length(p - vec2f(-d, 0.0)) - r;
}

fn sdMoon(p0: vec2f, d: f32, ra: f32, rb: f32) -> f32 {
    let p = vec2f(p0.x, abs(p0.y));
    let a = (ra * ra - rb * rb + d * d) / (2.0 * d);
    let b = sqrt(max(ra * ra - a * a, 0.0));
    if (d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.0)) {
        return length(p - vec2f(a, b));
    }
    return max(length(p) - ra, -(length(p - vec2f(d, 0.0)) - rb));
}

fn sdHeart(p0: vec2f) -> f32 {
    let p = vec2f(abs(p0.x), p0.y);
    if (p.y + p.x > 1.0) {
        return sqrt(dot(p - vec2f(0.25, 0.75), p - vec2f(0.25, 0.75))) - SQRT2 / 4.0;
    }
    let a = dot(p - vec2f(0.0, 1.0), p - vec2f(0.0, 1.0));
    let mx = 0.5 * max(p.x + p.y, 0.0);
    let b = dot(p - vec2f(mx), p - vec2f(mx));
    return sqrt(min(a, b)) * sign(p.x - p.y);
}

fn sdCross(p0: vec2f, b: vec2f, r: f32) -> f32 {
    var p = abs(p0);
    if (p.y > p.x) {
        p = p.yx;
    }
    let q = p - b;
    let k = max(q.y, q.x);
    let w = select(vec2f(b.y - p.x, -k), q, k > 0.0);
    return sign(k) * length(max(w, vec2f(0.0))) + r;
}

fn sdRoundedX(p0: vec2f, w: f32, r: f32) -> f32 {
    let p = abs(p0);
    return length(p - min(p.x + p.y, w) * 0.5) - r;
}

fn sdEllipseApprox(p: vec2f, ab: vec2f) -> f32 {
    let k0 = length(p / ab);
    let k1 = length(p / (ab * ab));
    return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

fn sdParallelogram(p0: vec2f, wi: f32, he: f32, sk: f32) -> f32 {
    let e = vec2f(sk, he);
    var p = select(p0, -p0, p0.y < 0.0);
    var w = p - e;
    w.x = w.x - clamp(w.x, -wi, wi);
    var d = vec2f(dot(w, w), -w.y);
    let s = p.x * e.y - p.y * e.x;
    p = select(p, -p, s < 0.0);
    var v = p - vec2f(wi, 0.0);
    v = v - e * clamp(dot(v, e) / dot(e, e), -1.0, 1.0);
    d = min(d, vec2f(dot(v, v), wi * he - abs(s)));
    return sqrt(d.x) * sign(-d.y);
}

// --- boolean and shaping ops -------------------------------------------------------------------------

fn opUnion(a: f32, b: f32) -> f32 { return min(a, b); }
fn opSubtract(a: f32, b: f32) -> f32 { return max(a, -b); }
fn opIntersect(a: f32, b: f32) -> f32 { return max(a, b); }
fn opXor(a: f32, b: f32) -> f32 { return max(min(a, b), -max(a, b)); }
fn opSmoothUnion(a: f32, b: f32, k: f32) -> f32 { return sminPoly(a, b, k); }
fn opSmoothSubtract(a: f32, b: f32, k: f32) -> f32 { return smaxPoly(a, -b, k); }
fn opSmoothIntersect(a: f32, b: f32, k: f32) -> f32 { return smaxPoly(a, b, k); }
fn opRound(d: f32, r: f32) -> f32 { return d - r; }
fn opOnion(d: f32, t: f32) -> f32 { return abs(d) - t; }

fn opRepeat2(p: vec2f, cell: vec2f) -> vec2f {
    return p - cell * round(p / cell);
}

fn opRepeatLimited2(p: vec2f, cell: f32, lim: vec2f) -> vec2f {
    return p - cell * clamp(round(p / cell), -lim, lim);
}

// fold the plane into n wedges around the origin (returns the local point and the wedge index)
fn opPolarRepeat(p: vec2f, n: f32) -> vec3f {
    let an = TAU / n;
    let a = atan2(p.y, p.x) + an * 0.5;
    let idx = floor(a / an);
    let la = fmod1(a, an) - an * 0.5;
    let r = length(p);
    return vec3f(cos(la) * r, sin(la) * r, idx);
}

fn opMirrorX(p: vec2f) -> vec2f { return vec2f(abs(p.x), p.y); }

// --- rendering distances to coverage ------------------------------------------------------------------------

// antialiased fill from a distance, given the distance's pixel footprint
fn sdFill(d: f32, px: f32) -> f32 {
    return clamp(0.5 - d / max(px, 1e-6), 0.0, 1.0);
}

fn sdStroke(d: f32, width: f32, px: f32) -> f32 {
    return clamp(0.5 - (abs(d) - width) / max(px, 1e-6), 0.0, 1.0);
}

fn sdGlow(d: f32, radius: f32, falloff: f32) -> f32 {
    return pow(clamp(1.0 - max(d, 0.0) / radius, 0.0, 1.0), falloff);
}

// --- composite shapes used by the game ------------------------------------------------------------------------

// a temple bell silhouette (domain skies, Itsuki's seal): y up, mouth at y = -h
fn sdBellShape(p0: vec2f, w: f32, h: f32) -> f32 {
    let p = vec2f(abs(p0.x), p0.y);
    // profile flares from the crown down to the lip
    let t = clamp((h - p.y) / (2.0 * h), 0.0, 1.0);
    let rad = w * (0.55 + 0.45 * pow(t, 2.2)) + w * 0.12 * smoothstep(0.9, 1.0, t);
    let body = max(p.x - rad, abs(p.y) - h);
    let crown = sdRoundBox2(p - vec2f(0.0, h + w * 0.12), vec2f(w * 0.2, w * 0.14), w * 0.06);
    let lip = sdRoundBox2(p - vec2f(0.0, -h), vec2f(w * 1.08, w * 0.06), w * 0.04);
    return min(min(body, crown), lip);
}

// an origami crane seen from the side, as polygons (Sayo's talismans, the paper garden)
fn sdCraneShape(p: vec2f, s: f32) -> f32 {
    let q = p / s;
    let body = sdTriangle2(q, vec2f(-0.35, 0.0), vec2f(0.35, 0.0), vec2f(0.0, -0.22));
    let wing = sdTriangle2(q, vec2f(-0.15, 0.0), vec2f(0.25, 0.0), vec2f(-0.05, 0.7));
    let neck = sdTriangle2(q, vec2f(0.25, -0.02), vec2f(0.35, 0.0), vec2f(0.62, 0.42));
    let head = sdTriangle2(q, vec2f(0.58, 0.38), vec2f(0.64, 0.44), vec2f(0.74, 0.36));
    let tail = sdTriangle2(q, vec2f(-0.3, -0.02), vec2f(-0.2, 0.0), vec2f(-0.62, 0.36));
    return min(min(min(body, wing), min(neck, head)), tail) * s;
}

// a paper lantern (chōchin) silhouette: ribbed barrel with caps
fn sdLanternShape(p: vec2f, w: f32, h: f32) -> f32 {
    let q = vec2f(abs(p.x), p.y);
    let barrel = sdEllipseApprox(q, vec2f(w, h));
    let caps = sdBox2(vec2f(q.x, abs(q.y) - h * 0.95), vec2f(w * 0.55, h * 0.08));
    return min(barrel, caps);
}

// a torii gate silhouette, origin at the ground between the pillars
fn sdToriiShape(p: vec2f, w: f32, h: f32) -> f32 {
    let q = vec2f(abs(p.x), p.y);
    let pillar = sdBox2(q - vec2f(w * 0.38, h * 0.45), vec2f(w * 0.045, h * 0.45));
    let nuki = sdBox2(q - vec2f(0.0, h * 0.72), vec2f(w * 0.48, h * 0.035));
    let bow = q.y - (h * 0.9 + 0.06 * h * pow(q.x / (w * 0.6), 2.0));
    let kasagi = max(sdBox2(q - vec2f(0.0, h * 0.93), vec2f(w * 0.62, h * 0.06)), -bow - h * 0.08);
    let gakuzuka = sdBox2(q - vec2f(0.0, h * 0.8), vec2f(w * 0.03, h * 0.07));
    return min(min(pillar, nuki), min(kasagi, gakuzuka));
}

// a procedural "seal glyph": a few brush strokes in a box, seeded (fake kanji for talismans and seals)
fn sdGlyph(p: vec2f, seed: f32) -> f32 {
    var d = 1e9;
    for (var i = 0; i < 6; i++) {
        let h = hash31(seed * 7.13 + f32(i) * 1.71);
        let h2 = hash31(seed * 3.37 + f32(i) * 2.93 + 11.0);
        // strokes snap to a 4x4 grid so they read as writing, not scribbles
        let a = floor(h.xy * 4.0) / 3.0 - 0.5;
        var b = floor(h2.xy * 4.0) / 3.0 - 0.5;
        if (h.z > 0.5) {
            b = vec2f(a.x, b.y);
        } else {
            b = vec2f(b.x, a.y);
        }
        d = min(d, sdTaperedSegment2(p, a * 0.8, b * 0.8, 0.07, 0.04));
    }
    return d;
}
