"""
Director Soren Voss's clothes: the man who believes he is saving the future dresses like he already owns it. A tailored charcoal
coat (bridged over the body, closed, mandarin collar, a concealed placket, a HELIX pin in chronal cyan), matching trousers, a dark
knit under the collar, polished low oxfords. No armour anywhere: his weapon is the Engine.
"""
import math

import numpy as np

import ethan_kit as EK
import garments as Gm
import hardsurface as HS
import sdf


def materials(PH):
    return {
        'coat': Gm.pbr('voss_coat', PH, 'bi_stretch', tint=(0.05, 0.05, 0.054), tile=14, desat=0.0, normal_strength=1.1, rough_add=0.06),
        'knit': Gm.pbr('voss_knit', PH, 'cotton_jersey', tint=(0.02, 0.02, 0.022), tile=16, desat=0.0, normal_strength=1.2),
        'trousers': Gm.pbr('voss_trousers', PH, 'bi_stretch', tint=(0.045, 0.045, 0.048), tile=14, desat=0.0, normal_strength=1.0, rough_add=0.05),
        'leather': Gm.pbr('voss_shoe', PH, 'fabric_leather_02', tint=(0.03, 0.022, 0.018), tile=6, normal_strength=0.8, desat=0.3, coat=0.4,
                          rough_add=-0.1),
        'webbing': Gm.pbr('voss_lace', PH, 'hessian_230', tint=(0.02, 0.02, 0.02), tile=22, desat=0.0),
        'rubber': Gm.pbr('voss_sole', PH, 'fabric_leather_02', tint=(0.02, 0.016, 0.014), tile=8, desat=0.3),
        'pin': Gm.emissive('voss_pin', (0.35, 0.85, 1.0), 6.0),
    }


def build_kit(h, rig, PH, P='voss'):
    S = Gm.BodySpace(h, rig)
    mat = materials(PH)
    HS.DETAIL[0] = 1.0
    B = S.bones
    isb = S.is_bone
    C, t = S.centers, S.t
    hands = isb('hand_', 'index', 'middle', 'ring', 'pinky', 'thumb')
    feet = isb('foot_', 'ball_')
    calf = isb('calf_')
    lower = isb('lowerarm_')
    upper = isb('upperarm_')
    neck = isb('neck')
    head = isb('head')
    thighs = isb('thigh_')
    pelvis_z = B['pelvis'][0][2]
    torso = ~head & ~neck & ~hands & ~feet & ~upper & ~lower & ~thighs & ~calf
    Gm.shell(S, f'{P}_knit', (torso & (C[:, 2] > pelvis_z)) | (neck & (t < 0.3)), offset=0.003, thickness=0.0015, material=mat['knit'], subdiv=1)
    legs = (thighs | calf | (torso & (C[:, 2] <= pelvis_z + 0.07))) & ~(feet | (calf & (t > 0.92)))
    Gm.shell(S, f'{P}_trousers', legs, offset=0.016, thickness=0.0022, material=mat['trousers'], subdiv=1, smooth_iters=4)
    sleeves = upper | (lower & (t < 0.94))
    Gm.shell(S, f'{P}_sleeves', sleeves, offset=0.015, thickness=0.0026, material=mat['coat'], subdiv=1, smooth_iters=3)
    # the coat body: bridged over a blurred torso field, from mid-thigh to the collar, closed
    zc = B['clavicle_l'][0][2]
    loc, *_ = S.bvh.ray_cast((0, -0.6, zc - 0.12), (0, 1, 0), 1.2)
    loc2, *_ = S.bvh.ray_cast((0, 0.6, zc - 0.12), (0, -1, 0), 1.2)
    ymid = (loc.y + loc2.y) / 2 if loc is not None and loc2 is not None else 0.0
    arms = ('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'ring', 'pinky', 'thumb')
    hem_t = -0.27
    neck_t = B['neck_01'][0][2] - pelvis_z - 0.02
    F = HS.RadialField(S, (0.0, ymid, pelvis_z), (0, 0, 1), (1, 0, 0), hem_t - 0.02, neck_t + 0.04, n_theta=200, step_t=0.004, exclude=arms,
                       blur=16, theta0=-math.pi / 2, r_ref=0.15)
    flare = lambda s_, t_: 0.012 * np.clip(-t_ / 0.25, 0, 1)  # noqa: E731  the skirt stands off the legs a little more toward the hem
    coat = sdf.intersect(HS.layer(F, 0.017, 0.0035, flare), HS.band(F, hem_t, neck_t), k=0.004)
    # a short vent at the back of the skirt
    coat = sdf.subtract(coat, sdf.intersect(HS.band(F, hem_t - 0.01, hem_t + 0.16), lambda P_: np.abs(F.view(math.pi / 2).coords(P_)[0]) - 0.004), k=0.002)
    lo, hi = HS.bounds(F, -math.pi * F.r_ref, math.pi * F.r_ref, hem_t - 0.03, neck_t + 0.04, -0.01, 0.08)
    HS.make(S, f'{P}_coat', coat, lo, hi, mat['coat'], step=0.0018, tris=26000)
    # concealed placket line down the front, the HELIX pin on the left lapel
    plack = sdf.intersect(HS.layer(F, 0.0205, 0.0012), HS.band(F, hem_t + 0.01, neck_t - 0.02, 0.012, 0.016), k=0.0006)
    HS.make(S, f'{P}_placket', plack, lo, hi, mat['knit'], step=0.0009, tris=3000)
    pin = HS.solid_at(F, 0.07, neck_t - 0.11, 0.0215, sdf.cylinder((0, 0, 0), 0.006, 0.0015, 0.0005))
    HS.make(S, f'{P}_pin', pin, lo, hi, mat['pin'], step=0.0005, tris=400)
    # mandarin collar
    na, nb = np.array(B['neck_01'][0]), np.array(B['head'][0])
    Nf = HS.RadialField(S, na, nb - na, (1, 0, 0), -0.03, 0.06, n_theta=120, step_t=0.003, only=('neck',), r_max=0.12, blur=5)
    Nf = Nf.view(Nf.theta_of((0, -1, 0)))
    Nf.r_ref = 0.06
    # closed at the front except a 12 mm gap where the two collar ends meet
    collar = sdf.intersect(HS.layer(Nf, 0.012, 0.0035), HS.band(Nf, -0.02, 0.035), lambda P_: 0.006 - np.abs(Nf.coords(P_)[0]), k=0.003)
    lo2, hi2 = HS.bounds(Nf, -math.pi * Nf.r_ref, math.pi * Nf.r_ref, -0.03, 0.05, -0.005, 0.03)
    HS.make(S, f'{P}_collar', collar, lo2, hi2, mat['coat'], step=0.0012, tris=5000)
    for sd in ('l', 'r'):
        EK.boot(S, P, mat, sd, shaft_top=0.05)
    EK.hide_covered(h, S, ('foot_', 'ball_', 'pelvis', 'spine_01', 'spine_02', 'upperarm_', 'lowerarm_', 'thigh_', 'calf_'))
    return S
