// Expression marks (toon.fragment, on faces and hair): the symbols anime draws on a face for what
// the drawing alone cannot say, placed with the eyes' real centres and the head's frame.
//
//   blush      soft pink ovals under the eyes crossed by short diagonal hatch strokes (shy, warm,
//              flushed with anger)
//   gloom      a dark band falling over the eyes from the brow, striped with vertical lines (shock,
//              despair, dread)
//   anger      the throbbing "vein" mark on the temple: four curved red strokes in a cross
//   sweat      a big nervous drop on the side of the head, pale blue with an outline and a shine
//   pallor     the face drained, cold and grey (fear, exhaustion)

struct FaceFrame {
    p: vec2f,      // position in eye-distance units: x toward the head's right, y up, 0 between the eyes
    ok: f32,
}

fn faceFrameAt(worldPos: vec3f, eyeL: vec4f, eyeR: vec4f, headRight: vec3f, headUp: vec3f) -> FaceFrame {
    var f: FaceFrame;
    f.ok = 0.0;
    f.p = vec2f(1e3);
    if (eyeL.w <= 0.0) {
        return f;
    }
    let mid = (eyeL.xyz + eyeR.xyz) * 0.5;
    let ipd = max(distance(eyeL.xyz, eyeR.xyz), 1e-3);
    let d = worldPos - mid;
    f.p = vec2f(dot(d, headRight), dot(d, headUp)) / ipd;
    f.ok = 1.0;
    return f;
}

// soft ovals under the eyes with three or four diagonal strokes across each
fn markBlush(p: vec2f, px: f32) -> vec2f {
    let side = select(-1.0, 1.0, p.x > 0.0);
    let c = vec2f(side * 0.62, -0.5);
    let q = (p - c) / vec2f(0.34, 0.15);
    let oval = 1.0 - smoothstep(0.6, 1.0, length(q));
    // diagonal hatch strokes inside the oval
    let k = (p.x * side * 0.9 + p.y) * 9.0;
    let stroke = (1.0 - smoothstep(0.0, 0.12 + px * 8.0, abs(fract(k) - 0.5))) * (1.0 - smoothstep(0.55, 0.85, length(q)));
    return vec2f(oval, stroke);
}

// a dark band over the eyes from the brow down, with vertical lines
fn markGloom(p: vec2f) -> vec2f {
    let band = smoothstep(-0.1, 0.25, p.y) * (1.0 - smoothstep(1.2, 1.6, p.y)) * (1.0 - smoothstep(1.1, 1.5, abs(p.x)));
    let lines = (1.0 - smoothstep(0.0, 0.18, abs(fract(p.x * 7.0) - 0.5) * 2.0 - 0.6)) * smoothstep(0.1, 0.5, p.y);
    return vec2f(band, lines * band);
}

// the anger mark: four short curved strokes meeting in a cross, on the temple
fn markAnger(p: vec2f, side: f32, time: f32) -> f32 {
    let c = vec2f(side * 0.95, 1.05);
    // it throbs
    let s = 0.22 * (1.0 + 0.12 * sin(time * 9.0));
    let q = (p - c) / s;
    var d = 1e3;
    for (var i = 0; i < 4; i++) {
        let a = f32(i) * PI * 0.5 + PI * 0.25;
        let dir = vec2f(cos(a), sin(a));
        // each stroke bows away from the centre
        let r = q - dir * 0.55;
        let bow = abs(length(r - vec2f(-dir.y, dir.x) * 0.0) - 0.35);
        d = min(d, max(bow, -dot(r, dir) - 0.05));
    }
    return 1.0 - smoothstep(0.06, 0.12, d);
}

// a big drop running down the side of the head
fn markSweat(p: vec2f, side: f32, time: f32) -> vec3f {
    let slide = fract(time * 0.25) * 0.15;
    let c = vec2f(side * 1.05, 0.75 - slide);
    let q = (p - c) / 0.3;
    // a teardrop: round below, pointed above
    let r = length(q - vec2f(0.0, -0.1));
    let tip = max(abs(q.x) * 1.6 + q.y * 0.7 - 0.7, -q.y);
    let body = min(r - 0.45, tip);
    let fill = 1.0 - smoothstep(-0.02, 0.02, body);
    let outline = 1.0 - smoothstep(0.0, 0.06, abs(body));
    let shine = 1.0 - smoothstep(0.0, 0.08, length(q - vec2f(-0.15, 0.0)) - 0.08);
    return vec3f(fill, outline, shine * fill);
}

// all of them on a face or hair fragment; `fx` = blush, gloom, anger, sweat; `pallor` separately
fn faceMarks(c0: vec3f, ff: FaceFrame, fx: vec4f, pallor: f32, isFace: f32, time: f32, px: f32) -> vec3f {
    if (ff.ok < 0.5) {
        return c0;
    }
    var c = c0;
    let p = ff.p;
    // pallor: the skin drained cold
    c = mix(c, vec3f(luma(c)) * vec3f(0.85, 0.92, 1.0), pallor * isFace * 0.6);
    if (fx.x > 0.0 && isFace > 0.5) {
        let b = markBlush(p, px);
        c = mix(c, c * vec3f(1.0, 0.62, 0.62) + vec3f(0.12, 0.0, 0.02), b.x * fx.x * 0.55);
        c = mix(c, vec3f(0.85, 0.25, 0.3), b.y * fx.x * 0.7);
    }
    if (fx.y > 0.0) {
        let g = markGloom(p);
        c = mix(c, c * vec3f(0.35, 0.32, 0.5), g.x * fx.y * 0.75);
        c = mix(c, vec3f(0.12, 0.1, 0.2), g.y * fx.y * 0.6);
    }
    if (fx.z > 0.0) {
        let a = markAnger(p, 1.0, time);
        c = mix(c, vec3f(0.85, 0.08, 0.06), a * fx.z);
    }
    if (fx.w > 0.0) {
        let s = markSweat(p, -1.0, time);
        c = mix(c, vec3f(0.7, 0.88, 1.0), s.x * fx.w * 0.85);
        c = mix(c, vec3f(0.15, 0.3, 0.5), s.y * fx.w);
        c = mix(c, vec3f(1.0), s.z * fx.w);
    }
    return c;
}
