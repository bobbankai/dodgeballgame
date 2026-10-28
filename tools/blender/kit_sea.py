"""
Kit for Chapter Two, the Folded Sea: lighthouse, sailboat, pier, sea stacks, the giant inkwell and
the bits of a fishing beach. Same conventions as kit.py: origin on the ground (or the waterline for
boats), front towards -Y, ob['col'] = 0 for walk-through parts.
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector, noise

import kit
import lib
from kit import box, nocol

PAL = {
    'lh_white': '#EEE8DA', 'lh_red': '#B5423A', 'copper': '#3E6E66', 'glass': '#35507A', 'brass': '#C9A04A',
    'lens': '#E8D9A8', 'hull': '#2F6488', 'hull_top': '#EEE8DA', 'sail': '#F4EEDC', 'wood': '#9A7550', 'wood_dark': '#5E4632',
    'rope': '#B59A6A', 'rock': '#8E8A80', 'rock_dark': '#6E6A62', 'chalk': '#E4DDCB', 'ink': '#1F3C66', 'label': '#F0E6CC',
    'cork': '#B88A58', 'buoy_red': '#C24A3A', 'buoy_white': '#F2EEE6', 'tar': '#3A3A40', 'net': '#7A6A55', 'kelp': '#4F7E43',
}


def M(name):
    return lib.mat('sea_' + name, PAL[name])


def ring_tube(name, center, radius, thick, mat, z=0.0, n=24):
    pts = [Vector(center) + Vector((math.cos(t) * radius, math.sin(t) * radius, z)) for t in (2 * math.pi * k / n for k in range(n + 1))]
    return lib.tube(name, pts, [thick] * (n + 1), M(mat), sides=6, cap=False, subsurf=0)


# --- lighthouse ------------------------------------------------------------------------------

LH_H = 14.0       # gallery height
STAIR_N, STAIR_TURNS, STAIR_A0 = 62, 1.6, math.radians(-150)


def lh_radius(z):
    return 2.4 - 0.8 * (z / LH_H)


def stair_angle(i):
    """Angle round the tower of stair step i (the stair winds clockwise as it climbs)."""
    return STAIR_A0 - STAIR_TURNS * 2 * math.pi * i / (STAIR_N - 1)


# the hatch in the gallery deck where the stair comes up through it: open above the last steps,
# so there is headroom all the way to the top (local angles, before the tower is placed)
HATCH = (stair_angle(STAIR_N - 1) + math.radians(3) + 2 * math.pi * 2, stair_angle(49) + math.radians(5) + 2 * math.pi * 2)


def in_hatch(a, margin=0.0):
    a = (a - HATCH[0]) % (2 * math.pi)
    return a < HATCH[1] - HATCH[0] + margin or a > 2 * math.pi - margin


def sector(name, r0, r1, z0, z1, a0, a1, mat, segs=24):
    """A slab of an annulus between radii r0..r1, heights z0..z1 and angles a0..a1."""
    bm = bmesh.new()
    sl = []
    for k in range(segs + 1):
        a = a0 + (a1 - a0) * k / segs
        c, s = math.cos(a), math.sin(a)
        sl.append([bm.verts.new((c * r, s * r, z)) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
    for k in range(segs):
        for j in range(4):
            bm.faces.new([sl[k][j], sl[k][(j + 1) % 4], sl[k + 1][(j + 1) % 4], sl[k + 1][j]])
    bm.faces.new(sl[0])
    bm.faces.new(list(reversed(sl[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib.obj_from_bm(name, bm, mat, smooth=False)


def arc_tube(name, radius, thick, mat, z, a0, a1, n=24):
    pts = [(math.cos(a0 + (a1 - a0) * k / n) * radius, math.sin(a0 + (a1 - a0) * k / n) * radius, z) for k in range(n + 1)]
    return lib.tube(name, pts, [thick] * (n + 1), M(mat), sides=6, cap=True, subsurf=0)


def lighthouse():
    """Returns (tower parts, stair parts, missing stair segment, lantern lens)."""
    parts = []
    bands = 6
    for b in range(bands):
        z0, z1 = LH_H * b / bands, LH_H * (b + 1) / bands
        parts.append(lib.lathe('lh_band', [(lh_radius(z0), z0), (lh_radius(z1), z1)], M('lh_red' if b % 2 else 'lh_white'), segs=28,
                               subsurf=0, close_top=False, close_bottom=b == 0))
    parts.append(box('lh_door', (1.1, 0.25, 2.1), (0, -lh_radius(1) - 0.05, 1.05), kit.M('door_green')))
    parts.append(box('lh_doorframe', (1.35, 0.2, 2.35), (0, -lh_radius(1) + 0.02, 1.15), M('wood_dark')))
    for k, z in enumerate((4.0, 7.5, 11.0)):
        a = math.radians(-90 + (k - 1) * 70)
        r = lh_radius(z)
        rot = Matrix.Rotation(a + math.pi / 2, 3, 'Z')
        parts.append(box('lh_window', (0.6, 0.2, 0.9), (math.cos(a) * r, math.sin(a) * r, z), M('glass'), rot=rot))
    # gallery deck and railing, open over the top of the stair
    h0, h1 = HATCH
    parts.append(lib.lathe('lh_gallery', [(0.0, LH_H), (1.45, LH_H), (1.45, LH_H + 0.25), (0.0, LH_H + 0.25)], M('lh_white'), segs=28, subsurf=0))
    parts.append(sector('lh_gallery', 1.45, 2.45, LH_H, LH_H + 0.25, h1, h0 + 2 * math.pi, M('lh_white')))
    for k in range(20):
        a = 2 * math.pi * k / 20
        if in_hatch(a, math.radians(4)):
            continue
        parts.append(lib.tube('lh_post', [(math.cos(a) * 2.35, math.sin(a) * 2.35, LH_H + 0.25), (math.cos(a) * 2.35, math.sin(a) * 2.35, LH_H + 1.25)],
                              [0.035, 0.035], M('tar'), sides=5, subsurf=0))
    parts.append(arc_tube('lh_rail', 2.35, 0.045, 'tar', LH_H + 1.25, h1, h0 + 2 * math.pi))
    parts.append(arc_tube('lh_rail', 2.35, 0.03, 'tar', LH_H + 0.7, h1, h0 + 2 * math.pi))
    # a rail round the inner edge of the hatch, so nobody steps back down it by accident
    parts.append(arc_tube('lh_rail', 1.5, 0.035, 'tar', LH_H + 1.0, h0 + math.radians(8), h1 - math.radians(2), n=12))
    # lantern room: iron mullions and glazing bars, copper dome, ball and a fish weathervane. The
    # glass is left undrawn (a few bars say it is there) so the lamp and lens show from outside.
    lz = LH_H + 0.25
    parts.append(lib.lathe('lh_sill', [(1.0, lz), (1.42, lz), (1.42, lz + 0.32), (1.3, lz + 0.36), (1.0, lz + 0.36)], M('lh_white'), segs=24, subsurf=0))
    for k in range(8):
        b = 2 * math.pi * k / 8
        parts.append(box('lh_mullion', (0.08, 0.08, 1.95), (math.cos(b) * 1.3, math.sin(b) * 1.3, lz + 1.32), M('tar')))
    for z in (lz + 0.36, lz + 1.3, lz + 2.25):
        parts.append(ring_tube('lh_bar', (0, 0, 0), 1.3, 0.035 if z < lz + 2 else 0.06, 'tar', z=z))
    parts.append(lib.lathe('lh_dome', [(1.55, lz + 2.25), (1.45, lz + 2.4), (0.9, lz + 2.95), (0.2, lz + 3.25), (0.0, lz + 3.3)], M('copper'), segs=24, subsurf=0))
    parts.append(lib.ellipsoid('lh_ball', (0, 0, lz + 3.45), (0.18, 0.18, 0.18), M('brass'), segs=(12, 8)))
    parts.append(lib.tube('lh_vane', [(0, 0, lz + 3.5), (0, 0, lz + 4.3)], [0.03, 0.02], M('tar'), sides=5, subsurf=0))
    parts.append(lib.ellipsoid('lh_fish', (0.15, 0, lz + 4.1), (0.35, 0.03, 0.1), M('brass'), segs=(10, 6)))
    # the lens: stacked glass rings round the lamp (left unfinished: Ada inks it in)
    lens = []
    for k in range(7):
        z = lz + 0.5 + k * 0.22
        r = 0.55 + 0.18 * math.sin(math.pi * k / 6)
        lens.append(lib.lathe('lens_ring', [(r * 0.85, z), (r, z + 0.09), (r * 0.85, z + 0.18)], M('lens'), segs=16, subsurf=0,
                              close_top=False, close_bottom=False))
    lens.append(lib.lathe('lens_base', [(0.0, lz + 0.05), (0.7, lz + 0.05), (0.6, lz + 0.5), (0.0, lz + 0.5)], M('brass'), segs=16, subsurf=0))
    # outside spiral stair from the door up to the gallery; a stretch of it is missing
    stairs, missing = [], []
    n = STAIR_N
    turns = STAIR_TURNS
    a0 = STAIR_A0
    for i in range(n):
        t = i / (n - 1)
        z = LH_H * t + 0.22
        a = stair_angle(i)
        r = lh_radius(min(z, LH_H)) + 0.55
        rot = Matrix.Rotation(a, 3, 'Z')
        step = box('lh_step', (1.0, 0.42, 0.12), (math.cos(a) * r, math.sin(a) * r, z), M('wood'), rot=rot)
        target = missing if 30 <= i < 38 else stairs
        target.append(step)
        if i % 2 == 0:
            ro = lh_radius(min(z, LH_H)) + 1.05
            post = lib.tube('lh_spost', [(math.cos(a) * ro, math.sin(a) * ro, z), (math.cos(a) * ro, math.sin(a) * ro, z + 1.05)],
                            [0.035, 0.03], M('wood_dark'), sides=5, subsurf=0)
            target.append(post)
        # a support bracket under every other step
        if i % 3 == 0 and i > 2:
            rb = lh_radius(min(z, LH_H))
            target.append(lib.tube('lh_bracket', [(math.cos(a) * (rb + 0.02), math.sin(a) * (rb + 0.02), z - 0.55),
                                                  (math.cos(a) * (rb + 0.85), math.sin(a) * (rb + 0.85), z - 0.06)], [0.04, 0.035], M('wood_dark'),
                                   sides=5, subsurf=0))
    # handrail along the outside edge (split the same way)
    for seg_range, target in (((0, 30), stairs), ((30, 38), missing), ((38, n), stairs)):
        pts = []
        for i in range(seg_range[0], seg_range[1] + (1 if seg_range[1] < n else 0)):
            t = min(i, n - 1) / (n - 1)
            z = LH_H * t + 0.22
            a = a0 - turns * 2 * math.pi * t
            ro = lh_radius(min(z, LH_H)) + 1.05
            pts.append((math.cos(a) * ro, math.sin(a) * ro, z + 1.05))
        if len(pts) > 1:
            target.append(lib.tube('lh_handrail', pts, [0.04] * len(pts), M('wood_dark'), sides=5, cap=False, subsurf=0))
    return parts, stairs, missing, lens


# --- sailboat ----------------------------------------------------------------------------------

def hull_mesh():
    """The dinghy's hull: U-shaped sections lofted from bow to stern, in two colours.
    Returns (hull object, the sections)."""
    sections = []
    L0, L1 = -2.3, 1.9
    for i in range(13):
        t = i / 12
        y = L0 + (L1 - L0) * t
        w = 0.95 * math.sin(math.pi * min(1.0, t * 1.15 + 0.05)) ** 0.7 if t < 0.95 else 0.7
        w = max(w, 0.05)
        d = 0.55 * (0.4 + 0.6 * math.sin(math.pi * min(1, t + 0.15)))
        top = 0.42 + 0.18 * (1 - t) ** 3
        ring = []
        for k in range(9):
            a = math.pi * k / 8
            ring.append(Vector((math.cos(a) * w, y, top - math.sin(a) * (d + top) * 0.9 + (0.0 if k in (0, 8) else 0.0))))
        sections.append(ring)
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in r] for r in sections]
    for a, b in zip(vr, vr[1:]):
        for k in range(8):
            bm.faces.new([a[k], a[k + 1], b[k + 1], b[k]])
    bm.faces.new(list(vr[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    hull = lib.obj_from_bm('hull', bm, M('hull'), smooth=False)
    hull.data.materials.append(M('hull_top'))
    for p in hull.data.polygons:
        if p.center.z > 0.25:
            p.material_index = 1
    so = hull.modifiers.new('s', 'SOLIDIFY')
    so.thickness = 0.05
    return hull, sections


def sailboat():
    """A small sailing dinghy, origin at the waterline amidships, bow towards -Y."""
    hull, sections = hull_mesh()
    parts = [hull]
    # gunwale rails, benches, mast, boom, sail, rudder and tiller
    for s in (1, -1):
        pts = [Vector((s * (sec[0].x - 0.02), sec[0].y, sec[0].z + 0.02)) for sec in sections[1:]]
        parts.append(lib.tube('gunwale', pts, [0.04] * len(pts), M('wood_dark'), sides=5, cap=False, subsurf=0))
    parts.append(box('thwart', (1.7, 0.35, 0.06), (0, -0.3, 0.25), M('wood')))
    parts.append(box('stern_bench', (1.3, 0.55, 0.06), (0, 1.15, 0.3), M('wood')))
    parts.append(box('floor', (1.1, 3.2, 0.04), (0, 0, -0.18), M('wood')))
    parts.append(lib.tube('mast', [(0, -0.9, -0.15), (0, -0.9, 4.4)], [0.07, 0.05], M('wood'), sides=8, subsurf=0))
    parts.append(lib.tube('boom', [(0, -0.85, 1.05), (0, 1.5, 1.0)], [0.045, 0.04], M('wood'), sides=8, subsurf=0))
    sail = []
    bm = bmesh.new()
    # triangle from the mast top to the boom end, gently bellied out to one side
    rows = 6
    grid = []
    for i in range(rows + 1):
        u = i / rows
        row = []
        for j in range(rows + 1 - i):
            v = j / rows
            p = Vector((0, -0.86, 1.12)) + Vector((0, 0, 3.2)) * u + Vector((0, 2.3, -0.06)) * v
            p.x += 0.35 * math.sin(math.pi * min(1, u + v)) * math.sin(math.pi * v / max(1e-3, 1 - u)) * (1 - u)
            row.append(bm.verts.new(p))
        grid.append(row)
    for i in range(rows):
        for j in range(rows - i):
            bm.faces.new([grid[i][j], grid[i][j + 1], grid[i + 1][j]])
            if j + 1 < len(grid[i + 1]):
                bm.faces.new([grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]])
    sail_ob = lib.obj_from_bm('sail', bm, M('sail'), smooth=False)
    sail.append(sail_ob)
    parts.append(box('rudder', (0.06, 0.45, 0.9), (0, 2.0, -0.1), M('wood_dark')))
    parts.append(lib.tube('tiller', [(0, 2.0, 0.4), (0, 1.25, 0.55)], [0.035, 0.03], M('wood'), sides=6, subsurf=0))
    parts.append(lib.tube('rope', [(0, -0.9, 4.3), (0, -2.25, 0.5)], [0.012, 0.012], M('rope'), sides=4, subsurf=0))
    return parts + nocol(sail)


# --- pier, stacks, inkwell, props ----------------------------------------------------------------

def pier(length=18.0, width=2.4):
    parts = []
    n = int(length / 0.35)
    rnd = random.Random(4)
    for i in range(n):
        y = i * 0.35
        parts.append(box('pplank', (width, 0.32, 0.08), (0, y, 1.25 + rnd.uniform(-0.01, 0.01)), M('wood'), rot=Matrix.Rotation(rnd.uniform(-0.02, 0.02), 3, 'Z')))
    for i in range(int(length / 2.4) + 1):
        y = i * 2.4
        for s in (-1, 1):
            parts.append(lib.tube('ppile', [(s * (width / 2 - 0.1), y, -3.0), (s * (width / 2 - 0.1), y, 1.9)], [0.13, 0.12], M('wood_dark'), sides=7, subsurf=0))
    for s in (-1, 1):
        parts.append(lib.tube('prail', [(s * (width / 2 - 0.1), 0, 1.85), (s * (width / 2 - 0.1), length - 0.3, 1.85)], [0.04, 0.04], M('rope'), sides=5, subsurf=0))
    return parts


def stack(seed, height=12.0, radius=3.0):
    """A sea stack: a ragged rock pillar with a grassy cap."""
    bm = bmesh.new()
    rings = 9
    segs = 14
    off = Vector((seed * 3.1, seed * 1.7, 0))
    vr = []
    for i in range(rings + 1):
        t = i / rings
        z = -4.0 + (height + 4.0) * t
        r = radius * (1.15 - 0.35 * t) * (1 + 0.15 * math.sin(t * 9 + seed))
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            n = noise.noise(Vector((math.cos(a) * 1.5, math.sin(a) * 1.5, t * 3)) + off)
            rr = r * (1 + 0.28 * n)
            ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z)))
        vr.append(ring)
    for a, b in zip(vr, vr[1:]):
        for k in range(segs):
            bm.faces.new([a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]])
    top = bm.verts.new((0, 0, height + 0.4))
    for k in range(segs):
        bm.faces.new([vr[-1][k], vr[-1][(k + 1) % segs], top])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rock = lib.obj_from_bm('stack', bm, M('rock'), smooth=False)
    cap = kit.blob('stack_grass', (0, 0, height + 0.1), radius * 0.75, kit.M('leaf2'), seed + 40, flat=0.25, lumps=0.15)
    cap['col'] = 0
    return [rock, cap]


def inkwell():
    """The giant ink bottle the sea pours out of. Origin at its base."""
    parts = []
    body = lib.lathe('iw_body', [(0.0, 0.0), (4.2, 0.0), (4.3, 0.4), (4.3, 4.2), (3.8, 4.9), (1.7, 5.6), (1.6, 6.6), (1.85, 6.8), (1.85, 7.2), (1.4, 7.25)],
                     M('glass'), segs=8, subsurf=0, close_top=False)
    body.data.transform(Matrix.Rotation(math.pi / 8, 4, 'Z'))
    parts.append(body)
    # the ink inside shows dark through the glass; a cork, half pulled out
    parts.append(lib.lathe('iw_cork', [(0.0, 6.9), (1.38, 6.9), (1.5, 8.2), (0.0, 8.25)], M('cork'), segs=16, subsurf=0))
    parts.append(lib.lathe('iw_ink', [(0.0, 7.0), (1.35, 7.0), (1.35, 7.05), (0.0, 7.05)], M('ink'), segs=16, subsurf=0))
    # the label, with a few lines of handwriting
    rot = Matrix.Rotation(0, 3, 'Z')
    parts.append(box('iw_label', (4.2, 0.06, 2.6), (0, -4.3, 2.4), M('label'), rot=rot))
    rnd = random.Random(2)
    for k in range(3):
        z = 3.2 - k * 0.6
        pts = [(-1.6 + i * 0.3, -4.36, z + 0.08 * math.sin(i * 1.7 + k) + rnd.uniform(-0.03, 0.03)) for i in range(12)]
        parts.append(lib.tube('iw_writing', pts, [0.04] * 12, M('ink'), sides=4, cap=False, subsurf=0))
    # spilled ink running down to the sea
    parts.append(lib.ellipsoid('iw_spill', (0, -5.4, 0.05), (2.2, 2.0, 0.08), M('ink'), segs=(16, 6)))
    return parts


def bottle():
    """A message in a bottle, floating on its side."""
    parts = [lib.lathe('bt_glass', [(0.0, -0.18), (0.08, -0.18), (0.085, 0.08), (0.03, 0.14), (0.03, 0.2), (0.0, 0.2)], M('glass'), segs=10, subsurf=0),
             lib.lathe('bt_cork', [(0.0, 0.2), (0.032, 0.2), (0.035, 0.25), (0.0, 0.25)], M('cork'), segs=8, subsurf=0),
             lib.tube('bt_note', [(0, 0, -0.12), (0, 0, 0.08)], [0.05, 0.05], M('label'), sides=8, subsurf=0)]
    for p in parts:
        p.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    return parts


def buoy(color='buoy_red'):
    return [lib.lathe('buoy', [(0.0, -0.3), (0.35, -0.1), (0.4, 0.2), (0.25, 0.5), (0.0, 0.55)], M(color), segs=12, subsurf=0),
            lib.tube('buoy_pole', [(0, 0, 0.5), (0, 0, 1.2)], [0.04, 0.03], M('tar'), sides=5, subsurf=0)]


def driftwood(seed):
    rnd = random.Random(seed)
    a = rnd.uniform(0, math.pi)
    d = Vector((math.cos(a), math.sin(a), 0))
    L = rnd.uniform(1.5, 3.2)
    return [lib.tube('drift', [-d * L / 2 + Vector((0, 0, 0.12)), d * 0.2 + Vector((0, 0, 0.16)), d * L / 2 + Vector((0, 0, 0.1))], [0.14, 0.12, 0.07],
                     kit.M('bark'), sides=6, subsurf=0)]


def lobster_pot():
    parts = [lib.lathe('pot', [(0.0, 0.0), (0.35, 0.0), (0.35, 0.3), (0.0, 0.32)], M('net'), segs=10, subsurf=0)]
    for k in range(5):
        a = math.pi * k / 4
        parts.append(lib.tube('pot_hoop', [(math.cos(a) * 0.36, math.sin(a) * 0.36 * 0, 0.0), (0, 0, 0.42), (-math.cos(a) * 0.36, 0, 0.0)],
                              [0.015] * 3, M('wood_dark'), sides=4, subsurf=0))
    return parts


def wreck():
    """Half of an old rowing boat, upturned on the sand."""
    hull, _ = hull_mesh()
    parts = [hull]
    lib.apply_modifiers(hull)
    hull.data.transform(Matrix.Rotation(math.pi * 0.85, 4, 'Y') @ Matrix.Scale(0.75, 4))
    return parts
