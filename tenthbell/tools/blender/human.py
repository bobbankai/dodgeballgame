"""Bodies for The Tenth Bell, built with MPFB (MakeHuman for Blender, CC0 base mesh and targets).

Only the base mesh, its shaping targets and the stock rig come from MPFB. Skin, eyes, hair and clothes
are made here (skin.py, parts.py, hair.py, outfit.py); nothing is loaded from an asset pack.

Run with the bpy module: /opt/bl/venv/bin/python <script>.py < /dev/null   (stdin must not be a tty/socket)
Blender space: the character faces -Y, +Z is up, its left is +X, 1 unit = 1 m.
"""
import os
import bpy
import bmesh
import numpy as np

MPFB_SRC = os.environ.get('MPFB_SRC', '/opt/raw/mpfb2/src/mpfb')
TARGETS = os.path.join(MPFB_SRC, 'data', 'targets')
RACES = ('african', 'asian', 'caucasian')

# face morphs: name -> expression units that make it up (both sides together)
MORPHS = {
    'blink': ('eye-left-closure', 'eye-right-closure'),
    'squint': ('eye-left-slit', 'eye-right-slit'),
    'wide': ('eye-left-opened-up', 'eye-right-opened-up'),
    'browDown': ('eyebrows-left-down', 'eyebrows-right-down'),
    'browSad': ('eyebrows-left-inner-up', 'eyebrows-right-inner-up'),
    'browUp': ('eyebrows-left-up', 'eyebrows-right-up', 'eyebrows-left-extern-up', 'eyebrows-right-extern-up'),
    'smile': ('mouth-corner-puller',),
    'frown': ('mouth-depression',),
    'grit': ('mouth-retraction',),
    'press': ('mouth-compression',),
    'sneer': ('nose-left-elevation', 'nose-right-elevation'),
    'open': ('mouth-open',),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')


def only(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def make_human(spec):
    """spec: name, phenotype {gender, age, muscle, weight, height, proportions, cupsize, firmness, race{}},
    targets [(name, weight)]. Returns (mesh with every helper still attached, rig)."""
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    info = HumanService._create_default_human_info_dict()
    info['phenotype'].update(spec.get('phenotype', {}))
    info['name'] = spec['name']
    info['rig'] = 'default_no_toes'
    info['targets'] = [{'target': t, 'value': v} for t, v in spec.get('targets', [])]
    st = HumanService.get_default_deserialization_settings()
    st.update(subdiv_levels=0, load_clothes=False)
    base = HumanService.deserialize_from_dict(info, st)
    rig = base.parent
    for m in list(base.modifiers):
        if m.type == 'MASK':
            base.modifiers.remove(m)
    TargetService.bake_targets(base)
    # expression units become real shape keys (they also move the lash, teeth and tongue helpers)
    race = info['phenotype']['race']
    base.shape_key_add(name='Basis')
    keys = base.data.shape_keys.key_blocks
    for morph, units in MORPHS.items():
        for u in units:
            for r in RACES:
                if race.get(r, 0) > 0.01:
                    TargetService.load_target(base, os.path.join(TARGETS, 'expression', 'units', r, u + '.target.gz'),
                                              weight=race[r], name=f'_{u}_{r}')
        base.shape_key_add(name=morph, from_mix=True)
        for k in [k for k in keys if k.name.startswith('_')]:
            base.shape_key_remove(k)
        for k in keys:
            k.value = 0
    return base, rig


def group_mask(obj, name):
    """bool per vertex: is it in the vertex group"""
    gi = obj.vertex_groups[name].index
    return np.array([any(g.group == gi and g.weight > 0 for g in v.groups) for v in obj.data.vertices])


def split_off(obj, mask, name):
    """Copy of obj that keeps only the masked vertices (weights, UVs and shape keys come along)."""
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = new.data.name = name
    bpy.context.scene.collection.objects.link(new)
    keep_only(new, mask)
    return new


def keep_only(obj, mask):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not mask[v.index]], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def rest(rig):
    """rest pose data used everywhere: bone -> (head, tail, 3x3 matrix, parent name)"""
    return {b.name: (np.array(b.head_local), np.array(b.tail_local), np.array(b.matrix_local.to_3x3()),
                     b.parent.name if b.parent else None) for b in rig.data.bones}
