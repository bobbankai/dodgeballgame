// The passing train (subway; src/render/Train.ts, train.vertex / train.fragment, and the light it
// throws on the platform through env.fragment).
//
// A train of cars rushes through on the near track. The body is drawn in object space (x along
// the train, y up, z across, each car 0..1 along its length): brushed steel with a coloured stripe,
// a run of lit windows with passengers' silhouettes swaying inside, doors with their seams, a
// destination board at the front, headlights. At speed everything smears along the train and
// its edges streak. On the platform its windows throw bars of light that slide past, and its
// headlights sweep ahead of it out of the tunnel.

struct TrainLook {
    body: vec3f,
    stripe: vec3f,
    window: vec3f,     // the light inside
    speed: f32,        // m/s
    time: f32,
}

// one car's face toward the platform: which parts are windows, doors, stripe
struct CarFace {
    window: f32,       // 1 in a window pane
    frame: f32,        // the dark rubber round a pane
    door: f32,         // door seams
    stripe: f32,
    paneId: f32,
}

fn trainCarFace(u: f32, v: f32, carLen: f32) -> CarFace {
    var f: CarFace;
    // u along the car (0..1), v up the side (0..1)
    let x = u * carLen;
    // windows: a band between v 0.45 and 0.8, panes 1.3 m with 0.25 m pillars, broken by doors
    let doorEvery = carLen / 4.0;
    let dx = fract(x / doorEvery) * doorEvery;
    let inDoor = step(doorEvery * 0.4, dx) * step(dx, doorEvery * 0.4 + 1.3);
    let pane = fract(x / 1.55);
    let paneIn = step(0.08, pane) * step(pane, 0.92);
    let band = step(0.45, v) * step(v, 0.8);
    f.window = band * paneIn * (1.0 - inDoor) + inDoor * step(0.5, v) * step(v, 0.82) * step(0.15, fract((dx - doorEvery * 0.4) / 0.65)) * step(fract((dx - doorEvery * 0.4) / 0.65), 0.85);
    let edgeU = min(pane - 0.08, 0.92 - pane) * 1.55;
    let edgeV = min(v - 0.45, 0.8 - v) * 2.9;
    f.frame = band * (1.0 - inDoor) * (1.0 - smoothstep(0.0, 0.05, min(edgeU, edgeV))) * step(0.0, min(edgeU, edgeV));
    // door seams: the outline of each door and the line between its two leaves
    let dl = dx - doorEvery * 0.4;
    let seam = max(1.0 - smoothstep(0.0, 0.03, abs(dl)), max(1.0 - smoothstep(0.0, 0.03, abs(dl - 1.3)), 1.0 - smoothstep(0.0, 0.02, abs(dl - 0.65))));
    f.door = seam * step(0.05, v) * step(v, 0.9) * step(-0.1, dl) * step(dl, 1.4);
    f.stripe = step(0.3, v) * step(v, 0.38) * (1.0 - inDoor * 0.0);
    f.paneId = floor(x / 1.55);
    return f;
}

// passengers inside a lit window: dark silhouettes standing and holding the straps, swaying
fn trainPassengers(u: f32, v: f32, carLen: f32, paneId: f32, time: f32, seed: f32) -> f32 {
    let h = hash12(vec2f(paneId, seed));
    if (h < 0.35) {
        return 0.0;
    }
    let x = fract(u * carLen / 1.55) - 0.5;
    let sway = sin(time * 2.0 + paneId) * 0.03;
    let px = x - (h - 0.5) * 0.5 - sway;
    // head and shoulders, a raised arm on the strap for some
    let head = 1.0 - smoothstep(0.08, 0.1, length(vec2f(px, (v - 0.72) * 1.4)));
    let body = step(abs(px), 0.16 - (0.72 - v) * 0.0) * step(v, 0.66);
    let arm = step(0.6, h) * step(abs(px - 0.12), 0.03) * step(0.66, v) * step(v, 0.8);
    return max(head, max(body, arm)) * step(0.45, v);
}

// the whole side of the train at a point (colour, emissive)
fn trainShade(u: f32, v: f32, carLen: f32, carIndex: f32, n: vec3f, l: vec3f, sunCol: vec3f, ambient: vec3f, look: TrainLook) -> vec4f {
    // at speed, details smear along the train: sample the face a little behind as well
    let smear = clamp(look.speed / 40.0, 0.0, 1.0);
    var win = 0.0;
    var frame = 0.0;
    var door = 0.0;
    var stripe = 0.0;
    var riders = 0.0;
    for (var k = 0; k < 4; k++) {
        let du = f32(k) * smear * 0.006;
        let f = trainCarFace(u - du, v, carLen);
        win = win + f.window;
        frame = frame + f.frame;
        door = door + f.door;
        stripe = stripe + f.stripe;
        riders = riders + trainPassengers(u - du, v, carLen, f.paneId, look.time, carIndex) * f.window;
    }
    win = win * 0.25;
    frame = frame * 0.25;
    door = door * 0.25;
    stripe = stripe * 0.25;
    riders = riders * 0.25;
    // brushed steel: two tones by the light, a cool sheen along the top
    let ndl = clamp(dot(n, l) * 0.5 + 0.5, 0.0, 1.0);
    var c = look.body * mix(0.55, 1.0, smoothstep(0.35, 0.6, ndl)) * (sunCol * 0.6 + ambient);
    c = c * (0.96 + 0.04 * sin(v * 300.0));
    c = mix(c, look.stripe * (sunCol * 0.5 + ambient * 1.2), stripe);
    c = mix(c, c * 0.45, door);
    c = mix(c, vec3f(0.04), frame);
    // the lit inside, with passengers dark against it
    let inside = mix(look.window, look.window * 0.12, riders);
    c = mix(c, inside, win);
    return vec4f(c, win * (1.0 - riders) * 0.9);
}

// --- on the platform -----------------------------------------------------------------------------

// bars of window light sliding along the platform as the train passes (x along the track):
// `trainX` is the train's front, `len` its length, `trackZ` its line, `dir` +1/-1 its heading
fn trainPlatformLight(p: vec3f, n: vec3f, trainX: f32, len: f32, trackZ: f32, dir: f32, amount: f32, col: vec3f) -> vec3f {
    if (amount <= 0.0) {
        return vec3f(0.0);
    }
    // only along the train's length
    let rear = trainX - dir * len;
    let along = (p.x - rear) * dir;
    let inTrain = step(0.0, along) * step(along, len);
    // the windows' light: bars every 1.55 m, softened with distance from the track
    let bar = smoothstep(0.1, 0.25, fract(p.x / 1.55)) * (1.0 - smoothstep(0.75, 0.9, fract(p.x / 1.55)));
    let dz = abs(p.z - trackZ);
    let reach = 1.0 - smoothstep(1.5, 9.0, dz);
    // floors catch it strongly, walls facing the track too
    let facing = max(n.y, clamp(dot(n, vec3f(0.0, 0.0, sign(trackZ - p.z))), 0.0, 1.0));
    return col * bar * inTrain * reach * facing * amount * 0.5;
}

// the headlights sweeping ahead of the train out of the tunnel
fn trainHeadlight(p: vec3f, n: vec3f, trainX: f32, trackZ: f32, dir: f32, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return vec3f(0.0);
    }
    let ahead = (p.x - trainX) * dir;
    let cone = step(0.0, ahead) * exp(-ahead * 0.04) * (1.0 - smoothstep(0.0, 3.0 + ahead * 0.15, abs(p.z - trackZ)));
    return vec3f(1.0, 0.95, 0.8) * cone * max(n.y, 0.3) * amount * 1.2;
}
