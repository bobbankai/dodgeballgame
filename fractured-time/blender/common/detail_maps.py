"""
Tileable micro-detail maps generated in-house (numpy): skin pores, fine wrinkles, fabric weave. Used as detail normal maps on top of each
material's base maps, both in Cycles review renders and in the game's TSL shaders (same files), so pore-level detail exists without
needing multi-gigabyte unique textures.
"""
import os

import numpy as np

try:
    import bpy
except ImportError:  # usable outside Blender too
    bpy = None


def _rng(seed):
    return np.random.default_rng(seed)


def _tile_noise(n, freq, seed):
    """Tileable value noise via random lattice + periodic cubic interpolation."""
    r = _rng(seed)
    g = r.random((freq, freq))
    xs = np.arange(n) * freq / n
    i0 = np.floor(xs).astype(int)
    f = xs - i0
    s = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % freq
    a = g[np.ix_(i0, i0)]
    b = g[np.ix_(i0, i1)]
    c = g[np.ix_(i1, i0)]
    d = g[np.ix_(i1, i1)]
    sy = s[:, None]
    sx = s[None, :]
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy


def fbm(n, base, octaves, seed):
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * _tile_noise(n, base * 2 ** o, seed + o)
        tot += amp
        amp *= 0.5
    return out / tot


def pores_height(n=1024, count=5200, seed=3):
    """Skin micro relief: shallow pores (tileable Worley pits) + fine creases + a soft noise base. Returns height in [0,1]."""
    r = _rng(seed)
    pts = r.random((count, 2)) * n
    h = np.zeros((n, n))
    yy, xx = np.mgrid[0:n, 0:n]
    # splat each pore as a small gaussian pit (wrapping at the edges keeps it tileable)
    rad = r.uniform(1.1, 2.6, count)
    depth = r.uniform(0.35, 1.0, count)
    for (px, py), rr, dd in zip(pts, rad, depth):
        x0, x1 = int(px - 4 * rr), int(px + 4 * rr) + 1
        y0, y1 = int(py - 4 * rr), int(py + 4 * rr) + 1
        xs = np.arange(x0, x1) % n
        ys = np.arange(y0, y1) % n
        gx = (np.arange(x0, x1) - px) ** 2
        gy = (np.arange(y0, y1) - py) ** 2
        h[np.ix_(ys, xs)] -= dd * np.exp(-(gy[:, None] + gx[None, :]) / (2 * rr * rr))
    # fine creases: thin ridged noise lines
    cre = fbm(n, 24, 3, seed + 11)
    creases = 1.0 - np.abs(cre * 2 - 1)
    h += 0.35 * (creases ** 6)
    h += 0.25 * fbm(n, 64, 2, seed + 21)
    h -= h.min()
    h /= max(h.max(), 1e-6)
    return h


def weave_height(n=512, threads=48, seed=5):
    """Knit/twill-like fabric relief (tileable)."""
    y, x = np.mgrid[0:n, 0:n] / n * threads * 2 * np.pi
    warp = 0.5 + 0.5 * np.sin(x) * np.sign(np.sin(y * 0.5))
    weft = 0.5 + 0.5 * np.sin(y) * np.sign(np.cos(x * 0.5))
    h = np.maximum(warp, weft) + 0.15 * fbm(n, 32, 2, seed)
    h -= h.min()
    return h / h.max()


def height_to_normal(h, strength=4.0):
    """OpenGL-convention tangent-space normal map (tileable gradients)."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength
    nx, ny, nz = -dx, dy, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=-1)


def save_png(arr, path):
    """Save an HxWx{1,3} array in [0,1] as PNG (needs Blender's image API; PIL fallback outside Blender)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, axis=-1)
    hgt, wid = arr.shape[:2]
    if bpy is not None:
        img = bpy.data.images.new(os.path.basename(path), wid, hgt, alpha=True)
        rgba = np.concatenate([arr[::-1], np.ones((hgt, wid, 1))], axis=-1).astype(np.float32)
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = path
        img.file_format = 'PNG'
        img.save()
        bpy.data.images.remove(img)
    else:
        from PIL import Image
        Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).save(path)
    return path


def ensure_skin_detail(out_dir):
    n_path = os.path.join(out_dir, 'skin_pores_n.png')
    if not os.path.exists(n_path):
        h = pores_height()
        save_png(height_to_normal(h, strength=6.0), n_path)
        save_png(h, os.path.join(out_dir, 'skin_pores_h.png'))
    return n_path


def ensure_weave_detail(out_dir):
    n_path = os.path.join(out_dir, 'fabric_weave_n.png')
    if not os.path.exists(n_path):
        save_png(height_to_normal(weave_height(), strength=3.0), n_path)
    return n_path
