"""
Mudhand: a crawling grief-curse, the grunts of the story. A hunched lump of tar shaped like a person
who gave up: a heavy trunk swollen at the back, thin arms too long for it ending in clawed hands,
more hands groping out of its back, tar dripping in strings from its arms and chin. One great
yellow eye with a slit pupil where a face should be, and a mouth line of teeth cut beneath it.
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
    'eye_white': '#F4F1EA', 'eye_hi': '#FFFFFF', 'lash': '#000', 'mouth': '#000', 'iris': '#F0D24A', 'brow': '#000', 'hair': '#000',
    'skin': '#2A1F2E', 'tar': '#241A2A', 'tar2': '#3A2A44', 'eye_glow': '#F0D24A', 'pupil': '#120C10', 'claw': '#14101A', 'teeth': '#E8DCC8',
}


def tar(C, X, N, part):
    """Oily tar: a violet sheen where it faces up, darker underneath, glossy streaks."""
    a, b = C.col('tar'), C.col('tar2')
    up = np.clip(N[:, 2], 0, 1)
    k = up * 0.6 + 0.2 * (np.sin(X[:, 2] * 40 + X[:, 0] * 25) * 0.5 + 0.5) * up
    return a[None] * (1 - k[:, None]) + b[None] * k[:, None]


def build():
    P = B.Proportions(H=1.55, kind='male', build=1.25, shape={'back': 1.4, 'chest': 1.1, 'waist': 1.15, 'shoulders': 1.05})
    C = B.Character('mudhand', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(faceless=True, jaw=0.3, width=1.15, skin='tar', mid='cloth', face_shadow=False, no_ears=True, skin_painter=tar,
                         deform=lambda x, y, z, c: (x, y + 0.08 * np.clip(-np.cos(np.arctan2(x, -y)), 0, 1) * (z < 0), z)))
    obs = B.skin_body(C, 'tar', grow=0.022, arm_r=(0.034, 0.03, 0.024), leg_r=(0.062, 0.046, 0.036), mid='cloth', noise=0.03)
    for p in obs:
        C.parts[[q.ob for q in C.parts].index(p)].painter = tar
    # a hump of tar swelling out of the back
    hump = M.sphere(V(0, 0.07 * H, P.z_sh - 0.06 * H), 0.12 * H, 18, 12, scale=(1.1, 0.8, 1.0)).build('hump')
    M.finish(hump, 1)
    M.displace(hump, lambda X, Nn: Nn * (M.fbm3(X, 8.0 / H, 3, 9) * 0.03 * H)[:, None])
    C.add(hump, 'tar', 'torso', painter=tar)
    # the hands growing out of its back
    backs = []
    for i, (x, z, a) in enumerate(((0.1, 0.72, 30), (-0.12, 0.66, -40), (0.02, 0.6, 5), (0.16, 0.56, 60), (-0.06, 0.78, -15))):
        root = V(x * H, 0.08 * H, z * H)
        wr = root + V(math.sin(math.radians(a)) * 0.18 * H, 0.16 * H, 0.1 * H)
        backs.append(M.tube([root, (root + wr) / 2 + V(0, 0.02 * H, 0.03 * H), wr], [0.03 * H, 0.022 * H, 0.016 * H], n=10, samples=12).build(f'barm{i}'))
        for f in range(5):
            fa = math.radians(a - 40 + f * 20)
            tip = wr + V(math.sin(fa) * 0.06 * H, 0.05 * H, math.cos(fa) * 0.05 * H)
            mid = (wr + tip) / 2 + V(0, 0.012 * H, 0.012 * H)
            backs.append(M.tube([wr, mid, tip], [0.007 * H, 0.005 * H, 0.0012 * H], n=6, samples=8).build(f'bf{i}{f}'))
    bo = M.merge(backs, 'backhands')
    M.finish(bo, 1)
    C.add(bo, 'tar', 'torsopart', painter=tar)
    # drips of tar hanging from the arms and chin
    drips = []
    rng = np.random.default_rng(5)
    for s in (1, -1):
        for j in range(4):
            f = 0.25 + 0.2 * j
            p = P.S[s] + (P.W[s] - P.S[s]) * f + V(0, rng.uniform(-0.01, 0.01) * H, -0.03 * H)
            L = rng.uniform(0.04, 0.09) * H
            drips.append(M.tube([p, p - V(0, 0, L * 0.6), p - V(0, 0, L)], [0.007 * H, 0.004 * H, 0.006 * H], n=6, samples=8).build(f'drip{s}{j}'))
    chin = B.hp(P, 0, -0.35, -0.55)
    for j in range(3):
        p = chin + V((j - 1) * 0.05 * u, 0, 0)
        drips.append(M.tube([p, p - V(0, 0, 0.1 * u), p - V(0, 0, (0.2 + 0.08 * j) * u)], [0.025 * u, 0.015 * u, 0.022 * u], n=6, samples=8).build(f'cdrip{j}'))
    do = M.merge(drips, 'drips')
    M.finish(do, 1)
    for s, side in ((1, 'L'), (-1, 'R')):
        pass
    C.add(do, 'tar', 'torsopart', painter=tar)
    # the eye and the mouth
    F.glow_spot(C, 'bigeye', 0.0, -0.06, 0.21, 0.14, 'eye_glow')
    F.glow_spot(C, 'slit', 0.0, -0.06, 0.035, 0.12, 'pupil', lift=0.008, mid='eye')
    to3d = F.face_to3d(P, C.head, 0, 0.0, -0.36, 0.0)
    xs = np.linspace(-0.18, 0.18, 13)
    zz = np.where(np.arange(13) % 2 == 0, 0.0, -0.035) - 0.02 * (xs / 0.18) ** 2
    F.stroke(C, 'teeth', C.surf, to3d, np.stack([xs, zz], 1), np.full(13, 0.012 * u), 'teeth', lift=0.004, n=40, mid='eye')
    Pr.hands(C, 'claw', fist=0.15, claws=1.0, slender=0.9)
    return C
