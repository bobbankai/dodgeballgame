"""The Ashen Kingdom kit: the burnt castle-town of Varn Keld (Chapter One).

  /opt/bvenv/bin/python eclipse/tools/blender/ashen_kit.py [piece ...] [--no-ao]

Writes public/assets/env/ashen/<piece>.glb. Architecture is built from bevelled masonry with
boolean openings and chunks knocked out of it (envkit.damage); organic pieces (rubble, dead trees,
the broken statue) are sculpted with signed distance fields. Every piece has a simple collision
proxy (<piece>_col) and per-vertex ambient occlusion.

Pieces (origin at ground level; +Y in Blender is the piece's back, -Y its front):
  wall, wall_breach, rampart, rampart_stairs, tower, gatehouse, house_a, house_b, chapel,
  stairs, rubble_a/b/c, beams, tree_a/b, barrel, crate, cart, brazier, banner, statue_broken, well
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
                    export_piece, set_material, rock_cutter)

OUT = os.path.join(ASSETS, 'env', 'ashen')
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
AO = '--no-ao' not in sys.argv

STONE = 'ash_castle_slate'
BRICK = 'ash_castle_brick'
PLASTER = 'ash_plaster'
WOOD = 'ash_wood'
CHAR = 'ash_wood#charred'
ROOF = 'ash_roof'
COBBLE = 'ash_cobble'
IRON = 'cloth_rust'


def merlons(length, thick, z, width=0.8, gap=0.62, height=1.0, mat=STONE, y=0.0, seed=0):
    """A row of battlements centred on x=0 along X."""
    out = []
    n = max(1, int((length + gap) // (width + gap)))
    span = n * width + (n - 1) * gap
    x0 = -span / 2 + width / 2
    rng = np.random.default_rng(seed)
    for i in range(n):
        h = height * (1 - 0.25 * (rng.random() < 0.2))
        out.append(box(f'merlon{i}', (width, thick, h), (x0 + i * (width + gap), y, z + h / 2), mat, bevel=0.03))
    return out


def finish(name, parts, cols, dmg=None, seed=0, uv=True):
    """Joins, damages, UVs, bakes AO and exports one piece."""
    obj = join(parts, name)
    if dmg:
        damage(obj, dmg, seed=seed, radius=(0.45, 1.1))
    if uv:
        metric_uv(obj, seed=seed + 1)
    if AO:
        subdivide_long_edges(obj, 1.8)
        bake_ao(obj)
    col = collision(name, cols) if cols else None
    export_piece(os.path.join(OUT, f'{name}.glb'), obj, col, ao=AO)


# ============================================================================== walls and towers
def wall(name='wall', length=6.0, thick=1.2, height=5.0, breach=False, seed=1):
    parts = [
        box('core', (length, thick, height), (0, 0, height / 2), STONE, bevel=0.05),
        box('plinth', (length, thick + 0.3, 0.7), (0, 0, 0.35), BRICK, bevel=0.06),
        box('string', (length, thick + 0.16, 0.18), (0, 0, height - 0.1), STONE, bevel=0.03),
    ]
    parts += merlons(length, thick * 0.55, height, y=thick * 0.22, seed=seed)
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-length / 2, length / 2), rng.uniform(-thick / 2, thick / 2), height + 0.3)) for _ in range(3)]
    cols = [box('c1', (length, thick, height + 1), (0, 0, (height + 1) / 2))]
    if breach:
        # a collapsed section: the wall broken down to shoulder height in the middle
        dmg += [Vector((0.3, 0, height * 0.75)), Vector((-0.6, 0.2, height * 0.55)), Vector((0.9, -0.2, height * 0.5))]
        cols = [box('c1', (length, thick, 2.2), (0, 0, 1.1)),
                box('c2', (length * 0.3, thick, height + 1), (-length * 0.38, 0, (height + 1) / 2)),
                box('c3', (length * 0.3, thick, height + 1), (length * 0.38, 0, (height + 1) / 2))]
    finish(name, parts, cols, dmg, seed)


def rampart(name='rampart', length=8.0, thick=3.4, height=6.0, seed=3):
    """A walkable curtain wall: wall-walk on top, parapet with battlements on the outer (+Y) side."""
    parts = [
        box('core', (length, thick, height), (0, 0, height / 2), STONE, bevel=0.05),
        box('plinth', (length, thick + 0.4, 0.8), (0, 0, 0.4), BRICK, bevel=0.06),
        box('walk', (length, thick - 0.6, 0.12), (0, -0.3, height + 0.06), COBBLE, bevel=0.02),
        box('parapet', (length, 0.6, 0.9), (0, thick / 2 - 0.3, height + 0.45), STONE, bevel=0.03),
        box('inner_lip', (length, 0.3, 0.35), (0, -thick / 2 + 0.15, height + 0.18), STONE, bevel=0.03),
    ]
    parts += merlons(length, 0.6, height + 0.9, y=thick / 2 - 0.3, seed=seed)
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-length / 2, length / 2), thick / 2 - 0.3, height + 1.5)) for _ in range(2)]
    cols = [box('c1', (length, thick, height + 0.12), (0, 0, (height + 0.12) / 2)),
            box('c2', (length, 0.6, 2.0), (0, thick / 2 - 0.3, height + 1.0)),
            box('c3', (length, 0.3, 0.5), (0, -thick / 2 + 0.15, height + 0.25))]
    finish(name, parts, cols, dmg, seed)


def rampart_stairs(name='rampart_stairs', height=6.0, width=2.4, seed=4):
    """Stone steps climbing along the inner face of a rampart (along +X), with a low side wall."""
    n = int(height / 0.25)
    run = 0.32
    parts = []
    for i in range(n):
        h = (i + 1) * 0.25
        parts.append(box(f'step{i}', (run + 0.02, width, h), (i * run + run / 2, 0, h / 2), STONE, bevel=0.02))
    parts.append(box('side', (n * run, 0.4, 0.8), (n * run / 2, -width / 2 - 0.2, 0.4), STONE))
    L = n * run
    ramp = box('ramp', (math.hypot(L, height) + 0.3, width, 0.4), (L / 2, 0, height / 2 - 0.1), rot=(0, -math.atan2(height, L), 0))
    finish(name, parts, [ramp], None, seed)


def tower(name='tower', r=3.2, h=11.0, seed=5, door=True):
    parts = [
        cylinder('shaft', r, h, (0, 0, 0), STONE, sides=28, r2=r * 0.93),
        cylinder('base', r + 0.35, 1.0, (0, 0, 0), BRICK, sides=28, r2=r + 0.1),
        cylinder('corbel', r * 0.93 + 0.35, 0.7, (0, 0, h - 0.2), STONE, sides=28),
        cylinder('top', r * 0.93 + 0.35, 0.15, (0, 0, h + 0.5), COBBLE, sides=28),
    ]
    rt = r * 0.93 + 0.2
    n = 14
    for i in range(n):
        a = i / n * math.tau
        parts.append(box(f'm{i}', (0.75, 0.4, 1.0), (math.cos(a) * rt, math.sin(a) * rt, h + 1.1), STONE, rot=(0, 0, a + math.pi / 2), bevel=0.03))
    shaft = join(parts, name)
    if door:
        cut = box('door', (1.6, r * 1.2, 2.6), (0, -r, 1.3))
        cap = cylinder('doortop', 0.8, r * 1.2, (0, -r + r * 0.6, 2.6), rot=(math.pi / 2, 0, 0))
        door_cut = join([cut, cap], 'door_cut')
        boolean(shaft, door_cut)
    for i, (a, z) in enumerate(((0.9, 4.5), (2.4, 6.5), (4.0, 4.8), (5.2, 7.5))):
        slit = box(f'slit{i}', (0.18, r, 1.2), (math.cos(a) * r, math.sin(a) * r, z), rot=(0, 0, a + math.pi / 2))
        boolean(shaft, slit)
    rng = np.random.default_rng(seed)
    dmg = [Vector((math.cos(a) * rt, math.sin(a) * rt, h + 1.2)) for a in rng.uniform(0, math.tau, 3)]
    cols = [cylinder('c', r, h + 0.65, (0, 0, 0), sides=12)]
    finish(name, [shaft], cols, dmg, seed)


def gatehouse(name='gatehouse', seed=7):
    """Two drum towers flanking an arched passage, the portcullis jammed half open."""
    parts = []
    for s in (-1, 1):
        parts += [cylinder(f't{s}', 3.0, 12, (s * 5.6, 0, 0), STONE, sides=24, r2=2.8),
                  cylinder(f'tb{s}', 3.35, 1.0, (s * 5.6, 0, 0), BRICK, sides=24, r2=3.1),
                  cylinder(f'tc{s}', 3.2, 0.6, (s * 5.6, 0, 11.6), STONE, sides=24)]
    block = box('block', (8.4, 6.0, 9.5), (0, 0, 4.75), STONE, bevel=0.05)
    parts += [block, box('string', (8.4, 6.3, 0.25), (0, 0, 9.4), STONE, bevel=0.03)]
    parts += merlons(8.4, 0.6, 9.5, y=-2.7, seed=seed) + merlons(8.4, 0.6, 9.5, y=2.7, seed=seed + 1)
    g = join(parts, name)
    passage = join([box('p1', (4.6, 8, 5.0), (0, 0, 2.5)), cylinder('p2', 2.3, 8, (0, 4, 5.0), rot=(math.pi / 2, 0, 0))], 'passage')
    boolean(g, passage)
    # portcullis: an iron-shod timber grid stuck at mid height in its slot
    bars = []
    for i in range(7):
        bars.append(box(f'pv{i}', (0.14, 0.14, 4.2), (-1.95 + i * 0.65, -1.0, 4.6), CHAR))
    for j in range(5):
        bars.append(box(f'ph{j}', (4.4, 0.16, 0.14), (0, -1.0, 2.8 + j * 0.85), CHAR))
    for i in range(7):
        bars.append(cylinder(f'spike{i}', 0.09, 0.4, (-1.95 + i * 0.65, -1.0, 2.1), IRON, sides=6, r2=0.01, rot=(math.pi, 0, 0)))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-4, 4), rng.choice([-2.7, 2.7]), 10.2)) for _ in range(3)] + [Vector((5.6 + 2.3, -1.5, 12.2)), Vector((-7.5, 1.0, 11.8))]
    cols = [cylinder('c1', 3.0, 12.6, (-5.6, 0, 0), sides=12), cylinder('c2', 3.0, 12.6, (5.6, 0, 0), sides=12),
            box('c3', (1.9, 6, 9.5), (-3.25, 0, 4.75)), box('c4', (1.9, 6, 9.5), (3.25, 0, 4.75)),
            box('c5', (4.6, 6, 2.2), (0, 0, 8.4)), box('c6', (4.4, 0.3, 1.6), (0, -1.0, 4.2))]
    finish(name, [g] + bars, cols, dmg, seed)


# ============================================================================== houses and chapel
def timber_frame(w, d, z0, h, faces='all'):
    """Charred half-timbering proud of the plaster: posts, rails and braces on the given walls."""
    out = []
    t = 0.16
    for side, (cx, cy, length, along_x) in {'front': (0, -d / 2, w, True), 'back': (0, d / 2, w, True),
                                            'left': (-w / 2, 0, d, False), 'right': (w / 2, 0, d, False)}.items():
        if faces != 'all' and side not in faces:
            continue
        off = 0.05 if side in ('back', 'right') else -0.05
        n = max(2, int(length / 1.25))
        for i in range(n + 1):
            u = -length / 2 + i * length / n
            loc = (cx + (u if along_x else off), cy + (off if along_x else u), z0 + h / 2)
            out.append(box(f'post_{side}{i}', (t, t, h) if along_x else (t, t, h), loc, CHAR, bevel=0.015))
            if i < n and i % 2 == 0:
                bl = math.hypot(length / n, h * 0.6)
                ang = math.atan2(h * 0.6, length / n)
                mid_u = u + length / n / 2
                loc = (cx + (mid_u if along_x else off), cy + (off if along_x else mid_u), z0 + h * 0.4)
                rot = (0, -ang, 0) if along_x else (ang, 0, math.pi / 2)
                out.append(box(f'brace_{side}{i}', (bl, t * 0.8, t * 0.8), loc, CHAR, rot=rot if along_x else (0, -ang, math.pi / 2)))
        for zz in (z0 + 0.08, z0 + h - 0.08):
            loc = (cx + (0 if along_x else off), cy + (off if along_x else 0), zz)
            out.append(box(f'rail_{side}{zz:.1f}', (length + t, t, t) if along_x else (t, length + t, t), loc, CHAR, bevel=0.015))
    return out


def house(name='house_a', w=7.0, d=5.4, seed=11, storeys=2, roof=True):
    th = 0.5
    h1 = 3.2
    parts = []
    walls = [box('wf', (w, th, h1), (0, -d / 2 + th / 2, h1 / 2), BRICK, bevel=0.03),
             box('wb', (w, th, h1), (0, d / 2 - th / 2, h1 / 2), BRICK, bevel=0.03),
             box('wl', (th, d, h1), (-w / 2 + th / 2, 0, h1 / 2), BRICK, bevel=0.03),
             box('wr', (th, d, h1), (w / 2 - th / 2, 0, h1 / 2), BRICK, bevel=0.03)]
    ground = join(walls, 'ground')
    boolean(ground, join([box('d', (1.4, 2, 2.3), (-w * 0.18, -d / 2, 1.15)), cylinder('dt', 0.7, 2, (-w * 0.18, -d / 2 + 1, 2.3), rot=(math.pi / 2, 0, 0))], 'door'))
    for x in (w * 0.22,):
        boolean(ground, box('win', (1.0, 2, 1.2), (x, -d / 2, 1.8)))
    boolean(ground, box('winl', (2, 1.0, 1.2), (-w / 2, 0.4, 1.8)))
    parts.append(ground)
    parts.append(box('floor', (w - 2 * th, d - 2 * th, 0.12), (0, 0, 0.06), WOOD))
    top = h1
    if storeys > 1:
        h2 = 2.6
        jetty = 0.3  # the upper storey oversails the lower one
        parts.append(box('joists', (w + 2 * jetty, d + 2 * jetty, 0.25), (0, 0, h1 + 0.12), CHAR, bevel=0.02))
        upper = join([box('uf', (w + 2 * jetty, 0.25, h2), (0, -d / 2 - jetty + 0.125, h1 + 0.25 + h2 / 2), PLASTER),
                      box('ub', (w + 2 * jetty, 0.25, h2), (0, d / 2 + jetty - 0.125, h1 + 0.25 + h2 / 2), PLASTER),
                      box('ul', (0.25, d + 2 * jetty, h2), (-w / 2 - jetty + 0.125, 0, h1 + 0.25 + h2 / 2), PLASTER),
                      box('ur', (0.25, d + 2 * jetty, h2), (w / 2 + jetty - 0.125, 0, h1 + 0.25 + h2 / 2), PLASTER)], 'upper')
        for x in (-w * 0.25, w * 0.25):
            boolean(upper, box('uwin', (0.9, 2, 1.1), (x, -d / 2 - jetty, h1 + 0.25 + 1.4)))
        parts.append(upper)
        parts += timber_frame(w + 2 * jetty, d + 2 * jetty, h1 + 0.25, h2)
        top = h1 + 0.25 + h2
        w2, d2 = w + 2 * jetty, d + 2 * jetty
    else:
        w2, d2 = w, d
    cols = [box('c1', (w, th, h1), (0, -d / 2 + th / 2, h1 / 2)), box('c2', (w, th, h1), (0, d / 2 - th / 2, h1 / 2)),
            box('c3', (th, d, h1), (-w / 2 + th / 2, 0, h1 / 2)), box('c4', (th, d, h1), (w / 2 - th / 2, 0, h1 / 2))]
    if roof:
        pitch = math.radians(48)
        rise = (d2 / 2 + 0.4) * math.tan(pitch)
        slope_len = (d2 / 2 + 0.4) / math.cos(pitch)
        for s in (-1, 1):
            slab = box(f'roof{s}', (w2 + 0.8, slope_len, 0.16), (0, s * (d2 / 4 + 0.2), top + rise / 2), ROOF, rot=(-s * pitch, 0, 0), bevel=0.02)
            if s > 0 or seed % 2:
                # the fire took part of the roof: a ragged hole showing the rafters
                boolean(slab, rock_cutter('hole', Vector((w2 * 0.15 * s, s * d2 * 0.22, top + rise * 0.55)), 1.6, seed + s, squash=(1.4, 1, 1)))
            parts.append(slab)
        for g in (-1, 1):
            parts.append(gable(f'gable{g}', d2, rise, (g * (w2 / 2 - 0.125), 0, top)))
        for i in range(int(w2 / 0.6) + 1):
            x = -w2 / 2 + 0.2 + i * 0.6
            for s in (-1, 1):
                parts.append(box(f'rafter{i}{s}', (0.12, slope_len, 0.16), (x, s * (d2 / 4 + 0.2), top + rise / 2 - 0.12), CHAR, rot=(-s * pitch, 0, 0)))
        parts.append(box('ridge', (w2 + 0.6, 0.2, 0.22), (0, 0, top + rise - 0.05), CHAR))
        cols.append(box('c5', (w2, d2, 0.4), (0, 0, top + 0.2)))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-w / 2, w / 2), rng.choice([-d / 2, d / 2]), h1)) for _ in range(2)]
    if not roof:
        dmg += [Vector((rng.uniform(-w / 2, w / 2), rng.choice([-d / 2, d / 2]), h1 - 0.2)) for _ in range(2)]
    finish(name, parts, cols, dmg, seed)


def gable(name, d, rise, loc):
    """Triangular gable wall (plaster) in the YZ plane, 0.25 thick."""
    v = np.array([[-0.125, -d / 2, 0], [-0.125, d / 2, 0], [-0.125, 0, rise], [0.125, -d / 2, 0], [0.125, d / 2, 0], [0.125, 0, rise]])
    f = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    o = mesh_from_arrays(name, v, f)
    o.location = loc
    set_material(o, PLASTER)
    return o


def chapel(name='chapel', seed=21):
    W, L, H, T = 9.0, 18.0, 8.0, 0.9
    walls = [box('n_l', (T, L, H), (-W / 2, 0, H / 2), BRICK, bevel=0.04), box('n_r', (T, L, H), (W / 2, 0, H / 2), BRICK, bevel=0.04),
             box('front', (W + T, T, H + 3), (0, -L / 2, (H + 3) / 2), BRICK, bevel=0.04)]
    for i in range(5):
        y = -L / 2 + 2 + i * 3.5
        for s in (-1, 1):
            walls.append(box(f'butt{i}{s}', (1.0, 0.9, H * 0.85), (s * (W / 2 + 0.9), y, H * 0.42), STONE, bevel=0.04))
            walls.append(cylinder(f'buttcap{i}{s}', 0.65, 0.9, (s * (W / 2 + 0.9), y, H * 0.85), STONE, sides=4, r2=0.05, rot=(0, 0, math.pi / 4)))
    nave = join(walls, 'nave')
    # round-arched windows down both sides, a great door and a rose window in the facade
    for i in range(4):
        y = -L / 2 + 3.75 + i * 3.5
        for s in (-1, 1):
            cut = join([box(f'w{i}{s}', (2, 1.3, 3.0), (s * W / 2, y, 4.2)), cylinder(f'wt{i}{s}', 0.65, 2, (s * W / 2 - 1, y, 5.7), rot=(0, math.pi / 2, 0))], 'wcut')
            boolean(nave, cut)
    boolean(nave, join([box('door', (3.0, 2, 4.6), (0, -L / 2, 2.3)), cylinder('dtop', 1.5, 2, (0, -L / 2 + 1, 4.6), rot=(math.pi / 2, 0, 0))], 'dcut'))
    boolean(nave, cylinder('rose', 1.5, 2, (0, -L / 2 + 1, 8.0), rot=(math.pi / 2, 0, 0), sides=32))
    # apse: a half-round end wall
    apse = cylinder('apse', W / 2 + T / 2, H - 1, (0, L / 2, 0), BRICK, sides=24)
    boolean(apse, cylinder('apse_in', W / 2 - T / 2, H + 1, (0, L / 2, -0.5), sides=24))
    boolean(apse, box('apse_half', (W + 3, W, H + 2), (0, L / 2 - W / 2, H / 2)))
    parts = [nave, apse]
    parts.append(box('floor', (W, L, 0.15), (0, 0, 0.075), COBBLE))
    parts.append(box('altar', (2.4, 1.2, 1.1), (0, L / 2 - 0.5, 0.55), STONE, bevel=0.05))
    # charred trusses survive where the roof fell in
    for i, y in enumerate((-5.5, -2, 4.5, 8)):
        parts.append(box(f'tie{i}', (W + 0.6, 0.3, 0.35), (0, y, H - 0.2), CHAR))
        for s in (-1, 1):
            parts.append(box(f'raf{i}{s}', (W * 0.62, 0.25, 0.3), (s * W * 0.24, y, H + 1.6), CHAR, rot=(0, s * math.radians(38), 0)))
    # the bell tower stub at the front-left corner
    bt = box('belltower', (4.2, 4.2, 15), (-W / 2 - 1.2, -L / 2 + 1.2, 7.5), STONE, bevel=0.05)
    for a in range(4):
        boolean(bt, join([box(f'b{a}', (1.2, 6, 2.2), (-W / 2 - 1.2, -L / 2 + 1.2, 12.4), rot=(0, 0, a * math.pi / 2)),
                          cylinder(f'bt{a}', 0.6, 6, (-W / 2 - 1.2, -L / 2 + 1.2, 13.5), rot=(math.pi / 2, 0, a * math.pi / 2))], 'bcut'))
    parts.append(bt)
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.choice([-W / 2, W / 2]), rng.uniform(-L / 2, L / 2), H)) for _ in range(4)]
    dmg += [Vector((-W / 2 - 1.2 + 1.5, -L / 2 + 2.0, 15.0)), Vector((W / 4, -L / 2, H + 2.8))]
    cols = [box('c1', (T, L, H), (-W / 2, 0, H / 2)), box('c2', (T, L, H), (W / 2, 0, H / 2)),
            box('c3', (W / 2 - 1.5 + T / 2, T, H + 3), (-(W / 2 + 1.5) / 2 - T / 4, -L / 2, (H + 3) / 2)),
            box('c4', (W / 2 - 1.5 + T / 2, T, H + 3), ((W / 2 + 1.5) / 2 + T / 4, -L / 2, (H + 3) / 2)),
            box('c5', (3, T, H + 3 - 5.3), (0, -L / 2, 5.3 + (H + 3 - 5.3) / 2)),
            box('c6', (4.2, 4.2, 15), (-W / 2 - 1.2, -L / 2 + 1.2, 7.5)), box('c7', (2.4, 1.2, 1.1), (0, L / 2 - 0.5, 0.55))]
    for k in range(6):
        a = math.pi * (k + 0.5) / 6
        cols.append(box(f'ca{k}', (2.6, T, H - 1), (math.cos(a) * W / 2, L / 2 + math.sin(a) * W / 2, (H - 1) / 2), rot=(0, 0, a + math.pi / 2)))
    finish(name, parts, cols, dmg, seed)


def stairs(name='stairs', width=3.0, rise=3.0, seed=31):
    n = int(rise / 0.22)
    run = 0.34
    parts = [box(f's{i}', (width, run + 0.02, (i + 1) * 0.22), (0, i * run + run / 2, (i + 1) * 0.11), STONE, bevel=0.025) for i in range(n)]
    for s in (-1, 1):
        parts.append(box(f'cheek{s}', (0.35, n * run, rise + 0.5), (s * (width / 2 + 0.175), n * run / 2, (rise + 0.5) / 2), STONE, bevel=0.03))
    L = n * run
    ramp = box('ramp', (width, math.hypot(L, rise) + 0.3, 0.4), (0, L / 2, rise / 2 - 0.15), rot=(math.atan2(rise, L), 0, 0))
    finish(name, parts, [ramp, box('k1', (0.35, L, rise + 0.5), (-(width / 2 + 0.175), L / 2, (rise + 0.5) / 2)),
                         box('k2', (0.35, L, rise + 0.5), (width / 2 + 0.175, L / 2, (rise + 0.5) / 2))], None, seed)


# ============================================================================== sculpted pieces
def sculpt(name, field, lo, hi, voxel, budget, mats, seed=0):
    """SDF -> mesh with per-face materials: mats = [(field_or_None, material)], nearest field wins."""
    v, f = sdf.mesh(field, np.array(lo), np.array(hi), voxel)
    o = mesh_from_arrays(name, v, f)
    decimate(o, target_tris=budget)
    shade_smooth(o, angle=50)
    me = o.data
    for _, m in mats:
        from envkit import material as _mat
        me.materials.append(_mat(m))
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


def rubble(name='rubble_a', size=3.0, seed=41):
    rng = np.random.default_rng(seed)
    mound = sdf.ellipsoid((0, 0, -size * 0.12), (size * 0.5, size * 0.42, size * 0.28))
    blocks = []
    for i in range(int(14 * size)):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0, size * 0.48) ** 0.8
        c = (math.cos(a) * r, math.sin(a) * r * 0.85, rng.uniform(-0.1, size * 0.25 * (1 - r / size)))
        half = rng.uniform(0.12, 0.34, 3) * np.array([1.6, 1.0, 0.8])
        ang = rng.uniform(0, math.pi, 3)
        Rx = np.array([[1, 0, 0], [0, math.cos(ang[0]), -math.sin(ang[0])], [0, math.sin(ang[0]), math.cos(ang[0])]])
        Rz = np.array([[math.cos(ang[2]), -math.sin(ang[2]), 0], [math.sin(ang[2]), math.cos(ang[2]), 0], [0, 0, 1]])
        blocks.append(sdf.box(c, half, 0.03, rot=Rz @ Rx))
    stones = sdf.union(*blocks)
    dirt = lambda p: mound(p) + 0.05 * (sdf.fbm(p, 3, 3, seed) - 0.5)  # noqa: E731
    field = lambda p: np.maximum(np.minimum(dirt(p), stones(p)), -p[:, 2] - 0.02)  # noqa: E731
    o = sculpt(name, field, (-size * 0.7, -size * 0.7, -0.1), (size * 0.7, size * 0.7, size * 0.6), 0.03, int(2500 * size),
               [(dirt, 'ash_burned_ground'), (stones, STONE)], seed)
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o)
    col = cylinder('c', size * 0.42, size * 0.25, (0, 0, 0), sides=8, r2=size * 0.2)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, collision(name, [col]), ao=AO)


def beams(name='beams', seed=45):
    """A heap of charred roof timbers."""
    rng = np.random.default_rng(seed)
    parts = []
    for i in range(7):
        L = rng.uniform(2.2, 4.0)
        parts.append(box(f'b{i}', (L, 0.24, 0.26), (rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), 0.13 + i * 0.12),
                         CHAR, rot=(rng.uniform(-0.2, 0.2), rng.uniform(-0.15, 0.15), rng.uniform(0, math.pi)), bevel=0.03))
    finish(name, parts, [box('c', (3.2, 2.2, 0.8), (0, 0, 0.4))], None, seed)


def tree(name='tree_a', seed=51, height=7.0):
    """A dead, fire-blackened tree: a leaning trunk forking into bare branches."""
    rng = np.random.default_rng(seed)
    tubes = []

    def branch(p0, d, length, r, depth):
        pts = [p0]
        p = np.array(p0, float)
        dd = np.array(d, float)
        segs = 4
        for _ in range(segs):
            dd = dd + rng.normal(0, 0.18, 3)
            dd /= np.linalg.norm(dd)
            p = p + dd * length / segs
            pts.append(p.copy())
        tubes.append((np.array(pts), r))
        if depth < 3:
            for _ in range(2 if depth else 3):
                k = rng.integers(2, segs + 1)
                nd = dd + rng.normal(0, 0.7, 3)
                nd[2] = abs(nd[2]) * 0.6 + 0.2
                branch(pts[k], nd / np.linalg.norm(nd), length * rng.uniform(0.45, 0.65), r * 0.55, depth + 1)

    lean = np.array([rng.normal(0, 0.12), rng.normal(0, 0.12), 1.0])
    branch((0, 0, -0.2), lean / np.linalg.norm(lean), height * 0.55, 0.28, 0)

    def field(p):
        d = np.full(len(p), 1e3)
        for pts, r in tubes:
            n = len(pts) - 1
            for i in range(n):
                rr = r * (1 - 0.5 * i / n)
                d = np.minimum(d, sdf.capsule(pts[i], pts[i + 1], rr, r * (1 - 0.5 * (i + 1) / n))(p))
        # flared roots
        roots = sdf.ellipsoid((0, 0, 0), (0.6, 0.6, 0.35))(p)
        return np.minimum(sdf.smooth_union(lambda q: d, lambda q: roots, 0.25)(p), d) + 0.01 * (sdf.fbm(p, 12, 2, seed) - 0.5)

    lo = (-height * 0.6, -height * 0.6, -0.3)
    hi = (height * 0.6, height * 0.6, height * 1.05)
    o = sculpt(name, field, lo, hi, 0.035, 6000, [(None, 'wood_bark#charred')], seed)
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, collision(name, [cylinder('c', 0.35, height * 0.5, (0, 0, 0), sides=8)]), ao=AO)


# ============================================================================== props
def barrel(name='barrel', seed=61):
    staves = cylinder('body', 0.36, 1.0, (0, 0, 0), WOOD, sides=20)
    # bulge the staves
    for v in staves.data.vertices:
        k = 1 + 0.12 * math.sin(math.pi * v.co.z / 1.0)
        v.co.x *= k
        v.co.y *= k
    hoops = [cylinder(f'h{i}', 0.37 * (1 + 0.12 * math.sin(math.pi * z)) + 0.012, 0.06, (0, 0, z - 0.03), IRON, sides=20) for i, z in enumerate((0.12, 0.38, 0.62, 0.88))]
    finish(name, [staves] + hoops, [cylinder('c', 0.4, 1.0, (0, 0, 0), sides=8)], None, seed)


def crate(name='crate', seed=63):
    parts = [box('body', (0.9, 0.9, 0.8), (0, 0, 0.4), WOOD, bevel=0.02)]
    for s in (-1, 1):
        for ax in (0, 1):
            parts.append(box(f'f{s}{ax}', (0.95 if ax == 0 else 0.1, 0.1 if ax == 0 else 0.95, 0.1), ((0 if ax == 0 else s * 0.45), (s * 0.45 if ax == 0 else 0), 0.75), CHAR))
            parts.append(box(f'g{s}{ax}', (0.95 if ax == 0 else 0.1, 0.1 if ax == 0 else 0.95, 0.1), ((0 if ax == 0 else s * 0.45), (s * 0.45 if ax == 0 else 0), 0.05), CHAR))
    finish(name, parts, [box('c', (0.9, 0.9, 0.8), (0, 0, 0.4))], None, seed)


def cart(name='cart', seed=65):
    """An overturned-at-the-edge farm cart: bed, side boards, one wheel off and lying flat."""
    parts = [box('bed', (2.4, 1.4, 0.12), (0, 0, 0.75), WOOD, rot=(0.12, 0, 0), bevel=0.02)]
    for s in (-1, 1):
        parts.append(box(f'side{s}', (2.4, 0.08, 0.45), (0, s * 0.7, 1.0), WOOD, rot=(0.12, 0, 0)))
        parts.append(box(f'shaft{s}', (2.2, 0.1, 0.1), (2.1, s * 0.45, 0.25), CHAR, rot=(0, 0.28, 0)))
    parts.append(box('axle', (0.12, 1.7, 0.12), (0, 0, 0.45), CHAR))
    wheel = cylinder('wheel', 0.55, 0.1, (0, -0.9, 0.55), WOOD, sides=24, rot=(math.pi / 2, 0, 0))
    boolean(wheel, cylinder('hub', 0.42, 0.4, (0, -0.75, 0.55), sides=24, rot=(math.pi / 2, 0, 0)))
    parts.append(wheel)
    for i in range(6):
        parts.append(box(f'spoke{i}', (0.06, 0.06, 0.86), (0, -0.9, 0.55), CHAR, rot=(0, i * math.pi / 6, 0)))
    flat = cylinder('wheel2', 0.55, 0.1, (-0.4, 1.4, 0.0), WOOD, sides=24)
    boolean(flat, cylinder('hub2', 0.42, 0.4, (-0.4, 1.4, -0.1), sides=24))
    parts.append(flat)
    finish(name, parts, [box('c', (2.5, 1.5, 1.2), (0, 0, 0.6))], None, seed)


def brazier(name='brazier', seed=67):
    parts = [cylinder('bowl', 0.45, 0.4, (0, 0, 1.0), IRON, sides=16, r2=0.62),
             cylinder('coals', 0.55, 0.06, (0, 0, 1.32), 'ash_dark_rock', sides=16)]
    for i in range(3):
        a = i * math.tau / 3
        parts.append(box(f'leg{i}', (0.07, 0.07, 1.25), (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.55), IRON, rot=(math.sin(a) * 0.25, -math.cos(a) * 0.25, 0)))
    finish(name, parts, [cylinder('c', 0.5, 1.4, (0, 0, 0), sides=8)], None, seed)


def banner(name='banner', seed=69):
    """A torn war banner on a pole (the Burning King's sun), hanging still in the ash."""
    pole = cylinder('pole', 0.06, 5.2, (0, 0, 0), CHAR, sides=10)
    arm = box('arm', (1.5, 0.08, 0.08), (0.7, 0, 4.9), CHAR)
    cloth = box('cloth', (1.3, 0.03, 2.6), (0.7, 0, 3.55), 'cloth_leather_red')
    for i in range(5):
        boolean(cloth, rock_cutter(f'tear{i}', Vector((0.15 + i * 0.27, 0, 2.25 + (i % 2) * 0.35)), 0.22, seed + i, squash=(1, 3, 1.6)))
    boolean(cloth, rock_cutter('hole', Vector((1.0, 0, 3.7)), 0.18, seed + 9, squash=(1, 3, 1)))
    finish(name, [pole, arm, cloth], [cylinder('c', 0.1, 5.2, (0, 0, 0), sides=6)], None, seed)


def well(name='well', seed=71):
    ring = cylinder('ring', 1.1, 0.9, (0, 0, 0), STONE, sides=20)
    boolean(ring, cylinder('in', 0.8, 2.0, (0, 0, -0.5), sides=20))
    parts = [ring, cylinder('water', 0.8, 0.05, (0, 0, 0.35), 'ash_dark_rock', sides=20)]
    for s in (-1, 1):
        parts.append(box(f'post{s}', (0.16, 0.16, 2.2), (s * 1.0, 0, 1.1), CHAR))
    parts.append(box('beam', (2.3, 0.18, 0.18), (0, 0, 2.15), CHAR))
    parts.append(cylinder('roof', 1.5, 0.7, (0, 0, 2.2), ROOF, sides=4, r2=0.05, rot=(0, 0, math.pi / 4)))
    finish(name, parts, [cylinder('c', 1.1, 0.9, (0, 0, 0), sides=10)], None, seed)


def statue_broken(name='statue_broken', seed=73):
    """What is left of a statue of Ignaroth in the square: a plinth, legs, a sword point, the
    crowned head fallen beside it."""
    def legs(p):
        l = sdf.capsule((0.35, 0, 1.7), (0.4, 0.1, 3.3), 0.32, 0.38)(p)
        r = sdf.capsule((-0.35, 0, 1.7), (-0.45, -0.15, 3.3), 0.32, 0.38)(p)
        hips = sdf.ellipsoid((0, 0, 3.6), (0.75, 0.45, 0.5))(p)
        cut = p[:, 2] - (3.7 + 0.25 * np.sin(p[:, 0] * 5) + 0.2 * (sdf.fbm(p, 4, 2, seed) - 0.5))
        return np.maximum(sdf.smooth_union(lambda q: np.minimum(l, r), lambda q: hips, 0.2)(p), cut)

    def plinth(p):
        return sdf.box((0, 0, 0.8), (1.4, 1.1, 0.8), 0.05)(p)

    def head(p):
        c = np.array([2.4, -1.3, 0.55])
        skull = sdf.ellipsoid(c, (0.5, 0.55, 0.6))(p)
        horns = np.minimum(sdf.capsule(c + (0.3, 0, 0.4), c + (0.7, 0.2, 1.0), 0.12, 0.02)(p), sdf.capsule(c + (-0.3, 0, 0.4), c + (-0.6, 0.3, 0.9), 0.12, 0.02)(p))
        return np.maximum(np.minimum(skull, horns), -p[:, 2] + 0.02)

    def blade(p):
        return sdf.box((0.2, -0.75, 2.4), (0.12, 0.03, 0.8), 0.01, rot=None)(p)

    def field(p):
        return np.minimum(np.minimum(plinth(p), legs(p)), np.minimum(head(p), blade(p))) + 0.008 * (sdf.fbm(p, 10, 2, seed) - 0.5)

    o = sculpt(name, field, (-2, -2.2, -0.05), (3.4, 2, 4.4), 0.03, 9000, [(plinth, STONE), (legs, 'sun_marble#ash'), (head, 'sun_marble#ash'), (blade, IRON)], seed)
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, collision(name, [box('c', (2.8, 2.2, 3.8), (0, 0, 1.9)), box('c2', (1.2, 1.2, 1.2), (2.4, -1.3, 0.6))]), ao=AO)


def throne(name='throne', seed=81):
    """The Crucible Throne: a stepped dais of dark rock, a throne sized for a giant with a sunburst
    back and horned finials, and two pillars carrying fire bowls."""
    parts = []
    for i, (w, d) in enumerate(((16, 9), (13, 7.2), (10, 5.6))):
        parts.append(box(f'step{i}', (w, d, 0.55), (0, i * 0.35, 0.275 + i * 0.55), 'ash_dark_rock', bevel=0.05))
    seat_z = 1.65
    parts += [
        box('seat', (4.2, 3.0, 1.6), (0, 1.4, seat_z + 0.8), 'ash_dark_rock', bevel=0.08),
        box('back', (4.8, 1.0, 6.5), (0, 2.6, seat_z + 3.2), 'ash_dark_rock', bevel=0.08),
        box('arm_l', (0.9, 3.0, 1.2), (-2.3, 1.4, seat_z + 2.0), 'ash_dark_rock', bevel=0.06),
        box('arm_r', (0.9, 3.0, 1.2), (2.3, 1.4, seat_z + 2.0), 'ash_dark_rock', bevel=0.06),
    ]
    # the sunburst: rays fanning from the top of the back
    for k in range(9):
        a = math.radians(-60 + k * 15)
        L = 2.2 + (1.0 if k % 2 == 0 else 0.0)
        cx, cz = math.sin(a) * (2.0 + L / 2), seat_z + 6.2 + math.cos(a) * (L / 2)
        parts.append(box(f'ray{k}', (0.35, 0.5, L), (cx, 2.7, cz), 'sun_marble#ash' if k % 2 else 'ash_dark_rock', rot=(0, a, 0), bevel=0.04))
    parts.append(cylinder('sun', 1.3, 0.6, (0, 2.3, seat_z + 6.0), 'sun_marble#ash', sides=32, rot=(math.pi / 2, 0, 0)))
    for s_ in (-1, 1):
        parts.append(cylinder(f'horn{s_}', 0.35, 2.6, (s_ * 2.3, 2.6, seat_z + 6.4), 'ash_dark_rock', sides=10, r2=0.04, rot=(0, s_ * 0.5, 0)))
        parts.append(cylinder(f'pillar{s_}', 0.8, 8.0, (s_ * 7.0, 2.0, 0), STONE, sides=16, r2=0.7))
        parts.append(cylinder(f'cap{s_}', 1.15, 0.5, (s_ * 7.0, 2.0, 8.0), STONE, sides=16))
        parts.append(cylinder(f'bowl{s_}', 0.9, 0.7, (s_ * 7.0, 2.0, 8.5), IRON, sides=16, r2=1.3))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-7, 7), rng.uniform(-3, 3), 0.6)) for _ in range(3)] + [Vector((2.6, 2.6, seat_z + 5.5))]
    cols = [box('c1', (16, 9, 0.55), (0, 0, 0.275)), box('c2', (13, 7.2, 1.1), (0, 0.35, 0.55)), box('c3', (10, 5.6, 1.65), (0, 0.7, 0.825)),
            box('c4', (5.8, 3.4, 8), (0, 2.0, seat_z + 4)), cylinder('c5', 0.8, 9, (-7, 2, 0), sides=8), cylinder('c6', 0.8, 9, (7, 2, 0), sides=8)]
    finish(name, parts, cols, dmg, seed)


PIECES = {
    'wall': lambda: wall(), 'wall_breach': lambda: wall('wall_breach', breach=True, seed=2),
    'rampart': rampart, 'rampart_stairs': rampart_stairs, 'tower': tower, 'gatehouse': gatehouse,
    'house_a': lambda: house('house_a', seed=11), 'house_b': lambda: house('house_b', w=6.0, d=5.0, seed=12, storeys=1, roof=False),
    'house_c': lambda: house('house_c', w=8.0, d=6.0, seed=13),
    'chapel': chapel, 'stairs': stairs,
    'rubble_a': lambda: rubble('rubble_a', 3.0, 41), 'rubble_b': lambda: rubble('rubble_b', 2.0, 42), 'rubble_c': lambda: rubble('rubble_c', 4.5, 43),
    'beams': beams, 'tree_a': lambda: tree('tree_a', 51, 7), 'tree_b': lambda: tree('tree_b', 52, 5.5),
    'barrel': barrel, 'crate': crate, 'cart': cart, 'brazier': brazier, 'banner': banner, 'well': well, 'statue_broken': statue_broken, 'throne': throne,
}

names = ARGS or list(PIECES)
for n in names:
    reset()
    print('---', n, flush=True)
    PIECES[n]()
