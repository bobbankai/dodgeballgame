"""Render a line-up of kit pieces: blender -b -P tools/blender/kit_preview.py -- out.png"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import lib  # noqa: E402

lib.reset()
out = sys.argv[sys.argv.index('--') + 1]
kit.transform(kit.cottage(1), (-6, 6, 0))
kit.transform(kit.cottage(2, w=5.2, d=4.4, roof='roof_slate', door='door_blue', wall='plaster2', stories=2), (0, 8, 0))
kit.transform(kit.cottage(3, w=4.0, d=3.6, roof='roof_thatch', door='door_red'), (6.5, 6, 0))
kit.transform(kit.tree(1), (-9, 0, 0))
kit.transform(kit.tree(2, 6, 'poplar'), (-6.5, -1, 0))
kit.transform(kit.tree(3, 6, 'pine'), (9, 0, 0))
kit.transform(kit.well(), (-2.5, 0, 0))
kit.transform(kit.lamp_post(), (0.5, 0, 0))
kit.transform(kit.fence(4.8, 1), (3.5, -1.5, 0))
kit.transform(kit.notice_board(), (2.5, 1.5, 0))
kit.transform(kit.bench(), (-4.5, -2.5, 0))
kit.transform(kit.barrel(), (5.5, 1.0, 0))
kit.transform(kit.crate(), (6.3, 1.4, 0))
kit.transform(kit.rock(4, 0.8), (7.2, -2, 0))
kit.transform(kit.door_frame(), (-1, -3.5, 0))
kit.transform(kit.signpost(), (1.6, -3, 0))
lib.preview(out, target=(0, 2, 1.6), dist=19, yaw=-18, pitch=14, size=(1400, 800), lens=40, samples=20)
