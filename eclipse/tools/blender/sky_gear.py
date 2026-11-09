"""Gear for the Shattered Sky's enemies and its goddess (see ashen_gear.py for the conventions).

  monk      a Stormbound monk of Aethel Spire: linen wraps banded with storm-indigo, a split robe,
            a short mantle, a rope sash and prayer beads, copper bracers with a lightning sigil, a
            face cloth that leaves only a slit for the storm-lit eyes
  warden    a Tempest Warden: a tall floor-length robe with glowing runes down its front, a high
            copper collar, bell sleeves, a copper mask with one vertical slit and a halo of
            lightning rods behind the head
  vaeltris  the storm goddess (scaled up in the game): a silver breastplate chased with feathers,
            feathered pauldrons, a storm-cloth skirt over silver greaves, a serene silver mask with
            storm-lit eyes, a winged helm, and great wings of white feathers from her back
"""
import numpy as np

import sdf
from armor import Piece, along, MAT_INDEX
from ashen_gear import smin, landmarks, mat_ids, cracks, skirt


def bands(z, period, width):
    """Horizontal stripes (wraps, trims)."""
    return np.abs(np.mod(z / period, 1) - 0.5) < width


def face_mask(L, B, skull, eyes, neck, offset=0.011, slit=False):
    """A mask that follows the face's own features, with almond eye-holes (or one vertical slit)."""
    def f(p):
        z = p[:, 2]
        shell = np.abs(B(p) - offset) - 0.0026
        region = np.maximum(p[:, 1] - (skull[1] - 0.03), np.maximum((neck[2] + 0.04) - z, z - (eyes[2] + 0.05)))
        if slit:
            hole = sdf.ellipsoid(np.array([0.0, eyes[1] - 0.03, eyes[2] - 0.01]), (0.006, 0.06, 0.05))(p)
        else:
            hole = np.full(len(p), 1.0)
            for e in (L['eye_l'], L['eye_r']):
                hole = np.minimum(hole, sdf.ellipsoid(e + np.array([0, -0.03, 0.001]), (0.016, 0.05, 0.0072))(p))
        return np.maximum(np.maximum(shell, region), -hole)
    return f


def glow_eyes(L, forward=0.021):
    return lambda p: np.minimum(sdf.ellipsoid(L['eye_l'] + np.array([0, -forward, 0.001]), (0.012, 0.012, 0.006))(p),  # noqa: E731
                                sdf.ellipsoid(L['eye_r'] + np.array([0, -forward, 0.001]), (0.012, 0.012, 0.006))(p))


def wings_field(root_l, root_r, span, seed, feathers=9):
    """Two great wings: an armoured leading edge (shoulder, elbow, wrist, tip), long primaries fanned
    out like fingers from the wrist, secondaries hanging from the forearm, a row of coverts over
    them. Every feather is a thin tapering blade, so the silhouette reads feather by feather.
    Returns (feathers field, bones field)."""
    rng = np.random.default_rng(seed)
    wings = []
    for s, root in ((1, root_l), (-1, root_r)):
        sh = root
        el = root + np.array([s * 0.42, 0.22, 0.32]) * span
        wr = root + np.array([s * 0.8, 0.36, 0.66]) * span
        tip = root + np.array([s * 1.02, 0.46, 0.98]) * span
        bones = [(sh, el, 0.05 * span, 0.04 * span), (el, wr, 0.04 * span, 0.03 * span), (wr, tip, 0.03 * span, 0.012 * span)]
        blades = []

        def feather(base, d, length, width, t):
            d = d / np.linalg.norm(d)
            blades.append((base, d, length, width, t))

        back_down = np.array([0.0, 0.35, -1.0])
        # secondaries along the forearm (shoulder -> wrist), hanging back and down, growing outward
        for k in range(10):
            u = (k + 0.5) / 10
            base = sh + (wr - sh) * u if u > 0.5 else sh + (el - sh) * (u * 2)
            out = np.array([s * (0.25 + 0.5 * u), 0.0, 0.0])
            feather(base, back_down + out, span * (0.42 + 0.22 * u), 0.055 * span, 0.008)
        # primaries from the wrist to the tip, splaying out like fingers
        for k in range(7):
            u = k / 6
            base = wr + (tip - wr) * (0.15 + 0.85 * u)
            ang = np.radians(-60 + 85 * u)
            d = np.array([s * np.cos(ang) * 0.9, 0.3, np.sin(ang) - 0.25])
            feather(base, d, span * (0.62 + 0.18 * np.sin(np.pi * (0.25 + 0.6 * u))), 0.05 * span, 0.007)
        # coverts: short and overlapping, laid along the top of the arm
        for k in range(12):
            u = (k + 0.5) / 12
            base = sh + (tip - sh) * u * 0.92 + np.array([0, 0.02, 0.02]) * span
            feather(base, back_down + np.array([s * 0.35, 0.0, 0.0]), span * (0.18 + 0.08 * rng.random()), 0.05 * span, 0.009)
        wings.append((bones, blades))

    def blade_d(p, base, d, length, width, thick):
        q = p - base
        along = q @ d
        t = np.clip(along / length, 0, 1)
        # the feather's plane: across = d x up-ish; its normal points roughly up/back
        side = np.cross(d, np.array([0.0, 0.0, 1.0]))
        if np.linalg.norm(side) < 1e-3:
            side = np.array([1.0, 0, 0])
        side /= np.linalg.norm(side)
        nrm = np.cross(side, d)
        w = width * (0.35 + 0.65 * np.sin(np.pi * np.clip(t * 0.92 + 0.08, 0, 1)) ** 0.6) * (1 - 0.6 * t ** 3)
        across = np.abs(q @ side) - w
        flat = np.abs(q @ nrm - 0.02 * length * np.sin(np.pi * t)) - thick * (1 - 0.5 * t)
        ends = np.maximum(-along, along - length)
        return np.maximum(np.maximum(across, flat), ends)

    def feathers_f(p):
        out = np.full(len(p), 1e3)
        for bones, blades in wings:
            for base, d, length, width, thick in blades:
                out = np.minimum(out, blade_d(p, base, d, length, width, thick))
        return out

    def bones_f(p):
        out = np.full(len(p), 1e3)
        for bones, _ in wings:
            for a, b, r0, r1 in bones:
                out = np.minimum(out, sdf.capsule(a, b, r0, r1)(p))
        return out

    return feathers_f, bones_f


# =============================================================================================
def monk(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    def wraps(p):
        z = p[:, 2]
        env = B(p) - 0.006 - 0.0015 * np.sin(z * 260 + p[:, 0] * 40)
        return np.maximum(np.abs(env) - 0.0022, z - (neck[2] + 0.03))

    pieces.append(Piece('wraps', wraps, (np.array([-0.95, -0.35, -0.02]), np.array([0.95, 0.35, neck[2] + 0.06])),
                        lambda p: mat_ids(p, 'linen', [(lambda q: bands(q[:, 2] + 0.3 * q[:, 0], 0.09, 0.12), 'cloth_storm')]),
                        skin='transfer', voxel=0.0034, budget=9000, inner=B))
    zk = R.head('calf_l')[2]
    pieces.append(Piece('robe', skirt(L, zw + 0.03, zk - 0.02, sx * 0.9, 0.15, 0.12, 0.04, 501, slit=0.03, slit_from=zw - 0.05, folds=0.012),
                        (np.array([-0.55, -0.45, zk - 0.1]), np.array([0.55, 0.45, zw + 0.06])),
                        lambda p: mat_ids(p, 'cloth_storm', [(lambda q: q[:, 2] < zk + 0.04 + 0.02 * sdf.fbm(q, 8, 2, 502), 'linen')]),
                        skin='transfer_skirt', voxel=0.0034, budget=5000))

    def mantle(p):
        z = p[:, 2]
        env = B(p) - 0.03 - 0.008 * np.sin(np.arctan2(p[:, 1], p[:, 0]) * 14)
        r = np.hypot(p[:, 0], p[:, 1] * 1.2)
        hem = (zc - 0.17) + 0.03 * (sdf.fbm(np.column_stack([p[:, 0] * 4, p[:, 1] * 4, np.zeros_like(z)]), 3, 2, 503) - 0.5)
        return np.maximum(np.abs(env) - 0.003, np.maximum(hem - z, np.maximum(z - (neck[2] + 0.03), r - 0.42)))

    pieces.append(Piece('mantle', mantle, (np.array([-0.5, -0.35, zc - 0.25]), np.array([0.5, 0.35, neck[2] + 0.06])),
                        lambda p: mat_ids(p, 'cloth_storm', [(lambda q: q[:, 2] < zc - 0.14, 'linen')]), skin='transfer', voxel=0.003, budget=3500))

    def sash(p):
        z = p[:, 2]
        env = B(p) - 0.022
        return np.maximum(np.abs(env) - 0.006, np.abs(z - (zw - 0.02)) - 0.03)

    pieces.append(Piece('sash', sash, (np.array([-0.4, -0.3, zw - 0.1]), np.array([0.4, 0.3, zw + 0.06])), 'rope', skin='transfer', voxel=0.0026, budget=1800))

    beads_c = neck + np.array([0, -0.03, -0.09])

    def beads(p):
        out = np.full(len(p), 1.0)
        for i in range(17):
            a = -np.pi / 2 + (i - 8) * 0.13
            c = beads_c + np.array([np.cos(a) * 0.11, np.sin(a) * 0.09 + 0.09, -0.06 * np.exp(-((i - 8) / 5.0) ** 2)])
            out = np.minimum(out, sdf.sphere(c, 0.011 + 0.006 * (i == 8))(p))
        return out

    pieces.append(Piece('beads', beads, (beads_c - 0.2, beads_c + 0.2), lambda p: mat_ids(p, 'wood', [(lambda q: np.abs(q[:, 0]) < 0.012, 'copper')]),
                        skin={'bone': 'spine_03'}, voxel=0.0016, budget=1400))
    for side in 'lr':
        ea, wa = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def bracer(p, ea=ea, wa=wa):
            t, rad = along(p, ea, wa)
            return np.maximum(np.abs(rad - (0.05 + 0.012 * t)) - 0.003, np.maximum(0.35 - t, t - 0.95))

        pieces.append(Piece(f'bracer_{side}', bracer, ((ea + wa) / 2 - 0.22, (ea + wa) / 2 + 0.22),
                            lambda p, ea=ea, wa=wa: np.where(np.abs(np.mod(along(p, ea, wa)[0] * 9, 1) - 0.5) < 0.05, MAT_INDEX['stormglow'], MAT_INDEX['copper']),
                            skin={'bone': f'lowerarm_{side}'}, budget=1500))
    head_ell = sdf.ellipsoid(skull + np.array([0, 0.012, 0.01]), (0.11, 0.13, 0.14))

    def hood(p):
        z = p[:, 2]
        env = smin(B(p) - 0.026, head_ell(p) - 0.016, 0.04)
        region = np.maximum((zc - 0.03) - z, np.hypot(p[:, 0], p[:, 1] * 1.15) - (0.28 - 0.5 * np.clip(z - zc, 0, 0.2)))
        face = np.hypot(p[:, 0] / 0.07, (p[:, 2] - (eyes[2] - 0.02)) / 0.09) - 1.0
        opening = np.maximum(face, p[:, 1] - (skull[1] - 0.02))
        return np.maximum(np.maximum(np.abs(env) - 0.003, region), -opening)

    pieces.append(Piece('hood', hood, (np.array([-0.3, -0.3, zc - 0.08]), np.array([0.3, 0.3, L['top'] + 0.08])), 'cloth_storm', skin='transfer', voxel=0.003, budget=3800))

    def facecloth(p):
        z = p[:, 2]
        shell = np.abs(B(p) - 0.009) - 0.0024
        region = np.maximum(p[:, 1] - (skull[1] - 0.02), np.maximum((neck[2] + 0.03) - z, z - (eyes[2] + 0.05)))
        slit = np.abs(z - eyes[2]) - 0.012
        return np.maximum(np.maximum(shell, region), -slit)

    pieces.append(Piece('facecloth', facecloth, (skull - np.array([0.12, 0.17, 0.2]), skull + np.array([0.12, 0.02, 0.08])),
                        lambda p: mat_ids(p, 'linen', [(lambda q: bands(q[:, 2], 0.03, 0.1), 'cloth_storm')]), skin={'bone': 'head'}, voxel=0.0016, budget=2200))
    pieces.append(Piece('eyes', glow_eyes(L, 0.016), (eyes - 0.08, eyes + 0.08), 'stormglow', skin={'bone': 'head'}, voxel=0.0012, budget=400))
    return pieces


# =============================================================================================
def warden(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []
    rune = lambda q: (np.abs(q[:, 0]) < 0.018) & (np.abs(np.mod(q[:, 2] * 9, 1) - 0.5) < 0.18) & (q[:, 1] < 0)  # noqa: E731

    def bodice(p):
        z = p[:, 2]
        env = B(p) - 0.014
        return np.maximum(np.abs(env) - 0.003, np.maximum(z - (neck[2] + 0.02), (zw - 0.06) - z))

    pieces.append(Piece('bodice', bodice, (np.array([-0.9, -0.3, zw - 0.1]), np.array([0.9, 0.3, neck[2] + 0.05])),
                        lambda p: mat_ids(p, 'cloth_storm', [(rune, 'stormglow')]), skin='transfer', voxel=0.0032, budget=6000, inner=B))
    pieces.append(Piece('robe', skirt(L, zw + 0.02, 0.03, sx * 0.95, 0.16, 0.22, 0.03, 511, folds=0.016),
                        (np.array([-0.62, -0.52, -0.03]), np.array([0.62, 0.52, zw + 0.05])),
                        lambda p: mat_ids(p, 'cloth_storm', [(lambda q: q[:, 2] < 0.12, 'linen'), (rune, 'stormglow')]),
                        skin='transfer_skirt', voxel=0.0036, budget=6000))
    for side in 'lr':
        ea, wa = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def sleeve(p, ea=ea, wa=wa):
            t, rad = along(p, ea, wa)
            env = rad - (0.06 + 0.1 * np.clip(t, 0, 1) ** 1.6)
            return np.maximum(np.abs(env) - 0.003, np.maximum(-0.05 - t, t - 0.88))

        pieces.append(Piece(f'sleeve_{side}', sleeve, ((ea + wa) / 2 - 0.27, (ea + wa) / 2 + 0.27),
                            lambda p, ea=ea, wa=wa: np.where(along(p, ea, wa)[0] > 0.8, MAT_INDEX['copper'], MAT_INDEX['cloth_storm']),
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'upperarm_{side}', None, None)]}, budget=1800))
        hb = R.head(f'hand_{side}')
        pieces.append(Piece(f'hand_{side}', lambda p, ea=ea, wa=wa: np.maximum(B(p) - 0.004, 0.7 - along(p, ea, wa)[0]), (hb - 0.18, hb + 0.18),
                            lambda p: mat_ids(p, 'linen', [(lambda q: cracks(q, 18, 0.02, 513), 'stormglow')]), skin='transfer', voxel=0.0022, budget=2200))

    def collar(p):
        z = p[:, 2]
        r = np.hypot(p[:, 0], (p[:, 1] - neck[1] - 0.01) * 1.1)
        shell = np.abs(r - (0.13 + 0.06 * np.clip((z - zc) / 0.2, 0, 1))) - 0.004
        # open at the front, widening upward, so the mask shows
        cut = np.maximum(p[:, 1] - neck[1], np.abs(p[:, 0]) - (0.06 + 0.1 * np.clip((z - zc) / 0.2, 0, 1)))
        return np.maximum(np.maximum(shell, np.maximum((zc - 0.04) - z, z - (zc + 0.2))), -cut)

    pieces.append(Piece('collar', collar, (neck - np.array([0.3, 0.3, 0.2]), neck + np.array([0.3, 0.3, 0.25])),
                        lambda p: mat_ids(p, 'copper', [(lambda q: bands(q[:, 2], 0.05, 0.08), 'stormglow')]), skin={'bone': 'spine_03'}, voxel=0.0022, budget=2600))
    head_ell = sdf.ellipsoid(skull + np.array([0, 0.012, 0.01]), (0.11, 0.13, 0.14))

    def hood(p):
        z = p[:, 2]
        env = smin(B(p) - 0.03, head_ell(p) - 0.02, 0.04)
        region = np.maximum((zc + 0.02) - z, np.hypot(p[:, 0], p[:, 1] * 1.15) - 0.3)
        face = np.hypot(p[:, 0] / 0.075, (p[:, 2] - (eyes[2] - 0.025)) / 0.1) - 1.0
        opening = np.maximum(face, p[:, 1] - (skull[1] - 0.02))
        return np.maximum(np.maximum(np.abs(env) - 0.0032, region), -opening)

    pieces.append(Piece('hood', hood, (np.array([-0.3, -0.3, zc - 0.04]), np.array([0.3, 0.3, L['top'] + 0.08])), 'cloth_storm', skin='transfer', voxel=0.003, budget=3800))
    pieces.append(Piece('mask', face_mask(L, B, skull, eyes, neck, 0.013, slit=True), (skull - np.array([0.12, 0.17, 0.2]), skull + np.array([0.12, 0.02, 0.08])),
                        lambda p: mat_ids(p, 'copper', [(lambda q: sdf.fbm(q, 14, 3, 514) > 0.6, 'verdigris')]), skin={'bone': 'head'}, voxel=0.0016, budget=2400))
    pieces.append(Piece('slitglow', lambda p: sdf.ellipsoid(np.array([0.0, eyes[1] - 0.02, eyes[2] - 0.01]), (0.004, 0.012, 0.045))(p),
                        (eyes - 0.08, eyes + 0.08), 'stormglow', skin={'bone': 'head'}, voxel=0.0012, budget=300))

    # the halo of lightning rods: a copper ring standing behind the head, prongs tipped with storm-glow
    hc = skull + np.array([0, 0.11, 0.06])

    def halo(p):
        q = p - hc
        ring = np.maximum(np.abs(np.hypot(q[:, 0], q[:, 2]) - 0.2) - 0.008, np.abs(q[:, 1]) - 0.008)
        rods = np.full(len(p), 1.0)
        for i in range(11):
            a = np.pi * (i / 10)
            b0 = hc + np.array([np.cos(a) * 0.2, 0, np.sin(a) * 0.2])
            tip = hc + np.array([np.cos(a) * (0.29 + 0.05 * (i % 2)), 0.01, np.sin(a) * (0.29 + 0.05 * (i % 2))])
            rods = np.minimum(rods, sdf.capsule(b0, tip, 0.007, 0.002)(p))
        return np.maximum(np.minimum(ring, rods), -q[:, 2] - 0.06)

    pieces.append(Piece('halo', halo, (hc - np.array([0.38, 0.06, 0.12]), hc + np.array([0.38, 0.06, 0.38])),
                        lambda p: np.where(np.linalg.norm(p - hc, axis=1) > 0.27, MAT_INDEX['stormglow'], MAT_INDEX['copper']),
                        skin={'bone': 'head'}, voxel=0.0018, budget=2600))
    return pieces


# =============================================================================================
def vaeltris(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    def undersuit(p):
        z = p[:, 2]
        env = B(p) - 0.005
        return np.maximum(np.abs(env) - 0.0022, z - (neck[2] + 0.03))

    pieces.append(Piece('undersuit', undersuit, (np.array([-0.95, -0.35, -0.02]), np.array([0.95, 0.35, neck[2] + 0.06])),
                        lambda p: mat_ids(p, 'cloth_storm', [(lambda q: cracks(q, 6, 0.012, 601) & (sdf.fbm(q, 2.5, 2, 602) > 0.6), 'stormglow')]),
                        skin='transfer', voxel=0.0034, budget=9000, inner=B))
    chest_c = np.array([0.0, 0.012, (zc + zw) / 2 + 0.03])
    torso_ell = sdf.ellipsoid(chest_c, (sx * 0.9, 0.17, (zc - zw) * 0.7))

    def plate(p):
        z = p[:, 2]
        env = smin(B(p) - 0.026, torso_ell(p), 0.07)
        region = np.maximum(z - (zc + 0.03 - 0.04 * (p[:, 0] / sx) ** 2), (zw - 0.05) - z)
        for s in (1, -1):
            c = np.array([s * sx * 0.98, 0.0, zc - 0.09])
            region = np.maximum(region, -(np.hypot((p[:, 0] - c[0]) / 1.15, p[:, 2] - c[2]) - 0.105))
        region = np.maximum(region, -(np.hypot(p[:, 0], (p[:, 1] - neck[1]) / 1.15) - 0.1))
        chase = 0.0025 * np.sin(np.arctan2(p[:, 2] - zw, np.abs(p[:, 0]) + 0.05) * 18) * (p[:, 1] < 0)
        return np.maximum(np.abs(env - chase) - 0.003, region)

    pieces.append(Piece('plate', plate, (np.array([-sx * 1.2, -0.26, zw - 0.08]), np.array([sx * 1.2, 0.26, zc + 0.08])),
                        lambda p: mat_ids(p, 'silver', [(lambda q: np.abs(q[:, 0]) < 0.012, 'gold'), (lambda q: q[:, 2] < zw - 0.02, 'gold')]),
                        skin={'bone': 'spine_03', 'blend': [('spine_02', zw + 0.06, zw)]}, voxel=0.0028, budget=5000, inner=B))
    for s, side in ((1, 'l'), (-1, 'r')):
        a = R.head(f'upperarm_{side}')

        def pauldron(p, a=a, s=s):
            q = p - (a + np.array([0, 0, 0.03]))
            layers = np.full(len(p), 1.0)
            for k in range(4):
                c = np.array([s * (0.02 + 0.025 * k), 0.0, -0.02 - 0.035 * k])
                e = sdf.ellipsoid(c, (0.1, 0.11, 0.06))(q)
                layers = np.minimum(layers, np.maximum(np.abs(e) - 0.004, -q[:, 2] - 0.03 - 0.035 * k - 0.04))
            return np.maximum(layers, -(q[:, 0] * s) - 0.03)

        pieces.append(Piece(f'pauldron_{side}', pauldron, (a - 0.2, a + 0.2), lambda p: mat_ids(p, 'feather', [(lambda q: q[:, 2] > a[2] + 0.05, 'silver')]),
                            skin={'bone': f'upperarm_{side}', 'blend': [(f'clavicle_{side}', None, None)]}, budget=2200))
        knee, ankle = R.head(f'calf_{side}'), R.head(f'foot_{side}')

        def greave(p, knee=knee, ankle=ankle):
            t, rad = along(p, knee, ankle)
            env = smin(B(p) - 0.02, rad - 0.055 - 0.012 * (1 - t), 0.03)
            return np.maximum(np.abs(env) - 0.003, np.maximum(-0.08 - t, t - 0.9))

        pieces.append(Piece(f'greave_{side}', greave, ((knee + ankle) / 2 - 0.3, (knee + ankle) / 2 + 0.3), 'silver', skin={'bone': f'calf_{side}'}, budget=1400))
    zk = R.head('calf_l')[2]
    pieces.append(Piece('skirt', skirt(L, zw - 0.02, zk - 0.1, sx * 0.9, 0.15, 0.16, 0.05, 611, slit=0.05, slit_from=zw - 0.06, folds=0.014),
                        (np.array([-0.6, -0.5, zk - 0.2]), np.array([0.6, 0.5, zw + 0.02])),
                        lambda p: mat_ids(p, 'cloth_storm', [(lambda q: q[:, 2] < zk - 0.04, 'stormglow')]), skin='transfer_skirt', voxel=0.0034, budget=5000))
    pieces.append(Piece('mask', face_mask(L, B, skull, eyes, neck, 0.011), (skull - np.array([0.12, 0.17, 0.2]), skull + np.array([0.12, 0.02, 0.08])),
                        lambda p: mat_ids(p, 'silver', [(lambda q: q[:, 2] > eyes[2] + 0.03, 'gold')]), skin={'bone': 'head'}, voxel=0.0015, budget=2800))
    pieces.append(Piece('eyes', glow_eyes(L), (eyes - 0.08, eyes + 0.08), 'stormglow', skin={'bone': 'head'}, voxel=0.0012, budget=400))
    hc = skull + np.array([0, 0.0, 0.03])

    def helm(p):
        z = p[:, 2]
        dome = sdf.ellipsoid(hc, (0.112, 0.13, 0.12))(p)
        shell = np.maximum(np.abs(dome) - 0.003, (eyes[2] + 0.04) - z)
        back = np.maximum(np.abs(sdf.ellipsoid(hc + np.array([0, 0.03, -0.03]), (0.125, 0.14, 0.14))(p)) - 0.003,
                          np.maximum(np.abs(z - (eyes[2] - 0.03)) - 0.06, -(p[:, 1] - hc[1] + 0.02)))
        out = np.minimum(shell, back)
        for s in (1, -1):
            # small swept wings on the temples
            for k in range(4):
                a = hc + np.array([s * 0.1, 0.02 + 0.01 * k, 0.0 + 0.015 * k])
                b = a + np.array([s * (0.08 - 0.012 * k), 0.06 + 0.03 * k, 0.1 + 0.03 * k])
                out = np.minimum(out, np.maximum(sdf.capsule(a, b, 0.012, 0.003)(p), np.abs((p - a) @ np.array([1.0 * s, 0, -0.3])) - 0.004))
        return out

    pieces.append(Piece('helm', helm, (hc - np.array([0.25, 0.22, 0.2]), hc + np.array([0.25, 0.3, 0.3])),
                        lambda p: mat_ids(p, 'silver', [(lambda q: np.abs(q[:, 0]) > 0.11, 'feather'), (lambda q: np.abs(q[:, 2] - (eyes[2] + 0.045)) < 0.008, 'gold')]),
                        skin={'bone': 'head'}, voxel=0.0018, budget=3200))
    # the wings: rooted at the shoulder blades, carried by the upper spine
    blade_z = zc - 0.06
    root_l = np.array([0.09, 0.14, blade_z])
    root_r = np.array([-0.09, 0.14, blade_z])
    span = 1.3
    fe, bo = wings_field(root_l, root_r, span, 621)
    wf = lambda p: np.minimum(fe(p), bo(p))  # noqa: E731
    pieces.append(Piece('wings', wf, (np.array([-1.65, -0.15, zw - 0.9]), np.array([1.65, 1.1, zc + 1.45])),
                        lambda p: mat_ids(p, 'feather', [(lambda q: bo(q) < 0.012, 'silver'),
                                                        (lambda q: (fe(q) < 0.01) & (np.abs(q[:, 0]) > 1.12), 'stormglow')]),
                        skin={'bone': 'spine_03'}, voxel=0.0055, budget=14000))
    return pieces
