"""
The Keeper: an old paper crane who tends the lighthouse. Folded white paper with pale blue inside
folds, round brass spectacles, tufted paper brows and a little blue fisherman's cap.

Sculpted then folded, like Pip (sdf.py, figure.py): a teardrop body, a long S of a neck, a slim head
and beak and a spiked tail as one sheet reduced to flat facets; wings cut from paper with a raised
crease down each and a trailing edge of folded feather points; long jointed legs with toes.

Blender axes: Z up, the crane faces -Y. About 1.35 m to the top of its head.

Run: blender -b -P tools/blender/crane.py [-- --preview out.png] [--poses out.png] [--export]
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
from sdf import V, cone, cylinder, ellipsoid, intersect, sphere, torus, tube, union  # noqa: E402

C = {'paper': '#F2EEE6', 'inside': '#A9C4DE', 'ink': '#1E1A1C', 'brass': '#B8963E', 'cap': '#2F4E78', 'leg': '#D9D2C2',
     'eye_hi': '#FFFFFF'}
FIG = figure.Figure('crane', C)
M = FIG.M


def fold(ob, pick, inside='inside'):
    """Flat facets, white or the pale blue inside of the paper by facet."""
    me = ob.data
    first = me.materials[0]
    me.materials.clear()
    me.materials.append(first)
    me.materials.append(M(inside))
    for poly in me.polygons:
        poly.use_smooth = False
        poly.material_index = 1 if pick(poly.center, poly.normal) else 0


def bird():
    """Body, neck, head and tail: one sheet."""
    body = union(ellipsoid((0, 0.01, 0.8), (0.12, 0.2, 0.105)), ellipsoid((0, -0.1, 0.792), (0.1, 0.1, 0.1)), k=0.04)
    # a folded keel underneath and a ridge along the back, the way a paper crane's body is creased
    body = intersect(body, lambda P: np.abs(P[:, 0]) * 0.55 + (0.705 - P[:, 2]) * 1.0 - 0.02, k=0.02)
    neck = tube([(0, -0.13, 0.84), (0, -0.2, 0.92), (0, -0.26, 1.03), (0, -0.32, 1.15), (0, -0.38, 1.25), (0, -0.412, 1.3)],
                [0.05, 0.033, 0.027, 0.024, 0.022, 0.023])
    head = union(ellipsoid((0, -0.427, 1.316), (0.038, 0.05, 0.037)), cone((0, -0.46, 1.304), (0, -0.635, 1.234), 0.017, 0.0018), k=0.012)
    tail = intersect(cone((0, 0.14, 0.835), (0, 0.47, 1.21), 0.07, 0.004), lambda P: np.abs(P[:, 0]) - 0.022, k=0.008)
    return union(union(body, neck, k=0.03), head, tail, k=0.02)


def wing(s, side):
    """A wing cut from the sheet: a raised crease along it and folded feather points behind."""
    root, tip = V((s * 0.05, 0.0, 0.9)), V((s * 0.62, 0.06, 1.12))
    a = (tip - root) / np.linalg.norm(tip - root)
    c = V((0, 1, 0)) - a * a[1]
    c /= np.linalg.norm(c)
    n = np.cross(a, c)
    L = np.linalg.norm(tip - root)
    outline = [(0.0, -0.12), (0.16, -0.112), (0.34, -0.075), (0.5, -0.025), (L, 0.0), (0.56, 0.085), (0.5, 0.06),
               (0.47, 0.17), (0.41, 0.11), (0.37, 0.215), (0.31, 0.14), (0.26, 0.235), (0.2, 0.155), (0.13, 0.22), (0.07, 0.15), (0.0, 0.17)]
    shape = sdf.polygon2d(outline)

    def f(P):
        q = P - root
        u, v, w = q @ a, q @ c, q @ n
        crease = 0.03 * np.maximum(0.0, 1.0 - np.abs(v - 0.02) / 0.16) * np.minimum(1.0, u / 0.08) * np.maximum(0.0, 1.0 - u / L)
        return np.maximum(np.abs(w - crease) - 0.0035, shape(u, v))
    ob = FIG.part(f'wing_{side}', f, np.minimum(root, tip) - 0.2, np.maximum(root, tip) + 0.2, 0.0022, 'paper', f'wing_{side}', 500)
    up = Vector(tuple(n * np.sign(n[2])))
    fold(ob, lambda cc, nn: nn.dot(up) < -0.2)


def legs():
    for s, side in ((1, 'L'), (-1, 'R')):
        x = s * 0.05
        leg = tube([(s * 0.04, 0.0, 0.72), (s * 0.044, 0.012, 0.52), (x, 0.035, 0.34), (s * 0.055, 0.012, 0.18), (s * 0.06, 0.0, 0.03)],
                   [0.024, 0.0115, 0.01, 0.0085, 0.008])
        leg = union(leg, sphere((x, 0.035, 0.34), 0.0135), k=0.01)
        foot = V((s * 0.06, 0.0, 0.026))
        toes = [cone(foot, foot + V((np.sin(t) * 0.09, -np.cos(t) * 0.09, -0.018)), 0.0085, 0.0025) for t in (-0.5, 0.0, 0.5)]
        toes.append(cone(foot, foot + V((0, 0.05, -0.016)), 0.007, 0.0025))
        leg = union(leg, *toes, k=0.006)
        ob = FIG.part(f'leg_{side}', leg, (x - 0.12, -0.12, -0.01), (x + 0.12, 0.1, 0.76), 0.0016, 'leg', f'leg_{side}', 700)
        fold(ob, lambda cc, nn: False)


def head_details(f):
    eyes = {}
    for s, side in ((1, 'L'), (-1, 'R')):
        p = on(f, (s * 0.024, -0.56, 1.328), (0, 1, 0), lift=-0.0008)
        R = figure.frame_on(f, p)
        eyes[s] = (p, R)
        FIG.part(f'eye_{side}', ellipsoid(p, (0.0058, 0.0028, 0.0068), R), p - 0.02, p + 0.02, 0.0003, 'ink', 'head', 120)
        g = p + R @ V((0.0016 * s, -0.0024, 0.0022))
        FIG.part(f'eyehi_{side}', sphere(g, 0.0016), g - 0.01, g + 0.01, 0.0002, 'eye_hi', 'head', 40)
        # bushy old-bird brows: a folded paper tuft over each eye
        b0 = p + R @ V((0.0, -0.004, 0.009))
        brow = intersect(cone(b0, b0 + V((s * 0.03, 0.012, 0.022)), 0.0075, 0.0015), lambda P, b0=b0: np.abs((P - b0) @ R[:, 1]) - 0.0025, k=0.001)
        ob = FIG.part(f'brow_{side}', brow, b0 - 0.05, b0 + 0.05, 0.0005, 'paper', 'head', 80)
        fold(ob, lambda cc, nn: False)
    # round brass spectacles on the beak, arms back to the sides of the head
    rims = []
    centres = {}
    for s in (1, -1):
        p, R = eyes[s]
        nrm = -R[:, 1]
        c = p + nrm * 0.009 + V((0, -0.004, 0))
        centres[s] = c
        rims.append(torus(c, 0.0135, 0.0017, sdf.frame(nrm)))
        rims.append(tube([c + V((s * 0.0134, 0.002, 0.0)), V((s * 0.036, -0.415, 1.322))], [0.0013, 0.0013]))
    bridge = tube([centres[1] + V((-0.0125, 0.0, 0.004)), V((0, -0.476, 1.33)), centres[-1] + V((0.0125, 0.0, 0.004))], [0.0015, 0.0016, 0.0015])
    FIG.part('spectacles', union(*rims, bridge, k=0.001), V((0, -0.44, 1.32)) - 0.08, V((0, -0.44, 1.32)) + 0.08, 0.0005, 'brass', 'head', 1200)
    # a little blue fisherman's cap, tipped forward
    top = V((0, -0.42, 1.357))
    R = sdf.rot(-8, 0, 0)
    crown = intersect(ellipsoid(top, (0.036, 0.04, 0.02), R), lambda P: (top[2] - 0.006) - P[:, 2], k=0.004)
    band = torus(top + V((0, 0.0, -0.005)), 0.0345, 0.0045, R)
    brim = intersect(cylinder(top + V((0, -0.022, -0.008)), 0.034, 0.002, 0.0012, R @ sdf.rot(12, 0, 0)), lambda P: P[:, 1] - (top[1] - 0.02), k=0.003)
    cap = union(crown, band, brim, k=0.003)
    cap = union(cap, sphere(top + V((0, 0.003, 0.019)), 0.0045), k=0.003)
    FIG.part('cap', cap, top - 0.09, top + 0.09, 0.0008, 'cap', 'head', 1500)


def build():
    lib.reset()
    FIG.parts.clear()
    bpy.context.scene.render.fps = 30
    f = bird()
    ob = FIG.part('crane', f, (-0.16, -0.66, 0.6), (0.16, 0.5, 1.4), 0.0024, 'paper', 'crane', 1100, symmetric=True)
    fold(ob, lambda c, n: n.z < -0.45 and c.z < 0.85)
    for s, side in ((1, 'L'), (-1, 'R')):
        wing(s, side)
    legs()
    head_details(f)
    ao = sdf.bake_ao(list(FIG.parts), distance=0.08, samples=48)
    figure.paint(FIG.parts, lambda p, k, m: (1.0, 1.0, 1.0), ao, no_ao=('crane_ink', 'crane_eye_hi', 'crane_brass'))
    arm = lib.armature('crane_rig', bones())
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    for ob in FIG.parts:
        lib.set_weights(ob, weight_fn(ob['kind'], segs))
    mesh = lib.join(FIG.parts, 'crane')
    lib.bind(mesh, arm)
    print('crane:', sum(len(p.vertices) - 2 for p in mesh.data.polygons), 'tris')
    return arm, mesh


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
    if kind == 'crane':
        each = lambda p: lib.dist_weights(p, {n: segs[n] for n in ('body', 'neck1', 'neck2', 'head', 'tail')}, {'body': 0.8}, 7.0)  # noqa: E731

        def w(p):
            # the head and beak are rigid
            h = lib.smooth01(-0.385, -0.41, p.y) * lib.smooth01(1.26, 1.285, p.z)
            out = each(p)
            s = sum(out.values())
            out = {b: v / s * (1 - h) for b, v in out.items()}
            out['head'] = out.get('head', 0.0) + h
            return out
        return w
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


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    arm, mesh = build()
    author(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        figure.rest_pose(arm)
        for yaw, name in ((-35, 'front'), (-100, 'side'), (150, 'back')):
            lib.preview(out.replace('.png', f'_{name}.png'), target=(0, -0.05, 0.75), dist=2.6, yaw=yaw, pitch=8, size=(700, 800), lens=55)
        lib.preview(out.replace('.png', '_head.png'), target=(0, -0.46, 1.31), dist=0.42, yaw=-35, pitch=6, size=(700, 800), lens=55)
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
        figure.rest_pose(arm)
        lib.export_glb(os.path.join(lib.MODELS, 'crane.glb'), [arm, mesh])

