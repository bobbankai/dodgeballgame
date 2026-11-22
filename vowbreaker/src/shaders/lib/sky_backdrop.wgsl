// Sky backdrops (sky.fragment): the far scenery painted onto the sky dome round the horizon, the
// way background painters do it: flat silhouettes in layers, each further one paler and closer to
// the colour of the sky (aerial perspective), with mist pooled between them.
//
//   1 mountains   three ranges of ridges, snow on the far peaks, mist in the valleys
//   2 city        a skyline in three depths: hazy towers, blocks with lit windows at night,
//                 antennas with blinking red lights, a lattice tower
//   3 temples     wooded hills with pagodas and temple roofs on them, a torii on a ridge
//   4 sea         a flat horizon with islands, a lighthouse sweeping its beam, glitter on the water
//   5 forest      a treeline of cedars and round crowns
//   6 burning     a ridge black against the glow of fires, columns of smoke leaning in the wind
//
// Directions are unit vectors from the dome's centre; a silhouette is a height above the horizon
// (radians, roughly) as a function of the azimuth.

struct Backdrop {
    cover: f32,      // 0..1 the silhouette here
    color: vec3f,
    emissive: vec3f,
}

fn backdropNone() -> Backdrop {
    var b: Backdrop;
    b.cover = 0.0;
    b.color = vec3f(0.0);
    b.emissive = vec3f(0.0);
    return b;
}

// layer `b` over `a` (b is nearer)
fn backdropOver(a: Backdrop, b: Backdrop) -> Backdrop {
    var o: Backdrop;
    o.cover = max(a.cover, b.cover);
    o.color = mix(a.color, b.color, b.cover);
    o.emissive = mix(a.emissive, b.emissive, b.cover);
    return o;
}

// a ridge line: fractal noise over the azimuth, sharpened into peaks
fn ridgeHeight(az: f32, scale: f32, height: f32, sharp: f32, seed: f32) -> f32 {
    var h = 0.0;
    var amp = 1.0;
    var f = scale;
    for (var i = 0; i < 5; i++) {
        let n = valueNoise2(vec2f(az * f + seed * 13.0, seed * 7.0 + f32(i) * 3.1));
        // ridged: fold the noise so it makes crests
        let r = 1.0 - abs(n * 2.0 - 1.0);
        h = h + mix(n, r * r, sharp) * amp;
        amp = amp * 0.5;
        f = f * 2.1;
    }
    return h / 1.9375 * height;
}

// how much of a pixel at elevation e lies under the line h (anti-aliased by the pixel's size)
fn underLine(e: f32, h: f32, px: f32) -> f32 {
    return 1.0 - smoothstep(h - px, h + px, e);
}

// the colour of a layer at distance k (0 near .. 1 far): the near silhouette dark, the far one
// fading into the horizon colour
fn layerColor(base: vec3f, horizon: vec3f, k: f32) -> vec3f {
    return mix(base, horizon, k);
}

fn backdropMountains(az: f32, e: f32, px: f32, horizon: vec3f, dark: vec3f, sun: vec3f, sunAz: f32, seed: f32) -> Backdrop {
    var b = backdropNone();
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let k = 1.0 - fi / 2.0;  // 1 far .. 0 near
        let h = 0.02 + ridgeHeight(az, 1.6 + fi * 1.4, 0.16 - fi * 0.04, 0.8 - fi * 0.2, seed + fi * 3.0);
        let cov = underLine(e, h, px);
        var lb = backdropNone();
        lb.cover = cov;
        var c = layerColor(dark, horizon, 0.25 + k * 0.6);
        // the side facing the sun is a touch lighter, snow on the far peaks
        let facing = smoothstep(-0.5, 1.0, cos(az - sunAz));
        c = c + sun * 0.06 * facing * (1.0 - k * 0.5);
        let snow = smoothstep(h - 0.025, h - 0.008, e) * step(0.11, h) * step(1.5, k * 2.0 + 0.6);
        c = mix(c, mix(horizon, vec3f(1.0), 0.6), snow * 0.7);
        lb.color = c;
        // mist pooled in the valley at the foot of this range veils the ranges behind it
        let mist = (1.0 - smoothstep(0.0, 0.025, e - (0.004 + fi * 0.008))) * (1.0 - cov);
        b.color = mix(b.color, horizon, mist * 0.55);
        b = backdropOver(b, lb);
    }
    return b;
}

fn backdropCity(az: f32, e: f32, px: f32, horizon: vec3f, dark: vec3f, night: f32, time: f32, seed: f32) -> Backdrop {
    var b = backdropNone();
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let k = 1.0 - fi / 2.0;
        // buildings: each azimuth cell is a tower of random width and height
        let cells = 90.0 + fi * 40.0;
        let x = (az / TAU + 0.5) * cells + seed * 17.0 + fi * 5.3;
        let cell = floor(x);
        let h0 = hash11(cell * 1.7 + fi * 11.0 + seed);
        let tall = step(0.92, hash11(cell * 3.1 + seed + fi));
        var h = 0.012 + h0 * (0.045 - fi * 0.01) + tall * 0.05 * (1.0 - fi * 0.3);
        // stepped tops and set-backs
        let fx = fract(x);
        h = h - step(0.7, fx) * step(0.5, hash11(cell + 7.0)) * 0.008;
        let gap = step(0.04, fx) * step(fx, 0.96);
        let cov = underLine(e, h, px) * gap;
        var lb = backdropNone();
        lb.cover = cov;
        lb.color = layerColor(dark, horizon, 0.2 + k * 0.55);
        // lit windows at night: a grid, some lit, a few flickering
        let wx = fract(fx * 6.0);
        let wy = fract(e * 600.0 / (1.0 + fi));
        let win = step(0.3, wx) * step(wx, 0.7) * step(0.35, wy) * step(wy, 0.75);
        let lit = step(0.55, hash12(vec2f(floor(fx * 6.0) + cell * 13.0, floor(e * 600.0 / (1.0 + fi)))));
        let warm = mix(vec3f(1.0, 0.8, 0.45), vec3f(0.7, 0.85, 1.0), step(0.7, hash11(cell * 5.0)));
        lb.emissive = warm * win * lit * night * cov * (0.6 - k * 0.3) * step(e, h - 0.002);
        // antennas with a blinking red light on the tall ones
        let ant = tall * (1.0 - smoothstep(0.0, 0.004, abs(fx - 0.5))) * step(h, e) * step(e, h + 0.025);
        lb.cover = max(lb.cover, ant);
        let blink = step(0.5, fract(time * 0.5 + h0));
        let tip = (1.0 - smoothstep(0.0, 0.004, length(vec2f((fx - 0.5) * 0.02, e - h - 0.025)))) * tall;
        lb.emissive = lb.emissive + vec3f(1.0, 0.1, 0.05) * tip * blink * 1.5;
        b = backdropOver(b, lb);
    }
    // a lattice tower somewhere on the skyline
    let ta = seed * 6.0 - PI;
    let dx = (az - ta) * 30.0;
    let towerH = 0.16;
    let width = 0.5 * (1.0 - clamp(e / towerH, 0.0, 1.0)) + 0.04;
    let tower = step(abs(dx), width) * step(e, towerH);
    let lattice = step(0.5, fract((e * 120.0) + abs(dx) * 3.0)) * 0.3;
    var tb = backdropNone();
    tb.cover = tower;
    tb.color = layerColor(dark, horizon, 0.35) * (1.0 - lattice * 0.2);
    tb.emissive = vec3f(1.0, 0.35, 0.1) * night * step(abs(dx), 0.03) * step(towerH - 0.004, e) * 2.0;
    b = backdropOver(b, tb);
    return b;
}

// a pagoda's silhouette at local coordinates (x across, y up), size 1
fn pagodaShape(x: f32, y: f32) -> f32 {
    var cov = 0.0;
    // five roofs stacked, each a flared triangle-ish band with a core between them
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let ry = fi * 0.18;
        let w = 0.5 - fi * 0.07;
        let t = (y - ry) / 0.07;
        let flare = w * (1.0 - clamp(t, 0.0, 1.0) * 0.55) + (1.0 - clamp(t * 3.0, 0.0, 1.0)) * 0.05;
        cov = max(cov, step(0.0, t) * step(t, 1.0) * step(abs(x), flare));
    }
    let core = step(abs(x), 0.16) * step(0.0, y) * step(y, 0.9);
    let spire = step(abs(x), 0.02) * step(0.0, y) * step(y, 1.15);
    return max(cov, max(core, spire));
}

fn backdropTemples(az: f32, e: f32, px: f32, horizon: vec3f, dark: vec3f, seed: f32) -> Backdrop {
    var b = backdropNone();
    for (var i = 0; i < 2; i++) {
        let fi = f32(i);
        let k = 1.0 - fi;
        let hill = 0.015 + ridgeHeight(az, 1.2 + fi, 0.07, 0.1, seed + fi * 5.0);
        // the hills are wooded: a fine bumpy canopy edge
        let canopy = hill + (valueNoise2(vec2f(az * 140.0, fi + seed)) - 0.5) * 0.006;
        var lb = backdropNone();
        lb.cover = underLine(e, canopy, px);
        lb.color = layerColor(dark * vec3f(0.85, 1.0, 0.9), horizon, 0.3 + k * 0.45);
        b = backdropOver(b, lb);
    }
    // a pagoda and a hall on the nearer hill
    let pa = seed * 5.0 - 2.0;
    let ph = 0.015 + ridgeHeight(pa, 2.2, 0.07, 0.1, seed + 5.0);
    let local = vec2f((az - pa) * 18.0, (e - ph + 0.004) * 9.0);
    let pg = pagodaShape(local.x, local.y);
    let ha = pa + 0.35;
    let hh = 0.015 + ridgeHeight(ha, 2.2, 0.07, 0.1, seed + 5.0);
    let hl = vec2f((az - ha) * 14.0, (e - hh + 0.003) * 14.0);
    // a hall: a wide curved roof on a low body
    let roof = step(0.0, hl.y) * step(hl.y, 0.35) * step(abs(hl.x), 0.8 - hl.y * 1.2 + (1.0 - clamp(hl.y * 6.0, 0.0, 1.0)) * 0.12);
    let body = step(abs(hl.x), 0.55) * step(-0.25, hl.y) * step(hl.y, 0.0);
    var tb = backdropNone();
    tb.cover = max(pg, max(roof, body));
    tb.color = layerColor(dark, horizon, 0.25);
    return backdropOver(b, tb);
}

fn backdropSea(az: f32, e: f32, px: f32, horizon: vec3f, dark: vec3f, sun: vec3f, sunAz: f32, night: f32, time: f32, seed: f32) -> Backdrop {
    var b = backdropNone();
    // islands: a few low humps on the horizon
    var isl = 0.0;
    for (var i = 0; i < 4; i++) {
        let fi = f32(i);
        let c = (hash11(fi + seed) - 0.5) * TAU;
        let w = 0.08 + hash11(fi * 3.0 + seed) * 0.15;
        let t = (az - c) / w;
        isl = max(isl, (1.0 - t * t) * (0.01 + hash11(fi * 7.0 + seed) * 0.025));
    }
    var lb = backdropNone();
    lb.cover = underLine(e, isl, px) * step(0.0, isl);
    lb.color = layerColor(dark, horizon, 0.55);
    b = backdropOver(b, lb);
    // a lighthouse on the biggest island, its beam sweeping at night
    let la = (hash11(seed) - 0.5) * TAU;
    let beamA = la + sin(time * 0.6) * 1.2;
    let beam = (1.0 - smoothstep(0.0, 0.08 + e * 0.6, abs(az - beamA))) * smoothstep(0.0, 0.02, e) * (1.0 - smoothstep(0.02, 0.12, e));
    b.emissive = b.emissive + vec3f(1.0, 0.95, 0.75) * beam * night * 0.25;
    // glitter on the water below the horizon toward the sun or moon
    let below = smoothstep(0.0, -0.002, e) * (1.0 - smoothstep(-0.04, 0.0, -e - 0.04));
    let toward = 1.0 - smoothstep(0.0, 0.25, abs(az - sunAz));
    let glit = step(0.8, valueNoise2(vec2f(az * 300.0, e * 900.0 + time * 2.0)));
    b.emissive = b.emissive + sun * glit * toward * below * 0.5;
    return b;
}

fn backdropForest(az: f32, e: f32, px: f32, horizon: vec3f, dark: vec3f, seed: f32) -> Backdrop {
    var b = backdropNone();
    for (var i = 0; i < 2; i++) {
        let fi = f32(i);
        let k = 1.0 - fi;
        let cells = 220.0 + fi * 120.0;
        let x = (az / TAU + 0.5) * cells + seed * 9.0 + fi * 3.7;
        let cell = floor(x);
        let fx = fract(x) - 0.5;
        let hb = 0.02 + ridgeHeight(az, 1.0, 0.03, 0.0, seed + fi);
        let h = hash11(cell * 1.3 + fi + seed);
        var tree = 0.0;
        if (h > 0.45) {
            // a cedar: a narrow spike
            let th = hb + 0.02 + h * 0.025;
            tree = step(abs(fx), (th - e) / (th - hb) * 0.45) * step(e, th);
        } else {
            // a round crown
            let th = hb + 0.012 + h * 0.02;
            tree = 1.0 - smoothstep(0.0, px * 4.0, length(vec2f(fx * 0.012, e - th + 0.006)) - 0.007);
        }
        var lb = backdropNone();
        lb.cover = max(tree, underLine(e, hb, px));
        lb.color = layerColor(dark * vec3f(0.8, 1.0, 0.85), horizon, 0.25 + k * 0.45);
        b = backdropOver(b, lb);
    }
    return b;
}

fn backdropBurning(az: f32, e: f32, px: f32, horizon: vec3f, dark: vec3f, fire: vec3f, time: f32, seed: f32, wind: f32) -> Backdrop {
    var b = backdropNone();
    let h = 0.015 + ridgeHeight(az, 1.4, 0.06, 0.3, seed);
    var lb = backdropNone();
    lb.cover = underLine(e, h, px);
    lb.color = dark * 0.35;
    // fires along the ridge glow through the silhouette's edge
    let fires = smoothstep(0.55, 0.8, valueNoise2(vec2f(az * 12.0 + seed, time * 0.3)));
    lb.emissive = fire * fires * (1.0 - smoothstep(0.0, 0.012, h - e)) * 1.4;
    b = backdropOver(b, lb);
    // the glow of the fires on the sky above the ridge
    b.emissive = b.emissive + fire * fires * (1.0 - smoothstep(0.0, 0.12, e - h)) * step(h, e) * 0.5;
    // smoke columns rising from the fires, leaning with the wind
    for (var i = 0; i < 5; i++) {
        let fi = f32(i);
        let c = (hash11(fi * 2.3 + seed) - 0.5) * TAU;
        let rise = max(e - h, 0.0);
        let lean = c + rise * wind * 1.5;
        let w = 0.02 + rise * 0.35;
        let puff = vfbm2(vec2f((az - lean) * 20.0, e * 30.0 - time * 0.4 + fi), 3);
        let col = (1.0 - smoothstep(w * 0.5, w, abs(az - lean))) * smoothstep(0.3, 0.55, puff) * (1.0 - smoothstep(0.1, 0.5, rise)) * step(h, e);
        var sb = backdropNone();
        sb.cover = col * 0.8;
        sb.color = mix(dark * 0.5, fire * 0.35, 1.0 - smoothstep(0.0, 0.08, rise));
        b = backdropOver(b, sb);
    }
    return b;
}

// the backdrop for a kind; `px` is the angular size of a pixel (for clean edges)
fn skyBackdrop(kind: i32, d: vec3f, px: f32, horizon: vec3f, zenith: vec3f, sun: vec3f, sunDir: vec3f, night: f32, fire: vec3f, time: f32, seed: f32, wind: f32) -> Backdrop {
    let az = atan2(d.z, d.x);
    let e = asin(clamp(d.y, -1.0, 1.0));
    let sunAz = atan2(sunDir.z, sunDir.x);
    // the near silhouettes take a dark, slightly cool version of the sky
    let dark = mix(zenith, horizon, 0.3) * 0.35 + vec3f(0.02, 0.02, 0.035);
    switch kind {
        case 1: {
            return backdropMountains(az, e, px, horizon, dark, sun, sunAz, seed);
        }
        case 2: {
            return backdropCity(az, e, px, horizon, dark, night, time, seed);
        }
        case 3: {
            return backdropTemples(az, e, px, horizon, dark, seed);
        }
        case 4: {
            return backdropSea(az, e, px, horizon, dark, sun, sunAz, night, time, seed);
        }
        case 5: {
            return backdropForest(az, e, px, horizon, dark, seed);
        }
        case 6: {
            return backdropBurning(az, e, px, horizon, dark, fire, time, seed, wind);
        }
        default: {
            return backdropNone();
        }
    }
}
