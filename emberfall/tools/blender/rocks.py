"""Rock kit: blender -b --factory-startup -P rocks.py -- [--preview out.png] [names...]

Boulders, cliff slabs and stream stones from a subdivided sphere displaced by layered noise: broad
lumps (fractal), sharp ridges and cracks (ridged multifractal), optional horizontal strata, a flattened
base. Decimated to a triangle budget, smoothed by angle so ridges stay crisp, box-mapped to the shared
tiling rock sets and with ambient occlusion baked into the vertex colours.
Exported to assets/env/rocks/<name>.glb.
"""
import bpy
import bmesh
import math
import os
import sys
import random
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(__file__))
import outfit as O  # noqa
import charlib  # noqa

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'env', 'rocks')


def rock(name, size, seed, lumps=0.25, ridges=0.12, strata=0.0, strata_freq=3.0, flat=0.15, budget=2600, tex='rock_moss2',
         tint=(0.82, 0.8, 0.77), tile=2.5, subdiv=6, lean=0.0, box=1.0):
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(-50, 50), rnd.uniform(-50, 50), rnd.uniform(-50, 50)))
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    sx, sy, sz = size
    for v in bm.verts:
        n = v.co.normalized()
        p = n * 1.0 + off
        # broad lumps and flattened facets (terraced low-frequency noise reads as fractured planes)
        f = noise.fractal(p * 0.9, 0.8, 2.0, 3)
        d = (round(f * 3.0) / 3.0 * 0.55 + f * 0.45) * lumps
        d += noise.fractal(p * 2.2 + Vector((5, 2, 7)), 0.7, 2.0, 3) * lumps * 0.35
        # cracks: thin inward grooves where a noise field crosses zero
        c = abs(noise.noise(p * 1.6 + Vector((3, 1, 2))))
        d -= ridges * max(0.0, 1.0 - c * 6.0) ** 2
        if strata > 0:
            # bedding planes: soft steps across the height, wobbling
            h = n.z * strata_freq + noise.noise(p * 1.3) * 0.5
            step = h - math.floor(h)
            d -= strata * 0.25 * (step ** 3)
        r = 1.0 + d
        b = Vector([math.copysign(abs(c) ** box, c) for c in n]) if box < 1.0 else n  # rounded box for slabs
        co = Vector((b.x * sx * r, b.y * sy * r, b.z * sz * r))
        co.x += co.z * lean
        v.co = co
    # relax spikes: a few smoothing passes (fine detail comes from the normal map)
    for _ in range(2):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # flatten the base so it sits on the ground (and sinks a little)
    zmin = min(v.co.z for v in bm.verts)
    cut = zmin + (sz * 2) * flat
    for v in bm.verts:
        if v.co.z < cut:
            v.co.z = cut + (v.co.z - cut) * 0.15
    for v in bm.verts:
        v.co.z -= cut + sz * 0.05
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    # decimate to budget
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.ratio = min(1.0, budget / max(1, len(me.polygons)))
    bpy.ops.object.modifier_apply(modifier='dec')
    for p in ob.data.polygons:
        p.use_smooth = True
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(48))
    m = O.tiling_material('rock_' + tex, tex, tint, scale=1.0)
    ob.data.materials.append(m)
    O.box_uv(ob, tile / 2)
    return ob


def cluster(name, seed, n=6, spread=1.2, tex='rock_moss2'):
    """a scatter of small stones as one mesh (stream banks, path edges)"""
    rnd = random.Random(seed)
    parts = []
    for i in range(n):
        s = rnd.uniform(0.18, 0.45)
        ob = rock(f'{name}_{i}', (s * rnd.uniform(1.0, 1.5), s, s * rnd.uniform(0.5, 0.8)), seed * 31 + i, lumps=0.2, ridges=0.1,
                  budget=260, subdiv=4, tex=tex)
        ob.location = (rnd.uniform(-spread, spread), rnd.uniform(-spread, spread), 0)
        ob.rotation_euler.z = rnd.uniform(0, 6.28)
        parts.append(ob)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


PIECES = {
    'boulder_a': lambda: rock('boulder_a', (1.3, 1.05, 0.95), 1),
    'boulder_b': lambda: rock('boulder_b', (0.85, 0.7, 0.6), 2, lumps=0.3),
    'boulder_c': lambda: rock('boulder_c', (2.0, 1.6, 1.5), 3, ridges=0.12, budget=3400, box=0.7),
    'boulder_flat': lambda: rock('boulder_flat', (1.4, 1.1, 0.38), 4, lumps=0.18, ridges=0.08, flat=0.25),
    'cliff_a': lambda: rock('cliff_a', (6.5, 2.4, 6.0), 5, lumps=0.22, ridges=0.12, strata=0.12, strata_freq=4.0, budget=7000, flat=0.08, lean=-0.08, tile=4, box=0.45),
    'cliff_b': lambda: rock('cliff_b', (5.0, 2.0, 7.5), 6, lumps=0.24, ridges=0.14, strata=0.1, strata_freq=5.0, budget=7000, flat=0.08, lean=0.06, tile=4, box=0.5),
    'cliff_c': lambda: rock('cliff_c', (8.0, 3.0, 4.0), 7, lumps=0.25, ridges=0.12, strata=0.15, strata_freq=3.0, budget=7000, flat=0.1, tile=4, box=0.45),
    'stones': lambda: cluster('stones', 8),
    'stones_b': lambda: cluster('stones_b', 9, n=9, spread=1.6),
}


def export(ob, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    charlib.strip_tiling_textures()
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_extras=True,
                              export_vertex_color='NAME', export_vertex_color_name='Col', export_all_vertex_colors=False)
    charlib.pack(path)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    prev = None
    if '--preview' in argv:
        prev = argv[argv.index('--preview') + 1]
        argv = [a for a in argv if a not in ('--preview', prev)]
    names = argv or list(PIECES)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    built = []
    for n in names:
        ob = PIECES[n]()
        O.bake_ao_vertex([ob], samples=24, distance=0.6)
        if prev:
            built.append(ob)
            continue
        export(ob, os.path.join(OUT, f'{n}.glb'))
        bpy.data.objects.remove(ob)
        print('EXPORTED', n)
    if prev:
        import village
        village.preview(built, prev)
        print('PREVIEW', prev)
