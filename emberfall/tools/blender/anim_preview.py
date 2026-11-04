"""Contact sheets of animation clips: blender -b -P anim_preview.py -- --only a,b --preview <dir> [--times 0,0.2,..]"""
import bpy, glob, math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import anims
import animlib as A
from mathutils import Matrix

rig, skel, baked, out = anims.main()
os.makedirs(out, exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:]
nshots = 6
bpy.ops.import_scene.gltf(filepath=glob.glob('/opt/raw/ph/model/antique_katana_01/*.gltf')[0])
kat = [o for o in bpy.data.objects if o.type == 'MESH' and 'katana' in o.name][0]
kat.parent = None
kat.data.transform(Matrix.Translation((0, 0, 0.065)))
kat.data.transform(Matrix.Rotation(math.radians(90), 4, 'Z'))
scn = bpy.context.scene
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam)
cam.data.lens = 40; scn.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(30)); scn.collection.objects.link(sun)
w = bpy.data.worlds.new('w'); scn.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.52, 0.56, 1)
bpy.ops.mesh.primitive_plane_add(size=60)
scn.render.engine = 'CYCLES'; scn.cycles.samples = 5; scn.cycles.use_denoising = True
scn.render.resolution_x = 220; scn.render.resolution_y = 300
view = argv[argv.index('--view') + 1] if '--view' in argv else 'q'
for act in baked:
    rig.animation_data.action = act
    f0, f1 = act.frame_range
    for k in range(nshots):
        fr = f0 + (f1 - f0) * k / (nshots - 1)
        scn.frame_set(int(fr))
        bpy.context.view_layer.update()
        pb = rig.pose.bones['hand_r']
        G = rig.matrix_world @ pb.matrix @ skel.rest['hand_r'].inverted() @ (skel.rest['hand_r'] @ skel.grip['r'])
        kat.matrix_world = G
        root = rig.matrix_world @ rig.pose.bones['pelvis'].head
        if view == 'side':
            cam.location = (root.x + 4.5, root.y, 1.0); cam.rotation_euler = (math.radians(88), 0, math.radians(90))
        else:
            cam.location = (root.x + 2.4, root.y - 3.6, 1.2); cam.rotation_euler = (math.radians(86), 0, math.radians(33))
        scn.render.filepath = f'{out}/{act.name}_{k}.png'
        bpy.ops.render.render(write_still=True)
print('PREVIEW DONE')
