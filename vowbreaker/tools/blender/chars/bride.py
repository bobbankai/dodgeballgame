"""
The Weeping Bride: a curse grown in a seaside chapel from a bride left at the altar. Too tall. A
white shiromuku wedding kimono with cranes woven faintly into the silk, a red under-collar showing
at the neck, a gold taiko-knotted obi; the white wataboshi hood over her head; long black hair
falling out of it to her knees. No face, only black tears running down. Her hands are long and pale
with dark nails. The kimono's hem pools on the floor; she does not walk, she drifts.
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
    'eye_white': '#F4F1EA', 'eye_hi': '#FFFFFF', 'lash': '#000', 'mouth': '#000', 'iris': '#000', 'brow': '#000',
    'skin': '#EDE6E2', 'hair': '#0D0B10', 'kimono': '#F1EEE8', 'crane': '#E2DED6', 'hood': '#F6F4EF', 'red': '#B01E2A',
    'obi': '#C9B48A', 'obi2': '#A88E5A', 'cord': '#B01E2A', 'tears': '#151018', 'nails': '#2A1A24',
}


def build():
    P = B.Proportions(H=2.2, kind='female', build=0.92, shape={'waist': 0.92, 'bust': 0.7})
    C = B.Character('bride', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(faceless=True, jaw=0.45, width=0.9, face_shadow=False, no_ears=True))
    F.tear_tracks(C, 'tears', width=0.05, length=0.5)
    L = []
    for a in np.linspace(-56, 56, 9):
        L.append(Hr.Clump(a, 0.1, 1.7, 0.2, hug=0.35, out=0.08, drop=1.0, tip=0.3, samples=22, bend=0.3, wave=0.02, wave_freq=1.0))
    for a in np.linspace(88, 272, 13):
        L.append(Hr.Clump(a, 0.18, 3.9, 0.27, hug=0.25, out=0.12, drop=1.0, tip=0.3, samples=26, bend=0.3, wave=0.03, wave_freq=0.7))
    cap = Hr.cap(C, front=0.22, temple=-0.1, back=-0.36, grow=0.06)
    Hr.build(C, L, cap, paint=Hr.painter(PALETTE['hair'], band_z=0.2, band_color='#2A2632', under=0.4, band_amount=0.4))
    Hr.chain(C, B.hp(P, 0, 0.5, -0.3), B.hp(P, 0, 0.75, -4.0), n=3)
    K.hood(C, 'hood', grow=0.22, open_face=0.66, peak=0.3)
    kim = K.cranes(PALETTE['kimono'], PALETTE['crane'], scale=0.14, density=0.5)
    K.kimono(C, 'kimono', hem=0.008 * H, sleeves='furisode', wide=0.07, drop=0.12, collar='kimono', under='red', grow=0.014, hem_r=2.6,
             painter=kim, levels=2)
    obi_paint = K.stripes(PALETTE['obi'], PALETTE['obi2'], period=0.02, width=0.15, axis='z')
    K.obi(C, 'obi', height=0.09, grow=0.026, bow=True, style='taiko', painter=obi_paint, cord='cord')
    Pr.hands(C, 'skin', fist=0.05, nails=PALETTE['nails'], slender=0.85, claws=0.4)
    return C
