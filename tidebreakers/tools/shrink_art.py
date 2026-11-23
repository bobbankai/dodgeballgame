"""python shrink_art.py <dir>...  — converts pipeline PNG renders to JPEG (q 85) to keep the repository small."""
import sys, os, glob
from PIL import Image
for d in sys.argv[1:]:
    for f in glob.glob(os.path.join(d, '*.png')):
        Image.open(f).convert('RGB').save(f[:-4] + '.jpg', quality=85, optimize=True)
        os.remove(f)
