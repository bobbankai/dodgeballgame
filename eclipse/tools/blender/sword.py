"""Oathkeeper, Kael's longsword (and the weapon kit's shared builder).

  /opt/bvenv/bin/python eclipse/tools/blender/sword.py

Sculpted with signed distance fields: a lenticular blade with a fuller and a distal taper, a curved
crossguard with a sun-disc boss, a leather grip with a spiral wrap, and a sunburst pommel. Baked and
textured like the armour (steel, gold, leather). The grip is at the origin and the blade points
along +Y (the game attaches it to the hand's weapon socket).
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
from common import reset, ASSETS, WORK, export_glb, select_only, color_attribute, verts_np

OUT = os.path.join(ASSETS, 'weapons')
os.makedirs(OUT, exist_ok=True)


def oathkeeper():
    L = 0.92            # blade length
    grip = 0.22
    # Blender coordinates: blade along +Z while sculpting, flattened in Y (blade faces X)
    def blade(p):
        z = p[:, 2]
        t = np.clip((z - 0.06) / L, 0, 1)
        half_w = 0.026 * (1 - t ** 1.6) + 0.004
        thick = 0.0055 * (1 - 0.6 * t)
        # lenticular cross-section with a fuller groove along the first 70%
        fuller = 0.0022 * np.exp(-(p[:, 0] / 0.006) ** 2) * (t < 0.7) * np.clip((0.7 - t) / 0.1, 0, 1)
        prof = np.abs(p[:, 1]) - (thick * np.clip(1 - (p[:, 0] / half_w) ** 2, 0, 1) - fuller)
        width = np.abs(p[:, 0]) - half_w
        d = np.maximum(prof, width)
        tip = (z - (0.06 + L)) + np.abs(p[:, 0]) * 1.8
        return np.maximum(np.maximum(d, tip), 0.05 - z)

    def guard(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        curve = 0.025 * (x / 0.11) ** 2
        bar = sdf.capsule((-0.11, 0, 0.045), (0.11, 0, 0.045), 0.011)(np.column_stack([x, y, z - curve]))
        boss = sdf.cylinder((0, -0.014, 0.045), (0, 0.014, 0.045), 0.026)(p)
        ends = np.minimum(sdf.sphere((-0.118, 0, 0.07), 0.016)(p), sdf.sphere((0.118, 0, 0.07), 0.016)(p))
        return np.minimum(np.minimum(bar, boss - 0.002), ends)

    def handle(p):
        z = p[:, 2]
        r = np.hypot(p[:, 0], p[:, 1] * 1.2)
        wrap = 0.0015 * np.sin(np.arctan2(p[:, 1], p[:, 0]) * 2 + z * 220)
        core = np.maximum(r - (0.0155 + wrap), np.maximum(z - 0.035, -grip - z))
        return core

    def pommel(p):
        c = np.array([0.0, 0.0, -grip - 0.022])
        disc = sdf.cylinder(c + (0, -0.012, 0), c + (0, 0.012, 0), 0.028)(p)
        ang = np.arctan2(p[:, 2] - c[2], p[:, 0])
        rays = np.hypot(p[:, 0], p[:, 2] - c[2]) - (0.03 + 0.008 * np.maximum(0, np.cos(ang * 8)) ** 3)
        rays = np.maximum(rays, np.abs(p[:, 1]) - 0.007)
        return np.minimum(disc, rays)

    def field(p):
        return np.minimum(np.minimum(blade(p), guard(p)), np.minimum(handle(p), pommel(p)))

    def mats(p):
        m = np.full(len(p), MAT_INDEX['steel'])
        z = p[:, 2]
        m[(z < 0.036) & (z > -grip - 0.002)] = MAT_INDEX['darkleather']
        g = guard(p)
        m[np.abs(g) < 0.004] = MAT_INDEX['gold']
        m[np.abs(pommel(p)) < 0.004] = MAT_INDEX['gold']
        # an engraved line of gold runes along the fuller
        t = (z - 0.06) / L
        m[(np.abs(p[:, 0]) < 0.004) & (t > 0.05) & (t < 0.55) & (np.sin(z * 260) > 0.6)] = MAT_INDEX['gold']
        return m

    return Piece('oathkeeper', field, (np.array([-0.14, -0.04, -grip - 0.06]), np.array([0.14, 0.04, 0.06 + L + 0.01])),
                 mats, skin=None, voxel=0.0016, budget=5000)


def main():
    reset()
    pc = oathkeeper()
    hi = pc.build()
    co = verts_np(hi)
    color_attribute(hi, 'pos', np.column_stack([np.full(len(co), 0.6)] * 3 + [np.ones(len(co))]))
    lo = low_poly(hi, pc.budget)
    bake.unwrap_pack([lo], margin=0.004)
    res = 1024
    tpm = bake.uv_texel_density([lo], res)
    ids = hi['mat_ids']
    maps = bake.bake_set([(hi, lo)], res, os.path.join(WORK, 'oathkeeper'), kinds=('normal', 'ao', 'mat', 'curv', 'pos'), extrusion=0.003, ray=0.01)
    cov = bake.bake_uv_coverage([lo], res)
    tex = gearmat.composite(maps, ids, res, tpm, cov, grime=0.35, ash=0.12)
    for k, s in (('albedo', 'c'), ('normal', 'n'), ('orm', 'orm')):
        bake.save_rgb(bake.dilate(tex[k], cov, 6), os.path.join(OUT, f'oathkeeper_{s}.webp'), 92)
    bpy.data.objects.remove(hi, do_unlink=True)
    lo.name = 'oathkeeper'
    lo.data.materials.clear()
    lo.data.materials.append(bpy.data.materials.new('M_oathkeeper'))
    # blade along +Z in Blender -> +Y in glTF: the socket's +Y in the game
    export_glb(os.path.join(OUT, 'oathkeeper.glb'), [lo], morphs=False, skins=False)
    print('tris', sum(len(p.vertices) - 2 for p in lo.data.polygons))


main()
