"""python3 tile.py out.png img1 img2 ... [--cols N] [--h H]: tile images into one contact sheet."""
import sys
from PIL import Image

args = sys.argv[1:]
cols = 4
h = 380
if '--cols' in args:
    i = args.index('--cols'); cols = int(args[i + 1]); del args[i:i + 2]
if '--h' in args:
    i = args.index('--h'); h = int(args[i + 1]); del args[i:i + 2]
out, files = args[0], args[1:]
ims = []
for f in files:
    im = Image.open(f).convert('RGB')
    ims.append(im.resize((int(im.width * h / im.height), h)))
w = max(im.width for im in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), (40, 40, 40))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
