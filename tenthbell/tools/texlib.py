#!/usr/bin/env python3
"""Builds the game's shared texture library in tenthbell/public/assets/tex from Poly Haven (CC0) sets,
plus a few generated tiles (hair shells, hair strands, skin pores).

  python3 tenthbell/tools/texlib.py            # everything missing
  <id>_n.webp normal (OpenGL)   <id>_r.webp occlusion/roughness/metal   <id>_d.webp colour

Sets marked tint are stored as a neutral grey weave: the game multiplies them by each garment's colour.
"""
import os
import sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ph

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'tex'))

# id: (size, tint)
SETS = {
    'bi_stretch': (512, True), 'crepe_satin': (512, True), 'cotton_jersey': (512, True), 'rough_linen': (512, True),
    'poly_wool_herringbone': (512, True), 'stretch_poplin': (512, True), 'denim_fabric_04': (512, True),
    'brown_leather': (512, True), 'fabric_leather_02': (512, True),
    # arenas: real colour kept
    'bitumen': (1024, False), 'concrete_wall_003': (1024, False), 'brick_wall_006': (1024, False), 'metal_plate': (512, False),
    'rusty_metal_04': (512, False), 'corrugated_iron': (512, False), 'painted_metal_shutter': (512, False),
    'plank_flooring_02': (1024, False), 'brick_wall_001': (1024, False), 'beige_wall_001': (512, False), 'blue_metal_plate': (512, False),
    'concrete_floor_worn_001': (1024, False), 'concrete_wall_001': (1024, False), 'chipped_concrete': (512, False), 'rusty_metal_03': (512, False),
}


def webp(img, name, q=88):
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=q, method=6)


def build_set(i, size, tint, res='1k'):
    if os.path.exists(os.path.join(OUT, i + '_n.webp')):
        return
    f = ph.tex(i, res)
    webp(Image.open(f['nor_gl']).convert('RGB').resize((size, size), Image.LANCZOS), i + '_n', 90)
    webp(Image.open(f['arm']).convert('RGB').resize((size, size), Image.LANCZOS), i + '_r', 86)
    d = Image.open(f['diff']).convert('RGB').resize((size, size), Image.LANCZOS)
    if tint:  # keep only the weave's light and dark, centred on a bright grey
        g = np.asarray(d.convert('L'), np.float32)
        g = np.clip(g / g.mean() * 205, 0, 255).astype(np.uint8)
        d = Image.merge('RGB', [Image.fromarray(g)] * 3)
    webp(d, i + '_d', 86)
    print('set', i, flush=True)


def torus_points(n, s, seed):
    rng = np.random.default_rng(seed)
    pts = rng.random((n, 2)) * s
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    d2 = np.full((s, s), 1e9, np.float32)
    for px, py in pts:
        dx = np.minimum(np.abs(xx - px), s - np.abs(xx - px))
        dy = np.minimum(np.abs(yy - py), s - np.abs(yy - py))
        d2 = np.minimum(d2, dx * dx + dy * dy)
    return np.sqrt(d2)


def normal_from(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))


def generated():
    os.makedirs(OUT, exist_ok=True)
    s = 256
    # hair shells: every strand is a cone of alpha; the shell's height cuts it thinner towards the tip
    d = torus_points(520, s, 3)
    a = np.clip(1 - d / 5.2, 0, 1) ** 0.7
    Image.fromarray(np.dstack([np.full((s, s, 3), 255, np.uint8), (a * 255).astype(np.uint8)]), 'RGBA').save(os.path.join(OUT, 'shell.png'))
    # combed strands: fine ridges running along v
    rng = np.random.default_rng(5)
    col = np.cumsum(rng.normal(0, 1, s))
    col = np.convolve(np.tile(col - np.linspace(col[0], col[-1], s), 3), np.ones(3) / 3, 'same')[s:2 * s]
    fine = rng.normal(0, 1, s)
    h = np.tile((col * 0.35 + fine)[None, :], (s, 1)) + rng.normal(0, 0.12, (s, s))
    webp(normal_from(h.astype(np.float32), 0.55), 'strands_n', 92)
    # tight coils for afro hair
    k = torus_points(900, s, 9)
    webp(normal_from((np.sin(k * 1.9) * 0.5 + rng.normal(0, 0.1, (s, s))).astype(np.float32), 1.6), 'coils_n', 92)
    # skin pores as a Babylon detail map: R albedo, G normal y, B roughness, A normal x
    s2 = 512
    p = torus_points(1500, s2, 7)
    p = p / p.max()
    n = np.asarray(normal_from(p, 7.0), np.float32) / 255
    img = np.stack([0.5 + 0.25 * (p - p.mean()), n[..., 1], 0.5 - 0.35 * (p - p.mean()), n[..., 0]], -1)
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'pores.png'))
    # chain-link fence: wire diamonds, everything else cut away
    s3, ss = 256, 4
    from PIL import ImageDraw
    im = Image.new('L', (s3 * ss, s3 * ss), 0)
    dr = ImageDraw.Draw(im)
    n = 4
    for k in range(-n, 2 * n + 1):
        o = k * s3 * ss / n
        dr.line([(o, 0), (o + s3 * ss, s3 * ss)], fill=255, width=5 * ss // 2)
        dr.line([(o + s3 * ss, 0), (o, s3 * ss)], fill=255, width=5 * ss // 2)
    a = np.asarray(im.resize((s3, s3), Image.LANCZOS))
    Image.fromarray(np.dstack([np.full((s3, s3, 3), 150, np.uint8), a]), 'RGBA').save(os.path.join(OUT, 'fence.png'))
    # a city at night seen from far off: dark fronts with a scatter of lit windows
    w = np.zeros((256, 256, 3), np.uint8)
    w[:] = (5, 6, 9)
    for r in range(16):
        for c in range(16):
            if rng.random() < 0.3:
                col = (255, 200, 120) if rng.random() < 0.7 else (150, 200, 255)
                b = 0.35 + 0.65 * rng.random()
                w[r * 16 + 4:r * 16 + 12, c * 16 + 3:c * 16 + 12] = [int(v * b) for v in col]
    Image.fromarray(w).save(os.path.join(OUT, 'windows.png'))
    # the Pit's mark: a bell in a ring
    bn = Image.new('RGB', (256, 512), (14, 10, 10))
    dr = ImageDraw.Draw(bn)
    dr.rectangle([10, 10, 245, 501], outline=(120, 20, 20), width=6)
    dr.ellipse([48, 150, 208, 310], outline=(200, 190, 170), width=7)
    dr.pieslice([88, 180, 168, 270], 180, 360, fill=(200, 190, 170))
    dr.polygon([(88, 225), (168, 225), (180, 262), (76, 262)], fill=(200, 190, 170))
    dr.ellipse([118, 262, 138, 284], fill=(200, 190, 170))
    for i in range(10):   # ten tally strokes; the tenth is struck through nothing: it is missing
        if i < 9:
            dr.line([(52 + i * 17, 360), (52 + i * 17, 410)], fill=(200, 190, 170), width=5)
    Image.fromarray(np.asarray(bn)).save(os.path.join(OUT, 'banner.png'))
    print('generated tiles', flush=True)


if __name__ == '__main__':
    for i, (size, tint) in SETS.items():
        build_set(i, size, tint)
    if not os.path.exists(os.path.join(OUT, 'banner.png')) or '--gen' in sys.argv:
        generated()
