"""
Environment kit + lightmap pipeline (every level is built by a script from these pieces).

Pieces are real geometry with bevelled edges so light catches them (panelled walls, beams, pipes with flanges, sagging cables, light
fixtures with emissive diffusers, doors, consoles with generated screens, racks, grates, vents, debris). Surfaces use the photoscanned
PBR sets (Poly Haven, CC0) through metric UVs (1 UV unit = 1 m; material tile = repeats per metre), the same recipe system as the
characters, so the engine rebuilds every material identically.

Lighting is baked: each level section is joined into one mesh, given a second UV set ('LM', lightmap pack) and Cycles bakes the
diffuse lighting (direct + indirect, no albedo) into an HDR lightmap: soft area-light shadows, bounce light, contact occlusion. In the
game the albedo is multiplied by the lightmap; glossy reflections come from probes; characters get real-time lights and probes.
Collision is exported as separate simple boxes (tagged), gameplay markers as empties with extras.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import garments as Gm  # noqa: E402
import hardsurface as HS  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PH = os.path.join(ROOT, 'vendor', 'polyhaven', 'textures')
PUB = os.path.join(ROOT, 'public', 'assets')


# --- scene ----------------------------------------------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('world')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.0, 0.0, 0.0, 1)
    return sc


class Section:
    """Collects the static meshes, collision boxes, lights and markers of one level section."""

    def __init__(self, name):
        self.name = name
        self.static = []
        self.collide = []
        self.markers = []
        self.coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(self.coll)

    def link(self, ob):
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        self.coll.objects.link(ob)
        return ob

    def add(self, ob):
        self.static.append(self.link(ob))
        return ob


MATS = {}


def mat(key, tex, tile, tint=(1, 1, 1), **kw):
    """Cached PBR material from a Poly Haven set (metric UVs: tile = repeats per metre)."""
    if key not in MATS:
        MATS[key] = Gm.pbr(key, PH, tex, tile=tile, tint=tint, **kw)
    return MATS[key]


def emissive_mat(key, color, strength):
    if key not in MATS:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*color, 1)
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = strength
        m['ft'] = json.dumps({'type': 'emissive', 'color': list(color), 'strength': strength, 'static': True})
        MATS[key] = m
    return MATS[key]


def plain_mat(key, color, rough=0.5, metal=0.0):
    if key not in MATS:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*color, 1)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        m['ft'] = json.dumps({'type': 'plain', 'color': list(color), 'rough': rough, 'metal': metal})
        MATS[key] = m
    return MATS[key]


# --- geometry primitives ----------------------------------------------------------------------------------------------------

def _obj(name, me, material=None):
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material is not None:
        me.materials.append(material)
    return ob


def box(name, size, loc, material, bevel=0.01, rot=(0, 0, 0), segments=2):
    """A bevelled box (size = full extents), applied: real rounded edges that catch light."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), segments=segments, profile=0.5, affect='EDGES')
    bm.to_mesh(me)
    bm.free()
    ob = _obj(name, me, material)
    ob.location = loc
    ob.rotation_euler = rot
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(40))
    return ob


def cylinder(name, r, depth, loc, material, axis='Z', verts=24, bevel=0.004, rot=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=depth)
    if bevel > 0:
        caps = [e for e in bm.edges if all(abs(abs(v.co.z) - depth / 2) < 1e-5 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=caps, offset=bevel, segments=2, profile=0.5, affect='EDGES')
    bm.to_mesh(me)
    bm.free()
    ob = _obj(name, me, material)
    ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    elif axis == 'X':
        ob.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Y':
        ob.rotation_euler = (math.pi / 2, 0, 0)
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(40))
    return ob


def tube(name, pts, radius, material, sides=16, sag=0.0):
    """A pipe / cable through points (Catmull-Rom smoothed, optional sag between ends)."""
    P = [Vector(p) for p in pts]
    if sag > 0 and len(P) == 2:
        a, b = P
        P = [a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t))) for t in np.linspace(0, 1, 14)]
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(P) - 1)
    for i, p in enumerate(P):
        sp.points[i].co = (p.x, p.y, p.z, 1)
    cu.bevel_depth = radius
    cu.bevel_resolution = max(2, sides // 4)
    cu.use_fill_caps = True
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    out = _obj(name, me, material)
    for p in me.polygons:
        p.use_smooth = True
    return out


def join(objs, name):
    """Join objects into one mesh (applies transforms)."""
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    # bake the transform into the mesh: pieces are authored around the world origin and placed afterwards
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


# --- kit pieces ---------------------------------------------------------------------------------------------------------------

def panel_wall(name, p0, p1, height, z0, M, panel_w=1.2, depth=0.12, inward=(0, 0, 0)):
    """A structural wall from p0 to p1 (xy) with a row of raised inset panels, a skirting rail and a top rail on its inner face."""
    p0, p1 = Vector((*p0, 0)), Vector((*p1, 0))
    d = p1 - p0
    L = d.length
    ang = math.atan2(d.y, d.x)
    n_in = Vector(inward).normalized()
    parts = [box(name + '_core', (L, depth, height), (0, 0, 0), M['wall'], bevel=0.008)]
    n = max(1, int(L / panel_w))
    w = L / n
    for i in range(n):
        x = -L / 2 + (i + 0.5) * w
        parts.append(box(f'{name}_p{i}', (w - 0.06, 0.03, height * 0.62), (x, -depth / 2 - 0.015, -height * 0.05), M['panel'], bevel=0.012))
        parts.append(box(f'{name}_v{i}', (w * 0.5, 0.012, 0.12), (x, -depth / 2 - 0.036, height * 0.18), M['vent'], bevel=0.004))
    parts.append(box(name + '_skirt', (L, 0.06, 0.16), (0, -depth / 2 - 0.03, -height / 2 + 0.08), M['trim'], bevel=0.01))
    parts.append(box(name + '_rail', (L, 0.08, 0.1), (0, -depth / 2 - 0.04, height * 0.33), M['trim'], bevel=0.012))
    ob = join(parts, name)
    mid = (p0 + p1) / 2
    ob.matrix_world = Matrix.Translation((mid.x, mid.y, z0 + height / 2)) @ Matrix.Rotation(ang, 4, 'Z')
    # make sure the panelled side faces `inward`
    face = Matrix.Rotation(ang, 3, 'Z') @ Vector((0, -1, 0))
    if face.dot(n_in) < 0:
        ob.matrix_world = Matrix.Translation((mid.x, mid.y, z0 + height / 2)) @ Matrix.Rotation(ang + math.pi, 4, 'Z')
    return ob


def area_light(name, loc, size, power, color=(1, 1, 1), rot=(0, 0, 0), shape='RECTANGLE'):
    l = bpy.data.lights.new(name, 'AREA')
    l.shape = shape
    if shape == 'RECTANGLE':
        l.size, l.size_y = size
    else:
        l.size = size[0]
    l.energy = power
    l.color = color
    ob = bpy.data.objects.new(name, l)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    # the same light for characters in the game (static surfaces have it baked): an empty with the light's parameters
    mk = bpy.data.objects.new(name + '_rt', None)
    bpy.context.scene.collection.objects.link(mk)
    mk.location = loc
    mk.rotation_euler = rot
    mk['marker'] = 'light'
    mk['light'] = json.dumps({'kind': 'area' if shape == 'RECTANGLE' else 'point', 'size': list(size), 'power': power,
                              'color': list(color)})
    LIGHT_MARKERS.append(mk)
    return ob


LIGHT_MARKERS = []


LAMP_POWER = [240.0]  # watts for a full-strength 3 m fixture (levels can set it)


def light_strip(name, length, loc, rot_z, M, on=True, color=(0.85, 0.92, 1.0), strength=18.0, power=None):
    """Ceiling light fixture: housing + emissive diffuser (seen glowing) + a matching area light just below it (lights the bake with
    soft, low-noise illumination)."""
    hous = box(name + '_h', (length, 0.22, 0.08), (0, 0, 0), M['trim'], bevel=0.01)
    dif = box(name + '_d', (length - 0.06, 0.16, 0.02), (0, 0, -0.045), emissive_mat(f'light_{color}_{strength if on else 0}', color,
                                                                               strength if on else 0.0), bevel=0.004)
    ob = join([hous, dif], name)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    if on:
        power = LAMP_POWER[0] * length / 3.0 if power is None else power
        area_light(name + '_area', (loc[0], loc[1], loc[2] - 0.07), (length - 0.06, 0.16), power * strength / 18.0, color,
                   rot=(0, 0, rot_z))
    return ob


def pipe_run(name, pts, r, M, flange_every=2.0):
    parts = [tube(name, pts, r, M['pipe'])]
    P = [Vector(p) for p in pts]
    acc = 0.0
    for a, b in zip(P, P[1:]):
        seg = (b - a)
        L = seg.length
        n = int((acc + L) / flange_every)
        for k in range(1, n + 1):
            t = (k * flange_every - acc) / L
            if 0 < t < 1:
                c = a.lerp(b, t)
                fl = cylinder(f'{name}_f{len(parts)}', r * 1.45, 0.05, c, M['flange'], verts=20)
                fl.rotation_euler = seg.to_track_quat('Z', 'Y').to_euler()
                parts.append(fl)
        acc = (acc + L) % flange_every
    return join(parts, name)


def cable_run(name, a, b, M, n=4, sag=0.25, spread=0.05):
    parts = []
    for i in range(n):
        o = Vector(((i - n / 2) * spread * 0.6, (i % 2) * spread, 0))
        parts.append(tube(f'{name}_{i}', [Vector(a) + o, Vector(b) + o], 0.012 + 0.006 * (i % 2), M['cable'], sides=8,
                          sag=sag * (0.8 + 0.25 * i)))
    return join(parts, name)


def screen_texture(path, w=512, h=320, seed=0, hue=(0.25, 0.8, 1.0)):
    """A HELIX terminal screen: dark glass, graph lines, readouts and a warning banner (generated, no third-party art)."""
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4), dtype=np.float32)
    img[..., 3] = 1
    base = np.array(hue) * 0.06
    img[..., :3] = base
    for k in range(6):  # graph traces
        y0 = rng.uniform(0.15, 0.85) * h
        xs = np.arange(w)
        ys = (y0 + np.cumsum(rng.normal(0, 1.2, w))).astype(int).clip(0, h - 1)
        for dx in (0, 1):
            img[ys, (xs + dx).clip(0, w - 1), :3] = np.array(hue) * (0.6 + 0.4 * rng.random())
    for r in range(18):  # readout rows
        y = int(h * 0.08 + r * h * 0.045)
        x = int(w * 0.68)
        L = int(rng.uniform(0.08, 0.28) * w)
        img[y:y + 3, x:x + L, :3] = np.array(hue) * 0.75
    img[: int(h * 0.07), :, :3] = (0.9, 0.25, 0.12)  # warning banner
    img[int(h * 0.02):int(h * 0.05), int(w * 0.04):int(w * 0.4), :3] = (1.0, 0.85, 0.7)
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
    im.pixels.foreach_set(img[::-1].ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    return im


def screen_mat(key, tex_rel, strength=3.0):
    """Emissive screen with an image (relative to public/assets)."""
    if key not in MATS:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes['Principled BSDF']
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(PUB, tex_rel), check_existing=True)
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = strength
        b.inputs['Roughness'].default_value = 0.08
        m['ft'] = json.dumps({'type': 'screen', 'tex': tex_rel, 'strength': strength})
        MATS[key] = m
    return MATS[key]


def console(name, loc, rot_z, M, screen):
    desk = box(name + '_desk', (1.4, 0.7, 0.08), (0, 0, 0.92), M['panel'], bevel=0.012)
    body = box(name + '_body', (1.3, 0.55, 0.85), (0, 0.06, 0.45), M['panel'], bevel=0.015)
    kick = box(name + '_kick', (1.26, 0.5, 0.1), (0, 0.1, 0.05), M['trim'], bevel=0.008)
    mon = box(name + '_mon', (1.0, 0.06, 0.6), (0, 0.22, 1.38), M['trim'], bevel=0.01, rot=(math.radians(-12), 0, 0))
    scr = box(name + '_scr', (0.92, 0.01, 0.52), (0, 0.185, 1.38), screen, bevel=0.0, rot=(math.radians(-12), 0, 0))
    arm = box(name + '_arm', (0.08, 0.08, 0.36), (0, 0.27, 1.1), M['trim'], bevel=0.01)
    keys = box(name + '_keys', (0.6, 0.22, 0.02), (0, -0.1, 0.97), M['vent'], bevel=0.004)
    ob = join([desk, body, kick, mon, scr, arm, keys], name)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    return ob


def rack(name, loc, rot_z, M, led):
    frame = box(name + '_frame', (0.62, 0.9, 2.1), (0, 0, 1.05), M['trim'], bevel=0.012)
    parts = [frame]
    for i in range(9):
        z = 0.25 + i * 0.2
        parts.append(box(f'{name}_u{i}', (0.54, 0.02, 0.17), (0, -0.455, z), M['vent'], bevel=0.003))
        parts.append(box(f'{name}_l{i}', (0.03, 0.01, 0.012), (0.2 - (i % 3) * 0.05, -0.468, z + 0.05), led, bevel=0.0))
    ob = join(parts, name)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    return ob


def debris(name, loc, M, n=7, seed=1, size=0.25):
    """Concrete chunks (noisy SDF rocks) scattered around a point: fallen ceiling, broken walls."""
    import sdf
    rng = np.random.default_rng(seed)
    parts = []
    for i in range(n):
        s = size * rng.uniform(0.35, 1.0)
        c = np.array(loc) + np.array([rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), 0]) * size * 3
        c[2] = s * 0.35
        R = sdf.rot(rng.uniform(0, 180), rng.uniform(0, 180), rng.uniform(0, 180))
        f = sdf.displace(sdf.box(c, (s, s * rng.uniform(0.5, 0.9), s * rng.uniform(0.4, 0.7)), s * 0.12, R=R),
                         lambda P, sd=int(rng.integers(1000)), s=s: sdf.fbm(P, 9.0 / s, 3, sd) * s * 0.18)
        ob = sdf.sculpt(f'{name}_{i}', f, c - s * 1.6, c + s * 1.6, s / 14, material=M['debris'], tris=900)
        parts.append(ob)
    return join(parts, name)


# --- lightmaps + export -----------------------------------------------------------------------------------------------------

def finish_static(ob):
    """Metric UVs for the materials (UV0) + a lightmap UV (UV1, 'LM')."""
    HS.uv_metric(ob, angle=50.0, margin=0.002)
    me = ob.data
    me.uv_layers[0].name = 'UVMap'
    lm = me.uv_layers.new(name='LM')
    me.uv_layers.active = lm
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # angle-based islands (each planar region one connected island, not one island per face), packed at uniform texel density
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True
    return ob


def bake_lightmap(ob, path, size=2048, samples=128):
    """Cycles: diffuse lighting (direct + indirect, no albedo) into the LM UVs -> Radiance HDR file."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    sc.render.bake.margin = 6
    sc.render.bake.target = 'IMAGE_TEXTURES'
    img = bpy.data.images.new(os.path.basename(path), size, size, float_buffer=True, alpha=False)
    nodes = []
    for m in ob.data.materials:
        nt = m.node_tree
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'LM'
        nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n
        nodes.append((nt, n, uvn))
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    # Cycles bakes into the mesh's ACTIVE uv map: make it the lightmap set (materials keep rendering from the active_render set)
    uvs = ob.data.uv_layers
    uvs['UVMap'].active_render = True
    uvs.active = uvs['LM']
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_clear=True, margin=6)
    uvs.active = uvs['UVMap']
    # denoise lightly: a separable blur restricted to covered texels (bakes carry sampling noise; lighting is smooth)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)
    cov = (px[..., :3].sum(-1) > 0).astype(np.float32)
    rgb = px[..., :3]
    for _ in range(2):
        num = rgb * cov[..., None]
        den = cov.copy()
        for ax in (0, 1):
            num = (np.roll(num, 1, ax) + 2 * num + np.roll(num, -1, ax)) / 4
            den = (np.roll(den, 1, ax) + 2 * den + np.roll(den, -1, ax)) / 4
        rgb = np.where(cov[..., None] > 0, num / np.maximum(den[..., None], 1e-6), rgb)
    px[..., :3] = rgb
    img.pixels.foreach_set(px.ravel())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path
    img.file_format = 'HDR'
    img.save()
    for nt, n, uvn in nodes:
        nt.nodes.remove(n)
        nt.nodes.remove(uvn)
    return img


def copy_textures():
    """1k JPEG copies of every PBR set in use (the engine loads them by recipe)."""
    texroot = os.path.join(PUB, 'textures', 'pbr')
    used = {json.loads(m['ft'])['tex'] for m in bpy.data.materials if 'ft' in m and json.loads(m['ft']).get('type') == 'pbr'}
    for tid in used:
        for kind in ('diff', 'nor_gl', 'rough'):
            dst = os.path.join(texroot, tid, f'{tid}_{kind}.jpg')
            src = os.path.join(PH, tid, f'{tid}_{kind}_2k.jpg')
            if os.path.exists(dst) or not os.path.exists(src):
                continue
            img = bpy.data.images.load(src)
            img.scale(1024, 1024)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            img.filepath_raw = dst
            img.file_format = 'JPEG'
            img.save()
            bpy.data.images.remove(img)


def strip_textures():
    for m in bpy.data.materials:
        if 'ft' in m and json.loads(m['ft']).get('type') in ('pbr',) and m.node_tree:
            for n in [n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE']:
                m.node_tree.nodes.remove(n)


def export(objs, path, extras=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    sc = bpy.context.scene
    for k, v in (extras or {}).items():
        sc[k] = json.dumps(v)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_extras=True, export_texcoords=True,
                              export_normals=True, export_tangents=True, export_materials='EXPORT', export_yup=True,
                              export_apply=True, export_vertex_color='NONE')
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


# --- rooms, doors, set pieces ---------------------------------------------------------------------------------------------------

def glass_mat(key='glass', tint=(0.75, 0.85, 0.9), rough=0.05):
    if key not in MATS:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*tint, 1)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Transmission Weight'].default_value = 1.0
        m['ft'] = json.dumps({'type': 'glass', 'tint': list(tint), 'rough': rough})
        MATS[key] = m
    return MATS[key]


def _wall_segments(a, b, openings):
    """Split [a, b] (1D) by openings [(center, width)] -> solid spans."""
    cuts = sorted((c - w / 2, c + w / 2) for c, w in openings)
    spans, cur = [], a
    for lo, hi in cuts:
        if lo > cur:
            spans.append((cur, lo))
        cur = max(cur, hi)
    if cur < b:
        spans.append((cur, b))
    return spans


def room(S, name, x0, x1, y0, y1, H, M, openings=None, beams=True, ceiling=True, floor_mat='floor', door_h=2.9):
    """A rectangular room (Blender xy, y0 > y1 going 'north' = -Y). openings: {'n'|'s'|'e'|'w': [(center, width)]} along the wall.
    Builds floor, ceiling + beams, panelled walls split around openings with headers and frames; adds collision boxes."""
    openings = openings or {}
    W, L = x1 - x0, y0 - y1
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    S.add(box(f'{name}_floor', (W, L, 0.2), (cx, cy, -0.1), M[floor_mat], bevel=0.0))
    if ceiling:
        S.add(box(f'{name}_ceil', (W + 0.3, L + 0.3, 0.3), (cx, cy, H + 0.15), M['ceiling'], bevel=0.0))
        if beams:
            for i in range(int(L / 2.5) + 1):
                S.add(box(f'{name}_beam{i}', (W, 0.3, 0.4), (cx, y0 - i * 2.5, H - 0.2), M['trim'], bevel=0.015))
    walls = {'s': ((x0, y0), (x1, y0), (0, -1, 0)), 'n': ((x0, y1), (x1, y1), (0, 1, 0)),
             'w': ((x0, y0), (x0, y1), (1, 0, 0)), 'e': ((x1, y0), (x1, y1), (-1, 0, 0))}
    for side, (p0, p1, inward) in walls.items():
        horiz = side in ('n', 's')
        a, b = (p0[0], p1[0]) if horiz else (p1[1], p0[1])
        ops = openings.get(side, [])
        for k, (lo, hi) in enumerate(_wall_segments(a, b, ops)):
            if hi - lo < 0.05:
                continue
            q0 = (lo, p0[1]) if horiz else (p0[0], hi)
            q1 = (hi, p0[1]) if horiz else (p0[0], lo)
            S.add(panel_wall(f'{name}_{side}{k}', q0, q1, H, 0, M, inward=inward))
            mid = ((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2)
            size = ((hi - lo), 0.3, H) if horiz else (0.3, (hi - lo), H)
            o = box(f'col_{name}_{side}{k}', size, (mid[0], mid[1], H / 2), None, bevel=0.0)
            o['collision'] = True
            o.hide_render = True
            S.collide.append(S.link(o))
        for j, (c, w) in enumerate(ops):
            pos = (c, p0[1]) if horiz else (p0[0], c)
            hdr_size = (w, 0.14, H - door_h) if horiz else (0.14, w, H - door_h)
            S.add(box(f'{name}_{side}hdr{j}', hdr_size, (pos[0], pos[1], door_h + (H - door_h) / 2), M['wall'], bevel=0.008))
            fr = (w + 0.3, 0.24, 0.18) if horiz else (0.24, w + 0.3, 0.18)
            S.add(box(f'{name}_{side}frt{j}', fr, (pos[0], pos[1], door_h + 0.09), M['trim'], bevel=0.02))
            for sgn in (-1, 1):
                jamb = (0.15, 0.26, door_h) if horiz else (0.26, 0.15, door_h)
                jp = (pos[0] + sgn * (w / 2 + 0.075), pos[1]) if horiz else (pos[0], pos[1] + sgn * (w / 2 + 0.075))
                S.add(box(f'{name}_{side}jamb{j}{sgn}', jamb, (jp[0], jp[1], door_h / 2), M['trim'], bevel=0.02))
    o = box(f'col_{name}_floor', (W, L, 0.2), (cx, cy, -0.1), None, bevel=0.0)
    o['collision'] = True
    o.hide_render = True
    S.collide.append(S.link(o))


def sliding_door(S, name, center, horiz, width, M, door_h=2.9, state='closed', role='door'):
    """Two door leaves exported as dynamic objects (the engine slides them apart); marker extras say how."""
    leaves = []
    for sgn in (-1, 1):
        size = (width / 2, 0.1, door_h - 0.05) if horiz else (0.1, width / 2, door_h - 0.05)
        off = (sgn * width / 4, 0) if horiz else (0, sgn * width / 4)
        lf = box(f'{name}_leaf{sgn}', size, (center[0] + off[0], center[1] + off[1], door_h / 2), M['door'], bevel=0.015)
        stripe = box(f'{name}_st{sgn}', (size[0] * 0.9 if horiz else 0.11, 0.11 if horiz else size[1] * 0.9, 0.12),
                     (center[0] + off[0], center[1] + off[1], 1.2), M['hazard'], bevel=0.004)
        lf = join([lf, stripe], f'{name}_leaf{sgn}')
        lf['dynamic'] = 'door'
        lf['door'] = name
        lf['slide'] = json.dumps([sgn * width / 2 * (1 if horiz else 0), 0.0, sgn * width / 2 * (0 if horiz else 1)])
        leaves.append(S.link(lf))
    e = bpy.data.objects.new(f'{name}_marker', None)
    e.location = (center[0], center[1], 0)
    e['marker'] = role
    e['id'] = name
    e['state'] = state
    e['width'] = width
    e['horiz'] = horiz
    S.markers.append(S.link(e))
    S.dynamic = getattr(S, 'dynamic', []) + leaves
    return leaves


def marker(S, kind, loc, yaw=0.0, **data):
    e = bpy.data.objects.new(f'{kind}_{len(S.markers)}', None)
    e.location = loc
    e['marker'] = kind
    e['yaw'] = yaw
    for k, v in data.items():
        e[k] = json.dumps(v) if isinstance(v, (list, dict)) else v
    S.markers.append(S.link(e))
    return e


def collide_box(S, name, size, loc):
    o = box(f'col_{name}', size, loc, None, bevel=0.0)
    o['collision'] = True
    o.hide_render = True
    S.collide.append(S.link(o))


def railing(name, p0, p1, M, h=1.05, post_every=1.5):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    n = max(1, int(d.length / post_every))
    parts = [tube(f'{name}_top', [p0 + Vector((0, 0, h)), p1 + Vector((0, 0, h))], 0.025, M['trim']),
             tube(f'{name}_mid', [p0 + Vector((0, 0, h * 0.5)), p1 + Vector((0, 0, h * 0.5))], 0.015, M['trim'])]
    for i in range(n + 1):
        c = p0.lerp(p1, i / n)
        parts.append(cylinder(f'{name}_p{i}', 0.025, h, (c.x, c.y, c.z + h / 2), M['trim'], verts=12))
    return join(parts, name)


def sign(name, text, loc, rot, size, material, depth=0.01):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.size = size
    cu.extrude = depth
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    out = _obj(name, me, material)
    out.location = loc
    out.rotation_euler = rot
    return out


def pod(name, loc, M):
    """Chronal integration pod: armoured base, couch, glass canopy ring, cyan light ring, cable sockets."""
    x, y, z = loc
    parts = [cylinder(f'{name}_base', 1.6, 0.5, (0, 0, 0.25), M['trim'], verts=48, bevel=0.03),
             cylinder(f'{name}_step', 1.9, 0.12, (0, 0, 0.06), M['panel'], verts=48, bevel=0.02),
             box(f'{name}_couch', (0.8, 2.2, 0.28), (0, 0, 0.66), M['panel'], bevel=0.08, rot=(math.radians(-14), 0, 0)),
             cylinder(f'{name}_ring', 1.62, 0.08, (0, 0, 0.52), M['glow'], verts=48, bevel=0.0)]
    for k in range(8):
        a = k / 8 * math.tau
        parts.append(box(f'{name}_rib{k}', (0.12, 0.12, 2.6), (math.cos(a) * 1.5, math.sin(a) * 1.5, 1.8), M['trim'], bevel=0.02,
                         rot=(0, 0, a)))
    parts.append(cylinder(f'{name}_crown', 1.6, 0.22, (0, 0, 3.1), M['trim'], verts=48, bevel=0.03))
    parts.append(cylinder(f'{name}_crownglow', 1.3, 0.04, (0, 0, 2.98), M['glow'], verts=48, bevel=0.0))
    ob = join(parts, name)
    ob.location = (x, y, z)
    return ob


def engine_ring(name, center, R, M, segments=24):
    """The Chronal Engine: a vertical ring of armoured segments around a glowing core track, with conduits."""
    import sdf
    parts = []
    cx, cy, cz = center
    for k in range(segments):
        a = k / segments * math.tau
        p = (cx + math.cos(a) * R, cy, cz + math.sin(a) * R)
        seg = box(f'{name}_s{k}', (R * math.tau / segments * 0.82, 1.6, 1.1), p, M['trim'], bevel=0.06, rot=(0, -a + math.pi / 2, 0))
        parts.append(seg)
        fin = box(f'{name}_f{k}', (0.3, 2.2, 1.6), (cx + math.cos(a) * (R + 0.6), cy, cz + math.sin(a) * (R + 0.6)), M['panel'],
                  bevel=0.04, rot=(0, -a + math.pi / 2, 0))
        parts.append(fin)
    core = tube(f'{name}_core', [(cx + math.cos(t) * (R - 0.62), cy, cz + math.sin(t) * (R - 0.62))
                                 for t in np.linspace(0, math.tau, 97)], 0.18, M['glow'], sides=12)
    parts.append(core)
    del sdf
    return join(parts, name)
