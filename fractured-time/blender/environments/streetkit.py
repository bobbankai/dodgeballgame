"""
Street furniture modelled in code (what Poly Haven's scanned sets do not cover):
  bollard   a cast-iron street bollard: plinth, tapered fluted shaft, collars, a domed cap, eyes for a chain
  chain     real links (alternating, each a stadium-shaped ring) hung between two points on a catenary
  lantern   a ribbed paper lantern with lacquered caps and a tassel; lit (emissive paper + an optional light)
  cables    overhead tangles of power and data cables strung between facades, sagging, a few of them carrying lanterns
Coordinates are Blender's (x, y, z); every builder returns objects the caller adds to a Section.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import hardpoly as H


def _lathe(name, profile, sides, material, flutes=0, flute_depth=0.0):
    """Surface of revolution about +Z from a (radius, z) profile (bottom to top), capped; `flutes` vertical grooves."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            rr = r * (1 - flute_depth * (0.5 + 0.5 * math.cos(a * flutes))) if flutes else r
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
    if profile[0][0] > 1e-4:
        bm.faces.new(list(reversed(rings[0])))
    if profile[-1][0] > 1e-4:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def bollard(name, x, y, z, M, height=0.92):
    """A cast-iron bollard (the kind that lines old city pavements): returns (object, chain-eye height)."""
    h = height
    prof = [(0.0, 0.0), (0.14, 0.0), (0.14, 0.035), (0.125, 0.06), (0.105, 0.075), (0.098, 0.1), (0.092, h * 0.62),
            (0.104, h * 0.64), (0.104, h * 0.67), (0.09, h * 0.69), (0.086, h * 0.8), (0.098, h * 0.82), (0.098, h * 0.85),
            (0.09, h * 0.87), (0.084, h * 0.9), (0.07, h * 0.95), (0.045, h * 0.985), (0.02, h * 0.998), (0.0, h)]
    body = _lathe(f'{name}_body', prof, 28, M['iron'], flutes=0)
    shaft = _lathe(f'{name}_flutes', [(0.094, 0.11), (0.089, h * 0.6)], 28, M['iron'], flutes=8, flute_depth=0.06)
    parts = [body, shaft]
    eye_z = h * 0.755
    for sx in (-1, 1):
        ring = _lathe(f'{name}_eye{sx}', [(0.022, -0.006), (0.026, 0.0), (0.022, 0.006)], 12, M['iron'])
        ring.matrix_world = Matrix.Translation((sx * 0.093, 0, eye_z)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
        parts.append(ring)
    ob = H.finish(parts, name, sharp_deg=50.0)
    ob.matrix_world = Matrix.Translation((x, y, z))
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob, z + eye_z


def _link(major=0.02, minor=0.0055, stretch=1.55, nu=10, nv=6):
    """One chain link: a stadium ring in the local XZ plane, long axis along X. Returns (verts, quads)."""
    V, F = [], []
    for i in range(nu):
        a = 2 * math.pi * i / nu
        cx, cz = math.cos(a) * major, math.sin(a) * major
        cx *= stretch
        tx, tz = -math.sin(a) * stretch, math.cos(a)
        t = math.hypot(tx, tz)
        nx, nz = tz / t, -tx / t  # in-plane outward normal of the centre line
        for j in range(nv):
            b = 2 * math.pi * j / nv
            V.append((cx + nx * math.cos(b) * minor, math.sin(b) * minor, cz + nz * math.cos(b) * minor))
    for i in range(nu):
        for j in range(nv):
            a0, a1 = i * nv + j, i * nv + (j + 1) % nv
            b0, b1 = ((i + 1) % nu) * nv + j, ((i + 1) % nu) * nv + (j + 1) % nv
            F.append((a0, b0, b1, a1))
    return np.array(V), F


def chain(name, a, b, M, sag=0.18, major=0.02, minor=0.0055):
    """Links hung from a to b on a catenary (approximated by a parabola), each link turned 90 degrees from the last."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    pitch = major * 2 * 1.55 + 0.006
    pts = [a + (b - a) * t - np.array([0, 0, sag * 4 * t * (1 - t)]) for t in np.linspace(0, 1, 64)]
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(s[-1] / (pitch - minor * 2.2)))
    V0, F0 = _link(major, minor)
    verts, faces = [], []
    for k in range(n):
        d = (k + 0.5) * s[-1] / n
        i = min(np.searchsorted(s, d) - 1, len(pts) - 2)
        i = max(i, 0)
        t = (d - s[i]) / max(seg[i], 1e-9)
        p = pts[i] + (pts[i + 1] - pts[i]) * t
        fx = (pts[i + 1] - pts[i]) / max(seg[i], 1e-9)
        up = np.array([0.0, 0.0, 1.0])
        side = np.cross(up, fx)
        side /= np.linalg.norm(side) + 1e-9
        upp = np.cross(fx, side)
        if k % 2:
            side, upp = upp, -side
        R = np.stack([fx, side, upp], 1)
        base = len(verts)
        verts.extend((V0 @ R.T + p).tolist())
        faces.extend([tuple(base + q for q in f) for f in F0])
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(M['iron'])
    return ob


def lantern(name, loc, M, radius=0.24, height=0.56):
    """A ribbed paper lantern (lit paper, lacquered black caps, a red tassel), hanging from its top at `loc`."""
    x, y, z = loc
    ribs = 14
    prof = []
    for i in range(ribs * 4 + 1):
        t = i / (ribs * 4)
        zz = -height * 0.08 - t * height * 0.84
        r = radius * math.sin(math.pi * (0.08 + 0.84 * t)) ** 0.8
        r *= 1 - 0.035 * abs(math.sin(math.pi * t * ribs))  # the bamboo ribs pull the paper in
        prof.append((r, zz))
    prof = list(reversed(prof))
    paper = _lathe(f'{name}_paper', prof, 32, M['lantern'])
    cap_t = H.hcyl(f'{name}_ct', (0, 0, -height * 0.06), radius * 0.42, height * 0.1, sides=24, chamfer=0.006, material=M['lacquer'])
    cap_b = H.hcyl(f'{name}_cb', (0, 0, -height * 0.94), radius * 0.42, height * 0.1, sides=24, chamfer=0.006, material=M['lacquer'])
    hook = H.rod(f'{name}_hk', (0, 0, -height * 0.01), (0, 0, 0.06), 0.004, material=M['iron'])
    tassel = H.hcyl(f'{name}_ts', (0, 0, -height - 0.1), 0.018, 0.16, sides=10, chamfer=0.003, material=M['tassel'])
    ob = H.finish([paper, cap_t, cap_b, hook, tassel], name, sharp_deg=60.0)
    ob.matrix_world = Matrix.Translation((x, y, z))
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True)
    return ob, (x, y, z - height * 0.5)


def sag_point(a, b, t, sag):
    a, b = np.asarray(a, float), np.asarray(b, float)
    return a + (b - a) * t - np.array([0, 0, sag * 4 * t * (1 - t)])
