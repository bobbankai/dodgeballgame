// ============================================================================================
// vb_sh: second-order spherical harmonics: projecting a stylized sky into 9 coefficients and
// evaluating irradiance from them, so characters pick up the sky's colour from the right side.
// Depends on vb_common, vb_lighting.
// ============================================================================================

struct SH9 {
    c0: vec3f, c1: vec3f, c2: vec3f, c3: vec3f, c4: vec3f, c5: vec3f, c6: vec3f, c7: vec3f, c8: vec3f,
}

fn shBasis(n: vec3f) -> array<f32, 9> {
    return array<f32, 9>(
        0.282095,
        0.488603 * n.y, 0.488603 * n.z, 0.488603 * n.x,
        1.092548 * n.x * n.y, 1.092548 * n.y * n.z,
        0.315392 * (3.0 * n.z * n.z - 1.0),
        1.092548 * n.x * n.z, 0.546274 * (n.x * n.x - n.y * n.y));
}

fn shZero() -> SH9 {
    var s: SH9;
    s.c0 = vec3f(0.0); s.c1 = vec3f(0.0); s.c2 = vec3f(0.0); s.c3 = vec3f(0.0); s.c4 = vec3f(0.0);
    s.c5 = vec3f(0.0); s.c6 = vec3f(0.0); s.c7 = vec3f(0.0); s.c8 = vec3f(0.0);
    return s;
}

fn shAdd(s: SH9, dir: vec3f, radiance: vec3f, weight: f32) -> SH9 {
    let b = shBasis(dir);
    var o = s;
    o.c0 = o.c0 + radiance * b[0] * weight;
    o.c1 = o.c1 + radiance * b[1] * weight;
    o.c2 = o.c2 + radiance * b[2] * weight;
    o.c3 = o.c3 + radiance * b[3] * weight;
    o.c4 = o.c4 + radiance * b[4] * weight;
    o.c5 = o.c5 + radiance * b[5] * weight;
    o.c6 = o.c6 + radiance * b[6] * weight;
    o.c7 = o.c7 + radiance * b[7] * weight;
    o.c8 = o.c8 + radiance * b[8] * weight;
    return o;
}

// irradiance from projected radiance (cosine-lobe convolution folded in, Ramamoorthi & Hanrahan)
fn shEvalIrradiance(s: SH9, n: vec3f) -> vec3f {
    let b = shBasis(n);
    let a0 = 3.141593;
    let a1 = 2.094395;
    let a2 = 0.785398;
    var r = s.c0 * b[0] * a0;
    r = r + (s.c1 * b[1] + s.c2 * b[2] + s.c3 * b[3]) * a1;
    r = r + (s.c4 * b[4] + s.c5 * b[5] + s.c6 * b[6] + s.c7 * b[7] + s.c8 * b[8]) * a2;
    return max(r * INV_PI, vec3f(0.0));
}

// a three-colour "toon sky" (zenith, horizon, ground) as cheap analytic irradiance with a
// directional sun lobe; matches what a projected stylized sky would give
fn toonSkyIrradiance(n: vec3f, zenith: vec3f, horizon: vec3f, ground: vec3f, sunDir: vec3f, sunCol: vec3f) -> vec3f {
    let up = n.y;
    var c = mix(horizon, zenith, smoothstep(0.0, 0.9, up));
    c = mix(c, ground, smoothstep(0.0, -0.6, up));
    let s = max(dot(n, sunDir), 0.0);
    return c + sunCol * s * s * 0.15;
}

// band an irradiance into steps for the cel look while keeping its hue
fn stepIrradiance(e: vec3f, steps: f32) -> vec3f {
    let l = max(luma(e), 1e-4);
    let q = floor(l * steps + 0.5) / steps;
    return e * (q / l);
}
