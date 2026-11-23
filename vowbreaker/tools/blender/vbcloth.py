"""
vbcloth: garments with real thickness, cut from the trunk rings and limb paths, and the details
that make clothes read as clothes.

  shells    trunk shells (open fronts are open arcs), sleeves (fitted, rolled, kimono), collars
            (stand, sailor, shawl, kimono eri), trousers, hakama, pleated skirts, coats and robes,
            wrapped kimono fronts, hoods, obi, straps, belts, scarves
  folds     drape folds that deepen toward a hem, compression wrinkles at elbows and knees,
            bunching under belts: displaced along the surface normal so the baked AO and the ink
            lines pick them up
  trims     piping and seams along loft rings, hems, cuffs, lapels, pockets, zips, drawstrings
  patterns  painters that weave colour into the vertices: stripes, plaid, flowers, patchwork,
            cranes, glyph bands, hem bands
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import vbcore as core  # noqa: E402
import vbmesh as M  # noqa: E402
from vbmesh import nrm, smooth  # noqa: E402
from vbbody import V, torso_shell, finish_cloth  # noqa: E402


def col3(c):
    return V(core.srgb(c)) if isinstance(c, str) else V(c)


# =============================================================================== painters

def cyl(C, X):
    """Cylindrical coords round the body axis: (arc length round, height)."""
    a = np.arctan2(X[:, 0], -X[:, 1])
    return a, X[:, 2]


def solid(color, grad=0.1, ao_tint=None):
    c = col3(color)

    def fn(C, X, N, part):
        k = (1 - grad) + grad * smooth(0.0, C.P.H * 0.8, X[:, 2])
        return c[None] * k[:, None]
    return fn


def stripes(color, color2, period=0.03, width=0.3, axis='z', angle=0.0, grad=0.08):
    c1, c2 = col3(color), col3(color2)

    def fn(C, X, N, part):
        a, z = cyl(C, X)
        r = 0.12 * C.P.H / 1.7
        if axis == 'z':
            coord = z + a * r * math.tan(math.radians(angle))
        else:
            coord = a * r + z * math.tan(math.radians(angle))
        f = np.abs(((coord / period) % 1.0) - 0.5) * 2
        k = 1 - smooth(width - 0.06, width + 0.06, f)
        g = (1 - grad) + grad * smooth(0.0, C.P.H * 0.8, X[:, 2])
        return (c1[None] * (1 - k[:, None]) + c2[None] * k[:, None]) * g[:, None]
    return fn


def plaid(color, c2, c3, period=0.05, w2=0.18, w3=0.06):
    a1, b2, b3 = col3(color), col3(c2), col3(c3)

    def fn(C, X, N, part):
        a, z = cyl(C, X)
        r = 0.12 * C.P.H / 1.7
        u, v = a * r / period, z / period
        fu = np.abs((u % 1.0) - 0.5) * 2
        fv = np.abs((v % 1.0) - 0.5) * 2
        k2 = np.maximum(1 - smooth(w2, w2 + 0.04, fu), 1 - smooth(w2, w2 + 0.04, fv)) * 0.6
        k3 = np.maximum(1 - smooth(w3, w3 + 0.02, np.abs(((u + 0.5) % 1.0) - 0.5) * 2), 1 - smooth(w3, w3 + 0.02, np.abs(((v + 0.5) % 1.0) - 0.5) * 2))
        c = a1[None] * (1 - k2[:, None]) + b2[None] * k2[:, None]
        return c * (1 - k3[:, None]) + b3[None] * k3[:, None]
    return fn


def _cells(u, v, cell):
    iu, iv = np.floor(u / cell), np.floor(v / cell)
    h = np.sin(iu * 127.1 + iv * 311.7) * 43758.5453
    h = h - np.floor(h)
    h2 = np.sin(iu * 269.5 + iv * 183.3) * 43758.5453
    h2 = h2 - np.floor(h2)
    fu, fv = u / cell - iu, v / cell - iv
    return iu, iv, h, h2, fu, fv


def flowers(color, petal, centre, scale=0.06, density=0.7, petals=5, leaf=None, grad=0.08, z_range=None):
    """Scattered flowers (yukata asagao, sakura) in cylindrical coords, one per cell when lucky."""
    c0, cp, cc = col3(color), col3(petal), col3(centre)
    cl = col3(leaf) if leaf is not None else None

    def fn(C, X, N, part):
        a, z = cyl(C, X)
        r = 0.12 * C.P.H / 1.7
        u, v = a * r, z
        out = c0[None] * ((1 - grad) + grad * smooth(0.0, C.P.H * 0.8, z))[:, None]
        for shift in ((0.0, 0.0), (0.5, 0.5)):
            iu, iv, h, h2, fu, fv = _cells(u + shift[0] * scale, v + shift[1] * scale, scale)
            on = h < density * 0.5
            px, py = (fu - 0.3 - 0.4 * h2) * scale, (fv - 0.3 - 0.4 * h) * scale
            d = np.sqrt(px * px + py * py)
            ang = np.arctan2(py, px) + h * 6.28
            rad = scale * 0.33 * (0.55 + 0.45 * np.abs(np.cos(ang * petals / 2)) ** 0.6)
            pet = (d < rad) & on
            ctr = (d < scale * 0.07) & on
            if z_range is not None:
                inz = (z > z_range[0]) & (z < z_range[1])
                pet &= inz
                ctr &= inz
            if cl is not None:
                lf = on & (np.abs(px - scale * 0.32) < scale * 0.12) & (np.abs(py + scale * 0.12) < scale * 0.05)
                out = np.where(lf[:, None], cl[None], out)
            shade = (0.82 + 0.18 * smooth(rad * 0.3, rad, d))[:, None]
            out = np.where(pet[:, None], cp[None] * shade, out)
            out = np.where(ctr[:, None], cc[None], out)
        return out
    return fn


def patchwork(colors, cell=(0.07, 0.11), seam=None, seam_w=0.06, grad=0.05):
    """The kesa: a robe pieced from rectangles of cloth (a monk's vow of poverty), with seams."""
    cols = [col3(c) for c in colors]
    sc = col3(seam) if seam is not None else None

    def fn(C, X, N, part):
        a, z = cyl(C, X)
        r = 0.12 * C.P.H / 1.7
        u, v = a * r / cell[0], z / cell[1]
        iu = np.floor(u + 0.5 * (np.floor(v) % 2))
        iv = np.floor(v)
        idx = ((iu * 7 + iv * 13).astype(np.int64)) % len(cols)
        out = np.array(cols)[idx]
        if sc is not None:
            fu = np.abs(((u + 0.5 * (np.floor(v) % 2)) % 1.0) - 0.5) * 2
            fv = np.abs((v % 1.0) - 0.5) * 2
            k = np.maximum(smooth(1 - seam_w * 2, 1 - seam_w, fu), smooth(1 - seam_w * 2, 1 - seam_w, fv))
            out = out * (1 - k[:, None]) + sc[None] * k[:, None]
        g = (1 - grad) + grad * smooth(0.0, C.P.H * 0.8, z)
        return out * g[:, None]
    return fn


def cranes(color, bird, scale=0.12, density=0.45, grad=0.06):
    """Faint woven cranes: a body, two swept wings and a neck, stamped one per lucky cell."""
    c0, cb = col3(color), col3(bird)

    def fn(C, X, N, part):
        a, z = cyl(C, X)
        r = 0.12 * C.P.H / 1.7
        iu, iv, h, h2, fu, fv = _cells(a * r, z, scale)
        on = h < density
        px, py = (fu - 0.5) * 2, (fv - 0.5) * 2
        body = ((px / 0.18) ** 2 + (py / 0.1) ** 2) < 1
        wing = (np.abs(py - np.abs(px) * 0.55 - 0.05) < 0.07) & (np.abs(px) < 0.75)
        neck = (np.abs(px + 0.22 + py * 0.3) < 0.04) & (py > 0) & (py < 0.4)
        k = on & (body | wing | neck)
        out = c0[None] * ((1 - grad) + grad * smooth(0.0, C.P.H * 0.8, z))[:, None]
        return np.where(k[:, None], cb[None] * 0.9 + out * 0.1, out)
    return fn


def glyph_band(color, ink, z0, z1, cols=10, stroke_w=0.08, front_only=False):
    """Bands of brush glyphs (talisman robes, the paper god): short strokes in cells."""
    c0, ci = col3(color), col3(ink)

    def fn(C, X, N, part):
        a, z = cyl(C, X)
        r = 0.12 * C.P.H / 1.7
        inz = (z > z0) & (z < z1)
        cw = 2 * math.pi * r / cols
        ch = cw * 1.4
        iu, iv, h, h2, fu, fv = _cells(a * r, z, cw)
        k1 = (np.abs(fu - 0.5) < stroke_w) & (np.abs(fv - 0.5) < 0.35)
        k2 = (np.abs(fv - 0.3 - 0.4 * h) < stroke_w * 0.8) & (np.abs(fu - 0.5) < 0.3)
        k3 = (np.abs(fu - fv - (h2 - 0.5) * 0.4) < stroke_w * 0.8) & (fv > 0.55) & (h2 > 0.4)
        k = inz & (k1 | k2 | k3)
        if front_only:
            k &= np.cos(a) > 0.2
        out = c0[None] * (0.92 + 0.08 * smooth(0.0, C.P.H * 0.8, z))[:, None]
        return np.where(k[:, None], ci[None], out)
    return fn


def hem_band(base_painter, band_color, z0, z1, soft=0.004):
    bc = col3(band_color)

    def fn(C, X, N, part):
        c = base_painter(C, X, N, part)
        k = smooth(z0 - soft, z0 + soft, X[:, 2]) * (1 - smooth(z1 - soft, z1 + soft, X[:, 2]))
        return c * (1 - k[:, None]) + bc[None] * k[:, None]
    return fn


def gradient(top, bottom, z0, z1):
    ct, cb = col3(top), col3(bottom)

    def fn(C, X, N, part):
        f = smooth(z0, z1, X[:, 2])
        return cb[None] * (1 - f[:, None]) + ct[None] * f[:, None]
    return fn


def lined(outer, inner):
    """Two-sided cloth: faces pointing toward the body show the lining colour."""
    co, ci = (outer if callable(outer) else solid(outer)), (inner if callable(inner) else solid(inner, 0.0))

    def fn(C, X, N, part):
        cen = np.zeros_like(X)
        cen[:, 2] = X[:, 2]
        if part.kind.startswith('sleeve_'):
            # a sleeve's inside faces its own arm, not the body axis
            P = C.P
            s = 1 if part.kind.endswith('L') else -1
            best = np.full(len(X), np.inf)
            for a, b in ((P.S[s] - V(s * 0.04 * P.H, 0, 0), P.E[s]), (P.E[s], P.W[s] + P.dA[s] * 0.02 * P.H)):
                ab = b - a
                t = np.clip(((X - a) @ ab) / (ab @ ab), 0, 1)
                c = a + np.outer(t, ab)
                d = np.linalg.norm(X - c, axis=1)
                take = d < best
                cen[take] = c[take]
                best = np.minimum(best, d)
        out = np.sum(N * nrm(X - cen + 1e-9), 1)
        k = smooth(0.1, -0.2, out)
        return co(C, X, N, part) * (1 - k[:, None]) + ci(C, X, N, part) * k[:, None]
    return fn


# =============================================================================== folds

def drape(ob, C, z_top, z_bot, count=9, depth=0.007, seed=0, sharp=0.7, centre=(0.0, 0.0)):
    """Vertical folds hanging from z_top, deepening toward the hem at z_bot."""
    H = C.P.H
    rng = np.random.default_rng(seed)
    ph = rng.random(4) * 6.28

    def fn(X, Nn):
        a = np.arctan2(X[:, 0] - centre[0], -(X[:, 1] - centre[1]))
        f = np.sin(count * a + ph[0] + 0.6 * np.sin(a * 2 + ph[1])) * 0.65 + np.sin(count * 1.73 * a + ph[2]) * 0.35
        f = np.sign(f) * np.abs(f) ** sharp
        k = smooth(z_top, z_bot, X[:, 2])
        return Nn * (depth * H * k * f)[:, None]
    return M.displace(ob, fn)


def wrinkles(ob, C, joints, depth=0.004, freq=None, width=0.06):
    """Compression wrinkles around joints: (centre, axis, inner side direction) per joint."""
    H = C.P.H
    freq = freq or (1.0 / (0.016 * H))

    def fn(X, Nn):
        d = np.zeros(len(X))
        for (c, ax, inner) in joints:
            c, ax, inner = V(c), nrm(V(ax)), nrm(V(inner))
            r = X - c
            along = r @ ax
            radial = r - np.outer(along, ax)
            side = nrm(np.cross(ax, inner))
            ang = np.arctan2(radial @ side, radial @ inner)
            win = np.exp(-(along / (width * H)) ** 2)
            focus = 0.35 + 0.65 * (np.cos(ang) * 0.5 + 0.5)
            d = d + depth * H * win * focus * np.sin(along * freq + 1.8 * np.sin(ang * 2.0))
        return Nn * d[:, None]
    return M.displace(ob, fn)


def arm_wrinkles(ob, C, s, depth=0.0035):
    P = C.P
    return wrinkles(ob, C, [(P.E[s], P.dA[s], V(0, -1, 0)), (P.W[s] - P.dA[s] * 0.03 * P.H, P.dA[s], V(0, -1, 0))], depth)


def leg_wrinkles(ob, C, depth=0.0022, cuff=True):
    P = C.P
    js = []
    for s in (1, -1):
        ax = nrm(P.K[s] - P.Hp[s])
        js.append((P.K[s], ax, V(0, 1, 0)))
        if cuff:
            js.append((P.A[s] + V(0, 0, 0.04 * P.H), V(0, 0, -1), V(0, -1, 0)))
        js.append((P.Hp[s] + V(0, -0.02 * P.H, -0.05 * P.H), ax, V(0, -1, 0)))
    return wrinkles(ob, C, js, depth)


def bunch(ob, C, z, depth=0.004, width=0.03, count=14):
    """Cloth gathered under a belt or sash: short vertical pleats either side of z."""
    H = C.P.H

    def fn(X, Nn):
        a = np.arctan2(X[:, 0], -X[:, 1])
        win = np.exp(-((X[:, 2] - z) / (width * H)) ** 2)
        return Nn * (depth * H * win * np.sin(a * count + np.sin(X[:, 2] * 40)))[:, None]
    return M.displace(ob, fn)


# =============================================================================== trims

def ring_tube(pts, r, n=6, squash=1.0):
    """A closed tube through a loop of points (piping round a hem, a cuff, a rope)."""
    P = np.asarray(pts, dtype=np.float64)
    m = len(P)
    T = nrm(np.roll(P, -1, 0) - np.roll(P, 1, 0))
    up = V(0, 0, 1)
    rings = []
    cen = P.mean(0)
    for i in range(m):
        out = P[i] - cen
        out = nrm(out - T[i] * (out @ T[i]))
        b = np.cross(T[i], out)
        a = np.linspace(0, 2 * math.pi, n, endpoint=False)
        rings.append(P[i] + np.outer(np.cos(a) * r, out) + np.outer(np.sin(a) * r * squash, b))
    return M.Grid(np.array(rings), True, loop=True)


def piping(C, name, pts, r, color, kind='torsopart', closed=True, mid='cloth', line=0.5, offset=0.0, n=6):
    """Piping along a path; offset pushes it out from the path's centre (to sit on top of cloth)."""
    pts = np.asarray(pts, dtype=np.float64)
    if offset:
        cen = pts.mean(0)
        dirn = pts - cen
        dirn[:, 2] = 0
        pts = pts + nrm(dirn + 1e-9) * offset
    g = ring_tube(pts, r, n) if closed else M.tube(pts, [r] * len(pts), n=n, samples=max(8, len(pts)))
    ob = g.build(name)
    M.finish(ob, 1)
    return C.add(ob, color, kind, mid, line=line)


def body_ring(C, z, grow, n=64, arc=None):
    return C.body.ring(z, n, grow, arc)


def panel(C, name, a0, a1, z0, z1, grow, color, kind='torsopart', thick=0.004, rows=6, cols=10, shape=None, mid='cloth',
          levels=1, painter=None, line=1.0, bulge=0.0):
    """A patch lying on the trunk between angles a0..a1 (radians, 0 = front) and heights z0..z1:
    pockets, flaps, lapels, the back of a sailor collar. shape(fa, fz) -> (da, dz) bends it."""
    H = C.P.H
    rows_ = []
    for i in range(rows):
        fz = i / (rows - 1)
        aa = []
        zz = []
        for j in range(cols):
            fa = j / (cols - 1)
            da, dz = shape(fa, fz) if shape else (0.0, 0.0)
            aa.append(a0 + (a1 - a0) * fa + da)
            zz.append(z0 + (z1 - z0) * fz + dz)
        aa, zz = np.array(aa), np.array(zz)
        g = grow + bulge * np.sin(np.pi * np.linspace(0, 1, cols)) * math.sin(math.pi * fz)
        rows_.append(C.body.point(aa, zz, g))
    ob = M.Grid(np.array(rows_), False).build(name)
    M.finish(ob, 0, thickness=thick * H, offset=0.0)
    M.finish(ob, levels)
    return C.add(ob, color, kind, mid, line=line, painter=painter)


def buttons(C, name, a, zs, grow, r, color, kind='torsopart', mid='metal', squash=0.5):
    obs = []
    for i, z in enumerate(zs):
        p = C.body.point(a, z, grow)
        n = C.body.normal(a, z, grow)
        R = rot_to(n)
        obs.append(M.sphere(p + n * r * 0.2, r, 10, 6, scale=(1, 1, squash), R=R).build(f'{name}{i}'))
    ob = M.merge(obs, name)
    M.finish(ob, 1)
    return C.add(ob, color, kind, mid, line=0.6)


def rot_to(n):
    """A rotation taking +Z to direction n."""
    z = nrm(V(n))
    ref = V(1, 0, 0) if abs(z[0]) < 0.9 else V(0, 1, 0)
    x = nrm(np.cross(ref, z))
    y = np.cross(z, x)
    return np.stack([x, y, z], 1)


def zip_line(C, a, z0, z1, grow, color, width=0.006):
    """A zip: a narrow raised strip with teeth painted in alternating light and dark."""
    H = C.P.H
    zs = np.linspace(z0, z1, 40)
    pts = C.body.point(np.full(40, a), zs, grow + 0.002 * H)
    nn = C.body.normal(np.full(40, a), zs, grow)
    fr = M.guided_frames(pts, nn)
    prof = M.rounded_rect(8, width * H * 0.5, 0.0015 * H, 0.001 * H)
    ob = M.loft(pts, fr, [prof] * 40, True, 'fan', 'fan').build('zip')
    cz = col3(color)
    teeth = lambda C_, X, N, part: np.where(((np.floor(X[:, 2] / (0.004 * H)) % 2) == 0)[:, None], cz[None] * 1.15, cz[None] * 0.7)
    return C.add(ob, color, 'torsopart', 'metal', line=0.3, painter=teeth)


def drawstrings(C, color, grow, z=None, length=0.12, spread=0.035):
    P = C.P
    H = P.H
    z = z if z is not None else P.neck_base - 0.012 * H
    obs = []
    for s in (1, -1):
        top = C.body.point(0.0, z, grow) + V(s * spread * H, -0.004 * H, 0)
        pts = [top, top + V(s * 0.004 * H, -0.006 * H, -length * H * 0.5), top + V(s * 0.002 * H, -0.004 * H, -length * H)]
        obs.append(M.tube(pts, [0.0032 * H] * 3, n=6, samples=10).build(f'string{s}'))
        obs.append(M.sphere(pts[-1] - V(0, 0, 0.006 * H), 0.0055 * H, 8, 6, scale=(1, 1, 1.6)).build(f'aglet{s}'))
    ob = M.merge(obs, 'drawstrings')
    M.finish(ob, 1)
    return C.add(ob, color, 'torsopart', line=0.4)


def belt(C, z, color, buckle=None, width=0.03, grow=0.012, buckle_a=0.0, loops=0):
    P = C.P
    H = P.H
    rings = [C.body.ring(zz, 64, grow * H) for zz in np.linspace(z - width * H / 2, z + width * H / 2, 4)]
    ob = M.Grid(np.array(rings), True).build('belt')
    finish_cloth(C, ob, 0.004 * H)
    C.add(ob, color, 'torsopart')
    if buckle:
        p = C.body.point(buckle_a, z, grow * H + 0.006 * H)
        n = C.body.normal(buckle_a, z, grow * H)
        R = rot_to(n)
        frame = M.rbox(p, (0.026 * H, 0.02 * H, 0.004 * H), R=R, round_=0.35).build('buckle')
        M.finish(frame, 1)
        C.add(frame, buckle, 'torsopart', 'metal', line=0.5)


def scarf(C, color, grow=0.02, tails=((0.06, -0.3, 0.06), (-0.02, -0.22, 0.05)), thick=0.6, painter=None):
    """A scarf wound round the neck with tails hanging down the front (or tossed back)."""
    P = C.P
    H = P.H
    zc = P.neck_base + 0.004 * H
    obs = []
    for k, dz in enumerate((-0.012, 0.008)):
        a = np.linspace(0, 2 * math.pi, 40, endpoint=False)
        r = 0.05 * H + grow * H + k * 0.004 * H
        pts = np.stack([np.sin(a) * r, -np.cos(a) * r * 0.95 + 0.008 * H, np.full(40, zc + dz * H) + 0.006 * H * np.sin(a * 2 + k)], 1)
        prof = lambda i, m, rr: M.superellipse(10, rr, rr * 0.55)
        g = ring_tube(pts, 0.016 * H, n=10, squash=0.6)
        obs.append(g.build(f'wrap{k}'))
    for j, (x, length, w) in enumerate(tails):
        top = V(x * H, -0.045 * H, zc - 0.01 * H)
        pts = [top, top + V(x * 0.15 * H, -0.02 * H, length * H * 0.4), top + V(x * 0.25 * H, -0.015 * H, length * H)]
        g = M.tube(pts, [0.024 * H, w * H * 0.5, w * H * 0.5], n=10, samples=14, squash=0.25, guide=V(0, -1, 0), cap1='fan')
        obs.append(g.build(f'tail{j}'))
    ob = M.merge(obs, 'scarf')
    M.finish(ob, 1)
    return C.add(ob, color, 'torsopart', painter=painter)


# =============================================================================== shells

def sleeve(C, s, grow, cuff=0.0, wide=0.0, drop=0.0, n=18, samples=18, start=0.035, roll=0.0, puff=0.0):
    """A sleeve along the arm, closed inside the shoulder, open at the cuff. roll pulls the cuff up
    the forearm (rolled sleeves); wide/drop make kimono sleeves that hang; puff rounds the cap."""
    P = C.P
    H = P.H
    S, E, Wr, d = P.S[s], P.E[s], P.W[s], P.dA[s]
    end = Wr + d * (0.004 - cuff - roll) * H
    pts = [S + V(-s * start * H, 0, -0.006 * H), S + d * P.ua * 0.12, S + d * P.ua * 0.5, E, E + d * P.fa * 0.5 * (1 - roll * 4), end]
    radii = np.array([0.021, 0.0255 + puff, 0.0238 + puff * 0.3, 0.021, 0.0205, 0.0175 + roll * 0.15]) * H + grow
    radii[-1] += wide
    radii[-2] += wide * 0.45
    radii[-3] += wide * 0.15
    C2 = M.catmull(np.array(pts), samples)
    tt = M.arclen(C2)
    r = np.interp(tt, M.arclen(np.array(pts)), radii)
    T, Nn, Bn = M.rmf(C2, first_normal=V(0, -1, 0))
    rings = []
    for i in range(samples):
        prof = M.superellipse(n, r[i], r[i] * 0.94, 2.1)
        ring = C2[i] + np.outer(prof[:, 0], Bn[i]) + np.outer(prof[:, 1], Nn[i])
        if drop:
            down = V(0, 0, -1)
            sag = drop * H * smooth(0.25, 1.0, tt[i])
            low = np.clip(((ring - C2[i]) @ down) / max(r[i], 1e-6), 0, 1)
            ring = ring + np.outer(low * sag, down)
        rings.append(ring)
    return M.Grid(np.array(rings), True, 'pole', None)


def shirt(C, color='shirt', top=None, bottom=None, grow=0.004, painter=None, rings=12, n=36):
    P = C.P
    H = P.H
    top = top if top is not None else P.neck_base + 0.006 * H
    bottom = bottom if bottom is not None else P.z_hip - 0.04 * H
    ob = M.Grid(torso_shell(C, bottom, top, grow * H, rings=rings, n=n), True).build('shirt')
    finish_cloth(C, ob, 0.004 * H)
    return C.add(ob, color, 'torso', painter=painter)


def stand_collar(C, color, height=0.026, open_front=0.0, grow=0.012, flare=0.006, painter=None, name='collar', inner=None):
    P = C.P
    H = P.H
    z0 = P.neck_base - 0.006 * H
    ga = open_front
    a = np.linspace(ga, 2 * math.pi - ga, 48) if ga > 0 else np.linspace(0, 2 * math.pi, 48, endpoint=False)
    rings = []
    for f in np.linspace(0, 1, 5):
        z = z0 + f * height * H
        r = 0.04 * H + grow * H * 0.4 + flare * H * f
        rings.append(np.stack([np.sin(a) * r, -np.cos(a) * r * 0.92 + 0.006 * H, z - 0.008 * H * (np.cos(a) > 0.6) * f], 1))
    ob = M.Grid(np.array(rings), ga <= 0).build(name)
    finish_cloth(C, ob, 0.005 * H)
    C.add(ob, color, 'torsopart', painter=painter)
    if inner:
        # the white celluloid strip lining the top edge of a gakuran collar, just peeking over it
        ai = np.linspace(max(ga, 0.55), 2 * math.pi - max(ga, 0.55), 40)
        r = 0.04 * H + grow * H * 0.4 + flare * H - 0.0015 * H
        top = z0 + height * H + 0.0012 * H
        rr = [np.stack([np.sin(ai) * r, -np.cos(ai) * r * 0.92 + 0.006 * H, top + dz - 0.008 * H * (np.cos(ai) > 0.6)], 1) for dz in (-0.004 * H, 0.0)]
        ob2 = M.Grid(np.array(rr), False).build(name + '_inner')
        finish_cloth(C, ob2, 0.002 * H)
        C.add(ob2, inner, 'torsopart', line=0.4)
    return ob


def trunk(C, name, color, z0, z1, grow, open_front=0.0, flare=0.0, rings=20, n=48, kind='torso', painter=None, thick=0.005, levels=1,
          overlap=0.0):
    """A trunk shell between heights; open_front (fraction of H) opens a gap down the front that
    widens toward z0; overlap shifts the opening sideways (a wrap fastened off-centre)."""
    P = C.P
    H = P.H
    gap = None
    if open_front > 0:
        def gap(z):
            w = open_front * H * (0.35 + 0.65 * smooth(P.z_sh, z0, z))
            W = C.body.dims(z)[0] + grow * H
            return float(np.arcsin(np.clip(w / W, 0, 0.9)))
    rr = torso_shell(C, z0, z1, grow * H, rings=rings, n=n, gap=gap, flare=flare * H)
    if overlap:
        rr = np.array([C.body.point(np.linspace(overlap, overlap + 2 * math.pi, n, endpoint=False), np.full(n, ring[0, 2]), grow * H) for ring in rr])
    ob = M.Grid(rr, gap is None).build(name)
    finish_cloth(C, ob, thick * H, levels)
    C.add(ob, color, kind, painter=painter)
    return ob, rr


def jacket(C, color='jacket', hem=None, open_front=0.0, collar='stand', grow=0.007, buttons_col='button', sleeves=True, cuff=0.0, kind='torso',
           painter=None, folds=True, roll=0.0, collar_inner=None, n_buttons=5, piping_col=None, cuff_col=None):
    """A fitted jacket: trunk shell, sleeves with cuffs and elbow wrinkles, a collar, buttons."""
    P = C.P
    H = P.H
    hem = hem if hem is not None else P.z_hip - 0.05 * H
    top = P.neck_base + 0.004 * H
    ob, rr = trunk(C, 'jacket', color, hem, top, grow, open_front, 0.006, 20, 56, kind, painter)
    if folds:
        bunch(ob, C, P.z_hip + 0.1 * H, 0.0025, 0.035, 11)
        drape(ob, C, P.z_hip + 0.08 * H, hem, 7, 0.004, seed=3)
    if piping_col:
        piping(C, 'hempipe', rr[0], 0.0028 * H, piping_col, closed=open_front <= 0, offset=0.004 * H)
    if sleeves:
        for s, side in ((1, 'L'), (-1, 'R')):
            rl = roll if not isinstance(roll, (tuple, list)) else roll[0 if s > 0 else 1]
            so = sleeve(C, s, grow * H, cuff=cuff, roll=rl).build(f'sleeve_{side}')
            finish_cloth(C, so, 0.004 * H)
            if folds:
                arm_wrinkles(so, C, s)
            C.add(so, color, f'sleeve_{side}', painter=painter)
            d = P.dA[s]
            cpos = P.W[s] + d * (0.0 - cuff - rl) * H
            cb = M.torus(cpos, 0.0185 * H + grow * H + rl * 0.03 * H, (0.003 + rl * 0.05) * H, axis=d, n=24, m=6, squash=1.6 + rl * 10).build(f'cuff_{side}')
            M.finish(cb, 1)
            C.add(cb, cuff_col or color, f'sleeve_{side}', painter=None if cuff_col else painter)
    if collar == 'stand':
        stand_collar(C, color, open_front=0.3 if open_front > 0 else 0.0, painter=painter, inner=collar_inner)
    if buttons_col and open_front <= 0:
        zs = [P.z_sh - 0.03 * H - i * (P.z_sh - hem - 0.06 * H) / (n_buttons - 0.5) for i in range(n_buttons)]
        buttons(C, 'buttons', 0.0, zs, grow * H + 0.004 * H, 0.0072 * H, buttons_col)
    return ob


def pants(C, color='pants', top=None, cuff=None, r=(0.056, 0.045, 0.039, 0.036), flare=0.0, grow=0.006, painter=None, folds=True,
          crease=0.0):
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.06 * H
    cuff = cuff if cuff is not None else P.z_ankle + 0.022 * H
    crotch = P.z_hip - 0.075 * H
    pel = M.Grid(torso_shell(C, crotch, top, grow * H, rings=8, n=40), True, V(0, 0, crotch - 0.01 * H), None).build('pelvis')
    finish_cloth(C, pel, 0.004 * H)
    C.add(pel, color, 'legs', painter=painter)
    for s, side in ((1, 'L'), (-1, 'R')):
        a = P.Hp[s] + V(-s * (0.006 if top > P.z_hip else 0.014) * H, 0.002 * H, min(0.03 * H, top - P.z_hip))
        k = P.K[s]
        end = V(P.A[s][0], P.A[s][1], cuff)
        pts = [a, (a + k) / 2 + V(s * 0.003 * H, -0.004 * H, 0), k, (k + end) / 2 + V(0, 0.004 * H, 0), end]
        rad = [r[0] * H, r[0] * 0.92 * H, r[1] * H, r[2] * H, (r[3] + flare) * H]
        prof = None
        g = M.tube(pts, rad, n=20, cap0='pole', cap1=None, samples=18, profile=prof)
        lo = g.build(f'leg_{side}')
        finish_cloth(C, lo, 0.004 * H)
        C.add(lo, color, 'legs', painter=painter)
        if folds:
            leg_wrinkles(lo, C, 0.0022)
        if crease:
            # a pressed crease down the front of each leg
            M.displace(lo, lambda X, Nn: Nn * (crease * H * smooth(0.9, 0.99, -Nn[:, 1]) * smooth(cuff, cuff + 0.05 * H, X[:, 2]))[:, None])


def tights(C, color='tights', top=None, bottom=None, grow=0.002, painter=None):
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.03 * H
    bottom = bottom if bottom is not None else P.z_ankle
    crotch = P.z_hip - 0.075 * H
    obs = []
    if top > crotch:
        rr = torso_shell(C, crotch, min(top, P.z_hip + 0.05 * H), grow * H, rings=6, n=32)
        obs.append(M.Grid(rr, True, V(0, 0, crotch - 0.008 * H), None).build('tights_pel'))
    for s, side in ((1, 'L'), (-1, 'R')):
        zt = min(top, P.z_hip + 0.02 * H)
        a = V(P.Hp[s][0] - s * 0.004 * H, 0, zt)
        kk = P.K[s]
        an = V(P.A[s][0], P.A[s][1], bottom)
        pts = [a, kk + V(0, 0, (zt - kk[2]) * 0.5), kk, (kk + an) / 2 + V(0, 0.006 * H, 0), an]
        rr = np.interp([p[2] for p in pts], [P.z_ankle, P.z_knee, P.z_hip + 0.05 * H], [0.025, 0.036, 0.055]) * H + grow * H
        rr[3] += 0.004 * H
        obs.append(M.tube(pts, rr, n=18, cap0='pole', cap1=None, samples=14).build(f'tights_{side}'))
    ob = M.merge(obs, 'tights')
    M.finish(ob, 1)
    return C.add(ob, color, 'legs', painter=painter)


def skirt(C, color='skirt', top=None, hem=None, flare=1.0, pleats=16, depth=0.035, painter=None, levels=1, sway=0.0):
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.1 * H
    hem = hem if hem is not None else P.z_knee - 0.06 * H
    rt = P.waist * 1.1
    rb = P.hw * 2.25 * flare
    zs = np.linspace(top, hem, 14)
    pz = [top, P.z_hip, (P.z_hip + hem) / 2, hem]
    pr = [rt, P.hw * 1.82, rb * 0.88, rb]
    o = np.argsort(pz)
    rr = M.pchip(np.array(pz)[o], np.array(pr)[o], zs)

    def rmod(a, z):
        k = smooth(top, hem, z)
        tri = (2 / math.pi) * np.arcsin(np.sin(a * pleats))
        return 1.0 + depth * k * tri + sway * k * np.sin(a)
    ob = M.lathe(list(zip(rr, zs)), n=pleats * 4, depth=0.82, rmod=rmod).build('skirt')
    finish_cloth(C, ob, 0.004 * H, levels)
    C.add(ob, color, 'skirt', painter=painter)
    C.extra_bones += [
        ('skirt_F', (0, -P.hw * 1.2, P.z_hip), (0, -rb, hem), 'hips'),
        ('skirt_B', (0, P.hw * 1.2, P.z_hip), (0, rb, hem), 'hips'),
        ('skirt_L', (P.hw * 1.6, 0, P.z_hip), (rb, 0, hem), 'hips'),
        ('skirt_R', (-P.hw * 1.6, 0, P.z_hip), (-rb, 0, hem), 'hips'),
    ]
    return ob


def long_coat(C, color='coat', hem=None, open_front=0.05, collar=True, sleeves=True, wide_sleeves=0.0, drop=0.0,
              grow=0.011, tatters=0.0, folds=0.05, hem_r=2.55, painter=None, levels=1, drape_count=9, back_slit=0.0,
              roll=0.0, n=56, name='coat', sleeve_painter=None):
    """A long coat or robe: the trunk rings down to the hips, then flaring folds to the hem."""
    P = C.P
    H = P.H
    gf = grow
    grow = grow * H
    r_hem = P.hw * hem_r
    top = P.neck_base + 0.006 * H
    zs_up = np.linspace(P.z_hip + 0.04 * H, top, 14)
    zs_lo = np.linspace(hem, P.z_hip + 0.04 * H, 14)[:-1]
    rings = []
    for z in np.concatenate([zs_lo, zs_up]):
        ga = 0.0
        if open_front > 0:
            w = open_front * H * (0.3 + 0.7 * smooth(P.z_sh, P.z_hip, z))
            Wz = C.body.dims(max(z, P.z_hip - 0.02 * H))[0] + grow
            ga = float(np.arcsin(np.clip(w / max(Wz, 1e-6), 0, 0.9)))
        a = np.linspace(ga, 2 * math.pi - ga, n) if ga > 0 else np.linspace(0, 2 * math.pi, n, endpoint=False)
        if z >= P.z_hip + 0.02 * H:
            ring = C.body.point(a, np.full(n, z), grow)
        else:
            f = smooth(P.z_hip + 0.02 * H, hem, z)
            base = C.body.point(a, np.full(n, P.z_hip + 0.02 * H), grow)
            circ = np.stack([np.sin(a) * r_hem, -np.cos(a) * r_hem * 0.8, np.full(n, z)], 1)
            ring = base * (1 - f) + circ * f
            ring[:, 2] = z
            k = 1.0 + folds * f * (np.sin(a * 5 + 0.7) * 0.7 + np.sin(a * 9 + 2.1) * 0.3)
            if tatters:
                k = k + tatters * f * np.sin(a * 7.0) * 0.6
            ring[:, 0] *= k
            ring[:, 1] *= k
            if tatters:
                ring[:, 2] += tatters * H * f * 0.6 * (np.abs(np.sin(a * 11.0)) - 0.5)
        rings.append(ring)
    rings = np.array(rings)
    ob = M.Grid(rings, open_front <= 0).build(name)
    if back_slit:
        def keep(Cc):
            a = np.arctan2(Cc[:, 0], -Cc[:, 1])
            return ~((np.abs(np.abs(a) - math.pi) < 0.06) & (Cc[:, 2] < P.z_hip - back_slit * H))
        M.delete_faces(ob, keep)
    finish_cloth(C, ob, 0.006 * H, levels)
    if drape_count:
        drape(ob, C, P.z_hip, hem, drape_count, 0.006, seed=7)
    C.add(ob, color, 'coat', painter=painter)
    if sleeves:
        for s, side in ((1, 'L'), (-1, 'R')):
            so = sleeve(C, s, grow * 1.05, wide=wide_sleeves * H, drop=drop, roll=roll).build(f'csleeve_{side}')
            finish_cloth(C, so, 0.005 * H)
            arm_wrinkles(so, C, s, 0.003)
            C.add(so, color, f'sleeve_{side}', painter=sleeve_painter or painter)
    if collar:
        stand_collar(C, color, height=0.03, open_front=0.35 if open_front > 0 else 0.0, grow=gf + 0.006, flare=0.01, painter=painter)
    C.extra_bones += [
        ('coat_FL', (P.hw * 0.9, -P.hw * 1.2, P.z_hip), (P.hw * 1.2, -r_hem * 0.75, hem), 'hips'),
        ('coat_FR', (-P.hw * 0.9, -P.hw * 1.2, P.z_hip), (-P.hw * 1.2, -r_hem * 0.75, hem), 'hips'),
        ('coat_B', (0, P.hw * 1.2, P.z_hip), (0, r_hem * 0.75, hem), 'hips'),
        ('coat_L', (P.hw * 1.6, 0, P.z_hip), (r_hem, 0, hem), 'hips'),
        ('coat_R', (-P.hw * 1.6, 0, P.z_hip), (-r_hem, 0, hem), 'hips'),
    ]
    return ob, rings


def lapels(C, color, z_top=None, z_bot=None, grow=0.016, width=0.5, painter=None, notch=True):
    """Folded lapels down a coat front: a long tapered flap on each side, thick, standing proud."""
    P = C.P
    H = P.H
    z_top = z_top if z_top is not None else P.neck_base - 0.01 * H
    z_bot = z_bot if z_bot is not None else P.z_hip + 0.12 * H
    for s in (1, -1):
        def shape(fa, fz, s=s):
            w = width * (0.25 + 0.75 * math.sin(math.pi * min(1.0, (1 - fz) * 1.2 + 0.05)))
            nk = 0.12 * (fz > 0.72) * (fa > 0.55) if notch else 0.0
            return (s * (0.12 + fa * w * 0.9), -nk * H * 0.04)
        panel(C, f'lapel{s}', 0.0, 0.0, z_bot, z_top, grow * H, color, rows=10, cols=6, shape=shape, thick=0.005, painter=painter)


def sailor_collar(C, color, stripe, depth=0.16, grow=0.012, tie=None, tie_len=0.12):
    """A sailor collar: a square flap over the back of the shoulders, narrowing into a V at the
    front, edged with two stripes; a scarf knotted at the point of the V."""
    P = C.P
    H = P.H
    zt = P.neck_base + 0.002 * H
    zb = zt - depth * H

    def back_shape(fa, fz):
        return (0.0, 0.0)
    panel(C, 'sailor_back', math.pi - 1.05, math.pi + 1.05, zb, zt, grow * H, color, rows=8, cols=14, thick=0.004, levels=1)
    rr = []
    for s in (1, -1):
        def shape(fa, fz, s=s):
            return (s * (0.05 + fa * 0.95 * (0.3 + 0.7 * fz)), 0.0)
        panel(C, f'sailor_front{s}', 0.0, 0.0, zt - depth * H * 0.95, zt, grow * H + 0.002 * H, color, rows=8, cols=8, shape=shape, thick=0.004)
    # stripes: two lines inset from the back edge
    for k, inset in enumerate((0.012, 0.022)):
        aa = np.linspace(math.pi - 1.05 + inset * 8, math.pi + 1.05 - inset * 8, 30)
        pts = C.body.point(aa, np.full(30, zb + inset * H), grow * H + 0.005 * H)
        piping(C, f'stripe{k}', pts, 0.002 * H, stripe, closed=False, n=5)
    if tie:
        knot = C.body.point(0.0, zt - depth * H * 0.95, grow * H + 0.01 * H)
        obs = [M.sphere(knot, 0.016 * H, 10, 6, scale=(1.3, 0.7, 1)).build('knot')]
        for s in (1, -1):
            pts = [knot, knot + V(s * 0.02 * H, -0.006 * H, -tie_len * H * 0.5), knot + V(s * 0.028 * H, -0.004 * H, -tie_len * H)]
            obs.append(M.tube(pts, [0.012 * H, 0.016 * H, 0.02 * H], n=8, samples=10, squash=0.3, guide=V(0, -1, 0), cap1='fan').build(f'tie{s}'))
        ob = M.merge(obs, 'scarf_tie')
        M.finish(ob, 1)
        C.add(ob, tie, 'torsopart')


def kimono_collar(C, color, under=None, width=0.03, grow=0.02, z_bot=None, cross=0.12):
    """The eri: a band from the back of the neck, over the shoulders and down a crossed V front
    (the left side over the right), with an under-collar of another colour showing inside it."""
    P = C.P
    H = P.H
    z_bot = z_bot if z_bot is not None else P.z_hip + 0.12 * H
    nb = P.neck_base
    for layer, (col, g, w) in enumerate(((under, grow * 0.8, width * 0.55), (color, grow, width))):
        if col is None:
            continue
        for s in (1, -1):
            n = 34
            f = np.linspace(0, 1, n)
            a = M.pchip([0, 0.18, 0.5, 1.0], [s * math.pi * 0.999, s * math.pi * 0.55, s * 0.32, -s * cross], f)
            z = M.pchip([0, 0.18, 0.5, 1.0], [nb + 0.012 * H, nb + 0.004 * H, P.z_sh - 0.05 * H, z_bot], f)
            g2 = g * H + (0.003 * H if s > 0 else 0.0) + 0.002 * H * layer
            pts = C.body.point(a, z, g2)
            nn = C.body.normal(a, z, g2)
            fr = M.guided_frames(pts, nn)
            prof = M.rounded_rect(10, w * H * 0.5, 0.0035 * H, 0.0025 * H)
            ob = M.loft(pts + nn * 0.004 * H, fr, [prof] * n, True, 'fan', 'fan').build(f'eri{layer}{s}')
            M.finish(ob, 1)
            C.add(ob, col, 'torsopart')


def kimono(C, color, hem=None, sleeves='furisode', wide=0.05, drop=0.08, painter=None, collar=None, under=None, grow=0.013, levels=1,
           hem_r=2.3, wrap=True):
    """A kimono: a closed robe whose front wraps left over right (a raised overlap panel along the
    wrap line), kimono sleeves, and the eri collar."""
    P = C.P
    H = P.H
    hem = hem if hem is not None else P.z_ankle + 0.02 * H
    if sleeves == 'furisode':
        ws, dr = wide, drop
    else:
        ws, dr = wide * 0.6, drop * 0.5
    ob, rings = long_coat(C, color, hem=hem, open_front=0.0, collar=False, wide_sleeves=ws, drop=dr, grow=grow, painter=painter,
                          levels=levels, hem_r=hem_r, folds=0.03, drape_count=7)
    if wrap:
        # the left front laps over the right: its edge runs from the neck down across to the
        # right of centre at the waist, then straight to the hem
        z0, z1 = hem + 0.004 * H, P.neck_base - 0.03 * H
        fw = (P.z_hip + 0.12 * H - z0) / (z1 - z0)

        def shape(fa, fz):
            edge = -0.13 + 0.45 * smooth(fw, 1.0, fz)
            return (edge + fa * (0.75 - edge), 0.0)
        panel(C, 'wrap', 0.0, 0.0, z0, z1, grow * H + 0.004 * H, color, rows=18, cols=6, shape=shape,
              thick=0.004, painter=painter, levels=levels, kind='coat')
    kimono_collar(C, collar or color, under=under, grow=grow + 0.006)
    return ob


def hakama(C, color, top=None, hem=None, pleats=7, painter=None, himo=None, back_board=True):
    """Hakama: wide pleated trousers worn high, pleats deep at the front, a stiff board at the
    back of the waist, and the long ties (himo) wrapped round."""
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.09 * H
    hem = hem if hem is not None else P.z_ankle + 0.025 * H
    sk = skirt(C, color, top=top, hem=hem, flare=0.98, pleats=pleats, depth=0.045, painter=painter)
    # split up the sides a little (the openings of a hakama)
    if back_board:
        bc = C.body.point(math.pi, top - 0.03 * H, 0.018 * H)
        bo = M.rbox(bc, (0.07 * H, 0.008 * H, 0.035 * H), round_=0.4).build('koshiita')
        M.finish(bo, 1)
        C.add(bo, color, 'torsopart', painter=painter)
    if himo:
        for k, dz in enumerate((0.0, -0.018)):
            pts = C.body.ring(top - 0.01 * H + dz * H, 48, 0.02 * H)
            piping(C, f'himo{k}', pts, 0.004 * H, himo, n=6)
        knot = C.body.point(0.0, top - 0.02 * H, 0.03 * H)
        obs = [M.sphere(knot, 0.014 * H, 8, 6, scale=(1.4, 0.7, 0.9)).build('himoknot')]
        for s in (1, -1):
            obs.append(M.tube([knot, knot + V(s * 0.02 * H, -0.006 * H, -0.05 * H), knot + V(s * 0.012 * H, -0.004 * H, -0.1 * H)],
                              [0.005 * H] * 3, n=6, samples=8, squash=0.5).build(f'himotail{s}'))
        ob = M.merge(obs, 'himoknot')
        M.finish(ob, 1)
        C.add(ob, himo, 'torsopart')
    return sk


def obi(C, color='obi', z=None, height=0.06, grow=0.022, bow=True, bow_color=None, painter=None, cord=None, style='bunko'):
    P = C.P
    H = P.H
    z = z if z is not None else P.z_hip + 0.11 * H
    rings = [C.body.ring(zz, 56, grow * H + 0.002 * H * math.sin(math.pi * f)) for f, zz in zip(np.linspace(0, 1, 6), np.linspace(z - height * H / 2, z + height * H / 2, 6))]
    ob = M.Grid(np.array(rings), True).build('obi')
    finish_cloth(C, ob, 0.004 * H)
    C.add(ob, color, 'torsopart', painter=painter)
    if cord:
        piping(C, 'obijime', C.body.ring(z, 56, grow * H + 0.006 * H), 0.004 * H, cord, n=6)
    if bow:
        back = C.body.point(math.pi, z, grow * H + 0.006 * H)
        obs = []
        if style == 'bunko':
            for s in (1, -1):
                pts = [back, back + V(s * 0.05 * H, 0.03 * H, 0.03 * H), back + V(s * 0.1 * H, 0.02 * H, 0.0), back + V(s * 0.05 * H, 0.03 * H, -0.03 * H), back]
                obs.append(M.tube(pts, [0.01 * H, 0.022 * H, 0.026 * H, 0.022 * H, 0.01 * H], n=10, samples=16, squash=0.35, guide=V(0, 1, 0)).build(f'loop{s}'))
                tail = [back, back + V(s * 0.025 * H, 0.012 * H, -0.06 * H), back + V(s * 0.035 * H, 0.016 * H, -0.12 * H)]
                obs.append(M.tube(tail, [0.018 * H, 0.02 * H, 0.022 * H], n=8, samples=8, squash=0.25, guide=V(0, 1, 0), cap1='fan').build(f'tail{s}'))
        else:  # 'taiko': a square drum-shaped knot (adult women, the bride)
            obs.append(M.rbox(back + V(0, 0.03 * H, -0.03 * H), (0.1 * H, 0.025 * H, 0.08 * H), round_=0.5).build('taiko'))
        obs.append(M.sphere(back + V(0, 0.01 * H, 0), 0.02 * H, 10, 6, scale=(1, 0.7, 1.2)).build('knot'))
        bo = M.merge(obs, 'bow')
        M.finish(bo, 1)
        C.add(bo, bow_color or color, 'torsopart', painter=painter)


def strap(C, name, color, a0, z0, a1, z1, width, grow, thick=0.006, kind='torsopart', n=28, mid='cloth', painter=None, via=None):
    """A band lying on the trunk from (a0, z0) to (a1, z1), optionally through a middle point
    via=(a, z): kesa, bag straps, sashes, bandoliers."""
    P = C.P
    H = P.H
    f = np.linspace(0, 1, n)
    if via is None:
        aa = a0 + (a1 - a0) * f
        zz = z0 + (z1 - z0) * f
    else:
        aa = M.pchip([0, 0.5, 1], [a0, via[0], a1], f)
        zz = M.pchip([0, 0.5, 1], [z0, via[1], z1], f)
    C2 = C.body.point(aa, zz, grow)
    No = C.body.normal(aa, zz, grow)
    fr = M.guided_frames(C2, No)
    prof = M.rounded_rect(12, width * 0.5, thick * H * 0.5, thick * H * 0.45)
    ob = M.loft(C2 + No * thick * H * 0.5, fr, [prof] * n, True, 'fan', 'fan').build(name)
    M.finish(ob, 1)
    return C.add(ob, color, kind, mid, painter=painter)


def hood(C, color='hood', grow=0.12, open_face=0.62, drape_=0.0, painter=None, peak=0.0):
    """A cloth hood: the head surface pushed out, opening round the face (each ring an arc that
    leaves the face oval clear); optionally draping to the shoulders; peak pulls the top to a point."""
    P, hd = C.P, C.head
    u = P.u
    H = P.H
    na = 56
    rings = []
    for t in np.linspace(0.02, 0.9, 30):
        z = float(hd.shape(0.0, t)[2])
        k = 1 - ((z + 0.2) / open_face) ** 2
        xo = 0.42 * math.sqrt(k) if k > 0 else 0.0
        W = max(float(hd.shape(math.pi / 2, t)[0]), 1e-3)
        ga = max(float(np.arcsin(np.clip(xo / W, 0, 0.98))) if xo > 0 else 0.0, 1e-3)
        aa = np.linspace(ga, 2 * math.pi - ga, na)
        p = hd.world(aa, t) + hd.normal(aa, t) * grow * u * (1 + 0.4 * t)
        if peak:
            p = p + V(0, 0.4, 1.0) * peak * u * smooth(0.5, 0.0, t) * 0.25
        rings.append(p)
    last = rings[-1]
    for f in np.linspace(0.2, 1.0, 6) if drape_ > 0 else []:
        z = P.neck_base + (last[:, 2].mean() - P.neck_base) * (1 - f) - drape_ * H * f
        ring = last.copy()
        ctr = V(0, 0.02 * H, 0)
        ring[:, :2] = ctr[:2] + (last[:, :2] - ctr[:2]) * (1 + f * 0.9)
        ring[:, 2] = np.minimum(last[:, 2], z)
        rings.append(ring)
    ob = M.Grid(np.array(rings), False).build('hood')
    finish_cloth(C, ob, 0.03 * u)
    C.add(ob, color, 'head', painter=painter)
    return ob
