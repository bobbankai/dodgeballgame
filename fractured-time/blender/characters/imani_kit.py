"""
Dr. Imani Reyes's field kit: a lead temporal physicist who walked out of a collapsing HELIX lab and kept going.

Inside out: a charcoal fine-knit turtleneck (rolled collar); a slate-teal softshell field jacket, worn open over it, hip length, with a
stand collar, zip tapes down both edges, a chest pocket and shoulder seams; dark olive utility trousers with a thigh pocket; brown
leather ankle boots; a leather satchel on a crossbody strap; and her own instrument on the left forearm, a compact chronal scanner
with a cyan read-out (she measures what Ethan does). Hands and face stay bare.
"""
import math

import numpy as np

import ethan_kit as EK
import garments as Gm
import hardsurface as HS
import sdf


def materials(PH):
    return {
        'knit': Gm.pbr('imani_knit', PH, 'cotton_jersey', tint=(0.032, 0.032, 0.036), tile=14, desat=0.0, normal_strength=1.3, rough_add=0.1),
        'jacket': Gm.pbr('imani_jacket', PH, 'scuba_suede', tint=(0.05, 0.1, 0.108), tile=9, desat=0.0, normal_strength=1.25, rough_add=0.04),
        'trim': Gm.pbr('imani_trim', PH, 'stretch_poplin', tint=(0.02, 0.024, 0.026), tile=12, desat=0.0, normal_strength=1.2),
        'trousers': Gm.pbr('imani_trousers', PH, 'stretch_poplin', tint=(0.07, 0.068, 0.05), tile=8, desat=0.0, normal_strength=1.5, rough_add=0.1),
        'leather': Gm.pbr('imani_boot', PH, 'fabric_leather_02', tint=(0.11, 0.068, 0.042), tile=6, normal_strength=1.5, desat=0.15, rough_add=0.12),
        'bag': Gm.pbr('imani_bag', PH, 'fabric_leather_02', tint=(0.14, 0.088, 0.052), tile=5, normal_strength=1.4, desat=0.1, rough_add=0.05),
        'webbing': Gm.pbr('imani_web', PH, 'hessian_230', tint=(0.045, 0.045, 0.04), tile=22, desat=0.0, normal_strength=1.8),
        'rubber': Gm.pbr('imani_rubber', PH, 'hessian_230', tint=(0.03, 0.028, 0.026), tile=30, desat=0.0, normal_strength=0.4, rough_add=0.2),
        'plate': Gm.armour('imani_device', base=(0.07, 0.074, 0.08), edge=(0.3, 0.31, 0.32), wear=0.25, rough=0.4, coat=0.2),
        'metal': Gm.armour('imani_metal', base=(0.15, 0.15, 0.155), edge=(0.45, 0.45, 0.46), wear=0.3, rough=0.35, coat=0.0),
        'glow': Gm.emissive('imani_scan', (0.35, 0.85, 1.0), 10.0),
    }


def build_kit(h, rig, PH, P='imani'):
    S = Gm.BodySpace(h, rig)
    mat = materials(PH)
    HS.DETAIL[0] = 1.0
    B = S.bones
    isb = S.is_bone
    N, C, t = S.normals, S.centers, S.t
    hands = isb('hand_', 'index', 'middle', 'ring', 'pinky', 'thumb')
    feet = isb('foot_', 'ball_')
    calf = isb('calf_')
    lower = isb('lowerarm_')
    upper = isb('upperarm_')
    neck = isb('neck')
    head = isb('head')
    thighs = isb('thigh_')
    pelvis_z = B['pelvis'][0][2]
    ax = np.abs(C[:, 0])

    boots_region = feet | (calf & (t > 0.85))
    torso = ~head & ~neck & ~hands & ~feet & ~upper & ~lower & ~thighs & ~calf
    waist_z = pelvis_z + 0.06
    # turtleneck: torso + full sleeves (the jacket covers most of it; the sleeves end at the wrist)
    knit = (torso & (C[:, 2] > waist_z - 0.06)) | upper | (lower & (t < 0.97)) | (neck & (t < 0.25))
    Gm.shell(S, f'{P}_knit', knit, offset=0.0035, thickness=0.0016, material=mat['knit'], subdiv=1)
    legs = (thighs | calf | (torso & (C[:, 2] <= waist_z + 0.01))) & ~boots_region
    Gm.shell(S, f'{P}_trousers', legs, offset=0.014, thickness=0.0022, material=mat['trousers'], subdiv=1, smooth_iters=4)
    # the jacket sleeves: shells of the arms (they follow the arm); the body of the jacket is built below from a blurred torso field so
    # it bridges the hollows (between the breasts, the small of the back) the way cloth does, instead of clinging to every contour
    sleeves = upper | (lower & (t < 0.93))
    Gm.shell(S, f'{P}_sleeves', sleeves, offset=0.014, thickness=0.0026, material=mat['jacket'], subdiv=1, smooth_iters=3)
    hem_z = pelvis_z - 0.1
    # rolled turtleneck collar (a soft SDF band round the neck)
    na, nb = np.array(B['neck_01'][0]), np.array(B['head'][0])
    Nf = HS.RadialField(S, na, nb - na, (1, 0, 0), -0.03, 0.08, n_theta=120, step_t=0.003, only=('neck',), r_max=0.12, blur=5)
    Nf = Nf.view(Nf.theta_of((0, -1, 0)))
    Nf.r_ref = 0.055
    roll = lambda s_, t_: 0.006 * np.clip(1 - np.abs(t_ - 0.035) / 0.03, 0, 1)  # noqa: E731
    tn = sdf.intersect(HS.layer(Nf, 0.003, 0.006, roll), HS.band(Nf, -0.01, 0.062), k=0.004)
    lo, hi = HS.bounds(Nf, -math.pi * Nf.r_ref, math.pi * Nf.r_ref, -0.03, 0.075, -0.005, 0.035)
    HS.make(S, f'{P}_turtleneck', tn, lo, hi, mat['knit'], step=0.0013, tris=9000)
    # jacket stand collar: stands off the turtleneck, open at the front (|arc| < 2.8 cm from the front is cut away)
    collar_f = sdf.intersect(HS.layer(Nf, 0.017, 0.004), HS.band(Nf, -0.025, 0.038), lambda P: 0.028 - np.abs(Nf.coords(P)[0]), k=0.003)
    HS.make(S, f'{P}_jacket_collar', collar_f, lo, hi, mat['jacket'], step=0.0013, tris=6000)

    # torso field for the jacket details, the bag and the strap
    zc = B['clavicle_l'][0][2]
    loc, *_ = S.bvh.ray_cast((0, -0.6, zc - 0.12), (0, 1, 0), 1.2)
    loc2, *_ = S.bvh.ray_cast((0, 0.6, zc - 0.12), (0, -1, 0), 1.2)
    ymid = (loc.y + loc2.y) / 2 if loc is not None and loc2 is not None else 0.0
    arms = ('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'ring', 'pinky', 'thumb')
    F = HS.RadialField(S, (0.0, ymid, pelvis_z), (0, 0, 1), (1, 0, 0), -0.2, zc - pelvis_z + 0.06, n_theta=200, step_t=0.004,
                       exclude=arms, blur=7, theta0=-math.pi / 2, r_ref=0.15)
    T = lambda z: z - pelvis_z  # noqa: E731
    Fj = HS.RadialField(S, (0.0, ymid, pelvis_z), (0, 0, 1), (1, 0, 0), -0.2, zc - pelvis_z + 0.1, n_theta=200, step_t=0.004,
                        exclude=arms, blur=14, theta0=-math.pi / 2, r_ref=0.15)
    open_half = 0.045  # the jacket hangs open: 9 cm at the front
    neck_t = B['neck_01'][0][2] - pelvis_z - 0.02
    jacket = sdf.intersect(HS.layer(Fj, 0.016, 0.003), HS.band(Fj, T(hem_z), neck_t),
                           lambda P: open_half - np.abs(Fj.coords(P)[0]), k=0.004)
    lo_j, hi_j = HS.bounds(Fj, -math.pi * Fj.r_ref, math.pi * Fj.r_ref, T(hem_z) - 0.02, neck_t + 0.03, -0.01, 0.06)
    HS.make(S, f'{P}_jacket', jacket, lo_j, hi_j, mat['jacket'], step=0.0018, tris=24000)
    # finished edges: a hem tape round the bottom and up both front edges
    hem = sdf.intersect(HS.layer(Fj, 0.0175, 0.0022), sdf.union(HS.band(Fj, T(hem_z), T(hem_z) + 0.022),
                        lambda P: np.abs(np.abs(Fj.coords(P)[0]) - open_half - 0.011) - 0.011), HS.band(Fj, T(hem_z), neck_t),
                        lambda P: open_half - np.abs(Fj.coords(P)[0]), k=0.001)
    HS.make(S, f'{P}_jacket_hem', hem, lo_j, hi_j, mat['trim'], step=0.0012, tris=8000)
    # sleeve cuffs
    for sd in ('l', 'r'):
        a_, b_ = np.array(B[f'lowerarm_{sd}'][0]), np.array(B[f'lowerarm_{sd}'][1])
        Lb = float(np.linalg.norm(b_ - a_))
        G = HS.RadialField(S, a_, b_ - a_, (0, 0, 1), Lb * 0.8, Lb * 0.98, n_theta=72, step_t=0.004, only=(f'lowerarm_{sd}', f'hand_{sd}'), r_max=0.1,
                           blur=3)
        cuff = sdf.intersect(HS.layer(G, 0.0155, 0.003), HS.band(G, Lb * 0.9, Lb * 0.93), k=0.001)
        lo_c, hi_c = HS.bounds(G, -0.2, 0.2, Lb * 0.86, Lb * 0.96, -0.01, 0.04)
        HS.make(S, f'{P}_cuff_{sd}', cuff, lo_c, hi_c, mat['trim'], step=0.001, tris=2000)
    jo = 0.016 + 0.003  # outer face of the jacket above the body
    # zip tapes down both edges of the opening and a chest pocket with a zip
    tapes = sdf.union(*[sdf.intersect(HS.layer(Fj, jo - 0.0005, 0.0018), HS.band(Fj, T(hem_z) + 0.025, neck_t - 0.01, sx * (open_half + 0.004) - 0.0035,
                                                                                  sx * (open_half + 0.004) + 0.0035), k=0.0008) for sx in (-1, 1)])
    pocket = HS.solid_at(Fj, 0.085, T(zc) - 0.11, jo + 0.002, sdf.box((0, 0, 0), (0.055, 0.065, 0.003), 0.003))
    pzip = HS.solid_at(Fj, 0.085, T(zc) - 0.11 + 0.05, jo + 0.0045, sdf.box((0, 0, 0), (0.045, 0.002, 0.0012), 0.0008))
    lo2, hi2 = HS.bounds(F, -0.2, 0.2, T(hem_z) - 0.02, T(zc) + 0.04, -0.005, 0.05)
    HS.make(S, f'{P}_jacket_tapes', sdf.union(tapes, pzip), lo2, hi2, mat['trim'], step=0.0011, tris=5000)
    HS.make(S, f'{P}_jacket_pocket', pocket, lo2, hi2, mat['jacket'], step=0.0013, tris=3000)
    # satchel on the left hip, strap over the right shoulder
    bag = sdf.subtract(HS.rbox((0.12, 0.095, 0.035), 0.012), sdf.box((0, 0.045, 0.036), (0.125, 0.002, 0.004), 0.0), k=0.002)
    bag = sdf.union(bag, sdf.box((0, 0.05, 0.034), (0.122, 0.05, 0.004), 0.004), k=0.002)  # flap
    bag_f = HS.solid_at(F, 0.24, T(pelvis_z) - 0.02, jo + 0.04, bag)
    lo3, hi3 = HS.bounds(F, 0.05, 0.45, T(pelvis_z) - 0.15, T(pelvis_z) + 0.12, 0.0, 0.12)
    HS.make(S, f'{P}_satchel', bag_f, lo3, hi3, mat['bag'], step=0.0016, tris=6000)
    pa, *_ = F.point(0.2, T(pelvis_z) + 0.07, jo + 0.02)
    pb = np.array(B['clavicle_r'][1]) + np.array([0.0, -0.01, 0.045])
    pc_, *_ = F.view(math.pi / 2).point(0.12, T(zc) - 0.15, jo + 0.01)
    guide = [pa + (pb - pa) * k / 10 + np.array([0, -0.12, 0]) * math.sin(math.pi * k / 10) for k in range(11)]
    guide += [pb + (pc_ - pb) * k / 6 for k in range(1, 7)]
    Gm.path_line(S, guide, lift=jo + 0.004, name=f'{P}_strap', radius=0.0025, width=0.034, material=mat['bag'], weight_bone='spine_03',
                 center=(0, ymid, zc))
    # boots, bare-skin hiding under the clothes, the scanner on the left forearm (over the sleeve)
    for sd in ('l', 'r'):
        EK.boot(S, P, mat, sd, shaft_top=0.12)
    EK.hide_covered(h, S, ('foot_', 'ball_', 'pelvis', 'spine_01', 'spine_02', 'upperarm_', 'lowerarm_', 'thigh_', 'calf_'))
    EK.forearm_piece(S, P, mat, 'l', True, t0f=0.5, t1f=0.88)
    return S
