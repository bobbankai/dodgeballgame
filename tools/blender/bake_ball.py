"""
The dodgeball: a high-poly foam-rubber sphere (pebbled grain, grooved panel seams) baked onto a
sphere with exactly three.js SphereGeometry UVs.

Outputs (equirectangular, 1024x512) to src/assets/textures/:
  ball_albedo.png  sRGB colour (red panels, cream stripes, faint wear)
  ball_normal.png  object-space normal (+X +Y +Z, three.js axes: Y up)
  ball_orm.png     R occlusion, G roughness, B metalness (glTF packing)

Run: blender -b -P tools/blender/bake_ball.py
"""
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

W, H = 1024, 512
# panel layout (unit sphere, three.js axes): an equator band and one meridian band (plane x = 0)
BAND = 0.094
SEAM_W = 0.0065
SEAM_DEPTH = 0.009
PEBBLE_AMP = 0.0045


def sphere_dirs(u, v):
    """three.js SphereGeometry parametrisation (u around, v from the top)."""
    phi = u * 2 * math.pi
    theta = v * math.pi
    x = -np.cos(phi) * np.sin(theta)
    y = np.cos(theta)
    z = np.sin(phi) * np.sin(theta)
    return x, y, z


def band_distance(x, y):
    """Signed distance (in unit-sphere units) to the nearest stripe edge; < 0 inside a stripe."""
    return np.minimum(np.abs(y) - BAND, np.abs(x) - BAND)


def fib_points(n, seed):
    rng = np.random.default_rng(seed)
    i = np.arange(n) + 0.5
    y = 1 - 2 * i / n
    r = np.sqrt(1 - y * y)
    th = math.pi * (3 - math.sqrt(5)) * i
    p = np.stack([np.cos(th) * r, y, np.sin(th) * r], -1)
    p += rng.normal(0, 0.35 / math.sqrt(n), p.shape)
    return p / np.linalg.norm(p, axis=1, keepdims=True)


def pebble_height(dirs, pts):
    """Rounded pebble domes from spherical Voronoi (F1/F2 of chord distance, via a KD-tree)."""
    from mathutils.kdtree import KDTree

    kd = KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    out = np.empty(len(dirs))
    for i, d in enumerate(dirs):
        (_, _, f1), (_, _, f2) = kd.find_n(d, 2)
        t = 2 * f1 / (f1 + f2)
        out[i] = math.sqrt(max(0.0, 1 - t ** 2.4))
    return out


def high_poly(pts):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=7, radius=1.0)
    ob = bpy.context.active_object
    ob.name = 'ball_high'
    me = ob.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    dirs = co / np.linalg.norm(co, axis=1, keepdims=True)
    h = pebble_height(dirs, pts) * PEBBLE_AMP
    e = band_distance(dirs[:, 0], dirs[:, 1])
    h -= SEAM_DEPTH * np.exp(-(e / SEAM_W) ** 2)          # grooves along the stripe edges
    h += np.where(e < 0, 0.0012, 0.0)                     # printed stripes sit a hair proud
    co = dirs * (1 + h)[:, None]
    me.vertices.foreach_set('co', co.ravel())
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    return ob


def low_poly():
    """Mesh identical to THREE.SphereGeometry(1, 96, 48) including its UVs."""
    ws, hs = 96, 48
    verts, uvs, grid = [], [], []
    for iy in range(hs + 1):
        row = []
        v = iy / hs
        for ix in range(ws + 1):
            u = ix / ws
            x, y, z = sphere_dirs(np.array(u), np.array(v))
            verts.append((float(x), float(y), float(z)))
            uvs.append((u, 1 - v))
            row.append(len(verts) - 1)
        grid.append(row)
    faces = []
    for iy in range(hs):
        for ix in range(ws):
            a, b = grid[iy][ix + 1], grid[iy][ix]
            c, d = grid[iy + 1][ix], grid[iy + 1][ix + 1]
            if iy != 0:
                faces.append((a, b, d))
            if iy != hs - 1:
                faces.append((b, c, d))
    me = bpy.data.meshes.new('ball_low')
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = uvs[me.loops[li].vertex_index]
        poly.use_smooth = True
    ob = bpy.data.objects.new('ball_low', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def bake(low, high, kind, img, **kw):
    mat = low.data.materials[0]
    node = mat.node_tree.nodes['bake_target']
    node.image = img
    mat.node_tree.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    b = bpy.context.scene.render.bake
    b.use_selected_to_active = True
    b.cage_extrusion = 0.03
    b.max_ray_distance = 0.06
    b.margin = 4
    for k, v in kw.items():
        setattr(b, k, v)
    bpy.ops.object.bake(type=kind)


def albedo_and_rough(ao):
    """Paint the albedo and roughness analytically per texel (same layout as the geometry)."""
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    uu, vv = np.meshgrid(u, 1 - v)  # image rows bottom-up
    x, y, z = sphere_dirs(uu, vv)
    e = band_distance(x, y)
    stripe = 1 - lib.smoothstep(-0.003, 0.003, e)
    red = np.array([0.66, 0.05, 0.022])     # linear (≈ #d6412a)
    cream = np.array([0.88, 0.77, 0.6])     # linear (≈ #f1e4cc)
    col = red[None, None, :] * (1 - stripe[..., None]) + cream[None, None, :] * stripe[..., None]
    # faint wear: scuffs and a little grime settling in the grain
    rng = np.random.default_rng(4)
    k = rng.normal(0, 1, (24, 3))
    ph = rng.random(24) * 6.28
    wear = sum(np.sin(x * k[i, 0] * 3 + y * k[i, 1] * 3 + z * k[i, 2] * 3 + ph[i]) for i in range(24)) / 24
    col *= (1 + wear[..., None] * 0.06)
    col *= (0.88 + 0.12 * ao[..., None])
    seam = np.exp(-(e / (SEAM_W * 1.3)) ** 2)
    col *= (1 - 0.35 * seam[..., None])
    rough = 0.58 - 0.1 * stripe + 0.15 * seam + wear * 0.03
    return np.clip(col, 0, 1), np.clip(rough, 0, 1)


def main():
    scene = lib.reset_scene()
    scene.world = bpy.data.worlds.new('World')
    pts = fib_points(2600, seed=12)
    high = high_poly(pts)
    low = low_poly()
    mat = bpy.data.materials.new('ball_bake')
    mat.use_nodes = True
    n = mat.node_tree.nodes.new('ShaderNodeTexImage')
    n.name = 'bake_target'
    low.data.materials.append(mat)
    high.data.materials.append(bpy.data.materials.new('high'))

    scene.cycles.samples = 16
    n_img = bpy.data.images.new('ball_n', W, H, alpha=False, float_buffer=True)
    n_img.colorspace_settings.name = 'Non-Color'
    bake(low, high, 'NORMAL', n_img, normal_space='OBJECT', normal_r='POS_X', normal_g='POS_Y', normal_b='POS_Z')
    scene.cycles.samples = 64
    scene.world.light_settings.distance = 0.03
    ao_img = bpy.data.images.new('ball_ao', W, H, alpha=False, float_buffer=True)
    ao_img.colorspace_settings.name = 'Non-Color'
    bake(low, high, 'AO', ao_img)

    npx = lib.image_pixels(n_img).copy()
    # the pole rows are degenerate in the UV sphere: write the analytic pole normals
    npx[-2:, :, :3] = (0.5, 1.0, 0.5)
    npx[:2, :, :3] = (0.5, 0.0, 0.5)
    ao = lib.image_pixels(ao_img)[..., 0]
    ao = np.clip(0.35 + 0.65 * ao, 0, 1)
    col, rough = albedo_and_rough(ao)

    out = lib.TEX_OUT
    rgba = np.dstack([npx[..., :3], np.ones((H, W))])
    lib.save_rgba(os.path.join(out, 'ball_normal.png'), rgba)
    lib.save_rgba(os.path.join(out, 'ball_orm.png'), np.dstack([ao, rough, np.zeros((H, W)), np.ones((H, W))]))
    # albedo is colour data: encode linear → sRGB
    srgb = np.where(col <= 0.0031308, col * 12.92, 1.055 * np.power(col, 1 / 2.4) - 0.055)
    lib.save_rgba(os.path.join(out, 'ball_albedo.png'), np.dstack([srgb, np.ones((H, W))]))


main()
