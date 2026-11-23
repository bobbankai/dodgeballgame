// GPU particle simulation (WebGPU compute). The CPU writes newly spawned particles straight into
// a ring buffer; this pass moves every live particle with its kind's behaviour (vb_psim): gravity
// and buoyancy, curl-noise turbulence, gusting wind, vortices, attraction (cursed energy
// gathering), shockwaves shoving things outward, fluttering for flat things, the arena wall,
// bounces, rolling, and settling on the ground.
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_psim>

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
    rot: f32,
    spin: f32,
    state: f32,
    extra: f32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: PSim;

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
    var s: PState;
    s.pos = p.pos;
    s.vel = p.vel;
    s.life = p.life;
    s.size = p.size;
    s.rot = p.rot;
    s.spin = p.spin;
    s.state = p.state;
    s.extra = p.extra;
    let kind = i32(p.kind + 0.5);
    s = psStep(s, kind, p.maxLife, p.seed, p.drag, params);
    p.pos = s.pos;
    p.vel = s.vel;
    p.life = s.life;
    p.size = s.size;
    p.rot = s.rot;
    p.spin = s.spin;
    p.state = s.state;
    p.extra = s.extra;
    particles[i] = p;
}
