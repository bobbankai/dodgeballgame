"""Clothes cut from the base mesh's 'tights' helper (a bodysuit that already carries the rig's weights) or,
for wraps and tape, from the skin itself. A garment is: a selection of faces, pushed out along the normals,
optionally smoothed into loose cloth, with hems flared, edges turned in and material bands."""
import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
import tex
from hair import box_uv

ARM = ('shoulder01', 'upperarm', 'lowerarm', 'wrist', 'metacarpal', 'finger')
LIMB = ('upperarm', 'lowerarm', 'wrist', 'metacarpal', 'finger')   # the shoulder cap counts as torso: armholes are cut by distance
LEG = ('upperleg', 'lowerleg', 'foot', 'toe')


class Feat:
    """Per-face features of a source mesh, for writing garment selections as short expressions.
    x, y, z: face centre. arm / leg: 0 at the shoulder / hip, 1 at the elbow / knee, 2 at the wrist / ankle
    (-1 off the limb). side: +1 left, -1 right. torso: not on a limb. bone: dominant bone name."""

    def __init__(self, obj, R):
        me = obj.data
        names = {g.index: g.name for g in obj.vertex_groups}
        dom = []
        for v in me.vertices:
            best = max(((g.weight, names[g.group]) for g in v.groups if names[g.group] in R), default=(0, 'root'))
            dom.append(best[1])
        self.vdom = dom
        co = np.array([v.co[:] for v in me.vertices], np.float32)
        self.c = np.array([np.mean(co[list(p.vertices)], 0) for p in me.polygons], np.float32)
        self.x, self.y, self.z = self.c[:, 0], self.c[:, 1], self.c[:, 2]
        self.side = np.sign(self.x)
        fdom = []
        for p in me.polygons:
            ds = [dom[v] for v in p.vertices]
            fdom.append(max(set(ds), key=ds.count))
        self.bone = np.array(fdom)
        is_arm = np.array([b.startswith(ARM) for b in fdom])
        is_leg = np.array([b.startswith(LEG) for b in fdom])
        self.torso = ~np.array([b.startswith(LIMB) for b in fdom]) & ~is_leg
        self.arm = np.full(len(fdom), -1.0, np.float32)
        self.leg = np.full(len(fdom), -1.0, np.float32)
        self.foot = np.full(len(fdom), -1.0, np.float32)   # 0 at the ankle .. 1 at the ball of the foot
        for s, sd in ((1, 'L'), (-1, 'R')):
            sh, el, wr = R[f'upperarm01.{sd}'][0], R[f'lowerarm01.{sd}'][0], R[f'wrist.{sd}'][0]
            hp, kn, an = R[f'upperleg01.{sd}'][0], R[f'lowerleg01.{sd}'][0], R[f'foot.{sd}'][0]
            for joints, arr, sel in (((sh, el, wr), self.arm, is_arm), ((hp, kn, an), self.leg, is_leg)):
                m = sel & (self.side == s)
                a, b, c3 = joints
                t1 = ((self.c - a) @ (b - a)) / np.dot(b - a, b - a)
                t2 = ((self.c - b) @ (c3 - b)) / np.dot(c3 - b, c3 - b)
                arr[m] = np.where(t2[m] > 0, 1 + t2[m], np.clip(t1[m], -0.5, 1))
            an, ball = R[f'foot.{sd}'][0], R[f'foot.{sd}'][1]
            m = np.array([b.startswith(('foot', 'toe')) for b in fdom]) & (self.side == s)
            self.foot[m] = (((self.c - an) @ (ball - an)) / np.dot(ball - an, ball - an))[m]
        self.R = R

    def J(self, bone):
        return self.R[bone][0]

    def on(self, *prefixes):
        """faces whose dominant bone starts with one of the prefixes"""
        return np.array([b.startswith(prefixes) for b in self.bone])

    def near(self, point, radius):
        return np.linalg.norm(self.c - np.asarray(point, np.float32), axis=1) < radius

    def armholes(self, radius=0.08, out=0.02):
        """faces round both shoulder joints (sleeveless cuts)"""
        l, r = self.J('upperarm01.L'), self.J('upperarm01.R')
        return self.near(l + np.array([out, 0, 0]), radius) | self.near(r - np.array([out, 0, 0]), radius)


def garment(src, R, name, sel, mat, offset=0.004, smooth=0, flare=0.0, rim=0.004, bands=(), uv_scale=1.0, relax=0.0, drop=None, zcuts=(), cuts=()):
    """sel: fn(Feat) -> bool per face. bands: [(fn(Feat) -> bool per face of the cut garment, material)].
    zcuts: heights where the mesh is sliced first, so hems and bands that follow them are straight.
    cuts: [(point, normal, radius)] the same for planes across a limb (only geometry within radius is sliced).
    smooth: laplacian passes (loose cloth loses the body's detail). flare: metres the lowest hem opens outwards.
    relax: extra offset added after smoothing. drop: fn(Feat) -> metres to pull each face's verts down."""
    o = src.copy()
    o.data = src.data.copy()
    o.name = o.data.name = name
    bpy.context.scene.collection.objects.link(o)
    o.shape_key_clear()
    bm = bmesh.new()
    bm.from_mesh(o.data)
    surf = BVHTree.FromBMesh(bm)
    for zc in zcuts:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, zc), plane_no=(0, 0, 1))
    for pt, no, rad in cuts:
        fs = [f for f in bm.faces if (f.calc_center_median() - Vector(pt)).length < rad]
        geom = list({v for f in fs for v in f.verts}) + list({e for f in fs for e in f.edges}) + fs
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(pt), plane_no=Vector(no))
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(o.data)
    o.data.update()
    keep = sel(Feat(o, R))
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[fc for fc in bm.faces if not keep[fc.index]], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    level = {v: zc for v in bm.verts for zc in zcuts if abs(v.co.z - zc) < 2e-4}   # sliced edges stay level
    # hems cut along face edges are stair-stepped: relax every open edge into a clean curve on the surface
    for _ in range(10):
        moves = {}
        for v in bm.verts:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                moves[v] = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3
        for v, c in moves.items():
            hit = surf.find_nearest(c)[0]
            v.co = hit if hit is not None else c
            if v in level:
                v.co.z = level[v]
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset
    for v, zc in level.items():
        v.co.z = zc
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v, zc in level.items():   # sliced edges stay level: straight hems and bands
            v.co.z = zc
    bm.normal_update()
    if relax:
        for v in bm.verts:
            v.co += v.normal * relax
    if flare:
        zv = [v.co.z for v in bm.verts]
        z0, z1 = min(zv), max(zv)
        for v in bm.verts:
            t = max(0.0, 1 - (v.co.z - z0) / max(0.25 * (z1 - z0), 1e-4))
            n = Vector((v.normal.x, v.normal.y, 0))
            v.co += n * flare * t * t
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    g = Feat(o, R)
    if drop is not None:
        d = drop(g)
        vd = np.zeros(len(o.data.vertices), np.float32)
        for p in o.data.polygons:
            for v in p.vertices:
                vd[v] = max(vd[v], d[p.index])
        for v in o.data.vertices:
            v.co.z -= vd[v.index]
    o.data.materials.clear()
    o.data.materials.append(mat)
    for i, (fn, m) in enumerate(bands):
        o.data.materials.append(m)
        mask = fn(g)
        for p in o.data.polygons:
            if mask[p.index]:
                p.material_index = i + 1
    if rim:  # turn every open edge in towards the body so the cloth reads as having thickness
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        edges = [e for e in bm.edges if e.is_boundary]
        nrm = {v: v.normal.copy() for e in edges for v in e.verts}
        r = bmesh.ops.extrude_edge_only(bm, edges=edges)
        new = [v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)]
        olds = list(nrm)
        kd = KDTree(len(olds))
        for i, v in enumerate(olds):
            kd.insert(v.co, i)
        kd.balance()
        for v in new:
            v.co -= nrm[olds[kd.find(v.co)[1]]] * rim
        bm.to_mesh(o.data)
        bm.free()
    for p in o.data.polygons:
        p.use_smooth = True
    box_uv(o.data, uv_scale)
    return o


def limb_cut(R, a, b, t, radius=0.13):
    """a slicing plane across a limb at fraction t between two bones' heads, for garment(cuts=...)"""
    pa, pb = R[a][0], R[b][0]
    return (tuple(pa + (pb - pa) * t), tuple((pb - pa) / np.linalg.norm(pb - pa)), radius)


def hide_skin(body, garments, reach=0.03, edge=0.022):
    """Delete skin that lies under a garment and well inside its border (no poke-through, fewer triangles)."""
    trees = []
    for g in garments:
        bm = bmesh.new()
        bm.from_mesh(g.data)
        bvh = BVHTree.FromBMesh(bm)
        rim = [v.co.copy() for e in bm.edges if e.is_boundary for v in e.verts]
        kd = KDTree(max(len(rim), 1))
        for i, c in enumerate(rim):
            kd.insert(c, i)
        kd.balance()
        trees.append((bvh, kd, bool(rim)))
        bm.free()
    covered = np.zeros(len(body.data.vertices), bool)
    for v in body.data.vertices:
        for bvh, kd, has_rim in trees:
            hit = bvh.ray_cast(v.co - v.normal * 0.002, v.normal, reach)
            if hit[0] is not None and (not has_rim or kd.find(hit[0])[2] > edge):
                covered[v.index] = True
                break
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(covered[v.index] for v in f.verts)], context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()


def soles(obj, thickness=0.012, mat=None, floor=0.0):
    """Flatten the underside of footwear onto the floor and give the sole band its own material."""
    me = obj.data
    if mat:
        me.materials.append(mat)
    idx = len(me.materials) - 1
    for v in me.vertices:
        if v.co.z < floor + 0.02 and v.normal.z < -0.25:
            v.co.z = floor
    if mat:
        for p in me.polygons:
            if max(me.vertices[v].co.z for v in p.vertices) < floor + thickness + 0.012:
                p.material_index = idx
