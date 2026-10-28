"""
Mum: Ada's mother, as she drew herself into the last page. An illustrator: tall and slender, long
wavy copper hair falling down her back with a loose braid forward over one shoulder, freckles,
hazel eyes; a deep indigo dress with its sleeves pushed up, a canvas painter's apron over it
splashed with the three colours of the book (green, blue and gold), brushes in its pocket.
Nothing like Ada to look at: a grown woman, drawn with a finer hand. Modelled, rigged and
animated here; exported to src/assets/models/mum.glb.

Her skeleton uses Ada's bone names (so the game's scenes and a few of Ada's clips, like walking,
drive her too, with offsets scaled to her longer legs); her standing, talking, kneeling hug and
goodbye are her own.

Blender axes: Z up, she faces -Y, her left is +X. She is about 1.71 m tall.

Run: blender -b -P tools/blender/mum.py [-- --preview out.png] [--poses out.png] [--export]
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import smooth01  # noqa: E402

C = {
    'skin': '#F1CDB0', 'freckle': '#C98763', 'lips': '#B4565A', 'eye_white': '#F6F1EA', 'iris': '#6E7A3E',
    'pupil': '#1C1614', 'lash': '#2A1C18', 'hair': '#9A4E2C', 'hair_dark': '#7A3A22', 'dress': '#36457A',
    'dress_dark': '#2A3662', 'apron': '#EEE5D0', 'apron_dark': '#D8CCB0', 'tights': '#3A3040', 'shoe': '#6A4632',
    'sole': '#2E2420', 'gold': '#D9AE4A', 'wood': '#C79A62', 'brush_b': '#3D6B8C', 'brush_g': '#E2B33C',
    'bristle': '#3A2E2A', 'ribbon': '#3F7F7A',
}

# Ada's legs are 0.6 m to the hip, Mum's 0.9: offsets in Ada's clips scale by this
T_SCALE = 0.9 / 0.6


def M(name):
    return lib.mat('mum_' + name, C[name], vcol=True)


def tag(objs, kind):
    for o in objs if isinstance(objs, list) else [objs]:
        o['kind'] = kind
    return objs if isinstance(objs, list) else [objs]


# --- head ------------------------------------------------------------------------------------

HEAD_C = Vector((0, 0.004, 1.594))
HEAD_R = Vector((0.088, 0.097, 0.108))


def jaw(zu):
    """Narrowing towards a delicate chin."""
    return 1.0 - 0.27 * smooth01(0.0, -1.0, zu) ** 1.2


def cheek(zu):
    return 1.0 + 0.045 * math.exp(-((zu + 0.08) / 0.24) ** 2)


def chin(zu, yu):
    return 0.007 * math.exp(-((zu + 0.88) / 0.14) ** 2) * max(0.0, -yu)


def face_y(x, z, out=0.0):
    """The front surface of the face at (x, z), pushed `out` metres further forwards."""
    zu = (z - HEAD_C.z) / HEAD_R.z
    k = jaw(zu) * cheek(zu)
    xu = x / (HEAD_R.x * k)
    yu = -math.sqrt(max(0.0, 1.0 - xu * xu - zu * zu))
    return HEAD_C.y + yu * HEAD_R.y * jaw(zu) - chin(zu, yu) - out


def on_face(x, z, out=0.0):
    return Vector((x, face_y(x, z, out), z))


def head():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=28, radius=1.0)
    for v in bm.verts:
        xu, yu, zu = v.co
        k = jaw(zu)
        v.co = Vector((xu * HEAD_R.x * k * cheek(zu), yu * HEAD_R.y * k - chin(zu, yu), zu * HEAD_R.z)) + HEAD_C
    parts = [lib.obj_from_bm('head', bm, M('skin'), subsurf=1)]
    for s in (1, -1):
        parts.append(lib.ellipsoid('ear', (s * 0.083, 0.008, 1.585), (0.01, 0.019, 0.026), M('skin'), segs=(16, 12)))
        parts.append(lib.ellipsoid('earring', (s * 0.087, 0.0, 1.558), (0.0045, 0.0045, 0.0045), M('gold'), segs=(10, 8)))
    # a slim, straight nose with a soft tip
    # a small, soft nose: a gentle bridge into a rounded tip, the wings tucked in
    tilt = Matrix.Rotation(math.radians(-16), 3, 'X')
    parts.append(lib.ellipsoid('nose', on_face(0, 1.575, 0.0008), (0.0066, 0.0072, 0.0168), M('skin'), segs=(20, 16), rot=tilt))
    parts.append(lib.ellipsoid('nosetip', on_face(0, 1.5635, 0.0052), (0.0066, 0.0054, 0.0052), M('skin'), segs=(16, 12)))
    for s in (1, -1):
        parts.append(lib.ellipsoid('nostril', on_face(s * 0.0062, 1.5615, 0.0012), (0.0034, 0.003, 0.0026), M('skin'), segs=(12, 8)))
    neck = lib.tube('neck', [(0, 0.014, 1.32), (0, 0.012, 1.41), (0, 0.01, 1.5)], [0.05, 0.043, 0.04], M('skin'), sides=16, cap=False)
    # the skin of her upper chest, showing at the dress's V neck
    chest = lib.ellipsoid('decollete', (0, -0.035, 1.325), (0.085, 0.06, 0.07), M('skin'), segs=(24, 16))
    return tag(parts, 'head') + tag([neck, chest], 'neck')


def eyes():
    parts = []
    ez = 1.596
    for s, side in ((1, 'L'), (-1, 'R')):
        ex = s * 0.032
        yaw = Matrix.Rotation(s * math.radians(14), 3, 'Z')
        c = on_face(ex, ez, -0.002)
        # an almond eye: the white set into the face, a hazel iris looking straight out, the pupil, a glint
        eye = [lib.ellipsoid('eyewhite', c, (0.0165, 0.006, 0.0085), M('eye_white'), segs=(20, 12), rot=yaw)]
        fwd = Vector((0, -1, 0))
        ic = c + fwd * 0.0042 + Vector((-s * 0.0012, 0, 0.0004))
        eye.append(lib.ellipsoid('iris', ic, (0.0073, 0.0028, 0.0078), M('iris'), segs=(16, 10), rot=yaw))
        eye.append(lib.ellipsoid('pupil', ic + fwd * 0.0016, (0.0037, 0.0015, 0.004), M('pupil'), segs=(12, 8), rot=yaw))
        eye.append(lib.ellipsoid('glint', ic + fwd * 0.0026 + Vector((s * 0.0028, 0, 0.003)), (0.0016, 0.001, 0.0018), M('eye_white'), segs=(8, 6)))
        # the upper lid line and lashes, with a little flick at the outer corner
        lid = [c + Vector((-s * 0.0165, -0.002, -0.0012)), c + Vector((-s * 0.008, -0.0045, 0.0068)), c + Vector((s * 0.002, -0.005, 0.0088)),
               c + Vector((s * 0.0115, -0.0035, 0.0062)), c + Vector((s * 0.0175, -0.0012, 0.0018)), c + Vector((s * 0.0215, 0.0, 0.0048))]
        eye.append(lib.tube('lid', lid, [0.0007, 0.0012, 0.0014, 0.0013, 0.001, 0.0005], M('lash'), sides=6, subsurf=0))
        parts += tag(eye, 'eye_' + side)
        # fine arched brows, a shade darker than her hair
        brow = [on_face(s * x, z, 0.0015) for x, z in ((0.011, 1.619), (0.024, 1.6255), (0.038, 1.6265), (0.051, 1.621))]
        parts += tag(lib.tube('brow', brow, [0.0012, 0.0016, 0.0014, 0.0007], M('hair_dark'), sides=8, subsurf=1), 'head')
    # freckles across her nose and cheeks
    rnd = random.Random(31)
    for k in range(22):
        x = rnd.uniform(-0.048, 0.048)
        z = 1.571 + rnd.uniform(-0.01, 0.012) - 0.25 * x * x
        if abs(x) < 0.009:
            continue
        p = on_face(x, z, 0.0002)
        r = rnd.uniform(0.0006, 0.001)
        parts += tag(lib.ellipsoid('freckle', p, (r, 0.00025, r * 0.9), M('freckle'), segs=(6, 4)), 'head')
    # lips: a warm, closed smile
    mz = 1.522
    upper = [on_face(x, mz + z, 0.002) for x, z in ((-0.019, 0.0035), (-0.011, 0.0006), (-0.004, 0.0012), (0.0, 0.0004), (0.004, 0.0012),
                                                    (0.011, 0.0006), (0.019, 0.0035))]
    lips = [lib.tube('upperlip', upper, [0.0018, 0.0028, 0.003, 0.0028, 0.003, 0.0028, 0.0018], M('lips'), sides=8, subsurf=0),
            lib.ellipsoid('lowerlip', on_face(0, mz - 0.0052, 0.0012), (0.0098, 0.0034, 0.0036), M('lips'), segs=(16, 10))]
    parts += tag(lips, 'mouth')
    return parts


# --- hair ------------------------------------------------------------------------------------

HAIR_C = Vector((0, 0.012, 1.598))
HAIR_R = Vector((0.095, 0.107, 0.124))


def hairline(x, y):
    """Lowest the hair cap comes at each point: a soft line over the forehead (parted on her left),
    down past the ears at the sides, and on down the back."""
    front = smooth01(0.0, -0.065, y)
    fore = 1.662 - 6.5 * x * x + 0.008 * smooth01(-0.02, 0.05, x)
    return 1.52 + (fore - 1.52) * front


def hair_cap():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=56, v_segments=32, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        puff = 1.0 + 0.05 * max(0.0, z) + 0.02 * max(0.0, y)
        # fine grooves running down from the crown, so it reads as hair rather than a shell
        th = math.atan2(y, x)
        puff += 0.012 * math.sin(th * 38.0 + z * 3.0) * smooth01(0.95, 0.4, z)
        v.co = Vector((HAIR_C.x + x * HAIR_R.x * puff, HAIR_C.y + y * HAIR_R.y * puff, HAIR_C.z + z * HAIR_R.z))
    gone = [v for v in bm.verts if v.co.z < hairline(v.co.x, v.co.y)]
    bmesh.ops.delete(bm, geom=gone, context='VERTS')
    ob = lib.obj_from_bm('haircap', bm, M('hair'), subsurf=1)
    so = ob.modifiers.new('thick', 'SOLIDIFY')
    so.thickness = 0.012
    so.offset = -1.0
    return ob


def curtain():
    """Her long hair, falling down her back in loose waves, ragged at the ends."""
    cols, rows = 44, 28
    bm = bmesh.new()
    grid = []
    for i in range(cols + 1):
        u = i / cols
        col = []
        for j in range(rows + 1):
            v = j / rows
            s = smooth01(0.0, 0.45, v)
            span = math.radians(150 - 58 * s)
            th = math.pi / 2 + (u - 0.5) * span
            z_end = 1.15 + 0.035 * math.sin(th * 7.0 + 0.4) + 0.02 * math.sin(th * 13.0)
            z = 1.56 + (z_end - 1.56) * v
            wave = 0.007 * math.sin(th * 12.0 + v * 5.0) + 0.004 * math.sin(v * 17.0 + th * 3.0) + 0.0025 * math.sin(th * 41.0 + v * 2.0)
            rx = 0.098 + 0.04 * s + wave
            ry = 0.11 + 0.022 * s + wave
            back = 0.04 * s
            col.append(bm.verts.new((math.cos(th) * rx, math.sin(th) * ry + back, z)))
        grid.append(col)
    for i in range(cols):
        for j in range(rows):
            bm.faces.new([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.obj_from_bm('hairback', bm, M('hair'), subsurf=1)
    so = ob.modifiers.new('thick', 'SOLIDIFY')
    so.thickness = 0.018
    so.offset = -1.0
    return ob


def fringe():
    """A side-swept fringe from the parting, and soft waves framing her face."""
    parts = []
    out = lambda p: (p - HAIR_C).normalized()  # noqa: E731
    def on_cap(x, y, z, lift=0.004):
        p = Vector((x, y, z))
        d = (p - HAIR_C)
        k = 1.0 / math.sqrt((d.x / HAIR_R.x) ** 2 + (d.y / HAIR_R.y) ** 2 + (d.z / HAIR_R.z) ** 2)
        return HAIR_C + d * k + d.normalized() * lift
    # the sweep from her parting across the forehead, lying close to the head
    sweeps = [
        [(0.026, -0.04, 1.712), (0.0, -0.075, 1.69), (-0.035, -0.088, 1.668), (-0.064, -0.08, 1.64), (-0.083, -0.06, 1.61), (-0.09, -0.04, 1.58)],
        [(0.028, -0.03, 1.716), (-0.005, -0.068, 1.7), (-0.04, -0.08, 1.678), (-0.07, -0.07, 1.648), (-0.088, -0.045, 1.615)],
        [(0.03, -0.045, 1.71), (0.05, -0.07, 1.69), (0.068, -0.068, 1.66), (0.082, -0.05, 1.63)],
    ]
    radii = [[0.006, 0.01, 0.011, 0.01, 0.008, 0.005], [0.005, 0.008, 0.009, 0.008, 0.005], [0.005, 0.008, 0.008, 0.005]]
    for pts, rr in zip(sweeps, radii):
        pv = [on_cap(*p) for p in pts]
        parts.append(lib.tube('fringe', pv, rr, M('hair'), sides=10, squash=0.38, normals=[out(p) for p in pv]))
    return parts


BRAID = [Vector(p) for p in ((-0.075, 0.035, 1.54), (-0.098, 0.0, 1.47), (-0.11, -0.04, 1.41), (-0.112, -0.09, 1.355), (-0.108, -0.118, 1.3),
                             (-0.104, -0.128, 1.24), (-0.1, -0.13, 1.18), (-0.097, -0.128, 1.13))]


def braid():
    """A loose braid brought forward over her right shoulder, tied with a teal ribbon."""
    pts = BRAID
    # resample along the curve
    seg = []
    for a, b in zip(pts, pts[1:]):
        for k in range(6):
            seg.append(a.lerp(b, k / 6))
    seg.append(pts[-1])
    parts = []
    n = len(seg)
    for i in range(1, n - 1, 2):
        p, d = seg[i], (seg[i + 1] - seg[i - 1]).normalized()
        side = d.cross(Vector((0, 0, 1))).normalized() if abs(d.z) < 0.95 else Vector((1, 0, 0))
        s = 1 if (i // 2) % 2 else -1
        w = 0.88 - 0.3 * (i / n)
        q = Vector((0, 0, 1)).rotation_difference(d).to_matrix() @ Matrix.Rotation(s * 0.5, 3, 'Y')
        parts.append(lib.ellipsoid('braidlobe', p + side * s * 0.006 * w, (0.016 * w, 0.013 * w, 0.024 * w), M('hair'), segs=(14, 10), rot=q))
    end = pts[-1]
    d = (pts[-1] - pts[-2]).normalized()
    ring = [end + (Vector((math.cos(t), 0, 0)) * 0.012 + Vector((0, math.sin(t), 0)) * 0.012) for t in (2 * math.pi * k / 12 for k in range(13))]
    parts.append(lib.tube('ribbon', ring, [0.0035] * 13, M('ribbon'), sides=6, cap=False, subsurf=0))
    for s in (1, -1):
        parts.append(lib.tube('ribbontail', [end + Vector((0, -0.012, 0)), end + Vector((s * 0.014, -0.016, -0.025)), end + Vector((s * 0.018, -0.014, -0.045))],
                              [0.006, 0.006, 0.004], M('ribbon'), sides=6, squash=0.3, normals=Vector((0, -1, 0))))
    parts.append(lib.tube('tuft', [end + d * 0.005, end + d * 0.03 + Vector((0.004, -0.004, 0)), end + d * 0.055 + Vector((0.006, -0.002, 0))],
                          [0.012, 0.013, 0.004], M('hair'), sides=10))
    return parts


# --- dress and apron -------------------------------------------------------------------------

DRESS = [(0.215, 0.36), (0.206, 0.45), (0.19, 0.6), (0.178, 0.75), (0.17, 0.86), (0.163, 0.93), (0.145, 1.0), (0.123, 1.062),
         (0.127, 1.12), (0.141, 1.19), (0.15, 1.24), (0.149, 1.29), (0.14, 1.33), (0.125, 1.362), (0.1, 1.388), (0.066, 1.408)]
DEPTH = 0.74
Z0, Z1 = DRESS[0][1], DRESS[-1][1]


def dress_r(z):
    if z <= Z0:
        return DRESS[0][0]
    for (r0, z0), (r1, z1) in zip(DRESS, DRESS[1:]):
        if z <= z1:
            t = (z - z0) / (z1 - z0)
            t = t * t * (3 - 2 * t)
            return r0 + (r1 - r0) * t
    return DRESS[-1][0]


def dress_pt(th, z, off=0.0, folds=True):
    r = dress_r(z)
    # a little fullness at the bust, and soft folds falling from the waist to the hem
    r += 0.011 * math.exp(-((z - 1.236) / 0.05) ** 2) * max(0.0, -math.sin(th)) ** 2
    if folds:
        amp = 0.055 * smooth01(1.02, 0.45, z) * (0.6 + 0.4 * (1 + math.sin(th)) / 2)
        r *= 1 + amp * math.sin(7 * th + 0.5) + 0.25 * amp * math.sin(13 * th + 1.7)
    return Vector(((r + off) * math.cos(th), (r * DEPTH + off) * math.sin(th), z))


def dress_normal(th, z):
    return Vector((math.cos(th), math.sin(th) / DEPTH, 0)).normalized()


def neckline(th):
    """A soft V at the front, plain round at the back."""
    f = abs(math.degrees(math.atan2(math.sin(th + math.pi / 2), math.cos(th + math.pi / 2))))  # 0 at centre front
    return 1.3 + 0.1 * smooth01(0, 52, f)


def dress():
    cols = 88
    zs = [Z0 + (Z1 - Z0) * (j / 46) for j in range(47)]
    bm = bmesh.new()
    grid = [[bm.verts.new(dress_pt(2 * math.pi * i / cols, z)) for z in zs] for i in range(cols)]
    for i in range(cols):
        a, b = grid[i], grid[(i + 1) % cols]
        for j in range(len(zs) - 1):
            bm.faces.new([a[j], b[j], b[j + 1], a[j + 1]])
    gone = [v for v in bm.verts if v.co.z > neckline(math.atan2(v.co.y / DEPTH, v.co.x)) + 0.004]
    bmesh.ops.delete(bm, geom=gone, context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.obj_from_bm('dress', bm, M('dress'))
    so = ob.modifiers.new('thick', 'SOLIDIFY')
    so.thickness = 0.008
    so.offset = -1.0
    parts = [ob]
    # a narrow binding round the neckline
    edge = []
    for k in range(57):
        th = 2 * math.pi * k / 56
        edge.append(dress_pt(th, neckline(th), 0.001))
    parts.append(lib.tube('binding', edge, [0.0045] * 57, M('dress_dark'), sides=6, cap=False, subsurf=0))
    return parts


def apron():
    """A painter's canvas apron: bib and skirt, the neck strap and waist ties, a bow at the back, a
    pocket full of brushes. The paint on it is in tint()."""
    cols, rows = 40, 60
    za, zb = 0.56, 1.262
    bm = bmesh.new()
    grid = []
    for i in range(cols + 1):
        u = i / cols
        col = []
        for j in range(rows + 1):
            z = za + (zb - za) * j / rows
            span = math.radians(128 - 70 * smooth01(1.03, 1.1, z))
            th = -math.pi / 2 + (u - 0.5) * span
            off = 0.009 + 0.012 * smooth01(1.0, 0.6, z)
            col.append(bm.verts.new(dress_pt(th, z, off, folds=False)))
        grid.append(col)
    for i in range(cols):
        for j in range(rows):
            bm.faces.new([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.obj_from_bm('apron', bm, M('apron'))
    so = ob.modifiers.new('thick', 'SOLIDIFY')
    so.thickness = 0.004
    so.offset = -1.0
    parts = [ob]
    # neck strap from the corners of the bib, round the back of her neck
    half = math.radians(29)
    ca, cb = dress_pt(-math.pi / 2 + half, zb, 0.01, False), dress_pt(-math.pi / 2 - half, zb, 0.01, False)
    strap = [ca, Vector((0.064, -0.035, 1.37)), Vector((0.05, 0.03, 1.405)), Vector((0.0, 0.052, 1.412)), Vector((-0.05, 0.03, 1.405)),
             Vector((-0.064, -0.035, 1.37)), cb]
    parts.append(lib.tube('strap', strap, [0.007] * len(strap), M('apron'), sides=8, squash=0.35, cap=False, subsurf=0))
    # waist ties and the bow
    ring = [dress_pt(2 * math.pi * k / 48, 1.064, 0.013, False) for k in range(49)]
    parts.append(lib.tube('tie', ring, [0.0075] * 49, M('apron'), sides=8, squash=0.4, cap=False, subsurf=0,
                          normals=[dress_normal(2 * math.pi * k / 48, 1.064) for k in range(49)]))
    bow = Vector((0, dress_r(1.064) * DEPTH + 0.02, 1.064))
    for s in (1, -1):
        loop = [bow + Vector((s * 0.035 * math.sin(t), 0.008 * math.sin(t), 0.018 * math.sin(2 * t))) for t in (math.pi * k / 10 for k in range(11))]
        parts.append(lib.tube('bow', loop, [0.006] * 11, M('apron'), sides=8, squash=0.45, normals=Vector((0, 1, 0))))
        parts.append(lib.tube('bowtail', [bow, bow + Vector((s * 0.02, 0.012, -0.06)), bow + Vector((s * 0.03, 0.016, -0.12))],
                              [0.007, 0.007, 0.006], M('apron'), sides=8, squash=0.4, normals=Vector((0, 1, 0))))
    parts.append(lib.ellipsoid('knot', bow + Vector((0, 0.004, 0)), (0.012, 0.008, 0.012), M('apron'), segs=(12, 8)))
    # the pocket, and brushes and a pencil standing in it
    pc = dress_pt(-math.pi / 2 + 0.25, 0.86, 0.026, False)
    parts.append(lib.ellipsoid('pocket', pc, (0.075, 0.006, 0.05), M('apron_dark'), segs=(20, 10)))
    for k, (dx, h, tipcol) in enumerate(((-0.03, 0.15, 'brush_b'), (0.0, 0.17, 'brush_g'), (0.028, 0.12, 'bristle'))):
        b0 = pc + Vector((dx, -0.002, 0.01))
        b1 = b0 + Vector((dx * 0.3, -0.004, h))
        parts.append(lib.tube('brush', [b0, b1], [0.0045, 0.0035], M('wood'), sides=6, subsurf=0))
        parts.append(lib.tube('ferrule', [b1, b1 + Vector((0, 0, 0.012))], [0.0042, 0.004], M('gold'), sides=6, subsurf=0))
        parts.append(lib.tube('bristles', [b1 + Vector((0, 0, 0.012)), b1 + Vector((0, 0, 0.03))], [0.0042, 0.0012], M(tipcol), sides=6, subsurf=0))
    return parts


# --- limbs -----------------------------------------------------------------------------------

# arms in Ada's layout (the same angles, so shared clips pose them the same way), adult lengths
SH = {1: Vector((0.165, 0.0, 1.36))}
EL = {1: SH[1] + Vector((0.12, 0.0, -0.155)).normalized() * 0.29}
WR = {1: EL[1] + Vector((0.1, -0.01, -0.15)).normalized() * 0.25}
for _d in (SH, EL, WR):
    _d[-1] = Vector((-_d[1].x, _d[1].y, _d[1].z))


def hand(s, side):
    """A slender hand with fingers, relaxed and slightly curled, palm to her side."""
    d = (WR[s] - EL[s]).normalized()
    normal = Vector((-s, 0, 0))
    normal = (normal - d * normal.dot(d)).normalized()  # palm faces in, towards her body
    across = d.cross(normal).normalized()
    if across.y > 0:
        across = -across  # 'across' points to the thumb side (forwards)
    hc = WR[s] + d * 0.044
    q = Matrix((across, normal, d)).transposed()
    parts = [lib.ellipsoid('palm', hc, (0.033, 0.016, 0.042), M('skin'), segs=(24, 16), rot=q)]
    for k, (off, length) in enumerate(((0.019, 0.068), (0.0065, 0.078), (-0.0065, 0.074), (-0.018, 0.06))):
        base = hc + d * 0.036 + across * off
        mid = base + d * length * 0.5 + normal * 0.006
        tip = base + d * length * 0.86 + normal * 0.02 + across * off * 0.15
        r = 0.0068 - k * 0.0003
        parts.append(lib.tube('finger', [base, mid, tip], [r, r * 0.9, r * 0.72], M('skin'), sides=10))
    tb = hc - d * 0.012 + across * 0.026 + normal * 0.004
    tm = tb + d * 0.022 + across * 0.016 + normal * 0.006
    tt = tm + d * 0.026 + across * 0.004 + normal * 0.012
    parts.append(lib.tube('thumb', [tb, tm, tt], [0.0095, 0.0078, 0.0062], M('skin'), sides=10))
    return tag(parts, 'hand_' + side)


def arms():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        sh, el, wr = SH[s], EL[s], WR[s]
        d0 = (el - sh).normalized()
        d = (wr - el).normalized()
        # sleeves pushed up just past the elbow, gathered there
        cuff = el + d * 0.06
        pts = [sh - d0 * 0.055, sh, sh.lerp(el, 0.5), el, cuff]
        parts += tag(lib.tube('sleeve', pts, [0.04, 0.046, 0.041, 0.039, 0.044], M('dress'), sides=16), 'sleeve_' + side)
        a = d.cross(Vector((0, 1, 0))).normalized()
        b = d.cross(a)
        gather = [cuff + (a * math.cos(t) + b * math.sin(t)) * (0.041 + 0.003 * math.sin(t * 7)) for t in (2 * math.pi * k / 20 for k in range(21))]
        parts += tag(lib.tube('gather', gather, [0.009] * 21, M('dress_dark'), sides=8, cap=False), 'sleeve_' + side)
        parts += tag(lib.tube('forearm', [cuff - d * 0.02, el.lerp(wr, 0.55), wr + d * 0.012], [0.03, 0.026, 0.021], M('skin'), sides=14, cap=False),
                     'forearm_' + side)
        parts += hand(s, side)
        if s == 1:
            # a thin gold bangle
            ring = [wr - d * 0.004 + (a * math.cos(t) + b * math.sin(t)) * 0.025 for t in (2 * math.pi * k / 16 for k in range(17))]
            parts += tag(lib.tube('bangle', ring, [0.0028] * 17, M('gold'), sides=6, cap=False, subsurf=0), 'forearm_' + side)
    return parts


def legs():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        x = s * 0.088
        parts += tag(lib.tube('leg', [(s * 0.082, 0, 0.92), (s * 0.086, -0.004, 0.7), (x, -0.006, 0.49), (x, 0.004, 0.3), (x, 0.0, 0.13)],
                              [0.072, 0.058, 0.044, 0.042, 0.03], M('tights'), sides=16, cap=False), 'leg_' + side)
        shoe = [(0.034, 0.02), (0.036, 0.06), (0.035, 0.1), (0.037, 0.115), (0.033, 0.118)]
        parts += tag([lib.lathe('shoe', shoe, M('shoe'), segs=20, center=(x, 0.008, 0), depth=1.0),
                      lib.ellipsoid('toe', (x, -0.07, 0.03), (0.036, 0.09, 0.03), M('shoe'), segs=(20, 12)),
                      lib.ellipsoid('sole', (x, -0.04, 0.009), (0.04, 0.12, 0.01), M('sole'), segs=(20, 8)),
                      lib.ellipsoid('heel', (x, 0.03, 0.018), (0.028, 0.028, 0.018), M('sole'), segs=(12, 8))], 'shoe_' + side)
    return parts


# --- paint -----------------------------------------------------------------------------------

PAINT = [((0.052, 0.98), 0.03, (0.48, 0.7, 0.38)), ((-0.072, 0.72), 0.022, (0.48, 0.7, 0.38)), ((-0.04, 1.18), 0.018, (0.3, 0.48, 0.66)),
         ((0.082, 0.66), 0.026, (0.3, 0.48, 0.66)), ((0.0, 0.79), 0.022, (1.0, 0.8, 0.36)), ((-0.088, 0.95), 0.016, (1.0, 0.8, 0.36)),
         ((0.03, 1.12), 0.012, (1.0, 0.8, 0.36)), ((-0.02, 0.6), 0.014, (0.48, 0.7, 0.38))]


def tint(p, kind, mname):
    one = (1.0, 1.0, 1.0)
    if mname == 'mum_skin':
        c = one
        for s in (1, -1):
            d = (p - Vector((s * 0.05, -0.075, 1.556))).length
            b = math.exp(-(d / 0.022) ** 2) * 0.6
            c = (c[0], c[1] * (1 - 0.14 * b), c[2] * (1 - 0.17 * b))
        k = 0.9 + 0.1 * smooth01(1.36, 1.44, p.z) if kind == 'neck' else 1.0
        return (c[0] * k, c[1] * k, c[2] * k)
    if mname == 'mum_hair':
        # darker at the roots and underneath, catching the light on the waves
        k = 0.8 + 0.2 * smooth01(1.2, 1.66, p.z) + 0.06 * noise.noise(Vector((p.x * 60, p.y * 60, p.z * 12)))
        return (k, k * 0.98, k * 0.95)
    if mname == 'mum_dress':
        k = 0.9 + 0.1 * smooth01(0.38, 0.8, p.z)
        return (k, k, k)
    if mname == 'mum_apron':
        # splashes of the book's three colours, and a scatter of flecks
        for (x, z), r, col in PAINT:
            q = math.hypot(p.x - x, p.z - z) + noise.noise(Vector((p.x * 80, p.z * 80, 1.0))) * r * 0.6
            if q < r:
                return col
        n = noise.noise(Vector((p.x * 140, p.y * 140, p.z * 140)))
        if n > 0.62:
            return (0.48, 0.7, 0.38) if p.x > 0.02 else (0.3, 0.48, 0.66) if p.x < -0.02 else (1.0, 0.8, 0.36)
        k = 0.95 + 0.05 * smooth01(0.56, 0.9, p.z)
        return (k, k, k * 0.98)
    return one


# --- rig -------------------------------------------------------------------------------------

def bones():
    B = [('hips', (0, 0, 0.9), (0, 0, 1.02), None),
         ('spine', (0, 0, 1.02), (0, 0, 1.18), 'hips'),
         ('chest', (0, 0, 1.18), (0, 0, 1.37), 'spine'),
         ('neck', (0, 0, 1.37), (0, 0, 1.47), 'chest'),
         ('head', (0, 0, 1.47), (0, 0, 1.72), 'neck'),
         ('mouth', (0, -0.09, 1.517), (0, -0.09, 1.535), 'head'),
         # the braid swings on what are Ada's scarf bones
         ('scarf1', tuple(BRAID[2]), tuple(BRAID[5]), 'chest'),
         ('scarf2', tuple(BRAID[5]), tuple(BRAID[7] + Vector((0, 0, -0.05))), 'scarf1'),
         ('bag', (-0.17, 0, 0.98), (-0.19, 0, 0.9), 'hips')]
    for s, side in ((1, 'L'), (-1, 'R')):
        d = (WR[s] - EL[s]).normalized()
        B += [(f'eye_{side}', (s * 0.032, -0.08, 1.588), (s * 0.032, -0.08, 1.612), 'head'),
              (f'shoulder_{side}', (s * 0.04, 0, 1.335), SH[s], 'chest'),
              (f'upperarm_{side}', SH[s], EL[s], f'shoulder_{side}'),
              (f'forearm_{side}', EL[s], WR[s], f'upperarm_{side}'),
              (f'hand_{side}', WR[s], WR[s] + d * 0.11, f'forearm_{side}'),
              (f'thigh_{side}', (s * 0.085, 0, 0.9), (s * 0.088, -0.006, 0.49), 'hips'),
              (f'shin_{side}', (s * 0.088, -0.006, 0.49), (s * 0.088, 0.005, 0.085), f'thigh_{side}'),
              (f'foot_{side}', (s * 0.088, 0.005, 0.085), (s * 0.088, -0.13, 0.03), f'shin_{side}')]
    return B


def dress_weights(p):
    x, y, z = p
    if z <= 0.96:
        w = {'hips': 1.0}
    elif z <= 1.12:
        t = (z - 0.96) / 0.16
        w = {'hips': 1 - t, 'spine': t}
    elif z <= 1.28:
        t = (z - 1.12) / 0.16
        w = {'spine': 1 - t, 'chest': t}
    else:
        w = {'chest': 1.0}
    extra = {'neck': smooth01(1.37, 1.4, z)}
    for s, side in ((1, 'L'), (-1, 'R')):
        extra['shoulder_' + side] = 0.7 * smooth01(0.09, 0.15, s * x) * smooth01(1.27, 1.35, z)
        # the skirt follows her legs: the thighs above the knee, a little of the shins below it
        front = smooth01(0.04, -0.14, y)
        sidew = smooth01(-0.06, 0.06, s * x)
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
    if kind == 'hairback':
        # the long hair hangs from her head but lies on her back: blend down from head to chest
        def w(p):
            t = smooth01(1.5, 1.3, p.z)
            return {'head': 1 - t, 'neck': 0.35 * t * (1 - t) * 4 * 0.25, 'chest': t}
        return w
    if kind == 'braid':
        return seg('neck', 'scarf1', 'scarf2', mult={'neck': 0.6}, power=4)
    if kind == 'neck':
        return seg('chest', 'neck', 'head', mult={'head': 0.6})
    if kind == 'dress':
        return dress_weights
    side = kind[-1]
    if kind.startswith('sleeve'):
        return seg('chest', f'shoulder_{side}', f'upperarm_{side}', f'forearm_{side}', mult={'chest': 0.4}, power=6)
    if kind.startswith('forearm'):
        return seg(f'forearm_{side}', f'hand_{side}', mult={f'hand_{side}': 0.3}, power=6)
    if kind.startswith('hand'):
        return lambda p: {f'hand_{side}': 1.0}
    if kind.startswith('leg'):
        return seg('hips', f'thigh_{side}', f'shin_{side}', mult={'hips': 0.5}, power=6)
    if kind.startswith('shoe'):
        return seg(f'shin_{side}', f'foot_{side}', power=6)
    raise ValueError(kind)


# --- her own clips ---------------------------------------------------------------------------

def arms_down(lean=0.0):
    return {'upperarm_L': {'rx': 2.0 + lean, 'ry': 12.0}, 'forearm_L': {'rx': -16.0, 'ry': 4.0}, 'hand_L': {'rx': -6.0}}


def author_own(arm):
    import ada_anims
    T = T_SCALE
    p = lib.Poser(arm)
    # (her standing and talking replace Ada's, which are a twelve-year-old's)
    ad = arm.animation_data
    for name in ('idle', 'talk'):
        for tr in list(ad.nla_tracks):
            if tr.name == name:
                ad.nla_tracks.remove(tr)
        if name in bpy.data.actions:
            bpy.data.actions.remove(bpy.data.actions[name])

    legs_rest = {'thigh_L': {'ry': -2.0, 'rx': [(0, 3.0), (36, 4.0)]}, 'shin_L': {'rx': [(0, 7.0), (36, 8.0)]}, 'thigh_R': {'ry': 1.5},
                 'foot_L': {'ax': 0.0}, 'foot_R': {'ax': 0.0}}
    # idle: weight on her right leg, slow breathing, head gently tilted, the braid stirring
    ada_anims.clip(p, 'idle', 96, ada_anims.merge(arms_down(), legs_rest, {
        'hips': {'tz': [(0, -0.004), (48, -0.008)], 'tx': [(0, -0.008), (48, -0.004)], 'rz': -2.5, 'ry': [(0, -1.5), (48, 1.0)]},
        'spine': {'rx': [(0, 1.0), (48, 2.0)], 'rz': 1.5},
        'chest': {'rx': [(0, 0.0), (48, -1.5)], 'rz': 1.0},
        'neck': {'rx': 2.0},
        'head': {'rx': [(0, 2.0), (50, 0.5)], 'rz': [(0, -5.0), (48, -3.0)], 'ry': [(0, 2.0), (60, -2.0)]},
        'upperarm_L': {'rx': [(0, 2.0), (48, 0.5)], 'ry': [(0, 12.0), (48, 11.0)]},
        'scarf1': {'rx': [(0, 0.0), (48, -2.0)]}, 'scarf2': {'rx': [(10, 0.0), (58, -3.0)]},
    }), sym=0)
    # talk: the same stance, her right hand lifting as she speaks, little nods
    ada_anims.clip(p, 'talk', 60, ada_anims.merge(arms_down(), legs_rest, {
        'hips': {'tz': -0.006, 'rz': -2.0, 'ry': [(0, -1.0), (30, 1.0)]},
        'spine': {'rx': 2.0, 'rz': 1.5},
        'chest': {'rx': [(0, 0.0), (30, -1.0)]},
        'head': {'rx': [(0, 1.0), (8, 4.0), (18, 0.0), (32, 3.0), (46, 0.5)], 'rz': [(0, -4.0), (30, -2.0)], 'ry': [(0, 2.0), (36, -2.0)]},
        'upperarm_R': {'rx': [(0, -10.0), (20, -18.0), (40, -12.0)], 'ry': -14.0},
        'forearm_R': {'rx': [(0, -48.0), (12, -62.0), (26, -45.0), (42, -58.0)], 'ry': [(0, -20.0), (20, -35.0), (40, -22.0)]},
        'hand_R': {'rx': [(0, -10.0), (14, 8.0), (30, -6.0)], 'rz': [(0, 10.0), (24, -6.0)]},
        'scarf1': {'rx': [(0, 0.0), (30, -2.0)]},
    }), sym=None)
    # kneel_hug: down on one knee to Ada's height, arms round her, cheek against her hair
    ada_anims.clip(p, 'kneel_hug', 72, {
        'hips': {'tz': -0.3 * T, 'ty': 0.06 * T, 'rx': 2.0},
        'spine': {'rx': [(0, 6.0), (36, 8.0)]},
        'chest': {'rx': [(0, 4.0), (36, 6.0)]},
        'neck': {'rx': 8.0},
        'head': {'rx': [(0, 14.0), (36, 16.0)], 'rz': 20.0, 'ry': 8.0},
        'thigh_L': {'ax': -84.0}, 'shin_L': {'ax': -4.0}, 'foot_L': {'ax': 0.0},
        'thigh_R': {'ax': 4.0}, 'shin_R': {'ax': 92.0}, 'foot_R': {'ax': 60.0},
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
    parts = head() + eyes()
    parts += tag([hair_cap()] + fringe(), 'head')
    parts += tag([curtain()], 'hairback')
    parts += tag(braid(), 'braid')
    parts += tag(dress() + apron(), 'dress')
    parts += arms() + legs()
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


def rest(arm):
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    arm, meshes = build()
    import ada_anims  # noqa: E402
    ada_anims.T_SCALE = T_SCALE
    ada_anims.author(arm)
    author_own(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        rest(arm)
        views = os.environ.get('VIEWS', 'front,back,side,face,face3q').split(',')
        for name in views:
            yaw = {'front': -20, 'back': 160, 'side': -90, 'face': 0, 'face3q': -35}[name]
            dist, tgt = (0.5, (0, 0, 1.58)) if name.startswith('face') else (3.1, (0, 0, 0.86))
            lib.preview(out.replace('.png', f'_{name}.png'), target=tgt, dist=dist, yaw=yaw, pitch=4, size=(700, 900), lens=55)
    if '--poses' in argv:
        shots = [(n, int(f)) for n, f in (s.split(':') for s in os.environ.get('SHOTS', 'idle:0,idle:48,talk:12,walk:7,kneel_hug:10,kneel_hold:10').split(','))]
        d = os.path.splitext(argv[argv.index('--poses') + 1])[0]
        os.makedirs(d, exist_ok=True)
        ad = arm.animation_data
        for i, (name, f) in enumerate(shots):
            act = bpy.data.actions[name]
            ad.action = act
            if hasattr(ad, 'action_slot') and act.slots:
                ad.action_slot = act.slots[0]
            bpy.context.scene.frame_set(f)
            yaw = float(os.environ.get('YAW', '-40'))
            lib.preview(os.path.join(d, f'{i:02d}_{name}_{f}.png'), target=(0, 0, 0.82), dist=3.2, yaw=yaw, pitch=8, size=(360, 480), lens=50, samples=10)
        ad.action = None
    if '--export' in argv:
        # she only ever stands, talks, walks a little and kneels: leave Ada's other clips out
        keep = {'idle', 'talk', 'walk', 'kneel_hug', 'kneel_hold', 'blink', 'speak'}
        ad = arm.animation_data
        for tr in list(ad.nla_tracks):
            if tr.name not in keep:
                ad.nla_tracks.remove(tr)
        for act in list(bpy.data.actions):
            if act.name not in keep:
                bpy.data.actions.remove(act)
        lib.export_glb(os.path.join(lib.MODELS, 'mum.glb'), [arm] + meshes)
