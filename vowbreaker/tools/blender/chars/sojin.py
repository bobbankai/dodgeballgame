"""
Sōjin Amagiri, the Lantern Monk, 46 -- and the man he was twenty years before.

Now: a big man in a black koromo with deep hanging sleeves, a rust-and-umber patchwork kesa over his
left shoulder (a monk's robe pieced from scraps), prayer beads the size of plums round his neck
with a violet tassel, white leggings bound at the shin, zori over split-toe tabi. A red paper
lantern hangs at his hip -- something moves inside it -- and a ringed shakujo staff is slung across
his back. Shaved head, a close beard and moustache, heavy brows, a scar through the right brow
down the cheek. His eyes went gold when he swallowed the curse that killed his family: slit pupils.

Then (young=True): the village sorcerer of Amagiri on festival night, twenty-six. Short black hair,
warm brown eyes, an easy smile; a green haori over a white kimono and grey striped hakama, a wooden
charm tag at his belt.
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

OLD = {
    'eye_white': '#F2EEE4', 'eye_hi': '#FFF6D8', 'lash': '#18161B', 'mouth': '#6E3E38',
    'skin': '#E9C6A6', 'hair': '#18161B', 'stubble': '#3A3436', 'iris': '#D9B24E', 'brow': '#18161B',
    'robe': '#1B1A26', 'under': '#E8E2D4', 'kesa': '#7B2A1C', 'beads': '#4A3020', 'tassel': '#5A2E8A',
    'leggings': '#E6E0D2', 'binding': '#3A3436', 'tabi': '#ECE8DE', 'zori': '#2A221C', 'strap': '#3A2E5A',
    'lantern': '#C8442A', 'lacquer': '#141012', 'staff': '#5A4030', 'metal': '#B8A878', 'belt': '#2A2430', '_blush': 0.08,
}
YOUNG = {
    'eye_white': '#FAF6F0', 'eye_hi': '#FFFFFF', 'lash': '#18161B', 'mouth': '#8E4A44',
    'skin': '#EFCCAE', 'hair': '#18161B', 'iris': '#5A3E2A', 'brow': '#18161B',
    'haori': '#25402F', 'kimono': '#EDE8DC', 'hakama': '#4A4A54', 'stripe': '#3A3A44', 'himo': '#ECE8DE',
    'tabi': '#ECE8DE', 'zori': '#3A2E26', 'strap': '#6A2A22', 'tag': '#B89060', 'cord': '#B3262B', 'obi': '#2A2A30', '_blush': 0.15,
}


def stubble_skin(C, X, N, part):
    P = C.P
    base = C.col('skin')
    q = (X - P.head_c) / P.u
    top = smooth(0.12, 0.2, q[:, 2]) * (part.kind == 'face')
    st = V(0.5, 0.48, 0.52)
    return base[None] * (1 - 0.28 * top[:, None]) + (base * st)[None] * 0.28 * top[:, None]


def build(young=False):
    if young:
        return build_young()
    P = B.Proportions(H=1.82, kind='male', build=1.12, shape={'chest': 1.08, 'waist': 1.08, 'shoulders': 1.06, 'depth': 1.12, 'hips': 1.04})
    C = B.Character('sojin', OLD, P)
    H, u = P.H, P.u
    F.build_head(C, dict(
        jaw=0.9, width=0.97, cheek=0.2, cheekbone=0.6, jaw_corner=0.8, chin_w=1.25, nose=1.2, nose_w=1.15, bridge=0.012, brow_ridge=1.0,
        neck=1.12, adams_apple=True, skin_painter=stubble_skin, forehead=0.4, ear_size=1.08,
        eye=dict(w=0.08, h=0.068, tilt=4, droop=0.15, lid_in=-0.12, iris=0.62, iris_tall=1.15, pupil=0.3,
                 iris_fn=F.iris_slit(C.col('iris'), pupil_w=0.13, pupil_h=0.78, ring_col=V(1.0, 0.85, 0.4)),
                 lash=0.85, lash_profile=(0.008, 0.016, 0.003), flick=(0.08, 0.04), lower='full', crease=0.9, crease_gap=0.006, bags=0.6,
                 lid_shadow=1.3, highlights=((0.35, 0.35, 0.16, 0.18), (-0.3, -0.45, 0.07, 0.07))),
        brow=dict(angle=10, w=1.45, style='thick', arch=0.006, scar=True, scar_side=-1),
        mouth=dict(w=0.08, smile=-0.08, style='line', weight=0.005),
    ))
    F.scar(C, [(-0.13, C.head.eye_z + 0.2), (-0.155, C.head.eye_z + 0.05), (-0.2, C.head.eye_z - 0.12), (-0.24, C.head.eye_z - 0.22)], width=0.014)
    F.nose_shadow(C, side=-1, length=0.06, width=0.009)
    # shaved head: a fine stubble cap, a short beard, a moustache
    cap = Hr.cap(C, front=0.24, temple=-0.06, back=-0.36, grow=0.006)
    beard = []
    for a in (-30, -15, 0, 15, 30):
        beard.append(Hr.Clump(a, 0.9, 0.22, 0.15, hug=0.6, out=0.15, drop=0.9, grow=0.014, tip=0.12, bend=0.2, thick=0.45))
    for s in (1, -1):
        beard.append(Hr.Clump(s * 48, 0.78, 0.2, 0.15, hug=0.85, out=0.08, drop=0.6, grow=0.014, bend=0.2, thick=0.45))
        beard.append(Hr.Clump(s * 64, 0.66, 0.2, 0.12, hug=0.9, out=0.05, drop=0.6, grow=0.012, bend=0.2, thick=0.45))
    Hr.build(C, beard, cap, mname='stubble', paint=Hr.painter(OLD['stubble'], band_amount=0.0, under=0.6, root_dark=0.9))
    st = M.tube([B.hp(P, -0.15, -0.43, -0.41), B.hp(P, -0.06, -0.48, -0.37), B.hp(P, 0, -0.485, -0.37), B.hp(P, 0.06, -0.48, -0.37), B.hp(P, 0.15, -0.43, -0.41)],
                [0.012 * u, 0.026 * u, 0.028 * u, 0.026 * u, 0.012 * u], n=8, samples=12, squash=0.45, guide=V(0, -1, 0.3))
    so = st.build('stache')
    M.finish(so, 1)
    C.add(so, 'hair', 'face', 'hair')
    # ---------------------------------------------------------------------------------- the koromo
    robe = K.kimono(C, 'robe', hem=P.z_ankle + 0.07 * H, sleeves='furisode', wide=0.05, drop=0.1, collar='robe', under='under', grow=0.014,
                    hem_r=2.2, painter=K.solid(OLD['robe'], 0.16))
    K.bunch(robe, C, P.z_hip + 0.1 * H, 0.003, 0.04, 14)
    K.obi(C, 'belt', z=P.z_hip + 0.1 * H, height=0.04, grow=0.026, bow=False)
    # the kesa: a patchwork mantle over the left shoulder and across under the right arm
    kesa_paint = K.patchwork(['#7B2A1C', '#6A2A1A', '#8A3A22', '#5E2418', '#7A3424'], cell=(0.06, 0.1), seam='#3A160E', seam_w=0.05)
    K.strap(C, 'kesa', 'kesa', math.radians(55), P.z_sh + 0.03 * H, math.radians(-75), P.z_hip + 0.02 * H, 0.16 * H, 0.03 * H, thick=0.007,
            via=(math.radians(-10), P.z_sh - 0.15 * H), painter=kesa_paint, n=40)
    K.panel(C, 'kesaback', math.radians(130), math.radians(220), P.z_hip + 0.04 * H, P.z_sh + 0.02 * H, 0.032 * H, 'kesa', rows=10, cols=10,
            thick=0.006, painter=kesa_paint, shape=lambda fa, fz: (-(1 - fz) * 0.5, 0.0))
    ring = M.torus(C.body.point(math.radians(55), P.z_sh - 0.07 * H, 0.04 * H), 0.022 * H, 0.004 * H, axis=(0.3, -1, 0.2), n=16, m=6).build('kesaring')
    M.finish(ring, 1)
    C.add(ring, 'metal', 'torsopart', 'metal', line=0.5)
    Pr.juzu(C, (0, -0.02 * H, P.neck_base - 0.05 * H), 0.1 * H, 24, 0.0145 * H, 'beads', tilt=(-30, 0, 0), big=True, tassel='tassel', sag=0.03 * H)
    # leggings bound at the shin, zori and tabi
    K.tights(C, 'leggings', top=P.z_knee + 0.04 * H, bottom=P.z_ankle + 0.01 * H, grow=0.006)
    for s in (1, -1):
        for j in range(4):
            z = P.z_ankle + 0.04 * H + j * 0.045 * H
            c = V(P.A[s][0], P.A[s][1] + 0.002 * H, z)
            b = M.torus(c, 0.03 * H + j * 0.0025 * H, 0.0028 * H, axis=(0, 0, 1), n=20, m=5, squash=1.3).build(f'bind{s}{j}')
            M.finish(b, 1)
            C.add(b, 'binding', f'leg_{"L" if s > 0 else "R"}')
    Pr.zori(C, 'zori', 'strap', tabi=OLD['tabi'])
    Pr.hands(C, 'skin', fist=0.5, slender=1.12)
    # the lantern at his hip, the staff across his back
    hip = C.body.point(math.radians(-60), P.z_hip + 0.02 * H, 0.05 * H)
    Pr.paper_lantern(C, hip + V(-0.02 * H, -0.02 * H, -0.1 * H), 0.05 * H, 0.12 * H, 'lantern', 'lacquer', kind='torsopart', glow=True,
                     painter=lambda C_, X, N, part: _lantern_paint(C_, X, hip + V(-0.02 * H, -0.02 * H, -0.1 * H), H))
    hook = M.tube([C.body.point(math.radians(-60), P.z_hip + 0.1 * H, 0.03 * H), hip + V(-0.02 * H, -0.02 * H, 0.0)], [0.003 * H] * 2, n=6, samples=4).build('lanterncord')
    M.finish(hook, 1)
    C.add(hook, 'belt', 'torsopart')
    Pr.shakujo(C, C.body.point(math.radians(200), P.z_hip - 0.12 * H, 0.06 * H), C.body.point(math.radians(155), P.neck_base + 0.32 * H, 0.06 * H) + V(-0.2 * H, 0, 0),
               color='metal', shaft='staff')
    sling = M.tube([C.body.point(math.radians(130), P.z_sh, 0.035 * H), C.body.point(math.radians(180), P.z_hip + 0.1 * H, 0.04 * H),
                    C.body.point(math.radians(230), P.z_hip - 0.05 * H, 0.05 * H)], [0.004 * H] * 3, n=6, samples=10).build('sling')
    M.finish(sling, 1)
    C.add(sling, 'belt', 'torsopart')
    return C


def _lantern_paint(C, X, centre, H):
    """Red paper with a black brushed 'night' glyph band and darker ribs."""
    base = C.col('lantern')
    q = X - centre
    out = np.tile(base, (len(X), 1))
    band = np.abs(q[:, 2]) < 0.025 * H
    a = np.arctan2(q[:, 0], -q[:, 1])
    glyph = band & ((np.abs(np.sin(a * 3)) < 0.25) | (np.abs(q[:, 2]) < 0.004 * H))
    out = np.where(glyph[:, None], V(0.05, 0.03, 0.03)[None], out)
    rib = np.abs(np.sin(q[:, 2] / (0.12 * H) * 12 * math.pi)) < 0.15
    return np.where(rib[:, None], out * 0.8, out)


def build_young():
    P = B.Proportions(H=1.78, kind='male', build=1.0, shape={'shoulders': 1.02, 'waist': 0.96})
    C = B.Character('sojin_young', YOUNG, P)
    H, u = P.H, P.u
    F.build_head(C, dict(
        jaw=0.82, width=0.95, cheek=0.25, cheekbone=0.4, jaw_corner=0.35, chin_w=1.05, nose=1.0, bridge=0.01, brow_ridge=0.3, neck=1.02,
        adams_apple=True,
        eye=dict(w=0.085, h=0.082, tilt=3, droop=0.25, iris=0.7, iris_tall=1.18, pupil=0.42, iris_fn=F.iris_classic(C.col('iris'), 0.42, dark=0.6, band=0.8),
                 lash=0.85, flick=(0.12, 0.1), lower='outer', crease=0.45,
                 highlights=((0.38, 0.42, 0.24, 0.27), (-0.34, -0.5, 0.1, 0.11))),
        brow=dict(angle=6, w=1.25, style='thick', arch=0.016),
        mouth=dict(w=0.072, smile=0.12, style='line', weight=0.0042),
    ))
    F.nose_shadow(C, side=-1, length=0.05)
    L = []
    for i, a in enumerate(np.linspace(-40, 40, 7)):
        L.append(Hr.Clump(a, 0.08, 0.44, 0.21, hug=0.48, out=0.18, drop=0.42, sweep=a / 40 * 0.3, bend=0.42, fork=1 if i == 3 else 0))
    for a in (72, -72, 96, -96, 124, -124, 152, 180, 208):
        L.append(Hr.Clump(a, 0.22, 0.42, 0.2, hug=0.48, out=0.28, drop=0.55, bend=0.4))
    L.append(Hr.Clump(160, 0.04, 0.3, 0.16, hug=0.0, out=0.9, drop=0.5, bend=0.3, avoid=False))
    cap = Hr.cap(C, front=0.2, temple=-0.1, back=-0.32, grow=0.06, crown_lift=0.02)
    Hr.build(C, L, cap, paint=Hr.painter(YOUNG['hair'], band_z=0.2, band_color='#3E3A48', under=0.5))
    K.kimono(C, 'kimono', hem=P.z_hip - 0.08 * H, sleeves='standard', wide=0.02, drop=0.02, collar='kimono', grow=0.01, hem_r=1.6, wrap=True)
    K.hakama(C, 'hakama', painter=K.stripes(YOUNG['hakama'], YOUNG['stripe'], period=0.016, width=0.3, axis='around'), himo='himo')
    # the haori: a short open coat over everything, with a tied cord at the chest
    haori, rings = K.long_coat(C, 'haori', hem=P.z_hip - 0.04 * H, open_front=0.07, collar=False, wide_sleeves=0.03, drop=0.05, grow=0.02,
                               hem_r=1.9, folds=0.03, drape_count=6, name='haori')
    K.kimono_collar(C, 'haori', grow=0.026, z_bot=P.z_hip + 0.05 * H, cross=-0.25, width=0.024)
    knot = C.body.point(0.0, P.z_sh - 0.11 * H, 0.03 * H)
    obs = [M.sphere(knot, 0.012 * H, 10, 6, scale=(1.2, 0.7, 1)).build('haorihimo')]
    for s in (1, -1):
        obs.append(M.tube([knot, C.body.point(s * 0.35, P.z_sh - 0.09 * H, 0.028 * H)], [0.004 * H] * 2, n=6, samples=6).build(f'hh{s}'))
    ho = M.merge(obs, 'haoricord')
    M.finish(ho, 1)
    C.add(ho, 'himo', 'torsopart')
    # the wooden charm tag at his belt
    tag = M.rbox(C.body.point(0.45, P.z_hip + 0.0 * H, 0.04 * H) + V(0, 0, -0.03 * H), (0.012 * H, 0.003 * H, 0.022 * H), round_=0.3).build('tag')
    M.finish(tag, 1)
    C.add(tag, 'tag', 'torsopart')
    Pr.zori(C, 'zori', 'strap', tabi=YOUNG['tabi'])
    Pr.hands(C, 'skin', fist=0.45)
    return C
