"""Outfit tools: MakeHuman clothes as base layers + procedurally built armour / cloth pieces.

Pieces are generated from the body surface (so they fit any body), kept outside the body and earlier
layers with a BVH clearance pass, given thickness and bevelled rims, skinned by transferring weights from
the body, UV-mapped at a fixed texel density (tiling PBR materials) and darkened by baked AO in vertex
colours. Blender (x, y, z) -> three (x, z, -y); characters face -Y.
"""
import bpy
import bmesh
import math
import os
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

MPFB_DATA = '/root/.config/blender/4.5/extensions/.user/user_default/mpfb/data'


# ----------------------------------------------------------------- MakeHuman clothes

def add_clothes(base, name, material_type='MAKESKIN'):
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    d = os.path.join(MPFB_DATA, 'clothes', name)
    f = [x for x in os.listdir(d) if x.endswith('.mhclo')][0]
    before = set(bpy.data.objects)
    HumanService.add_mhclo_asset(os.path.join(d, f), base, asset_type='Clothes', subdiv_levels=0, material_type=material_type)
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    return new[0] if new else None


def apply_body_masks(base):
    """MPFB hides body parts under clothes with MASK modifiers on 'delete' groups: make that permanent."""
    for m in list(base.modifiers):
        if m.type == 'MASK' and m.vertex_group and m.vertex_group not in ('HelperGeometry', 'JointCubes'):
            g = base.vertex_groups.get(m.vertex_group)
            if g is None:
                base.modifiers.remove(m)
                continue
            gi = g.index
            # mask modifier keeps verts NOT in group when inverted; MPFB uses invert to hide the group
            hide = set()
            for v in base.data.vertices:
                for gg in v.groups:
                    if gg.group == gi and gg.weight > 0.5:
                        hide.add(v.index)
            if not m.invert_vertex_group:
                hide = set(range(len(base.data.vertices))) - hide
            bm = bmesh.new()
            bm.from_mesh(base.data)
            bm.verts.ensure_lookup_table()
            faces = [f for f in bm.faces if all(v.index in hide for v in f.verts)]
            bmesh.ops.delete(bm, geom=faces, context='FACES_ONLY')
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
            bm.to_mesh(base.data)
            bm.free()
            base.modifiers.remove(m)


def cut_below(obj, z, soft=0.0):
    """Delete faces of a garment entirely below z (world): shortens robes into jackets."""
    mw = obj.matrix_world
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    faces = [f for f in bm.faces if all((mw @ v.co).z < z for v in f.verts)]
    bmesh.ops.delete(bm, geom=faces, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()


def cut_where(obj, pred):
    mw = obj.matrix_world
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    faces = [f for f in bm.faces if all(pred(mw @ v.co) for v in f.verts)]
    bmesh.ops.delete(bm, geom=faces, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()


# ----------------------------------------------------------------- body sampling

class Body:
    """Evaluated body surface (rest pose) for region selection, offsets and clearance."""

    def __init__(self, base, rig):
        self.base = base
        self.rig = rig
        dg = bpy.context.evaluated_depsgraph_get()
        ev = base.evaluated_get(dg)
        me = ev.to_mesh()
        mw = base.matrix_world
        self.co = np.array([(mw @ v.co)[:] for v in me.vertices])
        self.no = np.array([(mw.to_3x3() @ v.normal).normalized()[:] for v in me.vertices])
        self.faces = [tuple(p.vertices) for p in me.polygons]
        vgn = {g.index: g.name for g in base.vertex_groups}
        self.groups = [{vgn[g.group]: g.weight for g in v.groups} for v in me.vertices]
        ev.to_mesh_clear()
        # MakeHuman helper geometry (joint cubes, tights / skirt / hair helpers) is not body surface
        self.helper = np.array([(g.get('HelperGeometry', 0) > 0.5 or g.get('JointCubes', 0) > 0.5) for g in self.groups])
        self.faces = [f for f in self.faces if not self.helper[list(f)].any()]
        self.bvh = BVHTree.FromPolygons([Vector(c) for c in self.co], self.faces)
        self.layers = [self.bvh]

    def bone(self, name):
        b = self.rig.data.bones[name]
        mw = self.rig.matrix_world
        return mw @ b.head_local, mw @ b.tail_local

    def weight(self, i, names):
        g = self.groups[i]
        return sum(g.get(n, 0.0) for n in names)

    def region_mesh(self, name, vpred, fpred_all=True):
        """New mesh object from body faces whose verts satisfy vpred(i, co, groups)."""
        ok = np.array([(not self.helper[i]) and bool(vpred(i, self.co[i], self.groups[i])) for i in range(len(self.co))])
        faces = [f for f in self.faces if (all(ok[list(f)]) if fpred_all else any(ok[list(f)]))]
        used = sorted({i for f in faces for i in f})
        remap = {o: n for n, o in enumerate(used)}
        me = bpy.data.meshes.new(name)
        me.from_pydata([self.co[i].tolist() for i in used], [], [[remap[i] for i in f] for f in faces])
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob['src_normals'] = [x for i in used for x in self.no[i].tolist()]
        return ob

    def add_layer(self, obj):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.transform(obj.matrix_world)
        self.layers.append(BVHTree.FromBMesh(bm))
        bm.free()

    def clear(self, obj, dist, iters=2, margin=0.004):
        """Push verts out along the body's outward normal so they sit at least `dist` above the body and
        `margin` above every clothing layer (layers are single-sided, so they are ray cast along the body
        normal rather than trusting their face normals)."""
        me = obj.data
        for _ in range(iters):
            for v in me.vertices:
                p = Vector(v.co)
                hit = self.bvh.find_nearest(p)
                if hit[0] is None:
                    continue
                loc, n, _, _ = hit
                if n.length < 0.5:
                    continue
                h = (p - loc).dot(n)
                need = dist
                o = loc + n * 0.002
                for bvh in self.layers[1:]:
                    r = bvh.ray_cast(o, n, 0.15)
                    if r[0] is not None:
                        need = max(need, (r[0] - loc).dot(n) + margin)
                if h < need:
                    lateral = (p - loc) - n * h
                    v.co = loc + lateral + n * need
        me.update()


    def fit(self, obj, dist, margin=0.005, rounds=4, smooth_iters=6):
        """Smooth fit: compute how far each vertex must rise (body clearance + clothing layers), smooth that
        displacement field over the mesh, then move along the body normal. Keeps armour shells clean."""
        me = obj.data
        adj = [[] for _ in me.vertices]
        for e in me.edges:
            a, b = e.vertices
            adj[a].append(b)
            adj[b].append(a)
        for _ in range(rounds):
            delta = np.zeros(len(me.vertices))
            nrm = []
            for v in me.vertices:
                p = Vector(v.co)
                hit = self.bvh.find_nearest(p)
                if hit[0] is None or hit[1].length < 0.5:
                    nrm.append(Vector((0, 0, 0)))
                    continue
                loc, n, _, _ = hit
                h = (p - loc).dot(n)
                need = dist
                o = loc + n * 0.002
                for bvh in self.layers[1:]:
                    r = bvh.ray_cast(o, n, 0.15)
                    if r[0] is not None:
                        need = max(need, (r[0] - loc).dot(n) + margin)
                delta[v.index] = max(0.0, need - h)
                nrm.append(n)
            for _ in range(smooth_iters):
                nd = delta.copy()
                for i, nb in enumerate(adj):
                    if nb:
                        nd[i] = max(delta[i], sum(delta[j] for j in nb) / len(nb))
                delta = nd
            for v in me.vertices:
                v.co = Vector(v.co) + nrm[v.index] * delta[v.index]
            me.update()
            smooth(obj, 2, 0.5)


# ----------------------------------------------------------------- shaping helpers

def offset_along_normals(obj, amount_fn):
    me = obj.data
    me.update()
    src = obj.get('src_normals')
    for i, v in enumerate(me.vertices):
        n = Vector(src[i * 3:i * 3 + 3]) if src else v.normal
        v.co = v.co + n * amount_fn(Vector(v.co))
    me.update()


def smooth(obj, iters=4, factor=0.5):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for _ in range(iters):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data)
    bm.free()


def subdivide(obj, levels=1):
    m = obj.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    apply_mod(obj, m)


def solidify(obj, thick, offset=1.0, rim=True):
    m = obj.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = thick
    m.offset = offset
    m.use_rim = rim
    m.use_even_offset = False
    m.use_quality_normals = True
    apply_mod(obj, m)


def bevel(obj, width, segments=2, angle=40):
    m = obj.modifiers.new('bev', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    apply_mod(obj, m)


def apply_mod(obj, m):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)


def displace_fn(obj, fn):
    """v += normal * fn(co)"""
    me = obj.data
    me.update()
    for v in me.vertices:
        v.co = v.co + v.normal * fn(Vector(v.co))
    me.update()


def noise3(p, f=1.0):
    from mathutils import noise
    return noise.noise(Vector((p[0] * f, p[1] * f, p[2] * f)))


# ----------------------------------------------------------------- rigging, UVs, materials

ARM_PREFIX = ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')


def skin_to_body(obj, base, rig, extra_groups=None, torso_only=False):
    """Weights from the nearest body surface (interpolated), armature modifier, parent to rig.
    torso_only: drop arm weights (rigid torso armour must not be dragged by the arms)."""
    for g in base.vertex_groups:
        if g.name not in obj.vertex_groups and g.name in rig.data.bones:
            obj.vertex_groups.new(name=g.name)
    dt = obj.modifiers.new('dt', 'DATA_TRANSFER')
    dt.object = base
    dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'
    dt.layers_vgroup_select_dst = 'NAME'
    apply_mod(obj, dt)
    # remove non-bone groups, normalise, limit to 4
    for g in list(obj.vertex_groups):
        if g.name not in rig.data.bones or (torso_only and g.name.startswith(ARM_PREFIX)):
            obj.vertex_groups.remove(g)
    if torso_only:
        # verts that only had arm weights: give them to the upper chest
        g3 = obj.vertex_groups.get('spine_03') or obj.vertex_groups.new(name='spine_03')
        lone = [v.index for v in obj.data.vertices if not v.groups]
        if lone:
            g3.add(lone, 1.0, 'REPLACE')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    am = obj.modifiers.new('Armature', 'ARMATURE')
    am.object = rig
    obj.parent = rig


def rigid_to_bone(obj, rig, bone):
    """A rigid piece (plate, buckle) moves with one bone."""
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    g = obj.vertex_groups.new(name=bone)
    g.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    am = obj.modifiers.new('Armature', 'ARMATURE')
    am.object = rig
    obj.parent = rig


def box_uv(obj, size=0.5):
    """Cube projection at a fixed texel density: 1 UV unit = `size` metres."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=size * 2, correct_aspect=True, clip_to_bounds=False, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_ao_vertex(objs, samples=48, distance=0.25):
    """Ambient occlusion into a vertex colour layer 'Col' (exported as COLOR_0, multiplied into albedo)."""
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = samples
    scn.cycles.device = 'CPU'
    scn.world = scn.world or bpy.data.worlds.new('w')
    scn.render.bake.target = 'VERTEX_COLORS'
    for o in objs:
        if 'Col' not in o.data.color_attributes:
            o.data.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
        o.data.color_attributes.active_color = o.data.color_attributes['Col']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    scn.world.light_settings.distance = distance
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    # soften: AO * 0.75 + 0.25 so cloth never goes black
    for o in objs:
        ca = o.data.color_attributes['Col']
        cols = np.zeros(len(ca.data) * 4)
        ca.data.foreach_get('color', cols)
        cols = cols.reshape(-1, 4)
        cols[:, :3] = cols[:, :3] * 0.72 + 0.28
        ca.data.foreach_set('color', cols.reshape(-1))


TEX = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'tex')


def tiling_material(name, tex, tint=(1, 1, 1), rough=1.0, metal=0.0, sheen=0.0, scale=1.0, emissive=None, normal_strength=1.0, rough_fixed=None, coat=0.0, coat_rough=0.05, aniso=0.0):
    """Material using a shared tiling texture set (assets/tex/<tex>_{c,n,orm}.webp). The textures are referenced
    in the GLB (WebP); the game swaps them for its shared instances by material name."""
    m = bpy.data.materials.new(name)
    m.use_fake_user = True  # MPFB purges orphans while fitting clothes
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    uv = nt.nodes.new('ShaderNodeUVMap')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale, scale, 1)
    nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])

    def tx(path, cs):
        t = nt.nodes.new('ShaderNodeTexImage')
        img = bpy.data.images.load(path, check_existing=True)
        img.colorspace_settings.name = cs
        t.image = img
        nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
        return t

    c = tx(os.path.join(TEX, f'{tex}_c.webp'), 'sRGB')
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(c.outputs['Color'], mix.inputs['A'])
    mix.inputs['B'].default_value = (*tint, 1)
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    n = tx(os.path.join(TEX, f'{tex}_n.webp'), 'Non-Color')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = normal_strength
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    o = tx(os.path.join(TEX, f'{tex}_orm.webp'), 'Non-Color')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(o.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    b.inputs['Metallic'].default_value = metal
    if sheen > 0:
        b.inputs['Sheen Weight'].default_value = sheen
        b.inputs['Sheen Tint'].default_value = (*tint, 1)
    if emissive:
        b.inputs['Emission Color'].default_value = (*emissive[:3], 1)
        b.inputs['Emission Strength'].default_value = emissive[3]
    m['tint'] = list(tint)
    m['tex'] = tex
    m['rough'] = rough
    m['metal'] = metal
    m['sheen'] = sheen
    if coat > 0:
        # clearcoat: lacquer is a glossy varnish over the worn paint (KHR_materials_clearcoat)
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = coat_rough
        m['coat'] = coat
    if aniso > 0:
        b.inputs['Anisotropic'].default_value = aniso
        m['aniso'] = aniso
    m['scale'] = scale
    m['normal'] = normal_strength
    if rough_fixed is not None:
        m['rough_fixed'] = rough_fixed
        nt.links.remove(b.inputs['Roughness'].links[0])
        b.inputs['Roughness'].default_value = rough_fixed
    if emissive:
        m['emissive'] = list(emissive)
    return m


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
