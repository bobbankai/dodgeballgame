"""Animation authoring on the shared humanoid rig (Blender).

Stages (see docs/ANIMATION.md, generated from the clip table):
  Character Rig        the generated armature (skeleton.py); legs/arms get analytic two-bone IK here
  Animation Planning   each Clip carries purpose, length, loop flag, contacts and key-pose notes
  Key Poses            Pose objects in a small semantic language (spine bend/twist, arm raise/forward/
                       elbow, fists, head look, hips offset, foot and hand IK targets)
  FK Animation         poses interpolated per frame with per-key easing (ease in/out, overshoot)
  IK Contact Solving   feet (and optional hands) solved every frame toward targets with knee/elbow
                       poles; planted feet slide back at the clip's travel speed (no foot sliding)
  Motion Refinement    overlapping action: children lag their parents by a few frames; light smoothing
  Secondary Motion     spring chains (hair, tails, coats) are simulated at runtime (Procedural.ts)
  Animation Blending   runtime Animator (crossfades, upper/lower layers, additive hits)
  Deformation Testing  contact sheets of every clip on a skinned character (render_sheet)
  Engine Export        one GLB with the armature and every clip as an action

Rotation convention (Blender armature space; character faces -Y, left is +X, up is +Z): a bone rotation is
an axis-angle in armature axes applied in the bone's rest frame (parent rotations carry children along).
"""
import math
import numpy as np
import bpy
from mathutils import Vector, Quaternion, Matrix, Euler

FPS = 30
X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))
FWD = Vector((0, -1, 0))


def q(axis, deg):
    return Quaternion(Vector(axis).normalized(), math.radians(deg))


def qmul(*qs):
    r = Quaternion()
    for x in qs:
        r = r @ x
    return r


# ------------------------------------------------------------------------------------------ easing

def ease(t, kind):
    t = min(max(t, 0.0), 1.0)
    if kind == 'linear':
        return t
    if kind == 'in':
        return t * t * t
    if kind == 'out':
        return 1 - (1 - t) ** 3
    if kind == 'snap':      # fast out of anticipation into the hit
        return 1 - (1 - t) ** 5
    if kind == 'overshoot':
        c = 1.70158 * 1.2
        t1 = t - 1
        return 1 + (c + 1) * t1 ** 3 + c * t1 ** 2
    if kind == 'hold':
        return 0.0 if t < 1 else 1.0
    return t * t * (3 - 2 * t)  # 'smooth'


# ------------------------------------------------------------------------------------------ poses

class Pose:
    """A key pose. Rotations are quaternions in armature axes keyed by bone name; plus hips offset,
    root yaw, IK targets (armature space, relative to the root at the ground), and finger curls."""

    def __init__(self, **kw):
        self.rot = {}
        self.hips = Vector((0, 0, 0))
        self.ik = {}          # 'foot.L' -> (pos Vector, pitch deg)   'hand.L' -> pos
        self.curl = {}        # 'L'/'R' -> (curl deg, thumb deg, spread)
        for k, val in kw.items():
            setattr(self, k, val)

    def copy(self):
        p = Pose()
        p.rot = {k: v.copy() for k, v in self.rot.items()}
        p.hips = self.hips.copy()
        p.ik = {k: (tuple(x.copy() if hasattr(x, 'copy') else x for x in v) if isinstance(v, tuple) else v.copy()) for k, v in self.ik.items()}
        p.curl = dict(self.curl)
        return p

    def r(self, bone, quat):
        self.rot[bone] = quat @ self.rot.get(bone, Quaternion())
        return self


class Builder:
    """Semantic pose helpers bound to a skeleton (for its rest directions)."""

    def __init__(self, skel):
        self.sk = skel
        self.rest = {b[0]: (Vector(b[1]), Vector(b[2])) for b in skel.bones}

    def dir(self, bone):
        h, t = self.rest[bone]
        return (t - h).normalized()

    def pose(self):
        return Pose()

    # trunk ------------------------------------------------------------------------------------
    def spine(self, p, bend=0.0, side=0.0, twist=0.0, dist=(0.25, 0.35, 0.4)):
        """bend > 0 leans forward, side > 0 leans to the character's left, twist > 0 turns left."""
        for b, w in zip(('hips', 'spine', 'chest'), dist):
            p.r(b, qmul(q(Z, twist * w), q(Y, side * w), q(X, bend * w)))
        return p

    def hips(self, p, bend=0.0, side=0.0, twist=0.0, drop=0.0, fwd=0.0, lat=0.0):
        """Pelvis only (the legs stay planted by IK): drop lowers it, fwd moves it forward."""
        p.r('hips', qmul(q(Z, twist), q(Y, side), q(X, bend)))
        p.hips = p.hips + Vector((lat, -fwd, -drop))
        return p

    def head(self, p, pitch=0.0, yaw=0.0, roll=0.0, neck=0.4):
        """pitch > 0 looks down, yaw > 0 looks left, roll > 0 tilts toward the left shoulder."""
        p.r('neck', qmul(q(Z, yaw * neck), q(Y, -roll * neck), q(X, pitch * neck)))
        p.r('head', qmul(q(Z, yaw * (1 - neck)), q(Y, -roll * (1 - neck)), q(X, pitch * (1 - neck))))
        return p

    # arms -------------------------------------------------------------------------------------
    def arm(self, p, side, raise_=0.0, fwd=0.0, twist=0.0, elbow=0.0, shrug=0.0, wrist=0.0, wrist_side=0.0, forearm_twist=0.0):
        """raise_ > 0 lifts the arm out to the side (from the A-pose), fwd > 0 swings it forward,
        twist rotates it about its own length, elbow > 0 bends the forearm forward/up,
        shrug lifts the shoulder, wrist > 0 flexes the hand toward the palm."""
        s = 1 if side == 'L' else -1
        d = self.dir(f'upperarm.{side}')
        p.r(f'shoulder.{side}', q(Y, -s * shrug))
        p.r(f'upperarm.{side}', qmul(q(X, -fwd), q(Y, -s * raise_), q(d, s * twist)))
        d2 = self.dir(f'forearm.{side}')
        axis = d2.cross(FWD).normalized()
        p.r(f'forearm.{side}', qmul(q(axis, elbow), q(d2, s * forearm_twist)))
        dh = self.dir(f'hand.{side}')
        side_ax, along, back = [Vector(x) for x in self.sk.frames[f'hand.{side}']]
        p.r(f'hand.{side}', qmul(q(side_ax.cross(along).normalized(), 0), q(side_ax, -wrist * s), q(back, wrist_side)))
        _ = dh
        return p

    def fist(self, p, side, curl=85.0, thumb=40.0, spread=0.0):
        p.curl[side] = (curl, thumb, spread)
        return p

    # legs (FK; prefer IK targets for anything touching the ground) ------------------------------
    def leg(self, p, side, fwd=0.0, out=0.0, knee=0.0, ankle=0.0, twist=0.0):
        """fwd > 0 swings the thigh forward, out > 0 abducts, knee > 0 bends, ankle > 0 points the toes."""
        s = 1 if side == 'L' else -1
        p.r(f'thigh.{side}', qmul(q(Z, s * twist), q(Y, s * out), q(X, -fwd)))
        p.r(f'shin.{side}', q(X, knee))
        p.r(f'foot.{side}', q(X, ankle))
        return p

    def foot_ik(self, p, side, pos, pitch=0.0):
        p.ik[f'foot.{side}'] = (Vector(pos), pitch)
        return p

    def hand(self, p, side, pos, pole=None, space='chest'):
        """Hand (wrist) IK target. pos is in the rest pose's armature coordinates; with space='chest' it
        follows the chest's posed transform (guards and punches move with the torso twist). pole is the
        direction the elbow should point (default: down and out)."""
        s = 1 if side == 'L' else -1
        p.ik[f'hand.{side}'] = (Vector(pos), Vector(pole) if pole is not None else Vector((0.55 * s, 0.25, -1.0)), space)
        return p

    def rest_foot(self, side):
        """Ankle position in the rest pose (used as the default planted target)."""
        return Vector(self.sk.j[f'ankle.{side}'])


def blend(a, b, t):
    """Pose interpolation (slerp rotations, lerp offsets/targets)."""
    p = Pose()
    for k in set(a.rot) | set(b.rot):
        qa = a.rot.get(k, Quaternion())
        qb = b.rot.get(k, Quaternion())
        if qa.dot(qb) < 0:
            qb = -qb
        if 0.0 <= t <= 1.0:
            p.rot[k] = qa.slerp(qb, t)
        else:  # overshooting eases extrapolate along the same rotation
            d = qa.inverted() @ qb
            axis, ang = d.to_axis_angle()
            p.rot[k] = qa @ Quaternion(axis, ang * t)
    p.hips = a.hips.lerp(b.hips, t)
    for k in set(a.ik) | set(b.ik):
        va, vb = a.ik.get(k), b.ik.get(k)
        if va is None or vb is None:
            p.ik[k] = va if vb is None else vb
            continue
        if isinstance(va, tuple) and len(va) == 3:
            p.ik[k] = (va[0].lerp(vb[0], t), va[1].lerp(vb[1], t).normalized(), vb[2])
        elif isinstance(va, tuple):
            p.ik[k] = (va[0].lerp(vb[0], t), va[1] + (vb[1] - va[1]) * t)
        else:
            p.ik[k] = va.lerp(vb, t)
    for k in set(a.curl) | set(b.curl):
        ca, cb = a.curl.get(k, (0.0, 0.0, 0.0)), b.curl.get(k, (0.0, 0.0, 0.0))
        p.curl[k] = tuple(x + (y - x) * t for x, y in zip(ca, cb))
    return p


# ------------------------------------------------------------------------------------------ clips

class Clip:
    """keys: list of (time_s, Pose, ease_into_this_key). Planning metadata documents the clip."""

    def __init__(self, name, length, keys, loop=False, purpose='', contacts='', notes='', overlap=True, speed=0.0,
                 smooth=0, feet=None):
        self.name, self.length, self.keys, self.loop = name, length, keys, loop
        self.purpose, self.contacts, self.notes, self.overlap, self.speed = purpose, contacts, notes, overlap, speed
        self.smooth = smooth
        self.feet = feet   # optional callable(t) -> {'foot.L': (pos, pitch), ...} (procedural foot paths)

    def sample(self, t):
        keys = self.keys
        if self.loop:
            t = t % self.length
        if t <= keys[0][0]:
            return keys[0][1].copy()
        for (ta, pa, _), (tb, pb, eb) in zip(keys[:-1], keys[1:]):
            if t <= tb:
                u = (t - ta) / max(tb - ta, 1e-6)
                return blend(pa, pb, ease(u, eb))
        if self.loop:
            ta, pa, _ = keys[-1]
            tb, pb, eb = self.length, keys[0][1], keys[0][2]
            u = (t - ta) / max(tb - ta, 1e-6)
            return blend(pa, pb, ease(u, eb))
        return keys[-1][1].copy()


# ------------------------------------------------------------------------------------------ solving

# overlapping action: how many frames each bone lags behind the pose (children trail their parents)
LAG = {'chest': 1, 'neck': 2, 'head': 3, 'shoulder.L': 1, 'shoulder.R': 1, 'upperarm.L': 1, 'upperarm.R': 1,
       'forearm.L': 2, 'forearm.R': 2, 'hand.L': 3, 'hand.R': 3}


class Solver:
    def __init__(self, arm_ob, builder):
        self.arm = arm_ob
        self.b = builder
        self.pb = arm_ob.pose.bones
        for pb in self.pb:
            pb.rotation_mode = 'QUATERNION'

    def reset(self):
        for pb in self.pb:
            pb.rotation_quaternion = Quaternion()
            pb.location = Vector()
            pb.scale = Vector((1, 1, 1))

    def apply_fk(self, pose):
        for name, qa in pose.rot.items():
            pb = self.pb.get(name)
            if pb is None:
                continue
            R = pb.bone.matrix_local.to_quaternion()
            pb.rotation_quaternion = R.inverted() @ qa @ R
        hb = self.pb['hips']
        R = hb.bone.matrix_local.to_3x3()
        hb.location = R.inverted() @ pose.hips
        # fingers
        for side, (curl, thumb, spread) in pose.curl.items():
            side_ax, along, back = [Vector(x) for x in self.b.sk.frames[f'hand.{side}']]
            s = 1 if side == 'L' else -1
            for fi, f in enumerate(('index', 'middle', 'ring', 'pinky')):
                for i in (1, 2, 3):
                    pb = self.pb.get(f'{f}{i}.{side}')
                    if not pb:
                        continue
                    amt = curl * (0.9 if i == 1 else 1.0 if i == 2 else 0.75) * (1 + 0.06 * fi)
                    qa = q(side_ax, -s * amt)
                    if i == 1 and spread:
                        qa = q(back, spread * (fi - 1.5) * 4) @ qa
                    R = pb.bone.matrix_local.to_quaternion()
                    pb.rotation_quaternion = R.inverted() @ qa @ R
            for i in (1, 2, 3):
                pb = self.pb.get(f'thumb{i}.{side}')
                if not pb:
                    continue
                qa = q(along, s * thumb * (0.6 if i == 1 else 0.8))
                R = pb.bone.matrix_local.to_quaternion()
                pb.rotation_quaternion = R.inverted() @ qa @ R

    def update(self):
        bpy.context.view_layer.update()

    def solve_ik(self, pose):
        for key, tgt in pose.ik.items():
            part, side = key.split('.')
            if part == 'foot':
                self._leg(side, tgt[0], tgt[1])
        for key, tgt in pose.ik.items():
            part, side = key.split('.')
            if part == 'hand':
                pos, pole, space = tgt
                if space == 'chest':
                    ch = self.pb['chest']
                    M = ch.matrix @ ch.bone.matrix_local.inverted()
                    pos = M @ pos
                    pole = M.to_3x3() @ pole
                self._arm(side, pos, pole)

    def _two_bone(self, a, b_len, c_len, target, pole):
        d = target - a
        L = d.length
        L = min(max(L, abs(b_len - c_len) + 1e-4), b_len + c_len - 1e-4)
        dn = d.normalized()
        target = a + dn * L
        # law of cosines
        cosA = (b_len * b_len + L * L - c_len * c_len) / (2 * b_len * L)
        cosA = min(max(cosA, -1), 1)
        sinA = math.sqrt(1 - cosA * cosA)
        pole_dir = (pole - dn * pole.dot(dn))
        if pole_dir.length < 1e-6:
            pole_dir = Vector((0, -1, 0))
        pole_dir.normalize()
        mid = a + dn * (cosA * b_len) + pole_dir * (sinA * b_len)
        return mid, target

    def _set_bone_dir(self, pb, head, tail_target, side_hint):
        """Points a pose bone from its head toward tail_target keeping its X axis near side_hint."""
        y = (tail_target - head).normalized()
        x = (side_hint - y * side_hint.dot(y))
        if x.length < 1e-6:
            x = Vector((1, 0, 0))
        x.normalize()
        z = x.cross(y)
        m = Matrix((x, y, z)).transposed().to_4x4()
        m.translation = head
        pb.matrix = m
        self.update()

    def _leg(self, side, ankle_target, pitch):
        thigh, shin, foot = self.pb[f'thigh.{side}'], self.pb[f'shin.{side}'], self.pb[f'foot.{side}']
        hip = thigh.head.copy()
        l1 = (thigh.bone.tail_local - thigh.bone.head_local).length
        l2 = (shin.bone.tail_local - shin.bone.head_local).length
        # knee pole: forward of the leg, following the hips' facing
        hips_m = self.pb['hips'].matrix.to_3x3()
        fwd = hips_m @ (self.pb['hips'].bone.matrix_local.to_3x3().inverted() @ Vector((0, -1, 0)))
        s = 1 if side == 'L' else -1
        pole = (fwd.normalized() + Vector((s * 0.08, 0, 0)))
        knee, ank = self._two_bone(hip, l1, l2, Vector(ankle_target), pole)
        # the knee bends about the normal of the leg plane; keep the sign of the bone's current X axis
        side_hint = (knee - hip).cross(ank - knee)
        if side_hint.length < 1e-6:
            side_hint = thigh.matrix.to_3x3().col[0].copy()
        side_hint.normalize()
        if side_hint.dot(thigh.matrix.to_3x3().col[0]) < 0:
            side_hint = -side_hint
        self._set_bone_dir(thigh, hip, knee, side_hint)
        self._set_bone_dir(shin, shin.head.copy(), ank, side_hint)
        # foot: keep its rest orientation in world (flat), yawed with the hips, pitched by `pitch`
        rest = foot.bone.matrix_local.copy()
        yaw = math.atan2(-fwd.x, -fwd.y) if fwd.length > 1e-6 else 0.0
        R = Matrix.Rotation(-yaw, 4, 'Z') @ Matrix.Rotation(math.radians(pitch), 4, 'X')
        m = R @ rest
        m.translation = foot.head.copy()
        foot.matrix = m
        self.update()

    def _arm(self, side, hand_target, pole):
        up, fo, hd = self.pb[f'upperarm.{side}'], self.pb[f'forearm.{side}'], self.pb[f'hand.{side}']
        hand_local = hd.matrix_basis.copy()
        sh = up.head.copy()
        l1 = (up.bone.tail_local - up.bone.head_local).length
        l2 = (fo.bone.tail_local - fo.bone.head_local).length
        elbow, wr = self._two_bone(sh, l1, l2, Vector(hand_target), pole)
        # the elbow hinge is the normal of the arm plane; keep the sign of the bones' current X axes
        n = (elbow - sh).cross(wr - elbow)
        if n.length < 1e-6:
            n = up.matrix.to_3x3().col[0].copy()
        n.normalize()
        if n.dot(up.matrix.to_3x3().col[0]) < 0:
            n = -n
        self._set_bone_dir(up, sh, elbow, n)
        nf = n if n.dot(fo.matrix.to_3x3().col[0]) >= 0 else -n
        self._set_bone_dir(fo, fo.head.copy(), wr, nf)
        hd.matrix_basis = hand_local
        self.update()


def bake_clip(arm_ob, builder, clip, action_name=None):
    """Samples the clip every frame (FK + IK + overlap) and writes a Blender action."""
    solver = Solver(arm_ob, builder)
    nframes = max(2, int(round(clip.length * FPS)) + (0 if clip.loop else 1))
    act = bpy.data.actions.new(action_name or clip.name)
    act.use_fake_user = True
    if arm_ob.animation_data is None:
        arm_ob.animation_data_create()
    arm_ob.animation_data.action = act
    # sample poses first so overlap can look back in time
    poses = []
    for f in range(nframes + 4):
        t = f / FPS
        p = clip.sample(t)
        if clip.feet:
            for k, v in clip.feet(t).items():
                p.ik[k] = v
        poses.append(p)

    def lagged(f):
        p = poses[f].copy()
        if clip.overlap:
            for bone, lag in LAG.items():
                fb = f - lag
                if clip.loop:
                    fb %= nframes
                fb = max(fb, 0)
                if bone in poses[fb].rot or bone in p.rot:
                    p.rot[bone] = poses[fb].rot.get(bone, Quaternion())
        return p
    for f in range(nframes):
        solver.reset()
        p = lagged(f)
        solver.apply_fk(p)
        solver.update()
        solver.solve_ik(p)
        for pb in solver.pb:
            pb.keyframe_insert('rotation_quaternion', frame=f + 1, group=pb.name)
            if pb.name in ('hips', 'root'):
                pb.keyframe_insert('location', frame=f + 1, group=pb.name)
    # quaternion continuity + optional smoothing pass (motion refinement)
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    act.frame_range = (1, nframes)
    return act


def _fcurves(act):
    """F-curves of an action (Blender 4.4+ layered actions or legacy)."""
    try:
        return list(act.fcurves)
    except AttributeError:
        out = []
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out += list(cb.fcurves)
        return out
