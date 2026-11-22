// Domain clash (vbClash): two domains opened at once push against each other. The frame is drawn
// twice on alternate frames, once inside each domain (src/render/PostChain.ts keeps the newest of
// each); this pass splits the screen between them along a seam that bulges toward whoever is
// losing, and makes the seam a place where space is breaking:
//
//   field      which domain a pixel belongs to: the difference of its distances to the two
//              casters, pushed by the balance of power and torn by turbulence into fingers
//   pressure   each side is pushed away from the seam (its image bends outward)
//   seam       a white-hot core, each domain's colour burning along its own side, sparks
//   lightning  arcs crawling along the seam and leaping into both domains
//   cracks     space fracturing out from the seam, the other domain showing through the cracks
//   pulses     shock rings when the balance swings

struct ClashField {
    f: f32,          // < 0 domain A, > 0 domain B (screen units)
    along: f32,      // position along the seam
    normal: vec2f,   // from A toward B
}

fn clashFieldAt(uv: vec2f, a: vec2f, b: vec2f, aspect: f32, balance: f32, time: f32, seed: f32) -> ClashField {
    var c: ClashField;
    let p = vec2f(uv.x * aspect, uv.y);
    let pa = vec2f(a.x * aspect, a.y);
    let pb = vec2f(b.x * aspect, b.y);
    let axis = normalize(pb - pa + vec2f(1e-4, 0.0));
    let perp = vec2f(-axis.y, axis.x);
    c.normal = axis;
    c.along = dot(p - (pa + pb) * 0.5, perp);
    // the plain split: equal distance to both, moved toward the weaker side
    var f = (length(p - pa) - length(p - pb)) * 0.5 + balance * 0.25;
    // fingers of each domain reaching into the other, and a slow churn
    let fingers = sin(c.along * 18.0 + time * 3.0 + seed * 6.0) * 0.012 + sin(c.along * 41.0 - time * 5.0) * 0.006;
    let churn = (vfbm2(vec2f(c.along * 4.0, time * 0.6 + seed), 4) - 0.5) * 0.07;
    f = f + fingers + churn;
    c.f = f;
    return c;
}

// arcs of lightning crawling along the seam, jumping every few frames, with forks into both sides
fn clashLightning(along: f32, f: f32, time: f32, seed: f32) -> vec2f {
    let st = floor(time * 18.0);
    var core = 0.0;
    var glow = 0.0;
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let off = (valueNoise2(vec2f(along * 22.0 + fi * 5.0, st + fi * 3.0 + seed)) - 0.5) * 0.05 * (1.0 + fi * 0.6);
        let jag = (valueNoise2(vec2f(along * 90.0, st * 1.3 + fi)) - 0.5) * 0.008;
        let d = abs(f - off - jag);
        core = max(core, 1.0 - smoothstep(0.0012, 0.0028, d));
        glow = max(glow, (1.0 - smoothstep(0.0, 0.03, d)) * 0.7);
    }
    // forks: short bolts leaving the seam at random places
    let cell = floor(along * 9.0 + seed);
    let h = hash12(vec2f(cell, st));
    if (h > 0.6) {
        let x = fract(along * 9.0 + seed) - 0.5;
        let dirSide = select(-1.0, 1.0, h > 0.8);
        let reach = 0.04 + h * 0.08;
        let t = clamp(f * dirSide / reach, 0.0, 1.0);
        let wob = (valueNoise2(vec2f(t * 8.0, cell + st)) - 0.5) * 0.25;
        let d = abs(x - wob * t) * step(0.0, f * dirSide) * step(f * dirSide, reach);
        core = max(core, (1.0 - smoothstep(0.004, 0.009, d)) * (1.0 - t) * step(0.0, f * dirSide));
    }
    return vec2f(core, glow);
}

// cracks in space running out from the seam: through them the other domain shows
fn clashCracks(uv: vec2f, f: f32, aspect: f32, seed: f32, spread: f32) -> f32 {
    let p = vec2f(uv.x * aspect, uv.y);
    let w = worley2(p * 7.0 + seed * 5.0, 1.0);
    let line = 1.0 - smoothstep(0.0, 0.012, w.edge);
    // only near the seam, more as the clash goes on
    let near = 1.0 - smoothstep(0.0, 0.05 + spread * 0.2, abs(f));
    return line * near * step(0.35, w.id.x);
}

// shock rings from where the seam is pushed hardest
fn clashPulse(uv: vec2f, center: vec2f, aspect: f32, t: f32) -> f32 {
    let d = length(vec2f((uv.x - center.x) * aspect, uv.y - center.y));
    let r = fract(t) * 0.6;
    return (1.0 - smoothstep(0.0, 0.01, abs(d - r))) * (1.0 - fract(t));
}

// the colour where the two domains meet: a white-hot core, each palette burning on its own side
fn clashSeamColor(f: f32, colA: vec3f, colB: vec3f, width: f32) -> vec4f {
    let d = abs(f);
    let core = 1.0 - smoothstep(width * 0.2, width * 0.5, d);
    let burn = 1.0 - smoothstep(width * 0.5, width * 3.0, d);
    let side = select(colA, colB, f > 0.0);
    let c = side * burn * 2.2 + vec3f(1.0, 0.97, 0.92) * core * 2.5;
    return vec4f(c, max(core, burn * 0.6));
}

// sparks thrown off the seam, drifting into either domain and fading
fn clashSparks(along: f32, f: f32, time: f32, seed: f32) -> f32 {
    var s = 0.0;
    for (var i = 0; i < 2; i++) {
        let fi = f32(i);
        let cellA = floor(along * 40.0 + fi * 0.5);
        let h = hash22(vec2f(cellA, seed + fi));
        let life = fract(time * (0.8 + h.x) + h.y);
        let side = select(-1.0, 1.0, h.x > 0.5);
        let pos = side * life * (0.04 + h.y * 0.06);
        let x = fract(along * 40.0 + fi * 0.5) - 0.5;
        let d = length(vec2f(x * 0.025, f - pos));
        s = max(s, (1.0 - smoothstep(0.0008, 0.002, d)) * (1.0 - life));
    }
    return s;
}
