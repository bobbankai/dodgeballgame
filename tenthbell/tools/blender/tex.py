"""Texture helpers: seamless 3D noise, baking surface data into UV space, PBR materials for glTF export."""
import json
import os
import bpy
import numpy as np
from PIL import Image

TMP = os.environ.get('TB_TMP', '/opt/work/tex')


# ---- noise evaluated on 3D positions (so UV seams never show)
def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.uint32) * np.uint32(374761393) + iy.astype(np.uint32) * np.uint32(668265263)
         + iz.astype(np.uint32) * np.uint32(2246822519) + np.uint32(seed * 3266489917 & 0xFFFFFFFF))
    h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
    h ^= h >> np.uint32(16)
    return (h & np.uint32(0xFFFFFF)).astype(np.float32) / 16777216.0


def vnoise(p, freq, seed=0):
    """value noise in [0,1]; p (...,3) in metres, freq in cycles per metre (a vector stretches it)"""
    q = p * np.asarray(freq, np.float32) + 1000.0
    i = np.floor(q).astype(np.int64)
    f = (q - i).astype(np.float32)
    f = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out = out + w * _hash(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
    return out


def fbm(p, freq, octaves=4, seed=0, gain=0.5):
    out, amp, tot = 0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * vnoise(p, np.asarray(freq, np.float32) * (2 ** o), seed + o * 17)
        tot += amp
        amp *= gain
    return out / tot


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def blob(p, c, r):
    """soft sphere of radius r round point c: 1 at the centre, 0 outside"""
    d = np.linalg.norm(p - np.asarray(c, np.float32), axis=-1)
    return 1 - smooth(0, r, d)


def srgb(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def hexc(h):
    h = h.lstrip('#')
    return srgb([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def blur(a, r):
    """cheap gaussian-ish blur (three box passes) on a 2D or 3D array"""
    if r < 1:
        return a
    r = int(r)
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.concatenate([np.repeat(np.take(a, [0], ax), r + 1, ax), a, np.repeat(np.take(a, [-1], ax), r, ax)], ax), ax, dtype=np.float64)
            n = a.shape[ax]
            a = ((np.take(c, range(2 * r + 1, 2 * r + 1 + n), ax) - np.take(c, range(0, n), ax)) / (2 * r + 1)).astype(np.float32)
    return a


def height_to_normal(h, strength):
    """tangent space normal map (OpenGL, +Y up) from a height field given in UV space (row 0 = v 0)"""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def save(arr, name, linear=True):
    """arr in UV space (row 0 = v 0), floats 0..1. Returns the file path."""
    os.makedirs(TMP, exist_ok=True)
    a = arr if linear else to_srgb(arr)
    path = os.path.join(TMP, name + '.png')
    Image.fromarray((np.clip(a[::-1], 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)
    return path


def load(path, size=None, mode='RGB'):
    """image file -> float array in UV space"""
    im = Image.open(path).convert(mode)
    if size:
        im = im.resize(size, Image.LANCZOS)
    return np.asarray(im, np.float32)[::-1] / 255.0


# ---- baking surface data into UV space with Cycles
def bake(obj, sizes, kind, samples=1, margin=16):
    """Bake one quantity for every material slot of obj. sizes: one (w, h) per slot.
    kind: 'pos' (object space position), 'nor' (object space normal), 'ao', or 'attr:<color attribute>'.
    Returns a list of float arrays (h, w, 3) in UV space."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.bake.margin = margin
    sc.render.bake.use_clear = True
    sc.render.bake.target = 'IMAGE_TEXTURES'
    imgs = []
    for slot, (w, h) in zip(obj.material_slots, sizes):
        img = bpy.data.images.new(f'bake_{kind}_{slot.name}', w, h, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        imgs.append(img)
        mat = slot.material
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        if kind == 'pos' or kind.startswith('attr:'):
            em = nt.nodes.new('ShaderNodeEmission')
            if kind == 'pos':
                src = nt.nodes.new('ShaderNodeNewGeometry').outputs['Position']
            else:
                at = nt.nodes.new('ShaderNodeAttribute')
                at.attribute_name = kind[5:]
                src = at.outputs['Color']
            nt.links.new(src, em.inputs['Color'])
            nt.links.new(em.outputs[0], out.inputs['Surface'])
        else:
            nt.links.new(nt.nodes.new('ShaderNodeBsdfDiffuse').outputs[0], out.inputs['Surface'])
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        nt.nodes.active = t
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if kind == 'nor':
        bpy.ops.object.bake(type='NORMAL', normal_space='OBJECT')
    else:
        bpy.ops.object.bake(type='AO' if kind == 'ao' else 'EMIT')
    out = []
    for img in imgs:
        a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
        img.pixels.foreach_get(a)
        out.append(a.reshape(img.size[1], img.size[0], 4)[..., :3].copy())
        bpy.data.images.remove(img)
    if kind == 'nor':
        out = [a * 2 - 1 for a in out]
    return out


# ---- glTF-ready materials
def _gltf_output():
    ng = bpy.data.node_groups.get('glTF Material Output')
    if not ng:
        ng = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        ng.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        ng.nodes.new('NodeGroupInput')
    return ng


def image(path, color=True):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return img


def material(name, base=(0.8, 0.8, 0.8), normal=None, orm=None, rough=0.5, metal=0.0, emissive=None, emissive_strength=1.0,
             alpha=None, blend='OPAQUE', double=False, uv_scale=None, normal_strength=1.0, base_tint=None, tb=None):
    """Principled material the glTF exporter understands. base/normal/orm/emissive/alpha: file path or value.
    orm = occlusion (R), roughness (G), metallic (B). uv_scale tiles every texture.
    tb: what the game should build instead (kind 'k', texture set 't', tint 'c', tiles per metre 's' ...)."""
    m = bpy.data.materials.new(name)
    if tb:  # read by the game's material library (glTF extras)
        m['tb'] = json.dumps(tb)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    mapping = None
    if uv_scale:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mapping = nt.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (uv_scale[0], uv_scale[1], 1)
        nt.links.new(tc.outputs['UV'], mapping.inputs['Vector'])

    def tex(path, color):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image(path, color)
        if mapping:
            nt.links.new(mapping.outputs[0], t.inputs['Vector'])
        return t

    if isinstance(base, str):
        t = tex(base, True)
        if base_tint is not None:
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1
            nt.links.new(t.outputs['Color'], mix.inputs['A'])
            mix.inputs['B'].default_value = (*base_tint, 1)
            nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        else:
            nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha == 'base':
            a = t.outputs['Alpha']
            if blend == 'MASK':  # the exporter reads a Round node as alphaMode MASK, cutoff 0.5
                rnd = nt.nodes.new('ShaderNodeMath')
                rnd.operation = 'ROUND'
                nt.links.new(a, rnd.inputs[0])
                a = rnd.outputs[0]
            nt.links.new(a, bsdf.inputs['Alpha'])
    else:
        bsdf.inputs['Base Color'].default_value = (*base, 1)
    if isinstance(alpha, float):
        bsdf.inputs['Alpha'].default_value = alpha
    if normal:
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(tex(normal, False).outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs[0], bsdf.inputs['Normal'])
    if orm:
        t = tex(orm, False)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs[0])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        g = nt.nodes.new('ShaderNodeGroup')
        g.node_tree = _gltf_output()
        nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    else:
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
    if emissive is not None:
        if isinstance(emissive, str):
            nt.links.new(tex(emissive, True).outputs['Color'], bsdf.inputs['Emission Color'])
        else:
            bsdf.inputs['Emission Color'].default_value = (*emissive, 1)
        bsdf.inputs['Emission Strength'].default_value = emissive_strength
    m.blend_method = 'BLEND' if blend == 'BLEND' else ('CLIP' if blend == 'MASK' else 'OPAQUE')
    if hasattr(m, 'surface_render_method'):
        m.surface_render_method = 'BLENDED' if blend == 'BLEND' else 'DITHERED'
    m.alpha_threshold = 0.5
    m.use_backface_culling = not double
    return m
