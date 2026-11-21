"""
Anime character builder for Vowbreaker: sculpted from signed distance fields (sdf.py), on one
shared rig so every character can play every animation clip.

Pipeline per character (see cast.py for the designs):
  Proportions(spec)  -> joint positions from height and build (A-pose, identical bone directions)
  head / eyes / brows / mouth / ears  -> anime face on a head sized by the proportions
  hair locks         -> tapered, flattened locks grown from the scalp (spiky, long, tied...)
  clothing           -> shells and offsets of a body field (jackets, skirts, coats, robes)
  hands / shoes
  bake AO (Cycles)   -> UVMap.x;  ink line width -> UVMap.y;  face shadow thresholds -> UV2
  paint              -> vertex colour rgb = palette * hand-painted tint, alpha = material id / 8
  rig + weights      -> skinned, joined into one mesh (one draw call + one outline draw)

Blender axes: Z up, characters face -Y, their left is +X. 1 unit = 1 m.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import figure  # noqa: E402
import lib  # noqa: E402
import sdf  # noqa: E402
from figure import normal, on  # noqa: E402
from sdf import V, box, cone, cylinder, ellipsoid, intersect, offset, shell, subtract, torus, tube, union  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'chars')

MAT_ID = {'cloth': 0, 'skin': 1, 'hair': 2, 'eye': 3, 'metal': 4, 'face': 5, 'emissive': 6, 'paper': 7}
ARM_ANGLE = math.radians(42.0)     # A-pose: upper arms this far out from hanging straight down
FOOT_DIR = Vector((0, -1, -0.36)).normalized()


def smooth01(a, b, x):
    return sdf.smooth01(a, b, x)


# =============================================================================== proportions

class Proportions:
    """Joint positions for a character of height H. Every rig shares bone *directions*, so
    rotation-only animation clips authored on one rig play on all of them."""

    def __init__(self, H=1.72, kind='male', build=1.0, head_scale=1.0, leg=1.0):
        self.H = H
        self.kind = kind
        child = kind == 'child'
        female = kind == 'female'
        self.child = child
        self.female = female
        self.head_h = H * (0.172 if child else (0.136 if female else 0.13)) * head_scale
        self.z_crown = H
        self.z_chin = H - self.head_h
        u = self.head_h
        self.u = u
        self.head_c = V((0.0, 0.004 * H, self.z_chin + u * 0.6))       # cranium centre
        self.neck_base = self.z_chin - (0.035 if child else 0.042) * H
        self.z_sh = self.neck_base - 0.012 * H
        self.sw = H * (0.092 if child else (0.094 if female else 0.106)) * build
        self.hw = H * (0.05 if child else (0.062 if female else 0.056)) * build
        self.z_hip = H * (0.455 if child else 0.5) * leg
        self.z_knee = self.z_hip * 0.53
        self.z_ankle = H * 0.045
        self.ua = H * (0.16 if child else 0.172)
        self.fa = H * (0.14 if child else 0.152)
        self.hand_len = H * (0.085 if child else 0.098)
        self.foot_len = H * (0.13 if child else 0.145)
        self.dA = {s: Vector((s * math.sin(ARM_ANGLE), 0.0, -math.cos(ARM_ANGLE))) for s in (1, -1)}
        self.S = {s: Vector((s * self.sw, 0.0, self.z_sh)) for s in (1, -1)}
        self.E = {s: self.S[s] + self.dA[s] * self.ua for s in (1, -1)}
        self.W = {s: self.E[s] + self.dA[s] * self.fa for s in (1, -1)}
        self.Hp = {s: Vector((s * self.hw, 0.0, self.z_hip)) for s in (1, -1)}
        self.K = {s: Vector((s * self.hw, 0.0, self.z_knee)) for s in (1, -1)}
        self.A = {s: Vector((s * self.hw, 0.0, self.z_ankle)) for s in (1, -1)}
        self.Ball = {s: self.A[s] + FOOT_DIR * (self.foot_len * 0.66) for s in (1, -1)}
        self.Toe = {s: self.Ball[s] + Vector((0, -1, 0)) * (self.foot_len * 0.34) for s in (1, -1)}
        # torso widths
        self.waist = H * (0.058 if child else (0.054 if female else 0.066)) * build
        self.chest = H * (0.078 if child else (0.076 if female else 0.08)) * build
        self.depth = 0.66 if not female else 0.7
        self.face = {}

    # ------------------------------------------------------------------ body field (unclothed)
    def torso_field(self, grow=0.0):
        H = self.H
        prof = [
            (self.hw * (1.45 if self.female else 1.3) + grow, self.z_hip - 0.075 * H),
            (self.hw * (1.68 if self.female else 1.45) + grow, self.z_hip - 0.02 * H),
            (self.hw * (1.55 if self.female else 1.4) + grow, self.z_hip + 0.04 * H),
            (self.waist + grow, self.z_hip + 0.095 * H),
            (self.chest * 0.98 + grow, self.z_hip + 0.17 * H),
            (self.chest + grow, self.z_sh - 0.07 * H),
            (self.sw * 0.84 + grow, self.z_sh - 0.02 * H),
            (self.sw * 0.55 + grow, self.neck_base - 0.004 * H),
            (0.034 * H + grow, self.neck_base + 0.012 * H),
        ]
        t = sdf.revolve(prof, depth=self.depth)
        caps = [sdf.sphere(self.S[s] + Vector((-s * 0.006 * H, 0, -0.012 * H)), 0.034 * H + grow) for s in (1, -1)]
        f = union(t, *caps, k=0.03 * H)
        if self.female:
            bust = sdf.mirror_x(ellipsoid((0.042 * H, -0.04 * H, self.z_sh - 0.085 * H), (0.04 * H + grow, 0.032 * H + grow, 0.034 * H + grow)))
            f = union(f, bust, k=0.02 * H)
        return f

    def arm_field(self, s, r=(0.031, 0.027, 0.02), grow=0.0):
        H = self.H
        return tube([self.S[s] - self.dA[s] * 0.01 * H, self.E[s], self.W[s]], [r[0] * H + grow, r[1] * H + grow, r[2] * H + grow])

    def leg_field(self, s, r=(0.052, 0.036, 0.024), grow=0.0):
        H = self.H
        top = self.Hp[s] + Vector((0, 0, 0.03 * H))
        return tube([top, self.K[s], self.A[s] + Vector((0, 0, 0.01 * H))], [r[0] * H + grow, r[1] * H + grow, r[2] * H + grow])

    def body_field(self, grow=0.0):
        return union(self.torso_field(grow), *[self.arm_field(s, grow=grow) for s in (1, -1)],
                     *[self.leg_field(s, grow=grow) for s in (1, -1)], k=0.02 * self.H)

    # ------------------------------------------------------------------ head local -> world
    def hp(self, x, y, z):
        """A point in head units (u = head height) relative to the cranium centre."""
        c = self.head_c
        return V((c[0] + x * self.u, c[1] + y * self.u, c[2] + z * self.u))

    def hr(self, *r):
        return V(r) * self.u


# =============================================================================== figure / parts

class Character:
    def __init__(self, name, palette, P):
        self.name = name
        self.P = P
        self.palette = dict(palette)
        self.parts = []
        self.extra_bones = []      # (name, head, tail, parent)
        self.weight_overrides = {}

    def mat(self, mname):
        # every part's colour is painted into the vertex colours; the material itself is white
        return lib.mat(f'{self.name}_{mname}', '#FFFFFF', vcol=True)

    def part(self, name, f, lo, hi, step, mname, kind, tris, mid='cloth', line=1.0, symmetric=False, face=False):
        ob = sdf.sculpt(f'{self.name}_{name}', f, lo, hi, step, self.mat(mname), tris, symmetric=symmetric)
        return self.add(ob, mname, kind, mid, line, face)

    def add(self, ob, mname, kind, mid='cloth', line=1.0, face=False):
        ob['kind'] = kind
        ob['mname'] = mname
        ob['mid'] = mid
        ob['line'] = line
        ob['face'] = face
        self.parts.append(ob)
        print(f'  {ob.name}: {sum(len(p.vertices) - 2 for p in ob.data.polygons)} tris')
        return ob

    def col(self, mname):
        return V(lib.srgb(self.palette[mname]))


def bbox(*pts, pad=0.05):
    a = np.array([list(p) for p in pts])
    return a.min(0) - pad, a.max(0) + pad


# =============================================================================== head and face

def head_field(P, style):
    """Skull, face, jaw, cheeks, chin, nose and neck in head units. style: jaw (0 round .. 1 sharp
    V-jaw), width, cheek (fullness), nose (size), age (0 young .. 1 old: a heavier brow)."""
    jaw = style.get('jaw', 0.6)
    w = style.get('width', 1.0)
    cheek = style.get('cheek', 0.5)
    hp, hr = P.hp, P.hr
    cran = ellipsoid(hp(0, 0.02, 0.02), hr(0.43 * w, 0.47, 0.47))
    face = ellipsoid(hp(0, -0.12, -0.16), hr(0.37 * w, 0.36, 0.34))
    jz = -0.36 - 0.06 * jaw
    jaw_f = ellipsoid(hp(0, -0.16, jz), hr((0.3 - 0.06 * jaw) * w, 0.26, 0.2))
    chk = sdf.mirror_x(ellipsoid(hp(0.2 * w, -0.27, -0.24), hr(0.14 + 0.04 * cheek, 0.12, 0.12)))
    chin = ellipsoid(hp(0, -0.29 - 0.03 * jaw, -0.47 - 0.05 * jaw), hr(0.1 - 0.02 * jaw, 0.09, 0.08))
    h = union(cran, face, k=0.15 * P.u)
    h = union(h, jaw_f, k=0.12 * P.u)
    h = union(h, chk, k=0.1 * P.u)
    h = union(h, chin, k=0.09 * P.u)
    if style.get('brow_ridge', 0) > 0:
        ridge = ellipsoid(hp(0, -0.36, 0.06), hr(0.3 * w, 0.06, 0.05))
        h = union(h, ridge, k=0.06 * P.u * style['brow_ridge'])
    ns = style.get('nose', 1.0)
    nose = union(ellipsoid(hp(0, -0.465, -0.2), hr(0.04 * ns, 0.035 * ns, 0.04 * ns)),
                 ellipsoid(hp(0, -0.43, -0.12), hr(0.025 * ns, 0.03 * ns, 0.08 * ns)), k=0.03 * P.u)
    h = union(h, nose, k=0.035 * P.u)
    neck = cone((0, 0.01 * P.H, P.neck_base - 0.02 * P.H), tuple(hp(0, 0.06, -0.5)), 0.035 * P.H, 0.032 * P.H)
    h = union(h, neck, k=0.06 * P.u)
    ears = sdf.mirror_x(ellipsoid(hp(0.43 * w, 0.03, -0.1), hr(0.05, 0.1, 0.13), sdf.rot(0, 0, -15)))
    return union(h, ears, k=0.03 * P.u)


def build_head(C, style):
    """The face: head surface (skin, with the face region marked for the face-shadow shader),
    eyes with painted irises, upper lash lines, brows, mouth. Fills P.face with feature points."""
    P = C.P
    u = P.u
    base = head_field(P, style)
    lo, hi = P.hp(-0.75, -0.75, -1.1), P.hp(0.75, 0.75, 0.62)
    lo[2] = P.neck_base - 0.04 * P.H
    C.part('head', base, lo, hi, u * 0.0062, style.get('skin', 'skin'), 'face', style.get('tris', 9000), mid=style.get('mid', 'skin'), line=0.75, face=style.get('face_shadow', True))
    if style.get('faceless'):
        for k, (x, z) in {'eye_L': (0.17, -0.1), 'eye_R': (-0.17, -0.1), 'brow_L': (0.17, 0.05), 'brow_R': (-0.17, 0.05),
                          'mouth': (0.0, -0.38), 'mouth_L': (0.07, -0.37), 'mouth_R': (-0.07, -0.37)}.items():
            P.face[k] = Vector(tuple(P.hp(x, -0.42, z)))
        return base
    eye_x = style.get('eye_x', 0.17)
    eye_z = style.get('eye_z', -0.1)
    ew, eh = style.get('eye_w', 0.085), style.get('eye_h', 0.1)
    tilt = style.get('eye_tilt', 6.0)        # outer corners up (sharp) or down (soft)
    sink = 0.012
    eye_r = P.hr(ew, 0.025, eh)
    iris = (ew * u * style.get('iris', 0.72), eh * u * style.get('iris', 0.72) * 1.08)
    for s, side in ((1, 'L'), (-1, 'R')):
        E, R = figure.eye_frame(base, s * eye_x * u + P.head_c[0], P.head_c[2] + eye_z * u, sink * u)
        R = R @ sdf.rot(0, -s * tilt, 0)
        white = ellipsoid(E, eye_r, R)
        lo_e, hi_e = E - u * 0.2, E + u * 0.2
        C.part(f'eye_{side}', white, lo_e, hi_e, u * 0.0028, 'eye_white', f'eye_{side}', 900, mid='eye', line=0.0)
        ic = E + V((-s * 0.006 * u, 0, -0.008 * u))
        C.iris_c = getattr(C, 'iris_c', {})
        C.iris_c[side] = (ic, iris)
        ob = figure.iris_disc(_FigShim(C), f'{C.name}_iris_{side}', E, R, eye_r, ic, iris, style.get('pupil', 0.46), f'eye_{side}')
        C.parts.pop()  # iris_disc registered through the shim; re-add with our tags
        C.add(ob, 'iris', f'eye_{side}', 'eye', 0.0)
        # highlights: a big one up and in, a small one down and out
        h1 = on(white, E + V((s * 0.025 * u, -0.2 * u, 0.04 * u)), (0, 1, 0), lift=0.002 * u)
        h2 = on(white, E + V((-s * 0.02 * u, -0.2 * u, -0.045 * u)), (0, 1, 0), lift=0.002 * u)
        hl = union(ellipsoid(h1, P.hr(0.02, 0.008, 0.024), R), ellipsoid(h2, P.hr(0.009, 0.006, 0.011), R))
        C.part(f'eyehi_{side}', hl, lo_e, hi_e, u * 0.002, 'eye_hi', f'eye_{side}', 200, mid='eye', line=0.0)
        # upper lash line: a thick ink stroke over the top of the eye, flicking out at the corner
        lash = []
        for phi in np.radians([172, 150, 125, 100, 75, 52, 30, 14]):
            local = V((s * math.cos(phi) * eye_r[0] * 1.06, -sink * u * 1.1, math.sin(phi) * eye_r[2] * 1.02))
            lash.append(E + R @ local)
        lash.append(E + R @ V((s * eye_r[0] * 1.35, -sink * u * 1.3, eye_r[2] * 0.38)))
        lw = style.get('lash', 1.0) * u
        C.part(f'lash_{side}', tube(lash, [x * lw for x in (0.006, 0.009, 0.011, 0.012, 0.012, 0.012, 0.011, 0.009, 0.003)]),
               lo_e, hi_e, u * 0.002, 'lash', f'eye_{side}', 400, mid='eye', line=0.0)
        # lower lid: a short faint stroke under the outer half
        low = [E + R @ V((s * math.cos(p) * eye_r[0] * 1.02, -sink * u, -math.sin(p) * eye_r[2] * 0.98)) for p in np.radians([20, 45, 70])]
        C.part(f'lowlid_{side}', tube(low, [0.002 * u, 0.0042 * u, 0.0015 * u]), lo_e, hi_e, u * 0.0015, 'lash', f'eye_{side}', 160, mid='eye', line=0.0)
        P.face[f'eye_{side}'] = E
        # brows: confident strokes, angled by the character's mood
        ba = style.get('brow_angle', 8.0) * (math.pi / 180)
        bz = P.head_c[2] + (eye_z + eh + 0.075) * u
        bx = [0.06, 0.12, 0.19, 0.25]
        brow = []
        for i, x in enumerate(bx):
            z = bz + (x - 0.15) * math.tan(ba) * u * -1 + (0.012 * u if i in (1, 2) else 0)
            brow.append(on(base, (s * x * u, P.head_c[1] - u, z), (0, 1, 0), lift=-0.004 * u))
        P.face[f'brow_{side}'] = Vector(tuple((brow[1] + brow[2]) / 2))
        bw = style.get('brow_w', 1.0) * u
        C.part(f'brow_{side}', tube(brow, [0.012 * bw, 0.018 * bw, 0.015 * bw, 0.006 * bw]), lo_e - u * 0.1, hi_e + u * 0.2,
               u * 0.002, 'brow', f'brow_{side}', 300, mid='hair', line=0.0)
    # mouth: a short line with its corners on their own bones
    mz = P.head_c[2] + style.get('mouth_z', -0.385) * u
    mw = style.get('mouth_w', 0.08)
    mpts = [on(base, (x * u, P.head_c[1] - u, mz + abs(x) * u * style.get("smile", 0.15)), (0, 1, 0), lift=-0.003 * u)
            for x in (-mw, -mw / 2, 0.0, mw / 2, mw)]
    P.face['mouth_L'], P.face['mouth_R'] = Vector(tuple(mpts[-1])), Vector(tuple(mpts[0]))
    P.face['mouth'] = Vector(tuple(mpts[2]))
    C.part('mouth', tube(mpts, [0.004 * u, 0.0075 * u, 0.008 * u, 0.0075 * u, 0.004 * u]),
           mpts[2] - u * 0.2, mpts[2] + u * 0.2, u * 0.0016, 'mouth', 'mouthline', 300, mid='eye', line=0.0)
    return base


class _FigShim:
    """figure.iris_disc wants a Figure; route its material and registration to a Character."""

    def __init__(self, C):
        self.C = C

    def M(self, name):
        return self.C.mat(name)

    def add(self, ob, kind):
        ob['kind'] = kind
        self.C.parts.append(ob)
        return ob

    def part(self, name, f, lo, hi, step, mname, kind, tris, symmetric=False):
        ob = sdf.sculpt(f'{self.C.name}_{name}', f, lo, hi, step, self.M(mname), tris, symmetric=symmetric)
        return self.add(ob, kind)


# =============================================================================== hair

def flat_lock(pts, radii, flat=0.55, normals=None):
    """A lock of hair: tapered tube through pts, squashed along `normals` (one per point, the
    direction across the lock's flat side, usually away from the head) by `flat`."""
    pts = [V(p) for p in pts]
    n = len(pts)
    if normals is None:
        normals = [V((0, 0, 1))] * n
    normals = [V(x) / np.linalg.norm(x) for x in normals]

    def f(Pq):
        best = np.full(len(Pq), np.inf)
        for i in range(n - 1):
            a, b = pts[i], pts[i + 1]
            ab = b - a
            t = np.clip(((Pq - a) @ ab) / (ab @ ab), 0.0, 1.0)
            c = a + np.outer(t, ab)
            d = Pq - c
            nrm = normals[i] * (1 - t)[:, None] + normals[i + 1] * t[:, None]
            nrm /= np.maximum(np.linalg.norm(nrm, axis=1), 1e-9)[:, None]
            # remove the along-the-lock component from the squash axis
            dn = np.einsum('ij,ij->i', d, nrm)
            perp = d - nrm * dn[:, None]
            r = radii[i] * (1 - t) + radii[i + 1] * t
            dist = np.sqrt(np.einsum('ij,ij->i', perp, perp) + (dn / flat) ** 2) - r
            best = np.minimum(best, dist * (0.5 + 0.5 * flat))
        return best
    return f


def scalp_point(P, theta, phi, lift=0.0, scale=1.03):
    """A point on (just above) the cranium: theta = azimuth (0 = front, +90 = left), phi = elevation."""
    th, ph = math.radians(theta), math.radians(phi)
    d = V((math.sin(th) * math.cos(ph), -math.cos(th) * math.cos(ph), math.sin(ph)))
    r = P.hr(0.43, 0.47, 0.47) * scale
    return P.head_c + V((0, 0.02 * P.u, 0.02 * P.u)) + d * r + d * lift * P.u, d


def lock_from(P, theta, phi, out, down, length, width, curl=0.0, flat=0.5, tip=0.12, segs=4, side_swing=0.0):
    """A lock rooted on the scalp, growing outward (`out`) and downward (`down`) for `length` head
    units, curling by `curl` (bends the tip back toward the head), tapering to a point."""
    root, d = scalp_point(P, theta, phi, lift=-0.05)
    th = math.radians(theta)
    side = V((math.cos(th), math.sin(th), 0.0))
    pts, rads, nrm = [], [], []
    for i in range(segs + 1):
        t = i / segs
        grow = d * out * t + V((0, 0, -1)) * down * t * t + side * side_swing * t * t
        bend = -d * curl * t ** 3
        p = root + (grow + bend) * length * P.u
        pts.append(p)
        rads.append(width * P.u * ((1 - t) ** 0.9 * (1 - tip) + tip * (1 - t) + 0.008))
        nrm.append(d)
    return flat_lock(pts, rads, flat, nrm)


def hair_cap(P, hairline_front=0.12, hairline_back=-0.55, grow=0.035, sides=-0.25):
    """The hair mass over the cranium, cut at a hairline (front higher, sides at the temples)."""
    c = P.head_c + V((0, 0.02 * P.u, 0.03 * P.u))
    r = P.hr(0.43 + grow, 0.47 + grow, 0.47 + grow)
    cap = ellipsoid(c, r)
    inner = ellipsoid(c, r - P.u * 0.05)
    shellf = subtract(cap, inner, k=0.004)

    def hairline(Pq):
        q = (Pq - c) / P.u
        front = smooth01(-0.1, -0.4, q[:, 1])       # toward the face
        side = smooth01(0.15, 0.4, np.abs(q[:, 0]))
        level = hairline_back + (hairline_front - hairline_back) * front * (1 - side) + (sides - hairline_back) * side * front
        return (level - q[:, 2]) * P.u
    return intersect(shellf, hairline, k=0.01 * P.u)


def hair_bounds(P, below=1.2, wide=0.85):
    return P.hp(-wide, -wide, -below), P.hp(wide, wide, 0.75)


# =============================================================================== clothing

def jacket(C, color='jacket', hem=None, open_front=0.0, collar='stand', sleeve_end=None, grow=0.008, tris=14000, buttons='button', kind='torso'):
    """A fitted jacket (gakuran style): torso shell with sleeves blended in, a standing collar,
    a hem, optionally open down the front, and a column of buttons."""
    P = C.P
    H = P.H
    hem = hem if hem is not None else P.z_hip - 0.05 * H
    body = union(P.torso_field(grow * H), *[P.arm_field(s, r=(0.031, 0.027, 0.023), grow=grow * H) for s in (1, -1)], k=0.025 * H)
    # cut at the hem and the cuffs, keep the top below the neck
    wr = sleeve_end if sleeve_end is not None else 0.0

    def keep(Pq):
        d = Pq[:, 2] - hem
        for s in (1, -1):
            # beyond the wrist (along the arm) is not jacket
            along = (Pq - V(P.W[s])) @ V(P.dA[s])
            near = np.linalg.norm(Pq - V(P.W[s]), axis=1) < 0.12 * H
            d = np.where(near & (along > -wr * H), np.minimum(d, -along - wr * H), d)
        # open only round the neck (cutting everything above would take the shoulder tops off)
        rxy = np.sqrt(Pq[:, 0] ** 2 + (Pq[:, 1] / 0.8) ** 2)
        top = np.maximum((P.neck_base + 0.006 * H) - Pq[:, 2], rxy - 0.05 * H)
        return -np.minimum(d, top)
    j = intersect(shell(offset(body, -0.004 * H), 0.009 * H), lambda Pq: keep(Pq), k=0.004 * H)
    if open_front > 0:
        def gap(Pq):
            w = open_front * H * (0.35 + 0.65 * smooth01(P.z_sh, hem, Pq[:, 2]))
            return np.maximum(np.abs(Pq[:, 0]) - w, Pq[:, 1])
        j = subtract(j, gap, k=0.003 * H)
    if collar == 'stand':
        ring = cylinder((0, 0.004 * H, P.neck_base - 0.004 * H), 0.046 * H, 0.03 * H, 0.0)
        col = intersect(shell(ring, 0.008 * H),
                        lambda Pq: (P.neck_base + 0.024 * H - 0.012 * H * smooth01(0.0, -0.04 * H, Pq[:, 1])) - Pq[:, 2])
        j = union(j, col, k=0.01 * H)
    lo, hi = bbox(P.W[1], P.W[-1], (0, 0, hem), (0, 0, P.neck_base + 0.05 * H), pad=0.08 * H)
    lo[1], hi[1] = -0.2 * H, 0.2 * H
    C.part('jacket', j, lo, hi, 0.0042 * H, color, kind, tris)
    if buttons and open_front <= 0:
        bl = []
        for i in range(5):
            z = P.z_sh - 0.03 * H - i * (P.z_sh - hem - 0.06 * H) / 4.5
            p = on(body, (0.0, -0.45, z), (0, 1, 0))
            n = normal(body, p)
            bl.append(sdf.sphere(p + n * 0.004 * H, 0.0075 * H))
        C.part('buttons', union(*bl), V((-0.05, -0.3, hem - 0.05)) * 1, V((0.05, 0.0, P.z_sh)), 0.0016 * H, buttons, 'torsopart', 1200, mid='metal', line=0.6)
    return body


def shirt(C, color='shirt', grow=0.004, top=None, bottom=None, hood=False, tris=6000):
    """An undershirt / hoodie front showing where a jacket is open."""
    P = C.P
    H = P.H
    top = top if top is not None else P.neck_base + 0.01 * H
    bottom = bottom if bottom is not None else P.z_hip - 0.04 * H
    t = intersect(P.torso_field(grow * H), lambda Pq: np.maximum(Pq[:, 2] - top, bottom - Pq[:, 2]))
    if hood:
        hd = ellipsoid((0, 0.052 * H, P.neck_base - 0.012 * H), (0.058 * H, 0.026 * H, 0.03 * H), sdf.rot(-25, 0, 0))
        t = union(t, hd, k=0.012 * H)
    lo, hi = V((-0.25 * H, -0.2 * H, bottom - 0.02)), V((0.25 * H, 0.2 * H, top + 0.08 * H))
    C.part('shirt', t, lo, hi, 0.0045 * H, color, 'torso', tris)


def pants(C, color='pants', top=None, cuff=None, r=(0.05, 0.04, 0.035), tris=7000, flare=0.0):
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.06 * H
    cuff = cuff if cuff is not None else P.z_ankle + 0.02 * H
    pelvis = intersect(P.torso_field(0.008 * H), lambda Pq: Pq[:, 2] - top)
    legs = []
    for s in (1, -1):
        a = P.Hp[s] + Vector((-s * 0.004 * H, 0, 0.0))
        legs.append(tube([a, P.K[s], P.A[s] + Vector((0, 0, 0.015 * H))], [r[0] * H, r[1] * H, (r[2] + flare) * H]))
    f = union(pelvis, *legs, k=0.02 * H)
    f = intersect(f, lambda Pq: cuff - Pq[:, 2])
    lo, hi = V((-0.2 * H, -0.15 * H, cuff - 0.02)), V((0.2 * H, 0.15 * H, top + 0.02))
    C.part('pants', f, lo, hi, 0.0045 * H, color, 'legs', tris)


def skirt(C, color='skirt', top=None, hem=None, flare=1.0, pleats=16, tris=9000):
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.1 * H
    hem = hem if hem is not None else P.z_knee - 0.06 * H
    rt = P.waist * 1.08
    rb = P.hw * 2.3 * flare
    prof = [(rb, hem), (rb * 0.88, (hem + top) / 2), (P.hw * 1.85, P.z_hip), (rt, top)]

    def pleat(th, z):
        a = smooth01(top, hem, z)
        return 1.0 + 0.045 * a * np.abs(np.sin(th * pleats / 2))
    outer = sdf.revolve(prof, depth=0.8, rmod=pleat)
    f = intersect(shell(offset(outer, -0.004 * H), 0.008 * H), lambda Pq: np.maximum(Pq[:, 2] - top, hem - Pq[:, 2]))
    lo, hi = V((-rb * 1.4, -rb * 1.4, hem - 0.02)), V((rb * 1.4, rb * 1.4, top + 0.02))
    C.part('skirt', f, lo, hi, 0.0045 * H, color, 'skirt', tris)
    C.extra_bones += [
        ('skirt_F', (0, -P.hw * 1.2, P.z_hip), (0, -rb * 1.0, hem), 'hips'),
        ('skirt_B', (0, P.hw * 1.2, P.z_hip), (0, rb * 1.0, hem), 'hips'),
        ('skirt_L', (P.hw * 1.6, 0, P.z_hip), (rb, 0, hem), 'hips'),
        ('skirt_R', (-P.hw * 1.6, 0, P.z_hip), (-rb, 0, hem), 'hips'),
    ]


def long_coat(C, color='coat', hem=None, open_front=0.05, collar=True, tris=16000, sleeves=True, wide_sleeves=0.0, grow=0.02):
    """A long coat or robe: fitted over the shoulders, falling loose to `hem`, open at the front."""
    P = C.P
    H = P.H
    hem = hem if hem is not None else P.z_knee - 0.04 * H
    r_hem = P.hw * 2.6

    prof = [(r_hem, hem), (P.hw * 2.2, P.z_knee + 0.04 * H), (P.hw * 1.95, P.z_hip), (P.waist + grow, P.z_hip + 0.095 * H),
            (P.chest + grow, P.z_hip + 0.17 * H), (P.chest + grow * 1.05, P.z_sh - 0.07 * H), (P.sw * 0.86 + grow, P.z_sh - 0.02 * H),
            (P.sw * 0.6, P.neck_base), (0.05 * H, P.neck_base + 0.02 * H)]

    def folds(th, z):
        a = smooth01(P.z_hip, hem, z)
        return 1.0 + 0.05 * a * (np.sin(th * 5 + 0.7) * 0.7 + np.sin(th * 9 + 2.1) * 0.3)
    outer = sdf.revolve(prof, depth=0.75, rmod=folds)
    caps = [sdf.sphere(P.S[s] + Vector((-s * 0.004 * H, 0, -0.008 * H)), 0.04 * H) for s in (1, -1)]
    body = union(outer, *caps, k=0.03 * H)
    if sleeves:
        arms = []
        for s in (1, -1):
            rw = (0.04 + wide_sleeves) * H
            arms.append(tube([P.S[s], P.E[s], P.W[s] - P.dA[s] * 0.01 * H], [0.042 * H, 0.038 * H + wide_sleeves * 0.5 * H, rw]))
        body = union(body, *arms, k=0.03 * H)
    c = intersect(shell(offset(body, -0.005 * H), 0.01 * H), lambda Pq: np.maximum(hem - Pq[:, 2], Pq[:, 2] - (P.neck_base + 0.03 * H)))
    if sleeves:
        # open the cuffs
        for s in (1, -1):
            c = subtract(c, sdf.sphere(P.W[s] + P.dA[s] * 0.03 * H, (0.032 + wide_sleeves * 0.9) * H), k=0.004 * H)
    if open_front > 0:
        def gap(Pq):
            w = open_front * H * (0.3 + 0.7 * smooth01(P.z_sh, P.z_hip, Pq[:, 2]))
            return np.maximum(np.abs(Pq[:, 0]) - w, Pq[:, 1])
        c = subtract(c, gap, k=0.003 * H)
    if collar:
        col = intersect(shell(ellipsoid((0, 0.02 * H, P.neck_base + 0.02 * H), (0.07 * H, 0.06 * H, 0.05 * H)), 0.012 * H),
                        lambda Pq: (P.neck_base + 0.055 * H) - Pq[:, 2], lambda Pq: Pq[:, 2] - (P.neck_base - 0.005 * H))
        c = union(c, col, k=0.008 * H)
    lo, hi = V((-0.6 * H, -0.35 * H, hem - 0.03)), V((0.6 * H, 0.35 * H, P.neck_base + 0.1 * H))
    C.part('coat', c, lo, hi, 0.005 * H, color, 'coat', tris)
    C.extra_bones += [
        ('coat_FL', (P.hw * 0.9, -P.hw * 1.2, P.z_hip), (P.hw * 1.2, -r_hem * 0.75, hem), 'hips'),
        ('coat_FR', (-P.hw * 0.9, -P.hw * 1.2, P.z_hip), (-P.hw * 1.2, -r_hem * 0.75, hem), 'hips'),
        ('coat_B', (0, P.hw * 1.2, P.z_hip), (0, r_hem * 0.75, hem), 'hips'),
        ('coat_L', (P.hw * 1.6, 0, P.z_hip), (r_hem, 0, hem), 'hips'),
        ('coat_R', (-P.hw * 1.6, 0, P.z_hip), (-r_hem, 0, hem), 'hips'),
    ]
    return body


def shoes(C, color='shoes', sole='sole', boot=0.0, tris=1800):
    P = C.P
    H = P.H
    for s, side in ((1, 'L'), (-1, 'R')):
        a = P.A[s]
        toe = P.Toe[s]
        L = P.foot_len
        foot = union(ellipsoid(a + Vector((0, -L * 0.42, -0.02 * H)), (0.036 * H, L * 0.55, 0.026 * H)),
                     ellipsoid(a + Vector((0, 0.006 * H, -0.01 * H)), (0.032 * H, 0.04 * H, 0.035 * H)), k=0.02 * H)
        # the ankle (sock or boot shaft) up into the trouser cuff, so nothing shows between them
        shaft = max(boot, 0.05)
        foot = union(foot, cone(a - Vector((0, 0, 0.01 * H)), a + Vector((0, 0, shaft * H)), 0.03 * H, 0.028 * H + boot * 0.01 * H), k=0.02 * H)
        foot = intersect(foot, lambda Pq: 0.012 * H - Pq[:, 2])
        lo, hi = V((a.x - 0.08 * H, toe.y - 0.03 * H, -0.01)), V((a.x + 0.08 * H, a.y + 0.08 * H, a.z + max(boot, 0.05) * H + 0.03))
        C.part(f'shoe_{side}', foot, lo, hi, 0.003 * H, color, f'foot_{side}', tris)
        prof = union(ellipsoid(a + Vector((0, -L * 0.42, 0)), (0.04 * H, L * 0.6, 1.0)), ellipsoid(a + Vector((0, 0.01 * H, 0)), (0.036 * H, 0.045 * H, 1.0)), k=0.02 * H)
        sl = intersect(prof, lambda Pq: np.abs(Pq[:, 2] - 0.008 * H) - 0.008 * H)
        C.part(f'sole_{side}', sl, lo - V((0, 0.01, 0.01)), hi, 0.0028 * H, sole, f'foot_{side}', 600)


def hands(C, color='skin', fist=0.7, glove=None):
    P = C.P
    H = P.H
    k = H / 1.4 * (1.0 if not P.child else 1.1)
    spec = figure.HandSpec(at=0.036 * k * 0.9, palm=(0.0135 * k, 0.024 * k, 0.025 * k), palm_round=0.012 * k,
                           wrist=(0.016 * k, 0.017 * k), base=0.019 * k, spread=0.0145 * k,
                           lengths=(0.024 * k, 0.017 * k, 0.014 * k), finger_r=(0.0062 * k, 0.0055 * k),
                           curl=(25 + 40 * fist, 45 + 50 * fist, 40 + 40 * fist), thumb=(0.019 * k, 0.015 * k),
                           thumb_r=(0.0092 * k, 0.0078 * k, 0.0068 * k), blend=(0.001 * k, 0.006 * k, 0.007 * k))
    for s, side in ((1, 'L'), (-1, 'R')):
        ob = figure.hand(_FigShim(C), s, side, V(P.E[s]), V(P.W[s]), spec, color, 2200, step=0.0011 * k)
        C.parts.pop()
        C.add(ob, color, f'hand_{side}', 'skin' if color == 'skin' else 'cloth', 0.7)


# =============================================================================== rig

def bones(C):
    P = C.P
    H = P.H
    zp = P.z_hip
    B = [('root', (0, 0, 0), (0, -0.2 * H, 0), None),
         ('hips', (0, 0, zp), (0, 0, zp + 0.08 * H), 'root'),
         ('spine', (0, 0, zp + 0.08 * H), (0, 0, zp + 0.18 * H), 'hips'),
         ('chest', (0, 0, zp + 0.18 * H), (0, 0, P.neck_base), 'spine'),
         ('neck', (0, 0, P.neck_base), (0, 0, P.z_chin + 0.03 * H), 'chest'),
         ('head', (0, 0, P.z_chin + 0.03 * H), (0, 0, P.z_crown), 'neck')]
    for s, side in ((1, 'L'), (-1, 'R')):
        B += [(f'shoulder_{side}', (s * 0.025 * H, 0, P.z_sh), tuple(P.S[s]), 'chest'),
              (f'upperarm_{side}', tuple(P.S[s]), tuple(P.E[s]), f'shoulder_{side}'),
              (f'forearm_{side}', tuple(P.E[s]), tuple(P.W[s]), f'upperarm_{side}'),
              (f'hand_{side}', tuple(P.W[s]), tuple(P.W[s] + P.dA[s] * P.hand_len), f'forearm_{side}'),
              (f'thigh_{side}', tuple(P.Hp[s]), tuple(P.K[s]), 'hips'),
              (f'shin_{side}', tuple(P.K[s]), tuple(P.A[s]), f'thigh_{side}'),
              (f'foot_{side}', tuple(P.A[s]), tuple(P.Ball[s]), f'shin_{side}'),
              (f'toe_{side}', tuple(P.Ball[s]), tuple(P.Toe[s]), f'foot_{side}')]
    # face: every face bone points straight up (same directions on every rig)
    for k in ('eye_L', 'eye_R', 'brow_L', 'brow_R', 'mouth', 'mouth_L', 'mouth_R'):
        c = P.face.get(k)
        if c is None:
            c = Vector(tuple(P.head_c))
        c = Vector(tuple(c))
        B.append((k, tuple(c), tuple(c + Vector((0, 0, 0.02 * P.u * 5))), 'head'))
    B += C.extra_bones
    return B


def segs_of(arm):
    return {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}


def chain_weights(names, segs, power=5.0, mult=None):
    sub = {n: segs[n] for n in names if n in segs}
    return lambda p: lib.dist_weights(p, sub, mult, power)


def torso_weights(P, segs):
    """Clothing on the trunk: blends hips -> spine -> chest by height, plus the shoulders."""
    H = P.H
    zp = P.z_hip

    def fn(p):
        x, y, z = p
        a, b, c = zp + 0.04 * H, zp + 0.13 * H, zp + 0.23 * H
        if z <= a:
            w = {'hips': 1.0}
        elif z <= b:
            t = (z - a) / (b - a)
            w = {'hips': 1 - t, 'spine': t}
        elif z <= c:
            t = (z - b) / (c - b)
            w = {'spine': 1 - t, 'chest': t}
        else:
            w = {'chest': 1.0}
        extra = {'neck': smooth01(P.neck_base - 0.01 * H, P.neck_base + 0.03 * H, z)}
        for s, side in ((1, 'L'), (-1, 'R')):
            extra['shoulder_' + side] = 0.75 * smooth01(P.sw * 0.45, P.sw * 0.95, s * x) * smooth01(P.z_sh - 0.08 * H, P.z_sh - 0.02 * H, z)
            # the lower hem follows the thighs
            extra['thigh_' + side] = 0.6 * smooth01(zp + 0.02 * H, zp - 0.08 * H, z) * smooth01(-0.02 * H, 0.04 * H, s * x)
        k = max(0.0, 1.0 - sum(extra.values()))
        w = {kk: v * k for kk, v in w.items()}
        w.update(extra)
        return w
    return fn


def leg_weights(P, segs):
    def fn(p):
        side = 'L' if p.x > 0 else 'R'
        w = lib.dist_weights(p, {b: segs[b] for b in ('hips', f'thigh_{side}', f'shin_{side}', f'foot_{side}')}, {'hips': 0.4}, 6.0)
        return w
    return fn


def skirt_weights(P, segs, prefix):
    names = [n for n in segs if n.startswith(prefix)]

    def fn(p):
        H = P.H
        z = p.z
        upper = smooth01(P.z_hip - 0.02 * H, P.z_hip + 0.08 * H, z)
        w = {'hips': upper}
        rest = 1.0 - upper
        if rest > 0:
            sub = lib.dist_weights(p, {n: segs[n] for n in names}, None, 4.0)
            legs = lib.dist_weights(p, {n: segs[n] for n in ('thigh_L', 'thigh_R')}, None, 4.0)
            ssum = sum(sub.values())
            lsum = sum(legs.values())
            for k, v in sub.items():
                w[k] = w.get(k, 0) + rest * 0.6 * v / ssum
            for k, v in legs.items():
                w[k] = w.get(k, 0) + rest * 0.4 * v / lsum
        return w
    return fn


def head_weights(P):
    def fn(p):
        z = p.z
        hw = smooth01(P.z_chin - 0.01 * P.H, P.z_chin + 0.03 * P.H, z)
        cw = smooth01(P.neck_base + 0.005 * P.H, P.neck_base - 0.02 * P.H, z) * (1 - hw)
        return {'head': hw, 'chest': cw, 'neck': max(0.0, 1 - hw - cw)}
    return fn


def face_weights(P):
    hwf = head_weights(P)

    def fn(p):
        w = hwf(p)
        front = smooth01(P.head_c[1] - 0.1 * P.u, P.head_c[1] - 0.3 * P.u, p.y)
        extra = {}
        for side in ('L', 'R'):
            mk, bk = P.face.get(f'mouth_{side}'), P.face.get(f'brow_{side}')
            if mk is not None:
                extra[f'mouth_{side}'] = 0.55 * front * smooth01(0.09 * P.u, 0.02 * P.u, (p - mk).length)
            if bk is not None:
                extra[f'brow_{side}'] = 0.35 * front * smooth01(0.1 * P.u, 0.025 * P.u, (p - bk).length)
        k = max(0.0, 1.0 - sum(extra.values()))
        w = {b: v * k for b, v in w.items()}
        w.update(extra)
        return w
    return fn


def weight_fn(C, kind, segs):
    P = C.P
    if kind in C.weight_overrides:
        return C.weight_overrides[kind](segs)
    if kind in ('head', 'hair'):
        base = head_weights(P)
        hair_bones = [n for n in segs if n.startswith('hair_')]
        if kind == 'hair' and hair_bones:
            def fn(p):
                w = base(p)
                hb = lib.dist_weights(p, {n: segs[n] for n in hair_bones}, None, 5.0)
                # loose hair below the skull swings; hair on the skull stays with the head
                loose = smooth01(P.z_chin + 0.02 * P.H, P.z_chin - 0.08 * P.H, p.z) * smooth01(P.head_c[1], P.head_c[1] + 0.2 * P.u, p.y)
                hs = sum(hb.values())
                w = {k: v * (1 - loose) for k, v in w.items()}
                for k, v in hb.items():
                    w[k] = w.get(k, 0) + loose * v / hs
                return w
            return fn
        return base
    if kind == 'face':
        return face_weights(P)
    if kind == 'body':
        names = ['hips', 'spine', 'chest', 'neck', 'head'] + [f'{b}_{s}' for b in ('shoulder', 'upperarm', 'forearm', 'thigh', 'shin', 'foot') for s in 'LR']
        return chain_weights(names, segs, power=6.0, mult={'shoulder_L': 0.5, 'shoulder_R': 0.5})
    if kind in ('eye_L', 'eye_R', 'brow_L', 'brow_R', 'mouth'):
        return lambda p: {kind: 1.0}
    if kind == 'mouthline':
        def ml(p):
            wl = smooth01(0.004 * P.u, 0.06 * P.u, p.x)
            wr = smooth01(0.004 * P.u, 0.06 * P.u, -p.x)
            return {'mouth_L': wl, 'mouth_R': wr, 'mouth': max(0.0, 1.0 - wl - wr)}
        return ml
    if kind == 'torso':
        return figure.sleeve_weights(torso_weights(P, segs), segs, near=0.04 * P.H, far=0.06 * P.H)
    if kind == 'torsopart':
        return torso_weights(P, segs)
    if kind == 'legs':
        return leg_weights(P, segs)
    if kind == 'skirt':
        return skirt_weights(P, segs, 'skirt_')
    if kind == 'coat':
        upper = figure.sleeve_weights(torso_weights(P, segs), segs, near=0.045 * P.H, far=0.07 * P.H)
        lower = skirt_weights(P, segs, 'coat_')

        def coat(p):
            t = smooth01(P.z_hip + 0.03 * P.H, P.z_hip - 0.05 * P.H, p.z)
            if t <= 0:
                return upper(p)
            if t >= 1:
                return lower(p)
            a, b = upper(p), lower(p)
            out = {k: v * (1 - t) for k, v in a.items()}
            for k, v in b.items():
                out[k] = out.get(k, 0) + v * t
            return out
        return coat
    side = kind[-1]
    if kind.startswith('hand_'):
        return lambda p: {f'hand_{side}': 1.0}
    if kind.startswith('foot_'):
        return chain_weights((f'shin_{side}', f'foot_{side}', f'toe_{side}'), segs, power=7.0, mult={f'shin_{side}': 0.3})
    if kind.startswith('arm_'):
        return chain_weights((f'upperarm_{side}', f'forearm_{side}', f'hand_{side}'), segs, power=6.0)
    if kind.startswith('bone:'):
        b = kind[5:]
        return lambda p: {b: 1.0}
    raise ValueError(kind)


# =============================================================================== paint & vertex data

def face_thresholds(P, p):
    """Face-shadow thresholds for a point on the face (see vb_toon.faceShadow): light from the
    left lights the left half first; the nose throws a small shadow onto the far cheek."""
    q = (V(tuple(p)) - P.head_c) / P.u
    u = q[0] / 0.4                      # -1 right edge .. +1 left edge of the face
    thr_l = 0.3 + 0.55 * smooth01(0.3, -0.85, u)
    # nose shadow: a wedge just to the right of the nose, between nose tip and upper lip
    wedge = (1 - smooth01(0.0, 0.14, abs(q[0] + 0.06))) * smooth01(-0.32, -0.24, q[2]) * smooth01(-0.08, -0.16, q[2])
    thr_l = min(0.95, thr_l + 0.25 * wedge * (q[0] < 0))
    # eye sockets catch light a little later
    thr_l = thr_l + 0.05 * (1 - smooth01(0.0, 0.08, abs(q[2] + 0.1)))
    # the mirror for light from the right
    u2 = -u
    thr_r = 0.3 + 0.55 * smooth01(0.3, -0.85, u2)
    wedge_r = (1 - smooth01(0.0, 0.14, abs(-q[0] + 0.06))) * smooth01(-0.32, -0.24, q[2]) * smooth01(-0.08, -0.16, q[2])
    thr_r = min(0.95, thr_r + 0.25 * wedge_r * (q[0] > 0))
    thr_r = thr_r + 0.05 * (1 - smooth01(0.0, 0.08, abs(q[2] + 0.1)))
    return thr_l, thr_r


def paint_all(C, tint, ao):
    """Vertex colours (palette x tint, alpha = material id), UVMap (AO, line width), UV2 (face)."""
    P = C.P
    for ob in C.parts:
        me = ob.data
        for name in ('Col',):
            if name in me.color_attributes:
                me.color_attributes.remove(me.color_attributes[name])
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        mname = ob['mname']
        base = C.col(mname) if mname in C.palette else V((1.0, 0.0, 1.0))
        mid = MAT_ID[ob['mid']]
        a = ao.get(ob.name)
        nv = len(me.vertices)
        cols = np.empty((nv, 4), dtype=np.float32)
        aov = np.ones(nv)
        face = np.zeros((nv, 2)) + 0.5
        is_face = bool(ob['face'])
        for i, v in enumerate(me.vertices):
            w = ob.matrix_world @ v.co
            t = tint(C, w, ob['kind'], mname)
            m = mid
            if is_face:
                n = (ob.matrix_world.to_3x3() @ v.normal).normalized()
                q = (V(tuple(w)) - P.head_c) / P.u
                front = n.y < -0.25 and q[1] < -0.15 and q[2] > -0.7 and abs(q[0]) < 0.42
                if front:
                    m = MAT_ID['face']
                    face[i] = face_thresholds(P, w)
            cols[i] = (base[0] * t[0], base[1] * t[1], base[2] * t[2], m / 8.0)
            if a is not None:
                aov[i] = a[i]
        attr.data.foreach_set('color', cols.ravel())
        me.color_attributes.active_color_name = 'Col'
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        # AO remap: the bake reads dark in open crevices; keep a floor so nothing goes black
        ao_v = np.clip((aov - 0.2) / 0.8, 0.0, 1.0) ** 0.8
        line = float(ob['line'])
        for uvname, data in (('UVMap', np.stack([ao_v, np.full(nv, line)], 1)), ('UV2', face)):
            if uvname in me.uv_layers:
                me.uv_layers.remove(me.uv_layers[uvname])
            uvl = me.uv_layers.new(name=uvname)
            loops = np.empty(len(me.loops), dtype=np.int64)
            me.loops.foreach_get('vertex_index', loops)
            uvl.data.foreach_set('uv', data[loops].astype(np.float32).ravel())


def default_tint(C, p, kind, mname):
    P = C.P
    one = (1.0, 1.0, 1.0)
    if mname == 'skin':
        c = one
        for s in (1, -1):
            d = (V(tuple(p)) - P.hp(s * 0.2, -0.33, -0.24))
            b = math.exp(-(np.linalg.norm(d) / (0.09 * P.u)) ** 2) * C.palette.get('_blush', 0.5)
            c = (c[0], c[1] * (1 - 0.16 * b), c[2] * (1 - 0.18 * b))
        return c
    if mname == 'iris':
        side = 'L' if p.x > 0 else 'R'
        ic, iris = C.iris_c[side]
        dx, dz = (p.x - ic[0]) / iris[0], (p.z - ic[2]) / iris[1]
        r = math.hypot(dx, dz)
        k = (0.55 + 0.55 * smooth01(0.6, -0.7, dz)) * (1 - 0.45 * smooth01(0.75, 1.0, r))
        if r < 0.46:
            k *= 0.12
        return (k, k, k)
    if mname == 'hair':
        q = (V(tuple(p)) - P.head_c) / P.u
        tips = C.palette.get('_hair_tips')
        k = 0.82 + 0.18 * smooth01(-0.6, 0.4, q[2])
        if tips is not None:
            t = smooth01(0.55, 0.95, np.linalg.norm(q))
            tc = V(lib.srgb(tips)) / np.maximum(C.col('hair'), 1e-3)
            return tuple((1 - t) * k + t * tc * k)
        return (k, k, k)
    if kind in ('torso', 'coat', 'skirt', 'legs'):
        k = 0.92 + 0.08 * smooth01(0.0, P.H * 0.8, p.z)
        return (k, k, k)
    return one


# =============================================================================== assemble & export

def finish(C, tint=default_tint, ao_distance=None):
    """AO, paint, rig, weights, join; returns (armature, mesh)."""
    P = C.P
    ao = sdf.bake_ao([o for o in C.parts if o['mid'] != 'eye'], distance=ao_distance or 0.06 * P.H, samples=48)
    paint_all(C, tint, ao)
    arm = lib.armature(f'{C.name}_rig', bones(C))
    segs = segs_of(arm)
    for ob in C.parts:
        lib.set_weights(ob, weight_fn(C, ob['kind'], segs))
    body = lib.join(C.parts, C.name)
    lib.bind(body, arm)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f'{C.name}: {tris} tris, {len(body.data.vertices)} verts')
    return arm, body


def export(C, arm, body, path=None):
    path = path or os.path.join(OUT, f'{C.name}.glb')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    figure.rest_pose(arm)
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    body.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_animations=False, export_skins=True, export_morph=False,
        export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True, export_extras=False, export_def_bones=False)
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')


VIEW = {'front': (-25, 2.9, 0.52), 'back': (155, 2.9, 0.52), 'side': (-90, 2.9, 0.52),
        'face': (-8, 0.75, None), 'face3q': (-38, 0.8, None)}


def preview(C, arm, out, views='front,face3q,back'):
    P = C.P
    figure.rest_pose(arm)
    for name in views.split(','):
        yaw, dist, tz = VIEW[name]
        if tz is None:
            tgt = (0, 0, float(P.head_c[2]) - 0.15 * P.u)
            d = dist * P.u / 0.23
        else:
            tgt = (0, 0, tz * P.H)
            d = dist * P.H / 1.72
        lib.preview(out.replace('.png', f'_{name}.png'), target=tgt, dist=d, yaw=yaw, pitch=4, size=(560, 760), lens=55, samples=16)


def tights(C, color='tights', top=None, bottom=None, tris=4000):
    P = C.P
    H = P.H
    top = top if top is not None else P.z_hip + 0.02 * H
    bottom = bottom if bottom is not None else P.z_ankle
    f = union(*[P.leg_field(s, r=(0.046, 0.034, 0.026), grow=0.002 * H) for s in (1, -1)],
              intersect(P.torso_field(0.002 * H), lambda Pq: Pq[:, 2] - top), k=0.02 * H)
    f = intersect(f, lambda Pq: np.maximum(Pq[:, 2] - top, bottom - Pq[:, 2]))
    C.part('tights', f, V((-0.2 * H, -0.15 * H, bottom - 0.02)), V((0.2 * H, 0.15 * H, top + 0.03)), 0.004 * H, color, 'legs', tris)


def sash(C, name, color, ref, a, b, width, thick=0.008, kind='torsopart', tris=3000, mid='cloth'):
    """A band lying on surface `ref` along the straight line a -> b (kesa, straps, obi ties)."""
    P = C.P
    H = P.H
    a, b = V(tuple(a)), V(tuple(b))
    d = (b - a) / np.linalg.norm(b - a)

    def band(Pq):
        t = np.clip((Pq - a) @ d, 0, np.linalg.norm(b - a))
        c = a + np.outer(t, d)
        return np.linalg.norm(Pq - c, axis=1) - width
    f = intersect(lambda Pq: np.abs(ref(Pq) - thick * H) - thick * H * 0.5, band, k=0.003 * H)
    lo = np.minimum(a, b) - 0.25 * H
    hi = np.maximum(a, b) + 0.25 * H
    C.part(name, f, lo, hi, 0.0035 * H, color, kind, tris, mid=mid)


def obi(C, color='obi', z=None, height=0.06, grow=0.02, bow=True, tris=3000):
    P = C.P
    H = P.H
    z = z if z is not None else P.z_hip + 0.11 * H
    f = intersect(P.torso_field(grow * H), lambda Pq: np.abs(Pq[:, 2] - z) - height * H * 0.5, k=0.004 * H)
    if bow:
        f = union(f, ellipsoid((0, 0.1 * H, z), (0.08 * H, 0.035 * H, 0.05 * H)), k=0.01 * H)
    C.part('obi', f, V((-0.3 * H, -0.3 * H, z - 0.1 * H)), V((0.3 * H, 0.3 * H, z + 0.1 * H)), 0.0035 * H, color, 'torsopart', tris)


def beads(C, color, center, radius, n, r, kind='torsopart', tilt=(0, 0, 0)):
    P = C.P
    R = sdf.rot(*tilt)
    c = V(tuple(center))
    fs = []
    for i in range(n):
        a = 2 * math.pi * i / n
        p = c + R @ V((math.cos(a) * radius, math.sin(a) * radius * 0.85, 0))
        fs.append(sdf.sphere(p, r))
    C.part('beads', union(*fs), c - radius - 0.05, c + radius + 0.05, r * 0.25, color, kind, 3000, mid='cloth', line=0.6)


def face_mask(C, color='mask', mark='mask_mark', fox=False, tris=2500):
    """A flat paper / lacquer mask over the face, with painted slits (acolytes, Mikami's fox)."""
    P = C.P
    u = P.u
    shape = ellipsoid(P.hp(0, -0.44, -0.15), P.hr(0.36, 0.12, 0.45))
    m = subtract(shell(shape, 0.035 * u), ellipsoid(P.hp(0, -0.3, -0.15), P.hr(0.36, 0.14, 0.45)), k=0.01 * u)
    if fox:
        ears = sdf.mirror_x(cone(tuple(P.hp(0.2, -0.4, 0.2)), tuple(P.hp(0.28, -0.36, 0.48)), 0.09 * u, 0.01 * u))
        snout = ellipsoid(P.hp(0, -0.58, -0.25), P.hr(0.12, 0.12, 0.14))
        m = union(m, ears, snout, k=0.03 * u)
    C.part('mask', m, P.hp(-0.6, -1.0, -0.8), P.hp(0.6, 0.1, 0.7), u * 0.006, color, 'head', tris, mid='paper', line=0.8)
    slits = [cone(tuple(P.hp(s * 0.1, -0.56, -0.08)), tuple(P.hp(s * 0.25, -0.53, -0.02)), 0.018 * u, 0.008 * u) for s in (1, -1)]
    C.part('mask_mark', union(*slits), P.hp(-0.5, -0.8, -0.4), P.hp(0.5, -0.3, 0.3), u * 0.003, mark, 'head', 600, mid='emissive', line=0.0)
