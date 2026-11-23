// ============================================================================================
// vb_sdf3d: 3D signed distance primitives and operators for the raymarched domain worlds,
// volumetric VFX and procedural props. (Raymarch loops live in each shader: WGSL has no
// function pointers, so every scene writes its own map().)
// Depends on vb_common, vb_math.
// ============================================================================================

fn sdSphere(p: vec3f, r: f32) -> f32 {
    return length(p) - r;
}

fn sdBox3(p: vec3f, b: vec3f) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3f(0.0))) + min(maxc3(q), 0.0);
}

fn sdRoundBox3(p: vec3f, b: vec3f, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec3f(0.0))) + min(maxc3(q), 0.0) - r;
}

fn sdBoxFrame(p0: vec3f, b: vec3f, e: f32) -> f32 {
    let p = abs(p0) - b;
    let q = abs(p + e) - e;
    return min(min(
        length(max(vec3f(p.x, q.y, q.z), vec3f(0.0))) + min(max(p.x, max(q.y, q.z)), 0.0),
        length(max(vec3f(q.x, p.y, q.z), vec3f(0.0))) + min(max(q.x, max(p.y, q.z)), 0.0)),
        length(max(vec3f(q.x, q.y, p.z), vec3f(0.0))) + min(max(q.x, max(q.y, p.z)), 0.0));
}

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
    let q = vec2f(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

fn sdCappedTorus(p0: vec3f, sc: vec2f, ra: f32, rb: f32) -> f32 {
    let p = vec3f(abs(p0.x), p0.y, p0.z);
    let k = select(length(p.xy), dot(p.xy, sc), sc.y * p.x > sc.x * p.y);
    return sqrt(dot(p, p) + ra * ra - 2.0 * ra * k) - rb;
}

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

fn sdVerticalCapsule(p: vec3f, h: f32, r: f32) -> f32 {
    let q = vec3f(p.x, p.y - clamp(p.y, 0.0, h), p.z);
    return length(q) - r;
}

fn sdCylinderY(p: vec3f, h: f32, r: f32) -> f32 {
    let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn sdRoundCylinder(p: vec3f, ra: f32, rb: f32, h: f32) -> f32 {
    let d = vec2f(length(p.xz) - 2.0 * ra + rb, abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0))) - rb;
}

fn sdCappedCone(p: vec3f, h: f32, r1: f32, r2: f32) -> f32 {
    let q = vec2f(length(p.xz), p.y);
    let k1 = vec2f(r2, h);
    let k2 = vec2f(r2 - r1, 2.0 * h);
    let ca = vec2f(q.x - min(q.x, select(r2, r1, q.y < 0.0)), abs(q.y) - h);
    let cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
    let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
    return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

fn sdPlane(p: vec3f, n: vec3f, h: f32) -> f32 {
    return dot(p, n) + h;
}

fn sdOctahedron(p0: vec3f, s: f32) -> f32 {
    let p = abs(p0);
    return (p.x + p.y + p.z - s) * 0.57735027;
}

fn sdHexPrism(p0: vec3f, h: vec2f) -> f32 {
    let k = vec3f(-0.8660254, 0.5, 0.57735);
    var p = abs(p0);
    let xy = p.xy - 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
    let d = vec2f(length(xy - vec2f(clamp(xy.x, -k.z * h.x, k.z * h.x), h.x)) * sign(xy.y - h.x), p.z - h.y);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn sdTriPrism(p: vec3f, h: vec2f) -> f32 {
    let q = abs(p);
    return max(q.z - h.y, max(q.x * 0.866025 + p.y * 0.5, -p.y) - h.x * 0.5);
}

fn sdEllipsoid(p: vec3f, r: vec3f) -> f32 {
    let k0 = length(p / r);
    let k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

fn sdLink(p: vec3f, le: f32, r1: f32, r2: f32) -> f32 {
    let q = vec3f(p.x, max(abs(p.y) - le, 0.0), p.z);
    return length(vec2f(length(q.xy) - r1, q.z)) - r2;
}

// solid of revolution from a 2D distance (around Y)
fn opRevolve(p: vec3f, o: f32) -> vec2f {
    return vec2f(length(p.xz) - o, p.y);
}

fn opExtrude(d2: f32, z: f32, h: f32) -> f32 {
    let w = vec2f(d2, abs(z) - h);
    return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0)));
}

// --- operators -------------------------------------------------------------------------------------------------

fn opElongate(p: vec3f, h: vec3f) -> vec3f {
    return p - clamp(p, -h, h);
}

fn opTwistY(p: vec3f, k: f32) -> vec3f {
    let c = cos(k * p.y);
    let s = sin(k * p.y);
    return vec3f(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}

fn opBendX(p: vec3f, k: f32) -> vec3f {
    let c = cos(k * p.x);
    let s = sin(k * p.x);
    return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

fn opRepeat3(p: vec3f, cell: vec3f) -> vec3f {
    return p - cell * round(p / cell);
}

fn opRepeatLimited3(p: vec3f, cell: f32, lim: vec3f) -> vec3f {
    return p - cell * clamp(round(p / cell), -lim, lim);
}

// polar repetition around Y: n copies, returns the local point and copy index in w
fn opPolarRepeatY(p: vec3f, n: f32) -> vec4f {
    let an = TAU / n;
    let a = atan2(p.z, p.x) + an * 0.5;
    let idx = floor(a / an);
    let la = fmod1(a, an) - an * 0.5;
    let r = length(p.xz);
    return vec4f(cos(la) * r, p.y, sin(la) * r, idx);
}

fn opSmoothUnion3(a: f32, b: f32, k: f32) -> f32 { return sminPoly(a, b, k); }
fn opSmoothSub3(a: f32, b: f32, k: f32) -> f32 { return smaxPoly(a, -b, k); }

// union that also carries a material id: (distance, id)
fn opUnionId(a: vec2f, b: vec2f) -> vec2f {
    return select(b, a, a.x < b.x);
}

// --- composite shapes ---------------------------------------------------------------------------------------------

// a bronze temple bell (bonshō): y up, origin at the crown; height h
fn sdBonsho(p: vec3f, h: f32) -> f32 {
    let r = h * 0.36;
    let q = vec2f(length(p.xz), p.y);
    let t = clamp(-q.y / h, 0.0, 1.0);
    let rad = r * (0.86 + 0.14 * t) + r * 0.08 * smoothstep(0.92, 1.0, t);
    var d = max(q.x - rad, max(q.y, -q.y - h));
    // hollow inside, open at the mouth
    let cavity = max(q.x - (rad - h * 0.035), max(q.y + h * 0.1, -q.y - h - 0.01));
    d = max(d, -cavity);
    // horizontal bands and the striking boss
    let bands = abs(fmod1(q.y + h * 0.05, h * 0.25) - h * 0.125) - h * 0.008;
    d = min(d, max(q.x - rad - h * 0.012, bands));
    let crown = sdTorus(p - vec3f(0.0, h * 0.06, 0.0), vec2f(h * 0.07, h * 0.03));
    return min(d, crown);
}

// a paper lantern: ribbed barrel; y up, origin at the centre
fn sdChochin(p: vec3f, w: f32, h: f32) -> f32 {
    let q = vec2f(length(p.xz), p.y);
    let rib = 0.012 * w * cos(q.y / h * 40.0);
    let barrel = sdEllipsoid(vec3f(p.x, p.y * w / h, p.z), vec3f(w + rib)) * (h / w);
    let caps = sdCylinderY(vec3f(p.x, abs(p.y) - h * 0.98, p.z), h * 0.06, w * 0.5);
    return min(barrel, caps);
}

// a torii gate: y up, origin between the pillars on the ground
fn sdTorii3(p: vec3f, w: f32, h: f32) -> f32 {
    let q = vec3f(abs(p.x), p.y, p.z);
    let pillar = sdCappedCone(q - vec3f(w * 0.38, h * 0.45, 0.0), h * 0.45, w * 0.05, w * 0.042);
    let nuki = sdBox3(q - vec3f(0.0, h * 0.72, 0.0), vec3f(w * 0.5, h * 0.03, w * 0.025));
    let curve = 0.07 * h * pow(q.x / (w * 0.65), 2.0);
    let kasagi = sdBox3(q - vec3f(0.0, h * 0.93 + curve, 0.0), vec3f(w * 0.64, h * 0.045, w * 0.05));
    return min(min(pillar, nuki), kasagi);
}

// a stone lantern (tōrō)
fn sdToro(p: vec3f, s: f32) -> f32 {
    let base = sdRoundBox3(p - vec3f(0.0, 0.08 * s, 0.0), vec3f(0.3, 0.08, 0.3) * s, 0.02 * s);
    let post = sdCylinderY(p - vec3f(0.0, 0.5 * s, 0.0), 0.35 * s, 0.09 * s);
    let box = sdBox3(p - vec3f(0.0, 1.0 * s, 0.0), vec3f(0.22, 0.17, 0.22) * s);
    let roof = sdCappedCone(p - vec3f(0.0, 1.27 * s, 0.0), 0.1 * s, 0.4 * s, 0.08 * s);
    let knob = sdSphere(p - vec3f(0.0, 1.42 * s, 0.0), 0.07 * s);
    let window = sdBox3(p - vec3f(0.0, 1.0 * s, 0.0), vec3f(0.3, 0.09, 0.1) * s);
    return min(min(min(base, post), max(box, -window)), min(roof, knob));
}
