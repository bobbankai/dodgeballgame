// ============================================================================================
// vb_toon_fx: what happens to a character in a fight and in the story, on top of their shading:
// hit flashes (white, then a frame of inverted ink), cursed energy flowing over the body in
// palette bands, the Vow burning red through the shadows, rain beading and running down, mud and
// dust, a curse's paper transformation creeping over a body, the domain's palette wash, the
// petrifying grey of time stopped (Stillwater), and dissolves into ash, into paper, into light.
// Depends on vb_common, vb_hash, vb_noise, vb_color, vb_math, vb_lighting, vb_vfx.
// ============================================================================================

// --- hits -----------------------------------------------------------------------------------------

// flash: .rgb colour, .a amount; negative amounts invert to a dark ink silhouette (impact frame)
fn fxHitFlash(c: vec3f, flash: vec4f) -> vec3f {
    if (flash.a >= 0.0) {
        return mix(c, flash.rgb, clamp(flash.a, 0.0, 1.0));
    }
    let k = clamp(-flash.a, 0.0, 1.0);
    return mix(c, vec3f(0.02, 0.01, 0.03), k);
}

// a red rim on the side facing the attacker while in hitstun
fn fxHurtRim(n: vec3f, v: vec3f, toAttacker: vec3f, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return vec3f(0.0);
    }
    let rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0) * clamp(dot(n, toAttacker), 0.0, 1.0);
    return vec3f(1.0, 0.15, 0.1) * rim * amount * 1.5;
}

// --- cursed energy -------------------------------------------------------------------------------

// energy flowing up over the body in bands, strongest at the silhouette
fn fxEnergyFlow(c: vec3f, n: vec3f, v: vec3f, objPos: vec3f, amount: f32, palette: i32, time: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let pal = paletteFor(palette);
    let t = steppedTime(time, 12.0);
    let flow = vfbm3(vec3f(objPos.x * 5.0, objPos.y * 3.0 - t * 2.4, objPos.z * 5.0), 3);
    let fres = fresnelRim(n, v, 1.6);
    let heat = energyBands(flow * fres * 1.6 * amount, 0.22, 0.48, 0.76);
    return mix(c, paletteRamp(pal, heat) * 2.0, step(0.25, heat) * 0.85);
}

// veins of energy under the skin (overcharged, a Black Spark landing)
fn fxEnergyVeins(c: vec3f, objPos: vec3f, amount: f32, col: vec3f, time: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let v = veins(objPos + vec3f(0.0, time * 0.3, 0.0), 6.0, 0.06);
    return c + col * v * amount * (0.8 + 0.4 * sin(time * 20.0));
}

// black sparks crawling over the surface (the Black Spark's black-red lightning)
fn fxBlackSpark(c: vec3f, objPos: vec3f, amount: f32, time: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let t = steppedTime(time, 24.0);
    let f = electricField(objPos * 3.0, t);
    let bolt = smoothstep(0.82, 0.9, f);
    let core = smoothstep(0.93, 0.98, f);
    var o = mix(c, vec3f(0.02, 0.0, 0.01), bolt * amount);
    o = o + vec3f(1.0, 0.1, 0.05) * core * amount * 2.0;
    return o;
}

// --- the Vow ---------------------------------------------------------------------------------------

fn fxVow(c: vec3f, n: vec3f, v: vec3f, l: vec3f, lit: f32, amount: f32, time: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    var o = mix(c, c * vec3f(1.25, 0.55, 0.55), amount * (1.0 - lit) * 0.7);
    o = o + vec3f(0.9, 0.05, 0.08) * toonRim(n, v, l, 0.3, 0.02, 0.0) * amount * (0.8 + 0.2 * sin(time * 9.0));
    return o;
}

// --- weather ---------------------------------------------------------------------------------------

// rain: surfaces facing up bead, streaks run down vertical surfaces
fn fxRain(c: vec3f, n: vec3f, v: vec3f, l: vec3f, objPos: vec3f, wet: f32, time: f32, lightCol: vec3f) -> vec3f {
    if (wet <= 0.0) {
        return c;
    }
    let up = clamp(n.y, 0.0, 1.0);
    let side = 1.0 - abs(n.y);
    let beads = sparkle3(objPos * 90.0, 0.25, 12.0) * up;
    let run = streaks(vec2f(objPos.x * 30.0 + objPos.z * 30.0, objPos.y * 4.0 + time * 2.5), vec2f(0.0, 1.0), 3.0, 1.2) * side;
    let spec = toonSpecular(n, l, v, 0.05, 0.01);
    return c * (1.0 - 0.18 * wet) + lightCol * (beads * 0.6 + run * 0.25 * spec + spec * 0.1) * wet;
}

fn fxDust(c: vec3f, objPos: vec3f, n: vec3f, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let up = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    let d = vfbm3(objPos * 8.0, 3) * up * amount;
    return mix(c, vec3f(0.62, 0.56, 0.48), clamp(d, 0.0, 0.7));
}

fn fxSnow(c: vec3f, n: vec3f, objPos: vec3f, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let up = smoothstep(0.3, 0.8, n.y);
    let k = up * smoothstep(0.35, 0.6, vfbm3(objPos * 12.0, 2) + amount * 0.5);
    return mix(c, vec3f(0.92, 0.95, 1.0), k * amount);
}

// --- transformations --------------------------------------------------------------------------------

// Shiragami's paper creeping over a body from the ground up: white, folded, ink-creased
fn fxPaperCreep(c: vec3f, objPos: vec3f, n: vec3f, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let front = amount * 2.2 - 0.2;
    let edgeNoise = vfbm3(objPos * 6.0, 3) * 0.3;
    let k = smoothstep(front + 0.04, front - 0.04, objPos.y + edgeNoise);
    let facet = quantize(dot(n, normalize(vec3f(0.3, 0.8, 0.5))) * 0.5 + 0.5, 4.0);
    let paper = vec3f(0.94, 0.92, 0.86) * (0.8 + 0.25 * facet);
    let crease = 1.0 - smoothstep(0.0, 0.02, abs(fract(objPos.x * 8.0 + objPos.y * 5.0) - 0.5) - 0.47);
    let edge = smoothstep(front - 0.06, front - 0.03, objPos.y + edgeNoise) * k;
    var o = mix(c, paper * (1.0 - crease * 0.4), k);
    o = o + vec3f(0.8, 0.1, 0.1) * edge * 0.6;
    return o;
}

// time stopped: everything greys and gains a faint blue ring pattern (ripples on still water)
fn fxStillwater(c: vec3f, worldPos: vec3f, center: vec3f, amount: f32, time: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let g = luma(c);
    let grey = vec3f(g * 0.9, g * 0.95, g * 1.08);
    let d = length(worldPos.xz - center.xz);
    let ring = 1.0 - smoothstep(0.0, 0.05, abs(fract(d * 1.5 - time * 0.2) - 0.5) - 0.45);
    return mix(c, grey + vec3f(0.3, 0.45, 0.7) * ring * 0.15, amount);
}

// the domain's palette washing over everyone inside it
fn fxDomainWash(c: vec3f, amount: f32, palette: i32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let pal = paletteFor(palette);
    return mix(c, c * mix(vec3f(1.0), pal.body * 1.4, 0.5), amount * 0.35);
}

// --- endings --------------------------------------------------------------------------------------------

// dissolve into ash flakes rising (curses exorcised): returns (keep, edge glow)
fn fxDissolveAsh(objPos: vec3f, amount: f32, height: f32) -> vec2f {
    let n = vfbm3(objPos * 5.0, 3) * 0.75 + (1.0 - clamp(objPos.y / max(height, 0.1), 0.0, 1.0)) * 0.25;
    return dissolve(n, amount, 0.08);
}

// dissolve into light from the top down (the Little Bell letting go)
fn fxDissolveLight(objPos: vec3f, amount: f32, height: f32) -> vec2f {
    let n = vfbm3(objPos * 8.0, 2) * 0.4 + clamp(objPos.y / max(height, 0.1), 0.0, 1.0) * 0.6;
    return dissolveDirectional(n, objPos.y / max(height, 0.1), amount, 0.06);
}

// dissolve into paper squares (Shiragami taking someone)
fn fxDissolvePaper(objPos: vec3f, amount: f32) -> vec2f {
    let cell = floor(objPos * 22.0);
    let n = hash13(cell) * 0.7 + vfbm3(objPos * 2.0, 2) * 0.3;
    return dissolve(n, amount, 0.05);
}

// the glow along a dissolve edge in a palette
fn fxDissolveGlow(c: vec3f, edge: f32, palette: i32) -> vec3f {
    if (edge <= 0.0) {
        return c;
    }
    let pal = paletteFor(palette);
    return c + paletteRamp(pal, 0.9) * edge * 4.0;
}

// --- memory and flashback ----------------------------------------------------------------------------

// characters in a memory are drawn paler and flatter, as if in an old illustration
fn fxMemory(c: vec3f, lit: f32, amount: f32) -> vec3f {
    if (amount <= 0.0) {
        return c;
    }
    let flatC = mix(c, vec3f(luma(c)) * vec3f(1.05, 0.98, 0.88), 0.45);
    let lifted = flatC * 0.85 + vec3f(0.12, 0.1, 0.08) + vec3f(0.06) * lit;
    return mix(c, lifted, amount);
}

// a ghost (the dead in visions): pale, blue-shifted, faintly see-through at the edges (used with alpha)
fn fxGhost(c: vec3f, n: vec3f, v: vec3f, amount: f32) -> vec4f {
    let rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 1.5);
    let pale = mix(c, vec3f(0.8, 0.88, 1.0) * (0.6 + 0.4 * luma(c)), 0.6 * amount);
    return vec4f(pale + vec3f(0.4, 0.55, 0.9) * rim * amount, 1.0 - amount * (1.0 - rim) * 0.5);
}
