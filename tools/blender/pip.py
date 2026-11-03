"""
Pip: an origami fox, folded from one sheet of orange paper with a cream underside. Wears a tiny red
knitted collar, the same wool as Ada's scarf.

The fox is sculpted as a living animal first (sdf.py: a deep chest and slim waist, haunches, a ruff
of cheek fur, a pointed snout, big ears, a brush of a tail, legs growing out of the body) and then
folded: the surface is reduced to a few thousand flat facets, mirror-symmetric, so it reads as one
sheet of creased paper. The cream side shows facet by facet where a fox is pale.

Blender axes: Z up, Pip faces -Y, its left is +X. About 0.45 m to the tips of its ears.

Run: blender -b -P tools/blender/pip.py [-- --preview out.png] [--poses out.png] [--export]
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import figure  # noqa: E402
import lib  # noqa: E402
import sdf  # noqa: E402
from figure import on  # noqa: E402
from sdf import V, cone, ellipsoid, intersect, subtract, torus, tube, union  # noqa: E402

DZ = -0.06
C = {'paper': '#E0782F', 'cream': '#F3E3C4', 'ink': '#1E1A1C', 'collar': '#C8483A', 'eye_hi': '#FFFFFF'}
FIG = figure.Figure('pip', C)
M = FIG.M


def fox():
    """The whole animal but its ears, in its final place (DZ included)."""
    body = union(ellipsoid((0, -0.095, 0.228), (0.06, 0.085, 0.068)), ellipsoid((0, 0.095, 0.222), (0.054, 0.075, 0.058)), k=0.06)
    body = union(body, ellipsoid((0, 0.0, 0.232), (0.052, 0.11, 0.054)), k=0.04)
    # a tucked-up belly behind the ribs
    body = subtract(body, ellipsoid((0, 0.04, 0.13), (0.09, 0.07, 0.04)), k=0.035)
    body = union(body, ellipsoid((0, -0.168, 0.212), (0.044, 0.04, 0.052)), k=0.03)      # the bib of the chest
    body = union(body, cone((0, -0.14, 0.245), (0, -0.2, 0.292), 0.046, 0.04), k=0.03)   # neck
    head = union(ellipsoid((0, -0.235, 0.315), (0.06, 0.058, 0.052)),
                 sdf.mirror_x(ellipsoid((0.05, -0.243, 0.288), (0.034, 0.03, 0.026), sdf.rot(0, -20, 15))), k=0.025)
    head = union(head, cone((0, -0.262, 0.303), (0, -0.348, 0.286), 0.028, 0.0105), k=0.02)
    body = union(body, head, k=0.025)
    legs = []
    for s in (1, -1):
        legs.append(union(tube([(s * 0.042, -0.115, 0.215), (s * 0.046, -0.122, 0.11), (s * 0.047, -0.13, 0.03)], [0.027, 0.0155, 0.013]),
                          ellipsoid((s * 0.047, -0.142, 0.013), (0.016, 0.025, 0.013)), k=0.01))
        hind = union(ellipsoid((s * 0.042, 0.105, 0.19), (0.034, 0.055, 0.055)),
                     tube([(s * 0.05, 0.13, 0.17), (s * 0.052, 0.152, 0.1), (s * 0.052, 0.125, 0.03)], [0.024, 0.015, 0.013]), k=0.02)
        legs.append(union(hind, ellipsoid((s * 0.052, 0.112, 0.013), (0.016, 0.025, 0.013)), k=0.01))
    body = union(body, *legs, k=0.022)
    # a brush of a tail, swept up in a curve
    tail = tube([(0, 0.165, 0.228), (0, 0.235, 0.236), (0, 0.31, 0.262), (0, 0.385, 0.315), (0, 0.44, 0.38), (0, 0.475, 0.44), (0, 0.485, 0.48)],
                [0.024, 0.042, 0.058, 0.06, 0.05, 0.03, 0.004])
    return union(body, tail, k=0.02)


def cream(c, n):
    """Where the paper's cream side shows: chest and throat, belly, muzzle and cheeks, paws, the tip of the tail."""
    x, y, z = c
    if z < 0.035:
        return True                                         # paws
    if y > 0.43:
        return True                                         # tail tip
    if n.z < -0.5 and -0.2 < y < 0.16:
        return True                                         # belly
    if y < -0.13 and n.y < -0.25 and 0.165 < z < 0.27 and abs(x) < 0.045:
        return True                                         # bib
    if y < -0.25 and z < 0.293:
        return True                                         # under the muzzle
    if y < -0.215 and abs(x) > 0.05 and z < 0.3:
        return True                                         # cheek ruffs
    return False


def paper(ob, pick):
    """Fold the sculpt flat: one normal per facet, orange or cream by facet."""
    me = ob.data
    me.materials.clear()
    me.materials.append(M('paper'))
    me.materials.append(M('cream'))
    for poly in me.polygons:
        poly.use_smooth = False
        poly.material_index = 1 if pick(poly.center, poly.normal) else 0


def ear(s, side):
    base, tip = V((s * 0.04, -0.222, 0.345)), V((s * 0.09, -0.207, 0.458))
    a = (tip - base) / np.linalg.norm(tip - base)
    f = V((s * 0.3, -1.0, 0.15))
    n = f - a * np.dot(a, f)
    n /= np.linalg.norm(n)
    outer = intersect(cone(base, tip, 0.034, 0.003), lambda P: np.abs((P - base) @ n) - 0.0075, k=0.002)
    # the front is hollowed out, a rim of paper round a cream inside
    e = subtract(outer, cone(base - n * 0.0085 + a * 0.012, tip - n * 0.0075 - a * 0.012, 0.024, 0.0015), k=0.003)
    ob = FIG.part(f'ear_{side}', e, np.minimum(base, tip) - 0.05, np.maximum(base, tip) + 0.05, 0.0009, 'paper', f'ear_{side}', 120, False)
    paper(ob, lambda c, nn: nn.dot(Vector(tuple(-n))) > 0.45)


def face(head_f):
    for s, side in ((1, 'L'), (-1, 'R')):
        p = on(head_f, (s * 0.033, -0.4, 0.323), (0, 1, 0), lift=-0.001)
        R = figure.frame_on(head_f, p) @ sdf.rot(0, s * 18, 0)
        FIG.part(f'eye_{side}', ellipsoid(p, (0.0088, 0.0035, 0.0122), R), p - 0.03, p + 0.03, 0.0004, 'ink', 'head', 160)
        g = p + R @ V((s * 0.0028, -0.0028, 0.0042))
        FIG.part(f'eyehi_{side}', ellipsoid(g, (0.0026, 0.0012, 0.003), R), g - 0.02, g + 0.02, 0.0003, 'eye_hi', 'head', 60)
    nose = V((0, -0.356, 0.288))
    FIG.part('nose', ellipsoid(nose, (0.0105, 0.009, 0.0085)), nose - 0.03, nose + 0.03, 0.0005, 'ink', 'head', 160)


def collar():
    """A ring of red wool round the neck, ribbed, knotted under the chin with a little tassel."""
    c0 = V((0, -0.17, 0.262))
    d = V((0, -0.06, 0.047))
    d /= np.linalg.norm(d)
    R = sdf.frame(d)
    ring = torus(c0, 0.044, 0.0085, R)
    ring = sdf.displace(ring, lambda P: 0.0011 * np.abs(np.sin(np.arctan2(*((P - c0) @ R)[:, :2].T[::-1]) * 14)))
    # (the knot sits at the side of the neck: under the chin it looked like an open mouth)
    knot = c0 + R @ V((0.04, -0.03, 0.004))
    w = union(ring, ellipsoid(knot, (0.013, 0.01, 0.01)), k=0.004)
    FIG.part('collar', w, c0 - 0.08, c0 + 0.08, 0.0007, 'collar', 'collar', 1400)


def bones():
    z = DZ
    B = [('hips', (0, 0.13, 0.27 + z), (0, 0.0, 0.28 + z), None),
         ('chest', (0, 0.0, 0.28 + z), (0, -0.15, 0.3 + z), 'hips'),
         ('neck', (0, -0.15, 0.3 + z), (0, -0.2, 0.36 + z), 'chest'),
         ('head', (0, -0.2, 0.36 + z), (0, -0.36, 0.35 + z), 'neck'),
         ('tail1', (0, 0.16, 0.28 + z), (0, 0.27, 0.32 + z), 'hips'),
         ('tail2', (0, 0.27, 0.32 + z), (0, 0.37, 0.385 + z), 'tail1'),
         ('tail3', (0, 0.37, 0.385 + z), (0, 0.48, 0.46 + z), 'tail2')]
    for s, side in ((1, 'L'), (-1, 'R')):
        B += [(f'ear_{side}', (s * 0.065, -0.21, 0.41 + z), (s * 0.1, -0.205, 0.53 + z), 'head'),
              (f'legF_{side}', (s * 0.048, -0.12, 0.2), (s * 0.048, -0.12, 0.1), 'chest'),
              (f'shinF_{side}', (s * 0.048, -0.12, 0.1), (s * 0.048, -0.13, 0.01), f'legF_{side}'),
              (f'legB_{side}', (s * 0.052, 0.12, 0.2), (s * 0.052, 0.14, 0.1), 'hips'),
              (f'shinB_{side}', (s * 0.052, 0.14, 0.1), (s * 0.052, 0.12, 0.01), f'legB_{side}')]
    return B


BODY = ['hips', 'chest', 'neck', 'head', 'tail1', 'tail2', 'tail3'] + [
    f'{b}_{s}' for s in 'LR' for b in ('ear', 'legF', 'shinF', 'legB', 'shinB')]
PARENT = {'chest': 'hips', 'neck': 'chest', 'head': 'neck', 'tail1': 'hips', 'tail2': 'tail1', 'tail3': 'tail2'}
for _s in 'LR':
    PARENT.update({f'ear_{_s}': 'head', f'legF_{_s}': 'chest', f'shinF_{_s}': f'legF_{_s}', f'legB_{_s}': 'hips',
                   f'shinB_{_s}': f'legB_{_s}'})


def weight_fn(kind, segs):
    def seg(*names, power=8.0):
        sub = {n: segs[n] for n in names}
        return lambda p: lib.dist_weights(p, sub, None, power)
    if kind == 'head':
        return lambda p: {'head': 1.0}
    if kind.startswith('ear'):
        return lambda p: {kind: 1.0}
    if kind == 'collar':
        return seg('neck', 'chest')
    if kind == 'fox':
        bones = [b for b in BODY if not b.startswith('ear')]
        each = seg(*bones, power=9.0)

        def w(p):
            # the head is rigid from just behind the cheeks forwards
            h = lib.smooth01(-0.19, -0.215, p.y) * lib.smooth01(0.255, 0.275, p.z)
            out = {b: v * (1 - h) for b, v in each(p).items()} if h < 1 else {}
            s = sum(out.values())
            if s > 0:
                out = {b: v / s * (1 - h) for b, v in out.items()}
            out['head'] = out.get('head', 0.0) + h
            return out
        return w
    raise ValueError(kind)


def clip(p, name, N, ch, loop=True, sym=None):
    lib.clip(p, name, N, ch, BODY, PARENT, loop=loop, sym=sym)


def author(arm):
    p = lib.Poser(arm)
    # idle: standing, tail swishing, ears flicking, a curious head tilt
    clip(p, 'idle', 80, {
        'hips': {'tz': [(0, 0.0), (40, -0.004)]},
        'chest': {'rx': [(0, 0.0), (40, 2.0)]},
        'neck': {'rx': [(0, -4.0), (40, -2.0)]},
        'head': {'ry': [(0, 0.0), (20, 0.0), (28, 14.0), (52, 14.0), (60, 0.0)], 'rz': [(0, 4.0), (40, -6.0)]},
        'ear_L': {'rx': [(0, 0.0), (44, 0.0), (46, -18.0), (50, 0.0)]},
        'ear_R': {'rx': [(0, 0.0), (64, 0.0), (66, -18.0), (70, 0.0)]},
        'tail1': {'rz': [(0, -14.0), (40, 14.0)], 'rx': [(0, -6.0), (20, -2.0), (40, -6.0), (60, -2.0)]},
        'tail2': {'rz': [(8, -12.0), (48, 12.0)]},
        'tail3': {'rz': [(14, -14.0), (54, 14.0)]},
    })
    # trot: diagonal pairs (front-left with back-right), 16 frames
    clip(p, 'trot', 16, {
        'hips': {'tz': [(0, -0.008), (4, 0.006), (8, -0.008), (12, 0.006)], 'ry': [(0, 3.0), (8, -3.0)]},
        'chest': {'rz': [(0, -3.0), (8, 3.0)]},
        'neck': {'rx': [(2, -3.0), (6, 2.0), (10, -3.0), (14, 2.0)]},
        'head': {'rx': [(2, 3.0), (6, -2.0), (10, 3.0), (14, -2.0)]},
        'legF_L': {'rx': [(0, -28.0), (8, 22.0)]},
        'shinF_L': {'rx': [(0, 0.0), (8, 0.0), (11, 40.0), (14, 20.0)]},
        'legB_L': {'rx': [(0, 26.0), (8, -24.0)]},
        'shinB_L': {'rx': [(0, 0.0), (3, -35.0), (6, -15.0), (8, 0.0)]},
        'tail1': {'rx': [(0, -10.0), (4, -4.0), (8, -10.0), (12, -4.0)], 'rz': [(0, 8.0), (8, -8.0)]},
        'tail2': {'rx': [(2, -8.0), (6, 4.0), (10, -8.0), (14, 4.0)]},
        'tail3': {'rx': [(3, -8.0), (7, 6.0), (11, -8.0), (15, 6.0)]},
        'ear_L': {'rx': [(0, 6.0), (8, 0.0)]},
    }, sym=8)
    # run: a bounding gallop, the spine folding and stretching, 12 frames
    clip(p, 'run', 12, {
        'hips': {'tz': [(0, 0.0), (3, 0.04), (6, 0.01), (9, -0.01)], 'rx': [(0, 8.0), (3, 0.0), (6, -10.0), (9, 0.0)]},
        'chest': {'rx': [(0, -10.0), (3, 0.0), (6, 14.0), (9, 0.0)]},
        'neck': {'rx': [(0, 6.0), (6, -8.0)]},
        'head': {'rx': [(0, -6.0), (6, 6.0)]},
        'legF_L': {'rx': [(0, -45.0), (3, -10.0), (6, 40.0), (9, 10.0)]},
        'legF_R': {'rx': [(1, -45.0), (4, -10.0), (7, 40.0), (10, 10.0)]},
        'shinF_L': {'rx': [(0, 0.0), (6, 0.0), (8, 60.0), (10, 30.0)]},
        'shinF_R': {'rx': [(1, 0.0), (7, 0.0), (9, 60.0), (11, 30.0)]},
        'legB_L': {'rx': [(0, 40.0), (3, 10.0), (6, -50.0), (9, -10.0)]},
        'legB_R': {'rx': [(1, 40.0), (4, 10.0), (7, -50.0), (10, -10.0)]},
        'shinB_L': {'rx': [(0, -10.0), (3, -50.0), (6, -20.0), (9, -5.0)]},
        'shinB_R': {'rx': [(1, -10.0), (4, -50.0), (7, -20.0), (10, -5.0)]},
        'tail1': {'rx': [(0, -20.0), (6, 0.0)]},
        'tail2': {'rx': [(2, -12.0), (8, 6.0)]},
        'tail3': {'rx': [(3, -12.0), (9, 8.0)]},
        'ear_L': {'rx': 20.0}, 'ear_R': {'rx': 20.0},
    })
    # sit: haunches down, front legs straight, tail curled round the paws
    clip(p, 'sit', 60, {
        'hips': {'tz': -0.05, 'ty': 0.04, 'rx': -38.0},
        'chest': {'rx': [(0, -6.0), (30, -8.0)]},
        'neck': {'rx': 10.0},
        'head': {'rx': [(0, 26.0), (30, 24.0)], 'rz': [(0, 6.0), (30, -6.0)], 'ry': [(0, 0.0), (36, 8.0), (52, 0.0)]},
        'legF_L': {'ax': [(0, 2.0), (30, 3.0)]}, 'shinF_L': {'ax': 0.0},
        'legB_L': {'ax': -70.0, 'ry': -10.0}, 'shinB_L': {'ax': 95.0},
        # the brush down on the ground behind, curling round towards the front paws
        'tail1': {'rx': -22.0, 'rz': 34.0}, 'tail2': {'rx': -8.0, 'rz': [(0, 36.0), (30, 42.0)]},
        'tail3': {'rx': -4.0, 'rz': [(0, 36.0), (30, 46.0)]},
        'ear_L': {'rx': [(0, 0.0), (40, 0.0), (42, -16.0), (46, 0.0)]},
    }, sym=0)
    # talk: lively nods and ear wiggles while speaking
    clip(p, 'talk', 30, {
        'neck': {'rx': [(0, -4.0), (8, 4.0), (15, -6.0), (23, 2.0)]},
        'head': {'rx': [(0, -2.0), (6, 6.0), (13, -4.0), (21, 4.0)], 'rz': [(0, 6.0), (15, -8.0)], 'ry': [(0, -6.0), (15, 6.0)]},
        'ear_L': {'rx': [(0, 0.0), (5, -14.0), (11, 4.0), (18, -10.0), (25, 2.0)]},
        'ear_R': {'rx': [(3, 0.0), (8, -12.0), (14, 4.0), (21, -10.0), (28, 2.0)]},
        'tail1': {'rz': [(0, -16.0), (15, 16.0)], 'rx': -8.0},
        'tail2': {'rz': [(5, -14.0), (20, 14.0)]},
    })
    # hop: a springy leap (crouch, stretch, tuck)
    clip(p, 'hop', 14, {
        'hips': {'tz': [(0, -0.04), (4, 0.03), (10, 0.0)], 'rx': [(0, 10.0), (4, -16.0), (10, 6.0), (14, 0.0)]},
        'chest': {'rx': [(0, 6.0), (4, -8.0), (10, 6.0)]},
        'legF_L': {'rx': [(0, 20.0), (4, -50.0), (10, -20.0), (14, 0.0)]},
        'shinF_L': {'rx': [(0, -10.0), (4, 30.0), (10, 50.0), (14, 0.0)]},
        'legB_L': {'rx': [(0, -30.0), (4, 50.0), (10, 10.0), (14, 0.0)]},
        'shinB_L': {'rx': [(0, 30.0), (4, 0.0), (10, -40.0), (14, 0.0)]},
        'tail1': {'rx': [(0, 10.0), (4, -25.0), (12, 0.0)]},
    }, loop=False, sym=0)


def build():
    lib.reset()
    FIG.parts.clear()
    bpy.context.scene.render.fps = 30
    f = fox()
    body = FIG.part('fox', f, (-0.12, -0.4, -0.01), (0.12, 0.53, 0.5), 0.0018, 'paper', 'fox', 1300, symmetric=True)
    paper(body, cream)
    for s, side in ((1, 'L'), (-1, 'R')):
        ear(s, side)
    face(f)
    collar()
    ao = sdf.bake_ao([o for o in FIG.parts if o.name not in ('eyehi_L', 'eyehi_R')], distance=0.05, samples=48)
    figure.paint(FIG.parts, lambda p, k, m: (1.0, 1.0, 1.0), ao, no_ao=('pip_ink', 'pip_eye_hi'))
    arm = lib.armature('pip_rig', bones())
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    for ob in FIG.parts:
        lib.set_weights(ob, weight_fn(ob['kind'], segs))
    mesh = lib.join(FIG.parts, 'pip')
    lib.bind(mesh, arm)
    print('pip:', sum(len(p.vertices) - 2 for p in mesh.data.polygons), 'tris')
    return arm, mesh


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    arm, mesh = build()
    author(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        figure.rest_pose(arm)
        for yaw, name in ((-35, 'front'), (140, 'back'), (-90, 'side'), (0, 'face')):
            lib.preview(out.replace('.png', f'_{name}.png'), target=(0, 0.05, 0.2), dist=1.2, yaw=yaw, pitch=12, size=(800, 600), lens=55)
    if '--poses' in argv:
        out = argv[argv.index('--poses') + 1]
        d = os.path.splitext(out)[0]
        os.makedirs(d, exist_ok=True)
        ad = arm.animation_data
        shots = [(n, int(f)) for n, f in (s.split(':') for s in os.environ.get('SHOTS', '').split(',') if s)] or [
            ('idle', 30), ('trot', 0), ('trot', 4), ('run', 0), ('run', 6), ('sit', 0), ('talk', 6), ('hop', 4)]
        yaw = float(os.environ.get('YAW', -70))
        for i, (name, f) in enumerate(shots):
            act = bpy.data.actions[name]
            ad.action = act
            if hasattr(ad, 'action_slot') and act.slots:
                ad.action_slot = act.slots[0]
            bpy.context.scene.frame_set(f)
            lib.preview(os.path.join(d, f'{i:02d}_{name}_{f}.png'), target=(0, 0.05, 0.2), dist=1.35, yaw=yaw, pitch=10,
                        size=(400, 320), lens=50, samples=12)
        ad.action = None
    if '--export' in argv:
        figure.rest_pose(arm)
        lib.export_glb(os.path.join(lib.MODELS, 'pip.glb'), [arm, mesh])
