"""Shared helpers for environment kits (modular architecture, props, ruins).

Conventions
  * metres, Z up while building (exported Y up);
  * every material is named `env:<texture set>` or `env:<texture set>#<variant>` (e.g. `env:ash_wood#charred`)
    and the game maps it to a tiled PBR surface (see src/world/EnvKit.ts);
  * UVs are metric box projections (1 UV unit = 1 m), so every surface tiles at real-world scale and
    pieces line up wherever they are placed;
  * collision proxies are simple closed meshes named `<piece>_col` exported next to the render mesh;
  * render meshes carry an `AO` colour attribute (Cycles ambient occlusion baked per vertex) that the
    game multiplies into the albedo, so pieces sit into the ground and into each other.
"""
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from common import select_only, apply_modifiers, link, mesh_from_arrays

_mats = {}


def material(name):
    """Material slot `env:<name>` (shared)."""
    full = f'env:{name}'
    m = bpy.data.materials.get(full)
    if m is None:
        m = bpy.data.materials.new(full)
    _mats[full] = m
    return m


def set_material(obj, name):
    obj.data.materials.clear()
    obj.data.materials.append(material(name))
    return obj


def box(name, size, loc=(0, 0, 0), mat=None, rot=(0, 0, 0), bevel=0.0, segments=2):
    """Axis-aligned box (size = full extents), origin at its centre."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    obj.location = loc
    obj.rotation_euler = rot
    if bevel > 0:
        bev(obj, bevel, segments)
    if mat:
        set_material(obj, mat)
    return obj


def cylinder(name, r, h, loc=(0, 0, 0), mat=None, sides=24, r2=None, rot=(0, 0, 0), cap=True):
    """Cylinder / cone frustum standing on its base (loc = base centre)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=sides, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=Vector((0, 0, h / 2)), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    obj.location = loc
    obj.rotation_euler = rot
    if mat:
        set_material(obj, mat)
    return obj


def bev(obj, width, segments=2, angle=40):
    m = obj.modifiers.new('bev', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = True
    apply_modifiers(obj)
    return obj


def boolean(obj, cutter, op='DIFFERENCE', keep=False):
    """Exact boolean; `use_self` lets it cut through meshes made of overlapping joined parts."""
    m = obj.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    m.use_self = True
    m.use_hole_tolerant = True
    apply_modifiers(obj)
    if not keep:
        bpy.data.objects.remove(cutter, do_unlink=True)
    return obj


def rock_cutter(name, center, radius, seed, squash=(1, 1, 1), rough=0.35):
    """A lumpy icosphere for knocking chunks out of masonry."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=radius)
    rng = np.random.default_rng(seed)
    ph = rng.random(3) * 10
    for v in bm.verts:
        p = v.co
        n = math.sin(p.x * 3.1 / radius + ph[0]) * math.sin(p.y * 2.7 / radius + ph[1]) * math.sin(p.z * 3.3 / radius + ph[2])
        v.co = Vector((p.x * squash[0], p.y * squash[1], p.z * squash[2])) * (1 + rough * n)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    obj.location = center
    return obj


def damage(obj, points, seed=0, radius=(0.5, 1.2), squash=(1, 1, 1)):
    """Knocks irregular chunks out of `obj` at the given world points."""
    rng = np.random.default_rng(seed)
    for i, p in enumerate(points):
        r = rng.uniform(*radius)
        boolean(obj, rock_cutter(f'cut{i}', p, r, seed * 31 + i, squash))
    return obj


def join(objs, name):
    objs = [o for o in objs if o is not None]
    select_only(*objs)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = objs[0]
    o.name = name
    o.data.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def apply_transform(obj):
    select_only(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def metric_uv(obj, jitter=True, seed=0):
    """Box-projected UVs in metres (dominant normal axis), random offset per object."""
    apply_transform(obj)
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    rng = random.Random(seed or hash(obj.name) & 0xffff)
    off = (rng.random() * 10, rng.random() * 10) if jitter else (0, 0)
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                u, v = co.x, co.y * (1 if n.z > 0 else -1)
            elif ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            else:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            uv[li].uv = (u + off[0], v + off[1])
    return obj


def bake_ao(obj, samples=32, distance=1.5):
    """Ambient occlusion baked into an `AO` point colour attribute (Cycles)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.device = 'CPU'
    world = sc.world or bpy.data.worlds.new('w')
    sc.world = world
    world.light_settings.distance = distance
    attr = obj.data.color_attributes.get('AO') or obj.data.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
    obj.data.color_attributes.active_color = attr
    select_only(obj)
    bpy.context.view_layer.objects.active = obj
    sc.render.bake.target = 'VERTEX_COLORS'
    bpy.ops.object.bake(type='AO')
    return obj


def subdivide_long_edges(obj, max_len=1.5):
    """Splits long edges so per-vertex AO has enough samples on big flat walls."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for _ in range(4):
        long = [e for e in bm.edges if e.calc_length() > max_len]
        if not long:
            break
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1, use_grid_fill=False)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def collision(name, parts):
    """Joins simple closed boxes/prisms into the piece's collision proxy (`<name>_col`)."""
    o = join(parts, name + '_col')
    o.data.materials.clear()
    return o


def export_piece(path, render, col=None, ao=True):
    """Exports a render mesh (+ optional collision mesh) to a GLB with the AO colour attribute."""
    from common import select_only as _sel
    objs = [render] + ([col] if col else [])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    _sel(*objs)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_skins=False,
              export_morph=False, export_animations=False, export_extras=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE' if ao else 'NONE', export_all_vertex_colors=False,
                                  export_active_vertex_color_when_no_material=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print('exported', path, os.path.getsize(path) // 1024, 'KB', sum(len(p.vertices) - 2 for p in render.data.polygons), 'tris')
