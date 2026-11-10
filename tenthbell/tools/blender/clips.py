"""Every clip in The Tenth Bell, authored as key poses on the controls of pose.py and baked per fighter.

A clip: name -> dict(keys=[(time, {control: value}, ease)], base=FIGHT|STAND, loop=bool, hits=[(time, limb)],
soft=passes). Keys list only what differs from the base pose. Times are seconds at 30 fps.

  python clips.py sheet <out.png> [clip ...]   stick-figure contact sheet (side and front), no Blender needed
"""
import json
import math
import os
import sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pose
from pose import STAND, Rig, timeline, soften

FPS = 30

# orthodox stance: left side leads, weight low, chin down, hands home
FIGHT = dict(STAND,
             hips=(0.03, 0.0, -0.075), hip_rot=(4, -30, 0), spine=(11, 10, 0), head=(7, -3, 0),
             hand_L=(0.03, -0.42, 1.43), hand_R=(-0.16, -0.25, 1.45), elbow_L=(0.5, 0.25, -1), elbow_R=(-0.55, 0.4, -1),
             pron_L=15, pron_R=0, fist_L=1, fist_R=1, shrug_L=(7, 6), shrug_R=(7, 4),
             foot_L=(0.11, -0.31, 0), foot_R=(-0.15, 0.19, 0), toe_L=-6, toe_R=-48, heel_R=14,
             knee_L=(0.1, -1, 0), knee_R=(-0.75, -0.65, 0))
GUARD = dict(hand_L=(0.0, -0.33, 1.47), hand_R=(-0.15, -0.27, 1.48), elbow_L=(0.25, 0.3, -1), elbow_R=(-0.3, 0.4, -1),
             spine=(19, 8, 0), head=(15, -3, 0), hips=(0.03, 0.02, -0.105), shrug_L=(14, 8), shrug_R=(14, 8))
DOWN = dict(hips=(0.0, 0.86, -0.80), hip_rot=(-84, -8, 0), spine=(-4, 6, 0), head=(-78, 0, 0),
            hand_L=(0.52, 1.25, 0.07), hand_R=(-0.48, 1.05, 0.07), elbow_L=(1, 0.2, 0.3), elbow_R=(-1, 0.3, 0.3), pron_L=-70, pron_R=-70,
            fist_L=0.3, fist_R=0.3, foot_L=(0.16, 0.02, 0.05), foot_R=(-0.2, 0.1, 0.05), free_L=1, free_R=1, point_L=30, point_R=30,
            toe_L=20, toe_R=-25, heel_R=0, knee_L=(0.3, -0.2, 1), knee_R=(-0.4, -0.2, 1), shrug_L=(0, 0), shrug_R=(0, 0))


def K(t, e='io', **over):
    return (t, over, e)


def cycle(base, period, d, lift, back=False):
    """in-place shuffle step: each foot slides while planted and swings back lifted, half a cycle apart"""
    fl, fr = np.array(base['foot_L'], float), np.array(base['foot_R'], float)
    sg = -1 if back else 1
    keys = []
    for i, ph in enumerate((0, 0.25, 0.5, 0.75, 1.0)):
        # planted phase: slides from -d/2 to +d/2 (walking forward the floor moves back under the fighter)
        def at(p):
            p = p % 1.0
            if p < 0.5:
                return np.array([0, sg * (-d / 2 + d * (p / 0.5)), 0])
            q = (p - 0.5) / 0.5
            return np.array([0, sg * (d / 2 - d * q), lift * math.sin(q * math.pi)])
        bob = -0.012 * math.cos(ph * 4 * math.pi)
        keys.append((ph * period, dict(foot_L=fl + at(ph), foot_R=fr + at(ph + 0.5), hips=np.array(base['hips']) + np.array([0, 0, bob]),
                                       heel_L=18 * max(0, math.sin((ph % 1.0 - 0.5) * 2 * math.pi)) if (ph % 1.0) > 0.5 else 0), 'lin'))
    return keys


HL, HR = FIGHT['hand_L'], FIGHT['hand_R']

CLIPS = {
    'idle': dict(loop=True, keys=[K(0), K(0.8, hips=(0.03, 0.0, -0.09), hand_L=(0.03, -0.42, 1.415), hand_R=(-0.16, -0.25, 1.437), spine=(12.5, 10, 0)), K(1.6)]),
    'walk_f': dict(loop=True, speed=1.25, keys=cycle(FIGHT, 0.5, 0.31, 0.05)),
    'walk_b': dict(loop=True, speed=1.0, keys=cycle(FIGHT, 0.52, 0.26, 0.05, back=True)),
    'dash_f': dict(keys=[K(0), K(0.08, 'out', foot_L=(0.11, -0.44, 0.07), hips=(0.03, -0.05, -0.11), hip_rot=(10, -30, 0)),
                         K(0.2, 'out', foot_L=(0.11, -0.36, 0), foot_R=(-0.15, 0.10, 0.05), hips=(0.03, -0.03, -0.12), hip_rot=(9, -30, 0), heel_R=30), K(0.32)]),
    'dash_b': dict(keys=[K(0), K(0.08, 'out', foot_R=(-0.15, 0.36, 0.07), hips=(0.03, 0.06, -0.10), hip_rot=(-3, -30, 0), spine=(14, 10, 0)),
                         K(0.2, 'out', foot_R=(-0.15, 0.25, 0), foot_L=(0.11, -0.2, 0.05), hips=(0.03, 0.03, -0.11)), K(0.34)]),
    # ---- strikes
    'jab': dict(hits=[(0.10, 'hand_L')], keys=[
        K(0), K(0.10, 'snap', hand_L=(-0.07, -0.93, 1.47), aim_L=1, pron_L=88, hip_rot=(5, -40, 0), spine=(10, -4, 0), shrug_L=(10, 24),
                hips=(0.03, -0.04, -0.08), foot_L=(0.11, -0.345, 0), elbow_L=(0.6, 0, -0.6)),
        K(0.16, 'lin', hand_L=(-0.07, -0.92, 1.47), aim_L=1, pron_L=88, hip_rot=(5, -40, 0), spine=(10, -4, 0), shrug_L=(10, 24), hips=(0.03, -0.04, -0.08),
          foot_L=(0.11, -0.345, 0), elbow_L=(0.6, 0, -0.6)), K(0.36, 'out')]),
    'cross': dict(hits=[(0.17, 'hand_R')], keys=[
        K(0), K(0.07, 'out', hand_R=(-0.2, -0.2, 1.44), hip_rot=(4, -37, 0), hips=(0.02, 0.02, -0.085)),
        K(0.17, 'snap', hand_R=(0.0, -0.98, 1.47), aim_R=1, pron_R=90, hip_rot=(8, 16, 0), spine=(12, 30, 0), shrug_R=(10, 26), hips=(0.05, -0.09, -0.09),
          heel_R=42, toe_R=-12, knee_R=(-0.25, -1, 0), hand_L=(0.0, -0.3, 1.42), elbow_R=(-0.6, 0, -0.6)),
        K(0.25, 'lin', hand_R=(0.0, -0.97, 1.47), aim_R=1, pron_R=90, hip_rot=(8, 17, 0), spine=(12, 31, 0), shrug_R=(10, 26), hips=(0.05, -0.09, -0.09),
          heel_R=42, toe_R=-12, knee_R=(-0.25, -1, 0), hand_L=(0.0, -0.3, 1.42), elbow_R=(-0.6, 0, -0.6)), K(0.50, 'out')]),
    'hook': dict(hits=[(0.20, 'hand_L')], keys=[
        K(0), K(0.10, 'out', hip_rot=(4, -43, 0), hand_L=(0.2, -0.28, 1.42), elbow_L=(1, 0.5, -0.2), spine=(11, 2, 0)),
        K(0.20, 'snap', hip_rot=(5, -8, 0), spine=(11, 34, 0), hand_L=(-0.16, -0.60, 1.46), aim_L=1, elbow_L=(1, 0.1, 0.25), pron_L=90, heel_L=30, toe_L=-48,
          knee_L=(-0.3, -1, 0), hips=(0.02, -0.03, -0.085), shrug_L=(16, 10)),
        K(0.28, 'out', hip_rot=(5, -2, 0), spine=(11, 46, 0), hand_L=(-0.33, -0.42, 1.44), elbow_L=(1, 0.2, 0.3), pron_L=90, heel_L=30, toe_L=-48, knee_L=(-0.3, -1, 0)),
        K(0.52, 'out')]),
    'upper': dict(hits=[(0.26, 'hand_R')], keys=[
        K(0), K(0.14, 'out', hips=(0.0, 0.0, -0.17), hip_rot=(8, -40, 0), spine=(22, 4, -6), hand_R=(-0.22, -0.2, 1.08), pron_R=-80, elbow_R=(-0.5, 0.9, -0.2)),
        K(0.26, 'snap', hips=(0.05, -0.07, -0.03), hip_rot=(0, 8, 0), spine=(2, 26, 0), hand_R=(-0.02, -0.56, 1.52), aim_R=1, pron_R=-90, elbow_R=(-0.3, 0.3, -1),
          heel_R=42, toe_R=-15, knee_R=(-0.25, -1, 0), hand_L=(0.02, -0.28, 1.4)),
        K(0.34, 'out', hips=(0.05, -0.07, -0.02), hip_rot=(-2, 12, 0), spine=(-2, 30, 0), hand_R=(-0.02, -0.5, 1.64), aim_R=1, pron_R=-90, elbow_R=(-0.3, 0.3, -1),
          heel_R=42, toe_R=-15, knee_R=(-0.25, -1, 0), hand_L=(0.02, -0.28, 1.4)), K(0.58, 'out')]),
    'body': dict(hits=[(0.20, 'hand_L')], keys=[
        K(0), K(0.10, 'out', hips=(0.05, -0.02, -0.16), hip_rot=(8, -42, 0), spine=(20, 0, 8), hand_L=(0.24, -0.26, 1.1), elbow_L=(1, 0.6, -0.1), pron_L=20),
        K(0.20, 'snap', hips=(0.03, -0.06, -0.15), hip_rot=(8, -10, 0), spine=(20, 30, 6), hand_L=(-0.12, -0.66, 1.12), aim_L=0.5, elbow_L=(1, 0.3, 0.0), pron_L=35,
          heel_L=28, toe_L=-45, knee_L=(-0.3, -1, 0)),
        K(0.27, 'out', hips=(0.03, -0.06, -0.15), hip_rot=(8, -6, 0), spine=(20, 38, 6), hand_L=(-0.26, -0.52, 1.12), elbow_L=(1, 0.3, 0.0), pron_L=35, heel_L=28, toe_L=-45,
          knee_L=(-0.3, -1, 0)), K(0.50, 'out')]),
    'lowkick': dict(hits=[(0.24, 'foot_R')], keys=[
        K(0), K(0.12, 'out', hips=(0.07, -0.05, -0.06), hip_rot=(2, -18, 0), foot_R=(-0.24, 0.06, 0.14), free_R=1, point_R=20, knee_R=(-0.8, -0.6, 0.2), toe_L=18),
        K(0.24, 'snap', hips=(0.08, -0.08, -0.07), hip_rot=(-4, 52, 6), spine=(8, -34, -4), foot_R=(0.20, -0.95, 0.30), free_R=1, point_R=42, knee_R=(0.5, -1, 0.5),
          toe_L=42, heel_L=22, hand_R=(-0.34, 0.02, 1.12), elbow_R=(-0.5, 1, 0), hand_L=(0.06, -0.3, 1.44)),
        K(0.31, 'out', hips=(0.08, -0.08, -0.07), hip_rot=(-4, 60, 6), spine=(8, -38, -4), foot_R=(0.40, -0.80, 0.28), free_R=1, point_R=42, knee_R=(0.6, -1, 0.5),
          toe_L=48, heel_L=22, hand_R=(-0.34, 0.02, 1.12), elbow_R=(-0.5, 1, 0), hand_L=(0.06, -0.3, 1.44)),
        K(0.42, 'io', hips=(0.05, -0.02, -0.06), hip_rot=(2, -5, 0), foot_R=(-0.12, -0.05, 0.12), free_R=1, knee_R=(-0.5, -0.9, 0.2), toe_L=15), K(0.58, 'out')]),
    'frontkick': dict(hits=[(0.21, 'foot_L')], keys=[
        K(0), K(0.11, 'out', hips=(-0.02, 0.05, -0.05), hip_rot=(-4, -24, 0), spine=(8, 6, 0), foot_L=(0.06, -0.34, 0.5), free_L=1, point_L=10, knee_L=(0.05, -1, 0.6)),
        K(0.21, 'snap', hips=(-0.03, -0.06, -0.04), hip_rot=(-16, -20, 0), spine=(14, 4, 0), foot_L=(0.02, -1.08, 0.98), free_L=1, point_L=-25, knee_L=(0.05, -1, 0.5),
          hand_L=(0.12, -0.3, 1.36), hand_R=(-0.2, -0.2, 1.42)),
        K(0.28, 'lin', hips=(-0.03, -0.06, -0.04), hip_rot=(-16, -20, 0), spine=(14, 4, 0), foot_L=(0.02, -1.06, 0.98), free_L=1, point_L=-25, knee_L=(0.05, -1, 0.5),
          hand_L=(0.12, -0.3, 1.36), hand_R=(-0.2, -0.2, 1.42)),
        K(0.38, 'io', hips=(-0.02, 0.03, -0.05), hip_rot=(-4, -24, 0), foot_L=(0.07, -0.36, 0.42), free_L=1, knee_L=(0.05, -1, 0.6)), K(0.54, 'out')]),
    'roundhouse': dict(hits=[(0.30, 'foot_R')], keys=[
        K(0), K(0.14, 'out', hips=(0.08, -0.06, -0.05), hip_rot=(0, 5, 4), toe_L=40, heel_L=20, foot_R=(-0.2, 0.0, 0.34), free_R=1, point_R=30, knee_R=(-0.9, -0.5, 0.5),
                hand_R=(-0.22, -0.18, 1.4)),
        K(0.30, 'snap', hips=(0.10, -0.05, -0.02), hip_rot=(-14, 74, 20), spine=(4, -40, -12), head=(4, 8, 6), toe_L=80, heel_L=26, foot_R=(0.10, -0.9, 1.50), aim_R=0,
          free_R=1, point_R=48, knee_R=(0.6, -0.5, 1), hand_R=(-0.36, 0.2, 1.05), elbow_R=(-0.4, 1, 0), hand_L=(0.16, -0.22, 1.42)),
        K(0.37, 'out', hips=(0.10, -0.05, -0.02), hip_rot=(-14, 84, 20), spine=(4, -44, -12), head=(4, 8, 6), toe_L=88, heel_L=26, foot_R=(0.34, -0.74, 1.46), free_R=1,
          point_R=48, knee_R=(0.8, -0.4, 1), hand_R=(-0.36, 0.2, 1.05), elbow_R=(-0.4, 1, 0), hand_L=(0.16, -0.22, 1.42)),
        K(0.52, 'io', hips=(0.07, -0.02, -0.05), hip_rot=(0, 10, 4), toe_L=40, heel_L=14, foot_R=(-0.1, -0.1, 0.3), free_R=1, knee_R=(-0.6, -0.8, 0.5)), K(0.72, 'out')]),
    'knee': dict(hits=[(0.2, 'knee_R')], keys=[
        K(0), K(0.09, 'out', hips=(0.06, -0.06, -0.06), hand_L=(0.1, -0.62, 1.5), hand_R=(-0.14, -0.6, 1.5), fist_L=0.4, fist_R=0.4, foot_R=(-0.14, 0.1, 0.12), free_R=1),
        K(0.2, 'snap', hips=(0.06, -0.2, -0.02), hip_rot=(-14, 4, 0), spine=(18, 6, 0), hand_L=(0.08, -0.5, 1.2), hand_R=(-0.1, -0.48, 1.2), fist_L=0.5, fist_R=0.5,
          foot_R=(-0.03, -0.3, 0.62), free_R=1, point_R=55, knee_R=(0, -1, 0.9), heel_L=30),
        K(0.28, 'lin', hips=(0.06, -0.2, -0.02), hip_rot=(-14, 4, 0), spine=(18, 6, 0), hand_L=(0.08, -0.5, 1.2), hand_R=(-0.1, -0.48, 1.2), fist_L=0.5, fist_R=0.5,
          foot_R=(-0.03, -0.3, 0.62), free_R=1, point_R=55, knee_R=(0, -1, 0.9), heel_L=30), K(0.52, 'out')]),
    'palm': dict(hits=[(0.32, 'hand_R')], keys=[
        K(0), K(0.2, 'out', hips=(0.0, 0.06, -0.15), hip_rot=(8, -52, 0), spine=(14, -6, 0), hand_R=(-0.26, 0.0, 1.05), fist_R=0, pron_R=-30, elbow_R=(-0.6, 1, 0),
                hand_L=(0.02, -0.5, 1.4), fist_L=0.2, pron_L=60),
        K(0.32, 'snap', hips=(0.05, -0.24, -0.13), hip_rot=(10, 24, 0), spine=(12, 30, 0), hand_R=(0.0, -1.0, 1.36), aim_R=0.6, fist_R=0, pron_R=70, wrist_R=68,
          elbow_R=(-0.6, 0, -0.6), heel_R=45, toe_R=-10, knee_R=(-0.2, -1, 0), hand_L=(0.1, -0.2, 1.3), shrug_R=(8, 28), foot_L=(0.11, -0.4, 0)),
        K(0.44, 'lin', hips=(0.05, -0.24, -0.13), hip_rot=(10, 25, 0), spine=(12, 31, 0), hand_R=(0.0, -0.99, 1.36), aim_R=0.6, fist_R=0, pron_R=70, wrist_R=68,
          elbow_R=(-0.6, 0, -0.6), heel_R=45, toe_R=-10, knee_R=(-0.2, -1, 0), hand_L=(0.1, -0.2, 1.3), shrug_R=(8, 28), foot_L=(0.11, -0.4, 0)), K(0.74, 'out')]),
    'overhead': dict(hits=[(0.44, 'hand_R')], keys=[
        K(0), K(0.28, 'out', hips=(0.02, 0.05, -0.04), hip_rot=(-8, -22, 0), spine=(-14, 14, 0), head=(-6, 0, 0), hand_L=(0.02, -0.12, 1.98), hand_R=(-0.1, -0.08, 2.0),
                elbow_L=(0.8, -0.4, 0.3), elbow_R=(-0.8, -0.4, 0.3)),
        K(0.44, 'snap', hips=(0.03, -0.12, -0.2), hip_rot=(20, -14, 0), spine=(40, 12, 0), head=(20, 0, 0), hand_L=(0.02, -0.8, 1.02), hand_R=(-0.1, -0.78, 1.04), aim_L=0.4, aim_R=0.4,
          elbow_L=(0.7, 0.3, -0.5), elbow_R=(-0.7, 0.3, -0.5), foot_L=(0.11, -0.4, 0)),
        K(0.56, 'lin', hips=(0.03, -0.12, -0.21), hip_rot=(20, -14, 0), spine=(41, 12, 0), head=(20, 0, 0), hand_L=(0.02, -0.8, 1.0), hand_R=(-0.1, -0.78, 1.02), aim_L=0.4, aim_R=0.4,
          elbow_L=(0.7, 0.3, -0.5), elbow_R=(-0.7, 0.3, -0.5), foot_L=(0.11, -0.4, 0)), K(0.86, 'io')]),
    # ---- defence and being hit
    'block': dict(keys=[K(0), K(0.1, 'out', **GUARD)]),
    'block_hit': dict(base=dict(FIGHT, **GUARD), keys=[K(0), K(0.06, 'out', hips=(0.03, 0.08, -0.11), spine=(14, 8, 0), hand_L=(0.0, -0.27, 1.46), hand_R=(-0.15, -0.22, 1.47)), K(0.26, 'out')]),
    'hit_high': dict(keys=[K(0), K(0.07, 'snap', head=(-22, 14, 6), spine=(2, 16, 2), hips=(0.03, 0.06, -0.07), hand_L=(0.08, -0.36, 1.36), hand_R=(-0.18, -0.2, 1.38)),
                           K(0.2, 'io', head=(-8, 6, 2), spine=(8, 12, 0), hips=(0.03, 0.04, -0.075)), K(0.42, 'out')]),
    'hit_body': dict(keys=[K(0), K(0.08, 'snap', spine=(34, 8, -4), head=(24, -3, 0), hips=(0.03, 0.1, -0.13), hand_L=(0.02, -0.32, 1.3), hand_R=(-0.12, -0.24, 1.26)),
                           K(0.24, 'io', spine=(24, 9, -2), head=(16, -3, 0), hips=(0.03, 0.07, -0.11)), K(0.46, 'out')]),
    'stagger': dict(keys=[K(0), K(0.12, 'snap', hips=(0.0, 0.14, -0.04), hip_rot=(-12, -22, 0), spine=(-8, 20, 6), head=(-26, 16, 10), hand_L=(0.4, -0.22, 1.3), hand_R=(-0.48, 0.0, 1.2),
                                  elbow_L=(1, 0.5, -0.5), elbow_R=(-1, 0.6, -0.4), fist_L=0.4, fist_R=0.4, foot_L=(0.11, -0.2, 0.06)),
                          K(0.4, 'io', hips=(0.0, 0.1, -0.12), hip_rot=(8, -26, 0), spine=(20, 12, -4), head=(18, -4, -4), hand_L=(0.2, -0.3, 1.16), hand_R=(-0.3, -0.12, 1.14),
                            fist_L=0.5, fist_R=0.5, foot_L=(0.11, -0.22, 0)),
                          K(0.72, 'io', hips=(0.02, 0.04, -0.1), spine=(16, 10, 0), hand_L=(0.06, -0.38, 1.34), hand_R=(-0.2, -0.22, 1.36)), K(0.95, 'out')]),
    'knockdown': dict(keys=[K(0), K(0.16, 'out', hips=(0.0, 0.3, 0.06), hip_rot=(-38, -20, 0), spine=(-10, 10, 0), head=(-30, 0, 0), hand_L=(0.45, -0.1, 1.5), hand_R=(-0.5, 0.1, 1.45),
                                    fist_L=0.3, fist_R=0.3, foot_L=(0.13, -0.1, 0.25), foot_R=(-0.16, 0.25, 0.15), free_L=1, free_R=1, point_L=30, point_R=30),
                            K(0.46, 'in', **dict(DOWN, hips=(0.0, 0.86, -0.74), foot_L=(0.16, 0.0, 0.3), foot_R=(-0.2, 0.1, 0.22))),
                            K(0.6, 'out', **DOWN), K(1.1, 'io', **DOWN)]),
    'getup': dict(base=dict(FIGHT, **DOWN), keys=[
        K(0), K(0.34, 'io', hips=(0.0, 0.62, -0.72), hip_rot=(-34, -14, 0), spine=(26, 8, 0), head=(4, 0, 0), hand_L=(0.36, 0.9, 0.06), hand_R=(-0.34, 0.86, 0.06),
                foot_L=(0.16, -0.08, 0), foot_R=(-0.2, 0.3, 0), free_L=0, free_R=0, knee_L=(0.3, -0.5, 1), knee_R=(-0.5, -0.5, 1)),
        K(0.68, 'io', **dict(FIGHT, hips=(0.03, 0.12, -0.42), hip_rot=(30, -30, 0), spine=(24, 10, 0), hand_L=(0.2, -0.3, 0.7), hand_R=(-0.3, 0.0, 0.6))),
        K(1.0, 'out', **FIGHT)]),
    'ko': dict(keys=[K(0), K(0.2, 'out', hips=(0.0, 0.12, -0.05), hip_rot=(-10, -24, 0), spine=(-10, 16, 6), head=(-28, 14, 8), hand_L=(0.36, -0.2, 1.3), hand_R=(-0.44, 0.0, 1.2),
                             fist_L=0.3, fist_R=0.3),
                     K(0.75, 'in', hips=(-0.03, 0.3, -0.42), hip_rot=(-6, -18, 4), spine=(6, 8, 8), head=(-34, 10, 12), hand_L=(0.36, 0.1, 0.8), hand_R=(-0.42, 0.24, 0.72),
                       fist_L=0.2, fist_R=0.2, foot_L=(0.12, -0.2, 0), heel_L=20, heel_R=30),
                     K(1.15, 'in', **dict(DOWN, hips=(0.0, 0.84, -0.76))), K(1.3, 'out', **DOWN), K(2.0, 'io', **DOWN)]),
    'win': dict(keys=[K(0), K(0.6, 'io', **dict(STAND, hips=(0, 0, -0.01), spine=(-3, 0, 0), head=(-6, 0, 0), fist_L=0.6, fist_R=1)),
                      K(1.3, 'io', **dict(STAND, spine=(-6, 6, 0), head=(-12, 0, 0), hand_R=(-0.22, -0.1, 1.98), elbow_R=(-1, 0.2, 0), fist_R=1, fist_L=0.6, shrug_R=(18, 0))),
                      K(2.6, 'io', **dict(STAND, spine=(-7, 6, 0), head=(-14, 0, 0), hand_R=(-0.22, -0.1, 2.0), elbow_R=(-1, 0.2, 0), fist_R=1, fist_L=0.6, shrug_R=(18, 0)))]),
}


def build(name, rig):
    """-> (frames of controls, clip dict)"""
    c = CLIPS[name]
    base = c.get('base', FIGHT)
    fr = timeline(base, c['keys'], FPS, c.get('loop', False))
    return soften(fr, c.get('soft', 1), c.get('loop', False)), c


LIMB_BONE = {'hand_L': 'wrist.L', 'hand_R': 'wrist.R', 'foot_L': 'foot.L', 'foot_R': 'foot.R', 'knee_R': 'lowerleg01.R', 'knee_L': 'lowerleg01.L'}


def meta_for(rig, names=None):
    """clip facts the game needs: duration, loop, where and when each strike lands (from the solved pose)"""
    out = {}
    for name in names or CLIPS:
        frames, c = build(name, rig)
        hits = []
        for t, limb in c.get('hits', []):
            _l, _o, pos = rig.solve(frames[min(int(round(t * FPS)), len(frames) - 1)])
            p = pos[LIMB_BONE[limb]]
            hits.append(dict(t=t, bone=LIMB_BONE[limb], reach=round(float(-p[1]) + (0.1 if 'hand' in limb else 0.12), 3), z=round(float(p[2]), 3)))
        out[name] = dict(dur=round(len(frames) / FPS if c.get('loop') else (len(frames) - 1) / FPS, 4), loop=bool(c.get('loop')), hits=hits, **({'speed': c['speed']} if 'speed' in c else {}))
    return out


def bake_all(rig_obj, R, spec, names=None):
    import bpy
    rig = Rig(R)
    Mroot = rig.M['root']
    rig_obj.animation_data_create()
    for pb in rig_obj.pose.bones:   # MPFB rigs come with euler bones: quaternion curves would be ignored
        pb.rotation_mode = 'QUATERNION'
    for name in names or CLIPS:
        frames, c = build(name, rig)
        solved = [rig.solve(f) for f in frames]
        act = bpy.data.actions.new(name)
        n = len(solved)
        ts = np.arange(n, dtype=np.float64)
        for b in sorted(solved[0][0]):
            q = np.array([pose.to_quat(s[0][b]) for s in solved])
            for i in range(1, n):
                if np.dot(q[i], q[i - 1]) < 0:
                    q[i] = -q[i]
            for ch in range(4):
                fc = act.fcurves.new(f'pose.bones["{b}"].rotation_quaternion', index=ch, action_group=b)
                fc.keyframe_points.add(n)
                fc.keyframe_points.foreach_set('co', np.stack([ts, q[:, ch]], 1).ravel())
                fc.update()
        loc = np.array([Mroot.T @ s[1] for s in solved])
        for ch in range(3):
            fc = act.fcurves.new('pose.bones["root"].location', index=ch, action_group='root')
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set('co', np.stack([ts, loc[:, ch]], 1).ravel())
            fc.update()
        tr = rig_obj.animation_data.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 0, act)
        st.name = name
    bpy.context.scene.render.fps = FPS
    return meta_for(rig, names)


# ---------------------------------------------------------------- stick-figure preview
CHAINS = [(['root', 'spine05', 'spine03', 'spine01', 'neck01', 'head'], (40, 40, 40)),
          (['spine01', 'upperarm01.L', 'lowerarm01.L', 'wrist.L', 'finger3-1.L'], (40, 110, 230)), (['spine01', 'upperarm01.R', 'lowerarm01.R', 'wrist.R', 'finger3-1.R'], (220, 60, 50)),
          (['root', 'upperleg01.L', 'lowerleg01.L', 'foot.L', 'toe1-1.L'], (40, 110, 230)), (['root', 'upperleg01.R', 'lowerleg01.R', 'foot.R', 'toe1-1.R'], (220, 60, 50))]


def sheet(path, names, R, per=6):
    from PIL import Image, ImageDraw
    rig = Rig(R)
    cw, ch = 150, 190
    img = Image.new('RGB', (cw * per * 2 + 70, ch * len(names)), (245, 245, 242))
    d = ImageDraw.Draw(img)
    for r, name in enumerate(names):
        frames, c = build(name, rig)
        d.text((4, r * ch + 4), name, fill=(0, 0, 0))
        marks = sorted({int(round(k[0] * FPS)) for k in c['keys']})
        idx = marks if len(marks) <= per else [marks[int(i * (len(marks) - 1) / (per - 1))] for i in range(per)]
        for col, fi in enumerate(idx[:per]):
            _l, _o, pos = rig.solve(frames[min(fi, len(frames) - 1)])
            headtop = pos['head'] + (pos['head'] - pos['neck01']) * 1.3
            for view in (0, 1):  # side (looking along -X: the fighter faces right), front
                ox = 70 + (col + view * per) * cw + cw / 2
                oy = r * ch + ch - 12

                def P(p):
                    return (ox + (-p[1] if view == 0 else p[0]) * 78 + (-10 if view == 0 else 0), oy - p[2] * 82)
                d.line([(ox - cw / 2 + 4, oy), (ox + cw / 2 - 4, oy)], fill=(190, 190, 185))
                for chain, colr in CHAINS:
                    d.line([P(pos[b]) for b in chain], fill=colr, width=3)
                hx, hy = P((pos['head'] + headtop) / 2)
                d.ellipse([hx - 8, hy - 9, hx + 8, hy + 9], outline=(40, 40, 40), width=2)
            d.text((70 + col * cw + 4, r * ch + 4), f'{fi / FPS:.2f}', fill=(120, 120, 120))
    img.save(path)


if __name__ == '__main__':
    if sys.argv[1] == 'sheet':
        R = {k: (np.array(v[0]), np.array(v[1]), np.array(v[2]), v[3]) for k, v in json.load(open(os.environ.get('TB_REST', '/opt/work/rest_kessa.json'))).items()}
        sheet(sys.argv[2], sys.argv[3:] or list(CLIPS), R)
