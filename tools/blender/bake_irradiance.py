"""
Bake an arena's diffuse global illumination into a probe grid of L2 spherical harmonics.

Input (from tools/bake-lighting.cjs, which exports the arena from the running game):
  <in>.json      materials (diffuse albedo, emission), mesh ranges, lights, probe bounds
  <in>.pos.bin   float32 xyz positions, three.js world space (Y up)
  <in>.idx.bin   uint32 triangle indices

What is baked is exactly the light the real-time renderer does NOT compute:
  pass A: lamps on, emitters and sky off  -> indirect only (bounce light from the lamps)
  pass B: lamps off, emitters and sky on  -> direct + indirect (occluded fill, glowing signs...)
Each probe is a tiny cube (invisible to rays) whose six faces bake irradiance for the six axis
directions; those are converted exactly to the nine SH coefficients three.js's light-probe grid
evaluates (cross terms zero). Units match three.js: point power = 4*pi*candela, sun strength =
lux, sky radiance = hemisphere colour / pi; the diffuse bake returns irradiance / pi.

Output: <out>.bin (float16, 27 per probe, x fastest then y then z) and <out>.json (grid meta).
Run: blender -b -P tools/blender/bake_irradiance.py -- <in-prefix> <out-prefix> [--samples N] [--max-probes N]
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

C4, C5, C3, C1, C2 = 0.886227, 0.247708, 0.743125, 0.429043, 0.511664


def args():
    a = lib.script_args()
    opts = {'in': a[0], 'out': a[1], 'samples': 96, 'max_probes': 42000}
    for i, x in enumerate(a):
        if x == '--samples':
            opts['samples'] = int(a[i + 1])
        if x == '--max-probes':
            opts['max_probes'] = int(a[i + 1])
    return opts


def to_blender(p):
    """three.js (x, y, z) Y-up → Blender (x, -z, y) Z-up."""
    p = np.asarray(p, dtype=np.float64)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


def make_mesh(name, verts, tris):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.astype(np.float32).ravel())
    n = len(tris)
    me.loops.add(n * 3)
    me.loops.foreach_set('vertex_index', tris.astype(np.int32).ravel())
    me.polygons.add(n)
    me.polygons.foreach_set('loop_start', np.arange(0, n * 3, 3, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(n, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def surface_material(name, albedo, emission):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    diff = nt.nodes.new('ShaderNodeBsdfDiffuse')
    diff.inputs['Color'].default_value = (*albedo, 1)
    emit = nt.nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (*emission, 1)
    emit.inputs['Strength'].default_value = 1.0
    emit.name = 'emit'
    add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(diff.outputs[0], add.inputs[0])
    nt.links.new(emit.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs['Surface'])
    return m


def setup_world(scene, lights):
    """Hemisphere/ambient fill as sky radiance (three.js irradiance / pi), ground below the horizon."""
    sky = np.zeros(3)
    ground = np.zeros(3)
    for L in lights:
        c = np.array(L['color']) * L['intensity']
        if L['type'] == 'hemi':
            sky += c
            ground += np.array(L['ground']) * L['intensity']
        elif L['type'] == 'ambient':
            sky += c
            ground += c
    w = bpy.data.worlds.new('fill')
    scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.name = 'bg'
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = -0.08
    ramp.inputs['From Max'].default_value = 0.08
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    # Mix node sockets: 0 factor, 6/7 colour A/B, output 2 colour result
    mix.inputs[6].default_value = (*(ground / math.pi), 1)
    mix.inputs[7].default_value = (*(sky / math.pi), 1)
    # in a world shader the Generated coordinate is the ray direction: Z > 0 looks at the sky
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Value'])
    nt.links.new(ramp.outputs['Result'], mix.inputs[0])
    nt.links.new(mix.outputs[2], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    return bg


def add_lights(lights):
    objs = []
    for i, L in enumerate(lights):
        t = L['type']
        col = L['color']
        if t in ('hemi', 'ambient'):
            continue
        if t == 'sun':
            ld = bpy.data.lights.new(f'sun{i}', 'SUN')
            ld.energy = L['intensity']
            ld.angle = math.radians(1.5)
            ld.color = col
            ob = bpy.data.objects.new(f'sun{i}', ld)
            d = Vector(to_blender(L['dir']).tolist())
            ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        else:
            ld = bpy.data.lights.new(f'l{i}', 'SPOT' if t == 'spot' else 'POINT')
            pos = to_blender(L['pos'])
            # three.js decay/cutoff isn't inverse-square: match irradiance at a representative range
            r0 = float(np.clip(L['pos'][1], 2.0, 10.0))
            dec = L.get('decay', 2.0)
            e = L['intensity'] / max(r0 ** dec, 0.01)
            dist = L.get('distance', 0.0)
            if dist and dist > 0:
                e *= max(0.0, 1 - (r0 / dist) ** 4) ** 2
            ld.energy = 4 * math.pi * e * r0 * r0
            ld.shadow_soft_size = 0.15
            ld.color = col
            if t == 'spot':
                ld.spot_size = min(math.pi, 2 * L['angle'])
                ld.spot_blend = float(np.clip(L.get('penumbra', 0.0), 0, 1))
            ob = bpy.data.objects.new(f'l{i}', ld)
            ob.location = pos.tolist()
            if t == 'spot':
                d = Vector(to_blender(L['dir']).tolist())
                ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(ob)
        objs.append(ob)
    return objs


# three.js axis directions in the order the SH fit expects
DIRS = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], dtype=np.float64)


def probe_mesh(probes_b, atlas, half=0.05):
    """Six outward quads per probe (Blender coords), each mapped onto its own 2x2 texel block."""
    n = len(probes_b)
    dirs_b = to_blender(DIRS)
    verts, uvs = [], []
    per_row = atlas // 2
    for f in range(6):
        nrm = dirs_b[f]
        ref = np.array([0, 0, 1.0]) if abs(nrm[2]) < 0.9 else np.array([1.0, 0, 0])
        t = np.cross(ref, nrm)
        t /= np.linalg.norm(t)
        b = np.cross(nrm, t)
        corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        blk = np.arange(n) * 6 + f
        bx, by = blk % per_row, blk // per_row
        for (su, sv) in corners:
            verts.append(probes_b + (nrm + su * t + sv * b) * half)
            uvs.append(np.stack([(2 * bx + (su + 1)) / atlas, (2 * by + (sv + 1)) / atlas], -1))
    # vertex arrays: [corner][probe] → reorder to probe-face-major quads
    V = np.stack(verts, 0).reshape(6, 4, n, 3).transpose(2, 0, 1, 3).reshape(-1, 3)
    U = np.stack(uvs, 0).reshape(6, 4, n, 2).transpose(2, 0, 1, 3).reshape(-1, 2)
    nq = n * 6
    me = bpy.data.meshes.new('probes')
    me.vertices.add(nq * 4)
    me.vertices.foreach_set('co', V.astype(np.float32).ravel())
    me.loops.add(nq * 4)
    me.loops.foreach_set('vertex_index', np.arange(nq * 4, dtype=np.int32))
    me.polygons.add(nq)
    me.polygons.foreach_set('loop_start', np.arange(0, nq * 4, 4, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(nq, 4, dtype=np.int32))
    me.update(calc_edges=True)
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', U.astype(np.float32).ravel())
    ob = bpy.data.objects.new('probes', me)
    bpy.context.scene.collection.objects.link(ob)
    # invisible to secondary rays (no self-occlusion); camera visibility must stay on for baking
    for attr in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(ob, attr, False)
    return ob


def find_invalid(probes_t, verts_t, tris):
    """Probes buried inside geometry see mostly back faces."""
    bvh = BVHTree.FromPolygons([tuple(v) for v in verts_t], [tuple(t) for t in tris], epsilon=0.0)
    k = 14
    i = np.arange(k) + 0.5
    y = 1 - 2 * i / k
    r = np.sqrt(1 - y * y)
    th = math.pi * (3 - math.sqrt(5)) * i
    dirs = [Vector((math.cos(a) * rr, yy, math.sin(a) * rr)) for a, rr, yy in zip(th, r, y)]
    bad = np.zeros(len(probes_t), dtype=bool)
    for pi, p in enumerate(probes_t):
        o = Vector(p)
        back = 0
        for d in dirs:
            hit = bvh.ray_cast(o, d, 40.0)
            if hit[0] is not None and hit[1].dot(d) > 0:
                back += 1
        bad[pi] = back > k * 0.3
    return bad


def sh_from_axes(E):
    """(n, 6, 3) axis irradiances (+x -x +y -y +z -z, three.js axes) → (n, 9, 3) SH coefficients."""
    ex, exn, ey, eyn, ez, ezn = [E[:, i] for i in range(6)]
    Lx = (ex - exn) / (2 * 2 * C2)
    Ly = (ey - eyn) / (2 * 2 * C2)
    Lz = (ez - ezn) / (2 * 2 * C2)
    Sx, Sy, Sz = (ex + exn) / 2, (ey + eyn) / 2, (ez + ezn) / 2
    A0 = (Sx + Sy + Sz) / (3 * C4)
    C6 = (Sz - C4 * A0) / (C3 - C5)
    C8 = (Sx - Sy) / (2 * C1)
    Z = np.zeros_like(A0)
    # three.js order: c0 (L00), c1 (y), c2 (z), c3 (x), c4 (xy), c5 (yz), c6 (z²), c7 (xz), c8 (x²-y²)
    return np.stack([A0, Ly, Lz, Lx, Z, Z, C6, Z, C8], axis=1)


def main():
    o = args()
    t0 = time.time()
    meta = json.load(open(o['in'] + '.json'))
    pos_t = np.fromfile(o['in'] + '.pos.bin', dtype=np.float32).reshape(-1, 3)
    idx = np.fromfile(o['in'] + '.idx.bin', dtype=np.uint32).reshape(-1, 3)
    scene = lib.reset_scene()
    cy = scene.cycles
    cy.samples = o['samples']
    cy.max_bounces = 4
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 0
    cy.transmission_bounces = 0
    cy.sample_clamp_indirect = 20.0

    # ---- scene geometry, one object per material
    pos_b = to_blender(pos_t)
    by_mat = {}
    for m in meta['meshes']:
        s, c = m['indexStart'], m['indexCount']
        by_mat.setdefault(m['material'], []).append(idx.reshape(-1)[s:s + c].reshape(-1, 3))
    emitters = []
    for mi, parts in by_mat.items():
        tris = np.concatenate(parts)
        used, inv = np.unique(tris.ravel(), return_inverse=True)
        ob = make_mesh(f'm{mi}', pos_b[used], inv.reshape(-1, 3))
        mdef = meta['materials'][mi]
        mat = surface_material(f'mat{mi}', mdef['albedo'], mdef['emission'])
        ob.data.materials.append(mat)
        emitters.append(mat.node_tree.nodes['emit'])
    lights = meta['lights']
    bg = setup_world(scene, lights)
    lamp_objs = add_lights(lights)

    # ---- probe grid (three.js coords), matching LightProbeGridWebGL's corner-inclusive layout
    bmin = np.array(meta['bounds']['min'])
    bmax = np.array(meta['bounds']['max'])
    ext = np.maximum(bmax - bmin, 0.5)
    vol = float(np.prod(ext))
    spacing = max(0.75, (vol / o['max_probes']) ** (1 / 3))
    res = np.maximum(2, np.floor(ext / spacing).astype(int) + 1)
    gx = np.linspace(bmin[0], bmin[0] + ext[0], res[0])
    gy = np.linspace(bmin[1], bmin[1] + ext[1], res[1])
    gz = np.linspace(bmin[2], bmin[2] + ext[2], res[2])
    zz, yy, xx = np.meshgrid(gz, gy, gx, indexing='ij')
    probes_t = np.stack([xx.ravel(), yy.ravel(), zz.ravel()], -1)  # x fastest, then y, then z
    n = len(probes_t)
    print(f'[bake] {meta["arena"]}: {len(idx)} tris, {len(lamp_objs)} lamps, grid {res.tolist()} = {n} probes, spacing {spacing:.2f} m')

    invalid = find_invalid(probes_t, pos_t, idx)
    print(f'[bake] {int(invalid.sum())} probes inside geometry ({time.time() - t0:.0f}s)')

    atlas = int(2 * math.ceil(math.sqrt(n * 6)))
    probes = probe_mesh(to_blender(probes_t), atlas)
    bake_mat = bpy.data.materials.new('probe')
    bake_mat.use_nodes = True
    tex = bake_mat.node_tree.nodes.new('ShaderNodeTexImage')
    probes.data.materials.append(bake_mat)

    def bake(label, direct, indirect):
        img = bpy.data.images.new(label, atlas, atlas, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        tex.image = img
        bake_mat.node_tree.nodes.active = tex
        bpy.ops.object.select_all(action='DESELECT')
        probes.select_set(True)
        bpy.context.view_layer.objects.active = probes
        b = scene.render.bake
        b.use_selected_to_active = False
        b.margin = 0
        b.use_pass_direct = direct
        b.use_pass_indirect = indirect
        b.use_pass_color = False
        t = time.time()
        bpy.ops.object.bake(type='DIFFUSE')
        print(f'[bake] pass {label}: {time.time() - t:.0f}s')
        px = lib.image_pixels(img)[..., :3]
        # average each face's 2x2 block
        blocks = px.reshape(atlas // 2, 2, atlas // 2, 2, 3).mean(axis=(1, 3)).reshape(-1, 3)
        return blocks[: n * 6].reshape(n, 6, 3) * math.pi

    # pass A: lamp bounce only
    for e in emitters:
        e.inputs['Strength'].default_value = 0.0
    bg.inputs['Strength'].default_value = 0.0
    E = bake('lamps', False, True) if lamp_objs else np.zeros((n, 6, 3))
    # pass B: sky fill + emitters, direct and indirect
    for e in emitters:
        e.inputs['Strength'].default_value = 1.0
    bg.inputs['Strength'].default_value = 1.0
    for ob in lamp_objs:
        ob.data.energy = 0.0
    E = E + bake('fill', True, True)

    sh = sh_from_axes(E)  # (n, 9, 3)
    # ---- replace buried probes with the average of valid neighbours (grown outward)
    grid = sh.reshape(res[2], res[1], res[0], 27)
    valid = (~invalid).reshape(res[2], res[1], res[0])
    for _ in range(12):
        if valid.all():
            break
        acc = np.zeros_like(grid)
        cnt = np.zeros(valid.shape)
        for ax in range(3):
            for s in (-1, 1):
                g = np.roll(grid, s, axis=ax)
                v = np.roll(valid, s, axis=ax)
                # no wrap-around
                sl = [slice(None)] * 3
                sl[ax] = 0 if s == 1 else -1
                v = v.copy()
                v[tuple(sl)] = False
                acc += g * v[..., None]
                cnt += v
        fill = (~valid) & (cnt > 0)
        grid[fill] = acc[fill] / cnt[fill][:, None]
        valid = valid | fill
    if not valid.all():
        grid[~valid] = grid[valid].mean(axis=0)

    out = o['out']
    os.makedirs(os.path.dirname(out), exist_ok=True)
    grid.astype(np.float16).tofile(out + '.bin')
    json.dump(
        {
            'version': 1,
            'arena': meta['arena'],
            'min': gx[0:1].tolist() + gy[0:1].tolist() + gz[0:1].tolist(),
            'max': [float(gx[-1]), float(gy[-1]), float(gz[-1])],
            'res': res.tolist(),
            'scale': 1.0,
        },
        open(out + '.json', 'w'),
        indent=1,
    )
    avg = E.mean(axis=(0, 1))
    print(f'[bake] wrote {os.path.relpath(out, lib.ROOT)}.bin ({n} probes); mean irradiance {avg.round(3).tolist()}; total {time.time() - t0:.0f}s')


main()
