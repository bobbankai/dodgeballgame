"""
Review renders. Every major model is rendered front / side / back / three-quarter / face close-up under the same studio lighting as
reference B (soft key, fill, rim, dark seamless backdrop), so it can be judged side by side with the reference.
"""
import math
import os

import bpy
from mathutils import Vector


def _area(name, loc, look, energy, size, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, 'AREA')
    l.energy = energy
    l.size = size
    l.color = color
    ob = bpy.data.objects.new(name, l)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob


def setup(backdrop=(0.055, 0.055, 0.06), samples=96, exposure=0.0):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = exposure
    w = bpy.data.worlds.new('studio')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (*backdrop, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    # seamless backdrop (cyclorama)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 4, 0))
    floor = bpy.context.object
    floor.name = 'cyc'
    bd = bpy.data.materials.new('cyc')
    bd.use_nodes = True
    bd.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.08, 0.085, 1)
    bd.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    floor.data.materials.append(bd)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 6, 8), rotation=(math.radians(90), 0, 0))
    wall = bpy.context.object
    wall.data.materials.append(bd)
    # three-point lighting (character faces -Y)
    _area('key', (-1.6, -2.6, 2.4), (0, 0, 1.55), 120, 1.8, (1.0, 0.95, 0.9))
    _area('fill', (2.4, -2.2, 1.6), (0, 0, 1.4), 26, 3.0, (0.88, 0.93, 1.0))
    _area('rim', (1.2, 2.4, 2.6), (0, 0, 1.6), 140, 1.0, (0.92, 0.96, 1.0))
    _area('hairlight', (-0.6, 1.6, 3.2), (0, 0, 1.7), 90, 0.8)


def camera(target, dist, yaw, pitch=0.0, lens=85, name='reviewcam'):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    t = Vector(target)
    y, p = math.radians(yaw), math.radians(pitch)
    cam.location = t + Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(path, size=(900, 1200)):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)


def review_set(outdir, name, height=1.8, face_z=None, samples=None):
    """front, side, back, three-quarter (full body) + face close-up + face three-quarter."""
    if samples:
        bpy.context.scene.cycles.samples = samples
    fz = face_z or height * 0.93
    shots = [
        ('front', (0, 0, height * 0.5), height * 1.75, 0, 2, 50),
        ('side', (0, 0, height * 0.5), height * 1.75, 90, 2, 50),
        ('back', (0, 0, height * 0.5), height * 1.75, 180, 2, 50),
        ('threequarter', (0, 0, height * 0.52), height * 1.6, -32, 6, 50),
        ('face', (0, -0.02, fz), 0.62, -8, 2, 85),
        ('face34', (0, -0.02, fz), 0.70, -38, 4, 85),
    ]
    out = []
    for nm, tgt, dist, yaw, pitch, lens in shots:
        camera(tgt, dist, yaw, pitch, lens)
        size = (1000, 1000) if nm.startswith('face') else (800, 1200)
        p = os.path.join(outdir, f'{name}_{nm}.png')
        render(p, size)
        out.append(p)
    return out
