"""
Chapter One: the Margin Village. Terrain, buildings, trees, the things Ada has to trace, and the
gameplay markers, exported to src/assets/levels/margin_village.glb.

Layout (Blender X east, Y north): Ada arrives through a pencilled door in a meadow to the south,
crosses a stream on a bridge she has to trace, reaches the village square, then climbs four
terraces around a hill to the Great Tree, where the green pigment sleeps.

Run: blender -b -P tools/blender/margin_village.py [-- --preview out.png] [--export]
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
import lib  # noqa: E402
from lib import smooth01  # noqa: E402

VILLAGE = Vector((0.0, 0.0))
ARRIVAL = Vector((0.0, -52.0))
TREE = Vector((0.0, 64.0))
# terraces round the hill: (radius from the tree, height inside it)
TERR = [(46.0, 2.6), (34.0, 5.6), (22.0, 8.6), (12.0, 12.0)]
# ways up each terrace edge: angle round the tree (deg), and how
WAYS = {0: (-90.0, 'stairs'), 1: (-20.0, 'ramp'), 2: (110.0, 'rocks'), 3: (-110.0, 'ramp')}
STREAM_Y = -32.0
# ink line id baked into the terrain's vertex alpha (the game's grass uses it too)
TERRAIN_ID = 7


def stream_y(x):
    return STREAM_Y + 2.5 * math.sin(x * 0.09)


def angdiff(a, b):
    return (a - b + 180.0) % 360.0 - 180.0


def edge_radius(k, a):
    """Terrace edge radius at angle a (deg): ragged, but true near its way up."""
    R = TERR[k][0]
    wa, _ = WAYS[k]
    calm = smooth01(10, 30, abs(angdiff(a, wa)))
    r = math.radians(a)
    return R + calm * (1.8 * noise.noise(Vector((math.cos(r) * 2.0 + k * 5, math.sin(r) * 2.0, 0.3))) +
                       0.8 * noise.noise(Vector((math.cos(r) * 6.0, math.sin(r) * 6.0 + k * 3, 1.7))))


def terrace_steps(x, y):
    d = (Vector((x, y)) - TREE).length
    a = math.degrees(math.atan2(y - TREE.y, x - TREE.x))
    h, prev = 0.0, 0.3
    for k, (R, H) in enumerate(TERR):
        Rn = edge_radius(k, a)
        s = smooth01(Rn + 0.55, Rn - 0.55, d)
        wa, kind = WAYS[k]
        if kind == 'ramp':
            arc = abs(math.radians(angdiff(a, wa))) * Rn
            L = 10.0
            ramp = max(0.0, min(1.0, (Rn + L / 2 - d) / L))
            c = smooth01(3.4, 2.2, arc)
            s = s + (ramp - s) * c
        elif kind == 'stairs':
            # a notch cut into the edge for the steps to sit in; a dead end until they're drawn
            arc = abs(math.radians(angdiff(a, wa))) * Rn
            s *= 1.0 - smooth01(1.85, 1.6, arc) * smooth01(Rn - 1.75, Rn - 1.45, d)
        h += (H - prev) * s
        prev = H
    return h


def regions_outside(x, y):
    """Signed distance outside the playable area (negative inside)."""
    p = Vector((x, y))
    v = (p - VILLAGE).length - 21.0
    ar = (p - ARRIVAL).length - 13.0
    co = max(abs(x) - 8.5, abs(y + 33.0) - 15.0)
    te = (p - TREE).length - 47.5
    return min(v, ar, co, te)


def height(x, y):
    n = noise.noise(Vector((x * 0.035, y * 0.035, 0.5))) * 0.9 + noise.noise(Vector((x * 0.11, y * 0.11, 2.0))) * 0.22
    h = 0.3 + n * 0.5
    flat = max(smooth01(23, 15, (Vector((x, y)) - VILLAGE).length), smooth01(13, 7, (Vector((x, y)) - ARRIVAL).length),
               smooth01(3.0, 1.5, abs(x)) * smooth01(-46, -42, y) * smooth01(-18, -22, y))
    h += (0.3 - h) * flat
    h += terrace_steps(x, y)
    out = regions_outside(x, y)
    h += 9.0 * smooth01(0.0, 10.0, out) + 2.5 * smooth01(2, 12, out) * noise.noise(Vector((x * 0.06, y * 0.06, 4.0)))
    ds = abs(y - stream_y(x))
    h -= 2.1 * smooth01(3.3, 2.35, ds) * smooth01(-24, -30, y) * smooth01(-40, -34, y)
    return h


# --- paths (painted on the terrain) -----------------------------------------------------------

def way_point(k, d_off=0.0, a_off=0.0):
    wa, _ = WAYS[k]
    a = math.radians(wa + a_off)
    r = TERR[k][0] + d_off
    return TREE + Vector((math.cos(a), math.sin(a))) * r


def ring_arc(r, a0, a1, n=10):
    return [TREE + Vector((math.cos(math.radians(a0 + (a1 - a0) * i / n)), math.sin(math.radians(a0 + (a1 - a0) * i / n)))) * r
            for i in range(n + 1)]


PATH = ([ARRIVAL + Vector((0, 3)), Vector((0, -40)), Vector((0, -36)), Vector((0, -28)), Vector((0, -14)), Vector((0, -4)),
         Vector((0, 4)), Vector((0, 12)), way_point(0, 2.0)] + [way_point(0, -3.0)] +
        ring_arc(40.0, -90, -20, 8) + [way_point(1, 5.0), way_point(1, -5.0)] + ring_arc(28.0, -20, 110, 12) +
        ring_arc(17.0, 110, 250, 12) + [way_point(3, 5.0), way_point(3, -5.0), TREE + Vector((-2.5, -2.5))])


def path_dist(x, y):
    p = Vector((x, y))
    best = 1e9
    for a, b in zip(PATH, PATH[1:]):
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-6)))
        best = min(best, (p - (a + ab * t)).length)
    return best


# --- terrain mesh ----------------------------------------------------------------------------

def lin(hexcol):
    return lib.srgb(hexcol)


GRASS = [lin('#7FAE5A'), lin('#8DB863'), lin('#6FA052')]
DIRT = lin('#CDB48A')
ROCK = lin('#A99D8B')
HILL = lin('#9DB36E')


def terrain(step=0.8):
    x0, x1, y0, y1 = -60.0, 60.0, -72.0, 118.0
    nx, ny = int((x1 - x0) / step) + 1, int((y1 - y0) / step) + 1
    bm = bmesh.new()
    verts = []
    for j in range(ny):
        y = y0 + j * step
        for i in range(nx):
            x = x0 + i * step
            verts.append(bm.verts.new((x, y, height(x, y))))
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i
            # alternate the diagonal so the grid doesn't show as a direction
            q = [verts[a], verts[a + 1], verts[a + nx + 1], verts[a + nx]]
            if (i + j) % 2:
                bm.faces.new([q[0], q[1], q[2]])
                bm.faces.new([q[0], q[2], q[3]])
            else:
                bm.faces.new([q[0], q[1], q[3]])
                bm.faces.new([q[1], q[2], q[3]])
    ob = lib.obj_from_bm('terrain', bm, lib.mat('terrain', '#FFFFFF', vcol=True), smooth=True)
    me = ob.data
    me.update()
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        x, y, z = v.co
        steep = 1.0 - v.normal.z
        g = GRASS[int((noise.noise(Vector((x * 0.15, y * 0.15, 9))) + 1) * 1.5) % 3]
        c = list(g)
        hill = smooth01(1.0, 6.0, regions_outside(x, y))
        c = [a + (b - a) * hill for a, b in zip(c, HILL)]
        pd = path_dist(x, y) + noise.noise(Vector((x * 0.5, y * 0.5, 3))) * 0.6
        dirt = smooth01(1.6, 0.9, pd)
        c = [a + (b - a) * dirt for a, b in zip(c, DIRT)]
        rock = smooth01(0.25, 0.45, steep)
        c = [a + (b - a) * rock for a, b in zip(c, ROCK)]
        attr.data[v.index].color = (*c, TERRAIN_ID / 255.0)
    me.color_attributes.active_color_name = 'Col'
    return ob


# --- placement ------------------------------------------------------------------------------

def place(objs, x, y, rot=0.0, z=None, scale=1.0):
    kit.transform(objs, (x, y, height(x, y) if z is None else z), rot, scale)
    return objs


def put(objs, x, y, rot=0.0, name=None, z=None, scale=1.0):
    """Place a kit piece on the ground; returns it merged into a solid part and a walk-through part."""
    place(objs, x, y, rot, z, scale)
    name = name or objs[0].name.split('.')[0]
    solid = [o for o in objs if o.get('col', 1)]
    soft = [o for o in objs if not o.get('col', 1)]
    return ([kit.merge(solid, name)] if solid else []) + ([kit.merge(soft, name + '_soft')] if soft else [])


def facing(x, y, tx, ty):
    """Rotation that turns a kit piece's front (-Y) towards (tx, ty)."""
    return math.atan2(-(tx - x), (ty - y)) + math.pi


def marker(name, x, y, z=None, **props):
    e = bpy.data.objects.new(name, None)
    e.location = (x, y, height(x, y) if z is None else z)
    for k, v in props.items():
        e[k] = v
    lib.link(e)
    return e


def build():
    lib.reset()
    rnd = random.Random(7)
    scenery, special = [], []
    ter = terrain()

    # the arrival meadow: a door standing alone in the grass
    scenery += put(kit.door_frame(), ARRIVAL.x, ARRIVAL.y - 1.5, 0.0, 'doorframe')
    marker('spawn_arrival', ARRIVAL.x, ARRIVAL.y - 0.6, yaw=0.0)
    marker('pip_arrival', ARRIVAL.x + 3.0, ARRIVAL.y + 5.0)
    marker('cp_arrival', ARRIVAL.x, ARRIVAL.y + 2.0)
    scenery += put(kit.signpost(2), 2.2, -41.5, 0.3, 'signpost')
    for i, (x, y) in enumerate(((-3.5, -45.0), (4.5, -38.5), (-5.0, -37.0))):
        scenery += put(kit.rock(i + 3, rnd.uniform(0.5, 0.9)), x, y, rnd.uniform(0, 6), 'rock')

    # the stream and the bridge Ada has to finish
    by = stream_y(0.0)
    special.append(kit.merge(place(kit.bridge(9.2, 1.9), 0.0, by, 0.0, z=0.42), 'trace_bridge'))
    marker('cp_bridge_south', 0.0, by - 6.0)
    marker('cp_bridge_north', 0.0, by + 6.0)
    water = lib.obj_from_bm('water', water_mesh(), lib.mat('water', '#7FB2C9'), smooth=True)
    water['col'] = 0
    special.append(water)

    # the village square
    scenery += put(kit.well(), 0.0, 0.0, 0.0, 'well')
    houses = [(18, 14.5, 1, {}), (52, 14.0, 2, dict(w=5.2, d=4.4, roof='roof_slate', door='door_blue', wall='plaster2', stories=2)),
              (128, 14.0, 3, dict(w=4.2, d=3.8, roof='roof_thatch', door='door_red')), (162, 14.5, 4, dict(w=5.0, d=4.2, door='door_blue')),
              (202, 14.0, 5, dict(w=4.4, d=4.0, roof='roof_slate', wall='plaster2')), (238, 15.0, 6, dict(w=5.4, d=4.4, stories=2, door='door_red')),
              (302, 15.0, 7, dict(w=4.6, d=4.0, roof='roof_thatch')), (338, 14.5, 8, dict(w=4.8, d=4.2, roof='roof_slate', door='door_green'))]
    for ang, r, seed, kw in houses:
        a = math.radians(ang)
        x, y = math.cos(a) * r, math.sin(a) * r
        scenery += put(kit.cottage(seed, **kw), x, y, facing(x, y, 0, 0), f'house{seed}')
    for k in range(6):
        a = math.radians(k * 60 + 30)
        x, y = math.cos(a) * 6.5, math.sin(a) * 6.5
        scenery += put(kit.lamp_post(), x, y, facing(x, y, 0, 0) + math.pi, 'lamp')
    nb = (3.2, -4.6)
    scenery += put(kit.notice_board(), nb[0], nb[1], facing(nb[0], nb[1], 0, -12), 'noticeboard')
    marker('note_board', nb[0], nb[1] - 0.4, height(*nb) + 1.35, note='board')
    for (x, y) in ((-4.5, 3.5), (4.0, 4.5), (-5.2, -3.0)):
        scenery += put(kit.bench(), x, y, facing(x, y, 0, 0), 'bench')
    for (x, y, f) in ((9.0, -6.0, kit.barrel), (9.7, -5.4, kit.barrel), (10.4, -6.3, kit.crate), (-10.0, 5.5, kit.crate),
                      (-10.6, 6.3, kit.barrel), (-7.0, -10.5, kit.barrel)):
        scenery += put(f(), x, y, rnd.uniform(0, 6), 'prop')
    for k, (ang, ln) in enumerate(((290, 6.0), (250, 6.0), (80, 5.0), (100, 5.0))):
        a = math.radians(ang)
        x, y = math.cos(a) * 19.5, math.sin(a) * 19.5
        scenery += put(kit.fence(ln, k), x, y, a + math.pi / 2, 'fence')
    marker('cp_village', 0.0, -8.0)
    marker('pip_village', 1.5, -6.0)

    # the terrace edge above the village, and the stairs Ada has to draw
    sp = way_point(0, 1.3)
    inward = (TREE - sp).normalized()
    special.append(kit.merge(place(kit.stairs(2.6, 2.35, 3.0, 9), sp.x, sp.y, math.atan2(-inward.x, inward.y), z=0.3), 'trace_stairs'))
    marker('cp_terrace1', *way_point(0, -4.0))

    # terrace 1: the windmill and the shed with a note
    wm = way_point(0, -6.0, 75)
    tower, sails = kit.windmill()
    rot = facing(wm.x, wm.y, TREE.x, TREE.y) + math.pi
    scenery += put(tower, wm.x, wm.y, rot, 'windmill')
    # the sails turn about their hub, so they keep it as their origin
    place(sails, 0, 0, rot, z=0.0)
    sl = kit.merge(sails, 'windmill_sails')
    hub = Vector((0, -2.05, 7.5))
    hub.rotate(__import__('mathutils').Matrix.Rotation(rot, 3, 'Z'))
    sl.data.transform(__import__('mathutils').Matrix.Translation(-hub))
    sl.location = (wm.x + hub.x, wm.y + hub.y, height(wm.x, wm.y) + hub.z)
    special.append(sl)
    sh = way_point(0, -5.0, -45)
    scenery += put(kit.shed(), sh.x, sh.y, facing(sh.x, sh.y, *way_point(0, 2.0, -45)), 'shed')
    shn = way_point(0, -2.2, -45)
    marker('note_shed', shn.x, shn.y, height(shn.x, shn.y) + 1.0, note='shed')

    # terrace 2 and the climb: a ramp, then rocks to hop up
    marker('cp_terrace2', *way_point(1, -6.0))
    marker('chase_start', *way_point(1, -7.0, 18))
    marker('smudge_spawn', *way_point(1, -6.0, -40))
    wa = WAYS[2][0]
    for i, (dd, top) in enumerate(((3.4, 6.45), (1.9, 7.3), (0.5, 8.15))):
        p = TREE + Vector((math.cos(math.radians(wa + (i - 1) * 3)), math.sin(math.radians(wa + (i - 1) * 3)))) * (TERR[2][0] + dd)
        scenery += put(rock_pillar(i, top - 4.0), p.x, p.y, rnd.uniform(0, 6), 'pillar', z=4.0)
    marker('cp_terrace3', *way_point(2, -4.0))
    marker('cp_plateau', *way_point(3, -4.0))

    # the Great Tree
    gt, branches = kit.great_tree()
    tz = height(TREE.x, TREE.y)
    scenery += put(gt, TREE.x, TREE.y, 0.0, 'great_tree', z=tz)
    for i, g in enumerate(branches):
        special.append(kit.merge(place(g, TREE.x, TREE.y, z=tz), f'trace_branch{i + 1}'))
    hol = Vector((-0.95, -0.95)) * 1.05
    marker('pigment_green', TREE.x + hol.x, TREE.y + hol.y, tz + 3.4)
    marker('note_tree', TREE.x - 2.6, TREE.y - 2.6, tz + 1.2, note='tree')

    # trees: scattered through the playable area, thick along its edges
    placed = []
    def free(x, y, r):
        if path_dist(x, y) < 2.4 or (Vector((x, y)) - VILLAGE).length < 19.0 and (Vector((x, y)) - VILLAGE).length > 8:
            return False
        if abs(y - stream_y(x)) < 4.5:
            return False
        for (px, py, pr) in placed:
            if (px - x) ** 2 + (py - y) ** 2 < (pr + r) ** 2:
                return False
        return True
    for (ang, r, seed, kw) in houses:
        a = math.radians(ang)
        placed.append((math.cos(a) * r, math.sin(a) * r, 4.0))
    placed += [(0, 0, 3), (TREE.x, TREE.y, 5), (wm.x, wm.y, 4), (sh.x, sh.y, 3), (sp.x, sp.y, 4)]
    n = 0
    tries = 0
    while n < 170 and tries < 12000:
        tries += 1
        x, y = rnd.uniform(-55, 55), rnd.uniform(-68, 112)
        out = regions_outside(x, y)
        if out > 12 or (out < -1 and rnd.random() < 0.6):
            continue
        r = 2.2
        if not free(x, y, r):
            continue
        kind = 'pine' if out > 2 and rnd.random() < 0.6 else rnd.choice(['round', 'round', 'poplar'])
        hgt = rnd.uniform(4.5, 7.5) * (1.25 if out > 2 else 1.0)
        scenery += put(kit.tree(seed=1000 + n, height=hgt, kind=kind), x, y, rnd.uniform(0, 6.28), 'tree')
        placed.append((x, y, r))
        n += 1
    for i in range(40):
        x, y = rnd.uniform(-50, 50), rnd.uniform(-60, 105)
        if regions_outside(x, y) < 0 and free(x, y, 1.0) and path_dist(x, y) > 3:
            scenery += put(kit.rock(50 + i, rnd.uniform(0.35, 0.8)), x, y, rnd.uniform(0, 6), 'rock')
            placed.append((x, y, 1.0))

    # bake scenery into a solid batch and a walk-through batch, so the game draws few objects
    # bake scenery into a few chunks (solid and walk-through) so the game draws few objects and
    # can still skip the chunks behind the camera
    out = [ter]
    cells = {}
    for o in scenery:
        c = o.matrix_world @ Vector(o.bound_box[0]).lerp(Vector(o.bound_box[6]), 0.5)
        key = (math.floor(c.x / 60.0), math.floor(c.y / 60.0), bool(o.get('col', 1)))
        cells.setdefault(key, []).append(o)
    for (cx, cy, solid), objs in cells.items():
        ob = lib.join(objs, f"scenery{'' if solid else '_soft'}_{cx}_{cy}")
        if not solid:
            ob['col'] = 0
        bake_materials(ob)
        out.append(ob)
    return out + special


SCENERY = None
LINE_IDS = {}


def bake_materials(ob):
    """Fold an object's materials into face-corner colours (rgb = colour, a = ink line id / 255) under
    one shared material, so a whole chunk of scenery is one draw call but keeps its outlines."""
    global SCENERY
    if SCENERY is None:
        SCENERY = lib.mat('scenery', '#FFFFFF')
    me = ob.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    cols = []
    for m in me.materials:
        if m.name not in LINE_IDS:
            LINE_IDS[m.name] = 10 + len(LINE_IDS) % 190
        base = m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
        cols.append((base[0], base[1], base[2], LINE_IDS[m.name] / 255.0))
    for poly in me.polygons:
        c = cols[poly.material_index] if cols else (1, 1, 1, 1)
        for li in poly.loop_indices:
            attr.data[li].color = c
    me.color_attributes.active_color_name = 'Col'
    me.materials.clear()
    me.materials.append(SCENERY)
    for poly in me.polygons:
        poly.material_index = 0


def water_mesh():
    bm = bmesh.new()
    xs = [x * 1.0 for x in range(-62, 63)]
    rows = []
    for x in xs:
        yc = stream_y(x)
        rows.append([bm.verts.new((x, yc + o, -0.95)) for o in (-3.0, -1.5, 0.0, 1.5, 3.0)])
    for a, b in zip(rows, rows[1:]):
        for k in range(4):
            bm.faces.new([a[k], b[k], b[k + 1], a[k + 1]])
    return bm


def rock_pillar(seed, h):
    parts = kit.rock(seed + 90, 0.95)
    p = parts[0]
    p.data.transform(__import__('mathutils').Matrix.Translation((0, 0, h - 0.6)))
    col = lib.lathe('pillar', [(1.0, -2.0), (1.05, h * 0.5), (0.9, h)], kit.M('stone'), segs=9, subsurf=0)
    return [col, p]


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    objs = build()
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        bpy.context.scene.cycles.use_denoising = True
        lib.preview(out.replace('.png', '_village.png'), target=(0, 2, 0), dist=48, yaw=-160, pitch=38, size=(1400, 800), lens=35, samples=16)
        lib.preview(out.replace('.png', '_hill.png'), target=(0, 52, 6), dist=70, yaw=-200, pitch=40, size=(1400, 800), lens=35, samples=16)
        lib.preview(out.replace('.png', '_top.png'), target=(0, 20, 0), dist=150, yaw=0.01, pitch=89, size=(800, 1300), lens=35, samples=8)
    if '--export' in argv:
        lib.export_glb(os.path.join(lib.ROOT, 'src', 'assets', 'levels', 'margin_village.glb'))
