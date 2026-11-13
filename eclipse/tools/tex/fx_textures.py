#!/usr/bin/env python3
"""Procedural effect textures (lens dirt, flipbooks, noise) -> public/assets/tex/fx_*.webp.

  /opt/bvenv/bin/python eclipse/tools/tex/fx_textures.py [name ...]
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'tex'))


def save(img, name, q=88):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name + '.webp')
    img.save(p, 'WEBP', quality=q, method=6)
    print('wrote', p)


def lens_dirt(res=1024, seed=7):
    """Smudges, dust specks and faint hexagonal bokeh blobs, mostly towards the edges."""
    rng = np.random.default_rng(seed)
    base = Image.new('RGB', (res, res), (0, 0, 0))
    d = ImageDraw.Draw(base, 'RGBA')
    for _ in range(90):  # soft smudges
        x, y = rng.random(2) * res
        r = rng.uniform(40, 170)
        a = int(rng.uniform(6, 22))
        c = tuple(int(v) for v in rng.uniform(170, 255, 3))
        d.ellipse([x - r, y - r * rng.uniform(0.4, 1), x + r, y + r], fill=c + (a,))
    base = base.filter(ImageFilter.GaussianBlur(28))
    d = ImageDraw.Draw(base, 'RGBA')
    for _ in range(70):  # hexagonal bokeh ghosts
        x, y = rng.random(2) * res
        r = rng.uniform(10, 48)
        ang = rng.random() * np.pi
        pts = [(x + r * np.cos(ang + k * np.pi / 3), y + r * np.sin(ang + k * np.pi / 3)) for k in range(6)]
        d.polygon(pts, fill=(255, 245, 225, int(rng.uniform(10, 40))))
    for _ in range(900):  # dust specks
        x, y = rng.random(2) * res
        r = rng.uniform(0.6, 3.2)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, int(rng.uniform(40, 160))))
    img = base.filter(ImageFilter.GaussianBlur(1.2))
    a = np.asarray(img, np.float32) / 255
    yy, xx = np.mgrid[0:res, 0:res] / res - 0.5
    edge = np.clip(np.hypot(xx, yy) * 1.7, 0.25, 1.0)[..., None]
    a = np.clip(a * edge * 1.6, 0, 1)
    save(Image.fromarray((a * 255).astype(np.uint8)), 'fx_lens_dirt')


JOBS = {'lens_dirt': lens_dirt}

if __name__ == '__main__':
    names = sys.argv[1:] or list(JOBS)
    for n in names:
        JOBS[n]()
