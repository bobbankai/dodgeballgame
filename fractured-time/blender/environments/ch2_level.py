"""
CHAPTER 2: THE OTHER WORLD. The Fractured Metropolitan District, minutes after Chapter 1's surface finale: the same storm, the same
city that is several cities at once. Sections (Blender axes, -Y is "forward" through the chapter):
  c1 rooftops   Ethan comes down off the HELIX tower's neighbours: a roof, a gap to jump, a fire escape to the street
  c2 street     the Overlapping Street: 2089 glass on one side, the same block abandoned and overgrown on the other; a HELIX van
                hangs frozen mid-crash; a civilian holo-log
  c3 cafe       a ruined cafe where Imani Reyes has set up: lanterns, a laptop rig, the first conversation
  (c4 gate, c5 plaza, c6 subway, c7 pursuit, c8 helipad follow)
  blender -b --factory-startup --python-exit-code 1 -P blender/environments/ch2_level.py -- [--only c1,c2] [--render KEY out.png] [--probes] [--export]
"""
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

import ch1_level as L1  # noqa: E402  (materials: the facility and city sets are shared)
import citykit as CK  # noqa: E402
import envkit as K  # noqa: E402

OUT = os.path.join(K.PUB, 'environments', 'ch2')


def stairs(B, mat, x, y, z0, z1, run_dir, width=1.1, rise=0.18, run=0.28):
    """A straight flight from z0 up to z1 starting at (x, y), climbing along run_dir (unit xy). Returns the top position."""
    n = max(1, int(round((z1 - z0) / rise)))
    r = (z1 - z0) / n
    dx, dy = run_dir
    ang = math.atan2(dy, dx)
    for i in range(n):
        cx, cy = x + dx * run * (i + 0.5), y + dy * run * (i + 0.5)
        B.box(mat, (run + 0.02, width, 0.05), (cx, cy, z0 + r * (i + 1) - 0.025), rot_z=ang, bevel=0.008)
    return x + dx * run * n, y + dy * run * n


def fire_escape(S, B, M, x, y, z_top, flights=6, wall_dir=(1, 0)):
    """Steel fire escape down a facade at (x, y): landings at every storey, flights zig-zagging along the wall, railings, collision
    ramps (the steps are drawn; walking uses one smooth ramp per flight)."""
    seg = z_top / flights
    run_len = 4.6
    for k in range(flights):
        z_hi = z_top - k * seg
        z_lo = z_hi - seg
        sgn = 1 if k % 2 == 0 else -1
        y0 = y + (run_len / 2) * sgn
        # landing at the top of this flight
        B.box(M['c_grate'], (1.6, 1.6, 0.06), (x, y0 + sgn * 0.8, z_hi - 0.03), bevel=0.01)
        K.collide_box(S, f'fe_land{k}', (1.6, 1.6, 0.1), (x, y0 + sgn * 0.8, z_hi - 0.05))
        stairs(B, M['c_grate'], x, y0 - sgn * run_len, z_lo, z_hi, (0, sgn), width=1.1, rise=seg / 17)
        # walkable ramp under the drawn steps
        ang = math.atan2(seg, run_len)
        r = K.box(f'col_fe_ramp{k}', (1.1, math.hypot(run_len, seg), 0.08), (x, y0 - sgn * run_len / 2, (z_lo + z_hi) / 2), None, bevel=0.0,
                  rot=(sgn * ang, 0, 0))
        r['collision'] = True
        r.hide_render = True
        S.collide.append(S.link(r))
        S.add(K.railing(f'fe_rail{k}', (x - 0.6, y0 - sgn * run_len, z_lo), (x - 0.6, y0, z_hi), M))  # outer side, away from the wall
    B.box(M['c_grate'], (1.6, 1.6, 0.06), (x, y - (run_len / 2) * (1 if flights % 2 == 0 else -1), 0.03), bevel=0.01)


def van(B, M, x, y, z, rot=None):
    """A HELIX patrol van (frozen mid-crash in c2): body, cab, glazing, wheels, light bar."""
    R = rot if rot is not None else Matrix.Identity(4)
    T = lambda lx, ly, lz: (R @ __import__('mathutils').Vector((lx, ly, lz)))  # noqa: E731
    def put(mat, size, l, bevel=0.06):  # noqa: E306
        p = T(*l)
        B.box(mat, size, (x + p.x, y + p.y, z + p.z), bevel=bevel, rot=R)
    put(M['c_vanbody'], (2.1, 4.6, 1.9), (0, 0.4, 1.35), 0.12)
    put(M['c_vanbody'], (2.0, 1.5, 1.3), (0, -2.35, 1.0), 0.18)
    put(M['c_glass'], (1.9, 0.08, 0.7), (0, -2.85, 1.35), 0.02)
    for sx in (-1, 1):
        put(M['c_glass'], (0.05, 1.1, 0.6), (sx * 1.0, -2.2, 1.35), 0.02)
        put(M['c_vanstripe'], (0.03, 4.4, 0.18), (sx * 1.055, 0.4, 1.05), 0.0)
        for wy in (-1.9, 1.7):
            p = T(sx * 0.95, wy, 0.42)
            B.box(M['c_tyre'], (0.32, 0.84, 0.84), (x + p.x, y + p.y, z + p.z), bevel=0.2, rot=R)
    put(M['c_vanlight'], (1.4, 0.25, 0.1), (0, -1.6, 2.36), 0.03)


def s_rooftops(M):
    S = K.Section('c1')
    B = CK.Batch('c1b')
    # roof A (start): the tower body below and a walkable roof deck with a low parapet, broken where the jump is
    CK.storeys(B, M, 'concrete', 0, -6, 18, 20, 0.0, 20, random.Random(1), parapet=False)
    S.add(K.box('c1_roofA', (18.0, 20.0, 0.5), (0, -6, 20.05), M['c_deck'], bevel=0.02))
    K.collide_box(S, 'c1_roofA', (18.0, 20.0, 0.5), (0, -6, 20.05))
    for (cx, cy, sx, sy) in ((0, 3.85, 18, 0.3), (-8.85, -6, 0.3, 20), (8.85, -6, 0.3, 20), (-5.5, -15.85, 7, 0.3), (5.5, -15.85, 7, 0.3)):
        B.box(M['c_concrete'], (sx, sy, 1.0), (cx, cy, 20.8), bevel=0.04)
        K.collide_box(S, f'c1_par{cx}{cy}', (sx, sy, 1.2), (cx, cy, 20.9))
    CK.roof_clutter(B, M, -3, -2, 10, 10, 20.3, random.Random(3))
    # roof B: two metres lower across a 2.6 m gap
    CK.storeys(B, M, 'brick', 0, -30.6, 18, 22, 0.0, 18, random.Random(2), parapet=False)
    S.add(K.box('c1_roofB', (18.0, 22.0, 0.5), (0, -30.6, 18.05), M['c_deck'], bevel=0.02))
    K.collide_box(S, 'c1_roofB', (18.0, 22.0, 0.5), (0, -30.6, 18.05))
    for (cx, cy, sx, sy) in ((8.85, -30.6, 0.3, 22), (0, -41.45, 18, 0.3), (-8.85, -24, 0.3, 9), (-8.85, -38.5, 0.3, 5.5)):
        B.box(M['c_brick'], (sx, sy, 1.0), (cx, cy, 18.8), bevel=0.03)
        K.collide_box(S, f'c1_parB{cx}{cy}', (sx, sy, 1.2), (cx, cy, 18.9))
    CK.roof_clutter(B, M, 2, -33, 10, 12, 18.3, random.Random(4))
    # the fire escape down roof B's west face, opening onto the alley
    fire_escape(S, B, M, -10.2, -31.5, 18.0, flights=6)
    K.collide_box(S, 'c1_alley', (8.0, 40.0, 0.4), (-13.0, -30.0, -0.2))
    S.add(K.box('c1_alley_floor', (8.0, 40.0, 0.4), (-13.0, -30.0, -0.2), M['c_asphalt'], bevel=0.0))
    CK.tower(B, M, -24, -26, 14, 30, -0.0, 26, 'ruin', 5)
    for o in B.objects():
        S.add(o)
    K.marker(S, 'sky', (0, 0, 22), id='storm', hdri='textures/sky/approaching_storm.hdr', intensity=0.9, fog=[0.32, 0.36, 0.42, 0.0055])
    K.marker(S, 'spawn', (0, -2.0, 20.35), yaw=0.0, id='start')
    K.marker(S, 'checkpoint', (0, -2.0, 20.35), yaw=0.0, id='cp_c1')
    K.marker(S, 'trigger', (0, -14.0, 21.0), size=[8.0, 1.0, 2.0], id='c1_edge')
    K.marker(S, 'trigger', (-13.0, -33.0, 1.0), size=[6.0, 1.0, 2.0], id='c1_street')
    K.marker(S, 'camera', (3.0, -12.0, 22.0), id='c1_gap', target=[-2.0, -24.0, 18.5])
    return S


def s_street(M):
    S = K.Section('c2')
    B = CK.Batch('c2b')
    x0, x1, y0, y1 = -22.0, -4.0, -48.0, -112.0
    # the street: asphalt, kerbs, pavements on both sides
    S.add(K.box('c2_road', (x1 - x0, y0 - y1, 0.4), ((x0 + x1) / 2, (y0 + y1) / 2, -0.2), M['c_asphalt'], bevel=0.0))
    K.collide_box(S, 'c2_road', (x1 - x0, y0 - y1, 0.4), ((x0 + x1) / 2, (y0 + y1) / 2, -0.2))
    for xs in (x0 + 1.5, x1 - 1.5):
        S.add(K.box(f'c2_pave{xs}', (3.0, y0 - y1, 0.16), (xs, (y0 + y1) / 2, 0.08), M['c_deck'], bevel=0.02))
        K.collide_box(S, f'c2_pave{xs}', (3.0, y0 - y1, 0.16), (xs, (y0 + y1) / 2, 0.08))
    # west side: 2089 (glass and clean concrete); east side: the same block decades on, abandoned and overgrown
    for k in range(4):
        y = y0 - 8 - k * 16
        CK.tower(B, M, x0 - 9, y, 16, 14, 0.0, 30 + 12 * (k % 2), 'modern', 10 + k)
        CK.tower(B, M, x1 + 9, y, 16, 14, 0.0, 14 + 6 * (k % 2), 'overgrown' if k % 2 else 'ruin', 20 + k)
        K.collide_box(S, f'c2_bw{k}', (16, 14, 8), (x0 - 9, y, 4))
        K.collide_box(S, f'c2_be{k}', (16, 14, 8), (x1 + 9, y, 4))
    # the anomaly: a HELIX van caught mid-crash, nose down, a metre off the road, with its debris frozen around it
    van(B, M, -13.0, -78.0, 1.1, rot=Matrix.Rotation(0.45, 4, 'Z') @ Matrix.Rotation(-0.35, 4, 'X') @ Matrix.Rotation(0.2, 4, 'Y'))
    rng = random.Random(7)
    for _ in range(18):
        s_ = rng.uniform(0.1, 0.45)
        B.box(rng.choice([M['c_glass'], M['c_vanbody'], M['c_ruin']]), (s_, s_ * 0.7, s_ * 0.3),
              (-13 + rng.uniform(-3, 3), -78 + rng.uniform(-3.5, 3.5), rng.uniform(0.4, 3.5)),
              rot=Matrix.Rotation(rng.uniform(0, 3), 4, (rng.random(), rng.random(), rng.random())), bevel=0.01)
    K.collide_box(S, 'c2_van', (3.0, 6.0, 2.5), (-13.0, -78.0, 1.6))
    K.marker(S, 'anomaly', (-13.0, -78.0, 1.6), id='c2_van', size=[7.0, 8.0, 4.0])
    for i, (x, y, r, tip) in enumerate(((-8, -60, 0.2, 0.0), (-18, -66, 1.4, 1.5), (-9, -95, -0.3, 0.0), (-17, -101, 0.4, 0.0))):
        CK.barrier(B, M, x, y, 0.0, rot_z=r, tipped=tip)
    for y in (-56, -76, -96):
        CK.lamp_post(B, M, x0 + 0.6, y, 0.16, rot_z=-math.pi / 2)
        CK.lamp_post(B, M, x1 - 0.6, y, 0.16, rot_z=math.pi / 2, fallen=(y == -76))
    # the cafe's frontage on the east side (the door is the way in)
    for o in B.objects():
        S.add(o)
    K.marker(S, 'sky', (-13, -80, 10), id='storm', hdri='textures/sky/approaching_storm.hdr', intensity=0.9, fog=[0.32, 0.36, 0.42, 0.0055])
    K.marker(S, 'checkpoint', (-13.0, -50.0, 0.05), yaw=0.0, id='cp_c2')
    K.marker(S, 'interact', (-6.5, -70.0, 0.2), id='c2_log1', prompt='Play recording', log=1)
    K.marker(S, 'trigger', (-13.0, -72.0, 1.0), size=[16.0, 1.0, 2.0], id='c2_van_seen')
    K.marker(S, 'trigger', (-6.0, -104.0, 1.0), size=[4.0, 4.0, 2.0], id='c2_cafe_door')
    K.marker(S, 'camera', (-6.0, -66.0, 1.6), id='c2_van_cam', target=[-13.0, -78.0, 1.6])
    return S


def table(B, M, x, y, z=0.0, tipped=False):
    """A cafe table: round top on a pedestal (a fallen one lies on its side)."""
    if tipped:
        R = Matrix.Rotation(math.pi / 2, 4, 'X')
        B.box(M['c_wood'], (0.75, 0.04, 0.75), (x, y, z + 0.38), bevel=0.15, rot=R)
        B.box(M['c_metal'], (0.06, 0.7, 0.06), (x, y + 0.35, z + 0.38), bevel=0.01, rot=R)
        return
    B.box(M['c_wood'], (0.75, 0.75, 0.04), (x, y, z + 0.74), bevel=0.15)
    B.box(M['c_metal'], (0.06, 0.06, 0.72), (x, y, z + 0.37), bevel=0.01)
    B.box(M['c_metal'], (0.45, 0.45, 0.03), (x, y, z + 0.015), bevel=0.1)


def chair(B, M, x, y, rot_z=0.0, z=0.0):
    R = Matrix.Rotation(rot_z, 4, 'Z')
    B.box(M['c_wood'], (0.42, 0.42, 0.04), (x, y, z + 0.46), bevel=0.02, rot=R)
    back = R @ __import__('mathutils').Vector((0, 0.19, 0))
    B.box(M['c_wood'], (0.42, 0.04, 0.42), (x + back.x, y + back.y, z + 0.7), bevel=0.02, rot=R)
    for lx, ly in ((-0.18, -0.18), (0.18, -0.18), (-0.18, 0.18), (0.18, 0.18)):
        p = R @ __import__('mathutils').Vector((lx, ly, 0))
        B.box(M['c_metal'], (0.03, 0.03, 0.45), (x + p.x, y + p.y, z + 0.225), bevel=0.005)


def s_cafe(M):
    """Imani's hideout: a cafe on the abandoned side of the street. Shuttered, half its windows gone, lit by her lanterns."""
    S = K.Section('c3')
    B = CK.Batch('c3b')
    x0, x1, y0, y1, H = -3.0, 9.0, -100.0, -112.0, 3.8
    K.room(S, 'c3', x0, x1, y0, y1, H, M, openings={'w': [(-104.0, 1.6)]}, beams=False, floor_mat='c_tile')
    # counter along the back wall, shelves, a menu board, the coffee machine
    B.box(M['c_wood'], (5.0, 0.7, 1.05), (4.5, -110.8, 0.525), bevel=0.03)
    B.box(M['c_stone'], (5.1, 0.8, 0.05), (4.5, -110.8, 1.07), bevel=0.01)
    K.collide_box(S, 'c3_counter', (5.1, 0.8, 1.1), (4.5, -110.8, 0.55))
    for z in (1.7, 2.2, 2.7):
        B.box(M['c_wood'], (4.0, 0.3, 0.04), (4.5, -111.75, z), bevel=0.01)
    B.box(M['c_metal'], (0.6, 0.45, 0.5), (3.0, -110.85, 1.35), bevel=0.04)
    B.box(M['dark'], (1.6, 0.03, 0.9), (7.0, -111.95, 2.4), bevel=0.01)
    # tables and chairs: some standing, some knocked over in the panic
    rng = random.Random(12)
    for i, (x, y) in enumerate(((0.0, -102.5), (2.5, -103.5), (6.5, -102.8), (1.2, -106.5), (5.0, -106.0), (7.5, -107.0))):
        tipped = i in (2, 4)
        table(B, M, x, y, tipped=tipped)
        if not tipped:
            K.collide_box(S, f'c3_t{i}', (0.8, 0.8, 0.8), (x, y, 0.4))
        for k in range(2):
            a = rng.uniform(0, math.tau)
            chair(B, M, x + math.cos(a) * 0.7, y + math.sin(a) * 0.7, rot_z=a + math.pi / 2)
    # Imani's corner: a table pushed to the wall, a laptop rig, cables, two lanterns
    table(B, M, 7.6, -103.2)
    B.box(M['dark'], (0.38, 0.27, 0.02), (7.6, -103.2, 0.77), bevel=0.005)
    B.box(M['c_screen'], (0.36, 0.01, 0.24), (7.6, -103.35, 0.9), bevel=0.003)
    for i, (x, y) in enumerate(((7.2, -102.9), (5.6, -108.8))):
        B.box(M['c_metal'], (0.16, 0.16, 0.26), (x, y, 0.77 + 0.13 if i == 0 else 1.08 + 0.13), bevel=0.02)
        B.box(M['c_lantern'], (0.1, 0.1, 0.14), (x, y, 0.9 if i == 0 else 1.21), bevel=0.02)
        K.area_light(f'c3_lantern{i}', (x, y, 0.92 if i == 0 else 1.23), (0.12, 0.12), 35.0, (1.0, 0.62, 0.3), shape='DISK',
                     rot=(math.pi, 0, 0))
    # the storm through the broken front windows (glass on the east, mostly gone)
    for k, y in enumerate((-102.0, -106.0, -110.0)):
        if k == 1:
            B.box(M['c_glass'], (0.04, 3.0, 1.8), (x1 + 0.02, y, 1.9), bevel=0.0)
    K.area_light('c3_window', (x1 - 0.2, -106.0, 2.2), (3.0, 1.6), 60.0, (0.55, 0.65, 0.8), rot=(0, math.radians(-90), 0))
    for o in B.objects():
        S.add(o)
    K.marker(S, 'checkpoint', (-1.5, -104.0, 0.05), yaw=-math.pi / 2, id='cp_c3')
    K.marker(S, 'npc', (7.0, -104.4, 0.0), yaw=math.pi * 0.75, id='imani')
    K.marker(S, 'trigger', (2.0, -104.0, 1.0), size=[2.0, 6.0, 2.0], id='c3_meet')
    K.marker(S, 'camera', (2.5, -101.2, 1.55), id='c3_two_shot', target=[6.0, -104.6, 1.45])
    return S


SECTIONS = {'c1': s_rooftops, 'c2': s_street, 'c3': s_cafe}


def materials():
    M = L1.materials()
    M['c_vanbody'] = K.mat('c_vanbody', 'painted_metal_shutter', 0.8, tint=(0.62, 0.62, 0.6), desat=0.6, rough_add=-0.1, coat=0.4)
    M['c_vanstripe'] = K.plain_mat('c_vanstripe', (0.62, 0.26, 0.05), rough=0.4)
    M['c_vanlight'] = K.emissive_mat('c_vanlight', (1.0, 0.3, 0.1), 12.0)
    M['c_tyre'] = K.plain_mat('c_tyre', (0.02, 0.02, 0.022), rough=0.8)
    M['c_wood'] = K.mat('c_wood', 'distressed_painted_planks', 1.2, tint=(0.55, 0.45, 0.36), desat=0.5) \
        if os.path.isdir(os.path.join(K.PH, 'distressed_painted_planks')) else K.plain_mat('c_wood', (0.22, 0.15, 0.1), rough=0.55)
    M['c_tile'] = K.mat('c_tile', 'anti_skid_tiles', 1.0, tint=(0.38, 0.33, 0.3), desat=0.5)
    M['c_screen'] = K.emissive_mat('c_screen', (0.4, 0.8, 1.0), 3.0)
    M['c_lantern'] = K.emissive_mat('c_lantern', (1.0, 0.62, 0.3), 25.0)
    return M


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
    K.sky_world(os.path.join(K.ROOT, 'vendor', 'polyhaven', 'hdri', 'approaching_storm_2k.hdr'), 1.0)
    for key in keys:
        S = built[key]
        pts = K.probe_points(S.static, spacing=3.0, heights=(1.1, 19.4, 21.4), exterior=True)
        K.bake_probes(pts, os.path.join(K.PUB, f'environments/ch2/{key}_probes.json'))


def export(built, keys, samples):
    statics = {}
    for key in keys:
        st = K.join(built[key].static, f'ch2_{key}_static')
        K.finish_static(st)
        statics[key] = st
    K.copy_textures()
    K.sky_world(os.path.join(K.ROOT, 'vendor', 'polyhaven', 'hdri', 'approaching_storm_2k.hdr'), 1.0)
    for key in keys:
        lm_rel = f'environments/ch2/{key}_lm.hdr'
        K.bake_lightmap(statics[key], os.path.join(K.PUB, lm_rel), size=2048, samples=samples)
        statics[key]['lightmap'] = lm_rel
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
        K.sky_world(os.path.join(K.ROOT, 'vendor', 'polyhaven', 'hdri', 'approaching_storm_2k.hdr'), 1.0)
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        bpy.context.scene.collection.objects.link(cam)
        mk = next((m for m in built[key].markers if m.get('marker') in ('spawn', 'checkpoint')), None)
        base = mk.location if mk else (0, 0, 0)
        cam.location = (base[0] + 1.0, base[1] + 3.0, base[2] + 1.8)
        cam.rotation_euler = (math.radians(84), 0, math.radians(172))
        cam.data.lens = 20
        bpy.context.scene.camera = cam
        sc = bpy.context.scene
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.render.resolution_x, sc.render.resolution_y = 1280, 720
        sc.render.filepath = out
        bpy.ops.render.render(write_still=True)
    if '--probes' in argv:
        probes(built, keys)
    if '--export' in argv:
        export(built, keys, samples)
