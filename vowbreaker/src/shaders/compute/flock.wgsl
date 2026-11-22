// Flocks (vb_flock): one boids step per dispatch. Each bird sums its neighbours of the same kind
// (within 4 m; the ones within 1 m push it away), then steers (vb_flock flockSteer).
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_flock>

@group(0) @binding(0) var<storage, read_write> birds: array<Bird>;
@group(0) @binding(1) var<uniform> sim: FlockSim;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= sim.count) {
        return;
    }
    let b = birds[i];
    var coh = vec3f(0.0);
    var ali = vec3f(0.0);
    var sep = vec3f(0.0);
    var n = 0.0;
    for (var j = 0u; j < sim.count; j++) {
        if (j == i) {
            continue;
        }
        let o = birds[j];
        if (abs(o.kind - b.kind) > 0.5) {
            continue;
        }
        let d = o.pos - b.pos;
        let dist = length(d);
        if (dist < 4.0) {
            coh = coh + o.pos;
            ali = ali + o.vel;
            n = n + 1.0;
            if (dist < 1.0) {
                sep = sep - d / max(dist * dist, 0.05);
            }
        }
    }
    let next = flockSteer(b, coh, ali, sep, n, sim);
    // (updated in place: a bird may see some neighbours already moved this step, which only blurs
    // the flock's timing by a step)
    birds[i] = next;
}
