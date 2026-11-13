"""Ethan Vale. Usage:
  blender -b -P ethan.py -- [--fast] [--preview out.png] [--poses outdir [--clips a,b,c]] [--export]"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
sys.path.insert(0, os.path.join(HERE, '..', 'animations'))
import ftlib as lib  # noqa: E402
import humanoid  # noqa: E402

SPEC = dict(height=1.85, shoulders=1.15, bulk=1.0, hips=1.0, vest=True, hair='short', jaw=1.04)
OUT = os.path.join(lib.MODELS, 'characters', 'ethan.glb')
META = os.path.join(lib.MODELS, 'animations', 'humanoid_clips.json')


def build(fast=False):
    lib.reset()
    return humanoid.build(SPEC, 'ethan', weights=True, ao=not fast, quality=0.55 if fast else 1.0)


def author(arm):
    import anim_lib
    import ethan_anims
    meta = anim_lib.author(arm, ethan_anims.all_clips())
    return meta


def pose_sheet(arm, outdir, names, shots=5):
    os.makedirs(outdir, exist_ok=True)
    ad = arm.animation_data
    for name in names:
        act = bpy.data.actions[name]
        ad.action = act
        if hasattr(ad, 'action_slot') and act.slots:
            ad.action_slot = act.slots[0]
        f0, f1 = act.frame_range
        for i in range(shots):
            f = f0 + (f1 - f0) * i / max(shots - 1, 1) if not (act.use_cyclic or '_loop' in name) else f0 + (f1 - f0) * i / shots
            bpy.context.scene.frame_set(int(round(f)))
            lib.preview(os.path.join(outdir, f'{name}__{i}.png'), target=(0, 0, 0.95), dist=4.4, yaw=-50, pitch=6, size=(260, 400), lens=60, samples=6)
    ad.action = None


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    fast = '--fast' in argv
    arm, meshes, j = build(fast)
    meta = author(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
        humanoid.preview_sheet(out)
        lib.preview(out.replace('.png', '_face.png'), target=(0, -0.02, 1.70), dist=0.85, yaw=-20, pitch=4, size=(700, 700), samples=32, lens=70)
    if '--poses' in argv:
        outdir = argv[argv.index('--poses') + 1]
        names = argv[argv.index('--clips') + 1].split(',') if '--clips' in argv else list(meta)
        pose_sheet(arm, outdir, names)
    if '--export' in argv:
        os.makedirs(os.path.dirname(META), exist_ok=True)
        json.dump(meta, open(META, 'w'), indent=1)
        lib.export_glb(OUT, [arm] + meshes)
