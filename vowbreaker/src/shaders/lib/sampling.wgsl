// ============================================================================================
// vb_sampling: filtering kernels that take a texture (and its sampler) as arguments:
// bloom down/up kernels, bicubic, separable gaussian, bilateral weights, edge operators.
// All use textureSampleLevel / textureLoad so they are legal in any control flow.
// Depends on vb_common, vb_color.
// ============================================================================================

// Karis average weight: kills fireflies before blurring very bright pixels
fn karisWeight(c: vec3f) -> f32 {
    return 1.0 / (1.0 + luma(c));
}

// 13-tap downsample (Jimenez, "Next Generation Post Processing in Call of Duty: AW")
fn downsample13(t: texture_2d<f32>, s: sampler, uv: vec2f, texel: vec2f, karis: bool) -> vec3f {
    let a = textureSampleLevel(t, s, uv + texel * vec2f(-2.0, -2.0), 0.0).rgb;
    let b = textureSampleLevel(t, s, uv + texel * vec2f(0.0, -2.0), 0.0).rgb;
    let c = textureSampleLevel(t, s, uv + texel * vec2f(2.0, -2.0), 0.0).rgb;
    let d = textureSampleLevel(t, s, uv + texel * vec2f(-2.0, 0.0), 0.0).rgb;
    let e = textureSampleLevel(t, s, uv, 0.0).rgb;
    let f = textureSampleLevel(t, s, uv + texel * vec2f(2.0, 0.0), 0.0).rgb;
    let g = textureSampleLevel(t, s, uv + texel * vec2f(-2.0, 2.0), 0.0).rgb;
    let h = textureSampleLevel(t, s, uv + texel * vec2f(0.0, 2.0), 0.0).rgb;
    let i = textureSampleLevel(t, s, uv + texel * vec2f(2.0, 2.0), 0.0).rgb;
    let j = textureSampleLevel(t, s, uv + texel * vec2f(-1.0, -1.0), 0.0).rgb;
    let k = textureSampleLevel(t, s, uv + texel * vec2f(1.0, -1.0), 0.0).rgb;
    let l = textureSampleLevel(t, s, uv + texel * vec2f(-1.0, 1.0), 0.0).rgb;
    let m = textureSampleLevel(t, s, uv + texel * vec2f(1.0, 1.0), 0.0).rgb;
    if (karis) {
        // weight each 2x2 group by its Karis average to stop single hot pixels flickering
        let g0 = (a + b + d + e) * 0.25;
        let g1 = (b + c + e + f) * 0.25;
        let g2 = (d + e + g + h) * 0.25;
        let g3 = (e + f + h + i) * 0.25;
        let g4 = (j + k + l + m) * 0.25;
        let w0 = karisWeight(g0) * 0.125;
        let w1 = karisWeight(g1) * 0.125;
        let w2 = karisWeight(g2) * 0.125;
        let w3 = karisWeight(g3) * 0.125;
        let w4 = karisWeight(g4) * 0.5;
        return (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    }
    var o = e * 0.125;
    o = o + (a + c + g + i) * 0.03125;
    o = o + (b + d + f + h) * 0.0625;
    o = o + (j + k + l + m) * 0.125;
    return o;
}

// 9-tap tent upsample
fn upsampleTent(t: texture_2d<f32>, s: sampler, uv: vec2f, texel: vec2f, radius: f32) -> vec3f {
    let d = texel * radius;
    var o = textureSampleLevel(t, s, uv, 0.0).rgb * 4.0;
    o = o + textureSampleLevel(t, s, uv + vec2f(-d.x, 0.0), 0.0).rgb * 2.0;
    o = o + textureSampleLevel(t, s, uv + vec2f(d.x, 0.0), 0.0).rgb * 2.0;
    o = o + textureSampleLevel(t, s, uv + vec2f(0.0, -d.y), 0.0).rgb * 2.0;
    o = o + textureSampleLevel(t, s, uv + vec2f(0.0, d.y), 0.0).rgb * 2.0;
    o = o + textureSampleLevel(t, s, uv + vec2f(-d.x, -d.y), 0.0).rgb;
    o = o + textureSampleLevel(t, s, uv + vec2f(d.x, -d.y), 0.0).rgb;
    o = o + textureSampleLevel(t, s, uv + vec2f(-d.x, d.y), 0.0).rgb;
    o = o + textureSampleLevel(t, s, uv + vec2f(d.x, d.y), 0.0).rgb;
    return o / 16.0;
}

// dual-filter (Kawase) down and up: very cheap wide blurs for glows behind UI and DOF far field
fn kawaseDown(t: texture_2d<f32>, s: sampler, uv: vec2f, texel: vec2f) -> vec4f {
    let h = texel * 0.5;
    var o = textureSampleLevel(t, s, uv, 0.0) * 4.0;
    o = o + textureSampleLevel(t, s, uv - h, 0.0);
    o = o + textureSampleLevel(t, s, uv + h, 0.0);
    o = o + textureSampleLevel(t, s, uv + vec2f(h.x, -h.y), 0.0);
    o = o + textureSampleLevel(t, s, uv - vec2f(h.x, -h.y), 0.0);
    return o / 8.0;
}

fn kawaseUp(t: texture_2d<f32>, s: sampler, uv: vec2f, texel: vec2f) -> vec4f {
    let h = texel * 0.5;
    var o = textureSampleLevel(t, s, uv + vec2f(-h.x * 2.0, 0.0), 0.0);
    o = o + textureSampleLevel(t, s, uv + vec2f(-h.x, h.y), 0.0) * 2.0;
    o = o + textureSampleLevel(t, s, uv + vec2f(0.0, h.y * 2.0), 0.0);
    o = o + textureSampleLevel(t, s, uv + vec2f(h.x, h.y), 0.0) * 2.0;
    o = o + textureSampleLevel(t, s, uv + vec2f(h.x * 2.0, 0.0), 0.0);
    o = o + textureSampleLevel(t, s, uv + vec2f(h.x, -h.y), 0.0) * 2.0;
    o = o + textureSampleLevel(t, s, uv + vec2f(0.0, -h.y * 2.0), 0.0);
    o = o + textureSampleLevel(t, s, uv + vec2f(-h.x, -h.y), 0.0) * 2.0;
    return o / 12.0;
}

// --- bicubic (Catmull-Rom in 9 bilinear taps) ------------------------------------------------------

fn sampleCatmullRom(t: texture_2d<f32>, s: sampler, uv: vec2f, size: vec2f) -> vec4f {
    let samplePos = uv * size;
    let texPos1 = floor(samplePos - 0.5) + 0.5;
    let f = samplePos - texPos1;
    let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    let w3 = f * f * (-0.5 + 0.5 * f);
    let w12 = w1 + w2;
    let offset12 = w2 / w12;
    let texPos0 = (texPos1 - 1.0) / size;
    let texPos3 = (texPos1 + 2.0) / size;
    let texPos12 = (texPos1 + offset12) / size;
    var r = vec4f(0.0);
    r = r + textureSampleLevel(t, s, vec2f(texPos0.x, texPos0.y), 0.0) * w0.x * w0.y;
    r = r + textureSampleLevel(t, s, vec2f(texPos12.x, texPos0.y), 0.0) * w12.x * w0.y;
    r = r + textureSampleLevel(t, s, vec2f(texPos3.x, texPos0.y), 0.0) * w3.x * w0.y;
    r = r + textureSampleLevel(t, s, vec2f(texPos0.x, texPos12.y), 0.0) * w0.x * w12.y;
    r = r + textureSampleLevel(t, s, vec2f(texPos12.x, texPos12.y), 0.0) * w12.x * w12.y;
    r = r + textureSampleLevel(t, s, vec2f(texPos3.x, texPos12.y), 0.0) * w3.x * w12.y;
    r = r + textureSampleLevel(t, s, vec2f(texPos0.x, texPos3.y), 0.0) * w0.x * w3.y;
    r = r + textureSampleLevel(t, s, vec2f(texPos12.x, texPos3.y), 0.0) * w12.x * w3.y;
    r = r + textureSampleLevel(t, s, vec2f(texPos3.x, texPos3.y), 0.0) * w3.x * w3.y;
    return max(r, vec4f(0.0));
}

// --- gaussian ------------------------------------------------------------------------------------------

fn gaussianWeight(x: f32, sigma: f32) -> f32 {
    return exp(-(x * x) / (2.0 * sigma * sigma));
}

// separable gaussian along dir using linear-sampling offsets (half the taps)
fn gaussianBlur9(t: texture_2d<f32>, s: sampler, uv: vec2f, dir: vec2f) -> vec4f {
    let o1 = 1.3846153846;
    let o2 = 3.2307692308;
    let w0 = 0.2270270270;
    let w1 = 0.3162162162;
    let w2 = 0.0702702703;
    var c = textureSampleLevel(t, s, uv, 0.0) * w0;
    c = c + textureSampleLevel(t, s, uv + dir * o1, 0.0) * w1;
    c = c + textureSampleLevel(t, s, uv - dir * o1, 0.0) * w1;
    c = c + textureSampleLevel(t, s, uv + dir * o2, 0.0) * w2;
    c = c + textureSampleLevel(t, s, uv - dir * o2, 0.0) * w2;
    return c;
}

// --- bilateral -----------------------------------------------------------------------------------------

// depth weight for edge-aware blurs and upsampling (relative depth difference)
fn bilateralDepthWeight(centerDepth: f32, sampleDepth: f32, sharpness: f32) -> f32 {
    let d = abs(centerDepth - sampleDepth) / max(centerDepth, 1e-3);
    return exp(-d * d * sharpness);
}

fn bilateralNormalWeight(n0: vec3f, n1: vec3f, power: f32) -> f32 {
    return pow(clamp(dot(n0, n1), 0.0, 1.0), power);
}

// --- edge operators on a single channel loaded by texel --------------------------------------------------

fn loadR(t: texture_2d<f32>, p: vec2i, size: vec2i) -> f32 {
    return textureLoad(t, clamp(p, vec2i(0), size - 1), 0).r;
}

fn sobel(t: texture_2d<f32>, p: vec2i, size: vec2i) -> vec2f {
    let tl = loadR(t, p + vec2i(-1, -1), size);
    let tc = loadR(t, p + vec2i(0, -1), size);
    let tr = loadR(t, p + vec2i(1, -1), size);
    let ml = loadR(t, p + vec2i(-1, 0), size);
    let mr = loadR(t, p + vec2i(1, 0), size);
    let bl = loadR(t, p + vec2i(-1, 1), size);
    let bc = loadR(t, p + vec2i(0, 1), size);
    let br = loadR(t, p + vec2i(1, 1), size);
    let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    return vec2f(gx, gy);
}

// luminance of a texel (for FXAA and contrast-aware effects)
fn lumaAt(t: texture_2d<f32>, s: sampler, uv: vec2f) -> f32 {
    return luma(textureSampleLevel(t, s, uv, 0.0).rgb);
}
