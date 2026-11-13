"""
Ethan Vale (v1, realistic pipeline).  blender -b --factory-startup -P ethan.py -- [--review outdir] [--face-only] [--samples N]

Base: MPFB / MakeHuman (CC0 assets) for anatomy, topology, UVs, eyes, brows, lashes, teeth and the game-engine skeleton.
On top: detail targets for Ethan's face, layered skin (SSS, roughness zones, pores, stubble, scalp shadow), refractive corneas,
real hair curves, and (next) his own outfit and gear. Judged against docs/references/ref-character-model-quality.png.
"""
import os
import sys
import math
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import detail_maps  # noqa: E402
import garments as Gm  # noqa: E402
import lookdev  # noqa: E402
import mpfb_util as M  # noqa: E402
import studio  # noqa: E402
import ethan_kit  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TEX = os.path.join(ROOT, 'public', 'assets', 'textures', 'detail')

MACRO = {'gender': 1.0, 'age': 0.56, 'muscle': 0.7, 'weight': 0.47, 'proportions': 0.66, 'height': 0.64,
         'race': {'african': 0.55, 'caucasian': 0.35, 'asian': 0.10}}
TARGETS = {
    'head-square': 0.35, 'chin-width-incr': 0.3, 'chin-prominent-incr': 0.22, 'chin-height-incr': 0.1,
    'l-cheek-bones-incr': 0.45, 'r-cheek-bones-incr': 0.45, 'l-cheek-volume-decr': 0.3, 'r-cheek-volume-decr': 0.3,
    'mouth-scale-horiz-decr': 0.15, 'mouth-lowerlip-volume-decr': 0.1, 'mouth-upperlip-volume-decr': 0.08,
    'nose-point-width-decr': 0.15, 'nose-width1-decr': 0.12, 'nose-hump-incr': 0.1,
    'eyebrows-trans-down': 0.22, 'l-eye-bag-incr': 0.15, 'r-eye-bag-incr': 0.15,
    'neck-scale-horiz-decr': 0.18, 'measure-neck-circ-decr': 0.15,
}
SKIN = 'young_african_male'
BROWS = 'eyebrow012'    # natural, full male brow (002 was a thin groomed arch)
LASHES = 'eyelashes01'  # sparse natural lashes (02 is a long glamour set)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M.enable()
    t0 = time.time()
    h = M.create_human(MACRO)
    for name, w in TARGETS.items():
        M.set_target(h, name, w)
    print('human + targets', round(time.time() - t0, 1), 's')
    M.skin(h, SKIN)
    parts = {}
    for kind, name in [('eyes', 'high-poly'), ('eyebrows', BROWS), ('eyelashes', LASHES), ('teeth', 'teeth_base')]:
        try:
            parts[kind + ':' + name] = M.add(h, kind, name)
        except Exception as e:  # noqa: BLE001
            print('FAILED', kind, name, e)
    rig = M.rig(h, 'game_engine')
    # look development
    pores = detail_maps.ensure_skin_detail(TEX)
    lookdev.region_masks(h, stubble=1.0)
    base_img = os.path.join(M.user_data(), 'skins', SKIN)
    base_img = os.path.join(base_img, next(f for f in os.listdir(base_img) if f.endswith('.png')))
    lookdev.skin(h, base_img, pores, {'sss_radius': (1.0, 0.33, 0.18), 'sss_scale': 0.0042, 'sat': 0.95, 'value': 0.95,
                                     'scalp_color': (0.16, 0.135, 0.125)})
    eye = parts.get('eyes:high-poly')
    if eye:
        lookdev.eyes(eye, os.path.join(M.user_data(), 'eyes', 'materials', 'brown_eye.png'))
    top = max(v.co.z for v in h.data.vertices)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = h.evaluated_get(dg).to_mesh()
    top = max(v.co.z for v in ev.vertices)
    h.evaluated_get(dg).to_mesh_clear()

    def sm(a, b, t):
        x = np.clip((t - a) / (b - a), 0, 1)
        return x * x * (3 - 2 * x)

    def mask(c, n):
        hz = c[:, 2] - top
        front = np.clip(-c[:, 1] / 0.09, 0, 1)                   # 0 at the back of the head, 1 at the forehead
        thr = -0.112 + 0.046 * front                              # hairline: low at the nape, high at the forehead
        temple = sm(0.055, 0.075, np.abs(c[:, 0])) * sm(0.2, 0.7, front)
        thr = thr + temple * 0.02
        thr = thr + 0.008 * np.clip(np.abs(c[:, 0]) / 0.06, 0, 1) ** 2 * front   # hairline curves back toward the temples
        ears = (sm(0.062, 0.07, np.abs(c[:, 0])) * (1 - sm(-0.115, -0.085, hz)))
        return sm(thr, thr + 0.012, hz) * (1 - ears) * (n[:, 2] > -0.35)

    def length(c):
        hz = c[:, 2] - top
        return 0.0035 + 0.0105 * sm(-0.09, -0.035, hz)           # low fade on the sides, ~14 mm on top

    def comb(c, n):
        d = np.zeros_like(c)
        d[:, 1] = 0.6
        d[:, 2] = -0.25
        d[:, 0] = np.sign(c[:, 0]) * 0.15
        return d

    # hair base: the scalp under the hair is painted toward the hair colour where hair grows (density follows the growth mask and is
    # strongest where the hair is longest), so gaps between strands read as dense short hair, not skin: the standard hair-cap trick
    mods = [(m, m.show_viewport) for m in h.modifiers]
    for m, _ in mods:
        m.show_viewport = False
    dg.update()
    ev = h.evaluated_get(dg).to_mesh()
    co = np.array([v.co for v in ev.vertices])
    nr = np.array([v.normal for v in ev.vertices])
    h.evaluated_get(dg).to_mesh_clear()
    for m, vis in mods:
        m.show_viewport = vis
    base = mask(co, nr) * (0.55 + 0.45 * sm(-0.09, -0.035, co[:, 2] - top))
    attr = h.data.color_attributes['masks']
    rgba = np.empty(len(attr.data) * 4, dtype=np.float32)
    attr.data.foreach_get('color', rgba)
    rgba = rgba.reshape(-1, 4)
    rgba[:, 0] = np.clip(base, 0, 1)
    attr.data.foreach_set('color', rgba.ravel())
    # hair length per scalp vertex (m): drives the game's hair shells (lookdev.hair_shell)
    hl = h.data.attributes.get('hair_len') or h.data.attributes.new('hair_len', 'FLOAT', 'POINT')
    hm = np.clip(mask(co, nr), 0, 1)
    hl.data.foreach_set('value', (length(co) * hm).astype(np.float32))
    hd = h.data.attributes.get('hair_mask') or h.data.attributes.new('hair_mask', 'FLOAT', 'POINT')
    hd.data.foreach_set('value', hm.astype(np.float32))
    lookdev.hair_curves(h, 'ethan_hair', count=70000, segments=6, length_fn=length, comb_fn=comb, curl=0.38, curl_freq=2.2,
                        radius=0.00007, melanin=0.97, redness=0.12, rough=0.36, mask_fn=mask, seed=11)
    ethan_kit.build_kit(h, rig, PH)
    print('built', round(time.time() - t0, 1), 's')
    return h, rig, parts, top


PH = os.path.join(ROOT, 'vendor', 'polyhaven', 'textures')


def outfit(h, rig):
    """HELIX Chronal Integration Program field suit: fitted undersuit, body-following composite plates, gloves, boots, harness,
    chronal spine module and light-lines. Everything is a shell of the body, so it fits and is skinned to the same skeleton."""
    boot = M.add(h, 'clothes', 'shoes03')  # before creating materials: MPFB purges unused materials when adding assets
    S = Gm.BodySpace(h, rig)
    suit_m = Gm.pbr('suit', PH, 'bi_stretch', tint=(0.075, 0.08, 0.09), tile=9, rough_add=0.08, normal_strength=1.4, desat=0.0)
    collar_m = Gm.pbr('suit_collar', PH, 'scuba_suede', tint=(0.06, 0.063, 0.07), tile=10, normal_strength=1.0, desat=0.0)
    glove_m = Gm.pbr('gloves', PH, 'fabric_leather_02', tint=(0.13, 0.12, 0.11), tile=7, normal_strength=1.2)
    boot_m = Gm.pbr('boots', PH, 'fabric_leather_02', tint=(0.1, 0.095, 0.09), tile=3, normal_strength=1.3, coat=0.12, desat=0.2)
    strap_m = Gm.pbr('strap', PH, 'fabric_leather_02', tint=(0.2, 0.18, 0.16), tile=5)
    plate_m = Gm.armour('plates', base=(0.055, 0.06, 0.068), edge=(0.2, 0.21, 0.22), wear=0.35)
    plate2_m = Gm.armour('plates_accent', base=(0.12, 0.125, 0.135), edge=(0.3, 0.31, 0.32), wear=0.3)
    glow_m = Gm.emissive('chronal', (0.35, 0.85, 1.0), 16.0)
    N, C, t, own = S.normals, S.centers, S.t, S.owner
    isb = S.is_bone
    hands = isb('hand_', 'index', 'middle', 'ring', 'pinky', 'thumb')
    feet = isb('foot_', 'ball_')
    calf = isb('calf_')
    lower = isb('lowerarm_')
    neck = isb('neck')
    head = isb('head')
    boot.data.materials.clear()
    boot.data.materials.append(boot_m)
    boots = feet | (calf & (t > 0.86))
    gloves = hands | (lower & (t > 0.94))
    collar = neck & (t < 0.42)
    suit = ~head & ~neck & ~hands & ~feet & ~boots & ~gloves
    Gm.shell(S, 'ethan_suit', suit, offset=0.0035, thickness=0.002, material=suit_m, subdiv=1)
    Gm.shell(S, 'ethan_collar', collar | (isb('spine_03') & (C[:, 2] > S.bones['neck_01'][0][2] - 0.035)), offset=0.006, thickness=0.004,
             material=collar_m, subdiv=1)
    Gm.shell(S, 'ethan_gloves', gloves, offset=0.0016, thickness=0.0015, material=glove_m, subdiv=1)
    ax = np.abs(C[:, 0])
    # plates: chest, back, segmented abdomen, shoulders, forearm bracers, thigh panels, shins
    zc = S.bones['clavicle_l'][0][2]
    z3 = S.bones['spine_03'][0][2]
    z2 = S.bones['spine_02'][0][2]
    z1 = S.bones['spine_01'][0][2]
    torso = ~isb('upperarm', 'lowerarm', 'hand', 'thigh', 'neck', 'head')
    chest = torso & (C[:, 2] > z3 + 0.07) & (C[:, 2] < zc - 0.015) & (ax < 0.13) & (N[:, 1] < -0.25)
    back = torso & (C[:, 2] > z2 + 0.06) & (C[:, 2] < zc - 0.035) & (ax < 0.12) & (N[:, 1] > 0.35)
    Gm.shell(S, 'ethan_plate_chest', chest, offset=0.012, thickness=0.007, material=plate_m, bevel=0.0025, subdiv=1, smooth_iters=4)
    Gm.shell(S, 'ethan_plate_back', back, offset=0.012, thickness=0.007, material=plate_m, bevel=0.0025, subdiv=1, smooth_iters=4)
    za, zb_ = z1 + 0.035, z3 + 0.055
    for i in range(3):
        a = za + (zb_ - za) * i / 3 + 0.005
        b = za + (zb_ - za) * (i + 1) / 3 - 0.005
        band = torso & (N[:, 1] < -0.3) & (ax < 0.095) & (C[:, 2] > a) & (C[:, 2] < b)
        Gm.shell(S, f'ethan_plate_abs{i}', band, offset=0.009, thickness=0.006, material=plate_m, bevel=0.002, subdiv=1, smooth_iters=4)
    for sd, sx in (('l', 1), ('r', -1)):
        up = own == f'upperarm_{sd}'
        rad = S.side(f'upperarm_{sd}')
        shoulder = up & (t < 0.42) & (rad @ np.array([sx * 0.7, 0, 0.7]) > 0.05)
        Gm.shell(S, f'ethan_pauldron_{sd}', shoulder, offset=0.013, thickness=0.008, material=plate_m, bevel=0.003, subdiv=1, smooth_iters=4)
        lw = own == f'lowerarm_{sd}'
        rad = S.side(f'lowerarm_{sd}')
        bracer = lw & (t > 0.32) & (t < 0.86) & (rad @ np.array([sx * 0.6, -0.2, 0.75]) > 0.0)
        Gm.shell(S, f'ethan_bracer_{sd}', bracer, offset=0.008, thickness=0.006, material=plate2_m, bevel=0.002, subdiv=1, smooth_iters=4)
        th = own == f'thigh_{sd}'
        rad = S.side(f'thigh_{sd}')
        thigh = th & (t > 0.22) & (t < 0.62) & (rad @ np.array([sx, -0.2, 0]) > 0.55)
        Gm.shell(S, f'ethan_thighplate_{sd}', thigh, offset=0.008, thickness=0.006, material=plate_m, bevel=0.002, subdiv=1, smooth_iters=4)
        cf = own == f'calf_{sd}'
        shin = cf & (t > 0.12) & (t < 0.66) & (N[:, 1] < -0.35)
        Gm.shell(S, f'ethan_shin_{sd}', shin, offset=0.010, thickness=0.007, material=plate_m, bevel=0.0025, subdiv=1, smooth_iters=4)
        # chronal light-line along the forearm bracer edge and the outer upper arm
        a_, b_ = S.bones[f'lowerarm_{sd}']
        Gm.surface_line(S, f'lowerarm_{sd}', lambda tt, sx=sx: (sx * 0.6, -0.2, 0.75), 0.3, 0.88, lift=0.0155, name=f'ethan_glow_fore_{sd}',
                        radius=0.0011, material=glow_m)
        Gm.surface_line(S, f'upperarm_{sd}', lambda tt, sx=sx: (sx * 0.2, -0.05, -1.0), 0.45, 0.95, lift=0.0045, name=f'ethan_glow_arm_{sd}',
                        radius=0.0009, material=glow_m)
    # spine light-line (down the back, over the suit)
    zs = np.linspace(S.bones['neck_01'][0][2] - 0.04, S.bones['pelvis'][1][2], 28)
    pts = [(0.0, 0.0, z) for z in zs]
    Gm.path_line(S, [(0, 0.3, z) for z in zs], lift=0.0048, name='ethan_glow_spine', radius=0.0012, material=glow_m, weight_bone='spine_02',
                 center=(0, 0.0, float(np.mean(zs))))
    # harness strap: left shoulder to right hip across the chest, and a belt
    A = np.array(S.bones['clavicle_l'][1]) + np.array([0.0, -0.02, 0.02])
    B = np.array(S.bones['thigh_r'][0]) + np.array([-0.05, -0.06, 0.08])
    guide = [A + (B - A) * k / 20 + np.array([0, -0.25, 0]) for k in range(21)]
    Gm.path_line(S, guide, lift=0.016, name='ethan_harness', radius=0.0022, width=0.042, material=strap_m, weight_bone='spine_03',
                 center=(0, 0.02, float((A[2] + B[2]) / 2)))
    zb = S.bones['pelvis'][0][2] + 0.075
    ring = [(0.3 * math.sin(a), -0.3 * math.cos(a) + 0.01, zb) for a in np.linspace(0, 2 * math.pi, 49)]
    Gm.path_line(S, ring, lift=0.009, name='ethan_belt', radius=0.003, width=0.045, material=strap_m, weight_bone='pelvis',
                 center=(0, 0.01, zb))
    return S


def export(h, rig, parts):
    """Game export: baked skin channels, face units (ARKit + visemes) as morph targets, helpers removed, garment modifiers applied,
    hair curves -> hair cards, material recipes as glTF extras, textures copied next to the GLB."""
    import json
    import shutil

    import bmesh
    from bl_ext.user_default.mpfb.services.faceservice import FaceService
    out = os.path.join(ROOT, 'public', 'assets', 'characters', 'ethan')
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    skin_m = bpy.data.materials['skin']
    lookdev.bake(h, skin_m, 'DIFFUSE', os.path.join(out, 'ethan_skin_color.png'), 2048)
    lookdev.bake(h, skin_m, 'ROUGHNESS', os.path.join(out, 'ethan_skin_rough.png'), 2048)
    print('baked skin', round(time.time() - t0, 1), 's')
    # body: bake proportions, add facial animation targets, drop the hidden helper geometry
    M.bake_targets(h)
    FaceService.load_targets(h, load_microsoft_visemes=True, load_meta_visemes=False, load_arkit_faceunits=True)
    # eyes, brows, lashes, teeth: same face shape keys + skin weights as the body (must run before the helpers are deleted)
    proxies = [(ob, k.split(':')[0], k.split(':')[1]) for k, ob in parts.items() if k.split(':')[0] in ('eyes', 'eyebrows', 'eyelashes', 'teeth')]
    M.bind_proxies(h, rig, proxies, cornea=next((o for o in bpy.data.objects if o.name.endswith('.cornea')), None))
    # baked occlusion: lids/lashes over the sclera, lips/cheeks over the teeth (shadow maps cannot resolve either)
    occl = [o for o in (h, parts.get('eyelashes:' + LASHES)) if o is not None]
    if parts.get('eyes:high-poly'):
        ao = lookdev.vertex_ao(parts['eyes:high-poly'], occl, distance=0.012, rays=96, floor=0.15)
        print('  eye AO min/mean', round(float(ao.min()), 3), round(float(ao.mean()), 3))
    if parts.get('teeth:teeth_base'):
        ao = lookdev.vertex_ao(parts['teeth:teeth_base'], [h], distance=0.03, rays=64, floor=0.08)
        parts['teeth:teeth_base'].data.materials[0]['ft'] = json.dumps({'type': 'teeth'})
        print('  teeth AO min/mean', round(float(ao.min()), 3), round(float(ao.mean()), 3))
    helper_idx = {g.index for g in h.vertex_groups if g.name in ('HelperGeometry', 'JointCubes', 'ft_hidden')}
    bm = bmesh.new()
    bm.from_mesh(h.data)
    dl = bm.verts.layers.deform.active
    kill = [v for v in bm.verts if dl and any(gi in helper_idx and w > 0.5 for gi, w in v[dl].items())]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(h.data)
    bm.free()
    for mod in list(h.modifiers):
        if mod.type == 'MASK':
            h.modifiers.remove(mod)
    print('body verts', len(h.data.vertices), 'shape keys', len(h.data.shape_keys.key_blocks) if h.data.shape_keys else 0)
    # skin material for the engine: baked colour + roughness, pores as a tiled detail normal
    em = bpy.data.materials.new('ethan_skin')
    em.use_nodes = True
    nt = em.node_tree
    b = nt.nodes['Principled BSDF']
    for ch, path, cs in (('Base Color', 'ethan_skin_color.png', 'sRGB'), ('Roughness', 'ethan_skin_rough.png', 'Non-Color')):
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = bpy.data.images.load(os.path.join(out, path))
        tn.image.colorspace_settings.name = cs
        nt.links.new(tn.outputs['Color'], b.inputs[ch])
    em['ft'] = json.dumps({'type': 'skin', 'pores': 'textures/detail/skin_pores_n.png', 'pore_tile': 34, 'pore_strength': 0.5,
                           'sss_color': [0.85, 0.3, 0.2], 'sss_scale': 0.0042})
    for i, mm in enumerate(h.data.materials):
        if mm and mm.name == 'skin':
            h.data.materials[i] = em
    # eyes: plain texture link for export (the hue tweak lives in the engine shader), cornea keeps transmission
    eye = parts.get('eyes:high-poly')
    if eye:
        nt2 = eye.data.materials[0].node_tree
        tex = next(n for n in nt2.nodes if n.type == 'TEX_IMAGE')
        bsdf = next(n for n in nt2.nodes if n.type == 'BSDF_PRINCIPLED')
        nt2.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        eye.data.materials[0]['ft'] = json.dumps({'type': 'eye'})
    cm = bpy.data.materials.get('cornea')
    if cm:
        cm['ft'] = json.dumps({'type': 'cornea'})
    # garments: apply everything but the armature
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in [o for o in bpy.data.objects if o.name.startswith('ethan_') and o.type == 'MESH']:
        arm = [m for m in ob.modifiers if m.type == 'ARMATURE']
        for m in arm:
            m.show_viewport = False
        dg.update()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        ob.modifiers.clear()
        ob.data = me
        a = ob.modifiers.new('Armature', 'ARMATURE')
        a.object = rig
    # hair: curves -> cards
    hc = bpy.data.objects.get('ethan_hair')
    # hair = shells (dense coily volume, lookdev.hair_shell) + a sparse set of strand cards for flyaways along the silhouette
    shell = lookdev.hair_shell(h, rig, 'ethan_hair_shell', color=(0.018, 0.013, 0.011))
    print('  hair shell verts', len(shell.data.vertices), 'shape keys', len(shell.data.shape_keys.key_blocks) - 1 if shell.data.shape_keys else 0)
    cards = lookdev.hair_cards(hc, every=10, width=0.0012, name='ethan_hair_cards', surface=h)
    cards.parent = rig
    cards.matrix_parent_inverse = rig.matrix_world.inverted()
    a = cards.modifiers.new('Armature', 'ARMATURE')
    a.object = rig
    bpy.data.objects.remove(hc)
    # pbr textures the engine needs (1k copies of the downloaded sets)
    texroot = os.path.join(ROOT, 'public', 'assets', 'textures', 'pbr')
    used = {json.loads(m['ft'])['tex'] for m in bpy.data.materials if 'ft' in m and json.loads(m['ft']).get('type') == 'pbr'}
    for tid in used:
        for kind in ('diff', 'nor_gl', 'rough'):
            src = os.path.join(PH, tid, f'{tid}_{kind}_2k.jpg')
            if os.path.exists(src):
                img = bpy.data.images.load(src)
                img.scale(1024, 1024)
                dst = os.path.join(texroot, tid, f'{tid}_{kind}.jpg')
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                img.filepath_raw = dst
                img.file_format = 'JPEG'
                img.save()
                bpy.data.images.remove(img)
    shutil.copy(os.path.join(TEX, 'skin_pores_n.png'), os.path.join(ROOT, 'public', 'assets', 'textures', 'detail', 'skin_pores_n.png')) \
        if os.path.abspath(TEX) != os.path.join(ROOT, 'public', 'assets', 'textures', 'detail') else None
    # the engine rebuilds pbr / armour / emissive materials from their recipes and loads the fabric scans itself: do not embed them
    for m_ in bpy.data.materials:
        if 'ft' in m_ and json.loads(m_['ft']).get('type') in ('pbr', 'armour', 'emissive') and m_.node_tree:
            for n_ in [n for n in m_.node_tree.nodes if n.type == 'TEX_IMAGE']:
                m_.node_tree.nodes.remove(n_)
    # export
    objs = [rig] + [o for o in bpy.data.objects if o.type == 'MESH' and (o.parent == rig or o.parent == h)]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(out, 'ethan.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT', export_image_format='AUTO',
                              export_skins=True, export_morph=True, export_morph_normal=False, export_animations=False,
                              export_vertex_color='NAME', export_vertex_color_name='GAME', export_all_vertex_colors=False,
                              export_extras=True, export_def_bones=False)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB', 'objects', [o.name for o in objs], round(time.time() - t0, 1), 's')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    h, rig, parts, top = build()
    if '--review' in argv:
        out = argv[argv.index('--review') + 1]
        samples = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 64
        studio.setup(samples=samples)
        if '--body-only' in argv:
            for nm, yaw, pitch in (('front', 0, 2), ('threequarter', -32, 6), ('back', 180, 2)):
                studio.camera((0, 0, top * 0.52), top * 1.65, yaw, pitch, 50)
                studio.render(os.path.join(out, f'ethan_{nm}.png'), (800, 1200))
        elif '--face-only' in argv:
            for nm, yaw, dist in (('face', -8, 0.62), ('face34', -38, 0.7)):
                studio.camera((0, -0.02, top - 0.12), dist, yaw, 3, 85)
                studio.render(os.path.join(out, f'ethan_{nm}.png'), (1000, 1000))
        else:
            studio.review_set(out, 'ethan', height=top, face_z=top - 0.12, samples=samples)
    if '--export' in argv:
        export(h, rig, parts)
