"""
Arena prop kit, modelled procedurally in Blender and exported as one GLB (src/assets/models/props.glb).

Each prop is a root object named after it, modelled in metres with its origin on the floor (or on
the wall for wall-mounted pieces) and facing Blender -Y, which becomes three.js +Z after the glTF
Y-up conversion. Edges are bevelled, and ambient occlusion is baked into vertex colours with
Cycles so creases and contact areas read without any runtime cost.

Props: hoop, ball_cart (with ball_slot_* empties for the game's real balls), cooler, cone,
mat_stack, bench.

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


def mat(name, color, rough=0.6, metal=0.0, emission=None):
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
        p.inputs['Emission Strength'].default_value = 1.0
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


def box(name, size, loc, material, parent=None, bevel=0.01, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot[1], 3, rot[0]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return from_bmesh(name, bm, material, parent, bevel=bevel)


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


def main():
    lib.reset_scene()
    roots = [hoop(), ball_cart(), cooler(), cone(), mat_stack(), bench()]
    # lay props out apart so they don't occlude each other while baking
    for i, r in enumerate(roots):
        r.location = (i * 4.0, 0, 0)
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for ob in meshes:
        apply_all(ob)
    # a floor for contact occlusion (not exported)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(10, 0, 0))
    floor = bpy.context.active_object
    bake_ao(meshes)
    bpy.data.objects.remove(floor)
    for r in roots:
        r.location = (0, 0, 0)
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
