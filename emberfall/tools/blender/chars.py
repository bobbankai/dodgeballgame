"""Build the cast.  blender -b -P emberfall/tools/blender/chars.py -- <name> [--preview out.png] [--export]

Each character: MPFB human (CC0 MakeHuman assets) + MakeHuman clothes as base layers + procedural armour
pieces, re-materialed with shared tiling PBR sets (assets/tex), AO baked into vertex colours, expression
morphs, spring bones for loose cloth, exported as assets/chars/<name>.glb.
"""
import bpy
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import mh  # noqa
import charlib  # noqa
import outfit as O  # noqa
import pieces as P  # noqa
from mathutils import Vector  # noqa

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'chars')
WORK = '/opt/raw/work'


def mat(name, tex, tint, **kw):
    return O.tiling_material(name, tex, tint, **kw)


def body_for_pieces(base, rig, layers=()):
    masks = [m for m in base.modifiers if m.type == 'MASK' and m.name != 'Hide helpers']
    for m in masks:
        m.show_viewport = False
    b = O.Body(base, rig)
    for m in masks:
        m.show_viewport = True
    for l in layers:
        if l:
            b.add_layer(l)
    return b


def finish(name, base, rig, clothes, pieces, spec, tiling_objs, rigid=None, torso=()):
    """Common tail: helpers, masks, materials, UVs, skinning, AO, export prep."""
    charlib.remove_helpers(base)
    O.apply_body_masks(base)
    charlib.convert_human_materials(base, rig, spec, os.path.join(WORK, name))
    for o in tiling_objs:
        O.box_uv(o, 0.5)
    for o in pieces:
        if rigid and o.name in rigid:
            O.rigid_to_bone(o, rig, rigid[o.name])
        else:
            O.skin_to_body(o, base, rig, torso_only=o.name in torso)
    add_sockets(rig)
    charlib.add_eye_bones(rig, eyes_of(rig))
    ao_objs = [base] + clothes + pieces
    O.bake_ao_vertex([o for o in ao_objs if o], samples=32, distance=0.2)


def add_sockets(rig):
    """Empties on the hands / hips where weapons attach (exported as child nodes of the joints)."""
    import animlib as A
    sk = A.Skel(rig)
    sockets = {
        'socket_r': ('hand_r', sk.rest['hand_r'] @ sk.grip['r']),
        'socket_l': ('hand_l', sk.rest['hand_l'] @ sk.grip['l']),
    }
    # scabbard on the left hip: edge up, blade toward the back, slung at 40 degrees
    pel = sk.rest['pelvis'].to_translation()
    hipM = sk.grip_world(Vector((0.16, -0.21, pel.z + 0.13)), Vector((0.08, 0.85, -0.52)), Vector((0.0, 0.52, 0.85)))
    sockets['socket_hip'] = ('pelvis', hipM)
    sockets['socket_back'] = ('spine_03', sk.grip_world(Vector((0.0, 0.16, 1.15)), Vector((0.6, 0.0, 0.8)), Vector((0, 1, 0))))
    for name, (bone, M) in sockets.items():
        e = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(e)
        e.empty_display_size = 0.05
        e.parent = rig
        e.parent_type = 'BONE'
        e.parent_bone = bone
        e.matrix_world = rig.matrix_world @ M


def preview(rig, path, views=((0, 'front'), (200, 'back'))):
    scn = bpy.context.scene
    cam = bpy.data.objects.new('pcam', bpy.data.cameras.new('pcam'))
    scn.collection.objects.link(cam)
    cam.data.lens = 60
    scn.camera = cam
    sun = bpy.data.objects.new('psun', bpy.data.lights.new('psun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scn.collection.objects.link(sun)
    rim = bpy.data.objects.new('prim', bpy.data.lights.new('prim', 'SUN'))
    rim.data.energy = 2.0
    rim.data.color = (0.7, 0.8, 1.0)
    rim.rotation_euler = (math.radians(70), 0, math.radians(200))
    scn.collection.objects.link(rim)
    w = bpy.data.worlds.new('pw')
    scn.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.22, 0.24, 0.28, 1)
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 24
    scn.cycles.use_denoising = True
    scn.render.resolution_x = 420
    scn.render.resolution_y = 640
    scn.view_settings.view_transform = 'AgX'
    files = []
    for ang, tag in views:
        a = math.radians(ang)
        r = 4.0
        cam.location = (math.sin(a) * r * 0.45 + math.sin(a) * 0.0, -math.cos(a) * r, 1.0)
        cam.location = (r * math.sin(a), -r * math.cos(a), 1.0)
        cam.rotation_euler = (math.radians(89), 0, a)
        f = path.replace('.png', f'_{tag}.png')
        scn.render.filepath = f
        bpy.ops.render.render(write_still=True)
        files.append(f)
    return files


# ------------------------------------------------------------------ the cast

def kaede():
    spec = {
        'name': 'kaede',
        'phenotype': {'gender': 0.0, 'age': 0.45, 'muscle': 0.68, 'weight': 0.42, 'height': 0.55, 'proportions': 0.8,
                      'cupsize': 0.4, 'firmness': 0.6, 'race': {'asian': 0.8, 'caucasian': 0.15, 'african': 0.05}},
        'skin': 'young_asian_female', 'hair': 'ponytail01', 'hair_material': 'dariush086_ponytail01_black',
        'eyebrows': 'eyebrow010', 'eyelashes': 'eyelashes02', 'eye_texture': 'brown',
    }
    mh.clear_scene()
    base = mh.build_human(spec)
    rig = mh.find_rig(base)
    suit = O.add_clothes(base, 'culturalibre_heroine_suit_2')
    pants = O.add_clothes(base, 'toigo_harem_pants')
    kimono = O.add_clothes(base, 'mindfront_kimono')
    boots = O.add_clothes(base, 'culturalibre_heroine_boots_1')
    gloves = O.add_clothes(base, 'culturalibre_hero-heroine_gloves_2')
    charlib.bake_shape(base)
    charlib.add_expressions(base, rig, race='asian')
    pelvis = O.Body.bone(type('x', (), {'rig': rig})(), 'pelvis')[0] if False else None
    b = body_for_pieces(base, rig, [suit, pants, kimono, boots, gloves])
    hip_z = b.bone('pelvis')[0].z
    waist_z = b.bone('spine_01')[0].z
    neck_z = b.bone('neck_01')[0].z
    O.cut_below(kimono, hip_z - 0.16)
    b.layers = b.layers[:1]
    for l in (suit, pants, kimono, boots, gloves):
        b.add_layer(l)

    M = {
        'suit': mat('cloth_suit', 'cloth_weave', (0.07, 0.07, 0.08), sheen=0.3, scale=2.0),
        'pants': mat('cloth_pants', 'cloth_weave', (0.16, 0.15, 0.15), sheen=0.45, scale=2.0),
        'kimono': mat('cloth_kimono', 'cloth_jacquard', (0.04, 0.05, 0.11), sheen=0.5, scale=1.5),
        'boots': mat('leather_boots', 'leather', (0.06, 0.05, 0.045), scale=1.5),
        'gloves': mat('leather_gloves', 'leather', (0.16, 0.09, 0.05), scale=2.0),
        'cuirass': mat('leather_cuirass', 'leather_brown', (0.6, 0.48, 0.42), scale=1.0),
        'obi': mat('cloth_obi', 'cloth_weave', (0.45, 0.035, 0.03), sheen=0.5, scale=2.0),
        'lacquer': mat('lacquer_red', 'lacquer_worn', (0.95, 0.75, 0.72), scale=1.2, normal_strength=0.5, rough_fixed=0.45, coat=1.0, coat_rough=0.14),
        'lacquer_black': mat('lacquer_black', 'steel_gray', (0.05, 0.045, 0.05), scale=1.0, normal_strength=0.12, rough_fixed=0.4, coat=1.0, coat_rough=0.12),
        'steel': mat('metal_steel', 'steel', (0.85, 0.85, 0.88), metal=1.0, scale=1.2, aniso=0.35),
        'gold': mat('metal_gold', 'steel_gray', (1.0, 0.72, 0.36), metal=1.0, scale=2.0),
    }
    for o, k in ((suit, 'suit'), (pants, 'pants'), (kimono, 'kimono'), (boots, 'boots'), (gloves, 'gloves')):
        O.set_material(o, M[k])

    pcs = []
    cu = P.lamellar_cuirass(b, 'cuirass', M['lacquer_black'], top=neck_z - 0.1, bottom=waist_z + 0.02, rows=6, off=0.012, thick=0.006)
    pcs.append(cu)
    b.add_layer(cu)
    obi = P.band(b, 'obi', M['obi'], waist_z - 0.05, waist_z + 0.075, off=0.012, thick=0.005)
    pcs.append(obi)
    b.add_layer(obi)
    pl = P.lamellar_pauldron(b, 'pauldron_l', M['lacquer'], 'l', rows=4, off=0.03)
    pl = P.join(pl, 'pauldron_l')
    pcs.append(pl)

    def outer(p, h, axis):
        rel = p - h
        rel = rel - axis * rel.dot(axis)
        return rel.dot(Vector((0, 0, 1))) > -0.012 or rel.dot(Vector((0, -1, 0))) > 0.02
    for s in ('l', 'r'):
        g = P.limb_shell(b, f'kote_{s}', M['steel'], f'lowerarm_{s}', 0.25, 0.9, off=0.012, side_fn=outer, thick=0.004)
        pcs.append(g)
    rigid = {'pauldron_l': 'upperarm_l', 'kote_l': 'lowerarm_l', 'kote_r': 'lowerarm_r'}
    finish('kaede', base, rig, [suit, pants, kimono, boots, gloves], pcs, spec,
           [suit, pants, kimono, boots, gloves] + pcs, rigid, torso=('cuirass', 'obi'))
    return rig, spec


def assemble(spec, clothes, make_pieces, mats, cuts=None, expressions=True):
    """Generic character: spec -> MPFB human; clothes = [(mh_asset, mat_key)]; make_pieces(b, M, ctx) returns
    (pieces, rigid{name: bone}, torso{names}); mats = {key: material}."""
    mh.clear_scene()
    if callable(mats):
        mats = mats()
    base = mh.build_human(spec)
    rig = mh.find_rig(base)
    objs = []
    for asset, key in clothes:
        o = O.add_clothes(base, asset)
        if o is None:
            print('could not add', asset)
            continue
        objs.append((o, key))
    charlib.bake_shape(base)
    if expressions:
        charlib.add_expressions(base, rig, race=spec.get('race_units', 'caucasian'))
    cloth_objs = [o for o, _ in objs]
    b = body_for_pieces(base, rig, cloth_objs)
    ctx = {'hip_z': b.bone('pelvis')[0].z, 'waist_z': b.bone('spine_01')[0].z, 'neck_z': b.bone('neck_01')[0].z,
           'base': base, 'rig': rig, 'clothes': dict((k, o) for o, k in objs)}
    if cuts:
        cuts(ctx)
        b.layers = b.layers[:1]
        for o in cloth_objs:
            b.add_layer(o)
    for o, key in objs:
        O.set_material(o, mats[key])
    pcs, rigid, torso = make_pieces(b, mats, ctx)
    finish(spec['name'], base, rig, cloth_objs, pcs, spec, cloth_objs + pcs, rigid, torso=torso)
    return rig, spec


def eyes_of(rig):
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.parent is rig and ('high-poly' in o.name or 'low-poly' in o.name):
            return o
    return None


def hollow_mats():
    return {
        'tunic': mat('cloth_hollow_tunic', 'cloth_weave', (0.11, 0.035, 0.03), sheen=0.3, scale=2.0),
        'tunic2': mat('cloth_hollow_tunic2', 'cloth_jacquard', (0.06, 0.055, 0.06), sheen=0.3, scale=1.5),
        'pants': mat('cloth_hollow_pants', 'cloth_weave', (0.05, 0.045, 0.045), sheen=0.3, scale=2.0),
        'leather': mat('leather_hollow', 'leather', (0.07, 0.05, 0.04), scale=1.5),
        'iron': mat('metal_hollow_iron', 'rust_heavy', (0.62, 0.58, 0.56), metal=0.7, scale=1.2),
        'iron_dark': mat('metal_hollow_dark', 'steel', (0.22, 0.21, 0.22), metal=0.9, scale=1.0),
        'bronze': mat('metal_hollow_bronze', 'steel_gray', (0.62, 0.42, 0.22), metal=1.0, scale=1.2),
        'mask': mat('mask_hollow', 'steel_gray', (0.78, 0.75, 0.7), scale=1.0, normal_strength=0.15, rough_fixed=0.42),
        'fur': mat('leather_hollow_fur', 'leather_brown', (0.35, 0.28, 0.24), scale=0.8),
    }


def _mask_crack(m):
    m['cracks'] = 1
    return m


def hollow_footman():
    spec = {'name': 'hollow_footman', 'ash': True, 'eye_glow': (1.0, 0.45, 0.12, 6.0),
            'phenotype': {'gender': 1.0, 'age': 0.5, 'muscle': 0.65, 'weight': 0.55, 'height': 0.55, 'proportions': 0.6},
            'skin': 'young_asian_male', 'hair': None, 'eyebrows': 'eyebrow004', 'eyelashes': 'eyelashes01', 'eye_texture': 'brown'}
    def M():
        m = hollow_mats()
        _mask_crack(m['mask'])
        return m
    clothes = [('rehmanpolanski_viking_tunic', 'tunic'), ('toigo_wool_pants', 'pants'), ('punkduck_medieval_boots', 'leather'),
               ('javherre_casco_caballero_templario_templar_knight_helmet', 'iron_dark')]

    def make(b, M, ctx):
        pcs = []
        cu = P.lamellar_cuirass(b, 'cuirass', M['iron'], top=ctx['neck_z'] - 0.1, bottom=ctx['waist_z'] - 0.02, rows=7, off=0.018, thick=0.006)
        pcs.append(cu)
        b.add_layer(cu)
        for sd in ('l', 'r'):
            pl = P.join(P.lamellar_pauldron(b, f'pauldron_{sd}', M['iron'], sd, rows=3, off=0.035), f'pauldron_{sd}')
            pcs.append(pl)
        mk = P.mask(b, 'mask', M['mask'], eyes_of(ctx['rig']))
        pcs.append(mk)
        belt = P.band(b, 'belt', M['leather'], ctx['waist_z'] - 0.06, ctx['waist_z'] + 0.02, off=0.03, thick=0.006)
        pcs.append(belt)
        return pcs, {'pauldron_l': 'upperarm_l', 'pauldron_r': 'upperarm_r', 'mask': 'head'}, ('cuirass', 'belt')
    return assemble(spec, clothes, make, M)


def hollow_spearman():
    spec = {'name': 'hollow_spearman', 'ash': True, 'eye_glow': (1.0, 0.45, 0.12, 6.0),
            'phenotype': {'gender': 1.0, 'age': 0.5, 'muscle': 0.55, 'weight': 0.45, 'height': 0.7, 'proportions': 0.7},
            'skin': 'young_caucasian_male', 'hair': None, 'eyebrows': 'eyebrow004', 'eyelashes': 'eyelashes01', 'eye_texture': 'brown'}
    def M():
        m = hollow_mats()
        _mask_crack(m['mask'])
        return m
    clothes = [('rehmanpolanski_viking_tunic', 'tunic2'), ('toigo_wool_pants', 'pants'), ('punkduck_medieval_boots', 'leather'),
               ('grinsegold_corinthian_helmet', 'bronze')]

    def make(b, M, ctx):
        pcs = []
        cu = P.lamellar_cuirass(b, 'cuirass', M['bronze'], top=ctx['neck_z'] - 0.1, bottom=ctx['waist_z'] + 0.0, rows=5, off=0.018, thick=0.006)
        pcs.append(cu)
        b.add_layer(cu)
        mk = P.mask(b, 'mask', M['mask'], eyes_of(ctx['rig']))
        pcs.append(mk)
        for s_ in ('l', 'r'):
            def outer(p, h, axis):
                rel = p - h
                rel = rel - axis * rel.dot(axis)
                return rel.dot(Vector((0, 0, 1))) > -0.012 or rel.dot(Vector((0, -1, 0))) > 0.02
            pcs.append(P.limb_shell(b, f'kote_{s_}', M['bronze'], f'lowerarm_{s_}', 0.2, 0.9, off=0.016, side_fn=outer, thick=0.004))
        return pcs, {'mask': 'head', 'kote_l': 'lowerarm_l', 'kote_r': 'lowerarm_r'}, ('cuirass',)
    return assemble(spec, clothes, make, M)


def hollow_brute():
    spec = {'name': 'hollow_brute', 'ash': True, 'eye_glow': (1.0, 0.35, 0.08, 8.0),
            'phenotype': {'gender': 1.0, 'age': 0.6, 'muscle': 1.0, 'weight': 0.95, 'height': 0.9, 'proportions': 0.4},
            'skin': 'middleage_asian_male', 'hair': None, 'eyebrows': 'eyebrow004', 'eyelashes': 'eyelashes01', 'eye_texture': 'brown'}
    M = hollow_mats
    clothes = [('rehmanpolanski_viking_tunic', 'fur'), ('toigo_wool_pants', 'pants'), ('punkduck_medieval_boots', 'leather'),
               ('culturalibre_skull_helmet', 'mask')]

    def make(b, M, ctx):
        pcs = []
        cu = P.lamellar_cuirass(b, 'cuirass', M['iron_dark'], top=ctx['neck_z'] - 0.12, bottom=ctx['waist_z'] - 0.04, rows=4, off=0.03, thick=0.012)
        pcs.append(cu)
        b.add_layer(cu)
        for sd in ('l', 'r'):
            pcs.append(P.join(P.lamellar_pauldron(b, f'pauldron_{sd}', M['iron_dark'], sd, rows=3, off=0.05), f'pauldron_{sd}'))
        belt = P.band(b, 'belt', M['leather'], ctx['waist_z'] - 0.08, ctx['waist_z'] + 0.03, off=0.04, thick=0.01)
        pcs.append(belt)
        return pcs, {'pauldron_l': 'upperarm_l', 'pauldron_r': 'upperarm_r'}, ('cuirass', 'belt')
    return assemble(spec, clothes, make, M)


def hollow_wraith():
    spec = {'name': 'hollow_wraith', 'ash': True, 'eye_glow': (0.35, 0.7, 1.0, 9.0),
            'phenotype': {'gender': 0.0, 'age': 0.4, 'muscle': 0.5, 'weight': 0.3, 'height': 0.6, 'proportions': 0.9},
            'skin': 'young_caucasian_female', 'hair': None, 'eyebrows': 'eyebrow010', 'eyelashes': 'eyelashes02', 'eye_texture': 'grey'}
    def M():
        m = hollow_mats()
        m['ninja'] = mat('cloth_wraith', 'cloth_weave', (0.025, 0.027, 0.035), sheen=0.5, scale=2.0)
        m['hood'] = mat('cloth_wraith_hood', 'cloth_jacquard', (0.04, 0.045, 0.06), sheen=0.5, scale=1.5)
        return m
    clothes = [('mindfront_f_ninja', 'ninja'), ('culturalibre_hero-heroine_hood_1', 'hood')]

    def make(b, M, ctx):
        return [], {}, ()
    return assemble(spec, clothes, make, M)


def oren():
    """Kaede's master: an old smith and sword-master. Indigo robe, leather apron, grey hair."""
    spec = {'name': 'oren', 'race_units': 'asian', 'hair_grey': 0.9,
            'phenotype': {'gender': 1.0, 'age': 0.86, 'muscle': 0.62, 'weight': 0.5, 'height': 0.5, 'proportions': 0.6,
                          'race': {'asian': 0.85, 'caucasian': 0.15, 'african': 0.0}},
            'skin': 'old_asian_male', 'hair': 'short02', 'eyebrows': 'eyebrow007', 'eyelashes': 'eyelashes01', 'eye_texture': 'brown'}
    def M():
        return {
            'robe': mat('cloth_robe', 'cloth_weave', (0.05, 0.065, 0.12), sheen=0.45, scale=2.0),
            'boots': mat('leather_boots', 'leather', (0.07, 0.055, 0.045), scale=1.5),
            'apron': mat('leather_apron', 'leather_brown', (0.42, 0.3, 0.22), scale=1.0),
            'obi': mat('cloth_obi', 'cloth_jacquard', (0.2, 0.14, 0.08), sheen=0.4, scale=1.5),
        }
    clothes = [('donitz_monk_robe', 'robe'), ('toigo_mj_cloth_shoes', 'boots')]

    def make(b, M, ctx):
        pcs = []
        obi = P.band(b, 'obi', M['obi'], ctx['waist_z'] - 0.06, ctx['waist_z'] + 0.06, off=0.015, thick=0.006)
        pcs.append(obi)
        b.add_layer(obi)
        ap = P.cuirass(b, 'apron', M['apron'], top=ctx['neck_z'] - 0.2, bottom=ctx['hip_z'] - 0.1, off=0.03, thick=0.006, front_only=True)
        pcs.append(ap)
        return pcs, {}, ('obi',)
    return assemble(spec, clothes, make, M)


def ren():
    """Kaede's brother, fourteen: plain kimono over trousers, messy black hair"""
    spec = {'name': 'ren', 'race_units': 'asian', 'hair_dye': (0.035, 0.03, 0.028),
            'phenotype': {'gender': 1.0, 'age': 0.27, 'muscle': 0.45, 'weight': 0.4, 'height': 0.42, 'proportions': 0.5,
                          'race': {'asian': 0.85, 'caucasian': 0.15, 'african': 0.0}},
            'skin': 'young_asian_male', 'hair': 'cortu_short_messy_hair', 'eyebrows': 'eyebrow004', 'eyelashes': 'eyelashes01', 'eye_texture': 'brown'}
    def M():
        return {
            'kimono': mat('cloth_kimono_ren', 'cloth_weave', (0.32, 0.2, 0.1), sheen=0.4, scale=2.0),
            'pants': mat('cloth_pants', 'cloth_weave', (0.1, 0.1, 0.11), sheen=0.4, scale=2.0),
            'shoes': mat('cloth_shoes', 'cloth_weave', (0.08, 0.07, 0.06), scale=2.0),
            'obi': mat('cloth_obi', 'cloth_jacquard', (0.1, 0.12, 0.2), sheen=0.4, scale=1.5),
        }
    clothes = [('toigo_harem_pants', 'pants'), ('mindfront_kimono', 'kimono'), ('toigo_mj_cloth_shoes', 'shoes')]

    def cuts(ctx):
        O.cut_below(ctx['clothes']['kimono'], ctx['hip_z'] - 0.12)

    def make(b, M, ctx):
        obi = P.band(b, 'obi', M['obi'], ctx['waist_z'] - 0.04, ctx['waist_z'] + 0.05, off=0.012, thick=0.005)
        return [obi], {}, ('obi',)
    return assemble(spec, clothes, make, M, cuts=cuts)


def mika():
    """the village elder: an old woman in a plum robe, grey hair in a bun"""
    spec = {'name': 'mika', 'race_units': 'asian', 'hair_grey': 0.95,
            'phenotype': {'gender': 0.0, 'age': 0.9, 'muscle': 0.35, 'weight': 0.45, 'height': 0.3, 'proportions': 0.5,
                          'race': {'asian': 0.9, 'caucasian': 0.1, 'african': 0.0}},
            'skin': 'old_asian_female', 'hair': 'rehmanpolanski_hair_bun_brown', 'eyebrows': 'eyebrow011', 'eyelashes': 'eyelashes01', 'eye_texture': 'brown'}
    def M():
        return {
            'robe': mat('cloth_robe_mika', 'cloth_jacquard', (0.16, 0.07, 0.11), sheen=0.45, scale=1.5),
            'shoes': mat('cloth_shoes', 'cloth_weave', (0.08, 0.07, 0.06), scale=2.0),
            'obi': mat('cloth_obi', 'cloth_weave', (0.3, 0.25, 0.15), sheen=0.4, scale=2.0),
        }
    clothes = [('donitz_monk_robe', 'robe'), ('toigo_mj_cloth_shoes', 'shoes')]

    def make(b, M, ctx):
        obi = P.band(b, 'obi', M['obi'], ctx['waist_z'] - 0.07, ctx['waist_z'] + 0.06, off=0.015, thick=0.006)
        return [obi], {}, ('obi',)
    return assemble(spec, clothes, make, M)


def _hisame(name, hollow):
    """the shrine maiden of the Drowned Shrine: white kosode, vermilion hakama, long black hair.
    The Hollowed version has ash skin with glowing blue cracks and a darkened, rain-soaked kosode."""
    spec = {'name': name, 'race_units': 'asian', 'hair_dye': (0.03, 0.028, 0.03),
            'phenotype': {'gender': 0.0, 'age': 0.42, 'muscle': 0.45, 'weight': 0.35, 'height': 0.55, 'proportions': 0.85,
                          'cupsize': 0.4, 'firmness': 0.6, 'race': {'asian': 0.85, 'caucasian': 0.15, 'african': 0.0}},
            'skin': 'young_asian_female', 'hair': 'long01', 'eyebrows': 'eyebrow010', 'eyelashes': 'eyelashes02', 'eye_texture': 'brown'}
    if hollow:
        spec.update({'ash': True, 'eye_glow': (0.35, 0.7, 1.0, 9.0), 'eye_texture': 'grey'})

    def M():
        return {
            'kosode': mat('cloth_kosode', 'cloth_weave', (0.85, 0.84, 0.8) if not hollow else (0.32, 0.34, 0.38), sheen=0.45, scale=2.2),
            'hakama': mat('cloth_hakama', 'cloth_jacquard', (0.55, 0.05, 0.035) if not hollow else (0.18, 0.02, 0.025), sheen=0.5, scale=1.6),
            'shoes': mat('cloth_shoes', 'cloth_weave', (0.85, 0.84, 0.8), scale=2.0),
            'obi': mat('cloth_obi', 'cloth_jacquard', (0.55, 0.05, 0.035), sheen=0.5, scale=1.6),
        }
    clothes = [('elvs_gored_elephant_pants', 'hakama'), ('mindfront_kimono', 'kosode'), ('toigo_ballet_flats', 'shoes')]

    def cuts(ctx):
        O.cut_below(ctx['clothes']['kosode'], ctx['hip_z'] - 0.05)

    def make(b, M, ctx):
        obi = P.band(b, 'obi', M['obi'], ctx['waist_z'] - 0.05, ctx['waist_z'] + 0.07, off=0.014, thick=0.005)
        return [obi], {}, ('obi',)
    return assemble(spec, clothes, make, M, cuts=cuts)


def hollow_king():
    """Lord Soen, the Hollow King: tall, ash-skinned, in black lacquered lamellar over a long black robe,
    a crowned mask, embers burning white-gold in the cracks"""
    spec = {'name': 'hollow_king', 'ash': True, 'eye_glow': (1.0, 0.85, 0.45, 12.0),
            'phenotype': {'gender': 1.0, 'age': 0.55, 'muscle': 0.85, 'weight': 0.6, 'height': 1.0, 'proportions': 0.75},
            'skin': 'middleage_asian_male', 'hair': None, 'eyebrows': 'eyebrow004', 'eyelashes': 'eyelashes01', 'eye_texture': 'brown'}

    def M():
        m = hollow_mats()
        m['robe'] = mat('cloth_king_robe', 'cloth_jacquard', (0.035, 0.03, 0.04), sheen=0.55, scale=1.4)
        m['lacquer'] = mat('lacquer_king', 'steel_gray', (0.04, 0.035, 0.04), scale=1.0, normal_strength=0.15, rough_fixed=0.32, coat=1.0, coat_rough=0.15)
        m['gold'] = mat('metal_king_gold', 'steel_gray', (0.95, 0.68, 0.32), metal=1.0, scale=2.0)
        return m
    clothes = [('donitz_monk_robe', 'robe'), ('punkduck_medieval_boots', 'leather'), ('maciekg_horned_helmet', 'gold')]

    def make(b, M, ctx):
        pcs = []
        cu = P.lamellar_cuirass(b, 'cuirass', M['lacquer'], top=ctx['neck_z'] - 0.1, bottom=ctx['waist_z'] - 0.06, rows=7, off=0.035, thick=0.008)
        pcs.append(cu)
        b.add_layer(cu)
        for sd in ('l', 'r'):
            pcs.append(P.join(P.lamellar_pauldron(b, f'pauldron_{sd}', M['lacquer'], sd, rows=5, off=0.05), f'pauldron_{sd}'))
        mk = P.mask(b, 'mask', M['gold'], eyes_of(ctx['rig']))
        pcs.append(mk)
        belt = P.band(b, 'belt', M['gold'], ctx['waist_z'] - 0.07, ctx['waist_z'] - 0.01, off=0.05, thick=0.008)
        pcs.append(belt)
        return pcs, {'pauldron_l': 'upperarm_l', 'pauldron_r': 'upperarm_r', 'mask': 'head'}, ('cuirass', 'belt')
    return assemble(spec, clothes, make, M)


def forgemother():
    """the Forgemother: a giant Hollow smith in a long scorched leather apron, iron pauldrons, a smith's
    mask; molten light in her cracks"""
    spec = {'name': 'forgemother', 'ash': True, 'eye_glow': (1.0, 0.55, 0.12, 10.0),
            'phenotype': {'gender': 0.0, 'age': 0.6, 'muscle': 1.0, 'weight': 0.8, 'height': 1.0, 'proportions': 0.5},
            'skin': 'middleage_asian_female', 'hair': None, 'eyebrows': 'eyebrow010', 'eyelashes': 'eyelashes02', 'eye_texture': 'brown'}

    def M():
        m = hollow_mats()
        m['apron'] = mat('leather_forge_apron', 'leather_brown', (0.22, 0.13, 0.08), scale=0.8)
        m['robe'] = mat('cloth_forge', 'cloth_weave', (0.08, 0.05, 0.04), sheen=0.3, scale=2.0)
        return m
    clothes = [('rehmanpolanski_viking_tunic', 'robe'), ('toigo_wool_pants', 'pants'), ('punkduck_medieval_boots', 'leather'),
               ('culturalibre_hero-heroine_gloves_4', 'leather')]

    def make(b, M, ctx):
        pcs = []
        ap = P.cuirass(b, 'apron', M['apron'], top=ctx['neck_z'] - 0.14, bottom=ctx['hip_z'] - 0.12, off=0.04, thick=0.012, front_only=True)
        pcs.append(ap)
        b.add_layer(ap)
        for sd in ('l', 'r'):
            pcs.append(P.join(P.lamellar_pauldron(b, f'pauldron_{sd}', M['iron'], sd, rows=4, off=0.05), f'pauldron_{sd}'))
        mk = P.mask(b, 'mask', _mask_crack(M['mask']), eyes_of(ctx['rig']))
        pcs.append(mk)
        belt = P.band(b, 'belt', M['leather'], ctx['waist_z'] - 0.08, ctx['waist_z'] + 0.02, off=0.05, thick=0.012)
        pcs.append(belt)
        return pcs, {'pauldron_l': 'upperarm_l', 'pauldron_r': 'upperarm_r', 'mask': 'head'}, ('apron', 'belt')
    return assemble(spec, clothes, make, M)


CAST = {'kaede': kaede, 'forgemother': forgemother, 'oren': oren, 'ren': ren, 'mika': mika, 'hisame': lambda: _hisame('hisame', False),
        'hisame_hollow': lambda: _hisame('hisame_hollow', True), 'hollow_king': hollow_king, 'hollow_footman': hollow_footman, 'hollow_spearman': hollow_spearman, 'hollow_brute': hollow_brute,
        'hollow_wraith': hollow_wraith}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    name = argv[0]
    t0 = time.time()
    rig, spec = CAST[name]()
    print('BUILT', name, round(time.time() - t0, 1))
    if '--debug' in argv:
        dg = bpy.context.evaluated_depsgraph_get()
        for o in bpy.data.objects:
            if o.type != 'MESH':
                continue
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            import numpy as np
            co = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices]) if len(me.vertices) else np.zeros((1, 3))
            raw = np.array([(o.matrix_world @ v.co)[:] for v in o.data.vertices]) if len(o.data.vertices) else np.zeros((1, 3))
            print('DBG', o.name, len(o.data.vertices), 'eval', co.min(0).round(2), co.max(0).round(2), 'raw', raw.min(0).round(2), raw.max(0).round(2), [m.type for m in o.modifiers])
            ev.to_mesh_clear()
    if '--save' in argv or '--export' in argv:
        os.makedirs(WORK, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, f'{name}.blend'))
    if '--preview' in argv:
        print('PREVIEW', preview(rig, argv[argv.index('--preview') + 1]))
    if '--export' in argv:
        charlib.downsize_images(2048)
        charlib.export_glb(os.path.join(OUT, f'{name}.glb'), rig)
        print('EXPORTED', name)
