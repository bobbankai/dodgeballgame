"""Preview materials for Cycles renders of baked characters (texture sets on disk)."""
import os

import bpy


def setup_preview_material(obj, name, tex_prefix, alpha=False, emissive=False, metal_rough=True):
    """Cycles material from the exported textures (for QA renders only)."""
    m = bpy.data.materials.new(name + '_pv')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']

    def img(path, non_color):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(path)
        n.image.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
        return n
    c = img(tex_prefix + '_c.webp', False)
    nt.links.new(c.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        nt.links.new(c.outputs['Alpha'], bsdf.inputs['Alpha'])
    if os.path.exists(tex_prefix + '_n.webp'):
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        n = img(tex_prefix + '_n.webp', True)
        nt.links.new(n.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    if metal_rough and os.path.exists(tex_prefix + '_orm.webp'):
        o = img(tex_prefix + '_orm.webp', True)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(o.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    if emissive and os.path.exists(tex_prefix + '_e.webp'):
        e = img(tex_prefix + '_e.webp', False)
        nt.links.new(e.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 4.0
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return m
