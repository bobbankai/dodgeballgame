// World transformations (env.fragment): what a fighter's nature does to the place around them.
// One at a time, centred on a point, reaching out to a radius behind a ragged front:
//
//   1 paper      Shiragami's folds: everything becomes white washi folded into facets, each facet lit
//                its own way, ink along the creases, the front of it a crisp folding edge
//   2 stillness  Mikami's Still Point: the ground goes glassy and black like still water, the sky
//                in it, slow rings spreading, dust hanging motionless in the air above it, a thin
//                silver line where it ends
//   3 spark      after a Black Spark: black lightning crawling over every surface near the blow,
//                crimson round its forks, dying away
//
// Uniforms: envTransform (kind, amount 0..1, radius, seed), envTransformPos (centre xyz, time it began)

struct WorldXform {
    albedo: vec3f,
    n: vec3f,
    gloss: f32,
    emissive: vec3f,
    flatLight: f32,     // 1 = lit flat (paper facets carry their own light)
}

// how far inside the transformed region a point is (0 outside .. 1 well inside), ragged
fn xformReach(p: vec3f, centre: vec3f, radius: f32, amount: f32, seed: f32) -> f32 {
    let d = distance(p.xz, centre.xz);
    let ang = atan2(p.z - centre.z, p.x - centre.x);
    let rag = (valueNoise2(vec2f(ang * 3.0 + seed * 7.0, seed)) - 0.5) * radius * 0.25 + (valueNoise3(p * 1.5) - 0.5) * 0.8;
    let r = radius * amount + rag * amount;
    return 1.0 - smoothstep(r - 0.6, r, d);
}

// --- paper ------------------------------------------------------------------------------------------------

fn xformPaper(albedo0: vec3f, n0: vec3f, p: vec3f, reach: f32, l: vec3f, seed: f32) -> WorldXform {
    var o: WorldXform;
    o.albedo = albedo0;
    o.n = n0;
    o.gloss = 0.0;
    o.emissive = vec3f(0.0);
    o.flatLight = 0.0;
    if (reach <= 0.0) {
        return o;
    }
    // facets: Voronoi cells in the surface's own plane (triplanar by the dominant axis)
    let an = abs(n0);
    var q = p.xz;
    if (an.x > an.y && an.x > an.z) {
        q = p.zy;
    } else if (an.z > an.y) {
        q = p.xy;
    }
    let w = worley2(q * 1.3 + seed * 5.0, 0.9);
    // each facet is tilted its own way: two tones from its tilt toward the light
    let tilt = normalize(vec3f(w.id.x - 0.5, 1.2, w.id.y - 0.5));
    let facetLight = select(0.82, 1.0, dot(tilt, normalize(l + vec3f(0.0, 0.5, 0.0))) > 0.8);
    let fibre = valueNoise2(q * vec2f(40.0, 3.0) + seed) * valueNoise2(q * vec2f(3.0, 40.0) + seed * 2.0);
    let washi = vec3f(0.97, 0.95, 0.9) * (0.94 + fibre * 0.1) * facetLight;
    // creases: the facets' edges, inked
    let crease = 1.0 - smoothstep(0.0, 0.035, w.edge);
    let paper = mix(washi, vec3f(0.18, 0.16, 0.2), crease * 0.85);
    // a faint print of what the surface was, as if the paper had been laid over it
    let ghost = mix(paper, paper * (0.85 + 0.15 * normalize(albedo0 + vec3f(0.01))), 0.35);
    o.albedo = mix(albedo0, ghost, reach);
    o.flatLight = reach * 0.7;
    // the folding front: a white edge with a soft shadow just inside it
    let front = reach * (1.0 - reach) * 4.0;
    o.emissive = vec3f(0.9, 0.88, 0.85) * smoothstep(0.7, 1.0, front) * 0.15;
    return o;
}

// --- stillness ------------------------------------------------------------------------------------------------

fn xformStill(albedo0: vec3f, n0: vec3f, p: vec3f, centre: vec3f, reach: f32, time: f32, elapsed: f32, sky: vec3f) -> WorldXform {
    var o: WorldXform;
    o.albedo = albedo0;
    o.n = n0;
    o.gloss = 0.0;
    o.emissive = vec3f(0.0);
    o.flatLight = 0.0;
    if (reach <= 0.0) {
        return o;
    }
    let floorish = smoothstep(0.6, 0.9, n0.y);
    // the ground goes black and glassy, holding the sky
    let still = mix(albedo0 * 0.25 + vec3f(0.01, 0.015, 0.03), albedo0 * 0.6, 1.0 - floorish);
    o.albedo = mix(albedo0, still, reach);
    o.gloss = reach * mix(0.35, 0.95, floorish);
    // slow rings spreading from the centre across the glass
    let d = distance(p.xz, centre.xz);
    let ring = sin(d * 4.0 - elapsed * 1.5) * exp(-d * 0.15);
    o.n = normalize(n0 + vec3f((p.x - centre.x) / max(d, 0.1), 0.0, (p.z - centre.z) / max(d, 0.1)) * ring * 0.03 * floorish * reach);
    // where it ends: a thin silver line
    let edge = reach * (1.0 - reach) * 4.0;
    o.emissive = vec3f(0.75, 0.82, 0.9) * smoothstep(0.85, 1.0, edge) * 0.6 + sky * 0.1 * floorish * reach;
    return o;
}

// --- spark ----------------------------------------------------------------------------------------------------

fn xformSpark(p: vec3f, centre: vec3f, radius: f32, amount: f32, time: f32, seed: f32) -> vec3f {
    if (amount <= 0.0) {
        return vec3f(0.0);
    }
    let d = distance(p, centre);
    if (d > radius) {
        return vec3f(0.0);
    }
    // veins of lightning: ridged noise thresholded thin, jumping a dozen times a second
    let st = floor(time * 12.0);
    let n = abs(valueNoise3(p * 2.2 + vec3f(st * 0.37, seed, 0.0)) - 0.5) * 2.0;
    let n2 = abs(valueNoise3(p * 5.1 - vec3f(0.0, st * 0.21, seed)) - 0.5) * 2.0;
    let vein = (1.0 - smoothstep(0.0, 0.06, n)) * 0.8 + (1.0 - smoothstep(0.0, 0.04, n2)) * 0.5;
    let fall = 1.0 - smoothstep(radius * 0.3, radius, d);
    // black in the core, crimson round it
    let core = smoothstep(0.6, 0.9, vein);
    return (vec3f(1.0, 0.05, 0.1) * vein * 2.0 - vec3f(1.5) * core) * fall * amount;
}

fn worldXform(kind: i32, albedo: vec3f, n: vec3f, p: vec3f, centre: vec3f, radius: f32, amount: f32, seed: f32, time: f32, elapsed: f32,
              l: vec3f, sky: vec3f) -> WorldXform {
    var o: WorldXform;
    o.albedo = albedo;
    o.n = n;
    o.gloss = 0.0;
    o.emissive = vec3f(0.0);
    o.flatLight = 0.0;
    if (kind <= 0 || amount <= 0.0) {
        return o;
    }
    switch kind {
        case 1: {
            o = xformPaper(albedo, n, p, xformReach(p, centre, radius, amount, seed), l, seed);
        }
        case 2: {
            o = xformStill(albedo, n, p, centre, xformReach(p, centre, radius, amount, seed), time, elapsed, sky);
        }
        case 3: {
            o.emissive = xformSpark(p, centre, radius, amount, time, seed);
        }
        default: {
        }
    }
    return o;
}
