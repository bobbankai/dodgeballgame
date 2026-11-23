"""Character production pipeline (model side), one function per stage.

 1 Reference Analysis      `Spec.reference` -> docs/art/<name>/reference.md (proportions in heads, palette,
                           silhouette and shape-language notes) — written by `write_reference`
 2 Parametric Blockout     Skeleton + Body proportions -> blockout render (capsules on the bones)
 3 Direct Polygon Modeling cage.build_cage(): planned edge loops, sockets, bridges, caps (all quads)
 4 Detail Sculpting        Catmull-Clark subdivision, every vertex projected onto the SDF sculpt
 5 Topology Refinement     tangential relax + re-projection, manifold/orientation checks
 6 Materials               per-vertex albedo, material class, SDF ambient occlusion, face mask/UVs
 7 Rigging                 armature from the skeleton, weights from the sculpt's anatomy, smoothed
                           over the mesh topology
 8 FK/IK Animation         (anims.py: shared library authored on this rig)
 9 Visual Testing          turnarounds, close-ups and deformation test poses rendered per stage
10 Optimization            LOD1 (decimated), triangle budget report, GLB export

Garments are extracted from the subdivided body topology and inflated onto their own sculpted surface
("extract & inflate"), hems are snapped to their cut lines, then solidified — so cloth has clean loops
that follow the body and deforms with the same weights.
"""
import math
import os
import time
import numpy as np
from . import sdf, skin, cage, polymodel as pm
from .sdf import Union, Intersect, Func, Plane

try:
    import bpy
    import bmesh
    from mathutils import Vector
    from . import bl
    from .character import build_armature, _set_uv as set_uv_layer, CLS, srgb, sdf_ao, vertex_normals
except ImportError:  # numeric checks outside Blender
    bpy = None


def complement(f):
    return Func(lambda p: -f.eval(p), None, None)


def everywhere():
    return Func(lambda p: np.full(len(p), -1.0))


# ------------------------------------------------------------------------------------------ helpers

def mesh_to_arrays(ob):
    me = ob.data
    V = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', V)
    F = [tuple(p.vertices) for p in me.polygons]
    return V.reshape(-1, 3).astype(float), F


def subdivide(V, F, levels=1, name='sub'):
    """Catmull-Clark in Blender (Subsurf applied). Returns arrays."""
    ob = bl.make_mesh(name, V, np.array(F), smooth=True)
    m = ob.modifiers.new('cc', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    m.subdivision_type = 'CATMULL_CLARK'
    m.boundary_smooth = 'PRESERVE_CORNERS'
    bl.apply_modifiers(ob)
    V2, F2 = mesh_to_arrays(ob)
    bpy.data.objects.remove(ob)
    return V2, F2


def face_centers(V, F):
    return np.array([V[list(f)].mean(0) for f in F])


def boundary_verts(F):
    edges = {}
    for f in F:
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            k = (min(a, b), max(a, b))
            edges[k] = edges.get(k, 0) + 1
    bv = set()
    for (a, b), c in edges.items():
        if c == 1:
            bv.add(a)
            bv.add(b)
    return np.array(sorted(bv), np.int64)


def extract(V, F, select):
    """Faces where select(face centre) is True -> new compact (V, F) and the source vertex index map."""
    C = face_centers(V, F)
    keep = np.nonzero(select(C))[0]
    Fs = [F[i] for i in keep]
    used = sorted({v for f in Fs for v in f})
    remap = {v: i for i, v in enumerate(used)}
    return V[used].copy(), [tuple(remap[v] for v in f) for f in Fs], np.array(used)


def snap_boundary(V, F, base, cut, iters=6):
    """Slides boundary vertices along the garment surface onto the cut line (cut(p) = 0), so hems are
    clean curves instead of a staircase of quads."""
    b = boundary_verts(F)
    if len(b) == 0:
        return V
    V = V.copy()
    for _ in range(iters):
        p = V[b]
        c = cut.eval(p)
        gc = sdf.gradient(cut, p, 0.002)
        gn = sdf.gradient(base, p, 0.002)
        t = gc - gn * np.einsum('ij,ij->i', gc, gn)[:, None]
        tl = np.einsum('ij,ij->i', t, t)
        # Newton step along the surface toward cut = 0, limited to 6 mm per iteration; vertices where the
        # cut barely changes along the surface (tangent gradient ~ 0) are left alone
        delta = -t * (c / np.maximum(tl, 1e-4))[:, None]
        mag = np.linalg.norm(delta, axis=1)
        delta *= (np.minimum(mag, 0.006) / np.maximum(mag, 1e-9))[:, None]
        delta[tl < 0.04] = 0
        V[b] = p + delta
        V[b] = pm.project(base, V[b], 2)
    return V


def tube(points, radii, n=6, normals=None, flat=1.0, cap_tip=True, cap_root=False):
    """Direct polygon tube along a centreline (hair clumps, tails, straps): rings of n verts, tapered,
    optionally flattened (flat < 1 squashes along `normals`). Returns (V, F)."""
    points = np.asarray(points, float)
    radii = np.broadcast_to(np.asarray(radii, float), (len(points),))
    V, F = [], []
    rings = []
    for i, p in enumerate(points):
        t = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
        t = t / max(np.linalg.norm(t), 1e-9)
        if normals is not None:
            nrm = np.asarray(normals[i] if np.ndim(normals) > 1 else normals, float)
            X = pm.norm(nrm - t * np.dot(nrm, t))
        else:
            X = pm.norm(np.cross(t, [0, 0, 1.0]) if abs(t[2]) < 0.9 else np.cross(t, [1.0, 0, 0]))
        Y = np.cross(t, X)
        r = max(radii[i], 1e-4)
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            ring.append(len(V))
            V.append(p + X * math.cos(a) * r * flat + Y * math.sin(a) * r)
        rings.append(ring)
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for k in range(n):
            k1 = (k + 1) % n
            F.append((r0[k], r0[k1], r1[k1], r1[k]))
    if cap_tip:
        tip = len(V)
        V.append(points[-1] + (points[-1] - points[-2]) * 0.25)
        last = rings[-1]
        for k in range(0, n, 2):
            F.append((last[k], last[(k + 1) % n], last[(k + 2) % n], tip) if n % 2 == 0 else (last[k], last[(k + 1) % n], tip, tip))
    if cap_root:
        root = len(V)
        V.append(points[0] - (points[1] - points[0]) * 0.2)
        first = rings[0]
        for k in range(0, n, 2):
            F.append((first[(k + 2) % n], first[(k + 1) % n], first[k], root))
    return np.array(V), F


def quad_sphere(center, radii, R=None, res=3):
    """Cube-sphere (all quads) mapped to an ellipsoid — knots, buttons, pommels."""
    R = np.eye(3) if R is None else np.asarray(R)
    V, F = [], []
    idx = {}

    def vid(p):
        key = tuple(np.round(p, 6))
        if key not in idx:
            idx[key] = len(V)
            V.append(np.array(p, float))
        return idx[key]
    g = np.linspace(-1, 1, res + 1)
    for axis in range(3):
        for sgn in (-1, 1):
            for i in range(res):
                for j in range(res):
                    quad = []
                    for (a, b) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                        p = np.zeros(3)
                        p[axis] = sgn
                        p[(axis + 1) % 3] = g[a]
                        p[(axis + 2) % 3] = g[b]
                        quad.append(vid(p))
                    F.append(tuple(quad) if sgn > 0 else tuple(quad[::-1]))
    V = np.array(V)
    V = V / np.linalg.norm(V, axis=1)[:, None]
    V = (V * np.asarray(radii)) @ R.T + np.asarray(center)
    return V, F


def box_mesh(center, half, R=None, bevel=0.0):
    """A bevelled box built in bmesh (plates, soles, buckles). Returns arrays."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 2 * half[0], v.co.y * 2 * half[1], v.co.z * 2 * half[2]))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect='EDGES', profile=0.5)
    V = np.array([v.co[:] for v in bm.verts])
    F = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    R = np.eye(3) if R is None else np.asarray(R)
    return V @ R.T + np.asarray(center), F


def shell(V, F, thickness):
    """Gives an open patch thickness: an inner copy pushed along -normal and rim quads joining the two
    along every boundary edge (clean, predictable hems). Returns (V, F)."""
    V = np.asarray(V, float)
    N = np.zeros_like(V)
    for f in F:
        p = V[list(f)]
        n = np.zeros(3)
        for i in range(len(f)):
            n += np.cross(p[i], p[(i + 1) % len(f)])
        for vi in f:
            N[vi] += n
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-12)[:, None]
    nv = len(V)
    Vi = V - N * thickness
    F2 = [tuple(f) for f in F] + [tuple(nv + i for i in f[::-1]) for f in F]
    edges = {}
    for f in F:
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            k = (min(a, b), max(a, b))
            edges.setdefault(k, []).append((a, b))
    for k, uses in edges.items():
        if len(uses) == 1:
            a, b = uses[0]
            F2.append((b, a, nv + a, nv + b))
    return np.concatenate([V, Vi]), F2


def solidify(ob, thickness, offset=-1.0):
    m = ob.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = True
    m.use_rim = True
    m.use_quality_normals = True
    bl.apply_modifiers(ob)


def smooth_weights(W, F, iters=2, amount=0.5, nv=None):
    """Laplacian smoothing of skin weights over the mesh topology (stage 7: removes kinks where the
    anatomy-based weights change abruptly)."""
    nb = pm.adjacency(F, len(W) if nv is None else nv)
    for _ in range(iters):
        avg = np.array([W[n].mean(0) if len(n) else W[i] for i, n in enumerate(nb)])
        W = W * (1 - amount) + avg * amount
    W = skin._finish(W, 4)
    return W
