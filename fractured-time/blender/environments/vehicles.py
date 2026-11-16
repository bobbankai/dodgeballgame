"""
Vehicles, modelled as real hard-surface objects (hardpoly: planar faces, bevelled silhouettes, exact booleans, weighted normals).

helix_van  HELIX's patrol van: a high-roof panel van. The body is its side profile extruded across the width with rounded
           silhouette edges, wheel arches cut by boolean with a lip, then glazing, door and panel seams, bumpers, grille, head and
           tail lamps, mirrors, handles, a roof light bar, an underbody (chassis rails, axles, tank, exhaust: the frozen van hangs
           nose-down in the air, so its underside is on show), wheels (tyre with a sidewall chamfer, five-spoke rim, hub, nuts) and the
           HELIX livery. `crash` crumples the nose.
Local frame: x across (left = +x), y along (front = -y, as the old box van), z up, wheels on z = 0. Returns one joined object per call
(multi-material), placed with a world matrix.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import hardpoly as H

LEN, WID, ROOF = 5.9, 2.0, 2.5
WHEEL_R, WHEEL_W = 0.38, 0.24
AXLES = (-1.85, 1.75)          # front, rear axle positions along y (front is -y)
RZ = np.array([[0.0, 1.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])  # plate frame: outline u -> -y (forward), extrusion -> -x


def _profile():
    """Side profile (u forward, v up), counter-clockwise: rear bottom, along the sill to the bumper, up the nose, bonnet, windscreen,
    the high roof, down the back."""
    return [(-2.95, 0.36), (2.72, 0.36), (2.93, 0.48), (2.97, 0.82), (2.88, 1.02), (2.62, 1.12), (2.18, 1.22), (1.98, 1.42),
            (1.5, 2.06), (1.3, 2.32), (1.05, 2.47), (0.8, 2.5), (-2.78, 2.5), (-2.92, 2.44), (-2.96, 2.3)]


def _bevel_all(ob, width, segments=3, angle=30.0):
    m = ob.modifiers.new('bv', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)


def _crumple(ob, amount, seed=3):
    """Crash damage: the nose pushed in, harder on one corner, with a few buckles across the bonnet."""
    if amount <= 0:
        return
    rng = np.random.default_rng(seed)
    me = ob.data
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    front = np.clip((-co[:, 1] - 2.15) / 0.8, 0, 1)            # 0 behind the windscreen base, 1 at the bumper
    low = np.clip((1.6 - co[:, 2]) / 1.2, 0, 1)                 # the impact was low (nose down)
    corner = np.clip(0.55 + 0.45 * co[:, 0] / (WID / 2), 0, 1)  # the left front corner took it
    k = front * low * corner * amount
    ph = rng.uniform(0, 6.28, 3)
    buckle = np.sin(co[:, 0] * 7.3 + ph[0]) * np.sin(co[:, 1] * 9.1 + ph[1]) * 0.5 + np.sin(co[:, 2] * 11.0 + ph[2]) * 0.5
    co[:, 1] += k * 0.32                                       # pushed back
    co[:, 2] += k * buckle * 0.05
    co[:, 0] -= k * np.sign(co[:, 0]) * 0.04 * (buckle + 0.6)
    me.vertices.foreach_set('co', co.ravel())
    me.update()


def _wheel(name, c, side, M):
    """Tyre (tread + sidewall chamfers), five-spoke rim recessed into it, hub cap, wheel nuts. `side` = +1 left, -1 right."""
    R = H.frame_z((1, 0, 0))
    parts = []
    tyre = H.hcyl(f'{name}_tyre', c, WHEEL_R, WHEEL_W, R=R, sides=40, chamfer=0.06, material=M['tyre'])
    # tread grooves: four shallow circumferential channels
    for k, off in enumerate((-0.075, -0.025, 0.025, 0.075)):
        g = H.hcyl(f'{name}_g{k}', (c[0] + off, c[1], c[2]), WHEEL_R + 0.02, 0.012, R=R, sides=40, chamfer=0.0)
        bpy.context.view_layer.update()
        ring = H.hcyl(f'{name}_gi{k}', (c[0] + off, c[1], c[2]), WHEEL_R - 0.012, 0.03, R=R, sides=40, chamfer=0.0)
        H.carve(g, [ring])
        H.carve(tyre, [g])
    # the tyre is a ring: its bead seat is open so the rim sits in it, a few centimetres in from the sidewall
    H.carve(tyre, [H.hcyl(f'{name}_bead', c, 0.262, WHEEL_W + 0.1, R=R, sides=40, chamfer=0.0)])
    parts.append(tyre)
    face = c[0] + side * (WHEEL_W / 2 - 0.04)
    rim = H.hcyl(f'{name}_rim', (face, c[1], c[2]), 0.268, 0.045, R=R, sides=40, chamfer=0.012, material=M['rim'])
    # five spoke windows cut through the rim face
    cutters = []
    for i in range(5):
        a = i * 2 * math.pi / 5 + 0.3
        cy, cz = c[1] + math.cos(a) * 0.165, c[2] + math.sin(a) * 0.165
        Rr = H.frame_z((1, 0, 0), x_hint=(0, math.cos(a), math.sin(a)))
        cutters.append(H.hbox(f'{name}_sw{i}', (face, cy, cz), (0.06, 0.04, 0.085), chamfer=0.014, R=Rr))
    H.carve(rim, cutters)
    parts.append(rim)
    # the dark inside of the wheel behind the spokes (brake drum)
    parts.append(H.hcyl(f'{name}_drum', (face - side * 0.05, c[1], c[2]), 0.23, 0.04, R=R, sides=32, chamfer=0.0, material=M['trim']))
    parts.append(H.hcyl(f'{name}_hub', (face + side * 0.03, c[1], c[2]), 0.07, 0.03, R=R, sides=24, chamfer=0.008, material=M['rim']))
    for i in range(5):
        a = i * 2 * math.pi / 5
        parts.append(H.hcyl(f'{name}_nut{i}', (face + side * 0.028, c[1] + math.cos(a) * 0.1, c[2] + math.sin(a) * 0.1), 0.014, 0.025,
                            R=R, sides=6, chamfer=0.002, material=M['rim']))
    return parts


def helix_van(name, M, matrix=None, crash=0.0, lights_on=True, bar=True, livery=True):
    """M: materials {'paint', 'trim', 'glass', 'tyre', 'rim', 'chrome', 'stripe', 'stripe_dark', 'head', 'tail', 'bar_red', 'bar_blue',
    'bar_white', 'amber'}. Returns the joined van object."""
    parts = []
    # --- body shell -----------------------------------------------------------------------------------------------------------
    body = H.plate(f'{name}_body', _profile(), WID, (WID / 2, 0, 0), R=RZ, chamfer=0.0, material=M['paint'])
    _bevel_all(body, 0.085, segments=3, angle=25.0)
    # wheel arches: a cylinder bite through the body, then the arch lip (a thin black flare ring) around it
    cutters = []
    for k, ay in enumerate(AXLES):
        cutters.append(H.hcyl(f'{name}_arch{k}', (0, ay, WHEEL_R), WHEEL_R + 0.1, WID + 0.4, R=H.frame_z((1, 0, 0)), sides=40, chamfer=0.0))
    H.carve(body, cutters)
    _crumple(body, crash)
    parts.append(body)
    for k, ay in enumerate(AXLES):
        for sx in (-1, 1):
            lip = H.hcyl(f'{name}_lip{k}{sx}', (sx * (WID / 2 - 0.03), ay, WHEEL_R), WHEEL_R + 0.16, 0.1, R=H.frame_z((1, 0, 0)), sides=40,
                         chamfer=0.02, material=M['trim'])
            inner = H.hcyl(f'{name}_lipi{k}{sx}', (sx * (WID / 2 - 0.03), ay, WHEEL_R), WHEEL_R + 0.1, 0.3, R=H.frame_z((1, 0, 0)), sides=40,
                           chamfer=0.0)
            lower = H.hbox(f'{name}_lipc{k}{sx}', (sx * (WID / 2 - 0.03), ay, WHEEL_R - 0.45), (0.2, 0.8, 0.45), chamfer=0.0)
            H.carve(lip, [inner, lower])
            parts.append(lip)
            # the arch's dark inner wheel well
            well = H.hcyl(f'{name}_well{k}{sx}', (sx * (WID / 2 - 0.42), ay, WHEEL_R), WHEEL_R + 0.09, 0.04, R=H.frame_z((1, 0, 0)), sides=32,
                          chamfer=0.0, material=M['trim'])
            H.carve(well, [H.hbox(f'{name}_wellc{k}{sx}', (sx * (WID / 2 - 0.42), ay, 0.36 - 0.5), (0.2, 0.8, 0.5), chamfer=0.0)])
            parts.append(well)
            parts += _wheel(f'{name}_w{k}{sx}', (sx * (WID / 2 - WHEEL_W / 2 - 0.04), ay, WHEEL_R), sx, M)
    # --- glazing --------------------------------------------------------------------------------------------------------------
    # windscreen: a slab in the screen's slope between the A-pillars (profile base (u 1.98, v 1.42) to top (1.5, 2.06); u -> -y)
    base, top = np.array([-1.98, 1.42]), np.array([-1.5, 2.06])
    dvec = top - base
    L_ = float(np.linalg.norm(dvec))
    dh = np.array([0.0, dvec[0], dvec[1]]) / L_
    nrm = np.array([0.0, -dh[2], dh[1]])                           # forward and up, out of the glass
    mid = (base + top) / 2
    Rw = np.stack([np.array([-1.0, 0, 0]), nrm, dh], 1)            # det +1
    parts.append(H.hbox(f'{name}_ws', np.array([0.0, mid[0], mid[1]]) + nrm * 0.004, (WID / 2 - 0.13, 0.012, L_ / 2 - 0.06), chamfer=0.008,
                        R=Rw, material=M['glass']))
    for sx in (-1, 1):
        x = sx * WID / 2
        out = (sx, 0.0, 0.0)
        # cab door window (its front edge follows the screen), sliding door window, rear quarter (privacy glass)
        parts.append(_flush(f'{name}_cw{sx}', [(x, -1.0, 1.42), (x, -1.84, 1.42), (x, -1.5, 1.98), (x, -1.0, 1.98)], out, M['glass']))
        parts.append(_flush(f'{name}_sw{sx}', [(x, 0.1, 1.48), (x, 1.15, 1.48), (x, 1.15, 2.06), (x, 0.1, 2.06)], out, M['glass']))
        parts.append(_flush(f'{name}_qw{sx}', [(x, 1.4, 1.48), (x, 2.72, 1.48), (x, 2.72, 1.98), (x, 1.4, 2.06)], out, M['glass']))
        # door seams (front door, sliding door, its rail), handles, the HELIX band and the black lower cladding
        for (yy, z0, z1) in ((-1.0 + 0.04, 0.42, 2.12), (0.05, 0.42, 2.18), (1.25, 0.42, 2.18)):
            parts.append(H.hbox(f'{name}_seam{sx}{yy}', (x - sx * 0.002, yy, (z0 + z1) / 2), (0.006, 0.008, (z1 - z0) / 2), chamfer=0.0,
                                material=M['trim']))
        parts.append(H.hbox(f'{name}_rail{sx}', (x - sx * 0.002, 0.75, 2.12), (0.008, 0.85, 0.012), chamfer=0.003, material=M['trim']))
        for yy in (-0.15, 0.2):
            parts.append(H.hbox(f'{name}_hd{sx}{yy}', (x + sx * 0.01, yy, 1.28), (0.012, 0.09, 0.022), chamfer=0.008, material=M['chrome']))
        if livery:
            parts.append(H.hbox(f'{name}_band{sx}', (x + sx * 0.001, 0.25, 1.1), (0.003, 2.55, 0.09), chamfer=0.0, material=M['stripe']))
            parts.append(H.hbox(f'{name}_band2{sx}', (x + sx * 0.001, 0.25, 0.97), (0.003, 2.55, 0.025), chamfer=0.0,
                                material=M['stripe_dark']))
        # lower cladding, broken by the wheel arches
        gap = WHEEL_R + 0.17
        for j, (ya, yb) in enumerate(((-2.85, AXLES[0] - gap), (AXLES[0] + gap, AXLES[1] - gap), (AXLES[1] + gap, 2.85))):
            parts.append(H.hbox(f'{name}_clad{sx}{j}', (x - sx * 0.01, (ya + yb) / 2, 0.5), (0.02, (yb - ya) / 2, 0.1), chamfer=0.015,
                                material=M['trim']))
        # the HELIX mark on the sliding door: a hexagon badge
        if livery:
            hexo = [(x, 0.6 + math.cos(i * math.pi / 3) * 0.2, 1.72 + math.sin(i * math.pi / 3) * 0.2) for i in range(6)]
            parts.append(_flush(f'{name}_logo{sx}', hexo, out, M['stripe'], t=0.006))
        # mirror: arm and housing off the A-pillar
        parts.append(H.rod(f'{name}_ma{sx}', (sx * 0.98, -1.95, 1.5), (sx * 1.2, -2.0, 1.55), 0.02, material=M['trim']))
        parts.append(H.hbox(f'{name}_mh{sx}', (sx * 1.26, -2.0, 1.55), (0.07, 0.05, 0.16), chamfer=0.025, material=M['trim']))
        parts.append(H.hbox(f'{name}_mg{sx}', (sx * 1.26, -1.95, 1.55), (0.055, 0.004, 0.13), chamfer=0.0, material=M['chrome']))
        # head lamps (lit), amber indicators, tail lamp clusters (lit red)
        parts.append(H.hbox(f'{name}_hl{sx}', (sx * 0.72, -2.9, 1.0), (0.2, 0.03, 0.065), chamfer=0.02, material=M['head']))
        parts.append(H.hbox(f'{name}_ind{sx}', (sx * 0.9, -2.88, 0.94), (0.05, 0.03, 0.03), chamfer=0.01, material=M['amber']))
        parts.append(H.hbox(f'{name}_tl{sx}', (sx * 0.93, 2.95, 1.25), (0.06, 0.02, 0.32), chamfer=0.015, material=M['tail']))
    # rear doors: the split seam, windows, handle
    parts.append(H.hbox(f'{name}_rseam', (0, 2.965, 1.4), (0.006, 0.006, 1.0), chamfer=0.0, material=M['trim']))
    for sx in (-1, 1):
        x0_, x1_ = sx * 0.1, sx * 0.8
        parts.append(_flush(f'{name}_rw{sx}', [(x0_, 2.95, 1.45), (x1_, 2.95, 1.45), (x1_, 2.95, 1.98), (x0_, 2.95, 1.98)], (0, 1, 0),
                            M['glass']))
    parts.append(H.hbox(f'{name}_rh', (0.12, 2.98, 1.3), (0.08, 0.012, 0.02), chamfer=0.008, material=M['chrome']))
    # bumpers, grille, plate, step
    parts.append(H.hbox(f'{name}_fb', (0, -2.9, 0.55), (WID / 2 + 0.02, 0.11, 0.16), chamfer=0.05, material=M['trim']))
    parts.append(H.hbox(f'{name}_rb', (0, 2.92, 0.5), (WID / 2 + 0.02, 0.1, 0.13), chamfer=0.04, material=M['trim']))
    parts.append(H.hbox(f'{name}_step', (0, 3.02, 0.42), (0.45, 0.12, 0.03), chamfer=0.01, material=M['trim']))
    parts.append(H.hbox(f'{name}_gr', (0, -2.94, 0.86), (0.48, 0.02, 0.1), chamfer=0.015, material=M['trim']))
    for k in range(4):
        parts.append(H.hbox(f'{name}_grs{k}', (0, -2.955, 0.79 + k * 0.045), (0.46, 0.008, 0.008), chamfer=0.0, material=M['chrome']))
    parts.append(H.hbox(f'{name}_fp', (0, -3.02, 0.55), (0.26, 0.004, 0.06), chamfer=0.0, material=M['stripe_dark']))
    # roof light bar: a black base, red / white / blue lenses (lit: the van froze with its lights on), roof rails
    if bar:
        parts.append(H.hbox(f'{name}_lbb', (0, -0.55, ROOF + 0.04), (0.72, 0.16, 0.04), chamfer=0.02, material=M['trim']))
        for i, (xx, mk) in enumerate(((-0.5, 'bar_red'), (-0.2, 'bar_white'), (0.2, 'bar_white'), (0.5, 'bar_blue'))):
            parts.append(H.hbox(f'{name}_lb{i}', (xx, -0.55, ROOF + 0.115), (0.14, 0.13, 0.045), chamfer=0.03, material=M[mk]))
    for sx in (-1, 1):
        parts.append(H.rod(f'{name}_rr{sx}', (sx * 0.78, 0.3, ROOF + 0.06), (sx * 0.78, 2.6, ROOF + 0.06), 0.022, material=M['trim']))
        for yy in (0.35, 1.45, 2.55):
            parts.append(H.hbox(f'{name}_rrf{sx}{yy}', (sx * 0.78, yy, ROOF + 0.03), (0.03, 0.04, 0.03), chamfer=0.01, material=M['trim']))
    # underbody: floor pan, chassis rails, axles, diff, fuel tank, exhaust
    parts.append(H.hbox(f'{name}_pan', (0, 0.0, 0.38), (WID / 2 - 0.1, 2.75, 0.03), chamfer=0.0, material=M['trim']))
    for sx in (-1, 1):
        parts.append(H.hbox(f'{name}_cr{sx}', (sx * 0.45, 0.1, 0.3), (0.06, 2.7, 0.08), chamfer=0.01, material=M['trim']))
    for ay in AXLES:
        parts.append(H.rod(f'{name}_ax{ay}', (-0.82, ay, WHEEL_R), (0.82, ay, WHEEL_R), 0.045, material=M['trim']))
    parts.append(H.hcyl(f'{name}_diff', (0, AXLES[1], WHEEL_R), 0.15, 0.22, R=H.frame_z((0, 1, 0)), sides=20, chamfer=0.02,
                        material=M['trim']))
    parts.append(H.hbox(f'{name}_tank', (-0.55, 0.4, 0.3), (0.28, 0.55, 0.12), chamfer=0.04, material=M['trim']))
    parts.append(H.rod(f'{name}_ex', (0.6, -0.5, 0.26), (0.62, 2.95, 0.26), 0.035, material=M['chrome']))
    van = H.finish(parts, name, sharp_deg=40.0)
    if matrix is not None:
        van.matrix_world = matrix
        bpy.context.view_layer.objects.active = van
        bpy.ops.object.select_all(action='DESELECT')
        van.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return van


def _flush(name, pts, out, material, t=0.008):
    """A flush panel (glass, badge) on a flat face of the body: polygon `pts` (3D, on the face) raised by t along `out`, rim chamfered."""
    out = np.asarray(out, float)
    bm = bmesh.new()
    P = [np.asarray(p, float) for p in pts]
    nrm = np.cross(P[1] - P[0], P[2] - P[0])
    if nrm @ out < 0:
        P = P[::-1]
    vs = [bm.verts.new(Vector((p + out * t).tolist())) for p in P]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((-out * (t + 0.004)).tolist()), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    outer = [e for e in bm.edges if all(abs((np.array(v.co) - P[0] - out * t) @ out) < 1e-6 for v in e.verts)]
    bmesh.ops.bevel(bm, geom=outer, offset=min(0.006, t * 0.6), segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(material)
    return ob
