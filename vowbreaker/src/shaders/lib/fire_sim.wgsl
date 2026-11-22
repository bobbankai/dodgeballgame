// Fire (compute/fire.wgsl simulates, firecard.fragment draws): a small 2D fire on a tall grid.
// Cell layout (rgba16float): r temperature, g smoke, b/a velocity (x, y), in grid units.
// Fuel burns along the bottom rows in turbulent patches; heat rises by buoyancy, is carried along
// its own velocity, cools as it rises, and leaves smoke behind; a curl-noise breeze keeps the
// tongues licking. The drawing side posterises temperature into blackbody bands with an ink line
// round the tongues and a smoke column above.

struct FireParams {
    size: vec2f,        // grid size
    dt: f32,
    time: f32,
    buoyancy: f32,
    cooling: f32,
    turbulence: f32,
    smokeRate: f32,
    fuel: f32,          // how hard the base burns (0 = dying down)
    wind: f32,          // sideways push
    pad0: f32,
    pad1: f32,
}

fn fireClamp(c: vec2i, size: vec2f) -> vec2i {
    return clamp(c, vec2i(0), vec2i(size) - vec2i(1));
}

fn fireSample(tex: texture_2d<f32>, pos: vec2f, size: vec2f) -> vec4f {
    let st = pos - 0.5;
    let i = vec2i(floor(st));
    let f = fract(st);
    let a = textureLoad(tex, fireClamp(i, size), 0);
    let b = textureLoad(tex, fireClamp(i + vec2i(1, 0), size), 0);
    let c = textureLoad(tex, fireClamp(i + vec2i(0, 1), size), 0);
    let d = textureLoad(tex, fireClamp(i + vec2i(1, 1), size), 0);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// the fuel along the base: patches that flare and die, so the fire breathes
fn fireFuel(x: f32, time: f32, fuel: f32) -> f32 {
    let n = valueNoise2(vec2f(x * 9.0, time * 1.3)) * 0.6 + valueNoise2(vec2f(x * 23.0, time * 3.1)) * 0.4;
    let middle = 1.0 - smoothstep(0.3, 0.48, abs(x - 0.5));
    return smoothstep(0.35, 0.65, n) * fuel * 1.8 * middle;
}

// how fast heat is lost here: more the higher it rises, broken by a cooling map that scrolls up
// with the flames (this is what tears the heat into separate tongues)
fn fireCooling(uv: vec2f, time: f32, cooling: f32) -> f32 {
    let m = valueNoise2(vec2f(uv.x * 7.0, uv.y * 3.0 - time * 2.2)) * 0.65 + valueNoise2(vec2f(uv.x * 17.0, uv.y * 7.0 - time * 4.0)) * 0.35;
    return cooling * (0.35 + uv.y * 2.4) * (0.15 + 2.4 * m * m);
}

// --- drawing ---------------------------------------------------------------------------------------------------

// the silhouette of a fire on a card: a row of tongues, each a pointed lick whose height breathes
// with time, the tallest in the middle; returns the flame's height (fraction of the card) at x
fn fireTongues(x: f32, seed: f32, time: f32) -> f32 {
    var h = 0.0;
    for (var i = 0; i < 7; i++) {
        let fi = f32(i);
        let r = hash11(fi * 7.31 + seed * 13.7);
        let c = 0.17 + fi / 6.0 * 0.66 + (r - 0.5) * 0.08 + sin(time * (1.3 + r) + fi * 2.1) * 0.025;
        let breath = valueNoise2(vec2f(fi * 3.7 + seed * 11.0, time * (1.6 + r)));
        let ht = (0.22 + 0.55 * breath) * (1.0 - 0.55 * abs(c - 0.5) * 2.0);
        let wd = 0.075 + r * 0.05;
        let d = abs(x - c) / wd;
        h = max(h, ht * pow(max(1.0 - d, 0.0), 0.6));
    }
    // a bed of low flame joining the tongues
    let bed = 0.1 + 0.05 * valueNoise2(vec2f(x * 20.0, time * 3.0));
    return max(h, bed * (1.0 - smoothstep(0.22, 0.42, abs(x - 0.5))));
}

// how hot a point on the card looks: 1 at the base of a tongue falling to 0 at its tip (so the
// colour bands nest inside each other like a painted flame), stirred by the simulated heat.
// Returns (heat, the flame's height here).
fn fireCardHeat(uv: vec2f, simHeat: f32, seed: f32, time: f32) -> vec2f {
    // the flames lean and sway more the higher they reach
    let x = uv.x - sin(uv.y * 5.0 - time * 3.0 + seed * 6.0) * 0.025 * uv.y;
    let h = fireTongues(x, seed, time);
    let prof = clamp(1.0 - uv.y / max(h, 1e-3), 0.0, 1.0);
    let s = clamp(simHeat / 1.2, 0.0, 1.0);
    return vec2f(sqrt(prof) * (0.55 + 0.6 * s) * 1.3, h);
}

// smoke on a card: soft puffs rolling up out of the flames, only above them, thinned by the
// simulation's smoke density
fn fireCardSmoke(uv: vec2f, flameTop: f32, simSmoke: f32, seed: f32, time: f32) -> f32 {
    let q = vec2f(uv.x * 3.0 + seed * 3.0, uv.y * 2.2 - time * 0.45);
    let puff = vfbm2(q, 3);
    let rise = smoothstep(flameTop * 0.8, flameTop + 0.15, uv.y);
    let column = 1.0 - smoothstep(0.15, 0.42, abs(uv.x - 0.5 - (uv.y - flameTop) * 0.12));
    return smoothstep(0.42, 0.7, puff) * rise * column * clamp(0.4 + simSmoke * 0.6, 0.0, 1.0);
}

// temperature to toon fire colour: white core, yellow, orange, red tongues (posterised blackbody)
fn fireColor(t: f32) -> vec3f {
    let bands = floor(clamp(t, 0.0, 1.4) * 4.0 + 0.5) / 4.0;
    let k = mix(t, bands, 0.8);
    var c = mix(vec3f(0.6, 0.06, 0.02), vec3f(1.0, 0.3, 0.04), smoothstep(0.25, 0.5, k));
    c = mix(c, vec3f(1.0, 0.62, 0.1), smoothstep(0.55, 0.85, k));
    c = mix(c, vec3f(1.0, 0.9, 0.55), smoothstep(1.05, 1.3, k));
    return c * (0.65 + k * 0.55);
}

// smoke: grey-brown, lit warm from below by the fire, posterised in two tones
fn fireSmokeColor(density: f32, heat: f32) -> vec3f {
    let base = mix(vec3f(0.12, 0.1, 0.1), vec3f(0.28, 0.24, 0.22), step(0.5, density));
    return base + vec3f(0.6, 0.2, 0.05) * heat;
}
