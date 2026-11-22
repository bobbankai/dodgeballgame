// Memory styles (vbMemory): the ways a backstory can be painted, besides sumi-e (vbSumie). The
// graded frame and the G-buffer are repainted as one of:
//
//   1 kage-e         shadow-puppet theatre: a paper screen lit from behind by a candle, the
//                    people black cut-outs with the rods that move them, the scenery cut paper in
//                    layers, the flame breathing, the paper's edge scorched
//   2 photograph     an old print: sepia, the silver going mirror-like at the edges, a crease
//                    across it, corners worn round, dust and fine scratches, the whites yellowed
//   3 watercolour    washes laid wet: colour bleeding past the lines, pigment gathering at the wet
//                    edges and granulating in the paper's tooth, blooms where water ran back
//   4 crayon         a child's drawing: wax strokes that skip over the paper's grain, wobbly
//                    outlines, a few bright colours, the sky a band of blue at the top
//   5 stained glass  the frame cut into panes of coloured glass held by black lead, light glowing
//                    through each pane, the people's panes darker and richer
//   7 home movie     an 8 mm film: jitter in the gate, faded warm stock, grain, sprocket holes
//   8 charcoal       a charcoal study on toned paper, smudged, the highlights lifted out
//   6 woodblock      an ukiyo-e print: flat colour blocks from a small palette, a black keyblock
//                    line, a graded (bokashi) sky, paper grain, the colour blocks a little out of
//                    register with the key
//
// Each keeps one hue (the memory's colour, as sumi-e does) where it makes sense.

const MEM_KAGE = 1;
const MEM_PHOTO = 2;
const MEM_WATER = 3;
const MEM_CRAYON = 4;
const MEM_GLASS = 5;
const MEM_WOODBLOCK = 6;

struct MemGeo {
    isChar: f32,
    edge: f32,
    depth: f32,
    n: vec3f,
}

fn memIsChar(id: f32) -> f32 {
    return step(999.5, id) * step(id, 1999.5);
}

// lines from the G-buffer: silhouettes, depth breaks, creases (r pixels wide)
fn memGeometry(gb: texture_2d<f32>, gbs: sampler, uv: vec2f, px: vec2f, r: f32, wobble: f32, seed: f32) -> MemGeo {
    var g: MemGeo;
    let c = textureSampleLevel(gb, gbs, uv, 0.0);
    g.depth = c.b;
    g.n = octDecode(c.rg);
    g.isChar = memIsChar(c.a);
    var e = 0.0;
    for (var i = 0; i < 4; i++) {
        let a = f32(i) * PI * 0.5 + 0.4;
        let w = 1.0 + (valueNoise2(uv * 300.0 + vec2f(f32(i), seed)) - 0.5) * wobble;
        let o = vec2f(cos(a), sin(a)) * px * r * w;
        let s = textureSampleLevel(gb, gbs, uv + o, 0.0);
        let sil = abs(memIsChar(s.a) - g.isChar);
        let dd = abs(s.b - c.b) / max(min(s.b, c.b), 0.1);
        let crease = 1.0 - dot(octDecode(s.rg), g.n);
        e = max(e, max(sil, max(smoothstep(0.05, 0.12, dd), smoothstep(0.4, 0.7, crease))));
    }
    g.edge = e;
    return g;
}

// how close a colour's hue is to the kept hue (0 none kept)
fn memKeep(c: vec3f, hue: f32) -> f32 {
    if (hue <= 0.0) {
        return 0.0;
    }
    let hsv = rgbToHsv(c);
    let dh = min(abs(hsv.x - hue), 1.0 - abs(hsv.x - hue));
    return (1.0 - smoothstep(0.03, 0.09, dh)) * smoothstep(0.25, 0.5, hsv.y);
}

// paper fibre (shared by the paper styles)
fn memPaper(pixel: vec2f, seed: f32) -> f32 {
    let fibre = valueNoise2(vec2f(pixel.x * 0.03, pixel.y * 0.5) + seed) * valueNoise2(vec2f(pixel.x * 0.5, pixel.y * 0.03) + seed * 2.0);
    let blot = vfbm2(pixel * 0.005 + seed, 3);
    return 0.93 + fibre * 0.08 + (blot - 0.5) * 0.05;
}

// --- 1 kage-e ------------------------------------------------------------------------------------------------

fn memKage(col: vec3f, geo: MemGeo, uv: vec2f, pixel: vec2f, aspect: f32, time: f32, seed: f32, keep: f32) -> vec3f {
    // the screen: warm paper lit from behind, brightest where the candle is, breathing
    let flame = 0.88 + 0.08 * valueNoise2(vec2f(time * 5.0, seed)) + 0.04 * valueNoise2(vec2f(time * 13.0, seed * 2.0));
    let toLamp = length(vec2f((uv.x - 0.5) * aspect, (uv.y - 0.42) * 1.3));
    var screen = mix(vec3f(1.0, 0.72, 0.38), vec3f(0.55, 0.28, 0.12), smoothstep(0.1, 0.9, toLamp)) * flame;
    screen = screen * memPaper(pixel, seed);
    // the screen's lattice frame, faint behind the paper
    let lat = max(1.0 - smoothstep(0.0, 0.004, abs(fract(uv.x * 4.0) - 0.5) - 0.497), 1.0 - smoothstep(0.0, 0.004, abs(fract(uv.y * 3.0) - 0.5) - 0.497));
    screen = screen * (1.0 - lat * 0.25);
    // scenery as cut paper: the scene's values cut into two shades of shadow, softer the further
    let v = luma(col);
    let far = smoothstep(15.0, 60.0, geo.depth);
    let cut1 = 1.0 - smoothstep(0.32, 0.36, v);
    let cut2 = 1.0 - smoothstep(0.16, 0.2, v);
    var c = screen;
    c = mix(c, c * mix(0.55, 0.8, far), cut1 * (1.0 - geo.isChar));
    c = mix(c, c * mix(0.25, 0.6, far), cut2 * (1.0 - geo.isChar));
    // the puppets: black, crisp, with holes punched for their eyes and patterns
    let punch = step(0.82, valueNoise2(pixel * 0.15 + seed)) * step(0.6, v) * 0.6;
    c = mix(c, vec3f(0.03, 0.02, 0.02) + screen * punch * 0.3, geo.isChar);
    // the rods that work them: thin lines down from each puppet's hands to the bottom of the screen
    let rodX = fract(uv.x * 7.0 + seed) - 0.5;
    let rod = (1.0 - smoothstep(0.0, 0.003, abs(rodX + (uv.y - 0.3) * 0.05))) * step(uv.y, 0.45) * step(0.55, hash11(floor(uv.x * 7.0 + seed)));
    c = mix(c, vec3f(0.05, 0.03, 0.02), rod * 0.7);
    // ink edges where scenery layers overlap
    c = mix(c, c * 0.4, geo.edge * (1.0 - geo.isChar) * 0.5);
    // the kept colour shows through as coloured paper
    c = mix(c, c * normalize(col + vec3f(0.01)) * 1.6, keep * 0.7);
    // the scorched edge of the screen
    let e = min(min(uv.x, 1.0 - uv.x) * aspect, min(uv.y, 1.0 - uv.y));
    let burnN = vfbm2(uv * vec2f(aspect, 1.0) * 5.0 + seed, 4);
    let burn = 1.0 - smoothstep(0.0, 0.06, e + (burnN - 0.5) * 0.05);
    c = mix(c, vec3f(0.08, 0.04, 0.02), smoothstep(0.3, 0.9, burn));
    c = c + vec3f(1.0, 0.45, 0.1) * (1.0 - smoothstep(0.0, 0.15, abs(burn - 0.3))) * 0.6 * flame;
    return c;
}

// --- 2 photograph -------------------------------------------------------------------------------------------

fn memPhoto(col: vec3f, uv: vec2f, pixel: vec2f, aspect: f32, time: f32, seed: f32, keep: f32) -> vec3f {
    // the print sits inside a white border with rounded, worn corners
    let border = 0.045;
    let q = (uv - 0.5) * vec2f(aspect, 1.0);
    let half = vec2f(aspect * 0.5 - border, 0.5 - border);
    let box = sdBox2(q, half - 0.02) - 0.02;
    let inside = 1.0 - smoothstep(0.0, 0.002, box);
    // sepia toning with a soft shoulder, the whites yellowed
    let v = luma(col);
    var c = mix(vec3f(0.12, 0.08, 0.05), vec3f(0.95, 0.86, 0.68), smoothstep(0.0, 1.0, v * 1.1));
    c = mix(c, col * 0.9 + vec3f(0.05, 0.03, 0.0), keep * 0.65);
    // silver mirroring: the dark parts near the edge turn a bluish metallic sheen
    let edgeDist = -box;
    let mirror = (1.0 - smoothstep(0.0, 0.12, edgeDist)) * (1.0 - smoothstep(0.2, 0.5, v));
    c = mix(c, vec3f(0.45, 0.5, 0.55), mirror * 0.5);
    // fading toward the edges, the emulsion's grain
    c = mix(c, vec3f(0.85, 0.78, 0.62), (1.0 - smoothstep(0.0, 0.25, edgeDist)) * 0.25);
    c = c * (0.94 + 0.12 * hash12(floor(pixel * 0.7) + floor(time * 12.0)));
    // a crease across the print: a pale line with a dark shadow beside it
    let creaseD = dot(q, normalize(vec2f(0.8, -0.6))) - 0.1 + seed * 0.1;
    c = mix(c, vec3f(0.97, 0.94, 0.86), (1.0 - smoothstep(0.0, 0.002, abs(creaseD))) * 0.7);
    c = c * (1.0 - (1.0 - smoothstep(0.0, 0.01, creaseD)) * step(0.0, creaseD) * 0.12);
    // dust specks and fine scratches
    let dust = step(0.997, hash12(floor(pixel * 0.5) + seed));
    let sx = q.x * 3.0 + q.y * 0.3 + seed;
    let scratch = (1.0 - smoothstep(0.0, 0.0015, abs(fract(sx) - 0.5))) * step(0.5, hash11(floor(sx))) * step(0.3, valueNoise2(vec2f(sx * 7.0, q.y * 6.0)));
    c = mix(c, vec3f(0.98, 0.95, 0.88), max(dust, scratch * 0.5));
    // the border: off-white card with a little shadow inside it
    let card = vec3f(0.93, 0.9, 0.82) * memPaper(pixel, seed + 3.0);
    let shadowIn = (1.0 - smoothstep(0.0, 0.012, abs(box))) * 0.25;
    return mix(card * (1.0 - shadowIn), c, inside);
}

// --- 3 watercolour ------------------------------------------------------------------------------------------

fn memWatercolor(src: texture_2d<f32>, ss: sampler, uv: vec2f, pixel: vec2f, px: vec2f, geo: MemGeo, time: f32, seed: f32, keep: f32) -> vec3f {
    // colour bleeds: the frame sampled through a slowly drifting, wet distortion
    let wet = vec2f(vfbm2(uv * 6.0 + seed, 3), vfbm2(uv * 6.0 + seed + 4.1, 3)) - 0.5;
    let b0 = textureSampleLevel(src, ss, uv + wet * px * 18.0, 0.0).rgb;
    let b1 = textureSampleLevel(src, ss, uv + wet * px * 36.0 + vec2f(px.x * 6.0, 0.0), 0.0).rgb;
    var c = mix(b0, b1, 0.4);
    // washes: values in four soft bands, saturation lifted then softened like diluted pigment
    let v = luma(c);
    let band = floor(v * 4.0 + vfbm2(uv * 9.0 + seed, 2) * 0.6) / 4.0;
    c = mix(c, c * (0.75 + band * 0.4), 0.6);
    c = mix(vec3f(luma(c)), c, 0.8 + keep * 0.6);
    // pigment gathers at the wet edges of the washes (a darker rim along value changes)
    let vx = luma(textureSampleLevel(src, ss, uv + vec2f(px.x * 3.0, 0.0), 0.0).rgb);
    let vy = luma(textureSampleLevel(src, ss, uv + vec2f(0.0, px.y * 3.0), 0.0).rgb);
    let rim = clamp((abs(v - vx) + abs(v - vy)) * 3.0, 0.0, 1.0);
    c = c * (1.0 - rim * 0.35);
    // granulation in the paper's tooth, blooms where water ran back into a drying wash
    let tooth = valueNoise2(pixel * 0.6 + seed) * 0.6 + valueNoise2(pixel * 0.2) * 0.4;
    c = c * (0.9 + 0.2 * tooth);
    let bloom = worley2(uv * 7.0 + seed * 3.0, 1.0);
    let cauli = (1.0 - smoothstep(0.0, 0.03, bloom.edge)) * step(0.7, bloom.id.x);
    c = mix(c, c * 0.8, cauli * 0.5);
    // a light pencil line under the paint on the figures
    c = mix(c, c * 0.65, geo.edge * geo.isChar * 0.5);
    // the white of the paper shows where the wash thins toward the edge of the sheet
    let paper = vec3f(0.97, 0.95, 0.9) * memPaper(pixel, seed);
    let e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    let reach = smoothstep(0.02, 0.12, e + (vfbm2(uv * 5.0 + seed, 3) - 0.5) * 0.1);
    c = mix(paper, c * paper, reach);
    return c;
}

// --- 4 crayon -----------------------------------------------------------------------------------------------

// the closest of a child's box of crayons
fn crayonColor(c: vec3f) -> vec3f {
    let pal = array<vec3f, 8>(
        vec3f(0.85, 0.15, 0.12), vec3f(0.98, 0.6, 0.12), vec3f(0.98, 0.85, 0.2), vec3f(0.3, 0.7, 0.25),
        vec3f(0.2, 0.45, 0.85), vec3f(0.55, 0.3, 0.7), vec3f(0.45, 0.3, 0.2), vec3f(0.15, 0.15, 0.18));
    var best = pal[0];
    var bd = 1e9;
    for (var i = 0; i < 8; i++) {
        let d = distance(normalize(c + vec3f(0.02)), normalize(pal[i])) + abs(luma(c) - luma(pal[i])) * 0.8;
        if (d < bd) {
            bd = d;
            best = pal[i];
        }
    }
    return best;
}

fn memCrayon(col: vec3f, geo: MemGeo, uv: vec2f, pixel: vec2f, aspect: f32, time: f32, seed: f32) -> vec3f {
    let paper = vec3f(0.98, 0.97, 0.93) * (0.97 + 0.03 * valueNoise2(pixel * 0.3));
    // wax strokes: diagonal scribbles whose direction changes from region to region
    let region = floor(uv * vec2f(aspect, 1.0) * 5.0);
    let ang = hash12(region + seed) * PI;
    let q = rotate2(pixel, ang);
    let stroke = valueNoise2(vec2f(q.x * 0.35, q.y * 0.025) + seed);
    // wax skips over the paper's grain
    let grain = valueNoise2(pixel * 0.9 + seed * 5.0);
    let v = luma(col);
    let pressure = clamp(1.1 - v * 0.9, 0.2, 1.0);
    let cover = smoothstep(0.3, 0.5, stroke * pressure + 0.3) * smoothstep(0.15, 0.4, grain);
    let crayon = crayonColor(col);
    var c = mix(paper, crayon, cover * 0.9);
    // a sky band at the top of the page, a green strip for the ground (as children draw them)
    let sky = smoothstep(0.82, 0.9, uv.y) * (1.0 - geo.isChar) * step(30.0, geo.depth);
    c = mix(c, mix(paper, vec3f(0.25, 0.5, 0.95), smoothstep(0.3, 0.5, stroke) * 0.85), sky);
    // wobbly dark outlines round everything
    let wob = geo.edge * smoothstep(0.3, 0.6, valueNoise2(pixel * 0.25 + floor(time * 4.0)));
    c = mix(c, vec3f(0.12, 0.1, 0.12), wob * 0.9);
    return c;
}

// --- 5 stained glass ----------------------------------------------------------------------------------------

fn memGlass(src: texture_2d<f32>, ss: sampler, uv: vec2f, pixel: vec2f, aspect: f32, geo: MemGeo, time: f32, seed: f32, keep: f32) -> vec3f {
    // panes: Voronoi cells, smaller over the people
    let p = vec2f(uv.x * aspect, uv.y);
    let scale = mix(16.0, 34.0, geo.isChar);
    let w = worley2(p * scale + seed * 7.0, 0.9);
    // each pane takes one colour: the frame sampled at the pane's centre, made glassy and saturated
    let centre = (p * scale + seed * 7.0 + w.nearest) / scale;
    let cuv = vec2f(centre.x / aspect, centre.y);
    var pane = textureSampleLevel(src, ss, cuv, 0.0).rgb;
    let hsv = rgbToHsv(pane);
    pane = hsvToRgb(vec3f(hsv.x, clamp(hsv.y * 1.2 + 0.1, 0.0, 1.0), clamp(hsv.z * 1.15 + 0.05, 0.0, 1.0)));
    pane = mix(pane, pane * 1.3, keep);
    // light glowing through the glass: brighter in the middle of a pane, streaks of the glass's
    // own unevenness
    let glow = 0.75 + 0.35 * (1.0 - smoothstep(0.0, 0.5, w.f1 * scale * 0.4));
    let streak = 0.9 + 0.2 * valueNoise2(vec2f(p.x * 40.0, p.y * 4.0) + w.id * 10.0);
    var c = pane * glow * streak;
    // people's panes darker and richer
    c = mix(c, c * 0.75, geo.isChar * 0.4);
    // the lead: black lines between panes and along the figures' outlines
    let lead = max(1.0 - smoothstep(0.0, 0.012 * 16.0 / scale, w.edge), smoothstep(0.4, 0.7, geo.edge));
    c = mix(c, vec3f(0.03, 0.03, 0.035), lead);
    // a little highlight on the lead
    c = c + vec3f(0.25) * (1.0 - smoothstep(0.0, 0.004, abs(w.edge - 0.006))) * 0.3;
    return c;
}

// --- 6 woodblock --------------------------------------------------------------------------------------------

// the printer's palette: indigo, vermilion, ochre, a sage green, a pale flesh, black, paper
fn woodblockColor(c: vec3f) -> vec3f {
    let pal = array<vec3f, 7>(
        vec3f(0.16, 0.22, 0.4), vec3f(0.78, 0.25, 0.15), vec3f(0.82, 0.62, 0.28), vec3f(0.45, 0.55, 0.38),
        vec3f(0.93, 0.82, 0.7), vec3f(0.1, 0.09, 0.09), vec3f(0.95, 0.92, 0.84));
    var best = pal[0];
    var bd = 1e9;
    let lc = linearToOklab(max(c, vec3f(0.0)));
    for (var i = 0; i < 7; i++) {
        let d = distance(lc, linearToOklab(pal[i]));
        if (d < bd) {
            bd = d;
            best = pal[i];
        }
    }
    return best;
}

fn memWoodblock(src: texture_2d<f32>, ss: sampler, uv: vec2f, pixel: vec2f, px: vec2f, geo: MemGeo, seed: f32, keep: f32) -> vec3f {
    // colour blocks printed a little out of register with the keyblock
    let off = vec2f(px.x * 2.5, -px.y * 1.5);
    let blk = textureSampleLevel(src, ss, uv + off, 0.0).rgb;
    var c = woodblockColor(blk);
    c = mix(c, blk * 1.1, keep * 0.6);
    // bokashi: the sky graded from indigo at the top to paper at the horizon
    let sky = step(200.0, geo.depth);
    let grad = smoothstep(0.55, 0.95, uv.y);
    c = mix(c, mix(vec3f(0.95, 0.92, 0.84), vec3f(0.16, 0.22, 0.45), grad), sky);
    // the woodgrain of the block shows in the flat colour
    let grain = valueNoise2(vec2f(pixel.x * 0.02, pixel.y * 0.4) + seed);
    c = c * (0.94 + 0.08 * grain);
    // paper: unprinted fibres speckle through
    let speck = step(0.93, valueNoise2(pixel * 0.8 + seed * 3.0));
    c = mix(c, vec3f(0.95, 0.92, 0.84), speck * 0.4);
    // the keyblock line: black, of varying weight
    let key = smoothstep(0.35, 0.6, geo.edge);
    c = mix(c, vec3f(0.08, 0.07, 0.07), key);
    return c * memPaper(pixel, seed);
}

// --- 7 home movie ---------------------------------------------------------------------------------------------
//
// An 8 mm home movie: the frame jitters in the gate, the colour faded to warm magentas and creams,
// heavy grain, the corners burnt dark, sprocket holes down one side, a light leak licking in from an
// edge, the odd hair caught in the gate, and the frame rate stuttering like a hand-cranked camera.

fn memFilmGate(uv: vec2f, time: f32, seed: f32) -> vec2f {
    // a jitter that changes eighteen times a second (the frame rate of home film)
    let f = floor(time * 18.0);
    let j = (hash22(vec2f(f, seed)) - 0.5) * vec2f(0.004, 0.008);
    // now and then the frame slips in the gate
    let slip = step(0.97, hash11(f * 1.3 + seed)) * 0.03;
    return uv + j + vec2f(0.0, slip);
}

fn memHomeMovie(src: texture_2d<f32>, ss: sampler, uv: vec2f, pixel: vec2f, aspect: f32, time: f32, seed: f32, keep: f32) -> vec3f {
    let guv = memFilmGate(uv, time, seed);
    var c = textureSampleLevel(src, ss, guv, 0.0).rgb;
    // faded stock: the blues gone, magenta in the shadows, cream highlights
    let l = luma(c);
    var faded = mix(vec3f(0.25, 0.12, 0.18), vec3f(1.0, 0.92, 0.75), smoothstep(0.05, 0.95, l));
    faded = mix(faded, c * vec3f(1.1, 0.95, 0.75), 0.35 + keep * 0.4);
    c = faded;
    // grain, changing every frame of the film
    let f = floor(time * 18.0);
    let g = hash12(floor(pixel * 0.6) + vec2f(f * 13.1, f * 7.7)) - 0.5;
    c = c * (1.0 + g * 0.22);
    // the gate's burnt corners and a soft vignette
    let q = (uv - 0.5) * vec2f(aspect, 1.0);
    let corner = smoothstep(0.35, 0.95, length(q * vec2f(0.85, 1.2)));
    c = c * (1.0 - corner * 0.75);
    // a light leak from the right edge, breathing
    let leak = smoothstep(0.6, 1.0, uv.x) * (0.5 + 0.5 * sin(time * 0.7 + seed * 6.0)) * (0.6 + 0.4 * valueNoise2(vec2f(uv.y * 3.0, time * 0.3)));
    c = c + vec3f(1.0, 0.35, 0.1) * leak * 0.35;
    // sprocket holes down the left side, rolling with the film
    let sx = uv.x * aspect;
    let sy = fract(guv.y * 4.0 + time * 0.0);
    let hole = step(sx, 0.07) * step(0.02, sx) * (1.0 - smoothstep(0.0, 0.02, abs(sy - 0.5) - 0.12));
    let strip = step(sx, 0.09);
    c = mix(c, vec3f(0.08, 0.05, 0.04), strip * 0.9);
    c = mix(c, vec3f(0.95, 0.9, 0.8), hole);
    // a hair caught in the gate, now and then
    let hairOn = step(0.7, hash11(floor(time * 0.4) + seed));
    let hx = 0.75 + hash11(floor(time * 0.4) + seed * 2.0) * 0.2;
    let hairD = abs(uv.x - hx - sin(uv.y * 9.0 + seed) * 0.01);
    c = mix(c, vec3f(0.05), (1.0 - smoothstep(0.0, 0.0012, hairD)) * hairOn * step(0.3, uv.y));
    // the flicker of the projector
    c = c * (0.94 + 0.06 * hash11(f * 3.3 + seed));
    return c;
}

// --- 8 charcoal -----------------------------------------------------------------------------------------------
//
// A charcoal study: the values laid in with the side of the stick (broad, grainy strokes following
// the forms), smudged with a thumb into soft greys, the darks pressed in hard, lines dragged along
// the edges, highlights lifted out with a kneaded eraser, all on rough toned paper.

fn memCharcoal(src: texture_2d<f32>, ss: sampler, uv: vec2f, pixel: vec2f, px: vec2f, geo: MemGeo, time: f32, seed: f32) -> vec3f {
    // smudged values: the frame blurred a little (the thumb)
    var v = 0.0;
    for (var i = 0; i < 6; i++) {
        let a = f32(i) / 6.0 * TAU;
        v = v + luma(textureSampleLevel(src, ss, uv + vec2f(cos(a), sin(a)) * px * 3.5, 0.0).rgb);
    }
    v = v / 6.0;
    let tone = clamp(1.0 - v * 1.3, 0.0, 1.0);
    // the stick's grain: broad strokes, their direction following the value's slope
    let vx = luma(textureSampleLevel(src, ss, uv + vec2f(px.x * 4.0, 0.0), 0.0).rgb) - v;
    let vy = luma(textureSampleLevel(src, ss, uv + vec2f(0.0, px.y * 4.0), 0.0).rgb) - v;
    let ang = atan2(vy, vx) + PI * 0.5;
    let q = rotate2(pixel, ang);
    let stroke = valueNoise2(vec2f(q.x * 0.05, q.y * 0.5) + seed) * 0.6 + valueNoise2(pixel * 0.9 + seed) * 0.4;
    // paper tooth catches the charcoal on its peaks
    let tooth = valueNoise2(pixel * 0.7 + seed * 3.0);
    var cover = smoothstep(0.2, 0.9, tone + (stroke - 0.5) * 0.5) * mix(0.6, 1.0, step(0.4, tooth));
    // darks pressed in hard
    cover = max(cover, smoothstep(0.75, 0.95, tone));
    // highlights lifted out with an eraser: clean strokes of paper
    let lift = smoothstep(0.82, 0.95, v) * step(0.5, valueNoise2(vec2f(q.x * 0.02, q.y * 0.3) + seed * 2.0));
    cover = cover * (1.0 - lift);
    // lines dragged along the edges
    cover = max(cover, smoothstep(0.4, 0.8, geo.edge) * 0.85);
    let paper = vec3f(0.86, 0.82, 0.74) * (0.95 + 0.08 * tooth);
    let charcoal = vec3f(0.08, 0.075, 0.08);
    return mix(paper, charcoal, cover);
}
