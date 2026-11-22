// Domain 1: Garden of Folded Prayers (Sayo).
//
// Sayo folded a thousand cranes for her brother and he still died. Her domain is the garden she
// imagined they would carry him to: everything is paper. Rings of white torii stand round the
// arena, hung with straw rope and zig-zag shide; giant folded cranes drift between them and turn
// their heads; paper mountains with sharp creases stand on the horizon; the sky is a sumi-e wash on
// rice paper, with a red sun stamped on it like a seal. The floor is a sheet folded into a lattice,
// strewn with prayer slips.
//
// materials: 1 paper torii, 2 straw rope, 3 shide, 4 crane, 5 paper mountain, 6 lantern

// a folded crane: body, neck, tail and two flat wings that flap, built from prisms (faceted paper)
fn sdPaperCrane(q0: vec3f, s: f32, flap: f32) -> f32 {
    let q = q0 / s;
    let body = sdOctahedron(vec3f(q.x * 0.7, q.y * 1.6, q.z), 0.55);
    let neck = sdCapsule(q, vec3f(0.0, 0.1, 0.35), vec3f(0.0, 0.75, 0.9), 0.06);
    let head = sdCapsule(q, vec3f(0.0, 0.75, 0.9), vec3f(0.0, 0.62, 1.15), 0.05);
    let tail = sdCapsule(q, vec3f(0.0, 0.1, -0.35), vec3f(0.0, 0.7, -0.95), 0.06);
    let wq = vec3f(abs(q.x), q.y, q.z);
    let wr = rotZ(-flap) * (wq - vec3f(0.15, 0.1, 0.0));
    let wing = sdTriPrism(vec3f(wr.z, wr.x - 0.75, wr.y).xzy, vec2f(0.75, 0.02));
    return min(min(body, min(neck, head)), min(tail, wing)) * s;
}

fn mapGardenWorld(p: vec3f, t: f32) -> vec2f {
    var res = vec2f(1e5, 0.0);
    let ringR = length(p.xz);
    // the floor of the world below the paper ground (the arena floor is its own mesh)
    res = opUnionId(res, vec2f(p.y + 0.6, 5.0));
    // paper mountains on the horizon only
    if (ringR > 70.0) {
        let mpr = opPolarRepeatY(p, 7.0);
        let mh = hash11(mpr.w + 1.0);
        let mq = vec3f(mpr.x - 110.0, p.y + 2.0, mpr.z);
        let mount = sdOctahedron(vec3f(mq.x, mq.y * (0.7 + mh * 0.4), mq.z), 35.0 + mh * 15.0);
        return opUnionId(res, vec2f(mount, 5.0));
    }
    res = opUnionId(res, vec2f(70.0 - ringR + 1.0, 0.0));
    // two rings of torii facing the centre
    for (var ringI = 0; ringI < 2; ringI++) {
        let fr = f32(ringI);
        let count = 12.0 + fr * 6.0;
        let radius = 30.0 + fr * 20.0;
        let pr = opPolarRepeatY(rotY(fr * 0.3) * p, count);
        let q = vec3f(pr.x - radius, pr.y, pr.z);
        let size = 9.0 + fr * 3.0;
        let torii = sdTorii3(q.zyx, size * 0.7, size);
        res = opUnionId(res, vec2f(torii, 1.0));
        // shimenawa: a sagging rope under the lintel, shide hanging from it
        let sag = 0.6 * (1.0 - sqr(q.z / (size * 0.35)));
        let rope = sdCapsule(vec3f(q.x, q.y - (size * 0.8 - sag), q.z), vec3f(0.0, 0.0, -size * 0.34), vec3f(0.0, 0.0, size * 0.34), 0.18 + 0.04 * sin(q.z * 6.0));
        res = opUnionId(res, vec2f(rope, 2.0));
        let sz = fmod1(q.z + size, size * 0.17) - size * 0.085;
        let zig = abs(fract((q.y - (size * 0.8 - sag)) * 1.6) - 0.5) * 0.3;
        let shide = sdBox3(vec3f(q.x, q.y - (size * 0.8 - sag) + 0.9, sz - zig), vec3f(0.02, 0.8, 0.15));
        res = opUnionId(res, vec2f(select(1e5, shide, abs(q.z) < size * 0.32), 3.0));
    }
    // the cranes, drifting round the garden in a slow current
    let cr = rotY(t * 0.04) * p;
    let cpr = opPolarRepeatY(cr, 9.0);
    let ch = hash11(cpr.w + 7.0);
    let cq = vec3f(cpr.x - 22.0 - ch * 18.0, cpr.y - 12.0 - ch * 10.0 - sin(t * 0.5 + ch * 6.0) * 1.5, cpr.z);
    let crane = sdPaperCrane(rotY(1.5708) * cq, 2.4 + ch * 1.5, sin(t * 1.6 + ch * 9.0) * 0.5);
    res = opUnionId(res, vec2f(crane, 4.0));
    // floating lanterns, rising slowly
    let lid = floor((p.xz + vec2f(0.0, 0.0)) / 11.0 + 0.5);
    let lh = hash22(lid + vec2f(9.1, 2.3));
    let ly = fmod1(t * 0.4 + lh.x * 40.0, 40.0) + 4.0;
    let lq = vec3f(p.x - lid.x * 11.0 - (lh.x - 0.5) * 4.0, p.y - ly, p.z - lid.y * 11.0 - (lh.y - 0.5) * 4.0);
    let lantern = select(1e5, sdChochin(lq, 0.6, 0.8), length(lid) > 2.0 && lh.y > 0.5);
    res = opUnionId(res, vec2f(lantern, 6.0));
    return res;
}

fn surfGarden(mat: i32, p: vec3f, n: vec3f, t: f32) -> DomainSurface {
    switch mat {
        case 1: {
            var s = domainSurface(vec3f(0.95, 0.93, 0.89));
            s.albedo = s.albedo * (0.94 + paperGrain(p.xy * 3.0 + p.zz) * 0.08);
            s.rim = 0.6;
            return s;
        }
        case 2: {
            var s = domainSurface(vec3f(0.78, 0.66, 0.42));
            let twist = step(0.5, fract(atan2(p.y, p.x) * 2.0 + p.z * 4.0));
            s.albedo = s.albedo * (0.85 + 0.15 * twist);
            return s;
        }
        case 3: {
            var s = domainSurface(vec3f(0.98, 0.97, 0.94));
            s.unlit = 0.4;
            return s;
        }
        case 4: {
            // crane paper: alternate facets catch the light differently (folded)
            let facet = step(0.0, n.x * n.z) * 0.12;
            var s = domainSurface(vec3f(0.96, 0.95, 0.92) - vec3f(facet));
            // a red crane among the white ones
            if (hash11(floor(p.y * 0.1) + floor(atan2(p.z, p.x) * 1.43)) > 0.85) {
                s.albedo = vec3f(0.85, 0.12, 0.1);
            }
            return s;
        }
        case 5: {
            // creased paper mountains in grey ink wash, paler with distance
            let crease = 1.0 - smoothstep(0.0, 0.08, abs(n.x * n.z) - 0.0);
            var s = domainSurface(mix(vec3f(0.62, 0.62, 0.66), vec3f(0.42, 0.42, 0.48), crease * 0.4));
            s.rim = 0.3;
            return s;
        }
        default: {
            var s = domainSurface(vec3f(0.98, 0.92, 0.8));
            s.emissive = vec3f(1.4, 0.8, 0.4) * (0.8 + 0.2 * sin(t * 3.0 + p.x));
            return s;
        }
    }
}

fn skyGarden(d: vec3f, t: f32) -> vec3f {
    // rice paper with sumi-e washes
    var c = vec3f(0.95, 0.93, 0.88);
    let up = clamp(d.y, -0.2, 1.0);
    let sp = d.xz / max(d.y + 0.3, 0.08);
    let wash = vfbm2(sp * 0.18 + vec2f(t * 0.004, 0.0), 5);
    let ink = smoothstep(0.5, 0.75, wash) * (1.0 - smoothstep(0.1, 0.9, up)) * 0.55;
    c = mix(c, vec3f(0.42, 0.42, 0.46), ink);
    // a drier stroke edge where the wash pooled
    let pool = (1.0 - smoothstep(0.0, 0.015, abs(wash - 0.62))) * 0.25 * (1.0 - up);
    c = c - vec3f(pool);
    // distant ink mountains: three layers of ridge silhouettes on the horizon
    let az = atan2(d.z, d.x);
    for (var k = 0; k < 3; k++) {
        let fk = f32(k);
        let ridge = 0.02 + 0.1 * (1.0 - fk * 0.3) * (fbm2(vec2f(az * (2.0 + fk * 1.5) + fk * 7.0, fk), 4, 2.0, 0.5) * 0.5 + 0.5);
        let m = 1.0 - smoothstep(ridge - 0.005, ridge + 0.005, d.y);
        c = mix(c, vec3f(0.55 - fk * 0.12, 0.55 - fk * 0.12, 0.6 - fk * 0.12), m * (0.4 + fk * 0.15) * step(-0.05, d.y));
    }
    // the red sun, stamped like a seal
    let sunDir = normalize(vec3f(-0.6, 0.35, 0.7));
    let sd = acos(clamp(dot(d, sunDir), -1.0, 1.0));
    let stampN = vfbm2(vec2f(az * 20.0, d.y * 20.0), 3);
    let sun = (1.0 - smoothstep(0.13, 0.135, sd + (stampN - 0.5) * 0.008)) * (0.85 + 0.15 * stampN);
    c = mix(c, vec3f(0.82, 0.12, 0.08), sun);
    // paper fibre
    c = c * (0.96 + paperGrain(sp * 2.0) * 0.06);
    return c;
}

fn lookGarden() -> DomainLook {
    var l: DomainLook;
    l.keyDir = normalize(vec3f(-0.6, 0.55, 0.7));
    l.keyCol = vec3f(1.05, 1.02, 0.96);
    l.shadowCol = vec3f(0.6, 0.6, 0.72);
    l.rimCol = vec3f(0.9, 0.25, 0.2);
    l.fogCol = vec3f(0.93, 0.91, 0.87);
    l.inkCol = vec3f(0.1, 0.09, 0.1);
    l.fogDensity = 0.0055;
    l.fogHeight = 14.0;
    l.bands = 2.0;
    l.shafts = 0.0;
    return l;
}

// the paper floor: folded into a lattice, ink at the folds, prayer slips scattered over it
fn floorGarden(p: vec3f, center: vec3f, t: f32) -> vec3f {
    let g = abs(fract(p.xz * 0.5) - 0.5);
    let fold = 1.0 - smoothstep(0.0, 0.02, min(g.x, g.y));
    let diag = 1.0 - smoothstep(0.0, 0.015, abs(g.x - g.y));
    // alternate panels face the light a little differently (folds are never flat)
    let cell = floor(p.xz * 0.5);
    let tilt = hash12(cell) * 0.08;
    var col = vec3f(0.95, 0.93, 0.89) * (0.92 + paperGrain(p.xz * 4.0) * 0.1 - tilt) * (1.0 - fold * 0.25 - diag * 0.1);
    // prayer slips: small rectangles with brushed glyphs, some with a red border
    let sg = p.xz * 0.9;
    let sid = floor(sg);
    let sh = hash22(sid + vec2f(4.0, 1.0));
    if (sh.x > 0.72) {
        let sq = rotate2(fract(sg) - 0.5, (sh.y - 0.5) * 2.0);
        let slip = sdFill(sdBox2(sq, vec2f(0.12, 0.3)), 0.01);
        let gl = sdFill(sdGlyph(sq * vec2f(3.0, 1.4), floor(sh.y * 40.0)), 0.05) * slip;
        let border = step(0.1, max(abs(sq.x) / 0.12 * 0.1, abs(sq.y) / 0.3 * 0.1)) * slip * step(0.5, sh.y);
        col = mix(col, vec3f(0.99, 0.98, 0.95), slip);
        col = mix(col, vec3f(0.1, 0.08, 0.09), gl * 0.8);
        col = mix(col, vec3f(0.75, 0.1, 0.08), border * 0.8);
    }
    // the slips stir: a faint breath of wind rolling across
    let wind = smoothstep(0.6, 0.9, valueNoise2(p.xz * 0.15 + vec2f(t * 0.3, 0.0)));
    col = col * (1.0 - wind * 0.04);
    _ = center;
    return col;
}
