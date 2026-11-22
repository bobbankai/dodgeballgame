"""
Vowbreaker stages. blender -b -P vowbreaker/tools/blender/stages.py -- <name|all> [--preview out.png]

Every piece is a hand-placed block from a small kit; each face carries its painted colour and a
pattern id (vertex colour alpha = id / 32, see vb_surface in the shaders), and every vertex its baked
ambient occlusion (UVMap.x) and how much it sways in the wind (UVMap.y). The whole stage is merged
into a few chunks and exported to public/assets/stages/<name>.glb.

Blender axes: Z up; the arena is centred on the origin. glTF/Babylon: (x, y, z) -> (x, z, -y).
"""
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import vbcore as core  # noqa: E402
import vbmesh as M  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'stages')

# pattern ids (vb_surface)
PLAIN, BRICK, TILE, PLANKS, CONCRETE, ASPHALT, COBBLES, ROOF, SHOJI, TATAMI, PLASTER, METAL, GRASS, SAND, STONE, BARK, PAPER, WINDOWS, NEON, \
    LANTERN, _W, FOLIAGE, DIRT, STATION, FABRIC, CHARRED, STEEL, GRAVEL, RAKED, LACQUER, GLASS, LIGHT = range(32)

PIECES = []


def hexc(h):
    return core.srgb(h)


def finish_piece(ob, col, pattern, sway=0.0, smooth=False):
    """Paint every face corner with (colour, pattern) and remember the sway weight."""
    me = ob.data
    c = hexc(col) if isinstance(col, str) else col
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    data = np.tile(np.array([c[0], c[1], c[2], pattern / 32.0], dtype=np.float32), len(me.loops))
    attr.data.foreach_set('color', data)
    me.color_attributes.active_color_name = 'Col'
    for p in me.polygons:
        p.use_smooth = smooth
    ob['sway'] = sway
    PIECES.append(ob)
    return ob


def mesh_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# =============================================================================== primitives

def box(c, size, col, pattern=PLAIN, rot=0.0, bevel=0.0, name='box', sway=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return finish_piece(mesh_obj(name, bm), col, pattern, sway)


def cyl(p0, p1, r, col, pattern=PLAIN, sides=12, r1=None, name='cyl', smooth=True, cap=True, sway=0.0):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=sides, radius1=r, radius2=r if r1 is None else r1, depth=L)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(p0 + p1) / 2, verts=bm.verts)
    return finish_piece(mesh_obj(name, bm), col, pattern, sway, smooth)


def prism_roof(c, w, d, h, col, pattern=ROOF, rot=0.0, overhang=0.4, name='roof'):
    """A gabled roof: ridge along local x."""
    w2, d2 = w / 2 + overhang, d / 2 + overhang
    verts = [(-w2, -d2, 0), (w2, -d2, 0), (w2, d2, 0), (-w2, d2, 0), (-w2, 0, h), (w2, 0, h)]
    faces = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish_piece(mesh_obj(name, bm), col, pattern)


def hip_roof(c, w, d, h, col, pattern=ROOF, rot=0.0, overhang=0.5, curve=0.15, name='hiproof'):
    """A Japanese hip roof with slightly upturned eaves."""
    w2, d2 = w / 2 + overhang, d / 2 + overhang
    rx = max(w2 - d2, 0.05)
    up = curve
    verts = [(-w2, -d2, up), (w2, -d2, up), (w2, d2, up), (-w2, d2, up), (-rx, 0, h), (rx, 0, h),
             (-w2 * 0.85, -d2 * 0.85, up * 0.2 + h * 0.12), (w2 * 0.85, -d2 * 0.85, up * 0.2 + h * 0.12)]
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts[:6]]
    for f in [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]:
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish_piece(mesh_obj(name, bm), col, pattern)


def disc(c, r, col, pattern, segs=48, name='disc'):
    """A round floor as concentric rings of near-square quads (no long fan triangles: those get
    clipped hard by the sun's small shadow frustum and rasterise with the wrong depth on some
    GPUs, and they smear the baked AO into spokes). A small fan closes the centre."""
    bm = bmesh.new()
    segs = max(segs, 48)
    radii = [0.6]
    while radii[-1] < r:
        step = max(0.6, min(4.0, radii[-1] * 2 * math.pi / segs))
        radii.append(min(r, radii[-1] + step))
    centre = bm.verts.new((0.0, 0.0, 0.0))
    rings = []
    for rad in radii:
        ring = [bm.verts.new((rad * math.cos(2 * math.pi * k / segs), rad * math.sin(2 * math.pi * k / segs), 0.0)) for k in range(segs)]
        rings.append(ring)
    for k in range(segs):
        bm.faces.new((centre, rings[0][k], rings[0][(k + 1) % segs]))
    for a, b in zip(rings, rings[1:]):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((a[k], b[k], b[k2], a[k2]))
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    ob = mesh_obj(name, bm)
    return finish_piece(ob, col, pattern)


def plane(c, w, d, col, pattern, rot=0.0, subdiv=3, name='plane'):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=max(1, int(w / 4)), y_segments=max(1, int(d / 4)), size=0.5)
    bmesh.ops.scale(bm, vec=Vector((w, d, 1)), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return finish_piece(mesh_obj(name, bm), col, pattern)


def blob(c, r, col, pattern=FOLIAGE, sway=0.6, seed=0, subdiv=2, squash=0.8, name='blob'):
    """A lumpy rounded clump (tree canopies, bushes)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    rnd = random.Random(seed)
    off = Vector((rnd.random() * 10, rnd.random() * 10, rnd.random() * 10))
    for v in bm.verts:
        n = v.co.normalized()
        k = 1.0 + 0.22 * math.sin(n.x * 5 + off.x) * math.sin(n.y * 4 + off.y) + 0.12 * math.sin(n.z * 7 + off.z)
        v.co = n * r * k
        v.co.z *= squash
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return finish_piece(mesh_obj(name, bm), col, pattern, sway, smooth=True)


def tube_line(pts, r, col, pattern=PLAIN, sway=0.0, name='wire'):
    ob = M.tube(pts, [r] * len(pts), n=6, cap0=None, cap1=None, samples=max(4, len(pts) * 3)).build(name)
    return finish_piece(ob, col, pattern, sway, smooth=True)


# =============================================================================== kit

def building(x, y, w, d, h, rot=0.0, wall='#BFB6A8', wall_pat=PLASTER, windows=True, floors=None, roof='flat', roof_col='#4A4E58',
             sign=None, rng=None, ac=True):
    """A city building: walls, a band of lit windows per floor on the street faces, a roof."""
    rng = rng or random.Random(int(x * 13 + y * 7))
    R = Matrix.Rotation(rot, 3, 'Z')
    c = Vector((x, y, h / 2))
    box(c, (w, d, h), wall, wall_pat, rot=rot)
    floors = floors or max(1, int(h / 3.1))
    if windows:
        # window panels sit just proud of the front (-y local) and back faces
        for side in (-1, 1):
            p = Vector((x, y, 0)) + R @ Vector((0, side * (d / 2 + 0.03), 0))
            box((p.x, p.y, h / 2 + 0.4), (w * 0.86, 0.06, h - 1.6), '#FFFFFF', WINDOWS, rot=rot, name='windows')
    if roof == 'flat':
        box((x, y, h + 0.25), (w + 0.2, d + 0.2, 0.5), roof_col, CONCRETE, rot=rot)
        if ac:
            for _ in range(rng.randint(1, 3)):
                o = R @ Vector((rng.uniform(-w / 3, w / 3), rng.uniform(-d / 3, d / 3), 0))
                box((x + o.x, y + o.y, h + 0.9), (1.2, 0.9, 0.8), '#8A8E94', METAL, rot=rot)
    elif roof == 'gable':
        prism_roof((x, y, h), w, d, 1.8, roof_col, ROOF, rot=rot)
    elif roof == 'hip':
        hip_roof((x, y, h), w, d, 2.0, roof_col, ROOF, rot=rot)
    if sign:
        col, side = sign
        p = Vector((x, y, 0)) + R @ Vector((w / 2 + 0.15 * side, -d / 2 + 0.4, 0))
        box((p.x, p.y, min(h - 1.5, 6.5)), (0.25, 0.9, 3.2), col, NEON, rot=rot, name='neon')
    if ac and rng.random() < 0.7:
        p = Vector((x, y, 0)) + R @ Vector((rng.uniform(-w / 3, w / 3), -d / 2 - 0.35, 0))
        box((p.x, p.y, rng.uniform(2.5, h - 1)), (0.9, 0.6, 0.6), '#9A9EA4', METAL, rot=rot)


def pole(x, y, h=8.5):
    cyl((x, y, 0), (x, y, h), 0.14, '#6E6A66', CONCRETE, sides=10, r1=0.1)
    box((x, y, h - 0.6), (1.8, 0.12, 0.12), '#3A3634', STEEL)
    box((x, y, h - 1.2), (1.4, 0.1, 0.1), '#3A3634', STEEL)
    cyl((x + 0.3, y, h - 2.2), (x + 0.3, y, h - 1.6), 0.25, '#7A7E84', METAL, sides=10)
    return Vector((x, y, h - 0.6))


def wires(a, b, sag=1.0, n=3, spread=0.7):
    for i in range(n):
        o = Vector(((i - (n - 1) / 2) * spread, 0, -i * 0.15))
        pts = []
        for k in range(9):
            t = k / 8
            p = a.lerp(b, t) + o
            p.z -= sag * 4 * t * (1 - t)
            pts.append(p)
        tube_line(pts, 0.018, '#151415', STEEL, sway=0.05)


def vending(x, y, rot=0.0, col='#C9302C'):
    R = Matrix.Rotation(rot, 3, 'Z')
    box((x, y, 0.95), (1.0, 0.75, 1.9), col, METAL, rot=rot, bevel=0.03)
    p = Vector((x, y, 0)) + R @ Vector((0, -0.39, 0))
    box((p.x, p.y, 1.15), (0.85, 0.04, 1.1), '#E8F4FF', LIGHT, rot=rot, name='vglow')


def lantern(x, y, z, r=0.28, h=0.42, col='#E9472E', string=True):
    bm = bmesh.new()
    prof = [(r * 0.5, -h), (r * 0.95, -h * 0.6), (r, 0), (r * 0.95, h * 0.6), (r * 0.5, h)]
    rings = []
    segs = 14
    for rr, zz in prof:
        ring = [bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, zz)) for a in np.linspace(0, 2 * math.pi, segs, endpoint=False)]
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]])
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.translate(bm, vec=Vector((x, y, z)), verts=bm.verts)
    finish_piece(mesh_obj('lantern', bm), col, LANTERN, sway=0.25, smooth=True)
    cyl((x, y, z + h), (x, y, z + h + 0.08), r * 0.55, '#1A1414', LACQUER, sides=10)
    cyl((x, y, z - h - 0.06), (x, y, z - h), r * 0.55, '#1A1414', LACQUER, sides=10)


def lantern_string(a, b, n=7, sag=0.8, col='#E9472E', rng=None):
    rng = rng or random.Random(3)
    a, b = Vector(a), Vector(b)
    pts = []
    for k in range(13):
        t = k / 12
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        pts.append(p)
    tube_line(pts, 0.015, '#201818', STEEL, sway=0.3)
    for i in range(n):
        t = (i + 0.5) / n
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t) + 0.55
        c = col if rng.random() < 0.7 else '#F2C14E'
        lantern(p.x, p.y, p.z, col=c)


def torii(x, y, rot=0.0, w=4.6, h=5.0, col='#C8312A'):
    R = Matrix.Rotation(rot, 3, 'Z')
    for s in (-1, 1):
        p = Vector((x, y, 0)) + R @ Vector((s * w * 0.38, 0, 0))
        cyl((p.x, p.y, 0), (p.x, p.y, h * 0.92), 0.2, col, LACQUER, sides=14, r1=0.17)
        cyl((p.x, p.y, 0), (p.x, p.y, 0.5), 0.26, '#1C1A1A', LACQUER, sides=14)
    box((x, y, h * 0.72), (w * 1.0, 0.24, 0.26), col, LACQUER, rot=rot)
    box((x, y, h * 0.94), (w * 1.28, 0.42, 0.24), '#1C1A1A', LACQUER, rot=rot)
    box((x, y, h * 0.88), (w * 1.16, 0.32, 0.16), col, LACQUER, rot=rot)


def stone_lantern(x, y, s=1.0):
    box((x, y, 0.12 * s), (0.7 * s, 0.7 * s, 0.24 * s), '#8E8B84', STONE)
    cyl((x, y, 0.24 * s), (x, y, 0.9 * s), 0.14 * s, '#8E8B84', STONE, sides=8)
    box((x, y, 1.05 * s), (0.5 * s, 0.5 * s, 0.35 * s), '#9A968E', STONE)
    box((x, y, 1.05 * s), (0.3 * s, 0.52 * s, 0.2 * s), '#FFC27A', LIGHT, name='toroglow')
    cyl((x, y, 1.22 * s), (x, y, 1.5 * s), 0.55 * s, '#7E7B74', STONE, sides=6, r1=0.06 * s)


def tree(x, y, h=5.5, kind='sakura', seed=0):
    rng = random.Random(seed)
    trunk = '#4A3A30' if kind != 'dead' else '#2A2422'
    top = Vector((x + rng.uniform(-0.4, 0.4), y + rng.uniform(-0.4, 0.4), h * 0.62))
    cyl((x, y, 0), top, 0.22 * h / 5.5, trunk, BARK, sides=10, r1=0.13 * h / 5.5)
    for i in range(3):
        a = rng.uniform(0, 2 * math.pi)
        b = top + Vector((math.cos(a) * h * 0.25, math.sin(a) * h * 0.25, h * 0.15))
        cyl(top - Vector((0, 0, 0.5)), b, 0.08 * h / 5.5, trunk, BARK, sides=6, r1=0.04)
    if kind == 'dead':
        return
    col = {'sakura': '#F3B3C6', 'pine': '#2F5A3A', 'maple': '#C8452E', 'green': '#4E7E3C'}[kind]
    n = 6 if kind != 'pine' else 5
    for i in range(n):
        a = i / n * 2 * math.pi + rng.uniform(-0.3, 0.3)
        rr = h * (0.22 if kind != 'pine' else 0.16)
        c = top + Vector((math.cos(a) * rr, math.sin(a) * rr, h * (0.12 + rng.uniform(-0.05, 0.15))))
        blob(c, h * rng.uniform(0.17, 0.24), col, FOLIAGE, sway=0.5, seed=seed * 10 + i, squash=0.7 if kind != 'pine' else 0.45)
    blob(top + Vector((0, 0, h * 0.3)), h * 0.25, col, FOLIAGE, sway=0.6, seed=seed * 10 + 9, squash=0.75)


def japanese_house(x, y, w, d, rot=0.0, wood='#5A4232', wall='#E8E0CE', roof_col='#3C4250', two_storey=False, rng=None):
    """A wooden house: dark posts, plaster and shoji walls, engawa, tiled hip roof."""
    R = Matrix.Rotation(rot, 3, 'Z')
    h = 3.0
    box((x, y, 0.25), (w + 0.6, d + 0.6, 0.5), '#8A8278', STONE, rot=rot)
    box((x, y, 0.5 + h / 2), (w, d, h), wall, PLASTER, rot=rot)
    # shoji panels on the front, warm light behind
    p = Vector((x, y, 0)) + R @ Vector((0, -d / 2 - 0.04, 0))
    box((p.x, p.y, 0.5 + h * 0.48), (w * 0.8, 0.05, h * 0.75), '#FFFFFF', SHOJI, rot=rot, name='shoji')
    for k in np.linspace(-w / 2, w / 2, 5):
        q = Vector((x, y, 0)) + R @ Vector((k, -d / 2 - 0.08, 0))
        box((q.x, q.y, 0.5 + h / 2), (0.16, 0.16, h), wood, PLANKS, rot=rot)
    # engawa (veranda) boards
    e = Vector((x, y, 0)) + R @ Vector((0, -d / 2 - 0.6, 0))
    box((e.x, e.y, 0.55), (w + 0.4, 1.1, 0.1), '#7A5A40', PLANKS, rot=rot)
    hip_roof((x, y, 0.5 + h), w, d, 2.2, roof_col, ROOF, rot=rot, overhang=0.9)
    if two_storey:
        box((x, y, 0.5 + h + 1.9), (w * 0.6, d * 0.6, 1.8), wall, PLASTER, rot=rot)
        hip_roof((x, y, 0.5 + h + 2.8), w * 0.6, d * 0.6, 1.6, roof_col, ROOF, rot=rot, overhang=0.7)


def wall_run(a, b, h=2.2, col='#E8E0CE', cap='#3C4250'):
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    rot = math.atan2(d.y, d.x)
    c = (a + b) / 2
    box((c.x, c.y, h / 2), (L, 0.35, h), col, PLASTER, rot=rot)
    box((c.x, c.y, h + 0.12), (L + 0.2, 0.6, 0.24), cap, ROOF, rot=rot)


def grave(x, y, rot=0.0, h=1.3, rng=None):
    rng = rng or random.Random(int(x * 31 + y))
    box((x, y, 0.15), (1.1, 1.1, 0.3), '#8C8A86', STONE, rot=rot)
    box((x, y, 0.4), (0.8, 0.8, 0.2), '#9A9894', STONE, rot=rot)
    box((x, y, 0.5 + h / 2), (0.42, 0.38, h), '#A4A29D' if rng.random() < 0.5 else '#7E7C78', STONE, rot=rot)


def crate(x, y, z=0.0, s=0.7, rot=0.0):
    box((x, y, z + s / 2), (s, s, s), '#8A6A48', PLANKS, rot=rot, bevel=0.02)


# =============================================================================== stages

def ground_ring(r_inner, r_outer, col, pattern):
    disc((0, 0, 0), r_outer, col, pattern, segs=64, name='ground')


def alley():
    """Shiomi back street at night: a small crossroads under wires, wet asphalt, neon and vending machines."""
    rng = random.Random(1)
    plane((0, 0, 0), 90, 90, '#4C4C54', ASPHALT, name='street')
    # pavements
    for s in (-1, 1):
        box((s * 8.2, 0, 0.08), (2.4, 90, 0.16), '#7A7A80', CONCRETE)
        box((0, s * 8.2, 0.08), (90, 2.4, 0.16), '#7A7A80', CONCRETE)
    # blocks of buildings on the four corners
    palette = ['#B8AFA2', '#9C9AA6', '#C2B49C', '#8E8A86', '#A79C92', '#B9A9A6']
    neon = ['#FF3E8E', '#3EE6FF', '#FFB43E', '#B04BFF', '#58FF8A']
    for qx in (-1, 1):
        for qy in (-1, 1):
            for i in range(4):
                along = 12 + i * 7.5
                h = rng.choice([7, 9.5, 12.5, 15])
                bx = qx * (9.6 + 3.2) if i % 2 == 0 else qx * along
                by = qy * along if i % 2 == 0 else qy * (9.6 + 3.2)
                w, d = (6.2, 6.8) if i % 2 == 0 else (6.8, 6.2)
                building(bx, by, w, d, h, wall=rng.choice(palette), wall_pat=rng.choice([PLASTER, CONCRETE, BRICK, TILE]),
                         sign=(rng.choice(neon), -qx) if rng.random() < 0.6 else None, rng=rng)
    # poles and wires along both streets
    tops = {}
    for k in range(-3, 4):
        if k == 0:
            continue
        tops[(k, 'x')] = pole(k * 9.0, 7.6)
        tops[(k, 'y')] = pole(-7.6, k * 9.0)
    for k in range(-3, 3):
        if (k, 'x') in tops and (k + 1, 'x') in tops:
            wires(tops[(k, 'x')], tops[(k + 1, 'x')], sag=0.8)
        if (k, 'y') in tops and (k + 1, 'y') in tops:
            wires(tops[(k, 'y')], tops[(k + 1, 'y')], sag=0.8)
    wires(tops[(1, 'x')], tops[(-1, 'y')], sag=1.2, n=2)
    for (x, y, r) in ((6.6, 10.5, math.pi), (-6.6, -11.0, 0), (10.5, -6.8, math.pi / 2)):
        vending(x, y, r, rng.choice(['#C9302C', '#2C6BC9', '#E8E4DA']))
    # a street lamp, crates, a bench, an alley shrine
    cyl((2, 4.2, 0), (2, 4.2, 4.0), 0.08, '#2A2A2E', STEEL, sides=8)
    box((2, 3.8, 4.05), (0.3, 0.9, 0.12), '#2A2A2E', STEEL)
    box((2, 3.6, 3.95), (0.25, 0.4, 0.06), '#FFE2B0', LIGHT, name='lamp')
    for i in range(5):
        crate(-10 + rng.uniform(-1, 1), 10 + rng.uniform(-1, 1), 0, rng.uniform(0.5, 0.8), rng.uniform(0, 1))
    box((-10.5, -3, 0.45), (0.6, 2.2, 0.08), '#6A5040', PLANKS)
    torii(10.8, 11.5, math.pi / 4, w=1.6, h=1.8)
    box((11.6, 12.3, 0.6), (0.8, 0.8, 1.2), '#8E8B84', STONE, rot=math.pi / 4)


def academy():
    """Hakuro Academy: a courtyard between old wooden school buildings, cherry trees, a gate."""
    rng = random.Random(2)
    disc((0, 0, 0), 60, '#9C8F7A', DIRT, name='yard')
    disc((0, 0, 0.01), 14, '#B3A68E', GRAVEL, name='ring')
    # school buildings on three sides: long two-storey wooden halls
    for (x, y, w, d, r) in ((0, 24, 34, 9, 0), (-24, 4, 30, 9, math.pi / 2), (24, 4, 30, 9, math.pi / 2)):
        R = Matrix.Rotation(r, 3, 'Z')
        box((x, y, 4), (w, d, 8), '#E3D9C4', PLASTER, rot=r)
        for k in np.linspace(-w / 2 + 1, w / 2 - 1, 9):
            for fl in (0, 1):
                p = Vector((x, y, 0)) + R @ Vector((k, -d / 2 - 0.05, 0))
                box((p.x, p.y, 2 + fl * 4), (2.2, 0.08, 2.2), '#FFFFFF', SHOJI, rot=r, name='shoji')
        for k in np.linspace(-w / 2, w / 2, 12):
            p = Vector((x, y, 0)) + R @ Vector((k, -d / 2 - 0.12, 0))
            box((p.x, p.y, 4), (0.3, 0.3, 8), '#4E3A2C', PLANKS, rot=r)
        box((x, y, 4.1), (w + 0.4, d + 1.2, 0.3), '#4E3A2C', PLANKS, rot=r)
        hip_roof((x, y, 8), w, d, 3.2, '#3A404E', ROOF, rot=r, overhang=1.2)
    # the gate and the path to it
    torii(0, -26, 0, w=6.5, h=6.8, col='#2A2422')
    for k in range(10):
        box((0, -14 - k * 1.3, 0.04), (2.6, 1.1, 0.08), '#A8A196', STONE)
    # cherry trees, stone lanterns, a bell tower
    for i, (x, y) in enumerate(((-12, 12), (12, 12), (-15, -8), (15, -9), (-9, -17), (9, -17), (-18, 16), (18, 17))):
        tree(x, y, rng.uniform(5.0, 6.5), 'sakura', seed=i)
    for (x, y) in ((-5, -15), (5, -15), (-16, 0), (16, 0)):
        stone_lantern(x, y, 1.1)
    box((-20, -18, 4), (3, 3, 8), '#4E3A2C', PLANKS)
    hip_roof((-20, -18, 8), 3, 3, 2, '#3A404E', ROOF, overhang=0.8)
    cyl((-20, -18, 5.2), (-20, -18, 7.2), 0.8, '#B07A3A', METAL, sides=16, r1=0.6)
    wall_run((-30, -26), (-4, -26))
    wall_run((4, -26), (30, -26))


def chapel():
    """A ruined seaside wedding chapel: broken white walls and arches, toppled pews, the sea."""
    rng = random.Random(3)
    # the sea itself is the stage's toon water surface (src/render/Water.ts)
    disc((0, 0, 0), 22, '#C9C4BA', TILE, name='floor')
    box((0, 0, -0.35), (44, 44, 0.6), '#8E8A82', STONE)
    # broken walls: segments with arches cut by leaving gaps, heights uneven
    for side in (-1, 1):
        for k in range(7):
            h = rng.uniform(3, 9) if rng.random() < 0.7 else rng.uniform(1, 2.5)
            box((side * 15, -15 + k * 5, h / 2), (1.0, 3.6, h), '#E6E1D6', STONE, rot=0)
            if h > 5 and k < 6:
                box((side * 15, -12.5 + k * 5, 6.2), (1.0, 1.4, 0.8), '#E6E1D6', STONE)
    for k in range(5):
        h = rng.uniform(4, 10)
        box((-10 + k * 5, 17, h / 2), (3.6, 1.0, h), '#E6E1D6', STONE)
    # the altar and the bell arch behind it
    box((0, 13.5, 0.6), (5, 2, 1.2), '#F2EEE6', STONE)
    for s in (-1, 1):
        box((s * 2.2, 15.5, 4), (0.8, 0.8, 8), '#E6E1D6', STONE)
    box((0, 15.5, 8.2), (5.6, 1.0, 0.8), '#E6E1D6', STONE)
    cyl((0, 15.5, 6.2), (0, 15.5, 7.8), 0.6, '#B08A4A', METAL, sides=14, r1=0.45)
    # toppled pews
    for i in range(10):
        x = rng.choice([-1, 1]) * rng.uniform(5, 12)
        y = rng.uniform(-12, 10)
        box((x, y, 0.45), (3.2, 0.5, 0.9), '#6A4A36', PLANKS, rot=rng.uniform(-0.6, 0.6))
    # broken columns and rubble
    for i in range(12):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(16, 20)
        cyl((math.cos(a) * r, math.sin(a) * r, 0), (math.cos(a) * r, math.sin(a) * r, rng.uniform(1, 6)), 0.5, '#DCD6CA', STONE, sides=12)
    for i in range(25):
        box((rng.uniform(-14, 14), rng.uniform(-14, 14), 0.15), (rng.uniform(0.3, 0.9),) * 2 + (0.3,), '#D2CCC0', STONE, rot=rng.uniform(0, 3))
    # cliffs on the land side
    for i in range(8):
        box((rng.uniform(-40, 40), -32 - rng.uniform(0, 10), rng.uniform(2, 8)), (rng.uniform(6, 14), rng.uniform(6, 10), rng.uniform(4, 16)), '#5A5850', STONE)


def subway():
    """A late-night platform: tiled walls, pillars, light panels, the tracks, a stopped train."""
    rng = random.Random(4)
    box((0, 0, -0.1), (60, 20, 0.2), '#B4B2AC', TILE, name='platform')
    box((0, 0.0, 0.002), (60, 0.35, 0.01), '#E8C230', PLAIN)
    for s in (-1, 1):
        box((0, s * 9.6, 0.02), (60, 0.5, 0.06), '#E8C230', PLAIN)
        box((0, s * 13.5, -1.2), (70, 7, 0.2), '#3A3836', GRAVEL)
        for rr in (-0.75, 0.75):
            box((0, s * 13.5 + rr, -1.0), (70, 0.12, 0.15), '#8E9094', STEEL)
        box((0, s * 18, 3), (70, 1, 9), '#E2E4DE', STATION)
    box((0, 0, 7.2), (70, 40, 0.4), '#C8CAC6', CONCRETE)
    for x in np.arange(-26, 27, 6.5):
        for s in (-1, 1):
            box((x, s * 6.5, 3.5), (0.9, 0.9, 7), '#D8DAD4', STATION)
        box((x, 0, 6.9), (3.6, 1.0, 0.1), '#F4FAFF', LIGHT, name='panel')
    for x in (-18, -6, 6, 18):
        box((x, -3, 0.45), (2.6, 0.6, 0.12), '#5E6E8E', METAL)
        box((x, -3.3, 0.8), (2.6, 0.1, 0.6), '#5E6E8E', METAL)
        box((x, 3, 2.6), (2.2, 0.2, 0.7), '#1E2430', NEON, name='sign')
    # the stopped train on the far track
    for k in range(4):
        x = -27 + k * 18
        box((x, 13.5, 1.4), (17.4, 3.0, 3.6), '#C9CDD2', METAL, bevel=0.1)
        box((x, 13.5 - 1.52, 1.8), (16.6, 0.05, 1.0), '#FFFFFF', WINDOWS, name='trainwin')
        box((x, 13.5, 0.1), (17.4, 3.0, 0.4), '#2A2E34', STEEL)
    for i in range(6):
        crate(rng.uniform(-25, 25), rng.choice([-8, 8]), 0, 0.6)


def village(burnt=False):
    """Amagiri village on festival night: wooden houses, stalls, strings of lanterns, the shrine."""
    rng = random.Random(5)
    disc((0, 0, 0), 70, '#7E6A56', DIRT, name='ground')
    for i in range(12):
        a = i / 12 * 2 * math.pi + 0.2
        r = rng.uniform(19, 24)
        x, y = math.cos(a) * r, math.sin(a) * r
        if abs(y - 22) < 6 and abs(x) < 6:
            continue
        japanese_house(x, y, rng.uniform(7, 10), rng.uniform(6, 8), rot=a + math.pi / 2, two_storey=rng.random() < 0.3,
                       wood='#3E2E26' if burnt else '#5A4232', wall='#5A4E46' if burnt else '#E8E0CE', rng=rng)
    # festival stalls (yatai) round the square
    for i in range(6):
        a = i / 6 * 2 * math.pi + 0.5
        r = 15.5
        x, y = math.cos(a) * r, math.sin(a) * r
        R = Matrix.Rotation(a + math.pi / 2, 3, 'Z')
        box((x, y, 0.5), (2.6, 1.2, 1.0), '#6A4A36', PLANKS, rot=a + math.pi / 2)
        for s in (-1, 1):
            p = Vector((x, y, 0)) + R @ Vector((s * 1.25, 0.5, 0))
            cyl((p.x, p.y, 0), (p.x, p.y, 2.4), 0.06, '#3A2A22', BARK, sides=6)
        box((x, y, 2.45), (2.9, 1.8, 0.08), rng.choice(['#C8402E', '#2E5AC8', '#E8E2D6']), FABRIC, rot=a + math.pi / 2, sway=0.2)
        lantern(x, y, 2.0, r=0.2, h=0.3)
    # lantern strings crossing the square
    for i in range(5):
        a = i / 5 * math.pi
        p0 = (math.cos(a) * 17, math.sin(a) * 17, 5.2)
        p1 = (-math.cos(a) * 17, -math.sin(a) * 17, 5.2)
        lantern_string(p0, p1, n=9, sag=1.4, rng=rng)
    for i in range(10):
        a = i / 10 * 2 * math.pi
        cyl((math.cos(a) * 17, math.sin(a) * 17, 0), (math.cos(a) * 17, math.sin(a) * 17, 5.4), 0.1, '#3A2A22', BARK, sides=6)
    # the shrine at the top of the square
    torii(0, 20, 0, w=5, h=5.4)
    box((0, 26, 0.6), (8, 6, 1.2), '#8A8278', STONE)
    japanese_house(0, 27, 6, 4.5, rot=0, wood='#5A2A22', wall='#C8312A', roof_col='#2A2E38')
    for (x, y) in ((-3.5, 18), (3.5, 18)):
        stone_lantern(x, y)
    for i in range(5):
        tree(rng.uniform(-30, 30), rng.uniform(26, 34), rng.uniform(7, 10), 'pine' if not burnt else 'dead', seed=50 + i)


def estate():
    """The Tachibana estate: a great house, raked gravel, a pond, pines and a white wall."""
    rng = random.Random(6)
    disc((0, 0, 0), 60, '#B8B0A0', RAKED, name='gravel')
    plane((10, 14, 0.02), 12, 7, '#2A4A56', GLASS, name='pond')
    for i in range(14):
        a = i / 14 * 2 * math.pi
        box((10 + math.cos(a) * 6.4, 14 + math.sin(a) * 3.8, 0.15), (0.9, 0.7, 0.3), '#7E7B74', STONE, rot=a)
    japanese_house(0, 22, 24, 9, rot=0, two_storey=True, wood='#3A2C24', wall='#F0EAE0', roof_col='#2E3440')
    japanese_house(-20, 6, 12, 8, rot=math.pi / 2, wood='#3A2C24', wall='#F0EAE0', roof_col='#2E3440')
    for (a, b) in (((-30, -20), (30, -20)), ((-30, -20), (-30, 30)), ((30, -20), (30, 30))):
        wall_run(a, b, h=2.6, col='#F2EEE4', cap='#2E3440')
    torii(0, -20, 0, w=4.5, h=4.4, col='#2A2422')
    for i, (x, y) in enumerate(((-13, -8), (14, -10), (-16, 14), (18, 4), (-6, -15), (24, -14))):
        tree(x, y, rng.uniform(4, 6), 'pine', seed=60 + i)
    for (x, y) in ((-5, 12), (5, 12), (16, 10), (4, 16)):
        stone_lantern(x, y, 1.0)
    for i in range(7):
        box((rng.uniform(-12, 12), rng.uniform(-12, 12), 0.35), (rng.uniform(0.8, 1.6), rng.uniform(0.6, 1.2), 0.7), '#6E6B66', STONE, rot=rng.uniform(0, 3), bevel=0.15)
    # paper talismans hanging on a rope across the gate
    lantern_string((-6, -19.5, 4), (6, -19.5, 4), n=8, sag=0.6, col='#F4EEDC', rng=rng)


def apartment():
    """The memory: Itsuki's family apartment, burning, walls open to a sky of fire."""
    rng = random.Random(7)
    box((0, 0, -0.1), (26, 26, 0.2), '#4A3A30', CHARRED, name='floor')
    # rooms: low partition walls, doors, furniture
    for (a, b) in (((-13, -13), (13, -13)), ((-13, 13), (2, 13)), ((-13, -13), (-13, 13)), ((13, -13), (13, 6))):
        a, b = Vector(a), Vector(b)
        d = b - a
        c = (a + b) / 2
        box((c.x, c.y, 1.6), (d.length if abs(d.x) > 0 else 0.3, 0.3 if abs(d.x) > 0 else d.length, 3.2), '#8A7466', PLASTER)
    box((-4, 13, 1.6), (0.3, 0.3, 3.2), '#5A4232', PLANKS)
    box((5, -13.2, 1.1), (1.0, 0.1, 2.2), '#5A3A2A', PLANKS, name='door')
    # the low table where Mio did her homework, the shelf, the TV, the window
    box((2, 2, 0.35), (1.8, 1.0, 0.1), '#6A4A36', PLANKS)
    for s in ((1.3, 1.6), (2.7, 1.6), (1.3, 2.4), (2.7, 2.4)):
        box((s[0], s[1], 0.15), (0.08, 0.08, 0.3), '#5A3A2A', PLANKS)
    box((-10, 9, 1.0), (3, 0.6, 2.0), '#5A3A2A', PLANKS)
    box((9, -9, 0.6), (1.6, 0.5, 1.2), '#2A2A2E', METAL)
    box((-12.8, -4, 1.8), (0.1, 3, 1.6), '#FFE0B0', LIGHT, name='window')
    for i in range(16):
        box((rng.uniform(-11, 11), rng.uniform(-11, 11), 0.08), (rng.uniform(0.2, 0.8),) * 2 + (0.15,), '#2A2220', CHARRED, rot=rng.uniform(0, 3))
    for i in range(8):
        cyl((rng.uniform(-12, 12), rng.uniform(-12, 12), 0), (rng.uniform(-12, 12), rng.uniform(-12, 12), 0.2), 0.12, '#2A2220', CHARRED, sides=6)
    # the apartment block outside the window, burning
    for i in range(6):
        building(-30 + i * 12, 30, 9, 9, rng.uniform(12, 22), wall='#3A2E2A', wall_pat=CONCRETE, rng=rng, ac=False)


def crossing():
    """The scramble crossing on the night of the Grand Vow: towers, screens, painted stripes."""
    rng = random.Random(8)
    plane((0, 0, 0), 160, 160, '#3C3C42', ASPHALT, name='road')
    for k in range(-6, 7):
        for (rot, off) in ((0, 11), (0, -11), (math.pi / 2, 11), (math.pi / 2, -11)):
            R = Matrix.Rotation(rot, 3, 'Z')
            p = R @ Vector((k * 1.1, off, 0))
            box((p.x, p.y, 0.012), (0.55, 4.5, 0.02), '#E8E8E4', PLAIN, rot=rot)
    for k in range(-5, 6):
        R = Matrix.Rotation(math.pi / 4, 3, 'Z')
        p = R @ Vector((k * 1.1, 0, 0))
        box((p.x, p.y, 0.012), (0.5, 10, 0.02), '#E8E8E4', PLAIN, rot=math.pi / 4)
    neon = ['#FF3E8E', '#3EE6FF', '#FFB43E', '#B04BFF', '#FF5A3E']
    for qx in (-1, 1):
        for qy in (-1, 1):
            for i in range(3):
                x = qx * (20 + i * 10)
                y = qy * (20 + (2 - i) * 6)
                h = rng.uniform(22, 48)
                building(x, y, 9, 9, h, wall=rng.choice(['#3A3E48', '#4A4652', '#2E323C']), wall_pat=CONCRETE, rng=rng)
                # giant screens and signs on the corners facing the crossing
                box((x - qx * 4.6, y - qy * 2, rng.uniform(8, 18)), (0.3, 6, 4), rng.choice(neon), NEON, name='screen')
                box((x - qx * 2, y - qy * 4.6, rng.uniform(5, 14)), (5, 0.3, 3), rng.choice(neon), NEON, name='screen')
    for (x, y) in ((-9, -9), (9, 9), (-9, 9), (9, -9)):
        cyl((x, y, 0), (x, y, 5), 0.1, '#2A2A2E', STEEL, sides=8)
        box((x, y, 5), (0.4, 0.4, 1.1), '#2A2A2E', STEEL)
        box((x, y - 0.21, 5.3), (0.25, 0.02, 0.25), '#FF3A2E', LIGHT, name='signal')
    # the ritual: a pagoda of lanterns rising over the far side of the crossing
    for k in range(6):
        s = 7 - k * 0.9
        box((0, 34, 2 + k * 4), (s, s, 3.2), '#2A1A1A', LACQUER)
        hip_roof((0, 34, 3.6 + k * 4), s, s, 1.0, '#1A1414', ROOF, overhang=1.0)
        for a in np.linspace(0, 2 * math.pi, 8, endpoint=False):
            lantern(math.cos(a) * (s / 2 + 0.8), 34 + math.sin(a) * (s / 2 + 0.8), 3 + k * 4, r=0.3, h=0.45)
    for i in range(4):
        lantern_string((-14, -14 + i * 9, 7), (14, -14 + i * 9, 7), n=10, sag=1.6, rng=rng)


def graves():
    """The hillside cemetery in spring: rows of graves, cherry blossom, the town below."""
    rng = random.Random(9)
    disc((0, 0, 0), 60, '#7E8A56', GRASS, name='hill')
    for k in range(14):
        box((0, -14 + k * 1.2, 0.05), (1.6, 1.0, 0.1), '#9C9890', STONE)
    for row in range(4):
        for col in range(9):
            x = -16 + col * 4
            y = 6 + row * 4.2
            if abs(x) < 3:
                continue
            grave(x, y, rot=rng.uniform(-0.05, 0.05), h=rng.uniform(1.0, 1.5), rng=rng)
    for i, (x, y) in enumerate(((-12, -6), (13, -4), (-20, 18), (20, 16), (-6, 26), (8, 27), (0, 18))):
        tree(x, y, rng.uniform(6, 8), 'sakura', seed=90 + i)
    # the town far below and the sea
    for i in range(30):
        building(rng.uniform(-90, 90), -60 - rng.uniform(0, 40), rng.uniform(5, 9), rng.uniform(5, 9), rng.uniform(4, 14),
                 wall=rng.choice(['#D8D2C8', '#C8C2BA', '#B8B6B0']), rng=rng, ac=False)
    for i in range(10):
        box((-26 + i * 5.8, -16, 0.6), (5.8, 0.25, 1.2), '#6E6A66', STONE)
    # two fresh graves at the front: Mikami's, and Mio's
    grave(-3.5, 2.5, 0, 1.4, rng)
    grave(3.5, 2.5, 0, 1.2, rng)


STAGES = {'alley': alley, 'academy': academy, 'chapel': chapel, 'subway': subway, 'village': village,
          'estate': estate, 'apartment': apartment, 'crossing': crossing, 'graves': graves}


# =============================================================================== bake and export

def merge_and_bake(name, chunk=60.0):
    """Join pieces into chunks of `chunk` metres, bake AO into UVMap.x, sway into UVMap.y."""
    # store sway per vertex in a temporary attribute before joining
    for ob in PIECES:
        me = ob.data
        uv = me.uv_layers.new(name='UVMap')
        sway = float(ob.get('sway', 0.0))
        uv.data.foreach_set('uv', np.tile(np.array([1.0, sway], dtype=np.float32), len(me.loops)))
    groups = {}
    for ob in PIECES:
        c = ob.matrix_world @ (sum((Vector(b) for b in ob.bound_box), Vector()) / 8)
        key = (int(math.floor(c.x / chunk)), int(math.floor(c.y / chunk)))
        groups.setdefault(key, []).append(ob)
    merged = []
    for k, obs in groups.items():
        merged.append(core.join(obs, f'{name}_{k[0]}_{k[1]}'))
    ao = core.bake_ao(merged, distance=1.6, samples=20)
    for ob in merged:
        me = ob.data
        a = ao[ob.name]
        a = np.clip((a - 0.15) / 0.85, 0.0, 1.0) ** 0.85
        loops = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get('vertex_index', loops)
        uv = me.uv_layers['UVMap']
        cur = np.empty(len(me.loops) * 2, dtype=np.float32)
        uv.data.foreach_get('uv', cur)
        cur = cur.reshape(-1, 2)
        cur[:, 0] = a[loops]
        uv.data.foreach_set('uv', cur.ravel())
        me.color_attributes.active_color_name = 'Col'
    return merged


def export(name, objs):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_animations=False, export_materials='NONE',
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True)
    tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    print('wrote', path, os.path.getsize(path) // 1024, 'KB', tris, 'tris')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = argv[0].split(',') if argv else list(STAGES)
    if names == ['all']:
        names = list(STAGES)
    import traceback
    for n in names:
        core.reset()
        PIECES.clear()
        try:
            STAGES[n]()
            objs = merge_and_bake(n)
            export(n, objs)
            if '--preview' in argv:
                out = argv[argv.index('--preview') + 1].replace('.png', f'_{n}.png')
                for o in objs:
                    o.data.materials.append(core.white_material())
                core.preview(out, target=(0, 0, 2), dist=34, yaw=-30, pitch=24, size=(960, 540), samples=12)
        except Exception:
            traceback.print_exc()
            print('FAILED', n)
