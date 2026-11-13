"""Gear for the Drowned Empire's enemies and its god (see ashen_gear.py for the conventions).

  reaver      a legionary of the sunken empire: verdigris lorica segmentata over kelp-wrapped limbs,
              a crested galea with cheek guards and sea-glow eyes, kelp pteruges, bronze greaves
  tidecaller  Thaloryn's priestess: a teal robe stitched with glowing sigils, a kelp shawl, a coral
              crown on the hood and a nacre mask
  thaloryn    the drowned sea-king (scaled up in the game): scaled skin veined with sea-glow, a bronze
              cuirass worked with waves, a coral crown, a kelp beard and a cape of kelp
"""
import numpy as np

import sdf
from armor import Piece, along, MAT_INDEX
from ashen_gear import smin, landmarks, mat_ids, cracks, skirt


def hoops(z, z0, z1, n):
    """Index and fraction of horizontal bands between z0 (top) and z1 (bottom)."""
    band = np.clip((z0 - z) / (z0 - z1) * n, 0, n - 1e-3)
    return np.floor(band), band - np.floor(band)


# =============================================================================================
def reaver(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    def wraps_field(p):
        z = p[:, 2]
        lump = 0.004 * (sdf.fbm(p, 12, 3, 301) - 0.5)
        env = B(p) - 0.006 - lump
        return np.maximum(np.abs(env) - 0.0022, z - (neck[2] + 0.03))

    pieces.append(Piece('wraps', wraps_field, (np.array([-0.95, -0.35, -0.02]), np.array([0.95, 0.35, neck[2] + 0.06])),
                        lambda p: mat_ids(p, 'kelp', [(lambda q: sdf.fbm(q, 9, 3, 302) > 0.66, 'barnacle'),
                                                      (lambda q: cracks(q, 9, 0.012, 303) & (sdf.fbm(q, 2.5, 2, 304) > 0.62), 'seaglow')]),
                        skin='transfer', voxel=0.0034, budget=10000, inner=B))

    # lorica segmentata: overlapping bronze hoops round the torso, shoulder lames
    chest_c = np.array([0.0, 0.012, (zc + zw) / 2 + 0.03])
    torso_ell = sdf.ellipsoid(chest_c, (sx * 0.9, 0.17, (zc - zw) * 0.68))

    def lorica(p):
        z = p[:, 2]
        k, f = hoops(z, zc + 0.02, zw - 0.04, 6)
        env = smin(B(p) - 0.032 - 0.004 * k, torso_ell(p) - 0.004 * k, 0.07) - 0.004 * f
        region = np.maximum(z - (zc + 0.03 - 0.04 * (p[:, 0] / sx) ** 2), (zw - 0.05) - z)
        for s in (1, -1):
            c = np.array([s * sx * 0.98, 0.0, zc - 0.09])
            region = np.maximum(region, -(np.hypot((p[:, 0] - c[0]) / 1.15, p[:, 2] - c[2]) - 0.105))
        region = np.maximum(region, -(np.hypot(p[:, 0], (p[:, 1] - neck[1]) / 1.15) - 0.1))
        return np.maximum(np.abs(env) - 0.003, region)

    pieces.append(Piece('lorica', lorica, (np.array([-sx * 1.2, -0.26, zw - 0.08]), np.array([sx * 1.2, 0.26, zc + 0.08])),
                        lambda p: mat_ids(p, 'verdigris', [(lambda q: hoops(q[:, 2], zc + 0.02, zw - 0.04, 6)[1] > 0.88, 'bronze'),
                                                           (lambda q: sdf.fbm(q, 8, 3, 305) > 0.7, 'barnacle')]),
                        skin={'bone': 'spine_03', 'blend': [('spine_02', zw + 0.06, zw)]}, voxel=0.0028, budget=5000, inner=B))
    for s, side in ((1, 'l'), (-1, 'r')):
        a, b = R.head(f'upperarm_{side}'), R.tail(f'upperarm_{side}')

        def lames(p, a=a, b=b, s=s):
            t, rad = along(p, a, b)
            band = np.clip((np.clip(t, -0.2, 1) + 0.05) / 0.11, 0, 3.999)
            step = np.floor(band)
            r_t = 0.11 - 0.01 * step + 0.006 * (band - step)
            tube = np.where(t > 0, rad - r_t, np.linalg.norm(p - a, axis=1) - r_t)
            env = smin(tube, np.linalg.norm(p - (a + np.array([0, 0, 0.02])), axis=1) - 0.12, 0.03)
            region = np.maximum(np.maximum(-(p[:, 0] * s - (a[0] * s - 0.05)), t - 0.45), (a[2] - 0.2) - p[:, 2])
            return np.maximum(np.abs(env) - 0.003, region)

        pieces.append(Piece(f'lames_{side}', lames, (a - 0.2, a + 0.2), 'verdigris',
                            skin={'bone': f'upperarm_{side}', 'blend': [(f'clavicle_{side}', None, None)]}, budget=1800))

    # galea: dome, brow ridge, cheek guards, neck guard and a crest of kelp
    hc = skull + np.array([0, 0.0, 0.03])

    def galea(p):
        z = p[:, 2]
        dome = sdf.ellipsoid(hc, (0.115, 0.13, 0.12))(p)
        shell = np.maximum(np.abs(dome) - 0.003, (eyes[2] + 0.025) - z)
        brow = np.maximum(np.abs(sdf.ellipsoid(hc, (0.122, 0.137, 0.12))(p)) - 0.004, np.abs(z - (eyes[2] + 0.03)) - 0.01)
        neckg = np.maximum(np.abs(sdf.ellipsoid(hc + np.array([0, 0.02, -0.02]), (0.13, 0.15, 0.13))(p)) - 0.003,
                           np.maximum(np.abs(z - (eyes[2] - 0.02)) - 0.035, -(p[:, 1] - hc[1])))
        cheeks = np.full(len(p), 1.0)
        for s in (1, -1):
            c = np.array([s * 0.1, hc[1] - 0.04, eyes[2] - 0.06])
            cheeks = np.minimum(cheeks, np.maximum(np.abs(sdf.ellipsoid(c, (0.03, 0.07, 0.075))(p)) - 0.003, -(p[:, 0] * s - 0.085)))
        crest = sdf.box(hc + np.array([0, 0.0, 0.17]), (0.012, 0.13, 0.06), 0.01)(p) + 0.01 * (sdf.fbm(p, 20, 2, 306) - 0.5)
        return np.minimum(np.minimum(np.minimum(shell, brow), np.minimum(neckg, cheeks)), crest)

    pieces.append(Piece('galea', galea, (hc - np.array([0.2, 0.22, 0.22]), hc + np.array([0.2, 0.22, 0.26])),
                        lambda p: mat_ids(p, 'verdigris', [(lambda q: q[:, 2] > hc[2] + 0.11, 'kelp'), (lambda q: sdf.fbm(q, 10, 3, 307) > 0.7, 'barnacle')]),
                        skin={'bone': 'head'}, voxel=0.0022, budget=3000))
    # the eyes sit forward so they glow through the mask's eye-holes
    eye_f = lambda p: np.minimum(sdf.ellipsoid(L['eye_l'] + np.array([0, -0.021, 0.001]), (0.012, 0.012, 0.006))(p),  # noqa: E731
                                 sdf.ellipsoid(L['eye_r'] + np.array([0, -0.021, 0.001]), (0.012, 0.012, 0.006))(p))
    pieces.append(Piece('eyes', eye_f, (eyes - 0.08, eyes + 0.08), 'seaglow', skin={'bone': 'head'}, voxel=0.0012, budget=400))
    face = lambda p: np.maximum(np.abs(B(p) - 0.006) - 0.002, np.maximum((neck[2] + 0.02) - p[:, 2], p[:, 2] - (eyes[2] + 0.04)))  # noqa: E731
    pieces.append(Piece('face', face, (skull - np.array([0.13, 0.16, 0.2]), skull + np.array([0.13, 0.16, 0.1])),
                        lambda p: mat_ids(p, 'kelp', [(lambda q: sdf.fbm(q, 12, 2, 308) > 0.6, 'barnacle')]), skin='transfer', voxel=0.0022, budget=2200))

    # a cavalry face-mask of bronze: the calm face of a young legionary, cast over the drowned one;
    # almond eye-holes show the sea-glow behind, verdigris streaks run down from them like tears
    def mask(p):
        z = p[:, 2]
        shell = np.abs(B(p) - 0.011) - 0.0026
        region = np.maximum(p[:, 1] - (skull[1] - 0.03), np.maximum((neck[2] + 0.04) - z, z - (eyes[2] + 0.042)))
        holes = np.full(len(p), 1.0)
        for e in (L['eye_l'], L['eye_r']):
            holes = np.minimum(holes, sdf.ellipsoid(e + np.array([0, -0.03, 0.001]), (0.016, 0.05, 0.0075))(p))
        mouth = sdf.ellipsoid(np.array([0.0, eyes[1] - 0.03, eyes[2] - 0.085]), (0.018, 0.05, 0.0035))(p)
        return np.maximum(np.maximum(shell, region), -np.minimum(holes, mouth))

    def mask_mats(p):
        tears = np.zeros(len(p), bool)
        for e in (L['eye_l'], L['eye_r']):
            wob = 0.003 * np.sin(p[:, 2] * 180 + e[0] * 50)
            tears |= (np.abs(p[:, 0] - e[0] - wob) < 0.0018 + 0.0018 * sdf.fbm(p, 40, 2, 309)) & (p[:, 2] < e[2] - 0.006) & (p[:, 2] > e[2] - 0.055 - 0.015 * sdf.fbm(p, 9, 2, 313))
        return mat_ids(p, 'bronze', [(lambda q: (sdf.fbm(q, 14, 3, 310) > 0.58) | tears, 'verdigris'),
                                     (lambda q: sdf.fbm(q, 16, 2, 311) > 0.74, 'barnacle')])

    pieces.append(Piece('mask', mask, (skull - np.array([0.12, 0.17, 0.2]), skull + np.array([0.12, 0.02, 0.08])),
                        mask_mats, skin={'bone': 'head'}, voxel=0.0016, budget=2600))

    zk = R.head('calf_l')[2]
    pieces.append(Piece('pteruges', skirt(L, zw - 0.06, zk + 0.18, sx * 0.92, 0.16, 0.06, 0.03, 309, slit=0.008, slit_from=zw - 0.07, folds=0.0),
                        (np.array([-0.5, -0.4, zk]), np.array([0.5, 0.4, zw])),
                        lambda p: mat_ids(p, 'kelp', [(lambda q: (np.abs(np.mod(np.arctan2(q[:, 1], q[:, 0]) * 12 / np.pi, 1) - 0.5) < 0.06), 'darkleather')]),
                        skin='transfer_skirt', voxel=0.0034, budget=3600))
    for s, side in ((1, 'l'), (-1, 'r')):
        knee, ankle = R.head(f'calf_{side}'), R.head(f'foot_{side}')

        def greave(p, knee=knee, ankle=ankle):
            t, rad = along(p, knee, ankle)
            env = smin(B(p) - 0.024, rad - 0.06 - 0.012 * (1 - t), 0.03)
            region = np.maximum(np.maximum(-0.05 - t, t - 0.85), (p[:, 1] - knee[1]) + 0.005)
            return np.maximum(np.abs(env) - 0.003, region)

        pieces.append(Piece(f'greave_{side}', greave, ((knee + ankle) / 2 - 0.3, (knee + ankle) / 2 + 0.3), 'verdigris',
                            skin={'bone': f'calf_{side}'}, budget=1300))
    return pieces


# =============================================================================================
def tidecaller(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []
    sigil = lambda q: (np.abs(np.mod(q[:, 2] * 7 + np.sin(q[:, 0] * 30) * 0.3, 1) - 0.5) < 0.025) & (np.abs(q[:, 0]) < 0.12) & (q[:, 1] < 0)  # noqa: E731

    def bodice(p):
        z = p[:, 2]
        env = B(p) - 0.012
        for side in 'lr':
            t, _ = along(p, R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}'))
            near = np.linalg.norm(p - R.head(f'lowerarm_{side}'), axis=1) < 0.3
            env = np.where(near & (t > 0.0), np.maximum(env, t * 0.4), env)
        return np.maximum(np.abs(env) - 0.003, np.maximum(z - (neck[2] + 0.02), (zw - 0.06) - z))

    pieces.append(Piece('bodice', bodice, (np.array([-0.9, -0.3, zw - 0.1]), np.array([0.9, 0.3, neck[2] + 0.05])),
                        lambda p: mat_ids(p, 'cloth_teal', [(sigil, 'seaglow')]), skin='transfer', voxel=0.0032, budget=6000, inner=B))
    pieces.append(Piece('robe', skirt(L, zw + 0.02, 0.04, sx * 0.92, 0.15, 0.2, 0.05, 311, folds=0.014),
                        (np.array([-0.6, -0.5, -0.03]), np.array([0.6, 0.5, zw + 0.05])),
                        lambda p: mat_ids(p, 'cloth_teal', [(lambda q: q[:, 2] < 0.1 + 0.05 * sdf.fbm(q, 8, 2, 312), 'kelp'), (sigil, 'seaglow')]),
                        skin='transfer_skirt', voxel=0.0036, budget=6000))
    for side in 'lr':
        ea, wa = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def sleeve(p, ea=ea, wa=wa):
            t, rad = along(p, ea, wa)
            env = rad - (0.06 + 0.08 * np.clip(t, 0, 1) ** 1.4)
            return np.maximum(np.abs(env) - 0.003, np.maximum(-0.05 - t, t - 0.85))

        pieces.append(Piece(f'sleeve_{side}', sleeve, ((ea + wa) / 2 - 0.25, (ea + wa) / 2 + 0.25),
                            lambda p, ea=ea, wa=wa: np.where(along(p, ea, wa)[0] > 0.75, MAT_INDEX['seaglow'], MAT_INDEX['cloth_teal']),
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'upperarm_{side}', None, None)]}, budget=1800))
        hb = R.head(f'hand_{side}')
        pieces.append(Piece(f'hand_{side}', lambda p, ea=ea, wa=wa: np.maximum(B(p) - 0.004, 0.7 - along(p, ea, wa)[0]), (hb - 0.18, hb + 0.18),
                            lambda p: mat_ids(p, 'kelp', [(lambda q: cracks(q, 30, 0.03, 313), 'seaglow')]), skin='transfer', voxel=0.0022, budget=2400))
    head_ell = sdf.ellipsoid(skull + np.array([0, 0.012, 0.01]), (0.11, 0.13, 0.14))

    def hood(p):
        z = p[:, 2]
        env = smin(B(p) - 0.03, head_ell(p) - 0.02, 0.04)
        region = np.maximum((zc - 0.04) - z, np.hypot(p[:, 0], p[:, 1] * 1.15) - (0.3 - 0.55 * np.clip(z - zc, 0, 0.2)))
        face = np.hypot(p[:, 0] / 0.075, (p[:, 2] - (eyes[2] - 0.025)) / 0.1) - 1.0
        opening = np.maximum(face, p[:, 1] - (skull[1] - 0.02))
        return np.maximum(np.maximum(np.abs(env) - 0.0032, region), -opening)

    pieces.append(Piece('hood', hood, (np.array([-0.3, -0.3, zc - 0.08]), np.array([0.3, 0.3, L['top'] + 0.08])), 'cloth_teal', skin='transfer', voxel=0.003, budget=4000))

    def crown(p):
        c = skull + np.array([0, 0.01, 0.12])
        ring = np.maximum(np.abs(np.hypot(p[:, 0], (p[:, 1] - c[1]) * 0.95) - 0.125) - 0.008, np.abs(p[:, 2] - c[2]) - 0.012)
        spikes = np.full(len(p), 1.0)
        for i in range(9):
            ang = -np.pi / 2 + (i - 4) * 0.33
            b0 = c + np.array([np.cos(ang) * 0.125, np.sin(ang) * 0.13, 0])
            tip = b0 + np.array([np.cos(ang) * 0.03, np.sin(ang) * 0.03, 0.07 + 0.05 * (1 - abs(i - 4) / 4)])
            spikes = np.minimum(spikes, sdf.capsule(b0, tip, 0.012, 0.003)(p))
        return np.minimum(ring, spikes) + 0.003 * (sdf.fbm(p, 30, 2, 314) - 0.5)

    pieces.append(Piece('crown', crown, (skull - np.array([0.2, 0.2, 0.0]), skull + np.array([0.2, 0.2, 0.3])), 'barnacle', skin={'bone': 'head'}, voxel=0.0018, budget=2000))

    def mask(p):
        c = skull + np.array([0, -0.035, -0.015])
        face = sdf.ellipsoid(c, (0.07, 0.1, 0.1))(p)
        shell = np.maximum(np.abs(face) - 0.003, p[:, 1] - (c[1] - 0.035))
        holes = np.minimum(sdf.ellipsoid(L['eye_l'] + np.array([0, -0.02, 0]), (0.016, 0.05, 0.008))(p),
                           sdf.ellipsoid(L['eye_r'] + np.array([0, -0.02, 0]), (0.016, 0.05, 0.008))(p))
        return np.maximum(shell, -holes)

    pieces.append(Piece('mask', mask, (skull - np.array([0.1, 0.2, 0.14]), skull + np.array([0.1, 0.05, 0.12])),
                        lambda p: mat_ids(p, 'pearl', [(lambda q: cracks(q, 22, 0.012, 315), 'seaglow')]), skin={'bone': 'head'}, voxel=0.0018, budget=2000))
    eye_f = lambda p: np.minimum(sdf.sphere(L['eye_l'] + np.array([0, -0.025, 0]), 0.014)(p), sdf.sphere(L['eye_r'] + np.array([0, -0.025, 0]), 0.014)(p))  # noqa: E731
    pieces.append(Piece('eyes', eye_f, (eyes - 0.08, eyes + 0.08), 'seaglow', skin={'bone': 'head'}, voxel=0.0015, budget=300))

    def shawl(p):
        z = p[:, 2]
        env = B(p) - 0.032 - 0.006 * np.sin(p[:, 0] * 50)
        r = np.hypot(p[:, 0], p[:, 1] * 1.3)
        hem = (zc - 0.22) + 0.06 * (sdf.fbm(np.column_stack([p[:, 0] * 4, p[:, 1] * 4, np.zeros_like(z)]), 3, 2, 316) - 0.5)
        region = np.maximum(np.maximum(z - neck[2], hem - z), r - 0.36)
        return np.maximum(np.abs(env) - 0.0035, region)

    pieces.append(Piece('shawl', shawl, (np.array([-0.42, -0.32, zc - 0.32]), np.array([0.42, 0.32, neck[2] + 0.04])), 'kelp', skin='transfer', voxel=0.003, budget=2600, inner=B))
    return pieces


# =============================================================================================
def thaloryn(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    def skin(p):
        scales = 0.0015 * np.sin(p[:, 0] * 260 + np.sin(p[:, 2] * 260) * 1.5) * np.sin(p[:, 2] * 260)
        return np.abs(B(p) - 0.004 - scales) - 0.003

    pieces.append(Piece('skin', skin, (np.array([-1.0, -0.36, -0.03]), np.array([1.0, 0.36, L['top'] + 0.03])),
                        lambda p: mat_ids(p, 'verdigris', [(lambda q: (cracks(q, 5, 0.013, 401) & (sdf.fbm(q, 2.2, 2, 405) > 0.52))
                                                                      | (cracks(q, 11, 0.008, 402) & (sdf.fbm(q, 2.2, 2, 405) > 0.64)), 'seaglow'),
                                                           (lambda q: sdf.fbm(q, 7, 3, 403) > 0.68, 'barnacle')]),
                        skin='transfer', voxel=0.0034, budget=14000, inner=B))
    eye_f = lambda p: np.minimum(sdf.sphere(L['eye_l'] + np.array([0, -0.004, 0]), 0.013)(p), sdf.sphere(L['eye_r'] + np.array([0, -0.004, 0]), 0.013)(p))  # noqa: E731
    pieces.append(Piece('eyes', eye_f, (eyes - 0.08, eyes + 0.08), 'seaglow', skin={'bone': 'head'}, voxel=0.0015, budget=300))

    # cuirass worked with breaking waves, a sea-glow pearl at its heart
    chest_c = np.array([0.0, 0.012, (zc + zw) / 2 + 0.03])
    torso_ell = sdf.ellipsoid(chest_c, (sx * 0.96, 0.19, (zc - zw) * 0.72))
    core_c = np.array([0.0, -0.2, zc - 0.12])

    def cuirass(p):
        z = p[:, 2]
        r = np.maximum(z - (zc + 0.05 - 0.03 * (np.abs(p[:, 0]) / sx) ** 2), (zw - 0.04) - z)
        for s in (1, -1):
            c = np.array([s * sx * 0.98, 0.0, zc - 0.09])
            r = np.maximum(r, -(np.hypot((p[:, 0] - c[0]) / 1.15, p[:, 2] - c[2]) - 0.11))
        r = np.maximum(r, -(np.hypot(p[:, 0], (p[:, 1] - neck[1]) / 1.15) - 0.11))
        waves = 0.004 * np.sin(p[:, 0] * 40 + np.sin(p[:, 2] * 25) * 2.0) * (p[:, 1] < 0)
        env = smin(B(p) - 0.034, torso_ell(p), 0.08) - waves - 0.007 * np.exp(-(r / 0.008) ** 2)
        core = np.linalg.norm((p - core_c) * np.array([1, 2.5, 1]), axis=1) - 0.05
        return np.maximum(np.maximum(np.abs(env) - 0.0035, r), -core)

    pieces.append(Piece('cuirass', cuirass, (np.array([-sx * 1.25, -0.28, zw - 0.06]), np.array([sx * 1.25, 0.28, zc + 0.1])),
                        lambda p: mat_ids(p, 'bronze', [(lambda q: np.abs(np.sin(q[:, 0] * 40 + np.sin(q[:, 2] * 25) * 2.0)) > 0.92, 'verdigris'),
                                                       (lambda q: sdf.fbm(q, 8, 3, 404) > 0.68, 'barnacle')]),
                        skin={'bone': 'spine_03', 'blend': [('spine_02', zw + 0.06, zw)]}, voxel=0.0028, budget=6000, inner=B))
    pieces.append(Piece('pearl', sdf.sphere(core_c + np.array([0, 0.025, 0]), 0.05), (core_c - 0.09, core_c + 0.09), 'seaglow',
                        skin={'bone': 'spine_03'}, voxel=0.002, budget=500))

    # coral crown, tall and branching
    cc = skull + np.array([0, 0.0, 0.07])

    def crown(p):
        ring = np.maximum(np.abs(np.hypot(p[:, 0], (p[:, 1] - cc[1]) * 0.92) - 0.11) - 0.012, np.abs(p[:, 2] - cc[2]) - 0.02)
        rng = np.random.default_rng(405)
        branches = np.full(len(p), 1.0)
        for i in range(11):
            ang = -np.pi / 2 + (i - 5) * 0.3
            b0 = cc + np.array([np.cos(ang) * 0.11, np.sin(ang) * 0.12, 0.01])
            k = 1 - abs(i - 5) / 7
            mid = b0 + np.array([np.cos(ang) * 0.04, np.sin(ang) * 0.03, 0.12 * k + 0.05])
            tip = mid + np.array([rng.normal(0, 0.03), rng.normal(0, 0.02), 0.08 * k + 0.03])
            fork = mid + np.array([np.cos(ang) * 0.06, np.sin(ang) * 0.04, 0.05])
            branches = np.minimum(branches, np.minimum(sdf.capsule(b0, mid, 0.014, 0.009)(p), sdf.capsule(mid, tip, 0.009, 0.003)(p)))
            branches = np.minimum(branches, sdf.capsule(mid, fork, 0.007, 0.002)(p))
        return np.minimum(ring, branches) + 0.003 * (sdf.fbm(p, 25, 2, 406) - 0.5)

    pieces.append(Piece('crown', crown, (cc - np.array([0.26, 0.24, 0.05]), cc + np.array([0.26, 0.24, 0.36])),
                        lambda p: mat_ids(p, 'barnacle', [(lambda q: np.abs(q[:, 2] - cc[2]) < 0.025, 'bronze'), (lambda q: q[:, 2] > cc[2] + 0.2, 'pearl')]),
                        skin={'bone': 'head'}, voxel=0.0022, budget=4000))

    # beard of kelp: strands hanging from the jaw to the chest
    jaw = eyes + np.array([0, -0.02, -0.1])

    def beard(p):
        d = np.full(len(p), 1.0)
        rng = np.random.default_rng(407)
        for i in range(14):
            x0 = (i / 13 - 0.5) * 0.12
            a = jaw + np.array([x0, -0.01 * (1 - abs(x0) / 0.06), 0.0])
            ln = 0.14 + 0.08 * rng.random()
            m = a + np.array([x0 * 0.4, -0.05, -ln * 0.5])
            b = a + np.array([x0 * 0.6 + rng.normal(0, 0.01), -0.07, -ln])
            d = np.minimum(d, np.minimum(sdf.capsule(a, m, 0.012, 0.009)(p), sdf.capsule(m, b, 0.009, 0.003)(p)))
        return d

    pieces.append(Piece('beard', beard, (jaw - np.array([0.12, 0.14, 0.3]), jaw + np.array([0.12, 0.06, 0.04])), 'kelp',
                        skin={'bone': 'head', 'blend': [('neck_01', jaw[2] - 0.2, jaw[2] - 0.05)]}, voxel=0.0018, budget=2400))

    back_y = float(R.head('spine_03')[1]) + 0.18

    def cape(p):
        z = p[:, 2]
        k = np.clip((zc - z) / zc, 0, 1)
        y0 = back_y + 0.02 + 0.25 * k ** 1.3
        sheet = np.abs(p[:, 1] - y0 - 0.015 * np.sin(p[:, 0] * 30 + z * 10) * k) - 0.004
        width = np.abs(p[:, 0]) - (sx * 0.85 + 0.3 * k)
        hem = 0.04 + 0.1 * (sdf.fbm(np.column_stack([p[:, 0] * 5, np.zeros_like(z), np.zeros_like(z)]), 3, 3, 408) - 0.5)
        region = np.maximum(np.maximum(hem - z, z - (zc + 0.04)), width)
        strips = (np.abs(np.mod(p[:, 0] * 14, 1) - 0.5) - 0.44) * (k > 0.35) * 0.05
        return np.maximum(np.maximum(sheet, region), strips)

    pieces.append(Piece('cape', cape, (np.array([-0.75, -0.05, 0.0]), np.array([0.75, 0.8, zc + 0.1])),
                        lambda p: mat_ids(p, 'kelp', [(lambda q: q[:, 2] > zc - 0.06, 'bronze'), (lambda q: sdf.fbm(q, 8, 2, 409) > 0.7, 'barnacle')]),
                        skin='transfer_skirt', voxel=0.0036, budget=5000))
    zk = R.head('calf_l')[2]
    # a skirt of scales to the feet (the god rises from the water; this is all that shows of his coils)
    pieces.append(Piece('scales', skirt(L, zw - 0.04, 0.03, sx * 1.0, 0.17, 0.12, 0.03, 410, folds=0.01),
                        (np.array([-0.6, -0.5, -0.02]), np.array([0.6, 0.5, zw])),
                        lambda p: mat_ids(p, 'verdigris', [(lambda q: np.abs(np.mod(q[:, 2] * 18 + np.mod(np.arctan2(q[:, 1], q[:, 0]) * 8, 1) * 0.5, 1) - 0.5) < 0.08, 'bronze'),
                                                           (lambda q: cracks(q, 7, 0.012, 411) & (sdf.fbm(q, 2, 2, 412) > 0.58), 'seaglow')]),
                        skin='transfer_skirt', voxel=0.0036, budget=6000))
    for s, side in ((1, 'l'), (-1, 'r')):
        la, lb = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def bracer(p, la=la, lb=lb):
            t, rad = along(p, la, lb)
            return np.maximum(np.abs(rad - (0.062 + 0.012 * t + 0.02 * np.clip((t - 0.75) / 0.25, 0, 1))) - 0.0034, np.maximum(0.1 - t, t - 0.97))

        pieces.append(Piece(f'bracer_{side}', bracer, ((la + lb) / 2 - 0.22, (la + lb) / 2 + 0.22), 'bronze',
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'hand_{side}', None, None)]}, budget=1600))
        a = R.head(f'upperarm_{side}')

        def pauldron(p, a=a, s=s):
            shell = sdf.ellipsoid(a + np.array([s * 0.02, 0, 0.05]), (0.16, 0.15, 0.1))(p)
            fins = np.full(len(p), 1.0)
            for j in range(3):
                b0 = a + np.array([s * (0.06 + 0.04 * j), -0.06 + 0.06 * j, 0.1])
                fins = np.minimum(fins, sdf.capsule(b0, b0 + np.array([s * 0.12, 0.02, 0.12]), 0.018, 0.003)(p))
            return np.minimum(np.maximum(np.abs(shell) - 0.0035, (a[2] - 0.04) - p[:, 2]), fins)

        pieces.append(Piece(f'pauldron_{side}', pauldron, (a - 0.3, a + 0.3), lambda p: mat_ids(p, 'bronze', [(lambda q: sdf.fbm(q, 9, 3, 412 + s) > 0.66, 'barnacle')]),
                            skin={'bone': f'upperarm_{side}', 'blend': [(f'clavicle_{side}', None, None)]}, budget=2600))
    return pieces
