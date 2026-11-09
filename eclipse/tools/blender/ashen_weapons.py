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


BUILDERS = {'ashblade': ashblade, 'cinder_greatsword': cinder_greatsword, 'cinderfall': cinderfall, 'reaver_spear': reaver_spear, 'trident': trident}


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
