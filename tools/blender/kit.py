"""
Environment kit: cottages, trees, fences and small props, built procedurally so every instance can
vary a little like a hand-drawn village. All builders put their object's origin on the ground,
facing -Y, and return a list of objects (tagged with ob['col'] = 0 for things Ada walks through).
"""
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

import lib
import sdf
from sdf import V, box as sbox, cone, cylinder, ellipsoid, intersect, subtract, torus, tube, union

PAL = {
    'plaster': '#EDE3CF', 'plaster2': '#E6D3B3', 'timber': '#5E4632', 'stone': '#B9B2A6', 'stone_dark': '#8F877B',
    'roof_red': '#B5523B', 'roof_slate': '#6E7F8F', 'roof_thatch': '#C9A66B', 'door_green': '#4E7A4A',
    'door_blue': '#3D6B8C', 'door_red': '#9C3D32', 'glass': '#48566A', 'wood': '#9A7550', 'wood_dark': '#6B4D33',
    'bark': '#7A5A3C', 'leaf1': '#6E9E4F', 'leaf2': '#5F8F48', 'leaf3': '#86B05E', 'leaf4': '#4F7E43',
    'flower_red': '#D0503C', 'flower_pink': '#E07A9A', 'flower_yellow': '#E8C440', 'flower_white': '#F2EEE6',
    'iron': '#3A3A40', 'lamp': '#F6D27A', 'paper': '#F4EEDC', 'rope': '#B59A6A', 'moss': '#7C9A55',
}


def M(name):
    return lib.mat('kit_' + name, PAL[name])


def hand_made(bm, size, seed, amount=1.0):
    """Nothing in a drawn village is quite true: nudge every vertex a little (more on bigger pieces),
    smoothly, so faces stay faces but edges lean and sag."""
    k = min(0.022, 0.006 * max(size)) * amount
    off = Vector((seed * 1.37, seed * 2.11, seed * 0.73))
    for v in bm.verts:
        q = v.co * (1.3 / max(0.3, max(size))) + off
        v.co += Vector((noise.noise(q), noise.noise(q + Vector((5.2, 1.3, 2.8))), noise.noise(q + Vector((1.7, 9.2, 4.4))))) * k


def soften(ob, angle=50.0):
    """Shade smooth across rounded edges, keep real corners crisp."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    lim = math.radians(angle)
    for e in bm.edges:
        e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    return ob


_box_n = [0]


def box(name, size, loc, mat, rot=None, bevel=None, wobble=1.0):
    """A hand-made block: its edges rounded (bevel = radius; None: in proportion to its size; 0: sharp),
    leaning very slightly out of true, shaded smooth over the rounding and crisp at the corners."""
    m = min(size)
    r = min(0.045, m * 0.2) if bevel is None else min(bevel * 1.4, m * 0.45)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if r > 0.003:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=r, offset_type='OFFSET', segments=2 if m > 0.16 else 1, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    _box_n[0] += 1
    if wobble:
        hand_made(bm, size, _box_n[0] * 0.37 + sum(loc) * 0.11, wobble)
    if rot is not None:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return soften(lib.obj_from_bm(name, bm, mat, smooth=True))


def transform(objs, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
    m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Scale(scale, 4)
    for o in objs:
        o.data.transform(m)
        o.data.update()
    return objs


def nocol(objs):
    for o in objs:
        o['col'] = 0
    return objs


def merge(objs, name):
    for o in objs:
        lib.apply_modifiers(o)
    col = all(o.get('col', 1) for o in objs)
    ob = lib.join(objs, name)
    if not col:
        ob['col'] = 0
    return ob


# --- cottage ---------------------------------------------------------------------------------

def sculpt(name, f, lo, hi, step, mat, tris, sharp=50.0):
    """A sculpted (sdf.py) piece of scenery, shaded smooth with crisp creases."""
    ob = sdf.sculpt(name, f, lo, hi, step, mat, tris)
    return soften(ob, sharp)


def roof_field(w, d, top, pitch, over, side, kind, seed):
    """A thick, soft roof: the ridge sags a little in the middle, the eaves kick up, rounded edges all
    round; clay tiles in scalloped courses, slates in uneven courses, or a deep lumpy thatch."""
    t = math.tan(pitch)
    cp = math.cos(pitch)
    half_y, half_x = d / 2 + over, w / 2 + side
    # small roofs (a well, a notice board) get gentler sag and finer tiles
    sc = min(1.0, half_x / 2.6)
    T = (0.36 if kind == 'roof_thatch' else 0.16) * (0.5 + 0.5 * sc)
    course = 0.36 * (0.55 + 0.45 * sc)

    def f(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ay = np.abs(y)
        zr = top + (d / 2 - ay) * t
        # the ridge sags and the eaves lift a touch: nothing hand-built is straight
        zr = zr - 0.1 * sc * (1 - (x / half_x) ** 2) * (1 - ay / half_y) + 0.06 * sc * sdf.smooth01(d / 2 - 0.2 * sc, half_y, ay)
        s = (half_y - ay) / cp
        if kind == 'roof_thatch':
            q = P * 2.2 + seed
            zr = zr + 0.05 * (sdf.noise(P, 2.5, seed) - 0.5) + 0.025 * (sdf.noise(q, 4.0, seed + 1) - 0.5)
        else:
            u = s / course
            lip = (1.0 - (u - np.floor(u))) ** 1.5
            zr = zr + 0.032 * lip * (0.5 + 0.5 * sc)
            if kind == 'roof_red':
                stagger = np.floor(u) * 0.11
                zr = zr + 0.014 * (0.5 + 0.5 * sc) * np.abs(np.sin(np.pi * (x + stagger) / 0.22))
            else:
                zr = zr + 0.012 * (sdf.noise(np.stack([x * 4, np.floor(u), y * 0 + seed], 1), 1.0, seed) - 0.5) * 2
        upper = (z - zr) * cp
        lower = (zr - T - z) * cp
        return np.maximum(np.maximum(upper, lower), np.maximum(ay - half_y, np.abs(x) - half_x))
    return intersect(f, lambda P: np.abs(P[:, 0]) - half_x, k=0.06)


def cottage(seed, w=4.6, d=4.0, h=2.6, roof='roof_red', door='door_green', wall='plaster', stories=1):
    rnd = random.Random(seed)
    parts = []
    plinth = 0.35
    H = h * stories
    top = plinth + H
    pitch = math.radians(rnd.uniform(38, 48))
    over, side = 0.42, 0.34
    t = math.tan(pitch)
    apex = top + (d / 2) * t
    # walls: thick plaster, wider at the foot, the gables under the roof part of them
    dx = rnd.choice([-0.8, 0.0, 0.8]) * (w / 4.6)
    windows = [(wx, -d / 2) for wx in (-w / 2 + 1.0, w / 2 - 1.0) if abs(wx - dx) > 1.2]
    sides = [sx for sx in (-1, 1) if rnd.random() < 0.8]
    side_y = {sx: rnd.uniform(-0.6, 0.6) for sx in sides}

    def taper(P):
        Q = P.copy()
        k = 1.0 + 0.03 * sdf.smooth01(top, plinth, P[:, 2])
        Q[:, 0] /= k
        Q[:, 1] /= k
        return Q
    walls = sdf.warp(sbox((0, 0, plinth + H / 2 + 0.05), (w / 2, d / 2, H / 2 + 0.05), 0.09), taper)
    gable = intersect(lambda P: np.abs(P[:, 0]) - (w / 2 - 0.02), lambda P: P[:, 2] - (top + (d / 2 - np.abs(P[:, 1])) * t - 0.3),
                      lambda P: top - 0.2 - P[:, 2])
    walls = union(walls, gable, k=0.05)
    # doors and windows are set into the thickness of the wall
    door_f = union(sbox((dx, -d / 2, plinth + 0.82), (0.52, 0.14, 0.82), 0.03), cylinder((dx, -d / 2, plinth + 1.64), 0.52, 0.14, 0.03, sdf.rot(90, 0, 0)), k=0.02)
    walls = subtract(walls, door_f, k=0.03)
    wz = plinth + h * 0.55
    holes = [sbox((wx, wy, wz), (0.44, 0.12, 0.46), 0.03) for wx, wy in windows]
    holes += [sbox((sx * w / 2, side_y[sx], wz), (0.12, 0.44, 0.46), 0.03) for sx in sides]
    for st in range(1, stories):
        holes += [sbox((wx, -d / 2, plinth + h * st + h * 0.55), (0.44, 0.12, 0.46), 0.03) for wx in (-w / 4, w / 4)]
    walls = subtract(walls, union(*holes), k=0.02)
    lo, hi = (-w / 2 - 0.4, -d / 2 - 0.4, plinth - 0.1), (w / 2 + 0.4, d / 2 + 0.4, apex + 0.2)
    parts.append(sculpt('walls', walls, lo, hi, 0.035, M(wall), 1600))
    # a stone plinth, the stones bulging a little
    st = sdf.displace(sbox((0, 0, plinth / 2), (w / 2 + 0.1, d / 2 + 0.1, plinth / 2), 0.07),
                      lambda P: 0.025 * (sdf.noise(P, 3.2, seed) - 0.5) + 0.02 * np.abs(np.sin(P[:, 2] * 18)))
    parts.append(sculpt('plinth', st, (-w / 2 - 0.3, -d / 2 - 0.3, -0.1), (w / 2 + 0.3, d / 2 + 0.3, plinth + 0.15), 0.035, M('stone'), 600))
    # the roof, and a rolled ridge along its top
    rf = roof_field(w, d, top, pitch, over, side, roof, seed)
    ridge_z = apex - 0.1
    ridge = tube([(-w / 2 - side - 0.02, 0, ridge_z + 0.02), (0, 0, ridge_z - 0.06), (w / 2 + side + 0.02, 0, ridge_z + 0.02)],
                 [0.13 if roof == 'roof_thatch' else 0.1] * 3)
    rf = union(rf, ridge, k=0.05)
    rlo = (-w / 2 - side - 0.3, -d / 2 - over - 0.3, top - over * t - 0.6)
    rhi = (w / 2 + side + 0.3, d / 2 + over + 0.3, apex + 0.4)
    parts.append(sculpt('roof', rf, rlo, rhi, 0.04, M(roof), 2600, sharp=70.0))
    # timber frame on the front and back faces, and corner posts
    tm = M('timber')
    for y in (-d / 2 - 0.04, d / 2 + 0.04):
        parts.append(box('beam', (w + 0.1, 0.1, 0.15), (0, y, plinth + 0.075), tm))
        parts.append(box('beam', (w + 0.1, 0.1, 0.15), (0, y, top - 0.075), tm))
        if stories > 1:
            parts.append(box('beam', (w + 0.1, 0.1, 0.15), (0, y, plinth + h), tm))
    for x in (-w / 2 - 0.02, w / 2 + 0.02):
        for y in (-d / 2 - 0.02, d / 2 + 0.02):
            parts.append(box('post', (0.18, 0.18, H), (x, y, plinth + H / 2), tm))
    # the door: planks under a round arch, iron hinges and a ring pull, a worn step
    fy = -d / 2
    door_s = intersect(union(sbox((dx, fy + 0.07, plinth + 0.8), (0.48, 0.035, 0.8), 0.01), cylinder((dx, fy + 0.07, plinth + 1.6), 0.48, 0.035, 0.01, sdf.rot(90, 0, 0)), k=0.01),
                       lambda P: plinth + 0.01 - P[:, 2])
    door_s = subtract(door_s, lambda P: np.maximum(np.abs(((P[:, 0] - dx + 0.6) % 0.24) - 0.12) - 0.008, P[:, 1] - (fy + 0.045)), k=0.004)
    parts.append(sculpt('door', door_s, (dx - 0.7, fy - 0.2, plinth - 0.1), (dx + 0.7, fy + 0.3, plinth + 2.3), 0.012, M(door), 500))
    arch = subtract(union(sbox((dx, fy - 0.01, plinth + 0.82), (0.62, 0.06, 0.82), 0.03), cylinder((dx, fy - 0.01, plinth + 1.64), 0.62, 0.06, 0.03, sdf.rot(90, 0, 0)), k=0.02),
                    union(sbox((dx, fy - 0.01, plinth + 0.8), (0.5, 0.2, 0.84), 0.0), cylinder((dx, fy - 0.01, plinth + 1.64), 0.5, 0.2, 0.0, sdf.rot(90, 0, 0)), k=0.0), k=0.015)
    arch = intersect(arch, lambda P: plinth + 0.02 - P[:, 2])
    parts.append(sculpt('doorframe', arch, (dx - 0.9, fy - 0.2, plinth - 0.1), (dx + 0.9, fy + 0.2, plinth + 2.4), 0.014, tm, 400))
    for hz in (plinth + 0.45, plinth + 1.3):
        parts.append(box('hinge', (0.42, 0.03, 0.06), (dx - 0.2, fy + 0.025, hz), M('iron')))
    parts.append(lib.tube('ring', [(dx + 0.3, fy + 0.02, plinth + 1.02), (dx + 0.32, fy + 0.0, plinth + 0.95), (dx + 0.3, fy + 0.02, plinth + 0.9)],
                          [0.012] * 3, M('iron'), sides=6, subsurf=0))
    step = sdf.displace(sbox((dx, -d / 2 - 0.34, plinth * 0.3), (0.7, 0.3, plinth * 0.3), 0.06), lambda P: 0.015 * (sdf.noise(P, 4.0, seed + 3) - 0.5))
    parts.append(sculpt('step', step, (dx - 1.0, -d / 2 - 0.8, -0.1), (dx + 1.0, -d / 2 + 0.1, plinth), 0.03, M('stone_dark'), 300))

    # windows: glass set back in the wall, a frame, mullions, a sill, shutters and sometimes flowers
    def window(cx, cy, cz, facing):
        r = Matrix.Rotation(facing, 3, 'Z')
        out = []

        def at(v):
            return r @ Vector(v) + Vector((cx, cy, cz))

        def b(name, size, off, mat):
            out.append(box(name, size, at(off), mat, rot=r))
        b('glass', (0.86, 0.04, 0.9), (0, 0.06, 0), M('glass'))
        b('wframe', (1.02, 0.12, 0.11), (0, -0.04, 0.5), tm)
        b('wframe', (1.02, 0.12, 0.11), (0, -0.04, -0.5), tm)
        b('wframe', (0.11, 0.12, 1.0), (-0.49, -0.04, 0), tm)
        b('wframe', (0.11, 0.12, 1.0), (0.49, -0.04, 0), tm)
        b('mullion', (0.05, 0.08, 0.9), (0, 0.02, 0), tm)
        b('mullion', (0.86, 0.08, 0.05), (0, 0.02, 0.05), tm)
        b('sill', (1.16, 0.24, 0.08), (0, -0.12, -0.55), M('wood'))
        for sx in (-1, 1):
            b('shutter', (0.42, 0.05, 0.98), (sx * 0.76, -0.07, 0), M(door))
            for zz in (-0.3, 0.0, 0.3):
                b('shutter_slat', (0.34, 0.03, 0.05), (sx * 0.76, -0.1, zz), M(door))
        if rnd.random() < 0.75:
            b('flowerbox', (1.0, 0.26, 0.22), (0, -0.24, -0.68), M('wood_dark'))
            fl = rnd.choice(['flower_red', 'flower_pink', 'flower_yellow', 'flower_white'])
            leaves = []
            blooms = []
            for k in range(7):
                p = at((-0.42 + k * 0.14, -0.24 + rnd.uniform(-0.04, 0.04), -0.52 + rnd.uniform(0, 0.05)))
                leaves.append(ellipsoid(p - Vector((0, 0, 0.03)), (0.08, 0.07, 0.06)))
                if k % 2 == 0 or rnd.random() < 0.4:
                    blooms.append(ellipsoid(p + Vector((rnd.uniform(-0.03, 0.03), 0, 0.03)), (0.045, 0.045, 0.035)))
            c = at((0, -0.24, -0.52))
            out.append(sculpt('leaves', sdf.displace(union(*leaves, k=0.04), lambda P: 0.012 * (sdf.noise(P, 30.0, seed) - 0.5)),
                              c - Vector((0.7, 0.7, 0.3)), c + Vector((0.7, 0.7, 0.3)), 0.012, M('leaf3'), 180))
            out.append(sculpt('flowers', union(*blooms, k=0.01), c - Vector((0.7, 0.7, 0.3)), c + Vector((0.7, 0.7, 0.3)), 0.01, M(fl), 160))
        return nocol(out)
    for wx, wy in windows:
        parts += window(wx, wy - 0.02, wz, 0)
    for sx in sides:
        parts += window(sx * (w / 2 + 0.02), side_y[sx], wz, sx * math.pi / 2)
    for st in range(1, stories):
        for wx in (-w / 4, w / 4):
            parts += window(wx, -d / 2 - 0.02, plinth + h * st + h * 0.55, 0)
    # a chimney of stacked stone, leaning a little, with a pot on top
    cx = rnd.choice([-1, 1]) * (w / 2 - 0.7)
    cy = rnd.uniform(-0.3, 0.6)
    ch = apex + 0.55
    lean = rnd.uniform(-0.04, 0.04)

    def ch_warp(P):
        Q = P.copy()
        Q[:, 0] -= lean * (P[:, 2] - top)
        k = 1.0 + 0.08 * sdf.smooth01(ch, top, P[:, 2])
        Q[:, 0] = cx + (Q[:, 0] - cx) / k
        Q[:, 1] = cy + (Q[:, 1] - cy) / k
        return Q
    chim = sdf.warp(sbox((cx, cy, (ch + top) / 2), (0.28, 0.28, (ch - top) / 2), 0.05), ch_warp)
    chim = sdf.displace(chim, lambda P: 0.015 * np.abs(np.sin(P[:, 2] * 16 + 0.5 * np.sin(P[:, 0] * 9))) + 0.01 * (sdf.noise(P, 6.0, seed) - 0.5))
    capz = ch + 0.06
    chim = union(chim, sdf.warp(sbox((cx, cy, capz), (0.35, 0.35, 0.06), 0.04), ch_warp), k=0.02)
    pot = subtract(cone((cx + lean * (capz - top), cy, capz), (cx + lean * (capz + 0.3 - top), cy, capz + 0.3), 0.12, 0.09),
                   cylinder((cx + lean * (capz + 0.3 - top), cy, capz + 0.3), 0.065, 0.12, 0.0), k=0.01)
    parts.append(sculpt('chimney', chim, (cx - 0.6, cy - 0.6, top - 0.2), (cx + 0.6, cy + 0.6, ch + 0.3), 0.03, M('stone'), 500))
    parts.append(sculpt('chimney_pot', pot, (cx - 0.4, cy - 0.4, capz - 0.1), (cx + 0.4, cy + 0.4, capz + 0.45), 0.012, M('roof_red'), 300))
    return parts


# --- trees ---------------------------------------------------------------------------------

def blob(name, center, radius, mat, seed, flat=0.75, lumps=0.22, subdiv=2):
    """A soft canopy cloud: a cluster of rounded lobes blended together, leafy bumps, a flatter underside."""
    rnd = random.Random(seed)
    c = V(tuple(center))
    R = radius
    lobes = [ellipsoid(c, (R, R, R * 0.85))]
    for k in range(7):
        a, e = rnd.uniform(0, math.tau), rnd.uniform(-0.25, 0.75)
        dvec = V((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        lobes.append(sdf.sphere(c + dvec * R * 0.72, R * rnd.uniform(0.42, 0.6)))
    f = union(*lobes, k=R * 0.3)
    f = intersect(f, lambda P: (c[2] - R * 0.62 * flat / 0.75) - P[:, 2], k=R * 0.25)
    f = sdf.displace(f, lambda P: R * lumps * 0.3 * (sdf.noise(P, 1.8 / R, seed) - 0.5) + R * lumps * 0.14 * (sdf.noise(P, 4.5 / R, seed + 7) - 0.5))
    step = max(0.03, R / 28)
    return sculpt(name, f, c - R * 1.7, c + R * 1.7, step, mat, 900 if subdiv >= 3 else 240)


_PROTOS = {}


def _cached(key, build):
    """Build a piece once per scene and hand out copies (trees and rocks come in a few variants)."""
    protos = _PROTOS.get(key)
    try:
        ok = protos is not None and all(o.name in bpy.data.objects for o in protos)
    except ReferenceError:
        ok = False
    if not ok:
        protos = build()
        for o in protos:
            bpy.context.scene.collection.objects.unlink(o)
            o.use_fake_user = True
        _PROTOS[key] = protos
    out = []
    for proto in protos:
        ob = bpy.data.objects.new(proto.name, proto.data.copy())
        bpy.context.scene.collection.objects.link(ob)
        for k in proto.keys():
            ob[k] = proto[k]
        out.append(ob)
    return out


TREE_H = 6.0


def _tree_proto(variant, kind):
    rnd = random.Random(variant * 101 + len(kind))
    height = TREE_H
    parts = []
    lean = V((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0))
    trunk_h = height * (0.55 if kind == 'round' else 0.45)
    pts = [V((0, 0, -0.3)), V((0, 0, trunk_h * 0.35)) + lean * 0.2, V((0, 0, trunk_h * 0.7)) + lean * 0.6, V((0, 0, trunk_h)) + lean]
    r0 = height * 0.05
    trunk = tube(pts, [r0 * 1.3, r0, r0 * 0.8, r0 * 0.6])
    # the trunk flares into its roots
    for k in range(4):
        a = k * math.tau / 4 + rnd.uniform(-0.3, 0.3)
        dvec = V((math.cos(a), math.sin(a), 0))
        trunk = union(trunk, cone(V((0, 0, 0.5)) + dvec * r0 * 0.3, dvec * r0 * 2.6 + V((0, 0, -0.12)), r0 * 0.55, r0 * 0.12), k=r0 * 0.5)
    tops = [pts[-1]]
    for k in range(rnd.randint(2, 3) if kind == 'round' else 0):
        a = rnd.uniform(0, math.tau)
        base = pts[2] + (pts[3] - pts[2]) * rnd.uniform(0.0, 0.6)
        end = base + V((math.cos(a), math.sin(a), 0)) * height * 0.22 + V((0, 0, height * 0.18))
        trunk = union(trunk, tube([base, (base + end) / 2 + V((0, 0, 0.1)), end], [r0 * 0.5, r0 * 0.36, r0 * 0.22]), k=r0 * 0.4)
        tops.append(end)
    bark = sdf.displace(trunk, lambda P: r0 * 0.07 * np.abs(np.sin(np.arctan2(P[:, 1], P[:, 0]) * 7 + P[:, 2] * 0.9)) + r0 * 0.05 * (sdf.noise(P, 3.0, variant) - 0.5))
    parts.append(sculpt('trunk', bark, (-2.5, -2.5, -0.6), (2.5, 2.5, trunk_h + height * 0.25), 0.03, M('bark'), 340))
    leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4']
    canopy = []
    if kind == 'round':
        R = height * 0.26
        for i, tp in enumerate(tops):
            canopy.append(blob('canopy', tp + V((0, 0, R * 0.35)), R * rnd.uniform(0.8, 1.05), M(rnd.choice(leaves)), variant * 10 + i))
        canopy.append(blob('canopy', pts[-1] + V((0, 0, R * 0.9)), R * 0.9, M(rnd.choice(leaves)), variant * 10 + 9))
    elif kind == 'poplar':
        lobes = []
        for i in range(5):
            z = trunk_h * 0.55 + i * height * 0.12
            r = height * (0.17 - i * 0.022)
            lobes.append(ellipsoid(V((0, 0, z)) + lean * (0.8 + i * 0.1), (r, r, r * 1.25)))
        f = union(*lobes, k=height * 0.06)
        f = sdf.displace(f, lambda P: 0.09 * (sdf.noise(P, 1.4, variant) - 0.5) + 0.05 * (sdf.noise(P, 3.5, variant + 3) - 0.5))
        canopy.append(sculpt('canopy', f, (-2.2, -2.2, trunk_h * 0.2), (2.2, 2.2, height + 0.8), 0.06, M(rnd.choice(leaves)), 380))
    else:
        # a fir: drooping tiers of branches, each fanned into soft points
        for i in range(4):
            z = height * (0.3 + i * 0.17)
            r = height * (0.28 - i * 0.055)
            hgt = height * 0.32
            prof = [(r * 0.82, -hgt * 0.5), (r, -hgt * 0.42), (r * 0.5, 0.0), (r * 0.06, hgt * 0.5)]
            rev = sdf.revolve(prof, c=tuple(V((0, 0, z)) + lean), rmod=lambda th, zz, ph=i: 1.0 + 0.13 * np.abs(np.sin(th * 4.5 + ph)) ** 0.7)
            canopy.append(sculpt('canopy', rev, (-r - 0.6, -r - 0.6, z - hgt), (r + 0.6, r + 0.6, z + hgt), 0.05,
                                 M('leaf4' if i % 2 else 'leaf2'), 210, sharp=40.0))
    nocol(canopy)
    return parts + canopy


def tree(seed, height=5.5, kind='round'):
    out = _cached(('tree', kind, seed % 5), lambda: _tree_proto(seed % 5, kind))
    k = height / TREE_H
    for o in out:
        o.data.transform(Matrix.Scale(k, 4))
    return out


# --- small props -----------------------------------------------------------------------------

def fence(length, seed, height=0.95):
    rnd = random.Random(seed)
    parts = []
    n = max(1, round(length / 1.6))
    for i in range(n + 1):
        x = -length / 2 + length * i / n
        parts.append(box('fpost', (0.13, 0.13, height + 0.25), (x, 0, (height + 0.25) / 2 - 0.15), M('wood'), rot=Matrix.Rotation(rnd.uniform(-0.05, 0.05), 3, 'Y'), bevel=0.015))
        parts.append(box('fcap', (0.17, 0.17, 0.05), (x, 0, height + 0.1), M('wood_dark')))
    for z in (height * 0.38, height * 0.82):
        parts.append(box('rail', (length + 0.1, 0.07, 0.11), (0, 0.02, z + rnd.uniform(-0.03, 0.03)), M('wood'),
                         rot=Matrix.Rotation(rnd.uniform(-0.015, 0.015), 3, 'Y')))
    return parts


def _rock_proto(variant, mat):
    rnd = random.Random(variant * 7 + 3)
    f = ellipsoid((0, 0, 0.1), (1.0, 0.85, 0.72), sdf.rot(0, 0, rnd.uniform(0, 90)))
    f = sdf.displace(f, lambda P: 0.22 * (sdf.noise(P, 1.3, variant) - 0.5) + 0.06 * (sdf.noise(P, 3.4, variant + 5) - 0.5))
    # chiselled: a few flat faces knocked off it
    for k in range(7):
        a, e = k * math.tau / 7 + rnd.uniform(-0.3, 0.3), rnd.uniform(0.1, 1.1)
        n = (math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))
        f = intersect(f, sdf.plane(V(n) * rnd.uniform(0.42, 0.6) + V((0, 0, 0.1)), n), k=0.03)
    f = intersect(f, lambda P: -0.35 - P[:, 2])
    return [sculpt('rock', lambda P: f(P), (-1.6, -1.6, -0.5), (1.6, 1.6, 1.3), 0.04, M(mat), 150, sharp=24.0)]


def rock(seed, size=1.0, mat='stone'):
    out = _cached(('rock', mat, seed % 8), lambda: _rock_proto(seed % 8, mat))
    for o in out:
        o.data.transform(Matrix.Scale(size, 4))
    return out


def well():
    parts = []
    for k in range(14):
        a = k / 14 * math.tau
        parts.append(box('wellstone', (0.62, 0.34, 0.36), (math.cos(a) * 0.82, math.sin(a) * 0.82, 0.18), M('stone'),
                         rot=Matrix.Rotation(a + math.pi / 2, 3, 'Z'), bevel=0.05))
        parts.append(box('wellstone', (0.62, 0.34, 0.34), (math.cos(a + 0.22) * 0.82, math.sin(a + 0.22) * 0.82, 0.53), M('stone'),
                         rot=Matrix.Rotation(a + 0.22 + math.pi / 2, 3, 'Z'), bevel=0.05))
    parts.append(lib.ellipsoid('wellwater', (0, 0, 0.45), (0.68, 0.68, 0.02), M('glass'), segs=(20, 6)))
    for x in (-0.85, 0.85):
        parts.append(box('wellpost', (0.15, 0.15, 2.32), (x, 0, 1.16), M('wood_dark')))
    parts.append(sculpt('axle', union(tube([(-0.95, 0, 1.55), (0.95, 0, 1.55)], [0.055, 0.055]),
                                      tube([(0.95, 0, 1.55), (1.05, 0, 1.55), (1.07, -0.18, 1.55), (1.15, -0.2, 1.55)], [0.025] * 4), k=0.01),
                        (-1.2, -0.4, 1.3), (1.4, 0.3, 1.8), 0.012, M('wood'), 500))
    parts.append(lib.tube('rope', [(0.1, 0, 1.55), (0.1, 0, 1.05)], [0.015, 0.015], M('rope'), sides=6, subsurf=0))
    bucket = subtract(sdf.revolve([(0.12, 0.0), (0.15, 0.24), (0.155, 0.25)], c=(0.1, 0, 0.82)), cylinder((0.1, 0, 1.1), 0.13, 0.27, 0.0), k=0.01)
    bucket = union(bucket, torus((0.1, 0, 0.88), 0.135, 0.008), torus((0.1, 0, 1.04), 0.15, 0.008), k=0.004)
    bucket = union(bucket, tube([(-0.05, 0, 1.06), (0.1, 0, 1.2), (0.25, 0, 1.06)], [0.006] * 3), k=0.004)
    parts.append(sculpt('bucket', bucket, (-0.2, -0.3, 0.75), (0.4, 0.3, 1.3), 0.008, M('wood'), 700))
    # a little shingled roof
    pitch = math.radians(35)
    rf = union(roof_field(1.6, 1.0, 2.05, pitch, 0.24, 0.36, 'roof_red', 7), tube([(-1.18, 0, 2.38), (1.18, 0, 2.38)], [0.07, 0.07]), k=0.03)
    parts.append(sculpt('wellroof', rf, (-1.5, -1.1, 1.6), (1.5, 1.1, 2.7), 0.025, M('roof_red'), 1400, sharp=70.0))
    return parts


def lamp_post():
    """A wrought-iron street lamp: a fluted post with collars, a scrolled arm and a glazed lantern."""
    parts = [box('lampbase', (0.34, 0.34, 0.32), (0, 0, 0.16), M('stone'))]
    pole = tube([(0, 0, 0.3), (0, 0, 1.4), (0, 0, 2.62)], [0.065, 0.05, 0.042])
    pole = sdf.displace(pole, lambda P: 0.006 * np.abs(np.sin(np.arctan2(P[:, 1], P[:, 0]) * 4)))
    for z, r in ((0.36, 0.085), (1.25, 0.07), (2.45, 0.06)):
        pole = union(pole, torus((0, 0, z), r, 0.018), k=0.01)
    pole = union(pole, sdf.sphere((0, 0, 2.66), 0.055), k=0.01)
    # the arm sweeps out over the path and curls back under itself
    arm = [(0, 0, 2.5), (0, -0.16, 2.64), (0, -0.33, 2.66), (0, -0.42, 2.6)]
    brace = [(0, 0, 2.3), (0, -0.12, 2.42), (0, -0.26, 2.6)]
    pole = union(pole, tube(arm, [0.026, 0.024, 0.022, 0.02]), tube(brace, [0.014] * 3), k=0.012)
    parts.append(sculpt('lamppole', pole, (-0.3, -0.7, 0.2), (0.3, 0.3, 2.8), 0.012, M('iron'), 1600))
    # the lantern: glass in a frame, a pointed cap and a finial
    L = V((0, -0.42, 2.32))
    glass = sdf.warp(sbox(L, (0.11, 0.11, 0.16), 0.02), lambda P: np.column_stack([P[:, 0] / (1 + 0.25 * (P[:, 2] - L[2])), (P[:, 1] - L[1]) / (1 + 0.25 * (P[:, 2] - L[2])) + L[1], P[:, 2]]))
    lamp = [sculpt('lampglass', glass, L - 0.3, L + 0.3, 0.012, M('lamp'), 300)]
    frame = [tube([L + V((sx * 0.11, sy * 0.11, -0.16)), L + V((sx * 0.135, sy * 0.135, 0.16))], [0.012, 0.012]) for sx in (-1, 1) for sy in (-1, 1)]
    frame.append(sbox(L + V((0, 0, -0.17)), (0.13, 0.13, 0.02), 0.012))
    cap = intersect(cone(L + V((0, 0, 0.165)), L + V((0, 0, 0.29)), 0.16, 0.012), lambda P: np.maximum(np.abs(P[:, 0] - L[0]), np.abs(P[:, 1] - L[1])) - 0.145, k=0.01)
    frame += [cap, sdf.sphere(L + V((0, 0, 0.31)), 0.022)]
    lamp.append(sculpt('lampframe', union(*frame, k=0.008), L - 0.4, L + 0.45, 0.01, M('iron'), 1100))
    lamp[0]['emissive'] = 1
    return parts + nocol(lamp)


def notice_board():
    parts = [box('nbpost', (0.13, 0.13, 2.05), (x, 0, 1.02), M('wood_dark')) for x in (-0.75, 0.75)]
    parts.append(box('nbboard', (1.5, 0.07, 0.94), (0, -0.02, 1.35), M('wood')))
    for z in (0.86, 1.84):
        parts.append(box('nbrail', (1.66, 0.1, 0.1), (0, -0.04, z), M('wood_dark')))
    for x in (-0.8, 0.8):
        parts.append(box('nbrail', (0.1, 0.1, 1.08), (x, -0.04, 1.35), M('wood_dark')))
    rf = roof_field(1.5, 0.22, 2.0, math.radians(30), 0.16, 0.18, 'roof_red', 5)
    parts.append(sculpt('nbroof', rf, (-1.2, -0.6, 1.8), (1.2, 0.6, 2.4), 0.02, M('roof_red'), 900, sharp=70.0))
    rnd = random.Random(5)
    for k in range(4):
        cx, cz = -0.5 + k * 0.33 + rnd.uniform(-0.03, 0.03), 1.35 + rnd.uniform(-0.15, 0.15)
        tilt = rnd.uniform(-0.15, 0.15)
        R = sdf.rot(0, math.degrees(tilt), 0)

        def curl(P, cx=cx, cz=cz):
            # the bottom corner of each sheet lifts off the board
            q = (P - V((cx, -0.07, cz))) @ R
            return 0.03 * sdf.smooth01(-0.05, -0.2, q[:, 2]) * sdf.smooth01(0.05, 0.16, q[:, 0])
        sheet = sdf.displace(sbox((cx, -0.07, cz), (0.16, 0.006, 0.2), 0.004, R), curl)
        parts.append(sculpt('nbpaper', sheet, (cx - 0.3, -0.2, cz - 0.3), (cx + 0.3, 0.05, cz + 0.3), 0.008, M('paper'), 160))
    return parts


def bench():
    """A park bench: rounded slats on cast-iron scroll ends."""
    parts = []
    for k, y in enumerate((-0.15, 0.0, 0.15)):
        parts.append(box('bseat', (1.56, 0.13, 0.055), (0, y, 0.46), M('wood')))
    r = Matrix.Rotation(-0.22, 3, 'X')
    for z in (0.66, 0.82):
        parts.append(box('bback', (1.56, 0.12, 0.05), r @ Vector((0, 0.0, z - 0.6)) + Vector((0, 0.24, 0.6)), M('wood'), rot=r))
    ends = []
    for x in (-0.66, 0.66):
        front = [(x, -0.2, 0.0), (x, -0.19, 0.24), (x, -0.2, 0.44), (x, -0.23, 0.6), (x, -0.16, 0.66), (x, -0.06, 0.62)]
        back = [(x, 0.17, 0.0), (x, 0.16, 0.24), (x, 0.2, 0.46), (x, 0.26, 0.66), (x, 0.31, 0.88)]
        seat = [(x, -0.2, 0.43), (x, 0.2, 0.43)]
        ends += [tube(front, [0.026, 0.022, 0.022, 0.02, 0.018, 0.016]), tube(back, [0.026, 0.022, 0.022, 0.02, 0.018]), tube(seat, [0.02, 0.02])]
        ends += [ellipsoid((x, -0.22, 0.012), (0.03, 0.05, 0.016)), ellipsoid((x, 0.19, 0.012), (0.03, 0.05, 0.016))]
    parts.append(sculpt('bench_iron', union(*ends, k=0.02), (-0.8, -0.4, -0.05), (0.8, 0.45, 1.0), 0.01, M('iron'), 1400))
    return parts


def barrel():
    """A cooper's barrel: bellied staves with grooves between them, iron hoops, the lid set in."""
    def staves(th, z):
        return 1.0 - 0.018 * (1.0 - np.abs(np.sin(th * 7.0))) ** 10
    b = sdf.revolve([(0.26, 0.0), (0.31, 0.2), (0.33, 0.4), (0.31, 0.6), (0.26, 0.8)], rmod=staves)
    b = intersect(b, lambda P: np.maximum(-P[:, 2], P[:, 2] - 0.8), k=0.01)
    b = subtract(b, cylinder((0, 0, 0.84), 0.235, 0.05, 0.0), k=0.01)
    parts = [sculpt('barrel', b, (-0.45, -0.45, -0.05), (0.45, 0.45, 0.9), 0.008, M('wood'), 1300)]
    hoops = union(torus((0, 0, 0.1), 0.293, 0.012), torus((0, 0, 0.7), 0.293, 0.012), torus((0, 0, 0.77), 0.268, 0.01), torus((0, 0, 0.03), 0.268, 0.01))
    parts.append(sculpt('hoop', hoops, (-0.4, -0.4, -0.05), (0.4, 0.4, 0.85), 0.006, M('iron'), 900))
    return parts


def crate(size=0.6):
    s = size
    parts = [box('crate', (s, s, s), (0, 0, s / 2), M('wood'), bevel=0.01)]
    for z in (0.08, s - 0.08):
        parts.append(box('crateband', (s + 0.02, s + 0.02, 0.07), (0, 0, z), M('wood_dark')))
    return parts


def door_frame():
    """The freestanding pencilled door Ada steps out of."""
    parts = [box('dframe', (0.16, 0.2, 2.4), (x, 0, 1.2), M('wood_dark'), bevel=0.02) for x in (-0.62, 0.62)]
    parts.append(box('dframe', (1.4, 0.2, 0.16), (0, 0, 2.48), M('wood_dark'), bevel=0.02))
    parts.append(box('dsill', (1.5, 0.5, 0.1), (0, 0, 0.05), M('stone')))
    # the door stands open, swung outwards
    hinge = Vector((-0.55, -0.1, 0))
    r = Matrix.Rotation(math.radians(-70), 3, 'Z')
    for k in range(4):
        c = Vector((0.14 + k * 0.27, -0.03, 1.18))
        parts.append(box('dpanel', (0.26, 0.06, 2.3), hinge + r @ c, M('door_blue'), rot=r))
    parts.append(box('dknob', (0.06, 0.08, 0.06), hinge + r @ Vector((0.95, -0.09, 1.15)), M('iron'), rot=r))
    return parts


def signpost(texts=2):
    """A post with arrow boards pointing the way, a little crooked."""
    post = union(sbox((0, 0, 1.0), (0.065, 0.065, 1.0), 0.02), cone((0, 0, 2.0), (0, 0, 2.12), 0.075, 0.01), k=0.01)
    parts = [sculpt('spost', post, (-0.3, -0.3, -0.1), (0.3, 0.3, 2.3), 0.015, M('wood_dark'), 400)]
    arrow = sdf.polygon2d([(-0.05, -0.1), (0.72, -0.1), (0.86, 0.0), (0.72, 0.1), (-0.05, 0.1)])
    for k in range(texts):
        a = (0.4 if k % 2 else -0.5)
        z0 = 1.6 - k * 0.3
        R = sdf.rot(0, (k * 3 - 2), math.degrees(a))
        c = V((0, 0, z0))

        def f(P, R=R, c=c):
            q = (P - c) @ R
            return intersect(lambda Q: arrow(Q[:, 0], Q[:, 2]), lambda Q: np.abs(Q[:, 1]) - 0.025, k=0.01)(q)
        board = sdf.displace(f, lambda P: 0.004 * (sdf.noise(P, 8.0, k) - 0.5))
        parts.append(sculpt('sarrow', board, c - 1.0, c + 1.0, 0.012, M('wood'), 300))
    return parts


def tuft(seed, mat='leaf3'):
    """A grass tuft: a few folded blades (for instancing in the game)."""
    rnd = random.Random(seed)
    parts = []
    for k in range(5):
        a = k / 5 * math.tau + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        h = rnd.uniform(0.18, 0.32)
        tip = d * rnd.uniform(0.06, 0.12) + Vector((0, 0, h))
        side = d.cross(Vector((0, 0, 1))) * 0.025
        bm = bmesh.new()
        v = [bm.verts.new(-side), bm.verts.new(side), bm.verts.new(tip)]
        bm.faces.new(v)
        parts.append(lib.obj_from_bm('blade', bm, M(mat), smooth=False))
    return parts


def windmill():
    """A stone tower with a timber cap; its sails are a separate object ('sails') the game turns."""
    parts = [lib.lathe('mill_tower', [(2.0, 0.0), (1.85, 2.0), (1.55, 5.5), (1.4, 7.0)], M('plaster2'), segs=10, subsurf=0),
             lib.lathe('mill_cap', [(1.65, 7.0), (1.6, 7.6), (1.0, 8.6), (0.2, 9.1)], M('roof_thatch'), segs=10, subsurf=0)]
    parts.append(box('mill_door', (1.0, 0.15, 1.9), (0, -1.98, 0.95), M('door_green')))
    for z in (3.0, 5.2):
        parts.append(box('mill_window', (0.6, 0.12, 0.7), (0, -1.75 + (z - 3) * 0.13, z), M('glass')))
    parts.append(lib.tube('mill_axle', [(0, -1.2, 7.4), (0, -2.0, 7.5)], [0.14, 0.12], M('wood_dark'), sides=8, subsurf=0))
    sails = []
    for k in range(4):
        a = k * math.pi / 2
        r = Matrix.Rotation(a, 3, 'Y')
        sails.append(box('sail_arm', (0.16, 0.1, 5.2), r @ Vector((0, 0, 2.6)) + Vector((0, -2.05, 7.5)), M('wood_dark'), rot=r))
        sails.append(box('sail', (0.95, 0.04, 3.6), r @ Vector((0.6, 0, 3.0)) + Vector((0, -2.08, 7.5)), M('paper'), rot=r))
    for o in sails:
        o['col'] = 0
    return parts, sails


def shed():
    parts = [box('shed_walls', (2.6, 2.2, 2.0), (0, 0, 1.0), M('wood'), bevel=0.02)]
    for k in range(7):
        parts.append(box('shed_plank', (0.06, 0.06, 2.0), (-1.2 + k * 0.4, -1.12, 1.0), M('wood_dark')))
    for s in (-1, 1):
        parts.append(box('shed_roof', (3.0, 1.5, 0.08), (0, s * 0.6, 2.35), M('roof_slate'), rot=Matrix.Rotation(-s * 0.5, 3, 'X')))
    parts.append(box('shed_door', (0.9, 0.08, 1.7), (0.5, -1.13, 0.85), M('wood_dark')))
    return parts


def great_tree(seed=11):
    """The tree on the hilltop: a vast trunk with a hollow heart, five branches and their crowns.
    Returns (tree parts, [branch groups to be traced])."""
    rnd = random.Random(seed)
    parts = []
    trunk = [Vector((0, 0, -0.6)), Vector((0.2, 0, 3.0)), Vector((-0.2, 0.3, 6.0)), Vector((0.1, 0.1, 9.0))]
    parts.append(lib.tube('gt_trunk', trunk, [2.0, 1.55, 1.2, 0.95], M('bark'), sides=14, subsurf=1))
    for k in range(7):
        a = k / 7 * math.tau + rnd.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), math.sin(a), 0))
        parts.append(lib.tube('gt_root', [d * 1.0 + Vector((0, 0, 1.8)), d * 2.4 + Vector((0, 0, 0.4)), d * 3.6 + Vector((0, 0, -0.3))],
                              [0.75, 0.45, 0.15], M('bark'), sides=8, subsurf=1))
    # the hollow where the pigment sleeps, facing the approach ramp (south-west)
    hollow = lib.ellipsoid('gt_hollow', (0, 0, 3.4), (0.55, 0.3, 0.85), M('wood_dark'), segs=(16, 12))
    hollow.data.transform(Matrix.Translation((-0.95, -0.95, 0)) @ Matrix.Rotation(-math.pi * 0.25, 4, 'Z'))
    parts.append(hollow)
    crowns, traced = [], []
    leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4']
    for k in range(6):
        a = k / 6 * math.tau + 0.4
        d = Vector((math.cos(a), math.sin(a), 0))
        base = trunk[2].lerp(trunk[3], 0.3 + 0.12 * (k % 3))
        end = base + d * 6.2 + Vector((0, 0, 2.6 + (k % 2) * 1.2))
        mid = base.lerp(end, 0.5) + Vector((0, 0, 1.0))
        group = [lib.tube('gt_branch', [base, mid, end], [0.6, 0.4, 0.2], M('bark'), sides=8, subsurf=0),
                 blob('gt_crown', end + Vector((0, 0, 1.0)), 3.2, M(leaves[k % 4]), seed * 10 + k, subdiv=3)]
        group[1]['col'] = 0
        (traced if k in (1, 3, 5) else crowns).append(group)
    for g in crowns:
        parts += g
    top = blob('gt_crown', trunk[3] + Vector((0, 0, 3.2)), 4.4, M('leaf2'), seed * 10 + 9, subdiv=3)
    top['col'] = 0
    parts.append(top)
    return parts, traced


def bridge(length=9.0, width=1.8):
    """A plank footbridge along Y with a shallow arch, posts and rails."""
    parts = []
    n = int(length / 0.32)
    for i in range(n):
        t = i / (n - 1)
        y = -length / 2 + length * t
        z = 0.35 * math.sin(math.pi * t)
        parts.append(box('plank', (width, 0.28, 0.09), (0, y, z), M('wood'), rot=Matrix.Rotation(math.cos(math.pi * t) * -0.12, 3, 'X')))
    for s in (-1, 1):
        rail = [Vector((s * width / 2, -length / 2 + length * t, 0.95 + 0.35 * math.sin(math.pi * t))) for t in (0, 0.25, 0.5, 0.75, 1)]
        parts.append(lib.tube('rail', rail, [0.05] * 5, M('wood_dark'), sides=6, subsurf=0))
        for t in (0, 0.25, 0.5, 0.75, 1):
            y = -length / 2 + length * t
            z = 0.35 * math.sin(math.pi * t)
            parts.append(box('bpost', (0.12, 0.12, 1.0), (s * width / 2, y, z + 0.45), M('wood_dark')))
    return parts


def stairs(width=2.4, rise=2.4, run=3.0, steps=8):
    """Stone steps climbing +Y from z=0 to z=rise, with low side walls."""
    parts = []
    for i in range(steps):
        z = rise * (i + 1) / steps
        y = run * i / steps
        parts.append(box('stair', (width, run / steps + 0.05, z), (0, y + run / steps / 2, z / 2), M('stone'), bevel=0.02))
    for s in (-1, 1):
        for i in range(steps):
            z = rise * (i + 1) / steps
            y = run * i / steps
            parts.append(box('stairwall', (0.3, run / steps + 0.06, z + 0.35), (s * (width / 2 + 0.15), y + run / steps / 2, (z + 0.35) / 2),
                             M('stone_dark'), bevel=0.02))
    return parts
