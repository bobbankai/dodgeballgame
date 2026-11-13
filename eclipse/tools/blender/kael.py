"""Builds Kael: body, gear, skin, eyes, hair, rig extras -> public/assets/chars/kael/.

  /opt/bvenv/bin/python eclipse/tools/blender/kael.py [--res 2048] [--preview] [--quick]

Outputs kael.glb (skinned meshes kael_skin / kael_gear / kael_hair / kael_eyes / kael_teeth on the
game_engine skeleton plus socket bones, with facial morph targets), texture sets
(<part>_c/_n/_orm/_e.webp) and kael.json (material parameters for the game's loader).
"""
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np
from mathutils import Vector

import sdf
import armor
from common import (reset, verts_np, tris_np, select_only, apply_modifiers, export_glb, preview, WORK, ASSETS,
                    color_attribute, link, args, decimate, shade_smooth, triangle_count)
from human import build_body, add_bone, EXPRESSIONS, read_target, MPFB_DATA
from armor import Rig, low_poly
from kael_gear import gear
import bake
import gearmat
import skin as skinlib
import hair as hairlib
from preview_mat import setup_preview_material
from character import (keep_regions, subdivide_keep_shapes, make_eye, iris_texture, feature_masks, scar_mask,
                       skin_rigid, skin_transfer, skin_skirt, normalize_weights, parent_to_rig, shape_deltas)

A = args()
RES = int(A[A.index('--res') + 1]) if '--res' in A else 2048
QUICK = '--quick' in A
OUT = os.path.join(ASSETS, 'chars', 'kael')
os.makedirs(OUT, exist_ok=True)
T0 = time.time()


def log(*a):
    print(f'[{time.time() - T0:7.1f}s]', *a, flush=True)


SPEC = {
    'name': 'Kael',
    'phenotype': {'gender': 1.0, 'age': 0.58, 'muscle': 0.78, 'weight': 0.56, 'height': 0.6, 'proportions': 0.85},
    'targets': [
        ('chin/chin-prominent-incr', 0.35), ('chin/chin-width-incr', 0.3), ('chin/chin-jaw-drop-incr', 0.2),
        ('head/head-square', 0.35), ('head/head-age-incr', 0.15),
        ('cheek/l-cheek-bones-incr', 0.45), ('cheek/r-cheek-bones-incr', 0.45),
        ('cheek/l-cheek-volume-decr', 0.3), ('cheek/r-cheek-volume-decr', 0.3),
        ('eyes/l-eye-height2-decr', 0.25), ('eyes/r-eye-height2-decr', 0.25),
        ('eyes/l-eye-bag-decr', 0.4), ('eyes/r-eye-bag-decr', 0.4),
        ('forehead/forehead-trans-forward', 0.2),
        ('eyebrows/eyebrows-trans-down', 0.35), ('eyebrows/eyebrows-angle-down', 0.25),
        ('nose/nose-scale-horiz-incr', 0.15), ('nose/nose-hump-incr', 0.35),
    ],
}


def material(name, color):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    return m


def gear_textures(maps, ids, tpm, covered):
    tex = gearmat.composite(maps, ids, RES, tpm, covered, grime=0.55, ash=0.4)
    for k, suffix in (('albedo', 'c'), ('normal', 'n'), ('orm', 'orm'), ('emissive', 'e')):
        bake.save_rgb(bake.dilate(tex[k], covered, 6), os.path.join(OUT, f'gear_{suffix}.webp'), 92)
    log('gear textures written')


def retex():
    """Re-composite the gear textures from the cached bakes (after changing materials/looks)."""
    meta = json.load(open(os.path.join(WORK, 'kael_gear_tex.json')))
    covered = np.load(os.path.join(WORK, 'kael_gear_covered.npy'))
    gear_textures(meta['maps'], meta['ids'], meta['tpm'], covered)


def main():
    reset(enable_mpfb=True)
    body, rig, lm, helpers = build_body(SPEC)
    log('body', len(body.data.vertices), 'verts, height', round(verts_np(body)[:, 2].max(), 3))
    R = Rig(rig)
    full_v, full_t = verts_np(body), tris_np(body)
    B = sdf.BodyField(full_v, full_t)
    # an untouched copy of the body for weight transfer
    body_src = body.copy()
    body_src.data = body.data.copy()
    body_src.name = 'Body_src'
    link(body_src)
    body_src.hide_render = True
    for h in helpers.values():
        h.hide_render = True

    # ------------------------------------------------------------------ gear
    pieces = gear(R, B)
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
    log('gear UV texel density', round(tpm), 'px/m')
    ids = sorted({i for _, hi, _ in pairs for i in hi['mat_ids']})
    maps = bake.bake_set([(hi, lo) for _, hi, lo in pairs], RES, os.path.join(WORK, 'kael_gear'),
                         kinds=('normal', 'ao', 'mat', 'curv', 'pos'), extrusion=0.008, ray=0.03, ao_samples=24 if QUICK else 48)
    covered = bake.bake_uv_coverage(lows, RES)
    # the bakes are slow; keep what compositing needs so `--retex` can redo only the look
    np.save(os.path.join(WORK, 'kael_gear_covered.npy'), covered)
    json.dump({'ids': [int(i) for i in ids], 'tpm': float(tpm), 'maps': maps}, open(os.path.join(WORK, 'kael_gear_tex.json'), 'w'))
    gear_textures(maps, ids, tpm, covered)

    # ------------------------------------------------------------------ skinning gear
    deform = {b.name for b in rig.data.bones}
    for pc, hi, lo in pairs:
        if isinstance(pc.skin, dict):
            skin_rigid(lo, rig, pc.skin['bone'], pc.skin.get('blend'))
        elif pc.skin == 'transfer_skirt':
            skin_skirt(lo, rig, body_src)
        else:
            skin_transfer(lo, body_src, deform)
        normalize_weights(lo)
    for _, hi, _ in pairs:
        bpy.data.objects.remove(hi, do_unlink=True)
    select_only(*lows)
    bpy.context.view_layer.objects.active = lows[0]
    bpy.ops.object.join()
    gear_obj = lows[0]
    gear_obj.name = 'kael_gear'
    gear_obj.data.materials.clear()
    gear_obj.data.materials.append(material('M_kael_gear', (0.5, 0.5, 0.5)))
    parent_to_rig(gear_obj, rig)
    log('gear joined', triangle_count(gear_obj), 'tris')

    # ------------------------------------------------------------------ head and skin
    zc = R.head('clavicle_l')[2]
    keep_regions(body, lambda co: (co[:, 2] > zc + 0.035) & (np.abs(co[:, 0]) < 0.16))
    subdivide_keep_shapes(body, 1)
    body.name = 'kael_skin'
    log('head', len(body.data.vertices), 'verts')
    select_only(body)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=False, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    fm = feature_masks(body, lm)
    co = verts_np(body, world=False)
    eye_l, eye_r = np.array(lm['joint-l-eye']), np.array(lm['joint-r-eye'])
    # a scar through Kael's left eyebrow down onto the cheek
    scar = scar_mask(co, [eye_l + [0.012, -0.012, 0.03], eye_l + [0.018, -0.016, 0.012], eye_l + [0.028, -0.008, -0.02]], 0.0022)
    fm['scar'] = scar
    fm['eyebrow'] = (((co[:, 2] > eye_l[2] + 0.012) & (co[:, 2] < eye_l[2] + 0.024 + 0.006 * (1 - np.abs(np.abs(co[:, 0]) - 0.035) / 0.03)) &
                      (np.abs(co[:, 0]) > 0.011) & (np.abs(co[:, 0]) < 0.06) & (co[:, 1] < eye_l[1] + 0.01)).astype(float))
    color_attribute(body, 'mA', np.column_stack([fm['lips'], fm['lids'], fm['brow'], np.ones(len(co))]))
    color_attribute(body, 'mB', np.column_stack([fm['cheek'], fm['nose'], fm['beard'], np.ones(len(co))]))
    color_attribute(body, 'mC', np.column_stack([fm['scalp'], fm['ears'], fm['scar'], np.ones(len(co))]))
    color_attribute(body, 'mD', np.column_stack([fm['eyebrow'], fm['beard'], np.zeros(len(co)), np.ones(len(co))]))
    gear_obj.hide_render = True
    smaps = bake.bake_set([(body, body)], RES, os.path.join(WORK, 'kael_skin'), kinds=('mA', 'mB', 'mC', 'mD', 'ao'),
                          extrusion=0.0, ray=0.06, ao_samples=32)
    gear_obj.hide_render = False
    paint = skinlib.paint(smaps, RES, {
        'base': (0.74, 0.55, 0.45), 'lip': (0.6, 0.36, 0.33), 'blush': (0.78, 0.45, 0.4), 'hair': (0.12, 0.09, 0.07),
        'scar': (0.86, 0.66, 0.6), 'stubble': 0.85, 'ash': 0.22, 'flush': 0.32, 'seed': 21,
    })
    skin_cov = bake.bake_uv_coverage([body], RES)
    for k, suffix in (('albedo', 'c'), ('normal', 'n'), ('orm', 'orm')):
        bake.save_rgb(bake.dilate(paint[k], skin_cov, 8), os.path.join(OUT, f'skin_{suffix}.webp'), 93)
    for a in ('mA', 'mB', 'mC', 'mD'):
        body.data.color_attributes.remove(body.data.color_attributes[a])
    body.data.materials.clear()
    body.data.materials.append(material('M_kael_skin', (0.7, 0.5, 0.4)))
    log('skin textures written')

    # ------------------------------------------------------------------ eyes and teeth
    iris_texture(os.path.join(OUT, 'eye_c.png'), 512, iris_col=(0.3, 0.38, 0.44), inner_col=(0.62, 0.46, 0.2))
    from PIL import Image
    Image.open(os.path.join(OUT, 'eye_c.png')).save(os.path.join(OUT, 'eye_c.webp'), 'WEBP', quality=92)
    os.remove(os.path.join(OUT, 'eye_c.png'))
    eyes = []
    for side, key in (('l', 'helper-l-eye'), ('r', 'helper-r-eye')):
        mn, mx = np.array(lm[key + ':min']), np.array(lm[key + ':max'])
        c = (mn + mx) / 2
        r = (mx[0] - mn[0]) / 2 * 0.98
        e = make_eye(f'eye_{side}', Vector(c), r, None)
        e.data.materials.append(material('M_kael_eye', (0.9, 0.9, 0.9)))
        eyes.append((side, e, c))
    teeth = []
    for key in ('helper-upper-teeth', 'helper-lower-teeth'):
        t = helpers.get(key)
        if t is None:
            continue
        m = t.modifiers.new('sub', 'SUBSURF')
        m.levels = 1
        apply_modifiers(t)
        shade_smooth(t)
        t.data.materials.append(material('M_kael_teeth', (0.85, 0.82, 0.75)))
        t.hide_render = False
        teeth.append(t)
    # lower teeth follow the jaw-open morph: rigid shift by the chin's mean displacement
    d = shape_deltas(body)
    chin = (co[:, 2] < (eye_l[2] - 0.085)) & (np.abs(co[:, 0]) < 0.025) & (co[:, 1] < eye_l[1] + 0.03)
    jaw_shift = d['jawOpen'][chin].mean(0) if chin.any() else np.zeros(3)
    for t in teeth:
        if 'lower' in t.name:
            t.shape_key_add(name='Basis')
            sk = t.shape_key_add(name='jawOpen')
            base = verts_np(t, world=False)
            sk.data.foreach_set('co', (base + jaw_shift * 0.9).ravel())
    if 'helper-tongue' in helpers:
        bpy.data.objects.remove(helpers['helper-tongue'], do_unlink=True)

    # ------------------------------------------------------------------ hair, beard, brows
    head_field = sdf.BodyField(verts_np(body), tris_np(body), samples=400000)
    hairlib.strand_texture(os.path.join(WORK, 'kael_hair.png'), 1024, 8, seed=4, base=(0.085, 0.062, 0.048), grey=0.1)
    Image.open(os.path.join(WORK, 'kael_hair.png')).save(os.path.join(OUT, 'hair_c.webp'), 'WEBP', quality=94, lossless=False)
    hv, ht = verts_np(body), tris_np(body)
    head_c = np.array(lm['joint-head'])

    def groom(p, n):
        d = np.zeros_like(p)
        back = np.clip((p[:, 1] - (head_c[1] - 0.06)) / 0.12, 0, 1)
        d[:, 1] = 1.0
        d[:, 2] = -0.25 - 1.1 * back
        side = np.clip((np.abs(p[:, 0]) - 0.045) / 0.035, 0, 1)
        d[:, 0] = np.sign(p[:, 0]) * (0.15 + 0.3 * side)
        d[:, 2] -= side * 0.7
        d = d - n * (d * n).sum(1, keepdims=True)
        return d

    scalp = fm['scalp'] * (1 - fm['ears'])
    roots, nrm, wt = hairlib.sample_region(hv, ht, scalp, 1300 if not QUICK else 600, seed=3)
    top = np.clip((roots[:, 2] - (eye_l[2] + 0.07)) / 0.05, 0, 1)
    under = hairlib.grow_cards('hair_under', roots, nrm, head_field, groom, length=0.05 + 0.03 * top, width=0.022,
                               offset=0.004 + 0.003 * top, segments=4, seed=5)
    roots2, nrm2, _ = hairlib.sample_region(hv, ht, scalp, 900 if not QUICK else 400, seed=7)
    top2 = np.clip((roots2[:, 2] - (eye_l[2] + 0.07)) / 0.05, 0, 1)
    over = hairlib.grow_cards('hair_over', roots2, nrm2, head_field, groom, length=0.06 + 0.05 * top2, width=0.016,
                              offset=0.009 + 0.008 * top2, segments=5, seed=9, clump=0.006)

    def beard_flow(p, n):
        d = np.zeros_like(p)
        d[:, 2] = -1.0
        d[:, 1] = -0.25
        d[:, 0] = np.sign(p[:, 0]) * 0.2
        return d - n * (d * n).sum(1, keepdims=True)
    broots, bn, _ = hairlib.sample_region(hv, ht, fm['beard'], 650 if not QUICK else 300, seed=13)
    beard = hairlib.grow_cards('beard', broots, bn, head_field, beard_flow, length=0.01, width=0.0042, offset=0.0018,
                               segments=2, seed=15, clump=0.001, taper=0.6)

    def brow_flow(p, n):
        d = np.zeros_like(p)
        d[:, 0] = np.sign(p[:, 0])
        d[:, 2] = 0.25
        return d - n * (d * n).sum(1, keepdims=True)
    brow_mask = ((co[:, 2] > eye_l[2] + 0.011) & (co[:, 2] < eye_l[2] + 0.028) & (np.abs(co[:, 0]) > 0.01) &
                 (np.abs(co[:, 0]) < 0.062) & (co[:, 1] < eye_l[1] + 0.005)).astype(float)
    wroots, wn, _ = hairlib.sample_region(hv, ht, brow_mask, 130, seed=17)
    brows = hairlib.grow_cards('brows', wroots, wn, head_field, brow_flow, length=0.011, width=0.0028, offset=0.0012,
                               segments=2, seed=19, clump=0.0005, taper=0.5)
    bpy.data.objects.remove(beard, do_unlink=True)
    bpy.data.objects.remove(brows, do_unlink=True)
    select_only(under, over)
    bpy.context.view_layer.objects.active = under
    bpy.ops.object.join()
    hair_obj = under
    hair_obj.name = 'kael_hair'
    hair_obj.data.materials.clear()
    hair_obj.data.materials.append(material('M_kael_hair', (0.1, 0.08, 0.06)))
    log('hair', triangle_count(hair_obj), 'tris')

    # ------------------------------------------------------------------ rig extras and weights
    def H(n):
        return Vector(R.head(n))
    for s, sign in (('r', -1), ('l', 1)):
        idx, pky, hb = H(f'index_01_{s}'), H(f'pinky_01_{s}'), H(f'hand_{s}')
        mid = H(f'middle_01_{s}')
        palm_c = (idx + pky + hb + mid) / 4
        blade = (idx - pky).normalized()
        fingers = (mid - hb).normalized()
        palm_n = blade.cross(fingers).normalized() * sign
        grip = palm_c + palm_n * 0.025 + fingers * 0.02
        add_bone(rig, f'weapon_{s}', grip, grip + blade * 0.12, parent=f'hand_{s}')
    belt_r = Vector((-0.2, -0.05, R.head('pelvis')[2] - 0.02))
    add_bone(rig, 'lantern', belt_r, belt_r + Vector((0, 0, -0.1)), parent='pelvis')
    for side, e, c in eyes:
        add_bone(rig, f'eye_{side}', Vector(c), Vector(c) + Vector((0, -0.03, 0)), parent='head')
    # weights
    for side, e, c in eyes:
        e.vertex_groups.new(name=f'eye_{side}').add(list(range(len(e.data.vertices))), 1.0, 'REPLACE')
        parent_to_rig(e, rig)
    for t in teeth:
        t.vertex_groups.new(name='head').add(list(range(len(t.data.vertices))), 1.0, 'REPLACE')
        parent_to_rig(t, rig)
    hair_obj.vertex_groups.new(name='head').add(list(range(len(hair_obj.data.vertices))), 1.0, 'REPLACE')
    parent_to_rig(hair_obj, rig)
    bones = {b.name for b in rig.data.bones}
    for vg in list(body.vertex_groups):
        if vg.name not in bones:
            body.vertex_groups.remove(vg)
    normalize_weights(body)
    # join eyes and teeth into single meshes per material
    select_only(*[e for _, e, _ in eyes])
    bpy.context.view_layer.objects.active = eyes[0][1]
    bpy.ops.object.join()
    eyes_obj = eyes[0][1]
    eyes_obj.name = 'kael_eyes'
    upper = [t for t in teeth if 'upper' in t.name]
    lower = [t for t in teeth if 'lower' in t.name]
    for t in upper:
        t.name = 'kael_teeth'
    for t in lower:
        t.name = 'kael_teeth_lower'
    bpy.data.objects.remove(body_src, do_unlink=True)

    # ------------------------------------------------------------------ export
    meshes = [o for o in (body, gear_obj, hair_obj, eyes_obj, *upper, *lower)]
    for o in meshes:
        for m in list(o.modifiers):
            if m.type != 'ARMATURE':
                o.modifiers.remove(m)
    export_glb(os.path.join(OUT, 'kael.glb'), [rig, *meshes], animations=False, morphs=True)
    manifest = {
        'name': 'Kael', 'height': float(verts_np(body)[:, 2].max()),
        'parts': {
            'kael_skin': {'kind': 'skin', 'tex': 'skin', 'clearcoat': 0.12},
            'kael_gear': {'kind': 'gear', 'tex': 'gear', 'emissive': 1.5},
            'kael_hair': {'kind': 'hair', 'tex': 'hair'},
            'kael_eyes': {'kind': 'eye', 'tex': 'eye'},
            'kael_teeth': {'kind': 'teeth'},
            'kael_teeth_lower': {'kind': 'teeth'},
        },
        'sockets': {'weapon_r': 'weapon_r', 'weapon_l': 'weapon_l', 'lantern': 'lantern'},
        'morphs': list(EXPRESSIONS.keys()),
    }
    json.dump(manifest, open(os.path.join(OUT, 'kael.json'), 'w'), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'kael.blend'))
    log('exported')

    if '--preview' in A:
        previews(body, gear_obj, hair_obj, eyes_obj, float(eye_l[2]), float(eye_l[1]))


def previews(body, gear_obj, hair_obj, eyes_obj, eye_z, eye_y):
    if True:
        setup_preview_material(gear_obj, 'gear', os.path.join(OUT, 'gear'), emissive=True)
        setup_preview_material(body, 'skin', os.path.join(OUT, 'skin'))
        hm = setup_preview_material(hair_obj, 'hair', os.path.join(OUT, 'hair'), alpha=True, metal_rough=False)
        hm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.45
        em = bpy.data.materials.new('eye_pv')
        em.use_nodes = True
        img = em.node_tree.nodes.new('ShaderNodeTexImage')
        img.image = bpy.data.images.load(os.path.join(OUT, 'eye_c.webp'))
        em.node_tree.links.new(img.outputs['Color'], em.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
        em.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.05
        eyes_obj.data.materials.clear()
        eyes_obj.data.materials.append(em)
        preview(os.path.join(WORK, 'kael_pv_full.png'), size=(900, 1300), cam_loc=(1.3, -3.7, 1.35), target=(0, 0, 1.0), lens=55, samples=48)
        preview(os.path.join(WORK, 'kael_pv_back.png'), size=(900, 1300), cam_loc=(-1.6, 3.5, 1.5), target=(0, 0, 1.05), lens=55, samples=48)
        preview(os.path.join(WORK, 'kael_pv_face.png'), size=(900, 900), cam_loc=(0.32, -0.8, eye_z + 0.02), target=(0, eye_y, eye_z - 0.04), lens=85, samples=64)
        log('previews rendered')


if '--retex' in A:
    retex()
if '--preview-only' in A:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(WORK, 'kael.blend'))
    ob = bpy.data.objects
    ez = [v.co for v in ob['kael_eyes'].data.vertices]
    previews(ob['kael_skin'], ob['kael_gear'], ob['kael_hair'], ob['kael_eyes'], float(max(v.z for v in ez) - 0.012), float(min(v.y for v in ez)))
elif '--retex' not in A:
    main()
