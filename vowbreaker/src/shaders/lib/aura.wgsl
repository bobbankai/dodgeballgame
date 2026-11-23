// Cursed-energy aura in screen space (vbAuraMask, vbAura): the flames that lick off a fighter's
// silhouette while they gather energy, the way the genre draws it. Each fighter owns a block of
// G-buffer object ids (Character.ts: base + mesh index); the mask pass marks the pixels of up to
// four fighters, the aura pass looks around each pixel for the nearest marked pixel (searching
// further below than above, so the flames rise), turns the distance into a flame field with
// rising noise, posterises it into the palette's bands and draws a thin dark line where the
// flames meet the air.
//
// Styles per fighter (auraColors[i].w integer part):
//   0 flame    licking tongues rising off the silhouette (most techniques)
//   1 static   jagged electric crackle hugging the outline (Black Spark charging)
//   2 smoke    slow dark smoke curling off the body (curses, the Vow: alpha-like, dark with a rim)
//   3 halo     a calm steady glow (the domain caster at rest)

// which aura slot an id belongs to (0 = none, 1..4), given the four id bases (negative = unused)
fn auraSlot(id: f32, bases: vec4f) -> f32 {
    for (var k = 0; k < 4; k++) {
        let b = bases[k];
        if (b >= 0.0 && id >= b - 0.5 && id < b + 15.5) {
            return f32(k + 1);
        }
    }
    return 0.0;
}

// search directions: a ring of 16, the search reaching further downward (flames rise above)
fn auraDir(i: i32) -> vec2f {
    let a = f32(i) / 16.0 * TAU;
    return vec2f(cos(a), sin(a));
}

// how far a pixel sits from the nearest marked pixel of a slot (0 inside .. 1 at the reach)
struct AuraNear {
    dist: f32,
    slot: f32,
    inside: f32,
}

fn auraNearest(mask: texture_2d<f32>, smp: sampler, uv: vec2f, texel: vec2f, reach: f32) -> AuraNear {
    var r: AuraNear;
    let c = textureSampleLevel(mask, smp, uv, 0.0);
    r.inside = step(0.5, c.r);
    r.slot = round(c.r);
    r.dist = select(1.0, 0.0, r.inside > 0.5);
    if (r.inside > 0.5) {
        return r;
    }
    for (var ring = 1; ring <= 4; ring++) {
        let rad = f32(ring) / 4.0;
        for (var i = 0; i < 16; i++) {
            let d = auraDir(i);
            // look further down than up: a pixel above a fighter finds them from further away
            let stretch = select(1.0, 1.9, d.y < 0.0);
            let o = d * rad * reach * stretch * texel;
            let s = textureSampleLevel(mask, smp, uv + o, 0.0).r;
            if (s > 0.5) {
                let dist = rad * select(1.0, 0.55, d.y < 0.0);
                if (dist < r.dist) {
                    r.dist = dist;
                    r.slot = round(s);
                }
            }
        }
        if (r.dist < 1.0) {
            break;
        }
    }
    return r;
}

// the flame field at a pixel: rising noise cut by the distance to the silhouette
fn auraFlame(uv: vec2f, dist: f32, time: f32, seed: f32, aspect: f32) -> f32 {
    let p = vec2f(uv.x * aspect, uv.y) * 9.0;
    let st = floor(time * 12.0) / 12.0;
    let n1 = vfbm2(p * vec2f(1.0, 0.55) + vec2f(seed * 7.0, -st * 2.4), 4);
    let n2 = vfbm2(p * vec2f(2.2, 1.0) + vec2f(seed * 3.0 + 5.0, -st * 3.8), 3);
    let tongues = n1 * 0.7 + n2 * 0.4;
    return clamp((tongues - dist * 1.25) * 2.4 + (1.0 - dist) * 0.25, 0.0, 1.0);
}

// electric crackle hugging the outline: thin bright filaments that re-strike on twos
fn auraStatic(uv: vec2f, dist: f32, time: f32, seed: f32, aspect: f32) -> f32 {
    let st = floor(time * 12.0);
    let p = vec2f(uv.x * aspect, uv.y) * 30.0 + vec2f(st * 3.1, st * 1.7) + seed * 9.0;
    let a = valueNoise2(p) - 0.5;
    let line = 1.0 - smoothstep(0.0, 0.06, abs(a));
    let near = 1.0 - smoothstep(0.0, 0.55, dist);
    return clamp(line * near * 1.4 + (1.0 - smoothstep(0.0, 0.2, dist)) * 0.35, 0.0, 1.0);
}

// slow smoke curling off the body
fn auraSmoke(uv: vec2f, dist: f32, time: f32, seed: f32, aspect: f32) -> f32 {
    let p = vec2f(uv.x * aspect, uv.y) * 5.0;
    let w = warp2(p + vec2f(seed * 4.0, -time * 0.5), 1.2, time * 0.2);
    let n = vfbm2(w, 4);
    return clamp((n - dist * 1.1) * 2.0, 0.0, 1.0);
}

fn auraHalo(dist: f32, time: f32) -> f32 {
    return (1.0 - smoothstep(0.0, 0.7, dist)) * (0.75 + 0.25 * sin(time * 2.0));
}
