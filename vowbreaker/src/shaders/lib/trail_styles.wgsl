// Trail styles (trail.fragment): the ribbon a fist, foot or blade leaves while a move is active,
// drawn in the way of the fighter's technique. uv.x runs head (0) to tail (1), uv.y across.
//
// Every style returns light it adds and how much it covers (premultiplied: rgb is what is added
// over the scene, a how much of the scene behind is hidden), so glowing energy and opaque ink can
// share one blend mode.
//
//   0 energy   bands of core, body and edge colour flowing back along the ribbon, flecks of light
//   1 paper    a strip of folded paper: white facets catching light, a red ink line on its edge
//   2 water    a clear arc with a foam lip, droplets breaking off its tail, a bright refraction
//   3 flame    fire tongues licking back from the leading edge, embers flying off
//   4 void     a dark band studded with points of light, rimmed by a bent glow
//   5 spark    Black Spark: a black core with crimson lightning crackling along it
//   6 curse    ink: a dry-brush stroke of violet-black with tendrils curling off it

struct TrailInk {
    light: vec3f,
    cover: f32,
}

fn trailNone() -> TrailInk {
    var k: TrailInk;
    k.light = vec3f(0.0);
    k.cover = 0.0;
    return k;
}

// the ribbon's shape: full at the head, tapering to nothing at the tail; returns (inside, across)
// where across is 0 on the centre line and 1 at the edge
fn trailShape(u: f32, v: f32, ragged: f32) -> vec2f {
    let across = abs(v - 0.5) * 2.0;
    let width = pow(1.0 - u, 0.7) * (1.0 - ragged * 0.3);
    return vec2f(1.0 - smoothstep(width * 0.85, width, across), across / max(width, 1e-3));
}

// the leading edge (v near 0 is the side the blow travels toward)
fn trailLeading(v: f32, u: f32) -> f32 {
    return (1.0 - smoothstep(0.0, 0.22, v)) * (1.0 - u);
}

fn trailEnergy(u: f32, v: f32, t: f32, core: vec3f, body: vec3f, edge: vec3f, seed: f32) -> TrailInk {
    var k = trailNone();
    let flow = valueNoise2(vec2f(u * 4.0 - t * 6.0, v * 9.0 + seed));
    let s = trailShape(u, v, flow);
    if (s.x <= 0.0) {
        return k;
    }
    // bands: white-hot core at the centre, the body, a darker edge
    let x = s.y;
    var c = mix(core, body, smoothstep(0.15, 0.4, x));
    c = mix(c, edge, smoothstep(0.65, 0.9, x));
    // flowing streaks pull back along the ribbon
    let streak = smoothstep(0.45, 0.75, valueNoise2(vec2f(u * 2.0 - t * 8.0, v * 30.0 + seed * 3.0)));
    let dissolve = smoothstep(u * 1.15, u * 1.15 + 0.2, flow);
    let flecks = step(0.93, hash12(floor(vec2f(u * 40.0 - t * 30.0, v * 12.0)) + seed)) * (1.0 - u);
    k.light = (c * (1.2 + streak * 0.8) + core * trailLeading(v, u) * 1.5 + core * flecks * 3.0) * s.x * dissolve;
    k.cover = 0.0;
    return k;
}

fn trailPaper(u: f32, v: f32, t: f32, seed: f32) -> TrailInk {
    var k = trailNone();
    // the strip is cut into folded panels along its length
    let panel = floor(u * 9.0 + seed * 3.0);
    let f = fract(u * 9.0 + seed * 3.0);
    let tilt = hash11(panel + seed);
    let s = trailShape(u, v, 0.0);
    // the torn back edge of each panel
    let tear = valueNoise2(vec2f(u * 60.0, seed)) * 0.15;
    let inside = s.x * step(tear, 1.0 - s.y * 0.95);
    if (inside <= 0.0) {
        return k;
    }
    let lit = mix(0.72, 1.0, step(0.5, tilt)) * mix(1.0, 0.88, step(0.5, f));
    var c = vec3f(0.97, 0.94, 0.88) * lit;
    // the red line along the leading edge, the fold creases
    c = mix(c, vec3f(0.75, 0.08, 0.06), (1.0 - smoothstep(0.0, 0.07, v)) * step(u, 0.85));
    c = mix(c, c * 0.7, 1.0 - smoothstep(0.0, 0.05, min(f, 1.0 - f)));
    let fade = 1.0 - smoothstep(0.6, 1.0, u);
    k.cover = inside * fade * 0.95;
    k.light = c * k.cover;
    return k;
}

fn trailWater(u: f32, v: f32, t: f32, body: vec3f, core: vec3f, seed: f32) -> TrailInk {
    var k = trailNone();
    let s = trailShape(u, v, 0.0);
    // droplets breaking off the tail
    var drops = 0.0;
    for (var i = 0; i < 6; i++) {
        let fi = f32(i);
        let h = hash22(vec2f(fi, seed * 7.0));
        let c = vec2f(0.55 + h.x * 0.45, 0.2 + h.y * 0.6);
        let r = 0.03 * (1.0 - h.x * 0.5);
        drops = max(drops, 1.0 - smoothstep(r * 0.7, r, length((vec2f(u, v) - c) * vec2f(1.0, 0.35))));
    }
    let inside = max(s.x * (1.0 - smoothstep(0.55, 0.85, u)), drops);
    if (inside <= 0.0) {
        return k;
    }
    // clear in the middle, foamy at the lip, a bright refraction line
    let foam = smoothstep(0.55, 0.95, s.y) * step(0.45, valueNoise2(vec2f(u * 25.0 - t * 5.0, v * 12.0)));
    let refr = 1.0 - smoothstep(0.0, 0.08, abs(s.y - 0.45));
    let c = body * 0.35 + core * refr * 0.8 + vec3f(0.95) * (foam + trailLeading(v, u) * 0.6);
    k.cover = inside * (0.18 + foam * 0.6);
    k.light = c * inside;
    return k;
}

fn trailFlame(u: f32, v: f32, t: f32, core: vec3f, body: vec3f, edge: vec3f, seed: f32) -> TrailInk {
    var k = trailNone();
    // tongues lick back from the leading edge: a height field over u, scrolling backward
    let n = valueNoise2(vec2f(u * 10.0 - t * 7.0, seed)) * 0.6 + valueNoise2(vec2f(u * 23.0 - t * 13.0, seed * 2.0)) * 0.4;
    let reach = (1.0 - u) * (0.45 + 0.65 * n);
    let y = v;
    let inside = 1.0 - smoothstep(reach * 0.9, reach, y);
    if (inside <= 0.0 || u > 0.98) {
        return k;
    }
    // posterised heat: hottest at the leading edge
    let heat = clamp(1.0 - y / max(reach, 1e-3), 0.0, 1.0);
    let band = floor(heat * 3.0 + 0.5) / 3.0;
    var c = mix(edge, body, smoothstep(0.2, 0.5, band));
    c = mix(c, core, smoothstep(0.6, 1.0, band));
    // an ink line round the tongues
    let line = 1.0 - smoothstep(0.0, 0.04, abs(y - reach * 0.95));
    c = mix(c * 1.6, vec3f(0.25, 0.04, 0.0), line * 0.7);
    // embers flying off
    let em = step(0.95, hash12(floor(vec2f(u * 30.0 - t * 20.0, v * 20.0 + t * 5.0)) + seed));
    k.light = c * inside + core * em * (1.0 - u) * 2.0;
    k.cover = inside * 0.4;
    return k;
}

fn trailVoid(u: f32, v: f32, t: f32, body: vec3f, edge: vec3f, seed: f32) -> TrailInk {
    var k = trailNone();
    let s = trailShape(u, v, valueNoise2(vec2f(u * 5.0 - t * 3.0, seed)) * 0.6);
    if (s.x <= 0.0) {
        return k;
    }
    // a dark band, stars inside it, a glowing rim bent by the gravity of the thing
    let stars = step(0.985, hash12(floor(vec2f(u * 90.0 - t * 10.0, v * 30.0)) + seed));
    let rim = smoothstep(0.6, 0.95, s.y);
    let fade = 1.0 - smoothstep(0.5, 1.0, u);
    k.cover = s.x * (1.0 - rim) * 0.85 * fade;
    k.light = (edge * 0.15 + vec3f(1.0, 0.95, 1.0) * stars * 2.0) * k.cover + body * rim * s.x * 1.6 * fade;
    return k;
}

fn trailSpark(u: f32, v: f32, t: f32, seed: f32) -> TrailInk {
    var k = trailNone();
    let s = trailShape(u, v, 0.0);
    // lightning along the ribbon: a jagged line that jumps every few frames
    let step2 = floor(t * 24.0);
    let jag = (valueNoise2(vec2f(u * 18.0, step2 + seed)) - 0.5) * 0.5 * (1.0 - u);
    let boltD = abs(v - 0.5 - jag);
    let bolt = 1.0 - smoothstep(0.02, 0.05, boltD);
    let glow = 1.0 - smoothstep(0.0, 0.3, boltD);
    let inside = s.x;
    if (inside <= 0.0 && bolt <= 0.0) {
        return k;
    }
    // a black core with a crimson fringe and a white-hot line through the lightning
    let fringe = smoothstep(0.5, 0.95, s.y) * inside;
    k.cover = inside * (1.0 - fringe) * 0.92 * (1.0 - smoothstep(0.7, 1.0, u));
    k.light = vec3f(1.0, 0.05, 0.12) * (fringe * 2.5 + glow * 1.2 * (1.0 - u)) + vec3f(1.0, 0.8, 0.8) * bolt * (1.0 - u) * 2.0;
    return k;
}

fn trailCurse(u: f32, v: f32, t: f32, body: vec3f, seed: f32) -> TrailInk {
    var k = trailNone();
    // a dry-brush stroke: hairs of ink running along it that break up toward the tail
    let s = trailShape(u, v, 0.0);
    let hairs = valueNoise2(vec2f(u * 2.5, v * 40.0 + seed * 9.0));
    let dryness = smoothstep(0.2, 1.0, u) * 0.85;
    let dry = smoothstep(dryness - 0.15, dryness + 0.1, hairs);
    // tendrils curling off the trailing side
    let curl = sin(u * 30.0 + t * 4.0 + seed * 6.0) * 0.08 * u;
    let tendril = (1.0 - smoothstep(0.0, 0.025, abs(v - 0.85 - curl))) * step(0.3, u) * step(u, 0.85) * step(0.4, valueNoise2(vec2f(u * 6.0, seed)));
    let inside = max(s.x * (1.0 - dry * 0.9), tendril);
    if (inside <= 0.0) {
        return k;
    }
    k.cover = inside * 0.9;
    k.light = (vec3f(0.06, 0.02, 0.08) + body * 0.25 * (1.0 - smoothstep(0.0, 0.4, s.y))) * k.cover;
    return k;
}

// which style a technique palette draws its trails in
fn trailStyleFor(palette: i32) -> i32 {
    switch palette {
        case 1: {
            return 1;
        }
        case 2: {
            return 2;
        }
        case 3: {
            return 3;
        }
        case 4: {
            return 4;
        }
        case 5: {
            return 5;
        }
        case 6: {
            return 6;
        }
        default: {
            return 0;
        }
    }
}

fn trailEval(style: i32, u: f32, v: f32, t: f32, core: vec3f, body: vec3f, edge: vec3f, seed: f32) -> TrailInk {
    switch style {
        case 1: {
            return trailPaper(u, v, t, seed);
        }
        case 2: {
            return trailWater(u, v, t, body, core, seed);
        }
        case 3: {
            return trailFlame(u, v, t, core, body, edge, seed);
        }
        case 4: {
            return trailVoid(u, v, t, body, edge, seed);
        }
        case 5: {
            return trailSpark(u, v, t, seed);
        }
        case 6: {
            return trailCurse(u, v, t, body, seed);
        }
        default: {
            return trailEnergy(u, v, t, core, body, edge, seed);
        }
    }
}
