// Curse rot (vb_curse_rot): one Gray-Scott step per dispatch over the arena's rot texture, then
// this frame's seeds (curses striking) and cleanses. Ping-pong between two textures.
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_curse_rot>

@group(0) @binding(0) var<uniform> prm: RotParams;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let size = vec2i(prm.grid);
    if (i32(gid.x) >= size.x || i32(gid.y) >= size.y) {
        return;
    }
    let c = vec2i(gid.xy);
    let here = textureLoad(src, c, 0);
    let uv = (vec2f(c) + 0.5) / prm.grid;
    let p = prm.centre + (uv - 0.5) * prm.worldSize;
    let lap = rotLaplacian(src, c, size);
    let rates = rotRates(p, prm.feed, prm.kill);
    var ab = rotStep(here.rg, lap, rates.x, rates.y, prm.diffA, prm.diffB, prm.dt);
    var age = here.b;
    // the rot ages where it lives; where it dies its age fades
    age = select(max(age - prm.dt * 0.02, 0.0), min(age + prm.dt * 0.004, 1.0), ab.y > 0.2);
    let n = i32(prm.count + 0.5);
    for (var i = 0; i < 8; i++) {
        if (i >= n) {
            break;
        }
        let s = prm.seeds[i];
        let d = length(p - s.xy);
        if (s.w >= 0.0) {
            // a seed: B poured in, ragged at its edge
            let k = 1.0 - smoothstep(s.z * 0.6, s.z, d + (valueNoise2(p * 3.0) - 0.5) * s.z * 0.4);
            // speckled, so the growth breaks symmetry at once and branches
            let speck = hash12(floor(p * 8.0) + vec2f(f32(i) * 7.0, 3.0));
            // (B poured in strongly: a weak seed is eaten by the clean floor round it before it can grow)
            ab = vec2f(mix(ab.x, 0.5, k * s.w), max(ab.y, k * s.w * 0.9 * max(step(0.45, speck), step(0.6, k))));
        } else {
            // a cleanse: B burnt away, A restored
            let k = 1.0 - smoothstep(s.z * 0.7, s.z, d);
            ab = mix(ab, vec2f(1.0, 0.0), k);
            age = age * (1.0 - k);
        }
    }
    textureStore(dst, c, vec4f(ab, age, 1.0));
}
