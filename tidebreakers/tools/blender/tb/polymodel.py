"""Direct polygon modeling of character base meshes (pure numpy), and the detail-sculpt projection.

Pipeline stage 3 (Direct Polygon Modeling): the body is box-modelled as planned edge loops — a trunk
tube (pelvis, chest, neck, head) with grid caps, arm and leg tubes bridged into sockets cut in the trunk,
hands with a knuckle strip that fingers are bridged onto, a thumb socket, feet that turn forward to the
toes. Every vertex sits on an edge loop placed on purpose: extra loops at elbows, knees, wrists, ankles,
shoulders and hips where the mesh bends. Loop vertices are placed on the sculpt by casting rays from the
loop's centre in the loop's plane (the way a retopologist draws loops over a sculpt).

Stage 4 (Detail Sculpting) and 5 (Topology Refinement): after Catmull-Clark subdivision in Blender, every
vertex is projected onto the full sculpt (muscles, face, smooth blends), then relaxed tangentially and
re-projected so quads stay even.

All faces are quads; the mesh is closed and manifold (checked).
"""
import math
import numpy as np


def norm(a):
    return a / np.linalg.norm(a)


class Poly:
    """A growing quad mesh."""

    def __init__(self):
        self.V = []
        self.F = []
        self.tag = []     # per-vertex tag (which tube / region made it)

    def add(self, pts, tag=''):
        i0 = len(self.V)
        for p in pts:
            self.V.append(np.asarray(p, float))
            self.tag.append(tag)
        return list(range(i0, i0 + len(pts)))

    def quad(self, a, b, c, d):
        self.F.append((a, b, c, d))

    def loft(self, rings, closed=True):
        """Quads between consecutive rings (lists of vertex indices of equal length)."""
        for r0, r1 in zip(rings[:-1], rings[1:]):
            n = len(r0)
            for k in range(n if closed else n - 1):
                k1 = (k + 1) % n
                self.quad(r0[k], r0[k1], r1[k1], r1[k])

    def remove_faces(self, faces):
        s = set(faces)
        self.F = [f for f in self.F if tuple(f) not in s]

    def arrays(self):
        """Vertices/faces with unused vertices (hole interiors) removed."""
        V = np.array(self.V)
        F = np.array(self.F, np.int64)
        used = np.unique(F)
        remap = -np.ones(len(V), np.int64)
        remap[used] = np.arange(len(used))
        self.tag = [self.tag[i] for i in used]
        return V[used], remap[F]


def grid_cap(P, ring, w, d, center, inward, tag='', bulge=0.0):
    """Close a ring of 2(w+d) vertices with a w x d grid of quads. The ring is walked as the perimeter of
    the grid (w along one side, d along the next, ...). Interior vertices are placed by bilinear (Coons)
    interpolation of the perimeter, then pushed along `inward` (negative bulge = domed outward).
    Returns the grid as a (d+1) x (w+1) array of vertex indices."""
    n = len(ring)
    assert n == 2 * (w + d), (n, w, d)
    G = -np.ones((d + 1, w + 1), np.int64)
    # perimeter order: top row left->right, right column top->bottom, bottom row right->left, left col up
    idx = 0
    for x in range(w):
        G[0, x] = ring[idx]; idx += 1
    for y in range(d):
        G[y, w] = ring[idx]; idx += 1
    for x in range(w, 0, -1):
        G[d, x] = ring[idx]; idx += 1
    for y in range(d, 0, -1):
        G[y, 0] = ring[idx]; idx += 1
    V = P.V
    for y in range(1, d):
        for x in range(1, w):
            u, v = x / w, y / d
            top, bot = V[G[0, x]], V[G[d, x]]
            lef, rig = V[G[y, 0]], V[G[y, w]]
            c00, c10, c01, c11 = V[G[0, 0]], V[G[0, w]], V[G[d, 0]], V[G[d, w]]
            p = (1 - v) * top + v * bot + (1 - u) * lef + u * rig - (
                (1 - u) * (1 - v) * c00 + u * (1 - v) * c10 + (1 - u) * v * c01 + u * v * c11)
            # dome: interior points pushed by bulge * (1 - distance to the edge)
            e = min(u, 1 - u, v, 1 - v) * 2
            p = p - np.asarray(inward) * bulge * math.sin(e * math.pi / 2)
            G[y, x] = P.add([p], tag)[0]
    for y in range(d):
        for x in range(w):
            P.quad(G[y, x], G[y, x + 1], G[y + 1, x + 1], G[y + 1, x])
    return G


def _newell(pts):
    n = np.zeros(3)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])])
    return n


def bridge(P, loopA, loopB):
    """Join two closed loops of equal length with quads. Both loops are first made to turn the same way
    around the axis joining them (Newell normals agree), then the rotation with least twist is chosen."""
    n = len(loopA)
    assert n == len(loopB), (n, len(loopB))
    A = np.array([P.V[i] for i in loopA])
    B0 = np.array([P.V[i] for i in loopB])
    lb = list(loopB)
    if np.dot(_newell(A), _newell(B0)) < 0:
        lb = lb[::-1]
    B = np.array([P.V[i] for i in lb])
    best = None
    for s in range(n):
        cost = np.linalg.norm(A - np.roll(B, -s, axis=0), axis=1).sum()
        if best is None or cost < best[0]:
            best = (cost, s)
    s0 = best[1]
    lb = [lb[(k + s0) % n] for k in range(n)]
    for k in range(n):
        k1 = (k + 1) % n
        P.quad(loopA[k], loopA[k1], lb[k1], lb[k])


def boundary_loop(F, faces_removed):
    """Ordered boundary vertex loop of a patch of faces (the hole left after removing them)."""
    edges = {}
    for f in faces_removed:
        for i in range(4):
            a, b = f[i], f[(i + 1) % 4]
            key = (min(a, b), max(a, b))
            edges[key] = edges.get(key, 0) + 1
    bnd = [e for e, c in edges.items() if c == 1]
    adj = {}
    for a, b in bnd:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    start = bnd[0][0]
    loop = [start]
    prev = None
    cur = start
    while True:
        nxts = [x for x in adj[cur] if x != prev]
        nxt = nxts[0]
        if nxt == start:
            break
        loop.append(nxt)
        prev, cur = cur, nxt
        if len(loop) > 1000:
            raise RuntimeError('boundary walk failed')
    return loop


# ------------------------------------------------------------------------------------------ ray slicing

def slice_ring(field, center, X, Y, n, start=0.0, rmax=0.35, step=0.0015, fallback=0.03, ellipse=None, axis=None):
    """Loop vertices on the sculpt: rays from `center` in the plane (X, Y) at n angles, each stopping at
    the first exit from the field. Angle 0 is +X, increasing toward +Y. With `axis`, Y is flipped if needed
    so every loop of a tube turns the same way around the tube (no twisted bands between loops)."""
    if axis is not None and np.dot(np.cross(X, Y), axis) < 0:
        Y = -Y
    ang = start + np.arange(n) * 2 * math.pi / n
    dirs = np.cos(ang)[:, None] * X[None] + np.sin(ang)[:, None] * Y[None]
    ts = np.arange(0, rmax, step)
    P = center[None, None, :] + dirs[:, None, :] * ts[None, :, None]
    d = field.eval(P.reshape(-1, 3)).reshape(n, len(ts))
    out = []
    for i in range(n):
        row = d[i]
        inside = row < 0
        j = None
        if inside[0]:
            cross = np.nonzero(~inside)[0]
            if len(cross):
                j = cross[0]
        if j is None or j == 0:
            r = fallback if ellipse is None else ellipse[i]
        else:
            a, b = row[j - 1], row[j]
            r = ts[j - 1] + step * (a / (a - b))
        out.append(center + dirs[i] * r)
    return out


def frame_for(axis, side):
    """Orthonormal (X, Y) spanning the plane perpendicular to axis, X closest to `side`."""
    t = norm(np.asarray(axis, float))
    s = np.asarray(side, float)
    X = s - t * np.dot(s, t)
    if np.linalg.norm(X) < 1e-6:
        X = np.cross(t, [0, 0, 1.0])
    X = norm(X)
    Y = np.cross(t, X)
    return X, Y


# ------------------------------------------------------------------------------------------ projection

def project(field, V, iters=3, damp=1.0, eps=0.0015):
    """Moves points onto the zero set along the field gradient (stage 4: detail sculpting)."""
    from .sdf import gradient
    V = V.copy()
    for _ in range(iters):
        d = field.eval(V)
        g = gradient(field, V, eps)
        V = V - g * (d * damp)[:, None]
    return V


def adjacency(F, nv):
    nb = [set() for _ in range(nv)]
    for f in F:
        k = len(f)
        for i in range(k):
            a, b = f[i], f[(i + 1) % k]
            nb[a].add(b)
            nb[b].add(a)
    return [np.array(sorted(s), np.int64) for s in nb]


def relax(field, V, F, iters=4, amount=0.5, keep=None):
    """Stage 5 (topology refinement): tangential Laplacian relax + re-projection evens out quad sizes
    without shrinking the shape. `keep` (bool mask) pins vertices."""
    nb = adjacency(F, len(V))
    from .sdf import gradient
    for _ in range(iters):
        avg = np.array([V[n].mean(0) if len(n) else V[i] for i, n in enumerate(nb)])
        g = gradient(field, V, 0.0015)
        delta = avg - V
        delta = delta - g * np.einsum('ij,ij->i', delta, g)[:, None]  # tangential only
        if keep is not None:
            delta[keep] = 0
        V = V + delta * amount
        V = project(field, V, 2)
    return V


def check_manifold(F):
    edges = {}
    for f in F:
        k = len(f)
        for i in range(k):
            a, b = f[i], f[(i + 1) % k]
            key = (min(a, b), max(a, b))
            edges[key] = edges.get(key, 0) + 1
    bad = [e for e, c in edges.items() if c != 2]
    return len(bad), len(edges)
