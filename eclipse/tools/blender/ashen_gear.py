"""Gear for the Ashen Kingdom's enemies (Ignaroth's burnt legions), sculpted like Kael's (armor.py).

Each function takes the rig (armor.Rig), the body's distance field and a few landmarks, and returns
the Pieces that cover the whole body (these characters show no skin):

  thrall         a soldier burnt hollow: charred bandage wraps split by glowing cracks, a dented
                 rusted kettle hat, half a breastplate, one pauldron, a ragged war-skirt, ember eyes
                 in the dark of a face cloth
  cinder_knight  heavy plate gone black in the fire, its seams and cracks glowing from inside; a
                 bucket great-helm with a cross visor lit by the furnace within, layered spaulders,
                 tassets over a mail skirt, a scorched tabard
  acolyte        Ignaroth's priest: a deep crimson robe with burnt hem, bell sleeves, a peaked hood
                 over a bone mask with ember eyes, a gilt stole and a mantle of dark leather

Blender axes: +X is the character's left, -Y the front, +Z up.
"""
import numpy as np

import sdf
from armor import Piece, along, smoothstep, MAT_INDEX


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def landmarks(R, info):
    L = {
        'zc': R.head('clavicle_l')[2],
        'zw': R.head('spine_01')[2],
        'zh': R.head('pelvis')[2],
        'sx': R.head('upperarm_l')[0],
        'neck': R.head('neck_01'),
        'neck_t': R.tail('neck_01'),
        'top': info['top'],
        'eye_l': info['eye_l'],
        'eye_r': info['eye_r'],
    }
    eyes = (info['eye_l'] + info['eye_r']) / 2
    # skull centre: behind the eyes, a little above them
    L['skull'] = eyes + np.array([0.0, 0.075, 0.03])
    L['eyes'] = eyes
    return L


def mat_ids(p, default, rules):
    """rules: list of (mask_fn(p) -> bool array, material); later rules win."""
    m = np.full(len(p), MAT_INDEX[default])
    for fn, name in rules:
        m[fn(p)] = MAT_INDEX[name]
    return m


def cracks(p, scale, width, seed):
    """Thin branching lines (|fbm - 0.5| small): seams for glowing cracks."""
    return np.abs(sdf.fbm(p, scale, 4, seed) - 0.5) < width


def skirt(L, z_top, z_bot, rx0, ry0, flare, hem_rag, seed, slit=0.012, slit_from=None, folds=0.0):
    """A cone of cloth from z_top down to a ragged hem around z_bot (open front/back slits)."""
    sx, zh = L['sx'], L['zh']

    def f(p):
        z = p[:, 2]
        k = np.clip((z_top - z) / (z_top - z_bot), 0, 1.3)
        rx = rx0 + flare * k
        ry = ry0 + flare * 0.8 * k
        ang = np.arctan2(p[:, 1], p[:, 0])
        fold = folds * np.sin(ang * 9 + 1.3) * k
        d = np.hypot(p[:, 0] / rx, (p[:, 1] - 0.01) / ry) * np.minimum(rx, ry) - np.minimum(rx, ry) - fold
        hem = z_bot + hem_rag * (sdf.fbm(np.column_stack([np.cos(ang) * 2, np.sin(ang) * 2, np.zeros_like(z)]), 3.0, 3, seed) - 0.5) * 2
        region = np.maximum(hem - z, z - z_top)
        if slit_from is not None:
            s = np.maximum(np.abs(p[:, 0]) - slit, slit_from - z)
            region = np.maximum(region, -s)
        return np.maximum(np.abs(d) - 0.0035, region)
    return f


# =============================================================================================
def thrall(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    # ------------------------------------------------ charred wraps over everything below the jaw
    def wraps_field(p):
        z = p[:, 2]
        stripe = np.mod(z / 0.034 + (p[:, 0] * 0.8 - p[:, 1] * 0.6) / 0.05, 1.0)
        groove = 0.0024 * np.exp(-((stripe - 0.5) / 0.1) ** 2)
        lump = 0.003 * (sdf.fbm(p, 16, 3, seed=2) - 0.5)
        env = B(p) - 0.0048 - lump + groove
        region = z - (neck[2] + 0.03)
        return np.maximum(np.abs(env) - 0.0021, region)

    def wraps_mats(p):
        burnt = sdf.fbm(p, 7, 4, seed=5) > 0.54
        return mat_ids(p, 'charcloth', [
            (lambda q: burnt, 'char'),
            (lambda q: burnt & cracks(q, 22, 0.032, 9), 'ember'),
        ])

    lo = np.array([-0.95, -0.35, -0.02])
    hi = np.array([0.95, 0.35, neck[2] + 0.06])
    pieces.append(Piece('wraps', wraps_field, (lo, hi), wraps_mats, skin='transfer', voxel=0.0034, budget=11000, inner=B))

    # ------------------------------------------------ hood and face cloth with ember eyes behind
    head_ell = sdf.ellipsoid(skull + np.array([0, 0.005, 0.0]), (0.098, 0.118, 0.13))

    def hood_field(p):
        z = p[:, 2]
        env = smin(B(p) - 0.012, head_ell(p) - 0.006, 0.03) - 0.004 * (sdf.fbm(p, 12, 3, seed=11) - 0.5)
        # drape down onto the shoulders, narrowing with height
        region = np.maximum((zc - 0.015) - z, np.hypot(p[:, 0], (p[:, 1] - 0.0) * 1.2) - (0.24 - 0.5 * np.clip(z - zc, 0, 0.2)))
        # eye slit cut through the face cloth
        slit = np.maximum(np.abs(p[:, 2] - eyes[2]) - 0.012, np.maximum(np.abs(p[:, 0]) - 0.052, p[:, 1] - (eyes[1] + 0.02)))
        return np.maximum(np.maximum(np.abs(env) - 0.0026, region), -slit)

    pieces.append(Piece('hood', hood_field, (np.array([-0.26, -0.24, zc - 0.05]), np.array([0.26, 0.24, L['top'] + 0.04])),
                        lambda p: mat_ids(p, 'charcloth', [(lambda q: sdf.fbm(q, 9, 3, 13) > 0.66, 'char')]),
                        skin='transfer', voxel=0.0028, budget=4200))

    def eyes_field(p):
        return np.minimum(sdf.sphere(L['eye_l'] + np.array([0, -0.012, 0]), 0.016)(p), sdf.sphere(L['eye_r'] + np.array([0, -0.012, 0]), 0.016)(p))

    pieces.append(Piece('eyes', eyes_field, (eyes - 0.08, eyes + 0.08), 'ember', skin={'bone': 'head'}, voxel=0.0015, budget=300))

    # ------------------------------------------------ a ragged cloak down the back
    def cloak_field(p):
        z = p[:, 2]
        env = B(p) - 0.06 - 0.05 * np.clip((zc - z) / 0.9, 0, 1) - 0.008 * np.sin(p[:, 0] * 40)
        zk = R.head('calf_l')[2]
        hem = zk + 0.05 + 0.12 * (sdf.fbm(np.column_stack([p[:, 0] * 4, np.zeros_like(z), np.zeros_like(z)]), 3, 3, 15) - 0.5)
        width = np.abs(p[:, 0]) - (sx * 0.85 + 0.12 * np.clip((zc - z) / 0.8, 0, 1))
        region = np.maximum(np.maximum(hem - z, z - (zc + 0.03)), np.maximum(width, -(p[:, 1] - 0.02)))
        holes = (sdf.fbm(p, 7, 3, 16) - 0.74) * 0.06
        return np.maximum(np.maximum(np.abs(env) - 0.003, region), holes)

    pieces.append(Piece('cloak', cloak_field, (np.array([-0.55, -0.05, R.head('calf_l')[2] - 0.15]), np.array([0.55, 0.4, zc + 0.06])),
                        lambda p: mat_ids(p, 'charcloth', [(lambda q: sdf.fbm(q, 9, 3, 17) > 0.62, 'char'),
                                                          (lambda q: (sdf.fbm(q, 9, 3, 17) > 0.62) & cracks(q, 18, 0.03, 18), 'ember')]),
                        skin='transfer_skirt', voxel=0.0034, budget=3600))

    # ------------------------------------------------ leather bracers
    for side in 'lr':
        la, lb = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def bracer_field(p, la=la, lb=lb):
            t, rad = along(p, la, lb)
            strap = 0.003 * np.exp(-((np.mod(t * 4, 1) - 0.5) / 0.12) ** 2)
            env = rad - (0.05 + 0.01 * t) - strap
            return np.maximum(np.abs(env) - 0.003, np.maximum(0.35 - t, t - 0.9))

        pieces.append(Piece(f'bracer_{side}', bracer_field, ((la + lb) / 2 - 0.2, (la + lb) / 2 + 0.2), 'darkleather',
                            skin={'bone': f'lowerarm_{side}'}, budget=900))

    # ------------------------------------------------ dented rusted kettle hat
    hat_c = skull + np.array([0, 0.0, 0.045])

    def hat_field(p):
        z = p[:, 2]
        dent = 0.006 * (sdf.fbm(p, 9, 3, seed=21) - 0.5)
        dome = sdf.ellipsoid(hat_c, (0.118, 0.13, 0.115))(p) + dent
        crown = np.maximum(np.abs(dome) - 0.0028, (hat_c[2] - 0.035) - z)
        r = np.hypot(p[:, 0] / 1.0, (p[:, 1] - hat_c[1]) / 1.08)
        brim_z = hat_c[2] - 0.035 - 0.07 * np.clip((r - 0.11) / 0.09, 0, 1) ** 1.5 + dent
        brim = np.maximum(np.abs(z - brim_z) - 0.0028, np.maximum(r - 0.205, 0.1 - r))
        rim = sdf.torus(np.array([hat_c[0], hat_c[1], hat_c[2] - 0.035]), np.array([0, 0, 1.0]), 0.116, 0.006)(p)
        return np.minimum(np.minimum(crown, brim), rim)

    pieces.append(Piece('kettle_hat', hat_field, (hat_c - np.array([0.23, 0.24, 0.13]), hat_c + np.array([0.23, 0.24, 0.13])),
                        lambda p: mat_ids(p, 'rust', [(lambda q: sdf.fbm(q, 14, 3, 25) > 0.7, 'darksteel')]),
                        skin={'bone': 'head'}, voxel=0.0024, budget=2600))

    # ------------------------------------------------ half a rusted breastplate (front, holed)
    chest_c = np.array([0.0, 0.012, (zc + zw) / 2 + 0.03])
    torso_ell = sdf.ellipsoid(chest_c, (sx * 0.84, 0.16, (zc - zw) * 0.64))

    def plate_field(p):
        z = p[:, 2]
        env = smin(B(p) - 0.03, torso_ell(p), 0.07) - 0.004 * (sdf.fbm(p, 6, 3, 31) - 0.5)
        region = np.maximum(np.maximum(z - (zc + 0.0 - 0.04 * (p[:, 0] / sx) ** 2), (zw + 0.02) - z), p[:, 1] - (chest_c[1] - 0.06))
        region = np.maximum(region, np.abs(p[:, 0]) - sx * 0.82)
        holes = (sdf.fbm(p, 5, 3, 33) - 0.72) * 0.08
        return np.maximum(np.maximum(np.abs(env) - 0.0028, region), holes)

    pieces.append(Piece('breastplate', plate_field, (np.array([-sx, -0.26, zw - 0.02]), np.array([sx, 0.1, zc + 0.05])),
                        lambda p: mat_ids(p, 'rust', [(lambda q: cracks(q, 10, 0.02, 35), 'darksteel')]),
                        skin={'bone': 'spine_03', 'blend': [('spine_02', zw + 0.06, zw)]}, voxel=0.0028, budget=2600, inner=B))

    # ------------------------------------------------ one battered pauldron (left)
    a, b = R.head('upperarm_l'), R.tail('upperarm_l')

    def pauldron_field(p):
        t, rad = along(p, a, b)
        tc = np.clip(t, 0, 1)
        band = np.clip(tc / 0.16, 0, 2.999)
        step = np.floor(band)
        r_t = 0.105 - 0.012 * step
        tube = np.where(t > 0, rad - r_t, np.linalg.norm(p - a, axis=1) - r_t)
        cap = np.linalg.norm(p - (a + np.array([0.0, 0, 0.02])), axis=1) - 0.115
        env = smin(tube, cap, 0.03) + 0.004 * (sdf.fbm(p, 8, 3, 41) - 0.5)
        side = -(p[:, 0] - (a[0] - 0.03))
        region = np.maximum(np.maximum(side, t - 0.5), (a[2] - 0.2) - p[:, 2])
        return np.maximum(np.abs(env) - 0.0028, region)

    pieces.append(Piece('pauldron_l', pauldron_field, (a - 0.2, a + 0.2), 'rust', skin={'bone': 'upperarm_l', 'blend': [('clavicle_l', None, None)]}, budget=1800))

    # ------------------------------------------------ ragged war-skirt and a rope belt
    zk = R.head('calf_l')[2]
    pieces.append(Piece('skirt', skirt(L, zw - 0.04, zk + 0.12, sx * 0.92, 0.15, 0.08, 0.06, 51, slit_from=zh - 0.12, folds=0.006),
                        (np.array([-0.5, -0.4, zk - 0.05]), np.array([0.5, 0.4, zw])),
                        lambda p: mat_ids(p, 'charcloth', [(lambda q: q[:, 2] < zk + 0.15 + 0.05 * sdf.fbm(q, 8, 2, 52), 'char'),
                                                          (lambda q: (q[:, 2] < zk + 0.16) & cracks(q, 18, 0.03, 53), 'ember')]),
                        skin='transfer_skirt', voxel=0.0034, budget=4200))
    zb = zw - 0.05

    def belt_field(p):
        env = B(p) - 0.05
        rope = np.hypot(env, (p[:, 2] - zb - 0.006 * np.sin(np.arctan2(p[:, 1], p[:, 0]) * 30))) - 0.011
        knot = sdf.sphere(np.array([0.08, -0.17, zb - 0.01]), 0.022)(p)
        tail = sdf.capsule(np.array([0.08, -0.175, zb - 0.02]), np.array([0.1, -0.18, zb - 0.2]), 0.009)(p)
        return np.minimum(np.minimum(rope, knot), tail)

    pieces.append(Piece('belt', belt_field, (np.array([-0.3, -0.3, zb - 0.25]), np.array([0.3, 0.3, zb + 0.05])), 'rope',
                        skin={'bone': 'pelvis'}, budget=1600))
    return pieces


# =============================================================================================
def cinder_knight(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    def ember_seams(p, scale, width, seed):
        return cracks(p, scale, width, seed)

    # ------------------------------------------------ under-layer: dark padded arming clothes + mail
    def under_field(p):
        z = p[:, 2]
        env = B(p) - 0.009
        region = z - (neck[2] + 0.02)
        return np.maximum(np.abs(env) - 0.003, region)

    pieces.append(Piece('arming', under_field, (np.array([-0.95, -0.35, -0.02]), np.array([0.95, 0.35, neck[2] + 0.05])),
                        lambda p: mat_ids(p, 'mail', [(lambda q: q[:, 2] < 0.12, 'darkleather')]),
                        skin='transfer', voxel=0.0036, budget=8000, inner=B))

    # ------------------------------------------------ great helm: a riveted bucket with a lit cross visor
    hc = skull + np.array([0, -0.005, 0.01])

    def helm_field(p):
        z = p[:, 2]
        q = p - hc
        # rounded-square section, slightly pointed at the front
        rx, ry = 0.128, 0.142
        sec = np.hypot(q[:, 0] / rx, (q[:, 1] + 0.01 * (q[:, 1] < 0)) / ry) * rx - rx
        sec = sec - 0.012 * np.exp(-(q[:, 0] / 0.015) ** 2) * (q[:, 1] < 0)  # front ridge
        top = (z - (L['top'] + 0.035)) + 0.06 * (q[:, 0] ** 2 + q[:, 1] ** 2) * 6
        shell = np.maximum(np.abs(np.maximum(sec, top)) - 0.0035, (neck[2] - 0.035) - z)
        # cross visor: horizontal slit at the eyes, vertical breath slit down the middle
        slit_h = np.maximum(np.abs(z - eyes[2]) - 0.009, np.abs(p[:, 0]) - 0.085)
        slit_v = np.maximum(np.abs(p[:, 0]) - 0.008, np.maximum(z - eyes[2], (eyes[2] - 0.09) - z))
        cut = np.maximum(np.minimum(slit_h, slit_v), q[:, 1] + 0.04)
        shell = np.maximum(shell, -cut)
        # reinforcing bands and rivets
        band = np.abs(z - (neck[2] - 0.02)) - 0.012
        bands = np.maximum(np.abs(sec + 0.004) - 0.004, band)
        ang = np.arctan2(q[:, 1], q[:, 0])
        rivet = np.hypot((np.mod(ang * 8 / np.pi + 0.5, 1) - 0.5) * 0.11, z - (neck[2] - 0.02)) - 0.006
        rivets = np.maximum(rivet, sec - 0.008)
        return np.minimum(np.minimum(shell, bands), rivets)

    def furnace_field(p):
        # a glowing plate just behind the visor: the fire inside the helm
        q = p - hc
        return np.maximum(np.abs(np.hypot(q[:, 0] / 0.11, q[:, 1] / 0.12) * 0.11 - 0.105) - 0.003,
                          np.maximum(q[:, 1] + 0.02, np.abs(p[:, 2] - (eyes[2] - 0.035)) - 0.07))

    def helm_mats(p):
        return mat_ids(p, 'darksteel', [
            (lambda q: np.abs(q[:, 2] - (neck[2] - 0.02)) < 0.013, 'rust'),
            (lambda q: ember_seams(q, 9, 0.012, 61) & (q[:, 2] > neck[2]), 'ember'),
        ])

    pieces.append(Piece('helm', helm_field, (hc - np.array([0.17, 0.18, 0.25]), hc + np.array([0.17, 0.18, 0.2])), helm_mats,
                        skin={'bone': 'head'}, voxel=0.0024, budget=4200))
    pieces.append(Piece('furnace', furnace_field, (hc - np.array([0.13, 0.14, 0.15]), hc + np.array([0.13, 0.05, 0.1])), 'ember',
                        skin={'bone': 'head'}, voxel=0.0025, budget=600))

    # ------------------------------------------------ cuirass with a gorget, cracked and glowing
    chest_c = np.array([0.0, 0.012, (zc + zw) / 2 + 0.03])
    torso_ell = sdf.ellipsoid(chest_c, (sx * 0.95, 0.18, (zc - zw) * 0.7))

    def torso_env(p):
        return smin(B(p) - 0.034, torso_ell(p), 0.08)

    def cuirass_field(p):
        z = p[:, 2]
        top = z - (zc + 0.06 - 0.03 * (np.abs(p[:, 0]) / sx) ** 2)
        r = np.maximum(top, (zw - 0.03) - z)
        for s in (1, -1):
            c = np.array([s * sx * 0.98, 0.0, zc - 0.09])
            r = np.maximum(r, -(np.hypot((p[:, 0] - c[0]) / 1.15, p[:, 2] - c[2]) - 0.11))
        nd = np.hypot(p[:, 0], (p[:, 1] - neck[1]) / 1.15) - 0.1
        r = np.maximum(r, -nd)
        ridge = 0.01 * np.exp(-(p[:, 0] / 0.03) ** 2) * (p[:, 1] < chest_c[1])
        roll = 0.007 * np.exp(-(r / 0.007) ** 2)
        a = torso_env(p) - ridge - roll
        return np.maximum(np.abs(a) - 0.0034 - roll * 0.3, r)

    def gorget_field(p):
        t, rad = along(p, neck + np.array([0, 0.01, -0.07]), L['neck_t'])
        band = np.clip(t * 3, 0, 2.999)
        step = np.floor(band)
        env = rad - (0.14 - 0.016 * t - 0.007 * step)
        return np.maximum(np.abs(env) - 0.003, np.maximum(-t, t - 0.45))

    pieces.append(Piece('cuirass', cuirass_field, (np.array([-sx * 1.2, -0.27, zw - 0.05]), np.array([sx * 1.2, 0.27, zc + 0.1])),
                        lambda p: mat_ids(p, 'darksteel', [(lambda q: ember_seams(q, 7, 0.011, 63), 'ember'),
                                                           (lambda q: sdf.fbm(q, 10, 3, 64) > 0.72, 'rust')]),
                        skin={'bone': 'spine_03', 'blend': [('spine_02', zw + 0.06, zw)]}, voxel=0.0028, budget=6000, inner=B))
    pieces.append(Piece('gorget', gorget_field, (neck - np.array([0.18, 0.18, 0.1]), neck + np.array([0.18, 0.18, 0.12])), 'darksteel',
                        skin={'bone': 'neck_01', 'blend': [('spine_03', neck[2] - 0.05, neck[2] + 0.01)]}, budget=2400))

    # ------------------------------------------------ faulds, tassets and a mail skirt
    hip_ell = sdf.ellipsoid(np.array([0.0, 0.01, (zw + zh) / 2]), (sx * 1.0, 0.17, 0.17))

    def fauld_field(p):
        z = p[:, 2]
        band = np.clip((zw - z) / 0.05, 0, 2.999)
        step = np.floor(band)
        env = smin(B(p) - 0.035 - 0.008 * step, hip_ell(p) - 0.007 * step, 0.06)
        region = np.maximum(z - (zw - 0.02), (zw - 0.15) - z)
        return np.maximum(np.abs(env) - 0.003, region)

    pieces.append(Piece('faulds', fauld_field, (np.array([-sx * 1.2, -0.27, zw - 0.2]), np.array([sx * 1.2, 0.27, zw])), 'darksteel',
                        skin={'bone': 'pelvis', 'blend': [('spine_01', zw - 0.03, zw + 0.01)]}, budget=2800, inner=B))
    for s, side in ((1, 'l'), (-1, 'r')):
        th_a, th_b = R.head(f'thigh_{side}'), R.tail(f'thigh_{side}')

        def tasset_field(p, th_a=th_a, th_b=th_b, s=s):
            t, rad = along(p, th_a, th_b)
            band = np.clip(t / 0.12, 0, 3.999)
            step = np.floor(band)
            env = rad - (0.12 + 0.01 * step) + 0.004 * (band - step)
            region = np.maximum(np.maximum(t - 0.48, -0.1 - t), p[:, 1] - (th_a[1] - 0.02))
            region = np.maximum(region, -(p[:, 0] * s) - 0.02)
            return np.maximum(np.abs(env) - 0.003, region)

        pieces.append(Piece(f'tasset_{side}', tasset_field, (th_a - np.array([0.22, 0.22, 0.3]), th_a + np.array([0.22, 0.12, 0.08])),
                            lambda p: mat_ids(p, 'darksteel', [(lambda q: ember_seams(q, 9, 0.012, 70 + s), 'ember')]),
                            skin={'bone': f'thigh_{side}', 'blend': [('pelvis', None, None)]}, budget=2000))
    zk = R.head('calf_l')[2]
    pieces.append(Piece('mail_skirt', skirt(L, zw - 0.08, zk + 0.06, sx * 0.98, 0.16, 0.07, 0.03, 75, slit_from=zh - 0.1),
                        (np.array([-0.5, -0.4, zk - 0.05]), np.array([0.5, 0.4, zw])), 'mail', skin='transfer_skirt', voxel=0.0034, budget=3600))

    # ------------------------------------------------ scorched tabard panels front and back
    def tabard_field(p):
        z = p[:, 2]
        k = np.clip((zw - z) / (zw - zk), 0, 1.2)
        # two sheets hanging from the belt, swinging a little forward / back as they fall
        sheet = np.minimum(np.abs(p[:, 1] - (-0.2 - 0.04 * k)), np.abs(p[:, 1] - (0.19 + 0.04 * k))) - 0.003
        sheet -= 0.004 * np.sin(p[:, 0] * 45) * k
        width = np.abs(p[:, 0]) - (0.15 - 0.025 * k)
        hem = (zk - 0.04) + 0.09 * (sdf.fbm(np.column_stack([p[:, 0] * 3, p[:, 1], np.zeros_like(z)]), 4, 3, 77) - 0.5)
        region = np.maximum(np.maximum(width, hem - z), z - (zw + 0.0))
        return np.maximum(sheet, region)

    pieces.append(Piece('tabard', tabard_field, (np.array([-0.2, -0.34, zk - 0.16]), np.array([0.2, 0.34, zw + 0.02])),
                        lambda p: mat_ids(p, 'cloth_red', [(lambda q: q[:, 2] < zk + 0.2 + 0.08 * sdf.fbm(q, 7, 2, 78), 'char'),
                                                          (lambda q: (q[:, 2] < zk + 0.22) & cracks(q, 14, 0.03, 79), 'ember')]),
                        skin='transfer_skirt', voxel=0.003, budget=2400))

    # ------------------------------------------------ spaulders, couters, vambraces, gauntlets
    for s, side in ((1, 'l'), (-1, 'r')):
        a, b = R.head(f'upperarm_{side}'), R.tail(f'upperarm_{side}')

        def spaulder_field(p, a=a, b=b, s=s):
            t, rad = along(p, a, b)
            tc = np.clip(t, -0.3, 1)
            band = np.clip((tc + 0.05) / 0.13, 0, 4.999)
            step = np.floor(band)
            frac = band - step
            r_t = 0.15 - 0.012 * step + 0.008 * frac
            tube = np.where(t > 0, rad - r_t, np.linalg.norm(p - a, axis=1) - r_t)
            cap = np.linalg.norm(p - (a + np.array([s * 0.0, 0.0, 0.035])), axis=1) - 0.16
            env = smin(tube, cap, 0.035)
            side_cut = -(p[:, 0] * s - (a[0] * s - 0.07))
            region = np.maximum(np.maximum(side_cut, t - 0.6), (a[2] - 0.28) - p[:, 2])
            return np.maximum(np.abs(env) - 0.0034, region)

        pieces.append(Piece(f'spaulder_{side}', spaulder_field, (a - 0.26, a + 0.26),
                            lambda p, s=s: mat_ids(p, 'darksteel', [(lambda q: ember_seams(q, 8, 0.012, 80 + s), 'ember')]),
                            skin={'bone': f'upperarm_{side}', 'blend': [(f'clavicle_{side}', None, None)]}, budget=3200))
        la, lb = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def couter_field(p, la=la):
            return np.maximum(np.abs(sdf.ellipsoid(la + np.array([0, 0.03, 0]), (0.07, 0.065, 0.07))(p)) - 0.003, la[1] - 0.01 - p[:, 1])

        pieces.append(Piece(f'couter_{side}', couter_field, (la - 0.12, la + 0.12), 'darksteel',
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'upperarm_{side}', None, None)]}, budget=900))

        def vamb_field(p, la=la, lb=lb):
            t, rad = along(p, la, lb)
            env = rad - (0.058 + 0.012 * t)
            return np.maximum(np.abs(env) - 0.003, np.maximum(0.12 - t, t - 0.95))

        pieces.append(Piece(f'vambrace_{side}', vamb_field, ((la + lb) / 2 - 0.2, (la + lb) / 2 + 0.2), 'darksteel',
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'hand_{side}', None, None)]}, budget=1400))
        hb = R.head(f'hand_{side}')

        def gauntlet_field(p, la=la, lb=lb):
            t, _ = along(p, la, lb)
            lame = 0.002 * np.sin(np.linalg.norm(p - lb, axis=1) * 300)
            return np.maximum(B(p) - 0.006 - lame, 0.9 - t)

        pieces.append(Piece(f'gauntlet_{side}', gauntlet_field, (hb - 0.17, hb + 0.17), 'darksteel', skin='transfer', voxel=0.0024, budget=2800))

    # ------------------------------------------------ cuisses, poleyns, greaves, sabatons
    for s, side in ((1, 'l'), (-1, 'r')):
        knee, ankle = R.head(f'calf_{side}'), R.head(f'foot_{side}')

        def legplate_field(p, knee=knee, s=s):
            z = p[:, 2]
            env = B(p) - 0.022
            region = np.maximum(z - (zh - 0.12), 0.0 - z)
            region = np.maximum(region, 0.035 - np.abs(z - knee[2]))     # gap for the knee cop
            region = np.maximum(region, 0.005 - p[:, 0] * s)              # this leg only
            return np.maximum(np.abs(env) - 0.003, region)

        def legplate_mats(p):
            return mat_ids(p, 'darksteel', [(lambda q: ember_seams(q, 9, 0.011, 90 + s), 'ember')])

        pieces.append(Piece(f'legplate_{side}', legplate_field, (np.array([knee[0] - 0.17, -0.25, -0.02]), np.array([knee[0] + 0.17, 0.25, zh - 0.08])),
                            legplate_mats, skin='transfer', voxel=0.003, budget=4200, inner=B))
        kc = knee + np.array([0, -0.06, 0.0])

        def poleyn_field(p, kc=kc, knee=knee, s=s):
            dome = sdf.ellipsoid(kc + np.array([0, 0.02, 0]), (0.058, 0.04, 0.062))(p)
            wing = sdf.ellipsoid(kc + np.array([s * 0.06, 0.035, 0.0]), (0.028, 0.055, 0.055))(p)
            env = smin(dome, wing, 0.015)
            return np.maximum(np.abs(env) - 0.003, p[:, 1] - (knee[1] - 0.005))

        pieces.append(Piece(f'poleyn_{side}', poleyn_field, (kc - 0.13, kc + 0.13), 'darksteel',
                            skin={'bone': f'calf_{side}', 'blend': [(f'thigh_{side}', None, None)]}, budget=1200))
    return pieces


# =============================================================================================
def acolyte(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    # ------------------------------------------------ robe: bodice, long burnt-hemmed skirt
    def bodice_field(p):
        z = p[:, 2]
        env = B(p) - 0.013 - 0.002 * np.sin(p[:, 0] * 90) * (p[:, 1] < 0)
        for side in 'lr':
            t, _ = along(p, R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}'))
            near = np.linalg.norm(p - R.head(f'lowerarm_{side}'), axis=1) < 0.3
            env = np.where(near & (t > 0.0), np.maximum(env, t * 0.4), env)
        region = np.maximum(z - (neck[2] + 0.02), (zw - 0.06) - z)
        return np.maximum(np.abs(env) - 0.003, region)

    pieces.append(Piece('bodice', bodice_field, (np.array([-0.9, -0.3, zw - 0.1]), np.array([0.9, 0.3, neck[2] + 0.05])),
                        'cloth_red', skin='transfer', voxel=0.0032, budget=6000, inner=B))
    pieces.append(Piece('robe_skirt', skirt(L, zw + 0.02, 0.035, sx * 0.92, 0.15, 0.17, 0.035, 101, folds=0.012),
                        (np.array([-0.6, -0.5, -0.03]), np.array([0.6, 0.5, zw + 0.05])),
                        lambda p: mat_ids(p, 'cloth_red', [(lambda q: q[:, 2] < 0.12 + 0.06 * sdf.fbm(q, 8, 2, 102), 'char'),
                                                          (lambda q: (q[:, 2] < 0.14) & cracks(q, 16, 0.03, 103), 'ember')]),
                        skin='transfer_skirt', voxel=0.0036, budget=6500))

    # ------------------------------------------------ bell sleeves over wrapped forearms and hands
    for side in 'lr':
        ea, wa = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def sleeve_field(p, ea=ea, wa=wa):
            t, rad = along(p, ea, wa)
            env = rad - (0.06 + 0.07 * np.clip(t, 0, 1) ** 1.5) - 0.004 * np.sin(np.arctan2(p[:, 1], p[:, 0]) * 7)
            return np.maximum(np.abs(env) - 0.003, np.maximum(-0.05 - t, t - 0.82))

        pieces.append(Piece(f'sleeve_{side}', sleeve_field, ((ea + wa) / 2 - 0.25, (ea + wa) / 2 + 0.25),
                            lambda p, ea=ea, wa=wa: np.where(along(p, ea, wa)[0] > 0.72, MAT_INDEX['gold'], MAT_INDEX['cloth_red']),
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'upperarm_{side}', None, None)]}, budget=1800))
        hb = R.head(f'hand_{side}')

        def hand_field(p, ea=ea, wa=wa):
            t, _ = along(p, ea, wa)
            return np.maximum(B(p) - 0.004, 0.7 - t)

        pieces.append(Piece(f'hand_{side}', hand_field, (hb - 0.18, hb + 0.18),
                            lambda p: mat_ids(p, 'charcloth', [(lambda q: cracks(q, 30, 0.03, 107), 'ember')]),
                            skin='transfer', voxel=0.0022, budget=2400))

    # ------------------------------------------------ peaked hood, bone mask, ember eyes
    head_ell = sdf.ellipsoid(skull + np.array([0, 0.012, 0.01]), (0.11, 0.13, 0.14))
    peak = sdf.capsule(skull + np.array([0, 0.06, 0.08]), skull + np.array([0, 0.14, 0.2]), 0.07, 0.01)

    def hood_field(p):
        z = p[:, 2]
        env = smin(smin(B(p) - 0.03, head_ell(p) - 0.02, 0.04), peak(p), 0.05)
        env -= 0.004 * np.sin(np.arctan2(p[:, 2] - skull[2], p[:, 0]) * 6) * (p[:, 1] > skull[1])
        region = np.maximum((zc - 0.04) - z, np.hypot(p[:, 0], p[:, 1] * 1.15) - (0.28 - 0.55 * np.clip(z - zc, 0, 0.2)))
        # the face opening: an oval tunnel from the front
        face = np.hypot(p[:, 0] / 0.075, (p[:, 2] - (eyes[2] - 0.025)) / 0.1) - 1.0
        opening = np.maximum(face, p[:, 1] - (skull[1] - 0.02))
        return np.maximum(np.maximum(np.abs(env) - 0.0032, region), -opening)

    pieces.append(Piece('hood', hood_field, (np.array([-0.3, -0.3, zc - 0.08]), np.array([0.3, 0.38, L['top'] + 0.2])),
                        lambda p: mat_ids(p, 'cloth_red', [(lambda q: (np.abs(np.hypot(q[:, 0] / 0.075, (q[:, 2] - (eyes[2] - 0.025)) / 0.1) - 1.05) < 0.08) & (q[:, 1] < skull[1] - 0.04), 'gold')]),
                        skin='transfer', voxel=0.003, budget=4200))

    def mask_field(p):
        c = skull + np.array([0, -0.035, -0.015])
        face = sdf.ellipsoid(c, (0.072, 0.1, 0.105))(p)
        shell = np.maximum(np.abs(face) - 0.003, p[:, 1] - (c[1] - 0.035))
        holes = np.minimum(sdf.ellipsoid(L['eye_l'] + np.array([0, -0.02, 0]), (0.015, 0.05, 0.009))(p),
                           sdf.ellipsoid(L['eye_r'] + np.array([0, -0.02, 0]), (0.015, 0.05, 0.009))(p))
        ridge = sdf.capsule(np.array([0, c[1] - 0.1, eyes[2] + 0.06]), np.array([0, c[1] - 0.1, eyes[2] - 0.06]), 0.004)(p)
        return np.minimum(np.maximum(shell, -holes), np.maximum(ridge, -face - 0.004))

    pieces.append(Piece('mask', mask_field, (skull - np.array([0.1, 0.2, 0.14]), skull + np.array([0.1, 0.05, 0.12])),
                        lambda p: mat_ids(p, 'bone', [(lambda q: np.abs(q[:, 0]) < 0.006, 'gold'),
                                                     (lambda q: cracks(q, 20, 0.015, 111), 'ember')]),
                        skin={'bone': 'head'}, voxel=0.0018, budget=2400))

    def eyes_field(p):
        return np.minimum(sdf.sphere(L['eye_l'] + np.array([0, -0.025, 0]), 0.014)(p), sdf.sphere(L['eye_r'] + np.array([0, -0.025, 0]), 0.014)(p))

    pieces.append(Piece('eyes', eyes_field, (eyes - 0.08, eyes + 0.08), 'ember', skin={'bone': 'head'}, voxel=0.0015, budget=300))

    # ------------------------------------------------ leather mantle with gilt edge, stole, rope belt
    def mantle_field(p):
        z = p[:, 2]
        env = B(p) - 0.03
        r = np.hypot(p[:, 0], p[:, 1] * 1.3)
        region = np.maximum(np.maximum(z - (neck[2] + 0.0), (zc - 0.17 + 0.05 * (r / 0.3)) - z), r - 0.34)
        return np.maximum(np.abs(env) - 0.0035, region)

    pieces.append(Piece('mantle', mantle_field, (np.array([-0.4, -0.3, zc - 0.25]), np.array([0.4, 0.3, neck[2] + 0.05])),
                        lambda p: mat_ids(p, 'darkleather', [(lambda q: q[:, 2] < zc - 0.13 + 0.05 * (np.hypot(q[:, 0], q[:, 1] * 1.3) / 0.3), 'gold')]),
                        skin='transfer', voxel=0.003, budget=2400, inner=B))

    def stole_field(p):
        z = p[:, 2]
        env = B(p) - 0.022
        strip = np.minimum(np.abs(p[:, 0] - 0.07), np.abs(p[:, 0] + 0.07)) - 0.03
        region = np.maximum(np.maximum(strip, z - (zc - 0.02)), (zh - 0.25) - z)
        region = np.maximum(region, p[:, 1] - 0.0)
        return np.maximum(np.abs(env) - 0.003, region)

    pieces.append(Piece('stole', stole_field, (np.array([-0.2, -0.35, zh - 0.3]), np.array([0.2, 0.05, zc])), 'gold',
                        skin='transfer', voxel=0.003, budget=1600, inner=B))
    zb = zw - 0.02

    def belt_field(p):
        env = B(p) - 0.03
        rope = np.hypot(env, p[:, 2] - zb) - 0.012
        charm = sdf.sphere(np.array([-0.1, -0.16, zb - 0.12]), 0.022)(p)
        cord = sdf.capsule(np.array([-0.1, -0.16, zb]), np.array([-0.1, -0.165, zb - 0.1]), 0.005)(p)
        return np.minimum(rope, np.minimum(charm, cord))

    pieces.append(Piece('belt', belt_field, (np.array([-0.3, -0.3, zb - 0.16]), np.array([0.3, 0.3, zb + 0.04])),
                        lambda p: np.where(p[:, 2] < zb - 0.09, MAT_INDEX['bone'], MAT_INDEX['rope']),
                        skin={'bone': 'pelvis'}, budget=1400))
    return pieces


# =============================================================================================
def ignaroth(R, B, info):
    """Ignaroth, the Burning King (built at human size; the game scales him to 4.5 m)."""
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    # ------------------------------------------------ magma skin: black crust split by glowing veins
    def skin_field(p):
        crust = 0.0025 * (sdf.fbm(p, 18, 3, 201) - 0.5)
        return np.abs(B(p) - 0.004 - crust) - 0.003

    def skin_mats(p):
        veins = cracks(p, 8, 0.016, 202) | cracks(p, 21, 0.009, 203)
        return mat_ids(p, 'obsidian', [(lambda q: veins, 'ember')])

    pieces.append(Piece('magma', skin_field, (np.array([-1.0, -0.36, -0.03]), np.array([1.0, 0.36, L['top'] + 0.03])), skin_mats,
                        skin='transfer', voxel=0.0034, budget=14000, inner=B))
    # burning eyes and a mouth that glows like a furnace door
    eye_f = lambda p: np.minimum(sdf.sphere(L['eye_l'] + np.array([0, -0.004, 0]), 0.013)(p), sdf.sphere(L['eye_r'] + np.array([0, -0.004, 0]), 0.013)(p))  # noqa: E731
    mouth = sdf.capsule(eyes + np.array([-0.03, -0.08, -0.075]), eyes + np.array([0.03, -0.08, -0.075]), 0.007)
    pieces.append(Piece('eyes', lambda p: np.minimum(eye_f(p), mouth(p)), (eyes - np.array([0.08, 0.14, 0.12]), eyes + np.array([0.08, 0.06, 0.04])), 'ember',
                        skin={'bone': 'head'}, voxel=0.0016, budget=500))

    # ------------------------------------------------ crown of horns
    crown_c = skull + np.array([0, -0.005, 0.045])

    def crown_field(p):
        q = p - crown_c
        r = np.hypot(q[:, 0] / 1.0, q[:, 1] / 1.1)
        band = np.maximum(np.abs(r - 0.105) - 0.006, np.abs(q[:, 2]) - 0.018)
        horns = np.full(len(p), 1.0)
        for i in range(9):
            ang = -np.pi / 2 + (i - 4) * 0.36
            base = crown_c + np.array([np.cos(ang) * 0.105, np.sin(ang) * 0.115, 0.01])
            k = 1.0 - abs(i - 4) / 6
            tip = base + np.array([np.cos(ang) * 0.05 * (1.5 - k), np.sin(ang) * 0.04, 0.08 + 0.12 * k])
            horns = np.minimum(horns, sdf.capsule(base, tip, 0.013, 0.002)(p))
        # two great horns sweeping back from the temples
        for s in (1, -1):
            pts = [crown_c + np.array([s * 0.1, -0.02, 0.0]), crown_c + np.array([s * 0.17, 0.03, 0.06]),
                   crown_c + np.array([s * 0.2, 0.12, 0.13]), crown_c + np.array([s * 0.17, 0.22, 0.17])]
            for j in range(3):
                horns = np.minimum(horns, sdf.capsule(pts[j], pts[j + 1], 0.024 - 0.007 * j, 0.017 - 0.007 * j)(p))
        return np.minimum(band, horns)

    def crown_mats(p):
        q = p - crown_c
        return mat_ids(p, 'obsidian', [(lambda x: np.abs(x[:, 2] - crown_c[2]) < 0.022, 'gold'),
                                      (lambda x: (x[:, 2] - crown_c[2] > 0.15) & (np.hypot(q[:, 0], q[:, 1]) < 0.14), 'ember')])

    pieces.append(Piece('crown', crown_field, (crown_c - np.array([0.26, 0.2, 0.06]), crown_c + np.array([0.26, 0.3, 0.26])), crown_mats,
                        skin={'bone': 'head'}, voxel=0.0022, budget=3200))

    # ------------------------------------------------ king's breastplate with a molten sun at its heart
    chest_c = np.array([0.0, 0.012, (zc + zw) / 2 + 0.03])
    torso_ell = sdf.ellipsoid(chest_c, (sx * 0.98, 0.19, (zc - zw) * 0.72))
    core_c = np.array([0.0, -0.2, zc - 0.13])

    def plate_field(p):
        z = p[:, 2]
        r = np.maximum(z - (zc + 0.05 - 0.03 * (np.abs(p[:, 0]) / sx) ** 2), (zw - 0.04) - z)
        for s in (1, -1):
            c = np.array([s * sx * 0.98, 0.0, zc - 0.09])
            r = np.maximum(r, -(np.hypot((p[:, 0] - c[0]) / 1.15, p[:, 2] - c[2]) - 0.11))
        r = np.maximum(r, -(np.hypot(p[:, 0], (p[:, 1] - neck[1]) / 1.15) - 0.11))
        roll = 0.008 * np.exp(-(r / 0.008) ** 2)
        env = smin(B(p) - 0.036, torso_ell(p), 0.08) - roll
        # the sun: a socket in the plate where the magma shows through
        core = np.linalg.norm((p - core_c) * np.array([1, 2.5, 1]), axis=1) - 0.06
        shell = np.maximum(np.abs(env) - 0.0036, r)
        return np.maximum(shell, -core)

    def plate_mats(p):
        d = np.hypot(p[:, 0] - core_c[0], p[:, 2] - core_c[2])
        ang = np.arctan2(p[:, 2] - core_c[2], p[:, 0])
        rays = (np.cos(ang * 10) > 0.6) & (d < 0.16) & (d > 0.07) & (p[:, 1] < -0.05)
        return mat_ids(p, 'darksteel', [(lambda q: rays | ((d < 0.075) & (q[:, 1] < -0.05)), 'gold'),
                                       (lambda q: cracks(q, 6, 0.012, 211), 'ember')])

    pieces.append(Piece('breastplate', plate_field, (np.array([-sx * 1.25, -0.28, zw - 0.06]), np.array([sx * 1.25, 0.28, zc + 0.1])), plate_mats,
                        skin={'bone': 'spine_03', 'blend': [('spine_02', zw + 0.06, zw)]}, voxel=0.0028, budget=6000, inner=B))
    pieces.append(Piece('core', sdf.sphere(core_c + np.array([0, 0.03, 0]), 0.06), (core_c - 0.1, core_c + 0.1), 'ember',
                        skin={'bone': 'spine_03'}, voxel=0.002, budget=600))

    # ------------------------------------------------ spiked spaulders
    for s, side in ((1, 'l'), (-1, 'r')):
        a, b = R.head(f'upperarm_{side}'), R.tail(f'upperarm_{side}')

        def spaulder_field(p, a=a, b=b, s=s):
            t, rad = along(p, a, b)
            band = np.clip((np.clip(t, -0.3, 1) + 0.05) / 0.12, 0, 4.999)
            step = np.floor(band)
            r_t = 0.165 - 0.013 * step + 0.008 * (band - step)
            tube = np.where(t > 0, rad - r_t, np.linalg.norm(p - a, axis=1) - r_t)
            env = smin(tube, np.linalg.norm(p - (a + np.array([0, 0, 0.04])), axis=1) - 0.175, 0.04)
            region = np.maximum(np.maximum(-(p[:, 0] * s - (a[0] * s - 0.08)), t - 0.6), (a[2] - 0.3) - p[:, 2])
            shell = np.maximum(np.abs(env) - 0.0036, region)
            spikes = np.full(len(p), 1.0)
            for j, (dx, dy, dz, ln) in enumerate(((0.06, -0.05, 0.12, 0.2), (0.09, 0.03, 0.1, 0.24), (0.07, 0.1, 0.07, 0.18))):
                base = a + np.array([s * dx, dy, dz])
                tip = base + np.array([s * 0.4, 0.05 * (j - 1), 0.9]) / np.linalg.norm([0.4, 0.05 * (j - 1), 0.9]) * ln
                spikes = np.minimum(spikes, sdf.capsule(base, tip, 0.026, 0.003)(p))
            return np.minimum(shell, spikes)

        def spaulder_mats(p, a=a):
            return mat_ids(p, 'darksteel', [(lambda q: np.linalg.norm(q - a, axis=1) > 0.2, 'obsidian'),
                                           (lambda q: cracks(q, 8, 0.012, 220), 'ember')])

        pieces.append(Piece(f'spaulder_{side}', spaulder_field, (a - np.array([0.32, 0.3, 0.32]), a + np.array([0.32, 0.3, 0.34])), spaulder_mats,
                            skin={'bone': f'upperarm_{side}', 'blend': [(f'clavicle_{side}', None, None)]}, budget=4200))
        la, lb = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def bracer_field(p, la=la, lb=lb):
            t, rad = along(p, la, lb)
            flare = 0.02 * smoothstep(0.75, 1.0, t)
            return np.maximum(np.abs(rad - (0.062 + 0.012 * t + flare)) - 0.0034, np.maximum(0.1 - t, t - 0.97))

        pieces.append(Piece(f'bracer_{side}', bracer_field, ((la + lb) / 2 - 0.22, (la + lb) / 2 + 0.22),
                            lambda p, la=la, lb=lb: np.where(np.abs(along(p, la, lb)[0] - 0.55) > 0.38, MAT_INDEX['gold'], MAT_INDEX['darksteel']),
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'hand_{side}', None, None)]}, budget=1600))

    # ------------------------------------------------ gilt girdle, plate skirt, burnt royal tabard and cape
    hip_ell = sdf.ellipsoid(np.array([0.0, 0.01, (zw + zh) / 2]), (sx * 1.05, 0.18, 0.18))
    zk = R.head('calf_l')[2]

    def girdle_field(p):
        z = p[:, 2]
        env = smin(B(p) - 0.05, hip_ell(p) - 0.02, 0.06)
        return np.maximum(np.abs(env) - 0.005, np.abs(z - (zw - 0.05)) - 0.04)

    pieces.append(Piece('girdle', girdle_field, (np.array([-0.4, -0.32, zw - 0.12]), np.array([0.4, 0.32, zw + 0.02])),
                        lambda p: mat_ids(p, 'gold', [(lambda q: np.abs(q[:, 2] - (zw - 0.05)) < 0.022, 'darksteel')]),
                        skin={'bone': 'pelvis', 'blend': [('spine_01', zw - 0.03, zw + 0.01)]}, budget=2200))

    def skirt_plates(p):
        z = p[:, 2]
        ang = np.arctan2(p[:, 1], p[:, 0])
        seg = np.abs(np.mod(ang * 10 / (2 * np.pi), 1) - 0.5)
        k = np.clip((zw - 0.09 - z) / (zw - 0.09 - zk), 0, 1)
        rx, ry = sx * 1.02 + 0.08 * k, 0.19 + 0.07 * k
        d = np.hypot(p[:, 0] / rx, (p[:, 1] - 0.01) / ry) * np.minimum(rx, ry) - np.minimum(rx, ry) - 0.006 * (seg < 0.08)
        region = np.maximum(np.maximum((zk + 0.04) - z, z - (zw - 0.08)), 0.03 - seg)
        return np.maximum(np.abs(d) - 0.0035, region)

    pieces.append(Piece('plate_skirt', skirt_plates, (np.array([-0.5, -0.4, zk - 0.02]), np.array([0.5, 0.4, zw - 0.05])),
                        lambda p: mat_ids(p, 'darksteel', [(lambda q: q[:, 2] < zk + 0.08, 'gold'), (lambda q: cracks(q, 9, 0.012, 231), 'ember')]),
                        skin='transfer_skirt', voxel=0.0034, budget=4200))

    def tabard_field(p):
        z = p[:, 2]
        k = np.clip((zw - 0.06 - z) / (zw - 0.06), 0, 1.2)
        sheet = np.abs(p[:, 1] - (-0.24 - 0.06 * k)) - 0.0035 - 0.004 * np.sin(p[:, 0] * 40) * k
        width = np.abs(p[:, 0]) - (0.13 - 0.02 * k)
        hem = 0.14 + 0.1 * (sdf.fbm(np.column_stack([p[:, 0] * 3, np.zeros_like(z), np.zeros_like(z)]), 4, 3, 233) - 0.5)
        region = np.maximum(np.maximum(width, hem - z), z - (zw - 0.06))
        return np.maximum(sheet, region)

    pieces.append(Piece('tabard', tabard_field, (np.array([-0.2, -0.45, 0.0]), np.array([0.2, -0.1, zw])),
                        lambda p: mat_ids(p, 'cloth_red', [(lambda q: q[:, 2] < 0.3 + 0.1 * sdf.fbm(q, 6, 2, 234), 'char'),
                                                          (lambda q: (q[:, 2] < 0.32) & cracks(q, 12, 0.03, 235), 'ember'),
                                                          (lambda q: np.abs(np.abs(q[:, 0]) - 0.1) < 0.012, 'gold')]),
                        skin='transfer_skirt', voxel=0.003, budget=2600))

    back_y = float(R.head('spine_03')[1]) + 0.2

    def cape_field(p):
        z = p[:, 2]
        # hangs from the shoulders as one sheet, falling away from the body toward the hem
        k = np.clip((zc - z) / zc, 0, 1)
        y0 = back_y + 0.02 + 0.22 * k ** 1.3
        sheet = np.abs(p[:, 1] - y0 - 0.012 * np.sin(p[:, 0] * 22 + 1.0) * k) - 0.004
        width = np.abs(p[:, 0]) - (sx * 0.9 + 0.32 * k)
        hem = 0.08 + 0.12 * (sdf.fbm(np.column_stack([p[:, 0] * 4, np.zeros_like(z), np.zeros_like(z)]), 3, 3, 241) - 0.5)
        region = np.maximum(np.maximum(hem - z, z - (zc + 0.04)), width)
        holes = (sdf.fbm(p, 6, 3, 242) - 0.76) * 0.06
        # wrap over the shoulders: the top edge curls forward onto the spaulders
        top = np.maximum(np.abs(B(p) - 0.09) - 0.004, np.maximum(zc - 0.02 - z, np.abs(p[:, 0]) - sx * 0.95))
        top = np.maximum(top, -(p[:, 1] - 0.0))
        return np.minimum(np.maximum(np.maximum(sheet, region), holes), top)

    pieces.append(Piece('cape', cape_field, (np.array([-0.75, -0.05, 0.0]), np.array([0.75, 0.75, zc + 0.12])),
                        lambda p: mat_ids(p, 'cloth_red', [(lambda q: q[:, 2] < 0.35 + 0.15 * sdf.fbm(q, 6, 2, 243), 'char'),
                                                          (lambda q: (q[:, 2] < 0.4) & cracks(q, 11, 0.03, 244), 'ember'),
                                                          (lambda q: q[:, 2] > zc - 0.05, 'gold')]),
                        skin='transfer_skirt', voxel=0.0036, budget=5000))

    # ------------------------------------------------ greaves with knee spikes
    for s, side in ((1, 'l'), (-1, 'r')):
        knee = R.head(f'calf_{side}')

        def greave_field(p, knee=knee, s=s):
            z = p[:, 2]
            env = B(p) - 0.024
            region = np.maximum(np.maximum(z - (knee[2] + 0.12), -0.01 - z), 0.005 - p[:, 0] * s)
            spike = sdf.capsule(knee + np.array([0, -0.07, 0.02]), knee + np.array([0, -0.2, 0.1]), 0.028, 0.003)(p)
            return np.minimum(np.maximum(np.abs(env) - 0.0034, region), spike)

        pieces.append(Piece(f'greave_{side}', greave_field, (np.array([knee[0] - 0.18, -0.32, -0.02]), np.array([knee[0] + 0.18, 0.25, knee[2] + 0.2])),
                            lambda p: mat_ids(p, 'darksteel', [(lambda q: q[:, 2] < 0.06, 'gold'), (lambda q: cracks(q, 9, 0.012, 250 + s), 'ember')]),
                            skin='transfer', voxel=0.003, budget=3600, inner=B))
    return pieces
