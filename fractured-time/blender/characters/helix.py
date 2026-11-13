"""
HELIX security archetypes (enemies): an MPFB body + game rig wearing the kit's HELIX variant (helmet, visor, armour).
  blender -b --factory-startup --python-exit-code 1 -P blender/characters/helix.py -- --variant trooper|operative|heavy
                                                                                  [--review outdir] [--export]
Every trooper is fully covered (helmet, rebreather, gloves, boots), so the body mesh is not exported: only the skeleton and the kit,
which keeps an enemy at a fraction of the hero's cost. Clips come from the shared humanoid library (same rig).
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
sys.path.insert(0, HERE)
import bpy  # noqa: E402

import ethan_kit  # noqa: E402
import mpfb_util as M  # noqa: E402
import studio  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PH = os.path.join(ROOT, 'vendor', 'polyhaven', 'textures')
BODIES = {
    'trooper': {'gender': 1.0, 'age': 0.5, 'muscle': 0.62, 'weight': 0.52, 'proportions': 0.6, 'height': 0.6,
                'race': {'african': 0.2, 'caucasian': 0.6, 'asian': 0.2}},
    'operative': {'gender': 0.0, 'age': 0.45, 'muscle': 0.6, 'weight': 0.38, 'proportions': 0.7, 'height': 0.62,
                  'race': {'african': 0.3, 'caucasian': 0.3, 'asian': 0.4}},
    'heavy': {'gender': 1.0, 'age': 0.55, 'muscle': 0.9, 'weight': 0.72, 'proportions': 0.55, 'height': 0.78,
              'race': {'african': 0.4, 'caucasian': 0.4, 'asian': 0.2}},
}


def build(variant):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    h = M.create_human(BODIES[variant])
    rig = M.rig(h, 'game_engine')
    ethan_kit.build_kit(h, rig, PH, variant=variant, P='npc', detail=0.35)
    top = max((h.matrix_world @ v.co).z for v in h.data.vertices)
    return h, rig, top


def export(h, rig, variant):
    out = os.path.join(ROOT, 'public', 'assets', 'characters', variant)
    os.makedirs(out, exist_ok=True)
    dg = bpy.context.evaluated_depsgraph_get()
    kit = [o for o in bpy.data.objects if o.name.startswith('npc_') and o.type == 'MESH']
    for ob in kit:
        for m in [m for m in ob.modifiers if m.type == 'ARMATURE']:
            m.show_viewport = False
        dg.update()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        ob.modifiers.clear()
        ob.data = me
        a = ob.modifiers.new('Armature', 'ARMATURE')
        a.object = rig
    # the body is never visible under the armour: drop it (and its proxies)
    for o in [o for o in bpy.data.objects if o.type == 'MESH' and o not in kit]:
        bpy.data.objects.remove(o)
    # textures the engine loads by recipe
    texroot = os.path.join(ROOT, 'public', 'assets', 'textures', 'pbr')
    used = {json.loads(m['ft'])['tex'] for m in bpy.data.materials if 'ft' in m and json.loads(m['ft']).get('type') == 'pbr'}
    for tid in used:
        for kind in ('diff', 'nor_gl', 'rough'):
            dst = os.path.join(texroot, tid, f'{tid}_{kind}.jpg')
            src = os.path.join(PH, tid, f'{tid}_{kind}_2k.jpg')
            if os.path.exists(dst) or not os.path.exists(src):
                continue
            img = bpy.data.images.load(src)
            img.scale(1024, 1024)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            img.filepath_raw = dst
            img.file_format = 'JPEG'
            img.save()
            bpy.data.images.remove(img)
    for m_ in bpy.data.materials:
        if 'ft' in m_ and m_.node_tree:
            for n_ in [n for n in m_.node_tree.nodes if n.type == 'TEX_IMAGE']:
                m_.node_tree.nodes.remove(n_)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for o in kit:
        o.select_set(True)
    path = os.path.join(out, f'{variant}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT',
                              export_skins=True, export_morph=False, export_animations=False, export_extras=True, export_def_bones=False,
                              export_vertex_color='NONE')
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    variant = argv[argv.index('--variant') + 1] if '--variant' in argv else 'trooper'
    h, rig, top = build(variant)
    if '--review' in argv:
        outdir = argv[argv.index('--review') + 1]
        h.hide_render = True
        for o in bpy.data.objects:
            if o.parent == h:
                o.hide_render = True
        studio.setup(samples=32)
        for nm, yaw, pitch in (('front', 0, 2), ('threequarter', -32, 6)):
            studio.camera((0, 0, top * 0.52), top * 1.65, yaw, pitch, 50)
            studio.render(os.path.join(outdir, f'{variant}_{nm}.png'), (800, 1200))
    if '--export' in argv:
        export(h, rig, variant)
