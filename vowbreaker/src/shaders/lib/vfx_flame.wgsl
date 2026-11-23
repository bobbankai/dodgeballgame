// VFX flame: anime fire, drawn the way effects animators draw it, not simulated.
//
// Fire is a stack of tongues: a noise field rising up a cylinder is cut by a threshold that climbs
// with height, so the column breaks into licks at the top and stays solid at the base. The cut field
// is posterised into three bands (core, body, edge), each band boundary carries a thin darker line,
// and the whole thing re-seeds on twos. Separate tongues detach and float off as they rise.
//
//   flame   a fire column (cylinder, tapered in the vertex stage). p.x style (0 palette fire,
//           1 cursed black fire: black body, coloured rim, alpha blended), p.y tongue scale,
//           p.z rise speed, p.w how ragged the top is
//   aura    a body-sized shell of energy round a fighter (sphere scaled to a capsule): licks run
//           up the silhouette, strongest at the rim, nearly invisible face-on, so the fighter
//           stays readable inside it. p.x intensity of the licks, p.y rise speed
//   firenado a fire tornado (cylinder, cone profile in the vertex stage): flame bands wound in a
//           spiral, embers flung off the rim

// the shared flame field on a cylinder: (around 0..1, up 0..1) -> 0..1 heat
fn vfxFlameField(uv: vec2f, time: f32, seed: f32, scale: f32, speed: f32, ragged: f32) -> f32 {
    let n = vfxCylNoise(uv.x, uv.y * scale, 2.2 * scale, 1.6, time * speed + seed * 13.0);
    let n2 = vfxCylNoise(uv.x + 0.37, uv.y * scale * 2.1, 4.0 * scale, 2.4, time * speed * 1.6 + seed * 7.0);
    let field = n * 0.7 + n2 * 0.3;
    // the cut climbs with height: solid base, broken tongues at the top
    let cut = mix(0.15, 0.85, pow(uv.y, mix(1.6, 0.8, ragged)));
    return clamp((field - cut) / 0.35 + (1.0 - uv.y) * 0.25, 0.0, 1.0);
}

fn vfxFlame(i: VfxIn) -> VfxOut {
    let style = i32(i.p.x + 0.5);
    let scale = max(i.p.y, 0.5);
    let speed = max(i.p.z, 0.5);
    let st = i.st;
    var f = vfxFlameField(i.uv, st, i.seed, scale, speed, clamp(i.p.w, 0.0, 1.0));
    // facing: flames are thinner seen face-on (the column is a shell)
    f = f * mix(0.75, 1.0, i.fres);
    // ignite and die: the column rises from the floor, then burns out from the top down
    let rise = easeOutCubic(clamp(i.age * 4.0, 0.0, 1.0));
    let die = smoothstep(0.6, 1.0, i.age);
    f = f * step(i.uv.y, rise) * (1.0 - smoothstep(1.0 - die * 1.2, 1.05 - die * 1.2 + 0.1, i.uv.y));
    let embers = vfxSpeckles(vec2f(i.uv.x * 6.0, i.uv.y * 3.0 - st * speed * 0.8), 8.0, 0.22, st, i.seed) * smoothstep(0.4, 0.9, i.uv.y) * (1.0 - die);
    if (style == 1) {
        // cursed black fire: an ink-black body, a palette rim at every band edge, alpha blended
        let body = smoothstep(0.12, 0.16, f);
        let rimBand = smoothstep(0.12, 0.16, f) * (1.0 - smoothstep(0.2, 0.3, f));
        let inner = smoothstep(0.62, 0.66, f) * (1.0 - smoothstep(0.7, 0.8, f));
        var rgb = vec3f(0.01, 0.005, 0.015);
        rgb = mix(rgb, i.edge * 2.5 * i.inten, rimBand);
        rgb = mix(rgb, i.body * 1.2 * i.inten, inner * 0.6);
        rgb = rgb + i.edge * embers * 4.0;
        return vfxOut(rgb, max(body, embers));
    }
    // fire is mostly body: a thin edge band, a broad body, a hot core low in the column
    var o = vfxRamp(f * 0.85, mix(i.edge, i.body, 0.55), i.body * 1.8, i.core * 3.2, 0.1, 0.24, 0.72, 0.025);
    o.rgb = o.rgb * i.inten;
    // the darker line between bands (hand-drawn fire has these)
    let l1 = vfxInkLine(f, 0.45, 1.0);
    o.rgb = mix(o.rgb, i.edge * 0.8 * i.inten, l1 * 0.5);
    o.rgb = o.rgb + i.core * embers * 3.0 * i.inten;
    o.a = max(o.a, embers);
    o.rgb = o.rgb * o.a;
    return o;
}

fn vfxAura(i: VfxIn) -> VfxOut {
    let amount = max(i.p.x, 0.0);
    let speed = max(i.p.y, 0.5);
    // licks rise round the silhouette; v is 0 at the feet, 1 above the head
    let n = vfxCylNoise(i.uv.x, i.uv.y, 3.0, 2.2, i.st * speed + i.seed * 9.0);
    let n2 = vfxCylNoise(i.uv.x + 0.5, i.uv.y, 6.0, 4.0, i.st * speed * 1.7);
    let rim = smoothstep(0.25, 0.9, i.fres);
    let rise = 1.0 - smoothstep(0.6, 1.0, i.uv.y);
    var f = (n * 0.8 + n2 * 0.4 - 0.3) * 2.6 * rim + rim * 0.3;
    f = f * mix(0.4, 1.0, rise) * amount;
    // tongues that detach above the head
    let top = smoothstep(0.75, 1.0, i.uv.y) * step(0.62, n2) * rim * amount;
    f = max(f, top);
    let life = vfxLifeFade(i.age, 0.08, 0.25);
    var o = vfxGlowRamp(f * life, i.edge, i.body, i.core, i.inten, 0.03);
    o.rgb = o.rgb * o.a;
    return o;
}

fn vfxFirenado(i: VfxIn) -> VfxOut {
    let twist = 2.5;
    let w = vec2f(fract(i.uv.x + i.uv.y * twist - i.time * 0.6), i.uv.y);
    let n = vfxCylNoise(w.x, w.y, 2.5, 3.0, i.st * 1.5 + i.seed * 3.0);
    let bands = vfxSpiral(i.uv, twist, 3.0, i.time * 1.2, 0.45);
    var f = clamp((n - 0.35) * 2.0 + bands * 0.4, 0.0, 1.0) * (0.5 + 0.5 * i.fres);
    f = f * (1.0 - smoothstep(0.75, 1.0, i.uv.y)) * smoothstep(0.0, 0.08, i.uv.y);
    f = f * vfxLifeFade(i.age, 0.12, 0.3);
    let embers = vfxSpeckles(vec2f(w.x * 8.0, w.y * 4.0), 7.0, 0.25, i.st, i.seed) * i.fres;
    var o = vfxGlowRamp(f, i.edge, i.body, i.core, i.inten, 0.03);
    o.rgb = o.rgb + i.core * embers * 3.0 * i.inten;
    o.a = max(o.a, embers * (1.0 - i.age));
    o.rgb = o.rgb * o.a;
    return o;
}
