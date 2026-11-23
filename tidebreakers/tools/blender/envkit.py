"""Environment kits (scenery pieces as named meshes in one GLB per kit).

    blender -b -P envkit.py -- <kit|all> [--preview]

Pieces are modelled directly (bmesh boxes with bevels, lofted hulls, tubes, rings, sculpted rocks) and
painted per vertex: COLOR_0 = albedo + wind sway (alpha), TEXCOORD_1 = (ambient occlusion, surface
class / 20). The tbEnv shader turns the class into painted wood grain, stone courses, roof tiles...
AO is ray-traced per vertex against the piece itself (BVH, 10 rays).
"""
import os
import sys
import math
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402
from tb import sdf, polychar as pc, bl  # noqa: E402
from tb.character import srgb, _set_uv  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'assets', 'env')
ART = os.path.join(ROOT, 'docs', 'art', 'env')
E = dict(plain=0, wood=1, stone=2, roof=3, plaster=4, foliage=5, metal=6, rock=7, brick=8, sand=9, glow=10, cloth=11, marble=12, coral=13)


def v(*a):
    return np.array(a, float)


class Piece:
    """Accumulates sub-meshes with colour / class / sway, then becomes one Blender object."""

    def __init__(self, name):
        self.name = name
        self.V, self.F, self.C, self.K, self.S = [], [], [], [], []

    def add(self, V, F, color, cls='plain', sway=0.0):
        V = np.asarray(V, float)
        off = sum(len(x) for x in self.V)
        self.V.append(V)
        self.F += [tuple(i + off for i in f) for f in F]
        c = srgb(color) if isinstance(color, str) else np.asarray(color, float)
        if c.ndim == 1:
            c = np.tile(c, (len(V), 1))
        self.C.append(c)
        self.K.append(np.full(len(V), E[cls]))
        self.S.append(np.broadcast_to(np.asarray(sway, float), (len(V),)).copy())
        return self

    def arrays(self):
        return np.concatenate(self.V), self.F, np.concatenate(self.C), np.concatenate(self.K), np.concatenate(self.S)


# ------------------------------------------------------------------------------------------ primitives

def box(c, half, rot=0.0, bevel=0.02, R=None):
    if R is None:
        R = sdf.rot_z(rot)
    return pc.box_mesh(np.asarray(c, float), half, R, bevel=bevel)


def cyl(a, b, r0, r1=None, n=12, caps=True):
    r1 = r0 if r1 is None else r1
    pts = [np.asarray(a, float), (np.asarray(a, float) + np.asarray(b, float)) / 2, np.asarray(b, float)]
    return pc.tube(pts, [r0, (r0 + r1) / 2, r1], n=n, cap_tip=caps, cap_root=caps)


def prism_roof(c, w, d, h, over=0.25, thick=0.12, axis='x'):
    """Gable roof: two slabs meeting at the ridge (along x)."""
    out = []
    cx, cy, cz = c
    for s in (1, -1):
        ang = math.atan2(h, d / 2 + over)
        L = math.hypot(d / 2 + over, h)
        mid = v(cx, cy + s * (d / 4 + over / 2) * 1.0, cz + h / 2 - over * math.tan(ang) / 2)
        R = sdf.rot_x(-s * ang) if axis == 'x' else sdf.rot_y(s * ang)
        out.append(pc.box_mesh(mid, ((w / 2 + over), L / 2, thick / 2), R, bevel=0.02))
    return out


def rock_mesh(seed, size=(1, 1, 0.8), res=0.06, detail=0.25):
    f = sdf.Ellipsoid(v(0, 0, 0), v(*size))
    g = lambda p: sdf.fbm(p, 1.6, 4, seed) * detail * min(size) + sdf.value_noise(p, 5.0, seed + 9) * 0.03  # noqa
    f = sdf.Displace(f, g, detail * min(size) * 1.2)
    f = sdf.Intersect([f, sdf.Plane(v(0, 0, -1), v(0, 0, -size[2] * 0.55))])
    V, Q = sdf.mesh_field(f, res=res, verbose=False)
    return V, [tuple(q) for q in Q]


def blob_mesh(centers, radii, res=0.07, k=0.12, seed=0, noise=0.08):
    f = sdf.Union([sdf.Sphere(c, r) for c, r in zip(centers, radii)], k)
    f = sdf.Displace(f, lambda p: sdf.fbm(p, 3.0, 3, seed) * noise, noise)
    V, Q = sdf.mesh_field(f, res=res, verbose=False)
    return V, [tuple(q) for q in Q]


def frond(base, direction, length, width, droop, n=6):
    """A palm frond: a flat strip with a midrib, drooping."""
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    pts = []
    p = np.asarray(base, float)
    cur = d.copy()
    for i in range(n):
        pts.append(p.copy())
        cur = cur + v(0, 0, -droop / n)
        cur /= np.linalg.norm(cur)
        p = p + cur * (length / (n - 1))
    w = [width * math.sin(math.pi * (i + 0.6) / (n + 0.4)) for i in range(n)]
    side = np.cross(d, [0, 0, 1.0])
    side /= max(np.linalg.norm(side), 1e-6)
    nrm = np.cross(side, d)
    return pc.tube(np.array(pts), w, n=4, normals=np.tile(nrm, (n, 1)), flat=0.08, cap_tip=True, cap_root=True)


def hull(length, beam, depth, n=14, rings=11, sheer=0.25, flat_stern=True):
    """A boat hull: rings across the length, V-bottomed, pinched bow, open on top (deck added separately)."""
    V, F, R = [], [], []
    for i in range(rings):
        t = i / (rings - 1)                      # 0 stern .. 1 bow
        x = (t - 0.5) * length
        width = beam * (max(math.sin(math.pi * min(t * 1.08, 1.0)), 0.0) ** 0.55 if t > 0.5 else (0.75 + 0.25 * math.sin(math.pi * t)))
        width = max(width, 0.02)
        dep = depth * (0.85 + 0.15 * math.sin(math.pi * t))
        top = sheer * (2 * (t - 0.5)) ** 2 + depth * 0.1
        ring = []
        for k in range(n):
            a = math.pi * k / (n - 1)               # half ring from port gunwale through keel to starboard
            y = -math.cos(a) * width / 2
            z = top - max(math.sin(a), 0.0) ** 0.8 * dep
            ring.append(len(V))
            V.append(v(x, y, z))
        R.append(ring)
    for r0, r1 in zip(R[:-1], R[1:]):
        for k in range(n - 1):
            F.append((r0[k], r0[k + 1], r1[k + 1], r1[k]))
    # transom (stern) cap
    if flat_stern:
        r0 = R[0]
        c = len(V)
        V.append(np.mean([V[i] for i in r0], axis=0))
        for k in range(n - 1):
            F.append((r0[k + 1], r0[k], c, c))
    return pc.shell(np.array(V), F, 0.05)


# ------------------------------------------------------------------------------------------ Gull's Rest

def cottage(name, w=4.2, d=3.4, h=2.6, roof='#c4553a', wall='#efe2c6', base='#8f8a80', trim='#5a3d2a', door='#3d6c8c', chimney=True, seed=0):
    p = Piece(name)
    p.add(*box(v(0, 0, 0.35), (w / 2 + 0.08, d / 2 + 0.08, 0.35), bevel=0.06), base, 'stone')
    p.add(*box(v(0, 0, 0.7 + h / 2), (w / 2, d / 2, h / 2), bevel=0.04), wall, 'plaster')
    # timber frame: corner posts and beams
    for sx in (1, -1):
        for sy in (1, -1):
            p.add(*box(v(sx * (w / 2 - 0.02), sy * (d / 2 - 0.02), 0.7 + h / 2), (0.1, 0.1, h / 2 + 0.02), bevel=0.02), trim, 'wood')
    for z in (0.75, 0.7 + h):
        p.add(*box(v(0, -d / 2 - 0.02, z), (w / 2 + 0.05, 0.08, 0.08), bevel=0.02), trim, 'wood')
        p.add(*box(v(0, d / 2 + 0.02, z), (w / 2 + 0.05, 0.08, 0.08), bevel=0.02), trim, 'wood')
    # door and windows (front = -Y)
    p.add(*box(v(-w * 0.2, -d / 2 - 0.03, 0.7 + 1.0), (0.48, 0.06, 1.0), bevel=0.03), door, 'wood')
    p.add(*box(v(-w * 0.2, -d / 2 - 0.05, 0.7 + 2.05), (0.6, 0.08, 0.08), bevel=0.02), trim, 'wood')
    for wx in (w * 0.22,):
        p.add(*box(v(wx, -d / 2 - 0.03, 0.7 + 1.5), (0.45, 0.05, 0.42), bevel=0.02), '#33424e', 'glow' if seed % 3 == 0 else 'plain')
        p.add(*box(v(wx, -d / 2 - 0.06, 0.7 + 1.5), (0.5, 0.04, 0.04), bevel=0.01), trim, 'wood')
        p.add(*box(v(wx, -d / 2 - 0.06, 0.7 + 1.5), (0.04, 0.04, 0.46), bevel=0.01), trim, 'wood')
        p.add(*box(v(wx, -d / 2 - 0.12, 0.7 + 1.0), (0.52, 0.12, 0.05), bevel=0.02), trim, 'wood')
    for side in (1, -1):
        p.add(*box(v(side * (w / 2 + 0.03), 0, 0.7 + 1.5), (0.05, 0.4, 0.4), bevel=0.02), '#33424e', 'plain')
    # gable ends and roof
    gh = 1.5
    for sy in (1, -1):
        tri_v = np.array([[-w / 2, sy * 0, 0.7 + h], [w / 2, 0, 0.7 + h], [0, 0, 0.7 + h + gh]], float)
        _ = tri_v
    gable = []
    for sx in (1, -1):
        gV = np.array([[sx * w / 2, -d / 2, 0.7 + h], [sx * w / 2, d / 2, 0.7 + h], [sx * w / 2, 0, 0.7 + h + gh]], float)
        gable.append(pc.shell(gV, [(0, 1, 2, 2)], 0.06))
    for g in gable:
        p.add(*g, wall, 'plaster')
    for r in prism_roof(v(0, 0, 0.7 + h), w, d, gh, over=0.35, thick=0.16):
        p.add(*r, roof, 'roof')
    p.add(*box(v(0, 0, 0.7 + h + gh + 0.02), (w / 2 + 0.38, 0.1, 0.07), bevel=0.03), trim, 'wood')
    if chimney:
        p.add(*box(v(w * 0.28, d * 0.15, 0.7 + h + gh * 0.6), (0.25, 0.25, gh * 0.75), bevel=0.04), base, 'stone')
    # flower box / barrel by the door
    p.add(*cyl(v(w * 0.42, -d / 2 - 0.45, 0), v(w * 0.42, -d / 2 - 0.45, 0.9), 0.32, 0.3, n=10), '#7a5232', 'wood')
    return p


def lighthouse():
    p = Piece('lighthouse')
    H = 16.0
    rings = 9
    for i in range(rings):
        z0, z1 = H * i / rings, H * (i + 1) / rings
        r0, r1 = 2.3 - 0.9 * (i / rings), 2.3 - 0.9 * ((i + 1) / rings)
        col = '#f4efe6' if i % 2 == 0 else '#c8383a'
        p.add(*cyl(v(0, 0, z0), v(0, 0, z1), r0, r1, n=20, caps=False), col, 'plaster')
    p.add(*cyl(v(0, 0, -0.5), v(0, 0, 0.6), 2.8, 2.7, n=20), '#8f8a80', 'stone')
    p.add(*cyl(v(0, 0, H), v(0, 0, H + 0.3), 2.1, 2.1, n=20), '#3a3a40', 'metal')
    # gallery railing
    for k in range(16):
        a = 2 * math.pi * k / 16
        p.add(*cyl(v(math.cos(a) * 2.0, math.sin(a) * 2.0, H + 0.3), v(math.cos(a) * 2.0, math.sin(a) * 2.0, H + 1.2), 0.04, n=6), '#2a2a30', 'metal')
    from tb.wardrobe import disc
    p.add(*disc(v(0, 0, H + 1.2), 2.05, 1.9, n=24, thick=0.05), '#2a2a30', 'metal')
    p.add(*cyl(v(0, 0, H + 0.3), v(0, 0, H + 2.4), 1.15, 1.15, n=16, caps=False), '#ffe9a8', 'glow')
    for k in range(8):
        a = 2 * math.pi * k / 8
        p.add(*cyl(v(math.cos(a) * 1.18, math.sin(a) * 1.18, H + 0.3), v(math.cos(a) * 1.18, math.sin(a) * 1.18, H + 2.4), 0.05, n=6), '#2a2a30', 'metal')
    p.add(*cyl(v(0, 0, H + 2.4), v(0, 0, H + 3.6), 1.4, 0.15, n=16), '#c8383a', 'metal')
    p.add(*cyl(v(0, 0, H + 3.6), v(0, 0, H + 4.2), 0.08, 0.02, n=6), '#2a2a30', 'metal')
    # door
    p.add(*box(v(0, -2.15, 1.3), (0.6, 0.25, 1.1), bevel=0.05), '#3d6c8c', 'wood')
    return p


def keeper_house():
    p = cottage('keeperhouse', w=5.0, d=4.0, h=2.8, roof='#3f5f8a', wall='#f4efe6', door='#c8383a', seed=3)
    return p


def dock(n=6):
    p = Piece('dock')
    L = 2.0 * n
    p.add(*box(v(0, L / 2, 0.0), (1.6, L / 2, 0.08), bevel=0.02), '#9a7a58', 'wood')
    for i in range(n + 1):
        for sx in (1, -1):
            p.add(*cyl(v(sx * 1.55, i * 2.0, -3.0), v(sx * 1.55, i * 2.0, 0.6), 0.16, 0.14, n=8), '#6a5038', 'wood')
    for sx in (1, -1):
        p.add(*box(v(sx * 1.55, L / 2, 0.55), (0.06, L / 2, 0.06), bevel=0.01), '#7a5a40', 'wood')
    return p


def boardwalk(length=8.0, width=2.4):
    p = Piece('boardwalk')
    p.add(*box(v(0, 0, 0), (width / 2, length / 2, 0.08), bevel=0.02), '#a2805c', 'wood')
    for y in np.linspace(-length / 2, length / 2, 5):
        for sx in (1, -1):
            p.add(*cyl(v(sx * (width / 2 - 0.1), y, -2.5), v(sx * (width / 2 - 0.1), y, 0.0), 0.13, n=8), '#6a5038', 'wood')
    return p


def rowboat():
    p = Piece('rowboat')
    p.add(*hull(4.2, 1.5, 0.6, sheer=0.18), '#c96a3a', 'wood')
    for x in (-0.6, 0.5):
        p.add(*box(v(x, 0, -0.15), (0.12, 0.7, 0.04), bevel=0.01), '#9a7a58', 'wood')
    p.add(*box(v(0, 0, -0.08), (2.0, 0.03, 0.05), bevel=0.01), '#f4efe6', 'wood')
    return p


def wren():
    """The crew's sloop: a single mast, an orange sail, a wren figurehead."""
    p = Piece('wren')
    p.add(*hull(11.0, 3.6, 1.8, sheer=0.55), '#2f5e86', 'wood')
    p.add(*box(v(0, 0, -0.1), (5.2, 1.7, 0.08), bevel=0.02), '#c9a272', 'wood')                 # deck
    p.add(*box(v(-4.2, 0, 0.5), (1.0, 1.6, 0.6), bevel=0.05), '#8a5a36', 'wood')                # cabin
    p.add(*box(v(-4.2, 0, 1.15), (1.15, 1.75, 0.08), bevel=0.03), '#c8383a', 'wood')
    p.add(*cyl(v(0.6, 0, -0.1), v(0.6, 0, 9.0), 0.16, 0.1, n=10), '#7a5232', 'wood')            # mast
    p.add(*cyl(v(0.6, 0, 2.2), v(-3.6, 0, 2.2), 0.09, n=8), '#7a5232', 'wood')                  # boom
    sail = []
    sv = np.array([[0.55, 0, 2.3], [0.55, 0, 8.6], [-3.5, 0, 2.3], [-1.0, 0, 6.0]], float)
    sail.append(pc.shell(sv[[0, 1, 3, 2]], [(0, 1, 2, 3)], 0.04))
    for s in sail:
        p.add(*s, '#f39a3a', 'cloth', sway=0.3)
    jib = np.array([[0.65, 0, 8.4], [5.2, 0, 0.8], [0.65, 0, 1.4], [0.65, 0, 4.0]], float)
    p.add(*pc.shell(jib[[0, 3, 2, 1]], [(0, 1, 2, 3)], 0.04), '#f7e8c8', 'cloth', sway=0.3)
    # figurehead: a little wren
    body = pc.quad_sphere(v(5.6, 0, 0.75), (0.45, 0.28, 0.32), res=3)
    head = pc.quad_sphere(v(5.95, 0, 1.0), (0.2, 0.17, 0.18), res=3)
    beak = cyl(v(6.1, 0, 1.0), v(6.35, 0, 0.98), 0.06, 0.005, n=6)
    tail = box(v(5.2, 0, 1.0), (0.25, 0.08, 0.05), rot=0, bevel=0.02)
    for m, c in ((body, '#8a5a36'), (head, '#8a5a36'), (beak, '#e0a83a'), (tail, '#6a4228')):
        p.add(*m, c, 'wood')
    p.add(*cyl(v(-5.3, 0, 0.4), v(-5.3, 0, 1.4), 0.08, n=6), '#2a2a30', 'metal')               # stern lantern post
    p.add(*pc.quad_sphere(v(-5.3, 0, 1.55), (0.15, 0.15, 0.2), res=2), '#ffd27a', 'glow')
    for x in np.linspace(-4.5, 4.5, 10):
        for sy in (1, -1):
            p.add(*cyl(v(x, sy * 1.75, -0.05), v(x, sy * 1.65, 0.65), 0.04, n=6), '#7a5232', 'wood')
    p.add(*box(v(0, 1.72, 0.65), (5.0, 0.05, 0.04), bevel=0.01), '#7a5232', 'wood')
    p.add(*box(v(0, -1.72, 0.65), (5.0, 0.05, 0.04), bevel=0.01), '#7a5232', 'wood')
    return p


def frigate():
    """An Armada frigate: white and navy hull with a gold stripe, three masts, square sails."""
    p = Piece('frigate')
    p.add(*hull(36.0, 9.0, 5.0, sheer=1.6, n=16, rings=13), '#f4f2ec', 'wood')
    p.add(*box(v(0, 0, -0.6), (17.0, 4.2, 0.12), bevel=0.04), '#c9a272', 'wood')
    p.add(*box(v(0, 0, -1.1), (18.0, 4.6, 0.25), bevel=0.04), '#d8a93c', 'metal')                 # gold stripe band (approx)
    p.add(*box(v(-14.5, 0, 1.0), (3.2, 4.0, 1.8), bevel=0.1), '#23305c', 'wood')                 # stern castle
    for i, x in enumerate((-8.0, 2.0, 11.0)):
        h = (26.0, 30.0, 22.0)[i]
        p.add(*cyl(v(x, 0, -0.6), v(x, 0, h), 0.45, 0.25, n=10), '#6a4a30', 'wood')
        for k, z in enumerate((h * 0.35, h * 0.62, h * 0.85)):
            wsz = (7.5, 5.8, 4.2)[k]
            p.add(*cyl(v(x, -wsz, z), v(x, wsz, z), 0.16, n=8), '#6a4a30', 'wood')
            sv = np.array([[x, -wsz, z - 0.1], [x, wsz, z - 0.1], [x + 0.6, wsz * 0.95, z - (h * 0.22)], [x + 0.6, -wsz * 0.95, z - (h * 0.22)]], float)
            p.add(*pc.shell(sv, [(0, 1, 2, 3)], 0.06), '#f7f3ea', 'cloth', sway=0.25)
    # gunports
    for x in np.linspace(-12, 12, 9):
        for sy in (1, -1):
            p.add(*box(v(x, sy * 4.4, -2.0), (0.4, 0.15, 0.35), bevel=0.03), '#1a1c24', 'wood')
            p.add(*cyl(v(x, sy * 4.3, -2.0), v(x, sy * 5.0, -2.0), 0.15, n=8), '#2a2a30', 'metal')
    # flag
    fv = np.array([[2, 0, 30.5], [2, 0, 32.0], [-1.5, 0, 32.0], [-1.5, 0, 30.5]], float)
    p.add(*pc.shell(fv, [(0, 1, 2, 3)], 0.04), '#e8c25a', 'cloth', sway=1.0)
    return p


def palm(seed=0, height=6.5):
    p = Piece(f'palm{seed}')
    rng = np.random.default_rng(seed)
    lean = rng.uniform(0.2, 0.6)
    pts = [v(lean * (t ** 2) * height * 0.35, 0, t * height) for t in np.linspace(0, 1, 8)]
    radii = [0.28 - 0.12 * t for t in np.linspace(0, 1, 8)]
    p.add(*pc.tube(np.array(pts), radii, n=10, cap_tip=False, cap_root=True), '#8a6a48', 'wood')
    for i in range(7):
        a = pts[int(i * 1.0)] if i < 7 else pts[-1]
        p.add(*cyl(a + v(0, 0, -0.04), a + v(0, 0, 0.06), radii[i] + 0.05, n=10), '#6a5034', 'wood')
    top = pts[-1]
    for k in range(9):
        ang = 2 * math.pi * k / 9 + rng.uniform(-0.2, 0.2)
        d = v(math.cos(ang), math.sin(ang), rng.uniform(0.2, 0.6))
        V, F = frond(top, d, rng.uniform(2.6, 3.4), 0.55, rng.uniform(1.2, 2.0))
        sway = np.clip(np.linalg.norm(V - top, axis=1) / 2.0, 0, 1)
        p.add(V, F, '#3f9a4a', 'foliage', sway=sway)
    for k in range(3):
        a = 2 * math.pi * k / 3
        p.add(*pc.quad_sphere(top + v(math.cos(a) * 0.25, math.sin(a) * 0.25, -0.25), (0.16, 0.16, 0.18), res=2), '#5a3a20', 'wood')
    return p


def tree(seed=0, height=5.0, color='#4f9a3a'):
    p = Piece(f'tree{seed}')
    rng = np.random.default_rng(seed + 10)
    p.add(*cyl(v(0, 0, 0), v(rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), height * 0.6), 0.3, 0.18, n=10), '#6a4e36', 'wood')
    cs, rs = [], []
    for k in range(6):
        a = 2 * math.pi * k / 6
        cs.append(v(math.cos(a) * 1.1, math.sin(a) * 1.1, height * 0.7 + rng.uniform(-0.3, 0.5)))
        rs.append(rng.uniform(1.0, 1.4))
    cs.append(v(0, 0, height * 0.95))
    rs.append(1.5)
    V, F = blob_mesh(cs, rs, res=0.12, k=0.6, seed=seed, noise=0.25)
    sway = np.clip((V[:, 2] - height * 0.4) / (height * 0.6), 0, 1) * 0.5
    p.add(V, F, color, 'foliage', sway=sway)
    return p


def bush(seed=0, color='#4f9a3a'):
    p = Piece(f'bush{seed}')
    rng = np.random.default_rng(seed + 20)
    cs = [v(rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(0.2, 0.5)) for _ in range(4)]
    V, F = blob_mesh(cs, [rng.uniform(0.45, 0.7) for _ in cs], res=0.07, k=0.3, seed=seed, noise=0.12)
    p.add(V, F, color, 'foliage', sway=np.clip(V[:, 2] / 1.0, 0, 1) * 0.4)
    return p


def rock(seed=0, size=(1.4, 1.1, 0.9), color='#8a8a86'):
    p = Piece(f'rock{seed}')
    V, F = rock_mesh(seed, size, res=0.07 * max(size) / 1.4)
    p.add(V, F, color, 'rock')
    return p


def crate():
    p = Piece('crate')
    p.add(*box(v(0, 0, 0.4), (0.4, 0.4, 0.4), bevel=0.03), '#b08a5a', 'wood')
    for sx in (1, -1):
        p.add(*box(v(0, sx * 0.41, 0.4), (0.42, 0.02, 0.06), bevel=0.01), '#7a5a3a', 'wood')
        p.add(*box(v(sx * 0.41, 0, 0.4), (0.02, 0.42, 0.06), bevel=0.01), '#7a5a3a', 'wood')
    return p


def barrel():
    p = Piece('barrel')
    pts = [v(0, 0, 0), v(0, 0, 0.45), v(0, 0, 0.9)]
    p.add(*pc.tube(np.array(pts), [0.3, 0.36, 0.3], n=14, cap_tip=True, cap_root=True), '#9a6a40', 'wood')
    for z in (0.15, 0.75):
        p.add(*cyl(v(0, 0, z - 0.03), v(0, 0, z + 0.03), 0.335, n=14, caps=False), '#3a3a40', 'metal')
    return p


def lamp_post():
    p = Piece('lamppost')
    p.add(*cyl(v(0, 0, 0), v(0, 0, 2.6), 0.06, 0.05, n=8), '#2a2a30', 'metal')
    p.add(*cyl(v(0, 0, 2.6), v(0.35, 0, 2.75), 0.035, n=6), '#2a2a30', 'metal')
    p.add(*box(v(0.42, 0, 2.5), (0.12, 0.12, 0.17), bevel=0.02), '#ffd27a', 'glow')
    p.add(*cyl(v(0.42, 0, 2.66), v(0.42, 0, 2.8), 0.15, 0.02, n=6), '#2a2a30', 'metal')
    return p


def fence():
    p = Piece('fence')
    for x in (-1.0, 0.0, 1.0):
        p.add(*box(v(x, 0, 0.5), (0.05, 0.05, 0.5), bevel=0.01), '#8a6a48', 'wood')
    for z in (0.35, 0.8):
        p.add(*box(v(0, 0, z), (1.05, 0.03, 0.05), bevel=0.01), '#9a7a58', 'wood')
    return p


def stall(awning='#d8483a'):
    p = Piece('stall')
    for sx in (1, -1):
        for sy in (1, -1):
            p.add(*cyl(v(sx * 1.2, sy * 0.8, 0), v(sx * 1.2, sy * 0.8, 2.3), 0.06, n=6), '#7a5a3a', 'wood')
    p.add(*box(v(0, -0.3, 0.9), (1.25, 0.5, 0.05), bevel=0.02), '#9a7a58', 'wood')
    stripes = lambda V: np.where((np.floor((V[:, 0] + 2) * 2.5) % 2 == 0)[:, None], srgb(awning), srgb('#f7efe0'))  # noqa
    av = np.array([[-1.35, -1.1, 2.0], [1.35, -1.1, 2.0], [1.35, 0.9, 2.5], [-1.35, 0.9, 2.5]], float)
    V, F = pc.shell(av, [(0, 1, 2, 3)], 0.03)
    Vd, Fd = pc.subdivide(V, F, 2, 'awn') if False else (V, F)
    p.add(Vd, Fd, stripes(Vd), 'cloth', sway=0.15)
    for k in range(5):
        p.add(*pc.quad_sphere(v(-0.9 + k * 0.45, -0.4, 1.05), (0.14, 0.14, 0.12), res=2), ['#e8a030', '#d84a3a', '#7ab84a', '#e8d040', '#c86aa0'][k], 'plain')
    return p


def stairs(steps=6, width=2.0, rise=0.2, run=0.32, color='#a89f90'):
    p = Piece('stairs')
    for i in range(steps):
        p.add(*box(v(0, i * run, (i + 0.5) * rise), (width / 2, run / 2 + 0.02, (i + 0.5) * rise + 0.001), bevel=0.02), color, 'stone')
    return p


def wall(length=4.0, height=1.2, color='#a89f90'):
    p = Piece('wall')
    p.add(*box(v(0, 0, height / 2), (length / 2, 0.3, height / 2), bevel=0.06), color, 'stone')
    p.add(*box(v(0, 0, height + 0.06), (length / 2 + 0.05, 0.36, 0.07), bevel=0.03), '#8f877a', 'stone')
    return p


def net_rack():
    p = Piece('netrack')
    for x in (-1.2, 1.2):
        p.add(*cyl(v(x, 0, 0), v(x, 0, 2.0), 0.06, n=6), '#7a5a3a', 'wood')
    p.add(*cyl(v(-1.25, 0, 2.0), v(1.25, 0, 2.0), 0.05, n=6), '#7a5a3a', 'wood')
    nv = np.array([[-1.15, 0, 1.95], [1.15, 0, 1.95], [1.0, 0.05, 0.4], [-1.0, 0.05, 0.3]], float)
    p.add(*pc.shell(nv, [(0, 1, 2, 3)], 0.02), '#7a8a6a', 'cloth', sway=0.4)
    return p


def flag_pole(color='#e8c25a'):
    p = Piece('flagpole')
    p.add(*cyl(v(0, 0, 0), v(0, 0, 7.0), 0.07, 0.04, n=8), '#d8d4cc', 'metal')
    fv = np.array([[0, 0, 6.9], [0, 0, 5.8], [1.8, 0, 5.8], [1.8, 0, 6.9]], float)
    V, F = pc.shell(fv, [(0, 1, 2, 3)], 0.02)
    p.add(V, F, color, 'cloth', sway=np.clip(V[:, 0] / 1.8, 0, 1))
    return p


def cannon():
    p = Piece('cannon')
    p.add(*cyl(v(-0.6, 0, 0.55), v(0.9, 0, 0.6), 0.2, 0.15, n=12), '#2e3036', 'metal')
    p.add(*box(v(-0.2, 0, 0.3), (0.5, 0.35, 0.18), bevel=0.03), '#7a5232', 'wood')
    for sx in (1, -1):
        p.add(*cyl(v(-0.2, sx * 0.38, 0.2), v(-0.2, sx * 0.44, 0.2), 0.2, n=12), '#5a3a26', 'wood')
    return p


KITS = {
    'common': lambda: [crate(), barrel(), lamp_post(), fence(), stall(), stairs(), wall(), net_rack(), flag_pole(), cannon(),
                       rock(1), rock(2, (1.8, 1.3, 1.4)), rock(3, (3.0, 2.2, 2.0), '#7f7f7c'), rock(4, (5.0, 3.5, 3.4), '#7a7874'),
                       bush(1), bush(2, '#5aa84a'), tree(1), tree(2, 6.0, '#3f8a3a'), palm(1), palm(2, 7.2), palm(3, 5.8)],
    'gulls': lambda: [cottage('cottageA', roof='#c4553a', seed=0), cottage('cottageB', 3.6, 3.2, 2.4, roof='#3f6f9a', wall='#f4e8d0', door='#c8383a', seed=1),
                      cottage('cottageC', 4.8, 3.6, 2.7, roof='#d8873a', wall='#e8f0e4', door='#4a8a5a', seed=2), keeper_house(), lighthouse(),
                      dock(), boardwalk(), rowboat()],
    'ships': lambda: [wren(), frigate()],
}


def build_kit(name, preview=False):
    bl.reset()
    pieces = KITS[name]()
    objs = []
    for pz in pieces:
        V, F, C, K, S = pz.arrays()
        quads = all(len(f) == 4 for f in F)
        if quads:
            ob = bl.make_mesh(pz.name, V, np.array(F), smooth=True)
        else:
            me = bpy.data.meshes.new(pz.name)
            me.from_pydata([tuple(p) for p in V], [], [tuple(f) for f in F])
            me.update()
            me.shade_smooth()
            ob = bpy.data.objects.new(pz.name, me)
            bpy.context.scene.collection.objects.link(ob)
        # auto smooth by angle: keep hard edges on boxes
        try:
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        except Exception:
            pass
        me = ob.data
        ao = vertex_ao(ob)
        bl.set_colors(me, np.concatenate([C, S[:, None]], 1))
        _set_uv(me, 'UVMap', np.zeros((len(V), 2)))
        _set_uv(me, 'UV1', np.stack([ao, K / 20.0], 1))
        mat = bpy.data.materials.new(pz.name + '_m')
        me.materials.append(mat)
        objs.append(ob)
        print(f'[kit] {pz.name}: {len(me.polygons)} faces')
    if preview:
        os.makedirs(ART, exist_ok=True)
        bl.setup_preview(res=(900, 600))
        x = 0.0
        for ob in objs:
            dims = ob.dimensions
            ob.location.x = x + dims.x / 2
            x += dims.x + 1.5
        bl.render_views(os.path.join(ART, name), target=(x / 2, 0, 3), dist=x * 0.75 + 8, views=[('q3', 30, 18)], lens=35)
        for ob in objs:
            ob.location.x = 0
    path = os.path.join(OUT, f'{name}.glb')
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_animations=False, export_yup=True, export_normals=True, export_materials='EXPORT')
    print('[kit] wrote', path, os.path.getsize(path) // 1024, 'KB')


def vertex_ao(ob, rays=10, dist=2.5):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    tree_ = BVHTree.FromBMesh(bm)
    rng = np.random.default_rng(1)
    dirs = rng.normal(size=(rays, 3))
    dirs /= np.linalg.norm(dirs, axis=1)[:, None]
    ao = np.ones(len(bm.verts))
    for i, vt in enumerate(bm.verts):
        n = vt.normal
        o = vt.co + n * 0.02
        hit = 0
        cnt = 0
        for d in dirs:
            dd = Vector(d)
            if dd.dot(n) < 0:
                dd = -dd
            cnt += 1
            loc, nrm, idx, dst = tree_.ray_cast(o, dd, dist)
            if loc is not None:
                hit += 1.0 - dst / dist * 0.5
        ao[i] = 1.0 - hit / max(cnt, 1) * 0.8
    bm.free()
    return np.clip(ao, 0.15, 1.0)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['all']
    names = list(KITS) if args[0] == 'all' else [args[0]]
    for n in names:
        build_kit(n, preview='--preview' in args)
