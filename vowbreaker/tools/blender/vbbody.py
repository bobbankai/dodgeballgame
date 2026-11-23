"""
vbbody: the shared technical foundation every Vowbreaker character is built on: proportions (joint
positions; every rig shares bone directions so clips play on all of them), the trunk as superellipse
rings, parts and their vertex data, the skeleton, skin weights, painting, assembly and export.

The look of each character is NOT made here: see chars/<name>.py.

Vertex data contract (read by the toon shaders):
  colour rgb = painted albedo, alpha = material id / 8 (cloth, skin, hair, eye, metal, face, emissive, paper)
  UVMap      = (baked ambient occlusion, ink line width)
  UV2        = face-shadow thresholds (light from the left, from the right)

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


class Proportions:
    def __init__(self, H=1.72, kind='male', build=1.0, head_scale=1.0, leg=1.0, shape=None):
        self.shape = dict(shape or {})     # per-character trunk shaping: chest, waist, hips, shoulders, depth, bust
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
        sh = P.shape
        lv = np.array(lv)
        mul = np.ones(len(lv))
        mul[0:3] *= sh.get('hips', 1.0)
        mul[3] *= sh.get('waist', 1.0)
        mul[4:6] *= sh.get('chest', 1.0)
        mul[6:8] *= sh.get('shoulders', 1.0)
        lv[:, 1] *= mul
        lv[:, 2] *= sh.get('depth', 1.0)
        lv[:, 3] *= sh.get('depth', 1.0) * sh.get('back', 1.0)
        lv[4:6, 2] *= sh.get('pecs', 1.0)
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
            bs = self.P.shape.get('bust', 1.0)
            for sx in (1, -1):
                d2 = ((x - sx * 0.045 * H) / (0.042 * H)) ** 2 + ((z - (self.P.z_sh - 0.088 * H)) / (0.036 * H)) ** 2
                y = y - 0.03 * H * bs * np.exp(-d2 * 1.6) * (c > 0)
        sw = self.P.shape.get('sway', 0.0)
        if sw:
            # a little curve in the small of the back
            H = self.P.H
            y = y - sw * 0.012 * H * np.exp(-((z - (self.P.z_hip + 0.1 * H)) / (0.06 * H)) ** 2) * (c < 0)
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


class Part:
    def __init__(self, ob, mname, kind, mid='cloth', line=1.0, face=False, vcol=None, ao=True, painter=None):
        self.ob, self.mname, self.kind, self.mid, self.line = ob, mname, kind, mid, line
        self.face, self.vcol, self.ao, self.painter = face, vcol, ao, painter


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

    def add(self, ob, mname, kind, mid='cloth', line=1.0, face=False, vcol=None, ao=True, recalc=True, painter=None):
        ob.name = f'{self.name}_{ob.name}'
        if recalc and vcol is None:
            M.recalc_normals(ob)
        self.parts.append(Part(ob, mname, kind, mid, line, face, vcol, ao, painter))
        print(f'  {ob.name}: {core.tris(ob)} tris')
        return ob

    def col(self, mname):
        return V(core.srgb(self.palette[mname]))


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


def finish_cloth(C, ob, thick, levels=1):
    M.finish(ob, 0, thickness=thick, offset=-1.0)
    M.finish(ob, levels)
    return ob


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
        elif part.painter is not None:
            rgb = np.asarray(part.painter(C, X, Nw, part), dtype=np.float64)
        else:
            base = C.col(part.mname) if part.mname in C.palette else (V(core.srgb(part.mname)) if str(part.mname).startswith('#') else V(1.0, 0.0, 1.0))
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
