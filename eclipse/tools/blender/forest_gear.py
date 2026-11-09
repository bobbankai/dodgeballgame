"""Gear for the Forgotten Sanctuary's enemies and its goddess (see ashen_gear.py for the conventions).

  thornbound  a pilgrim the forest took: bark plates grown over the body, veined with glowing sap,
              moss in the seams, thorny vines spiralling the limbs, branch growths from the shoulders
              and a cracked bark mask with sap-lit eyes
  bloomcaller Sylvaris's keeper: a gown of layered petals, a mantle of leaves, a bark mask and a
              crown of blossom, sap glowing in the palms
  sylvaris    the goddess of growth (scaled up in the game): bark skin veined with sap, a gown of
              leaves falling to blossom at the hem, a moss mantle, a serene wooden mask and great
              antlers of living branches hung with flowers
"""
import numpy as np

import sdf
from armor import Piece, along, MAT_INDEX
from ashen_gear import smin, landmarks, mat_ids, cracks, skirt
from sky_gear import face_mask, glow_eyes


def vine_field(R, bones, turns, radius, offset, seed, thorn=True):
    """Vines spiralling round limb bones: a helix tube about each bone, with small thorns."""
    def f(p):
        out = np.full(len(p), 1e3)
        for k, (a_name, b_name) in enumerate(bones):
            a, b = R.head(a_name), R.tail(b_name)
            t, rad = along(p, a, b)
            d = b - a
            L = np.linalg.norm(d)
            d = d / L
            ref = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
            u = np.cross(d, ref)
            u /= np.linalg.norm(u)
            v = np.cross(d, u)
            q = p - a
            ang = np.arctan2(q @ v, q @ u)
            phase = np.mod(ang - t * turns * 2 * np.pi + k * 1.7, 2 * np.pi) - np.pi
            arc = np.abs(phase) * (offset + 0.02)
            tube = np.hypot(arc, rad - offset) - radius
            tube = np.maximum(tube, np.maximum(-t, t - 1))
            out = np.minimum(out, tube)
        if thorn:
            out = out - 0.006 * (np.sin(p[:, 0] * 180) * np.sin(p[:, 1] * 170) * np.sin(p[:, 2] * 190) > 0.7)
        return out
    return f


# =============================================================================================
def thornbound(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    def bark(p):
        z = p[:, 2]
        plates = 0.006 * np.clip(np.sin(p[:, 0] * 40 + np.sin(z * 30) * 2) * np.sin(z * 35), 0, 1)
        env = B(p) - 0.014 - plates - 0.004 * (sdf.fbm(p, 9, 3, 701) - 0.5)
        return np.maximum(np.abs(env) - 0.003, z - (neck[2] + 0.03))

    pieces.append(Piece('bark', bark, (np.array([-0.95, -0.36, -0.02]), np.array([0.95, 0.36, neck[2] + 0.06])),
                        lambda p: mat_ids(p, 'bark', [(lambda q: sdf.fbm(q, 6, 3, 702) > 0.62, 'moss'),
                                                      (lambda q: cracks(q, 7, 0.011, 703) & (sdf.fbm(q, 2.5, 2, 704) > 0.55), 'sapglow')]),
                        skin='transfer', voxel=0.0034, budget=11000, inner=B))
    limbs = [('upperarm_l', 'lowerarm_l'), ('upperarm_r', 'lowerarm_r'), ('thigh_l', 'calf_l'), ('thigh_r', 'calf_r')]
    vines = vine_field(R, limbs, 2.5, 0.009, 0.075, 705)
    pieces.append(Piece('vines', vines, (np.array([-1.0, -0.4, -0.02]), np.array([1.0, 0.4, zc + 0.1])),
                        lambda p: mat_ids(p, 'leaf', [(lambda q: sdf.fbm(q, 20, 2, 706) > 0.68, 'petal')]), skin='transfer', voxel=0.003, budget=7000))
    for s, side in ((1, 'l'), (-1, 'r')):
        a = R.head(f'upperarm_{side}') + np.array([0, 0.02, 0.04])

        def growth(p, a=a, s=s):
            out = np.full(len(p), 1e3)
            for k, (dx, dy, dz, ln) in enumerate([(0.3, 0.1, 1.0, 0.24), (0.7, 0.3, 0.8, 0.18), (0.1, 0.5, 0.9, 0.2)]):
                d = np.array([s * dx, dy, dz])
                d /= np.linalg.norm(d)
                b = a + d * ln
                out = np.minimum(out, sdf.capsule(a, b, 0.022, 0.005)(p))
                out = np.minimum(out, sdf.capsule(a + d * ln * 0.6, a + d * ln * 0.6 + np.array([s * 0.05, 0.02, 0.06]), 0.008, 0.002)(p))
            return out

        pieces.append(Piece(f'growth_{side}', growth, (a - 0.3, a + 0.3), 'bark', skin={'bone': f'clavicle_{side}'}, voxel=0.0022, budget=1600))
    pieces.append(Piece('mask', face_mask(L, B, skull, eyes, neck, 0.012), (skull - np.array([0.12, 0.17, 0.2]), skull + np.array([0.12, 0.02, 0.08])),
                        lambda p: mat_ids(p, 'bark', [(lambda q: cracks(q, 16, 0.02, 707), 'sapglow')]), skin={'bone': 'head'}, voxel=0.0016, budget=2400))
    pieces.append(Piece('eyes', glow_eyes(L), (eyes - 0.08, eyes + 0.08), 'sapglow', skin={'bone': 'head'}, voxel=0.0012, budget=400))
    head_ell = sdf.ellipsoid(skull + np.array([0, 0.02, 0.02]), (0.115, 0.135, 0.145))

    def cowl(p):
        # bark grown close over the back and top of the skull (following the head itself, so no gap
        # shows from the front), moss on the crown
        env = smin(B(p) - 0.013, head_ell(p) + 0.01, 0.02) - 0.004 * (sdf.fbm(p, 14, 3, 708) - 0.5)
        return np.maximum(np.abs(env) - 0.004, np.maximum(-(p[:, 1] - (skull[1] - 0.02)), (eyes[2] + 0.01) - p[:, 2]))

    pieces.append(Piece('cowl', cowl, (skull - np.array([0.2, 0.2, 0.15]), skull + np.array([0.2, 0.22, 0.2])),
                        lambda p: mat_ids(p, 'bark', [(lambda q: q[:, 2] > skull[2] + 0.07, 'moss')]), skin={'bone': 'head'}, voxel=0.002, budget=2400))
    return pieces


# =============================================================================================
def bloomcaller(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    def bodice(p):
        z = p[:, 2]
        env = B(p) - 0.012 - 0.003 * np.sin(z * 120 + p[:, 0] * 30)
        return np.maximum(np.abs(env) - 0.003, np.maximum(z - (neck[2] + 0.02), (zw - 0.06) - z))

    pieces.append(Piece('bodice', bodice, (np.array([-0.9, -0.3, zw - 0.1]), np.array([0.9, 0.3, neck[2] + 0.05])),
                        lambda p: mat_ids(p, 'leaf', [(lambda q: cracks(q, 14, 0.0045, 711) & (q[:, 2] < zw + 0.16), 'sapglow')]), skin='transfer', voxel=0.0032, budget=6000, inner=B))

    def petals(p):
        # a gown of overlapping petals: scalloped tiers, each lifting at its lower edge
        z = p[:, 2]
        out = np.full(len(p), 1e3)
        for k in range(5):
            top = zw + 0.02 - k * (zw - 0.05) / 5
            bot = top - (zw - 0.05) / 5 * 1.5
            f = skirt(L, top, bot, sx * (0.85 + 0.05 * k), 0.15 + 0.012 * k, 0.04, 0.0, 712 + k, folds=0.0)
            ang = np.arctan2(p[:, 1], p[:, 0])
            scallop = 0.02 * np.abs(np.sin(ang * 7 + k))
            out = np.minimum(out, np.maximum(f(p), (bot + scallop) - z))
        return out

    pieces.append(Piece('petals', petals, (np.array([-0.62, -0.52, -0.03]), np.array([0.62, 0.52, zw + 0.05])),
                        lambda p: mat_ids(p, 'petal', [(lambda q: np.mod(q[:, 2] * 5 / max(zw, 0.1) * 1.0, 1) > 0.85, 'leaf')]),
                        skin='transfer_skirt', voxel=0.0034, budget=8000))

    def mantle(p):
        z = p[:, 2]
        env = B(p) - 0.03 - 0.01 * np.abs(np.sin(np.arctan2(p[:, 1], p[:, 0]) * 11))
        r = np.hypot(p[:, 0], p[:, 1] * 1.2)
        hem = (zc - 0.2) + 0.04 * (sdf.fbm(np.column_stack([p[:, 0] * 4, p[:, 1] * 4, np.zeros_like(z)]), 3, 2, 718) - 0.5)
        return np.maximum(np.abs(env) - 0.003, np.maximum(hem - z, np.maximum(z - (neck[2] + 0.03), r - 0.44)))

    pieces.append(Piece('mantle', mantle, (np.array([-0.5, -0.35, zc - 0.28]), np.array([0.5, 0.35, neck[2] + 0.06])), 'leaf', skin='transfer', voxel=0.003, budget=3600))
    for side in 'lr':
        hb = R.head(f'hand_{side}')
        ea, wa = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')
        pieces.append(Piece(f'hand_{side}', lambda p, ea=ea, wa=wa: np.maximum(B(p) - 0.004, 0.7 - along(p, ea, wa)[0]), (hb - 0.18, hb + 0.18),
                            lambda p: mat_ids(p, 'bark', [(lambda q: cracks(q, 22, 0.011, 719), 'sapglow')]), skin='transfer', voxel=0.0022, budget=2200))
        pieces.append(Piece(f'sleeve_{side}', lambda p, ea=ea, wa=wa: np.maximum(np.abs(along(p, ea, wa)[1] - (0.055 + 0.07 * np.clip(along(p, ea, wa)[0], 0, 1) ** 1.5)) - 0.003,
                                                                       np.maximum(-0.05 - along(p, ea, wa)[0], along(p, ea, wa)[0] - 0.85)),
                            ((ea + wa) / 2 - 0.25, (ea + wa) / 2 + 0.25), 'petal', skin={'bone': f'lowerarm_{side}', 'blend': [(f'upperarm_{side}', None, None)]}, budget=1800))
    pieces.append(Piece('mask', face_mask(L, B, skull, eyes, neck, 0.012), (skull - np.array([0.12, 0.17, 0.2]), skull + np.array([0.12, 0.02, 0.08])),
                        lambda p: mat_ids(p, 'bark', [(lambda q: (sdf.fbm(q, 30, 2, 720) > 0.64) & (q[:, 2] > eyes[2] + 0.01), 'moss')]), skin={'bone': 'head'}, voxel=0.0016, budget=2400))
    pieces.append(Piece('eyes', glow_eyes(L), (eyes - 0.08, eyes + 0.08), 'sapglow', skin={'bone': 'head'}, voxel=0.0012, budget=400))
    head_ell = sdf.ellipsoid(skull + np.array([0, 0.012, 0.01]), (0.11, 0.13, 0.14))

    def hood(p):
        z = p[:, 2]
        env = smin(B(p) - 0.03, head_ell(p) - 0.02, 0.04)
        region = np.maximum((zc - 0.02) - z, np.hypot(p[:, 0], p[:, 1] * 1.15) - 0.3)
        face = np.hypot(p[:, 0] / 0.075, (p[:, 2] - (eyes[2] - 0.025)) / 0.1) - 1.0
        opening = np.maximum(face, p[:, 1] - (skull[1] - 0.02))
        return np.maximum(np.maximum(np.abs(env) - 0.0032, region), -opening)

    pieces.append(Piece('hood', hood, (np.array([-0.3, -0.3, zc - 0.06]), np.array([0.3, 0.3, L['top'] + 0.08])), 'leaf', skin='transfer', voxel=0.003, budget=3800))
    # a circlet of open blossoms seated on the hood's brow, a leaf between each pair
    hc = skull + np.array([0, 0.012, 0.01])
    hr = np.array([0.11, 0.13, 0.14]) + 0.023  # the hood's outer surface
    flowers, leaves = [], []
    for i in range(9):
        a = -np.pi / 2 + (i - 4) * 0.34
        dz = 0.085 + 0.012 * abs(i - 4) / 4
        k = np.sqrt(max(1e-3, 1 - (dz / hr[2]) ** 2))
        on = hc + np.array([np.cos(a) * hr[0] * k, np.sin(a) * hr[1] * k, dz])
        nrm = (on - hc) / hr ** 2
        nrm /= np.linalg.norm(nrm)
        s = 0.034 - 0.009 * abs(i - 4) / 4
        flowers.append((on + nrm * 0.004, nrm, s, i * 0.7))
        if i < 8:
            a2 = a + 0.17
            on2 = hc + np.array([np.cos(a2) * hr[0] * k, np.sin(a2) * hr[1] * k, dz - 0.012])
            n2 = (on2 - hc) / hr ** 2
            leaves.append((on2 + n2 / np.linalg.norm(n2) * 0.002, n2 / np.linalg.norm(n2), a2))
    centres = np.array([f[0] for f in flowers])

    def crown(p):
        out = np.full(len(p), 1e3)
        for c, n, s, tw in flowers:
            u = np.cross(n, [0, 0, 1.0])
            u = u / max(np.linalg.norm(u), 1e-6) if np.linalg.norm(u) > 1e-3 else np.array([1.0, 0, 0])
            v = np.cross(n, u)
            for j in range(5):
                th = tw + j * 2 * np.pi / 5
                d = u * np.cos(th) + v * np.sin(th)
                dd = d + n * 0.45
                dd /= np.linalg.norm(dd)          # petals cup upwards a little
                nn = np.cross(dd, np.cross(n, dd))
                nn /= np.linalg.norm(nn)
                out = np.minimum(out, oriented_ellipsoid(c + dd * s * 0.52, (dd, np.cross(nn, dd), nn), (s * 0.55, s * 0.34, s * 0.075))(p))
            out = smin(out, sdf.sphere(c + n * s * 0.08, s * 0.2)(p), 0.006)
        return np.minimum(out, leaf_field(p))

    def leaf_field(p):
        out = np.full(len(p), 1e3)
        for c, n, a2 in leaves:
            t = np.array([-np.sin(a2), np.cos(a2), 0.0])
            t = t - n * (t @ n)
            t /= np.linalg.norm(t)
            out = np.minimum(out, oriented_ellipsoid(c, (t, np.cross(n, t), n), (0.026, 0.011, 0.0035))(p))
        return out

    def crown_mats(p):
        dc = np.min(np.linalg.norm(p[:, None, :] - centres[None], axis=2), axis=1)
        da = np.min(np.array([np.linalg.norm(p - (c + n * s * 0.08), axis=1) - s * 0.27 for c, n, s, _ in flowers]), axis=0)
        dl = leaf_field(p)
        return mat_ids(p, 'leaf', [(lambda q: (dc < 0.045) & (dl > 0.0015), 'petal'), (lambda q: da < 0.0, 'sapglow')])

    pieces.append(Piece('crown', crown, (hc - np.array([0.2, 0.2, 0.0]), hc + np.array([0.2, 0.2, 0.2])), crown_mats,
                        skin={'bone': 'head'}, voxel=0.0011, budget=5200))
    return pieces


def oriented_ellipsoid(c, axes, radii):
    """An ellipsoid with its own axes (three orthonormal vectors) and radii along them."""
    c = np.asarray(c, float)
    R = np.array(axes, float)
    r = np.asarray(radii, float)

    def f(p):
        q = ((p - c) @ R.T) / r
        k0 = np.linalg.norm(q, axis=1)
        k1 = np.linalg.norm(q / r, axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    return f


# =============================================================================================
def sylvaris(R, B, info):
    L = landmarks(R, info)
    zc, zw, zh, sx, neck = L['zc'], L['zw'], L['zh'], L['sx'], L['neck']
    skull, eyes = L['skull'], L['eyes']
    pieces = []

    def skin(p):
        grain = 0.0035 * np.sin(p[:, 0] * 90 + np.sin(p[:, 2] * 40) * 3)
        return np.maximum(np.abs(B(p) - 0.006 - grain) - 0.003, p[:, 2] - (neck[2] + 0.03))

    pieces.append(Piece('skin', skin, (np.array([-1.0, -0.36, -0.02]), np.array([1.0, 0.36, neck[2] + 0.06])),
                        lambda p: mat_ids(p, 'bark', [(lambda q: (cracks(q, 5, 0.012, 731) & (sdf.fbm(q, 2.2, 2, 732) > 0.5)), 'sapglow'),
                                                      (lambda q: sdf.fbm(q, 6, 3, 733) > 0.66, 'moss')]),
                        skin='transfer', voxel=0.0034, budget=13000, inner=B))
    zk = R.head('calf_l')[2]

    def gown(p):
        z = p[:, 2]
        out = np.full(len(p), 1e3)
        for k in range(4):
            top = zw + 0.02 - k * 0.18
            f = skirt(L, top, max(0.02, top - 0.42), sx * (0.92 + 0.08 * k), 0.16 + 0.02 * k, 0.12, 0.05, 734 + k, folds=0.018)
            out = np.minimum(out, f(p))
        return out

    pieces.append(Piece('gown', gown, (np.array([-0.7, -0.6, -0.03]), np.array([0.7, 0.6, zw + 0.06])),
                        lambda p: mat_ids(p, 'leaf', [(lambda q: q[:, 2] < 0.18 + 0.06 * sdf.fbm(q, 8, 2, 738), 'petal'),
                                                      (lambda q: sdf.fbm(q, 18, 2, 739) > 0.74, 'petal')]),
                        skin='transfer_skirt', voxel=0.0036, budget=9000))

    def mantle(p):
        z = p[:, 2]
        env = B(p) - 0.034 - 0.012 * (sdf.fbm(p, 8, 3, 740) - 0.5)
        r = np.hypot(p[:, 0], p[:, 1] * 1.2)
        hem = (zc - 0.24) + 0.05 * (sdf.fbm(np.column_stack([p[:, 0] * 4, p[:, 1] * 4, np.zeros_like(z)]), 3, 2, 741) - 0.5)
        return np.maximum(np.abs(env) - 0.004, np.maximum(hem - z, np.maximum(z - (neck[2] + 0.03), r - 0.48)))

    pieces.append(Piece('mantle', mantle, (np.array([-0.55, -0.38, zc - 0.32]), np.array([0.55, 0.38, neck[2] + 0.06])),
                        lambda p: mat_ids(p, 'moss', [(lambda q: sdf.fbm(q, 14, 2, 742) > 0.7, 'petal')]), skin='transfer', voxel=0.003, budget=4200))
    limbs = [('upperarm_l', 'lowerarm_l'), ('upperarm_r', 'lowerarm_r')]
    pieces.append(Piece('vines', vine_field(R, limbs, 2.0, 0.008, 0.07, 743, thorn=False), (np.array([-1.0, -0.4, zw - 0.2]), np.array([1.0, 0.4, zc + 0.1])),
                        lambda p: mat_ids(p, 'leaf', [(lambda q: sdf.fbm(q, 22, 2, 744) > 0.64, 'petal')]), skin='transfer', voxel=0.003, budget=5000))
    pieces.append(Piece('mask', face_mask(L, B, skull, eyes, neck, 0.011), (skull - np.array([0.12, 0.17, 0.2]), skull + np.array([0.12, 0.02, 0.08])),
                        lambda p: mat_ids(p, 'bark', [(lambda q: q[:, 2] > eyes[2] + 0.035, 'moss')]), skin={'bone': 'head'}, voxel=0.0015, budget=2800))
    pieces.append(Piece('eyes', glow_eyes(L), (eyes - 0.08, eyes + 0.08), 'sapglow', skin={'bone': 'head'}, voxel=0.0012, budget=400))
    hc = skull + np.array([0, 0.02, 0.06])

    def antlers(p):
        out = np.full(len(p), 1e3)
        for s in (1, -1):
            base = hc + np.array([s * 0.07, 0.0, 0.05])
            pts = [base, base + np.array([s * 0.12, 0.03, 0.14]), base + np.array([s * 0.24, 0.06, 0.32]), base + np.array([s * 0.3, 0.1, 0.52]),
                   base + np.array([s * 0.28, 0.12, 0.68])]
            for i in range(len(pts) - 1):
                out = np.minimum(out, sdf.capsule(pts[i], pts[i + 1], 0.022 - 0.004 * i, 0.019 - 0.004 * i)(p))
                tine = pts[i + 1] + np.array([-s * 0.07 * (i % 2 * 2 - 1), 0.03, 0.12])
                out = np.minimum(out, sdf.capsule(pts[i + 1], tine, 0.012, 0.003)(p))
                bud = pts[i + 1] + np.array([s * 0.02, -0.01, 0.01])
                out = np.minimum(out, sdf.sphere(bud, 0.018)(p))
        return out

    def antler_mats(p):
        m = np.full(len(p), MAT_INDEX['bark'])
        blossoms = np.full(len(p), False)
        for s in (1, -1):
            base = hc + np.array([s * 0.07, 0.0, 0.05])
            for off in ([s * 0.12, 0.03, 0.14], [s * 0.24, 0.06, 0.32], [s * 0.3, 0.1, 0.52], [s * 0.28, 0.12, 0.68]):
                bud = base + np.array(off) + np.array([s * 0.02, -0.01, 0.01])
                blossoms |= np.linalg.norm(p - bud, axis=1) < 0.024
        m[blossoms] = MAT_INDEX['petal']
        m[blossoms & (p[:, 2] > hc[2] + 0.5)] = MAT_INDEX['sapglow']
        return m

    pieces.append(Piece('antlers', antlers, (hc - np.array([0.42, 0.1, 0.02]), hc + np.array([0.42, 0.3, 0.86])), antler_mats,
                        skin={'bone': 'head'}, voxel=0.0022, budget=5000))
    return pieces
