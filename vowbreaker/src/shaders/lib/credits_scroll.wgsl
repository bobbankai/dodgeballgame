// The credits handscroll (vbStylize, calligraphy mode 3): an emakimono unrolls behind the names,
// painted in ink on old washi and panning right to left as the story's places pass in order:
//
//   the rainy alley      lamp posts and wires in slanting rain
//   the academy          a temple hall with a torii before it, pines
//   the chapel           a bell tower on a cliff over the sea, the moon
//   the festival         strings of lanterns over little houses, the only colour a lantern red
//   the estate           paper cranes rising from a garden
//   the graves           a weeping cherry over the stones, petals falling (pale pink)
//   the bell             a bronze bell hung from a beam inside a great ensō, and a red seal
//
// Far mountains in pale wash run under all of it, mist bands lie between the layers, and a river
// winds along the bottom.

const SCROLL_SEGMENT = 2.2;   // scroll units per place
const SCROLL_PLACES = 7.0;

fn scrollPaper(uv: vec2f, pixel: vec2f) -> vec3f {
    let fibre = valueNoise2(vec2f(pixel.x * 0.03, pixel.y * 0.4)) * valueNoise2(vec2f(pixel.x * 0.4, pixel.y * 0.03));
    let age = vfbm2(uv * 3.0, 3);
    var c = vec3f(0.93, 0.89, 0.8) * (0.95 + fibre * 0.08) * (0.94 + age * 0.08);
    // the scroll's edges browned with handling
    let e = min(uv.y, 1.0 - uv.y);
    c = c * mix(0.75, 1.0, smoothstep(0.0, 0.08, e));
    return c;
}

// an ink wash layer under a ridge line: tone darkest at the top edge, fading downward
fn scrollRidge(x: f32, y: f32, base: f32, height: f32, freq: f32, seed: f32) -> f32 {
    let h = base + (vfbm2(vec2f(x * freq + seed, seed), 4) - 0.3) * height;
    let inside = 1.0 - smoothstep(h - 0.004, h + 0.004, y);
    let fade = smoothstep(h - 0.25, h, y);
    return inside * (0.45 + 0.55 * fade);
}

// a brushed line segment with pressure (thick in the middle, tapering)
fn scrollStroke(p: vec2f, a: vec2f, b: vec2f, w: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    let d = length(pa - ba * h);
    let ww = w * (0.35 + 0.65 * sin(h * PI));
    return 1.0 - smoothstep(ww * 0.7, ww, d);
}

// a pagoda-roofed hall: a curved roof over a dark body (local coordinates, size 1)
fn scrollHall(q: vec2f) -> f32 {
    let roofY = 0.55 - pow(abs(q.x) / 0.9, 2.0) * 0.12;
    let roof = step(abs(q.x), 0.9) * step(q.y, roofY) * step(roofY - 0.12, q.y);
    let body = step(abs(q.x), 0.6) * step(0.0, q.y) * step(q.y, 0.45);
    let ridge = step(abs(q.x), 0.3) * step(roofY, q.y) * step(q.y, roofY + 0.05);
    return max(max(roof, body * 0.85), ridge);
}

fn scrollTorii(q: vec2f) -> f32 {
    let posts = max(step(abs(q.x - 0.3), 0.04), step(abs(q.x + 0.3), 0.04)) * step(0.0, q.y) * step(q.y, 0.7);
    let kasagi = step(abs(q.x), 0.48 + q.y * 0.0) * step(abs(q.y - 0.72), 0.04);
    let nuki = step(abs(q.x), 0.38) * step(abs(q.y - 0.58), 0.025);
    return max(posts, max(kasagi, nuki));
}

fn scrollPine(q: vec2f, seed: f32) -> f32 {
    let trunk = scrollStroke(q, vec2f(0.0, 0.0), vec2f(0.1 * sin(seed * 5.0), 0.9), 0.05);
    var crown = 0.0;
    for (var i = 0; i < 4; i++) {
        let fi = f32(i);
        let c = vec2f(sin(seed * 3.0 + fi * 2.1) * 0.25, 0.45 + fi * 0.15);
        let d = length((q - c) * vec2f(1.0, 2.6)) - 0.28 * (1.0 - fi * 0.15);
        crown = max(crown, (1.0 - smoothstep(-0.02, 0.02, d)) * (0.6 + 0.4 * step(0.4, valueNoise2(q * 30.0 + fi))));
    }
    return max(trunk, crown);
}

fn scrollBell(q: vec2f) -> f32 {
    // the bell's profile: wider at the mouth, a domed crown, a lug on top
    let y = q.y;
    let w = mix(0.36, 0.24, smoothstep(0.0, 0.8, y)) + 0.04 * smoothstep(0.75, 0.0, y) * step(y, 0.1);
    let body = step(abs(q.x), w) * step(0.0, y) * step(y, 0.85);
    let crown = 1.0 - smoothstep(0.0, 0.01, length((q - vec2f(0.0, 0.85)) * vec2f(1.0, 2.0)) - 0.24);
    let lug = step(abs(q.x), 0.05) * step(0.9, y) * step(y, 1.05);
    let bands = step(0.5, fract(y * 6.0)) * 0.15;
    return max(max(body * (0.85 - bands), crown), lug);
}

fn scrollCrane(q: vec2f, flap: f32) -> f32 {
    let body = 1.0 - smoothstep(0.0, 0.02, length(q * vec2f(1.0, 2.5)) - 0.12);
    let wingL = scrollStroke(q, vec2f(0.0, 0.0), vec2f(-0.35, 0.15 + flap * 0.15), 0.07);
    let wingR = scrollStroke(q, vec2f(0.0, 0.0), vec2f(0.35, 0.15 + flap * 0.15), 0.07);
    let neck = scrollStroke(q, vec2f(0.05, 0.02), vec2f(0.22, -0.08), 0.025);
    return max(max(body, neck), max(wingL, wingR));
}

// one place on the scroll: ink (r), a colour accent (g: lantern red, b: sakura pink)
fn scrollPlace(place: i32, q: vec2f, t: f32, seed: f32) -> vec3f {
    var ink = 0.0;
    var red = 0.0;
    var pink = 0.0;
    switch place {
        case 0: {
            // the rainy alley: lamp posts, wires, slanting rain
            for (var i = 0; i < 3; i++) {
                let x = -0.6 + f32(i) * 0.6;
                ink = max(ink, scrollStroke(q, vec2f(x, 0.0), vec2f(x, 0.55), 0.018));
                ink = max(ink, (1.0 - smoothstep(0.03, 0.05, length(q - vec2f(x + 0.04, 0.56)))) * 0.7);
            }
            ink = max(ink, scrollStroke(q, vec2f(-1.0, 0.5), vec2f(1.0, 0.45), 0.006));
            let rain = step(0.86, valueNoise2(vec2f((q.x + q.y * 0.3) * 60.0, q.y * 3.0 + t * 8.0))) * 0.35;
            ink = max(ink, rain * step(0.0, q.y));
        }
        case 1: {
            // the academy: a hall, a torii before it, two pines
            ink = max(ink, scrollHall((q - vec2f(0.15, 0.0)) / vec2f(0.55, 0.55)) * 0.9);
            ink = max(ink, scrollTorii((q - vec2f(-0.45, 0.0)) / 0.35));
            ink = max(ink, scrollPine((q - vec2f(0.75, 0.0)) / 0.45, 1.0) * 0.8);
            ink = max(ink, scrollPine((q - vec2f(-0.85, 0.0)) / 0.38, 2.0) * 0.7);
        }
        case 2: {
            // the chapel on a cliff over the sea, the moon
            let cliff = step(q.y, 0.25 - max(q.x, 0.0) * 0.4) * step(-0.2, q.x);
            ink = max(ink, cliff * 0.75);
            let tower = step(abs(q.x - 0.1), 0.07) * step(0.25, q.y) * step(q.y, 0.75) + step(abs(q.x - 0.1), 0.1 - (q.y - 0.75) * 0.5) * step(0.75, q.y) * step(q.y, 0.92);
            ink = max(ink, clamp(tower, 0.0, 1.0));
            let sea = step(q.y, 0.05) * step(0.5, fract(q.y * 40.0 + sin(q.x * 9.0) * 0.3)) * 0.35 * step(q.x, 0.95);
            ink = max(ink, sea);
            let moon = abs(length(q - vec2f(-0.6, 0.75)) - 0.12);
            ink = max(ink, (1.0 - smoothstep(0.008, 0.016, moon)) * 0.8);
        }
        case 3: {
            // the festival: lantern strings over houses; the lanterns are the only colour
            for (var i = 0; i < 4; i++) {
                let x = -0.75 + f32(i) * 0.5;
                ink = max(ink, scrollHall((q - vec2f(x, 0.0)) / vec2f(0.22, 0.3)) * 0.8);
            }
            let sag = 0.62 - pow(fract(q.x * 0.8 + 0.5) - 0.5, 2.0) * 0.4;
            ink = max(ink, (1.0 - smoothstep(0.0, 0.006, abs(q.y - sag))) * 0.8);
            let lx = fract(q.x * 6.0) - 0.5;
            let lan = 1.0 - smoothstep(0.0, 0.01, length(vec2f(lx / 6.0, (q.y - sag + 0.06) * 0.8)) - 0.028);
            red = max(red, lan);
        }
        case 4: {
            // the estate: a low wall, cranes rising
            ink = max(ink, step(q.y, 0.12) * step(0.06, q.y) * 0.8);
            for (var i = 0; i < 6; i++) {
                let fi = f32(i);
                let c = vec2f(-0.7 + fi * 0.3 + sin(t * 0.5 + fi) * 0.04, 0.3 + fract(fi * 0.37 + t * 0.06) * 0.6);
                ink = max(ink, scrollCrane((q - c) / 0.16, sin(t * 3.0 + fi)) * 0.85);
            }
        }
        case 5: {
            // the graves: stones under a weeping cherry, petals falling
            for (var i = 0; i < 5; i++) {
                let x = -0.7 + f32(i) * 0.35;
                ink = max(ink, step(abs(q.x - x), 0.05) * step(0.0, q.y) * step(q.y, 0.2 + hash11(f32(i)) * 0.08) * 0.85);
            }
            ink = max(ink, scrollStroke(q, vec2f(0.4, 0.0), vec2f(0.3, 0.75), 0.05));
            ink = max(ink, scrollStroke(q, vec2f(0.32, 0.6), vec2f(-0.2, 0.85), 0.025));
            let canopy = 1.0 - smoothstep(0.0, 0.02, length((q - vec2f(0.15, 0.75)) * vec2f(0.8, 1.6)) - 0.35);
            let blossom = canopy * step(0.45, valueNoise2(q * 40.0));
            pink = max(pink, blossom);
            let fall = step(0.97, hash12(floor((q + vec2f(0.0, t * 0.08)) * 30.0)));
            pink = max(pink, fall * step(q.y, 0.75));
        }
        default: {
            // the bell inside a great ensō, a beam above it
            ink = max(ink, scrollBell((q - vec2f(0.0, 0.08)) / 0.45));
            ink = max(ink, scrollStroke(q, vec2f(-0.4, 0.62), vec2f(0.4, 0.6), 0.03));
            let r = length(q - vec2f(0.0, 0.32));
            let a = atan2(q.y - 0.32, q.x);
            let gap = step(0.4, fract(a / TAU + 0.15));
            ink = max(ink, (1.0 - smoothstep(0.015, 0.03, abs(r - 0.45))) * gap);
            red = max(red, step(abs(q.x - 0.62), 0.06) * step(abs(q.y - 0.05), 0.06));
        }
    }
    return vec3f(ink, red, pink);
}

// the whole scroll at a screen uv; `t` 0..1 over the credits
fn creditsScroll(uv: vec2f, pixel: vec2f, aspect: f32, t: f32, time: f32, seed: f32) -> vec3f {
    var c = scrollPaper(uv, pixel);
    let total = SCROLL_SEGMENT * SCROLL_PLACES;
    // pan from the first place to the last
    let x = uv.x * aspect + t * (total - aspect) ;
    let y = uv.y;
    // far mountains and nearer hills in pale wash, mist bands between them
    let far = scrollRidge(x, y, 0.55, 0.25, 0.6, seed);
    let near = scrollRidge(x, y, 0.32, 0.18, 1.1, seed + 3.0);
    let ink = vec3f(0.1, 0.09, 0.1);
    c = mix(c, mix(c, ink, 0.25), far * 0.6);
    let mist = smoothstep(0.32, 0.4, y) * (1.0 - smoothstep(0.4, 0.5, y)) * 0.5;
    c = mix(c, scrollPaper(uv, pixel), mist);
    c = mix(c, mix(c, ink, 0.45), near * 0.6);
    // the river along the bottom: two ink lines and ripples
    let rv = 0.1 + sin(x * 1.3) * 0.03;
    let bank = max(1.0 - smoothstep(0.0, 0.004, abs(y - rv)), 1.0 - smoothstep(0.0, 0.004, abs(y - rv + 0.06)));
    let ripple = step(0.85, valueNoise2(vec2f(x * 20.0 - time * 0.5, y * 120.0))) * step(y, rv) * step(rv - 0.06, y);
    c = mix(c, ink, max(bank * 0.7, ripple * 0.4));
    // the places themselves, each in its own stretch of the scroll
    let place = clamp(floor(x / SCROLL_SEGMENT), 0.0, SCROLL_PLACES - 1.0);
    let local = vec2f((x - (place + 0.5) * SCROLL_SEGMENT) / (SCROLL_SEGMENT * 0.5), (y - 0.2) / 0.6);
    let pl = scrollPlace(i32(place), local, time, seed);
    // ink laid with a little granulation; the accent colours as washes
    let gran = 0.85 + 0.15 * valueNoise2(pixel * 0.7);
    c = mix(c, ink * gran, pl.x * 0.9);
    c = mix(c, vec3f(0.78, 0.14, 0.1), pl.y * 0.85);
    c = mix(c, vec3f(0.95, 0.7, 0.75), pl.z * 0.7);
    // a seal stamped at the end of each place
    let sealC = vec2f((place + 0.92) * SCROLL_SEGMENT, 0.88);
    let sq = (vec2f(x, y) - sealC) / 0.05;
    let seal = step(abs(sq.x), 1.0) * step(abs(sq.y), 1.0) * step(0.25, valueNoise2(sq * 6.0 + place));
    c = mix(c, vec3f(0.72, 0.12, 0.1), seal * 0.85);
    return c;
}
