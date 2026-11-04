#!/usr/bin/env python3
"""Pack Poly Haven tiling textures into game sets (run with /opt/venv/bin/python).

  texprep.py <id> [size=1024] [name]
    -> emberfall/public/assets/tex/<name>_c.webp  (base colour, sRGB)
       emberfall/public/assets/tex/<name>_n.webp  (OpenGL normal)
       emberfall/public/assets/tex/<name>_orm.webp (R=AO, G=roughness, B=metal, as glTF / three expect)
       emberfall/public/assets/tex/<name>_h.webp  (height, for height-blended terrain layers)
"""
import os
import sys
from PIL import Image

ROOT = '/opt/raw/ph/tex'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'tex')


def load(path, size, mode):
    im = Image.open(path)
    if im.mode not in ('RGB', 'RGBA', 'L', 'I;16', 'I'):
        im = im.convert('RGB')
    if mode == 'L':
        if im.mode in ('I;16', 'I'):
            im = im.point(lambda v: v * (1 / 256)).convert('L')
        else:
            im = im.convert('L')
    else:
        im = im.convert(mode)
    return im.resize((size, size), Image.LANCZOS)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    asset = args[0]
    size = int(args[1]) if len(args) > 1 else 1024
    name = args[2] if len(args) > 2 else asset
    d = os.path.join(ROOT, asset)
    os.makedirs(OUT, exist_ok=True)

    def find(stem):
        for ext in ('jpg', 'png'):
            p = os.path.join(d, f'{stem}.{ext}')
            if os.path.exists(p):
                return p
        return None

    col = load(find('diff'), size, 'RGB')
    if '--gray' in sys.argv:
        # neutral albedo for tinting: keep the luminance structure, normalise its mean to ~0.72 (sRGB)
        import numpy as np
        a = np.asarray(col.convert('L'), dtype=np.float32) / 255.0
        a = a / max(a.mean(), 1e-3) * 0.72
        a = np.clip(a, 0, 1)
        col = Image.fromarray((a * 255).astype('uint8'), 'L').convert('RGB')
    col.save(os.path.join(OUT, f'{name}_c.webp'), quality=90, method=6)
    load(find('nor_gl'), size, 'RGB').save(os.path.join(OUT, f'{name}_n.webp'), quality=94, method=6)
    arm = find('arm')
    if arm:
        orm = load(arm, size, 'RGB')
    else:
        ao = load(find('ao'), size, 'L') if find('ao') else Image.new('L', (size, size), 255)
        rough = load(find('rough'), size, 'L') if find('rough') else Image.new('L', (size, size), 200)
        orm = Image.merge('RGB', (ao, rough, Image.new('L', (size, size), 0)))
    orm.save(os.path.join(OUT, f'{name}_orm.webp'), quality=90, method=6)
    if find('disp'):
        load(find('disp'), size // 2, 'L').save(os.path.join(OUT, f'{name}_h.webp'), quality=90, method=6)
    print('ok', name)


if __name__ == '__main__':
    main()
