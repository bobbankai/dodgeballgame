"""Sky detail: an 8K display image of a sky HDRI's upper hemisphere (8-bit sRGB, scaled so 99.8 % of the sky fits), for
sharp clouds where the 2K HDR is soft; the 2K HDR still supplies the sun and anything brighter (the engine blends to it where
the display image saturates). Writes <out>.jpg and <out>.json ({"scale": k}: linear = srgb_decode(jpg) * k).
  blender -b --factory-startup --python-exit-code 1 -P tools/assets/sky_detail.py -- <src.hdr> <out-base> [width]"""
import bpy, json, os, subprocess, sys
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
width = int(argv[2]) if len(argv) > 2 else 8192
img = bpy.data.images.load(os.path.abspath(src))
w, h = img.size
px = np.empty(w * h * 4, np.float32)
img.pixels.foreach_get(px)
px = px.reshape(h, w, 4)[:, :, :3]            # rows bottom-up
up = px[h // 2:]                              # the upper hemisphere (horizon at row 0 here)
lum = up @ np.array([0.2126, 0.7152, 0.0722], np.float32)
k = float(np.percentile(lum, 99.8)) / 0.92
lin = np.clip(up / k, 0.0, 1.0)
srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055).astype(np.float32)
oh, ow = srgb.shape[:2]
o = bpy.data.images.new('sky_detail', ow, oh, alpha=False, float_buffer=False, is_data=True)
o.colorspace_settings.name = 'Non-Color'
rgba = np.concatenate([srgb, np.ones((oh, ow, 1), np.float32)], axis=2)
o.pixels.foreach_set(rgba.ravel())
png = out + '_tmp.png'
o.filepath_raw = png
o.file_format = 'PNG'
o.save()
subprocess.run(['convert', png, '-resize', f'{width}x{width // 4}!', '-quality', '90', '-strip', out + '.jpg'], check=True)
os.remove(png)
json.dump({'scale': k, 'source': os.path.basename(src)}, open(out + '.json', 'w'))
print('sky detail', out + '.jpg', 'scale', round(k, 4), 'from', w, 'x', h)
