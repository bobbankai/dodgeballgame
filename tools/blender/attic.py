"""
Prologue: the attic, on a rainy night. Mum's things in boxes, her desk under the round window,
the sketchbook waiting on it. Exported to src/assets/levels/attic.glb.

Blender axes: X across the room, Y along it (the window is at +Y), Z up.

Run: blender -b -P tools/blender/attic.py [-- --preview out.png] [--export]
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import lib  # noqa: E402

PAL = {
    'floor': '#A8774E', 'floor2': '#9B6C45', 'plaster': '#E9DCC4', 'beam': '#6B4A33', 'rug': '#B9583F', 'rug2': '#E2B65A',
    'rug3': '#3F6F6A', 'card': '#C9A26B', 'card_dark': '#A9824F', 'tape': '#E8DDB5', 'trunk': '#3F6F6A', 'brass': '#C9A04A',
    'desk': '#8E6440', 'shade': '#F3D9A0', 'cloth': '#DDD3BF', 'glass': '#2E3E5C', 'frame': '#5A3B26', 'paper': '#F4EEDC',
    'book1': '#9C3D32', 'book2': '#3D6B8C', 'book3': '#D9B44A', 'book4': '#4E7A4A', 'book5': '#7A4E8A', 'jar': '#9FB7B8',
    'pencil': '#F0C431', 'sketch_cover': '#2F4F6F', 'ink_dark': '#2A2428', 'chair': '#7A5236', 'sheet': '#F2EEE6',
}
W, L, KNEE, RIDGE = 3.0, 4.2, 1.0, 3.3   # half width, half length, knee wall, ridge height


def M(name):
    return lib.mat('attic_' + name, PAL[name])


def B(name, size, loc, mat, rot=None, bevel=0.0):
    return kit.box(name, size, loc, M(mat), rot=rot, bevel=bevel)


def roof_z(x):
    """Height of the underside of the roof above a point across the room."""
    return KNEE + (RIDGE - KNEE) * (1 - abs(x) / W)


def shell():
    parts = []
    # floorboards running along the room, a little uneven
    rnd = random.Random(3)
    n = 20
    for i in range(n):
        x = -W + (i + 0.5) * (2 * W / n)
        parts.append(B('board', (2 * W / n - 0.012, 2 * L, 0.06 + rnd.uniform(0, 0.01)), (x, 0, -0.03), 'floor' if i % 3 else 'floor2'))
    # knee walls and the two sloping ceilings
    for s in (-1, 1):
        parts.append(B('knee', (0.1, 2 * L, KNEE), (s * (W + 0.05), 0, KNEE / 2), 'plaster'))
        slope = math.atan2(RIDGE - KNEE, W)
        ln = math.hypot(W, RIDGE - KNEE)
        parts.append(B('ceiling', (ln + 0.1, 2 * L, 0.08), (s * W / 2, 0, (KNEE + RIDGE) / 2 + 0.05), 'plaster',
                       rot=Matrix.Rotation(s * slope, 3, 'Y')))
    # gable ends: the north one has the round window, the south one a doorless wall
    for y in (-L, L):
        bm = bmesh.new()
        pts = [(-W, 0), (W, 0), (W, KNEE), (0, RIDGE), (-W, KNEE)]
        a = [bm.verts.new((x, y, z)) for x, z in pts]
        b = [bm.verts.new((x, y + (0.1 if y > 0 else -0.1), z)) for x, z in pts]
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
        for i in range(5):
            j = (i + 1) % 5
            bm.faces.new([a[i], b[i], b[j], a[j]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        g = lib.obj_from_bm('gable', bm, M('plaster'), smooth=False)
        if y > 0:
            # cut the round window
            cut = lib.lathe('cut', [(0.0, -0.5), (0.62, -0.5), (0.62, 0.5), (0.0, 0.5)], M('plaster'), segs=28, subsurf=0)
            cut.data.transform(Matrix.Translation((0, L + 0.05, 1.95)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
            md = g.modifiers.new('cut', 'BOOLEAN')
            md.operation = 'DIFFERENCE'
            md.object = cut
            lib.apply_modifiers(g)
            bpy.data.objects.remove(cut)
        parts.append(g)
    # rafters and collar ties
    for k in range(7):
        y = -L + 0.3 + k * (2 * L - 0.6) / 6
        for s in (-1, 1):
            slope = math.atan2(RIDGE - KNEE, W)
            ln = math.hypot(W, RIDGE - KNEE)
            parts.append(B('rafter', (ln, 0.12, 0.16), (s * W / 2, y, (KNEE + RIDGE) / 2 - 0.06), 'beam',
                           rot=Matrix.Rotation(s * slope, 3, 'Y')))
        parts.append(B('collar', (1.9, 0.1, 0.14), (0, y, roof_z(0.95) - 0.12), 'beam'))
    parts.append(B('ridge', (0.16, 2 * L, 0.2), (0, 0, RIDGE - 0.1), 'beam'))
    # round window: frame, cross bars and dark rainy glass
    frame = lib.lathe('wframe', [(0.62, -0.1), (0.7, -0.1), (0.7, 0.1), (0.62, 0.1)], M('frame'), segs=32, subsurf=0,
                      close_top=False, close_bottom=False)
    frame.data.transform(Matrix.Translation((0, L, 1.95)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    parts.append(frame)
    parts.append(B('wbar', (1.25, 0.06, 0.05), (0, L - 0.02, 1.95), 'frame'))
    parts.append(B('wbar', (0.05, 0.06, 1.25), (0, L - 0.02, 1.95), 'frame'))
    glass = lib.lathe('glass', [(0.0, 0.0), (0.63, 0.0)], M('glass'), segs=28, subsurf=0, close_bottom=False, close_top=False)
    glass.data.transform(Matrix.Translation((0, L + 0.04, 1.95)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    glass['nocol'] = 1
    parts.append(glass)
    parts.append(B('sill', (1.5, 0.3, 0.06), (0, L - 0.12, 1.22), 'frame'))
    # the hatch in the floor Ada climbed up through, with the ladder's top
    parts.append(B('hatchrim', (1.3, 0.1, 0.08), (0, -L + 0.45, 0.01), 'beam'))
    parts.append(B('hatchrim', (1.3, 0.1, 0.08), (0, -L + 1.55, 0.01), 'beam'))
    return parts


def desk_area():
    parts = []
    dx, dy = 0.0, L - 0.75
    parts.append(B('desktop', (1.6, 0.8, 0.06), (dx, dy, 0.76), 'desk', bevel=0.01))
    for sx in (-0.72, 0.72):
        for sy in (-0.34, 0.34):
            parts.append(B('deskleg', (0.06, 0.06, 0.74), (dx + sx, dy + sy, 0.37), 'desk'))
    parts.append(B('drawer', (0.5, 0.7, 0.14), (dx + 0.48, dy, 0.64), 'desk', bevel=0.01))
    parts.append(B('knob', (0.04, 0.04, 0.04), (dx + 0.48, dy - 0.37, 0.64), 'brass'))
    # the lamp: base, arm and shade
    lx, ly = dx - 0.55, dy + 0.15
    parts.append(lib.lathe('lampbase', [(0.0, 0.0), (0.11, 0.0), (0.1, 0.03), (0.03, 0.05)], M('brass'), segs=16, center=(lx, ly, 0.79), subsurf=0))
    parts.append(lib.tube('lamparm', [(lx, ly, 0.82), (lx + 0.02, ly - 0.02, 1.15), (lx + 0.16, ly - 0.08, 1.28)], [0.015] * 3, M('brass'), sides=8, subsurf=0))
    shade = lib.lathe('lampshade', [(0.05, 0.0), (0.16, -0.16), (0.17, -0.17)], M('shade'), segs=20, center=(lx + 0.2, ly - 0.1, 1.33), subsurf=0,
                      close_top=False, close_bottom=False)
    shade['emissive'] = 1
    parts.append(shade)
    # pencil jar, papers, and the sketchbook (separate: it is the thing to use)
    parts.append(lib.lathe('jar', [(0.0, 0.0), (0.06, 0.0), (0.06, 0.14)], M('jar'), segs=14, center=(dx + 0.55, dy + 0.25, 0.79), subsurf=0, close_top=False))
    rnd = random.Random(9)
    for k in range(6):
        a = k / 6 * math.tau
        base = Vector((dx + 0.55 + math.cos(a) * 0.025, dy + 0.25 + math.sin(a) * 0.025, 0.8))
        tip = base + Vector((math.cos(a) * 0.04, math.sin(a) * 0.04, 0.2 + rnd.uniform(0, 0.05)))
        parts.append(lib.tube('jarpencil', [base, tip], [0.007, 0.007], M(rnd.choice(['pencil', 'book1', 'book2', 'book4'])), sides=6, subsurf=0))
    for k in range(3):
        parts.append(B('paper', (0.3, 0.42, 0.004), (dx + 0.15 + k * 0.05, dy + 0.1 - k * 0.04, 0.792 + k * 0.004), 'paper',
                       rot=Matrix.Rotation(rnd.uniform(-0.4, 0.4), 3, 'Z')))
    # chair, pushed back from the desk
    cx, cy = dx + 0.1, dy - 0.85
    parts.append(B('seat', (0.46, 0.44, 0.05), (cx, cy, 0.46), 'chair', bevel=0.01))
    for sx in (-0.19, 0.19):
        for sy in (-0.18, 0.18):
            parts.append(B('cleg', (0.04, 0.04, 0.45), (cx + sx, cy + sy, 0.22), 'chair'))
    parts.append(B('cback', (0.46, 0.04, 0.5), (cx, cy - 0.2, 0.74), 'chair', rot=Matrix.Rotation(0.12, 3, 'X')))
    return parts


def sketchbook():
    """Mum's sketchbook, closed on the desk, with a ribbon and a label."""
    dx, dy = 0.05, L - 0.8
    parts = [B('sb_cover', (0.32, 0.42, 0.015), (dx, dy, 0.8), 'sketch_cover', rot=Matrix.Rotation(-0.15, 3, 'Z')),
             B('sb_pages', (0.3, 0.4, 0.025), (dx, dy, 0.818), 'paper', rot=Matrix.Rotation(-0.15, 3, 'Z')),
             B('sb_cover', (0.32, 0.42, 0.012), (dx, dy, 0.836), 'sketch_cover', rot=Matrix.Rotation(-0.15, 3, 'Z')),
             B('sb_label', (0.16, 0.09, 0.004), (dx, dy, 0.844), 'paper', rot=Matrix.Rotation(-0.15, 3, 'Z')),
             B('sb_ribbon', (0.02, 0.2, 0.004), (dx + 0.05, dy - 0.25, 0.81), 'book1', rot=Matrix.Rotation(-0.35, 3, 'Z'))]
    return parts


def boxes():
    parts = []
    rnd = random.Random(5)
    stacks = [(2.1, -1.6, 2), (2.25, -0.55, 1), (1.6, -2.6, 3), (2.35, 0.5, 2), (-2.2, -2.7, 1)]
    for i, (x, y, h) in enumerate(stacks):
        z = 0.0
        for k in range(h):
            sx, sy, sz = rnd.uniform(0.5, 0.7), rnd.uniform(0.45, 0.6), rnd.uniform(0.35, 0.45)
            if z + sz > roof_z(x) - 0.15:
                break
            r = Matrix.Rotation(rnd.uniform(-0.25, 0.25), 3, 'Z')
            parts.append(B('box', (sx, sy, sz), Vector((x, y, z + sz / 2)), 'card', rot=r, bevel=0.01))
            parts.append(B('tape', (0.06, sy + 0.01, 0.005), Vector((x, y, z + sz + 0.002)), 'tape', rot=r))
            # a flap left open on the top box
            if k == h - 1 and i % 2 == 0:
                parts.append(B('flap', (sx * 0.98, 0.012, sy * 0.45), r @ Vector((0, sy / 2 + sy * 0.18, 0)) + Vector((x, y, z + sz + sy * 0.15)),
                               'card_dark', rot=r @ Matrix.Rotation(-0.6, 3, 'X')))
            z += sz
    # the trunk with brass corners
    tx, ty = -2.1, -1.0
    parts.append(B('trunk', (0.9, 0.55, 0.5), (tx, ty, 0.25), 'trunk', rot=Matrix.Rotation(math.pi / 2, 3, 'Z'), bevel=0.02))
    parts.append(lib.tube('trunklid', [(tx, ty - 0.45, 0.5), (tx, ty + 0.45, 0.5)], [0.28, 0.28], M('trunk'), sides=16, squash=0.35, subsurf=0))
    for sy in (-0.42, 0.42):
        parts.append(B('trunkband', (0.6, 0.04, 0.5), (tx, ty + sy * 0.6, 0.27), 'brass', rot=Matrix.Rotation(0, 3, 'Z')))
    return parts


def shelf_and_frames():
    parts = []
    rnd = random.Random(11)
    # a low bookshelf along the left knee wall
    sx, y0, y1 = -2.75, -0.2, 1.8
    for z in (0.02, 0.42, 0.82):
        parts.append(B('shelf', (0.32, y1 - y0, 0.03), (sx, (y0 + y1) / 2, z), 'desk'))
    for y in (y0, y1):
        parts.append(B('shelfside', (0.32, 0.03, 0.84), (sx, y, 0.42), 'desk'))
    for z in (0.035, 0.435):
        y = y0 + 0.04
        while y < y1 - 0.08:
            th = rnd.uniform(0.03, 0.07)
            h = rnd.uniform(0.24, 0.34)
            lean = rnd.uniform(-0.12, 0.12) if rnd.random() < 0.2 else 0
            parts.append(B('book', (0.22, th, h), (sx + 0.02, y + th / 2, z + h / 2), rnd.choice(['book1', 'book2', 'book3', 'book4', 'book5']),
                           rot=Matrix.Rotation(lean, 3, 'X')))
            y += th + 0.005
    # the Great Tree drawing, framed, leaning against the wall
    fx, fy = -2.6, 2.6
    r = Matrix.Rotation(math.pi / 2 - 0.25, 3, 'Z') @ Matrix.Rotation(0.18, 3, 'X')
    parts.append(B('frame', (0.75, 0.05, 0.95), Vector((fx, fy, 0.48)), 'frame', rot=r))
    parts.append(B('drawing', (0.62, 0.05, 0.8), Vector((fx, fy, 0.48)) + r @ Vector((0, -0.006, 0)), 'paper', rot=r))
    # the easel with a sheet over a canvas
    ex, ey = -1.6, 1.4
    for a in (-0.25, 0.25):
        parts.append(lib.tube('easelleg', [(ex + a * 1.2, ey - 0.15, 0.0), (ex + a * 0.2, ey, 1.7)], [0.025, 0.02], M('desk'), sides=6, subsurf=0))
    parts.append(lib.tube('easelleg', [(ex, ey + 0.55, 0.0), (ex, ey + 0.02, 1.6)], [0.025, 0.02], M('desk'), sides=6, subsurf=0))
    parts.append(B('easelbar', (0.8, 0.05, 0.04), (ex, ey - 0.12, 0.62), 'desk'))
    canvas = B('canvas', (0.7, 0.06, 0.9), (ex, ey - 0.1, 1.1), 'cloth', rot=Matrix.Rotation(0.12, 3, 'X'))
    parts.append(canvas)
    sheet = lib.lathe('sheet', [(0.5, 0.0), (0.42, 0.5), (0.3, 0.9), (0.1, 1.0)], M('sheet'), segs=10, center=(ex, ey - 0.08, 0.62), depth=0.35, subsurf=1,
                      close_bottom=False)
    parts.append(sheet)
    # rocking chair
    rx, ry = 1.5, 1.2
    rr = Matrix.Rotation(-0.6, 3, 'Z')
    def at(v):
        return rr @ Vector(v) + Vector((rx, ry, 0))
    for s in (-1, 1):
        parts.append(lib.tube('rocker', [at((s * 0.25, -0.4, 0.06)), at((s * 0.25, 0.0, 0.0)), at((s * 0.25, 0.4, 0.06))], [0.025] * 3,
                              M('chair'), sides=6, subsurf=0))
        parts.append(lib.tube('rpost', [at((s * 0.25, 0.25, 0.03)), at((s * 0.25, 0.32, 1.0))], [0.025, 0.02], M('chair'), sides=6, subsurf=0))
    parts.append(B('rseat', (0.55, 0.5, 0.05), at((0, 0, 0.42)), 'chair', rot=rr))
    parts.append(B('rback', (0.55, 0.05, 0.5), at((0, 0.3, 0.75)), 'chair', rot=rr @ Matrix.Rotation(-0.2, 3, 'X')))
    parts.append(B('cushion', (0.48, 0.44, 0.08), at((0, 0, 0.48)), 'rug2', rot=rr, bevel=0.03))
    # the rug, with a border
    parts.append(B('rug', (2.0, 2.8, 0.012), (0.1, 0.3, 0.006), 'rug'))
    parts.append(B('rugin', (1.6, 2.4, 0.013), (0.1, 0.3, 0.008), 'rug2'))
    parts.append(B('rugin2', (1.3, 2.1, 0.014), (0.1, 0.3, 0.009), 'rug'))
    # the bare bulb hanging from the ridge
    parts.append(lib.tube('cord', [(0.0, 0.2, RIDGE - 0.2), (0.0, 0.2, 2.35)], [0.008, 0.008], M('ink_dark'), sides=6, subsurf=0))
    parts.append(lib.ellipsoid('bulb', (0.0, 0.2, 2.28), (0.06, 0.06, 0.08), M('shade'), segs=(12, 8)))
    return parts


def fox():
    """The little paper fox Mum folded, on top of the bookshelf."""
    parts = []
    x, y, z = -2.72, 1.3, 0.85
    def tri(a, b, c, mat):
        bm = bmesh.new()
        bm.faces.new([bm.verts.new(Vector(p) + Vector((x, y, z))) for p in (a, b, c)])
        return lib.obj_from_bm('fox', bm, M(mat), smooth=False)
    o, cr = 'book1', 'paper'
    parts.append(tri((0.0, -0.06, 0.0), (0.0, 0.06, 0.0), (0.0, 0.0, 0.07), o))
    parts.append(tri((0.0, -0.06, 0.0), (0.02, 0.0, 0.05), (0.0, 0.06, 0.0), o))
    parts.append(tri((0.0, -0.06, 0.0), (-0.02, 0.0, 0.05), (0.0, 0.06, 0.0), o))
    parts.append(tri((0.0, -0.05, 0.06), (0.025, -0.1, 0.07), (0.0, -0.04, 0.1), o))
    parts.append(tri((0.0, -0.05, 0.06), (-0.025, -0.1, 0.07), (0.0, -0.04, 0.1), o))
    parts.append(tri((0.0, -0.04, 0.1), (0.015, -0.05, 0.14), (0.0, -0.06, 0.09), cr))
    parts.append(tri((0.0, -0.04, 0.1), (-0.015, -0.05, 0.14), (0.0, -0.06, 0.09), cr))
    parts.append(tri((0.0, 0.05, 0.02), (0.0, 0.13, 0.08), (0.0, 0.08, 0.0), cr))
    return parts


def build():
    lib.reset()
    groups = {'shell': shell(), 'desk': desk_area(), 'boxes': boxes(), 'room': shelf_and_frames()}
    out = []
    for name, objs in groups.items():
        solid = [o for o in objs if not o.get('nocol')]
        soft = [o for o in objs if o.get('nocol')]
        for o in solid + soft:
            lib.apply_modifiers(o)
        ob = lib.join(solid, f'attic_{name}')
        lib.bake_materials(ob)
        out.append(ob)
        if soft:
            sf = lib.join(soft, f'attic_{name}_glass')
            sf['col'] = 0
            out.append(sf)
    sb = sketchbook()
    for o in sb:
        lib.apply_modifiers(o)
    out.append(lib.join(sb, 'sketchbook'))
    fx = fox()
    out.append(lib.join(fx, 'paper_fox'))
    for name, loc in (('spawn_attic', (0.0, -L + 1.0, 0.0)), ('lamp_light', (-0.35, L - 0.7, 1.2)), ('bulb_light', (0.0, 0.2, 2.2)),
                      ('look_window', (0.0, L - 0.4, 1.4)), ('look_drawing', (-2.3, 2.6, 0.6)), ('look_boxes', (1.6, -1.6, 0.4)),
                      ('look_fox', (-2.6, 1.3, 0.9)), ('look_easel', (-1.5, 1.2, 1.0)), ('look_book', (0.05, L - 0.8, 0.85))):
        e = bpy.data.objects.new(name, None)
        e.location = loc
        lib.link(e)
    return out


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    build()
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        lamp = bpy.data.objects.new('lamp', bpy.data.lights.new('lamp', 'POINT'))
        lamp.data.energy = 60
        lamp.location = (-0.35, L - 0.7, 1.2)
        lib.link(lamp)
        lib.preview(out.replace('.png', '_a.png'), target=(0, 0.6, 1.0), dist=3.8, yaw=0.01, pitch=10, size=(1200, 800), lens=20, samples=20)
        lib.preview(out.replace('.png', '_b.png'), target=(0, -0.6, 1.0), dist=3.4, yaw=180, pitch=10, size=(1200, 800), lens=20, samples=20)
    if '--export' in argv:
        lib.export_glb(os.path.join(lib.ROOT, 'src', 'assets', 'levels', 'attic.glb'))
