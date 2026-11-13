"""
Look development for realistic characters (Cycles review + data that the game shaders mirror):
  - skin(): layered skin: photographic base colour, region masks (T-zone, lips, stubble, scalp) in a colour attribute, subsurface
    scattering, roughness zones, pore detail-normal tiled over the UVs, peach-fuzz sheen.
  - eyes(): wet refractive cornea shell over the eyeball, sclera tint, iris from the MakeHuman eye texture.
  - hair_curves(): real hair curves grown on the scalp (density, length, comb direction, curl, clumping) with a Principled Hair BSDF.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector

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



# --- region masks -----------------------------------------------------------------------------------------------

def region_masks(basemesh, stubble=0.0, head_top=None):
    """Write per-vertex masks into colour attribute 'masks' (R scalp, G stubble/beard zone, B T-zone oiliness, A lips).
    Computed from rest-pose positions (character faces -Y, +Z up)."""
    me = basemesh.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    if basemesh.data.shape_keys:  # use the evaluated (target-applied) shape
        dg = bpy.context.evaluated_depsgraph_get()
        ev = basemesh.evaluated_get(dg).to_mesh()
        co2 = np.empty(len(ev.vertices) * 3)
        ev.vertices.foreach_get('co', co2)
        if len(co2) == len(co.ravel()):
            co = co2.reshape(-1, 3)
        basemesh.evaluated_get(dg).to_mesh_clear()
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    top = head_top if head_top is not None else z.max()
    # head-local coordinates
    hz = z - (top - 0.24)          # 0 at chin-ish, 0.24 at crown
    front = -y
    scalp_vg = basemesh.vertex_groups.get('scalp')
    scalp = np.zeros(len(co))
    if scalp_vg:
        idx = scalp_vg.index
        for v in me.vertices:
            for g in v.groups:
                if g.group == idx:
                    scalp[v.index] = g.weight
    sm = lambda a, b, t: np.clip((t - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((t - a) / (b - a), 0, 1))  # noqa: E731
    # beard zone: jaw, chin and upper neck, stopping at the cheek line (below the cheekbones)
    ax = np.abs(x)
    beard = sm(-0.05, -0.018, hz) * (1 - sm(0.042, 0.064, hz)) * sm(-0.03, 0.0, front) * (1 - sm(0.068, 0.084, ax))
    # moustache shadow over the upper lip
    beard = np.maximum(beard, sm(0.054, 0.06, hz) * (1 - sm(0.073, 0.079, hz)) * sm(0.07, 0.085, front) * (1 - sm(0.024, 0.033, ax)))
    beard *= stubble
    tzone = (sm(0.09, 0.13, hz) * sm(0.03, 0.08, front) * (1 - sm(0.018, 0.04, np.abs(x)))) + sm(0.16, 0.2, hz) * sm(0.02, 0.08, front) * (1 - sm(0.05, 0.08, np.abs(x)))
    lips_vg = basemesh.vertex_groups.get('lips')
    lips = np.zeros(len(co))
    if lips_vg:
        idx = lips_vg.index
        for v in me.vertices:
            for g in v.groups:
                if g.group == idx:
                    lips[v.index] = g.weight
    attr = me.color_attributes.get('masks') or me.color_attributes.new('masks', 'FLOAT_COLOR', 'POINT')
    rgba = np.stack([scalp, np.clip(beard, 0, 1), np.clip(tzone, 0, 1), lips], axis=1).astype(np.float32)
    attr.data.foreach_set('color', rgba.ravel())
    return attr


# --- skin -------------------------------------------------------------------------------------------------------

def _node(nt, kind, loc, **kw):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def skin(basemesh, base_image_path, pores_normal_path, opts=None):
    """Replace every skin slot on the basemesh with one layered skin material."""
    o = {'sss_radius': (1.0, 0.36, 0.2), 'sss_scale': 0.0065, 'rough': 0.6, 'tzone_rough': 0.47, 'lips_rough': 0.52,
         'stubble_color': (0.3, 0.27, 0.27), 'scalp_color': (0.55, 0.5, 0.48), 'pore_strength': 0.9, 'pore_tile': 34.0,
         'sat': 1.0, 'value': 1.0, 'specular': 0.32, 'sheen': 0.02}
    o.update(opts or {})
    m = bpy.data.materials.new('skin')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = _node(nt, 'ShaderNodeOutputMaterial', (1200, 0))
    bsdf = _node(nt, 'ShaderNodeBsdfPrincipled', (900, 0))
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    uv = _node(nt, 'ShaderNodeUVMap', (-1100, 0), uv_map='UVMap')
    base = _node(nt, 'ShaderNodeTexImage', (-800, 300))
    base.image = bpy.data.images.load(base_image_path, check_existing=True)
    nt.links.new(uv.outputs['UV'], base.inputs['Vector'])
    hsv = _node(nt, 'ShaderNodeHueSaturation', (-500, 300))
    hsv.inputs['Saturation'].default_value = o['sat']
    hsv.inputs['Value'].default_value = o['value']
    nt.links.new(base.outputs['Color'], hsv.inputs['Color'])
    masks = _node(nt, 'ShaderNodeVertexColor', (-800, -200), layer_name='masks')
    sep = _node(nt, 'ShaderNodeSeparateColor', (-600, -200))
    nt.links.new(masks.outputs['Color'], sep.inputs['Color'])
    # stubble: dense dark speckle inside the beard mask
    tc = _node(nt, 'ShaderNodeTexCoord', (-1100, -500))
    vor = _node(nt, 'ShaderNodeTexVoronoi', (-800, -500))
    vor.inputs['Scale'].default_value = 900.0
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    speck = _node(nt, 'ShaderNodeMapRange', (-600, -500))
    speck.inputs['From Min'].default_value = 0.0
    speck.inputs['From Max'].default_value = 0.55
    speck.inputs['To Min'].default_value = 1.0
    speck.inputs['To Max'].default_value = 0.55
    nt.links.new(vor.outputs['Distance'], speck.inputs['Value'])
    stub_amt = _node(nt, 'ShaderNodeMath', (-400, -400), operation='MULTIPLY')
    nt.links.new(sep.outputs['Green'], stub_amt.inputs[0])
    nt.links.new(oa(speck, 'Result'), stub_amt.inputs[1])
    mix_stub = _node(nt, 'ShaderNodeMix', (-200, 250), data_type='RGBA', blend_type='MULTIPLY')
    nt.links.new(stub_amt.outputs['Value'], mix_stub.inputs['Factor'])
    nt.links.new(hsv.outputs['Color'], ia(mix_stub, 'A'))
    ia(mix_stub, 'B').default_value = (*o['stubble_color'], 1)
    lipsk = _node(nt, 'ShaderNodeMath', (-400, 100), operation='MULTIPLY')
    nt.links.new(masks.outputs['Alpha'], lipsk.inputs[0])
    lipsk.inputs[1].default_value = o.get('lips_darken', 0.7)
    mix_lips = _node(nt, 'ShaderNodeMix', (-80, 150), data_type='RGBA', blend_type='MULTIPLY')
    nt.links.new(lipsk.outputs['Value'], mix_lips.inputs['Factor'])
    ia(mix_lips, 'B').default_value = (*o.get('lips_tint', (0.62, 0.48, 0.5)), 1)
    mix_scalp = _node(nt, 'ShaderNodeMix', (50, 250), data_type='RGBA', blend_type='MULTIPLY')
    nt.links.new(sep.outputs['Red'], mix_scalp.inputs['Factor'])
    nt.links.new(oa(mix_stub, 'Result'), ia(mix_lips, 'A'))
    nt.links.new(oa(mix_lips, 'Result'), ia(mix_scalp, 'A'))
    ia(mix_scalp, 'B').default_value = (*o['scalp_color'], 1)
    nt.links.new(oa(mix_scalp, 'Result'), bsdf.inputs['Base Color'])
    # roughness zones + micro variation
    noise = _node(nt, 'ShaderNodeTexNoise', (-800, -800))
    noise.inputs['Scale'].default_value = 90.0
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    r1 = _node(nt, 'ShaderNodeMix', (-400, -800), data_type='FLOAT')
    ia(r1, 'A').default_value = o['rough']
    ia(r1, 'B').default_value = o['tzone_rough']
    nt.links.new(sep.outputs['Blue'], r1.inputs['Factor'])
    lips_f = _node(nt, 'ShaderNodeSeparateColor', (-600, -1000))
    nt.links.new(masks.outputs['Alpha'], lips_f.inputs['Color'])
    r2 = _node(nt, 'ShaderNodeMix', (-200, -800), data_type='FLOAT')
    nt.links.new(masks.outputs['Alpha'], r2.inputs['Factor'])
    nt.links.new(oa(r1, 'Result'), ia(r2, 'A'))
    ia(r2, 'B').default_value = o['lips_rough']
    r3 = _node(nt, 'ShaderNodeMath', (0, -800), operation='MULTIPLY_ADD')
    nt.links.new(noise.outputs['Fac'], r3.inputs[0])
    r3.inputs[1].default_value = 0.16
    nt.links.new(oa(r2, 'Result'), r3.inputs[2])
    r4 = _node(nt, 'ShaderNodeMath', (200, -800), operation='SUBTRACT')
    nt.links.new(r3.outputs['Value'], r4.inputs[0])
    r4.inputs[1].default_value = 0.08
    # scalp under hair is fully matte (the engine also drops its specular where the baked roughness is ~1)
    r5 = _node(nt, 'ShaderNodeMix', (400, -800), data_type='FLOAT')
    nt.links.new(sep.outputs['Red'], r5.inputs['Factor'])
    nt.links.new(r4.outputs['Value'], ia(r5, 'A'))
    ia(r5, 'B').default_value = 0.98
    nt.links.new(oa(r5, 'Result'), bsdf.inputs['Roughness'])
    # pores: tiled detail normal
    mapn = _node(nt, 'ShaderNodeMapping', (-800, -1300))
    mapn.inputs['Scale'].default_value = (o['pore_tile'], o['pore_tile'], 1)
    nt.links.new(uv.outputs['UV'], mapn.inputs['Vector'])
    pores = _node(nt, 'ShaderNodeTexImage', (-600, -1300))
    pores.image = bpy.data.images.load(pores_normal_path, check_existing=True)
    pores.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(mapn.outputs['Vector'], pores.inputs['Vector'])
    nmap = _node(nt, 'ShaderNodeNormalMap', (-300, -1300), uv_map='UVMap')
    nmap.inputs['Strength'].default_value = o['pore_strength']
    nt.links.new(pores.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    # subsurface + specular
    bsdf.subsurface_method = 'RANDOM_WALK_SKIN'
    bsdf.inputs['Subsurface Weight'].default_value = 1.0
    bsdf.inputs['Subsurface Radius'].default_value = o['sss_radius']
    bsdf.inputs['Subsurface Scale'].default_value = o['sss_scale']
    bsdf.inputs['Subsurface IOR'].default_value = 1.4
    bsdf.inputs['Specular IOR Level'].default_value = o['specular']
    bsdf.inputs['Sheen Weight'].default_value = o['sheen']
    bsdf.inputs['Sheen Roughness'].default_value = 0.4
    me = basemesh.data
    for i in range(len(me.materials)):
        name = me.materials[i].name if me.materials[i] else ''
        if any(k in name for k in ('body', 'lips', 'ears', 'nipple', 'genitals')):
            me.materials[i] = m
    return m


# --- eyes -------------------------------------------------------------------------------------------------------

def eyes(eye_obj, iris_image_path=None):
    """Eyeball shading + a separate refractive cornea shell (duplicate pushed out ~0.4 mm, front hemisphere bulged)."""
    me = eye_obj.data
    mat = me.materials[0]
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE'), None)
    if iris_image_path and tex:
        tex.image = bpy.data.images.load(iris_image_path, check_existing=True)
    bsdf.inputs['Roughness'].default_value = 0.32
    bsdf.inputs['Specular IOR Level'].default_value = 0.2
    bsdf.inputs['Subsurface Weight'].default_value = 0.15
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.4, 0.3)
    bsdf.inputs['Subsurface Scale'].default_value = 0.002
    # slightly warm, not paper-white sclera
    if tex:
        hsv = nt.nodes.new('ShaderNodeHueSaturation')
        hsv.inputs['Value'].default_value = 0.82
        hsv.inputs['Saturation'].default_value = 1.1
        src = tex.outputs['Color']
        for l in list(src.links):
            nt.links.new(hsv.outputs['Color'], l.to_socket)
        nt.links.new(src, hsv.inputs['Color'])
    cornea = eye_obj.copy()
    cornea.data = eye_obj.data.copy()
    cornea.name = eye_obj.name + '.cornea'
    bpy.context.scene.collection.objects.link(cornea)
    cornea.parent = eye_obj.parent
    cornea.matrix_world = eye_obj.matrix_world
    # push outward along normals: a thin shell, with the front cap (iris) bulged a little more
    bm = bmesh.new()
    bm.from_mesh(cornea.data)
    bm.normal_update()
    # per eye: eyes are two islands; find each island's centre to know "forward"
    centres = []
    islands = []
    seen = set()
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, isl = [v], []
        seen.add(v.index)
        while stack:
            a = stack.pop()
            isl.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index)
                    stack.append(b)
        islands.append(isl)
        centres.append(sum((x.co for x in isl), Vector()) / len(isl))
    kill = []
    for isl, c in zip(islands, centres):
        for v in isl:
            d = (v.co - c).normalized()
            front = -d.y  # character looks -Y
            if front < 0.55:
                kill.append(v)
                continue
            # thin shell (0.25 mm) bulging a little more over the iris, like a real cornea
            v.co = v.co + d * (0.00025 + 0.0006 * max(0.0, (front - 0.8) / 0.2) ** 2)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(cornea.data)
    bm.free()
    cm = bpy.data.materials.new('cornea')
    cm.use_nodes = True
    cb = cm.node_tree.nodes['Principled BSDF']
    cb.inputs['Base Color'].default_value = (1, 1, 1, 1)
    cb.inputs['Transmission Weight'].default_value = 1.0
    cb.inputs['Roughness'].default_value = 0.0
    cb.inputs['IOR'].default_value = 1.376
    cb.inputs['Specular IOR Level'].default_value = 0.9
    cornea.data.materials.clear()
    cornea.data.materials.append(cm)
    for mod in list(cornea.modifiers):
        if mod.type == 'SUBSURF':
            mod.levels = mod.render_levels = 2
    return cornea


# --- hair -------------------------------------------------------------------------------------------------------

def _surface_samples(obj, weight_fn, count, seed):
    """Area-weighted random surface points on the evaluated mesh where weight_fn(co, normal) > 0."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', tri)
    tri = tri.reshape(-1, 3)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    cen = (a + b + c) / 3
    n = np.cross(b - a, c - a)
    area = 0.5 * np.linalg.norm(n, axis=1)
    nn = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    w = weight_fn(cen, nn) * area
    w = np.clip(w, 0, None)
    ev.to_mesh_clear()
    r = np.random.default_rng(seed)
    p = w / w.sum()
    pick = r.choice(len(tri), size=count, p=p)
    u = r.random(count)
    v = r.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    pts = a[pick] + (b[pick] - a[pick]) * u[:, None] + (c[pick] - a[pick]) * v[:, None]
    return pts, nn[pick]


def hair_curves(basemesh, name, *, count=60000, segments=6, length_fn, comb_fn, curl=0.0, curl_freq=2.5, radius=0.00009,
                melanin=0.92, redness=0.25, rough=0.38, mask_fn, seed=7, clump=0.3):
    pts, nrm = _surface_samples(basemesh, mask_fn, count, seed)
    r = np.random.default_rng(seed + 1)
    L = length_fn(pts) * r.uniform(0.75, 1.15, count)
    comb = comb_fn(pts, nrm)
    # tangent-plane comb direction mixed with the normal (hair leaves the scalp, then lies down)
    tang = comb - nrm * np.sum(comb * nrm, axis=1, keepdims=True)
    tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
    out = np.zeros((count, segments + 1, 3))
    for k in range(segments + 1):
        t = k / segments
        lift = 0.75 * (1 - t) + 0.12
        d = nrm * lift + tang * (1 - lift + 0.2)
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        if k == 0:
            out[:, 0] = pts - nrm * 0.0006  # roots slightly below the scalp
            continue
        step = d * (L / segments)[:, None]
        if curl > 0:
            ph = r.uniform(0, 2 * np.pi, count) if k == 1 else ph  # noqa: F821
            side = np.cross(d, nrm)
            side /= np.maximum(np.linalg.norm(side, axis=1, keepdims=True), 1e-9)
            ang = ph + t * curl_freq * 2 * np.pi
            step = step + (side * np.cos(ang)[:, None] + nrm * np.sin(ang)[:, None]) * (curl * L / segments)[:, None]
        out[:, k] = out[:, k - 1] + step
    cv = bpy.data.hair_curves.new(name)
    cv.add_curves([segments + 1] * count)
    cv.position_data.foreach_set('vector', out.reshape(-1).astype(np.float32))
    rad = np.tile(np.linspace(radius, radius * 0.35, segments + 1), count).astype(np.float32)
    if 'radius' not in cv.attributes:
        cv.attributes.new('radius', 'FLOAT', 'POINT')
    cv.attributes['radius'].data.foreach_set('value', rad)
    ob = bpy.data.objects.new(name, cv)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = basemesh.matrix_world
    m = bpy.data.materials.new(name + '_mat')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    h = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    h.parametrization = 'MELANIN'
    h.inputs['Melanin'].default_value = melanin
    h.inputs['Melanin Redness'].default_value = redness
    h.inputs['Roughness'].default_value = rough
    h.inputs['Radial Roughness'].default_value = 0.45
    h.inputs['Coat'].default_value = 0.08
    h.inputs['Random Color'].default_value = 0.12
    h.inputs['Random Roughness'].default_value = 0.2
    nt.links.new(h.outputs[0], o.inputs['Surface'])
    cv.materials.append(m)
    return ob


def hair_cards(curves_obj, *, every=5, width=0.0016, name='hair_cards', bone='head', melanin_color=(0.018, 0.013, 0.011), surface=None):
    """Real-time hair: one ribbon per kept strand, lying across the surface (normal = from the scalp), UV u across, v along.
    The game shades it with a strand alpha texture + anisotropic highlight."""
    cv = curves_obj.data
    n = len(cv.curves)
    pos = np.empty(len(cv.points) * 3, dtype=np.float32)
    cv.position_data.foreach_get('vector', pos)
    pos = pos.reshape(-1, 3)
    sizes = np.array([c.points_length for c in cv.curves])
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]])
    keep = np.arange(0, n, every)
    verts, faces, uvs = [], [], []
    for ci in keep:
        p = pos[starts[ci]:starts[ci] + sizes[ci]]
        if len(p) < 2:
            continue
        out = p[-1] - p[0]
        root_n = p[1] - p[0]
        root_n /= max(np.linalg.norm(root_n), 1e-9)
        base = len(verts)
        for k, q in enumerate(p):
            tdir = p[min(k + 1, len(p) - 1)] - p[max(k - 1, 0)]
            tdir /= max(np.linalg.norm(tdir), 1e-9)
            side = np.cross(tdir, root_n)
            sl = np.linalg.norm(side)
            side = side / sl if sl > 1e-6 else np.cross(tdir, (0, 0, 1))
            w = width * (1.0 - 0.6 * k / (len(p) - 1))
            verts.append(q - side * w / 2)
            verts.append(q + side * w / 2)
            v = k / (len(p) - 1)
            uvs.append((0.0, v))
            uvs.append((1.0, v))
        for k in range(len(p) - 1):
            a = base + 2 * k
            faces.append((a, a + 1, a + 3, a + 2))
        del out
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    loop_uv = [uvs[li] for poly in me.polygons for li in [me.loops[i].vertex_index for i in poly.loop_indices]]
    uvl.data.foreach_set('uv', np.array(loop_uv, dtype=np.float32).ravel())
    for poly in me.polygons:
        poly.use_smooth = True
    # Shading normals from the scalp underneath (not from each curly ribbon): the hair is lit as one coherent volume, the way hair
    # cards are authored for games, instead of every ribbon flashing its own highlight. The strand direction comes from the tangent.
    surf = surface or getattr(cv, 'surface', None)
    if surf is not None and surf.type == 'MESH':
        from mathutils.bvhtree import BVHTree
        dg = bpy.context.evaluated_depsgraph_get()
        se = surf.evaluated_get(dg)
        tree = BVHTree.FromObject(se, dg)
        to_s = surf.matrix_world.inverted() @ curves_obj.matrix_world
        n3 = surf.matrix_world.to_3x3()
        o3 = curves_obj.matrix_world.inverted().to_3x3()
        nrm = []
        for v in verts:
            hit = tree.find_nearest(to_s @ Vector((float(v[0]), float(v[1]), float(v[2]))))
            nn = (o3 @ (n3 @ hit[1])).normalized() if hit[0] is not None else Vector((0, 0, 1))
            nrm.append(nn)
        me.normals_split_custom_set_from_vertices(nrm)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = curves_obj.matrix_world
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    m = bpy.data.materials.new(name + '_mat')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*melanin_color, 1)
    m['ft'] = '{"type": "hair", "color": [%f, %f, %f]}' % melanin_color
    me.materials.append(m)
    return ob


def hair_shell(basemesh, rig, name, color=(0.018, 0.013, 0.011), min_len=0.0002, shells=20):
    """Real-time short hair as shells: the scalp patch of the body (every face touching a vertex with hair) copied into its own mesh,
    subdivided, with the hair length per vertex in the GAME colour (R = length / 25 mm; from 'hair_len' written by the build). The engine stacks `shells`
    offset copies of it and cuts coiled strands out of each layer with 3D cellular noise (src/rendering/charmat.ts, hairShell).
    Keeps the body's skin weights and only the face shape keys that move the scalp (brows lift the hairline)."""
    import json
    me = basemesh.data.copy()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = rig
    ob.matrix_world = basemesh.matrix_world.copy()
    for g in basemesh.vertex_groups:
        ob.vertex_groups.new(name=g.name)
    bm = bmesh.new()
    bm.from_mesh(me)
    lay = bm.verts.layers.float.get('hair_len')
    kill = [f for f in bm.faces if max(v[lay] for v in f.verts) < min_len]
    bmesh.ops.delete(bm, geom=kill, context='FACES_ONLY')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    # shape keys: keep only those that move this patch
    if me.shape_keys:
        kb = me.shape_keys.key_blocks
        n = len(me.vertices)
        base = np.empty(n * 3, dtype=np.float32)
        kb[0].data.foreach_get('co', base)
        for k in list(kb)[1:]:
            c = np.empty(n * 3, dtype=np.float32)
            k.data.foreach_get('co', c)
            if np.abs(c - base).max() < 2e-5:
                ob.shape_key_remove(k)
            else:
                k.value = 0.0
    for a in [a.name for a in me.color_attributes]:
        me.color_attributes.remove(me.color_attributes[a])
    # the body's scalp is coarse (a few hundred vertices): two Catmull-Clark levels so the shells have smooth silhouettes. Applied
    # once for the basis and once per shape key, so the face keys survive the subdivision.
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = sub.render_levels = 1
    dg = bpy.context.evaluated_depsgraph_get()
    keys = list(me.shape_keys.key_blocks) if me.shape_keys else []
    for k in keys:
        k.value = 0.0
    dg.update()
    new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    nn = len(new.vertices)
    shapes = []
    for k in keys[1:]:
        k.value = 1.0
        dg.update()
        tmp = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
        c = np.empty(nn * 3, dtype=np.float32)
        tmp.vertices.foreach_get('co', c)
        shapes.append((k.name, c))
        bpy.data.meshes.remove(tmp)
        k.value = 0.0
    ob.modifiers.remove(sub)
    ob.shape_key_clear()
    ob.data = new
    me = new
    if shapes:
        ob.shape_key_add(name='Basis', from_mix=False)
        for nm, c in shapes:
            sk = ob.shape_key_add(name=nm, from_mix=False)
            sk.data.foreach_set('co', c)
            sk.value = 0.0
    hl = np.empty(nn, dtype=np.float32)
    me.attributes['hair_len'].data.foreach_get('value', hl)
    me.attributes.remove(me.attributes['hair_len'])
    hm = np.ones(nn, dtype=np.float32)
    if 'hair_mask' in me.attributes:
        me.attributes['hair_mask'].data.foreach_get('value', hm)
        me.attributes.remove(me.attributes['hair_mask'])
    game_color(ob, np.clip(hl / 0.025, 0, 1), np.clip(hm, 0, 1))  # R = hair length / 25 mm, G = growth density (hairline, fade)
    me.materials.clear()
    m = bpy.data.materials.new(name + '_mat')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1)
    m['ft'] = json.dumps({'type': 'hairshell', 'color': list(color), 'shells': shells})
    me.materials.append(m)
    for p in me.polygons:
        p.material_index = 0
    a = ob.modifiers.new('Armature', 'ARMATURE')
    a.object = rig
    return ob


def game_color(obj, r, g=None, b=None):
    """Per-vertex data for the engine in the colour attribute 'GAME' (exported as COLOR_0 by name; gltfpack keeps COLOR_0 but drops
    custom attributes). Values in 0..1."""
    me = obj.data
    n = len(me.vertices)
    a = me.color_attributes.get('GAME') or me.color_attributes.new('GAME', 'FLOAT_COLOR', 'POINT')
    rgba = np.ones((n, 4), dtype=np.float32)
    rgba[:, 0] = r
    rgba[:, 1] = r if g is None else g
    rgba[:, 2] = r if b is None else b
    a.data.foreach_set('color', rgba.ravel())
    return a


def vertex_ao(obj, occluders, distance=0.012, rays=96, floor=0.0, seed=3):
    """Ray-traced ambient occlusion per vertex of `obj` against `occluders` (evaluated meshes), written to the GAME colour (R)
    for the engine (eyes: lid + lash occlusion on the sclera; teeth: the mouth cavity). Cosine-weighted hemisphere rays from each vertex along its normal, misses = open sky."""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    trees = []
    for oc in occluders:
        oe = oc.evaluated_get(dg)
        trees.append((BVHTree.FromObject(oe, dg), oc.matrix_world.inverted() @ obj.matrix_world, (oc.matrix_world.inverted() @ obj.matrix_world).to_3x3()))
    rng = np.random.default_rng(seed)
    u1, u2 = rng.random(rays), rng.random(rays)
    r, phi = np.sqrt(u1), 2 * np.pi * u2
    local = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - u1)], axis=1)  # cosine-weighted, z = normal
    me = obj.data
    out = np.ones(len(me.vertices), dtype=np.float32)
    for v in me.vertices:
        n = v.normal.normalized()
        t = n.orthogonal().normalized()
        b = n.cross(t)
        hit = 0
        for lx, ly, lz in local:
            d = t * lx + b * ly + n * lz
            for tree, m4, m3 in trees:
                o = m4 @ (v.co + n * 0.0002)
                if tree.ray_cast(o, (m3 @ d).normalized(), distance)[0] is not None:
                    hit += 1
                    break
        out[v.index] = max(floor, 1.0 - hit / rays)
    game_color(obj, out)
    return out


def bake(obj, material, kind, image_path, size=2048, samples=8):
    """Bake one channel ('DIFFUSE' colour or 'ROUGHNESS') of `material` on `obj` into a PNG via its UVs."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    img = bpy.data.images.new(os.path.basename(image_path), size, size, alpha=False, float_buffer=False)
    if kind != 'DIFFUSE':
        img.colorspace_settings.name = 'Non-Color'
    nt = material.node_tree
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    nt.nodes.active = node
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    sc.render.bake.use_pass_direct = False
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.use_pass_color = True
    sc.render.bake.margin = 8
    bpy.ops.object.bake(type=kind)
    img.filepath_raw = image_path
    img.file_format = 'PNG'
    os.makedirs(os.path.dirname(image_path), exist_ok=True)
    img.save()
    nt.nodes.remove(node)
    return image_path
