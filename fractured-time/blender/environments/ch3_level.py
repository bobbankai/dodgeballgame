"""
CHAPTER 3: THE DOPPELGANGER. The HELIX Corporate Arcology, which exists in two timelines at once (Timeline Shift swaps them):
  timeline a: 2089, operational, immaculate: marble, glass, warm white light, the HELIX brand on every wall
  timeline b: the same rooms twenty years abandoned: dim, cracked, overgrown, floors fallen through
Every room has a shared shell (walls, structure) and each timeline's own dressing, floors and obstacles, so the way through is found
by switching between them.
  a1 lobby     A: a turnstile wall seals the lift lobby. B: the wall is rubble, but the floor in front of the lifts has collapsed.
  a2 offices   A: glass partitions make a maze. B: the glass is gone, but collapsed ceiling and furniture piles block other routes.
  a3 palimpsest  Project Palimpsest's lab: the records, the recorder that teaches Temporal Echo, a gate held by a pressure plate.
  a4 mirror    the mirror hall: a glass wall down its length with the hall's twin behind it. The reflection is not Ethan.
  a5 core      the Palimpsest Core: the archive cylinder in a square hall; the fight with the Echo (the arena falls into ruin at half way).
  blender -b --factory-startup --python-exit-code 1 -P blender/environments/ch3_level.py -- [--only a1] [--render KEY out.png] [--export]
"""
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import bpy  # noqa: E402

import ch1_level as L1  # noqa: E402
import citykit as CK  # noqa: E402
import envkit as K  # noqa: E402

OUT = os.path.join(K.PUB, 'environments', 'ch3')


def materials():
    M = L1.materials()
    M.update({
        'a_marble': K.mat('a_marble', 'marble_01', 0.35, tint=(0.82, 0.8, 0.78), desat=0.6, rough_mul=0.5, coat=0.3),
        'a_stone': K.mat('a_stone', 'grey_cartago_01', 0.5, tint=(0.62, 0.6, 0.58), desat=0.7, rough_mul=0.7),
        'a_wood': K.mat('a_wood', 'wood_floor', 0.6, tint=(0.62, 0.48, 0.36), desat=0.6),
        'a_carpet': K.mat('a_carpet', 'dirty_carpet', 1.2, tint=(0.18, 0.2, 0.22), desat=0.9),
        'a_panel': K.plain_mat('a_panel', (0.72, 0.72, 0.7), rough=0.35),
        'a_brand': K.emissive_mat('a_brand', (1.0, 0.55, 0.18), 6.0),
        'a_light': K.emissive_mat('a_light', (1.0, 0.94, 0.86), 14.0),
        'b_ruin': K.mat('b_ruin', 'concrete_wall_003', 0.4, tint=(0.32, 0.32, 0.3), desat=0.7),
        'b_moss': K.mat('b_moss', 'brick_moss_001', 0.5, tint=(0.5, 0.58, 0.45), desat=0.1),
        'b_water': K.plain_mat('b_water', (0.03, 0.04, 0.04), rough=0.05),
    })
    M['glass'] = K.glass_mat('a_glass', tint=(0.8, 0.88, 0.92), rough=0.03)
    M['a_white'] = K.plain_mat('a_white', (0.78, 0.78, 0.76), rough=0.3)
    M['a_core'] = K.emissive_mat('a_core', (1.0, 0.55, 0.22), 9.0)
    M['a_cyan'] = K.emissive_mat('a_cyan', (0.35, 0.85, 1.0), 6.0)
    M['a_floodwater'] = K.water_mat('a_floodwater', tint=(0.32, 0.45, 0.42), dist=0.5, waves=0.15, scale=0.8, flow=0.35)
    return M


def shell(S, name, x0, x1, y0, y1, H, M, openings):
    """The shared structure of a room (both timelines): walls with openings, ceiling, structural columns. No floor: each timeline
    lays its own (marble in a, broken concrete in b), so a hole in one reality can be whole in the other."""
    K.room(S, name, x0, x1, y0, y1, H, M, openings=openings, beams=False, ceiling=True, floor_mat='wall')
    # K.room adds a floor and its collider: remove both (each timeline brings its own)
    for o in [o for o in S.static if o.name == f'{name}_floor'] + [o for o in S.collide if o.name == f'col_{name}_floor']:
        (S.static if o in S.static else S.collide).remove(o)
        bpy.data.objects.remove(o)


def floor_tiles(S, name, x0, x1, y0, y1, M_a, M_b, holes_b=(), holes_a=()):
    """Each timeline's floor as 2 m tiles; holes (x, y) in one timeline leave that tile out (and its collider)."""
    n_x, n_y = int(round((x1 - x0) / 2)), int(round((y0 - y1) / 2))
    for tl, mat, holes in (('a', M_a, holes_a), ('b', M_b, holes_b)):
        rows = {}
        for i in range(n_x):
            for j in range(n_y):
                cx, cy = x0 + 1 + 2 * i, y0 - 1 - 2 * j
                if any(abs(cx - hx) < 1.01 and abs(cy - hy) < 1.01 for hx, hy in holes):
                    continue
                rows.setdefault(j, []).append(cx)
        for j, xs in rows.items():
            cy = y0 - 1 - 2 * j
            # merge contiguous tiles into strips (fewer objects, fewer colliders)
            runs, start, prev = [], xs[0], xs[0]
            for cx in xs[1:]:
                if cx - prev > 2.01:
                    runs.append((start, prev))
                    start = cx
                prev = cx
            runs.append((start, prev))
            for a, b in runs:
                w = b - a + 2
                S.add(K.box(f'{name}_fl{tl}{j}_{a}', (w, 2.0, 0.3), ((a + b) / 2, cy, -0.15), mat, bevel=0.0), timeline=tl)
                K.collide_box(S, f'{name}_fl{tl}{j}_{a}', (w, 2.0, 0.3), ((a + b) / 2, cy, -0.15), timeline=tl)


def s_lobby(M):
    S = K.Section('a1')
    x0, x1, y0, y1, H = -12.0, 12.0, 0.0, -30.0, 9.0
    shell(S, 'a1', x0, x1, y0, y1, H, M, {'s': [(0, 3.0)], 'n': [(0, 3.0)]})
    # the floor: the pit in front of the lifts exists only in timeline b
    pit = [(x, y) for x in (-3, -1, 1, 3) for y in (-23, -25)]
    floor_tiles(S, 'a1', x0, x1, y0, y1, M['a_marble'], M['b_ruin'], holes_b=pit)
    S.add(K.box('a1_pitfloor', (8.0, 4.0, 0.3), (0, -24, -6.15), M['b_ruin'], bevel=0.0), timeline='b')
    K.collide_box(S, 'a1_pitfloor', (8.0, 4.0, 0.3), (0, -24, -6.15), timeline='b')
    K.marker(S, 'trigger', (0, -24, -5.0), size=[8.0, 4.0, 2.0], id='a1_pit')
    # timeline a: reception, the HELIX wall, planters, glass balustrades on a mezzanine, and the turnstile wall sealing the lifts
    S.add(K.box('a1_desk', (6.0, 1.2, 1.1), (0, -9, 0.55), M['a_stone'], bevel=0.04), timeline='a')
    K.collide_box(S, 'a1_desk', (6.0, 1.2, 1.1), (0, -9, 0.55), timeline='a')
    S.add(K.sign('a1_brand', 'HELIX DYNAMICS', (0, -0.35, 5.4), (math.radians(90), 0, 0), 0.9, M['a_brand']), timeline='a')
    for x in (-8, 8):
        S.add(K.box(f'a1_planter{x}', (2.0, 2.0, 0.8), (x, -14, 0.4), M['a_stone'], bevel=0.05), timeline='a')
        K.collide_box(S, f'a1_planter{x}', (2.0, 2.0, 0.8), (x, -14, 0.4), timeline='a')
        S.add(K.debris(f'a1_shrub{x}', (x, -14, 0.8), M, n=5, seed=int(abs(x)), size=0.45), timeline='a')
    S.add(K.box('a1_turnstiles', (16.0, 0.5, 2.4), (0, -20.5, 1.2), M['glass'], bevel=0.0), timeline='a')
    S.add(K.box('a1_turnstile_frame', (16.2, 0.6, 0.2), (0, -20.5, 2.5), M['a_panel'], bevel=0.02), timeline='a')
    K.collide_box(S, 'a1_turnstiles', (24.0, 0.6, 3.0), (0, -20.5, 1.5), timeline='a')
    for i, x in enumerate((-9.0, -3.0, 3.0, 9.0)):
        S.add(K.box(f'a1_lamp{i}', (2.4, 0.4, 0.06), (x, -12, H - 0.05), M['a_light'], bevel=0.0), timeline='a')
        K.area_light(f'a1_lampA{i}', (x, -12, H - 0.15), (2.4, 0.4), 260.0, (1.0, 0.95, 0.88), timeline='a')
    # timeline b: the turnstile wall lies in rubble, moss in the cracks, water pooling, a fallen light; the floor has dropped away
    S.add(K.debris('a1_rubble', (0, -20.5, 0), M, n=16, seed=33, size=0.5), timeline='b')
    S.add(K.box('a1_puddle', (5.0, 3.5, 0.02), (-6, -6, 0.01), M['b_water'], bevel=0.0), timeline='b')
    S.add(K.box('a1_moss1', (3.0, 6.0, 0.03), (8, -16, 0.015), M['b_moss'], bevel=0.0), timeline='b')
    S.add(K.box('a1_desk_b', (6.0, 1.2, 1.1), (0.5, -9.3, 0.55), M['b_ruin'], bevel=0.04, rot=(0, 0.12, 0.2)), timeline='b')
    K.collide_box(S, 'a1_desk_b', (6.0, 1.4, 1.1), (0.5, -9.3, 0.55), timeline='b')
    K.area_light('a1_skylightB', (0, -15, H - 0.3), (6.0, 6.0), 180.0, (0.55, 0.62, 0.72), timeline='b')
    # the lifts on the north wall (shared)
    for x in (-4.5, 4.5):
        S.add(K.box(f'a1_lift{x}', (2.6, 0.3, 3.0), (x, -29.7, 1.5), M['door'], bevel=0.02))
    K.marker(S, 'spawn', (0, -2.5, 0.05), yaw=0.0, id='start')
    K.marker(S, 'checkpoint', (0, -2.5, 0.05), yaw=0.0, id='cp_a1')
    K.marker(S, 'trigger', (0, -28.0, 1.0), size=[6.0, 2.0, 2.0], id='a1_lifts')
    K.marker(S, 'camera', (8.0, -4.0, 6.0), id='a1_reveal', target=[0, -20, 2.0])
    return S


def s_offices(M):
    S = K.Section('a2')
    x0, x1, y0, y1, H = -12.0, 12.0, -30.0, -60.0, 4.2
    shell(S, 'a2', x0, x1, y0, y1, H, M, {'s': [(0, 3.0)], 'n': [(6.0, 2.4)]})
    floor_tiles(S, 'a2', x0, x1, y0, y1, M['a_carpet'], M['b_ruin'])
    rng = random.Random(4)
    # timeline a: glass partitions (a maze: the gaps alternate), desks in pods
    walls_a = [((-12, -38), (6, -38)), ((-6, -46), (12, -46)), ((-12, -53), (4, -53))]
    for i, ((ax, ay), (bx, by)) in enumerate(walls_a):
        L = abs(bx - ax)
        S.add(K.box(f'a2_glass{i}', (L, 0.06, 2.4), ((ax + bx) / 2, ay, 1.2), M['glass'], bevel=0.0), timeline='a')
        S.add(K.box(f'a2_gframe{i}', (L, 0.1, 0.08), ((ax + bx) / 2, ay, 2.42), M['a_panel'], bevel=0.0), timeline='a')
        K.collide_box(S, f'a2_glass{i}', (L, 0.3, 2.6), ((ax + bx) / 2, ay, 1.3), timeline='a')
    for k in range(10):
        x, y = rng.uniform(-10, 10), rng.uniform(-57, -33)
        S.add(K.box(f'a2_desk{k}', (1.6, 0.8, 0.75), (x, y, 0.375), M['a_wood'], bevel=0.02), timeline='a')
        S.add(K.box(f'a2_screen{k}', (0.6, 0.04, 0.36), (x, y + 0.2, 0.95), M['screen0'], bevel=0.005), timeline='a')
    for i in range(3):
        S.add(K.box(f'a2_lightA{i}', (8.0, 0.3, 0.05), (0, -36 - i * 9, H - 0.04), M['a_light'], bevel=0.0), timeline='a')
        K.area_light(f'a2_lA{i}', (0, -36 - i * 9, H - 0.12), (8.0, 0.3), 220.0, (1.0, 0.96, 0.9), timeline='a')
    # timeline b: the glass is gone, but the ceiling came down in two places and the furniture is piled across the other routes
    walls_b = [((-4, -42), (12, -42)), ((-12, -50), (5, -50))]
    for i, ((ax, ay), (bx, by)) in enumerate(walls_b):
        L = abs(bx - ax)
        S.add(K.box(f'a2_collapse{i}', (L, 1.6, 1.6), ((ax + bx) / 2, ay, 0.8), M['b_ruin'], bevel=0.2, rot=(0.15, 0.05, 0.0)),
              timeline='b')
        S.add(K.debris(f'a2_cdebris{i}', ((ax + bx) / 2, ay + 1.2, 0), M, n=12, seed=50 + i, size=0.4), timeline='b')
        K.collide_box(S, f'a2_collapse{i}', (L, 1.8, 2.0), ((ax + bx) / 2, ay, 1.0), timeline='b')
    S.add(K.box('a2_moss', (6.0, 10.0, 0.03), (-6, -40, 0.015), M['b_moss'], bevel=0.0), timeline='b')
    K.area_light('a2_lB', (0, -45, H - 0.3), (10.0, 4.0), 120.0, (0.5, 0.58, 0.68), timeline='b')
    K.marker(S, 'checkpoint', (0, -32.0, 0.05), yaw=0.0, id='cp_a2')
    K.marker(S, 'trigger', (6.0, -59.0, 1.0), size=[2.4, 1.0, 2.0], id='a2_exit')
    return S


def lab_bench(S, name, x, y, rot_z, M, tl):
    """A lab bench: worktop on a cabinet, a monitor arm, sample racks."""
    R = __import__('mathutils').Matrix.Rotation(rot_z, 4, 'Z')
    V = __import__('mathutils').Vector
    for size, loc, mat in (((2.4, 0.8, 0.06), (0, 0, 0.92), M['a_white']), ((2.3, 0.7, 0.86), (0, 0.02, 0.45), M['a_panel']),
                           ((0.5, 0.05, 0.32), (-0.6, 0.3, 1.25), M['screen1']), ((0.05, 0.05, 0.3), (-0.6, 0.33, 1.05), M['trim']),
                           ((0.7, 0.18, 0.2), (0.5, 0.2, 1.05), M['trim'])):
        p = R @ V(loc)
        S.add(K.box(f'{name}_{loc[0]}{loc[2]}', size, (x + p.x, y + p.y, p.z), mat, bevel=0.01, rot=(0, 0, rot_z)), timeline=tl)
    K.collide_box(S, name, (2.4 if abs(math.sin(rot_z)) < 0.5 else 0.8, 0.8 if abs(math.sin(rot_z)) < 0.5 else 2.4, 1.0), (x, y, 0.5), timeline=tl)


def s_palimpsest(M):
    """Project Palimpsest. Timeline a: a white laboratory, the records on its consoles, the recorder in the middle of the room (it
    teaches Temporal Echo) and a glass partition whose gate opens only while its pressure plate is held. Timeline b: the same lab
    gutted; the partition is a collapsed wall with the gate jammed in it, so the echo is the only way through either way."""
    S = K.Section('a3')
    x0, x1, y0, y1, H = -12.0, 12.0, -60.0, -92.0, 5.0
    shell(S, 'a3', x0, x1, y0, y1, H, M, {'s': [(6.0, 2.4)], 'n': [(-4.0, 3.0)]})
    floor_tiles(S, 'a3', x0, x1, y0, y1, M['floor_tile'], M['b_ruin'])
    # the partition across the room at y = -80, the gate in it at x = 0
    for xa, xb in ((x0, -1.4), (1.4, x1)):
        L = xb - xa
        S.add(K.box(f'a3_part{xa}', (L, 0.08, H - 0.4), ((xa + xb) / 2, -80.0, (H - 0.4) / 2), M['glass'], bevel=0.0), timeline='a')
        S.add(K.box(f'a3_partf{xa}', (L, 0.14, 0.1), ((xa + xb) / 2, -80.0, H - 0.4), M['a_panel'], bevel=0.01), timeline='a')
        S.add(K.box(f'a3_partb{xa}', (L, 0.6, H), ((xa + xb) / 2, -80.0, H / 2), M['b_ruin'], bevel=0.06), timeline='b')
        K.collide_box(S, f'a3_part{xa}', (L, 0.6, H), ((xa + xb) / 2, -80.0, H / 2))
    S.add(K.box('a3_gatehead', (2.8, 0.3, 0.6), (0, -80.0, 3.2), M['trim'], bevel=0.02))
    for sx in (-1.45, 1.45):
        S.add(K.box(f'a3_gatejamb{sx}', (0.16, 0.3, 3.2), (sx, -80.0, 1.6), M['trim'], bevel=0.02))
    K.sliding_door(S, 'a3_gate', (0, -80.0), True, 2.8, M, door_h=2.9, state='locked')
    # the pressure plate that holds the gate, six metres off to the west (a ring of light set in the floor)
    S.add(K.cylinder('a3_plate', 0.75, 0.04, (-7.0, -74.0, 0.02), M['trim'], verts=48, bevel=0.0))
    S.add(K.cylinder('a3_plate_ring', 0.82, 0.02, (-7.0, -74.0, 0.012), M['a_cyan'], verts=48, bevel=0.0))
    K.marker(S, 'plate', (-7.0, -74.0, 0.05), id='a3_plate', door='a3_gate', hold=2.5)
    # benches + consoles (timeline a); stripped frames and fallen panels (b)
    for i, (x, y, r) in enumerate(((-9.5, -64, math.pi / 2), (-9.5, -69, math.pi / 2), (9.5, -64, -math.pi / 2), (9.5, -69, -math.pi / 2))):
        lab_bench(S, f'a3_bench{i}', x, y, r, M, 'a')
        S.add(K.debris(f'a3_bdeb{i}', (x * 0.9, y, 0), M, n=6, seed=70 + i, size=0.35), timeline='b')
    S.add(K.console('a3_log1', (-4.0, -63.5, 0), math.pi, M, M['screen0']), timeline='a')
    S.add(K.console('a3_log2', (4.0, -77.5, 0), 0.0, M, M['screen2']), timeline='a')
    K.collide_box(S, 'a3_log1', (1.4, 0.8, 1.0), (-4.0, -63.5, 0.5), timeline='a')
    K.collide_box(S, 'a3_log2', (1.4, 0.8, 1.0), (4.0, -77.5, 0.5), timeline='a')
    K.marker(S, 'interact', (-4.0, -64.6, 0.2), id='a3_log1', prompt='Read the Palimpsest log', log=3)
    K.marker(S, 'interact', (4.0, -76.4, 0.2), id='a3_log2', prompt='Read the Palimpsest log', log=4)
    # the recorder: a pedestal with a ring of chronal light, both realities (it still runs in the ruin, which is the point)
    S.add(K.cylinder('a3_pedestal', 0.55, 1.0, (4.0, -70.0, 0.5), M['trim'], verts=40, bevel=0.03))
    S.add(K.cylinder('a3_pedring', 0.62, 0.05, (4.0, -70.0, 1.02), M['a_core'], verts=40, bevel=0.0))
    S.add(K.cylinder('a3_pedcore', 0.18, 0.5, (4.0, -70.0, 1.3), M['a_core'], verts=24, bevel=0.02))
    K.collide_box(S, 'a3_pedestal', (1.2, 1.2, 1.1), (4.0, -70.0, 0.55))
    K.area_light('a3_recorder_l', (4.0, -70.0, 2.0), (0.5, 0.5), 60.0, (1.0, 0.55, 0.22), shape='DISK')
    K.marker(S, 'interact', (4.0, -68.6, 0.2), id='a3_recorder', prompt='Touch the recorder')
    # the archive beyond the gate: PROJECT PALIMPSEST on the wall, shelving of storage cores
    S.add(K.sign('a3_title', 'PROJECT PALIMPSEST', (0, -91.6, 3.4), (math.radians(90), 0, math.pi), 0.5, M['a_brand']), timeline='a')
    for i in range(6):
        x = -9.0 + i * 3.6
        S.add(K.box(f'a3_core{i}', (1.2, 0.6, 2.4), (x, -88.5, 1.2), M['trim'], bevel=0.03))
        S.add(K.box(f'a3_corel{i}', (1.0, 0.02, 0.06), (x, -88.19, 1.8), M['a_cyan'], bevel=0.0), timeline='a')
        K.collide_box(S, f'a3_core{i}', (1.2, 0.6, 2.4), (x, -88.5, 1.2))
    # light: the lab in 2089 (cool white strips), the ruin (grey daylight through a hole in the ceiling)
    for i, y in enumerate((-65.0, -72.0, -86.0)):
        S.add(K.box(f'a3_lampA{i}', (10.0, 0.3, 0.05), (0, y, H - 0.04), M['a_light'], bevel=0.0), timeline='a')
        K.area_light(f'a3_lA{i}', (0, y, H - 0.12), (10.0, 0.3), 260.0, (0.94, 0.97, 1.0), timeline='a')
    K.area_light('a3_lB', (-3.0, -70.0, H - 0.3), (3.0, 3.0), 160.0, (0.55, 0.62, 0.72), timeline='b')
    K.area_light('a3_lB2', (2.0, -86.0, H - 0.3), (2.0, 2.0), 80.0, (0.55, 0.62, 0.72), timeline='b')
    S.add(K.debris('a3_ceilfall', (-3.0, -70.0, 0), M, n=14, seed=91, size=0.5), timeline='b')
    K.marker(S, 'checkpoint', (6.0, -62.0, 0.05), yaw=0.0, id='cp_a3')
    K.marker(S, 'trigger', (-4.0, -90.5, 1.0), size=[3.0, 1.0, 2.0], id='a3_exit')
    K.marker(S, 'camera', (8.5, -62.0, 3.6), id='a3_reveal', target=[0, -80.0, 1.6])
    return S


def s_mirror(M):
    """The mirror hall: a gallery split down its length by a glass wall, with the gallery's exact twin built behind it, so the glass
    reads as a mirror. Ethan walks the west half; in the east half his reflection walks with him, until it doesn't."""
    S = K.Section('a4')
    x0, x1, y0, y1, H = -8.0, 8.0, -92.0, -124.0, 6.0
    shell(S, 'a4', x0, x1, y0, y1, H, M, {'s': [(-4.0, 3.0)], 'n': [(-4.0, 3.0)]})
    for tl, mat in (('a', M['a_marble']), ('b', M['b_ruin'])):
        S.add(K.box(f'a4_floor{tl}', (x1 - x0, y0 - y1, 0.3), (0, (y0 + y1) / 2, -0.15), mat, bevel=0.0), timeline=tl)
    K.collide_box(S, 'a4_floor', (x1 - x0, y0 - y1, 0.3), (0, (y0 + y1) / 2, -0.15))
    # the glass down the middle (both realities: it survived)
    S.add(K.box('a4_glass', (0.06, y0 - y1, H - 0.2), (0, (y0 + y1) / 2, (H - 0.2) / 2), M['glass'], bevel=0.0))
    for y in range(int(y1) + 4, int(y0), 4):
        S.add(K.box(f'a4_mull{y}', (0.12, 0.12, H), (0, y, H / 2), M['trim'], bevel=0.01))
    K.collide_box(S, 'a4_glass', (0.4, y0 - y1, H), (0, (y0 + y1) / 2, H / 2))
    # the twin halves: everything on the west side is mirrored to the east (x -> -x)
    for sx in (-1, 1):
        for k, y in enumerate(range(-96, -122, -6)):
            S.add(K.box(f'a4_col{sx}{k}', (0.7, 0.7, H), (sx * 7.4, y, H / 2), M['a_stone'], bevel=0.04))
            S.add(K.box(f'a4_bench{sx}{k}', (0.6, 2.2, 0.45), (sx * 5.8, y - 3, 0.225), M['a_wood'], bevel=0.03), timeline='a')
            S.add(K.box(f'a4_lamp{sx}{k}', (0.3, 0.3, 0.6), (sx * 6.9, y, 3.4), M['a_light'], bevel=0.02), timeline='a')
            K.area_light(f'a4_lA{sx}{k}', (sx * 6.6, y, 3.4), (0.3, 0.6), 70.0, (1.0, 0.92, 0.82), rot=(0, math.radians(90 * sx), 0),
                         timeline='a')
            S.add(K.debris(f'a4_deb{sx}{k}', (sx * 5.0, y - 2, 0), M, n=7, seed=120 + k + (sx + 1) * 10, size=0.35), timeline='b')
        if sx == -1:
            for k, y in enumerate(range(-96, -122, -6)):
                K.collide_box(S, f'a4_col{k}', (0.7, 0.7, H), (-7.4, y, H / 2))
        # the twin's dead-end doorways (the mirror of the real ones)
        S.add(K.box(f'a4_recess{sx}', (3.0, 0.3, 2.9), (4.0, y0 - 0.1 if sx < 0 else y1 + 0.1, 1.45), M['dark'], bevel=0.0))
    K.area_light('a4_lB', (-4.0, -108.0, H - 0.3), (2.0, 12.0), 140.0, (0.5, 0.58, 0.7), timeline='b')
    K.area_light('a4_lB2', (4.0, -108.0, H - 0.3), (2.0, 12.0), 140.0, (0.5, 0.58, 0.7), timeline='b')
    K.marker(S, 'checkpoint', (-4.0, -94.0, 0.05), yaw=0.0, id='cp_a4')
    K.marker(S, 'trigger', (-4.0, -99.0, 1.0), size=[6.0, 1.0, 2.0], id='a4_mirror')
    K.marker(S, 'trigger', (-4.0, -116.0, 1.0), size=[6.0, 1.0, 2.0], id='a4_ambush')
    K.marker(S, 'enemies', (-4.0, -120.0, 0), id='a4_wave', group=[['operative', -5.5, -121.0, 3.14], ['operative', -2.5, -121.5, 3.14],
                                                                  ['heavy', -4.0, -122.5, 3.14]])
    K.marker(S, 'trigger', (-4.0, -123.0, 1.0), size=[3.0, 1.0, 2.0], id='a4_exit')
    K.marker(S, 'camera', (-1.2, -98.0, 1.7), id='a4_glass_cam', target=[0.0, -104.0, 1.5])
    return S


def s_core(M):
    """The Palimpsest Core: the archive of every timeline HELIX meant to overwrite, a glass cylinder of light in a square hall. The
    arena of the fight with the Echo. Timeline a: clean, four columns; b: the columns broken into cover, the floor flooded."""
    S = K.Section('a5')
    cx, cy = -4.0, -142.0
    x0, x1, y0, y1, H = cx - 14, cx + 14, -124.0, -160.0, 10.0
    shell(S, 'a5', x0, x1, y0, y1, H, M, {'s': [(cx, 3.0)]})
    for tl, mat in (('a', M['a_marble']), ('b', M['b_ruin'])):
        S.add(K.box(f'a5_floor{tl}', (x1 - x0, y0 - y1, 0.3), (cx, (y0 + y1) / 2, -0.15), mat, bevel=0.0), timeline=tl)
    K.collide_box(S, 'a5_floor', (x1 - x0, y0 - y1, 0.3), (cx, (y0 + y1) / 2, -0.15))
    # the archive: glass cylinder, light core, rings
    S.add(K.cylinder('a5_base', 3.0, 0.6, (cx, cy, 0.3), M['trim'], verts=64, bevel=0.04))
    S.add(K.cylinder('a5_glass', 2.2, 8.4, (cx, cy, 4.8), M['glass'], verts=64, bevel=0.0))
    S.add(K.cylinder('a5_corelight', 0.5, 8.0, (cx, cy, 4.6), M['a_core'], verts=32, bevel=0.0))
    for z in (2.0, 4.6, 7.2):
        S.add(K.cylinder(f'a5_ring{z}', 2.35, 0.12, (cx, cy, z), M['a_cyan'], verts=64, bevel=0.0))
    S.add(K.cylinder('a5_cap', 3.0, 0.6, (cx, cy, 9.4), M['trim'], verts=64, bevel=0.04))
    K.collide_box(S, 'a5_core', (5.6, 5.6, H), (cx, cy, H / 2))
    K.area_light('a5_core_l', (cx, cy, 4.6), (1.0, 1.0), 900.0, (1.0, 0.6, 0.3), shape='DISK')
    # four columns: whole in 2089; broken stumps and fallen drums (cover) in the ruin
    for k, (dx, dy) in enumerate(((-8, -8), (8, -8), (-8, 8), (8, 8))):
        x, y = cx + dx, cy + dy
        S.add(K.box(f'a5_col{k}', (1.2, 1.2, H), (x, y, H / 2), M['a_stone'], bevel=0.05), timeline='a')
        K.collide_box(S, f'a5_col{k}', (1.2, 1.2, H), (x, y, H / 2), timeline='a')
        S.add(K.box(f'a5_stump{k}', (1.2, 1.2, 1.6), (x, y, 0.8), M['b_ruin'], bevel=0.08), timeline='b')
        S.add(K.box(f'a5_drum{k}', (1.1, 2.6, 1.1), (x + 1.6, y, 0.55), M['b_ruin'], bevel=0.1, rot=(0, 0, 0.4 * k)), timeline='b')
        K.collide_box(S, f'a5_stump{k}', (1.2, 1.2, 1.6), (x, y, 0.8), timeline='b')
        K.collide_box(S, f'a5_drum{k}', (1.6, 2.8, 1.1), (x + 1.6, y, 0.55), timeline='b')
    # the ruin floods: a few centimetres of water over the low half of the floor
    S.add(K.box('a5_flood', (24.0, 14.0, 0.02), (cx, cy - 7.0, 0.04), M['a_floodwater'], bevel=0.0), timeline='b')
    for i, y in enumerate((-130.0, -154.0)):
        S.add(K.box(f'a5_lampA{i}', (20.0, 0.4, 0.06), (cx, y, H - 0.04), M['a_light'], bevel=0.0), timeline='a')
        K.area_light(f'a5_lA{i}', (cx, y, H - 0.12), (20.0, 0.4), 520.0, (0.92, 0.96, 1.0), timeline='a')
    K.area_light('a5_lB', (cx + 6, cy + 6, H - 0.3), (4.0, 4.0), 220.0, (0.5, 0.58, 0.72), timeline='b')
    K.marker(S, 'checkpoint', (cx, -127.0, 0.05), yaw=0.0, id='cp_a5')
    K.marker(S, 'trigger', (cx, -129.0, 1.0), size=[6.0, 1.0, 2.0], id='a5_enter')
    K.marker(S, 'boss', (cx, cy + 8.0, 0.05), yaw=0.0, id='echo')
    K.marker(S, 'camera', (cx + 9.0, -128.5, 2.4), id='a5_reveal', target=[cx, cy, 4.0])
    K.marker(S, 'camera', (cx - 3.0, -131.0, 1.6), id='a5_face', target=[cx, -134.0, 1.6])
    return S


SECTIONS = {'a1': s_lobby, 'a2': s_offices, 'a3': s_palimpsest, 'a4': s_mirror, 'a5': s_core}


def build():
    K.reset()
    M = materials()
    built = {}
    for key, fn in SECTIONS.items():
        mark = len(K.LIGHT_MARKERS)
        S = fn(M)
        S.lights = K.LIGHT_MARKERS[mark:]
        built[key] = S
    return built, M


def export(built, keys, samples):
    statics = {key: K.export_timeline_section(built[key], key, OUT, 'ch3', samples) for key in keys}
    K.strip_textures()
    for key in keys:
        S = built[key]
        K.export(statics[key] + S.collide + S.markers + S.lights + getattr(S, 'dynamic', []), os.path.join(OUT, f'{key}.glb'))


def probes(built, keys):
    """Character light probes for each reality (its own dressing and fixtures; the other's hidden): `_probes.json` / `_probes_b.json`."""
    for tl in ('a', 'b'):
        for S in built.values():
            K.show_timeline(S, tl)
        for key in keys:
            S = built[key]
            pts = K.probe_points(S.static + getattr(S, f'static_{tl}'), spacing=2.5, heights=(1.1,))
            K.bake_probes(pts, os.path.join(K.PUB, f'environments/ch3/{key}_probes{"_b" if tl == "b" else ""}.json'))
    for S in built.values():
        K.show_timeline(S, None)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    samples = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 96
    keys = argv[argv.index('--only') + 1].split(',') if '--only' in argv else list(SECTIONS)
    built, M = build()
    if '--render' in argv:
        key, out = argv[argv.index('--render') + 1], argv[argv.index('--render') + 2]
        tl = argv[argv.index('--timeline') + 1] if '--timeline' in argv else 'a'
        for S in built.values():
            K.show_timeline(S, tl)
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        bpy.context.scene.collection.objects.link(cam)
        mk = next((m for m in built[key].markers if m.get('marker') in ('spawn', 'checkpoint')), None)
        base = mk.location if mk else (0, 0, 0)
        cam.location = (base[0] + 1.0, base[1] + 1.0, 1.8)
        cam.rotation_euler = (math.radians(86), 0, math.radians(178))
        cam.data.lens = 18
        bpy.context.scene.camera = cam
        sc = bpy.context.scene
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.render.resolution_x, sc.render.resolution_y = 1280, 720
        sc.render.filepath = out
        bpy.ops.render.render(write_still=True)
    if '--probes' in argv:
        probes(built, keys)
    if '--volume' in argv:
        K.bake_volumes(built, keys, 'ch3', os.path.join(K.ROOT, 'vendor', 'polyhaven', 'hdri', 'approaching_storm_2k.hdr'), skip=())
    if '--export' in argv:
        export(built, keys, samples)
