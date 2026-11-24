"""Stylized anime anatomy as labelled SDF primitives.

`Body(skel, **look)` builds the skin as a list of Parts (bone, field). The union of the parts is the
skin surface; each part's bone is used for skinning (see skin.py), so muscles weight to the bone they
belong to and joints blend where neighbouring parts meet.

Look parameters (all optional):
  build    0 slender .. 1 heavy-muscled      fat     0 .. 1 belly and softness
  chest    chest scale                        hips    pelvis/hip scale
  limb     limb thickness scale              hand    hand scale
  face     'boy' | 'girl' | 'man' | 'woman' | 'old' | 'child' | 'brute'
  jaw      jaw width scale                    chin    chin length scale
  nose     nose size scale                    ears    ear scale
  female   0/1 (adds bust, narrower waist)
"""
import math
import numpy as np
from . import sdf
from .sdf import Ellipsoid, RoundCone, Sphere, Box, Union, look_rot


class Part:
    def __init__(self, bone, field, name=''):
        self.bone = bone
        self.field = field
        self.name = name


def v(*a):
    return np.array(a, float)


def lerp(a, b, t):
    return a + (b - a) * t


def norm(a):
    return a / np.linalg.norm(a)


FACES = {
    #        cranium(w, d, h)    jaw width  chin len  cheek  eye size  nose  brow
    'boy':   dict(cw=0.098, cd=0.110, ch=0.110, jaw=1.0, chin=1.0, cheek=1.0, nose=1.0, brow=0.0),
    'girl':  dict(cw=0.096, cd=0.108, ch=0.110, jaw=0.88, chin=0.85, cheek=1.12, nose=0.8, brow=0.2),
    'man':   dict(cw=0.098, cd=0.112, ch=0.108, jaw=1.18, chin=1.12, cheek=0.85, nose=1.25, brow=0.7),
    'woman': dict(cw=0.095, cd=0.108, ch=0.108, jaw=0.92, chin=0.95, cheek=1.0, nose=0.9, brow=0.0),
    'old':   dict(cw=0.096, cd=0.108, ch=0.104, jaw=0.95, chin=0.9, cheek=0.8, nose=1.35, brow=0.5),
    'child': dict(cw=0.102, cd=0.110, ch=0.114, jaw=0.85, chin=0.75, cheek=1.25, nose=0.7, brow=0.0),
    'brute': dict(cw=0.100, cd=0.112, ch=0.104, jaw=1.4, chin=1.25, cheek=0.9, nose=1.5, brow=1.6),
}


class Body:
    def __init__(self, skel, **look):
        self.sk = skel
        L = dict(build=0.5, fat=0.0, chest=1.0, hips=1.0, limb=1.0, hand=1.0, face='boy', jaw=1.0, chin=1.0,
                 nose=1.0, ears=1.0, female=0, neck=1.0, belly=0.0, k=1.0)
        L.update(look)
        self.L = L
        self.parts = []
        self.face_anchor = {}
        self._torso()
        self._head()
        self._arms()
        self._legs()

    def add(self, bone, field, name=''):
        self.parts.append(Part(bone, field, name))
        return field

    # ------------------------------------------------------------------------------------------ torso
    def _torso(self):
        sk, L = self.sk, self.L
        j = sk.j
        b = L['build']
        fat = L['fat']
        cs, hs = L['chest'], L['hips']
        fem = L['female']
        pel, nec = j['pelvis'], j['neck']
        sc = sk.s['height'] / 1.70
        z0 = sk.s['leg'] - 0.065 * sc
        z1 = nec[2]
        # (fraction, rx, ry, oy, n) - front view width, side view depth, back offset, squareness
        keys = [
            (0.00, 0.108, 0.080, 0.010, 2.2),
            (0.11, 0.134, 0.094, 0.012, 2.3),
            (0.24, 0.136, 0.090, 0.008, 2.3),
            (0.37, 0.118, 0.083, 0.000, 2.2),
            (0.52, 0.128, 0.090, -0.002, 2.3),
            (0.68, 0.148, 0.096, 0.002, 2.5),
            (0.80, 0.158, 0.094, 0.008, 2.6),
            (0.90, 0.150, 0.082, 0.016, 2.8),
            (0.97, 0.105, 0.068, 0.022, 2.4),
            (1.04, 0.058, 0.054, 0.024, 2.0),
        ]
        spine, secs = [], []
        for f, rx, ry, oy, n in keys:
            z = z0 + (z1 - z0) * f
            # body widths react to build, fat, chest/hip scale and the female flag
            upper = np.clip((f - 0.45) / 0.4, 0, 1)
            lower = np.clip((0.4 - f) / 0.3, 0, 1)
            waist = np.exp(-((f - 0.37) / 0.12) ** 2)
            rx = rx * (1 + (cs - 1) * upper + (hs - 1) * lower) + 0.022 * b * upper - 0.01 * b * waist
            rx += fat * (0.05 * waist + 0.03) - fem * (0.024 * upper - 0.022 * lower + 0.016 * waist)
            ry = ry * (1 + (cs - 1) * upper * 0.6) + 0.01 * b * upper + fat * (0.06 * waist + 0.025) - fem * 0.008 * upper
            spine.append(v(0, 0.004 * math.sin(f * math.pi * 1.5), z))
            secs.append((rx * sc, ry * sc, 0, oy * sc - fat * 0.01 * waist * sc, n))
        self.add('torso', sdf.Loft(spine, secs, side=(1, 0, 0)), 'torso')
        # muscle detail, blended softly into the loft
        if not fem and b > 0.25:
            for sx in (1, -1):
                # broad and shallow, so the chest reads as a plane with a soft lower edge (no crease for shirts to catch)
                self.add('chest', Ellipsoid(v(sx * 0.06, -0.07 * cs, z0 + (z1 - z0) * 0.74) * v(1, 1, 1) * v(sc, sc, 1),
                                             v(0.082 * cs, (0.017 + 0.009 * b) * (1 - 0.6 * fat), 0.064) * sc, look_rot(v(sx * 0.12, -0.3, 1))), 'pec')
        if fem:
            bs = L.get('bust', 1.0)
            for sx in (1, -1):
                self.add('chest', Ellipsoid(v(sx * 0.058 * sc, -0.07 * sc, z0 + (z1 - z0) * 0.7), v(0.056, 0.05, 0.05) * sc * bs), 'bust')
        for sx in (1, -1):
            self.add('hips', Ellipsoid(v(sx * 0.056 * sc, 0.062 * sc * hs, z0 + (z1 - z0) * 0.1),
                                       v(0.066 + 0.008 * fem, 0.052 + 0.008 * fem, 0.072) * sc * hs), 'glute')
            # shoulder blade
            self.add('chest', Ellipsoid(v(sx * 0.07 * sc, 0.075 * sc, z0 + (z1 - z0) * 0.8), v(0.055, 0.025, 0.07) * sc), 'scapula')
        if L['belly'] > 0:
            self.add('spine', Ellipsoid(v(0, -0.06 * sc - 0.03 * L['belly'] * sc, z0 + (z1 - z0) * 0.36),
                                        v(0.13, 0.08 + 0.05 * L['belly'], 0.15) * sc * (0.85 + 0.45 * L['belly'])), 'belly')
        # neck
        nl = L['neck']
        hp = j['head']
        self.add('neck', sdf.Loft([nec + v(0, 0.012, -0.035) * sc, lerp(nec, hp, 0.5), hp + v(0, -0.002, 0.03) * sc],
                                  [((0.054 + 0.012 * b) * sc * nl, (0.05 + 0.01 * b) * sc * nl, 0, 0, 2.0),
                                   (0.039 * sc * nl, 0.039 * sc * nl, 0, 0.004 * sc, 2.0),
                                   (0.036 * sc * nl, 0.038 * sc * nl, 0, 0.008 * sc, 2.0)], side=(1, 0, 0)), 'neck')

    # ------------------------------------------------------------------------------------------ head
    def _head(self):
        sk, L = self.sk, self.L
        F = dict(FACES[L['face']])
        hs = sk.s['head']
        u = hs / 0.245
        chin = sk.j['chin'][2]
        o = v(0, 0, chin)

        def P(x, y, z):
            return o + v(x, y, z) * u

        jaw = F['jaw'] * L['jaw']
        chn = F['chin'] * L['chin']
        cran_c = P(0, 0.012, 0.16)
        cw, cd, chh = F['cw'] / 0.098, F['cd'] / 0.110, F['ch'] / 0.110
        cl, jw = chn, jaw
        # The head is one loft from chin to crown: front-view width, side-view depth and centre per height.
        # (z, half width, half depth, centre y, squareness)
        keys = [
            (0.006 - 0.010 * (cl - 1), 0.013 * (0.8 + 0.2 * jw), 0.02, -0.045 - 0.005 * (cl - 1), 2.0),
            (0.022 - 0.006 * (cl - 1), 0.03 * (0.85 + 0.15 * jw), 0.036, -0.041 - 0.004 * (cl - 1), 2.0),
            (0.044, 0.052 * jw, 0.054, -0.033, 2.1 + 0.2 * (jw - 1)),
            (0.068, 0.072 * jw * F['cheek'] ** 0.35, 0.073, -0.020, 2.25 + 0.2 * (jw - 1)),
            (0.098, 0.084 * cw, 0.090, -0.004, 2.1),
            (0.128, 0.093 * cw, 0.104 * cd, 0.008, 2.0),
            (0.160, 0.098 * cw, 0.112 * cd, 0.012, 2.0),
            (0.190 * chh, 0.095 * cw, 0.109 * cd, 0.015, 2.0),
        ]
        head = sdf.Loft([P(0, 0, z) for z, *_ in keys], [(rx * u, ry * u, 0, oy * u, n) for z, rx, ry, oy, n in keys], side=(1, 0, 0))
        # the crown: an ellipsoid dome over the top of the loft
        dome = Ellipsoid(P(0, 0.014, 0.162 * chh), v(0.097 * cw, 0.111 * cd, 0.085 * chh) * u)
        head = Union([head, dome], 0.02 * u)
        # cheeks: a soft fullness under the eyes, blended wide so it never reads as a separate lump
        cheeks = [Ellipsoid(P(sx * 0.04, -0.066, 0.084), v(0.03, 0.016, 0.026) * u * (0.6 + 0.4 * F['cheek'])) for sx in (1, -1)]
        head = Union([head] + cheeks, 0.045 * u)
        # flatten the front of the face a little (anime faces read as a plane under the eyes)
        flat = sdf.Plane(v(0, -1, 0.12), P(0, -0.104, 0.11))
        head = sdf.Intersect([head, flat], 0.035 * u)
        # brow ridge: one soft wide mass, only on older / heavier faces
        # brow: a broad soft mass (never thinner than it is tall, or it reads as a blade); only heavier faces
        if F['brow'] > 0.45:
            br = F['brow']
            head = Union([head, Ellipsoid(P(0, -0.084, 0.15), v(0.06, 0.012 + 0.004 * br, 0.016 + 0.004 * br) * u)], 0.03 * u)
        # nose: a small wedge, anime style
        ns = F['nose'] * L['nose']
        nose = Union([
            RoundCone(P(0, -0.099, 0.118), P(0, -0.106 - 0.004 * (ns - 1), 0.097 - 0.004 * (ns - 1)), 0.004 * u * ns, 0.0055 * u * ns),
            Ellipsoid(P(0, -0.102 - 0.004 * (ns - 1), 0.094 - 0.004 * (ns - 1)), v(0.008, 0.006, 0.0055) * u * ns),
        ], 0.008 * u)
        head = Union([head, nose], 0.016 * u)
        # very shallow eye sockets so the painted eyes sit in the face, and the mouth line
        sockets = Union([Ellipsoid(P(sx * 0.037, -0.113, 0.121), v(0.026, 0.01, 0.017) * u) for sx in (1, -1)])
        head = sdf.Subtract(head, sockets, 0.016 * u)
        # ears: thin along x, tall, tilted back; a bowl carved in the outer face
        ears = []
        for sx in (1, -1):
            e = L['ears']
            up = norm(v(0, 0.25, 1.0))
            out = v(sx, 0.0, 0.0)
            back = np.cross(up, out) * sx
            R = np.stack([out, back * sx, up], 1)
            c = P(sx * 0.1, 0.022, 0.112)
            ear = Ellipsoid(c, v(0.011, 0.02, 0.031) * u * e, R)
            hole = Ellipsoid(c + out * 0.008 * u, v(0.006, 0.013, 0.021) * u * e, R)
            ears.append(sdf.Subtract(ear, hole, 0.004 * u))
        head = Union([head] + ears, 0.012 * u)
        self.add('head', head, 'head')
        self.head_field = head
        # anchors used by the face decal and hair builders
        self.face_anchor = dict(
            eye_L=P(0.037, -0.112, 0.121), eye_R=P(-0.037, -0.112, 0.121),
            mouth=P(0, -0.096, 0.047), nose=P(0, -0.112, 0.09), brow=P(0, -0.1, 0.157),
            crown=P(0, 0.012, 0.245), cranium=cran_c, u=u, chin=chin,
            ear_L=P(0.094, 0.018, 0.112), ear_R=P(-0.094, 0.018, 0.112),
        )

    # ------------------------------------------------------------------------------------------ arms
    def _arms(self):
        sk, L = self.sk, self.L
        b = L['build']
        lt = L['limb'] * (1 + 0.15 * L['fat'])
        sc = sk.s['height'] / 1.70
        fem = L['female']
        m = (1 + 0.25 * (b - 0.5)) * (1 - 0.1 * fem)
        for side, sx in (('L', 1), ('R', -1)):
            sh = sk.j[f'shoulder.{side}']
            el = sk.j[f'elbow.{side}']
            wr = sk.j[f'wrist.{side}']
            ua = norm(el - sh)
            # 'up and out' across the arm in the arm's vertical plane: the deltoid swells this way
            lat = norm(np.cross(np.cross(ua, v(0, 0, 1)), ua)) if abs(ua[2]) < 0.99 else v(sx, 0, 0)
            if lat[2] < 0:
                lat = -lat
            # upper arm loft (X = forward): (t, r_fwd, r_side, o_fwd, o_side, n). It starts a little way down
            # the arm so its rounded end sits inside the shoulder instead of capping the joint like a ball.
            ukeys = [(0.14, 0.037, 0.039, 0, 0.002), (0.32, 0.045, 0.046, 0.004, 0), (0.6, 0.041, 0.043, 0.005, 0),
                     (0.86, 0.035, 0.037, 0.002, 0), (1.0, 0.033, 0.033, 0, 0)]
            self.add(f'upperarm.{side}', self._limb(sh, el, ukeys, sc * lt, m), 'upperarm')
            fkeys = [(0.0, 0.034, 0.036, 0, 0), (0.25, 0.036, 0.040, -0.002, 0.002), (0.6, 0.029, 0.033, 0, 0),
                     (1.0, 0.027, 0.0195, 0, 0)]
            self.add(f'forearm.{side}', self._limb(el, wr, fkeys, sc * lt, 0.6 + 0.4 * m), 'forearm')
            # deltoid: a long muscle wrapping the top and outside of the upper arm from the shoulder point to a
            # third of the way down, its top a little below the line of the trapezius (no ball on the joint)
            dr = min(1.08, 1 + 0.1 * (b - 0.5)) - 0.08 * fem
            self.add(f'upperarm.{side}', Ellipsoid(sh + ua * 0.05 * sc + lat * 0.004 * sc,
                                                   v(0.04 * dr, 0.04 * dr, 0.07) * sc * lt, look_rot(ua)), 'deltoid')
            # trapezius: from the side of the neck down to the shoulder point, so the shoulder line falls
            # smoothly from the neck into the deltoid
            nk = sk.j['neck']
            tr0 = v(sx * 0.034 * sc, nk[1] + 0.024 * sc, nk[2] + 0.004 * sc)
            tr1 = sh + v(-sx * 0.024, 0.008, -0.006) * sc
            self.add('chest', RoundCone(tr0, tr1, (0.03 + 0.006 * b) * sc, (0.022 + 0.004 * b) * sc), 'trapezius')
            self.add(f'forearm.{side}', Sphere(el + v(0, 0.006, 0) * sc, 0.029 * sc * lt), 'elbow')
            self._hand(side, sx)

    def _limb(self, a, b, keys, scale, muscle=1.0, side=(0, -1, 0)):
        d = b - a
        spine = [a + d * k[0] for k in keys]
        secs = []
        for t, rf, rs, of, os_, *rest in keys:
            n = rest[0] if rest else 2.0
            # muscle swell is strongest mid-limb
            mm = 1 + (muscle - 1) * math.sin(math.pi * min(max(t, 0), 1))
            secs.append((rf * scale * mm, rs * scale * mm, of * scale, os_ * scale, n))
        return sdf.Loft(spine, secs, side=side)

    def _hand(self, side, sx):
        sk, L = self.sk, self.L
        hsc = L['hand'] * sk.s['hand'] / 0.175
        side_ax, along, back = sk.frames[f'hand.{side}']
        wr = sk.j[f'wrist.{side}']
        kn = sk.tail_of(f'hand.{side}')
        # palm: rounded box between wrist and knuckles, thin across the back
        c = lerp(wr, kn, 0.55)
        R = np.stack([side_ax, along, back], 1)
        self.add(f'hand.{side}', Box(c, v(0.038, 0.048, 0.0125) * hsc, R, round=0.011 * hsc), 'palm')
        # thenar pad (thumb muscle)
        self.add(f'hand.{side}', Ellipsoid(lerp(wr, kn, 0.3) + side_ax * 0.022 * hsc - back * 0.006 * hsc,
                                           v(0.016, 0.026, 0.013) * hsc, R), 'thenar')
        self.add(f'hand.{side}', Sphere(wr, 0.024 * hsc), 'wrist')
        for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
            base_r = {'index': 0.0092, 'middle': 0.0096, 'ring': 0.009, 'pinky': 0.0078, 'thumb': 0.0115}[f] * hsc
            for i in (1, 2, 3):
                bn = f'{f}{i}.{side}'
                a = sk.head_of(bn)
                t = sk.tail_of(bn)
                r0 = base_r * (1.0 - 0.1 * (i - 1))
                r1 = base_r * (1.0 - 0.1 * i) * (0.92 if i == 3 else 1.0)
                # each phalanx slims a little between its joints (fingers aren't tubes)
                mid = lerp(a, t, 0.5)
                rm = (r0 + r1) * 0.5 * 0.9
                self.add(bn, Union([RoundCone(a, mid, r0, rm), RoundCone(mid, t, rm, r1)], 0.002 * hsc), f'{f}{i}')
                # the joint at the head of the phalanx: a soft knuckle on the back of the finger
                if i > 1 or f == 'thumb':
                    self.add(bn, Sphere(a + back * r0 * 0.25, r0 * 1.04), f'{f}{i}knuckle')
            if f != 'thumb':
                # the big knuckle at the base of each finger, standing up on the back of the hand
                b0 = sk.head_of(f'{f}1.{side}')
                self.add(f'hand.{side}', Sphere(b0 + back * base_r * 0.55 - along * base_r * 0.3, base_r * 1.08), f'{f}knuckle')

    # ------------------------------------------------------------------------------------------ legs
    def _legs(self):
        sk, L = self.sk, self.L
        b = L['build']
        lt = L['limb']
        fat = L['fat']
        sc = sk.s['height'] / 1.70
        fem = L['female']
        for side, sx in (('L', 1), ('R', -1)):
            hp = sk.j[f'hip.{side}']
            kn = sk.j[f'knee.{side}']
            an = sk.j[f'ankle.{side}']
            tkeys = [(-0.06, 0.076, 0.076, 0, 0.004), (0.25, 0.072, 0.071, 0.007, 0), (0.62, 0.063, 0.060, 0.007, 0),
                     (0.9, 0.051, 0.050, 0.002, 0), (1.0, 0.048, 0.048, 0, 0)]
            tk = [(t, rf + 0.012 * fat + 0.008 * fem, rs + 0.014 * fat + 0.006 * fem, of, os_) for t, rf, rs, of, os_ in tkeys]
            self.add(f'thigh.{side}', self._limb(hp + v(sx * 0.006, 0, 0.0), kn, tk, sc * lt, 1 + 0.25 * (b - 0.5)), 'thigh')
            skeys = [(0.0, 0.046, 0.046, 0.002, 0), (0.24, 0.051, 0.049, -0.012, 0), (0.5, 0.041, 0.040, -0.006, 0),
                     (0.82, 0.031, 0.031, 0, 0), (1.0, 0.029, 0.030, 0, 0)]
            self.add(f'shin.{side}', self._limb(kn, an, skeys, sc * lt, 1 + 0.25 * (b - 0.5)), 'shin')
            self.add(f'shin.{side}', Ellipsoid(kn + v(0, -0.02, 0.006) * sc, v(0.036, 0.024, 0.04) * sc * lt), 'kneecap')
            ball = sk.j[f'ball.{side}']
            toe = sk.j[f'toe.{side}']
            self.add(f'foot.{side}', RoundCone(an + v(0, 0.035, -0.035) * sc, ball + v(0, 0, -0.004), 0.034 * sc, 0.031 * sc), 'foot')
            self.add(f'foot.{side}', Sphere(an + v(0, 0.01, 0) * sc, 0.032 * sc), 'ankle')
            self.add(f'toe.{side}', RoundCone(ball + v(0, 0.005, -0.004), toe + v(0, 0, 0.004), 0.029 * sc, 0.021 * sc), 'toes')

    # ------------------------------------------------------------------------------------------
    def field(self, k=None):
        """The skin. The head joins the neck with a tight blend so the jaw line stays crisp."""
        k = (0.03 if k is None else k) * self.L['k']
        rest = Union([p.field for p in self.parts if p.name != 'head'], k)
        return Union([rest, self.head_field], 0.012 * self.face_anchor['u'])

    def region(self, bones, k=0.02):
        """Union of the parts that belong to the given bones (for garments built from the body)."""
        bones = set(bones)
        return Union([p.field for p in self.parts if p.bone in bones], k)
