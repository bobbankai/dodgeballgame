"""
Sayo Tachibana, 18. Heir of the Tachibana clan, and the Academy's best. A dark navy uniform jacket
cut short at the waist with a sailor collar edged in two white stripes and a red scarf knotted at
the V; a long pleated skirt; black tights and laced knee boots. A holster of paper talismans on
her right thigh; a satchel strap across her chest with a pouch at the hip. Hime cut: a blunt fringe,
side locks cut square at the jaw, the rest falling to her waist, tied low with a red ribbon. Hanging
from the ribbon: the paper crane her twin Kōta folded for her the night before they gave him away.
Violet eyes with fine radial streaks; a small mole under her left eye.
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
    'eye_white': '#FAF7F2', 'eye_hi': '#FFFFFF', 'lash': '#16121A', 'mouth': '#A24A4C',
    'skin': '#F6DCC8', 'hair': '#15121A', 'iris': '#6B4F8A', 'brow': '#15121A',
    'jacket': '#1A2036', 'collar': '#1A2036', 'stripe': '#ECE8E2', 'scarf': '#B3262B', 'skirt': '#1C2238',
    'tights': '#16151C', 'boots': '#211B1E', 'sole': '#101010', 'lace': '#3A2E30', 'button': '#BFC3CC',
    'ribbon': '#B3262B', 'strap': '#3A2A26', 'pouch': '#9E2226', 'holster': '#2B2026', 'talisman': '#EFE6CF',
    'ink': '#2A1A1A', 'crane': '#F2EEE6', '_blush': 0.5,
}


def iris(col):
    return F.iris_radial(col, streak_col=np.minimum(V(col) * 1.9 + 0.12, 1), count=22, pupil=0.4, amount=0.5)


def build():
    P = B.Proportions(H=1.66, kind='female', build=0.98, shape={'waist': 0.9, 'hips': 1.02, 'bust': 0.85, 'shoulders': 0.97, 'sway': 1.0})
    C = B.Character('sayo', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(
        jaw=0.5, width=0.93, cheek=0.45, cheekbone=0.15, chin_w=0.85, nose=0.75, nose_w=0.9, lips=0.4, neck=0.92,
        eye=dict(w=0.093, h=0.1, tilt=9, droop=-0.15, iris=0.75, iris_tall=1.22, pupil=0.4, iris_fn=iris(C.col('iris')),
                 lash=1.25, lash_profile=(0.007, 0.019, 0.004), flick=(0.24, 0.26), lower='outer', crease=0.75, crease_gap=0.004,
                 lashes=((0.72, 0.66, 1.02, 0.98, 0.009), (0.88, 0.42, 1.2, 0.66, 0.008)),
                 highlights=((0.36, 0.44, 0.25, 0.27), (-0.3, -0.5, 0.11, 0.11), (0.48, 0.05, 0.06, 0.06))),
        brow=dict(angle=3, w=0.82, style='taper', arch=0.02, z=0.012),
        mouth=dict(w=0.056, smile=0.06, style='line', weight=0.004, lip=0.6),
    ))
    F.nose_shadow(C, side=-1, length=0.038, width=0.006)
    F.mole(C, 0.205, C.head.eye_z - 0.105, r=0.009)
    # ---------------------------------------------------------------------------------- hair
    L = []
    for i, a in enumerate(np.linspace(-56, 56, 13)):
        L.append(Hr.Clump(a, 0.09, 0.57, 0.17, hug=0.64, out=0.05, drop=0.3, tip=0.6, thick=0.26, sweep=a / 56 * 0.18, bend=0.25, sharp=0.15))
    for s in (1, -1):
        for j, a in enumerate((60, 72, 84)):
            L.append(Hr.Clump(s * a, 0.24 + 0.02 * j, 0.62 - 0.04 * j, 0.17, hug=0.5, out=0.06, drop=1.0, tip=0.55, thick=0.25, bend=0.2, sharp=0.15))
    for i, a in enumerate(np.linspace(110, 250, 13)):
        L.append(Hr.Clump(a, 0.18 + 0.02 * (i % 2), 3.0 + 0.12 * ((i % 3) - 1), 0.3, hug=0.36, out=0.12, drop=1.0, tip=0.42, thick=0.22,
                          samples=22, bend=0.3, wave=0.02, wave_freq=0.8))
    cap = Hr.cap(C, front=0.2, temple=-0.12, back=-0.38, grow=0.06, part=0, part_depth=0.25, part_len=0.3, back_bulge=0.02)
    Hr.build(C, L, cap, paint=Hr.painter(PALETTE['hair'], tips=None, band_z=0.24, band_color='#3E3A58', under=0.45, band_amount=0.6))
    Hr.chain(C, B.hp(P, 0, 0.5, -0.4), B.hp(P, 0, 0.75, -3.1), n=3)
    # the red ribbon tying the hair low, and Kōta's crane hanging from it
    knot = B.hp(P, 0, 0.6, -0.62)
    obs = [M.sphere(knot, 0.06 * u, 10, 6, scale=(1.2, 0.7, 1)).build('rknot')]
    for s in (1, -1):
        pts = [knot, knot + V(s * 0.13, 0.04, 0.08) * u, knot + V(s * 0.22, 0.03, 0.0) * u, knot + V(s * 0.13, 0.04, -0.07) * u, knot]
        obs.append(M.tube(pts, [0.02 * u, 0.06 * u, 0.07 * u, 0.06 * u, 0.02 * u], n=10, samples=16, squash=0.3, guide=V(0, 1, 0)).build(f'rl{s}'))
        tail = [knot, knot + V(s * 0.06, 0.05, -0.3) * u, knot + V(s * 0.1, 0.05, -0.62) * u]
        obs.append(M.tube(tail, [0.04 * u, 0.05 * u, 0.06 * u], n=8, samples=10, squash=0.25, guide=V(0, 1, 0), cap1='fan').build(f'rt{s}'))
    ro = M.merge(obs, 'ribbon')
    M.finish(ro, 1)
    C.add(ro, 'ribbon', 'hair')
    crane_at = knot + V(-0.1, 0.07, -0.72) * u
    _crane(C, crane_at, 0.2 * u)
    # ---------------------------------------------------------------------------------- uniform
    jk = K.jacket(C, 'jacket', hem=P.z_hip + 0.035 * H, buttons_col='button', collar=None, grow=0.008, n_buttons=4,
                  painter=K.solid(PALETTE['jacket'], 0.12))
    K.sailor_collar(C, 'collar', 'stripe', depth=0.15, grow=0.014, tie='scarf', tie_len=0.11)
    K.skirt(C, 'skirt', top=P.z_hip + 0.075 * H, hem=P.z_knee - 0.09 * H, flare=1.0, pleats=18, depth=0.04,
            painter=K.hem_band(K.solid(PALETTE['skirt'], 0.1), PALETTE['stripe'], P.z_knee - 0.088 * H, P.z_knee - 0.08 * H))
    K.tights(C, 'tights')
    Pr.boots(C, 'boots', 'sole', height=0.17, straps=3, strap_col='strap', buckle='button', cuff='boots')
    Pr.hands(C, 'skin', fist=0.55, nails='#F2CFC8', slender=0.92)
    # satchel strap across the chest, pouch at the left hip
    K.strap(C, 'satchel', 'strap', math.radians(-150), P.z_sh + 0.016 * H, math.radians(40), P.z_hip + 0.05 * H, 0.03 * H, 0.02 * H, thick=0.006,
            via=(math.radians(-25), P.z_sh - 0.08 * H))
    pc = C.body.point(math.radians(70), P.z_hip + 0.02 * H, 0.05 * H)
    po = M.rbox(pc, (0.026 * H, 0.018 * H, 0.03 * H), R=K.rot_to(V(0.0, 0.0, 1.0)), round_=0.45).build('pouch')
    M.finish(po, 1)
    C.add(po, 'pouch', 'torsopart')
    flap = M.rbox(pc + V(0, -0.016 * H, 0.016 * H), (0.027 * H, 0.004 * H, 0.014 * H), round_=0.5).build('pflap')
    M.finish(flap, 1)
    C.add(flap, 'pouch', 'torsopart')
    # the thigh holster with a fan of talismans standing out of it (right thigh)
    s = -1
    th = P.Hp[s] + (P.K[s] - P.Hp[s]) * 0.32 + V(s * 0.05 * H, -0.01 * H, 0)
    ring = M.torus(th, 0.054 * H, 0.004 * H, axis=nrm_(P.K[s] - P.Hp[s]), n=28, m=6, squash=1.6).build('holsterband')
    M.finish(ring, 1)
    C.add(ring, 'holster', 'leg_R')
    case = M.rbox(th + V(s * 0.016 * H, 0, 0), (0.008 * H, 0.03 * H, 0.04 * H), round_=0.4).build('holster')
    M.finish(case, 1)
    C.add(case, 'holster', 'leg_R')
    for k in range(5):
        a = (k - 2) * 0.12
        at = th + V(s * 0.02 * H, (k - 2) * 0.006 * H, 0.045 * H + abs(k - 2) * -0.004 * H)
        Pr.talisman(C, at, 0.07 * H, facing=V(s * 1.0, 0, 0), up=V(math.sin(a) * 0.3, 0.0, 1.0), kind='leg_R', name=f'ofuda{k}', seed=k, curl=0.2)
    return C


def nrm_(v):
    return v / np.linalg.norm(v)


def _crane(C, at, size):
    """An origami crane: a folded body, two wings, neck and tail as flat facets."""
    c = V(at)
    s = size
    verts = [c + V(0, 0, 0), c + V(0, -0.5, 0.15) * s, c + V(0, 0.5, 0.15) * s, c + V(0.0, -0.75, 0.55) * s, c + V(0, 0.75, 0.5) * s,
             c + V(0.55, 0.0, 0.35) * s, c + V(-0.55, 0.0, 0.35) * s, c + V(0, 0, 0.3) * s, c + V(0, -0.85, 0.45) * s]
    faces = [(0, 1, 7), (0, 7, 2), (1, 3, 7), (2, 7, 4), (7, 5, 1), (7, 2, 5), (7, 6, 1), (7, 2, 6), (3, 8, 7)]
    import vbcore as core
    ob = core.mesh_object('crane', verts, faces, smooth=False)
    M.finish(ob, 0, thickness=s * 0.02, offset=0.0)
    C.add(ob, 'crane', 'hair', 'paper', line=0.6)
