// VFX shocks: what a heavy blow does to the air and the floor.
//
//   dome    an expanding shell of pressure (sphere / dome shape): a bright fresnel rim, bands
//           running out from the impact, the shell tearing open as it fades. p.x bands,
//           p.y style (0 energy, 1 dust air, 2 the bell's toll), p.z tear amount
//   ring    a shock ring racing across the floor (disc decal): the bright front, a dust lip
//           thrown up behind it, radial scoring, a faint fill. p.x ring width, p.y style
//           (0 energy, 1 dust, 2 water ripple), p.z inner fill
//   crater  the mark left by a landing technique (disc decal): crazed stone, fissures that glow
//           and cool from white through the palette to dull red, then soot
//   bell    Itsuki's spectral temple bell (dome shape reshaped into a bell in the vertex stage):
//           bronze-gold ghost with cast bands, a lotus band and nipples (chichi), toll ripples
//           running down its skirt, and the striking point lit where the beam hits

fn vfxShockDome(i: VfxIn) -> VfxOut {
    let style = i32(i.q.x + 0.5);
    let bands = max(i.p.x, 2.0);
    let expand = vfxExpand(i.age, 6.0);
    // bands run from the pole (impact) outward: v is 0 at the base, 1 at the top
    let front = fract((1.0 - i.uv.y) * bands - expand * bands * 0.6);
    let bandLine = 1.0 - smoothstep(0.0, 0.18, abs(front - 0.5) - 0.32);
    let rim = pow(i.fres, 4.0);
    let noise = vfxCylNoise(i.uv.x, i.uv.y, 2.5, 3.0, i.st * 0.6 + i.seed * 10.0);
    // tears: the shell opens up in noise holes as it fades
    let tear = vfxBurnAway(noise, smoothstep(0.25, 1.0, i.age) * clamp(i.p.z, 0.0, 1.0) + i.age * 0.25, 0.12);
    let fade = 1.0 - smoothstep(0.4, 1.0, i.age);
    switch style {
        case 1: {
            // dust in the air: a pale, cel-lit shell, thicker at the rim, eaten by noise
            let dens = (rim * 0.8 + bandLine * 0.25) * tear.x * fade;
            let c = vfxCel(i.n, vec3f(0.78, 0.74, 0.68), vec3f(0.5, 0.47, 0.45), vec3f(0.95, 0.92, 0.86), i.fres);
            return vfxOut(c, smoothstep(0.1, 0.35, dens) * 0.85);
        }
        case 2: {
            // the toll: gold rings of sound, engraved like the bell's own bands
            let ring = bandLine * (0.4 + 0.6 * rim);
            var o = vfxGlowRamp(ring * tear.x, i.edge, i.body, i.core, i.inten, 0.05);
            o.rgb = o.rgb + i.core * tear.y * 2.0 * i.inten;
            o.a = o.a * fade;
            o.rgb = o.rgb * o.a;
            return o;
        }
        default: {
            // a shell: bright at the silhouette, band lines faint across the face, clear between
            let f = (rim * 0.95 + bandLine * 0.22 * (1.0 - rim)) * tear.x;
            var o = vfxRamp(f, i.edge, i.body * 1.6, i.core * 3.0, 0.12, 0.5, 0.82, 0.05);
            o.a = o.a * mix(0.35, 1.0, smoothstep(0.12, 0.5, f));
            o.rgb = o.rgb * i.inten * vfxPunch(i.age);
            o.rgb = o.rgb + i.core * tear.y * 1.5 * i.inten;
            o.a = o.a * fade;
            o.rgb = o.rgb * o.a;
            return o;
        }
    }
}

fn vfxGroundRing(i: VfxIn) -> VfxOut {
    let style = i32(i.q.x + 0.5);
    let p = (i.uv - 0.5) * 2.0;
    let r = length(p);
    let a = atan2(p.y, p.x) / TAU + 0.5;
    let front = vfxExpand(i.age, 5.0) * 0.92;
    let width = max(i.p.x, 0.02) * (1.0 - i.age * 0.5);
    let wobble = (valueNoise2(vec2f(a * 24.0, i.st * 2.0 + i.seed * 9.0)) - 0.5) * 0.03;
    let d = r - front - wobble;
    let fade = 1.0 - smoothstep(0.5, 1.0, i.age);
    if (r > 1.0) {
        return vfxNone();
    }
    switch style {
        case 1: {
            // dust: a lumpy lip of grit behind the front, scoring lines raked outward
            let lump = vfxSpeckles(vec2f(a * 9.0, r * 2.0), 6.0, 0.55, 0.0, i.seed);
            let lip = (1.0 - smoothstep(0.0, width * 2.5, abs(d + width))) * (0.6 + 0.4 * lump);
            let score = step(0.8, valueNoise2(vec2f(a * 90.0, i.seed))) * smoothstep(front * 0.3, front, r) * (1.0 - smoothstep(front - 0.02, front, r)) * 0.4;
            let dens = max(lip, score) * fade;
            let c = mix(vec3f(0.52, 0.48, 0.44), vec3f(0.78, 0.74, 0.68), lump);
            return vfxOut(c, smoothstep(0.15, 0.4, dens));
        }
        case 2: {
            // water: concentric ripples, a bright crest, foam beads
            let rings = 0.5 + 0.5 * cos((r - front) * 70.0);
            let crest = 1.0 - smoothstep(0.0, width, abs(d));
            let inner = (1.0 - smoothstep(0.0, front, r)) * rings * 0.35;
            let foam = vfxSpeckles(vec2f(a * 14.0, r * 3.0), 5.0, 0.3, i.st, i.seed) * crest;
            let c = mix(i.body * 0.6 + vec3f(0.15, 0.2, 0.28), vec3f(0.95, 0.98, 1.0), max(crest, foam));
            return vfxOut(c, (max(crest * 0.8, inner) + foam * 0.5) * fade);
        }
        default: {
            let band = 1.0 - smoothstep(0.0, width, abs(d));
            let behind = (1.0 - smoothstep(0.0, front, r)) * clamp(i.p.z, 0.0, 1.0);
            let rays = step(0.7, valueNoise2(vec2f(a * 60.0, i.seed * 3.0))) * smoothstep(0.0, front, r) * step(r, front) * 0.5;
            let f = max(band, max(behind * 0.25, rays * (1.0 - i.age)));
            var o = vfxGlowRamp(f, i.edge, i.body, i.core, i.inten * vfxPunch(i.age), 0.04);
            o.a = o.a * fade;
            o.rgb = o.rgb * o.a;
            return o;
        }
    }
}

// --- the crater ----------------------------------------------------------------------------------------------

fn vfxCraterField(p: vec2f, seed: f32) -> vec3f {
    // returns (crack mask, crack core, crater mask)
    let r = length(p);
    let a = atan2(p.y, p.x);
    var mask = 0.0;
    var core = 0.0;
    let n = 7.0 + floor(hash11(seed) * 4.0);
    for (var k = 0.0; k < 11.0; k = k + 1.0) {
        if (k >= n) {
            break;
        }
        let h = hash12(vec2f(k, seed));
        let ang = (k + 0.5 + (h - 0.5) * 0.6) / n * TAU;
        let len = 0.55 + 0.4 * hash12(vec2f(k + 7.0, seed));
        let dir = vec2f(cos(ang), sin(ang));
        let along = dot(p, dir);
        let side = dot(p, vec2f(-dir.y, dir.x));
        let wander = (valueNoise2(vec2f(along * 6.0, k + seed)) - 0.5) * 0.12 * along;
        let t = clamp(along / len, 0.0, 1.0);
        let w = mix(0.035, 0.004, t);
        let inside = step(0.0, along) * step(along, len);
        let m = (1.0 - smoothstep(w * 0.5, w, abs(side - wander))) * inside;
        mask = max(mask, m);
        core = max(core, m * (1.0 - t));
    }
    let crater = 1.0 - smoothstep(0.18, 0.24, r + (valueNoise2(p * 8.0 + seed) - 0.5) * 0.05);
    let craze = crackle2(p * 9.0 + seed, 0.05) * crater;
    return vec3f(max(mask, craze), max(core, craze * 0.8), crater);
}

fn vfxCrater(i: VfxIn) -> VfxOut {
    let p = (i.uv - 0.5) * 2.0;
    if (length(p) > 1.0) {
        return vfxNone();
    }
    let f = vfxCraterField(p, floor(i.seed * 97.0));
    // heat: white -> palette core -> body -> dull red -> soot over the effect's life
    let heat = 1.0 - i.age;
    var glow = mix(vec3f(0.6, 0.08, 0.02), i.body * 2.0, smoothstep(0.25, 0.6, heat));
    glow = mix(glow, i.core * 4.0, smoothstep(0.75, 0.95, heat));
    let soot = vec3f(0.05, 0.045, 0.05);
    let scorch = (1.0 - smoothstep(0.1, 0.75, length(p))) * (0.55 + 0.45 * valueNoise2(p * 5.0 + i.seed));
    var rgb = soot;
    var a = max(scorch * 0.55, f.x * 0.9) * (1.0 - smoothstep(0.85, 1.0, i.age));
    // glowing cracks: emissive values over a dark base (alpha blended, so they need to be bright)
    rgb = mix(rgb, glow, f.y * smoothstep(0.05, 0.3, heat));
    // the raised lip of the crater catches light
    let lip = smoothstep(0.17, 0.2, length(p)) * (1.0 - smoothstep(0.2, 0.26, length(p)));
    rgb = mix(rgb, vec3f(0.35, 0.33, 0.32), lip * 0.6);
    a = max(a, lip * 0.5 * (1.0 - i.age));
    return vfxOut(rgb, a);
}

// --- the bell -------------------------------------------------------------------------------------------------

// the bell's silhouette: radius at height v (0 lip .. 1 crown), for the vertex stage
fn vfxBellProfile(v: f32) -> f32 {
    let skirt = 1.0 - smoothstep(0.0, 0.18, v) * 0.18;
    let body = mix(1.0, 0.72, smoothstep(0.1, 0.85, v));
    let crown = 1.0 - smoothstep(0.85, 1.0, v) * 0.75;
    return skirt * body * crown;
}

fn vfxBell(i: VfxIn) -> VfxOut {
    let v = i.uv.y;
    let u = i.uv.x;
    // cast horizontal bands, the lotus band near the lip, the field of nipples (chichi) above
    let band1 = 1.0 - smoothstep(0.0, 0.012, abs(v - 0.2));
    let band2 = 1.0 - smoothstep(0.0, 0.01, abs(v - 0.62));
    let band3 = 1.0 - smoothstep(0.0, 0.01, abs(v - 0.82));
    let vertical = 1.0 - smoothstep(0.0, 0.01, abs(fract(u * 4.0) - 0.5) - 0.48);
    let lotus = step(0.06, v) * step(v, 0.18) * (0.5 + 0.5 * cos(u * TAU * 16.0)) * smoothstep(0.06, 0.12, v);
    let cell = vec2f(fract(u * 24.0), fract((v - 0.64) * 30.0));
    let nip = step(0.64, v) * step(v, 0.8) * (1.0 - smoothstep(0.18, 0.28, length(cell - 0.5)));
    let engraving = max(max(band1, band2), max(band3, vertical * step(0.2, v) * step(v, 0.82)));
    // toll ripples run down the skirt from the striking point
    let ripple = 0.5 + 0.5 * sin((v * 18.0 + i.time * 9.0));
    let rippleBand = smoothstep(0.7, 1.0, ripple) * (1.0 - v) * clamp(i.p.x, 0.0, 1.0);
    // ghost body: fresnel rim + engraving, faint face-on
    let rim = pow(i.fres, 1.8);
    let ghost = 0.06 + rim * 0.75;
    let f = clamp(ghost + engraving * 0.7 + nip * 0.55 + lotus * 0.35 + rippleBand * 0.45, 0.0, 1.2);
    // the bell forms from the crown down at birth and dissolves into sparks at the end
    let form = smoothstep(1.0 - easeOutCubic(clamp(i.age * 5.0, 0.0, 1.0)) * 1.1, 1.05 - easeOutCubic(clamp(i.age * 5.0, 0.0, 1.0)) * 1.1 + 0.1, v);
    let n = vfxCylNoise(u, v, 3.0, 4.0, i.seed * 5.0);
    let burn = vfxBurnAway(n, smoothstep(0.7, 1.0, i.age), 0.1);
    // a ghost, not a lamp: modest values (the bloom would flood the frame from a bell this size),
    // and face-on it is nearly clear so the fighters inside stay readable
    var o = vfxRamp(f * form * burn.x, i.edge * 0.5, i.body * 0.9, i.core * 1.6, 0.12, 0.42, 0.8, 0.04);
    o.a = o.a * mix(0.35, 1.0, smoothstep(0.3, 0.9, i.fres + engraving * 0.6));
    o.rgb = o.rgb * i.inten + i.core * burn.y * 1.5 * i.inten;
    // the striking point flares where the beam meets the bell (p.y = strike flash)
    let strike = (1.0 - smoothstep(0.0, 0.12, length(vec2f((fract(u + 0.25) - 0.5) * 3.0, v - 0.35)))) * clamp(i.p.y, 0.0, 1.0);
    o.rgb = o.rgb + i.core * strike * 3.0;
    o.a = max(o.a, strike);
    o.rgb = o.rgb * o.a;
    return o;
}
