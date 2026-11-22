// Ambient weather (ambient.vertex / ambient.fragment, src/render/Ambient.ts): thousands of
// instanced quads animated entirely on the GPU inside a box that follows the camera.
//
// Kinds:
//   0 rain      streaks along the wind-bent fall; drops that reach the ground become splash rings
//   1 petals    sakura petals tumbling edge-on and back, rocking as they fall
//   2 ash       grey flakes drifting down in slow spirals
//   3 snow      soft flakes swaying, the near ones larger and blurred
//   4 embers    sparks rising, flickering, cooling to dark red as they climb
//   5 motes     warm lantern motes hanging in the air
//   6 fireflies wandering on their own paths, blinking slowly
//   7 leaves    autumn leaves tumbling, heavier than petals
//   8 slips     paper prayer slips spinning down (Sayo's garden, the shrine)
//   9 dust      dust hanging in still indoor air, sparkling where light crosses it (the subway)
//  10 sleet     fast slanting ice, half rain half snow

struct AmbientDrop {
    pos: vec3f,      // world position (after wrapping into the box)
    axis: vec3f,     // for flat things: the card's spin axis
    angle: f32,      // and its turn
    size: f32,
    seed: f32,
    seed2: f32,
    splash: f32,     // rain: 0 falling, >0 a splash ring this old (0..1)
}

// fall speed scale, sway, size, tumble per kind
fn ambientKindParams(kind: i32) -> vec4f {
    switch kind {
        case 0: { return vec4f(1.0, 0.0, 0.012, 0.0); }
        case 1: { return vec4f(1.0, 0.45, 0.085, 1.0); }
        case 2: { return vec4f(1.0, 0.6, 0.06, 0.6); }
        case 3: { return vec4f(1.0, 0.35, 0.04, 0.0); }
        case 4: { return vec4f(-1.0, 0.25, 0.035, 0.0); }
        case 5: { return vec4f(-0.2, 0.3, 0.05, 0.0); }
        case 6: { return vec4f(0.0, 1.2, 0.06, 0.0); }
        case 7: { return vec4f(1.3, 0.5, 0.11, 1.0); }
        case 8: { return vec4f(0.9, 0.4, 0.12, 1.0); }
        case 9: { return vec4f(0.03, 0.15, 0.015, 0.0); }
        default: { return vec4f(1.6, 0.05, 0.02, 0.0); }
    }
}

fn ambientDrop(kind: i32, i: f32, t: f32, box: f32, cam: vec3f, wind: vec4f, ground: f32) -> AmbientDrop {
    var d: AmbientDrop;
    let h = hash31(i * 1.618 + 0.37);
    let h2 = hash31(i * 2.71 + 5.1);
    let k = ambientKindParams(kind);
    d.seed = h2.x;
    d.seed2 = h.y;
    let fall = wind.w * k.x * (0.7 + h2.x * 0.6);
    var local = h * box - vec3f(box * 0.5, 0.0, box * 0.5);
    local = local + vec3f(wind.x, -fall, wind.z) * t;
    // sway: light things rock side to side as they fall
    if (k.y > 0.0) {
        local = local + vec3f(sin(t * (1.0 + h2.y) + i), 0.0, cos(t * (0.8 + h2.z) + i * 1.3)) * k.y;
    }
    // fireflies: each wanders round its own home on a slow looping path
    if (kind == 6) {
        local = h * box - vec3f(box * 0.5, 0.0, box * 0.5);
        local.y = 0.4 + h.y * 2.5;
        local = local + vec3f(sin(t * 0.3 + i * 1.7), sin(t * 0.5 + i) * 0.3, cos(t * 0.27 + i * 2.3)) * 1.2;
    }
    // dust: barely moving, a slow Brownian drift
    if (kind == 9) {
        local = h * box - vec3f(box * 0.5, 0.0, box * 0.5);
        local = local + vec3f(valueNoise2(vec2f(t * 0.05, i)) - 0.5, valueNoise2(vec2f(i, t * 0.04)) - 0.5, valueNoise2(vec2f(t * 0.05 + 7.0, i)) - 0.5) * 0.8;
    }
    // wrap into the box round the camera (horizontally), and vertically above the ground
    let rel = local - vec3f(cam.x, 0.0, cam.z);
    var w = vec3f(fract(rel.x / box + 0.5) - 0.5, fract(rel.y / box), fract(rel.z / box + 0.5) - 0.5) * box;
    w = vec3f(w.x + cam.x, w.y + ground, w.z + cam.z);
    d.pos = w;
    // rain: the lowest slice of the box is spent as a splash on the ground
    d.splash = 0.0;
    if (kind == 0) {
        let fy = fract(rel.y / box);
        let slice = 0.04;
        if (fy < slice) {
            d.splash = 1.0 - fy / slice;
            d.pos = vec3f(w.x, ground + 0.02, w.z);
        }
    }
    d.size = k.z * (0.6 + h2.y * 0.8);
    // flat things tumble about a tilted axis
    d.axis = normalize(vec3f(h2.z - 0.5, 0.6, h.x - 0.5));
    d.angle = t * (1.5 + h2.z * 3.0) * k.w + i;
    return d;
}

// --- shapes ---------------------------------------------------------------------------------------------------

fn ambientPetal(p: vec2f) -> f32 {
    let body = length(p * vec2f(1.0, 0.65) + vec2f(0.0, 0.15)) - 0.62;
    let notch = length(p - vec2f(0.0, 0.82)) - 0.28;
    return max(body, -notch);
}

fn ambientLeaf(p: vec2f) -> vec2f {
    let d = sdVesica(p.yx, 0.9, 0.5);
    let rib = 1.0 - smoothstep(0.0, 0.06, abs(p.x));
    let veins = 1.0 - smoothstep(0.0, 0.05, abs(fract((p.y + abs(p.x) * 0.8) * 4.0) - 0.5) - 0.45);
    return vec2f(d, max(rib, veins * 0.5));
}

fn ambientSlip(p: vec2f, seed: f32) -> vec2f {
    let d = sdBox2(p, vec2f(0.32, 0.85));
    let glyph = 1.0 - smoothstep(0.0, 0.06, sdGlyph(p * vec2f(1.3, 0.55), floor(seed * 40.0)));
    let border = step(0.24, abs(p.x)) + step(0.78, abs(p.y));
    return vec2f(d, max(glyph, clamp(border, 0.0, 1.0) * 2.0));
}

fn ambientSplash(p: vec2f, age: f32) -> f32 {
    // a ring spreading on the ground and two droplets thrown up
    let r = length(p * vec2f(1.0, 2.5));
    let ring = 1.0 - smoothstep(0.0, 0.12, abs(r - age * 0.9));
    let drops = (1.0 - smoothstep(0.0, 0.12, length(p - vec2f(0.3, 0.5 + age * 0.4)))) + (1.0 - smoothstep(0.0, 0.1, length(p - vec2f(-0.35, 0.4 + age * 0.3))));
    return max(ring, drops * (1.0 - age)) * (1.0 - age);
}

// a flat card's shading: the face toward the sun is lit, the back is in its own shadow
fn ambientCardLight(facing: f32, toSun: f32) -> f32 {
    return mix(0.6, 1.1, smoothstep(-0.2, 0.4, toSun)) * mix(0.8, 1.0, facing);
}
