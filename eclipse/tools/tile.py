"""Tile the screenshots of a play.mjs run into one contact sheet (sorted by name).

  python eclipse/tools/tile.py <dir> <out.png> [cols] [width]
"""
import os
import sys
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 3
width = int(sys.argv[4]) if len(sys.argv) > 4 else 640
names = sorted(f for f in os.listdir(src) if f.endswith('.png'))
ims = []
for n in names:
    im = Image.open(os.path.join(src, n)).convert('RGB')
    h = round(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    ImageDraw.Draw(im).text((6, 4), n[:-4], fill=(255, 255, 0))
    ims.append(im)
if not ims:
    sys.exit('no screenshots')
rows = (len(ims) + cols - 1) // cols
h = ims[0].height
sheet = Image.new('RGB', (cols * width, rows * h))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * width, (i // cols) * h))
sheet.save(out)
print(out, sheet.size)
