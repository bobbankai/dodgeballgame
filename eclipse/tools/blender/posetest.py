"""Renders a sheet of poses (front and side) on the built character, for checking pose conventions.

  /opt/bvenv/bin/python eclipse/tools/blender/posetest.py <out.png> <module.attr> [cols]

<module.attr> names a dict {label: pose} (e.g. kael_poses.TEST).
"""
import importlib
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Quaternion, Vector
from PIL import Image

from common import WORK, args
from animlib import Poser

A = args()
out, ref = A[0], A[1]
cols = int(A[2]) if len(A) > 2 else 4
mod, attr = ref.rsplit('.', 1)
poses = getattr(importlib.import_module(mod), attr)

bpy.ops.wm.open_mainfile(filepath=os.path.join(WORK, 'kael.blend'))
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
poser = Poser(rig)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 6
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 300, 420
cam_d = bpy.data.cameras.new('c')
cam = bpy.data.objects.new('c', cam_d)
sc.collection.objects.link(cam)
cam_d.type = 'ORTHO'
cam_d.ortho_scale = 2.3
sc.camera = cam
sun = bpy.data.lights.new('s', 'SUN')
sun.energy = 3
so = bpy.data.objects.new('s', sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(45), 0, math.radians(30))
if sc.world is None:
    sc.world = bpy.data.worlds.new('w')
sc.world.color = (0.4, 0.4, 0.42)
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.data.materials.clear()
tiles = []
for label, pose in poses.items():
    root_off = pose.pop('_pelvis', None) if isinstance(pose, dict) else None
    for b in rig.pose.bones:
        b.rotation_mode = 'QUATERNION'
        rot = pose.get(b.name)
        b.rotation_quaternion = poser.local_quat(b.name, rot) if rot else Quaternion()
        b.location = Vector()
    if root_off:
        prest = rig.data.bones['pelvis'].matrix_local.to_3x3()
        rig.pose.bones['pelvis'].location = prest.inverted() @ Vector(root_off)
    bpy.context.view_layer.update()
    for view, loc in (('front', (0, -5, 1.0)), ('side', (5, 0, 1.0))):
        cam.location = loc
        d = Vector((0, 0, 1.0)) - cam.location
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        path = os.path.join(WORK, f'_pose_{label}_{view}.png')
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        tiles.append((label, view, path))
pairs = cols * 2
rows = math.ceil(len(tiles) / pairs)
sheet = Image.new('RGB', (300 * pairs, 420 * rows), (30, 30, 30))
from PIL import ImageDraw
dr = ImageDraw.Draw(sheet)
for i, (label, view, path) in enumerate(tiles):
    x, y = (i % pairs) * 300, (i // pairs) * 420
    sheet.paste(Image.open(path), (x, y))
    dr.text((x + 6, y + 6), f'{label} {view}', fill=(255, 255, 0))
sheet.save(out)
print('sheet', out)
