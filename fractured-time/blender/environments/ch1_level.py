"""
Chapter 1 THE INCIDENT: the HELIX Underground Research Facility, seven connected sections (each baked + exported as its own GLB).
  blender -b --factory-startup --python-exit-code 1 -P blender/environments/ch1_level.py -- [--only s1,s2] [--render s3 out.png] [--export]
                                                                                       [--samples N]
Flow (north = -Y): s1 integration lab (wake) -> s2 service corridor -> s3 security checkpoint (first fight) -> s4 research lab
(temporal anomaly, cycling blast door: time-slow puzzle) -> s5 server hall (fight) -> s6 Chronal Engine chamber (Sentinel A-07)
-> s7 freight lift (to the surface). Gameplay placement is authored here as markers, so layout and gameplay never drift apart.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import envkit as K  # noqa: E402

OUT = os.path.join(K.PUB, 'environments', 'ch1')


def materials():
    M = {
        # dark polished concrete (low roughness: the light fixtures reflect in it), anti-skid band, cool grey-teal panels
        'floor': K.mat('floor', 'concrete_floor_worn_001', 0.5, tint=(0.34, 0.35, 0.35), desat=0.7, normal_strength=1.2, rough_mul=0.62),
        'floor_tile': K.mat('floor_tile', 'anti_skid_tiles', 0.8, tint=(0.2, 0.21, 0.22), desat=0.85, rough_add=0.02),
        'floor_band': K.mat('floor_band', 'anti_skid_tiles', 1.2, tint=(0.14, 0.145, 0.15), desat=0.9, rough_add=0.05),
        'wall': K.mat('wall', 'concrete_wall_003', 0.9, tint=(0.22, 0.23, 0.24), desat=0.9),
        'panel': K.mat('panel', 'painted_metal_shutter', 0.9, tint=(0.42, 0.45, 0.47), desat=0.85, normal_strength=0.8, rough_add=0.1),
        'wainscot': K.mat('wainscot', 'blue_metal_plate', 0.8, tint=(0.2, 0.25, 0.28), desat=0.6, normal_strength=1.1, rough_add=0.12),
        'trim': K.mat('trim', 'metal_plate_02', 1.0, tint=(0.2, 0.205, 0.215), desat=0.85, metal=0.6, rough_mul=0.85),
        'vent': K.mat('vent', 'metal_plate', 2.0, tint=(0.12, 0.125, 0.13), desat=0.9, metal=0.5),
        'pipe': K.mat('pipe', 'metal_plate_02', 2.0, tint=(0.36, 0.33, 0.28), desat=0.5, metal=0.7),
        'flange': K.mat('flange', 'metal_plate', 3.0, tint=(0.24, 0.24, 0.25), desat=0.9, metal=0.7),
        'cable': K.plain_mat('cable', (0.02, 0.02, 0.022), rough=0.55),
        'ceiling': K.mat('ceiling', 'metal_plate', 1.0, tint=(0.08, 0.085, 0.09), desat=0.9, metal=0.4),
        'ceil_panel': K.mat('ceil_panel', 'painted_metal_shutter', 0.7, tint=(0.24, 0.25, 0.26), desat=0.9, rough_add=0.15),
        'grate': K.mat('grate', 'anti_skid_tiles', 1.5, tint=(0.22, 0.23, 0.24), desat=0.9, metal=0.6),
        'door': K.mat('door', 'painted_metal_shutter', 0.6, tint=(0.4, 0.4, 0.38), desat=0.6, rough_add=0.1),
        'debris': K.mat('debris', 'concrete_debris', 1.2, tint=(0.42, 0.42, 0.4), desat=0.6),
        'hazard': K.plain_mat('hazard', (0.55, 0.38, 0.04), rough=0.6, stripes=3.0),
        'dark': K.plain_mat('dark', (0.03, 0.032, 0.035), rough=0.4, metal=0.3),
    }
    M['led_line'] = K.emissive_mat('led_line', (0.3, 0.8, 1.0), 3.5)
    # --- the surface: city materials (Poly Haven scans + generated facade sets, see facades.py) ---------------------------------
    M.update({
        'c_frame': K.mat('c_frame', 'concrete_tile_facade', 0.45, tint=(0.62, 0.62, 0.6), desat=0.5),
        'c_concrete': K.mat('c_concrete', 'brushed_concrete_03', 0.4, tint=(0.55, 0.55, 0.53), desat=0.6),
        'c_brick': K.mat('c_brick', 'brick_4', 0.55, tint=(0.75, 0.7, 0.68), desat=0.2),
        'c_stone': K.mat('c_stone', 'red_brick_plaster_patch_02', 0.45, tint=(0.7, 0.68, 0.66), desat=0.3),
        'c_ruin': K.mat('c_ruin', 'concrete_wall_003', 0.4, tint=(0.36, 0.36, 0.35), desat=0.7),
        'c_moss': K.mat('c_moss', 'brick_moss_001', 0.5, tint=(0.7, 0.75, 0.65), desat=0.1),
        'c_metal': K.mat('c_metal', 'green_metal_rust', 0.8, tint=(0.5, 0.5, 0.48), desat=0.5, metal=0.4),
        'c_asphalt': K.mat('c_asphalt', 'asphalt_02', 0.25, tint=(0.45, 0.45, 0.45), desat=0.8),
        'c_deck': K.mat('c_deck', 'concrete_floor_worn_001', 0.4, tint=(0.42, 0.42, 0.41), desat=0.7, rough_mul=0.8),
        'c_crate': K.mat('c_crate', 'corrugated_iron', 0.9, tint=(0.42, 0.24, 0.12), desat=0.2, metal=0.3),
        'c_grate': K.mat('c_grate', 'metal_grate_rusty', 1.0, tint=(0.5, 0.5, 0.5), desat=0.5, metal=0.5),
        'c_glass': K.plain_mat('c_glass', (0.03, 0.04, 0.05), rough=0.06, metal=0.0),
        'c_window': K.plain_mat('c_window', (0.025, 0.027, 0.03), rough=0.2),
        'c_void': K.plain_mat('c_void', (0.008, 0.008, 0.009), rough=1.0),
        'c_seam': K.emissive_mat('c_seam', (0.35, 0.85, 1.0), 40.0),
    })
    for era in ('modern', 'concrete', 'brick', 'ruin'):
        M[f'f_{era}'] = K.mat(f'f_{era}', f'facade_{era}', 1.0 / 12.0, desat=0.0)
    M['glow'] = K.emissive_mat('glow', (0.35, 0.85, 1.0), 12.0)
    M['led_g'] = K.emissive_mat('led_g', (0.2, 1.0, 0.45), 6.0)
    M['led_r'] = K.emissive_mat('led_r', (1.0, 0.15, 0.08), 8.0)
    M['warn'] = K.emissive_mat('warn', (1.0, 0.12, 0.04), 30.0)
    M['sign'] = K.emissive_mat('sign_w', (0.85, 0.9, 1.0), 4.0)
    M['glass'] = K.glass_mat()
    os.makedirs(os.path.join(K.PUB, 'textures', 'ui'), exist_ok=True)
    for i, hue in enumerate(((0.25, 0.8, 1.0), (1.0, 0.45, 0.2), (0.4, 1.0, 0.6))):
        K.screen_texture(os.path.join(K.PUB, 'textures', 'ui', f'helix_screen_{i}.png'), seed=10 + i, hue=hue)
        M[f'screen{i}'] = K.screen_mat(f'screen{i}', f'textures/ui/helix_screen_{i}.png')
    return M


def lamps(S, name, xs, ys, z, M, on=lambda i: True, weak=lambda i: False, rot=math.pi / 2, length=3.0):
    i = 0
    for x in xs:
        for y in ys:
            S.add(K.light_strip(f'{name}{i}', length, (x, y, z), rot, M, on=on(i), strength=6.0 if weak(i) else 18.0))
            i += 1


def s1_integration_lab(M):
    S = K.Section('s1')
    H = 5.5
    K.room(S, 's1', -6, 6, 0, -12, H, M, openings={'n': [(0, 2.4)]}, floor_mat='floor_tile')
    S.add(K.pod('pod', (0, -6, 0), M))
    K.collide_box(S, 'pod', (3.6, 3.6, 0.55), (0, -6, 0.27))
    for k, a in enumerate((-50, 50, 130, 230)):
        r = math.radians(a)
        S.add(K.console(f's1con{k}', (math.cos(r) * 3.6, -6 + math.sin(r) * 3.6, 0), r + math.pi / 2, M, M[f'screen{k % 3}']))
        K.collide_box(S, f's1con{k}', (1.4, 1.4, 1.0), (math.cos(r) * 3.6, -6 + math.sin(r) * 3.6, 0.5))
        S.add(K.cable_run(f's1cab{k}', (math.cos(r) * 3.0, -6 + math.sin(r) * 3.0, 0.03), (math.cos(r) * 1.7, -6 + math.sin(r) * 1.7, 0.4),
                          M, n=3, sag=0.12))
    # observation gallery: glass wall on the east side with a dark control room behind it
    S.add(K.box('s1_obs_glass', (0.06, 6.0, 2.2), (5.75, -6, 2.6), M['glass'], bevel=0.0))
    S.add(K.box('s1_obs_sill', (0.4, 6.2, 0.2), (5.7, -6, 1.45), M['trim'], bevel=0.02))
    lamps(S, 's1lamp', (-3.0, 3.0), (-3.0, -9.0), H - 0.45, M, on=lambda i: i != 2, rot=0.0)
    S.add(K.light_strip('s1lamp_pod', 2.4, (0, -6, H - 0.45), 0.0, M, color=(0.4, 0.85, 1.0), strength=10.0))
    for y in (-2.0, -10.0):
        S.add(K.box(f's1beacon{y}', (0.12, 0.18, 0.18), (-5.75, y, 3.6), M['warn'], bevel=0.02))
        K.area_light(f's1beacon_l{y}', (-5.6, y, 3.6), (0.15, 0.15), 30.0, (1.0, 0.1, 0.04), rot=(0, math.radians(90), 0), shape='DISK')
    S.add(K.debris('s1rubble', (-4.0, -10.5, 0), M, n=6, seed=11, size=0.28))
    S.add(K.box('s1_fallen', (2.0, 0.05, 1.2), (-3.6, -9.8, 0.5), M['ceiling'], bevel=0.01, rot=(math.radians(62), 0, math.radians(-15))))
    S.add(K.sign('s1_sign', 'CHRONAL INTEGRATION  LAB 01', (0, -11.52, 3.6), (math.radians(90), 0, math.pi), 0.32, M['sign']))
    K.sliding_door(S, 's1_door', (0, -12), True, 2.4, M, state='locked', role='door')
    K.marker(S, 'spawn', (0, -6.6, 0.75), yaw=0.0, id='wake')
    K.marker(S, 'interact', (-2.3, -3.3, 0), id='s1_console', prompt='Access console', opens='s1_door')
    K.marker(S, 'trigger', (0, -11.0, 1.0), size=[2.6, 1.0, 2.0], id='s1_exit')
    return S


def corridor(S, name, y0, y1, M):
    W, H = 4.0, 3.6
    K.room(S, name, -W / 2, W / 2, y0, y1, H, M, openings={'s': [(0, 2.4)], 'n': [(0, 2.4)]}, beams=True)
    L = y0 - y1
    S.add(K.pipe_run(f'{name}_pa', [(-1.55, y0 - 0.2, H - 0.55), (-1.55, y1 + 0.2, H - 0.55)], 0.11, M))
    S.add(K.box(f'{name}_tray', (0.45, L - 0.4, 0.05), (1.45, (y0 + y1) / 2, H - 0.62), M['trim'], bevel=0.006))
    for i in range(int(L / 4)):
        S.add(K.cable_run(f'{name}_cab{i}', (1.45, y0 - 0.3 - i * 4, H - 0.58), (1.45, y0 - 3.9 - i * 4, H - 0.58), M, n=4, sag=0.06))
    lamps(S, f'{name}_lamp', (0.0,), [y0 - 2 - 4 * i for i in range(int(L / 4))], H - 0.4, M, on=lambda i: i != 2, weak=lambda i: i == 1)


def s2_corridor(M):
    S = K.Section('s2')
    corridor(S, 's2', -12, -28, M)
    S.add(K.console('s2_term', (-1.5, -17.5, 0), -math.pi / 2, M, M['screen0']))
    K.collide_box(S, 's2_term', (0.7, 1.4, 1.0), (-1.55, -17.5, 0.5))
    S.add(K.debris('s2_rubble', (0.6, -22.5, 0), M, n=8, seed=4, size=0.3))
    S.add(K.cable_run('s2_drop', (1.3, -22.0, 3.0), (0.9, -22.8, 0.4), M, n=3, sag=0.3))
    K.collide_box(S, 's2_rubble', (1.2, 1.2, 0.35), (0.6, -22.5, 0.17))
    K.marker(S, 'interact', (-1.0, -17.5, 0), id='memory_1', prompt='Recover memory fragment', memory=1)
    K.marker(S, 'trigger', (0, -27.0, 1.0), size=[3.6, 1.0, 2.0], id='s2_exit')
    return S


def s3_checkpoint(M):
    S = K.Section('s3')
    H = 4.5
    K.room(S, 's3', -7, 7, -28, -42, H, M, openings={'s': [(0, 2.4)], 'n': [(0, 2.4)]})
    # security booth: glass box with a desk on the west side, turnstile barriers across the middle
    S.add(K.box('s3_booth_base', (3.2, 4.0, 1.0), (-4.8, -35, 0.5), M['panel'], bevel=0.03))
    S.add(K.box('s3_booth_glass', (0.05, 4.0, 1.8), (-3.2, -35, 1.9), M['glass'], bevel=0.0))
    S.add(K.console('s3_desk', (-5.0, -35, 0), math.pi / 2, M, M['screen1']))
    K.collide_box(S, 's3_booth', (3.3, 4.1, 2.8), (-4.8, -35, 1.4))
    for i, x in enumerate((-2.0, -0.7, 0.7, 2.0)):
        S.add(K.box(f's3_gate{i}', (0.18, 1.2, 1.0), (x, -34.0, 0.5), M['trim'], bevel=0.03))
        S.add(K.box(f's3_gatel{i}', (0.2, 0.05, 0.05), (x, -34.6, 1.02), M['led_g' if i % 2 else 'led_r'], bevel=0.0))
    K.collide_box(S, 's3_gates_l', (0.3, 1.2, 1.0), (-2.0, -34.0, 0.5))
    K.collide_box(S, 's3_gates_r', (0.3, 1.2, 1.0), (2.0, -34.0, 0.5))
    for i in range(6):  # lockers on the east wall
        S.add(K.box(f's3_locker{i}', (0.5, 0.55, 2.0), (6.55, -30.5 - i * 0.6, 1.0), M['panel'], bevel=0.015))
    K.collide_box(S, 's3_lockers', (0.6, 3.8, 2.0), (6.55, -32.0, 1.0))
    S.add(K.box('s3_barrier', (2.4, 0.5, 0.9), (3.5, -39.0, 0.45), M['hazard'], bevel=0.05))
    K.collide_box(S, 's3_barrier', (2.4, 0.5, 0.9), (3.5, -39.0, 0.45))
    S.add(K.sign('s3_sign', 'SECURITY CHECKPOINT  B-2', (0, -41.52, 3.4), (math.radians(90), 0, math.pi), 0.32, M['sign']))
    lamps(S, 's3lamp', (-3.5, 3.5), (-31.0, -38.0), H - 0.45, M, on=lambda i: i != 1, rot=0.0)
    K.area_light('s3_red', (6.8, -40.0, 3.2), (0.15, 0.15), 30.0, (1.0, 0.1, 0.04), rot=(0, math.radians(-90), 0), shape='DISK')
    S.add(K.box('s3_beacon', (0.12, 0.18, 0.18), (6.85, -40.0, 3.2), M['warn'], bevel=0.02))
    K.marker(S, 'enemies', (0, -38.0, 0), id='s3_fight', group=json_list([['trooper', 2.0, -39.5, 3.14], ['trooper', -2.5, -38.5, 3.14]]))
    K.marker(S, 'trigger', (0, -31.5, 1.0), size=[12.0, 1.0, 2.0], id='s3_enter')
    K.marker(S, 'checkpoint', (0, -30.0, 0), yaw=0.0, id='cp_s3')
    K.sliding_door(S, 's3_door', (0, -42), True, 2.4, M, state='locked')
    return S


def json_list(v):
    return v


def s4_research_lab(M):
    S = K.Section('s4')
    H = 7.0
    K.room(S, 's4', -9, 9, -42, -62, H, M, openings={'s': [(0, 2.4)], 'n': [(5.0, 2.4)]})
    for i in range(3):  # lab benches with equipment
        y = -46.0 - i * 4.0
        S.add(K.box(f's4_bench{i}', (3.0, 1.0, 0.9), (-4.5, y, 0.45), M['panel'], bevel=0.03))
        S.add(K.box(f's4_top{i}', (3.1, 1.1, 0.05), (-4.5, y, 0.92), M['trim'], bevel=0.01))
        S.add(K.console(f's4_eq{i}', (-4.5, y - 0.05, 0.92), 0.0, M, M[f'screen{i % 3}']))
        K.collide_box(S, f's4_bench{i}', (3.1, 1.1, 1.0), (-4.5, y, 0.5))
    # containment tank (cracked) in the north-west corner
    S.add(K.cylinder('s4_tank_base', 1.6, 0.6, (-6.5, -58.5, 0.3), M['trim'], verts=40, bevel=0.03))
    S.add(K.cylinder('s4_tank_glass', 1.4, 4.0, (-6.5, -58.5, 2.6), M['glass'], verts=40, bevel=0.0))
    S.add(K.cylinder('s4_tank_top', 1.6, 0.5, (-6.5, -58.5, 4.85), M['trim'], verts=40, bevel=0.03))
    S.add(K.cylinder('s4_tank_core', 0.3, 3.6, (-6.5, -58.5, 2.6), M['glow'], verts=16, bevel=0.0))
    K.collide_box(S, 's4_tank', (3.3, 3.3, 5.0), (-6.5, -58.5, 2.5))
    # the anomaly: a ceiling collapse frozen in mid-air (chunks hang where time stopped)
    rng = np.random.default_rng(7)
    chunks = []
    for i in range(14):
        x, y, z = rng.uniform(0.0, 6.0), rng.uniform(-54.0, -48.0), rng.uniform(1.0, 5.5)
        chunks.append(K.debris(f's4_frozen{i}', (x, y, 0), M, n=1, seed=40 + i, size=rng.uniform(0.25, 0.55)))
        chunks[-1].location.z += z
    S.add(K.join(chunks, 's4_frozen'))
    S.add(K.box('s4_hole_rim', (4.0, 4.0, 0.3), (3.0, -51.0, H + 0.15), M['debris'], bevel=0.05))
    K.marker(S, 'anomaly', (3.0, -51.0, 3.0), id='s4_anomaly', size=[6.5, 6.5, 6.0])
    # the cycling blast door (time-slow puzzle): slams every few seconds, too fast to pass at normal speed
    K.sliding_door(S, 's4_blast', (5.0, -62), True, 2.4, M, state='cycling', role='door')
    K.marker(S, 'hint', (5.0, -59.5, 0), id='s4_hint', text='The door cycles faster than you can move. Slow time [1].')
    lamps(S, 's4lamp', (-4.5, 4.5), (-45.0, -52.0, -59.0), H - 0.45, M, on=lambda i: i not in (3,), weak=lambda i: i == 4, rot=0.0)
    S.add(K.sign('s4_sign', 'TEMPORAL RESEARCH  LAB 04', (-4.0, -61.52, 4.2), (math.radians(90), 0, math.pi), 0.4, M['sign']))
    K.marker(S, 'enemies', (3.0, -57.0, 0), id='s4_fight', group=[['operative', 3.0, -57.0, 3.14]])
    K.marker(S, 'trigger', (0, -44.5, 1.0), size=[16.0, 1.0, 2.0], id='s4_enter')
    K.marker(S, 'checkpoint', (0, -44.0, 0), yaw=0.0, id='cp_s4')
    return S


def s5_server_hall(M):
    S = K.Section('s5')
    H = 6.0
    K.room(S, 's5', 1, 11, -62, -92, H, M, openings={'s': [(5.0, 2.4)], 'n': [(6.0, 2.4)]})
    for row, x in enumerate((3.2, 8.8)):
        for i in range(12):
            y = -66.0 - i * 2.0
            if (row, i) in ((0, 6), (1, 3)):
                continue  # gaps to flank through
            S.add(K.rack(f's5_r{row}_{i}', (x, y, 0), math.pi / 2 if row == 0 else -math.pi / 2, M, M['led_g' if (i + row) % 3 else 'led_r']))
        K.collide_box(S, f's5_row{row}a', (1.0, 11.0, 2.1), (x, -70.5, 1.05))
        K.collide_box(S, f's5_row{row}b', (1.0, 11.0, 2.1), (x, -83.5, 1.05))
    S.add(K.box('s5_tray_a', (0.5, 28, 0.06), (3.2, -77, 2.6), M['trim'], bevel=0.006))
    S.add(K.box('s5_tray_b', (0.5, 28, 0.06), (8.8, -77, 2.6), M['trim'], bevel=0.006))
    lamps(S, 's5lamp', (6.0,), [-65.0 - 5.0 * i for i in range(6)], H - 0.45, M, on=lambda i: i != 3, weak=lambda i: i == 4)
    S.add(K.sign('s5_sign', 'CORE SERVERS  C-1', (6.0, -91.52, 4.0), (math.radians(90), 0, math.pi), 0.35, M['sign']))
    K.marker(S, 'enemies', (6.0, -80.0, 0), id='s5_fight', group=[['trooper', 6.0, -78.0, 3.14], ['trooper', 5.0, -84.0, 3.14],
                                                                   ['heavy', 6.5, -88.0, 3.14], ['operative', 3.2, -78.5, 3.14]])
    K.marker(S, 'trigger', (6.0, -66.0, 1.0), size=[9.0, 1.0, 2.0], id='s5_enter')
    K.marker(S, 'checkpoint', (5.0, -64.0, 0), yaw=0.0, id='cp_s5')
    K.sliding_door(S, 's5_door', (6.0, -92), True, 2.4, M, state='locked')
    return S


def s6_engine_chamber(M):
    """A drum 32 m across: ribbed walls, the Chronal Engine ring standing at the far side, conduits, the arena floor."""
    S = K.Section('s6')
    cx, cy, R, H = 6.0, -108.0, 16.0, 20.0
    S.add(K.cylinder('s6_floor', R + 0.5, 0.4, (cx, cy, -0.2), M['floor_tile'], verts=96, bevel=0.0))
    S.add(K.cylinder('s6_ceiling', R + 0.5, 0.6, (cx, cy, H + 0.3), M['ceiling'], verts=96, bevel=0.0))
    n = 40
    for k in range(n):
        a = k / n * math.tau
        if min(abs(((a - math.radians(g)) + math.pi) % math.tau - math.pi) for g in (90, 270)) < math.radians(5):
            continue  # entrance from the server hall (south, +Y) and the way to the lift (north, -Y)
        p = (cx + math.cos(a) * R, cy + math.sin(a) * R, H / 2)
        S.add(K.box(f's6_w{k}', (R * math.tau / n + 0.05, 0.4, H), p, M['panel'], bevel=0.02, rot=(0, 0, a + math.pi / 2)))
        S.add(K.box(f's6_rib{k}', (0.35, 0.8, H), (cx + math.cos(a) * (R - 0.4), cy + math.sin(a) * (R - 0.4), H / 2), M['trim'],
                    bevel=0.03, rot=(0, 0, a + math.pi / 2)))
        K.collide_box(S, f's6_w{k}', (R * math.tau / n + 0.1, 0.6, H), p)
    S.add(K.engine_ring('s6_engine', (cx, cy - 9.0, 9.0), 7.0, M))
    S.add(K.box('s6_engine_plinth', (12.0, 4.0, 1.2), (cx, cy - 9.0, 0.6), M['trim'], bevel=0.05))
    K.collide_box(S, 's6_plinth', (12.0, 4.0, 1.2), (cx, cy - 9.0, 0.6))
    for k in range(6):  # conduits from the walls to the engine
        a = math.radians(200 + k * 28)
        S.add(K.pipe_run(f's6_cond{k}', [(cx + math.cos(a) * (R - 0.8), cy + math.sin(a) * (R - 0.8), 0.6),
                                        (cx + math.cos(a) * 9.0, cy + math.sin(a) * 9.0, 0.6), (cx, cy - 9.0, 1.2)], 0.25, M,
                         flange_every=3.0))
    for k in range(8):
        a = k / 8 * math.tau
        S.add(K.light_strip(f's6_lamp{k}', 4.0, (cx + math.cos(a) * 11.0, cy + math.sin(a) * 11.0, H - 1.0), a, M,
                            strength=18.0 if k % 3 else 8.0, power=900.0))
    K.area_light('s6_core', (cx, cy - 8.0, 9.0), (6.0, 6.0), 1500.0, (0.35, 0.8, 1.0), rot=(math.radians(-90), 0, 0))
    K.marker(S, 'boss', (cx, cy + 2.0, 0), yaw=0.0, id='sentinel')
    K.marker(S, 'trigger', (cx, cy + 12.0, 1.0), size=[6.0, 1.0, 2.0], id='s6_enter')
    K.marker(S, 'checkpoint', (cx, cy + 13.5, 0), yaw=0.0, id='cp_s6')
    K.marker(S, 'camera', (cx + 6.0, cy + 13.0, 4.0), id='engine_reveal', target=[cx, cy - 9.0, 8.0])
    return S


def s7_lift(M):
    S = K.Section('s7')
    cx, y0 = 6.0, -124.0
    K.room(S, 's7', cx - 4, cx + 4, y0, y0 - 8, 9.0, M, openings={'s': [(cx, 2.4)]}, beams=False)
    S.add(K.box('s7_platform', (6.0, 6.0, 0.3), (cx, y0 - 4.0, 0.15), M['grate'], bevel=0.02))
    for p0, p1 in (((cx - 3, y0 - 1), (cx - 3, y0 - 7)), ((cx + 3, y0 - 1), (cx + 3, y0 - 7)), ((cx - 3, y0 - 7), (cx + 3, y0 - 7))):
        S.add(K.railing(f's7_rail{p0}', (*p0, 0.3), (*p1, 0.3), M))
    S.add(K.console('s7_ctrl', (cx + 2.4, y0 - 1.6, 0.3), math.pi, M, M['screen2']))
    lamps(S, 's7lamp', (cx,), (y0 - 4.0,), 8.5, M, rot=0.0)
    K.marker(S, 'interact', (cx + 2.4, y0 - 2.4, 0.3), id='s7_lift', prompt='Activate freight lift')
    return S


SURFACE = (220.0, 0.0)  # the surface is built far from the underground sections; the lift ride fades through black


def s8_surface(M):
    """The surface: the freight lift's head house on a raised loading deck above the fractured city. The Echo watches from a rooftop."""
    import citykit as CK
    S = K.Section('s8')
    ox, oy = SURFACE
    B = CK.Batch('s8c')
    # lift head house (the lift arrives inside, the deck opens north)
    K.room(S, 's8_lift', ox - 4, ox + 4, oy + 8, oy, 4.5, M, openings={'n': [(ox, 3.2)]}, beams=False, floor_mat='grate')
    # the deck: 40 x 22 m slab, kerb, a broken railing over a 30 m drop
    S.add(K.box('s8_deck', (40.0, 22.4, 1.2), (ox, oy - 11.2, -0.6), M['c_deck'], bevel=0.04))
    S.add(K.box('s8_deck_kerb', (40.0, 0.4, 0.25), (ox, oy - 22.2, 0.12), M['c_concrete'], bevel=0.03))
    for x0, x1 in ((ox - 19.5, ox + 1.5), (ox + 6.5, ox + 19.5)):
        S.add(K.railing(f's8_rail{x0:.0f}', (x0, oy - 21.8, 0.25), (x1, oy - 21.8, 0.25), M))
    for side in (-1, 1):
        S.add(K.railing(f's8_rails{side}', (ox + side * 19.8, oy - 1.0, 0.0), (ox + side * 19.8, oy - 21.5, 0.0), M))
    # invisible edge walls
    K.collide_box(S, 's8_edge_n', (40.0, 0.6, 3.0), (ox, oy - 22.3, 1.5))
    K.collide_box(S, 's8_edge_w', (0.6, 23.0, 3.0), (ox - 20.2, oy - 11.0, 1.5))
    K.collide_box(S, 's8_edge_e', (0.6, 23.0, 3.0), (ox + 20.2, oy - 11.0, 1.5))
    K.collide_box(S, 's8_deck', (40.0, 22.4, 1.2), (ox, oy - 11.2, -0.6))
    # what the catastrophe left on the deck: tipped barriers, crates, a fallen lamp post, rubble, a slab of a neighbouring tower that
    # crushed the railing
    for i, (x, y, r, tip) in enumerate(((-12, -6, 0.3, 0.0), (-9, -8, 1.2, 1.4), (9, -4, -0.2, 0.0), (13, -10, 0.9, 0.0), (5, -15, 1.6, 1.5))):
        CK.barrier(B, M, ox + x, oy + y, 0.0, rot_z=r, tipped=tip)
    for i, (x, y, s_, r) in enumerate(((-16, -3, 1.2, 0.1), (-16, -4.4, 1.2, -0.05), (-16.1, -3.6, 1.0, 0.3), (15.5, -17, 1.3, 0.4))):
        CK.crate(B, M, ox + x, oy + y, 0.0 if i != 2 else 1.2, s=s_, rot_z=r)
    CK.lamp_post(B, M, ox - 18, oy - 20, 0.0)
    CK.lamp_post(B, M, ox + 18, oy - 20, 0.0, rot_z=math.pi)
    CK.lamp_post(B, M, ox + 2, oy - 12, 0.0, rot_z=0.6, fallen=True)
    B.box(M['c_ruin'], (6.0, 3.5, 0.6), (ox + 4.0, oy - 21.0, 0.9), bevel=0.06,
          rot=__import__('mathutils').Matrix.Rotation(0.5, 4, 'Z') @ __import__('mathutils').Matrix.Rotation(0.35, 4, 'X'))
    for k, (x, y) in enumerate(((-6, -18), (8, -8), (16, -14), (-14, -14))):
        S.add(K.debris(f's8_rub{k}', (ox + x, oy + y, 0), M, n=9, seed=60 + k, size=0.35))
    # neighbouring towers (real facade depth); the Echo's rooftop just across the gap, lower than the deck's line of sight
    CK.tower(B, M, ox - 26, oy - 14, 14, 16, -30, 44, 'modern', 1)
    CK.tower(B, M, ox + 27, oy - 6, 14, 18, -30, 12, 'concrete', 2)
    CK.tower(B, M, ox - 12, oy - 41, 18, 12, -30, 4, 'brick', 3)
    CK.tower(B, M, ox - 40, oy - 64, 16, 20, -30, 20, 'overgrown', 4)
    CK.fractured_tower(B, M, ox + 24, oy - 62, 22, 22, -30, 28, 86, 'concrete', 'brick', 5, shift=(2.2, -1.4), twist=5, gap=1.6, chunks=22)
    CK.fractured_tower(B, M, ox - 2, oy - 98, 26, 18, -30, 40, 118, 'ruin', 'modern', 6, shift=(3.5, -2.0), twist=8, gap=4.5, chunks=30)
    for o in B.objects():
        S.add(o)
    # sky + fog for this section (the engine swaps the background when Ethan is here); spawn, checkpoint, the edge trigger
    K.marker(S, 'sky', (ox, oy, 2.0), id='storm', hdri='textures/sky/approaching_storm.hdr', intensity=0.9, fog=[0.32, 0.36, 0.42, 0.0055])
    K.marker(S, 'checkpoint', (ox, oy + 4.5, 0.05), yaw=0.0, id='cp_s8')
    K.marker(S, 'trigger', (ox, oy - 16.0, 1.0), size=[30.0, 1.0, 2.0], id='s8_edge')
    K.marker(S, 'echo', (ox - 12.0, oy - 35.4, 4.3), yaw=math.pi, id='echo')
    K.marker(S, 'camera', (ox + 3.0, oy - 19.5, 1.7), id='vista', target=[ox - 4.0, oy - 120.0, 30.0])
    K.marker(S, 'camera', (ox - 6.0, oy - 20.5, 1.8), id='echo_cam', target=[ox - 12.0, oy - 35.4, 5.4])
    return S


def s9_vista(M):
    """The skyline beyond the deck: hundreds of towers in four eras, streets 30 m down, fractures where districts failed to line up,
    one district lifted clean off the ground and hanging in the storm."""
    import random
    import citykit as CK
    S = K.Section('s9')
    ox, oy = SURFACE
    B = CK.Batch('s9c')
    rng = random.Random(9)
    S.add(K.box('s9_ground', (1400.0, 1000.0, 0.5), (ox, oy - 480.0, -30.25), M['c_asphalt'], bevel=0.0))
    for gx in range(-14, 15):
        for gy in range(0, 18):
            x, y = ox + gx * 44.0 + rng.uniform(-6, 6), oy - 150.0 - gy * 44.0 + rng.uniform(-6, 6)
            if abs(gx) < 2 and gy < 1:
                continue
            d = math.hypot(gx * 0.6, gy) + 1
            h = max(18.0, rng.lognormvariate(3.9, 0.45) * (1.2 if abs(gx) < 6 else 0.8))
            w, dd = rng.uniform(18, 32), rng.uniform(18, 32)
            era = rng.choice(('modern', 'modern', 'concrete', 'concrete', 'brick', 'ruin'))
            body = M[f'f_{era}']
            z1 = -30 + h
            if rng.random() < 0.08 and h > 60:
                # a fracture: the upper part of the tower from another era, shifted, a seam of light, debris
                zc = -30 + h * rng.uniform(0.35, 0.6)
                era2 = rng.choice(('modern', 'brick', 'ruin', 'concrete'))
                B.box(body, (w, dd, zc + 30), (x, y, (zc - 30) / 2), bevel=0.2)
                sx, sy, gap = rng.uniform(-6, 6), rng.uniform(-6, 6), rng.uniform(3, 18)
                tw = rng.uniform(-0.25, 0.25)
                B.box(M[f'f_{era2}'], (w, dd, z1 - zc - gap), (x + sx, y + sy, zc + gap + (z1 - zc - gap) / 2), rot_z=tw, bevel=0.2)
                B.box(M['c_seam'], (w * 0.9, dd * 0.9, 0.4), (x + sx * 0.5, y + sy * 0.5, zc + gap * 0.5), rot_z=tw * 0.5, bevel=0.0)
                for _ in range(8):
                    sz = rng.uniform(1.5, 5)
                    B.box(body, (sz, sz * 0.8, sz * 0.6), (x + rng.uniform(-w, w), y + rng.uniform(-dd, dd), zc + rng.uniform(0, gap + 6)),
                          rot=__import__('mathutils').Matrix.Rotation(rng.uniform(0, 1.2), 4, 'X'), bevel=0.1)
            else:
                B.box(body, (w, dd, h), (x, y, -30 + h / 2), bevel=0.2)
                if h > 50 and rng.random() < 0.5:  # setback tier
                    th = rng.uniform(10, 30)
                    B.box(body, (w * 0.7, dd * 0.7, th), (x, y, z1 + th / 2), bevel=0.2)
                    z1 += th
            B.box(M['c_concrete'], (w * 0.35, dd * 0.3, 2.5), (x + rng.uniform(-4, 4), y + rng.uniform(-4, 4), z1 + 1.25), bevel=0.1)
    # the lifted district: a whole block of towers torn off at street level, hanging 120 m up over the centre of the storm
    lx, ly, lz = ox + 80.0, oy - 520.0, 140.0
    B.box(M['c_ruin'], (120.0, 90.0, 14.0), (lx, ly, lz - 7.0), bevel=0.5)
    for _ in range(14):
        w, dd, h = rng.uniform(16, 26), rng.uniform(16, 26), rng.uniform(20, 70)
        B.box(M[f'f_{rng.choice(("modern", "concrete", "ruin"))}'], (w, dd, h), (lx + rng.uniform(-45, 45), ly + rng.uniform(-30, 30), lz + h / 2), bevel=0.2)
    for _ in range(40):
        sz = rng.uniform(2, 9)
        B.box(M['c_ruin'], (sz, sz * 0.7, sz * 0.5), (lx + rng.uniform(-70, 70), ly + rng.uniform(-50, 50), lz - rng.uniform(10, 90)),
              rot=__import__('mathutils').Matrix.Rotation(rng.uniform(0, 2), 4, 'Y'), bevel=0.2)
    for o in B.objects():
        S.add(o)
    return S


SECTIONS = {'s1': s1_integration_lab, 's2': s2_corridor, 's3': s3_checkpoint, 's4': s4_research_lab, 's5': s5_server_hall,
            's6': s6_engine_chamber, 's7': s7_lift, 's8': s8_surface, 's9': s9_vista}


def build(only=None):
    K.reset()
    K.LAMP_POWER[0] = 320.0
    M = materials()
    built = {}
    for key, fn in SECTIONS.items():
        mark = len(K.LIGHT_MARKERS)
        S = fn(M)
        S.lights = K.LIGHT_MARKERS[mark:]
        built[key] = S
    return built, M


def probes(built, keys):
    """Bake the character light probes of each section (no lightmap rebake needed: the probes render the scene directly)."""
    if any(k in ('s8', 's9') for k in keys):
        K.sky_world(os.path.join(K.ROOT, 'vendor', 'polyhaven', 'hdri', 'approaching_storm_2k.hdr'), 1.0)
    for key in keys:
        S = built[key]
        if key == 's9':
            continue  # the skyline: nobody walks there
        heights = (1.1, 3.4) if key == 's6' else (1.1,)
        objs = [o for o in S.static if o.name in ('s8_deck', 's8_lift_floor')] if key == 's8' else S.static
        pts = K.probe_points(objs, spacing=3.0 if key in ('s6', 's8') else 2.0, heights=heights, exterior=key == 's8')
        K.bake_probes(pts, os.path.join(K.PUB, f'environments/ch1/{key}_probes.json'))


def export(built, keys, samples):
    statics = {}
    for key in keys:
        S = built[key]
        st = K.join(S.static, f'ch1_{key}_static')
        K.finish_static(st)
        statics[key] = st
    K.copy_textures()
    hdri = os.path.join(K.ROOT, 'vendor', 'polyhaven', 'hdri', 'approaching_storm_2k.hdr')
    if any(k in ('s8', 's9') for k in keys):
        import shutil
        os.makedirs(os.path.join(K.PUB, 'textures', 'sky'), exist_ok=True)
        shutil.copy(hdri, os.path.join(K.PUB, 'textures', 'sky', 'approaching_storm.hdr'))
        K.sky_world(hdri, 1.0)
    for key in keys:
        S, st = built[key], statics[key]
        lm_rel = f'environments/ch1/{key}_lm.hdr'
        size = 2048 if key in ('s1', 's3', 's4', 's5', 's6', 's8', 's9') else 1024
        K.bake_lightmap(st, os.path.join(K.PUB, lm_rel), size=size, samples=samples)
        st['lightmap'] = lm_rel
    K.strip_textures()
    for key in keys:
        S = built[key]
        K.export([statics[key]] + S.collide + S.markers + S.lights + getattr(S, 'dynamic', []), os.path.join(OUT, f'{key}.glb'))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    samples = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 96
    keys = argv[argv.index('--only') + 1].split(',') if '--only' in argv else list(SECTIONS)
    built, M = build()
    if '--render' in argv:
        key, out = argv[argv.index('--render') + 1], argv[argv.index('--render') + 2]
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        bpy.context.scene.collection.objects.link(cam)
        sp = next((m for m in built[key].markers if m.get('marker') in ('spawn', 'checkpoint', 'trigger')), None)
        base = sp.location if sp else (0, 0, 0)
        cam.location = (base[0] + 0.8, base[1] + 1.5, 1.7)
        cam.rotation_euler = (math.radians(86), 0, math.radians(178))
        cam.data.lens = 20
        bpy.context.scene.camera = cam
        sc = bpy.context.scene
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.render.resolution_x, sc.render.resolution_y = 1280, 720
        sc.render.filepath = out
        bpy.ops.render.render(write_still=True)
    if '--export' in argv:
        export(built, keys, samples)
    if '--probes' in argv:
        probes(built, keys)
