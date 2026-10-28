"""
Ada: the player character, sculpted from signed distance fields (sdf.py), rigged and animated here;
exported to src/assets/models/ada.glb.

Every part is one continuous sculpted surface per material: a head with cheeks, chin, button nose
and eye sockets grown out of it; a bob made of locks with a jagged, turned-under hem; a raincoat
whose sleeves, hood and collar are blended into the body; real hands; rubber boots with soles.
Ambient occlusion is baked into the vertex colours with the painted variation.

Blender axes: Z up, Ada faces -Y, her left is +X. 1 unit = 1 m (she is about 1.4 m tall).

Run: blender -b -P tools/blender/ada.py [-- --preview out.png] [--poses out.png] [--export]
(VIEWS=front,back,... picks preview angles; SHOTS / CLOSE as in ada_anims.contact_sheet)
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
import sdf  # noqa: E402
from lib import smooth01  # noqa: E402
from sdf import V, box, cone, cylinder, ellipsoid, intersect, offset, shell, subtract, torus, tube, union  # noqa: E402

C = {
    'skin': '#F2CDA8', 'hair': '#563A2B', 'coat': '#E9B840', 'coat_dark': '#C99230', 'scarf': '#C8483A',
    'boots': '#2F6F73', 'sole': '#26302F', 'leggings': '#2E3445', 'bag': '#8A5A3B', 'strap': '#6E452C',
    'button': '#5A3B22', 'eye_white': '#FBF6EC', 'iris': '#7A4E30', 'eye_hi': '#FFFFFF',
    'lash': '#2A2022', 'mouth': '#8A3A30', 'buckle': '#C9C2AE', 'pencil': '#F0C431', 'wood': '#E8C9A0',
    'graphite': '#3A3A40', 'eraser': '#E58A9A', 'ferrule': '#B8B8B0',
}


def M(name):
    return lib.mat('ada_' + name, C[name], vcol=True)


PARTS = []


def part(name, f, lo, hi, step, mname, kind, tris):
    ob = sdf.sculpt(name, f, lo, hi, step, M(mname), tris)
    ob['kind'] = kind
    PARTS.append(ob)
    print(f'  {name}: {len(ob.data.polygons)} tris')
    return ob


def tag(objs, kind):
    for o in objs:
        o['kind'] = kind
    PARTS.extend(objs)
    return objs


def tri(x):
    """Triangle wave, period 1, 0 at integers and 1 at half-integers."""
    return 1.0 - np.abs(2.0 * (x - np.floor(x)) - 1.0)


def on(f, p, d, lift=0.0):
    """March from p (outside) along d onto f's surface, then lift the point back off it by `lift`."""
    p, d = V(p), V(d) / np.linalg.norm(d)
    a, t = 0.0, 0.0
    while t < 0.6:
        v = f(np.array([p + d * t]))[0]
        if v < 0:
            break
        a = t
        t += max(v * 0.8, 0.0003)
    else:
        raise ValueError(f'no surface from {p} along {d}')
    b = t
    for _ in range(40):
        m = (a + b) / 2
        if f(np.array([p + d * m]))[0] < 0:
            b = m
        else:
            a = m
    return p + d * ((a + b) / 2 - lift)


def normal(f, p, e=1e-4):
    p = V(p)
    g = np.array([f(np.array([p + np.eye(3)[i] * e]))[0] - f(np.array([p - np.eye(3)[i] * e]))[0] for i in range(3)])
    return g / np.linalg.norm(g)


def ellcyl(c, rx, rz, R):
    """Elliptic cylinder along local Y (for discs printed onto curved surfaces: iris, pupil)."""
    def f(P):
        q = sdf._local(P, c, R)
        k = np.sqrt((q[:, 0] / rx) ** 2 + (q[:, 2] / rz) ** 2)
        return (k - 1.0) * min(rx, rz)
    return f


# --- head ---------------------------------------------------------------------------------------

EYE_AT = (0.056, 1.19)          # x, z of each eye's centre
EYE_R = V((0.0255, 0.0065, 0.0325))
EYE_SINK = 0.0025               # how far the dome's centre sits under the skin
IRIS_C = {}


def eye_frame(base, s):
    """Each eye is a shallow dome on the face, facing along the face's own normal there."""
    p = on(base, (s * EYE_AT[0], -0.3, EYE_AT[1]), (0, 1, 0))
    n = normal(base, p)
    t = np.cross(V((0, 0, 1)), n)
    t /= np.linalg.norm(t)
    b = np.cross(t, -n)
    return p - n * EYE_SINK, np.stack([t, -n, b], axis=1)


IRIS = (0.0178, 0.0236)        # iris half width, half height
PUPIL = 0.54                    # pupil size, relative to the iris


def iris_disc(name, E, R, ic, kind):
    """The iris as a regular polar grid laid onto the eye just above the white: rings meet exactly
    at the pupil's edge, so the painted pupil (see `tint`) is crisp, and there is no geometry edge
    inside the eye for the ink lines to catch."""
    rings = [0.0, 0.14, 0.28, 0.42, PUPIL - 0.006, PUPIL + 0.006, 0.64, 0.75, 0.85, 0.93, 1.0]
    segs = 56
    radii = EYE_R + 0.0009
    Rt = R.T
    verts, faces = [], []
    for r in rings:
        for k in range(1 if r == 0 else segs):
            a = 2 * math.pi * k / segs
            x, z = ic[0] + math.cos(a) * IRIS[0] * r, ic[2] + math.sin(a) * IRIS[1] * r
            o = Rt @ (V((x, E[1] - 0.1, z)) - E)
            dv = Rt @ V((0, 1, 0))
            A = np.sum((dv / radii) ** 2)
            B = 2 * np.sum(o * dv / radii ** 2)
            Cq = np.sum((o / radii) ** 2) - 1
            t = (-B - math.sqrt(max(B * B - 4 * A * Cq, 0.0))) / (2 * A)
            verts.append(V((x, E[1] - 0.1 + t, z)))
    for k in range(segs):
        faces.append((0, 1 + (k + 1) % segs, 1 + k))
    for i in range(1, len(rings) - 1):
        a0, a1 = 1 + (i - 1) * segs, 1 + i * segs
        for k in range(segs):
            j = (k + 1) % segs
            faces.append((a0 + k, a0 + j, a1 + j, a1 + k))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(M('iris'))
    for poly in me.polygons:
        poly.use_smooth = True
    # faces must point out of the eye
    if me.polygons[0].normal.y > 0:
        me.flip_normals()
    ob['kind'] = kind
    PARTS.append(ob)
    return ob


def head_base():
    cran = ellipsoid((0, 0.01, 1.215), (0.150, 0.147, 0.158))
    face = ellipsoid((0, -0.028, 1.158), (0.126, 0.116, 0.104))
    jaw = ellipsoid((0, -0.058, 1.112), (0.086, 0.076, 0.06))
    cheek = sdf.mirror_x(ellipsoid((0.07, -0.083, 1.143), (0.052, 0.048, 0.042)))
    chin = ellipsoid((0, -0.099, 1.094), (0.04, 0.033, 0.028))
    h = union(cran, face, k=0.05)
    h = union(h, jaw, k=0.04)
    h = union(h, cheek, k=0.035)
    h = union(h, chin, k=0.03)
    nose = union(ellipsoid((0, -0.143, 1.166), (0.0135, 0.0115, 0.0118)),
                 ellipsoid((0, -0.136, 1.183), (0.0075, 0.008, 0.016)), k=0.008)
    h = union(h, nose, k=0.012)
    neck = cone((0, 0.014, 0.95), (0, 0.006, 1.11), 0.043, 0.04)
    return union(h, neck, k=0.025)


def mouth_pts(h):
    pts = []
    for x, z in ((-0.021, 1.1345), (-0.0105, 1.1292), (0.0, 1.1275), (0.0105, 1.1292), (0.021, 1.1345)):
        pts.append(on(h, (x, -0.2, z), (0, 1, 0), lift=-0.0012))
    return pts


def head():
    h = head_base()
    mp = mouth_pts(h)
    # a little crease where the mouth is (no eye sockets: when she blinks the eye folds down to a
    # closed line on smooth skin, which reads far better than an empty socket)
    h = subtract(h, tube(mp, [0.0016, 0.0024, 0.0026, 0.0024, 0.0016]), k=0.004)
    part('head', h, (-0.17, -0.18, 0.93), (0.17, 0.17, 1.39), 0.0017, 'skin', 'head', 6500)
    # mouth: a small closed smile (the mouth bone opens it when she talks)
    part('mouth', tube(mp, [0.0016, 0.0031, 0.0034, 0.0031, 0.0016]), (-0.03, -0.16, 1.115), (0.03, -0.12, 1.145),
         0.0006, 'mouth', 'mouth', 300)
    base = head_base()
    for s, side in ((1, 'L'), (-1, 'R')):
        E, R = eye_frame(base, s)
        white = ellipsoid(E, EYE_R, R)
        front = sdf.plane(E, (0, 1, 0))
        ic = E + V((-s * 0.0018, 0, -0.0012))
        lo, hi = E - 0.04, E + 0.04
        part(f'eye_{side}', white, lo, hi, 0.0006, 'eye_white', f'eye_{side}', 1400)
        # iris and pupil are one disc printed onto the eye (painted in `tint`): no edge for the ink to find
        IRIS_C[side] = ic
        iris_disc(f'iris_{side}', E, R, ic, f'eye_{side}')
        hi1 = on(white, E + V((s * 0.0062, -0.04, 0.0105)), (0, 1, 0), lift=0.002)
        hi2 = on(white, E + V((-s * 0.0058, -0.04, -0.0105)), (0, 1, 0), lift=0.0016)
        part(f'eyehi_{side}', union(ellipsoid(hi1, (0.0045, 0.0022, 0.0058), R), ellipsoid(hi2, (0.0022, 0.0014, 0.0026), R)),
             lo, hi, 0.0005, 'eye_hi', f'eye_{side}', 160)
        # upper lash line: thick ink along the top of the eye where it meets the skin, flicking out at the outer corner
        lash = []
        for phi in np.radians([166, 140, 115, 90, 66, 42, 22, 8]):
            local = V((s * math.cos(phi) * EYE_R[0] * 1.03, -EYE_SINK * 1.05, math.sin(phi) * EYE_R[2] * 1.02))
            lash.append(E + R @ local)
        lash.append(E + R @ V((s * EYE_R[0] * 1.3, -EYE_SINK * 1.3, EYE_R[2] * 0.36)))
        part(f'lash_{side}', tube(lash, [0.0012, 0.0019, 0.0024, 0.0026, 0.0027, 0.0027, 0.0024, 0.0019, 0.0007]),
             lo, hi, 0.0005, 'lash', f'eye_{side}', 400)
        # brows: short confident strokes on the brow ridge, under the fringe
        brow = [on(base, (s * x, -0.2, z), (0, 1, 0), lift=0.0022) for x, z in ((0.03, 1.2335), (0.052, 1.2405), (0.074, 1.2372), (0.088, 1.2295))]
        part(f'brow_{side}', tube(brow, [0.0028, 0.0042, 0.0036, 0.0016]), (s * 0.05 - 0.06, -0.17, 1.2), (s * 0.05 + 0.06, -0.09, 1.27),
             0.0006, 'hair', 'head', 300)


# --- hair ---------------------------------------------------------------------------------------

HC = V((0, 0.01, 1.214))
HR = V((0.172, 0.168, 0.186))


def lock_hash(i):
    return (np.sin(i * 12.9898 + 4.1) * 43758.5453) % 1.0


def lock_u(th):
    """Lock coordinate round the head: locks are about 15 degrees wide, not quite evenly."""
    d = np.degrees(np.arctan2(np.sin(th + np.pi / 2), np.cos(th + np.pi / 2)))
    return d, (d + 5.0 * np.sin(np.radians(d) * 2.7 + 0.6)) / 15.0


def hair_hem(th):
    """Where the hair ends in each direction (th: 0 = her left, -90 deg = front): a point per lock."""
    d, u = lock_u(th)
    a = np.abs(d)
    tip = tri(u + 0.5) ** 1.25
    jit = (lock_hash(np.round(u)) - 0.5)
    fringe = 1.268 - 0.03 * tip + jit * 0.008
    side = 1.104 - 0.024 * tip + jit * 0.014
    bob = 1.076 - 0.026 * tip + jit * 0.014
    sb = side + (bob - side) * smooth01v(52, 72, a)
    return np.where(a < 37, fringe, fringe + (sb - fringe) * smooth01v(37, 45, a))


def smooth01v(a, b, x):
    return sdf.smooth01(a, b, x)


def hair_outer(P, grooves=True):
    q = P - HC
    th = np.arctan2(q[:, 1], q[:, 0])
    hem = hair_hem(th)
    # the bob puffs out a little below the ears and its ends turn under
    turn = smooth01v(hem + 0.05, hem, P[:, 2])
    puff = 1.0 + 0.045 * smooth01v(0.0, -0.075, q[:, 2])
    s = (1.0 - 0.085 * turn) * puff
    zz = np.where(q[:, 2] > 0, q[:, 2] / HR[2], 0.0)
    k = np.sqrt((q[:, 0] / (HR[0] * s)) ** 2 + (q[:, 1] / (HR[1] * s)) ** 2 + zz ** 2)
    d = (k - 1.0) * HR[1] * s
    if grooves:
        # locks: rounded clumps with sharp partings between them (and a fainter one down the middle
        # of each), each lock a little fuller or flatter than the next, fading out towards the crown
        _, u = lock_u(th)
        v = 1.0 - tri(u + 0.5)
        v2 = 1.0 - tri(2 * u + 0.5)
        cosphi = q[:, 2] / np.maximum(np.sqrt(np.einsum('ij,ij->i', q, q)), 1e-6)
        fade = smooth01v(0.97, 0.82, cosphi)
        full = (lock_hash(np.round(u) + 7.0) - 0.5) * 0.004 * (1.0 - v)
        d = d + (0.005 * (1.0 - np.sqrt(np.maximum(0.0, 1.0 - v * v))) + 0.0012 * v2 ** 3 - full) * fade
    return d


def hair():
    hem = lambda P: hair_hem(np.arctan2(P[:, 1] - HC[1], P[:, 0] - HC[0])) - P[:, 2]  # noqa: E731
    inner = lambda P: hair_outer(P, grooves=False) + 0.016  # noqa: E731
    h = subtract(intersect(hair_outer, hem, k=0.006), inner, k=0.004)
    # a cowlick and a couple of tufts on the crown so the silhouette isn't a perfect bowl
    top = HC + V((0, 0, HR[2]))
    tufts = []
    for (dx, dy), (ex, ey, ez), r in (((0.012, 0.03), (0.03, 0.036, 0.04), 0.013), ((-0.016, 0.05), (-0.03, 0.046, 0.018), 0.009),
                                      ((0.0, 0.07), (0.006, 0.05, 0.012), 0.009)):
        a = top + V((dx, dy, -0.014))
        b = a + V((ex, ey, ez))
        mid = (a + b) / 2 + V((0, 0, 0.012))
        tufts.append(tube([a, mid, b], [r * 1.25, r * 0.7, 0.0022]))
    h = union(h, *tufts, k=0.006)
    part('hair', h, (-0.2, -0.19, 1.03), (0.2, 0.2, 1.47), 0.0018, 'hair', 'head', 10000)


# --- coat ---------------------------------------------------------------------------------------

COAT = [(0.186, 0.35), (0.18, 0.39), (0.176, 0.42), (0.165, 0.47), (0.15, 0.56), (0.139, 0.66), (0.141, 0.76),
        (0.146, 0.84), (0.142, 0.9), (0.125, 0.945), (0.085, 0.985), (0.05, 1.008)]
COAT_DEPTH = 0.8


def coat_folds(th, z):
    # soft folds swing out towards the hem, deeper at the back than across the buttoned front
    amp = 0.05 * smooth01v(0.68, 0.4, z) * (0.55 + 0.45 * (1 + np.sin(th)) / 2)
    return 1.0 + amp * (np.sin(5 * th + 0.9) + 0.35 * np.sin(9 * th + 2.3)) / 1.2


def coat_body():
    """The coat's outer surface (solid), without sleeves: pockets and straps are fitted to this."""
    return sdf.revolve(COAT, depth=COAT_DEPTH, rmod=coat_folds)


SH = {1: V((0.105, 0.0, 0.93))}
EL = {1: V((0.225, 0.0, 0.775))}
WR = {1: V((0.325, -0.01, 0.625))}
for _d in (SH, EL, WR):
    _d[-1] = _d[1] * V((-1, 1, 1))


def sleeve(s):
    sh, el, wr = SH[s], EL[s], WR[s]
    d0 = (el - sh) / np.linalg.norm(el - sh)
    d = (wr - el) / np.linalg.norm(wr - el)
    sl = tube([sh - d0 * 0.03 + V((-s * 0.012, 0, -0.012)), sh, (sh + el) / 2, el, (el + wr) / 2, wr - d * 0.004],
              [0.05, 0.053, 0.048, 0.046, 0.047, 0.05])
    # a soft fold inside the elbow
    sl = union(sl, ellipsoid(el + V((0, -0.03, 0.004)), (0.03, 0.016, 0.014), sdf.frame(d)), k=0.012)
    # a turned-back cuff, open so the wrist disappears into it
    R = sdf.frame(d)
    sl = union(sl, torus(wr - d * 0.014, 0.046, 0.012, R), k=0.008)
    return subtract(sl, cylinder(wr + d * 0.012, 0.034, 0.03, 0.0, R), k=0.005)


def hood():
    """The hood, down: a soft pocket of cloth lying on her shoulder blades, open towards her neck,
    with a rolled rim; and the collar standing round her neck."""
    R = sdf.rot(-14, 0, 0)
    outer = ellipsoid((0, 0.098, 0.912), (0.098, 0.046, 0.088), R)
    h = subtract(outer, offset(outer, -0.0075), k=0.002)
    cut = lambda P: (0.95 - 0.3 * (P[:, 1] - 0.1)) - P[:, 2]  # noqa: E731
    h = intersect(h, lambda P: -cut(P), k=0.003)
    rim = lambda P: np.maximum(np.abs(outer(P) + 0.0035) - 0.0058, np.abs(cut(P)) - 0.0058)  # noqa: E731
    h = union(h, rim, k=0.003)
    collar = torus((0, -0.002, 0.988), 0.064, 0.017, sdf.rot(10, 0, 0))
    return union(h, collar, k=0.012)


PLACKET_X = 0.012


def coat_full():
    body = coat_body()
    hem = lambda P: (0.392 - 0.006 * np.sin(5 * np.arctan2(P[:, 1], P[:, 0]) + 0.9)) - P[:, 2]  # noqa: E731
    # 12 mm of rubberised cotton, its outer face on `body` (everything on the coat is fitted to that)
    c = intersect(shell(offset(body, -0.006), 0.012), hem, k=0.004)
    # a vent up the back of the skirt, and a seam above it
    c = subtract(c, box((0, 0.16, 0.42), (0.0016, 0.06, 0.085), 0.0012), k=0.0025)

    # the overlapping front panel steps up a little along the opening
    def step(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        return 0.0025 * smooth01v(PLACKET_X + 0.003, PLACKET_X - 0.003, x) * smooth01v(-0.02, -0.06, y) * smooth01v(0.99, 0.96, z)
    c = sdf.displace(c, step)
    c = union(c, sleeve(1), sleeve(-1), k=0.022)
    return union(c, hood(), k=0.008)


def pocket_frame(body, s, z=0.53):
    th = math.radians(-90 + s * 46)
    p0 = V((math.cos(th) * 0.3, math.sin(th) * 0.3 * COAT_DEPTH, z))
    p = on(body, p0, -p0 * V((1, 1, 0)))
    n = normal(body, p)
    up = V((0, 0, 1)) - n * n[2]
    up /= np.linalg.norm(up)
    t = np.cross(up, n)
    return p, np.stack([t, n, up], axis=1)


def coat():
    body = coat_body()
    c = coat_full()
    pockets, flaps = [], []
    for s in (1, -1):
        p, R = pocket_frame(body, s)
        tilt = sdf.rot(0, s * 12, 0)
        R = R @ tilt
        pockets.append(intersect(offset(body, 0.0035), box(p, (0.046, 0.014, 0.036), 0.008, R), k=0.002))
        flaps.append(intersect(offset(body, 0.0065), box(p + R @ V((0, 0, 0.03)), (0.05, 0.018, 0.012), 0.007, R), k=0.002))
    c = union(c, *pockets, k=0.003)
    part('coat', c, (-0.39, -0.2, 0.37), (0.39, 0.2, 1.05), 0.0026, 'coat', 'coat', 11000)
    part('flaps', union(*flaps), (-0.2, -0.2, 0.5), (0.2, 0.0, 0.62), 0.0012, 'coat_dark', 'coatpart', 700)
    # placket down the front, and the buttons on it
    pl = intersect(shell(offset(body, 0.00325), 0.0045),
                   lambda P: np.abs(P[:, 0] - (PLACKET_X - 0.01)) - 0.0098,
                   lambda P: P[:, 1] + 0.02,
                   lambda P: np.maximum(0.405 - P[:, 2], P[:, 2] - 0.975), k=0.0015)
    part('placket', pl, (-0.03, -0.16, 0.38), (0.04, -0.03, 1.0), 0.0012, 'coat_dark', 'coatpart', 700)
    # a half belt across the back of the waist, buttoned at both ends
    belt = intersect(shell(offset(body, 0.0035), 0.005), lambda P: np.abs(P[:, 2] - 0.668) - 0.015,
                     lambda P: 0.05 - P[:, 1], lambda P: np.abs(P[:, 0]) - 0.078, k=0.003)
    part('belt', belt, (-0.1, 0.03, 0.62), (0.1, 0.16, 0.71), 0.0012, 'coat_dark', 'coatpart', 700)

    def button(p, n, r=0.0115):
        R = sdf.frame(n)
        b = cylinder(p + n * 0.0025, r, 0.0028, 0.0022, R)
        b = union(b, ellipsoid(p + n * 0.004, (r * 0.83, r * 0.83, 0.0025), R), k=0.002)
        return subtract(b, torus(p + n * 0.007, r * 0.48, 0.0011, R), k=0.001)
    buttons = []
    for z in (0.885, 0.775, 0.665):
        p = on(body, (PLACKET_X - 0.01, -0.3, z), (0, 1, 0))
        buttons.append(button(p + normal(body, p) * 0.0045, normal(body, p)))
    for x in (-0.066, 0.066):
        p = on(body, (x, 0.3, 0.668), (0, -1, 0))
        buttons.append(button(p + normal(body, p) * 0.006, normal(body, p), 0.009))
    part('buttons', union(*buttons), (-0.1, -0.16, 0.64), (0.1, 0.16, 0.91), 0.0006, 'button', 'coatpart', 900)
    return body


def scarf():
    ring = union(torus((0, -0.004, 1.0), 0.066, 0.024, sdf.rot(12, 0, 0)),
                 torus((0.003, 0.002, 1.023), 0.059, 0.02, sdf.rot(6, -5, 0)), k=0.01)
    knot = ellipsoid((0.04, -0.072, 0.982), (0.03, 0.022, 0.027), sdf.rot(0, 20, -15))

    def knit(P):
        # soft wool: a few lazy folds round the ring and a little lumpiness
        a = np.arctan2(P[:, 1], P[:, 0])
        return 0.0022 * np.sin(a * 7 + 0.4) * np.sin(a * 3 + 1.1) + 0.0016 * (sdf.noise(P, 90.0, 3) - 0.5)
    ring = sdf.displace(union(ring, knot, k=0.012), knit)
    part('scarf', ring, (-0.11, -0.11, 0.94), (0.11, 0.1, 1.07), 0.0016, 'scarf', 'scarf', 3500)
    # the tail hanging down her front: a flat knitted band ending in a fringe
    path = [V(p) for p in ((0.045, -0.088, 0.975), (0.05, -0.124, 0.92), (0.053, -0.132, 0.86), (0.057, -0.13, 0.795))]
    segs = []
    for a, b in zip(path, path[1:]):
        d = b - a
        R = sdf.frame(d, (1, 0, 0))
        segs.append(box((a + b) / 2, (0.026, 0.0085, np.linalg.norm(d) / 2 + 0.008), 0.0075, R))
    band = union(*segs, k=0.012)

    def ribs(P):
        return 0.0006 * np.abs(np.sin((P[:, 0] - 0.05) * 2 * np.pi / 0.0125)) + 0.0012 * (sdf.noise(P, 90.0, 5) - 0.5)
    band = sdf.displace(band, ribs)
    fringe = [cone((0.057 + dx, -0.13, 0.792), (0.057 + dx * 1.25, -0.128, 0.766 - abs(dx) * 0.2), 0.0042, 0.0026)
              for dx in (-0.018, -0.009, 0.0, 0.009, 0.018)]
    tail = union(band, *fringe, k=0.004)
    part('scarf_tail', tail, (-0.0, -0.16, 0.75), (0.1, -0.06, 1.0), 0.0014, 'scarf', 'scarftail', 2000)


def satchel(body):
    B = V((-0.19, 0.0, 0.6))
    R = sdf.rot(-8, 0, 0)
    bag = union(box(B, (0.02, 0.066, 0.052), 0.014, R), ellipsoid(B, (0.025, 0.06, 0.047), R), k=0.008)
    part('satchel', bag, B - 0.09, B + 0.09, 0.0012, 'bag', 'bag', 1400)

    # the flap folds over the top and down the outside, rounded at the bottom
    def region(P):
        q = sdf._local(P, B, R)
        return (-0.03 + 0.02 * (q[:, 1] / 0.066) ** 2) - q[:, 2]
    flap = intersect(shell(offset(bag, 0.0022), 0.0036), region, k=0.0015)
    part('satchel_flap', flap, B - 0.09, B + 0.09, 0.001, 'strap', 'bag', 1000)
    bk = B + R @ V((-0.026, 0.0, -0.022))
    buckle = subtract(box(bk, (0.004, 0.013, 0.011), 0.003, R), box(bk + R @ V((-0.004, 0, 0)), (0.004, 0.008, 0.006), 0.001, R), k=0.001)
    part('satchel_buckle', buckle, bk - 0.03, bk + 0.03, 0.0005, 'buckle', 'bag', 300)
    # the strap runs from the bag across her front, over her left shoulder and down her back,
    # fitted to the coat as it goes
    pts = []
    for k in range(33):
        u = k / 32
        th = math.radians(-152 + 304 * u)
        z = 0.665 + 0.315 * math.sin(math.pi * u) ** 1.35
        p0 = V((math.cos(th) * 0.3, math.sin(th) * 0.3, z))
        pts.append(on(body, p0, -p0 * V((1, 1, 0.2))))
    pl = sdf.polyline_dist(pts)
    coat_s = union(body, hood())
    strap = intersect(lambda P: np.abs(coat_s(P) - 0.0055) - 0.0026, lambda P: pl(P) - 0.0115, k=0.0012)
    # where it leaves the coat it hangs straight down to the ends of the bag
    ends = []
    for end, tip in ((B + R @ V((0.0, -0.058, 0.04)), pts[0]), (B + R @ V((0.0, 0.058, 0.04)), pts[-1])):
        along = tip - end
        nrm = R @ V((0, -1 if end[1] < B[1] else 1, 0))
        Rr = sdf.frame(along, np.cross(nrm, along))
        ends.append(box((end + tip) / 2, (0.0115, 0.0026, np.linalg.norm(along) / 2 + 0.006), 0.0018, Rr))
    strap = union(strap, *ends, k=0.004)
    part('strap', strap, (-0.25, -0.2, 0.6), (0.2, 0.2, 1.06), 0.0014, 'strap', 'strap', 1500)


# --- limbs ---------------------------------------------------------------------------------------

def hand_frame(s):
    d = WR[s] - EL[s]
    d /= np.linalg.norm(d)
    n = V((-s, 0, 0)) - d * np.dot(d, V((-s, 0, 0)))
    n /= np.linalg.norm(n)
    w = np.cross(d, n) * -s
    if w[1] > 0:
        w = -w
    return d, n, w


def rot_toward(v, to, ang):
    """Rotate unit vector v towards `to` by ang degrees (in their common plane)."""
    a = math.radians(ang)
    t = to - v * np.dot(v, to)
    t /= np.linalg.norm(t)
    return v * math.cos(a) + t * math.sin(a)


def hand(s, side):
    d, n, w = hand_frame(s)
    hc = WR[s] + d * 0.036
    palm = box(hc, (0.0155, 0.026, 0.026), 0.0135, np.stack([n, w, d], axis=1))
    wrist = cone(WR[s] - d * 0.025, hc - d * 0.012, 0.0185, 0.02)
    fingers = []
    for i, (L, sp) in enumerate(((1.0, 1.0), (1.08, 0.33), (1.02, -0.33), (0.86, -1.0))):
        base = hc + d * 0.019 + w * (0.0158 * sp) + n * 0.0012
        dirn = rot_toward(d, n, 6 + i * 4)
        dirn = dirn + w * 0.14 * sp
        dirn /= np.linalg.norm(dirn)
        p1 = base + dirn * 0.025 * L
        d2 = rot_toward(dirn, n, 20 + i * 3)
        p2 = p1 + d2 * 0.017 * L
        d3 = rot_toward(d2, n, 18 + i * 3)
        p3 = p2 + d3 * 0.0135 * L
        r = 0.0074 if i < 3 else 0.0066
        fingers.append(tube([base, p1, p2, p3], [r, r * 0.95, r * 0.88, r * 0.84]))
    t0 = hc + w * 0.017 + n * 0.008 - d * 0.014
    t1 = t0 + sdf.V(rot_toward(w, d, 38) + n * 0.3) * 0.02
    t2 = t1 + sdf.V(rot_toward(w, d, 60) + n * 0.5) * 0.016
    thumb = tube([t0, t1, t2], [0.0104, 0.0088, 0.0078])
    f = union(palm, wrist, k=0.01)
    f = union(f, union(*fingers, k=0.0012), k=0.0075)
    f = union(f, thumb, k=0.008)
    c = hc + d * 0.02
    part(f'hand_{side}', f, c - 0.075, c + 0.075, 0.0011, 'skin', f'hand_{side}', 2400)


def legs():
    for s, side in ((1, 'L'), (-1, 'R')):
        x = s * 0.075
        leg = tube([(s * 0.07, 0, 0.64), (x, -0.004, 0.47), (x, -0.008, 0.335), (x, -0.002, 0.2), (x, 0.004, 0.11)],
                   [0.061, 0.052, 0.045, 0.039, 0.035])
        part(f'leg_{side}', leg, (x - 0.08, -0.08, 0.06), (x + 0.08, 0.08, 0.72), 0.0026, 'leggings', f'leg_{side}', 1400)
        # rubber boot: a wide shaft with a rolled rim, a round toe and a chunky sole
        shaft = cone((x, 0.006, 0.06), (x, 0.004, 0.258), 0.05, 0.056)
        foot = union(ellipsoid((x, -0.042, 0.05), (0.053, 0.086, 0.05)), ellipsoid((x, 0.012, 0.045), (0.05, 0.05, 0.045)), k=0.02)
        b = union(shaft, foot, k=0.03)
        b = union(b, torus((x, 0.004, 0.259), 0.053, 0.0075), k=0.005)
        b = subtract(b, cylinder((x, 0.004, 0.3), 0.045, 0.045, 0.0), k=0.006)
        b = intersect(b, lambda P: 0.018 - P[:, 2], k=0.003)
        # a pull tab at the back of the shaft
        tab = subtract(box((x, 0.058, 0.252), (0.011, 0.005, 0.016), 0.004), box((x, 0.058, 0.256), (0.005, 0.01, 0.007), 0.002), k=0.001)
        b = union(b, tab, k=0.004)
        part(f'boot_{side}', b, (x - 0.08, -0.15, 0.0), (x + 0.08, 0.09, 0.29), 0.0018, 'boots', f'boot_{side}', 3000)
        prof = union(ellipsoid((x, -0.044, 0.0), (0.058, 0.092, 1.0)), ellipsoid((x, 0.012, 0.0), (0.055, 0.055, 1.0)), k=0.02)
        sole = intersect(prof, lambda P: np.abs(P[:, 2] - 0.0125) - 0.0125, k=0.004)
        # tread on the bottom
        sole = subtract(sole, lambda P: np.maximum(np.abs(((P[:, 1] + 0.3) % 0.022) - 0.011) - 0.0035, P[:, 2] - 0.004), k=0.0015)
        part(f'sole_{side}', sole, (x - 0.08, -0.16, -0.01), (x + 0.08, 0.09, 0.04), 0.0014, 'sole', f'boot_{side}', 900)


def pencil(tip, end, kind):
    d = (end - tip).normalized()
    L = (end - tip).length
    p0, p1, p2 = tip + d * 0.026, tip + d * (L - 0.03), tip + d * (L - 0.017)
    parts = [lib.tube('pencil_body', [p0, p1], [0.0095, 0.0095], M('pencil'), sides=6, cap=False, subsurf=0),
             lib.tube('pencil_wood', [tip + d * 0.007, p0], [0.0038, 0.0095], M('wood'), sides=12, cap=False, subsurf=0),
             lib.tube('pencil_lead', [tip, tip + d * 0.008], [0.0009, 0.004], M('graphite'), sides=12, cap=False, subsurf=0),
             lib.tube('pencil_ferrule', [p1, p2], [0.0103, 0.0103], M('ferrule'), sides=16, cap=False, subsurf=0),
             lib.tube('pencil_eraser', [p2, end], [0.0098, 0.009], M('eraser'), sides=16, subsurf=0)]
    return tag(parts, kind)


# --- paint ---------------------------------------------------------------------------------------

def tint(p, kind, mname):
    """Hand-painted variation, multiplied over each material's colour in the game."""
    one = (1.0, 1.0, 1.0)
    if mname == 'ada_skin':
        c = one
        for s in (1, -1):
            d = (p - Vector((s * 0.084, -0.118, 1.148))).length
            b = math.exp(-(d / 0.028) ** 2) * 0.7
            c = (c[0], c[1] * (1 - 0.18 * b), c[2] * (1 - 0.2 * b))
        # warmer nose tip and knuckles
        dn = (p - Vector((0, -0.152, 1.168))).length
        b = math.exp(-(dn / 0.012) ** 2) * 0.5
        return (c[0], c[1] * (1 - 0.12 * b), c[2] * (1 - 0.14 * b))
    if mname == 'ada_iris':
        c = IRIS_C['L' if p.x > 0 else 'R']
        dx, dz = (p.x - c[0]) / IRIS[0], (p.z - c[2]) / IRIS[1]
        r = math.hypot(dx, dz)
        rp = r / PUPIL
        # darker under the lid, lighter where light falls into the lower iris, a dark rim, a black pupil
        k = (0.6 + 0.4 * smooth01(0.7, -0.6, dz)) * (1 - 0.4 * smooth01(0.78, 1.0, r))
        k *= 0.16 if rp < 1.0 else 1.0
        return (k, k * 0.97, k * 0.95)
    if mname == 'ada_hair':
        # each lock its own shade, the partings between them painted darker
        q = p - Vector(tuple(HC))
        th = np.array([math.atan2(q.y, q.x)])
        _, u = lock_u(th)
        v = float(1.0 - tri(u + 0.5)[0])
        fade = smooth01(0.97, 0.82, q.z / max(q.length, 1e-6))
        lock = 1.0 + (float(lock_hash(np.round(u) + 3.0)[0]) - 0.5) * 0.12
        part_k = (1.0 - 0.3 * v ** 3 * fade) * lock
        k = (0.84 + 0.16 * smooth01(1.08, 1.22, p.z)) * part_k
        sheen = math.exp(-((p.z - 1.335) / 0.022) ** 2) * smooth01(0.0, -0.05, p.y - 0.06) * (1 - v)
        return (k + 0.22 * sheen, k + 0.2 * sheen, k + 0.18 * sheen)
    if mname == 'ada_coat':
        k = 0.93 + 0.07 * smooth01(0.4, 0.62, p.z)
        return (k, k, k * 0.98)
    if mname == 'ada_boots':
        k = 0.9 + 0.1 * smooth01(0.03, 0.12, p.z)
        return (k, k, k)
    if mname == 'ada_scarf':
        k = 0.95 + 0.05 * math.sin(p.z * 180)
        return (k, k, k)
    return one


def ao_col(a):
    """Occlusion as a cool wash, never black."""
    t = max(0.0, min(1.0, (a - 0.25) / 0.75)) ** 0.9
    return (0.62 + 0.38 * t, 0.64 + 0.36 * t, 0.76 + 0.24 * t)


def paint_all(parts, ao):
    for ob in parts:
        me = ob.data
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        mname = me.materials[0].name
        a = None if mname in ('ada_eye_white', 'ada_iris', 'ada_eye_hi', 'ada_lash') else ao.get(ob.name)
        kind = ob['kind']
        cols = np.empty((len(me.vertices), 4))
        for i, v in enumerate(me.vertices):
            c = tint(ob.matrix_world @ v.co, kind, mname)
            o = ao_col(a[i]) if a is not None else (1, 1, 1)
            cols[i] = (c[0] * o[0], c[1] * o[1], c[2] * o[2], 1.0)
        attr.data.foreach_set('color', cols.astype(np.float32).ravel())
        me.color_attributes.active_color_name = 'Col'
        me.color_attributes.render_color_index = me.color_attributes.active_color_index


# --- rig -----------------------------------------------------------------------------------------

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
        d = (WR[s] - EL[s]) / np.linalg.norm(WR[s] - EL[s])
        B += [(f'eye_{side}', (s * 0.057, -0.13, 1.176), (s * 0.057, -0.13, 1.216), 'head'),
              (f'shoulder_{side}', (s * 0.03, 0, 0.92), tuple(SH[s]), 'chest'),
              (f'upperarm_{side}', tuple(SH[s]), tuple(EL[s]), f'shoulder_{side}'),
              (f'forearm_{side}', tuple(EL[s]), tuple(WR[s]), f'upperarm_{side}'),
              (f'hand_{side}', tuple(WR[s]), tuple(WR[s] + d * 0.09), f'forearm_{side}'),
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
    n = smooth01(0.975, 1.005, z) * smooth01(0.06, -0.02, y)
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


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length, t


def coat_sleeve_weights(segs):
    """The coat body follows the torso and hips; the sleeves (blended into it) follow the arms."""
    def fn(p):
        side = 'L' if p.x > 0 else 'R'
        sh, el = segs[f'upperarm_{side}']
        wr = segs[f'forearm_{side}'][1]
        d = min(seg_dist(p, sh, el)[0], seg_dist(p, el, wr)[0])
        along = (p - sh).dot((el - sh).normalized())
        m = smooth01(-0.025, 0.03, along) * smooth01(0.085, 0.058, d)
        body = coat_weights(p)
        if m <= 0.0:
            return body
        arm = lib.dist_weights(p, {b: segs[b] for b in ('chest', f'shoulder_{side}', f'upperarm_{side}', f'forearm_{side}', f'hand_{side}')},
                               {'chest': 0.3, f'hand_{side}': 0.05}, 6.0)
        s = sum(arm.values())
        out = {b: v * (1 - m) for b, v in body.items()}
        for b, v in arm.items():
            out[b] = out.get(b, 0.0) + m * v / s
        return out
    return fn


def head_weights(p):
    x, y, z = p
    r = math.hypot(x, y - 0.01)
    hw = max(smooth01(1.04, 1.1, z), smooth01(0.05, 0.075, r) * smooth01(1.0, 1.05, z))
    cw = smooth01(1.0, 0.95, z) * (1 - hw)
    return {'head': hw, 'chest': cw, 'neck': max(0.0, 1 - hw - cw)}


def weight_fn(kind, segs):
    def seg(*names, mult=None, power=5.0):
        sub = {n: segs[n] for n in names}
        return lambda p: lib.dist_weights(p, sub, mult, power)
    if kind == 'head':
        return head_weights
    if kind == 'pencil_ear':
        return lambda p: {'head': 1.0}
    if kind in ('eye_L', 'eye_R', 'mouth', 'bag'):
        return lambda p: {kind: 1.0}
    if kind == 'pencil_hand':
        return lambda p: {'hand_R': 1.0}
    if kind == 'coat':
        return coat_sleeve_weights(segs)
    if kind == 'coatpart':
        return coat_weights
    if kind == 'scarf':
        return seg('chest', 'neck', mult={'chest': 0.6})
    if kind == 'scarftail':
        return seg('scarf1', 'scarf2', power=4)
    if kind == 'strap':
        def strap(p):
            w = coat_weights(p)
            b = smooth01(0.06, 0.03, (p - segs['bag'][1]).length)
            w = {k: v * (1 - b) for k, v in w.items()}
            w['bag'] = b
            return w
        return strap
    side = kind[-1]
    if kind.startswith('hand'):
        return lambda p: {f'hand_{side}': 1.0}
    if kind.startswith('leg'):
        return seg('hips', f'thigh_{side}', f'shin_{side}', mult={'hips': 0.5}, power=6)
    if kind.startswith('boot'):
        return seg(f'shin_{side}', f'foot_{side}', power=6)
    raise ValueError(kind)


def build():
    lib.reset()
    PARTS.clear()
    bpy.context.scene.render.fps = 30
    head()
    hair()
    body = coat()
    scarf()
    satchel(body)
    for s, side in ((1, 'L'), (-1, 'R')):
        hand(s, side)
    legs()
    pencil(Vector((-0.192, -0.075, 1.16)), Vector((-0.186, 0.075, 1.225)), 'pencil_ear')
    # the pencil she draws with: in her right fist, lead pointing forwards and down
    d = Vector(tuple((WR[-1] - EL[-1]) / np.linalg.norm(WR[-1] - EL[-1])))
    hc = Vector(tuple(WR[-1])) + d * 0.05
    pd = (Vector((0, -1, 0)) * 0.5 + d * 0.85).normalized()
    for ob in pencil(hc + pd * 0.085, hc - pd * 0.07, 'pencil_hand'):
        ob.hide_render = True  # it would shadow her hand in the AO bake
    ao = sdf.bake_ao([o for o in PARTS if not o['kind'].startswith('pencil')], distance=0.07, samples=64)
    paint_all(PARTS, ao)
    arm = lib.armature('ada_rig', bones())
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    for ob in PARTS:
        lib.set_weights(ob, weight_fn(ob['kind'], segs))
    body = [o for o in PARTS if not o['kind'].startswith('pencil')]
    ear = [o for o in PARTS if o['kind'] == 'pencil_ear']
    held = [o for o in PARTS if o['kind'] == 'pencil_hand']
    meshes = [lib.join(body, 'ada'), lib.join(ear, 'ada_pencil_ear'), lib.join(held, 'ada_pencil_hand')]
    for ob in meshes:
        ob.hide_render = False
        lib.bind(ob, arm)
    print('ada:', sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons), 'tris')
    return arm, meshes


VIEW = {'front': (-25, 2.4, (0, 0, 0.72)), 'back': (150, 2.4, (0, 0, 0.72)), 'side': (-90, 2.4, (0, 0, 0.72)),
        'face': (0, 0.75, (0, 0, 1.19)), 'face3q': (-35, 0.75, (0, 0, 1.19)), 'hands': (-60, 0.9, (0.25, 0, 0.66)),
        'feet': (-30, 1.0, (0, 0, 0.2)), 'top': (-30, 1.4, (0, 0, 1.0)), 'hand': (70, 0.36, (0.34, -0.01, 0.6)),
        'backc': (180, 1.3, (0, 0, 0.75))}


def rest_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    arm, meshes = build()
    import ada_anims  # noqa: E402
    ada_anims.author(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        rest_pose(arm)
        meshes[2].hide_render = True
        for name in os.environ.get('VIEWS', 'front,back,side,face,face3q').split(','):
            yaw, dist, tgt = VIEW[name]
            lib.preview(out.replace('.png', f'_{name}.png'), target=tgt, dist=dist, yaw=yaw, pitch=6, size=(700, 900), lens=55)
    if '--poses' in argv:
        ada_anims.contact_sheet(arm, meshes, argv[argv.index('--poses') + 1])
    if '--export' in argv:
        rest_pose(arm)
        lib.export_glb(os.path.join(lib.MODELS, 'ada.glb'), [arm] + meshes)
