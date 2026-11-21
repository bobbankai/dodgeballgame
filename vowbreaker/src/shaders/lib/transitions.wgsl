// ============================================================================================
// vb_transitions: screen transitions between scenes, all as coverage masks (0 = old frame
// showing, 1 = covered) driven by a progress value 0..1: ink wipes, brush strokes across the
// frame, a page of manga panels closing in, a shatter into shards, a radial iris with a
// torn edge, and a talisman (paper) curtain.
// Depends on vb_common, vb_hash, vb_noise, vb_math, vb_sdf2d.
// ============================================================================================

fn transInkWipe(uv: vec2f, t: f32) -> f32 {
    let n = fbm2(uv * vec2f(3.0, 12.0) + 3.1, 4, 2.0, 0.5) * 0.12;
    return step(uv.x + n, t * 1.3 - 0.1);
}

// three diagonal brush strokes sweep across, each a little later than the last
fn transBrush(uv: vec2f, t: f32) -> f32 {
    var cover = 0.0;
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let band = abs(uv.y - (0.2 + fi * 0.3) - (uv.x - 0.5) * 0.25);
        let width = 0.2 + 0.03 * valueNoise2(vec2f(uv.x * 20.0, fi * 7.0));
        let start = fi * 0.18;
        let head = clamp((t - start) / 0.5, 0.0, 1.0) * 1.3 - 0.1;
        let dry = smoothstep(0.3, 0.6, valueNoise2(vec2f(uv.x * 40.0, uv.y * 3.0 + fi)));
        let reach = step(uv.x, head + (dry - 0.5) * 0.05);
        cover = max(cover, step(band, width) * reach);
    }
    return cover;
}

// manga panels: the frame splits into slanted panels that each close in turn
fn transPanels(uv: vec2f, t: f32, aspect: f32) -> f32 {
    let q = vec2f(uv.x * aspect, uv.y);
    let col = floor((q.x + q.y * 0.18) / (aspect / 3.0));
    let row = floor(uv.y * 2.0);
    let id = col + row * 3.0;
    let delay = hash11(id + 1.7) * 0.5;
    let k = clamp((t - delay) / 0.5, 0.0, 1.0);
    let local = vec2f(fract((q.x + q.y * 0.18) / (aspect / 3.0)), fract(uv.y * 2.0)) - 0.5;
    let shrink = 1.0 - easeInCubic(k);
    let inside = step(abs(local.x), 0.45 * shrink) * step(abs(local.y), 0.45 * shrink);
    let gutter = step(0.45, max(abs(local.x), abs(local.y)));
    return max(1.0 - inside, gutter * step(0.001, t));
}

// shatter: the frame cracks into voronoi shards that fall away
fn transShatter(uv: vec2f, t: f32) -> vec3f {
    let c = worley2(uv * 7.0, 1.0);
    let delay = c.id.x * 0.4;
    let k = clamp((t - delay) / 0.6, 0.0, 1.0);
    let fall = vec2f((c.id.y - 0.5) * 0.2, -k * k * 1.2);
    let edge = 1.0 - smoothstep(0.0, 0.02, c.edge);
    // returns (coverage, uv offset y, crack line)
    return vec3f(step(0.98, k), fall.y, edge * step(0.01, t) * (1.0 - k));
}

// iris: a closing circle with a torn ink edge, centred anywhere
fn transIris(uv: vec2f, center: vec2f, t: f32, aspect: f32) -> f32 {
    let p = vec2f((uv.x - center.x) * aspect, uv.y - center.y);
    let a = atan2(p.y, p.x);
    let tear = fbm2(vec2f(a * 4.0, t * 2.0), 3, 2.0, 0.5) * 0.06;
    let r = (1.0 - t) * 1.2;
    return step(r, length(p) + tear);
}

// a curtain of talisman strips dropping from the top
fn transTalismans(uv: vec2f, t: f32) -> vec4f {
    let strips = 14.0;
    let i = floor(uv.x * strips);
    let delay = hash11(i + 3.3) * 0.4;
    let k = clamp((t - delay) / 0.45, 0.0, 1.0);
    let bottom = 1.0 - easeOutBounce(k) * 1.05;
    let cover = step(bottom, uv.y);
    let local = vec2f(fract(uv.x * strips), (uv.y - bottom) * 4.0);
    let glyph = sdFill(sdGlyph((local - vec2f(0.5, 0.6)) * vec2f(2.6, 1.2), i), 0.05);
    let col = mix(vec3f(0.94, 0.9, 0.8), vec3f(0.75, 0.08, 0.06), glyph);
    let gap = step(0.06, local.x) * step(local.x, 0.94);
    return vec4f(col, cover * gap);
}
