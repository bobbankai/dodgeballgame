// Domain scenes: the dispatcher every domain shader calls (ids match the kits' domain ids:
// 0 bell, 1 garden, 2 lake, 3 parade, 4 memory).

fn domainMap(id: i32, p: vec3f, t: f32) -> vec2f {
    switch id {
        case 0: { return mapBellWorld(p, t); }
        case 1: { return mapGardenWorld(p, t); }
        case 2: { return mapLakeWorld(p, t); }
        case 3: { return mapParadeWorld(p, t); }
        default: { return mapMemoryWorld(p, t); }
    }
}

fn domainSurf(id: i32, mat: i32, p: vec3f, n: vec3f, t: f32) -> DomainSurface {
    switch id {
        case 0: { return surfBell(mat, p, n, t); }
        case 1: { return surfGarden(mat, p, n, t); }
        case 2: { return surfLake(mat, p, n, t); }
        case 3: { return surfParade(mat, p, n, t); }
        default: { return surfMemory(mat, p, n, t); }
    }
}

fn domainSkyOf(id: i32, d: vec3f, t: f32) -> vec3f {
    switch id {
        case 0: { return skyBell(d, t); }
        case 1: { return skyGarden(d, t); }
        case 2: { return skyLake(d, t); }
        case 3: { return skyParade(d, t); }
        default: { return skyMemory(d, t); }
    }
}

fn domainLookOf(id: i32) -> DomainLook {
    switch id {
        case 0: { return lookBell(); }
        case 1: { return lookGarden(); }
        case 2: { return lookLake(); }
        case 3: { return lookParade(); }
        default: { return lookMemory(); }
    }
}

// the domain's ground colour before shadows (v: direction to the eye, for the lake's mirror)
fn domainFloorOf(id: i32, p: vec3f, center: vec3f, t: f32, v: vec3f, tick: f32) -> vec3f {
    switch id {
        case 0: { return floorBell(p, center, t, tick); }
        case 1: { return floorGarden(p, center, t); }
        case 2: { return floorLake(p, center, t, v); }
        case 3: { return floorParade(p, center, t); }
        default: { return floorMemory(p, center, t); }
    }
}

// everything a ray sees in a domain: march, light, ink, fog, shafts (and for the lake, the mirror)
fn domainRender(id: i32, ro: vec3f, rd: vec3f, t: f32, maxT: f32, steps: i32) -> vec3f {
    let look = domainLookOf(id);
    var col = domainSkyOf(id, rd, t);
    let m = domainMarch(id, ro, rd, t, maxT, steps);
    var dist = maxT;
    if (m.hit) {
        let p = ro + rd * m.t;
        let n = domainNormal(id, p, t, 0.004 * m.t + 0.01);
        let v = -rd;
        let s = domainSurf(id, i32(m.mat + 0.5), p, n, t);
        // shadows and occlusion only where they can be seen
        var sh = 1.0;
        var ao = 1.0;
        if (m.t < 60.0) {
            sh = domainSoftShadow(id, p + n * 0.05, normalize(look.keyDir), t, 8.0);
            ao = domainAO(id, p, n, t);
        }
        var c = domainCel(s, n, v, look, sh, ao);
        c = domainPaint(c, p, 0.12);
        let ink = domainInk(m, n) * s.ink;
        c = mix(c, look.inkCol, ink * 0.85);
        col = c;
        dist = m.t;
    } else {
        // silhouettes against the sky still get their ink
        let sil = 1.0 - smoothstep(0.4, 1.0, m.edge);
        col = mix(col, look.inkCol, sil * 0.7);
    }
    // the lake: the world below the horizon is its own reflection
    if (id == 2 && rd.y < 0.0 && !m.hit) {
        let tw = -ro.y / rd.y;
        let wp = ro + rd * tw;
        let rr = vec3f(rd.x, -rd.y, rd.z);
        let rm = domainMarch(id, wp + rr * 0.05, rr, t, maxT * 0.7, steps / 2);
        if (rm.hit) {
            let p = wp + rr * rm.t;
            let n = domainNormal(id, p, t, 0.02);
            let s = domainSurf(id, i32(rm.mat + 0.5), p, n, t);
            col = mix(col, domainCel(s, n, -rr, look, 1.0, 1.0) * 0.8, 0.9);
        }
        dist = tw;
    }
    col = domainFog(col, dist, ro, rd, look);
    col = col + look.keyCol * domainShafts(ro, rd, dist, look, t) * 0.25;
    return col;
}

// things drifting in the domain's air, as a few depth layers of flakes in front of the world:
// gold ash (bell), paper slips (garden), fireflies over the water (lake), petals (parade), embers
// rising (memory). Returns light to add (rgb) and coverage for dark flakes (a).
fn domainMotes(id: i32, ro: vec3f, rd: vec3f, t: f32, maxT: f32) -> vec4f {
    var add = vec3f(0.0);
    var cover = 0.0;
    var coverC = vec3f(0.0);
    for (var k = 0; k < 4; k++) {
        let fk = f32(k);
        let dist = 3.0 + fk * fk * 3.5;
        if (dist > maxT) {
            break;
        }
        let p = ro + rd * dist;
        // flakes live on a jittered 3D grid that drifts per domain
        var drift = vec3f(0.0, -0.4, 0.0);
        if (id == 1) { drift = vec3f(0.3, -0.25, 0.1); }
        if (id == 2) { drift = vec3f(0.05, 0.08 * sin(t), 0.0); }
        if (id == 3) { drift = vec3f(0.4, -0.5, 0.2); }
        if (id == 4) { drift = vec3f(0.0, 0.9, 0.0); }
        let cell = 1.6 + fk * 0.8;
        let q = p - drift * t;
        let cid = floor(q / cell);
        let h = hash33(cid + vec3f(fk * 7.0, f32(id) * 13.0, 0.0));
        if (h.x < 0.55) {
            continue;
        }
        let fq = fract(q / cell) - 0.5 - (h - 0.5) * 0.6;
        let size = (0.035 + h.y * 0.04) / (cell * (1.0 + fk * 0.2));
        let d2 = length(fq - rd * dot(fq, rd));
        let m = 1.0 - smoothstep(size * 0.6, size, d2);
        let fade = (1.0 - fk * 0.2);
        switch id {
            case 0: { add = add + vec3f(1.8, 1.0, 0.35) * m * fade * (0.6 + 0.4 * sin(t * 3.0 + h.z * 20.0)); }
            case 1: {
                cover = max(cover, m * 0.9 * fade);
                coverC = select(vec3f(0.97, 0.95, 0.9), vec3f(0.8, 0.12, 0.1), h.z > 0.85);
            }
            case 2: { add = add + vec3f(0.6, 1.0, 0.7) * m * fade * smoothstep(0.3, 1.0, sin(t * 2.0 + h.z * 30.0)) * 1.5; }
            case 3: {
                cover = max(cover, m * 0.85 * fade);
                coverC = vec3f(0.55, 0.05, 0.06);
            }
            default: { add = add + blackbody(1400.0 + h.z * 600.0) * m * fade * 2.0; }
        }
    }
    _ = coverC;
    return vec4f(add, cover);
}

// the colour of dark flakes per domain (paper white, petal red)
fn domainMoteColor(id: i32) -> vec3f {
    return select(vec3f(0.55, 0.05, 0.06), vec3f(0.96, 0.94, 0.9), id == 1);
}
