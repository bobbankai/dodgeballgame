"""
HELIX Security armour (the enemies' look), over the base kit (ethan_kit.build_kit with a HELIX variant).

Design: a tech corporation's paramilitary. Bone-white composite shells over graphite undersuits, HELIX orange for unit marks, faceless
smoked visors with a lit slit (orange trooper, cyan operative, red heavy). Silhouettes by role:
  trooper    standard helmet, two-layer pauldrons, a hard chest plate with the HELIX chevron
  operative  the same helmet with a cyan slit, no pauldron on the right, a single swept plate on the left: sleeker, faster
  heavy      bigger three-layer pauldrons with a raised collar, a heavier chest plate, a backpack power unit with vents
Every hard piece is listed in ARMOUR so the export can bake its mask texture (masks.py).
"""
import math

import numpy as np

import garments as Gm
import hardsurface as HS
import sdf

ARMOUR = []  # names of the armour objects (for the mask bake)


def mats(P, variant):
    light = {'trooper': (1.0, 0.45, 0.1), 'operative': (0.35, 0.85, 1.0), 'heavy': (1.0, 0.14, 0.06), 'nyx': (1.0, 0.12, 0.1),
             'marshal': (0.65, 0.4, 1.0)}[variant]
    m = {
        'shell': Gm.armour(f'{P}_shell', base=(0.5, 0.5, 0.48), edge=(0.72, 0.72, 0.7), wear=0.45, rough=0.5, coat=0.15, grooves=0.0),
        'under': Gm.armour(f'{P}_under', base=(0.05, 0.052, 0.056), edge=(0.25, 0.25, 0.26), wear=0.4, rough=0.45, coat=0.05, grooves=0.0),
        'mark': Gm.armour(f'{P}_mark', base=(0.62, 0.26, 0.05), edge=(0.7, 0.68, 0.64), wear=0.5, rough=0.5, coat=0.1, grooves=0.0),
        'glass': Gm.armour(f'{P}_visor', base=(0.01, 0.011, 0.013), edge=(0.04, 0.04, 0.045), wear=0.0, rough=0.08, coat=1.0, grooves=0.0),
        'glow': Gm.emissive(f'{P}_slit', light, 16.0),
    }
    import json
    for k in ('shell', 'under', 'mark'):
        r = json.loads(m[k]['ft'])
        r.update({'detail': 'painted_metal_shutter', 'detailScale': 2.2})
        m[k]['ft'] = json.dumps(r)
    if variant == 'marshal':
        # temporal enforcement: dark gunmetal shells, violet marks
        m['shell'] = Gm.armour(f'{P}_shell', base=(0.07, 0.07, 0.08), edge=(0.36, 0.35, 0.4), wear=0.35, rough=0.38, coat=0.3, grooves=0.0)
        m['mark'] = Gm.armour(f'{P}_mark', base=(0.22, 0.1, 0.42), edge=(0.5, 0.45, 0.6), wear=0.3, rough=0.4, coat=0.25, grooves=0.0)
        for k in ('shell', 'mark'):
            r = json.loads(m[k]['ft'])
            r.update({'detail': 'painted_metal_shutter', 'detailScale': 2.2})
            m[k]['ft'] = json.dumps(r)
    if variant == 'nyx':
        # command armour: dark composite with crimson marks
        m['shell'] = Gm.armour(f'{P}_shell', base=(0.055, 0.056, 0.062), edge=(0.32, 0.32, 0.34), wear=0.3, rough=0.4, coat=0.25, grooves=0.0)
        m['mark'] = Gm.armour(f'{P}_mark', base=(0.42, 0.04, 0.035), edge=(0.6, 0.5, 0.48), wear=0.35, rough=0.42, coat=0.2, grooves=0.0)
        for k in ('shell', 'mark'):
            r = json.loads(m[k]['ft'])
            r.update({'detail': 'painted_metal_shutter', 'detailScale': 2.2})
            m[k]['ft'] = json.dumps(r)
    if variant == 'operative':
        m['shell'] = Gm.armour(f'{P}_shell', base=(0.07, 0.075, 0.085), edge=(0.3, 0.31, 0.33), wear=0.35, rough=0.42, coat=0.2, grooves=0.0)
        m['mark'] = Gm.armour(f'{P}_mark', base=(0.04, 0.12, 0.16), edge=(0.3, 0.4, 0.45), wear=0.3, rough=0.4, coat=0.2, grooves=0.0)
        for k in ('shell', 'mark'):
            r = json.loads(m[k]['ft'])
            r.update({'detail': 'painted_metal_shutter', 'detailScale': 2.2})
            m[k]['ft'] = json.dumps(r)
    return m


def make(S, name, f, lo, hi, mat, step=0.0018, tris=6000):
    ob = HS.make(S, name, f, lo, hi, mat, step=step, tris=tris)
    if mat.get('ft') and '"armour"' in mat['ft']:
        ARMOUR.append(name)
    return ob


def helmet(S, P, m, variant):
    """The helmet: a sculpted dome with flattened sides, a brow ridge and a crest; a full-face smoked visor with a lit slit and a dark
    frame; cheek guards down to the jaw; a chin vent; a comms module; a two-layer neck guard."""
    B = S.bones
    z0 = B['head'][0][2] - 0.07
    ztop = S.centers[:, 2].max()
    hm = (S.centers[:, 2] > z0) & (np.abs(S.centers[:, 0]) < 0.13)
    C = S.centers[hm]
    lo_h, hi_h = C.min(0), C.max(0)
    c = (lo_h + hi_h) / 2
    c[2] = (z0 + ztop) / 2 + 0.012
    rad = np.array([(hi_h[0] - lo_h[0]) / 2 + 0.03, (hi_h[1] - lo_h[1]) / 2 + 0.032, (ztop - z0) / 2 + 0.03])
    lo, hi = c - rad - 0.06, c + rad + 0.06
    eye_z = c[2] - rad[2] * 0.08
    brow_z = eye_z + 0.03
    chin_z = c[2] - rad[2] * 0.92
    front_y = c[1] - rad[1]
    outer = sdf.ellipsoid(c, rad)
    # flat side faces (where the comms module and the cheek guards sit): cut the SOLID dome, then hollow it (cutting a thin shell would
    # leave the cut open)
    flats = [sdf.plane((c[0] + sx * rad[0] * 0.9, 0, 0), (sx, 0, 0)) for sx in (-1, 1)]
    solid = sdf.intersect(outer, *flats, k=0.008)
    shell = lambda P_: np.abs(solid(P_) + 0.006) - 0.006  # noqa: E731
    face_cut = sdf.box((c[0], front_y + rad[1] * 0.35, (brow_z + chin_z) / 2 - 0.02), (rad[0] * 0.66, rad[1] * 0.5, (brow_z - chin_z) / 2 + 0.03), 0.03)
    dome = sdf.subtract(sdf.intersect(shell, lambda P_: (c[2] - rad[2] * 0.82) - P_[:, 2], k=0.006), face_cut, k=0.008)
    # brow ridge: a thickened band just above the face opening (from the inner shell surface out to 14 mm proud of it)
    brow = sdf.intersect(lambda P_: outer(P_) - 0.014, lambda P_: -outer(P_) - 0.004,
                         sdf.box((c[0], front_y + 0.02, brow_z + 0.014), (rad[0] * 0.72, 0.05, 0.017), 0.008), k=0.004)
    crest = sdf.intersect(sdf.offset(outer, 0.01), sdf.box((c[0], c[1], c[2] + rad[2] * 0.4), (0.012, rad[1] * 0.9, rad[2] * 0.6), 0.004),
                          lambda P_: -(outer(P_) + 0.002), k=0.003)
    make(S, f'{P}_helmet', sdf.union(dome, brow, crest, k=0.004), lo, hi, m['shell'], step=0.0016, tris=12000)
    # cheek guards: down from the flat sides to the jaw, wrapping toward the chin
    cheeks = []
    for sx in (-1, 1):
        g = sdf.intersect(sdf.offset(sdf.ellipsoid(c, rad * np.array([1.0, 1.0, 1.06])), 0.002),
                          lambda P_, sx=sx: -(sdf.ellipsoid(c, rad * np.array([1.0, 1.0, 1.06]))(P_) + 0.009),
                          sdf.box((c[0] + sx * rad[0] * 0.7, front_y + rad[1] * 0.55, (eye_z + chin_z) / 2 - 0.015), (rad[0] * 0.32, rad[1] * 0.5,
                                  (eye_z - chin_z) / 2 + 0.02), 0.012), k=0.004)
        cheeks.append(g)
    make(S, f'{P}_cheeks', sdf.union(*cheeks), lo, hi, m['under'], step=0.0016, tris=5000)
    # the visor: smoked glass across the whole face, a trapezoid (wide at the eyes, narrower at the chin), in a dark frame
    vis_e = sdf.ellipsoid((c[0], c[1] + 0.006, c[2]), rad * np.array([0.97, 1.0, 0.98]))
    vshape = lambda P_: np.maximum(np.abs(P_[:, 0] - c[0]) - (rad[0] * (0.42 + 0.22 * np.clip((P_[:, 2] - chin_z) / (brow_z - chin_z), 0, 1))),  # noqa: E731
                                   np.maximum(P_[:, 2] - brow_z, chin_z + 0.012 - P_[:, 2]))
    front = lambda P_: P_[:, 1] - (c[1] - rad[1] * 0.3)  # noqa: E731
    visor = sdf.intersect(lambda P_: np.abs(vis_e(P_)) - 0.003, vshape, front, k=0.003)
    make(S, f'{P}_visor', visor, lo, hi, m['glass'], step=0.0013, tris=5000)
    frame = sdf.intersect(lambda P_: np.abs(vis_e(P_)) - 0.006, lambda P_: np.abs(vshape(P_) + 0.004) - 0.005, front, k=0.002)
    make(S, f'{P}_visorframe', frame, lo, hi, m['under'], step=0.0012, tris=4000)
    # the slit sits on the glass surface (the glass is opaque smoked composite), a 9 mm band at eye level
    slit = sdf.intersect(lambda P_: np.abs(vis_e(P_) - 0.0038) - 0.0012,
                         lambda P_: np.abs(P_[:, 2] - (eye_z + 0.006)) - 0.0045,
                         lambda P_: np.abs(P_[:, 0] - c[0]) - rad[0] * 0.5, front, k=0.0015)
    HS.make(S, f'{P}_slit', slit, lo, hi, m['glow'], step=0.001, tris=1500)
    # chin vent grille and the comms module on the left side
    vent = sdf.subtract(sdf.box((c[0], front_y + 0.045, chin_z + 0.014), (0.026, 0.014, 0.011), 0.005),
                        sdf.union(*[sdf.box((c[0], front_y + 0.032, chin_z + 0.008 + k * 0.007), (0.02, 0.008, 0.0016), 0.0) for k in range(3)]), k=0.001)
    comms = sdf.union(sdf.cylinder((c[0] + rad[0] * 0.93, c[1] + 0.005, eye_z), 0.026, 0.012, 0.004, R=sdf.rot(0, 90, 0)),
                      sdf.cylinder((c[0] + rad[0] * 0.95, c[1] + 0.02, eye_z + 0.07), 0.0035, 0.05, 0.001), k=0.004)
    make(S, f'{P}_helmetparts', sdf.union(vent, comms, k=0.002), lo - 0.03, hi + 0.06, m['under'], step=0.0012, tris=4000)


def pauldron(S, P, m, sd, layers=2, big=1.0, swept=False):
    B = S.bones
    a, b = np.array(B[f'upperarm_{sd}'][0]), np.array(B[f'upperarm_{sd}'][1])
    L = float(np.linalg.norm(b - a))
    F = HS.RadialField(S, a, b - a, (0, 0, 1), -0.05, L * 0.62, n_theta=96, step_t=0.004, only=(f'upperarm_{sd}', f'clavicle_{sd}'), r_max=0.15,
                       blur=4)
    F = F.view(F.theta_of((0, 0, 1)))
    F.r_ref = 0.05
    plates = []
    for k in range(layers):
        off = 0.012 + 0.012 * (layers - 1 - k)
        t0 = -0.035 + k * 0.055 * big
        t1 = L * (0.36 + 0.06 * k) * big
        w = (0.08 - 0.006 * k) * big
        outline = [(-w, t0), (w, t0), (w * 0.82, t1), (-w * 0.82, t1)] if not swept else [(-w * 0.6, t0), (w, t0), (w * 0.9, t1 * 1.1), (-w * 0.3, t1)]
        pl = sdf.intersect(HS.layer(F, off, 0.009 * big, lambda s_, t_: 0.004 * np.clip(1 - (s_ / 0.07) ** 2, 0, 1)), HS.outline(F, outline), k=0.006)
        plates.append(pl)
    lo2, hi2 = HS.bounds(F, -0.14, 0.14, -0.06, L * 0.7, -0.01, 0.08)
    make(S, f'{P}_pauldron_{sd}', sdf.union(*plates, k=0.002), lo2, hi2, m['shell'], step=0.0015, tris=6000)


def chest_plate(S, P, m, heavy=False):
    """A hard chest plate over the carrier, with the HELIX chevron raised in the unit colour."""
    B = S.bones
    pelvis_z = B['pelvis'][0][2]
    zc = B['clavicle_l'][0][2]
    z1 = B['spine_01'][0][2]
    loc, *_ = S.bvh.ray_cast((0, -0.6, zc - 0.12), (0, 1, 0), 1.2)
    loc2, *_ = S.bvh.ray_cast((0, 0.6, zc - 0.12), (0, -1, 0), 1.2)
    ymid = (loc.y + loc2.y) / 2 if loc is not None and loc2 is not None else 0.0
    arms = ('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'ring', 'pinky', 'thumb')
    F = HS.RadialField(S, (0.0, ymid, pelvis_z), (0, 0, 1), (1, 0, 0), -0.16, zc - pelvis_z + 0.06, n_theta=200, step_t=0.004, exclude=arms,
                       blur=8, theta0=-math.pi / 2, r_ref=0.15)
    top, bot = zc - pelvis_z - 0.035, z1 - pelvis_z + 0.08
    w = 0.15 if heavy else 0.13
    off = 0.036 if heavy else 0.034  # over the carrier's plate bag
    outline = [(-w, bot), (w, bot), (w, top - 0.06), (w - 0.05, top), (-w + 0.05, top), (-w, top - 0.06)]
    plate = sdf.intersect(HS.layer(F, off, 0.011 if heavy else 0.008, lambda s_, t_: 0.005 * np.clip(1 - (s_ / w) ** 2, 0, 1)), HS.outline(F, outline),
                          k=0.007)
    lo, hi = HS.bounds(F, -w - 0.02, w + 0.02, bot - 0.02, top + 0.02, 0.0, 0.08)
    make(S, f'{P}_chestplate', plate, lo, hi, m['shell'], step=0.0016, tris=7000)
    tc = (top + bot) / 2 + 0.02
    chev = sdf.union(*[HS.solid_at(F, sx * 0.022, tc, off + (0.011 if heavy else 0.008) + 0.001,
                                   sdf.box((0, 0, 0), (0.028, 0.006, 0.0016), 0.001, R=sdf.rot(0, 0, sx * 35))) for sx in (-1, 1)])
    make(S, f'{P}_chevron', chev, lo, hi, m['mark'], step=0.0008, tris=1500)


def backpack(S, P, m):
    """Heavy only: a power unit on the back (chamfered housing, vent fins, a status light)."""
    B = S.bones
    z = (B['spine_02'][0][2] + B['spine_03'][0][2]) / 2
    loc, *_ = S.bvh.ray_cast((0, 0.6, z), (0, -1, 0), 1.2)
    y = (loc.y if loc is not None else 0.12) + 0.075
    housing = sdf.box((0, y, z), (0.13, 0.06, 0.17), 0.02)
    fins = sdf.union(*[sdf.box((0, y + 0.06, z - 0.1 + k * 0.04), (0.11, 0.008, 0.006), 0.002) for k in range(6)])
    make(S, f'{P}_backpack', sdf.subtract(housing, sdf.box((0, y + 0.065, z), (0.1, 0.02, 0.13), 0.004), k=0.003), (-0.2, y - 0.1, z - 0.25),
         (0.2, y + 0.12, z + 0.25), m['shell'], step=0.0018, tris=5000)
    make(S, f'{P}_backpackfins', fins, (-0.2, y - 0.1, z - 0.25), (0.2, y + 0.12, z + 0.25), m['under'], step=0.0012, tris=3000)
    HS.make(S, f'{P}_backlight', sdf.box((0.1, y + 0.062, z + 0.15), (0.012, 0.004, 0.006), 0.002), (-0.2, y - 0.1, z - 0.25), (0.2, y + 0.12, z + 0.25),
            m['glow'], step=0.001, tris=400)


def rift_blades(S, P, m):
    """The Marshal's weapons: a blade along the outside of each forearm, its edge burning violet."""
    B = S.bones
    for sd, sx in (('l', 1), ('r', -1)):
        a, b = np.array(B[f'lowerarm_{sd}'][0]), np.array(B[f'lowerarm_{sd}'][1])
        L = float(np.linalg.norm(b - a))
        G = HS.RadialField(S, a, b - a, (0, 0, 1), 0.0, L, n_theta=96, step_t=0.004, only=(f'lowerarm_{sd}', f'hand_{sd}'), r_max=0.12, blur=3)
        G = G.view(G.theta_of((sx, 0, 0)))
        G.r_ref = 0.04
        # a long fin standing off the forearm, sweeping past the wrist
        fin = sdf.intersect(HS.layer(G, 0.012, 0.075, lambda s_, t_: 0.035 * np.clip((t_ - L * 0.3) / (L * 0.7), 0, 1)),
                            HS.band(G, L * 0.2, L * 1.05, -0.006, 0.006), k=0.003)
        lo, hi = HS.bounds(G, -0.1, 0.1, L * 0.1, L * 1.15, -0.01, 0.15)
        make(S, f'{P}_blade_{sd}', fin, lo, hi, m['shell'], step=0.0016, tris=4000)
        edge = sdf.intersect(HS.layer(G, 0.012 + 0.075 - 0.004, 0.006, lambda s_, t_: 0.035 * np.clip((t_ - L * 0.3) / (L * 0.7), 0, 1)),
                             HS.band(G, L * 0.25, L * 1.03, -0.0035, 0.0035), k=0.002)
        HS.make(S, f'{P}_bladeglow_{sd}', edge, lo, hi, m['glow'], step=0.0012, tris=1500)


def armour(S, h, base_mat, P, variant):
    ARMOUR.clear()
    m = mats(P, variant)
    helmet(S, P, m, variant)
    if variant == 'operative':
        pauldron(S, P, m, 'l', layers=1, swept=True)
    else:
        big = {'heavy': 1.25, 'marshal': 1.15}.get(variant, 1.0)
        for sd in ('l', 'r'):
            pauldron(S, P, m, sd, layers=3 if variant in ('heavy', 'marshal') else 2, big=big)
        chest_plate(S, P, m, heavy=variant == 'heavy')
    if variant == 'heavy':
        backpack(S, P, m)
    if variant == 'marshal':
        rift_blades(S, P, m)
    return m
