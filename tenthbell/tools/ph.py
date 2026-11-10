#!/usr/bin/env python3
"""Download Poly Haven (CC0) assets into a raw cache outside the repo.

  ph.py tex <id> [res=2k]    -> $RAW/tex/<id>/{diff,nor_gl,arm,disp}.jpg
  ph.py hdri <id> [res=1k]   -> $RAW/hdri/<id>_<res>.hdr
  ph.py model <id> [res=1k]  -> $RAW/model/<id>/<id>.gltf (+ bin + textures)
  ph.py find <type> <words>  -> ids whose name/tags/categories contain every word
"""
import json, os, sys, time, urllib.request

RAW = os.environ.get('PH_ROOT', '/opt/raw/ph')
API = 'https://api.polyhaven.com'


def get(url, dest=None):
    if dest and os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'asset-fetch'})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
            if dest is None:
                return data
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest + '.part', 'wb') as f:
                f.write(data)
            os.replace(dest + '.part', dest)
            return dest
        except Exception as e:  # the proxy drops connections now and then
            print('retry', url, e, file=sys.stderr)
            time.sleep(2 ** attempt)
    raise RuntimeError('failed ' + url)


def files(i):
    return json.loads(get(f'{API}/files/{i}'))


def tex(i, res='2k'):
    f, out = files(i), {}
    for key, name in (('Diffuse', 'diff'), ('nor_gl', 'nor_gl'), ('arm', 'arm'), ('Displacement', 'disp')):
        if key in f and res in f[key]:
            out[name] = get(f[key][res]['jpg']['url'], f'{RAW}/tex/{i}/{name}_{res}.jpg')
    return out


def hdri(i, res='1k'):
    return get(files(i)['hdri'][res]['hdr']['url'], f'{RAW}/hdri/{i}_{res}.hdr')


def model(i, res='1k'):
    g = files(i)['gltf'][res]['gltf']
    d = f'{RAW}/model/{i}_{res}'
    for rel, inc in g.get('include', {}).items():
        get(inc['url'], f'{d}/{rel}')
    return get(g['url'], f'{d}/{i}.gltf')


def find(kind, words):
    cache = f'{RAW}/index_{kind}.json'
    if not os.path.exists(cache):
        os.makedirs(RAW, exist_ok=True)
        open(cache, 'wb').write(get(f'{API}/assets?t={kind}'))
    for i, a in sorted(json.load(open(cache)).items()):
        hay = ' '.join([i, a.get('name', '')] + a.get('tags', []) + a.get('categories', [])).lower()
        if all(w in hay for w in words):
            print(i, '|', a.get('name'), '|', ','.join(a.get('categories', [])))


if __name__ == '__main__':
    cmd, a = sys.argv[1], sys.argv[2:]
    if cmd == 'find':
        find(a[0], [w.lower() for w in a[1:]])
    else:
        print({'tex': tex, 'hdri': hdri, 'model': model}[cmd](*a))
