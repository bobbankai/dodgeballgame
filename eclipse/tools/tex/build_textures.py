#!/usr/bin/env python3
"""Turn the raw Poly Haven downloads into game textures.

  /opt/bvenv/bin/python eclipse/tools/tex/build_textures.py [--only id,id] [--force]

For every set in textures.json writes, into eclipse/public/assets/tex:
  <id>_c.webp    albedo (sRGB)
  <id>_n.webp    tangent-space normal, OpenGL convention (+Y up), as glTF and Babylon expect
  <id>_orm.webp  R = ambient occlusion, G = roughness, B = metalness (Poly Haven's ARM map)
  <id>_h.webp    height, only for sets with "height": true (parallax occlusion)
and a manifest (tex/manifest.json) with the average albedo and roughness of each set, used to pick
fallback colours and to tint distant LODs.
"""
import json
import os
import sys

from PIL import Image, ImageStat

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.environ.get('ECLIPSE_RAW', '/opt/eclipse-raw')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'public', 'assets', 'tex'))


def load(path):
    for ext in ('.jpg', '.png'):
        p = path + ext
        if os.path.exists(p):
            return Image.open(p)
    return None


def save(img, path, quality, lossless=False):
    img.save(path, 'WEBP', quality=quality, method=6, lossless=lossless)


def build(entry, force=False):
    tid, src, size = entry['id'], entry['src'], entry.get('size', 1024)
    raw = os.path.join(RAW, 'ph', 'tex', src)
    outs = {k: os.path.join(OUT, f'{tid}_{k}.webp') for k in ('c', 'n', 'orm', 'h')}
    if not force and all(os.path.exists(outs[k]) for k in ('c', 'n', 'orm')):
        return None
    diff, nor, arm = load(os.path.join(raw, 'diff')), load(os.path.join(raw, 'nor_gl')), load(os.path.join(raw, 'arm'))
    if diff is None or nor is None:
        print('missing raw maps for', tid, src, file=sys.stderr)
        return None
    resample = Image.Resampling.LANCZOS
    c = diff.convert('RGB').resize((size, size), resample)
    save(c, outs['c'], 90)
    n = nor.convert('RGB').resize((size, size), resample)
    save(n, outs['n'], 94)
    if arm is not None:
        orm = arm.convert('RGB').resize((size, size), resample)
    else:
        orm = Image.new('RGB', (size, size), (255, 200, 0))
    save(orm, outs['orm'], 92)
    if entry.get('height'):
        disp = load(os.path.join(raw, 'disp'))
        if disp is not None:
            save(disp.convert('L').resize((size, size), resample), outs['h'], 92)
    stat = ImageStat.Stat(c.resize((64, 64)))
    rough = ImageStat.Stat(orm.split()[1].resize((64, 64))).mean[0] / 255
    return {'id': tid, 'src': src, 'size': size, 'albedo': [round(v / 255, 4) for v in stat.mean],
            'roughness': round(rough, 3), 'height': bool(entry.get('height')), 'region': entry.get('region')}


def main():
    args = sys.argv[1:]
    force = '--force' in args
    only = None
    if '--only' in args:
        only = set(args[args.index('--only') + 1].split(','))
    spec = json.load(open(os.path.join(HERE, 'textures.json')))
    os.makedirs(OUT, exist_ok=True)
    man_path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    for e in spec['textures']:
        if only and e['id'] not in only:
            continue
        info = build(e, force)
        if info:
            manifest[e['id']] = info
            print('built', e['id'])
    json.dump(manifest, open(man_path, 'w'), indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
