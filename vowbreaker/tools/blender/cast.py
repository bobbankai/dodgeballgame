"""
The cast of Vowbreaker. blender -b -P vowbreaker/tools/blender/cast.py -- <name|all> [--preview out.png] [--export]

Every character is a spec: proportions, palette, face style, hair locks, outfit, accessories.
"""
import math
import os
import sys

import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import anime as A  # noqa: E402
import lib  # noqa: E402
import sdf  # noqa: E402
from sdf import V, cone, cylinder, ellipsoid, intersect, shell, subtract, torus, tube, union  # noqa: E402

EYES = {'eye_white': '#FAF6F0', 'eye_hi': '#FFFFFF', 'lash': '#1A1418', 'mouth': '#93453F'}


def locks(P, specs):
    return [A.lock_from(P, *s[:2], **s[2]) for s in specs]


def hair_part(C, fields, cap=None, below=1.3, wide=0.9, tris=16000, k=0.035):
    P = C.P
    parts = ([cap] if cap is not None else []) + fields
    f = union(*parts, k=k * P.u)
    lo, hi = A.hair_bounds(P, below=below, wide=wide)
    C.part('hair', f, lo, hi, P.u * 0.0085, 'hair', 'hair', tris, mid='hair', line=1.0)


def bell_charm(C, at, size=0.022, kind='torsopart'):
    """Mio's little brass bell on a red cord (Itsuki wears it at his belt)."""
    P = C.P
    H = P.H
    b = V(tuple(at))
    bell = union(ellipsoid(b, (size, size, size * 0.95)), cylinder(b + V((0, 0, -size * 0.55)), size * 1.02, size * 0.12, size * 0.05), k=size * 0.3)
    bell = subtract(bell, sdf.box(b + V((0, -size, -size * 0.35)), (size * 0.08, size * 0.6, size * 0.4)), k=0.001)
    C.part('bell', bell, b - V((0.05, 0.05, 0.05)), b + V((0.05, 0.05, 0.05)), size * 0.06, 'bell', kind, 900, mid='metal', line=0.5)
    cord = tube([b + V((0, 0, size)), b + V((0.004 * H, 0, size + 0.025 * H)), b + V((0.002 * H, 0.002 * H, size + 0.05 * H))],
                [0.0025 * H, 0.0025 * H, 0.0025 * H])
    C.part('cord', cord, b - V((0.06, 0.06, 0.06)), b + V((0.06, 0.06, 0.14)), 0.0012 * H, 'cord', kind, 300, line=0.4)


# ---------------------------------------------------------------------------------- Itsuki

def itsuki():
    P = A.Proportions(H=1.74, kind='male', build=1.0)
    C = A.Character('itsuki', {**EYES, 'skin': '#F2D0B4', 'hair': '#1F1B24', '_hair_tips': '#6B4234', 'iris': '#D08A2C',
                               'brow': '#1F1B24', 'jacket': '#191D2B', 'shirt': '#7C1F25', 'pants': '#191D2B', 'shoes': '#2B2420',
                               'sole': '#131111', 'button': '#C9A24A', 'bell': '#D9B24E', 'cord': '#B3262B', '_blush': 0.25}, P)
    A.build_head(C, dict(jaw=0.7, width=0.94, eye_w=0.088, eye_h=0.082, eye_tilt=9, brow_angle=12, lash=0.85, iris=0.74,
                         brow_w=1.15, mouth_w=0.07, smile=0.05, cheek=0.3))
    L = []
    # spiky fringe falling over the forehead, parted a little left of centre
    for th, ph, sw in ((-42, 44, -0.35), (-26, 50, -0.2), (-10, 54, -0.05), (6, 54, 0.1), (22, 50, 0.22), (38, 44, 0.35)):
        L.append((th, ph, dict(out=0.8, down=0.95, length=0.6, width=0.13, curl=0.05, flat=0.38, tip=0.03, side_swing=sw)))
    # side locks over the ears
    for th in (72, 96, -72, -96):
        L.append((th, 18, dict(out=0.55, down=0.85, length=0.5, width=0.12, flat=0.4, tip=0.04)))
    # the crown: big spikes sweeping back and out
    for i, th in enumerate(range(115, 250, 22)):
        ph = 28 + (i % 3) * 13
        L.append((th, ph, dict(out=1.0, down=0.22, length=0.5 + 0.06 * (i % 2), width=0.15, flat=0.42, tip=0.03)))
    for th in (40, 140, 220, 320, -10):
        L.append((th, 74, dict(out=1.0, down=0.08, length=0.36, width=0.15, flat=0.42, tip=0.04)))
    # nape spikes
    for th in (155, 180, 205):
        L.append((th, -2, dict(out=0.45, down=0.7, length=0.42, width=0.12, flat=0.4, tip=0.04)))
    hair_part(C, locks(P, L), cap=A.hair_cap(P, hairline_front=0.3, hairline_back=-0.42, grow=0.075))
    A.shirt(C, 'shirt', hood=True)
    A.jacket(C, 'jacket', open_front=0.045, buttons=None)
    A.pants(C, 'pants')
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.75)
    bell_charm(C, Vector((0.085 * P.H, -0.06 * P.H, P.z_hip + 0.02 * P.H)))
    return C



def hair_chain(C, top, bottom, n=2, prefix='hair'):
    """Spring bones for long hair: a chain from `top` to `bottom` (behind the head)."""
    top, bottom = V(tuple(top)), V(tuple(bottom))
    prev = 'head'
    for i in range(n):
        a = top + (bottom - top) * (i / n)
        b = top + (bottom - top) * ((i + 1) / n)
        name = f'{prefix}_{i + 1}'
        C.extra_bones.append((name, tuple(a), tuple(b), prev))
        prev = name


def long_back(P, length, width, n=7, spread=70, phi=-10, flat=0.3, curl=0.0):
    """A curtain of long straight hair down the back."""
    L = []
    for i in range(n):
        th = 180 - spread / 2 + spread * i / max(n - 1, 1)
        L.append((th, phi, dict(out=0.35, down=1.0, length=length, width=width, flat=flat, tip=0.25, curl=curl, segs=6)))
    return L


# ---------------------------------------------------------------------------------- Sayo

def sayo():
    P = A.Proportions(H=1.66, kind='female', build=1.0)
    C = A.Character('sayo', {**EYES, 'skin': '#F6DCC8', 'hair': '#15121A', 'iris': '#6B4F8A', 'brow': '#15121A', 'jacket': '#1A2036',
                             'skirt': '#1A2036', 'tights': '#14131A', 'shoes': '#221C1E', 'sole': '#111010', 'button': '#BFC3CC',
                             'ribbon': '#B3262B', 'pouch': '#9E2226', '_blush': 0.55}, P)
    A.build_head(C, dict(jaw=0.45, width=0.92, eye_w=0.092, eye_h=0.1, eye_tilt=10, brow_angle=4, lash=1.25, iris=0.75,
                         brow_w=0.8, mouth_w=0.06, smile=0.08, cheek=0.45))
    L = []
    # hime cut: blunt straight fringe ...
    for th in range(-44, 45, 11):
        L.append((th, 50, dict(out=0.75, down=0.85, length=0.56, width=0.11, flat=0.32, tip=0.6, segs=4)))
    # ... side locks cut at the jaw, then the long curtain to the waist
    for th in (66, 82, -66, -82):
        L.append((th, 20, dict(out=0.5, down=1.0, length=1.0, width=0.11, flat=0.32, tip=0.55, segs=5)))
    L += long_back(P, 2.9, 0.24, n=11, spread=160, phi=-5, flat=0.28)
    hair_part(C, locks(P, L), cap=A.hair_cap(P, hairline_front=0.3, hairline_back=-0.6, grow=0.06), below=4.0, wide=1.1, tris=20000)
    hair_chain(C, P.hp(0, 0.45, -0.3), P.hp(0, 0.7, -3.2), n=3)
    # a red ribbon tying the back
    C.part('ribbon', union(torus(P.hp(0, 0.5, -0.7), 0.1 * P.u, 0.035 * P.u, sdf.rot(80, 0, 0)),
                           ellipsoid(P.hp(0.14, 0.55, -0.65), P.hr(0.12, 0.04, 0.07)), ellipsoid(P.hp(-0.14, 0.55, -0.65), P.hr(0.12, 0.04, 0.07))),
           P.hp(-0.5, 0.2, -1.1), P.hp(0.5, 0.9, -0.3), P.u * 0.005, 'ribbon', 'hair', 1500)
    A.jacket(C, 'jacket', hem=P.z_hip + 0.04 * P.H, buttons='button')
    A.skirt(C, 'skirt', hem=P.z_knee - 0.1 * P.H, flare=1.0)
    A.tights(C, 'tights')
    A.shoes(C, 'shoes', 'sole', boot=0.12)
    A.hands(C, 'skin', fist=0.6)
    pc = V((-0.13 * P.H, -0.02 * P.H, P.z_hip + 0.04 * P.H))
    C.part('pouch', sdf.box(pc, (0.025 * P.H, 0.02 * P.H, 0.03 * P.H), 0.008 * P.H), pc - 0.1, pc + 0.1, 0.002 * P.H, 'pouch', 'torsopart', 900)
    return C


# ---------------------------------------------------------------------------------- Mikami

def mikami():
    P = A.Proportions(H=1.86, kind='male', build=1.04)
    C = A.Character('mikami', {**EYES, 'skin': '#EDCBAF', 'hair': '#2A2A30', '_hair_tips': '#55555E', 'iris': '#6C8DA6', 'brow': '#2A2A30',
                               'coat': '#2B2D33', 'shirt': '#16171C', 'pants': '#1E1F24', 'shoes': '#1C1714', 'sole': '#0F0D0C',
                               'mask': '#F2EEE6', 'mask_mark': '#C2262B', '_blush': 0.1}, P)
    A.build_head(C, dict(jaw=0.85, width=0.92, eye_w=0.082, eye_h=0.066, eye_tilt=2, brow_angle=-3, lash=0.8, iris=0.7,
                         brow_w=1.2, mouth_w=0.075, smile=0.0, cheek=0.2, brow_ridge=0.6))
    L = []
    for th, ph, sw in ((-36, 48, -0.3), (-18, 54, -0.15), (0, 56, 0.0), (18, 52, 0.25), (34, 46, 0.4)):
        L.append((th, ph, dict(out=0.7, down=0.9, length=0.58, width=0.12, flat=0.38, tip=0.05, side_swing=sw)))
    for th in (70, 92, -70, -92, 120, -120):
        L.append((th, 15, dict(out=0.5, down=0.9, length=0.55, width=0.12, flat=0.4, tip=0.08)))
    for th in range(130, 240, 25):
        L.append((th, 40, dict(out=0.8, down=0.6, length=0.5, width=0.14, flat=0.42, tip=0.06)))
    # a short low ponytail
    L.append((180, -20, dict(out=0.5, down=1.0, length=1.2, width=0.12, flat=0.55, tip=0.2, segs=5)))
    hair_part(C, locks(P, L), cap=A.hair_cap(P, hairline_front=0.3, hairline_back=-0.5, grow=0.065), below=2.0)
    hair_chain(C, P.hp(0, 0.5, -0.6), P.hp(0, 0.75, -1.7), n=2)
    A.shirt(C, 'shirt', top=P.neck_base + 0.035 * P.H)
    A.long_coat(C, 'coat', hem=P.z_knee - 0.06 * P.H, open_front=0.05)
    A.pants(C, 'pants')
    A.shoes(C, 'shoes', 'sole', boot=0.1)
    A.hands(C, 'skin', fist=0.55)
    # the fox mask hanging at his hip
    mc = V((0.16 * P.H, -0.06 * P.H, P.z_hip + 0.0 * P.H))
    u = P.u * 0.8
    m = union(ellipsoid(mc, (0.32 * u, 0.1 * u, 0.42 * u)), sdf.mirror_x(cone(tuple(mc + V((0.12 * u, 0, 0.3 * u))), tuple(mc + V((0.25 * u, 0.02 * u, 0.6 * u))), 0.09 * u, 0.01 * u)), k=0.04 * u)
    m = union(m, ellipsoid(mc + V((0, -0.12 * u, -0.15 * u)), (0.12 * u, 0.12 * u, 0.14 * u)), k=0.05 * u)
    C.part('foxmask', m, mc - 0.25, mc + 0.25, 0.003 * P.H, 'mask', 'torsopart', 2000, mid='paper', line=0.8)
    return C


# ---------------------------------------------------------------------------------- Sojin

def sojin(young=False):
    P = A.Proportions(H=1.82 if not young else 1.78, kind='male', build=1.1 if not young else 1.0)
    name = 'sojin_young' if young else 'sojin'
    C = A.Character(name, {**EYES, 'skin': '#E9C6A6' if not young else '#EFCCAE', 'hair': '#18161B', 'iris': '#C9AE58' if not young else '#5A3E2A',
                           'brow': '#18161B', 'robe': '#1B1A26' if not young else '#25402F', 'kesa': '#7B2A1C', 'beads': '#5A3A22',
                           'hakama': '#3A3A44', 'shirt': '#E8E2D4', 'shoes': '#2A221C', 'sole': '#141010', 'obi': '#22202A', '_blush': 0.1}, P)
    A.build_head(C, dict(jaw=0.9, width=0.95, eye_w=0.08, eye_h=0.07 if not young else 0.08, eye_tilt=4, brow_angle=10, lash=0.8,
                         iris=0.62, brow_w=1.4, mouth_w=0.08, smile=-0.08 if not young else 0.06, cheek=0.15, brow_ridge=1.0 if not young else 0.3))
    if young:
        L = []
        for th, ph, sw in ((-30, 52, -0.2), (-10, 58, -0.05), (10, 58, 0.05), (30, 52, 0.2)):
            L.append((th, ph, dict(out=0.75, down=0.75, length=0.45, width=0.12, flat=0.38, tip=0.06, side_swing=sw)))
        for th in (75, -75, 105, -105, 140, 180, 220):
            L.append((th, 25, dict(out=0.55, down=0.7, length=0.42, width=0.13, flat=0.4, tip=0.06)))
        hair_part(C, locks(P, L), cap=A.hair_cap(P, hairline_front=0.3, hairline_back=-0.45, grow=0.06))
    else:
        # shaved head: a faint stubble cap; a short beard and moustache
        cap = A.hair_cap(P, hairline_front=0.25, hairline_back=-0.5, grow=0.004)
        bf = []
        u = P.u
        for x, z0, z1 in ((0.0, -0.46, -0.66), (0.09, -0.44, -0.6), (-0.09, -0.44, -0.6), (0.17, -0.36, -0.5), (-0.17, -0.36, -0.5)):
            bf.append(cone(tuple(P.hp(x, -0.4 + abs(x) * 0.5, z0)), tuple(P.hp(x * 1.1, -0.42 + abs(x) * 0.5, z1)), 0.07 * u, 0.02 * u))
        stache = A.flat_lock([P.hp(-0.13, -0.47, -0.33), P.hp(0, -0.5, -0.3), P.hp(0.13, -0.47, -0.33)], [0.02 * u, 0.035 * u, 0.02 * u], 0.5)
        hair_part(C, bf + [stache], cap=cap, below=1.2, tris=9000, k=0.03)
    if young:
        A.shirt(C, 'shirt', top=P.neck_base + 0.02 * P.H)
        A.long_coat(C, 'robe', hem=P.z_hip - 0.12 * P.H, open_front=0.03, wide_sleeves=0.02)
        A.skirt(C, 'hakama', top=P.z_hip + 0.08 * P.H, hem=P.z_ankle + 0.03 * P.H, flare=0.9, pleats=8)
        A.obi(C, 'obi', z=P.z_hip + 0.08 * P.H, height=0.04, bow=False)
    else:
        A.long_coat(C, 'robe', hem=P.z_ankle + 0.03 * P.H, open_front=0.0, wide_sleeves=0.045, grow=0.024)
        ref = P.torso_field(0.05 * P.H)
        A.sash(C, 'kesa', 'kesa', ref, (0.1 * P.H, 0, P.z_sh + 0.01 * P.H), (-0.12 * P.H, 0, P.z_hip - 0.05 * P.H), 0.06 * P.H, thick=0.008)
        A.beads(C, 'beads', (0, -0.01 * P.H, P.neck_base - 0.035 * P.H), 0.085 * P.H, 22, 0.012 * P.H, tilt=(-25, 0, 0))
    A.pants(C, 'hakama' if young else 'robe', r=(0.05, 0.042, 0.04))
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
    A.build_head(C, dict(jaw=0.75, width=0.93, eye_w=0.09, eye_h=0.08, eye_tilt=12, brow_angle=14, lash=1.0, iris=0.72,
                         brow_w=0.95, mouth_w=0.065, smile=-0.04, cheek=0.25))
    L = []
    # undercut: a long top swept across to his right, covering the right eye
    for th, ph in ((-40, 60), (-20, 66), (0, 70), (20, 66), (40, 60), (60, 52)):
        L.append((th, ph, dict(out=0.85, down=0.8, length=0.75, width=0.14, flat=0.35, tip=0.03, side_swing=-0.75)))
    for th in range(100, 260, 30):
        L.append((th, 55, dict(out=0.9, down=0.3, length=0.4, width=0.14, flat=0.4, tip=0.04)))
    hair_part(C, locks(P, L), cap=A.hair_cap(P, hairline_front=0.35, hairline_back=-0.3, sides=0.05, grow=0.03))
    A.shirt(C, 'shirt', top=P.neck_base + 0.02 * P.H)
    A.jacket(C, 'jacket', buttons='button')
    A.pants(C, 'pants')
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.75)
    e = V(tuple(P.hp(-0.44, 0.03, -0.3)))
    C.part('earring', torus(e, 0.02 * P.u, 0.007 * P.u, sdf.rot(0, 90, 0)), e - 0.05, e + 0.05, 0.0008, 'earring', 'head', 300, mid='metal', line=0.3)
    return C


# ---------------------------------------------------------------------------------- the children

def mio():
    P = A.Proportions(H=1.26, kind='child')
    C = A.Character('mio', {**EYES, 'skin': '#F8DECB', 'hair': '#3A2622', 'iris': '#7B4A2A', 'brow': '#3A2622', 'shirt': '#F3F0EA',
                            'dress': '#22305A', 'socks': '#F2F0EC', 'shoes': '#B32A2E', 'sole': '#3A1414', 'bag': '#C0262C',
                            'bell': '#D9B24E', 'cord': '#B3262B', 'ribbon': '#F2C84A', '_blush': 0.8}, P)
    A.build_head(C, dict(jaw=0.15, width=1.02, eye_w=0.1, eye_h=0.12, eye_tilt=-2, brow_angle=-4, lash=1.0, iris=0.78,
                         brow_w=0.7, mouth_w=0.05, smile=0.25, cheek=0.85))
    L = []
    for th in range(-40, 41, 13):
        L.append((th, 50, dict(out=0.75, down=0.8, length=0.48, width=0.12, flat=0.35, tip=0.5)))
    for th in (65, 85, 110, -65, -85, -110, 140, 165, 195, 220):
        L.append((th, 12, dict(out=0.5, down=0.95, length=0.6, width=0.14, flat=0.35, tip=0.5)))
    # two short pigtails tied above the ears
    for s in (1, -1):
        L.append((s * 100, 40, dict(out=1.0, down=0.9, length=0.75, width=0.16, flat=0.5, tip=0.2, segs=5)))
    hair_part(C, locks(P, L), cap=A.hair_cap(P, hairline_front=0.28, hairline_back=-0.55, grow=0.06), below=1.6, wide=1.1)
    for s in (1, -1):
        c = V(tuple(P.hp(s * 0.5, 0.05, 0.28)))
        C.part(f'tie_{"L" if s > 0 else "R"}', sdf.sphere(c, 0.05 * P.u), c - 0.05, c + 0.05, 0.0012, 'ribbon', 'hair', 300)
    A.shirt(C, 'shirt', top=P.neck_base + 0.012 * P.H, bottom=P.z_hip + 0.1 * P.H)
    A.jacket(C, 'shirt', hem=P.z_hip + 0.12 * P.H, collar=None, buttons=None, tris=8000)
    A.skirt(C, 'dress', top=P.z_hip + 0.2 * P.H, hem=P.z_knee + 0.02 * P.H, flare=1.1, pleats=10)
    A.tights(C, 'socks', top=P.z_knee + 0.04 * P.H)
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.35)
    # the red school backpack with the little bell
    bc = V((0, 0.1 * P.H, P.z_hip + 0.2 * P.H))
    C.part('randoseru', sdf.box(bc, (0.12 * P.H, 0.06 * P.H, 0.13 * P.H), 0.03 * P.H), bc - 0.25, bc + 0.25, 0.003 * P.H, 'bag', 'torsopart', 2000)
    bell_charm(C, bc + V((0.1 * P.H, 0.02 * P.H, -0.1 * P.H)), size=0.016)
    return C


def hina():
    P = A.Proportions(H=1.1, kind='child', head_scale=1.05)
    C = A.Character('hina', {**EYES, 'skin': '#F9E0CC', 'hair': '#1E1820', 'iris': '#4A2E22', 'brow': '#1E1820', 'yukata': '#2B3D78',
                             'obi': '#D8902E', 'shoes': '#8A5A34', 'sole': '#3A2A1A', 'flower': '#F09AB8', '_blush': 0.9}, P)
    A.build_head(C, dict(jaw=0.1, width=1.04, eye_w=0.105, eye_h=0.125, eye_tilt=-3, brow_angle=-6, lash=0.95, iris=0.8,
                         brow_w=0.65, mouth_w=0.045, smile=0.35, cheek=0.95))
    L = []
    for th in range(-42, 43, 12):
        L.append((th, 50, dict(out=0.75, down=0.75, length=0.45, width=0.12, flat=0.35, tip=0.6)))
    for th in (60, 80, 100, 125, 150, 180, 210, 235, 260, 280, 300):
        L.append((th, 10, dict(out=0.5, down=0.9, length=0.55, width=0.15, flat=0.35, tip=0.55)))
    hair_part(C, locks(P, L), cap=A.hair_cap(P, hairline_front=0.28, hairline_back=-0.6, grow=0.06), below=1.4, wide=1.0)
    fc = V(tuple(P.hp(0.38, -0.05, 0.3)))
    petals = [sdf.sphere(fc + V((math.cos(a) * 0.05 * P.u, -0.02 * P.u, math.sin(a) * 0.05 * P.u)), 0.045 * P.u) for a in np.linspace(0, 2 * math.pi, 6)[:-1]]
    C.part('flower', union(*petals, k=0.01 * P.u), fc - 0.06, fc + 0.06, 0.0012, 'flower', 'hair', 600)
    A.long_coat(C, 'yukata', hem=P.z_ankle + 0.04 * P.H, open_front=0.0, wide_sleeves=0.05, collar=False, grow=0.02)
    A.obi(C, 'obi', height=0.07)
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.3)
    return C


def kota():
    P = A.Proportions(H=1.2, kind='child')
    C = A.Character('kota', {**EYES, 'skin': '#F6DCC6', 'hair': '#1A161C', 'iris': '#5A4A6E', 'brow': '#1A161C', 'robe': '#EEEAE0',
                             'pants': '#6A6A74', 'shoes': '#3A3036', 'sole': '#1A1416', 'obi': '#5A5A66', '_blush': 0.7}, P)
    A.build_head(C, dict(jaw=0.15, width=1.0, eye_w=0.098, eye_h=0.11, eye_tilt=0, brow_angle=-2, lash=0.8, iris=0.76,
                         brow_w=0.8, mouth_w=0.05, smile=0.15, cheek=0.8))
    L = []
    for th in range(-36, 37, 12):
        L.append((th, 54, dict(out=0.75, down=0.7, length=0.42, width=0.13, flat=0.38, tip=0.1)))
    for th in range(70, 300, 30):
        L.append((th, 25, dict(out=0.6, down=0.6, length=0.38, width=0.14, flat=0.4, tip=0.1)))
    hair_part(C, locks(P, L), cap=A.hair_cap(P, hairline_front=0.3, hairline_back=-0.45, grow=0.06))
    A.long_coat(C, 'robe', hem=P.z_knee - 0.02 * P.H, open_front=0.0, wide_sleeves=0.02, collar=False)
    A.obi(C, 'obi', height=0.04, bow=False)
    A.pants(C, 'pants')
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.3)
    return C


# ---------------------------------------------------------------------------------- acolytes

def acolyte():
    P = A.Proportions(H=1.76, kind='male', build=1.0)
    C = A.Character('acolyte', {**EYES, 'skin': '#E7D2C0', 'robe': '#E6E2D8', 'hood': '#D8D2C4', 'mask': '#F4F1EA', 'mask_mark': '#C3262C',
                                'pants': '#CFC9BC', 'shoes': '#2A2422', 'sole': '#141010', 'obi': '#7A2A22', 'hair': '#111', 'brow': '#111'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.6, face_shadow=False))
    A.face_mask(C, 'mask', 'mask_mark')
    hood = subtract(shell(A.ellipsoid(P.hp(0, 0.06, 0.0), P.hr(0.58, 0.6, 0.62)), 0.06 * P.u), A.ellipsoid(P.hp(0, -0.55, -0.2), P.hr(0.42, 0.4, 0.55)), k=0.02 * P.u)
    hood = intersect(hood, lambda Pq: (P.z_chin - 0.06 * P.H) - Pq[:, 2])
    C.part('hood', hood, P.hp(-0.8, -0.8, -1.2), P.hp(0.8, 0.8, 0.8), P.u * 0.008, 'hood', 'head', 5000)
    A.long_coat(C, 'robe', hem=P.z_ankle + 0.05 * P.H, open_front=0.0, wide_sleeves=0.04)
    A.obi(C, 'obi', height=0.035, bow=False)
    A.pants(C, 'pants')
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'skin', fist=0.6)
    return C


# ---------------------------------------------------------------------------------- curses

def mudhand():
    """A crawling grief-curse: a lumpy tar body, extra hands growing out of its back, one eye."""
    P = A.Proportions(H=1.55, kind='male', build=1.25)
    C = A.Character('mudhand', {**EYES, 'skin': '#2A1F2E', 'tar': '#241A2A', 'eye_glow': '#F0D24A', 'claw': '#14101A', 'iris': '#F0D24A',
                                'brow': '#000000'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.3, width=1.15, skin='tar', mid='cloth', face_shadow=False, tris=5000))
    H = P.H

    def lumps(Pq):
        return 0.02 * H * (sdf.noise(Pq, 9.0, 3) - 0.5) + 0.012 * H * (sdf.noise(Pq, 22.0, 5) - 0.5)
    body = sdf.displace(union(P.torso_field(0.03 * H), *[P.arm_field(s, r=(0.04, 0.036, 0.03)) for s in (1, -1)],
                              *[P.leg_field(s, r=(0.06, 0.045, 0.035)) for s in (1, -1)], k=0.05 * H), lumps)
    C.part('body', body, V((-0.6 * H, -0.3 * H, 0)), V((0.6 * H, 0.35 * H, P.neck_base + 0.05 * H)), 0.006 * H, 'tar', 'body', 16000)
    # hands reaching out of its back
    extra = []
    for i, (x, z, a) in enumerate(((0.1, 0.72, 30), (-0.12, 0.66, -40), (0.02, 0.6, 5), (0.16, 0.56, 60))):
        root = V((x * H, 0.06 * H, z * H))
        tip = root + V((math.sin(math.radians(a)) * 0.18 * H, 0.16 * H, 0.1 * H))
        extra.append(cone(root, tip, 0.03 * H, 0.018 * H))
        for f in range(4):
            fa = math.radians(a - 30 + f * 20)
            extra.append(cone(tip, tip + V((math.sin(fa) * 0.06 * H, 0.04 * H, math.cos(fa) * 0.05 * H)), 0.008 * H, 0.004 * H))
    C.part('backhands', union(*extra, k=0.01 * H), V((-0.5 * H, -0.1 * H, 0.4 * H)), V((0.5 * H, 0.5 * H, 1.1 * H)), 0.0035 * H, 'tar', 'torsopart', 6000)
    eye = V(tuple(P.hp(0, -0.42, -0.05)))
    C.part('bigeye', ellipsoid(eye, P.hr(0.2, 0.06, 0.14)), eye - 0.1, eye + 0.1, 0.002, 'eye_glow', 'head', 900, mid='emissive', line=0.0)
    A.hands(C, 'claw', fist=0.1)
    return C


def umbrella():
    """Red Umbrella: a tall thin curse in a tattered coat, its head a torn red umbrella."""
    P = A.Proportions(H=2.35, kind='male', build=0.82, head_scale=0.8)
    C = A.Character('umbrella', {**EYES, 'skin': '#1A1418', 'coat': '#141218', 'canopy': '#B01E24', 'rib': '#2A2228', 'claw': '#0E0B10',
                                 'pants': '#141218', 'shoes': '#0E0B10', 'sole': '#070607', 'eye_glow': '#F7E8C8', 'iris': '#F7E8C8', 'brow': '#000'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.4, face_shadow=False, tris=3000))
    H = P.H
    top = V(tuple(P.hp(0, 0, 0.6)))
    canopy = sdf.revolve([(0.36 * H, -0.02 * H), (0.25 * H, 0.06 * H), (0.1 * H, 0.11 * H), (0.01 * H, 0.13 * H)], c=tuple(top - V((0, 0, 0.12 * H))), depth=1.0,
                         rmod=lambda th, z: 1.0 + 0.06 * np.abs(np.sin(th * 4)) - 0.05 * (np.sin(th * 13) > 0.85))
    canopy = intersect(shell(canopy, 0.008 * H), lambda Pq: Pq[:, 2] - (top[2] + 0.03 * H))
    C.part('canopy', canopy, top - V((0.5, 0.5, 0.35)) * H / 1.6, top + V((0.5, 0.5, 0.1)) * H / 1.6, 0.004 * H, 'canopy', 'head', 6000, line=0.9)
    ribs = [tube([top + V((0, 0, 0.03 * H)), top + V((math.cos(a) * 0.2 * H, math.sin(a) * 0.2 * H, -0.04 * H)), top + V((math.cos(a) * 0.36 * H, math.sin(a) * 0.36 * H, -0.12 * H))],
                 [0.004 * H, 0.004 * H, 0.003 * H]) for a in np.linspace(0, 2 * math.pi, 9)[:-1]]
    shaft = cone(top + V((0, 0, 0.06 * H)), top - V((0, 0, 0.18 * H)), 0.006 * H, 0.006 * H)
    C.part('ribs', union(*ribs, shaft), top - V((0.5, 0.5, 0.4)) * H / 1.6, top + V((0.5, 0.5, 0.2)) * H / 1.6, 0.0025 * H, 'rib', 'head', 3000, line=0.5)
    eyes = [ellipsoid(V(tuple(P.hp(s * 0.15, -0.42, -0.05))), P.hr(0.07, 0.03, 0.05)) for s in (1, -1)]
    C.part('glow', union(*eyes), P.hp(-0.5, -0.8, -0.4), P.hp(0.5, 0.0, 0.3), 0.0015, 'eye_glow', 'head', 400, mid='emissive', line=0.0)

    def tatters(th, z):
        return 1.0 + 0.08 * smooth01(P.z_knee, P.z_ankle, z) * np.sin(th * 7)
    A.long_coat(C, 'coat', hem=P.z_ankle + 0.08 * H, open_front=0.04)
    A.pants(C, 'pants', r=(0.04, 0.032, 0.026))
    A.shoes(C, 'shoes', 'sole')
    A.hands(C, 'claw', fist=0.15)
    return C


def bride():
    """The Weeping Bride: a tall faceless figure in a white wedding kimono and hood, black hair falling."""
    P = A.Proportions(H=2.2, kind='female', build=0.95)
    C = A.Character('bride', {**EYES, 'skin': '#EDE6E2', 'hair': '#0D0B10', 'kimono': '#F1EEE8', 'hood': '#F6F4EF', 'obi': '#C9B48A',
                              'tears': '#151018', 'shoes': '#EDE6E2', 'sole': '#C8C0B8', 'iris': '#000', 'brow': '#000'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.4, width=0.9, face_shadow=False))
    u = P.u
    tears = [A.flat_lock([P.hp(s * 0.16, -0.43, -0.1), P.hp(s * 0.17, -0.42, -0.3), P.hp(s * 0.15, -0.36, -0.6)], [0.025 * u, 0.02 * u, 0.012 * u], 0.4) for s in (1, -1)]
    C.part('tears', union(*tears), P.hp(-0.5, -0.8, -0.9), P.hp(0.5, -0.1, 0.2), u * 0.004, 'tears', 'face', 800, mid='emissive', line=0.0)
    L = []
    for th in range(-50, 51, 20):
        L.append((th, 45, dict(out=0.65, down=1.0, length=1.6, width=0.13, flat=0.35, tip=0.3, segs=6)))
    L += long_back(P, 3.8, 0.18, n=7, spread=160, phi=0)
    hair_part(C, locks(P, L), cap=A.hair_cap(P, hairline_front=0.35, hairline_back=-0.5, grow=0.06), below=5.0, wide=1.2, tris=16000)
    hair_chain(C, P.hp(0, 0.45, -0.3), P.hp(0, 0.7, -4.0), n=3)
    hood = subtract(shell(A.ellipsoid(P.hp(0, 0.1, 0.25), P.hr(0.7, 0.72, 0.6)), 0.06 * u), A.ellipsoid(P.hp(0, -0.7, -0.1), P.hr(0.5, 0.45, 0.6)), k=0.03 * u)
    C.part('wataboshi', hood, P.hp(-1.0, -1.0, -0.6), P.hp(1.0, 1.0, 1.0), u * 0.008, 'hood', 'head', 6000)
    A.long_coat(C, 'kimono', hem=0.012 * P.H, open_front=0.0, wide_sleeves=0.08, collar=False, grow=0.025)
    A.obi(C, 'obi', height=0.08, bow=True)
    A.hands(C, 'skin', fist=0.05)
    return C


def shiragami():
    """Shiragami, the Tachibana clan's paper god: a giant of folded paper with a painted mask."""
    P = A.Proportions(H=3.1, kind='male', build=1.25, head_scale=0.9)
    C = A.Character('shiragami', {**EYES, 'skin': '#EFEBE0', 'paper': '#EFEBE0', 'mask': '#F7F5EE', 'mask_mark': '#C3262C',
                                  'rope': '#C8B07A', 'talisman': '#E8DFC8', 'iris': '#000', 'brow': '#000'}, P)
    A.build_head(C, dict(faceless=True, jaw=0.5, skin='paper', mid='paper', face_shadow=False, tris=1500))
    A.face_mask(C, 'mask', 'mask_mark')
    H = P.H
    body = union(P.torso_field(0.02 * H), *[P.arm_field(s, r=(0.038, 0.034, 0.03)) for s in (1, -1)],
                 *[P.leg_field(s, r=(0.055, 0.045, 0.035)) for s in (1, -1)], k=0.03 * H)
    # few triangles on purpose: big flat facets read as folded paper
    C.part('body', body, V((-0.7 * H, -0.3 * H, 0)), V((0.7 * H, 0.3 * H, P.neck_base + 0.05 * H)), 0.008 * H, 'paper', 'body', 2200, mid='paper', symmetric=True)
    C.part('rope', torus((0, 0, P.z_hip + 0.08 * H), P.waist * 1.3, 0.016 * H), V((-0.4 * H, -0.4 * H, P.z_hip)), V((0.4 * H, 0.4 * H, P.z_hip + 0.2 * H)),
           0.003 * H, 'rope', 'torsopart', 2000)
    tals = []
    for i, a in enumerate(np.linspace(-0.6, 0.6, 5)):
        c = V((math.sin(a) * P.waist * 1.35, -math.cos(a) * P.waist * 1.1, P.z_hip + 0.02 * H))
        tals.append(sdf.box(c, (0.02 * H, 0.004 * H, 0.05 * H), 0.002 * H, sdf.rot(0, 0, math.degrees(a))))
    C.part('talismans', union(*tals), V((-0.4 * H, -0.4 * H, P.z_hip - 0.1 * H)), V((0.4 * H, 0.4 * H, P.z_hip + 0.1 * H)), 0.002 * H, 'talisman', 'torsopart', 1500, mid='paper')
    A.hands(C, 'paper', fist=0.3)
    return C


def smooth01(a, b, x):
    return sdf.smooth01(a, b, x)


CAST = {'itsuki': itsuki, 'sayo': sayo, 'mikami': mikami, 'sojin': sojin, 'sojin_young': sojin_young, 'ryoga': ryoga,
        'mio': mio, 'hina': hina, 'kota': kota, 'acolyte': acolyte, 'mudhand': mudhand, 'umbrella': umbrella,
        'bride': bride, 'shiragami': shiragami}



if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = argv[0].split(',') if argv else ['itsuki']
    if names == ['all']:
        names = list(CAST)
    import traceback
    for name in names:
        lib.reset()
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
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(A.ROOT, '..', 'assets-raw', 'vowbreaker', f'{name}.blend'))
