"""
Itsuki Kagari, 17. The player. A gakuran worn open over a red hoodie; the hood bunched behind his
collar, drawstrings loose. Mio's little brass bell hangs from his belt loop on a red cord, and the
red string bracelet she braided him is still on his left wrist. His right sleeve is shoved up over
a bandaged forearm (the bell's recoil splits his knuckles). Black hair that will not lie flat, tips
gone rust-brown, one stubborn strand at the crown. Amber eyes ringed dark, a little tired.
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
    'eye_white': '#FAF6F0', 'eye_hi': '#FFFFFF', 'lash': '#1A1418', 'mouth': '#8E4440',
    'skin': '#F2D0B4', 'hair': '#1F1B24', 'iris': '#D08A2C', 'brow': '#1F1B24',
    'jacket': '#191D2B', 'lining': '#2C2232', 'hoodie': '#7C1F25', 'string': '#EDE6DA', 'pants': '#1A1E2C',
    'belt': '#17130F', 'buckle': '#A9ADB5', 'button': '#C9A24A', 'crest': '#D4B25A', 'collar_in': '#ECE8E0',
    'shoes': '#1E1A1E', 'sole': '#E8E4DC', 'accent': '#B3262B', 'lace': '#E8E4DC',
    'bell': '#D9B24E', 'cord': '#B3262B', 'bandage': '#E9E2D3', 'bracelet': '#B3262B', '_blush': 0.22,
}


def iris(col):
    """Amber with a dark limbal ring and a hot orange ring round the pupil: the bell, waiting."""
    base = F.iris_classic(col, pupil=0.4, dark=0.8, band=0.7, rim=0.75)
    hot = V(1.0, 0.55, 0.12)

    def fn(rho, ang, qx, qz):
        c = base(rho, ang, qx, qz)
        k = (1 - smooth(0.0, 0.05, np.abs(rho - 0.47))) * 0.55
        streak = smooth(0.7, 0.95, np.cos(ang * 13) * 0.5 + 0.5) * smooth(0.5, 0.6, rho) * (1 - smooth(0.8, 0.88, rho)) * 0.25
        c = c * (1 - k[:, None]) + hot[None] * k[:, None]
        return c * (1 - streak[:, None]) + (c * 1.4) * streak[:, None]
    return fn


def build():
    P = B.Proportions(H=1.74, kind='male', build=1.0, shape={'shoulders': 1.03, 'waist': 0.95, 'chest': 1.0})
    C = B.Character('itsuki', PALETTE, P)
    H, u = P.H, P.u
    F.build_head(C, dict(
        jaw=0.78, width=0.95, cheek=0.25, cheekbone=0.4, temple=0.3, jaw_corner=0.15, chin_w=0.9, nose=0.95, bridge=0.009,
        neck=1.0, adams_apple=True,
        eye=dict(w=0.09, h=0.085, tilt=7, droop=-0.3, iris=0.74, iris_tall=1.18, pupil=0.4, iris_fn=iris(C.col('iris')),
                 lash=0.95, lash_profile=(0.006, 0.017, 0.005), flick=(0.17, 0.2), lower='outer', crease=0.45, bags=0.3,
                 highlights=((0.38, 0.42, 0.24, 0.27), (-0.34, -0.5, 0.1, 0.11), (0.05, 0.62, 0.06, 0.07))),
        brow=dict(angle=12, w=1.15, style='taper', arch=0.012, z=0.0),
        mouth=dict(w=0.066, smile=0.0, style='line', weight=0.004),
    ))
    F.nose_shadow(C, side=-1, length=0.045)
    # ---------------------------------------------------------------------------------- hair
    L = []
    for i, a in enumerate(np.linspace(-56, 56, 9)):
        f = abs(a) / 56
        L.append(Hr.Clump(a, 0.11 + 0.025 * (i % 2), 0.5 + 0.16 * f - 0.06 * (i % 2), 0.2, hug=0.5, out=0.1, drop=0.35,
                          sweep=np.sign(a) * (0.15 + 0.35 * f) - 0.1, curl=0.04, fork=1 if i in (2, 6) else 0, bend=0.42, kink=0.08 if i == 4 else 0))
    for s in (1, -1):
        L.append(Hr.Clump(s * 64, 0.18, 0.78, 0.17, hug=0.5, out=0.12, drop=0.8, sweep=s * 0.1, fork=1, fork_at=0.6, bend=0.4))
    for a in (-84, -104, 84, 104):
        L.append(Hr.Clump(a, 0.3, 0.46, 0.16, hug=0.5, out=0.16, drop=0.75, bend=0.4))
    for i, a in enumerate(range(118, 250, 17)):
        L.append(Hr.Clump(a, 0.14 + 0.06 * (i % 3), 0.5 + 0.08 * (i % 2), 0.21, hug=0.3, out=0.45, drop=0.48, curl=-0.06,
                          fork=1 if i % 3 == 0 else 0, fork_spread=0.5, bend=0.45))
    for a in (128, 156, 180, 204, 232):
        L.append(Hr.Clump(a, 0.035, 0.44, 0.19, hug=0.34, out=0.36, drop=0.22, bend=0.4))
    for a in (148, 172, 196, 214):
        L.append(Hr.Clump(a, 0.62, 0.34, 0.14, hug=0.35, out=0.34, drop=0.7, bend=0.35))
    L.append(Hr.Clump(18, 0.03, 0.34, 0.075, hug=0.0, out=1.0, drop=0.75, curl=0.0, thick=0.35, samples=12, avoid=False, bend=0.2, sweep=0.0))
    flyaway = [Hr.strand(C, Hr.V(0, 0, 0) + C.head.world(math.radians(a), 0.1) + C.head.normal(math.radians(a), 0.1) * 0.07 * u,
                         C.head.world(math.radians(a), 0.1) + V(math.sin(math.radians(a)) * 0.1, -0.05, 0.08) * u,
                         C.head.world(math.radians(a), 0.1) + V(math.sin(math.radians(a)) * 0.16, -0.03, 0.03) * u, r=0.005) for a in (-30, 40)]
    cap = Hr.cap(C, front=0.16, temple=-0.1, back=-0.32, grow=0.07, part=-25, crown_lift=0.025, back_bulge=0.03)
    Hr.build(C, L + flyaway, cap, paint=Hr.painter(PALETTE['hair'], tips='#6B3A2E', band_z=0.21, band_color='#4D4658', under=0.5))
    # ---------------------------------------------------------------------------------- hoodie
    K.shirt(C, 'hoodie', top=P.neck_base + 0.006 * H, bottom=P.z_hip + 0.025 * H, grow=0.003)
    hood = M.tube([V(0.06 * H, 0.03 * H, P.neck_base + 0.006 * H), V(0.045 * H, 0.06 * H, P.neck_base - 0.004 * H), V(0, 0.075 * H, P.neck_base - 0.016 * H),
                   V(-0.045 * H, 0.06 * H, P.neck_base - 0.004 * H), V(-0.06 * H, 0.03 * H, P.neck_base + 0.006 * H)],
                  [0.016 * H, 0.026 * H, 0.032 * H, 0.026 * H, 0.016 * H], n=14, samples=18, squash=0.62, guide=V(0, 0.3, 1))
    ho = hood.build('hood')
    M.finish(ho, 1)
    K.drape(ho, C, P.neck_base + 0.02 * H, P.neck_base - 0.03 * H, 6, 0.004)
    C.add(ho, 'hoodie', 'torsopart')
    K.drawstrings(C, 'string', 0.006 * H, length=0.075, spread=0.022)
    # ---------------------------------------------------------------------------------- gakuran
    jacket = K.jacket(C, 'jacket', open_front=0.05, buttons_col=None, grow=0.012, collar='stand', collar_inner='collar_in', roll=(0.0, 0.085),
                      painter=K.lined(K.solid(PALETTE['jacket'], 0.12), K.solid(PALETTE['lining'], 0.0)))
    # gold buttons down the left edge of the open front, slits painted on the right
    zs = [P.z_sh - 0.03 * H - i * 0.055 * H for i in range(5)]
    for s, name in ((1, 'btnL'),):
        aa = []
        for z in zs:
            w = 0.05 * H * (0.35 + 0.65 * smooth(P.z_sh, P.z_hip - 0.05 * H, z))
            W = C.body.dims(z)[0] + 0.012 * H
            aa.append(float(np.arcsin(np.clip(w / W, 0, 0.9))) + 0.1)
        obs = []
        for a, z in zip(aa, zs):
            p = C.body.point(a, z, 0.018 * H)
            n = C.body.normal(a, z, 0.018 * H)
            obs.append(M.sphere(p, 0.0068 * H, 12, 8, scale=(1, 1, 0.55), R=K.rot_to(n)).build('b'))
        bo = M.merge(obs, 'buttons')
        M.finish(bo, 1)
        C.add(bo, 'button', 'torsopart', 'metal', line=0.6)
    # the school crest pinned to the collar
    cp = V(0.032 * H, -0.036 * H, P.neck_base + 0.014 * H)
    crest = M.sphere(cp, 0.007 * H, 12, 8, scale=(1, 0.35, 1), R=K.rot_to(V(0.6, -1, 0))).build('crest')
    M.finish(crest, 1)
    C.add(crest, 'crest', 'torsopart', 'metal', line=0.5)
    # cuff buttons on the left sleeve
    d = P.dA[1]
    cb = [M.sphere(P.W[1] - d * (0.012 + 0.012 * j) * H + V(0, 0.018 * H, 0.004 * H), 0.004 * H, 8, 6, scale=(1, 0.6, 1)).build(f'cb{j}') for j in range(2)]
    cbo = M.merge(cb, 'cuffbuttons')
    M.finish(cbo, 1)
    C.add(cbo, 'button', 'sleeve_L', 'metal', line=0.5)
    # ---------------------------------------------------------------------------------- legs
    K.pants(C, 'pants', crease=0.0018)
    K.belt(C, P.z_hip + 0.045 * H, 'belt', buckle='buckle', width=0.026, grow=0.009)
    Pr.sneakers(C, 'shoes', 'sole', accent='accent', lace='lace', high=True)
    # ---------------------------------------------------------------------------------- hands
    Pr.hands(C, 'skin', fist=0.75)
    Pr.bandage(C, -1, 'bandage', z_from=-0.08, z_to=0.62, turns=8)
    br = M.torus(P.W[1] - P.dA[1] * 0.012 * H, 0.0172 * H, 0.0022 * H, axis=P.dA[1], n=24, m=6).build('bracelet')
    br2 = M.torus(P.W[1] - P.dA[1] * 0.018 * H, 0.0175 * H, 0.0018 * H, axis=P.dA[1], n=24, m=6).build('bracelet2')
    bo = M.merge([br, br2], 'bracelet')
    M.finish(bo, 1)
    C.add(bo, 'bracelet', 'hand_L', line=0.3)
    # ---------------------------------------------------------------------------------- Mio's bell
    at = V(0.09 * H, -0.06 * H, P.z_hip + 0.005 * H)
    Pr.bell(C, at, size=0.0125 * H / 1.74 * 1.74 * 0.9, cord_len=0.045)
    return C
