// Flocks (src/render/Flock.ts, compute/flock.wgsl, flock.vertex / flock.fragment): living things in
// the air over a place, simulated as boids and drawn as instanced little meshes.
//
//   0 paper cranes   folded white paper, slow wingbeats, gliding in a wide ring (the estate)
//   1 butterflies    fluttering erratically, wings opening and closing fast (the spring graves)
//   2 crows          black with a blue sheen, ragged wingbeats, circling high (the burning village)
//   3 small birds    quick wingbeats with glides, swirling in a tight flock (the dawn academy)
//
// Each agent: pos.xyz phase | vel.xyz kind | home.xyz seed  (12 floats)

struct Bird {
    pos: vec3f,
    phase: f32,
    vel: vec3f,
    kind: f32,
    home: vec3f,
    seed: f32,
}

struct FlockSim {
    dt: f32,
    time: f32,
    count: u32,
    pad0: u32,
    centre: vec4f,      // xyz, ring radius
    avoid: vec4f,       // a sphere to stay out of (the fight): xyz, radius
    wind: vec4f,        // xyz, -
    scare: vec4f,       // a burst that scatters them: xyz, strength
}

// how each kind flies: speed range, how tight the flock is, how much it wanders, wingbeat rate
struct FlightStyle {
    minSpeed: f32,
    maxSpeed: f32,
    cohesion: f32,
    alignment: f32,
    separation: f32,
    wander: f32,
    beat: f32,
    glide: f32,
}

fn flightStyle(kind: i32) -> FlightStyle {
    switch kind {
        case 0: {
            return FlightStyle(2.0, 4.0, 0.3, 0.6, 1.2, 0.4, 1.3, 0.5);
        }
        case 1: {
            return FlightStyle(0.6, 1.8, 0.05, 0.05, 0.8, 3.0, 9.0, 0.0);
        }
        case 2: {
            return FlightStyle(3.0, 6.0, 0.25, 0.4, 1.5, 0.8, 2.2, 0.3);
        }
        default: {
            return FlightStyle(4.0, 8.0, 0.9, 1.0, 1.8, 0.6, 7.0, 0.35);
        }
    }
}

// one step of a bird's flight, given what its neighbours of the same kind are doing (their summed
// positions and velocities within reach, the push away from those too close, how many there were)
fn flockSteer(b0: Bird, coh: vec3f, ali: vec3f, sep: vec3f, n: f32, s: FlockSim) -> Bird {
    var b = b0;
    let kind = i32(b.kind + 0.5);
    let st = flightStyle(kind);
    var acc = vec3f(0.0);
    if (n > 0.0) {
        acc = acc + (coh / n - b.pos) * st.cohesion;
        acc = acc + (ali / n - b.vel) * st.alignment;
    }
    acc = acc + sep * st.separation;
    // circle the place: pulled toward a ring round the centre at their own height
    let toC = b.pos - s.centre.xyz;
    let flat = vec3f(toC.x, 0.0, toC.z);
    let r = length(flat);
    let radial = flat / max(r, 0.01);
    let tangent = vec3f(-radial.z, 0.0, radial.x) * select(-1.0, 1.0, hash11(b.seed * 3.0) > 0.3);
    acc = acc + tangent * 1.2 - radial * (r - s.centre.w) * 0.35;
    acc.y = acc.y + (b.home.y - b.pos.y) * 0.8;
    // wander: curl-ish noise steering
    let w = vec3f(valueNoise2(vec2f(s.time * 0.4, b.seed * 13.0)) - 0.5, (valueNoise2(vec2f(s.time * 0.3, b.seed * 7.0)) - 0.5) * 0.4, valueNoise2(vec2f(b.seed * 5.0, s.time * 0.4)) - 0.5);
    acc = acc + w * st.wander * 4.0;
    // keep out of the fight
    let toA = b.pos - s.avoid.xyz;
    let da = length(toA);
    if (da < s.avoid.w) {
        acc = acc + toA / max(da, 0.1) * (s.avoid.w - da) * 3.0;
    }
    // scattered by a blast
    if (s.scare.w > 0.0) {
        let ds = b.pos - s.scare.xyz;
        acc = acc + normalize(ds + vec3f(0.0, 1.0, 0.0)) * s.scare.w * 30.0 / (1.0 + dot(ds, ds) * 0.05);
    }
    acc = acc + s.wind.xyz * 0.3;
    b.vel = b.vel + acc * s.dt;
    // clamp speed to the kind's range
    let sp = length(b.vel);
    let want = clamp(sp, st.minSpeed, st.maxSpeed + s.scare.w * 6.0);
    b.vel = b.vel / max(sp, 1e-3) * want;
    b.pos = b.pos + b.vel * s.dt;
    b.pos.y = max(b.pos.y, 1.5);
    // the wingbeat: faster when climbing, a glide now and then
    let climbing = clamp(b.vel.y * 0.5, -0.5, 1.0);
    let gliding = step(1.0 - st.glide, valueNoise2(vec2f(s.time * 0.5, b.seed * 3.0)));
    b.phase = b.phase + s.dt * st.beat * (1.0 + climbing) * (1.0 - gliding * 0.85);
    return b;
}

// --- drawing ---------------------------------------------------------------------------------------------------

// the wing angle for a part of the template (uv.x: 0 body, 1 left wing, 2 right wing, 3 head/tail)
fn birdWingAngle(kind: i32, phase: f32) -> f32 {
    switch kind {
        case 0: {
            // a paper crane's wings stand in a V (as folded), beating slowly about it
            return sin(phase * TAU) * 0.4 + 0.45;
        }
        case 1: {
            // butterflies clap their wings almost shut and open them flat
            return (sin(phase * TAU) * 0.5 + 0.5) * 1.3;
        }
        case 2: {
            return sin(phase * TAU) * 0.6 + 0.1 * sin(phase * TAU * 3.0);
        }
        default: {
            return sin(phase * TAU) * 0.8;
        }
    }
}

// the shape each kind gives the template (scale of wings vs body)
fn birdScale(kind: i32) -> vec3f {
    switch kind {
        case 0: {
            return vec3f(1.0, 0.9, 0.9);
        }
        case 1: {
            return vec3f(0.22, 0.18, 0.18);
        }
        case 2: {
            return vec3f(0.75, 0.5, 0.65);
        }
        default: {
            return vec3f(0.32, 0.22, 0.28);
        }
    }
}

fn birdColor(kind: i32, part: f32, along: f32, seed: f32, lit: f32, sunCol: vec3f, sky: vec3f) -> vec3f {
    var base = vec3f(0.95);
    switch kind {
        case 0: {
            // folded paper: two tones by the fold, a red line along the wing's edge
            base = mix(vec3f(0.97, 0.95, 0.9), vec3f(0.82, 0.8, 0.78), step(0.5, fract(along * 2.0)));
            base = mix(base, vec3f(0.75, 0.1, 0.08), step(0.9, along) * step(0.5, part) * step(part, 2.5));
        }
        case 1: {
            // butterfly wings: orange or pale yellow, veined and edged in black with white spots
            let orange = mix(vec3f(0.95, 0.5, 0.1), vec3f(0.98, 0.92, 0.55), step(0.5, hash11(seed * 7.0)));
            let edge = step(0.82, along);
            let vein = step(0.85, fract(along * 5.0));
            base = mix(orange, vec3f(0.05), max(edge, vein * 0.7));
            base = mix(base, vec3f(1.0), edge * step(0.7, fract(along * 13.0)));
            base = select(base, vec3f(0.08), part < 0.5);
        }
        case 2: {
            base = vec3f(0.04, 0.04, 0.06);
        }
        default: {
            base = mix(vec3f(0.35, 0.28, 0.22), vec3f(0.85, 0.8, 0.72), step(1.5, part) * 0.0 + step(0.6, along) * 0.3);
        }
    }
    var c = base * (sky * 0.5 + sunCol * lit * 0.7 + vec3f(0.1));
    // crows have a blue sheen in the light
    if (kind == 2) {
        c = c + vec3f(0.1, 0.15, 0.3) * lit * 0.6;
    }
    return c;
}
