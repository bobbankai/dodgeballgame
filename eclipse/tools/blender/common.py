"""Shared Blender helpers for the Eclipse asset pipeline (run with /opt/bvenv/bin/python, bpy 5.2).

Conventions: Blender Z up, metres. Characters face -Y, their left is +X. The glTF exporter converts to
Y-up (Blender (x, y, z) -> glTF (x, z, -y)), and the game runs a right-handed Babylon scene, so a
character facing -Y in Blender faces +Z in the game.
"""
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
ASSETS = os.path.join(ROOT, 'public', 'assets')
RAW = os.environ.get('ECLIPSE_RAW', '/opt/eclipse-raw')
WORK = os.path.join(RAW, 'work')
os.makedirs(WORK, exist_ok=True)


def args():
    """Arguments after `--` (or all of sys.argv[1:] when run as a plain python script)."""
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else a[1:]


def reset(enable_mpfb=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if enable_mpfb:
        bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.render.fps = 30
    return sc


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def select_only(*objs):
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def apply_modifiers(obj):
    select_only(obj)
    for m in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e:
            print('modifier apply failed', obj.name, m.name, e)


def mesh_from_arrays(name, verts, faces, coll=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in np.asarray(verts, dtype=float)], [], [tuple(int(i) for i in f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    obj = bpy.data.objects.new(name, me)
    return link(obj, coll)


def verts_np(obj, world=True):
    me = obj.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    if world:
        m = np.array(obj.matrix_world)
        co = co @ m[:3, :3].T + m[:3, 3]
    return co


def normals_np(obj):
    me = obj.data
    n = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3)


def tris_np(obj):
    me = obj.data
    me.calc_loop_triangles()
    t = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', t)
    return t.reshape(-1, 3)


def set_verts(obj, co):
    obj.data.vertices.foreach_set('co', np.asarray(co, dtype=np.float64).ravel())
    obj.data.update()


def shade_smooth(obj, angle=None):
    for p in obj.data.polygons:
        p.use_smooth = True
    if angle is not None:
        try:
            select_only(obj)
            bpy.ops.object.shade_auto_smooth(angle=angle)
        except Exception:
            pass


def decimate(obj, ratio=None, target_tris=None, symmetric=False, axis='X'):
    """Collapse-decimate to a ratio or a triangle budget (keeps UVs when present)."""
    if target_tris is not None:
        n = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        ratio = min(1.0, target_tris / max(1, n))
    if ratio >= 0.999:
        return obj
    # attribute seams (material-id colours) slow the collapse down; repeat until the budget is met
    for _ in range(4):
        m = obj.modifiers.new('dec', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = ratio
        m.use_collapse_triangulate = True
        m.use_symmetry = symmetric
        m.symmetry_axis = axis
        apply_modifiers(obj)
        if target_tris is None:
            break
        n = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if n <= target_tris * 1.1:
            break
        ratio = target_tris / n
    return obj


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def vertex_group_weights(obj, name):
    """Per-vertex weight (numpy) for a vertex group; zero where unassigned."""
    w = np.zeros(len(obj.data.vertices))
    vg = obj.vertex_groups.get(name)
    if vg is None:
        return w
    idx = vg.index
    for v in obj.data.vertices:
        for g in v.groups:
            if g.group == idx:
                w[v.index] = g.weight
                break
    return w


def all_group_weights(obj):
    """dict group-name -> numpy weights for every vertex group (one pass over the mesh)."""
    names = {vg.index: vg.name for vg in obj.vertex_groups}
    out = {n: np.zeros(len(obj.data.vertices)) for n in names.values()}
    for v in obj.data.vertices:
        for g in v.groups:
            out[names[g.group]][v.index] = g.weight
    return out


def set_group(obj, name, weights, threshold=1e-4):
    vg = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
    idx = np.nonzero(weights > threshold)[0]
    for i in idx:
        vg.add([int(i)], float(weights[i]), 'REPLACE')
    return vg


def color_attribute(obj, name, rgba):
    """Writes a per-vertex (point) colour attribute from an (N, 4) array."""
    me = obj.data
    attr = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.asarray(rgba, dtype=np.float32).ravel())
    return attr


def remove_object(obj):
    me = obj.data if obj.type == 'MESH' else None
    bpy.data.objects.remove(obj, do_unlink=True)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


def preview(path, objects=None, size=(900, 1200), cam_loc=(0, -3.4, 1.15), target=(0, 0, 1.0), lens=50,
            samples=24, sun_rot=(50, 0, 35), world=0.35, hide=None):
    """Quick Cycles CPU render for checking a model."""
    sc = bpy.context.scene
    for o in list(sc.collection.objects):
        if o.name.startswith('_pv_'):
            bpy.data.objects.remove(o, do_unlink=True)
    cam_data = bpy.data.cameras.new('_pv_cam')
    cam = link(bpy.data.objects.new('_pv_cam', cam_data))
    cam.location = Vector(cam_loc)
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam_data.lens = lens
    sc.camera = cam
    sun = bpy.data.lights.new('_pv_sun', 'SUN')
    sun.energy = 3.5
    sun.angle = math.radians(4)
    so = link(bpy.data.objects.new('_pv_sun', sun))
    so.rotation_euler = tuple(math.radians(a) for a in sun_rot)
    fill = bpy.data.lights.new('_pv_fill', 'SUN')
    fill.energy = 0.8
    fo = link(bpy.data.objects.new('_pv_fill', fill))
    fo.rotation_euler = (math.radians(70), 0, math.radians(-140))
    if sc.world is None:
        sc.world = bpy.data.worlds.new('pv_world')
    sc.world.color = (world, world, world * 1.05)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = path
    hidden = []
    for o in hide or []:
        if not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    bpy.ops.render.render(write_still=True)
    for o in hidden:
        o.hide_render = False
    for o in list(sc.collection.objects):
        if o.name.startswith('_pv_'):
            bpy.data.objects.remove(o, do_unlink=True)
    return path


def export_glb(path, objects, animations=False, morphs=True, skins=True, actions=None):
    """Export the given objects (and their armature) to GLB with sampled animation."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    select_only(*objects)
    kw = dict(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_skins=skins,
        export_morph=morphs,
        export_morph_normal=True,
        export_animations=animations,
        export_extras=True,
        export_def_bones=False,
        # colour attributes on our meshes are bake inputs (material ids, height), never shading data
        export_vertex_color='NONE',
        export_all_vertex_colors=False,
    )
    if animations:
        kw.update(export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1,
                  export_optimize_animation_size=True, export_anim_single_armature=True,
                  export_reset_pose_bones=True, export_bake_animation=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        # option names drift between Blender versions; drop unknown ones and retry
        print('gltf export option error:', e)
        for k in ('export_image_format', 'export_vertex_color', 'export_all_vertex_colors', 'export_optimize_animation_size', 'export_anim_single_armature',
                  'export_reset_pose_bones', 'export_bake_animation', 'export_def_bones'):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)
    print('exported', path, os.path.getsize(path) // 1024, 'KB')
    return path
