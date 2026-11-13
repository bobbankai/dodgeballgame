"""Human bodies from MakeHuman data (CC0) through MPFB, with the 'game_engine' skeleton.

`build_body(spec)` returns (body, rig, landmarks): a skinned body mesh with its helper geometry
removed, facial expression shape keys (FACS-like MakeHuman expression units) and named landmark
positions (eye centres, jaw, head, neck ...) used to place eyes, hair and armour.
"""
import gzip
import os

import bpy
import bmesh
import numpy as np
from mathutils import Vector

from common import select_only, all_group_weights

MPFB_DATA = '/root/.config/blender/5.2/extensions/user_default/mpfb/data'

# Expression units -> game morph names. Each game morph is a weighted blend of units.
EXPRESSIONS = {
    'blink_L': [('eye-left-closure', 1.0)],
    'blink_R': [('eye-right-closure', 1.0)],
    'squint_L': [('eye-left-slit', 1.0)],
    'squint_R': [('eye-right-slit', 1.0)],
    'wide_L': [('eye-left-opened-up', 1.0)],
    'wide_R': [('eye-right-opened-up', 1.0)],
    'browUp_L': [('eyebrows-left-up', 1.0)],
    'browUp_R': [('eyebrows-right-up', 1.0)],
    'browDown_L': [('eyebrows-left-down', 1.0)],
    'browDown_R': [('eyebrows-right-down', 1.0)],
    'browInner': [('eyebrows-left-inner-up', 1.0), ('eyebrows-right-inner-up', 1.0)],
    'jawOpen': [('mouth-open', 1.0)],
    'smile': [('mouth-corner-puller', 1.0)],
    'frown': [('mouth-depression', 1.0)],
    'lipsPress': [('mouth-compression', 1.0)],
    'lipsPucker': [('mouth-pursing', 0.7), ('mouth-protusion', 0.5)],
    'lipsWide': [('mouth-retraction', 1.0)],
    'snarl': [('mouth-upward-retraction', 0.8), ('nose-compression', 0.6)],
    'mouthPart': [('mouth-parling', 1.0)],
}


def mpfb_services():
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    return HumanService, TargetService


def target_path(name):
    """Resolve a MakeHuman target name like 'chin/chin-prominent-incr' to its .target.gz file."""
    for cand in (name, name + '.target.gz'):
        p = os.path.join(MPFB_DATA, 'targets', cand)
        if os.path.exists(p):
            return p
        if os.path.exists(p + '.target.gz'):
            return p + '.target.gz'
    raise FileNotFoundError(name)


def read_target(path):
    """MakeHuman target file -> (indices, offsets) in Blender metres (scale 0.1, z-up)."""
    idx, off = [], []
    with gzip.open(path, 'rt') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split()
            idx.append(int(parts[0]))
            x, y, z = (float(v) for v in parts[1:4])
            off.append((x, -z, y))  # MakeHuman (x, y-up, z-front) -> Blender (x, -z, y)
    return np.array(idx, int), np.array(off, float) * 0.1


def build_body(spec):
    HumanService, TargetService = mpfb_services()
    info = HumanService._create_default_human_info_dict()
    info['phenotype'].update(spec.get('phenotype', {}))
    info['rig'] = spec.get('rig', 'game_engine')
    for k in ('eyes', 'eyebrows', 'eyelashes', 'teeth', 'tongue', 'hair', 'skin_mhmat', 'proxy'):
        info[k] = ''
    info['clothes'] = []
    # MPFB resolves targets by file basename ('chin-prominent-incr'), not by 'chin/...' paths
    info['targets'] = [{'target': t.split('/')[-1], 'value': v} for t, v in spec.get('targets', [])]
    settings = HumanService.get_default_deserialization_settings()
    settings.update({'subdiv_levels': 0, 'mask_helpers': False, 'load_clothes': False, 'feet_on_ground': True})
    body = HumanService.deserialize_from_dict(info, settings)
    rig = body.parent
    body.name = spec.get('name', 'Body')
    rig.name = spec.get('name', 'Body') + '_rig'
    rig.data.name = rig.name
    for m in list(body.modifiers):
        if m.type != 'ARMATURE':
            body.modifiers.remove(m)
    TargetService.bake_targets(body)

    # landmarks from the joint cubes (centroids), before helpers are removed
    co = np.array([v.co for v in body.data.vertices])
    groups = all_group_weights(body)
    landmarks = {}
    for name, w in groups.items():
        if name.startswith('joint-') or name.startswith('helper-'):
            sel = w > 0.5
            if sel.any():
                landmarks[name] = Vector(co[sel].mean(0))
                if name.startswith('helper-'):
                    landmarks[name + ':min'] = Vector(co[sel].min(0))
                    landmarks[name + ':max'] = Vector(co[sel].max(0))

    # expression shape keys (indices refer to the full base mesh, so add them before deleting helpers)
    body.shape_key_add(name='Basis', from_mix=False)
    base = co.copy()
    unit_dir = os.path.join(MPFB_DATA, 'targets', 'expression', 'units', spec.get('ethnic', 'caucasian'))
    for morph, units in spec.get('expressions', EXPRESSIONS).items():
        delta = np.zeros_like(base)
        for unit, wt in units:
            p = os.path.join(unit_dir, unit + '.target.gz')
            if not os.path.exists(p):
                print('missing expression unit', unit)
                continue
            i, o = read_target(p)
            delta[i] += o * wt
        sk = body.shape_key_add(name=morph, from_mix=False)
        sk.data.foreach_set('co', (base + delta).ravel())
        sk.value = 0.0

    helpers = extract_helpers(body, ['helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue',
                                     'helper-l-eye', 'helper-r-eye'], groups)
    delete_groups(body, groups, ('HelperGeometry', 'JointCubes'))
    # drop the now-empty helper/joint vertex groups
    for vg in list(body.vertex_groups):
        if vg.name.startswith(('joint-', 'helper-', 'HelperGeometry', 'JointCubes')):
            body.vertex_groups.remove(vg)
    return body, rig, landmarks, helpers


def extract_helpers(body, names, groups):
    """Copy helper sub-meshes (teeth, tongue, eye proxies) into their own objects."""
    out = {}
    co = np.array([v.co for v in body.data.vertices])
    for name in names:
        w = groups.get(name)
        if w is None:
            continue
        sel = set(np.nonzero(w > 0.5)[0].tolist())
        faces = [list(p.vertices) for p in body.data.polygons if all(v in sel for v in p.vertices)]
        if not faces:
            continue
        used = sorted({v for f in faces for v in f})
        remap = {v: i for i, v in enumerate(used)}
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(co[v]) for v in used], [], [[remap[v] for v in f] for f in faces])
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        out[name] = obj
    return out


def delete_groups(body, groups, names):
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    kill = np.zeros(len(bm.verts), bool)
    for n in names:
        if n in groups:
            kill |= groups[n] > 0.5
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(kill)[0]], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()


def delete_vertices(obj, mask):
    """Delete vertices where mask is True (keeps shape keys and vertex groups consistent)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(mask)[0]], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def add_bone(rig, name, head, tail, parent=None, roll=0.0, deform=True):
    select_only(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones.new(name)
    eb.head = Vector(head)
    eb.tail = Vector(tail)
    eb.roll = roll
    eb.use_deform = deform
    if parent:
        eb.parent = rig.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return name


def bone_head(rig, name):
    b = rig.data.bones[name]
    return rig.matrix_world @ b.head_local


def bone_tail(rig, name):
    b = rig.data.bones[name]
    return rig.matrix_world @ b.tail_local


def bone_matrix(rig, name):
    return rig.matrix_world @ rig.data.bones[name].matrix_local
