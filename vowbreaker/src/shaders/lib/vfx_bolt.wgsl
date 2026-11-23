// VFX bolts and beams.
//
//   bolt     lightning on a camera-facing ribbon (u across, v along). The main channel wanders by
//            midpoint-style noise, thick at the root and thin at the tip, with branches forking off
//            it; it re-strikes on twos (a new path every few frames) and flickers. p.x style
//            (0 palette lightning, 1 Black Spark: a black core with a red sheath and a bright rim),
//            p.y branchiness, p.z jaggedness, p.w width
//   arcs     electricity crawling over a sphere (a charge round a fist or a projectile)
//   beam     an energy beam (ribbon or cylinder along v): a white core, a palette sheath, rings
//            racing along it, a spiral wound round it, an opening flash at the root
//   column   a column of light from the sky (moonfall): descends from the top, pale and soft,
//            with motes rising in it and a brighter landing ring
//   pillar   a pillar of energy rising from the floor (cylinder): spiral bands, licks at its top,
//            a ring of glow where it meets the ground. q.y style (0 energy, 1 dark curse)

// the bolt's centre line offset at v (in units of the ribbon's half width)
fn vfxBoltPath(v: f32, strike: f32, seed: f32, jag: f32) -> f32 {
    var x = 0.0;
    var amp = 0.5;
    var freq = 3.0;
    for (var k = 0; k < 5; k++) {
        let n = valueNoise2(vec2f(v * freq, strike * 7.31 + seed * 13.0 + f32(k) * 3.3)) - 0.5;
        x = x + n * amp;
        amp = amp * mix(0.45, 0.65, jag);
        freq = freq * 2.1;
    }
    // pinned at the root, free at the tip
    return x * smoothstep(0.0, 0.15, v);
}

fn vfxBoltChannel(u: f32, v: f32, strike: f32, seed: f32, jag: f32, width: f32) -> f32 {
    let c = vfxBoltPath(v, strike, seed, jag) * 0.6;
    let w = width * mix(1.0, 0.35, v);
    let d = abs((u - 0.5) * 2.0 - c);
    return 1.0 - smoothstep(w * 0.4, w, d);
}

fn vfxBolt(i: VfxIn) -> VfxOut {
    let style = i32(i.p.x + 0.5);
    let branchy = clamp(i.p.y, 0.0, 1.0);
    let jag = clamp(i.p.z, 0.0, 1.0);
    let width = max(i.p.w, 0.04);
    // a new path every three frames at 12 fps (4 strikes a second)
    let strike = floor(i.st * 4.0);
    let grow = easeOutCubic(clamp(i.age * 8.0, 0.0, 1.0));
    if (i.uv.y > grow) {
        return vfxNone();
    }
    var core = vfxBoltChannel(i.uv.x, i.uv.y, strike, i.seed, jag, width);
    var glow = vfxBoltChannel(i.uv.x, i.uv.y, strike, i.seed, jag, width * 4.0) * 0.5;
    // branches: forks leave the main channel at a few points and run off sideways
    for (var b = 0; b < 3; b++) {
        let fb = f32(b);
        let h = hash12(vec2f(fb + strike * 3.0, i.seed));
        if (h > branchy) {
            continue;
        }
        let v0 = 0.2 + fb * 0.22 + h * 0.1;
        if (i.uv.y < v0) {
            continue;
        }
        let side = select(-1.0, 1.0, hash12(vec2f(fb, i.seed + strike)) > 0.5);
        let root = vfxBoltPath(v0, strike, i.seed, jag) * 0.6;
        let t = (i.uv.y - v0) / 0.3;
        if (t > 1.0) {
            continue;
        }
        let cx = root + side * t * 0.7 + (vfxBoltPath(i.uv.y * 1.7 + fb, strike + 9.0, i.seed, jag) * 0.4) * t;
        let w = width * 0.5 * (1.0 - t);
        let d = abs((i.uv.x - 0.5) * 2.0 - cx);
        core = max(core, 1.0 - smoothstep(w * 0.4, w, d));
        glow = max(glow, (1.0 - smoothstep(w * 1.5, w * 4.0, d)) * 0.4);
    }
    let flick = vfxFlicker(i.st, i.seed, 0.6);
    let fade = 1.0 - smoothstep(0.5, 1.0, i.age);
    if (style == 1) {
        // Black Spark: the channel is black, its sheath red, the outer glow a hot crimson
        let sheath = clamp(glow * 2.0, 0.0, 1.0);
        var rgb = mix(vec3f(1.0, 0.05, 0.12) * 3.0, vec3f(0.0), core);
        let a = max(core, sheath * 0.85) * flick * fade;
        return vfxOut(rgb, a);
    }
    let f = max(core, glow * 0.6) * flick;
    var o = vfxGlowRamp(f, i.edge, i.body, i.core, i.inten * 1.4, 0.04);
    o.a = o.a * fade;
    o.rgb = o.rgb * o.a;
    return o;
}

// electricity crawling over a sphere: thin bright filaments where two noise fields cross zero
fn vfxArcs(i: VfxIn) -> VfxOut {
    let strike = floor(i.st * 6.0);
    let p = i.local * 2.0 + vec3f(strike * 1.7, strike * 0.3, i.seed * 9.0);
    let a = fbm3(p, 3, 2.0, 0.5);
    let b = fbm3(p * 1.3 + vec3f(4.1, 2.2, 7.7), 3, 2.0, 0.5);
    let w = 0.06;
    // filaments: the zero set of one field, broken into strands where the other is positive
    let fil = (1.0 - smoothstep(0.0, w, abs(a))) * smoothstep(-0.05, 0.1, b);
    let rim = pow(i.fres, 2.0) * 0.4;
    let f = max(fil, rim) * vfxFlicker(i.st, i.seed, 0.5) * vfxLifeFade(i.age, 0.05, 0.3);
    var o = vfxGlowRamp(f, i.edge, i.body, i.core, i.inten * 1.5, 0.05);
    o.rgb = o.rgb * o.a;
    return o;
}

// an energy beam along v (ribbon: u across; cylinder: u around, use fres for the core)
fn vfxBeam(i: VfxIn) -> VfxOut {
    let across = select(abs(i.uv.x - 0.5) * 2.0, i.fres, i.q.y > 0.5);
    let open = easeOutCubic(clamp(i.age * 6.0, 0.0, 1.0));
    let close = 1.0 - smoothstep(0.7, 1.0, i.age);
    let width = open * close;
    let core = 1.0 - smoothstep(0.1 * width, 0.25 * width, across);
    let sheath = 1.0 - smoothstep(0.3 * width, 0.95 * width, across);
    let rings = smoothstep(0.75, 0.9, fract(i.uv.y * max(i.p.x, 4.0) - i.time * max(i.p.y, 1.0) * 3.0));
    let spiral = vfxSpiral(vec2f(i.uv.x, i.uv.y * 4.0), 1.0, 2.0, i.time * 2.0, 0.3);
    let noise = vfxRisingNoise(vec2f(i.uv.x * 2.0, i.uv.y), i.time, 3.0, vec2f(2.0, 6.0), i.seed);
    // the reach: the beam shoots out along v in the first frames
    let reach = step(i.uv.y, easeOutCubic(clamp(i.age * 10.0, 0.0, 1.0)));
    let rootFlash = (1.0 - smoothstep(0.0, 0.12, i.uv.y)) * (1.0 - smoothstep(0.0, 0.3, i.age)) * 1.5;
    let f = max(core, sheath * (0.45 + 0.3 * noise + 0.25 * max(rings, spiral) * 0.8)) * reach + rootFlash * sheath;
    var o = vfxGlowRamp(f, i.edge, i.body, i.core, i.inten, 0.03);
    o.rgb = o.rgb * o.a;
    return o;
}

// a column of light from the sky (cylinder, v 0 at the floor .. 1 high above)
fn vfxColumn(i: VfxIn) -> VfxOut {
    let descend = 1.0 - easeInCubic(clamp(i.age * 3.0, 0.0, 1.0));
    if (i.uv.y < descend) {
        return vfxNone();
    }
    let soft = pow(1.0 - i.fres, 1.5);
    let motes = vfxSpeckles(vec2f(i.uv.x * 6.0, i.uv.y * 8.0 - i.time * 0.8), 9.0, 0.18, i.st, i.seed);
    let streaks = smoothstep(0.6, 0.9, valueNoise2(vec2f(i.uv.x * 30.0, i.uv.y * 0.6 - i.time * 0.3)));
    let fade = 1.0 - smoothstep(0.65, 1.0, i.age);
    let edgeFade = smoothstep(descend, descend + 0.08, i.uv.y) * (1.0 - smoothstep(0.85, 1.0, i.uv.y));
    // light, not a solid: thin vertical shafts over a faint glow, densest at the axis
    let f = (soft * 0.35 + streaks * 0.55 * soft + motes * 0.9) * edgeFade * fade;
    var o = vfxRamp(f, i.body * 0.35, i.body * 1.1, i.core * 2.5, 0.04, 0.35, 0.7, 0.05);
    o.rgb = o.rgb * i.inten * o.a * 0.8;
    return o;
}

// a pillar of energy rising from the floor (cylinder)
fn vfxPillar(i: VfxIn) -> VfxOut {
    let style = i32(i.q.y + 0.5);
    let rise = easeOutCubic(clamp(i.age * 5.0, 0.0, 1.0));
    if (i.uv.y > rise) {
        return vfxNone();
    }
    let n = vfxCylNoise(i.uv.x, i.uv.y, 2.5, 3.0, i.st * 2.0 + i.seed * 7.0);
    let bands = vfxSpiral(i.uv, 1.5, 3.0, i.time * 1.5, 0.4);
    let top = 1.0 - smoothstep(0.65 * rise, rise, i.uv.y + (n - 0.5) * 0.3);
    let base = (1.0 - smoothstep(0.0, 0.15, i.uv.y)) * 0.8;
    let shell = mix(0.35, 1.0, i.fres);
    let fade = 1.0 - smoothstep(0.6, 1.0, i.age);
    let f = clamp((n * 0.7 + bands * 0.35) * shell * top + base, 0.0, 1.0) * fade;
    if (style == 1) {
        // the dark curse pillar: tar black, a red edge at every band
        let body = smoothstep(0.25, 0.3, f);
        let edge = smoothstep(0.25, 0.3, f) * (1.0 - smoothstep(0.32, 0.42, f));
        let rgb = mix(vec3f(0.015, 0.01, 0.02), i.edge * 2.0 * i.inten, edge);
        return vfxOut(rgb, body);
    }
    var o = vfxGlowRamp(f, i.edge, i.body, i.core, i.inten, 0.03);
    o.rgb = o.rgb * o.a;
    return o;
}
