// ============================================================================================
// vb_noise2: the less common noises: tileable cellular in 3D, Gabor-like oriented noise,
// wave interference, spherical noise for planets/moons, gradient-domain blue-ish noise,
// and the signal shapers that turn any of them into crackle, veins, streaks and spots.
// Depends on vb_common, vb_hash, vb_noise, vb_math.
// ============================================================================================

// tileable 3D worley (period in cells): seamless volumetric textures and looping smoke
fn worleyTiled3(p: vec3f, period: f32) -> f32 {
    let n = floor(p);
    let f = fract(p);
    var best = 8.0;
    for (var k = -1; k <= 1; k++) {
        for (var j = -1; j <= 1; j++) {
            for (var i = -1; i <= 1; i++) {
                let g = vec3f(f32(i), f32(j), f32(k));
                let c = fmod3(n + g, vec3f(period));
                let o = ihash33(vec3i(c));
                let r = g + o - f;
                best = min(best, dot(r, r));
            }
        }
    }
    return sqrt(best);
}

// "cloud" worley-fbm (inverted, layered) as used for stylized volumetric shapes
fn worleyFbm3(p: vec3f, period: f32) -> f32 {
    let a = 1.0 - worleyTiled3(p, period);
    let b = 1.0 - worleyTiled3(p * 2.0, period * 2.0);
    let c = 1.0 - worleyTiled3(p * 4.0, period * 4.0);
    return a * 0.625 + b * 0.25 + c * 0.125;
}

// Perlin-Worley mix (Schneider 2015): billowy but structured
fn perlinWorley3(p: vec3f) -> f32 {
    let pf = fbm3(p, 4, 2.0, 0.5) * 0.5 + 0.5;
    let wf = worleyFbm3(p, 8.0);
    return clamp(remap(pf, wf - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
}

// oriented, band-limited noise (a sparse Gabor convolution): wood grain, brushed metal, hair
fn gaborNoise2(p: vec2f, dir: vec2f, freq: f32, bandwidth: f32) -> f32 {
    let cell = floor(p);
    let d = normalize(dir);
    var sum = 0.0;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let c = cell + vec2f(f32(i), f32(j));
            for (var k = 0; k < 3; k++) {
                let h = hash32(c * 7.31 + f32(k) * 1.37);
                let center = c + h.xy;
                let x = p - center;
                let env = exp(-PI * bandwidth * bandwidth * dot(x, x));
                let phase = h.z * TAU;
                sum = sum + env * cos(TAU * freq * dot(x, d) + phase) * (select(-1.0, 1.0, h.z > 0.5));
            }
        }
    }
    return sum * 0.4;
}

// interference of a few travelling waves: water caustic sheen, heat shimmer, energy surfaces
fn waveInterference(p: vec2f, t: f32) -> f32 {
    var s = 0.0;
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let a = fi * 2.399 + 0.5;
        let d = vec2f(cos(a), sin(a));
        s = s + sin(dot(p, d) * (2.0 + fi * 0.7) + t * (1.0 + fi * 0.3));
    }
    return s / 5.0;
}

// noise on a sphere's surface (moons, the bell's patina): no pole pinching
fn sphereNoise(dir: vec3f, scale: f32, octaves: i32) -> f32 {
    return fbm3(normalize(dir) * scale, octaves, 2.0, 0.5);
}

// spot pattern: round random spots with soft edges (lichen, rust, paper foxing)
fn spots(p: vec2f, density: f32, size: f32) -> f32 {
    let c = worley2(p * density, 1.0);
    let keep = step(0.55, c.id.x);
    return (1.0 - smoothstep(size * 0.6, size, c.f1)) * keep;
}

// veins: thin bright lines where two noise fields cross zero (cursed marks, marble, lightning flats)
fn veins(p: vec3f, scale: f32, width: f32) -> f32 {
    let a = simplex3(p * scale);
    let b = simplex3(p * scale * 1.9 + vec3f(5.3, 1.1, 8.7));
    let d = min(abs(a), abs(b) * 1.3);
    return 1.0 - smoothstep(0.0, width, d);
}

// streaks: long thin noise stretched along a direction (rain on glass, scratches, speed)
fn streaks(p: vec2f, dir: vec2f, stretch: f32, density: f32) -> f32 {
    let d = normalize(dir);
    let q = vec2f(dot(p, d) / stretch, dot(p, vec2f(-d.y, d.x)) * density);
    let row = floor(q.y);
    let h = hash11(row);
    let along = fract(q.x + h * 13.0);
    let len = 0.2 + h * 0.6;
    let across = abs(fract(q.y) - 0.5);
    return step(along, len) * (1.0 - smoothstep(0.05, 0.2, across)) * step(0.4, h);
}

// stepped, posterized noise (anime backgrounds paint noise in a few flat values)
fn posterNoise(p: vec2f, levels: f32) -> f32 {
    return floor(vfbm2(p, 4) * levels) / levels;
}

// a cheap blue-noise-like dither from two interleaved gradients (no texture needed)
fn blueishNoise(pixel: vec2f, frame: f32) -> f32 {
    let a = interleavedGradientNoiseAnimated(pixel, frame);
    let b = interleavedGradientNoiseAnimated(pixel.yx + 17.0, frame + 7.0);
    return fract(a + b * 0.618034);
}

// domain-warped ridges: cracked earth, dried ink, scale patterns
fn crackedEarth(p: vec2f, scale: f32) -> vec2f {
    let w = p * scale + vec2f(fbm2(p * scale * 0.5, 3, 2.0, 0.5), fbm2(p * scale * 0.5 + 9.0, 3, 2.0, 0.5)) * 0.6;
    let c = worley2(w, 1.0);
    let crack = 1.0 - smoothstep(0.0, 0.06, c.edge);
    return vec2f(crack, c.id.x);
}
