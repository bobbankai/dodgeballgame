// ============================================================================================
// vb_toon_metal: brass bells and buttons, steel chains and buckles, lacquer, paper. Metal in a
// cel world is drawn, not simulated: a fake environment band (sky above, ground below, a dark
// horizon line), a big stepped highlight and a small sharp one, a coloured shadow for brass.
// Lacquer is black glass with one hard white reflection. Paper lets light through.
// Depends on vb_common, vb_noise, vb_color, vb_lighting, vb_brdf, vb_toon_ramp.
// ============================================================================================

fn metalIsBrass(albedo: vec3f) -> f32 {
    return smoothstep(0.08, 0.2, albedo.r - albedo.b) * smoothstep(0.2, 0.5, luma(albedo));
}

// a painted environment: sky colour above the horizon, a dark band at it, warm ground below
fn metalEnvBand(n: vec3f, v: vec3f, sky: vec3f, ground: vec3f) -> vec3f {
    let r = reflect(-v, n);
    let up = r.y;
    let horizon = 1.0 - smoothstep(0.0, 0.08, abs(up + 0.02));
    var c = mix(ground * 0.6, sky * 1.4, smoothstep(-0.05, 0.25, up));
    c = mix(c, c * 0.25, horizon * 0.8);
    return c;
}

fn metalShade(albedo: vec3f, n: vec3f, v: vec3f, l: vec3f, lit: ToonLit, sunCol: vec3f, sky: vec3f, ground: vec3f) -> vec3f {
    let r = rampMetal();
    let brass = metalIsBrass(albedo);
    let env = metalEnvBand(n, v, sky, ground) * albedo * 1.6;
    let shadowTint = mix(vec3f(0.45, 0.5, 0.65), vec3f(0.6, 0.35, 0.18), brass);
    var c = mix(env * shadowTint, env + albedo * sunCol * 0.4, lit.lit);
    let big = toonSpecular(n, l, v, 0.1, 0.015);
    let small = toonSpecular(n, l, v, 0.015, 0.004);
    let hiCol = mix(vec3f(1.0), mix(albedo, vec3f(1.0), 0.4), brass);
    c = c + hiCol * sunCol * (big * 0.45 + small * 1.2) * lit.lit;
    c = c + albedo * lit.points * 1.4;
    return c;
}

fn lacquerShade(albedo: vec3f, n: vec3f, v: vec3f, l: vec3f, lit: ToonLit, sunCol: vec3f, sky: vec3f) -> vec3f {
    var c = albedo * (0.4 + 0.6 * lit.lit) * (lit.direct * 0.3 + lit.ambient);
    let refl = reflect(-v, n);
    let window = smoothstep(0.55, 0.62, refl.y) * smoothstep(0.98, 0.9, refl.y);
    c = c + sky * window * 0.4;
    c = c + sunCol * toonSpecular(n, l, v, 0.02, 0.003) * 1.2;
    return c;
}

// paper: lit side bright, shadow side stays light and warm (light passes through), and a
// back-lit sheet glows
fn paperShade(albedo: vec3f, n: vec3f, v: vec3f, l: vec3f, lit: ToonLit, sunCol: vec3f, sceneShadow: vec3f) -> vec3f {
    let r = rampPaper();
    let shadowCol = rampShadowColor(r, albedo, sceneShadow) * (lit.ambient + vec3f(0.3));
    let litCol = albedo * (lit.direct + lit.ambient * 0.4);
    var c = mix(shadowCol, litCol, lit.lit);
    let through = pow(clamp(dot(-v, l), 0.0, 1.0), 4.0);
    c = c + albedo * sunCol * through * 0.6;
    c = mix(c, albedo * sunCol * 1.1, 0.25);
    c = c + albedo * lit.points * 1.2;
    return c;
}

// gold leaf / gilt thread (the bride's obi, temple fittings): flickering glints in object space
fn giltGlints(n: vec3f, v: vec3f, l: vec3f, objPos: vec3f, lightCol: vec3f) -> vec3f {
    let s = sparkle3(objPos * 90.0 + n * 3.0, 0.4, 10.0);
    let facing = toonSpecular(n, l, v, 0.25, 0.1);
    return vec3f(1.0, 0.85, 0.5) * lightCol * s * facing * 0.8;
}

// rust and verdigris on old metal (the shakujo's rings, temple bells)
fn metalAge(c: vec3f, objPos: vec3f, age: f32) -> vec3f {
    if (age <= 0.0) {
        return c;
    }
    let n = vfbm3(objPos * 30.0, 3);
    let verd = smoothstep(0.55, 0.7, n) * age;
    let rust = smoothstep(0.65, 0.8, vfbm3(objPos * 45.0 + vec3f(5.0), 2)) * age;
    var o = mix(c, vec3f(0.3, 0.55, 0.45) * luma(c) * 2.0, verd * 0.6);
    o = mix(o, vec3f(0.45, 0.2, 0.08), rust * 0.5);
    return o;
}
