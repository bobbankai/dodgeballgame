// Afterimages (vbGhost, applied in vbFinal): when a fighter dashes, copies of them are left behind
// along the path, tinted with their energy and fading, the way fast movement is drawn in the
// genre. A history buffer (ping-ponged) keeps the last copies; it is written only on strobe frames,
// so the ghosts are discrete poses rather than a smear.
//
//   history.rgb   the ghosts' colour (premultiplied), history.a their coverage

// how a captured pixel of a fighter becomes a ghost: the energy colour over a flattened copy of
// the figure, an edge left a little brighter
fn ghostTint(scene: vec3f, tint: vec3f, edge: f32) -> vec3f {
    let l = luma(scene);
    let flat = mix(vec3f(l), scene, 0.25);
    return mix(flat, tint, 0.65) * (1.0 + edge * 0.8);
}

// the history decays each frame (a ghost lasts a fraction of a second)
fn ghostDecay(h: vec4f, k: f32) -> vec4f {
    return h * k;
}

// composite: ghosts sit behind the fighters as they are now (never over them)
fn ghostComposite(col: vec3f, h: vec4f, amount: f32, isFighterNow: f32) -> vec3f {
    if (h.a <= 0.001) {
        return col;
    }
    let g = h.rgb / max(h.a, 1e-3);
    let a = clamp(h.a * amount, 0.0, 0.85) * (1.0 - isFighterNow);
    // ghosts glow a little: half laid over, half added
    return mix(col, g, a * 0.6) + g * a * 0.25;
}
