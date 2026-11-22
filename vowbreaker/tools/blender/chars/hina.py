"""
Hina Amagiri, 6. Sōjin's daughter, on the night of the lantern festival twenty years ago. An indigo
yukata printed with white and pale-blue morning glories, a yellow obi tied in a big butterfly bow,
red-strapped geta on bare feet; a round paper fan in her left hand. A short black bob with a blunt
fringe and a pink flower clip. Huge dark eyes, round cheeks, blush, a gap-toothed smile.
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
    'eye_white': '#FCFAF6', 'eye_hi': '#FFFFFF', 'lash': '#1E1418', 'mouth': '#B0565A',
    'skin': '#F9E0CC', 'hair': '#1E1820', 'iris': '#4A2E22', 'brow': '#1E1820',
    'yukata': '#2B3D78', 'petal': '#F4F2EE', 'petal2': '#A8C4F0', 'leaf': '#3A6A4A', 'obi': '#E8A42E', 'obi2': '#C8641E',
    'geta': '#C89A60', 'hanao': '#C8262C', 'flower': '#F09AB8', 'fan': '#F4EEE2', 'fanpaint': '#C8262C', 'wood': '#8A6A44',
    '_blush': 0.95,
}


def fan_paint(C, X, N, part):
    """A goldfish on the fan."""
    base = C.col('fan')
    hand = C.P.W[1]
    q = X - hand
    out = np.tile(base, (len(X), 1))
    d = np.linalg.norm(q - V(0.0, -0.02, 0.09) * C.P.H / 1.1, axis=1)
    fish = d < 0.025 * C.P.H / 1.1
    return np.where(fish[:, None], C.col('fanpaint')[None], out)


def build():
    P = B.Proportions(H=1.1, kind='child', head_scale=1.05, shape={'waist': 1.08, 'depth': 1.06})
    C = B.Character('hina', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(
        jaw=0.08, width=1.06, cheek=1.0, chin_w=1.15, nose=0.45, nose_w=0.9, bridge=0.002, neck=0.8, eye_z=-0.17, mouth_z=-0.45, ear_size=1.1,
        eye=dict(w=0.106, h=0.128, tilt=-2, droop=0.3, iris=0.84, iris_tall=1.18, pupil=0.5, iris_fn=F.iris_sparkle(C.col('iris'), 0.5),
                 lash=0.95, lash_profile=(0.006, 0.015, 0.004), flick=(0.1, 0.12), lower='dots', crease=0.15,
                 highlights=((0.32, 0.46, 0.3, 0.32), (-0.36, -0.46, 0.14, 0.15), (0.5, -0.12, 0.08, 0.08))),
        brow=dict(angle=-7, w=0.62, style='thin', arch=0.022, z=0.035),
        mouth=dict(w=0.046, smile=0.38, style='line', weight=0.0048),
    ))
    F.blush_hatch(C, count=4, length=0.055, width=0.007, spread=0.024, x=0.22, z=-0.3, angle=60)
    L = []
    for i, a in enumerate(np.linspace(-52, 52, 11)):
        L.append(Hr.Clump(a, 0.12, 0.46, 0.18, hug=0.64, out=0.06, drop=0.32, tip=0.55, thick=0.28, bend=0.25, sharp=0.15))
    for a in (60, 82, 104, 128, 152, 180, 208, 232, 256, 278, 300):
        L.append(Hr.Clump(a, 0.22, 0.58, 0.22, hug=0.52, out=0.1, drop=0.95, tip=0.5, thick=0.28, bend=0.25, curl=0.15))
    cap = Hr.cap(C, front=0.2, temple=-0.12, back=-0.38, grow=0.06, back_bulge=0.04)
    Hr.build(C, L, cap, paint=Hr.painter(PALETTE['hair'], band_z=0.24, band_color='#4A4058', under=0.45))
    fc = B.hp(P, 0.36, -0.08, 0.26)
    petals = [M.sphere(fc + V(math.cos(a) * 0.05, -0.015, math.sin(a) * 0.05) * u, 0.045 * u, 8, 6, scale=(1, 0.45, 1)).build(f'petal{i}')
              for i, a in enumerate(np.linspace(0, 2 * math.pi, 6)[:-1])]
    petals.append(M.sphere(fc + V(0, -0.03, 0) * u, 0.025 * u, 8, 6).build('fcentre'))
    fo = M.merge(petals, 'flower')
    M.finish(fo, 1)
    C.add(fo, 'flower', 'hair')
    yk = K.flowers(PALETTE['yukata'], PALETTE['petal'], PALETTE['petal2'], scale=0.075 * H / 1.1 * 1.1, density=0.75, leaf=PALETTE['leaf'])
    K.kimono(C, 'yukata', hem=P.z_ankle + 0.04 * H, sleeves='furisode', wide=0.045, drop=0.05, collar='yukata', under='petal', grow=0.012,
             hem_r=2.2, painter=yk, levels=2)
    obi_paint = K.stripes(PALETTE['obi'], PALETTE['obi2'], period=0.012, width=0.2, axis='z')
    K.obi(C, 'obi', height=0.075, grow=0.024, bow=True, painter=obi_paint)
    Pr.geta(C, 'geta', 'hanao', feet='skin')
    Pr.hands(C, 'skin', fist=0.3, nails='#F8DAD2')
    # the fan in her left hand
    d = P.dA[1]
    grip = P.W[1] + d * 0.055 * H
    Pr.uchiwa(C, grip, 0.1 * H, facing=V(0, -1, 0), up=-d, color='fan', handle='wood', kind='hand_L', painter=fan_paint)
    return C
