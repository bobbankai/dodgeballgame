"""Tidebreakers animation library on the shared humanoid rig.

    blender -b -P anims.py -- [--export] [--sheets CLIP,CLIP|all] [--doc]

  --export   writes public/assets/anims/humanoid.glb (armature + every clip)
  --sheets   renders deformation-test contact sheets on Kai to docs/art/anims/<clip>_<n>.png
  --doc      regenerates docs/ANIMATION.md (the animation plan) from the clip table
"""
import os
import sys
import math
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from tb import skeleton, anim as A, bl  # noqa: E402
from tb.anim import Pose, Clip, Builder, blend  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SK = skeleton.Skeleton(height=1.70, head=0.245, shoulder=0.188)
B = Builder(SK)
ANK = {s: Vector(SK.j[f'ankle.{s}']) for s in 'LR'}
HIPW = SK.s['hip']


def P():
    return Pose()


def V(*a):
    return Vector(a)


def feet(p, l=(0, 0, 0), r=(0, 0, 0), lp=0.0, rp=0.0):
    """Plant both feet relative to their rest ankles (x out, y back, z up in metres)."""
    B.foot_ik(p, 'L', ANK['L'] + V(l[0], l[1], l[2]), lp)
    B.foot_ik(p, 'R', ANK['R'] + V(-r[0], r[1], r[2]), rp)
    return p


# ============================================================================================ helpers

def hand(p, side, x, y, z, pole=None, space='chest'):
    """Wrist target: x toward the character's left, y forward (positive = in front), z height (metres)."""
    B.hand(p, side, V(x, -y, z), pole, space)
    return p


def fists(p, curl=90, thumb=45):
    B.fist(p, 'L', curl, thumb)
    B.fist(p, 'R', curl, thumb)
    return p


def open_hands(p, curl=12, thumb=10, spread=1.0):
    B.fist(p, 'L', curl, thumb, spread)
    B.fist(p, 'R', curl, thumb, spread)
    return p


def kf(*items):
    """[(t, pose, ease), ...] shorthand."""
    return list(items)


# ============================================================================================ stances

def relaxed(breath=0.0):
    p = P()
    B.spine(p, bend=2 + breath * 1.5)
    B.hips(p, drop=0.01 + breath * 0.004)
    B.head(p, pitch=-2 - breath)
    for s in 'LR':
        B.arm(p, s, raise_=-12, fwd=4, elbow=10 + breath * 3, wrist=8)
    fists(p, 25, 15)
    feet(p, (0.02, 0, 0), (0.02, 0, 0))
    return p


def guard(breath=0.0, bounce=0.0):
    """Kai's fighting stance: left foot forward, knees soft, fists up at the chin."""
    p = P()
    B.hips(p, twist=-20, drop=0.07 + bounce * 0.025)
    B.spine(p, bend=8 + breath * 2, twist=-6)
    B.head(p, pitch=6, yaw=24)
    B.arm(p, 'L', shrug=4)
    B.arm(p, 'R', shrug=6)
    hand(p, 'L', 0.11, 0.30, 1.36 - bounce * 0.01)
    hand(p, 'R', -0.05, 0.21, 1.40 - bounce * 0.01)
    fists(p, 92, 50)
    feet(p, (0.04, -0.17, 0), (0.06, 0.16, 0))
    return p


# ============================================================================================ locomotion

def gait(speed, period, duty, lift=0.11, bob=0.025, arm_swing=28, lean=6, run=False):
    """A locomotion cycle: feet follow stance/swing paths in root space; stance feet slide back at exactly
    `speed` (no foot sliding once the character moves at that speed). Hips bob and twist, arms
    counter-swing, the chest counter-rotates."""
    stride = speed * period

    def foot_at(phase):
        if phase < duty:
            u = phase / duty
            y = (u - 0.5) * stride * duty
            z = 0.0
            pitch = -12 * (1 - u) ** 6 + 28 * u ** 4
        else:
            u = (phase - duty) / (1 - duty)
            e = A.ease(u, 'smooth')
            y = (0.5 - e) * stride * duty
            z = lift * math.sin(math.pi * u) ** (0.8 if run else 1.2)
            pitch = 30 * (1 - u) ** 2 - 15 * u ** 3
        return y, z, pitch

    def feetfn(t):
        out = {}
        for side, off in (('L', 0.0), ('R', 0.5)):
            ph = (t / period + off) % 1.0
            y, z, pitch = foot_at(ph)
            sx = 1 if side == 'L' else -1
            out[f'foot.{side}'] = (ANK[side] + V(sx * 0.01, y, z), pitch)
        return out

    keys = []
    for i in range(8):
        t = period * i / 8
        ph = (t / period) % 1.0
        p = P()
        swing = math.sin(2 * math.pi * ph)
        dip = math.cos(4 * math.pi * ph)
        B.hips(p, twist=-swing * (8 if run else 6), side=swing * 2.5, drop=0.03 + bob * (0.5 + 0.5 * dip) + (0.05 if run else 0))
        B.spine(p, bend=lean + (2 * abs(swing) if run else 0), twist=swing * (14 if run else 9))
        B.head(p, pitch=-lean * 0.6, yaw=-swing * 4)
        if run:
            hand(p, 'L', 0.17, 0.12 + 0.2 * swing, 1.05 + 0.12 * max(swing, 0), pole=(0.4, 1, -0.6))
            hand(p, 'R', -0.17, 0.12 - 0.2 * swing, 1.05 + 0.12 * max(-swing, 0), pole=(-0.4, 1, -0.6))
            fists(p, 75, 35)
        else:
            B.arm(p, 'L', raise_=-14, fwd=-swing * arm_swing, elbow=16 + max(swing, 0) * 22, wrist=6)
            B.arm(p, 'R', raise_=-14, fwd=swing * arm_swing, elbow=16 + max(-swing, 0) * 22, wrist=6)
            fists(p, 30, 25)
        keys.append((t, p, 'smooth'))
    return keys, feetfn


# ============================================================================================ combat

def jab():
    g = guard()
    ant = guard()
    B.hips(ant, twist=-6)
    hand(ant, 'L', 0.12, 0.22, 1.34)
    hit = guard()
    B.hips(hit, twist=12, fwd=0.03)
    B.spine(hit, twist=10, bend=4)
    hand(hit, 'L', 0.08, 0.8, 1.42, pole=(0.3, 0.3, -1))
    return kf((0.0, g, 'smooth'), (0.06, ant, 'out'), (0.12, hit, 'snap'), (0.2, hit, 'hold'), (0.42, g, 'smooth'))


def cross():
    g = guard()
    ant = guard()
    B.hips(ant, twist=-12, drop=0.01)
    hand(ant, 'R', -0.07, 0.15, 1.38)
    hit = guard()
    B.hips(hit, twist=36, fwd=0.06, drop=0.02)
    B.spine(hit, twist=22, bend=10, side=-4)
    B.head(hit, yaw=-20)
    hand(hit, 'R', -0.02, 0.82, 1.40, pole=(-0.3, 0.3, -1))
    hand(hit, 'L', 0.14, 0.18, 1.38)
    feet(hit, (0.04, -0.2, 0), (0.06, 0.12, 0.0), 0, 24)
    return kf((0.0, g, 'smooth'), (0.07, ant, 'out'), (0.14, hit, 'snap'), (0.23, hit, 'hold'), (0.5, g, 'smooth'))


def backfist():
    g = guard()
    wind = guard()
    B.hips(wind, twist=-50, drop=0.04)
    B.spine(wind, twist=-28, bend=6)
    hand(wind, 'L', -0.12, 0.22, 1.32)
    turn = guard()
    B.hips(turn, twist=55, drop=0.06)
    B.spine(turn, twist=40, bend=4)
    B.head(turn, yaw=-35)
    hand(turn, 'L', 0.5, 0.35, 1.42, pole=(0.2, 0.6, -1))
    hand(turn, 'R', -0.04, 0.24, 1.35)
    feet(turn, (0.06, -0.12, 0), (0.0, 0.18, 0), 10, 10)
    hit = turn.copy()
    B.hips(hit, twist=22)
    hand(hit, 'L', 0.78, -0.1, 1.42, pole=(0, 0.5, -1))
    return kf((0.0, g, 'smooth'), (0.12, wind, 'out'), (0.22, turn, 'smooth'), (0.29, hit, 'snap'), (0.38, hit, 'hold'), (0.7, g, 'smooth'))


def windkick():
    g = guard()
    cham = guard()
    B.hips(cham, twist=-30, side=-5, drop=0.02)
    B.spine(cham, bend=-2, side=-5, twist=-10)
    hand(cham, 'R', -0.3, 0.05, 1.2)
    B.foot_ik(cham, 'R', ANK['R'] + V(-0.05, -0.3, 0.55), 40)
    B.foot_ik(cham, 'L', ANK['L'] + V(0.04, -0.05, 0), 0)
    kick = cham.copy()
    B.hips(kick, twist=55, side=-9)
    B.spine(kick, side=-6, twist=22, bend=-4)
    B.foot_ik(kick, 'R', ANK['R'] + V(0.2, -0.75, 0.9), 70)
    hand(kick, 'R', -0.55, -0.15, 1.2, pole=(-0.3, 0, -1))
    hand(kick, 'L', 0.2, 0.25, 1.32)
    B.head(kick, yaw=-25, pitch=-6)
    return kf((0.0, g, 'smooth'), (0.15, cham, 'out'), (0.25, kick, 'snap'), (0.35, kick, 'hold'), (0.52, cham, 'smooth'), (0.85, g, 'smooth'))


def gale_hammer():
    """Heavy: crouching wind-up, then a rising uppercut that launches."""
    g = guard()
    load = guard()
    B.hips(load, drop=0.2, twist=-30)
    B.spine(load, bend=24, twist=-20)
    hand(load, 'R', -0.22, -0.12, 0.98, pole=(-0.6, 0, -1))
    hand(load, 'L', 0.2, 0.3, 1.2)
    up = guard()
    B.hips(up, drop=-0.04, twist=30, fwd=0.04)
    B.spine(up, bend=-14, twist=25, side=8)
    B.head(up, pitch=-25, yaw=-10)
    hand(up, 'R', -0.02, 0.38, 1.98, pole=(-0.5, 0.2, -1))
    hand(up, 'L', 0.25, 0.1, 1.15)
    feet(up, (0.04, -0.17, 0), (0.06, 0.1, 0.06), 0, 35)
    return kf((0.0, g, 'smooth'), (0.22, load, 'out'), (0.32, up, 'snap'), (0.44, up, 'hold'), (0.8, g, 'smooth'))


def charge_loop(t):
    p = guard()
    B.hips(p, drop=0.2 + 0.01 * math.sin(t * 40), twist=-30)
    B.spine(p, bend=24, twist=-20 + math.sin(t * 33) * 1.5)
    hand(p, 'R', -0.22, -0.12, 0.98 + 0.008 * math.sin(t * 50), pole=(-0.6, 0, -1))
    hand(p, 'L', 0.2, 0.3, 1.2)
    return p


def gale_burst():
    """Special: draw both palms to the chest, then thrust them out (wind blast around Kai)."""
    g = guard()
    draw = guard()
    B.hips(draw, twist=0, drop=0.1)
    B.spine(draw, bend=-6)
    B.head(draw, pitch=-4, yaw=0)
    hand(draw, 'L', 0.14, 0.12, 1.24)
    hand(draw, 'R', -0.14, 0.12, 1.24)
    open_hands(draw, 30, 20)
    push = guard()
    B.hips(push, twist=0, drop=0.16, fwd=0.05)
    B.spine(push, bend=14)
    B.head(push, pitch=4, yaw=0)
    hand(push, 'L', 0.16, 0.72, 1.28, pole=(0.6, 0, -1))
    hand(push, 'R', -0.16, 0.72, 1.28, pole=(-0.6, 0, -1))
    open_hands(push, 4, 5, 2.0)
    feet(push, (0.1, -0.22, 0), (0.1, 0.2, 0))
    return kf((0.0, g, 'smooth'), (0.25, draw, 'out'), (0.35, push, 'snap'), (0.55, push, 'hold'), (0.9, g, 'smooth'))


def tempest_dash():
    """Special: a low lunge with the right fist driving forward (the dash itself is root motion)."""
    g = guard()
    crouch = guard()
    B.hips(crouch, drop=0.14, twist=-25)
    B.spine(crouch, bend=26)
    hand(crouch, 'R', -0.2, -0.05, 1.12)
    lunge = guard()
    B.hips(lunge, drop=0.22, twist=25, fwd=0.12)
    B.spine(lunge, bend=30, twist=15)
    B.head(lunge, pitch=-18, yaw=-10)
    hand(lunge, 'R', -0.04, 1.0, 1.1, pole=(-0.4, 0.4, -1), space='root')
    hand(lunge, 'L', 0.35, -0.25, 1.15)
    feet(lunge, (0.08, -0.45, 0), (0.08, 0.45, 0.02), 0, 40)
    return kf((0.0, g, 'smooth'), (0.12, crouch, 'out'), (0.2, lunge, 'snap'), (0.5, lunge, 'hold'), (0.8, g, 'smooth'))


def hurricane():
    """Super 'Stormheart: Hurricane Rising' — gather, coil, spinning rise and a skyward uppercut."""
    g = guard()
    gather = relaxed()
    B.hips(gather, drop=0.12)
    B.spine(gather, bend=12)
    B.head(gather, pitch=14)
    hand(gather, 'L', 0.1, 0.25, 1.05)
    hand(gather, 'R', -0.1, 0.25, 1.05)
    fists(gather, 95, 50)
    coil = gather.copy()
    B.hips(coil, twist=-70, drop=0.08)
    B.spine(coil, twist=-40, bend=-4)
    B.head(coil, pitch=-10, yaw=40)
    hand(coil, 'R', -0.4, -0.2, 1.0)
    hand(coil, 'L', 0.45, 0.3, 1.35)
    spin = coil.copy()
    B.hips(spin, twist=140, drop=-0.06)
    B.spine(spin, twist=60, bend=-12)
    hand(spin, 'L', 0.7, 0.0, 1.5, pole=(0, 0.5, -1))
    hand(spin, 'R', -0.7, 0.0, 1.5, pole=(0, 0.5, -1))
    feet(spin, (0.0, 0, 0.1), (0.0, 0, 0.1), 40, 40)
    top = spin.copy()
    B.hips(top, twist=-110)
    B.spine(top, bend=-18, twist=-40)
    B.head(top, pitch=-35, yaw=0)
    hand(top, 'R', -0.02, 0.2, 2.1, pole=(-0.6, 0.2, -1))
    hand(top, 'L', 0.35, 0.05, 1.1)
    feet(top, (0.0, 0, 0.18), (0.02, 0.05, 0.25), 50, 50)
    return kf((0.0, g, 'smooth'), (0.35, gather, 'smooth'), (0.7, coil, 'out'), (0.95, spin, 'smooth'), (1.15, top, 'snap'),
              (1.5, top, 'hold'), (1.9, g, 'smooth'))


def block_pose():
    p = guard()
    B.hips(p, drop=0.1)
    B.spine(p, bend=14)
    B.head(p, pitch=14, yaw=10)
    hand(p, 'L', 0.06, 0.26, 1.5, pole=(0.7, 0.2, -1))
    hand(p, 'R', -0.04, 0.24, 1.47, pole=(-0.7, 0.2, -1))
    return p


def parry():
    b = block_pose()
    sweep = block_pose()
    B.hips(sweep, twist=-12)
    hand(sweep, 'L', 0.42, 0.36, 1.48, pole=(0.6, 0, -1))
    return kf((0.0, guard(), 'smooth'), (0.05, b, 'snap'), (0.12, sweep, 'snap'), (0.2, sweep, 'hold'), (0.42, guard(), 'smooth'))


def hit_front():
    g = guard()
    h = guard()
    B.hips(h, drop=0.04, fwd=-0.05)
    B.spine(h, bend=-16, side=6, twist=8)
    B.head(h, pitch=-22, yaw=14, roll=-8)
    hand(h, 'L', 0.3, 0.15, 1.2)
    hand(h, 'R', -0.3, 0.2, 1.3)
    open_hands(h, 40, 20)
    return kf((0.0, g, 'smooth'), (0.06, h, 'snap'), (0.14, h, 'hold'), (0.45, g, 'smooth'))


def hit_back():
    g = guard()
    h = guard()
    B.hips(h, drop=0.06, fwd=0.06)
    B.spine(h, bend=24, side=-4)
    B.head(h, pitch=18)
    hand(h, 'L', 0.35, 0.0, 1.1)
    hand(h, 'R', -0.35, 0.05, 1.15)
    return kf((0.0, g, 'smooth'), (0.06, h, 'snap'), (0.14, h, 'hold'), (0.45, g, 'smooth'))


def lying(face_up=True):
    """On the ground (legs FK, no foot IK)."""
    p = P()
    B.hips(p, bend=-85 if face_up else 85, drop=0.84, fwd=-0.55 if face_up else 0.55)
    B.spine(p, bend=-4 if face_up else 4)
    B.head(p, pitch=-10 if face_up else 10, yaw=20)
    for s in 'LR':
        B.arm(p, s, raise_=30, fwd=-10, elbow=20)
        B.leg(p, s, fwd=-8 if face_up else 8, out=10, knee=12)
    open_hands(p, 35, 20)
    return p


def knockdown():
    g = guard()
    fly = guard()
    B.hips(fly, bend=-30, drop=0.1, fwd=-0.25)
    B.spine(fly, bend=-20)
    B.head(fly, pitch=-25)
    fly.ik = {}
    for s in 'LR':
        B.arm(fly, s, raise_=40, fwd=30, elbow=30)
        B.leg(fly, s, fwd=30, knee=40)
    down = lying(True)
    bounce = lying(True)
    B.hips(bounce, drop=-0.06)
    return kf((0.0, g, 'smooth'), (0.18, fly, 'out'), (0.4, down, 'in'), (0.5, bounce, 'out'), (0.62, down, 'in'), (1.2, down, 'hold'))


def getup():
    down = lying(True)
    sit = P()
    B.hips(sit, bend=-20, drop=0.62, fwd=-0.2)
    B.spine(sit, bend=30)
    B.head(sit, pitch=10)
    hand(sit, 'L', 0.3, -0.2, 0.25, space='root')
    hand(sit, 'R', -0.3, -0.2, 0.25, space='root')
    for s in 'LR':
        B.leg(sit, s, fwd=60, knee=100)
    kneel = guard()
    B.hips(kneel, drop=0.38, bend=10)
    B.spine(kneel, bend=24)
    feet(kneel, (0.04, -0.25, 0), (0.06, 0.32, 0.06), 0, 60)
    return kf((0.0, down, 'smooth'), (0.35, sit, 'out'), (0.75, kneel, 'smooth'), (1.15, guard(), 'out'))


def death():
    g = relaxed()
    sag = relaxed()
    B.hips(sag, drop=0.12)
    B.spine(sag, bend=20)
    B.head(sag, pitch=30)
    kneel = P()
    B.hips(kneel, drop=0.45, bend=8)
    B.spine(kneel, bend=30)
    B.head(kneel, pitch=35)
    feet(kneel, (0.05, 0.05, 0), (0.05, 0.3, 0.05), 0, 60)
    for s in 'LR':
        B.arm(kneel, s, raise_=-30, fwd=-5, elbow=15)
    down = lying(False)
    return kf((0.0, g, 'smooth'), (0.25, sag, 'out'), (0.7, kneel, 'in'), (1.3, down, 'in'), (2.0, down, 'hold'))


def victory():
    g = guard()
    pump = relaxed()
    B.spine(pump, bend=-8)
    B.head(pump, pitch=-15)
    hand(pump, 'R', -0.15, 0.1, 2.0, pole=(-0.8, 0, -0.6))
    hand(pump, 'L', 0.22, 0.12, 1.05)
    fists(pump)
    pump2 = pump.copy()
    hand(pump2, 'R', -0.16, 0.08, 1.92, pole=(-0.8, 0, -0.6))
    return kf((0.0, g, 'smooth'), (0.3, pump, 'overshoot'), (0.6, pump2, 'smooth'), (0.9, pump, 'smooth'), (1.6, pump2, 'smooth'))


# ============================================================================================ acting

def talk_pose(k):
    p = relaxed()
    B.spine(p, bend=3, twist=4 * math.sin(k))
    B.head(p, pitch=-3 + 3 * math.sin(k * 1.7), yaw=6 * math.sin(k * 0.8), roll=3 * math.sin(k * 1.3))
    hand(p, 'R', -0.18 - 0.05 * math.sin(k), 0.3 + 0.06 * math.cos(k), 1.08 + 0.08 * math.sin(k * 1.3), pole=(-0.6, 0.4, -1))
    hand(p, 'L', 0.2, 0.12 + 0.05 * math.sin(k + 1), 0.98, pole=(0.6, 0.4, -1))
    open_hands(p, 25, 15, 0.6)
    return p


def kneel_base(head_down=25):
    p = P()
    B.hips(p, drop=0.45, bend=4)
    B.spine(p, bend=22)
    B.head(p, pitch=head_down)
    feet(p, (0.06, -0.32, 0), (0.06, 0.3, 0.06), 0, 62)
    return p


def acting_clips():
    out = []
    out.append(Clip('talk', 3.0, [(i * 0.75, talk_pose(i * 1.9), 'smooth') for i in range(4)], loop=True,
                    purpose='Dialogue gestures', contacts='feet planted', notes='right hand leads the beats, head nods on stresses'))
    nod = relaxed()
    B.head(nod, pitch=14)
    out.append(Clip('nod', 0.8, kf((0.0, relaxed(), 'smooth'), (0.25, nod, 'out'), (0.5, relaxed(), 'smooth'), (0.65, nod, 'smooth'), (0.8, relaxed(), 'smooth')),
                    purpose='Agreement nod', contacts='feet planted', notes='double nod, second smaller'))
    point = relaxed()
    B.spine(point, twist=-8)
    B.head(point, yaw=-12, pitch=-4)
    hand(point, 'R', -0.25, 0.62, 1.42, pole=(-0.4, 0.3, -1))
    B.fist(point, 'R', 70, 20)
    out.append(Clip('point', 1.2, kf((0.0, relaxed(), 'smooth'), (0.3, point, 'overshoot'), (1.2, point, 'hold')),
                    purpose='Point ahead (story beats)', contacts='feet planted', notes='overshoots into the point'))
    grief = kneel_base(40)
    hand(grief, 'L', 0.12, 0.35, 0.55)
    hand(grief, 'R', -0.12, 0.34, 0.6)
    open_hands(grief, 30, 15)
    grief2 = grief.copy()
    B.spine(grief2, bend=6)
    B.head(grief2, pitch=6)
    out.append(Clip('kneel_grief', 2.4, kf((0.0, grief, 'smooth'), (1.2, grief2, 'smooth')), loop=True,
                    purpose='Kneeling grief (shoulders heave)', contacts='R knee and L foot on the ground', notes='slow sob rhythm 0.4 Hz'))
    hold = kneel_base(30)
    hand(hold, 'L', 0.22, 0.4, 0.72, pole=(0.8, 0.2, -1))
    hand(hold, 'R', -0.2, 0.42, 0.64, pole=(-0.8, 0.2, -1))
    open_hands(hold, 35, 25)
    hold2 = hold.copy()
    B.head(hold2, pitch=10)
    out.append(Clip('kneel_hold', 3.0, kf((0.0, hold, 'smooth'), (1.5, hold2, 'smooth')), loop=True,
                    purpose='Kneeling, cradling someone (Ines, Teo)', contacts='R knee and L foot on the ground', notes='arms make a cradle at lap height'))
    cry = relaxed()
    B.spine(cry, bend=18)
    B.head(cry, pitch=28)
    hand(cry, 'L', 0.05, 0.16, 1.5, pole=(0.8, 0.3, -1))
    hand(cry, 'R', -0.05, 0.16, 1.5, pole=(-0.8, 0.3, -1))
    open_hands(cry, 25, 10)
    cry2 = cry.copy()
    B.spine(cry2, bend=6)
    out.append(Clip('cry', 1.6, kf((0.0, cry, 'smooth'), (0.8, cry2, 'smooth')), loop=True,
                    purpose='Face in hands, sobbing', contacts='feet planted', notes='shoulders shake'))
    laugh = relaxed()
    B.spine(laugh, bend=-12)
    B.head(laugh, pitch=-20)
    hand(laugh, 'L', 0.12, 0.2, 1.0)
    hand(laugh, 'R', -0.12, 0.2, 1.0)
    laugh2 = laugh.copy()
    B.spine(laugh2, bend=6)
    out.append(Clip('laugh', 0.6, kf((0.0, laugh, 'smooth'), (0.3, laugh2, 'smooth')), loop=True,
                    purpose='Belly laugh', contacts='feet planted', notes='quick bounce'))
    wave = relaxed()
    hand(wave, 'R', -0.4, 0.1, 1.85, pole=(-1, 0.2, -0.3))
    open_hands(wave, 5, 5, 1.0)
    wave2 = wave.copy()
    hand(wave2, 'R', -0.25, 0.12, 1.88, pole=(-1, 0.2, -0.3))
    out.append(Clip('wave', 0.8, kf((0.0, wave, 'smooth'), (0.4, wave2, 'smooth')), loop=True,
                    purpose='Wave goodbye / hello', contacts='feet planted', notes='forearm swings'))
    look = [relaxed() for _ in range(3)]
    B.head(look[0], yaw=50)
    B.head(look[1], yaw=0, pitch=-6)
    B.head(look[2], yaw=-50)
    B.spine(look[0], twist=12)
    B.spine(look[2], twist=-12)
    out.append(Clip('look_around', 3.6, kf((0.0, look[0], 'smooth'), (1.2, look[1], 'smooth'), (2.4, look[2], 'smooth')), loop=True,
                    purpose='Searching / wary idle', contacts='feet planted', notes='holds on each side'))
    xa = relaxed()
    B.spine(xa, bend=-3)
    B.head(xa, pitch=-6)
    hand(xa, 'L', -0.1, 0.18, 1.2)
    hand(xa, 'R', 0.1, 0.2, 1.18)
    out.append(Clip('cross_arms', 2.0, kf((0.0, xa, 'smooth'), (1.0, xa, 'smooth')), loop=True,
                    purpose='Arms crossed (Mira, Halvard)', contacts='feet planted', notes='weight on one hip'))
    sal = relaxed()
    hand(sal, 'R', -0.12, 0.12, 1.6, pole=(-1, 0.2, -0.2))
    open_hands(sal, 0, 0)
    out.append(Clip('salute', 1.0, kf((0.0, relaxed(), 'smooth'), (0.25, sal, 'snap'), (1.0, sal, 'hold')),
                    purpose='Armada salute', contacts='feet planted', notes='snaps up'))
    sitp = P()
    B.hips(sitp, drop=0.45, bend=-8)
    B.spine(sitp, bend=12)
    B.head(sitp, pitch=8)
    for s in 'LR':
        B.leg(sitp, s, fwd=85, knee=88)
    hand(sitp, 'L', 0.22, 0.25, 0.5, space='root')
    hand(sitp, 'R', -0.22, 0.25, 0.5, space='root')
    out.append(Clip('sit', 2.0, kf((0.0, sitp, 'smooth'), (1.0, sitp, 'smooth')), loop=True,
                    purpose='Sitting on a crate / ledge', contacts='seat', notes='static with breath'))
    return out


# ============================================================================================ weapons

def weapon_clips():
    out = []
    def stance():
        p = P()
        B.hips(p, twist=-15, drop=0.06)
        B.spine(p, bend=8, twist=-5)
        B.head(p, yaw=18)
        hand(p, 'R', -0.2, 0.25, 1.05)
        hand(p, 'L', 0.22, 0.1, 1.05)
        fists(p, 88, 50)
        feet(p, (0.05, -0.18, 0), (0.07, 0.16, 0))
        return p
    st = stance()
    st2 = stance()
    B.hips(st2, drop=0.08)
    out.append(Clip('sword_idle', 1.2, kf((0.0, st, 'smooth'), (0.6, st2, 'smooth')), loop=True,
                    purpose='One-handed blade idle (marines)', contacts='feet planted', notes='blade held low and forward'))
    up = stance()
    B.hips(up, twist=-40)
    B.spine(up, twist=-25, bend=-4)
    hand(up, 'R', -0.35, -0.05, 1.75, pole=(-1, 0.4, -0.2))
    down = stance()
    B.hips(down, twist=30, fwd=0.06, drop=0.1)
    B.spine(down, twist=20, bend=24)
    hand(down, 'R', 0.25, 0.55, 0.85, pole=(-0.5, 0.3, -1))
    out.append(Clip('slash1', 0.75, kf((0.0, st, 'smooth'), (0.25, up, 'out'), (0.36, down, 'snap'), (0.48, down, 'hold'), (0.75, st, 'smooth')),
                    purpose='Diagonal slash', contacts='feet planted', notes='telegraph 0.25 s, hit 0.36 s'))
    wide = stance()
    B.hips(wide, twist=-55)
    B.spine(wide, twist=-30)
    hand(wide, 'R', -0.6, 0.0, 1.3)
    across = stance()
    B.hips(across, twist=45, fwd=0.04)
    B.spine(across, twist=30, bend=8)
    hand(across, 'R', 0.55, 0.45, 1.25)
    out.append(Clip('slash2', 0.8, kf((0.0, st, 'smooth'), (0.28, wide, 'out'), (0.4, across, 'snap'), (0.52, across, 'hold'), (0.8, st, 'smooth')),
                    purpose='Horizontal slash', contacts='feet planted', notes='wide arc, hit 0.4 s'))
    pull = stance()
    B.hips(pull, twist=-25, drop=0.1)
    hand(pull, 'R', -0.25, -0.15, 1.15)
    th = stance()
    B.hips(th, twist=20, fwd=0.12, drop=0.12)
    B.spine(th, bend=18, twist=10)
    hand(th, 'R', -0.05, 0.85, 1.2, pole=(-0.3, 0.3, -1))
    feet(th, (0.05, -0.4, 0), (0.07, 0.28, 0.02), 0, 30)
    out.append(Clip('thrust', 0.7, kf((0.0, st, 'smooth'), (0.25, pull, 'out'), (0.33, th, 'snap'), (0.45, th, 'hold'), (0.7, st, 'smooth')),
                    purpose='Lunging thrust', contacts='lead foot slides forward', notes='hit 0.33 s'))
    lift = stance()
    B.hips(lift, twist=-5, drop=0.0)
    B.spine(lift, bend=-14)
    B.head(lift, pitch=-12)
    hand(lift, 'R', -0.08, 0.05, 2.05, pole=(-1, 0.2, -0.3))
    hand(lift, 'L', 0.08, 0.05, 2.02, pole=(1, 0.2, -0.3))
    smash = stance()
    B.hips(smash, drop=0.2, fwd=0.08)
    B.spine(smash, bend=40)
    B.head(smash, pitch=10)
    hand(smash, 'R', -0.06, 0.7, 0.55, pole=(-1, 0.2, -0.3))
    hand(smash, 'L', 0.06, 0.7, 0.58, pole=(1, 0.2, -0.3))
    out.append(Clip('overhead', 1.3, kf((0.0, st, 'smooth'), (0.55, lift, 'out'), (0.7, smash, 'snap'), (0.95, smash, 'hold'), (1.3, st, 'smooth')),
                    purpose='Two-handed overhead smash (brutes, halberd, Gorrick)', contacts='feet planted wide', notes='long telegraph 0.55 s, hit 0.7 s'))
    sweep0 = stance()
    B.hips(sweep0, twist=-70, drop=0.12)
    B.spine(sweep0, twist=-35, bend=10)
    hand(sweep0, 'R', -0.6, -0.2, 1.0)
    hand(sweep0, 'L', -0.3, 0.0, 1.05)
    sweep1 = stance()
    B.hips(sweep1, twist=70, drop=0.14)
    B.spine(sweep1, twist=35, bend=12)
    hand(sweep1, 'R', 0.6, 0.35, 0.95)
    hand(sweep1, 'L', 0.3, 0.45, 1.0)
    out.append(Clip('sweep', 1.1, kf((0.0, st, 'smooth'), (0.45, sweep0, 'out'), (0.62, sweep1, 'snap'), (0.8, sweep1, 'hold'), (1.1, st, 'smooth')),
                    purpose='Wide polearm sweep (Halvard)', contacts='feet planted wide', notes='hit 0.62 s, 180 deg arc'))
    aim = stance()
    B.hips(aim, twist=-30, drop=0.04)
    B.spine(aim, twist=-12, bend=4)
    B.head(aim, yaw=30, pitch=4, roll=8)
    hand(aim, 'R', -0.08, 0.15, 1.38)
    hand(aim, 'L', 0.0, 0.55, 1.36, pole=(0.8, 0.2, -1))
    out.append(Clip('aim', 1.0, kf((0.0, aim, 'smooth'), (0.5, aim, 'smooth')), loop=True,
                    purpose='Rifle aim (riflemen)', contacts='feet planted', notes='steady, slight sway'))
    rec = aim.copy()
    B.spine(rec, bend=-8, twist=-16)
    B.head(rec, pitch=-8)
    hand(rec, 'R', -0.1, 0.05, 1.44)
    out.append(Clip('shoot', 0.5, kf((0.0, aim, 'smooth'), (0.04, rec, 'snap'), (0.5, aim, 'smooth')),
                    purpose='Rifle shot recoil', contacts='feet planted', notes='kick at 0.04 s'))
    sh = stance()
    hand(sh, 'L', 0.12, 0.35, 1.25, pole=(0.9, 0, -0.6))
    out.append(Clip('shield_idle', 1.2, kf((0.0, sh, 'smooth'), (0.6, sh, 'smooth')), loop=True,
                    purpose='Shield up (brutes)', contacts='feet planted', notes='shield arm forward'))
    bash = sh.copy()
    B.hips(bash, twist=-10, fwd=0.15, drop=0.1)
    B.spine(bash, bend=20)
    hand(bash, 'L', 0.06, 0.75, 1.25, pole=(0.9, 0, -0.6))
    feet(bash, (0.05, -0.42, 0), (0.07, 0.3, 0.02), 0, 30)
    out.append(Clip('shield_bash', 0.8, kf((0.0, sh, 'smooth'), (0.3, sh, 'smooth'), (0.42, bash, 'snap'), (0.55, bash, 'hold'), (0.8, sh, 'smooth')),
                    purpose='Shield bash (unblockable)', contacts='lunging step', notes='hit 0.42 s'))
    tau = stance()
    B.spine(tau, bend=-10)
    B.head(tau, pitch=-12)
    hand(tau, 'R', -0.35, 0.1, 1.75, pole=(-1, 0, -0.3))
    hand(tau, 'L', 0.35, 0.1, 1.7, pole=(1, 0, -0.3))
    out.append(Clip('taunt', 1.4, kf((0.0, st, 'smooth'), (0.35, tau, 'overshoot'), (1.0, tau, 'hold'), (1.4, st, 'smooth')),
                    purpose='Boss taunt / roar', contacts='feet planted', notes='arms spread wide'))
    thr = stance()
    B.hips(thr, twist=-40)
    hand(thr, 'R', -0.4, -0.3, 1.5)
    thr2 = stance()
    B.hips(thr2, twist=35, fwd=0.08)
    B.spine(thr2, bend=14, twist=20)
    hand(thr2, 'R', 0.1, 0.8, 1.35, pole=(-0.4, 0.3, -1))
    out.append(Clip('throw', 0.8, kf((0.0, st, 'smooth'), (0.3, thr, 'out'), (0.4, thr2, 'snap'), (0.55, thr2, 'hold'), (0.8, st, 'smooth')),
                    purpose='Throw (chains, bombs, grapples)', contacts='feet planted', notes='release at 0.4 s'))
    return out


# ============================================================================================ table

def clips():
    out = []
    breath = [(0.0, relaxed(0), 'smooth'), (1.6, relaxed(1), 'smooth')]
    out.append(Clip('idle', 3.2, breath, loop=True, purpose='Story idle: weight on both feet, slow breath',
                    contacts='both feet planted', notes='keys at 0 / 1.6 s; arms hang with soft fists'))
    out.append(Clip('guard', 0.9, [(0.0, guard(0, 0), 'smooth'), (0.45, guard(1, 1), 'smooth')], loop=True,
                    purpose='Combat idle: bouncing fighting stance', contacts='both feet planted (lead L)', notes='bounce 2.2 Hz, fists at chin height'))
    wk, wf = gait(1.7, 1.0, 0.62)
    out.append(Clip('walk', 1.0, wk, loop=True, speed=1.7, feet=wf, purpose='Walk 1.7 m/s', contacts='heel-strike at 0 and 0.5 s',
                    notes='hips dip on contact, arms counter-swing 28 deg, chest counter-rotates'))
    rk, rf = gait(5.6, 0.66, 0.38, lift=0.22, bob=0.04, arm_swing=40, lean=12, run=True)
    out.append(Clip('run', 0.66, rk, loop=True, speed=5.6, feet=rf, purpose='Run 5.6 m/s with flight phase', contacts='contacts at 0 and 0.33 s',
                    notes='forward lean 12 deg, high knees, pumping bent arms'))
    out.append(Clip('jab', 0.42, jab(), purpose='Light 1: lead jab', contacts='feet planted', notes='anticipation 0.06 s, hit 0.12 s, recover by 0.42 s'))
    out.append(Clip('cross', 0.5, cross(), purpose='Light 2: rear cross', contacts='rear heel lifts on the hit', notes='hips rotate 48 deg, hit 0.14 s'))
    out.append(Clip('backfist', 0.7, backfist(), purpose='Light 3: spinning backfist', contacts='pivot on lead foot', notes='wind-up 0.12 s, hit 0.29 s'))
    out.append(Clip('windkick', 0.85, windkick(), purpose='Light 4 / finisher: wind roundhouse', contacts='stands on L', notes='chamber 0.15 s, hit 0.25 s'))
    out.append(Clip('gale_hammer', 0.8, gale_hammer(), purpose='Heavy: rising launcher uppercut', contacts='rear heel lifts', notes='crouch 0.22 s, hit 0.32 s'))
    out.append(Clip('charge', 1.0, [(i * 0.125, charge_loop(i * 0.125), 'linear') for i in range(8)], loop=True,
                    purpose='Heavy charge hold (trembling)', contacts='feet planted', notes='fast tremble'))
    out.append(Clip('gale_burst', 0.9, gale_burst(), purpose='Special: wind blast', contacts='wide stance', notes='draw 0.25 s, release 0.35 s'))
    out.append(Clip('tempest_dash', 0.8, tempest_dash(), purpose='Special: dash punch', contacts='lunge (root motion at runtime)', notes='launch 0.2 s'))
    out.append(Clip('hurricane', 1.9, hurricane(), purpose='Super: Hurricane Rising', contacts='rises onto the toes', notes='coil 0.7 s, skyward hit 1.15 s'))
    out.append(Clip('block', 0.6, [(0.0, block_pose(), 'smooth'), (0.3, block_pose(), 'smooth')], loop=True,
                    purpose='Guard (forearms up)', contacts='feet planted', notes='held'))
    out.append(Clip('parry', 0.42, parry(), purpose='Parry deflect', contacts='feet planted', notes='sweep 0.12 s'))
    out.append(Clip('hit_front', 0.45, hit_front(), purpose='Hit reaction from the front', contacts='feet planted', notes='snap 0.06 s'))
    out.append(Clip('hit_back', 0.45, hit_back(), purpose='Hit reaction from behind', contacts='feet planted', notes='snap 0.06 s'))
    out.append(Clip('knockdown', 1.2, knockdown(), purpose='Knocked flat on the back', contacts='lands at 0.4 s, bounce 0.5 s', notes='lands at 0.4 s'))
    out.append(Clip('getup', 1.15, getup(), purpose='Get up from the back', contacts='hands push off, kneel, stand', notes='ends in guard'))
    out.append(Clip('death', 2.0, death(), purpose='Defeat: sag, kneel, fall', contacts='knee 0.7 s, ground 1.3 s', notes='slow'))
    out.append(Clip('victory', 1.6, victory(), loop=False, purpose='Fist pump', contacts='feet planted', notes='overshoot into the pump'))
    crouch = guard()
    B.hips(crouch, drop=0.16, twist=-10)
    B.spine(crouch, bend=18)
    hand(crouch, 'L', 0.3, -0.15, 1.0)
    hand(crouch, 'R', -0.3, -0.15, 1.0)
    upj = relaxed()
    B.spine(upj, bend=-6)
    hand(upj, 'L', 0.35, 0.3, 1.75)
    hand(upj, 'R', -0.3, 0.2, 1.6)
    feet(upj, (0.02, 0.05, 0.05), (0.02, 0.05, 0.02), 30, 30)
    out.append(Clip('jump', 0.3, [(0.0, guard(), 'smooth'), (0.12, crouch, 'out'), (0.3, upj, 'snap')], purpose='Jump take-off',
                    contacts='feet leave the ground at 0.3 s', notes='deep crouch then explosive extension'))
    air = relaxed()
    B.spine(air, bend=6)
    air.ik = {}
    B.arm(air, 'L', raise_=45, fwd=20, elbow=50)
    B.arm(air, 'R', raise_=40, fwd=10, elbow=70)
    B.leg(air, 'L', fwd=40, knee=70)
    B.leg(air, 'R', fwd=10, knee=40)
    air2 = air.copy()
    B.leg(air2, 'L', fwd=-10, knee=-15)
    out.append(Clip('air', 0.8, [(0.0, air, 'smooth'), (0.4, air2, 'smooth')], loop=True, purpose='Airborne loop', contacts='none',
                    notes='tucked legs, arms out for balance'))
    axe = air.copy()
    B.spine(axe, bend=-10)
    B.leg(axe, 'R', fwd=120, knee=-30)
    slam = air.copy()
    B.spine(slam, bend=30)
    B.leg(slam, 'R', fwd=-60, knee=-40)
    out.append(Clip('air_attack', 0.6, [(0.0, air, 'smooth'), (0.18, axe, 'out'), (0.3, slam, 'snap'), (0.6, slam, 'hold')],
                    purpose='Aerial axe kick (spikes downward)', contacts='none', notes='leg rises 0.18 s, slams 0.3 s'))
    land = guard()
    B.hips(land, drop=0.2)
    B.spine(land, bend=22)
    out.append(Clip('land', 0.4, [(0.0, land, 'smooth'), (0.08, land, 'hold'), (0.4, guard(), 'smooth')], purpose='Landing absorb',
                    contacts='both feet', notes='0.08 s compression hold sells the weight'))
    dodge0 = guard()
    B.hips(dodge0, drop=0.25, twist=0)
    B.spine(dodge0, bend=40)
    B.head(dodge0, pitch=30)
    hand(dodge0, 'L', 0.2, 0.3, 0.9)
    hand(dodge0, 'R', -0.2, 0.3, 0.9)
    feet(dodge0, (0.1, -0.35, 0), (0.06, 0.25, 0.04), 0, 50)
    out.append(Clip('dodge', 0.45, [(0.0, guard(), 'smooth'), (0.08, dodge0, 'snap'), (0.3, dodge0, 'hold'), (0.45, guard(), 'smooth')],
                    purpose='Dodge dash (i-frames; travel is root motion at runtime)', contacts='low lunge', notes='committed low silhouette'))
    out += acting_clips()
    out += weapon_clips()
    return out


CLIPS = None


def all_clips():
    global CLIPS
    if CLIPS is None:
        CLIPS = clips()
    return CLIPS


def write_doc():
    lines = ['# Tidebreakers — animation plan', '',
             'Generated from `tools/blender/anims.py`. Every humanoid shares this rig and library; clips are',
             'authored as key poses, interpolated (FK), solved for foot/hand contacts (IK), refined with',
             'overlapping action, then baked and exported to `public/assets/anims/humanoid.glb`. Secondary',
             'motion (hair, tails, coats) is simulated at runtime. Contact sheets: `docs/art/anims/`.', '',
             '| clip | length | loop | purpose | contacts | timing notes |', '|---|---|---|---|---|---|']
    for c in all_clips():
        lines.append(f'| `{c.name}` | {c.length:.2f} s ({int(round(c.length * A.FPS))} f) | {"yes" if c.loop else "no"} | {c.purpose} | {c.contacts} | {c.notes} |')
    with open(os.path.join(ROOT, 'docs', 'ANIMATION.md'), 'w') as f:
        f.write('\n'.join(lines) + '\n')


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--doc' in args:
        write_doc()
    want = None
    if '--sheets' in args:
        val = args[args.index('--sheets') + 1]
        want = None if val == 'all' else set(val.split(','))
    bl.reset()
    if '--sheets' in args:
        import chars
        from tb import pipeline
        spec = chars.CHARS['kai']()
        mesh_ob, arm = pipeline.build(spec, None, os.path.join(ROOT, 'docs', 'art', 'kai'), renders=False)
        bl.setup_preview(res=(400, 560))
        out = os.path.join(ROOT, 'docs', 'art', 'anims')
        os.makedirs(out, exist_ok=True)
        builder = Builder(spec.skel)
        for c in all_clips():
            if want and c.name not in want:
                continue
            act = A.bake_clip(arm, builder, c)
            n = int(round(c.length * A.FPS))
            frames = sorted(set(int(round(i * n / 6)) + 1 for i in range(6)))
            for k, f in enumerate(frames):
                bpy.context.scene.frame_set(f)
                bl.render_views(os.path.join(out, f'{c.name}_{k}'), target=(0, 0, 0.9), dist=3.4, views=[('v', 30, 6)], lens=55)
            print('[anim] sheet', c.name, frames)
    if '--export' in args:
        from tb.character import build_armature
        for ob in list(bpy.data.objects):
            bpy.data.objects.remove(ob)
        arm = build_armature(SK, 'Armature')
        for c in all_clips():
            act = A.bake_clip(arm, B, c)
            tr = arm.animation_data.nla_tracks.new()
            tr.name = c.name
            st = tr.strips.new(c.name, 1, act)
            tr.mute = True
            print('[anim] baked', c.name, int(round(c.length * A.FPS)), 'frames')
        arm.animation_data.action = None
        path = os.path.join(ROOT, 'public', 'assets', 'anims', 'humanoid.glb')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        arm.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
                                  export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_optimize_animation_size=False,
                                  export_def_bones=False, export_skins=True, export_yup=True, export_anim_slide_to_zero=True)
        print('[anim] wrote', path, os.path.getsize(path) // 1024, 'KB')


main()
