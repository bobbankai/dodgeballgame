"""Signed distance field sculpting (numpy).

A field is a function f(P) -> distances for an (N, 3) array of points (negative inside). Build shapes
from primitives and smooth booleans, then `mesh()` samples the field on a grid, extracts the surface
with marching cubes (scikit-image) and returns vertices + faces; `to_object()` makes a Blender mesh.

`BodyField` gives the signed distance to an arbitrary closed mesh (a character's body) from dense
surface samples and a k-d tree, so armour and clothing can be sculpted as shells offset from the
body: `shell(offset(body, 0.02), 0.004)` is a 4 mm plate floating 2 cm above the skin.
"""
import numpy as np
from scipy.spatial import cKDTree
from skimage import measure

# ---------------------------------------------------------------- primitives


def sphere(c, r):
    c = np.asarray(c, float)
    return lambda p: np.linalg.norm(p - c, axis=1) - r


def ellipsoid(c, radii):
    c = np.asarray(c, float)
    r = np.asarray(radii, float)

    def f(p):
        q = (p - c) / r
        k0 = np.linalg.norm(q, axis=1)
        k1 = np.linalg.norm(q / r, axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    return f


def box(c, half, round_=0.0, rot=None):
    c = np.asarray(c, float)
    h = np.asarray(half, float) - round_
    R = None if rot is None else np.asarray(rot, float)

    def f(p):
        q = p - c
        if R is not None:
            q = q @ R  # world -> local (R columns are local axes)
        q = np.abs(q) - h
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(np.max(q, axis=1), 0) - round_
    return f


def capsule(a, b, r, r2=None):
    """Capsule / tapered capsule (cone with round ends) from a to b."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    r2 = r if r2 is None else r2

    def f(p):
        pa = p - a
        ba = b - a
        h = np.clip((pa @ ba) / max(ba @ ba, 1e-12), 0, 1)
        return np.linalg.norm(pa - h[:, None] * ba, axis=1) - (r + (r2 - r) * h)
    return f


def cylinder(a, b, r):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    ba = b - a
    L = np.linalg.norm(ba)
    u = ba / L

    def f(p):
        pa = p - a
        t = pa @ u
        radial = np.linalg.norm(pa - t[:, None] * u, axis=1) - r
        axial = np.abs(t - L / 2) - L / 2
        d = np.stack([radial, axial], 1)
        return np.minimum(np.max(d, 1), 0) + np.linalg.norm(np.maximum(d, 0), axis=1)
    return f


def torus(c, axis, R, r):
    c = np.asarray(c, float)
    ax = np.asarray(axis, float)
    ax = ax / np.linalg.norm(ax)

    def f(p):
        q = p - c
        y = q @ ax
        rad = np.linalg.norm(q - y[:, None] * ax, axis=1)
        return np.sqrt((rad - R) ** 2 + y ** 2) - r
    return f


def plane(n, d=0.0):
    """Half-space n.p - d <= 0 is inside."""
    n = np.asarray(n, float)
    n = n / np.linalg.norm(n)
    return lambda p: p @ n - d


def polyline_tube(points, r):
    """Union of capsules along a polyline (r may be a per-point list)."""
    pts = [np.asarray(x, float) for x in points]
    rs = r if isinstance(r, (list, tuple, np.ndarray)) else [r] * len(pts)
    parts = [capsule(pts[i], pts[i + 1], rs[i], rs[i + 1]) for i in range(len(pts) - 1)]
    return union(*parts)

# ---------------------------------------------------------------- operators


def union(*fs):
    def f(p):
        d = fs[0](p)
        for g in fs[1:]:
            d = np.minimum(d, g(p))
        return d
    return f


def intersect(*fs):
    def f(p):
        d = fs[0](p)
        for g in fs[1:]:
            d = np.maximum(d, g(p))
        return d
    return f


def subtract(a, *bs):
    def f(p):
        d = a(p)
        for b in bs:
            d = np.maximum(d, -b(p))
        return d
    return f


def smooth_union(a, b, k):
    def f(p):
        da, db = a(p), b(p)
        h = np.clip(0.5 + 0.5 * (db - da) / k, 0, 1)
        return db * (1 - h) + da * h - k * h * (1 - h)
    return f


def smooth_subtract(a, b, k):
    def f(p):
        da, db = a(p), -b(p)
        h = np.clip(0.5 - 0.5 * (db - da) / k, 0, 1)
        return da * (1 - h) + db * h + k * h * (1 - h)
    return f


def smooth_intersect(a, b, k):
    def f(p):
        da, db = a(p), b(p)
        h = np.clip(0.5 - 0.5 * (db - da) / k, 0, 1)
        return db * (1 - h) + da * h + k * h * (1 - h)
    return f


def offset(a, d):
    """Grow (d > 0) or shrink a shape. `d` may be a function of position."""
    if callable(d):
        return lambda p: a(p) - d(p)
    return lambda p: a(p) - d


def shell(a, thickness):
    """Hollow surface of the given thickness centred on a's zero level."""
    if callable(thickness):
        return lambda p: np.abs(a(p)) - thickness(p) * 0.5
    return lambda p: np.abs(a(p)) - thickness * 0.5


def displace(a, fn):
    return lambda p: a(p) - fn(p)


def transform(a, M):
    """Apply a 4x4 world->local matrix to the query points."""
    M = np.asarray(M, float)
    Minv = np.linalg.inv(M)
    return lambda p: a(p @ Minv[:3, :3].T + Minv[:3, 3])


def mirror_x(a):
    return lambda p: a(np.column_stack([np.abs(p[:, 0]), p[:, 1], p[:, 2]]))

# ---------------------------------------------------------------- noise


def _hash3(i):
    i = i.astype(np.int64)
    h = (i[..., 0] * 73856093) ^ (i[..., 1] * 19349663) ^ (i[..., 2] * 83492791)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def value_noise(p, scale=1.0, seed=0):
    q = p * scale + seed * 17.13
    i = np.floor(q)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out = out + w * _hash3(i + np.array([dx, dy, dz]))
    return out


def fbm(p, scale=1.0, octaves=4, seed=0, gain=0.5):
    s, a, amp = 0.0, 1.0, 0.0
    for o in range(octaves):
        s = s + a * value_noise(p, scale * (2.03 ** o), seed + o * 7)
        amp += a
        a *= gain
    return s / amp

# ---------------------------------------------------------------- body distance


class BodyField:
    """Signed distance to a closed triangle mesh from dense area-weighted surface samples."""

    def __init__(self, verts, tris, samples=900000, seed=1):
        v = np.asarray(verts, float)
        t = np.asarray(tris, int)
        a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
        n = np.cross(b - a, c - a)
        area = np.linalg.norm(n, axis=1) * 0.5
        fn = n / np.maximum(area[:, None] * 2, 1e-12)
        rng = np.random.default_rng(seed)
        pick = rng.choice(len(t), size=samples, p=area / area.sum())
        r1, r2 = rng.random(samples), rng.random(samples)
        s = np.sqrt(r1)
        u, w = 1 - s, s * (1 - r2)
        pts = a[pick] * u[:, None] + b[pick] * w[:, None] + c[pick] * (s * r2)[:, None]
        # vertex-normal interpolation gives smoother signs than face normals near creases
        vn = np.zeros_like(v)
        for k in range(3):
            np.add.at(vn, t[:, k], n)
        vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
        nrm = vn[t[pick, 0]] * u[:, None] + vn[t[pick, 1]] * w[:, None] + vn[t[pick, 2]] * (s * r2)[:, None]
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
        self.points = pts
        self.normals = nrm
        self.face_normals = fn
        self.tree = cKDTree(pts)

    def __call__(self, p):
        d, i = self.tree.query(p, k=1, workers=-1)
        sign = np.sign(np.einsum('ij,ij->i', p - self.points[i], self.normals[i]))
        sign[sign == 0] = 1
        return d * sign

    def nearest_normal(self, p):
        _, i = self.tree.query(p, k=1, workers=-1)
        return self.normals[i]

# ---------------------------------------------------------------- meshing


def grid(lo, hi, voxel):
    lo = np.asarray(lo, float)
    hi = np.asarray(hi, float)
    n = np.maximum(np.ceil((hi - lo) / voxel).astype(int) + 1, 2)
    axes = [lo[k] + np.arange(n[k]) * voxel for k in range(3)]
    return axes, n


def _eval(field, P, chunk=1_500_000):
    D = np.empty(len(P))
    for s in range(0, len(P), chunk):
        D[s:s + chunk] = field(P[s:s + chunk])
    return D


def sample(field, lo, hi, voxel, coarse=4, band=3.0):
    """Field values on a regular grid. Two-level narrow band: the field is evaluated exactly only in
    coarse cells that may contain the surface; elsewhere coarse values are interpolated (their sign
    and rough magnitude are all marching cubes needs there)."""
    from scipy.ndimage import map_coordinates
    axes, n = grid(lo, hi, voxel)
    if coarse <= 1 or min(n) < coarse * 3:
        X, Y, Z = np.meshgrid(*axes, indexing='ij')
        return _eval(field, np.column_stack([X.ravel(), Y.ravel(), Z.ravel()])).reshape(n), axes
    cv = voxel * coarse
    cax, cn = grid(lo, np.asarray(lo) + (np.asarray(n) - 1) * voxel + cv, cv)
    CX, CY, CZ = np.meshgrid(*cax, indexing='ij')
    Dc = _eval(field, np.column_stack([CX.ravel(), CY.ravel(), CZ.ravel()])).reshape(cn)
    # fine grid indices -> coarse coordinates
    fi = [np.arange(n[k]) / coarse for k in range(3)]
    FI, FJ, FK = np.meshgrid(*fi, indexing='ij')
    D = map_coordinates(Dc, [FI.ravel(), FJ.ravel(), FK.ravel()], order=1, mode='nearest').reshape(n)
    near = np.abs(D) < band * cv
    idx = np.nonzero(near.ravel())[0]
    if len(idx):
        ii = np.unravel_index(idx, n)
        P = np.column_stack([axes[0][ii[0]], axes[1][ii[1]], axes[2][ii[2]]])
        D.ravel()[idx] = _eval(field, P)
    return D, axes


def mesh(field, lo, hi, voxel, project=2, coarse=4):
    """Sample `field` on a grid and return (verts, faces) of its zero level set (outward normals)."""
    D, axes = sample(field, lo, hi, voxel, coarse)
    if D.min() >= 0 or D.max() <= 0:
        return np.zeros((0, 3)), np.zeros((0, 3), int)
    verts, faces, _, _ = measure.marching_cubes(D, level=0.0, spacing=(voxel, voxel, voxel))
    verts += np.asarray(lo, float)
    faces = faces[:, ::-1]
    for _ in range(project):
        verts = project_to_surface(field, verts, voxel)
    return verts, faces


def gradient(field, p, h=1e-4):
    ex = np.array([h, 0, 0])
    ey = np.array([0, h, 0])
    ez = np.array([0, 0, h])
    g = np.column_stack([field(p + ex) - field(p - ex), field(p + ey) - field(p - ey), field(p + ez) - field(p - ez)])
    return g / (2 * h)


def project_to_surface(field, v, voxel):
    """One Newton step towards the zero level (sharpens creases the grid smoothed)."""
    d = field(v)
    g = gradient(field, v, voxel * 0.25)
    gl2 = np.maximum((g * g).sum(1), 1e-12)
    step = (d / gl2)[:, None] * g
    step_len = np.linalg.norm(step, axis=1)
    lim = voxel * 0.75
    step *= np.minimum(1, lim / np.maximum(step_len, 1e-12))[:, None]
    return v - step


def to_object(name, verts, faces, coll=None, smooth=True):
    from common import mesh_from_arrays, shade_smooth
    obj = mesh_from_arrays(name, verts, faces, coll)
    if smooth:
        shade_smooth(obj)
    return obj
