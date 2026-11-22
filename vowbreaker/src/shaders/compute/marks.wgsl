// Ground marks (vb_ground_marks): one pass per frame over the arena floor's two mark textures.
// Every texel ages (heat cools, frost melts), then takes in this frame's stamps (craters, scorch,
// ink, skids, prints, frost, slashes, seals, debris, clears). Reads the previous textures, writes
// the next (ping-pong).
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_sdf2d>
#include<vb_ground_marks>

struct MarksParams {
    grid: vec2f,
    centre: vec2f,
    worldSize: f32,
    dt: f32,
    time: f32,
    count: f32,
    stamps: array<vec4f, 48>,
}

@group(0) @binding(0) var<uniform> prm: MarksParams;
@group(0) @binding(1) var srcA: texture_2d<f32>;
@group(0) @binding(2) var srcB: texture_2d<f32>;
@group(0) @binding(3) var dstA: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var dstB: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    if (f32(gid.x) >= prm.grid.x || f32(gid.y) >= prm.grid.y) {
        return;
    }
    let c = vec2i(gid.xy);
    // the texel's place on the floor (x right, y = world z)
    let uv = (vec2f(c) + 0.5) / prm.grid;
    let p = prm.centre + (uv - 0.5) * prm.worldSize;
    var f = markAge(textureLoad(srcA, c, 0), textureLoad(srcB, c, 0), prm.dt);
    let n = i32(prm.count + 0.5);
    for (var i = 0; i < 16; i++) {
        if (i >= n) {
            break;
        }
        let s = markStampFrom(prm.stamps[i * 3], prm.stamps[i * 3 + 1], prm.stamps[i * 3 + 2]);
        if (length(p - s.pos) > markReach(s)) {
            continue;
        }
        f = markCombine(f.a, f.b, p, s);
    }
    textureStore(dstA, c, clamp(f.a, vec4f(0.0), vec4f(2.0)));
    textureStore(dstB, c, clamp(f.b, vec4f(0.0), vec4f(2.0)));
}
