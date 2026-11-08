"""Character assembly: trimming the body under clothing, subdividing with shape keys, eyes, teeth,
facial feature masks, skin weights for gear, extra bones, materials and export.
"""
import math
import os

import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix

from common import select_only, apply_modifiers, verts_np, link, set_group, color_attribute, all_group_weights
from human import delete_vertices, add_bone, read_target, MPFB_DATA

# --------------------------------------------------------------------------- body trimming


def keep_regions(body, keep_fn):
    """Delete body vertices where keep_fn(points) is False (parts hidden under gear)."""
    co = verts_np(body, world=False)
    keep = keep_fn(co)
    delete_vertices(body, ~keep)


def subdivide_keep_shapes(obj, levels=1):
    """Catmull-Clark subdivision that keeps shape keys (each key is subdivided separately)."""
    keys = obj.data.shape_keys.key_blocks if obj.data.shape_keys else []
    if not keys:
        m = obj.modifiers.new('sub', 'SUBSURF')
        m.levels = levels
        m.render_levels = levels
        m.uv_smooth = 'PRESERVE_BOUNDARIES'
        _apply_first(obj, m)
        return obj
    names = [k.name for k in keys]
    coords = {}
    for kn in names:
        tmp = obj.copy()
        tmp.data = obj.data.copy()
        link(tmp)
        tmp.modifiers.clear()
        kb = tmp.data.shape_keys.key_blocks[kn]
        co = np.empty(len(kb.data) * 3)
        kb.data.foreach_get('co', co)
        select_only(tmp)
        tmp.shape_key_clear()
        tmp.data.vertices.foreach_set('co', co)
        tmp.data.update()
        m = tmp.modifiers.new('sub', 'SUBSURF')
        m.levels = levels
        m.uv_smooth = 'PRESERVE_BOUNDARIES'
        apply_modifiers(tmp)
        coords[kn] = verts_np(tmp, world=False)
        bpy.data.objects.remove(tmp, do_unlink=True)
    select_only(obj)
    arm_mods = [(m.name, m.object) for m in obj.modifiers if m.type == 'ARMATURE']
    obj.modifiers.clear()
    obj.shape_key_clear()
    m = obj.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.uv_smooth = 'PRESERVE_BOUNDARIES'
    apply_modifiers(obj)
    basis = obj.shape_key_add(name=names[0], from_mix=False)
    basis.data.foreach_set('co', coords[names[0]].ravel())
    obj.data.vertices.foreach_set('co', coords[names[0]].ravel())
    for kn in names[1:]:
        sk = obj.shape_key_add(name=kn, from_mix=False)
        sk.data.foreach_set('co', coords[kn].ravel())
        sk.value = 0
    for name, arm in arm_mods:
        mm = obj.modifiers.new(name, 'ARMATURE')
        mm.object = arm
    obj.data.update()
    return obj


def _apply_first(obj, mod):
    select_only(obj)
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def shape_deltas(obj):
    """dict name -> (N, 3) delta from the basis for each shape key."""
    kb = obj.data.shape_keys.key_blocks
    n = len(obj.data.vertices)
    base = np.empty(n * 3)
    kb[0].data.foreach_get('co', base)
    base = base.reshape(-1, 3)
    out = {}
    for k in kb[1:]:
        c = np.empty(n * 3)
        k.data.foreach_get('co', c)
        out[k.name] = c.reshape(-1, 3) - base
    return out

# --------------------------------------------------------------------------- eyes and mouth


def make_eye(name, center, radius, iris_tex_path, segments=32):
    """Eyeball facing -Y with a front planar UV projection (iris in the middle of the texture)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=segments // 2, radius=radius)
    # pole along -Y so the iris sits on the pole (even ring spacing around it)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
    # cornea bulge
    for v in bm.verts:
        f = max(0.0, -v.co.y / radius)
        if f > 0.82:
            v.co.y -= radius * 0.09 * ((f - 0.82) / 0.18) ** 1.5
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            front = co.y < 0
            # front hemisphere maps into the circle of radius 0.5; the back into the sclera corner
            u = 0.5 + co.x / radius * (0.5 if front else 0.48)
            vv = 0.5 + co.z / radius * (0.5 if front else 0.48)
            l[uv].uv = (u, vv)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    obj.location = center
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in me.polygons:
        p.use_smooth = True
    return obj


def iris_texture(path, res=512, iris_col=(0.32, 0.42, 0.5), inner_col=(0.75, 0.55, 0.22), seed=3, iris_r=0.235, pupil_r=0.085):
    """Painted eye texture: veined sclera, radial iris fibres, limbal ring, pupil."""
    from PIL import Image
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:res, 0:res].astype(np.float32) / res - 0.5
    r = np.hypot(x, y)
    a = np.arctan2(y, x)
    sclera = np.array([0.86, 0.83, 0.8], np.float32) * (1 - 0.18 * np.clip((r - 0.3) / 0.25, 0, 1))[..., None]
    # veins: thin wiggly radial lines near the edge
    veins = np.zeros_like(r)
    for k in range(26):
        ang = rng.random() * 2 * np.pi
        wig = 0.06 * np.sin(r * 40 + rng.random() * 6)
        veins += np.exp(-((((a - ang + np.pi) % (2 * np.pi)) - np.pi - wig) * r / 0.0035) ** 2) * (r > iris_r + 0.04)
    sclera = sclera * (1 - 0.35 * np.clip(veins, 0, 1)[..., None]) + np.array([0.5, 0.08, 0.08]) * 0.35 * np.clip(veins, 0, 1)[..., None]
    fib = np.zeros_like(r)
    for f, w in ((60, 0.5), (140, 0.3), (23, 0.2)):
        fib += w * (0.5 + 0.5 * np.sin(a * f + rng.random() * 6 + np.sin(r * 90) * 0.5))
    t = np.clip((r - pupil_r) / (iris_r - pupil_r), 0, 1)
    iris = np.array(iris_col, np.float32) * (0.65 + 0.5 * fib)[..., None]
    inner = np.array(inner_col, np.float32) * (0.7 + 0.4 * fib)[..., None]
    iris = inner * np.exp(-t * 4)[..., None] + iris * (1 - np.exp(-t * 4))[..., None]
    iris *= (1 - 0.55 * np.clip((r - iris_r * 0.86) / (iris_r * 0.14), 0, 1))[..., None]  # limbal ring
    col = np.where((r < iris_r)[..., None], iris, sclera)
    col = np.where((r < pupil_r)[..., None], np.array([0.01, 0.01, 0.012]), col)
    soft = np.clip((r - iris_r) / 0.008, 0, 1)[..., None]
    col = col * soft + np.where((r < pupil_r)[..., None], np.array([0.01, 0.01, 0.012]), iris) * (1 - soft) * (r >= pupil_r)[..., None] + \
        np.where(r < pupil_r, 1, 0)[..., None] * np.array([0.01, 0.01, 0.012]) * (1 - soft)
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(path)
    return path


def helper_mesh_with_morphs(helper, body_basis_full, target_files, morph_units, subdiv=1):
    """Teeth / tongue from MakeHuman helper geometry; shape keys follow the face morphs."""
    obj = helper
    if subdiv:
        m = obj.modifiers.new('sub', 'SUBSURF')
        m.levels = subdiv
        apply_modifiers(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj

# --------------------------------------------------------------------------- feature masks from expression units


def feature_masks(body, landmarks):
    """Facial feature masks per vertex, using the expression shape keys as feature detectors."""
    d = shape_deltas(body)
    co = verts_np(body, world=False)

    def mag(name):
        v = np.linalg.norm(d[name], axis=1) if name in d else np.zeros(len(co))
        return v / max(v.max(), 1e-9)
    eye_l, eye_r = np.array(landmarks['joint-l-eye']), np.array(landmarks['joint-r-eye'])
    eye_z = (eye_l[2] + eye_r[2]) / 2
    jaw = np.array(landmarks['joint-jaw'])
    head = np.array(landmarks['joint-head'])
    m = {}
    m['lips'] = np.clip((mag('lipsPucker') - 0.35) / 0.4, 0, 1)
    m['lids'] = np.clip((np.maximum(mag('blink_L'), mag('blink_R')) - 0.15) / 0.4, 0, 1)
    m['brow'] = np.clip(np.maximum(mag('browUp_L'), mag('browUp_R')) / 0.6, 0, 1)
    m['cheek'] = np.clip(mag('smile') / 0.7, 0, 1) * (1 - m['lips'])
    m['nose'] = np.clip((mag('snarl') - 0.2) / 0.6, 0, 1) * (co[:, 2] > jaw[2] + 0.02)
    front = co[:, 1] < head[1] - 0.02
    # beard: lower face in front of the ears, from below the nose to under the jaw
    below_nose = co[:, 2] < eye_z - 0.052
    above_neck = co[:, 2] > jaw[2] - 0.065 - 0.02 * np.clip(-(co[:, 1] - jaw[1]) / 0.05, 0, 1)
    sideways = np.abs(co[:, 0]) < 0.072
    m['beard'] = (below_nose & above_neck & sideways & (co[:, 1] < head[1] + 0.01)).astype(float) * (1 - m['lips'])
    # moustache band just above the lip
    m['beard'] = np.maximum(m['beard'], ((co[:, 2] < eye_z - 0.065) & (co[:, 2] > eye_z - 0.09) & (np.abs(co[:, 0]) < 0.03) & front).astype(float) * (1 - m['lips']))
    # scalp: above a hairline that dips behind the ears
    hair_front = eye_z + 0.062
    back = np.clip((co[:, 1] - (head[1] - 0.02)) / 0.09, 0, 1)
    hairline = hair_front - back * 0.105 - 0.015 * np.clip((np.abs(co[:, 0]) - 0.045) / 0.03, 0, 1)
    m['scalp'] = np.clip((co[:, 2] - hairline) / 0.012, 0, 1)
    ears = (np.abs(co[:, 0]) > 0.068) & (co[:, 2] < eye_z + 0.02) & (co[:, 2] > eye_z - 0.06) & (np.abs(co[:, 1] - head[1] - 0.005) < 0.04)
    m['ears'] = ears.astype(float)
    m['scalp'] *= 1 - m['ears']
    return m


def scar_mask(co, points, width=0.0025):
    """Distance-based mask around a 3D polyline drawn on the skin."""
    pts = [np.asarray(p, float) for p in points]
    dmin = np.full(len(co), np.inf)
    for a, b in zip(pts[:-1], pts[1:]):
        ab = b - a
        t = np.clip(((co - a) @ ab) / (ab @ ab), 0, 1)
        dmin = np.minimum(dmin, np.linalg.norm(co - (a + t[:, None] * ab), axis=1))
    return np.clip(1 - dmin / width, 0, 1)

# --------------------------------------------------------------------------- skinning gear


def bone_world(rig, name):
    b = rig.data.bones[name]
    return np.array(rig.matrix_world @ b.head_local), np.array(rig.matrix_world @ b.tail_local)


def skin_rigid(obj, rig, bone, blend=None):
    """Plate armour: one bone, optionally blended to a second bone across a band (by z or by distance)."""
    co = verts_np(obj)
    w = np.ones(len(co))
    if blend:
        for other, z0, z1 in blend:
            if z0 is None:
                # blend by distance to the other bone's segment vs this bone's segment
                a0, b0 = bone_world(rig, bone)
                a1, b1 = bone_world(rig, other)
                d0 = _seg_dist(co, a0, b0)
                d1 = _seg_dist(co, a1, b1)
                f = np.clip((d0 - d1) / 0.06 + 0.5, 0, 1) * 0.6
            else:
                f = np.clip((co[:, 2] - z0) / (z1 - z0), 0, 1) if z1 != z0 else np.zeros(len(co))
            set_group(obj, other, f)
            w = w - f
    set_group(obj, bone, np.clip(w, 0, 1))


def _seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def skin_transfer(obj, body_src, deform_names=None):
    """Interpolated weights from the (untrimmed) body surface."""
    m = obj.modifiers.new('wt', 'DATA_TRANSFER')
    m.object = body_src
    m.use_vert_data = True
    m.data_types_verts = {'VGROUP_WEIGHTS'}
    m.vert_mapping = 'POLYINTERP_NEAREST'
    m.layers_vgroup_select_src = 'ALL'
    m.layers_vgroup_select_dst = 'NAME'
    select_only(obj)
    bpy.ops.object.datalayout_transfer(modifier=m.name)
    bpy.ops.object.modifier_apply(modifier=m.name)
    if deform_names is not None:
        for vg in list(obj.vertex_groups):
            if vg.name not in deform_names:
                obj.vertex_groups.remove(vg)


def skin_skirt(obj, rig, body_src):
    """Skirt over both legs: pelvis at the waist, then left/right thigh by side, smoothly."""
    co = verts_np(obj)
    zh = bone_world(rig, 'pelvis')[0][2]
    skin_transfer(obj, body_src)
    below = np.clip((zh + 0.02 - co[:, 2]) / 0.12, 0, 1)
    side_l = np.clip(0.5 + co[:, 0] / 0.12, 0, 1)
    groups = all_group_weights(obj)
    # replace weights on the skirt part (below the hips) with a smooth pelvis/thigh blend
    for vg in list(obj.vertex_groups):
        w = groups[vg.name] * (1 - below)
        vg.remove(list(range(len(co))))
        set_group(obj, vg.name, w)
    set_group(obj, 'thigh_l', below * side_l * 0.75 + groups.get('thigh_l', 0) * (1 - below))
    set_group(obj, 'thigh_r', below * (1 - side_l) * 0.75 + groups.get('thigh_r', 0) * (1 - below))
    set_group(obj, 'pelvis', below * 0.25 + groups.get('pelvis', 0) * (1 - below))


def normalize_weights(obj, max_influences=4):
    select_only(obj)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=max_influences)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)


def parent_to_rig(obj, rig):
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    for m in list(obj.modifiers):
        if m.type == 'ARMATURE':
            obj.modifiers.remove(m)
    a = obj.modifiers.new('Armature', 'ARMATURE')
    a.object = rig
