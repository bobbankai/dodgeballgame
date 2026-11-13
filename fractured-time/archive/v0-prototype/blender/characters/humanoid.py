"""
Parametric humanoid for FRACTURED TIME: SDF-sculpted body, clothing and gear, one shared 70-bone rig.

Every human character (Ethan, the Echo, Imani, Voss, Nyx, HELIX troopers) is built by `build(spec)` and
shares bone names and rest pose, so one animation library drives them all.

Blender space: +Z up, character faces -Y, left = +X. Rest pose is an A-pose. Dimensions are metres for a
1.85 m figure; `spec['height']` scales everything uniformly.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import ftlib as lib  # noqa: E402
import sdf  # noqa: E402

V = sdf.V
BASE_HEIGHT = 1.85


# --- skeleton -------------------------------------------------------------------------------------------

def joints(spec):
    """Joint positions for the rest pose (left side; the right side mirrors in X)."""
    s = spec.get('height', BASE_HEIGHT) / BASE_HEIGHT
    sw = spec.get('shoulders', 1.0)   # shoulder / torso width multiplier
    hw = spec.get('hips', 1.0)
    P = lambda x, y, z: V((x * s, y * s, z * s))  # noqa: E731
    j = {'s': s}
    j['hips'] = P(0, 0, 0.96)
    j['spine'] = P(0, 0, 1.04)
    j['chest'] = P(0, 0, 1.18)
    j['neck'] = P(0, 0, 1.47)
    j['head'] = P(0, 0, 1.58)
    j['head_top'] = P(0, 0, 1.84)
    j['shoulder'] = P(0.03 * sw, -0.01, 1.43)
    j['upperarm'] = P(0.20 * sw, 0, 1.43)
    dU = V((0.52, 0.0, -0.85)); dU /= np.linalg.norm(dU)
    dF = V((0.42, -0.10, -0.90)); dF /= np.linalg.norm(dF)
    arm = spec.get('arm', 1.0)
    j['elbow'] = j['upperarm'] + dU * 0.30 * s * arm
    j['wrist'] = j['elbow'] + dF * 0.265 * s * arm
    j['hand_tail'] = j['wrist'] + dF * 0.085 * s
    j['dU'], j['dF'] = dU, dF
    j['thigh'] = P(0.09 * hw, 0, 0.95)
    j['knee'] = P(0.095 * hw, -0.005, 0.52)
    j['ankle'] = P(0.095 * hw, 0.01, 0.095)
    j['foot_tail'] = P(0.095 * hw, -0.17, 0.045)
    j['toe_tail'] = P(0.095 * hw, -0.255, 0.022)
    # hand: knuckle line across the back of the palm; palm faces the thigh (-X for the left hand)
    kn = j['wrist'] + dF * 0.085 * s
    j['knuckle'] = kn
    lat = V((0.0, 1.0, 0.0))                    # +Y is toward the back of the body
    out = {}
    for name, off, ln, rad in (('index', -0.030, 0.075, 0.0085), ('middle', -0.010, 0.082, 0.0090),
                               ('ring', 0.010, 0.076, 0.0085), ('pinky', 0.028, 0.060, 0.0075)):
        base = kn + lat * off * s
        mid = base + dF * (ln * 0.52) * s
        tip = base + dF * ln * s
        out[name] = (base, mid, tip, rad * s)
    t0 = j['wrist'] + dF * 0.02 * s + V((-0.025, -0.032, 0.0)) * s
    t1 = t0 + V((-0.012, -0.030, -0.028)) * s
    t2 = t1 + V((-0.010, -0.026, -0.020)) * s
    out['thumb'] = (t0, t1, t2, 0.0095 * s)
    j['fingers'] = out
    return j


def mir(p):
    q = np.array(p, dtype=np.float64).copy()
    q[0] = -q[0]
    return q


def bone_defs(j):
    """[(name, head, tail, parent)] for the whole rig (armature space = world, rest pose)."""
    B = []
    add = lambda n, h, t, p: B.append((n, tuple(float(x) for x in h), tuple(float(x) for x in t), p))  # noqa: E731
    add('root', (0, 0, 0), (0, 0, 0.12), None)
    add('hips', j['hips'], j['spine'], 'root')
    add('spine', j['spine'], j['chest'], 'hips')
    add('chest', j['chest'], j['neck'], 'spine')
    add('neck', j['neck'], j['head'], 'chest')
    add('head', j['head'], j['head_top'], 'neck')
    s = j['s']
    hc = j['head'] + V((0, 0, 0.14 * s))
    add('jaw', hc + V((0, -0.02 * s, -0.08 * s)), hc + V((0, -0.10 * s, -0.10 * s)), 'head')
    for side, m in (('L', 1), ('R', -1)):
        f = (lambda p: p) if m == 1 else mir
        add(f'eye_{side}', f(hc + V((0.034 * s, -0.075 * s, 0.01 * s))), f(hc + V((0.034 * s, -0.11 * s, 0.01 * s))), 'head')
        add(f'brow_{side}', f(hc + V((0.034 * s, -0.095 * s, 0.045 * s))), f(hc + V((0.034 * s, -0.115 * s, 0.045 * s))), 'head')
        add(f'shoulder_{side}', f(j['shoulder']), f(j['upperarm']), 'chest')
        add(f'upperarm_{side}', f(j['upperarm']), f(j['elbow']), f'shoulder_{side}')
        add(f'forearm_{side}', f(j['elbow']), f(j['wrist']), f'upperarm_{side}')
        add(f'hand_{side}', f(j['wrist']), f(j['hand_tail']), f'forearm_{side}')
        for fn, (b, mid, tip, _r) in j['fingers'].items():
            add(f'{fn}_1_{side}', f(b), f(mid), f'hand_{side}')
            add(f'{fn}_2_{side}', f(mid), f(tip), f'{fn}_1_{side}')
        add(f'thigh_{side}', f(j['thigh']), f(j['knee']), 'hips')
        add(f'shin_{side}', f(j['knee']), f(j['ankle']), f'thigh_{side}')
        add(f'foot_{side}', f(j['ankle']), f(j['foot_tail']), f'shin_{side}')
        add(f'toe_{side}', f(j['foot_tail']), f(j['toe_tail']), f'foot_{side}')
    return B


FINGER_NAMES = ('thumb', 'index', 'middle', 'ring', 'pinky')
BODY_BONES = (['hips', 'spine', 'chest', 'neck', 'head', 'jaw'] +
              [f'{b}_{s}' for s in 'LR' for b in ('eye', 'brow', 'shoulder', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe')] +
              [f'{fn}_{k}_{s}' for s in 'LR' for fn in FINGER_NAMES for k in (1, 2)])
PARENT = {'hips': 'root', 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'jaw': 'head'}
for _s in 'LR':
    PARENT.update({f'eye_{_s}': 'head', f'brow_{_s}': 'head', f'shoulder_{_s}': 'chest', f'upperarm_{_s}': f'shoulder_{_s}',
                   f'forearm_{_s}': f'upperarm_{_s}', f'hand_{_s}': f'forearm_{_s}', f'thigh_{_s}': 'hips',
                   f'shin_{_s}': f'thigh_{_s}', f'foot_{_s}': f'shin_{_s}', f'toe_{_s}': f'foot_{_s}'})
    for _f in FINGER_NAMES:
        PARENT[f'{_f}_1_{_s}'] = f'hand_{_s}'
        PARENT[f'{_f}_2_{_s}'] = f'{_f}_1_{_s}'


# --- body parts as signed distance fields ---------------------------------------------------------------

def _sym(f):
    return sdf.mirror_x(f)


def head_field(j, spec):
    s = j['s']
    hc = j['head'] + V((0, 0, 0.13 * s))
    cranium = sdf.ellipsoid(hc + V((0, 0.006 * s, 0.01 * s)), (0.083 * s, 0.103 * s, 0.108 * s))
    face = sdf.ellipsoid(hc + V((0, -0.022 * s, -0.025 * s)), (0.078 * s, 0.078 * s, 0.098 * s))
    jaw = sdf.ellipsoid(hc + V((0, -0.030 * s, -0.073 * s)), (0.064 * s * spec.get('jaw', 1.0), 0.072 * s, 0.050 * s))
    chin = sdf.sphere(hc + V((0, -0.062 * s, -0.098 * s)), 0.021 * s)
    cheek = _sym(sdf.ellipsoid(hc + V((0.050 * s, -0.062 * s, -0.030 * s)), (0.026 * s, 0.030 * s, 0.032 * s)))
    brow = _sym(sdf.ellipsoid(hc + V((0.030 * s, -0.080 * s, 0.032 * s)), (0.036 * s, 0.020 * s, 0.014 * s)))
    nose_bridge = sdf.cone(hc + V((0, -0.083 * s, 0.018 * s)), hc + V((0, -0.093 * s, -0.024 * s)), 0.0085 * s, 0.0115 * s)
    nose_tip = sdf.sphere(hc + V((0, -0.097 * s, -0.031 * s)), 0.0128 * s)
    nostril = _sym(sdf.sphere(hc + V((0.014 * s, -0.098 * s, -0.040 * s)), 0.010 * s))
    ear = _sym(sdf.ellipsoid(hc + V((0.083 * s, 0.004 * s, -0.012 * s)), (0.010 * s, 0.020 * s, 0.032 * s)))
    lip_u = sdf.ellipsoid(hc + V((0, -0.088 * s, -0.062 * s)), (0.028 * s, 0.012 * s, 0.008 * s))
    lip_l = sdf.ellipsoid(hc + V((0, -0.086 * s, -0.074 * s)), (0.025 * s, 0.012 * s, 0.009 * s))
    neck = sdf.cone(j['neck'] - V((0, 0, 0.02 * s)), j['head'] + V((0, -0.005 * s, 0.045 * s)), 0.054 * s, 0.049 * s)
    f = sdf.union(cranium, face, jaw, chin, cheek, brow, nose_bridge, nose_tip, ear, lip_u, lip_l, neck, k=0.022 * s)
    f = sdf.union(f, nostril, k=0.004 * s)
    # carve eye sockets and the mouth line, keep the rest smooth
    sock = _sym(sdf.ellipsoid(hc + V((0.034 * s, -0.080 * s, 0.010 * s)), (0.0165 * s, 0.014 * s, 0.0125 * s)))
    f = sdf.subtract(f, sock, k=0.010 * s)
    mouth = sdf.ellipsoid(hc + V((0, -0.092 * s, -0.0685 * s)), (0.030 * s, 0.010 * s, 0.0024 * s))
    f = sdf.subtract(f, mouth, k=0.002 * s)
    nolab = _sym(sdf.ellipsoid(hc + V((0.022 * s, -0.085 * s, -0.050 * s)), (0.006 * s, 0.008 * s, 0.014 * s)))
    return sdf.subtract(f, nolab, k=0.006 * s)


def torso_field(j, spec, grow=0.0):
    """The torso volume (pelvis to shoulders) used for the jacket / vest shells."""
    s, sw = j['s'], spec.get('shoulders', 1.0)
    bulk = spec.get('bulk', 1.0)
    pelvis = sdf.ellipsoid(j['hips'] + V((0, 0.004 * s, 0.04 * s)), ((0.160 * s + grow) * bulk, 0.106 * s + grow, 0.125 * s + grow))
    waist = sdf.ellipsoid(j['spine'] + V((0, 0.0, 0.07 * s)), ((0.142 * s + grow) * bulk, 0.095 * s + grow, 0.12 * s + grow))
    rib = sdf.ellipsoid(j['chest'] + V((0, -0.006 * s, 0.07 * s)), ((0.178 * s * sw + grow) * bulk, 0.118 * s + grow, 0.17 * s + grow))
    upper = sdf.ellipsoid(j['chest'] + V((0, -0.012 * s, 0.20 * s)), ((0.188 * s * sw + grow) * bulk, 0.105 * s + grow, 0.095 * s + grow))
    trap = sdf.cone(j['neck'] - V((0, 0, 0.01 * s)), j['upperarm'] + V((0, 0, 0.02 * s)), 0.050 * s + grow, 0.060 * s + grow)
    trap = sdf.union(trap, sdf.cone(j['neck'] - V((0, 0, 0.01 * s)), mir(j['upperarm']) + V((0, 0, 0.02 * s)), 0.050 * s + grow, 0.060 * s + grow))
    return sdf.union(pelvis, waist, rib, upper, trap, k=0.07 * s)


def arm_field(j, spec, side, r0, r1, r2, start=0.0, end=1.0):
    f = (lambda p: p) if side == 1 else mir
    s = j['s']
    pts = [f(j['upperarm']), f(j['elbow']), f(j['wrist'])]
    a = sdf.tube(pts, [r0 * s, r1 * s, r2 * s], k=0.03 * s)
    return a


def leg_field(j, spec, side, r0, r1, r2, to='ankle'):
    f = (lambda p: p) if side == 1 else mir
    s = j['s']
    bulk = spec.get('legs', 1.0)
    pts = [f(j['thigh']) + V((0, 0, 0.03 * s)), f(j['knee']), f(j[to])]
    return sdf.tube(pts, [r0 * s * bulk, r1 * s * bulk, r2 * s], k=0.03 * s)


def hand_field(j, side):
    f = (lambda p: p) if side == 1 else mir
    s = j['s']
    dF = j['dF'] if side == 1 else mir(j['dF'])
    kn = f(j['knuckle'])
    wrist = f(j['wrist'])
    palm_c = (wrist + kn) / 2 + dF * 0.004 * s
    Rm = sdf.frame(dF, x_hint=(0, 1, 0) if side == 1 else (0, 1, 0))
    palm = sdf.box(palm_c, (0.017 * s, 0.037 * s, 0.047 * s), r=0.012 * s, R=Rm)
    parts = [palm]
    for fn, (b, mid, tip, r) in j['fingers'].items():
        pts = [f(b), f(mid), f(tip)]
        parts.append(sdf.tube(pts, [r * 1.15, r, r * 0.8], k=0.0))
    thumb_base = sdf.cone(wrist + dF * 0.015 * s, f(j['fingers']['thumb'][0]), 0.016 * s, 0.0125 * s)
    parts.append(thumb_base)
    return sdf.union(*parts, k=0.008 * s)


def sleeve_field(j, spec, side, upto=0.50, extra=0.017):
    """Jacket sleeve along the upper arm and the first part of the forearm."""
    f = (lambda p: p) if side == 1 else mir
    s = j['s']
    bulk = spec.get('bulk', 1.0)
    e = f(j['elbow'])
    w = f(j['wrist'])
    end = e + (w - e) * upto
    d = (w - e) / np.linalg.norm(w - e)
    sl = sdf.tube([f(j['upperarm']) - V((0.01 * s if side == 1 else -0.01 * s, 0, 0)), e, end + d * 0.03 * s],
                  [(0.058 + extra) * s * bulk, (0.050 + extra) * s * bulk, (0.042 + extra * 0.9) * s], k=0.03 * s)
    sl = sdf.intersect(sl, sdf.plane(end, d))                       # flat cut at the cuff
    cuff = sdf.torus(end - d * 0.008 * s, (0.0415 + extra * 0.9) * s, 0.0085 * s, R=sdf.frame(d))
    return sdf.union(sl, cuff, k=0.006 * s)


def build_fields(j, spec):
    """All the per-material fields for one character. Returns {material: (field, lo, hi, step, tris)}."""
    s = j['s']
    bulk = spec.get('bulk', 1.0)
    out = {}

    # ---- skin: head + neck + forearms below the rolled sleeves + hands
    out['skin_head'] = (head_field(j, spec), V((-0.17 * s, -0.20 * s, 1.40 * s)), V((0.17 * s, 0.17 * s, 1.88 * s)), 0.0042 * s, 24000)
    for side in (1, -1):
        f = (lambda p: p) if side == 1 else mir
        lo = np.minimum(f(j['elbow']) - 0.08, f(j['hand_tail']) - 0.12) - V((0.04, 0.05, 0.0))
        hi = np.maximum(f(j['elbow']) + 0.08, f(j['hand_tail']) + 0.12) + V((0.04, 0.05, 0.1 * s))
        e, w = f(j['elbow']), f(j['wrist'])
        elbow_roll = e + (w - e) * 0.45
        fore = sdf.tube([elbow_roll, w], [0.0405 * s, 0.031 * s], k=0.0)
        fore = sdf.union(fore, hand_field(j, side), k=0.014 * s)
        # chronal interface plates on the forearm are the glow mesh; skin gets a slight muscle swell
        out[f'skin_arm_{"L" if side == 1 else "R"}'] = (fore, lo, hi, 0.0048 * s, 9000)

    # ---- cloth: jacket + shirt hem + trousers
    jacket = torso_field(j, spec, grow=0.014 * s)
    # waist hem tucked over the belt, then open throat
    jacket = sdf.subtract(jacket, sdf.cylinder(j['hips'] - V((0, 0, 0.09 * s)), 0.5, 0.09 * s), k=0.0)
    for side in (1, -1):
        jacket = sdf.union(jacket, sleeve_field(j, spec, side), k=0.03 * s)
    collar = sdf.cone(j['neck'] - V((0, 0, 0.015 * s)), j['neck'] + V((0, 0, 0.07 * s)), 0.078 * s, 0.066 * s)
    collar = sdf.subtract(collar, sdf.cone(j['neck'] - V((0, 0, 0.02 * s)), j['neck'] + V((0, 0, 0.09 * s)), 0.047 * s, 0.047 * s))
    jacket = sdf.union(jacket, collar, k=0.012 * s)
    # throat opening
    # front placket seam and sleeve cuff roll
    zip_ = sdf.box(j['chest'] + V((0, -0.135 * s, 0.10 * s)), (0.004 * s, 0.03 * s, 0.30 * s))
    jacket = sdf.subtract(jacket, zip_, k=0.003 * s)

    def folds(P):
        a = sdf.fbm(P, freq=18.0, octaves=3, seed=7)
        b = sdf.fbm(P * V((1.0, 1.0, 0.3)), freq=34.0, octaves=2, seed=11)
        return 0.0042 * s * (a - 0.5) + 0.0016 * s * (b - 0.5)
    jacket = sdf.displace(jacket, folds)
    lo = V((-0.40 * s, -0.20 * s, 0.82 * s)); hi = V((0.40 * s, 0.18 * s, 1.60 * s))
    out['cloth_jacket'] = (jacket, lo, hi, 0.0078 * s, 36000)

    pants = sdf.union(
        sdf.ellipsoid(j['hips'] + V((0, 0.004 * s, 0.025 * s)), (0.168 * s * spec.get('hips', 1.0) * bulk, 0.108 * s, 0.100 * s)),
        leg_field(j, spec, 1, 0.098, 0.066, 0.052, 'ankle'), leg_field(j, spec, -1, 0.098, 0.066, 0.052, 'ankle'), k=0.05 * s)
    pants = sdf.subtract(pants, sdf.cylinder(j['hips'] + V((0, 0, 0.12 * s)), 0.5, 0.05 * s))
    pants = sdf.displace(pants, lambda P: 0.0045 * s * (sdf.fbm(P, freq=15.0, octaves=3, seed=3) - 0.5))
    out['cloth_pants'] = (pants, V((-0.20 * s, -0.16 * s, 0.10 * s)), V((0.20 * s, 0.16 * s, 1.08 * s)), 0.0085 * s, 26000)

    # ---- boots
    boots = []
    for side in (1, -1):
        f = (lambda p: p) if side == 1 else mir
        ank = f(j['ankle'])
        shaft = sdf.cone(ank + V((0, 0, 0.17 * s)), ank, 0.060 * s, 0.056 * s)
        foot = sdf.box(ank + V((0, -0.065 * s, -0.035 * s)), (0.052 * s, 0.135 * s, 0.056 * s), r=0.030 * s)
        toe = sdf.ellipsoid(ank + V((0, -0.150 * s, -0.050 * s)), (0.050 * s, 0.070 * s, 0.040 * s))
        heel = sdf.ellipsoid(ank + V((0, 0.040 * s, -0.050 * s)), (0.052 * s, 0.060 * s, 0.045 * s))
        b = sdf.union(shaft, foot, toe, heel, k=0.02 * s)
        sole = sdf.box(ank + V((0, -0.070 * s, -0.080 * s)), (0.058 * s, 0.150 * s, 0.017 * s), r=0.012 * s)
        # tread grooves
        for gy in np.linspace(-0.17, 0.03, 8):
            b = sdf.union(b, sdf.subtract(sole, sdf.box(ank + V((0, gy * s, -0.095 * s)), (0.07 * s, 0.006 * s, 0.006 * s))), k=0.004 * s)
        boots.append(b)
    out['boot'] = (sdf.union(*boots), V((-0.20 * s, -0.30 * s, 0.0)), V((0.20 * s, 0.12 * s, 0.30 * s)), 0.0058 * s, 22000)

    # ---- gear: plate carrier, belt, pouches, shoulder plates, knee pads, bracers
    parts = []
    if spec.get('vest', True):
        front = sdf.box(j['chest'] + V((0, -0.100 * s, 0.17 * s)), (0.150 * s * bulk, 0.036 * s, 0.185 * s), r=0.022 * s)
        back = sdf.box(j['chest'] + V((0, 0.100 * s, 0.17 * s)), (0.150 * s * bulk, 0.032 * s, 0.185 * s), r=0.022 * s)
        strap = sdf.union(*[sdf.cone(j['neck'] + V((sx * 0.085 * s, -0.045 * s, 0.0)), j['chest'] + V((sx * 0.105 * s, -0.095 * s, 0.30 * s)), 0.016 * s, 0.016 * s)
                            for sx in (1, -1)])
        plate = sdf.intersect(sdf.union(front, back, k=0.0), sdf.offset(torso_field(j, spec, grow=0.0), -0.0))
        vest = sdf.union(front, back, k=0.0)
        shoulder_str = sdf.union(*[sdf.tube([j['neck'] + V((sx * 0.07 * s, -0.04 * s, 0.03 * s)), j['upperarm'] * V((sx, 1, 1)) * 0.78 + V((0, 0, 0.055 * s))],
                                            [0.020 * s, 0.020 * s]) for sx in (1, -1)])
        parts += [vest, shoulder_str]
        # mag pouches across the front plate
        for i in range(3):
            parts.append(sdf.box(j['chest'] + V(((i - 1) * 0.052 * s, -0.140 * s, 0.045 * s)), (0.020 * s, 0.020 * s, 0.040 * s), r=0.006 * s))
        # shoulder plates
        for sx in (1, -1):
            parts.append(sdf.ellipsoid(j['upperarm'] * V((sx, 1, 1)) + V((sx * 0.012 * s, 0, 0.040 * s)), (0.070 * s, 0.068 * s, 0.030 * s), R=sdf.rot(0, sx * -18, 0)))
    belt = sdf.torus(j['hips'] + V((0, 0, 0.075 * s)), 0.158 * s * bulk, 0.017 * s)
    parts.append(sdf.intersect(belt, sdf.box(j['hips'] + V((0, 0, 0.075 * s)), (0.26 * s, 0.13 * s, 0.05 * s))))
    parts.append(sdf.box(j['hips'] + V((0.0, -0.152 * s, 0.075 * s)), (0.030 * s, 0.014 * s, 0.020 * s), r=0.004 * s))
    for sx in (1, -1):
        parts.append(sdf.box(j['hips'] + V((sx * 0.155 * s, -0.020 * s, 0.020 * s)), (0.032 * s, 0.050 * s, 0.065 * s), r=0.010 * s))   # hip pouch
        parts.append(sdf.ellipsoid((j['knee'] * V((sx, 1, 1))) + V((0, -0.062 * s, 0.0)), (0.056 * s, 0.032 * s, 0.070 * s)))             # knee pad
        parts.append(sdf.box(j['thigh'] * V((sx, 1, 1)) + V((sx * 0.050 * s, 0.01 * s, -0.20 * s)), (0.030 * s, 0.066 * s, 0.085 * s), r=0.012 * s))  # cargo pocket
    gear = sdf.union(*parts, k=0.004 * s)
    gear = sdf.displace(gear, lambda P: 0.0016 * s * (sdf.fbm(P, freq=40.0, octaves=2, seed=5) - 0.5))
    out['gear'] = (gear, V((-0.40 * s, -0.22 * s, 0.70 * s)), V((0.40 * s, 0.20 * s, 1.60 * s)), 0.0060 * s, 24000)
    return out


# --- scene assembly ----------------------------------------------------------------------------------------

PALETTES = {
    'ethan': dict(skin='#C69A7A', cloth_jacket='#2A3138', cloth_pants='#23272B', boot='#15171A', gear='#3A3F45', hair='#1A1411',
                  iris='#4A6B7E', glow='#58D8FF'),
}


def vertex_paint(ob, base_hex, ao=None, vary=0.06, seed=1, gradient=None):
    """Bake per-vertex colour = base * variation * AO into the active 'Col' attribute."""
    me = ob.data
    base = np.array(lib.srgb(base_hex))
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    n = sdf.fbm(co, freq=22.0, octaves=3, seed=seed)
    v = 1.0 + (n - 0.5) * 2 * vary
    col = np.clip(base[None, :] * v[:, None], 0, 1)
    if gradient is not None:
        col = gradient(co, col)
    if ao is not None:
        col = col * (0.35 + 0.65 * ao)[:, None]
    attr = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    rgba = np.concatenate([col, np.ones((len(col), 1))], axis=1).astype(np.float32).ravel()
    attr.data.foreach_set('color', rgba)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = list(me.color_attributes).index(attr)


def build(spec, name='ethan', weights=True, ao=True, quality=1.0):
    """Create the character in the current scene. Returns (armature, [mesh objects], joints)."""
    j = joints(spec)
    pal = {**PALETTES['ethan'], **spec.get('palette', {})}
    s = j['s']
    fields = build_fields(j, spec)
    meshes = []
    mat_of = {'skin': f'{name}_skin', 'cloth': f'{name}_cloth', 'boot': f'{name}_boot', 'gear': f'{name}_gear'}
    base_col = {}
    for key, (fld, lo, hi, step, tris) in fields.items():
        kind = key.split('_')[0]
        hexc = pal['skin'] if kind == 'skin' else pal[key if key in pal else kind]
        rough = {'skin': 0.55, 'cloth': 0.9, 'boot': 0.65, 'gear': 0.5}[kind]
        m = lib.mat(mat_of[kind] + ('_' + key.split('_', 1)[1] if kind == 'cloth' else ''), '#FFFFFF', rough, vcol=True)
        ob = sdf.sculpt(f'{name}_{key}', fld, lo, hi, step / max(quality, 0.25), material=m, tris=int(tris * quality))
        base_col[ob.name] = hexc
        meshes.append(ob)
        print('  built', ob.name, sum(len(p.vertices) - 2 for p in ob.data.polygons), 'tris')

    # hair: a cropped cap over the cranium
    hc = j['head'] + V((0, 0, 0.13 * s))
    cap = sdf.intersect(sdf.ellipsoid(hc + V((0, 0.008 * s, 0.012 * s)), (0.097 * s, 0.118 * s, 0.123 * s)),
                        sdf.union(sdf.plane(hc + V((0, -0.01 * s, 0.088 * s)), (0, 0.22, -1)), sdf.box(hc + V((0, 0.07 * s, -0.01 * s)), (0.2 * s, 0.05 * s, 0.1 * s)),
                                  sdf.mirror_x(sdf.box(hc + V((0.085 * s, 0.0, 0.025 * s)), (0.04 * s, 0.13 * s, 0.05 * s))), k=0.01 * s))
    # keep a hairline: remove from the forehead front and below the ears
    cap = sdf.displace(cap, lambda P: 0.0030 * s * (sdf.fbm(P, freq=60.0, octaves=2, seed=9) - 0.5))
    if spec.get('hair', 'short') != 'none':
        hm = lib.mat(f'{name}_hair', '#FFFFFF', 0.62, vcol=True)
        hair = sdf.sculpt(f'{name}_hair', cap, hc - V((0.14 * s, 0.16 * s, 0.07 * s)), hc + V((0.14 * s, 0.16 * s, 0.15 * s)), 0.0042 * s, material=hm, tris=9000)
        base_col[hair.name] = pal['hair']
        meshes.append(hair)

    # eyes: spheres with painted iris/pupil
    for side, m in (('L', 1), ('R', -1)):
        c = hc + V((0.034 * s * m, -0.0735 * s, 0.010 * s))
        eye = sdf.sculpt(f'{name}_eye_{side}', sdf.sphere(c, 0.0122 * s), c - 0.02 * s, c + 0.02 * s, 0.0012 * s,
                         material=lib.mat(f'{name}_eye', '#FFFFFF', 0.10, vcol=True), tris=900)
        meshes.append(eye)
        base_col[eye.name] = '#F2EEE8'
        eye['eye_center'] = tuple(float(x) for x in c)

    # glow: chronal interface lines + core
    glow_parts = []
    for side in (1, -1):
        f = (lambda p: p) if side == 1 else mir
        e, w = f(j['elbow']), f(j['wrist'])
        d = (w - e) / np.linalg.norm(w - e)
        off = V((0.0, -0.0285 * s, 0.0))
        p0, p1 = e + (w - e) * 0.52 + off, w - d * 0.02 * s + off
        glow_parts.append(sdf.tube([p0, p1], [0.0030 * s, 0.0030 * s]))
        for t in (0.60, 0.74, 0.88):
            c = e + (w - e) * t + off
            glow_parts.append(sdf.torus(c, 0.0325 * s, 0.0016 * s, R=sdf.frame(d)))
    if spec.get('vest', True):
        core_c = j['chest'] + V((0, -0.140 * s, 0.205 * s))
        glow_parts.append(sdf.torus(core_c, 0.020 * s, 0.0032 * s, R=sdf.rot(90, 0, 0)))
        glow_parts.append(sdf.cylinder(core_c, 0.0125 * s, 0.003 * s, R=sdf.rot(90, 0, 0)))
    glow = sdf.union(*glow_parts, k=0.002 * s)
    gm = lib.mat(f'{name}_glow', '#FFFFFF', 0.3, vcol=True)
    gmesh = sdf.sculpt(f'{name}_glow', glow, V((-0.45 * s, -0.25 * s, 0.85 * s)), V((0.45 * s, 0.1 * s, 1.60 * s)), 0.0016 * s, material=gm, tris=5000)
    base_col[gmesh.name] = pal['glow']
    meshes.append(gmesh)

    # ambient occlusion baked per vertex, then colour
    skin_objs = [m_ for m_ in meshes]
    aos = {}
    if ao:
        try:
            aos = sdf.bake_ao(skin_objs, distance=0.10 * s, samples=24)
        except Exception as e:  # noqa: BLE001
            print('AO bake skipped:', e)
    for ob in meshes:
        kind = ob.name.split('_')[1]
        vary = {'skin': 0.04, 'cloth': 0.10, 'gear': 0.07, 'boot': 0.08, 'hair': 0.15, 'eye': 0.0, 'glow': 0.0}.get(kind, 0.06)
        grad = None
        if kind == 'skin':
            def grad(co, col, s=s):  # warmer cheeks / lips
                c = col.copy()
                lips = (np.abs(co[:, 0]) < 0.03 * s) & (co[:, 1] < -0.075 * s) & (np.abs(co[:, 2] - (j['head'][2] + 0.13 * s - 0.068 * s)) < 0.010 * s)
                c[lips] = c[lips] * np.array([0.95, 0.72, 0.70])
                return np.clip(c, 0, 1)
        if kind == 'eye':
            ec = np.array(ob['eye_center'])
            side_m = 1 if ob.name.endswith('_L') else -1

            def grad(co, col, ec=ec):
                c = col.copy()
                d = co - ec
                r = np.linalg.norm(d, axis=1) + 1e-9
                front = -d[:, 1] / r
                iris = front > 0.93
                pupil = front > 0.975
                c[iris] = np.array(lib.srgb(pal['iris']))
                c[pupil] = np.array([0.01, 0.01, 0.012])
                return c
        if kind == 'glow':
            vertex_paint(ob, base_col[ob.name], None, 0.0, 3)
            continue
        vertex_paint(ob, base_col[ob.name], aos.get(ob.name), vary, seed=hash(ob.name) % 97, gradient=grad)

    # rig
    bones = bone_defs(j)
    arm = lib.armature(f'{name}_rig', bones)
    arm.show_in_front = True
    if weights:
        apply_weights(meshes, bones, j, name)
    for ob in meshes:
        lib.bind(ob, arm)
    return arm, meshes, j


def apply_weights(meshes, bones, j, name):
    segs = {n: (Vector(h), Vector(t)) for n, h, t, p in bones if n not in ('root',)}
    s = j['s']
    # bones that should not take weight from distant geometry (small features)
    body = {n: v for n, v in segs.items() if not n.startswith(('eye_', 'brow_', 'jaw'))}
    for ob in meshes:
        kind = ob.name.split('_')[1]
        if kind == 'eye':
            side = ob.name[-1]
            lib.set_weights(ob, lambda p, sd=side: {f'eye_{sd}': 1.0})
            continue
        if kind == 'hair':
            lib.set_weights(ob, lambda p: {'head': 1.0})
            continue
        pool = dict(body)
        if kind in ('cloth', 'boot'):
            pool = {n: v for n, v in body.items() if not n.split('_')[0] in FINGER_NAMES}
        mult = {'hips': 1.0, 'spine': 1.15, 'chest': 1.2, 'neck': 0.8, 'head': 1.4}

        def wfn(p, pool=pool, mult=mult, kind=kind):
            # side-aware: a vertex on the left half only listens to the left limb's bones (and the centre line)
            if abs(p.x) > 0.02 * s:
                keep = '_L' if p.x > 0 else '_R'
                drop = '_R' if p.x > 0 else '_L'
                sub = {n: v for n, v in pool.items() if not n.endswith(drop)}
            else:
                sub = pool
            w = lib.dist_weights(p, sub, mult, power=4.2)
            if kind == 'skin':
                # head skin: jaw takes the lower face, head the rest
                hcz, hcy = float(j['head'][2]) + 0.13 * s, float(j['head'][1])
                if p.z > j['neck'][2] + 0.02 * s:
                    lower = p.z < hcz - 0.045 * s and p.y < hcy + 0.02 * s
                    ww = {'head': 1.0, 'neck': 0.0}
                    if lower:
                        t = min(1.0, max(0.0, (hcz - 0.045 * s - p.z) / (0.04 * s)))
                        ww = {'head': 1.0 - 0.9 * t, 'jaw': 0.9 * t}
                    if p.z < j['head'][2] + 0.01 * s:
                        t = (j['head'][2] + 0.01 * s - p.z) / (0.06 * s)
                        ww = {'head': ww.get('head', 1.0) * (1 - min(1, t)), 'neck': min(1, t), 'jaw': ww.get('jaw', 0.0) * (1 - min(1, t))}
                    return {k: v for k, v in ww.items() if v > 0}
            return w
        lib.set_weights(ob, wfn)


# --- helpers for scripts --------------------------------------------------------------------------------

def preview_sheet(path, views=(('front', 0, 4), ('side', 90, 4), ('three', -35, 10), ('back', 180, 4)), target=None, dist=4.2, size=(520, 900), lens=60):
    base, ext = os.path.splitext(path)
    for nm, yaw, pitch in views:
        lib.preview(f'{base}_{nm}{ext}', target=target or (0, 0, 0.95), dist=dist, yaw=yaw, pitch=pitch, size=size, samples=24, lens=lens)
