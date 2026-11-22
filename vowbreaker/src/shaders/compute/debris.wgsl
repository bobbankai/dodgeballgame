// Debris (vb_debris): every live chunk takes one step of its rigid-body life. The CPU writes new
// chunks straight into the ring buffer; dead ones (life <= 0) are skipped.
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_math>
#include<vb_debris>

@group(0) @binding(0) var<storage, read_write> chunks: array<Chunk>;
@group(0) @binding(1) var<uniform> sim: DebrisSim;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= sim.count) {
        return;
    }
    let c = chunks[i];
    if (c.life <= 0.0) {
        return;
    }
    chunks[i] = debrisStep(c, sim);
}
