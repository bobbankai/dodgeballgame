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
import hardpoly as HP  # noqa: E402
import sdf  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'bosses', 'sentinel')


def mats():
    return {
        'hull': Gm.armour('sentinel_hull', base=(0.06, 0.065, 0.072), edge=(0.38, 0.38, 0.39), wear=0.45, rough=0.55, coat=0.08, grooves=0.0),
        'paint': Gm.armour('sentinel_paint', base=(0.24, 0.045, 0.03), edge=(0.5, 0.48, 0.45), wear=0.55, rough=0.58, coat=0.05, grooves=0.0),
        'joint': Gm.armour('sentinel_joint', base=(0.025, 0.027, 0.03), edge=(0.3, 0.3, 0.31), wear=0.45, rough=0.28, coat=0.0, grooves=0.0),
        'hazard': Gm.armour('sentinel_hazard', base=(0.6, 0.42, 0.05), edge=(0.5, 0.48, 0.45), wear=0.6, rough=0.55, coat=0.05, grooves=0.0),
        'core': Gm.emissive('sentinel_core', (0.35, 0.85, 1.0), 9.0),
        'eye': Gm.emissive('sentinel_eye', (1.0, 0.16, 0.06), 30.0),
    }


DETAIL = 2.2  # triangle budget scale: crisp chamfers on a hero-sized boss seen up close in cinematics


def recipe(m, **kw):
    r = json.loads(m['ft'])
    r.update(kw)
    m['ft'] = json.dumps(r)
    return m


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


def ppart(name, objs, material=None, parent=None, pivot=(0, 0, 0), sharp=32.0):
    """A polygonal part: pieces (hardpoly / sdf objects) joined, shaded with weighted normals, origin at its pivot, parented."""
    if material is not None:
        for o in objs:
            if not o.data.materials:
                o.data.materials.append(material)
    ob = HP.finish(objs, name, sharp_deg=sharp)
    piv = Vector(pivot)
    ob.data.transform(__import__('mathutils').Matrix.Translation(-piv))
    ob.location = piv
    if parent is not None:
        bpy.context.view_layer.update()
        w = ob.matrix_world.copy()
        ob.parent = parent
        ob.matrix_world = w
    return ob


def sdfo(name, f, lo, hi, material, step=0.008, tris=3000):
    """An SDF-meshed piece (organic/round forms inside a polygonal part)."""
    ob = sdf.sculpt(name, f, lo, hi, step, material=material, tris=int(tris * DETAIL))
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


def bolts(center, R, pts, normal_local, r=0.026, h=0.016):
    """Hex-ish bolt heads on a plate: local points `pts` (plate frame R about `center`), standing out along the plate's normal."""
    n = R @ np.asarray(normal_local, float)
    F = sdf.frame(n)
    return sdf.union(*[sdf.cylinder(np.asarray(center) + R @ np.asarray(p, float), r, h, rr=0.006, R=F) for p in pts])


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
    for k in ('hull', 'paint', 'joint', 'hazard'):
        recipe(M[k], detail='metal_plate_02', detailScale=1.3)
    recipe(M['hazard'], stripes=5.0)
    H, P, J = M['hull'], M['paint'], M['joint']
    T = R_(HUNCH, 0, 0)
    root = empty('sentinel_root', (0, 0, 0))
    hover = empty('hover', (0, 0, 0.9), root)

    # --- gravity cradle: a machined collar, four bladed talons closing under a caged core, a segmented spine ----------------------
    talons = []
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = np.array([math.cos(a), math.sin(a), 0.0])
        side = np.cross(d, (0, 0, 1))
        c0 = np.array([0, 0.15, 0])
        pts = [c0 + d * 0.26 + (0, 0, 1.08), c0 + d * 0.5 + (0, 0, 0.86), c0 + d * 0.44 + (0, 0, 0.46), c0 + d * 0.2 + (0, 0, 0.2)]
        blade = sdf.tube(pts, [0.1, 0.09, 0.065, 0.02], k=0.05)
        talons.append(sdf.intersect(blade, sdf.offset(sdf.plane(c0, side), 0.045), sdf.offset(sdf.plane(c0, -side), 0.045)))
    tal = sdfo('talons', sdf.union(*talons), (-0.75, -0.6, 0.1), (0.75, 0.9, 1.2), H, step=0.007, tris=6000)
    collar = HP.hbox('collar', (0, 0.15, 1.1), (0.38, 0.38, 0.08), 0.06, material=H)
    collar_ring = HP.hcyl('collar_ring', (0, 0.15, 1.0), 0.3, 0.06, sides=32, material=J)
    ppart('cradle', [tal, collar, collar_ring], parent=hover, pivot=(0, 0, 0.9))
    part('gravity_core', sdf.sphere((0, 0.15, 0.66), 0.15), (-0.3, -0.2, 0.3), (0.3, 0.5, 1.0), M['core'], step=0.012, tris=1200, parent=hover,
         pivot=(0, 0, 0.9))
    cage = sdf.union(sdf.torus((0, 0.15, 0.66), 0.2, 0.025, R=R_(90, 0, 0)), sdf.torus((0, 0.15, 0.66), 0.2, 0.025, R=R_(0, 90, 0)))
    part('core_cage', cage, (-0.3, -0.2, 0.3), (0.3, 0.5, 1.0), J, step=0.006, tris=1500, parent=hover, pivot=(0, 0, 0.9))
    spine = [HP.hcyl('sp_axle', (0, 0.25, 1.38), 0.12, 0.62, sides=24, material=J),
             HP.hbox('sp_a', (0, 0.2, 1.24), (0.28, 0.24, 0.06), 0.03, material=J), HP.hbox('sp_b', (0, 0.28, 1.43), (0.36, 0.3, 0.065), 0.03, material=J)]
    ppart('spine', spine, parent=hover, pivot=(0, 0, 0.9))

    # --- carapace: a chamfered armour mass narrowing to the waist, raised hump, keel, layered flank plates, vents, the core bay ------
    tc = np.array([0, 0.12, 2.3])
    body = HP.hbox('body', tc, (0.86, 0.6, 0.7), 0.2, R=T, material=H)
    for sx in (-1, 1):
        HP.cut(body, (sx * 0.58, 0, 1.75), (sx * 0.85, 0, -0.55))
    TH = T @ R_(-18, 0, 0)
    hump = HP.hbox('hump', tc + T @ (0, 0.22, 0.52), (0.66, 0.44, 0.34), 0.16, R=TH, material=H)
    keel = HP.hbox('keel', tc + T @ (0, 0.3, 0.86), (0.07, 0.42, 0.1), 0.035, R=TH, material=H)
    bay_c = tc + T @ (0, -0.58, -0.08)
    HP.carve(body, [HP.hbox('bay', bay_c, (0.3, 0.22, 0.32), 0.04, R=T)])
    slats = [HP.hbox(f'slat{i}', bay_c + T @ (x, -0.13, 0), (0.026, 0.05, 0.3), 0.012, R=T, material=J) for i, x in enumerate((-0.2, -0.1, 0.0, 0.1, 0.2))]
    pieces = [body, hump, keel, *slats]
    for sx in (-1, 1):
        # vent slots cut into the hump's flanks
        vents = [HP.hbox(f'v{sx}{i}', tc + T @ (sx * 0.6, 0.12 + (i - 2) * 0.13, 0.55), (0.12, 0.03, 0.16), 0.008, R=TH) for i in range(5)]
        HP.carve(hump, vents)
        # a layered armour panel on each flank (designed outline), bolted
        FR = T @ R_(0, 0, sx * 90)
        fc = tc + T @ (sx * 0.875, 0.02, -0.05)
        outline = [(-0.38, -0.42), (0.34, -0.42), (0.46, -0.1), (0.46, 0.38), (-0.26, 0.38), (-0.38, 0.18)]
        if sx < 0:
            outline = [(-u, v) for u, v in reversed(outline)]
        pieces.append(HP.plate(f'flank{sx}', outline, 0.05, fc, R=FR, chamfer=0.018, material=H))
        pieces += HP.bolts(f'fb{sx}', fc, FR, [(-0.3, 0.0, -0.32), (0.3, 0.0, -0.32), (0.36, 0.0, 0.3), (-0.2, 0.0, 0.3)], (0, 1, 0), material=J)
    torso = ppart('torso', pieces, parent=hover, pivot=(0, 0.3, 1.6))
    core_c = bay_c + T @ (0, 0.06, 0)
    part('core', sdf.sphere(core_c, 0.2), core_c - 0.3, core_c + 0.3, M['core'], step=0.014, tris=1200, parent=torso, pivot=core_c)
    nk = [sdf.tube([(x, -0.52, 2.66), (x * 1.25, -0.72, 2.6), (x, -0.86, 2.54)], [0.05, 0.05, 0.045]) for x in (-0.15, 0.0, 0.15)]
    part('neck', sdf.union(*nk), (-0.4, -1.15, 2.25), (0.4, -0.35, 2.85), J, step=0.008, tris=2500, parent=torso, pivot=(0, -0.6, 2.6))

    # --- head: low and far forward, a narrow chamfered wedge, heavy brow over one slit eye, mandible plates ------------------------
    hc = np.array([0, -1.02, 2.5])
    HR = R_(6, 0, 0)
    head = HP.hbox('head_core', hc, (0.33, 0.36, 0.21), 0.07, R=HR, material=H)
    HP.cut(head, hc + (0, -0.12, 0.08), (0, -0.55, 0.84))
    for sx in (-1, 1):
        HP.cut(head, hc + (sx * 0.16, -0.22, 0), (sx * 0.86, -0.5, 0))
    HP.carve(head, [HP.hbox('slit', hc + (0, -0.46, 0.04), (0.23, 0.14, 0.03), 0.006)])
    brow = HP.hbox('brow', hc + (0, -0.24, 0.16), (0.34, 0.17, 0.06), 0.03, R=R_(-16, 0, 0), material=H)
    jaws = [HP.hbox(f'jaw{sx}', hc + (sx * 0.17, -0.22, -0.19), (0.09, 0.21, 0.055), 0.025, R=R_(-20, 0, sx * 12), material=H) for sx in (-1, 1)]
    head_ob = ppart('head', [head, brow, *jaws], parent=torso, pivot=(0, -0.82, 2.5))
    eye_c = hc + (0, -0.33, 0.04)
    part('eye', sdf.ellipsoid(eye_c, (0.22, 0.05, 0.024)), eye_c - (0.3, 0.12, 0.08), eye_c + (0.3, 0.12, 0.08), M['eye'], step=0.006, tris=800,
         parent=head_ob, pivot=eye_c)

    # --- bolt-on armour (the phase transition blows it off): angular chest plates, the back plate, dorsal blades ------------------
    for sx, sd in ((1, 'l'), (-1, 'r')):
        pc = tc + T @ (sx * 0.5, -0.64, 0.02)
        PR = T @ R_(0, 0, sx * -16) @ R_(0, 0, 180)  # plate frame: local +Y faces out of the chest
        outline = [(-0.3, -0.5), (0.18, -0.5), (0.3, -0.3), (0.3, 0.46), (-0.22, 0.46), (-0.3, 0.36)]
        if sx < 0:
            outline = [(-u, v) for u, v in reversed(outline)]
        pl = HP.plate(f'pc{sd}', outline, 0.07, pc, R=PR, chamfer=0.022, material=P)
        bl = HP.bolts(f'pcb{sd}', pc, PR, [(u, 0.0, v) for u in (-0.2, 0.2) for v in (-0.38, 0.0, 0.36)], (0, 1, 0), radius=0.024, material=J)
        ppart(f'plate_chest_{sd}', [pl, *bl], parent=torso, pivot=pc)
        base = tc + T @ (sx * 0.38, 0.42, 0.62)
        blades = []
        for i in range(3):
            tip = np.array([sx * (0.18 + 0.12 * i), 0.75 - 0.1 * i, 0.55 - 0.32 * i])
            L = float(np.linalg.norm(tip))
            # plate() extrudes along local -Y and outlines in XZ: build a blade frame with local X along the blade, local Y sideways
            xa = tip / L
            ya = np.array([sx * 0.9, 0, -0.42])
            ya = ya - xa * (ya @ xa)
            ya /= np.linalg.norm(ya)
            za = np.cross(xa, ya)
            BR = np.stack([xa, ya, za], 1)
            outline = [(0.0, -0.08), (L * 0.55, -0.05), (L, 0.0), (L * 0.6, 0.05), (0.0, 0.1)]
            blades.append(HP.plate(f'fin{sd}{i}', outline, 0.045, base + (sx * 0.04 * i, 0.05 * i, -0.14 * i) + ya * 0.022, R=BR, chamfer=0.012,
                                   material=H, bevel_back=True))
        ppart(f'fin_{sd}', blades, parent=torso, pivot=base)
    bp = tc + T @ (0, 0.6, 0.3)
    BR = TH
    bpo = [(-0.5, -0.4), (0.5, -0.4), (0.5, 0.25), (0.3, 0.4), (-0.3, 0.4), (-0.5, 0.25)]
    bpl = HP.plate('bp', bpo, 0.07, bp + BR @ (0, 0.07, 0), R=BR, chamfer=0.022, material=P)
    bbl = HP.bolts('bpb', bp + BR @ (0, 0.07, 0), BR, [(x, 0.0, z) for x in (-0.4, 0.4) for z in (-0.3, 0.2)], (0, 1, 0), material=J)
    ppart('plate_back', [bpl, *bbl], parent=torso, pivot=bp)

    # --- arms: sloped pauldrons, long arms bowed out at the elbow, heavy gauntleted forearms, three-clawed hammer fists -----------
    for sx, sd in ((1, 'l'), (-1, 'r')):
        sh_c = np.array([sx * 1.08, 0.02, 2.82])
        PD = R_(4, sx * -30, 0)
        pc_ = sh_c + (sx * 0.14, 0.02, 0.22)
        ball = sdfo(f'ball{sd}', sdf.sphere(sh_c, 0.27), sh_c - 0.35, sh_c + 0.35, J, step=0.008, tris=2000)
        under = HP.hbox(f'under{sd}', pc_ + PD @ (0, 0, -0.1), (0.3, 0.38, 0.1), 0.04, R=PD, material=J)
        sh = ppart(f'shoulder_{sd}', [ball, under], parent=torso, pivot=sh_c)
        paul = HP.hbox(f'paul{sd}', pc_, (0.38, 0.46, 0.19), 0.09, R=PD, material=P)
        HP.cut(paul, pc_ + (0, -0.3, 0), (0, -0.7, 0.7))
        ridge = HP.hbox(f'ridge{sd}', pc_ + PD @ (0, 0.04, 0.2), (0.05, 0.36, 0.035), 0.015, R=PD, material=H)
        pb = HP.bolts(f'pb{sd}', pc_, PD, [(x, -0.14, 0.19) for x in (-0.26, -0.13, 0.13, 0.26)], (0, 0, 1), radius=0.026, material=J)
        ppart(f'pauldron_{sd}', [paul, ridge, *pb], parent=sh, pivot=sh_c)
        el_c = np.array([sx * 1.5, -0.24, 1.6])
        FU = HP.frame_z(el_c - sh_c, (sx, 0, 0))
        ua_rod = HP.rod(f'uar{sd}', sh_c, el_c, 0.16, sides=24, material=J)
        ua_shell = HP.hbox(f'uas{sd}', (sh_c + el_c) / 2 + FU @ (0, 0.03, 0.06), (0.24, 0.25, 0.34), 0.06, R=FU, material=H)
        HP.cut(ua_shell, (sh_c + el_c) / 2 + FU @ (0, 0, 0.25), FU @ (0, -0.5, 0.86))
        arm = ppart(f'arm_{sd}', [ua_rod, ua_shell], parent=sh, pivot=sh_c)
        wr = np.array([sx * 1.42, -0.74, 0.62])
        FR = HP.frame_z(wr - el_c, (sx, 0, 0))
        elbow = sdfo(f'elbow{sd}', sdf.sphere(el_c, 0.2), el_c - 0.25, el_c + 0.25, J, step=0.008, tris=1500)
        fa_rod = HP.rod(f'far{sd}', el_c, wr, 0.17, sides=24, material=J)
        rods = [HP.rod(f'pis{sd}{i}', el_c + FR @ (o, 0.17, 0.05), wr + FR @ (o, 0.17, -0.25), 0.032, sides=12, material=H) for i, o in enumerate((-0.09, 0.09))]
        fore = ppart(f'forearm_{sd}', [elbow, fa_rod, *rods], parent=arm, pivot=el_c)
        gc = (el_c + wr) / 2 + FR @ (0, -0.05, 0.08)
        guard = HP.hbox(f'guard{sd}', gc, (0.31, 0.29, 0.44), 0.08, R=FR, material=P)
        HP.cut(guard, gc + FR @ (0, 0, -0.2), FR @ (0, -0.35, -0.94))
        gb = HP.bolts(f'gb{sd}', gc, FR, [(sx * 0.31, y, z) for y in (-0.15, 0.1) for z in (-0.22, 0.05, 0.3)], (sx, 0, 0), material=J)
        band = HP.hbox(f'gband{sd}', gc + FR @ (0, 0, 0.3), (0.325, 0.305, 0.05), 0.015, R=FR, material=M['hazard'])
        ppart(f'gauntlet_{sd}', [guard, band, *gb], parent=fore, pivot=el_c)
        fc = wr + FR @ (0, 0, 0.24)
        fist = HP.hbox(f'fist{sd}', fc, (0.28, 0.27, 0.22), 0.06, R=FR, material=H)
        knuck = HP.hbox(f'knuck{sd}', fc + FR @ (0, -0.2, 0.06), (0.26, 0.08, 0.16), 0.03, R=FR, material=M['hazard'])
        claws = sdf.union(*[sdf.tube([fc + FR @ (o, -0.16, 0.14), fc + FR @ (o * 1.08, -0.34, 0.34), fc + FR @ (o * 1.08, -0.24, 0.54)],
                                     [0.07, 0.05, 0.012]) for o in (-0.17, 0.0, 0.17)])
        cl = sdfo(f'claws{sd}', claws, fc - 0.8, fc + 0.8, H, step=0.006, tris=3000)
        ppart(f'fist_{sd}', [fist, knuck, cl], parent=fore, pivot=wr)
    return root, M


def export():
    os.makedirs(OUT, exist_ok=True)
    import masks
    masks.bake([o for o in bpy.data.objects if o.type == 'MESH'], os.path.join(OUT, 'sentinel_masks.png'), 'bosses/sentinel/sentinel_masks.png')
    for m_ in bpy.data.materials:
        if 'ft' in m_ and m_.node_tree:
            for n_ in [n for n in m_.node_tree.nodes if n.type == 'TEX_IMAGE']:
                m_.node_tree.nodes.remove(n_)
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(OUT, 'sentinel.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_extras=True,
                              export_normals=True, export_materials='EXPORT', export_vertex_color='NONE', export_texcoords=True)
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
