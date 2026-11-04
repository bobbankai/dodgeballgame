"""Convert a Poly Haven model into a game-ready GLB.

blender -b --factory-startup -P emberfall/tools/blender/ph_model.py -- <id> <out.glb> [maxTris] [texSize] [scale]

- imports the downloaded glTF (/opt/raw/ph/model/<id>/), applies transforms
- decimates every mesh proportionally so the whole model fits maxTris (collapse, keeps UV seams)
- origin at the bottom centre (props sit on the ground at y=0)
- textures resized to texSize and written as WebP (EXT_texture_webp)
"""
import bpy
import glob
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
asset_id, out = argv[0], argv[1]
max_tris = int(argv[2]) if len(argv) > 2 else 20000
tex_size = int(argv[3]) if len(argv) > 3 else 1024
scale = float(argv[4]) if len(argv) > 4 else 1.0

src = glob.glob(f'/opt/raw/ph/model/{asset_id}/*.gltf')[0]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in [o for o in bpy.data.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o)

total = 0
for o in meshes:
    o.data.calc_loop_triangles()
    total += len(o.data.loop_triangles)
ratio = min(1.0, max_tris / max(total, 1))
if ratio < 0.999:
    for o in meshes:
        m = o.modifiers.new('dec', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = ratio
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='dec')

# join into one object per material set is left to the glTF exporter (it merges primitives per mesh)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = asset_id
# origin: bottom centre
import mathutils
bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
minz = min(v.z for v in bb)
cx = (min(v.x for v in bb) + max(v.x for v in bb)) / 2
cy = (min(v.y for v in bb) + max(v.y for v in bb)) / 2
obj.data.transform(mathutils.Matrix.Translation((-cx, -cy, -minz)))
obj.location = (0, 0, 0)
if scale != 1.0:
    obj.data.transform(mathutils.Matrix.Scale(scale, 4))
bpy.ops.object.shade_smooth_by_angle(angle=1.0)

for img in bpy.data.images:
    if img.size[0] > tex_size or img.size[1] > tex_size:
        k = tex_size / max(img.size[0], img.size[1])
        img.scale(max(4, int(img.size[0] * k)), max(4, int(img.size[1] * k)))

obj.data.calc_loop_triangles()
print('OUT_TRIS', asset_id, len(obj.data.loop_triangles), 'from', total)
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_image_format='WEBP', export_image_quality=88,
    export_yup=True, export_apply=True, export_tangents=False, export_materials='EXPORT',
    export_extras=False, export_cameras=False, export_lights=False,
)
