"""The Eternal Eclipse kit: Aurelion's sun-citadel, white marble and gold under the black sun (Chapter Five).

  /opt/bvenv/bin/python eclipse/tools/blender/sun_kit.py [piece ...] [--no-ao]

Writes public/assets/env/sun/<piece>.glb (same conventions as the other kits).

Pieces: gate (the great sun gate), colonnade (gilded columns under an entablature), obelisk, stairs
(a grand flight with balustrades), brazier (a gold sun-bowl), pillar_broken, mirror (a sun-mirror on
a stand), statue_pentarch (a hooded god holding a sun-disc), dais (the Eclipse Dais: the arena), halo
(the vast ring that hangs over it), wall (a terrace wall with a gilt cornice), plinth_block, shards
(golden fragments that drift in the air).
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

OUT = os.path.join(ASSETS, 'env', 'sun')
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
AO = '--no-ao' not in sys.argv

WHITE = 'sun_white_blocks'
CASTLE = 'sun_castle_white'
MARBLE = 'sun_marble'
TILES = 'sun_marble_tiles'
GRANITE = 'sun_granite'
CLIFF = 'sun_marble_cliff'
GOLD = 'gen_forged_steel#gold'
SUNGLOW = 'sun_marble#sunglow'


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
    return o


def column_parts(x, y, h=8.0, r=0.5, tag=''):
    """A column: square plinth, gilt torus, plain shaft with a gold band, capital, gold abacus."""
    k = f'{tag}{x:.1f}{y:.1f}'
    return [box(f'pl{k}', (r * 2.6, r * 2.6, 0.4), (x, y, 0.2), WHITE, bevel=0.03),
            cylinder(f'to{k}', r * 1.2, 0.25, (x, y, 0.4), GOLD, sides=32, r2=r * 1.05),
            cylinder(f'sh{k}', r, h, (x, y, 0.65), MARBLE, sides=32, r2=r * 0.88),
            cylinder(f'bd{k}', r * 0.97, 0.18, (x, y, 0.65 + h * 0.33), GOLD, sides=32),
            cylinder(f'ca{k}', r * 0.9, 0.35, (x, y, 0.65 + h), MARBLE, sides=32, r2=r * 1.3),
            box(f'ab{k}', (r * 2.8, r * 2.8, 0.25), (x, y, 0.65 + h + 0.47), GOLD, bevel=0.02)]


def gate(name='gate', seed=501):
    """The sun gate: two massive towers of white stone, a round-headed opening, a gold sunburst above."""
    body = box('body', (16, 4, 16), (0, 0, 8), WHITE, bevel=0.06)
    boolean(body, join([box('op', (6, 6, 9), (0, 0, 4.5)), cylinder('va', 3, 6, (0, 3, 9), rot=(math.pi / 2, 0, 0), sides=40)], 'cut'))
    parts = [body, box('cornice', (16.8, 4.6, 0.5), (0, 0, 16.0), MARBLE, bevel=0.05), box('attic', (12, 3.6, 2.6), (0, 0, 17.5), CASTLE, bevel=0.05)]
    for s in (-1, 1):
        parts += column_parts(s * 4.6, -2.3, h=8.8, r=0.45, tag=f'g{s}')
    # the sunburst: a gold disc with rays, over the arch on the front face
    parts.append(cylinder('disc', 1.6, 0.3, (0, -2.15, 13.0), GOLD, rot=(math.pi / 2, 0, 0), sides=40))
    for k in range(16):
        a = k / 16 * math.tau
        ray = box(f'ray{k}', (0.22, 0.18, 1.6 if k % 2 else 2.4), (math.cos(a) * 2.6, -2.2, 13.0 + math.sin(a) * 2.6), GOLD, rot=(0, -a + math.pi / 2, 0))
        parts.append(ray)
    parts.append(cylinder('glow', 0.9, 0.36, (0, -2.25, 13.0), SUNGLOW, rot=(math.pi / 2, 0, 0), sides=32))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-6, 6), rng.choice([-2, 2]), 18.8)) for _ in range(2)]
    cols = [box('c1', (5, 4, 16), (-5.5, 0, 8)), box('c2', (5, 4, 16), (5.5, 0, 8)), box('c3', (6, 4, 5), (0, 0, 14.5))]
    finish(name, parts, cols, dmg, seed)


def colonnade(name='colonnade', n=5, span=3.6, seed=502):
    parts = []
    L = (n - 1) * span
    for i in range(n):
        parts += column_parts(-L / 2 + i * span, 0, tag='c')
    top = 0.65 + 8 + 0.6
    parts += [box('arch', (L + 1.6, 1.4, 0.9), (0, 0, top + 0.45), MARBLE, bevel=0.03), box('frieze', (L + 1.6, 1.3, 0.7), (0, 0, top + 1.25), GOLD, bevel=0.02),
              box('corn', (L + 2.2, 1.8, 0.35), (0, 0, top + 1.78), WHITE, bevel=0.04), box('styl', (L + 2.6, 3.0, 0.45), (0, 0, -0.22), TILES, bevel=0.03)]
    cols = [cylinder(f'c{i}', 0.6, 9.0, (-L / 2 + i * span, 0, 0), sides=8) for i in range(n)] + [box('ct', (L + 2.2, 1.8, 2.3), (0, 0, top + 1.0))]
    finish(name, parts, cols, None, seed)


def obelisk(name='obelisk', seed=503):
    parts = [box('base', (3.2, 3.2, 1.2), (0, 0, 0.6), WHITE, bevel=0.05), box('base2', (2.6, 2.6, 0.6), (0, 0, 1.5), MARBLE, bevel=0.04)]
    shaft = cylinder('shaft', 1.0, 14, (0, 0, 1.8), GRANITE, sides=4, r2=0.62)
    shaft.rotation_euler = (0, 0, math.pi / 4)
    tip = cylinder('tip', 0.62, 1.4, (0, 0, 15.8), GOLD, sides=4, r2=0.0)
    tip.rotation_euler = (0, 0, math.pi / 4)
    parts += [shaft, tip]
    for k in range(4):
        a = k * math.pi / 2
        parts.append(box(f'glyph{k}', (0.5, 0.06, 6.0), (math.cos(a) * 0.86, math.sin(a) * 0.86, 7.0), SUNGLOW, rot=(0, 0, a + math.pi / 2)))
    finish(name, parts, [box('c', (3.2, 3.2, 1.8), (0, 0, 0.9)), cylinder('c2', 1.0, 14, (0, 0, 1.8), sides=4, r2=0.6)], None, seed, sub=2.5)


def stairs(name='stairs', width=10.0, rise=6.0, seed=504):
    """A grand flight rising along +Y (Blender), with balustraded side walls and gold finials."""
    n = int(rise / 0.2)
    run = 0.38
    parts = [box(f's{i}', (width, run + 0.02, (i + 1) * 0.2), (0, i * run + run / 2, (i + 1) * 0.1), TILES if i % 6 else MARBLE, bevel=0.015) for i in range(n)]
    L = n * run
    for s in (-1, 1):
        wall = box(f'w{s}', (0.8, L, rise + 1.2), (s * (width / 2 + 0.4), L / 2, (rise + 1.2) / 2), WHITE, bevel=0.03)
        boolean(wall, box(f'wc{s}', (1.6, math.hypot(L, rise) + 6, 8), (s * (width / 2 + 0.4), L / 2, rise / 2 + 1.2 + 4.0), rot=(math.atan2(rise, L), 0, 0)))
        parts.append(wall)
        parts.append(box(f'cap{s}', (1.0, 1.0, 1.6), (s * (width / 2 + 0.4), 0.5, 0.8), MARBLE, bevel=0.04))
        parts.append(cylinder(f'fin{s}', 0.28, 0.6, (s * (width / 2 + 0.4), 0.5, 1.6), GOLD, sides=16, r2=0.05))
    ramp = box('ramp', (width, math.hypot(L, rise) + 0.3, 0.4), (0, L / 2, rise / 2 - 0.15), rot=(math.atan2(rise, L), 0, 0))
    cols = [ramp] + [box(f'cw{s}', (0.8, L, rise + 1.2), (s * (width / 2 + 0.4), L / 2, (rise + 1.2) / 2)) for s in (-1, 1)]
    finish(name, parts, cols, None, seed)


def brazier(name='brazier', seed=505):
    parts = [cylinder('foot', 0.7, 0.3, (0, 0, 0), WHITE, sides=24, r2=0.6), cylinder('stem', 0.22, 1.4, (0, 0, 0.3), GOLD, sides=16, r2=0.18),
             cylinder('bowl', 0.35, 0.5, (0, 0, 1.7), GOLD, sides=32, r2=0.85), cylinder('coals', 0.75, 0.08, (0, 0, 2.15), SUNGLOW, sides=32)]
    finish(name, parts, [cylinder('c', 0.6, 2.2, (0, 0, 0), sides=8)], None, seed)


def pillar_broken(name='pillar_broken', seed=506):
    parts = column_parts(0, 0, h=8, r=0.55, tag='b')[:4]
    top = parts[2]
    boolean(top, rock_cutter('snap', Vector((0.1, 0.1, 0.65 + 4.2)), 0.7, seed, squash=(1.3, 1.3, 0.6)))
    for i in range(2):
        d = cylinder(f'drum{i}', 0.55, 1.4, (0, 0, 0), MARBLE, sides=32)
        d.rotation_euler = (math.pi / 2, 0, 0.6 + i * 0.5)
        d.location = (1.6 + i * 1.5, -0.4 + i * 0.6, 0.55)
        parts.append(d)
    finish(name, parts, [cylinder('c', 0.6, 5, (0, 0, 0), sides=8), box('c2', (3.6, 1.4, 1.1), (2.3, -0.1, 0.55))], None, seed)


def mirror(name='mirror', seed=507):
    """A sun-mirror: a polished gold disc on a yoke, turned to catch a sun that no longer shines."""
    parts = [box('base', (1.6, 1.6, 0.4), (0, 0, 0.2), WHITE, bevel=0.04), cylinder('post', 0.14, 2.6, (0, 0, 0.4), GOLD, sides=16),
             box('yoke', (2.9, 0.18, 0.18), (0, 0, 3.0), GOLD)]
    for s in (-1, 1):
        parts.append(box(f'arm{s}', (0.18, 0.18, 1.6), (s * 1.4, 0, 3.8), GOLD))
    parts += [cylinder('disc', 1.3, 0.12, (0, 0.05, 4.2), GOLD, rot=(math.pi / 2 - 0.25, 0, 0), sides=48),
              cylinder('face', 1.15, 0.13, (0, 0.04, 4.2), SUNGLOW, rot=(math.pi / 2 - 0.25, 0, 0), sides=48)]
    finish(name, parts, [box('c', (1.6, 1.6, 3.2), (0, 0, 1.6))], None, seed)


def statue_pentarch(name='statue_pentarch', seed=508):
    """One of the five, hooded and faceless, a sun-disc held before it in both hands."""
    def body(p):
        robe = sdf.capsule((0, 0, 1.7), (0, 0.05, 5.0), 0.8, 0.45)(p)
        skirt = sdf.capsule((0, 0, 1.6), (0, 0, 3.4), 1.05, 0.66)(p)
        hood = sdf.ellipsoid((0, 0.02, 5.6), (0.42, 0.46, 0.55))(p)
        face = -sdf.ellipsoid((0, -0.32, 5.5), (0.24, 0.2, 0.3))(p)
        arms = np.minimum(sdf.capsule((-0.6, 0, 4.8), (-0.25, -0.75, 4.1), 0.17, 0.14)(p), sdf.capsule((0.6, 0, 4.8), (0.25, -0.75, 4.1), 0.17, 0.14)(p))
        folds = 0.035 * np.sin(np.arctan2(p[:, 1], p[:, 0]) * 14) * (p[:, 2] < 5.0)
        return np.minimum(np.minimum(np.maximum(hood, face), np.minimum(robe, skirt)), arms) - folds

    def disc(p):
        q = p - np.array([0, -0.95, 4.2])
        return np.maximum(np.hypot(q[:, 0], q[:, 2]) - 0.62, np.abs(q[:, 1]) - 0.06)

    def plinth(p):
        return sdf.box((0, 0, 0.8), (1.5, 1.5, 0.8), 0.06)(p)

    def field(p):
        return np.minimum(np.minimum(body(p), disc(p)), plinth(p))

    o = sculpt(name, field, (-2, -2, -0.05), (2, 2, 6.4), 0.035, 10000, [(plinth, WHITE), (body, MARBLE), (disc, GOLD)])
    metric_uv(o, seed=seed)
    if AO:
        bake_ao(o)
    export_piece(os.path.join(OUT, f'{name}.glb'), o, collision(name, [box('c', (3, 3, 1.6), (0, 0, 0.8)), cylinder('c2', 0.95, 4.6, (0, 0, 1.6), sides=8)]), ao=AO)


def dais(name='dais', R=24.0, seed=509):
    """The Eclipse Dais: a vast round platform of gold-inlaid marble on a stepped drum, open to the sky."""
    parts = []
    for i in range(4):
        parts.append(cylinder(f'tier{i}', R + 4 - i * 1.2, 1.0, (0, 0, -4 + i * 1.0), WHITE if i % 2 else GRANITE, sides=96))
    parts.append(cylinder('floor', R, 0.3, (0, 0, -0.3), TILES, sides=96))
    for r in (R * 0.35, R * 0.7, R - 0.6):
        ring = cylinder(f'inlay{r:.0f}', r + 0.22, 0.32, (0, 0, -0.3), GOLD, sides=96)
        boolean(ring, cylinder(f'inc{r:.0f}', r - 0.22, 1, (0, 0, -0.6), sides=96))
        parts.append(ring)
    for k in range(12):
        a = k / 12 * math.tau
        parts.append(box(f'spoke{k}', (R * 0.33, 0.3, 0.33), (math.cos(a) * R * 0.53, math.sin(a) * R * 0.53, -0.3), GOLD, rot=(0, 0, a)))
    for k in range(16):
        a = (k + 0.5) / 16 * math.tau
        if k in (11, 12):
            continue
        parts.append(box(f'post{k}', (0.8, 0.8, 1.3), (math.cos(a) * (R - 0.6), math.sin(a) * (R - 0.6), 0.65), MARBLE, bevel=0.04))
        parts.append(cylinder(f'fin{k}', 0.22, 0.5, (math.cos(a) * (R - 0.6), math.sin(a) * (R - 0.6), 1.3), GOLD, sides=12, r2=0.04))
    parts.append(cylinder('sun', 1.4, 0.36, (0, 0, -0.3), SUNGLOW, sides=48))
    cols = [cylinder('c', R + 4, 4.0, (0, 0, -4.0), sides=24)]
    for k in range(16):
        if k in (11, 12):
            continue
        a = (k + 0.5) / 16 * math.tau
        cols.append(box(f'cp{k}', (0.8, 0.8, 1.3), (math.cos(a) * (R - 0.6), math.sin(a) * (R - 0.6), 0.65)))
    finish(name, parts, cols, None, seed, sub=3.0)


def halo(name='halo', R=30.0, seed=510):
    """The ring that hangs over the dais: a gold band carved with the five gods' sigils, sun-glow seams."""
    ring = cylinder('ring', R + 1.2, 2.4, (0, 0, -1.2), GOLD, sides=128)
    boolean(ring, cylinder('in', R - 1.2, 4, (0, 0, -2), sides=128))
    parts = [ring]
    seam = cylinder('seam', R + 1.26, 0.25, (0, 0, -0.12), SUNGLOW, sides=128)
    boolean(seam, cylinder('sin', R + 1.0, 1, (0, 0, -0.5), sides=128))
    parts.append(seam)
    for k in range(5):
        a = k / 5 * math.tau
        parts.append(cylinder(f'sig{k}', 2.2, 0.6, (math.cos(a) * (R + 1.4), math.sin(a) * (R + 1.4), 0), MARBLE, rot=(0, math.pi / 2, a), sides=32))
        parts.append(cylinder(f'sigg{k}', 1.4, 0.66, (math.cos(a) * (R + 1.42), math.sin(a) * (R + 1.42), 0), SUNGLOW, rot=(0, math.pi / 2, a), sides=24))
    finish(name, parts, None, None, seed, sub=4.0)


def wall(name='wall', seed=511):
    w = box('wall', (12, 1.4, 6), (0, 0, 3), WHITE, bevel=0.04)
    parts = [w, box('corn', (12.4, 1.8, 0.45), (0, 0, 6.2), GOLD, bevel=0.03), box('base', (12.4, 1.8, 0.6), (0, 0, 0.3), GRANITE, bevel=0.04)]
    for k in range(3):
        boolean(w, join([box(f'n{k}', (1.6, 0.6, 2.6), (-4 + k * 4, -0.6, 2.6)), cylinder(f'nc{k}', 0.8, 0.6, (-4 + k * 4, -0.3, 3.9), rot=(math.pi / 2, 0, 0), sides=20)], f'niche{k}'))
        parts.append(box(f'lamp{k}', (0.5, 0.3, 0.5), (-4 + k * 4, -0.45, 2.2), SUNGLOW))
    rng = np.random.default_rng(seed)
    dmg = [Vector((rng.uniform(-6, 6), 0, 6.4)) for _ in range(2)]
    finish(name, parts, [box('c', (12, 1.4, 6), (0, 0, 3))], dmg, seed)


def plinth_block(name='plinth_block', seed=512):
    finish(name, [box('b', (4, 4, 2.0), (0, 0, 1.0), WHITE, bevel=0.06), box('t', (4.4, 4.4, 0.3), (0, 0, 2.1), MARBLE, bevel=0.04)],
           [box('c', (4.4, 4.4, 2.25), (0, 0, 1.12))], None, seed)


def shards(name='shards', seed=513):
    """A cluster of floating golden fragments (no collision): drifting gilt and stone around the citadel."""
    rng = np.random.default_rng(seed)
    parts = []
    for k in range(9):
        c = rng.normal(0, 1.5, 3)
        s = rng.uniform(0.3, 1.0, 3)
        b = box(f'sh{k}', tuple(s), tuple(c), GOLD if k % 3 else MARBLE, rot=tuple(rng.uniform(0, math.pi, 3)), bevel=0.02)
        boolean(b, rock_cutter(f'cut{k}', Vector(c) + Vector(rng.normal(0, 0.3, 3)), 0.6, seed + k))
        parts.append(b)
    finish(name, parts, None, None, seed)


PIECES = {
    'gate': gate, 'colonnade': colonnade, 'obelisk': obelisk, 'stairs': stairs, 'brazier': brazier, 'pillar_broken': pillar_broken,
    'mirror': mirror, 'statue_pentarch': statue_pentarch, 'dais': dais, 'halo': halo, 'wall': wall, 'plinth_block': plinth_block, 'shards': shards,
}

names = ARGS or list(PIECES)
for nme in names:
    reset()
    print('---', nme, flush=True)
    PIECES[nme]()
