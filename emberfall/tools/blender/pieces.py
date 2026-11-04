"""Procedural armour and cloth pieces built on the body surface (see outfit.Body)."""
import bpy
import bmesh
import math
import numpy as np
from mathutils import Vector, Matrix
import outfit as O


ARM_BONES = ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')


def arm_weight(g):
    return sum(w for n, w in g.items() if n.startswith(ARM_BONES))


def _zrange(body, z0, z1):
    return lambda i, c, g: z0 <= c[2] <= z1


def cuirass(body, name, mat, top, bottom, off=0.025, thick=0.007, front_only=False, smooth_iters=12, flare=0.0):
    """Torso plate between heights `bottom`..`top`; smoothed so anatomy reads as a moulded shell."""
    arm_l = body.bone('upperarm_l')[0]
    shoulder_x = abs(arm_l.x) + 0.01

    def pred(i, c, g):
        if not (bottom <= c[2] <= top):
            return False
        if abs(c[0]) > shoulder_x:
            return False
        if arm_weight(g) > 0.25 or body.weight(i, ['head']) > 0.3:
            return False
        if front_only and c[1] > 0.0:
            return False
        return True
    ob = body.region_mesh(name, pred)
    O.offset_along_normals(ob, lambda p: off + flare * max(0.0, (top - p.z) / max(top - bottom, 1e-3)) ** 2)
    O.smooth(ob, smooth_iters, 0.6)
    O.subdivide(ob, 1)
    body.fit(ob, off * 0.8)
    O.solidify(ob, thick, 1.0)
    O.bevel(ob, thick * 0.45, 2, 30)
    O.set_material(ob, mat)
    return ob


def band(body, name, mat, z0, z1, off, thick=0.004, smooth_iters=6, exclude_arms=True):
    """A band around the body (belt, obi, collar)."""
    def pred(i, c, g):
        if not (z0 <= c[2] <= z1):
            return False
        if exclude_arms and arm_weight(g) > 0.05:
            return False
        return True
    ob = body.region_mesh(name, pred)
    O.offset_along_normals(ob, lambda p: off)
    O.smooth(ob, smooth_iters, 0.6)
    body.fit(ob, off * 0.85)
    O.solidify(ob, thick, 1.0)
    O.bevel(ob, thick * 0.4, 1, 30)
    O.set_material(ob, mat)
    return ob


def limb_shell(body, name, mat, bone, t0, t1, off, side_fn=None, thick=0.005, smooth_iters=6, weight_min=0.5):
    """Shell around a limb segment between fractions t0..t1 along a bone (forearm guard, greave)."""
    h, t = body.bone(bone)
    axis = t - h
    L = axis.length
    axis.normalize()

    def pred(i, c, g):
        if body.weight(i, [bone]) < weight_min:
            return False
        p = Vector(c)
        s = (p - h).dot(axis) / L
        if not (t0 <= s <= t1):
            return False
        if side_fn and not side_fn(p, h, axis):
            return False
        return True
    ob = body.region_mesh(name, pred)
    O.offset_along_normals(ob, lambda p: off)
    O.smooth(ob, smooth_iters, 0.5)
    body.fit(ob, off * 0.8)
    O.solidify(ob, thick, 1.0)
    O.bevel(ob, thick * 0.45, 2, 30)
    O.set_material(ob, mat)
    return ob


def split_bands(ob, axis_origin, axis_dir, n, gap=0.004, step_out=0.004):
    """Cut a shell into n overlapping bands across an axis (lamellar plates). Returns new objects."""
    me = ob.data
    out = []
    coords = np.array([v.co[:] for v in me.vertices])
    s = (coords - np.array(axis_origin)) @ np.array(axis_dir)
    lo, hi = s.min(), s.max()
    edges = np.linspace(lo, hi, n + 1)
    for k in range(n):
        a, b = edges[k] - gap, edges[k + 1] + gap
        bm = bmesh.new()
        bm.from_mesh(me)
        dirv = Vector(axis_dir)
        orig = Vector(axis_origin)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        r = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=orig + dirv * a, plane_no=dirv, clear_inner=True)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=orig + dirv * b, plane_no=-dirv, clear_inner=True)
        if not bm.faces:
            bm.free()
            continue
        nm = bpy.data.meshes.new(f'{ob.name}_{k}')
        bm.to_mesh(nm)
        bm.free()
        o2 = bpy.data.objects.new(nm.name, nm)
        bpy.context.scene.collection.objects.link(o2)
        o2.matrix_world = ob.matrix_world
        for m in ob.data.materials:
            nm.materials.append(m)
        out.append(o2)
    bpy.data.objects.remove(ob)
    return out


def lamellar_pauldron(body, name, mat, side='l', rows=4, off=0.04, drop=0.0):
    """Sode-like shoulder guard: deltoid shell cut into overlapping rows, each row stepping out."""
    sh, el = body.bone(f'upperarm_{side}')
    cl = body.bone(f'clavicle_{side}')[0]
    sx = 1 if side == 'l' else -1
    axis = (el - sh).normalized()
    L = (el - sh).length

    def pred(i, c, g):
        p = Vector(c)
        if p.x * sx < abs(cl.x) + 0.04:
            return False
        s = (p - sh).dot(axis) / L
        if s > 0.62:
            return False
        if s < -0.25:
            return False
        if body.weight(i, ['hand_l', 'hand_r', 'head', 'neck_01']) > 0.1:
            return False
        # outer side of the arm only
        rel = p - sh
        outward = Vector((sx, 0, 0.35)).normalized()
        return rel.dot(outward) > -0.01
    ob = body.region_mesh(name, pred)
    O.offset_along_normals(ob, lambda p: off)
    O.smooth(ob, 10, 0.6)
    O.subdivide(ob, 1)
    body.fit(ob, off * 0.8)
    bands = split_bands(ob, sh, axis, rows, gap=0.012)
    res = []
    for k, b in enumerate(bands):
        # each lower row steps outward to overlap the one below
        O.offset_along_normals(b, lambda p, k=k: 0.004 * k)
        O.solidify(b, 0.005, 1.0)
        O.bevel(b, 0.0025, 2, 30)
        O.set_material(b, mat)
        res.append(b)
    return res


def join(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


def studs(points, normals, radius, mat, name):
    """Small domed rivets at points (low poly)."""
    bm = bmesh.new()
    for p, n in zip(points, normals):
        r = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=radius)
        q = Vector((0, 0, 1)).rotation_difference(Vector(n)).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(p) @ q @ Matrix.Diagonal((1, 1, 0.45, 1)), verts=r['verts'])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def rim_points(ob, every=0.03, inset=0.008):
    """Points along the boundary of a (non-solidified) shell, for studs / trims."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(ob.matrix_world)
    pts, nrm = [], []
    acc = 0.0
    for e in bm.edges:
        if not e.is_boundary:
            continue
        a, b = e.verts[0].co, e.verts[1].co
        acc += (b - a).length
        if acc >= every:
            acc = 0.0
            f = e.link_faces[0]
            c = f.calc_center_median()
            mid = (a + b) / 2
            pts.append(mid + (c - mid).normalized() * inset + f.normal * 0.004)
            nrm.append(f.normal.copy())
    bm.free()
    return pts, nrm


def lamellar_cuirass(body, name, mat, top, bottom, rows=6, off=0.03, thick=0.006):
    """Do-maru style breastplate: a moulded torso shell cut into overlapping horizontal rows."""
    arm_l = body.bone('upperarm_l')[0]
    shoulder_x = abs(arm_l.x) + 0.01

    def pred(i, c, g):
        if not (bottom <= c[2] <= top):
            return False
        if abs(c[0]) > shoulder_x:
            return False
        if arm_weight(g) > 0.2 or body.weight(i, ['head', 'neck_01']) > 0.3:
            return False
        return True
    ob = body.region_mesh(name, pred)
    O.offset_along_normals(ob, lambda p: off)
    O.smooth(ob, 14, 0.6)
    O.subdivide(ob, 1)
    body.fit(ob, off, rounds=4, smooth_iters=8)
    O.smooth(ob, 4, 0.5)
    bands = split_bands(ob, Vector((0, 0, top)), Vector((0, 0, -1)), rows, gap=0.006)
    res = []
    for k, b in enumerate(bands):
        O.offset_along_normals(b, lambda p, k=k: 0.0035 * k)
        O.solidify(b, thick, 1.0)
        O.bevel(b, thick * 0.4, 2, 30)
        O.set_material(b, mat)
        res.append(b)
    return join(res, name)


def mask(body, name, mat, eyes_obj=None, off=0.012, thick=0.004, brow=0.03, chin=-0.11, holes=0.017):
    """Face mask: front of the head from brow to chin, smoothed into a ceramic shell with eye holes."""
    hh, ht = body.bone('head')
    head = hh
    # eye centres from the eyeball proxy (two clusters split by x)
    ec = []
    if eyes_obj is not None:
        import numpy as np
        co = np.array([(eyes_obj.matrix_world @ v.co)[:] for v in eyes_obj.data.vertices])
        for sgn in (1, -1):
            sel = co[co[:, 0] * sgn > 0]
            if len(sel):
                c = sel.mean(0)
                ec.append(Vector((c[0], c[1] - 0.012, c[2])))
    top = (ec[0].z + brow) if ec else head.z + 0.12

    def pred(i, c, g):
        if body.weight(i, ['head']) < 0.5:
            return False
        p = Vector(c)
        if p.y > head.y - 0.02:
            return False
        if p.z > top or p.z < head.z + chin:
            return False
        if abs(p.x) > 0.075:
            return False
        for e in ec:
            if (p - e).length < holes:
                return False
        return True
    ob = body.region_mesh(name, pred)
    O.offset_along_normals(ob, lambda p: off)
    O.smooth(ob, 6, 0.5)
    O.subdivide(ob, 1)
    body.fit(ob, off * 0.8, rounds=2, smooth_iters=3)
    O.solidify(ob, thick, 1.0)
    O.bevel(ob, thick * 0.4, 1, 30)
    O.set_material(ob, mat)
    return ob
