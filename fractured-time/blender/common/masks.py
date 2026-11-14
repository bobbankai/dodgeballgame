"""
Baked mask textures for hard-surface assets (the AAA way: per-texel, not per-vertex; low-poly faces have no interior vertices).
bake(objects, png, rel): one UV atlas shared by the objects (their UV0 is replaced: only use it on parts whose materials sample
nothing else by UV), then Cycles bakes ambient occlusion (R) and an edge map (G: the bevel shader's rounded normal against the true
normal, i.e. how close a texel is to a sharp edge). Armour recipes get 'masks': rel; the engine wears paint off the edges and settles
grime into the occlusion (src/rendering/charmat.ts armour).
"""
import json
import math

import bpy
import numpy as np


def bake(obs, png, rel, size=2048, edge_radius=0.024, only_types=('armour',)):
    """Baked mask texture (the AAA way, not per-vertex: low-poly faces have no interior vertices):
    one UV atlas shared by every part, Cycles bakes ambient occlusion (R) and an edge map (G: the bevel shader's rounded normal
    against the true normal, i.e. how close a texel is to a sharp edge). The engine armour shader wears paint off the edges and
    settles grime into the occlusion."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
        for uvl in list(o.data.uv_layers):
            o.data.uv_layers.remove(uvl)
        o.data.uv_layers.new(name='UVMap')
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(48), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.render.bake.margin = 8
    sc.render.bake.target = 'IMAGE_TEXTURES'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = 0.35
    mats_ = {m for o in obs for m in o.data.materials if m}
    out = np.zeros((size, size, 4), dtype=np.float32)
    out[..., 3] = 1
    for kind, ch_ in (('AO', 0), ('EDGE', 1)):
        img = bpy.data.images.new(f'mask_{kind}', size, size, float_buffer=True, alpha=False)
        added = []
        for m in mats_:
            nt = m.node_tree
            n = nt.nodes.new('ShaderNodeTexImage')
            n.image = img
            for x in nt.nodes:
                x.select = False
            n.select = True
            nt.nodes.active = n
            added.append((nt, [n]))
            if kind == 'EDGE':
                outn = next(x for x in nt.nodes if x.type == 'OUTPUT_MATERIAL')
                old = [l_.from_socket for l_ in outn.inputs['Surface'].links]
                bev = nt.nodes.new('ShaderNodeBevel')
                bev.inputs['Radius'].default_value = edge_radius
                bev.samples = 16
                geo = nt.nodes.new('ShaderNodeNewGeometry')
                dot = nt.nodes.new('ShaderNodeVectorMath')
                dot.operation = 'DOT_PRODUCT'
                nt.links.new(bev.outputs['Normal'], dot.inputs[0])
                nt.links.new(geo.outputs['Normal'], dot.inputs[1])
                inv = nt.nodes.new('ShaderNodeMath')
                inv.operation = 'SUBTRACT'
                inv.inputs[0].default_value = 1.0
                nt.links.new(dot.outputs['Value'], inv.inputs[1])
                amp = nt.nodes.new('ShaderNodeMath')
                amp.operation = 'MULTIPLY'
                amp.use_clamp = True
                amp.inputs[1].default_value = 7.0
                nt.links.new(inv.outputs['Value'], amp.inputs[0])
                em = nt.nodes.new('ShaderNodeEmission')
                nt.links.new(amp.outputs['Value'], em.inputs['Strength'])
                em.inputs['Color'].default_value = (1, 1, 1, 1)
                nt.links.new(em.outputs['Emission'], outn.inputs['Surface'])
                added[-1] = (nt, [n, bev, geo, dot, inv, amp, em], outn, old)
        sc.cycles.samples = 64 if kind == 'AO' else 16
        if kind == 'AO':
            bpy.ops.object.bake(type='AO', use_clear=True, margin=8)
        else:
            bpy.ops.object.bake(type='EMIT', use_clear=True, margin=8)
        px = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        out[..., ch_] = px.reshape(size, size, 4)[..., 0]
        for item in added:
            nt, nodes = item[0], item[1]
            if len(item) > 2:
                outn, old = item[2], item[3]
                for src in old:
                    nt.links.new(src, outn.inputs['Surface'])
            for n in nodes:
                nt.nodes.remove(n)
        bpy.data.images.remove(img)
    res = bpy.data.images.new('sentinel_masks', size, size, alpha=False)
    res.pixels.foreach_set(np.clip(out, 0, 1).ravel())
    res.filepath_raw = png
    res.file_format = 'PNG'
    res.save()
    print('MASKS', png)
    for m in mats_:
        if 'ft' in m:
            r = json.loads(m['ft'])
            if r.get('type') in only_types:
                r['masks'] = rel
                m['ft'] = json.dumps(r)
