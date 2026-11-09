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
        # trees: (wood budget, collision budget, 'tree', leaf budget)
        'jacaranda_tree': (16000, 300, 'tree', 90000),
        'tree_small_02': (9000, 120, 'tree', 30000),
        'island_tree_02': (12000, 200, 'tree', 36000),
        # distant LODs (EnvKit swaps them in past a distance): far fewer, larger leaves
        'jacaranda_tree@lod1': (2500, 0, 'tree', 26000),
        'tree_small_02@lod1': (1000, 0, 'tree', 13000),
        'island_tree_02@lod1': (1500, 0, 'tree', 14000),
        'shrub_02@lod1': (2500, 0, 'plant'),
        'shrub_04@lod1': (2200, 0, 'plant'),
        'nettle_plant@lod1': (1200, 0, 'plant'),
        'dead_tree_trunk@lod1': (1500, 0, 'solid'),
    },
}


def thin_leaves(obj, leaf_budget, seed):
    """Leaves are modelled one by one: keep a random share of the leaf islands (enough for the
    budget) and scale each survivor up about its own centre so the canopy keeps its coverage."""
    import bmesh
    import random
    rnd = random.Random(seed)
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    seen = set()
    islands = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]
        comp = []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        islands.append(comp)
    total = sum(len(c) for c in islands)
    keep = min(1.0, leaf_budget / max(total, 1))
    scale = min(3.0, (1.0 / max(keep, 1e-3)) ** 0.5)
    dead = []
    for comp in islands:
        if rnd.random() > keep:
            dead.extend(comp)
            continue
        verts = {v for f in comp for v in f.verts}
        c = sum((v.co for v in verts), verts.__iter__().__next__().co * 0) / len(verts)
        for v in verts:
            v.co = c + (v.co - c) * scale
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(me)
    bm.free()
    print(f'  leaves: {len(islands)} islands, {total} faces -> kept {keep:.2f}, scaled {scale:.2f}', flush=True)


def import_one(kit, key, budget, col_budget, kind='solid', leaf_budget=0):
    reset()
    mid, _, lod = key.partition('@')
    out_name = f'ph_{mid}' + (f'_{lod}' if lod else '')
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
    if kind == 'tree':
        # split off the leaves (materials named *leaves*), thin them, decimate the wood, rejoin
        select_only(obj)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.separate(type='MATERIAL')
        bpy.ops.object.mode_set(mode='OBJECT')
        parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        for o in parts:
            names = ' '.join(s.material.name.lower() for s in o.material_slots if s.material)
            if 'leaves' in names or 'leaf' in names:
                # each leaf is finely modelled: collapse every leaf to a few faces first (its outline
                # survives), then thin the leaves to the budget
                n_faces = len(o.data.polygons)
                decimate(o, target_tris=max(leaf_budget, n_faces // 10))
                thin_leaves(o, leaf_budget, hash(mid) & 0xFFFF)
            elif sum(len(p.vertices) - 2 for p in o.data.polygons) > budget // max(1, len(parts) - 1):
                decimate(o, target_tris=budget // max(1, len(parts) - 1))
        select_only(*parts)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        obj.name = f'ph_{mid}'
        budget = 10 ** 9
    col = None
    if col_budget and kind == 'tree':
        # trees collide by their trunk only: a cylinder round the lowest wood
        from envkit import cylinder
        import numpy as np
        co = np.array([v.co[:] for v in obj.data.vertices])
        low = co[co[:, 2] < co[:, 2].min() + 2.0]
        cx, cy = low[:, 0].mean(), low[:, 1].mean()
        r = max(0.25, float(np.percentile(np.hypot(low[:, 0] - cx, low[:, 1] - cy), 60)))
        col = cylinder(f'ph_{mid}_col', r, 4.0, (cx, cy, co[:, 2].min()), sides=8)
        col.data.materials.clear()
    elif col_budget:
        col = obj.copy()
        col.data = obj.data.copy()
        col.name = f'ph_{mid}_col'
        bpy.context.scene.collection.objects.link(col)
        decimate(col, target_tris=col_budget)
        col.data.materials.clear()
    if before > budget:
        decimate(obj, target_tris=budget)
    obj.name = out_name
    after = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    for i, slot in enumerate(obj.material_slots):
        if slot.material:
            slot.material.name = f'ph:{mid}:{i}'
    out = os.path.join(ASSETS, 'env', kit, f'{out_name}.glb')
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
        spec = BUDGETS[kit][mid]
        import_one(kit, mid, spec[0], spec[1], spec[2], spec[3] if len(spec) > 3 else 0)
