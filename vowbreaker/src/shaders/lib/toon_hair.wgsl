// ============================================================================================
// vb_toon_hair: anime hair. Each clump is shaded in two steps with a darker core, the underside
// and inside of the hair mass sinks into a deep cool shadow, and the light is drawn the way
// illustrators draw it: an "angel ring" band that wraps round the head and breaks into sharp
// zig-zag strands, a secondary softer sheen shifted toward the tips (two-lobe Kajiya-Kay), and a
// rim of light catching the clump edges against the sky. Strand direction comes from the hair's
// flow down the head (the head up vector), perturbed per clump.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_lighting, vb_toon, vb_toon_ramp.
// ============================================================================================

struct HairParams {
    ringHeight: f32,       // where the angel ring sits, as the cosine between normal and head-up
    ringWidth: f32,
    ringJag: f32,          // how hard the ring breaks into strands
    sheenShift: f32,       // second lobe shift along the strand
    sheenPower: f32,
    ringColor: vec3f,      // tint of the ring (white for black hair, warmer for light hair)
    tipLight: f32,         // tips catch more light (thin hair is translucent)
}

fn hairDefault(albedo: vec3f) -> HairParams {
    let dark = 1.0 - smoothstep(0.05, 0.35, luma(albedo));
    let ring = mix(mix(albedo, vec3f(1.0), 0.45), mix(albedo, vec3f(0.85, 0.88, 1.0), 0.7), dark);
    return HairParams(0.45, 0.14, 0.6, 0.18, 70.0, ring, 0.35);
}

// a strand tangent: down the head, wiggled per clump so neighbouring clumps catch light differently
fn hairTangent(n: vec3f, headUp: vec3f, objPos: vec3f) -> vec3f {
    let wig = (valueNoise3(objPos * 7.0) - 0.5) * 0.6;
    var t = -headUp + n * wig;
    t = t - n * dot(t, n);
    return safeNormalize3(t);
}

// the angel ring: a band in head space, its edge chopped into strands by noise along the band
fn hairRing(n: vec3f, v: vec3f, headUp: vec3f, p: HairParams, objPos: vec3f) -> f32 {
    let strandAngle = atan2(objPos.z, objPos.x);
    let strand = valueNoise2(vec2f(strandAngle * 28.0, objPos.y * 3.0));
    let jag = (strand - 0.5) * p.ringJag * p.ringWidth;
    let h = dot(n, headUp);
    let facing = clamp(dot(n, v), 0.0, 1.0);
    let band = 1.0 - smoothstep(p.ringWidth * 0.5, p.ringWidth * 0.5 + 0.02, abs(h - p.ringHeight - jag));
    return band * smoothstep(0.1, 0.4, facing);
}

// two-lobe Kajiya-Kay: a sharp primary and a softer secondary shifted toward the tips
fn hairSheen(t: vec3f, n: vec3f, l: vec3f, v: vec3f, p: HairParams) -> vec2f {
    let s1 = kajiyaKay(t, l, v, p.sheenShift * 0.3, n, p.sheenPower);
    let s2 = kajiyaKay(t, l, v, -p.sheenShift, n, p.sheenPower * 0.25);
    return vec2f(smoothstep(0.45, 0.65, s1), smoothstep(0.3, 0.7, s2));
}

// the underside of the hair mass and the hair close to the scalp sink into a cool shadow
fn hairOcclusion(n: vec3f, headUp: vec3f, ao: f32) -> f32 {
    let under = clamp(-dot(n, headUp), 0.0, 1.0);
    return clamp(under * 0.6 + (1.0 - ao) * 0.7, 0.0, 1.0);
}

// thin tips scatter light through: brighter toward the tips when back-lit
fn hairTipGlow(n: vec3f, v: vec3f, l: vec3f, tipness: f32, p: HairParams, lightCol: vec3f) -> vec3f {
    let back = pow(clamp(dot(v, -l), 0.0, 1.0), 3.0);
    return lightCol * back * tipness * p.tipLight * 0.4;
}

// the full hair response
fn hairShade(albedo: vec3f, n: vec3f, v: vec3f, l: vec3f, headUp: vec3f, objPos: vec3f, lit: ToonLit, sunCol: vec3f,
             sceneShadow: vec3f, ao: f32, ringAmount: f32) -> vec3f {
    let p = hairDefault(albedo);
    let r = rampHair();
    let occ = hairOcclusion(n, headUp, ao);
    let shadowCol = rampShadowColor(r, albedo, sceneShadow) * (lit.ambient + vec3f(0.1));
    let deep = rampCoreColor(r, shadowCol);
    let litCol = albedo * (lit.direct + lit.ambient * 0.3);
    var c = mix(shadowCol, litCol, lit.lit);
    c = mix(c, deep, clamp(max(lit.core, occ * 0.8), 0.0, 1.0) * 0.8);
    let t = hairTangent(n, headUp, objPos);
    let sh = hairSheen(t, n, l, v, p);
    let ring = hairRing(n, v, headUp, p, objPos) * ringAmount;
    c = c + p.ringColor * sunCol * (step(0.5, ring) * 0.55 * (0.35 + 0.65 * lit.lit));
    c = c + p.ringColor * sunCol * (sh.x * 0.22 + sh.y * 0.1) * lit.lit * ringAmount;
    let tipness = smoothstep(0.0, 0.25, -dot(n, headUp) + 0.1);
    c = c + hairTipGlow(n, v, l, tipness, p, sunCol);
    c = c + albedo * lit.points;
    return c;
}

// wet hair (rain chapters): darker, more contrast, a hard clean highlight
fn hairWet(c: vec3f, n: vec3f, v: vec3f, l: vec3f, wet: f32, lightCol: vec3f) -> vec3f {
    if (wet <= 0.0) {
        return c;
    }
    let darker = c * (1.0 - 0.35 * wet);
    let s = toonSpecular(n, l, v, 0.03, 0.005) * wet;
    return darker + lightCol * s * 0.5;
}

// hair lifted by cursed energy: the ends glow in the palette colour
fn hairEnergy(c: vec3f, objPos: vec3f, headY: f32, energy: f32, glowCol: vec3f, time: f32) -> vec3f {
    if (energy <= 0.0) {
        return c;
    }
    let flicker = 0.7 + 0.3 * valueNoise2(vec2f(objPos.x * 20.0, time * 6.0));
    let tips = smoothstep(headY - 0.05, headY + 0.2, objPos.y);
    return c + glowCol * energy * flicker * (0.15 + 0.35 * tips);
}
