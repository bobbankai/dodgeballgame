"""
Commander Nyx's kit: HELIX temporal security command armour. Ethan's base layers in graphite (no plate carrier: she does not need one),
HELIX armour plates (two-layer pauldrons, a chest plate) in dark composite with crimson marks, chronal gauntlets on both forearms
burning crimson, and a high armoured collar instead of a helmet: her face is the point.
"""
import math

import numpy as np

import ethan_kit as EK
import hardsurface as HS
import helix_kit as HK
import sdf

EK.VARIANTS['nyx'] = ((0.035, 0.035, 0.038), (0.03, 0.03, 0.032), (0.045, 0.045, 0.048), (0.07, 0.072, 0.078), (0.3, 0.3, 0.32), (1.0, 0.12, 0.1))


def build_kit(h, rig, PH, P='nyx'):
    S = EK.build_kit(h, rig, PH, variant='nyx', P=P, carrier=False, helix=False, devices=(('l', True), ('r', True)))
    m = HK.mats(P, 'nyx')
    for sd in ('l', 'r'):
        HK.pauldron(S, P, m, sd, layers=2, big=1.05)
    HK.chest_plate(S, P, m)
    # a high armoured collar: a segmented band round the neck, open at the throat
    B = S.bones
    na, nb = np.array(B['neck_01'][0]), np.array(B['head'][0])
    Nf = HS.RadialField(S, na, nb - na, (1, 0, 0), -0.04, 0.08, n_theta=120, step_t=0.003, only=('neck', 'spine_03', 'clavicle'), r_max=0.16,
                        blur=6)
    Nf = Nf.view(Nf.theta_of((0, -1, 0)))
    Nf.r_ref = 0.065
    collar = sdf.intersect(HS.layer(Nf, 0.014, 0.007), HS.band(Nf, -0.035, 0.055), lambda P_: 0.035 - np.abs(Nf.coords(P_)[0]), k=0.004)
    collar = sdf.subtract(collar, sdf.union(*[HS.band(Nf, z - 0.0012, z + 0.0012) for z in (0.0, 0.025)]), k=0.0008)
    lo, hi = HS.bounds(Nf, -math.pi * Nf.r_ref, math.pi * Nf.r_ref, -0.045, 0.065, -0.005, 0.04)
    HK.make(S, f'{P}_collar_armour', collar, lo, hi, m['shell'], step=0.0013, tris=6000)
    return S
