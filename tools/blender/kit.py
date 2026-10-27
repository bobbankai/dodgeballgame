"""
Environment kit: cottages, trees, fences and small props, built procedurally so every instance can
vary a little like a hand-drawn village. All builders put their object's origin on the ground,
facing -Y, and return a list of objects (tagged with ob['col'] = 0 for things Ada walks through).
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

import lib

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


def box(name, size, loc, mat, rot=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if rot is not None:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    ob = lib.obj_from_bm(name, bm, mat, smooth=False)
    if bevel:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 1
        b.limit_method = 'ANGLE'
    return ob


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

def cottage(seed, w=4.6, d=4.0, h=2.6, roof='roof_red', door='door_green', wall='plaster', stories=1):
    rnd = random.Random(seed)
    parts = []
    plinth = 0.35
    H = h * stories
    parts.append(box('plinth', (w + 0.14, d + 0.14, plinth), (0, 0, plinth / 2), M('stone'), bevel=0.03))
    parts.append(box('walls', (w, d, H), (0, 0, plinth + H / 2), M(wall)))
    top = plinth + H
    pitch = math.radians(rnd.uniform(38, 48))
    over, side = 0.38, 0.3
    half = d / 2 + over
    rise = half * math.tan(pitch)
    # gable ends: the triangles under the roof on each side wall
    apex = top + (d / 2) * math.tan(pitch)
    for x0, x1 in ((-w / 2, -w / 2 + 0.12), (w / 2 - 0.12, w / 2)):
        bm = bmesh.new()
        tri = [(-d / 2, top), (d / 2, top), (0, apex)]
        a = [bm.verts.new((x0, y, z)) for y, z in tri]
        b = [bm.verts.new((x1, y, z)) for y, z in tri]
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
        for i in range(3):
            j = (i + 1) % 3
            bm.faces.new([a[i], b[i], b[j], a[j]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        parts.append(lib.obj_from_bm('gable', bm, M(wall), smooth=False))
    # roof: rows of overlapping shingle slabs on both slopes (ridge along X)
    rows = max(4, int(half / math.cos(pitch) / 0.42))
    L = half / math.cos(pitch)
    for s in (-1, 1):
        for i in range(rows):
            t0, t1 = i / rows, (i + 1) / rows + 0.06
            # distance up the slope from the eave
            y0 = s * (half - t0 * half)
            y1 = s * (half - min(1.0, t1) * half)
            z0 = top - over * math.tan(pitch) + t0 * rise
            z1 = top - over * math.tan(pitch) + min(1.0, t1) * rise
            th = 0.08
            # each course kicks up at its lower edge and tucks under the one above
            pts = [(y0, z0 + 0.06), (y1, z1), (y1, z1 + th), (y0, z0 + 0.06 + th)]
            bm = bmesh.new()
            xa, xb = -w / 2 - side, w / 2 + side
            va = [bm.verts.new((xa, py, pz)) for py, pz in pts]
            vb = [bm.verts.new((xb, py, pz)) for py, pz in pts]
            bm.faces.new(va)
            bm.faces.new(list(reversed(vb)))
            for k in range(4):
                bm.faces.new([va[k], vb[k], vb[(k + 1) % 4], va[(k + 1) % 4]])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            # a slight wobble per row so the rows read as hand-laid
            jit = rnd.uniform(-0.015, 0.015)
            bmesh.ops.translate(bm, vec=(0, 0, jit), verts=bm.verts)
            parts.append(lib.obj_from_bm('roof', bm, M(roof), smooth=False))
    parts.append(box('ridge', (w + 2 * side + 0.06, 0.2, 0.16), (0, 0, top + rise - over * math.tan(pitch) + 0.1), M(roof)))
    # timber frame on the front and back faces, and corner posts
    tm = M('timber')
    for y in (-d / 2 - 0.03, d / 2 + 0.03):
        parts.append(box('beam', (w + 0.06, 0.08, 0.14), (0, y, plinth + 0.07), tm))
        parts.append(box('beam', (w + 0.06, 0.08, 0.14), (0, y, top - 0.07), tm))
        if stories > 1:
            parts.append(box('beam', (w + 0.06, 0.08, 0.14), (0, y, plinth + h), tm))
    for x in (-w / 2, w / 2):
        for y in (-d / 2, d / 2):
            parts.append(box('post', (0.16, 0.16, H), (x, y, plinth + H / 2), tm))
    # door with planks, frame and a step
    dx = rnd.choice([-0.8, 0.0, 0.8]) * (w / 4.6)
    fy = -d / 2 - 0.04
    parts.append(box('doorframe', (1.14, 0.1, 2.12), (dx, fy, plinth + 1.06), tm))
    for k in range(4):
        parts.append(box('door', (0.235, 0.06, 1.95), (dx - 0.36 + k * 0.24, fy - 0.03, plinth + 0.99), M(door)))
    parts.append(box('knob', (0.06, 0.06, 0.06), (dx + 0.3, fy - 0.08, plinth + 1.0), M('iron')))
    parts.append(box('step', (1.3, 0.5, plinth * 0.6), (dx, -d / 2 - 0.3, plinth * 0.3), M('stone_dark'), bevel=0.03))
    # windows: front either side of the door, and the sides
    def window(cx, cy, cz, facing):
        r = Matrix.Rotation(facing, 3, 'Z')
        out = []
        def at(v):
            return r @ Vector(v) + Vector((cx, cy, cz))
        def b(name, size, off, mat):
            out.append(box(name, size, at(off), mat, rot=r))
        b('glass', (0.86, 0.06, 0.9), (0, -0.02, 0), M('glass'))
        b('wframe', (1.0, 0.1, 0.1), (0, -0.04, 0.5), tm)
        b('wframe', (1.0, 0.1, 0.1), (0, -0.04, -0.5), tm)
        b('wframe', (0.1, 0.1, 1.0), (-0.48, -0.04, 0), tm)
        b('wframe', (0.1, 0.1, 1.0), (0.48, -0.04, 0), tm)
        b('mullion', (0.05, 0.08, 0.9), (0, -0.05, 0), tm)
        b('mullion', (0.86, 0.08, 0.05), (0, -0.05, 0.05), tm)
        b('sill', (1.12, 0.2, 0.07), (0, -0.1, -0.53), M('wood'))
        for sx in (-1, 1):
            b('shutter', (0.42, 0.05, 0.98), (sx * 0.74, -0.05, 0), M(door))
            b('shutter_slat', (0.34, 0.06, 0.04), (sx * 0.74, -0.08, 0.2), M(door))
            b('shutter_slat', (0.34, 0.06, 0.04), (sx * 0.74, -0.08, -0.2), M(door))
        if rnd.random() < 0.75:
            b('flowerbox', (0.98, 0.24, 0.2), (0, -0.2, -0.66), M('wood_dark'))
            fl = rnd.choice(['flower_red', 'flower_pink', 'flower_yellow', 'flower_white'])
            for k in range(6):
                o = lib.ellipsoid('flower', at((-0.4 + k * 0.16, -0.2 + rnd.uniform(-0.04, 0.04), -0.5 + rnd.uniform(0, 0.06))),
                                  (0.07, 0.07, 0.06), M(fl if k % 2 == 0 else 'leaf3'), segs=(8, 6))
                out.append(o)
        return nocol(out)
    wz = plinth + h * 0.55
    for wx in [x for x in (-w / 2 + 1.0, w / 2 - 1.0) if abs(x - dx) > 1.2]:
        parts += window(wx, -d / 2 - 0.02, wz, 0)
    for sx in (-1, 1):
        if rnd.random() < 0.8:
            parts += window(sx * (w / 2 + 0.02), rnd.uniform(-0.6, 0.6), wz, sx * math.pi / 2)
    for st in range(1, stories):
        for wx in (-w / 4, w / 4):
            parts += window(wx, -d / 2 - 0.02, plinth + h * st + h * 0.55, 0)
    # chimney
    cx = rnd.choice([-1, 1]) * (w / 2 - 0.7)
    cy = rnd.uniform(-0.3, 0.6)
    ch = top + rise + 0.4
    parts.append(box('chimney', (0.55, 0.55, ch - top + 0.2), (cx, cy, (ch + top) / 2), M('stone'), bevel=0.02))
    parts.append(box('chimney_cap', (0.68, 0.68, 0.12), (cx, cy, ch + 0.15), M('stone_dark')))
    return parts


# --- trees ---------------------------------------------------------------------------------

def blob(name, center, radius, mat, seed, flat=0.75, lumps=0.22, subdiv=2):
    """A lumpy canopy clump: an icosphere pushed about by noise, its underside flattened."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    off = Vector((seed * 7.1, seed * 3.3, seed * 1.7))
    for v in bm.verts:
        n = noise.noise(v.co * 1.6 + off) * lumps + noise.noise(v.co * 3.7 + off) * lumps * 0.4
        v.co *= 1.0 + n
        if v.co.z < 0:
            v.co.z *= flat
    bmesh.ops.scale(bm, vec=(radius, radius, radius * 0.85), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return lib.obj_from_bm(name, bm, mat, smooth=True)


def tree(seed, height=5.5, kind='round'):
    rnd = random.Random(seed)
    parts = []
    lean = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0))
    trunk_h = height * (0.55 if kind == 'round' else 0.45)
    pts = [Vector((0, 0, -0.3)), Vector((0, 0, trunk_h * 0.35)) + lean * 0.2, Vector((0, 0, trunk_h * 0.7)) + lean * 0.6,
           Vector((0, 0, trunk_h)) + lean]
    r0 = height * 0.045
    trunk = lib.tube('trunk', pts, [r0 * 1.25, r0, r0 * 0.8, r0 * 0.6], M('bark'), sides=8, subsurf=0)
    parts.append(trunk)
    for k in range(3):
        a = k * 2.1 + rnd.uniform(0, 1)
        d = Vector((math.cos(a), math.sin(a), 0))
        parts.append(lib.tube('root', [Vector((0, 0, 0.35)) + d * r0 * 0.4, d * r0 * 2.2 + Vector((0, 0, -0.05))],
                              [r0 * 0.5, r0 * 0.15], M('bark'), sides=6, subsurf=0))
    tops = [pts[-1]]
    for k in range(rnd.randint(2, 3)):
        a = rnd.uniform(0, math.tau)
        base = pts[2].lerp(pts[3], rnd.uniform(0.0, 0.6))
        end = base + Vector((math.cos(a), math.sin(a), 0)) * height * 0.22 + Vector((0, 0, height * 0.18))
        parts.append(lib.tube('branch', [base, base.lerp(end, 0.5) + Vector((0, 0, 0.1)), end], [r0 * 0.5, r0 * 0.35, r0 * 0.2],
                              M('bark'), sides=6, subsurf=0))
        tops.append(end)
    leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4']
    canopy = []
    if kind == 'round':
        R = height * 0.26
        for i, t in enumerate(tops):
            canopy.append(blob('canopy', t + Vector((0, 0, R * 0.35)), R * rnd.uniform(0.8, 1.05), M(rnd.choice(leaves)), seed * 10 + i))
        canopy.append(blob('canopy', pts[-1] + Vector((0, 0, R * 0.9)), R * 0.9, M(rnd.choice(leaves)), seed * 10 + 9))
    elif kind == 'poplar':
        for i in range(4):
            z = trunk_h * 0.6 + i * height * 0.15
            canopy.append(blob('canopy', Vector((0, 0, z)) + lean, height * (0.17 - i * 0.025), M(rnd.choice(leaves)), seed * 10 + i,
                               flat=0.9))
    else:  # pine: stacked drooping cones
        tiers = 4
        for i in range(tiers):
            z = height * (0.3 + i * 0.17)
            r = height * (0.28 - i * 0.055)
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=9, radius1=r, radius2=0.0, depth=height * 0.32)
            for v in bm.verts:
                if v.co.z < 0:
                    v.co.z -= 0.08 * math.sin(math.atan2(v.co.y, v.co.x) * 9) * r
            bmesh.ops.translate(bm, vec=Vector((0, 0, z)) + lean, verts=bm.verts)
            canopy.append(lib.obj_from_bm('canopy', bm, M('leaf4' if i % 2 else 'leaf2'), smooth=False))
    nocol(canopy)
    return parts + canopy


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


def rock(seed, size=1.0, mat='stone'):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    off = Vector((seed * 2.3, seed * 1.1, seed * 0.7))
    for v in bm.verts:
        v.co *= 1 + noise.noise(v.co * 1.3 + off) * 0.3
        v.co.z = v.co.z * 0.7 if v.co.z > 0 else v.co.z * 0.4
    bmesh.ops.scale(bm, vec=(size, size * 0.85, size), verts=bm.verts)
    return [lib.obj_from_bm('rock', bm, M(mat), smooth=False)]


def well():
    parts = []
    ring = []
    for k in range(14):
        a = k / 14 * math.tau
        parts.append(box('wellstone', (0.62, 0.34, 0.36), (math.cos(a) * 0.82, math.sin(a) * 0.82, 0.18), M('stone'),
                         rot=Matrix.Rotation(a + math.pi / 2, 3, 'Z'), bevel=0.03))
        parts.append(box('wellstone', (0.62, 0.34, 0.34), (math.cos(a + 0.22) * 0.82, math.sin(a + 0.22) * 0.82, 0.53), M('stone'),
                         rot=Matrix.Rotation(a + 0.22 + math.pi / 2, 3, 'Z'), bevel=0.03))
    parts.append(lib.ellipsoid('wellwater', (0, 0, 0.45), (0.68, 0.68, 0.02), M('glass'), segs=(20, 6)))
    for x in (-0.85, 0.85):
        parts.append(box('wellpost', (0.14, 0.14, 2.1), (x, 0, 1.05), M('wood_dark'), bevel=0.02))
    parts.append(lib.tube('axle', [(-0.95, 0, 1.55), (0.95, 0, 1.55)], [0.05, 0.05], M('wood'), sides=8, subsurf=0))
    parts.append(lib.tube('rope', [(0.1, 0, 1.55), (0.1, 0, 1.05)], [0.015, 0.015], M('rope'), sides=6, subsurf=0))
    parts.append(lib.lathe('bucket', [(0.12, 0.0), (0.15, 0.24), (0.155, 0.25)], M('wood'), segs=12, center=(0.1, 0, 0.82), subsurf=0, close_top=False))
    pitch = math.radians(35)
    for s in (-1, 1):
        parts.append(box('wellroof', (2.3, 0.85, 0.07), (0, s * 0.33, 2.25), M('roof_red'), rot=Matrix.Rotation(-s * pitch, 3, 'X')))
    return parts


def lamp_post():
    parts = [box('lampbase', (0.3, 0.3, 0.3), (0, 0, 0.15), M('stone'), bevel=0.03),
             lib.tube('lamppole', [(0, 0, 0.3), (0, 0, 2.6)], [0.06, 0.045], M('iron'), sides=8, subsurf=0),
             lib.tube('lamparm', [(0, 0, 2.5), (0, -0.25, 2.62), (0, -0.4, 2.55)], [0.03, 0.03, 0.03], M('iron'), sides=6, subsurf=0)]
    lamp = [box('lampglass', (0.22, 0.22, 0.3), (0, -0.4, 2.3), M('lamp')),
            box('lamptop', (0.32, 0.32, 0.06), (0, -0.4, 2.48), M('iron'))]
    for o in lamp:
        o['emissive'] = 1
    return parts + nocol(lamp)


def notice_board():
    parts = [box('nbpost', (0.12, 0.12, 2.0), (x, 0, 1.0), M('wood_dark'), bevel=0.015) for x in (-0.75, 0.75)]
    parts.append(box('nbboard', (1.6, 0.08, 1.0), (0, -0.02, 1.35), M('wood')))
    parts.append(box('nbroof', (1.9, 0.5, 0.06), (0, 0, 2.0), M('roof_red'), rot=Matrix.Rotation(0.25, 3, 'X')))
    rnd = random.Random(5)
    for k in range(4):
        parts.append(box('nbpaper', (0.32, 0.02, 0.4), (-0.5 + k * 0.33 + rnd.uniform(-0.03, 0.03), -0.07, 1.35 + rnd.uniform(-0.15, 0.15)),
                         M('paper'), rot=Matrix.Rotation(rnd.uniform(-0.15, 0.15), 3, 'Y')))
    return parts


def bench():
    parts = [box('bseat', (1.5, 0.42, 0.07), (0, 0, 0.45), M('wood'), bevel=0.01),
             box('bback', (1.5, 0.06, 0.32), (0, 0.2, 0.72), M('wood'), rot=Matrix.Rotation(-0.15, 3, 'X'), bevel=0.01)]
    for x in (-0.62, 0.62):
        parts.append(box('bleg', (0.08, 0.38, 0.45), (x, 0, 0.22), M('wood_dark')))
    return parts


def barrel():
    return [lib.lathe('barrel', [(0.26, 0.0), (0.31, 0.2), (0.33, 0.4), (0.31, 0.6), (0.26, 0.8)], M('wood'), segs=14, subsurf=0),
            lib.lathe('hoop', [(0.32, 0.17), (0.325, 0.23)], M('iron'), segs=14, subsurf=0, close_top=False, close_bottom=False),
            lib.lathe('hoop', [(0.325, 0.57), (0.32, 0.63)], M('iron'), segs=14, subsurf=0, close_top=False, close_bottom=False)]


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
    parts = [box('spost', (0.12, 0.12, 2.0), (0, 0, 1.0), M('wood_dark'), bevel=0.015)]
    for k in range(texts):
        a = (0.4 if k % 2 else -0.5)
        r = Matrix.Rotation(a, 3, 'Z')
        parts.append(box('sarrow', (0.9, 0.05, 0.2), r @ Vector((0.4, 0, 0)) + Vector((0, 0, 1.6 - k * 0.3)), M('wood'), rot=r))
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
