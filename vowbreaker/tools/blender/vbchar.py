"""
vbchar: Vowbreaker's character builder, on the ring-loft modeller (vbmesh).

  Proportions  joint positions from height and build (A-pose; every rig shares bone directions,
               so rotation-only clips authored on one character play on all of them)
  Head         a parametric anime head S(a, t): a = angle round (0 = front), t = 0 crown .. 1 chin;
               cranium, V-jaw, chin, nose, brow and sockets are explicit shaping functions
  face decals  eyes (polar meshes clipped by the lid outline: pupil, banded iris, sclera with lid
               shadow, highlights), lash lines with a flick, lower lids, brows, mouth: 2D shapes cast
               onto the finished head
  hair         a cap offset from the head surface down to a hairline, plus locks: lens-shaped
               ribbons that hug the skull for a while (marching over S) and then fall free
  Body         torso as superellipse rings (width, front depth, back depth per height); arms, legs
  clothing     lofts of those rings with offsets: shirts, jackets (open fronts as open arcs),
               trousers, pleated skirts, long coats and robes (kimono sleeves), obi, straps
  hands/shoes  palm + phalanx lofts with a fist curl; heel-to-toe lofts with soles
  vertex data  colour rgb = palette x tint, alpha = material id / 8; UVMap = (baked AO, ink line
               width); UV2 = face-shadow thresholds; skinned to one shared skeleton

Blender axes: Z up, characters face -Y, their left is +X. 1 unit = 1 m.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import vbcore as core  # noqa: E402
import vbmesh as M  # noqa: E402
from vbmesh import nrm, smooth  # noqa: E402

OUT = os.path.join(core.ASSETS, 'chars')
MAT_ID = {'cloth': 0, 'skin': 1, 'hair': 2, 'eye': 3, 'metal': 4, 'face': 5, 'emissive': 6, 'paper': 7}
ARM_ANGLE = math.radians(42.0)
FOOT_DIR = np.array([0.0, -1.0, -0.36]) / np.linalg.norm([0.0, -1.0, -0.36])


def V(*a):
    if len(a) == 1:
        return np.asarray(a[0], dtype=np.float64)
    return np.asarray(a, dtype=np.float64)


# =============================================================================== proportions

class Proportions:
    def __init__(self, H=1.72, kind='male', build=1.0, head_scale=1.0, leg=1.0):
        self.H = H
        self.kind = kind
        self.child = child = kind == 'child'
        self.female = female = kind == 'female'
        self.build = build
        self.head_h = H * (0.172 if child else (0.136 if female else 0.13)) * head_scale
        self.u = u = self.head_h
        self.z_crown = H
        self.z_chin = H - u
        self.head_c = V(0.0, 0.004 * H, self.z_chin + u * 0.6)
        self.neck_base = self.z_chin - (0.035 if child else 0.042) * H
        self.z_sh = self.neck_base - 0.012 * H
        self.sw = H * (0.092 if child else (0.094 if female else 0.106)) * build
        self.hw = H * (0.05 if child else (0.062 if female else 0.056)) * build
        self.z_hip = H * (0.455 if child else 0.5) * leg
        self.z_knee = self.z_hip * 0.53
        self.z_ankle = H * 0.045
        self.ua = H * (0.16 if child else 0.172)
        self.fa = H * (0.14 if child else 0.152)
        self.hand_len = H * (0.085 if child else 0.098)
        self.foot_len = H * (0.13 if child else 0.145)
        self.waist = H * (0.058 if child else (0.054 if female else 0.066)) * build
        self.chest = H * (0.078 if child else (0.076 if female else 0.08)) * build
        self.dA = {s: V(s * math.sin(ARM_ANGLE), 0.0, -math.cos(ARM_ANGLE)) for s in (1, -1)}
        self.S = {s: V(s * self.sw, 0.0, self.z_sh) for s in (1, -1)}
        self.E = {s: self.S[s] + self.dA[s] * self.ua for s in (1, -1)}
        self.W = {s: self.E[s] + self.dA[s] * self.fa for s in (1, -1)}
        self.Hp = {s: V(s * self.hw, 0.0, self.z_hip) for s in (1, -1)}
        self.K = {s: V(s * self.hw, 0.0, self.z_knee) for s in (1, -1)}
        self.A = {s: V(s * self.hw, 0.0, self.z_ankle) for s in (1, -1)}
        self.Ball = {s: self.A[s] + FOOT_DIR * (self.foot_len * 0.66) for s in (1, -1)}
        self.Toe = {s: self.Ball[s] + V(0, -1, 0) * (self.foot_len * 0.34) for s in (1, -1)}
        self.face = {}


# =============================================================================== the body rings

class Body:
    """The trunk as stacked superellipse rings: half width W, front depth F, back depth B and an
    exponent p per height, interpolated smoothly (pchip). point(a, z, grow) is on the surface."""

    def __init__(self, P):
        self.P = P
        H, hw, sw = P.H, P.hw, P.sw
        f = P.female
        zh, zs, nb = P.z_hip, P.z_sh, P.neck_base
        lv = [  # z, W, F/W, B/W, p
            (zh - 0.08 * H, hw * (1.38 if f else 1.26), 0.6, 0.66, 2.2),
            (zh - 0.02 * H, hw * (1.62 if f else 1.44), 0.6, 0.76 if f else 0.72, 2.3),
            (zh + 0.045 * H, hw * (1.5 if f else 1.38), 0.62, 0.68, 2.3),
            (zh + 0.1 * H, P.waist, 0.72, 0.64, 2.2),
            (zh + 0.17 * H, P.chest * 0.97, 0.76, 0.66, 2.3),
            (zs - 0.07 * H, P.chest, 0.76, 0.7, 2.4),
            (zs - 0.02 * H, sw * 0.88, 0.62, 0.6, 2.7),
            (zs + 0.012 * H, sw * 0.8, 0.56, 0.56, 2.8),
            (zs + 0.024 * H, sw * 0.6, 0.6, 0.6, 2.6),
            (nb + 0.006 * H, sw * 0.38, 0.86, 0.86, 2.2),
            (nb + 0.022 * H, 0.032 * H * (0.9 if f or P.child else 1.0), 0.95, 0.95, 2.0),
        ]
        lv = np.array(lv)
        self.z = lv[:, 0]
        self.Wk, self.Fk, self.Bk, self.pk = lv[:, 1], lv[:, 1] * lv[:, 2], lv[:, 1] * lv[:, 3], lv[:, 4]
        self.bust = f and not P.child

    def dims(self, z):
        z = np.clip(z, self.z[0], self.z[-1])
        return (M.pchip(self.z, self.Wk, z), M.pchip(self.z, self.Fk, z), M.pchip(self.z, self.Bk, z), M.pchip(self.z, self.pk, z))

    def point(self, a, z, grow=0.0):
        """a: angle (0 = front, + toward the left), z: height. Broadcasts."""
        a, z = np.broadcast_arrays(np.asarray(a, dtype=np.float64), np.asarray(z, dtype=np.float64))
        W, F, B, p = self.dims(z)
        W, F, B = W + grow, F + grow, B + grow
        c, s = np.cos(a), np.sin(a)
        e = 2.0 / p
        x = W * np.sign(s) * np.abs(s) ** e
        y = np.where(c >= 0, -F, B) * np.abs(c) ** e
        if self.bust:
            H = self.P.H
            for sx in (1, -1):
                d2 = ((x - sx * 0.045 * H) / (0.042 * H)) ** 2 + ((z - (self.P.z_sh - 0.088 * H)) / (0.036 * H)) ** 2
                y = y - 0.03 * H * np.exp(-d2 * 1.6) * (c > 0)
        return np.stack([x, y, z], -1)

    def ring(self, z, n=32, grow=0.0, arc=None):
        a = np.linspace(0, 2 * math.pi, n, endpoint=False) if arc is None else np.linspace(arc[0], arc[1], n)
        return self.point(a, np.full(n, z), grow)

    def normal(self, a, z, grow=0.0):
        e = 1e-3
        pa = self.point(a + e, z, grow) - self.point(a - e, z, grow)
        pz = self.point(a, z + e, grow) - self.point(a, z - e, grow)
        n = np.cross(pa, pz)
        n = nrm(n)
        out = self.point(a, z, grow) - np.stack([np.zeros_like(np.asarray(z, float)), np.zeros_like(np.asarray(z, float)), np.asarray(z, float)], -1)
        flip = np.sum(n * out, -1) < 0
        return np.where(flip[..., None], -n, n)

    def back(self, z, grow=0.0):
        return self.point(math.pi, z, grow)[1]


# =============================================================================== head

class Head:
    """The parametric anime head in head units around the cranium centre (x left, y back, z up)."""

    def __init__(self, P, st):
        self.P = P
        self.st = st
        w = st.get('width', 1.0)
        jaw = st.get('jaw', 0.6)
        ch = st.get('cheek', 0.5)
        self.Wc, self.Fc, self.Bc = 0.43 * w, 0.45, 0.48
        self.zc, self.ztop, self.zchin = -0.05, 0.42, -0.6
        self.rz = self.ztop - self.zc
        self.te = 0.42
        uk = [0.0, 0.2, 0.42, 0.62, 0.8, 0.93, 1.0]
        self.fW = (uk, [1.0, 0.985, 0.93 + 0.05 * ch, 0.8 - 0.06 * jaw + 0.04 * ch, 0.6 - 0.08 * jaw + 0.02 * ch, 0.38 - 0.05 * jaw, 0.17])
        self.fF = (uk, [1.0, 1.0, 0.985, 0.95, 0.89, 0.82, 0.78])
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
        ns = st.get('nose', 1.0)
        nz = self.nose_z
        tip = ns * 0.026 * np.exp(-(x / 0.026) ** 2 - ((z - nz) / 0.03) ** 2)
        bridge = ns * 0.008 * np.exp(-(x / 0.03) ** 2) * smooth(nz - 0.02, nz + 0.03, z) * smooth(self.eye_z + 0.05, self.eye_z - 0.03, z)
        y = y - np.maximum(tip, bridge) * fr
        br = st.get('brow_ridge', 0.0)
        y = y - br * 0.028 * np.exp(-((z - (self.eye_z + 0.13)) / 0.045) ** 2) * fr * smooth(0.42, 0.05, np.abs(x))
        for sx in (1, -1):
            y = y + 0.012 * np.exp(-((x - sx * self.eye_x) / 0.085) ** 2 - ((z - self.eye_z) / 0.065) ** 2) * fr
        y = y - st.get('chin', 1.0) * 0.01 * np.exp(-(x / 0.07) ** 2 - ((z + 0.57) / 0.05) ** 2) * fr
        y = y + 0.004 * np.exp(-(x / 0.06) ** 2 - ((z - self.mouth_z) / 0.015) ** 2) * fr
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
        """Head param t for a local height z (z only depends on t)."""
        tt = np.linspace(0, 1, 400)
        zz = self.shape(np.zeros_like(tt), tt)[2]
        return np.interp(-np.asarray(z, dtype=np.float64), -zz, tt)

    def width_at(self, z):
        t = self.t_of_z(z)
        return float(self.shape(math.pi / 2, t)[0])

    def grid(self, na=48, nt=36, t0=0.0, t1=1.0, a0=None, a1=None):
        ts = np.linspace(t0, t1, nt + 2)[1:-1] if t0 == 0.0 and t1 == 1.0 else np.linspace(t0, t1, nt)
        if a0 is None:
            aa = np.linspace(0, 2 * math.pi, na, endpoint=False)
        else:
            aa = np.linspace(a0, a1, na)
        A, T = np.meshgrid(aa, ts)
        return A, T

    def march(self, a, t, sweep, dist, steps):
        """Walk `dist` metres over the head surface from (a, t), heading down (toward +t) turned
        by `sweep` radians toward +a. Returns arrays of (a, t)."""
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


# =============================================================================== parts

class Part:
    def __init__(self, ob, mname, kind, mid='cloth', line=1.0, face=False, vcol=None, ao=True):
        self.ob, self.mname, self.kind, self.mid, self.line = ob, mname, kind, mid, line
        self.face, self.vcol, self.ao = face, vcol, ao


class Character:
    def __init__(self, name, palette, P):
        self.name = name
        self.P = P
        self.palette = dict(palette)
        self.parts = []
        self.extra_bones = []
        self.weight_overrides = {}
        self.body = Body(P)
        self.head = None
        self.head_ob = None

    def add(self, ob, mname, kind, mid='cloth', line=1.0, face=False, vcol=None, ao=True, recalc=True):
        ob.name = f'{self.name}_{ob.name}'
        if recalc and vcol is None:
            M.recalc_normals(ob)
        self.parts.append(Part(ob, mname, kind, mid, line, face, vcol, ao))
        print(f'  {ob.name}: {core.tris(ob)} tris')
        return ob

    def col(self, mname):
        return V(core.srgb(self.palette[mname]))


# =============================================================================== head build

def build_head(C, st):
    P = C.P
    u = P.u
    hd = Head(P, st)
    C.head = hd
    C.style = st
    A, T = hd.grid(st.get('head_na', 48), st.get('head_nt', 36))
    rings = hd.world(A, T)
    crown = hd.world(0.0, 0.0)
    chin = hd.world(np.linspace(0, 2 * math.pi, 48, endpoint=False), np.full(48, T[-1, 0])).mean(0) + V(0, 0, -0.01) * u
    g = M.Grid(rings, True, crown, chin)
    ob = g.build('head')
    M.finish(ob, 1)
    C.head_ob = ob
    C.add(ob, st.get('skin', 'skin'), 'face', st.get('mid', 'skin'), line=0.75, face=st.get('face_shadow', True))
    # ears: a bean lofted up the side of the head, tilted back
    if not st.get('no_ears'):
        for s in (1, -1):
            ez = -0.155
            xw = hd.width_at(ez)
            c = P.head_c + V(s * xw * 0.95, 0.035, ez) * u
            up = nrm(V(0, 0.22, 1))
            pts = [c - up * 0.12 * u, c - up * 0.04 * u, c + up * 0.05 * u, c + up * 0.12 * u]
            guide = nrm(V(s, -0.35, 0))
            prof = lambda i, m, r, s=s: M.lens(8, r, r * 0.34, 0.2)
            eg = M.tube(pts, [0.03 * u, 0.06 * u, 0.065 * u, 0.035 * u], cap0='pole', cap1='pole', guide=guide, samples=10, profile=prof)
            eo = eg.build(f'ear_{"L" if s > 0 else "R"}')
            M.finish(eo, 1)
            C.add(eo, st.get('skin', 'skin'), 'head', st.get('mid', 'skin'), line=0.6)
    # neck: from inside the head down into the collar
    H = P.H
    nr = (0.03 if P.female or P.child else 0.034) * H * st.get('neck', 1.0)
    neck = M.tube([P.head_c + V(0, 0.06, -0.3) * u, P.head_c + V(0, 0.07, -0.6) * u, V(0, 0.012 * H, P.neck_base - 0.035 * H)],
                  [nr * 0.95, nr, nr * 1.15], n=16, cap0='pole', cap1='pole', samples=10)
    no = neck.build('neck')
    M.finish(no, 1)
    C.add(no, st.get('skin', 'skin'), 'head', st.get('mid', 'skin'), line=0.6)
    surf = M.Surface(ob)
    if st.get('faceless'):
        for k, (x, z) in {'eye_L': (hd.eye_x, hd.eye_z), 'eye_R': (-hd.eye_x, hd.eye_z), 'brow_L': (hd.eye_x, hd.eye_z + 0.15),
                          'brow_R': (-hd.eye_x, hd.eye_z + 0.15), 'mouth': (0.0, hd.mouth_z), 'mouth_L': (0.07, hd.mouth_z),
                          'mouth_R': (-0.07, hd.mouth_z)}.items():
            p, _ = surf.project([P.head_c + V(x, -1.0, z) * u], (0, 1, 0))
            P.face[k] = p[0]
        return surf
    build_face(C, hd, surf, st)
    return surf


def face_to3d(P, hd, s, cx, cz, tilt=0.0):
    """Map 2D feature coords (ex outward, ez up; head units) around (cx, cz) on side s to points
    in front of the face; rays then travel +Y onto it."""
    u = P.u
    c, sn = math.cos(tilt), math.sin(tilt)

    def f(q):
        q = np.asarray(q, dtype=np.float64)
        ex = q[:, 0] * c - q[:, 1] * sn
        ez = q[:, 0] * sn + q[:, 1] * c
        X = s * (cx + ex) if s != 0 else cx + ex
        Z = cz + ez
        return P.head_c + np.stack([X, np.full(len(q), -1.0), Z], 1) * u
    return f


def eye_outline(st):
    ew, eh = st.get('eye_w', 0.085), st.get('eye_h', 0.1)
    droop = st.get('eye_droop', 0.0)          # outer corner down (soft) .. up (sharp, negative)
    top = st.get('eye_top', 0.0)              # peak of the upper lid toward outer (+) or inner (-)
    Ci = V(-ew, -0.18 * eh)
    Co = V(ew * 1.02, (0.06 - droop * 0.4) * eh)
    upper = [Ci, V(-0.72 * ew, 0.5 * eh), V((-0.2 + top) * ew, 0.93 * eh), V((0.35 + top) * ew, 0.97 * eh), V(0.8 * ew, (0.62 - droop * 0.3) * eh), Co]
    lower = [Co, V(0.72 * ew, (-0.42 - droop * 0.2) * eh), V(0.2 * ew, -0.78 * eh), V(-0.4 * ew, -0.72 * eh), V(-0.8 * ew, -0.48 * eh), Ci]
    U = M.catmull(upper, 34)
    L = M.catmull(lower, 34)
    return U, L, Ci, Co, ew, eh


def build_face(C, hd, surf, st):
    P = C.P
    u = P.u
    iris_col = C.col('iris')
    white = C.col('eye_white')
    lash_col = C.col('lash')
    tilt = math.radians(st.get('eye_tilt', 6.0))
    for s, side in ((1, 'L'), (-1, 'R')):
        U, L, Ci, Co, ew, eh = eye_outline(st)
        outline = np.vstack([U, L[1:-1]])
        to3d = face_to3d(P, hd, s, hd.eye_x, hd.eye_z, tilt)
        E, _ = surf.project(to3d(np.zeros((1, 2))), (0, 1, 0))
        P.face[f'eye_{side}'] = E[0]
        # --- polar eye mesh ------------------------------------------------------------------
        ir = st.get('iris', 0.72)
        rx, rz = ew * ir, ew * ir * st.get('iris_tall', 1.2)
        ic = V(st.get('iris_x', -0.06) * ew, st.get('iris_z', -0.06) * eh)
        On = (outline - ic) / V(rx, rz)
        nang = 48
        ang = np.linspace(0, 2 * math.pi, nang, endpoint=False)
        rho_out = M.polygon_rays((0, 0), On, ang)

        def ring(rho):
            rc = np.minimum(rho, rho_out)
            return ic + np.stack([np.cos(ang) * rc * rx, np.sin(ang) * rc * rz], 1)

        pupil = st.get('pupil', 0.44)
        lift = 0.0028 * u
        layers = {
            'pupil': [pupil * 0.5, pupil],
            'iris': [pupil, pupil + 0.03, 0.6, 0.72, 0.84, 0.9, 0.94, 1.0],
            'sclera': None,
        }
        for region in ('pupil', 'iris', 'sclera'):
            if region == 'sclera':
                rhos = [1.0, 1.0 + 0.001]
                R2 = [ring(1.0)] + [ic + np.stack([np.cos(ang), np.sin(ang)], 1) * np.stack([rx * (1 + (rho_out - 1).clip(0) * k), rz * (1 + (rho_out - 1).clip(0) * k)], 1)
                                    for k in (0.35, 0.7, 1.0)]
                R2 = [ic + (r - ic) for r in R2]
                R2[-1] = ic + np.stack([np.cos(ang) * np.maximum(rho_out, 1e-4) * rx, np.sin(ang) * np.maximum(rho_out, 1e-4) * rz], 1)
                for i in range(1, len(R2)):
                    # never inside the iris edge
                    d0 = np.linalg.norm((R2[0] - ic) / V(rx, rz), axis=1)
                    di = np.linalg.norm((R2[i] - ic) / V(rx, rz), axis=1)
                    R2[i] = np.where((di < d0)[:, None], R2[0], R2[i])
                R2 = np.array(R2)
                cap = None
            else:
                rhos = layers[region]
                R2 = np.array([ring(r) for r in rhos])
                cap = ic if region == 'pupil' else None
            ob = M.decal(f'{region}_{side}', surf, to3d, R2, closed=True, lift=lift, cap=cap)
            # colours per vertex, from the 2D layout
            pts2 = R2.reshape(-1, 2)
            if cap is not None:
                pts2 = np.vstack([pts2, cap[None]])
            q = (pts2 - ic) / V(rx, rz)
            rho = np.linalg.norm(q, axis=1)
            qz = q[:, 1]
            if region == 'pupil':
                col = np.tile(iris_col * 0.1 + 0.01, (len(pts2), 1))
            elif region == 'iris':
                dark = smooth(-0.1, 0.85, qz)
                lightband = smooth(0.4, 0.62, rho) * (1 - smooth(0.84, 0.92, rho)) * smooth(0.0, -0.6, qz)
                col = iris_col[None] * (1.15 - 0.72 * dark)[:, None] + lightband[:, None] * (iris_col * 0.6 + 0.25)
                rim = smooth(0.88, 0.96, rho)
                col = col * (1 - 0.6 * rim)[:, None]
                inner = 1 - smooth(pupil + 0.01, pupil + 0.08, rho)
                col = col * (1 - 0.35 * inner)[:, None]
            else:
                ytop = (pts2[:, 1] - ic[1]) / (eh * 1.0)
                shade = smooth(0.2, 0.85, ytop)
                col = white[None] * (1 - 0.3 * shade)[:, None] * V(1.0, 1.0, 1.04) - shade[:, None] * V(0.05, 0.03, 0.0)
            C.add(ob, 'eye_white', f'eye_{side}', 'eye', line=0.0, vcol=np.clip(col, 0, 1), ao=False)
            if not np.isfinite(rhos[0]):
                pass
        # --- highlights (both on the character's right / screen left, as if lit from one side) ---
        hl_s = -1.0 * s
        for k, (dx, dz, r1, r2) in enumerate(((0.38, 0.42, 0.24, 0.27), (-0.34, -0.5, 0.1, 0.11))):
            cx = ic + V(hl_s * dx * rx * (1 if k == 0 else 1), dz * rz)
            a2 = np.linspace(0, 2 * math.pi, 16, endpoint=False)
            R2 = np.array([cx + np.stack([np.cos(a2) * r1 * rx * f, np.sin(a2) * r2 * rz * f], 1) for f in (0.6, 1.0)])
            ob = M.decal(f'hilite{k}_{side}', surf, to3d, R2, closed=True, lift=lift * 1.6, cap=cx)
            C.add(ob, 'eye_hi', f'eye_{side}', 'eye', line=0.0, vcol=np.tile(C.col('eye_hi'), (len(R2.reshape(-1, 2)) + 1, 1)), ao=False)
        # --- upper lash line with a flick past the outer corner -------------------------------
        lw = st.get('lash', 1.0) * u
        n_up = len(U)
        sel = U[::3]
        if not np.allclose(sel[-1], U[-1]):
            sel = np.vstack([sel, U[-1]])
        flick = Co + V(0.2 * ew, (0.16 + st.get('flick', 0.0)) * eh)
        curve = np.vstack([sel, flick])
        tt = M.arclen(curve)
        wid = lw * (0.006 + 0.016 * smooth(0.0, 0.35, tt) - 0.004 * smooth(0.6, 0.85, tt)) * (1 - 0.85 * smooth(0.86, 1.0, tt))
        S2 = M.strip2d(curve, wid, n=40)
        mid_line = (S2[0] + S2[1]) / 2
        shift = (S2[0] - S2[1]) / 2 * 0.75     # most of the stroke above the lid
        R2 = np.array([S2[0] + shift, S2[1] + shift])
        ob = M.decal(f'lash_{side}', surf, to3d, R2, closed=False, lift=lift * 1.3)
        C.add(ob, 'lash', f'eye_{side}', 'eye', line=0.0, vcol=np.tile(lash_col, (R2.shape[0] * R2.shape[1], 1)), ao=False)
        # lashes: a couple of strokes off the outer end for heavier lash styles
        if st.get('lash', 1.0) >= 1.1:
            for j, (bx, bz, ex2, ez2) in enumerate(((0.75, 0.62, 1.05, 0.95), (0.9, 0.38, 1.22, 0.62))):
                c2 = np.array([V(bx * ew, bz * eh), V((bx + ex2) / 2 * ew, (bz + ez2) / 2 * eh + 0.01), V(ex2 * ew, ez2 * eh)])
                S3 = M.strip2d(c2, lw * np.array([0.008, 0.005, 0.0008]), n=8)
                ob = M.decal(f'lashes{j}_{side}', surf, to3d, S3, closed=False, lift=lift * 1.3)
                C.add(ob, 'lash', f'eye_{side}', 'eye', line=0.0, vcol=np.tile(lash_col, (S3.shape[0] * S3.shape[1], 1)), ao=False)
        # lower lid: a faint short stroke under the outer half
        low = L[:14]
        tt = M.arclen(low)
        S2 = M.strip2d(low, lw * (0.0055 * (1 - tt) + 0.001), n=14)
        ob = M.decal(f'lowlid_{side}', surf, to3d, S2, closed=False, lift=lift * 1.3)
        C.add(ob, 'lash', f'eye_{side}', 'eye', line=0.0, vcol=np.tile(lash_col * 0.9 + 0.05, (S2.shape[0] * S2.shape[1], 1)), ao=False)
        # crease of the upper lid
        if st.get('crease', 0.6) > 0:
            cr = U[6:28] + V(0, 0.085 * eh + 0.018)
            tt = M.arclen(cr)
            S2 = M.strip2d(cr, lw * 0.0028 * np.sin(np.pi * tt) * st.get('crease', 0.6) + 1e-5, n=16)
            ob = M.decal(f'crease_{side}', surf, to3d, S2, closed=False, lift=lift)
            C.add(ob, 'lash', f'eye_{side}', 'eye', line=0.0, vcol=np.tile(lash_col * 0.5 + C.col(st.get('skin', 'skin')) * 0.5, (S2.shape[0] * S2.shape[1], 1)), ao=False)
        # --- brow ------------------------------------------------------------------------------
        ba = math.radians(st.get('brow_angle', 8.0))
        bz0 = eh + 0.075 + st.get('brow_z', 0.0)
        bxs = np.linspace(-0.95, 1.12, 7) * ew
        bzs = bz0 + np.tan(ba) * bxs * 0.55 + 0.016 * (1 - ((bxs - 0.15 * ew) / (1.15 * ew)) ** 2)
        bcurve = np.stack([bxs, bzs], 1)
        tt = M.arclen(bcurve)
        bw = st.get('brow_w', 1.0) * u
        widths = bw * (0.02 * (1 - tt) ** 0.7 + 0.003) * (0.75 + 0.25 * smooth(0.0, 0.12, tt))
        to3d_b = face_to3d(P, hd, s, hd.eye_x, hd.eye_z, 0.0)
        S2 = M.strip2d(bcurve, widths, n=20)
        ob = M.decal(f'brow_{side}', surf, to3d_b, S2, closed=False, lift=lift * 1.2)
        C.add(ob, 'brow', f'brow_{side}', 'eye', line=0.0, vcol=np.tile(C.col('brow'), (S2.shape[0] * S2.shape[1], 1)), ao=False)
        bm, _ = surf.project(to3d_b(V([[0.1 * ew, bz0]])), (0, 1, 0))
        P.face[f'brow_{side}'] = bm[0]
    # --- mouth: a short line whose corners ride their own bones ----------------------------
    mw = st.get('mouth_w', 0.075)
    smile = st.get('smile', 0.1)
    xs = np.linspace(-mw, mw, 7)
    zs = smile * 0.35 * (xs / mw) ** 2 * mw + 0.0
    mcurve = np.stack([xs, zs], 1)
    tt = M.arclen(mcurve)
    widths = u * (0.0035 + 0.0045 * np.sin(np.pi * tt) ** 0.7)
    to3d_m = face_to3d(P, hd, 0, 0.0, hd.mouth_z, 0.0)
    S2 = M.strip2d(mcurve, widths, n=18)
    ob = M.decal('mouth', surf, to3d_m, S2, closed=False, lift=0.0028 * u)
    C.add(ob, 'mouth', 'mouthline', 'eye', line=0.0, vcol=np.tile(C.col('mouth'), (S2.shape[0] * S2.shape[1], 1)), ao=False)
    ends, _ = surf.project(to3d_m(V([[-mw, zs[0]], [0.0, 0.0], [mw, zs[-1]]])), (0, 1, 0))
    P.face['mouth_R'], P.face['mouth'], P.face['mouth_L'] = ends[0], ends[1], ends[2]


# =============================================================================== hair

def hair_cap(C, front=0.2, temple=-0.08, back=-0.32, grow=0.06, mname='hair', na=48, rows=12, part_at=None):
    """The hair over the cranium, offset from the head down to a hairline (local heights)."""
    hd, P = C.head, C.P
    u = P.u
    aa = np.linspace(0, 2 * math.pi, na, endpoint=False)
    c = np.cos(aa)
    side = smooth(0.0, 0.85, 1 - np.abs(c))          # 1 at the temples
    fz = np.where(c > 0, front + (temple - front) * smooth(0.25, 0.95, 1 - c), temple + (back - temple) * smooth(0.0, 0.9, -c))
    th = hd.t_of_z(fz)
    rings = []
    for j in range(1, rows + 1):
        f = (j / rows) ** 0.85
        t = th * f
        p = hd.world(aa, t) + hd.normal(aa, t) * grow * u * (1 - 0.15 * f ** 6)
        rings.append(p)
    # turned-under rim: a ring back toward the scalp so the edge has thickness
    t = th
    rings.append(hd.world(aa, t + 0.012) + hd.normal(aa, t + 0.012) * grow * u * 0.25)
    crown = hd.world(0, 0) + V(0, 0, grow * u)
    g = M.Grid(np.array(rings), True, crown, None)
    ob = g.build('haircap')
    M.finish(ob, 1)
    return ob


def lock(C, a_deg, t, length, width, hug=0.35, out=0.35, drop=0.6, sweep=0.0, curl=0.0, thick=0.32, tip=0.0,
         lift=0.0, grow=0.06, around=8, samples=14, twist=0.0, sharp=0.35, avoid=True, spread=0.0):
    """One clump of hair: rooted on the scalp at (a, t), lying on the head for `hug` of its length,
    then lifting off by `out`, pulled down by `drop`, bent back toward the head by `curl`."""
    hd, P = C.head, C.P
    u = P.u
    a = math.radians(a_deg)
    L = length * u
    n_h = max(int(samples * hug), 0)
    pts, guides = [], []
    if n_h > 0:
        path = hd.march(a, t, math.radians(sweep * 60), L * hug, n_h)
        for k, (pa, pt) in enumerate(path):
            f = k / max(len(path) - 1, 1)
            n = hd.normal(pa, pt)
            pts.append(hd.world(pa, pt) + n * (grow * (0.55 + 0.45 * f) + lift * f) * u)
            guides.append(n)
        a_end, t_end = path[-1]
    else:
        a_end, t_end = a, t
        n = hd.normal(a, t)
        pts.append(hd.world(a, t) + n * grow * 0.55 * u)
        guides.append(n)
    n_end = guides[-1]
    if len(pts) >= 2:
        d = nrm(pts[-1] - pts[-2])
    else:
        e = 1e-3
        St = hd.world(a_end, min(t_end + e, 0.99)) - hd.world(a_end, max(t_end - e, 0.0))
        Sa = hd.world(a_end + e, t_end) - hd.world(a_end - e, t_end)
        d = nrm(nrm(St) * math.cos(math.radians(sweep * 60)) + nrm(Sa) * math.sin(math.radians(sweep * 60)))
    d = nrm(d * (1 - out) + n_end * out)
    n_free = max(samples - n_h, 2)
    ds = L * (1 - hug) / n_free
    p = pts[-1]
    side = nrm(np.cross(n_end, d))
    for k in range(n_free):
        d = nrm(d + V(0, 0, -1) * drop * 2.5 / n_free - n_end * curl * 3.0 / n_free + side * spread * 1.5 / n_free)
        p = p + d * ds
        if avoid:
            p = C.clear(p)
        pts.append(p)
        guides.append(n_end)
    pts = np.array(pts)
    guides = np.array(guides)
    m = samples + 2
    C2 = M.catmull(pts, m)
    tt = M.arclen(C2)
    gi = np.array([guides[min(int(round(x * (len(guides) - 1))), len(guides) - 1)] for x in tt])
    fr = M.guided_frames(C2, gi)
    if twist:
        T, N, B = fr
        ang = twist * tt
        N2 = N * np.cos(ang)[:, None] + B * np.sin(ang)[:, None]
        B2 = np.cross(T, N2)
        fr = (T, N2, B2)
    w = width * u * (0.82 + 0.18 * smooth(0.0, 0.18, tt)) * ((1 - tt) ** 0.85 * (1 - tip) + tip)
    profs = [M.lens(around, max(w[i] * 0.5, 1e-4), max(w[i] * 0.5 * thick, 1e-4), sharp) for i in range(m)]
    g = M.loft(C2, fr, profs, True, 'fan', 'pole' if tip < 0.05 else 'fan')
    g.data = np.repeat(tt[:, None], around, 1)
    return g


def hair(C, specs, cap=None, mname='hair', levels=1):
    """Build the cap and every lock; one hair part."""
    obs = [cap] if cap is not None else []
    for i, sp in enumerate(specs):
        a_deg, t, length, width = sp[:4]
        kw = sp[4] if len(sp) > 4 else {}
        g = lock(C, a_deg, t, length, width, **kw)
        ob = g.build(f'lock{i}')
        M.finish(ob, levels)
        obs.append(ob)
    ob = M.merge(obs, 'hair')
    C.add(ob, mname, 'hair', 'hair', line=1.0)
    return ob


def hair_chain(C, top, bottom, n=2, prefix='hair'):
    top, bottom = V(top), V(bottom)
    prev = 'head'
    for i in range(n):
        a = top + (bottom - top) * (i / n)
        b = top + (bottom - top) * ((i + 1) / n)
        name = f'{prefix}_{i + 1}'
        C.extra_bones.append((name, tuple(a), tuple(b), prev))
        prev = name


def _clear(C, p):
    """Keep falling hair outside the shoulders and back."""
    P = C.P
    H = P.H
    z = p[2]
    if z > P.neck_base or z < P.z_hip:
        return p
    W, F, B, _ = C.body.dims(z)
    x, y = p[0], p[1]
    W, F, B = W + 0.03 * H, F + 0.03 * H, B + 0.03 * H
    k = (x / W) ** 2 + (y / (B if y > 0 else F)) ** 2
    if k < 1:
        s = 1 / math.sqrt(max(k, 1e-6))
        return V(x * s, y * s, z)
    return p


Character.clear = _clear


# =============================================================================== clothing

def torso_shell(C, z0, z1, grow, rings=18, n=40, gap=None, flare=0.0):
    """Rings of the trunk between heights z0 (bottom) and z1 (top). gap(z) -> half-angle of an
    open front (radians) or None."""
    B = C.body
    zs = np.linspace(z0, z1, rings)
    out = []
    for z in zs:
        g = grow + flare * smooth(z0 + (z1 - z0) * 0.4, z0, z)
        if gap is not None:
            ga = gap(z)
            ring = B.ring(z, n, g, arc=(ga, 2 * math.pi - ga))
        else:
            ring = B.ring(z, n, g)
        out.append(ring)
    return np.array(out)


def sleeve(C, s, grow, cuff=0.0, wide=0.0, drop=0.0, n=16, samples=16, start=0.035):
    """A sleeve along the arm, closed inside the shoulder, open at the cuff."""
    P = C.P
    H = P.H
    S, E, Wr, d = P.S[s], P.E[s], P.W[s], P.dA[s]
    end = Wr + d * (0.004 - cuff) * H
    pts = [S + V(-s * start * H, 0, -0.006 * H), S + d * P.ua * 0.12, S + d * P.ua * 0.5, E, E + d * P.fa * 0.5, end]
    radii = np.array([0.021, 0.0255, 0.0238, 0.021, 0.0205, 0.0175]) * H + grow
    radii[-1] += wide
    radii[-2] += wide * 0.45
    radii[-3] += wide * 0.15
    C2 = M.catmull(np.array(pts), samples)
    tt = M.arclen(C2)
    r = np.interp(tt, M.arclen(np.array(pts)), radii)
    T, Nn, Bn = M.rmf(C2, first_normal=V(0, -1, 0))
    rings = []
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    for i in range(samples):
        prof = M.superellipse(n, r[i], r[i] * 0.94, 2.1)
        ring = C2[i] + np.outer(prof[:, 0], Bn[i]) + np.outer(prof[:, 1], Nn[i])
        if drop:
            # kimono sleeves: the underside hangs, more toward the cuff
            down = V(0, 0, -1)
            under = np.clip(-(ring - C2[i]) @ down / max(r[i], 1e-6) * -1, 0, 1)
            sag = drop * H * smooth(0.25, 1.0, tt[i])
            low = np.clip(((ring - C2[i]) @ down) / max(r[i], 1e-6), 0, 1)
            ring = ring + np.outer(low * sag, down)
        rings.append(ring)
    g = M.Grid(np.array(rings), True, 'pole', None)
    return g


def finish_cloth(C, ob, thick, levels=1):
    M.finish(ob, 0, thickness=thick, offset=-1.0)
    M.finish(ob, levels)
    return ob


def shirt(C, color='shirt', top=None, bottom=None, grow=0.004, hood=False, collar=False):
    P = C.P
    H = P.H
    top = top if top is not None else P.neck_base + 0.006 * H
    bottom = bottom if bottom is not None else P.z_hip - 0.04 * H
    rings = torso_shell(C, bottom, top, grow * H, rings=12, n=32)
    ob = M.Grid(rings, True, None, None).build('shirt')
    finish_cloth(C, ob, 0.004 * H)
    C.add(ob, color, 'torso')
    if hood:
        # a bunched hood lying behind the neck
        c = V(0, 0.05 * H, P.neck_base - 0.006 * H)
        pts = [c + V(0.06 * H, -0.02 * H, 0.012 * H), c + V(0.04 * H, 0.012 * H, 0.004 * H), c + V(0, 0.022 * H, -0.004 * H),
               c + V(-0.04 * H, 0.012 * H, 0.004 * H), c + V(-0.06 * H, -0.02 * H, 0.012 * H)]
        g = M.tube(pts, [0.016 * H, 0.024 * H, 0.028 * H, 0.024 * H, 0.016 * H], n=12, samples=14, squash=0.7, guide=V(0, 0, 1))
        ho = g.build('hood')
        M.finish(ho, 1)
        C.add(ho, color, 'torsopart')
    if collar:
        stand_collar(C, color, open_front=0.25)


def stand_collar(C, color, height=0.026, open_front=0.0, grow=0.012, flare=0.006):
    P = C.P
    H = P.H
    z0 = P.neck_base - 0.006 * H
    rings = []
    ga = open_front
    a = np.linspace(ga, 2 * math.pi - ga, 40) if ga > 0 else np.linspace(0, 2 * math.pi, 40, endpoint=False)
    for k, f in enumerate(np.linspace(0, 1, 5)):
        z = z0 + f * height * H
        r = 0.04 * H + grow * H * 0.4 + flare * H * f
        ring = np.stack([np.sin(a) * r, -np.cos(a) * r * 0.92 + 0.006 * H, np.full(len(a), z - 0.008 * H * (np.cos(a) > 0.6) * f)], 1)
        rings.append(ring)
    ob = M.Grid(np.array(rings), ga <= 0, None, None).build('collar')
    finish_cloth(C, ob, 0.005 * H)
    C.add(ob, color, 'torsopart')


def jacket(C, color='jacket', hem=None, open_front=0.0, collar='stand', grow=0.007, buttons='button', sleeves=True, cuff=0.0, kind='torso'):
    """A fitted jacket (gakuran style): trunk shell, sleeves, a standing collar, buttons."""
    P = C.P
    H = P.H
    hem = hem if hem is not None else P.z_hip - 0.05 * H
    top = P.neck_base + 0.004 * H
    gap = None
    if open_front > 0:
        def gap(z):
            w = open_front * H * (0.35 + 0.65 * smooth(P.z_sh, hem, z))
            W = C.body.dims(z)[0] + grow * H
            return float(np.arcsin(np.clip(w / W, 0, 0.9)))
    rings = torso_shell(C, hem, top, grow * H, rings=20, n=44, gap=gap, flare=0.006 * H)
    ob = M.Grid(rings, gap is None, None, None).build('jacket')
    finish_cloth(C, ob, 0.005 * H)
    C.add(ob, color, kind)
    if sleeves:
        for s, side in ((1, 'L'), (-1, 'R')):
            so = sleeve(C, s, grow * H, cuff=cuff).build(f'sleeve_{side}')
            finish_cloth(C, so, 0.004 * H)
            C.add(so, color, f'sleeve_{side}')
            # cuff band
            d = P.dA[s]
            cpos = P.W[s] + d * (0.0 - cuff) * H
            cb = M.torus(cpos, 0.0185 * H + grow * H, 0.003 * H, axis=d, n=20, m=6, squash=1.6).build(f'cuff_{side}')
            M.finish(cb, 1)
            C.add(cb, color, f'sleeve_{side}')
    if collar == 'stand':
        stand_collar(C, color, open_front=0.3 if open_front > 0 else 0.0)
    if buttons and open_front <= 0:
        bl = []
        for i in range(5):
            z = P.z_sh - 0.03 * H - i * (P.z_sh - hem - 0.06 * H) / 4.5
            p = C.body.point(0.0, z, grow * H + 0.004 * H)
            bl.append(M.sphere(p + V(0, -0.002 * H, 0), 0.0072 * H, 10, 6, scale=(1, 0.55, 1)).build(f'button{i}'))
        bo = M.merge(bl, 'buttons')
        M.finish(bo, 1)
        C.add(bo, buttons, 'torsopart', 'metal', line=0.6)


def pants(C, color='pants', top=None, cuff=None, r=(0.056, 0.045, 0.039, 0.036), flare=0.0, grow=0.006):
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.06 * H
    cuff = cuff if cuff is not None else P.z_ankle + 0.022 * H
    crotch = P.z_hip - 0.075 * H
    rings = torso_shell(C, crotch, top, grow * H, rings=8, n=36)
    pel = M.Grid(rings, True, V(0, 0, crotch - 0.01 * H), None).build('pelvis')
    finish_cloth(C, pel, 0.004 * H)
    C.add(pel, color, 'legs')
    for s, side in ((1, 'L'), (-1, 'R')):
        a = P.Hp[s] + V(-s * (0.006 if top > P.z_hip else 0.014) * H, 0.002 * H, min(0.03 * H, top - P.z_hip))
        k = P.K[s]
        end = V(P.A[s][0], P.A[s][1], cuff)
        pts = [a, (a + k) / 2 + V(s * 0.003 * H, -0.004 * H, 0), k, (k + end) / 2 + V(0, 0.004 * H, 0), end]
        rad = [r[0] * H, r[0] * 0.92 * H, r[1] * H, r[2] * H, (r[3] + flare) * H]
        g = M.tube(pts, rad, n=18, cap0='pole', cap1=None, samples=16)
        lo = g.build(f'leg_{side}')
        finish_cloth(C, lo, 0.004 * H)
        C.add(lo, color, 'legs')


def tights(C, color='tights', top=None, bottom=None, grow=0.002):
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.03 * H
    bottom = bottom if bottom is not None else P.z_ankle
    crotch = P.z_hip - 0.075 * H
    obs = []
    if top > crotch:
        rings = torso_shell(C, crotch, min(top, P.z_hip + 0.05 * H), grow * H, rings=6, n=32)
        obs.append(M.Grid(rings, True, V(0, 0, crotch - 0.008 * H), None).build('tights_pel'))
    for s, side in ((1, 'L'), (-1, 'R')):
        zt = min(top, P.z_hip + 0.02 * H)
        a = V(P.Hp[s][0] - s * 0.004 * H, 0, zt)
        kk = P.K[s]
        an = V(P.A[s][0], P.A[s][1], bottom)
        pts = [a, kk + V(0, 0, (zt - kk[2]) * 0.5), kk, (kk + an) / 2 + V(0, 0.006 * H, 0), an]
        rr = np.interp([p[2] for p in pts], [P.z_ankle, P.z_knee, P.z_hip + 0.05 * H], [0.025, 0.036, 0.055]) * H + grow * H
        rr[3] += 0.004 * H  # calf
        g = M.tube(pts, rr, n=16, cap0='pole', cap1=None, samples=14)
        obs.append(g.build(f'tights_{side}'))
    ob = M.merge(obs, 'tights')
    M.finish(ob, 1)
    C.add(ob, color, 'legs')


def skirt(C, color='skirt', top=None, hem=None, flare=1.0, pleats=16, depth=0.035):
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.1 * H
    hem = hem if hem is not None else P.z_knee - 0.06 * H
    rt = P.waist * 1.1
    rb = P.hw * 2.25 * flare
    zs = np.linspace(top, hem, 12)
    rr = M.pchip([hem, (hem + top) / 2, P.z_hip, top][::-1], [rb, rb * 0.86, P.hw * 1.8, rt][::-1], zs) if False else None
    prof_z = [top, P.z_hip, (P.z_hip + hem) / 2, hem]
    prof_r = [rt, P.hw * 1.82, rb * 0.88, rb]
    order = np.argsort(prof_z)
    rr = M.pchip(np.array(prof_z)[order], np.array(prof_r)[order], zs)

    def rmod(a, z):
        k = smooth(top, hem, z)
        tri = (2 / math.pi) * np.arcsin(np.sin(a * pleats))
        return 1.0 + depth * k * tri
    g = M.lathe(list(zip(rr, zs)), n=pleats * 4, depth=0.82, rmod=rmod)
    ob = g.build('skirt')
    finish_cloth(C, ob, 0.004 * H)
    C.add(ob, color, 'skirt')
    C.extra_bones += [
        ('skirt_F', (0, -P.hw * 1.2, P.z_hip), (0, -rb, hem), 'hips'),
        ('skirt_B', (0, P.hw * 1.2, P.z_hip), (0, rb, hem), 'hips'),
        ('skirt_L', (P.hw * 1.6, 0, P.z_hip), (rb, 0, hem), 'hips'),
        ('skirt_R', (-P.hw * 1.6, 0, P.z_hip), (-rb, 0, hem), 'hips'),
    ]


def long_coat(C, color='coat', hem=None, open_front=0.05, collar=True, sleeves=True, wide_sleeves=0.0, drop=0.0,
              grow=0.011, tatters=0.0, folds=0.05, hem_r=2.55):
    """A long coat or robe: the trunk rings down to the hips, then flaring folds to the hem."""
    P = C.P
    H = P.H
    gf = grow
    grow = grow * H
    hem = hem if hem is not None else P.z_knee - 0.04 * H
    r_hem = P.hw * hem_r
    top = P.neck_base + 0.006 * H
    n = 48
    zs_up = np.linspace(P.z_hip + 0.04 * H, top, 14)
    zs_lo = np.linspace(hem, P.z_hip + 0.04 * H, 12)[:-1]
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
    ob = M.Grid(np.array(rings), open_front <= 0, None, None).build('coat')
    finish_cloth(C, ob, 0.006 * H)
    C.add(ob, color, 'coat')
    if sleeves:
        for s, side in ((1, 'L'), (-1, 'R')):
            so = sleeve(C, s, grow * 1.05, wide=wide_sleeves * H, drop=drop).build(f'csleeve_{side}')
            finish_cloth(C, so, 0.005 * H)
            C.add(so, color, f'sleeve_{side}')
    if collar:
        stand_collar(C, color, height=0.03, open_front=0.35 if open_front > 0 else 0.0, grow=gf + 0.006, flare=0.01)
    C.extra_bones += [
        ('coat_FL', (P.hw * 0.9, -P.hw * 1.2, P.z_hip), (P.hw * 1.2, -r_hem * 0.75, hem), 'hips'),
        ('coat_FR', (-P.hw * 0.9, -P.hw * 1.2, P.z_hip), (-P.hw * 1.2, -r_hem * 0.75, hem), 'hips'),
        ('coat_B', (0, P.hw * 1.2, P.z_hip), (0, r_hem * 0.75, hem), 'hips'),
        ('coat_L', (P.hw * 1.6, 0, P.z_hip), (r_hem, 0, hem), 'hips'),
        ('coat_R', (-P.hw * 1.6, 0, P.z_hip), (-r_hem, 0, hem), 'hips'),
    ]


def obi(C, color='obi', z=None, height=0.06, grow=0.022, bow=True, bow_color=None):
    P = C.P
    H = P.H
    z = z if z is not None else P.z_hip + 0.11 * H
    rings = [C.body.ring(zz, 44, grow * H + 0.002 * H * math.sin(math.pi * f)) for f, zz in zip(np.linspace(0, 1, 5), np.linspace(z - height * H / 2, z + height * H / 2, 5))]
    ob = M.Grid(np.array(rings), True, None, None).build('obi')
    finish_cloth(C, ob, 0.004 * H)
    C.add(ob, color, 'torsopart')
    if bow:
        back = C.body.point(math.pi, z, grow * H + 0.006 * H)
        obs = []
        for s in (1, -1):
            pts = [back, back + V(s * 0.05 * H, 0.03 * H, 0.03 * H), back + V(s * 0.1 * H, 0.02 * H, 0.0), back + V(s * 0.05 * H, 0.03 * H, -0.03 * H), back]
            g = M.tube(pts, [0.01 * H, 0.022 * H, 0.026 * H, 0.022 * H, 0.01 * H], n=10, samples=16, squash=0.35, guide=V(0, 1, 0))
            obs.append(g.build(f'bowloop{s}'))
            tail = [back, back + V(s * 0.025 * H, 0.012 * H, -0.06 * H), back + V(s * 0.035 * H, 0.016 * H, -0.12 * H)]
            obs.append(M.tube(tail, [0.018 * H, 0.02 * H, 0.022 * H], n=8, samples=8, squash=0.25, guide=V(0, 1, 0), cap1='fan').build(f'bowtail{s}'))
        obs.append(M.sphere(back + V(0, 0.01 * H, 0), 0.02 * H, 10, 6, scale=(1, 0.7, 1.2)).build('knot'))
        bo = M.merge(obs, 'bow')
        M.finish(bo, 1)
        C.add(bo, bow_color or color, 'torsopart')


def strap(C, name, color, a0, z0, a1, z1, width, grow, thick=0.006, kind='torsopart', n=24, mid='cloth'):
    """A band lying on the trunk from (a0, z0) to (a1, z1): kesa, shoulder straps, sashes."""
    P = C.P
    H = P.H
    f = np.linspace(0, 1, n)
    aa = a0 + (a1 - a0) * f
    zz = z0 + (z1 - z0) * f
    C2 = C.body.point(aa, zz, grow)
    No = C.body.normal(aa, zz, grow)
    fr = M.guided_frames(C2, No)
    prof = M.rounded_rect(12, width * 0.5, thick * H * 0.5, thick * H * 0.45)
    g = M.loft(C2 + No * thick * H * 0.5, fr, [prof] * n, True, 'fan', 'fan')
    ob = g.build(name)
    M.finish(ob, 1)
    C.add(ob, color, kind, mid)


def beads(C, color, centre, radius, count, r, tilt=(0, 0, 0), kind='torsopart'):
    R = M.rot_xyz(*tilt)
    obs = []
    for i in range(count):
        a = 2 * math.pi * i / count
        p = V(centre) + R @ V(math.cos(a) * radius, math.sin(a) * radius * 0.85, 0)
        obs.append(M.sphere(p, r, 10, 6).build(f'bead{i}'))
    ob = M.merge(obs, 'beads')
    M.finish(ob, 1)
    C.add(ob, color, kind, 'cloth', line=0.6)


def face_mask(C, color='mask', mark='mask_mark', fox=False, lift=0.07):
    """A lacquered mask over the face (acolytes, the paper god): a plate cast onto the face, with
    painted slits for eyes."""
    P, hd = C.P, C.head
    u = P.u
    surf = M.Surface(C.head_ob)
    to3d = face_to3d(P, hd, 0, 0.0, -0.13, 0.0)
    a = np.linspace(0, 2 * math.pi, 40, endpoint=False)
    rings = []
    for f in (0.25, 0.5, 0.75, 1.0):
        rx, rz = 0.38 * f, 0.47 * f
        rings.append(np.stack([np.cos(a) * rx, np.sin(a) * rz + 0.02 * f], 1))
    R2 = np.array(rings)
    flat = to3d(np.vstack([R2.reshape(-1, 2), [[0.0, 0.0]]]))
    pts, nn = surf.project(flat, (0, 1, 0), back=0.3, lift=lift * u)
    g = M.Grid(pts[:-1].reshape(R2.shape[0], R2.shape[1], 3), True, pts[-1], None)
    ob = g.build('mask')
    M.finish(ob, 0, thickness=0.03 * u, offset=0.0)
    M.finish(ob, 1)
    C.add(ob, color, 'head', 'paper', line=0.8)
    if fox:
        ears = []
        for s in (1, -1):
            base = P.head_c + V(s * 0.2, -0.38, 0.22) * u
            ears.append(M.tube([base, base + V(s * 0.06, 0.03, 0.15) * u, base + V(s * 0.08, 0.05, 0.28) * u], [0.09 * u, 0.05 * u, 0.008 * u], n=8, samples=8).build(f'foxear{s}'))
        sn = M.sphere(P.head_c + V(0, -0.6, -0.27) * u, 0.12 * u, 12, 8, scale=(1, 1.1, 0.9)).build('snout')
        eo = M.merge(ears + [sn], 'foxbits')
        M.finish(eo, 1)
        C.add(eo, color, 'head', 'paper', line=0.8)
    # slits
    mk = []
    for s in (1, -1):
        c2 = np.array([[s * 0.06, -0.08], [s * 0.15, -0.05], [s * 0.25, 0.0]])
        S2 = M.strip2d(c2, np.array([0.035, 0.045, 0.012]) * u / u, n=10)
        pts3, _ = surf.project(to3d(S2.reshape(-1, 2) * 1.0), (0, 1, 0), back=0.3, lift=lift * u + 0.02 * u)
        mk.append(M.face_toward(M.Grid(pts3.reshape(2, -1, 3), False).build(f'slit{s}'), V(0, -1, 0)))
    mo = M.merge(mk, 'mask_mark')
    C.add(mo, mark, 'head', 'emissive', line=0.0, recalc=False)


def hood(C, color='hood', grow=0.12, open_face=0.62, drape=0.0, below=0.2):
    """A cloth hood: the head surface pushed out, opening round the face (each ring is an arc that
    leaves the face oval clear, so the opening edge is a clean loop); optionally draping down."""
    P, hd = C.P, C.head
    u = P.u
    H = P.H
    na = 48
    rings = []
    for t in np.linspace(0.02, 0.9, 28):
        z = float(hd.shape(0.0, t)[2])
        k = 1 - ((z + 0.2) / open_face) ** 2
        xo = 0.42 * math.sqrt(k) if k > 0 else 0.0
        W = max(float(hd.shape(math.pi / 2, t)[0]), 1e-3)
        ga = float(np.arcsin(np.clip(xo / W, 0, 0.98))) if xo > 0 else 0.0
        ga = max(ga, 1e-3)
        aa = np.linspace(ga, 2 * math.pi - ga, na)
        rings.append(hd.world(aa, t) + hd.normal(aa, t) * grow * u * (1 + 0.4 * t))
    last = rings[-1]
    for f in np.linspace(0.2, 1.0, 5) if drape > 0 else []:
        z = P.neck_base + (last[:, 2].mean() - P.neck_base) * (1 - f) - drape * H * f
        ring = last.copy()
        ctr = V(0, 0.02 * H, 0)
        ring[:, :2] = ctr[:2] + (last[:, :2] - ctr[:2]) * (1 + f * 0.9)
        ring[:, 2] = np.minimum(last[:, 2], z)
        rings.append(ring)
    g = M.Grid(np.array(rings), False, None, None)
    ob = g.build('hood')
    finish_cloth(C, ob, 0.03 * u)
    C.add(ob, color, 'head')


# =============================================================================== hands & feet

def hand(C, s, color='skin', fist=0.7, mid='skin', scale=1.0):
    P = C.P
    H = P.H
    k = scale * (1.08 if P.child else 1.0) * H
    Wr, d = P.W[s], P.dA[s]
    fwd = V(0, -1, 0)
    across = nrm(fwd - d * (fwd @ d))
    pn = s * nrm(np.cross(d, across))     # palm normal, facing the body
    obs = []
    # palm
    palm_len = 0.052 * k
    taus = np.array([-0.2, 0.0, 0.35, 0.72, 1.0])
    C2 = np.array([Wr + d * palm_len * t for t in taus])
    widths = np.array([0.013, 0.0145, 0.0185, 0.0205, 0.0195]) * k
    thick = np.array([0.0105, 0.011, 0.0105, 0.0094, 0.0085]) * k
    T = np.tile(d, (len(C2), 1))
    fr = (T, np.tile(pn, (len(C2), 1)), np.tile(np.cross(d, pn), (len(C2), 1)))
    profs = [M.rounded_rect(16, widths[i], thick[i], thick[i] * 0.85) for i in range(len(C2))]
    obs.append(M.loft(C2, fr, profs, True, 'pole', 'fan').build('palm'))
    # fingers: index (toward the thumb side) .. little
    bend_axis = nrm(np.cross(d, pn))
    curls = np.radians([22 + 58 * fist, 38 + 60 * fist, 26 + 44 * fist])
    across_side = across                      # the thumb side (the front, in the A-pose)
    fan = 1.0 if np.cross(pn, d) @ across_side > 0 else -1.0
    for i, (off, lm, back, spread) in enumerate(((0.75, 1.0, 0.0, 4), (0.25, 1.08, 0.001, 1), (-0.25, 1.0, 0.003, -2), (-0.75, 0.8, 0.008, -5))):
        base = Wr + d * (palm_len - back * k) + across_side * off * 0.0165 * k - pn * 0.001 * k
        dirv = M.rot_axis(d, pn, math.radians(spread) * fan)
        dirv = nrm(dirv - pn * (dirv @ pn))
        lens = np.array([0.022, 0.0145, 0.012]) * k * lm
        pts = [base - dirv * 0.006 * k]
        p = base
        dv = dirv.copy()
        for j in range(3):
            dv = M.rot_axis(dv, bend_axis, curls[j])
            p = p + dv * lens[j]
            pts.append(p)
        rr = np.array([0.0062, 0.0058, 0.0051, 0.0044]) * k * (0.92 if i == 3 else 1.0)
        g = M.tube(np.array(pts), rr, n=8, cap0='pole', cap1='pole', samples=10, squash=0.9)
        obs.append(g.build(f'finger{i}'))
    # thumb
    tb = Wr + d * 0.014 * k + across_side * 0.012 * k + pn * 0.004 * k
    tdir = nrm(d * 0.55 + across_side * 0.75 + pn * 0.35)
    taxis = nrm(np.cross(tdir, pn))
    tcurl = np.radians([8 + 22 * fist, 14 + 34 * fist, 10 + 30 * fist])
    pts = [tb]
    p = tb
    dv = tdir.copy()
    for j, ln in enumerate((0.018, 0.0145, 0.012)):
        dv = M.rot_axis(dv, taxis, tcurl[j])
        p = p + dv * ln * k
        pts.append(p)
    obs.append(M.tube(np.array(pts), np.array([0.0095, 0.0078, 0.0066, 0.0056]) * k, n=8, samples=10).build('thumb'))
    ob = M.merge(obs, f'hand_{"L" if s > 0 else "R"}')
    M.finish(ob, 1)
    return ob


def hands(C, color='skin', fist=0.7, mid=None):
    for s, side in ((1, 'L'), (-1, 'R')):
        ob = hand(C, s, color, fist)
        C.add(ob, color, f'hand_{side}', mid or ('skin' if color == 'skin' else 'cloth'), line=0.7)


def shoes(C, color='shoes', sole='sole', boot=0.0, toe_round=1.0):
    P = C.P
    H = P.H
    for s, side in ((1, 'L'), (-1, 'R')):
        A, L = P.A[s], P.foot_len
        x = A[0]
        ys = A[1] + np.array([0.034, 0.012, -0.03, -0.075, -0.105, -0.125]) * H * (L / (0.145 * H))
        zc = np.array([0.026, 0.034, 0.03, 0.02, 0.014, 0.011]) * H
        hw = np.array([0.024, 0.027, 0.029, 0.031, 0.026, 0.014]) * H
        hh = np.array([0.024, 0.032, 0.028, 0.019, 0.013, 0.008]) * H
        C2 = np.stack([np.full(6, x), ys, zc], 1)
        T = np.tile(V(0, -1, 0), (6, 1))
        fr = (T, np.tile(V(0, 0, 1), (6, 1)), np.tile(V(1, 0, 0), (6, 1)) * -1)
        profs = []
        for i in range(6):
            pr = M.superellipse(18, hw[i], hh[i], 2.4)
            pr[:, 1] = np.where(pr[:, 1] < 0, pr[:, 1] * 0.75, pr[:, 1])
            profs.append(pr)
        obs = [M.loft(C2, fr, profs, True, 'pole', 'pole').build('foot')]
        shaft = max(boot, 0.045)
        obs.append(M.tube([A + V(0, 0.004 * H, 0.004 * H), A + V(0, 0.002 * H, shaft * H)], [0.026 * H, 0.025 * H + boot * 0.04 * H], n=16, cap0='pole', cap1=None, samples=6).build('shaft'))
        sh = M.merge(obs, f'shoe_{side}')
        M.finish(sh, 1)
        C.add(sh, color, f'foot_{side}')
        # sole
        zs = np.full(6, 0.006 * H)
        C3 = np.stack([np.full(6, x), ys + V(0.004, 0.0, -0.002, -0.004, -0.004, -0.006)[:6] * H, zs], 1)
        profs = [M.rounded_rect(14, hw[i] * 1.06 + 0.001 * H, 0.0062 * H, 0.004 * H) for i in range(6)]
        so = M.loft(C3, fr, profs, True, 'pole', 'pole').build(f'sole_{side}')
        M.finish(so, 1)
        C.add(so, sole, f'foot_{side}')


# =============================================================================== bare bodies (curses, the paper god)

def hp(P, x, y, z):
    """A point in head units around the cranium centre."""
    return P.head_c + V(x, y, z) * P.u


def skin_body(C, color, grow=0.0, arm_r=(0.03, 0.026, 0.02), leg_r=(0.052, 0.036, 0.024), mid='skin', levels=1,
              noise=0.0, flat=False, n=32):
    """A whole bare figure from lofts: trunk, arms, legs (kinds torso / arm_* / leg_*)."""
    P = C.P
    H = P.H
    g = grow * H
    obs = []
    crotch = P.z_hip - 0.08 * H
    rings = torso_shell(C, crotch, P.neck_base + 0.02 * H, g, rings=16, n=n)
    tor = M.Grid(rings, True, V(0, 0, crotch - 0.015 * H), V(0, 0.01 * H, P.neck_base + 0.035 * H)).build('trunk')
    obs.append((tor, 'torso'))
    for s, side in ((1, 'L'), (-1, 'R')):
        pts = [P.S[s] + V(-s * 0.03 * H, 0, -0.004 * H), P.S[s], P.E[s], P.W[s] - P.dA[s] * 0.005 * H]
        rr = np.array([arm_r[0] * 0.85, arm_r[0], arm_r[1], arm_r[2]]) * H + g
        obs.append((M.tube(pts, rr, n=max(n // 2, 6), samples=12).build(f'arm_{side}'), f'arm_{side}'))
        top = P.Hp[s] + V(-s * 0.01 * H, 0, 0.035 * H)
        pts = [top, P.Hp[s] + (P.K[s] - P.Hp[s]) * 0.45, P.K[s], P.A[s] + V(0, 0, 0.012 * H)]
        rr = np.array([leg_r[0], leg_r[0] * 0.86, leg_r[1], leg_r[2]]) * H + g
        rr[2] = leg_r[1] * H + g
        obs.append((M.tube(pts, rr, n=max(n // 2, 6), samples=12).build(f'leg_{side}'), f'leg_{side}'))
    out = []
    for ob, kind in obs:
        if flat:
            for p in ob.data.polygons:
                p.use_smooth = False
        M.finish(ob, levels)
        if noise:
            def bump(Xw, Nw, seed=len(out)):
                k = M.fbm3(Xw, 9.0 / H, 3, seed) * noise * H + M.value_noise3(Xw, 24.0 / H, seed + 7) * noise * 0.45 * H
                return Nw * k[:, None]
            M.displace(ob, bump)
        out.append(C.add(ob, color, kind, mid, line=1.0 if not flat else 0.8))
    return out


def glow_spot(C, name, x, z, rx, rz, color, kind='head', lift=0.004, mid='emissive', ring_col=None):
    """A glowing painted eye on a faceless head (head units)."""
    P, hd = C.P, C.head
    surf = M.Surface(C.head_ob)
    to3d = face_to3d(P, hd, 0, x, z, 0.0)
    a = np.linspace(0, 2 * math.pi, 24, endpoint=False)
    R2 = np.array([np.stack([np.cos(a) * rx * f, np.sin(a) * rz * f], 1) for f in (0.5, 1.0)])
    ob = M.decal(name, surf, to3d, R2, closed=True, lift=lift * P.u, cap=V(0, 0))
    col = C.col(color)
    n = R2.shape[0] * R2.shape[1] + 1
    vc = np.tile(col, (n, 1))
    vc[R2.shape[1]:2 * R2.shape[1]] *= 0.75
    C.add(ob, color, kind, mid, line=0.0, vcol=vc, ao=False)
    return ob


# =============================================================================== small props

def bell_charm(C, at, size=0.022, kind='torsopart'):
    """Mio's brass bell on a red cord."""
    P = C.P
    H = P.H
    b = V(at)
    prof = [(0.0001, size * 0.95), (size * 0.55, size * 0.85), (size * 0.92, size * 0.35), (size * 1.0, -size * 0.2), (size * 1.06, -size * 0.5), (size * 0.98, -size * 0.58)]
    g = M.lathe([(r, b[2] + z) for r, z in prof], centre=(b[0], b[1], 0), n=20, cap1=V(b[0], b[1], b[2] - size * 0.5))
    bo = g.build('bell')
    M.finish(bo, 1)
    C.add(bo, 'bell', kind, 'metal', line=0.5)
    cord = M.tube([b + V(0, 0, size * 0.9), b + V(0.004 * H, 0, size + 0.025 * H), b + V(0.002 * H, 0.002 * H, size + 0.05 * H)],
                  [0.0025 * H] * 3, n=6, samples=8)
    co = cord.build('cord')
    M.finish(co, 1)
    C.add(co, 'cord', kind, line=0.4)


# =============================================================================== rig

def bones(C):
    P = C.P
    H = P.H
    zp = P.z_hip
    B = [('root', (0, 0, 0), (0, -0.2 * H, 0), None),
         ('hips', (0, 0, zp), (0, 0, zp + 0.08 * H), 'root'),
         ('spine', (0, 0, zp + 0.08 * H), (0, 0, zp + 0.18 * H), 'hips'),
         ('chest', (0, 0, zp + 0.18 * H), (0, 0, P.neck_base), 'spine'),
         ('neck', (0, 0, P.neck_base), (0, 0, P.z_chin + 0.03 * H), 'chest'),
         ('head', (0, 0, P.z_chin + 0.03 * H), (0, 0, P.z_crown), 'neck')]
    t = lambda v: tuple(float(x) for x in v)
    for s, side in ((1, 'L'), (-1, 'R')):
        B += [(f'shoulder_{side}', (s * 0.025 * H, 0, P.z_sh), t(P.S[s]), 'chest'),
              (f'upperarm_{side}', t(P.S[s]), t(P.E[s]), f'shoulder_{side}'),
              (f'forearm_{side}', t(P.E[s]), t(P.W[s]), f'upperarm_{side}'),
              (f'hand_{side}', t(P.W[s]), t(P.W[s] + P.dA[s] * P.hand_len), f'forearm_{side}'),
              (f'thigh_{side}', t(P.Hp[s]), t(P.K[s]), 'hips'),
              (f'shin_{side}', t(P.K[s]), t(P.A[s]), f'thigh_{side}'),
              (f'foot_{side}', t(P.A[s]), t(P.Ball[s]), f'shin_{side}'),
              (f'toe_{side}', t(P.Ball[s]), t(P.Toe[s]), f'foot_{side}')]
    for k in ('eye_L', 'eye_R', 'brow_L', 'brow_R', 'mouth', 'mouth_L', 'mouth_R'):
        c = P.face.get(k)
        c = V(c) if c is not None else V(P.head_c)
        B.append((k, t(c), t(c + V(0, 0, 0.1 * P.u)), 'head'))
    B += C.extra_bones
    return B


def armature(name, blist):
    arm = bpy.data.armatures.new(name)
    ob = core.link(bpy.data.objects.new(name, arm))
    core.activate(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for bname, h, tl, parent in blist:
        b = arm.edit_bones.new(bname)
        b.head, b.tail = Vector(h), Vector(tl)
        b.roll = 0.0
        eb[bname] = b
    for bname, h, tl, parent in blist:
        if parent:
            eb[bname].parent = eb[parent]
            eb[bname].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def rest_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


# =============================================================================== weights

def segs_of(arm):
    return {b.name: (np.array(b.head_local), np.array(b.tail_local)) for b in arm.data.bones}


def seg_dist(X, a, b):
    ab = b - a
    t = np.clip(((X - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(X - (a + np.outer(t, ab)), axis=1)


def by_distance(X, segs, names, power=6.0, mult=None):
    names = [n for n in names if n in segs]
    D = np.stack([seg_dist(X, *segs[n]) for n in names], 1)
    W = 1.0 / np.maximum(D, 1e-4) ** power
    if mult:
        for i, n in enumerate(names):
            W[:, i] *= mult.get(n, 1.0)
    W /= W.sum(1, keepdims=True)
    return {n: W[:, i] for i, n in enumerate(names)}


def mix(a, b, t):
    out = {k: v * (1 - t) for k, v in a.items()}
    for k, v in b.items():
        out[k] = out.get(k, 0) + v * t
    return out


def torso_w(P, X):
    H = P.H
    x, z = X[:, 0], X[:, 2]
    zp = P.z_hip
    h = 1 - smooth(zp + 0.04 * H, zp + 0.13 * H, z)
    ch = smooth(zp + 0.13 * H, zp + 0.23 * H, z)
    w = {'hips': h, 'spine': np.clip(1 - h - ch, 0, 1), 'chest': ch}
    extra = {'neck': smooth(P.neck_base - 0.01 * H, P.neck_base + 0.03 * H, z)}
    for s, side in ((1, 'L'), (-1, 'R')):
        extra['shoulder_' + side] = 0.75 * smooth(P.sw * 0.45, P.sw * 0.95, s * x) * smooth(P.z_sh - 0.08 * H, P.z_sh - 0.02 * H, z)
        extra['thigh_' + side] = 0.6 * smooth(zp + 0.02 * H, zp - 0.08 * H, z) * smooth(-0.02 * H, 0.04 * H, s * x)
    k = np.clip(1 - sum(extra.values()), 0, 1)
    w = {b: v * k for b, v in w.items()}
    w.update(extra)
    return w


def head_w(P, X):
    z = X[:, 2]
    hw = smooth(P.z_chin - 0.01 * P.H, P.z_chin + 0.03 * P.H, z)
    cw = smooth(P.neck_base + 0.005 * P.H, P.neck_base - 0.02 * P.H, z) * (1 - hw)
    return {'head': hw, 'chest': cw, 'neck': np.clip(1 - hw - cw, 0, 1)}


def face_w(P, X):
    w = head_w(P, X)
    front = smooth(P.head_c[1] - 0.1 * P.u, P.head_c[1] - 0.3 * P.u, X[:, 1])
    extra = {}
    for side in ('L', 'R'):
        mk, bk = P.face.get(f'mouth_{side}'), P.face.get(f'brow_{side}')
        if mk is not None:
            extra[f'mouth_{side}'] = 0.55 * front * smooth(0.09 * P.u, 0.02 * P.u, np.linalg.norm(X - mk, axis=1))
        if bk is not None:
            extra[f'brow_{side}'] = 0.35 * front * smooth(0.1 * P.u, 0.025 * P.u, np.linalg.norm(X - bk, axis=1))
    k = np.clip(1 - sum(extra.values()), 0, 1)
    w = {b: v * k for b, v in w.items()}
    w.update(extra)
    return w


def skirt_w(P, X, segs, prefix):
    H = P.H
    upper = smooth(P.z_hip - 0.02 * H, P.z_hip + 0.08 * H, X[:, 2])
    names = [n for n in segs if n.startswith(prefix)]
    sb = by_distance(X, segs, names, 4.0)
    lg = by_distance(X, segs, ['thigh_L', 'thigh_R'], 4.0)
    w = {'hips': upper}
    for k, v in sb.items():
        w[k] = w.get(k, 0) + (1 - upper) * 0.6 * v
    for k, v in lg.items():
        w[k] = w.get(k, 0) + (1 - upper) * 0.4 * v
    return w


def weights_for(C, part, segs, X):
    P = C.P
    kind = part.kind
    if kind in C.weight_overrides:
        return C.weight_overrides[kind](X, segs)
    if kind == 'head':
        return head_w(P, X)
    if kind == 'hair':
        base = head_w(P, X)
        hb = [n for n in segs if n.startswith('hair_')]
        if not hb:
            return base
        loose = smooth(P.z_chin + 0.02 * P.H, P.z_chin - 0.08 * P.H, X[:, 2]) * smooth(P.head_c[1], P.head_c[1] + 0.2 * P.u, X[:, 1])
        return mix(base, by_distance(X, segs, hb, 5.0), loose)
    if kind == 'face':
        return face_w(P, X)
    if kind in ('eye_L', 'eye_R', 'brow_L', 'brow_R', 'mouth'):
        return {kind: np.ones(len(X))}
    if kind == 'mouthline':
        wl = smooth(0.004 * P.u, 0.06 * P.u, X[:, 0])
        wr = smooth(0.004 * P.u, 0.06 * P.u, -X[:, 0])
        return {'mouth_L': wl, 'mouth_R': wr, 'mouth': np.clip(1 - wl - wr, 0, 1)}
    if kind in ('torso', 'torsopart'):
        return torso_w(P, X)
    if kind.startswith('sleeve_'):
        side = kind[-1]
        return by_distance(X, segs, ['chest', f'shoulder_{side}', f'upperarm_{side}', f'forearm_{side}', f'hand_{side}'], 6.0,
                           {'chest': 0.35, f'shoulder_{side}': 0.6, f'hand_{side}': 0.25})
    if kind == 'legs':
        out = {}
        for s, side in ((1, 'L'), (-1, 'R')):
            m = smooth(-0.01 * P.H, 0.01 * P.H, s * X[:, 0])
            w = by_distance(X, segs, ['hips', f'thigh_{side}', f'shin_{side}', f'foot_{side}'], 6.0, {'hips': 0.4})
            for k, v in w.items():
                out[k] = out.get(k, 0) + v * m
        return out
    if kind == 'skirt':
        return skirt_w(P, X, segs, 'skirt_')
    if kind == 'coat':
        up = torso_w(P, X)
        lo = skirt_w(P, X, segs, 'coat_')
        return mix(up, lo, smooth(P.z_hip + 0.03 * P.H, P.z_hip - 0.05 * P.H, X[:, 2]))
    side = kind[-1]
    if kind.startswith('hand_'):
        return {f'hand_{side}': np.ones(len(X))}
    if kind.startswith('foot_'):
        return by_distance(X, segs, [f'shin_{side}', f'foot_{side}', f'toe_{side}'], 7.0, {f'shin_{side}': 0.3})
    if kind.startswith('arm_'):
        return by_distance(X, segs, ['chest', f'shoulder_{side}', f'upperarm_{side}', f'forearm_{side}', f'hand_{side}'], 6.0, {'chest': 0.3})
    if kind.startswith('leg_'):
        return by_distance(X, segs, ['hips', f'thigh_{side}', f'shin_{side}', f'foot_{side}'], 6.0, {'hips': 0.5})
    if kind.startswith('bone:'):
        return {kind[5:]: np.ones(len(X))}
    raise ValueError(kind)


def apply_weights(ob, W, limit=4):
    names = list(W)
    M_ = np.stack([np.asarray(W[n], dtype=np.float64) * np.ones(len(ob.data.vertices)) for n in names], 1)
    M_ = np.clip(M_, 0, None)
    if M_.shape[1] > limit:
        idx = np.argsort(-M_, axis=1)[:, limit:]
        np.put_along_axis(M_, idx, 0.0, axis=1)
    s = M_.sum(1, keepdims=True)
    M_ = np.where(s > 1e-9, M_ / np.maximum(s, 1e-9), 0)
    q = np.round(M_ * 200) / 200
    for j, n in enumerate(names):
        col = q[:, j]
        if not (col > 0).any():
            continue
        vg = ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n)
        for val in np.unique(col[col > 0]):
            vg.add(np.nonzero(col == val)[0].tolist(), float(val), 'REPLACE')


# =============================================================================== paint

def face_thresholds(C, X):
    """Face-shadow thresholds per vertex (vb_toon.faceShadow): light from the character's left
    lights the left half first; the nose throws a wedge of shadow onto the far cheek."""
    P, hd = C.P, C.head
    q = (X - P.head_c) / P.u
    t = hd.t_of_z(q[:, 2])
    half = np.maximum(hd.shape(np.full(len(q), math.pi / 2), t)[0], 0.05)
    ux = np.clip(q[:, 0] / half, -1, 1)
    out = []
    nz = hd.nose_z
    for sgn in (1, -1):
        v = sgn * ux
        thr = 0.3 + 0.55 * smooth(0.3, -0.85, v)
        wedge = (1 - smooth(0.0, 0.12, np.abs(-sgn * q[:, 0] - 0.05))) * smooth(nz - 0.05, nz - 0.01, q[:, 2]) * smooth(nz + 0.1, nz + 0.03, q[:, 2])
        thr = np.minimum(0.95, thr + 0.25 * wedge * (sgn * q[:, 0] < 0))
        thr = thr + 0.05 * (1 - smooth(0.0, 0.07, np.abs(q[:, 2] - hd.eye_z)))
        out.append(thr)
    return np.stack(out, 1)


def default_tint(C, X, part):
    P = C.P
    n = len(X)
    one = np.ones((n, 3))
    m = part.mname
    if m == 'skin' or (m == C.style.get('skin', 'skin') and part.kind in ('face', 'head')):
        c = one.copy()
        for s in (1, -1):
            d = np.linalg.norm(X - (P.head_c + V(s * 0.2, -0.36, -0.3) * P.u), axis=1)
            b = np.exp(-(d / (0.085 * P.u)) ** 2) * C.palette.get('_blush', 0.5)
            c[:, 1] *= 1 - 0.16 * b
            c[:, 2] *= 1 - 0.18 * b
        return c
    if part.kind == 'hair':
        q = (X - P.head_c) / P.u
        k = 0.8 + 0.2 * smooth(-0.8, 0.45, q[:, 2])
        c = one * k[:, None]
        tips = C.palette.get('_hair_tips')
        if tips is not None:
            f = smooth(0.6, 1.05, np.linalg.norm(q * V(1, 1, 0.8), axis=1))
            tc = V(core.srgb(tips)) / np.maximum(C.col(m), 1e-3)
            c = c * (1 - f[:, None]) + (tc[None] * k[:, None]) * f[:, None]
        return c
    if part.kind in ('torso', 'coat', 'skirt', 'legs') or part.kind.startswith('sleeve_'):
        k = 0.9 + 0.1 * smooth(0.0, P.H * 0.8, X[:, 2])
        return one * k[:, None]
    return one


def paint(C, ao, tint=default_tint):
    P = C.P
    for part in C.parts:
        ob = part.ob
        me = ob.data
        X = core.world_verts(ob)
        Nw = core.world_normals(ob)
        n = len(X)
        if part.vcol is not None and len(part.vcol) == n:
            rgb = np.asarray(part.vcol, dtype=np.float64)
        else:
            base = C.col(part.mname) if part.mname in C.palette else V(1.0, 0.0, 1.0)
            rgb = base[None] * tint(C, X, part)
        mid = np.full(n, MAT_ID[part.mid], dtype=np.float64)
        face = np.full((n, 2), 0.5)
        if part.face and C.head is not None:
            q = (X - P.head_c) / P.u
            front = (Nw[:, 1] < -0.2) & (q[:, 1] < -0.12) & (q[:, 2] > -0.7) & (q[:, 2] < 0.3)
            mid[front] = MAT_ID['face']
            face[front] = face_thresholds(C, X[front])
        cols = np.column_stack([np.clip(rgb, 0, 1), mid / 8.0])
        core.set_point_colors(ob, cols)
        a = ao.get(ob.name)
        aov = np.ones(n) if a is None else np.clip((a - 0.2) / 0.8, 0.0, 1.0) ** 0.8
        core.set_point_uv(ob, 'UVMap', np.column_stack([aov, np.full(n, part.line)]))
        core.set_point_uv(ob, 'UV2', face)


# =============================================================================== assemble

def finish(C, tint=default_tint):
    P = C.P
    for part in C.parts:
        part.ob.data.materials.clear()
        part.ob.data.materials.append(core.white_material())
    ao = core.bake_ao([p.ob for p in C.parts if p.ao], distance=0.06 * P.H, samples=48)
    paint(C, ao, tint)
    arm = armature(f'{C.name}_rig', bones(C))
    segs = segs_of(arm)
    for part in C.parts:
        X = core.world_verts(part.ob)
        apply_weights(part.ob, weights_for(C, part, segs, X))
    body = core.join([p.ob for p in C.parts], C.name)
    mod = body.modifiers.new('rig', 'ARMATURE')
    mod.object = arm
    body.parent = arm
    print(f'{C.name}: {core.tris(body)} tris, {len(body.data.vertices)} verts')
    return arm, body


def export(C, arm, body, path=None):
    rest_pose(arm)
    core.export_glb(path or os.path.join(OUT, f'{C.name}.glb'), [arm, body])


VIEW = {'front': (-25, 2.9, 0.52), 'back': (155, 2.9, 0.52), 'side': (-90, 2.9, 0.52),
        'face': (-8, 0.75, None), 'face3q': (-38, 0.8, None), 'faceside': (-90, 0.8, None)}


def preview(C, arm, out, views='front,face3q,back'):
    P = C.P
    rest_pose(arm)
    for name in views.split(','):
        yaw, dist, tz = VIEW[name]
        if tz is None:
            tgt = (0, 0, float(P.head_c[2]) - 0.15 * P.u)
            d = dist * P.u / 0.23
        else:
            tgt = (0, 0, tz * P.H)
            d = dist * P.H / 1.72
        core.preview(out.replace('.png', f'_{name}.png'), target=tgt, dist=d, yaw=yaw, pitch=4, size=(560, 760), lens=55, samples=16)
