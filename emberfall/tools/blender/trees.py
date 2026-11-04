"""Procedural trees: blender -b -P trees.py -- [--preview out.png] [names...]

Each tree = bark tubes (cylindrical UVs, 1 tile per metre, shared tiling bark sets) + foliage cards
(alpha-tested sprites made from Poly Haven scans, see tools/foliage_tex.py). Vertex colour 'Col' holds
canopy ambient occlusion (darker inside) and a hue jitter; the game's foliage shader adds wind,
translucency and shadowing. Exported per variant to assets/env/trees/<kind>_<n>.glb.
"""
import bpy
import bmesh
import math
import os
import sys
import random
from mathutils import Vector, Matrix, Quaternion

sys.path.insert(0, os.path.dirname(__file__))
import outfit as O  # noqa
import charlib  # noqa

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'env', 'trees')
TEX = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'tex')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Builder:
    def __init__(self, name):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.color.new('Col')
        self.mat = self.bm.faces.layers.int.new('mat')
        self.name = name
        self.canopy = {}  # face index -> (crown centre, crown radii) for volumetric leaf normals

    def tube(self, pts, radii, sides=8, mat=0, v0=0.0, ao=1.0, flute=0.06, cap=True):
        """sweep a circle along points; returns accumulated v (metres)"""
        bm = self.bm
        rings = []
        v = v0
        vs = [v0]
        for i in range(1, len(pts)):
            v += (pts[i] - pts[i - 1]).length
            vs.append(v)
        # rotation-minimising frames (parallel transport) so the tube never twists
        d0 = (pts[1] - pts[0]).normalized()
        side = d0.cross(Vector((0, 0, 1)))
        if side.length < 0.2:
            side = d0.cross(Vector((1, 0, 0)))
        side.normalize()
        prev_d = d0
        for i, p in enumerate(pts):
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            q = prev_d.rotation_difference(d)
            side = (q @ side)
            side = (side - d * side.dot(d)).normalized()
            prev_d = d
            up2 = side.cross(d).normalized()
            ring = []
            for k in range(sides):
                a = 2 * math.pi * k / sides
                # bark is never a perfect circle: low-frequency lobes (root flare handled by radii)
                lobe = 1.0 + flute * math.sin(a * 3 + i * 0.7) * min(1.0, radii[i] * 4)
                ring.append(bm.verts.new(p + (side * math.cos(a) + up2 * math.sin(a)) * radii[i] * lobe))
            rings.append(ring)
        circ = 2 * math.pi * max(radii[0], 0.02)
        if cap and radii[-1] > 0.012:
            tip = bm.verts.new(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 0.6)
            for k in range(sides):
                f = bm.faces.new((rings[-1][k], rings[-1][(k + 1) % sides], tip))
                f[self.mat] = mat
                f.smooth = True
                for l, uv in zip(f.loops, ((k / sides * circ, vs[-1]), ((k + 1) / sides * circ, vs[-1]), ((k + 0.5) / sides * circ, vs[-1] + radii[-1]))):
                    l[self.uv].uv = uv
                    l[self.col] = (ao, ao, ao, 1)
        for i in range(len(rings) - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                f = bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
                f[self.mat] = mat
                f.smooth = True
                uvs = [(k / sides * circ, vs[i]), ((k + 1) / sides * circ, vs[i]), ((k + 1) / sides * circ, vs[i + 1]), (k / sides * circ, vs[i + 1])]
                for l, uv in zip(f.loops, uvs):
                    l[self.uv].uv = uv
                    shade = ao * (0.55 + 0.45 * min(1.0, (l.vert.co.z + 0.5) / 3.0))
                    l[self.col] = (shade, shade, shade, 1)
        return v

    def card(self, center, normal, up, size, mat=1, ao=1.0, tint=(1, 1, 1), aspect=1.0, crown=None):
        bm = self.bm
        n = normal.normalized()
        if crown is not None and n.dot(center - crown[0]) < 0:
            n = -n  # front face looks out of the crown, agreeing with the canopy normal
        u = up - n * up.dot(n)
        if u.length < 1e-4:
            u = n.orthogonal()
        u.normalize()
        r = n.cross(u).normalized()
        hw, hh = size * 0.5, size * 0.5 * aspect
        corners = [center - r * hw - u * hh, center + r * hw - u * hh, center + r * hw + u * hh, center - r * hw + u * hh]
        vs = [bm.verts.new(c) for c in corners]
        f = bm.faces.new(vs)
        f[self.mat] = mat
        f.smooth = True
        for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            l[self.uv].uv = uv
            l[self.col] = (ao * tint[0], ao * tint[1], ao * tint[2], 1)
        if crown is not None:
            f.index = len(bm.faces) - 1
            self.canopy[f] = crown
        return f

    def finish(self, mats):
        bm = self.bm
        bm.faces.index_update()
        canopy = {f.index: c for f, c in self.canopy.items()}
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for m in mats:
            me.materials.append(m)
        attr = me.attributes.get('mat')
        if attr:
            for p, a in zip(me.polygons, attr.data):
                p.material_index = a.value
            me.attributes.remove(attr)
        # canopy normals: leaf cards shade as one soft volume (normals point out of the crown ellipsoid,
        # blended with the card's own normal) instead of as hundreds of flat planes
        if canopy:
            normals = [Vector(n.vector) for n in me.corner_normals]
            for p in me.polygons:
                c = canopy.get(p.index)
                if c is None:
                    continue
                centre, radii, k = c
                for li in p.loop_indices:
                    v = me.vertices[me.loops[li].vertex_index].co
                    d = Vector(((v.x - centre.x) / radii.x, (v.y - centre.y) / radii.y, (v.z - centre.z) / radii.z))
                    d = Vector((d.x / radii.x, d.y / radii.y, d.z / radii.z))  # ellipsoid gradient
                    if d.length < 1e-4:
                        d = Vector((0, 0, 1))
                    d.normalize()
                    pn = Vector(p.normal)
                    normals[li] = (d * k + pn * (1 - k) * (1 if pn.dot(d) >= 0 else -1)).normalized()
            me.normals_split_custom_set(normals)
        return ob


def bark_mat(name, tex, tint=(1, 1, 1)):
    m = O.tiling_material(name, tex, tint, scale=1.0)
    return m


def leaf_mat(name, tex):
    m = bpy.data.materials.new(name)
    m.use_fake_user = True
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(os.path.join(TEX, f'foliage_{tex}_c.png'), check_existing=True)
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = bpy.data.images.load(os.path.join(TEX, f'foliage_{tex}_n.webp'), check_existing=True)
    n.image.colorspace_settings.name = 'Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.6
    # thin leaves transmit light: KHR_materials_transmission would be wrong for alpha cards; the game
    # adds diffuse translucency (foliage FX). Flag it here.
    m['foliage'] = 1
    m['leaf'] = tex
    m.blend_method = 'CLIP'
    m.alpha_threshold = 0.4
    return m


def bend_path(start, direction, length, steps, droop=0.0, curl=0.0, wobble=0.15, rnd=random):
    pts = [start.copy()]
    d = direction.normalized()
    p = start.copy()
    seg = length / steps
    for i in range(steps):
        d = (d + Vector((rnd.uniform(-wobble, wobble), rnd.uniform(-wobble, wobble), rnd.uniform(-wobble, wobble) * 0.5 - droop + curl * (i / steps)))).normalized()
        p = p + d * seg
        pts.append(p.copy())
    return pts


# ------------------------------------------------------------------ species

def flare(radii, k=1.7, n=3):
    """root flare: the bottom rings swell (the trunk starts below ground so it never floats)"""
    out = list(radii)
    for i in range(min(n, len(out))):
        out[i] *= 1 + (k - 1) * (1 - i / n) ** 2
    return out


def black_pine(seed):
    """Japanese black pine: leaning S-curved trunk, layered horizontal limbs ending in cloud pads"""
    rnd = random.Random(seed)
    B = Builder(f'pine_{seed}')
    H = rnd.uniform(5.5, 8.5)
    lean = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)).normalized() * rnd.uniform(0.15, 0.4)
    trunk = []
    for i in range(14):
        t = i / 13
        trunk.append(lean * (math.sin(t * math.pi * 1.2) * 1.4) + Vector((0, 0, -0.35 + (H + 0.35) * t)))
    radii = flare([0.3 * (1 - t / 15 * 0.85) for t in range(14)], 1.8)
    B.tube(trunk, radii, 12, flute=0.1)
    pads = []
    nb = rnd.randint(6, 9)
    for k in range(nb):
        t = 0.35 + 0.6 * k / nb + rnd.uniform(-0.04, 0.04)
        i = min(12, int(t * 13))
        base = trunk[i]
        az = k * 2.39996 + rnd.uniform(-0.4, 0.4)
        dirv = Vector((math.cos(az), math.sin(az), rnd.uniform(-0.05, 0.25)))
        L = rnd.uniform(1.4, 3.2) * (1.15 - t * 0.5)
        pts = bend_path(base, dirv, L, 6, droop=0.02, curl=0.08, wobble=0.18, rnd=rnd)
        r0 = radii[i] * 0.45
        B.tube(pts, [r0 * (1 - j / 7 * 0.75) for j in range(len(pts))], 7)
        pads.append((pts[-1], rnd.uniform(0.75, 1.2)))
        if L > 2:
            sub = bend_path(pts[3], Vector((math.cos(az + 1.2), math.sin(az + 1.2), 0.2)), 0.9, 3, wobble=0.2, rnd=rnd)
            B.tube(sub, [r0 * 0.4 * (1 - j / 4 * 0.6) for j in range(len(sub))], 5)
            pads.append((sub[-1] + Vector((0, 0, 0.1)), rnd.uniform(0.5, 0.75)))
    pads.append((trunk[-1] + Vector((0, 0, 0.2)), rnd.uniform(0.85, 1.15)))
    for c, r in pads:
        n = int(18 + r * 20)
        radii3 = Vector((r * 1.1, r * 1.1, r * 0.45))
        for j in range(n):
            a = rnd.uniform(0, 2 * math.pi)
            rr = r * math.sqrt(rnd.random())
            p = c + Vector((math.cos(a) * rr, math.sin(a) * rr, rnd.uniform(-0.12, 0.2) * r))
            tilt = rnd.uniform(0.0, 0.85) if j % 3 else rnd.uniform(1.0, 1.5)
            nrm = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
            inner = (p - c).length / max(r, 1e-3)
            ao = 0.5 + 0.5 * min(1, inner * 0.7 + max(0, p.z - c.z) / r)
            g = rnd.uniform(0.85, 1.1)
            B.card(p, nrm, Vector((math.cos(a + 1.3), math.sin(a + 1.3), 0.2)), rnd.uniform(0.7, 1.05) * max(0.6, r), 1, ao, (g, g * 1.02, g * 0.95),
                   crown=(c + Vector((0, 0, -0.1 * r)), radii3, 0.7))
    return B.finish([bark_mat('bark_pine', 'bark_pine'), leaf_mat('leaves_pine', 'pine')])


def cedar(seed):
    """Sugi (Japanese cedar): tall straight trunk, conical tiers of drooping sprays"""
    rnd = random.Random(seed)
    B = Builder(f'cedar_{seed}')
    H = rnd.uniform(13, 19)
    trunk = [Vector((rnd.uniform(-0.05, 0.05) * t, rnd.uniform(-0.05, 0.05) * t, -0.35 + (H + 0.35) * t / 11)) for t in range(12)]
    radii = flare([0.4 * (1 - t / 12 * 0.9) for t in range(12)], 1.9)
    B.tube(trunk, radii, 12, flute=0.14)
    tiers = 11
    centre = Vector((0, 0, H * 0.62))
    crown_r = Vector((3.6, 3.6, H * 0.45))
    for k in range(tiers):
        t = 0.28 + 0.7 * k / tiers
        z = H * t
        cone = (1 - t) * 3.6 + 0.6
        nbr = 6 if k < tiers - 3 else 4
        for j in range(nbr):
            az = j * 2 * math.pi / nbr + k * 0.7 + rnd.uniform(-0.3, 0.3)
            dirv = Vector((math.cos(az), math.sin(az), -0.2))
            pts = bend_path(Vector((0, 0, z)), dirv, cone, 4, droop=0.07, wobble=0.1, rnd=rnd)
            B.tube(pts, [0.07 * (1 - i / 5) + 0.012 for i in range(len(pts))], 5)
            for q in range(1, len(pts)):
                p = pts[q]
                for c in range(5):
                    a = az + rnd.uniform(-1.3, 1.3)
                    nrm = Vector((math.cos(a) * 0.4, math.sin(a) * 0.4, 1)).normalized() if c < 3 else Vector((math.cos(a), math.sin(a), 0.2))
                    ao = 0.45 + 0.55 * q / len(pts)
                    B.card(p + Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), rnd.uniform(-0.18, 0.1))), nrm,
                           Vector((math.cos(az), math.sin(az), 0)), rnd.uniform(0.95, 1.35) * (0.6 + (1 - t) * 0.6), 1, ao, (0.7, 0.8, 0.7),
                           crown=(centre, crown_r, 0.6))
    for c in range(12):
        a = rnd.uniform(0, 6.28)
        B.card(trunk[-1] + Vector((0, 0, -0.4 + c * 0.08)), Vector((math.cos(a), math.sin(a), 0.6)), Vector((0, 0, 1)), 1.1, 1, 0.9, (0.7, 0.8, 0.7),
               crown=(centre, crown_r, 0.6))
    return B.finish([bark_mat('bark_cedar', 'bark_cedar'), leaf_mat('leaves_cedar', 'pine')])


def maple(seed, tint=None):
    """Japanese maple: short trunk forking into spreading limbs under a wide dome of red leaves"""
    rnd = random.Random(seed)
    B = Builder(f'maple_{seed}')
    H = rnd.uniform(5, 7)
    trunk = [Vector((rnd.uniform(-0.04, 0.04) * i, rnd.uniform(-0.04, 0.04) * i, -0.3 + (H * 0.42 + 0.3) * i / 5)) for i in range(6)]
    B.tube(trunk, flare([0.28, 0.26, 0.24, 0.22, 0.2, 0.19], 1.6), 12, flute=0.12)
    crown = Vector((0, 0, H * 0.72))
    R = rnd.uniform(2.6, 3.4)
    nl = rnd.randint(4, 5)
    for k in range(nl):
        az = k * 2 * math.pi / nl + rnd.uniform(-0.4, 0.4)
        pts = bend_path(trunk[-1], Vector((math.cos(az) * 0.9, math.sin(az) * 0.9, 1.0)), H * 0.55, 6, curl=-0.07, wobble=0.18, rnd=rnd)
        B.tube(pts, [0.15 * (1 - i / 7) + 0.02 for i in range(len(pts))], 8)
        for q in (2, 3, 5):
            sub = bend_path(pts[q], Vector((math.cos(az + rnd.uniform(-1.4, 1.4)), math.sin(az + rnd.uniform(-1.4, 1.4)), 0.35)), 1.4, 4, wobble=0.25, rnd=rnd)
            B.tube(sub, [0.05 * (1 - i / 5) + 0.01 for i in range(len(sub))], 5)
    palette = tint or [(1.0, 0.35, 0.12), (0.95, 0.18, 0.08), (1.0, 0.55, 0.15), (0.85, 0.12, 0.1), (0.9, 0.7, 0.2)]
    radii3 = Vector((R, R, R * 0.6))
    for j in range(300):
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), abs(rnd.gauss(0, 0.7)))).normalized()
        rr = R * (0.55 + 0.45 * rnd.random() ** 0.5)
        p = crown + Vector((d.x * rr, d.y * rr, d.z * rr * 0.65))
        nrm = (p - crown).normalized()
        nrm = (nrm + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 0.4))).normalized()
        inner = (p - crown).length / R
        ao = 0.42 + 0.58 * min(1, inner) * (0.7 + 0.3 * max(0, d.z))
        c = palette[rnd.randrange(len(palette))]
        B.card(p, nrm, Vector((0, 0, 1)), rnd.uniform(0.75, 1.1), 1, ao, c, crown=(crown + Vector((0, 0, -0.3)), radii3, 0.75))
    return B.finish([bark_mat('bark_maple', 'bark_sakura_bark'), leaf_mat('leaves_maple', 'leaves')])


def bamboo(seed):
    """a bamboo clump: segmented culms (dark node rings) with drooping leaf sprays on the upper half"""
    rnd = random.Random(seed)
    B = Builder(f'bamboo_{seed}')
    ns = rnd.randint(6, 9)
    for s in range(ns):
        base = Vector((rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), -0.2))
        H = rnd.uniform(7, 11)
        lean = Vector((base.x, base.y, 0)).normalized() * rnd.uniform(0.04, 0.09) if base.length > 0.1 else Vector((0.05, 0, 0))
        N = 22
        pts = [base + lean * (H * t / N) ** 2 * 0.35 + Vector((0, 0, H * t / N)) for t in range(N + 1)]
        r = rnd.uniform(0.04, 0.065)
        radii = [r * (1.08 if i % 2 == 0 else 1.0) * (1 - i / (N * 2.4)) for i in range(N + 1)]
        B.tube(pts, radii, 8, mat=0, flute=0.0)
        top = pts[-1]
        for q in range(N // 2, N + 1, 2):
            p = pts[q]
            nleaf = 2 if q < N - 3 else 4
            for c in range(nleaf):
                a = rnd.uniform(0, 6.28)
                d = Vector((math.cos(a), math.sin(a), rnd.uniform(-0.7, 0.2))).normalized()
                sz = rnd.uniform(1.0, 1.4)
                ao = 0.55 + 0.45 * (q - N // 2) / (N // 2)
                # sprays hang outwards from the node: texture base (twig) at the culm
                B.card(p + d * sz * 0.45, Vector((math.cos(a + 1.57), math.sin(a + 1.57), 0.35)), d, sz, 1, ao,
                       (0.9, 1.0, 0.85), crown=(Vector((top.x, top.y, H * 0.75)), Vector((1.6, 1.6, H * 0.35)), 0.5))
    m = O.tiling_material('bamboo_culm', 'bark_moss', (0.5, 0.66, 0.3), scale=1.0, rough_fixed=0.42, normal_strength=0.3)
    return B.finish([m, leaf_mat('leaves_bamboo', 'bamboo')])


def dead_tree(seed):
    """lightning-struck dead tree: bare forked limbs (burnt villages, snowfields, the forge wastes)"""
    rnd = random.Random(seed)
    B = Builder(f'dead_{seed}')
    H = rnd.uniform(5, 8)
    trunk = bend_path(Vector((0, 0, -0.35)), Vector((0, 0, 1)), H, 10, wobble=0.12, rnd=rnd)
    B.tube(trunk, flare([0.34 * (1 - i / 12) + 0.03 for i in range(len(trunk))], 1.9), 11, flute=0.16)

    def grow(p, d, L, r, depth):
        pts = bend_path(p, d, L, 4, wobble=0.25, curl=0.05, rnd=rnd)
        B.tube(pts, [r * (1 - i / 5) + 0.005 for i in range(len(pts))], 5 if depth else 7)
        if depth > 0:
            for _ in range(2):
                q = pts[rnd.randint(2, 4)]
                nd = (d + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.2, 0.8)))).normalized()
                grow(q, nd, L * 0.6, r * 0.55, depth - 1)
    for k in range(rnd.randint(4, 6)):
        i = rnd.randint(4, 9)
        az = rnd.uniform(0, 6.28)
        grow(trunk[i], Vector((math.cos(az), math.sin(az), rnd.uniform(0.2, 0.9))), rnd.uniform(1.5, 3), 0.11, 2)
    return B.finish([bark_mat('bark_dead', 'bark_pine', (0.35, 0.33, 0.32))])


KINDS = {'pine': black_pine, 'cedar': cedar, 'maple': maple, 'bamboo': bamboo, 'dead': dead_tree}


def strip_leaf_textures():
    for m in bpy.data.materials:
        if 'leaf' not in m or not m.use_nodes:
            continue
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type in ('TEX_IMAGE', 'NORMAL_MAP'):
                nt.nodes.remove(n)


def export(ob, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    charlib.strip_tiling_textures()
    strip_leaf_textures()
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_image_format='WEBP', export_image_quality=90,
                              export_yup=True, export_extras=True, export_vertex_color='NAME', export_vertex_color_name='Col',
                              export_all_vertex_colors=False)
    charlib.pack(path)


def preview(objs, path):
    scn = bpy.context.scene
    for i, o in enumerate(objs):
        o.location.x = i * 9
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scn.collection.objects.link(cam)
    cam.data.lens = 28
    cam.location = (len(objs) * 4.5 - 4.5, -36, 6.5)
    cam.rotation_euler = (math.radians(84), 0, 0)
    scn.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scn.collection.objects.link(sun)
    w = bpy.data.worlds.new('w')
    scn.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.45, 0.55, 0.7, 1)
    bpy.ops.mesh.primitive_plane_add(size=200)
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 16
    scn.cycles.use_denoising = True
    scn.render.resolution_x = 1600
    scn.render.resolution_y = 640
    for m in bpy.data.materials:
        if m.get('foliage'):
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and 'foliage' in n.image.name and '_c' in n.image.name:
                    pass
    # vertex colours multiply the leaves in the preview too
    for o in objs:
        for m in o.data.materials:
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            b = nt.nodes.get('Principled BSDF')
            src = b.inputs['Base Color'].links[0].from_node if b.inputs['Base Color'].links else None
            if src is None:
                continue
            vc = nt.nodes.new('ShaderNodeVertexColor')
            vc.layer_name = 'Col'
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1
            out = [o for o in src.outputs if o.type == 'RGBA' and o.enabled] or [src.outputs[0]]
            nt.links.new(out[0], mix.inputs['A'])
            nt.links.new(vc.outputs['Color'], mix.inputs['B'])
            nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)


def impostors(out_dir):
    """side-view sprites of one variant per kind for distant forests (alpha, bottom-centred, square)"""
    import numpy as np
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 48
    scn.cycles.use_denoising = True
    scn.render.film_transparent = True
    scn.render.resolution_x = 512
    scn.render.resolution_y = 512
    w = bpy.data.worlds.new('w')
    scn.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.58, 0.65, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 1.2
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(40), 0, math.radians(20))
    scn.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    scn.collection.objects.link(cam)
    scn.camera = cam
    for kind in KINDS:
        ob = KINDS[kind](3)
        # plain shading normals for the bake (canopy custom normals confuse Cycles' back-face test)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
        for m in ob.data.materials:
            nt = m.node_tree
            b = nt.nodes.get('Principled BSDF')
            if not b.inputs['Base Color'].links:
                continue
            src = b.inputs['Base Color'].links[0].from_node
            o2 = [o for o in src.outputs if o.type == 'RGBA' and o.enabled] or [src.outputs[0]]
            vc = nt.nodes.new('ShaderNodeVertexColor')
            vc.layer_name = 'Col'
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1
            nt.links.new(o2[0], mix.inputs['A'])
            nt.links.new(vc.outputs['Color'], mix.inputs['B'])
            nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
            if m.get('foliage'):
                b.inputs['Subsurface Weight'].default_value = 0.0
        co = np.array([ob.matrix_world @ v.co for v in ob.data.vertices])
        lo, hi = co.min(0), co.max(0)
        H = hi[2] - max(lo[2], 0)
        Wd = max(hi[0] - lo[0], hi[1] - lo[1])
        size = max(H, Wd) * 1.02
        cam.data.ortho_scale = size
        cam.location = (0, -50, size / 2)
        cam.rotation_euler = (math.radians(90), 0, 0)
        path = os.path.join(out_dir, f'impostor_{kind}.png')
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print('IMPOSTOR', kind, round(size, 2), path)
        bpy.data.objects.remove(ob)


if __name__ == '__main__':
    if '--impostors' in sys.argv:
        reset()
        impostors(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'tex'))
        sys.exit(0)
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    prev = None
    if '--preview' in argv:
        prev = argv[argv.index('--preview') + 1]
        argv = [a for a in argv if a not in ('--preview', prev)]
    kinds = argv or list(KINDS)
    reset()
    built = []
    for k in kinds:
        for v in range(3):
            ob = KINDS[k](v * 17 + 3)
            if prev:
                built.append(ob)
                break
            export(ob, os.path.join(OUT, f'{k}_{v}.glb'))
            bpy.data.objects.remove(ob)
            print('EXPORTED', k, v)
    if prev:
        preview(built, prev)
        print('PREVIEW', prev)
