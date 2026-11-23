"""Blender-side helpers: meshes from arrays, preview renders, scene reset."""
import math
import os
import bpy
import bmesh
import numpy as np
from mathutils import Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mesh(name, verts, faces, colors=None, smooth=True, collection=None):
    me = bpy.data.meshes.new(name)
    verts = np.asarray(verts, np.float32)
    faces = np.asarray(faces)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.ravel())
    nf = len(faces)
    k = faces.shape[1]
    me.loops.add(nf * k)
    me.loops.foreach_set('vertex_index', faces.ravel().astype(np.int32))
    me.polygons.add(nf)
    me.polygons.foreach_set('loop_start', (np.arange(nf) * k).astype(np.int32))
    me.polygons.foreach_set('loop_total', np.full(nf, k, np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if smooth:
        me.shade_smooth()
    if colors is not None:
        set_colors(me, colors)
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def set_colors(me, colors, name='Col'):
    """Per-vertex RGBA (linear) stored as a point colour attribute (exports as COLOR_0)."""
    colors = np.asarray(colors, np.float32)
    if colors.shape[1] == 3:
        colors = np.concatenate([colors, np.ones((len(colors), 1), np.float32)], 1)
    attr = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', colors.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.find(name)


def mesh_arrays(ob):
    me = ob.data
    V = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', V)
    V = V.reshape(-1, 3)
    tris = []
    me.calc_loop_triangles()
    T = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get('vertices', T)
    _ = tris
    return V, T.reshape(-1, 3)


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def decimate(ob, ratio=None, target=None, symmetry=True):
    nt = len(ob.data.polygons) * (2 if len(ob.data.polygons[0].vertices) == 4 else 1)
    if target is not None:
        ratio = min(1.0, target / max(nt, 1))
    if ratio is None or ratio >= 0.999:
        return
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.ratio = ratio
    m.use_symmetry = symmetry
    m.symmetry_axis = 'X'
    m.use_collapse_triangulate = True
    apply_modifiers(ob)


def quadriflow(ob, faces, smooth_normals=True):
    """Retopologise to roughly `faces` quads. Returns True when QuadriFlow succeeded."""
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    n0 = len(ob.data.polygons)
    try:
        r = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=True, use_preserve_sharp=False, use_preserve_boundary=False,
                                             smooth_normals=smooth_normals, mode='FACES', target_faces=int(faces), seed=3)
    except Exception as e:  # noqa
        print('[quadriflow] failed', e)
        return False
    ok = 'FINISHED' in r and len(ob.data.polygons) != n0
    print('[quadriflow]', 'ok' if ok else 'no change', len(ob.data.polygons))
    return ok


# ---------------------------------------------------------------------------------------- previews

def _look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def setup_preview(engine='WORKBENCH', res=(720, 960)):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    if engine == 'WORKBENCH':
        sc.render.engine = 'BLENDER_WORKBENCH'
        sh = sc.display.shading
        sh.light = 'STUDIO'
        sh.color_type = 'VERTEX'
        sh.show_cavity = True
        sh.cavity_type = 'BOTH'
        sh.show_object_outline = True
        sh.show_specular_highlight = True
        sc.display.render_aa = '8'
        sh.background_type = 'VIEWPORT' if hasattr(sh, 'background_type') else None
    else:
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = 24
        sc.cycles.use_denoising = False
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.55, 0.6, 0.66)
    return sc


def render_views(path_prefix, target=(0, 0, 0.9), dist=3.4, height=None, views=None, ortho=None, lens=70):
    """Renders front / three-quarter / side / back (or `views`: list of (name, azimuth_deg, elev_deg))."""
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new('pcam')
    cam_data.lens = lens
    if ortho:
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = ortho
    cam = bpy.data.objects.new('pcam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    views = views or [('front', 0, 4), ('q3', 35, 8), ('side', 90, 4), ('back', 180, 6)]
    out = []
    for name, az, el in views:
        a = math.radians(az)
        e = math.radians(el)
        tx, ty, tz = target
        cam.location = (tx + dist * math.sin(a) * math.cos(e), ty - dist * math.cos(a) * math.cos(e), tz + dist * math.sin(e))
        _look_at(cam, target)
        p = f'{path_prefix}_{name}.png'
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out.append(p)
    bpy.data.objects.remove(cam)
    return out
