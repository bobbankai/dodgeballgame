"""
Thin, scriptable wrapper over the MPFB 2 (MakeHuman for Blender) API for headless character builds.

MPFB (GPL add-on, authoring tool only) + the MakeHuman system/skin/face asset packs (CC0) give us an anatomically built human with clean
quad topology, UVs, photographic skin textures, real eyes, brows, lashes, hair and a game-engine skeleton. Our scripts then refine it:
proportions, custom clothing and gear, pore/roughness maps, facial expression shape keys, animation, export.
"""
import os

import bpy

MPFB = 'bl_ext.user_default.mpfb'


def enable():
    import addon_utils
    if MPFB not in bpy.context.preferences.addons:
        addon_utils.enable(MPFB, default_set=True)
    from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: F401
    return True


def user_data():
    return os.path.join(bpy.utils.extension_path_user(MPFB, create=True), 'data')


def asset(*parts):
    p = os.path.join(user_data(), *parts)
    if not os.path.exists(p):
        raise FileNotFoundError(p)
    return p


def create_human(macro):
    """macro: gender, age, muscle, weight, proportions, height, cupsize, firmness (0..1), race {asian, caucasian, african}."""
    enable()
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    info = TargetService.get_default_macro_info_dict()
    for k, v in macro.items():
        if k == 'race':
            info['race'].update(v)
        else:
            info[k] = v
    return HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True,
                                     scale=0.1, macro_detail_dict=info)


def set_target(basemesh, name, value):
    """Apply a MakeHuman detail target (e.g. 'nose/nose-scale-horiz-incr') at a weight."""
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    path = TargetService.target_full_path(name)
    if path is None:
        print('  ! target not found:', name)
        return False
    TargetService.load_target(basemesh, path, weight=value, name=name.replace('/', '_'))
    return True


def skin(basemesh, name, skin_type='ENHANCED_SSS'):
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    HumanService.set_character_skin(asset('skins', name, f'{name}.mhmat'), basemesh, skin_type=skin_type)


def add(basemesh, kind, name, material=None, subdiv=1):
    """kind: eyes | eyebrows | eyelashes | hair | teeth | tongue | clothes; name = folder name."""
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    asset_type = {'eyes': 'Eyes', 'eyebrows': 'Eyebrows', 'eyelashes': 'Eyelashes', 'hair': 'Hair', 'teeth': 'Teeth',
                  'tongue': 'Tongue', 'clothes': 'Clothes', 'proxymeshes': 'Proxymeshes'}[kind]
    mhclo = asset(kind, name, f'{name}.mhclo')
    alt = None
    if material:
        alt = asset(kind, 'materials', f'{material}.mhmat') if kind == 'eyes' else material
    ob = HumanService.add_mhclo_asset(mhclo, basemesh, asset_type=asset_type, subdiv_levels=subdiv, material_type='MAKESKIN',
                                      alternative_materials=None, set_up_rigging=True, interpolate_weights=True)
    if kind == 'eyes' and alt:
        from bl_ext.user_default.mpfb.services.materialservice import MaterialService
        try:
            MaterialService.set_eye_material(ob, alt) if hasattr(MaterialService, 'set_eye_material') else None
        except Exception as e:  # noqa: BLE001
            print('  eye material override failed:', e)
    return ob


def rig(basemesh, name='game_engine'):
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    return HumanService.add_builtin_rig(basemesh, name, import_weights=True)


def bake_targets(basemesh):
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    TargetService.bake_targets(basemesh)


def bind_proxies(basemesh, rig, proxies, cornea=None):
    """Make MakeHuman body parts (eyes, brows, lashes, teeth) follow the face and the skeleton in the game.

    proxies: [(object, kind, name)]. Call after the face targets are loaded on the basemesh and BEFORE helper geometry is deleted
    (the mhclo binding indexes the full basemesh). Each proxy vertex is bound to three basemesh vertices + an offset (MakeHuman's own
    fitting data), so every basemesh shape key gives the proxy an exact matching shape key: lashes close with eyeBlink, brows lift with
    browInnerUp, lower teeth drop with jawOpen, eyes turn with eyeLook*. Skin weights are interpolated the same way (MPFB).
    The cornea shell (a cut copy of the eyes) copies its nearest eye vertex's shape deltas and weights.
    Every part is weighted 100% to the head bone (no face bones in the game rig) and all new keys start at 0."""
    import numpy as np
    from mathutils import kdtree
    from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService

    keys = basemesh.data.shape_keys.key_blocks
    nb = len(keys[0].data)

    def co(kb, n):
        a = np.empty(n * 3, dtype=np.float64)
        kb.data.foreach_get('co', a)
        return a.reshape(n, 3)

    hb = co(keys[0], nb)
    h3 = np.array(basemesh.matrix_world.to_3x3())
    report = {}
    for ob, kind, name in proxies:
        mh = Mhclo()
        mh.load(asset(kind, name, f'{name}.mhclo'))
        mh.clothes = ob
        n = len(ob.data.vertices)
        if len(mh.verts) != n:
            print(f'  ! {name}: mhclo has {len(mh.verts)} verts, mesh {n}; skipped')
            continue
        idx = np.array([mh.verts[i]['verts'] for i in range(n)], dtype=np.int64)
        w = np.array([mh.verts[i]['weights'] for i in range(n)], dtype=np.float64)
        to_local = np.array(ob.matrix_world.inverted().to_3x3()) @ h3
        if ob.data.shape_keys is None:
            ob.shape_key_add(name='Basis', from_mix=False)
        base = co(ob.data.shape_keys.key_blocks[0], n)
        made = 0
        for kb in keys[1:]:
            d = co(kb, nb) - hb
            pd = (d[idx] * w[:, :, None]).sum(axis=1) @ to_local.T
            if np.abs(pd).max() < 1e-6:
                continue
            sk = ob.shape_key_add(name=kb.name, from_mix=False)
            sk.data.foreach_set('co', (base + pd).astype(np.float32).ravel())
            sk.value = 0.0
            made += 1
        ClothesService.set_up_rigging(basemesh, ob, rig, mh, interpolate_weights=False, import_subrig=False, import_weights=False)
        # rigid to the head: all facial motion on these parts comes from the shape keys above (the game rig has no face bones)
        for g in ob.vertex_groups[:]:
            ob.vertex_groups.remove(g)
        ob.vertex_groups.new(name='head').add(list(range(n)), 1.0, 'REPLACE')
        report[name] = made
    if cornea is not None:
        eye = next((ob for ob, kind, _ in proxies if kind == 'eyes'), None)
        if eye is not None and eye.data.shape_keys:
            ev = eye.data.vertices
            tree = kdtree.KDTree(len(ev))
            for v in ev:
                tree.insert(v.co, v.index)
            tree.balance()
            cv = cornea.data.vertices
            near = np.array([tree.find(v.co)[1] for v in cv], dtype=np.int64)
            ekeys = eye.data.shape_keys.key_blocks
            eb = co(ekeys[0], len(ev))
            for g in cornea.vertex_groups[:]:
                cornea.vertex_groups.remove(g)
            if cornea.data.shape_keys is None:
                cornea.shape_key_add(name='Basis', from_mix=False)
            cbase = co(cornea.data.shape_keys.key_blocks[0], len(cv))
            for kb in ekeys[1:]:
                sk = cornea.shape_key_add(name=kb.name, from_mix=False)
                sk.data.foreach_set('co', (cbase + (co(kb, len(ev)) - eb)[near]).astype(np.float32).ravel())
                sk.value = 0.0
            groups = {g.index: cornea.vertex_groups.new(name=g.name) for g in eye.vertex_groups}
            for i, j in enumerate(near):
                for ge in ev[int(j)].groups:
                    groups[ge.group].add([i], ge.weight, 'REPLACE')
            cornea.parent = rig
            cornea.matrix_parent_inverse.identity()
            for m in [m for m in cornea.modifiers if m.type == 'ARMATURE']:
                cornea.modifiers.remove(m)
            a = cornea.modifiers.new('Armature', 'ARMATURE')
            a.object = rig
            report['cornea'] = len(ekeys) - 1
    print('  proxies bound (shape keys):', report)
    return report


def children(basemesh):
    out = []
    for ob in bpy.data.objects:
        if ob is basemesh:
            continue
        p = ob
        while p.parent is not None:
            p = p.parent
            if p is basemesh or (basemesh.parent is not None and p is basemesh.parent):
                out.append(ob)
                break
    return out
