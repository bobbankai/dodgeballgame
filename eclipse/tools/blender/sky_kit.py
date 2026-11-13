"""The Shattered Sky kit: the sky-monastery of Aethel Spire, torn into floating islands (Chapter Three).

  /opt/bvenv/bin/python eclipse/tools/blender/sky_kit.py [piece ...] [--no-ao]

Writes public/assets/env/sky/<piece>.glb (same conventions as ashen_kit.py / drowned_kit.py: metric
UVs, `env:<set>` materials, damage booleans, BVH ambient occlusion, `<piece>_col` collision).

Pieces: island_a/b/c (walkable floating islands; their collision is a decimated copy of the
sculpt), arena (the Stormcrown: a paved island ring), tower, hall, cloister, shrine, bridge (rope
and plank, sagging), stairs, wall_ruin, pillar_flags, bell, spire, statue_vaeltris, debris_a/b.
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

OUT = os.path.join(ASSETS, 'env', 'sky')
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
AO = '--no-ao' not in sys.argv

STONE = 'sky_old_stone'
FLOOR = 'sky_monastery_floor'
SLATE = 'sky_slate_tiles'
PLANK = 'sky_planks'
CLIFF = 'sky_cliff_side'
GRASS = 'sky_grass_rock'
WOOD = 'ash_wood'
COPPER = 'cloth_rust#verdigris'
CLOTH = 'cloth_leather_red'
MARBLE = 'sun_marble'


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
    return o, v, f


def proxy_from(name, verts, faces, tris):
    """A decimated copy of a sculpt as its collision (walkable tops must match what is drawn)."""
    o = mesh_from_arrays(name + '_cp', verts, faces)
    decimate(o, target_tris=tris)
    return o


# ============================================================================== floating islands
def island_field(R, depth, seed, bumps=0.25):
    def h_top(x, y):
        q = np.column_stack([x, y, np.zeros_like(x)])
        return bumps * (sdf.fbm(q, 0.08, 3, seed + 7) - 0.5)

    def edge(x, y):
        ang = np.arctan2(y, x)
        q = np.column_stack([np.cos(ang) * 3, np.sin(ang) * 3, np.zeros_like(x)])
        return R * (1 + 0.1 * np.sin(3 * ang + seed) + 0.06 * np.sin(5 * ang + 2 * seed) + 0.18 * (sdf.fbm(q, 0.6, 3, seed) - 0.5))

    def top(p):
        return p[:, 2] - h_top(p[:, 0], p[:, 1])

    def body(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        r = np.hypot(x, y)
        e = edge(x, y)
        # an inverted cone, deeper and lumpier toward its middle: the rock the island tore out with
        dd = depth * (0.75 + 0.5 * sdf.fbm(np.column_stack([x, y, np.zeros_like(x)]), 0.12, 3, seed + 3))
        k = np.clip(1 + z / dd, 0, 1) ** 0.55
        return r - e * k

    def field(p):
        d = np.maximum(top(p), body(p))
        rough = (sdf.fbm(p, 0.45, 4, seed + 11) - 0.5) * 0.9 * (p[:, 2] < -0.35)
        return d - rough

    return field, top, body


def island(name, R, depth, seed, voxel, budget):
    field, top, body = island_field(R, depth, seed)
    lo, hi = (-R * 1.35, -R * 1.35, -depth * 1.3), (R * 1.35, R * 1.35, 0.6)
    o, v, f = sculpt(name, field, lo, hi, voxel, budget, [(top, GRASS), (body, CLIFF)])
    # the walkable top stays grass only where it is truly flat: the rim falls away to cliff
    me = o.data
    co = verts_np(o, world=False)
    idx = np.array([p.material_index for p in me.polygons])
    for k, poly in enumerate(me.polygons):
        if poly.normal.z < 0.75:
            idx[k] = 1
    me.polygons.foreach_set('material_index', idx)
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o, distance=2.5, ground=False)
    col = proxy_from(name, v, f, 900)
    col.name = name + '_col'
    col.data.materials.clear()
    export_piece(os.path.join(OUT, f'{name}.glb'), o, col, ao=AO)


def arena(name='arena', seed=231):
    """The Stormcrown: a paved disc on a great island, a ring of broken parapet and rune stones."""
    R = 22.0
    field, top, body = island_field(R + 3, 16, seed, bumps=0.0)

    def paved(p):
        return np.maximum(p[:, 2] - 0.02, np.hypot(p[:, 0], p[:, 1]) - R)

    def full(p):
        return np.minimum(field(p), paved(p))

    lo, hi = (-(R + 3) * 1.35, -(R + 3) * 1.35, -22), ((R + 3) * 1.35, (R + 3) * 1.35, 0.6)
    o, v, f = sculpt(name + '_rock', full, lo, hi, 0.2, 14000, [(top, GRASS), (body, CLIFF)])
    me = o.data
    idx = np.array([p.material_index for p in me.polygons])
    co = verts_np(o, world=False)
    for k, poly in enumerate(me.polygons):
        c = poly.center
        if poly.normal.z < 0.75:
            idx[k] = 1
        elif math.hypot(c.x, c.y) < R + 0.4:
            idx[k] = 2
    me.materials.append(env_material(FLOOR))
    me.polygons.foreach_set('material_index', idx)
    parts = [o]
    # the rune ring: a raised stone kerb with gaps, and broken parapet blocks round the rim
    rng = np.random.default_rng(seed)
    for i in range(24):
        a = i / 24 * math.tau
        if i % 6 == 0:
            continue
        h = rng.uniform(0.5, 1.4) if i % 3 else rng.uniform(1.6, 2.4)
        b = box(f'par{i}', (2.6, 0.7, h), (math.cos(a) * (R - 0.4), math.sin(a) * (R - 0.4), h / 2), STONE, rot=(0, 0, a + math.pi / 2), bevel=0.04)
        parts.append(b)
    for i in range(8):
        a = (i + 0.5) / 8 * math.tau
        parts.append(box(f'rune{i}', (0.9, 0.5, 2.8), (math.cos(a) * (R * 0.62), math.sin(a) * (R * 0.62), 1.4), MARBLE, rot=(0, 0, a), bevel=0.06))
    obj = join(parts, name)
    metric_uv(obj, seed=seed + 1)
    if AO:
        bake_ao(obj, distance=2.5, ground=False)
    col_rock = proxy_from(name, v, f, 1400)
    cols = [col_rock]
    for i in range(24):
        if i % 6 == 0:
            continue
        a = i / 24 * math.tau
        cols.append(box(f'cp{i}', (2.6, 0.7, 1.6), (math.cos(a) * (R - 0.4), math.sin(a) * (R - 0.4), 0.8), rot=(0, 0, a + math.pi / 2)))
    for i in range(8):
        a = (i + 0.5) / 8 * math.tau
        cols.append(box(f'cr{i}', (0.9, 0.5, 2.8), (math.cos(a) * (R * 0.62), math.sin(a) * (R * 0.62), 1.4), rot=(0, 0, a)))
    col = collision(name, cols)
    export_piece(os.path.join(OUT, f'{name}.glb'), obj, col, ao=AO)


# ============================================================================== monastery
def arched_cut(name, w, d, h, loc, sides=24):
    """A doorway or window opening: a box with a round head, cutting along Y."""
    x, y, z = loc
    return join([box(name + 'b', (w, d, h - w / 2), (x, y, z + (h - w / 2) / 2)),
                 cylinder(name + 'c', w / 2, d, (x, y + d / 2, z + h - w / 2), rot=(math.pi / 2, 0, 0), sides=sides)], name)


def tower(name='tower', seed=241):
    """A round monastery tower: battered base, arched windows, a conical slate roof, a door."""
    R, H = 4.2, 15.0
    wall = cylinder('wall', R, H, (0, 0, 0), STONE, sides=40, r2=R * 0.93)
    boolean(wall, cylinder('hollow', R - 0.7, H + 2, (0, 0, 0.6), sides=40, r2=R * 0.93 - 0.7))
    boolean(wall, arched_cut('door', 1.8, 3, 3.4, (0, -R, 0.3)))
    for k, (zz, a) in enumerate([(6.0, 0.4), (6.0, 2.5), (10.5, 1.4), (10.5, 3.8), (10.5, 5.3)]):
        c = arched_cut(f'win{k}', 0.9, 3, 1.9, (0, -R, zz))
        c.rotation_euler = (0, 0, a)
        c.location = (math.sin(a) * 0, 0, 0)
        boolean(wall, c)
    base = cylinder('base', R + 0.6, 1.2, (0, 0, 0), STONE, sides=40, r2=R + 0.2)
    boolean(base, arched_cut('door2', 1.8, 3, 3.4, (0, -R, 0.3)))
    ring = cylinder('ring', R + 0.35, 0.35, (0, 0, H - 0.2), STONE, sides=40)
    roof = cylinder('roof', R + 0.9, 7.0, (0, 0, H), SLATE, sides=40, r2=0.15)
    finial = cylinder('finial', 0.12, 2.2, (0, 0, H + 6.8), COPPER, sides=8, r2=0.03)
    floor = cylinder('floor', R - 0.6, 0.3, (0, 0, 0), FLOOR, sides=32)
    rng = np.random.default_rng(seed)
    dmg = [Vector((math.cos(a) * R, math.sin(a) * R, H - 1.0)) for a in rng.uniform(0, math.tau, 2)]
    cols = [box('c1', (2 * R, 2 * R - 3.0, H), (0, 1.5, H / 2)), box('c2', (2 * R - 2.0, 1.0, H - 3.6), (0, -R + 0.5, 3.6 + (H - 3.6) / 2)),
            box('c3', (R - 0.9, 1.6, 3.6), (-(R + 0.9) / 2 - 0.0, -R + 0.8, 1.8)), box('c4', (R - 0.9, 1.6, 3.6), ((R + 0.9) / 2, -R + 0.8, 1.8)),
            cylinder('c5', R + 0.9, 7.0, (0, 0, H), sides=12, r2=0.3)]
    finish(name, [wall, base, ring, roof, finial, floor], cols, dmg, seed)


def hall(name='hall', seed=242):
    """The monastery hall: buttressed stone walls, a steep slate roof, a great arched door."""
    W, D, H = 12.0, 18.0, 8.0
    walls = box('walls', (W, D, H), (0, 0, H / 2), STONE, bevel=0.04)
    boolean(walls, box('inside', (W - 1.4, D - 1.4, H + 1), (0, 0, H / 2 + 0.7)))
    boolean(walls, arched_cut('door', 3.0, 3, 5.0, (0, -D / 2, 0)))
    for s in (-1, 1):
        for k in range(4):
            boolean(walls, arched_cut(f'w{s}{k}', 1.2, 3, 3.0, (s * W / 2, -D / 2 + 3 + k * 4, 3.4)))
    # the window cuts above run along Y; turn them to cut the side walls
    parts = [walls]
    for s in (-1, 1):
        for k in range(5):
            parts.append(box(f'but{s}{k}', (1.0, 0.9, H * 0.85), (s * (W / 2 + 0.45), -D / 2 + 1 + k * 4, H * 0.85 / 2), STONE, bevel=0.04))
    # roof: a triangular prism
    v = np.array([[-W / 2 - 0.6, -D / 2 - 0.5, H], [W / 2 + 0.6, -D / 2 - 0.5, H], [0, -D / 2 - 0.5, H + 6.5],
                  [-W / 2 - 0.6, D / 2 + 0.5, H], [W / 2 + 0.6, D / 2 + 0.5, H], [0, D / 2 + 0.5, H + 6.5]])
    roof = mesh_from_arrays('roof', v, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])
    roof.data.materials.append(env_material(SLATE))
    gables = mesh_from_arrays('gables', v * np.array([0.98, 0.995, 1.0]) + np.array([0, 0, -0.02]), [(0, 1, 2), (3, 5, 4)])
    gables.data.materials.append(env_material(STONE))
    parts += [roof, gables, box('floor', (W - 1.4, D - 1.4, 0.2), (0, 0, 0.1), FLOOR)]
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-W / 2, W / 2), rng.choice([-D / 2, D / 2]), H)) for _ in range(2)]
    cols = [box('c1', (W, 0.7, H), (0, D / 2 - 0.35, H / 2)), box('c2', (0.7, D, H), (-W / 2 + 0.35, 0, H / 2)), box('c3', (0.7, D, H), (W / 2 - 0.35, 0, H / 2)),
            box('c4', ((W - 3) / 2, 0.7, H), (-(W + 3) / 4, -D / 2 + 0.35, H / 2)), box('c5', ((W - 3) / 2, 0.7, H), ((W + 3) / 4, -D / 2 + 0.35, H / 2)),
            box('c6', (3, 0.7, H - 5), (0, -D / 2 + 0.35, 5 + (H - 5) / 2)), box('c7', (W + 1.2, D + 1, 3.0), (0, 0, H + 1.5))]
    finish(name, parts, cols, dmg, seed)


def cloister(name='cloister', bays=4, bay=3.4, seed=243):
    """A covered walk: a row of round arches on piers, a lean-to slate roof, a paved floor."""
    L = bays * bay
    front = box('front', (L + 0.8, 0.8, 4.6), (0, 0, 2.3), STONE, bevel=0.03)
    for i in range(bays):
        x = -L / 2 + bay / 2 + i * bay
        boolean(front, arched_cut(f'a{i}', bay - 0.9, 2, 3.6, (x, 0, 0)))
    back = box('back', (L + 0.8, 0.6, 5.6), (0, 3.6, 2.8), STONE, bevel=0.03)
    floor = box('floor', (L + 0.8, 4.4, 0.25), (0, 1.8, 0.12), FLOOR)
    roof = box('roof', (L + 1.2, 5.2, 0.3), (0, 1.8, 5.3), SLATE, rot=(math.atan2(1.0, 4.4), 0, 0))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-L / 2, L / 2), 1.8, 5.6)) for _ in range(2)]
    cols = [box('c1', (L + 0.8, 0.6, 5.6), (0, 3.6, 2.8)), box('c2', (L + 1.2, 5.2, 0.6), (0, 1.8, 5.3), rot=(math.atan2(1.0, 4.4), 0, 0)),
            box('c3', (L + 0.8, 4.4, 0.25), (0, 1.8, 0.12))]
    for i in range(bays + 1):
        cols.append(box(f'p{i}', (0.9, 0.8, 4.6), (-L / 2 + i * bay, 0, 2.3)))
    finish(name, [front, back, floor, roof], cols, dmg, seed)


def shrine(name='shrine', seed=244):
    """A wayside shrine (checkpoints): four pillars, a two-tier slate roof, a lit altar stone."""
    parts = [box('plinth', (4.4, 4.4, 0.5), (0, 0, 0.25), STONE, bevel=0.05), box('step', (5.0, 5.0, 0.25), (0, 0, 0.125), STONE, bevel=0.04)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(cylinder(f'p{sx}{sy}', 0.22, 3.2, (sx * 1.7, sy * 1.7, 0.5), STONE, sides=12))
    parts += [box('lintel', (4.2, 4.2, 0.35), (0, 0, 3.85), STONE, bevel=0.03),
              cylinder('roof1', 3.4, 1.2, (0, 0, 4.0), SLATE, sides=4, r2=1.8),
              cylinder('roof2', 2.0, 1.4, (0, 0, 5.1), SLATE, sides=4, r2=0.12),
              box('altar', (1.2, 0.9, 1.0), (0, 0.4, 1.0), MARBLE, bevel=0.05),
              cylinder('bowl', 0.4, 0.2, (0, 0.4, 1.5), COPPER, sides=16, r2=0.5)]
    for p in parts:
        if p.name.startswith('roof'):
            p.rotation_euler = (0, 0, math.pi / 4)
    cols = [box('c1', (5.0, 5.0, 0.5), (0, 0, 0.25)), box('c2', (1.2, 0.9, 1.7), (0, 0.4, 0.85))]
    cols += [cylinder(f'c{sx}{sy}', 0.3, 3.7, (sx * 1.7, sy * 1.7, 0), sides=6) for sx in (-1, 1) for sy in (-1, 1)]
    finish(name, parts, cols, None, seed)


def bridge(name='bridge', span=12.0, width=2.4, sag=0.6, seed=245):
    """A rope-and-plank bridge between islands, sagging in the middle (along +Y, ends at y=0 and y=span)."""
    parts = []
    cols = []
    n = int(span / 0.32)
    rng = np.random.default_rng(seed)
    for i in range(n):
        t = (i + 0.5) / n
        y = t * span
        z = -sag * math.sin(math.pi * t)
        tilt = math.atan2(-sag * math.pi * math.cos(math.pi * t), span)
        p = box(f'pl{i}', (width * rng.uniform(0.92, 1.02), 0.28, 0.07), (rng.uniform(-0.05, 0.05), y, z - 0.035), PLANK, rot=(tilt, 0, rng.uniform(-0.03, 0.03)))
        parts.append(p)
    for k in range(6):
        t0, t1 = k / 6, (k + 1) / 6
        z0, z1 = -sag * math.sin(math.pi * t0), -sag * math.sin(math.pi * t1)
        L = math.hypot(span / 6, z1 - z0)
        cols.append(box(f'cd{k}', (width, L + 0.05, 0.3), (0, (t0 + t1) / 2 * span, (z0 + z1) / 2 - 0.15), rot=(math.atan2(z1 - z0, span / 6), 0, 0)))
    # posts and rope rails (tubes along the sag, 1 m above the deck)
    for y in (0.0, span):
        for s in (-1, 1):
            parts.append(cylinder(f'post{y}{s}', 0.11, 1.6, (s * (width / 2 + 0.05), y, -0.4), WOOD, sides=8))
            cols.append(box(f'cpost{y}{s}', (0.24, 0.24, 1.6), (s * (width / 2 + 0.05), y, 0.4)))
    for s in (-1, 1):
        for h in (1.0, 0.55):
            pts = []
            for i in range(25):
                t = i / 24
                pts.append((s * (width / 2 + 0.05), t * span, h - sag * math.sin(math.pi * t) * 0.9))
            for i in range(24):
                a, b = Vector(pts[i]), Vector(pts[i + 1])
                d = b - a
                seg = cylinder(f'rope{s}{h}{i}', 0.03, d.length, tuple(a), CLOTH, sides=6)
                seg.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
                parts.append(seg)
        # side guards so nobody walks off the edge
        cols.append(box(f'cg{s}', (0.2, span, 1.2), (s * (width / 2 + 0.1), span / 2, 0.3)))
    finish(name, parts, cols, None, seed, sub=3.0)


def stairs(name='stairs', width=3.2, rise=4.0, seed=246):
    """Stone stairs with low side walls, rising along -Y (front) to +Y... rise over 7.5 m, top at y=run."""
    n = int(rise / 0.25)
    run = 0.5
    parts = [box(f's{i}', (width, run + 0.02, (i + 1) * 0.25), (0, i * run + run / 2, (i + 1) * 0.125), STONE, bevel=0.02) for i in range(n)]
    L = n * run
    for s in (-1, 1):
        v = np.array([[s * (width / 2 + 0.2), 0, 0], [s * (width / 2 + 0.2), L, 0], [s * (width / 2 + 0.2), L, rise + 0.8], [s * (width / 2 + 0.2), 0, 0.8]])
        wall = box(f'sw{s}', (0.4, L, rise + 0.8), (s * (width / 2 + 0.2), L / 2, (rise + 0.8) / 2), STONE, bevel=0.03)
        cut = box(f'swc{s}', (1.0, math.hypot(L, rise) + 4, 6), (s * (width / 2 + 0.2), L / 2, rise / 2 + 0.8 + 3.0), rot=(math.atan2(rise, L), 0, 0))
        boolean(wall, cut)
        parts.append(wall)
        del v
    ramp = box('ramp', (width, math.hypot(L, rise) + 0.3, 0.4), (0, L / 2, rise / 2 - 0.15), rot=(math.atan2(rise, L), 0, 0))
    cols = [ramp] + [box(f'cw{s}', (0.4, L, rise + 0.8), (s * (width / 2 + 0.2), L / 2, (rise + 0.8) / 2)) for s in (-1, 1)]
    finish(name, parts, cols, None, seed)


def wall_ruin(name='wall_ruin', seed=247):
    w = box('wall', (8.0, 0.9, 5.0), (0, 0, 2.5), STONE, bevel=0.04)
    boolean(w, arched_cut('win', 1.4, 2, 2.6, (1.4, 0, 1.6)))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-4, 4), 0, 5.0)) for _ in range(3)] + [Vector((-4, 0, 3.5)), Vector((4, 0, 4.5))]
    finish(name, [w, box('base', (8.4, 1.3, 0.4), (0, 0, 0.2), STONE, bevel=0.04)], [box('c', (8.0, 0.9, 4.0), (0, 0, 2.0))], dmg, seed)


def pillar_flags(name='pillar_flags', seed=248):
    """A broken pillar with a line of prayer flags strung from it to a leaning pole."""
    parts = [box('base', (1.4, 1.4, 0.5), (0, 0, 0.25), STONE, bevel=0.04), cylinder('shaft', 0.45, 4.6, (0, 0, 0.5), STONE, sides=16, r2=0.4)]
    boolean(parts[1], rock_cutter('snap', Vector((0.1, 0.05, 5.1)), 0.6, seed, squash=(1.2, 1.2, 0.6)))
    pole = cylinder('pole', 0.07, 5.0, (4.5, 0.4, 0), WOOD, sides=8, r2=0.05)
    pole.rotation_euler = (0, -0.12, 0)
    parts.append(pole)
    a, b = Vector((0.0, 0.0, 4.4)), Vector((4.5 + 0.6, 0.4, 4.8))
    rng = np.random.default_rng(seed)
    colours = ['cloth_leather_red', 'cloth_rust', 'cloth_denim', 'cloth_jacquard']
    for i in range(10):
        t = (i + 0.5) / 10
        p = a.lerp(b, t) - Vector((0, 0, 0.6 * math.sin(math.pi * t)))
        f = box(f'flag{i}', (0.32, 0.015, 0.42), (p.x, p.y, p.z - 0.21), colours[i % 4], rot=(rng.uniform(-0.15, 0.15), 0, math.atan2(b.y - a.y, b.x - a.x)))
        parts.append(f)
    for i in range(12):
        t0, t1 = i / 12, (i + 1) / 12
        p0 = a.lerp(b, t0) - Vector((0, 0, 0.6 * math.sin(math.pi * t0)))
        p1 = a.lerp(b, t1) - Vector((0, 0, 0.6 * math.sin(math.pi * t1)))
        d = p1 - p0
        seg = cylinder(f'line{i}', 0.012, d.length, tuple(p0), WOOD, sides=4)
        seg.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        parts.append(seg)
    finish(name, parts, [box('c', (1.4, 1.4, 5.0), (0, 0, 2.5)), cylinder('c2', 0.2, 5.0, (4.5, 0.4, 0), sides=6)], None, seed)


def bell(name='bell', seed=249):
    parts = [box('foot1', (0.8, 0.8, 0.4), (-1.6, 0, 0.2), STONE), box('foot2', (0.8, 0.8, 0.4), (1.6, 0, 0.2), STONE),
             box('post1', (0.35, 0.35, 4.0), (-1.6, 0, 2.4), WOOD), box('post2', (0.35, 0.35, 4.0), (1.6, 0, 2.4), WOOD),
             box('beam', (4.2, 0.4, 0.4), (0, 0, 4.5), WOOD), cylinder('cap', 0.15, 0.4, (0, 0, 4.0), COPPER, sides=12)]

    def bell_f(p):
        z = p[:, 2] - 2.4
        r = np.hypot(p[:, 0], p[:, 1])
        prof = 0.42 + 0.38 * np.clip(1 - z / 1.5, 0, 1) ** 2.2 + 0.06 * np.exp(-((z - 0.05) / 0.08) ** 2)
        outer = np.maximum(r - prof, np.maximum(-z, z - 1.55))
        return np.maximum(outer, -np.maximum(r - (prof - 0.05), np.maximum(-z - 1, z - 1.45)))

    o, _, _ = sculpt('bellbody', bell_f, (-1, -1, 2.2), (1, 1, 4.1), 0.02, 2400, [(None, COPPER)])
    parts.append(o)
    finish(name, parts, [box('c1', (0.8, 0.8, 4.4), (-1.6, 0, 2.2)), box('c2', (0.8, 0.8, 4.4), (1.6, 0, 2.2))], None, seed)


def spire(name='spire', seed=250):
    """A storm spire: a tapering obelisk crowned with copper prongs that call the lightning."""
    parts = [box('base', (2.6, 2.6, 1.0), (0, 0, 0.5), STONE, bevel=0.06), cylinder('shaft', 0.9, 12.0, (0, 0, 1.0), STONE, sides=4, r2=0.35)]
    parts[1].rotation_euler = (0, 0, math.pi / 4)
    parts.append(cylinder('collar', 0.55, 0.4, (0, 0, 12.8), COPPER, sides=16))
    for k in range(5):
        a = k / 5 * math.tau
        prong = cylinder(f'prong{k}', 0.06, 2.2, (math.cos(a) * 0.35, math.sin(a) * 0.35, 13.0), COPPER, sides=6, r2=0.01)
        prong.rotation_euler = (math.sin(a) * -0.3, math.cos(a) * 0.3, 0)
        parts.append(prong)
    parts.append(cylinder('rod', 0.08, 3.4, (0, 0, 13.0), COPPER, sides=8, r2=0.02))
    finish(name, parts, [box('c', (2.6, 2.6, 1.0), (0, 0, 0.5)), cylinder('c2', 0.9, 12, (0, 0, 1.0), sides=6, r2=0.4)], None, seed, sub=2.5)


def statue_vaeltris(name='statue_vaeltris', seed=251):
    """Vaeltris as her priests carved her: robed, winged, a spear of lightning raised."""
    def body(p):
        robe = sdf.capsule((0, 0, 1.7), (0, 0.05, 4.9), 0.75, 0.42)(p)
        skirt = sdf.capsule((0, 0, 1.6), (0, 0, 3.4), 0.95, 0.6)(p)
        head = sdf.sphere((0, -0.05, 5.55), 0.38)(p)
        arm_r = sdf.capsule((-0.55, 0, 4.8), (-0.9, -0.3, 6.6), 0.17, 0.13)(p)
        arm_l = sdf.capsule((0.55, 0, 4.7), (0.8, -0.45, 3.9), 0.17, 0.13)(p)
        spear = sdf.capsule((-1.0, -0.35, 3.0), (-0.85, -0.3, 8.6), 0.06, 0.05)(p)
        tip = sdf.capsule((-0.85, -0.3, 8.6), (-0.82, -0.3, 9.4), 0.14, 0.01)(p)
        d = np.minimum.reduce([robe, skirt, head, arm_r, arm_l, spear, tip])
        folds = 0.03 * np.sin(np.arctan2(p[:, 1], p[:, 0]) * 16) * (p[:, 2] < 4.9)
        return d - folds + 0.015 * (sdf.fbm(p, 6, 2, seed) - 0.5)

    def wings(p):
        """Each wing a fan of long flattened feathers from the shoulder blade, swept up and back,
        over a mass of shorter coverts, smooth-blended so it reads as one carved wing."""
        out = np.full(len(p), 1e3)
        for s in (1, -1):
            root = np.array([s * 0.35, 0.35, 4.75])
            fe = np.full(len(p), 1e3)
            for k in range(8):
                t = k / 7
                ang = math.radians(12 + 68 * t)          # from nearly level to steeply raised
                L = 2.0 + 1.8 * math.sin(math.pi * (0.25 + 0.6 * t))
                d = np.array([s * math.cos(ang), 0.35 + 0.25 * t, math.sin(ang)])
                d /= np.linalg.norm(d)
                a = root + d * 0.3
                b = root + d * L
                f = sdf.capsule(a, b, 0.16, 0.05)(p)
                # flatten each feather into a blade across the wing plane
                n = np.cross(d, np.array([0, 1.0, 0]))
                n /= np.linalg.norm(n) + 1e-9
                thick = np.abs((p - a) @ np.array([0, 1.0, -0.15])) - 0.05
                fe = np.minimum(fe, np.maximum(f, thick))
            cov = sdf.ellipsoid(root + np.array([s * 0.9, 0.25, 0.75]), (1.0, 0.18, 0.7))(p)
            wing = np.minimum(fe, cov) + 0.012 * np.sin(np.arctan2(p[:, 2] - root[2], (p[:, 0] - root[0]) * s) * 30)
            out = np.minimum(out, wing)
        return out

    def plinth(p):
        return sdf.box((0, 0, 0.8), (1.5, 1.5, 0.8), 0.06)(p)

    def field(p):
        return np.minimum(np.minimum(body(p), wings(p)), plinth(p))

    o, _, _ = sculpt(name, field, (-4.2, -2.2, -0.05), (4.2, 2.4, 9.6), 0.04, 12000, [(plinth, STONE), (body, MARBLE), (wings, MARBLE)])
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, collision(name, [box('c', (3, 3, 1.6), (0, 0, 0.8)), cylinder('c2', 0.9, 4.5, (0, 0, 1.6), sides=8)]), ao=AO)


def debris(name, size, seed):
    """A small floating rock (no collision): torn earth drifting in the wind round the islands."""
    field, top, body = island_field(size, size * 1.4, seed, bumps=0.05)
    o, _, _ = sculpt(name, field, (-size * 1.4, -size * 1.4, -size * 2), (size * 1.4, size * 1.4, 0.4), size / 40, 1800, [(top, GRASS), (body, CLIFF)])
    me = o.data
    idx = np.array([1 if p.normal.z < 0.75 else p.material_index for p in me.polygons])
    me.polygons.foreach_set('material_index', idx)
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o, distance=1.0, ground=False)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, None, ao=AO)


PIECES = {
    'island_a': lambda: island('island_a', 13.0, 11.0, 201, 0.16, 12000),
    'island_b': lambda: island('island_b', 8.0, 8.0, 202, 0.12, 8000),
    'island_c': lambda: island('island_c', 4.5, 5.0, 203, 0.08, 5000),
    'arena': arena, 'tower': tower, 'hall': hall, 'cloister': cloister, 'shrine': shrine, 'bridge': bridge,
    'stairs': stairs, 'wall_ruin': wall_ruin, 'pillar_flags': pillar_flags, 'bell': bell, 'spire': spire,
    'statue_vaeltris': statue_vaeltris,
    'debris_a': lambda: debris('debris_a', 2.0, 211), 'debris_b': lambda: debris('debris_b', 1.2, 212),
}

names = ARGS or list(PIECES)
for n in names:
    reset()
    print('---', n, flush=True)
    PIECES[n]()
