// Domain 0: Temple of the Unrung Bell (Itsuki).
//
// Itsuki's grief made a temple out of the night his sister's bell stopped ringing. Bronze bells
// hang in rows on chains from beams too high to see, each one swaying a little out of time with the
// others; none of them has ever been rung. A ring of five-storey pagodas stands on the horizon in a
// gold dusk that never becomes night, and below the arena an ash sea heaves slowly. The floor is
// bronze, engraved like the crown of a bell seen from above; its rings pulse every time the domain
// tolls.
//
// materials: 1 bronze bell, 2 chain and yoke iron, 3 ash sea, 4 lacquered wood, 5 roof tile,
//            6 gilt finial

const BELL_CELL: f32 = 13.0;

// a bonsho with its yoke, the striking boss and the lotus seat cast round its lip
fn bellUnit(q: vec3f, h: f32, t: f32, seed: f32) -> vec2f {
    let swing = sin(t * (0.45 + seed * 0.2) + seed * 6.28) * 0.06;
    let pivot = vec3f(0.0, h * 1.15, 0.0);
    let qs = rotZ(swing) * (q - pivot) + pivot;
    let bell = sdBonsho(qs - vec3f(0.0, h, 0.0), h);
    // the boss: two raised discs on opposite sides where the beam would strike
    let qb = vec3f(abs(qs.x) - h * 0.355, qs.y - h * 0.35, qs.z);
    let boss = sdCylinderY(vec3f(qb.y, qb.x, qb.z), h * 0.015, h * 0.07);
    var res = vec2f(min(bell, boss), 1.0);
    // the yoke: a short beam the bell hangs from, and its iron hook
    let yoke = sdBox3(qs - vec3f(0.0, h * 1.12, 0.0), vec3f(h * 0.5, h * 0.05, h * 0.08));
    let hook = sdTorus(vec3f(qs.x, qs.y - h * 1.06, qs.z).xzy, vec2f(h * 0.06, h * 0.018));
    res = opUnionId(res, vec2f(min(yoke, hook), 2.0));
    return res;
}

fn mapBellWorld(p: vec3f, t: f32) -> vec2f {
    // the field of bells (none inside the arena)
    let id = floor(p.xz / BELL_CELL + 0.5);
    let h2 = hash22(id + vec2f(3.7, 1.9));
    let local = vec3f(p.x - id.x * BELL_CELL + (h2.x - 0.5) * 3.0, p.y, p.z - id.y * BELL_CELL + (h2.y - 0.5) * 3.0);
    let hgt = 3.5 + h2.x * 3.5;
    let base = 7.0 + h2.y * 14.0;
    var res = vec2f(1e5, 0.0);
    let ring = length(p.xz);
    if (ring > 16.0 && ring < 95.0) {
        res = bellUnit(local - vec3f(0.0, base, 0.0), hgt, t, h2.x);
        // chains up into the dark: links repeated along y
        let cy = fmod1(local.y - base - hgt * 1.15, 0.9) - 0.45;
        let chainA = sdLink(vec3f(local.x - hgt * 0.35, cy, local.z), 0.18, 0.16, 0.045);
        let chainB = sdLink(vec3f(local.x + hgt * 0.35, cy, local.z).zyx, 0.18, 0.16, 0.045);
        let above = local.y - base - hgt * 1.12;
        let chains = select(1e5, min(chainA, chainB), above > 0.0 && above < 70.0);
        res = opUnionId(res, vec2f(chains, 2.0));
    } else if (ring <= 16.0) {
        // inside the arena: only the distance to where the bells begin
        res = vec2f(max(16.0 - ring, 1.0), 0.0);
    }
    // the sea is everywhere below
    let sea = p.y + 2.5 + sin(p.x * 0.07 + t * 0.25) * 0.6 + cos(p.z * 0.06 - t * 0.2) * 0.6 + sin((p.x + p.z) * 0.15 + t * 0.4) * 0.25;
    res = opUnionId(res, vec2f(sea * 0.8, 3.0));
    // the pagodas only exist out on the horizon: a bound until the ray gets there
    if (ring < 105.0) {
        return opUnionId(res, vec2f(105.0 - ring + 1.0, 0.0));
    }
    let pr = opPolarRepeatY(p, 11.0);
    let pq = vec3f(pr.x - 120.0, pr.y, pr.z);
    var pag = 1e5;
    var roofs = 1e5;
    for (var k = 0; k < 5; k++) {
        let fk = f32(k);
        let w = 7.0 - fk * 1.0;
        let y0 = 2.0 + fk * 8.0;
        let body = sdBox3(pq - vec3f(0.0, y0 + 3.0, 0.0), vec3f(w * 0.62, 3.0, w * 0.62));
        let lift = 0.04 * pow(max(abs(pq.x), abs(pq.z)) / w, 2.0) * w * 4.0;
        let roof = sdBox3(pq - vec3f(0.0, y0 + 6.4 + lift, 0.0), vec3f(w, 0.35, w));
        pag = min(pag, body);
        roofs = min(roofs, roof);
    }
    let spire = sdCappedCone(pq - vec3f(0.0, 46.0, 0.0), 6.0, 0.6, 0.15);
    res = opUnionId(res, vec2f(pag, 4.0));
    res = opUnionId(res, vec2f(roofs, 5.0));
    res = opUnionId(res, vec2f(spire, 6.0));
    return res;
}

fn surfBell(mat: i32, p: vec3f, n: vec3f, t: f32) -> DomainSurface {
    switch mat {
        case 1: {
            // bronze: warm gold where it faces up, green patina gathering in the bands' shadows
            var s = domainSurface(vec3f(0.78, 0.5, 0.2));
            let patina = smoothstep(0.55, 0.8, vfbm2(vec2f(atan2(p.z, p.x) * 3.0, p.y * 0.8), 3)) * (1.0 - max(n.y, 0.0));
            s.albedo = mix(s.albedo, vec3f(0.25, 0.45, 0.36), patina * 0.6);
            s.gloss = 0.7;
            s.rim = 1.2;
            return s;
        }
        case 2: {
            var s = domainSurface(vec3f(0.12, 0.1, 0.1));
            s.gloss = 0.3;
            return s;
        }
        case 3: {
            // the ash sea: grey swell with pale crests and slow drifting streaks
            let crest = smoothstep(0.6, 0.9, n.y) * smoothstep(0.55, 0.75, vfbm2(p.xz * 0.05 + vec2f(t * 0.02, 0.0), 3));
            var s = domainSurface(mix(vec3f(0.24, 0.19, 0.17), vec3f(0.55, 0.47, 0.4), crest));
            s.rim = 0.5;
            return s;
        }
        case 4: {
            return domainSurface(vec3f(0.42, 0.1, 0.06));
        }
        case 5: {
            var s = domainSurface(vec3f(0.12, 0.1, 0.12));
            s.rim = 1.5;
            return s;
        }
        default: {
            var s = domainSurface(vec3f(0.95, 0.7, 0.25));
            s.gloss = 1.0;
            s.emissive = vec3f(0.4, 0.2, 0.05);
            return s;
        }
    }
}

fn skyBell(d: vec3f, t: f32) -> vec3f {
    let up = clamp(d.y, -0.3, 1.0);
    let sunDir = normalize(vec3f(0.0, 0.1, 1.0));
    // a dusk that never ends: blazing horizon, deep red-brown zenith
    var c = mix(vec3f(1.7, 0.85, 0.3), vec3f(0.22, 0.07, 0.06), pow(max(up, 0.0), 0.45));
    c = mix(c, vec3f(0.35, 0.18, 0.12), smoothstep(0.0, -0.3, up));
    // the low sun: a disc with rings of haze round it
    let sd = dot(d, sunDir);
    let disc = smoothstep(0.9985, 0.999, sd);
    let halo = pow(max(sd, 0.0), 40.0) * 1.5 + pow(max(sd, 0.0), 6.0) * 0.4;
    let rings = (0.5 + 0.5 * sin(acos(clamp(sd, -1.0, 1.0)) * 60.0 - t * 0.3)) * pow(max(sd, 0.0), 12.0) * 0.3;
    c = c + vec3f(2.4, 1.6, 0.8) * (disc * 3.0 + halo + rings);
    // cloud bands: long streaks with inked lower edges, lit gold from below
    let sp = d.xz / max(d.y + 0.12, 0.04);
    let band = vfbm2(vec2f(sp.x * 0.08 + t * 0.004, sp.y * 0.6), 4);
    let cloud = smoothstep(0.55, 0.62, band) * smoothstep(0.02, 0.15, d.y);
    let underside = smoothstep(0.55, 0.58, band) * (1.0 - smoothstep(0.6, 0.66, band));
    c = mix(c, vec3f(0.5, 0.2, 0.12), cloud * 0.8);
    c = c + vec3f(1.6, 0.8, 0.3) * underside * cloud * 0.6;
    return c;
}

fn lookBell() -> DomainLook {
    var l: DomainLook;
    l.keyDir = normalize(vec3f(0.0, 0.25, 1.0));
    l.keyCol = vec3f(1.55, 1.05, 0.55);
    l.shadowCol = vec3f(0.32, 0.17, 0.2);
    l.rimCol = vec3f(1.8, 0.95, 0.35);
    l.fogCol = vec3f(0.95, 0.55, 0.25);
    l.inkCol = vec3f(0.12, 0.05, 0.04);
    l.fogDensity = 0.0055;
    l.fogHeight = 14.0;
    l.bands = 3.0;
    l.shafts = 0.35;
    return l;
}

// the bronze floor engraved like a bell's crown seen from above
fn floorBell(p: vec3f, center: vec3f, t: f32, tick: f32) -> vec3f {
    let q = p.xz - center.xz;
    let r = length(q);
    let a = atan2(q.y, q.x);
    var col = mix(vec3f(0.36, 0.22, 0.12), vec3f(0.55, 0.36, 0.18), vfbm2(p.xz * 0.35, 4));
    // engraved rings, a band of glyphs, spokes and lotus petals
    let ringLines = 1.0 - smoothstep(0.0, 0.05, abs(fract(r / 3.0) - 0.5) - 0.46);
    let glyphBand = step(abs(r - 9.0), 0.8);
    let ga = (a / TAU + 0.5) * 48.0;
    let glyph = sdFill(sdGlyph(vec2f(fract(ga) - 0.5, (r - 9.0) / 1.4), floor(ga)), 0.04) * glyphBand;
    let spokes = (1.0 - smoothstep(0.0, 0.06, abs(fract(a / TAU * 16.0) - 0.5) * r * 0.4)) * step(11.0, r) * step(r, 15.0);
    let petal = opPolarRepeat(q, 12.0);
    let lotus = sdStroke(sdVesica(petal.xy - vec2f(4.5, 0.0), 1.6, 1.0), 0.04, 0.05);
    let engraved = clamp(ringLines + glyph + spokes + lotus, 0.0, 1.0);
    col = mix(col, col * 0.45, engraved);
    // the tolls: a pulse of gold racing outward along the rings every tick
    let pulse = fract(t / max(tick, 0.5));
    let wave = 1.0 - smoothstep(0.0, 1.2, abs(r - pulse * 30.0));
    col = col + vec3f(1.6, 0.9, 0.3) * wave * engraved * (1.0 - pulse) * 1.5;
    // ash drifting over it
    let ash = smoothstep(0.62, 0.8, vfbm2(p.xz * 0.6 + vec2f(t * 0.05, t * 0.02), 3));
    col = mix(col, vec3f(0.5, 0.45, 0.42), ash * 0.35);
    return col;
}
