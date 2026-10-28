"""
Sculpting with signed distance fields.

A shape is a function from points (N, 3) to signed distances (N,): negative inside. Shapes are
built from primitives (ellipsoids, round cones, rounded boxes, tori, surfaces of revolution...),
blended with smooth unions, carved with smooth subtractions, bent and displaced, and then meshed
into one organic surface: a narrow-band grid, surface nets, each vertex projected back onto the
exact field, decimated to a budget and shaded smooth. `bake_ao` bakes ambient occlusion into
vertex colours with Cycles, so creases and contact shadows are painted into every model.

Blender's Python ships numpy (no scipy), so everything here is plain vectorised numpy.
"""
import math

import bmesh
import bpy
import numpy as np

# --- vectors ---------------------------------------------------------------------------------


def V(x):
    return np.asarray(x, dtype=np.float64)


def _len(a):
    return np.sqrt(np.einsum('ij,ij->i', a, a))


def rot(rx=0.0, ry=0.0, rz=0.0):
    """Rotation matrix (local -> world) from XYZ euler angles in degrees."""
    x, y, z = (math.radians(a) for a in (rx, ry, rz))
    Rx = np.array([[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]])
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    Rz = np.array([[math.cos(z), -math.sin(z), 0], [math.sin(z), math.cos(z), 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def frame(z_axis, x_hint=(1, 0, 0)):
    """Rotation whose local Z is `z_axis` (local X as close to `x_hint` as it can be)."""
    z = V(z_axis) / np.linalg.norm(z_axis)
    x = V(x_hint) - z * np.dot(V(x_hint), z)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross(z, (0, 1, 0)) if abs(z[1]) < 0.9 else np.cross(z, (1, 0, 0))
    x /= np.linalg.norm(x)
    return np.stack([x, np.cross(z, x), z], axis=1)


def _local(P, c, R):
    q = P - V(c)
    return q @ R if R is not None else q


def smooth01(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --- primitives --------------------------------------------------------------------------------


def sphere(c, r):
    c = V(c)
    return lambda P: _len(P - c) - r


def ellipsoid(c, radii, R=None):
    """Ellipsoid (iq's bound: exact on the surface, close nearby)."""
    r = V(radii)

    def f(P):
        q = _local(P, c, R)
        k0 = _len(q / r)
        k1 = _len(q / (r * r))
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    return f


def cone(a, b, ra, rb):
    """Round cone: a capsule from a (radius ra) to b (radius rb)."""
    a, b = V(a), V(b)
    ba = b - a
    l2 = float(ba @ ba)
    rr = ra - rb
    a2 = l2 - rr * rr
    il2 = 1.0 / l2

    def f(P):
        pa = P - a
        y = pa @ ba
        z = y - l2
        w = pa * l2 - np.outer(y, ba)
        x2 = np.einsum('ij,ij->i', w, w)
        y2 = y * y * l2
        z2 = z * z * l2
        k = math.copysign(1.0, rr) * rr * rr * x2
        d_mid = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - ra
        d_b = np.sqrt(x2 + z2) * il2 - rb
        d_a = np.sqrt(x2 + y2) * il2 - ra
        return np.where(np.sign(z) * a2 * z2 > k, d_b, np.where(np.sign(y) * a2 * y2 < k, d_a, d_mid))
    return f


def tube(pts, radii, k=0.0):
    """A chain of round cones through the points (one radius per point)."""
    pts = [V(p) for p in pts]
    parts = [cone(pts[i], pts[i + 1], radii[i], radii[i + 1]) for i in range(len(pts) - 1)]
    return union(*parts, k=k)


def box(c, half, r=0.0, R=None):
    """Rounded box: half extents (outer, rounding included) and corner radius r."""
    h = V(half) - r

    def f(P):
        q = np.abs(_local(P, c, R)) - h
        out = _len(np.maximum(q, 0.0))
        return out + np.minimum(q.max(axis=1), 0.0) - r
    return f


def torus(c, R_major, r_minor, R=None):
    """Torus around the local Z axis."""
    def f(P):
        q = _local(P, c, R)
        a = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - R_major
        return np.sqrt(a * a + q[:, 2] ** 2) - r_minor
    return f


def cylinder(c, r, h, rr=0.0, R=None):
    """Capped cylinder along local Z, radius r, half height h, edges rounded by rr."""
    def f(P):
        q = _local(P, c, R)
        d0 = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - r + rr
        d1 = np.abs(q[:, 2]) - h + rr
        out = np.sqrt(np.maximum(d0, 0) ** 2 + np.maximum(d1, 0) ** 2)
        return out + np.minimum(np.maximum(d0, d1), 0.0) - rr
    return f


def plane(p, n):
    """Half space below the plane through p with outward normal n."""
    n = V(n) / np.linalg.norm(n)
    p = V(p)
    return lambda P: (P - p) @ n


def curve(xs, ys):
    """Smooth monotone cubic through (xs, ys): returns y(x) and dy/dx(x) for numpy arrays."""
    xs, ys = V(xs), V(ys)
    h = np.diff(xs)
    dlt = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[1:-1] = np.where(dlt[:-1] * dlt[1:] > 0, (dlt[:-1] + dlt[1:]) / 2, 0.0)
    m[0], m[-1] = dlt[0], dlt[-1]

    def ev(x):
        x = np.clip(x, xs[0], xs[-1])
        i = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]
        dy = ((6 * t2 - 6 * t) * ys[i] + (3 * t2 - 4 * t + 1) * h[i] * m[i] + (-6 * t2 + 6 * t) * ys[i + 1] + (3 * t2 - 2 * t) * h[i] * m[i + 1]) / h[i]
        return y, dy
    return ev


def revolve(profile, c=(0, 0, 0), depth=1.0, rmod=None):
    """Surface of revolution about Z through c: profile [(radius, z)] (z increasing), squashed to
    `depth` front to back. rmod(th, z) -> radius multiplier adds folds and asymmetry (th = 0 at +X,
    -pi/2 at the front). Open at both ends of the profile (close it with a union or intersection)."""
    zs = [z for _, z in profile]
    rs = [r for r, _ in profile]
    ev = curve(zs, rs)
    c = V(c)

    def f(P):
        q = P - c
        th = np.arctan2(q[:, 1] / depth, q[:, 0])
        rho = np.sqrt(q[:, 0] ** 2 + (q[:, 1] / depth) ** 2)
        r, dr = ev(q[:, 2])
        if rmod is not None:
            r = r * rmod(th, q[:, 2])
        d = (rho - r) / np.sqrt(1.0 + dr * dr)
        # beyond the ends the shape is capped flat (callers usually trim it further)
        zc = np.maximum(zs[0] - q[:, 2], q[:, 2] - zs[-1])
        return np.maximum(d * min(1.0, depth) ** 0.5, zc)
    return f


def polyline_dist(pts):
    """Distance from points to a 3D polyline (for straps, piping, stitched seams...)."""
    pts = [V(p) for p in pts]

    def f(P):
        best = np.full(len(P), np.inf)
        for a, b in zip(pts, pts[1:]):
            ab = b - a
            t = np.clip(((P - a) @ ab) / float(ab @ ab), 0.0, 1.0)
            best = np.minimum(best, _len(P - a - np.outer(t, ab)))
        return best
    return f


# --- operations --------------------------------------------------------------------------------


def _smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def union(*fs, k=0.0):
    """Union; k > 0 blends the shapes together over about k metres."""
    fs = [f for f in fs if f is not None]

    def f(P):
        d = fs[0](P)
        for g in fs[1:]:
            d = _smin(d, g(P), k)
        return d
    return f if len(fs) > 1 else fs[0]


def subtract(base, cut, k=0.0):
    """Carve `cut` out of `base`, with a rounded (k > 0) inner edge."""
    def f(P):
        a, b = base(P), cut(P)
        if k <= 0:
            return np.maximum(a, -b)
        h = np.clip(0.5 - 0.5 * (a + b) / k, 0.0, 1.0)
        return a + (-b - a) * h + k * h * (1.0 - h)
    return f


def intersect(*fs, k=0.0):
    def f(P):
        d = fs[0](P)
        for g in fs[1:]:
            e = g(P)
            if k <= 0:
                d = np.maximum(d, e)
            else:
                h = np.clip(0.5 - 0.5 * (e - d) / k, 0.0, 1.0)
                d = e + (d - e) * h + k * h * (1.0 - h)
        return d
    return f


def offset(f, r):
    """Grow (r > 0) or shrink the shape by r."""
    return lambda P: f(P) - r


def shell(f, t):
    """A skin of thickness t centred on the surface (cloth, hoods, cups)."""
    return lambda P: np.abs(f(P)) - t / 2


def displace(f, fn):
    """Push the surface out by fn(P) metres (keep it small: a few mm of folds, grooves, knit)."""
    return lambda P: f(P) - fn(P)


def warp(f, fn):
    """Evaluate f in a deformed space: fn maps world points to the shape's rest points."""
    return lambda P: f(fn(P))


def mirror_x(f):
    """Make a shape symmetric across X = 0 (model the +X side only)."""
    def f2(P):
        Q = P.copy()
        Q[:, 0] = np.abs(Q[:, 0])
        return f(Q)
    return f2


# --- noise ---------------------------------------------------------------------------------------


def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = h & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFF) / 65535.0


def noise(P, freq=1.0, seed=0):
    """Smooth value noise in [0, 1]."""
    X = P * freq
    I = np.floor(X).astype(np.int64)
    F = X - I
    S = F * F * (3 - 2 * F)
    out = np.zeros(len(P))
    for dx in (0, 1):
        wx = S[:, 0] if dx else 1 - S[:, 0]
        for dy in (0, 1):
            wy = S[:, 1] if dy else 1 - S[:, 1]
            for dz in (0, 1):
                wz = S[:, 2] if dz else 1 - S[:, 2]
                out += wx * wy * wz * _hash(I[:, 0] + dx, I[:, 1] + dy, I[:, 2] + dz, seed)
    return out


def fbm(P, freq=1.0, octaves=3, seed=0):
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * noise(P, freq * 2 ** o, seed + o)
        tot += amp
        amp *= 0.5
    return out / tot


# --- meshing -------------------------------------------------------------------------------------

_CORNERS = np.array([(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)])
_EDGES = [(a, b) for a in range(8) for b in range(8) if a < b and np.abs(_CORNERS[a] - _CORNERS[b]).sum() == 1]


def _eval(f, P, chunk=1_500_000):
    out = np.empty(len(P))
    for i in range(0, len(P), chunk):
        out[i:i + chunk] = f(P[i:i + chunk])
    return out


def _grad(f, P, e):
    g = np.empty_like(P)
    for a in range(3):
        d = np.zeros(3)
        d[a] = e
        g[:, a] = (_eval(f, P + d) - _eval(f, P - d)) / (2 * e)
    return g


def polygonize(f, lo, hi, step, project=2, block=4):
    """Surface nets over a narrow band: returns verts (V, 3) and outward quads (F, 4)."""
    lo, hi = V(lo), V(hi)
    nc = np.ceil((hi - lo) / (step * block)).astype(int) + 1      # coarse points per axis
    n = (nc - 1) * block + 1                                       # fine points per axis
    # coarse pass: which blocks can hold the surface
    ax = [lo[a] + np.arange(nc[a]) * step * block for a in range(3)]
    G = np.stack(np.meshgrid(*ax, indexing='ij'), -1).reshape(-1, 3)
    dc = _eval(f, G).reshape(nc)
    thr = step * block * 2.6
    near = np.zeros(nc - 1, dtype=bool)
    sgn = dc < 0
    s_any = np.zeros(nc - 1, dtype=bool)
    s_all = np.ones(nc - 1, dtype=bool)
    for (i, j, k) in _CORNERS:
        sl = (slice(i, nc[0] - 1 + i), slice(j, nc[1] - 1 + j), slice(k, nc[2] - 1 + k))
        near |= np.abs(dc[sl]) < thr
        s_any |= sgn[sl]
        s_all &= sgn[sl]
    near |= s_any & ~s_all
    # fine pass, only inside the near blocks; elsewhere the coarse value's sign is enough
    d = np.repeat(np.repeat(np.repeat(dc, block, 0), block, 1), block, 2)[:n[0], :n[1], :n[2]].astype(np.float32)
    cb = np.argwhere(near)
    off = np.array([(i, j, k) for i in range(block + 1) for j in range(block + 1) for k in range(block + 1)])
    lin = np.unique(np.ravel_multi_index((cb[:, None, :] * block + off[None]).reshape(-1, 3).T, n))
    idx = np.stack(np.unravel_index(lin, n), -1)
    d.flat[lin] = _eval(f, lo + idx * step)
    # surface nets: one vertex per cell the surface crosses ...
    s = d < 0
    c_any = np.zeros(n - 1, dtype=bool)
    c_all = np.ones(n - 1, dtype=bool)
    for (i, j, k) in _CORNERS:
        sl = (slice(i, n[0] - 1 + i), slice(j, n[1] - 1 + j), slice(k, n[2] - 1 + k))
        c_any |= s[sl]
        c_all &= s[sl]
    cells = np.argwhere(c_any & ~c_all)
    cell_lin = np.ravel_multi_index(cells.T, n - 1)
    cv = np.stack([d[tuple((cells + c).T)] for c in _CORNERS], 1).astype(np.float64)
    acc = np.zeros((len(cells), 3))
    cnt = np.zeros(len(cells))
    for a, b in _EDGES:
        m = (cv[:, a] < 0) != (cv[:, b] < 0)
        t = np.where(m, cv[:, a] / np.where(m, cv[:, a] - cv[:, b], 1.0), 0.0)
        p = _CORNERS[a] + t[:, None] * (_CORNERS[b] - _CORNERS[a])
        acc += p * m[:, None]
        cnt += m
    verts = lo + (cells + acc / cnt[:, None]) * step
    # ... and one quad per grid edge it crosses, joining the four cells around that edge
    quads = []
    for axis in range(3):
        a1, a2 = (axis + 1) % 3, (axis + 2) % 3
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[axis] = slice(0, n[axis] - 1)
        sl1[axis] = slice(1, n[axis])
        e = s[tuple(sl0)] != s[tuple(sl1)]
        e_idx = np.argwhere(e)
        ok = (e_idx[:, a1] > 0) & (e_idx[:, a2] > 0) & (e_idx[:, a1] < n[a1] - 1) & (e_idx[:, a2] < n[a2] - 1)
        e_idx = e_idx[ok]
        inside_first = s[tuple(e_idx.T)]
        ring = []
        for da1, da2 in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            c = e_idx.copy()
            c[:, a1] += da1
            c[:, a2] += da2
            ring.append(np.searchsorted(cell_lin, np.ravel_multi_index(c.T, n - 1)))
        q = np.stack(ring, 1)
        q[~inside_first] = q[~inside_first][:, ::-1]
        quads.append(q)
    quads = np.concatenate(quads)
    # project each vertex onto the exact surface (sharper, truer than the voxel average)
    for _ in range(project):
        dv = _eval(f, verts)
        g = _grad(f, verts, step * 0.25)
        gl2 = np.maximum(np.einsum('ij,ij->i', g, g), 1e-12)
        mv = -(dv / gl2)[:, None] * g
        ml = _len(mv)
        mv *= (np.minimum(ml, step * 0.9) / np.maximum(ml, 1e-12))[:, None]
        verts = verts + mv
    return verts, quads


def to_mesh(name, verts, quads, material=None):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.astype(np.float32).ravel())
    me.loops.add(len(quads) * 4)
    me.loops.foreach_set('vertex_index', quads.astype(np.int32).ravel())
    me.polygons.add(len(quads))
    me.polygons.foreach_set('loop_start', np.arange(0, len(quads) * 4, 4, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material is not None:
        me.materials.append(material)
    return ob


def tidy(ob, tris=None, smooth_iters=0):
    """Merge slivers, optionally relax, decimate to about `tris` triangles, shade smooth."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    # surface nets can pinch two sheets together at a vertex: those are rare and tiny, drop loose bits
    if smooth_iters:
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(ob.data)
    bm.free()
    if tris:
        cur = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if cur > tris:
            md = ob.modifiers.new('decimate', 'DECIMATE')
            md.decimate_type = 'COLLAPSE'
            md.ratio = tris / cur
            md.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=md.name)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def sculpt(name, f, lo, hi, step, material=None, tris=None, project=2):
    """Mesh a shape into a smooth-shaded Blender object (the one call most scripts need)."""
    verts, quads = polygonize(f, lo, hi, step, project=project)
    ob = to_mesh(name, verts, quads, material)
    return tidy(ob, tris)


# --- ambient occlusion ---------------------------------------------------------------------------


def bake_ao(objs, distance=0.15, samples=64):
    """Bake ambient occlusion (all objects in the scene occlude) into each object's 'AO' point colours.
    Returns {object name: per-vertex AO (0 = fully occluded, 1 = open)}."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new('ao_world')
    scene.world.light_settings.distance = distance
    out = {}
    for ob in objs:
        me = ob.data
        if 'AO' in me.color_attributes:
            me.color_attributes.remove(me.color_attributes['AO'])
        attr = me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = attr
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        a = np.empty(len(me.vertices) * 4, dtype=np.float32)
        attr.data.foreach_get('color', a)
        out[ob.name] = a.reshape(-1, 4)[:, 0].astype(np.float64)
        me.color_attributes.remove(attr)
    return out
