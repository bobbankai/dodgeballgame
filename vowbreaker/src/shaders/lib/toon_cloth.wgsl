// ============================================================================================
// vb_toon_cloth: fabric, read by its sheen. Cotton is matte with a faint fuzz at grazing angles;
// wool (the gakuran, the coat) has a soft velvety rim; silk (the bride's shiromuku, Ryōga's
// lining) has an anisotropic sheen running along the weave and a shifted colour in its
// highlight; leather has a tight glossy highlight broken by grain; the folds carry a painted core
// shadow and the weave shows as micro pattern up close. Material families are picked from the
// albedo and the per-part line width channel (both painted in the Blender pipeline) so no extra
// vertex data is needed: dark, desaturated cloth is wool; bright saturated cloth is silk; etc.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_lighting, vb_brdf, vb_toon_ramp.
// ============================================================================================

const CLOTH_COTTON: i32 = 0;
const CLOTH_WOOL: i32 = 1;
const CLOTH_SILK: i32 = 2;
const CLOTH_LEATHER: i32 = 3;
const CLOTH_CANVAS: i32 = 4;

struct ClothParams {
    family: i32,
    sheenColor: vec3f,
    sheenAmount: f32,
    roughness: f32,
    weaveScale: f32,
    weaveAmount: f32,
    anisotropy: f32,
}

// choose a cloth family from what the albedo looks like
fn clothGuess(albedo: vec3f) -> ClothParams {
    let l = luma(albedo);
    let mx = maxc3(albedo);
    let sat = (mx - minc3(albedo)) / max(mx, 1e-4);
    if (l < 0.04 && sat < 0.35) {
        // near-black: wool (gakuran, coats) or leather; leather if very dark and neutral
        if (l < 0.015) {
            return ClothParams(CLOTH_LEATHER, vec3f(0.6, 0.62, 0.7), 0.4, 0.25, 220.0, 0.05, 0.0);
        }
        return ClothParams(CLOTH_WOOL, vec3f(0.55, 0.6, 0.75), 0.55, 0.7, 180.0, 0.12, 0.0);
    }
    if (l > 0.55 && sat < 0.12) {
        // white cloth: silk for kimono-white, cotton for shirts (both handled as silk-ish sheen)
        return ClothParams(CLOTH_SILK, vec3f(1.0, 0.97, 0.92), 0.3, 0.35, 260.0, 0.06, 0.6);
    }
    if (sat > 0.5) {
        return ClothParams(CLOTH_SILK, mix(albedo, vec3f(1.0), 0.5), 0.35, 0.4, 260.0, 0.05, 0.5);
    }
    return ClothParams(CLOTH_COTTON, mix(albedo, vec3f(1.0), 0.3), 0.25, 0.8, 200.0, 0.1, 0.0);
}

// velvet / wool: light caught at grazing angles all round the silhouette, stronger when lit
fn clothVelvet(n: vec3f, v: vec3f, l: vec3f, p: ClothParams, lightCol: vec3f, lit: f32) -> vec3f {
    let nv = clamp(dot(n, v), 0.0, 1.0);
    let rim = pow(1.0 - nv, 2.5);
    let side = 0.35 + 0.65 * clamp(dot(n, l) * 0.5 + 0.5, 0.0, 1.0);
    return p.sheenColor * lightCol * rim * side * p.sheenAmount * (0.35 + 0.65 * lit) * 0.3;
}

// silk: an anisotropic band along the weave direction (vertical on hanging cloth)
fn clothSilk(n: vec3f, v: vec3f, l: vec3f, p: ClothParams, lightCol: vec3f, lit: f32) -> vec3f {
    let up = vec3f(0.0, 1.0, 0.0);
    var t = up - n * dot(up, n);
    t = safeNormalize3(t);
    let k = kajiyaKay(t, l, v, 0.0, n, 30.0);
    let band = smoothstep(0.3, 0.55, k) * (1.0 - smoothstep(0.85, 1.0, k) * 0.3);
    return p.sheenColor * lightCol * band * p.sheenAmount * lit * 0.35;
}

// leather: a tight highlight broken by grain
fn clothLeather(n: vec3f, v: vec3f, l: vec3f, p: ClothParams, lightCol: vec3f, lit: f32, objPos: vec3f) -> vec3f {
    let s = toonSpecular(n, l, v, 0.03, 0.006);
    let grain = smoothstep(0.35, 0.6, valueNoise3(objPos * 140.0));
    return p.sheenColor * lightCol * s * grain * lit * 0.5;
}

// the weave: a fine crosshatch modulation in object space, fading with distance
fn clothWeave(objPos: vec3f, n: vec3f, p: ClothParams, viewDist: f32) -> f32 {
    let fade = 1.0 - smoothstep(1.5, 6.0, viewDist);
    if (fade <= 0.0) {
        return 1.0;
    }
    let w = triplanarWeights(n, 4.0);
    let s = p.weaveScale;
    let a = sin(objPos.y * s) * sin(objPos.x * s) * w.z + sin(objPos.y * s) * sin(objPos.z * s) * w.x + sin(objPos.x * s) * sin(objPos.z * s) * w.y;
    return 1.0 + a * p.weaveAmount * 0.5 * fade;
}

// fold shading: deep creases (low AO) get an extra painted core darkening with a hard edge
fn clothFolds(c: vec3f, ao: f32, shadowCol: vec3f) -> vec3f {
    let k = 1.0 - smoothstep(0.35, 0.55, ao);
    return mix(c, shadowCol * 0.85, k * 0.55);
}

// stitching: a dotted light line where the vertex colour changes (piping, hems) can't be known
// here, so seams are drawn along object-space planes the cloth crosses at regular intervals
fn clothStitch(objPos: vec3f, spacing: f32) -> f32 {
    let dash = step(0.5, fract(objPos.y * spacing * 6.0));
    let line = 1.0 - smoothstep(0.0, 0.0015, abs(fract(objPos.x * spacing) - 0.5) - 0.495);
    return dash * line;
}

// the full cloth response
fn clothShade(albedo: vec3f, n: vec3f, v: vec3f, l: vec3f, objPos: vec3f, lit: ToonLit, sunCol: vec3f, sceneShadow: vec3f, ao: f32,
              viewDist: f32) -> vec3f {
    let p = clothGuess(albedo);
    let r = rampCloth();
    let weave = clothWeave(objPos, n, p, viewDist);
    let base = albedo * weave;
    let shadowCol = rampShadowColor(r, base, sceneShadow) * (lit.ambient + vec3f(0.12));
    let litCol = base * (lit.direct + lit.ambient * 0.35);
    var c = mix(shadowCol, litCol, lit.lit);
    c = mix(c, rampCoreColor(r, shadowCol), lit.core * 0.7);
    c = clothFolds(c, ao, shadowCol);
    c = c + rampTerminator(r, lit.halfL, ao, base, sunCol) * lit.lit;
    if (p.family == CLOTH_WOOL) {
        c = c + clothVelvet(n, v, l, p, sunCol, lit.lit);
    } else if (p.family == CLOTH_SILK) {
        c = c + clothSilk(n, v, l, p, sunCol, lit.lit);
        c = c + clothVelvet(n, v, l, p, sunCol, lit.lit) * 0.3;
    } else if (p.family == CLOTH_LEATHER) {
        c = c + clothLeather(n, v, l, p, sunCol, lit.lit, objPos);
    } else {
        c = c + clothVelvet(n, v, l, p, sunCol, lit.lit) * 0.5;
    }
    c = c + base * lit.points;
    return c;
}

// rain soaks cloth: darker, more saturated, a faint wet sheen at grazing angles
fn clothWet(c: vec3f, n: vec3f, v: vec3f, l: vec3f, wet: f32, lightCol: vec3f) -> vec3f {
    if (wet <= 0.0) {
        return c;
    }
    let soaked = adjustSaturation(c * (1.0 - 0.3 * wet), 1.0 + 0.2 * wet);
    let sheen = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 4.0) * wet * 0.2;
    let s = toonSpecular(n, l, v, 0.02, 0.01) * wet * 0.2;
    return soaked + lightCol * (sheen + s);
}

// a fight wears clothes: dust toward the hems, scorch and tears from damage
fn clothWear(c: vec3f, objPos: vec3f, heightFrac: f32, dust: f32, damage: f32) -> vec3f {
    var o = c;
    if (dust > 0.0) {
        let d = (1.0 - smoothstep(0.0, 0.35, heightFrac)) * dust * (0.6 + 0.4 * vfbm3(objPos * 6.0, 2));
        o = mix(o, vec3f(0.55, 0.5, 0.44), clamp(d, 0.0, 0.6));
    }
    if (damage > 0.0) {
        let n = vfbm3(objPos * 5.0 + vec3f(11.0), 3);
        let scorch = smoothstep(0.7 - damage * 0.25, 0.78 - damage * 0.25, n);
        o = mix(o, o * 0.25, scorch);
        let edge = smoothstep(0.66 - damage * 0.25, 0.7 - damage * 0.25, n) * (1.0 - scorch);
        o = o + vec3f(0.9, 0.35, 0.08) * edge * damage * 0.5;
    }
    return o;
}
