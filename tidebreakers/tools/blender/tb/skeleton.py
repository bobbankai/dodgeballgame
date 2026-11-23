"""Humanoid skeleton from a proportion spec (pure python + numpy).

Every humanoid in Tidebreakers shares these bone names, so one animation library drives them all.
The rest pose is an A-pose (arms ~40 degrees below horizontal, elbows and knees slightly bent) which
deforms better at the shoulders than a T-pose and gives the IK solver a bend direction.

Blender axes: Z up, the character faces -Y, its left is +X. Bone 'roll' is set by `up`: the bone's local
Z axis is aligned toward that vector, so limbs bend about their local X.
"""
import math
import numpy as np

# Reference proportions (Kai, 1.70 m). Lengths in metres.
BASE = dict(
    height=1.70,
    head=0.245,          # chin to crown
    neck=0.075,
    shoulder=0.185,      # half width, centre to shoulder joint
    hip=0.088,           # half width, centre to hip joint
    leg=0.865,           # hip joint height
    knee=0.465,          # knee height
    ankle=0.072,
    foot=0.205,          # heel to toe tip
    upperarm=0.285,
    forearm=0.255,
    hand=0.175,
    arm_drop=40.0,       # degrees below horizontal in the rest pose
    arm_fwd=8.0,         # degrees forward
    finger=1.0,          # finger length scale
    stance=0.0,          # extra half-width at the feet
)


def v(*a):
    return np.array(a, float)


def norm(a):
    return a / np.linalg.norm(a)


class Skeleton:
    def __init__(self, **spec):
        s = dict(BASE)
        s.update(spec)
        self.s = s
        self.j = {}          # named joints
        self.bones = []      # (name, head, tail, parent, up, deform)
        self.frames = {}     # per-bone orthonormal frame (x, y=along, z=up) for building geometry
        self._build()

    # --------------------------------------------------------------------------------------------
    def _build(self):
        s = self.s
        H = s['height']
        crown = H
        chin = H - s['head']
        head_pivot = v(0, 0.012, chin + 0.12 * s['head'])
        neck_base = v(0, 0.02, head_pivot[2] - s['neck'])
        hipz = s['leg']
        pelvis = v(0, 0.0, hipz + 0.035)
        T = neck_base[2] - pelvis[2]
        spine = v(0, 0.005, pelvis[2] + 0.24 * T)
        chest = v(0, 0.012, pelvis[2] + 0.56 * T)
        j = self.j
        j.update(crown=v(0, 0.0, crown), chin=v(0, -0.06 * s['head'] / 0.245, chin), head=head_pivot, neck=neck_base,
                 pelvis=pelvis, spine=spine, chest=chest)
        B = self.bones
        B.append(('root', v(0, 0, 0), v(0, 0.25, 0), None, v(0, 0, 1), False))
        B.append(('hips', pelvis, spine, 'root', v(0, -1, 0), True))
        B.append(('spine', spine, chest, 'hips', v(0, -1, 0), True))
        B.append(('chest', chest, neck_base, 'spine', v(0, -1, 0), True))
        B.append(('neck', neck_base, head_pivot, 'chest', v(0, -1, 0), True))
        B.append(('head', head_pivot, v(0, 0.012, crown), 'neck', v(0, -1, 0), True))
        for side, sx in (('L', 1.0), ('R', -1.0)):
            # arm
            clav = v(sx * 0.022, 0.012, neck_base[2] - 0.028)
            sh = v(sx * s['shoulder'], 0.02, neck_base[2] - 0.035)
            drop = math.radians(s['arm_drop'])
            fwd = math.radians(s['arm_fwd'])
            d = norm(v(sx * math.cos(drop), -math.sin(fwd), -math.sin(drop)))
            elbow = sh + d * s['upperarm']
            # forearm bends slightly forward and in
            d2 = norm(d + v(0, -0.16, 0.0) + v(-sx * 0.04, 0, 0))
            wrist = elbow + d2 * s['forearm']
            j.update({f'shoulder.{side}': sh, f'elbow.{side}': elbow, f'wrist.{side}': wrist})
            B.append((f'shoulder.{side}', clav, sh, 'chest', v(0, -1, 0), True))
            B.append((f'upperarm.{side}', sh, elbow, f'shoulder.{side}', v(0, 1, 0), True))
            B.append((f'forearm.{side}', elbow, wrist, f'upperarm.{side}', v(0, 1, 0), True))
            # hand frame: along = d2, palm faces down/in, thumb forward (-Y)
            palm_n = norm(-np.cross(d2, v(0, 1, 0)) * sx)   # unit vector out of the palm
            if palm_n[2] > 0:
                palm_n = -palm_n
            side_ax = norm(np.cross(palm_n, d2))           # across the palm
            if side_ax[1] > 0:
                side_ax = -side_ax                          # points toward the thumb (-Y)
            hl = s['hand']
            knuckle_c = wrist + d2 * hl * 0.47
            B.append((f'hand.{side}', wrist, knuckle_c, f'forearm.{side}', -palm_n, True))
            self.frames[f'hand.{side}'] = (side_ax, d2, -palm_n)
            fl = s['finger'] * hl
            # (name, across-offset, length scale, splay)
            fingers = (('index', 0.36, 0.50, -0.06), ('middle', 0.12, 0.55, 0.0), ('ring', -0.12, 0.52, 0.05), ('pinky', -0.34, 0.42, 0.12))
            pw = hl * 0.25  # half palm width
            for name, off, ln, splay in fingers:
                base = knuckle_c + side_ax * off * pw * 2 + d2 * (0.0 if name in ('middle',) else -0.008 if name != 'pinky' else -0.02)
                dirf = norm(d2 - side_ax * splay)
                segs = (0.45, 0.30, 0.25)
                # rest curl: fingers slightly bent toward the palm
                p = base
                parent = f'hand.{side}'
                for i, sl in enumerate(segs):
                    curl = math.radians(12 + 6 * i)
                    dirf = norm(dirf * math.cos(curl) + palm_n * math.sin(curl))
                    q = p + dirf * fl * ln * sl
                    bn = f'{name}{i + 1}.{side}'
                    B.append((bn, p, q, parent, -palm_n, True))
                    parent = bn
                    p = q
            # thumb: from the wrist's thumb side, angled forward and toward the palm
            tb = wrist + d2 * hl * 0.10 + side_ax * pw * 0.75 + palm_n * hl * 0.06
            tdir = norm(d2 * 0.55 + side_ax * 0.65 + palm_n * 0.5)
            p = tb
            parent = f'hand.{side}'
            for i, sl in enumerate((0.36, 0.30, 0.26)):
                tdir = norm(tdir + palm_n * 0.12 + d2 * 0.08)
                q = p + tdir * fl * 0.62 * sl
                bn = f'thumb{i + 1}.{side}'
                B.append((bn, p, q, parent, norm(np.cross(tdir, palm_n)) * sx, True))
                parent = bn
                p = q
            # leg
            hipj = v(sx * s['hip'], 0.0, hipz)
            knee = v(sx * (s['hip'] * 0.92 + s['stance'] * 0.5), -0.018, s['knee'])
            ankle = v(sx * (s['hip'] * 0.85 + s['stance']), 0.03, s['ankle'])
            ball = ankle + v(sx * 0.008, -s['foot'] * 0.62, -s['ankle'] + 0.028)
            toe = ball + v(sx * 0.004, -s['foot'] * 0.30, -0.012)
            j.update({f'hip.{side}': hipj, f'knee.{side}': knee, f'ankle.{side}': ankle, f'ball.{side}': ball, f'toe.{side}': toe})
            B.append((f'thigh.{side}', hipj, knee, 'hips', v(0, -1, 0), True))
            B.append((f'shin.{side}', knee, ankle, f'thigh.{side}', v(0, -1, 0), True))
            B.append((f'foot.{side}', ankle, ball, f'shin.{side}', v(0, 0, 1), True))
            B.append((f'toe.{side}', ball, toe, f'foot.{side}', v(0, 0, 1), True))

    # --------------------------------------------------------------------------------------------
    def add_chain(self, prefix, points, parent, up=(0, -1, 0)):
        """Extra deform chain (hair, headband tails, coat tails): bones prefix1..n along points."""
        names = []
        for i in range(len(points) - 1):
            n = f'{prefix}{i + 1}'
            self.bones.append((n, np.asarray(points[i], float), np.asarray(points[i + 1], float), parent, v(*up), True))
            parent = n
            names.append(n)
        return names

    def bone(self, name):
        for b in self.bones:
            if b[0] == name:
                return b
        raise KeyError(name)

    def head_of(self, name):
        return self.bone(name)[1]

    def tail_of(self, name):
        return self.bone(name)[2]

    def parent_of(self, name):
        return self.bone(name)[3]

    def children_of(self, name):
        return [b[0] for b in self.bones if b[3] == name]

    def relatives(self, name):
        """Bones allowed to share weights with `name`: itself, parent, grandparent, children."""
        out = {name}
        p = self.parent_of(name)
        if p:
            out.add(p)
            gp = self.parent_of(p)
            if gp and gp != 'root':
                out.add(gp)
        out.update(self.children_of(name))
        return out

    def deform_names(self):
        return [b[0] for b in self.bones if b[5]]
