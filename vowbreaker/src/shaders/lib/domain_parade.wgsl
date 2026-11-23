// Domain 3: Night Parade Without End (Sōjin).
//
// The old monk spent forty years walking behind the hyakki yagyō, the night parade of a hundred
// demons, praying for each one. His domain puts the enemy in the parade's path. An avenue of torii
// runs to the horizon both ways, lanterns strung between them; the procession files past on both
// sides, always walking, never arriving: one-legged umbrella spirits hopping, paper lanterns with
// split mouths, tall-hatted figures in noh masks, horned oni. The sky bleeds red round a black sun
// with a thin burning ring.
//
// materials: 1 torii vermilion, 2 torii black, 3 lantern (lit), 4 stone path, 5 yokai body (ink),
//            6 mask (bone white), 7 umbrella paper (red/white), 8 flame eye

// one walker of the parade, kind 0..3, in its own frame (feet at y = 0, walking along +z)
fn paradeWalker(q: vec3f, kind: i32, t: f32, seed: f32) -> vec2f {
    let bob = abs(sin(t * 2.2 + seed * 6.0)) * 0.25;
    switch kind {
        case 0: {
            // kasa-obake: an umbrella on one leg, hopping, one eye, a long tongue
            let hop = abs(sin(t * 3.0 + seed * 5.0)) * 0.9;
            let u = q - vec3f(0.0, 2.2 + hop, 0.0);
            let canopy = max(sdCappedCone(u, 0.8, 1.4, 0.05), -(sdCappedCone(u - vec3f(0.0, -0.12, 0.0), 0.8, 1.3, 0.02)));
            let leg = sdCapsule(q, vec3f(0.0, hop, 0.0), vec3f(0.0, 1.5 + hop, 0.0), 0.09);
            var r = vec2f(canopy, 7.0);
            r = opUnionId(r, vec2f(leg, 5.0));
            let eye = sdSphere(u - vec3f(0.0, 0.1, 0.62), 0.16);
            r = opUnionId(r, vec2f(eye, 8.0));
            return r;
        }
        case 1: {
            // chōchin-obake: a paper lantern with a split mouth and a lolling tongue
            let l = q - vec3f(0.0, 2.0 + bob, 0.0);
            let lantern = sdChochin(l, 0.7, 0.95);
            let mouth = sdBox3(l - vec3f(0.0, -0.15, 0.6), vec3f(0.45, 0.08, 0.3));
            var r = vec2f(max(lantern, -mouth), 3.0);
            let eye = sdSphere(l - vec3f(0.25, 0.3, 0.62), 0.11);
            r = opUnionId(r, vec2f(eye, 8.0));
            return r;
        }
        case 2: {
            // a tall-hatted walker in a noh mask, robes to the ground
            let robe = sdCappedCone(q - vec3f(0.0, 1.1 + bob * 0.3, 0.0), 1.1, 0.75, 0.28);
            let head = sdEllipsoid(q - vec3f(0.0, 2.45 + bob * 0.3, 0.0), vec3f(0.26, 0.32, 0.26));
            let hat = sdCappedCone(q - vec3f(0.0, 3.15 + bob * 0.3, 0.0), 0.45, 0.22, 0.12);
            let mask = sdEllipsoid(q - vec3f(0.0, 2.45 + bob * 0.3, 0.12), vec3f(0.24, 0.3, 0.16));
            var r = vec2f(min(robe, min(head, hat)), 5.0);
            r = opUnionId(r, vec2f(mask, 6.0));
            return r;
        }
        default: {
            // an oni: broad, horned, a club over the shoulder
            let body = sdEllipsoid(q - vec3f(0.0, 1.7 + bob * 0.5, 0.0), vec3f(0.85, 1.2, 0.6));
            let head = sdSphere(q - vec3f(0.0, 3.05 + bob * 0.5, 0.1), 0.45);
            let qh = vec3f(abs(q.x), q.y, q.z);
            let horn = sdCappedCone(qh - vec3f(0.22, 3.55 + bob * 0.5, 0.05), 0.25, 0.1, 0.01);
            let club = sdCapsule(q, vec3f(0.7, 2.5 + bob * 0.5, -0.2), vec3f(1.2, 4.2 + bob * 0.5, -0.8), 0.18);
            var r = vec2f(min(min(body, head), club), 5.0);
            r = opUnionId(r, vec2f(horn, 6.0));
            return r;
        }
    }
}

fn mapParadeWorld(p: vec3f, t: f32) -> vec2f {
    var res = vec2f(p.y + 0.15, 4.0);
    let ax = abs(p.x);
    // past the procession there is only the dark ground
    if (ax > 32.0) {
        return opUnionId(res, vec2f(ax - 31.0, 0.0));
    }
    // the avenue of torii along z (endless): 26 m wide, every 10 m, drifting toward the viewer
    let rep = 10.0;
    let z = fmod1(p.z + t * 1.2, rep) - rep * 0.5;
    let q = vec3f(p.x, p.y, z);
    let torii = sdTorii3(q, 34.0, 14.0);
    let top = step(12.0, p.y);
    res = opUnionId(res, vec2f(torii, select(1.0, 2.0, top > 0.5)));
    // lanterns strung on ropes between the torii, both sides of the avenue
    let side = vec3f(abs(q.x) - 15.5, q.y, q.z);
    let lz = fmod1(z + rep * 0.25, rep * 0.5) - rep * 0.25;
    let sag = 0.35 * (1.0 - sqr(lz / (rep * 0.25)));
    let lantern = sdChochin(vec3f(side.x, q.y - 9.0 + sag, lz), 0.55, 0.75);
    res = opUnionId(res, vec2f(lantern, 3.0));
    // the procession: two files walking toward the camera's far side, both directions
    let walkZ = p.z - t * 1.6 * sign(p.x);
    let wz = fmod1(walkZ, 4.5) - 2.25;
    let wid = floor(walkZ / 4.5) + select(0.0, 1000.0, p.x > 0.0);
    let wh = hash11(wid);
    let wq = vec3f(abs(p.x) - 19.0 - wh * 4.0, p.y, wz);
    let kind = i32(floor(wh * 4.0));
    if (abs(p.x) > 14.0 && abs(p.x) < 30.0) {
        let walker = paradeWalker(wq, kind, t, wh);
        res = opUnionId(res, walker);
    }
    return res;
}

fn surfParade(mat: i32, p: vec3f, n: vec3f, t: f32) -> DomainSurface {
    switch mat {
        case 1: {
            var s = domainSurface(vec3f(0.78, 0.12, 0.06));
            s.rim = 1.2;
            return s;
        }
        case 2: {
            return domainSurface(vec3f(0.05, 0.04, 0.05));
        }
        case 3: {
            var s = domainSurface(vec3f(1.0, 0.6, 0.3));
            let ribs = 0.85 + 0.15 * step(0.5, fract(p.y * 6.0));
            let flick = 0.85 + 0.15 * valueNoise2(vec2f(t * 7.0, floor(p.z)));
            s.emissive = vec3f(2.6, 0.9, 0.3) * ribs * flick;
            s.unlit = 0.6;
            return s;
        }
        case 4: {
            let slabs = step(0.04, fract(p.x * 0.4)) * step(0.04, fract(p.z * 0.4 + floor(p.x * 0.4) * 0.5));
            return domainSurface(mix(vec3f(0.05, 0.03, 0.03), vec3f(0.22, 0.12, 0.1), slabs));
        }
        case 5: {
            // the walkers are ink: nearly black, with a red rim from the sky
            var s = domainSurface(vec3f(0.04, 0.03, 0.04));
            s.rim = 2.0;
            return s;
        }
        case 6: {
            var s = domainSurface(vec3f(0.92, 0.88, 0.8));
            s.rim = 0.8;
            return s;
        }
        case 7: {
            let stripe = step(0.5, fract(atan2(p.z, p.x) * 1.9));
            return domainSurface(mix(vec3f(0.85, 0.14, 0.1), vec3f(0.95, 0.92, 0.86), stripe));
        }
        default: {
            var s = domainSurface(vec3f(1.0, 0.9, 0.3));
            s.emissive = vec3f(3.0, 2.0, 0.6);
            s.unlit = 1.0;
            return s;
        }
    }
}

fn skyParade(d: vec3f, t: f32) -> vec3f {
    let up = clamp(d.y, -0.2, 1.0);
    var c = mix(vec3f(0.95, 0.14, 0.06), vec3f(0.07, 0.0, 0.02), pow(max(up, 0.0), 0.5));
    // bleeding clouds: warped bands of red and black
    let sp = d.xz / max(d.y + 0.25, 0.08);
    let w = warpedFbm2(sp * 0.25, t * 0.15);
    c = c * (0.6 + 0.6 * smoothstep(-0.2, 0.5, w));
    let blackBand = smoothstep(0.25, 0.4, w) * (1.0 - smoothstep(0.4, 0.55, w));
    c = mix(c, vec3f(0.03, 0.0, 0.01), blackBand * 0.6 * smoothstep(0.05, 0.3, d.y));
    // the black sun with its burning ring
    let sunDir = normalize(vec3f(0.0, 0.45, 1.0));
    let sd = acos(clamp(dot(d, sunDir), -1.0, 1.0));
    let core = 1.0 - smoothstep(0.1, 0.102, sd);
    let ring = (1.0 - smoothstep(0.0, 0.008, abs(sd - 0.103))) * (0.8 + 0.2 * valueNoise2(vec2f(atan2(d.x - sunDir.x, d.y - sunDir.y) * 20.0, t * 2.0)));
    let corona = exp(-max(sd - 0.103, 0.0) * 18.0) * 0.6;
    c = mix(c, vec3f(0.0), core);
    c = c + vec3f(3.0, 0.7, 0.2) * (ring + corona) * (1.0 - core);
    c = c + skyRibbons(d, t, vec3f(1.0, 0.25, 0.1)) * 0.5;
    return c;
}

fn lookParade() -> DomainLook {
    var l: DomainLook;
    l.keyDir = normalize(vec3f(0.0, 0.45, 1.0));
    l.keyCol = vec3f(1.4, 0.45, 0.25);
    l.shadowCol = vec3f(0.18, 0.04, 0.08);
    l.rimCol = vec3f(1.9, 0.35, 0.15);
    l.fogCol = vec3f(0.45, 0.06, 0.04);
    l.inkCol = vec3f(0.02, 0.0, 0.01);
    l.fogDensity = 0.014;
    l.fogHeight = 10.0;
    l.bands = 2.0;
    l.shafts = 0.0;
    return l;
}

// the stone avenue the fighters stand on: slabs, lantern light pooled along both sides, petals
fn floorParade(p: vec3f, center: vec3f, t: f32) -> vec3f {
    let q = p.xz - center.xz;
    let slab = vec2f(fract(q.x * 0.4), fract(q.y * 0.4 + floor(q.x * 0.4) * 0.5));
    let joint = 1.0 - step(0.04, min(slab.x, slab.y));
    let wear = vfbm2(p.xz * 0.5, 4);
    var col = mix(vec3f(0.14, 0.08, 0.07), vec3f(0.26, 0.15, 0.12), wear) * (1.0 - joint * 0.6);
    // lantern pools: warm light every five metres along the avenue's edges
    let lz = fract((p.z + t * 1.2) / 5.0) - 0.5;
    let pool = exp(-sqr(lz * 5.0) - sqr((abs(q.x) - 12.0) * 0.25));
    col = col + vec3f(1.6, 0.45, 0.15) * pool * 0.5;
    // fallen petals, dark red
    let pg = p.xz * 2.5;
    let pid = floor(pg);
    let ph = hash22(pid);
    if (ph.x > 0.88) {
        let pq = rotate2(fract(pg) - 0.5, ph.y * 6.28);
        let petal = sdFill(sdVesica(pq, 0.18, 0.1), 0.02);
        col = mix(col, vec3f(0.45, 0.04, 0.05), petal);
    }
    return col;
}
