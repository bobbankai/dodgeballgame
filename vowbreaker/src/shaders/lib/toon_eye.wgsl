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
