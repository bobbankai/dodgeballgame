// VFX arcane: circles, gates, gravity and veils.
//
//   seal     a sorcery circle on the floor (disc decal), different for every palette: concentric
//            rings, a band of glyphs turning against the outer ring, tick marks, and an inner
//            figure (a bell for Itsuki, a crane for Sayo and Kōta, a crescent moon for Mikami, a
//            lotus for Sōjin, an eight-point star for Ryōga, an eye for the curses). It draws itself
//            on by angle, pulses while active and burns out from the centre. p.x palette id,
//            p.y draw-on speed, p.z spin
//   portal   a gate (quad): a vortex of the palette wound round an abyss with stars in it, a rune
//            ring round the mouth; it irises open and shut. p.x arms, p.y abyss size
//   gravity  a gravity well (sphere): a black core that swallows light, a bright lensed rim
//            (the Einstein ring), bands of accretion turning round it. alpha blended
//   veil     the curtain that falls before a domain (dome): black ink running down from the
//            crown with a dripping front, faint stars and seams of the palette inside the black

fn vfxSealFigure(p: vec2f, id: i32, t: f32) -> f32 {
    switch id {
        case 0: {
            // the bell
            return sdBellShape(p * vec2f(1.0, -1.0) + vec2f(0.0, 0.05), 0.2, 0.42);
        }
        case 1, 6: {
            // a crane
            return sdCraneShape(rotate2(p, t * 0.2), 0.42);
        }
        case 2: {
            // a crescent moon over still water
            let moon = sdMoon(p + vec2f(0.0, -0.05), 0.12, 0.28, 0.24);
            let water = abs(p.y + 0.22) - 0.004;
            return min(moon, max(water, abs(p.x) - 0.3));
        }
        case 3: {
            // a lotus: petals in polar repeat (Sōjin)
            let rep = opPolarRepeat(p, 8.0);
            return sdVesica(rep.xy - vec2f(0.2, 0.0), 0.22, 0.12);
        }
        case 4: {
            // an eight-point star (Ryōga)
            return sdStar(rotate2(p, t * 0.3), 0.38, 8.0, 3.2);
        }
        default: {
            // an eye
            let lid = sdVesica(p.yx, 0.5, 0.3);
            let pupil = length(p) - 0.08;
            return min(abs(lid) - 0.012, pupil);
        }
    }
}

fn vfxSeal(i: VfxIn) -> VfxOut {
    let p = (i.uv - 0.5) * 2.0;
    let r = length(p);
    if (r > 1.0) {
        return vfxNone();
    }
    let id = i32(i.p.x + 0.5);
    let ang = atan2(p.y, p.x);
    let a01 = ang / TAU + 0.5;
    let draw = clamp(i.age * max(i.p.y, 1.0) * 4.0, 0.0, 1.0);
    let spin = i.time * i.p.z;
    let px = i.px * 2.0;
    // rings
    var d = 1e3;
    d = min(d, abs(r - 0.96) - 0.012);
    d = min(d, abs(r - 0.9) - 0.005);
    d = min(d, abs(r - 0.68) - 0.008);
    d = min(d, abs(r - 0.62) - 0.004);
    // ticks between the outer rings
    let tick = abs(fract((a01 + spin * 0.02) * 72.0) - 0.5);
    let ticks = select(1e3, tick / 72.0 * TAU * r - 0.002, r > 0.9 && r < 0.96);
    d = min(d, ticks);
    // a band of glyphs turning against the outer ring
    let ga = fract(a01 - spin * 0.05) * 16.0;
    let gp = vec2f((fract(ga) - 0.5) * 1.1, (r - 0.79) * 9.0);
    let glyph = select(1e3, sdGlyph(gp, floor(ga) + f32(id) * 31.0) / 9.0, abs(r - 0.79) < 0.1);
    d = min(d, glyph);
    // the inner figure, slowly turning
    let fig = vfxSealFigure(rotate2(p, -spin * 0.1) / 1.0, id, i.time);
    d = min(d, abs(fig) - 0.006);
    // spokes joining the inner ring to the figure
    let spokes = opPolarRepeat(rotate2(p, spin * 0.03), select(6.0, 8.0, id == 4));
    d = min(d, select(1e3, abs(spokes.y) - 0.004, spokes.x > 0.4 && spokes.x < 0.62));
    // drawn on by angle
    let drawn = step(fract(a01 + 0.25), draw);
    let line = sdFill(d, px) * drawn;
    // burn out from the centre at the end
    let burn = smoothstep(0.7, 1.0, i.age);
    let out = 1.0 - smoothstep(burn * 1.1 - 0.1, burn * 1.1, 1.0 - r);
    let pulse = 0.75 + 0.25 * sin(i.time * 6.0);
    let fill = (1.0 - smoothstep(0.0, 0.96, r)) * 0.08 * draw;
    let f = clamp(line * pulse + fill, 0.0, 1.0) * (1.0 - burn * (1.0 - out));
    var o = vfxGlowRamp(f, i.edge, i.body, i.core, i.inten, 0.06);
    o.a = o.a * (1.0 - smoothstep(0.85, 1.0, i.age));
    o.rgb = o.rgb * o.a;
    return o;
}

fn vfxPortal(i: VfxIn) -> VfxOut {
    let p = (i.uv - 0.5) * 2.0;
    let r = length(p);
    let open = easeOutBack(clamp(i.age * 4.0, 0.0, 1.0)) * (1.0 - easeInCubic(smoothstep(0.75, 1.0, i.age)));
    let mouth = 0.85 * open;
    if (r > mouth + 0.15) {
        return vfxNone();
    }
    let arms = max(i.p.x, 3.0);
    let ang = atan2(p.y, p.x);
    // the vortex: spiral arms wound tighter toward the abyss
    let swirl = sin(ang * arms + log(max(r, 1e-3)) * 6.0 + i.time * 4.0);
    let vort = smoothstep(0.1, 0.9, swirl * 0.5 + 0.5) * smoothstep(mouth, mouth * 0.5, r);
    let abyss = 1.0 - smoothstep(i.p.y * mouth * 0.8, i.p.y * mouth, r);
    // stars in the abyss
    let stars = vfxSpeckles(rotate2(p, i.time * 0.2) * 3.0 + 7.0, 10.0, 0.12, i.st, i.seed) * abyss;
    // rune ring round the mouth
    let ringD = abs(r - mouth) - 0.01;
    let ga = (ang / TAU + 0.5 + i.time * 0.05) * 20.0;
    let gl = sdGlyph(vec2f((fract(ga) - 0.5), (r - mouth - 0.07) * 8.0), floor(ga) + i.seed * 9.0) / 8.0;
    let runes = sdFill(min(ringD, select(1e3, gl, abs(r - mouth - 0.07) < 0.06)), i.px * 2.0);
    var rgb = mix(vfxDark(i.body), i.body * 1.5 * i.inten, vort);
    rgb = mix(rgb, vec3f(0.0), abyss);
    rgb = rgb + i.core * stars * 3.0;
    rgb = mix(rgb, i.core * 3.0 * i.inten, runes);
    let a = max(smoothstep(mouth + 0.02, mouth - 0.02, r), runes);
    return vfxOut(rgb, a);
}

fn vfxGravity(i: VfxIn) -> VfxOut {
    let core = 1.0 - i.fres;
    // the Einstein ring: a thin bright band just inside the silhouette
    let ring = 1.0 - smoothstep(0.0, 0.08, abs(i.fres - 0.82));
    // accretion bands turning round it
    let u = i.uv.x + i.time * 0.3;
    let bands = smoothstep(0.7, 0.95, sin((u + i.uv.y * 0.3) * TAU * 6.0) * 0.5 + 0.5) * smoothstep(0.5, 0.9, i.fres);
    let grow = easeOutBack(clamp(i.age * 4.0, 0.0, 1.0)) * (1.0 - smoothstep(0.8, 1.0, i.age));
    var rgb = vec3f(0.0);
    rgb = rgb + i.edge * 2.5 * bands * i.inten;
    rgb = rgb + i.core * 4.0 * ring * i.inten;
    let a = max(smoothstep(0.1, 0.4, core), max(ring, bands)) * grow;
    return vfxOut(rgb, a);
}

fn vfxVeil(i: VfxIn) -> VfxOut {
    // v is 0 at the base, 1 at the crown: the ink runs down from the crown
    let run = easeInOutCubic(clamp(i.age * 1.6, 0.0, 1.0));
    let drips = (valueNoise2(vec2f(i.uv.x * 40.0, i.seed * 3.0)) - 0.5) * 0.12 + (valueNoise2(vec2f(i.uv.x * 130.0, i.seed)) - 0.5) * 0.05;
    let front = 1.0 - run * 1.15 + drips;
    let cov = smoothstep(front - 0.01, front + 0.01, i.uv.y);
    if (cov <= 0.0) {
        return vfxNone();
    }
    var rgb = vec3f(0.012, 0.01, 0.018);
    // the wet front catches a little light
    let wet = 1.0 - smoothstep(0.0, 0.04, i.uv.y - front);
    rgb = rgb + vec3f(0.25, 0.22, 0.28) * wet * 0.4;
    // seams of the palette and faint stars in the black
    let seam = (1.0 - smoothstep(0.0, 0.01, abs(fract(i.uv.x * 12.0) - 0.5) - 0.49)) * 0.4;
    let stars = vfxSpeckles(i.uv * vec2f(20.0, 10.0), 3.0, 0.08, i.st, i.seed) * 0.6;
    rgb = rgb + i.body * (seam * 0.6) * i.inten + vec3f(0.8, 0.85, 1.0) * stars;
    let lift = 1.0 - smoothstep(0.88, 1.0, i.age);
    return vfxOut(rgb, cov * mix(0.75, 0.97, i.fres) * lift);
}
