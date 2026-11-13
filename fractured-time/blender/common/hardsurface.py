"""
Hard-surface gear fitted to a character: plates, carriers, pouches, pads, devices.

Everything that sits on the body is modelled as a signed distance field in the body's own coordinates:
- `RadialField` ray-casts the body inward around an axis (the torso's spine axis, or a limb bone) and stores the surface radius R(theta, t)
  on a grid (optionally blurred: rigid plates should not follow every rib). A point P maps to (s, t, r): arc length around the axis at a
  reference radius, distance along the axis, distance from the axis.
- `layer()` is a shell of a given thickness at a given offset above that surface; intersect it with a 2D outline (`sdf.polygon2d` in
  (s, t)) and round the intersection: a plate with a designed silhouette, real thickness and rounded rims, wherever it sits on the body.
- `solid_at()` places any SDF solid (pouch, buckle, bolt) on the surface at (s, t), oriented to it (u along s, v along t, w outward).
Meshing is `sdf.sculpt` (surface nets + projection + decimation). `uv_metric()` unwraps a mesh and rescales its UVs to metres, so every
fabric scan tiles at the same density (material 'tile' = repeats per metre). `skin()` copies the body's weights onto the piece.
"""
import math

import bpy
import numpy as np
from mathutils import Vector

import sdf


def _blur(a, it, axis_wrap=True):
    """Separable [1 2 1] blur, periodic along axis 0 (theta), clamped along axis 1 (t)."""
    for _ in range(it):
        a = (np.roll(a, 1, 0) + 2 * a + np.roll(a, -1, 0)) / 4 if axis_wrap else a
        b = a.copy()
        b[:, 1:-1] = (a[:, :-2] + 2 * a[:, 1:-1] + a[:, 2:]) / 4
        a = b
    return a


class RadialField:
    def __init__(self, space, origin, axis, ref, t0, t1, *, n_theta=180, step_t=0.004, r_max=0.45, exclude=(), only=None, blur=0,
                 theta0=-math.pi / 2, r_ref=None):
        self.o = np.array(origin, dtype=np.float64)
        ax = np.array(axis, dtype=np.float64)
        self.ax = ax / np.linalg.norm(ax)
        e1 = np.array(ref, dtype=np.float64)
        e1 = e1 - self.ax * (e1 @ self.ax)
        self.e1 = e1 / np.linalg.norm(e1)
        self.e2 = np.cross(self.ax, self.e1)
        self.t0, self.t1 = t0, t1
        self.nt = max(2, int(round((t1 - t0) / step_t)) + 1)
        self.nth = n_theta
        self.theta0 = theta0
        ts = np.linspace(t0, t1, self.nt)
        ths = np.arange(n_theta) * (2 * math.pi / n_theta)
        R = np.full((n_theta, self.nt), np.nan)
        owner = space.owner
        for i, th in enumerate(ths):
            d = math.cos(th) * self.e1 + math.sin(th) * self.e2
            for j, t in enumerate(ts):
                base = self.o + self.ax * t
                org = Vector(base + d * r_max)
                dirv = Vector(-d)
                travelled = 0.0
                while travelled < r_max:
                    loc, _n, fi, dist = space.bvh.ray_cast(org, dirv, r_max - travelled)
                    if loc is None:
                        break
                    ob = owner[fi]
                    ok = (only is None or any(ob.startswith(p) for p in only)) and not any(ob.startswith(p) for p in exclude)
                    if ok:
                        R[i, j] = float(np.linalg.norm(np.array(loc) - base))
                        break
                    travelled += dist + 1e-4
                    org = loc + dirv * 1e-4
        # fill holes (no hit) from neighbours, then blur
        for _ in range(200):
            m = np.isnan(R)
            if not m.any():
                break
            acc = np.zeros_like(R)
            cnt = np.zeros_like(R)
            for sh, axn in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
                r2 = np.roll(R, sh, axn)
                ok = ~np.isnan(r2)
                acc[ok] += r2[ok]
                cnt[ok] += 1
            fill = m & (cnt > 0)
            R[fill] = acc[fill] / cnt[fill]
        R = np.nan_to_num(R, nan=0.1)
        self.R = _blur(R, blur) if blur else R
        self.r_ref = r_ref if r_ref is not None else float(np.median(self.R))

    def view(self, theta0):
        """The same field with arc length measured from another direction (e.g. the back plate centred on +theta)."""
        import copy
        v = copy.copy(self)
        v.theta0 = theta0
        return v

    def theta_of(self, direction):
        """Angle (in this field's frame) of a world direction, e.g. the body's front (0, -1, 0)."""
        d = np.array(direction, dtype=np.float64)
        return math.atan2(float(d @ self.e2), float(d @ self.e1))

    # --- coordinates -------------------------------------------------------------------------------------------------
    def coords(self, P):
        """P (N,3) -> s (arc length at r_ref from theta0, wrapped to +-pi), t (along axis), r (from axis), theta."""
        q = P - self.o
        t = q @ self.ax
        x = q @ self.e1
        y = q @ self.e2
        r = np.sqrt(x * x + y * y)
        th = np.arctan2(y, x)
        rel = (th - self.theta0 + math.pi) % (2 * math.pi) - math.pi
        return rel * self.r_ref, t, r, th

    def radius(self, th, t):
        """Bilinear R(theta, t) (periodic in theta, clamped in t) and its derivatives per metre of arc / of t."""
        fi = ((th % (2 * math.pi)) / (2 * math.pi)) * self.nth
        fj = np.clip((t - self.t0) / (self.t1 - self.t0) * (self.nt - 1), 0, self.nt - 1.0001)
        i0 = np.floor(fi).astype(int) % self.nth
        i1 = (i0 + 1) % self.nth
        j0 = np.floor(fj).astype(int)
        j1 = np.minimum(j0 + 1, self.nt - 1)
        a = fi - np.floor(fi)
        b = fj - j0
        R00, R10, R01, R11 = self.R[i0, j0], self.R[i1, j0], self.R[i0, j1], self.R[i1, j1]
        R = (R00 * (1 - a) + R10 * a) * (1 - b) + (R01 * (1 - a) + R11 * a) * b
        dth = 2 * math.pi / self.nth
        dt = (self.t1 - self.t0) / (self.nt - 1)
        dRdth = ((R10 - R00) * (1 - b) + (R11 - R01) * b) / dth
        dRdt = ((R01 - R00) * (1 - a) + (R11 - R10) * a) / dt
        return R, dRdth / np.maximum(R, 1e-3), dRdt

    def point(self, s, t, h=0.0):
        """World point at arc s, axis t, height h above the surface; plus the local frame (u along s, v along t, w outward)."""
        th = self.theta0 + s / self.r_ref
        R, _, _ = self.radius(np.array([th]), np.array([t]))
        d = math.cos(th) * self.e1 + math.sin(th) * self.e2
        p = self.o + self.ax * t + d * (R[0] + h)
        u = -math.sin(th) * self.e1 + math.cos(th) * self.e2
        return p, u, self.ax.copy(), d


def layer(field, offset, thickness, bulge=None):
    """Shell of `thickness` whose inner face sits `offset` above the body surface. bulge(s, t) -> extra thickness (pillowing)."""
    def f(P):
        s, t, r, th = field.coords(P)
        R, gs, gt = field.radius(th, t)
        th_ = thickness + (bulge(s, t) if bulge else 0.0)
        mid = R + offset + th_ / 2
        return (np.abs(r - mid) - th_ / 2) / np.sqrt(1 + gs * gs + gt * gt)
    return f


def outline(field, pts):
    """Prism through the body along the field's radial direction with a 2D outline [(s, t)...]."""
    poly = sdf.polygon2d(pts)

    def f(P):
        s, t, _, _ = field.coords(P)
        return poly(s, t)
    return f


def band(field, t_lo, t_hi, s_lo=None, s_hi=None):
    """Prism selecting t in [t_lo, t_hi] (and optionally s in [s_lo, s_hi]): belts, straps, rows of webbing."""
    def f(P):
        s, t, _, _ = field.coords(P)
        d = np.maximum(t_lo - t, t - t_hi)
        if s_lo is not None:
            d = np.maximum(d, np.maximum(s_lo - s, s - s_hi))
        return d
    return f


def solid_at(field, s, t, h, shape):
    """Evaluate `shape` (an SDF in a local frame: x along the surface arc, y along the axis, z outward) placed at (s, t, h)."""
    p, u, v, w = field.point(s, t, h)
    M = np.stack([u, v, w], 0)

    def f(P):
        return shape((P - p) @ M.T)
    return f


def rbox(half, r):
    return sdf.box((0, 0, 0), half, r)


def bounds(field, s0, s1, t0, t1, h0=-0.01, h1=0.08, pad=0.01):
    """World AABB around a patch of the field (for meshing)."""
    pts = []
    for s in np.linspace(s0, s1, 7):
        for t in np.linspace(t0, t1, 7):
            for h in (h0, h1):
                pts.append(field.point(s, t, h)[0])
    pts = np.array(pts)
    return pts.min(0) - pad, pts.max(0) + pad


def uv_metric(ob, angle=66.0, margin=0.004):
    """Smart-UV-unwrap and rescale the UVs to metres (1 UV unit = 1 m): materials then tile by repeats per metre."""
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    me = ob.data
    uvl = me.uv_layers.active.data
    a3 = sum(p.area for p in me.polygons)
    a2 = 0.0
    for p in me.polygons:
        pts = [uvl[li].uv for li in p.loop_indices]
        for k in range(1, len(pts) - 1):
            e1 = pts[k] - pts[0]
            e2 = pts[k + 1] - pts[0]
            a2 += abs(e1.x * e2.y - e1.y * e2.x) / 2
    sc = math.sqrt(a3 / max(a2, 1e-12))
    co = np.empty(len(uvl) * 2, dtype=np.float32)
    uvl.foreach_get('uv', co)
    uvl.foreach_set('uv', co * sc)
    return sc


def finish(ob, space, material, tris=None):
    """Material, metric UVs, smooth shading with weighted normals, skin weights from the body, armature."""
    import garments as Gm
    ob.data.materials.clear()
    ob.data.materials.append(material)
    uv_metric(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    for vg in space.basemesh.vertex_groups:
        ob.vertex_groups.new(name=vg.name)
    Gm.transfer_weights(space, ob)
    wn = ob.modifiers.new('wnormal', 'WEIGHTED_NORMAL')
    wn.keep_sharp = True
    arm = ob.modifiers.new('Armature', 'ARMATURE')
    arm.object = space.rig
    ob.parent = space.rig
    ob.matrix_parent_inverse = space.rig.matrix_world.inverted()
    return ob


def make(space, name, f, lo, hi, material, step=0.0018, tris=None):
    ob = sdf.sculpt(name, f, lo, hi, step, tris=tris)
    return finish(ob, space, material)
