"""
Mio Kagari, 9. Itsuki's little sister, three years gone. Dressed the way he last saw her: a white
blouse with a round collar, a navy pinafore dress on crossed straps, white knee socks and red
strap shoes; the round yellow hat every child wears to school; the red randoseru on her back with
her little brass bell hanging from its side hook. Chestnut bob, a short fringe, two little pigtails
tied above her ears with yellow bobbles. Big brown eyes full of sparkles, round cheeks, blush.
(As the Little Bell, the same model is darkened by the game.)
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

PALETTE = {
    'eye_white': '#FCFAF6', 'eye_hi': '#FFFFFF', 'lash': '#2A1C1A', 'mouth': '#B0565A',
    'skin': '#F8DECB', 'hair': '#4A2E26', 'iris': '#8A5432', 'brow': '#4A2E26',
    'blouse': '#F4F2EC', 'dress': '#22305A', 'socks': '#F4F2EE', 'shoes': '#B32A2E', 'sole': '#3A1414',
    'hat': '#F2C23A', 'hatband': '#E9E4D8', 'bag': '#C0262C', 'bagtrim': '#8A1A1E', 'clasp': '#C8C8C8',
    'bell': '#D9B24E', 'cord': '#B3262B', 'bobble': '#F2C84A', '_blush': 0.85,
}


def build():
    P = B.Proportions(H=1.26, kind='child', shape={'waist': 1.05, 'depth': 1.05})
    C = B.Character('mio', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(
        jaw=0.12, width=1.04, cheek=0.95, chin_w=1.1, nose=0.5, nose_w=0.9, bridge=0.003, neck=0.85, eye_z=-0.16, mouth_z=-0.44, ear_size=1.05,
        eye=dict(w=0.1, h=0.122, tilt=-1, droop=0.25, iris=0.82, iris_tall=1.2, pupil=0.46, iris_fn=F.iris_sparkle(C.col('iris'), 0.46),
                 lash=1.0, lash_profile=(0.006, 0.016, 0.004), flick=(0.12, 0.14), lower='dots', crease=0.25,
                 highlights=((0.34, 0.46, 0.28, 0.3), (-0.36, -0.46, 0.13, 0.14), (0.5, -0.1, 0.07, 0.07), (-0.05, 0.62, 0.06, 0.06))),
        brow=dict(angle=-5, w=0.7, style='thin', arch=0.02, z=0.03),
        mouth=dict(w=0.05, smile=0.28, style='line', weight=0.0042),
    ))
    F.blush_hatch(C, count=3, length=0.05, width=0.007, spread=0.026, x=0.21, z=-0.3, angle=62)
    # ---------------------------------------------------------------------------------- hair
    L = []
    for i, a in enumerate(np.linspace(-50, 50, 11)):
        L.append(Hr.Clump(a, 0.12, 0.5 - 0.04 * (i % 2), 0.18, hug=0.62, out=0.07, drop=0.35, tip=0.42, thick=0.3, sweep=a / 50 * 0.15, bend=0.3))
    for a in (64, 84, 106, -64, -84, -106, 132, 156, 180, 204, 228):
        L.append(Hr.Clump(a, 0.24, 0.62, 0.21, hug=0.52, out=0.11, drop=0.95, tip=0.4, thick=0.3, bend=0.3, curl=0.12))
    for s in (1, -1):
        L.append(Hr.Clump(s * 100, 0.27, 0.72, 0.2, hug=0.05, out=0.32, drop=1.3, thick=0.5, tip=0.22, samples=16, sweep=s * 0.4, bend=0.25, curl=0.1))
    cap = Hr.cap(C, front=0.2, temple=-0.12, back=-0.36, grow=0.06, part=12, part_depth=0.25, part_len=0.4, back_bulge=0.03)
    Hr.build(C, L, cap, paint=Hr.painter(PALETTE['hair'], tips='#6A4434', band_z=0.24, band_color='#8A6A5A', under=0.5))
    for s in (1, -1):
        root = C.head.world(math.radians(s * 100), 0.27) + C.head.normal(math.radians(s * 100), 0.27) * 0.07 * u
        Hr.chain(C, root, root + V(s * 0.25, 0.1, -0.6) * u, n=2, prefix=f'hair_{"L" if s > 0 else "R"}')
        t = M.sphere(root, 0.06 * u, 10, 6).build(f'bobble{s}')
        M.finish(t, 1)
        C.add(t, 'bobble', 'hair')
    Pr.school_hat(C, 'hat', band='hatband', brim=0.04)
    # ---------------------------------------------------------------------------------- clothes
    K.shirt(C, 'blouse', top=P.neck_base + 0.012 * H, bottom=P.z_hip + 0.15 * H, grow=0.004)
    K.jacket(C, 'blouse', hem=P.z_hip + 0.16 * H, collar=None, buttons_col=None, grow=0.006, folds=False)
    # a round Peter Pan collar
    for s in (1, -1):
        def shape(fa, fz, s=s):
            return (s * (0.04 + fa * 0.9), -0.012 * H * (fa - 0.5) ** 2 * 4 * (1 - fz))
        K.panel(C, f'pcollar{s}', 0.0, 0.0, P.neck_base - 0.035 * H, P.neck_base + 0.006 * H, 0.012 * H, 'blouse', rows=6, cols=8, shape=shape, thick=0.004)
    # the pinafore: a skirt with a bib and crossed straps
    K.skirt(C, 'dress', top=P.z_hip + 0.17 * H, hem=P.z_knee + 0.03 * H, flare=1.12, pleats=10, depth=0.03)
    K.panel(C, 'bib', -0.5, 0.5, P.z_hip + 0.15 * H, P.z_sh - 0.07 * H, 0.016 * H, 'dress', rows=6, cols=8, thick=0.004)
    for s in (1, -1):
        K.strap(C, f'pstrap{s}', 'dress', s * 0.42, P.z_sh - 0.07 * H, s * math.radians(200), P.z_hip + 0.15 * H, 0.024 * H, 0.016 * H, thick=0.005,
                via=(s * 1.4, P.z_sh + 0.016 * H))
    K.tights(C, 'socks', top=P.z_knee + 0.035 * H)
    Pr.loafers(C, 'shoes', 'sole', heel=0.004)
    Pr.hands(C, 'skin', fist=0.35, nails='#F6D6D0')
    # the randoseru and the bell
    bc = V(0, 0.105 * H, P.z_hip + 0.2 * H)
    Pr.randoseru(C, bc, 0.23 * H, 0.1 * H, 0.26 * H, 'bag', trim='bagtrim', buckle='clasp')
    for s in (1, -1):
        K.strap(C, f'bagstrap{s}', 'bag', s * math.radians(150), P.z_sh + 0.014 * H, s * 0.6, P.z_hip + 0.12 * H, 0.024 * H, 0.02 * H, thick=0.007,
                via=(s * 1.15, P.z_sh + 0.016 * H))
    Pr.bell(C, bc + V(0.13 * H, 0.0, -0.08 * H), size=0.016)
    return C
