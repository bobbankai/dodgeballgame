// ============================================================================================
// vb_ink: painterly image operators for the flashback and memory passes: Kuwahara and
// anisotropic-ish Kuwahara sectors (watercolour flats), edge darkening where washes dry,
// pigment granulation, paper bleed, sumi-e ink dispersion, and old-film damage.
// Functions that read the image take the texture and its sampler.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math.
// ============================================================================================

struct KuwaharaSector {
    mean: vec3f,
    variance: f32,
}

fn kuwaharaSector(t: texture_2d<f32>, s: sampler, uv: vec2f, texel: vec2f, dir: vec2f, radius: i32) -> KuwaharaSector {
    var sum = vec3f(0.0);
    var sum2 = vec3f(0.0);
    var n = 0.0;
    for (var j = 0; j <= radius; j++) {
        for (var i = 0; i <= radius; i++) {
            let o = vec2f(f32(i) * dir.x, f32(j) * dir.y) * texel;
            let c = textureSampleLevel(t, s, uv + o, 0.0).rgb;
            sum = sum + c;
            sum2 = sum2 + c * c;
            n = n + 1.0;
        }
    }
    var r: KuwaharaSector;
    r.mean = sum / n;
    let v = sum2 / n - r.mean * r.mean;
    r.variance = v.r + v.g + v.b;
    return r;
}

// classic 4-sector Kuwahara: flat, painterly regions that keep their edges
fn kuwahara(t: texture_2d<f32>, s: sampler, uv: vec2f, texel: vec2f, radius: i32) -> vec3f {
    let a = kuwaharaSector(t, s, uv, texel, vec2f(-1.0, -1.0), radius);
    let b = kuwaharaSector(t, s, uv, texel, vec2f(1.0, -1.0), radius);
    let c = kuwaharaSector(t, s, uv, texel, vec2f(-1.0, 1.0), radius);
    let d = kuwaharaSector(t, s, uv, texel, vec2f(1.0, 1.0), radius);
    var best = a;
    if (b.variance < best.variance) { best = b; }
    if (c.variance < best.variance) { best = c; }
    if (d.variance < best.variance) { best = d; }
    return best.mean;
}

// generalised 8-sector Kuwahara with Gaussian-ish weighting (smoother, fewer block artefacts)
fn kuwaharaSmooth(t: texture_2d<f32>, s: sampler, uv: vec2f, texel: vec2f, radius: f32) -> vec3f {
    var acc = vec3f(0.0);
    var wsum = 0.0;
    for (var k = 0; k < 8; k++) {
        let a0 = f32(k) * PI / 4.0;
        var m = vec3f(0.0);
        var m2 = vec3f(0.0);
        var n = 0.0;
        for (var i = 1; i <= 4; i++) {
            for (var j = -1; j <= 1; j++) {
                let a = a0 + f32(j) * 0.3;
                let r = f32(i) / 4.0 * radius;
                let c = textureSampleLevel(t, s, uv + vec2f(cos(a), sin(a)) * r * texel, 0.0).rgb;
                m = m + c;
                m2 = m2 + c * c;
                n = n + 1.0;
            }
        }
        m = m / n;
        let v = m2 / n - m * m;
        let sigma = max(v.r + v.g + v.b, 1e-5);
        let w = 1.0 / (1.0 + pow(sigma * 1000.0, 2.0));
        acc = acc + m * w;
        wsum = wsum + w;
    }
    return acc / max(wsum, 1e-5);
}

// watercolour edge darkening: pigment collects where a wash dries; driven by a local gradient
fn edgeDarkening(c: vec3f, gradient: f32, amount: f32) -> vec3f {
    let k = smoothstep(0.02, 0.2, gradient) * amount;
    return c * (1.0 - k * 0.6) - vec3f(k * 0.05);
}

// pigment granulation: pigment settles into the paper's valleys
fn granulate(c: vec3f, paper: f32, density: f32) -> vec3f {
    let d = (1.0 - luma(c)) * density;
    return c * (1.0 - d * (0.5 - paper) * 0.8);
}

// colour bleed: shift hues a little toward their neighbours (wet-in-wet)
fn wetBleed(c: vec3f, neighbour: vec3f, wet: f32) -> vec3f {
    return mixOklab(c, neighbour, clamp(wet, 0.0, 1.0) * 0.35);
}

// sumi-e: ink density from luminance with dry-brush breaks
fn sumiInk(l: f32, p: vec2f, dryness: f32) -> f32 {
    let ink = 1.0 - smoothstep(0.15, 0.85, l);
    let dry = brushStroke(p, vec2f(1.0, 0.25), 6.0, dryness);
    return ink * mix(1.0, dry, smoothstep(0.3, 0.8, ink));
}

// old film: gate weave, flicker, dust, vertical scratches; returns (offset.xy, brightness, damage)
fn oldFilm(uv: vec2f, time: f32, amount: f32) -> vec4f {
    let frame = floor(time * 18.0);
    let weave = vec2f(hash11(frame) - 0.5, hash11(frame + 3.0) - 0.5) * 0.002 * amount;
    let flicker = 1.0 + (hash11(frame + 7.0) - 0.5) * 0.12 * amount;
    let scratchX = hash11(floor(time * 4.0) + 11.0);
    let scratch = (1.0 - smoothstep(0.0, 0.0015, abs(uv.x - scratchX))) * step(0.6, hash11(floor(time * 4.0) + 17.0));
    let dustCell = floor(uv * vec2f(80.0, 45.0));
    let dustH = hash22(dustCell + frame * 13.0);
    let dust = step(0.9985, dustH.x) * (1.0 - smoothstep(0.1, 0.4, length(fract(uv * vec2f(80.0, 45.0)) - dustH)));
    return vec4f(weave, flicker, (scratch * 0.6 + dust) * amount);
}

// a dark ink vignette with a brush-torn edge (memories, the cursed sky)
fn inkVignette(uv: vec2f, aspect: f32, amount: f32, time: f32) -> f32 {
    let p = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
    let a = atan2(p.y, p.x);
    let tear = fbm2(vec2f(a * 3.0, time * 0.1), 4, 2.0, 0.5) * 0.12;
    let r = length(p) + tear;
    return smoothstep(0.42, 0.78, r) * amount;
}

// paper colour for a page that has yellowed with age
fn agedPaper(p: vec2f) -> vec3f {
    let g = paperGrain(p);
    let stain = vfbm2(p * 0.08, 4);
    let base = mix(vec3f(0.97, 0.94, 0.86), vec3f(0.86, 0.78, 0.62), smoothstep(0.55, 0.85, stain) * 0.6);
    return base * (0.9 + g * 0.12);
}
