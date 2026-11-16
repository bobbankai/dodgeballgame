#!/usr/bin/env python3
"""Second half of blender/props/foliage.py (Blender's Python has no PIL): resize the foliage maps to 1k and build the twig cards'
RGBA textures, the alpha rasterised from the twig islands' UV triangles (dilated a little, softened for clean mips)."""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TEX = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'props', 'foliage', 'tex')
jobs = json.load(open(os.path.join(TEX, '_jobs.json')))
for j in jobs:
    if os.path.exists(j['dst']) and '--force' not in sys.argv:
        continue
    im = Image.open(j['src']).convert('RGB').resize((j['size'], j['size']), Image.LANCZOS)
    os.makedirs(os.path.dirname(j['dst']), exist_ok=True)
    if j.get('mask'):
        R = 1536
        mask = Image.new('L', (R, R), 0)
        dr = ImageDraw.Draw(mask)
        for tri in np.load(j['mask']):
            dr.polygon([(float(u * R), float((1 - v) * R)) for u, v in tri], fill=255)
        mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.0))
        im.putalpha(mask.resize((j['size'], j['size']), Image.LANCZOS))
        im.save(j['dst'])
    elif j.get('alpha'):
        a = Image.open(j['alpha']).convert('L').resize((j['size'], j['size']), Image.LANCZOS)
        # bleed the leaf colour out under the transparent background (the source is black there): filtered and mipmapped
        # samples near the cut edge then stay leaf-coloured instead of darkening into a black fringe
        rgb = np.asarray(im, np.float32)
        w = (np.asarray(a, np.float32) / 255.0 > 0.35).astype(np.float32)
        acc, wsum = rgb * w[..., None], w.copy()
        for r_ in (2, 4, 8, 16, 32, 64):
            k = Image.fromarray((wsum * 255).clip(0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(r_))
            kw = np.asarray(k, np.float32) / 255.0
            kc = np.stack([np.asarray(Image.fromarray(acc[..., c].clip(0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(r_)), np.float32)
                           for c in range(3)], -1)
            fill = (wsum < 0.5)
            est = kc / np.maximum(kw[..., None], 1e-4)
            take = fill & (kw > 0.02)
            acc[take] = est[take]
            wsum[take] = 1.0
        out = Image.fromarray(acc.clip(0, 255).astype(np.uint8))
        out.putalpha(a)
        out.save(j['dst'])
    else:
        im.save(j['dst'], quality=90)
    print('tex', os.path.basename(j['dst']))
