"""
The cast of Vowbreaker, on the vbchar builder.

  blender -b -P vowbreaker/tools/blender/vbcast.py -- <name|a,b|all> [--preview out.png] [--export] [--save]

Each character is a spec: proportions, palette, face style, hair locks, outfit and accessories.
Hair locks are (angle round the head in degrees (0 front, 90 their left), t on the head
(0 crown .. 1 chin), length and width in head units, options) -- see vbchar.lock.
"""
import math
import os
import sys
import traceback

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import vbchar as A  # noqa: E402
import vbcore as core  # noqa: E402
import vbmesh as M  # noqa: E402
from vbchar import V  # noqa: E402

EYES = {'eye_white': '#FAF6F0', 'eye_hi': '#FFFFFF', 'lash': '#1A1418', 'mouth': '#93453F'}


def fringe(a0, a1, n, t=0.14, length=0.6, width=0.15, **kw):
    out = []
    for i in range(n):
        f = i / max(n - 1, 1)
        a = a0 + (a1 - a0) * f
        o = dict(hug=0.55, out=0.12, drop=0.35, sweep=(f - 0.5) * 0.5)
        o.update(kw)
        out.append((a, t, length, width, o))
    return out


def ring_of(angles, t, length, width, **kw):
    return [(a, t, length, width, dict(kw)) for a in angles]


# ---------------------------------------------------------------------------------- Itsuki

def itsuki():
    P = A.Proportions(H=1.74, kind='male', build=1.0)
    C = A.Character('itsuki', {**EYES, 'skin': '#F2D0B4', 'hair': '#1F1B24', '_hair_tips': '#6B4234', 'iris': '#D08A2C',
                               'brow': '#1F1B24', 'jacket': '#191D2B', 'shirt': '#7C1F25', 'pants': '#191D2B', 'shoes': '#2B2420',
                               'sole': '#131111', 'button': '#C9A24A', 'bell': '#D9B24E', 'cord': '#B3262B', '_blush': 0.25}, P)
    A.build_head(C, dict(jaw=0.75, width=0.95, eye_w=0.088, eye_h=0.084, eye_tilt=7, eye_droop=-0.3, brow_angle=12, lash=0.9,
                         iris=0.74, brow_w=1.15, mouth_w=0.07, smile=0.04, cheek=0.25, crease=0.4))
    L = []
    for i, a in enumerate(np.linspace(-52, 52, 9)):
        f = abs(a) / 52
        L.append((a, 0.11 + 0.02 * (i % 2), 0.5 + 0.14 * f - 0.05 * (i % 2), 0.2, dict(hug=0.5, out=0.1, drop=0.35, sweep=np.sign(a) * (0.15 + 0.35 * f), curl=0.04)))
    L += ring_of((-80, -100, 80, 100), 0.3, 0.48, 0.15, hug=0.5, out=0.15, drop=0.75)
    for i, a in enumerate(range(116, 250, 19)):
        L.append((a, 0.14 + 0.06 * (i % 3), 0.5 + 0.06 * (i % 2), 0.19, dict(hug=0.3, out=0.42, drop=0.5, curl=-0.05)))
    for a in (125, 155, 180, 205, 235):
        L.append((a, 0.035, 0.42, 0.18, dict(hug=0.32, out=0.38, drop=0.22)))
    L += ring_of((150, 180, 210), 0.62, 0.36, 0.14, hug=0.35, out=0.32, drop=0.7)
    cap = A.hair_cap(C, front=0.14, temple=-0.1, back=-0.33, grow=0.06)
    A.hair(C, L, cap)
    A.shirt(C, 'shirt', hood=True)
    A.jacket(C, 'jacket', open_front=0.045, buttons=None)
    A.pants(C, 'pants')
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.75)
    A.bell_charm(C, V(0.085 * P.H, -0.065 * P.H, P.z_hip + 0.02 * P.H))
    return C


def hp(P, x, y, z):
    return A.hp(P, x, y, z)


def bow(C, centre, size, color, kind='hair', axis_up=(0, 0, 1), facing=(0, 1, 0)):
    """A ribbon bow: two loops and a knot, plus two short tails."""
    c = V(centre)
    f = M.nrm(V(facing))
    side = M.nrm(np.cross(V(axis_up), f))
    up = M.nrm(np.cross(f, side))
    obs = []
    for s in (1, -1):
        pts = [c, c + side * s * size * 0.55 + up * size * 0.4, c + side * s * size * 1.05, c + side * s * size * 0.55 - up * size * 0.35, c]
        obs.append(M.tube(pts, [size * 0.12, size * 0.3, size * 0.34, size * 0.3, size * 0.12], n=10, samples=14, squash=0.3, guide=f).build(f'loop{s}'))
        tail = [c, c + side * s * size * 0.3 - up * size * 0.6, c + side * s * size * 0.45 - up * size * 1.1]
        obs.append(M.tube(tail, [size * 0.18, size * 0.2, size * 0.24], n=8, samples=8, squash=0.25, guide=f, cap1='fan').build(f'tail{s}'))
    obs.append(M.sphere(c, size * 0.2, 10, 6, scale=(1, 0.7, 1.15)).build('knot'))
    ob = M.merge(obs, 'bow')
    M.finish(ob, 1)
    C.add(ob, color, kind)


# ---------------------------------------------------------------------------------- Sayo

def sayo():
    P = A.Proportions(H=1.66, kind='female', build=1.0)
    C = A.Character('sayo', {**EYES, 'skin': '#F6DCC8', 'hair': '#15121A', 'iris': '#6B4F8A', 'brow': '#15121A', 'jacket': '#1A2036',
                             'skirt': '#1A2036', 'tights': '#14131A', 'shoes': '#221C1E', 'sole': '#111010', 'button': '#BFC3CC',
                             'ribbon': '#B3262B', 'pouch': '#9E2226', '_blush': 0.55}, P)
    A.build_head(C, dict(jaw=0.45, width=0.93, eye_w=0.092, eye_h=0.1, eye_tilt=9, eye_droop=-0.15, brow_angle=3, lash=1.25, iris=0.75,
                         brow_w=0.8, mouth_w=0.058, smile=0.08, cheek=0.45, nose=0.8, crease=0.7, flick=0.08))
    L = []
    # hime cut: a blunt straight fringe ...
    for i, a in enumerate(np.linspace(-54, 54, 11)):
        L.append((a, 0.1, 0.56, 0.19, dict(hug=0.62, out=0.06, drop=0.3, tip=0.55, thick=0.28, sweep=a / 54 * 0.2)))
    # ... side locks cut at the jaw ...
    L += ring_of((-62, -78, 62, 78), 0.26, 0.78, 0.17, hug=0.5, out=0.1, drop=0.95, tip=0.5, thick=0.28)
    # ... and a long curtain to the waist
    for i, a in enumerate(np.linspace(118, 242, 11)):
        L.append((a, 0.2, 3.0 + 0.1 * ((i % 3) - 1), 0.29, dict(hug=0.36, out=0.14, drop=1.0, tip=0.45, thick=0.22, samples=18)))
    for sd in (1, -1):
        L.append((sd * 100, 0.24, 2.2, 0.22, dict(hug=0.4, out=0.08, drop=1.0, tip=0.45, thick=0.24, sweep=sd * 0.35, samples=16)))
    A.hair(C, L, A.hair_cap(C, front=0.2, temple=-0.12, back=-0.38, grow=0.06))
    A.hair_chain(C, hp(P, 0, 0.5, -0.4), hp(P, 0, 0.75, -3.1), n=3)
    bow(C, hp(P, 0, 0.62, -0.55), 0.3 * P.u, 'ribbon', facing=(0, 1, 0.1))
    A.jacket(C, 'jacket', hem=P.z_hip + 0.04 * P.H, buttons='button')
    A.skirt(C, 'skirt', hem=P.z_knee - 0.1 * P.H, flare=1.0)
    A.tights(C, 'tights')
    A.shoes(C, 'shoes', 'sole', boot=0.13)
    A.hands(C, 'skin', fist=0.6)
    pc = V(-0.13 * P.H, -0.02 * P.H, P.z_hip + 0.03 * P.H)
    po = M.rbox(pc, (0.024 * P.H, 0.016 * P.H, 0.028 * P.H), round_=0.45).build('pouch')
    M.finish(po, 1)
    C.add(po, 'pouch', 'torsopart')
    return C


# ---------------------------------------------------------------------------------- Mikami

def mikami():
    P = A.Proportions(H=1.86, kind='male', build=1.04)
    C = A.Character('mikami', {**EYES, 'skin': '#EDCBAF', 'hair': '#2A2A30', '_hair_tips': '#55555E', 'iris': '#6C8DA6', 'brow': '#2A2A30',
                               'coat': '#2B2D33', 'shirt': '#16171C', 'pants': '#1E1F24', 'shoes': '#1C1714', 'sole': '#0F0D0C',
                               'mask': '#F2EEE6', 'mask_mark': '#C2262B', 'tie': '#8E2A2A', '_blush': 0.1}, P)
    A.build_head(C, dict(jaw=0.85, width=0.93, eye_w=0.082, eye_h=0.068, eye_tilt=2, eye_droop=0.25, brow_angle=-3, lash=0.8, iris=0.68,
                         brow_w=1.2, mouth_w=0.075, smile=0.0, cheek=0.2, brow_ridge=0.6, crease=0.8, nose=1.1))
    L = []
    for i, a in enumerate(np.linspace(-40, 40, 7)):
        L.append((a, 0.1 + 0.03 * (i % 2), 0.55, 0.19, dict(hug=0.5, out=0.12, drop=0.45, sweep=0.25 + a / 40 * 0.2)))
    L += ring_of((-72, -96, 72, 96, 122, -122), 0.3, 0.55, 0.17, hug=0.45, out=0.2, drop=0.8)
    for a in range(135, 240, 25):
        L.append((a, 0.2, 0.55, 0.2, dict(hug=0.45, out=0.3, drop=0.6)))
    # a short low ponytail
    L.append((180, 0.55, 1.25, 0.15, dict(hug=0.12, out=0.4, drop=1.0, thick=0.5, tip=0.15, samples=16)))
    A.hair(C, L, A.hair_cap(C, front=0.16, temple=-0.12, back=-0.36, grow=0.06))
    A.hair_chain(C, hp(P, 0, 0.55, -0.6), hp(P, 0, 0.8, -1.7), n=2)
    tie = M.torus(hp(P, 0, 0.57, -0.62), 0.07 * P.u, 0.025 * P.u, axis=(0, 0.3, -1), n=14, m=6).build('hairtie')
    M.finish(tie, 1)
    C.add(tie, 'tie', 'hair')
    A.shirt(C, 'shirt', top=P.neck_base + 0.03 * P.H)
    A.long_coat(C, 'coat', hem=P.z_knee - 0.06 * P.H, open_front=0.05)
    A.pants(C, 'pants')
    A.shoes(C, 'shoes', 'sole', boot=0.1)
    A.hands(C, 'skin', fist=0.55)
    # the fox mask hanging at his hip
    mc = V(0.17 * P.H, -0.07 * P.H, P.z_hip - 0.01 * P.H)
    u = P.u * 0.8
    face = M.sphere(mc, u * 0.36, 16, 10, scale=(0.85, 0.32, 1.1)).build('foxface')
    ears = [M.tube([mc + V(s * 0.14, 0.0, 0.26) * u, mc + V(s * 0.22, 0.01, 0.42) * u, mc + V(s * 0.27, 0.02, 0.6) * u],
                   [0.1 * u, 0.06 * u, 0.01 * u], n=8, samples=8, squash=0.5, guide=V(0, -1, 0)).build(f'fe{s}') for s in (1, -1)]
    snout = M.sphere(mc + V(0, -0.14, -0.16) * u, u * 0.13, 12, 8, scale=(1, 1.2, 0.9)).build('fsnout')
    fm = M.merge([face, snout] + ears, 'foxmask')
    M.finish(fm, 1)
    C.add(fm, 'mask', 'torsopart', 'paper', line=0.8)
    return C


# ---------------------------------------------------------------------------------- Sojin

def sojin(young=False):
    P = A.Proportions(H=1.82 if not young else 1.78, kind='male', build=1.1 if not young else 1.0)
    name = 'sojin_young' if young else 'sojin'
    C = A.Character(name, {**EYES, 'skin': '#E9C6A6' if not young else '#EFCCAE', 'hair': '#18161B', 'iris': '#C9AE58' if not young else '#5A3E2A',
                           'brow': '#18161B', 'robe': '#1B1A26' if not young else '#25402F', 'kesa': '#7B2A1C', 'beads': '#5A3A22',
                           'hakama': '#3A3A44', 'shirt': '#E8E2D4', 'shoes': '#2A221C', 'sole': '#141010', 'obi': '#22202A',
                           'stubble': '#3A3436', '_blush': 0.1}, P)
    A.build_head(C, dict(jaw=0.9, width=0.97, eye_w=0.08, eye_h=0.07 if not young else 0.08, eye_tilt=4, eye_droop=0.1, brow_angle=10, lash=0.8,
                         iris=0.62, brow_w=1.4, mouth_w=0.08, smile=-0.08 if not young else 0.06, cheek=0.15,
                         brow_ridge=1.0 if not young else 0.3, crease=0.9 if not young else 0.4, nose=1.15))
    if young:
        L = []
        for i, a in enumerate(np.linspace(-36, 36, 5)):
            L.append((a, 0.08, 0.46, 0.2, dict(hug=0.45, out=0.2, drop=0.4, sweep=a / 36 * 0.3)))
        L += ring_of((75, -75, 105, -105, 140, 180, 220), 0.24, 0.42, 0.18, hug=0.45, out=0.3, drop=0.55)
        A.hair(C, L, A.hair_cap(C, front=0.2, temple=-0.1, back=-0.32, grow=0.06))
    else:
        # a shaved head: a stubble cap; a short beard and moustache
        cap = A.hair_cap(C, front=0.24, temple=-0.06, back=-0.34, grow=0.006)
        u = P.u
        beard = []
        for a in (-28, -14, 0, 14, 28):
            beard.append((a, 0.9, 0.2, 0.14, dict(hug=0.6, out=0.15, drop=0.9, grow=0.012, tip=0.1)))
        for s in (1, -1):
            beard.append((s * 45, 0.78, 0.2, 0.14, dict(hug=0.8, out=0.1, drop=0.6, grow=0.012)))
        A.hair(C, beard, cap, mname='stubble')
        st = M.tube([hp(P, -0.14, -0.43, -0.4), hp(P, 0, -0.47, -0.37), hp(P, 0.14, -0.43, -0.4)], [0.012 * u, 0.03 * u, 0.012 * u],
                    n=8, samples=10, squash=0.45, guide=V(0, -1, 0.3)).build('stache')
        M.finish(st, 1)
        C.add(st, 'hair', 'face', 'hair')
    if young:
        A.shirt(C, 'shirt', top=P.neck_base + 0.02 * P.H)
        A.long_coat(C, 'robe', hem=P.z_hip - 0.07 * P.H, open_front=0.03, wide_sleeves=0.012, collar=False, hem_r=1.75, folds=0.02)
        A.skirt(C, 'hakama', top=P.z_hip + 0.08 * P.H, hem=P.z_ankle + 0.03 * P.H, flare=0.9, pleats=8, depth=0.03)
        A.obi(C, 'obi', z=P.z_hip + 0.08 * P.H, height=0.04, bow=False)
    else:
        A.long_coat(C, 'robe', hem=P.z_ankle + 0.03 * P.H, open_front=0.0, wide_sleeves=0.03, drop=0.05, grow=0.014, collar=False)
        A.strap(C, 'kesa', 'kesa', math.radians(60), P.z_sh + 0.02 * P.H, math.radians(-50), P.z_hip - 0.04 * P.H, 0.11 * P.H,
                0.02 * P.H, thick=0.007)
        A.beads(C, 'beads', (0, -0.01 * P.H, P.neck_base - 0.03 * P.H), 0.085 * P.H, 22, 0.012 * P.H, tilt=(-25, 0, 0))
    A.pants(C, 'hakama' if young else 'robe', top=P.z_hip - 0.02 * P.H, r=(0.046, 0.044, 0.042, 0.042))
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.45)
    return C


def sojin_young():
    return sojin(young=True)


# ---------------------------------------------------------------------------------- Ryoga

def ryoga():
    P = A.Proportions(H=1.77, kind='male', build=0.97)
    C = A.Character('ryoga', {**EYES, 'skin': '#F0D2BC', 'hair': '#D7D6E6', '_hair_tips': '#8E63C9', 'iris': '#9152D6', 'brow': '#B9B6CC',
                              'jacket': '#E9E7EE', 'shirt': '#4A2A6E', 'pants': '#E3E1EA', 'shoes': '#1A1820', 'sole': '#0E0D11',
                              'button': '#9AA0B5', 'earring': '#B8A2E8', '_blush': 0.2}, P)
    A.build_head(C, dict(jaw=0.78, width=0.93, eye_w=0.09, eye_h=0.08, eye_tilt=12, eye_droop=-0.4, brow_angle=14, lash=1.05, iris=0.72,
                         brow_w=0.95, mouth_w=0.065, smile=-0.04, cheek=0.25, crease=0.5, nose=0.9))
    L = []
    # undercut: a long top swept across to his right, over the right eye
    for i, a in enumerate(np.linspace(-20, 64, 8)):
        L.append((a, 0.05 + 0.03 * (i % 2), 0.78 - 0.1 * (i % 2), 0.22, dict(hug=0.42, out=0.16, drop=0.65, sweep=-0.42, curl=0.04)))
    for a in range(100, 270, 28):
        L.append((a, 0.12, 0.42, 0.2, dict(hug=0.4, out=0.35, drop=0.4, sweep=-0.3)))
    A.hair(C, L, A.hair_cap(C, front=0.24, temple=0.02, back=-0.2, grow=0.05))
    # the shaved sides
    A.hair(C, [], A.hair_cap(C, front=0.1, temple=-0.12, back=-0.36, grow=0.008), mname='brow')
    C.parts[-1].ob.name = 'ryoga_undercut'
    A.shirt(C, 'shirt', top=P.neck_base + 0.02 * P.H)
    A.jacket(C, 'jacket', buttons='button')
    A.pants(C, 'pants')
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.75)
    e = hp(P, -0.43, 0.04, -0.32)
    eo = M.torus(e, 0.022 * P.u, 0.006 * P.u, axis=(1, 0, 0), n=16, m=6).build('earring')
    M.finish(eo, 1)
    C.add(eo, 'earring', 'head', 'metal', line=0.3)
    return C


# ---------------------------------------------------------------------------------- the children

def mio():
    P = A.Proportions(H=1.26, kind='child')
    C = A.Character('mio', {**EYES, 'skin': '#F8DECB', 'hair': '#3A2622', 'iris': '#7B4A2A', 'brow': '#3A2622', 'shirt': '#F3F0EA',
                            'dress': '#22305A', 'socks': '#F2F0EC', 'shoes': '#B32A2E', 'sole': '#3A1414', 'bag': '#C0262C',
                            'bell': '#D9B24E', 'cord': '#B3262B', 'ribbon': '#F2C84A', '_blush': 0.8}, P)
    A.build_head(C, dict(jaw=0.15, width=1.03, eye_w=0.1, eye_h=0.12, eye_tilt=-1, eye_droop=0.25, brow_angle=-4, lash=1.0, iris=0.8,
                         brow_w=0.7, mouth_w=0.05, smile=0.25, cheek=0.85, nose=0.6, crease=0.3, eye_z=-0.16, neck=0.85))
    L = []
    for i, a in enumerate(np.linspace(-46, 46, 9)):
        L.append((a, 0.12, 0.5, 0.18, dict(hug=0.6, out=0.08, drop=0.35, tip=0.45, sweep=a / 46 * 0.15)))
    L += ring_of((64, 84, 108, -64, -84, -108, 135, 160, 185, 210, 235), 0.24, 0.62, 0.2, hug=0.5, out=0.12, drop=0.95, tip=0.45)
    for s in (1, -1):
        L.append((s * 102, 0.2, 0.8, 0.2, dict(hug=0.06, out=0.55, drop=1.0, thick=0.5, tip=0.2, samples=16, sweep=s * 0.4)))
    A.hair(C, L, A.hair_cap(C, front=0.2, temple=-0.12, back=-0.36, grow=0.06))
    for s in (1, -1):
        root = C.head.world(math.radians(s * 102), 0.2) + C.head.normal(math.radians(s * 102), 0.2) * 0.07 * P.u
        t = M.sphere(root, 0.055 * P.u, 10, 6).build(f'tie{s}')
        M.finish(t, 1)
        C.add(t, 'ribbon', 'hair')
    A.shirt(C, 'shirt', top=P.neck_base + 0.012 * P.H, bottom=P.z_hip + 0.1 * P.H, collar=True)
    A.jacket(C, 'shirt', hem=P.z_hip + 0.12 * P.H, collar=None, buttons=None, grow=0.006)
    A.skirt(C, 'dress', top=P.z_hip + 0.2 * P.H, hem=P.z_knee + 0.02 * P.H, flare=1.1, pleats=10)
    A.tights(C, 'socks', top=P.z_knee + 0.04 * P.H)
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.35)
    # the red school backpack, with the little bell
    bc = V(0, 0.1 * P.H, P.z_hip + 0.2 * P.H)
    bo = M.rbox(bc, (0.12 * P.H, 0.055 * P.H, 0.13 * P.H), round_=0.4).build('randoseru')
    M.finish(bo, 1)
    C.add(bo, 'bag', 'torsopart')
    for s in (1, -1):
        A.strap(C, f'bagstrap{s}', 'bag', s * math.radians(150), P.z_sh + 0.012 * P.H, s * math.radians(35), P.z_hip + 0.12 * P.H, 0.022 * P.H, 0.008 * P.H, thick=0.006)
    A.bell_charm(C, bc + V(0.1 * P.H, 0.03 * P.H, -0.1 * P.H), size=0.016)
    return C


def hina():
    P = A.Proportions(H=1.1, kind='child', head_scale=1.05)
    C = A.Character('hina', {**EYES, 'skin': '#F9E0CC', 'hair': '#1E1820', 'iris': '#4A2E22', 'brow': '#1E1820', 'yukata': '#2B3D78',
                             'obi': '#D8902E', 'shoes': '#8A5A34', 'sole': '#3A2A1A', 'flower': '#F09AB8', '_blush': 0.9}, P)
    A.build_head(C, dict(jaw=0.1, width=1.05, eye_w=0.105, eye_h=0.125, eye_tilt=-2, eye_droop=0.3, brow_angle=-6, lash=0.95, iris=0.82,
                         brow_w=0.65, mouth_w=0.045, smile=0.35, cheek=0.95, nose=0.5, crease=0.2, eye_z=-0.17, neck=0.8))
    L = []
    for i, a in enumerate(np.linspace(-48, 48, 9)):
        L.append((a, 0.12, 0.46, 0.18, dict(hug=0.62, out=0.08, drop=0.35, tip=0.5)))
    L += ring_of((60, 82, 104, 128, 152, 180, 208, 232, 256, 278, 300), 0.22, 0.58, 0.22, hug=0.5, out=0.12, drop=0.95, tip=0.5)
    A.hair(C, L, A.hair_cap(C, front=0.2, temple=-0.12, back=-0.38, grow=0.06))
    fc = hp(P, 0.4, -0.05, 0.28)
    petals = [M.sphere(fc + V(math.cos(a) * 0.05, -0.02, math.sin(a) * 0.05) * P.u, 0.045 * P.u, 8, 6, scale=(1, 0.5, 1)).build(f'petal{i}')
              for i, a in enumerate(np.linspace(0, 2 * math.pi, 6)[:-1])]
    fo = M.merge(petals, 'flower')
    M.finish(fo, 1)
    C.add(fo, 'flower', 'hair')
    A.long_coat(C, 'yukata', hem=P.z_ankle + 0.04 * P.H, open_front=0.0, wide_sleeves=0.035, drop=0.04, collar=False, grow=0.012)
    A.obi(C, 'obi', height=0.07)
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.3)
    return C


def kota():
    P = A.Proportions(H=1.2, kind='child')
    C = A.Character('kota', {**EYES, 'skin': '#F6DCC6', 'hair': '#1A161C', 'iris': '#5A4A6E', 'brow': '#1A161C', 'robe': '#EEEAE0',
                             'pants': '#6A6A74', 'shoes': '#3A3036', 'sole': '#1A1416', 'obi': '#5A5A66', '_blush': 0.7}, P)
    A.build_head(C, dict(jaw=0.15, width=1.0, eye_w=0.098, eye_h=0.11, eye_tilt=0, eye_droop=0.15, brow_angle=-2, lash=0.8, iris=0.78,
                         brow_w=0.8, mouth_w=0.05, smile=0.15, cheek=0.8, nose=0.6, crease=0.2, eye_z=-0.16, neck=0.85))
    L = []
    for i, a in enumerate(np.linspace(-40, 40, 7)):
        L.append((a, 0.08, 0.44, 0.19, dict(hug=0.5, out=0.15, drop=0.4, sweep=a / 40 * 0.3)))
    for a in range(70, 300, 26):
        L.append((a, 0.18, 0.4, 0.2, dict(hug=0.4, out=0.3, drop=0.5)))
    A.hair(C, L, A.hair_cap(C, front=0.2, temple=-0.1, back=-0.32, grow=0.06))
    A.long_coat(C, 'robe', hem=P.z_knee - 0.02 * P.H, open_front=0.0, wide_sleeves=0.015, collar=False)
    A.obi(C, 'obi', height=0.04, bow=False)
    A.pants(C, 'pants', top=P.z_hip - 0.02 * P.H, r=(0.042, 0.04, 0.038, 0.036))
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.3)
    return C


# ---------------------------------------------------------------------------------- acolytes

def acolyte():
    P = A.Proportions(H=1.76, kind='male', build=1.0)
    C = A.Character('acolyte', {**EYES, 'skin': '#E7D2C0', 'robe': '#E6E2D8', 'hood': '#D8D2C4', 'mask': '#F4F1EA', 'mask_mark': '#C3262C',
                                'pants': '#CFC9BC', 'shoes': '#2A2422', 'sole': '#141010', 'obi': '#7A2A22', 'hair': '#111', 'brow': '#111'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.6, face_shadow=False, no_ears=True))
    A.face_mask(C, 'mask', 'mask_mark')
    A.hood(C, 'hood', grow=0.14, open_face=0.6, drape=0.05)
    A.long_coat(C, 'robe', hem=P.z_ankle + 0.05 * P.H, open_front=0.0, wide_sleeves=0.025, drop=0.03, collar=False)
    A.obi(C, 'obi', height=0.035, bow=False)
    A.pants(C, 'pants', top=P.z_hip - 0.02 * P.H, r=(0.046, 0.042, 0.04, 0.038))
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.6)
    return C


# ---------------------------------------------------------------------------------- curses

def mudhand():
    """A crawling grief-curse: a lumpy tar body, extra hands growing out of its back, one eye."""
    P = A.Proportions(H=1.55, kind='male', build=1.25)
    C = A.Character('mudhand', {**EYES, 'skin': '#2A1F2E', 'tar': '#241A2A', 'eye_glow': '#F0D24A', 'claw': '#14101A', 'iris': '#F0D24A',
                                'brow': '#000000'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.3, width=1.15, skin='tar', mid='cloth', face_shadow=False, no_ears=True))
    H = P.H
    A.skin_body(C, 'tar', grow=0.02, arm_r=(0.04, 0.036, 0.03), leg_r=(0.06, 0.045, 0.035), mid='cloth', noise=0.03)
    obs = []
    for i, (x, z, a) in enumerate(((0.1, 0.72, 30), (-0.12, 0.66, -40), (0.02, 0.6, 5), (0.16, 0.56, 60))):
        root = V(x * H, 0.04 * H, z * H)
        wr = root + V(math.sin(math.radians(a)) * 0.18 * H, 0.16 * H, 0.1 * H)
        obs.append(M.tube([root, (root + wr) / 2 + V(0, 0.02 * H, 0.03 * H), wr], [0.032 * H, 0.025 * H, 0.018 * H], n=10, samples=10).build(f'barm{i}'))
        for f in range(4):
            fa = math.radians(a - 30 + f * 20)
            tip = wr + V(math.sin(fa) * 0.06 * H, 0.045 * H, math.cos(fa) * 0.05 * H)
            obs.append(M.tube([wr, (wr + tip) / 2 + V(0, 0.01 * H, 0.008 * H), tip], [0.008 * H, 0.006 * H, 0.002 * H], n=6, samples=6).build(f'bf{i}{f}'))
    bo = M.merge(obs, 'backhands')
    M.finish(bo, 1)
    C.add(bo, 'tar', 'torsopart')
    A.glow_spot(C, 'bigeye', 0.0, -0.08, 0.2, 0.13, 'eye_glow')
    A.glow_spot(C, 'pupil', 0.0, -0.08, 0.035, 0.11, 'claw', lift=0.007, mid='eye')
    A.hands(C, 'claw', fist=0.1)
    return C


def umbrella():
    """Red Umbrella: a tall thin curse in a tattered coat, its head a torn red umbrella."""
    P = A.Proportions(H=2.35, kind='male', build=0.82, head_scale=0.8)
    C = A.Character('umbrella', {**EYES, 'skin': '#1A1418', 'coat': '#141218', 'canopy': '#B01E24', 'rib': '#2A2228', 'claw': '#0E0B10',
                                 'pants': '#141218', 'shoes': '#0E0B10', 'sole': '#070607', 'eye_glow': '#F7E8C8', 'iris': '#F7E8C8', 'brow': '#000'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.4, face_shadow=False, no_ears=True))
    H = P.H
    top = hp(P, 0, 0, 0.5)
    prof = [(0.36 * H, -0.12 * H), (0.3 * H, -0.06 * H), (0.22 * H, -0.01 * H), (0.12 * H, 0.03 * H), (0.04 * H, 0.05 * H)]

    def scallop(a, z):
        return 1.0 + 0.05 * np.abs(np.sin(a * 4)) * smooth(0.0, -0.1 * H, z) + 0.03 * np.sin(a * 13)
    g = M.lathe([(r, top[2] + z) for r, z in prof], centre=(0, 0, 0), n=64, rmod=scallop, cap1=top + V(0, 0, 0.055 * H))
    can = g.build('canopy')
    M.delete_faces(can, lambda Cc: ~((Cc[:, 2] < top[2] - 0.08 * H) & (np.sin(np.arctan2(Cc[:, 1], Cc[:, 0]) * 7 + 1.3) > 0.55)))
    M.finish(can, 0, thickness=0.006 * H, offset=0.0)
    M.finish(can, 1)
    C.add(can, 'canopy', 'head', line=0.9)
    ribs = []
    for i, a in enumerate(np.linspace(0, 2 * math.pi, 9)[:-1]):
        pts = [top + V(0, 0, 0.05 * H)] + [V(math.sin(a) * r, -math.cos(a) * r, top[2] + z - 0.004 * H) for r, z in prof[::-1][1:]]
        ribs.append(M.tube(pts, [0.004 * H] * len(pts), n=6, samples=12).build(f'rib{i}'))
    ribs.append(M.tube([top + V(0, 0, 0.09 * H), top - V(0, 0, 0.14 * H)], [0.006 * H, 0.006 * H], n=8, samples=4).build('shaft'))
    ro = M.merge(ribs, 'ribs')
    M.finish(ro, 1)
    C.add(ro, 'rib', 'head', line=0.5)
    for s in (1, -1):
        A.glow_spot(C, f'glow{s}', s * 0.15, -0.1, 0.07, 0.05, 'eye_glow')
    A.long_coat(C, 'coat', hem=P.z_ankle + 0.08 * H, open_front=0.04, tatters=0.04)
    A.pants(C, 'pants', r=(0.04, 0.032, 0.028, 0.026))
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'claw', fist=0.15)
    return C


def bride():
    """The Weeping Bride: a tall faceless figure in a white wedding kimono and hood, black hair falling."""
    P = A.Proportions(H=2.2, kind='female', build=0.95)
    C = A.Character('bride', {**EYES, 'skin': '#EDE6E2', 'hair': '#0D0B10', 'kimono': '#F1EEE8', 'hood': '#F6F4EF', 'obi': '#C9B48A',
                              'tears': '#151018', 'shoes': '#EDE6E2', 'sole': '#C8C0B8', 'iris': '#000', 'brow': '#000'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.4, width=0.9, face_shadow=False, no_ears=True))
    u = P.u
    surf = M.Surface(C.head_ob)
    for s in (1, -1):
        to3d = A.face_to3d(P, C.head, 0, 0.0, 0.0, 0.0)
        cur = np.array([[s * 0.16, -0.12], [s * 0.17, -0.3], [s * 0.155, -0.48], [s * 0.13, -0.58]])
        S2 = M.strip2d(cur, np.array([0.05, 0.04, 0.03, 0.012]), n=16)
        ob = M.decal(f'tear{s}', surf, to3d, S2, lift=0.004 * u)
        C.add(ob, 'tears', 'face', 'emissive', line=0.0, vcol=np.tile(C.col('tears'), (S2.shape[0] * S2.shape[1], 1)), ao=False)
    L = []
    for a in np.linspace(-54, 54, 7):
        L.append((a, 0.1, 1.7, 0.2, dict(hug=0.35, out=0.08, drop=1.0, tip=0.3, samples=18)))
    for a in np.linspace(90, 270, 11):
        L.append((a, 0.18, 3.9, 0.26, dict(hug=0.25, out=0.12, drop=1.0, tip=0.3, samples=20)))
    A.hair(C, L, A.hair_cap(C, front=0.22, temple=-0.1, back=-0.36, grow=0.06))
    A.hair_chain(C, hp(P, 0, 0.5, -0.3), hp(P, 0, 0.75, -4.0), n=3)
    A.hood(C, 'hood', grow=0.2, open_face=0.66)
    A.long_coat(C, 'kimono', hem=0.012 * P.H, open_front=0.0, wide_sleeves=0.06, drop=0.09, collar=False, grow=0.014)
    A.obi(C, 'obi', height=0.08, bow=True)
    A.hands(C, 'skin', fist=0.05)
    return C


def shiragami():
    """Shiragami, the Tachibana clan's paper god: a giant of folded paper with a painted mask."""
    P = A.Proportions(H=3.1, kind='male', build=1.25, head_scale=0.9)
    C = A.Character('shiragami', {**EYES, 'skin': '#EFEBE0', 'paper': '#EFEBE0', 'mask': '#F7F5EE', 'mask_mark': '#C3262C',
                                  'rope': '#C8B07A', 'talisman': '#E8DFC8', 'iris': '#000', 'brow': '#000'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.5, skin='paper', mid='paper', face_shadow=False, head_na=16, head_nt=10, no_ears=True))
    A.face_mask(C, 'mask', 'mask_mark')
    H = P.H
    # few faces on purpose: big flat facets read as folded paper
    A.skin_body(C, 'paper', grow=0.012, arm_r=(0.038, 0.034, 0.03), leg_r=(0.055, 0.045, 0.035), mid='paper', levels=0, flat=True, n=8)
    ro = M.torus((0, 0, P.z_hip + 0.08 * H), P.waist * 1.45, 0.016 * H, n=32, m=8).build('rope')
    M.finish(ro, 1)
    C.add(ro, 'rope', 'torsopart')
    tal = []
    for i, a in enumerate(np.linspace(-0.7, 0.7, 5)):
        c = V(math.sin(a) * P.waist * 1.5, -math.cos(a) * P.waist * 1.2, P.z_hip + 0.0 * H)
        tal.append(M.rbox(c, (0.02 * H, 0.003 * H, 0.05 * H), R=M.rot_xyz(0, 0, math.degrees(a)), round_=0.2).build(f'tal{i}'))
    to = M.merge(tal, 'talismans')
    C.add(to, 'talisman', 'torsopart', 'paper')
    A.hands(C, 'paper', fist=0.3, mid='paper')
    return C


def smooth(a, b, x):
    return M.smooth(a, b, x)


CAST = {'itsuki': itsuki, 'sayo': sayo, 'mikami': mikami, 'sojin': sojin, 'sojin_young': sojin_young, 'ryoga': ryoga,
        'mio': mio, 'hina': hina, 'kota': kota, 'acolyte': acolyte, 'mudhand': mudhand, 'umbrella': umbrella,
        'bride': bride, 'shiragami': shiragami}


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = argv[0].split(',') if argv and not argv[0].startswith('--') else ['itsuki']
    if names == ['all']:
        names = list(CAST)
    for name in names:
        core.reset()
        try:
            C = CAST[name]()
            arm, body = A.finish(C)
        except Exception:
            traceback.print_exc()
            print('FAILED', name)
            continue
        if '--preview' in argv:
            out = argv[argv.index('--preview') + 1].replace('.png', f'_{name}.png')
            A.preview(C, arm, out, os.environ.get('VIEWS', 'front,face3q,back'))
        if '--export' in argv:
            A.export(C, arm, body)
        if '--save' in argv:
            import bpy
            os.makedirs(core.RAW, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(core.RAW, f'{name}.blend'))
