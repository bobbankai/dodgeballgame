"""
Shared pieces for sculpting characters with sdf.py: a Figure collects the sculpted parts (one
material each), and there are helpers for placing details on a surface, eyes with a painted iris,
hands, painting (hand-painted tint times baked occlusion) and the rest pose.
"""
import math

import bpy
import numpy as np

import lib
import sdf
from sdf import V, box, cone, tube, union


class Figure:
    def __init__(self, prefix, palette):
        self.prefix = prefix
        self.palette = palette
        self.parts = []

    def M(self, name):
        return lib.mat(f'{self.prefix}_{name}', self.palette[name], vcol=True)

    def part(self, name, f, lo, hi, step, mname, kind, tris):
        """Sculpt a field into a part of this figure."""
        ob = sdf.sculpt(name, f, lo, hi, step, self.M(mname), tris)
        return self.add(ob, kind)

    def add(self, ob, kind):
        ob['kind'] = kind
        self.parts.append(ob)
        print(f'  {ob.name}: {sum(len(p.vertices) - 2 for p in ob.data.polygons)} tris')
        return ob

    def tag(self, objs, kind):
        for o in objs:
            self.add(o, kind)
        return objs


def tri(x):
    """Triangle wave, period 1, 0 at integers and 1 at half-integers."""
    return 1.0 - np.abs(2.0 * (x - np.floor(x)) - 1.0)


def on(f, p, d, lift=0.0):
    """March from p (outside) along d onto f's surface, then lift the point back off it by `lift`."""
    p, d = V(p), V(d) / np.linalg.norm(d)
    a, t = 0.0, 0.0
    while t < 0.6:
        v = f(np.array([p + d * t]))[0]
        if v < 0:
            break
        a = t
        t += max(v * 0.8, 0.0003)
    else:
        raise ValueError(f'no surface from {p} along {d}')
    b = t
    for _ in range(40):
        m = (a + b) / 2
        if f(np.array([p + d * m]))[0] < 0:
            b = m
        else:
            a = m
    return p + d * ((a + b) / 2 - lift)


def normal(f, p, e=1e-4):
    p = V(p)
    g = np.array([f(np.array([p + np.eye(3)[i] * e]))[0] - f(np.array([p - np.eye(3)[i] * e]))[0] for i in range(3)])
    return g / np.linalg.norm(g)


def frame_on(f, p):
    """Rotation at surface point p: local X along the surface (horizontal), Y into it, Z up it."""
    n = normal(f, p)
    t = np.cross(V((0, 0, 1)), n)
    t /= np.linalg.norm(t)
    return np.stack([t, -n, np.cross(t, -n)], axis=1)


def rot_toward(v, to, ang):
    """Rotate unit vector v towards `to` by ang degrees (in their common plane)."""
    a = math.radians(ang)
    t = to - v * np.dot(v, to)
    t /= np.linalg.norm(t)
    return v * math.cos(a) + t * math.sin(a)


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length, t


# --- eyes ------------------------------------------------------------------------------------------

def eye_frame(base, x, z, sink):
    """An eye is a shallow dome on the face at (x, z), facing along the face's own normal there,
    its centre `sink` under the skin."""
    p = on(base, (x, -0.4, z), (0, 1, 0))
    R = frame_on(base, p)
    return p + R[:, 1] * sink, R


def iris_disc(fig, name, E, R, eye_r, ic, iris, pupil, kind, lift=0.0009, mname='iris'):
    """The iris as a regular polar grid laid onto the eye (an ellipsoid at E, radii eye_r, frame R)
    just above the white: rings meet exactly at the pupil's edge, so a pupil painted by vertex colour
    is crisp, and there is no geometry edge inside the eye for the ink lines to catch."""
    rings = [0.0, 0.14, 0.28, 0.42, pupil - 0.006, pupil + 0.006, 0.64, 0.75, 0.85, 0.93, 1.0]
    rings = sorted(set(rings))
    segs = 56
    radii = V(eye_r) + lift
    Rt = R.T
    dv = Rt @ V((0, 1, 0))
    A = np.sum((dv / radii) ** 2)

    def hit(x, z):
        o = Rt @ (V((x, E[1] - 0.1, z)) - E)
        B = 2 * np.sum(o * dv / radii ** 2)
        disc = B * B - 4 * A * (np.sum((o / radii) ** 2) - 1)
        return None if disc < 0 else (-B - math.sqrt(disc)) / (2 * A)

    def reach(a):
        """How far out the iris can go in direction a before it would leave the eye: an iris
        bigger than the eye is clipped by the lids, the way a relaxed eye looks."""
        if hit(ic[0] + math.cos(a) * iris[0], ic[2] + math.sin(a) * iris[1]) is not None:
            return 1.0
        lo, hi = 0.0, 1.0
        for _ in range(30):
            m = (lo + hi) / 2
            if hit(ic[0] + math.cos(a) * iris[0] * m, ic[2] + math.sin(a) * iris[1] * m) is None:
                hi = m
            else:
                lo = m
        return lo * 0.985
    verts, faces = [], []
    for r in rings:
        for k in range(1 if r == 0 else segs):
            a = 2 * math.pi * k / segs
            rr = min(r, reach(a) - (1.0 - r) * 0.03) if r > 0 else 0.0
            x, z = ic[0] + math.cos(a) * iris[0] * rr, ic[2] + math.sin(a) * iris[1] * rr
            verts.append(V((x, E[1] - 0.1 + hit(x, z), z)))
    for k in range(segs):
        faces.append((0, 1 + (k + 1) % segs, 1 + k))
    for i in range(1, len(rings) - 1):
        a0, a1 = 1 + (i - 1) * segs, 1 + i * segs
        for k in range(segs):
            j = (k + 1) % segs
            faces.append((a0 + k, a0 + j, a1 + j, a1 + k))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(fig.M(mname))
    for poly in me.polygons:
        poly.use_smooth = True
    # faces must point out of the eye
    if me.polygons[0].normal.y > 0:
        me.flip_normals()
    return fig.add(ob, kind)


def iris_shade(p, ic, iris, pupil):
    """Iris colour multiplier: darker under the lid, lighter where light falls into the lower iris,
    a dark rim, a near-black pupil."""
    dx, dz = (p.x - ic[0]) / iris[0], (p.z - ic[2]) / iris[1]
    r = math.hypot(dx, dz)
    k = (0.6 + 0.4 * lib.smooth01(0.7, -0.6, dz)) * (1 - 0.4 * lib.smooth01(0.78, 1.0, r))
    if r / pupil < 1.0:
        k *= 0.16
    return (k, k * 0.97, k * 0.95)


# --- hands -----------------------------------------------------------------------------------------

class HandSpec:
    """Proportions of a hand (defaults: Ada's chunky child's hand)."""
    def __init__(self, **kw):
        self.at = 0.036                          # palm centre, along the forearm from the wrist
        self.palm = (0.0155, 0.026, 0.026)       # half thickness, width, length
        self.palm_round = 0.0135
        self.wrist = (0.0185, 0.02)
        self.base = 0.019                        # knuckles, along from the palm centre
        self.spread = 0.0158
        self.lengths = (0.025, 0.017, 0.0135)    # finger segments (middle finger a little longer)
        self.finger_r = (0.0074, 0.0066)         # fingers, little finger
        self.curl = (6, 20, 18)                  # degrees at each joint (more for the outer fingers)
        self.thumb = (0.02, 0.016)
        self.thumb_r = (0.0104, 0.0088, 0.0078)
        self.blend = (0.0012, 0.0075, 0.008)     # between fingers, fingers to palm, thumb to palm
        self.__dict__.update(kw)


def hand_frame(el, wr, s):
    d = wr - el
    d /= np.linalg.norm(d)
    n = V((-s, 0, 0)) - d * np.dot(d, V((-s, 0, 0)))
    n /= np.linalg.norm(n)
    w = np.cross(d, n) * -s
    if w[1] > 0:
        w = -w
    return d, n, w


def hand(fig, s, side, el, wr, spec, mname, tris, step=0.0011, extra=None, back=0.0, kind=None):
    """A relaxed hand hanging from the wrist, palm to her side, thumb forwards. `extra` (a field) is
    blended into it, reaching `back` metres up the forearm: a bare forearm, say."""
    d, n, w = hand_frame(el, wr, s)
    hc = wr + d * spec.at
    palm = box(hc, spec.palm, spec.palm_round, np.stack([n, w, d], axis=1))
    wrist = cone(wr - d * 0.025, hc - d * 0.012, *spec.wrist)
    fingers = []
    for i, (L, sp) in enumerate(((1.0, 1.0), (1.08, 0.33), (1.02, -0.33), (0.86, -1.0))):
        base = hc + d * spec.base + w * (spec.spread * sp) + n * 0.0012
        dirn = rot_toward(d, n, spec.curl[0] + i * 4)
        dirn = dirn + w * 0.14 * sp
        dirn /= np.linalg.norm(dirn)
        p1 = base + dirn * spec.lengths[0] * L
        d2 = rot_toward(dirn, n, spec.curl[1] + i * 3)
        p2 = p1 + d2 * spec.lengths[1] * L
        d3 = rot_toward(d2, n, spec.curl[2] + i * 3)
        p3 = p2 + d3 * spec.lengths[2] * L
        r = spec.finger_r[0] if i < 3 else spec.finger_r[1]
        fingers.append(tube([base, p1, p2, p3], [r, r * 0.95, r * 0.88, r * 0.84]))
    t0 = hc + w * spec.palm[1] * 0.65 + n * spec.palm[0] * 0.5 - d * spec.palm[2] * 0.54
    t1 = t0 + V(rot_toward(w, d, 38) + n * 0.3) * spec.thumb[0]
    t2 = t1 + V(rot_toward(w, d, 60) + n * 0.5) * spec.thumb[1]
    thumb = tube([t0, t1, t2], spec.thumb_r)
    f = union(palm, wrist, k=0.01)
    f = union(f, union(*fingers, k=spec.blend[0]), k=spec.blend[1])
    f = union(f, thumb, k=spec.blend[2])
    if extra is not None:
        f = union(f, extra, k=0.01)
    reach = spec.at + spec.base + sum(spec.lengths) * 1.1 + 0.02
    ends = np.stack([wr - d * (back + 0.03), wr + d * reach])
    lo, hi = ends.min(0) - 0.045, ends.max(0) + 0.045
    return fig.part(f'hand_{side}', f, lo, hi, step, mname, kind or f'hand_{side}', tris)


# --- weights ---------------------------------------------------------------------------------------

def sleeve_weights(body_fn, segs, near=0.058, far=0.085):
    """Clothing whose sleeves are blended into the body: the body follows body_fn (torso, hips); the
    sleeves follow the arm bones, blending over the shoulder. near/far: distance from the arm's
    bones inside which a point is all sleeve / beyond which it is all body."""
    def fn(p):
        side = 'L' if p.x > 0 else 'R'
        sh, el = segs[f'upperarm_{side}']
        wr = segs[f'forearm_{side}'][1]
        d = min(seg_dist(p, sh, el)[0], seg_dist(p, el, wr)[0])
        along = (p - sh).dot((el - sh).normalized())
        m = lib.smooth01(-0.025, 0.03, along) * lib.smooth01(far, near, d)
        body = body_fn(p)
        if m <= 0.0:
            return body
        arm = lib.dist_weights(p, {b: segs[b] for b in ('chest', f'shoulder_{side}', f'upperarm_{side}', f'forearm_{side}', f'hand_{side}')},
                               {'chest': 0.3, f'hand_{side}': 0.05}, 6.0)
        s = sum(arm.values())
        out = {b: v * (1 - m) for b, v in body.items()}
        for b, v in arm.items():
            out[b] = out.get(b, 0.0) + m * v / s
        return out
    return fn


# --- paint -----------------------------------------------------------------------------------------

def ao_col(a):
    """Occlusion as a cool wash, never black."""
    t = max(0.0, min(1.0, (a - 0.25) / 0.75)) ** 0.9
    return (0.62 + 0.38 * t, 0.64 + 0.36 * t, 0.76 + 0.24 * t)


def paint(parts, tint, ao, no_ao=()):
    """'Col' point colours on every part: tint(world point, kind, material name) times baked AO."""
    for ob in parts:
        me = ob.data
        if 'Col' in me.color_attributes:
            me.color_attributes.remove(me.color_attributes['Col'])
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        mname = me.materials[0].name
        a = None if mname in no_ao else ao.get(ob.name)
        kind = ob['kind']
        cols = np.empty((len(me.vertices), 4))
        for i, v in enumerate(me.vertices):
            c = tint(ob.matrix_world @ v.co, kind, mname)
            o = ao_col(a[i]) if a is not None else (1, 1, 1)
            cols[i] = (c[0] * o[0], c[1] * o[1], c[2] * o[2], 1.0)
        attr.data.foreach_set('color', cols.astype(np.float32).ravel())
        me.color_attributes.active_color_name = 'Col'
        me.color_attributes.render_color_index = me.color_attributes.active_color_index


def rest_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()
