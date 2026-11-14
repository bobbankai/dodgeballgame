"""
CHAPTER 3: THE DOPPELGANGER. The HELIX Corporate Arcology, which exists in two timelines at once (Timeline Shift swaps them):
  timeline a: 2089, operational, immaculate: marble, glass, warm white light, the HELIX brand on every wall
  timeline b: the same rooms twenty years abandoned: dim, cracked, overgrown, floors fallen through
Every room has a shared shell (walls, structure) and each timeline's own dressing, floors and obstacles, so the way through is found
by switching between them.
  a1 lobby     A: a turnstile wall seals the lift lobby. B: the wall is rubble, but the floor in front of the lifts has collapsed.
  a2 offices   A: glass partitions make a maze. B: the glass is gone, but collapsed ceiling and furniture piles block other routes.
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
        K.area_light(f'a1_lampA{i}', (x, -12, H - 0.15), (2.4, 0.4), 260.0, (1.0, 0.95, 0.88))
    # timeline b: the turnstile wall lies in rubble, moss in the cracks, water pooling, a fallen light; the floor has dropped away
    S.add(K.debris('a1_rubble', (0, -20.5, 0), M, n=16, seed=33, size=0.5), timeline='b')
    S.add(K.box('a1_puddle', (5.0, 3.5, 0.02), (-6, -6, 0.01), M['b_water'], bevel=0.0), timeline='b')
    S.add(K.box('a1_moss1', (3.0, 6.0, 0.03), (8, -16, 0.015), M['b_moss'], bevel=0.0), timeline='b')
    S.add(K.box('a1_desk_b', (6.0, 1.2, 1.1), (0.5, -9.3, 0.55), M['b_ruin'], bevel=0.04, rot=(0, 0.12, 0.2)), timeline='b')
    K.collide_box(S, 'a1_desk_b', (6.0, 1.4, 1.1), (0.5, -9.3, 0.55), timeline='b')
    K.area_light('a1_skylightB', (0, -15, H - 0.3), (6.0, 6.0), 180.0, (0.55, 0.62, 0.72))
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
        K.area_light(f'a2_lA{i}', (0, -36 - i * 9, H - 0.12), (8.0, 0.3), 220.0, (1.0, 0.96, 0.9))
    # timeline b: the glass is gone, but the ceiling came down in two places and the furniture is piled across the other routes
    walls_b = [((-4, -42), (12, -42)), ((-12, -50), (5, -50))]
    for i, ((ax, ay), (bx, by)) in enumerate(walls_b):
        L = abs(bx - ax)
        S.add(K.box(f'a2_collapse{i}', (L, 1.6, 1.6), ((ax + bx) / 2, ay, 0.8), M['b_ruin'], bevel=0.2, rot=(0.15, 0.05, 0.0)),
              timeline='b')
        S.add(K.debris(f'a2_cdebris{i}', ((ax + bx) / 2, ay + 1.2, 0), M, n=12, seed=50 + i, size=0.4), timeline='b')
        K.collide_box(S, f'a2_collapse{i}', (L, 1.8, 2.0), ((ax + bx) / 2, ay, 1.0), timeline='b')
    S.add(K.box('a2_moss', (6.0, 10.0, 0.03), (-6, -40, 0.015), M['b_moss'], bevel=0.0), timeline='b')
    K.area_light('a2_lB', (0, -45, H - 0.3), (10.0, 4.0), 120.0, (0.5, 0.58, 0.68))
    K.marker(S, 'checkpoint', (0, -32.0, 0.05), yaw=0.0, id='cp_a2')
    K.marker(S, 'trigger', (6.0, -59.0, 1.0), size=[2.4, 1.0, 2.0], id='a2_exit')
    return S


SECTIONS = {'a1': s_lobby, 'a2': s_offices}


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
    """Character light probes, baked in timeline a (b hidden). Both realities share the room's shell and most of its light."""
    hidden = [o for S in built.values() for o in S.static_b]
    for o in hidden:
        o.hide_render = True
    for key in keys:
        S = built[key]
        pts = K.probe_points(S.static + S.static_a, spacing=2.5, heights=(1.1,))
        K.bake_probes(pts, os.path.join(K.PUB, f'environments/ch3/{key}_probes.json'))
    for o in hidden:
        o.hide_render = False


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    samples = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 96
    keys = argv[argv.index('--only') + 1].split(',') if '--only' in argv else list(SECTIONS)
    built, M = build()
    if '--render' in argv:
        key, out = argv[argv.index('--render') + 1], argv[argv.index('--render') + 2]
        tl = argv[argv.index('--timeline') + 1] if '--timeline' in argv else 'a'
        for S in built.values():
            for o in getattr(S, 'static_b' if tl == 'a' else 'static_a'):
                o.hide_render = True
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
    if '--export' in argv:
        export(built, keys, samples)
