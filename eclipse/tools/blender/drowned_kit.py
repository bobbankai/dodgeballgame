"""The Drowned Empire kit: the sunken imperial city of Chapter Two.

  /opt/bvenv/bin/python eclipse/tools/blender/drowned_kit.py [piece ...] [--no-ao]

Writes public/assets/env/drowned/<piece>.glb (same conventions as ashen_kit.py: metric UVs,
`env:<set>` materials, damage booleans, BVH ambient occlusion, `<piece>_col` collision).

Pieces: column, column_broken, colonnade, arch, aqueduct, temple, insula, bridge, steps_wide,
tier, statue_emperor, rocks_a/b, coral_a/b, boat, lamp, stele.
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
                    export_piece, rock_cutter, material as env_material)

OUT = os.path.join(ASSETS, 'env', 'drowned')
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
AO = '--no-ao' not in sys.argv

BLOCK = 'sea_sandstone_blocks'
BRICK = 'sea_seaworn_brick'
MOSS = 'sea_mossy_wall'
MARBLE = 'sun_marble#sea'
COBBLE = 'sea_mossy_cobble'
ROCK = 'sea_pitted_rock'
CORAL = 'sea_coral_wall'
BRONZE = 'cloth_rust#verdigris'
WOOD = 'ash_wood#wet'


def finish(name, parts, cols, dmg=None, seed=0):
    obj = join(parts, name)
    if dmg:
        damage(obj, dmg, seed=seed, radius=(0.4, 1.0))
    metric_uv(obj, seed=seed + 1)
    if AO:
        subdivide_long_edges(obj, 1.8)
        bake_ao(obj)
    col = collision(name, cols) if cols else None
    export_piece(os.path.join(OUT, f'{name}.glb'), obj, col, ao=AO)


def sculpt(name, field, lo, hi, voxel, budget, mats):
    v, f = sdf.mesh(field, np.array(lo), np.array(hi), voxel)
    o = mesh_from_arrays(name, v, f)
    decimate(o, target_tris=budget)
    shade_smooth(o, angle=50)
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


def fluted_shaft(name, r, h, z0=0.0, flutes=20, mat=MARBLE):
    """A column shaft with entasis (a slight swelling) and shallow flutes."""
    c = cylinder(name, r, h, (0, 0, z0), mat, sides=flutes * 2, r2=r * 0.86)
    for v in c.data.vertices:
        z = (v.co.z - 0) / h
        a = math.atan2(v.co.y, v.co.x)
        flute = 1 - 0.035 * (0.5 + 0.5 * math.cos(a * flutes))
        ent = 1 + 0.035 * math.sin(math.pi * min(1, max(0, z)))
        v.co.x *= flute * ent
        v.co.y *= flute * ent
    return c


def column_parts(x, y, h=7.0, r=0.42, broken_at=None, seed=0):
    parts = [
        box(f'plinth{x}{y}', (r * 2.6, r * 2.6, 0.3), (x, y, 0.15), BLOCK, bevel=0.03),
        cylinder(f'torus{x}{y}', r * 1.18, 0.22, (x, y, 0.3), MARBLE, sides=32, r2=r * 1.05),
    ]
    sh = h if broken_at is None else broken_at
    s = fluted_shaft(f'shaft{x}{y}', r, sh, 0.52)
    s.location = (x, y, 0.52)
    parts.append(s)
    if broken_at is None:
        parts += [cylinder(f'echinus{x}{y}', r * 0.88, 0.25, (x, y, 0.52 + h), MARBLE, sides=32, r2=r * 1.25),
                  box(f'abacus{x}{y}', (r * 2.7, r * 2.7, 0.22), (x, y, 0.52 + h + 0.36), MARBLE, bevel=0.02)]
    return parts


def column(name='column', seed=101):
    parts = column_parts(0, 0)
    finish(name, parts, [cylinder('c', 0.5, 8.0, (0, 0, 0), sides=10)], None, seed)


def column_broken(name='column_broken', seed=102):
    parts = column_parts(0, 0, broken_at=3.4)
    top = parts[-1]
    boolean(top, rock_cutter('snap', Vector((0.15, 0.1, 0.52 + 3.4)), 0.55, seed, squash=(1.2, 1.2, 0.6)))
    # the fallen drums beside it
    for i in range(3):
        d = fluted_shaft(f'drum{i}', 0.4, 1.1)
        d.rotation_euler = (math.pi / 2, 0, 0.4 + i * 0.3)
        d.location = (1.4 + i * 1.15, -0.6 + i * 0.25, 0.42)
        parts.append(d)
    finish(name, parts, [cylinder('c', 0.5, 4.0, (0, 0, 0), sides=10), box('c2', (3.6, 1.2, 0.85), (2.6, -0.3, 0.42))], None, seed)


def colonnade(name='colonnade', n=5, span=3.2, seed=103):
    parts = []
    L = (n - 1) * span
    for i in range(n):
        parts += column_parts(-L / 2 + i * span, 0)
    top = 0.52 + 7.0 + 0.47
    parts += [
        box('architrave', (L + 1.4, 1.2, 0.8), (0, 0, top + 0.4), MARBLE, bevel=0.03),
        box('frieze', (L + 1.4, 1.1, 0.7), (0, 0, top + 1.15), BLOCK, bevel=0.02),
        box('cornice', (L + 1.9, 1.5, 0.3), (0, 0, top + 1.65), MARBLE, bevel=0.04),
        box('stylobate', (L + 2.2, 2.6, 0.4), (0, 0, -0.2), BLOCK, bevel=0.03),
    ]
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-L / 2, L / 2), rng.choice([-0.6, 0.6]), top + 1.7)) for _ in range(3)]
    cols = [cylinder(f'c{i}', 0.5, 8.0, (-L / 2 + i * span, 0, 0), sides=8) for i in range(n)]
    cols.append(box('ct', (L + 1.9, 1.5, 2.2), (0, 0, top + 0.9)))
    finish(name, parts, cols, dmg, seed)


def arch(name='arch', seed=104):
    """A triumphal arch: two piers and a semicircular vault, attic storey above."""
    body = box('body', (11, 3.2, 12), (0, 0, 6), BLOCK, bevel=0.05)
    cut = join([box('opening', (5.6, 5, 7.4), (0, 0, 3.7)), cylinder('vault', 2.8, 5, (0, 2.5, 7.4), rot=(math.pi / 2, 0, 0), sides=40)], 'cut')
    boolean(body, cut)
    parts = [body, box('attic', (11.4, 3.5, 2.4), (0, 0, 13.2), MARBLE, bevel=0.04), box('cornice', (11.8, 3.8, 0.35), (0, 0, 12.1), MARBLE, bevel=0.03)]
    for s in (-1, 1):
        for y in (-1.7, 1.7):
            parts += column_parts(s * 4.1, y, h=6.6, r=0.36)
    parts.append(box('keystone', (0.9, 3.3, 1.2), (0, 0, 10.0), MARBLE, bevel=0.04))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-5, 5), rng.choice([-1.7, 1.7]), 14.3)) for _ in range(3)] + [Vector((5.3, 1.4, 12.6))]
    cols = [box('c1', (2.7, 3.2, 12), (-4.15, 0, 6)), box('c2', (2.7, 3.2, 12), (4.15, 0, 6)), box('c3', (5.6, 3.2, 4.6), (0, 0, 12.1))]
    finish(name, parts, cols, dmg, seed)


def aqueduct(name='aqueduct', bays=3, bay=6.0, seed=105):
    """Two tiers of arches carrying the water channel (the game pours waterfalls from its ends)."""
    L = bays * bay
    lower = box('lower', (L, 2.4, 9), (0, 0, 4.5), BRICK, bevel=0.04)
    for i in range(bays):
        x = -L / 2 + bay / 2 + i * bay
        boolean(lower, join([box(f'lo{i}', (bay - 1.8, 4, 5.5), (x, 0, 2.75)), cylinder(f'la{i}', (bay - 1.8) / 2, 4, (x, 2, 5.5), rot=(math.pi / 2, 0, 0), sides=32)], 'cut'))
    upper = box('upper', (L, 1.9, 5), (0, 0, 11.5), BRICK, bevel=0.04)
    for i in range(bays * 2):
        x = -L / 2 + bay / 4 + i * bay / 2
        boolean(upper, join([box(f'uo{i}', (bay / 2 - 1.0, 3, 2.6), (x, 0, 10.3)), cylinder(f'ua{i}', (bay / 2 - 1.0) / 2, 3, (x, 1.5, 11.6), rot=(math.pi / 2, 0, 0), sides=24)], 'cut'))
    channel = box('channel', (L, 2.2, 1.2), (0, 0, 14.6), BLOCK, bevel=0.03)
    boolean(channel, box('trough', (L + 1, 1.4, 1.0), (0, 0, 15.0)))
    parts = [lower, upper, channel, box('cornice', (L, 2.7, 0.3), (0, 0, 9.0), MOSS)]
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-L / 2, L / 2), rng.choice([-1, 1]), 15.2)) for _ in range(3)]
    cols = [box(f'p{i}', (1.8, 2.4, 9), (-L / 2 + i * bay, 0, 4.5)) for i in range(bays + 1)] + [box('top', (L, 2.4, 6.4), (0, 0, 12.0))]
    finish(name, parts, cols, dmg, seed)


def temple(name='temple', seed=106):
    """A temple front: six columns on a stepped podium, the pediment above, the cella behind."""
    W, D = 14.0, 18.0
    parts = []
    for i in range(3):
        parts.append(box(f'step{i}', (W + 2.4 - i * 0.8, D + 2.4 - i * 0.8, 0.45), (0, 0, 0.225 + i * 0.45), BLOCK, bevel=0.03))
    z0 = 1.35
    for i in range(6):
        x = -W / 2 + 1.2 + i * (W - 2.4) / 5
        for p in column_parts(x, -D / 2 + 1.4, h=8.0, r=0.48):
            p.location.z += z0
            parts.append(p)
    top = z0 + 0.52 + 8.0 + 0.5
    parts += [box('architrave', (W + 0.4, D, 1.0), (0, 0, top + 0.5), MARBLE, bevel=0.03), box('cornice', (W + 1.0, D + 0.6, 0.35), (0, 0, top + 1.15), MARBLE, bevel=0.04)]
    # pediment: a low triangular prism over the front
    v = np.array([[-W / 2 - 0.4, -D / 2, 0], [W / 2 + 0.4, -D / 2, 0], [0, -D / 2, 3.2], [-W / 2 - 0.4, D / 2, 0], [W / 2 + 0.4, D / 2, 0], [0, D / 2, 3.2]])
    f = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    ped = mesh_from_arrays('pediment', v, f)
    ped.location = (0, 0, top + 1.3)
    ped.data.materials.append(env_material(MARBLE))
    parts.append(ped)
    cella = box('cella', (W - 3, D - 5, 9), (0, 2.0, z0 + 4.5), BLOCK, bevel=0.04)
    boolean(cella, box('cellain', (W - 4.6, D - 6.6, 10), (0, 2.0, z0 + 5.5)))
    boolean(cella, box('door', (3.2, 3, 6), (0, -D / 2 + 2.5, z0 + 3)))
    parts.append(cella)
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-W / 2, W / 2), rng.uniform(-D / 2, D / 2), top + 2)) for _ in range(4)]
    cols = [box(f's{i}', (W + 2.4 - i * 0.8, D + 2.4 - i * 0.8, 0.45 * (i + 1)), (0, 0, 0.225 * (i + 1))) for i in range(3)]
    cols += [cylinder(f'c{i}', 0.55, 9, (-W / 2 + 1.2 + i * (W - 2.4) / 5, -D / 2 + 1.4, z0), sides=8) for i in range(6)]
    cols += [box('cw1', (0.8, D - 5, 9), (-(W - 3) / 2 + 0.4, 2, z0 + 4.5)), box('cw2', (0.8, D - 5, 9), ((W - 3) / 2 - 0.4, 2, z0 + 4.5)),
             box('cw3', (W - 3, 0.8, 9), (0, 2 + (D - 5) / 2 - 0.4, z0 + 4.5)), box('cw4', (W / 2 - 3.1, 0.8, 9), (-(W / 2 - 3.1) / 2 - 1.6, -D / 2 + 2.9, z0 + 4.5)),
             box('cw5', (W / 2 - 3.1, 0.8, 9), ((W / 2 - 3.1) / 2 + 1.6, -D / 2 + 2.9, z0 + 4.5))]
    finish(name, parts, cols, dmg, seed)


def insula(name='insula', w=10.0, d=8.0, h=9.0, seed=107):
    """A ruined apartment block: arched ground-floor shops, small windows above, roof gone."""
    walls = [box('wf', (w, 0.6, h), (0, -d / 2, h / 2), BRICK, bevel=0.03), box('wb', (w, 0.6, h), (0, d / 2, h / 2), BRICK, bevel=0.03),
             box('wl', (0.6, d, h), (-w / 2, 0, h / 2), BRICK, bevel=0.03), box('wr', (0.6, d, h), (w / 2, 0, h / 2), BRICK, bevel=0.03)]
    shell = join(walls, 'shell')
    for i in range(3):
        x = -w / 3 + i * w / 3
        boolean(shell, join([box(f'shop{i}', (2.0, 2, 2.6), (x, -d / 2, 1.3)), cylinder(f'sa{i}', 1.0, 2, (x, -d / 2 + 1, 2.6), rot=(math.pi / 2, 0, 0), sides=20)], 'cut'))
        for z in (5.0, 7.6):
            boolean(shell, box(f'win{i}{z}', (0.9, 2, 1.2), (x, -d / 2, z)))
    parts = [shell, box('floor2', (w - 0.6, d - 0.6, 0.3), (0, 0, 4.0), BLOCK), box('band', (w + 0.2, d + 0.2, 0.25), (0, 0, 4.0), MOSS)]
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-w / 2, w / 2), rng.choice([-d / 2, d / 2]), h)) for _ in range(4)] + [Vector((w / 2, rng.uniform(-d / 2, d / 2), h - 1))]
    cols = [box('c1', (w, 0.6, h), (0, -d / 2, h / 2)), box('c2', (w, 0.6, h), (0, d / 2, h / 2)), box('c3', (0.6, d, h), (-w / 2, 0, h / 2)), box('c4', (0.6, d, h), (w / 2, 0, h / 2))]
    finish(name, parts, cols, dmg, seed)


def bridge(name='bridge', span=16.0, width=4.0, seed=108):
    deck = box('deck', (span, width, 1.0), (0, 0, 5.5), BLOCK, bevel=0.04)
    under = box('under', (span, width, 5.5), (0, 0, 2.75), BRICK, bevel=0.04)
    boolean(under, cylinder('vault', span * 0.36, width + 2, (0, width / 2 + 1, -0.6), rot=(math.pi / 2, 0, 0), sides=48))
    parts = [deck, under]
    for s in (-1, 1):
        parts.append(box(f'parapet{s}', (span, 0.4, 0.9), (0, s * (width / 2 - 0.2), 6.45), MARBLE, bevel=0.03))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-span / 2, span / 2), rng.choice([-1, 1]) * width / 2, 6.8)) for _ in range(3)]
    cols = [box('c1', (span, width, 6.0), (0, 0, 3.0)), box('c2', (span, 0.4, 1.2), (0, width / 2 - 0.2, 6.6)), box('c3', (span, 0.4, 1.2), (0, -width / 2 + 0.2, 6.6))]
    finish(name, parts, cols, dmg, seed)


def steps_wide(name='steps_wide', width=10.0, rise=3.0, seed=109):
    n = int(rise / 0.25)
    run = 0.42
    parts = [box(f's{i}', (width, run + 0.02, (i + 1) * 0.25), (0, i * run + run / 2, (i + 1) * 0.125), BLOCK, bevel=0.02) for i in range(n)]
    L = n * run
    ramp = box('ramp', (width, math.hypot(L, rise) + 0.3, 0.4), (0, L / 2, rise / 2 - 0.15), rot=(math.atan2(rise, L), 0, 0))
    finish(name, parts, [ramp], None, seed)


def tier(name='tier', r0=24.0, rows=7, arc=math.radians(30), seed=110):
    """One wedge of amphitheatre seating (the game places twelve round the arena)."""
    parts = []
    for i in range(rows):
        r = r0 + i * 1.0
        seg = cylinder(f'row{i}', r + 1.0, 0.5 * (i + 1), (0, 0, 0), BLOCK, sides=64)
        boolean(seg, cylinder(f'in{i}', r, 0.5 * (i + 1) + 2, (0, 0, -1), sides=64))
        # keep only the wedge
        half = math.tan(arc / 2)
        wedge = mesh_from_arrays('wedge', np.array([[0, 0, -1], [60, -60 * half, -1], [60, 60 * half, -1], [0, 0, 10], [60, -60 * half, 10], [60, 60 * half, 10]]),
                                 [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)])
        boolean(seg, wedge, op='INTERSECT')
        parts.append(seg)
    rng = np.random.default_rng(seed)
    dmg = [Vector((math.cos(a) * (r0 + rows - 1), math.sin(a) * (r0 + rows - 1), rows * 0.5)) for a in rng.uniform(-arc / 2, arc / 2, 2)]
    cols = []
    for i in range(rows):
        r = r0 + i + 0.5
        L = 2 * r * math.tan(arc / 2)
        cols.append(box(f'c{i}', (1.0, L, 0.5 * (i + 1)), (r, 0, 0.25 * (i + 1))))
    finish(name, parts, cols, dmg, seed)


def statue_emperor(name='statue_emperor', seed=111):
    """The drowned emperor: robed, crowned, one arm raised toward the sea; barnacled and worn."""
    def body(p):
        robe = sdf.capsule((0, 0, 1.7), (0, 0.05, 4.6), 0.85, 0.55)(p)
        skirt = sdf.capsule((0, 0, 1.6), (0, 0, 3.2), 1.0, 0.75)(p)
        head = sdf.sphere((0, -0.05, 5.35), 0.42)(p)
        arm_r = sdf.capsule((-0.65, 0, 4.6), (-1.1, -0.4, 6.4), 0.2, 0.16)(p)
        arm_l = sdf.capsule((0.65, 0, 4.5), (0.9, -0.5, 3.6), 0.2, 0.16)(p)
        crown = np.maximum(np.abs(sdf.cylinder((0, -0.05, 5.6), (0, -0.05, 5.95), 0.4)(p)) - 0.04, -sdf.cylinder((0, -0.05, 5.5), (0, -0.05, 6.1), 0.34)(p))
        d = np.minimum(np.minimum(robe, skirt), np.minimum(head, np.minimum(arm_r, arm_l)))
        d = np.minimum(d, crown)
        folds = 0.03 * np.sin(np.arctan2(p[:, 1], p[:, 0]) * 14) * (p[:, 2] < 4.6)
        return d - folds + 0.02 * (sdf.fbm(p, 6, 2, seed) - 0.5)

    def plinth(p):
        return sdf.box((0, 0, 0.8), (1.5, 1.5, 0.8), 0.06)(p)

    def barnacles(p):
        return body(p) - 0.03 * (sdf.fbm(p, 14, 2, seed + 3) > 0.62)

    def field(p):
        return np.minimum(barnacles(p), plinth(p))

    o = sculpt(name, field, (-2, -2, -0.05), (2, 2, 6.6), 0.035, 9000, [(plinth, BLOCK), (body, MARBLE)])
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, collision(name, [box('c', (3, 3, 1.6), (0, 0, 0.8)), cylinder('c2', 0.9, 4.5, (0, 0, 1.6), sides=8)]), ao=AO)


def rocks(name='rocks_a', size=4.0, seed=121):
    rng = np.random.default_rng(seed)
    blobs = []
    for _ in range(5):
        c = (rng.uniform(-size * 0.3, size * 0.3), rng.uniform(-size * 0.3, size * 0.3), rng.uniform(-0.2, size * 0.15))
        blobs.append(sdf.ellipsoid(c, tuple(rng.uniform(0.25, 0.5, 3) * size * np.array([1, 0.9, 0.6]))))
    base = sdf.union(*blobs)

    def rock(p):
        return base(p) + 0.15 * (sdf.fbm(p, 1.2 / size * 3, 4, seed) - 0.5) * size * 0.4

    def barn(p):
        return rock(p) - 0.04 * (sdf.fbm(p, 9, 2, seed + 1) > 0.66)

    def field(p):
        return np.maximum(barn(p), -p[:, 2] - 0.3)

    lo, hi = (-size * 0.9, -size * 0.9, -0.35), (size * 0.9, size * 0.9, size * 0.7)
    o = sculpt(name, field, lo, hi, 0.05, 5000, [(rock, ROCK)])
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, collision(name, [cylinder('c', size * 0.45, size * 0.45, (0, 0, -0.3), sides=8, r2=size * 0.25)]), ao=AO)


def coral(name='coral_a', seed=131):
    rng = np.random.default_rng(seed)
    caps = []

    def grow(p0, d, L, r, depth):
        p1 = np.array(p0) + np.array(d) * L
        caps.append((np.array(p0), p1, r))
        if depth < 3:
            for _ in range(2):
                nd = np.array(d) + rng.normal(0, 0.5, 3)
                nd[2] = abs(nd[2]) + 0.3
                grow(p1, nd / np.linalg.norm(nd), L * 0.7, r * 0.7, depth + 1)

    for _ in range(4):
        a = rng.uniform(0, math.tau)
        grow((math.cos(a) * 0.3, math.sin(a) * 0.3, 0), (math.cos(a) * 0.3, math.sin(a) * 0.3, 1), 0.6, 0.09, 0)

    def field(p):
        d = np.full(len(p), 1e3)
        for a, b, r in caps:
            d = np.minimum(d, sdf.capsule(a, b, r, r * 0.75)(p))
        return d + 0.01 * (sdf.fbm(p, 20, 2, seed) - 0.5)

    o = sculpt(name, field, (-1.6, -1.6, -0.1), (1.6, 1.6, 2.2), 0.02, 3500, [(None, CORAL)])
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, None, ao=AO)


def boat(name='boat', seed=141):
    """A broken imperial galley's bow, half sunk at an angle."""
    def hull(p):
        q = p.copy()
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        w = 1.5 * np.clip(1 - (np.maximum(0, -y) / 6.0) ** 2, 0, 1)
        d = np.hypot(x / np.maximum(w, 0.05), np.maximum(0, -z + 0.8) / 1.2) - 1.0
        shell = np.maximum(np.abs(d) - 0.08, np.maximum(z - 1.4, np.maximum(-y - 6.0, y - 1.5)))
        broken = (sdf.fbm(p, 1.5, 3, seed) - 0.5) * 3 + (y - 0.5)
        return np.maximum(shell, broken)

    o = sculpt(name, hull, (-2, -6.5, -0.6), (2, 2.5, 1.6), 0.04, 5000, [(None, WOOD)])
    o.rotation_euler = (0.2, 0.25, 0)
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, collision(name, [box('c', (3, 7, 1.6), (0, -2.5, 0.6), rot=(0.2, 0.25, 0))]), ao=AO)


def lamp(name='lamp', seed=151):
    parts = [cylinder('base', 0.35, 0.4, (0, 0, 0), BRONZE, sides=12, r2=0.25), cylinder('pole', 0.07, 3.2, (0, 0, 0.4), BRONZE, sides=10),
             box('arm', (0.9, 0.08, 0.08), (0.4, 0, 3.4), BRONZE), cylinder('cage', 0.2, 0.45, (0.8, 0, 2.95), BRONZE, sides=6, r2=0.14)]
    finish(name, parts, [cylinder('c', 0.3, 3.6, (0, 0, 0), sides=6)], None, seed)


def stele(name='stele', seed=161):
    s = box('slab', (1.4, 0.4, 2.6), (0, 0, 1.3), MARBLE, bevel=0.04)
    boolean(s, rock_cutter('chip', Vector((0.6, 0, 2.6)), 0.4, seed))
    finish(name, [s, box('foot', (1.8, 0.8, 0.3), (0, 0, 0.15), BLOCK, bevel=0.03)], [box('c', (1.4, 0.5, 2.6), (0, 0, 1.3))], None, seed)


PIECES = {
    'column': column, 'column_broken': column_broken, 'colonnade': colonnade, 'arch': arch, 'aqueduct': aqueduct,
    'temple': temple, 'insula': insula, 'bridge': bridge, 'steps_wide': steps_wide, 'tier': tier, 'statue_emperor': statue_emperor,
    'rocks_a': lambda: rocks('rocks_a', 4.0, 121), 'rocks_b': lambda: rocks('rocks_b', 2.5, 122),
    'coral_a': lambda: coral('coral_a', 131), 'coral_b': lambda: coral('coral_b', 132), 'boat': boat, 'lamp': lamp, 'stele': stele,
}

names = ARGS or list(PIECES)
for n in names:
    reset()
    print('---', n, flush=True)
    PIECES[n]()
