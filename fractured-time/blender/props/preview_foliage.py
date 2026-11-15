"""Cycles preview of converted foliage assets (cards with their alpha-cut textures) against a grey sky:
  blender -b --factory-startup -P blender/props/preview_foliage.py -- out.png fir_tree_01_0 [more...]"""
import json
import math
import os
import sys

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUB = os.path.join(ROOT, 'public', 'assets')
argv = sys.argv[sys.argv.index('--') + 1:]
out, names = argv[0], [a for a in argv[1:] if not a.startswith('--gap=')]
GAP = float(next((a[6:] for a in argv if a.startswith('--gap=')), 9.0))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), 0, math.radians(35))
ground = bpy.ops.mesh.primitive_plane_add(size=60)
x = 0.0
for nm in names:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(PUB, 'props', 'foliage', f'{nm}.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        o.location.x += x
        if o.type != 'MESH':
            continue
        for s in o.material_slots:
            r = json.loads(s.material['ft']) if s.material and 'ft' in s.material else None
            if not r:
                continue
            m = s.material
            nt = m.node_tree
            b = nt.nodes['Principled BSDF']
            img = nt.nodes.new('ShaderNodeTexImage')
            path = os.path.join(PUB, r['tex'])
            if not os.path.exists(path):
                path = os.path.join(PUB, 'props', 'foliage', 'tex', '_'.join(os.path.basename(r['tex']).split('_')[:3]) + '_bark.jpg')
            img.image = bpy.data.images.load(path)
            if r.get('alpha'):
                img.image.alpha_mode = 'STRAIGHT'
            nt.links.new(img.outputs['Color'], b.inputs['Base Color'])
            if r.get('alpha'):
                nt.links.new(img.outputs['Alpha'], b.inputs['Alpha'])
            b.inputs['Subsurface Weight'].default_value = 0.0
            b.inputs['Roughness'].default_value = 0.7
    x += GAP
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
span = max(x - GAP, 0)
cam.location = (span / 2, -16 - span * 0.45, 5.5) if GAP > 4 else (span / 2, -2.2 - span * 0.55, 1.2)
cam.rotation_euler = (math.radians(82), 0, 0) if GAP > 4 else (math.radians(72), 0, 0)
cam.data.lens = 28
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
