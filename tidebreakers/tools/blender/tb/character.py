"""Character assembly: sculpt layers -> meshes -> paint -> weights -> armature -> GLB.

A character is a Skeleton, a Body and a list of Layers (skin, garments, hair, accessories). Each layer is
meshed from its field, decimated to its triangle budget, painted (base colour, procedural detail, SDF
ambient occlusion), weighted (body / rigid / chain) and finally all layers are joined into ONE skinned
mesh (one draw call + one outline draw in the game).

Vertex data written for the game's toon shader:
  COLOR_0.rgb  albedo (linear)          COLOR_0.a   face mask (1 on the front of the face)
  TEXCOORD_0   face-space coords (x, height above chin) in reference head units, for painted features
  TEXCOORD_1   (ambient occlusion, material class)
Material classes: 0 skin, 1 cloth, 2 hair, 3 metal, 4 leather, 5 glow, 6 eye-white/teeth, 7 wood
"""
import math
import os
import time
import numpy as np
from . import sdf, skin
try:  # importable outside Blender for numeric checks
    import bpy
    from mathutils import Vector
    from . import bl
except ImportError:
    bpy = None

CLS = dict(skin=0, cloth=1, hair=2, metal=3, leather=4, glow=5, white=6, wood=7)


class Layer:
    def __init__(self, name, field, color, cls='cloth', weights='body', res=0.006, budget=4000, covers=False,
                 cull_margin=0.0015, paint=None, smooth=True, sym=True):
        self.name = name
        self.field = field
        self.color = color          # rgb tuple or callable(V, N) -> (N,3)
        self.cls = cls
        self.weights = weights      # 'body' | ('rigid', bone) | ('chain', [bones]) | callable(V) -> (bones, W)
        self.res = res
        self.budget = budget
        self.covers = covers        # hides skin underneath
        self.cull_margin = cull_margin
        self.paint = paint          # optional callable(V, N, rgb) -> rgb  (detail painting)
        self.sym = sym


def srgb(h):
    """'#rrggbb' -> linear rgb"""
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ------------------------------------------------------------------------------------------- painting

def sdf_ao(field, V, N, scale=1.0):
    """Ambient occlusion from the distance field: how much the field closes in along the normal."""
    occ = np.zeros(len(V))
    w = 1.0
    for h in (0.006, 0.016, 0.032, 0.056, 0.09):
        h *= scale
        d = field.eval(V + N * h)
        occ += np.maximum(h - d, 0) / h * w
        w *= 0.62
    return np.clip(1 - occ * 0.38, 0.0, 1.0)


def vertex_normals(V, F):
    n = np.zeros_like(V)
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1), 1e-12)[:, None]


# ------------------------------------------------------------------------------------------- armature

def build_armature(skel, name='Armature'):
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for bname, h, t, parent, up, deform in skel.bones:
        b = arm.edit_bones.new(bname)
        b.head = Vector(h)
        b.tail = Vector(t)
        b.align_roll(Vector(up))
        b.use_deform = deform
        eb[bname] = b
    for bname, h, t, parent, up, deform in skel.bones:
        if parent:
            eb[bname].parent = eb[parent]
            eb[bname].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


# ------------------------------------------------------------------------------------------- build

def build(name, skel, body, layers, out_path=None, preview=None, ao_scale=1.0, total_budget=None):
    t0 = time.time()
    bl.reset()
    objs = []
    covering = [L for L in layers if L.covers]
    all_fields = sdf.Union([L.field for L in layers])
    for L in layers:
        V, Q = sdf.mesh_field(L.field, res=L.res, verbose=False)
        if len(V) == 0:
            print('[char] empty layer', L.name)
            continue
        # hide skin under covering garments (face centroid inside a cover)
        if L.name == 'skin' and covering:
            cen = V[Q].mean(1).astype(float)
            hidden = np.zeros(len(Q), bool)
            for C in covering:
                hidden |= C.field.eval(cen) < -L.cull_margin
            # keep a one-face rim so there are no gaps at garment edges
            Q = Q[~hidden]
            used = np.unique(Q)
            remap = -np.ones(len(V), np.int64)
            remap[used] = np.arange(len(used))
            V = V[used]
            Q = remap[Q]
        ob = bl.make_mesh(f'{name}_{L.name}', V, Q)
        bl.decimate(ob, target=L.budget, symmetry=L.sym)
        objs.append((L, ob))
        print(f'[char] {L.name}: {len(ob.data.polygons)} faces  ({time.time() - t0:.1f}s)')

    arm = build_armature(skel)
    bones = skel.deform_names()
    for L, ob in objs:
        me = ob.data
        V, T = bl.mesh_arrays(ob)
        V = V.astype(float)
        N = vertex_normals(V, T)
        # gradient normals are smoother on the sculpt; blend them in
        G = sdf.gradient(L.field, V, 0.002)
        N = np.where((np.einsum('ij,ij->i', N, G) > 0)[:, None], (N + G * 2) / 3, N)
        N /= np.maximum(np.linalg.norm(N, axis=1), 1e-9)[:, None]
        col = L.color(V, N) if callable(L.color) else np.tile(np.asarray(L.color, float), (len(V), 1))
        if L.paint:
            col = L.paint(V, N, col)
        ao = sdf_ao(all_fields, V + N * 0.0015, N, ao_scale)
        # face mask + face space UVs (skin only)
        fa = body.face_anchor
        u = fa['u']
        if L.name == 'skin':
            fwd = np.clip((-N[:, 1] - 0.15) / 0.5, 0, 1)
            inface = ((V[:, 2] > fa['chin'] - 0.01) & (V[:, 2] < fa['chin'] + 0.2 * u) & (V[:, 1] < fa['cranium'][1] - 0.04 * u)).astype(float)
            mask = fwd * inface
        else:
            mask = np.zeros(len(V))
        rgba = np.concatenate([col, mask[:, None]], 1)
        bl.set_colors(me, rgba)
        uv0 = np.stack([V[:, 0] / u, (V[:, 2] - fa['chin']) / u], 1)
        uv1 = np.stack([ao, np.full(len(V), CLS[L.cls] / 10.0)], 1)
        _set_uv(me, 'UVMap', uv0)
        _set_uv(me, 'UV1', uv1)
        # weights
        if L.weights == 'body':
            bn, W = skin.body_weights(skel, body.parts, V)
        elif callable(L.weights):
            bn, W = L.weights(V)
        elif L.weights[0] == 'rigid':
            bn, W = skin.rigid_weights(skel, L.weights[1], V)
        elif L.weights[0] == 'chain':
            bn, W = skin.chain_weights(skel, L.weights[1], V)
        else:
            raise ValueError(L.weights)
        zero = W.sum(1) < 1e-6
        if zero.any():
            # fall back to nearest bone for anything the weighting missed
            bn2, W2 = skin.body_weights(skel, body.parts, V[zero])
            W[zero] = W2
        for bi, b in enumerate(bn):
            idx = np.nonzero(W[:, bi] > 1e-4)[0]
            if len(idx) == 0:
                continue
            vg = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
            for w in np.unique(np.round(W[idx, bi], 3)):
                sel = idx[np.round(W[idx, bi], 3) == w]
                vg.add(sel.tolist(), float(w), 'REPLACE')
    # join everything into one mesh
    bpy.ops.object.select_all(action='DESELECT')
    for L, ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0][1]
    bpy.ops.object.join()
    mesh_ob = bpy.context.view_layer.objects.active
    mesh_ob.name = name
    # bones every character must carry so animations retarget
    for b in bones:
        if b not in mesh_ob.vertex_groups:
            mesh_ob.vertex_groups.new(name=b)
    mod = mesh_ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    mesh_ob.parent = arm
    mat = bpy.data.materials.new(name + '_mat')
    mesh_ob.data.materials.append(mat)
    nfaces = len(mesh_ob.data.polygons)
    print(f'[char] {name}: {nfaces} faces, {len(mesh_ob.data.vertices)} verts, {len(bones)} bones  ({time.time() - t0:.1f}s)')
    if preview:
        bl.setup_preview()
        H = skel.s['height']
        bl.render_views(preview, target=(0, 0, H * 0.52), dist=H * 2.15, lens=60)
        bl.render_views(preview + '_face', target=(0, -0.04, body.face_anchor['chin'] + 0.12 * body.face_anchor['u']),
                        dist=0.85 * body.face_anchor['u'] / 1.0, lens=60, views=[('front', 0, 3), ('q3', 38, 6), ('side', 90, 3)])
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        mesh_ob.select_set(True)
        arm.select_set(True)
        bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', use_selection=True, export_vertex_color='ACTIVE',
                                  export_all_vertex_colors=False, export_animations=False, export_skins=True,
                                  export_yup=True, export_apply=False, export_def_bones=False, export_normals=True,
                                  export_tangents=False, export_materials='EXPORT')
        print('[char] wrote', out_path, os.path.getsize(out_path) // 1024, 'KB')
    return mesh_ob, arm


def _set_uv(me, name, uv):
    layer = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    loops = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', loops)
    layer.data.foreach_set('uv', uv[loops].astype(np.float32).ravel())
