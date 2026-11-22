// Cinematic light (toon.fragment): the lights a cutscene puts on its actors, on top of the stage's.
// A rig (src/story/Director.ts cine()) is a key light with a colour and a hardness, a rim light
// from behind, a fill colour for the shadow side, a light from below (firelight, horror), a soft
// halo for memories, a catchlight in the eyes, and a gobo: the shape the key light passes through
// before it lands (venetian blinds, leaves, window panes, rain running down glass, water caustics,
// a shoji lattice, a flickering fire).
//
// Uniform layout (array<vec4f, 6>):
//   0  amount, gobo kind, gobo scale, flicker
//   1  key direction (world, toward the light), rim width
//   2  key colour, eye light
//   3  rim direction (world, toward the rim light), contrast
//   4  rim colour, light from below
//   5  fill colour, halo

const GOBO_NONE = 0;
const GOBO_BLINDS = 1;
const GOBO_LEAVES = 2;
const GOBO_WINDOW = 3;
const GOBO_RAIN = 4;
const GOBO_CAUSTICS = 5;
const GOBO_SHOJI = 6;
const GOBO_FIRE = 7;
const GOBO_GLASS = 8;

struct CineRig {
    amount: f32,
    gobo: i32,
    goboScale: f32,
    flicker: f32,
    keyDir: vec3f,
    rimWidth: f32,
    keyColor: vec3f,
    eyeLight: f32,
    rimDir: vec3f,
    contrast: f32,
    rimColor: vec3f,
    under: f32,
    fillColor: vec3f,
    halo: f32,
}

fn cineRigFrom(c0: vec4f, c1: vec4f, c2: vec4f, c3: vec4f, c4: vec4f, c5: vec4f) -> CineRig {
    var r: CineRig;
    r.amount = c0.x;
    r.gobo = i32(c0.y + 0.5);
    r.goboScale = max(c0.z, 0.05);
    r.flicker = c0.w;
    r.keyDir = normalize(c1.xyz + vec3f(0.0, 1e-4, 0.0));
    r.rimWidth = c1.w;
    r.keyColor = c2.rgb;
    r.eyeLight = c2.w;
    r.rimDir = normalize(c3.xyz + vec3f(0.0, 1e-4, 0.0));
    r.contrast = c3.w;
    r.rimColor = c4.rgb;
    r.under = c4.w;
    r.fillColor = c5.rgb;
    r.halo = c5.w;
    return r;
}

// a 2D frame on the plane facing the light, so a gobo's pattern is cast along the light
fn cineLightPlane(p: vec3f, l: vec3f) -> vec2f {
    let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(l.y) > 0.95);
    let ax = normalize(cross(up, l));
    let ay = cross(l, ax);
    return vec2f(dot(p, ax), dot(p, ay));
}

// venetian blinds: bars of light with soft edges, slightly tilted
fn goboBlinds(q: vec2f, scale: f32) -> f32 {
    let y = (q.y + q.x * 0.12) * scale * 4.0;
    let f = fract(y);
    return smoothstep(0.18, 0.3, f) * (1.0 - smoothstep(0.62, 0.74, f));
}

// light through leaves: overlapping rounded holes that sway in the wind
fn goboLeaves(q: vec2f, scale: f32, time: f32) -> f32 {
    let sway = vec2f(sin(time * 0.9), cos(time * 0.7)) * 0.06;
    let w1 = worley2((q + sway) * scale * 2.2, 1.0);
    let w2 = worley2((q - sway * 1.3) * scale * 3.7 + 7.1, 1.0);
    let holes = max(1.0 - smoothstep(0.18, 0.32, w1.f1), 1.0 - smoothstep(0.12, 0.25, w2.f1));
    // most of the light is blocked; the holes let pools of it through
    return holes;
}

// window panes: four panes with a cross of mullions and a frame
fn goboWindow(q: vec2f, scale: f32) -> f32 {
    let g = q * scale * 1.2;
    let cell = fract(g) - 0.5;
    let bars = max(1.0 - smoothstep(0.02, 0.05, abs(cell.x)), 1.0 - smoothstep(0.02, 0.05, abs(cell.y)));
    let window = step(abs(g.x - 0.0), 1.0) * step(abs(g.y), 1.0);
    return (1.0 - bars) * mix(0.25, 1.0, window);
}

// rain running down a window: the light ripples where drops slide and streak
fn goboRain(q: vec2f, scale: f32, time: f32) -> f32 {
    let s = q * scale * 2.0;
    let col = floor(s.x * 6.0);
    let speed = 0.4 + hash11(col) * 0.8;
    let y = s.y + time * speed + hash11(col * 3.1) * 10.0;
    let drop = 1.0 - smoothstep(0.0, 0.08, abs(fract(y) - 0.5) * 2.0 - 0.8);
    let trail = smoothstep(0.5, 1.0, fract(y)) * 0.35;
    let lane = 1.0 - smoothstep(0.1, 0.4, abs(fract(s.x * 6.0) - 0.5) * 2.0);
    let ripple = valueNoise2(s * 3.0 + vec2f(0.0, time * 0.6)) * 0.3;
    return clamp(0.7 + ripple - (drop * 0.6 + trail) * lane, 0.0, 1.0);
}

// water caustics: bright lines of focused light moving like light from a pool
fn goboCaustics(q: vec2f, scale: f32, time: f32) -> f32 {
    let a = worley2(q * scale * 2.5 + vec2f(time * 0.25, time * 0.15), 1.0);
    let b = worley2(q * scale * 3.3 - vec2f(time * 0.2, -time * 0.1) + 3.7, 1.0);
    let l = (1.0 - smoothstep(0.0, 0.06, a.edge)) + (1.0 - smoothstep(0.0, 0.06, b.edge));
    return 0.45 + clamp(l, 0.0, 1.0) * 0.9;
}

// a shoji lattice: a fine grid of thin bars, the paper softening the light between them
fn goboShoji(q: vec2f, scale: f32) -> f32 {
    let g = q * scale * vec2f(3.0, 2.0);
    let cell = abs(fract(g) - 0.5);
    let bars = max(1.0 - smoothstep(0.03, 0.06, cell.x), 1.0 - smoothstep(0.03, 0.06, cell.y));
    return (1.0 - bars) * 0.85;
}

// firelight: no shape, a breathing, stuttering intensity
fn goboFire(time: f32, seed: f32) -> f32 {
    let a = valueNoise2(vec2f(time * 6.0, seed));
    let b = valueNoise2(vec2f(time * 17.0, seed * 3.0));
    return 0.65 + a * 0.3 + b * 0.15;
}

fn cineGobo(r: CineRig, p: vec3f, time: f32) -> f32 {
    let q = cineLightPlane(p, r.keyDir);
    switch r.gobo {
        case 1: {
            return goboBlinds(q, r.goboScale);
        }
        case 2: {
            return goboLeaves(q, r.goboScale, time);
        }
        case 3: {
            return goboWindow(q, r.goboScale);
        }
        case 4: {
            return goboRain(q, r.goboScale, time);
        }
        case 5: {
            return goboCaustics(q, r.goboScale, time);
        }
        case 6: {
            return goboShoji(q, r.goboScale);
        }
        case 7: {
            return goboFire(time, 0.0);
        }
        default: {
            return 1.0;
        }
    }
}

// the key light: two tones with a short soft step (a cel edge), its pattern cast through the gobo
fn cineKey(r: CineRig, n: vec3f, p: vec3f, time: f32, castShadow: f32) -> f32 {
    let ndl = dot(n, r.keyDir);
    let lit = smoothstep(-0.02, 0.06, ndl) * castShadow;
    var k = lit * cineGobo(r, p, time);
    // a stutter on everything for firelight
    if (r.flicker > 0.0) {
        k = k * mix(1.0, goboFire(time, 1.7), r.flicker);
    }
    return k;
}

// a hard rim on the edge of the figure on the side the rim light comes from
fn cineRim(r: CineRig, n: vec3f, v: vec3f) -> f32 {
    let edge = 1.0 - clamp(dot(n, v), 0.0, 1.0);
    let side = clamp(dot(n, r.rimDir) * 0.5 + 0.5, 0.0, 1.0);
    let w = max(r.rimWidth, 0.02);
    return smoothstep(1.0 - w - 0.04, 1.0 - w, edge * (0.55 + side * 0.6)) * smoothstep(0.35, 0.65, side);
}

// light from below (a fire on the ground, a lantern held low, horror)
fn cineUnder(n: vec3f) -> f32 {
    return smoothstep(0.0, 0.35, -n.y);
}

// the soft glow of a memory round the edge of everyone in it
fn cineHalo(n: vec3f, v: vec3f) -> f32 {
    return pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.2);
}

// put the rig's light on a surface already shaded by the stage. `lit` is how sunlit it was
// (0..1); `isEye` boosts the catchlight; `castShadow` is the shadow map toward the sun (reused
// as a rough occluder for the key).
fn cineApply(col0: vec3f, albedo: vec3f, n: vec3f, v: vec3f, p: vec3f, lit: f32, isEye: f32, castShadow: f32, r: CineRig, time: f32) -> vec3f {
    if (r.amount <= 0.0) {
        return col0;
    }
    var col = col0;
    // contrast: the shadow side drops toward the fill colour (dramatic lighting)
    let key = cineKey(r, n, p, time, mix(1.0, castShadow, 0.5));
    let shadowed = mix(col, albedo * r.fillColor, 0.65);
    col = mix(col, shadowed, r.contrast * (1.0 - key));
    // stained glass colours the key's light pane by pane
    var keyCol = r.keyColor;
    if (r.gobo == GOBO_GLASS) {
        let gl = goboStainedGlass(cineLightPlane(p, r.keyDir), r.goboScale);
        keyCol = r.keyColor * gl.rgb * gl.a;
    }
    // the key's light (with its pattern) and its colour on the lit side; dark cloth still catches
    // it (a black coat goes blue-grey in a strong light, as painters do it)
    let catchA = max(albedo, vec3f(0.14));
    col = col + catchA * keyCol * key * 1.3;
    // rim, from behind
    col = col + r.rimColor * cineRim(r, n, v) * mix(1.0, 0.6, lit);
    // from below
    col = col + catchA * r.keyColor * cineUnder(n) * r.under * mix(1.0, goboFire(time, 3.3), step(0.01, r.flicker));
    // memories glow at their edges
    col = col + r.rimColor * cineHalo(n, v) * r.halo * 0.6;
    // a brighter catchlight in the eyes
    col = col + vec3f(1.0) * isEye * r.eyeLight * step(0.9, dot(reflect(-v, n), r.keyDir)) * 0.8;
    return mix(col0, col, r.amount);
}

// stained glass: the key light comes through panes of coloured glass held by lead (its colour is
// returned in rgb, its strength in a)
fn goboStainedGlass(q: vec2f, scale: f32) -> vec4f {
    let w = worley2(q * scale * 2.0, 0.85);
    let lead = 1.0 - smoothstep(0.0, 0.05, w.edge);
    let hue = w.id.x;
    let col = mix(mix(vec3f(0.9, 0.2, 0.15), vec3f(0.2, 0.35, 0.95), step(0.33, hue)), vec3f(0.95, 0.8, 0.25), step(0.66, hue));
    return vec4f(col * 1.4, (1.0 - lead) * 0.9);
}
