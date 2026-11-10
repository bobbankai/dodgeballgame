"""Hair made from scratch: shell layers for cropped hair, beards and afro puffs, braids as real three-strand
geometry on a bone chain. Tight hair (cornrows, slicked back) is painted into the scalp by skin.py."""
import math
import bmesh
import bpy
import numpy as np
from mathutils import Vector
import tex
from tex import fbm


def box_uv(me, scale=1.0):
    """planar UVs along each face's dominant axis, in metres * scale"""
    uv = me.uv_layers.active or me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        ax = int(np.argmax(np.abs(p.normal)))
        a, b = [i for i in range(3) if i != ax]
        for li, vi in zip(p.loop_indices, p.vertices):
            c = me.vertices[vi].co
            uv.data[li].uv = (c[a] * scale, c[b] * scale)


def shells(src, faces, name, layers, length, color, uv_scale=1.0, sag=0.0, taper=1.25, length_fn=None, density=1.0, seed=0):
    """Fur shells grown from some faces of src: each layer is the patch pushed further along its normals,
    with vertex alpha falling towards the tip. The shader cuts a dot pattern by that alpha (strands that taper).
    length_fn(positions) scales the length per vertex (fades). Weights come from src."""
    sm = src.data
    used = sorted({v for p in sm.polygons if faces[p.index] for v in p.vertices})
    remap = {v: i for i, v in enumerate(used)}
    co = np.array([sm.vertices[v].co[:] for v in used], np.float32)
    no = np.array([sm.vertices[v].normal[:] for v in used], np.float32)
    lw = np.ones(len(used), np.float32) if length_fn is None else length_fn(co).astype(np.float32)
    jit = 0.75 + 0.5 * fbm(co, 55, 2, seed)
    polys = [p for p in sm.polygons if faces[p.index]]
    src_uv = sm.uv_layers.active.data
    verts, fcs, uvs, alpha = [], [], [], []
    n = len(used)
    for i in range(layers + 1):
        t = i / layers
        off = (length * lw * jit * t ** 0.9)[:, None] * no
        off[:, 2] -= sag * lw * t * t
        verts.append(co + off)
        alpha.append(np.full(n, 1 - t ** taper, np.float32))
        for p in polys:
            fcs.append([remap[v] + i * n for v in p.vertices])
            uvs.extend((src_uv[li].uv[0] * uv_scale, src_uv[li].uv[1] * uv_scale) for li in p.loop_indices)
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.concatenate(verts).tolist(), [], fcs)
    me.uv_layers.new(name='UVMap').data.foreach_set('uv', np.array(uvs, np.float32).ravel())
    a = np.concatenate(alpha)
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', np.stack([np.ones_like(a)] * 3 + [a], 1).ravel())
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    for g in src.vertex_groups:  # weights follow the source vertices
        w = {}
        for j, v in enumerate(used):
            for ge in sm.vertices[v].groups:
                if ge.group == g.index and ge.weight > 1e-4:
                    w[j] = ge.weight
        if w:
            ng = o.vertex_groups.new(name=g.name)
            for j, wt in w.items():
                ng.add([j + i * n for i in range(layers + 1)], wt, 'REPLACE')
    me.materials.append(tex.material(name, base=tex.hexc(color), rough=0.8, double=True, tb={'k': 'shell', 'c': color, 'd': density}))
    return o


def puff(name, center, radius, color, bone='head', squash=(1, 1, 1), lumps=0.16, layers=7, fuzz=0.022, seed=0):
    """An afro puff: a lumpy ball with fuzzy shells, rigid on one bone."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        d = v.co.normalized()
        k = 1 + lumps * (float(fbm(np.array([d[:]], np.float32), 2.2, 3, seed)[0]) - 0.5) * 2
        v.co = Vector((d.x * squash[0], d.y * squash[1], d.z * squash[2])) * radius * k + Vector(center)
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(name + '_core')
    bm.to_mesh(me)
    bm.free()
    box_uv(me, 20.0)   # one strand tile is 5 cm
    core = bpy.data.objects.new(name + '_core', me)
    bpy.context.scene.collection.objects.link(core)
    core.vertex_groups.new(name=bone).add(range(len(me.vertices)), 1.0, 'REPLACE')
    me.materials.append(tex.material(name + '_core', base=tex.hexc(color) * 0.6, rough=0.9, tb={'k': 'hair', 'c': color, 'curl': 1}))
    sh = shells(core, np.ones(len(me.polygons), bool), name + '_fuzz', layers, fuzz, color, uv_scale=1.0, density=0.8, seed=seed)
    return [core, sh]


def add_bones(rig, chain, parent):
    """chain: [(name, head, tail)] added as a connected chain under parent"""
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    prev = rig.data.edit_bones[parent]
    for i, (name, head, tail) in enumerate(chain):
        b = rig.data.edit_bones.new(name)
        b.head, b.tail = Vector(head), Vector(tail)
        b.parent = prev
        b.use_connect = i > 0
        b.use_deform = True
        prev = b
    bpy.ops.object.mode_set(mode='OBJECT')


def braid(rig, name, path, radius, color, parent='head', bones=7, turns_per_m=11.0, tie=True):
    """A three-strand braid along a 3D polyline, weighted to a new bone chain <name>.01.. for the game's
    spring simulation. Returns the mesh object."""
    path = np.array(path, np.float32)
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    acc = np.concatenate([[0], np.cumsum(seg)])
    total = float(acc[-1])
    M = bones * 10
    ts = np.linspace(0, 1, M + 1)
    cen = np.stack([np.interp(ts * total, acc, path[:, k]) for k in range(3)], 1)
    tan = np.gradient(cen, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    side = np.cross(tan, np.array([0, 1, 0], np.float32))   # across the back
    side /= np.linalg.norm(side, axis=1, keepdims=True)
    back = np.cross(tan, side)
    ring = 8
    verts, fcs, uvs, wts = [], [], [], []
    for k in range(3):
        base = len(verts)
        for i, t in enumerate(ts):
            th = t * total * turns_per_m * math.tau + k * math.tau / 3
            fat = radius * (1 - 0.45 * t ** 2.2) * min(1, 0.3 + t * 9)   # thin at the root tie, tapering to the end
            c = cen[i] + side[i] * (0.62 * fat * math.sin(th)) + back[i] * (0.34 * fat * math.sin(2 * th))
            for r in range(ring):
                a = r / ring * math.tau
                verts.append(c + (side[i] * math.cos(a) * 0.52 + back[i] * math.sin(a) * 0.40) * fat)
                wts.append(t)
        for i in range(M):
            for r in range(ring):
                a, b = base + i * ring + r, base + i * ring + (r + 1) % ring
                fcs.append([a, b, b + ring, a + ring])
                uvs.extend([(r / ring, ts[i] * total * 14), ((r + 1) / ring, ts[i] * total * 14), ((r + 1) / ring, ts[i + 1] * total * 14), (r / ring, ts[i + 1] * total * 14)])
    me = bpy.data.meshes.new(name)
    me.from_pydata([list(map(float, v)) for v in verts], [], fcs)
    me.uv_layers.new(name='UVMap').data.foreach_set('uv', np.array(uvs, np.float32).ravel())
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(tex.material(name, base=tex.hexc(color), rough=0.45, tb={'k': 'hair', 'c': color}))
    joints = [cen[int(round(j / bones * M))] for j in range(bones + 1)]
    add_bones(rig, [(f'{name}.{j + 1:02d}', joints[j], joints[j + 1]) for j in range(bones)], parent)
    groups = [o.vertex_groups.new(name=f'{name}.{j + 1:02d}') for j in range(bones)]
    for vi, t in enumerate(wts):
        f = min(t * bones, bones - 1e-4)
        j = int(f)
        fr = f - j
        groups[j].add([vi], 1 - fr * 0.5 if j < bones - 1 else 1.0, 'REPLACE')
        if j < bones - 1:
            groups[j + 1].add([vi], fr * 0.5, 'REPLACE')
    return o
