"""
Motion capture -> the MPFB game_engine rig (shared by every human in the game).

Source: the CMU Graphics Lab Motion Capture Database in Bruce Hahne's BVH conversion (free for any use; see docs/ASSETS.md),
fetched per file into vendor/cmu/. Retargeting is by world rotation:
  every mapped target bone takes the source bone's rotation change since the source reference pose (the BVH rest, a T-pose),
  applied on top of the target's rest rotation pre-aligned to the source's rest direction (so the target's A-pose arms follow the
  source's T-pose arms correctly). Local pose rotations are then solved down the hierarchy. The pelvis translation is scaled by the
  ratio of hip heights. Locomotion is made in-place (the root travel is removed and its speed recorded for the game), loops are
  found by matching pose + velocity across a period and the seam is blended, and any clip can be mirrored left/right.
Everything is sampled at 30 fps. `clip()` returns the per-frame local rotations, so authored layers (block, parry, chronal casts)
can be added on top before keys are written.
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CMU = os.path.join(ROOT, 'vendor', 'cmu')
FPS = 30

MAP = {
    'Hips': 'pelvis', 'LowerBack': 'spine_01', 'Spine': 'spine_02', 'Spine1': 'spine_03', 'Neck': 'neck_01', 'Head': 'head',
    'LeftShoulder': 'clavicle_l', 'LeftArm': 'upperarm_l', 'LeftForeArm': 'lowerarm_l', 'LeftHand': 'hand_l',
    'RightShoulder': 'clavicle_r', 'RightArm': 'upperarm_r', 'RightForeArm': 'lowerarm_r', 'RightHand': 'hand_r',
    'LeftUpLeg': 'thigh_l', 'LeftLeg': 'calf_l', 'LeftFoot': 'foot_l', 'LeftToeBase': 'ball_l',
    'RightUpLeg': 'thigh_r', 'RightLeg': 'calf_r', 'RightFoot': 'foot_r', 'RightToeBase': 'ball_r',
}
INV = {v: k for k, v in MAP.items()}
REFL = Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, 1)))


def mirror_name(n):
    if n.endswith('_l'):
        return n[:-2] + '_r'
    if n.endswith('_r'):
        return n[:-2] + '_l'
    return n


def fetch(cid):
    p = os.path.join(CMU, f'{cid}.bvh')
    if not os.path.exists(p):
        import urllib.request
        s = cid.split('_')[0]
        os.makedirs(CMU, exist_ok=True)
        urllib.request.urlretrieve(f'https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/{int(s):03d}/{cid}.bvh', p)
    return p


class Target:
    """Rest data of the game rig: armature-space rest rotations/heads, hierarchy order, hip height."""

    def __init__(self, rig):
        self.rig = rig
        self.order = []

        def walk(b):
            self.order.append(b.name)
            for c in b.children:
                walk(c)
        for b in rig.data.bones:
            if b.parent is None:
                walk(b)
        self.rest = {b.name: b.matrix_local.to_3x3().normalized() for b in rig.data.bones}
        self.head = {b.name: Vector(b.head_local) for b in rig.data.bones}
        self.tail = {b.name: Vector(b.tail_local) for b in rig.data.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in rig.data.bones}
        self.hip_h = self.head['pelvis'].z


class Source:
    """A BVH clip imported as an armature; world rotations/positions sampled at 30 fps."""

    def __init__(self, cid):
        path = fetch(cid)
        before = set(bpy.data.objects)
        bpy.ops.import_anim.bvh(filepath=path, frame_start=1, use_fps_scale=False, update_scene_fps=False, update_scene_duration=False,
                                rotate_mode='NATIVE', axis_forward='-Z', axis_up='Y')
        self.obj = next(o for o in bpy.data.objects if o not in before)
        self.cid = cid
        a = self.obj.animation_data.action
        rng = a.frame_range
        self.f0, self.f1 = int(rng[0]), int(rng[1])
        mw = self.obj.matrix_world
        bones = self.obj.data.bones
        self.rest = {n: (mw.to_3x3() @ bones[n].matrix_local.to_3x3()).normalized() for n in MAP}
        self.rest_dir = {n: (mw @ bones[n].tail_local - mw @ bones[n].head_local).normalized() for n in MAP}
        self.rest_hips = mw @ bones['Hips'].head_local
        left = (mw @ bones['LeftUpLeg'].head_local) - (mw @ bones['RightUpLeg'].head_local)
        self.facing = left.cross(Vector((0, 0, 1))).normalized()  # character's forward in the rest pose
        foot = min((mw @ bones['LeftToeBase'].head_local).z, (mw @ bones['RightToeBase'].head_local).z)
        self.hip_h = self.rest_hips.z - foot
        self.ground = foot

    def sample(self, start, end, step=4):
        """World rotations of the mapped bones + hips position, every `step` source frames (120 fps -> 30 fps)."""
        sc = bpy.context.scene
        pb = self.obj.pose.bones
        mw = self.obj.matrix_world
        rots, hips, toes, hands, feet = [], [], [], [], []
        f = float(start)
        while f <= end + 1e-6:
            sc.frame_set(int(f), subframe=f - int(f))
            rots.append({n: (mw.to_3x3() @ pb[n].matrix.to_3x3()).normalized() for n in MAP})
            hips.append(np.array(mw @ pb['Hips'].matrix.translation))
            toes.append(min((mw @ pb['LeftToeBase'].head).z, (mw @ pb['RightToeBase'].head).z))
            hands.append([np.array(mw @ pb['LeftHand'].head), np.array(mw @ pb['RightHand'].head)])
            feet.append([np.array(mw @ pb['LeftFoot'].head), np.array(mw @ pb['RightFoot'].head)])
            f += step
        # the BVH rest skeleton has its hips at the origin: the floor is where the animated toes are
        self.ground = float(np.percentile(toes, 5))
        self.hands = np.array(hands)
        self.feet = np.array(feet)
        return rots, np.array(hips)

    def remove(self):
        arm = self.obj.data
        bpy.data.objects.remove(self.obj)
        bpy.data.armatures.remove(arm)


def _rot_between(a, b):
    a, b = a.normalized(), b.normalized()
    return a.rotation_difference(b).to_matrix()


def retarget(src, tgt, rots, hips, *, in_place=True, yaw=0.0, mirror=False, keep_drift=False, face='mean', face_dir=None):
    """-> per-frame {bone: local Quaternion}, pelvis local locations [Vector], root speed (m/s, target scale).
    face: which heading becomes the character's forward: 'mean' (average hips heading over the segment: loops), 'start' (heading at
    the first sample: one-shots, e.g. a kick after the subject turned), 'rest' (the BVH T-pose)."""
    # facing correction: rotate the source so its rest-pose forward is -Y (the game rig's forward)
    if face_dir is not None:
        f = Vector((face_dir[0], face_dir[1], 0.0))
    elif face == 'rest':
        f = src.facing
    else:
        # 'head': where the eyes look (fighters keep them on the target; boxers' hips and shoulders are bladed)
        key = 'Head' if face == 'head' else 'Hips'
        heads = [(R[key] @ src.rest[key].inverted()) @ src.facing for R in (rots[:1] if face == 'start' else rots)]
        a = np.mean([math.cos(math.atan2(h.y, h.x)) for h in heads]), np.mean([math.sin(math.atan2(h.y, h.x)) for h in heads])
        f = Vector((a[0], a[1], 0.0))
    ang = math.atan2(f.y, f.x) - math.atan2(-1.0, 0.0)
    face_fix = Matrix.Rotation(-ang + yaw, 3, 'Z')
    scale = tgt.hip_h / max(src.hip_h, 1e-6)
    # alignment of each target rest bone to the corrected source rest direction
    align = {}
    for n, b in MAP.items():
        d_src = face_fix @ src.rest_dir[n]
        d_tgt = (tgt.tail[b] - tgt.head[b]).normalized()
        align[b] = _rot_between(d_tgt, d_src)
    # hips trajectory: target units, drift removed for in-place clips
    H = np.array([face_fix @ Vector(h) for h in hips])
    travel = H[-1, :2] - H[0, :2]
    speed = float(np.linalg.norm(travel)) * scale / max((len(H) - 1) / FPS, 1e-6)
    if in_place:
        t = np.arange(len(H))
        for ax in (0, 1):
            k = np.polyfit(t, H[:, ax], 1)
            H[:, ax] -= np.polyval(k, t)
            if keep_drift:
                H[:, ax] += np.polyval(k, t) - np.polyval(k, t)[0]
    else:
        H[:, :2] -= H[0, :2]
    frames, locs = [], []
    for i, R in enumerate(rots):
        world = {}
        for b in tgt.order:
            if b in INV:
                n = INV[b]
                d = (face_fix @ R[n] @ src.rest[n].inverted() @ face_fix.inverted())
                world[b] = (d @ align[b] @ tgt.rest[b]).normalized()
            else:
                p = tgt.parent[b]
                if p is None:
                    world[b] = tgt.rest[b]
                else:
                    world[b] = world[p] @ tgt.rest[p].inverted() @ tgt.rest[b]
        if mirror:
            world = {b: (REFL @ world[mirror_name(b)] @ REFL) for b in world}
            # the reflected matrices of the mirror bones describe this side; keep rotations proper
            world = {b: _proper(m) for b, m in world.items()}
        local = {}
        for b in tgt.order:
            p = tgt.parent[b]
            if p is None:
                local[b] = (tgt.rest[b].inverted() @ world[b]).to_quaternion()
            else:
                local[b] = (tgt.rest[b].inverted() @ tgt.rest[p] @ world[p].inverted() @ world[b]).to_quaternion()
        frames.append(local)
        hp = Vector(H[i]) * scale
        hp.z = (H[i][2] - src.ground) * scale  # height above the source's floor, scaled
        if mirror:
            hp.x = -hp.x
        target_head = Vector((tgt.head['pelvis'].x + hp.x, tgt.head['pelvis'].y + hp.y, hp.z))
        root_rest = tgt.rest['pelvis']
        locs.append(root_rest.inverted() @ (target_head - tgt.head['pelvis']))
    return frames, locs, speed


def _proper(m):
    """REFL @ R @ REFL is already a proper rotation; normalise numerically."""
    return m.normalized()


def find_loop(frames, lo_period, hi_period, search=None):
    """Best (start, period) so that pose and velocity at start match start+period (in samples)."""
    names = [b for b in frames[0] if not b.startswith(('index', 'middle', 'ring', 'pinky', 'thumb', 'Root'))]
    F = np.array([[c for b in names for c in (f[b].w, f[b].x, f[b].y, f[b].z)] for f in frames])
    n = len(F)
    best = (1e9, 0, lo_period)
    starts = range(0, max(1, n - hi_period - 2)) if search is None else search
    for s in starts:
        for P in range(lo_period, hi_period + 1):
            if s + P + 1 >= n:
                break
            e = np.sum(np.abs(np.abs(F[s] - F[s + P]))) + 0.5 * np.sum(np.abs((F[s + 1] - F[s]) - (F[s + P + 1] - F[s + P])))
            if e < best[0]:
                best = (e, s, P)
    return best[1], best[2]


def make_loop(frames, locs, start, period, blend=6):
    """Cut [start, start+period] and blend the last `blend` samples into the first so the clip loops seamlessly."""
    fr = [dict(f) for f in frames[start:start + period + 1]]
    lc = [Vector(v) for v in locs[start:start + period + 1]]
    for k in range(blend):
        i = period - blend + 1 + k
        w = (k + 1) / blend
        for b in fr[i]:
            q0 = fr[0][b]
            q = fr[i][b]
            if q.dot(q0) < 0:
                q0 = -q0
            fr[i][b] = q.slerp(q0, w)
        lc[i] = lc[i].lerp(lc[0], w)
    return fr, lc


def write_action(rig, name, frames, locs, fps=FPS):
    """Keyframe the rig: quaternion rotations for every bone, location for the pelvis. Returns the action."""
    rig.animation_data_create()
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    prev = {}
    for i, (f, loc) in enumerate(zip(frames, locs)):
        for b, q in f.items():
            pb = rig.pose.bones[b]
            pb.rotation_mode = 'QUATERNION'
            if b in prev and prev[b].dot(q) < 0:
                q = -q
            prev[b] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=i + 1)
        pb = rig.pose.bones['pelvis']
        pb.location = loc
        pb.keyframe_insert('location', frame=i + 1)
    act.use_fake_user = True
    return act


def joints(rig, tgt, frames, locs):
    """World joint positions per frame for review (stick figures), computed from the local rotations without the depsgraph."""
    out = []
    for f, loc in zip(frames, locs):
        Mw = {}
        P = {}
        for b in tgt.order:
            p = tgt.parent[b]
            restm = Matrix.Translation(tgt.head[b]) @ tgt.rest[b].to_4x4()
            basis = f[b].to_matrix().to_4x4()
            if b == 'pelvis':
                basis = Matrix.Translation(loc) @ basis
            if p is None:
                Mw[b] = restm @ basis
            else:
                prest = Matrix.Translation(tgt.head[p]) @ tgt.rest[p].to_4x4()
                Mw[b] = Mw[p] @ prest.inverted() @ restm @ basis
            L = (tgt.tail[b] - tgt.head[b]).length
            P[b] = (tuple(Mw[b].translation), tuple(Mw[b] @ Vector((0, L, 0))))
        out.append(P)
    return out


def save_preview(path, rig, tgt, clips):
    """clips: {name: (frames, locs)} -> JSON of joint segments, drawn into contact sheets by tools/anim_sheet.py."""
    data = {}
    for name, (frames, locs) in clips.items():
        J = joints(rig, tgt, frames, locs)
        data[name] = [{b: seg for b, seg in P.items() if not b.startswith(('index', 'middle', 'ring', 'pinky', 'thumb'))} for P in J]
    with open(path, 'w') as fh:
        json.dump(data, fh)
