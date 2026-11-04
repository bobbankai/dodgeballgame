"""Character finishing: everything between an MPFB human and a game-ready GLB.

- bake body shape targets, add FACS-style expression morphs (MakeHuman expression units, CC0) and
  propagate them to the fitted proxies (brows, lashes, teeth) by refitting per expression
- strip MakeHuman helper geometry
- convert materials to glTF PBR: skin (2K diffuse + generated roughness), eyes (glossy), alpha-tested
  brows / lashes / hair; outfit pieces bring their own materials
- export GLB (skin, morphs, WebP textures)
"""
import bpy
import bmesh
import math
import os
import sys
import numpy as np
from mathutils import Vector

MPFB_DATA = '/root/.config/blender/4.5/extensions/.user/user_default/mpfb/data'
MPFB_SYS = '/root/.config/blender/4.5/extensions/user_default/mpfb/data'

# morph name -> (expression unit file stem, side) ; units exist per race: african / asian / caucasian
EXPRESSIONS = {
    'blink_L': 'eye-left-closure', 'blink_R': 'eye-right-closure',
    'squint_L': 'eye-left-slit', 'squint_R': 'eye-right-slit',
    'wide_L': 'eye-left-opened-up', 'wide_R': 'eye-right-opened-up',
    'browUp_L': 'eyebrows-left-up', 'browUp_R': 'eyebrows-right-up',
    'browDown_L': 'eyebrows-left-down', 'browDown_R': 'eyebrows-right-down',
    'browInner_L': 'eyebrows-left-inner-up', 'browInner_R': 'eyebrows-right-inner-up',
    'jawOpen': 'mouth-open', 'smile': 'mouth-corner-puller', 'frown': 'mouth-depression',
    'press': 'mouth-compression', 'pucker': 'mouth-pursing', 'stretch': 'mouth-retraction',
    'snarl': 'mouth-upward-retraction', 'lipsPart': 'mouth-parling',
    'sneer_L': 'nose-left-elevation', 'sneer_R': 'nose-right-elevation',
}


def objects_of(rig):
    return [o for o in bpy.data.objects if o.type == 'MESH' and o.parent is rig]


def proxies_of(base, rig):
    return [o for o in objects_of(rig) if o is not base]


def bake_shape(base):
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    if base.data.shape_keys:
        TargetService.bake_targets(base)


def add_expressions(base, rig, race='caucasian', names=None):
    """Load expression units as shape keys on the body and refit proxies to make matching keys."""
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
    names = names or list(EXPRESSIONS)
    unit_dir = os.path.join(MPFB_SYS, 'targets', 'expression', 'units', race)
    if base.data.shape_keys is None:
        base.shape_key_add(name='Basis')
    prox = [p for p in proxies_of(base, rig) if any(k in p.name for k in ('eyebrow', 'eyelash', 'teeth', 'tongue', 'eye'))]
    rest = {p.name: np.array([v.co[:] for v in p.data.vertices]) for p in prox}
    shapes = {p.name: {} for p in prox}
    for n in names:
        path = os.path.join(unit_dir, EXPRESSIONS[n] + '.target.gz')
        k = TargetService.load_target(base, path, weight=1.0, name=n)
        for p in prox:
            try:
                ClothesService.fit_clothes_to_human(p, base, set_parent=False)
                shapes[p.name][n] = np.array([v.co[:] for v in p.data.vertices])
            except Exception as e:  # some proxies may not refit (no mhclo source): skip
                print('refit failed', p.name, e)
        k.value = 0.0
    for p in prox:
        for i, v in enumerate(p.data.vertices):
            v.co = rest[p.name][i]
        if not shapes[p.name]:
            continue
        moved = {n: s for n, s in shapes[p.name].items() if np.abs(s - rest[p.name]).max() > 1e-5}
        if not moved:
            continue
        p.shape_key_add(name='Basis')
        for n, s in moved.items():
            kb = p.shape_key_add(name=n)
            kb.data.foreach_set('co', s.reshape(-1))
    # body keys: keep only the expression keys
    for kb in list(base.data.shape_keys.key_blocks):
        if kb.name != 'Basis' and kb.name not in names:
            base.shape_key_remove(kb)


def remove_helpers(base):
    """Delete MakeHuman helper geometry (hidden helper meshes used for fitting) and masked parts."""
    vg = {g.name: g.index for g in base.vertex_groups}
    kill = set()
    for gname in ('HelperGeometry', 'JointCubes'):
        if gname in vg:
            gi = vg[gname]
            for v in base.data.vertices:
                for g in v.groups:
                    if g.group == gi and g.weight > 0.5:
                        kill.add(v.index)
    bm = bmesh.new()
    bm.from_mesh(base.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context='VERTS')
    bm.to_mesh(base.data)
    bm.free()
    for m in list(base.modifiers):
        if m.type == 'MASK':
            base.modifiers.remove(m)
    for gname in ('HelperGeometry', 'JointCubes'):
        g = base.vertex_groups.get(gname)
        if g:
            base.vertex_groups.remove(g)


def delete_body_faces(base, predicate):
    """Delete body faces hidden under clothing. predicate(world_pos, vertex_groups_dict) -> bool for verts to hide.
    A face is removed only when all its verts are hidden (no holes at garment edges)."""
    vgn = {g.index: g.name for g in base.vertex_groups}
    hide = np.zeros(len(base.data.vertices), bool)
    mw = base.matrix_world
    for v in base.data.vertices:
        groups = {vgn[g.group]: g.weight for g in v.groups}
        hide[v.index] = predicate(mw @ v.co, groups)
    bm = bmesh.new()
    bm.from_mesh(base.data)
    faces = [f for f in bm.faces if all(hide[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=faces, context='FACES_ONLY')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(base.data)
    bm.free()


# ------------------------------------------------------------------ materials

def img_load(path, colorspace='sRGB'):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def principled(name, base_img=None, base_color=(0.8, 0.8, 0.8, 1), rough=0.5, rough_img=None, normal_img=None,
               metal=0.0, alpha_img=False, alpha_clip=False, orm_img=None, emissive=None, emissive_img=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = base_color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if base_img:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = base_img
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha_img:
            nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
            m.blend_method = 'CLIP' if alpha_clip else 'HASHED'
            m.surface_render_method = 'DITHERED'
    if orm_img:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = orm_img
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        # glTF exporter recognises an occlusion texture via a glTF Material Output group; AO is in R
    elif rough_img:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = rough_img
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    if normal_img:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = normal_img
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emissive is not None:
        bsdf.inputs['Emission Color'].default_value = (*emissive[:3], 1)
        bsdf.inputs['Emission Strength'].default_value = emissive[3] if len(emissive) > 3 else 1.0
    if emissive_img is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = emissive_img
        nt.links.new(t.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emissive[3] if emissive and len(emissive) > 3 else 1.0
    return m


def mhmat_texture(mhmat_path, key='diffuseTexture'):
    d = os.path.dirname(mhmat_path)
    with open(mhmat_path) as f:
        for line in f:
            if line.startswith(key):
                return os.path.join(d, line.split(None, 1)[1].strip())
    return None


def skin_roughness(base, size=1024, out_path=None):
    """Bake a roughness map (G channel) for the skin from regions: oily T-zone, glossy lips, matte elsewhere."""
    vgn = {g.name: g.index for g in base.vertex_groups}
    me = base.data
    rough = np.full(len(me.vertices), 0.55)
    head = vgn.get('head')
    lips = vgn.get('lips')
    mw = base.matrix_world
    zs = np.array([(mw @ v.co).z for v in me.vertices])
    ztop = zs.max()
    for v in me.vertices:
        w = {g.group: g.weight for g in v.groups}
        p = mw @ v.co
        r = 0.55
        if head is not None and w.get(head, 0) > 0.5:
            # T-zone: centre of the face, front
            if abs(p.x) < 0.035 and p.y < -0.05:
                r = 0.42
            else:
                r = 0.5
        if lips is not None and w.get(lips, 0) > 0.3:
            r = 0.34
        rough[v.index] = r + (math.sin(p.x * 91 + p.z * 57) * 0.5 + math.sin(p.y * 73) * 0.5) * 0.03
    return bake_vertex_scalar(base, rough, size, out_path, 'skin_rough')


def bake_vertex_scalar(obj, values, size, out_path, name):
    """Rasterise a per-vertex scalar into the object's UV space (Cycles emission bake)."""
    me = obj.data
    attr = me.color_attributes.new(name='bake_tmp', type='FLOAT_COLOR', domain='POINT')
    for i, v in enumerate(values):
        attr.data[i].color = (0.0, float(v), 0.0, 1.0)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    mats = [s.material for s in obj.material_slots]
    tmp = bpy.data.materials.new('bake_tmp_mat')
    tmp.use_nodes = True
    nt = tmp.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    ca = nt.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'bake_tmp'
    nt.links.new(ca.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = img
    nt.nodes.active = tn
    obj.data.materials.clear()
    obj.data.materials.append(tmp)
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 1
    scn.cycles.device = 'CPU'
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='EMIT', margin=8, use_clear=True)
    obj.data.materials.clear()
    for m in mats:
        obj.data.materials.append(m)
    me.color_attributes.remove(me.color_attributes['bake_tmp'])
    if out_path:
        img.filepath_raw = out_path
        img.file_format = 'PNG'
        img.save()
    return img


def convert_human_materials(base, rig, spec, workdir):
    """Replace MPFB node materials with glTF-friendly PBR ones."""
    os.makedirs(workdir, exist_ok=True)
    skin_mhmat = None
    sdir = os.path.join(MPFB_DATA, 'skins', spec['skin'])
    for f in os.listdir(sdir):
        if f.endswith('.mhmat'):
            skin_mhmat = os.path.join(sdir, f)
    rough_img = skin_roughness(base, 1024, os.path.join(workdir, 'skin_rough.png'))
    if spec.get('ash'):
        g = 'female' if spec['phenotype'].get('gender', 0.5) < 0.5 else 'male'
        skin_img = img_load(f'/opt/raw/work/tex/ash_{g}.png')
        crack_img = img_load(f'/opt/raw/work/tex/ash_{g}_cracks.png')
        skin = principled('skin', base_img=skin_img, rough_img=rough_img, rough=1.0, emissive=(1, 1, 1, 1.0), emissive_img=crack_img)
        skin['glow'] = 1
    else:
        skin_img = img_load(mhmat_texture(skin_mhmat))
        skin = principled('skin', base_img=skin_img, rough_img=rough_img, rough=1.0)
    base.data.materials.clear()
    base.data.materials.append(skin)
    from bl_ext.user_default.mpfb.services.objectservice import ObjectService
    for p in proxies_of(base, rig):
        n = p.name.lower()
        otype = str(ObjectService.get_object_type(p) or '').lower()
        if otype == 'clothes' or (p.active_material and 'tex' in p.active_material):
            continue
        if 'eyebrow' in n or 'eyelash' in n:
            mh = find_mhmat(p, 'eyebrows' if 'eyebrow' in n else 'eyelashes')
            img = img_load(mhmat_texture(mh))
            mat = principled('brows' if 'eyebrow' in n else 'lashes', base_img=img, alpha_img=True, alpha_clip=True, rough=0.7)
        elif 'teeth' in n or 'tongue' in n:
            mh = find_mhmat(p, 'teeth' if 'teeth' in n else 'tongue')
            tex = mhmat_texture(mh) if mh else None
            mat = principled('teeth' if 'teeth' in n else 'tongue', base_img=img_load(tex) if tex and os.path.exists(tex) else None,
                             base_color=(0.85, 0.8, 0.72, 1) if 'teeth' in n else (0.6, 0.25, 0.25, 1), rough=0.3)
        elif '.high-poly' in n or '.low-poly' in n:
            eye = spec.get('eye_texture', 'brown')
            ed = os.path.join(MPFB_DATA, 'eyes', 'materials')
            path = None
            if os.path.isdir(os.path.join(ed, eye)):
                for f in os.listdir(os.path.join(ed, eye)):
                    if f.endswith('.png'):
                        path = os.path.join(ed, eye, f)
            else:
                path = os.path.join(ed, f'{eye}_eye.png')
            img = img_load(path)
            mat = principled('eyes', base_img=img, rough=0.25, emissive=spec.get('eye_glow'))
            if spec.get('eye_glow'):
                mat['glow'] = 1
            cornea = principled('cornea', base_color=(0, 0, 0, 1), rough=0.03)
            p.data.materials.clear()
            p.data.materials.append(mat)
            p.data.materials.append(cornea)
            split_cornea(p, img)
            continue
        else:
            mh = find_mhmat(p, 'hair')
            hair_variant = spec.get('hair_material')
            tex = None
            if hair_variant:
                vd = os.path.join(os.path.dirname(mh), hair_variant)
                for f in os.listdir(vd):
                    if f.endswith('.png') or f.endswith('.jpg'):
                        tex = os.path.join(vd, f)
            tex = tex or mhmat_texture(mh)
            img = img_load(tex)
            if spec.get('hair_grey'):
                img = grey_hair(img, spec['hair_grey'])
            if spec.get('hair_dye'):
                img = dye_hair(img, spec['hair_dye'])
            mat = principled('hair', base_img=img, alpha_img=True, alpha_clip=True, rough=0.45)
        p.data.materials.clear()
        p.data.materials.append(mat)


def grey_hair(img, amount):
    """age a hair texture: strands go grey-white keeping their light/dark variation (alpha untouched)"""
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    lum = px[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    grey = np.clip(0.32 + lum[..., None] * 2.4, 0, 1) * np.array([0.92, 0.9, 0.88], dtype=np.float32)
    px[..., :3] = px[..., :3] * (1 - amount) + grey * amount
    out = bpy.data.images.new(img.name + '_grey', w, h, alpha=True)
    out.pixels[:] = px.reshape(-1)
    out.pack()
    return out


def dye_hair(img, color):
    """recolour a (light) hair texture: keep the strand light/dark detail, map it onto a dark dye colour"""
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    lum = px[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lum = lum / max(float(np.percentile(lum[px[..., 3] > 0.5], 90)) if (px[..., 3] > 0.5).any() else 1.0, 1e-3)
    px[..., :3] = np.clip(np.array(color, dtype=np.float32) * (0.35 + lum[..., None] * 0.9), 0, 1)
    out = bpy.data.images.new(img.name + '_dyed', w, h, alpha=True)
    out.pixels[:] = px.reshape(-1)
    out.pack()
    return out


def split_cornea(obj, img):
    """Faces whose texture is transparent are the cornea shell: give them material slot 1."""
    w, h = img.size
    px = np.array(img.pixels[:]).reshape(h, w, 4)
    me = obj.data
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        us = [uv[i].uv for i in poly.loop_indices]
        cu = sum(u.x for u in us) / len(us)
        cv = sum(u.y for u in us) / len(us)
        a = px[min(h - 1, max(0, int(cv * h))), min(w - 1, max(0, int(cu * w))), 3]
        poly.material_index = 1 if a < 0.5 else 0


def find_mhmat(obj, sub):
    from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties
    src = GeneralObjectProperties.get_value('asset_source', entity_reference=obj)
    if not src:
        return None
    d = os.path.join(MPFB_DATA, sub, os.path.dirname(src)) if '/' in src else os.path.join(MPFB_DATA, sub, os.path.splitext(src)[0])
    if not os.path.isdir(d):
        d = os.path.dirname(os.path.join(MPFB_DATA, sub, src))
    for f in os.listdir(d):
        if f.endswith('.mhmat'):
            return os.path.join(d, f)
    return None


# ------------------------------------------------------------------ export

def downsize_images(max_size):
    for img in bpy.data.images:
        if img.size[0] > max_size or img.size[1] > max_size:
            k = max_size / max(img.size[0], img.size[1])
            img.scale(max(4, int(img.size[0] * k)), max(4, int(img.size[1] * k)))


def strip_tiling_textures():
    """Materials built from the shared tiling sets keep only factors + extras (tex, tint, scale, ...);
    the game binds the shared textures at load, so GLBs don't carry copies."""
    for m in bpy.data.materials:
        if 'tex' not in m or not m.use_nodes:
            continue
        nt = m.node_tree
        b = nt.nodes.get('Principled BSDF')
        for n in list(nt.nodes):
            if n.type in ('TEX_IMAGE', 'NORMAL_MAP', 'SEPARATE_COLOR', 'MIX', 'MAPPING', 'UVMAP'):
                nt.nodes.remove(n)
        t = m['tint']
        b.inputs['Base Color'].default_value = (t[0], t[1], t[2], 1)
        b.inputs['Roughness'].default_value = m.get('rough_fixed', 1.0)


def export_glb(path, rig, extra=(), animations=False, tex_quality=88):
    strip_tiling_textures()
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for o in bpy.data.objects:
        if o.parent is rig:
            o.select_set(True)
    for o in extra:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_image_format='WEBP',
        export_image_quality=tex_quality, export_yup=True, export_apply=False, export_skins=True,
        export_morph=True, export_morph_normal=False, export_animations=animations, export_def_bones=False,
        export_extras=True, export_cameras=False, export_lights=False, export_tangents=False,
        export_vertex_color='NAME', export_vertex_color_name='Col', export_all_vertex_colors=False,
    )
    pack(path)


def pack(path, extra_args=()):
    """meshopt-compress with gltfpack: keep names, materials, extras and all vertex attributes (UVs on
    materials that get their textures at runtime)."""
    import subprocess
    root = os.path.join(os.path.dirname(__file__), '..', '..', '..')
    tmp = path + '.tmp.glb'
    r = subprocess.run(['npx', 'gltfpack', '-i', path, '-o', tmp, '-cc', '-kn', '-km', '-ke', '-kv', '-vtf', *extra_args],
                       cwd=root, capture_output=True, text=True)
    if r.returncode == 0 and os.path.exists(tmp):
        os.replace(tmp, path)
    else:
        print('gltfpack failed', r.stdout, r.stderr)


def add_eye_bones(rig, eyes_obj):
    """eye_l / eye_r bones at the eyeball centres (children of head); eyeball + cornea verts follow them,
    so the game can aim the eyes (gaze, saccades)."""
    import numpy as np
    if eyes_obj is None:
        return
    co = np.array([(eyes_obj.matrix_world @ v.co)[:] for v in eyes_obj.data.vertices])
    centres = {}
    for side, sgn in (('l', 1), ('r', -1)):
        sel = co[co[:, 0] * sgn > 0]
        if len(sel):
            centres[side] = sel.mean(0)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    head = eb['head']
    for side, c in centres.items():
        b = eb.new(f'eye_{side}')
        b.head = Vector(c)
        b.tail = Vector(c) + Vector((0, -0.025, 0))
        b.roll = 0
        b.parent = head
        b.use_deform = True
    bpy.ops.object.mode_set(mode='OBJECT')
    # weights
    for g in list(eyes_obj.vertex_groups):
        eyes_obj.vertex_groups.remove(g)
    for side, sgn in (('l', 1), ('r', -1)):
        g = eyes_obj.vertex_groups.new(name=f'eye_{side}')
        idx = [i for i, p in enumerate(co) if p[0] * sgn > 0]
        g.add(idx, 1.0, 'REPLACE')
