"""
vbprops: hands, feet and the things characters carry.

  hands     palm lofts with knuckles, phalanx tubes curled into a fist, painted nails; gloves,
            fingerless gloves, bandage wraps spiralling up the forearm
  footwear  sneakers (laces, tongue, striped sole), loafers, boots with straps, geta (a wooden
            platform with teeth and a thong) and zori with split-toe tabi socks
  props     bells, prayer beads with a tassel, the kitsune mask, paper talismans with painted
            glyphs, shimenawa rope with shide streamers, paper lanterns, a school bag, a school
            hat, a fan, earrings, chains, a monk's ringed staff
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import vbcore as core  # noqa: E402
import vbmesh as M  # noqa: E402
from vbmesh import nrm, smooth  # noqa: E402
from vbbody import V  # noqa: E402


def col3(c):
    return V(core.srgb(c)) if isinstance(c, str) else V(c)


def frame_from(fwd, up):
    """Rotation whose columns are (x, y, z) with z = up, y = fwd (orthogonalised)."""
    z = nrm(V(up))
    y = nrm(V(fwd) - z * (V(fwd) @ z))
    x = np.cross(y, z)
    return np.stack([x, y, z], 1)


# =============================================================================== hands

def hand(C, s, fist=0.7, scale=1.0, spread=1.0, slender=1.0, knuckles=True, claws=0.0):
    """One hand on side s: returns (object, fingertip info for nail painting)."""
    P = C.P
    H = P.H
    k = scale * (1.08 if P.child else 1.0) * H
    Wr, d = P.W[s], P.dA[s]
    fwd = V(0, -1, 0)
    across = nrm(fwd - d * (fwd @ d))
    pn = s * nrm(np.cross(d, across))
    obs = []
    palm_len = 0.052 * k
    taus = np.array([-0.2, 0.0, 0.35, 0.72, 1.0])
    C2 = np.array([Wr + d * palm_len * t for t in taus])
    widths = np.array([0.013, 0.0145, 0.0185, 0.0205, 0.0195]) * k * slender
    thick = np.array([0.0105, 0.011, 0.0105, 0.0094, 0.0085]) * k
    fr = (np.tile(d, (5, 1)), np.tile(pn, (5, 1)), np.tile(np.cross(d, pn), (5, 1)))
    profs = []
    for i in range(5):
        pr = M.rounded_rect(18, widths[i], thick[i], thick[i] * 0.85)
        # a hollow in the palm, a curve across the back
        pr[:, 1] = np.where(pr[:, 1] > 0, pr[:, 1] * (1 - 0.18 * np.exp(-(pr[:, 0] / (widths[i] * 0.6)) ** 2) * (i in (2, 3))), pr[:, 1])
        profs.append(pr)
    obs.append(M.loft(C2, fr, profs, True, 'pole', 'fan').build('palm'))
    bend_axis = nrm(np.cross(d, pn))
    curls = np.radians([22 + 58 * fist, 38 + 60 * fist, 26 + 44 * fist])
    if claws:
        curls = np.radians([10 + 30 * fist, 20 + 40 * fist, 30 + 40 * fist])
    fan = 1.0 if np.cross(pn, d) @ across > 0 else -1.0
    tips = []
    for i, (off, lm, back, sp) in enumerate(((0.75, 1.0, 0.0, 4), (0.25, 1.08, 0.001, 1), (-0.25, 1.0, 0.003, -2), (-0.75, 0.8, 0.008, -5))):
        base = Wr + d * (palm_len - back * k) + across * off * 0.0165 * k * slender - pn * 0.001 * k
        dirv = M.rot_axis(d, pn, math.radians(sp * spread) * fan)
        dirv = nrm(dirv - pn * (dirv @ pn))
        lens = np.array([0.022, 0.0145, 0.012]) * k * lm * (1 + claws * 0.5)
        pts = [base - dirv * 0.006 * k]
        p = base
        dv = dirv.copy()
        for j in range(3):
            dv = M.rot_axis(dv, bend_axis, curls[j])
            p = p + dv * lens[j]
            pts.append(p)
        rr = np.array([0.0062, 0.0058, 0.0051, 0.0044]) * k * (0.92 if i == 3 else 1.0) * slender
        if claws:
            pts.append(p + dv * 0.02 * k * claws)
            rr = np.append(rr * 0.85, 0.0008 * k)
        g = M.tube(np.array(pts), rr, n=8, cap0='pole', cap1='pole', samples=12 if claws else 10, squash=0.9)
        obs.append(g.build(f'finger{i}'))
        back_dir = -nrm(M.rot_axis(pn, bend_axis, curls.sum()))
        tips.append((p, dv, -pn if fist < 0.5 else back_dir, rr[-1]))
        if knuckles:
            kn = base - pn * 0.0068 * k + dirv * 0.002 * k
            obs.append(M.sphere(kn, 0.0042 * k, 8, 6, scale=(1, 1, 0.7), R=frame_from(dirv, -pn)).build(f'knuckle{i}'))
    tb = Wr + d * 0.014 * k + across * 0.012 * k + pn * 0.004 * k
    tdir = nrm(d * 0.55 + across * 0.75 + pn * 0.35)
    taxis = nrm(np.cross(tdir, pn))
    tcurl = np.radians([8 + 22 * fist, 14 + 34 * fist, 10 + 30 * fist])
    pts = [tb]
    p = tb
    dv = tdir.copy()
    for j, ln in enumerate((0.018, 0.0145, 0.012)):
        dv = M.rot_axis(dv, taxis, tcurl[j])
        p = p + dv * ln * k
        pts.append(p)
    obs.append(M.tube(np.array(pts), np.array([0.0095, 0.0078, 0.0066, 0.0056]) * k * slender, n=8, samples=10).build('thumb'))
    tips.append((p, dv, nrm(np.cross(taxis, dv)), 0.0056 * k))
    ob = M.merge(obs, f'hand_{"L" if s > 0 else "R"}')
    M.finish(ob, 1)
    return ob, tips


def nail_painter(base, nail, tips_all, glove=None, cuff=None, glove_to=None):
    """Skin with pale nails on each fingertip's back; or a glove colour (optionally fingerless)."""
    bc, nc = col3(base), col3(nail)
    gc = col3(glove) if glove else None

    def fn(C, X, N, part):
        out = np.tile(bc, (len(X), 1))
        for (tip, dv, back, r) in tips_all:
            rel = X - tip
            along = rel @ dv
            onback = (rel @ back) > r * 0.1
            k = onback & (along > -r * 2.6) & (along < r * 0.9) & (np.linalg.norm(rel - np.outer(along, dv), axis=1) < r * 1.25)
            out = np.where(k[:, None], nc[None], out)
        if gc is not None:
            g = np.ones(len(X), dtype=bool)
            if glove_to is not None:
                # fingerless: skin beyond the first joint
                for (tip, dv, back, r) in tips_all:
                    near = np.linalg.norm(X - tip, axis=1) < glove_to
                    g &= ~near
            out = np.where(g[:, None], gc[None] * (0.9 + 0.1 * np.clip(N[:, 2], -1, 1))[:, None], out)
        return out
    return fn


def hands(C, color='skin', fist=0.7, mid=None, nails=None, glove=None, fingerless=0.0, claws=0.0, slender=1.0, spread=1.0, painter=None):
    for s, side in ((1, 'L'), (-1, 'R')):
        ob, tips = hand(C, s, fist, slender=slender, spread=spread, claws=claws)
        pnt = painter
        if pnt is None:
            base = C.palette[color] if color in C.palette else color
            nc = nails or ('#F4D9D0' if color == 'skin' else None)
            if nc or glove:
                pnt = nail_painter(base, nc or base, tips, glove=C.palette.get(glove, glove) if glove else None,
                                   glove_to=fingerless * C.P.H if fingerless else None)
        C.add(ob, color, f'hand_{side}', mid or ('skin' if color == 'skin' and not glove else 'cloth'), line=0.7, painter=pnt)
        if glove:
            d = C.P.dA[s]
            cb = M.torus(C.P.W[s] - d * 0.006 * C.P.H, 0.016 * C.P.H, 0.003 * C.P.H, axis=d, n=20, m=6, squash=1.8).build(f'glovecuff_{side}')
            M.finish(cb, 1)
            C.add(cb, glove, f'hand_{side}')


def bandage(C, s, color, z_from=0.0, z_to=0.55, turns=7, width=0.012, grow=0.003, kind=None):
    """Bandage wrapped in a spiral up the forearm from the wrist (fractions along the forearm)."""
    P = C.P
    H = P.H
    d = P.dA[s]
    a0 = P.W[s] - d * P.fa * z_from
    a1 = P.W[s] - d * P.fa * z_to
    fwd = V(0, -1, 0)
    e1 = nrm(fwd - d * (fwd @ d))
    e2 = np.cross(d, e1)
    n = turns * 16
    pts = []
    for i in range(n):
        f = i / (n - 1)
        c = a0 + (a1 - a0) * f
        r = (0.0175 + 0.004 * f) * H + grow * H
        ang = f * turns * 2 * math.pi
        pts.append(c + (e1 * math.cos(ang) + e2 * math.sin(ang)) * r)
    pts = np.array(pts)
    T = M.tangents(pts)
    Nn = np.array([nrm(p - (a0 + (a1 - a0) * (i / (n - 1)))) for i, p in enumerate(pts)])
    fr = M.guided_frames(pts, Nn)
    prof = M.rounded_rect(6, width * H * 0.5, 0.0012 * H, 0.001 * H)
    ob = M.loft(pts, fr, [prof] * n, True, 'fan', 'fan').build(f'wrap_{s}')
    M.finish(ob, 1)
    return C.add(ob, color, kind or f'arm_{"L" if s > 0 else "R"}' if kind else f'sleeve_{"L" if s > 0 else "R"}', line=0.4)


# =============================================================================== footwear

def foot_loft(C, s, ys_rel, zc, hw, hh, flat=0.75, p=2.4, n=20, name='foot', toe_up=0.0):
    P = C.P
    H = P.H
    A, L = P.A[s], P.foot_len
    x = A[0]
    ys = A[1] + np.array(ys_rel) * H * (L / (0.145 * H))
    m = len(ys)
    zc = np.array(zc) * H + toe_up * H * np.linspace(0, 1, m) ** 3
    C2 = np.stack([np.full(m, x), ys, zc], 1)
    fr = (np.tile(V(0, -1, 0), (m, 1)), np.tile(V(0, 0, 1), (m, 1)), np.tile(V(-1, 0, 0), (m, 1)))
    profs = []
    for i in range(m):
        pr = M.superellipse(n, hw[i] * H, hh[i] * H, p)
        pr[:, 1] = np.where(pr[:, 1] < 0, pr[:, 1] * flat, pr[:, 1])
        profs.append(pr)
    return M.loft(C2, fr, profs, True, 'pole', 'pole').build(name), C2


SHOE_Y = [0.034, 0.012, -0.03, -0.075, -0.105, -0.125]


def sneakers(C, upper, sole, accent=None, lace=None, high=False):
    P = C.P
    H = P.H
    for s, side in ((1, 'L'), (-1, 'R')):
        A = P.A[s]
        ob, C2 = foot_loft(C, s, SHOE_Y, [0.028, 0.036, 0.032, 0.021, 0.015, 0.012], [0.025, 0.028, 0.03, 0.032, 0.027, 0.015],
                           [0.025, 0.033, 0.029, 0.02, 0.014, 0.009])
        obs = [ob]
        sh = 0.07 if high else 0.045
        obs.append(M.tube([A + V(0, 0.004 * H, 0.004 * H), A + V(0, 0.002 * H, sh * H)], [0.027 * H, 0.026 * H], n=18, cap0='pole', cap1=None, samples=6).build('collar'))
        # tongue
        t0 = A + V(0, -0.03 * H, 0.04 * H)
        obs.append(M.tube([t0, t0 + V(0, 0.006 * H, 0.03 * H)], [0.012 * H, 0.011 * H], n=8, samples=4, squash=0.35, guide=V(0, -1, 0.3)).build('tongue'))
        sh_ob = M.merge(obs, f'shoe_{side}')
        M.finish(sh_ob, 1)
        C.add(sh_ob, upper, f'foot_{side}')
        so, _ = foot_loft(C, s, [y + d for y, d in zip(SHOE_Y, (0.006, 0.0, -0.002, -0.004, -0.004, -0.008))], [0.009] * 6,
                          [0.027, 0.03, 0.032, 0.034, 0.029, 0.017], [0.009] * 6, flat=1.0, p=3.0, name=f'sole_{side}')
        M.finish(so, 1)
        ac = col3(C.palette.get(accent, accent)) if accent else None
        scol = col3(C.palette.get(sole, sole))
        pnt = None
        if ac is not None:
            pnt = lambda C_, X, N, part, scol=scol, ac=ac: np.where((np.abs(X[:, 2] - 0.012 * H) < 0.0028 * H)[:, None], ac[None], scol[None])
        C.add(so, sole, f'foot_{side}', painter=pnt)
        if lace:
            ls = []
            for j in range(4):
                c = A + V(0, -0.034 * H - j * 0.012 * H, 0.052 * H - j * 0.008 * H)
                ls.append(M.tube([c + V(-0.012 * H, 0, 0), c + V(0, -0.002 * H, 0.002 * H), c + V(0.012 * H, 0, 0)], [0.0022 * H] * 3, n=5, samples=6).build(f'lace{j}'))
            lo = M.merge(ls, f'laces_{side}')
            M.finish(lo, 1)
            C.add(lo, lace, f'foot_{side}', line=0.3)


def loafers(C, color, sole, heel=0.008):
    P = C.P
    H = P.H
    for s, side in ((1, 'L'), (-1, 'R')):
        A = P.A[s]
        ob, _ = foot_loft(C, s, SHOE_Y, [0.026 + heel, 0.03 + heel * 0.5, 0.027, 0.018, 0.013, 0.011], [0.023, 0.026, 0.028, 0.03, 0.025, 0.013],
                          [0.021, 0.026, 0.022, 0.016, 0.012, 0.008])
        obs = [ob, M.tube([A + V(0, 0.004 * H, 0.004 * H), A + V(0, 0.002 * H, 0.04 * H)], [0.026 * H, 0.025 * H], n=16, cap0='pole', cap1=None, samples=6).build('sock')]
        strap = A + V(0, -0.055 * H, 0.04 * H)
        obs.append(M.tube([strap + V(-0.026 * H, 0.004 * H, -0.006 * H), strap + V(0, 0, 0.002 * H), strap + V(0.026 * H, 0.004 * H, -0.006 * H)],
                          [0.004 * H] * 3, n=6, samples=8, squash=0.4).build('saddle'))
        sh = M.merge(obs, f'shoe_{side}')
        M.finish(sh, 1)
        C.add(sh, color, f'foot_{side}')
        so, _ = foot_loft(C, s, SHOE_Y, [0.006 + heel * 0.5, 0.006, 0.005, 0.005, 0.005, 0.005], [0.025, 0.028, 0.03, 0.031, 0.026, 0.014],
                          [0.006 + heel * 0.5, 0.006 + heel * 0.5, 0.005, 0.005, 0.005, 0.005], flat=1.0, p=3.0, name=f'sole_{side}')
        M.finish(so, 1)
        C.add(so, sole, f'foot_{side}')


def boots(C, color, sole, height=0.14, straps=2, strap_col=None, buckle=None, cuff=None):
    P = C.P
    H = P.H
    for s, side in ((1, 'L'), (-1, 'R')):
        A = P.A[s]
        ob, _ = foot_loft(C, s, SHOE_Y, [0.028, 0.036, 0.031, 0.02, 0.014, 0.012], [0.025, 0.028, 0.03, 0.031, 0.026, 0.014],
                          [0.025, 0.034, 0.028, 0.019, 0.013, 0.009], toe_up=0.004)
        sh_top = A + V(0, 0.003 * H, height * H)
        obs = [ob, M.tube([A + V(0, 0.004 * H, 0.004 * H), A + V(0, 0.006 * H, height * H * 0.5), sh_top],
                          [0.027 * H, 0.03 * H, 0.031 * H + height * 0.03 * H], n=20, cap0='pole', cap1=None, samples=10).build('shaft')]
        bo = M.merge(obs, f'boot_{side}')
        M.finish(bo, 0, thickness=0.003 * H, offset=-1.0)
        M.finish(bo, 1)
        C.add(bo, color, f'foot_{side}')
        if cuff:
            cb = M.torus(sh_top, 0.032 * H + height * 0.03 * H, 0.004 * H, axis=(0, 0, 1), n=24, m=6, squash=1.5).build(f'bootcuff_{side}')
            M.finish(cb, 1)
            C.add(cb, cuff, f'foot_{side}')
        for j in range(straps):
            z = (0.05 + j * (height - 0.06) / max(straps, 1)) * H
            st = M.torus(A + V(0, 0.004 * H, z), 0.029 * H + z * 0.03, 0.0035 * H, axis=(0, 0, 1), n=24, m=6, squash=1.4).build(f'strap{j}_{side}')
            M.finish(st, 1)
            C.add(st, strap_col or sole, f'foot_{side}')
            if buckle:
                b = M.rbox(A + V(s * 0.03 * H, 0.004 * H, z), (0.002 * H, 0.008 * H, 0.006 * H), round_=0.3).build(f'buckle{j}_{side}')
                M.finish(b, 1)
                C.add(b, buckle, f'foot_{side}', 'metal', line=0.4)
        so, _ = foot_loft(C, s, [y + d for y, d in zip(SHOE_Y, (0.006, 0.0, -0.002, -0.004, -0.004, -0.008))], [0.009, 0.009, 0.008, 0.008, 0.008, 0.009],
                          [0.027, 0.03, 0.032, 0.033, 0.028, 0.016], [0.009] * 6, flat=1.0, p=3.0, name=f'sole_{side}', toe_up=0.004)
        M.finish(so, 1)
        C.add(so, sole, f'foot_{side}')


def tabi_feet(C, color='#F2F0EA', split=True):
    """Split-toe socks: the foot as a soft loft with a groove between the big toe and the rest."""
    P = C.P
    H = P.H
    for s, side in ((1, 'L'), (-1, 'R')):
        A = P.A[s]
        ob, C2 = foot_loft(C, s, [0.03, 0.01, -0.03, -0.07, -0.1, -0.118], [0.022, 0.03, 0.026, 0.016, 0.011, 0.009],
                           [0.022, 0.026, 0.027, 0.028, 0.024, 0.012], [0.02, 0.026, 0.02, 0.013, 0.009, 0.006], p=2.2, name=f'tabi_{side}')
        obs = [ob, M.tube([A + V(0, 0.004 * H, 0.004 * H), A + V(0, 0.002 * H, 0.06 * H)], [0.025 * H, 0.024 * H], n=16, cap0='pole', cap1=None, samples=6).build('cuff')]
        ob = M.merge(obs, f'tabi_{side}')
        M.finish(ob, 1)
        if split:
            gx = A[0] + s * -0.006 * H

            def groove(X, Nn, gx=gx, y0=A[1] - 0.085 * H):
                k = np.exp(-((X[:, 0] - gx) / (0.003 * H)) ** 2) * smooth(y0, y0 - 0.02 * H, X[:, 1])
                return -Nn * (0.004 * H * k)[:, None]
            M.displace(ob, groove)
        C.add(ob, color, f'foot_{side}')


def geta(C, wood, strap, feet='skin'):
    """Geta: a raised wooden platform on two teeth, a thong between the toes."""
    P = C.P
    H = P.H
    if feet == 'tabi':
        tabi_feet(C)
    else:
        for s, side in ((1, 'L'), (-1, 'R')):
            A = P.A[s]
            ob, _ = foot_loft(C, s, [0.03, 0.01, -0.03, -0.07, -0.1, -0.118], [0.04, 0.046, 0.044, 0.04, 0.038, 0.037],
                              [0.02, 0.026, 0.027, 0.028, 0.024, 0.012], [0.016, 0.022, 0.018, 0.012, 0.008, 0.005], p=2.2, name=f'foot_{side}')
            ob2 = M.tube([A + V(0, 0.004 * H, 0.03 * H), A + V(0, 0.002 * H, 0.07 * H)], [0.022 * H, 0.023 * H], n=16, samples=6, cap1=None).build('ankle')
            ob = M.merge([ob, ob2], f'barefoot_{side}')
            M.finish(ob, 1)
            C.add(ob, feet, f'foot_{side}', 'skin')
    for s, side in ((1, 'L'), (-1, 'R')):
        A = P.A[s]
        c = V(A[0], A[1] - 0.045 * H, 0.025 * H)
        obs = [M.rbox(c, (0.034 * H, 0.085 * H, 0.008 * H), round_=0.4).build('dai')]
        for dy in (-0.04, 0.035):
            obs.append(M.rbox(c + V(0, dy * H, -0.016 * H), (0.032 * H, 0.008 * H, 0.009 * H), round_=0.3).build(f'ha{dy}'))
        wd = M.merge(obs, f'geta_{side}')
        M.finish(wd, 1)
        C.add(wd, wood, f'foot_{side}')
        toe = c + V(-s * 0.006 * H, -0.06 * H, 0.008 * H)
        st = M.tube([c + V(0.032 * H, 0.0, 0.008 * H), toe + V(0, 0.01 * H, 0.025 * H), toe, toe + V(0, 0.01 * H, 0.025 * H), c + V(-0.032 * H, 0.0, 0.008 * H)],
                    [0.004 * H] * 5, n=6, samples=16).build(f'hanao_{side}')
        M.finish(st, 1)
        C.add(st, strap, f'foot_{side}')


def zori(C, sole, strap, tabi='#F2F0EA'):
    P = C.P
    H = P.H
    tabi_feet(C, tabi)
    for s, side in ((1, 'L'), (-1, 'R')):
        A = P.A[s]
        c = V(A[0], A[1] - 0.045 * H, 0.004 * H)
        so = M.rbox(c, (0.036 * H, 0.088 * H, 0.004 * H), round_=0.45).build(f'zori_{side}')
        M.finish(so, 1)
        C.add(so, sole, f'foot_{side}')
        toe = c + V(-s * 0.006 * H, -0.06 * H, 0.004 * H)
        st = M.tube([c + V(0.03 * H, 0.0, 0.004 * H), toe + V(0, 0.01 * H, 0.028 * H), toe, toe + V(0, 0.01 * H, 0.028 * H), c + V(-0.03 * H, 0.0, 0.004 * H)],
                    [0.0045 * H] * 5, n=6, samples=16).build(f'zstrap_{side}')
        M.finish(st, 1)
        C.add(st, strap, f'foot_{side}')


# =============================================================================== props

def bell(C, at, size=0.022, color='bell', cord='cord', kind='torsopart', cord_len=0.05, name='bell'):
    """A small brass bell: lathed with a lip and a slit, a ring on top, hanging from a cord."""
    P = C.P
    H = P.H
    b = V(at)
    prof = [(0.0001, size * 0.95), (size * 0.55, size * 0.85), (size * 0.92, size * 0.35), (size * 1.0, -size * 0.2), (size * 1.06, -size * 0.5),
            (size * 0.98, -size * 0.58), (size * 0.5, -size * 0.6)]
    g = M.lathe([(r, b[2] + z) for r, z in prof], centre=(b[0], b[1], 0), n=24, cap1=V(b[0], b[1], b[2] - size * 0.6))
    bo = g.build(name)

    def slit(Cc):
        return ~((np.abs(Cc[:, 0] - b[0]) < size * 0.12) & (Cc[:, 1] < b[1]) & (Cc[:, 2] < b[2] - size * 0.1) & (Cc[:, 2] > b[2] - size * 0.55))
    M.delete_faces(bo, slit)
    M.finish(bo, 0, thickness=size * 0.08, offset=0.0)
    ring = M.torus(b + V(0, 0, size * 1.05), size * 0.25, size * 0.07, axis=(1, 0, 0), n=12, m=6).build(name + 'ring')
    clap = M.sphere(b + V(0, 0, -size * 0.35), size * 0.3, 8, 6).build(name + 'ball')
    bo = M.merge([bo, ring, clap], name)
    M.finish(bo, 1)
    C.add(bo, color, kind, 'metal', line=0.5)
    if cord:
        top = b + V(0, 0, size * 1.2)
        co = M.tube([top, top + V(0.004 * H, 0, cord_len * H * 0.5), top + V(0.002 * H, 0.002 * H, cord_len * H)], [0.0022 * H] * 3, n=6, samples=8).build(name + 'cord')
        M.finish(co, 1)
        C.add(co, cord, kind, line=0.4)


def juzu(C, centre, radius, count, r, color, tilt=(0, 0, 0), big=None, tassel=None, kind='torsopart', sag=0.0):
    """Prayer beads: a loop of beads, two larger guru beads at the front, a tassel hanging."""
    R = M.rot_xyz(*tilt)
    obs = []
    big_idx = {count // 4 * 3, count // 4 * 3 + 1} if big else set()
    pts = []
    for i in range(count):
        a = 2 * math.pi * i / count
        p = V(centre) + R @ V(math.cos(a) * radius, math.sin(a) * radius * 0.85, -sag * (math.sin(a) * 0.5 + 0.5) ** 2)
        pts.append(p)
        rr = r * (1.45 if i in big_idx else 1.0)
        obs.append(M.sphere(p, rr, 10, 6).build(f'bead{i}'))
    ob = M.merge(obs, 'juzu')
    M.finish(ob, 1)
    C.add(ob, color, kind, 'cloth', line=0.6)
    if tassel:
        low = min(pts, key=lambda p: p[2])
        ts = [M.tube([low, low + V(0.002 * j - 0.004, -0.002, -r * 6), low + V(0.004 * j - 0.008, -0.003, -r * 10)], [r * 0.25, r * 0.22, r * 0.12], n=5, samples=6).build(f'tas{j}')
              for j in range(5)]
        to = M.merge(ts + [M.sphere(low - V(0, 0, r * 1.4), r * 0.9, 8, 6).build('tasknot')], 'tassel')
        M.finish(to, 1)
        C.add(to, tassel, kind, line=0.4)


def kitsune(C, at, size, facing=(0, -1, 0), up=(0, 0, 1), color='mask', marks='mask_mark', kind='torsopart', name='foxmask'):
    """A kitsune mask: a shallow shell face, a long snout, upright ears, painted red markings."""
    c = V(at)
    R = frame_from(facing, up)
    u = size
    face = M.sphere(c, u * 0.36, 18, 10, scale=(0.85, 0.32, 1.1), R=R).build(name + 'face')
    snout = M.sphere(c + R @ V(0, 0.14 * u, -0.16 * u), u * 0.13, 12, 8, scale=(1, 1.4, 0.85), R=R).build(name + 'snout')
    ears = []
    for s in (1, -1):
        ears.append(M.tube([c + R @ V(s * 0.14 * u, 0.0, 0.26 * u), c + R @ V(s * 0.22 * u, 0.01 * u, 0.42 * u), c + R @ V(s * 0.27 * u, 0.02 * u, 0.6 * u)],
                           [0.1 * u, 0.06 * u, 0.01 * u], n=8, samples=8, squash=0.5, guide=R @ V(0, 1, 0)).build(f'{name}ear{s}'))
    ob = M.merge([face, snout] + ears, name)
    M.finish(ob, 1)
    mc = col3(C.palette.get(marks, marks))
    bc = col3(C.palette.get(color, color))
    Rinv = R.T

    def paint(C_, X, N, part):
        q = (X - c) @ Rinv.T / u
        out = np.tile(bc, (len(X), 1))
        # red eye flicks, red ear insides, a red mark on the brow
        for s in (1, -1):
            eye = (np.abs(q[:, 2] - 0.04 - (q[:, 0] * s - 0.12) * 0.5) < 0.025) & (q[:, 0] * s > 0.05) & (q[:, 0] * s < 0.24) & (q[:, 1] > 0)
            ear = (q[:, 2] > 0.3) & (np.abs(q[:, 0] * s - 0.22) < 0.05) & (q[:, 1] > 0)
            out = np.where((eye | ear)[:, None], mc[None], out)
        brow = (np.abs(q[:, 0]) < 0.03) & (q[:, 2] > 0.12) & (q[:, 2] < 0.24) & (q[:, 1] > 0)
        nose = (np.linalg.norm(q - V(0, 0.32, -0.16), axis=1) < 0.05)
        out = np.where((brow | nose)[:, None], mc[None] * np.where(nose, 0.2, 1.0)[:, None], out)
        return out
    return C.add(ob, color, kind, 'paper', line=0.8, painter=paint)


def talisman(C, at, size, facing, up, color='talisman', ink='ink', kind='torsopart', name='ofuda', seed=0, curl=0.0):
    """A paper talisman (ofuda): a thin strip with a red border and brushed glyphs."""
    c = V(at)
    R = frame_from(facing, up)
    w, h = size * 0.32, size
    rows = []
    for i in range(10):
        fz = i / 9
        xs = np.linspace(-w / 2, w / 2, 5)
        bend = curl * (fz - 0.5) ** 2 * size
        rows.append(np.stack([c + R @ V(x, bend, (fz - 0.5) * h) for x in xs]))
    ob = M.Grid(np.array(rows), False).build(name)
    M.finish(ob, 0, thickness=size * 0.012, offset=0.0)
    M.finish(ob, 1)
    pc, ic = col3(C.palette.get(color, color)), col3(C.palette.get(ink, ink))
    rng = np.random.default_rng(seed)
    strokes = [(rng.uniform(-0.25, 0.25), rng.uniform(-0.35, 0.35), rng.uniform(0.05, 0.3), rng.random() > 0.5) for _ in range(6)]

    def paint(C_, X, N, part):
        q = (X - c) @ R
        fx, fz = q[:, 0] / w, q[:, 2] / h
        out = np.tile(pc, (len(X), 1))
        border = (np.abs(fx) > 0.38) | (np.abs(fz) > 0.46)
        red = col3('#B3262B')
        out = np.where(border[:, None], red[None], out)
        k = np.zeros(len(X), dtype=bool)
        for (x0, z0, ln, vert) in strokes:
            if vert:
                k |= (np.abs(fx - x0) < 0.05) & (np.abs(fz - z0) < ln)
            else:
                k |= (np.abs(fz - z0) < 0.03) & (np.abs(fx - x0) < ln * 0.6)
        k |= (np.abs(fx) < 0.06) & (fz > -0.4) & (fz < 0.4) & (np.abs(np.sin(fz * 18)) > 0.2)
        return np.where((k & ~border)[:, None], ic[None], out)
    return C.add(ob, color, kind, 'paper', line=0.5, painter=paint)


def shimenawa(C, pts, r, color='rope', kind='torsopart', twist=6.0, name='shimenawa', closed=False):
    """Sacred rope: two fat strands twisted round each other."""
    P2 = M.catmull(np.asarray(pts, dtype=np.float64), 80, closed=closed) if not closed else np.asarray(pts, dtype=np.float64)
    if closed:
        P2 = np.vstack([P2, P2[:1]])
    tt = M.arclen(P2)
    T, N, B = M.rmf(P2)
    obs = []
    for k in range(2):
        ang = tt * twist * 2 * math.pi + k * math.pi
        sp = P2 + N * (np.cos(ang) * r * 0.5)[:, None] + B * (np.sin(ang) * r * 0.5)[:, None]
        obs.append(M.tube(sp, [r * 0.62] * len(sp), n=8, samples=len(sp), cap0='pole', cap1='pole').build(f'{name}{k}'))
    ob = M.merge(obs, name)
    M.finish(ob, 1)
    return C.add(ob, color, kind, line=0.7)


def shide(C, at, size, down=(0, 0, -1), out=(0, -1, 0), color='talisman', kind='torsopart', name='shide'):
    """A zigzag paper streamer hanging from a rope."""
    c = V(at)
    d = nrm(V(down))
    o = nrm(V(out))
    side = nrm(np.cross(d, o))
    rows = []
    steps = 4
    for i in range(steps * 2 + 1):
        f = i / (steps * 2)
        k = (i // 2) % 2
        x = (0.0 if k == 0 else 0.35) * size
        rows.append(np.stack([c + d * f * size * 1.6 + side * (x + xx) for xx in (0.0, size * 0.3)]))
    ob = M.Grid(np.array(rows), False).build(name)
    M.finish(ob, 0, thickness=size * 0.02, offset=0.0)
    return C.add(ob, color, kind, 'paper', line=0.5)


def paper_lantern(C, at, r, h, color='lantern', cap='lacquer', kind='torsopart', ribs=12, glow=False, name='chochin', handle=True, painter=None):
    """A chochin: a ribbed paper lantern with lacquered caps (and a handle)."""
    c = V(at)
    zs = np.linspace(-h / 2, h / 2, 14)
    rr = r * np.sqrt(np.clip(1 - (zs / (h * 0.56)) ** 2, 0.05, 1))
    g = M.lathe([(x, c[2] + z) for x, z in zip(rr, zs)], centre=(c[0], c[1], 0), n=32,
                rmod=lambda a, z: 1.0 + 0.025 * np.abs(np.sin((z - c[2]) / h * ribs * math.pi)))
    ob = g.build(name)
    M.finish(ob, 1)
    C.add(ob, color, kind, 'emissive' if glow else 'paper', line=0.7, painter=painter)
    obs = []
    for sgn in (1, -1):
        cz = c + V(0, 0, sgn * h * 0.48)
        obs.append(M.lathe([(r * 0.5, cz[2] - 0.01 * h), (r * 0.52, cz[2] + sgn * h * 0.03), (r * 0.42, cz[2] + sgn * h * 0.07)], centre=(c[0], c[1], 0), n=24,
                           cap0=cz - V(0, 0, sgn * 0.01 * h) * 0, cap1=cz + V(0, 0, sgn * h * 0.07)).build(f'{name}cap{sgn}'))
    if handle:
        top = c + V(0, 0, h * 0.55)
        obs.append(M.tube([top, top + V(0, 0, h * 0.25), top + V(0, h * 0.05, h * 0.5)], [r * 0.06] * 3, n=6, samples=8).build(name + 'handle'))
    co = M.merge(obs, name + 'caps')
    M.finish(co, 1)
    C.add(co, cap, kind, line=0.6)


def randoseru(C, at, w, d, h, color, trim=None, buckle=None, kind='torsopart'):
    """A Japanese school bag: a stiff box with a rounded flap, metal clasp, side hook."""
    c = V(at)
    body = M.rbox(c, (w / 2, d / 2, h / 2), round_=0.4).build('randbody')
    flap = M.rbox(c + V(0, d * 0.52, h * 0.05), (w / 2 * 1.02, d * 0.08, h * 0.55), round_=0.55).build('randflap')
    obs = [body, flap]
    ob = M.merge(obs, 'randoseru')
    M.finish(ob, 1)
    C.add(ob, color, kind)
    if buckle:
        b = M.rbox(c + V(0, d * 0.62, -h * 0.32), (w * 0.08, d * 0.03, h * 0.06), round_=0.4).build('randclasp')
        M.finish(b, 1)
        C.add(b, buckle, kind, 'metal', line=0.5)
    if trim:
        edge = [c + V(math.cos(a) * w * 0.5, d * 0.62, h * 0.05 + math.sin(a) * h * 0.55) for a in np.linspace(math.pi, 2 * math.pi, 24)]
        from vbcloth import piping  # noqa: E402
        piping(C, 'randtrim', edge, 0.006 * w * 4, trim, closed=False, n=5)


def school_hat(C, color, band=None, brim=0.05, kind='head'):
    """The round yellow hat small children wear to school."""
    P, hd = C.P, C.head
    u = P.u
    c = P.head_c + V(0, 0.02, 0.05) * u
    prof = [(0.0001, 0.5 * u), (0.25 * u, 0.48 * u), (0.42 * u, 0.36 * u), (0.5 * u, 0.15 * u), (0.52 * u, 0.0), (0.52 * u + brim * u * 3, -0.04 * u),
            (0.52 * u + brim * u * 3.2, -0.05 * u)]
    g = M.lathe([(r, c[2] + z) for r, z in prof], centre=(c[0], c[1], 0), n=40, depth=1.05)
    ob = g.build('hat')
    M.finish(ob, 0, thickness=0.02 * u, offset=-1.0)
    M.finish(ob, 1)
    C.add(ob, color, kind)
    if band:
        rr = [(0.522 * u, c[2] + z) for z in (0.02 * u, 0.1 * u)]
        bo = M.lathe(rr, centre=(c[0], c[1], 0), n=40, depth=1.05).build('hatband')
        M.finish(bo, 0, thickness=0.01 * u, offset=1.0)
        M.finish(bo, 1)
        C.add(bo, band, kind)


def uchiwa(C, at, r, facing, up, color='fan', handle='wood', kind='bone:hand_L', name='uchiwa', painter=None):
    c = V(at)
    R = frame_from(facing, up)
    a = np.linspace(0, 2 * math.pi, 28, endpoint=False)
    rings = [np.stack([c + R @ V(math.cos(t) * r * f, 0, math.sin(t) * r * f * 0.95 + r) for t in a]) for f in (0.33, 0.66, 1.0)]
    ob = M.Grid(np.array(rings), True, c + R @ V(0, 0, r), None).build(name)
    M.finish(ob, 0, thickness=r * 0.03, offset=0.0)
    M.finish(ob, 1)
    C.add(ob, color, kind, 'paper', painter=painter)
    hd = M.tube([c + R @ V(0, 0, r * 0.2), c, c - R @ V(0, 0, r * 0.7)], [r * 0.05] * 3, n=6, samples=6).build(name + 'handle')
    M.finish(hd, 1)
    C.add(hd, handle, kind)


def earring(C, at, kind='hoop', r=0.02, color='earring', drop=0.0):
    u = C.P.u
    e = V(at)
    obs = []
    if kind == 'hoop':
        obs.append(M.torus(e, r * u, r * u * 0.28, axis=(1, 0, 0), n=16, m=6).build('hoop'))
    elif kind == 'stud':
        obs.append(M.sphere(e, r * u * 0.6, 8, 6).build('stud'))
    if drop:
        obs.append(M.tube([e, e - V(0, 0, drop * u * 0.5), e - V(0, 0, drop * u)], [r * u * 0.15] * 3, n=5, samples=6).build('dropchain'))
        obs.append(M.sphere(e - V(0, 0, drop * u + r * u * 0.6), r * u * 0.6, 8, 6, scale=(0.7, 0.7, 1.4)).build('dropgem'))
    ob = M.merge(obs, 'earring')
    M.finish(ob, 1)
    C.add(ob, color, 'head', 'metal', line=0.3)


def chain(C, pts, link, color='metal', kind='torsopart', name='chain'):
    """Interlocking links along a path (alternating at right angles)."""
    P2 = M.catmull(np.asarray(pts, dtype=np.float64), 60)
    L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P2, axis=0), axis=1))]
    nlinks = max(int(L[-1] / (link * 1.6)), 2)
    T, N, B = M.rmf(P2)
    obs = []
    for i in range(nlinks):
        s = (i + 0.5) / nlinks * L[-1]
        j = min(np.searchsorted(L, s), len(P2) - 1)
        ax = N[j] if i % 2 == 0 else B[j]
        obs.append(M.torus(P2[j], link * 0.55, link * 0.14, axis=ax, n=10, m=5, squash=1.0).build(f'{name}{i}'))
    ob = M.merge(obs, name)
    M.finish(ob, 1)
    return C.add(ob, color, kind, 'metal', line=0.4)


def shakujo(C, base, top, color='metal', shaft='wood', kind='torsopart', rings=6, name='shakujo'):
    """A monk's ringed staff: a long shaft, a crowned head with rings that jangle."""
    b, t = V(base), V(top)
    d = nrm(t - b)
    L = np.linalg.norm(t - b)
    sh = M.tube([b, t], [L * 0.012, L * 0.012], n=8, samples=6).build(name + 'shaft')
    M.finish(sh, 1)
    C.add(sh, shaft, kind)
    side = nrm(np.cross(d, V(0, -1, 0) if abs(d[1]) < 0.9 else V(1, 0, 0)))
    obs = []
    crown = [t - d * L * 0.02 + side * 0.0, t + side * L * 0.05 + d * L * 0.04, t + d * L * 0.1, t - side * L * 0.05 + d * L * 0.04, t - d * L * 0.02]
    obs.append(M.tube(crown, [L * 0.007] * 5, n=6, samples=16).build(name + 'crown'))
    for i in range(rings):
        s = 1 if i % 2 == 0 else -1
        p = t + side * s * L * 0.045 + d * (L * 0.005 + (i // 2) * L * 0.025)
        obs.append(M.torus(p, L * 0.014, L * 0.003, axis=np.cross(d, side), n=12, m=5).build(f'{name}ring{i}'))
    ob = M.merge(obs, name + 'head')
    M.finish(ob, 1)
    C.add(ob, color, kind, 'metal', line=0.5)
