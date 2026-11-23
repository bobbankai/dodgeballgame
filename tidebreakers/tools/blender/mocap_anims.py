"""Mocap-driven clips for the humanoid library (CMU Graphics Lab Motion Capture Database, mocap.cs.cmu.edu;
free to use in products, not to be resold as data). Locomotion and acting come from capture; the anime
attacks stay hand-keyed in anims.py.

    blender -b -P mocap_anims.py -- --sheets idle,walk     contact sheets on Kai (docs/art/anims/mocap_*)
anims.py --export merges these clips into humanoid.glb (they replace keyed clips of the same name).
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
from tb import mocap as M  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
CACHE = os.path.join(ROOT, 'tools', 'blender', 'mocap_cache')

# name: (subject, trial, options). Frames are at 120 fps in the source; `range` is [start, end) there.
CLIPS = {
    'idle': (77, 2, dict(loop=True, cycle=(90, 240))),
    'wait': (40, 10, dict(loop=True, cycle=(90, 240))),
    'walk': (7, 1, dict(inplace=True, loop=True, cycle=(26, 44))),
    'jog': (9, 1, dict(inplace=True, loop=True, cycle=(16, 30))),
    'run': (143, 1, dict(inplace=True, loop=True, cycle=(12, 24))),
    'sad_walk': (82, 10, dict(inplace=True, loop=True, cycle=(30, 60))),
    'talk': (18, 8, dict(loop=True, cycle=(120, 260), hands=(15.0, 10.0, 1.0))),
    'cry': (79, 72, dict(loop=True, cycle=(90, 240), hands=(40.0, 25.0, 0.3))),
    'sad': (79, 71, dict(loop=True, cycle=(90, 240), hands=(35.0, 20.0, 0.3))),
    'laugh': (79, 70, dict(loop=False)),
    'wave': (141, 16, dict(loop=False)),
    'getup': (139, 18, dict(loop=False)),
    'sit_stool': (13, 4, dict(loop=True, cycle=(90, 240), range=(600, None))),
}


def finger_pose(arm, skel, curl=25.0, thumb=15.0, spread=0.6):
    """Basis rotations of the finger bones for a hand pose, from the keyed rig's own finger model."""
    import numpy as np
    from tb.anim import Builder, Solver, Pose
    b = Builder(skel)
    p = Pose()
    b.fist(p, 'L', curl, thumb, spread)
    b.fist(p, 'R', curl, thumb, spread)
    sv = Solver(arm, b)
    sv.reset()
    sv.apply_fk(p)
    out = {}
    for pb in arm.pose.bones:
        if any(k in pb.name for k in ('index', 'middle', 'ring', 'pinky', 'thumb')):
            q = pb.rotation_quaternion
            out[pb.name] = np.array([q.w, q.x, q.y, q.z])
    sv.reset()
    return out


def build(rig, names=None, verbose=True, arm=None, skel=None):
    """Returns {name: mocap.Clip} retargeted onto `rig` (a mocap.Rig)."""
    out = {}
    hands = {}
    for name, (subj, trial, o) in CLIPS.items():
        if names and name not in names:
            continue
        asf_p, amc_p = M.fetch(subj, trial, CACHE)
        r0, r1 = o.get('range', (0, None))
        asf, poses = M.load(asf_p, amc_p, start=r0, end=r1, step=4)
        hp = o.get('hands', (25.0, 15.0, 0.6))
        if arm is not None and hp not in hands:
            hands[hp] = finger_pose(arm, skel, *hp)
        clip = M.retarget(rig, asf, poses, name, inplace=o.get('inplace', False), loop=False, recenter=True, fingers=hands.get(hp))
        if o.get('cycle'):
            d, i, j = M.find_cycle(clip, *o['cycle'])
            M.trim(clip, i, j)
            if verbose:
                print(f'[mocap] {name}: cycle {i}-{j} ({(j - i) / 30:.2f}s) error {d:.3f}')
        if o.get('loop'):
            clip.loop = True
            M.make_loop(clip)
        if o.get('length'):
            n = int(o['length'] * 30)
            M.trim(clip, 0, n)
        out[name] = clip
        if verbose:
            print(f'[mocap] {name}: {len(clip.frames)} frames, travel {clip.speed:.2f} m/s')
    return out


def write_meta(clips):
    path = os.path.join(ROOT, 'public', 'assets', 'anims', 'mocap.json')
    meta = {n: {'speed': round(c.speed, 3), 'loop': c.loop, 'frames': len(c.frames), 'source': f'CMU {CLIPS[n][0]:02d}_{CLIPS[n][1]:02d}'} for n, c in clips.items()}
    with open(path, 'w') as f:
        json.dump(meta, f, indent=1)


if __name__ == '__main__':
    import bpy
    from tb import bl, pipeline
    import chars
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    want = set(args[args.index('--sheets') + 1].split(',')) if '--sheets' in args else None
    who = args[args.index('--char') + 1] if '--char' in args else 'kai'
    bl.reset()
    spec = chars.CHARS[who]()
    mesh_ob, arm = pipeline.build(spec, None, os.path.join(ROOT, 'docs', 'art', who), renders=False)
    rig = M.Rig(arm)
    clips = build(rig, want, arm=arm, skel=spec.skel)
    bl.setup_preview(res=(400, 560))
    # a floor to judge contact
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    fl = bpy.context.active_object
    fm = bpy.data.materials.new('floor')
    fm.diffuse_color = (0.25, 0.27, 0.3, 1)
    fl.data.materials.append(fm)
    out = os.path.join(ROOT, 'docs', 'art', 'anims')
    os.makedirs(out, exist_ok=True)
    for name, c in clips.items():
        act = M.write_action(arm, c)
        n = len(c.frames)
        frames = sorted(set(int(round(i * (n - 1) / 5)) + 1 for i in range(6)))
        for k, f in enumerate(frames):
            bpy.context.scene.frame_set(f)
            bl.render_views(os.path.join(out, f'mocap_{name}_{k}'), target=(0, 0, 0.9), dist=3.4, views=[('v', 30, 6), ('s', 90, 1)], lens=55)
        print('[mocap] sheet', name, frames)
