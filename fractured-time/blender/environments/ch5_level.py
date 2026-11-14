"""
CHAPTER 5: THE FINAL TIMELINE. The Temporal Nexus, outside space-time: fragments of every place the fractures tore loose float in a
void of light, all of it turning slowly around the central Engine, which hangs in the distance like a sun. The Engine IS the sun of
this place: the Nexus sky is generated (blender: `nexus_sky`), a dark violet void with chronal bands and the Engine's disc, and it
lights the bakes, the probes and the light volumes, so the fog between the fragments carries shafts of Engine light.
  n1 fragments  islands from every era (facility deck, district street, arcology marble, foundry grating): a crossing that needs every
                ability: timeline-only islands, a walkway swept by beams too fast to pass at normal speed, an energy gate held by a plate
  n2 bridge     the arcology's broken skybridge, adrift: the Echo fights beside Ethan through waves of temporal elites
  n3 heart      the platform before the Engine: Director Voss. In his last phase the platform's outer ring flips between realities.
Sections sit at x = 1000 (the epilogues borrow Chapter 1's integration lab and Chapter 2's street, which keep their own places).
  blender -b --factory-startup --python-exit-code 1 -P blender/environments/ch5_level.py -- [--only n1] [--render KEY out.png]
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
import numpy as np  # noqa: E402

import ch4_level as L4  # noqa: E402
import citykit as CK  # noqa: E402
import envkit as K  # noqa: E402

OUT = os.path.join(K.PUB, 'environments', 'ch5')
NEXUS_HDRI = os.path.join(K.ROOT, 'vendor', 'generated', 'nexus_2k.hdr')
OX = 1000.0
# the Engine, seen from the fragments: straight ahead (-Y), a little above the horizon
ENGINE_DIR = np.array([0.0, -math.cos(math.radians(9)), math.sin(math.radians(9))])


def nexus_sky(path, w=2048, h=1024, seed=5):
    """The Nexus as an equirect HDR (Blender world mapping): a violet-black void, a brighter band where the fractures are thickest,
    three chronal bands (cyan and amber) on great circles, sparse glinting shards, and the Engine: a white-gold disc with a wide glow."""
    rng = np.random.default_rng(seed)
    v = (np.arange(h) + 0.5) / h
    u = (np.arange(w) + 0.5) / w
    T, P = np.meshgrid((v - 0.5) * math.pi, (u - 0.5) * 2 * math.pi, indexing='ij')
    d = np.stack([-np.cos(T) * np.cos(P), np.cos(T) * np.sin(P), np.sin(T)], -1)
    z = d[..., 2]
    col = np.zeros((h, w, 3))
    col += np.array([0.004, 0.005, 0.014]) * (1 - np.abs(z))[..., None] ** 0.5
    col += np.array([0.014, 0.016, 0.034]) * np.exp(-(z / 0.18) ** 2)[..., None]
    col += np.array([0.006, 0.004, 0.01]) * np.clip(-z, 0, 1)[..., None]
    for axis, c, k in (((0.3, 0.2, 0.93), (0.25, 0.75, 1.0), 0.5), ((-0.6, 0.5, 0.62), (1.0, 0.52, 0.16), 0.32), ((0.8, -0.5, 0.33), (0.4, 0.8, 1.0), 0.28)):
        a = np.array(axis) / np.linalg.norm(axis)
        dist = np.abs(d @ a)
        wob = 1 + 0.5 * np.sin(P * 7 + T * 3) * np.sin(P * 13)
        col += np.array(c) * k * np.exp(-(dist / 0.035) ** 2)[..., None] * np.clip(wob, 0.2, 2)[..., None]
        col += np.array(c) * k * 0.15 * np.exp(-(dist / 0.15) ** 2)[..., None]
    stars = rng.random((h, w)) > 0.9993
    col[stars] += rng.uniform(2, 8, (stars.sum(), 1)) * np.array([0.8, 0.9, 1.0])
    cosE = d @ ENGINE_DIR
    ang = np.arccos(np.clip(cosE, -1, 1))
    col += np.array([1.0, 0.9, 0.72]) * 900.0 * (ang < math.radians(2.2))[..., None]
    col += np.array([1.0, 0.82, 0.6]) * (6.0 * np.exp(-(ang / math.radians(6)) ** 2) + 0.6 * np.exp(-(ang / math.radians(25)) ** 2))[..., None]
    write_hdr(path, col[::-1])  # rows were built from the nadir up; Radiance files start at the top
    print('NEXUS SKY', path, 'max', float(col.max()))


def write_hdr(path, rgb):
    """Radiance RGBE (flat scanlines), unclamped: Blender's own writer clips very bright pixels, and the Engine is a sun."""
    m = rgb.max(-1)
    mant, ex = np.frexp(m)
    f = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0.0)
    out = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    out[..., :3] = np.clip(rgb * f[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(m > 1e-32, ex + 128, 0).astype(np.uint8)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        fh.write(f'-Y {rgb.shape[0]} +X {rgb.shape[1]}\n'.encode())
        fh.write(out.tobytes())


def materials():
    M = L4.materials()
    M.update({
        'n_rock': K.mat('n_rock', 'concrete_debris', 0.35, tint=(0.32, 0.31, 0.33), desat=0.6),
        'n_edge': K.emissive_mat('n_edge', (0.3, 0.8, 1.0), 5.0),
        'n_amber': K.emissive_mat('n_amber', (1.0, 0.55, 0.2), 6.0),
        'n_engine': K.emissive_mat('n_engine', (1.0, 0.86, 0.66), 40.0),
        'n_gate': K.emissive_mat('n_gate', (0.35, 0.85, 1.0), 4.0),
    })
    return M


def fragment(S, B, M, era, cx, cy, cz, w, d, seed, tl=None, collide=True):
    """A floating island torn from one era: its floor on top, a jagged underside of broken slab and rock tapering into the void, a
    thin line of chronal light along the tear, and a few pieces of the place it came from."""
    rng = random.Random(seed)
    top = {'facility': M['floor_tile'], 'street': M['c_asphalt'], 'arcology': M['a_marble'], 'foundry': M['c_grate'], 'ruin': M['b_ruin']}[era]
    S.add(K.box(f'fr{seed}_top', (w, d, 0.5), (cx, cy, cz - 0.25), top, bevel=0.03), timeline=tl)
    if collide:
        K.collide_box(S, f'fr{seed}', (w, d, 0.5), (cx, cy, cz - 0.25), timeline=tl)
    under = []
    for k in range(5):
        s = 1.0 - k * 0.18
        under.append(K.box(f'fr{seed}_u{k}', (w * s * rng.uniform(0.8, 1.0), d * s * rng.uniform(0.8, 1.0), 1.2),
                           (cx + rng.uniform(-0.6, 0.6), cy + rng.uniform(-0.6, 0.6), cz - 1.0 - k * 1.05), M['n_rock'], bevel=0.25,
                           rot=(rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), rng.uniform(0, 0.3))))
    S.add(K.join(under, f'fr{seed}_under'), timeline=tl)
    for sx, sy, lw, ld in ((0, d / 2, w, 0.06), (0, -d / 2, w, 0.06), (w / 2, 0, 0.06, d), (-w / 2, 0, 0.06, d)):
        S.add(K.box(f'fr{seed}_edge{sx}{sy}', (lw, ld, 0.05), (cx + sx, cy + sy, cz - 0.52), M['n_edge'], bevel=0.0), timeline=tl)
    # a few pieces of where it came from
    if era == 'street':
        S.add(K.box(f'fr{seed}_kerb', (w, 0.3, 0.16), (cx, cy + d / 2 - 0.4, cz + 0.08), M['c_concrete'], bevel=0.02), timeline=tl)
    elif era == 'arcology':
        S.add(K.box(f'fr{seed}_col', (0.9, 0.9, 3.2), (cx - w / 2 + 0.8, cy, cz + 1.6), M['a_stone'], bevel=0.04), timeline=tl)
        if collide:
            K.collide_box(S, f'fr{seed}_col', (0.9, 0.9, 3.2), (cx - w / 2 + 0.8, cy, cz + 1.6), timeline=tl)
    elif era == 'facility':
        S.add(K.box(f'fr{seed}_panel', (0.12, d * 0.6, 2.6), (cx + w / 2 - 0.3, cy, cz + 1.3), M['panel'], bevel=0.02), timeline=tl)
        if collide:
            K.collide_box(S, f'fr{seed}_panel', (0.3, d * 0.6, 2.6), (cx + w / 2 - 0.3, cy, cz + 1.3), timeline=tl)
    elif era == 'foundry':
        S.add(K.box(f'fr{seed}_pipe', (w, 0.3, 0.3), (cx, cy - d / 2 + 0.4, cz + 0.5), M['c_metal'], bevel=0.1), timeline=tl)


def s_fragments(M):
    S = K.Section('n1')
    B = CK.Batch('n1b')
    x = OX
    fragment(S, B, M, 'facility', x, 0.0, 0.0, 10.0, 10.0, 1)
    fragment(S, B, M, 'street', x, -11.5, 0.4, 8.0, 12.0, 2)
    # the timeline crossing: an arcology island in a overlaps a foundry island in b by a metre; the far island is out of reach
    # from the first alone
    fragment(S, B, M, 'arcology', x, -22.0, 0.8, 7.0, 8.0, 3, tl='a')
    fragment(S, B, M, 'foundry', x + 0.5, -28.5, 0.8, 5.0, 7.0, 4, tl='b')
    K.marker(S, 'checkpoint', (x, -14.5, 0.45), yaw=0.0, id='cp_n1b')
    fragment(S, B, M, 'ruin', x, -40.0, 0.8, 9.0, 11.0, 5)
    # the swept walkway: a long narrow causeway; two beams cross it faster than anyone can run (slow time)
    S.add(K.box('n1_walk', (3.0, 18.0, 0.4), (x, -54.5, 0.6), M['trim'], bevel=0.03))
    K.collide_box(S, 'n1_walk', (3.0, 18.0, 0.4), (x, -54.5, 0.6))
    for sx in (-1.5, 1.5):
        S.add(K.box(f'n1_walkedge{sx}', (0.05, 18.0, 0.05), (x + sx, -54.5, 0.81), M['n_edge'], bevel=0.0))
    for k, (y, per) in enumerate(((-50.0, 1.1), (-58.0, 0.9))):
        K.marker(S, 'laser', (x, y, 1.8), id=f'n1_beam{k}', width=4.0, height=2.6, sweep=3.6, period=per, phase=k * 0.4)
    K.marker(S, 'checkpoint', (x, -44.5, 0.85), yaw=0.0, id='cp_n1c')
    # the gate island: an energy gate across the way on, held by a plate on a side island
    fragment(S, B, M, 'facility', x, -70.0, 0.8, 10.0, 10.0, 6)
    fragment(S, B, M, 'arcology', x + 7.5, -70.0, 0.8, 4.0, 4.0, 7)
    K.sliding_door(S, 'n1_gate', (x, -75.0), True, 3.0, M, door_h=3.0, state='locked')
    for sx in (-1.7, 1.7):
        S.add(K.box(f'n1_gpost{sx}', (0.3, 0.3, 3.4), (x + sx, -75.0, 2.5), M['trim'], bevel=0.03))
    S.add(K.box('n1_gwall_l', (3.4, 0.4, 3.0), (x - 3.4, -75.0, 2.3), M['n_gate'], bevel=0.0))
    S.add(K.box('n1_gwall_r', (3.4, 0.4, 3.0), (x + 3.4, -75.0, 2.3), M['n_gate'], bevel=0.0))
    K.collide_box(S, 'n1_gwalls', (10.0, 0.6, 4.0), (x, -75.0, 2.8))
    S.add(K.cylinder('n1_plate', 0.75, 0.04, (x + 7.5, -70.0, 0.82), M['trim'], verts=48, bevel=0.0))
    K.marker(S, 'plate', (x + 7.5, -70.0, 0.85), id='n1_plate', door='n1_gate', hold=3.0)
    # the far island: the first elites
    fragment(S, B, M, 'street', x, -84.0, 0.8, 12.0, 12.0, 8)
    K.marker(S, 'checkpoint', (x, -66.0, 0.85), yaw=0.0, id='cp_n1d')
    K.marker(S, 'enemies', (x, -86.0, 0), id='n1_wave', group=[['elite', x - 3.0, -88.0, 3.14], ['operative', x + 3.0, -88.5, 3.14]])
    K.marker(S, 'trigger', (x, -89.5, 1.8), size=[6.0, 1.0, 2.0], id='n1_exit')
    # distant fragments: scenery all around (no collision)
    rng = random.Random(55)
    for k in range(26):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(30, 90)
        fragment(S, B, M, rng.choice(('facility', 'street', 'arcology', 'foundry', 'ruin')), x + math.cos(a) * r, -45 + math.sin(a) * r,
                 rng.uniform(-25, 20), rng.uniform(4, 14), rng.uniform(4, 14), 100 + k, collide=False)
    K.marker(S, 'trigger', (x, -40.0, -8.0), size=[80.0, 120.0, 3.0], id='n1_fall')
    for o in B.objects():
        S.add(o)
    nexus_marker(S, (x, -40.0, 4.0))
    K.marker(S, 'spawn', (x, 2.5, 0.05), yaw=0.0, id='start')
    K.marker(S, 'checkpoint', (x, 2.5, 0.05), yaw=0.0, id='cp_n1')
    K.marker(S, 'camera', (x + 9.0, 7.0, 4.5), id='n1_reveal', target=[x, -60.0, 2.0])
    return S


def s_bridge(M):
    S = K.Section('n2')
    B = CK.Batch('n2b')
    x = OX
    y0, y1 = -96.0, -140.0
    # the skybridge: a glass-and-steel deck, broken in places, adrift
    S.add(K.box('n2_deck', (6.0, y0 - y1, 0.5), (x, (y0 + y1) / 2, 0.55), M['a_marble'], bevel=0.03))
    K.collide_box(S, 'n2_deck', (6.0, y0 - y1, 0.5), (x, (y0 + y1) / 2, 0.55))
    for sx in (-3.0, 3.0):
        for k in range(int((y0 - y1) / 4)):
            y = y0 - 2 - k * 4
            S.add(K.box(f'n2_fin{sx}{k}', (0.12, 0.12, 2.4), (x + sx, y, 2.0), M['trim'], bevel=0.02))
            if k % 3 != 1:
                S.add(K.box(f'n2_glass{sx}{k}', (0.04, 3.9, 2.2), (x + sx, y - 2, 1.9), M['glass'], bevel=0.0))
        K.collide_box(S, f'n2_side{sx}', (0.4, y0 - y1, 3.0), (x + sx, (y0 + y1) / 2, 2.3))
    for k in range(6):
        y = y0 - 4 - k * 7.5
        S.add(K.box(f'n2_rib{k}', (6.6, 0.4, 0.4), (x, y, 3.3), M['trim'], bevel=0.04))
    S.add(K.join([K.box(f'n2_under{k}', (5.0, 7.0, 1.2), (x, y0 - 4 - k * 8.5, -0.5 - (k % 2) * 0.4), M['n_rock'], bevel=0.3)
                  for k in range(5)], 'n2_under'))
    fragment(S, B, M, 'arcology', x, y0 + 2.0, 0.8, 8.0, 4.0, 20)
    K.marker(S, 'checkpoint', (x, y0 - 1.0, 0.85), yaw=0.0, id='cp_n2')
    K.marker(S, 'trigger', (x, y0 - 6.0, 1.8), size=[6.0, 1.0, 2.0], id='n2_enter')
    K.marker(S, 'enemies', (x, -110.0, 0), id='n2_wave1', group=[['elite', x - 1.5, -112.0, 3.14], ['trooper', x + 1.5, -113.0, 3.14],
                                                               ['trooper', x, -115.0, 3.14]])
    K.marker(S, 'enemies', (x, -125.0, 0), id='n2_wave2', group=[['elite', x - 1.5, -126.0, 3.14], ['elite', x + 1.5, -127.0, 3.14],
                                                               ['heavy', x, -129.0, 3.14]])
    K.marker(S, 'trigger', (x, y1 + 1.0, 1.8), size=[6.0, 1.0, 2.0], id='n2_exit')
    K.marker(S, 'trigger', (x, (y0 + y1) / 2, -8.0), size=[60.0, 60.0, 3.0], id='n2_fall')
    for o in B.objects():
        S.add(o)
    nexus_marker(S, (x, -118.0, 4.0))
    K.marker(S, 'camera', (x + 4.5, y0 - 2.0, 3.0), id='n2_reveal', target=[x, -125.0, 1.5])
    return S


def s_heart(M):
    S = K.Section('n3')
    cx, cy, R = OX, -165.0, 16.0
    S.add(K.box('n3_walk', (4.0, 10.0, 0.5), (cx, -144.0, 0.55), M['trim'], bevel=0.03))
    K.collide_box(S, 'n3_walk', (4.0, 10.0, 0.5), (cx, -144.0, 0.55))
    # the platform: centre disc (both), outer ring of 16 segments (a: all; b: every other)
    S.add(K.cylinder('n3_disc', 7.0, 0.8, (cx, cy, 0.4), M['a_marble'], verts=96, bevel=0.03))
    K.collide_box(S, 'n3_disc', (10.0, 10.0, 0.8), (cx, cy, 0.4))
    S.add(K.cylinder('n3_discedge', 7.08, 0.06, (cx, cy, 0.81), M['n_edge'], verts=96, bevel=0.0))
    n = 16
    for k in range(n):
        a0, a1 = k / n * math.tau, (k + 1) / n * math.tau
        am = (a0 + a1) / 2
        rm = (7.0 + R) / 2
        L = 2 * rm * math.sin((a1 - a0) / 2) + 0.05
        x, y = cx + math.cos(am) * rm, cy + math.sin(am) * rm
        for tl in (('a', 'b') if k % 2 == 0 else ('a',)):
            S.add(K.box(f'n3_seg{k}{tl}', (R - 7.0, L, 0.6), (x, y, 0.5), M['a_stone'] if tl == 'a' else M['b_ruin'], bevel=0.03,
                        rot=(0, 0, am)), timeline=tl)
            K.collide_box(S, f'n3_seg{k}{tl}', (R - 7.0, L * 0.9, 0.6), (x, y, 0.5), timeline=tl)
    S.add(K.join([K.box(f'n3_under{k}', (R * 1.6 - k * 4, R * 1.6 - k * 4, 2.0), (cx, cy, -1.2 - k * 1.8), M['n_rock'], bevel=0.5)
                  for k in range(5)], 'n3_under'))
    # four pylons: the hazards Voss wakes in his second phase
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        px, py = cx + math.cos(a) * 11.5, cy + math.sin(a) * 11.5
        S.add(K.cylinder(f'n3_pylon{k}', 0.45, 4.0, (px, py, 2.8), M['trim'], verts=24, bevel=0.04))
        S.add(K.cylinder(f'n3_pyloncore{k}', 0.2, 3.0, (px, py, 3.0), M['n_amber'], verts=16, bevel=0.0))
        K.collide_box(S, f'n3_pylon{k}', (0.9, 0.9, 4.0), (px, py, 2.8))
        K.marker(S, 'pylon', (px, py, 1.0), id=f'n3_pylon{k}')
    # the Engine itself, hanging beyond the platform: its ring, its core
    S.add(K.engine_ring('n3_engine', (cx, cy - 46.0, 22.0), 18.0, M))
    S.add(K.cylinder('n3_core', 4.0, 4.0, (cx, cy - 46.0, 22.0), M['n_engine'], verts=48, bevel=0.0, rot=(math.radians(90), 0, 0)))
    K.area_light('n3_coreL', (cx, cy - 40.0, 22.0), (8.0, 8.0), 9000.0, (1.0, 0.86, 0.66), rot=(math.radians(-90), 0, 0))
    K.area_light('n3_fill', (cx, cy, -6.0), (16.0, 16.0), 900.0, (0.3, 0.6, 1.0), rot=(math.pi, 0, 0))
    K.marker(S, 'checkpoint', (cx, -141.0, 0.85), yaw=0.0, id='cp_n3')
    K.marker(S, 'trigger', (cx, -150.5, 1.8), size=[4.0, 1.0, 2.0], id='n3_enter')
    K.marker(S, 'boss', (cx, cy - 4.0, 0.85), yaw=0.0, id='voss')
    K.marker(S, 'interact', (cx, cy - 6.0, 0.85), id='n3_engine', prompt='Reach into the Engine')
    K.marker(S, 'trigger', (cx, cy, -9.0), size=[60.0, 60.0, 3.0], id='n3_fall')
    nexus_marker(S, (cx, cy, 4.0))
    K.marker(S, 'camera', (cx + 12.0, -146.0, 4.0), id='n3_reveal', target=[cx, cy - 20.0, 8.0])
    K.marker(S, 'camera', (cx - 6.0, cy + 9.0, 1.8), id='n3_low', target=[cx, cy - 46.0, 22.0])
    return S


def nexus_marker(S, loc):
    K.marker(S, 'sky', loc, id='nexus', hdri='textures/sky/nexus.hdr', intensity=1.0, fog=[0.03, 0.035, 0.06, 0.012], exposure=1.25,
             rain=0.0, grade='nexus', nexus=1)


SECTIONS = {'n1': s_fragments, 'n2': s_bridge, 'n3': s_heart}


def build():
    K.reset()
    if not os.path.exists(NEXUS_HDRI) or '--sky' in sys.argv:
        nexus_sky(NEXUS_HDRI)
    CK.LIT.update({k: 0.0 for k in CK.LIT})
    M = materials()
    built = {}
    for key, fn in SECTIONS.items():
        mark = len(K.LIGHT_MARKERS)
        S = fn(M)
        S.lights = K.LIGHT_MARKERS[mark:]
        built[key] = S
    return built, M


def probes(built, keys):
    K.sky_world(NEXUS_HDRI, 1.0)
    for tl in ('a', 'b'):
        for S in built.values():
            K.show_timeline(S, tl)
        for key in keys:
            S = built[key]
            if tl == 'b' and not (S.static_a or S.static_b):
                continue
            pts = K.probe_points([o for o in S.static + getattr(S, f'static_{tl}') if '_top' in o.name or o.name.startswith(('n2_deck', 'n3_disc', 'n3_seg', 'n1_walk'))],
                                 spacing=3.0, heights=(1.1,), exterior=True)
            K.bake_probes(pts, os.path.join(K.PUB, f'environments/ch5/{key}_probes{"_b" if tl == "b" else ""}.json'))
    for S in built.values():
        K.show_timeline(S, None)


def export(built, keys, samples):
    os.makedirs(os.path.join(K.PUB, 'textures', 'sky'), exist_ok=True)
    shutil.copy(NEXUS_HDRI, os.path.join(K.PUB, 'textures', 'sky', 'nexus.hdr'))
    K.sky_world(NEXUS_HDRI, 1.0)
    statics = {key: K.export_timeline_section(built[key], key, OUT, 'ch5', samples) for key in keys}
    K.strip_textures()
    for key in keys:
        S = built[key]
        K.export(statics[key] + S.collide + S.markers + S.lights + getattr(S, 'dynamic', []), os.path.join(OUT, f'{key}.glb'))


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
        K.sky_world(NEXUS_HDRI, 1.0)
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        bpy.context.scene.collection.objects.link(cam)
        mk = next((m for m in built[key].markers if m.get('marker') == 'camera'), None)
        cam.location = mk.location
        import json
        import mathutils
        tgt = mathutils.Vector(json.loads(mk['target']) if isinstance(mk.get('target'), str) else list(mk['target']))
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
        K.bake_volumes(built, keys, 'ch5', NEXUS_HDRI)
    if '--export' in argv:
        export(built, keys, samples)
