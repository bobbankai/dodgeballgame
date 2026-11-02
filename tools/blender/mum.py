"""
Mum: Ada's mother, as she drew herself into the last page. An illustrator: tall and slender, long
wavy copper hair falling down her back, a loose braid forward over her right shoulder, the hair
tucked behind her left ear (a gold earring), freckles, hazel eyes; a deep indigo dress with its
sleeves pushed up, a canvas painter's apron over it splashed with the three colours of the book
(green, blue and gold), brushes in its pocket, a gold bangle, Mary Jane shoes. Nothing like Ada to
look at: a grown woman, drawn with a finer hand. Sculpted (sdf.py, figure.py), rigged and animated
here; exported to src/assets/models/mum.glb.

Her skeleton uses Ada's bone names (so the game's scenes and a few of Ada's clips, like walking,
drive her too, with offsets scaled to her longer legs); her standing, talking, kneeling hug and
goodbye are her own.

Blender axes: Z up, she faces -Y, her left is +X. She is about 1.71 m tall.

Run: blender -b -P tools/blender/mum.py [-- --preview out.png] [--poses out.png] [--export]
(VIEWS=front,back,... picks preview angles; SHOTS=clip:frame,... and YAW for poses)
"""
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(__file__))
import figure  # noqa: E402
import lib  # noqa: E402
import sdf  # noqa: E402
from figure import on, tri  # noqa: E402
from lib import smooth01  # noqa: E402
from sdf import V, box, cone, cylinder, ellipsoid, intersect, offset, shell, subtract, torus, tube, union  # noqa: E402

C = {
    'skin': '#F1CDB0', 'lips': '#B4565A', 'mouth': '#6A2A2A', 'eye_white': '#F8F3EC',
    'iris': '#7C8A44', 'eye_hi': '#FFFFFF', 'lash': '#2A1C18', 'hair': '#A0522E', 'hair_dark': '#7A3A22',
    'dress': '#36457A', 'dress_dark': '#2A3662', 'apron': '#EEE5D0', 'apron_dark': '#D8CCB0', 'tights': '#3A3040',
    'shoe': '#6A4632', 'sole': '#2E2420', 'gold': '#D9AE4A', 'wood': '#C79A62', 'brush_b': '#3D6B8C',
    'brush_g': '#E2B33C', 'bristle': '#3A2E2A', 'ribbon': '#3F7F7A',
}

# Ada's legs are 0.6 m to the hip, Mum's 0.9: offsets in Ada's clips scale by this
T_SCALE = 0.9 / 0.6

FIG = figure.Figure('mum', C)
M = FIG.M
part = FIG.part
PARTS = FIG.parts
ss = sdf.smooth01


# --- head ----------------------------------------------------------------------------------------

def cranium():
    return ellipsoid((0, 0.014, 1.608), (0.084, 0.096, 0.1))


def head_base():
    # the face narrows smoothly from the cheekbones to a small, soft chin
    face = ellipsoid((0, -0.016, 1.567), (0.068, 0.068, 0.079))

    def taper(P):
        Q = P.copy()
        Q[:, 0] = Q[:, 0] / (1.0 - 0.26 * ss(1.57, 1.49, P[:, 2]) ** 1.2)
        return Q
    h = union(cranium(), sdf.warp(face, taper), k=0.04)
    # the angle of the jaw, standing clear of the neck, and a small chin
    h = union(h, sdf.mirror_x(ellipsoid((0.039, -0.006, 1.52), (0.016, 0.03, 0.015))), k=0.03)
    h = union(h, ellipsoid((0, -0.056, 1.497), (0.0175, 0.016, 0.0145)), k=0.02)
    h = union(h, sdf.mirror_x(ellipsoid((0.05, -0.048, 1.585), (0.021, 0.019, 0.015))), k=0.018)
    # a slim, straight nose with a soft tip
    nose = union(cone((0, -0.074, 1.613), (0, -0.0915, 1.571), 0.0052, 0.0066),
                 ellipsoid((0, -0.0952, 1.5655), (0.0084, 0.0076, 0.0076)), k=0.006)
    nose = union(nose, sdf.mirror_x(ellipsoid((0.0068, -0.0872, 1.5615), (0.0047, 0.0046, 0.0042))), k=0.004)
    h = union(h, nose, k=0.008)
    # ears (only her left one shows: the right is under her hair)
    ear = subtract(ellipsoid((0.079, 0.01, 1.586), (0.011, 0.019, 0.027), sdf.rot(0, 0, -12)),
                   ellipsoid((0.086, 0.006, 1.588), (0.006, 0.012, 0.017)), k=0.003)
    h = union(h, ear, k=0.008)
    neck = cone((0, 0.018, 1.34), (0, 0.014, 1.505), 0.04, 0.033)
    h = union(h, neck, k=0.03)
    # the skin of her upper chest, showing at the dress's V neck
    chest = ellipsoid((0, -0.008, 1.3), (0.105, 0.072, 0.055))
    # a hint of collarbone where the V neck shows it
    chest = union(chest, sdf.mirror_x(cone((0.018, -0.062, 1.334), (0.1, -0.034, 1.357), 0.0045, 0.0055)), k=0.012)
    return union(h, chest, k=0.04)


EYE_AT = (0.0328, 1.5975)
EYE_R = V((0.0168, 0.0042, 0.0084))
EYE_SINK = 0.0016
IRIS = (0.0074, 0.0084)
PUPIL = 0.5
IRIS_C = {}
# where the face's expression bones sit (filled in by head()): mouth corners and brow middles
FACE_PTS = {}
MOUTH_Z = 1.527
FRECKLES = []


def eye_lid(E, R, s, k, lift):
    """Points along the top of eye s, inner corner to outer, `k` times the eye's size, `lift` above it."""
    pts = []
    for phi in np.radians([172, 150, 125, 100, 75, 50, 28, 10]):
        pts.append(E + R @ V((s * math.cos(phi) * EYE_R[0] * k, -EYE_SINK * 1.1, math.sin(phi) * EYE_R[2] * k + lift)))
    return pts


def head():
    base = head_base()
    h = base
    mouth_c = on(base, (0, -0.3, MOUTH_Z), (0, 1, 0))
    frames = {}
    for s in (1, -1):
        E, R = figure.eye_frame(base, s * EYE_AT[0], EYE_AT[1], EYE_SINK)
        frames[s] = (E, R)
        # a soft fold of eyelid above each eye
        h = union(h, tube(eye_lid(E, R, s, 1.08, 0.0042)[1:-1], [0.0011, 0.0013, 0.0014, 0.0013, 0.0012, 0.001]), k=0.0022)
    # the corners of her mouth tuck in a little
    for s in (1, -1):
        h = subtract(h, sdf.sphere(mouth_c + V((s * 0.0132, 0.0016, 0.0012)), 0.0018), k=0.003)
    part('head', h, (-0.11, -0.13, 1.25), (0.11, 0.13, 1.72), 0.0011, 'skin', 'face', 15000)

    for s, side in ((1, 'L'), (-1, 'R')):
        E, R = frames[s]
        white = ellipsoid(E, EYE_R, R)
        lo, hi = E - 0.03, E + 0.03
        part(f'eye_{side}', white, lo, hi, 0.0004, 'eye_white', f'eye_{side}', 900)
        ic = E + V((-s * 0.0009, 0, 0.0014))
        IRIS_C[side] = ic
        figure.iris_disc(FIG, f'iris_{side}', E, R, EYE_R, ic, IRIS, PUPIL, f'eye_{side}', lift=0.0006)
        g = on(white, E + V((s * 0.0028, -0.03, 0.0034)), (0, 1, 0), lift=0.0012)
        part(f'eyehi_{side}', union(ellipsoid(g, (0.0018, 0.001, 0.0021), R),
                                    ellipsoid(on(white, E + V((-s * 0.0025, -0.03, -0.0026)), (0, 1, 0), lift=0.001), (0.0008, 0.0006, 0.0009), R)),
             lo, hi, 0.0003, 'eye_hi', f'eye_{side}', 120)
        # the upper lash line, heavier at the outer corner and flicking out; a fine lower one
        lash = eye_lid(E, R, s, 1.02, 0.0)
        lash.append(E + R @ V((s * EYE_R[0] * 1.32, -EYE_SINK * 1.3, EYE_R[2] * 0.62)))
        part(f'lash_{side}', tube(lash, [0.0006, 0.0009, 0.0012, 0.0014, 0.0016, 0.0017, 0.0016, 0.0012, 0.0004]),
             lo, hi, 0.0003, 'lash', f'eye_{side}', 500)
        low = [E + R @ V((s * math.cos(phi) * EYE_R[0] * 1.02, -EYE_SINK * 1.1, -math.sin(phi) * EYE_R[2] * 0.98))
               for phi in np.radians([60, 40, 22, 8])]
        part(f'lashlow_{side}', tube(low, [0.0003, 0.0005, 0.0006, 0.0003]), lo, hi, 0.0003, 'lash', f'eye_{side}', 160)
        # fine arched brows, a shade darker than her hair
        brow = [on(base, (s * x, -0.3, z), (0, 1, 0), lift=0.0011) for x, z in ((0.011, 1.6205), (0.024, 1.627), (0.038, 1.628), (0.052, 1.6225))]
        FACE_PTS[f'brow_{side}'] = Vector(tuple((brow[1] + brow[2]) / 2))
        part(f'brow_{side}', tube(brow, [0.0009, 0.0013, 0.0011, 0.0005]), (s * 0.03 - 0.04, -0.11, 1.6), (s * 0.03 + 0.04, -0.05, 1.65),
             0.0004, 'hair_dark', f'brow_{side}', 300)
    # lips: a full lower lip, a bowed upper one, a warm closed smile; a dark line between them that
    # the mouth bone opens into her mouth when she talks
    y0 = mouth_c[1] + 0.0016
    upper = sdf.mirror_x(ellipsoid((0.0058, y0, MOUTH_Z + 0.0024), (0.0092, 0.0024, 0.0021), sdf.rot(0, 12, 0)))
    lower = ellipsoid((0, y0 + 0.0002, MOUTH_Z - 0.003), (0.0105, 0.0026, 0.0027))
    lips = union(upper, lower, k=0.0015)
    part('lips', lips, mouth_c - 0.03, mouth_c + 0.03, 0.0003, 'lips', 'lips', 900)
    line = [V((x, 0, MOUTH_Z + dz)) for x, dz in ((-0.0128, 0.0016), (-0.0065, -0.0002), (0.0, 0.0), (0.0065, -0.0002), (0.0128, 0.0016))]
    face_lips = union(base, lips)
    line = [on(face_lips, p + V((0, -0.3, 0)), (0, 1, 0), lift=-0.0003) for p in line]
    FACE_PTS['mouth_L'], FACE_PTS['mouth_R'] = Vector(tuple(line[-1])), Vector(tuple(line[0]))
    part('mouth', tube(line, [0.0003, 0.0006, 0.0007, 0.0006, 0.0003]), mouth_c - 0.03, mouth_c + 0.03, 0.0003, 'mouth', 'mouthline', 300)
    # freckles across her nose and cheeks: little dabs of colour painted into her skin (see tint)
    rnd = random.Random(31)
    FRECKLES.clear()
    for _ in range(30):
        x = rnd.uniform(-0.05, 0.05)
        z = 1.572 + rnd.uniform(-0.011, 0.012) - 0.25 * x * x
        if abs(x) < 0.012:
            continue
        FRECKLES.append((Vector(tuple(on(base, (x, -0.3, z), (0, 1, 0)))), rnd.uniform(0.0014, 0.002), rnd.uniform(0.6, 1.0)))
    # a gold drop on her left ear
    ep = V((0.0905, 0.004, 1.557))
    part('earring', union(sdf.sphere(ep + V((0, 0, -0.008)), 0.0036), torus(ep, 0.003, 0.0008, sdf.frame((1, 0, 0))), k=0.001),
         ep - 0.02, ep + 0.02, 0.0003, 'gold', 'head', 300)
    return base


# --- hair ----------------------------------------------------------------------------------------

HAIR_C = V((0, 0.016, 1.606))
HAIR_R = V((0.093, 0.105, 0.112))
PARTING = V((0.026, -0.03, 1.712))


def hairline(P):
    """Lowest the hair cap comes: a soft line over the forehead (parted on her left), down past her
    right ear, and tucked up behind her left one."""
    x, y = P[:, 0], P[:, 1]
    front = ss(0.0, -0.065, y)
    fore = 1.662 - 6.5 * x * x + 0.008 * ss(-0.02, 0.05, x)
    line = 1.52 + (fore - 1.52) * front
    tuck = 0.11 * np.exp(-((y - 0.006) / 0.024) ** 2) * ss(0.04, 0.07, x)
    return line + tuck


def lock_grooves(th, spacing, depth, seed=0.0):
    """Rounded locks with sharp partings between them, every `spacing` degrees round the head."""
    u = np.degrees(th) / spacing + 0.35 * np.sin(th * 3.0 + seed)
    v = 1.0 - tri(u + 0.5)
    return depth * (1.0 - np.sqrt(np.maximum(0.0, 1.0 - v * v)))


def cap_outer(P, grooves=True):
    q = P - HAIR_C
    puff = 1.0 + 0.025 * ss(-0.02, 0.06, q[:, 2]) + 0.02 * ss(0.0, 0.1, q[:, 1])
    k = np.sqrt((q[:, 0] / (HAIR_R[0] * puff)) ** 2 + (q[:, 1] / (HAIR_R[1] * puff)) ** 2 + (q[:, 2] / HAIR_R[2]) ** 2)
    d = (k - 1.0) * HAIR_R[0]
    if grooves:
        th = np.arctan2(q[:, 1], q[:, 0])
        fade = ss(0.97, 0.8, q[:, 2] / np.maximum(np.linalg.norm(q, axis=1), 1e-6))
        d = d + lock_grooves(th, 9.0, 0.0019) * fade
    return d


def curtain(P):
    """Her long hair falling down her back in loose waves, ragged at the ends."""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    s = ss(1.56, 1.36, z)
    rx = 0.09 + 0.057 * s
    ry = 0.1 + 0.037 * s
    back = 0.032 * s
    th = np.arctan2((y - back) / ry, x / rx)
    wave = (0.006 * np.sin(th * 10 + z * 22) + 0.003 * np.sin(th * 23 - z * 31)) * ss(1.54, 1.38, z)
    rx, ry = rx + wave, ry + wave
    e = np.sqrt((x / rx) ** 2 + ((y - back) / ry) ** 2)
    d = (e - 1.0) * ry
    t = 0.034 - 0.018 * ss(1.45, 1.15, z)
    d = np.abs(d + t * 0.35) - t / 2
    d = d + lock_grooves(th, 8.0, 0.004, 1.3) * ss(1.58, 1.45, z)
    # round the back of her, from behind her left ear to past her right
    a = np.degrees(th)
    a = np.where(a < -90, a + 360, a)
    side = np.maximum(16 + 10 * s - a, a - (174 - 24 * s)) * 0.0022
    # ragged ends, a point to each lock
    u = a / 8.0 + 0.35 * np.sin(th * 3.0 + 1.3)
    hem = 1.15 + 0.035 * np.sin(th * 7.0 + 0.4) + 0.02 * np.sin(th * 13.0) - 0.04 * tri(u + 0.5) ** 1.5
    return np.maximum(np.maximum(d, side), np.maximum(hem - z, z - 1.6))


def sweep(pts, radii, base_f):
    """A lock lying on the head: a tube flattened onto the hair's surface."""
    lock = tube([on(base_f, HAIR_C + (V(p) - HAIR_C) * 1.6, HAIR_C - V(p), lift=-r * 0.45) for p, r in zip(pts, radii)], radii)
    # squashed onto the head: everything below the cap's surface is cut away, the top stays round
    return intersect(lock, lambda P: -cap_outer(P, False) - 0.002, k=0.008)


BRAID = [V(p) for p in ((-0.075, 0.035, 1.54), (-0.098, 0.0, 1.47), (-0.11, -0.04, 1.41), (-0.112, -0.09, 1.355), (-0.108, -0.118, 1.3),
                        (-0.104, -0.128, 1.24), (-0.1, -0.13, 1.18), (-0.097, -0.128, 1.13))]


def braid_field():
    """A loose braid of three strands brought forward over her right shoulder."""
    seg = []
    for a, b in zip(BRAID, BRAID[1:]):
        for k in range(6):
            seg.append(a + (b - a) * k / 6)
    seg.append(BRAID[-1])
    lobes = []
    n = len(seg)
    for i in range(1, n - 1, 2):
        p, d = seg[i], seg[i + 1] - seg[i - 1]
        d /= np.linalg.norm(d)
        side = np.cross(d, V((0, 0, 1)))
        side /= np.linalg.norm(side)
        sg = 1 if (i // 2) % 2 else -1
        w = 0.92 - 0.3 * (i / n)
        R = sdf.frame(d, side) @ sdf.rot(0, sg * 28, 0)
        lobes.append(ellipsoid(p + side * sg * 0.0055 * w, (0.0165 * w, 0.0135 * w, 0.026 * w), R))
    return union(*lobes, k=0.004)


def hair(base):
    cap = intersect(cap_outer, lambda P: hairline(P) - P[:, 2], k=0.006)
    cap = subtract(cap, lambda P: cap_outer(P, False) + 0.014, k=0.003)
    # the parting
    cap = subtract(cap, tube([on(cap_outer, PARTING + V((0, 0, 0.05)), (0, 0, -1)), on(cap_outer, V((0.02, 0.06, 1.77)), (0, 0, -1))], [0.0014, 0.0008]), k=0.002)
    f = cap_outer
    sweeps = [
        sweep([(0.026, -0.04, 1.712), (0.0, -0.075, 1.69), (-0.035, -0.088, 1.668), (-0.064, -0.08, 1.64), (-0.083, -0.06, 1.61), (-0.092, -0.035, 1.575)],
              [0.006, 0.012, 0.0145, 0.0135, 0.011, 0.008], f),
        sweep([(0.028, -0.03, 1.716), (-0.005, -0.068, 1.7), (-0.04, -0.08, 1.678), (-0.07, -0.07, 1.648), (-0.088, -0.045, 1.612)],
              [0.005, 0.009, 0.011, 0.009, 0.006], f),
        sweep([(0.03, -0.045, 1.71), (0.05, -0.068, 1.69), (0.068, -0.066, 1.66), (0.08, -0.045, 1.632), (0.084, -0.015, 1.618)],
              [0.005, 0.009, 0.0095, 0.008, 0.005], f),
    ]
    h = union(cap, *sweeps, k=0.004)
    h = union(h, curtain, k=0.02)
    h = union(h, braid_field(), k=0.012)
    end, d = BRAID[-1], (BRAID[-1] - BRAID[-2]) / np.linalg.norm(BRAID[-1] - BRAID[-2])
    tuft = union(cone(end + d * 0.004, end + d * 0.03 + V((0.004, -0.004, 0)), 0.011, 0.013),
                 cone(end + d * 0.03 + V((0.004, -0.004, 0)), end + d * 0.058 + V((0.006, -0.002, 0)), 0.013, 0.003), k=0.004)
    h = union(h, tuft, k=0.004)
    part('hair', h, (-0.2, -0.17, 1.04), (0.2, 0.25, 1.77), 0.0016, 'hair', 'hair', 22000)
    # a teal ribbon tied round the end of the braid
    R = sdf.frame(d)
    rib = torus(end + d * 0.004, 0.012, 0.0032, R)
    for s in (1, -1):
        a = end + V((0, -0.012, 0))
        b = end + V((s * 0.016, -0.017, -0.026))
        c = end + V((s * 0.02, -0.015, -0.048))
        for p0, p1 in ((a, b), (b, c)):
            al = p1 - p0
            rib = union(rib, box((p0 + p1) / 2, (0.0055, 0.0012, np.linalg.norm(al) / 2 + 0.002), 0.001, sdf.frame(al, (1, 0, 0))), k=0.002)
    part('ribbon', rib, end - 0.07, end + 0.07, 0.0005, 'ribbon', 'braid', 900)


# --- dress and apron -----------------------------------------------------------------------------

DRESS = [(0.222, 0.3), (0.215, 0.36), (0.206, 0.45), (0.19, 0.6), (0.178, 0.75), (0.17, 0.86), (0.163, 0.93), (0.145, 1.0),
         (0.123, 1.062), (0.127, 1.12), (0.141, 1.19), (0.15, 1.24), (0.149, 1.29), (0.14, 1.33), (0.125, 1.362), (0.1, 1.388),
         (0.066, 1.408)]
DEPTH = 0.74
HEM = 0.362


def bust(th, z):
    return 1.0 + 0.075 * np.exp(-((z - 1.236) / 0.05) ** 2) * np.maximum(0.0, -np.sin(th)) ** 2


def folds(th, z):
    amp = 0.055 * ss(1.02, 0.45, z) * (0.6 + 0.4 * (1 + np.sin(th)) / 2)
    return bust(th, z) * (1 + amp * np.sin(7 * th + 0.5) + 0.25 * amp * np.sin(13 * th + 1.7))


def dress_body(fold=True):
    return sdf.revolve(DRESS, depth=DEPTH, rmod=folds if fold else bust)


def neckline(P):
    """A soft V at the front, plain round at the back."""
    th = np.arctan2(P[:, 1] / DEPTH, P[:, 0])
    f = np.abs(np.degrees(np.arctan2(np.sin(th + np.pi / 2), np.cos(th + np.pi / 2))))
    return 1.315 + 0.085 * ss(0, 52, f)


SH = {1: V((0.165, 0.0, 1.36))}
_d = V((0.12, 0.0, -0.155))
EL = {1: SH[1] + _d / np.linalg.norm(_d) * 0.29}
_d = V((0.1, -0.01, -0.15))
WR = {1: EL[1] + _d / np.linalg.norm(_d) * 0.25}
for _x in (SH, EL, WR):
    _x[-1] = _x[1] * V((-1, 1, 1))


def sleeve(s):
    """Sleeves pushed up just past the elbow."""
    sh, el, wr = SH[s], EL[s], WR[s]
    d0 = (el - sh) / np.linalg.norm(el - sh)
    d = (wr - el) / np.linalg.norm(wr - el)
    cuff = el + d * 0.06
    sl = tube([sh - d0 * 0.04 + V((-s * 0.016, 0, -0.012)), sh, (sh + el) / 2, el, cuff], [0.042, 0.046, 0.041, 0.039, 0.044])
    # pushed-up cloth bunching at the elbow
    sl = union(sl, ellipsoid(el + d * 0.02 + V((0, -0.026, 0)), (0.028, 0.014, 0.018), sdf.frame(d)), k=0.01)
    return subtract(sl, cylinder(cuff + d * 0.02, 0.031, 0.028, 0.0, sdf.frame(d)), k=0.004)


def dress():
    body = dress_body()
    hem = lambda P: (HEM - 0.008 * np.sin(7 * np.arctan2(P[:, 1], P[:, 0]) + 0.5)) - P[:, 2]  # noqa: E731
    c = intersect(shell(offset(body, -0.004), 0.008), hem, lambda P: P[:, 2] - neckline(P), k=0.003)
    c = union(c, sleeve(1), sleeve(-1), k=0.02)
    part('dress', c, (-0.44, -0.21, 0.33), (0.44, 0.21, 1.44), 0.0026, 'dress', 'dress', 14000)
    # binding round the neckline; gathered cuffs where the sleeves are pushed up
    bind = intersect(shell(offset(body, 0.0012), 0.005), lambda P: np.abs(P[:, 2] - neckline(P) + 0.004) - 0.0055, k=0.0015)
    part('binding', bind, (-0.16, -0.14, 1.27), (0.16, 0.14, 1.43), 0.0009, 'dress_dark', 'dress', 1200)
    for s, side in ((1, 'L'), (-1, 'R')):
        d = (WR[s] - EL[s]) / np.linalg.norm(WR[s] - EL[s])
        cuff = EL[s] + d * 0.06
        gather = sdf.displace(torus(cuff, 0.041, 0.0085, sdf.frame(d)),
                              lambda P, c=cuff: 0.0018 * np.sin(np.arctan2(*(P - c)[:, :2].T[::-1]) * 9))
        part(f'gather_{side}', gather, cuff - 0.07, cuff + 0.07, 0.0009, 'dress_dark', f'sleeve_{side}', 900)
    return body


def apron_surface():
    """The canvas hangs off her skirt, a little away from it towards the hem."""
    plain = dress_body(fold=False)
    return lambda P: plain(P) - (0.009 + 0.012 * ss(1.0, 0.6, P[:, 2]))


def apron_angle(P):
    th = np.arctan2(P[:, 1] / DEPTH, P[:, 0])
    return np.degrees(np.arctan2(np.sin(th + np.pi / 2), np.cos(th + np.pi / 2)))


def apron():
    """A painter's canvas apron: bib and skirt, the neck strap and waist ties, a bow at the back, a
    pocket full of brushes. The paint on it is in tint()."""
    surf = apron_surface()

    def region(P):
        z = P[:, 2]
        half = 64 - 35 * ss(1.03, 1.1, z)
        side = (np.abs(apron_angle(P)) - half) * 0.0028
        bottom = (0.56 + 0.004 * np.sin(apron_angle(P) * 0.15)) - z
        return np.maximum(side, np.maximum(bottom, z - 1.262))
    ap = intersect(shell(surf, 0.004), region, k=0.004)
    part('apron', ap, (-0.25, -0.22, 0.54), (0.25, 0.0, 1.28), 0.0016, 'apron', 'dress', 9000)
    plain = dress_body(fold=False)
    # waist ties all the way round, and the bow at the back
    # (over the apron at the front, snug on the dress behind)
    tie = intersect(lambda P: np.abs(plain(P) - 0.004 - 0.008 * ss(52, 42, np.abs(apron_angle(P)))) - 0.002,
                    lambda P: np.abs(P[:, 2] - 1.064) - 0.0075, k=0.002)
    B = V((0, 0.123 * DEPTH + 0.021, 1.064))
    bow = [ellipsoid(B, (0.011, 0.008, 0.012))]
    for s in (1, -1):
        loop = torus(B + V((s * 0.024, 0.003, 0.002)), 0.017, 0.0052, sdf.frame((0, 1, 0)))
        bow.append(intersect(loop, lambda P: np.abs(P[:, 1] - B[1] - 0.003) - 0.0045, k=0.002))
        for p0, p1 in ((B, B + V((s * 0.02, 0.012, -0.06))), (B + V((s * 0.02, 0.012, -0.06)), B + V((s * 0.03, 0.016, -0.12)))):
            al = p1 - p0
            bow.append(box((p0 + p1) / 2, (0.0075, 0.0018, np.linalg.norm(al) / 2 + 0.004), 0.0014, sdf.frame(al, (1, 0, 0))))
    tie = union(tie, union(*bow, k=0.003), k=0.004)
    part('ties', tie, (-0.2, -0.2, 0.92), (0.2, 0.2, 1.09), 0.0012, 'apron', 'dress', 2600)
    # neck strap from the corners of the bib, round the back of her neck
    pts = [V(p) for p in ((0.062, -0.1, 1.262), (0.064, -0.05, 1.36), (0.05, 0.03, 1.405), (0.0, 0.054, 1.413), (-0.05, 0.03, 1.405),
                          (-0.064, -0.05, 1.36), (-0.062, -0.1, 1.262))]
    segs = []
    for p0, p1 in zip(pts, pts[1:]):
        al = p1 - p0
        mid = (p0 + p1) / 2
        radial = mid * V((1, 1, 0))
        segs.append(box(mid, (0.0016, 0.0072, np.linalg.norm(al) / 2 + 0.004), 0.0012, sdf.frame(al, radial)))
    part('strap', union(*segs, k=0.004), (-0.1, -0.13, 1.24), (0.1, 0.08, 1.43), 0.0009, 'apron', 'neck', 1200)
    # the pocket, stuffed with brushes
    p = on(surf, (math.cos(math.radians(-76)) * 0.4, math.sin(math.radians(-76)) * 0.4, 0.86), (-math.cos(math.radians(-76)), -math.sin(math.radians(-76)), 0))
    R = figure.frame_on(surf, p)
    pocket = intersect(offset(surf, 0.009), box(p, (0.075, 0.03, 0.05), 0.011, R), k=0.004)
    part('pocket', pocket, p - 0.1, p + 0.1, 0.0012, 'apron_dark', 'dress', 1600)
    n = -R[:, 1]
    for k, (dx, h, tipcol) in enumerate(((-0.03, 0.15, 'brush_b'), (0.0, 0.17, 'brush_g'), (0.028, 0.12, 'bristle'))):
        b0 = p + R[:, 0] * dx + n * 0.004 + V((0, 0, 0.02))
        b1 = b0 + V((dx * 0.3, 0, h)) - n * 0.004
        f1 = b1 + V((0, 0, 0.012))
        lo, hi = np.minimum(b0, f1) - 0.04, np.maximum(b0, f1) + 0.04
        part(f'brush{k}', cone(b0, b1, 0.0046, 0.0033), lo, hi, 0.0006, 'wood', 'dress', 300)
        part(f'ferrule{k}', cylinder((b1 + f1) / 2, 0.0041, 0.006, 0.0008, sdf.frame(f1 - b1)), lo, hi, 0.0005, 'gold', 'dress', 200)
        part(f'bristles{k}', cone(f1, f1 + V((0, 0, 0.02)), 0.0042, 0.0007), lo, hi, 0.0005, tipcol, 'dress', 200)


# --- limbs ---------------------------------------------------------------------------------------

HAND = figure.HandSpec(at=0.04, palm=(0.0115, 0.0235, 0.029), palm_round=0.0105, wrist=(0.0195, 0.0205), base=0.024,
                       spread=0.0132, lengths=(0.03, 0.021, 0.017), finger_r=(0.0057, 0.0051), curl=(4, 14, 12),
                       thumb=(0.024, 0.02), thumb_r=(0.0084, 0.0071, 0.0061), blend=(0.001, 0.006, 0.007))


def arms():
    for s, side in ((1, 'L'), (-1, 'R')):
        el, wr = EL[s], WR[s]
        d = (wr - el) / np.linalg.norm(wr - el)
        forearm = tube([el + d * 0.035, el + (wr - el) * 0.5, wr], [0.03, 0.026, 0.021])
        figure.hand(FIG, s, side, el, wr, HAND, 'skin', 3600, step=0.0009, extra=forearm, back=0.22, kind=f'arm_{side}')
        if s == 1:
            c = wr - d * 0.006
            part('bangle', torus(c, 0.0245, 0.0028, sdf.frame(d)), c - 0.04, c + 0.04, 0.0005, 'gold', 'arm_L', 600)


def legs():
    for s, side in ((1, 'L'), (-1, 'R')):
        x = s * 0.088
        leg = tube([(s * 0.082, 0, 0.92), (s * 0.086, -0.004, 0.7), (x, -0.006, 0.49), (x, 0.006, 0.36), (x, 0.004, 0.13), (x, -0.004, 0.06)],
                   [0.072, 0.058, 0.044, 0.047, 0.028, 0.029])
        leg = union(leg, ellipsoid((x, -0.045, 0.04), (0.03, 0.075, 0.024)), k=0.02)
        part(f'leg_{side}', leg, (x - 0.09, -0.14, 0.0), (x + 0.09, 0.09, 0.96), 0.0024, 'tights', f'leg_{side}', 2200)
        # Mary Jane shoes: a rounded toe, a low heel, a strap over the instep
        foot = union(ellipsoid((x, -0.066, 0.03), (0.036, 0.088, 0.03)), ellipsoid((x, 0.016, 0.034), (0.032, 0.04, 0.034)), k=0.025)
        shoe = subtract(foot, ellipsoid((x, -0.008, 0.074), (0.03, 0.068, 0.038)), k=0.004)
        shoe = intersect(shoe, lambda P: 0.012 - P[:, 2], k=0.002)
        strap = intersect(shell(offset(foot, 0.0012), 0.0035), lambda P: np.abs(P[:, 1] + 0.03) - 0.0055, lambda P: 0.03 - P[:, 2], k=0.001)
        shoe = union(shoe, strap, k=0.002)
        shoe = union(shoe, sdf.sphere((x + s * 0.034, -0.03, 0.045), 0.0035), k=0.001)
        part(f'shoe_{side}', shoe, (x - 0.06, -0.17, 0.0), (x + 0.06, 0.07, 0.09), 0.0011, 'shoe', f'shoe_{side}', 2600)
        prof = union(ellipsoid((x, -0.068, 0.0), (0.039, 0.092, 1.0)), ellipsoid((x, 0.016, 0.0), (0.035, 0.043, 1.0)), k=0.02)
        sole = union(intersect(prof, lambda P: np.abs(P[:, 2] - 0.007) - 0.007, k=0.002),
                     intersect(prof, box((x, 0.03, 0.012), (0.04, 0.03, 0.012), 0.003), k=0.002), k=0.002)
        part(f'sole_{side}', sole, (x - 0.06, -0.17, -0.01), (x + 0.06, 0.07, 0.04), 0.001, 'sole', f'shoe_{side}', 900)


# --- paint ---------------------------------------------------------------------------------------

PAINT = [((0.052, 0.98), 0.03, (0.48, 0.7, 0.38)), ((-0.072, 0.72), 0.022, (0.48, 0.7, 0.38)), ((-0.04, 1.18), 0.018, (0.3, 0.48, 0.66)),
         ((0.082, 0.66), 0.026, (0.3, 0.48, 0.66)), ((0.0, 0.79), 0.022, (1.0, 0.8, 0.36)), ((-0.088, 0.95), 0.016, (1.0, 0.8, 0.36)),
         ((0.03, 1.12), 0.012, (1.0, 0.8, 0.36)), ((-0.02, 0.6), 0.014, (0.48, 0.7, 0.38))]


def tint(p, kind, mname):
    one = (1.0, 1.0, 1.0)
    if mname == 'mum_skin':
        c = one
        for s in (1, -1):
            d = (p - Vector((s * 0.046, -0.07, 1.558))).length
            b = math.exp(-(d / 0.02) ** 2) * 0.6
            c = (c[0], c[1] * (1 - 0.14 * b), c[2] * (1 - 0.17 * b))
        k = 0.92 + 0.08 * smooth01(1.36, 1.44, p.z)
        c = (c[0] * k, c[1] * k, c[2] * k)
        if 1.54 < p.z < 1.6 and p.y < -0.04:
            f = 0.0
            for q, r, a in FRECKLES:
                f = max(f, a * math.exp(-((p - q).length / r) ** 2))
            c = (c[0] * (1 - 0.28 * f), c[1] * (1 - 0.5 * f), c[2] * (1 - 0.62 * f))
        return c
    if mname == 'mum_iris':
        return figure.iris_shade(p, IRIS_C['L' if p.x > 0 else 'R'], IRIS, PUPIL)
    if mname == 'mum_hair':
        # darker at the roots and underneath, each lock its own shade, light catching on the waves
        q = p - Vector(tuple(HAIR_C))
        th = np.array([math.atan2(q.y, q.x)])
        grooves = float(lock_grooves(th, 8.0, 1.0, 1.3)[0])
        k = (0.8 + 0.2 * smooth01(1.2, 1.66, p.z)) * (1 - 0.25 * grooves)
        k *= 1.0 + 0.06 * noise.noise(Vector((p.x * 60, p.y * 60, p.z * 12)))
        sheen = math.exp(-((p.z - 1.69) / 0.02) ** 2) * (1 - grooves)
        return (k + 0.2 * sheen, k * 0.98 + 0.18 * sheen, k * 0.95 + 0.15 * sheen)
    if mname == 'mum_dress':
        k = 0.9 + 0.1 * smooth01(0.38, 0.8, p.z)
        return (k, k, k)
    if mname == 'mum_apron':
        # splashes of the book's three colours, and a scatter of flecks
        for (x, z), r, col in PAINT:
            q = math.hypot(p.x - x, p.z - z) + noise.noise(Vector((p.x * 80, p.z * 80, 1.0))) * r * 0.6
            if q < r:
                return col
        n = noise.noise(Vector((p.x * 140, p.y * 140, p.z * 140)))
        if n > 0.62 and p.y < 0:
            return (0.48, 0.7, 0.38) if p.x > 0.02 else (0.3, 0.48, 0.66) if p.x < -0.02 else (1.0, 0.8, 0.36)
        k = 0.95 + 0.05 * smooth01(0.56, 0.9, p.z)
        return (k, k, k * 0.98)
    return one


# --- rig -----------------------------------------------------------------------------------------

def bones():
    B = [('hips', (0, 0, 0.9), (0, 0, 1.02), None),
         ('spine', (0, 0, 1.02), (0, 0, 1.18), 'hips'),
         ('chest', (0, 0, 1.18), (0, 0, 1.37), 'spine'),
         ('neck', (0, 0, 1.37), (0, 0, 1.47), 'chest'),
         ('head', (0, 0, 1.47), (0, 0, 1.72), 'neck'),
         # opens her lips from the line between them
         ('mouth', (0, -0.09, MOUTH_Z), (0, -0.09, MOUTH_Z + 0.018), 'head'),
         # the braid swings on what are Ada's scarf bones
         ('scarf1', tuple(BRAID[2]), tuple(BRAID[5]), 'chest'),
         ('scarf2', tuple(BRAID[5]), tuple(BRAID[7] + V((0, 0, -0.05))), 'scarf1'),
         ('bag', (-0.17, 0, 0.98), (-0.19, 0, 0.9), 'hips')]
    # expression bones: the brows and the corners of the mouth
    for side in ('L', 'R'):
        for k in (f'brow_{side}', f'mouth_{side}'):
            c = FACE_PTS[k]
            B.append((k, (c[0], c[1], c[2]), (c[0], c[1], c[2] + 0.015), 'head'))
    for s, side in ((1, 'L'), (-1, 'R')):
        d = (WR[s] - EL[s]) / np.linalg.norm(WR[s] - EL[s])
        B += [(f'eye_{side}', (s * 0.033, -0.08, 1.5905), (s * 0.033, -0.08, 1.612), 'head'),
              (f'shoulder_{side}', (s * 0.04, 0, 1.335), tuple(SH[s]), 'chest'),
              (f'upperarm_{side}', tuple(SH[s]), tuple(EL[s]), f'shoulder_{side}'),
              (f'forearm_{side}', tuple(EL[s]), tuple(WR[s]), f'upperarm_{side}'),
              (f'hand_{side}', tuple(WR[s]), tuple(WR[s] + d * 0.11), f'forearm_{side}'),
              (f'thigh_{side}', (s * 0.085, 0, 0.9), (s * 0.088, -0.006, 0.49), 'hips'),
              (f'shin_{side}', (s * 0.088, -0.006, 0.49), (s * 0.088, 0.005, 0.085), f'thigh_{side}'),
              (f'foot_{side}', (s * 0.088, 0.005, 0.085), (s * 0.088, -0.13, 0.03), f'shin_{side}')]
    return B


def dress_weights(p):
    x, y, z = p
    if z <= 0.96:
        w = {'hips': 1.0}
    elif z <= 1.12:
        t = (z - 0.96) / 0.16
        w = {'hips': 1 - t, 'spine': t}
    elif z <= 1.28:
        t = (z - 1.12) / 0.16
        w = {'spine': 1 - t, 'chest': t}
    else:
        w = {'chest': 1.0}
    extra = {'neck': smooth01(1.37, 1.4, z)}
    for s, side in ((1, 'L'), (-1, 'R')):
        extra['shoulder_' + side] = 0.7 * smooth01(0.09, 0.15, s * x) * smooth01(1.27, 1.35, z)
        # the skirt follows her legs: the thighs above the knee, a little of the shins below it
        front = smooth01(0.04, -0.14, y)
        sidew = smooth01(-0.06, 0.06, s * x)
        extra['thigh_' + side] = (0.5 + 0.48 * front) * smooth01(0.98, 0.7, z) * sidew * (1 - 0.5 * smooth01(0.5, 0.4, z))
        extra['shin_' + side] = 0.35 * front * smooth01(0.5, 0.4, z) * sidew
    k = max(0.0, 1.0 - sum(extra.values()))
    w = {b: v * k for b, v in w.items()}
    w.update(extra)
    return w


def head_weights(p):
    x, y, z = p
    r = math.hypot(x, y - 0.012)
    hw = max(smooth01(1.47, 1.53, z), smooth01(0.05, 0.068, r) * smooth01(1.45, 1.5, z))
    cw = smooth01(1.42, 1.35, z) * (1 - hw)
    return {'head': hw, 'chest': cw, 'neck': max(0.0, 1 - hw - cw)}


def face_weights(p):
    w = head_weights(p)
    # the skin round the mouth corners and under the brows goes with them (cheeks lift in a smile)
    front = smooth01(-0.05, -0.075, p.y)
    extra = {}
    for side in ('L', 'R'):
        extra[f'mouth_{side}'] = 0.6 * front * smooth01(0.014, 0.003, (p - FACE_PTS[f'mouth_{side}']).length)
        extra[f'brow_{side}'] = 0.35 * front * smooth01(0.016, 0.004, (p - FACE_PTS[f'brow_{side}']).length)
    k = max(0.0, 1.0 - sum(extra.values()))
    w = {b: v * k for b, v in w.items()}
    w.update(extra)
    return w


def corners(width):
    # the corners on their own bones, fading into the middle (which opens when she talks)
    def f(p):
        wl, wr = smooth01(0.002, width, p.x), smooth01(0.002, width, -p.x)
        return {'mouth_L': wl, 'mouth_R': wr, 'mouth': max(0.0, 1.0 - wl - wr)}
    return f


def hair_weights(p):
    # the long hair hangs from her head but lies on her back: blend down from head to chest
    t = smooth01(1.52, 1.34, p.z) * smooth01(-0.02, 0.04, p.y)
    return {'head': 1 - t, 'chest': t}


def weight_fn(kind, segs):
    def seg(*names, mult=None, power=5.0):
        sub = {n: segs[n] for n in names}
        return lambda p: lib.dist_weights(p, sub, mult, power)
    if kind == 'head':
        return head_weights
    if kind == 'face':
        return face_weights
    if kind in ('eye_L', 'eye_R', 'mouth', 'brow_L', 'brow_R'):
        return lambda p: {kind: 1.0}
    if kind == 'mouthline':
        return corners(0.0115)
    if kind == 'lips':
        return corners(0.0125)
    if kind == 'hair':
        braid = seg('neck', 'scarf1', 'scarf2', mult={'neck': 0.6}, power=4)

        def w(p):
            # the braid (forward of her right shoulder) swings on its own bones
            b = smooth01(-0.05, -0.08, p.x) * smooth01(-0.0, -0.04, p.y) * smooth01(1.52, 1.46, p.z)
            out = {k: v * (1 - b) for k, v in hair_weights(p).items()}
            bw = braid(p)
            sb = sum(bw.values())
            for k2, v in bw.items():
                out[k2] = out.get(k2, 0.0) + b * v / sb
            return out
        return w
    if kind == 'braid':
        return seg('neck', 'scarf1', 'scarf2', mult={'neck': 0.6}, power=4)
    if kind == 'neck':
        return seg('chest', 'neck', mult={'neck': 0.7})
    if kind == 'dress':
        return figure.sleeve_weights(dress_weights, segs, near=0.05, far=0.075)
    side = kind[-1]
    if kind.startswith('sleeve'):
        return seg(f'upperarm_{side}', f'forearm_{side}', power=6)
    if kind.startswith('arm'):
        return seg(f'forearm_{side}', f'hand_{side}', mult={f'hand_{side}': 1.4}, power=8)
    if kind.startswith('leg'):
        return seg('hips', f'thigh_{side}', f'shin_{side}', f'foot_{side}', mult={'hips': 0.5, f'foot_{side}': 0.6}, power=6)
    if kind.startswith('shoe'):
        return seg(f'shin_{side}', f'foot_{side}', power=6)
    raise ValueError(kind)


# --- her own clips -------------------------------------------------------------------------------

def arms_down(lean=0.0):
    return {'upperarm_L': {'rx': 2.0 + lean, 'ry': 12.0}, 'forearm_L': {'rx': -16.0, 'ry': 4.0}, 'hand_L': {'rx': -6.0}}


def author_own(arm):
    import ada_anims
    T = T_SCALE
    p = lib.Poser(arm)
    # (her standing and talking replace Ada's, which are a twelve-year-old's)
    ad = arm.animation_data
    for name in ('idle', 'talk'):
        for tr in list(ad.nla_tracks):
            if tr.name == name:
                ad.nla_tracks.remove(tr)
        if name in bpy.data.actions:
            bpy.data.actions.remove(bpy.data.actions[name])

    legs_rest = {'thigh_L': {'ry': -2.0, 'rx': [(0, 3.0), (36, 4.0)]}, 'shin_L': {'rx': [(0, 7.0), (36, 8.0)]}, 'thigh_R': {'ry': 1.5},
                 'foot_L': {'ax': 0.0}, 'foot_R': {'ax': 0.0}}
    # idle: weight on her right leg, slow breathing, head gently tilted, the braid stirring
    ada_anims.clip(p, 'idle', 96, ada_anims.merge(arms_down(), legs_rest, {
        'hips': {'tz': [(0, -0.004), (48, -0.008)], 'tx': [(0, -0.008), (48, -0.004)], 'rz': -2.5, 'ry': [(0, -1.5), (48, 1.0)]},
        'spine': {'rx': [(0, 1.0), (48, 2.0)], 'rz': 1.5},
        'chest': {'rx': [(0, 0.0), (48, -1.5)], 'rz': 1.0},
        'neck': {'rx': 2.0},
        'head': {'rx': [(0, 2.0), (50, 0.5)], 'rz': [(0, -5.0), (48, -3.0)], 'ry': [(0, 2.0), (60, -2.0)]},
        'upperarm_L': {'rx': [(0, 2.0), (48, 0.5)], 'ry': [(0, 12.0), (48, 11.0)]},
        'scarf1': {'rx': [(0, 0.0), (48, -2.0)]}, 'scarf2': {'rx': [(10, 0.0), (58, -3.0)]},
    }), sym=0)
    # talk: the same stance, her right hand lifting as she speaks, little nods
    ada_anims.clip(p, 'talk', 60, ada_anims.merge(arms_down(), legs_rest, {
        'hips': {'tz': -0.006, 'rz': -2.0, 'ry': [(0, -1.0), (30, 1.0)]},
        'spine': {'rx': 2.0, 'rz': 1.5},
        'chest': {'rx': [(0, 0.0), (30, -1.0)]},
        'head': {'rx': [(0, 1.0), (8, 4.0), (18, 0.0), (32, 3.0), (46, 0.5)], 'rz': [(0, -4.0), (30, -2.0)], 'ry': [(0, 2.0), (36, -2.0)]},
        'upperarm_R': {'rx': [(0, -10.0), (20, -18.0), (40, -12.0)], 'ry': -14.0},
        'forearm_R': {'rx': [(0, -48.0), (12, -62.0), (26, -45.0), (42, -58.0)], 'ry': [(0, -20.0), (20, -35.0), (40, -22.0)]},
        'hand_R': {'rx': [(0, -10.0), (14, 8.0), (30, -6.0)], 'rz': [(0, 10.0), (24, -6.0)]},
        'scarf1': {'rx': [(0, 0.0), (30, -2.0)]},
    }), sym=None)
    # kneel_hug: down on one knee to Ada's height, arms round her, cheek against her hair
    ada_anims.clip(p, 'kneel_hug', 72, {
        'hips': {'tz': -0.3 * T, 'ty': 0.06 * T, 'rx': 2.0},
        'spine': {'rx': [(0, 6.0), (36, 8.0)]},
        'chest': {'rx': [(0, 4.0), (36, 6.0)]},
        'neck': {'rx': 8.0},
        'head': {'rx': [(0, 14.0), (36, 16.0)], 'rz': 20.0, 'ry': 8.0},
        'thigh_L': {'ax': -84.0}, 'shin_L': {'ax': -4.0}, 'foot_L': {'ax': 0.0},
        'thigh_R': {'ax': 4.0}, 'shin_R': {'ax': 92.0}, 'foot_R': {'ax': 60.0},
        'upperarm_L': {'rx': [(0, -78.0), (36, -76.0)], 'ry': 10.0, 'rz': -46.0},
        'forearm_L': {'rx': -10.0, 'ry': 6.0, 'rz': -88.0},
        'hand_L': {'rx': 10.0},
        'upperarm_R': {'rx': [(0, -70.0), (36, -68.0)], 'ry': -10.0, 'rz': 50.0},
        'forearm_R': {'rx': -8.0, 'ry': -6.0, 'rz': 86.0},
        'hand_R': {'rx': 12.0},
        'scarf1': {'rx': 10.0}, 'scarf2': {'rx': 6.0},
    }, sym=None)
    # kneel_hold: kneeling, holding Ada's hands and looking at her (the goodbye)
    ada_anims.clip(p, 'kneel_hold', 72, {
        'hips': {'tz': -0.3 * T, 'ty': 0.06 * T, 'rx': 4.0},
        'spine': {'rx': [(0, 4.0), (36, 6.0)]},
        'chest': {'rx': 2.0},
        'neck': {'rx': 2.0},
        'head': {'rx': [(0, -2.0), (36, 2.0)], 'rz': [(0, 6.0), (40, 3.0)], 'ry': 6.0},
        'thigh_L': {'ax': -84.0}, 'shin_L': {'ax': -4.0}, 'foot_L': {'ax': 0.0},
        'thigh_R': {'ax': 4.0}, 'shin_R': {'ax': 92.0}, 'foot_R': {'ax': 60.0},
        'upperarm_L': {'rx': -38.0, 'ry': 4.0, 'rz': -8.0}, 'forearm_L': {'rx': -30.0, 'rz': -20.0}, 'hand_L': {'rx': -10.0},
        'upperarm_R': {'rx': -38.0, 'ry': -4.0, 'rz': 8.0}, 'forearm_R': {'rx': -30.0, 'rz': 20.0}, 'hand_R': {'rx': -10.0},
        'scarf1': {'rx': 4.0},
    }, sym=None)


def build():
    lib.reset()
    PARTS.clear()
    bpy.context.scene.render.fps = 30
    base = head()
    hair(base)
    dress()
    apron()
    arms()
    legs()
    eyes = ('mum_eye_white', 'mum_iris', 'mum_eye_hi', 'mum_lash')
    ao = sdf.bake_ao([o for o in PARTS if o.data.materials[0].name not in eyes], distance=0.06, samples=64)
    figure.paint(PARTS, tint, ao, no_ao=eyes)
    arm = lib.armature('mum_rig', bones())
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    for ob in PARTS:
        lib.set_weights(ob, weight_fn(ob['kind'], segs))
    body = lib.join(PARTS, 'mum')
    lib.bind(body, arm)
    print('mum:', sum(len(p.vertices) - 2 for p in body.data.polygons), 'tris')
    return arm, [body]


VIEW = {'front': (-20, 3.1, (0, 0, 0.86)), 'back': (160, 3.1, (0, 0, 0.86)), 'side': (-90, 3.1, (0, 0, 0.86)),
        'face': (0, 0.5, (0, 0, 1.58)), 'face3q': (-35, 0.5, (0, 0, 1.58)), 'faceside': (-80, 0.55, (0, 0, 1.58)),
        'bust': (-25, 1.2, (0, 0, 1.3)), 'hands': (-60, 0.8, (0.2, 0, 1.0)), 'feet': (-30, 0.8, (0, 0, 0.15)),
        'backc': (165, 1.4, (0, 0, 1.25))}


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    arm, meshes = build()
    import ada_anims  # noqa: E402
    ada_anims.T_SCALE = T_SCALE
    ada_anims.author(arm)
    author_own(arm)
    if '--preview' in argv:
        out = argv[argv.index('--preview') + 1]
        figure.rest_pose(arm)
        for name in os.environ.get('VIEWS', 'front,back,side,face,face3q').split(','):
            yaw, dist, tgt = VIEW[name]
            lib.preview(out.replace('.png', f'_{name}.png'), target=tgt, dist=dist, yaw=yaw, pitch=4, size=(700, 900), lens=55)
    if '--poses' in argv:
        shots = [(n, int(f)) for n, f in (s.split(':') for s in os.environ.get('SHOTS', 'idle:0,idle:48,talk:12,walk:7,kneel_hug:10,kneel_hold:10').split(','))]
        d = os.path.splitext(argv[argv.index('--poses') + 1])[0]
        os.makedirs(d, exist_ok=True)
        ad = arm.animation_data
        for i, (name, f) in enumerate(shots):
            act = bpy.data.actions[name]
            ad.action = act
            if hasattr(ad, 'action_slot') and act.slots:
                ad.action_slot = act.slots[0]
            bpy.context.scene.frame_set(f)
            yaw = float(os.environ.get('YAW', '-40'))
            lib.preview(os.path.join(d, f'{i:02d}_{name}_{f}.png'), target=(0, 0, 0.82), dist=3.2, yaw=yaw, pitch=8, size=(360, 480), lens=50, samples=10)
        ad.action = None
    if '--export' in argv:
        figure.rest_pose(arm)
        # she only ever stands, talks, walks a little and kneels: leave Ada's other clips out
        keep = {'idle', 'talk', 'walk', 'kneel_hug', 'kneel_hold', 'blink', 'speak'}
        ad = arm.animation_data
        for tr in list(ad.nla_tracks):
            if tr.name not in keep:
                ad.nla_tracks.remove(tr)
        for act in list(bpy.data.actions):
            if act.name not in keep:
                bpy.data.actions.remove(act)
        lib.export_glb(os.path.join(lib.MODELS, 'mum.glb'), [arm] + meshes)
