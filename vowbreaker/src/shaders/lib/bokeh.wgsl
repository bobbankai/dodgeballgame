// Bokeh (vbDof): the shape of the lens's aperture in the out-of-focus highlights of cutscenes.
//
//   blades      a polygonal iris (blades sides, rotated), slightly curved so it is not too hard
//   cat's eye   toward the frame's edges the disc is clipped into a lemon shape (optical
//               vignetting), oriented along the radius from the centre
//   anamorphic  discs stretched vertically into ovals (the widescreen lens look)
//   shapes      a card cut into a shape over the lens (sakura, star, crescent, bell, heart)
//   rim         highlights brighter at the disc's rim than in its middle (an onion-ring lens), with
//               a faint fringe of colour on the rim

// signed distance to a regular polygon of n sides, radius 1, with curved blades (k 0 straight)
fn bokehIris(p: vec2f, n: f32, rot: f32, curve: f32) -> f32 {
    let a = atan2(p.y, p.x) + rot;
    let seg = TAU / n;
    let l = fmod1(a, seg) - seg * 0.5;
    let r = length(p);
    let straight = r * cos(l) / cos(seg * 0.5);
    return mix(straight, r, curve) - 1.0;
}

// the weight of a sample offset (in units of the disc radius) for this pixel's position on screen
fn bokehShape(off: vec2f, screenPos: vec2f, blades: f32, rot: f32, anamorphic: f32, catEye: f32) -> f32 {
    // a shaped card over the lens (negative blades: sakura, star, crescent, bell, heart)
    if (blades < -0.5) {
        return bokehShaped(vec2f(off.x * (1.0 + anamorphic), off.y), blades, rot);
    }
    var q = off;
    // anamorphic: discs taller than wide
    q.x = q.x * (1.0 + anamorphic);
    var d = bokehIris(q, max(blades, 3.0), rot, 0.35);
    // cat's eye: a second disc offset toward the frame's centre clips the first near the edges
    let fromCentre = screenPos - 0.5;
    let shift = fromCentre * catEye * 2.2;
    let clip = length(q + shift) - 1.0;
    d = max(d, clip);
    return 1.0 - smoothstep(-0.08, 0.02, d);
}

// onion-ring rim: samples near the disc's rim count a little more
fn bokehRim(rNorm: f32, amount: f32) -> f32 {
    return 1.0 + smoothstep(0.7, 1.0, rNorm) * amount;
}

// --- shaped apertures ------------------------------------------------------------------------------------------
//
// Cinematographers cut shapes into a card over the lens so the out-of-focus lights take them. Chosen
// with a negative blade count:
//   -1 sakura     a five-petalled cherry blossom, each petal notched (the spring graves)
//   -2 star       a five-pointed star (festival nights)
//   -3 crescent   a crescent moon (the moonlit chapel)
//   -4 bell       a little bell with its clapper (the memory of Mio's bell)
//   -5 heart      a soft heart (the few warm moments)
// All return a signed distance with the disc's radius at 1.

fn bokehSakura(p: vec2f, rot: f32) -> f32 {
    let q = rotate2(p, rot);
    let a = atan2(q.y, q.x);
    let r = length(q);
    // five lobes, a notch at the tip of each
    let lobe = 0.78 + 0.22 * cos(a * 5.0);
    let notch = 0.12 * smoothstep(0.92, 1.0, cos(a * 5.0)) * smoothstep(0.6, 1.0, r);
    return r - (lobe - notch);
}

fn bokehStar(p: vec2f, rot: f32) -> f32 {
    let q = rotate2(p, rot + PI * 0.5);
    let a = atan2(q.y, q.x);
    let r = length(q);
    let seg = TAU / 5.0;
    let l = abs(fmod1(a, seg) - seg * 0.5) / (seg * 0.5);
    // between the inner radius (0.48) and the points (1.0), straight edges
    let edge = mix(1.0, 0.48, l);
    return r - edge;
}

fn bokehCrescent(p: vec2f, rot: f32) -> f32 {
    let q = rotate2(p, rot);
    let outer = length(q) - 1.0;
    let inner = length(q - vec2f(0.42, 0.18)) - 0.82;
    return max(outer, -inner);
}

fn bokehBellShape(p: vec2f) -> f32 {
    // the bell: a flared body, a crown, and a clapper hanging below the mouth
    let q = vec2f(p.x, p.y + 0.1);
    let y = q.y;
    let w = mix(0.95, 0.55, smoothstep(-0.6, 0.6, y)) + 0.12 * smoothstep(-0.45, -0.75, y);
    let body = max(abs(q.x) - w, max(-0.75 - y, y - 0.6));
    let crown = length((q - vec2f(0.0, 0.6)) * vec2f(1.0, 1.6)) - 0.55;
    let clapper = length(q - vec2f(0.0, -0.9)) - 0.16;
    return min(min(body, crown), clapper) * 0.9;
}

fn bokehHeart(p0: vec2f) -> f32 {
    // the classic heart distance (Inigo Quilez's), scaled so the heart fills the unit disc
    let s = 0.6;
    let p = vec2f(abs(p0.x) * s, p0.y * s + 0.55);
    if (p.y + p.x > 1.0) {
        return (length(p - vec2f(0.25, 0.75)) - sqrt(2.0) / 4.0) / s;
    }
    let a = p - vec2f(0.0, 1.0);
    let b = p - 0.5 * max(p.x + p.y, 0.0);
    return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y) / s;
}

// the shaped aperture's weight for a sample offset (units of the disc radius)
fn bokehShaped(off: vec2f, kind: f32, rot: f32) -> f32 {
    var d = length(off) - 1.0;
    let k = i32(-kind + 0.5);
    switch k {
        case 1: {
            d = bokehSakura(off, rot);
        }
        case 2: {
            d = bokehStar(off, rot);
        }
        case 3: {
            d = bokehCrescent(off, rot);
        }
        case 4: {
            d = bokehBellShape(off);
        }
        case 5: {
            d = bokehHeart(off);
        }
        default: {
        }
    }
    return 1.0 - smoothstep(-0.08, 0.02, d);
}
