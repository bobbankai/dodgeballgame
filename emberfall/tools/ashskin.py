#!/usr/bin/env python3
"""Ash skin for the Hollow: MakeHuman skin -> desaturated grey-blue ash with soot and fine fissures.
Run with /opt/venv/bin/python:  ashskin.py <skin.png> <out.png>"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB').resize((2048, 2048), Image.LANCZOS)
a = np.asarray(im, dtype=np.float32) / 255.0
lum = a @ np.array([0.3, 0.55, 0.15])
rng = np.random.default_rng(3)
# large soot blotches + fine grain
noise = np.asarray(Image.fromarray((rng.random((128, 128)) * 255).astype('uint8')).resize((2048, 2048), Image.BICUBIC), dtype=np.float32) / 255.0
grain = rng.random((2048, 2048)) * 0.08
base = np.stack([lum * 0.62 + 0.06, lum * 0.62 + 0.07, lum * 0.66 + 0.09], axis=-1)
base *= (0.75 + 0.35 * noise[..., None]) * (0.96 + grain[..., None])
# fissures: thin dark lines from a distorted voronoi field
cells = 140
pts = rng.random((cells, 2)) * 2048
yy, xx = np.mgrid[0:2048:4, 0:2048:4].astype(np.float32)
d1 = np.full(xx.shape, 1e9, np.float32)
d2 = np.full(xx.shape, 1e9, np.float32)
for p in pts:
    d = (xx - p[0]) ** 2 + (yy - p[1]) ** 2
    m = d < d1
    d2 = np.where(m, d1, np.minimum(d2, d))
    d1 = np.where(m, d, d1)
edge = np.sqrt(d2) - np.sqrt(d1)
crack = np.clip(1 - edge / 6.0, 0, 1)
crack = np.asarray(Image.fromarray((crack * 255).astype('uint8')).resize((2048, 2048), Image.BILINEAR), dtype=np.float32) / 255.0
base *= 1 - crack[..., None] * 0.55
Image.fromarray((np.clip(base, 0, 1) * 255).astype('uint8')).save(out)
Image.fromarray((crack * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2)).convert('RGB').save(out.replace('.png', '_cracks.png'))
print('ash ok', out)
