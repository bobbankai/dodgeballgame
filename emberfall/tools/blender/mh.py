"""MPFB (MakeHuman for Blender) helpers: build a rigged human from a spec dict.

All MakeHuman system assets used here are CC0 (makehuman_system_assets, skins01, hair01, eyebrows01,
eyelashes01, system_*_materials). The body is the MakeHuman base mesh shaped by macro targets, with
the 'game_engine' rig (Unreal-style bone names) so every character shares one animation set.
"""
import bpy
import os
import sys

MPFB_DATA = '/root/.config/blender/4.5/extensions/.user/user_default/mpfb/data'


def mpfb():
    import importlib
    mod = importlib.import_module('bl_ext.user_default.mpfb')
    from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa
    return mod


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # factory settings disables extensions; re-enable MPFB
    bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')


def build_human(spec):
    """spec: name, phenotype (gender, age, muscle, weight, height, proportions, cupsize, firmness, race),
    skin (folder name), hair (folder/file), eyebrows, eyelashes, eyes ('high-poly'), rig ('game_engine'),
    targets [(name, weight)] for detail shaping, eye_color (IrisMinorColor/IrisMajorColor overrides)."""
    from bl_ext.user_default.mpfb.services.humanservice import HumanService

    def part(sub, name, ext='.mhclo'):
        if not name:
            return ''
        d = os.path.join(MPFB_DATA, sub, name)
        for f in os.listdir(d):
            if f.endswith(ext):
                return os.path.join(d, f)
        raise FileNotFoundError(d)

    info = HumanService._create_default_human_info_dict()
    ph = info['phenotype']
    ph.update(spec.get('phenotype', {}))
    info['name'] = spec['name']
    info['rig'] = spec.get('rig', 'game_engine')
    info['eyes'] = part('eyes', spec.get('eyes', 'high-poly'))
    info['eyebrows'] = part('eyebrows', spec.get('eyebrows', 'eyebrow001'))
    info['eyelashes'] = part('eyelashes', spec.get('eyelashes', 'eyelashes01'))
    info['teeth'] = part('teeth', spec.get('teeth', 'teeth_base'))
    info['tongue'] = part('tongue', spec.get('tongue', 'tongue01'))
    info['hair'] = part('hair', spec['hair']) if spec.get('hair') else ''
    info['skin_mhmat'] = part('skins', spec['skin'], '.mhmat') if spec.get('skin') else ''
    info['skin_material_type'] = spec.get('skin_material_type', 'ENHANCED_SSS')
    info['eyes_material_type'] = 'PROCEDURAL_EYES'
    if spec.get('eye_settings'):
        info['eyes_material_settings'] = spec['eye_settings']
    info['targets'] = [{'target': t, 'value': v} for t, v in spec.get('targets', [])]
    info['alternative_materials'] = {}
    settings = HumanService.get_default_deserialization_settings()
    settings['subdiv_levels'] = 0
    settings['load_clothes'] = False
    basemesh = HumanService.deserialize_from_dict(info, settings)
    return basemesh


def find_rig(basemesh):
    p = basemesh.parent
    if p and p.type == 'ARMATURE':
        return p
    for o in bpy.data.objects:
        if o.type == 'ARMATURE':
            return o
    return None


def children_meshes(basemesh):
    rig = find_rig(basemesh)
    out = [basemesh]
    for o in bpy.data.objects:
        if o.type == 'MESH' and o is not basemesh and (o.parent is basemesh or o.parent is rig):
            out.append(o)
    return out
