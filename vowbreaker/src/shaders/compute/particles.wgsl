// GPU particle simulation (WebGPU compute). The CPU writes newly spawned particles straight into
// a ring buffer; this pass moves every live particle: gravity, drag, curl-noise turbulence,
// attraction to a point (cursed energy gathering), ground bounces with friction, life.
#include<vb_common>
#include<vb_hash>
#include<vb_noise>

struct Particle {
    pos: vec3f,
    life: f32,      // seconds left (<= 0: dead)
    vel: vec3f,
    maxLife: f32,
    color: vec4f,
    size: f32,
    kind: f32,
    seed: f32,
    drag: f32,
}

struct SimParams {
    dt: f32,
    time: f32,
    gravity: f32,
    turbulence: f32,
    attract: vec4f,   // xyz point, w strength
    wind: vec4f,      // xyz wind, w ground height
    count: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SimParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= params.count) {
        return;
    }
    var p = particles[i];
    if (p.life <= 0.0) {
        return;
    }
    let dt = params.dt;
    p.life = p.life - dt;
    let kind = i32(p.kind + 0.5);
    // per-kind physics
    var g = params.gravity;
    var turb = params.turbulence;
    if (kind == 1 || kind == 9) {
        // embers and bell dust rise and wander
        g = -g * 0.15;
        turb = turb * 1.6;
    } else if (kind == 3 || kind == 4) {
        // petals and paper flutter down slowly
        g = g * 0.12;
        turb = turb * 2.2;
    } else if (kind == 5) {
        // smoke rises
        g = -g * 0.08;
        turb = turb * 1.2;
    } else if (kind == 0) {
        g = g * 0.6;
        turb = turb * 0.2;
    }
    var acc = vec3f(0.0, g, 0.0);
    if (turb > 0.0) {
        acc = acc + curl3(p.pos * 0.6 + vec3f(0.0, params.time * 0.3, p.seed)) * turb;
    }
    if (params.attract.w != 0.0) {
        let d = params.attract.xyz - p.pos;
        let l = max(length(d), 0.3);
        acc = acc + d / l * params.attract.w / (1.0 + l * l * 0.2);
    }
    acc = acc + params.wind.xyz * select(0.2, 1.0, kind == 3 || kind == 4 || kind == 6);
    p.vel = p.vel + acc * dt;
    p.vel = p.vel * exp(-p.drag * dt);
    p.pos = p.pos + p.vel * dt;
    // ground
    let ground = params.wind.w;
    if (p.pos.y < ground + p.size * 0.3) {
        p.pos.y = ground + p.size * 0.3;
        if (p.vel.y < 0.0) {
            let bounce = select(0.35, 0.05, kind == 3 || kind == 4 || kind == 7);
            p.vel = vec3f(p.vel.x * 0.6, -p.vel.y * bounce, p.vel.z * 0.6);
        }
        if (kind == 7) {
            // droplets die when they land
            p.life = min(p.life, 0.05);
        }
    }
    particles[i] = p;
}
