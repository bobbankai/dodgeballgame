// Star filter (vbStar): the cross-screen filter of anime highlights. Every bright point of the
// frame (specular glints, sparks, the catchlights in eyes, sun on water) throws thin rays: four,
// six or eight of them, long and fading, splitting into a faint rainbow toward their tips the way
// a real cross filter does. Read from a bloom level (already only the bright parts), at quarter
// resolution, added in vbFinal.

// a highlight's point-ness: its brightness above the blurrier level around it (big bright areas
// such as a lantern's whole face cancel out; a glint, a spark or a catchlight remains)
fn starPeak(src: texture_2d<f32>, ss: sampler, wide: texture_2d<f32>, ws: sampler, uv: vec2f) -> vec3f {
    let c = textureSampleLevel(src, ss, uv, 0.0).rgb;
    let w = textureSampleLevel(wide, ws, uv, 0.0).rgb;
    return max(c - w * 1.15, vec3f(0.0));
}

// one ray: taps marching out from the pixel in both directions along `dir`
fn starRay(src: texture_2d<f32>, ss: sampler, wide: texture_2d<f32>, ws: sampler, uv: vec2f, dir: vec2f, len: f32, texel: vec2f, chroma: f32) -> vec3f {
    var acc = vec3f(0.0);
    for (var i = 1; i <= 14; i++) {
        let f = f32(i) / 14.0;
        let o = dir * texel * len * f;
        // energy falls off quickly then lingers (a thin long tail)
        let w = exp(-f * 2.6) * 0.8 + exp(-f * 0.8) * 0.2;
        let s = starPeak(src, ss, wide, ws, uv + o) + starPeak(src, ss, wide, ws, uv - o);
        // toward the tip the ray splits into its colours
        let tint = mix(vec3f(1.0), starSpectrum(f), chroma * smoothstep(0.25, 1.0, f));
        acc = acc + s * w * tint;
    }
    return acc * 0.7;
}

// a rainbow from blue near the core to red at the tip (cross-filter dispersion)
fn starSpectrum(f: f32) -> vec3f {
    let h = clamp(f, 0.0, 1.0);
    return clamp(vec3f(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), vec3f(0.0), vec3f(1.0)) * 0.8 + 0.2;
}

// all the rays: `count` of them (4, 6, 8) turned by `angle`, the first pair longest
fn starFilter(src: texture_2d<f32>, ss: sampler, wide: texture_2d<f32>, ws: sampler, uv: vec2f, texel: vec2f, count: i32, len: f32, angle: f32, chroma: f32) -> vec3f {
    var acc = vec3f(0.0);
    let n = max(count / 2, 1);
    for (var i = 0; i < 4; i++) {
        if (i >= n) {
            break;
        }
        let a = angle + f32(i) / f32(n) * PI;
        let l = len * select(0.6, 1.0, i == 0);
        acc = acc + starRay(src, ss, wide, ws, uv, vec2f(cos(a), sin(a)), l, texel, chroma);
    }
    // the point itself: a small bright core where the rays cross
    acc = acc + starPeak(src, ss, wide, ws, uv) * 0.5;
    return acc / f32(n);
}

// keep only real highlights: the brightest parts of an already-thresholded bloom level
fn starIsolate(c: vec3f, threshold: f32) -> vec3f {
    let m = max(c.r, max(c.g, c.b));
    return c * smoothstep(threshold, threshold * 2.0, m);
}
