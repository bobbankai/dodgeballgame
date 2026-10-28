"""
Mum: Ada's mother, as she drew herself into the last page. An illustrator in a long mustard
coat-dress with her sleeves rolled up, a teal knitted shawl, glasses, her hair pinned up in a low
bun with a pencil pushed through it. Modelled, rigged and animated here; exported to
src/assets/models/mum.glb.

Her rig uses Ada's bone names and the same layout (scaled up to an adult), so Ada's clips
(ada_anims) are authored onto it too, with their offsets scaled to her longer legs. She adds a
clip of her own: kneeling down to Ada's height for a hug.

Blender axes: Z up, she faces -Y, her left is +X. She is about 1.68 m tall.

Run: blender -b -P tools/blender/mum.py [-- --preview out.png] [--poses out.png] [--export]
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
    'skin': '#EFC7A2', 'hair': '#6E3B27', 'coat': '#CF9436', 'coat_dark': '#A8722A', 'shawl': '#3F7F7A',
    'shawl_dark': '#2F6460', 'tights': '#3B3542', 'boots': '#6A4430', 'sole': '#2E2622', 'belt': '#5A3B26',
    'button': '#E8D9B0', 'eye': '#1E1A1C', 'eye_hi': '#FFFFFF', 'mouth': '#A14E42', 'glasses': '#3A2E30',
    'pencil': '#2F6C9E', 'wood': '#E8C9A0', 'graphite': '#3A3A40', 'eraser': '#E58A9A', 'ferrule': '#B8B8B0',
}

# Ada's legs are 0.6 m to the hip, Mum's 0.92: offsets in Ada's clips scale by this
T_SCALE = 0.92 / 0.6


def M(name):
    return lib.mat('mum_' + name, C[name], vcol=True)


def tag(objs, kind):
    for o in objs if isinstance(objs, list) else [objs]:
        o['kind'] = kind
    return objs if isinstance(objs, list) else [objs]


# --- head ------------------------------------------------------------------------------------

HEAD_C = Vector((0, 0, 1.575))
HEAD_R = Vector((0.096, 0.104, 0.122))


def head_k(zu):
    """Narrowing towards the jaw (zu: height on the unit sphere)."""
    return 1.0 - 0.24 * smooth01(0.0, -1.0, zu)


def face_y(x, z, out=0.0):
    """The front of the face at (x, z), pushed `out` metres further forwards."""
    zu = (z - HEAD_C.z) / HEAD_R.z
    k = head_k(zu)
    xu = x / (HEAD_R.x * k)
    yu = -math.sqrt(max(0.0, 1.0 - xu * xu - zu * zu))
    return yu * HEAD_R.y * k - out


def head():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=22, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        k = head_k(z)
        # a grown-up face: a defined chin and cheekbones, a little less round than Ada's
        chin = math.exp(-((z + 0.85) / 0.18) ** 2) * max(0.0, -y) * 0.06
        cheek = math.exp(-((z + 0.15) / 0.25) ** 2) * max(0.0, -y) * abs(x) * 0.05
        v.co = Vector((x * HEAD_R.x * k, y * HEAD_R.y * k - chin * 0.12 - cheek * 0.1, z * HEAD_R.z))
    bmesh.ops.translate(bm, vec=HEAD_C, verts=bm.verts)
    parts = [lib.obj_from_bm('head', bm, M('skin'), subsurf=1)]
    for s in (1, -1):
        parts.append(lib.ellipsoid('ear', (s * 0.094, 0.004, 1.565), (0.012, 0.022, 0.029), M('skin')))
    nz = 1.553
    parts.append(lib.ellipsoid('nose', (0, face_y(0, nz, 0.003), nz), (0.0075, 0.008, 0.014), M('skin')))
    parts.append(lib.ellipsoid('nose_tip', (0, face_y(0, nz - 0.009, 0.008), nz - 0.009), (0.0075, 0.0065, 0.0065), M('skin')))
    neck = lib.tube('neck', [(0, 0.008, 1.36), (0, 0.008, 1.49)], [0.041, 0.038], M('skin'), sides=14, cap=False)
    return tag(parts, 'head') + tag(neck, 'neck')


def face():
    parts = []
    ez = 1.586
    for s, side in ((1, 'L'), (-1, 'R')):
        ex = s * 0.036
        rz = Matrix.Rotation(s * math.radians(12), 3, 'Z')
        eye = [lib.ellipsoid(f'eye_{side}', (ex, face_y(ex, ez, -0.004), ez), (0.0125, 0.007, 0.0165), M('eye'), rot=rz),
               lib.ellipsoid(f'eyehi_{side}', (ex - s * 0.004, face_y(ex, ez + 0.006, 0.004), ez + 0.006), (0.004, 0.003, 0.005),
                             M('eye_hi'), segs=(12, 8), subsurf=0)]
        parts += tag(eye, 'eye_' + side)
        # brows: gentle arches, a touch raised (she is mostly amused)
        brow = [(s * x, face_y(s * x, z, 0.003), z) for x, z in ((0.017, 1.617), (0.036, 1.624), (0.055, 1.616))]
        parts += tag(lib.tube('brow', brow, [0.0022, 0.0029, 0.0018], M('hair'), sides=8, subsurf=0), 'head')
        # glasses: round rims, an arm back to each ear
        c = Vector((ex, face_y(ex, ez, 0.016), ez))
        rim = [c + Vector((math.cos(t) * 0.027, 0, math.sin(t) * 0.025)) for t in (2 * math.pi * k / 20 for k in range(21))]
        parts += tag(lib.tube('rim', rim, [0.0028] * 21, M('glasses'), sides=6, cap=False, subsurf=0), 'head')
        arm = [c + Vector((s * 0.027, 0, 0.004)), Vector((s * 0.093, -0.04, ez + 0.006)), Vector((s * 0.096, 0.0, ez - 0.01))]
        parts += tag(lib.tube('temple', arm, [0.0024] * 3, M('glasses'), sides=6, subsurf=0), 'head')
    bz = ez + 0.004
    parts += tag(lib.tube('bridge', [(0.009, face_y(0.009, bz, 0.018), bz), (0, face_y(0, bz, 0.02), bz + 0.003),
                                     (-0.009, face_y(-0.009, bz, 0.018), bz)], [0.0026] * 3, M('glasses'), sides=6, subsurf=0), 'head')
    mz = 1.519
    mouth = [(x, face_y(x, mz + z, 0.002), mz + z) for x, z in ((-0.021, 0.004), (-0.011, -0.0012), (0.0, -0.0025), (0.011, -0.0012), (0.021, 0.004))]
    parts += tag(lib.tube('mouth', mouth, [0.0026, 0.0034, 0.0036, 0.0034, 0.0026], M('mouth'), sides=8, subsurf=0), 'mouth')
    return parts


# --- hair ------------------------------------------------------------------------------------

def hairline(x, y):
    """Lowest the hair comes at each point round the head: a side-swept line over the forehead,
    down over the ears at the sides, and the nape at the back."""
    front = smooth01(0.02, -0.07, y)
    fore = 1.652 - 4.0 * x * x + 0.018 * smooth01(-0.06, 0.06, x)  # higher on her left: a side parting
    return 1.505 + (fore - 1.505) * front


def hair():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=28, radius=1.0)
    c, r = Vector((0, 0.01, 1.588)), Vector((0.106, 0.115, 0.13))
    for v in bm.verts:
        x, y, z = v.co
        # fuller on top and swept back; tucked in at the nape towards the bun
        puff = 1.0 + 0.06 * max(0.0, z) - 0.05 * smooth01(-0.2, -0.8, z) * max(0.0, y)
        v.co = Vector((c.x + x * r.x * puff, c.y + y * r.y * puff, c.z + z * r.z))
    gone = [v for v in bm.verts if v.co.z < hairline(v.co.x, v.co.y)]
    bmesh.ops.delete(bm, geom=gone, context='VERTS')
    ob = lib.obj_from_bm('hair', bm, M('hair'), subsurf=1)
    so = ob.modifiers.new('thick', 'SOLIDIFY')
    so.thickness = 0.012
    so.offset = -1.0
    parts = [ob]
    # the sweep of the fringe across her forehead, and loose strands framing her face
    sweep = [(0.07, -0.07, 1.665), (0.02, -0.098, 1.655), (-0.035, -0.095, 1.64), (-0.075, -0.07, 1.615)]
    parts.append(lib.tube('fringe', sweep, [0.011, 0.014, 0.012, 0.008], M('hair'), sides=12, squash=0.45))
    for s in (1, -1):
        strand = [(s * 0.083, -0.062, 1.625), (s * 0.097, -0.06, 1.57), (s * 0.094, -0.052, 1.51), (s * 0.084, -0.044, 1.46),
                  (s * 0.088, -0.05, 1.43)]
        parts.append(lib.tube('strand', strand, [0.01, 0.009, 0.0075, 0.006, 0.004], M('hair'), sides=10, squash=0.6))
    # a low bun at the back, pinned with a pencil
    parts.append(lib.ellipsoid('bun', (0.0, 0.118, 1.535), (0.058, 0.044, 0.05), M('hair')))
    parts.append(lib.ellipsoid('bun2', (0.018, 0.13, 1.552), (0.034, 0.03, 0.03), M('hair')))
    return tag(parts, 'head')


def pencil(tip, end, kind):
    d = (end - tip).normalized()
    p1, p2 = end - d * 0.022, end - d * 0.011
    parts = [lib.tube('pencil_tip', [tip, tip + d * 0.026], [0.0012, 0.0062], M('wood'), sides=12, cap=False, subsurf=0),
             lib.tube('pencil_body', [tip + d * 0.026, p1], [0.0066, 0.0066], M('pencil'), sides=6, cap=False, subsurf=0),
             lib.tube('pencil_lead', [tip, tip + d * 0.007], [0.0008, 0.0035], M('graphite'), sides=6, cap=False, subsurf=0),
             lib.tube('pencil_ferrule', [p1, p2], [0.0069, 0.0069], M('ferrule'), sides=12, cap=False, subsurf=0),
             lib.tube('pencil_eraser', [p2, end], [0.0066, 0.006], M('eraser'), sides=12, subsurf=0)]
    return tag(parts, kind)


# --- coat-dress ------------------------------------------------------------------------------

COAT = [(0.205, 0.40), (0.2, 0.46), (0.19, 0.6), (0.18, 0.76), (0.174, 0.88), (0.158, 0.98), (0.132, 1.06),
        (0.137, 1.14), (0.152, 1.23), (0.153, 1.29), (0.143, 1.34), (0.12, 1.378), (0.08, 1.405), (0.052, 1.42)]
COAT_DEPTH = 0.72
Z0, Z1 = COAT[0][1], COAT[-1][1]


def coat_r(z):
    if z <= Z0:
        return COAT[0][0]
    for (r0, z0), (r1, z1) in zip(COAT, COAT[1:]):
        if z <= z1:
            t = (z - z0) / (z1 - z0)
            t = t * t * (3 - 2 * t)
            return r0 + (r1 - r0) * t
    return COAT[-1][0]


def coat_pt(th, z, off=0.0):
    # the skirt falls in soft folds, deeper towards the hem and at the back
    amp = 0.06 * smooth01(0.98, 0.5, z) * (0.6 + 0.4 * (1 + math.sin(th)) / 2)
    r = coat_r(z) * (1 + amp * math.sin(6 * th + 0.7))
    return Vector(((r + off) * math.cos(th), (r * COAT_DEPTH + off) * math.sin(th), z))


def coat_normal(th, z):
    n = Vector((math.cos(th), math.sin(th) / COAT_DEPTH, 0)).normalized()
    return (n + Vector((0, 0, 1.4 * smooth01(1.35, 1.41, z)))).normalized()


def coat():
    cols = 80
    zs = [Z0 + (Z1 - Z0) * (j / 40) for j in range(41)]
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
    # the wrap-over front edge, cloth-covered buttons above the belt, and the belt itself
    th0 = math.radians(-80)
    edge = [coat_pt(th0 + math.radians(6) * smooth01(1.06, 0.6, z), z, 0.002) for z in (1.39, 1.3, 1.2, 1.1, 1.0, 0.85, 0.7, 0.55, 0.42)]
    parts.append(lib.tube('placket', edge, [0.0045] * len(edge), M('coat_dark'), sides=6, subsurf=0))
    for z in (1.31, 1.23, 1.15):
        parts.append(lib.ellipsoid('button', coat_pt(math.radians(-74), z, 0.004), (0.0105, 0.006, 0.0105), M('button'), segs=(12, 8)))
    belt = [coat_pt(2 * math.pi * k / 40, 1.065, 0.004) for k in range(41)]
    parts.append(lib.tube('belt', belt, [0.012] * 41, M('belt'), sides=8, squash=0.35, cap=False, subsurf=0,
                          normals=[coat_normal(2 * math.pi * k / 40, 1.065) for k in range(41)]))
    parts.append(lib.ellipsoid('buckle', coat_pt(math.radians(-90), 1.065, 0.01), (0.018, 0.006, 0.016), M('coat_dark'), segs=(12, 8)))
    # deep pockets she keeps pencils in
    for s in (1, -1):
        th = math.radians(-90 + s * 48)
        rz = Matrix.Rotation(th + math.pi / 2, 3, 'Z')
        parts.append(lib.ellipsoid('pocket', coat_pt(th, 0.86, 0.003), (0.055, 0.007, 0.03), M('coat_dark'), segs=(16, 8), rot=rz))
    pocket_pencil = pencil(coat_pt(math.radians(-42), 0.875, 0.01), coat_pt(math.radians(-38), 0.97, 0.016), 'coat')
    return tag(parts, 'coat') + pocket_pencil


def shawl():
    """A teal knitted shawl round her shoulders, its two ends hanging down in front."""
    ring = []
    for k in range(25):
        t = 2 * math.pi * k / 24
        ring.append((math.cos(t) * 0.118, math.sin(t) * 0.098 + 0.004, 1.385 + 0.014 * math.sin(t) + 0.01 * math.cos(2 * t)))
    parts = tag([lib.tube('shawl_ring', ring, [0.032] * len(ring), M('shawl'), sides=14, cap=False, squash=0.75)], 'shawl')
    for s in (1, -1):
        end = [(s * 0.07, -0.098, 1.37), (s * 0.075, -0.118, 1.29), (s * 0.072, -0.122, 1.2), (s * 0.07, -0.118, 1.12)]
        parts += tag(lib.tube('shawl_end', end, [0.03, 0.032, 0.031, 0.028], M('shawl'), sides=12, squash=0.3,
                              normals=Vector((0, -1, 0.15))), 'shawlend')
        # a fringe at each end
        for f in range(5):
            x = s * 0.07 + (f - 2) * 0.011
            parts += tag(lib.tube('fringe', [(x, -0.119, 1.123), (x + 0.002, -0.12, 1.09)], [0.0035, 0.0025], M('shawl_dark'), sides=5, subsurf=0),
                         'shawlend')
    return parts


# --- limbs -----------------------------------------------------------------------------------

# Ada's arm layout (the same angles, so her clips pose these arms the same way), adult lengths
SH = {1: Vector((0.16, 0.0, 1.355))}
EL = {1: SH[1] + Vector((0.12, 0.0, -0.155)).normalized() * 0.29}
WR = {1: EL[1] + Vector((0.1, -0.01, -0.15)).normalized() * 0.255}
for _d in (SH, EL, WR):
    _d[-1] = Vector((-_d[1].x, _d[1].y, _d[1].z))


def arms():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        sh, el, wr = SH[s], EL[s], WR[s]
        d0 = (el - sh).normalized()
        d = (wr - el).normalized()
        # sleeves rolled up past the elbow, bare forearms below
        cuff_at = el + d * 0.05
        pts = [sh - d0 * 0.05, sh, sh.lerp(el, 0.5), el, cuff_at]
        parts += tag(lib.tube('sleeve', pts, [0.043, 0.049, 0.044, 0.042, 0.043], M('coat'), sides=16), 'sleeve_' + side)
        a = d.cross(Vector((0, 1, 0))).normalized()
        b = d.cross(a)
        roll = [cuff_at + (a * math.cos(t) + b * math.sin(t)) * 0.044 for t in (2 * math.pi * k / 16 for k in range(17))]
        parts += tag(lib.tube('roll', roll, [0.013] * 17, M('coat_dark'), sides=10, cap=False), 'sleeve_' + side)
        parts += tag(lib.tube('forearm', [cuff_at, el.lerp(wr, 0.6), wr], [0.034, 0.03, 0.026], M('skin'), sides=14, cap=False), 'forearm_' + side)
        hc = wr + d * 0.052
        q = Vector((0, 0, -1)).rotation_difference(d).to_matrix()
        hand = [lib.ellipsoid('hand', hc, (0.02, 0.031, 0.05), M('skin'), segs=(32, 20), rot=q),
                lib.ellipsoid('thumb', hc + Vector((-s * 0.006, -0.026, 0.004)) - d * 0.01, (0.01, 0.011, 0.022), M('skin'),
                              rot=q @ Matrix.Rotation(math.radians(-25), 3, 'X'))]
        parts += tag(hand, 'hand_' + side)
        # a thin bracelet on her left wrist
        if s == 1:
            ring = [wr + d * 0.004 + (a * math.cos(t) + b * math.sin(t)) * 0.028 for t in (2 * math.pi * k / 14 for k in range(15))]
            parts += tag(lib.tube('bracelet', ring, [0.004] * 15, M('pencil'), sides=6, cap=False, subsurf=0), 'forearm_' + side)
    return parts


def legs():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        x = s * 0.09
        parts += tag(lib.tube('tights', [(s * 0.085, 0, 0.94), (x, -0.004, 0.72), (x, -0.006, 0.5), (x, 0, 0.3), (x, 0, 0.14)],
                              [0.072, 0.062, 0.05, 0.046, 0.036], M('tights'), sides=14, cap=False), 'leg_' + side)
        boot = [(0.039, 0.02), (0.041, 0.08), (0.04, 0.13), (0.043, 0.16), (0.046, 0.17), (0.04, 0.172)]
        parts += tag([lib.lathe('boot', boot, M('boots'), segs=24, center=(x, 0.005, 0), depth=1.0),
                      lib.ellipsoid('boot_toe', (x, -0.06, 0.038), (0.042, 0.088, 0.036), M('boots')),
                      lib.ellipsoid('sole', (x, -0.035, 0.012), (0.046, 0.115, 0.014), M('sole'), segs=(24, 10))], 'boot_' + side)
    return parts


# --- paint -----------------------------------------------------------------------------------

def tint(p, kind, mname):
    one = (1.0, 1.0, 1.0)
    if mname == 'mum_skin':
        c = one
        for s in (1, -1):
            d = (p - Vector((s * 0.058, -0.085, 1.548))).length
            b = math.exp(-(d / 0.025) ** 2) * 0.7
            c = (c[0], c[1] * (1 - 0.16 * b), c[2] * (1 - 0.2 * b))
        k = 0.88 + 0.12 * smooth01(1.38, 1.46, p.z) if kind == 'neck' else 1.0
        return (c[0] * k, c[1] * k, c[2] * k)
    if mname == 'mum_hair':
        k = 0.8 + 0.2 * smooth01(1.5, 1.68, p.z)
        return (k, k * 0.98, k * 0.96)
    if mname == 'mum_coat':
        k = 0.9 + 0.1 * smooth01(0.4, 0.75, p.z)
        return (k, k, k * 0.97)
    if mname == 'mum_shawl':
        k = 0.92 + 0.08 * math.sin(p.z * 260.0) ** 2  # knit rows
        return (k, k, k)
    return one


# --- rig -------------------------------------------------------------------------------------

def bones():
    B = [('hips', (0, 0, 0.92), (0, 0, 1.04), None),
         ('spine', (0, 0, 1.04), (0, 0, 1.2), 'hips'),
         ('chest', (0, 0, 1.2), (0, 0, 1.38), 'spine'),
         ('neck', (0, 0, 1.38), (0, 0, 1.48), 'chest'),
         ('head', (0, 0, 1.48), (0, 0, 1.74), 'neck'),
         ('mouth', (0, -0.1, 1.517), (0, -0.1, 1.535), 'head'),
         ('scarf1', (0.07, -0.1, 1.37), (0.075, -0.12, 1.26), 'chest'),
         ('scarf2', (0.075, -0.12, 1.26), (0.07, -0.118, 1.12), 'scarf1'),
         ('bag', (-0.17, 0, 1.0), (-0.19, 0, 0.92), 'hips')]
    for s, side in ((1, 'L'), (-1, 'R')):
        d = (WR[s] - EL[s]).normalized()
        B += [(f'eye_{side}', (s * 0.036, -0.09, 1.57), (s * 0.036, -0.09, 1.6), 'head'),
              (f'shoulder_{side}', (s * 0.04, 0, 1.33), SH[s], 'chest'),
              (f'upperarm_{side}', SH[s], EL[s], f'shoulder_{side}'),
              (f'forearm_{side}', EL[s], WR[s], f'upperarm_{side}'),
              (f'hand_{side}', WR[s], WR[s] + d * 0.1, f'forearm_{side}'),
              (f'thigh_{side}', (s * 0.09, 0, 0.92), (s * 0.09, -0.006, 0.5), 'hips'),
              (f'shin_{side}', (s * 0.09, -0.006, 0.5), (s * 0.09, 0.005, 0.09), f'thigh_{side}'),
              (f'foot_{side}', (s * 0.09, 0.005, 0.09), (s * 0.09, -0.13, 0.03), f'shin_{side}')]
    return B


def coat_weights(p):
    x, y, z = p
    if z <= 0.98:
        w = {'hips': 1.0}
    elif z <= 1.14:
        t = (z - 0.98) / 0.16
        w = {'hips': 1 - t, 'spine': t}
    elif z <= 1.3:
        t = (z - 1.14) / 0.16
        w = {'spine': 1 - t, 'chest': t}
    else:
        w = {'chest': 1.0}
    extra = {'neck': smooth01(1.39, 1.42, z)}
    for s, side in ((1, 'L'), (-1, 'R')):
        extra['shoulder_' + side] = 0.7 * smooth01(0.09, 0.15, s * x) * smooth01(1.28, 1.36, z)
        # the skirt follows her legs: the thighs above the knee, the shins a little below it
        front = smooth01(0.04, -0.14, y)
        sidew = smooth01(-0.06, 0.06, s * x)
        # (the front of the skirt rides right up on a raised knee rather than letting it poke through)
        extra['thigh_' + side] = (0.5 + 0.48 * front) * smooth01(0.98, 0.7, z) * sidew * (1 - 0.5 * smooth01(0.5, 0.4, z))
        extra['shin_' + side] = 0.35 * front * smooth01(0.5, 0.4, z) * sidew
    k = max(0.0, 1.0 - sum(extra.values()))
    w = {b: v * k for b, v in w.items()}
    w.update(extra)
    return w


def weight_fn(kind, segs):
    def seg(*names, mult=None, power=5.0):
        sub = {n: segs[n] for n in names}
        return lambda p: lib.dist_weights(p, sub, mult, power)
    if kind == 'head':
        return lambda p: {'head': 1.0}
    if kind in ('eye_L', 'eye_R', 'mouth'):
        return lambda p: {kind: 1.0}
    if kind == 'neck':
        return seg('chest', 'neck', 'head')
    if kind == 'coat':
        return coat_weights
    if kind == 'shawl':
        return seg('chest', 'neck', mult={'chest': 0.7})
    if kind == 'shawlend':
        return seg('chest', 'scarf1', 'scarf2', mult={'chest': 0.4}, power=4)
    side = kind[-1]
    if kind.startswith('sleeve'):
        return seg('chest', f'shoulder_{side}', f'upperarm_{side}', f'forearm_{side}', mult={'chest': 0.4}, power=6)
    if kind.startswith('forearm'):
        return seg(f'forearm_{side}', f'hand_{side}', mult={f'hand_{side}': 0.3}, power=6)
    if kind.startswith('hand'):
        return lambda p: {f'hand_{side}': 1.0}
    if kind.startswith('leg'):
        return seg('hips', f'thigh_{side}', f'shin_{side}', mult={'hips': 0.5}, power=6)
    if kind.startswith('boot'):
        return seg(f'shin_{side}', f'foot_{side}', power=6)
    raise ValueError(kind)


# --- her own clip ------------------------------------------------------------------------------

def author_own(arm):
    import ada_anims
    p = lib.Poser(arm)
    T = T_SCALE
    # kneel_hug: down on one knee to Ada's height, arms round her, cheek against her hair
    ada_anims.clip(p, 'kneel_hug', 72, {
        'hips': {'tz': -0.3 * T, 'ty': 0.06 * T, 'rx': 2.0},
        'spine': {'rx': [(0, 6.0), (36, 8.0)]},
        'chest': {'rx': [(0, 4.0), (36, 6.0)]},
        'neck': {'rx': 8.0},
        'head': {'rx': [(0, 14.0), (36, 16.0)], 'rz': 20.0, 'ry': 8.0},
        'thigh_L': {'ax': -84.0}, 'shin_L': {'ax': -4.0}, 'foot_L': {'ax': 0.0},
        'thigh_R': {'ax': 4.0}, 'shin_R': {'ax': 92.0}, 'foot_R': {'ax': 60.0},
        # arms up round her at chest height, forearms crossing behind her back
        'upperarm_L': {'rx': [(0, -78.0), (36, -76.0)], 'ry': 10.0, 'rz': -46.0},
        'forearm_L': {'rx': -10.0, 'ry': 6.0, 'rz': -88.0},
        'hand_L': {'rx': 10.0},
        'upperarm_R': {'rx': [(0, -70.0), (36, -68.0)], 'ry': -10.0, 'rz': 50.0},
        'forearm_R': {'rx': -8.0, 'ry': -6.0, 'rz': 86.0},
        'hand_R': {'rx': 12.0},
        'scarf1': {'rx': 10.0}, 'scarf2': {'rx': 6.0},
    }, sym=None)
    # kneel_hold: kneeling, holding Ada's hands and looking at her (the goodbye)
    ada_anims.clip(p, 'kneel_hold', 72, {
        'hips': {'tz': -0.3 * T, 'ty': 0.06 * T, 'rx': 4.0},
        'spine': {'rx': [(0, 4.0), (36, 6.0)]},
        'chest': {'rx': 2.0},
        'neck': {'rx': 2.0},
        'head': {'rx': [(0, -2.0), (36, 2.0)], 'rz': [(0, 6.0), (40, 3.0)], 'ry': 6.0},
        'thigh_L': {'ax': -84.0}, 'shin_L': {'ax': -4.0}, 'foot_L': {'ax': 0.0},
        'thigh_R': {'ax': 4.0}, 'shin_R': {'ax': 92.0}, 'foot_R': {'ax': 60.0},
        'upperarm_L': {'rx': -38.0, 'ry': 4.0, 'rz': -8.0}, 'forearm_L': {'rx': -30.0, 'rz': -20.0}, 'hand_L': {'rx': -10.0},
        'upperarm_R': {'rx': -38.0, 'ry': -4.0, 'rz': 8.0}, 'forearm_R': {'rx': -30.0, 'rz': 20.0}, 'hand_R': {'rx': -10.0},
        'scarf1': {'rx': 4.0},
    }, sym=None)


def build():
    lib.reset()
    bpy.context.scene.render.fps = 30
    parts = head() + face() + hair() + coat() + shawl() + arms() + legs()
    # the pencil pushed through her bun
    parts += [o for o in pencil(Vector((-0.075, 0.105, 1.585)), Vector((0.085, 0.13, 1.5)), 'head')]
    for ob in parts:
        lib.apply_modifiers(ob)
    arm = lib.armature('mum_rig', bones())
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    for ob in parts:
        kind = ob['kind']
        lib.paint(ob, lambda p, k=kind, m=ob.data.materials[0].name: tint(p, k, m))
        lib.set_weights(ob, weight_fn(kind, segs))
    body = lib.join(parts, 'mum')
    lib.bind(body, arm)
    return arm, [body]


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    arm, meshes = build()
    import ada_anims  # noqa: E402
    ada_anims.T_SCALE = T_SCALE
    ada_anims.author(arm)
    author_own(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        for pb in arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
        for yaw, name in ((-25, 'front'), (150, 'back'), (-90, 'side'), (0, 'face')):
            dist, tgt = (0.55, (0, 0, 1.57)) if name == 'face' else (3.0, (0, 0, 0.88))
            lib.preview(out.replace('.png', f'_{name}.png'), target=tgt, dist=dist, yaw=yaw, pitch=6, size=(700, 900), lens=55)
    if '--poses' in argv:
        shots = [(n, int(f)) for n, f in (s.split(':') for s in os.environ.get('SHOTS', 'idle:0,walk:7,talk:12,kneel_hug:10,kneel_hold:10,hug:10,sit:0,wave:8').split(','))]
        d = os.path.splitext(argv[argv.index('--poses') + 1])[0]
        os.makedirs(d, exist_ok=True)
        ad = arm.animation_data
        for i, (name, f) in enumerate(shots):
            act = bpy.data.actions[name]
            ad.action = act
            if hasattr(ad, 'action_slot') and act.slots:
                ad.action_slot = act.slots[0]
            bpy.context.scene.frame_set(f)
            yaw = float(os.environ.get('YAW', '-55'))
            lib.preview(os.path.join(d, f'{i:02d}_{name}_{f}.png'), target=(0, 0, 0.8), dist=3.2, yaw=yaw, pitch=8, size=(360, 480), lens=50, samples=10)
        ad.action = None
    if '--export' in argv:
        lib.export_glb(os.path.join(lib.MODELS, 'mum.glb'), [arm] + meshes)
