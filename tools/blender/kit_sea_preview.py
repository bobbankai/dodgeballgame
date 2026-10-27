"""Render the sea kit: blender -b -P tools/blender/kit_sea_preview.py -- out.png"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import kit_sea  # noqa: E402
import lib  # noqa: E402

lib.reset()
out = sys.argv[sys.argv.index('--') + 1]
tower, stairs, missing, lens = kit_sea.lighthouse()
for g in (tower, stairs, missing, lens):
    kit.transform(g, (-6, 6, 0))
kit.transform(kit_sea.sailboat(), (3, -2, 0.5), 0.6)
kit.transform(kit_sea.inkwell(), (9, 9, 0), 0.0, 0.6)
kit.transform(kit_sea.stack(3, 9, 2), (14, -1, 0))
kit.transform(kit_sea.pier(8), (-1, -8, 0), 0.0)
kit.transform(kit_sea.buoy(), (6, -4, 0))
kit.transform(kit_sea.bottle(), (1, -4, 0.3), 0.0, 2.0)
kit.transform(kit_sea.lobster_pot(), (-2, -3, 0))
kit.transform(kit_sea.wreck(), (8, -6, 0.3))
lib.preview(out, target=(2, 3, 4), dist=30, yaw=-25, pitch=14, size=(1400, 800), lens=35, samples=16)
