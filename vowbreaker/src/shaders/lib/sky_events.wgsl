// Sky events (sky.fragment): things that happen in a sky rather than what it is made of.
//
//   lightning   a forked bolt drawn across the sky in the instant of a flash (rain stages); its
//               path is new every strike, it lights the clouds round it and leaves an afterglow
//   aurora      curtains of light hanging in the north on cold clear nights: vertical rays folding
//               in slow waves, green below fading to violet above, posterised like the rest
//   crows       a flock wheeling at dusk: small black chevrons beating their wings, circling
//   sunburst    long rays fanning from a low sun behind the clouds (morning after rain)

// a bolt across the sky: direction d, the flash strength and a seed for this strike
fn skyBolt(d: vec3f, flash: f32, seed: f32) -> vec3f {
    if (flash <= 0.01 || d.y < -0.02) {
        return vec3f(0.0);
    }
    // the bolt hangs from the clouds at an azimuth picked by the strike's seed
    let az0 = hash11(seed) * TAU;
    let az = atan2(d.z, d.x);
    var da = az - az0;
    da = da - TAU * floor((da + PI) / TAU);
    let x = da * 4.0;
    let y = d.y;
    if (abs(x) > 1.2 || y > 0.55) {
        return vec3f(0.0);
    }
    // the main channel wanders down from the cloud base to the horizon
    var path = 0.0;
    var amp = 0.12;
    var freq = 6.0;
    for (var k = 0; k < 4; k++) {
        path = path + (valueNoise2(vec2f(y * freq, seed * 13.0 + f32(k) * 7.0)) - 0.5) * amp;
        amp = amp * 0.5;
        freq = freq * 2.3;
    }
    let w = 0.006 + 0.004 * (0.55 - y);
    let core = 1.0 - smoothstep(w * 0.4, w, abs(x - path));
    // one branch forking off halfway down
    let by = clamp((0.3 - y) / 0.25, 0.0, 1.0);
    let branch = path + by * by * 0.35 * select(-1.0, 1.0, hash11(seed + 3.0) > 0.5) + (valueNoise2(vec2f(y * 20.0, seed)) - 0.5) * 0.04;
    let bcore = (1.0 - smoothstep(w * 0.3, w * 0.7, abs(x - branch))) * step(y, 0.3) * step(0.05, y);
    let glow = exp(-abs(x - path) * 18.0) * 0.4;
    return vec3f(0.85, 0.9, 1.25) * (max(core, bcore) * 4.0 + glow) * flash;
}

// the aurora: curtains of rays in the north (rays fold in slow waves, green to violet)
fn skyAurora(d: vec3f, time: f32, amount: f32) -> vec3f {
    if (amount <= 0.0 || d.y < 0.02) {
        return vec3f(0.0);
    }
    let az = atan2(d.x, -d.z);
    // only the northern half of the sky
    let north = 1.0 - smoothstep(0.9, 1.6, abs(az));
    var acc = vec3f(0.0);
    for (var k = 0; k < 3; k++) {
        let fk = f32(k);
        // the curtain's foot follows a slow wave across the sky
        let base = 0.12 + fk * 0.06 + sin(az * (2.0 + fk) + time * 0.15 + fk * 2.0) * 0.05;
        let h = d.y - base;
        if (h < 0.0) {
            continue;
        }
        let rays = valueNoise2(vec2f(az * 60.0 + sin(az * 4.0 + time * 0.3) * 3.0, time * 0.4 + fk * 5.0));
        let curtain = exp(-h * (9.0 - fk * 2.0)) * (0.35 + 0.65 * rays);
        let col = mix(vec3f(0.2, 1.0, 0.55), vec3f(0.6, 0.25, 0.95), smoothstep(0.0, 0.25, h));
        acc = acc + col * curtain * (0.6 - fk * 0.15);
    }
    // posterised a little, like the painted sky
    let lum = luma(acc);
    let q = floor(lum * 4.0 + 0.5) / 4.0;
    return acc * mix(1.0, q / max(lum, 1e-3), 0.4) * amount * north;
}

// crows wheeling at dusk: chevrons on circling paths, wings beating
fn skyCrows(d: vec3f, time: f32, amount: f32) -> f32 {
    if (amount <= 0.0 || d.y < 0.03 || d.y > 0.5) {
        return 0.0;
    }
    let az = atan2(d.z, d.x);
    var m = 0.0;
    for (var k = 0; k < 9; k++) {
        let fk = f32(k);
        let h = hash12(vec2f(fk, 3.0));
        // each bird circles a point in the sky
        let ca = 1.2 + h * 0.8 + time * (0.05 + h * 0.03);
        let centre = vec2f(0.4 + sin(time * 0.02 + fk) * 0.05, 0.22 + h * 0.08);
        let pos = centre + vec2f(cos(ca * 3.0 + fk), sin(ca * 3.0 + fk) * 0.4) * (0.04 + h * 0.03);
        let q = vec2f(az - pos.x, d.y - pos.y) * vec2f(1.0, 1.0);
        let flap = sin(time * 9.0 + fk * 2.0) * 0.5;
        // a chevron: two short wing strokes from the body
        let wingL = sdSegment2(q, vec2f(0.0), vec2f(-0.006, 0.002 + flap * 0.004));
        let wingR = sdSegment2(q, vec2f(0.0), vec2f(0.006, 0.002 + flap * 0.004));
        let dd = min(wingL, wingR) - 0.0009;
        m = max(m, 1.0 - smoothstep(0.0, 0.0007, dd));
    }
    return m * amount;
}

// rays fanning from a low sun behind clouds
fn skySunburst(d: vec3f, sunDir: vec3f, sunCol: vec3f, amount: f32, time: f32) -> vec3f {
    if (amount <= 0.0) {
        return vec3f(0.0);
    }
    let sd = dot(d, sunDir);
    if (sd < 0.3) {
        return vec3f(0.0);
    }
    let side = normalize(cross(sunDir, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4));
    let up = cross(side, sunDir);
    let a = atan2(dot(d, up), dot(d, side));
    let rays = smoothstep(0.55, 0.8, valueNoise2(vec2f(a * 9.0, time * 0.05))) ;
    let fall = pow(max(sd, 0.0), 6.0);
    return sunCol * rays * fall * amount * 0.5;
}
