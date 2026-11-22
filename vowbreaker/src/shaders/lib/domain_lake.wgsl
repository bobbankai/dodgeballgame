// Domain 2: Mirror Lake of Ten Thousand Moons (Mikami).
//
// Mikami counted the nights his student did not come home. His domain is a lake so still it is a
// second sky: a night crowded with moons of every phase and size round one full moon, a pale band
// of stars across it, and below, the same sky again. Stone lanterns stand on little islands, their
// windows lit; standing stones lean out of the water further off; a single torii stands in the lake
// where the moons set. The only thing that moves the water is the fight: rings spread from wherever
// the fighters step.
//
// materials: 1 lantern stone, 2 lantern window (lit), 3 standing stone, 4 island moss,
//            5 torii (vermilion, black lintel), 6 water (handled by the reflection pass)

fn mapLakeWorld(p: vec3f, t: f32) -> vec2f {
    var res = vec2f(1e5, 0.0);
    // islands with stone lanterns, in a ring
    let pr = opPolarRepeatY(p, 8.0);
    let ih = hash11(pr.w + 3.0);
    let iq = vec3f(pr.x - 26.0 - ih * 10.0, p.y, pr.z + (ih - 0.5) * 6.0);
    let island = sdEllipsoid(iq + vec3f(0.0, 0.9, 0.0), vec3f(3.2, 1.2, 2.6));
    res = opUnionId(res, vec2f(island, 4.0));
    let toro = sdToro(iq - vec3f(0.0, 0.1, 0.0), 2.6);
    res = opUnionId(res, vec2f(toro, 1.0));
    // the window glow of the lantern (a small box inside the fire box)
    let win = sdBox3(iq - vec3f(0.0, 2.6, 0.0), vec3f(0.5, 0.22, 0.5));
    res = opUnionId(res, vec2f(win + 0.02, 2.0));
    // standing stones further out, leaning
    let sr = opPolarRepeatY(rotY(0.4) * p, 13.0);
    let sh = hash11(sr.w + 11.0);
    var sq = vec3f(sr.x - 55.0 - sh * 20.0, p.y, sr.z);
    sq = rotZ((sh - 0.5) * 0.4) * sq;
    let stone = sdRoundBox3(sq - vec3f(0.0, 3.0 + sh * 3.0, 0.0), vec3f(1.4, 4.0 + sh * 4.0, 1.0), 0.7);
    res = opUnionId(res, vec2f(stone, 3.0));
    // the torii in the lake, where the moons set
    let tq = p - vec3f(0.0, -0.2, 75.0);
    let torii = sdTorii3(tq, 16.0, 18.0);
    res = opUnionId(res, vec2f(torii, 5.0));
    _ = t;
    return res;
}

fn surfLake(mat: i32, p: vec3f, n: vec3f, t: f32) -> DomainSurface {
    switch mat {
        case 1: {
            var s = domainSurface(vec3f(0.42, 0.44, 0.48));
            let moss = smoothstep(0.6, 0.8, n.y) * smoothstep(0.5, 0.7, vfbm2(p.xz * 2.0, 3));
            s.albedo = mix(s.albedo, vec3f(0.2, 0.32, 0.22), moss);
            return s;
        }
        case 2: {
            var s = domainSurface(vec3f(1.0, 0.85, 0.55));
            s.emissive = vec3f(2.4, 1.6, 0.8) * (0.85 + 0.15 * sin(t * 5.0 + p.x * 3.0));
            s.unlit = 1.0;
            return s;
        }
        case 3: {
            var s = domainSurface(vec3f(0.3, 0.32, 0.38));
            s.rim = 1.4;
            return s;
        }
        case 4: {
            return domainSurface(vec3f(0.16, 0.22, 0.18));
        }
        case 5: {
            let lintel = step(16.0, p.y);
            var s = domainSurface(mix(vec3f(0.75, 0.16, 0.1), vec3f(0.06, 0.05, 0.06), lintel));
            s.rim = 1.2;
            return s;
        }
        default: {
            return domainSurface(vec3f(0.05, 0.08, 0.14));
        }
    }
}

// one crescent moon in a cell: phase from the hash, a soft halo
fn lakeMoonCell(f: vec2f, h: vec2f, size: f32) -> vec2f {
    let r = size * (0.25 + 0.75 * h.x);
    let phase = (h.y - 0.5) * 2.2;
    let disc = length(f) - r;
    let shadow = length(f - vec2f(phase * r, 0.0)) - r * 1.02;
    let lit = max(disc, -shadow);
    let m = 1.0 - smoothstep(-0.004, 0.004, lit);
    let halo = exp(-max(disc, 0.0) / (r * 1.5)) * 0.25;
    return vec2f(m, halo);
}

fn skyLake(d0: vec3f, t: f32) -> vec3f {
    // the water reflects the sky: below the horizon, look at the mirrored direction (darker)
    var d = d0;
    var under = 1.0;
    if (d.y < 0.0) {
        d = vec3f(d.x, -d.y, d.z);
        under = 0.75;
    }
    let up = clamp(d.y, 0.0, 1.0);
    var c = mix(vec3f(0.06, 0.12, 0.26), vec3f(0.008, 0.014, 0.05), pow(up, 0.55));
    // the band of stars across the sky
    let band = exp(-sqr(dot(d, normalize(vec3f(0.3, 0.2, -1.0))) * 3.0));
    c = c + vec3f(0.12, 0.14, 0.22) * band * vfbm2(vec2f(atan2(d.z, d.x) * 6.0, d.y * 8.0), 4);
    c = c + skyStars(d, t, 0.9 + band);
    // the full moon
    let moonDir = normalize(vec3f(0.0, 0.32, 1.0));
    let md = acos(clamp(dot(d, moonDir), -1.0, 1.0));
    let full = 1.0 - smoothstep(0.075, 0.078, md);
    let mare = vfbm2(vec2f(atan2(d.z - moonDir.z, d.x - moonDir.x), md) * vec2f(3.0, 40.0), 3);
    c = mix(c, vec3f(1.35, 1.35, 1.25) * (0.85 + 0.15 * mare), full);
    c = c + vec3f(0.35, 0.4, 0.55) * exp(-max(md - 0.078, 0.0) * 14.0) * 0.7;
    // ten thousand moons: crescents of every phase in three layers of different sizes
    let sp = d.xz / max(d.y + 0.2, 0.06);
    for (var k = 0; k < 3; k++) {
        let fk = f32(k);
        let scale = 1.2 + fk * 1.6;
        let g = sp * scale + vec2f(fk * 13.7, fk * 5.3);
        let cell = floor(g);
        let h = hash22(cell + vec2f(fk * 31.0, 0.0));
        if (h.x > 0.45) {
            let f = (fract(g) - 0.5 - (hash22(cell + 9.0) - 0.5) * 0.4) / scale;
            let mm = lakeMoonCell(f * 3.0, h, 0.3 / (1.0 + fk * 0.6));
            let twinkle = 0.85 + 0.15 * sin(t * (1.0 + h.y * 2.0) + h.x * 30.0);
            c = c + vec3f(1.15, 1.18, 1.3) * mm.x * twinkle * smoothstep(0.0, 0.12, d.y) + vec3f(0.25, 0.3, 0.45) * mm.y * smoothstep(0.0, 0.12, d.y);
        }
    }
    // mist on the horizon
    c = mix(c, vec3f(0.12, 0.16, 0.26), exp(-up * 14.0) * 0.6);
    return c * under;
}

fn lookLake() -> DomainLook {
    var l: DomainLook;
    l.keyDir = normalize(vec3f(0.0, 0.32, 1.0));
    l.keyCol = vec3f(0.75, 0.82, 1.1);
    l.shadowCol = vec3f(0.12, 0.16, 0.3);
    l.rimCol = vec3f(0.6, 0.75, 1.2);
    l.fogCol = vec3f(0.08, 0.12, 0.22);
    l.inkCol = vec3f(0.01, 0.02, 0.05);
    l.fogDensity = 0.01;
    l.fogHeight = 6.0;
    l.bands = 3.0;
    l.shafts = 0.0;
    return l;
}

// rings spreading from the fighters' steps (around the centre), plus a slow far swell
fn lakeRipple(p: vec2f, center: vec2f, t: f32) -> vec2f {
    var g = vec2f(0.0);
    for (var k = 0; k < 4; k++) {
        let fk = f32(k);
        let o = center + vec2f(sin(fk * 2.4 + floor(t * 0.5 + fk * 0.25) * 1.7), cos(fk * 1.9 + floor(t * 0.5 + fk * 0.25) * 2.3)) * 4.0;
        let age = fract(t * 0.5 + fk * 0.25);
        let q = p - o;
        let r = length(q);
        let front = age * 10.0;
        let wave = sin((r - front) * 6.0) * exp(-abs(r - front) * 1.5) * (1.0 - age);
        g = g + q / max(r, 1e-3) * wave * 0.08;
    }
    return g;
}

fn floorLake(p: vec3f, center: vec3f, t: f32, v: vec3f) -> vec3f {
    let g = lakeRipple(p.xz, center.xz, t);
    let n = normalize(vec3f(-g.x, 1.0, -g.y));
    let r = reflect(-v, n);
    var col = skyLake(r, t) * 0.9;
    // a faint wash of the deep under the reflection, fresnel-weighted
    let fres = fresnelSchlick(max(dot(n, v), 0.0), 0.02);
    col = mix(vec3f(0.01, 0.02, 0.05), col, 0.55 + 0.45 * fres);
    // glints where ripples face the moon
    // glints where ripples face the moon: small sharp sparks, not a sheet of light
    let glint = smoothstep(0.9975, 0.9995, dot(r, normalize(vec3f(0.0, 0.32, 1.0)))) * step(0.02, length(g));
    col = col + vec3f(1.0, 1.05, 1.2) * glint * 0.8;
    return col;
}
