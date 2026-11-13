"""Animation authoring on the game_engine skeleton, with a control rig.

Poses are written as rotations (degrees) about the *character's* axes at each bone, X = the
character's left, Y = back, Z = up (Blender armature space), and converted to each bone's local
rotation: q_local = R_rest^-1 * R(euler) * R_rest. Read them as:
  +X bends an upward-pointing bone forward and swings a downward-pointing bone back,
  +Z turns a bone counter-clockwise seen from above (towards the character's left),
  +Y tilts an upward bone towards the character's left and lowers the left arm.
`mirror()` turns a left-side pose into the right side (Y and Z flip).

Legs (and optionally the off hand) are driven by a control rig: IK targets for the feet with pole
targets for the knees. Clips key the controllers' world positions (plants, lifts, arcs) plus FK for
the spine, arms and head, then `bake()` evaluates the rig every frame and writes plain FK keys for
the deform bones (Blender's visual-keying bake). The result is what the game plays.

Each clip also records metadata for the game: length, loop, root motion, and named events
(footsteps, hit windows, cancel windows, sounds, effects).
"""
import json
import math

import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

FPS = 30


def mirror(pose):
    """Copy every *_l entry to *_r (and vice versa) with Y and Z rotations flipped."""
    out = dict(pose)

    def flip(v):
        if isinstance(v, dict):
            # local-axis rotations mirror by flipping the bone-local Y and Z (matching rolls)
            r = {}
            if 'arm' in v:
                r['arm'] = (v['arm'][0], -v['arm'][1], -v['arm'][2])
            if 'local' in v:
                r['local'] = (v['local'][0], -v['local'][1], -v['local'][2])
            return r
        return (v[0], -v[1], -v[2])
    for k, v in pose.items():
        if k.endswith('_l'):
            out[k[:-2] + '_r'] = flip(v)
        elif k.endswith('_r') and (k[:-2] + '_l') not in pose:
            out[k[:-2] + '_l'] = flip(v)
    return out


def blend(a, b, t):
    keys = set(a) | set(b)
    return {k: tuple(a.get(k, (0, 0, 0))[i] * (1 - t) + b.get(k, (0, 0, 0))[i] * t for i in range(3)) for k in keys}


def add(*poses):
    out = {}
    for p in poses:
        for k, v in p.items():
            o = out.get(k, (0, 0, 0))
            out[k] = (o[0] + v[0], o[1] + v[1], o[2] + v[2])
    return out


class Poser:
    def __init__(self, rig):
        self.rig = rig
        self.rest = {}
        for b in rig.data.bones:
            self.rest[b.name] = b.matrix_local.to_3x3().normalized()

    def local_quat(self, bone, rot):
        """rot: (x, y, z) degrees about the character's axes, or {'local': (x, y, z)} about the bone's
        own axes (finger curls are cleaner that way), or {'arm': (...), 'local': (...)} for both."""
        if isinstance(rot, dict):
            q = Quaternion()
            if 'arm' in rot:
                q = self.local_quat(bone, rot['arm'])
            if 'local' in rot:
                q = q @ Euler([math.radians(a) for a in rot['local']], 'XYZ').to_quaternion()
            return q
        R = self.rest[bone]
        e = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix()
        return (R.inverted() @ e @ R).to_quaternion()


class Clip:
    """Keys for one animation. Frames are at 30 fps."""

    def __init__(self, name, length, loop=False, ik_legs=True, root_motion=False):
        self.name = name
        self.length = length
        self.loop = loop
        self.ik_legs = ik_legs
        self.root_motion = root_motion
        self.fk = []            # (frame, pose dict, interpolation)
        self.feet = {'l': [], 'r': []}   # (frame, (x, y, z) world, (pitch, yaw) degrees)
        self.poles = {'l': [], 'r': []}
        self.pelvis = []        # (frame, (dx, dy, dz)) offset from rest, metres
        self.root = []          # (frame, (x, y, z), yaw degrees) root motion
        self.events = []        # (frame, name, data)
        self.hand_ik = []       # (frame, (x, y, z) local to weapon socket of the right hand) for two-handed grips

    def key(self, frame, pose, interp='BEZIER'):
        self.fk.append((frame, pose, interp))
        return self

    def foot(self, side, frame, pos, pitch=0.0, yaw=0.0):
        self.feet[side].append((frame, tuple(pos), (pitch, yaw)))
        return self

    def hips(self, frame, offset):
        self.pelvis.append((frame, tuple(offset)))
        return self

    def move(self, frame, pos, yaw=0.0):
        self.root.append((frame, tuple(pos), yaw))
        return self

    def event(self, frame, name, **data):
        self.events.append((frame, name, data))
        return self


class Rigger:
    """Control rig + clip builder for one armature."""

    def __init__(self, rig):
        self.rig = rig
        self.poser = Poser(rig)
        self.scene = bpy.context.scene
        self.scene.render.fps = FPS
        self.ctl = {}
        self._make_controls()
        self.meta = {}

    # ---------------------------------------------------------------- control rig
    def _empty(self, name, loc):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.05
        e.location = loc
        self.scene.collection.objects.link(e)
        return e

    def _make_controls(self):
        rig = self.rig
        pb = rig.pose.bones
        for s in ('l', 'r'):
            foot = rig.matrix_world @ rig.data.bones[f'foot_{s}'].head_local
            knee = rig.matrix_world @ rig.data.bones[f'calf_{s}'].head_local
            self.ctl[f'foot_{s}'] = self._empty(f'ctl_foot_{s}', foot)
            self.ctl[f'pole_{s}'] = self._empty(f'ctl_pole_{s}', knee + Vector((0, -0.5, 0)))
            fe = self.ctl[f'foot_{s}']
            fe.rotation_mode = 'QUATERNION'
            self.foot_rest_rot = getattr(self, 'foot_rest_rot', {})
            self.foot_rest_rot[s] = (rig.matrix_world @ rig.data.bones[f'foot_{s}'].matrix_local).to_quaternion()
            fe.rotation_quaternion = self.foot_rest_rot[s]
            cr = pb[f'foot_{s}'].constraints.new('COPY_ROTATION')
            cr.name = 'ctl_rot'
            cr.target = fe
            cr.target_space = 'WORLD'
            cr.owner_space = 'WORLD'
            cr.influence = 0
            c = pb[f'calf_{s}'].constraints.new('IK')
            c.name = 'ctl_ik'
            c.target = self.ctl[f'foot_{s}']
            c.pole_target = self.ctl[f'pole_{s}']
            c.pole_angle = math.radians(-90)
            c.chain_count = 2
            c.use_stretch = False
            c.influence = 0
            self.foot_rest = getattr(self, 'foot_rest', {})
            self.foot_rest[s] = Vector(foot)
        self.knee_rest = {s: rig.matrix_world @ rig.data.bones[f'calf_{s}'].head_local for s in ('l', 'r')}
        self.pelvis_rest = Vector(rig.data.bones['pelvis'].head_local)

    def _set_ik(self, on):
        for s in ('l', 'r'):
            self.rig.pose.bones[f'calf_{s}'].constraints['ctl_ik'].influence = 1.0 if on else 0.0
            self.rig.pose.bones[f'foot_{s}'].constraints['ctl_rot'].influence = 1.0 if on else 0.0

    def _root_at(self, clip, frame):
        """Interpolated root position (for root-relative foot targets)."""
        if not clip.root:
            return Vector()
        keys = sorted(clip.root, key=lambda k: k[0])
        if frame <= keys[0][0]:
            return Vector(keys[0][1])
        for (f0, p0, _), (f1, p1, _) in zip(keys, keys[1:]):
            if f0 <= frame <= f1:
                t = (frame - f0) / max(f1 - f0, 1e-6)
                t = t * t * (3 - 2 * t)
                return Vector(p0).lerp(Vector(p1), t)
        return Vector(keys[-1][1])

    # ---------------------------------------------------------------- building
    def build(self, clip):
        rig = self.rig
        if rig.animation_data is None:
            rig.animation_data_create()
        work = bpy.data.actions.new(clip.name + '_work')
        rig.animation_data.action = work
        pb = rig.pose.bones
        for b in pb:
            b.rotation_mode = 'QUATERNION'
            b.rotation_quaternion = Quaternion()
            b.location = Vector()
        # FK keys
        for frame, pose, interp in sorted(clip.fk, key=lambda k: k[0]):
            for b in pb:
                rot = pose.get(b.name)
                b.rotation_quaternion = self.poser.local_quat(b.name, rot) if rot else Quaternion()
                b.keyframe_insert('rotation_quaternion', frame=frame + 1)
        # pelvis translation (in the pelvis bone's local space)
        prest = rig.data.bones['pelvis'].matrix_local.to_3x3()
        for frame, off in clip.pelvis:
            pb['pelvis'].location = prest.inverted() @ Vector(off)
            pb['pelvis'].keyframe_insert('location', frame=frame + 1)
        # root motion on the Root bone
        rrest = rig.data.bones['Root'].matrix_local.to_3x3()
        for frame, pos, yaw in clip.root:
            pb['Root'].location = rrest.inverted() @ Vector(pos)
            pb['Root'].rotation_quaternion = self.poser.local_quat('Root', (0, 0, yaw))
            pb['Root'].keyframe_insert('location', frame=frame + 1)
            pb['Root'].keyframe_insert('rotation_quaternion', frame=frame + 1)
        # controllers
        for s in ('l', 'r'):
            e = self.ctl[f'foot_{s}']
            if e.animation_data:
                e.animation_data_clear()
            for frame, pos, (pitch, yaw) in clip.feet[s]:
                e.location = Vector(pos) + self._root_at(clip, frame)
                q = Euler((math.radians(pitch), 0, 0), 'XYZ').to_quaternion()
                qz = Euler((0, 0, math.radians(yaw)), 'XYZ').to_quaternion()
                e.rotation_quaternion = qz @ q @ self.foot_rest_rot[s]
                e.keyframe_insert('location', frame=frame + 1)
                e.keyframe_insert('rotation_quaternion', frame=frame + 1)
            p = self.ctl[f'pole_{s}']
            if p.animation_data:
                p.animation_data_clear()
            if clip.poles[s]:
                for frame, pos in clip.poles[s]:
                    p.location = Vector(pos) + self._root_at(clip, frame)
                    p.keyframe_insert('location', frame=frame + 1)
            elif clip.feet[s]:
                # knee points where the foot points: a pole in front of and above each foot key
                for frame, pos, (pitch, yaw) in clip.feet[s]:
                    fwd = Euler((0, 0, math.radians(yaw)), 'XYZ').to_matrix() @ Vector((0, -0.6, 0.0))
                    p.location = Vector(pos) + self._root_at(clip, frame) + fwd + Vector((0, 0, 0.5))
                    p.keyframe_insert('location', frame=frame + 1)
            else:
                p.location = self.knee_rest[s] + Vector((0, -0.6, 0))
                p.keyframe_insert('location', frame=1)
        self._loop_fix(clip)
        use_ik = clip.ik_legs and all(clip.feet[s] for s in ('l', 'r'))
        self._set_ik(use_ik)
        # bake visual pose to a clean action
        sc = self.scene
        sc.frame_start = 1
        sc.frame_end = clip.length + 1
        bpy.context.view_layer.objects.active = rig
        for o in bpy.context.view_layer.objects:
            o.select_set(o == rig)
        bpy.ops.object.mode_set(mode='POSE')
        bpy.ops.pose.select_all(action='SELECT')
        bpy.ops.nla.bake(frame_start=1, frame_end=clip.length + 1, only_selected=False, visual_keying=True,
                         clear_constraints=False, clear_parents=False, use_current_action=False,
                         bake_types={'POSE'}, channel_types={'LOCATION', 'ROTATION'})
        bpy.ops.object.mode_set(mode='OBJECT')
        baked = rig.animation_data.action
        baked.name = clip.name
        baked.use_fake_user = True
        bpy.data.actions.remove(work)
        self._set_ik(False)
        rig.animation_data.action = None
        self.meta[clip.name] = {
            'length': clip.length / FPS,
            'frames': clip.length,
            'loop': clip.loop,
            'rootMotion': clip.root_motion,
            'events': [{'t': f / FPS, 'name': n, **d} for f, n, d in sorted(clip.events, key=lambda e: e[0])],
        }
        return baked

    def _loop_fix(self, clip):
        """Make looping clips cycle cleanly (the last key equals the first)."""
        if not clip.loop:
            return
        for fc in self._fcurves(self.rig.animation_data.action):
            for k in fc.keyframe_points:
                k.handle_left_type = k.handle_right_type = 'AUTO_CLAMPED'
            mod = fc.modifiers.new('CYCLES')
        for s in ('l', 'r'):
            for e in (self.ctl[f'foot_{s}'], self.ctl[f'pole_{s}']):
                if e.animation_data and e.animation_data.action:
                    for fc in self._fcurves(e.animation_data.action):
                        fc.modifiers.new('CYCLES')

    @staticmethod
    def _fcurves(action):
        """F-curves of an action (Blender 4.4+ layered actions keep them in channelbags)."""
        if hasattr(action, 'fcurves') and len(getattr(action, 'fcurves', [])):
            return list(action.fcurves)
        out = []
        for layer in getattr(action, 'layers', []):
            for strip in layer.strips:
                for bag in getattr(strip, 'channelbags', []):
                    out.extend(bag.fcurves)
        return out

    def write_meta(self, path):
        json.dump({'fps': FPS, 'clips': self.meta}, open(path, 'w'), indent=1)
