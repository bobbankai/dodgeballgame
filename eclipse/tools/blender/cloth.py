"""Hem bones for hanging cloth (robes, skirts, tabards), so the game can swing it with springs.

  /opt/bvenv/bin/python eclipse/tools/blender/cloth.py <id> [<id> ...]     (re-export a built character)

`add_cloth(rig, gear)` is also called by enemy_build.py before export. It finds the gear's loose
cloth: vertices below the hips that hang clear of the legs (distance to capsules round the thigh and
calf bones), lower = looser. If there is enough of it, four panel bones hang from the pelvis (front,
back, left, right: cloth_f, cloth_b, cloth_l, cloth_r, head at the hip, tail at the hem) and that cloth
is weighted to them by its angle round the hips (feet and anything hugging a leg stay as they were), blended with its old (leg) weights by looseness, so
a robe hangs from the hips and sways instead of splitting with the legs like trousers.
`src/anim/ClothSprings.ts` drives the bones at run time.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np

from common import verts_np, all_group_weights, set_group, export_glb, select_only, WORK, ASSETS
from human import add_bone
from character import bone_world, normalize_weights

PANELS = (('cloth_f', -math.pi / 2), ('cloth_b', math.pi / 2), ('cloth_l', 0.0), ('cloth_r', math.pi))


def _seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(float(ab @ ab), 1e-9), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab[None]), axis=1)


def add_cloth(rig, gear, min_verts=250):
    """Adds the panel bones and weights; returns their names ([] when the gear has no hanging cloth)."""
    if 'cloth_f' in rig.data.bones:
        return [n for n, _ in PANELS]
    co = verts_np(gear)
    hip = bone_world(rig, 'pelvis')[0]
    head_top = bone_world(rig, 'head')[1][2]
    s = max(head_top, 1.0) / 1.75
    zh = hip[2]
    legs = []
    for side in 'lr':
        th, kn = bone_world(rig, f'thigh_{side}')
        ca, an = bone_world(rig, f'calf_{side}')
        legs.append(_seg_dist(co, th, kn) - 0.085 * s)
        legs.append(_seg_dist(co, ca, an) - 0.06 * s)
        fo, ba = bone_world(rig, f'foot_{side}')
        b0, b1 = bone_world(rig, f'ball_{side}')
        legs.append(_seg_dist(co, fo, ba) - 0.06 * s)   # feet and ankle wraps are never cloth
        legs.append(_seg_dist(co, b0, b1) - 0.05 * s)
    d_leg = np.min(np.array(legs), axis=0)
    loose = np.clip((d_leg - 0.035 * s) / (0.07 * s), 0, 1)
    loose = loose * loose * (3 - 2 * loose)
    below = co[:, 2] < zh - 0.04 * s
    cand = below & (loose > 0.3)
    if int(cand.sum()) < min_verts:
        print(f'cloth: {gear.name} has no hanging cloth ({int(cand.sum())} loose vertices)')
        return []
    hem = float(np.percentile(co[cand, 2], 3))
    top = zh - 0.04 * s
    drop = np.clip((top - co[:, 2]) / max(top - hem, 0.1), 0, 1)
    w = loose * drop ** 1.1 * 0.9 * below
    # panel bones: hanging from the hip ring to the hem, splayed a little like the cloth
    names = []
    for name, ang in PANELS:
        d = np.array([math.cos(ang), math.sin(ang), 0.0])
        h = np.array([hip[0], hip[1], top]) + d * 0.1 * s
        t = np.array([hip[0], hip[1], hem]) + d * 0.16 * s
        add_bone(rig, name, h, t, parent='pelvis')
        names.append(name)
    ang_v = np.arctan2(co[:, 1] - hip[1], co[:, 0] - hip[0])
    lobes = np.array([np.maximum(0, np.cos(ang_v - a)) ** 2 for _, a in PANELS])
    lobes /= np.maximum(lobes.sum(0), 1e-6)
    groups = all_group_weights(gear)
    for vg in list(gear.vertex_groups):
        old = groups[vg.name]
        if not old.any():
            continue
        new = old * (1 - w)
        gone = np.nonzero((old > 0) & (new <= 1e-4))[0]
        if len(gone):
            vg.remove([int(i) for i in gone])
        set_group(gear, vg.name, new)
    for k, (name, _) in enumerate(PANELS):
        set_group(gear, name, w * lobes[k])
    normalize_weights(gear)
    print(f'cloth: {gear.name}: {int((w > 0.2).sum())} vertices on hem bones, hem at {hem:.2f} m, hips at {zh:.2f} m')
    return names


def reexport(cid):
    bpy.ops.wm.open_mainfile(filepath=os.path.join(WORK, f'{cid}.blend'))
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    gear = bpy.data.objects[f'{cid}_gear']
    had = 'cloth_f' in rig.data.bones
    names = add_cloth(rig, gear)
    out = os.path.join(ASSETS, 'chars', cid)
    mpath = os.path.join(out, f'{cid}.json')
    man = json.load(open(mpath))
    if names:
        man['cloth'] = names
    else:
        man.pop('cloth', None)
    json.dump(man, open(mpath, 'w'), indent=1)
    if had or not names:
        return
    select_only(rig)
    export_glb(os.path.join(out, f'{cid}.glb'), [rig, gear], animations=False, morphs=False)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, f'{cid}.blend'))


if __name__ == '__main__':
    for cid in [a for a in sys.argv[1:] if not a.startswith('-')]:
        reexport(cid)
