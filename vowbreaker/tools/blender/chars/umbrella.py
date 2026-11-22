"""
Red Umbrella: a tall, thin curse born of everyone who waited in the rain for someone who did not
come. It wears a tattered black frock coat, too long in the sleeve; long clawed fingers; thin legs on
tall one-toothed geta. Its head is a torn red wagasa -- an oiled-paper umbrella on bamboo ribs, the
paper split between the ribs and hanging in flaps -- and beneath it a pale, featureless face with
two glowing eyes. Raindrops bead on the canopy.
"""
import math

import numpy as np

import vbbody as B
import vbcloth as K
import vbface as F
import vbmesh as M
import vbprops as Pr
from vbbody import V
from vbmesh import smooth

PALETTE = {
    'eye_white': '#F4F1EA', 'eye_hi': '#FFFFFF', 'lash': '#000', 'mouth': '#000', 'iris': '#F7E8C8', 'brow': '#000', 'hair': '#000',
    'skin': '#E8E2DA', 'coat': '#141218', 'lining': '#3A0E12', 'canopy': '#B01E24', 'canopy2': '#7A1016', 'rib': '#C8A870',
    'claw': '#0E0B10', 'pants': '#141218', 'geta': '#2A2226', 'hanao': '#B01E24', 'eye_glow': '#F7E8C8', 'feet': '#141218',
}


def canopy_paint(C, X, N, part):
    """Oiled paper: deep red, darker toward the rim, a pale ring band, rain beads."""
    P = C.P
    top = B.hp(P, 0, 0, 0.5)
    q = X - top
    r = np.linalg.norm(q[:, :2], axis=1) / (0.36 * P.H)
    a, b = C.col('canopy'), C.col('canopy2')
    k = smooth(0.3, 1.0, r)
    out = a[None] * (1 - k[:, None]) + b[None] * k[:, None]
    ring = np.abs(r - 0.55) < 0.02
    out = np.where(ring[:, None], V(0.86, 0.72, 0.5)[None], out)
    beads = (np.sin(X[:, 0] * 140) * np.sin(X[:, 1] * 140) > 0.96) & (N[:, 2] > 0.2)
    return np.where(beads[:, None], np.minimum(out * 2.2 + 0.2, 1), out)


def build():
    P = B.Proportions(H=2.35, kind='male', build=0.78, head_scale=0.8, shape={'shoulders': 0.95, 'waist': 0.85, 'depth': 0.85})
    C = B.Character('umbrella', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(faceless=True, jaw=0.4, face_shadow=False, no_ears=True, width=0.92))
    for s in (1, -1):
        F.glow_spot(C, f'glow{s}', s * 0.15, -0.12, 0.08, 0.035, 'eye_glow')
    # the wagasa
    top = B.hp(P, 0, 0, 0.5)
    prof = [(0.36 * H, -0.12 * H), (0.3 * H, -0.065 * H), (0.22 * H, -0.015 * H), (0.12 * H, 0.025 * H), (0.04 * H, 0.048 * H)]
    nrib = 12

    def ribbed(a, z):
        # the paper sags between the ribs
        return 1.0 - 0.035 * np.abs(np.sin(a * nrib / 2)) * smooth(top[2] + 0.04 * H, top[2] - 0.1 * H, z)
    g = M.lathe([(r, top[2] + z) for r, z in prof], centre=(0, 0, 0), n=nrib * 8, rmod=ribbed, cap1=top + V(0, 0, 0.055 * H))
    can = g.build('canopy')
    rng = np.random.default_rng(11)
    torn = set(rng.choice(nrib, 5, replace=False).tolist())

    def keep(Cc):
        a = np.arctan2(Cc[:, 1], Cc[:, 0])
        seg = np.floor((a + math.pi) / (2 * math.pi) * nrib).astype(int) % nrib
        mid = np.abs(((a + math.pi) / (2 * math.pi) * nrib) % 1.0 - 0.5) < 0.2
        low = Cc[:, 2] < top[2] - 0.07 * H
        return ~(np.isin(seg, list(torn)) & mid & low)
    M.delete_faces(can, keep)
    M.finish(can, 0, thickness=0.005 * H, offset=0.0)
    M.finish(can, 1)
    C.add(can, 'canopy', 'head', line=0.9, painter=canopy_paint)
    # hanging flaps of torn paper
    flaps = []
    for i in sorted(torn)[:3]:
        a = (i + 0.5) / nrib * 2 * math.pi - math.pi
        p0 = V(math.cos(a) * 0.3 * H, math.sin(a) * 0.3 * H, top[2] - 0.07 * H)
        rows = [np.stack([p0 + V(math.cos(a + da) * 0.0, 0, 0) + V(-math.sin(a) * da * H, math.cos(a) * da * H, -f * 0.12 * H) + V(math.cos(a), math.sin(a), 0) * f * 0.02 * H
                          for da in (-0.025, 0.0, 0.025)]) for f in np.linspace(0, 1, 6)]
        ob = M.Grid(np.array(rows), False).build(f'flap{i}')
        M.finish(ob, 0, thickness=0.003 * H, offset=0.0)
        flaps.append(ob)
    fo = M.merge(flaps, 'flaps')
    M.finish(fo, 1)
    C.add(fo, 'canopy', 'head', line=0.8, painter=canopy_paint)
    ribs = []
    for i in range(nrib):
        a = 2 * math.pi * i / nrib
        pts = [top + V(0, 0, 0.05 * H)] + [V(math.cos(a) * r * 0.99, math.sin(a) * r * 0.99, top[2] + z - 0.004 * H) for r, z in prof[::-1][1:]]
        ribs.append(M.tube(pts, [0.0035 * H] * len(pts), n=6, samples=12).build(f'rib{i}'))
        # the stretchers underneath
        ribs.append(M.tube([top - V(0, 0, 0.12 * H), V(math.cos(a) * 0.2 * H, math.sin(a) * 0.2 * H, top[2] - 0.02 * H)], [0.0025 * H] * 2, n=5, samples=4).build(f'st{i}'))
    ribs.append(M.tube([top + V(0, 0, 0.09 * H), top - V(0, 0, 0.16 * H)], [0.006 * H, 0.006 * H], n=8, samples=4).build('shaft'))
    ribs.append(M.sphere(top - V(0, 0, 0.12 * H), 0.012 * H, 10, 6).build('runner'))
    ro = M.merge(ribs, 'ribs')
    M.finish(ro, 1)
    C.add(ro, 'rib', 'head', line=0.5)
    coat, rings = K.long_coat(C, 'coat', hem=P.z_ankle + 0.1 * H, open_front=0.04, tatters=0.05, grow=0.01, back_slit=0.3, drape_count=6,
                              painter=K.lined(K.solid(PALETTE['coat'], 0.1), K.solid(PALETTE['lining'], 0.0)), roll=-0.04)
    K.lapels(C, 'coat', grow=0.016, width=0.55)
    K.pants(C, 'pants', r=(0.036, 0.03, 0.026, 0.024), cuff=P.z_ankle + 0.05 * H)
    Pr.geta(C, 'geta', 'hanao', feet='feet')
    Pr.hands(C, 'claw', fist=0.1, claws=1.6, slender=0.85, spread=1.6)
    return C
