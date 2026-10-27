"""
Pip: an origami fox, folded from one sheet of orange paper with a cream underside. Wears a tiny red
knitted collar, the same wool as Ada's scarf.

Blender axes: Z up, Pip faces -Y, its left is +X. About 0.45 m to the tips of its ears.

Run: blender -b -P tools/blender/pip.py [-- --preview out.png] [--poses out.png] [--export]
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

DZ = -0.06
C = {'paper': '#E0782F', 'cream': '#F3E3C4', 'ink': '#1E1A1C', 'collar': '#C8483A', 'eye_hi': '#FFFFFF'}


def M(name):
    return lib.mat('pip_' + name, C[name])


def tag(objs, kind):
    for o in objs if isinstance(objs, list) else [objs]:
        o['kind'] = kind
    return objs if isinstance(objs, list) else [objs]


def loft(name, rings, tip_start=None, tip_end=None, cream=None):
    """Flat-shaded folded paper through rings of points (each ring the same count), optionally
    closing to a point at either end. cream(face centre, normal) picks the underside colour."""
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vr, vr[1:]):
        for k in range(n):
            bm.faces.new([a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]])
    for tip, ring, rev in ((tip_start, vr[0], True), (tip_end, vr[-1], False)):
        if tip is None:
            continue
        t = bm.verts.new(tip)
        for k in range(n):
            f = [ring[k], ring[(k + 1) % n], t]
            bm.faces.new(list(reversed(f)) if rev else f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = lib.link(bpy.data.objects.new(name, me))
    me.materials.append(M('paper'))
    me.materials.append(M('cream'))
    for p in me.polygons:
        p.use_smooth = False
        if cream and cream(p.center, p.normal):
            p.material_index = 1
    return ob


def ring6(y, z, w, h, ridge=1.0):
    """A folded cross-section: sharp spine ridge on top, flat-ish belly."""
    return [Vector(p) for p in ((0, y, z + h * ridge), (w * 0.92, y, z + h * 0.32), (w * 0.7, y, z - h * 0.62),
                                (0, y, z - h), (-w * 0.7, y, z - h * 0.62), (-w * 0.92, y, z + h * 0.32))]


def body():
    rings = [ring6(-0.175, 0.3, 0.05, 0.055), ring6(-0.12, 0.29, 0.075, 0.075), ring6(-0.02, 0.28, 0.08, 0.07, 1.1),
             ring6(0.08, 0.28, 0.078, 0.066, 1.15), ring6(0.16, 0.285, 0.068, 0.06)]
    belly = lambda c, n: n.z < -0.55
    ob = loft('body', rings, tip_start=Vector((0, -0.2, 0.31)), tip_end=Vector((0, 0.2, 0.3)), cream=belly)
    # chest bib: the cream inside of the fold shows at the throat
    neck = [ring6(-0.16, 0.315, 0.045, 0.05), ring6(-0.2, 0.37, 0.04, 0.045)]
    nk = loft('neck', neck, cream=lambda c, n: n.y < -0.3 or n.z < -0.5)
    return tag([ob, nk], 'body')


def head():
    # a triangular mask: broad cheeks tapering to a pointed snout
    back = [Vector(p) for p in ((0, -0.205, 0.44), (0.085, -0.225, 0.37), (0.06, -0.225, 0.31), (0, -0.215, 0.29),
                                (-0.06, -0.225, 0.31), (-0.085, -0.225, 0.37))]
    mid = [Vector(p) for p in ((0, -0.27, 0.41), (0.06, -0.285, 0.355), (0.04, -0.285, 0.315), (0, -0.28, 0.3),
                               (-0.04, -0.285, 0.315), (-0.06, -0.285, 0.355))]
    snout = [Vector(p) for p in ((0, -0.335, 0.37), (0.022, -0.345, 0.345), (0.016, -0.345, 0.325), (0, -0.34, 0.318),
                                 (-0.016, -0.345, 0.325), (-0.022, -0.345, 0.345))]
    cheeks = lambda c, n: c.z < 0.33 or (abs(c.x) > 0.045 and n.y < -0.4 and c.z < 0.36)
    h = loft('head', [back, mid, snout], tip_start=Vector((0, -0.19, 0.36)), tip_end=Vector((0, -0.37, 0.346)), cream=cheeks)
    parts = [h]
    parts.append(lib.ellipsoid('nose', (0, -0.369, 0.347), (0.011, 0.009, 0.009), M('ink'), segs=(12, 8)))
    for s in (1, -1):
        rz = lib_rot(s)
        parts.append(lib.ellipsoid('eye', (s * 0.045, -0.272, 0.375), (0.009, 0.006, 0.013), M('ink'), segs=(12, 8), rot=rz))
        parts.append(lib.ellipsoid('eye_hi', (s * 0.042, -0.278, 0.38), (0.003, 0.002, 0.0035), M('eye_hi'), segs=(8, 6)))
    return tag(parts, 'head')


def lib_rot(s):
    from mathutils import Matrix
    return Matrix.Rotation(s * math.radians(30), 3, 'Z')


def ears():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        base = [Vector((s * 0.03, -0.215, 0.425)), Vector((s * 0.088, -0.225, 0.39)), Vector((s * 0.06, -0.19, 0.41))]
        tip = Vector((s * 0.1, -0.205, 0.53))
        # front face cream (the inside of the ear), back orange
        ob = loft('ear', [base, [b.lerp(tip, 0.55) for b in base]], tip_end=tip, cream=lambda c, n: n.y < -0.2)
        parts += tag(ob, 'ear_' + side)
    return parts


def tail():
    rings, cr = [], []
    pts = [(0.17, 0.28, 0.035), (0.25, 0.31, 0.055), (0.33, 0.35, 0.062), (0.4, 0.4, 0.052), (0.45, 0.445, 0.034)]
    for y, z, r in pts:
        rings.append([Vector(p) for p in ((0, y, z + r), (r * 0.85, y, z), (0, y + r * 0.2, z - r * 0.9), (-r * 0.85, y, z))])
    ob = loft('tail', rings, tip_start=Vector((0, 0.15, 0.27)), tip_end=Vector((0, 0.5, 0.48)), cream=lambda c, n: c.y > 0.39 or n.z < -0.6)
    return tag(ob, 'tail')


def legs():
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        for front, y0, x0 in ((True, -0.12, 0.048), (False, 0.12, 0.052)):
            y1 = y0 + (0.0 if front else 0.02)
            r = []
            for z, w, yy in ((0.2, 0.027, y0), (0.1, 0.02, y1), (0.035, 0.017, y0 - 0.005), (0.01, 0.021, y0 - 0.02)):
                r.append([Vector(p) for p in ((s * x0, yy - w, z), (s * x0 + w, yy, z), (s * x0, yy + w * 0.8, z), (s * x0 - w, yy, z))])
            ob = loft('leg', r, tip_end=Vector((s * x0, y0 - 0.02, 0.0)), cream=lambda c, n: c.z < 0.05)
            parts += tag(ob, ('legF_' if front else 'legB_') + side)
    return parts


def collar():
    # a ring around the neck, perpendicular to it, with a little knot under the chin
    c0 = Vector((0, -0.182, 0.343 + DZ))
    d = Vector((0, -0.04, 0.055)).normalized()
    u = d.cross(Vector((1, 0, 0))).normalized()
    ring = [c0 + Vector((1, 0, 0)) * math.cos(t) * 0.043 + u * math.sin(t) * 0.047 for t in (2 * math.pi * k / 14 for k in range(15))]
    c = lib.tube('collar', ring, [0.009] * 15, M('collar'), sides=8, cap=False, subsurf=0)
    k = lib.ellipsoid('collar_knot', c0 - u * 0.05, (0.015, 0.011, 0.012), M('collar'), segs=(10, 6))
    return tag([c, k], 'collar')


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
    if kind in ('head',):
        return lambda p: {'head': 1.0}
    if kind.startswith('ear'):
        return lambda p: {kind: 1.0}
    if kind == 'body':
        return seg('hips', 'chest', 'neck', power=6.0)
    if kind == 'collar':
        return seg('neck', 'chest')
    if kind == 'tail':
        return seg('hips', 'tail1', 'tail2', 'tail3', power=6.0)
    side = kind[-1]
    if kind.startswith('legF'):
        return seg(f'legF_{side}', f'shinF_{side}', 'chest')
    if kind.startswith('legB'):
        return seg(f'legB_{side}', f'shinB_{side}', 'hips')
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
        'tail1': {'rx': 40.0, 'rz': 30.0}, 'tail2': {'rz': [(0, 30.0), (30, 36.0)]}, 'tail3': {'rz': [(0, 30.0), (30, 40.0)]},
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
    bpy.context.scene.render.fps = 30
    parts = body() + head() + ears() + tail()
    # the body sits lower than it was drawn, on short sturdy legs
    for ob in parts:
        for v in ob.data.vertices:
            v.co.z += DZ
    parts += legs() + collar()
    for ob in parts:
        lib.apply_modifiers(ob)
    arm = lib.armature('pip_rig', bones())
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    for ob in parts:
        lib.set_weights(ob, weight_fn(ob['kind'], segs))
    mesh = lib.join(parts, 'pip')
    lib.bind(mesh, arm)
    return arm, mesh


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    arm, mesh = build()
    author(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        for yaw, name in ((-35, 'front'), (140, 'back'), (-90, 'side')):
            lib.preview(out.replace('.png', f'_{name}.png'), target=(0, 0.05, 0.2), dist=1.2, yaw=yaw, pitch=12, size=(800, 600), lens=55)
    if '--poses' in argv:
        out = argv[argv.index('--poses') + 1]
        d = os.path.splitext(out)[0]
        os.makedirs(d, exist_ok=True)
        ad = arm.animation_data
        for i, (name, f) in enumerate((('idle', 30), ('trot', 0), ('trot', 4), ('run', 0), ('run', 6), ('sit', 0), ('talk', 6), ('hop', 4))):
            act = bpy.data.actions[name]
            ad.action = act
            if hasattr(ad, 'action_slot') and act.slots:
                ad.action_slot = act.slots[0]
            bpy.context.scene.frame_set(f)
            lib.preview(os.path.join(d, f'{i:02d}_{name}_{f}.png'), target=(0, 0.05, 0.2), dist=1.35, yaw=-70, pitch=10,
                        size=(400, 320), lens=50, samples=12)
        ad.action = None
    if '--export' in argv:
        lib.export_glb(os.path.join(lib.MODELS, 'pip.glb'), [arm, mesh])
