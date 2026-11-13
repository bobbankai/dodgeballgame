"""Kael's gear: the battered plate-over-wool kit of a Dawn Vigil knight.

Every piece is a signed-distance sculpt fitted to his body (see armor.py). Plates float over a
smoothed envelope of the body (`env`), so they keep clean convex shapes instead of following muscles.
"""
import numpy as np

import sdf
from armor import Piece, along, smoothstep, material_by_fields, MAT_INDEX


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def gear(R, B):
    """R: armor.Rig, B: sdf.BodyField of the full body. Returns a list of Pieces."""
    zc = R.head('clavicle_l')[2]          # collarbone height
    zw = R.head('spine_01')[2]            # waist (navel)
    zh = R.head('pelvis')[2]              # hip joint height
    sx = R.head('upperarm_l')[0]          # shoulder joint x
    neck = R.head('neck_01')
    pieces = []

    # ------------------------------------------------------------ cuirass (breast + back plate)
    chest_c = np.array([0.0, 0.012, (zc + zw) / 2 + 0.03])
    torso_ell = sdf.ellipsoid(chest_c, (sx * 0.86, 0.165, (zc - zw) * 0.66))

    def torso_env(p):
        return smin(B(p) - 0.026, torso_ell(p), 0.07)

    def cuirass_region(p):
        z = p[:, 2]
        top = z - (zc + 0.03 - 0.035 * (np.abs(p[:, 0]) / sx) ** 2)
        r = np.maximum(top, (zw - 0.01) - z)
        # neckline: an oval cut around the neck, deeper at the front
        nd = np.hypot(p[:, 0] / 1.0, (p[:, 1] - neck[1] + 0.012) / 1.2) - 0.118
        r = np.maximum(r, -nd + np.maximum(0, (zc + 0.03) - z) * 0)
        # arm holes: elliptic cylinders front-to-back through each armpit
        for s in (1, -1):
            c = np.array([s * sx * 0.98, 0.0, zc - 0.085])
            ah = np.hypot((p[:, 0] - c[0]) / 1.15, (p[:, 2] - c[2])) - 0.105
            r = np.maximum(r, -ah)
        r = np.maximum(r, np.abs(p[:, 0]) - sx * 1.02)
        return r

    def cuirass_field(p):
        r = cuirass_region(p)
        front = p[:, 1] < chest_c[1]
        ridge = 0.007 * np.exp(-(p[:, 0] / 0.02) ** 2) * front * smoothstep(zw, zw + 0.08, p[:, 2])
        roll = 0.0065 * np.exp(-(r / 0.006) ** 2)
        a = torso_env(p) - ridge - roll
        return np.maximum(np.abs(a) - 0.0028 - roll * 0.35, r)

    def cuirass_mats(p):
        r = cuirass_region(p)
        m = np.full(len(p), MAT_INDEX['steel'])
        m[r > -0.011] = MAT_INDEX['gold']        # gilded rolled edges
        # the cracked sunburst emblem on the breast: gold disc with the godspark seam
        front = p[:, 1] < -0.05
        c = np.array([0.0, 0.0, zc - 0.13])
        d = np.hypot(p[:, 0] - c[0], p[:, 2] - c[2])
        ang = np.arctan2(p[:, 2] - c[2], p[:, 0] - c[0])
        rays = (np.cos(ang * 12) > 0.55) & (d < 0.085) & (d > 0.04)
        m[front & ((d < 0.04) | rays)] = MAT_INDEX['gold']
        crack = front & (np.abs(p[:, 0] - 0.008 * np.sin(p[:, 2] * 90)) < 0.0035) & (np.abs(p[:, 2] - c[2]) < 0.075)
        m[crack] = MAT_INDEX['glow']
        return m

    lo = np.array([-sx * 1.15, -0.24, zw - 0.03])
    hi = np.array([sx * 1.15, 0.24, zc + 0.08])
    pieces.append(Piece('cuirass', cuirass_field, (lo, hi), cuirass_mats, skin={'bone': 'spine_03', 'blend': [('spine_02', zw + 0.06, zw + 0.0)]}, voxel=0.0028, budget=5200))

    # ------------------------------------------------------------ faulds (waist lames)
    hip_c = np.array([0.0, 0.01, (zw + zh) / 2])
    hip_ell = sdf.ellipsoid(hip_c, (sx * 0.95, 0.16, 0.16))

    def fauld_field(p):
        z = p[:, 2]
        band = np.clip((zw - z) / 0.052, 0, 3.999)
        step = np.floor(band)
        frac = band - step
        off = 0.03 + 0.007 * step + 0.006 * frac
        env = smin(B(p) - off, hip_ell(p) - 0.006 * step, 0.06)
        region = np.maximum(z - (zw + 0.005), (zw - 0.052 * 3) - z)
        # groove between lames
        groove = 0.0025 * np.exp(-((frac - 0.0) / 0.06) ** 2)
        return np.maximum(np.abs(env + groove) - 0.0026, region)

    def fauld_mats(p):
        band = np.clip((zw - p[:, 2]) / 0.052, 0, 3.999)
        frac = band - np.floor(band)
        m = np.full(len(p), MAT_INDEX['steel'])
        m[frac > 0.86] = MAT_INDEX['gold']
        return m

    pieces.append(Piece('faulds', fauld_field, (np.array([-sx * 1.1, -0.24, zw - 0.2]), np.array([sx * 1.1, 0.24, zw + 0.03])),
                        fauld_mats, skin={'bone': 'pelvis', 'blend': [('spine_01', zw - 0.02, zw + 0.02)]}, budget=3000))

    # ------------------------------------------------------------ gorget (layered collar)
    nax_a = R.head('neck_01')
    nax_b = R.tail('neck_01')

    def gorget_field(p):
        t, rad = along(p, nax_a + np.array([0, 0.01, -0.06]), nax_b)
        band = np.clip(t * 3, 0, 2.999)
        step = np.floor(band)
        r_t = 0.128 - 0.02 * t - 0.006 * step
        env = rad - r_t
        region = np.maximum(-t, t - 0.52)
        return np.maximum(np.abs(env) - 0.0026, region)

    pieces.append(Piece('gorget', gorget_field, (nax_a + np.array([-0.17, -0.17, -0.09]), nax_a + np.array([0.17, 0.17, 0.12])),
                        lambda p: np.where(along(p, nax_a, nax_b)[0] > 0.44, MAT_INDEX['gold'], MAT_INDEX['steel']),
                        skin={'bone': 'neck_01', 'blend': [('spine_03', nax_a[2] - 0.05, nax_a[2] + 0.01)]}, budget=2800))

    # ------------------------------------------------------------ pauldrons (left larger: shield side)
    for s, side, scale in ((1, 'l', 1.18), (-1, 'r', 1.0)):
        a = R.head(f'upperarm_{side}')
        b = R.tail(f'upperarm_{side}')
        outward = np.array([s * 1.0, 0.0, 0.75])
        outward /= np.linalg.norm(outward)
        cap_c = a + np.array([s * 0.005, 0.0, 0.02])

        def pauldron_field(p, a=a, b=b, cap_c=cap_c, outward=outward, scale=scale):
            t, rad = along(p, a, b)
            tc = np.clip(t, 0, 1)
            band = np.clip(tc / 0.14, 0, 3.999)
            step = np.floor(band)
            frac = band - step
            r_t = (0.112 - 0.011 * step + 0.006 * frac) * scale
            tube = np.where(t > 0, rad - r_t, np.linalg.norm(p - a, axis=1) - r_t)
            cap = np.linalg.norm(p - cap_c, axis=1) - 0.122 * scale
            env = smin(tube, cap, 0.03)
            # keep the outer side only, down to ~55% of the upper arm
            side_cut = -((p - a) @ outward) - 0.035 * scale
            region = np.maximum(side_cut, t - 0.56)
            roll = 0.006 * np.exp(-(region / 0.006) ** 2)
            groove = 0.0022 * np.exp(-((frac - 0.0) / 0.07) ** 2) * (t > 0.02)
            return np.maximum(np.abs(env - roll + groove) - 0.0028, region)

        def pauldron_mats(p, a=a, b=b, outward=outward, scale=scale):
            t, _ = along(p, a, b)
            side_cut = -((p - a) @ outward) - 0.035 * scale
            region = np.maximum(side_cut, t - 0.56)
            band = np.clip(np.clip(t, 0, 1) / 0.14, 0, 3.999)
            frac = band - np.floor(band)
            m = np.full(len(p), MAT_INDEX['steel'])
            m[(region > -0.012) | ((frac > 0.85) & (t > 0.05))] = MAT_INDEX['gold']
            return m

        c = a + outward * 0.03
        lo = c - 0.2 * scale
        hi = c + 0.2 * scale
        pieces.append(Piece(f'pauldron_{side}', pauldron_field, (lo, hi), pauldron_mats,
                            skin={'bone': f'upperarm_{side}', 'blend': [(f'clavicle_{side}', None, None)]},
                            voxel=0.0028, budget=3000))

        # ---------------------------------------------------- couter (elbow cop)
        e = R.head(f'lowerarm_{side}')
        fa = R.axis(f'lowerarm_{side}')
        ua = R.axis(f'upperarm_{side}')
        back = -(fa - ua)
        back = back / np.linalg.norm(back)
        cc = e + back * 0.025

        def couter_field(p, cc=cc, back=back, e=e):
            d = np.linalg.norm(p - cc, axis=1) - 0.055
            wing = sdf.ellipsoid(cc + back * 0.005 + np.array([s * 0.03, 0, 0]), (0.05, 0.06, 0.035))(p)
            env = smin(d, wing, 0.02)
            region = -((p - e) @ back) + 0.005
            return np.maximum(np.abs(env) - 0.0026, region)

        pieces.append(Piece(f'couter_{side}', couter_field, (e - 0.12, e + 0.12),
                            lambda p, cc=cc: np.where(np.linalg.norm(p - cc, axis=1) < 0.02, MAT_INDEX['gold'], MAT_INDEX['steel']),
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'upperarm_{side}', None, None)]}, budget=900))

        # ---------------------------------------------------- vambrace with flared gauntlet cuff
        la, lb = R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}')

        def vamb_field(p, la=la, lb=lb):
            t, rad = along(p, la, lb)
            env = B(p) - (0.013 + 0.018 * smoothstep(0.86, 1.02, t))
            env = np.minimum(env, rad - 0.047 - 0.004 * t)
            region = np.maximum(0.2 - t, t - 1.02)
            roll = 0.004 * np.exp(-(region / 0.006) ** 2)
            strap = 0.0025 * np.exp(-((t - 0.45) / 0.03) ** 2)
            return np.maximum(np.abs(env - roll - strap) - 0.0026, region)

        def vamb_mats(p, la=la, lb=lb):
            t, _ = along(p, la, lb)
            m = np.full(len(p), MAT_INDEX['steel'])
            m[np.abs(t - 0.45) < 0.035] = MAT_INDEX['darkleather']
            m[(t < 0.24) | (t > 0.98)] = MAT_INDEX['gold']
            return m

        mid = (la + lb) / 2
        pieces.append(Piece(f'vambrace_{side}', vamb_field, (mid - 0.2, mid + 0.2), vamb_mats,
                            skin={'bone': f'lowerarm_{side}', 'blend': [(f'hand_{side}', None, None)]}, budget=1600))

        # ---------------------------------------------------- leather glove (fitted hand)
        hb = R.head(f'hand_{side}')

        def glove_field(p, hb=hb, la=la, lb=lb):
            t, _ = along(p, la, lb)
            return np.maximum(B(p) - 0.0028, 0.93 - t)

        pieces.append(Piece(f'glove_{side}', glove_field, (hb - 0.16, hb + 0.16), 'darkleather', skin='transfer',
                            voxel=0.0022, budget=2600))

    # ------------------------------------------------------------ gambeson: torso, sleeves and a split skirt
    def gambeson_field(p):
        z = p[:, 2]
        quilt = 0.0024 * (np.exp(-((np.mod(p[:, 0] + z, 0.06) - 0.03) / 0.004) ** 2) +
                          np.exp(-((np.mod(p[:, 0] - z, 0.06) - 0.03) / 0.004) ** 2))
        torso = B(p) - 0.011 + quilt
        # sleeves stop just below the elbow
        for side in 'lr':
            t, _ = along(p, R.head(f'lowerarm_{side}'), R.tail(f'lowerarm_{side}'))
            near = np.linalg.norm(p - R.head(f'lowerarm_{side}'), axis=1) < 0.35
            torso = np.where(near & (t > 0.22), np.maximum(torso, (t - 0.22) * 0.5), torso)
        # skirt: flared cone around both thighs from waist to mid-thigh
        zt = zh - 0.30
        k = np.clip((zw - z) / (zw - zt), 0, 1)
        rx = sx * 0.95 + 0.06 * k
        ry = 0.15 + 0.03 * k
        skirt = np.hypot(p[:, 0] / rx, (p[:, 1] - 0.01) / ry) * np.minimum(rx, ry) - np.minimum(rx, ry)
        skirt = np.maximum(skirt, np.maximum(zt - z, z - zw))
        # front and back slits so the legs can stride
        slit = np.maximum(np.abs(p[:, 0]) - 0.012, (zh - 0.12) - z)
        skirt = np.maximum(skirt, -slit)
        solid = np.minimum(np.where(z > zh - 0.08, torso, 1.0), skirt + quilt)
        neck_cut = (z - (zc + 0.07))
        return np.maximum(np.abs(solid) - 0.0035, np.maximum(neck_cut, zt - z))

    pieces.append(Piece('gambeson', gambeson_field, (np.array([-0.62, -0.26, zh - 0.34]), np.array([0.62, 0.26, zc + 0.1])),
                        'wool', skin='transfer_skirt', voxel=0.0032, budget=6500))

    # ------------------------------------------------------------ trousers
    def trouser_field(p):
        z = p[:, 2]
        legs = B(p) - 0.0065
        region = np.maximum(z - (zh - 0.02), 0.2 - z)
        return np.maximum(np.abs(legs) - 0.003, region)

    pieces.append(Piece('trousers', trouser_field, (np.array([-0.32, -0.2, 0.17]), np.array([0.32, 0.2, zh + 0.02])),
                        'wool', skin='transfer', voxel=0.0032, budget=3200))

    # ------------------------------------------------------------ boots, greaves, knee cops
    for s, side in ((1, 'l'), (-1, 'r')):
        knee = R.head(f'calf_{side}')
        ankle = R.head(f'foot_{side}')
        ball = R.head(f'ball_{side}')
        toe = R.tail(f'ball_{side}')

        def boot_field(p, knee=knee, ankle=ankle, toe=toe):
            z = p[:, 2]
            t, _ = along(p, knee, ankle)
            env = B(p) - (0.009 + 0.006 * smoothstep(0.75, 1.0, t))
            # chunky toe box and heel
            toebox = sdf.ellipsoid(toe + np.array([0, 0.03, 0.025]), (0.052, 0.07, 0.04))(p)
            heel = sdf.box(ankle + np.array([0, 0.035, -0.075]), (0.045, 0.045, 0.015), 0.01)(p)
            env = smin(smin(env, toebox, 0.03), heel, 0.02)
            region = np.maximum(z - (knee[2] - 0.17), -0.001 - z)
            cuff = 0.006 * np.exp(-((z - (knee[2] - 0.185)) / 0.012) ** 2)
            return np.maximum(env - cuff, region)

        def boot_mats(p, knee=knee):
            z = p[:, 2]
            m = np.full(len(p), MAT_INDEX['leather'])
            m[z < 0.022] = MAT_INDEX['darkleather']
            m[z > knee[2] - 0.2] = MAT_INDEX['darkleather']
            return m

        foot_c = (ankle + toe) / 2
        pieces.append(Piece(f'boot_{side}', boot_field, (np.array([foot_c[0] - 0.13, -0.33, -0.01]), np.array([foot_c[0] + 0.13, 0.17, knee[2] - 0.08])),
                            boot_mats, skin='transfer', voxel=0.003, budget=2600))

        def greave_field(p, knee=knee, ankle=ankle):
            t, rad = along(p, knee, ankle)
            env = smin(B(p) - 0.026, rad - 0.062 - 0.012 * (1 - t), 0.03)
            front = (p[:, 1] - knee[1]) + 0.005  # front half only
            region = np.maximum(np.maximum(0.12 - t, t - 0.88), front)
            roll = 0.004 * np.exp(-(region / 0.005) ** 2)
            ridge = 0.004 * np.exp(-((p[:, 0] - knee[0]) / 0.012) ** 2)
            return np.maximum(np.abs(env - roll - ridge) - 0.0026, region)

        pieces.append(Piece(f'greave_{side}', greave_field, ((knee + ankle) / 2 - 0.3, (knee + ankle) / 2 + 0.3),
                            lambda p, knee=knee, ankle=ankle: np.where(np.abs(along(p, knee, ankle)[0] - 0.5) > 0.36, MAT_INDEX['gold'], MAT_INDEX['steel']),
                            skin={'bone': f'calf_{side}'}, budget=1400))

        kc = knee + np.array([0, -0.055, 0.005])

        def poleyn_field(p, kc=kc, knee=knee, s=s):
            q = p - kc
            # a shallow cop with a raised central ridge, plus a heart-shaped side wing
            dome = sdf.ellipsoid(kc + np.array([0, 0.016, 0]), (0.046, 0.032, 0.05))(p)
            ridge = 0.005 * np.exp(-(q[:, 0] / 0.006) ** 2) * (q[:, 1] < 0)
            wing = sdf.ellipsoid(kc + np.array([s * 0.05, 0.03, 0.0]), (0.022, 0.045, 0.045))(p)
            env = smin(dome - ridge, wing, 0.012)
            region = (p[:, 1] - (knee[1] - 0.008))
            roll = 0.003 * np.exp(-(region / 0.004) ** 2)
            return np.maximum(np.abs(env - roll) - 0.0024, region)

        def poleyn_mats(p, kc=kc):
            q = p - kc
            m = np.full(len(p), MAT_INDEX['steel'])
            m[np.abs(q[:, 0]) < 0.004] = MAT_INDEX['gold']
            m[np.linalg.norm(q * np.array([1, 1, 1]), axis=1) > 0.06] = MAT_INDEX['gold']
            return m

        pieces.append(Piece(f'poleyn_{side}', poleyn_field, (kc - 0.11, kc + 0.11), poleyn_mats,
                            skin={'bone': f'calf_{side}', 'blend': [(f'thigh_{side}', None, None)]}, budget=1100))

    # ------------------------------------------------------------ belt with buckle and pouches
    zb = zw - 0.2

    def belt_field(p):
        z = p[:, 2]
        env = smin(B(p) - 0.052, hip_ell(p) - 0.03, 0.05)
        band = np.abs(z - zb) - 0.024
        belt = np.maximum(np.abs(env) - 0.004, band)
        buckle = sdf.box(np.array([0, -0.205, zb]), (0.035, 0.012, 0.03), 0.006)(p)
        pouch_l = sdf.box(np.array([0.17, 0.12, zb - 0.06]), (0.045, 0.03, 0.055), 0.012)(p)
        pouch_r = sdf.box(np.array([-0.17, 0.12, zb - 0.06]), (0.045, 0.03, 0.055), 0.012)(p)
        return np.minimum(np.minimum(belt, buckle), np.minimum(pouch_l, pouch_r))

    def belt_mats(p):
        m = np.full(len(p), MAT_INDEX['darkleather'])
        m[(p[:, 1] < -0.19) & (np.abs(p[:, 0]) < 0.04)] = MAT_INDEX['gold']
        m[p[:, 2] < zb - 0.03] = MAT_INDEX['leather']
        return m

    pieces.append(Piece('belt', belt_field, (np.array([-0.32, -0.28, zb - 0.13]), np.array([0.32, 0.26, zb + 0.05])),
                        belt_mats, skin={'bone': 'pelvis'}, budget=1800))
    return pieces
