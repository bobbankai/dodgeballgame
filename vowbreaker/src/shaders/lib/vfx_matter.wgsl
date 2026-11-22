// VFX matter: effects made of stuff rather than light. Alpha blended, lit as two-tone cels.
//
//   smoke     a puff (sphere, displaced into lumps in the vertex stage): two-tone cel shading,
//             a pale rim, eaten away from its thin parts as it thins out, with a darker edge
//             where it erodes. p.x darkness (0 dust .. 1 soot), p.y tint by palette
//   ink       a sumi ink splash (disc decal on the floor or a quad in the air): a central blot
//             with a noise-warped edge, splatter spikes thrown radially, satellite droplets, the
//             wet sheen; it dries to a grey wash as it ages. p.x colour (0 black, 1 palette),
//             p.y spike count, p.z droplet amount
//   paper     a storm of paper slips round a cylinder: each slip spins on its own axis (its width
//             narrows as it turns edge-on), carries a brushed glyph and, for talismans, a red
//             border. p.x density, p.y spin speed, p.z talisman (0 plain, 1 red border)
//   splash    a water crown (cylinder flared in the vertex stage): clear water, white foam at the
//             rim, spikes of water at the crown tips, droplets
//   tendril   a curse tendril (camera-facing ribbon): a dark wavering strand with a red edge and
//             eyes opening along it (the Mudhand, the acolytes' curses)
//   crane     the paper crane's trail (ribbon): folded facets alternating light and shade,
//             crease lines, the trail unfolding behind the crane and flattening as it fades

fn vfxSmoke(i: VfxIn) -> VfxOut {
    let dark = clamp(i.p.x, 0.0, 1.0);
    let lit = mix(vec3f(0.86, 0.83, 0.78), vec3f(0.3, 0.28, 0.3), dark);
    let shade = mix(vec3f(0.58, 0.56, 0.58), vec3f(0.1, 0.09, 0.11), dark);
    var tint = mix(vec3f(1.0), i.body, clamp(i.p.y, 0.0, 1.0) * 0.6);
    let c = vfxCel(i.n, lit * tint, shade * tint, lit * 1.1, i.fres);
    // erosion: the puff thins from its silhouette inwards with age (noise in object space)
    let n = fbm3(i.local * 2.5 + vec3f(i.seed * 10.0, i.st * 0.3, 0.0), 4, 2.0, 0.5) * 0.5 + 0.5;
    let thick = (1.0 - i.fres * 0.7) * 0.6 + n * 0.5;
    let t = smoothstep(0.2, 1.0, i.age);
    let cut = vfxBurnAway(thick, t, 0.12);
    let rgb = mix(c, shade * 0.6, cut.y * 0.7);
    return vfxOut(rgb, cut.x * vfxLifeFade(i.age, 0.05, 0.05));
}

// the ink blot's distance field (negative inside), radius r, seed s
fn vfxInkBlot(p: vec2f, r: f32, spikes: f32, s: f32) -> f32 {
    let a = atan2(p.y, p.x);
    let rr = length(p);
    let warp = (fbm2(vec2f(a * 2.0, s) + p * 3.0, 4, 2.0, 0.5)) * 0.18 * r;
    var d = rr - r - warp;
    // splatter spikes: thin radial streaks ending in droplets
    let rep = opPolarRepeat(p, spikes);
    let h = hash12(vec2f(rep.z, s));
    let len = r * (1.3 + h * 1.2);
    let spike = sdTaperedSegment2(rep.xy, vec2f(r * 0.6, 0.0), vec2f(len, 0.0), r * 0.12 * (0.4 + h), r * 0.015);
    let droplet = length(rep.xy - vec2f(len + r * 0.12, 0.0)) - r * 0.07 * (0.5 + h);
    d = min(d, select(1e3, min(spike, droplet), h > 0.35));
    return d;
}

fn vfxInk(i: VfxIn) -> VfxOut {
    let p = (i.uv - 0.5) * 2.0;
    let grow = easeOutBack(clamp(i.age * 6.0, 0.0, 1.0));
    let r = 0.32 * grow;
    let spikes = max(i.p.y, 7.0);
    var d = vfxInkBlot(p, r, spikes, floor(i.seed * 89.0));
    // satellite droplets scattered further out
    let cell = worley2(p * 6.0 + i.seed * 5.0, 1.0);
    if (i.p.z > 0.0 && cell.id.x > 0.7 && length(p) > r * 1.2 && length(p) < 0.95 * grow) {
        d = min(d, (cell.f1 - 0.06 * cell.id.y) / 6.0);
    }
    let inside = sdFill(d, i.px * 2.0);
    if (inside <= 0.0) {
        return vfxNone();
    }
    // wet -> dry: black and glossy at first, then a grey wash with a darker pooled edge
    let dry = smoothstep(0.35, 1.0, i.age);
    var ink = select(vec3f(0.02, 0.015, 0.025), vfxDark(i.body) * 1.5 + i.edge * 0.15, i.p.x > 0.5);
    let pool = 1.0 - smoothstep(0.0, 0.03, -d);
    let wash = mix(ink, vec3f(0.42, 0.4, 0.42), 0.6);
    var rgb = mix(ink, mix(wash, ink, pool), dry);
    // wet sheen: a highlight crescent on the blot while it is fresh
    let sheen = (1.0 - smoothstep(0.0, 0.05, abs(length(p - vec2f(-0.05, 0.05)) - r * 0.6))) * (1.0 - dry) * step(length(p), r);
    rgb = rgb + vec3f(0.5) * sheen * 0.35;
    let a = inside * mix(0.95, 0.6, dry) * (1.0 - smoothstep(0.85, 1.0, i.age));
    return vfxOut(rgb, a);
}

fn vfxPaperStorm(i: VfxIn) -> VfxOut {
    let dens = max(i.p.x, 4.0);
    let spin = i.p.y;
    let talisman = i.p.z > 0.5;
    // slips swirl round the axis and climb
    let g = vec2f((i.uv.x + i.time * 0.15 * spin) * dens, (i.uv.y - i.time * 0.25) * dens * 0.5);
    let cell = floor(g);
    let h = hash22(cell + vec2f(i.seed * 7.0, 0.0));
    if (h.x < 0.3) {
        return vfxNone();
    }
    var q = fract(g) - 0.5 - (h - 0.5) * 0.3;
    // each slip spins about its long axis: its width narrows as it turns edge-on
    let turn = cos(i.time * (3.0 + h.y * 4.0) * spin + h.x * 20.0);
    q = rotate2(q, (h.y - 0.5) * 1.2);
    let half = vec2f(0.17 * max(abs(turn), 0.08), 0.36);
    let d = sdBox2(q, half);
    let cov = sdFill(d, i.px * dens * 1.5);
    if (cov <= 0.0) {
        return vfxNone();
    }
    // two-sided: the back of a slip is shaded
    var rgb = select(vec3f(0.72, 0.7, 0.66), vec3f(0.96, 0.94, 0.88), turn > 0.0);
    let local = q / max(half, vec2f(1e-3));
    let glyph = sdFill(sdGlyph(vec2f(local.x * 0.45, local.y * 0.8) , floor(h.x * 50.0)), 0.04) * step(0.0, turn);
    rgb = mix(rgb, vec3f(0.08, 0.06, 0.07), glyph * 0.85);
    if (talisman) {
        let border = step(0.78, max(abs(local.x), abs(local.y) * 0.95)) * step(0.0, turn);
        rgb = mix(rgb, vec3f(0.72, 0.06, 0.05), border);
    }
    let fade = vfxLifeFade(i.age, 0.1, 0.3) * smoothstep(0.0, 0.1, i.uv.y) * (1.0 - smoothstep(0.85, 1.0, i.uv.y));
    return vfxOut(rgb, cov * fade);
}

fn vfxSplash(i: VfxIn) -> VfxOut {
    // the crown: water thick at the base, thinning to spikes at the rim, foam along the rim
    let crownN = 12.0 + floor(i.seed * 6.0);
    let tip = pow(0.5 + 0.5 * cos(i.uv.x * TAU * crownN), 3.0);
    let rim = mix(0.7, 1.0, tip) * easeOutCubic(clamp(i.age * 3.0, 0.0, 1.0));
    if (i.uv.y > rim) {
        return vfxNone();
    }
    let foam = smoothstep(rim - 0.12, rim - 0.02, i.uv.y);
    let body = vfxCel(i.n, i.body * 0.5 + vec3f(0.25, 0.35, 0.45), i.body * 0.3 + vec3f(0.08, 0.14, 0.22), vec3f(0.95, 0.98, 1.0), i.fres);
    let rgb = mix(body, vec3f(0.96, 0.98, 1.0), foam);
    let clear = mix(0.45, 0.85, i.fres);
    let fall = 1.0 - smoothstep(0.55, 1.0, i.age);
    return vfxOut(rgb, max(clear, foam) * fall);
}

fn vfxTendril(i: VfxIn) -> VfxOut {
    // the strand wavers across the ribbon, thinning to the tip
    let v = i.uv.y;
    let reach = easeOutCubic(clamp(i.age * 3.0, 0.0, 1.0));
    if (v > reach) {
        return vfxNone();
    }
    let wave = sin(v * 9.0 - i.time * 5.0 + i.seed * 6.0) * 0.18 * v + (valueNoise2(vec2f(v * 6.0, i.st * 2.0 + i.seed)) - 0.5) * 0.15;
    let w = mix(0.38, 0.05, v / max(reach, 1e-3));
    let d = abs(i.uv.x - 0.5 - wave) / max(w, 1e-3);
    if (d > 1.0) {
        return vfxNone();
    }
    var rgb = vec3f(0.02, 0.012, 0.02);
    let edge = smoothstep(0.65, 0.9, d);
    rgb = mix(rgb, i.edge * 1.6, edge);
    // eyes opening along the strand
    let ey = fract(v * 5.0 + i.seed);
    let eyeId = floor(v * 5.0 + i.seed);
    if (hash11(eyeId + i.seed * 3.0) > 0.5 && v < reach - 0.1) {
        let ep = vec2f((i.uv.x - 0.5 - wave) / max(w, 1e-3), (ey - 0.5) * 2.2);
        let open = smoothstep(0.2, 0.6, i.age) * (0.6 + 0.4 * sin(i.time * 2.0 + eyeId));
        let lid = sdVesica(ep, 0.55, 0.55 - open * 0.35);
        let white = sdFill(lid, 0.05);
        let pupil = sdFill(length(ep - vec2f(sin(i.time + eyeId) * 0.1, 0.0)) - 0.14 * open, 0.05);
        rgb = mix(rgb, vec3f(0.9, 0.85, 0.7), white);
        rgb = mix(rgb, vec3f(0.6, 0.0, 0.05), pupil * white);
    }
    let fade = 1.0 - smoothstep(0.75, 1.0, i.age);
    return vfxOut(rgb, fade);
}

fn vfxCraneTrail(i: VfxIn) -> VfxOut {
    let v = i.uv.y;
    // the trail unfolds behind the crane (v = 1 at the crane) and flattens out behind
    let fold = fract(v * 9.0 - i.time * 2.0);
    let facet = step(0.5, fold) ;
    let w = (0.25 + 0.75 * v) * (1.0 - smoothstep(0.7, 1.0, i.age));
    let d = abs(i.uv.x - 0.5) * 2.0 / max(w, 1e-3);
    if (d > 1.0) {
        return vfxNone();
    }
    // zig-zag edge like a folded strip
    let zig = abs(fract(v * 18.0) - 0.5) * 0.2;
    if (d > 1.0 - zig) {
        return vfxNone();
    }
    var rgb = mix(vec3f(0.95, 0.93, 0.88), vec3f(0.74, 0.72, 0.7), facet * (0.6 + 0.4 * d));
    let crease = 1.0 - smoothstep(0.0, 0.04, abs(fold - 0.5));
    rgb = mix(rgb, vec3f(0.5, 0.48, 0.47), crease * 0.6);
    rgb = mix(rgb, i.body, 0.12);
    return vfxOut(rgb, smoothstep(0.0, 0.25, v) * 0.95);
}
