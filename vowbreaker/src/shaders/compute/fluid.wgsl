// 2D stable fluids (Stam), one entry point per pass, driven by src/render/Fluid.ts. Velocity lives
// in rg of an rgba16float grid, dye in rgba (rgb colour premultiplied by density in a), pressure
// in r. Every pass reads one or two grids with textureLoad and writes one storage texture.
//
//   splatVelocity / splatDye   add a gaussian blob of velocity or dye
//   curl                       the vorticity (scalar curl) of the velocity
//   vorticity                  push velocity along the curl's gradient (keeps eddies alive)
//   divergence                 how much fluid leaves each cell
//   jacobi                     one relaxation step of the pressure Poisson equation
//   gradient                   subtract the pressure gradient (the field becomes divergence free)
//   advectVelocity / advectDye semi-Lagrangian transport, with dissipation
//   clearPressure              start the pressure solve from a decayed guess
#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_fluid>

@group(0) @binding(0) var<uniform> prm: FluidParams;
@group(0) @binding(1) var srcA: texture_2d<f32>;
@group(0) @binding(2) var srcB: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

fn inside(gid: vec3u) -> bool {
    return f32(gid.x) < prm.size.x && f32(gid.y) < prm.size.y;
}

@compute @workgroup_size(8, 8)
fn splatVelocity(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    let c = vec2i(gid.xy);
    let uv = (vec2f(c) + 0.5) * prm.texel;
    let v = textureLoad(srcA, c, 0);
    let k = fluidSplat(uv, prm.splatPos, prm.splatRadius, prm.size.x / prm.size.y);
    textureStore(dst, c, vec4f(v.xy + prm.splatDir * k, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn splatDye(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    let c = vec2i(gid.xy);
    let uv = (vec2f(c) + 0.5) * prm.texel;
    let d = textureLoad(srcA, c, 0);
    let k = fluidSplat(uv, prm.splatPos, prm.splatRadius, prm.size.x / prm.size.y) * prm.splatColor.a;
    // ink pools: the new dye is laid over what is there, never brighter than full density
    let add = vec4f(prm.splatColor.rgb, 1.0) * k;
    textureStore(dst, c, min(d + add, vec4f(2.0)));
}

@compute @workgroup_size(8, 8)
fn curl(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    let c = vec2i(gid.xy);
    let l = fluidLoad(srcA, c - vec2i(1, 0), prm.size).y;
    let r = fluidLoad(srcA, c + vec2i(1, 0), prm.size).y;
    let b = fluidLoad(srcA, c - vec2i(0, 1), prm.size).x;
    let t = fluidLoad(srcA, c + vec2i(0, 1), prm.size).x;
    textureStore(dst, c, vec4f(0.5 * ((r - l) - (t - b)), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn vorticity(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    // srcA = velocity, srcB = curl
    let c = vec2i(gid.xy);
    let l = abs(fluidLoad(srcB, c - vec2i(1, 0), prm.size).x);
    let r = abs(fluidLoad(srcB, c + vec2i(1, 0), prm.size).x);
    let b = abs(fluidLoad(srcB, c - vec2i(0, 1), prm.size).x);
    let t = abs(fluidLoad(srcB, c + vec2i(0, 1), prm.size).x);
    let w = fluidLoad(srcB, c, prm.size).x;
    var f = 0.5 * vec2f(t - b, r - l);
    f = f / (length(f) + 1e-4) * prm.vorticity * w * vec2f(1.0, -1.0);
    let v = textureLoad(srcA, c, 0).xy + f * prm.dt;
    textureStore(dst, c, vec4f(clamp(v, vec2f(-1000.0), vec2f(1000.0)), 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn divergence(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    let c = vec2i(gid.xy);
    let l = fluidWall(fluidLoad(srcA, c - vec2i(1, 0), prm.size).xy, c - vec2i(1, 0), prm.size).x;
    let r = fluidWall(fluidLoad(srcA, c + vec2i(1, 0), prm.size).xy, c + vec2i(1, 0), prm.size).x;
    let b = fluidWall(fluidLoad(srcA, c - vec2i(0, 1), prm.size).xy, c - vec2i(0, 1), prm.size).y;
    let t = fluidWall(fluidLoad(srcA, c + vec2i(0, 1), prm.size).xy, c + vec2i(0, 1), prm.size).y;
    textureStore(dst, c, vec4f(0.5 * ((r - l) + (t - b)), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn clearPressure(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    let c = vec2i(gid.xy);
    textureStore(dst, c, vec4f(textureLoad(srcA, c, 0).x * 0.8, 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn jacobi(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    // srcA = pressure, srcB = divergence
    let c = vec2i(gid.xy);
    let l = fluidLoad(srcA, c - vec2i(1, 0), prm.size).x;
    let r = fluidLoad(srcA, c + vec2i(1, 0), prm.size).x;
    let b = fluidLoad(srcA, c - vec2i(0, 1), prm.size).x;
    let t = fluidLoad(srcA, c + vec2i(0, 1), prm.size).x;
    let div = textureLoad(srcB, c, 0).x;
    textureStore(dst, c, vec4f((l + r + b + t - div) * 0.25, 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn gradient(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    // srcA = pressure, srcB = velocity
    let c = vec2i(gid.xy);
    let l = fluidLoad(srcA, c - vec2i(1, 0), prm.size).x;
    let r = fluidLoad(srcA, c + vec2i(1, 0), prm.size).x;
    let b = fluidLoad(srcA, c - vec2i(0, 1), prm.size).x;
    let t = fluidLoad(srcA, c + vec2i(0, 1), prm.size).x;
    let v = textureLoad(srcB, c, 0).xy - vec2f(r - l, t - b) * 0.5;
    textureStore(dst, c, vec4f(v, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn advectVelocity(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    // srcA = velocity (the field that moves), srcB = velocity (the field moved)
    let c = vec2i(gid.xy);
    let pos = vec2f(c) + 0.5;
    let v = textureLoad(srcA, c, 0).xy;
    let back = pos - v * prm.dt;
    let moved = fluidSample(srcB, back, prm.size).xy;
    let k = 1.0 / (1.0 + prm.velDissipation * prm.dt);
    textureStore(dst, c, vec4f(moved * k, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn advectDye(@builtin(global_invocation_id) gid: vec3u) {
    _ = srcA;
    _ = srcB;
    if (!inside(gid)) {
        return;
    }
    // srcA = velocity, srcB = dye
    let c = vec2i(gid.xy);
    let pos = vec2f(c) + 0.5;
    let v = textureLoad(srcA, c, 0).xy;
    let back = pos - v * prm.dt;
    let moved = fluidSample(srcB, back, prm.size);
    let k = 1.0 / (1.0 + prm.dyeDissipation * prm.dt);
    textureStore(dst, c, moved * k);
}
