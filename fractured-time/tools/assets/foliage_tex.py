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
    else:
        im.save(j['dst'], quality=90)
    print('tex', os.path.basename(j['dst']))
