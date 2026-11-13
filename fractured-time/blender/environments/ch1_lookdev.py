"""
Chapter 1 look-development: a HELIX sublevel service corridor after the incident (judged against reference A's lighting quality).
  blender -b --factory-startup --python-exit-code 1 -P blender/environments/ch1_lookdev.py -- [--render out.png] [--export] [--samples N]
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import envkit as K  # noqa: E402


def materials():
    M = {
        'floor': K.mat('floor', 'concrete_floor_worn_001', 0.5, tint=(0.82, 0.82, 0.8), desat=0.6, normal_strength=1.2),
        'wall': K.mat('wall', 'painted_concrete', 0.6, tint=(0.62, 0.66, 0.7), desat=0.35),
        'panel': K.mat('panel', 'blue_metal_plate', 0.7, tint=(0.55, 0.6, 0.66), desat=0.55, normal_strength=1.1, rough_add=0.18),
        'trim': K.mat('trim', 'metal_plate_02', 1.0, tint=(0.36, 0.37, 0.39), desat=0.8, metal=0.6, rough_mul=0.9),
        'vent': K.mat('vent', 'metal_plate', 2.0, tint=(0.22, 0.23, 0.24), desat=0.9, metal=0.5),
        'pipe': K.mat('pipe', 'metal_plate_02', 2.0, tint=(0.45, 0.42, 0.36), desat=0.5, metal=0.7),
        'flange': K.mat('flange', 'metal_plate', 3.0, tint=(0.3, 0.3, 0.31), desat=0.9, metal=0.7),
        'cable': K.plain_mat('cable', (0.02, 0.02, 0.022), rough=0.55),
        'ceiling': K.mat('ceiling', 'concrete_wall_003', 0.4, tint=(0.5, 0.5, 0.5), desat=0.7),
        'grate': K.mat('grate', 'anti_skid_tiles', 1.5, tint=(0.3, 0.31, 0.32), desat=0.9, metal=0.6),
        'door': K.mat('door', 'painted_metal_shutter', 0.6, tint=(0.75, 0.72, 0.62), desat=0.2),
        'debris': K.mat('debris', 'concrete_debris', 1.2, tint=(0.7, 0.7, 0.68), desat=0.6),
    }
    M['led_g'] = K.emissive_mat('led_g', (0.2, 1.0, 0.45), 6.0)
    M['led_r'] = K.emissive_mat('led_r', (1.0, 0.15, 0.08), 8.0)
    M['warn'] = K.emissive_mat('warn', (1.0, 0.12, 0.04), 30.0)
    return M


def build():
    K.reset()
    M = materials()
    S = K.Section('ch1_lookdev')
    W, L, H = 4.0, 16.0, 3.6
    # floor with a grated service trench down the middle
    S.add(K.box('floor_l', (W / 2 - 0.35, L, 0.2), (-(W / 4 + 0.175), -L / 2, -0.1), M['floor'], bevel=0.0))
    S.add(K.box('floor_r', (W / 2 - 0.35, L, 0.2), ((W / 4 + 0.175), -L / 2, -0.1), M['floor'], bevel=0.0))
    S.add(K.box('trench', (0.7, L, 0.2), (0, -L / 2, -0.24), M['vent'], bevel=0.0))
    for i in range(int(L / 1.0)):
        S.add(K.box(f'grate{i}', (0.66, 0.96, 0.03), (0, -0.5 - i, -0.02), M['grate'], bevel=0.004))
    # walls (panelled faces inward)
    S.add(K.panel_wall('wall_l', (-W / 2, 0), (-W / 2, -L), H, 0, M, inward=(1, 0, 0)))
    S.add(K.panel_wall('wall_r', (W / 2, 0), (W / 2, -L), H, 0, M, inward=(-1, 0, 0)))
    # ceiling slab + beams
    S.add(K.box('ceiling', (W + 0.3, L, 0.3), (0, -L / 2, H + 0.15), M['ceiling'], bevel=0.0))
    for i in range(int(L / 2) + 1):
        S.add(K.box(f'beam{i}', (W, 0.3, 0.36), (0, -i * 2.0, H - 0.18), M['trim'], bevel=0.015))
    # pipes along the left upper corner, cable tray + cables on the right
    S.add(K.pipe_run('pipe_a', [(-1.55, 0.2, H - 0.55), (-1.55, -L + 0.2, H - 0.55)], 0.11, M))
    S.add(K.pipe_run('pipe_b', [(-1.25, 0.2, H - 0.62), (-1.25, -6.0, H - 0.62), (-1.25, -6.6, H - 0.2)], 0.06, M, flange_every=1.5))
    S.add(K.box('tray', (0.45, L, 0.05), (1.45, -L / 2, H - 0.62), M['trim'], bevel=0.006))
    for i in range(4):
        y0 = -i * 4.0
        S.add(K.cable_run(f'cab{i}', (1.45, y0 - 0.2, H - 0.58), (1.45, y0 - 3.8, H - 0.58), M, n=4, sag=0.06))
    S.add(K.cable_run('cab_drop', (1.3, -9.6, H - 0.6), (0.9, -10.5, 0.4), M, n=3, sag=0.3))  # torn cables hanging to the floor
    # lights: two working, one dead, one flickering-weak; red emergency beacons on the walls
    S.add(K.light_strip('lamp0', 3.0, (0, -1.0, H - 0.4), math.pi / 2, M))
    S.add(K.light_strip('lamp1', 3.0, (0, -5.0, H - 0.4), math.pi / 2, M, strength=6.0))
    S.add(K.light_strip('lamp2', 3.0, (0, -9.0, H - 0.4), math.pi / 2, M, on=False))
    S.add(K.light_strip('lamp3', 3.0, (0, -13.0, H - 0.4), math.pi / 2, M))
    for y in (-7.0, -15.0):
        S.add(K.box(f'beacon{y}', (0.1, 0.16, 0.16), (-W / 2 + 0.2, y, 2.6), M['warn'], bevel=0.02))
    # console + rack + debris + crates
    scr = K.screen_texture(os.path.join(K.PUB, 'textures', 'ui', 'helix_screen_a.png'), seed=3)
    del scr
    S.add(K.console('console', (-W / 2 + 0.5, -4.2, 0), -math.pi / 2, M, K.screen_mat('screen_a', 'textures/ui/helix_screen_a.png')))
    S.add(K.rack('rack0', (W / 2 - 0.45, -11.5, 0), math.pi / 2, M, M['led_g']))
    S.add(K.rack('rack1', (W / 2 - 0.45, -12.2, 0), math.pi / 2, M, M['led_r']))
    S.add(K.debris('rubble', (0.4, -9.6, 0), M, n=9, seed=4, size=0.32))
    fallen = K.box('fallen_panel', (1.3, 0.04, 0.9), (0.55, -9.2, 0.35), M['ceiling'], bevel=0.01, rot=(math.radians(65), 0, math.radians(20)))
    S.add(fallen)
    for i, (x, y) in enumerate(((1.4, -2.5), (1.45, -3.2), (1.35, -2.85))):
        S.add(K.box(f'crate{i}', (0.6, 0.6, 0.55), (x, y, 0.275 + (0.55 if i == 2 else 0)), M['panel'], bevel=0.02))
    # blast door at the end
    S.add(K.box('door_frame', (W, 0.4, H), (0, -L - 0.1, H / 2), M['trim'], bevel=0.02))
    S.add(K.box('door_l', (1.3, 0.12, 2.8), (-0.66, -L + 0.12, 1.4), M['door'], bevel=0.015))
    S.add(K.box('door_r', (1.3, 0.12, 2.8), (0.66, -L + 0.12, 1.4), M['door'], bevel=0.015))
    S.add(K.box('door_light', (0.5, 0.04, 0.06), (0, -L + 0.2, 2.95), M['led_r'], bevel=0.005))
    # end wall behind the camera
    S.add(K.box('back_wall', (W, 0.3, H), (0, 0.15, H / 2), M['wall'], bevel=0.0))
    # collision (simple boxes)
    col = [('col_floor', (W, L, 0.2), (0, -L / 2, -0.1)), ('col_wl', (0.3, L, H), (-W / 2 - 0.15, -L / 2, H / 2)),
           ('col_wr', (0.3, L, H), (W / 2 + 0.15, -L / 2, H / 2)), ('col_end', (W, 0.3, H), (0, -L - 0.05, H / 2)),
           ('col_back', (W, 0.3, H), (0, 0.15, H / 2)), ('col_crates', (0.7, 1.4, 1.1), (1.4, -2.85, 0.55)),
           ('col_console', (0.7, 1.4, 1.0), (-W / 2 + 0.45, -4.2, 0.5)), ('col_racks', (0.95, 1.6, 2.1), (W / 2 - 0.45, -11.85, 1.05)),
           ('col_rubble', (1.4, 1.4, 0.4), (0.4, -9.6, 0.2))]
    for n, size, loc in col:
        o = K.box(n, size, loc, None, bevel=0.0)
        o['collision'] = True
        o.hide_render = True  # collision only: never rendered or baked
        S.collide.append(S.link(o))
    for n, loc, yaw in (('spawn', (0.0, -1.5, 0.0), 0.0),):
        e = bpy.data.objects.new(n, None)
        e.location = loc
        e['marker'] = n
        e['yaw'] = yaw
        S.markers.append(S.link(e))
    return S, M


def render(out, samples):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    cam.location = (0.55, -0.6, 1.62)
    cam.rotation_euler = (math.radians(88), 0, math.radians(178))  # looking down the corridor (-Y)
    cam.data.lens = 24
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    samples = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 128
    S, M = build()
    static = K.join(S.static, 'ch1_lookdev_static')
    K.finish_static(static)
    for y in (-7.0, -15.0):  # emergency beacons cast real red light
        K.area_light(f'beacon_l{y}', (-1.75, y, 2.6), (0.12, 0.12), 25.0, (1.0, 0.1, 0.04), rot=(0, math.radians(90), 0), shape='DISK')
    if '--render' in argv:
        render(argv[argv.index('--render') + 1], samples)
    if '--export' in argv:
        lm_rel = 'environments/ch1/lookdev_lm.hdr'
        K.bake_lightmap(static, os.path.join(K.PUB, lm_rel), size=2048, samples=samples)
        static['lightmap'] = lm_rel
        K.copy_textures()
        K.strip_textures()
        K.export([static] + S.collide + S.markers + K.LIGHT_MARKERS, os.path.join(K.PUB, 'environments', 'ch1', 'lookdev.glb'))
