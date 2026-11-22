// Domain core: what every domain world shares.
//
// A domain is a world painted round the fighters: the dome (domain.fragment) raymarches it behind
// them, the floor (domainFloor.fragment) is the ground they fight on. Each domain lives in its own
// file (domain_bell, domain_garden, domain_lake, domain_parade, domain_memory) and provides
//   a signed distance map            -> (distance, material id)
//   a surface per material           -> DomainSurface (albedo, emission, gloss, rim, ink)
//   a sky                            -> colour by direction
//   a look                           -> DomainLook (key light, shadow tint, fog, ink colour)
//   a floor                          -> the ground's colour (receives the fighters' shadows)
// domain_scenes dispatches on the domain id. The lighting here is the characters' own: banded cels
// with a coloured shadow, a rim of the key colour, ink outlines where the silhouette turns, then
// height fog and light shafts so far things sink into the domain's air.

struct DomainLook {
    keyDir: vec3f,
    keyCol: vec3f,
    shadowCol: vec3f,
    rimCol: vec3f,
    fogCol: vec3f,
    inkCol: vec3f,
    fogDensity: f32,
    fogHeight: f32,
    bands: f32,
    shafts: f32,
}

struct DomainSurface {
    albedo: vec3f,
    emissive: vec3f,
    gloss: f32,
    rim: f32,
    ink: f32,
    unlit: f32,
}

struct DomainMarch {
    hit: bool,
    t: f32,
    mat: f32,
    steps: i32,
    edge: f32,
}

fn domainSurface(albedo: vec3f) -> DomainSurface {
    var s: DomainSurface;
    s.albedo = albedo;
    s.emissive = vec3f(0.0);
    s.gloss = 0.0;
    s.rim = 1.0;
    s.ink = 1.0;
    s.unlit = 0.0;
    return s;
}

// --- marching ---------------------------------------------------------------------------------------------

// sphere tracing with a relaxation factor; tracks how close the ray passed to a surface without
// touching it, relative to the distance travelled (the closest-approach outline)
fn domainMarch(id: i32, ro: vec3f, rd: vec3f, t: f32, maxT: f32, maxSteps: i32) -> DomainMarch {
    var m: DomainMarch;
    m.hit = false;
    m.t = 0.0;
    m.mat = 0.0;
    m.steps = 0;
    m.edge = 1e3;
    var dist = 0.05;
    var lastD = 1e3;
    for (var i = 0; i < 96; i++) {
        if (i >= maxSteps) {
            break;
        }
        let p = ro + rd * dist;
        let r = domainMap(id, p, t);
        m.steps = i;
        if (r.x < 0.0015 * dist + 0.002) {
            m.hit = true;
            m.mat = r.y;
            break;
        }
        // closest approach while the ray is still moving away from a surface it passed
        if (r.x > lastD && lastD < 0.25 + dist * 0.004) {
            m.edge = min(m.edge, lastD / (0.06 + dist * 0.0035));
        }
        lastD = r.x;
        dist = dist + r.x * 0.92;
        if (dist > maxT) {
            break;
        }
    }
    m.t = dist;
    return m;
}

// tetrahedral normal (four map evaluations)
fn domainNormal(id: i32, p: vec3f, t: f32, eps: f32) -> vec3f {
    let k = vec2f(1.0, -1.0);
    return normalize(
        k.xyy * domainMap(id, p + k.xyy * eps, t).x +
        k.yyx * domainMap(id, p + k.yyx * eps, t).x +
        k.yxy * domainMap(id, p + k.yxy * eps, t).x +
        k.xxx * domainMap(id, p + k.xxx * eps, t).x);
}

// soft shadow toward the key light (penumbra estimate from the nearest miss)
fn domainSoftShadow(id: i32, p: vec3f, l: vec3f, t: f32, k: f32) -> f32 {
    var res = 1.0;
    var dist = 0.08;
    for (var i = 0; i < 14; i++) {
        let h = domainMap(id, p + l * dist, t).x;
        res = min(res, k * h / dist);
        if (res < 0.02 || dist > 40.0) {
            break;
        }
        dist = dist + clamp(h, 0.08, 3.0);
    }
    return clamp(res, 0.0, 1.0);
}

// ambient occlusion from five samples along the normal
fn domainAO(id: i32, p: vec3f, n: vec3f, t: f32) -> f32 {
    var occ = 0.0;
    var w = 1.0;
    for (var i = 1; i <= 3; i++) {
        let h = 0.2 * f32(i);
        let d = domainMap(id, p + n * h, t).x;
        occ = occ + (h - d) * w;
        w = w * 0.6;
    }
    return clamp(1.0 - occ * 1.8, 0.0, 1.0);
}

// --- the cel model ------------------------------------------------------------------------------------------

// banded toon light: shadow colour, a mid band, lit, a narrow terminator line, the rim
fn domainCel(s: DomainSurface, n: vec3f, v: vec3f, look: DomainLook, sh: f32, ao: f32) -> vec3f {
    let l = normalize(look.keyDir);
    let ndl = dot(n, l) * 0.5 + 0.5;
    let k = ndl * mix(0.35, 1.0, sh) * mix(0.75, 1.0, ao);
    let bands = max(look.bands, 2.0);
    let q = floor(k * bands + 0.5) / bands;
    let stepK = mix(q, k, 0.15);
    let shade = mix(s.albedo * look.shadowCol, s.albedo * look.keyCol, smoothstep(0.25, 0.75, stepK));
    // terminator: a thin darker line where light turns to shadow (the painter's edge)
    let term = (1.0 - smoothstep(0.0, 0.03, abs(k - 0.5))) * 0.15;
    var c = shade * (1.0 - term);
    // rim of the key colour on the shadow side
    let fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
    c = c + look.rimCol * fres * s.rim * (1.0 - smoothstep(0.4, 0.7, ndl) * 0.6) * 0.6;
    // glossy materials: a sharp stepped highlight
    if (s.gloss > 0.0) {
        let h = normalize(l + v);
        let spec = smoothstep(0.94, 0.96, dot(n, h));
        c = c + look.keyCol * spec * s.gloss * sh;
    }
    return mix(c, s.albedo, s.unlit) + s.emissive;
}

// --- air ---------------------------------------------------------------------------------------------------

// height fog: thicker low down, toward the domain's own air colour
fn domainFog(col: vec3f, dist: f32, ro: vec3f, rd: vec3f, look: DomainLook) -> vec3f {
    let h0 = max(ro.y, 0.0);
    let k = look.fogDensity;
    let fall = max(look.fogHeight, 0.01);
    let fy = rd.y;
    var amount: f32;
    if (abs(fy) < 1e-3) {
        amount = k * exp(-h0 / fall) * dist;
    } else {
        amount = k * exp(-h0 / fall) * (1.0 - exp(-dist * fy / fall)) * fall / fy;
    }
    let f = 1.0 - exp(-max(amount, 0.0));
    // the fog brightens toward the key light (in-scattering)
    let sun = pow(max(dot(rd, normalize(look.keyDir)), 0.0), 8.0);
    let fc = look.fogCol + look.keyCol * sun * 0.35;
    return mix(col, fc, clamp(f, 0.0, 1.0));
}

// light shafts: a cloud mask projected along the key light, sampled along the view ray
fn domainShafts(ro: vec3f, rd: vec3f, maxT: f32, look: DomainLook, t: f32) -> f32 {
    if (look.shafts <= 0.0) {
        return 0.0;
    }
    let l = normalize(look.keyDir);
    var acc = 0.0;
    let n = 12;
    for (var i = 0; i < n; i++) {
        let s = (f32(i) + 0.5) / f32(n) * min(maxT, 60.0);
        let p = ro + rd * s;
        // where the light ray from p crosses a cloud plane high above
        let up = (40.0 - p.y) / max(l.y, 0.1);
        let c = p + l * up;
        let gap = smoothstep(0.55, 0.75, vfbm2(c.xz * 0.025 + vec2f(t * 0.01, 0.0), 3));
        acc = acc + gap;
    }
    let toward = pow(max(dot(rd, l), 0.0), 2.0);
    return acc / f32(n) * look.shafts * (0.4 + 0.6 * toward);
}

// --- ink -----------------------------------------------------------------------------------------------------

// outlines: the closest-approach silhouette and creases where the normal turns fast on screen
fn domainInk(m: DomainMarch, n: vec3f) -> f32 {
    let sil = 1.0 - smoothstep(0.4, 1.0, m.edge);
    let crease = smoothstep(0.35, 0.9, length(fwidth(n)));
    return clamp(max(sil, crease), 0.0, 1.0);
}

// slow painterly variation of a base colour (hue and value drift across big surfaces)
fn domainPaint(c: vec3f, p: vec3f, amount: f32) -> vec3f {
    let n = vfbm2(p.xz * 0.08 + p.y * 0.05, 3);
    let n2 = vfbm2(p.xz * 0.3 + vec2f(7.1, 3.3), 2);
    return c * (1.0 + (n - 0.5) * amount + (n2 - 0.5) * amount * 0.5);
}

// --- the reveal ------------------------------------------------------------------------------------------------

// the domain spreads outward from the caster: (inside 0/1, burning front 0..1)
fn domainReveal(world: vec3f, center: vec3f, reveal: f32, radius: f32) -> vec2f {
    let d = length(world.xz - center.xz);
    let front = reveal * radius;
    let jag = (valueNoise2(vec2f(atan2(world.z - center.z, world.x - center.x) * 6.0, reveal * 4.0)) - 0.5) * 2.0;
    let edgeD = d - front - jag;
    let inside = select(step(edgeD, 0.0), 1.0, reveal >= 0.999);
    let edge = (1.0 - smoothstep(0.0, 2.5, abs(edgeD))) * step(reveal, 0.999);
    return vec2f(inside, edge);
}
