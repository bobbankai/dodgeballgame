// ============================================================================================
// vb_surface: fragment-stage surface helpers: bump mapping from a scalar height without tangents
// (Mikkelsen 2010, "Bump Mapping Unparametrized Surfaces on the GPU"), triplanar/biplanar
// projections, wetness and the pattern table used by the environment shader.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_sdf2d, vb_toon, vb_water, vb_patterns.
// ============================================================================================

// perturb normal n by the screen-space derivatives of a height field defined on the surface
fn bumpFromHeight(worldPos: vec3f, n: vec3f, height: f32, scale: f32) -> vec3f {
    let dpx = dpdx(worldPos);
    let dpy = dpdy(worldPos);
    let dhx = dpdx(height) * scale;
    let dhy = dpdy(height) * scale;
    let r1 = cross(dpy, n);
    let r2 = cross(n, dpx);
    let det = dot(dpx, r1);
    let grad = sign(det) * (dhx * r1 + dhy * r2);
    return normalize(abs(det) * n - grad);
}

// the 2D coordinates for a pattern on a surface: the plane facing the normal most
struct PlaneUV {
    uv: vec2f,
    axis: i32,     // 0 = x-facing (walls along z), 1 = y-facing (floors), 2 = z-facing (walls along x)
}

fn dominantPlane(p: vec3f, n: vec3f) -> PlaneUV {
    let a = abs(n);
    var o: PlaneUV;
    if (a.y >= a.x && a.y >= a.z) {
        o.uv = p.xz;
        o.axis = 1;
    } else if (a.x >= a.z) {
        o.uv = vec2f(p.z * sign(n.x), p.y);
        o.axis = 0;
    } else {
        o.uv = vec2f(-p.x * sign(n.z), p.y);
        o.axis = 2;
    }
    return o;
}

fn triplanarWeights(n: vec3f, sharpness: f32) -> vec3f {
    let w = pow(abs(n), vec3f(sharpness));
    return w / (w.x + w.y + w.z);
}

// wet surfaces: darker, more saturated, glossier (rain in Shiomi, the flooded chapel)
fn wetAlbedo(albedo: vec3f, wet: f32, porosity: f32) -> vec3f {
    let dark = mix(1.0, 0.55, porosity);
    return mix(albedo, adjustSaturation(albedo * dark, 1.15), wet);
}

// pattern ids (vertex colour alpha * 32), shared with the Blender stage scripts
const PAT_PLAIN: i32 = 0;
const PAT_BRICK: i32 = 1;
const PAT_TILE: i32 = 2;
const PAT_PLANKS: i32 = 3;
const PAT_CONCRETE: i32 = 4;
const PAT_ASPHALT: i32 = 5;
const PAT_COBBLES: i32 = 6;
const PAT_ROOF: i32 = 7;
const PAT_SHOJI: i32 = 8;
const PAT_TATAMI: i32 = 9;
const PAT_PLASTER: i32 = 10;
const PAT_METAL: i32 = 11;
const PAT_GRASS: i32 = 12;
const PAT_SAND: i32 = 13;
const PAT_STONE: i32 = 14;
const PAT_BARK: i32 = 15;
const PAT_PAPER: i32 = 16;
const PAT_WINDOWS: i32 = 17;
const PAT_NEON: i32 = 18;
const PAT_LANTERN: i32 = 19;
const PAT_FOLIAGE: i32 = 21;
const PAT_DIRT: i32 = 22;
const PAT_STATION: i32 = 23;
const PAT_FABRIC: i32 = 24;
const PAT_CHARRED: i32 = 25;
const PAT_STEEL: i32 = 26;
const PAT_GRAVEL: i32 = 27;
const PAT_RAKED: i32 = 28;
const PAT_LACQUER: i32 = 29;
const PAT_GLASS: i32 = 30;
const PAT_LIGHT: i32 = 31;

fn decodePatternId(a: f32) -> i32 {
    return i32(round(clamp(a, 0.0, 1.0) * 32.0));
}

// evaluate a pattern by id; `seed` varies neon glyphs and window grids between props
fn evalPattern(id: i32, p: vec3f, n: vec3f, time: f32, wet: f32, seed: f32, glowColor: vec3f) -> PatternOut {
    let pl = dominantPlane(p, n);
    let uv = pl.uv;
    switch id {
        case 1: { return patternBrick(uv, vec2f(0.24, 0.075), 0.012); }
        case 2: { return patternTile(uv, 0.3, 0.006, 0.6); }
        case 3: {
            var q = uv;
            if (pl.axis == 0 || pl.axis == 2) { q = vec2f(uv.y, uv.x); }
            return patternPlanks(q, 0.16, 2.4);
        }
        case 4: { return patternConcrete(uv, 1.5); }
        case 5: { return patternAsphalt(uv, wet); }
        case 6: { return patternCobbles(uv, 3.2); }
        case 7: { return patternRoofTiles(uv, 0.28); }
        case 8: { return patternShoji(uv, vec2f(0.3, 0.42), glowColor); }
        case 9: { return patternTatami(uv); }
        case 10: { return patternPlaster(uv); }
        case 11: { return patternMetalPanel(uv, 0.6); }
        case 12: { return patternGrass(uv); }
        case 13: { return patternSand(uv); }
        case 14: { return patternStoneBlocks(uv, 0.36, 0.02); }
        case 15: { return patternBark(vec2f(atan2(p.z, p.x) * 0.3 + p.x, p.y)); }
        case 16: {
            var o = patternDefault();
            o.tint = vec3f(0.96 + paperGrain(uv * 3.0) * 0.08);
            return o;
        }
        case 17: { return patternWindows(uv + vec2f(seed * 13.0, 0.0), vec2f(2.2, 3.1), 0.45, time); }
        case 18: { return patternNeon(fract(uv * 0.5), glowColor, seed + floor(uv.x * 0.5) * 3.1, time); }
        case 19: { return patternLanternPaper(fract(uv * vec2f(1.0, 1.4)), glowColor, 0.85 + 0.15 * valueNoise2(vec2f(time * 7.0, seed))); }
        case 22: { return patternDirt(uv); }
        case 23: { return patternStationTile(uv, 1.1, vec3f(0.95, 0.55, 0.3)); }
        case 24: { return patternFabric(uv, 140.0); }
        case 25: { return patternCharred(uv, time, 1.0); }
        case 26: {
            var o = patternMetalPanel(uv * 2.0, 0.0);
            o.gloss = 0.8;
            return o;
        }
        case 27: { return patternGravel(uv); }
        case 28: { return patternRakedGravel(uv, vec2f(0.0)); }
        case 29: {
            var o = patternDefault();
            o.tint = vec3f(0.95 + valueNoise2(uv * 8.0) * 0.05);
            o.gloss = 0.55;
            return o;
        }
        case 30: {
            var o = patternDefault();
            o.gloss = 1.0;
            o.tint = vec3f(0.7);
            return o;
        }
        case 31: {
            var o = patternDefault();
            o.emissive = glowColor * 2.5;
            return o;
        }
        default: {
            var o = patternDefault();
            // plain painted surfaces still get a soft wash of variation, like a background painting
            o.tint = vec3f(0.94 + vfbm3(p * 0.6, 3) * 0.12);
            return o;
        }
    }
}
