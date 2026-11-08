"""Gear texture compositing from baked maps (a scripted 'smart material' pass).

Inputs (per atlas texel): baked tangent normal, AO, material ID colour, curvature and height.
Outputs: albedo (sRGB), normal (OpenGL), ORM (AO / roughness / metal), emissive.
Each material has a base look from a tiled CC0 detail texture plus wear rules.
"""
import numpy as np
from PIL import Image

from armor import MATERIALS, MAT_INDEX
from bake import tile_texture, noise2, decode_ids, blend_normals, load_rgb

# name: (detail set, tile metres, tint (linear-ish sRGB multiplier), base roughness, metal, edge wear colour, wear amount, detail normal strength)
LOOKS = {
    'steel':       ('gen_forged_steel', 0.6, (0.86, 0.87, 0.9), 0.3, 1.0, (0.97, 0.97, 0.98), 0.9, 0.5),
    'darksteel':   ('gen_forged_steel', 0.6, (0.30, 0.31, 0.34), 0.42, 1.0, (0.7, 0.7, 0.72), 0.7, 0.5),
    'gold':        ('gen_forged_steel', 0.5, (1.0, 0.74, 0.36), 0.3, 1.0, (1.0, 0.86, 0.55), 0.6, 0.3),
    'bronze':      ('gen_forged_steel', 0.5, (0.72, 0.46, 0.26), 0.38, 1.0, (0.9, 0.7, 0.45), 0.6, 0.4),
    'leather':     ('cloth_leather_brown', 0.35, (0.95, 0.85, 0.78), 0.62, 0.0, (0.62, 0.48, 0.36), 0.5, 1.0),
    'darkleather': ('cloth_leather_worn', 0.35, (0.55, 0.47, 0.42), 0.58, 0.0, (0.42, 0.33, 0.26), 0.5, 1.0),
    'wool':        ('cloth_denim', 0.16, (0.34, 0.31, 0.29), 0.92, 0.0, (0.45, 0.42, 0.4), 0.2, 1.0),
    'linen':       ('cloth_weave', 0.15, (1.4, 1.32, 1.15), 0.88, 0.0, (0.8, 0.75, 0.65), 0.2, 1.0),
    'cloth_red':   ('cloth_jacquard', 0.3, (1.1, 0.42, 0.38), 0.85, 0.0, (0.6, 0.2, 0.18), 0.2, 0.8),
    'mail':        ('gen_chainmail', 0.12, (0.45, 0.45, 0.47), 0.45, 1.0, (0.8, 0.8, 0.8), 0.5, 1.0),
    'glow':        ('gen_forged_steel', 0.5, (0.25, 0.2, 0.12), 0.4, 1.0, (0.5, 0.4, 0.2), 0.0, 0.2),
    'bone':        ('sun_marble', 0.6, (1.0, 0.95, 0.85), 0.55, 0.0, (1, 1, 0.95), 0.3, 0.6),
    'obsidian':    ('ash_dark_rock', 0.5, (0.25, 0.23, 0.25), 0.18, 0.0, (0.5, 0.45, 0.45), 0.4, 0.8),
    'ember':       ('ash_dark_rock', 0.5, (0.3, 0.12, 0.05), 0.6, 0.0, (0.5, 0.2, 0.1), 0.0, 0.5),
    'wood':        ('ash_wood', 0.5, (0.9, 0.8, 0.7), 0.7, 0.0, (0.7, 0.6, 0.5), 0.4, 1.0),
    'rope':        ('cloth_weave', 0.08, (0.9, 0.75, 0.55), 0.9, 0.0, (0.8, 0.7, 0.5), 0.2, 1.0),
}

EMISSIVE = {'glow': (1.0, 0.72, 0.35), 'ember': (1.0, 0.38, 0.08)}


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def composite(maps, ids, res, texels_per_m, covered, grime=0.5, ash=0.35, ash_color=(0.42, 0.4, 0.38), seed=3,
              emissive_strength=1.0):
    """maps: dict kind -> png path ('normal', 'ao', 'mat', 'curv', 'pos'). Returns dict of float arrays."""
    nrm = load_rgb(maps['normal'], res)
    ao = load_rgb(maps['ao'], res)[..., 0]
    mat = load_rgb(maps['mat'], res)
    curv = load_rgb(maps['curv'], res)[..., 0] if 'curv' in maps else np.full((res, res), 0.5, np.float32)
    height = load_rgb(maps['pos'], res)[..., 0] if 'pos' in maps else np.full((res, res), 0.5, np.float32)
    mid = decode_ids(mat, ids)
    albedo = np.zeros((res, res, 3), np.float32)
    rough = np.zeros((res, res), np.float32)
    metal = np.zeros((res, res), np.float32)
    detail_n = np.zeros((res, res, 3), np.float32)
    detail_s = np.zeros((res, res), np.float32)
    emis = np.zeros((res, res, 3), np.float32)
    n_big = noise2(res, 6, seed)
    n_mid = noise2(res, 24, seed + 1)
    n_fine = noise2(res, 90, seed + 2, octaves=2)
    # scratches: thin bright streaks in random directions
    scratches = np.zeros((res, res), np.float32)
    from PIL import ImageDraw
    sim = Image.new('L', (res, res), 0)
    d = ImageDraw.Draw(sim)
    rng = np.random.default_rng(seed + 9)
    for _ in range(int(res * 1.1)):
        x, y = rng.random(2) * res
        a = rng.random() * np.pi
        L = rng.uniform(4, 28) * res / 2048
        d.line([(x, y), (x + np.cos(a) * L, y + np.sin(a) * L)], fill=int(rng.uniform(60, 200)), width=1)
    scratches = np.asarray(sim, np.float32) / 255
    convex = smooth(0.56, 0.74, curv)
    concave = smooth(0.46, 0.3, curv)
    cavity = np.clip((1 - ao) * 1.3 + concave * 0.6, 0, 1)
    for i in ids:
        name = MATERIALS[i][0]
        if name not in LOOKS:
            continue
        sel = mid == i
        if not sel.any():
            continue
        dset, tile_m, tint, r0, m0, wear_col, wear_amt, nstr = LOOKS[name]
        c = tile_texture(dset + '_c', res, texels_per_m, tile_m)
        n = tile_texture(dset + '_n', res, texels_per_m, tile_m)
        o = tile_texture(dset + '_orm', res, texels_per_m, tile_m)
        lum = c.mean(-1, keepdims=True)
        if m0 > 0.5:
            base = (c * 0.35 + lum * 0.65) * np.array(tint, np.float32) * 1.25
        elif name in ('wool', 'linen', 'rope', 'cloth_red', 'mail'):
            # dyed cloth: keep the weave's light and shade, not its printed colours
            base = (lum / max(float(lum.mean()), 1e-3) * 0.5 + 0.5) * np.array(tint, np.float32)
        else:
            base = c * np.array(tint, np.float32)
        wear = np.clip(convex * (0.55 + 0.9 * n_mid) * wear_amt, 0, 1)
        if m0 > 0.5:
            wear = np.clip(wear + scratches * 0.35 * wear_amt, 0, 1)
        col = base * (1 - wear[..., None]) + np.array(wear_col, np.float32) * wear[..., None]
        r = np.clip(r0 * (0.75 + 0.5 * o[..., 1]) - wear * 0.12 + scratches * 0.05, 0.05, 1)
        albedo[sel] = col[sel]
        rough[sel] = r[sel]
        metal[sel] = m0
        detail_n[sel] = n[sel]
        detail_s[sel] = nstr
        if name in EMISSIVE:
            pulse = 0.6 + 0.4 * n_fine
            emis[sel] = np.array(EMISSIVE[name], np.float32) * pulse[sel][..., None] * emissive_strength
    # grime in cavities, soot and ash rising from the ground
    g = np.clip(cavity * grime * (0.6 + 0.6 * n_big), 0, 1)
    albedo = albedo * (1 - 0.6 * g[..., None])
    rough = np.clip(rough + g * 0.25, 0, 1)
    low = smooth(0.5, 0.05, height)
    ash_m = np.clip((low * 0.8 + n_big * 0.35 - 0.3) * ash * 2 + concave * ash * 0.5, 0, 1) * (0.5 + 0.5 * n_mid)
    ash_m *= np.where(metal > 0.5, 0.6, 1.0)
    albedo = albedo * (1 - ash_m[..., None]) + np.array(ash_color, np.float32) * ash_m[..., None]
    rough = np.clip(rough * (1 - ash_m) + 0.95 * ash_m, 0, 1)
    metal = metal * (1 - ash_m * 0.9)
    normal = blend_normals(nrm, detail_n, 1.0)
    normal = nrm * (1 - detail_s[..., None]) + normal * detail_s[..., None]
    nn = normal * 2 - 1
    nn /= np.maximum(np.linalg.norm(nn, axis=-1, keepdims=True), 1e-6)
    normal = nn * 0.5 + 0.5
    orm = np.dstack([np.clip(0.35 + 0.65 * ao, 0, 1), rough, metal])
    return {'albedo': albedo, 'normal': normal, 'orm': orm, 'emissive': emis, 'covered': covered}
