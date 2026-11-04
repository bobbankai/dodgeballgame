#!/usr/bin/env python3
"""Prepare a self-contained build of Emberfall for hosting as a claude.ai Artifact.

  python3 emberfall/tools/publish_prep.py <outdir>

- production build (relative base) into <outdir>/site
- drops texture sets nothing references (dev arena, unbuilt chapters) and height maps of non-terrain sets
- repacks every GLB without EXT_meshopt_compression (the host may not allow WebAssembly; the geometry
  stays quantized, which three.js reads natively)
- writes <outdir>/site/page.html (the page body for the Artifact skeleton) and <outdir>/batches.json
  (upload batches under the per-publish limits: 250 files, 60 MB)
"""
import glob
import json
import os
import re
import shutil
import struct
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
EMB = os.path.join(ROOT, 'emberfall')
out = os.path.abspath(sys.argv[1])
site = os.path.join(out, 'site')
shutil.rmtree(site, ignore_errors=True)
subprocess.run(['npx', 'vite', 'build', '--config', 'emberfall/vite.config.ts', '--outDir', site, '--emptyOutDir'], cwd=ROOT, check=True,
               stdout=subprocess.DEVNULL)

# ---- textures: keep only what the shipped chapters use
used = set()
for f in glob.glob(os.path.join(site, 'assets', '**', '*.glb'), recursive=True):
    b = open(f, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    for m in j.get('materials', []):
        ex = m.get('extras', {})
        if 'tex' in ex:
            used.add(ex['tex'])
        if 'leaf' in ex:
            used.add('foliage_' + ex['leaf'])
src = ''
for p in glob.glob(os.path.join(EMB, 'src', '**', '*.ts'), recursive=True):
    if os.path.basename(p) == 'Arena.ts':
        continue
    src += open(p).read()
terrain = set(re.findall(r"name: '([a-z0-9_]+)'", src))
used |= terrain
used |= set(re.findall(r"paving\([^)]*'([a-z_]+)'", src))
used |= {'foliage_grass'}
tex = os.path.join(site, 'assets', 'tex')
removed = 0
for f in os.listdir(tex):
    if f.startswith('impostor_'):
        continue
    m = re.match(r'(.+)_(c|n|orm|h)\.(webp|png)$', f)
    if not m:
        continue
    name, kind = m.group(1), m.group(2)
    if name not in used or (kind == 'h' and name not in terrain):
        os.remove(os.path.join(tex, f))
        removed += 1
print('textures removed', removed)

# ---- models: no meshopt compression
for f in glob.glob(os.path.join(site, 'assets', '**', '*.glb'), recursive=True):
    tmp = f + '.plain.glb'
    extra = ['-ac'] if 'anims' in f else []
    # the one model whose dense armour pushes it past the host's 16 MB file limit: lighter geometry here
    if os.path.basename(f) == 'hollow_footman.glb':
        extra += ['-si', '0.6']
    r = subprocess.run(['npx', 'gltfpack', '-i', f, '-o', tmp, '-kn', '-km', '-ke', '-kv', '-vtf', *extra], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(tmp):
        print('repack failed', f, r.stderr[-300:])
        continue
    os.replace(tmp, f)
print('models repacked')

def shrink_images(j, binc, maxdim):
    """re-encode embedded images at most maxdim px and rebuild the binary buffer"""
    import io
    from PIL import Image
    img_views = {im['bufferView']: im for im in j.get('images', []) if 'bufferView' in im}
    out = bytearray()
    for i, bv in enumerate(j['bufferViews']):
        data = binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        if i in img_views:
            try:
                im = Image.open(io.BytesIO(data))
                if max(im.size) > maxdim:
                    im.thumbnail((maxdim, maxdim), Image.LANCZOS)
                    buf = io.BytesIO()
                    fmt = 'WEBP' if img_views[i].get('mimeType') == 'image/webp' else 'PNG'
                    im.save(buf, fmt, quality=86) if fmt == 'WEBP' else im.save(buf, fmt)
                    data = buf.getvalue()
            except Exception as e:  # keep the original on any decode problem
                print('image kept', e)
        while len(out) % 4:
            out.append(0)
        bv['byteOffset'] = len(out)
        bv['byteLength'] = len(data)
        out += data
    j['buffers'][0]['byteLength'] = len(out)
    return j, bytes(out)


# ---- the host doesn't serve .glb: ship each model as JSON glTF with its binary chunk embedded (base64)
import base64
for f in glob.glob(os.path.join(site, 'assets', '**', '*.glb'), recursive=True):
    b = open(f, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    rest = b[20 + jl:]
    if rest:
        bl = struct.unpack('<I', rest[0:4])[0]
        binc = rest[8:8 + bl]
        if len(binc) * 4 / 3 > 14.5e6:
            j, binc = shrink_images(j, binc, 1024)
        j['buffers'][0]['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(binc).decode()
    with open(f[:-4] + '.gltf.json', 'w') as o:
        json.dump(j, o, separators=(',', ':'))
    os.remove(f)
print('models converted to JSON glTF')

# ---- the page body (the Artifact wraps it in its own document skeleton)
html = open(os.path.join(site, 'index.html')).read()
links = re.findall(r'<link rel="stylesheet"[^>]*>', html)
scripts = re.findall(r'<script type="module"[^>]*></script>', html)
page = f'''<title>Emberfall</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="emberfall:models" content="json">
<style>
  :root {{ --bg: #050405; --fg: #efe4cf; color-scheme: dark; }}
  html, body {{ height: 100%; background: var(--bg); color: var(--fg); overflow: hidden; }}
  body {{ padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }}
  #game {{ position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; touch-action: none; }}
  #ui {{ position: fixed; inset: 0; pointer-events: none; }}
</style>
{chr(10).join(links)}
<canvas id="game"></canvas>
<div id="ui"></div>
{chr(10).join(scripts)}
'''
open(os.path.join(site, 'page.html'), 'w').write(page)

# ---- upload batches
files = []
for dp, _, fs in os.walk(site):
    for f in fs:
        rel = os.path.relpath(os.path.join(dp, f), site)
        if rel in ('index.html', 'page.html'):
            continue
        files.append((rel, os.path.getsize(os.path.join(dp, f))))
files.sort(key=lambda x: (not x[0].endswith(('.js', '.css', '.woff2', '.woff')), x[0]))
batches, cur, size = [], [], 0
for rel, sz in files:
    if cur and (len(cur) >= 250 or size + sz > 60 * 1024 * 1024):
        batches.append(cur)
        cur, size = [], 0
    cur.append(rel)
    size += sz
if cur:
    batches.append(cur)
json.dump(batches, open(os.path.join(out, 'batches.json'), 'w'))
total = sum(s for _, s in files)
print('files', len(files), 'MB', round(total / 1e6, 1), 'batches', [len(b) for b in batches])
