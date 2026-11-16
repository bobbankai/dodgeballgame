"""
Foliage kit: Poly Haven's CC0 plants turned into real-time assets (blender -b --factory-startup -P blender/props/foliage.py -- [--only fir_tree_01]).

The Poly Haven trees are offline assets: every needle spray is modelled (a fir is ~7 M triangles, a pine 17 M). Game trees are built
from cards, and this converts them the way a foliage artist would:
  1. the twig mesh is split into its islands (connected components, label propagation in numpy): each island is one spray;
  2. each island's UV -> 3D mapping is fitted by least squares (3D = A [u v 1]), which gives the spray's own plane, size and
     orientation; one card spanning the island's UV box reproduces it;
  3. the cards sample the twig atlas with an alpha mask rasterised from the islands' UV outlines (the atlas has no alpha: the
     modelled geometry was the cut-out);
  4. the trunk and branches are kept and decimated; every vertex gets a wind weight (height and reach from the trunk) and a crown
     occlusion term (inner, lower foliage darker) in its colour.
Small plants (ferns, grass, moss, shrubs, weeds) are kept as modelled, decimated where heavy. Output: one GLB per variant in
public/assets/props/foliage/ (materials carry 'foliage' recipes) and its textures (1k) in public/assets/props/foliage/tex/.
"""
import json
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, 'vendor', 'polyhaven', 'models')
OUT = os.path.join(ROOT, 'public', 'assets', 'props', 'foliage')
TEX = os.path.join(OUT, 'tex')

# trees: (asset, twig material suffix, decimated trunk triangle budget per variant)
TREES = {'fir_tree_01': 14000, 'pine_tree_01': 16000, 'pine_sapling_medium': 6000}
CARD_BUDGET = 3200  # twig cards per tree variant
# small plants: (asset, triangle budget per variant)
PLANTS = {'fern_02': 6000, 'grass_medium_01': 9000, 'grass_medium_02': 9000, 'moss_01': 400, 'shrub_02': 12000, 'shrub_04': 12000,
          'nettle_plant': 8000, 'weed_plant_02': 8000, 'tree_small_02': 40000}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_gltf(asset):
    path = os.path.join(SRC, asset, f'{asset}_2k.gltf')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before and o.type == 'MESH']


def mesh_arrays(ob):
    """World-space triangles of a mesh: positions per corner, uv per corner, material index per triangle."""
    me = ob.data
    me.calc_loop_triangles()
    nv = len(me.vertices)
    co = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    mw = np.array(ob.matrix_world)
    co = co @ mw[:3, :3].T + mw[:3, 3]
    nt = len(me.loop_triangles)
    tv = np.empty(nt * 3, np.int64)
    me.loop_triangles.foreach_get('vertices', tv)
    tl = np.empty(nt * 3, np.int64)
    me.loop_triangles.foreach_get('loops', tl)
    tm = np.empty(nt, np.int64)
    me.loop_triangles.foreach_get('material_index', tm)
    uv = np.zeros((len(me.loops), 2), np.float32)
    if me.uv_layers:
        b = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers[0].data.foreach_get('uv', b)
        uv = b.reshape(-1, 2)
    return co, tv.reshape(-1, 3), uv[tl].reshape(-1, 3, 2), tm


def islands(tri, nv):
    """Connected components of a triangle soup (label propagation + pointer jumping)."""
    lab = np.arange(nv, dtype=np.int64)
    for _ in range(400):
        m = lab[tri].min(1)
        new = lab.copy()
        for k in range(3):
            np.minimum.at(new, tri[:, k], m)
        new = new[new]
        if np.array_equal(new, lab):
            break
        lab = new
    return lab[tri[:, 0]]


def build_mesh(name, verts, faces, uvs, cols=None, normals=None, mat=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    uvl = me.uv_layers.new(name='UVMap')
    li = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', li)
    uvl.data.foreach_set('uv', uvs[li].ravel())
    if cols is not None:
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        ca.data.foreach_set('color', np.concatenate([cols, np.ones((len(cols), 1))], 1).astype(np.float32).ravel())
    if normals is not None:
        me.normals_split_custom_set_from_vertices(normals.tolist())
    for p in me.polygons:
        p.use_smooth = True
    if mat is not None:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


TEX_JOBS = []


def save_tex(src, dst, size=1024, mask=None, alpha=None):
    """Queue a texture for tools/assets/foliage_tex.py (Blender's Python has no PIL): resize to `size` (JPEG), or RGBA PNG with an
    alpha mask rasterised from UV triangles (`mask`: path of an .npy of (n, 3, 2) UVs)."""
    TEX_JOBS.append({'src': src, 'dst': dst, 'size': size, 'mask': mask, 'alpha': alpha})


def recipe_mat(name, recipe):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.15, 0.22, 0.08, 1)
    b.inputs['Roughness'].default_value = 0.7
    m['ft'] = json.dumps(recipe)
    return m


def render_clusters(asset, ob, twig_mat, P_groups, out_png, cells=4, res=256):
    """Render real clusters of the tree's own twig geometry (orthographic, along each cluster's own normal, transparent film,
    under a flat white sky so the needles' self-occlusion is baked in) into a cells x cells RGBA atlas: the cards' texture."""
    sc = bpy.context.scene
    for o in bpy.data.objects:
        o.hide_render = True
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    cam = bpy.data.objects.new('ccam', bpy.data.cameras.new('ccam'))
    sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    sc.camera = cam
    # the imported material multiplies by a vertex-colour attribute the cluster meshes do not carry: a copy without it
    twig_mat = twig_mat.copy()
    nt = twig_mat.node_tree
    for nd in [nd for nd in nt.nodes if nd.type == 'ATTRIBUTE']:
        for l in list(nd.outputs['Color'].links) + list(nd.outputs['Alpha'].links):
            sock = l.to_socket
            nt.links.remove(l)
            if sock.type == 'RGBA':
                sock.default_value = (1, 1, 1, 1)
            else:
                sock.default_value = 1.0
        nt.nodes.remove(nd)
    for nd in nt.nodes:
        if nd.type == 'MIX' and nd.data_type == 'RGBA':
            nd.blend_type = 'MULTIPLY'
    atlas = np.zeros((res * cells, res * cells, 4), np.float32)
    tmp = os.path.join(TEX, '_cluster.png')
    frames = []
    for k, (pts, tris, uvs) in enumerate(P_groups[:cells * cells]):
        c = pts.mean(0)
        q = pts - c
        w_, v_ = np.linalg.eigh(q.T @ q)
        e3, e2, e1 = v_[:, 0], v_[:, 1], v_[:, 2]
        if e2[2] < 0:
            e2 = -e2  # keep "up" pointing up the tree
        e1 = np.cross(e2, e3)
        ext = max(np.abs(q @ e1).max(), np.abs(q @ e2).max()) * 2.15
        verts = (pts - c)
        me = bpy.data.meshes.new(f'cl{k}')
        me.from_pydata(verts.tolist(), [], tris.tolist())
        uvl = me.uv_layers.new(name='UVMap')
        li = np.empty(len(me.loops), np.int64)
        me.loops.foreach_get('vertex_index', li)
        uvl.data.foreach_set('uv', uvs[li].ravel())
        me.materials.append(twig_mat)
        cob = bpy.data.objects.new(f'cl{k}', me)
        sc.collection.objects.link(cob)
        from mathutils import Matrix, Vector
        R = Matrix(((e1[0], e2[0], e3[0]), (e1[1], e2[1], e3[1]), (e1[2], e2[2], e3[2]))).to_4x4()
        cam.matrix_world = Matrix.Translation(Vector(e3 * 5.0)) @ R
        cam.data.ortho_scale = ext
        cam.data.clip_end = 20
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        px = np.array(img.pixels[:], np.float32).reshape(res, res, 4)
        bpy.data.images.remove(img)
        bpy.data.objects.remove(cob)
        cy, cx = divmod(k, cells)
        atlas[(cells - 1 - cy) * res:(cells - cy) * res, cx * res:(cx + 1) * res] = px
        frames.append(ext)
    img = bpy.data.images.new('atlas', res * cells, res * cells, alpha=True)
    img.pixels.foreach_set(atlas.ravel())
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    bpy.data.objects.remove(cam)
    if os.path.exists(tmp):
        os.remove(tmp)
    for o in bpy.data.objects:
        o.hide_render = False
    return frames


def tree(asset, trunk_budget):
    reset()
    obs = import_gltf(asset)
    texdir = os.path.join(SRC, asset, 'textures')
    for vi, ob in enumerate(sorted(obs, key=lambda o: o.name)):
        co, tv, tuv, tm = mesh_arrays(ob)
        names = [s.material.name if s.material else '' for s in ob.material_slots]
        twig_i = next(i for i, n in enumerate(names) if 'twig' in n)
        twig_src_mat = ob.material_slots[twig_i].material
        # --- the twig cards -------------------------------------------------------------------------------------------
        sel = tm == twig_i
        ttri = tv[sel]
        tuv_t = tuv[sel]
        cent = co[ttri].mean(1)
        cell = 0.45
        while True:
            vox = np.floor((cent - cent.min(0)) / cell).astype(np.int64)
            key = (vox[:, 0] * 4096 + vox[:, 1]) * 4096 + vox[:, 2]
            ids, inv = np.unique(key, return_inverse=True)
            inv = inv.reshape(-1)
            if len(ids) <= CARD_BUDGET or cell > 1.4:
                break
            cell *= 1.12
        n = len(ids)
        count = np.bincount(inv, minlength=n)
        order = np.argsort(inv, kind='stable')
        starts = np.concatenate([[0], np.cumsum(count)])
        base_z, top_z = co[:, 2].min(), co[:, 2].max()
        bark_c = co[tv[tm != twig_i].ravel()].mean(0)
        # the cluster atlas: 16 dense clusters spread up the tree, rendered from the real geometry
        atlas_png = os.path.join(TEX, f'{asset}_{vi}_clusters.png')
        dense = np.argsort(-count)[:max(64, n // 6)]
        hz = cent[order[starts[dense]]][:, 2]
        pick = dense[np.argsort(hz)][np.linspace(0, len(dense) - 1, 16).astype(int)]
        groups = []
        for j in pick:
            t = order[starts[j]:starts[j + 1]]
            if len(t) > 60000:
                t = t[:60000]
            used, remap = np.unique(ttri[t].ravel(), return_inverse=True)
            uv_v = np.zeros((len(used), 2), np.float32)
            uv_v[remap.reshape(-1)] = tuv_t[t].reshape(-1, 2)
            groups.append((co[used], remap.reshape(-1, 3), uv_v))
        os.makedirs(TEX, exist_ok=True)
        render_clusters(asset, ob, twig_src_mat, groups, atlas_png)
        # one card per group: the group's own plane (PCA), spanning its extent, showing one of the rendered clusters
        rng = np.random.default_rng(vi + 3)
        P = co[ttri].reshape(-1, 3)
        I = np.repeat(inv, 3)
        cnt3 = np.bincount(I, minlength=n).astype(np.float64)
        mean = np.stack([np.bincount(I, P[:, a], n) for a in range(3)], 1) / np.maximum(cnt3, 1)[:, None]
        d = P - mean[I]
        cov = np.zeros((n, 3, 3))
        for a_ in range(3):
            for b_ in range(3):
                cov[:, a_, b_] = np.bincount(I, d[:, a_] * d[:, b_], n)
        w_, v_ = np.linalg.eigh(cov)
        e3 = v_[:, :, 0]
        e2 = v_[:, :, 1]
        e2 = np.where((e2[:, 2] < 0)[:, None], -e2, e2)
        e1 = np.cross(e2, e3)
        ext = np.sqrt(np.maximum(w_[:, 2], 1e-9) / np.maximum(cnt3, 1)) * 2.3
        ext2 = np.sqrt(np.maximum(w_[:, 1], 1e-9) / np.maximum(cnt3, 1)) * 2.3
        half = np.maximum(ext, ext2)[:, None] * 0.62 + 0.08
        ok = (count >= 8) & np.isfinite(half[:, 0]) & (half[:, 0] < 1.4)
        mean, e1, e2, e3, half = mean[ok], e1[ok], e2[ok], e3[ok], half[ok]
        m = len(mean)
        corners = np.stack([mean - e1 * half - e2 * half, mean + e1 * half - e2 * half, mean + e1 * half + e2 * half,
                            mean - e1 * half + e2 * half], 1)
        cellk = rng.integers(0, 16, m)
        cu, cv = (cellk % 4) / 4.0, (cellk // 4) / 4.0
        flip = rng.random(m) < 0.5
        u0 = np.where(flip, cu + 0.25, cu)
        u1 = np.where(flip, cu, cu + 0.25)
        corners_uv = np.stack([np.stack([u0, cv], 1), np.stack([u1, cv], 1), np.stack([u1, cv + 0.25], 1), np.stack([u0, cv + 0.25], 1)], 1)
        verts = corners.reshape(-1, 3)
        h = (verts[:, 2] - base_z) / max(top_z - base_z, 1e-3)
        rad = np.hypot(verts[:, 0] - bark_c[0], verts[:, 1] - bark_c[1])
        crown = np.clip(rad / max(np.percentile(rad, 95), 1e-3), 0, 1)
        wind = np.clip(h, 0, 1) * (0.35 + 0.65 * crown)
        occl = np.clip(0.4 + 0.45 * crown + 0.3 * h, 0, 1)
        out = verts - np.array([bark_c[0], bark_c[1], base_z + (top_z - base_z) * 0.45])
        out[:, 2] *= 0.6
        out /= np.linalg.norm(out, axis=1, keepdims=True) + 1e-9
        nrm = np.repeat(e3, 4, 0) * 0.3 + out * 0.7
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
        faces = (np.arange(m)[:, None] * 4 + np.array([[0, 1, 2], [0, 2, 3]]).reshape(1, -1)).reshape(-1, 3)
        cols = np.stack([wind, occl, np.repeat(rng.random(m), 4)], 1)
        tw_mat = recipe_mat(f'{asset}_{vi}_twig_ft', {'type': 'foliage', 'tex': f'props/foliage/tex/{asset}_{vi}_clusters.png',
                                                    'alpha': True, 'transl': 0.55, 'tint': [0.58, 0.72, 0.68]})
        build_mesh(f'{asset}_{vi}_cards', verts, faces, corners_uv.reshape(-1, 2), cols, nrm, tw_mat)
        # --- trunk + branches, decimated ----------------------------------------------------------------------------
        parts = []
        for mi, nm in enumerate(names):
            if mi == twig_i:
                continue
            s_ = tm == mi
            if not s_.any():
                continue
            ttri2 = tv[s_]
            used, remap = np.unique(ttri2.ravel(), return_inverse=True)
            remap = remap.reshape(-1)
            uvs_v = np.zeros((len(used), 2), np.float32)
            uvs_v[remap] = tuv[s_].reshape(-1, 2)
            vv = co[used]
            hh = (vv[:, 2] - base_z) / max(top_z - base_z, 1e-3)
            rr = np.hypot(vv[:, 0] - bark_c[0], vv[:, 1] - bark_c[1])
            cc = np.stack([np.clip(hh, 0, 1) * np.clip(rr / 2.5, 0, 1) * 0.6, np.full(len(vv), 0.85), np.zeros(len(vv))], 1)
            key_ = nm.replace(f'{asset}_', '').split('.')[0]
            diff = next((f for f in os.listdir(texdir) if f.startswith(f'{asset}_{key_}_diff')), None)
            if diff is None:
                key_ = 'bark'  # parts without their own maps (dead branches) wear the bark
                diff = next((f for f in os.listdir(texdir) if f.startswith(f'{asset}_bark_diff')), None)
            if diff:
                save_tex(os.path.join(texdir, diff), os.path.join(TEX, f'{asset}_{key_}.jpg'), 1024)
                save_tex(os.path.join(texdir, diff.replace('_diff', '_nor_gl')), os.path.join(TEX, f'{asset}_{key_}_nor.jpg'), 1024)
            mat = bpy.data.materials.get(f'{asset}_{key_}_ft') or recipe_mat(f'{asset}_{key_}_ft', {
                'type': 'foliage', 'tex': f'props/foliage/tex/{asset}_{key_}.jpg', 'nor': f'props/foliage/tex/{asset}_{key_}_nor.jpg',
                'alpha': False, 'transl': 0.0})
            parts.append(build_mesh(f'{asset}_{vi}_{key_}', vv, remap.reshape(-1, 3), uvs_v, cc, None, mat))
        if parts:
            bpy.ops.object.select_all(action='DESELECT')
            for p_ in parts:
                p_.select_set(True)
            bpy.context.view_layer.objects.active = parts[0]
            bpy.ops.object.join()
            trunk = parts[0]
            ntri = sum(len(p_.vertices) - 2 for p_ in trunk.data.polygons)
            if ntri > trunk_budget:
                d_ = trunk.modifiers.new('dec', 'DECIMATE')
                d_.ratio = trunk_budget / ntri
                bpy.context.view_layer.objects.active = trunk
                bpy.ops.object.modifier_apply(modifier='dec')
            trunk.name = f'{asset}_{vi}_trunk'
        bpy.data.objects.remove(ob)
        export([o for o in bpy.data.objects if o.name.startswith(f'{asset}_{vi}_')], os.path.join(OUT, f'{asset}_{vi}.glb'))
        print('TREE', asset, vi, 'cards', m, 'groups', n, 'cell', round(cell, 3))
        for o in [o for o in bpy.data.objects if o.name.startswith(f'{asset}_{vi}_')]:
            bpy.data.objects.remove(o)


def find_diff(texdir, asset, key):
    """The source colour map for a material: its own name, then singular ('branches' -> 'branch'), then the asset's base map
    (Poly Haven names a model's main material after the model: tree_small_02_diff for the trunk)."""
    files = sorted(os.listdir(texdir))
    keys = [key, key[:-2] if key.endswith('es') else None, key[:-1] if key.endswith('s') else None, ''] if key else ['']
    for k in keys:
        if k is None:
            continue
        stem = f'{asset}_{k}' if k else asset
        hit = next((f for f in files if f.startswith(stem + '_diff')), None)
        if hit:
            return hit
    return None


def plant(asset, budget):
    reset()
    obs = import_gltf(asset)
    texdir = os.path.join(SRC, asset, 'textures')
    done = {}
    for vi, ob in enumerate(sorted(obs, key=lambda o: o.name)):
        for s in ob.material_slots:
            mt = s.material
            if mt is None:
                continue
            if mt.name in done:
                s.material = done[mt.name]
                continue
            base_name = mt.name.split('.')[0]  # Blender's duplicate suffix (.001) is not part of the name
            key = base_name.replace(f'{asset}_', '') if base_name != asset else ''
            stem = f'{asset}_{key}' if key else asset
            diff = find_diff(texdir, asset, key)
            # cut-out leaves and blades: Poly Haven ships their opacity as a separate Alpha map (fetched beside the textures)
            amap = next((f for f in sorted(os.listdir(texdir)) if f.startswith(diff.split('_diff')[0] + '_alpha')), None) if diff else None
            ext = 'png' if amap else 'jpg'
            if diff:
                save_tex(os.path.join(texdir, diff), os.path.join(TEX, f'{stem}.{ext}'), 1024,
                         alpha=os.path.join(texdir, amap) if amap else None)
                save_tex(os.path.join(texdir, diff.replace('_diff', '_nor_gl')), os.path.join(TEX, f'{stem}_nor.jpg'), 1024)
            new = recipe_mat(stem + '_ft', {'type': 'foliage', 'tex': f'props/foliage/tex/{stem}.{ext}', 'nor': f'props/foliage/tex/{stem}_nor.jpg',
                                    'alpha': bool(amap), 'transl': 0.45 if 'trunk' not in stem and 'bark' not in stem else 0.0})
            done[mt.name] = new
            s.material = new
        # wind weight from height, occlusion rising toward the top
        me = ob.data
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        z = co[:, 2]
        h = (z - z.min()) / max(z.max() - z.min(), 1e-3)
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        ca.data.foreach_set('color', np.stack([h * h, 0.45 + 0.55 * h, np.full(len(h), (vi * 0.37) % 1), np.ones(len(h))], 1).astype(np.float32).ravel())
        ntri = sum(len(p.vertices) - 2 for p in me.polygons)
        if ntri > budget:
            d = ob.modifiers.new('dec', 'DECIMATE')
            d.ratio = budget / ntri
            bpy.context.view_layer.objects.active = ob
            ob.select_set(True)
            bpy.ops.object.modifier_apply(modifier='dec')
        # each variant on its own: centred on its root
        ob.parent = None
        export([ob], os.path.join(OUT, f'{asset}_{vi}.glb'), recentre=True)
        print('PLANT', asset, vi, ntri, '->', sum(len(p.vertices) - 2 for p in ob.data.polygons))


def export(objs, path, recentre=False):
    if recentre:
        for o in objs:
            bpy.context.view_layer.objects.active = o
            mw = o.matrix_world.copy()
            o.matrix_world = mw
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
            co = np.empty(len(o.data.vertices) * 3, np.float32)
            o.data.vertices.foreach_get('co', co)
            co = co.reshape(-1, 3)
            off = np.array([(co[:, 0].min() + co[:, 0].max()) / 2, (co[:, 1].min() + co[:, 1].max()) / 2, co[:, 2].min()])
            o.data.vertices.foreach_set('co', (co - off).astype(np.float32).ravel())
            o.location = (0, 0, 0)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_extras=True, export_texcoords=True,
                              export_normals=True, export_materials='EXPORT', export_yup=True, export_apply=True,
                              export_vertex_color='ACTIVE', export_image_format='NONE')
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    for a, b in TREES.items():
        if only is None or a in only:
            tree(a, b)
    for a, b in PLANTS.items():
        if only is None or a in only:
            plant(a, b)
    jobs = os.path.join(TEX, '_jobs.json')
    prev = json.load(open(jobs)) if os.path.exists(jobs) else []
    keep = {j['dst']: j for j in prev + TEX_JOBS}
    json.dump(list(keep.values()), open(jobs, 'w'), indent=1)
    print('TEXJOBS', len(TEX_JOBS))
