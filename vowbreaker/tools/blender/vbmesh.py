"""
vbmesh: Vowbreaker's ring-loft modeller.

Everything is a quad grid built from cross-section rings: a centre line, a frame per ring
(rotation-minimising, so tubes never twist), and a 2D profile per ring (superellipses, lenses,
pleats, anything). Grids close round, end open, in a pole or in a fan, and are smoothed with
Catmull-Clark subdivision afterwards. Parametric surfaces (the heads) are sampled straight into
grids. Decals (eyes, brows, lash lines, mouths) are 2D shapes laid onto another mesh by casting
rays at it. No signed-distance fields, no voxels: clean loops that shade well under cel lighting.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import vbcore


# =============================================================================== vectors

def nrm(v, axis=-1):
    v = np.asarray(v, dtype=np.float64)
    return v / np.maximum(np.linalg.norm(v, axis=axis, keepdims=True), 1e-12)


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(a, b, x):
    return vbcore.smoothstep(a, b, x)


def rot_axis(v, axis, ang):
    """Rodrigues rotation of vector(s) v about a unit axis."""
    v = np.asarray(v, dtype=np.float64)
    k = nrm(axis)
    c, s = math.cos(ang), math.sin(ang)
    if v.ndim == 1:
        return v * c + np.cross(k, v) * s + k * (k @ v) * (1 - c)
    return v * c + np.cross(k, v) * s + np.outer(v @ k, k) * (1 - c)


def pchip(xk, yk, x):
    """Shape-preserving piecewise cubic (Fritsch-Carlson): smooth, never overshoots its keys."""
    xk = np.asarray(xk, dtype=np.float64)
    yk = np.asarray(yk, dtype=np.float64)
    x = np.asarray(x, dtype=np.float64)
    n = len(xk)
    if n == 1:
        return np.full_like(x, yk[0])
    h = np.diff(xk)
    d = np.diff(yk) / h
    m = np.zeros(n)
    for k in range(1, n - 1):
        if d[k - 1] * d[k] > 0:
            w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])
    m[0], m[-1] = d[0], d[-1]
    if n > 2:
        m[0] = ((2 * h[0] + h[1]) * d[0] - h[0] * d[1]) / (h[0] + h[1])
        if m[0] * d[0] <= 0:
            m[0] = 0.0
        elif d[0] * d[1] <= 0 and abs(m[0]) > abs(3 * d[0]):
            m[0] = 3 * d[0]
        m[-1] = ((2 * h[-1] + h[-2]) * d[-1] - h[-1] * d[-2]) / (h[-1] + h[-2])
        if m[-1] * d[-1] <= 0:
            m[-1] = 0.0
        elif d[-1] * d[-2] <= 0 and abs(m[-1]) > abs(3 * d[-1]):
            m[-1] = 3 * d[-1]
    xc = np.clip(x, xk[0], xk[-1])
    i = np.clip(np.searchsorted(xk, xc) - 1, 0, n - 2)
    t = (xc - xk[i]) / h[i]
    t2, t3 = t * t, t * t * t
    return ((2 * t3 - 3 * t2 + 1) * yk[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
            + (-2 * t3 + 3 * t2) * yk[i + 1] + (t3 - t2) * h[i] * m[i + 1])


def rot_xyz(rx=0.0, ry=0.0, rz=0.0):
    """Rotation matrix from XYZ euler degrees (applied X then Y then Z)."""
    a, b, c = (math.radians(x) for x in (rx, ry, rz))
    X = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    Y = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    Z = np.array([[math.cos(c), -math.sin(c), 0], [math.sin(c), math.cos(c), 0], [0, 0, 1]])
    return Z @ Y @ X


# =============================================================================== curves

def catmull(pts, n, closed=False, alpha=0.5):
    """Centripetal Catmull-Rom through pts, resampled to n points evenly in arc length."""
    P = np.asarray(pts, dtype=np.float64)
    if len(P) < 2:
        return np.repeat(P, n, axis=0)
    if closed:
        ext = np.vstack([P[-1:], P, P[:2]])
    else:
        ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    dense = []
    segs = len(ext) - 3
    for i in range(segs):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-9) ** alpha
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-9) ** alpha
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-9) ** alpha
        for t in np.linspace(t1, t2, 24, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            dense.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    dense.append(P[0] if closed else P[-1])
    return resample(np.array(dense), n, closed)


def resample(P, n, closed=False):
    P = np.asarray(P, dtype=np.float64)
    if closed:
        P = np.vstack([P, P[:1]])
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    total = d[-1] if d[-1] > 0 else 1.0
    s = np.linspace(0, total, n + 1 if closed else n)
    if closed:
        s = s[:-1]
    out = np.empty((len(s), P.shape[1]))
    for k in range(P.shape[1]):
        out[:, k] = np.interp(s, d, P[:, k])
    return out


def bezier(p0, p1, p2, p3, n):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = (np.asarray(p, dtype=np.float64) for p in (p0, p1, p2, p3))
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3


def arclen(P):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    return d / max(d[-1], 1e-12)


def tangents(P):
    P = np.asarray(P, dtype=np.float64)
    T = np.gradient(P, axis=0)
    return nrm(T)


def rmf(P, first_normal=None):
    """Rotation-minimising frames along a polyline (double reflection, Wang et al. 2008).
    Returns (T, N, B): tangent, normal, binormal per point."""
    P = np.asarray(P, dtype=np.float64)
    T = tangents(P)
    n = len(P)
    N = np.zeros_like(P)
    if first_normal is None:
        up = np.array([0.0, 0.0, 1.0]) if abs(T[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        first_normal = np.cross(T[0], up)
    r0 = np.asarray(first_normal, dtype=np.float64)
    N[0] = nrm(r0 - T[0] * (r0 @ T[0]))
    for i in range(n - 1):
        v1 = P[i + 1] - P[i]
        c1 = v1 @ v1
        if c1 < 1e-18:
            N[i + 1] = N[i]
            continue
        rL = N[i] - (2 / c1) * (v1 @ N[i]) * v1
        tL = T[i] - (2 / c1) * (v1 @ T[i]) * v1
        v2 = T[i + 1] - tL
        c2 = v2 @ v2
        N[i + 1] = rL - (2 / c2) * (v2 @ rL) * v2 if c2 > 1e-18 else rL
        N[i + 1] = nrm(N[i + 1] - T[i + 1] * (N[i + 1] @ T[i + 1]))
    B = np.cross(T, N)
    return T, N, B


def guided_frames(P, guide):
    """Frames whose normal follows `guide` (one vector or one per point), e.g. away from a head."""
    T = tangents(P)
    G = np.broadcast_to(np.asarray(guide, dtype=np.float64), P.shape)
    N = nrm(G - T * np.einsum('ij,ij->i', G, T)[:, None])
    B = np.cross(T, N)
    return T, N, B


# =============================================================================== 2D profiles

def superellipse(n, rx, ry, p=2.0, phase=0.0):
    """n points counter-clockwise; p = 2 ellipse, > 2 boxier, < 2 pointier at the axes."""
    a = np.linspace(0, 2 * math.pi, n, endpoint=False) + phase
    c, s = np.cos(a), np.sin(a)
    e = 2.0 / p
    return np.stack([rx * np.sign(c) * np.abs(c) ** e, ry * np.sign(s) * np.abs(s) ** e], 1)


def rounded_rect(n, w, h, r):
    """A rounded rectangle (half sizes w, h, corner radius r) as n points."""
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    c, s = np.cos(a), np.sin(a)
    ex, ey = max(w - r, 0), max(h - r, 0)
    # push a circle of radius r out by the straight parts
    k = 1.0 / np.maximum(np.abs(c) / max(w, 1e-9), np.abs(s) / max(h, 1e-9))
    x, y = c * k, s * k
    x = np.clip(x, -ex, ex) + c * r
    y = np.clip(y, -ey, ey) + s * r
    return np.stack([x, y], 1)


def lens(n, w, t, sharp=0.35):
    """A leaf / lens cross-section: wide w, thick t, edges pinched to a crease (hair clumps, cloth)."""
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    x = w * np.cos(a)
    y = t * np.sin(a) * (1 - sharp * np.cos(a) ** 2)
    return np.stack([x, y], 1)


def pleated(prof, count, depth, sharp=True):
    """Push a closed profile in and out like pleats (triangle wave when sharp)."""
    P = np.asarray(prof, dtype=np.float64)
    a = np.arctan2(P[:, 1], P[:, 0])
    w = (2 / math.pi) * np.arcsin(np.sin(a * count)) if sharp else np.sin(a * count)
    return P * (1 + depth * w)[:, None]


# =============================================================================== grids -> meshes

class Grid:
    """rings: (R, K, 3) vertex positions. closed: rings close round. caps: per end, None (open),
    'pole' (a point a little past the end ring), 'fan' (a point at the ring centre), or a 3-vector."""

    def __init__(self, rings, closed=True, cap0=None, cap1=None, data=None, loop=False):
        self.rings = np.asarray(rings, dtype=np.float64)
        self.closed = closed
        self.loop = loop      # the last ring joins the first (tori, closed bands)
        self.cap0, self.cap1 = cap0, cap1
        self.data = data      # optional (R, K) per-vertex scalar carried to the mesh (e.g. along-param)

    def build(self, name, smooth_shade=True, flip=False):
        R, K, _ = self.rings.shape
        verts = list(self.rings.reshape(-1, 3))
        faces = []
        kk = K if self.closed else K - 1
        for i in range(R if self.loop else R - 1):
            i1 = (i + 1) % R
            for k in range(kk):
                j = (k + 1) % K
                faces.append((i * K + k, i * K + j, i1 * K + j, i1 * K + k))
        if self.loop:
            return vbcore.mesh_object(name, verts, faces, smooth_shade)
        extra_data = []
        for end, cap in ((0, self.cap0), (R - 1, self.cap1)):
            if cap is None:
                continue
            ring = self.rings[end]
            centre = ring.mean(0)
            if isinstance(cap, str):
                if cap == 'pole':
                    other = self.rings[1] if end == 0 else self.rings[-2]
                    axis = nrm(centre - other.mean(0))
                    rad = np.linalg.norm(ring - centre, axis=1).mean()
                    p = centre + axis * rad * 0.55
                else:
                    p = centre
            else:
                p = np.asarray(cap, dtype=np.float64)
            vi = len(verts)
            verts.append(p)
            extra_data.append(end)
            base = end * K
            for k in range(kk):
                j = (k + 1) % K
                if end == 0:
                    faces.append((base + j, base + k, vi))
                else:
                    faces.append((base + k, base + j, vi))
        if flip:
            faces = [tuple(reversed(f)) for f in faces]
        ob = vbcore.mesh_object(name, verts, faces, smooth_shade)
        if self.data is not None:
            d = list(np.asarray(self.data, dtype=np.float64).reshape(-1)) + [float(np.asarray(self.data)[e].mean()) for e in extra_data]
            ob['_data'] = d
        return ob


def loft(centres, frames, profiles, closed=True, cap0=None, cap1=None):
    """Sweep 2D profiles along centres. frames = (T, N, B); profile x runs along B, y along N."""
    C = np.asarray(centres, dtype=np.float64)
    T, N, B = frames
    rings = []
    for i in range(len(C)):
        pr = profiles[i] if isinstance(profiles, (list, tuple)) else profiles(i, len(C))
        pr = np.asarray(pr, dtype=np.float64)
        rings.append(C[i] + np.outer(pr[:, 0], B[i]) + np.outer(pr[:, 1], N[i]))
    return Grid(np.array(rings), closed, cap0, cap1)


def tube(pts, radii, n=12, cap0='pole', cap1='pole', squash=1.0, guide=None, samples=None, profile=None):
    """A tapered tube along a smooth curve through pts. radii: one per input point (interpolated)."""
    P = np.asarray(pts, dtype=np.float64)
    m = samples or max(6, len(P) * 4)
    C = catmull(P, m) if len(P) > 2 else resample(P, m)
    t_in = arclen(P)
    t_out = arclen(C)
    r = np.interp(t_out, t_in, np.asarray(radii, dtype=np.float64))
    fr = guided_frames(C, guide) if guide is not None else rmf(C)
    profs = []
    for i in range(m):
        if profile is not None:
            profs.append(profile(i, m, r[i]))
        else:
            profs.append(superellipse(n, r[i], r[i] * squash))
    g = loft(C, fr, profs, True, cap0, cap1)
    g.data = np.repeat(t_out[:, None], len(profs[0]), 1)
    return g


def sphere(c, r, n=16, m=10, scale=(1, 1, 1), R=None):
    """A UV sphere as a grid with poles (ellipsoid via scale, rotated by R)."""
    rings = []
    for i in range(1, m):
        ph = -math.pi / 2 + math.pi * i / m
        a = np.linspace(0, 2 * math.pi, n, endpoint=False)
        ring = np.stack([np.cos(a) * math.cos(ph), np.sin(a) * math.cos(ph), np.full(n, math.sin(ph))], 1) * r * np.asarray(scale)
        if R is not None:
            ring = ring @ np.asarray(R).T
        rings.append(ring + np.asarray(c))
    bot = np.asarray(c) + ((np.array([0, 0, -r]) * scale) @ (np.asarray(R).T if R is not None else np.eye(3)))
    top = np.asarray(c) + ((np.array([0, 0, r]) * scale) @ (np.asarray(R).T if R is not None else np.eye(3)))
    return Grid(np.array(rings), True, bot, top)


def lathe(profile, centre=(0, 0, 0), n=32, depth=1.0, rmod=None, cap0=None, cap1=None, arc=None):
    """Revolve (r, z) profile points about the vertical axis. rmod(theta, z) scales the radius.
    arc=(a0, a1) leaves a gap (an open front)."""
    pr = np.asarray(profile, dtype=np.float64)
    c = np.asarray(centre, dtype=np.float64)
    if arc is None:
        a = np.linspace(0, 2 * math.pi, n, endpoint=False)
        closed = True
    else:
        a = np.linspace(arc[0], arc[1], n)
        closed = False
    rings = []
    for r, z in pr:
        k = rmod(a, z) if rmod is not None else 1.0
        # theta 0 = front (-y), increasing toward the character's left (+x)
        ring = np.stack([np.sin(a) * r * k, -np.cos(a) * r * k * depth, np.full(len(a), z)], 1) + c
        rings.append(ring)
    return Grid(np.array(rings), closed, cap0, cap1)


def torus(c, R, r, axis=(0, 0, 1), n=24, m=10, squash=1.0):
    """A ring of radius R, tube radius r, round `axis`."""
    ax = nrm(axis)
    ref = np.array([1.0, 0, 0]) if abs(ax[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = nrm(np.cross(ax, ref))
    e2 = np.cross(ax, e1)
    rings = []
    for i in range(n):
        th = 2 * math.pi * i / n
        radial = e1 * math.cos(th) + e2 * math.sin(th)
        ctr = np.asarray(c, dtype=np.float64) + radial * R
        b = np.linspace(0, 2 * math.pi, m, endpoint=False)
        ring = ctr + np.outer(np.cos(b) * r, radial) + np.outer(np.sin(b) * r * squash, ax)
        rings.append(ring)
    return Grid(np.array(rings), True, loop=True)


def rbox(c, half, R=None, round_=0.3, n=16, rings=6):
    """A rounded box (bags, pouches, talismans): superellipse rings stacked along local z."""
    hx, hy, hz = half
    r = min(hx, hy, hz) * round_
    zs = [-hz, -hz + r * 0.25, -hz + r, hz - r, hz - r * 0.25, hz]
    sh = [0.6, 0.93, 1.0, 1.0, 0.93, 0.6]
    out = []
    for z, k in zip(zs, sh):
        pr = superellipse(n, hx - r * (1 - k), hy - r * (1 - k), 4.0)
        ring = np.column_stack([pr, np.full(n, z)])
        if R is not None:
            ring = ring @ np.asarray(R).T
        out.append(ring + np.asarray(c, dtype=np.float64))
    top = np.asarray(c, dtype=np.float64) + (np.array([0, 0, hz]) @ (np.asarray(R).T if R is not None else np.eye(3)))
    bot = np.asarray(c, dtype=np.float64) + (np.array([0, 0, -hz]) @ (np.asarray(R).T if R is not None else np.eye(3)))
    return Grid(np.array(out), True, bot, top)


# =============================================================================== mesh ops

def finish(ob, levels=1, thickness=0.0, offset=-1.0):
    if thickness:
        vbcore.solidify(ob, thickness, offset)
    if levels:
        vbcore.subdivide(ob, levels)
    return ob


def merge(obs, name):
    obs = [o for o in obs if o is not None]
    if len(obs) == 1:
        obs[0].name = name
        return obs[0]
    return vbcore.join(obs, name)


def displace(ob, fn):
    """Move every vertex by fn(world positions (n,3), normals (n,3)) -> (n,3) offsets."""
    me = ob.data
    co = vbcore.world_verts(ob)
    no = vbcore.world_normals(ob)
    d = fn(co, no)
    new = co + d
    Minv = np.array(ob.matrix_world.inverted())
    local = new @ Minv[:3, :3].T + Minv[:3, 3]
    me.vertices.foreach_set('co', local.astype(np.float32).ravel())
    me.update()
    return ob


def recalc_normals(ob, inside=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if inside:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def delete_faces(ob, keep):
    """Remove faces whose centre fails keep(centres (n,3)) -> bool array."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    C = np.array([f.calc_center_median() for f in bm.faces])
    k = keep(C)
    dead = [f for f, kk in zip(bm.faces, k) if not kk]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


# =============================================================================== surfaces & decals

class Surface:
    """Ray queries against an object (for laying features on a head, straps on a torso)."""

    def __init__(self, ob):
        co = vbcore.world_verts(ob)
        polys = [tuple(p.vertices) for p in ob.data.polygons]
        self.tree = BVHTree.FromPolygons([Vector(v) for v in co], polys)

    def cast(self, origin, direction, dist=10.0):
        hit = self.tree.ray_cast(Vector(origin), Vector(direction).normalized(), dist)
        if hit[0] is None:
            return None, None
        return np.array(hit[0]), np.array(hit[1])

    def nearest(self, p):
        hit = self.tree.find_nearest(Vector(p))
        return np.array(hit[0]), np.array(hit[1])

    def project(self, pts, direction, back=0.5, lift=0.0):
        """Project points along `direction` onto the surface (rays start `back` behind them)."""
        d = nrm(direction)
        out, nn = [], []
        for p in np.asarray(pts, dtype=np.float64):
            h, n = self.cast(p - d * back, d, back * 3)
            if h is None:
                h, n = self.nearest(p)
            out.append(h + n * lift)
            nn.append(n)
        return np.array(out), np.array(nn)


def strip2d(curve, widths, n=None):
    """A ribbon round a 2D curve: returns (2, n, 2) edge points (left/right) with widths per point."""
    C = np.asarray(curve, dtype=np.float64)
    if n is not None:
        t_in = arclen(C)
        C = catmull(C, n)
        widths = np.interp(arclen(C), t_in, np.asarray(widths, dtype=np.float64))
    T = np.gradient(C, axis=0)
    T = nrm(T)
    Nn = np.stack([-T[:, 1], T[:, 0]], 1)
    w = np.asarray(widths, dtype=np.float64)[:, None]
    return np.stack([C + Nn * w * 0.5, C - Nn * w * 0.5], 0)


def decal(name, surface, to3d, rings2d, closed=False, direction=(0, 1, 0), lift=0.0, cap=None):
    """Lay a grid of 2D points (rings2d: (R, K, 2) in the decal's plane) onto a surface. to3d maps
    2D -> 3D points in front of the surface; rays travel along `direction` onto it."""
    R2 = np.asarray(rings2d, dtype=np.float64)
    R, K, _ = R2.shape
    flat = to3d(R2.reshape(-1, 2))
    pts, _ = surface.project(flat, direction, back=0.3, lift=lift)
    g = Grid(pts.reshape(R, K, 3), closed, None, None)
    if cap is not None:
        c3 = to3d(np.asarray(cap, dtype=np.float64)[None])
        cp, _ = surface.project(c3, direction, back=0.3, lift=lift)
        g.cap0 = cp[0]
    return face_toward(g.build(name), -nrm(direction))


def face_toward(ob, toward):
    """Flip an open sheet (a decal, a mark) so its faces look along `toward` on average."""
    me = ob.data
    nn = np.empty(len(me.polygons) * 3)
    me.polygons.foreach_get('normal', nn)
    area = np.empty(len(me.polygons))
    me.polygons.foreach_get('area', area)
    if (nn.reshape(-1, 3) * area[:, None]).sum(0) @ np.asarray(toward, dtype=np.float64) < 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.update()
    return ob


def polygon_rays(centre, outline, angles):
    """Distance from centre to a closed 2D outline along each angle (first crossing outward)."""
    O = np.asarray(outline, dtype=np.float64)
    c = np.asarray(centre, dtype=np.float64)
    out = np.empty(len(angles))
    A = O
    Bp = np.roll(O, -1, axis=0)
    for i, a in enumerate(angles):
        d = np.array([math.cos(a), math.sin(a)])
        best = np.inf
        e = Bp - A
        den = d[0] * e[:, 1] - d[1] * e[:, 0]
        ok = np.abs(den) > 1e-12
        w = A - c
        t = (w[:, 0] * e[:, 1] - w[:, 1] * e[:, 0]) / np.where(ok, den, 1)
        s = (w[:, 0] * d[1] - w[:, 1] * d[0]) / np.where(ok, den, 1)
        hit = ok & (t > 0) & (s >= 0) & (s <= 1)
        if hit.any():
            best = t[hit].min()
        out[i] = best if np.isfinite(best) else 0.0
    return out


# =============================================================================== noise (for lumpy curses, tatters)

def value_noise3(P, freq, seed=0):
    """Smooth value noise on a lattice (trilinear with quintic fade), in -0.5..0.5."""
    Q = np.asarray(P, dtype=np.float64) * freq + seed * 17.13
    i = np.floor(Q).astype(np.int64)
    f = Q - i
    u = f * f * f * (f * (f * 6 - 15) + 10)

    def h(ix, iy, iz):
        n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
        n = (n ^ (n >> 13)) * 1274126177
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0
    out = 0.0
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * h(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz)
    return out - 0.5


def fbm3(P, freq, octaves=3, seed=0):
    s, a, f = 0.0, 0.5, freq
    for o in range(octaves):
        s = s + a * value_noise3(P, f, seed + o) * 2
        a *= 0.5
        f *= 2.03
    return s
