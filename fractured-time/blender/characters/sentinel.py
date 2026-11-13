"""
SENTINEL A-07: HELIX experimental security frame (Chapter 1 boss). A heavy armoured torso hovering on a chronal gravity core, two
hammer-fisted arms, a single sensor eye, stabiliser fins and bolt-on armour plates that the phase transition blows off to expose the
core. Rigid machine parts in a node hierarchy (no skinning): the engine animates them procedurally (src/bosses/sentinel.ts).
  blender -b --factory-startup --python-exit-code 1 -P blender/characters/sentinel.py -- [--review out.png] [--export]
Hierarchy (names are what the engine looks up):
  sentinel_root > hover > torso > (head > eye), core, plate_chest_l/r, plate_back, fin_l/r,
                                   shoulder_l > arm_l > forearm_l > fist_l   (and _r)
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import garments as Gm  # noqa: E402
import hardsurface as HS  # noqa: E402
import sdf  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'bosses', 'sentinel')


def mats():
    return {
        'hull': Gm.armour('sentinel_hull', base=(0.11, 0.115, 0.125), edge=(0.42, 0.42, 0.43), wear=0.55, rough=0.42, coat=0.2, grooves=4.0),
        'paint': Gm.armour('sentinel_paint', base=(0.55, 0.36, 0.05), edge=(0.6, 0.58, 0.55), wear=0.7, rough=0.5, coat=0.1, grooves=4.0),
        'joint': Gm.armour('sentinel_joint', base=(0.03, 0.032, 0.035), edge=(0.25, 0.25, 0.26), wear=0.4, rough=0.3, coat=0.0, grooves=12.0),
        'core': Gm.emissive('sentinel_core', (0.35, 0.85, 1.0), 22.0),
        'eye': Gm.emissive('sentinel_eye', (1.0, 0.2, 0.08), 26.0),
    }


def part(name, f, lo, hi, material, step=0.012, tris=8000, parent=None, pivot=(0, 0, 0)):
    """Mesh an SDF part; its origin is moved to `pivot` (the joint it rotates about) and it is parented without moving."""
    ob = sdf.sculpt(name, f, lo, hi, step, material=material, tris=tris)
    piv = Vector(pivot)
    ob.data.transform(__import__('mathutils').Matrix.Translation(-piv))
    ob.location = piv
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(35))
    if parent is not None:
        bpy.context.view_layer.update()  # matrix_world is only current after an update
        w = ob.matrix_world.copy()
        ob.parent = parent
        ob.matrix_world = w
    return ob


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    if parent is not None:
        bpy.context.view_layer.update()
        w = e.matrix_world.copy()
        e.parent = parent
        e.matrix_world = w
    return e


def panel_lines(f, spacing, depth=0.012, width=0.012, axis=2):
    """Carve machined panel seams (parallel grooves) into a part."""
    def cut(P):
        q = (P[:, axis] / spacing) % 1.0
        return np.abs(q - 0.5) * spacing - (spacing / 2 - width / 2)
    return sdf.subtract(f, lambda P: np.maximum(cut(P), -(f(P) + depth)), k=0.004)


def build():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    M = mats()
    root = empty('sentinel_root', (0, 0, 0))
    hover = empty('hover', (0, 0, 0.9), root)
    # hover base: a heavy ring around the gravity core under the torso
    base_f = sdf.union(sdf.torus((0, 0, 0.9), 0.75, 0.22), sdf.cylinder((0, 0, 0.9), 0.55, 0.18, 0.06), k=0.05)
    base = part('hover_ring', panel_lines(base_f, 0.18, axis=0), (-1.1, -1.1, 0.5), (1.1, 1.1, 1.3), M['hull'], parent=hover, pivot=(0, 0, 0.9))
    gcore = part('gravity_core', sdf.sphere((0, 0, 0.72), 0.32), (-0.4, -0.4, 0.35), (0.4, 0.4, 1.1), M['core'], step=0.02, tris=1200, parent=hover,
                 pivot=(0, 0, 0.9))
    del base, gcore
    # torso: a wedge-shaped armoured body, wider at the shoulders, with a recessed chest cavity holding the core
    torso_f = sdf.intersect(sdf.box((0, 0.05, 2.1), (1.05, 0.75, 0.95), 0.12),
                            sdf.plane((0, -0.75, 2.6), (0, -0.62, 0.78)), sdf.plane((0, 0.8, 2.6), (0, 0.6, 0.8)), k=0.08)
    torso_f = sdf.union(torso_f, sdf.box((0, 0.05, 1.25), (0.55, 0.5, 0.25), 0.08), k=0.15)
    cavity = sdf.box((0, -0.62, 2.05), (0.38, 0.3, 0.38), 0.08)
    torso_f = panel_lines(sdf.subtract(torso_f, cavity, k=0.03), 0.32)
    torso = part('torso', torso_f, (-1.3, -1.0, 0.9), (1.3, 1.1, 3.2), M['hull'], step=0.014, tris=16000, parent=hover, pivot=(0, 0, 1.3))
    part('core', sdf.sphere((0, -0.45, 2.05), 0.3), (-0.4, -0.85, 1.6), (0.4, -0.05, 2.5), M['core'], step=0.016, tris=1500, parent=torso,
         pivot=(0, -0.45, 2.05))
    # head: a low armoured sensor housing with one eye
    head_f = panel_lines(sdf.intersect(sdf.box((0, -0.15, 3.3), (0.45, 0.42, 0.28), 0.1), sdf.plane((0, -0.5, 3.4), (0, -0.7, 0.7)), k=0.05),
                         0.14, axis=0)
    head = part('head', head_f, (-0.6, -0.7, 2.9), (0.6, 0.4, 3.7), M['hull'], step=0.012, tris=5000, parent=torso, pivot=(0, -0.1, 3.05))
    part('eye', sdf.ellipsoid((0, -0.55, 3.32), (0.16, 0.05, 0.07)), (-0.25, -0.7, 3.2), (0.25, -0.45, 3.45), M['eye'], step=0.008, tris=800,
         parent=head, pivot=(0, -0.55, 3.32))
    # bolt-on armour: chest plates (hazard-painted), back plate; the phase transition throws them off
    for sx in (-1, 1):
        pf = panel_lines(sdf.box((sx * 0.62, -0.72, 2.25), (0.36, 0.1, 0.62), 0.05), 0.22)
        part(f'plate_chest_{"l" if sx > 0 else "r"}', pf, (sx * 0.62 - 0.5, -0.9, 1.5), (sx * 0.62 + 0.5, -0.55, 3.0), M['paint'], step=0.01,
             tris=3000, parent=torso, pivot=(sx * 0.62, -0.72, 2.25))
        fin = sdf.intersect(sdf.box((sx * 0.9, 0.7, 2.6), (0.05, 0.45, 0.7), 0.03), sdf.plane((sx * 0.9, 0.8, 3.2), (0, 0.5, 0.86)), k=0.02)
        part(f'fin_{"l" if sx > 0 else "r"}', fin, (sx * 0.9 - 0.2, 0.1, 1.7), (sx * 0.9 + 0.2, 1.3, 3.4), M['hull'], step=0.01, tris=1500,
             parent=torso, pivot=(sx * 0.9, 0.5, 2.2))
    part('plate_back', panel_lines(sdf.box((0, 0.82, 2.2), (0.8, 0.1, 0.7), 0.05), 0.25), (-1.0, 0.6, 1.4), (1.0, 1.05, 3.0), M['paint'],
         step=0.012, tris=3000, parent=torso, pivot=(0, 0.82, 2.2))
    # arms: shoulder joint, armoured upper arm, forearm, hammer fist (each a pivot the engine rotates)
    for sx, sd in ((1, 'l'), (-1, 'r')):
        sh_c = (sx * 1.25, 0.0, 2.75)
        sh = part(f'shoulder_{sd}', sdf.union(sdf.sphere(sh_c, 0.36), sdf.box((sx * 1.25, 0, 2.95), (0.42, 0.42, 0.22), 0.08), k=0.08),
                  (sx * 1.25 - 0.6, -0.6, 2.3), (sx * 1.25 + 0.6, 0.6, 3.3), M['hull'], step=0.012, tris=3500, parent=torso, pivot=sh_c)
        ua = sdf.union(sdf.cone((sx * 1.35, 0, 2.6), (sx * 1.45, 0, 1.75), 0.26, 0.22),
                       sdf.box((sx * 1.4, 0, 2.2), (0.3, 0.32, 0.35), 0.06), k=0.06)
        arm = part(f'arm_{sd}', panel_lines(ua, 0.2), (sx * 1.4 - 0.5, -0.5, 1.5), (sx * 1.4 + 0.5, 0.5, 2.8), M['hull'], step=0.011, tris=4000,
                   parent=sh, pivot=sh_c)
        el_c = (sx * 1.45, 0.0, 1.7)
        fa = sdf.union(sdf.cone(el_c, (sx * 1.45, -0.25, 0.95), 0.24, 0.3), sdf.sphere(el_c, 0.25), k=0.05)
        fore = part(f'forearm_{sd}', panel_lines(fa, 0.18), (sx * 1.45 - 0.5, -0.7, 0.6), (sx * 1.45 + 0.5, 0.4, 2.0), M['joint'], step=0.011,
                    tris=3500, parent=arm, pivot=el_c)
        fist_c = (sx * 1.45, -0.3, 0.75)
        fist = sdf.union(sdf.box(fist_c, (0.34, 0.34, 0.3), 0.07), sdf.box((sx * 1.45, -0.55, 0.75), (0.28, 0.12, 0.22), 0.04), k=0.04)
        part(f'fist_{sd}', panel_lines(fist, 0.12, axis=0), (sx * 1.45 - 0.5, -0.8, 0.35), (sx * 1.45 + 0.5, 0.15, 1.15), M['paint'], step=0.01,
             tris=3500, parent=fore, pivot=(sx * 1.45, -0.25, 0.95))
    return root, M


def export():
    os.makedirs(OUT, exist_ok=True)
    for m_ in bpy.data.materials:
        if 'ft' in m_ and m_.node_tree:
            for n_ in [n for n in m_.node_tree.nodes if n.type == 'TEX_IMAGE']:
                m_.node_tree.nodes.remove(n_)
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(OUT, 'sentinel.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_extras=True,
                              export_normals=True, export_materials='EXPORT', export_vertex_color='NONE')
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')
    del json


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    root, M = build()
    if '--review' in argv:
        import studio
        studio.setup(samples=32)
        studio.camera((0, 0, 1.9), 7.5, -30, 8, 40)
        studio.render(argv[argv.index('--review') + 1], (1000, 1000))
    if '--export' in argv:
        export()
