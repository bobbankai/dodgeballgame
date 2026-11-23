// ============================================================================================
// vb_lighting: stylized lighting terms. Everything here is built for cel shading: terms come back
// as coverage (0..1) that the materials step, ramp and tint, not as physically scaled radiance.
// Depends on vb_common, vb_color, vb_math.
// ============================================================================================

struct ToonLight {
    dir: vec3f,       // direction TO the light
    color: vec3f,     // linear colour times intensity
    shadow: f32,      // 0 = fully shadowed, 1 = lit (from the shadow map)
}

struct ToonSurface {
    albedo: vec3f,
    normal: vec3f,    // world space, unit
    view: vec3f,      // world space, unit, from the surface toward the eye
    ao: f32,          // painted/baked occlusion, 1 = open
    threshold: f32,   // where light turns to shadow (0..1 on the half-lambert scale)
    softness: f32,    // width of the terminator
    specular: f32,    // highlight strength
    gloss: f32,       // highlight size (higher = smaller)
    rim: f32,         // rim light strength
}

// --- diffuse shapes ----------------------------------------------------------------------------------

fn lambertTerm(n: vec3f, l: vec3f) -> f32 {
    return max(dot(n, l), 0.0);
}

fn halfLambert(n: vec3f, l: vec3f) -> f32 {
    return dot(n, l) * 0.5 + 0.5;
}

// wrapped diffuse: light bleeds `w` past the terminator (soft materials: skin, cloth)
fn wrapDiffuse(n: vec3f, l: vec3f, w: f32) -> f32 {
    return max((dot(n, l) + w) / (1.0 + w), 0.0);
}

// cel step on the half-lambert value, AO pushes the threshold so creases fall into shadow first
// (the "artist controls shadows per vertex" idea from Guilty Gear Xrd)
fn celStep(halfL: f32, threshold: f32, softness: f32, ao: f32, aoInfluence: f32) -> f32 {
    let t = threshold + (1.0 - ao) * aoInfluence;
    return smoothstep(t - softness, t + softness, halfL);
}

// two thresholds: lit / mid / shadow (for three-tone ramps)
fn celStep3(halfL: f32, t0: f32, t1: f32, softness: f32) -> vec2f {
    return vec2f(smoothstep(t0 - softness, t0 + softness, halfL), smoothstep(t1 - softness, t1 + softness, halfL));
}

// evaluate a three-colour ramp from two cel coverages
fn ramp3(c: vec2f, shadowCol: vec3f, midCol: vec3f, litCol: vec3f) -> vec3f {
    return mix(mix(shadowCol, midCol, c.x), litCol, c.y);
}

// the warm band along the terminator, where light grazes skin (fake subsurface)
fn terminatorBand(halfL: f32, threshold: f32, width: f32) -> f32 {
    return cubicPulse(threshold, width, halfL);
}

// cool shadow tint that keeps the shadow hue related to the base colour (not grey)
fn shadowTint(albedo: vec3f, tint: vec3f, saturationBoost: f32) -> vec3f {
    let s = adjustSaturation(albedo, 1.0 + saturationBoost);
    return s * tint;
}

// --- specular ------------------------------------------------------------------------------------------

fn blinnPhong(n: vec3f, l: vec3f, v: vec3f, power: f32) -> f32 {
    let h = normalize(l + v);
    return pow(max(dot(n, h), 0.0), power);
}

// a hard-edged highlight blob (anime "specular shape")
fn toonSpecular(n: vec3f, l: vec3f, v: vec3f, size: f32, softness: f32) -> f32 {
    let h = normalize(l + v);
    let nh = max(dot(n, h), 0.0);
    let t = 1.0 - size;
    return smoothstep(t - softness, t + softness, nh);
}

fn fresnelSchlick(cosTheta: f32, f0: f32) -> f32 {
    return f0 + (1.0 - f0) * pow5f(1.0 - clamp(cosTheta, 0.0, 1.0));
}

fn fresnelSchlick3(cosTheta: f32, f0: vec3f) -> vec3f {
    return f0 + (vec3f(1.0) - f0) * pow5f(1.0 - clamp(cosTheta, 0.0, 1.0));
}

// GGX pieces for the few glossy things (metal fittings, the bell, wet stone)
fn ggxD(nh: f32, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let d = nh * nh * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
}

fn smithG1(nx: f32, k: f32) -> f32 {
    return nx / (nx * (1.0 - k) + k);
}

fn smithGGX(nl: f32, nv: f32, roughness: f32) -> f32 {
    let k = sqr(roughness + 1.0) / 8.0;
    return smithG1(nl, k) * smithG1(nv, k);
}

fn ggxSpecular(n: vec3f, l: vec3f, v: vec3f, roughness: f32, f0: vec3f) -> vec3f {
    let h = normalize(l + v);
    let nl = max(dot(n, l), 1e-4);
    let nv = max(dot(n, v), 1e-4);
    let nh = max(dot(n, h), 0.0);
    let vh = max(dot(v, h), 0.0);
    let D = ggxD(nh, max(roughness, 0.04));
    let G = smithGGX(nl, nv, roughness);
    let F = fresnelSchlick3(vh, f0);
    return D * G * F / (4.0 * nl * nv) * nl;
}

// Kajiya-Kay strand highlight along tangent t (hair runs root to tip along t)
fn kajiyaKay(t: vec3f, l: vec3f, v: vec3f, shift: f32, n: vec3f, power: f32) -> f32 {
    let ts = normalize(t + n * shift);
    let h = normalize(l + v);
    let th = dot(ts, h);
    let sinTH = sqrt(max(1.0 - th * th, 0.0));
    let dirAtten = smoothstep(-1.0, 0.0, th);
    return dirAtten * pow(sinTH, power);
}

// anime hair "angel ring": a crisp band of highlight that sits where the hair faces the camera
// just above the head's equator; returned as coverage, broken into strands by `strandNoise`
fn angelRing(n: vec3f, v: vec3f, up: vec3f, height: f32, width: f32, strandNoise: f32) -> f32 {
    let nv = dot(n, v);
    let nu = dot(n, up);
    let band = cubicPulse(height, width, nu);
    let facing = smoothstep(0.15, 0.55, nv);
    let broken = smoothstep(0.35, 0.65, strandNoise + band * 0.4);
    return band * facing * broken;
}

// --- rim and fresnel ------------------------------------------------------------------------------------

fn fresnelRim(n: vec3f, v: vec3f, power: f32) -> f32 {
    return pow(1.0 - clamp(dot(n, v), 0.0, 1.0), power);
}

// rim light that only appears on the side facing away from the key light (back light look),
// stepped to a crisp band
fn toonRim(n: vec3f, v: vec3f, l: vec3f, width: f32, softness: f32, lightSide: f32) -> f32 {
    let f = 1.0 - clamp(dot(n, v), 0.0, 1.0);
    let side = mix(1.0, clamp(dot(n, l) * 0.5 + 0.5, 0.0, 1.0), lightSide);
    let t = 1.0 - width;
    return smoothstep(t - softness, t + softness, f) * side;
}

// rim from the view-space normal only (screen-space rim, stable as the camera orbits)
fn viewRim(viewNormal: vec3f, dirVS: vec2f, width: f32, softness: f32) -> f32 {
    let d = dot(normalize(viewNormal.xy + vec2f(1e-5)), normalize(dirVS)) * length(viewNormal.xy);
    let t = 1.0 - width;
    return smoothstep(t - softness, t + softness, d);
}

// --- ambient -----------------------------------------------------------------------------------------------

fn hemiAmbient(n: vec3f, sky: vec3f, ground: vec3f) -> vec3f {
    return mix(ground, sky, n.y * 0.5 + 0.5);
}

// L2 spherical harmonics irradiance (9 coefficients, already convolved)
fn shIrradiance(n: vec3f, c0: vec3f, c1: vec3f, c2: vec3f, c3: vec3f, c4: vec3f, c5: vec3f, c6: vec3f, c7: vec3f, c8: vec3f) -> vec3f {
    return c0 * 0.886227
        + c1 * (1.023328 * n.y) + c2 * (1.023328 * n.z) + c3 * (1.023328 * n.x)
        + c4 * (0.858086 * n.x * n.y) + c5 * (0.858086 * n.y * n.z)
        + c6 * (0.247708 * (3.0 * n.z * n.z - 1.0))
        + c7 * (0.858086 * n.x * n.z) + c8 * (0.429043 * (n.x * n.x - n.y * n.y));
}

// matcap lookup coordinate from the view-space normal
fn matcapUV(viewNormal: vec3f) -> vec2f {
    return viewNormal.xy * vec2f(0.5, -0.5) + 0.5;
}

// --- punctual lights --------------------------------------------------------------------------------------

// windowed inverse-square falloff (Karis): reaches exactly zero at `range`
fn lightFalloff(dist: f32, range: f32) -> f32 {
    let d2 = dist * dist;
    let r = dist / range;
    let win = sqr(clamp(1.0 - r * r * r * r, 0.0, 1.0));
    return win / max(d2, 0.01);
}

// a softer falloff for stylized glows (energy, lanterns): smooth, no hot centre
fn glowFalloff(dist: f32, range: f32) -> f32 {
    let x = clamp(1.0 - dist / range, 0.0, 1.0);
    return x * x * (3.0 - 2.0 * x);
}

fn spotCone(l: vec3f, spotDir: vec3f, cosOuter: f32, cosInner: f32) -> f32 {
    let c = dot(-l, normalize(spotDir));
    return smoothstep(cosOuter, cosInner, c);
}

// a stepped point light for toon surfaces: coverage bands rather than a gradient
fn toonPointLight(n: vec3f, p: vec3f, lightPos: vec3f, range: f32, bands: f32) -> f32 {
    let toL = lightPos - p;
    let d = length(toL);
    let l = toL / max(d, 1e-4);
    let att = glowFalloff(d, range);
    let ndl = halfLambert(n, l);
    let k = att * smoothstep(0.35, 0.6, ndl);
    return floor(k * bands + 0.5) / bands;
}

// --- skin ---------------------------------------------------------------------------------------------------

// pre-integrated-ish skin: scatter red into the shadow side near the terminator
fn skinScatter(halfL: f32, threshold: f32, scatterColor: vec3f, width: f32) -> vec3f {
    let b = smoothstep(threshold - width, threshold, halfL) * (1.0 - smoothstep(threshold, threshold + width * 0.6, halfL));
    return scatterColor * b;
}

// --- full toon evaluation for one directional light ---------------------------------------------------------------

fn evalToonDirectional(s: ToonSurface, light: ToonLight, shadowCol: vec3f, aoInfluence: f32) -> vec3f {
    let hl = halfLambert(s.normal, light.dir);
    let lit = celStep(hl, s.threshold, s.softness, s.ao, aoInfluence) * light.shadow;
    var col = mix(shadowCol, s.albedo * light.color, lit);
    let spec = toonSpecular(s.normal, light.dir, s.view, 1.0 / max(s.gloss, 1.0), 0.01) * lit * s.specular;
    col = col + light.color * spec;
    let rim = toonRim(s.normal, s.view, light.dir, 0.28, 0.03, 0.6) * s.rim;
    col = col + light.color * s.albedo * rim * 0.6;
    return col;
}
