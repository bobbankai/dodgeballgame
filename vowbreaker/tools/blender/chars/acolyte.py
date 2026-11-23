"""
The Lantern Monk's acolytes. Faceless in a lacquered white mask with red slits and a third eye
painted on the brow; a peaked hood draping to the shoulders; a pale grey robe whose skirts are
written over in bands of brush glyphs; a twisted straw rope belt hung with shide; a small lantern
on a cord; white leggings and straw sandals.
"""
import math

import numpy as np

import vbbody as B
import vbcloth as K
import vbface as F
import vbmesh as M
import vbprops as Pr
from vbbody import V

PALETTE = {
    'eye_white': '#F4F1EA', 'eye_hi': '#FFFFFF', 'lash': '#111', 'mouth': '#111', 'iris': '#111', 'brow': '#111', 'hair': '#111',
    'skin': '#E7D2C0', 'robe': '#D8D4CA', 'ink': '#2A1C1E', 'hood': '#CFC9BC', 'mask': '#F4F1EA', 'mask_mark': '#C3262C',
    'rope': '#C8B07A', 'shide': '#FAF8F2', 'leggings': '#E6E0D2', 'tabi': '#ECE8DE', 'zori': '#C8B07A', 'strap': '#7A2A22',
    'lantern': '#E8E0C8', 'lacquer': '#141012',
}


def mask_paint(C, X, N, part):
    """A red third eye on the mask's brow."""
    P = C.P
    q = (X - P.head_c) / P.u
    base = C.col('mask')
    eye = ((q[:, 0] / 0.07) ** 2 + ((q[:, 2] - 0.08) / 0.03) ** 2 < 1) & (q[:, 1] < -0.3)
    pupil = ((q[:, 0] / 0.02) ** 2 + ((q[:, 2] - 0.08) / 0.026) ** 2 < 1) & (q[:, 1] < -0.3)
    out = np.where(eye[:, None], C.col('mask_mark')[None], np.tile(base, (len(X), 1)))
    return np.where(pupil[:, None], V(0.06, 0.03, 0.03)[None], out)


def build():
    P = B.Proportions(H=1.76, kind='male', build=0.98, shape={'shoulders': 0.98})
    C = B.Character('acolyte', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(faceless=True, jaw=0.6, face_shadow=False, no_ears=True))
    F.face_mask(C, 'mask', 'mask_mark', slits=[((s * 0.07, -0.1), (s * 0.15, -0.075), (s * 0.24, -0.03)) for s in (1, -1)], marks_painter=mask_paint)
    K.hood(C, 'hood', grow=0.15, open_face=0.6, drape_=0.06, peak=0.6)
    robe_paint = K.glyph_band(PALETTE['robe'], PALETTE['ink'], P.z_ankle + 0.06 * H, P.z_knee + 0.04 * H, cols=12)
    K.kimono(C, 'robe', hem=P.z_ankle + 0.05 * H, sleeves='furisode', wide=0.03, drop=0.04, collar='robe', under='ink', grow=0.012,
             hem_r=2.2, painter=robe_paint, levels=1)
    z = P.z_hip + 0.08 * H
    rope = C.body.ring(z, 40, 0.032 * H)
    Pr.shimenawa(C, np.vstack([rope, rope[:1]]), 0.009 * H, 'rope', twist=12.0, name='ropebelt')
    for k, a in enumerate((-0.5, 0.5, 2.8, 3.5)):
        at = C.body.point(a, z - 0.01 * H, 0.04 * H)
        Pr.shide(C, at, 0.07 * H, out=C.body.normal(a, z, 0.04 * H), color='shide', name=f'shide{k}')
    hip = C.body.point(0.9, z - 0.02 * H, 0.05 * H)
    Pr.paper_lantern(C, hip + V(0.01 * H, -0.01 * H, -0.08 * H), 0.035 * H, 0.09 * H, 'lantern', 'lacquer', glow=True)
    K.tights(C, 'leggings', top=P.z_knee + 0.04 * H, bottom=P.z_ankle + 0.01 * H, grow=0.005)
    Pr.zori(C, 'zori', 'strap', tabi=PALETTE['tabi'])
    Pr.hands(C, 'skin', fist=0.6, nails='#E8CFC0')
    return C
