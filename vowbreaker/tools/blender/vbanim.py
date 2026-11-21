"""
vbanim: keys Vowbreaker's animation clips onto an armature.

Poses are rotations in degrees about the ARMATURE axes (XYZ eulers) and, for the hips, an offset
in armature space. Each is applied to its bone relative to the parent as if at rest:
q_local = R_rest^-1 * q_armature * R_rest (R_rest: the bone's rest orientation in armature space).

Between key poses every channel follows a shape-preserving cubic (Fritsch-Carlson), so a pose
that is an extreme holds its value instead of overshooting, and looping clips wrap their tangents
round the loop. Every frame is keyed (the game samples clips itself, stepped on 2s/3s).
"""
import math

import bpy
import numpy as np
from mathutils import Euler, Vector

import vbmesh as M


def channel(keys, f, period=None):
    """Value of a channel [(frame, value)] at frame f."""
    if not isinstance(keys, list):
        return float(keys)
    if len(keys) == 1:
        return float(keys[0][1])
    xs = np.array([k[0] for k in keys], dtype=np.float64)
    ys = np.array([k[1] for k in keys], dtype=np.float64)
    if period:
        # wrap: the clip's last key is its first one again, one period on
        core_x, core_y = xs[:-1], ys[:-1]
        xs = np.concatenate([core_x[-2:] - period, core_x, core_x[:2] + period])
        ys = np.concatenate([core_y[-2:], core_y, core_y[:2]])
        f = f % period
    return float(M.pchip(xs, ys, np.array([f]))[0])


class Keyer:
    def __init__(self, arm):
        self.arm = arm
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}

    def clip(self, name, N, ch, bones, loop=True):
        """ch: {bone: {'rx': [(f, deg)], 'ry': .., 'rz': .., 'tx': [(f, m)], ...}}"""
        arm = self.arm
        ad = arm.animation_data or arm.animation_data_create()
        act = bpy.data.actions.new(name)
        ad.action = act
        last = {}
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        for f in range(N + 1):
            for b in bones:
                c = ch.get(b, {})
                period = N if loop else None
                r = [channel(c.get(k, 0.0), f, period) for k in ('rx', 'ry', 'rz')]
                t = [channel(c.get(k, 0.0), f, period) for k in ('tx', 'ty', 'tz')]
                R = self.rest[b]
                q = R.inverted() @ Euler([math.radians(a) for a in r], 'XYZ').to_quaternion() @ R
                prev = last.get(b)
                if prev is not None and prev.dot(q) < 0:
                    q.negate()
                last[b] = q.copy()
                pb = arm.pose.bones[b]
                pb.rotation_quaternion = q
                pb.location = R.inverted() @ Vector(t)
                pb.keyframe_insert('rotation_quaternion', frame=f, group=b)
                pb.keyframe_insert('location', frame=f, group=b)
        tr = ad.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 0, act)
        tr.mute = True
        ad.action = None
        act.use_fake_user = True
        return act
