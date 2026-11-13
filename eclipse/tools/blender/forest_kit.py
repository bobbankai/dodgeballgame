"""The Forgotten Sanctuary kit: Sylvaris's temple-forest, overgrown and blighted (Chapter Four).

  /opt/bvenv/bin/python eclipse/tools/blender/forest_kit.py [piece ...] [--no-ao]

Writes public/assets/env/forest/<piece>.glb (same conventions as the other kits: metric UVs,
`env:<set>` materials, BVH ambient occlusion, `<piece>_col` collision).

Pieces: tree_giant, tree_a, tree_b, tree_dead, roots_arch, root_wall (a curved run of roots for the
Heartwood's ring), shrine (a mossy brick shrine with a root through it), gate (stone pylons and a
lintel, a root threading them), log (a fallen trunk to walk along), mushrooms, mushroom_giant
(glowing caps), rocks_a/b, bush_a/b, statue_sylvaris, stones (a broken stone path).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np
from mathutils import Vector

import sdf
from common import reset, ASSETS, decimate, shade_smooth, mesh_from_arrays, verts_np
from envkit import (box, cylinder, boolean, damage, join, metric_uv, bake_ao, subdivide_long_edges, collision,
                    export_piece, material as env_material)

OUT = os.path.join(ASSETS, 'env', 'forest')
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
AO = '--no-ao' not in sys.argv

BARK = 'wood_root_bark'
BARK2 = 'wood_bark'
MOSSWOOD = 'wood_moss_wood'
LEAVES = 'wood_leaves'
BLIGHT = 'wood_leaves#blight'
BRICK = 'wood_mossy_brick'
PLASTER = 'wood_mossy_plaster'
ROCK = 'wood_mossy_rock'
MARBLE = 'sun_marble#moss'
GLOW = 'sun_marble#glow'


def finish(name, parts, cols, dmg=None, seed=0, sub=1.8):
    obj = join(parts, name)
    if dmg:
        damage(obj, dmg, seed=seed, radius=(0.4, 1.0))
    metric_uv(obj, seed=seed + 1)
    if AO:
        subdivide_long_edges(obj, sub)
        bake_ao(obj)
    col = collision(name, cols) if cols else None
    export_piece(os.path.join(OUT, f'{name}.glb'), obj, col, ao=AO)


def sculpt(name, field, lo, hi, voxel, budget, mats):
    v, f = sdf.mesh(field, np.array(lo), np.array(hi), voxel)
    o = mesh_from_arrays(name, v, f)
    decimate(o, target_tris=budget)
    shade_smooth(o, angle=55)
    me = o.data
    for _, m in mats:
        me.materials.append(env_material(m))
    co = verts_np(o, world=False)
    centers = np.array([co[list(p.vertices)].mean(0) for p in me.polygons])
    best = np.full(len(centers), np.inf)
    idx = np.zeros(len(centers), int)
    for i, (fld, _) in enumerate(mats):
        if fld is None:
            continue
        d = np.abs(fld(centers))
        take = d < best
        idx[take] = i
        best[take] = d[take]
    me.polygons.foreach_set('material_index', idx)
    return o


def export_sculpt(name, o, cols, seed, ao_dist=1.6):
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o, distance=ao_dist)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, collision(name, cols) if cols else None, ao=AO)


# ============================================================================== trees
def tree_fields(height, r0, r1, n_roots, seed, lean=(0.0, 0.0), canopy=True, n_branches=5, crown=1.0):
    rng = np.random.default_rng(seed)
    lx, ly = lean

    def axis(z):
        # the trunk's centreline: a lean and a slow wander
        t = np.clip(z / height, 0, 1)
        return (lx * t * t * height + 0.25 * r0 * np.sin(z * 0.35 + seed),
                ly * t * t * height + 0.25 * r0 * np.cos(z * 0.29 + seed * 2))

    def trunk(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        cx, cy = axis(z)
        t = np.clip(z / height, 0, 1)
        r = r0 + (r1 - r0) * t ** 0.7 + r0 * 0.9 * np.exp(-z / (r0 * 1.2))   # flaring foot
        ang = np.arctan2(y - cy, x - cx)
        grooves = 0.05 * r0 * np.sin(ang * 9 + 0.6 * np.sin(z * 0.8)) + 0.04 * r0 * (sdf.fbm(p, 1.2 / r0, 3, seed) - 0.5)
        d = np.hypot(x - cx, y - cy) - (r + grooves)
        return np.maximum(d, np.maximum(z - height, -z - 0.6))

    roots = []
    for k in range(n_roots):
        a = (k + rng.uniform(-0.25, 0.25)) / n_roots * math.tau
        reach = r0 * rng.uniform(2.3, 3.3)
        top = r0 * rng.uniform(1.6, 2.6)
        roots.append((a, reach, top, rng.uniform(0.18, 0.28) * r0))

    def root_fins(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        out = np.full(len(p), 1e3)
        for a, reach, top, w in roots:
            ca, sa = math.cos(a), math.sin(a)
            u = x * ca + y * sa            # outward
            v = -x * sa + y * ca           # sideways
            # a buttress: a fin whose top falls in a curve from `top` at the trunk to the ground at `reach`
            prof = top * np.clip(1 - np.clip(u - r0 * 0.4, 0, None) / reach, 0, 1) ** 1.8
            fin = np.maximum(np.maximum(np.abs(v) - w * (0.5 + 0.5 * np.clip(1 - u / reach, 0, 1)), z - prof), np.maximum(-z - 0.5, u - reach))
            fin = np.maximum(fin, -u)
            out = np.minimum(out, fin)
        return out

    branches = []
    for k in range(n_branches):
        a = rng.uniform(0, math.tau)
        z0 = height * rng.uniform(0.55, 0.85)
        cx, cy = axis(np.array([z0]))
        start = np.array([cx[0], cy[0], z0])
        L = height * rng.uniform(0.25, 0.4) * crown
        end = start + np.array([math.cos(a) * L, math.sin(a) * L, L * rng.uniform(0.25, 0.6)])
        branches.append((start, end, r1 * rng.uniform(0.45, 0.7)))

    def limbs(p):
        out = np.full(len(p), 1e3)
        for a, b, r in branches:
            out = np.minimum(out, sdf.capsule(a, b, r, r * 0.35)(p))
        return out

    blobs = []
    if canopy:
        for a, b, r in branches:
            for j in range(3):
                c = b + rng.normal(0, 1, 3) * np.array([2.2, 2.2, 1.0]) * crown * height / 16
                blobs.append((c, np.array([rng.uniform(2.6, 4.0), rng.uniform(2.6, 4.0), rng.uniform(1.6, 2.6)]) * crown * height / 16))
        top = np.array([*[float(v[0]) for v in axis(np.array([height]))], height])
        blobs.append((top + np.array([0, 0, 1.5 * crown]), np.array([4.5, 4.5, 3.0]) * crown * height / 16))

    def leaves(p):
        if not blobs:
            return np.full(len(p), 1e3)
        out = np.full(len(p), 1e3)
        for c, rad in blobs:
            out = np.minimum(out, sdf.ellipsoid(c, tuple(rad))(p))
        # leafy lumps: clumps rather than a smooth blob
        return out - 0.55 * (sdf.fbm(p, 0.55, 3, seed + 9) - 0.5) * height / 16

    def wood(p):
        return np.minimum(np.minimum(trunk(p), root_fins(p)), limbs(p))

    return wood, leaves, trunk


def tree(name, height, r0, r1, n_roots, seed, lean=(0, 0), canopy=True, voxel=0.1, budget=12000, leafset=LEAVES, crown=1.0):
    wood, leaves, trunk = tree_fields(height, r0, r1, n_roots, seed, lean, canopy, crown=crown)

    def field(p):
        return np.minimum(wood(p), leaves(p))

    def moss(p):
        return wood(p) + np.clip(p[:, 2] - 1.6, 0, None) * 10

    ext = height * 0.65 * crown + r0 * 4
    lo, hi = (-ext, -ext, -0.6), (ext, ext, height * (1 + 0.35 * crown) + 3)
    o = sculpt(name, field, lo, hi, voxel, budget, [(wood, BARK), (leaves, leafset), (moss, MOSSWOOD)])
    cols = [cylinder('c', r0 * 1.15, height * 0.8, (0, 0, -0.3), sides=8, r2=r1)]
    export_sculpt(name, o, cols, seed, ao_dist=2.5)


def roots_arch(name='roots_arch', seed=411):
    """Two great roots arching over the path, smaller roots knotted round their feet."""
    rng = np.random.default_rng(seed)
    tubes = []
    for k, (x0, x1, h) in enumerate([(-4.2, 4.0, 5.2), (-3.6, 4.6, 4.4)]):
        pts = []
        for i in range(13):
            t = i / 12
            x = x0 + (x1 - x0) * t
            pts.append((x, (k - 0.5) * 1.4 + 0.4 * math.sin(t * 5 + k), h * math.sin(math.pi * t) ** 0.8 - 0.4))
        tubes.append((pts, 0.7 - 0.12 * k))
    for j in range(5):
        a = rng.uniform(0, math.tau)
        c = np.array([rng.choice([-4.2, 4.2]), rng.uniform(-1.5, 1.5), 0])
        pts = [tuple(c + np.array([math.cos(a) * s * 1.2, math.sin(a) * s * 1.2, 0.6 - 0.2 * s])) for s in range(5)]
        tubes.append((pts, 0.3))

    def field(p):
        out = np.full(len(p), 1e3)
        for pts, r in tubes:
            for i in range(len(pts) - 1):
                out = np.minimum(out, sdf.capsule(pts[i], pts[i + 1], r, r * 0.95)(p))
        return out - 0.06 * (sdf.fbm(p, 1.5, 3, seed) - 0.5)

    def moss(p):
        return field(p) + np.clip(-(p[:, 2] - 2.5), 0, None) * 0 + (sdf.fbm(p, 0.8, 2, seed + 1) < 0.45) * 0.2

    o = sculpt(name, field, (-6, -3, -0.6), (6, 3, 6.4), 0.06, 7000, [(field, BARK), (moss, MOSSWOOD)])
    export_sculpt(name, o, [box('c1', (1.6, 3, 3), (-4.1, 0, 1.5)), box('c2', (1.6, 3, 3), (4.2, 0, 1.5))], seed)


def root_wall(name='root_wall', seed=421, R=24.0, arc=math.radians(30)):
    """A run of intertwined roots on a circle of radius R (the Heartwood's ring), centred on +X."""
    rng = np.random.default_rng(seed)
    tubes = []
    for k in range(7):
        h = rng.uniform(0.6, 3.6)
        dr = rng.uniform(-0.9, 1.4)
        pts = []
        for i in range(9):
            t = i / 8
            a = -arc / 2 * 1.08 + arc * 1.08 * t
            r = R + dr + 0.5 * math.sin(t * 7 + k)
            pts.append((math.cos(a) * r, math.sin(a) * r, h * (0.4 + 0.6 * math.sin(math.pi * (t * 0.8 + 0.1))) + 0.3 * math.sin(t * 9 + k)))
        tubes.append((pts, rng.uniform(0.35, 0.8)))

    def field(p):
        out = np.full(len(p), 1e3)
        for pts, r in tubes:
            for i in range(len(pts) - 1):
                out = np.minimum(out, sdf.capsule(pts[i], pts[i + 1], r, r * 0.9)(p))
        return out - 0.06 * (sdf.fbm(p, 1.5, 3, seed) - 0.5)

    def moss(p):
        return field(p) + (sdf.fbm(p, 0.6, 2, seed + 1) < 0.5) * 0.3

    lo = (R * math.cos(arc / 2) - 3, -R * math.sin(arc / 2) * 1.15, -0.6)
    hi = (R + 3, R * math.sin(arc / 2) * 1.15, 5)
    o = sculpt(name, field, lo, hi, 0.07, 7000, [(field, BARK), (moss, MOSSWOOD)])
    L = 2 * R * math.tan(arc / 2)
    export_sculpt(name, o, [box('c', (2.6, L, 3.2), (R + 0.3, 0, 1.6))], seed)


def shrine(name='shrine', seed=431):
    """A small brick shrine: a domed cella on a podium, an arched door, a great root through it."""
    parts = [box('pod', (7, 7, 0.8), (0, 0, 0.4), BRICK, bevel=0.05), box('step', (3, 1.4, 0.4), (0, -4.1, 0.2), BRICK, bevel=0.04)]
    cella = box('cella', (5.2, 5.2, 4.2), (0, 0, 0.8 + 2.1), BRICK, bevel=0.05)
    boolean(cella, box('in', (4.0, 4.0, 5), (0, 0, 3.4)))
    door = join([box('db', (1.6, 2, 2.2), (0, -2.6, 0.8 + 1.1)), cylinder('dc', 0.8, 2, (0, -1.6, 0.8 + 2.2), rot=(math.pi / 2, 0, 0), sides=20)], 'door')
    boolean(cella, door)
    parts.append(cella)
    dome = cylinder('dome', 3.0, 2.2, (0, 0, 5.0), PLASTER, sides=24, r2=0.4)
    parts += [dome, box('cornice', (5.8, 5.8, 0.35), (0, 0, 5.0), MARBLE, bevel=0.04),
              box('altar', (1.4, 0.9, 1.0), (0, 1.0, 1.3), MARBLE, bevel=0.05),
              cylinder('bowl', 0.42, 0.25, (0, 1.0, 1.8), GLOW, sides=16, r2=0.55)]
    # the root: in through the back wall, out over the dome
    pts = [(-1.0, 6.5, -0.2), (-0.6, 4.2, 1.6), (0.2, 2.2, 4.6), (0.8, 0.0, 6.4), (1.6, -2.4, 6.2), (3.6, -4.0, 3.0), (4.6, -4.8, 0.0)]

    def rootf(p):
        out = np.full(len(p), 1e3)
        for i in range(len(pts) - 1):
            out = np.minimum(out, sdf.capsule(pts[i], pts[i + 1], 0.75 - i * 0.06, 0.7 - i * 0.06)(p))
        return out - 0.05 * (sdf.fbm(p, 1.4, 3, seed) - 0.5)

    root = sculpt('root', rootf, (-2.5, -6.5, -0.8), (6.0, 8.0, 7.6), 0.06, 4000, [(rootf, BARK)])
    parts.append(root)
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-2.6, 2.6), rng.choice([-2.6, 2.6]), 5.0)) for _ in range(2)]
    cols = [box('c1', (7, 7, 0.8), (0, 0, 0.4)), box('c2', (5.2, 0.6, 4.2), (0, 2.3, 2.9)), box('c3', (0.6, 5.2, 4.2), (-2.3, 0, 2.9)),
            box('c4', (0.6, 5.2, 4.2), (2.3, 0, 2.9)), box('c5', (1.8, 0.6, 4.2), (-1.7, -2.3, 2.9)), box('c6', (1.8, 0.6, 4.2), (1.7, -2.3, 2.9)),
            box('c7', (1.4, 0.9, 1.0), (0, 1.0, 1.3)), box('c8', (6, 6, 2.4), (0, 0, 6.0))]
    finish(name, parts, cols, dmg, seed)


def gate(name='gate', seed=441):
    """The sanctuary gate: two tapering pylons, a lintel carved with leaves, a root threaded through."""
    parts = []
    for s in (-1, 1):
        parts.append(cylinder(f'py{s}', 1.7, 9.0, (s * 4.0, 0, 0), BRICK, sides=4, r2=1.2))
        parts[-1].rotation_euler = (0, 0, math.pi / 4)
        parts.append(box(f'cap{s}', (2.6, 2.6, 0.5), (s * 4.0, 0, 9.0), MARBLE, bevel=0.05))
    parts.append(box('lintel', (11.0, 2.0, 1.3), (0, 0, 9.6), MARBLE, bevel=0.06))
    parts.append(box('glyph', (3.0, 2.06, 0.5), (0, 0, 9.6), GLOW, bevel=0.03))
    pts = [(-7.5, 1.5, 0.0), (-5.6, 0.6, 3.0), (-3.2, 0.2, 7.6), (0.0, -0.3, 10.8), (3.5, 0.0, 8.6), (5.2, 0.9, 4.8), (6.8, 1.8, 0.0)]

    def rootf(p):
        out = np.full(len(p), 1e3)
        for i in range(len(pts) - 1):
            r = 0.7 - 0.25 * math.sin(math.pi * i / (len(pts) - 1))
            out = np.minimum(out, sdf.capsule(pts[i], pts[i + 1], r, r * 0.95)(p))
        return out - 0.05 * (sdf.fbm(p, 1.4, 3, seed) - 0.5)

    parts.append(sculpt('root', rootf, (-8.6, -1.4, -0.8), (8.0, 3.0, 12.0), 0.07, 4000, [(rootf, BARK)]))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-5, 5), rng.choice([-1, 1]), 10.2)) for _ in range(2)]
    cols = [box('c1', (2.6, 2.6, 9), (-4, 0, 4.5)), box('c2', (2.6, 2.6, 9), (4, 0, 4.5)), box('c3', (11, 2, 1.3), (0, 0, 9.6))]
    finish(name, parts, cols, dmg, seed)


def log(name='log', seed=451, L=15.0, r=1.3):
    """A fallen giant, hollowed at one end, moss along its back: a bridge over the ravine."""
    def field(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2] - r * 0.85
        rr = r * (1 - 0.15 * (x / L + 0.5))
        body = np.maximum(np.hypot(y, z) - rr - 0.04 * np.sin(np.arctan2(z, y) * 14 + x * 0.4), np.abs(x) - L / 2)
        hollow = np.maximum(np.hypot(y, z) - rr * 0.6, -(x - L / 2 + 2.5))
        stubs = np.full(len(p), 1e3)
        for xs, a in ((-3.5, 0.6), (1.5, 2.4), (4.0, -0.8)):
            b0 = np.array([xs, 0, r * 0.85])
            stubs = np.minimum(stubs, sdf.capsule(b0, b0 + np.array([0.3, math.cos(a) * 1.8, math.sin(a) * 1.8]), 0.25, 0.12)(p))
        return np.minimum(np.maximum(body, -hollow), stubs) - 0.03 * (sdf.fbm(p, 2, 2, seed) - 0.5)

    def moss(p):
        return field(p) + np.clip(r * 0.85 + r * 0.5 - p[:, 2], 0, None) * 4

    o = sculpt(name, field, (-L / 2 - 0.5, -3, -0.6), (L / 2 + 0.5, 3, r * 2 + 2), 0.06, 7000, [(field, BARK2), (moss, MOSSWOOD)])
    export_sculpt(name, o, [box('c', (L, r * 1.6, r * 1.75), (0, 0, r * 0.875))], seed)


def mushrooms(name='mushrooms', seed=461, giant=False):
    rng = np.random.default_rng(seed)
    caps = []
    n = 1 if giant else 7
    for k in range(n):
        if giant:
            c, h, rc = np.array([0.0, 0.0, 0.0]), 4.2, 2.4
        else:
            a = rng.uniform(0, math.tau)
            d = rng.uniform(0.0, 1.4) * (k > 0)
            c = np.array([math.cos(a) * d, math.sin(a) * d, 0.0])
            h = rng.uniform(0.35, 1.6) * (1.0 if k else 1.3)
            rc = h * rng.uniform(0.38, 0.55)
        lean = rng.normal(0, 0.12, 2) * h
        caps.append((c, h, rc, lean))

    def stems(p):
        out = np.full(len(p), 1e3)
        for c, h, rc, lean in caps:
            top = c + np.array([lean[0], lean[1], h])
            out = np.minimum(out, sdf.capsule(c - np.array([0, 0, 0.1]), top, rc * 0.24, rc * 0.17)(p))
        return out

    def capf(p):
        out = np.full(len(p), 1e3)
        for c, h, rc, lean in caps:
            top = c + np.array([lean[0], lean[1], h])
            dome = sdf.ellipsoid(top + np.array([0, 0, rc * 0.05]), (rc, rc, rc * 0.55))(p)
            under = -(p[:, 2] - (top[2] - rc * 0.05))
            gills = 0.02 * rc * np.sin(np.arctan2(p[:, 1] - top[1], p[:, 0] - top[0]) * 30)
            out = np.minimum(out, np.maximum(dome + gills * (p[:, 2] < top[2] + rc * 0.1), under))
        return out

    def field(p):
        return np.minimum(stems(p), capf(p))

    ext = 4.0 if giant else 2.6
    top = 7.6 if giant else 2.6
    o = sculpt(name, field, (-ext, -ext, -0.2), (ext, ext, top), 0.05 if giant else 0.02, 5000 if giant else 4000, [(stems, MARBLE), (capf, GLOW)])
    cols = [cylinder('c', 0.6, 4.2, (0, 0, 0), sides=8)] if giant else None
    export_sculpt(name, o, cols, seed)


def rocks(name, size, seed):
    rng = np.random.default_rng(seed)
    blobs = []
    for _ in range(5):
        c = (rng.uniform(-size * 0.3, size * 0.3), rng.uniform(-size * 0.3, size * 0.3), rng.uniform(-0.2, size * 0.15))
        blobs.append(sdf.ellipsoid(c, tuple(rng.uniform(0.25, 0.5, 3) * size * np.array([1, 0.9, 0.6]))))
    base = sdf.union(*blobs)

    def rock(p):
        return np.maximum(base(p) + 0.15 * (sdf.fbm(p, 1.2 / size * 3, 4, seed) - 0.5) * size * 0.4, -p[:, 2] - 0.3)

    o = sculpt(name, rock, (-size * 0.9, -size * 0.9, -0.35), (size * 0.9, size * 0.9, size * 0.7), 0.05, 5000, [(rock, ROCK)])
    export_sculpt(name, o, [cylinder('c', size * 0.45, size * 0.45, (0, 0, -0.3), sides=8, r2=size * 0.25)], seed)


def bush(name, size, seed, leafset=LEAVES):
    rng = np.random.default_rng(seed)
    blobs = [sdf.ellipsoid((rng.uniform(-size * 0.4, size * 0.4), rng.uniform(-size * 0.4, size * 0.4), rng.uniform(0.2, size * 0.5) * size / 2),
                           tuple(rng.uniform(0.35, 0.6, 3) * size * np.array([1, 1, 0.7]))) for _ in range(6)]

    def field(p):
        return np.maximum(sdf.union(*blobs)(p) - 0.25 * size * (sdf.fbm(p, 2.5 / size, 3, seed) - 0.5), -p[:, 2] - 0.1)

    o = sculpt(name, field, (-size * 1.3, -size * 1.3, -0.2), (size * 1.3, size * 1.3, size * 1.2), 0.04, 2500, [(field, leafset)])
    export_sculpt(name, o, None, seed, ao_dist=0.8)


def statue_sylvaris(name='statue_sylvaris', seed=471):
    """Sylvaris as her keepers carved her: robed in leaves, arms open, a crown of branching antlers."""
    def body(p):
        robe = sdf.capsule((0, 0, 1.7), (0, 0.05, 4.8), 0.72, 0.42)(p)
        skirt = sdf.capsule((0, 0, 1.6), (0, 0, 3.4), 1.0, 0.62)(p)
        head = sdf.sphere((0, -0.05, 5.5), 0.37)(p)
        arms = np.minimum(sdf.capsule((-0.55, 0, 4.7), (-1.5, -0.5, 4.2), 0.16, 0.12)(p), sdf.capsule((0.55, 0, 4.7), (1.5, -0.5, 4.2), 0.16, 0.12)(p))
        leaves = 0.04 * np.sin(p[:, 2] * 9 + np.arctan2(p[:, 1], p[:, 0]) * 6) * (p[:, 2] < 4.7)
        return np.minimum.reduce([robe, skirt, head, arms]) - leaves + 0.015 * (sdf.fbm(p, 6, 2, seed) - 0.5)

    def antlers(p):
        out = np.full(len(p), 1e3)
        for s in (1, -1):
            base = np.array([s * 0.22, 0, 5.8])
            pts = [base, base + np.array([s * 0.5, 0.1, 0.7]), base + np.array([s * 0.9, 0.2, 1.6]), base + np.array([s * 1.1, 0.3, 2.4])]
            for i in range(3):
                out = np.minimum(out, sdf.capsule(pts[i], pts[i + 1], 0.09 - 0.02 * i, 0.07 - 0.02 * i)(p))
                tine = pts[i + 1] + np.array([-s * 0.25, 0.05, 0.55])
                out = np.minimum(out, sdf.capsule(pts[i + 1], tine, 0.05, 0.015)(p))
        return out

    def plinth(p):
        return sdf.box((0, 0, 0.8), (1.5, 1.5, 0.8), 0.06)(p)

    def moss(p):
        return np.minimum(body(p), antlers(p)) + (sdf.fbm(p, 1.2, 3, seed + 2) < 0.42) * 0.2

    def field(p):
        return np.minimum(np.minimum(body(p), antlers(p)), plinth(p))

    o = sculpt(name, field, (-2.2, -1.8, -0.05), (2.2, 1.8, 8.6), 0.035, 11000, [(plinth, BRICK), (body, MARBLE), (antlers, BARK2), (moss, MOSSWOOD)])
    export_sculpt(name, o, [box('c', (3, 3, 1.6), (0, 0, 0.8)), cylinder('c2', 0.9, 4.5, (0, 0, 1.6), sides=8)], seed)


def stones(name='stones', seed=481):
    """A run of broken paving slabs, tilted by roots (laid along +Y)."""
    rng = np.random.default_rng(seed)
    parts = []
    for i in range(10):
        for j in range(2):
            if rng.random() < 0.18:
                continue
            w, d = rng.uniform(1.0, 1.4), rng.uniform(0.9, 1.3)
            parts.append(box(f's{i}{j}', (w, d, 0.22), ((j - 0.5) * 1.35 + rng.uniform(-0.1, 0.1), i * 1.25, 0.05 + rng.uniform(0, 0.08)), BRICK,
                             rot=(rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), rng.uniform(-0.15, 0.15)), bevel=0.04))
    finish(name, parts, None, None, seed)


PIECES = {
    'tree_giant': lambda: tree('tree_giant', 30.0, 3.0, 1.6, 7, 401, (0.03, 0.0), voxel=0.16, budget=16000, crown=1.0),
    'tree_a': lambda: tree('tree_a', 17.0, 1.0, 0.55, 5, 402, (0.05, 0.02), voxel=0.08, budget=10000),
    'tree_b': lambda: tree('tree_b', 14.0, 0.85, 0.45, 4, 403, (-0.06, 0.04), voxel=0.07, budget=9000, leafset=BLIGHT),
    'tree_dead': lambda: tree('tree_dead', 12.0, 0.9, 0.35, 4, 404, (0.08, -0.03), canopy=False, voxel=0.06, budget=6000),
    'roots_arch': roots_arch, 'root_wall': root_wall, 'shrine': shrine, 'gate': gate, 'log': log,
    'mushrooms': lambda: mushrooms('mushrooms', 461), 'mushroom_giant': lambda: mushrooms('mushroom_giant', 462, giant=True),
    'rocks_a': lambda: rocks('rocks_a', 4.0, 491), 'rocks_b': lambda: rocks('rocks_b', 2.2, 492),
    'bush_a': lambda: bush('bush_a', 1.8, 493), 'bush_b': lambda: bush('bush_b', 1.2, 494, BLIGHT),
    'statue_sylvaris': statue_sylvaris, 'stones': stones,
}

names = ARGS or list(PIECES)
for nme in names:
    reset()
    print('---', nme, flush=True)
    PIECES[nme]()
