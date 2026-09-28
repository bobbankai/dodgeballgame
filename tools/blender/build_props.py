"""
Arena prop kit, modelled procedurally in Blender and exported as one GLB (src/assets/models/props.glb).

Each prop is a root object named after it, modelled in metres with its origin on the floor (or on
the wall for wall-mounted pieces) and facing Blender -Y, which becomes three.js +Z after the glTF
Y-up conversion. Edges are bevelled, and ambient occlusion is baked into vertex colours with
Cycles so creases and contact areas read without any runtime cost.

Props: hoop, ball_cart (with ball_slot_* empties for the game's real balls), cooler, cone,
mat_stack, bench, double_door; street: van, streetlight, wheelie_bin, pallet_stack, rollup_door, container.

Run: blender -b -P tools/blender/build_props.py
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

OUT = os.path.join(lib.ROOT, 'src', 'assets', 'models', 'props.glb')
MATS = {}


def mat(name, color, rough=0.6, metal=0.0, emission=None, strength=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emission:
        p.inputs['Emission Color'].default_value = (*emission, 1)
        p.inputs['Emission Strength'].default_value = strength
    MATS[name] = m
    return m


def srgb(h):
    """#rrggbb → linear RGB."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def link(ob, parent=None):
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def from_bmesh(name, bm, material, parent=None, bevel=0.0, segments=2, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), parent)
    me.materials.append(material)
    if bevel > 0:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(40)
        mod.harden_normals = False
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
        if bevel > 0 or True:
            mod = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
            mod.keep_sharp = True
    return ob


def box(name, size, loc, material, parent=None, bevel=0.01, rot=None, segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot[1], 3, rot[0]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return from_bmesh(name, bm, material, parent, bevel=bevel, segments=segments)


def tubes(name, polylines, radius, material, parent=None, sides=6):
    """Many thin round wires as one mesh (nets, baskets): one curve spline per polyline."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = max(1, sides // 4 - 1)
    cu.use_fill_caps = False
    for pts in polylines:
        sp = cu.splines.new('POLY')
        sp.points.add(len(pts) - 1)
        for p, c in zip(sp.points, pts):
            p.co = (*c, 1)
    ob = link(bpy.data.objects.new(name + '_c', cu))
    ob.data.materials.append(material)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.active_object
    ob.name = name
    ob.select_set(False)
    if parent:
        ob.parent = parent
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def tube(name, pts, radius, material, parent=None, sides=12):
    """Round tube through points (bent frames, rails)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = max(2, sides // 4)
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (*c, 1)
    ob = link(bpy.data.objects.new(name + '_c', cu))
    ob.data.materials.append(material)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.active_object
    ob.name = name
    ob.select_set(False)
    if parent:
        ob.parent = parent
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def cylinder(name, r1, r2, h, loc, material, parent=None, seg=24, bevel=0.0, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=h)
    if rot:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot[1], 3, rot[0]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return from_bmesh(name, bm, material, parent, bevel=bevel)


def torus(name, major, minor, loc, material, parent=None, rot=None, seg=(48, 12)):
    bm = bmesh.new()
    verts = []
    for i in range(seg[0]):
        a = 2 * math.pi * i / seg[0]
        row = []
        for j in range(seg[1]):
            b = 2 * math.pi * j / seg[1]
            r = major + minor * math.cos(b)
            row.append(bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b))))
        verts.append(row)
    for i in range(seg[0]):
        for j in range(seg[1]):
            bm.faces.new([verts[i][j], verts[(i + 1) % seg[0]][j], verts[(i + 1) % seg[0]][(j + 1) % seg[1]], verts[i][(j + 1) % seg[1]]])
    if rot:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot[1], 3, rot[0]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return from_bmesh(name, bm, material, parent)


def root(name):
    ob = link(bpy.data.objects.new(name, None))
    return ob


# ------------------------------------------------------------------ props
def hoop():
    """Wall-mounted hoop: origin on the wall at rim height; the board hangs 0.9 m out (-Y)."""
    r = root('hoop')
    white = mat('board_white', srgb('#f2f2ee'), 0.18, 0.0)
    frame = mat('alu', srgb('#b9bec6'), 0.32, 0.9)
    steel = mat('steel_dark', srgb('#3a3f47'), 0.45, 0.8)
    orange = mat('rim_orange', srgb('#e35b1f'), 0.35, 0.5)
    pad = mat('pad_blue', srgb('#1f3a6e'), 0.8, 0.0)
    net = mat('net', srgb('#f4f1ea'), 0.9, 0.0)
    # mount and truss
    box('mount', (0.5, 0.05, 0.4), (0, -0.025, 0.7), steel, r)
    for sx in (-0.18, 0.18):
        tube(f'arm_top{sx}', [(sx, -0.03, 0.85), (sx * 0.9, -0.88, 0.75)], 0.03, steel, r)
        tube(f'arm_diag{sx}', [(sx, -0.03, 0.5), (sx * 0.9, -0.88, 0.55)], 0.025, steel, r)
    # board: panel, frame, target square, bottom pad (rim height 0 → board centre 0.4 above)
    by = -0.9
    box('board', (1.8, 0.03, 1.05), (0, by, 0.4), white, r, bevel=0.006)
    for (sx, sz, px, pz) in ((1.84, 0.04, 0, 0.4 + 0.545), (1.84, 0.04, 0, 0.4 - 0.545), (0.04, 1.13, 0.92, 0.4), (0.04, 1.13, -0.92, 0.4)):
        box('frame', (sx, 0.05, sz), (px, by, pz), frame, r, bevel=0.008)
    for (sx, sz, px, pz) in ((0.6, 0.05, 0, 0.23 + 0.45), (0.6, 0.05, 0, 0.23), (0.05, 0.45, 0.275, 0.455), (0.05, 0.45, -0.275, 0.455)):
        box('square', (sx, 0.006, sz), (px, by - 0.018, pz), orange, r, bevel=0.0)
    box('pad', (1.84, 0.09, 0.08), (0, by, 0.4 - 0.58), pad, r, bevel=0.03)
    # rim, bracket and net
    rc = by - 0.28
    torus('rim', 0.23, 0.011, (0, rc, 0), orange, r)
    box('bracket', (0.18, 0.2, 0.012), (0, by - 0.1, -0.005), orange, r, bevel=0.004)
    box('bracket_plate', (0.24, 0.02, 0.14), (0, by - 0.02, 0.0), orange, r, bevel=0.005)
    # net: a tapered lattice of cords (alternate rings offset half a segment → diamonds)
    seg, rings = 12, 6
    rows = []
    for k in range(rings + 1):
        t = k / rings
        rad = 0.225 * (1 - t) + 0.14 * t
        z = -0.42 * t
        off = (k % 2) * 0.5
        rows.append([(rad * math.cos(2 * math.pi * (i + off) / seg), rc + rad * math.sin(2 * math.pi * (i + off) / seg), z) for i in range(seg)])
    cords = []
    for k in range(rings):
        for i in range(seg):
            a = rows[k][i]
            b = rows[k + 1][i]
            c = rows[k + 1][(i - 1) % seg] if k % 2 == 0 else rows[k + 1][(i + 1) % seg]
            cords.append([a, b])
            cords.append([a, c])
    tubes('net', cords, 0.005, net, r)
    return r


def ball_cart():
    r = root('ball_cart')
    metal = mat('cart_metal', srgb('#8a9099'), 0.3, 0.85)
    rubber = mat('rubber_black', srgb('#1b1c1f'), 0.7, 0.0)
    w, d, h = 1.0, 0.6, 0.9
    # frame: two U-shaped side frames and cross rails
    for sx in (-w / 2, w / 2):
        tube('side', [(sx, -d / 2, 0.14), (sx, -d / 2, h), (sx, d / 2, h), (sx, d / 2, 0.14)], 0.013, metal, r)
    for z in (0.14, 0.35, h):
        for sy in (-d / 2, d / 2):
            tube('rail', [(-w / 2, sy, z), (w / 2, sy, z)], 0.011, metal, r)
    tube('handle', [(-w / 2, d / 2, h), (-w / 2 - 0.08, d / 2, h + 0.1), (-w / 2 - 0.08, -d / 2, h + 0.1), (-w / 2, -d / 2, h)], 0.014, metal, r)
    # wire basket floor and sides
    wires = []
    for i in range(9):
        x = -w / 2 + w * i / 8
        wires.append([(x, -d / 2, 0.35), (x, d / 2, 0.35)])
        for sy in (-d / 2, d / 2):
            wires.append([(x, sy, 0.35), (x, sy, h)])
    for j in range(5):
        y = -d / 2 + d * j / 4
        wires.append([(-w / 2, y, 0.35), (w / 2, y, 0.35)])
    tubes('basket', wires, 0.004, metal, r)
    # casters
    for sx in (-w / 2 + 0.04, w / 2 - 0.04):
        for sy in (-d / 2 + 0.04, d / 2 - 0.04):
            cylinder('fork', 0.02, 0.02, 0.06, (sx, sy, 0.1), metal, r, seg=10)
            cylinder('wheel', 0.045, 0.045, 0.03, (sx, sy, 0.05), rubber, r, seg=20, rot=('Y', math.pi / 2), bevel=0.008)
    # where the game puts real balls (r = 0.12): a 4×2 layer on the wire floor, three nested on top
    slots = [(-0.36 + (i % 4) * 0.24, -0.13 + (i // 4) * 0.26, 0.47) for i in range(8)]
    slots += [(-0.24 + i * 0.24, 0.0, 0.47 + 0.165) for i in range(3)]
    for i, p in enumerate(slots):
        e = link(bpy.data.objects.new(f'ball_slot_{i}', None), r)
        e.location = p
    return r


def cooler():
    r = root('cooler')
    orange = mat('cooler_orange', srgb('#ff7a1a'), 0.42, 0.0)
    white = mat('cooler_white', srgb('#f1efe9'), 0.35, 0.0)
    steel = mat('steel_dark', srgb('#3a3f47'), 0.45, 0.8)
    # stand
    box('stand', (0.5, 0.5, 0.5), (0, 0, 0.25), steel, r, bevel=0.02)
    cylinder('body', 0.22, 0.22, 0.46, (0, 0, 0.5 + 0.23), orange, r, seg=32, bevel=0.03)
    cylinder('band', 0.224, 0.224, 0.05, (0, 0, 0.5 + 0.12), white, r, seg=32, bevel=0.01)
    cylinder('lid', 0.215, 0.2, 0.07, (0, 0, 0.5 + 0.49), white, r, seg=32, bevel=0.02)
    tube('handle', [(-0.12, 0, 1.03), (-0.1, 0, 1.08), (0.1, 0, 1.08), (0.12, 0, 1.03)], 0.012, white, r)
    cylinder('spout', 0.03, 0.025, 0.07, (0, -0.24, 0.5 + 0.08), white, r, seg=16, rot=('X', math.pi / 2), bevel=0.005)
    box('tap', (0.05, 0.02, 0.03), (0, -0.28, 0.5 + 0.1), white, r, bevel=0.005)
    return r


def cone():
    r = root('cone')
    orange = mat('cone_orange', srgb('#ff6a1a'), 0.5, 0.0)
    white = mat('cone_white', srgb('#f4f2ec'), 0.35, 0.0)
    box('base', (0.26, 0.26, 0.025), (0, 0, 0.0125), orange, r, bevel=0.01)
    r0, r1, h, z0 = 0.1, 0.022, 0.32, 0.025
    cylinder('body', r0, r1, h, (0, 0, z0 + h / 2), orange, r, seg=24, bevel=0.004)

    def band(name, zc, bh):
        # reflective sleeve hugging the taper, a hair proud of the body
        rad = lambda z: r0 + (r1 - r0) * (z - z0) / h + 0.0025
        cylinder(name, rad(zc - bh / 2), rad(zc + bh / 2), bh, (0, 0, zc), white, r, seg=24)
    band('band1', z0 + 0.12, 0.05)
    band('band2', z0 + 0.22, 0.035)
    return r


def mat_stack():
    r = root('mat_stack')
    blue = mat('mat_blue', srgb('#2a58a8'), 0.72, 0.0)
    for i in range(4):
        # folded panels with a seam groove between sections
        z = 0.06 + i * 0.12
        dx = (i % 2) * 0.05
        for k in range(3):
            box(f'panel{i}_{k}', (0.66, 1.2, 0.115), (-0.68 + k * 0.68 + dx, 0, z), blue, r, bevel=0.03)
    return r


def bench():
    r = root('bench')
    wood = mat('bench_wood', srgb('#8a5a33'), 0.55, 0.0)
    steel = mat('steel_dark', srgb('#3a3f47'), 0.45, 0.8)
    L = 2.4
    for k in range(3):
        box(f'slat{k}', (L, 0.13, 0.035), (0, -0.145 + k * 0.145, 0.45), wood, r, bevel=0.01)
    for sx in (-L / 2 + 0.2, L / 2 - 0.2):
        tube('leg', [(sx, -0.2, 0.0), (sx, -0.2, 0.43), (sx, 0.2, 0.43), (sx, 0.2, 0.0)], 0.018, steel, r)
        tube('foot', [(sx, -0.22, 0.012), (sx, 0.22, 0.012)], 0.014, steel, r)
    return r


def double_door():
    """Steel double exit doors (2.2 x 2.4 m opening): origin on the floor at the wall face, facing -Y."""
    r = root('double_door')
    paint = mat('door_paint', srgb('#4a5b70'), 0.42, 0.08)
    steel = mat('steel_brushed', srgb('#b4b8bd'), 0.3, 0.9)
    dark = mat('steel_dark', srgb('#3a3f47'), 0.45, 0.8)
    glass = mat('glass_dark', srgb('#1a2530'), 0.06, 0.6)
    W, H, f = 2.2, 2.4, 0.09
    for sx in (-1, 1):
        box('jamb', (f, 0.12, H + f), (sx * (W / 2 + f / 2), -0.04, (H + f) / 2), dark, r, bevel=0.012)
    box('head', (W + 2 * f, 0.12, f), (0, -0.04, H + f / 2), dark, r, bevel=0.012)
    lw = W / 2 - 0.01
    for sx in (-1, 1):
        cx = sx * (lw / 2 + 0.005)
        box('leaf', (lw, 0.05, H - 0.02), (cx, -0.035, H / 2), paint, r, bevel=0.01)
        # narrow wired-glass light in a steel bead
        wx = cx - sx * 0.22
        box('bead', (0.26, 0.012, 0.78), (wx, -0.064, 1.72), dark, r, bevel=0.004)
        box('glass', (0.2, 0.012, 0.72), (wx, -0.068, 1.72), glass, r, bevel=0.0)
        # kick plate and push bar
        box('kick', (lw - 0.08, 0.006, 0.28), (cx, -0.063, 0.18), steel, r, bevel=0.002)
        bx0, bx1 = cx - sx * (lw / 2 - 0.12), cx + sx * (lw / 2 - 0.1)
        tube('push_bar', [(bx0, -0.12, 1.02), (bx1, -0.12, 1.02)], 0.022, steel, r)
        for x in (bx0, bx1):
            box('bar_mount', (0.09, 0.07, 0.1), (x, -0.095, 1.02), dark, r, bevel=0.012)
        for z in (0.25, 1.2, 2.15):
            cylinder('hinge', 0.014, 0.014, 0.1, (sx * (W / 2 - 0.004), -0.07, z), dark, r, seg=8)
    return r


# ------------------------------------------------------------------ street props
CUTTERS = []


def prism(name, profile_yz, x0, x1, material, parent=None, bevel=0.0, segments=2):
    """Extrude a (y, z) side profile across x0..x1 (vehicle bodies)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x0, y, z)) for (y, z) in profile_yz]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=Vector((x1 - x0, 0, 0)), verts=[e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return from_bmesh(name, bm, material, parent, bevel=bevel, segments=segments)


def cut(ob, cutter):
    """Boolean-subtract `cutter` before the bevel (so the cut edges get bevelled too)."""
    mod = ob.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.solver = 'EXACT'
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)


def cutter_cylinder(r, length, loc, parent):
    ob = cylinder('cutter', r, r, length, loc, mat('cutter', (1, 0, 1)), parent, seg=40, rot=('Y', math.pi / 2))
    ob.hide_render = True
    CUTTERS.append(ob)
    return ob


def van():
    """Box delivery van (Luton style), 5.3 m long, cab facing -Y."""
    r = root('van')
    paint = mat('van_white', srgb('#e8e2d4'), 0.32, 0.1)
    glass = mat('glass_dark', srgb('#1a2530'), 0.06, 0.6)
    trim = mat('plastic_dark', srgb('#1f2124'), 0.6, 0.0)
    chrome = mat('chrome', srgb('#c8ccd2'), 0.2, 1.0)
    lens = mat('lens_clear', srgb('#f4f1e8'), 0.08, 0.0)
    red = mat('lens_red', srgb('#b01a14'), 0.15, 0.0)
    rubber = mat('rubber_black', srgb('#1b1c1f'), 0.7, 0.0)
    W = 2.1
    wf, wr, wz, wrad = -1.75, 1.65, 0.38, 0.38
    # cab: side profile extruded across the width
    cab_prof = [(-2.62, 0.42), (-2.62, 1.12), (-2.45, 1.32), (-1.78, 1.45), (-1.18, 2.34), (-0.95, 2.4), (-0.88, 2.4), (-0.88, 0.42)]
    cab = prism('cab', cab_prof, -W / 2 + 0.03, W / 2 - 0.03, paint, r, bevel=0.06, segments=3)
    box_body = box('cargo', (W, 3.5, 2.33), (0, -0.88 + 1.75, 0.42 + 1.165), paint, r, bevel=0.07)
    for ob, y in ((cab, wf), (box_body, wr)):
        cut(ob, cutter_cylinder(wrad + 0.09, W + 0.4, (0, y, wz), r))
    # windscreen and side windows, a hair proud of the paint
    n = Vector((0, -(2.34 - 1.45), (-1.18 + 1.78))).normalized()
    a, b = Vector((0, -1.72, 1.53)), Vector((0, -1.24, 2.26))
    ws = bmesh.new()
    vs = [ws.verts.new(p + n * 0.012) for p in (a + Vector((-0.9, 0, 0)), a + Vector((0.9, 0, 0)), b + Vector((0.86, 0, 0)), b + Vector((-0.86, 0, 0)))]
    ws.faces.new(vs)
    from_bmesh('windscreen', ws, glass, r, smooth=False)
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.03 + 0.006)
        win = bmesh.new()
        pts = [(-1.66, 1.55), (-1.22, 2.22), (-1.0, 2.22), (-1.0, 1.55)]
        vs = [win.verts.new((x, y, z)) for (y, z) in (pts[::-1] if sx > 0 else pts)]
        win.faces.new(vs)
        from_bmesh('side_window', win, glass, r, smooth=False)
        # mirror on a stalk
        tube('mirror_arm', [(sx * 1.02, -1.7, 1.55), (sx * 1.2, -1.74, 1.62)], 0.015, trim, r)
        box('mirror', (0.06, 0.1, 0.22), (sx * 1.22, -1.74, 1.66), trim, r, bevel=0.02)
        # door seam and handle
        box('door_seam', (0.006, 0.012, 1.25), (sx * (W / 2 - 0.025), -0.98, 1.2), trim, r, bevel=0.0)
        box('door_handle', (0.02, 0.16, 0.035), (sx * (W / 2 - 0.02), -1.1, 1.38), trim, r, bevel=0.008)
        # side step under the cab
        box('step', (0.12, 0.5, 0.04), (sx * 0.98, -1.2, 0.4), trim, r, bevel=0.01)
    # front: bumper, grille, lamps
    box('bumper_f', (W + 0.04, 0.16, 0.26), (0, -2.63, 0.52), trim, r, bevel=0.04)
    box('grille', (1.2, 0.03, 0.34), (0, -2.625, 0.9), trim, r, bevel=0.01)
    for k in range(4):
        box('grille_bar', (1.14, 0.02, 0.018), (0, -2.64, 0.78 + k * 0.08), chrome, r, bevel=0.0)
    for sx in (-1, 1):
        box('headlamp', (0.3, 0.03, 0.16), (sx * 0.8, -2.625, 0.98), lens, r, bevel=0.015)
        box('indicator', (0.1, 0.03, 0.06), (sx * 0.99, -2.62, 0.84), mat('lens_amber', srgb('#e8901c'), 0.15, 0.0), r, bevel=0.01)
    # rear: bumper, doors, lamps
    box('bumper_r', (W + 0.02, 0.14, 0.2), (0, 2.66, 0.5), trim, r, bevel=0.04)
    box('door_seam_r', (0.012, 0.01, 2.1), (0, 2.625, 1.6), trim, r, bevel=0.0)
    for sx in (-1, 1):
        box('tail', (0.12, 0.03, 0.42), (sx * 0.96, 2.625, 1.05), red, r, bevel=0.01)
        box('rear_handle', (0.03, 0.03, 0.4), (sx * 0.12, 2.64, 1.5), chrome, r, bevel=0.008)
        for z in (0.95, 2.25):
            box('hinge', (0.1, 0.03, 0.06), (sx * 1.0, 2.635, z), trim, r, bevel=0.008)
    # wheels: rounded tyre, steel rim, hub
    for y in (wf, wr):
        for sx in (-1, 1):
            x = sx * (W / 2 - 0.16)
            cylinder('tyre', wrad, wrad, 0.26, (x, y, wz), rubber, r, seg=32, bevel=0.07, rot=('Y', math.pi / 2))
            cylinder('rim', 0.21, 0.21, 0.27, (x, y, wz), chrome, r, seg=24, bevel=0.02, rot=('Y', math.pi / 2))
            cylinder('hub', 0.07, 0.06, 0.29, (x, y, wz), trim, r, seg=16, rot=('Y', math.pi / 2))
    # chassis shadow gap under the body
    box('chassis', (W - 0.7, 5.0, 0.2), (0, 0, 0.34), trim, r, bevel=0.02)
    return r


def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


def streetlight():
    """US davit street light (galvanized pole, sweeping arm, cobra head): origin at the pole base,
    arm reaching out along -Y."""
    r = root('streetlight')
    galv = mat('galvanized', srgb('#a3a8ad'), 0.42, 0.85)
    dark = mat('steel_dark', srgb('#3a3f47'), 0.45, 0.8)
    concrete = mat('concrete', srgb('#8d8a84'), 0.9, 0.0)
    lamp_emit = mat('lamp_lens', srgb('#fff3dd'), 0.2, 0.0, emission=srgb('#ffd18a'), strength=3.5)
    cylinder('footing', 0.26, 0.26, 0.22, (0, 0, 0.11), concrete, r, seg=24, bevel=0.03)
    box('base_plate', (0.36, 0.36, 0.03), (0, 0, 0.235), galv, r, bevel=0.01)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cylinder('nut', 0.022, 0.022, 0.04, (sx * 0.14, sy * 0.14, 0.265), dark, r, seg=6)
    cylinder('pole', 0.11, 0.065, 7.4, (0, 0, 0.25 + 3.7), galv, r, seg=20)
    box('hand_hole', (0.1, 0.012, 0.2), (0, -0.108, 0.8), galv, r, bevel=0.01)
    # arm leaves the pole top vertically and sweeps out to ~2.4 m, rising slightly at the tip
    tube('arm', bezier((0, 0, 7.3), (0, 0, 8.1), (0, -1.0, 8.35), (0, -2.45, 8.29), 18), 0.042, galv, r)
    cylinder('collar', 0.08, 0.075, 0.16, (0, 0, 7.62), galv, r, seg=20, bevel=0.015)
    # cobra head: a flattened teardrop tilted up a few degrees, glowing lens underneath
    tilt = Matrix.Rotation(math.radians(6), 3, 'X')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=14, radius=1.0)
    for v in bm.verts:
        y = v.co.y
        taper = 0.75 + 0.25 * (-y)            # fatter at the outer (-Y) end
        v.co.x *= 0.19 * taper
        v.co.y *= 0.42
        v.co.z = max(v.co.z, -0.35) * 0.11 * taper
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=tilt, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, -2.62, 8.3)), verts=bm.verts)
    from_bmesh('head', bm, galv, r)
    lb = bmesh.new()
    bmesh.ops.create_circle(lb, cap_ends=True, segments=24, radius=1.0)
    for v in lb.verts:
        v.co.x *= 0.13
        v.co.y *= 0.3
    bmesh.ops.reverse_faces(lb, faces=lb.faces)       # face down
    bmesh.ops.rotate(lb, cent=(0, 0, 0), matrix=tilt, verts=lb.verts)
    bmesh.ops.translate(lb, vec=Vector((0, -2.66, 8.3 - 0.039)), verts=lb.verts)
    from_bmesh('lens', lb, lamp_emit, r, smooth=False)
    cylinder('photocell', 0.03, 0.03, 0.05, (0, -2.45, 8.4), dark, r, seg=12)
    return r


def wheelie_bin():
    r = root('wheelie_bin')
    green = mat('bin_green', srgb('#2e5a3a'), 0.55, 0.0)
    rubber = mat('rubber_black', srgb('#1b1c1f'), 0.7, 0.0)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        top = v.co.z > 0
        v.co.x *= 0.58 if top else 0.5
        v.co.y *= 0.72 if top else 0.6
        v.co.z = 0.99 if top else 0.06
    from_bmesh('body', bm, green, r, bevel=0.035, segments=3)
    lid = mat('bin_lid', srgb('#2a4f34'), 0.5, 0.0)
    box('lid', (0.62, 0.78, 0.05), (0, -0.01, 1.02), lid, r, bevel=0.02)
    box('lid_lip', (0.6, 0.04, 0.09), (0, -0.39, 0.98), lid, r, bevel=0.015)
    box('rim_band', (0.6, 0.74, 0.05), (0, 0, 0.93), green, r, bevel=0.02)
    tube('handle', [(-0.24, 0.39, 0.96), (-0.24, 0.43, 0.98), (0.24, 0.43, 0.98), (0.24, 0.39, 0.96)], 0.018, green, r)
    for k in (-1, 1):
        box('rib', (0.05, 0.02, 0.7), (k * 0.14, -0.325, 0.5), green, r, bevel=0.01)
    tube('axle', [(-0.26, 0.3, 0.1), (0.26, 0.3, 0.1)], 0.012, rubber, r)
    for sx in (-1, 1):
        cylinder('wheel', 0.1, 0.1, 0.05, (sx * 0.27, 0.3, 0.1), rubber, r, seg=20, bevel=0.012, rot=('Y', math.pi / 2))
    return r


def pallet_stack():
    r = root('pallet_stack')
    wood = mat('pallet_wood', srgb('#9a7a55'), 0.85, 0.0)
    rng = __import__('random').Random(7)
    z = 0.0
    for p in range(4):
        dx, dy, rz = rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), rng.uniform(-0.05, 0.05)
        parts = []
        for k in range(3):                      # bottom boards
            parts.append(((1.2, 0.1, 0.02), (0, -0.45 + k * 0.45, 0.01)))
        for i in range(3):                      # blocks
            for k in range(3):
                parts.append(((0.12, 0.1, 0.08), (-0.54 + i * 0.54, -0.45 + k * 0.45, 0.06)))
        for k in range(3):                      # stringer boards
            parts.append(((1.2, 0.1, 0.02), (0, -0.45 + k * 0.45, 0.11)))
        for i in range(7):                      # deck
            parts.append(((0.1, 1.0, 0.02), (-0.55 + i * (1.1 / 6), 0, 0.13)))
        for size, (x, y, zz) in parts:
            c, s = math.cos(rz), math.sin(rz)
            box('plank', size, (dx + x * c - y * s, dy + x * s + y * c, z + zz), wood, r, bevel=0.004, rot=('Z', rz), segments=1)
        z += 0.14
    return r


def rollup_door():
    """Ribbed steel roll-up door: origin on the floor at the wall face, facing -Y, 5 m wide."""
    r = root('rollup_door')
    steel = mat('door_steel', srgb('#5b6470'), 0.5, 0.6)
    dark = mat('steel_dark', srgb('#3a3f47'), 0.45, 0.8)
    W, H = 5.0, 4.2
    n = 18
    for k in range(n):
        box('slat', (W, 0.05, H / n - 0.012), (0, -0.06, (k + 0.5) * H / n), steel, r, bevel=0.012)
    box('bottom_bar', (W, 0.08, 0.08), (0, -0.07, 0.04), dark, r, bevel=0.015)
    box('handle', (0.3, 0.05, 0.04), (0, -0.12, 0.9), dark, r, bevel=0.01)
    for sx in (-1, 1):
        box('guide', (0.14, 0.16, H + 0.1), (sx * (W / 2 + 0.07), -0.08, (H + 0.1) / 2), dark, r, bevel=0.02)
    box('housing', (W + 0.5, 0.45, 0.5), (0, -0.22, H + 0.3), dark, r, bevel=0.04)
    return r


def corrugated(name, length, height, depth, period, M, material, parent):
    """Trapezoid-corrugated sheet: profile along u (0..length), ribs out along +w, extruded along v
    (0..height); M maps (u, w, v) into the prop's space."""
    n = max(1, round(length / period))
    p = length / n
    prof = []
    for i in range(n):
        u0 = i * p
        prof += [(u0, 0.0), (u0 + 0.18 * p, depth), (u0 + 0.5 * p, depth), (u0 + 0.68 * p, 0.0)]
    prof.append((length, 0.0))
    bm = bmesh.new()
    lo = [bm.verts.new((u, w, 0.0)) for u, w in prof]
    hi = [bm.verts.new((u, w, height)) for u, w in prof]
    for i in range(len(prof) - 1):
        bm.faces.new([lo[i], hi[i], hi[i + 1], lo[i + 1]])
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    if M.to_3x3().determinant() < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    ob = from_bmesh(name, bm, material, parent, smooth=False)
    return ob


def frame(u, w, v, origin):
    """4x4 matrix with columns u, w, v and translation origin."""
    m = Matrix.Identity(4)
    for c, vec in enumerate((u, w, v)):
        for r_ in range(3):
            m[r_][c] = vec[r_]
    m.translation = Vector(origin)
    return m


def shipping_container():
    """20 ft ISO container, 6.06 x 2.44 x 2.59 m, long axis along X, doors at +X. Origin on the floor."""
    r = root('container')
    paint = mat('container_paint', srgb('#b03a2e'), 0.55, 0.35)
    dark = mat('container_dark', srgb('#26282c'), 0.6, 0.6)
    L, W, H = 6.06, 2.44, 2.59
    t = 0.14                     # frame section
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    hl, hw = L / 2, W / 2
    inset = 0.045                # walls sit inside the frame line
    # long sides and the blind end, corrugated
    corrugated('side', L - 2 * t, H - 2 * t, 0.035, 0.28, frame(X, Y, Z, (-hl + t, hw - inset, t)), paint, r)
    corrugated('side', L - 2 * t, H - 2 * t, 0.035, 0.28, frame(-X, -Y, Z, (hl - t, -hw + inset, t)), paint, r)
    corrugated('end', W - 2 * t, H - 2 * t, 0.03, 0.3, frame(-Y, -X, Z, (-hl + inset, hw - t, t)), paint, r)
    # roof: shallow dents under the top rails
    corrugated('roof', L - 2 * t, W - 2 * t, 0.012, 0.6, frame(X, Z, -Y, (-hl + t, hw - t, H - 0.035)), paint, r)
    # frame: corner posts, top and bottom rails
    for sx in (-1, 1):
        for sy in (-1, 1):
            box('post', (t, t, H), (sx * (hl - t / 2), sy * (hw - t / 2), H / 2), paint, r, bevel=0.012)
        for z in (t / 2, H - t / 2):
            box('rail_end', (t, W, t), (sx * (hl - t / 2), 0, z), paint, r, bevel=0.012)
    for sy in (-1, 1):
        for z in (t / 2 + 0.02, H - t / 2):
            box('rail', (L, t, t * (1.4 if z < 1 else 1)), (0, sy * (hw - t / 2), z), paint, r, bevel=0.012)
    # corner castings
    for sx in (-1, 1):
        for sy in (-1, 1):
            for z in (0.06, H - 0.06):
                box('casting', (0.18, 0.165, 0.12), (sx * (hl - 0.09), sy * (hw - 0.0825), z), dark, r, bevel=0.01)
    # doors: two leaves with panel ribs, four lock bars with handles and keepers, hinges
    dx = hl - 0.02
    for side in (-1, 1):
        cy = side * (W / 4 - 0.03)
        box('door', (0.03, W / 2 - t - 0.02, H - 2 * t - 0.02), (dx, cy, H / 2), paint, r, bevel=0.008)
        for k in range(4):
            box('door_rib', (0.025, W / 2 - t - 0.12, 0.09), (dx + 0.02, cy, 0.5 + k * 0.55), paint, r, bevel=0.01)
        for bar in (-0.28, 0.28):
            y = cy + bar
            tube('lock_bar', [(dx + 0.06, y, 0.18), (dx + 0.06, y, H - 0.18)], 0.017, dark, r)
            for z in (0.2, H - 0.2):
                box('keeper', (0.06, 0.07, 0.07), (dx + 0.05, y, z), dark, r, bevel=0.01)
            box('handle', (0.035, 0.035, 0.34), (dx + 0.1, y + side * 0.07, 1.25), dark, r, bevel=0.01)
            box('handle_hub', (0.05, 0.1, 0.05), (dx + 0.075, y + side * 0.035, 1.25), dark, r, bevel=0.01)
        for z in (0.45, 1.3, 2.15):
            cylinder('hinge', 0.022, 0.022, 0.14, (dx + 0.03, side * (hw - t - 0.01), z), dark, r, seg=10)
    # forklift pockets / underside
    box('underside', (L - 0.3, W - 0.3, 0.06), (0, 0, 0.05), dark, r, bevel=0.0)
    return r


# ------------------------------------------------------------------ rooftop props
def water_tower():
    """NYC rooftop water tower: tapered wooden-stave tank bound by steel hoops, conical roof with a
    hatch, on a cross-braced steel stand with a ladder. Origin at the stand's feet."""
    r = root('water_tower')
    wood = mat('tank_wood', srgb('#6b4a35'), 0.85, 0.0)
    roofm = mat('tank_roof', srgb('#3a2a22'), 0.8, 0.0)
    steel = mat('steel_dark', srgb('#3a3f47'), 0.45, 0.8)
    legH, tH, r0, r1 = 3.6, 3.4, 2.05, 1.9
    # stand: four legs, ring beams, X bracing
    lp = 1.45
    corners = [(-lp, -lp), (lp, -lp), (lp, lp), (-lp, lp)]
    for (x, y) in corners:
        tube('leg', [(x * 1.06, y * 1.06, 0.0), (x, y, legH)], 0.07, steel, r)
        box('foot', (0.3, 0.3, 0.04), (x * 1.06, y * 1.06, 0.02), steel, r, bevel=0.01)
    for z in (1.4, legH - 0.05):
        for i in range(4):
            (xa, ya), (xb, yb) = corners[i], corners[(i + 1) % 4]
            tube('beam', [(xa, ya, z), (xb, yb, z)], 0.05 if z > 2 else 0.035, steel, r)
    for i in range(4):
        (xa, ya), (xb, yb) = corners[i], corners[(i + 1) % 4]
        for (z0, z1) in ((0.1, 1.4), (1.4, legH - 0.05)):
            tube('brace', [(xa * 1.03, ya * 1.03, z0), (xb, yb, z1)], 0.022, steel, r)
            tube('brace', [(xb * 1.03, yb * 1.03, z0), (xa, ya, z1)], 0.022, steel, r)
    box('deck', (3.4, 3.4, 0.12), (0, 0, legH + 0.06), wood, r, bevel=0.02)
    # tank: staves as shallow grooves around a tapered barrel
    bm = bmesh.new()
    seg, rings = 72, 6
    rows = []
    for k in range(rings + 1):
        t = k / rings
        rad = r0 + (r1 - r0) * t
        row = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rr = rad - (0.012 if i % 2 else 0.0)
            row.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, legH + 0.12 + t * tH)))
        rows.append(row)
    for k in range(rings):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new([rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]])
    bm.faces.new(list(reversed(rows[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    from_bmesh('tank', bm, wood, r, smooth=False)
    for k in range(6):
        t = (k + 0.5) / 6
        torus('hoop', r0 + (r1 - r0) * t + 0.012, 0.022, (0, 0, legH + 0.12 + t * tH), steel, r, seg=(64, 6))
    top = legH + 0.12 + tH
    cylinder('roof', r1 + 0.18, 0.12, 1.25, (0, 0, top + 0.62), roofm, r, seg=32)
    cylinder('finial', 0.12, 0.06, 0.25, (0, 0, top + 1.35), steel, r, seg=12)
    box('hatch', (0.5, 0.06, 0.4), (0.9, -0.55, top + 0.4), roofm, r, bevel=0.01, rot=('X', 0.8))
    # ladder from the deck to the roof edge
    for sx in (-0.2, 0.2):
        tube('ladder_rail', [(sx, -r0 - 0.12, legH + 0.1), (sx, -r1 - 0.12, top + 0.35)], 0.018, steel, r)
    for k in range(10):
        t = (k + 0.5) / 10
        y = -(r0 + (r1 - r0) * t) - 0.12
        tube('rung', [(-0.2, y, legH + 0.1 + t * (tH + 0.25)), (0.2, y, legH + 0.1 + t * (tH + 0.25))], 0.012, steel, r)
    return r


def hvac_unit():
    """Packaged rooftop HVAC unit (2.4 x 1.9 x 1.45 m) on base rails: finned coil grilles, service
    panels, guarded top fan and an intake hood. Origin on the roof, long axis along X."""
    r = root('hvac_unit')
    paint = mat('hvac_paint', srgb('#cfc7b0'), 0.5, 0.15)
    dark = mat('coil_dark', srgb('#3b3f45'), 0.55, 0.6)
    galv = mat('galvanized', srgb('#a3a8ad'), 0.42, 0.85)
    L, W, H = 2.4, 1.9, 1.45
    z0 = 0.12
    for sy in (-1, 1):
        box('rail', (L + 0.2, 0.1, 0.12), (0, sy * (W / 2 - 0.1), 0.06), galv, r, bevel=0.01)
    box('cabinet', (L, W, H), (0, 0, z0 + H / 2), paint, r, bevel=0.03)
    # coil grilles on both long sides of the condenser half (+X), fins as thin slats in a recess
    for sy in (-1, 1):
        y = sy * (W / 2 + 0.001)
        box('coil_recess', (1.0, 0.02, H - 0.35), (0.55, y, z0 + H / 2 + 0.02), dark, r, bevel=0.0)
        for k in range(14):
            box('fin', (0.98, 0.03, 0.022), (0.55, y + sy * 0.012, z0 + 0.26 + k * 0.075), galv, r, bevel=0.0)
        # service panels on the air-handler half (-X): seams and handles
        for px in (-0.95, -0.45):
            box('seam', (0.012, 0.012, H - 0.3), (px + 0.22, y, z0 + H / 2), dark, r, bevel=0.0)
            box('handle', (0.08, 0.03, 0.03), (px, y + sy * 0.015, z0 + H * 0.55), galv, r, bevel=0.005)
    # end coil on +X
    box('coil_end', (0.02, W - 0.35, H - 0.35), (L / 2 + 0.001, 0, z0 + H / 2 + 0.02), dark, r, bevel=0.0)
    # top fan with a wire guard
    fz = z0 + H
    cylinder('fan_shroud', 0.62, 0.62, 0.16, (0.55, 0, fz + 0.08), paint, r, seg=32, bevel=0.015)
    cylinder('fan_well', 0.56, 0.56, 0.02, (0.55, 0, fz + 0.155), dark, r, seg=32)
    for k in range(4):
        torus('guard', 0.15 + k * 0.13, 0.008, (0.55, 0, fz + 0.18), galv, r, seg=(40, 4))
    for a in range(4):
        ang = a * math.pi / 4
        tube('guard_bar', [(0.55 - math.cos(ang) * 0.56, -math.sin(ang) * 0.56, fz + 0.18), (0.55 + math.cos(ang) * 0.56, math.sin(ang) * 0.56, fz + 0.18)], 0.008, galv, r)
    cylinder('hub', 0.1, 0.1, 0.04, (0.55, 0, fz + 0.19), dark, r, seg=16)
    # outside-air intake hood on -X
    box('hood', (0.25, W * 0.7, 0.45), (-L / 2 - 0.12, 0, z0 + H * 0.62), paint, r, bevel=0.02, rot=('Y', -0.35))
    for k in range(4):
        box('louver', (0.02, W * 0.66, 0.035), (-L / 2 - 0.2, 0, z0 + H * 0.5 + k * 0.07), dark, r, bevel=0.0)
    # refrigerant line stubs
    for k, zz in enumerate((0.3, 0.42)):
        tube('pipe', [(-0.2 + k * 0.12, -W / 2, z0 + zz), (-0.2 + k * 0.12, -W / 2 - 0.25, z0 + zz), (-0.2 + k * 0.12, -W / 2 - 0.25, 0.02)], 0.022, dark, r)
    return r


# ------------------------------------------------------------------ stadium props
def jumbotron():
    """Centre-hung video board housing (the game mounts its live screens on the four 7.4 m faces):
    main tier with corner posts, upper and lower tiers wrapped in LED ribbons, a glowing underside,
    a top rail and rigging cables up to the roof truss. Origin at the centre of the main tier."""
    r = root('jumbotron')
    housing = mat('jumbo_housing', srgb('#16141f'), 0.4, 0.6)
    trim = mat('jumbo_trim', srgb('#2c2838'), 0.3, 0.8)
    led = mat('led_ribbon', srgb('#e8c77a'), 0.3, 0.0, emission=srgb('#c8a14a'), strength=3.0)
    steel = mat('steel_dark', srgb('#3a3f47'), 0.45, 0.8)
    box('main', (7.4, 7.4, 4.6), (0, 0, 0), housing, r, bevel=0.06)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box('post', (0.42, 0.42, 5.2), (sx * 3.72, sy * 3.72, 0), trim, r, bevel=0.12, segments=3)
    # upper tier + ribbon + crown rail
    box('upper', (6.2, 6.2, 0.9), (0, 0, 2.3 + 0.45), housing, r, bevel=0.05)
    box('ribbon_up', (6.32, 6.32, 0.34), (0, 0, 2.3 + 0.5), led, r, bevel=0.02)
    box('crown', (5.4, 5.4, 0.18), (0, 0, 3.2 + 0.09), trim, r, bevel=0.03)
    c = 2.6
    rail = [(-c, -c, 3.9), (c, -c, 3.9), (c, c, 3.9), (-c, c, 3.9), (-c, -c, 3.9)]
    tube('rail', rail, 0.03, steel, r)
    for (x, y) in [(-c, -c), (c, -c), (c, c), (-c, c), (0, -c), (0, c), (-c, 0), (c, 0)]:
        tube('stanchion', [(x, y, 3.38), (x, y, 3.9)], 0.022, steel, r)
    # lower tier + ribbon + glowing belly
    box('lower', (6.4, 6.4, 1.1), (0, 0, -2.3 - 0.55), housing, r, bevel=0.05)
    box('ribbon_low', (6.52, 6.52, 0.3), (0, 0, -2.3 - 0.5), led, r, bevel=0.02)
    box('belly', (5.0, 5.0, 0.35), (0, 0, -3.4 - 0.17), trim, r, bevel=0.05)
    box('belly_screen', (4.4, 4.4, 0.02), (0, 0, -3.4 - 0.35), led, r, bevel=0.0)
    # rigging to the truss above
    for sx in (-1, 1):
        for sy in (-1, 1):
            tube('cable', [(sx * 2.7, sy * 2.7, 3.3), (sx * 4.0, sy * 4.0, 2.8 + 3.1)], 0.028, steel, r)
    return r


# ------------------------------------------------------------------ eclipse props
def rock_mesh(name, seed, radius, subdiv, parent, material, squash=1.0, flat_top=None):
    """A sculpted crag: an icosphere pushed out by layered noise, with sedimentary strata and a few
    sheared facets, so it reads as carved stone rather than a faceted primitive."""
    from mathutils import noise
    rng = __import__('random').Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    o1 = Vector((rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50)))
    o2 = Vector((rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50)))
    cuts = []
    for _ in range(9):
        n = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1) - 0.6)).normalized()   # mostly flanks and underside
        cuts.append((n, rng.uniform(0.62, 0.84)))
    tilt = Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 1)).normalized()
    for v in bm.verts:
        d = v.co.normalized()
        big = noise.fractal(d * 1.1 + o1, 0.55, 2.0, 3, noise_basis='PERLIN_ORIGINAL')
        mid = noise.ridged_multi_fractal(d * 2.6 + o2, 0.9, 2.1, 3, 1.0, 2.0, noise_basis='PERLIN_ORIGINAL')
        r = 1.0 + 0.24 * big + 0.05 * (mid - 1.0)
        r += 0.018 * math.sin(d.dot(tilt) * 26.0)          # strata
        p = d * r
        for n, k in cuts:                                   # sheared facets
            e = p.dot(n) - k
            if e > 0:
                p -= n * e * 0.85
        p.z *= squash
        if p.z < 0:
            # floating-island profile: the underside drops away into a jagged, tapering keel
            p.z *= 1.55
            p.x *= 1 + 0.28 * p.z
            p.y *= 1 + 0.28 * p.z
        if flat_top is not None and p.z > flat_top:
            p.z = flat_top + (p.z - flat_top) * 0.12
        v.co = p * radius
    ob = from_bmesh(name, bm, material, parent)
    return ob


def crystal_cluster(name, base, direction, size, material, parent, rng):
    """Hexagonal crystals with pointed tips growing out of `base` along `direction`."""
    up = Vector((0, 0, 1))
    for i in range(3):
        d = (Vector(direction) + Vector((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4)))).normalized()
        L = size * rng.uniform(0.6, 1.0) * (1.0 if i == 0 else 0.6)
        w = L * 0.22
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=w, radius2=w, depth=L)
        tip = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=w, radius2=0.0, depth=w * 1.6)
        bmesh.ops.translate(bm, vec=Vector((0, 0, L / 2 + w * 0.8)), verts=tip['verts'])
        bmesh.ops.translate(bm, vec=Vector((0, 0, L / 2)), verts=bm.verts)
        q = up.rotation_difference(d)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector(base) - d * w, verts=bm.verts)
        from_bmesh(name, bm, material, parent, smooth=False)


def floating_rock(tag, seed, subdiv, squash, flat):
    r = root(f'rock_{tag}')
    stone = mat('eclipse_rock', srgb('#221b2e'), 0.82, 0.05)
    amber = mat('crystal_amber', srgb('#ffd9a0'), 0.25, 0.0, emission=srgb('#ffb347'), strength=4.0)
    ob = rock_mesh(f'rock_{tag}_body', seed, 1.0, subdiv, r, stone, squash=squash, flat_top=flat)
    rng = __import__('random').Random(seed * 7 + 1)
    me = ob.data
    # crystals sprout from the underside and flanks
    cand = [v.co.copy() for v in me.vertices if -0.9 < v.co.z < 0.15]
    for _ in range(4 + seed % 3):
        p = cand[rng.randrange(len(cand))]
        crystal_cluster('crystal', p, (p.normalized() + Vector((0, 0, -0.3))).normalized(), rng.uniform(0.35, 0.6), amber, r, rng)
    return r


def obelisk():
    """Carved obsidian obelisk (9.4 m) with glowing rune strips, lit collars and a prong crown."""
    r = root('obelisk')
    stone = mat('obsidian', srgb('#16121e'), 0.3, 0.3)
    glow = mat('rune_glow', srgb('#cbb8ff'), 0.3, 0.0, emission=srgb('#a78bfa'), strength=4.0)
    cylinder('plinth', 1.3, 1.22, 0.35, (0, 0, 0.175), stone, r, seg=8, bevel=0.04)
    cylinder('plinth2', 1.02, 0.96, 0.3, (0, 0, 0.5), stone, r, seg=8, bevel=0.04)
    z = 0.65
    rad = 0.74
    for k in range(4):
        h = 1.86
        r0, r1 = rad, rad - 0.07
        cylinder('shaft', r0, r1, h, (0, 0, z + h / 2), stone, r, seg=6, bevel=0.03)
        rm = (r0 + r1) / 2 * math.cos(math.pi / 6)
        for f in range(3):
            a = f * 2 * math.pi / 3 + (k % 2) * math.pi / 3     # face centres (bmesh hexagon corners sit at 30°)
            ca, sa = math.cos(a), math.sin(a)
            tx, ty = -sa, ca                                   # along the face
            for j in range(3):
                zz = z + 0.4 + j * 0.5
                ln = 0.3 if j != 1 else 0.2
                R0 = rm + 0.004
                box('rune', (0.02, 0.04, ln), (ca * R0, sa * R0, zz), glow, r, bevel=0.0, rot=('Z', a))
                # glyph ticks alternate sides; the middle glyph gets a diamond
                side = 1 if (j + f + k) % 2 else -1
                for tz in (zz + ln * 0.3, zz - ln * 0.15):
                    box('rune', (0.02, 0.1, 0.03), (ca * R0 + tx * side * 0.06, sa * R0 + ty * side * 0.06, tz), glow, r, bevel=0.0, rot=('Z', a))
                if j == 1:
                    box('rune', (0.02, 0.07, 0.07), (ca * R0 - tx * side * 0.08, sa * R0 - ty * side * 0.08, zz), glow, r, bevel=0.0, rot=('Z', a))
        z += h
        if k < 3:
            cylinder('collar', r1 - 0.02, r1 - 0.02, 0.07, (0, 0, z + 0.035), glow, r, seg=6)
            z += 0.07
        rad = r1 - 0.02
    # crown: four prongs sweeping up and in to cradle the crystal
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        c, s_ = math.cos(a), math.sin(a)
        pts = bezier((c * 0.3, s_ * 0.3, z - 0.05), (c * 0.55, s_ * 0.55, z + 0.3), (c * 0.6, s_ * 0.6, z + 0.8), (c * 0.32, s_ * 0.32, z + 1.1), 10)
        tube('prong', pts, 0.055, stone, r)
    cylinder('cap', rad, rad * 0.6, 0.18, (0, 0, z + 0.09), stone, r, seg=6, bevel=0.02)
    return r


def eclipse_crystal():
    """The floating crystal each obelisk holds: a long hexagonal bipyramid with two satellites."""
    r = root('eclipse_crystal')
    amber = mat('crystal_amber', srgb('#ffd9a0'), 0.25, 0.0, emission=srgb('#ffb347'), strength=4.0)
    for (L, w, off, tilt) in ((1.2, 0.3, (0, 0, 0), 0.0), (0.55, 0.14, (0.3, 0, -0.15), 0.5), (0.45, 0.12, (-0.26, 0.12, -0.2), -0.6)):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=6, radius1=w, radius2=w, depth=L * 0.5)
        for sgn in (1, -1):
            t = bmesh.ops.create_cone(bm, cap_ends=False, segments=6, radius1=w, radius2=0.0, depth=L * 0.25)
            if sgn < 0:
                bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, 'X'), verts=t['verts'])
            bmesh.ops.translate(bm, vec=Vector((0, 0, sgn * (L * 0.25 + L * 0.125))), verts=t['verts'])
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(tilt, 3, 'Y'), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector(off), verts=bm.verts)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        from_bmesh('crystal', bm, amber, r, smooth=False)
    return r


def island_base():
    """Craggy underside for the octagonal floating platform: unit radius, top at z = 0 (an exact
    octagon so it meets the floor), tapering to a point 1.6 below."""
    from mathutils import noise
    r = root('island_base')
    stone = mat('eclipse_rock', srgb('#221b2e'), 0.82, 0.05)
    bm = bmesh.new()
    rings, seg = 14, 64
    grid = []
    for k in range(rings + 1):
        t = k / rings
        row = []
        for i in range(seg):
            th = 2 * math.pi * i / seg
            oct_r = math.cos(math.pi / 8) / math.cos(((th + math.pi / 8) % (math.pi / 4)) - math.pi / 8)
            base = oct_r * (1 - t) ** 0.75
            d = Vector((math.cos(th), math.sin(th), -t))
            n = noise.fractal(d * 2.2 + Vector((3.1, 7.7, 1.3)), 0.6, 2.0, 4, noise_basis='PERLIN_ORIGINAL')
            amp = 0.16 * math.sin(math.pi * min(1.0, t * 1.3)) + 0.02 * t
            rr = max(0.0, base * (1 + n * amp * 1.4) + 0.03 * math.sin(t * 40 + th * 3) * t)
            row.append(bm.verts.new((math.cos(th) * rr, math.sin(th) * rr, -1.6 * t + (n * 0.06 * t if k < rings else 0.0))))
        grid.append(row)
    for k in range(rings):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new([grid[k][i], grid[k + 1][i], grid[k + 1][j], grid[k][j]])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    from_bmesh('island_base', bm, stone, r)
    return r


# ------------------------------------------------------------------ build, bake AO, export
def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def bake_ao(meshes):
    """Occlusion into a vertex colour attribute (exported as COLOR_0, multiplied into the albedo)."""
    scene = bpy.context.scene
    scene.cycles.samples = 64
    scene.world = scene.world or bpy.data.worlds.new('w')
    scene.world.light_settings.distance = 0.35
    for ob in meshes:
        me = ob.data
        if 'Col' not in me.color_attributes:
            me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
        me.color_attributes.active_color = me.color_attributes['Col']
    bpy.ops.object.select_all(action='DESELECT')
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    b = scene.render.bake
    b.target = 'VERTEX_COLORS'
    b.use_selected_to_active = False
    bpy.ops.object.bake(type='AO')
    # soften: AO multiplies the albedo in-game
    for ob in meshes:
        col = ob.data.color_attributes['Col']
        for d in col.data:
            a = d.color[0]
            v = 0.35 + 0.65 * a
            d.color = (v, v, v, 1.0)


def join_by_material(r):
    """One mesh per material under each prop root (fewer nodes and draws in the game)."""
    groups = {}
    for ob in [c for c in r.children if c.type == 'MESH']:
        groups.setdefault(ob.data.materials[0].name, []).append(ob)
    for name, obs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for ob in obs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        bpy.context.active_object.name = f'{r.name}_{name}'


# wall-mounted and floating props are baked at their real height, clear of the floor
MOUNT = {'hoop': 4.2, 'rock_a': 3.0, 'rock_b': 3.0, 'rock_c': 3.0, 'eclipse_crystal': 2.0, 'island_base': 2.2}
WALLED = {'hoop', 'rollup_door', 'double_door'}


def main():
    lib.reset_scene()
    roots = [hoop(), ball_cart(), cooler(), cone(), mat_stack(), bench(), double_door(), van(), streetlight(), wheelie_bin(), pallet_stack(), rollup_door(), shipping_container(),
             floating_rock('a', 3, 5, 0.8, 0.42), floating_rock('b', 11, 4, 0.9, 0.5), floating_rock('c', 29, 4, 0.7, 0.3), obelisk(), eclipse_crystal(), island_base(), water_tower(), hvac_unit(), jumbotron()]
    # lay props out apart so they don't occlude each other while baking
    spacing = 9.0
    for i, r in enumerate(roots):
        r.location = (i * spacing, 0, MOUNT.get(r.name, 0.0))
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o not in CUTTERS]
    for ob in meshes:
        apply_all(ob)
    for c in CUTTERS:
        bpy.data.objects.remove(c)
    # occluders for contact shadows (not exported): the floor, and a wall behind wall-mounted props
    occluders = []
    bpy.ops.mesh.primitive_plane_add(size=1, location=(len(roots) * spacing / 2, 0, 0))
    occluders.append(bpy.context.active_object)
    occluders[-1].scale = (len(roots) * spacing + 20, 40, 1)
    for i, r in enumerate(roots):
        if r.name in WALLED:
            bpy.ops.mesh.primitive_plane_add(size=8, location=(i * spacing, 0.001, 4), rotation=(math.pi / 2, 0, 0))
            occluders.append(bpy.context.active_object)
    bake_ao(meshes)
    for o in occluders:
        bpy.data.objects.remove(o)
    for r in roots:
        join_by_material(r)
        r.location = (0, 0, 0)
    for m in [m for m in bpy.data.materials if m.users == 0]:
        bpy.data.materials.remove(m)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_attributes=True,
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_materials='EXPORT',
    )
    print('wrote', os.path.relpath(OUT, lib.ROOT), os.path.getsize(OUT) // 1024, 'KB')

main()
