"""Gear for the Eternal Eclipse's guardians and Aurelion himself (see ashen_gear.py for the conventions).

  sentinel   a Gilded Sentinel: full plate of silver and gold, a sunburst on the breast, a closed helm
             with a gold sun-crest and a lit visor slit, a white tabard
  priest     an Eclipse Priest: white and gold vestments, a veil over the face, a halo of gold rays,
             a black glass sun at the breast, glowing palms
  aurelion   the sun-god (scaled up in the game): plate of white gold chased with rays, a cloak of
             white cloth burning to light at its hem, a gold mask with a black-glass sun for a mouth
             and eyes of light, and a crown of long gold rays round a dark disc
"""
import numpy as np

import sdf
from armor import Piece, along, MAT_INDEX
from ashen_gear import smin, landmarks, mat_ids, cracks, skirt
from sky_gear import face_mask, glow_eyes


def plate_torso(L, B, R, chase_axis=18):
    zc, zw, sx, neck = L['zc'], L['zw'], L['sx'], L['neck']
    chest_c = np.array([0.0, 0.012, (zc + zw) / 2 + 0.03])
    torso_ell = sdf.ellipsoid(chest_c, (sx * 0.95, 0.18, (zc - zw) * 0.72))

    def f(p):
        z = p[:, 2]
        env = smin(B(p) - 0.03, torso_ell(p), 0.07)
        region = np.maximum(z - (zc + 0.035 - 0.04 * (p[:, 0] / sx) ** 2), (zw - 0.07) - z)
        for s in (1, -1):
            c = np.array([s * sx * 0.98, 0.0, zc - 0.09])
            region = np.maximum(region, -(np.hypot((p[:, 0] - c[0]) / 1.15, p[:, 2] - c[2]) - 0.105))
        region = np.maximum(region, -(np.hypot(p[:, 0], (p[:, 1] - neck[1]) / 1.15) - 0.1))
        rays = 0.0022 * np.cos(np.arctan2(p[:, 2] - (zc - 0.08), p[:, 0]) * chase_axis) * (p[:, 1] < 0)
        return np.maximum(np.abs(env - rays) - 0.0035, region)
    return f


def sunburst_mask(L, zc, zw):
    c = np.array([0.0, -0.2, (zc + zw) / 2 + 0.04])

    def m(q):
        r = np.hypot(q[:, 0] - c[0], q[:, 2] - c[2])
        ang = np.arctan2(q[:, 2] - c[2], q[:, 0] - c[0])
        return ((r < 0.05) | ((r < 0.11) & (np.abs(np.mod(ang * 12 / np.pi, 1) - 0.5) < 0.18))) & (q[:, 1] < 0)
    return m


def limb_plates(R, pieces, mat_fn):
    for s, side in ((1, 'l'), (-1, 'r')):
        a = R.head(f'upperarm_{side}')

        def pauldron(p, a=a, s=s):
            q = p - (a + np.array([0, 0, 0.035]))
            out = np.full(len(p), 1.0)
            for k in range(3):
                c = np.array([s * (0.02 + 0.02 * k), 0.0, -0.025 - 0.04 * k])
                e = sdf.ellipsoid(c, (0.11, 0.115, 0.07))(q)
                out = np.minimum(out, np.maximum(np.abs(e) - 0.004, -q[:, 2] - 0.04 - 0.04 * k - 0.04))
            return np.maximum(out, -(q[:, 0] * s) - 0.035)

        pieces.append(Piece(f'pauldron_{side}', pauldron, (a - 0.22, a + 0.22), mat_fn,
                            skin={'bone': f'upperarm_{side}', 'blend': [(f'clavicle_{side}', None, None)]}, budget=2000))
        ea, wa = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def vambrace(p, ea=ea, wa=wa):
            t, rad = along(p, ea, wa)
            return np.maximum(np.abs(rad - (0.05 + 0.014 * t)) - 0.0035, np.maximum(0.15 - t, t - 0.95))

        pieces.append(Piece(f'vambrace_{side}', vambrace, ((ea + wa) / 2 - 0.22, (ea + wa) / 2 + 0.22), mat_fn, skin={'bone': f'lowerarm_{side}'}, budget=1400))
        knee, ankle = R.head(f'calf_{side}'), R.head(f'foot_{side}')

        def greave(p, knee=knee, ankle=ankle):
            t, rad = along(p, knee, ankle)
            return np.maximum(np.abs(rad - (0.06 + 0.012 * (1 - t))) - 0.0035, np.maximum(-0.1 - t, t - 0.92))

        pieces.append(Piece(f'greave_{side}', greave, ((knee + ankle) / 2 - 0.3, (knee + ankle) / 2 + 0.3), mat_fn, skin={'bone': f'calf_{side}'}, budget=1400))
        hip, kn = R.head(f'thigh_{side}'), R.head(f'calf_{side}')

        def cuisse(p, hip=hip, kn=kn):
            t, rad = along(p, hip, kn)
            return np.maximum(np.abs(rad - (0.085 - 0.02 * t)) - 0.0035, np.maximum(0.2 - t, t - 0.98))

        pieces.append(Piece(f'cuisse_{side}', cuisse, ((hip + kn) / 2 - 0.3, (hip + kn) / 2 + 0.3), mat_fn, skin={'bone': f'thigh_{side}'}, budget=1400))


def undersuit(B, neck, mat):
    def f(p):
        return np.maximum(np.abs(B(p) - 0.006) - 0.0022, p[:, 2] - (neck[2] + 0.03))
    return Piece('undersuit', f, (np.array([-0.95, -0.35, -0.02]), np.array([0.95, 0.35, neck[2] + 0.06])), mat, skin='transfer', voxel=0.0034, budget=8000, inner=B)


# =============================================================================================
def sentinel(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = [undersuit(B, neck, 'mail')]
    burst = sunburst_mask(L, zc, zw)
    pieces.append(Piece('cuirass', plate_torso(L, B, R), (np.array([-sx * 1.2, -0.27, zw - 0.1]), np.array([sx * 1.2, 0.27, zc + 0.08])),
                        lambda p: mat_ids(p, 'silver', [(burst, 'gold'), (lambda q: q[:, 2] < zw - 0.03, 'gold')]),
                        skin={'bone': 'spine_03', 'blend': [('spine_02', zw + 0.06, zw)]}, voxel=0.0028, budget=5500, inner=B))
    limb_plates(R, pieces, lambda p: mat_ids(p, 'silver', [(lambda q: sdf.fbm(q, 30, 2, 801) > 0.8, 'gold')]))
    zk = R.head('calf_l')[2]
    pieces.append(Piece('tabard', skirt(L, zw - 0.02, zk + 0.06, sx * 0.85, 0.15, 0.05, 0.015, 802, slit=0.03, slit_from=zw - 0.05, folds=0.01),
                        (np.array([-0.55, -0.45, zk - 0.05]), np.array([0.55, 0.45, zw + 0.02])),
                        lambda p: mat_ids(p, 'cloth_white', [(lambda q: q[:, 2] < zk + 0.12, 'gold')]), skin='transfer_skirt', voxel=0.0034, budget=4000))
    hc = skull + np.array([0, 0.0, 0.02])

    def helm(p):
        z = p[:, 2]
        dome = sdf.ellipsoid(hc, (0.118, 0.135, 0.15))(p)
        shell = np.maximum(np.abs(dome) - 0.004, (neck[2] - 0.01) - z)
        visor = np.maximum(np.abs(z - eyes[2]) - 0.007, np.maximum(p[:, 1] - (hc[1] - 0.05), np.abs(p[:, 0]) - 0.075))
        crest = np.full(len(p), 1.0)
        for k in range(7):
            a = np.pi * (0.15 + 0.7 * k / 6)
            c0 = hc + np.array([0, 0.0, 0.12])
            c1 = c0 + np.array([np.cos(a) * 0.16, 0.0, np.sin(a) * 0.14])
            crest = np.minimum(crest, sdf.capsule(c0, c1, 0.012, 0.004)(p))
        return np.minimum(np.maximum(shell, -visor), crest)

    pieces.append(Piece('helm', helm, (hc - np.array([0.24, 0.22, 0.24]), hc + np.array([0.24, 0.22, 0.3])),
                        lambda p: mat_ids(p, 'silver', [(lambda q: q[:, 2] > hc[2] + 0.11, 'gold'), (lambda q: np.abs(q[:, 2] - (eyes[2] + 0.03)) < 0.008, 'gold')]),
                        skin={'bone': 'head'}, voxel=0.0018, budget=3600))
    pieces.append(Piece('visorglow', lambda p: np.maximum(np.abs(p[:, 2] - eyes[2]) - 0.005, np.maximum(np.abs(p[:, 0]) - 0.065, np.abs(p[:, 1] - (eyes[1] - 0.01)) - 0.008)),
                        (eyes - 0.09, eyes + 0.09), 'sunglow', skin={'bone': 'head'}, voxel=0.0012, budget=300))
    return pieces


# =============================================================================================
def priest(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    def vest(p):
        z = p[:, 2]
        env = B(p) - 0.014
        return np.maximum(np.abs(env) - 0.003, np.maximum(z - (neck[2] + 0.02), (zw - 0.06) - z))

    sun_c = np.array([0.0, -0.18, (zc + zw) / 2 + 0.05])
    pieces.append(Piece('vest', vest, (np.array([-0.9, -0.3, zw - 0.1]), np.array([0.9, 0.3, neck[2] + 0.05])),
                        lambda p: mat_ids(p, 'cloth_white', [(lambda q: (np.abs(q[:, 0]) < 0.05) & (q[:, 1] < 0), 'gold')]), skin='transfer', voxel=0.0032, budget=6000, inner=B))
    pieces.append(Piece('blacksun', lambda p: sdf.ellipsoid(sun_c, (0.06, 0.03, 0.06))(p), (sun_c - 0.1, sun_c + 0.1),
                        lambda p: np.where(np.hypot(p[:, 0] - sun_c[0], p[:, 2] - sun_c[2]) > 0.05, MAT_INDEX['sunglow'], MAT_INDEX['voidglass']),
                        skin={'bone': 'spine_03'}, voxel=0.0014, budget=600))
    pieces.append(Piece('robe', skirt(L, zw + 0.02, 0.03, sx * 0.95, 0.16, 0.2, 0.02, 811, folds=0.016),
                        (np.array([-0.62, -0.52, -0.03]), np.array([0.62, 0.52, zw + 0.05])),
                        lambda p: mat_ids(p, 'cloth_white', [(lambda q: q[:, 2] < 0.12, 'gold'), (lambda q: (np.abs(q[:, 0]) < 0.04) & (q[:, 1] < 0), 'gold')]),
                        skin='transfer_skirt', voxel=0.0036, budget=6000))
    for side in 'lr':
        ea, wa = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def sleeve(p, ea=ea, wa=wa):
            t, rad = along(p, ea, wa)
            env = rad - (0.06 + 0.09 * np.clip(t, 0, 1) ** 1.5)
            return np.maximum(np.abs(env) - 0.003, np.maximum(-0.05 - t, t - 0.88))

        pieces.append(Piece(f'sleeve_{side}', sleeve, ((ea + wa) / 2 - 0.27, (ea + wa) / 2 + 0.27),
                            lambda p, ea=ea, wa=wa: np.where(along(p, ea, wa)[0] > 0.8, MAT_INDEX['gold'], MAT_INDEX['cloth_white']),
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'upperarm_{side}', None, None)]}, budget=1800))
        hb = R.head(f'hand_{side}')
        pieces.append(Piece(f'hand_{side}', lambda p, ea=ea, wa=wa: np.maximum(B(p) - 0.004, 0.7 - along(p, ea, wa)[0]), (hb - 0.18, hb + 0.18),
                            lambda p: mat_ids(p, 'gold', [(lambda q: cracks(q, 18, 0.03, 812), 'sunglow')]), skin='transfer', voxel=0.0022, budget=2200))
    head_ell = sdf.ellipsoid(skull + np.array([0, 0.012, 0.01]), (0.11, 0.13, 0.14))

    def veil(p):
        z = p[:, 2]
        env = smin(B(p) - 0.024, head_ell(p) - 0.016, 0.04)
        region = np.maximum((zc - 0.02) - z, np.hypot(p[:, 0], p[:, 1] * 1.15) - 0.3)
        return np.maximum(np.abs(env) - 0.0026, region)

    pieces.append(Piece('veil', veil, (np.array([-0.3, -0.3, zc - 0.06]), np.array([0.3, 0.3, L['top'] + 0.08])),
                        lambda p: mat_ids(p, 'cloth_white', [(lambda q: np.abs(q[:, 2] - (eyes[2] + 0.04)) < 0.008, 'gold')]), skin='transfer', voxel=0.003, budget=3800))
    hc = skull + np.array([0, 0.1, 0.05])

    def halo(p):
        q = p - hc
        disc = np.maximum(np.abs(np.hypot(q[:, 0], q[:, 2]) - 0.17) - 0.012, np.abs(q[:, 1]) - 0.006)
        rays = np.full(len(p), 1.0)
        for i in range(16):
            a = i / 16 * 2 * np.pi
            c0 = hc + np.array([np.cos(a) * 0.17, 0, np.sin(a) * 0.17])
            c1 = hc + np.array([np.cos(a) * (0.27 + 0.05 * (i % 2)), 0.004, np.sin(a) * (0.27 + 0.05 * (i % 2))])
            rays = np.minimum(rays, sdf.capsule(c0, c1, 0.008, 0.002)(p))
        return np.minimum(disc, rays)

    pieces.append(Piece('halo', halo, (hc - np.array([0.36, 0.05, 0.36]), hc + np.array([0.36, 0.05, 0.36])), 'gold', skin={'bone': 'head'}, voxel=0.0018, budget=2600))
    return pieces


# =============================================================================================
def aurelion(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = [undersuit(B, neck, 'cloth_white')]
    burst = sunburst_mask(L, zc, zw)
    pieces.append(Piece('cuirass', plate_torso(L, B, R, 24), (np.array([-sx * 1.2, -0.27, zw - 0.1]), np.array([sx * 1.2, 0.27, zc + 0.08])),
                        lambda p: mat_ids(p, 'gold', [(burst, 'sunglow'), (lambda q: np.abs(q[:, 0]) > sx * 0.6, 'silver')]),
                        skin={'bone': 'spine_03', 'blend': [('spine_02', zw + 0.06, zw)]}, voxel=0.0028, budget=6000, inner=B))
    limb_plates(R, pieces, lambda p: mat_ids(p, 'gold', [(lambda q: sdf.fbm(q, 24, 2, 821) > 0.72, 'silver')]))

    def cloak(p):
        z = p[:, 2]
        back = p[:, 1] - 0.02
        env = B(p) - 0.045 - 0.012 * np.sin(p[:, 0] * 40) * np.clip((zc - z) / 0.6, 0, 1)
        flare = 0.12 * np.clip((zc - z) / max(zc, 0.1), 0, 1) ** 1.2
        shell = np.abs(env - flare) - 0.004
        return np.maximum(shell, np.maximum(np.maximum(-back, z - (zc + 0.02)), 0.08 - z))

    pieces.append(Piece('cloak', cloak, (np.array([-0.75, -0.05, 0.0]), np.array([0.75, 0.75, zc + 0.08])),
                        lambda p: mat_ids(p, 'cloth_white', [(lambda q: q[:, 2] < 0.3 + 0.08 * sdf.fbm(q, 6, 2, 822), 'sunglow')]),
                        skin='transfer_skirt', voxel=0.0036, budget=6000))
    zk = R.head('calf_l')[2]
    pieces.append(Piece('fauld', skirt(L, zw - 0.02, zk + 0.12, sx * 0.88, 0.16, 0.06, 0.0, 823, slit=0.035, slit_from=zw - 0.04),
                        (np.array([-0.55, -0.45, zk]), np.array([0.55, 0.45, zw + 0.02])),
                        lambda p: mat_ids(p, 'gold', [(lambda q: np.abs(np.mod(q[:, 2] * 25, 1) - 0.5) < 0.08, 'silver')]), skin='transfer_skirt', voxel=0.0034, budget=4000))
    pieces.append(Piece('mask', face_mask(L, B, skull, eyes, neck, 0.011), (skull - np.array([0.12, 0.17, 0.2]), skull + np.array([0.12, 0.02, 0.08])),
                        lambda p: mat_ids(p, 'gold', [(lambda q: np.hypot(q[:, 0], q[:, 2] - (eyes[2] - 0.085)) < 0.022, 'voidglass')]),
                        skin={'bone': 'head'}, voxel=0.0015, budget=2800))
    pieces.append(Piece('eyes', glow_eyes(L), (eyes - 0.08, eyes + 0.08), 'sunglow', skin={'bone': 'head'}, voxel=0.0012, budget=400))
    hc = skull + np.array([0, 0.06, 0.08])

    def crown(p):
        q = p - hc
        circlet = np.maximum(np.abs(np.hypot(p[:, 0] - skull[0], (p[:, 1] - skull[1] - 0.01) * 0.95) - 0.122) - 0.008, np.abs(p[:, 2] - (eyes[2] + 0.06)) - 0.014)
        disc = np.maximum(np.hypot(q[:, 0], q[:, 2] - 0.06) - 0.12, np.abs(q[:, 1] - 0.05) - 0.012)
        rays = np.full(len(p), 1.0)
        for i in range(13):
            a = np.pi * (0.05 + 0.9 * i / 12)
            c0 = hc + np.array([np.cos(a) * 0.1, 0.05, 0.06 + np.sin(a) * 0.1])
            ln = 0.3 + 0.14 * np.sin(np.pi * i / 12)
            c1 = hc + np.array([np.cos(a) * (0.1 + ln), 0.06, 0.06 + np.sin(a) * (0.1 + ln)])
            rays = np.minimum(rays, sdf.capsule(c0, c1, 0.014, 0.003)(p))
        return np.minimum(np.minimum(circlet, disc), rays)

    def crown_mats(p):
        q = p - hc
        m = np.full(len(p), MAT_INDEX['gold'])
        m[(np.hypot(q[:, 0], q[:, 2] - 0.06) < 0.11) & (np.abs(q[:, 1] - 0.05) < 0.014)] = MAT_INDEX['voidglass']
        m[np.linalg.norm(q - np.array([0, 0.06, 0.06]), axis=1) > 0.32] = MAT_INDEX['sunglow']
        return m

    pieces.append(Piece('crown', crown, (hc - np.array([0.5, 0.12, 0.2]), hc + np.array([0.5, 0.16, 0.56])), crown_mats, skin={'bone': 'head'}, voxel=0.0022, budget=5000))
    return pieces
