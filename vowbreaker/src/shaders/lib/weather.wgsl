// ============================================================================================
// vb_weather: what the sky does to a stage. Rain wets surfaces by exposure (facing up, open to the
// sky -- the baked AO says how sheltered a spot is), runs down walls in streaks, gathers in
// puddles with ripples and drips from overhangs; snow settles on upward faces and in a soft
// drift against walls; ash from the burning village greys everything and glows where embers
// land; frost rimes edges on the cold estate morning; a lightning flash floods everything for a
// frame; wind ripples puddles and leaves cloud shadows sliding across the ground.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_noise2, vb_water.
// ============================================================================================

struct WeatherState {
    rain: f32,       // 0..1 intensity
    wetness: f32,    // accumulated surface wetness 0..1
    snow: f32,       // snow cover 0..1
    ash: f32,        // ash fall 0..1
    frost: f32,
    lightning: f32,  // flash brightness this frame
    windX: f32,
    windZ: f32,
}

fn weatherOf(rain: f32, wet: f32, snow: f32, ash: f32, frost: f32, lightning: f32, wind: vec2f) -> WeatherState {
    return WeatherState(rain, wet, snow, ash, frost, lightning, wind.x, wind.y);
}

// how exposed a point is to the sky: up-facing and unoccluded
fn weatherExposure(n: vec3f, ao: f32) -> f32 {
    return clamp(smoothstep(-0.2, 0.9, n.y) * 0.7 + 0.3, 0.0, 1.0) * smoothstep(0.25, 0.75, ao);
}

// wetness of a surface: exposed surfaces soak first; vertical ones streak
fn weatherWetness(w: WeatherState, n: vec3f, ao: f32, p: vec3f, time: f32) -> f32 {
    let expo = weatherExposure(n, ao);
    let vertical = 1.0 - abs(n.y);
    let streakU = dot(p.xz, vec2f(0.7, 0.7)) * 9.0;
    let streak = streaks(vec2f(streakU, p.y * 2.0 + time * 1.5), vec2f(0.0, 1.0), 4.0, 1.0) * vertical * w.rain;
    return clamp(w.wetness * expo + streak * 0.5, 0.0, 1.0);
}

// puddles in hollows of the floor with rain rings and wind ripples; returns (mask, normal xz)
fn weatherPuddle(w: WeatherState, p: vec3f, n: vec3f, time: f32, amount: f32) -> vec3f {
    if (n.y < 0.85 || w.wetness <= 0.0) {
        return vec3f(0.0);
    }
    let mask = puddleMask(p.xz, amount * w.wetness);
    if (mask <= 0.0) {
        return vec3f(0.0);
    }
    var rip = rainRipples(p.xz, time, 2.5) * w.rain;
    let wind = vec2f(w.windX, w.windZ);
    let wr = vec2f(sin(dot(p.xz, wind) * 14.0 - time * 6.0), cos(dot(p.xz, wind.yx) * 11.0 - time * 5.0)) * length(wind) * 0.04;
    return vec3f(mask, rip.xy + wr);
}

// drips falling from the underside of eaves: bright streak dots under overhangs
fn weatherDrips(w: WeatherState, p: vec3f, n: vec3f, ao: f32, time: f32) -> f32 {
    if (w.rain <= 0.0 || n.y > -0.5) {
        return 0.0;
    }
    let cell = floor(p.xz * 6.0);
    let h = hash12(cell);
    let phase = fract(time * (0.6 + h) + h * 7.0);
    let bead = (1.0 - smoothstep(0.0, 0.15, length(fract(p.xz * 6.0) - 0.5))) * smoothstep(0.7, 1.0, phase);
    return bead * w.rain;
}

// snow: settles on faces that look up, drifts against walls, sparkles
fn weatherSnow(w: WeatherState, c: vec3f, p: vec3f, n: vec3f, ao: f32, v: vec3f, l: vec3f) -> vec3f {
    if (w.snow <= 0.0) {
        return c;
    }
    let up = smoothstep(0.25, 0.75, n.y);
    let drift = (1.0 - smoothstep(0.3, 0.7, ao)) * smoothstep(-0.1, 0.4, n.y) * 0.6;
    let edge = vfbm3(p * 2.5, 3);
    let k = clamp((up + drift) * w.snow * 1.4 - (1.0 - edge) * 0.4, 0.0, 1.0);
    let snowCol = vec3f(0.92, 0.95, 1.0) * (0.85 + 0.15 * clamp(dot(n, l), 0.0, 1.0));
    let sparkle = sparkle3(p * 60.0, 0.15, 14.0) * toonSpecular(n, l, v, 0.3, 0.1);
    return mix(c, snowCol + vec3f(sparkle * 0.8), k);
}

// ash fall: greys and flattens colour, with embers glowing where they settle
fn weatherAsh(w: WeatherState, c: vec3f, p: vec3f, n: vec3f, time: f32) -> vec3f {
    if (w.ash <= 0.0) {
        return c;
    }
    let up = smoothstep(0.0, 0.8, n.y);
    let grey = vec3f(luma(c)) * vec3f(0.85, 0.83, 0.8);
    var o = mix(c, grey, w.ash * (0.4 + 0.4 * up));
    let ember = sparkle3(p * 25.0 + vec3f(0.0, time * 0.2, 0.0), 0.05 * w.ash, 6.0) * up;
    let flick = 0.6 + 0.4 * sin(time * 9.0 + p.x * 13.0);
    o = o + vec3f(1.0, 0.4, 0.08) * ember * flick * 2.0 * w.ash;
    return o;
}

// frost: white rime on edges and up-facing surfaces, a fine crystalline breakup
fn weatherFrost(w: WeatherState, c: vec3f, p: vec3f, n: vec3f, ao: f32) -> vec3f {
    if (w.frost <= 0.0) {
        return c;
    }
    let crystals = crackle2(p.xz * 30.0 + p.yy * 20.0, 0.05);
    let exposed = weatherExposure(n, ao);
    let k = clamp(exposed * w.frost * (0.5 + 0.5 * crystals), 0.0, 0.8);
    return mix(c, vec3f(0.86, 0.92, 1.0), k);
}

// the lightning flash: everything lit flat blue-white from above, shadows gone for a frame
fn weatherLightning(w: WeatherState, c: vec3f, albedo: vec3f, n: vec3f) -> vec3f {
    if (w.lightning <= 0.0) {
        return c;
    }
    let sky = clamp(n.y * 0.5 + 0.6, 0.0, 1.0);
    return c + albedo * vec3f(0.75, 0.82, 1.0) * sky * w.lightning * 2.5;
}

// a wet surface: darker, a little more saturated, reflective
fn weatherWetAlbedo(albedo: vec3f, wet: f32, porosity: f32) -> vec3f {
    return wetAlbedo(albedo, wet, porosity);
}

// rain falling past in the air as screen-space streaks is in the post chain; here we add the
// splash crowns where drops hit open ground
fn weatherSplashes(w: WeatherState, p: vec3f, n: vec3f, time: f32) -> f32 {
    if (w.rain <= 0.0 || n.y < 0.8) {
        return 0.0;
    }
    let cell = floor(p.xz * 3.0);
    let h = hash22(cell);
    let ph = fract(time * 1.7 + h.x * 9.0);
    let c = (cell + h) / 3.0;
    let d = length(p.xz - c);
    let crown = (1.0 - smoothstep(0.0, 0.015, abs(d - ph * 0.08))) * (1.0 - ph) * step(ph, 0.4);
    return crown * w.rain;
}
