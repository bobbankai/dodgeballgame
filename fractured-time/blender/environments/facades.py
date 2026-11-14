"""
Procedural facade texture sets for distant towers (the skyline): window grids per era written as PBR sets in the same layout as the
Poly Haven downloads (vendor/polyhaven/textures/<id>/<id>_{diff,nor_gl,rough}_2k.jpg), so envkit.mat() / garments.pbr() and the
engine's pbr recipe use them unchanged. One tile = 12 m x 12 m (4 storeys of 3 m, 8 bays of 1.5 m): material tile = 1/12 per metre.
Run headless in Blender (numpy + bpy images) or plain Python with numpy + Pillow.
"""
import os

import numpy as np

ERAS = {
    # frame colour, glass colour, glass variation, broken-window rate, blinds rate, mullion width (fraction of bay), spandrel height
    'facade_modern': ((0.42, 0.44, 0.46), (0.05, 0.07, 0.09), 0.25, 0.03, 0.15, 0.06, 0.18),
    'facade_concrete': ((0.46, 0.45, 0.43), (0.06, 0.065, 0.07), 0.35, 0.12, 0.25, 0.18, 0.32),
    'facade_brick': ((0.36, 0.2, 0.14), (0.05, 0.05, 0.055), 0.35, 0.1, 0.35, 0.22, 0.36),
    'facade_ruin': ((0.3, 0.3, 0.29), (0.012, 0.012, 0.014), 0.2, 0.55, 0.05, 0.2, 0.34),
}


def make(root, size=2048, seed=0):
    from PIL import Image
    rng = np.random.default_rng(seed)
    for key, (frame, glass, gvar, broken, blinds, mull, span) in ERAS.items():
        out = os.path.join(root, key)
        os.makedirs(out, exist_ok=True)
        H = W = size
        y, x = np.mgrid[0:H, 0:W] / size  # 0..1 over 12 m
        fy = (y * 4) % 1.0  # storey coordinate (0 = floor line)
        bx = (x * 8) % 1.0  # bay coordinate
        cell_r = np.floor(y * 4).astype(int)
        cell_c = np.floor(x * 8).astype(int)
        # per-window random draws
        rnd = rng.random((4, 8, 4))
        R = rnd[cell_r, cell_c]
        is_glass = (fy > span) & (fy < 0.94) & (np.abs(bx - 0.5) < 0.5 - mull / 2)
        # glass: base colour varied per window, a vertical sky-reflection gradient, some blinds (lighter), some broken (black)
        g = np.array(glass)[None, None, :] * (1 + (R[..., 0:1] - 0.5) * 2 * gvar)
        g = g * (0.8 + 0.4 * (1 - fy[..., None]))
        g = np.where((R[..., 1:2] < blinds), g + np.array([0.18, 0.17, 0.15]) * (0.5 + 0.5 * ((fy[..., None] * 40) % 1 > 0.4)), g)
        g = np.where((R[..., 2:3] < broken), np.array([0.008, 0.008, 0.009]), g)
        # frame: colour with grime streaks running down from the window sills and noise
        noise = rng.random((H // 8, W // 8))
        noise = np.kron(noise, np.ones((8, 8)))[:H, :W]
        streak = np.clip(1 - ((fy - span) % 1.0) * 3, 0, 1) * (np.abs(bx - 0.5) < 0.4)
        f = np.array(frame)[None, None, :] * (0.85 + 0.25 * noise[..., None]) * (1 - 0.25 * streak[..., None])
        col = np.where(is_glass[..., None], g, f)
        # spandrel line (darker band at each floor slab)
        col = np.where(((fy < 0.035) | (fy > 0.985))[..., None], col * 0.6, col)
        rough = np.where(is_glass, 0.06 + 0.1 * R[..., 3], 0.75 + 0.15 * noise)
        rough = np.where(is_glass & (R[..., 2] < broken), 0.9, rough)
        # normal: windows recessed (a simple bevel at the glass edge from the distance field), flat elsewhere
        edge_x = np.minimum(np.abs(bx - (0.5 - (0.5 - mull / 2))), np.abs(bx - (0.5 + (0.5 - mull / 2))))
        nx = np.where(is_glass & (edge_x < 0.04), np.sign(bx - 0.5) * 0.5, 0.0)
        nrm = np.stack([nx, np.zeros_like(nx), np.ones_like(nx)], -1)
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
        to8 = lambda a: (np.clip(a, 0, 1) * 255).astype(np.uint8)  # noqa: E731
        srgb = np.where(col <= 0.0031308, col * 12.92, 1.055 * np.power(np.clip(col, 0, 1), 1 / 2.4) - 0.055)
        Image.fromarray(to8(srgb[::-1])).save(os.path.join(out, f'{key}_diff_2k.jpg'), quality=92)
        Image.fromarray(to8(np.repeat(rough[::-1, :, None], 3, -1))).save(os.path.join(out, f'{key}_rough_2k.jpg'), quality=92)
        Image.fromarray(to8((nrm[::-1] * 0.5 + 0.5))).save(os.path.join(out, f'{key}_nor_gl_2k.jpg'), quality=92)
        print('facade', key)


if __name__ == '__main__':
    import sys
    make(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'vendor', 'polyhaven', 'textures'))
