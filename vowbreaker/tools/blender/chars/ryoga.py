"""
Ryōga Hoshino, 17. The rival; raised by the Lantern Monk. Everything about him is a little too
sharp. A white jacket cut long to mid-thigh and split at the sides, violet lining, a high collar
with silver piping, silver buttons; a violet shirt; two chains hanging from his belt; a black
choker; one drop earring in his left ear; black fingerless gloves. White trousers tucked into
black buckled boots. Silver-white hair in an undercut, the long top swept across over his right
eye, the tips bled violet. Violet eyes with star-shaped pupils that glow when he brands someone,
a sharp V jaw and a smirk with one fang showing.
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
    'eye_white': '#FAF7F4', 'eye_hi': '#FFFFFF', 'lash': '#2A2236', 'mouth': '#8E4A50',
    'skin': '#F0D2BC', 'hair': '#D7D6E6', 'iris': '#9152D6', 'brow': '#B9B6CC', 'undercut': '#8F8CA6',
    'jacket': '#E9E7EE', 'lining': '#5A2E8A', 'pipe': '#B8BCC8', 'shirt': '#4A2A6E', 'pants': '#E3E1EA',
    'boots': '#1A1820', 'sole': '#0E0D11', 'button': '#B8BCC8', 'chain': '#A8ACB8', 'choker': '#141218',
    'earring': '#B8A2E8', 'glove': '#141218', 'belt': '#1A1820', 'buckle': '#C8CCD8', '_blush': 0.18,
}


def build():
    P = B.Proportions(H=1.77, kind='male', build=0.96, shape={'shoulders': 1.02, 'waist': 0.92, 'chest': 0.96, 'depth': 0.95})
    C = B.Character('ryoga', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(
        jaw=0.92, width=0.92, cheek=0.15, cheekbone=0.5, temple=0.35, chin_w=0.75, chin_fwd=0.3, nose=0.9, bridge=0.01, neck=0.98,
        adams_apple=True,
        eye=dict(w=0.092, h=0.078, tilt=13, droop=-0.45, top=0.1, iris=0.72, iris_tall=1.2, pupil=0.36,
                 iris_fn=F.iris_star(C.col('iris'), V(0.85, 0.65, 1.0), points=4, pupil=0.34, glow=0.55),
                 lash=1.05, lash_profile=(0.005, 0.018, 0.006), flick=(0.26, 0.3), lower='outer', crease=0.5,
                 highlights=((0.4, 0.4, 0.2, 0.22), (-0.32, -0.48, 0.09, 0.1))),
        brow=dict(angle=15, w=0.95, style='taper', arch=0.01, kink=0.01),
        mouth=dict(w=0.064, smile=0.02, style='smirk', smirk=0.016, weight=0.0042, fang=True),
    ))
    F.nose_shadow(C, side=-1, length=0.045)
    # ---------------------------------------------------------------------------------- hair
    L = []
    # the long top, swept across to his right and down over the right eye
    for i, a in enumerate(np.linspace(-18, 66, 9)):
        L.append(Hr.Clump(a, 0.03 + 0.025 * (i % 2), 0.82 - 0.1 * (i % 2) + 0.004 * a, 0.23, hug=0.44, out=0.15, drop=0.62, sweep=-0.45,
                          curl=0.05, fork=1 if i % 3 == 1 else 0, fork_spread=0.25, bend=0.45))
    for i, a in enumerate(range(96, 266, 24)):
        L.append(Hr.Clump(a, 0.1, 0.44, 0.22, hug=0.42, out=0.36, drop=0.4, sweep=-0.3, bend=0.42, fork=1 if i % 2 == 0 else 0))
    L.append(Hr.Clump(-36, 0.1, 0.9, 0.1, hug=0.4, out=0.15, drop=0.9, sweep=-0.3, thick=0.35, bend=0.25))
    top = Hr.cap(C, front=0.26, temple=0.04, back=-0.18, grow=0.05)
    Hr.build(C, L, top, paint=Hr.painter(PALETTE['hair'], tips='#8E63C9', band_z=0.22, band_color='#FFFFFF', band_amount=0.45, under=0.35,
                                          inner='#9A96B0'))
    # the shaved sides: a thin fuzz cap
    side = Hr.cap(C, front=0.12, temple=-0.14, back=-0.38, grow=0.008)
    C.add(side, 'undercut', 'hair', 'hair', line=0.6)
    Pr.earring(C, B.hp(P, 0.44, 0.05, -0.31), kind='hoop', r=0.022, drop=0.16)
    # ---------------------------------------------------------------------------------- clothes
    K.shirt(C, 'shirt', top=P.neck_base + 0.02 * H, grow=0.004)
    ch = [np.stack([np.sin(a) * 0.036 * H, -np.cos(a) * 0.034 * H + 0.008 * H, np.full(len(a), P.neck_base + 0.012 * H)], 1)
          for a in [np.linspace(0, 2 * math.pi, 40, endpoint=False)]][0]
    K.piping(C, 'choker', ch, 0.0042 * H, 'choker', n=6)
    lined = K.lined(K.solid(PALETTE['jacket'], 0.1), K.solid(PALETTE['lining'], 0.0))
    coat, rings = K.long_coat(C, 'jacket', hem=P.z_hip - 0.15 * H, open_front=0.035, collar=False, grow=0.012, hem_r=1.95, folds=0.025,
                              drape_count=5, painter=lined)
    # side splits up to the hip
    def split(Cc):
        a = np.arctan2(Cc[:, 0], -Cc[:, 1])
        return ~((np.abs(np.abs(a) - math.pi / 2) < 0.05) & (Cc[:, 2] < P.z_hip - 0.03 * H))
    M.delete_faces(coat, split)
    K.stand_collar(C, 'jacket', height=0.034, open_front=0.28, grow=0.016, flare=0.008, painter=lined)
    top_ring = [np.stack([np.sin(a) * (0.04 * H + 0.0064 * H + 0.008 * H), -np.cos(a) * (0.0544 * H) * 0.92 + 0.006 * H,
                          np.full(len(a), P.neck_base - 0.006 * H + 0.034 * H) - 0.008 * H * (np.cos(a) > 0.6)], 1)
                for a in [np.linspace(0.28, 2 * math.pi - 0.28, 40)]][0]
    K.piping(C, 'collarpipe', top_ring, 0.0022 * H, 'pipe', closed=False, n=5)
    K.piping(C, 'hempipe', rings[0], 0.0024 * H, 'pipe', closed=False, n=5)
    zs = [P.z_sh - 0.03 * H - i * 0.05 * H for i in range(6)]
    for s in (1,):
        obs = []
        for z in zs:
            w = 0.035 * H * (0.3 + 0.7 * smooth(P.z_sh, P.z_hip, z))
            W = C.body.dims(z)[0] + 0.012 * H
            a = float(np.arcsin(np.clip(w / W, 0, 0.9))) + 0.12
            p = C.body.point(a, z, 0.02 * H)
            obs.append(M.sphere(p, 0.0062 * H, 12, 8, scale=(1, 1, 0.5), R=K.rot_to(C.body.normal(a, z, 0.02 * H))).build('b'))
        bo = M.merge(obs, 'buttons')
        M.finish(bo, 1)
        C.add(bo, 'button', 'torsopart', 'metal', line=0.5)
    K.belt(C, P.z_hip + 0.04 * H, 'belt', buckle='buckle', width=0.024, grow=0.009)
    for j, (a0, a1, sag) in enumerate(((0.55, 1.2, 0.06), (0.75, 1.5, 0.09))):
        p0 = C.body.point(a0, P.z_hip + 0.035 * H, 0.016 * H)
        p1 = C.body.point(a1, P.z_hip + 0.035 * H, 0.016 * H)
        mid = (p0 + p1) / 2 + V(0, -0.01 * H, -sag * H)
        Pr.chain(C, [p0, mid, p1], 0.007 * H, 'chain', name=f'chain{j}')
    K.pants(C, 'pants', r=(0.052, 0.042, 0.036, 0.034), crease=0.0015)
    Pr.boots(C, 'boots', 'sole', height=0.15, straps=3, strap_col='boots', buckle='buckle')
    Pr.hands(C, 'skin', fist=0.75, glove='glove', fingerless=0.022)
    return C
