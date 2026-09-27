"""Shared helpers for the headless Blender asset scripts (run with `blender -b -P <script>`)."""
import math
import os
import sys

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX_OUT = os.path.join(ROOT, 'src', 'assets', 'textures')


def script_args():
    """Arguments after `--` on the blender command line."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    cy = scene.cycles
    cy.device = 'CPU'
    cy.samples = 64
    cy.use_denoising = False
    scene.render.bake.margin = 8
    return scene


def new_image(name, size, alpha=True, float_buffer=False):
    img = bpy.data.images.new(name, width=size, height=size, alpha=alpha, float_buffer=float_buffer)
    img.colorspace_settings.name = 'Non-Color'
    return img


def image_pixels(img):
    """Pixels as an (h, w, 4) float array."""
    arr = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    return arr.reshape(img.size[1], img.size[0], 4)


def save_rgba(path, rgba):
    """Write an (h, w, 4) float array in [0,1] as an 8-bit PNG (non-colour data)."""
    h, w, _ = rgba.shape
    img = bpy.data.images.new(os.path.basename(path), width=w, height=h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save()
    bpy.data.images.remove(img)
    print('wrote', os.path.relpath(path, ROOT))


# ------------------------------------------------------------------ periodic height fields
def periodic_noise(size, freq, seed, octaves=4, gain=0.5):
    """Tileable fractal noise in [-1, 1] built from random Fourier phases (exactly periodic)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((size, size), dtype=np.float64)
    fy = np.fft.fftfreq(size)[:, None] * size
    fx = np.fft.fftfreq(size)[None, :] * size
    r = np.sqrt(fx * fx + fy * fy)
    amp = 1.0
    for o in range(octaves):
        f0 = freq * (2 ** o)
        band = np.exp(-((r - f0) ** 2) / (2 * (0.35 * f0 + 0.5) ** 2))
        phase = np.exp(2j * np.pi * rng.random((size, size)))
        out += amp * np.real(np.fft.ifft2(band * phase))
        amp *= gain
    out /= np.abs(out).max() + 1e-9
    return out


def periodic_voronoi(size, count, seed, jitter=1.0):
    """Tileable Voronoi: returns (F1 distance, F2 distance, cell id), distances in tile units."""
    rng = np.random.default_rng(seed)
    pts = rng.random((count, 2)) * jitter + (1 - jitter) * 0.5
    ys, xs = np.mgrid[0:size, 0:size] / size
    f1 = np.full((size, size), 9.0)
    f2 = np.full((size, size), 9.0)
    cid = np.zeros((size, size), dtype=np.int32)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(xs - px)
        dy = np.abs(ys - py)
        dx = np.minimum(dx, 1 - dx)
        dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        cid = np.where(closer, i, cid)
        f1 = np.where(closer, d, f1)
    return f1, f2, cid


def height_to_normal(height, strength):
    """Tangent-space normal map (RGB in [0,1]) from a periodic height field; `strength` scales slopes."""
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(height)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5], axis=-1)


def cavity_from_height(height, radius_px=6):
    """Cheap occlusion: how far a texel sits below its blurred neighbourhood."""
    k = radius_px
    blur = height.copy()
    for _ in range(3):
        acc = np.zeros_like(blur)
        for dx in range(-k, k + 1, max(1, k // 3)):
            for dy in range(-k, k + 1, max(1, k // 3)):
                acc += np.roll(np.roll(blur, dy, axis=0), dx, axis=1)
        blur = acc / ((2 * k // max(1, k // 3) + 1) ** 2)
    d = height - blur
    d = d / (np.abs(d).max() + 1e-9)
    return np.clip(0.75 + d * 0.5, 0, 1)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ geometry → texture bakes
def bake_tile(high_objects, size, name, samples=32, ao_distance=0.08):
    """
    Bake a tileable [0,1]² tile from high-poly geometry onto a flat plane: tangent-space normals
    (RGB) plus ambient occlusion (A). The geometry must already repeat across the tile edges.
    """
    scene = bpy.context.scene
    scene.cycles.samples = samples
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0.5, 0.5, 0))
    low = bpy.context.active_object
    low.name = f'{name}_low'
    mat = bpy.data.materials.new(f'{name}_bake')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    tex_node = nodes.new('ShaderNodeTexImage')
    low.data.materials.append(mat)
    for o in high_objects:
        if not o.data.materials:
            m = bpy.data.materials.new('yarn')
            m.use_nodes = True
            o.data.materials.append(m)

    def run(kind, img):
        tex_node.image = img
        nodes.active = tex_node
        bpy.ops.object.select_all(action='DESELECT')
        for o in high_objects:
            o.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        bake = scene.render.bake
        bake.use_selected_to_active = True
        bake.cage_extrusion = 0.25
        bake.max_ray_distance = 0.5
        bake.margin = 0
        if kind == 'NORMAL':
            bake.normal_space = 'TANGENT'
            bpy.ops.object.bake(type='NORMAL')
        else:
            scene.world.light_settings.distance = ao_distance
            bpy.ops.object.bake(type='AO')

    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    n_img = new_image(f'{name}_n', size)
    ao_img = new_image(f'{name}_ao', size)
    run('NORMAL', n_img)
    run('AO', ao_img)
    rgba = image_pixels(n_img).copy()
    rgba[..., 3] = image_pixels(ao_img)[..., 0]
    return rgba


def wrap_copies(fn):
    """Call fn(dx, dy) for the tile and its 8 neighbours so geometry tiles seamlessly."""
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            fn(dx, dy)


def capsule_mesh(name, segments):
    """Join a list of (p0, p1, radius) yarn segments into one smooth tube mesh via curves."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 1.0
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    for p0, p1, r in segments:
        sp = curve.splines.new('POLY')
        sp.points.add(1)
        sp.points[0].co = (*p0, 1)
        sp.points[1].co = (*p1, 1)
        sp.points[0].radius = r
        sp.points[1].radius = r
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bezier_yarn(name, strands, radius, resolution=12):
    """Smooth yarn tubes through control points: strands = list of point lists (x, y, z)."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.resolution_u = resolution
    curve.use_fill_caps = True
    for pts in strands:
        sp = curve.splines.new('BEZIER')
        sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def deg(a):
    return math.radians(a)
