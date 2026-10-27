"""
Chapter Two: the Folded Sea. A fishing beach under chalk cliffs, the lighthouse on its headland,
a pier, sea stacks across the water and the inkwell island far out. The sea itself is made in the
game (folded-paper waves); this exports the land, the props and the markers to
src/assets/levels/folded_sea.glb.

Blender X east, Y north (out to sea), sea level z = 0.

Run: blender -b -P tools/blender/folded_sea.py [-- --preview out.png] [--export]
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import kit_sea  # noqa: E402
import lib  # noqa: E402
from lib import smooth01  # noqa: E402

LIGHTHOUSE = Vector((30.0, -47.0))
HEAD_Z = 4.5
ISLAND = Vector((0.0, 150.0))
PIER_X, PIER_Y0, PIER_LEN = 0.0, -56.0, 22.0
STACKS = [(-22, -8, 13, 3.2), (17, 6, 10, 2.6), (-9, 30, 15, 3.6), (26, 44, 12, 3.0), (-28, 62, 14, 3.4), (8, 74, 11, 2.8),
          (-14, 96, 16, 3.8), (22, 104, 12, 3.0), (-30, 118, 10, 2.6), (34, 128, 13, 3.2), (-40, 20, 12, 3.0), (40, 82, 14, 3.4)]
BOTTLES = [(-16, 18), (19, 58), (-6, 112)]
TERRAIN_ID = 7


def coast_height(x, y):
    n = noise.noise(Vector((x * 0.05, y * 0.05, 0.3))) * 0.35 + noise.noise(Vector((x * 0.17, y * 0.17, 1.3))) * 0.12
    # sand from the cliff foot down under the water
    h = 1.6 * smooth01(-47, -64, y) - 6.0 * smooth01(-46, -26, y) + n * smooth01(-44, -60, y)
    # the chalk cliffs behind the beach, and at either end of it
    side = max(smooth01(40, 48, x), smooth01(-40, -48, x))
    cliff = max(smooth01(-69, -73, y), side * smooth01(-30, -40, y))
    h += (9.5 - h) * cliff + noise.noise(Vector((x * 0.12, y * 0.12, 4.0))) * 1.2 * cliff
    # the headland the lighthouse stands on, with a ramp up from the sand
    d = (Vector((x, y)) - LIGHTHOUSE).length + noise.noise(Vector((x * 0.2, y * 0.2, 7))) * 1.2
    head = smooth01(14.5, 12.5, d)
    ramp = 0.0
    rx0, ry0, rx1, ry1 = 13.0, -60.0, 22.0, -51.0
    t = ((x - rx0) * (rx1 - rx0) + (y - ry0) * (ry1 - ry0)) / ((rx1 - rx0) ** 2 + (ry1 - ry0) ** 2)
    px, py = rx0 + (rx1 - rx0) * t, ry0 + (ry1 - ry0) * t
    if -0.05 < t < 1.1 and math.hypot(x - px, y - py) < 2.6:
        ramp = smooth01(2.6, 1.8, math.hypot(x - px, y - py)) * max(0.0, min(1.0, t))
    hh = max(head, ramp * 0.999)
    target = HEAD_Z if head >= ramp else 1.6 + (HEAD_Z - 1.6) * max(0.0, min(1.0, t))
    h += (target + n * 0.3 - h) * hh
    # rocks the sea has worn round the headland's foot
    h -= 2.5 * smooth01(15, 19, d) * smooth01(-40, -30, y) * smooth01(24, 10, abs(x - LIGHTHOUSE.x))
    return h


def island_height(x, y):
    d = (Vector((x, y)) - ISLAND).length
    a = math.atan2(y - ISLAND.y, x - ISLAND.x)
    edge = 19 + 3 * noise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, 5.0)))
    h = -6.0 + 9.0 * smooth01(edge + 7, edge - 1, d)
    # a sandy landing on the south side, rising to rocks round the inkwell
    south = smooth01(1.2, 0.4, abs(a + math.pi / 2))
    h = h * (1 - 0.6 * south * smooth01(4, 18, d)) + noise.noise(Vector((x * 0.2, y * 0.2, 2))) * 0.4
    h += 2.0 * smooth01(9, 4, d)
    return h


SAND = lib.srgb('#E2D2AE')
SAND_WET = lib.srgb('#C9B48C')
CHALK = lib.srgb('#E4DDCB')
GRASS = lib.srgb('#9DB36E')
ROCK = lib.srgb('#9A958A')


def terrain(name, fn, x0, x1, y0, y1, step=0.8):
    nx, ny = int((x1 - x0) / step) + 1, int((y1 - y0) / step) + 1
    bm = bmesh.new()
    verts = []
    for j in range(ny):
        y = y0 + j * step
        for i in range(nx):
            x = x0 + i * step
            verts.append(bm.verts.new((x, y, fn(x, y))))
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i
            q = [verts[a], verts[a + 1], verts[a + nx + 1], verts[a + nx]]
            if (i + j) % 2:
                bm.faces.new([q[0], q[1], q[2]])
                bm.faces.new([q[0], q[2], q[3]])
            else:
                bm.faces.new([q[0], q[1], q[3]])
                bm.faces.new([q[1], q[2], q[3]])
    ob = lib.obj_from_bm(name, bm, lib.mat('terrain_sea', '#FFFFFF', vcol=True), smooth=True)
    me = ob.data
    me.update()
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        x, y, z = v.co
        steep = 1.0 - v.normal.z
        c = list(SAND_WET) if z < 0.4 else list(SAND)
        grass = smooth01(1.8, 3.2, z) * smooth01(0.25, 0.1, steep)
        c = [a + (b - a) * grass for a, b in zip(c, GRASS)]
        rock = smooth01(0.3, 0.5, steep)
        c = [a + (b - a) * rock for a, b in zip(c, CHALK if y < -60 else ROCK)]
        attr.data[v.index].color = (*c, TERRAIN_ID / 255.0)
    me.color_attributes.active_color_name = 'Col'
    return ob


def put(objs, x, y, rot=0.0, z=None, scale=1.0, fn=coast_height):
    kit.transform(objs, (x, y, fn(x, y) if z is None else z), rot, scale)
    return objs


def marker(name, x, y, z, **props):
    e = bpy.data.objects.new(name, None)
    e.location = (x, y, z)
    for k, v in props.items():
        e[k] = v
    lib.link(e)
    return e


def build():
    lib.reset()
    rnd = random.Random(12)
    scenery, special = [], []
    land = terrain('terrain', coast_height, -62, 62, -84, -22)
    isle = terrain('terrain_island', island_height, -34, 34, 118, 182)

    # the lighthouse, its keeper's cottage, and the pieces Ada has to draw
    tower, stairs, missing, lens = kit_sea.lighthouse()
    for g in (tower, stairs, missing, lens):
        kit.transform(g, (LIGHTHOUSE.x, LIGHTHOUSE.y, HEAD_Z), -math.pi / 4)
    scenery += tower + stairs
    special.append(kit.merge(missing, 'trace_steps'))
    special.append(kit.merge(lens, 'trace_lens'))
    cot = kit.cottage(21, w=4.4, d=3.8, roof='roof_slate', door='door_blue', wall='plaster')
    scenery += put(cot, LIGHTHOUSE.x - 6.5, LIGHTHOUSE.y + 1.0, math.pi / 2, z=HEAD_Z)
    lz = HEAD_Z + kit_sea.LH_H + 0.25
    marker('lamp', LIGHTHOUSE.x, LIGHTHOUSE.y, lz + 1.2)
    marker('crane_home', LIGHTHOUSE.x - 3.2, LIGHTHOUSE.y - 4.0, HEAD_Z)
    marker('crane_gallery', LIGHTHOUSE.x - 1.6, LIGHTHOUSE.y - 1.6, lz)
    marker('cp_headland', LIGHTHOUSE.x - 4.5, LIGHTHOUSE.y - 6.5, HEAD_Z)
    marker('cp_gallery', LIGHTHOUSE.x + 1.7, LIGHTHOUSE.y + 0.9, lz)
    for k in range(10):
        a = math.radians(200 + k * 14)
        r = 12.4
        x, y = LIGHTHOUSE.x + math.cos(a) * r, LIGHTHOUSE.y + math.sin(a) * r
        if 4 < k < 8:
            continue
        scenery += put(kit.fence(2.6, 30 + k), x, y, a + math.pi / 2, z=HEAD_Z)

    # the beach: Ada arrives under the cliffs; a pier runs out to sea
    marker('spawn_shore', -6.0, -64.0, coast_height(-6, -64), yaw=0.0)
    marker('pip_shore', -4.0, -62.5, coast_height(-4, -62.5))
    marker('cp_shore', -2.0, -60.0, coast_height(-2, -60))
    scenery += put(kit_sea.pier(PIER_LEN), PIER_X, PIER_Y0, 0.0, z=0.0)
    marker('cp_pier', PIER_X, PIER_Y0 + PIER_LEN - 1.5, 1.3)
    boat = kit_sea.sailboat()
    put(boat, PIER_X + 2.9, PIER_Y0 + PIER_LEN - 3.0, 0.0, z=0.0)
    special.append(kit.merge(boat, 'trace_boat'))
    marker('boat_berth', PIER_X + 2.9, PIER_Y0 + PIER_LEN - 3.0, 0.0)
    for i, (x, y) in enumerate(((-12, -60), (-20, -58), (9, -62), (-28, -63), (14, -66))):
        scenery += put(kit_sea.driftwood(i), x, y, rnd.uniform(0, 6))
    for i, (x, y) in enumerate(((-8, -66), (-9.2, -65.2), (6, -63.5))):
        scenery += put(kit_sea.lobster_pot(), x, y, rnd.uniform(0, 6))
    scenery += put(kit_sea.wreck(), -17, -55.5, 0.6)
    huts = [(-24, -66, 0.15, 'roof_slate'), (-15, -68, -0.1, 'roof_red')]
    for i, (x, y, r, roof) in enumerate(huts):
        scenery += put(kit.cottage(40 + i, w=3.8, d=3.2, roof=roof, door='door_blue', wall='plaster2'), x, y, r)
    for k in range(9):
        x = rnd.uniform(-40, 40)
        y = rnd.uniform(-68, -63)
        if abs(x) > 4 and math.hypot(x - LIGHTHOUSE.x, y - LIGHTHOUSE.y) > 16:
            scenery += put(kit.rock(70 + k, rnd.uniform(0.4, 1.1), 'stone'), x, y, rnd.uniform(0, 6))
    for i, (x, y) in enumerate(((-3, -44), (6, -40), (-7, -30))):
        scenery += put(kit_sea.buoy('buoy_red' if i % 2 else 'buoy_white'), x, y, 0.0, z=0.0)

    # out at sea: stacks to steer between, and three bottles with notes in them
    for i, (x, y, h, r) in enumerate(STACKS):
        scenery += put(kit_sea.stack(i, h, r), x, y, rnd.uniform(0, 6), z=0.0)
        marker(f'stack_{i}', x, y, 0.0, r=r)
    for i, (x, y) in enumerate(BOTTLES):
        marker(f'bottle_{i + 1}', x, y, 0.0)
    marker('storm_start', 0.0, 26.0, 0.0)
    marker('storm_spawn', -10.0, -6.0, 0.0)
    marker('cp_sea1', 0.0, 10.0, 0.0)
    marker('cp_sea2', 0.0, 60.0, 0.0)
    marker('cp_sea3', 0.0, 100.0, 0.0)

    # the inkwell island
    iw = kit_sea.inkwell()
    put(iw, ISLAND.x, ISLAND.y + 2.0, 0.0, fn=island_height)
    writing = [o for o in iw if o.name.startswith('iw_writing')]
    scenery += [o for o in iw if o not in writing]
    special.append(kit.merge(writing, 'trace_label'))
    top = island_height(ISLAND.x, ISLAND.y + 2.0)
    marker('pigment_blue', ISLAND.x, ISLAND.y + 2.0, top + 7.6)
    marker('island_landing', ISLAND.x, ISLAND.y - 19.0, 0.0)
    marker('cp_island', ISLAND.x, ISLAND.y - 12.0, island_height(ISLAND.x, ISLAND.y - 12))
    marker('island_view', ISLAND.x - 2.0, ISLAND.y - 7.0, island_height(ISLAND.x - 2, ISLAND.y - 7))
    for k in range(14):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(6, 15)
        x, y = ISLAND.x + math.cos(a) * r, ISLAND.y + math.sin(a) * r
        if abs(a + math.pi / 2) < 0.6:
            continue
        scenery += put(kit.rock(90 + k, rnd.uniform(0.6, 1.6), 'stone'), x, y, rnd.uniform(0, 6), fn=island_height)
    for k in range(6):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(9, 14)
        x, y = ISLAND.x + math.cos(a) * r, ISLAND.y + math.sin(a) * r
        if abs(a + math.pi / 2) < 0.7:
            continue
        scenery += put(kit.tree(300 + k, rnd.uniform(4, 6), 'pine'), x, y, rnd.uniform(0, 6), fn=island_height)
    # grass on the clifftops and a few wind-bent pines
    for k in range(18):
        x, y = rnd.uniform(-58, 58), rnd.uniform(-82, -74)
        scenery += put(kit.tree(400 + k, rnd.uniform(4.5, 7), 'pine' if k % 3 else 'round'), x, y, rnd.uniform(0, 6))
    for k in range(6):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(5, 11)
        x, y = LIGHTHOUSE.x + math.cos(a) * r, LIGHTHOUSE.y + math.sin(a) * r
        if math.hypot(x - (LIGHTHOUSE.x - 6.5), y - (LIGHTHOUSE.y + 1)) < 4.5 or abs(a - math.radians(225)) < 0.5:
            continue
        scenery += put(kit.tree(500 + k, rnd.uniform(3.5, 5), 'round'), x, y, rnd.uniform(0, 6), z=HEAD_Z)

    out = [land, isle]
    cells = {}
    for o in scenery:
        lib.apply_modifiers(o)
        c = o.matrix_world @ Vector(o.bound_box[0]).lerp(Vector(o.bound_box[6]), 0.5)
        key = (math.floor(c.x / 60.0), math.floor(c.y / 60.0), bool(o.get('col', 1)))
        cells.setdefault(key, []).append(o)
    for (cx, cy, solid), objs in cells.items():
        ob = lib.join(objs, f"scenery{'' if solid else '_soft'}_{cx}_{cy}")
        if not solid:
            ob['col'] = 0
        lib.bake_materials(ob)
        out.append(ob)
    for o in special:
        lib.apply_modifiers(o)
    return out + special


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    build()
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        lib.preview(out.replace('.png', '_beach.png'), target=(10, -50, 3), dist=45, yaw=200, pitch=24, size=(1400, 800), lens=35, samples=16)
        lib.preview(out.replace('.png', '_top.png'), target=(0, 50, 0), dist=260, yaw=0.01, pitch=89, size=(700, 1300), lens=35, samples=8)
    if '--export' in argv:
        lib.export_glb(os.path.join(lib.ROOT, 'src', 'assets', 'levels', 'folded_sea.glb'))
