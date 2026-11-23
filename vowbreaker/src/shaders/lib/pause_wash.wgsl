// The pause wash (vbStylize): while the game is paused, the frame behind the menu softens into an
// ink wash on paper: blurred, its values banded into a few tones of grey ink with the faintest
// memory of their colour, paper fibre over everything, the edges sinking into darker ink, and an
// ensō brushed beside the menu.

fn pauseBlur(src: texture_2d<f32>, ss: sampler, uv: vec2f, px: vec2f, radius: f32) -> vec3f {
    var acc = textureSampleLevel(src, ss, uv, 0.0).rgb;
    var w = 1.0;
    for (var i = 0; i < 12; i++) {
        let a = f32(i) / 12.0 * TAU;
        let r = select(radius, radius * 0.5, i % 2 == 0);
        acc = acc + textureSampleLevel(src, ss, uv + vec2f(cos(a), sin(a)) * px * r, 0.0).rgb;
        w = w + 1.0;
    }
    return acc / w;
}

fn pauseWash(src: texture_2d<f32>, ss: sampler, uv: vec2f, pixel: vec2f, aspect: f32, px: vec2f, amount: f32, time: f32) -> vec3f {
    let base = textureSampleLevel(src, ss, uv, 0.0).rgb;
    if (amount <= 0.0) {
        return base;
    }
    let blurred = pauseBlur(src, ss, uv, px, 6.0 * amount);
    // values in four soft bands of ink, a whisper of the colour left
    let v = luma(blurred);
    let tone = floor(v * 4.0 + 0.5) / 4.0;
    let inkTone = mix(v, tone, 0.6);
    var c = mix(vec3f(0.1, 0.09, 0.1), vec3f(0.92, 0.89, 0.82), inkTone);
    c = mix(c, c * normalize(blurred + vec3f(0.05)) * 1.6, 0.15);
    // paper fibre
    let fibre = valueNoise2(vec2f(pixel.x * 0.03, pixel.y * 0.5)) * valueNoise2(vec2f(pixel.x * 0.5, pixel.y * 0.03));
    c = c * (0.95 + fibre * 0.08);
    // the edges sink into ink
    let q = (uv - 0.5) * vec2f(aspect, 1.0);
    let edge = smoothstep(0.45, 0.95, length(q * vec2f(0.8, 1.1)) + (vfbm2(uv * 4.0, 3) - 0.5) * 0.1);
    c = mix(c, vec3f(0.06, 0.05, 0.06), edge * 0.8);
    // an ensō brushed to the right of the menu, drawn on as the pause settles
    let p = vec2f(uv.x * aspect, uv.y);
    let k = brushEnso(p, vec2f(0.76 * aspect, 0.5), 0.2, 0.02, 1.2, 5.8, smoothstep(0.2, 1.0, amount), 0.61);
    c = mix(c, vec3f(0.05, 0.04, 0.05), k.cover * 0.85);
    return mix(base, c, amount);
}
