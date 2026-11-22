// ============================================================================================
// vb_patterns: procedural surface patterns for the stages, painted in a stylized way (flat
// colour variation, crisp joints, a little hand-made irregularity) rather than photo textures.
// Each pattern takes 2D coordinates in metres and returns a PatternOut.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_sdf2d.
// ============================================================================================

struct PatternOut {
    tint: vec3f,      // multiplier on the painted base colour
    height: f32,      // 0..1 relief (used for normal bending and as a cavity mask)
    gloss: f32,       // 0..1 how glossy (wet stone, glazed tile, lacquer)
    emissive: vec3f,  // light emitted (windows, neon, lanterns)
    line: f32,        // 0..1 drawn joint lines (grout, mortar, plank seams) for the ink pass
}

fn patternDefault() -> PatternOut {
    var o: PatternOut;
    o.tint = vec3f(1.0);
    o.height = 0.5;
    o.gloss = 0.0;
    o.emissive = vec3f(0.0);
    o.line = 0.0;
    return o;
}

// --- masonry ---------------------------------------------------------------------------------------

// running-bond bricks: size (w, h) in metres, mortar width in metres
fn patternBrick(p: vec2f, size: vec2f, mortar: f32) -> PatternOut {
    var o = patternDefault();
    var q = p / size;
    let row = floor(q.y);
    q.x = q.x + 0.5 * fmod1(row, 2.0);
    let cell = floor(q);
    let f = fract(q);
    let edge = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
    let m = 1.0 - smoothstep(mortar * 0.5, mortar * 0.5 + 0.004, edge);
    let h = ihash22(vec2i(cell));
    let brickTint = vec3f(0.85 + h.x * 0.25, 0.85 + h.x * 0.18, 0.85 + h.y * 0.15);
    let grime = vfbm2(p * 1.4, 3);
    let chip = smoothstep(0.72, 0.8, valueNoise2(p * 9.0 + h * 10.0));
    o.tint = mix(brickTint * (0.85 + grime * 0.3) * (1.0 - chip * 0.15), vec3f(0.72, 0.7, 0.66), m);
    o.height = (1.0 - m) * (0.8 + grime * 0.2) - chip * 0.2;
    o.line = m;
    return o;
}

// dressed stone blocks with irregular widths (castle walls, shrine foundations)
fn patternStoneBlocks(p: vec2f, rowH: f32, joint: f32) -> PatternOut {
    var o = patternDefault();
    let row = floor(p.y / rowH);
    let hr = hash11(row * 1.37);
    let w = rowH * (1.4 + hr * 1.2);
    let x = p.x + hr * 5.0;
    let col = floor(x / w);
    let fx = fract(x / w);
    let fy = fract(p.y / rowH);
    let edge = min(min(fx, 1.0 - fx) * w, min(fy, 1.0 - fy) * rowH);
    let m = 1.0 - smoothstep(joint * 0.5, joint * 0.5 + 0.006, edge);
    let h = ihash21(vec2i(i32(col), i32(row)));
    let lichen = smoothstep(0.55, 0.75, vfbm2(p * 0.8, 4));
    let face = 0.82 + h * 0.22 + (valueNoise2(p * 5.0) - 0.5) * 0.08;
    o.tint = mix(vec3f(face) * mix(vec3f(1.0), vec3f(0.8, 0.95, 0.7), lichen * 0.5), vec3f(0.55), m);
    o.height = (1.0 - m) * smoothstep(0.0, joint * 3.0, edge);
    o.line = m;
    return o;
}

// round cobbles from voronoi cells
fn patternCobbles(p: vec2f, scale: f32) -> PatternOut {
    var o = patternDefault();
    let c = worley2(p * scale, 0.85);
    let stone = smoothstep(0.03, 0.12, c.edge);
    let shade = 0.75 + c.id.x * 0.35;
    o.tint = mix(vec3f(0.45, 0.43, 0.4), vec3f(shade, shade * 0.98, shade * 0.95), stone);
    o.height = stone * (1.0 - c.f1 * 0.6);
    o.gloss = stone * 0.25;
    o.line = 1.0 - smoothstep(0.02, 0.05, c.edge);
    return o;
}

// --- tile -------------------------------------------------------------------------------------------

fn patternTile(p: vec2f, size: f32, grout: f32, glaze: f32) -> PatternOut {
    var o = patternDefault();
    let q = p / size;
    let cell = floor(q);
    let f = fract(q);
    let edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * size;
    let g = 1.0 - smoothstep(grout * 0.5, grout * 0.5 + 0.002, edge);
    let h = ihash21(vec2i(cell));
    let crack = crackle2(p * 3.0 + h * 10.0, 0.02) * step(0.93, h);
    o.tint = mix(vec3f(0.94 + h * 0.08) * (1.0 - crack * 0.4), vec3f(0.6, 0.6, 0.62), g);
    o.height = 1.0 - g;
    o.gloss = (1.0 - g) * glaze;
    o.line = g;
    return o;
}

// station wall tiles: small rectangles in a stack bond with a coloured band
fn patternStationTile(p: vec2f, bandY: f32, bandCol: vec3f) -> PatternOut {
    var o = patternTile(vec2f(p.x * 0.5, p.y), 0.075, 0.004, 0.7);
    let band = step(bandY, p.y) * step(p.y, bandY + 0.3);
    o.tint = mix(o.tint, o.tint * bandCol, band * (1.0 - o.line));
    return o;
}

// --- wood -------------------------------------------------------------------------------------------

fn woodGrain(p: vec2f, seed: f32) -> f32 {
    let warp = fbm2(vec2f(p.x * 0.6, p.y * 6.0) + seed, 3, 2.0, 0.5) * 0.25;
    let rings = fract((p.y + warp) * 18.0 + seed * 7.0);
    let ringLine = smoothstep(0.0, 0.15, rings) * (1.0 - smoothstep(0.75, 1.0, rings));
    let streak = valueNoise2(vec2f(p.x * 1.5, p.y * 60.0 + seed));
    return clamp(ringLine * 0.6 + streak * 0.4, 0.0, 1.0);
}

// planks along x: width in metres, plank ends staggered
fn patternPlanks(p: vec2f, width: f32, length: f32) -> PatternOut {
    var o = patternDefault();
    let row = floor(p.y / width);
    let off = hash11(row * 3.1) * length;
    let col = floor((p.x + off) / length);
    let fy = fract(p.y / width);
    let fx = fract((p.x + off) / length);
    let seam = max(1.0 - smoothstep(0.0, 0.012 / width, min(fy, 1.0 - fy)), 1.0 - smoothstep(0.0, 0.006 / length, min(fx, 1.0 - fx)));
    let h = ihash21(vec2i(i32(col), i32(row)));
    let grain = woodGrain(vec2f(p.x * 0.4, fy * width), h * 10.0);
    let tone = 0.78 + h * 0.3;
    o.tint = mix(vec3f(tone) * (0.85 + grain * 0.25), vec3f(0.35, 0.3, 0.27), seam);
    o.height = (1.0 - seam) * (0.9 + grain * 0.1);
    o.gloss = 0.15 * (1.0 - seam);
    o.line = seam;
    return o;
}

// end-grain / bark for posts and logs (p.x around the circumference, p.y along)
fn patternBark(p: vec2f) -> PatternOut {
    var o = patternDefault();
    let furrows = ridged2(vec2f(p.x * 6.0, p.y * 1.2), 4, 2.0, 0.5, 1.0);
    o.tint = vec3f(0.7 + furrows * 0.4);
    o.height = furrows;
    o.line = smoothstep(0.25, 0.1, furrows) * 0.5;
    return o;
}

// --- Japanese interiors -----------------------------------------------------------------------------------

// shoji: a lattice of thin wooden bars over glowing paper (emissive when lit from behind)
fn patternShoji(p: vec2f, cell: vec2f, glow: vec3f) -> PatternOut {
    var o = patternDefault();
    let q = p / cell;
    let f = fract(q);
    let bar = 0.035 / cell;
    let frame = max(1.0 - step(bar.x, min(f.x, 1.0 - f.x)), 1.0 - step(bar.y, min(f.y, 1.0 - f.y)));
    let fibres = paperGrain(p * 6.0);
    o.tint = mix(vec3f(0.98, 0.95, 0.86) * (0.92 + fibres * 0.1), vec3f(0.42, 0.3, 0.22), frame);
    o.emissive = glow * (1.0 - frame) * (0.85 + fibres * 0.15);
    o.height = frame;
    o.line = frame * 0.6;
    return o;
}

// tatami: woven rush in long mats with dark cloth borders
fn patternTatami(p: vec2f) -> PatternOut {
    var o = patternDefault();
    let mat = vec2f(1.82, 0.91);
    let q = p / mat;
    let f = fract(q);
    let border = 1.0 - step(0.05 / 0.91, min(f.y, 1.0 - f.y));
    let weave = 0.5 + 0.5 * sin(p.x * 220.0) * (0.6 + 0.4 * sin(p.y * 40.0));
    let h = ihash21(vec2i(floor(q)));
    o.tint = mix(vec3f(0.86 + h * 0.06, 0.88, 0.62) * (0.92 + weave * 0.1), vec3f(0.18, 0.2, 0.16), border);
    o.height = 1.0 - border * 0.5;
    o.line = border * 0.4;
    return o;
}

// kawara roof tiles: rows of half-round tiles with dark gaps between
fn patternRoofTiles(p: vec2f, pitch: f32) -> PatternOut {
    var o = patternDefault();
    let col = p.x / pitch;
    let f = fract(col);
    let round = sqrt(max(1.0 - sqr(f * 2.0 - 1.0), 0.0));
    let row = fract(p.y / 0.32);
    let lip = smoothstep(0.85, 0.95, row);
    let gap = 1.0 - smoothstep(0.0, 0.08, min(f, 1.0 - f));
    let h = ihash21(vec2i(i32(floor(col)), i32(floor(p.y / 0.32))));
    o.tint = vec3f(0.85 + h * 0.15) * (0.75 + round * 0.3) * (1.0 - lip * 0.35) * (1.0 - gap * 0.6);
    o.height = round * (1.0 - lip * 0.5);
    o.gloss = 0.35 * round;
    o.line = max(gap, lip) * 0.7;
    return o;
}

// --- streets ------------------------------------------------------------------------------------------------

fn patternAsphalt(p: vec2f, wet: f32) -> PatternOut {
    var o = patternDefault();
    let n = vfbm2(p * 0.7, 4);
    let speck = step(0.86, valueNoise2(p * 38.0)) * 0.35;
    let cracks = crackle2(p * 0.6, 0.015) * smoothstep(0.55, 0.7, vfbm2(p * 0.3 + 4.0, 3));
    let repair = smoothstep(0.6, 0.62, vfbm2(p * 0.12 + 9.0, 3)) * 0.12;
    o.tint = vec3f(0.85 + n * 0.25 + speck - repair) * (1.0 - cracks * 0.5);
    o.height = 0.5 + n * 0.3 - cracks * 0.4;
    o.gloss = wet * (0.6 + n * 0.3);
    o.line = cracks * 0.6;
    return o;
}

// painted road markings: dashed centre line and a crossing (zebra) along x
fn roadMarkings(p: vec2f, laneW: f32) -> f32 {
    let centre = step(abs(p.y), 0.06) * step(0.5, fract(p.x / 3.0));
    let zebra = step(abs(p.x), 2.5) * step(0.5, fract(p.y / 0.9)) * step(abs(p.y), laneW * 2.0);
    let wear = smoothstep(0.3, 0.6, valueNoise2(p * 3.0));
    return max(centre, zebra) * wear;
}

fn patternConcrete(p: vec2f, panel: f32) -> PatternOut {
    var o = patternDefault();
    let q = p / panel;
    let f = fract(q);
    let joint = 1.0 - smoothstep(0.0, 0.008 / panel, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    let stains = vfbm2(p * vec2f(0.6, 0.25), 4);
    let drips = smoothstep(0.6, 0.85, valueNoise2(vec2f(p.x * 6.0, p.y * 0.3))) * smoothstep(0.0, 0.6, f.y);
    let ties = step(length(fract(q * 3.0) - 0.5), 0.05) * 0.4;
    o.tint = vec3f(0.92 + stains * 0.15 - drips * 0.1 - ties) * (1.0 - joint * 0.35);
    o.height = 0.6 + stains * 0.2 - joint * 0.5 - ties;
    o.line = joint * 0.7;
    return o;
}

fn patternPlaster(p: vec2f) -> PatternOut {
    var o = patternDefault();
    let n = vfbm2(p * 1.5, 4);
    let flake = smoothstep(0.78, 0.8, vfbm2(p * 2.2 + 7.0, 3));
    o.tint = vec3f(0.95 + n * 0.08) * (1.0 - flake * 0.25);
    o.height = 0.5 + n * 0.1 - flake * 0.4;
    o.line = flake * smoothstep(0.8, 0.79, vfbm2(p * 2.2 + 7.0, 3)) * 0.0;
    return o;
}

// corrugated / riveted metal (shutters, a vending machine's flanks, the train)
fn patternMetalPanel(p: vec2f, corrugated: f32) -> PatternOut {
    var o = patternDefault();
    let corr = 0.5 + 0.5 * sin(p.y * 40.0);
    let panel = fract(p / vec2f(1.2, 0.8));
    let seam = 1.0 - smoothstep(0.0, 0.01, min(min(panel.x, 1.0 - panel.x), min(panel.y, 1.0 - panel.y)));
    let rivet = 1.0 - smoothstep(0.008, 0.012, length(fract(p * vec2f(10.0, 1.25)) - 0.5) * 0.08);
    let rust = smoothstep(0.62, 0.8, vfbm2(p * 0.9, 4));
    o.tint = mix(vec3f(0.9 + corr * corrugated * 0.15), vec3f(0.7, 0.42, 0.28), rust) * (1.0 - seam * 0.4);
    o.height = mix(0.5, corr, corrugated) + rivet * 0.3 - seam * 0.3;
    o.gloss = (1.0 - rust) * 0.5;
    o.line = seam * 0.6;
    return o;
}

// --- nature --------------------------------------------------------------------------------------------------

fn patternGrass(p: vec2f) -> PatternOut {
    var o = patternDefault();
    let clumps = vfbm2(p * 0.5, 4);
    let blades = valueNoise2(vec2f(p.x * 30.0, p.y * 30.0));
    let flowers = step(0.94, valueNoise2(p * 6.0)) * step(0.6, clumps);
    o.tint = vec3f(0.8 + clumps * 0.35 + blades * 0.08);
    o.tint = mix(o.tint, vec3f(2.2, 2.0, 2.3), flowers);
    o.height = clumps;
    return o;
}

fn patternDirt(p: vec2f) -> PatternOut {
    var o = patternDefault();
    let n = vfbm2(p * 0.8, 4);
    let pebbles = smoothstep(0.08, 0.02, worley2(p * 7.0, 1.0).f1) * 0.3;
    o.tint = vec3f(0.85 + n * 0.25 + pebbles);
    o.height = n + pebbles;
    return o;
}

fn patternSand(p: vec2f) -> PatternOut {
    var o = patternDefault();
    let ripples = 0.5 + 0.5 * sin(p.x * 6.0 + fbm2(p * 0.4, 3, 2.0, 0.5) * 6.0);
    let n = valueNoise2(p * 25.0);
    o.tint = vec3f(0.92 + ripples * 0.1 + n * 0.05);
    o.height = ripples;
    return o;
}

fn patternGravel(p: vec2f) -> PatternOut {
    var o = patternDefault();
    let c = worley2(p * 14.0, 1.0);
    let stone = smoothstep(0.02, 0.08, c.edge);
    o.tint = mix(vec3f(0.55), vec3f(0.8 + c.id.x * 0.35), stone);
    o.height = stone * (1.0 - c.f1);
    return o;
}

// raked zen garden gravel: concentric/parallel grooves
fn patternRakedGravel(p: vec2f, center: vec2f) -> PatternOut {
    var o = patternGravel(p);
    let r = length(p - center);
    let grooves = 0.5 + 0.5 * cos(r * 30.0);
    o.tint = o.tint * (0.85 + grooves * 0.2);
    o.height = o.height * 0.5 + grooves * 0.5;
    return o;
}

// --- emissive patterns ---------------------------------------------------------------------------------------

// office / apartment windows on a facade: a grid, some lit with warm or cool light, some with
// curtains, a few flickering
fn patternWindows(p: vec2f, cell: vec2f, litRatio: f32, time: f32) -> PatternOut {
    var o = patternDefault();
    let q = p / cell;
    let id = floor(q);
    let f = fract(q);
    let h = ihash22(vec2i(id));
    let win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.85);
    let lit = step(1.0 - litRatio, h.x);
    let warm = mix(vec3f(1.0, 0.72, 0.4), vec3f(0.65, 0.85, 1.0), step(0.7, h.y));
    let curtain = step(0.5, fract(f.x * 3.0 + h.y)) * step(0.6, h.y) * 0.4;
    let flicker = select(1.0, 0.6 + 0.4 * step(0.5, valueNoise2(vec2f(time * 8.0, h.x * 100.0))), h.y > 0.95);
    o.tint = mix(vec3f(1.0), vec3f(0.25, 0.28, 0.35), win);
    o.emissive = warm * win * lit * (1.0 - curtain) * flicker * (0.8 + h.y * 0.6);
    o.gloss = win * 0.6;
    o.line = (1.0 - win) * step(abs(f.x - 0.5), 0.33) * step(abs(f.y - 0.53), 0.33) * 0.0;
    return o;
}

// a neon sign panel: glowing tubes tracing a seeded glyph, buzzing on and off
fn patternNeon(p: vec2f, col: vec3f, seed: f32, time: f32) -> PatternOut {
    var o = patternDefault();
    let d = sdGlyph(p * 2.0 - 1.0, seed);
    let tube = 1.0 - smoothstep(0.0, 0.03, abs(d) - 0.02);
    let halo = exp(-max(abs(d), 0.0) * 18.0) * 0.5;
    let buzz = select(1.0, step(0.25, valueNoise2(vec2f(time * 12.0, seed))), hash11(seed) > 0.75);
    o.tint = vec3f(0.12);
    o.emissive = col * (tube * 3.0 + halo) * buzz;
    o.line = 0.0;
    return o;
}

// paper lantern skin: glowing paper between bamboo ribs, with a painted band
fn patternLanternPaper(p: vec2f, glow: vec3f, flicker: f32) -> PatternOut {
    var o = patternDefault();
    let rib = 1.0 - smoothstep(0.0, 0.08, abs(fract(p.y * 8.0) - 0.5) * 2.0 - 0.85);
    let band = step(abs(p.y - 0.5), 0.12);
    o.tint = mix(vec3f(1.0, 0.95, 0.85), vec3f(0.9, 0.15, 0.1), band) * (1.0 - rib * 0.3);
    o.emissive = glow * (1.0 - rib * 0.5) * mix(1.0, 0.35, band) * flicker;
    return o;
}

// charred wood with glowing embers in the cracks (the burning apartment)
fn patternCharred(p: vec2f, time: f32, heat: f32) -> PatternOut {
    var o = patternDefault();
    let c = worley2(p * vec2f(3.0, 8.0), 1.0);
    let crack = 1.0 - smoothstep(0.0, 0.05, c.edge);
    let pulse = 0.6 + 0.4 * sin(time * 2.0 + c.id.x * 20.0);
    o.tint = vec3f(0.08 + c.id.y * 0.06);
    o.height = 1.0 - crack;
    o.emissive = blackbody(1400.0 + heat * 900.0) * crack * pulse * heat * 4.0;
    o.line = crack * 0.3;
    return o;
}

// --- cloth -----------------------------------------------------------------------------------------------------

fn patternFabric(p: vec2f, weave: f32) -> PatternOut {
    var o = patternDefault();
    let a = 0.5 + 0.5 * sin(p.x * weave);
    let b = 0.5 + 0.5 * sin(p.y * weave);
    let over = step(0.5, fract(floor(p.x * weave / PI) * 0.5 + floor(p.y * weave / PI) * 0.5));
    o.tint = vec3f(0.92 + mix(a, b, over) * 0.08);
    o.height = mix(a, b, over);
    return o;
}

// one jagged crack from the origin along angle `ang`, `len` long: returns (mask, core, along 0..1)
// The path wanders by low-frequency noise along its length, splits into finer steps by a second
// octave, and narrows from the root to a hairline at the tip.
fn crackRay(q: vec2f, ang: f32, len: f32, width: f32, seed: f32) -> vec3f {
    let dir = vec2f(cos(ang), sin(ang));
    let side = vec2f(-dir.y, dir.x);
    let along = dot(q, dir);
    if (along < 0.0 || along > len) {
        return vec3f(0.0);
    }
    let t = along / len;
    // the path: two octaves of wander, growing with distance from the root
    let wander = (valueNoise2(vec2f(along * 1.3, seed)) - 0.5) * 0.9 + (valueNoise2(vec2f(along * 5.0, seed + 3.1)) - 0.5) * 0.22;
    let off = dot(q, side) - wander * len * 0.22 * t;
    let w = width * mix(1.0, 0.12, t * t);
    let mask = 1.0 - smoothstep(w * 0.5, w, abs(off));
    let core = 1.0 - smoothstep(0.0, w * 0.35, abs(off));
    return vec3f(mask, core, t);
}

// overlay: cracks with a glowing core (damage decals on the arena floor)
// A crater of crazed fragments at the impact, scorch fading out from it, six to nine main fissures
// running out with a side branch each, all glowing from inside with the technique's colour,
// brightest near the impact. Returns (glow rgb, darkening mask).
fn crackOverlay(p: vec2f, center: vec2f, radius: f32, glowCol: vec3f) -> vec4f {
    let q = p - center;
    let d = length(q);
    if (d > radius * 1.05 || radius <= 0.0) {
        return vec4f(0.0);
    }
    let seed = hash12(floor(center * 7.0)) * 100.0;
    let count = 6.0 + floor(hash11(seed) * 4.0);
    let a = atan2(q.y, q.x);
    let sector = floor((a + PI) / TAU * count);
    var mask = 0.0;
    var core = 0.0;
    // the crack in this sector and its two neighbours (so none is cut at a sector edge)
    for (var k = -1; k <= 1; k++) {
        let s = sector + f32(k);
        let sid = s - count * floor(s / count);
        let h = hash12(vec2f(sid, seed));
        let ang = (sid + 0.5 + (h - 0.5) * 0.7) / count * TAU - PI;
        let len = radius * (0.55 + 0.45 * hash12(vec2f(sid + 17.0, seed)));
        let m = crackRay(q, ang, len, 0.07, seed + sid * 11.0);
        mask = max(mask, m.x);
        core = max(core, m.y * (1.0 - m.z));
        // a side branch splitting off partway out
        let bt = 0.3 + 0.35 * hash12(vec2f(sid + 31.0, seed));
        let bside = select(-1.0, 1.0, hash12(vec2f(sid + 47.0, seed)) > 0.5);
        let bang = ang + bside * (0.45 + 0.35 * hash12(vec2f(sid + 53.0, seed)));
        let root = vec2f(cos(ang), sin(ang)) * len * bt;
        let b = crackRay(q - root, bang, len * (0.3 + 0.25 * h), 0.04, seed + sid * 5.0 + 2.0);
        mask = max(mask, b.x);
        core = max(core, b.y * (1.0 - b.z) * 0.6);
    }
    // the crater: crazed fragments round the impact, a raised lip
    let craterR = radius * 0.22;
    let crater = 1.0 - smoothstep(craterR * 0.8, craterR * 1.15, d);
    let craze = crackle2(q * (5.5 / max(radius, 0.5)) + seed, 0.06) * crater;
    mask = max(mask, craze);
    core = max(core, craze * 0.7);
    // scorch: the floor darkened round the impact, broken up so it reads as burnt, not as a disc
    let burnt = (1.0 - smoothstep(craterR * 0.5, radius * 0.6, d)) * (0.6 + 0.4 * valueNoise2(q * 3.0 + seed));
    let glow = core * (0.35 + 0.65 * (1.0 - smoothstep(0.0, radius, d)));
    return vec4f(glowCol * glow, max(mask * 0.9, burnt * 0.35));
}
// Giant screens (env pattern 32, the crossing's towers): animated programmes on the big displays
// over the scramble crossing, drawn so they tile cleanly whatever the screen's size:
//
//   0 ad          rows of bold type scrolling over bands of colour
//   1 music       an equaliser's bars bouncing to a beat, a gradient sweeping behind them
//   2 news        a slow backdrop with a bright ticker band scrolling headlines
//   3 plasma      the old demo plasma, a slogan running across it
//
// and on the night of the Grand Vow, every so often all of them are taken over at once: static,
// then red glitching scanlines, then a grid of eyes opening and looking down at the crossing.
// Seen close, the LCD's red, green and blue stripes show, and its scanlines flicker.

fn screenType(q: vec2f, rows: f32, speed: f32, time: f32, seed: f32) -> f32 {
    let row = floor(q.y * rows);
    let dir = select(-1.0, 1.0, hash11(row + seed) > 0.5);
    let x = q.x * rows * 0.8 + time * speed * dir + hash11(row * 3.1 + seed) * 10.0;
    let cell = floor(x);
    let local = vec2f(fract(x) - 0.5, fract(q.y * rows) - 0.5) * 2.2;
    let g = sdGlyph(local, cell + row * 17.0 + seed * 31.0);
    return 1.0 - smoothstep(0.0, 0.06, g);
}

fn screenAd(q: vec2f, time: f32, seed: f32) -> vec3f {
    let band = floor(q.y * 3.0 - time * 0.2);
    let bg = hsvToRgb(vec3f(fract(hash11(band + seed) + time * 0.03), 0.8, 0.9));
    let t = screenType(q, 3.0, 1.5, time, seed);
    return mix(bg * 0.6, vec3f(1.0), t);
}

fn screenMusic(q: vec2f, time: f32, seed: f32) -> vec3f {
    let bars = 18.0;
    let b = floor(q.x * bars);
    let beat = pow(fract(time * 2.0), 3.0);
    let h = 0.2 + 0.6 * valueNoise2(vec2f(b * 0.7, time * 3.0 + seed)) * (1.0 - beat * 0.5);
    let gap = step(0.15, fract(q.x * bars)) * step(fract(q.x * bars), 0.85);
    let on = step(fract(q.y), h) * gap;
    let seg = step(0.2, fract(q.y * 16.0));
    let bg = mix(vec3f(0.3, 0.0, 0.5), vec3f(0.0, 0.3, 0.6), fract(q.x + time * 0.1));
    let barCol = mix(vec3f(0.2, 1.0, 0.6), vec3f(1.0, 0.2, 0.4), fract(q.y));
    return mix(bg * 0.5, barCol, on * seg);
}

fn screenNews(q: vec2f, time: f32, seed: f32) -> vec3f {
    var c = mix(vec3f(0.05, 0.12, 0.3), vec3f(0.15, 0.3, 0.55), valueNoise2(q * 2.0 + time * 0.05));
    // a lower ticker band
    let band = step(fract(q.y), 0.22);
    let t = screenType(vec2f(q.x, fract(q.y) / 0.22 * 0.3), 1.0, 2.2, time, seed + 5.0);
    c = mix(c, vec3f(0.9, 0.1, 0.1), band);
    c = mix(c, vec3f(1.0), t * band);
    // the anchor's silhouette in the middle of the frame
    let anchor = 1.0 - smoothstep(0.0, 0.02, length((fract(q) - vec2f(0.5, 0.58)) * vec2f(1.0, 1.2)) - 0.12);
    let shoulders = step(abs(fract(q.x) - 0.5), 0.22) * step(0.22, fract(q.y)) * step(fract(q.y), 0.45);
    c = mix(c, vec3f(0.02, 0.03, 0.08), max(anchor, shoulders) * (1.0 - band));
    return c;
}

fn screenPlasma(q: vec2f, time: f32, seed: f32) -> vec3f {
    let v = sin(q.x * 6.0 + time) + sin(q.y * 5.0 - time * 1.3) + sin((q.x + q.y) * 4.0 + time * 0.7) + sin(length(q - 0.5) * 9.0 - time * 1.6);
    var c = 0.5 + 0.5 * cos(vec3f(0.0, 2.1, 4.2) + v * 1.3 + seed);
    let slogan = screenType(vec2f(q.x, fract(q.y * 0.5) * 0.4 + 0.3), 1.0, 1.0, time, seed + 9.0) * step(abs(fract(q.y * 0.5) - 0.5), 0.12);
    return mix(c * 0.8, vec3f(1.0), slogan);
}

// the curse takes over every screen: static, red glitch, then eyes opening in a grid, looking down
fn screenCurse(q: vec2f, k: f32, time: f32) -> vec3f {
    let stat = hash12(floor(q * 120.0) + floor(time * 30.0));
    var c = vec3f(stat * 0.8);
    let glitch = step(0.6, valueNoise2(vec2f(q.y * 40.0, floor(time * 12.0))));
    c = mix(c, vec3f(0.9, 0.05, 0.05) * (0.5 + 0.5 * stat), smoothstep(0.2, 0.5, k) * max(glitch, 0.5));
    // eyes
    let cell = fract(q * vec2f(2.0, 1.5)) - 0.5;
    let open = smoothstep(0.45, 0.9, k) * (0.6 + 0.4 * sin(time * 0.7));
    let lid = abs(cell.y) - (1.0 - abs(cell.x) * 2.2) * 0.25 * open;
    let eye = 1.0 - smoothstep(0.0, 0.02, lid);
    let look = vec2f(sin(time * 0.6) * 0.08, -0.05);
    let iris = 1.0 - smoothstep(0.0, 0.02, length(cell - look) - 0.11);
    let pupil = 1.0 - smoothstep(0.0, 0.02, length(cell - look) - 0.04);
    var e = mix(vec3f(0.0), vec3f(0.95, 0.9, 0.85), eye);
    e = mix(e, vec3f(0.8, 0.05, 0.05), iris * eye);
    e = mix(e, vec3f(0.0), pupil * eye);
    c = mix(c, e, smoothstep(0.45, 0.6, k));
    return c;
}

fn patternScreen(uv: vec2f, time: f32, seed: f32) -> PatternOut {
    var o = patternDefault();
    // a programme per region of the skyline (tiles of 9 m), scrolled in screen units of ~4 m
    let region = floor(uv / 9.0);
    let prog = i32(hash12(region + seed * 3.0) * 4.0);
    let q = uv / 4.0;
    var c = vec3f(0.0);
    switch prog {
        case 0: {
            c = screenAd(q, time, hash12(region));
        }
        case 1: {
            c = screenMusic(q, time, hash12(region));
        }
        case 2: {
            c = screenNews(q, time, hash12(region));
        }
        default: {
            c = screenPlasma(q, time, hash12(region));
        }
    }
    // the curse's broadcast: every 26 seconds, for six, on every screen at once
    let ph = fract(time / 26.0) * 26.0;
    let k = smoothstep(0.0, 0.6, ph) * (1.0 - smoothstep(5.4, 6.0, ph));
    c = mix(c, screenCurse(q, smoothstep(0.0, 4.0, ph), time), k);
    // the LCD's stripes and a flickering scanline
    let sub = fract(uv.x * 60.0);
    let rgb = vec3f(step(sub, 0.33), step(0.33, sub) * step(sub, 0.66), step(0.66, sub));
    c = c * mix(vec3f(1.0), rgb * 2.2, 0.25);
    c = c * (0.9 + 0.1 * step(0.5, fract(uv.y * 40.0 - time * 3.0)));
    o.tint = vec3f(0.04);
    o.gloss = 0.6;
    o.emissive = c * 1.5;
    o.height = 0.5;
    return o;
}
