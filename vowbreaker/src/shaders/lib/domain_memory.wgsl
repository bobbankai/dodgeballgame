// Domain 4: the burning memory (flashbacks).
//
// Not a technique: the night Itsuki keeps returning to. An apartment corridor that never ends, the
// same numbered doors repeating in both directions, fire behind every gap, soot climbing the walls,
// the ceiling lamps swinging; ash rises instead of falling, as if the building were breathing out.
// It is drawn hotter and less steady than the domains: the light flickers and the walls breathe.
//
// materials: 1 wall plaster (sooted), 2 door (steel, painted), 3 door gap (fire), 4 ceiling,
//            5 lamp (swinging), 6 number plate

fn mapMemoryWorld(p: vec3f, t: f32) -> vec2f {
    var res = vec2f(1e5, 0.0);
    let rep = 5.0;
    let x = fmod1(p.x, rep) - rep * 0.5;
    let breathe = 1.0 + sin(t * 0.7) * 0.03;
    let wallZ = 9.0 * breathe;
    let walls = wallZ - abs(p.z);
    res = vec2f(-walls, 1.0);
    // doors set into the walls, with a burning gap round each
    let dq = vec3f(x, p.y - 2.1, abs(p.z) - wallZ + 0.12);
    let door = sdBox3(dq, vec3f(0.95, 2.05, 0.08));
    let frame = sdBox3(dq, vec3f(1.08, 2.18, 0.04));
    res = opUnionId(res, vec2f(door, 2.0));
    res = opUnionId(res, vec2f(frame + 0.03, 3.0));
    // a number plate on each door
    let plate = sdBox3(dq - vec3f(0.0, 1.35, -0.1), vec3f(0.22, 0.08, 0.02));
    res = opUnionId(res, vec2f(plate, 6.0));
    // ceiling and swinging lamps
    res = opUnionId(res, vec2f(6.5 - p.y, 4.0));
    let lx = fmod1(p.x + rep * 0.5, rep * 2.0) - rep;
    let swing = sin(t * 1.3 + floor((p.x + rep * 0.5) / (rep * 2.0))) * 0.25;
    let lq = rotZ(swing) * vec3f(lx, p.y - 6.5, p.z);
    let cord = sdCapsule(lq, vec3f(0.0, 0.0, 0.0), vec3f(0.0, -1.0, 0.0), 0.02);
    let shade = sdCappedCone(lq - vec3f(0.0, -1.15, 0.0), 0.15, 0.35, 0.08);
    res = opUnionId(res, vec2f(min(cord, shade), 5.0));
    // the floor below the arena's
    res = opUnionId(res, vec2f(p.y + 0.3, 1.0));
    return res;
}

fn surfMemory(mat: i32, p: vec3f, n: vec3f, t: f32) -> DomainSurface {
    switch mat {
        case 1: {
            // plaster, soot climbing from the floor and from every door gap
            let soot = smoothstep(0.3, 0.8, vfbm2(vec2f(p.x * 0.4, p.y * 0.6 - t * 0.05), 4) + (3.0 - p.y) * 0.12);
            var s = domainSurface(mix(vec3f(0.62, 0.56, 0.48), vec3f(0.07, 0.05, 0.04), soot));
            let ember = pow(vfbm2(p.xy * 1.5 + vec2f(0.0, t * 0.3), 3), 6.0) * soot;
            s.emissive = blackbody(1500.0) * ember * 6.0;
            return s;
        }
        case 2: {
            var s = domainSurface(vec3f(0.24, 0.27, 0.3));
            let scorch = smoothstep(0.4, 0.9, vfbm2(p.xy * 0.8, 3));
            s.albedo = mix(s.albedo, vec3f(0.05, 0.04, 0.04), scorch);
            s.gloss = 0.3;
            return s;
        }
        case 3: {
            var s = domainSurface(vec3f(1.0, 0.5, 0.1));
            let f = vfbm2(vec2f(p.x * 3.0, p.y * 2.0 - t * 2.5), 3);
            s.emissive = blackbody(1300.0 + f * 1200.0) * (2.0 + f * 3.0);
            s.unlit = 1.0;
            return s;
        }
        case 4: {
            return domainSurface(vec3f(0.1, 0.08, 0.07));
        }
        case 5: {
            var s = domainSurface(vec3f(0.9, 0.8, 0.6));
            let flick = step(0.25, valueNoise2(vec2f(t * 9.0, floor(p.x * 0.1))));
            s.emissive = vec3f(1.8, 1.4, 0.8) * flick;
            return s;
        }
        default: {
            var s = domainSurface(vec3f(0.85, 0.82, 0.7));
            s.gloss = 0.5;
            return s;
        }
    }
}

fn skyMemory(d: vec3f, t: f32) -> vec3f {
    // seen only through gaps: fire
    let fire = fbm2(vec2f(atan2(d.z, d.x) * 3.0, d.y * 4.0 - t * 1.5), 4, 2.0, 0.5) * 0.5 + 0.5;
    return blackbody(1200.0 + fire * 1600.0) * (1.2 + fire) * smoothstep(-0.2, 0.4, d.y + fire * 0.3);
}

fn lookMemory() -> DomainLook {
    var l: DomainLook;
    l.keyDir = normalize(vec3f(0.2, 0.9, 0.3));
    l.keyCol = vec3f(1.5, 0.75, 0.35);
    l.shadowCol = vec3f(0.22, 0.08, 0.05);
    l.rimCol = vec3f(1.8, 0.6, 0.2);
    l.fogCol = vec3f(0.35, 0.12, 0.05);
    l.inkCol = vec3f(0.03, 0.01, 0.0);
    l.fogDensity = 0.012;
    l.fogHeight = 8.0;
    l.bands = 3.0;
    l.shafts = 0.0;
    return l;
}

// burnt tatami: woven mats, scorched in patches, embers glowing in the weave
fn floorMemory(p: vec3f, center: vec3f, t: f32) -> vec3f {
    let q = p.xz - center.xz;
    let mat = vec2f(fract(q.x / 1.8), fract(q.y / 0.9 + floor(q.x / 1.8) * 0.5));
    let edge = 1.0 - step(0.03, min(min(mat.x, 1.0 - mat.x), min(mat.y, 1.0 - mat.y)));
    let weave = 0.9 + 0.1 * sin(q.y * 60.0);
    var col = vec3f(0.55, 0.5, 0.32) * weave;
    col = mix(col, vec3f(0.12, 0.25, 0.12), edge);
    let scorch = smoothstep(0.35, 0.8, vfbm2(p.xz * 0.3, 4));
    col = mix(col, vec3f(0.05, 0.04, 0.03), scorch);
    let ember = pow(vfbm2(p.xz * 2.0 + vec2f(t * 0.2, 0.0), 3), 5.0) * scorch;
    col = col + blackbody(1400.0) * ember * 5.0;
    return col;
}
