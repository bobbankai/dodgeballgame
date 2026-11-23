"""
Shiragami, the Tachibana clan's paper god. A giant folded from paper: every limb is a few big flat
facets, the creases inked. A painted mask for a face. A shimenawa rope round its waist hung with
shide streamers and a skirt of talismans; a gohei -- a wand of zigzag paper -- rising behind its
head like a halo; long paper fingers. It took Kōta. It keeps what it is given.
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
    'eye_white': '#F4F1EA', 'eye_hi': '#FFFFFF', 'lash': '#000', 'mouth': '#000', 'iris': '#000', 'brow': '#000', 'hair': '#000',
    'skin': '#EFEBE0', 'paper': '#EFEBE0', 'crease': '#B8B0A0', 'mask': '#F7F5EE', 'mask_mark': '#C3262C', 'rope': '#C8B07A',
    'talisman': '#E8DFC8', 'ink': '#2A1A1A', 'shide': '#FAF8F2', 'wand': '#5A4030',
}


def folded(C, X, N, part):
    """Paper with inked creases: darken where facet normals turn sharply (flat-shaded facets
    give each vertex its own face normal, so neighbours differ across creases)."""
    base = C.col('paper')
    shade = 0.9 + 0.1 * np.clip(N[:, 2] * 0.5 + 0.5, 0, 1)
    grain = 0.97 + 0.03 * np.sin(X[:, 2] * 90.0)
    return base[None] * (shade * grain)[:, None]


def build():
    P = B.Proportions(H=3.1, kind='male', build=1.25, head_scale=0.9, shape={'shoulders': 1.1, 'waist': 0.9})
    C = B.Character('shiragami', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(faceless=True, jaw=0.5, skin='paper', mid='paper', face_shadow=False, head_na=12, head_nt=8, no_ears=True,
                         skin_painter=folded))
    for p in C.parts:
        for poly in p.ob.data.polygons:
            poly.use_smooth = False
    F.face_mask(C, 'mask', 'mask_mark', size=(0.36, 0.5),
                slits=[((s * 0.06, -0.06), (s * 0.16, -0.12), (s * 0.26, -0.06)) for s in (1, -1)] + [((-0.12, -0.42), (0.0, -0.38), (0.12, -0.42))])
    obs = B.skin_body(C, 'paper', grow=0.012, arm_r=(0.036, 0.032, 0.028), leg_r=(0.055, 0.045, 0.035), mid='paper', levels=0, flat=True, n=7)
    for ob in obs:
        C.parts[[q.ob for q in C.parts].index(ob)].painter = folded
    # paper skirt of hanging talismans under the rope
    z = P.z_hip + 0.08 * H
    rope = C.body.ring(z, 48, 0.03 * H)
    Pr.shimenawa(C, np.vstack([rope, rope[:1]]), 0.02 * H, 'rope', twist=10.0, name='shimenawa')
    for k in range(14):
        a = -math.pi + (k + 0.5) / 14 * 2 * math.pi
        at = C.body.point(a, z - 0.07 * H, 0.05 * H)
        out = C.body.normal(a, z - 0.07 * H, 0.05 * H)
        Pr.talisman(C, at, 0.12 * H, facing=-out, up=V(0, 0, 1), name=f'tal{k}', seed=k, curl=0.1)
    for k, a in enumerate((-0.4, 0.4, 2.9, 3.4)):
        at = C.body.point(a, z, 0.05 * H)
        Pr.shide(C, at, 0.08 * H, out=C.body.normal(a, z, 0.05 * H), color='shide', name=f'shide{k}')
    # the gohei behind its head: a wand with zigzag paper streamers fanned out
    base = B.hp(P, 0, 0.6, -0.5)
    top = base + V(0, 0.1 * H, 0.45 * H)
    wand = M.tube([base, top], [0.008 * H] * 2, n=6, samples=4).build('gohei')
    M.finish(wand, 1)
    C.add(wand, 'wand', 'head')
    for k, ang in enumerate(np.linspace(-1.2, 1.2, 7)):
        d = V(math.sin(ang), 0.15, -math.cos(ang) * 0.3 - 0.5)
        Pr.shide(C, top + V(math.sin(ang) * 0.02 * H, 0, 0), 0.09 * H, down=d, out=V(0, -1, 0), color='shide', kind='head', name=f'gshide{k}')
    Pr.hands(C, 'paper', fist=0.25, mid='paper', claws=0.6, slender=1.0)
    for p in C.parts[-2:]:
        p.painter = folded
    return C
