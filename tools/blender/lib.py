"""Shared helpers for the Blender asset scripts (run headless: blender -b -P <script>)."""
import math
import os

import bmesh
import bpy
from mathutils import Euler, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(ROOT, 'src', 'assets', 'models')

_MATS = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()
    _BAKED['mat'] = None
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.unit_settings.system = 'METRIC'
    return scene


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mat(name, hexcol, rough=0.7, vcol=False):
    """Plain material; the game re-shades everything, so only the name and colour matter.
    vcol multiplies in the 'Col' vertex colours, so previews show the painted variation too."""
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*srgb(hexcol), 1)
    p.inputs['Roughness'].default_value = rough
    if vcol:
        at = nt.nodes.new('ShaderNodeAttribute')
        at.attribute_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['A'].default_value = (*srgb(hexcol), 1)
        nt.links.new(at.outputs['Color'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
    _MATS[name] = m
    return m


def link(ob, parent=None):
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def obj_from_bm(name, bm, material, smooth=True, subsurf=0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = smooth
    if subsurf:
        md = ob.modifiers.new('subsurf', 'SUBSURF')
        md.levels = subsurf
        md.render_levels = subsurf
    return ob


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def ellipsoid(name, center, radii, material, segs=(28, 18), subsurf=0, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1.0)
    bmesh.ops.scale(bm, vec=Vector(radii), verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return obj_from_bm(name, bm, material, subsurf=subsurf)


def tube(name, pts, radii, material, sides=16, cap=True, subsurf=1, squash=1.0, normals=None):
    """A tapered tube through points (radius per point), with rounded end caps.

    `squash` flattens the tube along its normal axis: `normals` (one vector, or one per point)
    sets that axis, e.g. a surface normal for straps and hair clumps lying on a surface;
    otherwise it is carried along the curve without twisting.
    """
    bm = bmesh.new()
    rings = []
    pts = [Vector(p) for p in pts]
    n = len(pts)
    tans = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    axes = []
    if normals is not None:
        nl = normals if isinstance(normals, list) else [normals] * n
        for d, v in zip(tans, nl):
            v = Vector(v)
            axes.append((v - d * v.dot(d)).normalized())
    else:
        up = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
        a = tans[0].cross(up).normalized()
        for i, d in enumerate(tans):
            if i:
                a = tans[i - 1].rotation_difference(d) @ a
                a = (a - d * a.dot(d)).normalized()
            axes.append(a)
    for i, p in enumerate(pts):
        a = axes[i]
        b = tans[i].cross(a).normalized()
        ring = []
        for k in range(sides):
            t = 2 * math.pi * k / sides
            ring.append(bm.verts.new(p + (a * math.cos(t) * squash + b * math.sin(t)) * radii[i]))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            j = (k + 1) % sides
            bm.faces.new([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]])
    if cap:
        for ring, end in ((rings[0], pts[0] - (pts[1] - pts[0]).normalized() * radii[0] * 0.6), (rings[-1], pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 0.6)):
            c = bm.verts.new(end)
            for k in range(sides):
                bm.faces.new([ring[k], ring[(k + 1) % sides], c])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, material, subsurf=subsurf)


def lathe(name, profile, material, segs=32, center=(0, 0, 0), depth=1.0, subsurf=1, close_top=True, close_bottom=True):
    """Surface of revolution: profile is [(radius, z)], `depth` squashes front-back (Y)."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for k in range(segs):
            t = 2 * math.pi * k / segs
            ring.append(bm.verts.new((center[0] + math.cos(t) * r, center[1] + math.sin(t) * r * depth, center[2] + z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]])
    if close_bottom:
        bm.faces.new(list(reversed(rings[0])))
    if close_top:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, material, subsurf=subsurf)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    return ob


def smooth01(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def paint(ob, fn):
    """Per-vertex colour (linear RGB multiplier on the material colour), fn(world co) -> rgb."""
    me = ob.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for i, v in enumerate(me.vertices):
        attr.data[i].color = (*fn(ob.matrix_world @ v.co), 1.0)
    me.color_attributes.active_color_name = 'Col'
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


_BAKED = {'mat': None, 'ids': {}}


def bake_materials(ob):
    """Fold an object's materials into face-corner colours (rgb = colour, a = ink line id / 255) under
    one shared material, so a whole chunk of scenery is one draw call but keeps its outlines.
    Ids 10..199 are used here; the game hands out 200+ at runtime."""
    if _BAKED['mat'] is None or _BAKED['mat'].name not in bpy.data.materials:
        _BAKED['mat'] = mat('scenery', '#FFFFFF', vcol=True)
        _BAKED['ids'] = {}
    ids = _BAKED['ids']
    me = ob.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    cols = []
    for m in me.materials:
        if m.name not in ids:
            ids[m.name] = 10 + len(ids) % 190
        base = m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
        cols.append((base[0], base[1], base[2], ids[m.name] / 255.0))
    for poly in me.polygons:
        c = cols[poly.material_index] if cols else (1, 1, 1, 1)
        for li in poly.loop_indices:
            attr.data[li].color = c
    me.color_attributes.active_color_name = 'Col'
    me.materials.clear()
    me.materials.append(_BAKED['mat'])
    for poly in me.polygons:
        poly.material_index = 0


# --- rigging -------------------------------------------------------------------------------

def armature(name, bones):
    """bones: [(name, head, tail, parent)] in armature space; roll 0, unconnected."""
    arm = bpy.data.armatures.new(name)
    ob = link(bpy.data.objects.new(name, arm))
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    for n, h, t, p in bones:
        eb = arm.edit_bones.new(n)
        eb.head, eb.tail, eb.roll = Vector(h), Vector(t), 0.0
        if p:
            eb.parent = arm.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def dist_weights(p, segs, mult=None, power=5.0):
    """Blend between nearby bones by inverse distance to their segments: segs {bone: (head, tail)}."""
    w = {}
    for b, (h, t) in segs.items():
        d = max(seg_dist(p, h, t), 1e-4)
        w[b] = (mult or {}).get(b, 1.0) / d ** power
    return w


def set_weights(ob, fn, limit=4):
    """Vertex groups from fn(world co) -> {bone: weight}, keeping the strongest `limit`, normalised."""
    groups = {}
    for v in ob.data.vertices:
        w = sorted(((b, x) for b, x in fn(ob.matrix_world @ v.co).items() if x > 0), key=lambda e: -e[1])[:limit]
        s = sum(x for _, x in w)
        for b, x in w:
            if x / s < 0.01:
                continue
            g = groups.get(b) or ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
            groups[b] = g
            g.add([v.index], x / s, 'REPLACE')


def bind(ob, arm_ob):
    ob.parent = arm_ob
    md = ob.modifiers.new('armature', 'ARMATURE')
    md.object = arm_ob


class Poser:
    """Keyframes poses written as rotations about the armature's own axes (degrees, XYZ order) and
    offsets in armature space, applied to each bone relative to its parent as if at rest:
    q_local = R_rest^-1 * q_armature * R_rest."""

    def __init__(self, ob):
        self.ob = ob
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in ob.data.bones}
        self.last = {}

    def begin(self, name):
        ad = self.ob.animation_data or self.ob.animation_data_create()
        act = bpy.data.actions.new(name)
        ad.action = act
        self.act = act
        self.last = {}
        return act

    def key(self, frame, spec, bones):
        for b in bones:
            pb = self.ob.pose.bones[b]
            s = spec.get(b, {})
            R = self.rest[b]
            q = R.inverted() @ Euler([math.radians(a) for a in s.get('r', (0, 0, 0))], 'XYZ').to_quaternion() @ R
            prev = self.last.get(b)
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            self.last[b] = q
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = q
            pb.location = R.inverted() @ Vector(s.get('t', (0, 0, 0)))
            pb.scale = s.get('s', (1, 1, 1))
            for path in ('rotation_quaternion', 'location', 'scale'):
                pb.keyframe_insert(path, frame=frame, group=b)

    def end(self, loop):
        act = self.act
        for fc in fcurves(act):
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
            if loop:
                fc.modifiers.new('CYCLES')
            fc.update()
        ad = self.ob.animation_data
        tr = ad.nla_tracks.new()
        tr.name = act.name
        tr.strips.new(act.name, int(act.frame_range[0]), act)
        tr.mute = True
        ad.action = None
        act.use_fake_user = True


def fcurves(act):
    """All F-curves of an action (layered actions keep them in a channelbag per slot)."""
    if hasattr(act, 'layers') and len(act.layers):
        out = []
        for layer in act.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.extend(bag.fcurves)
        return out
    return list(act.fcurves)


def mirror(spec):
    """Mirror a pose spec written for the left side onto the right (and vice versa)."""
    out = {}
    for b, s in spec.items():
        n = b[:-2] + ('_R' if b.endswith('_L') else '_L') if b.endswith(('_L', '_R')) else b
        m = {}
        if 'r' in s:
            m['r'] = (s['r'][0], -s['r'][1], -s['r'][2])
        if 't' in s:
            m['t'] = (-s['t'][0], s['t'][1], s['t'][2])
        if 's' in s:
            m['s'] = s['s']
        out[n] = m
    return out


# --- animation clips -------------------------------------------------------------------

def spline(keys, f, period=None):
    if not isinstance(keys, list):
        return keys
    if len(keys) == 1:
        return keys[0][1]
    if period:
        f %= period
        ks = [(t - period, v) for t, v in keys[-2:]] + keys + [(t + period, v) for t, v in keys[:2]]
    else:
        if f <= keys[0][0]:
            return keys[0][1]
        if f >= keys[-1][0]:
            return keys[-1][1]
        ks = [keys[0]] + keys + [keys[-1]]

    def tangent(i):
        (t0, v0), (t1, v1), (t2, v2) = ks[i - 1], ks[i], ks[i + 1]
        if t2 == t0 or (v1 - v0) * (v2 - v1) <= 0:
            return 0.0  # clamp at extremes so poses hold their values instead of overshooting
        return (v2 - v0) / (t2 - t0)

    for i in range(1, len(ks) - 2):
        (t0, v0), (t1, v1) = ks[i], ks[i + 1]
        if t0 <= f <= t1 and t1 > t0:
            h = t1 - t0
            s = (f - t0) / h
            m0, m1 = tangent(i) * h, tangent(i + 1) * h
            s2, s3 = s * s, s * s * s
            return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * m1
    return ks[-2][1]


def expand(ch, sym, N):
    """Copy _L channels onto _R (mirrored, phase-shifted) where the clip doesn't pose _R itself."""
    out = dict(ch)
    if sym is None:
        return out, {}
    shift = {}
    for b, c in ch.items():
        if b.endswith('_L') and b[:-2] + '_R' not in ch:
            r = b[:-2] + '_R'
            m = {}
            for k, v in c.items():
                neg = k in ('ry', 'rz', 'tx')
                if isinstance(v, list):
                    m[k] = [(t, -x if neg else x) for t, x in v]
                else:
                    m[k] = -v if neg else v
            out[r] = m
            shift[r] = sym
    return out, shift


def pose_at(ch, shift, f, N, loop, body, parent):
    spec, absx = {}, {}
    for b in body:
        c = ch.get(b, {})
        g = f + shift.get(b, 0)
        val = {k: spline(v, g, N if loop else None) for k, v in c.items()}
        parent_abs = absx.get(parent.get(b), 0.0)
        rx = val['ax'] - parent_abs if 'ax' in val else val.get('rx', 0.0)
        absx[b] = parent_abs + rx
        spec[b] = {'r': (rx, val.get('ry', 0.0), val.get('rz', 0.0)),
                   't': (val.get('tx', 0.0), val.get('ty', 0.0), val.get('tz', 0.0)),
                   's': (val.get('sx', 1.0), val.get('sy', 1.0), val.get('sz', 1.0))}
    return spec


def clip(poser, name, N, ch, body, parent, loop=True, sym=None, bones=None):
    """Key a clip every frame from spline channels (see ada_anims for the conventions)."""
    ch, shift = expand(ch, sym, N)
    poser.begin(name)
    for f in range(N + 1):
        if bones is None:
            poser.key(f, pose_at(ch, shift, f, N, loop, body, parent), body)
        else:
            spec = {b: {'s': tuple(spline(ch[b].get(k, 1.0), f, N if loop else None) for k in ('sx', 'sy', 'sz'))} for b in bones}
            poser.key(f, spec, bones)
    poser.end(loop)



def preview(path, target=(0, 0, 0.7), dist=3.0, yaw=-30, pitch=8, size=(900, 900), samples=24, lens=50, engine='CYCLES'):
    """Quick render for checking shapes (soft key light + bright sky)."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES' if engine == 'CYCLES' else 'BLENDER_WORKBENCH'
    if engine != 'CYCLES':
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.shading.show_object_outline = True
        scene.display.render_aa = '8'
    w = bpy.data.worlds.new('w')
    scene.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.8, 0.82, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.0
    sun.data.angle = 0.2
    sun.rotation_euler = (math.radians(45), 0, math.radians(-35))
    link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = lens
    link(cam)
    scene.camera = cam
    t = Vector(target)
    y, p = math.radians(yaw), math.radians(pitch)
    cam.location = t + Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = path
    scene.render.film_transparent = False
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(sun)


def export_glb(path, objects=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if objects is not None:
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=objects is not None,
        export_yup=True,
        export_apply=False,
        export_texcoords=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_frame_step=1,
        export_skins=True,
        export_morph=False,
        export_materials='EXPORT',
        export_vertex_color='ACTIVE',
        export_extras=True,
        export_def_bones=False,
        export_optimize_animation_size=False,
    )
    print('wrote', os.path.relpath(path, ROOT), os.path.getsize(path) // 1024, 'KB')
