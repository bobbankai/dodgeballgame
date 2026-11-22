// Rising lanterns (src/render/Lanterns.ts, lantern3d.vertex / lantern3d.fragment): the night of the
// lanterns, near enough to pass the fighters. Every lantern is one instance of a small barrel mesh
// animated entirely in the vertex shader from its own seed: it rises at its own pace, sways and
// turns slowly, swells into view at the bottom of its climb and shrinks away at the top before it
// starts again. The paper is lit from inside by a flickering flame, brightest at the open bottom;
// its ribs and the paper's fibre show against the light. Cursed lanterns burn red and carry a black
// sigil.

struct LanternState {
    pos: vec3f,
    scale: f32,
    spin: f32,
    tilt: vec2f,
}

// where a lantern is at time t (inst: x, z, base height, seed; inst2: size, speed, climb, cursed)
fn lanternAt(inst: vec4f, inst2: vec4f, t: f32, wind: vec2f) -> LanternState {
    var s: LanternState;
    let seed = inst.w;
    let climb = inst2.z;
    let phase = fract(t * inst2.y / climb + seed);
    let h = phase * climb;
    // they drift with the wind more the higher they are, and wander a little
    let drift = wind * h * 0.15;
    let wander = vec2f(sin(t * 0.3 + seed * 20.0), cos(t * 0.27 + seed * 13.0)) * (0.4 + h * 0.02);
    s.pos = vec3f(inst.x + drift.x + wander.x, inst.z + h, inst.y + drift.y + wander.y);
    // swell in at the start, shrink away at the end (no popping when they wrap round)
    s.scale = inst2.x * smoothstep(0.0, 0.06, phase) * (1.0 - smoothstep(0.88, 1.0, phase));
    s.spin = t * (0.2 + hash11(seed * 3.0) * 0.3) + seed * 6.0;
    s.tilt = vec2f(sin(t * 0.8 + seed * 9.0), cos(t * 0.7 + seed * 5.0)) * 0.08;
    return s;
}

// the barrel shape: the template cylinder (radius 0.5, y -0.5..0.5) bulged in the middle
fn lanternBulge(p: vec3f) -> vec3f {
    let y = p.y;
    let bulge = 1.0 + 0.35 * (1.0 - 4.0 * y * y);
    return vec3f(p.x * bulge, y * 1.25, p.z * bulge);
}

fn lanternGlow(y: f32, ang: f32, t: f32, seed: f32, cursed: f32) -> vec3f {
    // a flame low inside: the paper brightest at the bottom, breathing
    let flick = 0.8 + 0.2 * valueNoise2(vec2f(t * 8.0, seed * 30.0));
    let warm = mix(vec3f(1.0, 0.62, 0.22), vec3f(1.0, 0.85, 0.55), smoothstep(0.2, -0.5, y));
    let red = mix(vec3f(0.9, 0.08, 0.05), vec3f(1.0, 0.3, 0.15), smoothstep(0.2, -0.5, y));
    let col = mix(warm, red, cursed);
    let falloff = 0.65 + 0.6 * smoothstep(0.5, -0.5, y);
    // the ribs: dark horizontal hoops, and the seams of the paper panels
    let ribs = step(0.88, fract(y * 6.0 + 0.5));
    let seams = step(0.94, fract(ang / TAU * 8.0));
    return col * falloff * flick * (1.0 - ribs * 0.6) * (1.0 - seams * 0.35);
}

// the black sigil a cursed lantern carries (a ring with a glyph), on the side facing out
fn lanternSigil(y: f32, ang: f32, seed: f32) -> f32 {
    let q = vec2f(fract(ang / TAU * 2.0 + seed) - 0.5, y) * vec2f(2.0, 2.4);
    let ring = 1.0 - smoothstep(0.0, 0.03, abs(length(q) - 0.42));
    let glyph = 1.0 - smoothstep(-0.01, 0.03, sdGlyph(q * 1.6, floor(seed * 20.0)));
    return max(ring, glyph);
}
