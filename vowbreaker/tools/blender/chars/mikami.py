"""
Genjirō Mikami, 44. The teacher. Tall and lean and tired. A long charcoal coat worn open, with wide
notched lapels and a dark lining, over a black turtleneck; a long oxblood scarf wound twice and left
hanging; black leather gloves; grey trousers with a crease and scuffed boots. A pocket watch on a
chain across his waistcoat front (his technique is time, pooling). A white kitsune mask hangs at
his hip, red-marked. Dark hair going grey at the temples and tips, pushed back and tied in a short
low tail, a few strands loose over the brow. Stubble. Heavy lids, grey-blue eyes, bags under them.
"""
import math

import numpy as np

import vbbody as B
import vbcloth as K
import vbface as F
import vbhair as Hr
import vbmesh as M
import vbprops as Pr
from vbbody import V
from vbmesh import smooth

PALETTE = {
    'eye_white': '#F4F1EA', 'eye_hi': '#FFFFFF', 'lash': '#18161A', 'mouth': '#7E4A44',
    'skin': '#EDCBAF', 'hair': '#2A2A30', 'iris': '#6C8DA6', 'brow': '#2A2A30',
    'coat': '#2B2D33', 'lining': '#4A1E22', 'turtle': '#141418', 'vest': '#24262C', 'scarf': '#6E1E24',
    'pants': '#3A3B42', 'boots': '#1C1714', 'sole': '#0F0D0C', 'glove': '#141214', 'watch': '#C9B37A', 'chain': '#B8A878',
    'mask': '#F2EEE6', 'mask_mark': '#C2262B', 'tie': '#3A2A2A', 'button': '#2A2A2E', '_blush': 0.08,
}


def skin(C, X, N, part):
    """Stubble: a blue-grey shadow along the jaw, chin and upper lip."""
    P = C.P
    base = C.col('skin')
    q = (X - P.head_c) / P.u
    jaw = smooth(-0.3, -0.42, q[:, 2]) * smooth(-0.05, -0.2, q[:, 1]) * (q[:, 2] > -0.66)
    lip = np.exp(-((q[:, 2] + 0.385) / 0.022) ** 2) * np.exp(-(q[:, 0] / 0.08) ** 2) * (q[:, 1] < -0.3)
    k = np.clip(jaw * 0.35 + lip * 0.3, 0, 0.4) * (part.kind == 'face')
    st = V(0.42, 0.42, 0.48)
    return base[None] * (1 - k[:, None]) + (base * st)[None] * k[:, None]


def build():
    P = B.Proportions(H=1.86, kind='male', build=1.02, shape={'shoulders': 1.04, 'waist': 0.94, 'chest': 0.98, 'depth': 0.96})
    C = B.Character('mikami', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(
        jaw=0.88, width=0.92, cheek=0.15, cheekbone=0.7, temple=0.4, jaw_corner=0.45, chin_w=1.05, nose=1.15, bridge=0.012, brow_ridge=0.6,
        neck=1.02, adams_apple=True, skin_painter=skin, forehead=0.3,
        eye=dict(w=0.084, h=0.066, tilt=2, droop=0.3, lid_in=-0.1, iris=0.68, iris_tall=1.1, pupil=0.38, iris_fn=F.iris_dull(C.col('iris'), 0.38),
                 lash=0.85, lash_profile=(0.008, 0.017, 0.003), flick=(0.1, 0.05), lower='full', crease=0.9, crease_gap=0.008, bags=0.9,
                 lid_shadow=1.4, highlights=((0.36, 0.38, 0.18, 0.2), (-0.3, -0.45, 0.08, 0.08))),
        brow=dict(angle=-4, w=1.25, style='thick', arch=0.008, z=-0.01),
        mouth=dict(w=0.078, smile=-0.03, style='line', weight=0.0042),
    ))
    F.nose_shadow(C, side=-1, length=0.06, width=0.008)
    # ---------------------------------------------------------------------------------- hair
    L = []
    # combed back: clumps from the crown lying back over the skull toward the tie at the nape
    for i, a in enumerate(range(110, 251, 14)):
        L.append(Hr.Clump(a, 0.04 + 0.03 * (i % 2), 0.78, 0.22, hug=0.78, out=0.08, drop=0.5, bend=0.35, sweep=(a - 180) / 70 * -0.25))
    # the sides swept back over the ears
    for s_, a in ((1, 62), (1, 82), (-1, -62), (-1, -82)):
        L.append(Hr.Clump(a, 0.16, 0.7, 0.2, hug=0.72, out=0.06, drop=0.35, sweep=s_ * 0.75, bend=0.38))
    for a in (-100, 100):
        L.append(Hr.Clump(a, 0.3, 0.45, 0.17, hug=0.6, out=0.12, drop=0.8, bend=0.38, fork=1))
    # loose strands over the brow
    for s, a in ((1, 22), (-1, -14)):
        L.append(Hr.Clump(a, 0.1, 0.62, 0.07, hug=0.35, out=0.15, drop=0.85, sweep=s * 0.2, thick=0.4, bend=0.15, wave=0.02))
    tie_at = B.hp(P, 0, 0.56, -0.58)
    tail = Hr.ponytail(C, tie_at, 1.05, 0.16, n=4, spread=0.12, drop=1.0, tip=0.18, seed=4)
    cap = Hr.cap(C, front=0.24, temple=-0.06, back=-0.4, grow=0.055, crown_lift=0.01)
    Hr.build(C, L + [tail], cap, paint=Hr.painter(PALETTE['hair'], tips='#6A6A72', band_z=0.2, band_color='#55555E', under=0.5, streaks=0.5))
    Hr.chain(C, tie_at, B.hp(P, 0, 0.8, -1.7), n=2)
    tie = M.torus(tie_at, 0.06 * u, 0.022 * u, axis=(0, 0.35, -1), n=16, m=6).build('hairtie')
    M.finish(tie, 1)
    C.add(tie, 'tie', 'hair')
    # ---------------------------------------------------------------------------------- clothes
    K.shirt(C, 'turtle', top=P.neck_base + 0.035 * H, grow=0.004)
    roll = [np.stack([np.sin(a) * r, -np.cos(a) * r * 0.95 + 0.008 * H, np.full(len(a), P.neck_base + 0.03 * H + dz)], 1)
            for a in [np.linspace(0, 2 * math.pi, 40, endpoint=False)] for r, dz in ((0.038 * H, 0.0),)][0]
    K.piping(C, 'turtleroll', roll, 0.008 * H, 'turtle', n=8)
    vest_ob, _ = K.trunk(C, 'vest', 'vest', P.z_hip - 0.02 * H, P.z_sh - 0.02 * H, 0.008, open_front=0.0, rings=14, n=48, kind='torso')
    K.buttons(C, 'vestbuttons', 0.0, [P.z_sh - 0.08 * H - i * 0.045 * H for i in range(5)], 0.012 * H, 0.005 * H, 'button')
    coat, rings = K.long_coat(C, 'coat', hem=P.z_knee - 0.07 * H, open_front=0.06, collar=False, grow=0.016, back_slit=0.18, drape_count=7,
                              painter=K.lined(K.solid(PALETTE['coat'], 0.14), K.solid(PALETTE['lining'], 0.0)))
    K.lapels(C, 'coat', z_top=P.neck_base - 0.004 * H, z_bot=P.z_hip + 0.13 * H, grow=0.024, width=0.75,
             painter=K.solid(PALETTE['coat'], 0.1))
    # coat collar turned up at the back
    K.stand_collar(C, 'coat', height=0.034, open_front=0.9, grow=0.02, flare=0.014, name='coatcollar')
    K.scarf(C, 'scarf', grow=0.018, tails=((0.05, -0.32, 0.055), (-0.03, -0.22, 0.05)),
            painter=K.hem_band(K.stripes(PALETTE['scarf'], '#5A161C', period=0.02, width=0.25, axis='around'), '#2A0E10', 0.0, 0.0))
    # the pocket watch: a chain looping from a buttonhole to the vest pocket
    a0 = C.body.point(0.0, P.z_sh - 0.17 * H, 0.016 * H)
    a1 = C.body.point(0.55, P.z_hip + 0.08 * H, 0.016 * H)
    mid = (a0 + a1) / 2 + V(0, -0.012 * H, -0.035 * H)
    Pr.chain(C, [a0, mid, a1], 0.006 * H, 'chain')
    w = M.sphere(a1 + V(0, -0.006 * H, -0.004 * H), 0.016 * H, 14, 8, scale=(1, 0.4, 1), R=K.rot_to(C.body.normal(0.55, P.z_hip + 0.08 * H, 0))).build('watch')
    M.finish(w, 1)
    C.add(w, 'watch', 'torsopart', 'metal', line=0.5)
    K.pants(C, 'pants', crease=0.002, r=(0.054, 0.044, 0.038, 0.036))
    Pr.boots(C, 'boots', 'sole', height=0.1, straps=1, strap_col='boots', buckle='watch')
    Pr.hands(C, 'skin', fist=0.55, glove='glove')
    # the fox mask at his hip
    Pr.kitsune(C, V(0.17 * H, -0.075 * H, P.z_hip - 0.015 * H), 0.8 * u, facing=V(0.35, -1, 0), up=V(0.15, 0, 1))
    tie2 = M.tube([V(0.15 * H, -0.06 * H, P.z_hip + 0.03 * H), V(0.17 * H, -0.07 * H, P.z_hip + 0.01 * H)], [0.003 * H] * 2, n=6, samples=4).build('masktie')
    M.finish(tie2, 1)
    C.add(tie2, 'mask_mark', 'torsopart')
    return C
