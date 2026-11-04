"""Animation library: blender -b -P emberfall/tools/blender/anims.py -- [--only name,name] [--preview dir]

Keyed combat clips (IK sword rig, see animlib) + CMU mocap clips retargeted to the game_engine rig.
Writes assets/anims/human.glb (armature + one animation per clip) and assets/anims/human.json
(loop flags, durations, events: hit windows, cancel points, sounds, root motion distance).
"""
import bpy
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import animlib as A  # noqa
from mathutils import Matrix, Quaternion, Vector  # noqa

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'anims')
BVH = '/opt/raw/cmubvh/CMU_EcstasyMotion_BVH'

V = Vector


def V3(x, y, z):
    return Vector((x, y, z))


# ============================================================================ keyed clips

class Clip:
    def __init__(self, name, dur, keys, loop=False, events=None, layer=None, lh_mode=None):
        self.name = name
        self.dur = dur
        self.keys = keys
        self.loop = loop
        self.events = events or {}
        self.layer = layer  # extra procedural fn(t, ctx) -> dict overrides


FIELDS = ('pel', 'pel_rot', 'sp', 'neck', 'head', 'grip', 'lh', 'rh', 'fr', 'fl', 'elbow_r', 'elbow_l', 'root', 'curl_r', 'curl_l',
          'clav_l', 'clav_r', 'arm_l', 'arm_r')


def filled(keys):
    """Carry forward unspecified fields so every key is complete."""
    out = []
    prev = {}
    for k in keys:
        d = dict(prev)
        d.update(k)
        out.append(d)
        prev = d
    return out


PIVOT = V3(0.0, -0.02, 1.25)


def grip_lerp(g0, g1, k):
    """Arc interpolation of grip frames around the chest pivot; blade frame by quaternion slerp."""
    p0, b0, e0 = g0
    p1, b1, e1 = g1
    r0 = V(p0) - PIVOT
    r1 = V(p1) - PIVOT
    l0, l1 = r0.length, r1.length
    if l0 > 1e-4 and l1 > 1e-4:
        q = r0.normalized().rotation_difference(r1.normalized())
        d = Quaternion().slerp(q, k) @ r0.normalized()
        p = PIVOT + d * (l0 + (l1 - l0) * k)
    else:
        p = V(p0).lerp(V(p1), k)
    F0 = A.look_frame(b0, [-x for x in e0]).to_quaternion()
    F1 = A.look_frame(b1, [-x for x in e1]).to_quaternion()
    if F0.dot(F1) < 0:
        F1 = -F1
    F = F0.slerp(F1, k).to_matrix()
    blade = F @ V3(0, 1, 0)
    edge = -(F @ V3(0, 0, 1))
    return (p, blade, edge)


def foot_lerp(f0, f1, k, lift=0.0):
    p0, y0, pt0 = f0
    p1, y1, pt1 = f1
    p = V(p0).lerp(V(p1), k)
    moved = (V(p1) - V(p0)).length
    if moved > 0.03:
        p.z += math.sin(k * math.pi) * min(0.12, 0.06 + moved * 0.15) + lift
    return (p, y0 + (y1 - y0) * k, pt0 + (pt1 - pt0) * k)


def interp(a, b, k, field):
    if a is None or b is None:
        return b if k > 0.5 else a
    if field == 'grip':
        return grip_lerp(a, b, k)
    if field in ('fr', 'fl'):
        return foot_lerp(a, b, k)
    if field in ('lh', 'rh'):
        if isinstance(a, str) or isinstance(b, str):
            return b if k > 0.5 else a
        return grip_lerp(a, b, k)
    if isinstance(a, (int, float)):
        return a + (b - a) * k
    if isinstance(a, str) or isinstance(b, str):
        return b if k > 0.5 else a
    return tuple(interp(x, y, k, '') for x, y in zip(a, b))


def sample(clip, t):
    keys = clip.fk_keys
    if clip.loop:
        t = t % clip.dur
    if t <= keys[0]['t']:
        return dict(keys[0])
    for i in range(1, len(keys)):
        if t <= keys[i]['t'] or i == len(keys) - 1:
            a, b = keys[i - 1], keys[i]
            k = A.ease(b.get('e', 'inout'), (t - a['t']) / max(b['t'] - a['t'], 1e-6))
            out = {}
            for f in FIELDS:
                if f in a and f in b:
                    out[f] = interp(a[f], b[f], k, f)
                elif f in b:
                    out[f] = b[f]
                elif f in a:
                    out[f] = a[f]
            return out
    return dict(keys[-1])


class Poser:
    def __init__(self, skel):
        self.s = skel
        self.ank_l = skel.head('foot_l')
        self.ank_r = skel.head('foot_r')

    def build(self, d, t=0.0):
        s = self.s
        basis = s.identity()
        pose = s.fk(basis)
        root = V3(*(d.get('root', (0, 0)) + (0,))[:3]) if len(d.get('root', (0, 0))) == 2 else V3(*d['root'])
        basis['Root'] = Matrix.Translation(root)
        s.fk_one(pose, basis, 'Root')
        # pelvis
        off = V3(*d.get('pel', (0, 0, 0)))
        pr = d.get('pel_rot', (0, 0, 0))
        restP = s.rest['pelvis']
        M = Matrix.Translation(root + restP.to_translation() + off) @ A.arm_rot(*pr).to_4x4() @ restP.to_3x3().to_4x4()
        basis['pelvis'] = (pose['Root'] @ s.rest_rel['pelvis']).inverted() @ M
        s.fk_one(pose, basis, 'pelvis')
        sp = d.get('sp', (0, 0, 0))
        for n, w in (('spine_01', 0.3), ('spine_02', 0.35), ('spine_03', 0.35)):
            basis[n] = s.local_from_arm(n, A.arm_rot(sp[0] * w, sp[1] * w, sp[2] * w))
            s.fk_one(pose, basis, n)
        nk = d.get('neck', (0, 0, 0))
        hd = d.get('head', (0, 0, 0))
        basis['neck_01'] = s.local_from_arm('neck_01', A.arm_rot(*nk))
        s.fk_one(pose, basis, 'neck_01')
        basis['head'] = s.local_from_arm('head', A.arm_rot(*hd))
        s.fk_one(pose, basis, 'head')
        for side in ('l', 'r'):
            c = d.get('clav_' + side)
            if c:
                n = 'clavicle_' + side
                basis[n] = s.local_from_arm(n, A.arm_rot(*c))
                s.fk_one(pose, basis, n)
        # feet
        for side, ank in (('r', self.ank_r), ('l', self.ank_l)):
            f = d.get('f' + side)
            if f is None:
                f = (ank + root, 0, 0)
            p, yaw, pitch = f
            p = V(p)
            R = A.arm_rot(pitch=pitch, yaw=yaw).to_3x3() @ s.rest['foot_' + side].to_3x3()
            fwd = A.arm_rot(yaw=yaw).to_3x3() @ V3(0, -1, 0)
            pole = p + fwd * 1.0 + V3(0, 0, 0.55)
            s.ik2(pose, basis, 'thigh_' + side, 'calf_' + side, 'foot_' + side, p, pole, R)
            # toes stay on the ground when the heel lifts
            if pitch < -3:
                basis['ball_' + side] = s.local_from_arm('ball_' + side, A.arm_rot(pitch=-pitch * 0.8))
                s.fk_one(pose, basis, 'ball_' + side)
        # arms
        g = d.get('grip')
        elbow_r = V(d.get('elbow_r', (-0.5, 0.2, 0.8))) + root
        elbow_l = V(d.get('elbow_l', (0.5, 0.2, 0.8))) + root
        if g is not None:
            G = s.grip_world(V(g[0]) + root, g[1], g[2])
            s.hold(pose, basis, 'r', G, elbow_r)
            lh = d.get('lh', 'hilt')
            if lh == 'hilt':
                s.hold(pose, basis, 'l', G @ Matrix.Translation((0, 0, -0.18)), elbow_l)
            elif isinstance(lh, tuple):
                GL = s.grip_world(V(lh[0]) + root, lh[1], lh[2])
                s.hold(pose, basis, 'l', GL, elbow_l)
        rh = d.get('rh')
        if g is None and isinstance(rh, tuple):
            G = s.grip_world(V(rh[0]) + root, rh[1], rh[2])
            s.hold(pose, basis, 'r', G, elbow_r)
        # FK arms (free arms)
        for side in ('l', 'r'):
            a = d.get('arm_' + side)
            if a and not (side == 'r' and (g is not None or isinstance(rh, tuple))) and not (side == 'l' and g is not None and d.get('lh', 'hilt') != 'free'):
                ua, la, ha = a
                for n, r in (('upperarm_' + side, ua), ('lowerarm_' + side, la), ('hand_' + side, ha)):
                    basis[n] = s.local_from_arm(n, A.arm_rot(*r))
                    s.fk_one(pose, basis, n)
        s.curl(basis, 'r', d.get('curl_r', 1.0 if (g is not None or isinstance(rh, tuple)) else 0.35))
        s.curl(basis, 'l', d.get('curl_l', 1.0 if (g is not None and d.get('lh', 'hilt') != 'free') else 0.35))
        return basis


# ---------------------------------------------------------------------------- poses
# grip: (position (root space), blade direction, edge direction)

def feet(fr, fl, root=(0, 0)):
    return {'fr': fr, 'fl': fl}


ANK = None  # filled at runtime (rest ankle heights)


def F(x, y, yaw=0.0, pitch=0.0, z=None):
    return (V3(x, y, (ANK if z is None else z)), yaw, pitch)


def stance(**kw):
    d = dict(
        pel=(0.0, 0.03, -0.07), pel_rot=(4, 18, 0), sp=(10, -18, 0), neck=(-4, -3, 0), head=(-3, -3, 0),
        grip=(V3(-0.02, -0.36, 1.0), V3(0.03, -0.9, 0.42), V3(0, -0.42, -0.9)), lh='hilt',
        fr=F(-0.14, -0.26, 12), fl=F(0.16, 0.24, 30, -12), elbow_r=(-0.45, 0.25, 0.85), elbow_l=(0.45, 0.25, 0.85),
        root=(0, 0))
    d.update(kw)
    return d


def keyed_clips():
    C = []

    def K(t, base=None, e='inout', **kw):
        d = dict(base or {})
        d.update(kw)
        d['t'] = t
        d['e'] = e
        return d

    S = stance()

    def br(t):  # breathing layer
        return math.sin(t * 2 * math.pi / 3.2)

    # --- idle: chudan-no-kamae, breathing, small weight shifts
    keys = []
    for i in range(9):
        t = i * 0.4
        b = math.sin(t * 2 * math.pi / 3.2)
        sw = math.sin(t * 2 * math.pi / 6.4)
        keys.append(K(t, S, pel=(sw * 0.012, 0.03, -0.07 + b * 0.005), sp=(10 + b * 1.2, -18 + sw * 2, sw * 1.5),
                      grip=(V3(-0.02 + sw * 0.01, -0.36, 1.0 + b * 0.008), V3(0.03 + sw * 0.03, -0.9, 0.42 + b * 0.02), V3(0, -0.42, -0.9)),
                      head=(-3 - b * 1, -3 - sw * 3, 0)))
    C.append(Clip('idle', 3.2, keys, loop=True))

    # --- light combo (root motion forward on each strike) ---------------------------------
    # 1: kesa-giri, upper right -> lower left
    W1 = dict(pel=(0.0, 0.05, -0.05), pel_rot=(0, 30, 0), sp=(-4, -10, 6), head=(-2, -8, 0),
              grip=(V3(-0.2, -0.05, 1.5), V3(0.25, 0.45, 0.86), V3(0.1, -0.95, 0.25)), elbow_r=(-0.6, 0.15, 1.2), elbow_l=(0.3, 0.1, 1.0))
    H1 = dict(pel=(0.0, -0.05, -0.12), pel_rot=(10, -8, 0), sp=(24, 4, -6), head=(-12, 0, 0),
              grip=(V3(0.05, -0.5, 1.02), V3(0.0, -0.95, -0.3), V3(-0.3, -0.25, -0.92)), elbow_r=(-0.45, 0.0, 0.9))
    T1 = dict(pel=(0.02, -0.06, -0.13), pel_rot=(12, -26, 0), sp=(26, 18, -8), head=(-14, 6, 0),
              grip=(V3(0.32, -0.32, 0.72), V3(0.62, 0.2, -0.75), V3(-0.55, -0.7, -0.4)), elbow_r=(-0.3, -0.2, 0.7), elbow_l=(0.6, 0.0, 0.8))
    C.append(Clip('attack_1', 0.78, [
        K(0.0, S), K(0.15, S, 'out', **W1), K(0.235, S, 'in', **H1, root=(0, -0.28), fr=F(-0.14, -0.62, 10)),
        K(0.29, S, 'out', **T1, root=(0, -0.36), fr=F(-0.14, -0.64, 10), fl=F(0.16, 0.0, 30, -18)),
        K(0.48, S, 'inout', **T1, root=(0, -0.38), fr=F(-0.14, -0.64, 10), fl=F(0.16, 0.0, 30, -18)),
        K(0.78, S, 'inout', root=(0, -0.38), fr=F(-0.14, -0.64, 12), fl=F(0.16, -0.14, 30, -12)),
    ], events={'hit': [0.2, 0.31], 'cancel': 0.42, 'swing': 0.17, 'step': 0.24}))

    # 2: gyaku-kesa, rising from lower left to upper right
    S2 = stance(root=(0, -0.38), fr=F(-0.14, -0.64, 12), fl=F(0.16, -0.14, 30, -12))
    W2 = dict(pel=(0.0, 0.0, -0.13), pel_rot=(10, -30, 0), sp=(22, 22, -6), head=(-10, 10, 0),
              grip=(V3(0.34, -0.25, 0.7), V3(0.55, 0.3, -0.78), V3(0.6, -0.6, 0.45)), elbow_r=(-0.25, -0.2, 0.7), elbow_l=(0.55, 0.0, 0.8))
    H2 = dict(pel=(0.0, -0.08, -0.07), pel_rot=(0, 6, 0), sp=(6, -4, 4), head=(-4, -4, 0),
              grip=(V3(0.0, -0.55, 1.15), V3(-0.2, -0.85, 0.5), V3(-0.3, -0.45, 0.85)), elbow_r=(-0.5, 0.1, 0.9))
    T2 = dict(pel=(-0.02, -0.05, -0.03), pel_rot=(-4, 28, 0), sp=(-6, -22, 8), head=(2, -10, 0),
              grip=(V3(-0.3, -0.25, 1.55), V3(-0.55, 0.35, 0.75), V3(-0.5, -0.75, -0.3)), elbow_r=(-0.7, 0.1, 1.3), elbow_l=(0.2, 0.0, 1.2))
    C.append(Clip('attack_2', 0.72, [
        K(0.0, S2), K(0.13, S2, 'out', **W2), K(0.21, S2, 'in', **H2, root=(0, -0.62), fl=F(0.16, -0.5, 26, -10)),
        K(0.27, S2, 'out', **T2, root=(0, -0.7), fl=F(0.17, -0.58, 24, -6), fr=F(-0.14, -0.9, 12, -15)),
        K(0.44, S2, 'inout', **T2, root=(0, -0.72), fl=F(0.17, -0.58, 24, -6), fr=F(-0.16, -0.96, 12)),
        K(0.72, S2, 'inout', root=(0, -0.72), fr=F(-0.15, -0.98, 12), fl=F(0.16, -0.48, 30, -12)),
    ], events={'hit': [0.18, 0.29], 'cancel': 0.4, 'swing': 0.15, 'step': 0.2}))

    # 3: yoko-giri: horizontal cut right -> left with a hip turn
    S3 = stance(root=(0, -0.72), fr=F(-0.15, -0.98, 12), fl=F(0.16, -0.48, 30, -12))
    W3 = dict(pel=(0.0, 0.0, -0.1), pel_rot=(4, 40, 0), sp=(8, 30, 2), head=(-4, -24, 0),
              grip=(V3(-0.45, 0.05, 1.12), V3(-0.55, 0.75, 0.2), V3(0.05, -0.2, 0.98)), elbow_r=(-0.5, 0.4, 0.8), elbow_l=(0.1, 0.3, 0.9))
    H3 = dict(pel=(0.0, -0.06, -0.14), pel_rot=(8, 0, 0), sp=(12, -4, 0), head=(-6, 0, 0),
              grip=(V3(0.0, -0.6, 1.08), V3(-0.25, -0.95, 0.05), V3(1.0, -0.2, 0.0)), elbow_r=(-0.4, 0.2, 0.8))
    T3 = dict(pel=(0.04, -0.05, -0.14), pel_rot=(8, -42, 0), sp=(12, -30, -2), head=(-6, 22, 0),
              grip=(V3(0.5, -0.1, 1.05), V3(0.75, 0.6, -0.05), V3(0.55, -0.75, 0.1)), elbow_r=(-0.1, -0.2, 0.9), elbow_l=(0.7, 0.3, 0.8))
    C.append(Clip('attack_3', 0.78, [
        K(0.0, S3), K(0.17, S3, 'out', **W3), K(0.245, S3, 'in', **H3, root=(0, -0.98), fr=F(-0.16, -1.3, 0)),
        K(0.3, S3, 'out', **T3, root=(0, -1.04), fr=F(-0.16, -1.32, -20), fl=F(0.2, -0.9, 10, -10)),
        K(0.5, S3, 'inout', **T3, root=(0, -1.06), fr=F(-0.16, -1.32, -20), fl=F(0.2, -0.9, 10, -10)),
        K(0.78, S3, 'inout', root=(0, -1.06), fr=F(-0.15, -1.32, 12), fl=F(0.16, -0.82, 30, -12)),
    ], events={'hit': [0.21, 0.32], 'cancel': 0.46, 'swing': 0.19, 'step': 0.24}))

    # 4: shomen-uchi finisher: big jump-step overhead cut
    S4 = stance(root=(0, -1.06), fr=F(-0.15, -1.32, 12), fl=F(0.16, -0.82, 30, -12))
    W4 = dict(pel=(0.0, 0.08, -0.02), pel_rot=(-6, 10, 0), sp=(-14, -6, 0), head=(4, -2, 0),
              grip=(V3(-0.04, 0.05, 1.68), V3(0.05, 0.75, 0.66), V3(0.0, -0.66, 0.75)), elbow_r=(-0.5, 0.0, 1.5), elbow_l=(0.5, 0.0, 1.5))
    A4 = dict(pel=(0.0, -0.05, 0.12), pel_rot=(-8, 6, 0), sp=(-16, -4, 0), head=(6, -2, 0),
              grip=(V3(-0.04, 0.1, 1.82), V3(0.02, 0.9, 0.42), V3(0.0, -0.4, 0.9)))
    H4 = dict(pel=(0.0, -0.12, -0.2), pel_rot=(18, 4, 0), sp=(32, -2, 0), head=(-18, 0, 0),
              grip=(V3(-0.01, -0.62, 1.05), V3(0.0, -0.98, -0.18), V3(0.0, -0.18, -0.98)), elbow_r=(-0.4, 0.0, 0.8), elbow_l=(0.4, 0.0, 0.8))
    T4 = dict(pel=(0.0, -0.14, -0.26), pel_rot=(22, 4, 0), sp=(36, -2, 0), head=(-20, 0, 0),
              grip=(V3(0.0, -0.58, 0.62), V3(0.0, -0.55, -0.83), V3(0.0, 0.83, -0.55)))
    C.append(Clip('attack_4', 1.15, [
        K(0.0, S4), K(0.2, S4, 'out', **W4), K(0.34, S4, 'inout', **A4, root=(0, -1.32), fr=F(-0.15, -1.5, 12, 0, ANK + 0.2), fl=F(0.16, -1.0, 30, -30, ANK + 0.12)),
        K(0.42, S4, 'in', **H4, root=(0, -1.62), fr=F(-0.15, -2.02, 10), fl=F(0.17, -1.2, 30, -20)),
        K(0.47, S4, 'out', **T4, root=(0, -1.66), fr=F(-0.15, -2.05, 10), fl=F(0.17, -1.22, 30, -20)),
        K(0.8, S4, 'inout', **T4, root=(0, -1.66), fr=F(-0.15, -2.05, 10), fl=F(0.17, -1.22, 30, -20)),
        K(1.15, S4, 'inout', root=(0, -1.66), fr=F(-0.15, -2.05, 12), fl=F(0.16, -1.48, 30, -12)),
    ], events={'hit': [0.4, 0.5], 'cancel': 0.82, 'swing': 0.36, 'step': 0.42, 'heavy': 1}))

    # --- heavy: charge (loop) + release (wide sweep) ----------------------------------------
    CH = stance(pel=(0.0, 0.1, -0.2), pel_rot=(10, 50, 0), sp=(14, 26, -4), head=(-8, -44, 0),
                grip=(V3(-0.42, 0.25, 0.9), V3(-0.3, 0.92, -0.25), V3(0.1, 0.3, 0.95)), elbow_r=(-0.6, 0.4, 0.7), elbow_l=(0.0, 0.4, 0.8),
                fr=F(-0.2, -0.3, 30), fl=F(0.24, 0.32, 50, -10))
    keys = [K(0.0, S), K(0.3, CH, 'out')]
    C.append(Clip('heavy_start', 0.3, keys))
    keys = []
    for i in range(7):
        t = i * 0.1
        j = math.sin(i * 2.3) * 0.004
        keys.append(K(t, CH, pel=(j, 0.1, -0.2 + j), grip=(V3(-0.42 + j, 0.25, 0.9 + j), V3(-0.3, 0.92, -0.25), V3(0.1, 0.3, 0.95))))
    C.append(Clip('heavy_hold', 0.6, keys, loop=True))
    HR_H = dict(pel=(0.0, -0.2, -0.22), pel_rot=(10, 0, 0), sp=(16, -6, 0), head=(-8, 0, 0),
                grip=(V3(0.0, -0.75, 1.0), V3(-0.1, -0.99, 0.05), V3(1.0, -0.1, 0.0)), elbow_r=(-0.4, 0.2, 0.8))
    HR_T = dict(pel=(0.05, -0.25, -0.2), pel_rot=(10, -60, 0), sp=(16, -36, -4), head=(-8, 30, 0),
                grip=(V3(0.62, 0.05, 1.0), V3(0.7, 0.7, 0.0), V3(0.7, -0.7, 0.1)), elbow_r=(0.0, -0.2, 0.9), elbow_l=(0.7, 0.4, 0.9))
    C.append(Clip('heavy_release', 1.0, [
        K(0.0, CH), K(0.1, CH, 'in', **HR_H, root=(0, -0.9), fr=F(-0.2, -1.25, 10), fl=F(0.24, -0.3, 40, -15)),
        K(0.17, CH, 'snap', **HR_T, root=(0, -1.0), fr=F(-0.2, -1.3, -30), fl=F(0.24, -0.4, 20, -15)),
        K(0.55, CH, 'inout', **HR_T, root=(0, -1.0), fr=F(-0.2, -1.3, -30), fl=F(0.24, -0.4, 20, -15)),
        K(1.0, stance(root=(0, -1.0), fr=F(-0.14, -1.26, 12), fl=F(0.16, -0.76, 30, -12)), 'inout', root=(0, -1.0)),
    ], events={'hit': [0.08, 0.2], 'cancel': 0.6, 'swing': 0.06, 'heavy': 1}))

    # --- dashes (lock-on dodge): low and fast, root motion 2.4 m ------------------------------
    def dash(name, dx, dy, lean_p, lean_r):
        mid = stance(pel=(0, 0, -0.2), pel_rot=(lean_p, 18, lean_r), sp=(10 + lean_p, -18, lean_r * 0.8),
                     grip=(V3(-0.02, -0.25, 0.92), V3(0.0, -0.75, 0.66), V3(0, -0.66, -0.75)))
        end_root = (dx, dy)
        return Clip(name, 0.55, [
            K(0.0, S),
            K(0.08, mid, 'out', root=(dx * 0.25, dy * 0.25), fr=F(-0.14 + dx * 0.15, -0.26 + dy * 0.15, 12, 0, ANK + 0.04), fl=F(0.16 + dx * 0.05, 0.24 + dy * 0.05, 30, -20)),
            K(0.3, mid, 'out', root=(dx * 0.92, dy * 0.92), fr=F(-0.14 + dx * 0.95, -0.26 + dy * 0.95, 12), fl=F(0.16 + dx * 0.75, 0.24 + dy * 0.75, 30, -20, ANK + 0.05)),
            K(0.55, stance(root=end_root, fr=F(-0.14 + dx, -0.26 + dy, 12), fl=F(0.16 + dx, 0.24 + dy, 30, -12)), 'inout', root=end_root),
        ], events={'iframes': [0.02, 0.3], 'cancel': 0.36, 'whoosh': 0.02})
    C.append(dash('dodge_back', 0, 2.2, -8, 0))
    C.append(dash('dodge_left', 2.2, 0, 4, 14))
    C.append(dash('dodge_right', -2.2, 0, 4, -14))
    C.append(dash('dodge_fwd', 0, -2.6, 16, 0))

    # --- guard -------------------------------------------------------------------------------
    BL = stance(pel=(0, 0.05, -0.1), pel_rot=(4, 14, 0), sp=(6, -14, 0), head=(-6, -2, 0),
                grip=(V3(-0.22, -0.32, 1.38), V3(0.95, -0.15, 0.28), V3(0.05, -0.25, 0.97)), elbow_r=(-0.6, 0.0, 1.1), elbow_l=(0.4, 0.0, 1.1))
    C.append(Clip('block_start', 0.12, [K(0.0, S), K(0.12, BL, 'out')]))
    keys = [K(i * 0.4, BL, grip=(V3(-0.22, -0.32, 1.38 + math.sin(i) * 0.006), V3(0.95, -0.15, 0.28), V3(0.05, -0.25, 0.97))) for i in range(5)]
    C.append(Clip('block_hold', 1.6, keys, loop=True))
    BH = dict(BL, pel=(0, 0.14, -0.14), sp=(-4, -14, 0), grip=(V3(-0.2, -0.2, 1.42), V3(0.95, -0.1, 0.32), V3(0.05, -0.35, 0.93)), head=(4, -2, 0))
    C.append(Clip('block_hit', 0.4, [K(0.0, BL), K(0.06, BL, 'snap', **{k: v for k, v in BH.items() if k not in ('t', 'root')}, root=(0, 0.18)),
                                     K(0.4, BL, 'inout', root=(0, 0.2), fr=F(-0.14, -0.06, 12), fl=F(0.16, 0.44, 30, -12))], events={'cancel': 0.2}))
    PA = stance(pel=(0, 0.0, -0.1), pel_rot=(4, -10, 0), sp=(6, 18, 0), head=(-4, -6, 0),
                grip=(V3(0.3, -0.42, 1.3), V3(0.75, -0.25, 0.6), V3(0.25, -0.95, -0.15)), elbow_r=(-0.3, 0.0, 1.1))
    C.append(Clip('parry', 0.5, [K(0.0, BL), K(0.07, BL, 'snap', **{k: v for k, v in PA.items() if k not in ('t', 'e')}), K(0.22, PA), K(0.5, S, 'inout')],
                  events={'parry': [0.0, 0.16], 'cancel': 0.24, 'clang': 0.04}))
    GB = stance(pel=(0, 0.25, -0.05), pel_rot=(-10, 25, 6), sp=(-18, -10, 8), head=(10, 8, 0),
                grip=(V3(-0.35, -0.05, 1.5), V3(0.6, 0.4, 0.7), V3(0.2, -0.9, 0.3)))
    C.append(Clip('guard_break', 1.1, [K(0.0, BL), K(0.1, GB, 'snap', root=(0, 0.35), fr=F(-0.14, 0.15, 12), fl=F(0.16, 0.7, 30, -12)),
                                       K(0.75, GB, 'inout', root=(0, 0.4)), K(1.1, S, 'inout', root=(0, 0.4), fr=F(-0.14, 0.14, 12), fl=F(0.16, 0.64, 30, -12))],
                  events={'cancel': 0.9}))

    # --- reactions ---------------------------------------------------------------------------
    HF = stance(pel=(0, 0.12, -0.1), pel_rot=(-8, 24, 4), sp=(-14, -14, 6), head=(14, 10, 0),
                grip=(V3(-0.1, -0.2, 0.9), V3(0.2, -0.7, 0.55), V3(0, -0.55, -0.83)))
    C.append(Clip('hit_front', 0.5, [K(0.0, S), K(0.07, HF, 'snap', root=(0, 0.16)), K(0.5, S, 'inout', root=(0, 0.2), fr=F(-0.14, -0.06, 12), fl=F(0.16, 0.44, 30, -12))],
                  events={'cancel': 0.35}))
    HB = stance(pel=(0, -0.1, -0.12), pel_rot=(14, 10, -4), sp=(22, -24, -6), head=(-16, 0, 0))
    C.append(Clip('hit_back', 0.5, [K(0.0, S), K(0.07, HB, 'snap', root=(0, -0.16)), K(0.5, S, 'inout', root=(0, -0.2), fr=F(-0.14, -0.46, 12), fl=F(0.16, 0.04, 30, -12))],
                  events={'cancel': 0.35}))
    # knockdown: thrown back onto the ground (lying on the back at the end)
    KD1 = stance(pel=(0, 0.45, -0.25), pel_rot=(-35, 10, 0), sp=(-30, -6, 0), head=(20, 0, 0),
                 grip=(V3(-0.4, 0.2, 1.1), V3(-0.2, 0.3, 0.93), V3(0, -0.93, 0.3)), lh='free', arm_l=((0, 0, 40), (-20, 0, 0), (0, 0, 0)),
                 fr=F(-0.14, -0.1, 12, 0, ANK + 0.25), fl=F(0.16, 0.2, 30, 0, ANK + 0.15))
    KD2 = dict(pel=(0, 1.0, -0.72), pel_rot=(-80, 0, 0), sp=(-8, 0, 0), head=(4, 8, 0), neck=(0, 0, 0),
               grip=(V3(-0.45, 1.0, 0.22), V3(-0.3, -0.1, 0.0), V3(0, 0, -1)), lh='free', arm_l=((-40, 0, 60), (-10, 0, 0), (0, 0, 0)),
               fr=F(-0.18, 0.0, 20, 40, 0.06), fl=F(0.2, 0.15, 30, 30, 0.08), elbow_r=(-0.8, 1.0, 0.1))
    C.append(Clip('knockdown', 1.0, [K(0.0, S), K(0.18, KD1, 'out', root=(0, 0.5)), K(0.5, KD1, 'in', **KD2, root=(0, 0.9)), K(1.0, KD1, 'inout', **KD2, root=(0, 0.95))],
                  events={'thud': 0.5}))
    C.append(Clip('down_hold', 1.0, [K(0.0, KD1, **KD2, root=(0, 0)), K(1.0, KD1, **KD2, root=(0, 0))], loop=True))
    # death: fall to the knees, then forward
    D1 = stance(pel=(0, 0.0, -0.48), pel_rot=(8, 0, 0), sp=(20, 0, 0), head=(-20, 0, 0), grip=(V3(-0.32, -0.3, 0.45), V3(-0.1, -0.7, -0.7), V3(0, 0.7, -0.7)),
                lh='free', arm_l=((30, 0, 10), (-30, 0, 0), (0, 0, 0)), fr=F(-0.16, -0.05, 0, 40, 0.14), fl=F(0.16, 0.05, 0, 40, 0.14))
    D2 = dict(pel=(0, -0.4, -0.66), pel_rot=(70, 0, 0), sp=(20, 0, 0), head=(-10, 0, 0), grip=(V3(-0.42, -0.85, 0.2), V3(-0.6, -0.6, -0.2), V3(0, 0, -1)),
              lh='free', arm_l=((70, 0, 20), (-20, 0, 0), (0, 0, 0)), fr=F(-0.16, 0.1, 0, 60, 0.06), fl=F(0.16, 0.2, 0, 60, 0.06))
    C.append(Clip('death', 2.0, [K(0.0, S), K(0.45, D1, 'out'), K(1.1, D1, 'inout'), K(1.5, D1, 'in', **D2), K(2.0, D1, 'out', **D2)],
                  events={'thud': 1.5, 'drop': 0.45}))

    # --- draw / sheathe (scabbard on the left hip) --------------------------------------------
    rest_grip = (V3(0.13, -0.18, 0.98), V3(0.05, -0.85, -0.45), V3(0, 0.3, -0.95))  # hand on the hilt at the hip
    DR1 = stance(pel=(0, 0, -0.04), pel_rot=(0, 0, 0), sp=(6, 20, 0), head=(-4, -8, 0), grip=rest_grip, lh=(V3(0.18, -0.05, 0.92), V3(0.05, 0.85, 0.45), V3(0, -0.3, 0.95)),
                 fr=F(-0.12, -0.08, 0), fl=F(0.12, 0.08, 0))
    DR2 = stance(pel=(0, 0, -0.06), pel_rot=(2, -10, 0), sp=(6, -10, 0), lh='free', arm_l=((10, 0, 20), (-20, 0, 0), (0, 0, 0)),
                 grip=(V3(-0.35, -0.45, 1.25), V3(-0.75, -0.55, 0.35), V3(-0.3, 0.1, -0.95)))
    C.append(Clip('draw', 0.75, [K(0.0, DR1, root=(0, 0)), K(0.2, DR1, 'inout'), K(0.42, DR2, 'snap'), K(0.75, S, 'inout')],
                  events={'draw': 0.2, 'shing': 0.3}))
    C.append(Clip('sheathe', 0.9, [K(0.0, S), K(0.3, DR2, 'inout'), K(0.65, DR1, 'inout'), K(0.9, DR1, 'inout')],
                  events={'sheathe': 0.65}))

    # --- special arts ------------------------------------------------------------------------
    # Ember Whirl: full spin, two horizontal cuts, fire trail
    def spin_key(t, ang, h, root, e='linear'):
        a = math.radians(ang)
        out = V3(-math.sin(a), -math.cos(a), 0)
        p = V3(0, 0, h) + out * 0.62
        blade = (out * 0.95 + V3(0, 0, -0.1)).normalized()
        edge = V3(math.cos(a), -math.sin(a), 0) * -1
        rx, ry = root
        return K(t, S, e, pel=(0, 0, -0.16), pel_rot=(6, ang, 0), sp=(14, 0, 0), head=(-8, 0, 0), grip=(p, blade, edge),
                 root=root, fr=F(rx - 0.25 * math.cos(a), ry - 0.25 * math.sin(a) - 0.1, ang), fl=F(rx + 0.25 * math.cos(a), ry + 0.25 * math.sin(a) + 0.1, ang + 20, -10))
    keys = [K(0.0, S), K(0.2, CH, 'out')]
    for i, ang in enumerate(range(0, 721, 90)):
        keys.append(spin_key(0.28 + i * 0.065, -ang, 1.08, (0, -0.1 * i)))
    keys.append(K(1.35, stance(root=(0, -0.8), fr=F(-0.14, -1.06, 12), fl=F(0.16, -0.56, 30, -12)), 'inout', root=(0, -0.8)))
    C.append(Clip('art_whirl', 1.35, keys, events={'hit': [0.3, 0.86], 'multi': 4, 'cancel': 1.0, 'fire': 0.28}))
    # Rising Flame: low crouch then upward cut launching the enemy
    RL = stance(pel=(0, 0.02, -0.3), pel_rot=(14, 20, 0), sp=(26, -20, 0), head=(-10, -8, 0),
                grip=(V3(0.22, -0.3, 0.55), V3(0.4, -0.5, -0.76), V3(0.3, -0.8, 0.5)), fr=F(-0.18, -0.4, 10), fl=F(0.2, 0.3, 30, -16))
    RU = stance(pel=(0, -0.2, 0.14), pel_rot=(-12, -10, 0), sp=(-20, 10, 0), head=(14, 0, 0),
                grip=(V3(-0.1, -0.35, 1.95), V3(-0.15, -0.3, 0.94), V3(0, -0.95, -0.3)), fr=F(-0.14, -0.62, 10, 0, ANK + 0.3), fl=F(0.16, -0.1, 30, -40, ANK + 0.1))
    C.append(Clip('art_rising', 1.1, [K(0.0, S), K(0.25, RL, 'out'), K(0.36, RU, 'snap', root=(0, -0.45)),
                                      K(0.75, RU, 'inout', root=(0, -0.5), fr=F(-0.14, -0.7, 10), fl=F(0.16, -0.25, 30, -12)),
                                      K(1.1, stance(root=(0, -0.5), fr=F(-0.14, -0.76, 12), fl=F(0.16, -0.26, 30, -12)), 'inout', root=(0, -0.5))],
                  events={'hit': [0.27, 0.4], 'launch': 1, 'cancel': 0.8, 'fire': 0.26}))
    # Cinder Burst: leap and drive the blade into the ground (area burst)
    GU = stance(pel=(0, 0.0, 0.25), pel_rot=(-10, 0, 0), sp=(-20, 0, 0), head=(10, 0, 0),
                grip=(V3(0.0, -0.15, 2.0), V3(0.0, 0.2, 0.98), V3(0, -0.98, 0.2)), fr=F(-0.14, -0.4, 0, 0, ANK + 0.45), fl=F(0.16, -0.2, 0, -20, ANK + 0.4))
    GD = stance(pel=(0, -0.2, -0.42), pel_rot=(30, 0, 0), sp=(34, 0, 0), head=(-16, 0, 0),
                grip=(V3(0.0, -0.62, 0.62), V3(0.0, -0.1, -0.99), V3(0, -0.99, 0.1)), fr=F(-0.18, -0.8, 0), fl=F(0.2, -0.1, 20, -10, ANK + 0.12))
    C.append(Clip('art_burst', 1.4, [K(0.0, S), K(0.3, GU, 'out', root=(0, -0.35)), K(0.52, GD, 'in', root=(0, -0.6)),
                                     K(1.0, GD, 'inout', root=(0, -0.6)), K(1.4, stance(root=(0, -0.6), fr=F(-0.14, -0.86, 12), fl=F(0.16, -0.36, 30, -12)), 'inout', root=(0, -0.6))],
                  events={'hit': [0.5, 0.6], 'burst': 0.52, 'cancel': 1.05, 'fire': 0.3}))

    # finisher on a staggered enemy: thrust through, pull out
    FT = stance(pel=(0, -0.15, -0.12), pel_rot=(6, 10, 0), sp=(10, -10, 0), head=(-6, 0, 0),
                grip=(V3(0.0, -0.62, 1.12), V3(0.0, -1.0, 0.0), V3(0, 0, -1)))
    FP = stance(pel=(0, 0.05, -0.08), pel_rot=(2, 26, 0), sp=(4, -20, 0),
                grip=(V3(-0.3, 0.0, 1.1), V3(-0.4, 0.9, -0.1), V3(0, 0, -1)))
    C.append(Clip('finisher', 1.6, [K(0.0, S), K(0.25, CH, 'out'), K(0.38, FT, 'snap', root=(0, -0.55), fr=F(-0.14, -0.85, 10)),
                                    K(0.95, FT, 'inout', root=(0, -0.55), fr=F(-0.14, -0.85, 10)), K(1.15, FP, 'snap', root=(0, -0.45)),
                                    K(1.6, stance(root=(0, -0.45), fr=F(-0.14, -0.71, 12), fl=F(0.16, -0.21, 30, -12)), 'inout', root=(0, -0.45))],
                  events={'hit': [0.36, 0.42], 'pull': 1.1, 'cancel': 1.3}))
    # ember breath (heal): left hand to the chest, sword lowered
    HL = stance(pel=(0, 0.02, -0.04), pel_rot=(0, 10, 0), sp=(4, -10, 0), head=(-14, 0, 0), lh='free',
                grip=(V3(-0.3, -0.2, 0.85), V3(-0.15, -0.6, -0.78), V3(0, 0.78, -0.6)),
                arm_l=((-35, 0, -10), (-115, -20, 0), (0, 0, 0)))
    C.append(Clip('heal', 1.3, [K(0.0, S), K(0.3, HL, 'out'), K(1.0, HL, 'inout'), K(1.3, S, 'inout')], events={'heal': 0.55, 'cancel': 1.1}))
    # interact: reach out with the left hand
    IN = stance(pel=(0, -0.05, -0.1), pel_rot=(8, 0, 0), sp=(14, 0, 0), head=(-14, 0, 0), lh='free',
                grip=(V3(-0.3, -0.15, 0.85), V3(-0.15, -0.6, -0.78), V3(0, 0.78, -0.6)), arm_l=((-70, 0, 0), (-15, 0, 0), (0, 0, 0)))
    C.append(Clip('interact', 1.0, [K(0.0, S), K(0.35, IN, 'out'), K(0.65, IN, 'inout'), K(1.0, S, 'inout')], events={'use': 0.45}))

    # --- story poses (no sword: free FK arms) ------------------------------------------------
    def N(**kw):
        d = dict(pel=(0, 0, 0), pel_rot=(0, 0, 0), sp=(0, 0, 0), neck=(0, 0, 0), head=(0, 0, 0), grip=None, lh='free',
                 fr=F(-0.11, 0.0, 4), fl=F(0.11, 0.0, -4), root=(0, 0), curl_r=0.35, curl_l=0.35,
                 arm_l=((4, 0, 48), (-12, 0, 0), (0, 0, 0)), arm_r=((4, 0, -48), (-12, 0, 0), (0, 0, 0)))
        d.update(kw)
        return d

    def breathe(base, dur, n=4, amp=1.5, **extra):
        out = []
        for i in range(n + 1):
            t = dur * i / n
            b = math.sin(2 * math.pi * i / n)
            sp = base['sp']
            out.append(K(t, base, sp=(sp[0] + b * amp, sp[1], sp[2]), **extra))
        return out
    # kneel on the right knee, reaching down to someone in front
    KN = N(pel=(0, 0.04, -0.36), sp=(22, 0, 0), head=(18, 0, 0), fl=F(0.15, -0.4, -6, 0), fr=F(-0.13, 0.4, 4, 70, ANK + 0.05),
           arm_l=((-30, 0, 40), (-40, 0, 0), (0, 0, 0)), arm_r=((-58, 0, -30), (-22, 0, 0), (0, 0, 0)))
    C.append(Clip('kneel', 2.4, breathe(KN, 2.4, amp=1.2), loop=True))
    KH = N(pel=(0, 0.04, -0.38), sp=(30, 0, 0), head=(26, 0, 0), fl=F(0.15, -0.4, -6, 0), fr=F(-0.13, 0.4, 4, 70, ANK + 0.05),
           arm_l=((-62, 0, 30), (-38, 0, 0), (0, 0, 0)), arm_r=((-62, 0, -30), (-38, 0, 0), (0, 0, 0)), curl_r=0.6, curl_l=0.6)
    C.append(Clip('kneel_hold', 2.4, breathe(KH, 2.4, amp=1.0), loop=True))
    C.append(Clip('kneel_down', 1.2, [K(0.0, N()), K(0.5, KN, 'out', pel=(0, 0.03, -0.2)), K(1.2, KN, 'inout')]))
    # wounded, sitting slumped against something, hand pressed to the side
    SW = N(pel=(0, 0.1, -0.7), pel_rot=(-18, 0, 0), sp=(28, 0, 6), head=(22, 12, 0), fr=F(-0.2, -0.72, 14, 0, ANK - 0.02),
           fl=F(0.22, -0.55, -20, 0, ANK - 0.02), arm_r=((-48, 0, -12), (-100, 0, 0), (0, 0, 0)), arm_l=((12, 0, 62), (-6, 0, 0), (0, 0, 0)), curl_r=0.7)
    C.append(Clip('sit_wounded', 3.0, breathe(SW, 3.0, amp=2.5), loop=True))
    # cowering: crouched, arms over the head, trembling
    CW = N(pel=(0, 0.12, -0.46), sp=(46, 0, 0), head=(26, 0, 0), fr=F(-0.18, -0.08, 10, 0), fl=F(0.18, 0.02, -10, 0),
           arm_l=((-150, 0, -14), (-128, 0, 0), (0, 0, 0)), arm_r=((-150, 0, 14), (-128, 0, 0), (0, 0, 0)), curl_r=0.8, curl_l=0.8)
    keys = []
    for i in range(9):
        j = 1.0 if i % 2 else -1.0
        keys.append(K(i * 0.12, CW, sp=(46 + j * 1.2, j * 1.0, 0), head=(26, j * 2, 0)))
    C.append(Clip('cower', 0.96, keys, loop=True))
    # point ahead with the right arm
    PT = N(sp=(2, 6, 0), head=(-2, -8, 0), arm_r=((-84, 0, -40), (-4, 0, 0), (0, 0, 0)), curl_r=0.55)
    C.append(Clip('point', 2.0, [K(0.0, N()), K(0.4, PT, 'out'), K(1.5, PT, 'inout'), K(2.0, N(), 'inout')]))
    # talking gesture: an open hand, a nod
    G1 = N(sp=(4, -4, 0), head=(4, 4, 0), arm_r=((-38, 0, -34), (-62, 0, 0), (0, 0, 0)), curl_r=0.2)
    G2 = N(sp=(2, 4, 0), head=(-2, -4, 0), arm_r=((-30, 0, -40), (-48, 0, 0), (0, 0, 0)), arm_l=((-20, 0, 38), (-50, 0, 0), (0, 0, 0)), curl_r=0.2, curl_l=0.25)
    C.append(Clip('gesture', 3.2, [K(0.0, N()), K(0.6, G1, 'out'), K(1.4, G2), K(2.3, G1), K(3.2, N(), 'inout')], loop=True))
    # limp, folded over a shoulder (attached to the carrier's back socket)
    CA = N(pel_rot=(0, 0, 0), sp=(78, 0, 0), neck=(20, 0, 0), head=(20, 0, 0), fr=F(-0.1, -0.12, 0, 20), fl=F(0.1, -0.08, 0, 24),
           arm_l=((-96, 0, 26), (-14, 0, 0), (0, 0, 0)), arm_r=((-96, 0, -26), (-14, 0, 0), (0, 0, 0)))
    keys = [K(i * 0.6, CA, arm_l=((-96 + math.sin(i * 1.6) * 8, 0, 26), (-14, 0, 0), (0, 0, 0)),
              arm_r=((-96 - math.sin(i * 1.6) * 8, 0, -26), (-14, 0, 0), (0, 0, 0))) for i in range(5)]
    C.append(Clip('carried', 2.4, keys, loop=True))
    C.append(Clip('stand_relaxed', 3.2, breathe(N(), 3.2, amp=1.0), loop=True))
    return C


# ============================================================================ enemy clips

def KK(t, base=None, e='inout', **kw):
    d = dict(base or {})
    d.update(kw)
    d['t'] = t
    d['e'] = e
    return d


def one_hand(**kw):
    """Hollow one-handed stance: hunched, weapon low at the right, left hand open and forward."""
    d = dict(
        pel=(0.0, 0.02, -0.09), pel_rot=(8, 12, 0), sp=(16, -10, 0), neck=(-8, -2, 0), head=(-6, -2, 0),
        grip=(V3(-0.32, -0.3, 0.98), V3(-0.15, -0.75, 0.64), V3(-0.3, -0.6, -0.74)), lh='free',
        arm_l=((-28, 8, -12), (-38, 0, 0), (0, 0, -10)), curl_l=0.45,
        fr=F(-0.15, -0.2, 8), fl=F(0.17, 0.22, 26, -8), elbow_r=(-0.6, 0.2, 0.8), root=(0, 0))
    d.update(kw)
    return d


def two_hand_heavy(**kw):
    """Brute stance: hammer held across the body, low and wide."""
    d = dict(
        pel=(0.0, 0.04, -0.13), pel_rot=(6, 20, 0), sp=(12, -14, 0), neck=(-6, -4, 0), head=(-4, -4, 0),
        grip=(V3(-0.15, -0.32, 0.95), V3(0.35, -0.55, 0.75), V3(-0.5, -0.7, 0.2)), lh='hilt',
        fr=F(-0.2, -0.24, 10), fl=F(0.22, 0.25, 30, -8), elbow_r=(-0.6, 0.2, 0.8), elbow_l=(0.6, 0.2, 0.8), root=(0, 0))
    d.update(kw)
    return d


def enemy_clips():
    C = []
    E = one_hand()
    # idle: breathing, a twitchy head (the Hollow are not quite alive)
    keys = []
    for i in range(9):
        t = i * 0.4
        b = math.sin(t * 2 * math.pi / 3.2)
        tw = math.sin(t * 7.3) * (1 if i % 3 == 0 else 0)
        keys.append(KK(t, E, pel=(0.0, 0.02, -0.09 + b * 0.006), sp=(16 + b * 1.5, -10, 0), head=(-6 + tw * 4, -2 + tw * 6, tw * 5),
                       grip=(V3(-0.32, -0.3, 0.98 + b * 0.01), V3(-0.15, -0.75, 0.64), V3(-0.3, -0.6, -0.74))))
    C.append(Clip('e_idle', 3.2, keys, loop=True))

    # e_slash: big telegraphed downward diagonal
    W = dict(pel=(0.0, 0.08, -0.05), pel_rot=(-2, 34, 0), sp=(-6, -16, 6), head=(0, -10, 0),
             grip=(V3(-0.3, 0.12, 1.62), V3(0.15, 0.5, 0.85), V3(0.1, -0.95, 0.3)), elbow_r=(-0.7, 0.3, 1.3),
             arm_l=((-55, 0, -20), (-20, 0, 0), (0, 0, 0)))
    H = dict(pel=(0.0, -0.06, -0.14), pel_rot=(12, -6, 0), sp=(26, 6, -6), head=(-12, 0, 0),
             grip=(V3(0.05, -0.55, 1.05), V3(0.1, -0.9, -0.4), V3(-0.4, -0.3, -0.86)), elbow_r=(-0.5, 0.0, 0.9),
             arm_l=((10, 0, 10), (-30, 0, 0), (0, 0, 0)))
    T = dict(pel=(0.02, -0.07, -0.16), pel_rot=(14, -24, 0), sp=(28, 16, -8), head=(-14, 6, 0),
             grip=(V3(0.32, -0.28, 0.66), V3(0.6, 0.2, -0.77), V3(-0.55, -0.7, -0.4)), elbow_r=(-0.3, -0.2, 0.7),
             arm_l=((25, 0, 25), (-25, 0, 0), (0, 0, 0)))
    C.append(Clip('e_slash', 1.05, [
        KK(0.0, E), KK(0.36, E, 'out', **W), KK(0.47, E, 'in', **H, root=(0, -0.35), fr=F(-0.15, -0.6, 8)),
        KK(0.53, E, 'out', **T, root=(0, -0.42), fr=F(-0.15, -0.64, 8), fl=F(0.17, -0.05, 26, -14)),
        KK(0.75, E, 'inout', **T, root=(0, -0.44), fr=F(-0.15, -0.66, 8), fl=F(0.17, -0.05, 26, -14)),
        KK(1.05, E, 'inout', root=(0, -0.44), fr=F(-0.15, -0.64, 8), fl=F(0.17, -0.22, 26, -8)),
    ], events={'hit': [0.44, 0.55], 'cancel': 0.72, 'swing': 0.4}))
    # e_slash_b: backhand rising cut (combo follow-up)
    E2 = one_hand(root=(0, -0.44), fr=F(-0.15, -0.64, 8), fl=F(0.17, -0.22, 26, -8))
    W2 = dict(pel=(0.0, 0.0, -0.12), pel_rot=(8, -30, 0), sp=(18, 24, -6), head=(-8, 10, 0),
              grip=(V3(0.32, -0.2, 0.75), V3(0.65, 0.3, -0.7), V3(0.6, -0.6, 0.5)), elbow_r=(-0.2, -0.2, 0.7))
    T2 = dict(pel=(-0.02, -0.06, -0.05), pel_rot=(-2, 30, 0), sp=(-4, -22, 8), head=(2, -10, 0),
              grip=(V3(-0.35, -0.25, 1.5), V3(-0.6, 0.3, 0.74), V3(-0.5, -0.8, -0.3)), elbow_r=(-0.8, 0.1, 1.3))
    C.append(Clip('e_slash_b', 0.95, [
        KK(0.0, E2), KK(0.24, E2, 'out', **W2), KK(0.34, E2, 'snap', **T2, root=(0, -0.7), fl=F(0.17, -0.5, 24, -8)),
        KK(0.62, E2, 'inout', **T2, root=(0, -0.72), fl=F(0.17, -0.52, 24, -8)),
        KK(0.95, E2, 'inout', root=(0, -0.72), fr=F(-0.15, -0.94, 8), fl=F(0.17, -0.5, 26, -8)),
    ], events={'hit': [0.28, 0.38], 'cancel': 0.6, 'swing': 0.26}))
    # e_thrust: pull back, lunge with a straight thrust
    WT = dict(pel=(0.0, 0.1, -0.12), pel_rot=(4, 30, 0), sp=(8, -20, 0),
              grip=(V3(-0.3, 0.12, 1.15), V3(0.0, -1.0, 0.0), V3(0, 0, -1)), elbow_r=(-0.6, 0.4, 1.0))
    HT = dict(pel=(0.0, -0.15, -0.2), pel_rot=(14, -8, 0), sp=(18, 8, 0), head=(-10, 0, 0),
              grip=(V3(-0.05, -0.85, 1.15), V3(0.0, -1.0, 0.05), V3(0, 0, -1)), elbow_r=(-0.4, 0.2, 1.0),
              arm_l=((40, 0, 30), (-20, 0, 0), (0, 0, 0)))
    C.append(Clip('e_thrust', 1.15, [
        KK(0.0, E), KK(0.4, E, 'out', **WT), KK(0.5, E, 'snap', **HT, root=(0, -0.9), fr=F(-0.15, -1.25, 6), fl=F(0.17, -0.2, 26, -22)),
        KK(0.8, E, 'inout', **HT, root=(0, -0.95), fr=F(-0.15, -1.25, 6), fl=F(0.17, -0.25, 26, -18)),
        KK(1.15, E, 'inout', root=(0, -0.95), fr=F(-0.15, -1.15, 8), fl=F(0.17, -0.73, 26, -8)),
    ], events={'hit': [0.46, 0.56], 'cancel': 0.85, 'swing': 0.44}))
    # e_sweep: wide horizontal cut
    WS = dict(pel=(0.0, 0.02, -0.12), pel_rot=(6, 45, 0), sp=(10, 30, 0), head=(-4, -24, 0),
              grip=(V3(-0.5, 0.1, 1.12), V3(-0.6, 0.75, 0.2), V3(0.05, -0.2, 0.98)), elbow_r=(-0.6, 0.4, 0.8))
    TS = dict(pel=(0.04, -0.05, -0.15), pel_rot=(8, -45, 0), sp=(12, -30, -2), head=(-6, 22, 0),
              grip=(V3(0.5, -0.1, 1.0), V3(0.75, 0.6, -0.05), V3(0.55, -0.75, 0.1)), elbow_r=(-0.1, -0.2, 0.9))
    C.append(Clip('e_sweep', 1.1, [
        KK(0.0, E), KK(0.38, E, 'out', **WS), KK(0.5, E, 'snap', **TS, root=(0, -0.3), fr=F(-0.18, -0.55, -20)),
        KK(0.75, E, 'inout', **TS, root=(0, -0.32), fr=F(-0.18, -0.55, -20)),
        KK(1.1, E, 'inout', root=(0, -0.32), fr=F(-0.15, -0.52, 8), fl=F(0.17, -0.1, 26, -8)),
    ], events={'hit': [0.42, 0.54], 'cancel': 0.8, 'swing': 0.4}))
    # e_lunge: long-range leaping thrust (perilous)
    C.append(Clip('e_lunge', 1.5, [
        KK(0.0, E), KK(0.55, E, 'out', **{**WT, 'pel': (0, 0.15, -0.25)}), KK(0.72, E, 'snap', **HT, root=(0, -3.2), fr=F(-0.15, -3.55, 6), fl=F(0.17, -2.5, 26, -22)),
        KK(1.1, E, 'inout', **HT, root=(0, -3.3), fr=F(-0.15, -3.55, 6), fl=F(0.17, -2.6, 26, -18)),
        KK(1.5, E, 'inout', root=(0, -3.3), fr=F(-0.15, -3.5, 8), fl=F(0.17, -3.08, 26, -8)),
    ], events={'hit': [0.62, 0.78], 'cancel': 1.15, 'swing': 0.6}))

    # ----- brute
    B = two_hand_heavy()
    keys = []
    for i in range(9):
        t = i * 0.45
        b = math.sin(t * 2 * math.pi / 3.6)
        keys.append(KK(t, B, pel=(0.0, 0.04, -0.13 + b * 0.01), sp=(12 + b * 2.5, -14, 0), head=(-4 - b * 2, -4, 0)))
    C.append(Clip('b_idle', 3.6, keys, loop=True))
    WB = dict(pel=(0.0, 0.12, 0.0), pel_rot=(-10, 6, 0), sp=(-22, -4, 0), head=(8, 0, 0),
              grip=(V3(-0.05, 0.25, 1.7), V3(0.0, 0.6, 0.8), V3(0, -0.8, 0.6)), elbow_r=(-0.6, 0.0, 1.6), elbow_l=(0.6, 0.0, 1.6))
    HB = dict(pel=(0.0, -0.15, -0.3), pel_rot=(26, 0, 0), sp=(38, 0, 0), head=(-20, 0, 0),
              grip=(V3(0.0, -0.75, 0.55), V3(0.0, -0.45, -0.89), V3(0, 0.89, -0.45)), elbow_r=(-0.5, 0.0, 0.8), elbow_l=(0.5, 0.0, 0.8))
    C.append(Clip('b_slam', 1.7, [
        KK(0.0, B), KK(0.6, B, 'out', **WB), KK(0.72, B, 'in', **HB, root=(0, -0.5), fr=F(-0.2, -0.85, 6), fl=F(0.22, 0.05, 30, -15)),
        KK(1.2, B, 'inout', **HB, root=(0, -0.5), fr=F(-0.2, -0.85, 6), fl=F(0.22, 0.05, 30, -15)),
        KK(1.7, B, 'inout', root=(0, -0.5), fr=F(-0.2, -0.74, 10), fl=F(0.22, -0.25, 30, -8)),
    ], events={'hit': [0.66, 0.76], 'slam': 0.72, 'cancel': 1.3, 'swing': 0.62}))
    WS2 = dict(pel=(0.0, 0.05, -0.12), pel_rot=(6, 55, 0), sp=(10, 32, 0), head=(-4, -26, 0),
               grip=(V3(-0.55, 0.3, 1.1), V3(-0.55, 0.8, 0.2), V3(0.0, -0.2, 0.98)), elbow_r=(-0.6, 0.5, 0.9))
    TS2 = dict(pel=(0.05, -0.08, -0.18), pel_rot=(8, -55, 0), sp=(12, -32, -2), head=(-6, 26, 0),
               grip=(V3(0.55, 0.0, 1.0), V3(0.7, 0.7, -0.1), V3(0.6, -0.75, 0.1)), elbow_r=(0.0, -0.2, 0.9))
    C.append(Clip('b_sweep', 1.6, [
        KK(0.0, B), KK(0.6, B, 'out', **WS2), KK(0.76, B, 'snap', **TS2, root=(0, -0.4), fr=F(-0.22, -0.65, -25)),
        KK(1.15, B, 'inout', **TS2, root=(0, -0.42), fr=F(-0.22, -0.65, -25)),
        KK(1.6, B, 'inout', root=(0, -0.42), fr=F(-0.2, -0.66, 10), fl=F(0.22, -0.17, 30, -8)),
    ], events={'hit': [0.66, 0.8], 'cancel': 1.2, 'swing': 0.62}))
    # charge: hunch, sprint 5 m, hammer swings up at the end
    CHG = dict(pel=(0.0, -0.15, -0.2), pel_rot=(28, 0, 0), sp=(30, 0, 0), head=(-20, 0, 0),
               grip=(V3(-0.3, -0.2, 0.9), V3(0.2, -0.8, 0.55), V3(-0.4, -0.5, -0.75)))
    keys = [KK(0.0, B), KK(0.5, B, 'out', **CHG)]
    for i in range(6):
        t = 0.6 + i * 0.13
        ry = -0.9 * (i + 1)
        lead = i % 2 == 0
        keys.append(KK(t, B, 'linear', **CHG, root=(0, ry), fr=F(-0.2, ry - (0.35 if lead else -0.1), 4, 0, ANK + (0.0 if lead else 0.12)),
                       fl=F(0.22, ry - (-0.1 if lead else 0.35), 20, -10, ANK + (0.12 if lead else 0.0))))
    keys.append(KK(1.55, B, 'out', **HB, root=(0, -6.0), fr=F(-0.2, -6.35, 6), fl=F(0.22, -5.5, 30, -15)))
    keys.append(KK(2.2, B, 'inout', root=(0, -6.0), fr=F(-0.2, -6.24, 10), fl=F(0.22, -5.75, 30, -8)))
    C.append(Clip('b_charge', 2.2, keys, events={'hit': [0.7, 1.6], 'slam': 1.55, 'cancel': 1.9, 'swing': 1.4, 'step': 0.7}))
    BR = dict(pel=(0.0, 0.1, -0.05), pel_rot=(-14, 0, 0), sp=(-26, 0, 0), head=(16, 0, 0), neck=(10, 0, 0),
              grip=(V3(-0.45, 0.0, 1.0), V3(-0.3, 0.2, 0.93), V3(0, -0.98, 0.2)), lh='free', arm_l=((-20, 0, 45), (-40, 0, 0), (0, 0, 0)))
    C.append(Clip('b_roar', 2.0, [KK(0.0, B), KK(0.35, B, 'out', **BR), KK(1.5, B, 'inout', **BR), KK(2.0, B, 'inout')], events={'roar': 0.35}))

    # ----- wraith (light, fast, low)
    W0 = one_hand(pel=(0.0, 0.05, -0.22), pel_rot=(14, 20, 0), sp=(22, -16, 0), head=(-14, -4, 0),
                  grip=(V3(-0.3, -0.38, 0.85), V3(-0.3, -0.8, -0.2), V3(-0.2, 0.1, -0.97)),
                  arm_l=((-40, 0, -15), (-50, 0, 0), (0, 0, 0)), fr=F(-0.2, -0.28, 10), fl=F(0.2, 0.28, 30, -15))
    keys = [KK(i * 0.3, W0, pel=(math.sin(i) * 0.02, 0.05, -0.22 + math.sin(i * 1.7) * 0.01)) for i in range(9)]
    C.append(Clip('w_idle', 2.4, keys, loop=True))
    WD = dict(pel=(0.0, -0.3, -0.3), pel_rot=(30, 0, 0), sp=(30, 0, 0), head=(-24, 0, 0),
              grip=(V3(0.25, -0.5, 0.9), V3(0.7, -0.3, -0.1), V3(0.0, -0.3, -0.95)), arm_l=((50, 0, 30), (-10, 0, 0), (0, 0, 0)))
    C.append(Clip('w_dash', 1.0, [KK(0.0, W0), KK(0.22, W0, 'out', pel=(0, 0.15, -0.3)), KK(0.4, W0, 'snap', **WD, root=(0, -4.2),
                                  fr=F(-0.2, -4.5, 10), fl=F(0.2, -3.6, 30, -20)), KK(1.0, W0, 'inout', root=(0, -4.4), fr=F(-0.2, -4.68, 10), fl=F(0.2, -4.12, 30, -15))],
                  events={'hit': [0.28, 0.44], 'cancel': 0.75, 'whoosh': 0.24, 'iframes': [0.22, 0.38]}))
    keys = [KK(0.0, W0)]
    for i in range(3):
        side = 1 if i % 2 == 0 else -1
        t0 = 0.12 + i * 0.28
        keys.append(KK(t0, W0, 'out', grip=(V3(-0.35 * side, -0.1, 1.3), V3(-0.4 * side, -0.4, 0.82), V3(0.3 * side, -0.9, 0.2)),
                       sp=(18, 20 * side, 0), root=(0, -0.2 * i)))
        keys.append(KK(t0 + 0.1, W0, 'snap', grip=(V3(0.35 * side, -0.55, 0.85), V3(0.6 * side, -0.6, -0.5), V3(-0.3 * side, -0.4, -0.86)),
                       sp=(24, -20 * side, 0), root=(0, -0.2 * i - 0.15)))
    keys.append(KK(1.3, W0, 'inout', root=(0, -0.55), fr=F(-0.2, -0.83, 10), fl=F(0.2, -0.27, 30, -15)))
    C.append(Clip('w_flurry', 1.3, keys, events={'hit': [0.18, 0.86], 'multi': 3, 'cancel': 1.0, 'swing': 0.15}))
    return C


# ============================================================================ mocap clips

MOCAP = [
    # name, file, start s, end s (None = auto cycle), loop, overlay
    ('walk', '16/16_15.bvh', 'cycle', True, 'sword_low'),
    ('run', '16/16_35.bvh', 'cycle', True, 'sword_run'),
    ('sprint', '09/09_02.bvh', 'cycle', True, 'sword_run'),
    ('walk_relaxed', '35/35_01.bvh', 'cycle', True, None),
    ('run_relaxed', '35/35_17.bvh', 'cycle', True, None),
    ('idle_relaxed', '140/140_06.bvh', (0.5, 6.5), True, None),
    ('getup', '140/140_08.bvh', (0.3, 4.0), False, None),
    ('getup_front', '140/140_01.bvh', (0.3, 4.2), False, None),
    ('bow', '111/111_02.bvh', (0.0, 3.5), False, None),
    ('walk_old', '142/142_07.bvh', 'cycle', True, None),
    ('walk_sad', '142/142_15.bvh', 'cycle', True, None),
    ('march', '138/138_01.bvh', 'cycle', True, None),
    ('walk_zombie', '104/104_41.bvh', 'cycle', True, None),
    ('sneak', '120/120_08.bvh', 'cycle', True, None),
    ('look_around', '77/77_01.bvh', (0.5, 6.0), True, None),
    ('wait', '141/141_20.bvh', (0.5, 6.0), True, None),
]


def find_cycle(skel, frames, min_len=0.5, max_len=1.7):
    """One full gait cycle: between consecutive peaks of the left foot's forward reach (relative to the
    root), which is a clean once-per-cycle signal (heights are flat and noisy during stance)."""
    reach = []
    for f in frames:
        pose = skel.fk(f)
        reach.append(-(pose['foot_l'].to_translation().y - pose['Root'].to_translation().y))
    n = len(reach)
    w = int(0.18 * A.FPS)
    peaks = [i for i in range(w, n - w) if reach[i] == max(reach[i - w:i + w + 1])]
    best = None
    mid = n / 2
    for a, b in zip(peaks, peaks[1:]):
        L = (b - a) / A.FPS
        if min_len <= L <= max_len:
            score = abs((a + b) / 2 - mid)
            if best is None or score < best[0]:
                best = (score, a, b)
    if best is None:
        a = n // 3
        return a, min(n - 1, a + int(1.0 * A.FPS))
    return best[1], best[2]


def overlay_sword(poser, frames, mode):
    """Replace the arms of a mocap clip: sword held one-handed (walk low / run trailing)."""
    s = poser.s
    out = []
    for i, f in enumerate(frames):
        basis = dict(f)
        pose = s.fk(basis)
        root = pose['Root'].to_translation()
        hip = pose['pelvis'].to_translation()
        t = i / A.FPS
        sw = math.sin(t * 2 * math.pi / 1.1)
        if mode == 'sword_low':
            G = s.grip_world(V3(hip.x - 0.27, hip.y - 0.12 + sw * 0.04, hip.z + 0.02), V3(-0.15, -0.55, -0.82), V3(0.0, -0.85, 0.5))
            s.hold(pose, basis, 'r', G, root + V3(-0.6, 0.3, 1.0))
        else:
            G = s.grip_world(V3(hip.x - 0.3, hip.y + 0.12, hip.z + 0.08), V3(-0.25, 0.85, -0.45), V3(0.0, 0.45, 0.89))
            s.hold(pose, basis, 'r', G, root + V3(-0.7, 0.4, 0.9))
        s.curl(basis, 'r', 1.0)
        out.append(basis)
    return out


def mocap_clips(skel, poser):
    clips = []
    for name, rel, rng, loop, overlay in MOCAP:
        path = os.path.join(BVH, rel)
        if not os.path.exists(path):
            print('missing', path)
            continue
        src = A.load_bvh(path)
        act = src.animation_data.action
        f0, f1 = act.frame_range
        frames = A.retarget(skel, src, (int(f0), int(f1)))
        speed = None
        if rng == 'cycle':
            a, b = find_cycle(skel, frames)
            frames = frames[a:b + 1]
            d = frames[-1]['Root'].to_translation() - frames[0]['Root'].to_translation()
            speed = d.length / max((len(frames) - 1) / A.FPS, 1e-3)
            frames = A.loop_blend(frames, 6)
        else:
            a = int(rng[0] * A.FPS)
            b = min(len(frames) - 1, int(rng[1] * A.FPS))
            frames = frames[a:b + 1]
            if loop:
                frames = A.loop_blend(frames, 12)
        # rebase so the clip starts at the origin facing forward
        r0 = frames[0]['Root'].to_translation()
        for f in frames:
            m = f['Root'].copy()
            m.translation = m.translation - V3(r0.x, r0.y, 0)
            f['Root'] = m
        if overlay:
            frames = overlay_sword(poser, frames, overlay)
        dist = (frames[-1]['Root'].to_translation() - frames[0]['Root'].to_translation()).length
        dur = (len(frames) - 1) / A.FPS
        if speed is None:
            speed = dist / max(dur, 1e-3)
        clips.append((name, frames, loop, {'speed': speed} if loop else {}))
        # remove the source armature
        for o in [src] + list(src.children):
            bpy.data.objects.remove(o)
    return clips


# ============================================================================ main

# overlapping action: after the pose (and its IK) is solved, the upper spine, neck and head trail the
# hips by a few frames, so the chest carries on after the hips stop and the head settles last. Arms and the
# sword are children of the chest, so the grip is untouched; the legs/feet are below the pelvis.
OVERLAP = (('spine_02', 1, 0.45), ('spine_03', 2, 0.55), ('neck_01', 3, 0.6), ('head', 4, 0.55))


def overlap(frames, loop):
    n = len(frames)
    if n < 6:
        return frames
    out = [dict(f) for f in frames]
    for bone, lag, k in OVERLAP:
        for i in range(n):
            j = (i - lag) % (n - 1) if loop else max(0, i - lag)
            a = frames[i].get(bone)
            b = frames[j].get(bone)
            if a is None or b is None:
                continue
            qa, qb = a.to_quaternion(), b.to_quaternion()
            q = qa.slerp(qb, k)
            m = q.to_matrix().to_4x4()
            m.translation = a.to_translation()
            out[i][bone] = m
    return out


def main():
    global ANK
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    bpy.ops.wm.open_mainfile(filepath='/opt/raw/work/kaede.blend')
    rig = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    skel = A.Skel(rig)
    ANK = skel.head('foot_r').z
    poser = Poser(skel)
    meta = {}
    baked = []
    for c in keyed_clips() + enemy_clips():
        if only and c.name not in only:
            continue
        c.fk_keys = filled(c.keys)
        frames = [poser.build(sample(c, i / A.FPS), i / A.FPS) for i in range(int(round(c.dur * A.FPS)) + 1)]
        frames = overlap(frames, c.loop)
        act = A.bake(rig, skel, c.name, frames, c.loop)
        rm = frames[-1]['Root'].to_translation() - frames[0]['Root'].to_translation()
        meta[c.name] = {'dur': c.dur, 'loop': c.loop, 'events': c.events, 'root': [rm.x, -rm.y]}
        baked.append(act)
        print('CLIP', c.name, len(frames))
    if not only or any(m[0] in only for m in MOCAP):
        for name, frames, loop, extra in mocap_clips(skel, poser):
            if only and name not in only:
                continue
            if loop:
                A.strip_root_motion(frames)
            act = A.bake(rig, skel, name, frames, loop)
            dur = (len(frames) - 1) / A.FPS
            rm = frames[-1]['Root'].to_translation() - frames[0]['Root'].to_translation()
            meta[name] = {'dur': dur, 'loop': loop, 'events': {}, 'root': [rm.x, -rm.y], **extra}
            baked.append(act)
            print('MOCAP', name, len(frames), extra)
    if '--preview' in argv:
        return rig, skel, baked, argv[argv.index('--preview') + 1]
    # export: armature only, every action
    for o in list(bpy.data.objects):
        if o is not rig:
            bpy.data.objects.remove(o)
    rig.animation_data.action = None
    for act in baked:
        tr = rig.animation_data.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, 1, act)
        st.name = act.name
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'human.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS',
                              export_skins=False, export_force_sampling=False, export_optimize_animation_size=True,
                              export_extras=False, export_def_bones=False, export_frame_step=1)
    import charlib
    charlib.pack(path, ('-ac',))
    merged = {}
    jp = os.path.join(OUT, 'human.json')
    if only and os.path.exists(jp):
        merged = json.load(open(jp))
    merged.update(meta)
    json.dump(merged, open(jp, 'w'), indent=1)
    print('EXPORTED', path, os.path.getsize(path), len(baked))


if __name__ == '__main__':
    main()
