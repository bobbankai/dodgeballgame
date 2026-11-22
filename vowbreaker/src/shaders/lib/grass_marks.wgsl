// Grass and the fight (grass.vertex / grass.fragment): the round's ground marks (vb_ground_marks,
// src/render/Marks.ts) reach the grass. Read once per blade at its root:
//
//   scorch    the blade burnt short and black, its tip still glowing while the heat lasts
//   crater    flattened into the bowl, pushed outward from its centre
//   cracks    slashes and cracks cut the blades down to stubble along their lines
//   scuffs    trampled: bent over and darker where feet dragged
//   frost     stiff with ice (the wind cannot move it), white rime on the tips
//   ink       splashed dark at the tips

struct GrassScar {
    height: f32,     // multiplies the blade's height
    windFree: f32,   // how much the wind can still move it
    lean: vec2f,     // extra bend
    burn: f32,
    heat: f32,
    frost: f32,
    ink: f32,
    trample: f32,
}

fn grassScarNone() -> GrassScar {
    var s: GrassScar;
    s.height = 1.0;
    s.windFree = 1.0;
    s.lean = vec2f(0.0);
    s.burn = 0.0;
    s.heat = 0.0;
    s.frost = 0.0;
    s.ink = 0.0;
    s.trample = 0.0;
    return s;
}

// the scars at a blade's root. `a`, `b` are the two mark textures sampled there; `gradB` the
// slope of the depth channel (points out of a crater)
fn grassScar(a: vec4f, b: vec4f, gradB: vec2f, seed: f32) -> GrassScar {
    var s = grassScarNone();
    let scorch = clamp(a.x, 0.0, 1.0);
    let crack = smoothstep(0.35, 0.6, a.y);
    let ink = smoothstep(0.4, 0.55, a.z);
    let scuff = clamp(a.w, 0.0, 1.0);
    let frost = clamp(b.x, 0.0, 1.0);
    let depth = clamp(b.y, 0.0, 1.0);
    // burnt short, cut to stubble along cracks, flattened in craters
    s.height = (1.0 - scorch * 0.75) * (1.0 - crack * 0.85) * (1.0 - depth * 0.7) * (1.0 - scuff * 0.35);
    s.height = max(s.height, 0.06 + hash11(seed * 7.0) * 0.05);
    // pushed over: out of a crater, and trampled flat where scuffed
    let outDir = normalize(-gradB + vec2f(1e-5));
    s.lean = outDir * depth * 1.2 + vec2f(hash11(seed * 3.0) - 0.5, hash11(seed * 5.0) - 0.5) * scuff * 1.5;
    s.windFree = (1.0 - frost * 0.9) * (1.0 - scorch * 0.5);
    s.burn = scorch;
    s.heat = clamp(b.z, 0.0, 1.5) * smoothstep(0.3, 0.7, scorch + crack * 0.5);
    s.frost = frost;
    s.ink = ink;
    s.trample = scuff;
    return s;
}

// the blade's colour with its scars: charred, rimed, inked, trampled
fn grassScarColor(c0: vec3f, t: f32, scar: vec4f, heatCol: vec3f, time: f32, seed: f32) -> vec3f {
    let burn = scar.x;
    let frost = scar.y;
    let ink = scar.z;
    let trample = scar.w;
    var c = c0;
    // trampled grass is darker and a little yellowed
    c = mix(c, c * vec3f(0.85, 0.82, 0.6), trample * 0.5);
    // burnt: brown to charcoal, blackest at the tip
    let charCol = mix(vec3f(0.22, 0.14, 0.08), vec3f(0.04, 0.035, 0.03), smoothstep(0.3, 1.0, t));
    c = mix(c, charCol, smoothstep(0.15, 0.6, burn));
    // ink splashed on the tips
    c = mix(c, vec3f(0.05, 0.005, 0.015), ink * smoothstep(0.4, 0.8, t) * 0.9);
    // rime: white on the upper half of the blade, pale blue below
    c = mix(c, mix(vec3f(0.7, 0.82, 0.92), vec3f(0.95, 0.97, 1.0), t), frost * smoothstep(0.1, 0.6, t) * 0.85);
    return c;
}

// embers on burnt tips while the heat lasts
fn grassEmber(t: f32, heat: f32, heatCol: vec3f, time: f32, seed: f32) -> vec3f {
    let flick = 0.6 + 0.4 * sin(time * (5.0 + seed * 7.0) + seed * 30.0);
    return heatCol * heat * smoothstep(0.65, 1.0, t) * flick * 2.0;
}
