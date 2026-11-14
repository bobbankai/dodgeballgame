"""
Polygonal hard-surface modelling (machines, armour plates, props): clean planar faces, crisp chamfers, weighted normals.

SDF meshing (sdf.py) is right for organic and soft forms; for machined parts it leaves flat faces crumpled after decimation, and the
crumples catch light and edge wear. These helpers build real polygons instead:
  hbox      bevelled box (chamfer width, optional rotation)
  plate     a designed 2D outline extruded to a thickness, chamfered rims (armour plates, fins, brackets)
  hcyl      cylinder / hex bolt / piston (n sides)
  cut       slice a mesh with a plane and cap it (tapers, sloped noses, wedges)
  carve     exact boolean difference with another mesh (vent slots, bays, slits)
  finish    join pieces into one object, smooth shading with sharp edges by angle + weighted normals (flat faces read flat)
Coordinates are Blender's (x, y, z). Rotations are 3x3 numpy matrices (local -> world), e.g. sdf.rot() / sdf.frame().
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector


def _mat4(center, R):
    M = Matrix.Identity(4)
    if R is not None:
        for i in range(3):
            for j in range(3):
                M[i][j] = float(R[i][j])
    M.translation = Vector([float(c) for c in center])
    return M


def _new(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material is not None:
        me.materials.append(material)
    return ob


def hbox(name, center, half, chamfer=0.02, R=None, material=None, segments=1):
    """Box with half extents `half`, every edge chamfered by `chamfer` (segments=1: a flat 45-degree chamfer that catches a highlight)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector([2 * h for h in half]), verts=bm.verts)
    if chamfer > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(chamfer, min(half) * 0.9), segments=segments, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
    bmesh.ops.transform(bm, matrix=_mat4(center, R), verts=bm.verts)
    return _new(name, bm, material)


def plate(name, outline, thickness, center, R=None, chamfer=0.015, material=None, bevel_back=False):
    """A plate: 2D outline [(u, v), ...] (counter-clockwise, metres) in the local XZ plane, extruded along local -Y by `thickness`
    (local +Y is the outer face), front rim chamfered. Placed at `center` with rotation R."""
    bm = bmesh.new()
    vs = [bm.verts.new((u, 0.0, v)) for u, v in outline]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, -thickness, 0)), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if chamfer > 0:
        # chamfer the rim of the outer face (and optionally the back), not the side seams between outline corners
        outer = [e for e in bm.edges if all(abs(v.co.y) < 1e-6 for v in e.verts)]
        back = [e for e in bm.edges if all(abs(v.co.y + thickness) < 1e-6 for v in e.verts)] if bevel_back else []
        bmesh.ops.bevel(bm, geom=outer + back, offset=min(chamfer, thickness * 0.6), segments=1, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
    bmesh.ops.transform(bm, matrix=_mat4(center, R), verts=bm.verts)
    return _new(name, bm, material)


def hcyl(name, center, radius, height, R=None, sides=24, chamfer=0.004, material=None):
    """Cylinder along local Z (sides=6: a hex bolt head)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=radius, radius2=radius, depth=height)
    if chamfer > 0:
        caps = [e for e in bm.edges if abs(abs(e.verts[0].co.z) - height / 2) < 1e-6 and abs(abs(e.verts[1].co.z) - height / 2) < 1e-6]
        bmesh.ops.bevel(bm, geom=caps, offset=min(chamfer, radius * 0.4), segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.transform(bm, matrix=_mat4(center, R), verts=bm.verts)
    return _new(name, bm, material)


def frame_z(axis, x_hint=(1, 0, 0)):
    """Rotation whose local Z is `axis`."""
    z = np.asarray(axis, float)
    z = z / np.linalg.norm(z)
    x = np.asarray(x_hint, float)
    x = x - z * (x @ z)
    if np.linalg.norm(x) < 1e-6:
        x = np.array([0.0, 1.0, 0.0]) - z * z[1]
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], 1)


def rod(name, a, b, radius, sides=16, material=None, chamfer=0.003):
    """Cylinder from point a to point b (pistons, axles, pins)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    return hcyl(name, (a + b) / 2, radius, float(np.linalg.norm(b - a)), R=frame_z(b - a), sides=sides, chamfer=chamfer, material=material)


def bolts(name, center, R, pts, normal_local, radius=0.022, height=0.014, material=None):
    """Hex bolt heads at local points `pts` of a surface frame (center, R), standing out along `normal_local`."""
    n = (R if R is not None else np.eye(3)) @ np.asarray(normal_local, float)
    F = frame_z(n)
    out = []
    for i, p in enumerate(pts):
        c = np.asarray(center, float) + (R if R is not None else np.eye(3)) @ np.asarray(p, float) + n * height / 2
        out.append(hcyl(f'{name}{i}', c, radius, height, R=F, sides=6, chamfer=0.003, material=material))
    return out


def cut(ob, point, normal):
    """Remove everything on the +normal side of the plane through `point`, and cap the opening."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(point) - ob.location, plane_no=Vector(normal), clear_outer=True)
    edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def carve(ob, cutters, union=False):
    """Exact boolean: subtract (or add) the cutter meshes, then delete the cutters."""
    for c in cutters:
        m = ob.modifiers.new('bool', 'BOOLEAN')
        m.operation = 'UNION' if union else 'DIFFERENCE'
        m.solver = 'EXACT'
        m.object = c
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=m.name)
    for c in cutters:
        bpy.data.objects.remove(c)
    return ob


def finish(objs, name, sharp_deg=32.0):
    """Join pieces into one object (multi-material kept), smooth shading, sharp edges above `sharp_deg`, weighted normals applied."""
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(sharp_deg))
    wn = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    wn.keep_sharp = True
    wn.weight = 100
    bpy.ops.object.modifier_apply(modifier=wn.name)
    return ob


def triangles(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)
