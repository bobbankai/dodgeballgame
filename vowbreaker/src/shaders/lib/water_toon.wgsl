// Toon water (water.vertex / water.fragment, src/render/Water.ts): stage seas, ponds and canals,
// drawn the way the rest of the world is drawn: flat bands of colour, hard-edged foam, sky
// reflections posterised into a few steps, sun glints as four-point stars, a dark ink line where
// the water meets the land.
//
//   depth     the scene behind the water (G-buffer view depth) gives how much water is in front of
//             it: shallow water is clear and pale, deep water dark and saturated
//   waves     a sum of Gerstner waves moves the surface (sea) and gives its normal; ponds only have
//             ripples (rain rings, and the slow breathing of still water)
//   foam      where the water is thin over something (the shore, a pillar, a fighter's legs) a band
//             of foam with a lacy breaking edge; on the sea, whitecaps on the wave crests
//   light     the sky reflected by a stepped fresnel, the sun as a streak of glints, caustic light
//             dancing on whatever lies in the shallows
//   life      lily pads drifting and koi gliding under the surface in ponds; leaves on canals

struct WaterLook {
    shallow: vec3f,
    deep: vec3f,
    foam: vec3f,
    depthScale: f32,   // metres of water to reach the deep colour
    waveAmp: f32,
    waveLen: f32,
    flow: vec2f,       // canal current (m/s)
    kind: i32,         // 0 sea, 1 pond, 2 canal
}

// one Gerstner wave: returns (displacement xyz) and accumulates the tangent frame derivatives
struct Gerstner {
    disp: vec3f,
    tangent: vec3f,
    binormal: vec3f,
}

fn gerstnerAdd(g0: Gerstner, p: vec2f, dir: vec2f, steep: f32, len: f32, t: f32) -> Gerstner {
    var g = g0;
    let k = TAU / len;
    let c = sqrt(9.8 / k);
    let d = normalize(dir);
    let f = k * (dot(d, p) - c * t);
    let a = steep / k;
    let cf = cos(f);
    let sf = sin(f);
    g.disp = g.disp + vec3f(d.x * a * cf, a * sf, d.y * a * cf);
    g.tangent = g.tangent + vec3f(-d.x * d.x * steep * sf, d.x * steep * cf, -d.x * d.y * steep * sf);
    g.binormal = g.binormal + vec3f(-d.x * d.y * steep * sf, d.y * steep * cf, -d.y * d.y * steep * sf);
    return g;
}

// the sea: five waves of decreasing length, turning with the wind
fn waterWaves(p: vec2f, t: f32, amp: f32, len: f32) -> Gerstner {
    var g: Gerstner;
    g.disp = vec3f(0.0);
    g.tangent = vec3f(1.0, 0.0, 0.0);
    g.binormal = vec3f(0.0, 0.0, 1.0);
    if (amp <= 0.0) {
        return g;
    }
    g = gerstnerAdd(g, p, vec2f(1.0, 0.25), 0.22 * amp, len, t);
    g = gerstnerAdd(g, p, vec2f(0.7, 0.8), 0.18 * amp, len * 0.61, t);
    g = gerstnerAdd(g, p, vec2f(-0.3, 1.0), 0.14 * amp, len * 0.37, t);
    g = gerstnerAdd(g, p, vec2f(0.95, -0.5), 0.1 * amp, len * 0.23, t);
    g = gerstnerAdd(g, p, vec2f(-0.8, 0.4), 0.08 * amp, len * 0.13, t);
    return g;
}

fn waterWaveNormal(g: Gerstner) -> vec3f {
    return normalize(cross(g.binormal, g.tangent));
}

// fine surface detail: two scrolling noise normals (wind ripples), and rain rings
fn waterDetailNormal(p: vec2f, t: f32, flow: vec2f, strength: f32) -> vec3f {
    let e = 0.05;
    let q1 = p * 1.3 + flow * t + vec2f(t * 0.05, t * 0.03);
    let q2 = p * 2.7 - vec2f(t * 0.04, -t * 0.06) + flow * t * 1.3;
    let h = valueNoise2(q1) * 0.6 + valueNoise2(q2) * 0.4;
    let hx = valueNoise2(q1 + vec2f(e, 0.0)) * 0.6 + valueNoise2(q2 + vec2f(e, 0.0)) * 0.4;
    let hz = valueNoise2(q1 + vec2f(0.0, e)) * 0.6 + valueNoise2(q2 + vec2f(0.0, e)) * 0.4;
    return normalize(vec3f(-(hx - h) / e * strength, 1.0, -(hz - h) / e * strength));
}

// the colour of the water column: shallow to deep by how much water lies in front of the scene
fn waterColumn(look: WaterLook, thickness: f32) -> vec3f {
    let k = clamp(thickness / max(look.depthScale, 0.01), 0.0, 1.0);
    // posterised into three bands like the rest of the world
    let b = floor(k * 3.0 + 0.5) / 3.0;
    return mix(look.shallow, look.deep, mix(k, b, 0.65));
}

// how transparent the water is over the scene behind it
fn waterClarity(thickness: f32, depthScale: f32) -> f32 {
    return exp(-thickness / max(depthScale * 0.6, 0.01));
}

// the sky reflected: horizon to zenith gradient in three steps, darker where the normal faces away
fn waterSkyReflection(r: vec3f, skyCol: vec3f, horizon: vec3f) -> vec3f {
    let up = clamp(r.y, 0.0, 1.0);
    let s = floor(up * 3.0 + 0.5) / 3.0;
    return mix(horizon, skyCol * 1.2, mix(up, s, 0.6));
}

// sun glints: four-point stars where the reflected ray meets the sun
fn waterSunGlints(r: vec3f, sunDir: vec3f, p: vec2f, t: f32) -> f32 {
    let d = dot(r, sunDir);
    let streak = smoothstep(0.985, 0.998, d);
    // break the streak into twinkling points on twos
    let st = floor(t * 12.0);
    let cell = floor(p * 3.0);
    let h = hash12(cell + vec2f(st * 0.37, 0.0));
    let f = fract(p * 3.0) - 0.5;
    let star = exp(-abs(f.x) * 30.0) * exp(-abs(f.y) * 8.0) + exp(-abs(f.y) * 30.0) * exp(-abs(f.x) * 8.0);
    return streak * (0.4 + star * step(0.6, h) * 3.0);
}

// foam where the water is thin over something, with a lacy breaking edge that moves
fn waterShoreFoam(thickness: f32, p: vec2f, t: f32, width: f32) -> f32 {
    let lace = vfbm2(p * 3.0 + vec2f(t * 0.3, -t * 0.2), 3);
    let band = 1.0 - smoothstep(width * 0.6, width, thickness + (lace - 0.5) * width * 0.8);
    // a second line of foam pulsing in and out
    let pulse = 0.5 + 0.5 * sin(t * 1.4 - thickness * 8.0);
    let line2 = (1.0 - smoothstep(0.0, 0.05, abs(thickness - width * (1.2 + pulse * 0.6)))) * step(0.45, lace);
    return clamp(band + line2 * 0.8, 0.0, 1.0);
}

// whitecaps on the sea's crests (crest = how high the wave lifts this point)
fn waterWhitecaps(crest: f32, p: vec2f, t: f32) -> f32 {
    let n = vfbm2(p * 0.8 + vec2f(t * 0.1, 0.0), 3);
    let lace = vfbm2(p * 3.5 - vec2f(t * 0.2, 0.0), 2);
    // only the highest crests break, and only in patches, into lace rather than stripes
    return smoothstep(0.86, 0.95, crest + (n - 0.5) * 0.35) * smoothstep(0.35, 0.6, lace) * 0.85;
}

// caustics: bright lines of focused light dancing in the shallows
fn waterCaustics(p: vec2f, t: f32) -> f32 {
    let c1 = worley2(p * 1.2 + vec2f(t * 0.15, t * 0.1), 1.0);
    let c2 = worley2(p * 1.7 - vec2f(t * 0.12, -t * 0.08) + 3.1, 1.0);
    let l1 = 1.0 - smoothstep(0.0, 0.08, c1.edge);
    let l2 = 1.0 - smoothstep(0.0, 0.08, c2.edge);
    return min(l1, l2) * 0.6 + max(l1, l2) * 0.2;
}

// --- pond life ------------------------------------------------------------------------------------------------

// lily pads: green discs with a notch, drifting a little; returns (coverage, flower)
fn waterLilies(p: vec2f, t: f32) -> vec2f {
    let g = p * 0.7;
    let cell = floor(g);
    let h = hash22(cell + vec2f(17.0, 3.0));
    if (h.x < 0.55) {
        return vec2f(0.0);
    }
    let drift = vec2f(sin(t * 0.2 + h.y * 6.0), cos(t * 0.17 + h.x * 6.0)) * 0.05;
    let q = rotate2(fract(g) - 0.5 - (h - 0.5) * 0.4 - drift, h.y * 6.28);
    let r = 0.16 + h.y * 0.12;
    let pad = sdCircle(q, r);
    let notch = max(abs(q.y) - r * 0.06, -q.x);
    let d = max(pad, -notch);
    let cov = 1.0 - smoothstep(-0.01, 0.01, d);
    let flower = (1.0 - smoothstep(0.0, r * 0.35, length(q - vec2f(-r * 0.3, r * 0.2)))) * step(0.8, h.y);
    return vec2f(cov, flower);
}

// koi: dark-orange shapes gliding under the surface in slow loops (returns coverage, white patches)
fn waterKoi(p: vec2f, t: f32) -> vec2f {
    var cov = 0.0;
    var white = 0.0;
    for (var k = 0; k < 4; k++) {
        let fk = f32(k);
        let r = 1.6 + fk * 0.7;
        let w = 0.25 + fk * 0.05;
        let a = t * w + fk * 1.7;
        let c = vec2f(cos(a), sin(a * 1.3)) * r;
        let dir = normalize(vec2f(-sin(a), cos(a * 1.3) * 1.3));
        let q = p - c;
        let along = dot(q, dir);
        let side = dot(q, vec2f(-dir.y, dir.x));
        // a tapered body with a waving tail
        let tail = sin(t * 6.0 + fk) * 0.08 * max(-along, 0.0);
        let body = length(vec2f(along * 0.5, (side - tail) * 1.5)) - 0.18 * (1.0 - smoothstep(-0.4, 0.4, -along) * 0.6);
        let m = 1.0 - smoothstep(-0.02, 0.02, body);
        cov = max(cov, m);
        white = max(white, m * step(0.5, valueNoise2(vec2f(along, side) * 8.0 + fk * 5.0)));
    }
    return vec2f(cov, white);
}

// fallen leaves carried along a canal
fn waterLeaves(p: vec2f, t: f32, flow: vec2f) -> f32 {
    let q = p - flow * t;
    let g = q * 1.4;
    let cell = floor(g);
    let h = hash22(cell + vec2f(5.0, 11.0));
    if (h.x < 0.8) {
        return 0.0;
    }
    let f = rotate2(fract(g) - 0.5, h.y * 6.28 + t * 0.3);
    return 1.0 - smoothstep(-0.01, 0.01, sdVesica(f, 0.18, 0.1));
}
