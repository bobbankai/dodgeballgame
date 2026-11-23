// Debris: chunks of the floor and the scenery thrown by heavy blows (src/render/Debris.ts).
//
// Each chunk is a small rigid body simulated in compute/debris.wgsl: gravity and air drag, a
// tumbling orientation (a quaternion turned by its angular velocity), bounces off the floor that
// lose speed and spin, friction that lets it roll and slide to a stop, the arena's wall, and a
// slow sink into the ground at the end of its life. Chunks of hot technique craters glow and cool.
// One irregular chunk mesh is instanced for all of them; each chunk stretches and squashes it
// by its kind and seed (stone lumps, wood splinters, roof-tile shards, ice crystals, paper
// scraps) and draws it with flat toon facets and an ink hull.
//
// Layout (24 floats): pos.xyz life | vel.xyz maxLife | quat xyzw | angVel.xyz size |
//                     colour rgb kind | seed state heat bounces

const DEBRIS_STONE = 0;
const DEBRIS_WOOD = 1;
const DEBRIS_TILE = 2;
const DEBRIS_ICE = 3;
const DEBRIS_PAPER = 4;
const DEBRIS_INK = 5;

struct Chunk {
    pos: vec3f,
    life: f32,
    vel: vec3f,
    maxLife: f32,
    q: vec4f,
    angVel: vec3f,
    size: f32,
    color: vec3f,
    kind: f32,
    seed: f32,
    state: f32,      // 0 flying, 1 resting
    heat: f32,
    bounces: f32,
}

struct DebrisSim {
    dt: f32,
    time: f32,
    gravity: f32,
    ground: f32,
    arena: vec4f,       // centre x, z, radius (0 = none), bounce
    wind: vec4f,        // xyz, gust strength
    shocks: array<vec4f, 4>,   // centre xyz, radius of an expanding shockwave (0 = none)
    count: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
}

// --- quaternions -------------------------------------------------------------------------------------------------

// (quatMul, quatRotate, quatAxisAngle come from vb_math)

// turn q by angular velocity w (radians per second) over dt
fn quatIntegrate(q: vec4f, w: vec3f, dt: f32) -> vec4f {
    let a = length(w) * dt;
    if (a < 1e-6) {
        return q;
    }
    let axis = w / max(length(w), 1e-6);
    let dq = vec4f(axis * sin(a * 0.5), cos(a * 0.5));
    return normalize(quatMul(dq, q));
}

// the rotation that takes direction a onto direction b
fn quatFromTo(a: vec3f, b: vec3f) -> vec4f {
    let c = cross(a, b);
    let d = dot(a, b);
    if (d < -0.9999) {
        let ax = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(a.x) < 0.9);
        return quatAxisAngle(normalize(cross(a, ax)), PI);
    }
    return normalize(vec4f(c, 1.0 + d));
}

fn quatSlerpN(a: vec4f, b0: vec4f, t: f32) -> vec4f {
    var b = b0;
    if (dot(a, b) < 0.0) {
        b = -b;
    }
    return normalize(mix(a, b, t));
}

// --- shapes --------------------------------------------------------------------------------------------------------

// how a chunk's kind and seed stretch the shared chunk mesh (local axes x, y, z)
fn debrisShapeScale(kind: i32, seed: f32) -> vec3f {
    let h = vec3f(hash11(seed * 13.1), hash11(seed * 7.7 + 1.0), hash11(seed * 3.3 + 2.0));
    switch kind {
        case 1: {
            // wood: a long splinter
            return vec3f(0.35 + h.x * 0.2, 0.3 + h.y * 0.15, 1.8 + h.z * 1.4);
        }
        case 2: {
            // roof tile / floor tile shard: a flat slab
            return vec3f(1.0 + h.x * 0.5, 0.22 + h.y * 0.1, 0.8 + h.z * 0.6);
        }
        case 3: {
            // ice: a tall crystal
            return vec3f(0.55 + h.x * 0.2, 1.6 + h.y * 1.0, 0.55 + h.z * 0.2);
        }
        case 4: {
            // paper: a thin scrap
            return vec3f(1.2 + h.x * 0.6, 0.05, 0.9 + h.z * 0.5);
        }
        case 5: {
            // ink: a rounded blob
            return vec3f(0.9 + h.x * 0.3, 0.7 + h.y * 0.3, 0.9 + h.z * 0.3);
        }
        default: {
            // stone: an irregular lump
            return vec3f(0.75 + h.x * 0.5, 0.6 + h.y * 0.45, 0.75 + h.z * 0.5);
        }
    }
}

// a further per-vertex dent so no two lumps look alike
fn debrisDent(p: vec3f, seed: f32) -> f32 {
    return 0.82 + 0.3 * valueNoise3(p * 2.3 + vec3f(seed * 17.0));
}

// the lowest point of the chunk below its centre (to rest it on the floor)
fn debrisHalfHeight(q: vec4f, scale: vec3f, size: f32) -> f32 {
    let ax = abs(quatRotate(q, vec3f(scale.x, 0.0, 0.0)).y);
    let ay = abs(quatRotate(q, vec3f(0.0, scale.y, 0.0)).y);
    let az = abs(quatRotate(q, vec3f(0.0, 0.0, scale.z)).y);
    return (ax + ay + az) * 0.5 * size * 0.62;
}

// --- simulation ---------------------------------------------------------------------------------------------------

fn debrisStep(c0: Chunk, s: DebrisSim) -> Chunk {
    var c = c0;
    let dt = s.dt;
    c.life = c.life - dt;
    c.heat = c.heat * exp(-dt * 0.6);
    let kind = i32(c.kind + 0.5);
    let scale = debrisShapeScale(kind, c.seed);
    let lightweight = kind == DEBRIS_PAPER;
    // the end of its life: it sinks into the floor
    if (c.life < 0.6) {
        c.pos.y = c.pos.y - dt * c.size * 1.5;
        return c;
    }
    if (c.state < 0.5) {
        // flying: gravity, drag, wind on light things, shockwaves
        let drag = select(0.15, 2.2, lightweight);
        c.vel.y = c.vel.y + s.gravity * dt * select(1.0, 0.25, lightweight);
        c.vel = c.vel * exp(-dt * drag);
        if (lightweight) {
            let flutter = vec3f(sin(s.time * 3.0 + c.seed * 40.0), 0.0, cos(s.time * 2.3 + c.seed * 30.0)) * 1.5;
            c.vel = c.vel + (s.wind.xyz + flutter) * dt;
        }
        for (var k = 0; k < 4; k++) {
            let sh = s.shocks[k];
            if (sh.w > 0.0) {
                let d = c.pos - sh.xyz;
                let dist = length(d);
                let front = 1.0 - smoothstep(0.0, 1.5, abs(dist - sh.w));
                c.vel = c.vel + normalize(d + vec3f(0.0, 0.3, 0.0)) * front * 14.0 * dt / max(c.size * 4.0, 0.3);
            }
        }
        c.pos = c.pos + c.vel * dt;
        c.q = quatIntegrate(c.q, c.angVel, dt);
        // the floor: bounce, losing speed and spin, then slide and roll to a stop
        let hh = debrisHalfHeight(c.q, scale, c.size);
        let floorY = s.ground + hh;
        if (c.pos.y < floorY) {
            c.pos.y = floorY;
            if (c.vel.y < 0.0) {
                let restitution = select(0.32, 0.05, lightweight);
                c.vel.y = -c.vel.y * restitution;
                c.vel.x = c.vel.x * 0.62;
                c.vel.z = c.vel.z * 0.62;
                // the impact turns it: spin follows the slide
                c.angVel = c.angVel * 0.55 + vec3f(c.vel.z, 0.0, -c.vel.x) * 1.6 / max(c.size, 0.05);
                c.bounces = c.bounces + 1.0;
            }
            if (abs(c.vel.y) < 0.6 && length(c.vel.xz) < 0.5) {
                c.state = 1.0;
                c.vel = vec3f(0.0);
            }
        }
        // the arena wall
        if (s.arena.z > 0.0) {
            let off = c.pos.xz - s.arena.xy;
            let r = length(off);
            if (r > s.arena.z) {
                let n = off / r;
                c.pos = vec3f(s.arena.x + n.x * s.arena.z, c.pos.z, s.arena.y + n.y * s.arena.z);
                let vn = dot(c.vel.xz, n);
                if (vn > 0.0) {
                    let vxz = c.vel.xz - n * vn * (1.0 + s.arena.w);
                    c.vel = vec3f(vxz.x, c.vel.y, vxz.y);
                }
            }
        }
    } else {
        // resting: settle onto its broadest face (its thinnest axis turned to the floor), stay put
        var ax = vec3f(0.0, 1.0, 0.0);
        if (scale.x <= scale.y && scale.x <= scale.z) {
            ax = vec3f(1.0, 0.0, 0.0);
        } else if (scale.z <= scale.y) {
            ax = vec3f(0.0, 0.0, 1.0);
        }
        var down = quatRotate(c.q, ax);
        if (down.y > 0.0) {
            down = -down;
        }
        let settled = quatMul(quatFromTo(down, vec3f(0.0, -1.0, 0.0)), c.q);
        c.q = quatSlerpN(c.q, settled, min(1.0, dt * 3.0));
        c.angVel = vec3f(0.0);
        c.pos.y = mix(c.pos.y, s.ground + debrisHalfHeight(c.q, scale, c.size), min(1.0, dt * 6.0));
        // a shockwave can throw it again
        for (var k = 0; k < 4; k++) {
            let sh = s.shocks[k];
            if (sh.w > 0.0 && abs(length(c.pos - sh.xyz) - sh.w) < 0.6) {
                c.state = 0.0;
                c.vel = normalize(c.pos - sh.xyz + vec3f(0.0, 0.8, 0.0)) * 4.0;
                c.angVel = vec3f(hash11(c.seed * 3.0) - 0.5, hash11(c.seed * 5.0) - 0.5, hash11(c.seed * 7.0) - 0.5) * 14.0;
            }
        }
    }
    return c;
}

// --- shading -------------------------------------------------------------------------------------------------------

// the colour of a chunk's facet: its own colour varied per facet, darker in cracks and
// underneath, dust on its upper faces, glowing seams while it is hot
fn debrisAlbedo(base: vec3f, kind: i32, local: vec3f, n: vec3f, seed: f32) -> vec3f {
    var c = base * (0.85 + 0.3 * hash13(floor(local * 6.0) + vec3f(seed * 11.0)));
    if (kind == DEBRIS_WOOD) {
        // grain along the splinter, a paler broken end
        let grain = 0.85 + 0.15 * sin(local.x * 60.0 + valueNoise3(local * 8.0) * 6.0);
        c = c * grain;
        c = mix(c, base * 1.35, smoothstep(0.75, 0.95, abs(local.z)));
    } else if (kind == DEBRIS_TILE) {
        // a glazed top, raw clay where it broke
        c = mix(base * 1.25 + vec3f(0.05), c, smoothstep(0.4, 0.7, abs(n.y)));
    } else if (kind == DEBRIS_ICE) {
        c = mix(vec3f(0.75, 0.88, 0.98), vec3f(0.95, 0.98, 1.0), smoothstep(0.3, 0.9, n.y));
    } else if (kind == DEBRIS_PAPER) {
        c = vec3f(0.95, 0.92, 0.85) * (0.9 + 0.1 * hash11(seed));
    } else if (kind == DEBRIS_INK) {
        c = vec3f(0.04, 0.02, 0.05);
    } else {
        // stone: speckle
        c = c * (0.92 + 0.16 * step(0.8, valueNoise3(local * 25.0 + seed)));
    }
    // dust settled on the upper faces
    c = mix(c, c * 0.6 + vec3f(0.3, 0.28, 0.25), smoothstep(0.5, 0.9, n.y) * 0.25 * f32(kind == DEBRIS_STONE || kind == DEBRIS_TILE));
    return c;
}

// hot chunks (from a technique's crater): glowing seams that cool from white to red to nothing
fn debrisHeatGlow(local: vec3f, heat: f32, palBody: vec3f, palCore: vec3f, seed: f32) -> vec3f {
    if (heat <= 0.01) {
        return vec3f(0.0);
    }
    let v = abs(valueNoise3(local * 5.0 + vec3f(seed * 9.0)) - 0.5);
    let seam = 1.0 - smoothstep(0.02, 0.08 + heat * 0.06, v);
    let col = mix(palBody, palCore, smoothstep(0.5, 1.0, heat));
    return col * seam * heat * 3.0;
}
