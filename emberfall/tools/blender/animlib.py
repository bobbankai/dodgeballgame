"""Animation authoring for the game_engine rig (MPFB, 53 bones, A-pose rest).

Everything is computed in armature space with our own forward kinematics, so clips are plain Python
functions of time:

  * FK rotations are written about the ARMATURE axes at rest (pitch, yaw, roll in degrees):
      pitch +  bends an upward bone forward / swings a downward bone back   (about +X)
      yaw   +  turns toward the character's left (+X)                       (about +Z)
      roll  +  leans toward the character's left                            (about +Y)
    and converted per bone:  basis = Rrest^-1 * R * Rrest.
  * two-bone IK (arms, legs) with anatomical hinge axes taken from the rest pose, pole targets for
    elbows / knees, and explicit end rotations (hands, feet).
  * a sword grip frame: the katana is held at a point in the fist; a clip animates the GRIP (position,
    blade direction, edge direction) and the right arm follows by IK, the left hand rides the hilt.
  * BVH retargeting (CMU mocap) by matching bone directions with twist from the source.
  * bake: one keyframe per frame, quaternions for every bone, Root translation = root motion.

Blender character space: faces -Y, left = +X, up = +Z.
"""
import bpy
import math
import os
import numpy as np
from mathutils import Matrix, Quaternion, Vector, Euler

FWD = Vector((0, -1, 0))
UP = Vector((0, 0, 1))
LEFT = Vector((1, 0, 0))


def arm_rot(pitch=0.0, yaw=0.0, roll=0.0):
    """Rotation in armature axes (degrees): pitch about X, roll about Y, yaw about Z (applied in that order)."""
    return (Matrix.Rotation(math.radians(yaw), 3, 'Z') @ Matrix.Rotation(math.radians(roll), 3, 'Y')
            @ Matrix.Rotation(math.radians(pitch), 3, 'X'))


def look_frame(fwd, up):
    """3x3 frame with columns (x, y, z) where y = fwd, z ~ up (orthonormalised)."""
    y = Vector(fwd).normalized()
    z = Vector(up) - y * Vector(up).dot(y)
    if z.length < 1e-6:
        z = Vector((0, 0, 1)) if abs(y.z) < 0.9 else Vector((1, 0, 0))
        z = z - y * z.dot(y)
    z.normalize()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed()


class Skel:
    def __init__(self, rig):
        self.rig = rig
        bones = rig.data.bones
        order = []

        def visit(b):
            order.append(b.name)
            for c in b.children:
                visit(c)
        for b in bones:
            if b.parent is None:
                visit(b)
        self.names = order
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.rest = {b.name: b.matrix_local.copy() for b in bones}
        self.rest_rel = {}
        for n in self.names:
            p = self.parent[n]
            self.rest_rel[n] = (self.rest[p].inverted() @ self.rest[n]) if p else self.rest[n].copy()
        self.children = {n: [c.name for c in bones[n].children] for n in self.names}
        self.length = {b.name: b.length for b in bones}
        # hinge axes (armature rest), anatomical bend direction from the rest pose
        self.hinge = {}
        for a, b, c in (('upperarm_l', 'lowerarm_l', 'hand_l'), ('upperarm_r', 'lowerarm_r', 'hand_r'),
                        ('thigh_l', 'calf_l', 'foot_l'), ('thigh_r', 'calf_r', 'foot_r')):
            da = (self.head(b) - self.head(a)).normalized()
            db = (self.head(c) - self.head(b)).normalized()
            n = da.cross(db)
            if n.length < 1e-4:
                n = LEFT.copy() if 'thigh' in a else Vector((-1, 0, -1)) if a.endswith('_l') else Vector((1, 0, -1))
            n.normalize()
            if 'thigh' in a and n.x < 0:
                n = -n
            self.hinge[a] = n
        # finger curl axes per finger bone (armature rest)
        self.curl_axis = {}
        for n in self.names:
            if any(n.startswith(f) for f in ('index', 'middle', 'ring', 'pinky', 'thumb')):
                side = n[-1]
                hand = self.rest['hand_' + side].to_3x3()
                palm = (hand @ Vector((0, 0, 1))).normalized()
                d = (self.rest[n].to_3x3() @ Vector((0, 1, 0))).normalized()
                if n.startswith('thumb'):
                    # thumb wraps across the palm toward the pinky side
                    across = (self.head('pinky_01_' + side) - self.head('index_01_' + side)).normalized()
                    ax = d.cross(across * 0.6 + palm * 0.8).normalized()
                else:
                    ax = d.cross(palm).normalized()
                self.curl_axis[n] = ax
        self._grip_frames()

    def head(self, n):
        return self.rest[n].to_translation()

    def tail(self, n):
        return (self.rest[n] @ Vector((0, self.length[n], 0)))

    def identity(self):
        return {n: Matrix.Identity(4) for n in self.names}

    def fk(self, basis):
        pose = {}
        for n in self.names:
            p = self.parent[n]
            pose[n] = (pose[p] @ self.rest_rel[n] @ basis[n]) if p else (self.rest_rel[n] @ basis[n])
        return pose

    def fk_one(self, pose, basis, n):
        """Recompute n and its subtree after basis[n] changed."""
        stack = [n]
        while stack:
            k = stack.pop()
            p = self.parent[k]
            pose[k] = (pose[p] @ self.rest_rel[k] @ basis[k]) if p else (self.rest_rel[k] @ basis[k])
            stack.extend(self.children[k])

    def local_from_arm(self, n, R):
        """Basis for bone n applying armature-axis rotation R (3x3) at the joint."""
        Mr = self.rest[n].to_3x3()
        return (Mr.inverted() @ R @ Mr).to_4x4()

    def set_world_rot(self, pose, basis, n, R_world):
        """Set bone n so its armature-space orientation is R_world (3x3)."""
        p = self.parent[n]
        M0 = (pose[p] @ self.rest_rel[n]) if p else self.rest_rel[n]
        b = M0.to_3x3().inverted() @ R_world
        basis[n] = b.to_4x4()
        self.fk_one(pose, basis, n)

    def point_bone(self, pose, basis, n, target_dir, hinge_local=None, hinge_world=None):
        """Aim bone n's Y axis along target_dir; if a hinge is given, roll so the bone's local hinge maps to it."""
        p = self.parent[n]
        M0 = ((pose[p] @ self.rest_rel[n]) if p else self.rest_rel[n]).to_3x3()
        d = Vector(target_dir).normalized()
        if hinge_local is not None and hinge_world is not None:
            yl = Vector((0, 1, 0))
            hl = hinge_local - yl * hinge_local.dot(yl)
            hw = hinge_world - d * hinge_world.dot(d)
            if hl.length > 1e-5 and hw.length > 1e-5:
                Fl = Matrix((hl.normalized(), yl, hl.normalized().cross(yl))).transposed()
                Fw = Matrix((hw.normalized(), d, hw.normalized().cross(d))).transposed()
                Rw = Fw @ Fl.transposed()
                basis[n] = (M0.inverted() @ Rw).to_4x4()
                self.fk_one(pose, basis, n)
                return
        y0 = M0 @ Vector((0, 1, 0))
        q = y0.rotation_difference(d)
        Rw = q.to_matrix() @ M0
        basis[n] = (M0.inverted() @ Rw).to_4x4()
        self.fk_one(pose, basis, n)

    def ik2(self, pose, basis, a, b, c, target, pole, end_rot=None):
        """Two-bone IK: place c's head at target with the a-b joint bending toward pole."""
        A = pose[a].to_translation()
        la = (self.head(b) - self.head(a)).length
        lb = (self.head(c) - self.head(b)).length
        T = Vector(target)
        to = T - A
        d = max(1e-4, min(to.length, (la + lb) * 0.9995))
        dirv = to.normalized()
        pv = Vector(pole) - A
        pv = pv - dirv * pv.dot(dirv)
        if pv.length < 1e-5:
            pv = self.hinge[a].cross(dirv)
        pv.normalize()
        cosA = max(-1.0, min(1.0, (la * la + d * d - lb * lb) / (2 * la * d)))
        sinA = math.sqrt(max(0.0, 1 - cosA * cosA))
        J = A + dirv * (la * cosA) + pv * (la * sinA)
        hw = (J - A).cross(T - J)
        if hw.length < 1e-6:
            hw = dirv.cross(pv)
        hw.normalize()
        # local hinge (rest) in each bone's frame
        hl_a = self.rest[a].to_3x3().inverted() @ self.hinge[a]
        hl_b = self.rest[b].to_3x3().inverted() @ self.hinge[a]
        self.point_bone(pose, basis, a, J - A, hl_a, hw)
        self.point_bone(pose, basis, b, T - J, hl_b, hw)
        if end_rot is not None:
            self.set_world_rot(pose, basis, c, end_rot)

    # -------------------------------------------------- sword grip
    def _grip_frames(self):
        """Hand-local grip frames: where a hilt sits in a closed fist and how it is oriented.
        Sword local axes (Blender): blade +Z, edge -Y, flat normal X."""
        self.grip = {}
        for s in ('l', 'r'):
            Hm = self.rest['hand_' + s]
            H = Hm.to_3x3()
            ik = self.head('index_01_' + s)
            pk = self.head('pinky_01_' + s)
            palm = (H @ Vector((0, 0, 1))).normalized()
            B = (ik - pk).normalized()                      # blade exits on the thumb side
            hy = (H @ Vector((0, 1, 0))).normalized()
            E = (hy - B * hy.dot(B)).normalized()            # edge leads with the knuckles
            c = (ik + pk) * 0.5 + palm * 0.028 - hy * 0.012  # inside the closed fist
            Y_s = -E
            Z_s = B
            X_s = Y_s.cross(Z_s)
            G = Matrix((X_s, Y_s, Z_s)).transposed().to_4x4()
            G.translation = c
            # grip frame relative to the hand bone
            self.grip[s] = Hm.inverted() @ G

    def grip_world(self, pos, blade, edge):
        """4x4 grip frame from position, blade direction and edge direction (armature space)."""
        Bv = Vector(blade).normalized()
        Ev = Vector(edge) - Bv * Vector(edge).dot(Bv)
        Ev.normalize()
        Y = -Ev
        Z = Bv
        X = Y.cross(Z)
        G = Matrix((X, Y, Z)).transposed().to_4x4()
        G.translation = Vector(pos)
        return G

    def hold(self, pose, basis, side, G, elbow_pole):
        """Solve an arm so the hand holds a hilt at grip frame G."""
        Hw = G @ self.grip[side].inverted()            # desired hand bone matrix
        wrist = Hw.to_translation()
        self.ik2(pose, basis, 'upperarm_' + side, 'lowerarm_' + side, 'hand_' + side, wrist, elbow_pole, Hw.to_3x3())

    def curl(self, basis, side, amount, thumb=None):
        """Close the fingers (0 open .. 1 fist). Thumb follows unless given."""
        thumb = amount if thumb is None else thumb
        for f, ang in (('index', (70, 85, 55)), ('middle', (75, 90, 55)), ('ring', (78, 90, 55)), ('pinky', (82, 90, 55)), ('thumb', (25, 35, 45))):
            a = thumb if f == 'thumb' else amount
            for k in range(3):
                n = f'{f}_0{k + 1}_{side}'
                if n not in self.curl_axis:
                    continue
                R = Matrix.Rotation(math.radians(ang[k] * a), 3, self.curl_axis[n])
                basis[n] = self.local_from_arm(n, R)


# ======================================================================= time tracks

def ease(kind, x):
    x = max(0.0, min(1.0, x))
    if kind == 'linear':
        return x
    if kind == 'in':
        return x * x * x
    if kind == 'out':
        return 1 - (1 - x) ** 3
    if kind == 'inout':
        return x * x * (3 - 2 * x)
    if kind == 'snap':     # explosive: almost all motion in the first third
        return 1 - (1 - x) ** 5
    if kind == 'windup':   # slow start, then fast
        return x ** 4
    if kind == 'back':     # overshoot then settle
        c = 1.70158
        y = x - 1
        return 1 + (c + 1) * y ** 3 + c * y ** 2
    return x * x * (3 - 2 * x)


def lerp(a, b, k):
    if isinstance(a, (int, float)):
        return a + (b - a) * k
    return type(a)(x + (y - x) * k for x, y in zip(a, b)) if isinstance(a, tuple) else a.lerp(b, k)


def track(keys, t, loop=None):
    """keys: [(time, value, ease_into_this_key='inout'), ...]. Values: float, tuple or Vector."""
    if loop:
        t = t % loop
    if t <= keys[0][0]:
        return keys[0][1]
    for i in range(1, len(keys)):
        t1 = keys[i][0]
        if t <= t1:
            t0, v0 = keys[i - 1][0], keys[i - 1][1]
            e = keys[i][2] if len(keys[i]) > 2 else 'inout'
            k = ease(e, (t - t0) / max(t1 - t0, 1e-6))
            return lerp(v0, keys[i][1], k)
    return keys[-1][1]


def smooth_track(keys, t, loop=None):
    """Catmull-Rom through (time, value) keys: no stops at intermediate keys (for continuous motion)."""
    if loop:
        t = t % loop
        ks = [(keys[-2][0] - loop, keys[-2][1])] + [(k[0], k[1]) for k in keys] + [(keys[1][0] + loop, keys[1][1])]
    else:
        ks = [(keys[0][0] - 1, keys[0][1])] + [(k[0], k[1]) for k in keys] + [(keys[-1][0] + 1, keys[-1][1])]
    for i in range(1, len(ks) - 2):
        if ks[i][0] <= t <= ks[i + 1][0]:
            p0, p1, p2, p3 = (np.array(ks[j][1], float) for j in (i - 1, i, i + 1, i + 2))
            u = (t - ks[i][0]) / max(ks[i + 1][0] - ks[i][0], 1e-6)
            r = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
            return tuple(r.tolist()) if r.shape else float(r)
    return ks[1][1] if t < ks[1][0] else ks[-2][1]


# ======================================================================= baking

FPS = 60


def new_action(rig, name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = act
    return act


def fcurve(act, rig, path, index, group):
    try:
        return act.fcurve_ensure_for_datablock(rig, path, index=index, group_name=group)
    except Exception:
        fc = act.fcurves.find(path, index=index)
        return fc or act.fcurves.new(path, index=index, action_group=group)


def bake(rig, skel, name, frames, loop=False):
    """frames: list of basis dicts (one per frame at FPS). Writes quaternion keys for every bone plus
    pelvis / Root location; constant channels are removed by the exporter (gltfpack)."""
    act = new_action(rig, name)
    n = len(frames)
    for b in skel.names:
        pb = rig.pose.bones[b]
        pb.rotation_mode = 'QUATERNION'
        qs = np.zeros((n, 4))
        prev = None
        for i, f in enumerate(frames):
            q = f[b].to_quaternion()
            if prev is not None and prev.dot(q) < 0:
                q = -q
            prev = q
            qs[i] = (q.w, q.x, q.y, q.z)
        # identity rotation all clip long: no rotation keys (but Root / pelvis still get their location below)
        rot_keys = np.abs(qs - np.array([1, 0, 0, 0])).max() >= 1e-5
        for k in range(4 if rot_keys else 0):
            fc = fcurve(act, rig, f'pose.bones["{b}"].rotation_quaternion', k, b)
            fc.keyframe_points.add(n)
            co = np.zeros(n * 2)
            co[0::2] = np.arange(n) + 1
            co[1::2] = qs[:, k]
            fc.keyframe_points.foreach_set('co', co)
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
            fc.update()
        if b in ('Root', 'pelvis'):
            ls = np.array([f[b].to_translation()[:] for f in frames])
            for k in range(3):
                fc = fcurve(act, rig, f'pose.bones["{b}"].location', k, b)
                fc.keyframe_points.add(n)
                co = np.zeros(n * 2)
                co[0::2] = np.arange(n) + 1
                co[1::2] = ls[:, k]
                fc.keyframe_points.foreach_set('co', co)
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
                fc.update()
    act['loop'] = bool(loop)
    act.frame_range = (1, max(2, n))
    return act


def run_clip(skel, fn, dur, fps=FPS):
    """fn(t, skel) -> basis dict. Returns frames."""
    n = max(2, int(round(dur * fps)) + 1)
    return [fn(i / fps, skel) for i in range(n)]


# ======================================================================= BVH retarget (CMU)

CMU_MAP = {
    'hip': 'pelvis', 'abdomen': 'spine_02', 'chest': 'spine_03', 'neck': 'neck_01', 'head': 'head',
    'lCollar': 'clavicle_l', 'lShldr': 'upperarm_l', 'lForeArm': 'lowerarm_l', 'lHand': 'hand_l',
    'rCollar': 'clavicle_r', 'rShldr': 'upperarm_r', 'rForeArm': 'lowerarm_r', 'rHand': 'hand_r',
    'lThigh': 'thigh_l', 'lShin': 'calf_l', 'lFoot': 'foot_l',
    'rThigh': 'thigh_r', 'rShin': 'calf_r', 'rFoot': 'foot_r',
}


def load_bvh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=path, axis_forward='-Z', axis_up='Y', global_scale=1.0, rotate_mode='NATIVE',
                            use_fps_scale=False, update_scene_fps=False, update_scene_duration=False)
    src = [o for o in bpy.data.objects if o not in before][0]
    with open(path) as f:
        for line in f:
            if line.startswith('Frame Time:'):
                src['bvh_fps'] = 1.0 / float(line.split(':')[1])
                break
    return src


def sample_bvh(src, frames):
    """World matrices of the source bones for each frame."""
    scn = bpy.context.scene
    out = []
    for fr in frames:
        scn.frame_set(fr)
        out.append({pb.name: (src.matrix_world @ pb.matrix).copy() for pb in src.pose.bones})
    return out


def retarget(skel, src, frame_range, step=1.0, heading=None, scale=None, keep_root_xy=True):
    """Return target basis frames (FPS) from a CMU BVH armature.
    Bone orientation: match each mapped bone's direction (source joint -> child joint) and carry the
    source twist; spine_01 takes half of the abdomen bend. Root motion goes to the Root bone."""
    scn = bpy.context.scene
    src_fps = src.get('bvh_fps', 30.0)
    f0, f1 = frame_range
    # sample times
    n = int((f1 - f0) / src_fps * FPS) + 1
    samples = []
    for i in range(n):
        fr = f0 + i * src_fps / FPS
        scn.frame_set(int(fr), subframe=fr - int(fr))
        samples.append({pb.name: (src.matrix_world @ pb.matrix).copy() for pb in src.pose.bones})
    rest_src = {b.name: (src.matrix_world @ b.matrix_local).copy() for b in src.data.bones}
    # scale: hip height
    hip_rest = rest_src['hip'].to_translation()
    src_leg = (rest_src['lThigh'].to_translation() - rest_src['lFoot'].to_translation()).length + 1e-6
    tgt_leg = (skel.head('thigh_l') - skel.head('foot_l')).length
    k = scale or tgt_leg / src_leg
    # heading: rotate so the source faces our forward (-Y). Estimate from hips at the first sample.
    if heading is None:
        h0 = samples[0]['hip'].to_3x3()
        lt = samples[0]['lThigh'].to_translation() - samples[0]['rThigh'].to_translation()
        lt.z = 0
        # left vector of the subject should map to +X
        ang = math.atan2(lt.y, lt.x)
        heading = -ang
    Rh = Matrix.Rotation(heading, 3, 'Z')
    origin = samples[0]['hip'].to_translation().copy()
    origin.z = 0
    rels = [Rh @ (smp['hip'].to_translation() - origin) * k for smp in samples]
    # root path = moving average of the hip (about one gait cycle): the pelvis keeps its sway
    win = max(1, int(0.45 * FPS))
    roots = []
    for i in range(len(rels)):
        a, b = max(0, i - win), min(len(rels), i + win + 1)
        sx = sum(r.x for r in rels[a:b]) / (b - a)
        sy = sum(r.y for r in rels[a:b]) / (b - a)
        roots.append(Vector((sx, sy, 0)) if keep_root_xy else Vector((0, 0, 0)))
    frames = []
    src_bones = {b.name: b for b in src.data.bones}
    for si, smp in enumerate(samples):
        basis = skel.identity()
        pose = skel.fk(basis)
        hip = smp['hip'].to_translation()
        rel = rels[si]
        root_xy = roots[si]
        basis['Root'] = Matrix.Translation(root_xy)
        skel.fk_one(pose, basis, 'Root')
        for sname, tname in CMU_MAP.items():
            if sname not in smp:
                continue
            Ms = smp[sname].to_3x3()
            Mr = rest_src[sname].to_3x3()
            Rdelta = Rh @ (Ms @ Mr.inverted()) @ Rh.inverted()       # world rotation from source rest
            if tname == 'pelvis':
                # position + orientation
                Rt = Rdelta @ skel.rest['pelvis'].to_3x3()
                p_world = Vector((rel.x, rel.y, skel.head('pelvis').z + (hip.z - hip_rest.z) * k))
                M = Rt.to_4x4()
                M.translation = p_world
                parentM = pose['Root'] @ skel.rest_rel['pelvis']
                basis['pelvis'] = parentM.inverted() @ M
                skel.fk_one(pose, basis, 'pelvis')
                continue
            # direction matching: source bone direction in its rest vs now
            sb = src_bones[sname]
            sdir_now = (Rh @ (Ms @ Vector((0, 1, 0)))).normalized()
            tgt_rest_dir = (skel.rest[tname].to_3x3() @ Vector((0, 1, 0))).normalized()
            src_rest_dir = (Rh @ (Mr @ Vector((0, 1, 0)))).normalized()
            # twist reference: carry the source's rotation about its own axis via the full delta, then
            # correct direction (T-pose vs A-pose arms)
            Rt = Rdelta @ skel.rest[tname].to_3x3()
            cur_dir = (Rt @ Vector((0, 1, 0))).normalized()
            corr = cur_dir.rotation_difference(sdir_now).to_matrix()
            if tname.startswith(('upperarm', 'lowerarm', 'clavicle', 'hand')):
                Rt = corr @ Rt
            if tname == 'spine_02':
                # split the abdomen bend between spine_01 and spine_02
                half = Quaternion().slerp(Rdelta.to_quaternion(), 0.5).to_matrix()
                skel.set_world_rot(pose, basis, 'spine_01', half @ skel.rest['spine_01'].to_3x3())
            skel.set_world_rot(pose, basis, tname, Rt)
        frames.append(basis)
    return frames


def loop_blend(frames, blend=8):
    """Cross-fade the last `blend` frames into the first so a cycle loops without a pop."""
    n = len(frames)
    out = [dict(f) for f in frames]
    for i in range(blend):
        w = (i + 1) / (blend + 1)
        a = frames[n - blend + i]
        b = frames[i]
        f = {}
        for k in a:
            if k == 'Root':
                f[k] = a[k]
                continue
            qa = a[k].to_quaternion()
            qb = b[k].to_quaternion()
            q = qa.slerp(qb, w)
            M = q.to_matrix().to_4x4()
            M.translation = a[k].to_translation().lerp(b[k].to_translation(), w)
            f[k] = M
        out[n - blend + i] = f
    return out


def strip_root_motion(frames, axes='xy'):
    """Remove the Root translation (in-place loops); returns the per-frame displacement removed."""
    disp = []
    for f in frames:
        t = f['Root'].to_translation()
        disp.append(t.copy())
        m = f['Root'].copy()
        tt = m.translation
        if 'x' in axes:
            tt.x = 0
        if 'y' in axes:
            tt.y = 0
        m.translation = tt
        f['Root'] = m
    return disp
