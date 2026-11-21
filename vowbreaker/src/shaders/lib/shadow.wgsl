// ============================================================================================
// vb_shadow: shadow map filtering. The map is our own pass (materials/shadowDepth) and holds
// linear light-space depth (0 near .. 1 far) in R of an r32float/rgba16f target; filtering uses
// textureLoad so it works whether or not float32 textures are filterable on the device.
// Depends on vb_common, vb_hash.
// ============================================================================================

struct ShadowInfo {
    uv: vec2f,        // light-space texture coordinate
    depth: f32,       // receiver depth in the same 0..1 range
    texel: f32,       // 1 / map size
    inside: f32,      // 1 inside the map's frustum, 0 outside (fully lit)
}

fn shadowProject(worldPos: vec3f, lightViewProj: mat4x4f, mapSize: f32) -> ShadowInfo {
    let c = lightViewProj * vec4f(worldPos, 1.0);
    let ndc = c.xyz / c.w;
    var s: ShadowInfo;
    // Babylon renders render targets upside down under WebGPU (to match WebGL), so v follows +y
    s.uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 + ndc.y * 0.5);
    s.depth = ndc.z;
    s.texel = 1.0 / mapSize;
    let inUv = step(0.0, s.uv.x) * step(s.uv.x, 1.0) * step(0.0, s.uv.y) * step(s.uv.y, 1.0);
    s.inside = inUv * step(s.depth, 1.0) * step(0.0, s.depth);
    return s;
}

// one comparison with bilinear weighting from four texels (hardware PCF done by hand)
fn shadowCompareBilinear(map: texture_2d<f32>, uv: vec2f, depth: f32, bias: f32, size: f32) -> f32 {
    let st = uv * size - 0.5;
    let base = floor(st);
    let f = st - base;
    let maxc = vec2i(i32(size) - 1);
    let i00 = clamp(vec2i(base), vec2i(0), maxc);
    let i10 = clamp(vec2i(base) + vec2i(1, 0), vec2i(0), maxc);
    let i01 = clamp(vec2i(base) + vec2i(0, 1), vec2i(0), maxc);
    let i11 = clamp(vec2i(base) + vec2i(1, 1), vec2i(0), maxc);
    let s00 = step(depth - bias, textureLoad(map, i00, 0).r);
    let s10 = step(depth - bias, textureLoad(map, i10, 0).r);
    let s01 = step(depth - bias, textureLoad(map, i01, 0).r);
    let s11 = step(depth - bias, textureLoad(map, i11, 0).r);
    return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

// 16-tap Poisson PCF with a per-pixel rotation (noise is resolved by the toon threshold anyway)
fn shadowPCF(map: texture_2d<f32>, s: ShadowInfo, bias: f32, radiusTexels: f32, rotation: f32) -> f32 {
    var disk = array<vec2f, 16>(
        vec2f(-0.94201624, -0.39906216), vec2f(0.94558609, -0.76890725), vec2f(-0.09418410, -0.92938870), vec2f(0.34495938, 0.29387760),
        vec2f(-0.91588581, 0.45771432), vec2f(-0.81544232, -0.87912464), vec2f(-0.38277543, 0.27676845), vec2f(0.97484398, 0.75648379),
        vec2f(0.44323325, -0.97511554), vec2f(0.53742981, -0.47373420), vec2f(-0.26496911, -0.41893023), vec2f(0.79197514, 0.19090188),
        vec2f(-0.24188840, 0.99706507), vec2f(-0.81409955, 0.91437590), vec2f(0.19984126, 0.78641367), vec2f(0.14383161, -0.14100790));
    let size = 1.0 / s.texel;
    let c = cos(rotation);
    let sn = sin(rotation);
    var sum = 0.0;
    for (var i = 0; i < 16; i++) {
        let d = disk[i];
        let o = vec2f(d.x * c - d.y * sn, d.x * sn + d.y * c) * radiusTexels * s.texel;
        sum = sum + shadowCompareBilinear(map, s.uv + o, s.depth, bias, size);
    }
    return mix(1.0, sum / 16.0, s.inside);
}

// cheaper 5-tap version for distant/environment receivers
fn shadowPCF5(map: texture_2d<f32>, s: ShadowInfo, bias: f32, radiusTexels: f32) -> f32 {
    let size = 1.0 / s.texel;
    let r = radiusTexels * s.texel;
    var sum = shadowCompareBilinear(map, s.uv, s.depth, bias, size) * 2.0;
    sum = sum + shadowCompareBilinear(map, s.uv + vec2f(r, 0.0), s.depth, bias, size);
    sum = sum + shadowCompareBilinear(map, s.uv - vec2f(r, 0.0), s.depth, bias, size);
    sum = sum + shadowCompareBilinear(map, s.uv + vec2f(0.0, r), s.depth, bias, size);
    sum = sum + shadowCompareBilinear(map, s.uv - vec2f(0.0, r), s.depth, bias, size);
    return mix(1.0, sum / 6.0, s.inside);
}

// PCSS: average blocker depth -> penumbra width -> PCF. Contact-hardening shadows under feet.
fn shadowPCSS(map: texture_2d<f32>, s: ShadowInfo, bias: f32, lightSize: f32, rotation: f32) -> f32 {
    let size = 1.0 / s.texel;
    let maxc = vec2i(i32(size) - 1);
    var blockers = 0.0;
    var count = 0.0;
    let searchR = lightSize * 6.0;
    for (var i = 0; i < 12; i++) {
        let o = vogelDisk(i, 12, rotation) * searchR * s.texel;
        let texel = clamp(vec2i((s.uv + o) * size), vec2i(0), maxc);
        let d = textureLoad(map, texel, 0).r;
        if (d < s.depth - bias) {
            blockers = blockers + d;
            count = count + 1.0;
        }
    }
    if (count < 0.5) {
        return 1.0;
    }
    let avg = blockers / count;
    let penumbra = clamp((s.depth - avg) / max(avg, 1e-3) * lightSize * 40.0, 1.0, 10.0);
    return shadowPCF(map, s, bias, penumbra, rotation);
}

// slope-scaled bias from the normal and the light direction
fn shadowBias(n: vec3f, l: vec3f, constant: f32, slope: f32) -> f32 {
    let ndl = clamp(dot(n, l), 0.0, 1.0);
    let tanA = sqrt(max(1.0 - ndl * ndl, 0.0)) / max(ndl, 0.05);
    return constant + slope * min(tanA, 4.0);
}

// stylized shadow edge: noise breaks the boundary into a painted, slightly ragged line
fn stylizeShadowEdge(shadow: f32, worldPos: vec3f, scale: f32, amount: f32) -> f32 {
    let n = valueNoise3(worldPos * scale) - 0.5;
    return clamp(shadow + n * amount * (1.0 - abs(shadow * 2.0 - 1.0)) * 2.0, 0.0, 1.0);
}

// fade the shadow out toward the edge of the map so it never pops
fn shadowEdgeFade(s: ShadowInfo, shadow: f32) -> f32 {
    let e = min(min(s.uv.x, 1.0 - s.uv.x), min(s.uv.y, 1.0 - s.uv.y));
    return mix(1.0, shadow, smoothstep(0.0, 0.06, e));
}
