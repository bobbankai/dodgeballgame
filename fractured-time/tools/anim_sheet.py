"""Stick-figure contact sheets from blender/animations preview JSON: one row per clip, side view (left) and front view (right)
per sampled frame. Usage: python tools/anim_sheet.py preview.json out.png [frames_per_row]"""
import json
import sys

from PIL import Image, ImageDraw

data = json.load(open(sys.argv[1]))
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 8
W, H = 110, 190
rows = list(data.items())
img = Image.new('RGB', (cols * W * 2 + 120, len(rows) * H), (24, 24, 28))
d = ImageDraw.Draw(img)
L = {'l': (90, 200, 255), 'r': (255, 140, 90)}
for ri, (name, frames) in enumerate(rows):
    d.text((4, ri * H + 4), name[:16], fill=(230, 230, 230))
    n = len(frames)
    pick = [round(i * (n - 1) / max(cols - 1, 1)) for i in range(cols)]
    for ci, fi in enumerate(pick):
        P = frames[fi]
        for view in (0, 1):
            ox = 120 + (ci * 2 + view) * W + W // 2
            oy = ri * H + H - 12
            d.line((ox - W // 2 + 4, oy, ox + W // 2 - 4, oy), fill=(60, 60, 66))
            for b, (a, c) in P.items():
                col = L.get(b[-1], (235, 235, 235)) if b[-2:-1] == '_' else (235, 235, 235)
                ax, ay = (a[1], a[2]) if view == 0 else (a[0], a[2])
                cx, cy = (c[1], c[2]) if view == 0 else (c[0], c[2])
                ax = -ax if view == 0 else ax
                cx = -cx if view == 0 else cx
                s = 80
                d.line((ox + ax * s, oy - ay * s, ox + cx * s, oy - cy * s), fill=col, width=2)
        d.text((120 + ci * 2 * W + 4, ri * H + 4), str(fi), fill=(140, 140, 150))
img.save(sys.argv[2])
