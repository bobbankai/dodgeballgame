// ============================================================================================
// vb_toon_ramp: how light becomes paint on a character.
//
// A ToonRamp is the artist's description of a material's light response: where the shadow line
// sits, how hard it is, an optional third (core) tone, how far AO pushes creases into shadow, how
// the shadow colour is mixed (cool wash, hue shift, saturation), and how the terminator glows.
// ToonLit accumulates every light that touches a point -- the sun, the sky, up to four cursed
// point lights, the rim -- so materials can be written as "albedo times what arrived".
// Shadows can be painted rather than computed exactly: the edge wobbles with a brush noise in
// object space, and deep shadow can be filled with manga screentone or crosshatching.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_lighting, vb_toon.
// ============================================================================================

struct ToonRamp {
    threshold: f32,      // half-lambert value where light turns to shadow (0..1)
    softness: f32,       // half width of the transition
    coreThreshold: f32,  // a second, darker core shadow (0 disables)
    coreDarken: f32,     // how much darker the core is than the shadow
    aoInfluence: f32,    // how far a fully occluded crease moves the threshold
    shadowHue: f32,      // radians of hue rotation applied in shadow (toward blue = negative)
    shadowSat: f32,      // saturation multiplier in shadow (anime shadows are richer)
    shadowValue: f32,    // value multiplier in shadow
    terminatorWidth: f32,
    terminatorBoost: f32,
    paintedEdge: f32,    // brush wobble of the shadow edge (0 = clean)
    bands: f32,          // > 0 quantises the lit side into bands (cel steps)
}

fn rampDefault() -> ToonRamp {
    return ToonRamp(0.5, 0.012, 0.0, 0.35, 0.45, -0.12, 1.15, 0.62, 0.06, 0.12, 0.0, 0.0);
}

fn rampSkin() -> ToonRamp {
    return ToonRamp(0.46, 0.02, 0.0, 0.3, 0.35, -0.05, 1.25, 0.72, 0.08, 0.2, 0.0, 0.0);
}

fn rampHair() -> ToonRamp {
    return ToonRamp(0.52, 0.01, 0.3, 0.35, 0.5, -0.18, 1.1, 0.55, 0.05, 0.1, 0.0, 0.0);
}

fn rampCloth() -> ToonRamp {
    return ToonRamp(0.5, 0.008, 0.26, 0.3, 0.55, -0.15, 1.12, 0.6, 0.05, 0.1, 0.25, 0.0);
}

fn rampMetal() -> ToonRamp {
    return ToonRamp(0.55, 0.006, 0.35, 0.45, 0.4, -0.2, 0.9, 0.45, 0.03, 0.05, 0.0, 3.0);
}

fn rampPaper() -> ToonRamp {
    return ToonRamp(0.35, 0.03, 0.0, 0.2, 0.3, 0.05, 0.9, 0.82, 0.12, 0.08, 0.4, 0.0);
}

// --- coverage --------------------------------------------------------------------------------

// how lit a point is (0 shadow .. 1 light) for a half-lambert value, AO and an optional painted edge
fn rampCoverage(r: ToonRamp, halfL: f32, ao: f32, edgeNoise: f32) -> f32 {
    let t = r.threshold + (1.0 - ao) * r.aoInfluence + (edgeNoise - 0.5) * r.paintedEdge * 0.12;
    return smoothstep(t - r.softness, t + r.softness, halfL);
}

fn rampCore(r: ToonRamp, halfL: f32, ao: f32) -> f32 {
    if (r.coreThreshold <= 0.0) {
        return 0.0;
    }
    let t = r.coreThreshold + (1.0 - ao) * r.aoInfluence * 0.6;
    return 1.0 - smoothstep(t - r.softness, t + r.softness, halfL);
}

// the brush wobble of a painted shadow edge, stable on the object (object-space noise)
fn rampEdgeNoise(objPos: vec3f, scale: f32) -> f32 {
    let n = vfbm3(objPos * scale, 3);
    let streak = valueNoise3(vec3f(objPos.x * scale * 3.0, objPos.y * scale * 0.6, objPos.z * scale * 3.0));
    return clamp(n * 0.7 + streak * 0.3, 0.0, 1.0);
}

// --- colour -------------------------------------------------------------------------------------

// the shadow colour for an albedo: value dropped, hue nudged cool, saturation raised, tinted by
// the scene's shadow colour (so a scene at dusk has violet shadows, at noon blue ones)
fn rampShadowColor(r: ToonRamp, albedo: vec3f, sceneShadow: vec3f) -> vec3f {
    var c = hueRotate(albedo, r.shadowHue);
    c = adjustSaturation(c, r.shadowSat);
    c = c * r.shadowValue;
    let tinted = c * mix(vec3f(1.0), sceneShadow * 1.6, 0.45);
    return max(tinted, vec3f(0.0));
}

fn rampCoreColor(r: ToonRamp, shadowCol: vec3f) -> vec3f {
    return adjustSaturation(shadowCol * (1.0 - r.coreDarken), 1.1);
}

// warm saturated glow right on the terminator (light scattering at the shadow edge)
fn rampTerminator(r: ToonRamp, halfL: f32, ao: f32, albedo: vec3f, lightCol: vec3f) -> vec3f {
    let t = r.threshold + (1.0 - ao) * r.aoInfluence;
    let band = terminatorBand(halfL, t, r.terminatorWidth + r.softness * 2.0);
    return adjustSaturation(albedo, 1.8) * lightCol * band * r.terminatorBoost;
}

// quantise the lit side into a few steps (metal, lacquer)
fn rampBands(r: ToonRamp, halfL: f32) -> f32 {
    if (r.bands <= 0.0) {
        return 1.0;
    }
    let x = clamp((halfL - r.threshold) / max(1.0 - r.threshold, 1e-3), 0.0, 1.0);
    return 0.75 + 0.25 * quantizeSoft(x, r.bands, 0.08);
}

// --- shadow fills: screentone and hatching --------------------------------------------------------

// manga screentone dots in shadow; `px` is the pixel position, cell in pixels
fn rampScreentone(px: vec2f, shadow: f32, cellPx: f32, amount: f32) -> f32 {
    if (amount <= 0.0) {
        return 0.0;
    }
    let tone = halftoneDots(px, cellPx, 0.785, shadow * amount);
    return tone * shadow;
}

// world-space crosshatch layered by darkness: one direction for shadow, two for core shadow
fn rampHatch(worldPos: vec3f, n: vec3f, shadow: f32, core: f32, spacing: f32, amount: f32) -> f32 {
    if (amount <= 0.0) {
        return 0.0;
    }
    let h1 = hatchTriplanar(worldPos, n, shadow * 0.55, spacing);
    let h2 = hatchTriplanar(worldPos.zyx * 1.13 + vec3f(3.1, 0.0, 1.7), n.zyx, core * 0.7, spacing * 0.8);
    return clamp(max(h1, h2) * amount, 0.0, 1.0);
}

// --- light accumulation -------------------------------------------------------------------------

struct ToonLit {
    direct: vec3f,     // sun and point light colour reaching the lit side
    lit: f32,          // final light coverage 0..1 (after shadows)
    core: f32,         // core shadow amount 0..1
    halfL: f32,
    ambient: vec3f,
    rim: vec3f,
    points: vec3f,
}

fn toonLitZero() -> ToonLit {
    return ToonLit(vec3f(0.0), 0.0, 0.0, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0));
}

fn toonGather(r: ToonRamp, n: vec3f, l: vec3f, sunCol: vec3f, shadow: f32, ao: f32, edgeNoise: f32,
              sky: vec3f, ground: vec3f) -> ToonLit {
    var o = toonLitZero();
    o.halfL = halfLambert(n, l);
    o.lit = rampCoverage(r, o.halfL, ao, edgeNoise) * shadow;
    o.core = rampCore(r, o.halfL, ao) * (1.0 - o.lit);
    o.direct = sunCol * rampBands(r, o.halfL);
    o.ambient = hemiAmbient(n, sky, ground);
    return o;
}

// add a stepped point light (cursed energy, lanterns) into the gathered light
fn toonAddPoint(o: ToonLit, n: vec3f, worldPos: vec3f, lightPos: vec3f, range: f32, col: vec3f, bands: f32) -> ToonLit {
    var r = o;
    let k = toonPointLight(n, worldPos, lightPos, range, bands);
    r.points = r.points + col * k;
    return r;
}

// the final mix of shadow tone, lit tone, core shadow and point lights
fn toonCompose(r: ToonRamp, albedo: vec3f, lit: ToonLit, sceneShadow: vec3f) -> vec3f {
    let shadowCol = rampShadowColor(r, albedo, sceneShadow) * (lit.ambient + vec3f(0.12));
    let litCol = albedo * (lit.direct + lit.ambient * 0.35);
    var c = mix(shadowCol, litCol, lit.lit);
    c = mix(c, rampCoreColor(r, shadowCol), lit.core * 0.85);
    c = c + albedo * lit.points;
    return c + lit.rim;
}

// --- rims -----------------------------------------------------------------------------------------

// a crisp back rim on the side away from the key light, thicker at grazing angles
fn rimBack(n: vec3f, v: vec3f, l: vec3f, width: f32, col: vec3f, albedo: vec3f) -> vec3f {
    let rim = toonRim(n, v, -l, width, 0.015, 0.8);
    return col * rim * (0.6 + 0.4 * luma(albedo));
}

// a screen-space rim from the view normal: stays put as the camera orbits (good for faces)
fn rimScreen(viewNormal: vec3f, dirVS: vec2f, width: f32, col: vec3f) -> vec3f {
    return col * viewRim(viewNormal, dirVS, width, 0.02);
}

// light "wrapping" round the silhouette on the lit side: the anime glow on a lit cheek
fn rimWrap(n: vec3f, v: vec3f, l: vec3f, col: vec3f, amount: f32) -> vec3f {
    let f = 1.0 - clamp(dot(n, v), 0.0, 1.0);
    let s = clamp(dot(n, l), 0.0, 1.0);
    return col * smoothstep(0.55, 0.85, f) * s * amount;
}

// --- specular shapes ------------------------------------------------------------------------------

// a stylised highlight shape: a soft-edged ellipse stretched along a tangent
fn specEllipse(n: vec3f, t: vec3f, l: vec3f, v: vec3f, size: vec2f, softness: f32) -> f32 {
    let h = normalize(l + v);
    let b = normalize(cross(n, t));
    let tx = dot(h, normalize(t - n * dot(t, n)));
    let by = dot(h, b);
    let nh = dot(n, h);
    let d = length(vec2f(tx / max(size.x, 1e-3), by / max(size.y, 1e-3)));
    return (1.0 - smoothstep(1.0 - softness, 1.0 + softness, d)) * step(0.0, nh);
}

// a highlight broken into a few strokes (painted gloss), from object-space noise
fn specBroken(spec: f32, objPos: vec3f, scale: f32, breakup: f32) -> f32 {
    let n = valueNoise3(objPos * scale);
    return spec * smoothstep(breakup - 0.1, breakup + 0.1, n);
}

// --- value structure ------------------------------------------------------------------------------

// keep a minimum value contrast between light and shadow regardless of albedo (very dark or very
// light materials otherwise lose their shadow shapes)
fn rampEnsureContrast(litCol: vec3f, shadowCol: vec3f, minRatio: f32) -> vec3f {
    let ll = max(luma(litCol), 1e-4);
    let ls = luma(shadowCol);
    let tgt = ll * (1.0 - minRatio);
    if (ls <= tgt) {
        return shadowCol;
    }
    return shadowCol * (tgt / max(ls, 1e-4));
}

// darken toward the ground: the bottom of a figure reads heavier (classic cel trick)
fn rampGroundGradient(c: vec3f, heightAboveFeet: f32, figureHeight: f32, amount: f32) -> vec3f {
    let k = 1.0 - smoothstep(0.0, figureHeight * 0.45, heightAboveFeet);
    return c * (1.0 - k * amount);
}

// lighten toward the head: draws the eye up to the face
fn rampHeadLift(c: vec3f, heightAboveFeet: f32, figureHeight: f32, amount: f32) -> vec3f {
    let k = smoothstep(figureHeight * 0.7, figureHeight, heightAboveFeet);
    return c * (1.0 + k * amount);
}
