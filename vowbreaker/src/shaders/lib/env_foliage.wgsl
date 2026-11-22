// Foliage (env.fragment, pattern PAT_FOLIAGE): tree canopies and bushes are low blobs; this makes
// them read as painted trees.
//
//   clumps     a 3D cellular field splits the canopy into leaf clumps, and each clump's normal is
//              bent toward its own centre, so the cel light breaks the crown into rounded masses
//              the way background painters do it
//   silhouette fragments near the blob's grazing edge are cut by leaf-shaped noise, so the outline
//              is leafy instead of smooth
//   light      sunlight through the leaves when the canopy is seen against the sun (a warm,
//              yellow-green glow in the shadowed side), a cool blue shadow side, and small glints
//              that flicker as the wind turns leaves
//   blossom    sakura crowns (pink albedo) get clusters of paler blossoms and darker centres
//   season     a tint from spring green through summer to autumn reds (envParams3.z)

struct Foliage {
    n: vec3f,
    albedo: vec3f,
    cut: f32,        // 1 = discard this fragment (outside the leafy silhouette)
    glint: f32,
    blossom: f32,
}

// the nearest leaf clump: direction from its centre, distance to it, its random id
struct LeafClump {
    dir: vec3f,
    dist: f32,
    id: f32,
}

fn foliageClump(p: vec3f, scale: f32) -> LeafClump {
    let q = p * scale;
    let base = floor(q);
    var best = 1e9;
    var bestC = vec3f(0.0);
    var bestId = 0.0;
    for (var z = -1; z <= 1; z++) {
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let c = base + vec3f(f32(x), f32(y), f32(z));
                let h = hash33(c);
                let fp = c + 0.15 + h * 0.7;
                let d = length(q - fp);
                if (d < best) {
                    best = d;
                    bestC = fp;
                    bestId = h.x;
                }
            }
        }
    }
    var c: LeafClump;
    c.dir = normalize(q - bestC + vec3f(1e-4));
    c.dist = best;
    c.id = bestId;
    return c;
}

fn foliageSeasonTint(albedo: vec3f, season: f32, id: f32) -> vec3f {
    // 0 spring (fresh yellow-greens) .. 0.5 summer .. 1 autumn (reds and ambers mixed in)
    let spring = albedo * vec3f(1.05, 1.12, 0.85);
    let autumn = mix(vec3f(0.78, 0.3, 0.08), vec3f(0.9, 0.55, 0.1), id);
    let isGreen = smoothstep(0.0, 0.1, albedo.g - max(albedo.r, albedo.b));
    var c = mix(spring, albedo, smoothstep(0.0, 0.5, season));
    c = mix(c, mix(c, autumn, 0.75), smoothstep(0.55, 1.0, season) * isGreen);
    return c;
}

fn foliageShade(p: vec3f, n0: vec3f, v: vec3f, albedo0: vec3f, season: f32, time: f32, wind: f32, seed: f32) -> Foliage {
    var f: Foliage;
    // clumps: bend the normal toward each clump's centre (rounded masses of leaves)
    let cl = foliageClump(p + vec3f(seed * 3.0), 1.4);
    f.n = normalize(mix(n0, cl.dir, 0.65));
    // a little per-clump variation of value and hue
    var albedo = albedo0 * (0.85 + 0.3 * cl.id);
    albedo = foliageSeasonTint(albedo, season, cl.id);
    // sakura: pink crowns get paler blossom clusters with darker centres
    let pink = smoothstep(0.05, 0.2, albedo0.r - albedo0.g) * step(albedo0.g, albedo0.b + 0.15);
    let bl = foliageClump(p * 1.0 + 7.3, 6.0);
    f.blossom = (1.0 - smoothstep(0.25, 0.45, bl.dist)) * pink;
    albedo = mix(albedo, vec3f(1.0, 0.86, 0.9), f.blossom * 0.6);
    albedo = mix(albedo, albedo * 0.6, (1.0 - smoothstep(0.0, 0.12, bl.dist)) * pink * 0.5);
    f.albedo = albedo;
    // the silhouette: cut leaf shapes out of the grazing edge
    let graze = 1.0 - abs(dot(n0, v));
    let leaf = valueNoise3(p * 9.0 + vec3f(seed * 5.0)) * 0.6 + valueNoise3(p * 23.0) * 0.4;
    f.cut = step(0.78, graze + (leaf - 0.5) * 0.5) * step(0.55, leaf);
    // glints: leaves turned to the light for an instant by the wind
    let st = floor(time * 6.0);
    let g = hash13(floor(p * 12.0) + vec3f(st, 0.0, 0.0));
    f.glint = step(0.985 - wind * 0.01, g);
    return f;
}

// sunlight through the leaves, seen against the sun (added on the shadow side)
fn foliageTranslucency(n: vec3f, v: vec3f, l: vec3f, sunCol: vec3f, albedo: vec3f) -> vec3f {
    let back = pow(clamp(dot(v, -l), 0.0, 1.0), 4.0);
    let thin = 1.0 - clamp(dot(n, l) * 0.5 + 0.5, 0.0, 1.0);
    return sunCol * albedo * vec3f(1.1, 1.25, 0.6) * back * thin * 0.9;
}

// the shadow side of a canopy goes cool, like a painter's
fn foliageShadowTint(c: vec3f, lit: f32) -> vec3f {
    return mix(c * vec3f(0.78, 0.9, 1.15), c, lit);
}
