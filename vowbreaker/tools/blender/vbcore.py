"""
vbcore: Vowbreaker's Blender utilities (scene reset, colours, mesh objects, joins, modifiers,
per-vertex data, Cycles AO baking, previews, glTF export). Written for this game.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(ROOT, 'public', 'assets')
RAW = os.path.abspath(os.path.join(ROOT, '..', 'assets-raw', 'vowbreaker'))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.render.fps = 30
    return s


def srgb(h):
    """'#RRGGBB' -> linear rgb tuple."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh_object(name, verts, faces, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def bm_object(name, bm, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def activate(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_modifier(ob, kind, **props):
    m = ob.modifiers.new(kind.lower(), kind)
    for k, v in props.items():
        setattr(m, k, v)
    activate(ob)
    bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


def subdivide(ob, levels=1):
    if levels <= 0:
        return ob
    return apply_modifier(ob, 'SUBSURF', levels=levels, render_levels=levels, quality=3)


def solidify(ob, thickness, offset=-1.0):
    return apply_modifier(ob, 'SOLIDIFY', thickness=thickness, offset=offset, use_even_offset=True)


def decimate(ob, ratio):
    if ratio >= 1:
        return ob
    return apply_modifier(ob, 'DECIMATE', ratio=ratio, use_collapse_triangulate=True)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def white_material(name='vb_white'):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.8
    return m


def set_point_colors(ob, cols):
    """cols: (n_verts, 4) float array -> 'Col' POINT colour attribute (made active)."""
    me = ob.data
    if 'Col' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['Col'])
    a = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    a.data.foreach_set('color', np.asarray(cols, dtype=np.float32).ravel())
    me.color_attributes.active_color_name = 'Col'
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


def set_point_uv(ob, name, uv):
    """uv: (n_verts, 2) per-vertex values written to every loop of that vertex."""
    me = ob.data
    if name in me.uv_layers:
        me.uv_layers.remove(me.uv_layers[name])
    layer = me.uv_layers.new(name=name)
    loops = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', loops)
    layer.data.foreach_set('uv', np.asarray(uv, dtype=np.float32)[loops].ravel())


def world_verts(ob):
    n = len(ob.data.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    ob.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    M = np.array(ob.matrix_world)
    return co @ M[:3, :3].T + M[:3, 3]


def world_normals(ob):
    n = len(ob.data.vertices)
    no = np.empty(n * 3, dtype=np.float64)
    ob.data.vertices.foreach_get('normal', no)
    return no.reshape(-1, 3)


def bake_ao(objs, distance=0.1, samples=32):
    """Cycles ambient occlusion per vertex (everything in the scene occludes).
    Returns {object name: array of AO in 0..1 (1 = open)}."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new('vb_world')
    scene.world.light_settings.distance = distance
    out = {}
    for ob in objs:
        me = ob.data
        if not me.materials:
            me.materials.append(white_material())
        tmp = me.color_attributes.new('vb_ao', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = tmp
        activate(ob)
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        a = np.empty(len(me.vertices) * 4, dtype=np.float32)
        tmp.data.foreach_get('color', a)
        out[ob.name] = a.reshape(-1, 4)[:, 0].astype(np.float64)
        me.color_attributes.remove(tmp)
        if 'Col' in me.color_attributes:
            me.color_attributes.active_color_name = 'Col'
    return out


def preview(path, target=(0, 0, 1), dist=3.0, yaw=-30.0, pitch=6.0, size=(640, 860), lens=55, samples=16, bg=(0.78, 0.78, 0.8)):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    for o in scene.objects:
        if o.type == 'MESH' and not o.data.materials:
            o.data.materials.append(white_material())
    w = bpy.data.worlds.new('vb_prev')
    scene.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (*bg, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    sun = link(bpy.data.objects.new('vb_sun', bpy.data.lights.new('vb_sun', 'SUN')))
    sun.data.energy = 3.2
    sun.data.angle = 0.15
    sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
    cam = link(bpy.data.objects.new('vb_cam', bpy.data.cameras.new('vb_cam')))
    cam.data.lens = lens
    scene.camera = cam
    t = Vector(target)
    y, p = math.radians(yaw), math.radians(pitch)
    cam.location = t + Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(sun)


def export_glb(path, objs, animations=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_animations=animations, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_frame_step=1, export_skins=True, export_morph=False, export_materials='NONE',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_def_bones=False, export_optimize_animation_size=False)
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def bmesh_box(c, size, rot=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    from mathutils import Matrix
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm
