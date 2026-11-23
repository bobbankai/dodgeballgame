// 2D fire simulation (vb_fire_sim), one pass per step: semi-Lagrangian transport of heat, smoke
// and velocity along the velocity, buoyancy from heat, cooling, fuel injected along the base, a
// curl-noise breeze. Reads the previous grid (textureLoad, hand-filtered), writes the next.
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_fire_sim>

@group(0) @binding(0) var<uniform> prm: FireParams;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    if (f32(gid.x) >= prm.size.x || f32(gid.y) >= prm.size.y) {
        return;
    }
    let c = vec2i(gid.xy);
    let pos = vec2f(c) + 0.5;
    let here = textureLoad(src, c, 0);
    // carry everything along the velocity (y grows upward in the grid)
    let back = pos - here.ba * prm.dt;
    var cell = fireSample(src, back, prm.size);
    var heat = cell.r;
    var smoke = cell.g;
    var vel = cell.ba;
    // diffusion: heat and motion spread to the neighbours (without it, still air never picks up
    // the heat below: a cell with no velocity only ever samples itself)
    let nl = textureLoad(src, fireClamp(c - vec2i(1, 0), prm.size), 0);
    let nr = textureLoad(src, fireClamp(c + vec2i(1, 0), prm.size), 0);
    let nd = textureLoad(src, fireClamp(c - vec2i(0, 1), prm.size), 0);
    let nu = textureLoad(src, fireClamp(c + vec2i(0, 1), prm.size), 0);
    let avg = (nl + nr + nd + nu) * 0.25;
    heat = mix(heat, avg.r, 0.04);
    smoke = mix(smoke, avg.g, 0.08);
    vel = mix(vel, avg.ba, 0.1);
    // buoyancy: heat rises (the heat just below lifts this cell too); smoke rises a little
    vel.y = vel.y + ((heat + nd.r * 0.8) * prm.buoyancy + smoke * prm.buoyancy * 0.15) * prm.dt;
    // the front: a cell with heat at or just below it starts rising at once (otherwise the heat
    // would only creep forward by diffusion)
    let nd2 = textureLoad(src, fireClamp(c - vec2i(0, 2), prm.size), 0);
    let lift = max(heat, max(nd.r, nd2.r * 0.7));
    vel.y = max(vel.y, prm.buoyancy * 0.55 * smoothstep(0.02, 0.35, lift));
    // a breeze that keeps the tongues licking
    let uv = pos / prm.size;
    let curl = curl2(vec2f(uv.x * 9.0, uv.y * 4.0 - prm.time * 1.5)) * prm.turbulence;
    vel = vel + (curl + vec2f(prm.wind, 0.0)) * prm.dt * (0.3 + heat);
    // sideways motion dies quickly (the tongues lick, they do not smear across the grid)
    vel = vel * exp(-prm.dt * vec2f(4.0, 0.8));
    // cooling: heat turns to smoke as it rises
    let cool = fireCooling(uv, prm.time, prm.cooling) * prm.dt;
    let lost = min(heat, cool);
    heat = heat - lost;
    smoke = smoke + lost * prm.smokeRate - smoke * prm.dt * 0.25;
    // fuel along the base
    if (c.y < 3) {
        let f = fireFuel(uv.x, prm.time, prm.fuel);
        heat = max(heat, f);
        vel.y = max(vel.y, f * 8.0);
    }
    // the top and sides let everything out
    if (c.y >= i32(prm.size.y) - 2 || c.x <= 0 || c.x >= i32(prm.size.x) - 1) {
        heat = heat * 0.5;
        smoke = smoke * 0.5;
    }
    textureStore(dst, c, vec4f(clamp(heat, 0.0, 2.0), clamp(smoke, 0.0, 2.0), clamp(vel, vec2f(-60.0), vec2f(60.0))));
}
