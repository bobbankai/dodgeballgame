"""Decode lightmaps that Blender wrote through the sRGB curve (one-off repair, kept for the record and for stray old maps).

Before the fix in envkit.bake_lightmap, every `*_lm.hdr` was saved from a float image tagged Linear Rec.709, and Blender writes such
an image to Radiance HDR through the extended sRGB transfer function (measured: 0.0245 -> 0.1699, 1.5 -> 1.188, 30 -> 4.28). This
inverts that curve exactly and saves the map as data (no transform), RLE-encoded by Blender's writer.

  blender -b --factory-startup -P tools/assets/linearise_lightmaps.py -- <map.hdr> [...]

Each file is converted once: a converted map is recorded in .cache/linearised.txt with its new size and mtime and skipped if
passed again unchanged.
"""
import os
import sys

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LOG = os.path.join(ROOT, '.cache', 'linearised.txt')


def decode(v):
    """Inverse of the extended sRGB encoding (power segment continued past 1)."""
    v = np.maximum(v, 0.0)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def main(paths):
    done = {}
    if os.path.exists(LOG):
        for line in open(LOG):
            p, size, mtime = line.rstrip('\n').rsplit(' ', 2)
            done[p] = (int(size), int(float(mtime)))
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    for path in paths:
        path = os.path.abspath(path)
        st = os.stat(path)
        if done.get(path) == (st.st_size, int(st.st_mtime)):
            print('SKIP (already linear)', path)
            continue
        src = bpy.data.images.load(path)
        w, h = src.size
        px = np.empty(w * h * 4, np.float32)
        src.pixels.foreach_get(px)
        bpy.data.images.remove(src)
        px = px.reshape(-1, 4)
        before = px[:, 1].mean()
        px[:, :3] = decode(px[:, :3].astype(np.float64)).astype(np.float32)
        out = bpy.data.images.new(os.path.basename(path) + '_lin', w, h, float_buffer=True, alpha=False)
        out.colorspace_settings.name = 'Non-Color'
        out.pixels.foreach_set(px.ravel())
        out.filepath_raw = path
        out.file_format = 'HDR'
        out.save()
        bpy.data.images.remove(out)
        st = os.stat(path)
        with open(LOG, 'a') as fh:
            fh.write(f'{path} {st.st_size} {int(st.st_mtime)}\n')
        print('LINEARISED', path, f'mean G {before:.4f} -> {px[:, 1].mean():.4f}', flush=True)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
