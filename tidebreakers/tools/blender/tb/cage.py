"""Stage 3 — Direct Polygon Modeling: the humanoid quad cage.

Edge-loop plan (all quads, closed, manifold):
  trunk     24 verts around; loops at crotch, hip, iliac crest, waist, ribs, chest, armpit, shoulder (2),
            neck base, neck (2), jaw, chin, mouth, nose, eyes (2), brow, forehead, crown band; grid caps
            top (6x6) and bottom (6x6) with two 2x4 leg sockets in the bottom cap; 3x2 arm sockets
            in the trunk's sides at armpit/shoulder height
  arms      10 around; loops at deltoid, mid upper arm, 3 at the elbow, forearm, 2 at the wrist, palm;
            a 1x4 knuckle strip, each strip quad bridged to a finger
  fingers   4 around; loops at each joint (bend) and mid-phalanx; single-quad tip cap
  thumb     4 around, bridged into a socket on the palm's thumb side
  legs      12 around; loops at the top of the thigh, mid thigh, 3 at the knee, calf, shin, 2 at the ankle;
            the foot turns forward through the heel and instep to a 2x4 toe cap
Loop vertices are placed on the sculpt by ray slicing (see polymodel.slice_ring).
"""
import math
import numpy as np
from . import polymodel as pm
from .sdf import Union

N_TRUNK = 24
N_ARM = 10
N_LEG = 12
N_FING = 4


def v(*a):
    return np.array(a, float)


def lerp(a, b, t):
    return a + (b - a) * t


def _mid_y(field, x, z, y0=-0.3, y1=0.3, step=0.002):
    ys = np.arange(y0, y1, step)
    P = np.stack([np.full_like(ys, x), ys, np.full_like(ys, z)], 1)
    d = field.eval(P)
    ins = np.nonzero(d < 0)[0]
    if len(ins) == 0:
        return 0.0
    return 0.5 * (ys[ins[0]] + ys[ins[-1]])


def build_cage(body):
    sk = body.sk
    j = sk.j
    fa = body.face_anchor
    u = fa['u']
    chin = fa['chin']
    P = pm.Poly()
    parts = body.parts
    head_parts = [p.field for p in parts if p.bone in ('head',)]
    trunk_field = Union([Union([p.field for p in parts if p.bone in ('torso', 'chest', 'spine', 'hips', 'neck')], 0.03)] + head_parts, 0.012 * u)

    def limb_field(bones, k=0.025):
        return Union([p.field for p in parts if p.bone in bones], k)

    # ---------------------------------------------------------------- trunk loops
    z_crotch = sk.s['leg'] - 0.065 * (sk.s['height'] / 1.70)
    neck_z = j['neck'][2]
    sh_z = j['shoulder.L'][2]
    T = neck_z - z_crotch
    torso_f = [0.015, 0.06, 0.13, 0.24, 0.37, 0.48, 0.58, 0.68, 0.77]
    zs = [z_crotch + T * f for f in torso_f]
    # arm socket loops: three loops spanning the armpit to the top of the shoulder
    arm_lo = sh_z - 0.085 * (sk.s['height'] / 1.70)
    arm_hi = sh_z + 0.005
    zs += [arm_lo, (arm_lo + arm_hi) / 2, arm_hi]
    zs += [neck_z + 0.004, neck_z + (j['head'][2] - neck_z) * 0.5]
    # head loops from the jaw to the crown (reference head units)
    head_h = [0.004, 0.025, 0.047, 0.07, 0.092, 0.108, 0.123, 0.138, 0.155, 0.175, 0.197, 0.217, 0.232]
    zs += [chin + h * u for h in head_h]
    zs = sorted(zs)
    rings = []
    ring_z = []
    for z in zs:
        cy = _mid_y(trunk_field, 0.0, z)
        c = v(0, cy, z)
        pts = pm.slice_ring(trunk_field, c, v(1, 0, 0), v(0, -1, 0), N_TRUNK, start=0.0, rmax=0.4)
        rings.append(P.add(pts, 'trunk'))
        ring_z.append(z)
    P.loft(rings)
    # ---------------------------------------------------------------- caps (bottom with leg sockets, top)
    # ring vertex k sits at angle 15k deg from +X toward the front (-Y); corners at k = 3, 9, 15, 21
    def cap_ring(r, start):
        return [r[(start + i) % N_TRUNK] for i in range(N_TRUNK)]
    bot = cap_ring(rings[0], 3)
    Gb = pm.grid_cap(P, bot, 6, 6, None, v(0, 0, 1), 'trunk', bulge=-0.012)
    top = cap_ring(rings[-1], 3)
    Gt = pm.grid_cap(P, top, 6, 6, None, v(0, 0, -1), 'trunk', bulge=0.02)
    # the bottom cap was walked from the ring, which runs counter to the top cap: fix its winding
    # (decided below by the global orientation check)
    # leg sockets: grid columns run from +X (x=0, character's left) to -X, rows from front (y=0) to back
    sockets = {}
    for side, cols in (('L', (0, 2)), ('R', (4, 6))):
        faces = []
        for y in range(1, 5):
            for x in range(cols[0], cols[1]):
                faces.append((Gb[y, x], Gb[y, x + 1], Gb[y + 1, x + 1], Gb[y + 1, x]))
        P.remove_faces(faces)
        sockets[side] = pm.boundary_loop(P.F, faces)
    # arm sockets: 3 quads around the side x 2 loop-intervals at the shoulder loops
    zi = [ring_z.index(arm_lo), ring_z.index((arm_lo + arm_hi) / 2), ring_z.index(arm_hi)]
    arm_sockets = {}
    for side, ks in (('L', (23, 0, 1)), ('R', (11, 12, 13))):
        faces = []
        for a, b in ((zi[0], zi[1]), (zi[1], zi[2])):
            for k in ks:
                k1 = (k + 1) % N_TRUNK
                faces.append((rings[a][k], rings[a][k1], rings[b][k1], rings[b][k]))
        P.remove_faces(faces)
        arm_sockets[side] = pm.boundary_loop(P.F, faces)

    # ---------------------------------------------------------------- arms, hands, fingers
    for side, sx in (('L', 1), ('R', -1)):
        afield = limb_field([f'upperarm.{side}', f'forearm.{side}', f'hand.{side}'])
        sh, el, wr = j[f'shoulder.{side}'], j[f'elbow.{side}'], j[f'wrist.{side}']
        side_ax, along, back = sk.frames[f'hand.{side}']
        palm_n = -back
        kn = sk.tail_of(f'hand.{side}')
        loops = []
        for t in (0.12, 0.32, 0.55, 0.78, 0.92):
            loops.append(('u', lerp(sh, el, t), el - sh))
        loops.append(('e', el, (el - sh) + (wr - el)))
        for t in (0.08, 0.3, 0.55, 0.8, 0.94):
            loops.append(('f', lerp(el, wr, t), wr - el))
        loops.append(('w', wr, wr - el))
        for t in (0.3, 0.62, 0.92):
            loops.append(('h', lerp(wr, kn, t), kn - wr))
        arm_rings = []
        for kind, c, axis in loops:
            if kind == 'h' or kind == 'w':
                X, Y = side_ax, palm_n  # hand: X across the hand (thumb side), Y out of the palm
                f = afield if kind == 'w' else limb_field([f'hand.{side}', f'forearm.{side}'])
            else:
                X, Y = pm.frame_for(axis, v(0, -1, 0))
                f = afield
            pts = pm.slice_ring(f, c, X, Y, N_ARM, start=math.radians(18), rmax=0.15, step=0.001, axis=axis)
            arm_rings.append(P.add(pts, f'arm.{side}'))
        P.loft(arm_rings)
        pm.bridge(P, arm_sockets[side], arm_rings[0])
        # knuckle strip: 1 x 4 grid closing the last hand loop; ring index 0..4 is the palm side
        last = arm_rings[-1]
        G = pm.grid_cap(P, last, 4, 1, None, along, f'hand.{side}', bulge=0.0)
        # thumb socket: the quad between the first two palm loops at the thumb side (ring verts 9 and 0)
        r0, r1 = arm_rings[-3], arm_rings[-2]
        tq = (r0[9], r0[0], r1[0], r1[9])
        P.remove_faces([tq])
        thumb_hole = pm.boundary_loop(P.F, [tq])
        # fingers: strip quads x = 0..3 run from the thumb side (index) to the pinky
        names = ['index', 'middle', 'ring', 'pinky']
        for x, nm in enumerate(names):
            q = (G[0, x], G[0, x + 1], G[1, x + 1], G[1, x])
            P.remove_faces([q])
            hole = pm.boundary_loop(P.F, [q])
            frings = _finger_rings(P, body, f'{nm}', side, X=side_ax, Y=palm_n)
            P.loft(frings)
            pm.bridge(P, hole, frings[0])
            _tip(P, frings[-1])
        trings = _finger_rings(P, body, 'thumb', side, X=None, Y=palm_n)
        P.loft(trings)
        pm.bridge(P, thumb_hole, trings[0])
        _tip(P, trings[-1])

    # ---------------------------------------------------------------- legs and feet
    for side, sx in (('L', 1), ('R', -1)):
        lfield = limb_field([f'thigh.{side}', f'shin.{side}'])
        ffield = limb_field([f'shin.{side}', f'foot.{side}', f'toe.{side}'], 0.02)
        hp, kn, an = j[f'hip.{side}'], j[f'knee.{side}'], j[f'ankle.{side}']
        ball, toe = j[f'ball.{side}'], j[f'toe.{side}']
        t0 = (hp[2] - (z_crotch - 0.035)) / (hp[2] - kn[2])
        loops = []
        for t in (t0, 0.42, 0.62, 0.8):
            loops.append((lerp(hp, kn, t), kn - hp, lfield))
        for t in (0.93, 1.0):
            loops.append((lerp(hp, kn, t), kn - hp, lfield))
        for t in (0.07, 0.22, 0.42, 0.62, 0.8, 0.92):
            loops.append((lerp(kn, an, t), an - kn, lfield))
        # foot: from the ankle through the heel and instep to the ball and toe
        heel_dir = pm.norm(v(0, 0, -1) * 0.75 + (ball - an) * 0.4)
        foot_path = [(an + v(0, 0.004, -0.012), pm.norm(v(0, 0, -1) * 0.9 + pm.norm(ball - an) * 0.1)),
                     (an + v(0, -0.012, -0.03), heel_dir),
                     (lerp(an, ball, 0.42) + v(0, 0, -0.012), pm.norm(ball - an)),
                     (lerp(an, ball, 0.75) + v(0, 0, -0.004), pm.norm(ball - an)),
                     (ball + v(0, 0, 0.002), pm.norm(toe - ball)),
                     (lerp(ball, toe, 0.6), pm.norm(toe - ball))]
        leg_rings = []
        for c, axis, f in loops:
            X, Y = pm.frame_for(axis, v(sx, 0, 0))
            pts = pm.slice_ring(f, c, X, Y, N_LEG, start=math.radians(15), rmax=0.2, step=0.001, axis=axis)
            leg_rings.append(P.add(pts, f'leg.{side}'))
        for c, axis in foot_path:
            X, Y = pm.frame_for(axis, v(sx, 0, 0))
            pts = pm.slice_ring(ffield, c, X, Y, N_LEG, start=math.radians(15), rmax=0.15, step=0.001, axis=axis)
            leg_rings.append(P.add(pts, f'foot.{side}'))
        P.loft(leg_rings)
        pm.bridge(P, sockets[side], leg_rings[0])
        pm.grid_cap(P, leg_rings[-1], 2, 4, None, pm.norm(toe - ball), f'foot.{side}', bulge=-0.004)

    V, F = P.arrays()
    F = orient(V, F, body.field())
    return V, F, np.array(P.tag)


def _finger_rings(P, body, name, side, X, Y):
    sk = body.sk
    rings = []
    segs = [f'{name}{i}.{side}' for i in (1, 2, 3)]
    pts_axis = []
    for i, b in enumerate(segs):
        a, t = sk.head_of(b), sk.tail_of(b)
        ts = (0.0, 0.5) if i < 2 else (0.0, 0.45, 0.85)
        for tt in ts:
            pts_axis.append((lerp(a, t, tt), t - a, b))
    f_all = Union([p.field for p in body.parts if p.bone in segs], 0.004)
    for c, axis, b in pts_axis:
        if X is None:
            Xf, Yf = pm.frame_for(axis, Y)
        else:
            Xf, Yf = pm.frame_for(axis, X)
        pts = pm.slice_ring(f_all, c, Xf, Yf, N_FING, start=math.radians(45), rmax=0.04, step=0.0005, fallback=0.008, axis=axis)
        rings.append(P.add(pts, f'finger.{side}'))
    return rings


def _tip(P, ring):
    a, b, c, d = ring
    P.quad(a, b, c, d)


def orient(V, F, field):
    """Consistent outward winding: propagate winding across shared edges from a seed face, then flip the
    whole mesh if most faces point into the sculpt."""
    from collections import deque
    from .sdf import gradient
    F = [list(f) for f in F]
    edge_faces = {}
    for fi, f in enumerate(F):
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            edge_faces.setdefault((min(a, b), max(a, b)), []).append(fi)
    seen = [False] * len(F)
    for seed in range(len(F)):
        if seen[seed]:
            continue
        seen[seed] = True
        q = deque([seed])
        while q:
            fi = q.popleft()
            f = F[fi]
            for i in range(len(f)):
                a, b = f[i], f[(i + 1) % len(f)]
                for gj in edge_faces[(min(a, b), max(a, b))]:
                    if gj == fi or seen[gj]:
                        continue
                    g = F[gj]
                    # consistent neighbours traverse the shared edge in opposite directions
                    same = any(g[k] == a and g[(k + 1) % len(g)] == b for k in range(len(g)))
                    if same:
                        F[gj] = g[::-1]
                    seen[gj] = True
                    q.append(gj)
    F = np.array(F, np.int64)
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(b - a, c - a)
    g = gradient(field, V[F].mean(1), 0.002)
    if (np.einsum('ij,ij->i', n, g) > 0).mean() < 0.5:
        F = F[:, ::-1].copy()
    return F
