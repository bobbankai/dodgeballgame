"""
CHAPTER 4: THE PARADOX. The fractures have joined places that were never next to each other, and several timelines interlock:
  p1 terrace   a terrace high in the future city. Timeline a (2101): white stone, glass, a reflecting pool under a clear sky.
               Timeline b: the same terrace a ruin under the storm. A glass bridge across a chasm exists only in a; the security
               gate at the far end is whole in a and smashed in b. Cross in one reality, pass in the other.
  p2 memory    the HELIX lab of 2079, ten years before the Incident: warm lamplight, wood and paper, the prediction on the board.
               Memory shards replay what happened in this room (one timeline: the past).
  p3 foundry   a temporal foundry coming apart. Timeline a: working, the casting channel molten across the floor, the exit door
               powered. Timeline b: cold and dead, the channel crossable, the door jammed. Cross in b, open the door in a.
  p4 crucible  Commander Nyx's ground: a round platform over the crucible. In b half its outer ring has fallen away; in her third
               phase the arena flips between the two on its own.
Sections sit far apart (the chapter travels between them through fades): p1 at the origin, p2 at x=200, p3/p4 at x=400.
  blender -b --factory-startup --python-exit-code 1 -P blender/environments/ch4_level.py -- [--only p1] [--render KEY out.png]
        [--timeline a|b] [--probes] [--volume] [--export]
"""
import math
import os
import random
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import bpy  # noqa: E402

import ch1_level as L1  # noqa: E402
import ch3_level as L3  # noqa: E402
import citykit as CK  # noqa: E402
import envkit as K  # noqa: E402

OUT = os.path.join(K.PUB, 'environments', 'ch4')
CLEAR_HDRI = os.path.join(K.ROOT, 'vendor', 'polyhaven', 'hdri', 'kloofendal_48d_partly_cloudy_puresky_2k.hdr')
CLEAR = 1.0
# p1's two skies: the future's clear afternoon, the ruin's storm at nightfall (the same storm as the district)
# (the ruin's storm has no city left under it to light the clouds)
SKIES = {'p1': {'a': (CLEAR_HDRI, CLEAR), 'b': (K.storm_hdri(0.08), 1.0)}}


def materials():
    M = L3.materials()
    M.update({
        'f_pool': K.water_mat('f_pool', tint=(0.55, 0.72, 0.76), dist=2.5, waves=0.18, scale=1.6, flow=1.0),
        'f_basin': K.mat('f_basin', 'grey_cartago_01', 0.5, tint=(0.7, 0.7, 0.68), desat=0.7, rough_mul=0.6),
        'm_wood': K.mat('m_wood', 'wood_floor', 0.6, tint=(0.7, 0.52, 0.36), desat=0.7),
        'm_plaster': K.mat('m_plaster', 'red_brick_plaster_patch_02', 0.45, tint=(0.78, 0.72, 0.62), desat=0.3),
        'm_paper': K.plain_mat('m_paper', (0.78, 0.76, 0.68), rough=0.8),
        'm_board': K.plain_mat('m_board', (0.045, 0.07, 0.055), rough=0.85),
        'm_chalk': K.emissive_mat('m_chalk', (0.85, 0.85, 0.8), 0.6),
        'm_lamp': K.emissive_mat('m_lamp', (1.0, 0.74, 0.42), 9.0),
        'm_shard': K.emissive_mat('m_shard', (1.0, 0.62, 0.28), 10.0),
        'molten': K.emissive_mat('molten', (1.0, 0.36, 0.07), 28.0),
        'molten_dim': K.emissive_mat('molten_dim', (1.0, 0.3, 0.05), 6.0),
        'slag': K.plain_mat('slag', (0.045, 0.04, 0.036), rough=0.92),
        'furnace_mouth': K.emissive_mat('furnace_mouth', (1.0, 0.45, 0.12), 18.0),
    })
    return M


# --- p1: the terrace (two skies) ---------------------------------------------------------------------------------------------

def s_terrace(M):
    S = K.Section('p1')
    B_a, B_b = CK.Batch('p1a'), CK.Batch('p1b')
    x0, x1 = -15.0, 15.0
    # the terrace deck in two pieces either side of the chasm (y -18..-24), each reality its own surface
    for tl, mat in (('a', M['a_marble']), ('b', M['b_ruin'])):
        for (ya, yb) in ((0.0, -18.0), (-24.0, -46.0)):
            S.add(K.box(f'p1_deck{tl}{ya}', (x1 - x0, ya - yb, 1.0), (0, (ya + yb) / 2, -0.5), mat, bevel=0.02), timeline=tl)
    for (ya, yb) in ((0.0, -18.0), (-24.0, -46.0)):
        K.collide_box(S, f'p1_deck{ya}', (x1 - x0, ya - yb, 1.0), (0, (ya + yb) / 2, -0.5))
    # the chasm walls (both), the glass bridge (a only)
    for y in (-18.0, -24.0):
        S.add(K.box(f'p1_lip{y}', (x1 - x0, 0.4, 6.0), (0, y + (-0.2 if y > -20 else 0.2), -3.5), M['a_stone'], bevel=0.03))
    S.add(K.box('p1_bridge', (4.0, 6.4, 0.12), (0, -21.0, -0.06), M['glass'], bevel=0.0), timeline='a')
    for sx in (-2.0, 2.0):
        S.add(K.box(f'p1_brail{sx}', (0.06, 6.4, 1.0), (sx, -21.0, 0.5), M['glass'], bevel=0.0), timeline='a')
        S.add(K.box(f'p1_brailtop{sx}', (0.08, 6.4, 0.06), (sx, -21.0, 1.02), M['a_panel'], bevel=0.01), timeline='a')
    K.collide_box(S, 'p1_bridge', (4.0, 6.4, 0.3), (0, -21.0, -0.15), timeline='a')
    for sx in (-2.05, 2.05):
        K.collide_box(S, f'p1_brail{sx}', (0.2, 6.4, 1.2), (sx, -21.0, 0.6), timeline='a')
    K.marker(S, 'trigger', (0, -21.0, -7.0), size=[34.0, 6.0, 3.0], id='p1_fall')
    # balustrades: glass in 2101, broken stubs in the ruin; invisible edge walls in both
    for sx in (x0 + 0.1, x1 - 0.1):
        for (ya, yb) in ((0.0, -18.0), (-24.0, -46.0)):
            S.add(K.box(f'p1_rail{sx}{ya}', (0.06, ya - yb, 1.05), (sx, (ya + yb) / 2, 0.52), M['glass'], bevel=0.0), timeline='a')
            for k in range(int((ya - yb) / 3)):
                if random.Random(int(sx * 10 + ya + k)).random() < 0.6:
                    h = random.Random(k + int(ya)).uniform(0.2, 0.9)
                    S.add(K.box(f'p1_stub{sx}{ya}{k}', (0.2, 0.25, h), (sx, ya - 1.5 - k * 3, h / 2), M['a_stone'], bevel=0.03), timeline='b')
            K.collide_box(S, f'p1_edge{sx}{ya}', (0.4, ya - yb, 3.0), (sx, (ya + yb) / 2, 1.5))
    K.collide_box(S, 'p1_edge_s', (x1 - x0, 0.4, 3.0), (0, 0.2, 1.5))
    # the reflecting pool (a: still water; b: a dry basin full of debris)
    S.add(K.box('p1_pool_rim', (7.4, 11.4, 0.5), (8.5, -9.0, 0.0), M['f_basin'], bevel=0.04))
    S.add(K.box('p1_pool_floor', (7.0, 11.0, 0.1), (8.5, -9.0, -0.35), M['f_basin'], bevel=0.0))
    S.add(K.box('p1_pool_water', (7.0, 11.0, 0.02), (8.5, -9.0, 0.18), M['f_pool'], bevel=0.0), timeline='a')
    S.add(K.debris('p1_pool_debris', (8.5, -9.0, -0.3), M, n=12, seed=401, size=0.45), timeline='b')
    K.collide_box(S, 'p1_pool', (7.4, 11.4, 0.6), (8.5, -9.0, 0.0))
    # planters (both: tidy in a, overgrown and cracked in b)
    for i, (x, y) in enumerate(((-9, -5), (-9, -12), (-9, -30), (9, -32), (-5, -38))):
        S.add(K.box(f'p1_planter{i}', (2.2, 2.2, 0.9), (x, y, 0.45), M['a_stone'], bevel=0.05))
        S.add(K.box(f'p1_soil{i}', (2.0, 2.0, 0.1), (x, y, 0.92), M['b_moss'], bevel=0.0), timeline='a')
        S.add(K.debris(f'p1_over{i}', (x, y, 0.9), M, n=6, seed=410 + i, size=0.5), timeline='b')
        K.collide_box(S, f'p1_planter{i}', (2.2, 2.2, 1.0), (x, y, 0.5))
        # 2101: a clipped shrub or a young tree in each; the ruin: what the wind seeded
        if i % 2 == 0:
            K.plant(S, 'tree_small_02_0', (x, y, 0.97), i * 1.3, 0.55, timeline='a')
        else:
            K.plant(S, ('shrub_04_0', 'shrub_02_1')[i % 2], (x, y, 0.97), i * 0.9, 1.1, timeline='a')
        K.plant(S, f'pine_sapling_medium_{i % 3}', (x + 0.3, y - 0.2, 0.9), i * 2.1, 0.45, timeline='b')
        for k in range(4):
            K.plant(S, ('fern_02_1', 'grass_medium_01_0', 'nettle_plant_0', 'fern_02_2')[k], (x + (k % 2 - 0.5) * 1.1, y + (k // 2 - 0.5) * 1.1, 0.9),
                    k * 1.7 + i, 0.9, timeline='b')
    # the security gate across the far end: whole in a (glass doors closed), smashed open in b
    for side, (xa, xb) in enumerate(((x0, -2.0), (2.0, x1))):
        S.add(K.box(f'p1_gwall{side}', (xb - xa, 0.6, 4.0), ((xa + xb) / 2, -40.0, 2.0), M['a_white'], bevel=0.03), timeline='a')
        K.collide_box(S, f'p1_gwall{side}', (xb - xa, 0.6, 4.0), ((xa + xb) / 2, -40.0, 2.0))
        S.add(K.box(f'p1_gwallb{side}', (xb - xa, 0.6, 1.6), ((xa + xb) / 2, -40.0, 0.8), M['b_ruin'], bevel=0.08), timeline='b')
    S.add(K.box('p1_gdoors', (4.0, 0.1, 3.0), (0, -40.0, 1.5), M['glass'], bevel=0.0), timeline='a')
    S.add(K.box('p1_gframe', (4.4, 0.7, 0.4), (0, -40.0, 3.2), M['a_panel'], bevel=0.02), timeline='a')
    K.collide_box(S, 'p1_gdoors', (4.0, 0.6, 3.2), (0, -40.0, 1.6), timeline='a')
    S.add(K.debris('p1_gdebris', (0, -41.0, 0.0), M, n=14, seed=430, size=0.4), timeline='b')
    S.add(K.sign('p1_gsign', 'HELIX  SECURE TERRACE', (0, -39.65, 3.6), (math.radians(90), 0, math.pi), 0.32, M['a_brand']), timeline='a')
    # the city below and around: the 2101 skyline (white towers, glass) in a; the same skyline torn up in b
    rng = random.Random(7)
    for k in range(18):
        a = k / 18 * math.tau + rng.uniform(-0.1, 0.1)
        d = rng.uniform(55, 120)
        cx, cy = math.cos(a) * d, -22 + math.sin(a) * d
        w, dd = rng.uniform(14, 24), rng.uniform(14, 24)
        top = rng.uniform(-10, 70)
        B_a.box(M['f_modern'], (w, dd, top + 80), (cx, cy, (top - 80) / 2), bevel=0.3)
        if rng.random() < 0.4:
            B_a.box(M['a_white'], (w * 0.6, dd * 0.6, 12), (cx, cy, top + 6), bevel=0.3)
        tb = top * rng.uniform(0.3, 0.8)
        B_b.box(M[rng.choice(('f_ruin', 'f_concrete', 'f_ruin'))], (w, dd, tb + 80), (cx, cy, (tb - 80) / 2), bevel=0.3)
    for o in B_a.objects():
        S.add(o, timeline='a')
    for o in B_b.objects():
        S.add(o, timeline='b')
    # fires burning in the ruin's skyline and on the terrace (the only warm light in b)
    for i, (x, y, z) in enumerate(((-11.0, -34.0, 0.3), (12.0, -27.0, 0.3))):
        S.add(K.box(f'p1_fire{i}', (0.8, 0.8, 0.2), (x, y, z), M['molten_dim'], bevel=0.05), timeline='b')
        K.area_light(f'p1_fireL{i}', (x, y, z + 0.8), (0.6, 0.6), 160.0, (1.0, 0.5, 0.18), shape='DISK', rot=(math.pi, 0, 0), timeline='b')
    # the sea the future city stands in, thirty metres down; stacks of rock out in the water (foam wraps them)
    K.marker(S, 'sea', (0, -20.0, -30.0), preset='Coastal breeze', preset_b='Storm swell', far=1400)
    for k, (sx, sy, sc_, yaw) in enumerate(((-62, -40, 7.5, 0.4), (58, -76, 9.0, 2.1), (-34, -118, 6.0, 4.0), (84, 6, 8.0, 1.2), (-90, -80, 10.0, 5.2))):
        K.prop(S, 'rock_face_01', (sx, sy, -40.0), yaw, sc_, budget=18000, collide=False)
        K.marker(S, 'searock', (sx, sy, -30.0), r=sc_ * 2.6)
    K.marker(S, 'sky', (0, -20.0, 3.0), id='future', hdri='textures/sky/kloofendal.hdr', intensity=CLEAR, fog=[0.62, 0.7, 0.8, 0.0018],
             exposure=1.0, rain=0.0, grade='arcology',
             hdri_b='textures/sky/approaching_storm.hdr', intensity_b=L1.SKY * 0.9, fog_b=[0.062, 0.07, 0.088, 0.0065], exposure_b=1.9,
             rain_b=1.0, grade_b='dusk_storm')
    # the ruin is going green: ferns and grass in the cracks, nettles along the walls, saplings (timeline b only; rays find the deck)
    for o in S.static_a:
        o.hide_render = True
    bpy.context.view_layer.update()
    over = [('fern_02_0', 2), ('fern_02_1', 2), ('fern_02_2', 1), ('grass_medium_01_0', 3), ('grass_medium_01_2', 3), ('grass_medium_02_1', 3),
            ('grass_medium_02_3', 2), ('nettle_plant_0', 2), ('weed_plant_02_0', 2), ('moss_01_0', 2), ('moss_01_1', 2)]
    for (ya, yb) in ((-0.5, -17.5), (-24.5, -45.5)):
        K.scatter(S, over, x0 + 0.6, x1 - 0.6, yb, ya, spacing=0.8, seed=int(-ya) + 40, density=0.48, timeline='b',
                  accept=lambda x, y, z: abs(z) < 0.25 and not (abs(x) < 1.6 and y < -18.5 and y > -40.5))
    for o in S.static_a:
        o.hide_render = False
    K.marker(S, 'spawn', (0, -2.5, 0.05), yaw=0.0, id='start')
    K.marker(S, 'checkpoint', (0, -2.5, 0.05), yaw=0.0, id='cp_p1')
    K.marker(S, 'checkpoint', (0, -25.5, 0.05), yaw=0.0, id='cp_p1b')
    K.marker(S, 'trigger', (0, -26.0, 1.0), size=[30.0, 1.0, 2.0], id='p1_crossed')
    K.marker(S, 'enemies', (0, -32.0, 0), id='p1_wave', group=[['trooper', -4.0, -35.0, 3.14], ['trooper', 4.0, -36.0, 3.14],
                                                             ['operative', 0.0, -37.5, 3.14]])
    K.marker(S, 'trigger', (0, -44.0, 1.0), size=[6.0, 1.0, 2.0], id='p1_exit')
    K.marker(S, 'camera', (11.0, 1.5, 4.0), id='p1_reveal', target=[0.0, -30.0, 2.0])
    return S


# --- p2: the HELIX lab of 2079 -------------------------------------------------------------------------------------------------

def s_memory(M):
    S = K.Section('p2')
    B = CK.Batch('p2b')
    ox = 200.0
    x0, x1, y0, y1, H = ox - 9.0, ox + 9.0, 0.0, -22.0, 3.4
    K.room(S, 'p2', x0, x1, y0, y1, H, M, openings={'n': [(ox, 1.6)]}, beams=True, floor_mat='m_wood')
    # plaster over the facility panels: an older building, a warmer one
    for (xa, ya, xb, yb, nrm) in ((x0, y0, x0, y1, (1, 0)), (x1, y0, x1, y1, (-1, 0)), (x0, y0, x1, y0, (0, -1))):
        L = math.hypot(xb - xa, yb - ya)
        cx, cy = (xa + xb) / 2 + nrm[0] * 0.18, (ya + yb) / 2 + nrm[1] * 0.18
        size = (0.04, L, H - 0.1) if nrm[0] else (L, 0.04, H - 0.1)
        S.add(K.box(f'p2_plaster{xa}{ya}', size, (cx, cy, H / 2), M['m_plaster'], bevel=0.0))
    # the window wall (west): evening light through tall windows
    for k in range(4):
        y = -3.5 - k * 5.0
        S.add(K.box(f'p2_win{k}', (0.05, 2.2, 1.9), (x0 + 0.22, y, 1.75), M['win_warm'], bevel=0.0))
        K.area_light(f'p2_sun{k}', (x0 + 0.4, y, 1.75), (2.0, 1.8), 220.0, (1.0, 0.72, 0.45), rot=(0, math.radians(90), 0))
    # the board: the prediction, in chalk
    S.add(K.box('p2_board', (5.0, 0.06, 1.8), (ox, y0 - 0.25, 1.7), M['m_board'], bevel=0.01))
    for i, line in enumerate(('PREDICTION  14.03.2089  04:15', 'CHRONAL CASCADE  -  CITY-WIDE', 'P(INTERVENE) = 0.91  /  VOLUNTEER')):
        S.add(K.sign(f'p2_chalk{i}', line, (ox, y0 - 0.29, 2.25 - i * 0.32), (math.radians(90), 0, 0), 0.16, M['m_chalk']))
    # desks, papers, lamps, a briefing table, filing cabinets, old monitors
    rng = random.Random(21)
    for i, (x, y) in enumerate(((ox - 5, -6), (ox - 5, -11), (ox + 5, -6), (ox + 5, -11))):
        B.box(M['m_wood'], (1.8, 0.9, 0.06), (x, y, 0.76), bevel=0.01)
        B.box(M['m_wood'], (1.7, 0.8, 0.7), (x, y, 0.36), bevel=0.01)
        for _ in range(4):
            B.box(M['m_paper'], (0.21, 0.3, 0.004), (x + rng.uniform(-0.6, 0.6), y + rng.uniform(-0.3, 0.3), 0.792), rot_z=rng.uniform(-0.4, 0.4), bevel=0.0)
        B.box(M['trim'], (0.45, 0.4, 0.38), (x + 0.5, y + 0.15, 0.98), bevel=0.03)
        B.box(M['screen2'], (0.36, 0.01, 0.26), (x + 0.5, y - 0.06, 1.0), bevel=0.0)
        B.box(M['m_lamp'], (0.16, 0.16, 0.06), (x - 0.6, y + 0.2, 1.12), bevel=0.02)
        K.area_light(f'p2_desk{i}', (x - 0.6, y + 0.2, 1.05), (0.15, 0.15), 18.0, (1.0, 0.72, 0.42), shape='DISK', rot=(0, 0, 0))
        K.collide_box(S, f'p2_desk{i}', (1.8, 0.9, 0.8), (x, y, 0.4))
    B.box(M['m_wood'], (4.0, 1.6, 0.08), (ox, -16.0, 0.78), bevel=0.02)
    B.box(M['trim'], (0.3, 0.3, 0.74), (ox - 1.6, -16.0, 0.37), bevel=0.02)
    B.box(M['trim'], (0.3, 0.3, 0.74), (ox + 1.6, -16.0, 0.37), bevel=0.02)
    K.collide_box(S, 'p2_table', (4.0, 1.6, 0.85), (ox, -16.0, 0.42))
    for k in range(3):
        B.box(M['trim'], (0.5, 0.6, 1.3), (x1 - 0.5, -15 - k * 0.55, 0.65), bevel=0.02)
    for k in range(3):
        S.add(K.box(f'p2_pend{k}', (0.4, 0.4, 0.12), (ox, -5 - k * 5.5, H - 0.5), M['m_lamp'], bevel=0.04))
        K.area_light(f'p2_pendL{k}', (ox, -5 - k * 5.5, H - 0.6), (0.38, 0.38), 120.0, (1.0, 0.76, 0.48))
    for o in B.objects():
        S.add(o)
    # the memory shards: amber splinters of time hanging where something happened
    for i, (x, y, z) in enumerate(((ox, -3.0, 1.5), (ox - 5.0, -8.5, 1.4), (ox + 1.0, -16.0, 1.5))):
        for j in range(5):
            r = random.Random(500 + i * 10 + j)
            S.add(K.box(f'p2_shard{i}{j}', (0.04, 0.04, r.uniform(0.18, 0.4)),
                        (x + r.uniform(-0.15, 0.15), y + r.uniform(-0.15, 0.15), z + r.uniform(-0.2, 0.2)), M['m_shard'], bevel=0.005,
                        rot=(r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), r.uniform(0, 3))))
        K.area_light(f'p2_shardL{i}', (x, y, z), (0.3, 0.3), 25.0, (1.0, 0.62, 0.28), shape='DISK')
        K.marker(S, 'interact', (x, y + 0.9, 0.2), id=f'p2_mem{i + 1}', prompt='Touch the memory')
    K.marker(S, 'checkpoint', (ox, -1.5, 0.05), yaw=0.0, id='cp_p2')
    K.marker(S, 'camera', (ox + 6.5, -19.0, 2.4), id='p2_reveal', target=[ox - 2.0, -4.0, 1.4])
    K.marker(S, 'trigger', (ox, -21.0, 1.0), size=[2.0, 1.0, 2.0], id='p2_exit')
    return S


# --- p3: the foundry ------------------------------------------------------------------------------------------------------------

def s_foundry(M):
    S = K.Section('p3')
    ox = 400.0
    x0, x1, y0, y1, H = ox - 15.0, ox + 15.0, 0.0, -40.0, 16.0
    K.room(S, 'p3', x0, x1, y0, y1, H, M, openings={'n': [(ox, 3.0)]}, beams=True, floor_mat='c_deck')
    # K.room's floor covers the channel: replace its collider with two slabs either side, the channel floor in b only
    for o in [o for o in S.collide if o.name == 'col_p3_floor']:
        S.collide.remove(o)
        bpy.data.objects.remove(o)
    K.collide_box(S, 'p3_floor_s', (30.0, 18.0, 0.4), (ox, -9.0, -0.2))
    K.collide_box(S, 'p3_floor_n', (30.0, 18.0, 0.4), (ox, -31.0, -0.2))
    # the casting channel across the hall at y -18..-22: molten (a) / cold slag (b)
    S.add(K.box('p3_channel_bed', (30.0, 4.0, 0.5), (ox, -20.0, -0.55), M['slag'], bevel=0.0))
    S.add(K.box('p3_molten', (30.0, 3.8, 0.04), (ox, -20.0, -0.12), M['molten'], bevel=0.0), timeline='a')
    S.add(K.box('p3_slagtop', (30.0, 3.8, 0.1), (ox, -20.0, -0.08), M['slag'], bevel=0.0), timeline='b')
    K.collide_box(S, 'p3_channel_cold', (30.0, 4.0, 0.4), (ox, -20.0, -0.3), timeline='b')
    for y in (-17.9, -22.1):
        S.add(K.box(f'p3_kerb{y}', (30.0, 0.3, 0.25), (ox, y, 0.0), M['trim'], bevel=0.02))
    K.marker(S, 'trigger', (ox, -20.0, 0.3), size=[30.0, 3.6, 1.2], id='p3_lava')
    for k in range(4):
        K.area_light(f'p3_moltenL{k}', (x0 + 4 + k * 7.5, -20.0, 0.6), (6.0, 3.0), 700.0, (1.0, 0.42, 0.12), rot=(math.pi, 0, 0), timeline='a')
    # furnaces along the west wall: their mouths roar in a, black in b
    for k in range(3):
        y = -6.0 - k * 12.0
        S.add(K.cylinder(f'p3_furnace{k}', 2.6, 9.0, (x0 + 3.2, y, 4.5), M['c_metal'], verts=40, bevel=0.05))
        S.add(K.box(f'p3_mouth{k}', (0.1, 1.6, 1.4), (x0 + 5.85, y, 1.6), M['furnace_mouth'], bevel=0.02), timeline='a')
        S.add(K.box(f'p3_mouthb{k}', (0.1, 1.6, 1.4), (x0 + 5.85, y, 1.6), M['dark'], bevel=0.02), timeline='b')
        K.area_light(f'p3_mouthL{k}', (x0 + 6.3, y, 1.6), (1.4, 1.2), 300.0, (1.0, 0.48, 0.15), rot=(0, math.radians(-90), 0), timeline='a')
        K.collide_box(S, f'p3_furnace{k}', (5.4, 5.4, 9.0), (x0 + 3.2, y, 4.5))
    # catwalks and a crane girder overhead, chains, ladles (shared hardware)
    B = CK.Batch('p3b')
    for y in (-8.0, -32.0):
        B.box(M['c_grate'], (24.0, 1.6, 0.08), (ox + 2.0, y, 7.0), bevel=0.01)
    B.box(M['c_metal'], (1.0, 40.0, 1.2), (ox + 8.0, -20.0, 12.5), bevel=0.04)
    B.box(M['c_metal'], (1.0, 40.0, 1.2), (ox - 6.0, -20.0, 12.5), bevel=0.04)
    B.box(M['c_metal'], (15.0, 1.4, 1.0), (ox + 1.0, -26.0, 11.6), bevel=0.04)
    for k in range(3):
        B.box(M['trim'], (0.06, 0.06, 4.0), (ox + 1.0 - 1.0 + k, -26.0, 9.0), bevel=0.0)
    B.box(M['c_metal'], (2.6, 2.6, 2.2), (ox + 1.0, -26.0, 6.0), bevel=0.2)
    for o in B.objects():
        S.add(o)
    # the exit door north, past the channel: powered (it opens from its console) in a; jammed by a fallen girder in b
    K.sliding_door(S, 'p3_door', (ox, y1), True, 3.0, M, door_h=3.0, state='locked')
    S.add(K.box('p3_girder', (6.0, 0.6, 0.6), (ox, y1 + 0.8, 1.2), M['c_metal'], bevel=0.05, rot=(0, 0.3, 0.1)), timeline='b')
    K.collide_box(S, 'p3_girder', (6.0, 1.2, 2.6), (ox, y1 + 0.8, 1.3), timeline='b')
    S.add(K.console('p3_console', (ox + 5.0, y1 + 1.6, 0), math.pi, M, M['screen1']))
    K.collide_box(S, 'p3_console', (1.4, 0.8, 1.0), (ox + 5.0, y1 + 1.6, 0.5))
    K.marker(S, 'interact', (ox + 5.0, y1 + 2.6, 0.2), id='p3_console', prompt='Restore power to the door')
    # light: sodium high-bays (a), grey daylight from roof lights (b)
    for k in range(3):
        y = -6.0 - k * 14.0
        K.area_light(f'p3_bayA{k}', (ox + 4.0, y, H - 0.5), (1.2, 1.2), 380.0, (1.0, 0.78, 0.5), timeline='a')
        K.area_light(f'p3_roofB{k}', (ox + 4.0, y, H - 0.4), (3.0, 6.0), 260.0, (0.55, 0.62, 0.72), timeline='b')
    K.marker(S, 'checkpoint', (ox, -2.5, 0.05), yaw=0.0, id='cp_p3')
    K.marker(S, 'checkpoint', (ox, -24.5, 0.05), yaw=0.0, id='cp_p3b')
    K.marker(S, 'trigger', (ox, -24.0, 1.0), size=[30.0, 1.0, 2.0], id='p3_crossed')
    K.marker(S, 'enemies', (ox, -10.0, 0), id='p3_wave', group=[['operative', ox - 4.0, -13.0, 3.14], ['operative', ox + 5.0, -14.0, 3.14],
                                                               ['heavy', ox, -15.5, 3.14]])
    K.marker(S, 'trigger', (ox, -41.0, 1.0), size=[3.0, 1.0, 2.0], id='p3_exit')
    K.marker(S, 'camera', (ox + 12.0, -2.0, 6.0), id='p3_reveal', target=[ox - 4.0, -22.0, 1.0])
    return S


# --- p4: the crucible (Nyx) ------------------------------------------------------------------------------------------------------

def s_crucible(M):
    S = K.Section('p4')
    cx, cy, R = 400.0, -62.0, 12.0
    # the walk out from the foundry door to the platform
    S.add(K.box('p4_walk', (3.6, 9.0, 0.4), (cx, -44.5, -0.2), M['c_grate'], bevel=0.02))
    K.collide_box(S, 'p4_walk', (3.6, 9.0, 0.4), (cx, -44.5, -0.2))
    for sx in (-1.8, 1.8):
        S.add(K.railing(f'p4_wrail{sx}', (cx + sx, -40.0, 0.0), (cx + sx, -49.0, 0.0), M))
        K.collide_box(S, f'p4_wrail{sx}', (0.2, 9.0, 1.2), (cx + sx, -44.5, 0.6))
    # the platform: a shared centre disc, an outer ring of twelve segments (all present in a; every other one fallen in b)
    S.add(K.cylinder('p4_disc', 5.0, 0.6, (cx, cy, -0.3), M['trim'], verts=64, bevel=0.03))
    K.collide_box(S, 'p4_disc', (7.0, 7.0, 0.6), (cx, cy, -0.3))
    n = 12
    for k in range(n):
        a0, a1 = k / n * math.tau, (k + 1) / n * math.tau
        am = (a0 + a1) / 2
        rm = (5.0 + R) / 2
        L = 2 * rm * math.sin((a1 - a0) / 2) + 0.05
        x, y = cx + math.cos(am) * rm, cy + math.sin(am) * rm
        tls = ('a', 'b') if k % 2 == 0 else ('a',)
        for tl in tls:
            S.add(K.box(f'p4_seg{k}{tl}', (R - 5.0, L, 0.5), (x, y, -0.25), M['c_grate'] if tl == 'a' else M['c_ruin'], bevel=0.02,
                        rot=(0, 0, am)), timeline=tl)
            K.collide_box(S, f'p4_seg{k}{tl}', (R - 5.0, L * 0.9, 0.5), (x, y, -0.25), timeline=tl)
        if k % 2 == 1:
            S.add(K.debris(f'p4_fall{k}', (x, y, -6.0), M, n=5, seed=600 + k, size=0.6), timeline='b')
    # rail posts around the rim, the crucible below (molten), its glow from beneath
    for k in range(24):
        a = k / 24 * math.tau
        S.add(K.box(f'p4_post{k}', (0.12, 0.12, 1.1), (cx + math.cos(a) * (R - 0.2), cy + math.sin(a) * (R - 0.2), 0.55), M['trim'], bevel=0.01),
              timeline='a')
    S.add(K.cylinder('p4_crucible', R + 6.0, 0.4, (cx, cy, -9.0), M['molten'], verts=64, bevel=0.0))
    # the crucible's wall: plates around the pit, facing in
    for k in range(32):
        a = k / 32 * math.tau
        S.add(K.box(f'p4_wall{k}', (2 * (R + 6.5) * math.sin(math.pi / 32) + 0.05, 0.5, 13.0),
                    (cx + math.cos(a) * (R + 6.5), cy + math.sin(a) * (R + 6.5), -2.5), M['c_metal'], bevel=0.03, rot=(0, 0, a + math.pi / 2)))
    K.area_light('p4_glow', (cx, cy, -7.5), (14.0, 14.0), 2600.0, (1.0, 0.42, 0.12), rot=(math.pi, 0, 0))
    K.area_light('p4_top', (cx, cy, 14.0), (6.0, 6.0), 500.0, (0.75, 0.82, 1.0))
    K.marker(S, 'trigger', (cx, cy, -5.0), size=[40.0, 40.0, 2.0], id='p4_fall')
    K.marker(S, 'checkpoint', (cx, -48.0, 0.05), yaw=0.0, id='cp_p4')
    K.marker(S, 'trigger', (cx, -50.5, 1.0), size=[3.6, 1.0, 2.0], id='p4_enter')
    K.marker(S, 'boss', (cx, cy - 4.0, 0.05), yaw=math.pi, id='nyx')
    K.marker(S, 'camera', (cx + 10.0, -49.0, 3.0), id='p4_reveal', target=[cx, cy - 3.0, 1.6])
    # the crucible has its own sky: none (it is under the foundry roof); a dark, hot, dusty air
    return S


SECTIONS = {'p1': s_terrace, 'p2': s_memory, 'p3': s_foundry, 'p4': s_crucible}


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


def probes(built, keys):
    for tl in ('a', 'b'):
        for S in built.values():
            K.show_timeline(S, tl)
        for key in keys:
            S = built[key]
            if key in SKIES:
                K.sky_world(*SKIES[key][tl])
            else:
                bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
            if tl == 'b' and not (S.static_a or S.static_b):
                continue
            pts = K.probe_points(S.static + getattr(S, f'static_{tl}'), spacing=2.5 if key != 'p1' else 3.0, heights=(1.1,),
                                 exterior=key == 'p1')
            K.bake_probes(pts, os.path.join(K.PUB, f'environments/ch4/{key}_probes{"_b" if tl == "b" else ""}.json'))
    for S in built.values():
        K.show_timeline(S, None)


def export(built, keys, samples):
    os.makedirs(os.path.join(K.PUB, 'textures', 'sky'), exist_ok=True)
    shutil.copy(CLEAR_HDRI, os.path.join(K.PUB, 'textures', 'sky', 'kloofendal.hdr'))
    statics = {}
    for key in keys:
        if key not in SKIES:
            bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
        statics[key] = K.export_timeline_section(built[key], key, OUT, 'ch4', samples, skies=SKIES.get(key))
    K.strip_textures()
    for key in keys:
        S = built[key]
        K.export(statics[key] + S.collide + S.markers + S.lights + getattr(S, 'dynamic', []), os.path.join(OUT, f'{key}.glb'))
        K.write_foliage(S, os.path.join(OUT, f'{key}_foliage.json'))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    samples = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 96
    keys = argv[argv.index('--only') + 1].split(',') if '--only' in argv else list(SECTIONS)
    CK.LIT.update({k: 0.0 for k in CK.LIT})  # the future is daytime; the ruin has no one left to switch lights on
    built, M = build()
    if '--render' in argv:
        key, out = argv[argv.index('--render') + 1], argv[argv.index('--render') + 2]
        tl = argv[argv.index('--timeline') + 1] if '--timeline' in argv else 'a'
        for S in built.values():
            K.show_timeline(S, tl)
        if key in SKIES:
            K.sky_world(*SKIES[key][tl])
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        bpy.context.scene.collection.objects.link(cam)
        mk = next((m for m in built[key].markers if m.get('marker') == 'camera'), None)
        cam.location = mk.location
        import mathutils
        tgt = mathutils.Vector(__import__('json').loads(mk['target']) if isinstance(mk.get('target'), str) else list(mk['target']))
        cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = 22
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
        K.bake_volumes(built, keys, 'ch4', CLEAR_HDRI, skies={'p1': SKIES['p1']})
    if '--foliage' in argv:
        for key in keys:
            K.write_foliage(built[key], os.path.join(OUT, f'{key}_foliage.json'))
    if '--export' in argv:
        export(built, keys, samples)
