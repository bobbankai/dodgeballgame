"""Weapons of the Ashen Kingdom's legions (same construction as sword.py).

  /opt/bvenv/bin/python eclipse/tools/blender/ashen_weapons.py [ashblade cinder_greatsword ...]

  ashblade           a thrall's old arming sword: notched, pitted and rusted, a plain bar guard, a
                     grip wound with charred cloth and a wheel pommel
  cinder_greatsword  the Cinder Knights' greatsword: a long, heavy blackened blade whose fuller has
                     split open on the fire inside, a ricasso, drooping quillons and a long grip

Grip at the origin, blade along +Y in the game (sculpted along +Z here).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np

import sdf
import bake
import gearmat
from armor import Piece, MAT_INDEX, low_poly
from common import reset, ASSETS, WORK, export_glb, color_attribute, verts_np

OUT = os.path.join(ASSETS, 'weapons')
os.makedirs(OUT, exist_ok=True)


def edge_nicks(p, half_w, seed, depth=0.006, freq=40):
    """Chips taken out of both edges: a ragged offset of the edge line."""
    n = sdf.fbm(np.column_stack([p[:, 2] * freq, np.sign(p[:, 0]) * 3, np.zeros(len(p))]), 1.0, 3, seed)
    return depth * np.clip((n - 0.45) * 3, 0, 1)


def ashblade():
    L = 0.78
    grip = 0.2

    def blade(p):
        z = p[:, 2]
        t = np.clip((z - 0.05) / L, 0, 1)
        half_w = 0.024 * (1 - t ** 2.2) + 0.004
        half_w = half_w - edge_nicks(p, half_w, 3)
        thick = 0.005 * (1 - 0.5 * t)
        prof = np.abs(p[:, 1]) - thick * np.clip(1 - (p[:, 0] / np.maximum(half_w, 1e-3)) ** 2, 0, 1)
        pits = 0.0008 * (sdf.fbm(p, 120, 2, 5) > 0.7)
        d = np.maximum(prof + pits, np.abs(p[:, 0]) - half_w)
        tip = (z - (0.05 + L)) + np.abs(p[:, 0]) * 1.6
        return np.maximum(np.maximum(d, tip), 0.045 - z)

    def guard(p):
        return sdf.box((0, 0, 0.038), (0.085, 0.011, 0.009), 0.004)(p)

    def handle(p):
        z = p[:, 2]
        r = np.hypot(p[:, 0], p[:, 1] * 1.15)
        wrap = 0.0018 * np.sin(z * 260 + np.arctan2(p[:, 1], p[:, 0])) + 0.0012 * (sdf.fbm(p, 60, 2, 7) - 0.5)
        return np.maximum(r - (0.015 + wrap), np.maximum(z - 0.03, -grip - z))

    def pommel(p):
        c = np.array([0.0, 0.0, -grip - 0.02])
        return sdf.cylinder(c + (0, -0.013, 0), c + (0, 0.013, 0), 0.026)(p) - 0.002

    def field(p):
        return np.minimum(np.minimum(blade(p), guard(p)), np.minimum(handle(p), pommel(p)))

    def mats(p):
        m = np.full(len(p), MAT_INDEX['rust'])
        z = p[:, 2]
        m[(z < 0.032) & (z > -grip - 0.002)] = MAT_INDEX['charcloth']
        # the edges were kept sharp: bright steel along them
        t = np.clip((z - 0.05) / L, 0, 1)
        half_w = 0.024 * (1 - t ** 2.2) + 0.004
        m[(z > 0.05) & (np.abs(p[:, 0]) > half_w - 0.005)] = MAT_INDEX['steel']
        m[np.abs(pommel(p)) < 0.004] = MAT_INDEX['darksteel']
        return m

    return Piece('ashblade', field, (np.array([-0.1, -0.03, -grip - 0.05]), np.array([0.1, 0.03, 0.05 + L + 0.01])),
                 mats, skin=None, voxel=0.0015, budget=3500)


def cinder_greatsword():
    L = 1.32
    grip = 0.3

    def blade(p):
        z = p[:, 2]
        t = np.clip((z - 0.14) / L, 0, 1)
        half_w = 0.046 * (1 - t ** 3) + 0.006
        thick = 0.0085 * (1 - 0.5 * t)
        fuller = 0.0035 * np.exp(-(p[:, 0] / 0.012) ** 2) * (t < 0.75)
        prof = np.abs(p[:, 1]) - (thick * np.clip(1 - (p[:, 0] / half_w) ** 2, 0, 1) - fuller)
        d = np.maximum(prof, np.abs(p[:, 0]) - half_w)
        tip = (z - (0.14 + L)) + np.abs(p[:, 0]) * 1.3
        blade_d = np.maximum(np.maximum(d, tip), 0.14 - z)
        # ricasso: a narrow, thick unsharpened section above the guard with parrying lugs
        ric = sdf.box((0, 0, 0.1), (0.022, 0.009, 0.05), 0.003)(p)
        lugs = np.minimum(sdf.sphere((0.042, 0, 0.145), 0.012)(p), sdf.sphere((-0.042, 0, 0.145), 0.012)(p))
        return np.minimum(np.minimum(blade_d, ric), lugs)

    def guard(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        droop = -0.045 * (np.abs(x) / 0.17) ** 2
        bar = sdf.capsule((-0.17, 0, 0.045), (0.17, 0, 0.045), 0.014, 0.014)(np.column_stack([x, y, z - droop]))
        block = sdf.box((0, 0, 0.045), (0.035, 0.022, 0.02), 0.005)(p)
        ends = np.minimum(sdf.sphere((-0.175, 0, 0.0), 0.02)(p), sdf.sphere((0.175, 0, 0.0), 0.02)(p))
        return np.minimum(np.minimum(bar, block), ends)

    def handle(p):
        z = p[:, 2]
        r = np.hypot(p[:, 0], p[:, 1] * 1.1)
        ridge = 0.0025 * np.exp(-((np.mod(z, 0.03) - 0.015) / 0.004) ** 2)
        return np.maximum(r - (0.019 + ridge), np.maximum(z - 0.03, -grip - z))

    def pommel(p):
        c = np.array([0.0, 0.0, -grip - 0.03])
        return sdf.ellipsoid(c, (0.034, 0.026, 0.04))(p)

    def field(p):
        return np.minimum(np.minimum(blade(p), guard(p)), np.minimum(handle(p), pommel(p)))

    def mats(p):
        m = np.full(len(p), MAT_INDEX['darksteel'])
        z = p[:, 2]
        m[(z < 0.025) & (z > -grip - 0.002)] = MAT_INDEX['darkleather']
        t = (z - 0.14) / L
        # the fuller has cracked open on the fire inside; more cracks run out toward the edges
        crack = np.abs(p[:, 0] + 0.004 * np.sin(z * 55)) < 0.0045
        m[(t > 0.04) & (t < 0.72) & crack] = MAT_INDEX['ember']
        side = (np.abs(sdf.fbm(p, 9, 4, 13) - 0.5) < 0.014) & (t > 0.0) & (t < 0.9)
        m[side] = MAT_INDEX['ember']
        m[np.abs(guard(p)) < 0.005] = MAT_INDEX['rust']
        return m

    return Piece('cinder_greatsword', field, (np.array([-0.21, -0.04, -grip - 0.08]), np.array([0.21, 0.04, 0.14 + L + 0.01])),
                 mats, skin=None, voxel=0.0018, budget=5000)


def cinderfall():
    """Ignaroth's sword: the Cinder Knights' pattern, but kingly - a gilt guard and pommel, and the
    whole blade veined with the fire it was forged in."""
    pc = cinder_greatsword()
    base_mats = pc.materials

    def mats(p):
        m = base_mats(p)
        z = p[:, 2]
        veins = (np.abs(sdf.fbm(p, 14, 4, 17) - 0.5) < 0.02) & (z > 0.16)
        m[veins] = MAT_INDEX['ember']
        m[m == MAT_INDEX['rust']] = MAT_INDEX['gold']
        m[(z < -0.29) & (m == MAT_INDEX['darksteel'])] = MAT_INDEX['gold']
        return m

    pc.name = 'cinderfall'
    pc.materials = mats
    return pc


def polearm(name, shaft, grip_at, head, mats_extra=None, budget=4000):
    """A long shaft held a third of the way up; `head(p, top)` sculpts the business end."""
    top = shaft - grip_at

    def field(p):
        z = p[:, 2]
        r = np.hypot(p[:, 0], p[:, 1])
        pole = np.maximum(r - (0.02 + 0.002 * np.sin(z * 120)), np.maximum(z - top, -grip_at - z))
        butt = sdf.capsule((0, 0, -grip_at - 0.02), (0, 0, -grip_at + 0.06), 0.028)(p)
        return np.minimum(np.minimum(pole, butt), head(p, top))

    def mats(p):
        z = p[:, 2]
        m = np.full(len(p), MAT_INDEX['wood'])
        m[z > top - 0.02] = MAT_INDEX['verdigris']
        m[(z < -grip_at + 0.08)] = MAT_INDEX['bronze']
        m[(z > -0.25) & (z < 0.2)] = MAT_INDEX['darkleather']
        if mats_extra:
            mats_extra(p, m, top)
        return m

    return Piece(name, field, (np.array([-0.2, -0.06, -grip_at - 0.06]), np.array([0.2, 0.06, top + 0.75])), mats, skin=None, voxel=0.0018, budget=budget)


def reaver_spear():
    def head(p, top):
        z = p[:, 2] - top
        t = np.clip(z / 0.42, 0, 1)
        half = 0.045 * np.sin(np.pi * np.clip(t * 1.1, 0, 1)) ** 0.7 + 0.003
        blade = np.maximum(np.maximum(np.abs(p[:, 0]) - half, np.abs(p[:, 1]) - 0.006 * (1 - t) - 0.002), np.maximum(-z, z - 0.44))
        socket = sdf.capsule((0, 0, top - 0.05), (0, 0, top + 0.04), 0.026, 0.02)(p)
        return np.minimum(blade, socket)
    return polearm('reaver_spear', 2.1, 0.75, head)


def trident():
    def head(p, top):
        z = p[:, 2] - top
        cross = sdf.capsule((-0.17, 0, top + 0.04), (0.17, 0, top + 0.04), 0.022)(p)
        prongs = np.full(len(p), 1.0)
        for x, ln in ((-0.16, 0.5), (0.0, 0.62), (0.16, 0.5)):
            a = np.array([x, 0.0, top + 0.04])
            b = a + np.array([x * 0.15, 0, ln])
            prongs = np.minimum(prongs, sdf.capsule(a, b, 0.018, 0.004)(p))
            barb = np.array([x - 0.035 * np.sign(x if x else 1), 0, top + 0.04 + ln * 0.8])
            prongs = np.minimum(prongs, sdf.capsule(b - np.array([0, 0, 0.12]), barb, 0.01, 0.003)(p))
        collar = sdf.cylinder((0, 0, top - 0.06), (0, 0, top + 0.05), 0.04)(p)
        return np.minimum(np.minimum(cross, prongs), collar)

    def extra(p, m, top):
        z = p[:, 2]
        m[(z > top - 0.06) & (z < top + 0.07)] = MAT_INDEX['bronze']
        glow = (np.abs(p[:, 0]) < 0.006) & (z > top + 0.1) & (z < top + 0.55)
        m[glow] = MAT_INDEX['seaglow']
    return polearm('trident', 2.4, 0.8, head, extra, budget=5000)


def storm_glaive():
    """The Stormbound monks' glaive: a long curved blade on an ash shaft, copper-bound, a storm sigil."""
    def head(p, top):
        z = p[:, 2] - top
        t = np.clip(z / 0.62, 0, 1)
        # the edge sweeps forward (+x) as it rises; the back is straight with a hooked spur
        spine = 0.02 + 0.07 * np.sin(np.pi * np.clip(t * 0.95, 0, 1)) ** 0.8
        cx = 0.03 * t ** 2
        blade = np.maximum(np.maximum(p[:, 0] - (cx + spine), -(p[:, 0] - cx + 0.02)),
                           np.maximum(np.abs(p[:, 1]) - (0.007 * (1 - t) + 0.0015), np.maximum(-z, z - 0.64)))
        spur = sdf.capsule((-0.015, 0, top + 0.1), (-0.075, 0, top + 0.17), 0.012, 0.003)(p)
        collar = sdf.cylinder((0, 0, top - 0.09), (0, 0, top + 0.03), 0.032)(p)
        return np.minimum(np.minimum(blade, spur), collar)

    def extra(p, m, top):
        z = p[:, 2]
        m[z > top - 0.02] = MAT_INDEX['steel']
        m[(z > top - 0.09) & (z < top + 0.035)] = MAT_INDEX['copper']
        m[(z < 0.5) & (z > 0.42)] = MAT_INDEX['copper']
        sig = (np.abs(p[:, 0] - 0.04) < 0.005) & (z > top + 0.12) & (z < top + 0.36)
        m[sig] = MAT_INDEX['stormglow']
    return polearm('storm_glaive', 2.0, 0.7, head, extra, budget=4500)


def storm_spear():
    """Vaeltris's spear: a long leaf blade between two swept copper wings, a lightning channel down it."""
    def head(p, top):
        z = p[:, 2] - top
        t = np.clip(z / 0.7, 0, 1)
        half = 0.06 * np.sin(np.pi * np.clip(t * 1.05, 0, 1)) ** 0.6 + 0.003
        blade = np.maximum(np.maximum(np.abs(p[:, 0]) - half, np.abs(p[:, 1]) - 0.008 * (1 - t) - 0.002), np.maximum(-z, z - 0.72))
        wings = np.full(len(p), 1.0)
        for sx in (-1, 1):
            a = np.array([0.0, 0.0, top + 0.02])
            b = np.array([sx * 0.2, 0.0, top + 0.16])
            c = np.array([sx * 0.26, 0.0, top + 0.3])
            wings = np.minimum(wings, np.maximum(np.minimum(sdf.capsule(a, b, 0.02, 0.012)(p), sdf.capsule(b, c, 0.012, 0.003)(p)), np.abs(p[:, 1]) - 0.008))
        collar = sdf.cylinder((0, 0, top - 0.1), (0, 0, top + 0.04), 0.034)(p)
        return np.minimum(np.minimum(blade, wings), collar)

    def extra(p, m, top):
        z = p[:, 2]
        m[z > top - 0.02] = MAT_INDEX['steel']
        m[(np.abs(p[:, 0]) > 0.07) & (z > top)] = MAT_INDEX['copper']
        m[(z > top - 0.1) & (z < top + 0.045)] = MAT_INDEX['gold']
        m[(np.abs(p[:, 0]) < 0.006) & (z > top + 0.08) & (z < top + 0.62)] = MAT_INDEX['stormglow']
    return polearm('storm_spear', 2.6, 0.85, head, extra, budget=5000)


def thorn_maul():
    """A thornbound's maul: a gnarled root-club studded with thorns, sap seeping from its splits."""
    def head(p, top):
        z = p[:, 2] - top
        club = sdf.capsule((0, 0, top - 0.05), (0.02, 0.0, top + 0.42), 0.05, 0.11)(p)
        knots = sdf.sphere((0.04, 0.02, top + 0.38), 0.12)(p)
        thorns = np.full(len(p), 1.0)
        for k in range(12):
            a = k * 2.399
            zz = top + 0.12 + 0.025 * k
            c = np.array([np.cos(a) * 0.09, np.sin(a) * 0.09, zz])
            thorns = np.minimum(thorns, sdf.capsule(c, c + np.array([np.cos(a) * 0.08, np.sin(a) * 0.08, 0.03]), 0.012, 0.002)(p))
        return np.minimum(np.minimum(club, knots), thorns) - 0.006 * (sdf.fbm(p, 30, 2, 761) - 0.5)

    def extra(p, m, top):
        z = p[:, 2]
        m[:] = MAT_INDEX['bark']
        m[(z > top) & (sdf.fbm(p, 12, 2, 762) > 0.62)] = MAT_INDEX['moss']
        m[(z > top + 0.1) & (np.abs(sdf.fbm(p, 18, 3, 763) - 0.5) < 0.03)] = MAT_INDEX['sapglow']
    return polearm('thorn_maul', 1.1, 0.35, head, extra, budget=4500)


def briar_staff():
    """Sylvaris's staff: a living branch, a crook of twisted wood cradling a glowing seed."""
    def head(p, top):
        z = p[:, 2] - top
        out = np.full(len(p), 1.0)
        for k in range(3):
            a = k * 2.094
            pts = [np.array([np.cos(a) * 0.02, np.sin(a) * 0.02, top]), np.array([np.cos(a) * 0.09, np.sin(a) * 0.09, top + 0.18]),
                   np.array([np.cos(a + 0.6) * 0.07, np.sin(a + 0.6) * 0.07, top + 0.34]), np.array([np.cos(a + 1.2) * 0.02, np.sin(a + 1.2) * 0.02, top + 0.42])]
            for i in range(3):
                out = np.minimum(out, sdf.capsule(pts[i], pts[i + 1], 0.018, 0.012)(p))
        seed = sdf.sphere((0, 0, top + 0.22), 0.055)(p)
        return np.minimum(out, seed)

    def extra(p, m, top):
        z = p[:, 2]
        m[:] = MAT_INDEX['bark']
        m[np.linalg.norm(p - np.array([0, 0, top + 0.22]), axis=1) < 0.062] = MAT_INDEX['sapglow']
        m[(z < top) & (sdf.fbm(p, 10, 2, 764) > 0.66)] = MAT_INDEX['moss']
    return polearm('briar_staff', 2.3, 0.8, head, extra, budget=4500)


def sun_blade():
    """A Gilded Sentinel's arming sword: a broad leaf blade, a sunburst guard, gold on steel."""
    L, grip = 0.86, 0.2

    def field(p):
        z = p[:, 2]
        t = np.clip((z - 0.06) / L, 0, 1)
        half_w = 0.03 * (1 - t ** 2.6) + 0.012 * np.sin(np.pi * np.clip(t * 1.4, 0, 1)) + 0.004
        thick = 0.006 * (1 - 0.5 * t)
        fuller = 0.0025 * np.exp(-(p[:, 0] / 0.008) ** 2) * (t < 0.6)
        prof = np.abs(p[:, 1]) - (thick * np.clip(1 - (p[:, 0] / half_w) ** 2, 0, 1) - fuller)
        blade = np.maximum(np.maximum(prof, np.abs(p[:, 0]) - half_w), np.maximum(0.06 - z, z - (0.06 + L)))
        guard = np.full(len(p), 1.0)
        for k in range(9):
            a = np.pi * (k / 8)
            c0 = np.array([0, 0, 0.03])
            c1 = c0 + np.array([np.cos(a) * 0.09, 0, -np.sin(a) * 0.02 + 0.01])
            guard = np.minimum(guard, sdf.capsule(c0, c1, 0.011, 0.004)(p))
        hilt = sdf.capsule((0, 0, -grip), (0, 0, 0.02), 0.016)(p)
        pommel = sdf.sphere((0, 0, -grip - 0.02), 0.03)(p)
        return np.minimum(np.minimum(blade, guard), np.minimum(hilt, pommel))

    def mats(p):
        z = p[:, 2]
        m = np.full(len(p), MAT_INDEX['steel'])
        m[z < 0.06] = MAT_INDEX['gold']
        m[(z > -grip + 0.02) & (z < 0.0)] = MAT_INDEX['leather']
        m[(np.abs(p[:, 0]) < 0.006) & (z > 0.1) & (z < 0.5)] = MAT_INDEX['gold']
        return m
    return Piece('sun_blade', field, (np.array([-0.12, -0.04, -grip - 0.06]), np.array([0.12, 0.04, L + 0.1])), mats, skin=None, voxel=0.0015, budget=3500)


def sun_shield():
    """A tower shield faced with a sunburst: held on the left forearm (grip at the origin)."""
    def field(p):
        # the plate stands along +Z from the hand, its face toward -Y (out from the back of the fist)
        q = p - np.array([0, -0.07, 0.12])
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        outline = np.maximum(np.abs(x) - (0.27 - 0.06 * np.clip(-z / 0.5, 0, 1) ** 2), np.abs(z) - 0.5)
        curve = y + 0.06 * (x / 0.27) ** 2
        plate = np.maximum(outline, np.abs(curve) - 0.012)
        rim = np.maximum(np.maximum(np.abs(np.abs(x) - (0.27 - 0.06 * np.clip(-z / 0.5, 0, 1) ** 2)) - 0.012, np.abs(z) - 0.5), np.abs(curve + 0.006) - 0.018)
        rim = np.minimum(rim, np.maximum(np.maximum(np.abs(np.abs(z) - 0.5) - 0.012, np.abs(x) - 0.27), np.abs(curve + 0.006) - 0.018))
        boss = sdf.ellipsoid(np.array([0, -0.07 - 0.02, 0.12]), (0.09, 0.05, 0.09))(p)
        rays = np.full(len(p), 1.0)
        for k in range(12):
            a = k / 12 * 2 * np.pi
            c0 = np.array([0, -0.085, 0.12])
            c1 = c0 + np.array([np.cos(a) * 0.22, 0.01, np.sin(a) * 0.32])
            rays = np.minimum(rays, sdf.capsule(c0, c1, 0.012, 0.004)(p))
        handle = sdf.capsule((0, 0.0, -0.06), (0, 0.0, 0.08), 0.014)(p)
        return np.minimum(np.minimum(np.minimum(plate, rim), np.minimum(boss, rays)), handle)

    def mats(p):
        m = np.full(len(p), MAT_INDEX['silver'])
        q = p - np.array([0, -0.07, 0.12])
        m[q[:, 1] < -0.02] = MAT_INDEX['gold']
        m[np.abs(np.abs(q[:, 0]) - 0.26) < 0.02] = MAT_INDEX['gold']
        m[p[:, 1] > -0.02] = MAT_INDEX['leather']
        return m
    return Piece('sun_shield', field, (np.array([-0.32, -0.16, -0.42]), np.array([0.32, 0.04, 0.66])), mats, skin=None, voxel=0.002, budget=4500)


def dawnbreaker():
    """Aurelion's greatsword: a long blade of white-gold, a sun-disc guard, a channel of living light."""
    L, grip = 1.42, 0.32

    def field(p):
        z = p[:, 2]
        t = np.clip((z - 0.16) / L, 0, 1)
        half_w = 0.05 * (1 - t ** 3.2) + 0.007
        thick = 0.009 * (1 - 0.5 * t)
        chan = 0.004 * np.exp(-(p[:, 0] / 0.01) ** 2) * (t < 0.85)
        prof = np.abs(p[:, 1]) - (thick * np.clip(1 - (p[:, 0] / half_w) ** 2, 0, 1) - chan)
        blade = np.maximum(np.maximum(prof, np.abs(p[:, 0]) - half_w), np.maximum(0.16 - z, z - (0.16 + L)))
        disc = np.maximum(np.hypot(p[:, 0], p[:, 2] - 0.08) - 0.12, np.abs(p[:, 1]) - 0.018)
        disc = np.maximum(disc, -(np.hypot(p[:, 0], p[:, 2] - 0.08) - 0.05))
        hilt = sdf.capsule((0, 0, -grip), (0, 0, 0.0), 0.019)(p)
        pommel = sdf.sphere((0, 0, -grip - 0.03), 0.038)(p)
        return np.minimum(np.minimum(blade, disc), np.minimum(hilt, pommel))

    def mats(p):
        z = p[:, 2]
        m = np.full(len(p), MAT_INDEX['silver'])
        m[z < 0.16] = MAT_INDEX['gold']
        m[(z > -grip + 0.02) & (z < -0.02)] = MAT_INDEX['darkleather']
        m[(np.abs(p[:, 0]) < 0.007) & (z > 0.2) & (z < 0.16 + L * 0.85)] = MAT_INDEX['sunglow'] if 'sunglow' in MAT_INDEX else MAT_INDEX['glow']
        return m
    return Piece('dawnbreaker', field, (np.array([-0.16, -0.05, -grip - 0.08]), np.array([0.16, 0.05, L + 0.22])), mats, skin=None, voxel=0.0018, budget=5000)


BUILDERS = {'sun_blade': sun_blade, 'sun_shield': sun_shield, 'dawnbreaker': dawnbreaker, 'thorn_maul': thorn_maul, 'briar_staff': briar_staff, 'ashblade': ashblade, 'cinder_greatsword': cinder_greatsword, 'cinderfall': cinderfall, 'reaver_spear': reaver_spear, 'trident': trident,
            'storm_glaive': storm_glaive, 'storm_spear': storm_spear}


def build(name, res=1024):
    reset()
    pc = BUILDERS[name]()
    hi = pc.build()
    co = verts_np(hi)
    color_attribute(hi, 'pos', np.column_stack([np.full(len(co), 0.6)] * 3 + [np.ones(len(co))]))
    lo = low_poly(hi, pc.budget)
    bake.unwrap_pack([lo], margin=0.004)
    tpm = bake.uv_texel_density([lo], res)
    maps = bake.bake_set([(hi, lo)], res, os.path.join(WORK, name), kinds=('normal', 'ao', 'mat', 'curv', 'pos'), extrusion=0.003, ray=0.01)
    cov = bake.bake_uv_coverage([lo], res)
    tex = gearmat.composite(maps, hi['mat_ids'], res, tpm, cov, grime=0.45, ash=0.25)
    for k, s in (('albedo', 'c'), ('normal', 'n'), ('orm', 'orm'), ('emissive', 'e')):
        bake.save_rgb(bake.dilate(tex[k], cov, 6), os.path.join(OUT, f'{name}_{s}.webp'), 92)
    bpy.data.objects.remove(hi, do_unlink=True)
    lo.name = name
    lo.data.materials.clear()
    lo.data.materials.append(bpy.data.materials.new(f'M_{name}'))
    export_glb(os.path.join(OUT, f'{name}.glb'), [lo], morphs=False, skins=False)
    print(name, 'tris', sum(len(p.vertices) - 2 for p in lo.data.polygons), 'texel density', round(tpm))


names = [a for a in sys.argv[1:] if a in BUILDERS] or list(BUILDERS)
for n in names:
    build(n)
