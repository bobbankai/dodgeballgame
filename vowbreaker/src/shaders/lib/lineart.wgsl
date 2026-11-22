// Line art (vbComposite): the ink lines over the whole image, drawn the way a key animator and a
// background artist would split the work.
//
//   weight      fighters (G-buffer ids 1000..1999, see vb_aura) get a heavier line than scenery;
//               silhouettes (against the sky, or where one object ends in front of another) are
//               heavier than inner lines; near lines are heavier than far ones
//   confidence  a weak edge gets a thinner, broken line, a strong one a full stroke, so creases in
//               cloth whisper while a jaw line speaks
//   colour      the line is a deep, saturated shade of the surface it borders (coloured trace on
//               light surfaces, near black on dark ones); far lines fade into the air
//   hatching    in dramatic moments (lineHatch > 0) the deep shadows on fighters get manga
//               cross-hatching, two directions laid by how dark the shadow is

fn lineIsFighter(id: f32) -> bool {
    return id >= 999.5 && id < 1999.5;
}

// how heavy a line should be here (px multiplier), from what is on either side of it
fn lineWeight(c: vec4f, o: vec4f, fighterW: f32) -> f32 {
    let skyC = c.b > 500.0;
    let skyO = o.b > 500.0;
    var w = 1.0;
    if (lineIsFighter(c.a) || lineIsFighter(o.a)) {
        w = fighterW;
    }
    // a silhouette: against the sky, or a big depth step between different objects
    let dz = abs(c.b - o.b) / max(min(c.b, o.b), 0.1);
    if (skyC != skyO || (abs(c.a - o.a) > 0.5 && dz > 0.15)) {
        w = w * 1.35;
    }
    return w;
}

// the strength of one edge sample (depth, normal, id), with how sure it is
struct LineEdge {
    strength: f32,
    silhouette: f32,
}

fn lineEdge(c: vec4f, o: vec4f, depthT: f32, normalT: f32) -> LineEdge {
    var e: LineEdge;
    e.strength = 0.0;
    e.silhouette = 0.0;
    let skyC = step(500.0, c.b);
    let skyO = step(500.0, o.b);
    if (skyC > 0.5 && skyO > 0.5) {
        return e;
    }
    if (skyC + skyO > 0.5) {
        e.strength = 1.0;
        e.silhouette = 1.0;
        return e;
    }
    let dz = abs(c.b - o.b) / max(min(c.b, o.b), 0.1);
    let depthEdge = smoothstep(depthT, depthT * 2.0, dz);
    let nc = octDecode(c.rg);
    let no = octDecode(o.rg);
    let normalEdge = smoothstep(normalT, normalT * 1.8, 1.0 - dot(nc, no));
    let idEdge = step(0.5, abs(c.a - o.a));
    e.silhouette = max(depthEdge, idEdge * step(0.1, dz));
    // creases (normal only) are weaker than outlines
    e.strength = max(max(depthEdge, idEdge), normalEdge * 0.7);
    return e;
}

// weak edges break up and thin; strong ones are solid (stroke confidence)
fn lineConfidence(strength: f32, pixel: vec2f, time: f32, fps: f32) -> f32 {
    let st = floor(time * fps);
    let n = valueNoise2(pixel * 0.11 + vec2f(st * 3.7, st * 1.3));
    let weak = 1.0 - smoothstep(0.35, 0.8, strength);
    return strength * mix(1.0, smoothstep(0.3, 0.65, n), weak * 0.8);
}

// the colour of the line: a deep shade of the surface, tending to near black on dark surfaces
fn lineColorFor(surface: vec3f, base: vec3f, mixAmt: f32) -> vec3f {
    let l = luma(surface);
    let sat = surface / max(l, 1e-3);
    let deep = clamp(sat * 0.22, vec3f(0.0), vec3f(0.6)) * (0.35 + 0.65 * smoothstep(0.05, 0.5, l));
    return mix(base, deep, mixAmt);
}

// manga cross-hatching in deep shadows (screen space, two directions laid by darkness)
fn lineHatch(pixel: vec2f, darkness: f32, scale: f32) -> f32 {
    let a = pixel * scale;
    let h1 = 1.0 - smoothstep(0.08, 0.2, abs(fract((a.x + a.y) * 0.12) - 0.5));
    let h2 = 1.0 - smoothstep(0.08, 0.2, abs(fract((a.x - a.y) * 0.12) - 0.5));
    return max(h1 * smoothstep(0.45, 0.6, darkness), h2 * smoothstep(0.65, 0.8, darkness));
}
