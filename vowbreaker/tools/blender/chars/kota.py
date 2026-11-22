"""
Kōta Tachibana, 8. Sayo's twin, born without cursed energy, given to Shiragami as the price of a vow.
Dressed for the offering: a plain white kimono with a pale grey underlayer, a white sash hung with
zigzag shide streamers, a twisted straw rope round his waist, white tabi and straw zori. A paper
crane cupped in his hands -- he folded two that night; Sayo has the other. Black hair like hers, cut
in a neat bowl with a few strands escaping. Her violet eyes, gone quiet and dull.
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
    'eye_white': '#F6F4F0', 'eye_hi': '#F4F2FF', 'lash': '#1A161C', 'mouth': '#9A5A5E',
    'skin': '#F4DCC8', 'hair': '#16131A', 'iris': '#5A4A6E', 'brow': '#16131A',
    'kimono': '#F1EFEA', 'under': '#C8C6C2', 'sash': '#E8E6E0', 'rope': '#C8B07A', 'shide': '#FAF8F2',
    'tabi': '#F2F0EA', 'zori': '#C8B07A', 'strap': '#E8E6E0', 'crane': '#F2EEE6', '_blush': 0.55,
}


def build():
    P = B.Proportions(H=1.2, kind='child', shape={'waist': 1.02})
    C = B.Character('kota', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(
        jaw=0.15, width=1.0, cheek=0.75, chin_w=1.0, nose=0.55, bridge=0.003, neck=0.82, eye_z=-0.16, mouth_z=-0.44,
        eye=dict(w=0.098, h=0.108, tilt=0, droop=0.35, iris=0.78, iris_tall=1.15, pupil=0.42, iris_fn=F.iris_dull(C.col('iris'), 0.42),
                 lash=0.85, flick=(0.08, 0.06), lower='outer', crease=0.2, lid_shadow=1.3,
                 highlights=((0.36, 0.42, 0.16, 0.18),)),
        brow=dict(angle=-8, w=0.75, style='thin', arch=0.012, z=0.02),
        mouth=dict(w=0.044, smile=-0.04, style='line', weight=0.0038),
    ))
    L = []
    for i, a in enumerate(np.linspace(-48, 48, 11)):
        L.append(Hr.Clump(a, 0.1, 0.48, 0.18, hug=0.7, out=0.05, drop=0.25, tip=0.6, thick=0.28, bend=0.25, sharp=0.15))
    for a in range(64, 300, 22):
        L.append(Hr.Clump(a, 0.2, 0.46, 0.21, hug=0.62, out=0.07, drop=0.7, tip=0.55, thick=0.28, bend=0.25))
    L.append(Hr.Clump(-20, 0.08, 0.6, 0.06, hug=0.45, out=0.12, drop=0.85, thick=0.35, bend=0.15))
    L.append(Hr.Clump(150, 0.05, 0.28, 0.12, hug=0.1, out=0.8, drop=0.4, bend=0.3, avoid=False))
    cap = Hr.cap(C, front=0.2, temple=-0.1, back=-0.32, grow=0.06)
    Hr.build(C, L, cap, paint=Hr.painter(PALETTE['hair'], band_z=0.23, band_color='#3A3648', under=0.5))
    K.kimono(C, 'kimono', hem=P.z_ankle + 0.03 * H, sleeves='standard', wide=0.025, drop=0.03, collar='kimono', under='under', grow=0.012,
             hem_r=2.0, painter=K.solid(PALETTE['kimono'], 0.1))
    z = P.z_hip + 0.1 * H
    K.obi(C, 'sash', z=z, height=0.05, grow=0.022, bow=False)
    rope = C.body.ring(z - 0.03 * H, 40, 0.034 * H)
    Pr.shimenawa(C, np.vstack([rope, rope[:1]]), 0.007 * H, 'rope', twist=14.0, name='rope')
    for k, a in enumerate((-0.9, -0.3, 0.3, 0.9, 2.5, 3.8)):
        at = C.body.point(a, z - 0.04 * H, 0.04 * H)
        out = C.body.normal(a, z - 0.04 * H, 0.04 * H)
        Pr.shide(C, at, 0.05 * H, down=(0, 0, -1), out=out, color='shide', name=f'shide{k}')
    Pr.zori(C, 'zori', 'strap', tabi=PALETTE['tabi'])
    Pr.hands(C, 'skin', fist=0.25, nails='#F6D6D0')
    # the crane, held at his left hand
    d = P.dA[1]
    c = P.W[1] + d * 0.06 * H + V(-0.02 * H, -0.03 * H, 0.0)
    s = 0.07 * H
    verts = [c, c + V(0, -0.5, 0.15) * s, c + V(0, 0.5, 0.15) * s, c + V(0.0, -0.75, 0.55) * s, c + V(0, 0.75, 0.5) * s,
             c + V(0.55, 0.0, 0.35) * s, c + V(-0.55, 0.0, 0.35) * s, c + V(0, 0, 0.3) * s, c + V(0, -0.85, 0.45) * s]
    faces = [(0, 1, 7), (0, 7, 2), (1, 3, 7), (2, 7, 4), (7, 5, 1), (7, 2, 5), (7, 6, 1), (7, 2, 6), (3, 8, 7)]
    import vbcore as core
    cr = core.mesh_object('crane', verts, faces, smooth=False)
    M.finish(cr, 0, thickness=s * 0.02, offset=0.0)
    C.add(cr, 'crane', 'hand_L', 'paper', line=0.6)
    return C
