"""
Ada: the player character. Modelled, rigged and animated here; exported to
src/assets/models/ada.glb.

Blender axes: Z up, Ada faces -Y, her left is +X. 1 unit = 1 m (she is about 1.4 m tall).

Run: blender -b -P tools/blender/ada.py [-- --preview out.png] [--poses out.png] [--export]
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import smooth01  # noqa: E402

C = {
    'skin': '#F2CDA8', 'hair': '#4A3328', 'coat': '#E9B840', 'coat_dark': '#C99230', 'scarf': '#C8483A',
    'boots': '#2F6F73', 'sole': '#26302F', 'leggings': '#2E3445', 'bag': '#8A5A3B', 'strap': '#6E452C',
    'button': '#5A3B22', 'eye': '#1E1A1C', 'eye_hi': '#FFFFFF', 'mouth': '#8A3A30', 'pencil': '#F0C431',
    'wood': '#E8C9A0', 'graphite': '#3A3A40', 'eraser': '#E58A9A', 'ferrule': '#B8B8B0',
}


def M(name):
    return lib.mat('ada_' + name, C[name], vcol=True)


def tag(objs, kind):
    for o in objs if isinstance(objs, list) else [objs]:
        o['kind'] = kind
    return objs if isinstance(objs, list) else [objs]


def tri(x):
    """Triangle wave, period 1, 0 at integers and 1 at half-integers."""
    f = x - math.floor(x)
    return 1.0 - abs(2.0 * f - 1.0)


# --- head ----------------------------------------------------------------------------------

HEAD_C = Vector((0, 0, 1.205))
HEAD_R = Vector((0.158, 0.15, 0.168))


def head():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        # a soft child's head: narrower towards the chin, cheeks a little forward and full
        k = 1.0 - 0.2 * smooth01(0.0, -1.0, z)
        cheek = math.exp(-((z + 0.35) / 0.35) ** 2) * max(0.0, -y) * 0.08
        v.co = Vector((x * HEAD_R.x * k, y * HEAD_R.y * k - cheek * 0.15, z * HEAD_R.z))
    bmesh.ops.translate(bm, vec=HEAD_C, verts=bm.verts)
    parts = [lib.obj_from_bm('head', bm, M('skin'), subsurf=1)]  # the face reads best smooth
    for s in (1, -1):
        parts.append(lib.ellipsoid('ear', (s * 0.152, 0.005, 1.185), (0.016, 0.028, 0.034), M('skin')))
    parts.append(lib.ellipsoid('nose', (0, -0.151, 1.168), (0.014, 0.012, 0.011), M('skin')))
    neck = lib.tube('neck', [(0, 0, 0.97), (0, 0, 1.09)], [0.043, 0.04], M('skin'), sides=14, cap=False)
    return tag(parts, 'head') + tag(neck, 'neck')


def face():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        rz = Matrix.Rotation(s * math.radians(14), 3, 'Z')
        eye = [lib.ellipsoid(f'eye_{side}', (s * 0.057, -0.134, 1.19), (0.02, 0.012, 0.032), M('eye'), rot=rz),
               lib.ellipsoid(f'eyehi_{side}', (s * 0.051, -0.146, 1.204), (0.007, 0.004, 0.008), M('eye_hi'), segs=(12, 8), subsurf=0)]
        parts += tag(eye, 'eye_' + side)
        # brows: short confident strokes, just under the fringe
        brow = [(s * 0.033, -0.143, 1.232), (s * 0.056, -0.142, 1.239), (s * 0.078, -0.133, 1.235)]
        parts += tag(lib.tube('brow', brow, [0.0045, 0.0058, 0.004], M('hair'), sides=8, subsurf=0), 'head')
    mouth = [(-0.022, -0.142, 1.134), (-0.011, -0.1465, 1.1285), (0.0, -0.148, 1.127), (0.011, -0.1465, 1.1285), (0.022, -0.142, 1.134)]
    parts += tag(lib.tube('mouth', mouth, [0.0032, 0.004, 0.0043, 0.004, 0.0032], M('mouth'), sides=8, subsurf=0), 'mouth')
    return parts


# --- hair ----------------------------------------------------------------------------------

HAIR_C = Vector((0, 0.006, 1.212))
HAIR_R = Vector((0.177, 0.17, 0.19))


def hair_bottom(th):
    """Where the hair ends in each direction around the head (th: 0 = her left, -90 deg = front)."""
    d = math.degrees(math.atan2(math.sin(th + math.pi / 2), math.cos(th + math.pi / 2)))  # 0 at front
    a = abs(d)
    bob = 1.072 - 0.02 * tri(math.degrees(th) / 22.5 + 0.25)
    fringe = 1.264 - 0.024 * tri(d / 12.5 + 0.5) ** 1.3
    side = 1.1 - 0.016 * tri((a - 40) / 12)
    if a < 39:
        return fringe
    if a < 43:
        return fringe + (side - fringe) * smooth01(39, 43, a)
    return side + (bob - side) * smooth01(52, 70, a)


def hair_point(th, s, zb):
    """Point at arc length s down the hair surface from the crown, for a column ending at zb."""
    l_eq = HAIR_R.z * math.pi / 2
    if s <= l_eq:
        phi = s / HAIR_R.z
        c, z = math.sin(phi), HAIR_C.z + HAIR_R.z * math.cos(phi)
    else:
        z = HAIR_C.z - (s - l_eq)
        # the bob puffs out a little below the ears, then its ends turn under
        c = 1.0 + 0.045 * smooth01(HAIR_C.z, HAIR_C.z - 0.07, z) - 0.07 * smooth01(zb + 0.035, zb, z)
    return Vector((HAIR_C.x + HAIR_R.x * c * math.cos(th), HAIR_C.y + HAIR_R.y * c * math.sin(th), z))


def hair_len(zb):
    if zb >= HAIR_C.z:
        return HAIR_R.z * math.acos(min(1.0, (zb - HAIR_C.z) / HAIR_R.z))
    return HAIR_R.z * math.pi / 2 + (HAIR_C.z - zb)


def hair():
    cols, rows = 128, 24
    bm = bmesh.new()
    pole = bm.verts.new(HAIR_C + Vector((0, 0, HAIR_R.z)))
    grid = []
    for i in range(cols):
        th = 2 * math.pi * i / cols
        zb = hair_bottom(th)
        S = hair_len(zb)
        grid.append([bm.verts.new(hair_point(th, S * (j + 1) / rows, zb)) for j in range(rows)])
    for i in range(cols):
        a, b = grid[i], grid[(i + 1) % cols]
        bm.faces.new([pole, b[0], a[0]])
        for j in range(rows - 1):
            bm.faces.new([a[j], b[j], b[j + 1], a[j + 1]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.obj_from_bm('hair', bm, M('hair'))
    so = ob.modifiers.new('thick', 'SOLIDIFY')
    so.thickness = 0.011
    so.offset = -1.0
    parts = [ob]
    # a cowlick and a couple of tufts on the crown so the silhouette isn't a perfect bowl
    top = HAIR_C + Vector((0, 0, HAIR_R.z))
    for (dx, dy), (ex, ey, ez), r in (((0.012, 0.03), (0.026, 0.03, 0.04), 0.014), ((-0.018, 0.05), (-0.03, 0.045, 0.022), 0.011)):
        a = top + Vector((dx, dy, -0.012))
        b = a + Vector((ex, ey, ez))
        mid = a.lerp(b, 0.5) + Vector((0, 0, 0.012))
        parts.append(lib.tube('tuft', [a, mid, b], [r, r * 0.55, 0.0015], M('hair'), sides=10))
    return tag(parts, 'head')


def pencil(tip, end, kind):
    d = (end - tip).normalized()
    L = (end - tip).length
    p0, p1, p2 = tip + d * 0.026, tip + d * (L - 0.03), tip + d * (L - 0.017)
    parts = [lib.tube('pencil_body', [p0, p1], [0.0095, 0.0095], M('pencil'), sides=6, cap=False, subsurf=0),
             lib.tube('pencil_wood', [tip + d * 0.007, p0], [0.0038, 0.0095], M('wood'), sides=6, cap=False, subsurf=0),
             lib.tube('pencil_lead', [tip, tip + d * 0.008], [0.0009, 0.004], M('graphite'), sides=6, cap=False, subsurf=0),
             lib.tube('pencil_ferrule', [p1, p2], [0.0103, 0.0103], M('ferrule'), sides=12, cap=False, subsurf=0),
             lib.tube('pencil_eraser', [p2, end], [0.0098, 0.009], M('eraser'), sides=12, subsurf=0)]
    return tag(parts, kind)


# --- coat ----------------------------------------------------------------------------------

COAT = [(0.18, 0.395), (0.176, 0.42), (0.165, 0.47), (0.15, 0.56), (0.139, 0.66), (0.141, 0.76),
        (0.146, 0.84), (0.142, 0.9), (0.125, 0.945), (0.085, 0.985), (0.05, 1.008)]
COAT_DEPTH = 0.8


def coat_r(z):
    if z <= COAT[0][1]:
        return COAT[0][0]
    for (r0, z0), (r1, z1) in zip(COAT, COAT[1:]):
        if z <= z1:
            t = (z - z0) / (z1 - z0)
            t = t * t * (3 - 2 * t)
            return r0 + (r1 - r0) * t
    return COAT[-1][0]


def coat_pt(th, z, off=0.0):
    # soft folds swing out towards the hem, deeper at the back than across the buttoned front
    amp = 0.05 * smooth01(0.68, 0.4, z) * (0.55 + 0.45 * (1 + math.sin(th)) / 2)
    r = coat_r(z) * (1 + amp * math.sin(5 * th + 0.9))
    return Vector(((r + off) * math.cos(th), (r * COAT_DEPTH + off) * math.sin(th), z))


def coat_normal(th, z):
    n = Vector((math.cos(th), math.sin(th) / COAT_DEPTH, 0)).normalized()
    return (n + Vector((0, 0, 1.4 * smooth01(0.9, 0.99, z)))).normalized()


def coat():
    cols = 72
    zs = [0.395 + (1.008 - 0.395) * (j / 30) for j in range(31)]
    bm = bmesh.new()
    grid = [[bm.verts.new(coat_pt(2 * math.pi * i / cols, z)) for z in zs] for i in range(cols)]
    for i in range(cols):
        a, b = grid[i], grid[(i + 1) % cols]
        for j in range(len(zs) - 1):
            bm.faces.new([a[j], b[j], b[j + 1], a[j + 1]])
    bm.faces.new([grid[i][-1] for i in range(cols)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.obj_from_bm('coat', bm, M('coat'))
    so = ob.modifiers.new('thick', 'SOLIDIFY')
    so.thickness = 0.008
    so.offset = -1.0
    parts = [ob]
    # placket and buttons down the front, two patch pockets, the hood folded behind the neck
    th0 = math.radians(-86)
    parts.append(lib.tube('placket', [coat_pt(th0, z, 0.002) for z in (0.95, 0.85, 0.75, 0.62, 0.5, 0.41)], [0.0042] * 6,
                          M('coat_dark'), sides=6, subsurf=0))
    for z in (0.885, 0.775, 0.665):
        p = coat_pt(math.radians(-79), z, 0.004)
        parts.append(lib.ellipsoid('button', p, (0.012, 0.007, 0.012), M('button'), segs=(12, 8)))
    for s in (1, -1):
        th = math.radians(-90 + s * 46)
        p = coat_pt(th, 0.53, 0.003)
        rz = Matrix.Rotation(th + math.pi / 2, 3, 'Z') @ Matrix.Rotation(math.radians(s * -14), 3, 'Y')
        parts.append(lib.ellipsoid('pocket', p, (0.05, 0.007, 0.022), M('coat_dark'), segs=(16, 8), rot=rz))
    hood = [(-0.1, 0.0, 0.97), (-0.08, 0.072, 0.985), (0.0, 0.104, 0.995), (0.08, 0.072, 0.985), (0.1, 0.0, 0.97)]
    parts.append(lib.tube('hood', hood, [0.022, 0.033, 0.038, 0.033, 0.022], M('coat'), sides=14, squash=0.7))
    return tag(parts[:-1], 'coat') + tag(parts[-1], 'hood')


def scarf():
    ring = []
    for k in range(17):
        t = 2 * math.pi * k / 16
        ring.append((math.cos(t) * 0.072, math.sin(t) * 0.064 - 0.005, 1.005 + 0.012 * math.sin(t + 1.2)))
    parts = tag([lib.tube('scarf_ring', ring, [0.03] * len(ring), M('scarf'), sides=14, cap=False),
                 lib.ellipsoid('scarf_knot', (0.04, -0.07, 0.985), (0.03, 0.022, 0.027), M('scarf'))], 'scarf')
    tail = [(0.045, -0.088, 0.975), (0.05, -0.124, 0.92), (0.053, -0.132, 0.86), (0.057, -0.13, 0.79)]
    parts += tag(lib.tube('scarf_tail', tail, [0.024, 0.027, 0.028, 0.027], M('scarf'), sides=12, squash=0.32,
                          normals=Vector((0, -1, 0.2))), 'scarftail')
    return parts


def satchel():
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.036, 0.128, 0.1), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-8), 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(-0.19, 0.0, 0.6), verts=bm.verts)
    ob = lib.obj_from_bm('satchel', bm, M('bag'), smooth=True)
    bev = ob.modifiers.new('bevel', 'BEVEL')
    bev.width = 0.014
    bev.segments = 3
    parts = tag([ob, lib.ellipsoid('satchel_flap', (-0.208, -0.003, 0.626), (0.008, 0.068, 0.053), M('strap'), segs=(16, 10)),
                 lib.ellipsoid('satchel_buckle', (-0.215, -0.003, 0.6), (0.006, 0.015, 0.013), M('ferrule'), segs=(10, 6))], 'bag')
    # the strap runs from the bag across her front, over her left shoulder and down her back
    pts, nrm = [], []
    for k in range(25):
        u = k / 24
        th = math.radians(-152 + 304 * u)
        z = 0.665 + 0.315 * math.sin(math.pi * u) ** 1.35
        lift = 0.006 + 0.012 * smooth01(0.9, 0.98, z)
        pts.append(coat_pt(th, z, lift))
        nrm.append(coat_normal(th, z))
    pts = [Vector((-0.176, -0.05, 0.645))] + pts + [Vector((-0.176, 0.05, 0.645))]
    nrm = [Vector((-1, 0, 0))] + nrm + [Vector((-1, 0, 0))]
    parts += tag(lib.tube('strap', pts, [0.012] * len(pts), M('strap'), sides=8, squash=0.35, cap=False, normals=nrm, subsurf=0), 'strap')
    return parts


# --- limbs ---------------------------------------------------------------------------------

SH = {1: Vector((0.105, 0.0, 0.93))}
EL = {1: Vector((0.225, 0.0, 0.775))}
WR = {1: Vector((0.325, -0.01, 0.625))}
for _d in (SH, EL, WR):
    _d[-1] = Vector((-_d[1].x, _d[1].y, _d[1].z))


def arms():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        sh, el, wr = SH[s], EL[s], WR[s]
        d0 = (el - sh).normalized()
        d = (wr - el).normalized()
        pts = [sh - d0 * 0.05, sh, sh.lerp(el, 0.5), el, el.lerp(wr, 0.5), wr]
        parts += tag(lib.tube('sleeve', pts, [0.044, 0.051, 0.047, 0.043, 0.043, 0.048], M('coat'), sides=16), 'sleeve_' + side)
        # turned-up cuff
        a = d.cross(Vector((0, 1, 0))).normalized()
        b = d.cross(a)
        cuff = [wr - d * 0.004 + (a * math.cos(t) + b * math.sin(t)) * 0.047 for t in (2 * math.pi * k / 16 for k in range(17))]
        parts += tag(lib.tube('cuff', cuff, [0.011] * 17, M('coat'), sides=10, cap=False), 'forearm_' + side)
        # mitten hands, palms facing her thighs, thumbs forward
        hc = wr + d * 0.05
        q = Vector((0, 0, -1)).rotation_difference(d).to_matrix()
        hand = [lib.ellipsoid('hand', hc, (0.022, 0.032, 0.046), M('skin'), segs=(32, 20), rot=q),
                lib.ellipsoid('thumb', hc + Vector((-s * 0.006, -0.027, 0.0)) - d * 0.008, (0.011, 0.012, 0.021), M('skin'),
                              rot=q @ Matrix.Rotation(math.radians(-25), 3, 'X'))]
        parts += tag(hand, 'hand_' + side)
    return parts


def sole(x):
    """A rubber sole following the boot's footprint: heel circle + toe ellipse, extruded and bevelled."""
    def inside(px, py):
        heel = (px - x) ** 2 + (py - 0.005) ** 2 <= 0.05 ** 2
        toe = ((px - x) / 0.053) ** 2 + ((py + 0.045) / 0.083) ** 2 <= 1
        return heel or toe
    c = Vector((x, -0.035))
    ring = []
    for k in range(48):
        t = 2 * math.pi * k / 48
        r = 0.0
        while inside(c.x + math.cos(t) * (r + 0.001), c.y + math.sin(t) * (r + 0.001)) and r < 0.2:
            r += 0.001
        ring.append(Vector((c.x + math.cos(t) * r * 1.07, c.y + math.sin(t) * r * 1.05)))
    bm = bmesh.new()
    lo = [bm.verts.new((p.x, p.y, 0.0)) for p in ring]
    hi = [bm.verts.new((p.x, p.y, 0.02)) for p in ring]
    for k in range(48):
        j = (k + 1) % 48
        bm.faces.new([lo[k], lo[j], hi[j], hi[k]])
    bm.faces.new(list(reversed(lo)))
    bm.faces.new(hi)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.obj_from_bm('sole', bm, M('sole'), smooth=True)
    bev = ob.modifiers.new('bevel', 'BEVEL')
    bev.width = 0.006
    bev.segments = 3
    bev.limit_method = 'ANGLE'
    return ob


def legs():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        x = s * 0.075
        parts += tag(lib.tube('legging', [(s * 0.07, 0, 0.62), (x, -0.004, 0.46), (x, -0.006, 0.33), (x, 0, 0.2), (x, 0, 0.11)],
                              [0.06, 0.052, 0.044, 0.04, 0.036], M('leggings'), sides=14, cap=False), 'leg_' + side)
        boot = [(0.05, 0.02), (0.052, 0.12), (0.05, 0.2), (0.054, 0.255), (0.059, 0.27), (0.052, 0.273)]
        parts += tag([lib.lathe('boot', boot, M('boots'), segs=24, center=(x, 0.005, 0), depth=1.0),
                      lib.ellipsoid('boot_toe', (x, -0.045, 0.05), (0.052, 0.082, 0.048), M('boots')),
                      sole(x)], 'boot_' + side)
    return parts


# --- paint ---------------------------------------------------------------------------------

def tint(p, kind, mname):
    """Hand-painted variation, multiplied over each material's colour in the game."""
    one = (1.0, 1.0, 1.0)
    if mname == 'ada_skin':
        c = one
        for s in (1, -1):
            d = (p - Vector((s * 0.09, -0.12, 1.152))).length
            b = math.exp(-(d / 0.03) ** 2) * 0.9
            c = (c[0], c[1] * (1 - 0.22 * b), c[2] * (1 - 0.25 * b))
        k = 0.88 + 0.12 * smooth01(0.98, 1.06, p.z) if kind == 'neck' else 1.0
        return (c[0] * k, c[1] * k, c[2] * k)
    if mname == 'ada_hair':
        k = 0.82 + 0.18 * smooth01(1.07, 1.2, p.z)
        return (k, k, k)
    if mname == 'ada_coat':
        k = 0.92 + 0.08 * smooth01(0.4, 0.62, p.z)
        return (k, k, k * 0.98)
    if mname == 'ada_boots':
        k = 0.9 + 0.1 * smooth01(0.03, 0.12, p.z)
        return (k, k, k)
    return one


# --- rig -----------------------------------------------------------------------------------

def bones():
    B = [('hips', (0, 0, 0.60), (0, 0, 0.70), None),
         ('spine', (0, 0, 0.70), (0, 0, 0.82), 'hips'),
         ('chest', (0, 0, 0.82), (0, 0, 0.96), 'spine'),
         ('neck', (0, 0, 0.96), (0, 0, 1.07), 'chest'),
         ('head', (0, 0, 1.07), (0, 0, 1.40), 'neck'),
         ('mouth', (0, -0.14, 1.129), (0, -0.14, 1.15), 'head'),
         ('scarf1', (0.045, -0.09, 0.975), (0.05, -0.125, 0.9), 'chest'),
         ('scarf2', (0.05, -0.125, 0.9), (0.057, -0.13, 0.79), 'scarf1'),
         ('bag', (-0.165, 0, 0.69), (-0.19, 0, 0.6), 'hips')]
    for s, side in ((1, 'L'), (-1, 'R')):
        d = (WR[s] - EL[s]).normalized()
        B += [(f'eye_{side}', (s * 0.057, -0.13, 1.176), (s * 0.057, -0.13, 1.216), 'head'),
              (f'shoulder_{side}', (s * 0.03, 0, 0.92), SH[s], 'chest'),
              (f'upperarm_{side}', SH[s], EL[s], f'shoulder_{side}'),
              (f'forearm_{side}', EL[s], WR[s], f'upperarm_{side}'),
              (f'hand_{side}', WR[s], WR[s] + d * 0.09, f'forearm_{side}'),
              (f'thigh_{side}', (s * 0.075, 0, 0.6), (s * 0.075, -0.005, 0.33), 'hips'),
              (f'shin_{side}', (s * 0.075, -0.005, 0.33), (s * 0.075, 0.005, 0.075), f'thigh_{side}'),
              (f'foot_{side}', (s * 0.075, 0.005, 0.075), (s * 0.075, -0.11, 0.03), f'shin_{side}')]
    return B


def coat_weights(p):
    x, y, z = p
    if z <= 0.62:
        w = {'hips': 1.0}
    elif z <= 0.76:
        t = (z - 0.62) / 0.14
        w = {'hips': 1 - t, 'spine': t}
    elif z <= 0.9:
        t = (z - 0.76) / 0.14
        w = {'spine': 1 - t, 'chest': t}
    else:
        w = {'chest': 1.0}
    n = smooth01(0.975, 1.005, z)
    extra = {'neck': n}
    for s, side in ((1, 'L'), (-1, 'R')):
        extra['shoulder_' + side] = 0.7 * smooth01(0.07, 0.13, s * x) * smooth01(0.86, 0.94, z)
        # the hem follows the legs, more at the front where knees push it in a crouch
        front = smooth01(0.04, -0.12, y)
        extra['thigh_' + side] = (0.5 + 0.38 * front) * smooth01(0.64, 0.44, z) * smooth01(-0.05, 0.05, s * x)
    k = max(0.0, 1.0 - sum(extra.values()))
    w = {b: v * k for b, v in w.items()}
    w.update(extra)
    return w


def weight_fn(kind, segs):
    def seg(*names, mult=None, power=5.0):
        sub = {n: segs[n] for n in names}
        return lambda p: lib.dist_weights(p, sub, mult, power)
    if kind in ('head', 'pencil_ear'):
        return lambda p: {'head': 1.0}
    if kind in ('eye_L', 'eye_R', 'mouth', 'bag'):
        return lambda p: {kind: 1.0}
    if kind == 'pencil_hand':
        return lambda p: {'hand_R': 1.0}
    if kind == 'neck':
        return seg('chest', 'neck', 'head')
    if kind == 'coat':
        return coat_weights
    if kind in ('hood', 'scarf'):
        return seg('chest', 'neck', mult={'chest': 0.6})
    if kind == 'scarftail':
        return seg('scarf1', 'scarf2', power=4)
    if kind == 'strap':
        return seg('hips', 'spine', 'chest', 'shoulder_L', 'bag', mult={'bag': 2.5})
    side = kind[-1]
    if kind.startswith('sleeve'):
        return seg('chest', f'shoulder_{side}', f'upperarm_{side}', f'forearm_{side}', mult={'chest': 0.4}, power=6)
    if kind.startswith('forearm'):
        return lambda p: {f'forearm_{side}': 1.0}
    if kind.startswith('hand'):
        return lambda p: {f'hand_{side}': 1.0}
    if kind.startswith('leg'):
        return seg('hips', f'thigh_{side}', f'shin_{side}', mult={'hips': 0.5}, power=6)
    if kind.startswith('boot'):
        return seg(f'shin_{side}', f'foot_{side}', power=6)
    raise ValueError(kind)


def build():
    lib.reset()
    bpy.context.scene.render.fps = 30
    parts = head() + face() + hair() + coat() + scarf() + arms() + legs() + satchel()
    parts += pencil(Vector((-0.192, -0.075, 1.16)), Vector((-0.186, 0.075, 1.225)), 'pencil_ear')
    # the pencil she draws with: in her right fist, lead pointing forwards and down
    s, d = -1, (WR[-1] - EL[-1]).normalized()
    hc = WR[-1] + d * 0.05
    pd = (Vector((0, -1, 0)) * 0.5 + d * 0.85).normalized()
    parts += pencil(hc + pd * 0.085 + Vector((0, 0, 0.0)), hc - pd * 0.07, 'pencil_hand')
    for ob in parts:
        lib.apply_modifiers(ob)
    arm = lib.armature('ada_rig', bones())
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    for ob in parts:
        kind = ob['kind']
        lib.paint(ob, lambda p, k=kind, m=ob.data.materials[0].name: tint(p, k, m))
        lib.set_weights(ob, weight_fn(kind, segs))
    body = [o for o in parts if not o['kind'].startswith('pencil')]
    ear = [o for o in parts if o['kind'] == 'pencil_ear']
    hand = [o for o in parts if o['kind'] == 'pencil_hand']
    meshes = [lib.join(body, 'ada'), lib.join(ear, 'ada_pencil_ear'), lib.join(hand, 'ada_pencil_hand')]
    for ob in meshes:
        lib.bind(ob, arm)
    return arm, meshes


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    arm, meshes = build()
    import ada_anims  # noqa: E402
    ada_anims.author(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        meshes[2].hide_render = True
        for yaw, name in ((-25, 'front'), (150, 'back'), (-90, 'side'), (0, 'face')):
            dist, tgt = (0.75, (0, 0, 1.17)) if name == 'face' else (2.4, (0, 0, 0.72))
            lib.preview(out.replace('.png', f'_{name}.png'), target=tgt, dist=dist, yaw=yaw, pitch=6, size=(700, 900), lens=55)
    if '--poses' in argv:
        ada_anims.contact_sheet(arm, meshes, argv[argv.index('--poses') + 1])
    if '--export' in argv:
        lib.export_glb(os.path.join(lib.MODELS, 'ada.glb'), [arm] + meshes)
