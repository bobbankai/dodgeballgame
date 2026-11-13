#!/usr/bin/env python3
"""Download Poly Haven (CC0) assets.  Usage:
  polyhaven.py textures <id> [res=2k]     -> vendor/polyhaven/textures/<id>/<id>_<map>_<res>.jpg|png (diff, nor_gl, rough, ao, arm, disp, metal)
  polyhaven.py hdri <id> [res=2k]         -> vendor/polyhaven/hdri/<id>_<res>.hdr
  polyhaven.py models <id> [res=2k]       -> vendor/polyhaven/models/<id>/ (gltf + textures)
  polyhaven.py search <type> <words...>   -> list ids whose name/tags/categories match
"""
import json, os, sys, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'vendor', 'polyhaven')
API = 'https://api.polyhaven.com'
UA = {'User-Agent': 'fractured-time-asset-fetch/1.0'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def save(url, path):
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = get(url)
    with open(path, 'wb') as f:
        f.write(data)
    print('  saved', os.path.relpath(path), len(data) // 1024, 'KB')
    return path


def textures(aid, res='2k'):
    files = json.loads(get(f'{API}/files/{aid}'))
    want = {'Diffuse': 'diff', 'nor_gl': 'nor_gl', 'Rough': 'rough', 'AO': 'ao', 'arm': 'arm', 'Displacement': 'disp', 'Metal': 'metal'}
    out = {}
    for key, short in want.items():
        if key not in files or res not in files[key]:
            continue
        fmt = 'jpg' if 'jpg' in files[key][res] else 'png'
        url = files[key][res][fmt]['url']
        out[short] = save(url, os.path.join(ROOT, 'textures', aid, f'{aid}_{short}_{res}.{fmt}'))
    return out


def hdri(aid, res='2k'):
    files = json.loads(get(f'{API}/files/{aid}'))
    url = files['hdri'][res]['hdr']['url']
    return save(url, os.path.join(ROOT, 'hdri', f'{aid}_{res}.hdr'))


def models(aid, res='2k'):
    files = json.loads(get(f'{API}/files/{aid}'))
    g = files['gltf'][res]['gltf']
    d = os.path.join(ROOT, 'models', aid)
    save(g['url'], os.path.join(d, os.path.basename(g['url'])))
    for rel, inc in g.get('include', {}).items():
        save(inc['url'], os.path.join(d, rel))
    return d


def search(kind, words):
    assets = json.loads(get(f'{API}/assets?t={kind}'))
    for aid, a in assets.items():
        hay = ' '.join([aid, a.get('name', '')] + a.get('tags', []) + a.get('categories', [])).lower()
        if all(w.lower() in hay for w in words):
            print(aid, '|', a.get('name'), '|', ','.join(a.get('categories', [])))


if __name__ == '__main__':
    cmd, *args = sys.argv[1:]
    if cmd == 'search':
        search(args[0], args[1:])
    else:
        r = {'textures': textures, 'hdri': hdri, 'models': models}[cmd](*args)
        print(json.dumps(r, indent=1) if isinstance(r, dict) else r)
