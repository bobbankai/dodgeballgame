"""
vbhair: anime hair. A cap offset from the scalp down to a hairline (with a parting groove), and
clumps: crescent-section ribbons that hug the skull for part of their length, lift off and fall,
can wave, twist, curl and split into forked tips. Ponytails, braids, buns, ahoge and flyaway strands
are built from clumps. Each character composes its own style (chars/<name>.py); hair is painted
root-to-tip with a darker underside and a jagged highlight band.
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


# =============================================================================== profiles

def crescent(n, w, t, bend=0.35, sharp=0.3):
    """A hair clump's cross-section: a lens whose edges curl back toward the scalp (-y), so the
    clump is convex outside and hollow inside, with pinched edges that catch a crisp ink line."""
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    c, s = np.cos(a), np.sin(a)
    x = w * c
    y = t * s * (1 - sharp * c * c) - bend * w * 0.42 * c * c
    return np.stack([x, y], 1)


# =============================================================================== the cap

def cap(C, front=0.2, temple=-0.08, back=-0.32, grow=0.06, na=56, rows=14, part=None, part_depth=0.35,
        part_len=0.55, crown_lift=0.0, back_bulge=0.0, nape_point=0.0):
    """The hair over the cranium, offset from the head down to a hairline (local heights in head
    units). part: angle (deg) of a parting that runs from the crown toward the front; the cap dips
    along it. back_bulge rounds the back out (volume); nape_point draws the nape hairline to a point."""
    hd, P = C.head, C.P
    u = P.u
    aa = np.linspace(0, 2 * math.pi, na, endpoint=False)
    c = np.cos(aa)
    fz = np.where(c > 0, front + (temple - front) * smooth(0.25, 0.95, 1 - c), temple + (back - temple) * smooth(0.0, 0.9, -c))
    if nape_point:
        fz = fz - nape_point * np.exp(-((aa - math.pi) / 0.35) ** 2)
    th = hd.t_of_z(fz)
    rings = []
    for j in range(1, rows + 1):
        f = (j / rows) ** 0.85
        t = th * f
        g = grow * (1 - 0.15 * f ** 6) + crown_lift * (1 - f) ** 2 + back_bulge * np.clip(-c, 0, 1) * np.sin(np.pi * np.clip(f, 0, 1))
        if part is not None:
            pa = math.radians(part)
            dp = np.angle(np.exp(1j * (aa - pa)))
            groove = np.exp(-(dp / 0.09) ** 2) * smooth(part_len, 0.0, f) * (c > -0.2)
            g = g - grow * part_depth * groove
        p = hd.world(aa, t) + hd.normal(aa, t) * (g * u)[:, None] if np.ndim(g) else hd.world(aa, t) + hd.normal(aa, t) * g * u
        rings.append(p)
    t = th
    rings.append(hd.world(aa, t + 0.012) + hd.normal(aa, t + 0.012) * grow * u * 0.25)
    crown = hd.world(0, 0) + V(0, 0, (grow + crown_lift) * u)
    ob = M.Grid(np.array(rings), True, crown, None).build('haircap')
    M.finish(ob, 1)
    return ob


# =============================================================================== clumps

class Clump:
    """One clump of hair. Angles in degrees round the head (0 front, 90 the character's left),
    t on the head (0 crown .. 1 chin), length and width in head units."""

    def __init__(self, a, t, length, width, hug=0.35, out=0.35, drop=0.6, sweep=0.0, curl=0.0, thick=0.3, tip=0.0,
                 lift=0.0, grow=0.06, around=12, samples=18, twist=0.0, spread=0.0, bend=0.35, sharp=0.3,
                 fork=0, fork_at=0.62, fork_spread=0.35, wave=0.0, wave_freq=1.5, avoid=True, taper=0.85,
                 root_width=0.82, kink=0.0, kink_at=0.5):
        self.__dict__.update(locals())
        del self.__dict__['self']

    def path(self, C):
        hd, P = C.head, C.P
        u = P.u
        a = math.radians(self.a)
        L = self.length * u
        n_h = max(int(self.samples * self.hug), 0)
        sweep = math.radians(self.sweep * 60)
        pts, guides = [], []
        if n_h > 0:
            path = hd.march(a, self.t, sweep, L * self.hug, n_h)
            for k, (pa, pt) in enumerate(path):
                f = k / max(len(path) - 1, 1)
                n = hd.normal(pa, pt)
                pts.append(hd.world(pa, pt) + n * (self.grow * (0.55 + 0.45 * f) + self.lift * f) * u)
                guides.append(n)
            a_end, t_end = path[-1]
        else:
            a_end, t_end = a, self.t
            n = hd.normal(a, self.t)
            pts.append(hd.world(a, self.t) + n * self.grow * 0.55 * u)
            guides.append(n)
        n_end = guides[-1]
        if len(pts) >= 2:
            d = nrm(pts[-1] - pts[-2])
        else:
            e = 1e-3
            St = hd.world(a_end, min(t_end + e, 0.99)) - hd.world(a_end, max(t_end - e, 0.0))
            Sa = hd.world(a_end + e, t_end) - hd.world(a_end - e, t_end)
            d = nrm(nrm(St) * math.cos(sweep) + nrm(Sa) * math.sin(sweep))
        d = nrm(d * (1 - self.out) + n_end * self.out)
        n_free = max(self.samples - n_h, 2)
        ds = L * (1 - self.hug) / n_free
        p = pts[-1]
        side = nrm(np.cross(n_end, d))
        for k in range(n_free):
            f = k / n_free
            bendk = self.kink * (abs(f - self.kink_at) < 1.0 / n_free)
            d = nrm(d + V(0, 0, -1) * self.drop * 2.5 / n_free - n_end * self.curl * 3.0 / n_free
                    + side * self.spread * 1.5 / n_free + n_end * bendk)
            p = p + d * ds
            if self.avoid:
                p = C.clear(p)
            pts.append(p)
            guides.append(n_end)
        return np.array(pts), np.array(guides)

    def grids(self, C):
        u = C.P.u
        pts, guides = self.path(C)
        m = self.samples + 2
        C2 = M.catmull(pts, m)
        tt = M.arclen(C2)
        gi = np.array([guides[min(int(round(x * (len(guides) - 1))), len(guides) - 1)] for x in tt])
        T, N, B = M.guided_frames(C2, gi)
        if self.wave:
            C2 = C2 + B * (self.wave * u * np.sin(2 * math.pi * self.wave_freq * tt) * smooth(0.0, 0.3, tt))[:, None]
            T, N, B = M.guided_frames(C2, gi)
        if self.twist:
            ang = self.twist * tt
            N2 = N * np.cos(ang)[:, None] + B * np.sin(ang)[:, None]
            B = np.cross(T, N2)
            N = N2
        w = self.width * u * (self.root_width + (1 - self.root_width) * smooth(0.0, 0.18, tt)) * ((1 - tt) ** self.taper * (1 - self.tip) + self.tip)
        out = []
        main_w = w.copy()
        if self.fork:
            # the main clump narrows past the fork; the forks peel off to the sides
            k = smooth(self.fork_at - 0.05, self.fork_at + 0.1, tt)
            main_w = w * (1 - 0.45 * k)
        profs = [crescent(self.around, max(main_w[i] * 0.5, 1e-4), max(main_w[i] * 0.5 * self.thick, 1e-4), self.bend, self.sharp) for i in range(m)]
        g = M.loft(C2, (T, N, B), profs, True, 'fan', 'pole' if self.tip < 0.05 else 'fan')
        g.data = np.repeat(tt[:, None], self.around, 1)
        out.append(g)
        for j in range(self.fork):
            sgn = 1 if j % 2 == 0 else -1
            mag = (j // 2 + 1)
            i0 = int(self.fork_at * (m - 1))
            n2 = m - i0
            base = C2[i0] + B[i0] * sgn * w[i0] * 0.25 * mag
            dirs = T[i0:] + B[i0:] * sgn * self.fork_spread * mag * np.linspace(0, 1, n2)[:, None]
            seg = np.linalg.norm(np.diff(C2[i0:], axis=0), axis=1)
            fpts = [base]
            for s_, dv in zip(seg * (0.85 - 0.12 * j), dirs[1:]):
                fpts.append(fpts[-1] + nrm(dv) * s_)
            fpts = np.array(fpts)
            ft = np.linspace(0, 1, n2)
            fw = w[i0] * 0.42 * (1 - ft) ** 0.9 + 1e-4
            fT, fN, fB = M.guided_frames(fpts, N[i0:])
            fprofs = [crescent(max(self.around - 2, 6), fw[i] * 0.5, fw[i] * 0.5 * self.thick, self.bend, self.sharp) for i in range(n2)]
            out.append(M.loft(fpts, (fT, fN, fB), fprofs, True, 'fan', 'pole'))
        return out


def clump(C, *a, **kw):
    return Clump(*a, **kw)


def strand(C, start, ctrl, end, r=0.006, n=6):
    """A single thin flyaway strand (world points)."""
    u = C.P.u
    return M.tube([start, ctrl, end], [r * u, r * u * 0.8, r * u * 0.15], n=n, samples=10)


def ahoge(C, a=10, t=0.05, length=0.5, width=0.07, curl=0.9):
    """The single stubborn strand standing up from the crown."""
    return Clump(a, t, length, width, hug=0.0, out=1.0, drop=-0.4, curl=-curl, thick=0.35, samples=14, avoid=False, bend=0.2)


def ponytail(C, root, length, width, n=5, spread=0.18, drop=1.0, sway=0.0, tip=0.12, thick=0.45, wave=0.0, seed=0):
    """Several clumps sharing one tied root (a world point behind/above the head); returns grids
    and the tie position. They fan out a little and fall together."""
    P = C.P
    u = P.u
    root = V(root)
    back = nrm(root - P.head_c)
    side = nrm(np.cross(V(0, 0, 1), back))
    rng = np.random.default_rng(seed)
    grids = []
    for i in range(n):
        f = (i - (n - 1) / 2) / max(n - 1, 1)
        L = length * u * (0.85 + 0.2 * rng.random())
        pts = [root]
        d = nrm(back * 0.6 + side * f * spread * 2 + V(0, 0, -0.4 * drop))
        p = root.copy()
        steps = 14
        for k in range(steps):
            d = nrm(d + V(0, 0, -1) * drop * 2.2 / steps + side * sway * 0.6 / steps)
            p = p + d * L / steps
            p = C.clear(p)
            pts.append(p)
        pts = np.array(pts)
        C2 = M.catmull(pts, 18)
        tt = M.arclen(C2)
        if wave:
            T, N, B = M.rmf(C2, first_normal=back)
            C2 = C2 + B * (wave * u * np.sin(tt * 2 * math.pi * 1.2 + i) * tt)[:, None]
        T, N, B = M.guided_frames(C2, back + V(0, 0, 0.0))
        w = width * u * (0.75 + 0.25 * np.sin(np.pi * np.clip(tt * 1.6, 0, 1))) * ((1 - tt) ** 0.9 * (1 - tip) + tip)
        profs = [crescent(10, max(w[k] * 0.5, 1e-4), max(w[k] * 0.5 * thick, 1e-4), 0.3) for k in range(len(C2))]
        grids.append(M.loft(C2, (T, N, B), profs, True, 'fan', 'pole' if tip < 0.05 else 'fan'))
    return grids


def braid(C, pts, width, crossings=8, thick=0.6):
    """A three-strand braid along a world path: strands spiral round the path 120 degrees apart,
    each a fat crescent clump, so the braid reads as interlocked lobes."""
    u = C.P.u
    P2 = M.catmull(np.asarray(pts, dtype=np.float64), 40)
    tt = M.arclen(P2)
    T, N, B = M.rmf(P2)
    grids = []
    r = width * u * 0.3 * (1 - 0.35 * tt)
    for s in range(3):
        ph = s * 2 * math.pi / 3
        ang = tt * crossings * math.pi + ph
        off = N * (np.cos(ang) * r)[:, None] + B * (np.sin(ang) * r * 1.4)[:, None]
        sp = P2 + off
        sw = width * u * 0.42 * (1 - 0.4 * tt)
        sT, sN, sB = M.guided_frames(sp, N)
        profs = [M.superellipse(8, max(sw[i] * 0.5, 1e-4), max(sw[i] * 0.5 * thick, 1e-4), 2.0) for i in range(len(sp))]
        grids.append(M.loft(sp, (sT, sN, sB), profs, True, 'fan', 'fan'))
    return grids


def bun(C, centre, r, turns=2.0):
    """A coiled bun: one fat clump wound in a flattening spiral."""
    c = V(centre)
    u = C.P.u
    pts = []
    for k in range(40):
        f = k / 39
        a = f * turns * 2 * math.pi
        rr = r * u * (1 - 0.75 * f)
        pts.append(c + V(math.cos(a) * rr, math.sin(a) * rr * 0.8, f * r * u * 0.6))
    pts = np.array(pts)
    tt = M.arclen(pts)
    T, N, B = M.rmf(pts, first_normal=V(0, 0, 1))
    w = r * u * 0.9 * (1 - 0.6 * tt)
    profs = [crescent(10, w[i] * 0.5, w[i] * 0.4, 0.2) for i in range(len(pts))]
    return [M.loft(pts, (T, N, B), profs, True, 'fan', 'pole')]


# =============================================================================== paint

def painter(base, tips=None, under=0.55, band_z=0.18, band=0.035, band_amount=0.5, band_color=None, root_dark=0.82,
            streaks=0.0, inner=None):
    """Hair colour: root-to-tip gradient (toward `tips`), darker where it faces down or inward,
    a jagged painted highlight band across the crown, and optional pale streaks."""
    base = V(core.srgb(base))
    tipc = V(core.srgb(tips)) if tips else None
    hic = V(core.srgb(band_color)) if band_color else None
    innc = V(core.srgb(inner)) if inner else None

    def fn(C, X, N, part):
        P = C.P
        q = (X - P.head_c) / P.u
        r = np.linalg.norm(q * V(1, 1, 0.85), axis=1)
        k = root_dark + (1 - root_dark) * smooth(-0.9, 0.45, q[:, 2])
        col = base[None] * k[:, None]
        if tipc is not None:
            f = smooth(0.62, 1.15, r) * smooth(0.0, -1.5, q[:, 2]) + smooth(0.9, 1.6, r)
            f = np.clip(f, 0, 1)
            col = col * (1 - f[:, None]) + tipc[None] * k[:, None] * f[:, None]
        radial = nrm(q * V(1, 1, 0.6))
        facing = np.sum(N * radial, 1)
        down = np.clip(-N[:, 2], 0, 1)
        shade = np.clip(smooth(0.2, -0.6, facing) * 0.8 + down * 0.35, 0, 1) * (1 - under)
        dark = innc[None] if innc is not None else col * 0.55
        col = col * (1 - shade[:, None]) + dark * shade[:, None] * (1 if innc is not None else 1)
        ang = np.arctan2(q[:, 0], -q[:, 1])
        zig = band_z + 0.03 * np.sin(ang * 11.0) + 0.015 * np.sin(ang * 23.0 + 1.3)
        hb = (1 - smooth(band * 0.6, band, np.abs(q[:, 2] - zig))) * np.clip(facing, 0, 1) * smooth(-0.15, 0.25, N[:, 2] + 0.3) * smooth(1.25, 0.95, r)
        hcol = hic[None] if hic is not None else np.minimum(col * 1.6 + 0.12, 1.0)
        col = col * (1 - (hb * band_amount)[:, None]) + hcol * (hb * band_amount)[:, None]
        if streaks:
            st = smooth(0.55, 0.8, np.sin(ang * 7.0 + q[:, 2] * 2.0) * 0.5 + 0.5) * streaks
            col = col * (1 - st[:, None] * 0.35) + np.minimum(col * 1.8 + 0.1, 1) * st[:, None] * 0.35
        return col
    return fn


# =============================================================================== assembly

def build(C, items, cap_ob=None, mname='hair', levels=0, paint=None, name='hair', line=1.0):
    """items: Clumps or grids (or lists of grids). Builds, smooths, merges into one hair part."""
    obs = [cap_ob] if cap_ob is not None else []
    k = 0
    for it in items:
        gs = it.grids(C) if isinstance(it, Clump) else (it if isinstance(it, (list, tuple)) else [it])
        for g in gs:
            ob = g.build(f'{name}{k}')
            k += 1
            M.finish(ob, levels)
            obs.append(ob)
    ob = M.merge(obs, name)
    C.add(ob, mname, 'hair', 'hair', line=line, painter=paint)
    return ob


def chain(C, top, bottom, n=2, prefix='hair', parent='head'):
    """Spring bones for long hair, a ponytail or a braid."""
    top, bottom = V(top), V(bottom)
    prev = parent
    for i in range(n):
        a = top + (bottom - top) * (i / n)
        b = top + (bottom - top) * ((i + 1) / n)
        name = f'{prefix}_{i + 1}'
        C.extra_bones.append((name, tuple(a), tuple(b), prev))
        prev = name
