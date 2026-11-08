"""High-to-low baking and texture compositing (a scripted Substance-style workflow).

1. `unwrap_pack(objs)` gives low-poly pieces one shared UV atlas (smart projection, packed together).
2. `bake_set(pairs, res)` ray-bakes from each high-res sculpt onto its low-poly piece:
   tangent-space normal, ambient occlusion, material ID (vertex colour 'mat') and curvature ('curv').
3. `composite(...)` (numpy) builds albedo / normal / ORM / emissive textures from those maps plus
   tiled CC0 detail textures: edge wear from convex curvature, grime from AO and cavities, height-based
   dirt and ash, scratches, per-material roughness and metalness.
"""
import math
import os

import bpy
import numpy as np
from PIL import Image

from common import select_only, RAW
from armor import MATERIALS, mat_color

TEX = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'tex'))


# ------------------------------------------------------------------ geometry attributes

def vertex_curvature(obj):
    """Signed mean curvature proxy per vertex: >0 convex (edges), <0 concave (cavities)."""
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    nr = np.empty(n * 3)
    me.vertices.foreach_get('normal', nr)
    nr = nr.reshape(-1, 3)
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', e)
    e = e.reshape(-1, 2)
    acc = np.zeros((n, 3))
    cnt = np.zeros(n)
    np.add.at(acc, e[:, 0], co[e[:, 1]])
    np.add.at(acc, e[:, 1], co[e[:, 0]])
    np.add.at(cnt, e[:, 0], 1)
    np.add.at(cnt, e[:, 1], 1)
    lap = acc / np.maximum(cnt, 1)[:, None] - co
    elen = np.linalg.norm(co[e[:, 0]] - co[e[:, 1]], axis=1)
    avg = np.zeros(n)
    np.add.at(avg, e[:, 0], elen)
    np.add.at(avg, e[:, 1], elen)
    avg /= np.maximum(cnt, 1)
    k = -(lap * nr).sum(1) / np.maximum(avg, 1e-6) ** 1.0
    # smooth a little so single-voxel noise does not read as wear
    for _ in range(2):
        acc1 = np.zeros(n)
        np.add.at(acc1, e[:, 0], k[e[:, 1]])
        np.add.at(acc1, e[:, 1], k[e[:, 0]])
        k = 0.5 * k + 0.5 * acc1 / np.maximum(cnt, 1)
    return k


def add_curvature_attr(obj, scale=6.0):
    k = vertex_curvature(obj)
    v = np.clip(0.5 + k * scale, 0, 1)
    col = np.column_stack([v, v, v, np.ones_like(v)]).astype(np.float32)
    me = obj.data
    attr = me.color_attributes.get('curv') or me.color_attributes.new('curv', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', col.ravel())


# ------------------------------------------------------------------ UVs

def unwrap_pack(objs, margin=0.004, angle=66.0):
    for o in objs:
        select_only(o)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin * 0.5, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    select_only(*objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    try:
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def uv_texel_density(objs, res):
    """Atlas texels per metre (uniform after packing)."""
    surf = 0.0
    uva = 0.0
    for o in objs:
        me = o.data
        uv = me.uv_layers.active.data
        for p in me.polygons:
            surf += p.area
            pts = [uv[i].uv for i in p.loop_indices]
            a = 0.0
            for k in range(1, len(pts) - 1):
                a += abs((pts[k].x - pts[0].x) * (pts[k + 1].y - pts[0].y) - (pts[k + 1].x - pts[0].x) * (pts[k].y - pts[0].y)) * 0.5
            uva += a
    return math.sqrt(uva / max(surf, 1e-9)) * res


# ------------------------------------------------------------------ baking

def _image(name, res, alpha=False, non_color=True, float_buffer=False):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, res, res, alpha=alpha, float_buffer=float_buffer)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    img.generated_color = (0.5, 0.5, 1.0, 1.0) if 'normal' in name else (0, 0, 0, 1)
    return img


def _target_material(obj, img):
    """Give the low-poly object a material whose active node is the bake target image."""
    mat = bpy.data.materials.get('_bake_target') or bpy.data.materials.new('_bake_target')
    mat.use_nodes = True
    nt = mat.node_tree
    node = nt.nodes.get('_bake_img') or nt.nodes.new('ShaderNodeTexImage')
    node.name = '_bake_img'
    node.image = img
    nt.nodes.active = node
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def _emit_material(attr):
    name = f'_emit_{attr}'
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = attr
    nt.links.new(vc.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat


def bake_set(pairs, res, out_prefix, kinds=('normal', 'ao', 'mat', 'curv'), extrusion=0.012, ray=0.04, ao_samples=48):
    """pairs: [(high, low)] sharing one UV atlas. Writes <out_prefix>_<kind>.png, returns paths."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.render.bake.margin = 6
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = extrusion
    sc.render.bake.max_ray_distance = ray
    paths = {}
    for o in [h for h, _ in pairs]:
        if 'curv' in kinds and 'curv' not in o.data.color_attributes:
            add_curvature_attr(o)
    for kind in kinds:
        img = _image(f'bake_{kind}', res, non_color=True, float_buffer=(kind == 'normal'))
        for hi, lo in pairs:
            _target_material(lo, img)
            if kind in ('mat', 'curv', 'pos', 'mA', 'mB', 'mC', 'mD'):
                if hi is lo:
                    # baking a mesh onto itself: one material emits the attribute and holds the target
                    em = _emit_material(kind).copy()
                    node = em.node_tree.nodes.new('ShaderNodeTexImage')
                    node.image = img
                    em.node_tree.nodes.active = node
                    lo.data.materials.clear()
                    lo.data.materials.append(em)
                else:
                    hi.data.materials.clear()
                    hi.data.materials.append(_emit_material(kind))
            select_only(lo, hi)
            bpy.context.view_layer.objects.active = lo
            hi.select_set(True)
            lo.select_set(True)
            sc.render.bake.use_selected_to_active = hi is not lo
            if kind == 'normal':
                sc.cycles.samples = 1
                bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_selected_to_active=True,
                                    cage_extrusion=extrusion, max_ray_distance=ray, margin=6, use_clear=False)
            elif kind == 'ao':
                sc.cycles.samples = ao_samples
                bpy.ops.object.bake(type='AO', use_selected_to_active=hi is not lo, cage_extrusion=extrusion,
                                    max_ray_distance=ray, margin=6, use_clear=False)
            else:
                sc.cycles.samples = 1
                bpy.ops.object.bake(type='EMIT', use_selected_to_active=hi is not lo, cage_extrusion=extrusion,
                                    max_ray_distance=ray, margin=6, use_clear=False)
        path = f'{out_prefix}_{kind}.png'
        img.filepath_raw = path
        img.file_format = 'PNG'
        if kind == 'normal':
            img.colorspace_settings.name = 'Non-Color'
        img.save()
        paths[kind] = path
        print('baked', kind, path)
    return paths


def bake_uv_coverage(low_objs, res):
    """Mask of atlas texels covered by any UV island (rasterised in numpy)."""
    from PIL import ImageDraw
    im = Image.new('L', (res, res), 0)
    dr = ImageDraw.Draw(im)
    for o in low_objs:
        uv = o.data.uv_layers.active.data
        for p in o.data.polygons:
            pts = [(uv[i].uv.x * res, (1 - uv[i].uv.y) * res) for i in p.loop_indices]
            dr.polygon(pts, fill=255)
    return np.array(im) > 0


# ------------------------------------------------------------------ compositing

def load_rgb(path, res=None):
    im = Image.open(path).convert('RGB')
    if res and im.size != (res, res):
        im = im.resize((res, res), Image.Resampling.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def tile_texture(name, res, texels_per_m, size_m, rot=0.0):
    """Detail texture (public/assets/tex/<name>.webp) tiled over the atlas at a real-world size."""
    src = load_rgb(os.path.join(TEX, name + '.webp'))
    h, w, _ = src.shape
    reps = texels_per_m * size_m
    yy, xx = np.mgrid[0:res, 0:res].astype(np.float32)
    if rot:
        c, s = math.cos(rot), math.sin(rot)
        xx, yy = xx * c - yy * s, xx * s + yy * c
    u = (xx / reps * w) % w
    v = (yy / reps * h) % h
    x0 = np.floor(u).astype(int) % w
    y0 = np.floor(v).astype(int) % h
    fx = (u - np.floor(u))[..., None]
    fy = (v - np.floor(v))[..., None]
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    return (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x1] * fx * (1 - fy) + src[y1, x0] * (1 - fx) * fy + src[y1, x1] * fx * fy)


def speckle(res, density, seed=0, blur=0.7):
    """Fine per-pixel dots (stubble, pores, dust): random points softened by a tiny blur."""
    from PIL import ImageFilter
    rng = np.random.default_rng(seed)
    a = (rng.random((res, res)) < density).astype(np.float32)
    im = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    v = np.asarray(im, np.float32) / 255
    return np.clip(v / max(v.max(), 1e-6), 0, 1)


def noise2(res, scale, seed=0, octaves=4):
    """Tileable-enough value noise image in [0, 1]."""
    rng = np.random.default_rng(seed)
    out = np.zeros((res, res), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = max(2, int(scale * (2 ** o)))
        g = rng.random((n + 1, n + 1)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((res, res), Image.Resampling.BICUBIC)
        out += amp * np.asarray(im, np.float32) / 255.0
        tot += amp
        amp *= 0.5
    return out / tot


def decode_ids(mat_rgb, ids):
    """Per-texel material index from the baked ID colours (nearest palette colour)."""
    pal = np.array([mat_color(MATERIALS[i][0]) for i in ids], np.float32)
    flat = mat_rgb.reshape(-1, 3)
    d = ((flat[:, None, :] - pal[None, :, :]) ** 2).sum(-1)
    return np.array(ids)[np.argmin(d, axis=1)].reshape(mat_rgb.shape[:2])


def blend_normals(base, detail, strength=1.0):
    """Reoriented normal mapping (both tangent-space, [0, 1] encoded)."""
    t = base * np.array([2, 2, 2], np.float32) + np.array([-1, -1, 0], np.float32)
    u = detail * np.array([-2, -2, 2], np.float32) + np.array([1, 1, -1], np.float32)
    u[..., :2] *= strength
    r = t * (t * u).sum(-1, keepdims=True) / np.maximum(t[..., 2:3], 1e-4) - u
    r /= np.maximum(np.linalg.norm(r, axis=-1, keepdims=True), 1e-6)
    return r * 0.5 + 0.5


def save_rgb(arr, path, quality=92):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if path.endswith('.webp'):
        im.save(path, 'WEBP', quality=quality, method=6)
    else:
        im.save(path)
    return path


def dilate(arr, mask, iters=8):
    """Push colours outward from covered texels so mip-maps do not bleed black into seams."""
    out = arr.copy()
    m = mask.copy()
    for _ in range(iters):
        acc = np.zeros_like(out)
        cnt = np.zeros(m.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(np.roll(out, dy, 0), dx, 1)
            sm = np.roll(np.roll(m, dy, 0), dx, 1)
            acc += sh * sm[..., None]
            cnt += sm
        grow = (~m) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        m = m | grow
    return out
