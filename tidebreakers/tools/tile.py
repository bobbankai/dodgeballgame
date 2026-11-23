"""python tile.py out.png img1 img2 ... [--cols N] [--h H]  — tiles images into one contact sheet."""
import sys
from PIL import Image
args = sys.argv[1:]
cols = 4
h = 480
if '--cols' in args:
    i = args.index('--cols'); cols = int(args[i + 1]); del args[i:i + 2]
if '--h' in args:
    i = args.index('--h'); h = int(args[i + 1]); del args[i:i + 2]
out, files = args[0], args[1:]
ims = [Image.open(f).convert('RGB') for f in files]
ims = [im.resize((max(1, int(im.width * h / im.height)), h)) for im in ims]
rows = [ims[i:i + cols] for i in range(0, len(ims), cols)]
W = max(sum(im.width for im in r) for r in rows)
sheet = Image.new('RGB', (W, h * len(rows)), (30, 30, 30))
for ri, r in enumerate(rows):
    x = 0
    for im in r:
        sheet.paste(im, (x, ri * h)); x += im.width
sheet.save(out)
