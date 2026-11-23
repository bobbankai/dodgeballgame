"""Signed distance field sculpting (numpy) for Tidebreakers.

Fields are objects with `eval(p)` taking an (N, 3) float array and returning (N,) distances, plus an
axis-aligned bound `lo, hi` (the region where the surface can be). Composite fields skip children whose
bound is too far from a point to matter, so a character made of a hundred primitives meshes in seconds.

Blender coordinates: metres, Z up, characters face -Y, their left is +X.

Meshing: `mesh_field()` runs surface nets on a narrow band (coarse grid first, fine cells only near the
surface), projects the vertices onto the zero set with the field gradient, and returns quads.
"""
import math
import numpy as np

BIG = 1e3


def _len(v):
    return np.sqrt(np.einsum('...i,...i->...', v, v))


def _bbox_dist(p, lo, hi):
    q = np.maximum(lo - p, 0) + np.maximum(p - hi, 0)
    return _len(q)


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], float)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], float)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], float)


def look_rot(axis, up=(0, 0, 1)):
    """Rotation whose local +Z points along `axis` (columns are the local axes in world space)."""
    z = np.asarray(axis, float)
    z = z / np.linalg.norm(z)
    u = np.asarray(up, float)
    if abs(np.dot(u, z)) > 0.95:
        u = np.array([1.0, 0, 0]) if abs(z[0]) < 0.9 else np.array([0, 1.0, 0])
    x = np.cross(u, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


class Field:
    lo = np.full(3, -BIG)
    hi = np.full(3, BIG)
    tag = None

    def eval(self, p):
        raise NotImplementedError

    def __call__(self, p):
        return self.eval(np.asarray(p, float))

    # composition sugar
    def __or__(self, o):
        return Union([self, o])

    def __and__(self, o):
        return Intersect([self, o])

    def __sub__(self, o):
        return Subtract(self, o)


# ---------------------------------------------------------------------------------------- primitives

class Sphere(Field):
    def __init__(self, c, r):
        self.c = np.asarray(c, float)
        self.r = float(r)
        self.lo = self.c - self.r
        self.hi = self.c + self.r

    def eval(self, p):
        return _len(p - self.c) - self.r


class Ellipsoid(Field):
    """Approximate distance (exact on the axes, good near the surface). R maps local->world."""

    def __init__(self, c, radii, R=None):
        self.c = np.asarray(c, float)
        self.r = np.asarray(radii, float)
        self.R = np.eye(3) if R is None else np.asarray(R, float)
        ext = np.abs(self.R) @ self.r
        self.lo = self.c - ext
        self.hi = self.c + ext

    def eval(self, p):
        q = (p - self.c) @ self.R
        k0 = _len(q / self.r)
        k1 = _len(q / (self.r * self.r))
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


class RoundCone(Field):
    """Cone between spheres (a, ra) and (b, rb) — limbs, fingers, hair spikes (rb ~ 0)."""

    def __init__(self, a, b, ra, rb):
        self.a = np.asarray(a, float)
        self.b = np.asarray(b, float)
        self.ra = float(ra)
        self.rb = float(rb)
        m = max(self.ra, self.rb)
        self.lo = np.minimum(self.a - self.ra, self.b - self.rb)
        self.hi = np.maximum(self.a + self.ra, self.b + self.rb)
        ba = self.b - self.a
        self.l2 = float(np.dot(ba, ba))
        self.rr = self.ra - self.rb
        self.a2 = self.l2 - self.rr * self.rr
        self.il2 = 1.0 / max(self.l2, 1e-12)
        self.ba = ba
        _ = m

    def eval(self, p):
        # Inigo Quilez, "round cone" exact SDF.
        pa = p - self.a
        y = pa @ self.ba
        z = y - self.l2
        x2v = pa * self.l2 - np.outer(y, self.ba)
        x2 = np.einsum('ij,ij->i', x2v, x2v)
        y2 = y * y * self.l2
        z2 = z * z * self.l2
        k = np.sign(self.rr) * self.rr * self.rr * x2
        out = (np.sqrt(x2 * self.a2 * self.il2) + y * self.rr) * self.il2 - self.ra
        c1 = np.sign(z) * self.a2 * z2 > k
        c2 = np.sign(y) * self.a2 * y2 < k
        d1 = np.sqrt(x2 + z2) * self.il2 - self.rb
        d2 = np.sqrt(x2 + y2) * self.il2 - self.ra
        out = np.where(c2, d2, out)
        out = np.where(c1, d1, out)
        return out


class Capsule(RoundCone):
    def __init__(self, a, b, r):
        super().__init__(a, b, r, r)


class Box(Field):
    """Rounded box. `half` are half extents, R local->world, `round` the edge radius."""

    def __init__(self, c, half, R=None, round=0.0):
        self.c = np.asarray(c, float)
        self.h = np.asarray(half, float)
        self.R = np.eye(3) if R is None else np.asarray(R, float)
        self.rd = float(round)
        ext = np.abs(self.R) @ self.h
        self.lo = self.c - ext
        self.hi = self.c + ext

    def eval(self, p):
        q = np.abs((p - self.c) @ self.R) - (self.h - self.rd)
        return _len(np.maximum(q, 0)) + np.minimum(q.max(axis=1), 0) - self.rd


class Torus(Field):
    """Torus around local Z (R local->world): ring radius `big`, tube radius `small`."""

    def __init__(self, c, big, small, R=None):
        self.c = np.asarray(c, float)
        self.R = np.eye(3) if R is None else np.asarray(R, float)
        self.big = float(big)
        self.small = float(small)
        e = self.big + self.small
        self.lo = self.c - e
        self.hi = self.c + e

    def eval(self, p):
        q = (p - self.c) @ self.R
        xy = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - self.big
        return np.sqrt(xy * xy + q[:, 2] ** 2) - self.small


class Cylinder(Field):
    """Capped cylinder along local Z, centred at c, radius r, half height h, rounded edge."""

    def __init__(self, c, r, h, R=None, round=0.0):
        self.c = np.asarray(c, float)
        self.R = np.eye(3) if R is None else np.asarray(R, float)
        self.r = float(r)
        self.h = float(h)
        self.rd = float(round)
        e = np.abs(self.R) @ np.array([self.r, self.r, self.h])
        self.lo = self.c - e
        self.hi = self.c + e

    def eval(self, p):
        q = (p - self.c) @ self.R
        dx = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - self.r + self.rd
        dy = np.abs(q[:, 2]) - self.h + self.rd
        return np.minimum(np.maximum(dx, dy), 0) + _len(np.stack([np.maximum(dx, 0), np.maximum(dy, 0)], 1)) - self.rd


class Plane(Field):
    """Half-space: negative on the side opposite to n (n points out of the solid)."""

    def __init__(self, n, point):
        self.n = np.asarray(n, float) / np.linalg.norm(n)
        self.d = float(np.dot(self.n, point))

    def eval(self, p):
        return p @ self.n - self.d


class Func(Field):
    """Arbitrary field from a python function f(p) -> d with an explicit bound."""

    def __init__(self, f, lo=None, hi=None):
        self.f = f
        if lo is not None:
            self.lo = np.asarray(lo, float)
            self.hi = np.asarray(hi, float)

    def eval(self, p):
        return self.f(p)


# ---------------------------------------------------------------------------------------- operations

def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


class Union(Field):
    """Union (k = 0) or smooth union of children. Children far from a point are skipped."""

    def __init__(self, items, k=0.0):
        self.items = [i for i in items if i is not None]
        self.k = float(k)
        self.lo = np.min([i.lo for i in self.items], axis=0) - self.k
        self.hi = np.max([i.hi for i in self.items], axis=0) + self.k

    def eval(self, p):
        d = np.full(len(p), BIG)
        for it in self.items:
            bd = _bbox_dist(p, it.lo, it.hi)
            sel = bd < d + self.k
            if not sel.any():
                continue
            idx = np.nonzero(sel)[0]
            v = it.eval(p[idx])
            d[idx] = smin(d[idx], v, self.k)
        return d


class Intersect(Field):
    def __init__(self, items, k=0.0):
        self.items = items
        self.k = float(k)
        self.lo = np.max([i.lo for i in items], axis=0)
        self.hi = np.min([i.hi for i in items], axis=0)

    def eval(self, p):
        d = self.items[0].eval(p)
        for it in self.items[1:]:
            d = smax(d, it.eval(p), self.k)
        return d


class Subtract(Field):
    def __init__(self, a, b, k=0.0):
        self.a, self.b, self.k = a, b, float(k)
        self.lo, self.hi = a.lo, a.hi

    def eval(self, p):
        d = self.a.eval(p)
        bd = _bbox_dist(p, self.b.lo, self.b.hi)
        sel = bd < -d + self.k + 1e-6
        if sel.any():
            idx = np.nonzero(sel)[0]
            d[idx] = smax(d[idx], -self.b.eval(p[idx]), self.k)
        return d


class Offset(Field):
    """Grow (r > 0) or shrink a field."""

    def __init__(self, f, r):
        self.f, self.r = f, float(r)
        self.lo = f.lo - max(r, 0)
        self.hi = f.hi + max(r, 0)

    def eval(self, p):
        return self.f.eval(p) - self.r


class Shell(Field):
    """Hollow skin of thickness t centred on the surface of f (outward offset `out`)."""

    def __init__(self, f, t, out=0.0):
        self.f, self.t, self.out = f, float(t), float(out)
        self.lo = f.lo - out - t
        self.hi = f.hi + out + t

    def eval(self, p):
        return np.abs(self.f.eval(p) - self.out) - self.t * 0.5


class Displace(Field):
    """Adds g(p) (in metres) to the distance. Keep |g| small and smooth to stay well behaved."""

    def __init__(self, f, g, amp=0.01):
        self.f, self.g, self.amp = f, g, amp
        self.lo = f.lo - amp
        self.hi = f.hi + amp

    def eval(self, p):
        d = self.f.eval(p)
        near = np.abs(d) < self.amp * 3 + 0.02
        if near.any():
            idx = np.nonzero(near)[0]
            d[idx] = d[idx] + self.g(p[idx])
        return d


class Transform(Field):
    """Evaluate f in a moved/rotated frame: world point p maps to R^T (p - t)."""

    def __init__(self, f, R=None, t=(0, 0, 0), scale=1.0):
        self.f = f
        self.R = np.eye(3) if R is None else np.asarray(R, float)
        self.t = np.asarray(t, float)
        self.s = float(scale)
        corners = np.array([[x, y, z] for x in (f.lo[0], f.hi[0]) for y in (f.lo[1], f.hi[1]) for z in (f.lo[2], f.hi[2])])
        if np.all(np.abs(corners) < BIG / 2):
            w = corners * self.s @ self.R.T + self.t
            self.lo, self.hi = w.min(0), w.max(0)

    def eval(self, p):
        q = (p - self.t) @ self.R / self.s
        return self.f.eval(q) * self.s


class Mirror(Field):
    """Mirror across x = 0 (characters are symmetric by default)."""

    def __init__(self, f):
        self.f = f
        m = max(abs(f.lo[0]), abs(f.hi[0]))
        self.lo = np.array([-m, f.lo[1], f.lo[2]])
        self.hi = np.array([m, f.hi[1], f.hi[2]])

    def eval(self, p):
        q = p.copy()
        q[:, 0] = np.abs(q[:, 0])
        return self.f.eval(q)


# ---------------------------------------------------------------------------------------- curves

def bezier(pts, n):
    """Points along a cubic (4 pts) or quadratic (3 pts) bezier."""
    pts = np.asarray(pts, float)
    t = np.linspace(0, 1, n)[:, None]
    if len(pts) == 3:
        return (1 - t) ** 2 * pts[0] + 2 * (1 - t) * t * pts[1] + t * t * pts[2]
    return (1 - t) ** 3 * pts[0] + 3 * (1 - t) ** 2 * t * pts[1] + 3 * (1 - t) * t * t * pts[2] + t ** 3 * pts[3]


def tube(points, radii, k=0.0):
    """A chain of round cones along a polyline — tapered strands, tails, braids, ropes."""
    points = np.asarray(points, float)
    radii = np.broadcast_to(np.asarray(radii, float), (len(points),))
    segs = [RoundCone(points[i], points[i + 1], radii[i], radii[i + 1]) for i in range(len(points) - 1)]
    return Union(segs, k)


class FlatTube(Field):
    """A ribbon-like strand: round cones evaluated in a squashed frame (width w, thickness t profile).
    Used for anime hair clumps and cloth tails. `normals` gives each point's flat direction."""

    def __init__(self, points, widths, thick, normals):
        self.pts = np.asarray(points, float)
        self.w = np.broadcast_to(np.asarray(widths, float), (len(self.pts),)).copy()
        self.t = np.broadcast_to(np.asarray(thick, float), (len(self.pts),)).copy()
        self.nrm = np.asarray(normals, float)
        if self.nrm.ndim == 1:
            self.nrm = np.tile(self.nrm, (len(self.pts), 1))
        m = float(max(self.w.max(), self.t.max()))
        self.lo = self.pts.min(0) - m
        self.hi = self.pts.max(0) + m

    def eval(self, p):
        d = np.full(len(p), BIG)
        for i in range(len(self.pts) - 1):
            a, b = self.pts[i], self.pts[i + 1]
            ab = b - a
            L2 = float(np.dot(ab, ab)) + 1e-12
            h = np.clip(((p - a) @ ab) / L2, 0, 1)
            c = a + h[:, None] * ab
            w = self.w[i] + (self.w[i + 1] - self.w[i]) * h
            t = self.t[i] + (self.t[i + 1] - self.t[i]) * h
            n = self.nrm[i] + (self.nrm[i + 1] - self.nrm[i]) * h[:, None]
            n /= np.maximum(_len(n), 1e-9)[:, None]
            v = p - c
            vn = np.einsum('ij,ij->i', v, n)
            vt = v - vn[:, None] * n
            # ellipse cross-section: width along the strand's side, thickness along n
            q = np.sqrt((_len(vt) / np.maximum(w, 1e-5)) ** 2 + (vn / np.maximum(t, 1e-5)) ** 2)
            dist = (q - 1.0) * np.minimum(w, t)
            d = np.minimum(d, dist)
        return d


# ---------------------------------------------------------------------------------------- noise

def _hash3(i):
    i = i.astype(np.int64)
    h = (i[..., 0] * 73856093) ^ (i[..., 1] * 19349663) ^ (i[..., 2] * 83492791)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h & 0xFFFF) / 65535.0).astype(float)


def value_noise(p, scale=1.0, seed=0):
    q = p * scale + seed * 17.13
    i = np.floor(q)
    f = q - i
    u = f * f * (3 - 2 * f)
    res = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                res = res + w * _hash3(i + np.array([dx, dy, dz]))
    return res * 2 - 1


def fbm(p, scale=1.0, octaves=4, seed=0):
    s, a, tot = scale, 1.0, 0.0
    norm = 0.0
    for o in range(octaves):
        tot = tot + a * value_noise(p, s, seed + o)
        norm += a
        s *= 2.03
        a *= 0.5
    return tot / norm


# ---------------------------------------------------------------------------------------- meshing

def _grid_eval(field, lo, h, shape, chunk=400000):
    xs = lo[0] + h * np.arange(shape[0])
    ys = lo[1] + h * np.arange(shape[1])
    zs = lo[2] + h * np.arange(shape[2])
    P = np.stack(np.meshgrid(xs, ys, zs, indexing='ij'), -1).reshape(-1, 3)
    out = np.empty(len(P))
    for s in range(0, len(P), chunk):
        out[s:s + chunk] = field.eval(P[s:s + chunk])
    return out.reshape(shape)


def gradient(field, p, eps=1e-4):
    g = np.zeros_like(p)
    for a in range(3):
        d = np.zeros(3)
        d[a] = eps
        g[:, a] = field.eval(p + d) - field.eval(p - d)
    n = _len(g)
    return g / np.maximum(n, 1e-12)[:, None]


def mesh_field(field, res=0.006, lo=None, hi=None, coarse=4, project=2, verbose=True):
    """Surface nets on a narrow band. Returns (verts (V,3), quads (F,4)) with outward winding."""
    lo = np.asarray(field.lo if lo is None else lo, float) - 2 * res * coarse
    hi = np.asarray(field.hi if hi is None else hi, float) + 2 * res * coarse
    hc = res * coarse
    cshape = np.ceil((hi - lo) / hc).astype(int) + 1
    C = _grid_eval(field, lo, hc, tuple(cshape))
    # coarse cells near the surface
    cmin = np.minimum.reduce([C[dx:cshape[0] - 1 + dx, dy:cshape[1] - 1 + dy, dz:cshape[2] - 1 + dz]
                              for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)])
    cmax = np.maximum.reduce([C[dx:cshape[0] - 1 + dx, dy:cshape[1] - 1 + dy, dz:cshape[2] - 1 + dz]
                              for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)])
    band = hc * 1.8
    act = (cmin < band) & (cmax > -band)
    # fine grid initialised by trilinear interpolation of the coarse grid (sign is right away from the band)
    fshape = (cshape - 1) * coarse + 1
    from_idx = [np.arange(fshape[a]) / coarse for a in range(3)]
    F = np.empty(tuple(fshape))
    # separable trilinear interpolation
    i0 = [np.minimum(np.floor(f).astype(int), cshape[a] - 2) for a, f in enumerate(from_idx)]
    t = [f - i for f, i in zip(from_idx, i0)]
    Cx = C[i0[0]] * (1 - t[0])[:, None, None] + C[i0[0] + 1] * t[0][:, None, None]
    Cxy = Cx[:, i0[1]] * (1 - t[1])[None, :, None] + Cx[:, i0[1] + 1] * t[1][None, :, None]
    F[:] = Cxy[:, :, i0[2]] * (1 - t[2])[None, None, :] + Cxy[:, :, i0[2] + 1] * t[2][None, None, :]
    # evaluate exactly inside active coarse cells
    ai = np.argwhere(act)
    if verbose:
        print(f'[sdf] coarse {tuple(cshape)} active {len(ai)} cells, fine {tuple(fshape)}')
    off = np.stack(np.meshgrid(*[np.arange(coarse + 1)] * 3, indexing='ij'), -1).reshape(-1, 3)
    pts_idx = (ai[:, None, :] * coarse + off[None, :, :]).reshape(-1, 3)
    pts_idx = np.unique(pts_idx, axis=0)
    P = lo + pts_idx * res
    vals = np.empty(len(P))
    for s in range(0, len(P), 300000):
        vals[s:s + 300000] = field.eval(P[s:s + 300000])
    F[pts_idx[:, 0], pts_idx[:, 1], pts_idx[:, 2]] = vals

    inside = F < 0
    nx, ny, nz = fshape
    # cells with a sign change
    cs = [inside[dx:nx - 1 + dx, dy:ny - 1 + dy, dz:nz - 1 + dz] for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)]
    anyin = np.logical_or.reduce(cs)
    allin = np.logical_and.reduce(cs)
    cell = anyin & ~allin
    cidx = np.argwhere(cell)
    vid = -np.ones((nx - 1, ny - 1, nz - 1), np.int64)
    vid[cell] = np.arange(len(cidx))
    # vertex = mean of edge crossings
    acc = np.zeros((len(cidx), 3))
    cnt = np.zeros(len(cidx))
    corners = np.array([[dx, dy, dz] for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)])
    edges = [(a, b) for a in range(8) for b in range(a + 1, 8) if np.abs(corners[a] - corners[b]).sum() == 1]
    for a, b in edges:
        ca, cb = corners[a], corners[b]
        fa = F[cidx[:, 0] + ca[0], cidx[:, 1] + ca[1], cidx[:, 2] + ca[2]]
        fb = F[cidx[:, 0] + cb[0], cidx[:, 1] + cb[1], cidx[:, 2] + cb[2]]
        m = (fa < 0) != (fb < 0)
        tt = np.where(m, fa / np.where(m, fa - fb, 1), 0)
        pos = (cidx + ca + (cb - ca) * tt[:, None])
        acc[m] += pos[m]
        cnt[m] += 1
    V = lo + (acc / np.maximum(cnt, 1)[:, None]) * res
    # quads across every sign-changing grid edge
    quads = []
    for axis in range(3):
        o1, o2 = [(1, 2), (0, 2), (0, 1)][axis]
        sl_a = [slice(None)] * 3
        sl_b = [slice(None)] * 3
        sl_a[axis] = slice(0, -1)
        sl_b[axis] = slice(1, None)
        ea, eb = inside[tuple(sl_a)], inside[tuple(sl_b)]
        ch = ea != eb
        e = np.argwhere(ch)
        # the 4 cells around the edge: offsets 0/-1 in the two other axes
        valid = (e[:, o1] > 0) & (e[:, o2] > 0) & (e[:, o1] < [nx, ny, nz][o1] - 1) & (e[:, o2] < [nx, ny, nz][o2] - 1)
        valid &= e[:, axis] < [nx, ny, nz][axis] - 1
        e = e[valid]
        flip = ea[tuple(e.T)]
        cells = []
        for d1, d2 in ((0, 0), (-1, 0), (-1, -1), (0, -1)):
            c = e.copy()
            c[:, o1] += d1
            c[:, o2] += d2
            cells.append(vid[c[:, 0], c[:, 1], c[:, 2]])
        q = np.stack(cells, 1)
        ok = (q >= 0).all(1)
        q, flip = q[ok], flip[ok]
        q[flip] = q[flip][:, ::-1]
        if axis == 1:
            q = q[:, ::-1]
        quads.append(q)
    Q = np.concatenate(quads)[:, ::-1].copy()
    # project onto the surface
    for _ in range(project):
        d = field.eval(V)
        g = gradient(field, V, res * 0.25)
        V = V - (d[:, None] * g) * 0.9
    if verbose:
        print(f'[sdf] {len(V)} verts {len(Q)} quads')
    return V.astype(np.float32), Q.astype(np.int64)


# ---------------------------------------------------------------------------------------- lofts

def _catmull(vals, s):
    """Catmull-Rom interpolation of per-key values (K,) or (K,M) at fractional key index s (N,)."""
    vals = np.asarray(vals, float)
    K = len(vals)
    i = np.clip(np.floor(s).astype(int), 0, K - 2)
    t = np.clip(s - i, 0, 1)
    i0 = np.clip(i - 1, 0, K - 1)
    i2 = np.clip(i + 1, 0, K - 1)
    i3 = np.clip(i + 2, 0, K - 1)
    p0, p1, p2, p3 = vals[i0], vals[i], vals[i2], vals[i3]
    if vals.ndim > 1:
        t = t[:, None]
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


class Loft(Field):
    """Organic shape swept along a polyline spine through superellipse cross-sections.

    spine    (K,3) points along the shape's axis
    sections (K,5) per spine point: rx (across), ry (front-back), ox, oy (section centre offset in the
             frame), n (superellipse exponent: 2 = ellipse, larger = boxier)
    side     (3,) world vector for the frame's X axis (projected perpendicular to the spine)
    Sections are interpolated with Catmull-Rom so silhouettes stay smooth; the ends are rounded caps.
    """

    def __init__(self, spine, sections, side=(1, 0, 0), cap=1.0):
        self.sp = np.asarray(spine, float)
        self.sec = np.asarray(sections, float)
        self.cap = cap
        K = len(self.sp)
        self.K = K
        seg = self.sp[1:] - self.sp[:-1]
        self.seg = seg
        self.seglen2 = np.einsum('ij,ij->i', seg, seg) + 1e-12
        tang = np.zeros_like(self.sp)
        tang[:-1] += seg
        tang[1:] += seg
        tang /= np.linalg.norm(tang, axis=1)[:, None]
        sd = np.asarray(side, float)
        X = sd[None, :] - np.einsum('ij,j->i', tang, sd)[:, None] * tang
        X /= np.linalg.norm(X, axis=1)[:, None]
        Y = np.cross(tang, X)
        self.T, self.X, self.Y = tang, X, Y
        r = np.abs(self.sec[:, :2]).max(1) + np.abs(self.sec[:, 2:4]).max(1)
        self.lo = (self.sp - r[:, None]).min(0) - 0.01
        self.hi = (self.sp + r[:, None]).max(0) + 0.01

    def eval(self, p):
        N = len(p)
        best = np.full(N, np.inf)
        bs = np.zeros(N)
        for i in range(self.K - 1):
            a = self.sp[i]
            h = ((p - a) @ self.seg[i]) / self.seglen2[i]
            hc = np.clip(h, 0, 1)
            c = a + hc[:, None] * self.seg[i]
            dd = np.einsum('ij,ij->i', p - c, p - c)
            # prefer the segment whose unclamped projection falls inside it
            dd = dd + np.where((h < 0) & (i > 0), 1e3, 0) + np.where((h > 1) & (i < self.K - 2), 1e3, 0)
            m = dd < best
            best = np.where(m, dd, best)
            bs = np.where(m, i + h, bs)
        s = np.clip(bs, 0, self.K - 1)
        sec = _catmull(self.sec, s)
        rx, ry, ox, oy, n = sec[:, 0], sec[:, 1], sec[:, 2], sec[:, 3], np.maximum(sec[:, 4], 1.2)
        i = np.clip(np.floor(s).astype(int), 0, self.K - 2)
        t = (s - i)[:, None]
        c = self.sp[i] * (1 - t) + self.sp[i + 1] * t
        X = self.X[i] * (1 - t) + self.X[i + 1] * t
        Y = self.Y[i] * (1 - t) + self.Y[i + 1] * t
        T = self.T[i] * (1 - t) + self.T[i + 1] * t
        q = p - c
        lx = np.einsum('ij,ij->i', q, X) - ox
        ly = np.einsum('ij,ij->i', q, Y) - oy
        Lr = np.sqrt(lx * lx + ly * ly)
        dx = np.where(Lr > 1e-9, np.abs(lx) / np.maximum(Lr, 1e-9), 1.0)
        dy = np.where(Lr > 1e-9, np.abs(ly) / np.maximum(Lr, 1e-9), 0.0)
        # radius of the superellipse along the direction to the point
        rad = 1.0 / np.maximum(((dx / np.maximum(rx, 1e-5)) ** n + (dy / np.maximum(ry, 1e-5)) ** n) ** (1.0 / n), 1e-9)
        dr = Lr - rad
        # beyond the ends: rounded caps
        over = np.maximum(bs - (self.K - 1), 0) + np.maximum(-bs, 0)
        seglen = np.sqrt(np.where(bs < 0, self.seglen2[0], self.seglen2[-1]))
        ax_d = over * seglen
        rmin = np.minimum(rx, ry) * self.cap
        capd = np.sqrt(np.maximum(dr + rmin, 0) ** 2 + ax_d ** 2) - rmin
        return np.where(over > 0, np.maximum(capd, dr), dr) + 0 * T[:, 0]
