"""Kael's animation library (also used by every human on the game_engine skeleton).

  /opt/bvenv/bin/python eclipse/tools/blender/kael_anims.py [--only a,b] [--sheet clip] [--no-export]

Writes public/assets/anims/human.glb (skeleton + one glTF animation per clip) and human.json
(length, loop, root motion and events per clip). Locomotion cycles are generated from gait
parameters so planted feet move at exactly the speed the game moves the character (no sliding);
actions (attacks, dodges, reactions) are keyed pose to pose with anticipation, follow-through and
settle, and the legs are solved by the IK control rig before baking.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector

from common import WORK, ASSETS, args, export_glb
from animlib import Clip, Rigger, FPS

A = args()
ONLY = set(A[A.index('--only') + 1].split(',')) if '--only' in A else None

FING = ('index', 'middle', 'ring', 'pinky')


# ----------------------------------------------------------------------------- pose helpers
def flip(v):
    if isinstance(v, dict):
        return {k: (x[0], -x[1], -x[2]) for k, x in v.items()}
    return (v[0], -v[1], -v[2])


def arm(side, up=(0, 40, 0), low=(20, 0, 0), hand=(0, 0, 0), clav=(0, 0, 0), curl=0.25, thumb=0.3, spread=0.0):
    """One arm in left-arm terms (mirrored for the right). curl 0..1 closes the fingers."""
    p = {
        'clavicle_l': clav, 'upperarm_l': up, 'lowerarm_l': low, 'hand_l': hand,
        'thumb_01_l': {'local': (0, 0, 25 * thumb)}, 'thumb_02_l': {'local': (0, 0, 40 * thumb)},
        'thumb_03_l': {'local': (0, 0, 35 * thumb)},
    }
    for i, f in enumerate(FING):
        s = (i - 1.5) * spread * 6
        p[f'{f}_01_l'] = {'local': (0, s, 75 * curl)}
        p[f'{f}_02_l'] = {'local': (0, 0, 90 * curl)}
        p[f'{f}_03_l'] = {'local': (0, 0, 65 * curl)}
    if side == 'l':
        return p
    return {k[:-2] + '_r': flip(v) for k, v in p.items()}


def torso(bend=0.0, twist=0.0, lean=0.0, chest=0.0, neck=(0, 0, 0), head=(0, 0, 0), pelvis=(0, 0, 0)):
    """Spine curve: bend (+ forward), twist (+ to the left), lean (+ to the left); chest lifts the
    ribcage; neck/head absolute."""
    return {
        'pelvis': pelvis,
        'spine_01': (bend * 0.3, lean * 0.3, twist * 0.25),
        'spine_02': (bend * 0.35, lean * 0.35, twist * 0.35),
        'spine_03': (bend * 0.35 - chest, lean * 0.35, twist * 0.4),
        'neck_01': (neck[0] - bend * 0.25, neck[1], neck[2] - twist * 0.3),
        'head': (head[0] - bend * 0.15, head[1] - lean * 0.4, head[2] - twist * 0.3),
    }


def merge(*ds):
    out = {}
    for d in ds:
        out.update(d)
    return out


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


# grips: right hand holds the sword (blade leaves the fist on the index side)
GRIP_R = dict(curl=0.85, thumb=0.75)


# ----------------------------------------------------------------------------- stances
def relaxed_upper(breath=0.0):
    return merge(
        torso(bend=4, chest=3 + 2 * breath, neck=(-3, 0, 0), head=(5, 0, 0)),
        arm('l', up=(3, 41 - breath, 2), low=(18, 0, 0), curl=0.2, clav=(0, -1.5 * breath, 0)),
        arm('r', up=(-12, 34 - breath, -6), low=(-8, 0, 0), hand=(10, -10, 5), clav=(0, -1.5 * breath, 0), **GRIP_R),
    )


def guard_upper(breath=0.0, tw=0.0):
    return merge(
        torso(bend=10, twist=-8 + tw, chest=2 + 2 * breath, neck=(-4, 0, 6), head=(2, 0, 5), pelvis=(0, 0, 18)),
        arm('l', up=(-28, 30, -12), low=(-38, 0, 0), hand=(0, 0, -10), curl=0.35, clav=(0, -1 * breath, -4)),
        arm('r', up=(-40, 22, 12), low=(-42, 0, 0), hand=(-25, 0, 25), clav=(0, -1 * breath, -6), **GRIP_R),
    )


class Body:
    """Rig-specific measurements."""

    def __init__(self, rig):
        b = rig.data.bones
        self.ank = (rig.matrix_world @ b['foot_l'].head_local).z
        self.hip = (rig.matrix_world @ b['pelvis'].head_local).z
        self.leg = (rig.matrix_world @ b['thigh_l'].head_local - rig.matrix_world @ b['foot_l'].head_local).length


# ----------------------------------------------------------------------------- locomotion
def gait(name, body, speed, period, stance=0.6, width=0.11, lift=0.11, heel=0.06, bob=0.02, low=0.0, sway=0.02,
         twist=8, swing=22, lean=4, upper=None, direction=(0.0, -1.0), offset=0.5, base=None, arms_on=True, flight=False):
    """Cyclic gait. direction is the travel direction in Blender XY (character faces -Y).
    The planted foot moves backwards at exactly `speed` (no sliding)."""
    frames = int(round(period * FPS))
    c = Clip(name, frames, loop=True)
    travel = speed * stance * period
    d = Vector((direction[0], direction[1], 0)).normalized()
    side_ax = Vector((1, 0, 0))
    base = base or {'l': (width, 0.0), 'r': (-width, 0.0)}
    for s, ph0 in (('l', 0.0), ('r', offset)):
        bx, by = base[s]
        yaw0 = 6 if s == 'l' else -6
        for f in range(0, frames + 1, 1):
            p = ((f / frames) + ph0) % 1.0
            if p < stance:
                u = p / stance
                along = 0.5 - u
                z = body.ank + heel * smooth((u - 0.65) / 0.35)
                pitch = -14 * (1 - smooth(u / 0.15)) + 34 * smooth((u - 0.65) / 0.35)
            else:
                u = (p - stance) / (1 - stance)
                along = -0.5 + smooth(u)
                z = body.ank + heel * (1 - smooth(u / 0.25)) + lift * math.sin(math.pi * min(1, u * 1.08)) ** 1.2
                pitch = 34 * (1 - smooth(u / 0.5)) - 14 * smooth((u - 0.7) / 0.3)
            pos = Vector((bx, by, 0)) + d * (-along * travel)
            c.foot(s, f, (pos.x, pos.y, z), pitch=pitch, yaw=yaw0)
    for f in range(0, frames + 1, 2):
        p = f / frames
        w = 2 * math.pi * p
        if flight:
            pz = low + bob * math.cos(4 * math.pi * (p - 0.1))
        else:
            pz = low - bob * math.cos(4 * math.pi * p)
        px = sway * math.sin(w)
        c.hips(f, (px, 0, pz))
        pa = 2 * math.pi * (p - 2 / frames)  # arms lag the hips a little
        ub = (upper or relaxed_upper)()
        pose = dict(ub)
        pel = pose.get('pelvis', (0, 0, 0))
        pose['pelvis'] = (pel[0] + lean * 0.3, pel[1] - sway * 60 * math.sin(w), pel[2] - twist * math.cos(w))
        sp = pose.get('spine_03', (0, 0, 0))
        pose['spine_03'] = (sp[0] + lean * 0.5, sp[1], sp[2] + twist * 0.9 * math.cos(w))
        s2 = pose.get('spine_02', (0, 0, 0))
        pose['spine_02'] = (s2[0] + lean * 0.5, s2[1], s2[2] + twist * 0.4 * math.cos(w))
        if arms_on:
            for s, sgn in (('l', 1), ('r', -1)):
                k = f'upperarm_{s}'
                a0 = pose[k]
                sw = swing * math.cos(pa) * sgn
                if s == 'l':
                    pose[k] = (a0[0] + sw, a0[1], a0[2])
                    lk = pose['lowerarm_l']
                    pose['lowerarm_l'] = (lk[0] - max(0, -sw) * 0.9 - swing * 0.3, lk[1], lk[2])
                else:
                    pose[k] = (a0[0] + sw, a0[1], a0[2])
                    lk = pose['lowerarm_r']
                    pose['lowerarm_r'] = (lk[0] - max(0, -sw) * 0.6, lk[1], lk[2])
        c.key(f, pose)
    c.event(0, 'foot', side='l')
    c.event(int(frames * offset), 'foot', side='r')
    return c


def locomotion(body):
    out = []
    out.append(gait('walk', body, speed=1.6, period=1.0, stance=0.62, width=0.1, lift=0.1, bob=0.018, sway=0.022, twist=7, swing=18, lean=3))
    out.append(gait('run', body, speed=5.0, period=0.68, stance=0.36, width=0.085, lift=0.26, heel=0.08, bob=0.035, low=-0.04,
                    sway=0.012, twist=12, swing=42, lean=12, flight=True))
    out.append(gait('sprint', body, speed=7.6, period=0.6, stance=0.3, width=0.08, lift=0.34, heel=0.1, bob=0.04, low=-0.06,
                    sway=0.01, twist=14, swing=55, lean=20, flight=True))
    gu = lambda: guard_upper()  # noqa: E731
    g_base = {'l': (0.17, -0.13), 'r': (-0.17, 0.12)}
    out.append(gait('guard_fwd', body, speed=1.9, period=0.8, stance=0.6, base=g_base, lift=0.08, bob=0.012, low=-0.07,
                    sway=0.01, twist=3, swing=0, lean=6, upper=gu, arms_on=False))
    out.append(gait('guard_back', body, speed=1.5, period=0.8, stance=0.6, base=g_base, lift=0.07, bob=0.012, low=-0.07,
                    sway=0.01, twist=3, swing=0, lean=6, upper=gu, arms_on=False, direction=(0, 1)))
    s_base = {'l': (0.2, -0.08), 'r': (-0.2, 0.08)}
    out.append(gait('guard_left', body, speed=1.2, period=0.62, stance=0.55, base=s_base, lift=0.06, bob=0.01, low=-0.07,
                    sway=0.0, twist=2, swing=0, lean=6, upper=gu, arms_on=False, direction=(1, 0), offset=0.35))
    out.append(gait('guard_right', body, speed=1.2, period=0.62, stance=0.55, base=s_base, lift=0.06, bob=0.01, low=-0.07,
                    sway=0.0, twist=2, swing=0, lean=6, upper=gu, arms_on=False, direction=(-1, 0), offset=0.35))
    return out


# ----------------------------------------------------------------------------- idles
FEET_RELAX = {'l': ((0.115, -0.02), 8), 'r': ((-0.125, 0.03), -10)}
FEET_GUARD = {'l': ((0.17, -0.18), 14), 'r': ((-0.17, 0.16), -28)}


def plant(c, body, frames, feet, low=0.0, sway=0.0):
    for s, ((x, y), yaw) in feet.items():
        for f in frames:
            c.foot(s, f, (x, y, body.ank), yaw=yaw)


def idles(body):
    out = []
    c = Clip('idle', 90, loop=True)
    plant(c, body, (0, 90), FEET_RELAX)
    for f in range(0, 91, 15):
        b = 0.5 - 0.5 * math.cos(2 * math.pi * f / 90)
        c.hips(f, (0.012 + 0.006 * b, 0.0, -0.012 - 0.004 * b))
        c.key(f, relaxed_upper(b))
    out.append(c)
    c = Clip('idle_combat', 60, loop=True)
    plant(c, body, (0, 60), FEET_GUARD)
    for f in range(0, 61, 10):
        b = 0.5 - 0.5 * math.cos(2 * math.pi * f / 60)
        c.hips(f, (0, 0.01, -0.08 - 0.008 * b))
        c.key(f, guard_upper(b, tw=1.5 * math.sin(2 * math.pi * f / 60)))
    out.append(c)
    # look around (exploration idle variation)
    c = Clip('idle_look', 120, loop=False)
    plant(c, body, (0, 120), FEET_RELAX)
    for f, yaw, pitch in ((0, 0, 0), (25, 35, -4), (55, 32, 6), (80, -30, 0), (105, -25, -3), (120, 0, 0)):
        p = relaxed_upper(0.3)
        p['neck_01'] = (p['neck_01'][0] + pitch * 0.4, 0, yaw * 0.35)
        p['head'] = (p['head'][0] + pitch * 0.6, 0, yaw * 0.55)
        p['spine_03'] = (p['spine_03'][0], 0, yaw * 0.15)
        c.key(f, p)
        c.hips(f, (0.012, 0, -0.012))
    out.append(c)
    return out


# ----------------------------------------------------------------------------- combat
def action(name, length, keys, feet=FEET_GUARD, hips=None, root=None, events=(), steps=None, body=None):
    """Pose-to-pose action. keys: [(frame, pose)], hips: [(frame, (dx, dy, dz))], root: [(frame, (x, y, z), yaw)],
    steps: {'l': [(frame, (x, y), yaw, lift)], ...} foot moves (relative to root)."""
    c = Clip(name, length, loop=False, root_motion=bool(root))
    for f, pose in keys:
        c.key(f, pose)
    for f, off in (hips or [(0, (0, 0.01, -0.08)), (length, (0, 0.01, -0.08))]):
        c.hips(f, off)
    for f, pos, yaw in (root or []):
        c.move(f, pos, yaw)
    for s in ('l', 'r'):
        (x, y), yaw = feet[s]
        moves = sorted((steps or {}).get(s, []), key=lambda m: m[0])
        c.foot(s, 0, (x, y, body.ank), yaw=yaw)
        prev = (0, (x, y), yaw)
        for f, (nx, ny), nyaw, lift in moves:
            f0 = prev[0] + max(1, (f - prev[0]) // 3) if False else max(prev[0] + 1, f - 5)
            c.foot(s, f0, (prev[1][0], prev[1][1], body.ank), yaw=prev[2])
            mid = ((prev[1][0] + nx) / 2, (prev[1][1] + ny) / 2)
            c.foot(s, (f0 + f) // 2, (mid[0], mid[1], body.ank + lift), pitch=10, yaw=(prev[2] + nyaw) / 2)
            c.foot(s, f, (nx, ny, body.ank), yaw=nyaw)
            prev = (f, (nx, ny), nyaw)
        c.foot(s, length, (prev[1][0], prev[1][1], body.ank), yaw=prev[2])
    for e in events:
        c.event(e[0], e[1], **(e[2] if len(e) > 2 else {}))
    return c


def P(tw=0.0, bend=10.0, lean=0.0, chest=2.0, pelvis=(0, 0, 18), head=(2, 0, 5), neck=(-4, 0, 6), l=None, r=None):
    """Combat pose: torso + arm overrides (arm dicts in left-arm terms)."""
    la = dict(up=(-28, 30, -12), low=(-38, 0, 0), hand=(0, 0, -10), curl=0.35)
    ra = dict(up=(-40, 22, 12), low=(-42, 0, 0), hand=(-25, 0, 25), **GRIP_R)
    la.update(l or {})
    ra.update(r or {})
    return merge(torso(bend=bend, twist=tw - 8, lean=lean, chest=chest, neck=neck, head=head, pelvis=pelvis), arm('l', **la), arm('r', **ra))


GUARD = P()


def attacks(body):
    out = []
    E = lambda *a: a  # noqa: E731
    # light 1: forehand diagonal (right shoulder -> left hip), short step in
    out.append(action('light_1', 24, [
        (0, GUARD),
        (5, P(tw=-30, bend=6, pelvis=(0, 0, 4), r=dict(up=(-70, -15, 40), low=(-95, 0, 0), hand=(-10, 0, 40)), l=dict(up=(-10, 35, -30)))),
        (8, P(tw=10, bend=14, pelvis=(0, 0, 22), r=dict(up=(-75, 10, -10), low=(-15, 0, 0), hand=(10, 0, -10)), l=dict(up=(5, 40, -10)))),
        (11, P(tw=32, bend=18, pelvis=(0, 0, 34), r=dict(up=(-30, 35, -55), low=(-10, 0, 0), hand=(25, 0, -30)), l=dict(up=(18, 42, 0)))),
        (16, P(tw=26, bend=15, pelvis=(0, 0, 30), r=dict(up=(-28, 30, -45), low=(-20, 0, 0), hand=(15, 0, -20)), l=dict(up=(10, 40, -5)))),
        (24, GUARD),
    ], root=[(0, (0, 0, 0), 0), (4, (0, -0.05, 0), 0), (10, (0, -0.42, 0), 0), (24, (0, -0.45, 0), 0)],
        steps={'l': [(9, (0.17, -0.42), 14, 0.06)], 'r': [(14, (-0.17, -0.12), -28, 0.05)]},
        hips=[(0, (0, 0.01, -0.08)), (5, (0, 0.03, -0.07)), (10, (0, -0.02, -0.11)), (24, (0, 0.01, -0.08))],
        events=[E(4, 'whoosh'), E(7, 'hit_on', {'arc': 'diag_r'}), E(11, 'hit_off'), E(13, 'cancel'), E(17, 'combo'), E(22, 'end')], body=body))
    # light 2: backhand horizontal (left -> right)
    out.append(action('light_2', 24, [
        (0, GUARD),
        (5, P(tw=38, bend=10, pelvis=(0, 0, 32), r=dict(up=(-60, 45, -65), low=(-75, 0, 0), hand=(10, 0, -45)), l=dict(up=(0, 40, 10)))),
        (9, P(tw=-5, bend=12, pelvis=(0, 0, 8), r=dict(up=(-80, 0, 10), low=(-10, 0, 0), hand=(0, 0, 10)), l=dict(up=(5, 42, -20)))),
        (12, P(tw=-38, bend=12, pelvis=(0, 0, -12), r=dict(up=(-55, -20, 60), low=(-12, 0, 0), hand=(-10, 0, 35)), l=dict(up=(-15, 38, -35)))),
        (17, P(tw=-30, bend=11, pelvis=(0, 0, -6), r=dict(up=(-50, -10, 45), low=(-25, 0, 0), hand=(-15, 0, 30)))),
        (24, GUARD),
    ], root=[(0, (0, 0, 0), 0), (6, (0, -0.1, 0), 0), (11, (0, -0.35, 0), 0), (24, (0, -0.38, 0), 0)],
        steps={'r': [(10, (-0.12, -0.05), -20, 0.05)], 'l': [(15, (0.2, -0.3), 14, 0.04)]},
        hips=[(0, (0, 0.01, -0.08)), (5, (0.02, 0.02, -0.07)), (10, (-0.02, -0.02, -0.11)), (24, (0, 0.01, -0.08))],
        events=[E(5, 'whoosh'), E(8, 'hit_on', {'arc': 'horiz_l'}), E(12, 'hit_off'), E(14, 'cancel'), E(17, 'combo'), E(22, 'end')], body=body))
    # light 3: overhead vertical chop
    out.append(action('light_3', 28, [
        (0, GUARD),
        (7, P(tw=-10, bend=-8, chest=8, pelvis=(0, 0, 12), r=dict(up=(-155, 10, 20), low=(-60, 0, 0), hand=(-30, 0, 10)), l=dict(up=(-120, 15, -20), low=(-70, 0, 0)))),
        (11, P(tw=0, bend=24, pelvis=(0, 0, 16), r=dict(up=(-70, 5, 5), low=(-5, 0, 0), hand=(30, 0, 0)), l=dict(up=(-60, 25, -15), low=(-30, 0, 0)))),
        (14, P(tw=4, bend=34, pelvis=(0, 0, 16), r=dict(up=(-30, 15, 0), low=(-5, 0, 0), hand=(40, 0, 0)), l=dict(up=(-20, 35, -10), low=(-30, 0, 0)))),
        (20, P(tw=0, bend=26, pelvis=(0, 0, 16), r=dict(up=(-30, 18, 5), low=(-15, 0, 0), hand=(30, 0, 0)))),
        (28, GUARD),
    ], root=[(0, (0, 0, 0), 0), (8, (0, -0.1, 0), 0), (13, (0, -0.5, 0), 0), (28, (0, -0.52, 0), 0)],
        steps={'l': [(12, (0.18, -0.5), 14, 0.08)], 'r': [(18, (-0.17, -0.18), -28, 0.04)]},
        hips=[(0, (0, 0.01, -0.08)), (7, (0, 0.04, -0.04)), (13, (0, -0.04, -0.16)), (28, (0, 0.01, -0.08))],
        events=[E(6, 'whoosh'), E(10, 'hit_on', {'arc': 'vertical'}), E(14, 'hit_off'), E(14, 'impact'), E(17, 'cancel'), E(20, 'combo'), E(26, 'end')], body=body))
    # light 4: spinning finisher (full turn on the root)
    out.append(action('light_4', 36, [
        (0, GUARD),
        (6, P(tw=-40, bend=8, pelvis=(0, 0, -10), r=dict(up=(-60, -10, 50), low=(-80, 0, 0), hand=(-10, 0, 40)), l=dict(up=(-30, 30, -40)))),
        (12, P(tw=20, bend=14, pelvis=(0, 0, 40), r=dict(up=(-85, 5, -20), low=(-5, 0, 0), hand=(0, 0, -15)), l=dict(up=(20, 50, 10)))),
        (17, P(tw=40, bend=16, pelvis=(0, 0, 50), r=dict(up=(-60, 25, -60), low=(-5, 0, 0), hand=(20, 0, -35)), l=dict(up=(25, 50, 10)))),
        (24, P(tw=30, bend=20, pelvis=(0, 0, 40), r=dict(up=(-25, 30, -50), low=(-15, 0, 0), hand=(25, 0, -30)))),
        (36, GUARD),
    ], root=[(0, (0, 0, 0), 0), (6, (0, -0.05, 0), 20), (14, (0, -0.45, 0), -200), (18, (0, -0.6, 0), -340), (24, (0, -0.65, 0), -360), (36, (0, -0.65, 0), -360)],
        hips=[(0, (0, 0.01, -0.08)), (6, (0, 0.02, -0.06)), (14, (0, -0.02, -0.12)), (36, (0, 0.01, -0.08))],
        events=[E(5, 'whoosh'), E(11, 'hit_on', {'arc': 'spin'}), E(18, 'hit_off'), E(22, 'cancel'), E(33, 'end')], body=body))
    # heavy 1: big two-handed overhead smash
    out.append(action('heavy_1', 40, [
        (0, GUARD),
        (12, P(tw=-25, bend=-12, chest=10, pelvis=(0, 0, 0), r=dict(up=(-165, -5, 40), low=(-70, 0, 0), hand=(-35, 0, 20)), l=dict(up=(-160, 5, 20), low=(-80, 0, 0), curl=0.8))),
        (15, P(tw=-5, bend=10, pelvis=(0, 0, 10), r=dict(up=(-110, 0, 10), low=(-20, 0, 0), hand=(10, 0, 5)), l=dict(up=(-100, 10, 10), low=(-40, 0, 0), curl=0.8))),
        (18, P(tw=5, bend=42, pelvis=(0, 0, 14), r=dict(up=(-40, 10, 0), low=(-5, 0, 0), hand=(45, 0, 0)), l=dict(up=(-35, 15, -5), low=(-30, 0, 0), curl=0.8))),
        (26, P(tw=4, bend=38, pelvis=(0, 0, 14), r=dict(up=(-35, 12, 0), low=(-8, 0, 0), hand=(40, 0, 0)), l=dict(up=(-30, 20, -5), low=(-35, 0, 0)))),
        (40, GUARD),
    ], root=[(0, (0, 0, 0), 0), (12, (0, 0.05, 0), 0), (17, (0, -0.55, 0), 0), (40, (0, -0.58, 0), 0)],
        steps={'l': [(16, (0.2, -0.55), 14, 0.1)], 'r': [(26, (-0.17, -0.2), -28, 0.04)]},
        hips=[(0, (0, 0.01, -0.08)), (12, (0, 0.06, -0.03)), (18, (0, -0.06, -0.2)), (30, (0, -0.03, -0.15)), (40, (0, 0.01, -0.08))],
        events=[E(10, 'charge'), E(14, 'whoosh'), E(15, 'hit_on', {'arc': 'vertical', 'heavy': True}), E(19, 'hit_off'), E(18, 'impact', {'shake': 0.6}),
                E(28, 'cancel'), E(30, 'combo'), E(38, 'end')], body=body))
    # heavy 2: rising diagonal launcher
    out.append(action('heavy_2', 38, [
        (0, P(tw=8, bend=30, r=dict(up=(-35, 15, -10), low=(-10, 0, 0), hand=(30, 0, 0)))),
        (10, P(tw=35, bend=30, pelvis=(0, 0, 30), r=dict(up=(-10, 40, -50), low=(-20, 0, 0), hand=(40, 0, -40)), l=dict(up=(-40, 30, -30), curl=0.8))),
        (15, P(tw=-10, bend=0, chest=8, pelvis=(0, 0, 8), r=dict(up=(-130, 0, 30), low=(-10, 0, 0), hand=(-30, 0, 20)), l=dict(up=(10, 50, 0)))),
        (18, P(tw=-25, bend=-10, chest=10, pelvis=(0, 0, -6), r=dict(up=(-170, -10, 50), low=(-20, 0, 0), hand=(-40, 0, 30)), l=dict(up=(20, 55, 10)))),
        (26, P(tw=-20, bend=-4, pelvis=(0, 0, 0), r=dict(up=(-150, 0, 40), low=(-40, 0, 0), hand=(-30, 0, 20)))),
        (38, GUARD),
    ], root=[(0, (0, 0, 0), 0), (14, (0, -0.4, 0), 0), (38, (0, -0.45, 0), 0)],
        hips=[(0, (0, 0.0, -0.14)), (10, (0, 0.02, -0.18)), (16, (0, -0.02, -0.02)), (38, (0, 0.01, -0.08))],
        events=[E(11, 'whoosh'), E(13, 'hit_on', {'arc': 'rising', 'heavy': True, 'launch': True}), E(17, 'hit_off'), E(27, 'cancel'), E(36, 'end')], body=body))
    # heavy charge (held wind-up) and release
    charge = P(tw=-28, bend=4, chest=6, pelvis=(0, 0, 2), r=dict(up=(-150, -10, 45), low=(-80, 0, 0), hand=(-30, 0, 20)), l=dict(up=(-140, 10, 25), low=(-90, 0, 0), curl=0.8))
    c = action('heavy_charge', 30, [(0, charge), (15, merge(charge, {'spine_03': (0, 2, -11)})), (30, charge)],
               hips=[(0, (0, 0.05, -0.05)), (15, (0.005, 0.05, -0.055)), (30, (0, 0.05, -0.05))], body=body)
    c.loop = True
    out.append(c)
    out.append(action('heavy_charge_start', 12, [(0, GUARD), (12, charge)], hips=[(0, (0, 0.01, -0.08)), (12, (0, 0.05, -0.05))],
                      events=[E(2, 'charge')], body=body))
    # sprint attack: running thrust
    thrust = P(tw=-15, bend=26, pelvis=(0, 0, 0), r=dict(up=(-85, 5, 0), low=(0, 0, 0), hand=(10, 0, 0)), l=dict(up=(25, 50, 10)))
    out.append(action('sprint_attack', 30, [
        (0, P(tw=10, bend=20, r=dict(up=(-20, 30, -20), low=(-80, 0, 0), hand=(-10, 0, 0)))),
        (6, P(tw=25, bend=20, pelvis=(0, 0, 30), r=dict(up=(10, 25, -10), low=(-110, 0, 0), hand=(-20, 0, 0)))),
        (10, thrust), (18, thrust), (30, GUARD),
    ], root=[(0, (0, 0, 0), 0), (10, (0, -1.6, 0), 0), (18, (0, -2.0, 0), 0), (30, (0, -2.05, 0), 0)],
        steps={'l': [(9, (0.18, -0.55), 10, 0.12)], 'r': [(20, (-0.17, -0.1), -28, 0.05)]},
        hips=[(0, (0, 0, -0.1)), (10, (0, -0.06, -0.2)), (30, (0, 0.01, -0.08))],
        events=[E(5, 'whoosh'), E(8, 'hit_on', {'arc': 'thrust'}), E(14, 'hit_off'), E(20, 'cancel'), E(28, 'end')], body=body))
    # air attack: plunge
    out.append(action('air_attack', 30, [
        (0, P(tw=0, bend=-10, chest=6, r=dict(up=(-160, 0, 20), low=(-70, 0, 0), hand=(-30, 0, 0)), l=dict(up=(-150, 10, 0), low=(-80, 0, 0), curl=0.8))),
        (6, P(tw=0, bend=40, r=dict(up=(-40, 10, 0), low=(0, 0, 0), hand=(60, 0, 0)), l=dict(up=(-40, 15, 0), low=(-20, 0, 0), curl=0.8))),
        (18, P(tw=0, bend=45, r=dict(up=(-35, 10, 0), low=(-5, 0, 0), hand=(60, 0, 0)))),
        (30, GUARD),
    ], hips=[(0, (0, 0, 0.0)), (6, (0, -0.05, -0.3)), (18, (0, -0.04, -0.25)), (30, (0, 0.01, -0.08))],
        events=[E(4, 'hit_on', {'arc': 'plunge', 'heavy': True}), E(7, 'impact', {'shake': 0.8}), E(9, 'hit_off'), E(20, 'cancel'), E(28, 'end')], body=body))
    return out


def defense(body):
    out = []
    E = lambda *a: a  # noqa: E731
    block = P(tw=-5, bend=8, pelvis=(0, 0, 20), r=dict(up=(-75, 10, 40), low=(-80, 0, 0), hand=(-20, -30, 60)), l=dict(up=(-55, 15, 20), low=(-95, 0, 0), curl=0.1))
    out.append(action('block_start', 6, [(0, GUARD), (6, block)], body=body))
    c = action('block_idle', 40, [(0, block), (20, merge(block, {'spine_03': (1, 0, -10)})), (40, block)], body=body)
    c.loop = True
    out.append(c)
    out.append(action('block_hit', 16, [
        (0, block), (3, P(tw=-12, bend=-2, pelvis=(0, 0, 14), r=dict(up=(-60, 15, 50), low=(-95, 0, 0), hand=(-30, -30, 60)), l=dict(up=(-45, 18, 25), low=(-100, 0, 0)))), (16, block),
    ], root=[(0, (0, 0, 0), 0), (4, (0, 0.18, 0), 0), (16, (0, 0.22, 0), 0)], hips=[(0, (0, 0.01, -0.08)), (3, (0, 0.04, -0.1)), (16, (0, 0.01, -0.08))], body=body))
    out.append(action('guard_break', 34, [
        (0, block), (5, P(tw=-25, bend=-12, chest=6, pelvis=(0, 0, 0), r=dict(up=(-30, 45, 70), low=(-40, 0, 0)), l=dict(up=(10, 60, 20)), head=(-10, 0, 10))),
        (20, P(tw=-15, bend=-6, r=dict(up=(-20, 40, 40)), l=dict(up=(10, 55, 0)))), (34, GUARD),
    ], root=[(0, (0, 0, 0), 0), (8, (0, 0.5, 0), 0), (34, (0, 0.6, 0), 0)], hips=[(0, (0, 0.01, -0.08)), (6, (0, 0.06, -0.05)), (34, (0, 0.01, -0.08))],
        events=[E(1, 'stagger'), E(32, 'end')], body=body))
    parry = P(tw=-18, bend=6, pelvis=(0, 0, 10), r=dict(up=(-95, -10, 70), low=(-60, 0, 0), hand=(-35, -20, 60)), l=dict(up=(-20, 40, -10)))
    out.append(action('parry', 20, [
        (0, GUARD), (3, parry), (6, merge(parry, {'spine_03': (0, 0, -16)})), (20, GUARD),
    ], hips=[(0, (0, 0.01, -0.08)), (3, (0, 0.03, -0.07)), (20, (0, 0.01, -0.08))],
        events=[E(1, 'parry_on'), E(6, 'parry_off'), E(10, 'cancel'), E(18, 'end')], body=body))
    out.append(action('riposte', 30, [
        (0, parry),
        (5, P(tw=20, bend=14, pelvis=(0, 0, 30), r=dict(up=(5, 30, -20), low=(-110, 0, 0), hand=(-10, 0, 0)))),
        (10, P(tw=-18, bend=28, pelvis=(0, 0, 0), r=dict(up=(-88, 5, 0), low=(0, 0, 0), hand=(8, 0, 0)), l=dict(up=(25, 50, 10)))),
        (18, P(tw=-14, bend=26, r=dict(up=(-85, 5, 0), low=(-5, 0, 0), hand=(8, 0, 0)))),
        (30, GUARD),
    ], root=[(0, (0, 0, 0), 0), (10, (0, -0.6, 0), 0), (30, (0, -0.62, 0), 0)],
        steps={'l': [(9, (0.18, -0.6), 14, 0.08)], 'r': [(18, (-0.17, -0.2), -28, 0.04)]},
        hips=[(0, (0, 0.01, -0.08)), (10, (0, -0.06, -0.17)), (30, (0, 0.01, -0.08))],
        events=[E(6, 'whoosh'), E(8, 'hit_on', {'arc': 'thrust', 'riposte': True}), E(12, 'hit_off'), E(11, 'impact'), E(20, 'cancel'), E(28, 'end')], body=body))
    # dodges: quick sidesteps with root motion and i-frames
    for name, d, lean in (('dodge_f', (0, -2.4), (14, 0)), ('dodge_b', (0, 2.2), (-10, 0)), ('dodge_l', (2.3, 0), (0, 14)), ('dodge_r', (-2.3, 0), (0, -14))):
        low_pose = P(tw=-8, bend=18 + lean[0], lean=lean[1], r=dict(up=(-30, 30, 10), low=(-60, 0, 0)), l=dict(up=(-10, 45, -10), low=(-50, 0, 0)))
        steps = {'l': [(6, (0.17 + d[0] * 0.15, -0.18 + d[1] * 0.15), 14, 0.12), (14, (0.17, -0.18), 14, 0.04)],
                 'r': [(9, (-0.17 + d[0] * 0.1, 0.16 + d[1] * 0.1), -28, 0.1), (16, (-0.17, 0.16), -28, 0.03)]}
        out.append(action(name, 20, [(0, GUARD), (4, low_pose), (11, low_pose), (20, GUARD)],
                          root=[(0, (0, 0, 0), 0), (3, (d[0] * 0.15, d[1] * 0.15, 0), 0), (10, (d[0] * 0.92, d[1] * 0.92, 0), 0), (20, (d[0], d[1], 0), 0)],
                          steps=steps, hips=[(0, (0, 0.01, -0.08)), (4, (0, 0, -0.2)), (11, (0, 0, -0.18)), (20, (0, 0.01, -0.08))],
                          events=[E(1, 'iframes_on'), E(9, 'iframes_off'), E(11, 'cancel'), E(18, 'end')], body=body))
    # roll: full forward roll (pelvis travels over the head)
    tuck = merge(torso(bend=70, neck=(30, 0, 0), head=(20, 0, 0)), arm('l', up=(-90, 20, -20), low=(-100, 0, 0), curl=0.8), arm('r', up=(-90, 20, 20), low=(-100, 0, 0), **GRIP_R),
                 {'thigh_l': (-110, 0, 0), 'thigh_r': (-110, 0, 0), 'calf_l': (130, 0, 0), 'calf_r': (130, 0, 0)})
    c = Clip('roll', 24, loop=False, root_motion=True)
    c.ik_legs = False
    c.key(0, merge(GUARD, {'thigh_l': (-20, 0, 0), 'calf_l': (30, 0, 0), 'thigh_r': (10, 0, 0), 'calf_r': (30, 0, 0)}))
    c.key(5, merge(tuck, {'pelvis': (40, 0, 0)}))
    c.key(10, merge(tuck, {'pelvis': (180, 0, 0)}))
    c.key(15, merge(tuck, {'pelvis': (320, 0, 0)}))
    c.key(20, merge(GUARD, {'thigh_l': (-60, 0, 0), 'calf_l': (90, 0, 0), 'thigh_r': (-20, 0, 0), 'calf_r': (100, 0, 0), 'pelvis': (10, 0, 0)}))
    c.key(24, merge(GUARD, {'thigh_l': (-25, 0, 0), 'calf_l': (40, 0, 0), 'thigh_r': (5, 0, 0), 'calf_r': (40, 0, 0)}))
    for f, off in ((0, (0, 0, -0.08)), (5, (0, -0.2, -0.55)), (10, (0, -0.1, -0.75)), (15, (0, 0.1, -0.6)), (20, (0, 0, -0.35)), (24, (0, 0, -0.1))):
        c.hips(f, off)
    for f, pos in ((0, (0, 0, 0)), (5, (0, -0.8, 0)), (15, (0, -2.6, 0)), (24, (0, -3.2, 0))):
        c.move(f, pos)
    for e in (E(1, 'iframes_on'), E(14, 'iframes_off'), E(9, 'thud'), E(17, 'cancel'), E(22, 'end')):
        c.event(e[0], e[1], **(e[2] if len(e) > 2 else {}))
    out.append(c)
    return out


def reactions(body):
    out = []
    E = lambda *a: a  # noqa: E731
    for name, tw, bend, lean, push in (('hit_front', 0, -14, 0, (0, 0.25)), ('hit_back', 0, 18, 0, (0, -0.25)),
                                       ('hit_left', -15, 0, -14, (-0.22, 0)), ('hit_right', 15, 0, 14, (0.22, 0))):
        flinch = P(tw=tw, bend=bend, lean=lean, chest=-4, head=(bend * -0.6, lean * 0.5, tw), r=dict(up=(-25, 35, 15), low=(-60, 0, 0)), l=dict(up=(-5, 45, -10)))
        out.append(action(name, 18, [(0, GUARD), (3, flinch), (8, merge(flinch, {'spine_03': (bend * 0.2, 0, 0)})), (18, GUARD)],
                          root=[(0, (0, 0, 0), 0), (4, (push[0], push[1], 0), 0), (18, (push[0] * 1.2, push[1] * 1.2, 0), 0)],
                          hips=[(0, (0, 0.01, -0.08)), (3, (push[0] * 0.2, push[1] * 0.2, -0.11)), (18, (0, 0.01, -0.08))],
                          events=[E(14, 'cancel'), E(16, 'end')], body=body))
    stag = P(tw=-20, bend=-18, chest=-6, head=(-20, 0, 15), r=dict(up=(-10, 50, 20), low=(-30, 0, 0)), l=dict(up=(10, 60, -10), low=(-20, 0, 0)))
    out.append(action('stagger', 40, [(0, GUARD), (4, stag), (14, P(tw=-10, bend=30, head=(15, 0, 5), r=dict(up=(-10, 40, 20)), l=dict(up=(0, 50, 0)))), (28, P(bend=20)), (40, GUARD)],
                      root=[(0, (0, 0, 0), 0), (6, (0, 0.7, 0), 0), (16, (0, 0.95, 0), 0), (40, (0, 1.0, 0), 0)],
                      steps={'r': [(8, (-0.17, 0.5), -28, 0.1)], 'l': [(14, (0.15, 0.25), 14, 0.08)]},
                      hips=[(0, (0, 0.01, -0.08)), (5, (0, 0.06, -0.05)), (14, (0, -0.04, -0.2)), (40, (0, 0.01, -0.08))],
                      events=[E(34, 'cancel'), E(38, 'end')], body=body))
    # knockdown: thrown on the back; getup
    c = Clip('knockdown', 30, loop=False, root_motion=True)
    c.ik_legs = False
    c.key(0, GUARD)
    c.key(5, merge(P(tw=-10, bend=-30, chest=-10, head=(-30, 0, 10), r=dict(up=(-10, 70, 30)), l=dict(up=(-20, 75, -20))),
                   {'thigh_l': (-40, 0, 0), 'calf_l': (40, 0, 0), 'thigh_r': (-55, 0, 0), 'calf_r': (30, 0, 0), 'pelvis': (-50, 0, 0)}))
    down = merge(torso(bend=-5, head=(15, 0, 20)), arm('l', up=(10, 25, 0), low=(10, 0, 0)), arm('r', up=(5, 25, 0), low=(5, 0, 0), **GRIP_R),
                 {'thigh_l': (-20, 0, 0), 'calf_l': (30, 0, 0), 'thigh_r': (-5, 0, 0), 'calf_r': (10, 0, 0), 'pelvis': (-88, 0, 0)})
    c.key(14, down)
    c.key(30, down)
    for f, off in ((0, (0, 0, -0.08)), (5, (0, 0.2, -0.45)), (14, (0, 0.35, -0.98)), (30, (0, 0.35, -0.98))):
        c.hips(f, off)
    for f, pos in ((0, (0, 0, 0)), (14, (0, 1.5, 0)), (30, (0, 1.6, 0))):
        c.move(f, pos)
    c.event(13, 'thud')
    c.event(28, 'end')
    out.append(c)
    c = Clip('getup', 40, loop=False)
    c.ik_legs = False
    c.key(0, down)
    c.key(10, merge(torso(bend=40, head=(10, 0, 0)), arm('l', up=(-40, 30, -20), low=(-20, 0, 0)), arm('r', up=(-30, 30, 20), low=(-40, 0, 0), **GRIP_R),
                    {'thigh_l': (-120, 0, 0), 'calf_l': (140, 0, 0), 'thigh_r': (-80, 0, 0), 'calf_r': (150, 0, 0), 'pelvis': (-20, 0, 0)}))
    c.key(24, merge(P(bend=30), {'thigh_l': (-70, 0, 0), 'calf_l': (100, 0, 0), 'thigh_r': (-10, 0, 0), 'calf_r': (80, 0, 0)}))
    c.key(40, merge(GUARD, {'thigh_l': (-20, 0, 0), 'calf_l': (30, 0, 0), 'thigh_r': (5, 0, 0), 'calf_r': (30, 0, 0)}))
    for f, off in ((0, (0, 0.35, -0.98)), (10, (0, 0.1, -0.7)), (24, (0, 0.0, -0.3)), (40, (0, 0.01, -0.08))):
        c.hips(f, off)
    c.event(34, 'cancel')
    c.event(38, 'end')
    out.append(c)
    c = Clip('death', 60, loop=False)
    c.ik_legs = False
    c.key(0, GUARD)
    c.key(10, merge(P(tw=-15, bend=-10, chest=-8, head=(-25, 0, 10), r=dict(up=(-5, 55, 10), low=(-20, 0, 0)), l=dict(up=(-30, 30, -20), low=(-90, 0, 0))),
                    {'thigh_l': (-10, 0, 0), 'calf_l': (60, 0, 0), 'thigh_r': (-30, 0, 0), 'calf_r': (70, 0, 0)}))
    c.key(26, merge(torso(bend=35, head=(30, 0, 0)), arm('l', up=(-30, 30, -10), low=(-30, 0, 0)), arm('r', up=(-10, 40, 0), low=(-10, 0, 0), curl=0.3),
                    {'thigh_l': (-95, 0, 0), 'calf_l': (150, 0, 0), 'thigh_r': (-95, 0, 0), 'calf_r': (150, 0, 0)}))
    c.key(44, merge(torso(bend=20, head=(10, 0, 30)), arm('l', up=(-120, 20, -10), low=(-10, 0, 0), curl=0.3), arm('r', up=(-60, 50, 10), low=(-10, 0, 0), curl=0.2),
                    {'thigh_l': (-20, 0, 0), 'calf_l': (60, 0, 0), 'thigh_r': (-10, 0, 0), 'calf_r': (20, 0, 0), 'pelvis': (80, 0, 0)}))
    c.key(60, merge(torso(bend=18, head=(8, 0, 32)), arm('l', up=(-125, 20, -10), low=(-5, 0, 0), curl=0.2), arm('r', up=(-60, 52, 10), low=(-5, 0, 0), curl=0.15),
                    {'thigh_l': (-15, 0, 0), 'calf_l': (55, 0, 0), 'thigh_r': (-8, 0, 0), 'calf_r': (15, 0, 0), 'pelvis': (86, 0, 0)}))
    for f, off in ((0, (0, 0, -0.08)), (10, (0, 0.05, -0.2)), (26, (0, -0.1, -0.62)), (44, (0, -0.4, -0.95)), (60, (0, -0.42, -0.98))):
        c.hips(f, off)
    c.event(26, 'thud', soft=True)
    c.event(44, 'thud')
    c.event(58, 'end')
    out.append(c)
    return out


def abilities(body):
    out = []
    E = lambda *a: a  # noqa: E731
    # Cinder Arc: wide horizontal slash that throws a wave of fire
    out.append(action('cast_arc', 34, [
        (0, GUARD),
        (8, P(tw=40, bend=8, pelvis=(0, 0, 36), r=dict(up=(-55, 45, -70), low=(-70, 0, 0), hand=(10, 0, -45)), l=dict(up=(-60, 10, 30), low=(-40, 0, 0), curl=0.0, spread=1))),
        (13, P(tw=-20, bend=14, pelvis=(0, 0, 0), r=dict(up=(-85, 0, 20), low=(0, 0, 0), hand=(0, 0, 15)), l=dict(up=(10, 45, -20)))),
        (17, P(tw=-42, bend=14, pelvis=(0, 0, -16), r=dict(up=(-60, -20, 65), low=(-5, 0, 0), hand=(-10, 0, 40)), l=dict(up=(15, 45, -30)))),
        (34, GUARD),
    ], root=[(0, (0, 0, 0), 0), (13, (0, -0.25, 0), 0), (34, (0, -0.27, 0), 0)],
        hips=[(0, (0, 0.01, -0.08)), (8, (0, 0.02, -0.1)), (14, (0, -0.02, -0.14)), (34, (0, 0.01, -0.08))],
        events=[E(4, 'channel'), E(12, 'release', {'ability': 'arc'}), E(24, 'cancel'), E(32, 'end')], body=body))
    # Ember Burst / Thunderfall: leap-less ground slam with both hands
    out.append(action('cast_slam', 40, [
        (0, GUARD),
        (12, P(tw=0, bend=-14, chest=12, r=dict(up=(-170, 0, 25), low=(-50, 0, 0)), l=dict(up=(-170, 0, 10), low=(-40, 0, 0), curl=0.9))),
        (17, P(tw=0, bend=55, r=dict(up=(-40, 10, 0), low=(0, 0, 0), hand=(60, 0, 0)), l=dict(up=(-40, 10, 0), low=(0, 0, 0), curl=0.9))),
        (28, P(tw=0, bend=48, r=dict(up=(-38, 12, 0), low=(-5, 0, 0), hand=(55, 0, 0)), l=dict(up=(-35, 15, 0), low=(-10, 0, 0)))),
        (40, GUARD),
    ], hips=[(0, (0, 0.01, -0.08)), (12, (0, 0.05, 0.02)), (17, (0, -0.05, -0.32)), (28, (0, -0.04, -0.28)), (40, (0, 0.01, -0.08))],
        events=[E(6, 'channel'), E(17, 'release', {'ability': 'slam'}), E(17, 'impact', {'shake': 1.0}), E(30, 'cancel'), E(38, 'end')], body=body))
    # Generic one-handed cast (left palm thrust): bolts, tidal ward, thorn lash
    out.append(action('cast_push', 26, [
        (0, GUARD),
        (6, P(tw=25, bend=6, pelvis=(0, 0, 30), l=dict(up=(-30, 30, 40), low=(-120, 0, 0), hand=(0, 0, 0), curl=0.1))),
        (10, P(tw=-25, bend=14, pelvis=(0, 0, 4), l=dict(up=(-85, 10, -5), low=(0, 0, 0), hand=(-60, 0, 0), curl=0.0, spread=1))),
        (16, P(tw=-22, bend=13, pelvis=(0, 0, 6), l=dict(up=(-80, 12, -5), low=(-8, 0, 0), hand=(-55, 0, 0), curl=0.05, spread=1))),
        (26, GUARD),
    ], hips=[(0, (0, 0.01, -0.08)), (6, (0, 0.03, -0.08)), (10, (0, -0.03, -0.11)), (26, (0, 0.01, -0.08))],
        events=[E(3, 'channel'), E(10, 'release', {'ability': 'push'}), E(18, 'cancel'), E(24, 'end')], body=body))
    # Verdant Bloom: hand to the godspark, then open outward (heal)
    out.append(action('cast_heal', 40, [
        (0, GUARD),
        (10, P(tw=0, bend=-4, chest=6, l=dict(up=(-40, 25, -50), low=(-120, 0, 0), hand=(0, 0, -20), curl=0.2), head=(-10, 0, 0))),
        (22, P(tw=0, bend=-8, chest=10, l=dict(up=(-20, 70, 0), low=(-10, 0, 0), curl=0.0, spread=1), r=dict(up=(-30, 45, 10)), head=(-18, 0, 0))),
        (40, GUARD),
    ], hips=[(0, (0, 0.01, -0.08)), (22, (0, 0.0, -0.04)), (40, (0, 0.01, -0.08))],
        events=[E(4, 'channel'), E(20, 'release', {'ability': 'heal'}), E(30, 'cancel'), E(38, 'end')], body=body))
    # Ember flask: drink to heal
    out.append(action('drink', 48, [
        (0, GUARD),
        (10, P(tw=0, bend=4, l=dict(up=(-20, 30, -40), low=(-115, 0, 0), hand=(0, 0, 0), curl=0.7))),
        (18, P(tw=0, bend=-6, head=(-25, 0, 0), l=dict(up=(-75, 0, -50), low=(-135, 0, 0), hand=(-20, 0, 0), curl=0.7))),
        (34, P(tw=0, bend=-6, head=(-28, 0, 0), l=dict(up=(-78, 0, -50), low=(-135, 0, 0), hand=(-25, 0, 0), curl=0.7))),
        (48, GUARD),
    ], events=[E(18, 'drink'), E(30, 'heal'), E(40, 'cancel'), E(46, 'end')], body=body))
    return out


def traversal(body):
    out = []
    E = lambda *a: a  # noqa: E731
    air = merge(torso(bend=8, chest=4), arm('l', up=(-30, 30, -10), low=(-40, 0, 0)), arm('r', up=(-30, 30, 10), low=(-50, 0, 0), **GRIP_R),
                {'thigh_l': (-45, 0, 0), 'calf_l': (70, 0, 0), 'thigh_r': (-10, 0, 0), 'calf_r': (60, 0, 0), 'foot_l': (15, 0, 0), 'foot_r': (20, 0, 0)})
    c = Clip('jump_start', 10, loop=False)
    c.ik_legs = False
    c.key(0, merge(relaxed_upper(), {'thigh_l': (-30, 0, 0), 'calf_l': (55, 0, 0), 'thigh_r': (-30, 0, 0), 'calf_r': (55, 0, 0), 'foot_l': (-20, 0, 0), 'foot_r': (-20, 0, 0)}))
    c.key(4, merge(torso(bend=-4, chest=6), arm('l', up=(-70, 20, 0), low=(-30, 0, 0)), arm('r', up=(-60, 25, 10), low=(-50, 0, 0), **GRIP_R),
                   {'thigh_l': (-5, 0, 0), 'calf_l': (5, 0, 0), 'thigh_r': (5, 0, 0), 'calf_r': (5, 0, 0), 'foot_l': (40, 0, 0), 'foot_r': (40, 0, 0)}))
    c.key(10, air)
    for f, off in ((0, (0, 0, -0.18)), (4, (0, 0, 0.02)), (10, (0, 0, 0.0))):
        c.hips(f, off)
    c.event(2, 'jump')
    out.append(c)
    c = Clip('fall', 30, loop=True)
    c.ik_legs = False
    c.key(0, air)
    c.key(15, merge(air, {'upperarm_l': (-45, 25, -10), 'thigh_l': (-40, 0, 0), 'thigh_r': (-15, 0, 0)}))
    c.key(30, air)
    out.append(c)
    land = merge(torso(bend=22), arm('l', up=(-20, 45, -10), low=(-40, 0, 0)), arm('r', up=(-20, 40, 10), low=(-50, 0, 0), **GRIP_R))
    c = action('land', 14, [(0, merge(air, {})), (3, land), (14, relaxed_upper())], feet=FEET_RELAX,
               hips=[(0, (0, 0, 0)), (3, (0, 0, -0.22)), (14, (0, 0, -0.01))], events=[E(1, 'land'), E(8, 'cancel'), E(12, 'end')], body=body)
    out.append(c)
    c = action('land_heavy', 30, [(0, air), (4, merge(land, torso(bend=40))), (16, merge(land, torso(bend=30))), (30, relaxed_upper())], feet=FEET_RELAX,
               hips=[(0, (0, 0, 0)), (4, (0, 0, -0.42)), (16, (0, 0, -0.36)), (30, (0, 0, -0.01))],
               events=[E(2, 'land', {'heavy': True}), E(2, 'impact', {'shake': 0.4}), E(20, 'cancel'), E(28, 'end')], body=body)
    out.append(c)
    # interact: reach forward (levers, doors, relics)
    out.append(action('interact', 40, [
        (0, relaxed_upper()),
        (12, merge(relaxed_upper(), torso(bend=22), arm('l', up=(-70, 15, -5), low=(-10, 0, 0), hand=(-20, 0, 0), curl=0.4))),
        (20, merge(relaxed_upper(), torso(bend=24), arm('l', up=(-72, 15, -5), low=(-20, 0, 0), hand=(-10, 0, 0), curl=0.9))),
        (40, relaxed_upper()),
    ], feet=FEET_RELAX, hips=[(0, (0.012, 0, -0.012)), (14, (0, -0.03, -0.07)), (40, (0.012, 0, -0.012))],
        events=[E(18, 'use'), E(36, 'end')], body=body))
    # kneel (cinematic): down on the right knee, rest the sword point on the ground
    kneel = merge(torso(bend=20, head=(14, 0, 0)), arm('l', up=(-20, 40, -10), low=(-60, 0, 0)), arm('r', up=(-35, 20, 10), low=(-40, 0, 0), hand=(30, 0, 0), **GRIP_R))
    c = Clip('kneel', 50, loop=False)
    c.key(0, relaxed_upper())
    c.key(20, kneel)
    c.key(50, merge(kneel, {'head': (20, 0, 0)}))
    for f, off in ((0, (0.012, 0, -0.012)), (20, (0, 0.12, -0.45)), (50, (0, 0.12, -0.46))):
        c.hips(f, off)
    c.foot('l', 0, (0.115, -0.02, body.ank), yaw=8)
    c.foot('l', 8, (0.13, -0.15, body.ank + 0.08), yaw=8)
    c.foot('l', 16, (0.14, -0.3, body.ank), yaw=8)
    c.foot('l', 50, (0.14, -0.3, body.ank), yaw=8)
    c.foot('r', 0, (-0.125, 0.03, body.ank), yaw=-10)
    c.foot('r', 20, (-0.13, 0.42, body.ank + 0.02), pitch=60, yaw=-10)
    c.foot('r', 50, (-0.13, 0.42, body.ank + 0.02), pitch=60, yaw=-10)
    c.event(20, 'kneel')
    out.append(c)
    # talk gestures (cinematic)
    for name, la in (('talk_a', dict(up=(-35, 35, -30), low=(-70, 0, 0), hand=(0, 0, -20), curl=0.1, spread=1)),
                     ('talk_b', dict(up=(-50, 25, -10), low=(-50, 0, 0), hand=(-30, 0, 0), curl=0.3))):
        out.append(action(name, 60, [
            (0, relaxed_upper()), (14, merge(relaxed_upper(), arm('l', **la), torso(bend=6, twist=6, head=(2, 0, -6)))),
            (40, merge(relaxed_upper(), arm('l', **{**la, 'up': (la['up'][0] + 10, la['up'][1], la['up'][2])}), torso(bend=5, twist=3))), (60, relaxed_upper()),
        ], feet=FEET_RELAX, hips=[(0, (0.012, 0, -0.012)), (60, (0.012, 0, -0.012))], body=body))
    return out


def main():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(WORK, 'kael.blend'))
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and '--sheet' not in A:
            bpy.data.objects.remove(o, do_unlink=True)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    body = Body(rig)
    rigger = Rigger(rig)
    clips = locomotion(body) + idles(body) + attacks(body) + defense(body) + reactions(body) + abilities(body) + traversal(body)
    if ONLY:
        clips = [c for c in clips if c.name in ONLY]
    for c in clips:
        rigger.build(c)
        print('built', c.name, c.length, 'frames', flush=True)
    for o in list(bpy.data.objects):
        if o.name.startswith('ctl_'):
            bpy.data.objects.remove(o, do_unlink=True)
    for b in rig.pose.bones:
        for con in list(b.constraints):
            b.constraints.remove(con)
    out = os.path.join(ASSETS, 'anims')
    os.makedirs(out, exist_ok=True)
    if '--sheet' in A:
        sheet(rig, A[A.index('--sheet') + 1].split(','))
    if '--no-export' not in A:
        # every action must be exportable on the armature: give each its own NLA track
        rig.animation_data_create()
        # the IK controller empties leave their own baked actions behind; only clips go out
        for act in list(bpy.data.actions):
            if act.name not in rigger.meta:
                bpy.data.actions.remove(act)
        for act in bpy.data.actions:
            tr = rig.animation_data.nla_tracks.new()
            tr.name = act.name
            st = tr.strips.new(act.name, int(act.frame_range[0]), act)
            tr.mute = True
        export_glb(os.path.join(out, 'human.glb'), [rig], animations=True, morphs=False, skins=False)
        prev = {}
        meta_path = os.path.join(out, 'human.json')
        if ONLY and os.path.exists(meta_path):
            import json
            prev = json.load(open(meta_path)).get('clips', {})
            prev.update(rigger.meta)
            rigger.meta = prev
        rigger.write_meta(meta_path)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'anims.blend'))


def sheet(rig, names, per=8):
    """Contact sheets: `per` frames of each named clip, side view."""
    import math as m
    from PIL import Image, ImageDraw
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 4
    sc.render.resolution_x, sc.render.resolution_y = 220, 320
    cam_d = bpy.data.cameras.new('c')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = 2.6
    cam = bpy.data.objects.new('c', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sun = bpy.data.lights.new('s', 'SUN')
    sun.energy = 3
    so = bpy.data.objects.new('s', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (m.radians(45), 0, m.radians(30))
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.4, 0.4, 0.42)
    rows = []
    for name in names:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        rig.animation_data_create()
        rig.animation_data.action = act
        f0, f1 = act.frame_range
        tiles = []
        for i in range(per):
            fr = int(f0 + (f1 - f0) * i / (per - 1))
            sc.frame_set(fr)
            root = rig.pose.bones['Root']
            rp = rig.matrix_world @ root.head
            cam.location = (rp.x + 5, rp.y, 1.0)
            cam.rotation_euler = (m.radians(90), 0, m.radians(90))
            p = os.path.join(WORK, f'_sheet_{name}_{i}.png')
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            tiles.append(p)
        rows.append((name, tiles))
    img = Image.new('RGB', (220 * per, 320 * len(rows)), (30, 30, 30))
    d = ImageDraw.Draw(img)
    for r, (name, tiles) in enumerate(rows):
        for i, p in enumerate(tiles):
            img.paste(Image.open(p), (i * 220, r * 320))
        d.text((6, r * 320 + 6), name, fill=(255, 255, 0))
    path = os.path.join(WORK, 'sheet_' + '_'.join(names)[:60] + '.png')
    img.save(path)
    print('sheet', path)


main()
