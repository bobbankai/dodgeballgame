// Grass (grass.vertex / grass.fragment, src/render/Grass.ts): thousands of instanced blades over a
// stage's grassy ground, drawn like painted background grass rather than a lawn.
//
//   shape      a blade is a tapered strip curved by its own stiffness; clumps share a lean and a
//              height so the field grows in tufts, not an even carpet
//   motion     a travelling gust field bends whole areas at once (you can see the wind cross the
//              hill), a quick flutter rides on top; blades near the fighters are pushed aside and
//              spring back
//   shading    three cel bands from a dark root to a pale sunlit tip, the ground's own colour at the
//              root so blades melt into it, a translucent glow when seen against the sun, wildflowers
//              (white, yellow, a few red spider lilies by the graves) on some blades' tips

struct GrassBlade {
    root: vec3f,
    height: f32,
    facing: f32,     // radians
    lean: vec2f,     // the clump's lean
    seed: f32,
    flower: f32,     // 0 none, else a flower kind
}

fn grassBladeFrom(inst: vec4f, inst2: vec4f) -> GrassBlade {
    var b: GrassBlade;
    b.root = inst.xyz;
    b.height = inst.w;
    b.facing = inst2.x;
    b.lean = vec2f(cos(inst2.y), sin(inst2.y)) * inst2.z;
    b.seed = fract(inst2.w);
    b.flower = floor(inst2.w);
    return b;
}

// the gust field: broad waves of wind crossing the stage plus a fast flutter
fn grassWind(p: vec2f, time: f32, windDir: vec2f, strength: f32) -> vec2f {
    let d = normalize(windDir + vec2f(1e-4));
    let along = dot(p, d);
    let gust = 0.5 + 0.5 * sin(along * 0.35 - time * 1.6 + valueNoise2(p * 0.05) * 4.0);
    let patchN = valueNoise2(p * 0.12 + d * time * 0.4);
    let flutter = sin(time * 9.0 + p.x * 3.1 + p.y * 2.7) * 0.15;
    return d * (gust * (0.4 + 0.6 * patchN) * strength + flutter * strength * 0.4);
}

// the push away from the fighters (up to four positions with radii)
fn grassPush(p: vec3f, pushers: array<vec4f, 4>) -> vec2f {
    var push = vec2f(0.0);
    for (var k = 0; k < 4; k++) {
        let q = pushers[k];
        if (q.w <= 0.0) {
            continue;
        }
        let d = p.xz - q.xz;
        let r = length(d);
        let k2 = 1.0 - smoothstep(q.w * 0.3, q.w, r);
        push = push + d / max(r, 0.05) * k2 * 0.9;
    }
    return push;
}

// bend a point of the blade at height fraction t: the tip moves most (quadratic), the blade keeps
// its length (the bent tip drops a little)
fn grassBend(local: vec3f, t: f32, bend: vec2f, height: f32) -> vec3f {
    let k = t * t;
    let off = bend * k * height;
    let drop = (dot(bend, bend) * 0.35) * k * height;
    return local + vec3f(off.x, -drop, off.y);
}

// cel shading of a blade: root dark (the ground's colour), three bands to a pale tip
fn grassShade(t: f32, lit: f32, ground: vec3f, blade: vec3f, tip: vec3f, seed: f32) -> vec3f {
    let band = floor(t * 3.0 + 0.3) / 3.0;
    var c = mix(ground * 0.85, blade, smoothstep(0.0, 0.35, band));
    c = mix(c, tip, smoothstep(0.55, 1.0, band) * 0.8);
    c = c * (0.9 + 0.2 * seed);
    return c * mix(0.55, 1.0, lit);
}

fn grassFlowerColor(kind: f32) -> vec3f {
    if (kind < 1.5) {
        return vec3f(0.97, 0.96, 0.92);
    }
    if (kind < 2.5) {
        return vec3f(1.0, 0.86, 0.25);
    }
    return vec3f(0.85, 0.08, 0.06);
}
