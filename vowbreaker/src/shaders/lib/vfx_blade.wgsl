// VFX blades: the shapes a strike leaves in the air.
//
// Slash arcs live on the `arc` shape: u runs along the swing (0 = where the blade started,
// 1 = where it is now), v runs across the blade's path (0 inner, 1 outer). A slash is drawn on in
// the first fifth of its life, then its tail catches up with its head while it thins and breaks
// into streaks. Styles (p.x):
//   0  energy    a glowing crescent: white-hot leading edge, palette body, darker rim, ink line
//   1  ink       a sumi stroke: black with a coloured bleed, splattered droplets off the tail
//   2  paper     a paper blade: folded white planes with creases and a red seal line (Shiragami)
//   3  water     a water arc: clear body, foam lip, droplets thrown off (the umbrella)
// p.y = thickness (fraction of the band, 0 = default 0.95), p.z = streak amount, p.w = draw-on time (fraction of life)

// the visible part of the swing: (s along the visible part 0..1, coverage along u)
fn vfxSlashSpan(u: f32, age: f32, drawT: f32) -> vec2f {
    let head = easeOutCubic(clamp(age / max(drawT, 0.02), 0.0, 1.0));
    let tail = clamp((age - drawT * 0.4) / (1.0 - drawT * 0.4), 0.0, 1.0);
    let tailU = head * easeInCubic(tail);
    let s = (u - tailU) / max(head - tailU, 1e-3);
    let cov = step(tailU, u) * step(u, head);
    return vec2f(clamp(s, 0.0, 1.0), cov);
}

// the crescent's width at s (thin tail, thick just behind the head, a sharp tip)
fn vfxCrescent(s: f32) -> f32 {
    return pow(s, 0.65) * (1.0 - pow(s, 9.0)) * 1.15;
}

fn vfxSlashArc(i: VfxIn) -> VfxOut {
    let style = i32(i.p.x + 0.5);
    let thick = select(0.95, clamp(i.p.y, 0.05, 1.0), i.p.y > 0.0);
    let span = vfxSlashSpan(i.uv.x, i.age, max(i.p.w, 0.05));
    if (span.y <= 0.0) {
        return vfxNone();
    }
    let s = span.x;
    let uvb = vfxBoil(i.uv, i.st, i.seed, 0.01);
    // distance from the outer edge, in crescent widths: 0 at the outer edge .. 1 at the inner edge
    let w = vfxCrescent(s) * thick * (1.0 - i.age * 0.5);
    let d = (1.0 - uvb.y) / max(w, 1e-3);
    // the blade field: 1 at the outer edge, fading in to 0 at the inner edge
    var f = 1.0 - d;
    // the tail breaks into streaks as it ages
    let streak = vfxStreaks(s, uvb.y, 22.0, i.seed, 0.55 + 0.4 * (1.0 - i.age));
    let breakup = mix(1.0, 0.35 + 0.65 * streak, smoothstep(0.0, 0.6, 1.0 - s) * clamp(i.p.z, 0.0, 1.0));
    f = f * breakup;
    let fade = 1.0 - smoothstep(0.55, 1.0, i.age);

    switch style {
        case 1: {
            // ink: a sumi stroke, black, the palette bleeding at its edge, droplets off the tail
            let paper = vfxDryBrush(uvb * vec2f(1.0, 3.0), i.st, i.seed, 0.6);
            let body = smoothstep(0.02, 0.08, f * paper);
            let bleed = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.05, 0.25, f));
            var rgb = mix(vec3f(0.015, 0.01, 0.02), i.edge * 0.6, bleed * 0.7);
            // droplets flicked from the tail
            let drop = vfxSpeckles(vec2f(s * 4.0, uvb.y * 2.0), 6.0, 0.35, i.st, i.seed) * (1.0 - s) * step(uvb.y, 1.0);
            let a = max(body, drop * 0.9) * fade;
            return vfxOut(rgb, a);
        }
        case 2: {
            // paper: folded planes in two tones with crease lines, a red seal stripe near the edge
            let facet = step(0.5, fract(s * 7.0 + uvb.y * 1.5));
            var rgb = mix(vec3f(0.92, 0.9, 0.85), vec3f(0.78, 0.76, 0.74), facet);
            let crease = 1.0 - smoothstep(0.0, 0.03, abs(fract(s * 7.0 + uvb.y * 1.5) - 0.5));
            rgb = mix(rgb, vec3f(0.55, 0.52, 0.5), crease * 0.5);
            let stripe = smoothstep(0.82, 0.86, f) * (1.0 - smoothstep(0.92, 0.96, f));
            rgb = mix(rgb, vec3f(0.75, 0.08, 0.06), stripe);
            let a = smoothstep(0.0, 0.04, f) * fade;
            let line = vfxInkLine(f, 0.02, 1.5);
            rgb = mix(rgb, vec3f(0.08, 0.06, 0.07), line);
            return vfxOut(rgb, max(a, line * fade));
        }
        case 3: {
            // water: clear body tinted by the palette, white foam lip, droplets off the leading edge
            let foam = smoothstep(0.78, 0.86, f);
            let body = smoothstep(0.0, 0.06, f);
            let band = smoothstep(0.35, 0.4, f) * (1.0 - smoothstep(0.55, 0.6, f));
            var rgb = mix(i.body * 0.6 + vec3f(0.1, 0.18, 0.25), vec3f(0.95, 0.98, 1.0), foam);
            rgb = rgb + vec3f(0.5, 0.6, 0.7) * band * 0.5;
            let drops = vfxSpeckles(vec2f(s * 3.0, i.uv.y * 1.5 + 0.3), 9.0, 0.3, i.st, i.seed) * smoothstep(0.6, 1.0, s);
            let a = max(body * 0.65 + foam * 0.35, drops) * fade;
            return vfxOut(rgb, a);
        }
        default: {
            // energy: posterised crescent, white-hot leading edge, ink line on the inner boundary
            var o = vfxGlowRamp(f + s * 0.15, i.edge, i.body, i.core, i.inten * vfxPunch(i.age), 0.02);
            let line = vfxInkLine(f, 0.15, 1.2) * 0.6;
            o.rgb = mix(o.rgb, i.edge * 0.25, line);
            let spark = vfxSpeckles(vec2f(s * 5.0, uvb.y * 3.0), 7.0, 0.25, i.st, i.seed) * smoothstep(0.7, 1.0, s) * step(0.0, f + 0.3);
            o.rgb = o.rgb + i.core * spark * 2.0 * i.inten;
            o.a = max(o.a, spark) * fade;
            o.rgb = o.rgb * o.a;
            return o;
        }
    }
}

// --- claw rakes: three or four parallel tearing lines (on a quad, uv 0..1, drawn diagonally) ---------
fn vfxClaw(i: VfxIn) -> VfxOut {
    let n = max(i.p.x, 3.0);
    let p = rotate2(i.uv - 0.5, 0.6) + 0.5;
    let lane = clamp(floor(p.x * n * 1.4 - (n * 1.4 - n) * 0.5), 0.0, n - 1.0);
    let cx = (lane + 0.5) / n * 0.7 + 0.15;
    let len = 0.85 - 0.12 * abs(lane - (n - 1.0) * 0.5);
    let y0 = 0.5 - len * 0.5 + hash11(lane + i.seed) * 0.05;
    let draw = easeOutCubic(clamp(i.age * 5.0 - lane * 0.15, 0.0, 1.0));
    let y1 = y0 + len * draw;
    let t = clamp((p.y - y0) / max(len, 1e-3), 0.0, 1.0);
    let wdt = 0.035 * sin(PI * t) * (1.0 - i.age * 0.6);
    let d = sdTaperedSegment2(vec2f(p.x, p.y), vec2f(cx, y0), vec2f(cx + 0.02, y1), wdt, wdt * 0.3);
    let f = clamp(-d / 0.035, 0.0, 1.0);
    var o = vfxGlowRamp(f, i.edge, i.body, i.core, i.inten * vfxPunch(i.age), 0.05);
    let fade = 1.0 - smoothstep(0.5, 1.0, i.age);
    o.a = o.a * fade;
    o.rgb = o.rgb * o.a;
    return o;
}

// --- thrust: a straight stab line with a cone of light at the tip (ribbon shape, u across, v along) -----
fn vfxThrust(i: VfxIn) -> VfxOut {
    let along = i.uv.y;
    let across = abs(i.uv.x - 0.5) * 2.0;
    let head = easeOutCubic(clamp(i.age * 4.0, 0.0, 1.0));
    let tail = easeInCubic(clamp(i.age * 1.4, 0.0, 1.0)) * head;
    if (along > head || along < tail) {
        return vfxNone();
    }
    let s = (along - tail) / max(head - tail, 1e-3);
    let width = mix(0.15, 1.0, pow(s, 2.0));
    let f = clamp(1.0 - across / width, 0.0, 1.0) * smoothstep(0.0, 0.2, s);
    let streak = vfxStreaks(s, i.uv.x, 9.0, i.seed, 0.7);
    var o = vfxGlowRamp(f * (0.6 + 0.4 * streak), i.edge, i.body, i.core, i.inten * vfxPunch(i.age), 0.03);
    o.a = o.a * (1.0 - smoothstep(0.6, 1.0, i.age));
    o.rgb = o.rgb * o.a;
    return o;
}

// --- the X-cut: two crossing slashes flashing on a quad (a finisher's afterimage) ----------------------
fn vfxCrossCut(i: VfxIn) -> VfxOut {
    let p = (i.uv - 0.5) * 2.0;
    var acc = 0.0;
    for (var k = 0; k < 2; k++) {
        let a = select(0.75, -0.75, k == 1);
        let q = rotate2(p, a);
        let delay = f32(k) * 0.12;
        let draw = easeOutCubic(clamp((i.age - delay) * 6.0, 0.0, 1.0));
        let t = q.x * 0.5 + 0.5;
        let w = 0.08 * sin(PI * clamp(t, 0.0, 1.0)) * (1.0 - smoothstep(0.3, 1.0, i.age));
        let inside = step(t, draw) * step(0.0, t);
        acc = max(acc, clamp(1.0 - abs(q.y) / max(w, 1e-3), 0.0, 1.0) * inside);
    }
    var o = vfxGlowRamp(acc, i.edge, i.body, i.core, i.inten * vfxPunch(i.age), 0.04);
    let ring = sdStroke(length(p) - easeOutCubic(i.age) * 0.9, 0.01, 0.01) * (1.0 - i.age);
    o.rgb = o.rgb + i.core * ring * i.inten;
    o.a = max(o.a, ring) * (1.0 - smoothstep(0.7, 1.0, i.age));
    o.rgb = o.rgb * o.a;
    return o;
}
