"""Builds an enemy character whose body is fully covered by gear (wraps, plate, robes).

  /opt/bvenv/bin/python eclipse/tools/blender/enemy_build.py <id> [--res 2048] [--preview] [--quick]
  /opt/bvenv/bin/python eclipse/tools/blender/enemy_build.py <id> --retex      (re-composite only)

Same pipeline as Kael's armour (see kael.py): an MPFB base body sized by the spec's phenotype
gives the rig and the surface the gear is sculpted around; every visible part is a signed-distance
piece (ashen_gear.py) baked onto a decimated mesh and textured by material id. The body itself is
not exported (nothing of it shows), so these characters are one skinned mesh and one texture set:

  public/assets/chars/<id>/<id>.glb, gear_c/_n/_orm/_e.webp, <id>.json
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np
from mathutils import Vector

import sdf
import bake
import gearmat
from common import reset, verts_np, tris_np, select_only, export_glb, preview, WORK, ASSETS, color_attribute, link, args, triangle_count
from human import build_body, add_bone
from armor import Rig, low_poly
from preview_mat import setup_preview_material
from character import skin_rigid, skin_transfer, skin_skirt, normalize_weights, parent_to_rig
import ashen_gear
import drowned_gear

A = args()
ID = A[0] if A and not A[0].startswith('--') else 'thrall'
RES = int(A[A.index('--res') + 1]) if '--res' in A else 2048
QUICK = '--quick' in A
OUT = os.path.join(ASSETS, 'chars', ID)
os.makedirs(OUT, exist_ok=True)
T0 = time.time()

SPECS = {
    'thrall': {
        'name': 'Thrall', 'gear': ashen_gear.thrall, 'grime': 0.7, 'ash': 0.55, 'emissive': 2.2,
        'phenotype': {'gender': 1.0, 'age': 0.5, 'muscle': 0.3, 'weight': 0.12, 'height': 0.62, 'proportions': 0.6},
        'targets': [('torso/torso-scale-depth-decr', 0.4), ('neck/neck-scale-depth-decr', 0.3)],
    },
    'cinder_knight': {
        'name': 'Cinder Knight', 'gear': ashen_gear.cinder_knight, 'grime': 0.6, 'ash': 0.45, 'emissive': 3.0,
        'phenotype': {'gender': 1.0, 'age': 0.55, 'muscle': 0.95, 'weight': 0.72, 'height': 0.85, 'proportions': 0.9},
        'targets': [],
    },
    'acolyte': {
        'name': 'Pyre Acolyte', 'gear': ashen_gear.acolyte, 'grime': 0.5, 'ash': 0.4, 'emissive': 2.6,
        'phenotype': {'gender': 0.15, 'age': 0.45, 'muscle': 0.4, 'weight': 0.35, 'height': 0.55, 'proportions': 0.8},
        'targets': [],
    },
    'reaver': {
        'name': 'Drowned Reaver', 'gear': drowned_gear.reaver, 'grime': 0.55, 'ash': 0.0, 'emissive': 2.4,
        'phenotype': {'gender': 1.0, 'age': 0.5, 'muscle': 0.55, 'weight': 0.35, 'height': 0.7, 'proportions': 0.8},
        'targets': [],
    },
    'tidecaller': {
        'name': 'Tidecaller', 'gear': drowned_gear.tidecaller, 'grime': 0.45, 'ash': 0.0, 'emissive': 2.8,
        'phenotype': {'gender': 0.0, 'age': 0.4, 'muscle': 0.35, 'weight': 0.35, 'height': 0.6, 'proportions': 0.85},
        'targets': [],
    },
    'thaloryn': {
        'name': 'Thaloryn', 'gear': drowned_gear.thaloryn, 'grime': 0.45, 'ash': 0.0, 'emissive': 3.2,
        'phenotype': {'gender': 1.0, 'age': 0.75, 'muscle': 0.85, 'weight': 0.7, 'height': 0.95, 'proportions': 1.0},
        'targets': [('torso-vshape-incr', 0.4), ('chin-width-incr', 0.4)],
    },
    'ignaroth': {
        'name': 'Ignaroth', 'gear': ashen_gear.ignaroth, 'grime': 0.45, 'ash': 0.35, 'emissive': 3.4,
        'phenotype': {'gender': 1.0, 'age': 0.6, 'muscle': 1.0, 'weight': 0.8, 'height': 1.0, 'proportions': 1.0},
        'targets': [('torso-vshape-incr', 0.6), ('neck-scale-horiz-incr', 0.5), ('chin-width-incr', 0.6), ('head-square', 0.5)],
    },
}
SPEC = SPECS[ID]


def log(*a):
    print(f'[{time.time() - T0:7.1f}s]', *a, flush=True)


def material(name, color):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    return m


def textures(maps, ids, tpm, covered):
    tex = gearmat.composite(maps, ids, RES, tpm, covered, grime=SPEC['grime'], ash=SPEC['ash'], emissive_strength=1.0)
    for k, suffix in (('albedo', 'c'), ('normal', 'n'), ('orm', 'orm'), ('emissive', 'e')):
        bake.save_rgb(bake.dilate(tex[k], covered, 6), os.path.join(OUT, f'gear_{suffix}.webp'), 92)
    log('textures written')


def main():
    reset(enable_mpfb=True)
    body, rig, lm, helpers = build_body({**SPEC, 'expressions': {}})
    for h in helpers.values():
        bpy.data.objects.remove(h, do_unlink=True)
    log('body', len(body.data.vertices), 'verts, height', round(verts_np(body)[:, 2].max(), 3))
    R = Rig(rig)
    full_v = verts_np(body)
    B = sdf.BodyField(full_v, tris_np(body))
    info = {'top': float(full_v[:, 2].max()), 'eye_l': np.array(lm['joint-l-eye']), 'eye_r': np.array(lm['joint-r-eye']),
            'head': np.array(lm['joint-head'])}

    pieces = SPEC['gear'](R, B, info)
    if QUICK:
        for pc in pieces:
            pc.voxel *= 1.6
    pairs = []
    for pc in pieces:
        hi = pc.build()
        co = verts_np(hi)
        color_attribute(hi, 'pos', np.column_stack([co[:, 2] / 2.2, co[:, 2] / 2.2, co[:, 2] / 2.2, np.ones(len(co))]))
        lo = low_poly(hi, pc.budget)
        pairs.append((pc, hi, lo))
        log('piece', pc.name, len(hi.data.vertices), '->', triangle_count(lo), 'tris')
    lows = [lo for _, _, lo in pairs]
    bake.unwrap_pack(lows, margin=0.003)
    tpm = bake.uv_texel_density(lows, RES)
    log('UV texel density', round(tpm), 'px/m')
    ids = sorted({i for _, hi, _ in pairs for i in hi['mat_ids']})
    body.hide_render = True
    maps = bake.bake_set([(hi, lo) for _, hi, lo in pairs], RES, os.path.join(WORK, f'{ID}_gear'),
                         kinds=('normal', 'ao', 'mat', 'curv', 'pos'), extrusion=0.008, ray=0.03, ao_samples=24 if QUICK else 48)
    covered = bake.bake_uv_coverage(lows, RES)
    np.save(os.path.join(WORK, f'{ID}_gear_covered.npy'), covered)
    json.dump({'ids': [int(i) for i in ids], 'tpm': float(tpm), 'maps': maps}, open(os.path.join(WORK, f'{ID}_gear_tex.json'), 'w'))
    textures(maps, ids, tpm, covered)

    deform = {b.name for b in rig.data.bones}
    for pc, hi, lo in pairs:
        if isinstance(pc.skin, dict):
            skin_rigid(lo, rig, pc.skin['bone'], pc.skin.get('blend'))
        elif pc.skin == 'transfer_skirt':
            skin_skirt(lo, rig, body)
        else:
            skin_transfer(lo, body, deform)
        normalize_weights(lo)
    for _, hi, _ in pairs:
        bpy.data.objects.remove(hi, do_unlink=True)
    select_only(*lows)
    bpy.context.view_layer.objects.active = lows[0]
    bpy.ops.object.join()
    gear = lows[0]
    gear.name = f'{ID}_gear'
    gear.data.materials.clear()
    gear.data.materials.append(material(f'M_{ID}_gear', (0.5, 0.5, 0.5)))
    parent_to_rig(gear, rig)
    log('gear joined', triangle_count(gear), 'tris')

    # sockets (same construction as Kael's: a grip across the palm)
    def H(n):
        return Vector(R.head(n))
    for s, sign in (('r', -1), ('l', 1)):
        idx, pky, hb, mid = H(f'index_01_{s}'), H(f'pinky_01_{s}'), H(f'hand_{s}'), H(f'middle_01_{s}')
        palm_c = (idx + pky + hb + mid) / 4
        blade = (idx - pky).normalized()
        fingers = (mid - hb).normalized()
        palm_n = blade.cross(fingers).normalized() * sign
        grip = palm_c + palm_n * 0.025 + fingers * 0.02
        add_bone(rig, f'weapon_{s}', grip, grip + blade * 0.12, parent=f'hand_{s}')
    bpy.data.objects.remove(body, do_unlink=True)
    for m in list(gear.modifiers):
        if m.type != 'ARMATURE':
            gear.modifiers.remove(m)
    export_glb(os.path.join(OUT, f'{ID}.glb'), [rig, gear], animations=False, morphs=False)
    manifest = {
        'name': SPEC['name'], 'height': info['top'],
        'parts': {f'{ID}_gear': {'kind': 'gear', 'tex': 'gear', 'emissive': SPEC['emissive'], 'twoSided': True}},
        'sockets': {'weapon_r': 'weapon_r', 'weapon_l': 'weapon_l'},
        'morphs': [],
    }
    json.dump(manifest, open(os.path.join(OUT, f'{ID}.json'), 'w'), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, f'{ID}.blend'))
    log('exported')
    if '--preview' in A:
        previews(gear)


def previews(gear):
    setup_preview_material(gear, 'gear', os.path.join(OUT, 'gear'), emissive=True)
    from common import verts_np as _v
    top = float(_v(gear)[:, 2].max())
    k = top / 1.9
    preview(os.path.join(WORK, f'{ID}_pv_front.png'), size=(900, 1300), cam_loc=(1.3 * k, -3.9 * k, 1.35 * k), target=(0, 0, 1.0 * k), lens=55, samples=48)
    preview(os.path.join(WORK, f'{ID}_pv_back.png'), size=(900, 1300), cam_loc=(-1.6 * k, 3.7 * k, 1.5 * k), target=(0, 0, 1.05 * k), lens=55, samples=48)
    preview(os.path.join(WORK, f'{ID}_pv_head.png'), size=(900, 900), cam_loc=(0.5 * k, -1.2 * k, top - 0.25 * k), target=(0, 0, top - 0.32 * k), lens=70, samples=48)
    log('previews rendered')


if '--retex' in A:
    meta = json.load(open(os.path.join(WORK, f'{ID}_gear_tex.json')))
    textures(meta['maps'], meta['ids'], meta['tpm'], np.load(os.path.join(WORK, f'{ID}_gear_covered.npy')))
elif '--preview-only' in A:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(WORK, f'{ID}.blend'))
    previews(bpy.data.objects[f'{ID}_gear'])
else:
    main()
