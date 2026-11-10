"""Builds the three arenas of The Tenth Bell and their sky / light maps.

  /opt/bl/venv/bin/python tenthbell/tools/blender/build_stages.py [roof|gym|pit|env ...] < /dev/null

Each arena is one merged mesh. Its materials carry only a 'tb' tag (texture set, tiling, glow): the game's
material library builds them. UV set 1 is metres (tiling), UV set 2 is a light-map atlas with baked occlusion.
Blender: x across the fight line, +y away from the camera, z up. (The game sees x, z, -y.)
"""
import math
import os
import sys
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from PIL import Image
import ph
import tex
from hair import box_uv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets'))
MATS = {}
PARTS = []


def M(name, **tb):
    """material by name, created once: M('brick', t='brick_wall_006', s=0.5)"""
    if name not in MATS:
        tb.setdefault('k', 'pbr')
        col = tex.hexc(tb['c']) if 'c' in tb else (0.5, 0.5, 0.5)
        MATS[name] = tex.material(name, base=tuple(col), rough=0.6, tb=tb)
    return MATS[name]


def _obj(name, bm, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(mat)
    box_uv(me, 1.0)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    PARTS.append(o)
    return o


def box(c, size, mat, yaw=0, bevel=0.012, name='box', tilt=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel and min(size) > bevel * 4:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect='EDGES', profile=0.5)
    rot = Matrix.Rotation(math.radians(yaw), 4, 'Z')
    if tilt:
        rot = rot @ Matrix.Rotation(math.radians(tilt[1]), 4, tilt[0])
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ rot, verts=bm.verts)
    return _obj(name, bm, mat)


def cyl(base, r, h, mat, axis='Z', seg=20, r2=None, name='cyl', caps=True):
    """a cylinder (or cone to r2) from base along axis; v of the cone's own UVs is not used"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    if axis == 'X':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'), verts=bm.verts)
    elif axis == 'Y':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=base, verts=bm.verts)
    return _obj(name, bm, mat, smooth=True)


def tube(a, b, r, mat, seg=10):
    """a rod between two points"""
    a, b = Vector(a), Vector(b)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=(b - a).length)
    q = Vector((0, 0, 1)).rotation_difference(b - a)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return _obj('tube', bm, mat, smooth=True)


def quad(pts, mat, name='quad', uv=None):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    bm.faces.new(vs)
    o = _obj(name, bm, mat)
    if uv:
        for l, u in zip(o.data.uv_layers.active.data, uv):
            l.uv = u
    return o


def beam(apex, floor_c, radius, mat, seg=18):
    """a cone of light from a lamp to a disc on the floor; v runs 0 at the lamp to 1 at the floor"""
    apex, floor_c = Vector(apex), Vector(floor_c)
    bm = bmesh.new()
    top = [bm.verts.new(apex + Vector((math.cos(i / seg * math.tau) * 0.12, math.sin(i / seg * math.tau) * 0.12, 0))) for i in range(seg)]
    bot = [bm.verts.new(floor_c + Vector((math.cos(i / seg * math.tau) * radius, math.sin(i / seg * math.tau) * radius, 0))) for i in range(seg)]
    for i in range(seg):
        bm.faces.new([top[i], top[(i + 1) % seg], bot[(i + 1) % seg], bot[i]])
    bm.normal_update()
    o = _obj('beam', bm, mat, smooth=True)
    uvd = o.data.uv_layers.active.data
    for p in o.data.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            uvd[li].uv = (0.5, 0.0 if vi < seg else 1.0)
    return o


def shaft(corners, direction, length, mat):
    """sunlight through a window: the window's outline swept along the light; v 0 at the glass, 1 at the far end"""
    d = Vector(direction).normalized() * length
    bm = bmesh.new()
    a = [bm.verts.new(Vector(c)) for c in corners]
    b = [bm.verts.new(Vector(c) + d) for c in corners]
    n = len(corners)
    for i in range(n):
        bm.faces.new([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]])
    bm.normal_update()
    o = _obj('shaft', bm, mat, smooth=True)
    uvd = o.data.uv_layers.active.data
    for p in o.data.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            uvd[li].uv = (0.5, 0.0 if vi < n else 1.0)
    return o


def text(body, size, loc, mat, depth=0.03, yaw=0):
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body, cu.size, cu.extrude, cu.align_x = body, size, depth, 'CENTER'
    cu.bevel_depth = 0.008
    o = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (math.radians(90), 0, math.radians(yaw))   # upright, facing the camera (-y)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    me.transform(o.matrix_world)
    bpy.data.objects.remove(o)
    me.materials.append(mat)
    box_uv(me, 1.0)
    n = bpy.data.objects.new('text', me)
    bpy.context.scene.collection.objects.link(n)
    PARTS.append(n)
    return n


def finish(name, ao_size=2048, keep=()):
    """merge, unwrap a light-map atlas, bake occlusion, export"""
    t0 = time.time()
    parts = [o for o in PARTS if o.name not in keep]
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    arena = bpy.context.view_layer.objects.active
    arena.name = arena.data.name = name
    me = arena.data
    uv2 = me.uv_layers.new(name='Light')
    me.uv_layers.active = uv2
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002, area_weight=0.0)
    bpy.ops.object.mode_set(mode='OBJECT')
    # occlusion from short range only: corners, feet of props, under ledges (the room's own walls must not black it out)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 96
    sc.cycles.use_denoising = False
    sc.world = sc.world or bpy.data.worlds.new('w')
    sc.world.light_settings.distance = 1.4
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    img = bpy.data.images.new('ao', ao_size, ao_size, alpha=False, float_buffer=True)
    skip = []
    for slot in arena.material_slots:
        mat = slot.material
        tb = mat.get('tb', '')
        if '"beam"' in tb or '"crowd"' in tb:
            skip.append(slot.slot_index)
        nt = mat.node_tree
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        nt.nodes.active = t
    hidden = [p for p in me.polygons if p.material_index in skip]
    # light shafts and crowd cards would shade everything behind them: move them out of the way for the bake
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    moved = sorted({v for p in hidden for v in p.vertices})
    far = co.copy().reshape(-1, 3)
    far[moved, 2] -= 500
    me.vertices.foreach_set('co', far.ravel())
    me.update()
    bpy.ops.object.bake(type='AO')
    me.vertices.foreach_set('co', co)
    me.update()
    a = np.empty(ao_size * ao_size * 4, np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(ao_size, ao_size, 4)[::-1, :, 0]
    a = np.clip(0.18 + 0.82 * a ** 0.9, 0, 1)
    os.makedirs(os.path.join(ROOT, 'stages'), exist_ok=True)
    Image.fromarray((a * 255).astype(np.uint8)).save(os.path.join(ROOT, 'stages', f'{name}_ao.webp'), 'WEBP', quality=86, method=6)
    me.uv_layers.active = me.uv_layers[0]
    path = os.path.join(ROOT, 'stages', f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_extras=True, export_animations=False,
                              export_tangents=False, export_materials='EXPORT', export_image_format='NONE')
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons)
    print(f'STAGE {name}: {os.path.getsize(path) / 1e6:.2f} MB, {tris} tris, {len(arena.material_slots)} materials, {time.time() - t0:.0f}s', flush=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    PARTS.clear()


# ---------------------------------------------------------------- the rooftop
def roof():
    reset()
    floor = M('roof_floor', t='bitumen', s=0.3, g=1, r=0.95)
    conc = M('roof_concrete', t='concrete_wall_003', s=0.4)
    brick = M('roof_brick', t='brick_wall_006', s=0.45)
    steel = M('roof_steel', t='metal_plate', s=0.8, m=1, r=0.9)
    rust = M('roof_rust', t='rusty_metal_04', s=0.5, m=0.6)
    corr = M('roof_corrugated', t='corrugated_iron', s=0.5, m=0.8)
    door = M('roof_door', t='painted_metal_shutter', s=0.7, m=0.5, c='#7a8a90')
    dark = M('roof_dark', c='#0c0d10', r=0.5)
    neon = M('neon_red', c='#200406', e='#ff2a44', ei=14, noao=1)
    warm = M('lamp_warm', c='#201408', e='#ffb060', ei=22, noao=1)
    cool = M('lamp_cool', c='#081420', e='#8cc4ff', ei=22, noao=1)
    fence = M('fence', img='fence.png', s=0.5, cut=1, m=0.9, r=0.5, noao=1)
    city = M('city', c='#06070a', eimg='windows.png', s=0.07, ei=2.2, noao=1)
    quad([(-14, -9, 0), (14, -9, 0), (14, 13, 0), (-14, 13, 0)], floor, 'floor')
    # parapet with a metal cap, a fence on the back run
    for c, size in (((0, 10.2, 0.5), (27, 0.4, 1.0)), ((-13.3, 2, 0.5), (0.4, 16.8, 1.0)), ((13.3, 2, 0.5), (0.4, 16.8, 1.0))):
        box(c, size, conc, bevel=0.02)
        box((c[0], c[1], 1.03), (size[0] + 0.1, size[1] + 0.1, 0.06), steel)
    for x in np.arange(-12, 12.1, 3):
        tube((x, 10.2, 1.0), (x, 10.2, 3.3), 0.035, steel)
    tube((-12, 10.2, 3.3), (12, 10.2, 3.3), 0.03, steel)
    quad([(-12, 10.2, 1.06), (12, 10.2, 1.06), (12, 10.2, 3.3), (-12, 10.2, 3.3)], fence, 'fence', [(0, 0), (48, 0), (48, 4.5), (0, 4.5)])
    # stair head with the door down to the Pit
    box((7.6, 7.6, 1.45), (4.4, 3.4, 2.9), brick, bevel=0.02)
    box((7.6, 7.6, 2.96), (4.8, 3.8, 0.14), conc)
    box((6.9, 5.88, 1.05), (1.05, 0.08, 2.1), door)
    box((6.9, 5.86, 2.18), (1.3, 0.14, 0.08), steel)
    box((6.9, 5.7, 2.42), (0.34, 0.2, 0.12), warm, bevel=0.02)
    # water tower
    for sx in (-1, 1):
        for sy in (-1, 1):
            tube((-8.2 + sx * 1.1, 7.6 + sy * 1.1, 0), (-8.2 + sx * 0.95, 7.6 + sy * 0.95, 3.3), 0.07, rust)
    for sx in (-1, 1):
        tube((-8.2 + sx * 1.08, 7.6 - 1.08, 0.4), (-8.2 - sx * 1.0, 7.6 - 1.0, 2.9), 0.03, rust)
        tube((-8.2 + sx * 1.08, 7.6 - 1.08, 0.4), (-8.2 + sx * 1.0, 7.6 + 1.0, 2.9), 0.03, rust)
    cyl((-8.2, 7.6, 3.3), 1.55, 2.5, corr, seg=28)
    cyl((-8.2, 7.6, 5.8), 1.62, 0.75, rust, seg=28, r2=0.1)
    box((-8.2, 7.6, 3.25), (2.6, 2.6, 0.12), rust)
    for i in range(9):
        tube((-6.75, 6.4, 0.3 + i * 0.36), (-6.45, 6.4, 0.3 + i * 0.36), 0.015, steel)
    tube((-6.75, 6.4, 0), (-6.75, 6.4, 3.4), 0.02, steel)
    tube((-6.45, 6.4, 0), (-6.45, 6.4, 3.4), 0.02, steel)
    # plant: two condensers and their ducting
    for x in (-3.6, -1.6):
        box((x, 8.3, 0.62), (1.5, 1.0, 1.1), steel, bevel=0.03)
        box((x, 8.3, 0.06), (1.6, 1.1, 0.12), conc)
        cyl((x, 8.3, 1.17), 0.4, 0.05, dark, seg=24)
        for k in range(6):
            box((x, 7.79, 0.3 + k * 0.13), (1.3, 0.02, 0.05), dark, bevel=0)
    tube((-0.8, 8.3, 0.35), (5.4, 8.3, 0.35), 0.09, steel)
    tube((5.4, 8.3, 0.35), (5.4, 7.6, 0.35), 0.09, steel)
    box((2.2, 8.9, 0.45), (2.4, 0.7, 0.7), corr, bevel=0.03)
    cyl((3.9, 9.0, 0), 0.22, 1.9, steel)
    cyl((3.9, 9.0, 1.9), 0.36, 0.3, steel, r2=0.22)
    # the sign: THE PIT, and an arrow to the door
    for x in (-1.6, 2.6):
        tube((x, 5.6, 0), (x, 5.6, 3.6), 0.05, steel)
    box((0.5, 5.6, 2.75), (4.6, 0.08, 1.5), dark, bevel=0)
    text('THE PIT', 0.95, (0.25, 5.52, 2.45), neon, depth=0.02)
    for a, b in (((2.0, 5.5, 2.2), (2.5, 5.5, 2.2)), ((2.5, 5.5, 2.2), (2.5, 5.5, 2.5)), ((2.38, 5.5, 2.36), (2.5, 5.5, 2.2)), ((2.62, 5.5, 2.36), (2.5, 5.5, 2.2))):
        tube(a, b, 0.022, neon, seg=8)
    tube((-1.7, 5.5, 2.08), (1.8, 5.5, 2.08), 0.02, neon, seg=8)
    # two flood lights on poles, their cones in the rain
    for x, y, h, mat, col in ((-6.5, 3.2, 4.2, warm, '#ff9a4a'), (6.8, 2.8, 4.4, cool, '#6fb6ff')):
        tube((x, y, 0), (x, y, h), 0.06, steel)
        box((x, y, 0.03), (0.4, 0.4, 0.06), steel)
        box((x - np.sign(x) * 0.12, y - 0.1, h), (0.5, 0.3, 0.2), dark, tilt=('X', -30))
        box((x - np.sign(x) * 0.12, y - 0.22, h - 0.06), (0.4, 0.04, 0.14), mat, bevel=0, tilt=('X', -30))
        beam((x - np.sign(x) * 0.12, y - 0.2, h - 0.05), (x - np.sign(x) * 5.2, -0.5, 0.0), 3.4, M('beam_' + col, k='beam', c=col, a=0.34))
    # loose things that make a roof a roof
    for i, (x, y) in enumerate(((10.6, 6.2), (10.9, 7.3), (-11.4, 4.6))):
        box((x, y, 0.07 + (i % 2) * 0.14), (1.2, 0.9, 0.13), M('pallet', c='#5a4630', r=0.85), yaw=12 * i)
    cyl((-10.9, 8.6, 0), 0.3, 0.9, rust)
    cyl((-10.2, 9.0, 0), 0.3, 0.9, M('drum_blue', c='#1c3a5a', r=0.5, m=0.6))
    tube((9.9, 9.3, 0), (9.9, 9.3, 6.2), 0.03, steel)
    for z in (4.6, 5.2, 5.8):
        tube((9.4, 9.3, z), (10.4, 9.3, z), 0.012, steel)
    # the city beyond, sinking into the weather
    rng = np.random.default_rng(4)
    for i in range(16):
        x = -95 + i * 12.5 + rng.uniform(-3, 3)
        w, d, h = rng.uniform(9, 18), rng.uniform(9, 16), rng.uniform(8, 46)
        y = rng.uniform(34, 90)
        box((x, y, h / 2 - 18), (w, d, h + 36), city, bevel=0)
    finish('roof')


# ---------------------------------------------------------------- the gym
def gym():
    reset()
    wood = M('gym_floor', t='plank_flooring_02', s=0.42, g=1, r=0.8, sheen=0.4)
    brick = M('gym_brick', t='brick_wall_001', s=0.4)
    plaster = M('gym_plaster', t='beige_wall_001', s=0.4, c='#d8cdb8')
    steel = M('gym_steel', t='metal_plate', s=0.8, m=1, r=0.8, c='#6a6a6a')
    iron = M('gym_iron', t='rusty_metal_03', s=0.6, m=0.7, c='#5a5450')
    locker = M('gym_locker', t='blue_metal_plate', s=0.6, m=0.6)
    canvas = M('ring_canvas', t='rough_linen', s=3.0, c='#b9b4a6')
    apron = M('ring_apron', t='crepe_satin', s=3.0, c='#7a1218', sheen=0.4)
    leather = M('bag_leather', t='brown_leather', s=2.0, c='#2a1a12', r=0.7)
    red = M('pad_red', t='fabric_leather_02', s=3, c='#8a1418', r=0.7)
    blue = M('pad_blue', t='fabric_leather_02', s=3, c='#16306a', r=0.7)
    white = M('rope_white', c='#d8d2c4', r=0.7)
    dark = M('gym_dark', c='#101010', r=0.6)
    timber = M('gym_timber', t='plank_flooring_02', s=1.2, c='#8a6a4a')
    glass = M('window_glow', c='#2a1a0c', e='#ffb866', ei=9, noao=1)
    bulb = M('bulb', c='#201408', e='#ffd9a8', ei=26, noao=1)
    brass = M('brass', c='#c9a24a', m=1, r=0.28)
    quad([(-10, -8, 0), (10, -8, 0), (10, 8, 0), (-10, 8, 0)], wood, 'floor')
    box((0, 8.15, 2.3), (20.4, 0.3, 4.6), brick, bevel=0)
    box((-10.15, 0, 2.3), (0.3, 16.6, 4.6), brick, bevel=0)
    box((10.15, 0, 2.3), (0.3, 16.6, 4.6), plaster, bevel=0)
    quad([(-10, 8, 4.6), (10, 8, 4.6), (10, -8, 4.6), (-10, -8, 4.6)], M('gym_ceiling', c='#2a2622', r=0.9))
    box((0, 7.98, 0.55), (20, 0.06, 1.1), M('gym_dado', c='#3a2e26', r=0.6), bevel=0)
    for y in (-3.0, 1.5, 6.0):                      # roof steel
        box((0, y, 4.42), (20, 0.22, 0.36), iron, bevel=0.02)
    # tall windows on the left: evening comes through them in shafts
    sun = (0.75, 0.5, -0.62)
    for y in (-4.2, -0.4, 3.4):
        box((-9.97, y, 2.55), (0.06, 1.7, 2.5), glass, bevel=0)
        for k in range(4):
            box((-9.92, y - 0.85 + k * 0.567, 2.55), (0.05, 0.05, 2.5), dark, bevel=0)
        for k in range(5):
            box((-9.92, y, 1.3 + k * 0.625), (0.05, 1.7, 0.05), dark, bevel=0)
        box((-9.9, y, 1.24), (0.24, 1.9, 0.08), timber)
        shaft([(-9.9, y - 0.85, 1.3), (-9.9, y + 0.85, 1.3), (-9.9, y + 0.85, 3.8), (-9.9, y - 0.85, 3.8)], sun, 6.4, M('shaft', k='beam', c='#ffb878', a=0.3))
    for x in (-6.0, 6.0):                           # back wall windows, high up
        box((x, 7.97, 3.3), (2.6, 0.06, 1.3), glass, bevel=0)
        for k in range(5):
            box((x - 1.3 + k * 0.65, 7.93, 3.3), (0.05, 0.05, 1.3), dark, bevel=0)
    # the ring
    box((0, 4.4, 0.45), (6.4, 6.4, 0.9), apron, bevel=0.02)
    box((0, 4.4, 0.915), (6.4, 6.4, 0.03), canvas, bevel=0)
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        px, py = sx * 3.0, 4.4 + sy * 3.0
        cyl((px, py, 0.9), 0.06, 1.5, steel)
        box((px - sx * 0.12, py - sy * 0.12, 1.75), (0.26, 0.26, 1.0), (red, blue, white, white)[i], yaw=45, bevel=0.04)
    for h, m in ((1.35, red), (1.75, white), (2.15, blue)):
        for a, b in (((-3, 1.4), (3, 1.4)), ((3, 1.4), (3, 7.4)), ((3, 7.4), (-3, 7.4)), ((-3, 7.4), (-3, 1.4))):
            tube((a[0], a[1], h), (b[0], b[1], h), 0.022, m, seg=8)
    box((-3.75, 1.5, 0.3), (0.7, 0.9, 0.6), timber)
    box((-3.75, 1.05, 0.15), (0.7, 0.45, 0.3), timber)
    # heavy bags on chains
    for x, y in ((-7.0, 3.2), (-5.4, 5.0), (6.6, 2.6), (7.6, 4.6)):
        tube((x, y, 4.3), (x, y, 2.25), 0.012, steel, seg=6)
        cyl((x, y, 1.05), 0.21, 1.2, leather, seg=24)
        cyl((x, y, 2.25), 0.215, 0.04, steel, seg=24)
    # lockers, bench, a rack
    for i in range(6):
        box((9.72, -5.6 + i * 0.62, 1.0), (0.5, 0.6, 2.0), locker, bevel=0.01)
        box((9.46, -5.6 + i * 0.62 + 0.2, 1.2), (0.02, 0.03, 0.12), steel, bevel=0)
    box((8.6, -1.0, 0.45), (0.4, 2.4, 0.06), timber)
    for y in (-2.0, 0.0):
        box((8.6, y, 0.21), (0.36, 0.06, 0.42), iron)
    box((-9.6, 6.6, 0.5), (0.6, 2.2, 1.0), timber)
    # pendant lamps
    for x, y in ((-3.2, 1.5), (3.4, 1.5), (0, -3.0), (-6.5, -2.0), (6.5, -2.0)):
        tube((x, y, 4.4), (x, y, 3.55), 0.01, dark, seg=6)
        cyl((x, y, 3.3), 0.3, 0.26, dark, r2=0.07, caps=False)
        cyl((x, y, 3.28), 0.09, 0.07, bulb, seg=12)
    # posters and the board of names
    for x, w, h, c in ((-7.2, 1.0, 1.4, '#7a2a1a'), (-5.8, 0.8, 1.1, '#c8b890'), (5.2, 1.1, 1.5, '#1a2a4a'), (7.0, 0.8, 1.1, '#c8b890')):
        box((x, 7.95, 2.3), (w + 0.08, 0.03, h + 0.08), dark, bevel=0)
        box((x, 7.93, 2.3), (w, 0.02, h), M('poster_' + c, c=c, r=0.8), bevel=0)
    # the bell, ringside
    box((-3.9, 0.9, 0.62), (0.1, 0.1, 1.24), timber)
    box((-3.9, 0.84, 1.28), (0.34, 0.06, 0.34), timber)
    PARTS[-1].name = 'board'
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.12)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.001], context='VERTS')
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(-3.9, 0.8, 1.28), verts=bm.verts)
    _obj('bell', bm, brass, smooth=True)
    tube((-3.9, 0.69, 1.28), (-3.9, 0.66, 1.28), 0.02, brass, seg=10)
    finish('gym')


# ---------------------------------------------------------------- the Pit
def pit():
    reset()
    floor = M('pit_floor', t='concrete_floor_worn_001', s=0.3, g=1, r=0.95)
    wall = M('pit_wall', t='concrete_wall_001', s=0.35)
    chip = M('pit_chipped', t='chipped_concrete', s=0.4)
    steel = M('pit_steel', t='metal_plate', s=0.8, m=1, r=0.9, c='#5a5a5a')
    rust = M('pit_rust', t='rusty_metal_03', s=0.6, m=0.7)
    dark = M('pit_dark', c='#0b0b0c', r=0.6)
    fence = M('fence', img='fence.png', s=0.5, cut=1, m=0.9, r=0.5, noao=1)
    crowd = M('crowd', k='crowd', noao=1)
    banner = M('banner', img='banner.png', s=1, r=0.85, noao=1)
    lamp = M('pit_lamp', c='#101418', e='#e8f4ff', ei=26, noao=1)
    ember = M('ember', c='#200800', e='#ff7a28', ei=16, noao=1)
    quad([(-9, -8, 0), (9, -8, 0), (9, 7, 0), (-9, 7, 0)], floor, 'floor')
    # the wall round the floor, fence above it, steps for the crowd behind
    for c, size in (((0, 7.2, 0.6), (18.8, 0.4, 1.2)), ((-9.2, -0.5, 0.6), (0.4, 15, 1.2)), ((9.2, -0.5, 0.6), (0.4, 15, 1.2))):
        box(c, size, wall, bevel=0.02)
        box((c[0], c[1], 1.23), (size[0] + 0.06, size[1] + 0.06, 0.06), steel)
    for x in np.arange(-9, 9.1, 2.25):
        tube((x, 7.2, 1.2), (x, 7.2, 3.5), 0.035, steel)
    tube((-9, 7.2, 3.5), (9, 7.2, 3.5), 0.03, steel)
    quad([(-9, 7.2, 1.26), (9, 7.2, 1.26), (9, 7.2, 3.5), (-9, 7.2, 3.5)], fence, 'fence', [(0, 0), (36, 0), (36, 4.5), (0, 4.5)])
    for sx in (-1, 1):
        for y in np.arange(-7, 7.1, 2.33):
            tube((sx * 9.2, y, 1.2), (sx * 9.2, y, 3.5), 0.035, steel)
        quad([(sx * 9.2, -7.5, 1.26), (sx * 9.2, 7.2, 1.26), (sx * 9.2, 7.2, 3.5), (sx * 9.2, -7.5, 3.5)], fence, 'fence', [(0, 0), (29, 0), (29, 4.5), (0, 4.5)])
    for i in range(3):
        box((0, 8.2 + i * 1.3, 0.6 + i * 0.45), (22, 1.3, 1.2 + i * 0.9), chip, bevel=0.02)
        quad([(-10, 8.0 + i * 1.3, 1.25 + i * 0.9), (10, 8.0 + i * 1.3, 1.25 + i * 0.9), (10, 8.0 + i * 1.3, 3.2 + i * 0.9), (-10, 8.0 + i * 1.3, 3.2 + i * 0.9)],
             crowd, f'crowd{i}', [(i * 0.31, 0), (i * 0.31 + 2.2, 0), (i * 0.31 + 2.2, 1), (i * 0.31, 1)])
    for sx in (-1, 1):
        for i in range(2):
            box((sx * (10.2 + i * 1.3), 0, 0.6 + i * 0.45), (1.3, 15, 1.2 + i * 0.9), chip, bevel=0.02)
            x = sx * (10.0 + i * 1.3)
            quad([(x, -7, 1.25 + i * 0.9), (x, 7, 1.25 + i * 0.9), (x, 7, 3.2 + i * 0.9), (x, -7, 3.2 + i * 0.9)], crowd, f'crowd_s{i}',
                 [(0.5 + i * 0.4, 0), (2.1 + i * 0.4, 0), (2.1 + i * 0.4, 1), (0.5 + i * 0.4, 1)])
    # the hall: back wall, columns, a low ceiling full of pipes
    box((0, 12.6, 3.5), (26, 0.4, 7), wall, bevel=0)
    for sx in (-1, 1):
        box((sx * 13.2, 2, 3.5), (0.4, 22, 7), wall, bevel=0)
    for x, y in ((-7.0, 9.3), (7.0, 9.3), (-2.4, 11.4), (2.4, 11.4)):
        box((x, y, 3.5), (0.9, 0.9, 7), chip, bevel=0.03)
    quad([(-13, 12.6, 7), (13, 12.6, 7), (13, -9, 7), (-13, -9, 7)], M('pit_ceiling', c='#151515', r=0.9))
    for y, r in ((1.0, 0.16), (4.6, 0.11), (9.0, 0.2), (-3.0, 0.1)):
        tube((-13, y, 6.5 - r), (13, y, 6.5 - r), r, rust, seg=12)
    for x in (-8, 0, 8):
        box((x, 2, 6.8), (0.3, 20, 0.4), steel, bevel=0.02)
    # hard light over the floor
    for x, y, col in ((-4.5, -1.5, '#9fe8f0'), (4.5, -1.5, '#9fe8f0'), (0, 3.0, '#fff0dc')):
        tube((x, y, 6.6), (x, y, 5.5), 0.015, dark, seg=6)
        cyl((x, y, 5.15), 0.42, 0.36, dark, r2=0.1, caps=False)
        cyl((x, y, 5.12), 0.2, 0.06, lamp, seg=16)
        beam((x, y, 5.1), (x * 1.12, y + 0.4, 0.0), 2.7, M('pit_beam', k='beam', c='#cfe8ff', a=0.26))
    # banners with the Pit's mark, fire drums in the corners
    for x in (-4.6, 4.6):
        quad([(x - 0.9, 12.3, 2.6), (x + 0.9, 12.3, 2.6), (x + 0.9, 12.3, 6.2), (x - 0.9, 12.3, 6.2)], banner, 'banner', [(0, 0), (1, 0), (1, 1), (0, 1)])
        tube((x - 1.0, 12.3, 6.22), (x + 1.0, 12.3, 6.22), 0.03, steel)
    for x in (-7.9, 7.9):
        cyl((x, 6.2, 0), 0.32, 0.9, rust, seg=20)
        cyl((x, 6.2, 0.86), 0.27, 0.03, ember, seg=20)
    # a drain, and a ring of paint worn by years of feet
    box((0, 5.2, 0.005), (1.2, 0.5, 0.012), rust, bevel=0)
    bm = bmesh.new()
    seg = 64
    for i in range(seg):
        a0, a1 = i / seg * math.tau, (i + 1) / seg * math.tau
        vs = [bm.verts.new((math.cos(a) * r * 1.5, math.sin(a) * r - 0.2, 0.004)) for a, r in ((a0, 3.9), (a1, 3.9), (a1, 4.02), (a0, 4.02))]
        if i % 9 != 0:
            bm.faces.new(vs)
    _obj('paint', bm, M('pit_paint', c='#a8a498', r=0.8, noao=1))
    finish('pit')


# ---------------------------------------------------------------- skies and light maps
def env():
    """Image-based light as small .hdr files, and the two skies seen from the roof as pictures."""
    os.makedirs(os.path.join(ROOT, 'env'), exist_ok=True)
    for name, pid in (('roof_night', 'rooftop_night'), ('roof_dawn', 'signal_hill_sunrise'), ('gym', 'basement_boxing_ring'), ('pit', 'burnt_warehouse')):
        img = bpy.data.images.load(ph.hdri(pid, '1k'))
        img.scale(512, 256)
        img.filepath_raw = os.path.join(ROOT, 'env', name + '.hdr')
        img.file_format = 'HDR'
        img.save()
        print('env', name, flush=True)
    for name, pid, gain in (('roof_night', 'rooftop_night', 1.7), ('roof_dawn', 'signal_hill_sunrise', 0.55)):
        img = bpy.data.images.load(ph.hdri(pid, '4k'))
        w, h = img.size
        a = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)[::-1, :, :3] * gain
        a = a / (1 + a * 0.35)                          # roll the lamps and the sun off instead of clipping them
        Image.fromarray((np.sqrt(np.clip(a, 0, 1)) * 255).astype(np.uint8)).save(os.path.join(ROOT, 'env', name + '_sky.webp'), 'WEBP', quality=88, method=6)
        print('sky', name, flush=True)


if __name__ == '__main__':
    code = 0
    try:
        for n in sys.argv[1:] or ['env', 'roof', 'gym', 'pit']:
            {'roof': roof, 'gym': gym, 'pit': pit, 'env': env}[n]()
    except Exception:
        import traceback
        traceback.print_exc()
        code = 1
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
