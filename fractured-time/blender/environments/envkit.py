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


def storm_hdri(glow=1.0, haze=(0.062, 0.07, 0.088), size=(1024, 512)):
    """The storm at nightfall as an equirect HDR (Blender's world mapping): the mean of the game's procedural storm sky
    (src/rendering/sky.ts `storm`: the same haze, zenith-to-horizon gradient, cloud cover and the city's glow on the low cloud),
    so lightmaps, probes and light volumes are lit by the sky the player sees. The HDRI the storm used to bake with was a sunny
    meadow under cumulus: dimmed, it still lit open ground about six times as strongly as the dark sky drawn above it. Below the
    horizon the dark city beyond the level. `glow` 0..1: the city's light under the clouds (the ruined future has almost none)."""
    path = os.path.join(ROOT, '.cache', 'sky', f'storm_{glow:.2f}.hdr')
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    W, H = size
    elev = ((np.arange(H) + 0.5) / H - 0.5) * math.pi        # pixel rows run from the nadir up
    h = np.sin(elev)
    up = np.maximum(h, 0.0)

    def sstep(e0, e1, x):
        t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
        return t * t * (3 - 2 * t)
    hz = np.array(haze, np.float64)
    gl = np.array([1.0, 0.52, 0.24]) * 0.05 * glow
    low = ((1 - up) ** 3)[:, None]
    horizon = hz * 1.05 + gl * 0.45
    base = hz * 0.32 + (horizon - hz * 0.32) * low
    lit = 0.75                                                # mean of the clouds' lit term
    cloud = base * (lit * 0.55 + 0.6) + gl * lit * (low * 0.9 + 0.15)
    deck = base * 0.55 + (cloud - base * 0.55) * 0.72         # gaps and masses at the deck's mean cover
    col = base + (deck - base) * sstep(0.0, 0.22, up)[:, None]
    col = col + (horizon - col) * sstep(0.0, -0.06, h)[:, None]
    col = col + (hz * 0.35 - col) * sstep(-0.02, -0.3, h)[:, None]
    write_hdr(path, np.repeat(col[::-1, None, :], W, axis=1))  # file rows run from the zenith down
    print('STORM SKY', path)
    return path


def write_hdr(path, rgb):
    """Radiance RGBE, flat scanlines, rows top-down: written directly (Blender's image save colour-manages float buffers)."""
    H, W, _ = rgb.shape
    m = rgb.max(axis=2)
    mant, ex = np.frexp(m)
    scale = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0.0)
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(m > 1e-32, ex + 128, 0).astype(np.uint8)
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {H} +X {W}\n'.encode())
        f.write(out.tobytes())


def sky_world(hdri, strength=1.0, rot_z=0.0):
    """An HDRI sky lights exterior bakes (interiors are sealed, so they never see it)."""
    w = bpy.context.scene.world
    nt = w.node_tree
    env = nt.nodes.get('sky_env') or nt.nodes.new('ShaderNodeTexEnvironment')
    env.name = 'sky_env'
    env.image = bpy.data.images.load(hdri, check_existing=True)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (0, 0, rot_z)
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    bg = nt.nodes['Background']
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength


class Section:
    """Collects the static meshes, collision boxes, lights and markers of one level section."""

    def __init__(self, name):
        self.name = name
        self.static = []
        self.static_a = []
        self.static_b = []
        self.collide = []
        self.markers = []
        self.coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(self.coll)

    def link(self, ob):
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        self.coll.objects.link(ob)
        return ob

    def add(self, ob, timeline=None):
        """Static geometry; timeline 'a' / 'b' marks geometry that exists in only one of the two realities (Timeline Shift)."""
        if timeline:
            ob['timeline'] = timeline
            getattr(self, f'static_{timeline}').append(self.link(ob))
        else:
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


def plain_mat(key, color, rough=0.5, metal=0.0, stripes=0.0, coat=0.0):
    """A flat-coloured PBR surface; `coat` adds a clear lacquer (car paint, varnish) over it."""
    if key not in MATS:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*color, 1)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        if coat:
            b.inputs['Coat Weight'].default_value = coat
            b.inputs['Coat Roughness'].default_value = 0.04
        m['ft'] = json.dumps({'type': 'plain', 'color': list(color), 'rough': rough, 'metal': metal, **({'stripes': stripes} if stripes else {}),
                              **({'coat': coat} if coat else {})})
        if stripes:
            # the same striping for the bake (Cycles): wave texture bands -> black / colour
            nt = m.node_tree
            tc = nt.nodes.new('ShaderNodeTexCoord')
            sep = nt.nodes.new('ShaderNodeSeparateXYZ')
            nt.links.new(tc.outputs['Object'], sep.inputs[0])
            add = nt.nodes.new('ShaderNodeMath')
            add.operation = 'ADD'
            nt.links.new(sep.outputs['X'], add.inputs[0])
            nt.links.new(sep.outputs['Y'], add.inputs[1])
            mul = nt.nodes.new('ShaderNodeMath')
            mul.operation = 'MULTIPLY'
            mul.inputs[1].default_value = stripes
            nt.links.new(add.outputs['Value'], mul.inputs[0])
            fr = nt.nodes.new('ShaderNodeMath')
            fr.operation = 'FRACT'
            nt.links.new(mul.outputs['Value'], fr.inputs[0])
            gt = nt.nodes.new('ShaderNodeMath')
            gt.operation = 'GREATER_THAN'
            gt.inputs[1].default_value = 0.5
            nt.links.new(fr.outputs['Value'], gt.inputs[0])
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.inputs[6].default_value = (*color, 1)
            mix.inputs[7].default_value = (0.02, 0.02, 0.022, 1)
            nt.links.new(gt.outputs['Value'], mix.inputs[0])
            nt.links.new(mix.outputs[2], b.inputs['Base Color'])
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

def panel_wall(name, p0, p1, height, z0, M, panel_w=1.2, depth=0.12, inward=(0, 0, 0), bay=3.0):
    """A structural wall from p0 to p1 (xy), inner face built in layers like a real facility wall: the core; structural pilasters
    every `bay` metres (dark chamfered steel, full height); between them a dark painted-metal wainscot (0-1.1 m) under lighter
    composite panels set back behind shadow gaps; a steel rail with a thin chronal-cyan LED line (M['led_line'], when present);
    a skirting kick plate. Real depth everywhere, so the lightmap bake gives contact shadows and every edge catches light."""
    p0, p1 = Vector((*p0, 0)), Vector((*p1, 0))
    d = p1 - p0
    L = d.length
    ang = math.atan2(d.y, d.x)
    n_in = Vector(inward).normalized()
    f = -depth / 2  # inner face (local -Y)
    parts = [box(name + '_core', (L, depth, height), (0, 0, 0), M['wall'], bevel=0.008)]
    nb = max(1, int(round(L / bay)))
    bw = L / nb
    wains = 1.1
    for i in range(nb + 1):
        x = -L / 2 + i * bw
        if 0 < i < nb or L > 2.0:
            px = min(max(x, -L / 2 + 0.16), L / 2 - 0.16)
            parts.append(box(f'{name}_pil{i}', (0.32, 0.2, height), (px, f - 0.1, 0), M['trim'], bevel=0.03))
    for i in range(nb):
        x = -L / 2 + (i + 0.5) * bw
        w = bw - 0.36
        if w < 0.3:
            continue
        # wainscot: dark painted metal, two plates with a seam
        for k in range(2):
            parts.append(box(f'{name}_wa{i}{k}', (w / 2 - 0.02, 0.04, wains - 0.24), (x - w / 4 + k * w / 2, f - 0.02, -height / 2 + 0.16 + (wains - 0.24) / 2),
                             M['wainscot'] if 'wainscot' in M else M['panel'], bevel=0.008))
        # upper composite panels, set back behind a shadow gap
        up_h = height - wains - 0.5
        nrow = max(1, int(up_h / 1.4))
        ph = up_h / nrow
        for r in range(nrow):
            zc = -height / 2 + wains + 0.12 + (r + 0.5) * ph
            parts.append(box(f'{name}_up{i}{r}', (w - 0.06, 0.03, ph - 0.05), (x, f - 0.015, zc), M['panel'], bevel=0.01))
        # a recessed vent grille low in alternate bays
        if i % 2 == 0 and w > 1.2:
            parts.append(box(f'{name}_vent{i}', (min(0.9, w * 0.5), 0.012, 0.22), (x, f - 0.042, -height / 2 + 0.5), M['vent'], bevel=0.004))
    parts.append(box(name + '_skirt', (L, 0.07, 0.14), (0, f - 0.035, -height / 2 + 0.07), M['trim'], bevel=0.01))
    parts.append(box(name + '_rail', (L, 0.09, 0.08), (0, f - 0.045, -height / 2 + wains), M['trim'], bevel=0.012))
    if 'led_line' in M:
        parts.append(box(name + '_led', (L - 0.1, 0.012, 0.018), (0, f - 0.091, -height / 2 + wains + 0.02), M['led_line'], bevel=0.0))
    ob = join(parts, name)
    mid = (p0 + p1) / 2
    ob.matrix_world = Matrix.Translation((mid.x, mid.y, z0 + height / 2)) @ Matrix.Rotation(ang, 4, 'Z')
    # make sure the panelled side faces `inward`
    face = Matrix.Rotation(ang, 3, 'Z') @ Vector((0, -1, 0))
    if face.dot(n_in) < 0:
        ob.matrix_world = Matrix.Translation((mid.x, mid.y, z0 + height / 2)) @ Matrix.Rotation(ang + math.pi, 4, 'Z')
    return ob


def area_light(name, loc, size, power, color=(1, 1, 1), rot=(0, 0, 0), shape='RECTANGLE', timeline=None):
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
    if timeline:
        # a fixture that exists in one reality only (Timeline Shift): its bakes, probes, volume and real-time copy follow it
        ob['timeline'] = timeline
        mk['timeline'] = timeline
    LIGHT_MARKERS.append(mk)
    return ob


def timeline_lights(tl):
    """Light objects that belong to timeline `tl` only."""
    return [o for o in bpy.data.objects if o.type == 'LIGHT' and o.get('timeline') == tl]


def show_timeline(S, tl):
    """Render state of one reality: the other timeline's dressing and fixtures hidden (None: neither hidden)."""
    for t2 in ('a', 'b'):
        hide = tl is not None and t2 != tl
        for o in getattr(S, f'static_{t2}') + timeline_lights(t2) + getattr(S, 'foliage_objs', {}).get(t2, []) + getattr(S, 'far', {}).get(t2, []):
            o.hide_render = hide


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
    me = ob.data
    # window coordinates (interior-mapped panes) ride in their own layer, kept after the lightmap's (TEXCOORD_2 in the game)
    win = None
    if 'WIN' in me.uv_layers:
        win = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers['WIN'].data.foreach_get('uv', win)
        me.uv_layers.remove(me.uv_layers['WIN'])
    if not me.uv_layers:  # statics built only from curves or text (cables, signs) carry no UV map: one is unwrapped below
        me.uv_layers.new(name='UVMap')
    me.uv_layers.active = me.uv_layers[0]
    HS.uv_metric(ob, angle=50.0, margin=0.002)
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
    if win is not None:
        wl = me.uv_layers.new(name='WIN')
        wl.data.foreach_set('uv', win)
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True
    return ob


# FT_REUSE_LM=1: keep lightmaps that already exist (re-export a level after a naming fix or a non-lighting change without
# re-baking it; the LM unwrap is deterministic, so an unchanged mesh gets the same UVs)
REUSE_LM = os.environ.get('FT_REUSE_LM') == '1'


def bake_lightmap(ob, path, size=2048, samples=128):
    """Cycles: diffuse lighting (direct + indirect, no albedo) into the LM UVs -> Radiance HDR file."""
    if REUSE_LM and os.path.exists(path):
        print('LM reused', path)
        return
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


def probe_points(objs, spacing=2.0, heights=(1.1,), clearance=0.25, exterior=False):
    """Light probe positions over the floor of a section: a grid inside its static bounds, kept only where the point is in open air
    (a floor below, something above, no surface within `clearance`, not inside a closed solid)."""
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for ob in objs:
        for c in ob.bound_box:
            w = np.array(ob.matrix_world @ Vector(c))
            lo, hi = np.minimum(lo, w), np.maximum(hi, w)
    dirs = [Vector(d).normalized() for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
                                             (1, 1, 0), (1, -1, 0), (-1, 1, 0), (-1, -1, 0), (1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1))]
    pts = []
    nx = max(1, int(round((hi[0] - lo[0]) / spacing)))
    ny = max(1, int(round((hi[1] - lo[1]) / spacing)))
    for i in range(nx):
        for j in range(ny):
            for z in heights:
                # cell centres (never on the bounding walls); a narrow corridor still gets a row down its middle
                p = Vector((lo[0] + (hi[0] - lo[0]) * (i + 0.5) / nx, lo[1] + (hi[1] - lo[1]) * (j + 0.5) / ny, z))
                ok = True
                for d in dirs:
                    hit, loc, nrm, _i, ob, _m = sc.ray_cast(dg, p, d, distance=40.0)
                    if not hit:
                        if (d.z < 0 if exterior else d.z <= 0):
                            ok = False  # open below (or sideways, indoors): outside the level
                        continue
                    if nrm.dot(d) > 0 or (loc - p).length < clearance:
                        ok = False  # inside a solid, or hugging a surface
                    if not ok:
                        break
                if ok:
                    pts.append(p)
    return pts


def bake_probes(points, path, res=16, samples=48):
    """Cycles renders the six cube faces at every probe point; the radiance is projected onto 9 SH coefficients (three.js convention:
    radiance SH, axes already in three space). Characters are lit by these, the same light as the lightmaps."""
    sc = bpy.context.scene
    old = (sc.camera, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath, sc.cycles.samples, sc.cycles.use_denoising,
           sc.view_settings.view_transform)
    cam = bpy.data.objects.new('probecam', bpy.data.cameras.new('probecam'))
    sc.collection.objects.link(cam)
    cam.data.angle = math.pi / 2
    cam.data.clip_start = 0.02
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.use_persistent_data = True
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    tmp = os.path.join(ROOT, '.cache', '_probe_face.exr')  # scratch: never beside the shipped assets
    faces = [((1, 0, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, 1)), ((0, 1, 0), (0, 0, 1)), ((0, -1, 0), (0, 0, 1)), ((0, 0, 1), (0, -1, 0)),
             ((0, 0, -1), (0, 1, 0))]
    # per-pixel directions (camera space) and solid angles, shared by every face
    t = (np.arange(res) + 0.5) / res * 2 - 1
    X, Y = np.meshgrid(t, t)  # Y: rows from the bottom (Blender pixel order)
    L = np.sqrt(X * X + Y * Y + 1)
    dw = (2.0 / res) ** 2 / L ** 3
    out = []
    for p in points:
        sh = np.zeros((9, 3))
        for f, u in faces:
            f, u = np.array(f, float), np.array(u, float)
            zl = -f
            xl = np.cross(u, zl)
            cam.matrix_world = Matrix.Translation(p) @ Matrix(((xl[0], u[0], zl[0], 0), (xl[1], u[1], zl[1], 0), (xl[2], u[2], zl[2], 0),
                                                               (0, 0, 0, 1)))
            sc.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(tmp)
            px = np.array(img.pixels[:], dtype=np.float64).reshape(res, res, 4)[..., :3]
            bpy.data.images.remove(img)
            d = (f[None, None] + X[..., None] * xl[None, None] + Y[..., None] * u[None, None]) / L[..., None]
            x3, y3, z3 = d[..., 0], d[..., 2], -d[..., 1]  # Blender -> three axes
            basis = [np.full_like(x3, 0.282095), 0.488603 * y3, 0.488603 * z3, 0.488603 * x3, 1.092548 * x3 * y3, 1.092548 * y3 * z3,
                     0.315392 * (3 * z3 * z3 - 1), 1.092548 * x3 * z3, 0.546274 * (x3 * x3 - y3 * y3)]
            for k in range(9):
                sh[k] += ((basis[k] * dw)[..., None] * px).sum((0, 1))
        out.append({'p': [round(p.x, 3), round(p.z, 3), round(-p.y, 3)], 'sh': np.round(sh, 5).tolist()})
    if os.path.exists(tmp):
        os.remove(tmp)
    bpy.data.objects.remove(cam)
    (sc.camera, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath, sc.cycles.samples, sc.cycles.use_denoising,
     sc.view_settings.view_transform) = old
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as fh:
        json.dump({'probes': out}, fh)
    print('PROBES', path, len(out))
    return out


# --- light volumes (volumetric fog) ---------------------------------------------------------------------------------------------

def _bvh(objs):
    """One world-space BVH over the evaluated meshes of `objs` (occlusion for the light volume rays)."""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for ob in objs:
        if ob.type != 'MESH' or ob.hide_render:
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        base = len(verts)
        co = np.empty(len(me.vertices) * 3, np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3) @ np.array(mw.to_3x3()).T + np.array(mw.translation)
        verts.extend(map(tuple, co))
        me.calc_loop_triangles()
        tri = np.empty(len(me.loop_triangles) * 3, np.int64)
        me.loop_triangles.foreach_get('vertices', tri)
        polys.extend(map(tuple, (tri.reshape(-1, 3) + base).tolist()))
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, all_triangles=True), len(polys)


def sky_light(hdri, rot_z=0.0, res=(256, 128), strength=1.0):
    """Sun + sky of an equirect HDRI (Blender world mapping): the sun is the brightest blob (direction, irradiance), the sky a set of
    directions over the upper hemisphere with the mean radiance around each (for occluded sky in-scatter)."""
    img = bpy.data.images.load(hdri, check_existing=True)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[..., :3].astype(np.float64) * strength
    # downsample by box filter (rows from the bottom: v = 0 is the nadir)
    fx, fy = w // res[0], h // res[1]
    small = px[:res[1] * fy, :res[0] * fx].reshape(res[1], fy, res[0], fx, 3).mean((1, 3))
    v = (np.arange(res[1]) + 0.5) / res[1]
    u = (np.arange(res[0]) + 0.5) / res[0]
    theta = (v - 0.5) * math.pi
    phi = (u - 0.5) * 2 * math.pi - rot_z
    T, P = np.meshgrid(theta, phi, indexing='ij')
    dirs = np.stack([-np.cos(T) * np.cos(P), np.cos(T) * np.sin(P), np.sin(T)], -1)
    dw = np.cos(T) * (math.pi / res[1]) * (2 * math.pi / res[0])
    lum = small @ np.array([0.2126, 0.7152, 0.0722])
    # sun: the pixels within 4 degrees of the brightest one, if they stand well clear of the sky around them
    k = np.unravel_index(np.argmax(lum * (T > 0)), lum.shape)
    sd = dirs[k]
    near = (dirs @ sd) > math.cos(math.radians(4.0))
    sky_mean = (lum * dw)[T > 0].sum() / dw[T > 0].sum()
    sun = None
    if lum[k] > 6.0 * sky_mean:
        excess = np.clip(small - sky_mean, 0, None)
        e = (excess * (dw * near)[..., None]).sum((0, 1))
        sun = {'dir': [float(sd[0]), float(sd[2]), float(-sd[1])], 'color': [float(c) for c in e]}
    # 24 sky directions (golden spiral over the upper hemisphere) with the mean radiance in their cone
    n = 24
    sky = []
    for i in range(n):
        z = 1 - (i + 0.5) / n
        r = math.sqrt(max(0.0, 1 - z * z))
        a = i * math.pi * (3 - math.sqrt(5))
        d = np.array([r * math.cos(a), r * math.sin(a), z])
        m = ((dirs @ d) > math.cos(math.radians(30))) & ~near
        L = (small * dw[..., None])[m].sum(0) / max(dw[m].sum(), 1e-6)
        sky.append((Vector(d), L))
    return sun, sky


def _box_blur(a, r, axis):
    """Running mean of width 2r+1 along an axis (edges clamp)."""
    if r < 1:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return (hi - lo) / (2 * r + 1)


def bake_volume(objs, lights, path, cell=0.45, pad=0.5, sky=None, max_height=None, max_cells=(160, 48, 160), samples=3, seed=7,
                bounce=None):
    """Bake the light that fills the air of a section into a 3D grid, for the volumetric fog: at every cell, the light arriving from
    each of the section's fixtures (shadowed by the geometry, soft: several rays over each area light) and, outdoors, from the open
    sky (shadowed) and the sun (visibility). The fog in the game scatters this light, so beams fall from the fixtures, windows throw
    shafts and alleys are darker than the open street.
    RGB = mean radiance arriving at the cell over all directions (fixtures + sky; isotropic in-scatter), A = sun visibility. Stored
    as RGBA8 (sqrt encoded against a per-volume scale), zlib-compressed, behind a JSON header. Axes are three.js'."""
    import zlib
    rng = np.random.default_rng(seed)
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for ob in objs:
        for c in ob.bound_box:
            wc = np.array(ob.matrix_world @ Vector(c))
            lo, hi = np.minimum(lo, wc), np.maximum(hi, wc)
    lo -= pad
    hi += pad
    if max_height is not None:
        hi[2] = min(hi[2], lo[2] + max_height)
    ext = hi - lo
    dims = [max(2, min(int(math.ceil(ext[i] / cell)), max_cells[[0, 2, 1][i]])) for i in range(3)]  # blender x, y, z
    bvh, ntri = _bvh(objs)
    gx = lo[0] + (np.arange(dims[0]) + 0.5) * ext[0] / dims[0]
    gy = lo[1] + (np.arange(dims[1]) + 0.5) * ext[1] / dims[1]
    gz = lo[2] + (np.arange(dims[2]) + 0.5) * ext[2] / dims[2]
    # three layout: x fastest, then up (blender z), then three z = -blender y (so blender y descending)
    Z3, Y3, X3 = np.meshgrid(gy[::-1], gz, gx, indexing='ij')
    P = np.stack([X3.ravel(), Z3.ravel(), Y3.ravel()], -1)  # blender coordinates of each cell, in texture order
    N = len(P)
    rgb = np.zeros((N, 3))
    sunvis = np.zeros(N)
    print(f'VOLUME {path}: {dims[0]}x{dims[2]}x{dims[1]} cells, {ntri} triangles, {len(lights)} lights')
    eps = 0.02
    for mk in lights:
        d = json.loads(mk['light'])
        mw = mk.matrix_world
        lp = np.array(mw.translation)
        col = np.array(d['color'], float)
        power = float(d['power'])
        area = d['kind'] == 'area'
        nrm = np.array(mw.to_3x3() @ Vector((0, 0, -1))).astype(float)  # area lights emit along local -Z
        ax_u = np.array(mw.to_3x3() @ Vector((1, 0, 0)))
        ax_v = np.array(mw.to_3x3() @ Vector((0, 1, 0)))
        sx, sy = (d['size'] + [d['size'][0]])[:2]
        dv = lp[None] - P
        dist2 = np.maximum((dv * dv).sum(1), 0.09)
        if area:
            cos = np.clip(-(dv @ nrm) / np.sqrt(dist2), 0, 1)
            I = power / math.pi * cos            # lambertian emitter: radiant intensity
        else:
            I = np.full(N, power / (4 * math.pi))
        E = I / dist2                             # irradiance at the cell from this light
        keep = np.nonzero(E > power * 2e-4)[0]
        if not len(keep):
            continue
        vis = np.zeros(len(keep))
        for s in range(samples):
            off = (rng.random(2) - 0.5) if (area and samples > 1) else np.zeros(2)
            tgt = lp + ax_u * off[0] * sx + ax_v * off[1] * sy
            for j, i in enumerate(keep):
                p = Vector(P[i])
                dd = Vector(tgt) - p
                L = dd.length
                if L < 1e-4:
                    vis[j] += 1
                    continue
                hit = bvh.ray_cast(p, dd / L, L - eps)
                if hit[0] is None:
                    vis[j] += 1
        rgb[keep] += (E[keep] * vis / samples)[:, None] * col[None] / (4 * math.pi)
    if sky is not None:
        sun, dirs = sky
        sdir = Vector((sun['dir'][0], -sun['dir'][2], sun['dir'][1])) if sun else None
        upmean = np.mean([L for _, L in dirs], 0)
        for i in range(N):
            p = Vector(P[i])
            acc = np.zeros(3)
            for dvec, L in dirs:
                if bvh.ray_cast(p, dvec, 120.0)[0] is None:
                    acc += L
            # half the sphere is open sky (if unoccluded); the lower half sees the ground lit at ~20% of the sky
            frac = acc / len(dirs)
            rgb[i] += 0.5 * frac + 0.5 * 0.2 * frac.mean() / max(upmean.mean(), 1e-6) * upmean
            if sdir is not None:
                sunvis[i] = 1.0 if bvh.ray_cast(p, sdir, 400.0)[0] is None else 0.0
    # diffuse bounce: the fixtures' light comes back off the walls, floor and ceiling and fills the whole room (the lightmaps have it;
    # direct light alone left everything lit from the volume, plants and the fog's in-scatter, several times darker than the walls
    # beside them). Approximated as a wide spatial blur of the direct field (~2 m, three box passes ~ a gaussian) times the light
    # a typical room sends back (reflectance ~0.4 over most of the sphere, a couple of bounces): ~1.6 indoors; outdoors most of the
    # sphere is open sky, ~0.35.
    k = (0.35 if sky is not None else 1.6) if bounce is None else bounce
    if k > 0:
        g3 = rgb.reshape(dims[1], dims[2], dims[0], 3)
        r = max(1, int(round(0.9 / (ext.mean() / np.mean(dims)))))
        b3 = g3.copy()
        for _ in range(3):
            for ax in (0, 1, 2):
                b3 = _box_blur(b3, r, ax)
        rgb = (g3 + k * b3).reshape(-1, 3)
    scale = float(np.percentile(rgb.max(1), 99.7)) or 1.0
    enc = np.empty((N, 4), np.uint8)
    enc[:, :3] = np.round(np.sqrt(np.clip(rgb / scale, 0, 1)) * 255)
    enc[:, 3] = np.round(sunvis * 255)
    # three-space box: x, up, z = -blender y
    head = {'dims': [dims[0], dims[2], dims[1]], 'min': [float(lo[0]), float(lo[2]), float(-hi[1])],
            'max': [float(hi[0]), float(hi[2]), float(-lo[1])], 'scale': scale,
            'sun': sky[0] if sky else None}
    hb = json.dumps(head).encode()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(b'FTV1')
        fh.write(len(hb).to_bytes(4, 'little'))
        fh.write(hb)
        fh.write(zlib.compress(enc.tobytes(), 9))
    print('VOLUME', path, os.path.getsize(path) // 1024, 'KB', 'scale', round(scale, 4))
    return head


def bake_volumes(built, keys, chapter, hdri=None, skip=(), sky_strength=1.0, skies=None):
    """`--volume` for a level script: the light volume of every section (outdoors when it has a sky marker); sections with Timeline
    Shift geometry get one volume per reality (`_vol.bin` for a, `_vol_b.bin` for b)."""
    sky = None
    for key in keys:
        if key in skip:
            continue
        S = built[key]
        outdoors = any(m.get('marker') == 'sky' for m in S.markers)
        if outdoors and sky is None and hdri:
            sky = sky_light(hdri, strength=sky_strength)
            print('SKY', 'sun', sky[0])
        for tl in ([None] if not (S.static_a or S.static_b) else ['a', 'b']):
            objs = S.static + (getattr(S, f'static_{tl}') if tl else [])
            fol = getattr(S, 'foliage_objs', {})
            objs = objs + fol.get(None, []) + (fol.get(tl, []) if tl else [])  # canopies shade the air: shafts between trees
            lights = [m for m in S.lights if m.get('timeline') in (None, tl)]
            if outdoors and skies and key in skies and tl in skies[key]:
                sky = sky_light(skies[key][tl][0], strength=skies[key][tl][1])  # this reality's own sky
            rel = f'environments/{chapter}/{key}_vol{"_b" if tl == "b" else ""}.bin'
            bake_volume(objs, lights, os.path.join(PUB, rel), sky=sky if outdoors else None,
                        cell=0.6 if outdoors else 0.4, max_height=36.0 if outdoors else None)


def export_timeline_section(S, key, out_dir, prefix, samples, lm_size=2048, skies=None):
    """Export a section that has Timeline Shift geometry. Each reality is lit by its own fixtures and shadowed by its own dressing:
    each timeline's mesh bakes in its own reality; the shared structure (walls, ceiling, columns) bakes twice, once per reality, and the
    game swaps its lightmap on every shift."""
    parts = []
    for tl, objs in ((None, S.static), ('a', S.static_a), ('b', S.static_b)):
        if not objs:
            continue
        st = join(objs, f'{prefix}_{key}_static' + (f'_{tl}' if tl else ''))
        if tl:
            st['timeline'] = tl
        finish_static(st)
        parts.append((tl, st))
    # far scenery of one reality (a skyline): its own mesh and its own smaller lightmap, so its huge facades do not take the
    # texels of the floor Ethan walks on (lightmap UVs pack at uniform density)
    far = {}
    for tl, objs in sorted(getattr(S, 'far', {}).items()):
        if objs:
            st = join(objs, f'{prefix}_{key}_far_{tl}')
            st['timeline'] = tl
            finish_static(st)
            far[st.name] = tl
            parts.append((tl, st))
    copy_textures()
    rel = os.path.relpath(out_dir, PUB)

    def state(tl):
        for t2 in ('a', 'b'):
            hide = t2 != tl
            for t3, st3 in parts:
                if t3 == t2:
                    st3.hide_render = hide
            for o in timeline_lights(t2) + getattr(S, 'foliage_objs', {}).get(t2, []):
                o.hide_render = hide
        if skies and tl in skies:
            sky_world(*skies[tl])  # a section whose two realities have different skies (Chapter 4's terrace)
    two = bool(S.static_a or S.static_b or any(m.get('timeline') for m in getattr(S, 'lights', [])) or (skies and len(skies) > 1))
    for tl, st in parts:
        for real in ([tl] if tl else (['a', 'b'] if two else ['a'])):
            state(real)
            # the shared structure's second bake has its own name: as '_b' it collided with the timeline-b dressing's map, which
            # baked after it and overwrote it (the shared walls and floors in reality b sampled another mesh's lightmap)
            suffix = ('_far_' + tl) if st.name in far else ('_' + tl) if tl else ('' if real == 'a' else '_shared_b')
            lm_rel = f'{rel}/{key}{suffix}_lm.hdr'
            bake_lightmap(st, os.path.join(PUB, lm_rel), size=lm_size // 2 if st.name in far else lm_size, samples=samples)
            st['lightmap' if real == 'a' or tl else 'lightmap_b'] = lm_rel
    state(None)
    for _, st in parts:
        st.hide_render = False
    for t2 in ('a', 'b'):
        for o in timeline_lights(t2) + getattr(S, 'foliage_objs', {}).get(t2, []):
            o.hide_render = False
    return [st for _, st in parts]


def copy_textures():
    """1k JPEG copies of every PBR set in use (the engine loads them by recipe)."""
    texroot = os.path.join(PUB, 'textures', 'pbr')
    used = {json.loads(m['ft'])['tex'] for m in bpy.data.materials if 'ft' in m and json.loads(m['ft']).get('type') == 'pbr'}
    for tid in used:
        for kind in ('diff', 'nor_gl', 'rough', 'ao', 'emit', 'disp'):
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

def water_mat(key, tint=(0.36, 0.6, 0.58), dist=1.2, waves=0.4, scale=1.0, flow=1.0):
    """Water: a transmissive Principled in the bake (it lets light through to the bed); the game rebuilds it as the water medium
    (refraction, depth absorption, waves, foam: src/rendering/water.ts)."""
    if key not in MATS:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*tint, 1)
        b.inputs['Roughness'].default_value = 0.03
        b.inputs['IOR'].default_value = 1.333
        b.inputs['Transmission Weight'].default_value = 1.0
        m['ft'] = json.dumps({'type': 'water', 'tint': list(tint), 'dist': dist, 'waves': waves, 'scale': scale, 'flow': flow})
        MATS[key] = m
    return MATS[key]


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
    if 'floor_band' in M and floor_mat != 'floor_band':
        # an anti-skid perimeter band along the walls (where the wear and the cables are)
        for (bx, by, sx_, sy_) in ((cx, y0 - 0.45, W, 0.9), (cx, y1 + 0.45, W, 0.9), (x0 + 0.45, cy, 0.9, L - 1.8), (x1 - 0.45, cy, 0.9, L - 1.8)):
            S.add(box(f'{name}_band{bx:.1f}_{by:.1f}', (sx_, sy_, 0.012), (bx, by, 0.006), M['floor_band'], bevel=0.0))
    if ceiling:
        S.add(box(f'{name}_ceil', (W + 0.3, L + 0.3, 0.3), (cx, cy, H + 0.15), M['ceiling'], bevel=0.0))
        if 'ceil_panel' in M:
            # suspended ceiling panels in a grid with dark reveals between them
            nx, ny = max(1, int(W / 1.5)), max(1, int(L / 1.5))
            for i in range(nx):
                for j in range(ny):
                    S.add(box(f'{name}_cp{i}_{j}', (W / nx - 0.08, L / ny - 0.08, 0.04), (x0 + (i + 0.5) * W / nx, y1 + (j + 0.5) * L / ny, H - 0.02),
                              M['ceil_panel'], bevel=0.006))
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
    if ceiling:
        # the roof as a collider too: the rain's shelter map and the camera's collision rays both stop at it (rain fell inside the
        # lift house on the surface deck)
        o = box(f'col_{name}_ceil', (W, L, 0.3), (cx, cy, H + 0.15), None, bevel=0.0)
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


def collide_box(S, name, size, loc, timeline=None):
    o = box(f'col_{name}', size, loc, None, bevel=0.0)
    o['collision'] = True
    o.hide_render = True
    if timeline:
        o['timeline'] = timeline
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


# --- foliage and props (Poly Haven, converted by blender/props/foliage.py) ----------------------------------------------------

FOLIAGE_DIR = os.path.join(PUB, 'props', 'foliage')
_FOLIAGE = {}
_PROPS = {}


def _bake_material(m):
    """A foliage recipe material made real for Cycles (its texture, alpha-cut), so the bake sees leaves, not solid cards."""
    if m is None or 'ft' not in m or m.get('_baked'):
        return
    r = json.loads(m['ft'])
    path = os.path.join(PUB, r.get('tex', ''))
    if not os.path.exists(path):
        return
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(path, check_existing=True)
    nt.links.new(img.outputs['Color'], b.inputs['Base Color'])
    if r.get('alpha'):
        img.image.alpha_mode = 'STRAIGHT'
        nt.links.new(img.outputs['Alpha'], b.inputs['Alpha'])
    m['_baked'] = 1


def foliage_asset(name):
    """The converted asset's meshes, imported once and kept out of the scene (instances link their data)."""
    if name not in _FOLIAGE:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(FOLIAGE_DIR, f'{name}.glb'))
        objs = [o for o in bpy.data.objects if o not in before]
        meshes = []
        for o in objs:
            if o.type == 'MESH':
                for sl in o.material_slots:
                    _bake_material(sl.material)
                meshes.append((o.data, o.matrix_world.copy()))
        for o in objs:
            bpy.data.objects.remove(o)
        _FOLIAGE[name] = meshes
    return _FOLIAGE[name]


def plant(S, name, loc, yaw=0.0, scale=1.0, timeline=None):
    """One plant: recorded for the game (instanced at runtime, lit by the light volume, swaying) and linked into the bake scene
    (its shadow and occlusion land in the lightmap and the light volume). Not part of the exported static mesh."""
    if not hasattr(S, 'foliage'):
        S.foliage = {}
        S.foliage_objs = {}
    S.foliage.setdefault((timeline or '', name), []).append((tuple(loc), float(yaw), float(scale)))
    for data, mw in foliage_asset(name):
        o = bpy.data.objects.new(f'{name}_p', data)
        bpy.context.scene.collection.objects.link(o)
        o.matrix_world = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Scale(scale, 4) @ mw
        S.foliage_objs.setdefault(timeline, []).append(o)


def ground_z(x, y, z_top=60.0, objs=None):
    """Height of the first surface below (x, y, z_top), or None."""
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, nrm, _i, ob, _m = bpy.context.scene.ray_cast(dg, Vector((x, y, z_top)), Vector((0, 0, -1)), distance=200.0)
    if not hit or (objs is not None and ob not in objs) or nrm.z < 0.6:
        return None
    return loc.z


def _noise2(x, y, scale, seed):
    """Value noise in [-1, 1] (integer hash lattice), as in the card-grass skill: patches, not an even carpet."""
    def h(ix, iy):
        n = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
        n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0
    gx, gy = x / scale, y / scale
    ix, iy = math.floor(gx), math.floor(gy)
    fx, fy = gx - ix, gy - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * sx
    b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * sx
    return (a + (b - a) * sy) * 2 - 1


def scatter(S, kinds, x0, x1, y0, y1, spacing=1.2, seed=1, density=0.6, scale=(0.8, 1.2), timeline=None, accept=None, z_top=60.0):
    """Ground cover over a rectangle: a jittered grid (each cell jittered over its whole extent, fixed random yaw), thinned by
    two octaves of noise so it grows in patches; `kinds` = [(asset, weight)]; the ground is found by ray casting."""
    import random as _r
    rng = _r.Random(seed)
    names = [k for k, _ in kinds]
    weights = [w for _, w in kinds]
    xs = int((x1 - x0) / spacing)
    ys = int((y1 - y0) / spacing)
    placed = 0
    for i in range(xs):
        for j in range(ys):
            x = x0 + (i + rng.random()) * spacing
            y = y0 + (j + rng.random()) * spacing
            keep = density + 0.45 * _noise2(x, y, 9.0, seed) + 0.3 * _noise2(x, y, 2.6, seed + 1)
            if rng.random() > keep:
                continue
            z = ground_z(x, y, z_top)
            if z is None or (accept and not accept(x, y, z)):
                continue
            plant(S, rng.choices(names, weights)[0], (x, y, z), rng.uniform(0, math.tau), rng.uniform(*scale), timeline)
            placed += 1
    return placed


def write_foliage(S, path):
    """The section's plants for the game: {timeline: {asset: [[x, y, z, yaw, scale], ...]}} in three.js space."""
    out = {}
    for (tl, name), lst in getattr(S, 'foliage', {}).items():
        out.setdefault(tl, {})[name] = [[round(l[0], 3), round(l[2], 3), round(-l[1], 3), round(yaw, 3), round(s, 3)] for l, yaw, s in lst]
    if out:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as fh:
            json.dump(out, fh)
        print('FOLIAGE', path, sum(len(v) for d in out.values() for v in d.values()))


def prop(S, asset, loc, yaw=0.0, scale=1.0, node=None, timeline=None, budget=12000, collide=True, rot=None):
    """A static prop from a Poly Haven model (rocks, stumps, roots, logs, street furniture): imported once (decimated to `budget`
    triangles, its maps copied as a 'pbr' set the engine rebuilds), then copied into the section's static mesh (baked like
    everything else). Models that ship variants side by side (clean / aged / rusted) pick theirs with `node`: an object name
    (exact match first, else every object containing it) or a predicate on the name. `rot` (a 4x4 Matrix) tips the prop over
    after the yaw."""
    key = (asset, node if not callable(node) else node.__name__ + str(id(node)))
    if key not in _PROPS:
        before = set(bpy.data.objects)
        base = os.path.join(ROOT, 'vendor', 'polyhaven', 'models', asset)
        path = next((os.path.join(base, f'{asset}_{r}.gltf') for r in ('2k', '1k', '4k') if os.path.exists(os.path.join(base, f'{asset}_{r}.gltf'))),
                    os.path.join(base, f'{asset}_2k.gltf'))
        bpy.ops.import_scene.gltf(filepath=path)
        objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        if node is not None:
            if callable(node):
                keep = [o for o in objs if node(o.name)] or objs[:1]
            else:
                keep = [o for o in objs if o.name == node] or [o for o in objs if node in o.name] or objs[:1]
            for o in objs:
                if o not in keep:
                    bpy.data.objects.remove(o)
            objs = keep
        for o in objs:
            ntri = sum(len(p.vertices) - 2 for p in o.data.polygons)
            if ntri > budget:
                d = o.modifiers.new('dec', 'DECIMATE')
                d.ratio = budget / ntri
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier='dec')
            for sl in o.material_slots:
                sl.material = _prop_material(asset, sl.material)
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        t = objs[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if node is not None:
            # a variant picked out of a side-by-side sheet: centre it on its own footprint (its base stays where it was)
            co = np.empty(len(t.data.vertices) * 3)
            t.data.vertices.foreach_get('co', co)
            co = co.reshape(-1, 3)
            off = np.array([(co[:, 0].min() + co[:, 0].max()) / 2, (co[:, 1].min() + co[:, 1].max()) / 2, 0.0])
            t.data.vertices.foreach_set('co', (co - off).ravel())
            t.data.update()
        t.hide_render = True
        for c in list(t.users_collection):
            c.objects.unlink(t)
        _PROPS[key] = t
    t = _PROPS[key]
    o = t.copy()
    o.data = t.data.copy()
    bpy.context.scene.collection.objects.link(o)
    o.hide_render = False
    o.matrix_world = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(yaw, 4, 'Z') @ (rot if rot is not None else Matrix.Identity(4)) \
        @ Matrix.Scale(scale, 4)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    S.add(o, timeline=timeline)
    if collide:
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        collide_box(S, f'{o.name}_col', tuple((hi - lo) * 0.85), tuple((hi + lo) / 2), timeline=timeline)
    return o


def _prop_material(asset, src):
    """A Poly Haven model's material as a 'pbr' recipe on its own UVs (tile 1), its maps copied into textures/pbr/<id>/."""
    name = src.name if src else asset
    tid = name.split('.')[0]
    if tid in MATS:
        return MATS[tid]
    texdir = os.path.join(ROOT, 'vendor', 'polyhaven', 'models', asset, 'textures')
    dst = os.path.join(PUB, 'textures', 'pbr', tid)
    os.makedirs(dst, exist_ok=True)
    found = False
    for f in os.listdir(texdir):
        if not f.startswith(tid + '_'):
            continue
        kind = f[len(tid) + 1:].rsplit('_', 1)[0]
        if kind in ('diff', 'nor_gl', 'rough', 'arm'):
            img = bpy.data.images.load(os.path.join(texdir, f))
            img.scale(1024, 1024)
            if kind == 'arm':
                # ambient occlusion (R) and roughness (G) as their own maps (the engine's pbr recipe reads _ao / _rough)
                px = np.array(img.pixels[:], np.float32).reshape(-1, 4)
                for ch, nm in ((0, 'ao'), (1, 'rough')):
                    im2 = bpy.data.images.new(f'{tid}_{nm}', 1024, 1024)
                    q = np.repeat(px[:, ch:ch + 1], 3, 1)
                    im2.pixels.foreach_set(np.concatenate([q, np.ones((len(q), 1), np.float32)], 1).ravel())
                    im2.filepath_raw = os.path.join(dst, f'{tid}_{nm}.jpg')
                    im2.file_format = 'JPEG'
                    im2.save()
                    bpy.data.images.remove(im2)
            else:
                img.filepath_raw = os.path.join(dst, f'{tid}_{kind}.jpg')
                img.file_format = 'JPEG'
                img.save()
            bpy.data.images.remove(img)
            found = True
    m = src if src is not None else bpy.data.materials.new(tid)
    m['ft'] = json.dumps({'type': 'pbr', 'tex': tid, 'res': '1k', 'tile': 1.0, 'tint': [1, 1, 1], 'desat': None, 'rough_mul': 1.0,
                          'rough_add': 0.0, 'normal': 1.0, 'metal': 0.0, 'coat': 0.0, 'own': True})
    MATS[tid] = m
    return m
