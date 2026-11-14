"""
The realistic-person pipeline (the one proven on Ethan), driven by a spec, so every human in the cast is built the same way:
MPFB / MakeHuman base (CC0 assets: anatomy, topology, UVs, eyes, brows, lashes, teeth, game skeleton) + face targets, layered skin
(SSS, roughness zones, pores), refractive corneas, hair (shells for the volume + strand cards for flyaways), the character's own kit,
75 face shapes (ARKit + visemes), baked skin channels, material recipes in glTF extras for the engine.

A spec is a dict:
  name, macro, targets, skin, brows, lashes, eye ('brown_eye.png'...), skin_params (lookdev.skin), stubble (0..1),
  hair: {mask(c, n, top), length(c, top), comb(c, n), curl, curl_freq, count, melanin, redness, color, max_len, look{...}},
  kit(h, rig, PH) -> builds the outfit (objects named <name>_*)
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import detail_maps  # noqa: E402
import lookdev  # noqa: E402
import mpfb_util as M  # noqa: E402
import studio  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TEX = os.path.join(ROOT, 'public', 'assets', 'textures', 'detail')
PH = os.path.join(ROOT, 'vendor', 'polyhaven', 'textures')


def sm(a, b, t):
    x = np.clip((t - a) / (b - a), 0, 1)
    return x * x * (3 - 2 * x)


def build(spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M.enable()
    t0 = time.time()
    h = M.create_human(spec['macro'])
    for name, w in spec['targets'].items():
        M.set_target(h, name, w)
    M.skin(h, spec['skin'])
    parts = {}
    for kind, name in [('eyes', 'high-poly'), ('eyebrows', spec['brows']), ('eyelashes', spec['lashes']), ('teeth', 'teeth_base')]:
        try:
            parts[kind + ':' + name] = M.add(h, kind, name)
        except Exception as e:  # noqa: BLE001
            print('FAILED', kind, name, e)
    rig = M.rig(h, 'game_engine')
    pores = detail_maps.ensure_skin_detail(TEX)
    lookdev.region_masks(h, stubble=spec.get('stubble', 0.0))
    base_img = os.path.join(M.user_data(), 'skins', spec['skin'])
    base_img = os.path.join(base_img, next(f for f in os.listdir(base_img) if f.endswith('.png')))
    lookdev.skin(h, base_img, pores, spec['skin_params'])
    eye = parts.get('eyes:high-poly')
    if eye:
        lookdev.eyes(eye, os.path.join(M.user_data(), 'eyes', 'materials', spec.get('eye', 'brown_eye.png')))
    dg = bpy.context.evaluated_depsgraph_get()
    mods = [(m, m.show_viewport) for m in h.modifiers]
    for m, _ in mods:
        m.show_viewport = False
    dg.update()
    ev = h.evaluated_get(dg).to_mesh()
    co = np.array([v.co for v in ev.vertices])
    nr = np.array([v.normal for v in ev.vertices])
    h.evaluated_get(dg).to_mesh_clear()
    for m, vis in mods:
        m.show_viewport = vis
    top = float(co[:, 2].max())
    hs = spec['hair']
    mask = lambda c, n: hs['mask'](c, n, top)  # noqa: E731
    length = lambda c: hs['length'](c, top)  # noqa: E731
    # hair base: the scalp under the hair painted toward the hair colour where it grows (the standard hair-cap trick)
    base = mask(co, nr) * (0.55 + 0.45 * np.clip(length(co) / max(1e-6, float(length(co).max())), 0, 1))
    attr = h.data.color_attributes['masks']
    rgba = np.empty(len(attr.data) * 4, dtype=np.float32)
    attr.data.foreach_get('color', rgba)
    rgba = rgba.reshape(-1, 4)
    rgba[:, 0] = np.clip(base, 0, 1)
    attr.data.foreach_set('color', rgba.ravel())
    hm = np.clip(mask(co, nr), 0, 1)
    hl = h.data.attributes.get('hair_len') or h.data.attributes.new('hair_len', 'FLOAT', 'POINT')
    hl.data.foreach_set('value', (length(co) * hm).astype(np.float32))
    hd = h.data.attributes.get('hair_mask') or h.data.attributes.new('hair_mask', 'FLOAT', 'POINT')
    hd.data.foreach_set('value', hm.astype(np.float32))
    lookdev.hair_curves(h, f"{spec['name']}_hair", count=hs.get('count', 70000), segments=hs.get('segments', 6), length_fn=length,
                        comb_fn=hs['comb'], curl=hs.get('curl', 0.38), curl_freq=hs.get('curl_freq', 2.2), radius=hs.get('radius', 0.00007),
                        melanin=hs.get('melanin', 0.97), redness=hs.get('redness', 0.12), rough=hs.get('rough', 0.36), mask_fn=mask,
                        seed=hs.get('seed', 11))
    spec['kit'](h, rig, PH)
    print('built', spec['name'], round(time.time() - t0, 1), 's')
    return h, rig, parts, top


def export(spec, h, rig, parts):
    import bmesh
    from bl_ext.user_default.mpfb.services.faceservice import FaceService
    name = spec['name']
    out = os.path.join(ROOT, 'public', 'assets', 'characters', name)
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    skin_m = bpy.data.materials['skin']
    lookdev.bake(h, skin_m, 'DIFFUSE', os.path.join(out, f'{name}_skin_color.png'), 2048)
    lookdev.bake(h, skin_m, 'ROUGHNESS', os.path.join(out, f'{name}_skin_rough.png'), 2048)
    M.bake_targets(h)
    FaceService.load_targets(h, load_microsoft_visemes=True, load_meta_visemes=False, load_arkit_faceunits=True)
    proxies = [(ob, k.split(':')[0], k.split(':')[1]) for k, ob in parts.items() if k.split(':')[0] in ('eyes', 'eyebrows', 'eyelashes', 'teeth')]
    M.bind_proxies(h, rig, proxies, cornea=next((o for o in bpy.data.objects if o.name.endswith('.cornea')), None))
    occl = [o for o in (h, parts.get('eyelashes:' + spec['lashes'])) if o is not None]
    if parts.get('eyes:high-poly'):
        lookdev.vertex_ao(parts['eyes:high-poly'], occl, distance=0.012, rays=96, floor=0.15)
    if parts.get('teeth:teeth_base'):
        lookdev.vertex_ao(parts['teeth:teeth_base'], [h], distance=0.03, rays=64, floor=0.08)
        parts['teeth:teeth_base'].data.materials[0]['ft'] = json.dumps({'type': 'teeth'})
    helper_idx = {g.index for g in h.vertex_groups if g.name in ('HelperGeometry', 'JointCubes', 'ft_hidden')}
    bm = bmesh.new()
    bm.from_mesh(h.data)
    dl = bm.verts.layers.deform.active
    kill = [v for v in bm.verts if dl and any(gi in helper_idx and w > 0.5 for gi, w in v[dl].items())]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(h.data)
    bm.free()
    for mod in list(h.modifiers):
        if mod.type == 'MASK':
            h.modifiers.remove(mod)
    em = bpy.data.materials.new(f'{name}_skin')
    em.use_nodes = True
    nt = em.node_tree
    b = nt.nodes['Principled BSDF']
    for ch, path, cs in (('Base Color', f'{name}_skin_color.png', 'sRGB'), ('Roughness', f'{name}_skin_rough.png', 'Non-Color')):
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = bpy.data.images.load(os.path.join(out, path))
        tn.image.colorspace_settings.name = cs
        nt.links.new(tn.outputs['Color'], b.inputs[ch])
    sp = spec['skin_params']
    em['ft'] = json.dumps({'type': 'skin', 'pores': 'textures/detail/skin_pores_n.png', 'pore_tile': 34, 'pore_strength': spec.get('pore_strength', 0.5),
                           'sss_color': [0.85, 0.3, 0.2], 'sss_scale': sp.get('sss_scale', 0.0042), 'spec': spec.get('skin_spec', 0.36)})
    for i, mm in enumerate(h.data.materials):
        if mm and mm.name == 'skin':
            h.data.materials[i] = em
    eye = parts.get('eyes:high-poly')
    if eye:
        nt2 = eye.data.materials[0].node_tree
        tex = next(n for n in nt2.nodes if n.type == 'TEX_IMAGE')
        bsdf = next(n for n in nt2.nodes if n.type == 'BSDF_PRINCIPLED')
        nt2.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        eye.data.materials[0]['ft'] = json.dumps({'type': 'eye'})
    cm = bpy.data.materials.get('cornea')
    if cm:
        cm['ft'] = json.dumps({'type': 'cornea'})
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in [o for o in bpy.data.objects if o.name.startswith(name + '_') and o.type == 'MESH']:
        for m in [m for m in ob.modifiers if m.type == 'ARMATURE']:
            m.show_viewport = False
        dg.update()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        ob.modifiers.clear()
        ob.data = me
        a = ob.modifiers.new('Armature', 'ARMATURE')
        a.object = rig
    # hard armour parts: baked AO + edge masks on their own atlas (fabric parts keep their metric UVs for the tiled scans)
    arm = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(name + '_') and o.data.materials and
           all(m_ and 'ft' in m_ and json.loads(m_['ft']).get('type') == 'armour' for m_ in o.data.materials)]
    if arm:
        import masks
        masks.bake(arm, os.path.join(out, f'{name}_masks.png'), f'characters/{name}/{name}_masks.png', size=2048, edge_radius=0.005)
    hs = spec['hair']
    hc = bpy.data.objects.get(f'{name}_hair')
    lookdev.hair_shell(h, rig, f'{name}_hair_shell', color=hs.get('color', (0.018, 0.013, 0.011)), shells=hs.get('shells', 20),
                       max_len=hs.get('max_len', 0.025), look=hs.get('look'))
    if hc is not None and not hs.get('cards', True):
        bpy.data.objects.remove(hc)  # coily volumes are all shell: strand cards would read as spikes
        hc = None
    if hc is not None:
        cards = lookdev.hair_cards(hc, every=hs.get('card_every', 10), width=0.0012, name=f'{name}_hair_cards', surface=h)
        cards.parent = rig
        cards.matrix_parent_inverse = rig.matrix_world.inverted()
        a = cards.modifiers.new('Armature', 'ARMATURE')
        a.object = rig
        bpy.data.objects.remove(hc)
    texroot = os.path.join(ROOT, 'public', 'assets', 'textures', 'pbr')
    used = {json.loads(m['ft'])['tex'] for m in bpy.data.materials if 'ft' in m and json.loads(m['ft']).get('type') == 'pbr'}
    for tid in used:
        for kind in ('diff', 'nor_gl', 'rough'):
            src = os.path.join(PH, tid, f'{tid}_{kind}_2k.jpg')
            dst = os.path.join(texroot, tid, f'{tid}_{kind}.jpg')
            if os.path.exists(src) and not os.path.exists(dst):
                img = bpy.data.images.load(src)
                img.scale(1024, 1024)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                img.filepath_raw = dst
                img.file_format = 'JPEG'
                img.save()
                bpy.data.images.remove(img)
    for m_ in bpy.data.materials:
        if 'ft' in m_ and json.loads(m_['ft']).get('type') in ('pbr', 'armour', 'emissive') and m_.node_tree:
            for n_ in [n for n in m_.node_tree.nodes if n.type == 'TEX_IMAGE']:
                m_.node_tree.nodes.remove(n_)
    objs = [rig] + [o for o in bpy.data.objects if o.type == 'MESH' and (o.parent == rig or o.parent == h)]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(out, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT', export_image_format='AUTO',
                              export_skins=True, export_morph=True, export_morph_normal=False, export_animations=False,
                              export_vertex_color='NAME', export_vertex_color_name='GAME', export_all_vertex_colors=False,
                              export_extras=True, export_def_bones=False)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB', round(time.time() - t0, 1), 's')


def main(spec):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    h, rig, parts, top = build(spec)
    if '--review' in argv:
        out = argv[argv.index('--review') + 1]
        samples = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 64
        studio.setup(samples=samples)
        n = spec['name']
        if '--face-only' in argv:
            for nm, yaw, dist in (('face', -8, 0.62), ('face34', -38, 0.7)):
                studio.camera((0, -0.02, top - 0.12), dist, yaw, 3, 85)
                studio.render(os.path.join(out, f'{n}_{nm}.png'), (1000, 1000))
        elif '--body-only' in argv:
            for nm, yaw, pitch in (('front', 0, 2), ('threequarter', -32, 6), ('back', 180, 2)):
                studio.camera((0, 0, top * 0.52), top * 1.65, yaw, pitch, 50)
                studio.render(os.path.join(out, f'{n}_{nm}.png'), (800, 1200))
        else:
            studio.review_set(out, n, height=top, face_z=top - 0.12, samples=samples)
    if '--export' in argv:
        export(spec, h, rig, parts)
