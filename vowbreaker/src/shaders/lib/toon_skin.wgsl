// ============================================================================================
// vb_toon_skin: anime skin. Light bleeds red into the shadow edge (a cheap subsurface band that
// follows the terminator), shadow on skin stays warm and saturated rather than grey, the cheeks
// and nose tip and ears carry a little blush that survives into shadow, and highlights are rare:
// a soft sheen on the nose bridge, a glint on the lower lip. In the face region the shadow shape
// comes from the head-space thresholds (vb_toon.faceShadow), so faces never get blotchy.
// Depends on vb_common, vb_color, vb_lighting, vb_toon, vb_toon_ramp.
// ============================================================================================

struct SkinParams {
    scatterColor: vec3f,   // the colour light becomes inside skin (red-orange)
    scatterWidth: f32,     // width of the scattering band past the terminator
    blush: f32,            // overall blush strength
    shadowWarmth: f32,     // how much warmer skin shadow is than other shadows
    sheen: f32,            // soft forward-scattered sheen at grazing angles (peach fuzz)
    oil: f32,              // tiny specular (nose bridge, forehead)
}

fn skinDefault() -> SkinParams {
    return SkinParams(vec3f(0.85, 0.22, 0.12), 0.12, 1.0, 0.35, 0.25, 0.15);
}

fn skinCurse() -> SkinParams {
    // the curse-touched: grey skin, a sickly green scatter, no blush
    return SkinParams(vec3f(0.25, 0.4, 0.2), 0.08, 0.0, -0.2, 0.05, 0.05);
}

// shadow colour for skin: warmer and more saturated than the generic ramp
fn skinShadowColor(p: SkinParams, albedo: vec3f, sceneShadow: vec3f) -> vec3f {
    var r = rampSkin();
    let base = rampShadowColor(r, albedo, sceneShadow);
    let warm = base * vec3f(1.0 + p.shadowWarmth * 0.25, 1.0, 1.0 - p.shadowWarmth * 0.25);
    return max(warm, vec3f(0.0));
}

// light that went into the skin near the terminator and came out red
fn skinScatterBand(p: SkinParams, halfL: f32, threshold: f32, albedo: vec3f, lightCol: vec3f) -> vec3f {
    let d = halfL - threshold;
    let inside = smoothstep(-p.scatterWidth, 0.0, d) * (1.0 - smoothstep(0.0, p.scatterWidth * 0.6, d));
    return p.scatterColor * albedo * lightCol * inside * 0.55;
}

// back-lit ears and thin skin glow red when the light is behind them
fn skinTranslucency(n: vec3f, v: vec3f, l: vec3f, thickness: f32, p: SkinParams, lightCol: vec3f) -> vec3f {
    let h = normalize(l + n * 0.4);
    let t = pow(clamp(dot(v, -h), 0.0, 1.0), 4.0) * (1.0 - thickness);
    return p.scatterColor * lightCol * t * 0.6;
}

// peach-fuzz sheen at grazing angles on the lit side
fn skinSheen(n: vec3f, v: vec3f, l: vec3f, p: SkinParams, lightCol: vec3f) -> vec3f {
    let f = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
    let lit = clamp(dot(n, l) * 0.5 + 0.5, 0.0, 1.0);
    return lightCol * f * lit * p.sheen * 0.25;
}

// a tiny soft highlight, only where the surface faces the half vector very closely
fn skinOil(n: vec3f, v: vec3f, l: vec3f, p: SkinParams, lit: f32) -> f32 {
    let s = toonSpecular(n, l, v, 0.012, 0.01);
    return s * p.oil * lit;
}

// blush that persists in shadow (painted on, not lit): pushes red into the cheek areas that the
// vertex painting already marked (vertex colour g and b were dropped there)
fn skinBlushBoost(albedo: vec3f, p: SkinParams) -> vec3f {
    let redness = clamp((albedo.r - albedo.g) * 2.2 - 0.25, 0.0, 1.0);
    let boost = vec3f(1.0 + 0.12 * redness * p.blush, 1.0 - 0.05 * redness * p.blush, 1.0 - 0.04 * redness * p.blush);
    return albedo * boost;
}

// the full skin response (outside the face region)
fn skinShade(p: SkinParams, albedo0: vec3f, n: vec3f, v: vec3f, l: vec3f, lit: ToonLit, sunCol: vec3f, sceneShadow: vec3f,
             ao: f32) -> vec3f {
    let albedo = skinBlushBoost(albedo0, p);
    let r = rampSkin();
    let shadowCol = skinShadowColor(p, albedo, sceneShadow) * (lit.ambient + vec3f(0.14));
    let litCol = albedo * (lit.direct + lit.ambient * 0.35);
    var c = mix(shadowCol, litCol, lit.lit);
    c = c + skinScatterBand(p, lit.halfL, r.threshold + (1.0 - ao) * r.aoInfluence, albedo, sunCol);
    c = c + skinSheen(n, v, l, p, sunCol) * lit.lit;
    c = c + sunCol * skinOil(n, v, l, p, lit.lit) * 0.3;
    c = c + albedo * lit.points;
    return c;
}

// the face: shadow shape from the head-space thresholds, the rest like skin
fn skinFace(p: SkinParams, albedo0: vec3f, faceLit: f32, castShadow: f32, n: vec3f, v: vec3f, l: vec3f, ambient: vec3f, sunCol: vec3f,
            sceneShadow: vec3f, points: vec3f) -> vec3f {
    let albedo = skinBlushBoost(albedo0, p);
    let lit = faceLit * mix(1.0, castShadow, 0.75);
    let shadowCol = skinShadowColor(p, albedo, sceneShadow) * (ambient + vec3f(0.16));
    let litCol = albedo * (sunCol + ambient * 0.35);
    var c = mix(shadowCol, litCol, lit);
    // a soft warm edge where the face shadow ends
    let edge = smoothstep(0.0, 0.5, lit) * (1.0 - smoothstep(0.5, 1.0, lit));
    c = c + p.scatterColor * albedo * sunCol * edge * 0.18;
    c = c + albedo * points;
    return c;
}

// lips and inner mouth read darker and redder in shadow (used by the mouth decal colour)
fn skinMouthTint(c: vec3f, open: f32) -> vec3f {
    return mix(c, c * vec3f(0.55, 0.25, 0.28), clamp(open, 0.0, 1.0));
}

// a cold, bloodless tint for the dead and the dying (memory scenes, the defeated)
fn skinPallor(c: vec3f, amount: f32) -> vec3f {
    let g = luma(c);
    let cold = vec3f(g * 0.92, g * 0.97, g * 1.06);
    return mix(c, cold, clamp(amount, 0.0, 1.0));
}

// bruising and scrapes from a hard fight, from object-space noise and a damage amount
fn skinDamage(c: vec3f, objPos: vec3f, damage: f32) -> vec3f {
    if (damage <= 0.0) {
        return c;
    }
    let n = vfbm3(objPos * 9.0, 3);
    let bruise = smoothstep(0.62 - damage * 0.2, 0.75 - damage * 0.2, n);
    let scrape = smoothstep(0.8, 0.86, valueNoise3(objPos * vec3f(40.0, 8.0, 40.0))) * damage;
    var o = mix(c, c * vec3f(0.72, 0.62, 0.8), bruise * damage);
    o = mix(o, vec3f(0.62, 0.12, 0.1), scrape * 0.6);
    return o;
}

// sweat sheen in long fights: speckled highlights
fn skinSweat(c: vec3f, n: vec3f, v: vec3f, l: vec3f, objPos: vec3f, amount: f32, lightCol: vec3f) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let s = toonSpecular(n, l, v, 0.06, 0.02);
    let speck = sparkle3(objPos * 60.0, 0.3, 8.0);
    return c + lightCol * s * speck * amount * 0.6;
}
