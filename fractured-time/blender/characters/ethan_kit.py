"""
Ethan Vale's field kit: "dark practical operator kit" (docs/ART_DIRECTION.md) with HELIX chronal tech.

Layers, inside out:
  combat shirt (jersey torso, ripstop sleeves, mock-neck collar)  - fitted shells of the body (garments.shell), body UVs
  tactical trousers (twill), gloves                               - looser shells
  low-profile plate carrier: front + back plate bags, cummerbund, padded shoulder straps, MOLLE webbing, three magazine pouches,
  an admin pouch; belt with buckle; knee pads; combat boots (rubber lug sole + leather upper); chronal gauntlet on the left forearm
  with light-lines                                                - hard-surface SDF pieces (hardsurface.py), metric UVs
Every piece is skinned from the body, so it moves with the same skeleton.
"""
import math

import numpy as np

import garments as Gm
import hardsurface as HS
import sdf


VARIANTS = {
    # name: (base layer, trousers, load gear, armour base, armour edge, light colour)
    'ethan': None,
    'trooper': ((0.05, 0.052, 0.056), (0.07, 0.072, 0.075), (0.085, 0.09, 0.095), (0.3, 0.31, 0.33), (0.55, 0.56, 0.58), (1.0, 0.55, 0.15)),
    'operative': ((0.03, 0.03, 0.034), (0.035, 0.036, 0.04), (0.04, 0.042, 0.048), (0.06, 0.065, 0.075), (0.25, 0.26, 0.28), (0.35, 0.85, 1.0)),
    'heavy': ((0.045, 0.045, 0.05), (0.06, 0.06, 0.062), (0.07, 0.07, 0.072), (0.12, 0.12, 0.13), (0.35, 0.34, 0.33), (1.0, 0.18, 0.08)),
}


def materials(PH, variant='ethan'):
    m = {}
    v = VARIANTS.get(variant)
    # colour hierarchy: near-black base layer, charcoal trousers, ranger-green load-bearing gear, gunmetal hardware, cyan chronal light
    m['shirt'] = Gm.pbr('shirt', PH, 'cotton_jersey', tint=(0.04, 0.041, 0.044), tile=11, desat=0.0, normal_strength=1.2, rough_add=0.08)
    m['collar'] = Gm.pbr('collar', PH, 'scuba_suede', tint=(0.06, 0.063, 0.07), tile=10, desat=0.0)
    m['trousers'] = Gm.pbr('trousers', PH, 'denim_fabric', tint=(0.11, 0.112, 0.11), tile=8, desat=0.0, normal_strength=1.5, rough_add=0.1)
    m['gloves'] = Gm.pbr('gloves', PH, 'fabric_leather_02', tint=(0.055, 0.053, 0.05), tile=7, normal_strength=1.2, desat=0.25, rough_add=0.12)
    # metric-UV materials: tile = repeats per metre
    m['cordura'] = Gm.pbr('cordura', PH, 'hessian_230', tint=(0.085, 0.1, 0.07), tile=9, desat=0.0, normal_strength=1.6, rough_add=0.12)
    m['webbing'] = Gm.pbr('webbing', PH, 'hessian_230', tint=(0.07, 0.082, 0.058), tile=22, desat=0.0, normal_strength=1.8, rough_add=0.1)
    m['leather'] = Gm.pbr('boot_leather', PH, 'fabric_leather_02', tint=(0.1, 0.092, 0.085), tile=6, normal_strength=1.5, desat=0.3,
                          rough_add=0.18)
    m['rubber'] = Gm.pbr('rubber', PH, 'hessian_230', tint=(0.03, 0.03, 0.03), tile=30, desat=0.0, normal_strength=0.4, rough_add=0.2)
    m['plate'] = Gm.armour('gauntlet_shell', base=(0.05, 0.053, 0.058), edge=(0.2, 0.21, 0.22), wear=0.35, rough=0.52, coat=0.06)
    m['metal'] = Gm.armour('hardware', base=(0.04, 0.041, 0.043), edge=(0.2, 0.2, 0.21), wear=0.5, rough=0.5, coat=0.0)
    m['glow'] = Gm.emissive('chronal', (0.35, 0.85, 1.0), 16.0)
    if v is not None:
        base, legs, gear, arm_b, arm_e, light = v
        m['shirt'] = Gm.pbr(f'{variant}_suit', PH, 'stretch_poplin', tint=base, tile=9, desat=0.0, normal_strength=1.4, rough_add=0.08)
        m['trousers'] = Gm.pbr(f'{variant}_legs', PH, 'stretch_poplin', tint=legs, tile=8, desat=0.0, normal_strength=1.5, rough_add=0.1)
        m['cordura'] = Gm.pbr(f'{variant}_gear', PH, 'hessian_230', tint=gear, tile=9, desat=0.0, normal_strength=1.6, rough_add=0.12)
        m['webbing'] = Gm.pbr(f'{variant}_web', PH, 'hessian_230', tint=tuple(c * 0.8 for c in gear), tile=22, desat=0.0, normal_strength=1.8)
        m['plate'] = Gm.armour(f'{variant}_armour', base=arm_b, edge=arm_e, wear=0.35, rough=0.48, coat=0.1)
        m['glow'] = Gm.emissive(f'{variant}_light', light, 14.0)
    return m


def build_kit(h, rig, PH, variant='ethan', P='ethan', detail=1.0):
    """Ethan's kit, or a HELIX variant ('trooper', 'operative', 'heavy'): HELIX colours, helmet + visor, shoulder plates, armoured
    bracers on both forearms (no chronal device; operatives keep light-lines). Object names start with `P`_."""
    S = Gm.BodySpace(h, rig)
    mat = materials(PH, variant)
    helix = variant != 'ethan'
    # triangle budget: enemies are seen at gameplay distance (HS.make reads the scale)
    HS.DETAIL[0] = detail
    SUB = 1 if detail >= 0.99 else 0
    B = S.bones
    isb = S.is_bone
    N, C, t, own = S.normals, S.centers, S.t, S.owner
    hands = isb('hand_', 'index', 'middle', 'ring', 'pinky', 'thumb')
    feet = isb('foot_', 'ball_')
    calf = isb('calf_')
    lower = isb('lowerarm_')
    upper = isb('upperarm_')
    neck = isb('neck')
    head = isb('head')
    thighs = isb('thigh_')
    pelvis_z = B['pelvis'][0][2]

    # --- cloth layers ---------------------------------------------------------------------------------------------------
    boots_region = feet | (calf & (t > 0.78))
    gloves = hands | (lower & (t > 0.9))
    collar = neck & (t < 0.42)
    torso = ~head & ~neck & ~hands & ~feet & ~upper & ~lower & ~thighs & ~calf
    belt_z = pelvis_z + 0.07
    shirt = (torso & (C[:, 2] > belt_z - 0.07)) | (upper & (t < 0.3)) | (neck & (t < 0.3))  # overlaps sleeves, waistband, collar
    legs = (thighs | calf | (torso & (C[:, 2] <= belt_z + 0.01))) & ~boots_region
    sleeves = (upper | lower) & ~(hands | (lower & (t > 0.95)))  # overlaps the glove cuff
    # one continuous shirt shell (torso + sleeves): no seam edge across the shoulder
    Gm.shell(S, f'{P}_shirt', shirt | sleeves, offset=0.0045, thickness=0.0016, material=mat['shirt'], subdiv=SUB)
    Gm.shell(S, f'{P}_trousers', legs, offset=0.009, thickness=0.002, material=mat['trousers'], subdiv=SUB)
    # mock-neck collar: an SDF band round the neck (clean rolled top edge instead of a face-selection boundary)
    na, nb = np.array(B['neck_01'][0]), np.array(B['head'][0])
    Nf = HS.RadialField(S, na, nb - na, (1, 0, 0), -0.03, 0.07, n_theta=120, step_t=0.003, only=('neck',), r_max=0.12, blur=5)
    Nf = Nf.view(Nf.theta_of((0, -1, 0)))
    Nf.r_ref = 0.06
    ctop = 0.045
    collar_f = sdf.intersect(HS.layer(Nf, 0.003, 0.0045, lambda s_, t_: 0.003 * np.clip(1 - np.abs(t_ - (ctop - 0.006)) / 0.008, 0, 1)),
                             HS.band(Nf, -0.008, ctop), k=0.003)
    lo, hi = HS.bounds(Nf, -math.pi * Nf.r_ref, math.pi * Nf.r_ref, -0.03, ctop + 0.01, -0.005, 0.03)
    HS.make(S, f'{P}_collar', collar_f, lo, hi, mat['collar'], step=0.0014, tris=8000)
    Gm.shell(S, f'{P}_gloves', gloves, offset=0.0018, thickness=0.0016, material=mat['gloves'], subdiv=SUB)

    # --- torso field: spine axis through the middle of the chest ----------------------------------------------------------
    zc = B['clavicle_l'][0][2]
    z1 = B['spine_01'][0][2]
    loc, *_ = S.bvh.ray_cast((0, -0.6, zc - 0.12), (0, 1, 0), 1.2)
    loc2, *_ = S.bvh.ray_cast((0, 0.6, zc - 0.12), (0, -1, 0), 1.2)
    ymid = (loc.y + loc2.y) / 2 if loc is not None and loc2 is not None else 0.0
    origin = (0.0, ymid, pelvis_z)
    arms = ('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'ring', 'pinky', 'thumb')
    F = HS.RadialField(S, origin, (0, 0, 1), (1, 0, 0), -0.16, zc - pelvis_z + 0.06, n_theta=200, step_t=0.004, exclude=arms,
                       blur=7, theta0=-math.pi / 2, r_ref=0.15)
    Fb = F.view(math.pi / 2)  # arc measured from the back
    T = lambda z: z - pelvis_z  # noqa: E731  world z -> field t

    # --- plate carrier ---------------------------------------------------------------------------------------------------
    top = T(zc - 0.04)
    bot = T(z1 + 0.035)
    w2 = 0.135
    cut = 0.055
    plate_outline = [(-w2, bot), (w2, bot), (w2, top - cut), (w2 - cut * 0.85, top), (-w2 + cut * 0.85, top), (-w2, top - cut)]
    def pillow(s, t_):  # noqa: E306
        return 0.004 * np.clip(1 - (s / w2) ** 2, 0, 1) * np.clip(1 - ((t_ - (top + bot) / 2) / ((top - bot) / 2)) ** 2, 0, 1)
    off_c, th_c = 0.011, 0.022

    def plate_bag(field):
        bag = sdf.intersect(HS.layer(field, off_c, th_c, pillow), HS.outline(field, plate_outline), k=0.007)
        # stitched seam a few mm inside the edge on the outer face
        edge = HS.outline(field, plate_outline)
        seam = sdf.intersect(lambda P: np.abs(edge(P) + 0.007) - 0.0007,
                             HS.layer(field, off_c + th_c - 0.0012, 0.004))
        return sdf.subtract(bag, seam, k=0.0006)

    # MOLLE: three rows of 25 mm webbing across the lower front, bar-tacked every 38 mm (gaps)
    def molle(field, t_rows, s_half):
        rows = []
        for tr in t_rows:
            row = sdf.intersect(HS.layer(field, off_c + th_c - 0.0008, 0.0024), HS.band(field, tr - 0.0125, tr + 0.0125, -s_half, s_half), k=0.001)
            gaps = lambda P, tr=tr: _gap_field(field, P, 0.038, 0.0035)  # noqa: E731
            rows.append(sdf.subtract(row, gaps))
        return sdf.union(*rows)

    rows = [bot + 0.03 + 0.038 * i for i in range(3)]
    front = sdf.union(plate_bag(F), molle(F, rows, w2 - 0.01), k=0.0015)
    lo, hi = HS.bounds(F, -w2 - 0.01, w2 + 0.01, bot - 0.01, top + 0.01, -0.005, 0.05)
    HS.make(S, f'{P}_carrier_front', front, lo, hi, mat['cordura'], step=0.0016, tris=13000)
    back = plate_bag(Fb)
    lo, hi = HS.bounds(Fb, -w2 - 0.01, w2 + 0.01, bot - 0.01, top + 0.01, -0.005, 0.05)
    HS.make(S, f'{P}_carrier_back', back, lo, hi, mat['cordura'], step=0.0018, tris=8000)

    # cummerbund: elastic band round the sides, joining the plate bags, with its own webbing rows
    cb_lo, cb_hi = bot + 0.005, bot + 0.16
    s_side0, s_side1 = w2 - 0.03, math.pi * F.r_ref - w2 + 0.03
    cumm = []
    for sgn in (1, -1):
        s0, s1 = sorted((sgn * s_side0, sgn * s_side1))
        body = sdf.intersect(HS.layer(F, off_c + 0.002, 0.009), HS.band(F, cb_lo, cb_hi, s0, s1), k=0.004)
        web = sdf.union(*[sdf.intersect(HS.layer(F, off_c + 0.0102, 0.0022), HS.band(F, r - 0.0125, r + 0.0125, s0 + 0.02, s1 - 0.02), k=0.001)
                          for r in (cb_lo + 0.035, cb_lo + 0.075, cb_lo + 0.115)])
        cumm.append(sdf.union(body, web, k=0.001))
    cum = sdf.union(*cumm)
    lo, hi = HS.bounds(F, -math.pi * F.r_ref, math.pi * F.r_ref, cb_lo - 0.01, cb_hi + 0.01, -0.005, 0.03)
    HS.make(S, f'{P}_cummerbund', cum, lo, hi, mat['cordura'], step=0.0018, tris=11000)

    # magazine pouches (3) on the front webbing + an admin pouch on the upper chest
    def pouch(hw, hh, hd, flap=True):
        b = HS.rbox((hw, hh, hd), 0.006)
        if flap:
            f = sdf.box((0, hh - 0.018, 0.0015), (hw + 0.0015, 0.02, hd + 0.0012), 0.005)
            b = sdf.union(b, f, k=0.002)
            # flap edge line
            b = sdf.subtract(b, sdf.box((0, hh - 0.038, hd + 0.0015), (hw + 0.004, 0.0009, 0.004), 0.0), k=0.0006)
        return b
    pouches = []
    for sc in (-0.082, 0.0, 0.082):
        pouches.append(HS.solid_at(F, sc, bot + 0.075, off_c + th_c + 0.019, pouch(0.036, 0.068, 0.018)))
    pouches.append(HS.solid_at(F, 0.0, top - 0.085, off_c + th_c + 0.011, pouch(0.075, 0.045, 0.01)))
    pu = sdf.union(*pouches)
    lo, hi = HS.bounds(F, -w2, w2, bot - 0.01, top + 0.01, 0.0, 0.09)
    HS.make(S, f'{P}_pouches', pu, lo, hi, mat['cordura'], step=0.0015, tris=12000)

    # padded shoulder straps: front plate top corners, over the shoulders, to the back plate
    for sx in (1, -1):
        p0, *_ = F.point(sx * (w2 - cut * 0.85 - 0.02), top - 0.005, off_c + th_c * 0.5)
        p1, *_ = Fb.point(-sx * (w2 - cut * 0.85 - 0.02), top - 0.005, off_c + th_c * 0.5)
        cl = np.array(B['clavicle_l' if sx > 0 else 'clavicle_r'][1])
        mid = np.array([sx * 0.085, (p0[1] + p1[1]) / 2, cl[2] + 0.06])  # over the trapezius, near the neck
        guide = [p0 + (mid - p0) * k / 8 for k in range(8)] + [mid + (p1 - mid) * k / 8 for k in range(9)]
        Gm.path_line(S, guide, lift=0.006, name=f'{P}_strap_{"l" if sx > 0 else "r"}', radius=0.0035, width=0.04, material=mat['cordura'],
                     weight_bone='spine_03', center=(0, ymid, zc))

    # --- belt + buckle --------------------------------------------------------------------------------------------------
    tb = T(belt_z)
    belt = sdf.intersect(HS.layer(F, 0.012, 0.005), HS.band(F, tb - 0.021, tb + 0.021), k=0.0025)
    lo, hi = HS.bounds(F, -math.pi * F.r_ref, math.pi * F.r_ref, tb - 0.03, tb + 0.03, -0.005, 0.03)
    HS.make(S, f'{P}_belt', belt, lo, hi, mat['webbing'], step=0.0015, tris=5000)
    buckle = sdf.subtract(HS.rbox((0.032, 0.024, 0.006), 0.003), HS.rbox((0.022, 0.012, 0.01), 0.002), k=0.001)
    bk = HS.solid_at(F, 0.0, tb, 0.012 + 0.005 + 0.004, buckle)
    lo, hi = HS.bounds(F, -0.05, 0.05, tb - 0.04, tb + 0.04, 0.0, 0.04)
    HS.make(S, f'{P}_buckle', bk, lo, hi, mat['metal'], step=0.0008, tris=1500)

    # --- knee pads -------------------------------------------------------------------------------------------------------
    for sd in ('l', 'r'):
        a = (np.array(B[f'thigh_{sd}'][0]) + np.array(B[f'thigh_{sd}'][1])) / 2
        b = (np.array(B[f'calf_{sd}'][0]) + np.array(B[f'calf_{sd}'][1])) / 2
        ax = b - a
        knee_t = float(np.linalg.norm(np.array(B[f'calf_{sd}'][0]) - a))
        K = HS.RadialField(S, a, ax, (1, 0, 0), knee_t - 0.13, knee_t + 0.13, n_theta=120, step_t=0.004, only=(f'thigh_{sd}', f'calf_{sd}'), r_max=0.18, blur=4)
        K = K.view(K.theta_of((0, -1, 0)))
        K.r_ref = 0.06
        cap = sdf.intersect(HS.layer(K, 0.014, 0.016, lambda s, t_: 0.004 * np.clip(1 - (s / 0.06) ** 2, 0, 1)),
                            HS.outline(K, [(-0.058, knee_t - 0.085), (0.058, knee_t - 0.085), (0.062, knee_t + 0.07),
                                           (-0.062, knee_t + 0.07)]), k=0.008)
        ridge = sdf.intersect(HS.layer(K, 0.014 + 0.016, 0.003), HS.band(K, knee_t - 0.06, knee_t + 0.045, -0.012, 0.012), k=0.002)
        straps = sdf.union(*[sdf.intersect(HS.layer(K, 0.010, 0.0035), HS.band(K, tt - 0.011, tt + 0.011), k=0.0012)
                             for tt in (knee_t - 0.07, knee_t + 0.055)])
        pad = sdf.union(cap, ridge, straps, k=0.002)
        lo, hi = HS.bounds(K, -math.pi * K.r_ref, math.pi * K.r_ref, knee_t - 0.1, knee_t + 0.09, -0.01, 0.05)
        HS.make(S, f'{P}_kneepad_{sd}', pad, lo, hi, mat['webbing'], step=0.0016, tris=6000)

    # --- boots: a lofted last (cross-sections along the foot), a lug sole, a shaft fitted to the calf, padded collar, lacing ----------
    for sd in ('l', 'r'):
        ankle = np.array(B[f'foot_{sd}'][0])
        toe = np.array(B[f'ball_{sd}'][1])
        fwd = np.array([toe[0] - ankle[0], toe[1] - ankle[1], 0.0])
        fwd /= np.linalg.norm(fwd)
        side = np.cross(fwd, (0, 0, 1))
        heel = ankle - fwd * 0.075
        heel[2] = 0.0
        Lf = float((toe - heel) @ fwd) + 0.03

        def loc(P, heel=heel, fwd=fwd, side=side):
            q = P - heel
            return q @ fwd, q @ side, P[:, 2]
        fx = np.array([0.0, 0.03, 0.07, 0.12, 0.17, 0.21, 0.245, 1.0]) * 1.0
        fx[-1] = Lf
        fx[-2] = min(fx[-2], Lf - 0.02)
        halfw = sdf.curve(fx, [0.036, 0.042, 0.045, 0.049, 0.055, 0.056, 0.053, 0.036])
        ztop = sdf.curve([0.0, 0.08, 0.1, 0.14, 0.19, 0.23, Lf], [0.2, 0.17, 0.125, 0.1, 0.084, 0.072, 0.056])
        zbot = sdf.curve([0.0, 0.1, 0.16, Lf], [0.032, 0.03, 0.022, 0.028])  # heel block, forefoot, toe spring

        def last(P, loc=loc, Lf=Lf, halfw=halfw, ztop=ztop, zbot=zbot):
            x, y, z = loc(P)
            w, _ = halfw(x)
            zt, _ = ztop(x)
            zb, _ = zbot(x)
            hz = (zt - zb) / 2
            r = np.minimum(w, hz) * 0.75
            qy = np.abs(y) - (w - r)
            qz = np.abs(z - (zb + hz)) - (hz - r)
            d = np.sqrt(np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2) + np.minimum(np.maximum(qy, qz), 0) - r
            cap = np.maximum(-x, x - Lf)
            k = 0.032
            hh = np.clip(0.5 - 0.5 * (cap - d) / k, 0, 1)  # smooth max: rounded toe and heel
            return cap + (d - cap) * hh + k * hh * (1 - hh)

        def sole_f(P, loc=loc, Lf=Lf, halfw=halfw, zbot=zbot):
            x, y, z = loc(P)
            w, _ = halfw(np.clip(x, 0, Lf))
            zb, _ = zbot(np.clip(x, 0, Lf))
            dy = np.abs(y) - (w + 0.006)                        # welt: the sole stands out past the upper
            dx = np.maximum(-0.006 - x, x - Lf - 0.006)
            d2 = np.maximum(dy, dx)
            dz = np.maximum(-z, z - (zb + 0.002))
            d = np.maximum(d2, dz)
            lug = np.maximum(np.abs(((x * 45.0) % 1.0) - 0.5) / 45.0 - 0.004, z - 0.006)   # cleats across the tread
            mid = np.maximum(np.abs(z - 0.016) - 0.0008, -d2 - 0.0012)                      # midsole line round the side
            return np.maximum(np.maximum(d, -lug), -mid)

        Kc = HS.RadialField(S, B[f'calf_{sd}'][1], np.array(B[f'calf_{sd}'][0]) - np.array(B[f'calf_{sd}'][1]), (1, 0, 0), -0.03, 0.24,
                            n_theta=96, step_t=0.004, only=(f'calf_{sd}', f'foot_{sd}'), r_max=0.16, blur=3)
        Kc = Kc.view(Kc.theta_of((0, -1, 0)))
        Kc.r_ref = 0.05
        shaft = sdf.intersect(HS.layer(Kc, 0.007, 0.007, lambda s_, t_: 0.005 * np.clip((t_ - 0.15) / 0.02, 0, 1) * np.clip((0.19 - t_) / 0.02, 0, 1)),
                              HS.band(Kc, 0.03, 0.19), k=0.004)
        upper = sdf.intersect(sdf.union(last, shaft, k=0.03), lambda P, zbot=zbot, loc=loc: (zbot(loc(P)[0])[0] - 0.002) - P[:, 2])
        # tongue + laces up the front of the shaft, eyelets either side
        tongue = sdf.intersect(HS.layer(Kc, 0.012, 0.004), HS.band(Kc, 0.03, 0.2, -0.016, 0.016), k=0.003)
        laces = [HS.solid_at(Kc, 0.0, tt, 0.017, sdf.box((0, 0, 0), (0.019, 0.0018, 0.0016), 0.0012)) for tt in np.arange(0.045, 0.18, 0.024)]
        eyelets = [HS.solid_at(Kc, sx * 0.021, tt, 0.0145, sdf.cylinder((0, 0, 0), 0.0028, 0.0035, 0.0008))
                   for tt in np.arange(0.045, 0.18, 0.024) for sx in (-1, 1)]
        ends = np.array([heel, heel + fwd * Lf])
        lo = ends.min(0) - np.array([0.08, 0.08, 0.0])
        lo[2] = -0.002
        hi = ends.max(0) + np.array([0.08, 0.08, 0.0])
        hi[2] = ankle[2] + 0.22
        HS.make(S, f'{P}_boot_{sd}', sdf.union(upper, tongue, k=0.003), lo, hi, mat['leather'], step=0.002, tris=11000)
        HS.make(S, f'{P}_laces_{sd}', sdf.union(*laces, *eyelets), lo, hi, mat['webbing'], step=0.0009, tris=3000)
        HS.make(S, f'{P}_sole_{sd}', sole_f, lo, hi, mat['rubber'], step=0.0015, tris=7000)

    # the feet are inside the boots: hide them (review: mask modifier; export deletes them), no poke-through, no hidden triangles
    vg = h.vertex_groups.get('ft_hidden') or h.vertex_groups.new(name='ft_hidden')
    # ... and so is all skin under the clothes (dominant bone covered by a garment): poke-through cannot happen, fewer triangles.
    # The neck stays (the collar is open at the top) and so does a band at the top of the chest under the collar.
    covered = ('foot_', 'ball_', 'pelvis', 'spine_01', 'spine_02', 'upperarm_', 'lowerarm_', 'thigh_', 'calf_', 'hand_', 'index', 'middle',
               'ring', 'pinky', 'thumb')
    gname = {g.index: g.name for g in h.vertex_groups}
    neck_z = B['neck_01'][0][2]
    hide = []
    for v in h.data.vertices:
        best, bw = None, 0.0
        for ge in v.groups:
            nm = gname.get(ge.group, '')
            if ge.weight > bw and (nm in B):
                best, bw = nm, ge.weight
        if best is None:
            continue
        if best.startswith(covered) or (best.startswith(('spine_03', 'clavicle_')) and (h.matrix_world @ v.co).z < neck_z - 0.06):
            hide.append(v.index)
    vg.add(hide, 1.0, 'REPLACE')
    mk = h.modifiers.new('ft_hide', 'MASK')
    mk.vertex_group = 'ft_hidden'
    mk.invert_vertex_group = True

    # --- chronal gauntlet (left forearm) + plain bracer (right) ----------------------------------------------------------------
    for sd, device in ((('l', True), ('r', False)) if not helix else (('l', variant == 'operative'), ('r', variant == 'operative'))):
        a, b = np.array(B[f'lowerarm_{sd}'][0]), np.array(B[f'lowerarm_{sd}'][1])
        Lb = float(np.linalg.norm(b - a))
        G = HS.RadialField(S, a, b - a, (0, 0, 1), 0.0, Lb, n_theta=120, step_t=0.004, only=(f'lowerarm_{sd}', f'hand_{sd}'), r_max=0.12, blur=3)
        G = G.view(G.theta_of((0, 0, 1)))  # arc measured from the top of the forearm (A-pose)
        G.r_ref = 0.04
        t0, t1 = Lb * 0.3, Lb * 0.86
        shell_ = sdf.intersect(HS.layer(G, 0.0065, 0.009), HS.outline(G, [(-0.05, t0), (0.05, t0), (0.044, t1), (-0.044, t1)]), k=0.005)
        # cuff straps round the arm
        cuffs = sdf.union(*[sdf.intersect(HS.layer(G, 0.0055, 0.003), HS.band(G, tt - 0.008, tt + 0.008), k=0.001)
                            for tt in (t0 + 0.02, t1 - 0.02)])
        piece = sdf.union(shell_, cuffs, k=0.002)
        glow = None
        if device:
            # device housing with a recessed window (the glow panel sits in it)
            housing = HS.solid_at(G, 0.0, (t0 + t1) / 2, 0.0065 + 0.009 + 0.006,
                                  sdf.subtract(HS.rbox((0.024, 0.045, 0.007), 0.004), sdf.box((0, 0, 0.007), (0.017, 0.038, 0.002), 0.0015), k=0.001))
            groove = sdf.union(*[sdf.intersect(HS.layer(G, 0.0065 + 0.0075, 0.004), HS.band(G, t0 + 0.03, t1 - 0.03, sc - 0.0012, sc + 0.0012))
                                 for sc in (-0.034, 0.034)])
            piece = sdf.subtract(sdf.union(piece, housing, k=0.003), groove, k=0.0008)
            glow = sdf.union(
                *[sdf.intersect(HS.layer(G, 0.0065 + 0.0072, 0.0016), HS.band(G, t0 + 0.031, t1 - 0.031, sc - 0.0008, sc + 0.0008))
                  for sc in (-0.034, 0.034)],
                HS.solid_at(G, 0.0, (t0 + t1) / 2, 0.0065 + 0.009 + 0.006, sdf.box((0, 0, 0.0055), (0.015, 0.036, 0.0012), 0.001)))
        lo, hi = HS.bounds(G, -math.pi * G.r_ref, math.pi * G.r_ref, t0 - 0.02, t1 + 0.02, -0.01, 0.05)
        HS.make(S, f'{P}_gauntlet_{sd}', piece, lo, hi, mat['plate'], step=0.0012, tris=8000)
        if glow is not None:
            HS.make(S, f'{P}_glow_gauntlet_{sd}', glow, lo, hi, mat['glow'], step=0.0008, tris=2000)
    if helix:
        helix_armour(S, h, mat, P, variant)
    return S


def helix_armour(S, h, mat, P, variant):
    """HELIX security armour on top of the kit: full helmet (ellipsoid shell fitted to the head, face opening, visor band, rebreather),
    shoulder plates; heavies get bigger plates."""
    B = S.bones
    big = 1.25 if variant == 'heavy' else 1.0
    # head extents from the body faces owned by the head bone
    # the whole head (jaw included): everything above the base of the skull, minus the shoulders
    z0 = B['head'][0][2] - 0.07
    ztop = S.centers[:, 2].max()
    hm = (S.centers[:, 2] > z0) & (np.abs(S.centers[:, 0]) < 0.13)
    C = S.centers[hm]
    lo_h, hi_h = C.min(0), C.max(0)
    c = (lo_h + hi_h) / 2
    c[2] = (z0 + ztop) / 2 + 0.01
    rad = np.array([(hi_h[0] - lo_h[0]) / 2 + 0.026, (hi_h[1] - lo_h[1]) / 2 + 0.028, (ztop - z0) / 2 + 0.025])
    outer = sdf.ellipsoid(c, rad)
    shell_ = lambda P_: np.abs(outer(P_) + 0.005) - 0.005  # noqa: E731
    eye_z = c[2] - rad[2] * 0.05
    # face opening at the front, below the brow; the neck stays covered by a gorget band
    opening = sdf.box((c[0], c[1] - rad[1], eye_z - rad[2] * 0.42), (rad[0] * 0.62, rad[1] * 0.6, rad[2] * 0.42), 0.03)
    helmet = sdf.subtract(sdf.intersect(shell_, lambda P_: (c[2] - rad[2] * 0.95) - P_[:, 2]), opening, k=0.01)
    ridge = sdf.intersect(sdf.ellipsoid(c, rad * np.array([0.25, 1.03, 1.03])), lambda P_: P_[:, 2] - (c[2] + rad[2] * 0.2), k=0.01)
    helmet = sdf.union(helmet, sdf.intersect(ridge, lambda P_: np.abs(outer(P_)) - 0.016), k=0.006)
    lo, hi = c - rad - 0.05, c + rad + 0.05
    HS.make(S, f'{P}_helmet', helmet, lo, hi, mat['plate'], step=0.0022, tris=9000)
    # visor: dark glass filling the face opening (faceless and menacing), with a thin light slit at eye level in the archetype's colour
    glass = Gm.armour(f'{P}_visorglass', base=(0.012, 0.013, 0.015), edge=(0.05, 0.05, 0.055), wear=0.05, rough=0.12, coat=0.8)
    vis_shell = lambda P_: np.abs(sdf.ellipsoid(c, rad - 0.002)(P_)) - 0.004  # noqa: E731
    visor = sdf.intersect(vis_shell, sdf.offset(opening, 0.004), k=0.003)
    HS.make(S, f'{P}_visor', visor, lo, hi, glass, step=0.0016, tris=3000)
    slit = sdf.intersect(lambda P_: np.abs(sdf.ellipsoid(c, rad + 0.003)(P_)) - 0.002, lambda P_: np.abs(P_[:, 2] - (eye_z + 0.012)) - 0.006,
                         lambda P_: P_[:, 1] - (c[1] - rad[1] * 0.5), lambda P_: np.abs(P_[:, 0] - c[0]) - rad[0] * 0.55, k=0.002)
    HS.make(S, f'{P}_slit', slit, lo, hi, mat['glow'], step=0.0012, tris=1500)
    # rebreather: a rounded block over mouth and nose with two filter cans
    mz = eye_z - rad[2] * 0.62
    mask = sdf.union(sdf.ellipsoid((c[0], c[1] - rad[1] * 0.78, mz), (rad[0] * 0.55, rad[1] * 0.32, rad[2] * 0.34)),
                     sdf.cylinder((c[0] + 0.045, c[1] - rad[1] * 0.92, mz - 0.01), 0.022, 0.025, 0.005, R=sdf.rot(80, 0, 25)),
                     sdf.cylinder((c[0] - 0.045, c[1] - rad[1] * 0.92, mz - 0.01), 0.022, 0.025, 0.005, R=sdf.rot(80, 0, -25)), k=0.01)
    HS.make(S, f'{P}_mask', mask, lo - 0.05, hi, mat['metal'], step=0.0014, tris=4000)
    # shoulder plates (pauldrons) over the upper arms
    for sd in ('l', 'r'):
        a, b = np.array(B[f'upperarm_{sd}'][0]), np.array(B[f'upperarm_{sd}'][1])
        L = float(np.linalg.norm(b - a))
        F = HS.RadialField(S, a, b - a, (0, 0, 1), -0.04, L * 0.6, n_theta=96, step_t=0.004, only=(f'upperarm_{sd}', f'clavicle_{sd}'),
                           r_max=0.14, blur=4)
        F = F.view(F.theta_of((0, 0, 1)))
        F.r_ref = 0.05
        pl = sdf.intersect(HS.layer(F, 0.012, 0.012 * big, lambda s_, t_: 0.004 * np.clip(1 - (s_ / 0.07) ** 2, 0, 1)),
                           HS.outline(F, [(-0.075 * big, -0.03), (0.075 * big, -0.03), (0.06 * big, L * 0.45 * big), (-0.06 * big, L * 0.45 * big)]),
                           k=0.008)
        lo2, hi2 = HS.bounds(F, -0.12, 0.12, -0.05, L * 0.6, -0.01, 0.06)
        HS.make(S, f'{P}_pauldron_{sd}', pl, lo2, hi2, mat['plate'], step=0.0016, tris=4000)


def _gap_field(field, P, pitch, half):
    """Vertical slots every `pitch` metres of arc (MOLLE bar-tack gaps)."""
    s, _, _, _ = field.coords(P)
    q = (s / pitch) % 1.0
    return np.abs(q - 0.5) * pitch - (pitch / 2 - half)
