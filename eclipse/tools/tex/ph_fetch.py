#!/usr/bin/env python3
"""Download CC0 textures / HDRIs from Poly Haven into the raw cache (outside the repo).

  python3 eclipse/tools/tex/ph_fetch.py tex  <id> [<id> ...] [--res 2k]
  python3 eclipse/tools/tex/ph_fetch.py hdri <id> [<id> ...] [--res 2k]
  python3 eclipse/tools/tex/ph_fetch.py list            # every texture id named in textures.json

Textures land in $ECLIPSE_RAW/ph/tex/<id>/{diff,nor_gl,arm,disp}.jpg (arm = AO / roughness / metal),
HDRIs in $ECLIPSE_RAW/ph/hdri/<id>.hdr. `tools/tex/build_textures.py` turns them into game textures.
Every asset on Poly Haven is CC0 (https://polyhaven.com/license).
"""
import hashlib
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

RAW = os.environ.get('ECLIPSE_RAW', '/opt/eclipse-raw')
API = 'https://api.polyhaven.com'
UA = {'User-Agent': 'eclipse-fallen-gods-asset-fetch/1.0'}
MAPS = {'diff': 'Diffuse', 'nor_gl': 'nor_gl', 'arm': 'arm', 'disp': 'Displacement'}


def get_json(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception as e:  # transient network errors: back off and retry
            print('retry', url, e, file=sys.stderr)
            time.sleep(2 ** attempt)
    raise RuntimeError('failed ' + url)


def fetch(url, dest, md5=None):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r, open(dest + '.part', 'wb') as f:
                h = hashlib.md5()
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    h.update(b)
                    f.write(b)
            if md5 and h.hexdigest() != md5:
                raise RuntimeError('md5 mismatch')
            os.replace(dest + '.part', dest)
            return dest
        except Exception as e:
            print('retry', url, e, file=sys.stderr)
            time.sleep(2 ** attempt)
    raise RuntimeError('failed ' + url)


def tex(asset, res):
    files = get_json(f'{API}/files/{asset}')
    out = []
    for short, key in MAPS.items():
        alts = [key] + (['col_1', 'coll1', 'col_01', 'Color'] if key == 'Diffuse' else [])
        entry = None
        for k in alts:
            entry = files.get(k, {}).get(res, {}).get('jpg') or files.get(k, {}).get(res, {}).get('png')
            if entry:
                break
        if not entry:
            print(f'{asset}: no {key} at {res}', file=sys.stderr)
            continue
        ext = os.path.splitext(entry['url'])[1]
        out.append((entry['url'], os.path.join(RAW, 'ph', 'tex', asset, short + ext), entry.get('md5')))
    return out


def hdri(asset, res):
    files = get_json(f'{API}/files/{asset}')
    entry = files['hdri'][res]['hdr']
    return [(entry['url'], os.path.join(RAW, 'ph', 'hdri', f'{asset}_{res}.hdr'), entry.get('md5'))]


def main():
    args = sys.argv[1:]
    res = '2k'
    if '--res' in args:
        i = args.index('--res')
        res = args[i + 1]
        del args[i:i + 2]
    kind, ids = args[0], args[1:]
    if kind == 'list':
        spec = json.load(open(os.path.join(os.path.dirname(__file__), 'textures.json')))
        print(' '.join(sorted({t['src'] for t in spec['textures']})))
        return
    jobs = []
    for a in ids:
        jobs += tex(a, res) if kind == 'tex' else hdri(a, res)
    with ThreadPoolExecutor(6) as ex:
        for p in ex.map(lambda j: fetch(*j), jobs):
            print(p)


if __name__ == '__main__':
    main()
