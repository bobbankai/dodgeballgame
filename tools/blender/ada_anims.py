"""
Ada's animation clips, keyed into actions on her rig (30 fps).

Each clip is a set of channels per bone, each channel a list of (frame, value) keys smoothed by a
clamped Hermite spline (periodic for loops). Angles are degrees about the armature's axes
(X: pitch, + bends an upward bone forwards / swings a downward one back; Y: roll; Z: yaw, + turns to
her left); offsets are metres. 'ax' gives a bone's absolute pitch, so the bones below it are posed
from where the parent actually points. With sym=k, every _L channel also drives the _R bone,
mirrored and k frames out of phase.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

BODY = ['hips', 'spine', 'chest', 'neck', 'head', 'scarf1', 'scarf2', 'bag'] + [
    f'{b}_{s}' for s in 'LR' for b in ('shoulder', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot')]
PARENT = {'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'scarf1': 'chest', 'scarf2': 'scarf1',
          'bag': 'hips'}
for _s in 'LR':
    PARENT.update({f'shoulder_{_s}': 'chest', f'upperarm_{_s}': f'shoulder_{_s}', f'forearm_{_s}': f'upperarm_{_s}',
                   f'hand_{_s}': f'forearm_{_s}', f'thigh_{_s}': 'hips', f'shin_{_s}': f'thigh_{_s}', f'foot_{_s}': f'shin_{_s}'})


# Offsets (tx/ty/tz) are written for Ada; a taller rig sharing her bone layout (Mum) scales them.
T_SCALE = 1.0


def clip(poser, name, N, ch, loop=True, sym=None, bones=None):
    if T_SCALE != 1.0:
        def scaled(v):
            return [(t, x * T_SCALE) for t, x in v] if isinstance(v, list) else v * T_SCALE
        ch = {b: {k: scaled(v) if k in ('tx', 'ty', 'tz') else v for k, v in c.items()} for b, c in ch.items()}
    lib.clip(poser, name, N, ch, BODY, PARENT, loop=loop, sym=sym, bones=bones)


# --- shared poses ----------------------------------------------------------------------------

def arms_down(rx=3, ry=13, fore=-14):
    return {'upperarm_L': {'rx': rx, 'ry': ry}, 'forearm_L': {'rx': fore, 'ry': 3}, 'hand_L': {'rx': -4}}


def merge(*chs):
    out = {}
    for ch in chs:
        for b, c in ch.items():
            out.setdefault(b, {}).update(c)
    return out


def author(arm):
    p = lib.Poser(arm)

    # idle: slow breathing, a little weight shift, glances around
    clip(p, 'idle', 72, merge(arms_down(), {
        'hips': {'tz': [(0, -0.004), (36, -0.008)], 'tx': [(0, 0.005), (36, -0.002)], 'ry': [(0, -1.5), (36, 1.0)]},
        'spine': {'rx': [(0, 2.0), (36, 3.0)]},
        'chest': {'rx': [(0, 0.5), (36, -2.5)]},
        'shoulder_L': {'ry': [(0, 0.0), (36, -2.5)]},
        'neck': {'rx': [(0, -1.0), (36, 0.0)]},
        'head': {'rx': [(0, -2.0), (40, -0.5)], 'rz': [(0, 4.0), (30, -3.0), (52, -2.0)], 'ry': [(0, -2.0), (36, 2.5)]},
        'upperarm_L': {'rx': [(0, 3.0), (36, 1.5)], 'ry': [(0, 13.0), (36, 12.0)]},
        'thigh_L': {'ry': -2.0}, 'thigh_R': {'ry': 2.0, 'rx': -3.0}, 'shin_R': {'rx': 7.0},
        'foot_L': {'ax': 0.0}, 'foot_R': {'ax': 0.0},
        'scarf1': {'rx': [(0, 0.0), (36, -3.0)], 'rz': [(0, -2.0), (40, 2.0)]},
        'scarf2': {'rx': [(10, 0.0), (46, -4.0)]},
        'bag': {'ry': [(0, 0.0), (36, 1.5)]},
    }), sym=0)

    # walk: 28 frames, two steps of ~0.5 m
    clip(p, 'walk', 28, merge(arms_down(), {
        'hips': {'tz': [(0, -0.022), (7, 0.002), (14, -0.022), (21, 0.002)], 'tx': [(0, 0.0), (7, 0.01), (14, 0.0), (21, -0.01)],
                 'rz': [(0, -6.0), (14, 6.0)], 'ry': [(7, -3.0), (21, 3.0)], 'rx': 3.0},
        'spine': {'rx': 4.0, 'rz': [(0, 3.0), (14, -3.0)], 'ry': [(7, 1.5), (21, -1.5)]},
        'chest': {'rx': 1.0, 'rz': [(0, 4.0), (14, -4.0)]},
        'neck': {'rx': -2.0, 'rz': [(0, -1.0), (14, 1.0)]},
        'head': {'rx': -4.0, 'rz': [(0, -1.0), (14, 1.0)], 'ry': [(7, 1.0), (21, -1.0)]},
        'thigh_L': {'rx': [(0, -26.0), (7, -4.0), (14, 16.0), (17, 20.0), (21, -4.0), (25, -28.0)]},
        'shin_L': {'rx': [(0, 4.0), (3, 16.0), (7, 6.0), (12, 8.0), (16, 30.0), (19, 52.0), (22, 46.0), (25, 16.0)]},
        'foot_L': {'ax': [(0, -18.0), (4, 0.0), (12, 0.0), (14, 12.0), (17, 35.0), (19, 20.0), (22, 0.0), (25, -15.0)]},
        'upperarm_L': {'rx': [(0, 16.0), (14, -18.0)], 'ry': 12.0},
        'forearm_L': {'rx': [(0, -12.0), (14, -30.0)]},
        'scarf1': {'rx': [(2, -4.0), (9, 4.0), (16, -4.0), (23, 4.0)], 'rz': [(0, -4.0), (14, 4.0)]},
        'scarf2': {'rx': [(5, -6.0), (12, 6.0), (19, -6.0), (26, 6.0)]},
        'bag': {'rx': [(3, -4.0), (10, 4.0), (17, -4.0), (24, 4.0)], 'ry': [(7, -3.0), (21, 3.0)]},
    }), sym=14)

    # run: 18 frames, two strides with a little flight
    clip(p, 'run', 18, {
        'hips': {'tz': [(0, -0.02), (2, -0.04), (5, -0.008), (7, 0.015), (9, -0.02), (11, -0.04), (14, -0.008), (16, 0.015)],
                 'rx': 8.0, 'rz': [(0, -10.0), (9, 10.0)], 'ry': [(4, -4.0), (13, 4.0)], 'tx': [(4, 0.008), (13, -0.008)]},
        'spine': {'rx': 10.0, 'rz': [(0, 6.0), (9, -6.0)]},
        'chest': {'rx': 6.0, 'rz': [(0, 6.0), (9, -6.0)]},
        'neck': {'rx': -6.0},
        'head': {'rx': -12.0, 'rz': [(0, -3.0), (9, 3.0)]},
        'thigh_L': {'rx': [(0, -28.0), (2, -18.0), (5, 5.0), (7, 28.0), (9, 30.0), (11, 15.0), (13, -15.0), (15, -45.0), (17, -38.0)]},
        'shin_L': {'rx': [(0, 16.0), (2, 40.0), (5, 26.0), (7, 18.0), (9, 60.0), (11, 100.0), (13, 105.0), (15, 60.0), (17, 25.0)]},
        'foot_L': {'ax': [(0, -5.0), (2, 0.0), (5, 10.0), (7, 40.0), (9, 45.0), (11, 30.0), (13, 10.0), (15, -10.0), (17, -12.0)]},
        'upperarm_L': {'rx': [(0, 38.0), (9, -42.0)], 'ry': 10.0},
        'forearm_L': {'rx': [(0, -55.0), (9, -85.0)], 'ry': 4.0},
        'hand_L': {'rx': -10.0},
        'scarf1': {'rx': [(0, 28.0), (4, 38.0), (9, 28.0), (13, 38.0)], 'rz': [(0, -5.0), (9, 5.0)]},
        'scarf2': {'rx': [(2, 10.0), (6, 22.0), (11, 10.0), (15, 22.0)]},
        'bag': {'rx': [(2, -10.0), (7, 10.0), (11, -10.0), (16, 10.0)], 'ry': 6.0},
    }, sym=9)

    # jump: a quick crouch-and-push, then the rising pose (hands off to 'fall')
    clip(p, 'jump', 10, {
        'hips': {'tz': [(0, -0.08), (3, 0.03), (10, 0.0)], 'rx': [(0, 8.0), (3, 0.0), (10, 2.0)]},
        'spine': {'rx': [(0, 8.0), (3, -4.0), (10, 0.0)]},
        'chest': {'rx': [(0, 2.0), (3, -4.0), (10, -2.0)]},
        'head': {'rx': [(0, -10.0), (3, -10.0), (10, -6.0)]},
        'thigh_L': {'ax': [(0, -35.0), (3, 5.0), (10, -45.0)]}, 'thigh_R': {'ax': [(0, -35.0), (3, 8.0), (10, -12.0)]},
        'shin_L': {'ax': [(0, 35.0), (3, 8.0), (10, 30.0)]}, 'shin_R': {'ax': [(0, 35.0), (3, 10.0), (10, 30.0)]},
        'foot_L': {'ax': [(0, 0.0), (3, 40.0), (10, 30.0)]}, 'foot_R': {'ax': [(0, 0.0), (3, 45.0), (10, 40.0)]},
        'upperarm_L': {'rx': [(0, 35.0), (3, -95.0), (10, -60.0)], 'ry': [(0, 10.0), (3, -15.0), (10, -22.0)]},
        'forearm_L': {'rx': [(0, -20.0), (3, -30.0), (10, -40.0)]},
        'scarf1': {'rx': [(0, 10.0), (3, 30.0), (10, 10.0)]},
        'scarf2': {'rx': [(0, 5.0), (5, 20.0), (10, 5.0)]},
        'bag': {'rx': [(0, 0.0), (4, 8.0), (10, 0.0)], 'ry': [(0, 0.0), (10, 10.0)]},
    }, loop=False, sym=0)

    # fall: arms out for balance, legs tucked, scarf lifting
    clip(p, 'fall', 24, {
        'hips': {'rx': 2.0, 'rz': [(0, -2.0), (12, 2.0)]},
        'spine': {'rx': -4.0},
        'head': {'rx': 8.0},
        'thigh_L': {'ax': [(0, -28.0), (12, -20.0)]}, 'thigh_R': {'ax': [(0, -6.0), (12, -12.0)]},
        'shin_L': {'ax': [(0, 25.0), (12, 30.0)]}, 'shin_R': {'ax': [(0, 25.0), (12, 18.0)]},
        'foot_L': {'ax': 15.0}, 'foot_R': {'ax': 25.0},
        'upperarm_L': {'rx': [(0, -16.0), (12, -8.0)], 'ry': [(0, -58.0), (12, -66.0)]},
        'upperarm_R': {'rx': [(6, -12.0), (18, -20.0)], 'ry': [(6, 60.0), (18, 68.0)]},
        'forearm_L': {'rx': [(0, -50.0), (12, -40.0)], 'ry': [(0, -16.0), (12, -24.0)]},
        'forearm_R': {'rx': [(6, -44.0), (18, -54.0)], 'ry': [(6, 20.0), (18, 14.0)]},
        'hand_L': {'rx': -20.0}, 'hand_R': {'rx': -20.0},
        'scarf1': {'rx': [(0, -45.0), (6, -60.0), (12, -45.0), (18, -60.0)], 'rz': [(0, 6.0), (12, -6.0)]},
        'scarf2': {'rx': [(3, -15.0), (9, -30.0), (15, -15.0), (21, -30.0)]},
        'bag': {'ry': [(0, 14.0), (12, 18.0)], 'rx': [(0, -5.0), (12, 5.0)]},
    }, sym=None)

    # land: absorb the impact, settle back to the idle pose
    clip(p, 'land', 14, merge({
        'hips': {'tz': [(0, -0.14), (5, -0.06), (14, -0.004)], 'ty': [(0, 0.06), (5, 0.02), (14, 0.0)], 'rx': [(0, 12.0), (14, 0.0)]},
        'spine': {'rx': [(0, 18.0), (6, 8.0), (14, 2.0)]},
        'chest': {'rx': [(0, 5.0), (14, 0.0)]},
        'head': {'rx': [(0, -12.0), (6, -2.0), (14, -2.0)]},
        'thigh_L': {'ax': [(0, -50.0), (5, -28.0), (14, 0.0)]},
        'shin_L': {'ax': [(0, 35.0), (5, 22.0), (14, 0.0)]},
        'foot_L': {'ax': 0.0},
        'upperarm_L': {'rx': [(0, -20.0), (6, -2.0), (14, 3.0)], 'ry': [(0, -15.0), (6, 6.0), (14, 13.0)]},
        'forearm_L': {'rx': [(0, -35.0), (14, -14.0)], 'ry': 3.0},
        'scarf1': {'rx': [(0, 20.0), (4, -10.0), (9, 4.0), (14, 0.0)]},
        'scarf2': {'rx': [(0, 10.0), (5, -10.0), (10, 3.0), (14, 0.0)]},
        'bag': {'ry': [(0, -6.0), (5, 4.0), (14, 0.0)]},
    }), loop=False, sym=0)

    # trace: pencil held out in her right hand, drawing small loops along an outline
    clip(p, 'trace', 36, merge(arms_down(), {
        'hips': {'tz': -0.012, 'rz': [(0, -2.0), (18, 2.0)]},
        'spine': {'rx': 7.0, 'rz': -4.0},
        'chest': {'rx': [(0, 4.0), (18, 3.0)], 'rz': -4.0},
        'head': {'rx': [(0, 12.0), (9, 10.0), (18, 13.0), (27, 11.0)], 'rz': [(0, -8.0), (18, -5.0)], 'ry': -4.0},
        'thigh_L': {'ry': -5.0, 'rx': -4.0}, 'thigh_R': {'ry': 5.0, 'rx': 4.0},
        'shin_L': {'rx': 8.0}, 'shin_R': {'rx': 8.0},
        'foot_L': {'ax': 0.0}, 'foot_R': {'ax': 0.0},
        'upperarm_R': {'rx': [(0, -62.0), (9, -70.0), (18, -66.0), (27, -58.0)], 'ry': [(0, 4.0), (9, 0.0), (18, -6.0), (27, -2.0)],
                       'rz': [(0, 16.0), (18, 10.0)]},
        'forearm_R': {'rx': [(0, -32.0), (9, -26.0), (18, -30.0), (27, -36.0)], 'ry': -6.0},
        'hand_R': {'rx': [(0, 18.0), (18, 24.0)]},
        'upperarm_L': {'rx': -10.0, 'ry': 9.0}, 'forearm_L': {'rx': -34.0},
        'scarf1': {'rx': [(0, -4.0), (18, -8.0)]},
    }), sym=0)

    # talk: idle stance with hand gestures and nods (the mouth is driven separately by 'speak')
    clip(p, 'talk', 60, merge(arms_down(), {
        'hips': {'tz': -0.005, 'ry': [(0, -1.5), (30, 1.5)]},
        'spine': {'rx': 2.0, 'rz': [(0, 2.0), (30, -2.0)]},
        'chest': {'rx': [(0, 0.0), (15, -2.0), (30, 0.0), (45, -2.0)]},
        'head': {'rx': [(0, -2.0), (8, 3.0), (16, -3.0), (30, 1.0), (40, -2.0), (50, 3.0)], 'rz': [(0, 3.0), (25, -4.0), (45, 2.0)],
                 'ry': [(0, 3.0), (30, -3.0)]},
        'upperarm_R': {'rx': [(0, 2.0), (12, -22.0), (24, -18.0), (34, 2.0)], 'ry': [(0, -13.0), (12, -4.0), (34, -13.0)]},
        'forearm_R': {'rx': [(0, -14.0), (12, -65.0), (24, -55.0), (34, -14.0)], 'ry': -3.0},
        'hand_R': {'rx': [(0, -4.0), (12, -18.0), (24, -10.0), (34, -4.0)]},
        'upperarm_L': {'rx': [(0, 3.0), (30, 3.0), (42, -16.0), (52, -14.0), (59, 3.0)], 'ry': [(0, 13.0), (42, 2.0), (59, 13.0)]},
        'forearm_L': {'rx': [(0, -14.0), (30, -14.0), (42, -55.0), (52, -50.0), (59, -14.0)]},
        'thigh_R': {'ry': 2.0, 'rx': -3.0}, 'shin_R': {'rx': 6.0}, 'foot_L': {'ax': 0.0}, 'foot_R': {'ax': 0.0},
    }), sym=0)

    # pickup: crouch and reach down with the right hand
    clip(p, 'pickup', 26, merge(arms_down(), {
        'hips': {'tz': [(0, -0.004), (9, -0.18), (15, -0.18), (26, -0.004)], 'ty': [(0, 0.0), (9, 0.088), (15, 0.088), (26, 0.0)],
                 'rx': [(0, 0.0), (9, 20.0), (15, 20.0), (26, 0.0)]},
        'spine': {'rx': [(0, 2.0), (9, 15.0), (15, 14.0), (26, 2.0)]},
        'chest': {'rx': [(0, 0.0), (9, 8.0), (15, 6.0), (26, 0.0)]},
        'head': {'rx': [(0, -2.0), (9, -6.0), (15, -12.0), (26, -2.0)]},
        'thigh_L': {'ax': [(0, 0.0), (9, -60.0), (15, -60.0), (26, 0.0)]},
        'shin_L': {'ax': [(0, 0.0), (9, 35.0), (15, 35.0), (26, 0.0)]},
        'foot_L': {'ax': 0.0},
        'upperarm_R': {'rx': [(0, 3.0), (9, -88.0), (15, -78.0), (26, 3.0)], 'ry': [(0, -13.0), (9, -2.0), (26, -13.0)],
                       'rz': [(0, 0.0), (9, 12.0), (26, 0.0)]},
        'forearm_R': {'rx': [(0, -14.0), (9, -8.0), (15, -40.0), (26, -14.0)]},
        'upperarm_L': {'rx': [(0, 3.0), (9, -45.0), (26, 3.0)], 'ry': [(0, 13.0), (9, 14.0), (26, 13.0)]},
        'forearm_L': {'rx': [(0, -14.0), (9, -50.0), (26, -14.0)]},
        'scarf1': {'rx': [(0, 0.0), (9, -40.0), (15, -38.0), (26, 0.0)]},
        'bag': {'ry': [(0, 0.0), (9, 8.0), (26, 0.0)]},
    }), loop=False, sym=0)

    # --- acting for cutscenes ----------------------------------------------------------------

    # sit: on the ground, knees drawn up, arms round them, breathing slowly
    clip(p, 'sit', 90, {
        'hips': {'tz': -0.47, 'ty': 0.04, 'rx': [(0, -22.0), (45, -20.0)]},
        'spine': {'rx': [(0, 22.0), (45, 25.0)]},
        'chest': {'rx': [(0, 6.0), (45, 4.0)]},
        'neck': {'rx': -6.0},
        'head': {'rx': [(0, -10.0), (45, -6.0)], 'rz': [(0, 3.0), (50, -3.0)], 'ry': [(0, -3.0), (45, 2.0)]},
        'thigh_L': {'ax': -138.0, 'ry': -4.0}, 'shin_L': {'ax': 22.0}, 'foot_L': {'ax': 0.0},
        'upperarm_L': {'rx': [(0, -40.0), (45, -38.0)], 'ry': 4.0, 'rz': 26.0},
        'forearm_L': {'rx': -36.0, 'ry': 4.0, 'rz': 40.0},
        'hand_L': {'rx': 10.0},
        'scarf1': {'rx': [(0, 8.0), (45, 6.0)]}, 'bag': {'ry': 18.0, 'rx': 20.0},
    }, sym=0)

    # point: the right arm out at something, the head following it
    clip(p, 'point', 24, merge(arms_down(), {
        'hips': {'tz': -0.004},
        'spine': {'rx': [(0, 2.0), (10, 4.0)], 'rz': [(0, 0.0), (10, -6.0)]},
        'head': {'rx': [(0, -2.0), (10, -6.0)], 'rz': [(0, 0.0), (10, -10.0)]},
        'upperarm_R': {'rx': [(0, 3.0), (8, -92.0), (24, -88.0)], 'ry': [(0, -13.0), (8, -2.0)], 'rz': [(0, 0.0), (8, 16.0)]},
        'forearm_R': {'rx': [(0, -14.0), (8, -6.0)]},
        'hand_R': {'rx': [(0, -4.0), (8, 6.0)]},
        'thigh_R': {'ry': 2.0, 'rx': -3.0}, 'shin_R': {'rx': 6.0}, 'foot_L': {'ax': 0.0}, 'foot_R': {'ax': 0.0},
    }), loop=False, sym=0)

    # surprise: a startled half step back, hands up
    clip(p, 'surprise', 30, merge(arms_down(), {
        'hips': {'ty': [(0, 0.0), (5, 0.08), (30, 0.06)], 'tz': [(0, -0.004), (5, -0.03), (30, -0.02)]},
        'spine': {'rx': [(0, 2.0), (5, -10.0), (30, -6.0)]},
        'chest': {'rx': [(0, 0.0), (5, -6.0), (30, -3.0)]},
        'head': {'rx': [(0, -2.0), (5, -10.0), (30, -6.0)]},
        'upperarm_L': {'rx': [(0, 3.0), (5, -55.0), (30, -45.0)], 'ry': [(0, 13.0), (5, -12.0), (30, -6.0)]},
        'forearm_L': {'rx': [(0, -14.0), (5, -80.0), (30, -70.0)]},
        'hand_L': {'rx': [(0, -4.0), (5, -30.0)]},
        'thigh_L': {'ax': [(0, 0.0), (5, -10.0), (30, -6.0)]}, 'shin_L': {'ax': [(0, 0.0), (5, 6.0)]}, 'foot_L': {'ax': 0.0},
        'thigh_R': {'ax': [(0, 0.0), (5, 14.0), (30, 10.0)]}, 'shin_R': {'ax': [(0, 0.0), (5, 20.0), (30, 14.0)]}, 'foot_R': {'ax': 0.0},
        'scarf1': {'rx': [(0, 0.0), (6, -18.0), (14, 8.0), (30, 0.0)]},
    }), loop=False, sym=0)

    # hug: arms wrapped round someone, head turned and resting
    clip(p, 'hug', 72, {
        'hips': {'tz': -0.01, 'ty': [(0, -0.02), (36, -0.025)]},
        'spine': {'rx': [(0, 8.0), (36, 9.0)]},
        'chest': {'rx': [(0, 4.0), (36, 6.0)]},
        'neck': {'rx': 6.0},
        'head': {'rx': [(0, 10.0), (36, 12.0)], 'rz': -22.0, 'ry': -10.0},
        'upperarm_L': {'rx': [(0, -66.0), (36, -64.0)], 'ry': 4.0, 'rz': -48.0},
        'forearm_L': {'rx': -26.0, 'ry': 4.0, 'rz': -78.0},
        'hand_L': {'rx': 10.0},
        'foot_L': {'ax': 0.0},
        'scarf1': {'rx': 4.0},
    }, sym=0)

    # wave: hello / goodbye with the right hand
    clip(p, 'wave', 30, merge(arms_down(), {
        'hips': {'tz': -0.004},
        'head': {'rz': -4.0, 'ry': [(0, -4.0), (15, 4.0)]},
        'upperarm_R': {'rx': -24.0, 'ry': 68.0},
        'forearm_R': {'rx': -12.0, 'ry': [(0, 30.0), (8, 62.0), (15, 30.0), (23, 62.0)]},
        'hand_R': {'rz': [(0, 10.0), (8, -10.0), (15, 10.0), (23, -10.0)]},
        'foot_L': {'ax': 0.0}, 'foot_R': {'ax': 0.0},
    }), sym=0)

    # kneel_draw: down on one knee, drawing on the ground with the pencil
    clip(p, 'kneel_draw', 48, merge(arms_down(), {
        'hips': {'tz': -0.3, 'ty': 0.05, 'rx': 6.0},
        'spine': {'rx': [(0, 26.0), (24, 28.0)]},
        'chest': {'rx': 10.0, 'rz': -6.0},
        'head': {'rx': [(0, 18.0), (12, 22.0), (24, 18.0), (36, 20.0)], 'rz': -8.0},
        'thigh_L': {'ax': -84.0}, 'shin_L': {'ax': -4.0}, 'foot_L': {'ax': 0.0},
        'thigh_R': {'ax': 4.0}, 'shin_R': {'ax': 92.0}, 'foot_R': {'ax': 60.0},
        'upperarm_R': {'rx': [(0, -60.0), (12, -68.0), (24, -62.0), (36, -56.0)], 'rz': [(0, 22.0), (12, 16.0), (24, 10.0), (36, 18.0)],
                       'ry': -4.0},
        'forearm_R': {'rx': [(0, -12.0), (24, -18.0)]},
        'hand_R': {'rx': 28.0},
        'upperarm_L': {'rx': -30.0, 'ry': 6.0}, 'forearm_L': {'rx': -40.0},
        'bag': {'ry': 22.0},
    }), sym=0)

    # tiller: sitting on the boat's bench, one hand back on the tiller, swaying with the waves
    clip(p, 'tiller', 60, {
        'hips': {'tz': -0.3, 'ty': 0.02, 'rx': -6.0, 'ry': [(0, -3.0), (30, 3.0)]},
        'spine': {'rx': 8.0, 'rz': [(0, 2.0), (30, -2.0)]},
        'chest': {'rx': [(0, 2.0), (30, 0.0)], 'rz': 8.0},
        'head': {'rx': [(0, -6.0), (30, -4.0)], 'rz': -6.0, 'ry': [(0, 3.0), (30, -3.0)]},
        'thigh_L': {'ax': -88.0}, 'shin_L': {'ax': 4.0}, 'foot_L': {'ax': 0.0},
        'thigh_R': {'ax': -84.0, 'ry': 6.0}, 'shin_R': {'ax': 8.0}, 'foot_R': {'ax': 0.0},
        'upperarm_R': {'rx': 32.0, 'ry': -4.0}, 'forearm_R': {'rx': -55.0}, 'hand_R': {'rx': -20.0},
        'upperarm_L': {'rx': -10.0, 'ry': -18.0}, 'forearm_L': {'rx': -28.0, 'ry': -10.0},
        'scarf1': {'rx': [(0, 26.0), (15, 34.0), (30, 26.0), (45, 34.0)], 'rz': [(0, 10.0), (30, 16.0)]},
        'scarf2': {'rx': [(5, 10.0), (20, 20.0), (35, 10.0), (50, 20.0)]},
    }, sym=None)

    # face overlays: blink (eyes) and speak (mouth), played on top of any body clip
    clip(p, 'blink', 8, {'eye_L': {'sy': [(0, 1.0), (2, 0.08), (3, 0.08), (7, 1.0)]},
                         'eye_R': {'sy': [(0, 1.0), (2, 0.08), (3, 0.08), (7, 1.0)]}}, loop=False, bones=['eye_L', 'eye_R'])
    clip(p, 'speak', 24, {'mouth': {'sy': [(0, 1.0), (3, 3.2), (7, 1.4), (10, 2.6), (14, 1.0), (17, 3.0), (21, 1.6)],
                                    'sx': [(0, 1.0), (3, 0.85), (7, 1.0), (10, 0.9), (14, 1.0), (17, 0.85), (21, 1.0)]}},
         loop=True, bones=['mouth'])


def contact_sheet(arm, meshes, out):
    """Render a few frames of each clip side by side (workbench), for checking poses."""
    shots = [(n, int(f)) for n, f in (s.split(':') for s in os.environ.get('SHOTS', '').split(',') if s)] or [
        ('idle', 0), ('idle', 36), ('walk', 0), ('walk', 7), ('walk', 19), ('run', 0), ('run', 7), ('run', 12),
        ('jump', 0), ('jump', 10), ('fall', 6), ('land', 0), ('trace', 9), ('talk', 12), ('pickup', 12),
        ('sit', 0), ('point', 20), ('surprise', 10), ('hug', 10), ('wave', 8), ('kneel_draw', 10), ('tiller', 10)]
    close = os.environ.get('CLOSE')
    d = os.path.splitext(out)[0]
    os.makedirs(d, exist_ok=True)
    ad = arm.animation_data
    for i, (name, f) in enumerate(shots):
        act = bpy.data.actions[name]
        ad.action = act
        if hasattr(ad, 'action_slot') and act.slots:
            ad.action_slot = act.slots[0]
        bpy.context.scene.frame_set(f)
        meshes[1].hide_render = name == 'trace'
        meshes[2].hide_render = name != 'trace'
        if close:
            yaw, tz, dist = (float(v) for v in close.split(':'))
            lib.preview(os.path.join(d, f'{i:02d}_{name}_{f}.png'), target=(0, 0, tz), dist=dist, yaw=yaw, pitch=8,
                        size=(480, 480), lens=50, samples=16)
        else:
            lib.preview(os.path.join(d, f'{i:02d}_{name}_{f}.png'), target=(0, 0, 0.66), dist=2.6, yaw=-55, pitch=8,
                        size=(360, 480), lens=50, samples=10)
    ad.action = None
