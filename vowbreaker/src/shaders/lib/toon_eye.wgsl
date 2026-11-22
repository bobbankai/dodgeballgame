// ============================================================================================
// vb_toon_eye: painted anime eyes. Eyes are decals with their colour painted per vertex, so the
// shading is mostly about keeping them alive: they never go fully dark in shadow, the iris gets a
// gentle caustic brightening on the side away from the light (light passes through the cornea and
// pools opposite), highlights stay pure white and flicker very slightly, and when a sorcerer pours
// out cursed energy the iris lights up in their palette.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_lighting.
// ============================================================================================

struct EyeParams {
    minLight: f32,        // how bright the eye stays in full shadow
    caustic: f32,         // iris brightening opposite the light
    glow: f32,            // cursed-energy glow 0..1
    glowColor: vec3f,
}

fn eyeDefault() -> EyeParams {
    return EyeParams(0.72, 0.35, 0.0, vec3f(1.0));
}

// is this vertex colour a highlight? (painted near-white)
fn eyeIsHighlight(albedo: vec3f) -> f32 {
    return smoothstep(0.88, 0.96, minc3(albedo));
}

// is this vertex colour dark (pupil, lashes, brows)?
fn eyeIsInk(albedo: vec3f) -> f32 {
    return 1.0 - smoothstep(0.06, 0.16, maxc3(albedo));
}

// is this a saturated iris colour?
fn eyeIsIris(albedo: vec3f) -> f32 {
    let mx = maxc3(albedo);
    let mn = minc3(albedo);
    let sat = (mx - mn) / max(mx, 1e-4);
    return smoothstep(0.2, 0.4, sat) * (1.0 - eyeIsHighlight(albedo));
}

fn eyeShade(albedo: vec3f, n: vec3f, l: vec3f, lit: f32, sunCol: vec3f, ambient: vec3f, p: EyeParams, time: f32, objPos: vec3f) -> vec3f {
    let hi = eyeIsHighlight(albedo);
    let iris = eyeIsIris(albedo);
    let ink = eyeIsInk(albedo);
    let light = mix(p.minLight, 1.0, lit) * (sunCol * 0.25 + vec3f(0.75)) + ambient * 0.1;
    var c = albedo * light;
    // the caustic: an iris lights up on the side away from the light
    let away = clamp(-dot(n, l) * 0.5 + 0.5, 0.0, 1.0);
    c = c + albedo * iris * away * p.caustic * 0.6;
    // highlights stay pure, with the faintest life in them
    let twinkle = 0.96 + 0.04 * sin(time * 3.0 + objPos.x * 40.0);
    c = mix(c, vec3f(1.0) * twinkle, hi);
    // ink stays ink
    c = mix(c, albedo * 0.95, ink * 0.8);
    // energy
    c = c + p.glowColor * p.glow * iris * (1.2 + 0.4 * sin(time * 8.0));
    return c;
}

// a wet, welling eye (grief scenes): the lower part of the sclera and iris brightens and wobbles
fn eyeTears(c: vec3f, objPos: vec3f, eyeCenterY: f32, amount: f32, time: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let low = 1.0 - smoothstep(eyeCenterY - 0.01, eyeCenterY + 0.005, objPos.y);
    let wobble = 0.5 + 0.5 * sin(time * 2.0 + objPos.x * 300.0);
    return c + vec3f(0.6, 0.75, 0.9) * low * amount * (0.25 + 0.15 * wobble);
}

// hollow, empty eyes (possession, the defeated): the iris drains to grey and the highlight dies
fn eyeEmpty(c: vec3f, albedo: vec3f, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let g = luma(c);
    let drained = vec3f(g * 0.8);
    let noHi = mix(c, drained, eyeIsHighlight(albedo));
    return mix(c, mix(noHi, drained, eyeIsIris(albedo)), clamp(amount, 0.0, 1.0));
}

// --- eye detail in the eye's own frame -------------------------------------------------------------------------
//
// The painted iris gets drawn-in detail the way key animation does close-ups, using the eye's real
// centre (from the eye bones) and the head's frame to know where in the eye a fragment is:
//   lid shadow   the upper third of the iris darker under the lid, with a soft lower edge
//   fibres       fine radial striations from the pupil out
//   limbal ring  a dark ring where the painted iris meets the white (found from the paint's edge)
//   crescent     a bright crescent low in the iris, opposite the light (the cornea's caustic)
//   pupil        a dark centre that tightens in shock and opens in the dark or in love
//   catchlights  a small second highlight below the painted one, and a sparkle
//                that twinkles when the character is moved (joy, wonder)

struct EyeFrame {
    local: vec2f,     // -1..1 across the iris (x toward the head's right, y up)
    r: f32,           // distance from the iris centre in iris radii
    ok: f32,          // 1 when the eye's frame is known
}

fn eyeFrameAt(worldPos: vec3f, eyeL: vec4f, eyeR: vec4f, headRight: vec3f, headUp: vec3f, headFwd: vec3f) -> EyeFrame {
    var f: EyeFrame;
    f.ok = 0.0;
    f.local = vec2f(0.0);
    f.r = 1e3;
    if (eyeL.w <= 0.0) {
        return f;
    }
    // which eye: the nearer centre
    let useL = distance(worldPos, eyeL.xyz) < distance(worldPos, eyeR.xyz);
    let e = select(eyeR, eyeL, useL);
    // the iris sits on the front of the eyeball: project the offset onto the face plane
    let d = worldPos - e.xyz;
    let x = dot(d, headRight);
    let y = dot(d, headUp);
    f.local = vec2f(x, y) / max(e.w, 1e-4);
    f.r = length(f.local);
    f.ok = 1.0;
    return f;
}

fn eyeDetail(c0: vec3f, albedo: vec3f, ef: EyeFrame, n: vec3f, l: vec3f, state: vec4f, time: f32) -> vec3f {
    if (ef.ok < 0.5) {
        return c0;
    }
    var c = c0;
    let iris = eyeIsIris(albedo);
    let ink = eyeIsInk(albedo);
    let hi = eyeIsHighlight(albedo);
    let p = ef.local;
    // lid shadow: the top of the iris in shade under the upper lid
    let lid = smoothstep(0.15, 0.55, p.y);
    c = mix(c, c * vec3f(0.55, 0.5, 0.6), lid * iris * 0.7);
    // fibres: fine radial striations
    let ang = atan2(p.y, p.x);
    let fib = valueNoise2(vec2f(ang * 18.0, ef.r * 3.0)) * 0.5 + valueNoise2(vec2f(ang * 41.0, ef.r * 6.0)) * 0.5;
    c = c * mix(1.0, 0.85 + fib * 0.3, iris * smoothstep(0.25, 0.5, ef.r));
    // limbal ring: where the paint changes from iris to white, darkened (from the paint's own edge)
    let edge = clamp(fwidth(iris) * 2.5, 0.0, 1.0);
    c = mix(c, c * 0.35, edge * (1.0 - ink) * 0.8);
    // the crescent: bright low in the iris, opposite the light
    let away = clamp(-dot(n, l) * 0.5 + 0.6, 0.0, 1.0);
    let cres = smoothstep(-0.2, -0.65, p.y) * smoothstep(0.85, 0.5, ef.r) * smoothstep(0.3, 0.55, ef.r);
    c = c + albedo * cres * iris * away * 0.9;
    // the pupil: tightens in shock (state.x small), opens wide in the dark or in love
    let pr = mix(0.12, 0.45, clamp(state.x, 0.0, 1.0));
    let pupil = 1.0 - smoothstep(pr - 0.04, pr + 0.02, ef.r);
    c = mix(c, vec3f(0.02, 0.015, 0.03), pupil * max(iris, ink) * 0.92);
    // catchlights: the painted one stays; add a small one below and a twinkling sparkle
    let c2 = 1.0 - smoothstep(0.06, 0.09, length(p - vec2f(-0.3, -0.38)));
    let tw = 0.5 + 0.5 * sin(time * 5.0 + p.x * 3.0);
    let q = p - vec2f(-0.35, 0.3);
    let star = max(exp(-abs(q.x) * 60.0) * exp(-abs(q.y) * 9.0), exp(-abs(q.y) * 60.0) * exp(-abs(q.x) * 9.0));
    let sparkle = star * state.y * tw;
    let catches = max(c2 * 0.9, sparkle) * (1.0 - hi) * max(iris, ink);
    c = mix(c, vec3f(1.0), clamp(catches, 0.0, 1.0));
    return c;
}
