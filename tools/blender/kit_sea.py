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
from sdf import V, box as sbox, tube

PAL = {
    'lh_white': '#EEE8DA', 'lh_red': '#B5423A', 'copper': '#3E6E66', 'glass': '#35507A', 'brass': '#C9A04A',
    'lens': '#E8D9A8', 'hull': '#2F6488', 'hull_top': '#EEE8DA', 'hull_in': '#E2D6BC', 'sail': '#F4EEDC', 'wood': '#9A7550', 'wood_dark': '#5E4632',
    'rope': '#B59A6A', 'drift': '#B9AE9A', 'rock': '#8E8A80', 'rock_dark': '#6E6A62', 'chalk': '#E4DDCB', 'ink': '#1F3C66', 'label': '#F0E6CC',
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

BOAT_L0, BOAT_L1 = -2.3, 1.9    # stem head and transom along Y (bow towards -Y)
PLANK = 0.03                     # thickness of the planking


def hull_lines(t):
    """The dinghy's lines at fraction t of its length (0 the stem head, 1 the transom): half-beam,
    sheer height, keel height and how full the section is (0 a V, towards 1 a round bilge)."""
    t = np.clip(t, 0.0, 1.0)
    # a fine entry, the beam a little aft of midships, then easing in to a broad transom
    w = np.where(t <= 0.58, 0.95 * np.sin(np.pi / 2 * np.minimum(1.0, t / 0.58)) ** 0.7, 0.95 - 0.25 * ((t - 0.58) / 0.42) ** 2)
    top = 0.42 + 0.2 * (1 - t) ** 3
    keel = -0.48 + 0.3 * np.maximum(0.0, (t - 0.5) / 0.5) ** 2
    # the forefoot: the keel sweeps up in a curve to the stem head
    fore = 1 - (1 - np.minimum(1.0, t / 0.26)) ** 2.4
    keel = top + (keel - top) * fore
    k = np.clip(t / 0.45, 0.0, 1.0)
    return w, top, keel, 0.85 * k * k * (3 - 2 * k)


def boat_y(t):
    return BOAT_L0 + (BOAT_L1 - BOAT_L0) * t


def hull_point(t, u, inset=0.0):
    """A point of the hull section at fraction t, u running from the keel (0) up to the sheer (1):
    (x, z, nx, nz) with the outward normal in the section plane. `inset` gives the inside of the
    planking (or a little further in, for the ribs)."""
    w, top, keel, k = hull_lines(t)
    D = top - keel
    w = w - np.minimum(inset, 0.4 * w)
    D = D - np.minimum(1.5 * inset, 0.4 * D)
    a = np.pi / 2 * u
    x = w * ((1 - k) * u + k * np.sin(a))
    z = top - D * ((1 - k) * (1 - u) + k * np.cos(a))
    dx = w * ((1 - k) + k * np.pi / 2 * np.cos(a))
    dz = D * ((1 - k) + k * np.pi / 2 * np.sin(a))
    n = np.hypot(dx, dz) + 1e-9
    return x, z, dz / n, -dx / n


def inner_half(t, z, inset=PLANK):
    """Half-width of the inside of the hull at height z (0 where z is below the inside of the keel)."""
    t = np.atleast_1d(np.asarray(t, float))
    lo, hi = np.zeros_like(t), np.ones_like(t)
    for _ in range(32):
        m = (lo + hi) / 2
        below = hull_point(t, m, inset)[1] < z
        lo, hi = np.where(below, m, lo), np.where(below, hi, m)
    x, zz = hull_point(t, lo, inset)[:2]
    return np.where(zz < z - 0.01, 0.0, x)


def dinghy_hull(name='hull', strakes=6):
    """The clinker hull, lofted section by section from the stem to the transom: each strake (plank)
    laps over the outside of the one below it, the laps fading out where the planks gather into the
    stem. Cream top strake, blue below, a cream inside, the transom in bare wood."""
    K, P, N = strakes, 3, 50
    ts = 0.012 + 0.988 * np.linspace(0.0, 1.0, N) ** 1.35
    # the outside, starboard, from the sheer down to (not including) the keel: (u, lap fraction, strake)
    out = [(1 - (j + i / P) / K, i / P, j) for j in range(K) for i in range(P + 1) if not (j == K - 1 and i == P)]
    uo = np.array([o[0] for o in out])
    fo = np.array([o[1] for o in out])
    ui = np.linspace(0.0, 1.0, K * P + 1)[1:]
    bm = bmesh.new()
    rings = []
    tags = None
    for t in ts:
        w = float(hull_lines(np.array([t]))[0][0])
        lap = 0.017 * min(1.0, w / 0.4)
        tt = np.full(len(uo), t)
        x, z, nx, nz = hull_point(tt, uo)
        x, z = x + nx * lap * fo, z + nz * lap * fo
        kx, kz, _, _ = hull_point(np.array([t]), np.array([0.0]))
        xi, zi, _, _ = hull_point(np.full(len(ui), t), ui, PLANK)
        _, kzi, _, _ = hull_point(np.array([t]), np.array([0.0]), PLANK)
        so = list(zip(x, z))
        si = list(zip(xi, zi))
        loop = ([(-a, b) for a, b in so] + [(0.0, float(kz[0]) - lap * 0.6)] + list(reversed(so)) +
                list(reversed(si)) + [(0.0, float(kzi[0]))] + [(-a, b) for a, b in si])
        if tags is None:
            js = [o[2] for o in out]
            tags = ([('o', j) for j in js] + [('o', K - 1)] + [('o', j) for j in reversed(js)] +
                    [('i', 0)] * len(si) + [('i', 0)] + [('i', 0)] * len(si))
        y = float(boat_y(t))
        rings.append([bm.verts.new((a, y, b)) for a, b in loop])
    L = len(rings[0])

    def seg_mat(m):
        a, b = tags[m], tags[(m + 1) % L]
        if a[0] == 'o' and b[0] == 'o':
            return 1 if min(a[1], b[1]) == 0 else 0
        if a[0] == 'i' and b[0] == 'i':
            return 2
        return 3
    mats = [seg_mat(m) for m in range(L)]
    for r0, r1 in zip(rings, rings[1:]):
        for m in range(L):
            m2 = (m + 1) % L
            f = bm.faces.new([r0[m], r0[m2], r1[m2], r1[m]])
            f.material_index = mats[m]
    caps = [bm.faces.new(rings[0]), bm.faces.new(list(reversed(rings[-1])))]
    caps[0].material_index, caps[1].material_index = 3, 4
    bmesh.ops.triangulate(bm, faces=caps, quad_method='BEAUTY', ngon_method='EAR_CLIP')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.obj_from_bm(name, bm, M('hull'), smooth=True)
    for m in ('hull_top', 'hull_in', 'wood_dark', 'wood'):
        ob.data.materials.append(M(m))
    return kit.soften(ob, 35.0)


def fitted_plank(name, y0, y1, ztop, thick, mat, n=10, into=0.012):
    """A seat or deck board cut to the curve of the hull at its height, ends square, edges eased."""
    ys = np.linspace(y0, y1, n)
    hw = inner_half((ys - BOAT_L0) / (BOAT_L1 - BOAT_L0), ztop - thick) + into
    outline = [(float(h), float(y)) for h, y in zip(hw, ys)] + [(-float(h), float(y)) for h, y in zip(hw[::-1], ys[::-1])]
    bm = bmesh.new()
    top = [bm.verts.new((x, y, ztop)) for x, y in outline]
    bot = [bm.verts.new((x, y, ztop - thick)) for x, y in outline]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(len(top)):
        j = (i + 1) % len(top)
        bm.faces.new([top[i], bot[i], bot[j], top[j]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    sharp = [e for e in bm.edges if e.calc_face_angle(0.0) > math.radians(50)]
    bmesh.ops.bevel(bm, geom=sharp, offset=min(0.012, thick * 0.3), segments=2, affect='EDGES', profile=0.5)
    return kit.soften(lib.obj_from_bm(name, bm, M(mat), smooth=True), 50.0)


def oar(name, a, b, blade=0.55):
    """A spoon-less oar from its grip `a` to its blade tip `b`: a round loom, a flat blade."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    L = (b - a).length
    pts = [a, a + d * 0.12, a + d * 0.16, a + d * (L - blade), a + d * (L - blade * 0.6), b]
    loom = lib.tube(name, pts[:4], [0.024, 0.024, 0.03, 0.026], M('wood'), sides=8, subsurf=0)
    flat = lib.tube(name + '_blade', pts[3:], [0.026, 0.06, 0.066], M('wood'), sides=8, subsurf=0, squash=0.22, normals=Vector((0, 0, 1)))
    return [loom, flat]


def sailboat():
    """A small clinker-built sailing dinghy, origin at the waterline amidships, bow towards -Y: the
    lofted clinker hull, a stem and keel in dark wood, ribs inside, a gunwale and rubbing strake,
    benches cut to the hull, floor boards, a pair of oars, a tapered mast and boom, a bellied sail,
    a shaped rudder and tiller."""
    L0, L1 = BOAT_L0, BOAT_L1
    parts = [dinghy_hull()]
    w0, top0, _, _ = hull_lines(np.array([0.0]))
    # stem and keel: one dark timber from the stem head, round the forefoot and aft to the transom
    tk = np.linspace(0.0, 1.0, 44) ** 1.7
    cy, cz = boat_y(tk), hull_lines(tk)[2]
    gy, gz = np.gradient(cy), np.gradient(cz)
    gn = np.hypot(gy, gz) + 1e-9
    pts = [(0.0, L0 - 0.012, float(top0[0]) + 0.07)]
    pts += [(0.0, float(y + gz_ / n * 0.014), float(z - gy_ / n * 0.014)) for y, z, gy_, gz_, n in zip(cy, cz, gy, gz, gn)][1:]
    parts.append(lib.tube('keel', pts, list(np.linspace(0.042, 0.034, len(pts))), M('wood_dark'), sides=8, subsurf=0))
    # the gunwale: a capping rail along the sheer, round the stem head and across the transom
    tg = np.linspace(0.02, 1.0, 22) ** 1.2
    w, top, _, _ = hull_lines(tg)
    ys = boat_y(tg)
    side = [(float(x), float(y), float(z) + 0.012) for x, y, z in zip(w - PLANK * 0.5, ys, top)]
    rail = [(-x, y, z) for x, y, z in reversed(side)] + [(0.0, L0 + 0.015, float(top0[0]) + 0.02)] + side
    parts.append(lib.tube('gunwale', rail, [0.03] * len(rail), M('wood_dark'), sides=8, subsurf=0))
    w1, t1 = float(w[-1]), float(top[-1])
    parts.append(lib.tube('transom_rail', [(-w1 + PLANK * 0.5, L1 - 0.012, t1 + 0.012), (w1 - PLANK * 0.5, L1 - 0.012, t1 + 0.012)],
                          [0.03, 0.03], M('wood_dark'), sides=8, subsurf=0))
    # rubbing strakes a hand below the sheer outside
    tr = np.linspace(0.05, 1.0, 20)
    w, top, _, _ = hull_lines(tr)
    for s in (1, -1):
        pts = [(s * (float(x) + 0.012), float(y), float(z) - 0.07) for x, y, z in zip(w, boat_y(tr), top)]
        parts.append(lib.tube('rubbing', pts, [0.018] * len(pts), M('wood_dark'), sides=6, subsurf=0, squash=0.6,
                              normals=Vector((s, 0, 0))))
    # ribs: bent frames inside the planking
    for t in np.linspace(0.2, 0.9, 7):
        u = np.linspace(0.0, 0.96, 12)
        x, z, _, _ = hull_point(np.full(len(u), t), u, PLANK + 0.012)
        y = float(boat_y(t))
        pts = [(-float(a), y, float(b)) for a, b in zip(x[::-1], z[::-1])][:-1] + [(float(a), y, float(b)) for a, b in zip(x, z)]
        parts.append(lib.tube('rib', pts, [0.016] * len(pts), M('wood'), sides=6, subsurf=0, squash=0.55))
    # floor boards laid on the ribs, each as long as the hull is wide enough for it
    zf, tf = -0.3, np.linspace(0.0, 1.0, 400)
    hw = inner_half(tf, zf - 0.03)
    for xc in (-0.24, 0.0, 0.24):
        ok = np.nonzero(hw > abs(xc) + 0.11)[0]
        if len(ok):
            y0, y1 = float(boat_y(tf[ok[0]])) + 0.04, float(boat_y(tf[ok[-1]])) - 0.04
            parts.append(box('floor', (0.2, y1 - y0, 0.03), (xc, (y0 + y1) / 2, zf - 0.015), M('wood')))
    # seats: the mast thwart, Ada's stern bench, Pip's bow seat, a little foredeck at the stem
    parts.append(fitted_plank('thwart', -1.03, -0.77, 0.24, 0.05, 'wood'))
    parts.append(fitted_plank('stern_bench', 0.88, 1.45, 0.33, 0.05, 'wood'))
    parts.append(fitted_plank('bow_seat', -1.67, -1.43, 0.2, 0.045, 'wood'))
    parts.append(fitted_plank('foredeck', L0 + 0.06, L0 + 0.48, float(hull_lines(np.array([0.115]))[1][0]) - 0.01, 0.035, 'wood_dark', n=8))
    parts += oar('oar', (0.5, 1.45, 0.4), (0.3, -1.58, 0.255))
    parts += oar('oar2', (-0.52, 1.4, 0.4), (-0.32, -1.56, 0.255))
    spars = sdf.union(sdf.tube([(0, -0.9, -0.38), (0, -0.9, 4.0), (0, -0.9, 4.4)], [0.07, 0.055, 0.045]),
                      sdf.tube([(0, -0.85, 1.05), (0, 1.5, 1.0)], [0.045, 0.038]),
                      sdf.torus((0, -0.9, 1.05), 0.075, 0.018), sdf.torus((0, -0.9, 0.255), 0.085, 0.02), k=0.01)
    parts.append(sculpt('mast', spars, (-0.3, -1.2, -0.5), (0.3, 1.7, 4.6), 0.012, M('wood'), 1700))
    # the sail: a triangle from the masthead to the boom end, bellied out, a hem round it
    bm = bmesh.new()
    rows = 14
    grid = []
    for i in range(rows + 1):
        u = i / rows
        row = []
        for j in range(rows + 1 - i):
            v = j / rows
            p = Vector((0, -0.86, 1.12)) + Vector((0, 0, 3.2)) * u + Vector((0, 2.3, -0.06)) * v
            p.x += 0.38 * math.sin(math.pi * min(1, u + v)) * math.sin(math.pi * v / max(1e-3, 1 - u)) * (1 - u) ** 0.8
            row.append(bm.verts.new(p))
        grid.append(row)
    for i in range(rows):
        for j in range(rows - i):
            bm.faces.new([grid[i][j], grid[i][j + 1], grid[i + 1][j]])
            if j + 1 < len(grid[i + 1]):
                bm.faces.new([grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]])
    hem = [grid[i][-1].co.copy() for i in range(rows + 1)] + [grid[0][j].co.copy() for j in range(rows, -1, -1)]
    sail_ob = lib.obj_from_bm('sail', bm, M('sail'), smooth=True)
    sail = [sail_ob, lib.tube('sailhem', hem, [0.016] * len(hem), M('sail'), sides=6, cap=False, subsurf=0)]
    blade = sdf.polygon2d([(0.0, 0.25), (0.18, 0.25), (0.26, -0.1), (0.2, -0.55), (0.02, -0.62), (-0.04, 0.0)])
    rudder = sdf.intersect(lambda P: blade(P[:, 1] - 1.93, P[:, 2] - 0.1), lambda P: np.abs(P[:, 0]) - 0.025 + 0.012 * (P[:, 1] - 1.93) / 0.26, k=0.008)
    parts.append(sculpt('rudder', rudder, (-0.2, 1.7, -0.7), (0.2, 2.4, 0.5), 0.01, M('wood_dark'), 500))
    for z in (0.22, -0.12):     # pintles hanging it on the transom
        parts.append(ring_tube('pintle', (0, 1.93, z), 0.035, 0.012, 'brass'))
    parts.append(sculpt('tiller', sdf.tube([(0, 2.0, 0.4), (0, 1.6, 0.5), (0, 1.25, 0.55)], [0.035, 0.03, 0.026]), (-0.2, 1.0, 0.2), (0.2, 2.2, 0.7), 0.01, M('wood'), 300))
    parts.append(lib.tube('rope', [(0, -0.9, 4.3), (0, L0 + 0.02, float(top0[0]) + 0.06)], [0.012, 0.012], M('rope'), sides=6, subsurf=0))
    return parts + nocol(sail)


# --- pier, stacks, inkwell, props ----------------------------------------------------------------

def pier(length=18.0, width=2.4):
    parts = []
    n = int(length / 0.35)
    rnd = random.Random(4)
    for i in range(n):
        y = i * 0.35
        parts.append(box('pplank', (width, 0.32, 0.08), (0, y, 1.25 + rnd.uniform(-0.01, 0.01)), M('wood'), rot=Matrix.Rotation(rnd.uniform(-0.02, 0.02), 3, 'Z')))
    ys = [i * 2.4 for i in range(int(length / 2.4) + 1)]
    for y in ys:
        for s in (-1, 1):
            x = s * (width / 2 - 0.1)
            lean = Vector((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), 0))
            parts.append(lib.tube('ppile', [(x, y, -3.0), Vector((x, y, 0.0)) + lean * 0.5, Vector((x, y, 1.95)) + lean],
                                  [0.15, 0.135, 0.12], M('wood_dark'), sides=12, subsurf=0))
            parts.append(ring_tube('prope_turn', (x + lean.x, y + lean.y, 0), 0.14, 0.028, 'rope', z=1.8))
    for s in (-1, 1):
        x = s * (width / 2 - 0.1)
        pts = []
        for a, b in zip(ys, ys[1:]):
            for t in np.linspace(0.0, 1.0, 7)[:-1]:
                pts.append((x, a + (b - a) * t, 1.8 - 0.16 * math.sin(math.pi * t)))
        pts.append((x, ys[-1], 1.8))
        parts.append(lib.tube('prail', pts, [0.026] * len(pts), M('rope'), sides=8, subsurf=0))
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
    """A mooring buoy: a fat round float with a band of the other colour, a pole and a ball topmark."""
    other = 'buoy_white' if color == 'buoy_red' else 'buoy_red'
    return [lib.lathe('buoy', [(0.0, -0.32), (0.22, -0.28), (0.36, -0.14), (0.42, 0.04), (0.42, 0.2), (0.34, 0.4), (0.18, 0.52), (0.0, 0.56)],
                      M(color), segs=32, subsurf=1),
            ring_tube('buoy_band', (0, 0, 0), 0.425, 0.045, other, z=0.12, n=40),
            lib.tube('buoy_pole', [(0, 0, 0.45), (0, 0, 1.25)], [0.04, 0.032], M('tar'), sides=10, subsurf=0),
            lib.ellipsoid('buoy_mark', (0, 0, 1.33), (0.1, 0.1, 0.1), M(other), segs=(16, 10))]


def driftwood(seed):
    """A sea-bleached branch: bent, forked, its ends worn to points, the grain standing out."""
    rnd = random.Random(seed)
    a = rnd.uniform(0, math.pi)
    d = V((math.cos(a), math.sin(a), 0))
    n = V((-d[1], d[0], 0))
    L = rnd.uniform(1.5, 3.2)
    pts = [d * (-L / 2 + L * t) + n * 0.12 * math.sin(t * 5 + seed) + V((0, 0, 0.12 + 0.04 * t)) for t in np.linspace(0, 1, 6)]
    f = tube(pts, [0.03, 0.13, 0.14, 0.12, 0.08, 0.02])
    fork = pts[2] + d * L * 0.25 + n * rnd.choice((-1, 1)) * L * 0.18 + V((0, 0, 0.05))
    f = sdf.union(f, tube([pts[2], (pts[2] + fork) / 2, fork], [0.08, 0.06, 0.015]), k=0.05)
    f = sdf.displace(f, lambda P: 0.012 * (sdf.noise(P - np.outer(P @ d, d) * 0.8, 9.0, seed) - 0.5) + 0.008 * (sdf.noise(P, 4.0, seed + 1) - 0.5))
    f = sdf.intersect(f, lambda P: -0.02 - P[:, 2])     # resting on the sand
    return [sculpt('drift', f, (-L / 2 - 0.6, -L / 2 - 0.6, -0.1), (L / 2 + 0.6, L / 2 + 0.6, 0.5), 0.012, M('drift'), 1600, sharp=40.0)]


def lobster_pot():
    """A creel: a wooden base, three bent hoops over it, netting stretched across them."""
    base = sbox((0, 0, 0.03), (0.38, 0.27, 0.03), 0.012)
    hoops = sdf.union(*[sdf.intersect(sdf.torus((x, 0, 0.05), 0.25, 0.016, sdf.rot(0, 90, 0)), lambda P: 0.04 - P[:, 2]) for x in (-0.3, 0.0, 0.3)])
    parts = [sculpt('pot_frame', sdf.union(base, hoops, k=0.01), (-0.5, -0.4, -0.05), (0.5, 0.4, 0.4), 0.008, M('wood_dark'), 1600)]

    def net(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2] - 0.05
        r = np.hypot(y, z)
        skin = np.maximum(np.abs(r - 0.245) - 0.006, np.maximum(-z, np.abs(x) - 0.3))
        ends = np.maximum(np.abs(np.abs(x) - 0.3) - 0.006, np.maximum(r - 0.245, -z))
        th = np.arctan2(z, y)
        u, v = th * 0.245 / 0.06, x / 0.06
        mesh = np.minimum(np.abs(u - np.round(u)), np.abs(v - np.round(v))) * 0.06 - 0.006
        cu, cv = y / 0.06, z / 0.06
        mesh_end = np.minimum(np.abs(cu - np.round(cu)), np.abs(cv - np.round(cv))) * 0.06 - 0.006
        return np.minimum(np.maximum(skin, mesh), np.maximum(ends, mesh_end))
    parts.append(sculpt('pot_net', net, (-0.45, -0.4, 0.0), (0.45, 0.4, 0.4), 0.005, M('net'), 3500))
    return parts


def wreck():
    """Half of an old rowing boat, upturned on the sand."""
    hull = dinghy_hull('wreck', strakes=5)
    hull.data.transform(Matrix.Rotation(math.pi * 0.85, 4, 'Y') @ Matrix.Scale(0.75, 4))
    return [hull]
