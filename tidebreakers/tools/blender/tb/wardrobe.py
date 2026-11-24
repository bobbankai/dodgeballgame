"""Reusable garments, hair styles and accessories for the cast (pipeline Garments and Parts).

Body-hugging clothing is extracted from the body topology and inflated onto its own sculpted surface
(Garment); things that hang free of the legs (coat skirts, aprons) are lofted rings around the legs'
outer silhouette with blended hip/thigh weights; hats, buckles, epaulettes, goggles are directly modelled
(Part). Long hair, braids, scarves, capes and coat tails get bone chains for runtime spring motion.
"""
import math
import numpy as np
from . import sdf, garment as G, polychar as pc, pipeline as P, skin
from .sdf import Ellipsoid, Sphere, Union, Intersect, Subtract, Offset, Plane, Func
from .character import srgb

v = G.v
norm = G.norm


def hexc(h):
    return srgb(h)


def lerp(a, b, t):
    return a + (b - a) * t


class Ctx:
    """Shared anatomy references for one character."""

    def __init__(self, sk, bd):
        self.sk, self.bd = sk, bd
        self.j = sk.j
        self.fa = bd.face_anchor
        self.u = self.fa['u']
        self.chin = self.fa['chin']
        sc = sk.s['height'] / 1.70
        self.sc = sc
        self.neck_base = self.j['neck'][2]
        self.z0 = sk.s['leg'] - 0.065 * sc
        self.waist = self.z0 + (self.neck_base - self.z0) * 0.37
        self.torso = bd.region(['torso', 'chest', 'spine', 'hips'], 0.03)
        self.legs = bd.region(['thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'hips', 'torso'], 0.03)
        self.neck = bd.region(['neck'], 0.02)
        self.knee_z = self.j['knee.L'][2]
        self.ankle_z = self.j['ankle.L'][2]

    def arm_region(self, side, fore=True):
        bones = [f'upperarm.{side}'] + ([f'forearm.{side}'] if fore else [])
        return self.bd.region(bones, 0.02)


def shade_z(lo, hi, amount):
    def paint(V, N, col):
        t = np.clip((V[:, 2] - lo) / max(hi - lo, 1e-6), 0, 1)
        return col * (1 - amount * (1 - t))[:, None]
    return paint


def band_paint(color, z, width):
    c = hexc(color)

    def paint(V, N, col):
        m = (np.abs(V[:, 2] - z) < width)[:, None] * 1.0
        return col * (1 - m) + c * m
    return paint


def chain(*fns):
    def paint(V, N, col):
        for f in fns:
            if f:
                col = f(V, N, col)
        return col
    return paint


# ------------------------------------------------------------------------------------------ cuts

def sleeve_cut(c, side, end):
    """Keeps the arm up to `end` (0 shoulder .. 1 elbow .. 2 wrist) measured along the arm."""
    sh, el, wr = c.j[f'shoulder.{side}'], c.j[f'elbow.{side}'], c.j[f'wrist.{side}']
    if end <= 1:
        p = lerp(sh, el, end)
        d = norm(el - sh)
    else:
        p = lerp(el, wr, end - 1)
        d = norm(wr - el)
    return Plane(d, p)  # negative on the shoulder side


def arm_select(c, side):
    sx = 1 if side == 'L' else -1
    return Func(lambda p: -(p[:, 0] * sx - 0.12 * c.sc), None, None)


# ------------------------------------------------------------------------------------------ garments

def shirt(c, color, sleeves=1.0, neck='round', offset=0.007, hem=None, name='shirt', paint=None, covers=True, thick=0.003):
    """sleeves: 0 none (tank), 0.5 short, 1.0 to the elbow, 1.9 long (to the wrist)."""
    hem = c.waist - 0.07 * c.sc if hem is None else hem
    parts = [c.torso]
    if sleeves > 0:
        parts += [c.arm_region('L', sleeves > 1), c.arm_region('R', sleeves > 1)]
    base = Offset(Union(parts, 0.03), offset)
    cuts = [G.above(hem)]
    if neck == 'round':
        cuts.append(pc.complement(Union([Ellipsoid(v(0, -0.07, c.neck_base - 0.005), v(0.06, 0.06, 0.05) * c.sc),
                                         Ellipsoid(v(0, 0.05, c.neck_base + 0.015), v(0.06, 0.06, 0.035) * c.sc)])))
    elif neck == 'v':
        cuts.append(pc.complement(Func(lambda p: np.maximum(np.abs(p[:, 0]) - 0.11 * np.clip((p[:, 2] - (c.neck_base - 0.16)) / 0.16, 0, 1), p[:, 1] + 0.01),
                                       v(-0.3, -0.4, 0.5), v(0.3, 0.0, 2.2))))
    if sleeves <= 0:
        cuts.append(pc.complement(Union([Sphere(c.j[f'shoulder.{s}'] + v(sx * 0.03, 0, -0.035) * c.sc, 0.083 * c.sc) for s, sx in (('L', 1), ('R', -1))])))
    else:
        for s in 'LR':
            cuts.append(sleeve_cut(c, s, sleeves))
    return P.Garment(name, base, Intersect(cuts), hexc(color), thickness=thick, covers=covers, paint=paint)


def trousers(c, color, cuff=None, flare=0.012, loose=0.012, top=None, name='trousers', paint=None, thick=0.004):
    cuff = c.ankle_z + 0.05 if cuff is None else cuff
    top = c.waist + 0.01 if top is None else top
    leg = lambda s: c.bd.region([f'thigh.{s}', f'shin.{s}', 'hips'], 0.03)
    split = G.split_legs(G.flare(leg('L'), loose, flare, c.sk.s['leg'], cuff), G.flare(leg('R'), loose, flare, c.sk.s['leg'], cuff),
                         G.flare(c.legs, loose, flare, c.sk.s['leg'], cuff), c.z0 - 0.12 * c.sc, blend=0.05)
    base = G.folds(split, 0.002, 30, noise=0.7, seed=4)
    # loose trouser legs fold over a long stretch at the knee instead of pinching into the calf
    soft = 4 + int(round((loose + flare) / 0.006))
    return P.Garment(name, base, Intersect([G.below(top), G.above(cuff)]), hexc(color), thickness=thick, paint=paint, soft=soft)


def boots(c, color, top=None, name='boots', loose=0.014, paint=None):
    top = c.knee_z - 0.06 * c.sc if top is None else top
    f = c.bd.region(['shin.L', 'shin.R', 'foot.L', 'foot.R', 'toe.L', 'toe.R'], 0.02)
    base = Offset(f, loose)
    return P.Garment(name, base, Intersect([G.below(top), G.above(-0.05)]), hexc(color), cls='leather', thickness=0.006, paint=paint,
                     region=lambda p: p[:, 2] < top + 0.02)


def shoes(c, color, name='shoes'):
    return boots(c, color, top=c.ankle_z + 0.04, name=name)


def belt(c, color, z=None, width=0.022, buckle='#d8b24a', offset=0.02, name='belt'):
    z = c.waist + 0.0 if z is None else z
    g = P.Garment(name, Offset(c.torso, offset), G.slab((0, 0, 1), z - width, z + width), hexc(color), cls='leather', thickness=0.008, covers=False,
                  weights='body')
    V, F = pc.box_mesh(v(0, -0.13 * c.sc - offset, z), (0.024, 0.006, 0.02), None, bevel=0.003)
    b = P.Part(name + 'buckle', V, F, hexc(buckle), cls='metal', weights=('rigid', 'hips'))
    return [g, b]


def sash(c, color, z=None, offset=0.03, name='sash'):
    z = c.waist if z is None else z
    return P.Garment(name, Offset(c.torso, offset), G.slab((0, 0, 1), z - 0.03, z + 0.03), hexc(color), thickness=0.01, covers=False)


def skirt_loft(c, color, z_top, z_bot, offset=0.03, flare=0.12, name='skirt', front_open=0.0, back_slit=0.0, n=28, rings=9,
               paint=None, cls='cloth', thick=0.006):
    """A garment that hangs free of the legs (coat skirt, dress, apron): rings around the hips/legs'
    outer silhouette, flaring toward the hem. Weighted to the hips, blending onto each thigh lower down."""
    field = Offset(c.legs, offset)
    V, F, rings_idx = [], [], []
    for i in range(rings):
        t = i / (rings - 1)
        z = z_top + (z_bot - z_top) * t
        cy = 0.0
        center = v(0, cy, z)
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            d = v(math.cos(a), math.sin(a), 0)
            ts = np.arange(0.0, 0.5, 0.002)
            pts = center[None] + d[None] * ts[:, None]
            vals = field.eval(pts)
            inside = np.nonzero(vals < 0)[0]
            r = ts[inside[-1]] if len(inside) else 0.12
            r = r + flare * t * t
            ring.append(len(V))
            V.append(center + d * r)
        rings_idx.append(ring)
    V = np.array(V)
    # smooth each ring a little (silhouette of two legs becomes one drape)
    for ring in rings_idx:
        P_ = V[ring]
        for _ in range(3):
            P_ = (np.roll(P_, 1, 0) + P_ * 2 + np.roll(P_, -1, 0)) / 4
        V[ring] = P_
    for r0, r1 in zip(rings_idx[:-1], rings_idx[1:]):
        for k in range(n):
            a = 2 * math.pi * (k + 0.5) / n
            front = math.sin(a) < 0 and abs(math.cos(a)) < front_open
            back = math.sin(a) > 0 and abs(math.cos(a)) < back_slit
            if front or back:
                continue
            k1 = (k + 1) % n
            F.append((r0[k], r1[k], r1[k1], r0[k1]))
    Vs, Fs = pc.shell(V, F, thick)
    zt, zb = z_top, z_bot

    def weights(Vp):
        bones = c.sk.deform_names()
        W = np.zeros((len(Vp), len(bones)))
        t = np.clip((zt - Vp[:, 2]) / max(zt - zb, 1e-6), 0, 1)
        side = 1 / (1 + np.exp(-Vp[:, 0] / 0.04))
        leg = 0.65 * t ** 1.2
        W[:, bones.index('hips')] = 1 - leg
        W[:, bones.index('thigh.L')] = leg * side
        W[:, bones.index('thigh.R')] = leg * (1 - side)
        return bones, W
    part = P.Part(name, Vs, Fs, hexc(color), cls=cls, weights=('custom', weights), paint=paint)
    return part


def scarf(c, color, offset=0.022, tails=True, name='scarf'):
    base = Offset(c.neck, offset)
    g = P.Garment(name, base, G.slab((0, 0, 1), c.neck_base - 0.02, c.neck_base + 0.045 * c.sc), hexc(color), thickness=0.012, covers=False,
                  region=lambda p: p[:, 2] < c.chin + 0.01)
    out = [g]
    if tails:
        k0 = v(0.04, -0.07, c.neck_base - 0.01)
        pts = [k0, k0 + v(0.02, -0.03, -0.08), k0 + v(0.03, -0.035, -0.18), k0 + v(0.035, -0.03, -0.28)]
        names = c.sk.add_chain('scarf', pts, 'chest')
        out.append(strip(name + 'tail', pts, [0.035, 0.038, 0.036, 0.03], 0.008, v(0, -1, 0), color, ('chain', names)))
    return out


def strip(name, pts, width, thick, normal, color, weights, cls='cloth', paint=None):
    pts = np.asarray(pts, float)
    w = np.broadcast_to(np.asarray(width, float), (len(pts),))
    V, F = pc.tube(pts, w, n=6, normals=np.tile(normal, (len(pts), 1)), flat=thick / float(np.mean(w)), cap_tip=True, cap_root=True)
    return P.Part(name, V, F, hexc(color), cls=cls, weights=weights, paint=paint)


def cape(c, color, length=0.75, width=0.36, name='cape', lining=None):
    """Three spring chains down the back carrying a cloth sheet."""
    nb = c.neck_base
    cols = []
    for k, x in enumerate((-width / 2, 0.0, width / 2)):
        top = v(x * 0.7, 0.11 * c.sc, nb - 0.02)
        pts = [top + v(x * 0.3 * t, 0.05 * t + 0.02 * t * t, -length * t) for t in np.linspace(0, 1, 5)]
        names = c.sk.add_chain(f'cape{k}', pts, 'chest')
        cols.append((pts, names))
    V, F, rows = [], [], []
    nr = 5
    for r in range(nr):
        row = []
        for k in range(3):
            row.append(len(V))
            V.append(cols[k][0][r] + v(0, 0.006, 0))
        rows.append(row)
    for r in range(nr - 1):
        for k in range(2):
            F.append((rows[r][k], rows[r + 1][k], rows[r + 1][k + 1], rows[r][k + 1]))
    Vs, Fs = pc.shell(np.array(V), F, 0.008)
    allnames = [cols[0][1], cols[1][1], cols[2][1]]

    def weights(Vp):
        bones = c.sk.deform_names()
        W = np.zeros((len(Vp), len(bones)))
        for i, p in enumerate(Vp):
            kx = np.clip((p[0] / (width / 2) + 1), 0, 2)
            t = np.clip((nb - 0.02 - p[2]) / length * 4, 0, 3.999)
            seg = int(t)
            for k in range(3):
                wk = max(0, 1 - abs(kx - k))
                W[i, bones.index(allnames[k][seg])] += wk
            if t < 0.5:
                W[i] *= t / 0.5
                W[i, bones.index('chest')] += 1 - t / 0.5
        return bones, W
    return P.Part(name, Vs, Fs, hexc(color), weights=('custom', weights), paint=shade_z(nb - length, nb, 0.25))


# ------------------------------------------------------------------------------------------ hats & props

def _merge(parts):
    Vs, Fs, off = [], [], 0
    for V, F in parts:
        Vs.append(np.asarray(V, float))
        Fs += [tuple(i + off for i in f) for f in F]
        off += len(V)
    return np.concatenate(Vs), Fs


def disc(center, r_out, r_in, axis=(0, 0, 1), n=24, thick=0.006, squash=(1, 1)):
    """A flat ring (hat brims)."""
    axis = norm(np.asarray(axis, float))
    X = norm(np.cross(axis, [0, 1.0, 0]) if abs(axis[1]) < 0.9 else np.cross(axis, [1.0, 0, 0]))
    Y = np.cross(axis, X)
    V, F = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        dx, dy = math.cos(a) * squash[0], math.sin(a) * squash[1]
        V.append(center + (X * dx + Y * dy) * r_out)
        V.append(center + (X * dx + Y * dy) * r_in)
    for k in range(n):
        k1 = (k + 1) % n
        F.append((2 * k, 2 * k1, 2 * k1 + 1, 2 * k + 1))
    return pc.shell(np.array(V), F, thick)


def cylinder(center, r, h, n=16, axis=(0, 0, 1)):
    pts = [center + np.asarray(axis) * h * t for t in (0, 0.5, 1)]
    return pc.tube(pts, [r, r, r], n=n, cap_tip=True, cap_root=True)


def hat_cap(c, color, band='#23305c', badge='#d8a93c', name='cap'):
    top = c.fa['cranium'] + v(0, 0, 0.07) * c.u
    crown = pc.quad_sphere(top + v(0, 0.0, 0.0), (0.105 * c.u, 0.118 * c.u, 0.05 * c.u))
    brim = disc(top + v(0, 0, -0.035 * c.u), 0.108 * c.u, 0.06 * c.u, squash=(1.0, 1.1))
    # a short visor at the brow, angled only slightly, so the eyes stay readable from above
    visor = pc.box_mesh(top + v(0, -0.118 * c.u, -0.03 * c.u), (0.055 * c.u, 0.026 * c.u, 0.005), sdf.rot_x(0.18), bevel=0.004)
    badgeM = pc.quad_sphere(top + v(0, -0.115 * c.u, 0.0), (0.018 * c.u, 0.008, 0.016 * c.u), res=2)
    return [P.Part(name, *_merge([crown, brim]), hexc(color), weights=('rigid', 'head')),
            P.Part(name + 'visor', *visor, hexc(band), cls='leather', weights=('rigid', 'head')),
            P.Part(name + 'badge', *badgeM, hexc(badge), cls='metal', weights=('rigid', 'head'))]


def hat_tricorn(c, color, trim='#c9a24a', name='tricorn'):
    top = c.fa['cranium'] + v(0, 0.01, 0.06) * c.u
    crown = pc.quad_sphere(top, (0.1 * c.u, 0.11 * c.u, 0.07 * c.u))
    V, F = [], []
    n = 30
    for k in range(n):
        a = 2 * math.pi * k / n
        lift = 0.035 * c.u * (0.5 + 0.5 * math.cos(3 * (a + math.pi / 2)))
        r_out = 0.19 * c.u * (0.85 + 0.15 * math.cos(3 * (a + math.pi / 2)))
        d = v(math.cos(a), math.sin(a), 0)
        V.append(top + d * r_out + v(0, 0, -0.03 * c.u + lift))
        V.append(top + d * 0.085 * c.u + v(0, 0, -0.045 * c.u))
    for k in range(n):
        k1 = (k + 1) % n
        F.append((2 * k, 2 * k1, 2 * k1 + 1, 2 * k + 1))
    brim = pc.shell(np.array(V), F, 0.008)
    return [P.Part(name, *_merge([crown, brim]), hexc(color), weights=('rigid', 'head'),
                   paint=lambda Vp, N, col: col * 0.9 + hexc(trim) * 0.1)]


def hat_bicorne(c, color, trim='#d8b24a', name='bicorne'):
    top = c.fa['cranium'] + v(0, 0.0, 0.08) * c.u
    body = pc.quad_sphere(top + v(0, 0, 0.02 * c.u), (0.22 * c.u, 0.06 * c.u, 0.1 * c.u), res=4)
    V = body[0].copy()
    # flatten the bottom and pinch the ends upward (crescent)
    rel = V - top
    rel[:, 2] = np.maximum(rel[:, 2], -0.02 * c.u) + 0.04 * c.u * (rel[:, 0] / (0.22 * c.u)) ** 2
    V = top + rel
    return [P.Part(name, V, body[1], hexc(color), weights=('rigid', 'head'), paint=band_paint(trim, top[2] - 0.01 * c.u, 0.012))]


def hat_top(c, color, band='#7a1f2a', name='tophat'):
    top = c.fa['cranium'] + v(0, 0.01, 0.07) * c.u
    crown = cylinder(top + v(0, 0, -0.02 * c.u), 0.085 * c.u, 0.2 * c.u, n=18)
    brim = disc(top + v(0, 0, -0.02 * c.u), 0.16 * c.u, 0.08 * c.u, n=24, thick=0.008)
    bandM = cylinder(top + v(0, 0, -0.012 * c.u), 0.088 * c.u, 0.035 * c.u, n=18)
    return [P.Part(name, *_merge([crown, brim]), hexc(color), weights=('rigid', 'head')),
            P.Part(name + 'band', *bandM, hexc(band), weights=('rigid', 'head'))]


def helmet(c, color, crest=None, name='helmet'):
    top = c.fa['cranium'] + v(0, 0.0, 0.02) * c.u
    dome = pc.quad_sphere(top, (0.118 * c.u, 0.128 * c.u, 0.11 * c.u), res=4)
    V = dome[0].copy()
    V[:, 2] = np.maximum(V[:, 2], top[2] - 0.02 * c.u)
    parts = [P.Part(name, V, dome[1], hexc(color), cls='metal', weights=('rigid', 'head'))]
    if crest:
        cr = pc.box_mesh(top + v(0, 0.0, 0.11 * c.u), (0.012, 0.11 * c.u, 0.03 * c.u), None, bevel=0.004)
        parts.append(P.Part(name + 'crest', *cr, hexc(crest), weights=('rigid', 'head')))
    return parts


def epaulettes(c, color='#d8b24a', fringe=True, name='epaulette'):
    out = []
    skin = c.bd.field()

    def top(x, y, z0):
        # highest point of the body on a vertical line (the shoulder's upper surface)
        zs = np.arange(z0 + 0.2, z0 - 0.2, -0.002)
        d = skin.eval(np.stack([np.full_like(zs, x), np.full_like(zs, y), zs], 1))
        ins = np.nonzero(d < 0)[0]
        return zs[ins[0]] if len(ins) else z0

    for s, sx in (('L', 1), ('R', -1)):
        sh = c.j[f'shoulder.{s}']
        # sit on the shoulder (over the coat), tilted to the shoulder's slope
        xi, xo = sh[0] - sx * 0.035 * c.sc, sh[0] + sx * 0.03 * c.sc
        zi, zo = top(xi, sh[1], sh[2]), top(xo, sh[1], sh[2])
        # centred over the inner shoulder (it moves with the collarbone this is attached to; the outer part
        # drops with the arm), resting on the coat
        tilt = 0.6 * math.atan2(zo - zi, abs(xo - xi))
        cen = v(sh[0] - sx * 0.022 * c.sc, sh[1], zi + 0.016 * c.sc)
        pV, pF = pc.quad_sphere(v(0, 0, 0), (0.07 * c.sc, 0.06 * c.sc, 0.02 * c.sc), res=3)
        ct, st = math.cos(tilt), math.sin(tilt)
        R = np.array([[ct, 0, -st * sx], [0, 1, 0], [st * sx, 0, ct]])
        pad = (pV @ R.T + cen, pF)
        parts = [pad]
        if fringe:
            for k in range(7):
                a = (k / 6 - 0.5) * math.pi * 0.9
                p0 = cen + v(sx * math.cos(a) * 0.06, math.sin(a) * 0.05, -0.01) * c.sc
                parts.append(pc.tube([p0, p0 + v(sx * 0.01, 0, -0.05 * c.sc)], [0.004, 0.003], n=4, cap_tip=True, cap_root=True))
        out.append(P.Part(f'{name}{s}', *_merge(parts), hexc(color), cls='metal', weights=('rigid', f'shoulder.{s}')))
    return out


def buttons(c, color, z_from, z_to, n=4, y=-0.1, x=0.0, name='buttons'):
    parts = []
    for i in range(n):
        z = z_from + (z_to - z_from) * i / max(n - 1, 1)
        # find the garment front at this height
        parts.append(pc.quad_sphere(v(x, y, z), (0.011 * c.sc, 0.006, 0.011 * c.sc), res=2))
    return P.Part(name, *_merge(parts), hexc(color), cls='metal', weights='body')


def goggles(c, lens='#7fd8ff', frame='#7a5230', name='goggles'):
    out = []
    # pushed up onto the hair above the fringe, so they never read as covering the eyes
    zf = c.chin + 0.245 * c.u
    for sx in (1, -1):
        cen = v(sx * 0.04 * c.u, -0.083 * c.u, zf)
        ring = pc.tube([cen + v(0, -0.004, 0), cen + v(0, -0.022, 0)], [0.026 * c.u, 0.024 * c.u], n=12, cap_tip=False, cap_root=False)
        lensM = pc.quad_sphere(cen + v(0, -0.02, 0), (0.022 * c.u, 0.006, 0.022 * c.u), res=2)
        out.append(P.Part(f'{name}rim{sx}', *ring, hexc(frame), cls='leather', weights=('rigid', 'head')))
        out.append(P.Part(f'{name}lens{sx}', *lensM, hexc(lens), cls='glow', weights=('rigid', 'head')))
    hn = norm(v(0, 0.2, 1))
    cc = float(v(0, -0.088 * c.u, zf) @ hn)
    out.append(P.Garment(name + 'strap', Offset(c.bd.head_field, 0.008 * c.u), G.slab(hn, cc - 0.01 * c.u, cc + 0.01 * c.u), hexc(frame), cls='leather',
                         thickness=0.003, covers=False, region=lambda p: p[:, 2] > c.chin + 0.1 * c.u, weights=('rigid', 'head')))
    return out


# ------------------------------------------------------------------------------------------ hair

def strand_grooves(c, n=30, depth=0.0026, whorl=None):
    """Strands sculpted into the hair volume: shallow ridges and sharper grooves fanning out from the crown
    whorl, so the toon shading and ink lines pick out locks instead of a smooth helmet."""
    fa, u = c.fa, c.u
    w = fa['crown'] + v(0, 0.035, -0.01) * u if whorl is None else whorl

    def disp(V, N):
        rel = V - w
        ang = np.arctan2(rel[:, 0], -rel[:, 1])
        # the fan gets a slight swirl with distance from the whorl, like hair growing round it
        r = np.linalg.norm(rel, axis=1)
        a = ang + 2.2 * r / u
        ridge = np.abs(np.sin(a * n * 0.5)) ** 0.55 - 0.62
        fade = np.clip((r - 0.02 * u) / (0.04 * u), 0, 1)
        return depth * u * ridge * fade
    return disp


def hair_cap(c, color, front=0.2, sides=0.13, back=0.07, thick=0.02, dark=None, light=None, name='haircap', strands=30):
    capf = G.hair_cap(c.bd, thick, front=front, sides=sides, back=back)
    paint = hair_paint(dark or color, light or color)
    return P.Garment(name, Offset(c.bd.head_field, thick * c.u), capf.items[1], hexc(color), cls='hair', thickness=0.0, covers=True,
                     region=lambda p: p[:, 2] > c.chin + 0.05 * c.u, weights=('rigid', 'head'), paint=paint,
                     displace=strand_grooves(c, strands) if strands else None)


def lock_mesh(pts, ws, ts, ns, n=10):
    """An anime hair lock: arched on its outer face, flatter underneath, with blade-thin edges that bend
    back toward the head, tapering to a point. (pts, widths, thicknesses, outward normals) per ring."""
    pts = np.asarray(pts, float)
    V, F, rings = [], [], []
    for i, p in enumerate(pts):
        t = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        t = t / max(np.linalg.norm(t), 1e-9)
        X = np.asarray(ns[i], float)
        X = X - t * np.dot(X, t)
        X = X / max(np.linalg.norm(X), 1e-9)
        Y = np.cross(t, X)
        w, th = max(ws[i], 1e-4), max(ts[i], 1e-4)
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            s, co = math.sin(a), math.cos(a)
            out = th * co * (1.0 if co > 0 else 0.4) - th * 0.6 * s ** 4
            ring.append(len(V))
            V.append(p + X * out + Y * w * s)
        rings.append(ring)
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for k in range(n):
            k1 = (k + 1) % n
            F.append((r0[k], r0[k1], r1[k1], r1[k]))
    tip = len(V)
    V.append(pts[-1] + (pts[-1] - pts[-2]) * 0.35)
    last = rings[-1]
    for k in range(0, n, 2):
        F.append((last[k], last[(k + 1) % n], last[(k + 2) % n], tip))
    root = len(V)
    V.append(pts[0] - (pts[1] - pts[0]) * 0.3)
    first = rings[0]
    for k in range(0, n, 2):
        F.append((first[(k + 2) % n], first[(k + 1) % n], first[k], root))
    return np.array(V), F


def hair_paint(dark, light):
    d, l = hexc(dark), hexc(light)

    def paint(V, N, col):
        t = np.clip(N[:, 2] * 0.5 + 0.5, 0, 1)[:, None]
        return d * (1 - t) + l * t
    return paint


def comb_lock(c, theta, phi, length, width, direction, thick=0.3, droop=0.5, lift=0.0, curl=0.3, twist=0.0,
              cap=0.02, layer=0.0, release=None, steps=12, **_):
    """A lock combed over the head: rooted in the hair volume, it follows the scalp at the hair's thickness
    (each layer a little further out, the tip standing off so locks overlap like shingles), bends with gravity,
    leaves the head below `release` (height above the chin, head units) and falls free, its tip curling in.
    Returns (points, widths, thicknesses, outward normals) for lock_mesh."""
    head = c.bd.head_field
    u, fa = c.u, c.fa
    rel_z = fa['chin'] + (0.1 if release is None else release) * u
    root, n0 = G.scalp_point(fa, theta, phi)
    d = norm(np.asarray(direction, float))
    seg = length * u / (steps - 1)
    p = root.copy()
    pts, ns = [], []
    hug = True
    for i in range(steps):
        t = i / (steps - 1)
        g = sdf.gradient(head, p[None], 0.001)[0]
        n = norm(g)
        h = (cap * 0.85 + layer + lift * 0.25) * u + t * 0.012 * u
        if hug:
            p = p - n * (head.eval(p[None])[0] - h)
            if p[2] < rel_z and i > 1:
                hug = False
        else:
            dd = head.eval(p[None])[0]
            if dd < h:
                p = p + n * (h - dd)
        pts.append(p.copy())
        ns.append(n)
        # next direction: along the surface while hugging, gravity pulling harder toward the tip, tips curl in
        down = v(0, 0, -1)
        d = norm(d + down * droop * (0.15 + 0.5 * t))
        if t > 0.6:
            d = norm(d - n * curl * 0.35 * (t - 0.6) / 0.4)
        if hug:
            d = norm(d - n * np.dot(d, n))
        p = p + d * seg
    pts = np.array(pts)
    tt = np.linspace(0, 1, steps)
    ws = width * u * (0.62 + 0.55 * np.sin(np.pi * np.minimum(tt * 1.15, 1))) * (1 - tt) ** 0.7
    ws = np.maximum(ws, 0.0008)
    ts = np.maximum(ws * thick, 0.0006)
    ns = np.array(ns)
    if twist:
        for i in range(steps):
            tg = pts[min(i + 1, steps - 1)] - pts[max(i - 1, 0)]
            tg = norm(tg)
            side = np.cross(tg, ns[i])
            a = twist * tt[i]
            ns[i] = norm(ns[i] * math.cos(a) + side * math.sin(a))
    return pts, ws, ts, ns


def clumps(c, specs, color, dark=None, light=None, name='hair', weights=('rigid', 'head')):
    Vs, Fs, off = [], [], 0
    for sp in specs:
        kw = dict(sp[5]) if len(sp) > 5 else {}
        if kw.pop('comb', True):
            # combed over the head (see comb_lock): the hair mass is made of overlapping locks
            kw.pop('steps', None)
            pts, ws, ts, ns = comb_lock(c, *sp[:5], **kw)
        else:
            # free-standing (spikes): at least ten rings; roots sink a little into the hair volume
            kw['steps'] = max(kw.get('steps', 7), 10)
            kw['lift'] = kw.get('lift', 0.004) - 0.004
            pts, ws, ts, ns = G.clump_data(c.fa, *sp[:5], **kw)
        V, F = lock_mesh(pts, ws, ts, ns)
        Vs.append(V)
        Fs += [tuple(i + off for i in f) for f in F]
        off += len(V)
    return P.Part(name, np.concatenate(Vs), Fs, hexc(color), cls='hair', weights=weights, paint=hair_paint(dark or color, light or color))


def fringe(c, color, n=6, length=0.11, spread=40, droop=0.35, curl=0.3, sweep=0.0, **kw):
    out = []
    for i in range(n):
        th = -spread + 2 * spread * i / max(n - 1, 1)
        L = length * (0.85 + 0.3 * ((i * 37 % 7) / 7))
        out.append((th, 54 + (i % 2) * 4, L, 0.03, v(math.sin(math.radians(th)) * 0.6 + sweep, -0.6, -1.0), dict(curl=curl, droop=droop, lift=0.012, thick=0.4)))
    return out


def crown_layer(c, n=12, length=0.18, width=0.05, phi=(68, 44), skip_front=55, droop=0.8, curl=0.55, seed=0):
    """Locks that radiate from the crown and flow down over the scalp in two staggered rings, so the hair
    reads as layered clumps instead of a cap. The front is left to the fringe."""
    out = []
    for ring, ph in enumerate(phi):
        for i in range(n):
            th = 360.0 * (i + 0.5 * ring) / n + 7 + seed * 13
            a = ((th + 180) % 360) - 180
            if abs(a) < skip_front:
                continue
            r = math.radians(th)
            k = ((i * 37 + ring * 11 + seed * 5) % 7) / 7
            d = v(math.sin(r) * 0.75, -math.cos(r) * 0.75, -0.65)
            out.append((th, ph + (k - 0.5) * 6, length * (0.85 + 0.3 * k) * (1.0 - 0.15 * ring), width * (0.85 + 0.3 * (1 - k)), d,
                        dict(curl=curl, droop=droop, lift=0.008 + 0.004 * ring, steps=7, thick=0.42, twist=(k - 0.5) * 0.6)))
    return out


def long_back(c, length=0.35, n=9, spread=70, droop=0.9, width=0.04):
    out = []
    for i in range(n):
        th = 180 - spread + 2 * spread * i / max(n - 1, 1)
        a = math.radians(th)
        out.append((th, 35 + (i % 3) * 8, length * (0.85 + 0.25 * ((i * 13 % 5) / 5)), width, v(math.sin(a) * 0.3, 0.4, -1.0),
                    dict(curl=0.05, droop=droop, lift=0.012, steps=8, thick=0.35)))
    return out


def sides_hang(c, length=0.22, droop=0.8):
    out = []
    for sx in (1, -1):
        for th, ph in ((70, 40), (95, 32), (118, 28)):
            out.append((th * sx, ph, length, 0.035, v(sx * 0.35, 0.1, -1.0), dict(curl=0.1, droop=droop, lift=0.012, steps=7, thick=0.38)))
    return out


def braid(c, color, start_theta=180, length=0.55, name='braid', dark=None, light=None):
    """A thick plaited braid down the back with a spring chain."""
    root, n = G.scalp_point(c.fa, start_theta, 20, lift=0.01)
    pts = [root + v(0, 0.03, -0.02)]
    for i in range(1, 7):
        t = i / 6
        pts.append(root + v(0.01 * math.sin(t * 3), 0.06 + 0.02 * t, -0.03 - length * t))
    names = c.sk.add_chain(name, pts, 'head')
    segs = []
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        for k in range(3):
            m = lerp(a, b, (k + 0.5) / 3)
            r = 0.026 * (1 - 0.35 * (i / len(pts)))
            segs.append(pc.quad_sphere(m + v(0.006 * (1 if k % 2 else -1), 0, 0), (r, r * 0.8, r * 0.95), res=2))
    tipV, tipF = pc.tube([pts[-1], pts[-1] + v(0, 0.01, -0.06)], [0.016, 0.002], n=6, cap_tip=True, cap_root=True)
    V, F = _merge(segs + [(tipV, tipF)])
    return P.Part(name, V, F, hexc(color), cls='hair', weights=('chain', names), paint=hair_paint(dark or color, light or color))


def beard(c, color, length=0.06, mustache=True, name='beard'):
    fa = c.fa
    u = c.u
    jaw = Union([sdf.Loft([fa['mouth'] + v(0, 0.03, -0.06) * u, fa['mouth'] + v(0, 0.0, -0.0) * u],
                          [(0.085 * u, 0.07 * u, 0, 0, 2.2), (0.08 * u, 0.06 * u, 0, 0, 2.2)], side=(1, 0, 0))])
    base = Offset(Union([c.bd.head_field, jaw], 0.02 * u), 0.012 * u)
    cut = Intersect([Plane(v(0, 0, 1), fa['mouth'] + v(0, 0, -0.006) * u), Plane(v(0, 1, 0), v(0, 0.035 * u, 0)),
                     Plane(v(0, 0, -1), v(0, 0, fa['chin'] - 0.05 * u))])
    out = [P.Garment(name, base, cut, hexc(color), cls='hair', thickness=0.0, covers=True, weights=('rigid', 'head'),
                     region=lambda p: (p[:, 2] < fa['mouth'][2] + 0.01 * u) & (p[:, 2] > fa['chin'] - 0.06 * u) & (p[:, 1] < 0.04 * u))]
    tufts = []
    for i in range(5):
        x = (i - 2) * 0.03 * u
        p0 = v(x, -0.06 * u, fa['chin'] + 0.02 * u)
        tufts.append(pc.tube([p0, p0 + v(x * 0.2, -0.015, -length * 0.5), p0 + v(x * 0.3, -0.005, -length)], [0.018 * u, 0.014 * u, 0.002], n=6, cap_tip=True, cap_root=True))
    if mustache:
        for sx in (1, -1):
            m0 = fa['mouth'] + v(sx * 0.004, -0.012, 0.012) * u
            tufts.append(pc.tube([m0, m0 + v(sx * 0.025, 0.0, -0.004) * u, m0 + v(sx * 0.045, 0.01, -0.02) * u], [0.009 * u, 0.008 * u, 0.002], n=6, cap_tip=True, cap_root=True))
    out.append(P.Part(name + 'tufts', *_merge(tufts), hexc(color), cls='hair', weights=('rigid', 'head')))
    return out


def mustache(c, color, curl=True, name='mustache'):
    fa = c.fa
    u = c.u
    parts = []
    for sx in (1, -1):
        m0 = fa['mouth'] + v(sx * 0.004, -0.014, 0.012) * u
        pts = [m0, m0 + v(sx * 0.03, 0.0, -0.002) * u, m0 + v(sx * 0.055, 0.012, 0.01 if curl else -0.02) * u]
        parts.append(pc.tube(pts, [0.01 * u, 0.009 * u, 0.002], n=6, cap_tip=True, cap_root=True))
    return P.Part(name, *_merge(parts), hexc(color), cls='hair', weights=('rigid', 'head'))
