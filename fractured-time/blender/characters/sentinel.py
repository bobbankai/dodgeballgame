"""
SENTINEL A-07: HELIX experimental security frame (Chapter 1 boss). A heavy armoured torso hovering on a chronal gravity core, two
hammer-fisted arms, a single sensor eye, stabiliser fins and bolt-on armour plates that the phase transition blows off to expose the
core. Rigid machine parts in a node hierarchy (no skinning): the engine animates them procedurally (src/bosses/sentinel.ts).
  blender -b --factory-startup --python-exit-code 1 -P blender/characters/sentinel.py -- [--review out.png] [--export]
Hierarchy (names are what the engine looks up):
  sentinel_root > hover > torso > (head > eye), core, plate_chest_l/r, plate_back, fin_l/r,
                                   shoulder_l > arm_l > forearm_l > fist_l   (and _r)
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import garments as Gm  # noqa: E402
import hardsurface as HS  # noqa: E402
import sdf  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'bosses', 'sentinel')


def mats():
    return {
        'hull': Gm.armour('sentinel_hull', base=(0.085, 0.09, 0.1), edge=(0.42, 0.42, 0.43), wear=0.5, rough=0.38, coat=0.25, grooves=0.0),
        'paint': Gm.armour('sentinel_paint', base=(0.30, 0.055, 0.035), edge=(0.55, 0.53, 0.5), wear=0.6, rough=0.46, coat=0.15, grooves=0.0),
        'joint': Gm.armour('sentinel_joint', base=(0.025, 0.027, 0.03), edge=(0.3, 0.3, 0.31), wear=0.45, rough=0.28, coat=0.0, grooves=0.0),
        'core': Gm.emissive('sentinel_core', (0.35, 0.85, 1.0), 9.0),
        'eye': Gm.emissive('sentinel_eye', (1.0, 0.16, 0.06), 30.0),
    }


DETAIL = 2.2  # triangle budget scale: crisp chamfers on a hero-sized boss seen up close in cinematics


def part(name, f, lo, hi, material, step=0.012, tris=8000, parent=None, pivot=(0, 0, 0)):
    """Mesh an SDF part; its origin is moved to `pivot` (the joint it rotates about) and it is parented without moving."""
    ob = sdf.sculpt(name, f, lo, hi, step * 0.85, material=material, tris=int(tris * DETAIL))
    piv = Vector(pivot)
    ob.data.transform(__import__('mathutils').Matrix.Translation(-piv))
    ob.location = piv
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(35))
    if parent is not None:
        bpy.context.view_layer.update()  # matrix_world is only current after an update
        w = ob.matrix_world.copy()
        ob.parent = parent
        ob.matrix_world = w
    return ob


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    if parent is not None:
        bpy.context.view_layer.update()
        w = e.matrix_world.copy()
        e.parent = parent
        e.matrix_world = w
    return e


def panel_lines(f, spacing, depth=0.012, width=0.012, axis=2):
    """Carve machined panel seams (parallel grooves) into a part."""
    def cut(P):
        q = (P[:, axis] / spacing) % 1.0
        return np.abs(q - 0.5) * spacing - (spacing / 2 - width / 2)
    return sdf.subtract(f, lambda P: np.maximum(cut(P), -(f(P) + depth)), k=0.004)


R_ = sdf.rot
HUNCH = 30.0  # forward pitch of the carapace (degrees): the head hangs low and forward, below the line of the back
SQ2 = math.sqrt(2.0)


def cbox(c, half, ch, R=None, r=0.006):
    """Chamfered box (hard-surface plate: flat faces, 45-degree chamfers of width ~ch on every edge, a hairline round of r)."""
    h = np.asarray(half, float) - r
    c = np.asarray(c, float)

    def f(P):
        q = np.abs((P - c) @ R if R is not None else P - c)
        d = q - h
        box = np.sqrt((np.maximum(d, 0) ** 2).sum(1)) + np.minimum(d.max(1), 0)
        e = [(q[:, i] + q[:, j] - (h[i] + h[j] - ch)) / SQ2 for i, j in ((0, 1), (1, 2), (0, 2))]
        return np.maximum.reduce([box, *e]) - r
    return f


def wedge(f, p, n):
    """Cut a part with a half space (keep the side the normal points away from): slopes, tapers, bevelled noses."""
    return sdf.intersect(f, sdf.plane(p, n))


def slots(c, n, pitch, half, R, axis):
    """A row of vent slots (subtract from a part): n boxes `pitch` apart along local `axis`."""
    fs = []
    for i in range(n):
        o = np.zeros(3)
        o[axis] = (i - (n - 1) / 2) * pitch
        fs.append(sdf.box(np.array(c) + R @ o, half, 0.008, R=R))
    return sdf.union(*fs)


def build():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    M = mats()
    T = R_(HUNCH, 0, 0)
    root = empty('sentinel_root', (0, 0, 0))
    hover = empty('hover', (0, 0, 0.9), root)

    # --- gravity cradle: a collar and four bladed talons closing under the core, a segmented spine up into the carapace ----------
    talons = []
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = np.array([math.cos(a), math.sin(a), 0.0])
        side = np.cross(d, (0, 0, 1))
        c0 = np.array([0, 0.15, 0])
        pts = [c0 + d * 0.26 + (0, 0, 1.08), c0 + d * 0.5 + (0, 0, 0.86), c0 + d * 0.44 + (0, 0, 0.46), c0 + d * 0.2 + (0, 0, 0.2)]
        blade = sdf.tube(pts, [0.1, 0.09, 0.065, 0.02], k=0.05)
        talons.append(sdf.intersect(blade, sdf.offset(sdf.plane(c0, side), 0.045), sdf.offset(sdf.plane(c0, -side), 0.045)))
    cradle = sdf.union(cbox((0, 0.15, 1.1), (0.36, 0.36, 0.08), 0.1), *talons, k=0.05)
    part('cradle', panel_lines(cradle, 0.16), (-0.75, -0.6, 0.1), (0.75, 0.9, 1.3), M['hull'], step=0.01, tris=7000, parent=hover, pivot=(0, 0, 0.9))
    part('gravity_core', sdf.sphere((0, 0.15, 0.66), 0.15), (-0.3, -0.2, 0.3), (0.3, 0.5, 1.0), M['core'], step=0.012, tris=1200, parent=hover,
         pivot=(0, 0, 0.9))
    # a dark lens cage around the core: two crossed rings, so it reads as a contained reactor, not a bulb
    cage = sdf.union(sdf.torus((0, 0.15, 0.66), 0.2, 0.025, R=R_(90, 0, 0)), sdf.torus((0, 0.15, 0.66), 0.2, 0.025, R=R_(0, 90, 0)))
    part('core_cage', cage, (-0.3, -0.2, 0.3), (0.3, 0.5, 1.0), M['joint'], step=0.006, tris=1500, parent=hover, pivot=(0, 0, 0.9))
    spine = sdf.union(sdf.cylinder((0, 0.25, 1.38), 0.12, 0.32, 0.03),
                      cbox((0, 0.2, 1.24), (0.28, 0.24, 0.06), 0.06), cbox((0, 0.28, 1.43), (0.36, 0.3, 0.065), 0.07), k=0.015)
    part('spine', spine, (-0.5, -0.2, 1.0), (0.5, 0.7, 1.75), M['joint'], step=0.009, tris=3500, parent=hover, pivot=(0, 0, 0.9))

    # --- carapace: chamfered armour mass, wide at the shoulders, narrow at the waist, a raised hump over the back -----------------
    tc = np.array([0, 0.12, 2.3])
    torso_f = cbox(tc, (0.86, 0.6, 0.7), 0.26, R=T)
    for sx in (-1, 1):  # taper to the waist
        torso_f = wedge(torso_f, (sx * 0.58, 0, 1.75), (sx * 0.85, 0, -0.55))
    hump = cbox(tc + T @ (0, 0.22, 0.52), (0.66, 0.44, 0.34), 0.22, R=T @ R_(-18, 0, 0))
    keel = cbox(tc + T @ (0, 0.3, 0.86), (0.07, 0.4, 0.1), 0.06, R=T @ R_(-18, 0, 0))
    torso_f = sdf.union(torso_f, hump, keel, k=0.04)
    # recessed chest bay with a grille of armoured slats over the core
    bay_c = tc + T @ (0, -0.58, -0.08)
    torso_f = sdf.subtract(torso_f, cbox(bay_c, (0.3, 0.2, 0.32), 0.06, R=T), k=0.02)
    slats = sdf.union(*[cbox(bay_c + T @ (x, -0.12, 0), (0.025, 0.05, 0.3), 0.02, R=T) for x in (-0.2, -0.1, 0.0, 0.1, 0.2)])
    torso_f = sdf.union(torso_f, slats)
    for sx in (-1, 1):
        torso_f = sdf.subtract(torso_f, slots(tc + T @ (sx * 0.86, 0.05, 0.0), 5, 0.13, (0.06, 0.028, 0.2), T, 1), k=0.006)
    torso_f = panel_lines(torso_f, 0.34)
    torso = part('torso', torso_f, (-1.1, -0.95, 1.45), (1.1, 1.25, 3.5), M['hull'], step=0.011, tris=26000, parent=hover, pivot=(0, 0.3, 1.6))
    core_c = bay_c + T @ (0, 0.06, 0)
    part('core', sdf.sphere(core_c, 0.2), core_c - 0.3, core_c + 0.3, M['core'], step=0.014, tris=1200, parent=torso, pivot=core_c)
    # neck: cables from the front of the carapace down into the head
    nk = [sdf.tube([(x, -0.52, 2.66), (x * 1.25, -0.72, 2.6), (x, -0.86, 2.54)], [0.05, 0.05, 0.045]) for x in (-0.15, 0.0, 0.15)]
    part('neck', sdf.union(*nk), (-0.4, -1.15, 2.25), (0.4, -0.35, 2.85), M['joint'], step=0.008, tris=2500, parent=torso, pivot=(0, -0.6, 2.6))

    # --- head: low and far forward, a narrow chamfered wedge, heavy brow over one slit eye, mandible plates ------------------------
    hc = np.array([0, -1.02, 2.5])
    HR = R_(6, 0, 0)
    head_f = cbox(hc, (0.33, 0.36, 0.21), 0.12, R=HR)
    head_f = wedge(head_f, hc + (0, -0.12, 0.08), (0, -0.55, 0.84))
    for sx in (-1, 1):
        head_f = wedge(head_f, hc + (sx * 0.16, -0.22, 0), (sx * 0.86, -0.5, 0))
    brow = cbox(hc + (0, -0.24, 0.16), (0.34, 0.17, 0.06), 0.05, R=R_(-16, 0, 0))
    jaws = [cbox(hc + (sx * 0.17, -0.22, -0.19), (0.09, 0.21, 0.055), 0.035, R=R_(-20, 0, sx * 12)) for sx in (-1, 1)]
    head_f = sdf.union(head_f, brow, *jaws, k=0.015)
    head_f = sdf.subtract(head_f, sdf.box(hc + (0, -0.46, 0.04), (0.23, 0.14, 0.03), 0.008), k=0.005)
    head = part('head', panel_lines(head_f, 0.11, axis=0), (-0.45, -1.62, 2.1), (0.45, -0.65, 2.8), M['hull'], step=0.007, tris=7000,
                parent=torso, pivot=(0, -0.82, 2.5))
    eye_c = hc + (0, -0.33, 0.04)
    part('eye', sdf.ellipsoid(eye_c, (0.22, 0.05, 0.024)), eye_c - (0.3, 0.12, 0.08), eye_c + (0.3, 0.12, 0.08), M['eye'], step=0.006, tris=800,
         parent=head, pivot=eye_c)

    # --- bolt-on armour (the phase transition blows it off): chest plates either side of the bay, the back plate over the hump ----
    for sx, sd in ((1, 'l'), (-1, 'r')):
        pc = tc + T @ (sx * 0.52, -0.64, 0.02)
        PR = T @ R_(0, 0, sx * -16)
        pf = cbox(pc, (0.3, 0.06, 0.48), 0.07, R=PR)
        pf = wedge(pf, pc + T @ (sx * 0.12, 0, -0.18), T @ (sx * 0.62, 0, -0.78))  # cut the outer lower corner: an angular plate
        part(f'plate_chest_{sd}', panel_lines(pf, 0.18), pc - 0.6, pc + 0.6, M['paint'], step=0.008, tris=3500, parent=torso, pivot=pc)
        # dorsal spines: three blades fanning back off the hump
        base = tc + T @ (sx * 0.38, 0.42, 0.62)
        blades = []
        for i in range(3):
            tip = base + np.array([sx * (0.18 + 0.12 * i), 0.75 - 0.1 * i, 0.55 - 0.32 * i])
            mid = (base + tip) / 2 + (0, 0, 0.08)
            blades.append(sdf.tube([base + (sx * 0.04 * i, 0.05 * i, -0.14 * i), mid, tip], [0.09, 0.055, 0.01]))
        fin = sdf.union(*blades, k=0.03)
        nrm = np.array([sx * 0.9, 0, -0.42])
        fin = sdf.intersect(fin, sdf.offset(sdf.plane(base, nrm), 0.035), sdf.offset(sdf.plane(base, -nrm), 0.035))
        part(f'fin_{sd}', fin, base - (0.9, 0.3, 0.9), base + (0.9, 1.2, 1.0), M['hull'], step=0.008, tris=3000, parent=torso, pivot=base)
    bp = tc + T @ (0, 0.6, 0.3)
    bpf = cbox(bp, (0.5, 0.07, 0.4), 0.08, R=T @ R_(-18, 0, 0))
    part('plate_back', panel_lines(bpf, 0.22), bp - 0.8, bp + 0.8, M['paint'], step=0.009, tris=3000, parent=torso, pivot=bp)

    # --- arms: sloped pauldrons, long arms bowed out at the elbow, heavy gauntleted forearms, three-clawed hammer fists -----------
    for sx, sd in ((1, 'l'), (-1, 'r')):
        sh_c = np.array([sx * 1.08, 0.02, 2.82])
        PD = R_(4, sx * -30, 0)
        pc_ = sh_c + (sx * 0.14, 0.02, 0.22)
        paul = cbox(pc_, (0.38, 0.46, 0.19), 0.13, R=PD)
        paul = wedge(paul, pc_ + (0, -0.3, 0), (0, -0.7, 0.7))  # sloped front edge
        under = cbox(pc_ + PD @ (0, 0, -0.1), (0.3, 0.38, 0.1), 0.08, R=PD)
        sh = part(f'shoulder_{sd}', sdf.union(sdf.sphere(sh_c, 0.27), under, k=0.03), sh_c - (0.7, 0.7, 0.4), sh_c + (0.7, 0.7, 0.7),
                  M['joint'], step=0.009, tris=4000, parent=torso, pivot=sh_c)
        part(f'pauldron_{sd}', panel_lines(paul, 0.14, axis=1), pc_ - 0.7, pc_ + 0.7, M['paint'], step=0.008, tris=5000, parent=sh, pivot=sh_c)
        el_c = np.array([sx * 1.5, -0.24, 1.6])
        FU = sdf.frame(el_c - sh_c)
        ua = sdf.union(sdf.cone(sh_c, el_c, 0.19, 0.16), cbox((sh_c + el_c) / 2 + FU @ (0, 0, 0.08), (0.24, 0.25, 0.36), 0.1, R=FU), k=0.04)
        arm = part(f'arm_{sd}', panel_lines(ua, 0.2), el_c - (0.5, 0.5, 0.3), sh_c + (0.5, 0.5, 0.3), M['hull'], step=0.009, tris=5000,
                   parent=sh, pivot=sh_c)
        wr = np.array([sx * 1.42, -0.74, 0.62])
        FR = sdf.frame(wr - el_c)
        fa = sdf.union(sdf.sphere(el_c, 0.2), sdf.cone(el_c, wr, 0.17, 0.2), k=0.03)
        # elbow pistons: two rods along the inside of the forearm
        rods = [sdf.cone(el_c + FR @ (o, 0.16, 0.0), wr + FR @ (o, 0.16, -0.25), 0.035, 0.035) for o in (-0.09, 0.09)]
        fore = part(f'forearm_{sd}', sdf.union(fa, *rods, k=0.01), wr - (0.5, 0.5, 0.3), el_c + (0.5, 0.5, 0.3), M['joint'], step=0.009, tris=4500,
                    parent=arm, pivot=el_c)
        gc = (el_c + wr) / 2 + FR @ (0, -0.05, 0.08)
        guard = cbox(gc, (0.31, 0.29, 0.44), 0.14, R=FR)
        guard = wedge(guard, gc + FR @ (0, 0, -0.2), FR @ (0, -0.35, -0.94))  # tapered toward the elbow
        guard = sdf.subtract(guard, sdf.cone(el_c, wr, 0.15, 0.18), k=0.02)
        part(f'gauntlet_{sd}', panel_lines(guard, 0.15), wr - (0.6, 0.6, 0.3), el_c + (0.6, 0.6, 0.3), M['paint'], step=0.009, tris=5000,
             parent=fore, pivot=el_c)
        fc = wr + FR @ (0, 0, 0.24)
        fist = cbox(fc, (0.28, 0.27, 0.22), 0.1, R=FR)
        knuck = cbox(fc + FR @ (0, -0.2, 0.06), (0.26, 0.08, 0.16), 0.05, R=FR)
        claws = [sdf.tube([fc + FR @ (o, -0.16, 0.14), fc + FR @ (o * 1.08, -0.34, 0.34), fc + FR @ (o * 1.08, -0.24, 0.54)],
                          [0.07, 0.05, 0.012]) for o in (-0.17, 0.0, 0.17)]
        part(f'fist_{sd}', panel_lines(sdf.union(fist, knuck, *claws, k=0.02), 0.11, axis=0), fc - 0.8, fc + 0.8, M['hull'], step=0.008, tris=5500,
             parent=fore, pivot=wr)
    return root, M


def convexity(ob, iters=1):
    """Per-vertex convexity: mean over neighbours of n . (p - q) / |p - q| (positive on outer edges, negative in creases)."""
    me = ob.data
    n = len(me.vertices)
    P = np.empty(n * 3)
    me.vertices.foreach_get('co', P)
    P = P.reshape(-1, 3)
    N = np.empty(n * 3)
    me.vertices.foreach_get('normal', N)
    N = N.reshape(-1, 3)
    E = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', E)
    E = E.reshape(-1, 2)
    a, b = E[:, 0], E[:, 1]
    d = P[a] - P[b]
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    acc = np.zeros(n)
    cnt = np.zeros(n)
    np.add.at(acc, a, (N[a] * d).sum(1))
    np.add.at(acc, b, -(N[b] * d).sum(1))
    np.add.at(cnt, a, 1)
    np.add.at(cnt, b, 1)
    c = acc / np.maximum(cnt, 1)
    for _ in range(iters):  # one smoothing pass so the wear band has some width
        s_ = np.zeros(n)
        np.add.at(s_, a, c[b])
        np.add.at(s_, b, c[a])
        c = 0.5 * c + 0.5 * s_ / np.maximum(cnt, 1)
    return c


def bake_masks():
    """GAME colour per vertex for the engine's armour shader: R = ambient occlusion (Cycles), G = edge convexity."""
    import lookdev
    obs = [o for o in bpy.data.objects if o.type == 'MESH']
    ao = sdf.bake_ao(obs, distance=0.4, samples=32)
    for ob in obs:
        cv = convexity(ob)
        lookdev.game_color(ob, np.clip(ao[ob.name] * 1.05, 0, 1), np.clip(cv * 3.0 + 0.1, 0, 1), np.ones(len(ob.data.vertices)))


def export():
    os.makedirs(OUT, exist_ok=True)
    bake_masks()
    for m_ in bpy.data.materials:
        if 'ft' in m_ and m_.node_tree:
            for n_ in [n for n in m_.node_tree.nodes if n.type == 'TEX_IMAGE']:
                m_.node_tree.nodes.remove(n_)
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(OUT, 'sentinel.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_extras=True,
                              export_normals=True, export_materials='EXPORT', export_vertex_color='NAME', export_vertex_color_name='GAME',
                              export_all_vertex_colors=False)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    root, M = build()
    if '--review' in argv:
        import studio
        studio.setup(samples=32)
        out = argv[argv.index('--review') + 1]
        for nm, yaw, pitch in (('34', -30, 6), ('side', -90, 2), ('front', 0, 4), ('low', -20, -8)):
            studio.camera((0, 0, 1.8), 8.0, yaw, pitch, 40)
            studio.render(out.replace('.png', f'_{nm}.png'), (900, 900))
    if '--export' in argv:
        export()
