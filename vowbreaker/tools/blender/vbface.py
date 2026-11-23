"""
vbface: heads and faces.

A parametric anime head S(a, t) (a = angle round, 0 = front; t = 0 crown .. 1 chin) whose cranium,
jaw, cheekbones, temples, chin, nose and lips are explicit shaping functions that each character
tunes, plus an optional deform hook for anything bespoke. Ears are lofted along a C-shaped helix
with a concha. Faces are painted as decals cast onto the finished head:

  eyes     a polar mesh around the iris centre, clipped by the lid outline; rings sit exactly on the
           colour boundaries (pupil edge, limbal ring) so they stay crisp; a per-character iris
           painter colours it (classic gradient, rings, radial streaks, star or slit pupils, glows);
           highlights in a per-character layout; the sclera shaded under the upper lid
  lids     the upper lash line as a tapered stroke with a flick, extra lash strokes, a lower lid
           (outer stroke, full line or dotted), a double-lid crease, eye bags
  brows    tapered strokes, angled and arched per character
  mouth    a line, smirk or pout, with lip shading
  marks    blush hatching, moles, scars, freckles, nose shadow strokes, tear tracks
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


# =============================================================================== the head surface

class Head:
    """The parametric anime head in head units around the cranium centre (x left, y back, z up)."""

    def __init__(self, P, st):
        self.P = P
        self.st = st
        w = st.get('width', 1.0)
        jaw = st.get('jaw', 0.6)
        ch = st.get('cheek', 0.5)
        self.Wc, self.Fc, self.Bc = 0.43 * w, 0.45 * st.get('depth', 1.0), 0.48 * st.get('back', 1.0)
        self.zc, self.ztop, self.zchin = -0.05, 0.42, -0.6
        self.rz = self.ztop - self.zc
        self.te = 0.42
        uk = [0.0, 0.2, 0.42, 0.62, 0.8, 0.93, 1.0]
        cw = st.get('chin_w', 1.0)
        self.fW = (uk, [1.0, 0.985, 0.93 + 0.05 * ch, 0.8 - 0.06 * jaw + 0.04 * ch, 0.6 - 0.08 * jaw + 0.02 * ch, (0.38 - 0.05 * jaw) * (0.85 + 0.15 * cw), 0.17 * cw])
        self.fF = (uk, [1.0, 1.0, 0.985, 0.95, 0.89, 0.82, 0.78 + 0.04 * st.get('chin_fwd', 0.0)])
        self.fB = (uk, [1.0, 0.95, 0.78, 0.46, 0.1, -0.28, -0.42])
        self.fp = (uk, [2.0, 2.05, 2.1, 1.95 - 0.25 * jaw, 1.78 - 0.25 * jaw, 1.68 - 0.2 * jaw, 1.62 - 0.15 * jaw])
        self.eye_x = st.get('eye_x', 0.175)
        self.eye_z = st.get('eye_z', -0.13)
        self.nose_z = st.get('nose_z', -0.3)
        self.mouth_z = st.get('mouth_z', -0.425)

    def shape(self, a, t):
        a, t = np.broadcast_arrays(np.asarray(a, dtype=np.float64), np.asarray(t, dtype=np.float64))
        te = self.te
        th = np.clip(t / te, 0, 1) * (math.pi / 2)
        su = np.sin(th)
        uu = np.clip((t - te) / (1 - te), 0, 1)
        lower = t > te
        z = np.where(lower, self.zc + (self.zchin - self.zc) * uu, self.zc + self.rz * np.cos(th))
        W = np.where(lower, self.Wc * M.pchip(*self.fW, uu), self.Wc * su)
        F = np.where(lower, self.Fc * M.pchip(*self.fF, uu), self.Fc * su)
        B = np.where(lower, self.Bc * M.pchip(*self.fB, uu), self.Bc * su)
        pf = np.where(lower, M.pchip(*self.fp, uu), 2.0)
        k = np.where(lower, smooth(0.15, 0.9, uu), 0.0)
        cy = (B - F) / 2 * k
        Df, Db = F + cy, B - cy
        c, s = np.cos(a), np.sin(a)
        front = c >= 0
        e = 2.0 / np.where(front, pf, 2.1)
        x = W * np.sign(s) * np.abs(s) ** e
        y = cy + np.where(front, -Df, Db) * np.abs(c) ** e
        return x, y, z, c

    def local(self, a, t):
        x, y, z, c = self.shape(a, t)
        st = self.st
        fr = smooth(0.25, 0.85, c)
        side = np.clip(np.abs(np.sin(np.asarray(a, dtype=np.float64))), 0, 1) * np.ones_like(x)
        ns = st.get('nose', 1.0)
        nz = self.nose_z
        tipw = 0.026 * st.get('nose_w', 1.0)
        tip = ns * 0.026 * np.exp(-(x / tipw) ** 2 - ((z - nz) / 0.03) ** 2)
        bridge = ns * st.get('bridge', 0.008) * np.exp(-(x / 0.03) ** 2) * smooth(nz - 0.02, nz + 0.03, z) * smooth(self.eye_z + 0.05, self.eye_z - 0.03, z)
        y = y - np.maximum(tip, bridge) * fr
        br = st.get('brow_ridge', 0.0)
        y = y - br * 0.028 * np.exp(-((z - (self.eye_z + 0.13)) / 0.045) ** 2) * fr * smooth(0.42, 0.05, np.abs(x))
        for sx in (1, -1):
            y = y + 0.012 * st.get('sockets', 1.0) * np.exp(-((x - sx * self.eye_x) / 0.085) ** 2 - ((z - self.eye_z) / 0.065) ** 2) * fr
        y = y - st.get('chin', 1.0) * 0.01 * np.exp(-(x / 0.07) ** 2 - ((z + 0.57) / 0.05) ** 2) * fr
        y = y + 0.004 * np.exp(-(x / 0.06) ** 2 - ((z - self.mouth_z) / 0.015) ** 2) * fr
        lips = st.get('lips', 0.0)
        if lips:
            y = y - lips * 0.009 * np.exp(-(x / 0.055) ** 2 - ((z - self.mouth_z + 0.03) / 0.022) ** 2) * fr
        fh = st.get('forehead', 0.0)
        if fh:
            y = y - fh * 0.02 * smooth(self.eye_z + 0.1, self.eye_z + 0.25, z) * smooth(0.42, 0.2, z) * fr
        cb = st.get('cheekbone', 0.0)
        if cb:
            x = x * (1 + cb * 0.04 * np.exp(-((z - (self.eye_z - 0.1)) / 0.07) ** 2) * side)
        tm = st.get('temple', 0.0)
        if tm:
            x = x * (1 - tm * 0.035 * np.exp(-((z - (self.eye_z + 0.12)) / 0.08) ** 2) * side)
        jc = st.get('jaw_corner', 0.0)
        if jc:
            x = x * (1 + jc * 0.07 * np.exp(-((z + 0.44) / 0.055) ** 2) * (1 - 0.6 * fr))
        hook = st.get('deform')
        if hook is not None:
            x, y, z = hook(x, y, z, c)
        return np.stack([x, y, z], -1)

    def world(self, a, t):
        return self.P.head_c + self.local(a, t) * self.P.u

    def normal(self, a, t):
        e = 2e-3
        pa = self.world(np.asarray(a) + e, t) - self.world(np.asarray(a) - e, t)
        tt = np.clip(np.asarray(t, dtype=np.float64), e, 1 - e)
        pt = self.world(a, tt + e) - self.world(a, tt - e)
        n = nrm(np.cross(pt, pa))
        out = self.world(a, t) - (self.P.head_c + V(0, 0, -0.1) * self.P.u)
        flip = np.sum(n * out, -1) < 0
        return np.where(np.asarray(flip)[..., None], -n, n)

    def t_of_z(self, z):
        tt = np.linspace(0, 1, 400)
        zz = self.shape(np.zeros_like(tt), tt)[2]
        return np.interp(-np.asarray(z, dtype=np.float64), -zz, tt)

    def width_at(self, z):
        t = self.t_of_z(z)
        return float(self.local(math.pi / 2, t)[..., 0])

    def grid(self, na=48, nt=36):
        ts = np.linspace(0, 1, nt + 2)[1:-1]
        aa = np.linspace(0, 2 * math.pi, na, endpoint=False)
        return np.meshgrid(aa, ts)

    def march(self, a, t, sweep, dist, steps):
        """Walk `dist` metres over the head from (a, t), heading down (toward +t) turned by `sweep`
        radians toward +a. Returns (a, t) pairs."""
        out = [(a, t)]
        ds = dist / max(steps, 1)
        e = 1e-3
        for _ in range(steps):
            tt = min(max(t, 0.03), 0.985)
            Sa = (self.world(a + e, tt) - self.world(a - e, tt)) / (2 * e)
            St = (self.world(a, tt + e) - self.world(a, tt - e)) / (2 * e)
            D = nrm(nrm(St) * math.cos(sweep) + nrm(Sa) * math.sin(sweep)) * ds
            J = np.stack([Sa, St], 1)
            sol, *_ = np.linalg.lstsq(J, D, rcond=None)
            a, t = a + sol[0], min(t + sol[1], 0.99)
            out.append((a, t))
        return np.array(out)


# =============================================================================== head, ears, neck

def ear(C, s, st):
    """An anime ear: a helix rim lofted along a C-curve, a concha bowl, and the lobe."""
    P, hd = C.P, C.head
    u = P.u
    ez = st.get('ear_z', -0.16)
    xw = hd.width_at(ez)
    size = st.get('ear_size', 1.0)
    c = P.head_c + V(s * xw * 0.93, 0.03, ez) * u
    tilt = math.radians(st.get('ear_tilt', 14))
    up = V(0, math.sin(tilt), math.cos(tilt))
    back = V(0, math.cos(tilt), -math.sin(tilt))
    out = V(s, 0, 0)
    q = lambda b, z, o=0.0: c + (back * b + up * z) * u * size + out * o * u * size
    helix = [q(-0.01, 0.07, 0.03), q(0.03, 0.12, 0.05), q(0.08, 0.1, 0.06), q(0.11, 0.03, 0.06), q(0.1, -0.05, 0.05), q(0.06, -0.11, 0.04), q(0.02, -0.13, 0.03)]
    g = M.tube(helix, [0.018 * u, 0.026 * u, 0.028 * u, 0.028 * u, 0.026 * u, 0.03 * u, 0.026 * u], n=10, samples=20,
               squash=0.55, guide=out, cap0='pole', cap1='pole')
    obs = [g.build('helix')]
    bowl = M.sphere(q(0.04, -0.01, 0.0), 0.075 * u * size, 12, 8, scale=(0.45, 1.0, 1.25),
                    R=np.array([[1, 0, 0], [0, math.cos(tilt), -math.sin(tilt)], [0, math.sin(tilt), math.cos(tilt)]]))
    obs.append(bowl.build('concha'))
    if st.get('pointed_ears'):
        obs.append(M.tube([q(0.06, 0.1, 0.04), q(0.13, 0.22, 0.05), q(0.16, 0.3, 0.05)], [0.03 * u, 0.018 * u, 0.003 * u], n=8, samples=8,
                          squash=0.5, guide=out).build('point'))
    ob = M.merge(obs, f'ear_{"L" if s > 0 else "R"}')
    M.finish(ob, 1)
    return ob


def build_head(C, st):
    """The head, ears and neck; then the face (unless faceless). Returns a ray Surface on the head."""
    P = C.P
    u = P.u
    hd = Head(P, st)
    C.head = hd
    C.style = st
    A, T = hd.grid(st.get('head_na', 56), st.get('head_nt', 40))
    rings = hd.world(A, T)
    crown = hd.world(0.0, 0.0)
    chin = hd.world(np.linspace(0, 2 * math.pi, 48, endpoint=False), np.full(48, T[-1, 0])).mean(0) + V(0, 0, -0.01) * u
    ob = M.Grid(rings, True, crown, chin).build('head')
    M.finish(ob, 1)
    C.head_ob = ob
    skin = st.get('skin', 'skin')
    C.add(ob, skin, 'face', st.get('mid', 'skin'), line=0.75, face=st.get('face_shadow', True), painter=st.get('skin_painter'))
    if not st.get('no_ears'):
        for s in (1, -1):
            C.add(ear(C, s, st), skin, 'head', st.get('mid', 'skin'), line=0.6, painter=st.get('skin_painter'))
    H = P.H
    nr = (0.03 if P.female or P.child else 0.034) * H * st.get('neck', 1.0)
    neck = M.tube([P.head_c + V(0, 0.06, -0.3) * u, P.head_c + V(0, 0.07, -0.6) * u, V(0, 0.012 * H, P.neck_base - 0.035 * H)],
                  [nr * 0.95, nr, nr * 1.15], n=18, cap0='pole', cap1='pole', samples=10)
    no = neck.build('neck')
    if st.get('adams_apple'):
        no2 = M.sphere(V(0, 0.012 * H - nr * 0.86, P.z_chin - 0.026 * H), nr * 0.16, 10, 6, scale=(0.75, 0.6, 1.3)).build('adam')
        no = M.merge([no, no2], 'neck')
    M.finish(no, 1)
    C.add(no, skin, 'head', st.get('mid', 'skin'), line=0.6, painter=st.get('skin_painter'))
    surf = M.Surface(ob)
    C.surf = surf
    if st.get('faceless'):
        for k, (x, z) in {'eye_L': (hd.eye_x, hd.eye_z), 'eye_R': (-hd.eye_x, hd.eye_z), 'brow_L': (hd.eye_x, hd.eye_z + 0.15),
                          'brow_R': (-hd.eye_x, hd.eye_z + 0.15), 'mouth': (0.0, hd.mouth_z), 'mouth_L': (0.07, hd.mouth_z),
                          'mouth_R': (-0.07, hd.mouth_z)}.items():
            p, _ = surf.project([P.head_c + V(x, -1.0, z) * u], (0, 1, 0))
            P.face[k] = p[0]
        return surf
    build_eyes(C, hd, surf, st.get('eye', {}))
    build_brows(C, hd, surf, st.get('brow', {}), st.get('eye', {}))
    build_mouth(C, hd, surf, st.get('mouth', {}))
    return surf


def face_to3d(P, hd, s, cx, cz, tilt=0.0):
    """Map 2D feature coords (ex outward, ez up; head units) around (cx, cz) on side s (0 = centred,
    x not mirrored) to points in front of the face; rays then travel +Y onto it."""
    u = P.u
    c, sn = math.cos(tilt), math.sin(tilt)

    def f(q):
        q = np.asarray(q, dtype=np.float64).reshape(-1, 2)
        ex = q[:, 0] * c - q[:, 1] * sn
        ez = q[:, 0] * sn + q[:, 1] * c
        X = s * (cx + ex) if s != 0 else cx + ex
        Z = cz + ez
        return P.head_c + np.stack([X, np.full(len(q), -1.0), Z], 1) * u
    return f


def stroke(C, name, surf, to3d, curve, widths, color, kind='head', lift=0.0028, n=None, shift=0.0, mid='eye'):
    """A painted stroke (a tapered ribbon) laid on the face."""
    P = C.P
    curve = np.asarray(curve, dtype=np.float64)
    S2 = M.strip2d(curve, np.asarray(widths, dtype=np.float64), n=n or max(8, len(curve) * 4))
    if shift:
        off = (S2[0] - S2[1]) / 2 * shift
        S2 = np.array([S2[0] + off, S2[1] + off])
    ob = M.decal(name, surf, to3d, S2, closed=False, lift=lift * P.u)
    col = C.col(color) if isinstance(color, str) else V(color)
    C.add(ob, color if isinstance(color, str) else 'lash', kind, mid, line=0.0, vcol=np.tile(col, (S2.shape[0] * S2.shape[1], 1)), ao=False)
    return ob


def dot(C, name, surf, to3d, centre, rx, rz, color, kind='head', lift=0.0026, n=16, edge=None):
    P = C.P
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    c0 = V(centre)
    R2 = np.array([c0 + np.stack([np.cos(a) * rx * f, np.sin(a) * rz * f], 1) for f in (0.55, 1.0)])
    ob = M.decal(name, surf, to3d, R2, closed=True, lift=lift * P.u, cap=c0)
    col = C.col(color) if isinstance(color, str) else V(color)
    vc = np.tile(col, (R2.shape[0] * R2.shape[1] + 1, 1))
    if edge is not None:
        vc[n:2 * n] = V(edge)
    C.add(ob, color if isinstance(color, str) else 'lash', kind, 'eye', line=0.0, vcol=vc, ao=False)
    return ob


# =============================================================================== iris painters
# Each takes the base iris colour and returns fn(rho, ang, qx, qz) -> rgb, where rho is the
# normalised radius (1 = iris edge), qz is up within the iris (-1 .. 1) and ang the polar angle.

def iris_classic(col, pupil=0.44, dark=0.72, band=0.6, rim=0.6, pupil_col=None):
    col = V(col)
    pc = col * 0.1 + 0.01 if pupil_col is None else V(pupil_col)

    def fn(rho, ang, qx, qz):
        d = smooth(-0.1, 0.85, qz)
        c = col[None] * (1.15 - dark * d)[:, None]
        lb = smooth(0.4, 0.62, rho) * (1 - smooth(0.84, 0.92, rho)) * smooth(0.0, -0.6, qz)
        c = c + lb[:, None] * (col * band + 0.25 * band)
        c = c * (1 - rim * smooth(0.88, 0.96, rho))[:, None]
        c = c * (1 - 0.35 * (1 - smooth(pupil + 0.01, pupil + 0.08, rho)))[:, None]
        p = 1 - smooth(pupil - 0.012, pupil + 0.012, rho)
        return c * (1 - p[:, None]) + pc[None] * p[:, None]
    return fn


def iris_rings(col, ring_col, pupil=0.42, rings=(0.62, 0.8), width=0.04):
    base = iris_classic(col, pupil)
    rc = V(ring_col)

    def fn(rho, ang, qx, qz):
        c = base(rho, ang, qx, qz)
        for r in rings:
            k = 1 - smooth(width * 0.5, width, np.abs(rho - r))
            c = c * (1 - k[:, None]) + rc[None] * k[:, None]
        return c
    return fn


def iris_radial(col, streak_col, count=18, pupil=0.4, amount=0.55):
    base = iris_classic(col, pupil)
    sc = V(streak_col)

    def fn(rho, ang, qx, qz):
        c = base(rho, ang, qx, qz)
        k = smooth(0.6, 0.95, np.cos(ang * count) * 0.5 + 0.5) * smooth(pupil + 0.05, pupil + 0.15, rho) * (1 - smooth(0.82, 0.9, rho)) * amount
        return c * (1 - k[:, None]) + sc[None] * k[:, None]
    return fn


def iris_star(col, glow_col, points=4, pupil=0.36, glow=0.5):
    """A star-shaped pupil inside a glowing ring (Ryoga's Gravebrand eyes)."""
    col, gc = V(col), V(glow_col)

    def fn(rho, ang, qx, qz):
        d = smooth(-0.1, 0.85, qz)
        c = col[None] * (1.2 - 0.6 * d)[:, None]
        g = (1 - smooth(0.0, 0.12, np.abs(rho - 0.68))) * glow
        c = c * (1 - g[:, None]) + gc[None] * g[:, None]
        c = c * (1 - 0.6 * smooth(0.88, 0.96, rho))[:, None]
        star = pupil * (0.55 + 0.45 * np.abs(np.cos(ang * points / 2)) ** 6)
        p = 1 - smooth(star - 0.015, star + 0.015, rho)
        return c * (1 - p[:, None]) + (col * 0.06)[None] * p[:, None]
    return fn


def iris_slit(col, pupil_w=0.12, pupil_h=0.8, ring_col=None):
    """A narrow vertical pupil (the Lantern Monk, curse-eaten)."""
    col = V(col)
    rc = V(ring_col) if ring_col is not None else col * 1.4

    def fn(rho, ang, qx, qz):
        d = smooth(-0.1, 0.85, qz)
        c = col[None] * (1.25 - 0.7 * d)[:, None]
        c = c * (1 - 0.65 * smooth(0.86, 0.95, rho))[:, None]
        k = (1 - smooth(0.0, 0.08, np.abs(rho - 0.5))) * 0.35
        c = c * (1 - k[:, None]) + np.minimum(rc, 1)[None] * k[:, None]
        sl = ((qx / pupil_w) ** 2 + (qz / pupil_h) ** 2) < 1
        return np.where(sl[:, None], (col * 0.05)[None], c)
    return fn


def iris_sparkle(col, pupil=0.46, sparkle=(1.0, 1.0, 1.0)):
    """Big children's eyes: soft gradient, wide pupil, a ring of tiny sparkles low in the iris."""
    base = iris_classic(col, pupil, dark=0.55, band=0.9)
    sp = V(sparkle)

    def fn(rho, ang, qx, qz):
        c = base(rho, ang, qx, qz)
        k = (1 - smooth(0.0, 0.05, np.abs(rho - 0.74))) * smooth(0.5, 0.85, np.cos(ang * 9) * 0.5 + 0.5) * smooth(0.1, -0.5, qz)
        return c * (1 - k[:, None] * 0.7) + sp[None] * (k * 0.7)[:, None]
    return fn


def iris_dull(col, pupil=0.4):
    """Tired, flat eyes: little gradient, no light band."""
    return iris_classic(col, pupil, dark=0.45, band=0.15, rim=0.45)


# =============================================================================== eyes

def eye_outline(e):
    ew, eh = e.get('w', 0.085), e.get('h', 0.1)
    droop = e.get('droop', 0.0)
    top = e.get('top', 0.0)
    inner = e.get('inner', -0.18)
    if 'upper' in e:
        upper = [V(x * ew, z * eh) for x, z in e['upper']]
        lower = [V(x * ew, z * eh) for x, z in e['lower']]
        Ci, Co = upper[0], upper[-1]
    else:
        Ci = V(-ew, inner * eh)
        Co = V(ew * 1.02, (0.06 - droop * 0.4) * eh)
        upper = [Ci, V(-0.72 * ew, (0.5 + e.get('lid_in', 0.0)) * eh), V((-0.2 + top) * ew, 0.93 * eh), V((0.35 + top) * ew, 0.97 * eh),
                 V(0.8 * ew, (0.62 - droop * 0.3) * eh), Co]
        lower = [Co, V(0.72 * ew, (-0.42 - droop * 0.2) * eh), V(0.2 * ew, -0.78 * eh * e.get('low', 1.0)), V(-0.4 * ew, -0.72 * eh * e.get('low', 1.0)),
                 V(-0.8 * ew, -0.48 * eh), Ci]
    U = M.catmull(upper, 34)
    L = M.catmull(lower, 34)
    return U, L, Ci, Co, ew, eh


def build_eyes(C, hd, surf, e):
    P = C.P
    u = P.u
    iris_col = C.col('iris')
    white = C.col('eye_white')
    lash_col = C.col('lash')
    tilt = math.radians(e.get('tilt', 6.0))
    painter = e.get('iris_fn') or iris_classic(iris_col, e.get('pupil', 0.44))
    for s, side in ((1, 'L'), (-1, 'R')):
        U, L, Ci, Co, ew, eh = eye_outline(e)
        outline = np.vstack([U, L[1:-1]])
        to3d = face_to3d(P, hd, s, hd.eye_x, hd.eye_z, tilt)
        E, _ = surf.project(to3d(np.zeros((1, 2))), (0, 1, 0))
        P.face[f'eye_{side}'] = E[0]
        ir = e.get('iris', 0.72)
        rx, rz = ew * ir, ew * ir * e.get('iris_tall', 1.2)
        ic = V(e.get('iris_x', -0.06) * ew, e.get('iris_z', -0.06) * eh)
        On = (outline - ic) / V(rx, rz)
        nang = 64
        ang = np.linspace(0, 2 * math.pi, nang, endpoint=False)
        rho_out = M.polygon_rays((0, 0), On, ang)

        def ring(rho):
            rc = np.minimum(rho, rho_out)
            return ic + np.stack([np.cos(ang) * rc * rx, np.sin(ang) * rc * rz], 1)
        lift = 0.0028 * u
        pupil = e.get('pupil', 0.44)
        # --- iris + pupil: one disc, rings on every colour boundary ---------------------------
        rhos = sorted(set([0.12, 0.25, pupil - 0.012, pupil + 0.012, pupil + 0.08, 0.5, 0.6, 0.68, 0.74, 0.8, 0.86, 0.9, 0.94, 0.97, 1.0]))
        rhos = [r for r in rhos if 0.05 < r <= 1.0]
        R2 = np.array([ring(r) for r in rhos])
        ob = M.decal(f'iris_{side}', surf, to3d, R2, closed=True, lift=lift, cap=ic)
        pts2 = np.vstack([R2.reshape(-1, 2), ic[None]])
        q = (pts2 - ic) / V(rx, rz)
        # the painter sees the eye as the viewer does: mirror x on the right eye so designs stay symmetric
        col = painter(np.linalg.norm(q, axis=1), np.arctan2(q[:, 1], q[:, 0] * s), q[:, 0] * s, q[:, 1])
        C.add(ob, 'eye_white', f'eye_{side}', 'eye', line=0.0, vcol=np.clip(col, 0, 1), ao=False)
        # --- sclera: from the iris edge out to the lid outline --------------------------------
        R2 = [ring(1.0)]
        for k in (0.35, 0.7, 1.0):
            rr = np.maximum(1 + (rho_out - 1).clip(0) * k, np.minimum(rho_out, 1.0))
            if k == 1.0:
                rr = np.maximum(rho_out, 1e-4)
            R2.append(ic + np.stack([np.cos(ang) * rr * rx, np.sin(ang) * rr * rz], 1))
        R2 = np.array(R2)
        ob = M.decal(f'sclera_{side}', surf, to3d, R2, closed=True, lift=lift * 0.9)
        pts2 = R2.reshape(-1, 2)
        ytop = (pts2[:, 1] - ic[1]) / eh
        shade = smooth(0.2, 0.85, ytop) * e.get('lid_shadow', 1.0)
        scl = V(core.srgb(e['sclera'])) if 'sclera' in e else white
        col = scl[None] * (1 - 0.3 * shade)[:, None] * V(1.0, 1.0, 1.04) - shade[:, None] * V(0.05, 0.03, 0.0)
        C.add(ob, 'eye_white', f'eye_{side}', 'eye', line=0.0, vcol=np.clip(col, 0, 1), ao=False)
        # --- highlights: placed as the viewer sees them (both toward one side) ------------------
        hl_side = e.get('hl_side', -1.0)
        for k, (dx, dz, r1, r2, *rest) in enumerate(e.get('highlights', ((0.38, 0.42, 0.24, 0.27), (-0.34, -0.5, 0.1, 0.11)))):
            hcol = V(rest[0]) if rest else C.col('eye_hi')
            cx = ic + V(hl_side * s * dx * rx, dz * rz)
            dot(C, f'hi{k}_{side}', surf, to3d, cx, r1 * rx, r2 * rz, hcol, kind=f'eye_{side}', lift=0.0045 + 0.0004 * k)
            C.parts[-1].mname = 'eye_hi'
        # --- upper lash line ------------------------------------------------------------------
        lw = e.get('lash', 1.0) * u
        sel = U[::3]
        if not np.allclose(sel[-1], U[-1]):
            sel = np.vstack([sel, U[-1]])
        fl = e.get('flick', (0.2, 0.16))
        flick = Co + V(fl[0] * ew, fl[1] * eh)
        curve = np.vstack([sel, flick]) if fl[0] > 0 else sel
        tt = M.arclen(curve)
        prof = e.get('lash_profile', (0.006, 0.016, 0.004))
        wid = lw * (prof[0] + prof[1] * smooth(0.0, 0.35, tt) - prof[2] * smooth(0.6, 0.85, tt)) * (1 - 0.85 * smooth(0.86, 1.0, tt))
        lash_obj = stroke(C, f'lash_{side}', surf, to3d, curve, wid, lash_col, kind=f'eye_{side}', lift=0.0037, n=44, shift=0.75)
        C.parts[-1].mname = 'lash'
        for j, (bx, bz, ex2, ez2, wdt) in enumerate(e.get('lashes', ())):
            c2 = np.array([V(bx * ew, bz * eh), V((bx + ex2) / 2 * ew, (bz + ez2) / 2 * eh + 0.008), V(ex2 * ew, ez2 * eh)])
            stroke(C, f'lashes{j}_{side}', surf, to3d, c2, lw * np.array([wdt, wdt * 0.6, wdt * 0.08]), lash_col, kind=f'eye_{side}', lift=0.0037, n=8)
            C.parts[-1].mname = 'lash'
        # --- lower lid ---------------------------------------------------------------------------
        low = e.get('lower', 'outer')
        if low == 'outer':
            seg = L[:14]
            tt = M.arclen(seg)
            stroke(C, f'lowlid_{side}', surf, to3d, seg, lw * (0.0055 * (1 - tt) + 0.001), lash_col * 0.9 + 0.05, kind=f'eye_{side}', lift=0.0037, n=14)
        elif low == 'full':
            tt = M.arclen(L)
            stroke(C, f'lowlid_{side}', surf, to3d, L[2:-2], lw * (0.0012 + 0.0035 * np.sin(np.pi * M.arclen(L[2:-2])) ** 0.6), lash_col * 0.85 + 0.08,
                   kind=f'eye_{side}', lift=0.0037, n=24)
        elif low == 'dots':
            for j, f in enumerate((0.25, 0.42, 0.6)):
                p = L[int(f * (len(L) - 1))] + V(0, -0.012)
                dot(C, f'lowdot{j}_{side}', surf, to3d, p, 0.006, 0.006, lash_col, kind=f'eye_{side}', lift=0.0037, n=8)
        if low != 'none':
            C.parts[-1].mname = 'lash'
        # --- crease and bags ---------------------------------------------------------------------
        cr = e.get('crease', 0.6)
        if cr > 0:
            cc = U[6:28] + V(0, 0.085 * eh + 0.018 + e.get('crease_gap', 0.0))
            tt = M.arclen(cc)
            stroke(C, f'crease_{side}', surf, to3d, cc, lw * 0.0028 * np.sin(np.pi * tt) * cr + 1e-5,
                   lash_col * 0.5 + C.col(C.style.get('skin', 'skin')) * 0.5, kind=f'eye_{side}', lift=0.0028, n=16)
        bags = e.get('bags', 0.0)
        if bags > 0:
            bc = L[4:26] + V(0, -0.03 - 0.02 * bags)
            tt = M.arclen(bc)
            stroke(C, f'bags_{side}', surf, to3d, bc, lw * 0.0025 * np.sin(np.pi * tt) * bags + 1e-5,
                   lash_col * 0.35 + C.col(C.style.get('skin', 'skin')) * 0.65, kind='head', lift=0.0022, n=16)


# =============================================================================== brows

def build_brows(C, hd, surf, b, e):
    P = C.P
    u = P.u
    eh = e.get('h', 0.1)
    ew = e.get('w', 0.085)
    for s, side in ((1, 'L'), (-1, 'R')):
        ba = math.radians(b.get('angle', 8.0))
        bz0 = eh + 0.075 + b.get('z', 0.0)
        x0, x1 = b.get('span', (-0.95, 1.12))
        bxs = np.linspace(x0, x1, 9) * ew
        arch = b.get('arch', 0.016)
        bzs = bz0 + np.tan(ba) * bxs * 0.55 + arch * (1 - ((bxs - 0.15 * ew) / (1.15 * ew)) ** 2)
        if b.get('kink'):
            bzs = bzs + b['kink'] * smooth(0.2 * ew, 0.6 * ew, bxs) * (1 - smooth(0.6 * ew, 1.1 * ew, bxs))
        curve = np.stack([bxs, bzs], 1)
        tt = M.arclen(curve)
        bw = b.get('w', 1.0) * u
        style = b.get('style', 'taper')
        if style == 'taper':
            widths = bw * (0.02 * (1 - tt) ** 0.7 + 0.003) * (0.75 + 0.25 * smooth(0.0, 0.12, tt))
        elif style == 'thick':
            widths = bw * (0.026 * (1 - tt * 0.6) + 0.004) * (0.7 + 0.3 * smooth(0.0, 0.1, tt))
        else:   # 'thin': a short soft line (children, gentle faces)
            widths = bw * (0.011 * np.sin(np.pi * np.clip(tt * 0.9 + 0.08, 0, 1)) + 0.002)
        to3d = face_to3d(P, hd, s, hd.eye_x, hd.eye_z, 0.0)
        stroke(C, f'brow_{side}', surf, to3d, curve, widths, C.col('brow'), kind=f'brow_{side}', lift=0.0034, n=22)
        C.parts[-1].mname = 'brow'
        if b.get('scar') and s == b.get('scar_side', 1):
            # a nick through the brow
            gap = V(0.35 * ew, bz0 + 0.01)
            stroke(C, f'browscar_{side}', surf, to3d, [gap + V(-0.01, 0.03), gap + V(0.01, -0.03)], [0.008 * u, 0.008 * u],
                   C.col(C.style.get('skin', 'skin')) * 0.92, kind='head', lift=0.0038)
        bm, _ = surf.project(to3d(V([[0.1 * ew, bz0]])), (0, 1, 0))
        P.face[f'brow_{side}'] = bm[0]


# =============================================================================== mouth

def build_mouth(C, hd, surf, m):
    P = C.P
    u = P.u
    mw = m.get('w', 0.075)
    smile = m.get('smile', 0.1)
    style = m.get('style', 'line')
    xs = np.linspace(-mw, mw, 9)
    zs = smile * 0.35 * (xs / mw) ** 2 * mw
    if style == 'smirk':
        zs = zs + m.get('smirk', 0.012) * smooth(0.0, mw, xs)
    elif style == 'pout':
        zs = zs - 0.006 * (1 - (xs / mw) ** 2)
    curve = np.stack([xs, zs], 1)
    tt = M.arclen(curve)
    widths = u * (0.0035 + m.get('weight', 0.0045) * np.sin(np.pi * tt) ** 0.7)
    to3d = face_to3d(P, hd, 0, 0.0, hd.mouth_z, 0.0)
    stroke(C, 'mouth', surf, to3d, curve, widths, C.col('mouth'), kind='mouthline', lift=0.0028, n=20)
    C.parts[-1].mname = 'mouth'
    if m.get('lip', 0.0) > 0:
        lip = np.stack([np.linspace(-mw * 0.45, mw * 0.45, 5), np.full(5, -0.032 - 0.004 * m['lip'])], 1)
        lc = C.col(C.style.get('skin', 'skin')) * (1 - 0.18 * m['lip']) + V(0.08, 0.0, 0.0) * m['lip']
        stroke(C, 'lip', surf, to3d, lip, u * 0.006 * np.sin(np.pi * M.arclen(lip)) + 1e-5, np.clip(lc, 0, 1), kind='mouthline', lift=0.0024, n=10)
    if m.get('fang'):
        f = V(mw * 0.45, zs[6] - 0.004)
        dot(C, 'fang', surf, to3d, f + V(0, -0.006), 0.006, 0.009, V(0.98, 0.97, 0.95), kind='mouthline', lift=0.0032, n=8)
    ends, _ = surf.project(to3d(V([[-mw, zs[0]], [0.0, zs[4]], [mw, zs[-1]]])), (0, 1, 0))
    P.face['mouth_R'], P.face['mouth'], P.face['mouth_L'] = ends[0], ends[1], ends[2]


# =============================================================================== marks

def blush_hatch(C, count=3, color=None, length=0.05, width=0.006, spread=0.03, x=0.2, z=-0.29, angle=60):
    """Anime blush: short parallel diagonal strokes on each cheek."""
    P, hd = C.P, C.head
    col = V(color) if color is not None else C.col('mouth') * 0.6 + C.col(C.style.get('skin', 'skin')) * 0.4
    a = math.radians(angle)
    d = V(math.cos(a), math.sin(a))
    for s in (1, -1):
        to3d = face_to3d(P, hd, s, x, z, 0.0)
        for i in range(count):
            c0 = V((i - (count - 1) / 2) * spread, 0.0)
            p0, p1 = c0 - d * length / 2, c0 + d * length / 2
            stroke(C, f'blush{i}_{s}', C.surf, to3d, [p0, (p0 + p1) / 2, p1], P.u * np.array([width * 0.4, width, width * 0.4]), col, lift=0.0022, n=6)


def mole(C, x, z, r=0.01, color=None):
    P, hd = C.P, C.head
    to3d = face_to3d(P, hd, 0, x, z, 0.0)
    col = V(color) if color is not None else C.col('lash') * 0.6 + C.col(C.style.get('skin', 'skin')) * 0.4
    dot(C, f'mole{x:.2f}', C.surf, to3d, V(0, 0), r, r, col, lift=0.0024, n=10)


def scar(C, pts, width=0.012, color=None):
    """A scar across the face (head units, x left, z up)."""
    P, hd = C.P, C.head
    to3d = face_to3d(P, hd, 0, 0.0, 0.0, 0.0)
    pts = np.asarray(pts, dtype=np.float64)
    col = V(color) if color is not None else C.col(C.style.get('skin', 'skin')) * V(0.86, 0.72, 0.7)
    tt = M.arclen(pts)
    stroke(C, 'scar', C.surf, to3d, pts, P.u * width * np.sin(np.pi * np.clip(tt, 0.04, 0.96)) ** 0.5, col, lift=0.0026, n=16)
    # stitch marks across it
    T = np.gradient(M.catmull(pts, 7), axis=0)
    Pp = M.catmull(pts, 7)
    for i in range(1, 6):
        nrm2 = V(-T[i][1], T[i][0])
        nrm2 = nrm2 / max(np.linalg.norm(nrm2), 1e-9)
        a, b = Pp[i] - nrm2 * width * 1.4, Pp[i] + nrm2 * width * 1.4
        stroke(C, f'stitch{i}', C.surf, to3d, [a, b], P.u * np.array([width * 0.35, width * 0.35]), col * 0.85, lift=0.0028, n=4)


def freckles(C, n=10, x=0.2, z=-0.27, spread=(0.08, 0.04), r=0.006, seed=3):
    P, hd = C.P, C.head
    rng = np.random.default_rng(seed)
    col = C.col(C.style.get('skin', 'skin')) * V(0.82, 0.68, 0.6)
    for s in (1, -1):
        to3d = face_to3d(P, hd, s, x, z, 0.0)
        for i in range(n):
            c0 = V(rng.normal(0, spread[0] / 2), rng.normal(0, spread[1] / 2))
            dot(C, f'freckle{i}_{s}', C.surf, to3d, c0, r * (0.7 + 0.5 * rng.random()), r * (0.7 + 0.5 * rng.random()), col, lift=0.002, n=8)


def nose_shadow(C, side=-1, length=0.05, width=0.007, color=None):
    """The anime nose: one small shadow stroke beside the tip."""
    P, hd = C.P, C.head
    to3d = face_to3d(P, hd, 0, side * 0.018, hd.nose_z + 0.004, 0.0)
    col = V(color) if color is not None else C.col(C.style.get('skin', 'skin')) * V(0.78, 0.62, 0.58)
    pts = [V(0.0, length * 0.6), V(side * 0.006, length * 0.1), V(side * 0.016, -length * 0.25)]
    stroke(C, 'noseline', C.surf, to3d, pts, P.u * np.array([width * 0.3, width, width * 0.5]), col, lift=0.0024, n=8)


def tear_tracks(C, color='tears', width=0.045, length=0.48):
    P, hd = C.P, C.head
    for s in (1, -1):
        to3d = face_to3d(P, hd, 0, 0.0, 0.0, 0.0)
        cur = np.array([[s * 0.16, hd.eye_z - 0.02], [s * 0.17, hd.eye_z - length * 0.38], [s * 0.155, hd.eye_z - length * 0.75], [s * 0.13, hd.eye_z - length]])
        stroke(C, f'tear{s}', C.surf, to3d, cur, np.array([width, width * 0.85, width * 0.6, width * 0.25]) * P.u, color, kind='face', lift=0.004, n=16, mid='emissive')


# =============================================================================== masks, glowing eyes

def face_mask(C, color='mask', mark='mask_mark', fox=False, lift=0.07, slits=None, size=(0.38, 0.47), marks_painter=None):
    """A lacquered mask over the face: a plate cast onto the face and thickened, with painted eye
    slits (or any strokes, in head units round the eye line)."""
    P, hd = C.P, C.head
    u = P.u
    surf = C.surf
    to3d = face_to3d(P, hd, 0, 0.0, -0.13, 0.0)
    a = np.linspace(0, 2 * math.pi, 48, endpoint=False)
    rings = []
    for f in (0.2, 0.4, 0.6, 0.8, 1.0):
        rx, rz = size[0] * f, size[1] * f
        rings.append(np.stack([np.cos(a) * rx, np.sin(a) * rz + 0.02 * f], 1))
    R2 = np.array(rings)
    flat = to3d(np.vstack([R2.reshape(-1, 2), [[0.0, 0.0]]]))
    pts, nn = surf.project(flat, (0, 1, 0), back=0.3, lift=lift * u)
    g = M.Grid(pts[:-1].reshape(R2.shape[0], R2.shape[1], 3), True, pts[-1], None)
    ob = g.build('mask')
    M.finish(ob, 0, thickness=0.03 * u, offset=0.0)
    M.finish(ob, 1)
    C.add(ob, color, 'head', 'paper', line=0.8, painter=marks_painter)
    if fox:
        ears = []
        for s in (1, -1):
            base = P.head_c + V(s * 0.2, -0.38, 0.22) * u
            ears.append(M.tube([base, base + V(s * 0.06, 0.03, 0.15) * u, base + V(s * 0.08, 0.05, 0.28) * u], [0.09 * u, 0.05 * u, 0.008 * u], n=8, samples=8).build(f'foxear{s}'))
        sn = M.sphere(P.head_c + V(0, -0.6, -0.27) * u, 0.12 * u, 12, 8, scale=(1, 1.1, 0.9)).build('snout')
        eo = M.merge(ears + [sn], 'foxbits')
        M.finish(eo, 1)
        C.add(eo, color, 'head', 'paper', line=0.8)
    slits = slits if slits is not None else [((s * 0.06, -0.08), (s * 0.15, -0.05), (s * 0.25, 0.0)) for s in (1, -1)]
    mk = []
    for i, sl in enumerate(slits):
        c2 = np.array(sl, dtype=np.float64)
        S2 = M.strip2d(c2, np.array([0.035, 0.045, 0.012][:len(c2)] if len(c2) == 3 else np.full(len(c2), 0.03)), n=10)
        pts3, _ = surf.project(to3d(S2.reshape(-1, 2)), (0, 1, 0), back=0.3, lift=lift * u + 0.02 * u)
        mk.append(M.face_toward(M.Grid(pts3.reshape(2, -1, 3), False).build(f'slit{i}'), V(0, -1, 0)))
    mo = M.merge(mk, 'mask_mark')
    C.add(mo, mark, 'head', 'emissive', line=0.0, recalc=False)


def glow_spot(C, name, x, z, rx, rz, color, kind='head', lift=0.004, mid='emissive'):
    """A glowing painted eye on a faceless head (head units)."""
    P, hd = C.P, C.head
    to3d = face_to3d(P, hd, 0, x, z, 0.0)
    a = np.linspace(0, 2 * math.pi, 24, endpoint=False)
    R2 = np.array([np.stack([np.cos(a) * rx * f, np.sin(a) * rz * f], 1) for f in (0.5, 1.0)])
    ob = M.decal(name, C.surf, to3d, R2, closed=True, lift=lift * P.u, cap=V(0, 0))
    col = C.col(color)
    n = R2.shape[0] * R2.shape[1] + 1
    vc = np.tile(col, (n, 1))
    vc[R2.shape[1]:2 * R2.shape[1]] *= 0.75
    C.add(ob, color, kind, mid, line=0.0, vcol=vc, ao=False)
    return ob
