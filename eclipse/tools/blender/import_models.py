"""Brings downloaded CC0 models (tools/models/ph_models.py) into the game as environment pieces.

  /opt/bvenv/bin/python eclipse/tools/blender/import_models.py <set> [id ...]

For each model: import the glTF, join its meshes, decimate to a triangle budget (gently for plants,
whose leaves are cut geometry), rename its materials `ph:<id>:<n>` (the game keeps these materials
instead of swapping in a tiled surface), add a decimated collision copy for solid things (rocks,
stumps, trunks), and export public/assets/env/<set>/ph_<id>.glb with WebP textures.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

from common import reset, ASSETS, decimate, select_only

RAW = os.environ.get('ECLIPSE_RAW', '/opt/eclipse-raw')

# id: (triangle budget, collision budget or 0, kind)
BUDGETS = {
    'forest': {
        'fern_02': (6200, 0, 'plant'), 'shrub_02': (16000, 0, 'plant'), 'shrub_03': (9000, 0, 'plant'), 'shrub_04': (14000, 0, 'plant'),
        'tree_stump_01': (6000, 160, 'solid'), 'tree_stump_02': (7000, 160, 'solid'), 'root_cluster_02': (14000, 0, 'solid'),
        'single_root': (5000, 0, 'solid'), 'dead_tree_trunk': (10000, 200, 'solid'), 'dead_tree_trunk_02': (12000, 200, 'solid'),
        'moss_01': (7000, 0, 'plant'), 'boulder_01': (6000, 160, 'solid'), 'stone_01': (3000, 100, 'solid'),
        'nettle_plant': (8000, 0, 'plant'), 'weed_plant_02': (6000, 0, 'plant'), 'dry_branches_medium_01': (5000, 0, 'plant'),
        'pine_roots': (10000, 0, 'solid'),
    },
}


def import_one(kit, mid, budget, col_budget):
    reset()
    path = os.path.join(RAW, 'phm', mid)
    gltf = [f for f in os.listdir(path) if f.endswith('.gltf')][0]
    bpy.ops.import_scene.gltf(filepath=os.path.join(path, gltf))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # bake every transform into the vertices so the piece's origin is the model's own ground point
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = f'ph_{mid}'
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    before = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    col = None
    if col_budget:
        col = obj.copy()
        col.data = obj.data.copy()
        col.name = f'ph_{mid}_col'
        bpy.context.scene.collection.objects.link(col)
        decimate(col, target_tris=col_budget)
        col.data.materials.clear()
    if before > budget:
        decimate(obj, target_tris=budget)
    after = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    for i, slot in enumerate(obj.material_slots):
        if slot.material:
            slot.material.name = f'ph:{mid}:{i}'
    out = os.path.join(ASSETS, 'env', kit, f'ph_{mid}.glb')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    objs = [obj] + ([col] if col else [])
    select_only(*objs)
    kw = dict(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=True,
              export_normals=True, export_materials='EXPORT', export_skins=False, export_morph=False, export_animations=False,
              export_vertex_color='NONE')
    try:
        bpy.ops.export_scene.gltf(**kw, export_image_format='WEBP', export_image_quality=88)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print(f'exported {out} {os.path.getsize(out) // 1024} KB {before} -> {after} tris', flush=True)


if __name__ == '__main__':
    A = [a for a in sys.argv[1:] if not a.startswith('--')]
    kit = A[0] if A else 'forest'
    ids = A[1:] or list(BUDGETS[kit])
    for mid in ids:
        b, c, _ = BUDGETS[kit][mid]
        import_one(kit, mid, b, c)
