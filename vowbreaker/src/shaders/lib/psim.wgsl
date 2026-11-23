// Particle behaviours for the compute simulation (compute/particles.wgsl) and the shapes they draw
// as (particle.fragment). Each particle carries 20 floats:
//   pos.xyz life | vel.xyz maxLife | color.rgba | size kind seed drag | rot spin state extra
// `state` is a small machine per kind (0 flying, 1 resting on the ground, 2 sliding, 3 dying);
// `extra` holds a kind's own memory (bounces taken, heat, how long it has rested).
//
// Kinds (PK in GpuParticles.ts):
//   0 spark    fast, heavy drag, bounces twice losing most of its energy, then dies
//   1 ember    rises on its own heat, cools (heat in extra) and sinks as it cools, swirls
//   2 debris   tumbles (spin), falls hard, bounces once, rolls to a stop and rests
//   3 petal    flutters: lift depends on its angle of attack, it rocks side to side, settles
//   4 paper    like a petal but stiffer and larger; slides along the ground in wind
//   5 smoke    buoyant, slows, grows (size in extra)
//   6 ash      falls slowly in a spiral
//   7 drop     ballistic; dies on landing
//   8 ink      a blob that stretches along its velocity and slows to a stop
//   9 dust     rises a little and spreads, heavy drag
//  10 snow     drifts down, sways, rests
//  11 rain     fast streak, dies on landing
//  12 bubble   rises, wobbles, pops at the end
//  13 firefly  wanders slowly, blinks
//  14 feather  falls slowly with a pendulum sway
//  15 glyph    a talisman character rising and turning, burning out
//  16 leaf     like a petal, heavier, tumbles while falling
//  17 tear     a drop that falls slowly (the Bride's tears), leaves a short trail

struct PSim {
    dt: f32,
    time: f32,
    gravity: f32,
    turbulence: f32,
    attract: vec4f,      // xyz point, w strength
    wind: vec4f,         // xyz wind, w ground height
    vortex: vec4f,       // xyz centre, w angular strength (domains, tornadoes)
    arena: vec4f,        // xz centre, radius (0 = none), wall bounce
    shocks: array<vec4f, 4>, // xyz centre, w radius of an expanding shockwave (pushes outward)
    count: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
}

const PS_FLY: f32 = 0.0;
const PS_REST: f32 = 1.0;
const PS_SLIDE: f32 = 2.0;

// per-kind constants: (gravity scale, turbulence scale, wind response, bounce)
fn psKindPhysics(kind: i32) -> vec4f {
    switch kind {
        case 0: { return vec4f(0.7, 0.15, 0.1, 0.45); }
        case 1: { return vec4f(-0.18, 1.6, 0.5, 0.2); }
        case 2: { return vec4f(1.2, 0.1, 0.05, 0.3); }
        case 3: { return vec4f(0.1, 2.0, 1.2, 0.0); }
        case 4: { return vec4f(0.14, 1.6, 1.0, 0.0); }
        case 5: { return vec4f(-0.1, 1.3, 0.8, 0.0); }
        case 6: { return vec4f(0.05, 1.0, 1.0, 0.0); }
        case 7: { return vec4f(1.0, 0.1, 0.2, 0.0); }
        case 8: { return vec4f(0.6, 0.4, 0.2, 0.0); }
        case 9: { return vec4f(-0.02, 1.2, 0.9, 0.0); }
        case 10: { return vec4f(0.05, 0.9, 1.0, 0.0); }
        case 11: { return vec4f(2.0, 0.0, 0.4, 0.0); }
        case 12: { return vec4f(-0.12, 0.8, 0.5, 0.0); }
        case 13: { return vec4f(0.0, 0.6, 0.3, 0.0); }
        case 14: { return vec4f(0.06, 1.2, 1.0, 0.0); }
        case 15: { return vec4f(-0.12, 0.6, 0.4, 0.0); }
        case 16: { return vec4f(0.16, 1.6, 1.1, 0.0); }
        default: { return vec4f(0.25, 0.1, 0.2, 0.0); }
    }
}

// gusting wind: the steady wind, modulated by slow noise in space and time
fn psWind(p: vec3f, wind: vec3f, time: f32) -> vec3f {
    let g = valueNoise3(p * 0.08 + vec3f(time * 0.25, 0.0, time * 0.1));
    return wind * (0.4 + 1.2 * g);
}

// a vortex round a vertical axis through c (domains swirling things round the arena)
fn psVortex(p: vec3f, v: vec4f) -> vec3f {
    if (v.w == 0.0) {
        return vec3f(0.0);
    }
    let d = p.xz - v.xz;
    let r = max(length(d), 0.5);
    let tangent = vec2f(-d.y, d.x) / r;
    let inward = -d / r * 0.25;
    let s = v.w / (1.0 + r * 0.15);
    return vec3f(tangent.x + inward.x, 0.15, tangent.y + inward.y) * s;
}

// shockwaves: a thin expanding shell that shoves what it passes outward
fn psShocks(p: vec3f, shocks: array<vec4f, 4>) -> vec3f {
    var a = vec3f(0.0);
    for (var k = 0; k < 4; k++) {
        let s = shocks[k];
        if (s.w <= 0.0) {
            continue;
        }
        let d = p - s.xyz;
        let r = length(d);
        let shell = exp(-sqr((r - s.w) * 2.0));
        a = a + d / max(r, 0.1) * shell * 60.0;
    }
    return a;
}

// fluttering: a flat thing falling feels lift when tilted and rocks from side to side
fn psFlutter(vel: vec3f, rot: f32, spin: f32, time: f32, seed: f32) -> vec3f {
    let tilt = sin(rot);
    let rock = sin(time * (2.0 + seed * 2.0) + seed * 20.0);
    let lift = -vel.y * abs(tilt) * 1.4;
    let side = vec3f(cos(seed * 6.28), 0.0, sin(seed * 6.28)) * rock * 1.6;
    return vec3f(side.x, lift, side.z) - vec3f(0.0, abs(spin) * 0.02, 0.0);
}

// the whole step for one particle; returns the updated values through the struct
struct PState {
    pos: vec3f,
    vel: vec3f,
    life: f32,
    size: f32,
    rot: f32,
    spin: f32,
    state: f32,
    extra: f32,
}

fn psStep(s0: PState, kind: i32, maxLife: f32, seed: f32, drag: f32, prm: PSim) -> PState {
    var s = s0;
    let dt = prm.dt;
    s.life = s.life - dt;
    let k = psKindPhysics(kind);
    let ground = prm.wind.w;

    // resting things: stay, slide in strong wind, fade at the end of their life
    if (s.state == PS_REST) {
        s.extra = s.extra + dt;
        let w = psWind(s.pos, prm.wind.xyz, prm.time);
        if ((kind == 4 || kind == 3 || kind == 16) && length(w) > 2.5) {
            s.state = PS_SLIDE;
        }
        // smoke and dust never rest
        return s;
    }
    if (s.state == PS_SLIDE) {
        let w = psWind(s.pos, prm.wind.xyz, prm.time);
        s.vel = vec3f(w.x * 0.6, 0.0, w.z * 0.6);
        s.pos = s.pos + s.vel * dt;
        s.rot = s.rot + length(s.vel.xz) * dt * 2.0;
        if (length(w) < 1.5) {
            s.state = PS_REST;
        }
        return s;
    }

    var acc = vec3f(0.0, prm.gravity * k.x, 0.0);
    // embers: buoyancy fades as they cool (extra = heat 1..0)
    if (kind == 1) {
        s.extra = max(s.extra - dt * 0.6, 0.0);
        acc.y = -prm.gravity * mix(-0.15, 0.25, s.extra);
    }
    // smoke grows and slows
    if (kind == 5) {
        s.size = s.size * (1.0 + dt * 0.6);
    }
    // turbulence: curl noise, stronger for light things
    let turb = prm.turbulence * k.y;
    if (turb > 0.0) {
        acc = acc + curl3(s.pos * 0.5 + vec3f(0.0, prm.time * 0.25, seed * 9.0)) * turb;
    }
    // wind, vortex, attraction, shocks
    acc = acc + psWind(s.pos, prm.wind.xyz, prm.time) * k.z;
    acc = acc + psVortex(s.pos, prm.vortex);
    if (prm.attract.w != 0.0) {
        let d = prm.attract.xyz - s.pos;
        let l = max(length(d), 0.3);
        acc = acc + d / l * prm.attract.w / (1.0 + l * l * 0.2);
    }
    acc = acc + psShocks(s.pos, prm.shocks) * select(1.0, 0.3, kind == 2);
    // flat things flutter
    if (kind == 3 || kind == 4 || kind == 14 || kind == 16) {
        acc = acc + psFlutter(s.vel, s.rot, s.spin, prm.time, seed);
    }
    // fireflies wander: steer toward a slowly moving goal near where they were born
    if (kind == 13) {
        let goal = vec3f(sin(prm.time * 0.3 + seed * 20.0), 0.5 + 0.5 * sin(prm.time * 0.5 + seed * 7.0), cos(prm.time * 0.27 + seed * 13.0)) * 1.5;
        acc = acc + (goal - s.vel) * 0.8;
    }
    // bubbles wobble
    if (kind == 12) {
        acc = acc + vec3f(sin(prm.time * 6.0 + seed * 30.0), 0.0, cos(prm.time * 5.0 + seed * 17.0)) * 1.5;
    }
    s.vel = s.vel + acc * dt;
    s.vel = s.vel * exp(-drag * dt);
    s.pos = s.pos + s.vel * dt;
    s.rot = s.rot + s.spin * dt;

    // the arena wall (a cylinder): things bounce off it rather than leave the fight
    if (prm.arena.z > 0.0) {
        let d = s.pos.xz - prm.arena.xy;
        let r = length(d);
        if (r > prm.arena.z) {
            let n = d / r;
            let push = prm.arena.xy + n * prm.arena.z;
            s.pos = vec3f(push.x, s.pos.y, push.y);
            let vn = dot(s.vel.xz, n);
            if (vn > 0.0) {
                let v2 = s.vel.xz - n * vn * (1.0 + prm.arena.w);
                s.vel = vec3f(v2.x, s.vel.y, v2.y);
            }
        }
    }

    // the ground
    let floorY = ground + s.size * 0.3;
    if (s.pos.y < floorY) {
        s.pos.y = floorY;
        switch kind {
            case 7, 11, 17: {
                s.life = min(s.life, 0.04);
            }
            case 0: {
                // sparks: bounce, losing energy; after two bounces they die
                s.extra = s.extra + 1.0;
                s.vel = vec3f(s.vel.x * 0.5, abs(s.vel.y) * k.w, s.vel.z * 0.5);
                if (s.extra >= 2.0) {
                    s.life = min(s.life, 0.08);
                }
            }
            case 2: {
                // debris: one bounce, then it rolls and rests
                if (s.extra < 1.0 && abs(s.vel.y) > 1.5) {
                    s.extra = 1.0;
                    s.vel = vec3f(s.vel.x * 0.6, abs(s.vel.y) * k.w, s.vel.z * 0.6);
                    s.spin = s.spin * 0.6;
                } else {
                    s.vel = vec3f(s.vel.x * 0.85, 0.0, s.vel.z * 0.85);
                    s.spin = s.spin * 0.85;
                    if (length(s.vel.xz) < 0.2) {
                        s.state = PS_REST;
                        s.extra = 0.0;
                    }
                }
            }
            case 3, 4, 10, 14, 16, 6: {
                // light flat things settle where they land
                s.vel = vec3f(0.0);
                s.spin = 0.0;
                s.rot = select(0.0, 3.14159, fract(seed * 7.0) > 0.5);
                s.state = PS_REST;
                s.extra = 0.0;
            }
            default: {
                if (s.vel.y < 0.0) {
                    s.vel = vec3f(s.vel.x * 0.6, -s.vel.y * k.w, s.vel.z * 0.6);
                }
            }
        }
    }
    // bubbles pop near the end of their life
    if (kind == 12 && s.life < maxLife * 0.05) {
        s.size = s.size * (1.0 + dt * 20.0);
    }
    return s;
}

// --- shapes (particle.fragment) ----------------------------------------------------------------------------

// a sakura petal: an oval with a notch at its tip (p in -1..1)
fn psPetal(p: vec2f) -> f32 {
    let body = length(p * vec2f(1.0, 0.65) + vec2f(0.0, 0.15)) - 0.62;
    let notch = length(p - vec2f(0.0, 0.82)) - 0.28;
    return max(body, -notch);
}

// a leaf: a vesica with a midrib (returns (distance, rib))
fn psLeaf(p: vec2f) -> vec2f {
    let d = sdVesica(p.yx, 0.9, 0.55);
    let rib = 1.0 - smoothstep(0.0, 0.05, abs(p.x));
    return vec2f(d, rib);
}

// a six-armed snowflake
fn psSnow(p: vec2f) -> f32 {
    let r = opPolarRepeat(p, 6.0);
    let arm = sdSegment2(r.xy, vec2f(0.0), vec2f(0.85, 0.0)) - 0.06;
    let barbs = sdSegment2(vec2f(r.x - 0.45, abs(r.y)), vec2f(0.0), vec2f(0.22, 0.2)) - 0.04;
    return min(min(arm, barbs), length(p) - 0.15);
}

// a feather: a curved shaft with vanes
fn psFeather(p: vec2f) -> vec2f {
    let bend = p.x + 0.15 * p.y * p.y;
    let shaft = 1.0 - smoothstep(0.0, 0.04, abs(bend));
    let width = 0.42 * (1.0 - p.y * p.y) * step(-0.95, p.y) * step(p.y, 0.95);
    let vane = abs(bend) - width;
    let barbs = 0.5 + 0.5 * sin((p.y + abs(bend) * 0.8) * 40.0);
    return vec2f(vane, shaft + barbs * 0.15);
}

// a teardrop pointing along -y
fn psTear(p: vec2f) -> f32 {
    let q = vec2f(p.x, p.y + 0.25);
    let ball = length(q) - 0.45;
    let tip = sdTaperedSegment2(p, vec2f(0.0, -0.1), vec2f(0.0, 0.85), 0.42, 0.02);
    return min(ball, tip);
}
