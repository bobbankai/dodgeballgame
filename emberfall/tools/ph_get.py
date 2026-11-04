#!/usr/bin/env python3
"""Download Poly Haven (CC0) assets into the raw asset cache.

  python3 emberfall/tools/ph_get.py tex  <id> [res=2k]   -> /opt/raw/ph/tex/<id>/{diff,nor_gl,arm,disp}.jpg|png
  python3 emberfall/tools/ph_get.py model <id> [res=2k]  -> /opt/raw/ph/model/<id>/<id>.gltf (+ bin + textures)
  python3 emberfall/tools/ph_get.py hdri <id> [res=2k]   -> /opt/raw/ph/hdri/<id>.hdr

Every asset on Poly Haven is CC0. The raw cache lives outside the repo; Blender scripts read it and
write the game-ready GLBs / textures into emberfall/public/assets.
"""
import json
import os
import sys
import time
import urllib.request

ROOT = os.environ.get('PH_ROOT', '/opt/raw/ph')


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'emberfall-asset-fetch'})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest + '.part', 'wb') as f:
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
            os.replace(dest + '.part', dest)
            return dest
        except Exception as e:  # network hiccups: back off and retry
            print('retry', url, e, file=sys.stderr)
            time.sleep(2 ** attempt)
    raise RuntimeError('failed ' + url)


def files(asset_id):
    req = urllib.request.Request(f'https://api.polyhaven.com/files/{asset_id}', headers={'User-Agent': 'emberfall-asset-fetch'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def get_tex(asset_id, res='2k'):
    f = files(asset_id)
    out = os.path.join(ROOT, 'tex', asset_id)
    maps = {'Diffuse': 'diff', 'nor_gl': 'nor_gl', 'arm': 'arm', 'Displacement': 'disp', 'Rough': 'rough', 'AO': 'ao'}
    got = {}
    for key, name in maps.items():
        if key not in f:
            continue
        r = f[key].get(res) or f[key].get('1k')
        fmt = 'jpg' if 'jpg' in r else 'png'
        got[name] = fetch(r[fmt]['url'], os.path.join(out, f'{name}.{fmt}'))
    print(json.dumps(got))
    return got


def get_model(asset_id, res='2k'):
    f = files(asset_id)
    g = f['gltf'].get(res) or f['gltf'].get('1k')
    g = g['gltf']
    out = os.path.join(ROOT, 'model', asset_id)
    fetch(g['url'], os.path.join(out, os.path.basename(g['url'])))
    for rel, inc in g.get('include', {}).items():
        fetch(inc['url'], os.path.join(out, rel))
    print(out)
    return out


def get_hdri(asset_id, res='2k'):
    f = files(asset_id)
    r = f['hdri'].get(res) or f['hdri'].get('1k')
    dest = os.path.join(ROOT, 'hdri', f'{asset_id}_{res}.hdr')
    fetch(r['hdr']['url'], dest)
    print(dest)
    return dest


if __name__ == '__main__':
    kind, asset_id = sys.argv[1], sys.argv[2]
    res = sys.argv[3] if len(sys.argv) > 3 else '2k'
    {'tex': get_tex, 'model': get_model, 'hdri': get_hdri}[kind](asset_id, res)
