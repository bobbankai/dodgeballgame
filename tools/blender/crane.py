"""
The Keeper: an old paper crane who tends the lighthouse. Folded white paper with pale blue inside
folds, round wire spectacles and a little blue cap.

Blender axes: Z up, the crane faces -Y. About 1.35 m to the top of its head.

Run: blender -b -P tools/blender/crane.py [-- --preview out.png] [--poses out.png] [--export]
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from pip import loft, tag  # noqa: E402

C = {'paper': '#F2EEE6', 'inside': '#A9C4DE', 'ink': '#1E1A1C', 'brass': '#B8963E', 'cap': '#2F4E78', 'leg': '#D9D2C2'}


def M(name):
    return lib.mat('crane_' + name, C[name])


def paper_loft(name, rings, tip_start=None, tip_end=None, inside=None):
    ob = loft(name, rings, tip_start, tip_end, inside)
    ob.data.materials[0] = M('paper')
    ob.data.materials[1] = M('inside')
    return ob


def V(*p):
    return Vector(p)


def body():
    # the classic folded diamond: a ridge on top, a keel below
    def ring(y, s):
        return [V(0, y, 0.82 + 0.13 * s), V(0.11 * s, y, 0.8), V(0, y, 0.64 + 0.16 * (1 - s)), V(-0.11 * s, y, 0.8)]
    b = paper_loft('body', [ring(-0.12, 0.7), ring(0.0, 1.0), ring(0.12, 0.7)], tip_start=V(0, -0.2, 0.8), tip_end=V(0, 0.2, 0.82),
                   inside=lambda c, n: n.z < -0.4)
    return tag([b], 'body')


def neck_head():
    pts = [(-0.16, 0.84, 0.03), (-0.26, 1.02, 0.025), (-0.36, 1.2, 0.02), (-0.41, 1.3, 0.018)]
    rings = [[V(0, y, z + w), V(w * 0.8, y, z), V(0, y + w * 0.3, z - w), V(-w * 0.8, y, z)] for y, z, w in pts]
    neck = paper_loft('neck', rings, inside=lambda c, n: n.y > 0.3)
    # the head folds forward into a long beak
    hr = [V(0, -0.41, 1.33), V(0.025, -0.43, 1.31), V(0, -0.42, 1.285), V(-0.025, -0.43, 1.31)]
    head = paper_loft('head', [hr], tip_start=V(0, -0.37, 1.31), tip_end=V(0, -0.6, 1.24), inside=lambda c, n: n.z < -0.5)
    parts = tag([neck], 'neck') + tag([head], 'head')
    # spectacles: two wire rings and a bridge, and a little blue cap
    specs = []
    for s in (1, -1):
        ring = [V(s * 0.028, -0.47, 1.315) + V(0, math.cos(t) * 0.018, math.sin(t) * 0.018) for t in (2 * math.pi * k / 12 for k in range(13))]
        specs.append(lib.tube('lens', ring, [0.0025] * 13, M('brass'), sides=5, cap=False, subsurf=0))
    specs.append(lib.tube('bridge', [V(0.028, -0.47, 1.333), V(0, -0.475, 1.338), V(-0.028, -0.47, 1.333)], [0.0022] * 3, M('brass'), sides=5, subsurf=0))
    cap = [lib.lathe('cap', [(0.0, 0.0), (0.045, 0.0), (0.042, 0.035), (0.0, 0.04)], M('cap'), segs=14, center=(0, -0.405, 1.335), subsurf=0),
           lib.lathe('brim', [(0.0, 0.0), (0.06, 0.0), (0.06, 0.008), (0.0, 0.008)], M('cap'), segs=14, center=(0, -0.42, 1.333), subsurf=0)]
    cap[1].data.transform(Matrix.Translation((0, -0.42, 1.333)) @ Matrix.Rotation(0.25, 4, 'X') @ Matrix.Translation((0, 0.42, -1.333)))
    for e in (1, -1):
        specs.append(lib.ellipsoid('eye', (e * 0.024, -0.462, 1.318), (0.005, 0.004, 0.006), M('ink'), segs=(8, 6)))
    return parts + tag(specs + cap, 'head')


def tail():
    pts = [(0.15, 0.84, 0.03), (0.28, 0.98, 0.022), (0.4, 1.12, 0.012)]
    rings = [[V(0, y, z + w), V(w * 0.8, y, z), V(0, y - w * 0.3, z - w), V(-w * 0.8, y, z)] for y, z, w in pts]
    return tag([paper_loft('tail', rings, tip_end=V(0, 0.46, 1.2), inside=lambda c, n: n.y < -0.3)], 'tail')


def wings():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        # a broad folded wing: two triangles meeting on a crease
        root_f, root_b = V(s * 0.05, -0.1, 0.9), V(s * 0.05, 0.11, 0.9)
        tip = V(s * 0.62, 0.06, 1.12)
        crease = V(s * 0.34, 0.0, 1.06)
        parts += tag([paper_loft('wing', [[root_f, root_b + V(0, 0, 0.005), root_b, root_f + V(0, 0, -0.005)],
                                          [crease + V(0, -0.07, 0), crease + V(0, 0.07, 0.008), crease + V(0, 0.07, 0), crease + V(0, -0.07, -0.008)]],
                                 tip_end=tip, inside=lambda c, n: n.z < 0)], 'wing_' + side)
    return parts


def legs():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        top, knee, foot = V(s * 0.04, 0.0, 0.68), V(s * 0.05, 0.03, 0.34), V(s * 0.06, 0.0, 0.02)
        leg = lib.tube('leg', [top, knee, foot], [0.012, 0.01, 0.009], M('leg'), sides=4, subsurf=0)
        toes = [lib.tube('toe', [foot, foot + V(math.sin(a) * 0.08, -math.cos(a) * 0.08, -0.015)], [0.007, 0.003], M('leg'), sides=4, subsurf=0)
                for a in (-0.5, 0.0, 0.5)]
        parts += tag([leg] + toes, 'leg_' + side)
    return parts


BODY = ['body', 'neck1', 'neck2', 'head', 'tail', 'wing_L', 'wing_R', 'leg_L', 'leg_R']
PARENT = {'neck1': 'body', 'neck2': 'neck1', 'head': 'neck2', 'tail': 'body', 'wing_L': 'body', 'wing_R': 'body',
          'leg_L': 'body', 'leg_R': 'body'}


def bones():
    return [('body', (0, 0.12, 0.8), (0, -0.12, 0.8), None),
            ('neck1', (0, -0.16, 0.85), (0, -0.26, 1.02), 'body'),
            ('neck2', (0, -0.26, 1.02), (0, -0.41, 1.3), 'neck1'),
            ('head', (0, -0.41, 1.3), (0, -0.6, 1.24), 'neck2'),
            ('tail', (0, 0.15, 0.84), (0, 0.46, 1.2), 'body'),
            ('wing_L', (0.05, 0.0, 0.9), (0.62, 0.06, 1.12), 'body'),
            ('wing_R', (-0.05, 0.0, 0.9), (-0.62, 0.06, 1.12), 'body'),
            ('leg_L', (0.04, 0.0, 0.68), (0.06, 0.0, 0.02), 'body'),
            ('leg_R', (-0.04, 0.0, 0.68), (-0.06, 0.0, 0.02), 'body')]


def weight_fn(kind, segs):
    if kind == 'neck':
        sub = {n: segs[n] for n in ('neck1', 'neck2', 'body')}
        return lambda p: lib.dist_weights(p, sub, {'body': 0.4}, 6.0)
    return lambda p: {kind: 1.0}


def clip(p, name, N, ch, loop=True, sym=None):
    lib.clip(p, name, N, ch, BODY, PARENT, loop=loop, sym=sym)


def author(arm):
    p = lib.Poser(arm)
    # idle: an old bird breathing, peering about over its spectacles
    clip(p, 'idle', 90, {
        'body': {'tz': [(0, 0.0), (45, -0.008)], 'rx': [(0, 0.0), (45, 2.0)]},
        'neck1': {'rx': [(0, 0.0), (45, 3.0)]},
        'neck2': {'rx': [(0, 0.0), (30, -4.0), (60, 2.0)], 'rz': [(0, 0.0), (20, 18.0), (50, 18.0), (70, -10.0)]},
        'head': {'rx': [(0, 0.0), (30, 6.0), (60, -3.0)], 'ry': [(0, 0.0), (20, 10.0), (50, 10.0), (70, -6.0)]},
        'wing_L': {'ry': [(0, 0.0), (45, -4.0)]},
        'tail': {'rx': [(0, 0.0), (45, -3.0)]},
    }, sym=0)
    # talk: nodding, the wings lifting a little to make a point
    clip(p, 'talk', 48, {
        'body': {'tz': [(0, 0.0), (12, 0.01), (24, 0.0), (36, 0.012)]},
        'neck1': {'rx': [(0, 2.0), (12, 6.0), (24, 0.0), (36, 5.0)]},
        'neck2': {'rx': [(0, -4.0), (10, 6.0), (20, -6.0), (32, 4.0), (42, -2.0)], 'rz': [(0, 6.0), (24, -8.0)]},
        'head': {'rx': [(0, 4.0), (8, -6.0), (18, 6.0), (30, -4.0), (40, 4.0)]},
        'wing_L': {'ry': [(0, 0.0), (14, -18.0), (26, -6.0), (40, 0.0)], 'rx': [(0, 0.0), (14, -10.0), (40, 0.0)]},
        'wing_R': {'ry': [(0, 0.0), (24, 14.0), (36, 4.0), (47, 0.0)]},
        'tail': {'rx': [(0, 0.0), (24, -5.0)]},
    })
    # bow: a slow, courteous bow
    clip(p, 'bow', 50, {
        'body': {'rx': [(0, 0.0), (18, 16.0), (32, 16.0), (50, 0.0)]},
        'neck1': {'rx': [(0, 0.0), (18, 6.0), (32, 6.0), (50, 0.0)]},
        'neck2': {'rx': [(0, 0.0), (18, 8.0), (32, 8.0), (50, 0.0)]},
        'head': {'rx': [(0, 0.0), (18, 18.0), (32, 18.0), (50, 0.0)]},
        'wing_L': {'ry': [(0, 0.0), (18, 20.0), (32, 20.0), (50, 0.0)]},
        'tail': {'rx': [(0, 0.0), (18, -15.0), (50, 0.0)]},
        'leg_L': {'rx': [(0, 0.0), (18, -16.0), (32, -16.0), (50, 0.0)]},
    }, loop=False, sym=0)
    # flap: wings beating (flying up to the lamp)
    clip(p, 'flap', 16, {
        'body': {'tz': [(0, 0.0), (4, 0.03), (8, 0.0), (12, -0.02)], 'rx': -8.0},
        'neck1': {'rx': -10.0},
        'wing_L': {'ry': [(0, -40.0), (8, 35.0)]},
        'tail': {'rx': [(0, -6.0), (8, 4.0)]},
        'leg_L': {'rx': 50.0},
    }, sym=0)


def build():
    lib.reset()
    bpy.context.scene.render.fps = 30
    parts = body() + neck_head() + tail() + wings() + legs()
    for ob in parts:
        lib.apply_modifiers(ob)
    arm = lib.armature('crane_rig', bones())
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    for ob in parts:
        lib.set_weights(ob, weight_fn(ob['kind'], segs))
    mesh = lib.join(parts, 'crane')
    lib.bind(mesh, arm)
    return arm, mesh


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    arm, mesh = build()
    author(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        for yaw, name in ((-35, 'front'), (-100, 'side')):
            lib.preview(out.replace('.png', f'_{name}.png'), target=(0, -0.05, 0.75), dist=2.6, yaw=yaw, pitch=8, size=(700, 800), lens=55)
    if '--poses' in argv:
        out = argv[argv.index('--poses') + 1]
        d = os.path.splitext(out)[0]
        os.makedirs(d, exist_ok=True)
        ad = arm.animation_data
        for i, (name, f) in enumerate((('idle', 25), ('talk', 14), ('bow', 22), ('flap', 0), ('flap', 8))):
            act = bpy.data.actions[name]
            ad.action = act
            if hasattr(ad, 'action_slot') and act.slots:
                ad.action_slot = act.slots[0]
            bpy.context.scene.frame_set(f)
            lib.preview(os.path.join(d, f'{i:02d}_{name}_{f}.png'), target=(0, -0.05, 0.75), dist=2.8, yaw=-60, pitch=10, size=(400, 420), lens=50, samples=12)
        ad.action = None
    if '--export' in argv:
        lib.export_glb(os.path.join(lib.MODELS, 'crane.glb'), [arm, mesh])
