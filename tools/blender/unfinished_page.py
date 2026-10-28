"""
Chapter Three: the Unfinished Page. Blank paper in every direction, and floating on it the few
things Mum got as far as drawing: torn-off pieces of page, each a little stack of sheets with a
memory on it. The door Ada came in by; the kitchen table where they drew together; the garden
swing; Mum's corner of the studio; and the last page itself on its easel. There is nothing to
trace between them: the game draws the paths Ada makes (see src/levels/UnfinishedPage.ts), from the
markers here.

Run: blender -b -P tools/blender/unfinished_page.py [-- --preview out.png] [--export]
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import lib  # noqa: E402
from kit import box  # noqa: E402
from lib import smooth01  # noqa: E402

PAL = {
    'page': '#F3ECDD', 'page2': '#EAE1CE', 'page3': '#E2D7C1', 'tile_a': '#E9E1CF', 'tile_b': '#C9D7DA',
    'table': '#B98A5A', 'table_dark': '#8A6440', 'mug_a': '#D46A4E', 'mug_b': '#4F8FB8', 'crayon_r': '#D0503C',
    'crayon_y': '#E8C440', 'crayon_b': '#3D6B8C', 'crayon_g': '#5F8F48', 'pad': '#FAF6EA', 'grass': '#8DB867',
    'rope': '#B59A6A', 'seat': '#C4553F', 'desk': '#A27A52', 'lamp': '#3E6E66', 'shade': '#F2D486', 'jar': '#9FC4C8',
    'easel': '#B08A5F', 'canvas': '#FBF8EF', 'frame': '#7A5A3C', 'iron': '#3A3A40', 'paper_stack': '#F0EADA',
}
TERRAIN_ID = 7


def M(name):
    return lib.mat('pg_' + name, PAL[name])


# fragment: centre (x, y), top height, radius, and what is drawn on it
FRAGS = {
    'door': (Vector((0.0, 0.0)), 0.0, 6.5),
    'kitchen': (Vector((5.0, 21.0)), 0.8, 7.0),
    'garden': (Vector((-7.0, 42.0)), 1.8, 8.0),
    'studio': (Vector((5.0, 64.0)), 3.2, 7.0),
    'page': (Vector((0.0, 93.0)), 4.2, 13.0),
}
ORDER = ['door', 'kitchen', 'garden', 'studio', 'page']


def edge_r(name, th):
    c, h, r = FRAGS[name]
    return r * (1.0 + 0.09 * noise.noise(Vector((math.cos(th) * 1.3 + c.x, math.sin(th) * 1.3 + c.y, 3.0)))
                + 0.035 * math.sin(th * 7 + c.x))


def fragment(name, paint=None):
    """A torn-off piece of page: a little stack of sheets, each a touch smaller and darker than the
    one above, with a ragged edge; the top sheet is walked on and painted by `paint`."""
    c, h, r = FRAGS[name]
    parts = []
    segs, rings = 72, 9
    # the top sheet: a polar grid (so its painting can follow the memory on it)
    bm = bmesh.new()
    centre = bm.verts.new((c.x, c.y, h))
    grid = []
    for j in range(1, rings + 1):
        row = []
        for i in range(segs):
            th = 2 * math.pi * i / segs
            rr = edge_r(name, th) * j / rings
            # sheets are never quite flat: a soft cockle, and the rim curls down a little
            z = h + 0.04 * noise.noise(Vector((c.x + math.cos(th) * rr * 0.3, c.y + math.sin(th) * rr * 0.3, 1.0))) - 0.06 * (j / rings) ** 6
            row.append(bm.verts.new((c.x + math.cos(th) * rr, c.y + math.sin(th) * rr, z)))
        grid.append(row)
    for i in range(segs):
        bm.faces.new([centre, grid[0][i], grid[0][(i + 1) % segs]])
    for j in range(rings - 1):
        for i in range(segs):
            k = (i + 1) % segs
            bm.faces.new([grid[j][i], grid[j + 1][i], grid[j + 1][k], grid[j][k]])
    # the top sheet's own edge, a sheet thick
    lo = [bm.verts.new((v.co.x, v.co.y, v.co.z - 0.05)) for v in grid[-1]]
    for i in range(segs):
        k = (i + 1) % segs
        bm.faces.new([grid[-1][i], lo[i], lo[k], grid[-1][k]])
    bm.faces.new(list(reversed(lo)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    top = lib.obj_from_bm(f'frag_{name}', bm, lib.mat('pg_ground', '#FFFFFF', vcol=True), smooth=True)
    me = top.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    base = lib.srgb(PAL['page'])
    for v in me.vertices:
        p = v.co
        col = list(paint(p) if paint else base)
        # pencil grubbiness towards the torn edge
        d = (Vector((p.x, p.y)) - c).length / r
        k = 1.0 - 0.07 * smooth01(0.75, 1.0, d)
        attr.data[v.index].color = (col[0] * k, col[1] * k, col[2] * k, TERRAIN_ID / 255.0)
    me.color_attributes.active_color_name = 'Col'
    parts.append(top)
    # sheets below, each smaller, ragged differently, slightly turned
    rnd = random.Random(hash(name) & 0xffff)
    for k in range(1, 5):
        bm = bmesh.new()
        shrink = 1.0 - 0.055 * k - rnd.uniform(0, 0.03)
        turn = rnd.uniform(-0.12, 0.12)
        z1 = h - 0.05 - 0.09 * (k - 1)
        z0 = z1 - 0.08
        up, dn = [], []
        for i in range(segs):
            th = 2 * math.pi * i / segs
            rr = edge_r(name, th + turn) * shrink * (1 + 0.025 * math.sin(th * 13 + k * 2.1))
            up.append(bm.verts.new((c.x + math.cos(th) * rr, c.y + math.sin(th) * rr, z1)))
            dn.append(bm.verts.new((c.x + math.cos(th) * rr, c.y + math.sin(th) * rr, z0)))
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new([up[i], dn[i], dn[j], up[j]])
        bm.faces.new(up)
        bm.faces.new(list(reversed(dn)))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        parts.append(lib.obj_from_bm('sheet', bm, M(('page2', 'page3')[k % 2]), smooth=False))
    return top, parts[1:]


def put(objs, frag, dx, dy, rot=0.0, scale=1.0, dz=0.0):
    c, h, r = FRAGS[frag]
    kit.transform(objs, (c.x + dx, c.y + dy, h + dz), rot, scale)
    return objs


def marker(name, x, y, z, **props):
    e = bpy.data.objects.new(name, None)
    e.location = (x, y, z)
    for k, v in props.items():
        e[k] = v
    lib.link(e)
    return e


# --- the memories ------------------------------------------------------------------------------

def kitchen():
    parts = [box('tabletop', (1.7, 1.0, 0.07), (0, 0, 0.76), M('table'), bevel=0.015)]
    for x in (-0.75, 0.75):
        for y in (-0.42, 0.42):
            parts.append(lib.tube('tableleg', [(x, y, 0.0), (x, y, 0.73)], [0.04, 0.035], M('table_dark'), sides=8, subsurf=0))
    for s in (-1, 1):
        cx = s * 1.15
        parts.append(box('chairseat', (0.46, 0.46, 0.05), (cx, 0, 0.46), M('table'), bevel=0.01))
        for x in (-0.19, 0.19):
            for y in (-0.19, 0.19):
                parts.append(lib.tube('chairleg', [(cx + x, y, 0), (cx + x, y, 0.44)], [0.025, 0.022], M('table_dark'), sides=6, subsurf=0))
        bx = cx + s * 0.21
        for y in (-0.19, 0.19):
            parts.append(lib.tube('chairpost', [(bx, y, 0.46), (bx, y, 1.0)], [0.022, 0.02], M('table_dark'), sides=6, subsurf=0))
        parts.append(box('chairback', (0.05, 0.44, 0.22), (bx, 0, 0.86), M('table')))
    # two mugs (a big one and a small one), a sketchpad between them, crayons spilling out
    for (x, y, mat, sc) in ((-0.5, 0.18, 'mug_a', 1.0), (0.42, -0.2, 'mug_b', 0.8)):
        parts.append(lib.lathe('mug', [(0.0, 0.0), (0.055 * sc, 0.0), (0.058 * sc, 0.11 * sc), (0.052 * sc, 0.115 * sc)], M(mat), segs=16,
                               center=(x, y, 0.795), subsurf=0, close_top=False))
        parts.append(lib.tube('handle', [(x + 0.055 * sc, y, 0.82 + 0.02 * sc), (x + 0.095 * sc, y, 0.85 * 1.0), (x + 0.055 * sc, y, 0.88 + 0.01 * sc)],
                              [0.01 * sc] * 3, M(mat), sides=6, subsurf=0))
    parts.append(box('pad', (0.5, 0.36, 0.02), (0.02, 0.05, 0.805), M('pad'), rot=Matrix.Rotation(0.12, 3, 'Z')))
    parts.append(box('pad2', (0.34, 0.25, 0.015), (-0.2, -0.22, 0.802), M('pad'), rot=Matrix.Rotation(-0.3, 3, 'Z')))
    rnd = random.Random(4)
    for k, mat in enumerate(('crayon_r', 'crayon_y', 'crayon_b', 'crayon_g', 'crayon_r')):
        a = rnd.uniform(0, math.tau)
        p = Vector((0.35 + rnd.uniform(-0.12, 0.12), 0.2 + rnd.uniform(-0.1, 0.1), 0.81))
        d = Vector((math.cos(a), math.sin(a), 0)) * 0.05
        parts.append(lib.tube('crayon', [p - d, p + d], [0.009, 0.009], M(mat), sides=6, subsurf=0))
    for o in parts:
        o['col'] = 1
    return parts


def swing_tree():
    parts = kit.tree(77, 5.4, 'round')
    # a branch reaching out, two ropes down to a painted seat
    parts.append(lib.tube('branch', [(0.1, 0, 2.9), (1.0, 0.0, 3.25), (2.0, 0.1, 3.4)], [0.13, 0.1, 0.07], kit.M('bark'), sides=8, subsurf=0))
    for y in (-0.28, 0.28):
        parts.append(lib.tube('swingrope', [(1.55, y, 3.35), (1.55, y, 0.5)], [0.016, 0.016], M('rope'), sides=6, subsurf=0))
    parts.append(box('swingseat', (0.32, 0.72, 0.05), (1.55, 0.0, 0.47), M('seat'), bevel=0.01))
    for o in parts[-3:]:
        o['col'] = 0
    return parts


def flowers(rnd, n, radius):
    parts = []
    for k in range(n):
        a = rnd.uniform(0, math.tau)
        r = math.sqrt(rnd.uniform(0.05, 1.0)) * radius
        x, y = math.cos(a) * r, math.sin(a) * r
        h = rnd.uniform(0.18, 0.34)
        mat = rnd.choice(('flower_red', 'flower_pink', 'flower_yellow', 'flower_white'))
        parts.append(lib.tube('stem', [(x, y, 0), (x + rnd.uniform(-0.03, 0.03), y, h)], [0.008, 0.006], kit.M('leaf2'), sides=4, subsurf=0))
        parts.append(lib.ellipsoid('bloom', (x, y, h + 0.02), (0.045, 0.045, 0.025), kit.M(mat), segs=(8, 5)))
    for o in parts:
        o['col'] = 0
    return parts


def studio():
    parts = [box('desktop', (1.6, 0.75, 0.06), (0, 0, 0.78), M('desk'), bevel=0.012)]
    for x in (-0.74, 0.74):
        parts.append(box('deskside', (0.06, 0.7, 0.75), (x, 0, 0.375), M('desk')))
    parts.append(box('drawers', (0.5, 0.66, 0.5), (0.47, 0, 0.5), M('desk'), bevel=0.008))
    for z in (0.38, 0.6):
        parts.append(box('knob', (0.06, 0.03, 0.03), (0.47, -0.345, z), M('iron')))
    # desk lamp
    parts.append(lib.lathe('lampbase', [(0.0, 0.0), (0.1, 0.0), (0.09, 0.03), (0.0, 0.035)], M('lamp'), segs=16, center=(-0.55, 0.15, 0.81), subsurf=0))
    parts.append(lib.tube('lamparm', [(-0.55, 0.15, 0.84), (-0.5, 0.1, 1.2), (-0.32, -0.02, 1.38)], [0.014, 0.014, 0.014], M('lamp'), sides=6, subsurf=0))
    parts.append(lib.lathe('lampshade', [(0.03, 0.0), (0.06, -0.04), (0.12, -0.16)], M('lamp'), segs=16, center=(-0.28, -0.05, 1.42), subsurf=0,
                           close_top=False, close_bottom=False))
    # jars of pencils and brushes, paper in stacks, a drawing pinned at an angle
    rnd = random.Random(9)
    for (x, y) in ((-0.25, 0.22), (0.05, 0.25)):
        parts.append(lib.lathe('jar', [(0.0, 0.0), (0.06, 0.0), (0.065, 0.14), (0.058, 0.16)], M('jar'), segs=14, center=(x, y, 0.81), subsurf=0,
                               close_top=False))
        for k in range(6):
            a = rnd.uniform(0, math.tau)
            tip = Vector((x + math.cos(a) * 0.08, y + math.sin(a) * 0.08, 1.12 + rnd.uniform(-0.04, 0.05)))
            mat = rnd.choice(('crayon_r', 'crayon_y', 'crayon_b', 'crayon_g', 'table_dark'))
            parts.append(lib.tube('pencil', [Vector((x, y, 0.83)), tip], [0.007, 0.006], M(mat), sides=6, subsurf=0))
    for k in range(5):
        parts.append(box('paper', (0.42, 0.3, 0.012), (0.3 + rnd.uniform(-0.02, 0.02), 0.08 + rnd.uniform(-0.02, 0.02), 0.82 + k * 0.012), M('paper_stack'),
                         rot=Matrix.Rotation(rnd.uniform(-0.15, 0.15), 3, 'Z')))
    parts.append(box('sketch', (0.4, 0.3, 0.008), (-0.05, -0.12, 0.815), M('pad'), rot=Matrix.Rotation(0.3, 3, 'Z')))
    # her stool
    parts.append(lib.lathe('stool', [(0.0, 0.62), (0.2, 0.62), (0.19, 0.67), (0.0, 0.67)], M('table'), segs=16, center=(-0.1, -0.7, 0), subsurf=0))
    for k in range(3):
        a = k / 3 * math.tau + 0.3
        parts.append(lib.tube('stoolleg', [(-0.1 + math.cos(a) * 0.12, -0.7 + math.sin(a) * 0.12, 0.62), (-0.1 + math.cos(a) * 0.2, -0.7 + math.sin(a) * 0.2, 0)],
                              [0.02, 0.018], M('table_dark'), sides=6, subsurf=0))
    return parts


def window_frame():
    """The attic window, standing on its own, with the rain drawn on it."""
    parts = []
    for x in (-0.6, 0.6):
        parts.append(box('wframe', (0.1, 0.12, 1.6), (x, 0, 1.6), M('frame')))
    for z in (0.8, 2.4):
        parts.append(box('wframe', (1.3, 0.12, 0.1), (0, 0, z), M('frame')))
    parts.append(box('wbar', (0.05, 0.08, 1.5), (0, 0, 1.6), M('frame')))
    parts.append(box('wbar', (1.2, 0.08, 0.05), (0, 0, 1.6), M('frame')))
    parts.append(box('wsill', (1.5, 0.3, 0.06), (0, -0.08, 0.77), M('frame')))
    rnd = random.Random(3)
    for k in range(9):
        x, z = rnd.uniform(-0.5, 0.5), rnd.uniform(0.95, 2.3)
        parts.append(lib.tube('raindrop', [(x, -0.03, z), (x - 0.03, -0.03, z - 0.14)], [0.006, 0.004], M('jar'), sides=4, subsurf=0))
    return parts


def easel():
    parts = []
    # three legs, a ledge for the canvas and a crossbar
    for x in (-0.7, 0.7):
        parts.append(lib.tube('easelleg', [(x * 0.6, 0.15, 3.0), (x, -0.05, 0.0)], [0.045, 0.05], M('easel'), sides=8, subsurf=0))
    parts.append(lib.tube('easelleg', [(0, 0.2, 2.9), (0, 1.1, 0.0)], [0.045, 0.05], M('easel'), sides=8, subsurf=0))
    parts.append(box('ledge', (1.9, 0.18, 0.06), (0, -0.12, 0.85), M('easel'), bevel=0.01))
    parts.append(box('crossbar', (0.9, 0.08, 0.08), (0, 0.13, 2.95), M('easel')))
    # the last page itself: blank, propped on the ledge, leaning back a little
    tilt = Matrix.Rotation(math.radians(-6), 3, 'X')
    parts.append(box('lastpage_back', (1.8, 0.05, 1.35), tilt @ Vector((0, 0.0, 0.69)) + Vector((0, -0.08, 0.88)), M('frame'), rot=tilt))
    return parts


def build():
    lib.reset()
    rnd = random.Random(7)
    out, solid, soft = [], [], []

    def paint_kitchen(p):
        c = FRAGS['kitchen'][0]
        q = Vector((p.x, p.y)) - c
        # the round rag rug under the table: a soft blue wash with a darker border
        e = math.hypot(q.x / 2.6, q.y / 2.1)
        rug = smooth01(1.08, 0.96, e)
        border = smooth01(0.78, 0.86, e) * rug
        a, b, d = lib.srgb(PAL['page']), lib.srgb(PAL['tile_b']), lib.srgb(PAL['mug_b'])
        col = [x + (y - x) * rug for x, y in zip(a, b)]
        return [x + (y - x) * border * 0.55 for x, y in zip(col, d)]

    def paint_garden(p):
        c = FRAGS['garden'][0]
        q = Vector((p.x, p.y)) - c
        n = noise.noise(Vector((p.x * 0.5, p.y * 0.5, 2.0)))
        g = smooth01(7.0, 5.0, q.length + n * 1.2)
        a, b = lib.srgb(PAL['page']), lib.srgb(PAL['grass'])
        return [x + (y - x) * g for x, y in zip(a, b)]

    paints = {'kitchen': paint_kitchen, 'garden': paint_garden}
    for name in ORDER:
        top, sheets = fragment(name, paints.get(name))
        out.append(top)
        solid += sheets
        c, h, r = FRAGS[name]
        marker(f'cp_{name}', c.x, c.y - r * 0.35, h)

    # the door Ada comes in by (the one pencilled on the last page in the attic)
    solid += put(kit.door_frame(), 'door', 0.0, -2.0, math.pi)
    marker('spawn_door', 0.0, -0.6, 0.0)
    marker('pip_door', 1.4, 0.2, 0.0)

    # the kitchen table; the garden swing and flowers; the studio corner and its window
    solid += put(kitchen(), 'kitchen', 0.6, 0.6, 0.35)
    marker('note_kitchen', 5.6 + 0.0, 21.6, 0.8 + 0.95)
    g = put(swing_tree(), 'garden', -1.5, 0.5, 0.5)
    solid += [o for o in g if o.get('col', 1)]
    soft += [o for o in g if not o.get('col', 1)]
    soft += put(flowers(rnd, 46, 5.5), 'garden', 0, 0)
    for k in range(5):
        a = rnd.uniform(0, math.tau)
        soft += put(kit.tuft(200 + k, 'leaf3'), 'garden', math.cos(a) * 3, math.sin(a) * 3)
    marker('note_garden', -7.0 + 1.0, 42.0 - 1.4, 1.8 + 1.0)
    solid += put(studio(), 'studio', -0.8, 1.2, 0.2)
    solid += put(window_frame(), 'studio', 2.4, 2.8, -0.5)
    marker('note_studio', 5.0 - 0.4, 64.0 + 0.4, 3.2 + 1.1)
    marker('studio_view', 5.0 - 1.0, 64.0 - 2.0, 3.2)

    # the last page, on its easel in the middle of the biggest piece
    page_c, page_h, _ = FRAGS['page']
    solid += put(easel(), 'page', 0.0, 3.0)
    # the front face of the blank board (where the game puts the drawing), and its lean
    tilt = math.radians(-6)
    R = Matrix.Rotation(tilt, 3, 'X')
    back = R @ Vector((0, 0, 0.69)) + Vector((page_c.x, page_c.y + 3.0 - 0.08, page_h + 0.88))
    front = back + R @ Vector((0, -0.027, 0))
    marker('canvas', front.x, front.y, front.z, w=1.7, h=1.25, tilt=tilt)
    marker('ada_draw', page_c.x, page_c.y + 1.7, page_h)
    marker('mum_spot', page_c.x + 0.2, page_c.y - 2.4, page_h)
    marker('hug_spot', page_c.x - 0.1, page_c.y - 3.6, page_h)
    marker('smudge_spawn', page_c.x, page_c.y - 0.5, page_h)

    # where Ada can draw a path, and where each path lands
    for i in range(len(ORDER) - 1):
        a, b = ORDER[i], ORDER[i + 1]
        ca, ha, ra = FRAGS[a]
        cb, hb, rb = FRAGS[b]
        d = (cb - ca).normalized()
        pa = ca + d * (ra * 0.78)
        pb = cb - d * (rb * 0.78)
        marker(f'path{i + 1}_a', pa.x, pa.y, ha)
        marker(f'path{i + 1}_b', pb.x, pb.y, hb)

    # a few loose marks drifting on the blank page: unfinished lines, a crossed-out sketch
    for k in range(14):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(30, 70)
        x, y = math.cos(a) * r, 46 + math.sin(a) * r * 1.4
        z = rnd.uniform(-6, 10)
        pts = [(x + rnd.uniform(-2, 2), y + rnd.uniform(-2, 2), z + rnd.uniform(-1, 1)) for _ in range(4)]
        soft.append(lib.tube('mark', pts, [0.05, 0.07, 0.06, 0.03], kit.M('iron'), sides=5, subsurf=0))

    cells = {}
    for o in solid + soft:
        lib.apply_modifiers(o)
        cc = o.matrix_world @ Vector(o.bound_box[0]).lerp(Vector(o.bound_box[6]), 0.5)
        key = (math.floor(cc.x / 60.0), math.floor(cc.y / 60.0), bool(o.get('col', 1)) and o in solid)
        cells.setdefault(key, []).append(o)
    for (cx, cy, is_solid), objs in cells.items():
        ob = lib.join(objs, f"scenery{'' if is_solid else '_soft'}_{cx}_{cy}")
        if not is_solid:
            ob['col'] = 0
        lib.bake_materials(ob)
        out.append(ob)
    return out


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    build()
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        lib.preview(out.replace('.png', '_top.png'), target=(0, 46, 0), dist=150, yaw=0.01, pitch=89, size=(700, 1300), lens=35, samples=8)
        for n in ('kitchen', 'garden', 'studio', 'page'):
            c, h, r = FRAGS[n]
            lib.preview(out.replace('.png', f'_{n}.png'), target=(c.x, c.y, h + 1.0), dist=r * 1.6, yaw=200, pitch=24, size=(900, 600), lens=35, samples=12)
    if '--export' in argv:
        lib.export_glb(os.path.join(lib.ROOT, 'src', 'assets', 'levels', 'unfinished_page.glb'))
