"""
Garments and gear built ON the character's body, so everything fits and deforms with the skeleton.

- Regions are chosen per face by which bone the face belongs to (nearest bone segment) plus bone-local conditions (front/back/side, how far
  along the bone), so a "forearm bracer" is defined anatomically, not by world coordinates.
- `shell()` copies those faces from the evaluated body (UVs and skin weights included), pushes them out along the normals, gives them real
  thickness (solidify), rounded edges (bevel) and smooth shading: layered garments and armour that follow the body.
- `surface_line()` traces a curve over the body surface (rays from the bone axis) for straps, piping and chronal light-lines.
"""
import json
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def ia(node, name):
    """Input socket by name, matching a Mix node's data type (by-name lookup returns the FLOAT variant otherwise)."""
    if node.bl_idname == 'ShaderNodeMix' and name in ('A', 'B'):
        kind = {'RGBA': 'RGBA', 'FLOAT': 'VALUE', 'VECTOR': 'VECTOR'}[node.data_type]
        return next(s for s in node.inputs if s.name == name and s.type == kind)
    return node.inputs[name]


def oa(node, name):
    if node.bl_idname == 'ShaderNodeMix' and name == 'Result':
        kind = {'RGBA': 'RGBA', 'FLOAT': 'VALUE', 'VECTOR': 'VECTOR'}[node.data_type]
        return next(s for s in node.outputs if s.name == name and s.type == kind)
    return node.outputs[name]



class BodySpace:
    def __init__(self, basemesh, rig):
        self.basemesh = basemesh
        self.rig = rig
        mw = rig.matrix_world
        self.bones = {b.name: (np.array(mw @ b.head_local), np.array(mw @ b.tail_local)) for b in rig.data.bones}
        dg = bpy.context.evaluated_depsgraph_get()
        ev = basemesh.evaluated_get(dg)
        self.mesh = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        self.mesh.transform(basemesh.matrix_world)
        self.mesh.calc_loop_triangles()
        bm = bmesh.new()
        bm.from_mesh(self.mesh)
        self.bvh = BVHTree.FromBMesh(bm)
        bm.free()
        n = len(self.mesh.polygons)
        c = np.empty(n * 3)
        nn = np.empty(n * 3)
        self.mesh.polygons.foreach_get('center', c)
        self.mesh.polygons.foreach_get('normal', nn)
        self.centers = c.reshape(-1, 3)
        self.normals = nn.reshape(-1, 3)
        self._assign()

    def _assign(self):
        names = [k for k in self.bones if k != 'Root']
        P = self.centers
        best = np.full(len(P), np.inf)
        owner = np.zeros(len(P), dtype=int)
        tpar = np.zeros(len(P))
        for i, k in enumerate(names):
            a, b = self.bones[k]
            ab = b - a
            l2 = max(float(ab @ ab), 1e-9)
            t = np.clip((P - a) @ ab / l2, 0, 1)
            d = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
            m = d < best
            best[m] = d[m]
            owner[m] = i
            tpar[m] = t[m]
        self.names = names
        self.owner = np.array(names, dtype=object)[owner]
        self.t = tpar
        self.dist = best

    def side(self, bone):
        """Per-face unit direction from the bone axis to the face (radial), for front/back/outer tests."""
        a, b = self.bones[bone]
        ab = (b - a) / max(np.linalg.norm(b - a), 1e-9)
        v = self.centers - a
        r = v - (v @ ab)[:, None] * ab
        return r / np.maximum(np.linalg.norm(r, axis=1, keepdims=True), 1e-9)

    def is_bone(self, *prefixes):
        return np.array([any(o.startswith(p) for p in prefixes) for o in self.owner])


def shell(space, name, face_mask, *, offset, thickness, material, bevel=0.0, subdiv=1, smooth_iters=2):
    """Build a fitted, rigged shell from the selected body faces."""
    me = space.mesh.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    kill = [f for f in bm.faces if not face_mask[f.index]]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.normal_update()
    # relax the open border a little so the edge is not a jagged face boundary
    for _ in range(smooth_iters):
        border = [v for v in bm.verts if v.is_boundary]
        bmesh.ops.smooth_vert(bm, verts=border, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in bm.verts:
        v.co += v.normal * offset
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for vg in space.basemesh.vertex_groups:
        ob.vertex_groups.new(name=vg.name)
    me.materials.clear()
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    sol = ob.modifiers.new('solidify', 'SOLIDIFY')
    sol.thickness = thickness
    sol.offset = -1.0
    sol.use_even_offset = True
    sol.use_rim = True
    if bevel > 0:
        bev = ob.modifiers.new('bevel', 'BEVEL')
        bev.width = bevel
        bev.segments = 3
        bev.limit_method = 'ANGLE'
        bev.angle_limit = math.radians(35)
        bev.harden_normals = False
    if subdiv:
        sd = ob.modifiers.new('subdiv', 'SUBSURF')
        sd.levels = sd.render_levels = subdiv
    wn = ob.modifiers.new('wnormal', 'WEIGHTED_NORMAL')
    wn.keep_sharp = True
    arm = ob.modifiers.new('Armature', 'ARMATURE')
    arm.object = space.rig
    ob.parent = space.rig
    ob.matrix_parent_inverse = space.rig.matrix_world.inverted()
    return ob


def surface_line(space, bone, direction_fn, t0, t1, *, samples=24, lift=0.004, name='line', radius=0.0012, profile=None, material=None,
                 width=None, weight_bone=None):
    """A curve that rides over the body surface along `bone` between t0..t1. direction_fn(t) -> radial direction (bone-local intent, world vector)."""
    a, b = space.bones[bone]
    pts = []
    for i in range(samples):
        t = t0 + (t1 - t0) * i / (samples - 1)
        o = Vector(a + (b - a) * t)
        d = Vector(direction_fn(t)).normalized()
        hit = space.bvh.ray_cast(o, d, 0.4)
        if hit[0] is not None:
            pts.append(hit[0] + hit[1] * lift)
    return _curve(space, pts, name, radius, material, width, weight_bone or bone)


def path_line(space, world_points, *, lift=0.004, name='path', radius=0.0012, material=None, width=None, weight_bone=None, center=None):
    """A curve over the body through world-space guide points: each guide is projected onto the surface (ray from `center` outward)."""
    pts = []
    c = Vector(center)
    for p in world_points:
        d = (Vector(p) - c).normalized()
        hit = space.bvh.ray_cast(c, d, 1.0)
        if hit[0] is not None:
            pts.append(hit[0] + hit[1] * lift)
    return _curve(space, pts, name, radius, material, width, weight_bone)


def _curve(space, pts, name, radius, material, width, weight_bone):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    if width:
        # flat strap: rectangle profile
        cu.extrude = width / 2
        cu.bevel_depth = radius
    else:
        cu.bevel_depth = radius
        cu.bevel_resolution = 3
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    if material:
        cu.materials.append(material)
    # to mesh (so it can be skinned and exported)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    mob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(mob)
    for p in me.polygons:
        p.use_smooth = True
    if weight_bone:
        vg = mob.vertex_groups.new(name=weight_bone)
        vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
        arm = mob.modifiers.new('Armature', 'ARMATURE')
        arm.object = space.rig
    mob.parent = space.rig
    mob.matrix_parent_inverse = space.rig.matrix_world.inverted()
    return mob


def transfer_weights(space, target):
    """Skin a separately modelled piece (spine module, buckles) by copying weights from the nearest body surface."""
    dt = target.modifiers.new('wt', 'DATA_TRANSFER')
    body = bpy.data.objects.new('_body_src', space.mesh)
    bpy.context.scene.collection.objects.link(body)
    for vg in space.basemesh.vertex_groups:
        body.vertex_groups.new(name=vg.name)
    dt.object = body
    dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'
    dt.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.datalayout_transfer(modifier=dt.name)
    bpy.ops.object.modifier_apply(modifier=dt.name)
    bpy.data.objects.remove(body)


# --- materials ----------------------------------------------------------------------------------------------------

def pbr(name, tex_dir, tex_id, *, tint=(1, 1, 1), tile=8.0, rough_mul=1.0, rough_add=0.0, normal_strength=1.0, metal=0.0, res='2k',
        detail_normal=None, detail_tile=40.0, detail_strength=0.3, coat=0.0, desat=None):
    """Principled material from a downloaded PBR set (diff / nor_gl / rough / ao), tiled over the UVs, tinted, optional detail normal."""
    import os
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    uv = nt.nodes.new('ShaderNodeUVMap')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (tile, tile, 1)
    nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])

    def tex(kind, colour=True):
        p = os.path.join(tex_dir, tex_id, f'{tex_id}_{kind}_{res}.jpg')
        if not os.path.exists(p):
            return None
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(p, check_existing=True)
        if not colour:
            n.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        return n
    d = tex('diff')
    if d:
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        ia(mul, 'B').default_value = (*tint, 1)
        src = d.outputs['Color']
        if desat is not None:
            hs = nt.nodes.new('ShaderNodeHueSaturation')
            hs.inputs['Saturation'].default_value = desat
            nt.links.new(src, hs.inputs['Color'])
            src = hs.outputs['Color']
        nt.links.new(src, ia(mul, 'A'))
        ao = tex('ao', False)
        if ao:
            m2 = nt.nodes.new('ShaderNodeMix')
            m2.data_type = 'RGBA'
            m2.blend_type = 'MULTIPLY'
            m2.inputs['Factor'].default_value = 0.8
            nt.links.new(oa(mul, 'Result'), ia(m2, 'A'))
            nt.links.new(ao.outputs['Color'], ia(m2, 'B'))
            nt.links.new(oa(m2, 'Result'), bsdf.inputs['Base Color'])
        else:
            nt.links.new(oa(mul, 'Result'), bsdf.inputs['Base Color'])
    r = tex('rough', False)
    if r:
        mr = nt.nodes.new('ShaderNodeMath')
        mr.operation = 'MULTIPLY_ADD'
        mr.inputs[1].default_value = rough_mul
        mr.inputs[2].default_value = rough_add
        mr.use_clamp = True
        nt.links.new(r.outputs['Color'], mr.inputs[0])
        nt.links.new(mr.outputs['Value'], bsdf.inputs['Roughness'])
    n = tex('nor_gl', False)
    if n:
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Coat Weight'].default_value = coat
    m['ft'] = json.dumps({'type': 'pbr', 'tex': tex_id, 'res': res, 'tile': tile, 'tint': list(tint), 'desat': desat,
                          'rough_mul': rough_mul, 'rough_add': rough_add, 'normal': normal_strength, 'metal': metal, 'coat': coat})
    return m


def armour(name, base=(0.09, 0.1, 0.11), rough=0.42, wear=0.6, edge=(0.28, 0.29, 0.3), coat=0.15, grooves=9.0):
    """Composite armour: matte painted shell with worn, lighter edges (pointiness), fine noise roughness breakup and a light clear coat."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = 0.53
    ramp.inputs['From Max'].default_value = 0.6
    nt.links.new(geo.outputs['Pointiness'], ramp.inputs['Value'])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 140.0
    noise.inputs['Detail'].default_value = 8.0
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    wm = nt.nodes.new('ShaderNodeMath')
    wm.operation = 'MULTIPLY'
    nt.links.new(oa(ramp, 'Result'), wm.inputs[0])
    nt.links.new(noise.outputs['Fac'], wm.inputs[1])
    wf = nt.nodes.new('ShaderNodeMath')
    wf.operation = 'MULTIPLY'
    wf.use_clamp = True
    wf.inputs[1].default_value = wear * 2.0
    nt.links.new(wm.outputs['Value'], wf.inputs[0])
    col = nt.nodes.new('ShaderNodeMix')
    col.data_type = 'RGBA'
    ia(col, 'A').default_value = (*base, 1)
    ia(col, 'B').default_value = (*edge, 1)
    nt.links.new(wf.outputs['Value'], col.inputs['Factor'])
    nt.links.new(oa(col, 'Result'), bsdf.inputs['Base Color'])
    rr = nt.nodes.new('ShaderNodeMath')
    rr.operation = 'MULTIPLY_ADD'
    rr.inputs[1].default_value = 0.25
    rr.inputs[2].default_value = rough - 0.1
    nt.links.new(noise.outputs['Fac'], rr.inputs[0])
    nt.links.new(rr.outputs['Value'], bsdf.inputs['Roughness'])
    bsdf.inputs['Coat Weight'].default_value = coat
    bsdf.inputs['Coat Roughness'].default_value = 0.25
    # machined panel grooves: cells of a coarse Voronoi in object space become separate armour segments
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = grooves
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    gm = nt.nodes.new('ShaderNodeMapRange')
    gm.inputs['From Min'].default_value = 0.012
    gm.inputs['From Max'].default_value = 0.028
    gm.inputs['To Min'].default_value = 0.0
    gm.inputs['To Max'].default_value = 1.0
    nt.links.new(vor.outputs['Distance'], gm.inputs['Value'])
    dark = nt.nodes.new('ShaderNodeMix')
    dark.data_type = 'RGBA'
    dark.blend_type = 'MULTIPLY'
    inv = nt.nodes.new('ShaderNodeMath')
    inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    nt.links.new(gm.outputs['Result'], inv.inputs[1])
    nt.links.new(inv.outputs['Value'], dark.inputs['Factor'])
    nt.links.new(oa(col, 'Result'), ia(dark, 'A'))
    ia(dark, 'B').default_value = (0.25, 0.25, 0.27, 1)
    nt.links.new(oa(dark, 'Result'), bsdf.inputs['Base Color'])
    hsum = nt.nodes.new('ShaderNodeMath')
    hsum.operation = 'MULTIPLY_ADD'
    hsum.inputs[1].default_value = 0.15
    nt.links.new(noise.outputs['Fac'], hsum.inputs[0])
    nt.links.new(gm.outputs['Result'], hsum.inputs[2])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.002
    nt.links.new(hsum.outputs['Value'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    m['ft'] = json.dumps({'type': 'armour', 'base': list(base), 'edge': list(edge), 'rough': rough, 'wear': wear, 'coat': coat, 'grooves': grooves})
    return m


def emissive(name, color=(0.35, 0.85, 1.0), strength=8.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.02, 0.03, 0.035, 1)
    b.inputs['Emission Color'].default_value = (*color, 1)
    b.inputs['Emission Strength'].default_value = strength
    b.inputs['Roughness'].default_value = 0.2
    m['ft'] = json.dumps({'type': 'emissive', 'color': list(color), 'strength': strength})
    return m
