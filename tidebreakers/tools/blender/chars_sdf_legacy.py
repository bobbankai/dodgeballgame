"""Tidebreakers characters.  blender -b -P chars.py -- <name|all> [--preview DIR] [--export]

Each character is a proportion spec (Skeleton), a look (Body) and a list of sculpted layers.
"""
import os
import sys
import math
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from tb import sdf, skeleton, body as bodymod, garment as G, character as C  # noqa: E402
from tb.sdf import Ellipsoid, RoundCone, Sphere, Box, Union, Intersect, Subtract, Offset, Shell, Plane, Func, FlatTube  # noqa: E402

v = G.v
norm = G.norm
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'chars')


def lerp(a, b, t):
    return a + (b - a) * t


def solid(hexc):
    return C.srgb(hexc)


def mix_paint(base, other, mask_fn):
    """Paint: blend `other` colour where mask_fn(V, N) -> 0..1."""
    o = C.srgb(other) if isinstance(other, str) else np.asarray(other)

    def paint(V, N, col):
        m = np.clip(mask_fn(V, N), 0, 1)[:, None]
        return col * (1 - m) + o * m
    return paint


def chain_paint(*fns):
    def paint(V, N, col):
        for f in fns:
            col = f(V, N, col)
        return col
    return paint


def near_plane(z, width):
    return lambda V, N: np.clip(1 - np.abs(V[:, 2] - z) / width, 0, 1) ** 0.5 * (np.abs(V[:, 2] - z) < width)


def shade_z(lo, hi, amount):
    """Darken toward lo (hem shading / gradient)."""
    def paint(V, N, col):
        t = np.clip((V[:, 2] - lo) / max(hi - lo, 1e-6), 0, 1)
        return col * (1 - amount * (1 - t))[:, None]
    return paint


def skin_paint(body, blush=0.35):
    """Warm the knuckles, elbows, knees and cheeks a little (anime skin)."""
    fa = body.face_anchor
    u = fa['u']
    sk = body.sk
    pts = [fa['eye_L'] + v(0.006, 0.01, -0.032) * u, fa['eye_R'] + v(-0.006, 0.01, -0.032) * u]
    warm = C.srgb('#e8806e')

    def paint(V, N, col):
        m = np.zeros(len(V))
        for p in pts:
            m = np.maximum(m, np.clip(1 - np.linalg.norm(V - p, axis=1) / (0.026 * u), 0, 1) ** 1.5 * blush)
        for j in ('elbow', 'knee'):
            for s in ('L', 'R'):
                m = np.maximum(m, np.clip(1 - np.linalg.norm(V - sk.j[f'{j}.{s}'], axis=1) / 0.06, 0, 1) * 0.18)
        for s in ('L', 'R'):
            m = np.maximum(m, np.clip(1 - np.linalg.norm(V - sk.tail_of(f'hand.{s}'), axis=1) / 0.035, 0, 1) * 0.2)
        return col * (1 - m[:, None]) + warm * m[:, None]
    return paint


# ============================================================================================ Kai

def kai():
    sk = skeleton.Skeleton(height=1.70, head=0.245, shoulder=0.188)
    bd = bodymod.Body(sk, face='boy', build=0.72, limb=1.1, hand=1.1, nose=0.75)
    j = sk.j
    fa = bd.face_anchor
    u = fa['u']
    chin = fa['chin']
    torso = bd.region(['torso', 'chest', 'spine', 'hips'], 0.03)
    legs = bd.region(['thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'hips', 'torso'], 0.03)
    neck_base = j['neck'][2]
    waist = sk.s['leg'] - 0.065 + (neck_base - (sk.s['leg'] - 0.065)) * 0.37

    # -- extra bone chains (secondary motion at runtime)
    hb_z = chin + 0.178 * u
    tails = {}
    for s, sx in (('L', 1), ('R', -1)):
        k0 = v(sx * 0.014, 0.118 * u + 0.016, hb_z)
        pts = [k0, k0 + v(sx * 0.02, 0.035, -0.04), k0 + v(sx * 0.035, 0.06, -0.11), k0 + v(sx * 0.045, 0.075, -0.19), k0 + v(sx * 0.05, 0.08, -0.27)]
        if s == 'R':
            pts = [k0] + [p + v(0, -0.01, 0.03) for p in pts[1:4]]
        tails[s] = (sk.add_chain(f'band{s}', pts, 'head'), pts)
    sash_k = v(0.135, -0.03, waist - 0.005)
    sash_pts = [sash_k, sash_k + v(0.01, -0.012, -0.07), sash_k + v(0.018, -0.012, -0.15), sash_k + v(0.022, -0.008, -0.23), sash_k + v(0.024, -0.004, -0.31)]
    sash_chain = sk.add_chain('sash', sash_pts, 'hips')

    layers = []
    # -- skin
    layers.append(C.Layer('skin', bd.field(), solid('#eab48f'), cls='skin', res=0.0042, budget=9000, paint=skin_paint(bd)))

    # -- tank top (tucked in, scoop neck, armholes)
    tank = Offset(torso, 0.007)
    holes = [Sphere(j[f'shoulder.{s}'] + v(sx * 0.03, 0.0, -0.035), 0.083) for s, sx in (('L', 1), ('R', -1))]
    tank = Subtract(tank, Union(holes + [Ellipsoid(v(0, -0.075, neck_base - 0.025), v(0.075, 0.07, 0.07)),
                                         Ellipsoid(v(0, 0.06, neck_base + 0.01), v(0.065, 0.06, 0.04))]), 0.01)
    tank = Intersect([tank, G.above(waist - 0.06)])
    layers.append(C.Layer('tank', G.folds(tank, 0.0015, 55, seed=1), solid('#efe6d4'), cls='cloth', res=0.005, budget=2600, covers=True,
                          paint=G_paint_ao_band(waist - 0.06, waist + 0.25, 0.12)))

    # -- open cropped jacket: a solid layer over the tank top, so its cut edges read as thick lapels and hems
    jacket = Offset(torso, 0.0165)
    jacket = Intersect([jacket, G.above(waist + 0.045)])
    opening = Func(lambda p: np.maximum(np.abs(p[:, 0]) - (0.03 + 0.22 * np.clip(neck_base - p[:, 2], 0, 1)), p[:, 1] + 0.01),
                   v(-0.3, -0.4, 0.5), v(0.3, 0.0, 1.8))
    arms_cut = Union([Sphere(j[f'shoulder.{s}'] + v(sx * 0.055, 0.0, -0.045), 0.085) for s, sx in (('L', 1), ('R', -1))])
    jacket = Subtract(Subtract(jacket, opening, 0.004), arms_cut, 0.005)
    neckr = bd.region(['neck'], 0.02)
    collar = Shell(G.flare(neckr, 0.034, -0.022, neck_base + 0.05, neck_base - 0.035), 0.011)
    collar = Intersect([collar, G.slab((0, 0, 1), neck_base - 0.035, neck_base + 0.05), Plane(v(0, -1, 0), v(0, -0.02, 0))], 0.004)
    jacket = Union([jacket, collar], 0.01)
    jacket = G.folds(jacket, 0.002, 38, axis=(0.2, 0, 1), seed=2)
    trim = '#8d4a1f'
    layers.append(C.Layer('jacket', jacket, solid('#f2a23b'), cls='cloth', res=0.0045, budget=5200, covers=True,
                          paint=chain_paint(mix_paint(None, trim, near_plane(waist + 0.045, 0.012)),
                                            mix_paint(None, trim, lambda V, N: (np.abs(np.abs(V[:, 0]) - (0.03 + 0.22 * np.clip(neck_base - V[:, 2], 0, 1))) < 0.012) * (V[:, 1] < 0) * 1.0),
                                            shade_z(waist, neck_base, 0.12))))

    # -- loose trousers, rolled at mid-calf
    cuff_z = 0.30
    pants = G.flare(legs, 0.013, 0.03, sk.s['leg'], cuff_z)
    pants = Intersect([pants, G.below(waist + 0.01), G.above(cuff_z)])
    pants = G.folds(pants, 0.003, 30, axis=(0, 0, 1), noise=0.8, seed=3)
    cuffs = Union([Intersect([Offset(bd.region([f'shin.{s}'], 0.02), 0.045), G.slab((0, 0, 1), cuff_z - 0.035, cuff_z + 0.012)]) for s in 'LR'])
    pants = Union([pants, cuffs], 0.008)
    layers.append(C.Layer('pants', pants, solid('#2c3d6d'), cls='cloth', res=0.0055, budget=4200, covers=True,
                          paint=chain_paint(mix_paint(None, '#40568f', lambda V, N: (V[:, 2] < cuff_z + 0.014) * 1.0), shade_z(cuff_z, waist, 0.18))))

    # -- red sash with a knot on the left hip and hanging tails
    sash = Intersect([Offset(torso, 0.036), G.slab((0, 0, 1), waist - 0.032, waist + 0.032)], 0.004)
    knot = Ellipsoid(sash_k + v(0.004, -0.006, 0), v(0.032, 0.03, 0.036))
    tail_pts = np.array(sash_pts)
    tail_n = np.tile(norm(v(1, -0.6, 0)), (len(tail_pts), 1))
    s_tail = FlatTube(tail_pts + v(0.004, 0, 0), [0.026, 0.028, 0.03, 0.03, 0.026], [0.006] * 5, tail_n)
    s_tail2 = FlatTube(tail_pts[:4] + v(-0.012, 0.03, 0.01), [0.024, 0.026, 0.026, 0.022], [0.006] * 4, tail_n[:4])
    layers.append(C.Layer('sash', Union([sash, knot], 0.012), solid('#b8262e'), cls='cloth', res=0.004, budget=1400,
                          paint=shade_z(waist - 0.03, waist + 0.03, 0.15)))
    layers.append(C.Layer('sashtail', Union([s_tail, s_tail2], 0.004), solid('#b8262e'), cls='cloth', res=0.0035, budget=900,
                          weights=('chain', sash_chain), sym=False, paint=shade_z(waist - 0.32, waist, 0.25)))

    # -- forearm wraps with bronze plates and a glowing wind glyph
    for s, sx in (('L', 1), ('R', -1)):
        el, wr = j[f'elbow.{s}'], j[f'wrist.{s}']
        fa_dir = norm(wr - el)
        side_ax, along, back = sk.frames[f'hand.{s}']
        fr = bd.region([f'forearm.{s}'], 0.02)
        a = lerp(el, wr, 0.3)
        wrap = Intersect([Offset(fr, 0.006), G.slab(fa_dir, float(a @ fa_dir), float(wr @ fa_dir) + 0.012)], 0.004)
        wrap = G.wraps(wrap, a, wr + fa_dir * 0.012, 0.0022, 8)
        layers.append(C.Layer(f'wrap{s}', wrap, solid('#e6d8bb'), cls='cloth', res=0.0035, budget=1100, covers=True,
                              paint=shade_z(0.0, 2.0, 0.0)))
        pc = lerp(el, wr, 0.6) + back * 0.034
        R = np.stack([side_ax, fa_dir, back], 1)
        plate = Box(pc, v(0.024, 0.048, 0.006), R, round=0.004)
        rim = Subtract(plate, Box(pc + back * 0.005, v(0.017, 0.04, 0.004), R, round=0.002), 0.002)
        layers.append(C.Layer(f'plate{s}', rim, solid('#b97a3c'), cls='metal', res=0.0025, budget=500, weights=('rigid', f'forearm.{s}')))
        glyph = Union([Box(pc + back * 0.002 + fa_dir * dz, v(0.009, 0.009, 0.0025), R @ sdf.rot_z(math.pi / 4), round=0.002) for dz in (-0.018, 0.0, 0.018)])
        layers.append(C.Layer(f'glyph{s}', glyph, solid('#71f2ff'), cls='glow', res=0.002, budget=300, weights=('rigid', f'forearm.{s}')))

    # -- sandals
    for s, sx in (('L', 1), ('R', -1)):
        foot = bd.region([f'foot.{s}', f'toe.{s}'], 0.02)
        sole = Intersect([Offset(foot, 0.014), G.below(0.022), G.above(-0.002)], 0.004)
        an = j[f'ankle.{s}']
        ball = j[f'ball.{s}']
        strap1 = sdf.Torus(an + v(0, 0.004, 0.012), 0.036, 0.0055)
        fd = norm(ball - an)
        strap2 = Intersect([Offset(foot, 0.006), G.slab(fd, float((lerp(an, ball, 0.55)) @ fd) - 0.012, float(lerp(an, ball, 0.55) @ fd) + 0.012)])
        straps = Union([strap1, strap2, RoundCone(lerp(an, ball, 0.55) + v(0, 0, 0.02), ball + v(-sx * 0.012, -0.02, 0.012), 0.005, 0.004)], 0.004)
        layers.append(C.Layer(f'sole{s}', sole, solid('#6e4a2c'), cls='wood', res=0.004, budget=500, weights=('rigid', f'foot.{s}')))
        layers.append(C.Layer(f'strap{s}', straps, solid('#4b2e1c'), cls='leather', res=0.003, budget=700))

    # -- headband (tilted: higher at the brow) with a knot and two long tails
    hn = norm(v(0, 0.3, 1))
    c = float(v(0, -0.1, hb_z + 0.022) @ hn)
    band = Intersect([Offset(bd.head_field, 0.009 * u), G.slab(hn, c - 0.013 * u, c + 0.013 * u)], 0.003)
    knot = Ellipsoid(v(0, 0.118 * u + 0.012, hb_z), v(0.022, 0.016, 0.02))
    layers.append(C.Layer('headband', Union([band, knot], 0.008), solid('#d63a3c'), cls='cloth', res=0.0032, budget=1200, weights=('rigid', 'head')))
    for s in 'LR':
        names, pts = tails[s]
        pts = np.array(pts)
        nrm = np.tile(v(1, 0, 0) * (1 if s == 'L' else -1), (len(pts), 1))
        w = [0.016, 0.02, 0.021, 0.02, 0.016][:len(pts)]
        tail = FlatTube(pts, w, [0.004] * len(pts), nrm)
        layers.append(C.Layer(f'band{s}', tail, solid('#d63a3c'), cls='cloth', res=0.003, budget=500, weights=('chain', names), sym=False,
                              paint=shade_z(pts[-1][2], pts[0][2], 0.2)))

    # -- hair: scalp cap + big spiky clumps (swept back and up, jagged bangs falling over the headband)
    cap = G.hair_cap(bd, 0.02, front=0.2, sides=0.13, back=0.07)
    cl = []
    for th, ph, L, w in ((-34, 50, 0.1, 0.026), (-17, 55, 0.115, 0.028), (0, 57, 0.12, 0.028), (17, 55, 0.115, 0.028), (34, 50, 0.1, 0.026)):
        cl.append(G.clump(fa, th, ph, L, w, v(math.sin(math.radians(th)) * 0.7, -0.75, -1.0), curl=0.5, droop=0.2, lift=0.012))
    for th, ph, L, w in ((-60, 68, 0.17, 0.036), (-25, 80, 0.2, 0.04), (12, 82, 0.21, 0.04), (45, 72, 0.18, 0.038), (-5, 62, 0.16, 0.036), (75, 60, 0.15, 0.034), (-85, 60, 0.15, 0.034)):
        cl.append(G.clump(fa, th, ph, L, w, v(math.sin(math.radians(th)) * 0.7, 0.8, 0.95), curl=0.12, lift=0.012))
    for sx in (1, -1):
        for th, ph, L, w in ((70, 42, 0.12, 0.032), (98, 34, 0.13, 0.034), (122, 28, 0.13, 0.034)):
            cl.append(G.clump(fa, th * sx, ph, L, w, v(sx * 1.0, 0.45, -0.1), curl=0.2, droop=0.15, lift=0.012))
        cl.append(G.clump(fa, 80 * sx, 12, 0.07, 0.02, v(sx * 0.2, -0.15, -1.0), curl=0.1, lift=0.008))
    for th, ph, L, w in ((148, 22, 0.14, 0.036), (170, 18, 0.15, 0.038), (190, 18, 0.15, 0.038), (212, 22, 0.14, 0.036), (180, 42, 0.16, 0.038), (155, 48, 0.15, 0.036), (205, 48, 0.15, 0.036)):
        a = math.radians(th)
        cl.append(G.clump(fa, th, ph, L, w, v(math.sin(a) * 0.6, 0.8, -0.35), curl=0.15, droop=0.2, lift=0.012))
    hair = Union([cap] + cl, 0.007 * u)
    layers.append(C.Layer('hair', hair, solid('#1f2635'), cls='hair', res=0.0034, budget=7000, weights=('rigid', 'head'),
                          paint=lambda V, N, col: col * (0.85 + 0.25 * np.clip(N[:, 2], 0, 1))[:, None]))
    return sk, bd, layers


def G_paint_ao_band(lo, hi, amt):
    return shade_z(lo, hi, amt)


CHARS = {'kai': kai}

if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['kai']
    names = list(CHARS) if args[0] == 'all' else [args[0]]
    prev = args[args.index('--preview') + 1] if '--preview' in args else None
    for n in names:
        sk, bd, layers = CHARS[n]()
        C.build(n, sk, bd, layers, out_path=os.path.join(OUT, f'{n}.glb') if '--export' in args else None,
                preview=os.path.join(prev, n) if prev else None)
