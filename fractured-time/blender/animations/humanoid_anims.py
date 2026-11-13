"""
The humanoid animation library, shared by every human on the MPFB game_engine rig (Ethan, the Echo, Imani, Voss, Nyx, HELIX troops).

  blender -b --factory-startup --python-exit-code 1 -P blender/animations/humanoid_anims.py -- [--preview out.json] [--export]

Clips come from CMU motion capture (mocap.py: retargeted, in-place, looped, mirrored) and from poses authored on top of mocap frames
(guard, block, parry, dodges, hit reactions, stagger, chronal ability casts): `Pose` edits a frame in world space (rotate a bone and
everything below it) and re-solves the local rotations, so authored motion keeps the mocap body's weight and proportions.

--export writes public/assets/animations/humanoid.glb (armature + one glTF animation per clip) and humanoid_clips.json: per clip the
duration, loop flag, root speed (m/s, for matching locomotion to the controller) and gameplay events (hit windows with striker bone,
cancel windows, invulnerability, parry window), which the combat system reads. A visible strike lands on its registered hit frame.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

import mocap  # noqa: E402
import mpfb_util as M  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'animations')
MACRO = {'gender': 1.0, 'age': 0.56, 'muscle': 0.7, 'weight': 0.47, 'proportions': 0.66, 'height': 0.64,
         'race': {'african': 0.55, 'caucasian': 0.35, 'asian': 0.10}}
FPS = mocap.FPS


# --- world-space pose editing ---------------------------------------------------------------------------------------------

class Pose:
    """Convert a frame of local rotations to armature-space rotations and back; rotate subtrees in world space."""

    def __init__(self, tgt):
        self.t = tgt
        self.children = {b: [] for b in tgt.order}
        for b in tgt.order:
            p = tgt.parent[b]
            if p:
                self.children[p].append(b)

    def world(self, local):
        t = self.t
        W = {}
        for b in t.order:
            p = t.parent[b]
            q = local[b].to_matrix()
            W[b] = (t.rest[b] @ q) if p is None else (W[p] @ t.rest[p].inverted() @ t.rest[b] @ q)
        return W

    def local(self, W):
        t = self.t
        out = {}
        for b in t.order:
            p = t.parent[b]
            m = (t.rest[b].inverted() @ W[b]) if p is None else (t.rest[b].inverted() @ t.rest[p] @ W[p].inverted() @ W[b])
            out[b] = m.to_quaternion()
        return out

    def subtree(self, b):
        out = [b]
        for c in self.children[b]:
            out += self.subtree(c)
        return out

    def rotate(self, W, bone, axis, deg):
        """Rotate `bone` and its descendants by deg degrees about a world axis ('x' pitch: + bends forward for the spine)."""
        ax = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[axis] if isinstance(axis, str) else Vector(axis)
        R = Matrix.Rotation(math.radians(deg), 3, ax)
        for x in self.subtree(bone):
            W[x] = R @ W[x]
        return W


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def envelope(n, a, b, c, d):
    """0 before a, ease up to 1 at b, hold to c, ease down to 0 at d (sample indices)."""
    out = []
    for i in range(n):
        if i < a:
            out.append(0.0)
        elif i < b:
            out.append(smooth((i - a) / max(b - a, 1)))
        elif i <= c:
            out.append(1.0)
        elif i < d:
            out.append(1 - smooth((i - c) / max(d - c, 1)))
        else:
            out.append(0.0)
    return out


def layer(P, frames, edits, env):
    """Apply world-space edits [(bone, axis, degrees)] weighted by an envelope to every frame."""
    out = []
    for f, w in zip(frames, env):
        if w <= 1e-4:
            out.append(f)
            continue
        W = P.world(f)
        for bone, axis, deg in edits:
            P.rotate(W, bone, axis, deg * w)
        out.append(P.local(W))
    return out


def blend_frames(a, b, w):
    out = {}
    for k in a:
        qa, qb = a[k], b[k]
        if qa.dot(qb) < 0:
            qb = -qb
        out[k] = qa.slerp(qb, w)
    return out


def yaw_clip(P, frames, locs, deg):
    """Turn a whole clip about the vertical axis (pelvis subtree in world space; pelvis offsets rotated with it)."""
    out = []
    for f in frames:
        W = P.world(f)
        P.rotate(W, 'pelvis', 'z', deg)
        out.append(P.local(W))
    rest = P.t.rest['pelvis']
    R = Matrix.Rotation(math.radians(deg), 3, 'Z')
    return out, [rest.inverted() @ (R @ (rest @ v)) for v in locs]


def strike_yaw(rig, tgt, frames, locs, i_hit, bone):
    """Degrees to turn the clip so the strike lands straight ahead (-Y): the hips -> striker direction at the frame of greatest reach
    near the hit (straight punches, hooks and kicks all reach out toward the target)."""
    J = mocap.joints(rig, tgt, frames, locs)
    best, d = -1.0, None
    for i in range(max(0, i_hit - 5), min(len(J), i_hit + 6)):
        hip = Vector(J[i]['pelvis'][0])
        tip = Vector(J[i][bone][1])
        v = (tip - hip)
        v.z = 0
        if v.length > best:
            best, d = v.length, v
    return math.degrees(math.atan2(-1.0, 0.0) - math.atan2(d.y, d.x))


FWD, UP, LEFT = Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))


def aim(P, W, bone, d):
    """Point `bone` along world direction d (its children follow)."""
    cur = (W[bone] @ Vector((0, 1, 0))).normalized()
    R = cur.rotation_difference(Vector(d).normalized()).to_matrix()
    for x in P.subtree(bone):
        W[x] = R @ W[x]


def key_pose(P, base, ops):
    """A key pose: the base pose with world-space ops applied in order: ('rot', bone, axis, deg) or ('aim', bone, dir)."""
    W = P.world(base)
    for op in ops:
        if op[0] == 'rot':
            P.rotate(W, op[1], op[2], op[3])
        else:
            aim(P, W, op[1], op[2])
    return P.local(W)


def ease_out(t):
    return 1 - (1 - t) ** 3


def sequence(keys, n):
    """keys: [(sample, pose, ease)] -> n frames; ease of a key shapes the motion INTO it ('snap' = fast strike, else smooth)."""
    out = []
    for i in range(n):
        for (a, pa, _), (b, pb, e) in zip(keys, keys[1:]):
            if a <= i <= b:
                t = (i - a) / max(b - a, 1)
                out.append(blend_frames(pa, pb, ease_out(t) if e == 'snap' else smooth(t)))
                break
        else:
            out.append(dict(keys[-1][1]))
    return out


def strikes(P, G, gl, only=None, speed=1.0):
    """Authored strikes from the guard G. Each: anticipation -> snap to impact (hit window) -> short hold -> recovery to guard.
    Directions are Blender world (-Y forward, +X the character's left). Returns {name: (frames, locs, meta)}."""
    rest_p = P.t.rest['pelvis']
    defs = {
        # lead (left) jab: shoulder rolls forward, arm snaps straight at chin height, right hand stays home
        'light1': dict(n=14, hit=4, striker='hand_l', keys=[
            (0, []), (2, [('rot', 'spine_02', 'z', 4), ('rot', 'pelvis', 'z', 3)]),
            (4, [('rot', 'pelvis', 'z', -10), ('rot', 'spine_02', 'z', -10), ('rot', 'spine_03', 'z', -6),
                 ('aim', 'upperarm_l', FWD * 1.0 + LEFT * -0.12 + UP * 0.05), ('aim', 'lowerarm_l', FWD + LEFT * -0.1 + UP * 0.06),
                 ('aim', 'hand_l', FWD + UP * 0.05), ('rot', 'head', 'z', 6)], 'snap'),
            (6, 'hold'), (13, [])]),
        # rear (right) cross: hips and shoulders drive through, rear heel turns
        'light2': dict(n=16, hit=5, striker='hand_r', keys=[
            (0, []), (2, [('rot', 'pelvis', 'z', -6), ('rot', 'spine_02', 'z', -4)]),
            (5, [('rot', 'pelvis', 'z', 18), ('rot', 'spine_02', 'z', 14), ('rot', 'spine_03', 'z', 8), ('rot', 'spine_02', 'x', 6),
                 ('aim', 'upperarm_r', FWD + LEFT * 0.14 + UP * 0.04), ('aim', 'lowerarm_r', FWD + LEFT * 0.12 + UP * 0.05),
                 ('aim', 'hand_r', FWD + UP * 0.04), ('rot', 'head', 'z', -8)], 'snap'),
            (7, 'hold'), (15, [])]),
        # lead hook: elbow up at shoulder height, fist sweeps across through the target
        'light3': dict(n=18, hit=7, striker='hand_l', keys=[
            (0, []), (3, [('rot', 'pelvis', 'z', -10), ('rot', 'spine_02', 'z', -10),
                          ('aim', 'upperarm_l', LEFT * 0.9 + FWD * 0.3 + UP * 0.1), ('aim', 'lowerarm_l', FWD * 0.9 + LEFT * 0.3)]),
            (7, [('rot', 'pelvis', 'z', 16), ('rot', 'spine_02', 'z', 18), ('rot', 'spine_03', 'z', 8),
                 ('aim', 'upperarm_l', LEFT * 0.55 + FWD * 0.8 + UP * 0.12), ('aim', 'lowerarm_l', LEFT * -0.85 + FWD * 0.5 + UP * 0.05),
                 ('aim', 'hand_l', LEFT * -0.9 + FWD * 0.4)], 'snap'),
            (9, 'hold'), (17, [])]),
        # heavy 1: chronal palm strike (left gauntlet): coil back, step in, drive the palm out with the whole body
        'heavy1': dict(n=30, hit=14, striker='hand_l', step=0.22, keys=[
            (0, []), (9, [('rot', 'pelvis', 'z', 14), ('rot', 'spine_02', 'z', 16), ('rot', 'spine_02', 'x', -6),
                          ('aim', 'upperarm_l', -FWD * 0.6 + LEFT * 0.5 + UP * -0.6), ('aim', 'lowerarm_l', FWD * 0.6 + UP * 0.4),
                          ('rot', 'hand_l', 'x', -40)]),
            (14, [('rot', 'pelvis', 'z', -16), ('rot', 'spine_02', 'z', -18), ('rot', 'spine_02', 'x', 10), ('rot', 'spine_03', 'z', -8),
                  ('aim', 'upperarm_l', FWD + LEFT * -0.08 + UP * 0.02), ('aim', 'lowerarm_l', FWD + UP * 0.02),
                  ('aim', 'hand_l', UP * 0.9 + FWD * 0.3), ('aim', 'upperarm_r', -FWD * 0.5 + LEFT * -0.4 + UP * -0.7)], 'snap'),
            (18, 'hold'), (29, [])]),
        # heavy 2: front push kick (right): knee chambers high, heel drives out, torso leans back for balance
        'heavy2': dict(n=26, hit=11, striker='foot_r', keys=[
            (0, []), (6, [('rot', 'spine_01', 'x', -8), ('aim', 'thigh_r', FWD * 0.75 + UP * 0.66), ('aim', 'calf_r', -FWD * 0.35 - UP * 0.94),
                          ('aim', 'foot_r', FWD * 0.6 - UP * 0.4)]),
            (11, [('rot', 'spine_01', 'x', -16), ('rot', 'spine_03', 'x', -6), ('aim', 'thigh_r', FWD * 0.93 + UP * 0.36),
                  ('aim', 'calf_r', FWD * 0.99 + UP * 0.12), ('aim', 'foot_r', UP * 0.9 + FWD * 0.3)], 'snap'),
            (14, 'hold'), (19, [('rot', 'spine_01', 'x', -6), ('aim', 'thigh_r', FWD * 0.6 + UP * 0.5), ('aim', 'calf_r', -UP)]),
            (25, [])]),
        # kick (launcher): roundhouse with the right shin, pivot on the lead foot
        'kick': dict(n=28, hit=12, striker='foot_r', keys=[
            (0, []), (6, [('rot', 'pelvis', 'z', 30), ('rot', 'spine_02', 'z', 10), ('aim', 'thigh_r', FWD * 0.5 + LEFT * -0.6 + UP * 0.6),
                          ('aim', 'calf_r', -UP * 0.9 + LEFT * -0.3)]),
            (12, [('rot', 'pelvis', 'z', 70), ('rot', 'spine_01', 'y', 14), ('rot', 'spine_02', 'z', 10),
                  ('aim', 'thigh_r', FWD * 0.75 + LEFT * -0.45 + UP * 0.48), ('aim', 'calf_r', FWD * 0.6 + LEFT * 0.75 + UP * 0.2),
                  ('aim', 'foot_r', FWD * 0.5 + LEFT * 0.7)], 'snap'),
            (15, 'hold'), (21, [('rot', 'pelvis', 'z', 30), ('aim', 'thigh_r', FWD * 0.4 + UP * 0.3), ('aim', 'calf_r', -UP)]),
            (27, [])]),
    }
    out = {}
    for name, d in defs.items():
        if only and name != only:
            continue
        keys = []
        prev = G
        for k in d['keys']:
            i, ops = k[0], k[1]
            e = k[2] if len(k) > 2 else 'smooth'
            pose = prev if ops == 'hold' else key_pose(P, G, ops)
            keys.append((i, pose, e))
            prev = pose
        n = d['n']
        frames = sequence(keys, n)
        frames = fingers(P, frames, 6)  # fists are already closed in the guard; tighten at impact
        step = d.get('step', 0.0)
        locs = []
        for i in range(n):
            # stepping strikes travel the pelvis forward into the hit and back during the recovery
            w = smooth(i / d['hit']) if i <= d['hit'] else 1 - smooth((i - d['hit'] - 3) / max(n - d['hit'] - 4, 1))
            locs.append(gl + rest_p.inverted() @ (FWD * step * max(0.0, min(1.0, w))))
        h = d['hit'] / FPS / speed
        meta = {'speed': 0.0, 'events': {'hit': [h - 1 / FPS, h + 2 / FPS], 'striker': d['striker'],
                                          'cancel': [h + 3 / FPS, n / FPS / speed], 'combo_window': [h, h + 9 / FPS]}}
        if speed != 1.0:
            idx = [min(n - 1, round(i * speed)) for i in range(int(n / speed))]
            frames = [frames[i] for i in idx]
            locs = [locs[i] for i in idx]
        out[name] = (frames, locs, meta)
    return out


def hold(frame, n):
    return [dict(frame) for _ in range(n)]


FINGERS = ('index', 'middle', 'ring', 'pinky')


def fingers(P, frames, curl, thumb=None):
    """Curl the fingers (degrees per joint: ~12 relaxed, ~70 fist) about each hand's palm axis; the thumb tucks in proportion."""
    th = curl * 0.45 if thumb is None else thumb
    out = []
    for f in frames:
        W = P.world(f)
        for side in ('l', 'r'):
            axis = W[f'hand_{side}'] @ Vector((1, 0, 0))
            sgn = 1.0 if side == 'l' else -1.0
            for fn, k in zip(FINGERS, (0.9, 1.0, 1.05, 1.1)):
                for j in (1, 2, 3):
                    P.rotate(W, f'{fn}_0{j}_{side}', axis, sgn * curl * k * (1.0 if j > 1 else 0.8))
            taxis = W[f'hand_{side}'] @ Vector((0, 0, 1))
            for j in (2, 3):
                P.rotate(W, f'thumb_0{j}_{side}', taxis, -sgn * th)
        out.append(P.local(W))
    return out


def breathe(P, frames, period=3.2, amp=1.2):
    """Subtle breathing on held poses (chest + shoulders), so nothing is ever a frozen statue."""
    out = []
    for i, f in enumerate(frames):
        s = math.sin(2 * math.pi * i / (period * FPS))
        W = P.world(f)
        P.rotate(W, 'spine_03', 'x', -amp * s)
        P.rotate(W, 'clavicle_l', 'y', 0.6 * amp * s)
        P.rotate(W, 'clavicle_r', 'y', -0.6 * amp * s)
        out.append(P.local(W))
    return out


# --- clip table ----------------------------------------------------------------------------------------------------------
# (name, cmu id, source start, source end, options). Frames are 120 fps source frames; samples are 30 fps.

LOCO = [
    ('idle', '77_02', 2, 938, dict(loop=(100, 150), in_place=True)),
    ('walk', '16_15', 2, 472, dict(loop=(28, 42), in_place=True)),
    ('run', '35_17', 2, 168, dict(loop=(18, 26), in_place=True)),
    ('sprint', '09_01', 20, 149, dict(loop=(14, 22), in_place=True)),
    ('walk_back', '111_01', 30, 700, dict(loop=(28, 46), in_place=True)),
    ('strafe_l', '69_42', 30, 900, dict(loop=(28, 50), in_place=True)),
    ('talk', '19_08', 60, 2000, dict(loop=(180, 300), in_place=True)),
    ('look_around', '77_05', 2, 1400, dict(in_place=True)),
]
ONE_SHOT = [
    ('jump', '16_05', 92, 260, dict(in_place=True, lift=True)),
    ('run_start', '104_53', 120, 240, dict(in_place=True)),
    ('death', '90_16', 290, 560, dict(in_place=False)),
    ('roll', '90_34', 280, 470, dict(in_place=True, lift=True)),
]


def build_rig():
    h = M.create_human(MACRO)
    rig = M.rig(h, 'game_engine')
    # the mesh is not needed for the clips: keep the armature only
    bpy.data.objects.remove(h)
    return rig


def mocap_clip(tgt, name, cid, a, b, o):
    src = mocap.Source(cid)
    face_dir = None
    rots, hips = src.sample(max(a, src.f0 + 1), min(b, src.f1))
    fr, lc, speed = mocap.retarget(src, tgt, rots, hips, in_place=o.get('in_place', True), mirror=o.get('mirror', False),
                                   face=o.get('face', 'head' if ('hit' in o or o.get('fight')) else ('mean' if 'loop' in o else 'start')),
                                   face_dir=face_dir)
    if o.get('lift'):
        # jumps/rolls: keep the body's height relative to the feet (the capsule does the flying)
        sc = tgt.hip_h / src.hip_h
        for i in range(len(lc)):
            low = min(src.feet[i][0][2], src.feet[i][1][2]) - src.ground
            lc[i] = lc[i] - tgt.rest['pelvis'].inverted() @ Vector((0, 0, max(0.0, low - 0.08 / sc) * sc))
    meta = {'speed': round(speed, 3), 'source': f'CMU {cid} frames {a}-{b}'}
    if 'loop' in o:
        s, P = mocap.find_loop(fr, *o['loop'])
        fr, lc = mocap.make_loop(fr, lc, s, P)
        meta['loop'] = True
    if 'hit' in o:
        f_hit, bone = o['hit']
        i = int(round((f_hit - max(a, src.f0 + 1)) / 4))
        meta['events'] = {'hit': [max(0, i - 2) / FPS, (i + 1) / FPS], 'striker': bone,
                          'cancel': [(i + 4) / FPS, len(fr) / FPS], 'combo_window': [(i + 1) / FPS, (i + 9) / FPS]}
    src.remove()
    return fr, lc, meta


def build(preview=None, export=False):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    rig = build_rig()
    tgt = mocap.Target(rig)
    P = Pose(tgt)
    clips = {}
    fist = {'light1', 'light2', 'light3', 'heavy1', 'heavy2', 'kick', 'roll'}
    yaws = {}
    for name, cid, a, b, o in LOCO + ONE_SHOT:
        fr, lc, meta = mocap_clip(tgt, name, cid, a, b, o)
        if 'events' in meta and 'striker' in meta['events']:
            i_hit = int(round((meta['events']['hit'][0] + meta['events']['hit'][1]) / 2 * FPS))
            yaws[name] = strike_yaw(rig, tgt, fr, lc, i_hit, meta['events']['striker'])
            fr, lc = yaw_clip(P, fr, lc, yaws[name])
            meta['yaw_fix'] = round(yaws[name], 1)
        fr = fingers(P, fr, 68 if name in fist else (18 if name in ('talk', 'look_around') else 26))
        clips[name] = (fr, lc, meta)
        print('clip', name, len(fr), 'samples', meta)
    # mirrored strafe
    fr, lc, meta = mocap_clip(tgt, 'strafe_r', '69_42', 30, 900, dict(loop=(28, 50), in_place=True, mirror=True))
    clips['strafe_r'] = (fingers(P, fr, 26), lc, meta)

    # --- authored on mocap bases -------------------------------------------------------------------------------------------
    # guard: a boxing guard frame from 13_17, held with breathing
    gfr, glc, _ = mocap_clip(tgt, 'guard_src', '13_17', 2548, 2560, dict(in_place=True, fight=True))
    gfr, glc = yaw_clip(P, gfr, glc, -14.1)  # measured from the same take's straight right (strike_yaw)
    guard = fingers(P, gfr[:1], 66)[0]  # fists up
    gl = glc[0]
    n = 96
    gframes = breathe(P, hold(guard, n), period=3.2, amp=1.0)
    gframes[-1] = gframes[0]
    clips['guard'] = (gframes, [gl] * n, {'loop': True, 'speed': 0.0})
    # block: tighter guard (forearms up in front of the face, chin tucked)
    W = P.world(guard)
    for side, sx in (('l', 1), ('r', -1)):
        P.rotate(W, f'upperarm_{side}', 'x', 18)
        P.rotate(W, f'lowerarm_{side}', 'x', 22)
        P.rotate(W, f'upperarm_{side}', 'z', -sx * 8)
    P.rotate(W, 'head', 'x', 10)
    P.rotate(W, 'spine_02', 'x', 6)
    block = P.local(W)
    bframes = breathe(P, hold(block, 60), period=2.4, amp=0.6)
    bframes[-1] = bframes[0]
    clips['block'] = (bframes, [gl] * 60, {'loop': True, 'speed': 0.0})
    # parry: from guard, the lead (left) forearm sweeps out and across, then back to guard. Parry window = first 0.2 s
    n = 18
    seq = [blend_frames(guard, block, smooth(min(1, i / 3))) for i in range(n)]
    seq = layer(P, seq, [('upperarm_l', 'y', -30), ('lowerarm_l', 'z', 40), ('spine_02', 'z', -12)], envelope(n, 0, 3, 6, 14))
    clips['parry'] = (seq, [gl] * n, {'speed': 0.0, 'events': {'parry': [0.0, 0.2], 'cancel': [0.3, n / FPS]}})
    # strikes, authored on the guard (exact direction and hit timing); the counter after a parry is a fast cross
    clips.update(strikes(P, guard, gl))
    cr = strikes(P, guard, gl, only='light2', speed=1.35)['light2']
    clips['counter'] = (cr[0], cr[1], dict(cr[2]))
    # dodges: quick crouched hops (pelvis drop + lean into the direction); i-frames during the hop
    idle0 = clips['guard'][0][0]
    for name, lean_axis, lean in (('dodge_l', 'y', -16), ('dodge_r', 'y', 16), ('dodge_b', 'x', -14), ('dodge_f', 'x', 16)):
        n = 16
        env = envelope(n, 0, 4, 8, 15)
        seq = layer(P, hold(idle0, n), [('pelvis', lean_axis, lean * 0.4), ('spine_02', lean_axis, lean * 0.6),
                                        ('thigh_l', 'x', 25), ('thigh_r', 'x', 25), ('calf_l', 'x', -45), ('calf_r', 'x', -45),
                                        ('foot_l', 'x', 20), ('foot_r', 'x', 20)], env)
        locs = [gl - tgt.rest['pelvis'].inverted() @ Vector((0, 0, 0.12 * w)) for w in env]
        clips[name] = (seq, locs, {'speed': 0.0, 'events': {'iframes': [0.03, 0.33], 'cancel': [0.38, n / FPS]}})
    # hit reactions: head + chest snap back, recover (light); heavy adds a step back
    for name, amt, n in (('hit_light', 1.0, 14), ('hit_heavy', 1.8, 24)):
        env = envelope(n, 0, 2, 3, n - 1)
        seq = layer(P, hold(guard, n), [('spine_02', 'x', -14 * amt), ('head', 'x', -16 * amt), ('upperarm_l', 'x', -12 * amt),
                                        ('upperarm_r', 'x', -12 * amt), ('spine_03', 'z', 6 * amt)], env)
        clips[name] = (seq, [gl] * n, {'speed': 0.0})
    # stagger (guard broken): a long sway back with arms dropping, then a heavy recovery
    n = 42
    env = envelope(n, 0, 6, 20, 41)
    seq = layer(P, hold(guard, n), [('spine_01', 'x', -16), ('spine_03', 'x', -10), ('head', 'x', -18), ('upperarm_l', 'x', -40),
                                    ('upperarm_r', 'x', -40), ('lowerarm_l', 'x', -30), ('lowerarm_r', 'x', -30), ('thigh_l', 'x', 18),
                                    ('calf_l', 'x', -22)], env)
    clips['stagger'] = (seq, [gl] * n, {'speed': 0.0, 'events': {'vulnerable': [0.1, 1.2]}})
    # chronal casts (left gauntlet): raise the forearm, palm out, brace; the effect triggers at 'cast'
    for name, n, cast in (('cast_slow', 24, 8), ('cast_rewind', 30, 10), ('cast_echo', 28, 10), ('cast_shift', 32, 12)):
        env = envelope(n, 0, cast, cast + 6, n - 1)
        seq = layer(P, hold(guard, n), [('upperarm_l', 'x', 38), ('upperarm_l', 'y', -20), ('lowerarm_l', 'x', 34), ('hand_l', 'x', -50),
                                        ('spine_02', 'z', -10), ('head', 'z', -8), ('upperarm_r', 'x', -10)], env)
        clips[name] = (seq, [gl] * n, {'speed': 0.0, 'events': {'cast': cast / FPS, 'cancel': [(cast + 4) / FPS, n / FPS]}})

    clips = game_table(P, clips, guard, block, gl)
    if preview:
        mocap.save_preview(preview, rig, tgt, {k: (v[0], v[1]) for k, v in clips.items()})
    if export:
        export_glb(rig, clips)
    return rig, clips


UPPER = ('spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r',
         'hand_l', 'hand_r') + tuple(f'{f}_0{j}_{s}' for f in ('thumb', 'index', 'middle', 'ring', 'pinky') for j in (1, 2, 3) for s in 'lr')


def overlay(frames, pose, bones=UPPER, w=1.0):
    """Upper body from `pose` over a locomotion cycle (combat walk / strafe in guard)."""
    out = []
    for f in frames:
        g = dict(f)
        for b in bones:
            q0, q1 = f[b], pose[b]
            if q0.dot(q1) < 0:
                q1 = -q1
            g[b] = q0.slerp(q1, w)
        out.append(g)
    return out


def game_table(P, c, guard, block, gl):
    """The gameplay clip set (names, frame counts and combat data the player/enemy code reads, all in 30 fps frames).
    Damage is a multiplier on the attacker's base damage; stagger in seconds; reach/lunge in metres; travel is a Blender-space unit
    direction (-Y forward); window = parry window."""
    def ev(name):
        return c[name][2].get('events', {})

    def fr(sec):
        return int(round(sec * FPS))

    out = {}

    def put(name, src, loop=False, speed=None, events=None, frames=None, locs=None):
        f = frames if frames is not None else c[src][0]
        lc = locs if locs is not None else c[src][1]
        m = {'frames': len(f) - (1 if loop else 0), 'fps': FPS, 'loop': loop, 'events': events or {}}
        if speed is not None:
            m['speed'] = speed
        if src and 'source' in c.get(src, (0, 0, {}))[2]:
            m['source'] = c[src][2]['source']
        out[name] = (f, lc, m)

    sp = lambda k: c[k][2].get('speed', 0.0)  # noqa: E731
    put('idle', 'idle', loop=True)
    put('idle_combat', 'guard', loop=True)
    put('walk', 'walk', loop=True, speed=sp('walk'))
    put('run', 'run', loop=True, speed=sp('run'))
    put('sprint', 'sprint', loop=True, speed=sp('sprint'))
    put('combat_walk_F', 'walk', loop=True, speed=sp('walk'), frames=overlay(c['walk'][0], guard))
    put('combat_walk_B', 'walk_back', loop=True, speed=sp('walk_back'), frames=overlay(c['walk_back'][0], guard))
    put('combat_strafe_L', 'strafe_l', loop=True, speed=1.4, frames=overlay(c['strafe_l'][0], guard))
    put('combat_strafe_R', 'strafe_r', loop=True, speed=1.4, frames=overlay(c['strafe_r'][0], guard))
    # jump (mocap 16_05): crouch + take-off | air | landing. Split at the lift-off and touch-down samples.
    jf, jl = c['jump'][0], c['jump'][1]
    n = len(jf)
    t_off, t_land = int(n * 0.36), int(n * 0.62)
    put('jump', None, events={'launch': 5}, frames=jf[t_off - 14:t_off], locs=jl[t_off - 14:t_off])
    air = jf[t_off:t_land]
    loop_air = air + air[::-1]
    put('fall', None, loop=True, frames=loop_air + [loop_air[0]], locs=[jl[t_off]] * (len(loop_air) + 1))
    put('land', None, events={'impact': 3}, frames=jf[t_land:t_land + 16], locs=jl[t_land:t_land + 16])
    # strikes (authored), damage and reach as tuned in v0
    tune = {'light1': (1.0, 0.35, 0.35, 0.45, 'light1'), 'light2': (1.3, 0.5, 0.4, 0.55, 'light2'), 'light3': (1.6, 0.7, 0.4, 0.4, 'light3'),
            'light4': (2.2, 1.0, 0.55, 0.55, 'kick'), 'heavy1': (3.2, 1.6, 0.5, 0.9, 'heavy1'), 'heavy2': (3.6, 2.0, 0.7, 0.7, 'heavy2'),
            'counter': (4.0, 3.0, 0.5, 0.8, 'counter')}
    for name, (dmg, stg, reach, lunge, src) in tune.items():
        e = ev(src)
        events = {'hit': [fr(e['hit'][0]), fr(e['hit'][1])], 'cancel': fr(e['cancel'][0]), 'striker': e['striker'], 'damage': dmg,
                  'stagger': stg, 'reach': reach, 'lunge': lunge}
        if name in ('heavy1', 'heavy2'):
            events['guardbreak'] = True
        put(name, src, events=events)
    # heavy3: rising palm (launcher) and temporal counter: authored variants of the palm strike
    hv = c['heavy1']
    up = []
    for i, f in enumerate(hv[0]):
        W = P.world(f)
        w = smooth(i / 14) if i <= 14 else 1 - smooth((i - 16) / 12)
        P.rotate(W, 'upperarm_l', 'x', 35 * w)
        P.rotate(W, 'spine_01', 'x', -8 * w)
        up.append(P.local(W))
    e = ev('heavy1')
    put('heavy3', None, frames=up, locs=hv[1], events={'hit': [fr(e['hit'][0]), fr(e['hit'][1])], 'cancel': fr(e['cancel'][0]) + 2,
                                                         'striker': 'hand_l', 'damage': 3.0, 'stagger': 1.2, 'reach': 0.5, 'lunge': 0.4,
                                                         'launch': 1.0})
    tc_idx = [min(len(hv[0]) - 1, round(i * 1.6)) for i in range(int(len(hv[0]) / 1.6))]
    tc_h = round(14 / 1.6)
    put('temporal_counter', None, frames=[hv[0][i] for i in tc_idx], locs=[hv[1][i] for i in tc_idx],
        events={'hit': [tc_h - 1, tc_h + 3], 'cancel': tc_h + 6, 'striker': 'hand_l', 'damage': 6.0, 'stagger': 4.0, 'reach': 0.6,
                'lunge': 1.4})
    # defence
    bs = [blend_frames(guard, block, smooth(i / 7)) for i in range(8)]
    put('block_start', None, frames=bs, locs=[gl] * 8)
    put('block_hold', 'block', loop=True)
    bh = layer(P, hold(block, 14), [('spine_02', 'x', -8), ('upperarm_l', 'x', -10), ('upperarm_r', 'x', -10), ('head', 'x', -6)],
               envelope(14, 0, 2, 3, 13))
    put('block_hit', None, frames=bh, locs=[gl] * 14)
    pe = ev('parry')
    put('parry', 'parry', events={'window': [fr(pe['parry'][0]) + 1, fr(pe['parry'][1]) + 2], 'cancel': fr(pe['cancel'][0])})
    for d, tv in (('F', [0, -1, 0]), ('B', [0, 1, 0]), ('L', [1, 0, 0]), ('R', [-1, 0, 0])):
        e = ev(f'dodge_{d.lower()}')
        put(f'dodge_{d}', f'dodge_{d.lower()}', events={'iframes': [fr(e['iframes'][0]), fr(e['iframes'][1])], 'travel': tv,
                                                       'cancel': fr(e['cancel'][0])})
    put('hit_light', 'hit_light')
    put('hit_heavy', 'hit_heavy')
    put('stagger', 'stagger', events={'cancel': len(c['stagger'][0]) - 10})
    put('defeat', 'death')
    for name, src in (('time_slow', 'cast_slow'), ('rewind', 'cast_rewind'), ('echo', 'cast_echo'), ('timeline_shift', 'cast_shift')):
        e = ev(src)
        put(name, src, events={'activate': fr(e['cast']), 'cancel': fr(e['cancel'][0])})
    put('talk', 'talk', loop=True)
    put('look_around', 'look_around')
    put('roll', 'roll')
    put('run_start', 'run_start')
    # interact: reach out with the right hand to a panel / door control, press, withdraw
    it = sequence([(0, c['idle'][0][0], 'smooth'),
                   (14, key_pose(P, c['idle'][0][0], [('rot', 'spine_02', 'x', 8), ('aim', 'upperarm_r', FWD * 0.8 + LEFT * 0.25 - UP * 0.2),
                                                      ('aim', 'lowerarm_r', FWD + UP * 0.1), ('rot', 'head', 'x', 8)]), 'smooth'),
                   (24, key_pose(P, c['idle'][0][0], [('rot', 'spine_02', 'x', 10), ('aim', 'upperarm_r', FWD * 0.9 + LEFT * 0.25 - UP * 0.1),
                                                      ('aim', 'lowerarm_r', FWD + UP * 0.05), ('rot', 'head', 'x', 8)]), 'snap'),
                   (43, c['idle'][0][0], 'smooth')], 44)
    put('interact', None, frames=it, locs=[c['idle'][1][0]] * 44, events={'use': 24})
    # shock: a temporal distortion hits the room: flinch, brace, look around
    sh = layer(P, hold(c['idle'][0][0], 40), [('spine_02', 'x', -10), ('head', 'x', -12), ('upperarm_l', 'x', 25), ('upperarm_r', 'x', 25),
                                              ('lowerarm_l', 'x', 30), ('lowerarm_r', 'x', 30), ('head', 'z', 18)], envelope(40, 0, 3, 14, 39))
    put('shock', None, frames=sh, locs=[c['idle'][1][0]] * 40)
    return out


def export_glb(rig, clips):
    os.makedirs(OUT, exist_ok=True)
    rig.animation_data_create()
    meta = {}
    for name, (fr, lc, m) in clips.items():
        act = mocap.write_action(rig, name, fr, lc)
        tr = rig.animation_data.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 1, act)
        rig.animation_data.action = None
        meta[name] = m
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, 'humanoid.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1, export_def_bones=False,
                              export_skins=True, export_morph=False, export_extras=False, export_yup=True)
    with open(os.path.join(OUT, 'humanoid_clips.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB', len(clips), 'clips')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    prev = argv[argv.index('--preview') + 1] if '--preview' in argv else None
    build(preview=prev, export='--export' in argv)
