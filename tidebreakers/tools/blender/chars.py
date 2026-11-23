"""Tidebreakers characters through the production pipeline (tb/pipeline.py).

    blender -b -P chars.py -- <name|all> [--export] [--norender]

Writes public/assets/chars/<name>.glb and docs/art/<name>/ (reference sheet, stage renders, log).
"""
import os
import sys
import math
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from tb import sdf, skeleton, body as bodymod, garment as G, character as C, polychar as pc, pipeline as P  # noqa: E402
from tb.sdf import Ellipsoid, RoundCone, Sphere, Box, Union, Intersect, Subtract, Offset, Plane, Func  # noqa: E402

v = G.v
norm = G.norm
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'assets', 'chars')
ART = os.path.join(ROOT, 'docs', 'art')


def lerp(a, b, t):
    return a + (b - a) * t


def hexc(h):
    return C.srgb(h)


# ------------------------------------------------------------------------------------------ painting

def mix_paint(other, mask_fn):
    o = hexc(other)

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


def near_z(z, width):
    return lambda V, N: np.clip(1 - np.abs(V[:, 2] - z) / width, 0, 1) ** 0.4


def shade_z(lo, hi, amount):
    def paint(V, N, col):
        t = np.clip((V[:, 2] - lo) / max(hi - lo, 1e-6), 0, 1)
        return col * (1 - amount * (1 - t))[:, None]
    return paint


def skin_paint(body, blush=0.3):
    fa = body.face_anchor
    u = fa['u']
    sk = body.sk
    cheeks = [fa['eye_L'] + v(0.006, 0.01, -0.032) * u, fa['eye_R'] + v(-0.006, 0.01, -0.032) * u]
    warm = hexc('#e8806e')

    def paint(V, N, col):
        m = np.zeros(len(V))
        for p in cheeks:
            m = np.maximum(m, np.clip(1 - np.linalg.norm(V - p, axis=1) / (0.026 * u), 0, 1) ** 1.5 * blush)
        for jn in ('elbow', 'knee'):
            for s in ('L', 'R'):
                m = np.maximum(m, np.clip(1 - np.linalg.norm(V - sk.j[f'{jn}.{s}'], axis=1) / 0.06, 0, 1) * 0.16)
        for s in ('L', 'R'):
            m = np.maximum(m, np.clip(1 - np.linalg.norm(V - sk.tail_of(f'hand.{s}'), axis=1) / 0.035, 0, 1) * 0.18)
        return col * (1 - m[:, None]) + warm * m[:, None]
    return paint


def hair_paint(dark, light):
    d, l = hexc(dark), hexc(light)

    def paint(V, N, col):
        t = np.clip(N[:, 2] * 0.5 + 0.5, 0, 1)[:, None]
        return d * (1 - t) + l * t
    return paint


# ------------------------------------------------------------------------------------------ parts

def clumps_to_parts(fa, specs, color, paint=None, name='hair', weights=('rigid', 'head')):
    Vs, Fs = [], []
    off = 0
    for sp in specs:
        pts, ws, ts, ns = G.clump_data(fa, *sp[:5], **(sp[5] if len(sp) > 5 else {}))
        flat = float(np.mean(ts / np.maximum(ws, 1e-6)))
        V, F = pc.tube(pts, ws, n=6, normals=ns, flat=flat, cap_tip=True, cap_root=True)
        Vs.append(V)
        Fs += [tuple(i + off for i in f) for f in F]
        off += len(V)
    return P.Part(name, np.concatenate(Vs), Fs, color, cls='hair', weights=weights, paint=paint)


def strip_part(name, pts, width, thick, normal, color, weights, cls='cloth', paint=None, n=6):
    pts = np.asarray(pts, float)
    w = np.broadcast_to(np.asarray(width, float), (len(pts),))
    V, F = pc.tube(pts, w, n=n, normals=np.tile(normal, (len(pts), 1)), flat=thick / float(np.mean(w)), cap_tip=True, cap_root=True)
    return P.Part(name, V, F, color, cls=cls, weights=weights, paint=paint)


def merge_parts(name, parts, color, cls, weights, paint=None, field=None):
    Vs, Fs, off = [], [], 0
    for V, F in parts:
        Vs.append(np.asarray(V))
        Fs += [tuple(i + off for i in f) for f in F]
        off += len(V)
    return P.Part(name, np.concatenate(Vs), Fs, color, cls=cls, weights=weights, paint=paint, field=field)


def ring_tube(center, radius, tube_r, axis, n_ring=16, n=6):
    """A closed torus-like quad tube (straps, rings, belts)."""
    axis = norm(np.asarray(axis, float))
    X = norm(np.cross(axis, [0, 0, 1.0]) if abs(axis[2]) < 0.9 else np.cross(axis, [1.0, 0, 0]))
    Y = np.cross(axis, X)
    pts = [center + (X * math.cos(a) + Y * math.sin(a)) * radius for a in np.linspace(0, 2 * math.pi, n_ring + 1)[:-1]]
    V, F, rings = [], [], []
    for i, p in enumerate(pts):
        t = norm(pts[(i + 1) % n_ring] - pts[i - 1])
        nx = norm(p - center)
        ny = np.cross(t, nx)
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            ring.append(len(V))
            V.append(p + nx * math.cos(a) * tube_r + ny * math.sin(a) * tube_r)
        rings.append(ring)
    for i in range(n_ring):
        r0, r1 = rings[i], rings[(i + 1) % n_ring]
        for k in range(n):
            k1 = (k + 1) % n
            F.append((r0[k], r0[k1], r1[k1], r1[k]))
    return np.array(V), F


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
    z0 = sk.s['leg'] - 0.065
    waist = z0 + (neck_base - z0) * 0.37
    pal = {'skin': '#eab48f', 'hair': '#1f2635', 'headband / sash': '#d63a3c', 'jacket': '#f2a23b', 'jacket trim': '#8d4a1f',
           'tank top': '#efe6d4', 'trousers': '#2c3d6d', 'wraps': '#e6d8bb', 'bronze plates': '#b97a3c', 'wind glyph': '#71f2ff',
           'sandals': '#6e4a2c', 'iris': '#e9a23b'}

    # bone chains for secondary motion
    hb_z = chin + 0.178 * u
    band_chains = {}
    for s, sx in (('L', 1), ('R', -1)):
        k0 = v(sx * 0.014, 0.118 * u + 0.016, hb_z)
        pts = [k0, k0 + v(sx * 0.02, 0.035, -0.04), k0 + v(sx * 0.035, 0.06, -0.11), k0 + v(sx * 0.045, 0.075, -0.19), k0 + v(sx * 0.05, 0.08, -0.27)]
        if s == 'R':
            pts = [k0] + [p + v(0, -0.01, 0.03) for p in pts[1:4]]
        band_chains[s] = (sk.add_chain(f'band{s}', pts, 'head'), pts)
    sash_k = v(0.135, -0.03, waist - 0.005)
    sash_pts = [sash_k, sash_k + v(0.01, -0.012, -0.07), sash_k + v(0.018, -0.012, -0.15), sash_k + v(0.022, -0.008, -0.23), sash_k + v(0.024, -0.004, -0.31)]
    sash_chain = sk.add_chain('sash', sash_pts, 'hips')

    garments = []
    # tank top
    holes = Union([Sphere(j[f'shoulder.{s}'] + v(sx * 0.03, 0.0, -0.035), 0.083) for s, sx in (('L', 1), ('R', -1))] +
                  [Ellipsoid(v(0, -0.075, neck_base - 0.025), v(0.075, 0.07, 0.07)), Ellipsoid(v(0, 0.06, neck_base + 0.01), v(0.065, 0.06, 0.04))])
    garments.append(P.Garment('tank', Offset(torso, 0.007), Intersect([G.above(waist - 0.06), pc.complement(holes)]), hexc(pal['tank top']),
                              thickness=0.003, paint=shade_z(waist - 0.06, waist + 0.25, 0.1)))
    # open cropped jacket
    opening = Func(lambda p: np.maximum(np.abs(p[:, 0]) - (0.03 + 0.22 * np.clip(neck_base - p[:, 2], 0, 1)), p[:, 1] + 0.01),
                   v(-0.3, -0.4, 0.5), v(0.3, 0.0, 1.8))
    arms_cut = Union([Sphere(j[f'shoulder.{s}'] + v(sx * 0.055, 0.0, -0.045), 0.085) for s, sx in (('L', 1), ('R', -1))])
    jk_cut = Intersect([G.above(waist + 0.045), pc.complement(opening), pc.complement(arms_cut)])
    garments.append(P.Garment('jacket', G.folds(Offset(torso, 0.0175), 0.0015, 38, axis=(0.2, 0, 1), seed=2), jk_cut, hexc(pal['jacket']),
                              thickness=0.007,
                              paint=chain_paint(mix_paint(pal['jacket trim'], near_z(waist + 0.045, 0.014)),
                                                mix_paint(pal['jacket trim'], lambda V, N: (np.abs(np.abs(V[:, 0]) - (0.03 + 0.22 * np.clip(neck_base - V[:, 2], 0, 1))) < 0.013) * (V[:, 1] < 0) * 1.0),
                                                shade_z(waist, neck_base, 0.1))))
    neckr = bd.region(['neck'], 0.02)
    collar_base = G.flare(neckr, 0.034, -0.022, neck_base + 0.05, neck_base - 0.035)
    collar_cut = Intersect([G.slab((0, 0, 1), neck_base - 0.035, neck_base + 0.048), Plane(v(0, -1, 0), v(0, -0.02, 0))])
    garments.append(P.Garment('collar', collar_base, collar_cut, hexc(pal['jacket']), thickness=0.007, covers=False,
                              region=lambda c: (np.abs(neckr.eval(c)) < 0.012) & (c[:, 2] > neck_base - 0.05) & (c[:, 2] < chin + 0.02), paint=mix_paint(pal['jacket trim'], near_z(neck_base + 0.048, 0.01))))
    # trousers, rolled at mid-calf
    cuff_z = 0.30
    pants_base = G.folds(G.flare(legs, 0.012, 0.026, sk.s['leg'], cuff_z), 0.0025, 30, noise=0.8, seed=3)
    garments.append(P.Garment('pants', pants_base, Intersect([G.below(waist + 0.01), G.above(cuff_z)]), hexc(pal['trousers']), thickness=0.004,
                              paint=shade_z(cuff_z, waist, 0.16)))
    shins = bd.region(['shin.L', 'shin.R'], 0.02)
    garments.append(P.Garment('cuffs', Offset(shins, 0.043), G.slab((0, 0, 1), cuff_z - 0.035, cuff_z + 0.012), hexc('#40568f'), thickness=0.01,
                              region=lambda c: c[:, 2] < 0.5))
    # sash
    garments.append(P.Garment('sash', Offset(torso, 0.034), G.slab((0, 0, 1), waist - 0.032, waist + 0.032), hexc(pal['headband / sash']),
                              thickness=0.012, paint=shade_z(waist - 0.03, waist + 0.03, 0.15)))
    # forearm wraps
    for s in 'LR':
        el, wr = j[f'elbow.{s}'], j[f'wrist.{s}']
        fd = norm(wr - el)
        a = lerp(el, wr, 0.3)
        fr = bd.region([f'forearm.{s}'], 0.02)
        base = G.wraps(Offset(fr, 0.006), a, wr + fd * 0.012, 0.0022, 8)
        garments.append(P.Garment(f'wrap{s}', base, G.slab(fd, float(a @ fd), float(wr @ fd) + 0.012), hexc(pal['wraps']), thickness=0.003,
                                  region=(lambda c, s=s: (c[:, 0] > 0.1) if s == 'L' else (c[:, 0] < -0.1))))
    # headband (tilted: higher at the brow)
    hn = norm(v(0, 0.3, 1))
    c0 = float(v(0, -0.1, hb_z + 0.022) @ hn)
    garments.append(P.Garment('headband', Offset(bd.head_field, 0.009 * u), G.slab(hn, c0 - 0.013 * u, c0 + 0.013 * u), hexc(pal['headband / sash']),
                              thickness=0.004, covers=False, region=lambda c: c[:, 2] > chin + 0.08 * u, weights=('rigid', 'head')))
    # hair cap (scalp volume above the hairline)
    capf = G.hair_cap(bd, 0.02, front=0.2, sides=0.13, back=0.07)
    garments.append(P.Garment('haircap', Offset(bd.head_field, 0.02 * u), capf.items[1], hexc(pal['hair']), cls='hair', thickness=0.0, covers=True,
                              region=lambda c: c[:, 2] > chin + 0.06 * u, weights=('rigid', 'head'), paint=hair_paint('#151b28', '#2b3550')))
    # sandal soles
    for s in 'LR':
        foot = bd.region([f'foot.{s}', f'toe.{s}'], 0.02)
        garments.append(P.Garment(f'sole{s}', Offset(foot, 0.012), Intersect([G.below(0.024), G.above(-0.01)]), hexc(pal['sandals']), cls='wood',
                                  thickness=0.014, covers=True, weights=('rigid', f'foot.{s}'),
                                  region=(lambda c, s=s: (c[:, 0] > 0) if s == 'L' else (c[:, 0] < 0))))
    parts = []
    # hair clumps (polygon strips)
    clumps = []
    # fringe: two layers of uneven, fanned clumps sweeping across the headband (not a row of equal spikes)
    for th, ph, L, w, sweep, tw in ((-40, 52, 0.105, 0.03, -0.55, 0.3), (-22, 58, 0.14, 0.034, -0.35, 0.2), (-6, 61, 0.125, 0.032, 0.25, -0.2),
                                     (10, 60, 0.15, 0.036, 0.45, -0.3), (28, 56, 0.11, 0.03, 0.65, -0.2), (44, 50, 0.09, 0.026, 0.9, 0.0)):
        clumps.append((th, ph, L, w, v(sweep, -0.55, -1.0), dict(curl=0.25, droop=0.35, lift=0.014, twist=tw, thick=0.4)))
    for th, ph, L, w, sweep in ((-30, 66, 0.12, 0.034, -0.4), (2, 68, 0.13, 0.036, 0.15), (30, 64, 0.115, 0.032, 0.5)):
        clumps.append((th, ph, L, w, v(sweep, -0.35, -0.75), dict(curl=0.3, droop=0.25, lift=0.018, thick=0.42)))
    for th, ph, L, w in ((-60, 68, 0.17, 0.036), (-25, 80, 0.2, 0.04), (12, 82, 0.21, 0.04), (45, 72, 0.18, 0.038), (-5, 62, 0.16, 0.036), (75, 60, 0.15, 0.034), (-85, 60, 0.15, 0.034)):
        clumps.append((th, ph, L, w, v(math.sin(math.radians(th)) * 0.7, 0.8, 0.95), dict(curl=0.12, lift=0.012)))
    for sx in (1, -1):
        for th, ph, L, w in ((70, 42, 0.12, 0.032), (98, 34, 0.13, 0.034), (122, 28, 0.13, 0.034)):
            clumps.append((th * sx, ph, L, w, v(sx * 1.0, 0.45, -0.1), dict(curl=0.2, droop=0.15, lift=0.012)))
        clumps.append((80 * sx, 12, 0.07, 0.02, v(sx * 0.2, -0.15, -1.0), dict(curl=0.1, lift=0.008)))
    for th, ph, L, w in ((148, 22, 0.14, 0.036), (170, 18, 0.15, 0.038), (190, 18, 0.15, 0.038), (212, 22, 0.14, 0.036), (180, 45, 0.16, 0.038), (155, 48, 0.15, 0.036), (205, 48, 0.15, 0.036)):
        a = math.radians(th)
        clumps.append((th, ph, L, w, v(math.sin(a) * 0.6, 0.8, -0.35), dict(curl=0.15, droop=0.2, lift=0.012)))
    parts.append(clumps_to_parts(fa, clumps, hexc(pal['hair']), paint=hair_paint('#151b28', '#2b3550')))
    # headband knot and tails
    kq = pc.quad_sphere(v(0, 0.118 * u + 0.012, hb_z), (0.022, 0.016, 0.02))
    parts.append(P.Part('bandknot', kq[0], kq[1], hexc(pal['headband / sash']), weights=('rigid', 'head')))
    for s in 'LR':
        names, pts = band_chains[s]
        parts.append(strip_part(f'band{s}', pts, [0.016, 0.02, 0.021, 0.02, 0.016][:len(pts)], 0.0045, v(1, 0, 0), hexc(pal['headband / sash']),
                                ('chain', names), paint=shade_z(pts[-1][2], pts[0][2], 0.2)))
    # sash knot and tails
    sk_q = pc.quad_sphere(sash_k + v(0.004, -0.006, 0), (0.032, 0.03, 0.036))
    parts.append(P.Part('sashknot', sk_q[0], sk_q[1], hexc(pal['headband / sash']), weights=('rigid', 'hips')))
    tn = norm(v(1, -0.6, 0))
    parts.append(strip_part('sashtail', np.array(sash_pts) + v(0.004, 0, 0), [0.026, 0.028, 0.03, 0.03, 0.026], 0.006, tn, hexc(pal['headband / sash']),
                            ('chain', sash_chain), paint=shade_z(waist - 0.32, waist, 0.25)))
    parts.append(strip_part('sashtail2', np.array(sash_pts[:4]) + v(-0.012, 0.03, 0.01), [0.024, 0.026, 0.026, 0.022], 0.006, tn, hexc(pal['headband / sash']),
                            ('chain', sash_chain[:3]), paint=shade_z(waist - 0.32, waist, 0.25)))
    # bronze plates with a glowing wind glyph, sandal straps
    for s in 'LR':
        el, wr = j[f'elbow.{s}'], j[f'wrist.{s}']
        fd = norm(wr - el)
        side_ax, along, back = sk.frames[f'hand.{s}']
        pcen = lerp(el, wr, 0.6) + back * 0.034
        R = np.stack([side_ax, fd, back], 1)
        Vp, Fp = pc.box_mesh(pcen, (0.024, 0.048, 0.006), R, bevel=0.003)
        parts.append(P.Part(f'plate{s}', Vp, Fp, hexc(pal['bronze plates']), cls='metal', weights=('rigid', f'forearm.{s}')))
        gl = [pc.box_mesh(pcen + back * 0.006 + fd * dz, (0.008, 0.008, 0.0022), R @ sdf.rot_z(math.pi / 4), bevel=0.0012) for dz in (-0.018, 0.0, 0.018)]
        parts.append(merge_parts(f'glyph{s}', gl, hexc(pal['wind glyph']), 'glow', ('rigid', f'forearm.{s}')))
        an, ball = j[f'ankle.{s}'], j[f'ball.{s}']
        ring = ring_tube(an + v(0, 0.004, 0.012), 0.037, 0.0055, (0, 0, 1))
        thong = pc.tube([lerp(an, ball, 0.5) + v(0, 0, 0.022), ball + v(0, -0.02, 0.014)], [0.005, 0.004], n=6, cap_tip=True, cap_root=True)
        parts.append(merge_parts(f'strap{s}', [ring, thong], hexc('#4b2e1c'), 'leather', ('rigid', f'foot.{s}')))
    ref = dict(
        title='Kai Marlowe',
        summary='17, the hero. Loud, hungry, fearless; fights with wind wrapped round his fists (Stormpearl). '
                'Reads instantly as a shonen lead: spiky dark hair swept up and back, a red headband whose long '
                'tails trail every move, an open cropped orange jacket over a white tank, rolled navy trousers, sandals.',
        shapes=['Triangles up top (hair spikes, popped collar, jacket lapels) over a stable rectangle below (trousers)',
                'Long flowing accents for secondary motion: headband tails, sash tails',
                'Big hands and forearms (wrapped, bronze plates) because he fights with his fists',
                'Round open eyes (eye style 0), amber irises, thick brows: an honest, warm face'],
        palette=pal,
        motion=['Springy and forward-leaning; anticipation dips are deep, follow-through overshoots',
                'Headband and sash tails lag the body (spring chains)'],
    )
    return P.Spec('kai', sk, bd, hexc(pal['skin']), garments, parts, ref, skin_paint=skin_paint(bd), subdiv=1)


CHARS = {'kai': kai}
import cast  # noqa: E402
CHARS.update(cast.CAST)

if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['kai']
    names = list(CHARS) if args[0] == 'all' else [args[0]]
    for n in names:
        spec = CHARS[n]()
        P.build(spec, os.path.join(OUT, f'{n}.glb') if '--export' in args else None, os.path.join(ART, n), renders='--norender' not in args)
