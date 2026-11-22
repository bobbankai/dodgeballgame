// Bokeh (vbDof): the shape of the lens's aperture in the out-of-focus highlights of cutscenes.
//
//   blades      a polygonal iris (blades sides, rotated), slightly curved so it is not too hard
//   cat's eye   toward the frame's edges the disc is clipped into a lemon shape (optical
//               vignetting), oriented along the radius from the centre
//   anamorphic  discs stretched vertically into ovals (the widescreen lens look)
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
