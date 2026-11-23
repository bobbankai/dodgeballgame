// ============================================================================================
// vb_vfx: building blocks for effects: flipbooks, polar UVs, dissolves, energy and fire,
// lightning, rings, speed lines, soft particles and the palettes of each cursed technique.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_sdf2d.
// ============================================================================================

// --- palettes ------------------------------------------------------------------------------------------
// Each technique has a signature: core (near white), body and edge colours. All linear.

struct EnergyPalette {
    core: vec3f,
    body: vec3f,
    edge: vec3f,
    dark: vec3f,
}

fn paletteFor(id: i32) -> EnergyPalette {
    var p: EnergyPalette;
    switch id {
        // 0: Hollow Bell (Itsuki): temple gold with ember orange
        case 0: {
            p.core = vec3f(1.0, 0.95, 0.8);
            p.body = vec3f(1.0, 0.62, 0.16);
            p.edge = vec3f(0.85, 0.22, 0.04);
            p.dark = vec3f(0.12, 0.04, 0.01);
        }
        // 1: Thousand Folds (Sayo): paper white with vermilion ink
        case 1: {
            p.core = vec3f(1.0, 1.0, 0.98);
            p.body = vec3f(0.95, 0.9, 0.82);
            p.edge = vec3f(0.85, 0.12, 0.1);
            p.dark = vec3f(0.08, 0.06, 0.07);
        }
        // 2: Stillwater (Mikami): moonlit cyan and deep indigo
        case 2: {
            p.core = vec3f(0.9, 1.0, 1.0);
            p.body = vec3f(0.3, 0.8, 1.0);
            p.edge = vec3f(0.12, 0.25, 0.85);
            p.dark = vec3f(0.01, 0.03, 0.1);
        }
        // 3: Hundred Night Lanterns (Sojin): lantern red with a sickly green flame at the tips
        case 3: {
            p.core = vec3f(1.0, 0.9, 0.7);
            p.body = vec3f(1.0, 0.2, 0.08);
            p.edge = vec3f(0.35, 0.85, 0.3);
            p.dark = vec3f(0.1, 0.0, 0.02);
        }
        // 4: Gravebrand (Ryoga): violet and black
        case 4: {
            p.core = vec3f(0.95, 0.85, 1.0);
            p.body = vec3f(0.58, 0.22, 1.0);
            p.edge = vec3f(0.2, 0.02, 0.4);
            p.dark = vec3f(0.02, 0.0, 0.04);
        }
        // 5: Black Spark: black lightning with crimson fringes
        case 5: {
            p.core = vec3f(0.02, 0.0, 0.01);
            p.body = vec3f(0.08, 0.0, 0.02);
            p.edge = vec3f(1.0, 0.05, 0.12);
            p.dark = vec3f(0.0);
        }
        // 6: curse miasma: tar purple-black with bruised edges
        case 6: {
            p.core = vec3f(0.6, 0.35, 0.7);
            p.body = vec3f(0.18, 0.05, 0.22);
            p.edge = vec3f(0.5, 0.1, 0.3);
            p.dark = vec3f(0.01, 0.0, 0.015);
        }
        default: {
            p.core = vec3f(1.0);
            p.body = vec3f(0.6, 0.7, 1.0);
            p.edge = vec3f(0.2, 0.3, 0.9);
            p.dark = vec3f(0.0);
        }
    }
    return p;
}

// heat (0..1) to colour through a palette: dark -> edge -> body -> core
fn paletteRamp(p: EnergyPalette, heat: f32) -> vec3f {
    let h = clamp(heat, 0.0, 1.0);
    let a = mix(p.dark, p.edge, smoothstep(0.0, 0.35, h));
    let b = mix(a, p.body, smoothstep(0.3, 0.7, h));
    return mix(b, p.core, smoothstep(0.7, 1.0, h));
}

// --- UV utilities --------------------------------------------------------------------------------------

fn flipbookUV(uv: vec2f, frame: f32, cols: f32, rows: f32) -> vec2f {
    let f = floor(fmod1(frame, cols * rows));
    let c = fmod1(f, cols);
    let r = floor(f / cols);
    return (uv + vec2f(c, r)) / vec2f(cols, rows);
}

fn polarUV(uv: vec2f, center: vec2f) -> vec2f {
    let d = uv - center;
    return vec2f(atan2(d.y, d.x) * INV_TAU + 0.5, length(d));
}

fn twirlUV(uv: vec2f, center: vec2f, strength: f32) -> vec2f {
    let d = uv - center;
    let a = strength * length(d);
    return center + rotate2(d, a);
}

fn scrollUV(uv: vec2f, speed: vec2f, time: f32) -> vec2f {
    return uv + speed * time;
}

// flow map: two phases blended so the texture never stretches too far
fn flowPhases(time: f32, speed: f32) -> vec3f {
    let t = time * speed;
    let p0 = fract(t);
    let p1 = fract(t + 0.5);
    let w = abs(p0 * 2.0 - 1.0);
    return vec3f(p0, p1, w);
}

// --- dissolve -------------------------------------------------------------------------------------------

// returns (alpha, edge glow): t 0 = whole, 1 = gone
fn dissolve(noise: f32, t: f32, edgeWidth: f32) -> vec2f {
    let cut = t * (1.0 + edgeWidth) - edgeWidth;
    let alpha = step(cut, noise);
    let edge = 1.0 - smoothstep(0.0, edgeWidth, noise - cut);
    return vec2f(alpha, edge * alpha * step(0.001, t));
}

// a directional dissolve that eats in from one side (wipes, burning paper)
fn dissolveDirectional(noise: f32, coord: f32, t: f32, edgeWidth: f32) -> vec2f {
    let v = coord * 0.7 + noise * 0.3;
    return dissolve(v, t, edgeWidth);
}

// --- energy ---------------------------------------------------------------------------------------------

// rising flame-like energy over a surface: p in object/world units, up = flame direction
fn energyFlame(p: vec3f, up: vec3f, time: f32, scale: f32) -> f32 {
    let q = p * scale - up * time * 1.6;
    let n1 = fbm3(q, 4, 2.1, 0.5) * 0.5 + 0.5;
    let n2 = valueNoise3(q * 2.7 + vec3f(0.0, time * 0.5, 0.0));
    return clamp(n1 * 0.75 + n2 * 0.35, 0.0, 1.0);
}

// stepped/posterized energy for an anime look: 3 hard levels
fn energyBands(v: f32, t0: f32, t1: f32, t2: f32) -> f32 {
    return (step(t0, v) + step(t1, v) + step(t2, v)) / 3.0;
}

// 2D flame sprite: uv in [0,1]^2, base at y = 0
fn flameShape(uv: vec2f, time: f32, seed: f32) -> f32 {
    let x = uv.x - 0.5;
    let y = uv.y;
    let n = fbm2(vec2f(x * 3.0 + seed, y * 2.0 - time * 2.2), 4, 2.0, 0.5);
    let width = 0.32 * (1.0 - y) * (1.0 - y) + 0.02;
    let d = abs(x + n * 0.15 * y) - width * (0.8 + n * 0.4);
    return clamp(1.0 - d * 12.0, 0.0, 1.0) * smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.75, 1.0, y + n * 0.2));
}

// --- lightning --------------------------------------------------------------------------------------------

// a jagged bolt along x in [0, 1] (uv.y centred at 0.5): returns (core, glow)
fn lightningBolt(uv: vec2f, time: f32, seed: f32, jag: f32) -> vec2f {
    let t = floor(time * 24.0);
    var y = 0.0;
    var amp = jag;
    var freq = 3.0;
    for (var i = 0; i < 5; i++) {
        y = y + (valueNoise2(vec2f(uv.x * freq + seed * 13.1, t + f32(i) * 7.0)) - 0.5) * amp;
        amp = amp * 0.5;
        freq = freq * 2.2;
    }
    let taper = sin(clamp(uv.x, 0.0, 1.0) * PI);
    let d = abs(uv.y - 0.5 - y * taper);
    let core = 1.0 - smoothstep(0.004, 0.012, d);
    let glow = exp(-d * 28.0);
    return vec2f(core, glow);
}

// branching arcs field for "electric" surfaces (Black Spark crackle over a fist)
fn electricField(p: vec3f, time: f32) -> f32 {
    let t = floor(time * 20.0);
    let r = ridged3(p * 3.0 + vec3f(t * 0.37, t * 0.21, -t * 0.13), 4, 2.1, 0.55, 1.0);
    return smoothstep(0.78, 0.92, r);
}

// --- rings and impacts ---------------------------------------------------------------------------------------

// shockwave ring for screen space or a ground decal: d distance from centre, r radius, w width
fn shockRing(d: f32, r: f32, w: f32) -> f32 {
    let x = (d - r) / w;
    return exp(-x * x * 4.0);
}

// expanding ring with an inner wake (for the bell's toll, domain edges)
fn tollRing(d: f32, progress: f32, maxR: f32) -> f32 {
    let r = easeOutCubic(progress) * maxR;
    let w = mix(0.08, 0.02, progress) * maxR;
    let ring = shockRing(d, r, w);
    let wake = smoothstep(r, r * 0.6, d) * (1.0 - progress) * 0.25;
    return (ring + wake) * (1.0 - progress * progress);
}

// radial speed lines around a centre (manga action lines)
fn speedLines(uv: vec2f, center: vec2f, aspect: f32, time: f32, density: f32, innerR: f32) -> f32 {
    let d = aspectCentered(uv, center, aspect);
    let a = atan2(d.y, d.x);
    let r = length(d);
    let t = floor(time * 18.0);
    let n = valueNoise2(vec2f(a * density, t));
    let lines = smoothstep(0.62, 0.9, n);
    let fade = smoothstep(innerR, innerR + 0.25, r);
    return lines * fade;
}

// parallel speed lines along a direction (dashes)
fn speedStreaks(uv: vec2f, dir: vec2f, time: f32, density: f32) -> f32 {
    let d = normalize(dir);
    let across = dot(uv, vec2f(-d.y, d.x)) * density;
    let along = dot(uv, d);
    let row = floor(across);
    let h = hash11(row);
    let len = 0.1 + h * 0.3;
    let pos = fract(along * 1.5 - time * (2.0 + h * 3.0) + h);
    let streak = step(pos, len) * step(0.7, hash11(row + 13.0));
    let thin = 1.0 - smoothstep(0.1, 0.4, abs(fract(across) - 0.5));
    return streak * thin;
}

// --- particles ---------------------------------------------------------------------------------------------------

// soft particle: fade where the sprite meets opaque geometry (both depths linear, metres)
fn softParticle(sceneDepth: f32, particleDepth: f32, softness: f32) -> f32 {
    return clamp((sceneDepth - particleDepth) / softness, 0.0, 1.0);
}

// round, slightly textured sprite mask for embers and motes
fn spriteDisc(uv: vec2f, hardness: f32) -> f32 {
    let d = length(uv - 0.5) * 2.0;
    return pow(clamp(1.0 - d, 0.0, 1.0), mix(2.0, 0.3, hardness));
}

// a petal shape (sakura): pointed oval with a notch at the tip
fn spritePetal(uv: vec2f) -> f32 {
    let p = (uv - 0.5) * vec2f(2.0, 2.4);
    let body = sdEllipseApprox(p, vec2f(0.55, 0.95));
    let notch = sdCircle(p - vec2f(0.0, 1.0), 0.22);
    return 1.0 - smoothstep(-0.02, 0.02, max(body, -notch));
}

// --- the bell seal (Itsuki's mark) ---------------------------------------------------------------------------------

// concentric rings with glyph ticks, rotating; uv centred at 0, radius ~1
fn bellSeal(p: vec2f, time: f32, px: f32) -> f32 {
    let r = length(p);
    let a = atan2(p.y, p.x);
    let outer = sdStroke(sdCircle(p, 0.95), 0.02, px);
    let inner = sdStroke(sdCircle(p, 0.62), 0.012, px);
    let ticksA = fract((a + time * 0.6) / TAU * 24.0);
    let ticks = step(0.75, ticksA) * step(0.68, r) * step(r, 0.88);
    let rq = rotate2(p, -time * 0.4);
    let bell = sdStroke(sdBellShape(rq * 2.6, 0.38, 0.45), 0.03, px * 2.6);
    let core = sdFill(sdCircle(p, 0.08), px);
    return clamp(outer + inner + ticks * 0.8 + bell + core, 0.0, 1.0);
}

// a talisman strip: paper rectangle with a red border and a procedural glyph column
fn talisman(uv: vec2f, seed: f32) -> vec4f {
    let p = uv - 0.5;
    let paper = 1.0 - step(0.0, sdBox2(p, vec2f(0.45, 0.48)));
    let border = sdStroke(sdBox2(p, vec2f(0.4, 0.44)), 0.012, 0.004);
    var glyph = 0.0;
    for (var i = 0; i < 3; i++) {
        let q = (p - vec2f(0.0, 0.28 - f32(i) * 0.28)) * 4.2;
        glyph = max(glyph, sdFill(sdGlyph(q, seed + f32(i)), 0.02));
    }
    let ink = max(border, glyph);
    let col = mix(vec3f(0.95, 0.92, 0.84), vec3f(0.78, 0.08, 0.06), ink);
    return vec4f(col, paper);
}
