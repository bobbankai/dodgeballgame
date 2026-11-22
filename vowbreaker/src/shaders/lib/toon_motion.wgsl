// Character motion and line weight (toon.vertex and outline.vertex share it, so the ink hull
// moves exactly with the body it outlines).
//
//   flutter   hems, sleeves' ends and loose hair move in the stage's wind and trail behind the
//             character when they move: weighted by material (cloth low on the body, hair below
//             the crown), a slow gust plus a quick ripple running along the hem
//   lines     the ink line's weight the way an animator draws it: thicker on the shadow side and
//             at the silhouette, thinner where the light falls, a brush's pressure varying along
//             the stroke, and the whole line boiling slightly on twos

struct Flutter {
    disp: vec3f,
    weight: f32,
}

// how much a vertex is free to move: cloth near the hem, hair toward its tips
fn flutterWeight(matId: i32, objPos: vec3f, figureH: f32) -> f32 {
    let h = max(figureH, 0.5);
    let y = objPos.y / h;
    if (matId == 0) {
        // cloth: free below the knee, a little at the hips, nothing above
        return (1.0 - smoothstep(0.08, 0.5, y)) * 0.9 + (1.0 - smoothstep(0.45, 0.6, y)) * 0.1;
    }
    if (matId == 2) {
        // hair: fixed at the crown, the ends (lower down) the freest
        return clamp((1.0 - y) * 4.0, 0.0, 1.0) * 0.8 + 0.08;
    }
    if (matId == 7) {
        // paper (charms, talismans hung on cords)
        return 0.7;
    }
    return 0.0;
}

// the displacement: wind (world xz, strength) and the character's own motion (world xz velocity)
fn flutterAt(matId: i32, objPos: vec3f, worldPos: vec3f, figureH: f32, wind: vec4f, motion: vec4f) -> Flutter {
    var f: Flutter;
    f.weight = flutterWeight(matId, objPos, figureH);
    f.disp = vec3f(0.0);
    if (f.weight <= 0.0) {
        return f;
    }
    let t = wind.w;
    // the air the cloth feels: the wind, minus the character's own velocity (it trails behind)
    var air = vec2f(wind.x, wind.y) * wind.z - motion.xy * 0.35;
    let speed = length(air);
    if (speed < 1e-3) {
        return f;
    }
    let dir = air / speed;
    let side = vec2f(-dir.y, dir.x);
    // a slow gust and a quick ripple running along the hem (phase from the vertex's place)
    let gust = 0.6 + 0.4 * sin(t * 1.3 + worldPos.x * 0.4 + worldPos.z * 0.3);
    let phase = objPos.x * 9.0 + objPos.z * 7.0 + objPos.y * 5.0;
    let ripple = sin(t * (6.0 + speed * 2.0) + phase) * 0.6 + sin(t * 11.0 + phase * 1.7) * 0.4;
    let amp = clamp(speed * 0.02, 0.0, 0.07);
    let along = dir * amp * gust;
    let across = side * ripple * amp * 0.35;
    // hems lift a little as they blow back
    let lift = abs(ripple) * amp * 0.25 * select(0.0, 1.0, matId == 0);
    f.disp = vec3f(along.x + across.x, lift, along.y + across.y) * f.weight;
    return f;
}

// the ink line's weight (multiplies the outline width)
fn inkLineWeight(nW: vec3f, viewDir: vec3f, sunDir: vec3f, objPos: vec3f, time: f32, seed: f32) -> f32 {
    // thicker in shadow, thinner in light
    let lit = clamp(dot(nW, sunDir) * 0.5 + 0.5, 0.0, 1.0);
    var w = mix(1.25, 0.7, smoothstep(0.35, 0.8, lit));
    // the outer contour is drawn with more weight than inner lines
    let grazing = 1.0 - abs(dot(nW, viewDir));
    w = w * mix(0.85, 1.15, smoothstep(0.6, 0.95, grazing));
    // a brush's pressure along the stroke
    let pressure = valueNoise3(objPos * 6.0 + vec3f(seed)) * 0.5 + 0.75;
    w = w * pressure;
    // boiling on twos: the line's width jumps a little every other frame
    let frame = floor(time * 12.0);
    w = w * (0.92 + 0.16 * hash13(floor(objPos * 25.0) + vec3f(frame)));
    return w;
}

// --- smear frames ---------------------------------------------------------------------------------------------
//
// Hand-drawn fight animation stretches a fast limb back along its path for a frame or two (a smear).
// The striking bone's position and velocity come in as `smear` (xyz, reach) and `smearVel` (xyz,
// amount); vertices near it that face away from its motion are dragged back along the path, by
// varying amounts so the trailing edge breaks into streaks. Shared by the body and the ink hull.

fn smearDisplace(worldPos: vec3f, nW: vec3f, smear: vec4f, smearVel: vec4f, objPos: vec3f) -> vec3f {
    if (smearVel.w <= 0.0 || smear.w <= 0.0) {
        return vec3f(0.0);
    }
    let v = smearVel.xyz;
    let speed = length(v);
    if (speed < 0.5) {
        return vec3f(0.0);
    }
    let dir = v / speed;
    let d = distance(worldPos, smear.xyz);
    let near = 1.0 - smoothstep(smear.w * 0.4, smear.w, d);
    // only the side trailing behind the motion is dragged
    let trailing = smoothstep(0.1, -0.5, dot(nW, dir));
    // streaks: each vertex drags by its own amount
    let streak = 0.35 + 0.65 * hash13(floor(objPos * 40.0));
    let len = min(speed * 0.045, 0.6) * smearVel.w;
    return -dir * len * near * trailing * streak;
}
