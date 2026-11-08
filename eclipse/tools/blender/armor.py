"""Armour and clothing sculpted as signed-distance shells around a character's body.

A `Piece` is a field (negative inside the solid) plus a material function: after meshing, every
vertex gets the material id of the sub-part it lies on (vertex colour 'mat'), which is baked into an
ID map and drives texturing (steel, gold trim, leather, wool, mail, ...).

Geometry is built in the rig's rest pose, from bone positions, so the same recipes fit any body.
"""
import numpy as np
from mathutils import Vector

import sdf
from common import mesh_from_arrays, shade_smooth, color_attribute, decimate

# material ids (index into MATERIALS; colour = id map colour)
MATERIALS = [
    ('steel', (0.55, 0.56, 0.6)),
    ('darksteel', (0.18, 0.19, 0.22)),
    ('gold', (0.85, 0.62, 0.25)),
    ('leather', (0.36, 0.22, 0.12)),
    ('darkleather', (0.14, 0.09, 0.06)),
    ('wool', (0.24, 0.22, 0.24)),
    ('linen', (0.75, 0.70, 0.6)),
    ('mail', (0.4, 0.4, 0.42)),
    ('cloth_red', (0.42, 0.08, 0.07)),
    ('glow', (1.0, 0.8, 0.4)),
    ('bronze', (0.55, 0.36, 0.2)),
    ('bone', (0.82, 0.78, 0.66)),
    ('obsidian', (0.05, 0.045, 0.05)),
    ('ember', (1.0, 0.35, 0.05)),
    ('wood', (0.33, 0.22, 0.13)),
    ('rope', (0.55, 0.45, 0.3)),
    ('rust', (0.45, 0.25, 0.15)),
    ('charcloth', (0.12, 0.1, 0.09)),
    ('char', (0.08, 0.06, 0.05)),
]
MAT_INDEX = {n: i for i, (n, _) in enumerate(MATERIALS)}


def mat_color(name):
    """ID-map colour for a material: evenly spaced, unambiguous after texture filtering."""
    i = MAT_INDEX[name]
    return ((i % 4) / 3.0, ((i // 4) % 4) / 3.0, (i // 16) / 1.0 if i >= 16 else 0.0)


class Rig:
    """Bone positions of an armature in its rest pose (world space, numpy)."""

    def __init__(self, rig_obj):
        self.obj = rig_obj
        self.h = {}
        self.t = {}
        for b in rig_obj.data.bones:
            self.h[b.name] = np.array(rig_obj.matrix_world @ b.head_local)
            self.t[b.name] = np.array(rig_obj.matrix_world @ b.tail_local)

    def head(self, n):
        return self.h[n]

    def tail(self, n):
        return self.t[n]

    def at(self, n, f):
        return self.h[n] + (self.t[n] - self.h[n]) * f

    def axis(self, n):
        d = self.t[n] - self.h[n]
        return d / np.linalg.norm(d)

    def length(self, n):
        return float(np.linalg.norm(self.t[n] - self.h[n]))


def along(p, a, b):
    """(t, radial distance) of points relative to segment a->b (t unclamped, 0 at a, 1 at b)."""
    ab = b - a
    L2 = float(ab @ ab)
    t = ((p - a) @ ab) / L2
    proj = a + t[:, None] * ab
    return t, np.linalg.norm(p - proj, axis=1)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


class Piece:
    """A sculpted part: field + material assignment + skinning hint."""

    def __init__(self, name, field, bounds, materials, skin='transfer', voxel=0.003, budget=4000, mirror=False, inner=None):
        self.name = name
        # a field the piece is wrapped around (usually the body): the shell's inner wall, which faces
        # it and is never seen, is dropped so it costs no triangles and no texture space
        self.inner = inner
        self.field = field
        self.bounds = bounds  # (lo, hi)
        self.materials = materials  # callable(points) -> material index array, or a material name
        self.skin = skin  # 'transfer' | {'bone': name} | callable(points) -> {bone: weights}
        self.voxel = voxel
        self.budget = budget

    def build(self, coll=None):
        lo, hi = self.bounds
        v, f = sdf.mesh(self.field, lo, hi, self.voxel)
        if len(v) == 0:
            raise RuntimeError(f'piece {self.name} is empty')
        if self.inner is not None:
            v, f = drop_inner(v, f, self.inner)
        hi_obj = mesh_from_arrays(self.name + '_hi', v, f, coll)
        shade_smooth(hi_obj)
        if isinstance(self.materials, str):
            mids = np.full(len(v), MAT_INDEX[self.materials])
        else:
            mids = self.materials(v)
        cols = np.array([mat_color(MATERIALS[i][0]) + (1.0,) for i in range(len(MATERIALS))])
        color_attribute(hi_obj, 'mat', cols[mids])
        hi_obj['mat_ids'] = sorted(set(int(i) for i in np.unique(mids)))
        return hi_obj


def drop_inner(v, f, inner, cos_limit=-0.35):
    """Removes faces whose outward normal points into `inner` (the hidden wall of a shell)."""
    f = np.asarray(f)
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    n = np.cross(b - a, c - a)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    ctr = (a + b + c) / 3
    g = sdf.gradient(inner, ctr, h=1e-3)
    g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-12)
    keep = (n * g).sum(1) > cos_limit
    f = f[keep]
    used = np.unique(f)
    remap = np.full(len(v), -1)
    remap[used] = np.arange(len(used))
    return v[used], remap[f]


def material_by_fields(default, parts):
    """Material function: the part (field, material) whose surface is nearest wins, if within
    `reach`; otherwise `default`. parts: list of (field, material, reach)."""
    def f(p):
        out = np.full(len(p), MAT_INDEX[default])
        best = np.full(len(p), np.inf)
        for fld, mat, reach in parts:
            d = np.abs(fld(p)) if not callable(reach) else fld(p)
            if callable(reach):
                sel = reach(p)
            else:
                sel = d < reach
            take = sel & (d < best)
            out[take] = MAT_INDEX[mat]
            best[take] = d[take]
        return out
    return f


def low_poly(hi_obj, budget, name=None):
    """Decimated copy of a high-res piece (the bake target)."""
    import bpy
    lo = hi_obj.copy()
    lo.data = hi_obj.data.copy()
    lo.name = name or hi_obj.name.replace('_hi', '')
    bpy.context.scene.collection.objects.link(lo)
    decimate(lo, target_tris=budget)
    shade_smooth(lo)
    return lo
