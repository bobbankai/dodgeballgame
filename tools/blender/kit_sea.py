"""
Kit for Chapter Two, the Folded Sea: lighthouse, sailboat, pier, sea stacks, the giant inkwell and
the bits of a fishing beach. Same conventions as kit.py: origin on the ground (or the waterline for
boats), front towards -Y, ob['col'] = 0 for walk-through parts.
"""
import math
import random

import bmesh
import numpy as np
from mathutils import Matrix, Vector

import kit
import lib
import sdf
from kit import box, nocol, sculpt
from sdf import V

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
    # an arched door of planks in a stone surround, a step up to it
    ry = -lh_radius(1.0)
    door = sdf.union(sdf.box((0, ry - 0.06, 0.95), (0.55, 0.06, 0.95), 0.02), sdf.cylinder((0, ry - 0.06, 1.9), 0.55, 0.06, 0.02, sdf.rot(90, 0, 0)), k=0.01)
    door = sdf.intersect(door, lambda P: 0.01 - P[:, 2])
    door = sdf.subtract(door, lambda P: np.maximum(np.abs(((P[:, 0] + 0.6) % 0.22) - 0.11) - 0.008, P[:, 1] - (ry - 0.1)), k=0.004)
    parts.append(sculpt('lh_door', door, (-0.8, ry - 0.4, -0.1), (0.8, ry + 0.3, 2.6), 0.014, kit.M('door_green'), 600))
    surround = sdf.subtract(sdf.union(sdf.box((0, ry - 0.08, 1.0), (0.78, 0.12, 1.0), 0.04), sdf.cylinder((0, ry - 0.08, 1.95), 0.78, 0.12, 0.04, sdf.rot(90, 0, 0)), k=0.02),
                            sdf.union(sdf.box((0, ry - 0.08, 0.95), (0.56, 0.3, 1.0), 0.0), sdf.cylinder((0, ry - 0.08, 1.9), 0.56, 0.3, 0.0, sdf.rot(90, 0, 0))), k=0.02)
    surround = sdf.displace(sdf.intersect(surround, lambda P: 0.01 - P[:, 2]), lambda P: 0.02 * (sdf.noise(P, 3.0, 5) - 0.5))
    parts.append(sculpt('lh_doorframe', surround, (-1.1, ry - 0.5, -0.1), (1.1, ry + 0.3, 2.9), 0.02, M('rock'), 900))
    parts.append(box('lh_step', (1.6, 0.6, 0.18), (0, ry - 0.45, 0.09), M('rock')))
    # deep-set windows with stone sills and a frame and cross of wood
    for k, z in enumerate((4.0, 7.5, 11.0)):
        a = math.radians(-90 + (k - 1) * 70)
        r = lh_radius(z) + 0.02
        rot = Matrix.Rotation(a + math.pi / 2, 3, 'Z')
        c = Vector((math.cos(a) * r, math.sin(a) * r, z))
        out = Vector((math.cos(a), math.sin(a), 0))
        parts.append(box('lh_window', (0.6, 0.14, 0.9), c - out * 0.04, M('glass'), rot=rot))
        for dz, sz in ((0.48, (0.82, 0.16, 0.1)), (-0.48, (0.82, 0.16, 0.1))):
            parts.append(box('lh_wframe', sz, c + out * 0.04 + Vector((0, 0, dz)), M('wood_dark'), rot=rot))
        for dx in (-0.36, 0.36):
            parts.append(box('lh_wframe', (0.1, 0.16, 1.06), c + out * 0.04 + rot @ Vector((dx, 0, 0)), M('wood_dark'), rot=rot))
        parts.append(box('lh_wframe', (0.05, 0.1, 0.9), c + out * 0.03, M('wood_dark'), rot=rot))
        parts.append(box('lh_wframe', (0.62, 0.1, 0.05), c + out * 0.03, M('wood_dark'), rot=rot))
        parts.append(box('lh_sill', (0.96, 0.3, 0.1), c + out * 0.12 + Vector((0, 0, -0.56)), M('rock'), rot=rot))
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
    """A sea stack: a ragged pillar of layered rock, ledges where the strata wear back, the sea
    gnawing its waist, a grassy cap."""
    zs = np.linspace(-4.0, height, 9)
    t = (zs + 4.0) / (height + 4.0)
    prof = [(float(radius * (1.15 - 0.35 * tt) * (1 + 0.13 * math.sin(tt * 9 + seed))), float(z)) for tt, z in zip(t, zs)]

    def rag(th, z):
        q = np.stack([np.cos(th) * 1.6, np.sin(th) * 1.6, z * 0.22], 1)
        return 1.0 + 0.3 * (sdf.noise(q, 1.0, seed) - 0.5) + 0.1 * (sdf.noise(q, 2.7, seed + 9) - 0.5)
    f = sdf.revolve(prof, rmod=rag)
    # strata: each bed of rock juts a little at its top edge
    def strata(P):
        # beds of uneven thickness, tilted a little, wearing back unevenly round the stack
        u = P[:, 2] / 1.25 + 0.9 * sdf.noise(P * V((1.0, 1.0, 0.15)), 0.35, seed) + 0.04 * P[:, 0]
        bed = (u % 1.0) ** 3
        return (0.12 + 0.14 * sdf.noise(P, 0.6, seed + 4)) * bed - 0.08
    f = sdf.displace(f, strata)
    f = sdf.intersect(f, lambda P: P[:, 2] - height, k=0.4)
    R = radius * 1.6
    rock = sculpt('stack', f, (-R, -R, -4.2), (R, R, height + 0.6), max(0.1, radius / 26), M('rock'), 1500, sharp=32.0)
    cap = kit.blob('stack_grass', (0, 0, height + 0.05), radius * 0.78, kit.M('leaf2'), seed + 40, flat=0.25, lumps=0.15)
    cap['col'] = 0
    return [rock, cap]


def inkwell():
    """The giant ink bottle the sea pours out of: an eight-sided bottle with rounded shoulders, a cork
    half pulled out, a label wrapped round it with a few lines of writing, ink spilling to the sea.
    Origin at its base."""
    parts = []
    oct_r = math.cos(math.pi / 8)

    def octagon(th, z):
        a = (th % (math.pi / 4)) - math.pi / 8
        return np.minimum(oct_r / np.cos(a), 1.0 + 0.0 * z)
    prof = [(4.0, -0.2), (4.25, 0.2), (4.3, 0.6), (4.3, 4.0), (4.0, 4.7), (2.9, 5.35), (1.75, 5.7), (1.6, 6.3), (1.62, 6.7), (1.85, 6.85), (1.85, 7.15)]
    body = sdf.revolve(prof, rmod=octagon)
    body = sdf.intersect(body, lambda P: np.maximum(-P[:, 2], P[:, 2] - 7.2), k=0.12)
    body = sdf.subtract(body, sdf.cylinder((0, 0, 7.3), 1.42, 0.3, 0.0), k=0.08)
    parts.append(sculpt('iw_body', body, (-5, -5, -0.4), (5, 5, 7.6), 0.06, M('glass'), 2200, sharp=40.0))
    cork = sdf.displace(sdf.revolve([(1.38, 6.85), (1.44, 7.6), (1.52, 8.2)]), lambda P: 0.03 * (sdf.noise(P, 4.0, 3) - 0.5))
    cork = sdf.intersect(cork, lambda P: np.maximum(6.86 - P[:, 2], P[:, 2] - 8.22), k=0.08)
    parts.append(sculpt('iw_cork', cork, (-2, -2, 6.6), (2, 2, 8.6), 0.03, M('cork'), 700))
    parts.append(lib.lathe('iw_ink', [(0.0, 7.0), (1.35, 7.0), (1.35, 7.05), (0.0, 7.05)], M('ink'), segs=24, subsurf=0))
    # the label: a band of paper wrapped round the front faces, its corners a little lifted
    label = sdf.intersect(sdf.shell(sdf.offset(body, 0.03), 0.05), lambda P: np.abs(P[:, 2] - 2.4) - 1.3,
                          lambda P: np.abs(np.arctan2(P[:, 0], -P[:, 1])) - 0.55, k=0.03)
    parts.append(sculpt('iw_label', label, (-3.5, -5, 0.8), (3.5, -2, 4.0), 0.03, M('label'), 900))
    rnd = random.Random(2)
    for k in range(3):
        z = 3.2 - k * 0.6
        pts = []
        for i in range(12):
            a = -0.42 + i * 0.075
            pts.append((math.sin(a) * 4.34, -math.cos(a) * 4.34, z + 0.08 * math.sin(i * 1.7 + k) + rnd.uniform(-0.03, 0.03)))
        parts.append(lib.tube('iw_writing', pts, [0.045] * 12, M('ink'), sides=5, cap=False, subsurf=0))
    # spilled ink running down to the sea
    spill = sdf.intersect(sdf.displace(sdf.ellipsoid((0, -5.6, 0.0), (2.4, 2.4, 0.12)), lambda P: 0.5 * (sdf.noise(P, 0.9, 4) - 0.5)),
                          lambda P: -0.02 - P[:, 2], k=0.05)
    parts.append(sculpt('iw_spill', spill, (-3.5, -9, -0.3), (3.5, -2.5, 0.4), 0.05, M('ink'), 500))
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
