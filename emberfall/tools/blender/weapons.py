"""Weapons. blender -b -P emberfall/tools/blender/weapons.py -- [names...]

Weapon local space (Blender): origin at the right-hand grip, blade along +Z, cutting edge toward -Y.
Characters carry matching sockets (socket_r / socket_l / socket_hip), so attaching is a parent op.
Poly Haven models (CC0) for blades; scabbard and Hollow weapons are generated here.
"""
import bpy
import bmesh
import glob
import math
import os
import sys
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import charlib  # noqa

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'weapons')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_ph(asset, res_dir=None):
    path = glob.glob(f'/opt/raw/ph/model/{asset}/*.gltf')[0]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for o in [o for o in bpy.data.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    return ob


def export(objs, name, tex=1024):
    for img in bpy.data.images:
        if img.size[0] > tex:
            img.scale(tex, int(img.size[1] * tex / img.size[0]))
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_image_format='WEBP',
                              export_image_quality=90, export_yup=True, export_extras=True, export_tangents=True)
    charlib.pack(path)
    print('EXPORTED', name, os.path.getsize(path))


def katana():
    reset()
    k = import_ph('antique_katana_01')
    k.name = 'katana'
    # grip 6.5 cm below the guard -> origin; edge (-X in the scan) -> -Y
    k.data.transform(Matrix.Translation((0, 0, 0.065)))
    k.data.transform(Matrix.Rotation(math.radians(90), 4, 'Z'))
    for m in k.data.materials:
        m['weapon'] = 'katana'
        # polished steel: reflections stretch along the blade (KHR_materials_anisotropy)
        b = m.node_tree.nodes.get('Principled BSDF')
        if b:
            b.inputs['Anisotropic'].default_value = 0.6
            b.inputs['Anisotropic Rotation'].default_value = 0.0
    # blade tip / base markers for trails (exported as nodes)
    co = np.array([v.co[:] for v in k.data.vertices])
    tip = Vector((0, 0, co[:, 2].max()))
    for nm, p in (('blade_base', Vector((0, 0, 0.12))), ('blade_tip', tip)):
        e = bpy.data.objects.new(nm, None)
        bpy.context.scene.collection.objects.link(e)
        e.location = p
        e.parent = k
    saya = scabbard(k)
    export([k] + list(k.children), 'katana')
    reset()
    return saya


def scabbard(blade):
    """Sweep a lacquered sheath along the blade's centreline (measured per height)."""
    co = np.array([v.co[:] for v in blade.data.vertices])
    blade_pts = co[co[:, 2] > 0.06]
    z0, z1 = 0.07, blade_pts[:, 2].max() + 0.035
    rings = []
    n_ring = 14
    steps = 40
    for i in range(steps + 1):
        z = z0 + (z1 - z0) * i / steps
        sl = blade_pts[np.abs(blade_pts[:, 2] - z) < 0.03]
        if len(sl) < 3:
            sl = blade_pts[np.argsort(np.abs(blade_pts[:, 2] - z))[:12]]
        cx, cy = sl[:, 0].mean(), sl[:, 1].mean()
        taper = 1.0 - 0.25 * (i / steps) ** 2
        a = 0.0205 * taper   # half width (edge-spine direction, Y)
        b = 0.0095 * taper   # half thickness (X)
        ring = []
        for k in range(n_ring):
            t = 2 * math.pi * k / n_ring
            ring.append((cx + b * math.cos(t), cy + a * math.sin(t), z))
        rings.append(ring)
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    for i in range(steps):
        for k in range(n_ring):
            bm.faces.new((vs[i][k], vs[i][(k + 1) % n_ring], vs[i + 1][(k + 1) % n_ring], vs[i + 1][k]))
    tip_c = bm.verts.new((np.mean([p[0] for p in rings[-1]]), np.mean([p[1] for p in rings[-1]]), z1 + 0.012))
    for k in range(n_ring):
        bm.faces.new((vs[-1][k], vs[-1][(k + 1) % n_ring], tip_c))
    # open mouth with a rim (koiguchi)
    me = bpy.data.meshes.new('saya')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('saya', me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    lac = charlib.principled('saya_lacquer', base_color=(0.012, 0.010, 0.012, 1), rough=0.35)
    lac.node_tree.nodes['Principled BSDF'].inputs['Coat Weight'].default_value = 1.0
    lac.node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value = 0.12
    gold = charlib.principled('saya_gold', base_color=(0.95, 0.68, 0.32, 1), rough=0.3, metal=1.0)
    cord = charlib.principled('saya_cord', base_color=(0.42, 0.04, 0.03, 1), rough=0.8)
    me.materials.append(lac)
    me.materials.append(gold)
    me.materials.append(cord)
    # gold bands at the mouth and the chape, red cord wraps near the mouth
    for poly in me.polygons:
        z = poly.center.z
        if z < z0 + 0.025 or z > z1 - 0.05:
            poly.material_index = 1
        elif z0 + 0.09 < z < z0 + 0.13 or z0 + 0.16 < z < z0 + 0.19:
            poly.material_index = 2
    sol = ob.modifiers.new('s', 'SUBSURF')
    sol.levels = 1
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier='s')
    export([ob], 'saya')
    return ob


def ph_weapon(asset, name, grip_z, blade_axis='Z', edge='-X', flip=False, tex=1024, scale=1.0):
    """Generic Poly Haven weapon: grip at height grip_z along the long axis, re-oriented."""
    reset()
    w = import_ph(asset)
    w.name = name
    co = np.array([v.co[:] for v in w.data.vertices])
    ext = co.max(0) - co.min(0)
    ax = int(np.argmax(ext))
    # long axis -> Z
    if ax == 0:
        w.data.transform(Matrix.Rotation(math.radians(-90), 4, 'Y'))
    elif ax == 1:
        w.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
    co = np.array([v.co[:] for v in w.data.vertices])
    if flip:
        w.data.transform(Matrix.Rotation(math.radians(180), 4, 'X'))
        co = np.array([v.co[:] for v in w.data.vertices])
    zmin = co[:, 2].min()
    w.data.transform(Matrix.Translation((-co[:, 0].mean(), -co[:, 1].mean(), -(zmin + grip_z))))
    if scale != 1.0:
        w.data.transform(Matrix.Scale(scale, 4))
    if edge == '-X':
        w.data.transform(Matrix.Rotation(math.radians(90), 4, 'Z'))
    elif edge == '+X':
        w.data.transform(Matrix.Rotation(math.radians(-90), 4, 'Z'))
    co = np.array([v.co[:] for v in w.data.vertices])
    for nm, p in (('blade_base', Vector((0, 0, co[:, 2].max() * 0.25))), ('blade_tip', Vector((0, 0, co[:, 2].max())))):
        e = bpy.data.objects.new(nm, None)
        bpy.context.scene.collection.objects.link(e)
        e.location = p
        e.parent = w
    export([w] + list(w.children), name, tex)


WEAPONS = {
    'katana': katana,
    'machete': lambda: ph_weapon('machete', 'machete', 0.07),
    'hatchet': lambda: ph_weapon('hatchet', 'hatchet', 0.06, scale=1.4),
    'axe': lambda: ph_weapon('wooden_axe', 'axe', 0.08, scale=1.25),
    'warhammer': lambda: ph_weapon('ornate_war_hammer', 'warhammer', 0.1, scale=2.2),
    'mace': lambda: ph_weapon('ornate_medieval_mace', 'mace', 0.08, scale=1.3),
    'estoc': lambda: ph_weapon('antique_estoc', 'estoc', 0.12),
    'dagger': lambda: ph_weapon('ornate_medieval_dagger', 'dagger', 0.05),
    'saber': lambda: ph_weapon('wooden_handle_saber', 'saber', 0.06),
    'shield': lambda: ph_weapon('kite_shield', 'shield', 0.7),
}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(WEAPONS)
    for n in argv or WEAPONS:
        WEAPONS[n]()
