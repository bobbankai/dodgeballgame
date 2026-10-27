"""Tile the PNGs in a folder into one contact sheet: python tools/tile.py <dir> <out.png> [cols]"""
import glob
import os
import sys

from PIL import Image, ImageDraw

d, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
files = sorted(glob.glob(os.path.join(d, '*.png')))
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size
sheet = Image.new('RGB', (w * cols, h * ((len(ims) + cols - 1) // cols)), 'white')
draw = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y))
    draw.text((x + 6, y + 6), os.path.basename(f)[3:-4], fill=(0, 0, 0))
sheet.save(out)
print('wrote', out, sheet.size)
