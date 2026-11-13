"""Skin texture painting from baked feature masks (numpy).

Masks (baked from per-vertex feature masks into the head's UV space):
  mA = (lips, lids, brow), mB = (cheek, nose, beard), mC = (scalp, ears, scar)
plus a self-occlusion AO bake. Produces albedo, normal (pores, stubble, scar) and ORM.
"""
import numpy as np
from PIL import Image

from bake import load_rgb, noise2, speckle


def height_to_normal(h, strength):
    gy, gx = np.gradient(h)
    n = np.dstack([-gx * strength, gy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def paint(maps, res, look):
    """look: dict(base, lip, blush, hair, scar, stubble, ash, seed)."""
    mA = load_rgb(maps['mA'], res)
    mB = load_rgb(maps['mB'], res)
    mC = load_rgb(maps['mC'], res)
    ao = load_rgb(maps['ao'], res)[..., 0]
    lips, lids, brow = mA[..., 0], mA[..., 1], mA[..., 2]
    cheek, nose, beard = mB[..., 0], mB[..., 1], mB[..., 2]
    scalp, ears, scar = mC[..., 0], mC[..., 1], mC[..., 2]
    if 'mD' in maps:
        mD = load_rgb(maps['mD'], res)
        brows = mD[..., 0]
    else:
        brows = np.zeros_like(scalp)
    seed = look.get('seed', 11)
    n_big = noise2(res, 5, seed)
    n_mid = noise2(res, 20, seed + 1)
    n_fine = speckle(res, 0.10, seed + 2, 0.6)
    n_pore = speckle(res, 0.22, seed + 3, 0.9)
    base = np.array(look['base'], np.float32)
    alb = base * (0.94 + 0.12 * n_big[..., None]) * (0.97 + 0.06 * n_mid[..., None])
    # warm, slightly reddened areas: cheeks, nose, ears
    red = np.clip(cheek * 0.55 + nose * 0.7 + ears * 0.6, 0, 1) * look.get('flush', 0.35)
    alb = alb * (1 - red[..., None]) + np.array(look['blush'], np.float32) * red[..., None]
    alb = alb * (1 - lips[..., None] * 0.85) + np.array(look['lip'], np.float32) * (lips[..., None] * 0.85)
    alb = alb * (1 - lids[..., None] * 0.18) + np.array(look['blush'], np.float32) * 0.85 * (lids[..., None] * 0.18)
    # stubble: dense dark specks plus a shadow tint over the beard area
    st = look.get('stubble', 0.8)
    specks = n_fine * beard * st
    alb = alb * (1 - beard[..., None] * 0.18 * st) * (1 - specks[..., None] * 0.55)
    hair = np.array(look['hair'], np.float32)
    # painted eyebrows: dense short strokes, softened at the edges
    from PIL import ImageFilter
    bsoft = np.asarray(Image.fromarray((brows * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(res / 512)), np.float32) / 255
    bstrokes = speckle(res, 0.35, seed + 7, 0.8)
    bmask = np.clip(bsoft * (0.55 + 0.7 * bstrokes), 0, 1) * look.get('brow', 0.85)
    alb = alb * (1 - bmask[..., None]) + hair * 0.8 * bmask[..., None]
    # denser stubble towards the jaw and moustache
    dense = speckle(res, 0.2, seed + 9, 0.7) * beard * st * 0.6
    alb = alb * (1 - dense[..., None] * 0.5)
    alb = alb * (1 - scalp[..., None] * 0.9) + hair * (scalp[..., None] * 0.9)
    # scar: pale, slightly pink, smoother
    sc = np.clip(scar, 0, 1)
    alb = alb * (1 - sc[..., None] * 0.6) + np.array(look['scar'], np.float32) * (sc[..., None] * 0.6)
    # ash and grime smudges
    ash = np.clip((n_big * 0.6 + n_mid * 0.6 - 0.75) * 2.5, 0, 1) * look.get('ash', 0.25)
    alb = alb * (1 - ash[..., None]) + np.array((0.32, 0.3, 0.29), np.float32) * ash[..., None]
    alb *= (0.55 + 0.45 * ao)[..., None]
    # normal detail: pores everywhere (less on lips and scar), stubble bumps, scar groove
    h = -n_pore * 0.35 * (1 - lips * 0.8) * (1 - sc * 0.7) + specks * 0.4 - sc * 0.8
    normal = height_to_normal(h, look.get('pore_strength', 0.9))
    rough = 0.52 + 0.08 * n_mid - 0.1 * (nose + brow * 0.5) * 0.6 - 0.12 * lips + 0.1 * beard + 0.15 * scalp + 0.08 * ash
    orm = np.dstack([np.clip(0.4 + 0.6 * ao, 0, 1), np.clip(rough, 0.25, 0.9), np.zeros_like(ao)])
    return {'albedo': np.clip(alb, 0, 1), 'normal': normal, 'orm': orm}


def save_webp(arr, path, q=92):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path, 'WEBP', quality=q, method=6)
    return path
