"""Pose solver for the fighters' rig: a pose is a small set of controls (hips, spine, head, hand and foot
targets, elbow and knee directions, fists) and this module turns it into a rotation for every bone.

All of it is plain maths on the rest pose (two-bone IK for arms and legs, frames built from directions), so
the same clip solves correctly for a small fighter and a huge one, feet planted and fists on target.

Character space (Blender): faces -Y, up +Z, the character's left is +X. Angles in degrees.
  pitch  about X, positive leans forward        yaw  about Z, positive turns to the left
  roll   about Y, positive leans to the left

Controls (defaults in STAND; positions are for a reference body with the hips 0.93 m up and are scaled):
  hips (x, y, z) offset of the pelvis      hip_rot / spine / head (pitch, yaw, roll); head is in world terms
  hand_L/R wrist position                   elbow_L/R direction the elbow points
  pron_L/R 0 palm inward, 90 palm down, -90 palm up       wrist_L/R bend back (+) or in (-)
  aim_L/R 0..1: the height is an opponent's (absolute) rather than the fighter's own (scaled)
  foot_L/R ball of the foot (x, y, z lift)  toe_L/R yaw of the foot      heel_L/R heel raise
  free_L/R 0 planted (flat to the floor), 1 the foot follows the shin (kicks); point_L/R toe point when free
  knee_L/R direction the knee points        fist_L/R 0 open .. 1 fist      shrug_L/R (up, forward)
"""
import math
import numpy as np

REF_HIP = 0.93

STAND = dict(
    hips=(0, 0, -0.005), hip_rot=(0, 0, 0), spine=(0, 0, 0), head=(0, 0, 0),
    hand_L=(0.26, -0.02, 0.86), hand_R=(-0.26, -0.02, 0.86), elbow_L=(0.5, 0.9, -0.2), elbow_R=(-0.5, 0.9, -0.2),
    pron_L=0, pron_R=0, wrist_L=0, wrist_R=0, aim_L=0, aim_R=0,
    foot_L=(0.11, -0.10, 0), foot_R=(-0.11, -0.10, 0), toe_L=8, toe_R=-8, heel_L=0, heel_R=0,
    free_L=0, free_R=0, point_L=0, point_R=0, knee_L=(0.15, -1, 0), knee_R=(-0.15, -1, 0),
    fist_L=0.25, fist_R=0.25, shrug_L=(0, 0), shrug_R=(0, 0),
)


def rx(a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def ry(a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rz(a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def euler(pyr, k=1.0):
    p, y, r = pyr
    return rz(y * k) @ ry(r * k) @ rx(p * k)


def axis_rot(axis, deg):
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + s * K + (1 - c) * (K @ K)


def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else np.array([0.0, 0.0, 1.0])


def frame(a, b):
    """orthonormal frame whose first axis is a and whose second is b made perpendicular to it (columns)"""
    a = unit(a)
    b = unit(b - a * np.dot(a, b))
    return np.stack([a, b, np.cross(a, b)], 1)


def to_quat(m):
    t = np.trace(m)
    if t > 0:
        s = math.sqrt(t + 1) * 2
        q = [0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s]
    else:
        i = int(np.argmax(np.diag(m)))
        j, k = (i + 1) % 3, (i + 2) % 3
        s = math.sqrt(max(1e-12, 1 + m[i, i] - m[j, j] - m[k, k])) * 2
        q = [0, 0, 0, 0]
        q[0] = (m[k, j] - m[j, k]) / s
        q[1 + i] = 0.25 * s
        q[1 + j] = (m[j, i] + m[i, j]) / s
        q[1 + k] = (m[k, i] + m[i, k]) / s
    return np.array(q)


def quat_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def slerp_mat(a, b, t):
    qa, qb = to_quat(a), to_quat(b)
    if np.dot(qa, qb) < 0:
        qb = -qb
    d = min(1.0, float(np.dot(qa, qb)))
    th = math.acos(d)
    if th < 1e-5:
        return a
    q = (math.sin((1 - t) * th) * qa + math.sin(t * th) * qb) / math.sin(th)
    return quat_mat(q / np.linalg.norm(q))


def twist_about(m, axis):
    """the part of rotation m that turns about axis (swing-twist), as degrees"""
    q = to_quat(m)
    a = unit(axis)
    p = np.dot(q[1:], a)
    return math.degrees(2 * math.atan2(p, q[0]))


FOOT_FWD = np.array([[0.0, 0, -1], [-1, 0, 0], [0, 1, 0]])   # frame((0,-1,0), (0,0,1)): a foot pointing straight ahead
SPINE = (('spine05', 0.10), ('spine04', 0.15), ('spine03', 0.25), ('spine02', 0.25), ('spine01', 0.25))
NECK = (('neck01', 0.2), ('neck02', 0.4), ('neck03', 0.6), ('head', 1.0))
FINGERS = [f'finger{f}-{s}' for f in (2, 3, 4, 5) for s in (1, 2, 3)]
CURL = {1: 78, 2: 98, 3: 72}
THUMB = {1: 28, 2: 30, 3: 55}


class Rig:
    def __init__(self, R):
        self.R = R
        self.head = {b: v[0] for b, v in R.items()}
        self.M = {b: v[2] for b, v in R.items()}
        self.parent = {b: v[3] for b, v in R.items()}
        self.scale = self.head['root'][2] / REF_HIP
        self.order = []
        todo = list(R)
        while todo:  # parents before children
            for b in list(todo):
                if self.parent[b] is None or self.parent[b] in self.order:
                    self.order.append(b)
                    todo.remove(b)
        self.limb = {}
        for sd in 'LR':
            h = self.head
            sh, el, wr = h[f'upperarm01.{sd}'], h[f'lowerarm01.{sd}'], h[f'wrist.{sd}']
            hp, kn, an = h[f'upperleg01.{sd}'], h[f'lowerleg01.{sd}'], h[f'foot.{sd}']
            fwd0 = unit(h[f'finger3-1.{sd}'] - wr)
            palm0 = np.cross(fwd0, h[f'finger1-1.{sd}'] - wr) * (1 if sd == 'L' else -1)
            ball = R[f'foot.{sd}'][1]
            toe0 = unit([ball[0] - an[0], ball[1] - an[1], 0])
            self.limb[sd] = dict(
                arm=(np.linalg.norm(el - sh), np.linalg.norm(wr - el), unit(el - sh), unit(wr - el)),
                leg=(np.linalg.norm(kn - hp), np.linalg.norm(an - kn), unit(kn - hp), unit(an - kn)),
                hand0=frame(fwd0, palm0), ball=ball, ankle=an, foot0=frame(toe0, [0, 0, 1]),
                shin0=unit(an - kn))

    def ik(self, root, target, l1, l2, pole):
        d = target - root
        dist = float(np.linalg.norm(d))
        dist = min(max(dist, abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995)
        dirn = unit(d)
        a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
        h = math.sqrt(max(l1 * l1 - a * a, 0))
        pn = unit(np.asarray(pole, float) - dirn * np.dot(pole, dirn))
        mid = root + dirn * a + pn * h
        return mid, root + dirn * dist

    def solve(self, c):
        """controls -> ({bone: local 3x3 rotation}, root offset in armature space, {bone: world head position})"""
        s = self.scale
        h, M, par = self.head, self.M, self.parent
        D = {}
        root_pos = h['root'] + np.asarray(c['hips'], float) * s
        D['root'] = euler(c['hip_rot'])
        prev = D['root']
        for b, w in SPINE:
            prev = D[b] = prev @ euler(c['spine'], w)
        chest = prev
        Hd = euler(c['head'])
        for b, w in NECK:
            D[b] = slerp_mat(chest, Hd, w)
        for sd, sg in (('L', 1), ('R', -1)):
            up, fw = c[f'shrug_{sd}']
            D[f'clavicle.{sd}'] = chest @ rz(-sg * fw) @ ry(-sg * up)
        # world positions so far (needed for the limb roots)
        pos = {}

        def place(b):
            p = par[b]
            if p is None:
                pos[b] = root_pos
            else:
                if p not in pos:
                    place(p)
                pos[b] = pos[p] + D.get(p, self._inherit(D, p)) @ (h[b] - h[p])
            return pos[b]

        for sd, sg in (('L', 1), ('R', -1)):
            L = self.limb[sd]
            # ---- arm
            l1, l2, u0, f0 = L['arm']
            S = place(f'upperarm01.{sd}')
            tgt = np.asarray(c[f'hand_{sd}'], float).copy()
            aim = c[f'aim_{sd}']
            tgt = tgt * s
            tgt[2] = tgt[2] / s * (s * (1 - aim) + (0.4 * s + 0.6) * aim)
            E, W = self.ik(S, tgt, l1, l2, c[f'elbow_{sd}'])
            u, f = unit(E - S), unit(W - E)
            hinge0 = unit(np.cross(u0, f0))
            hinge = np.cross(u, f)
            hinge = unit(hinge) if np.linalg.norm(hinge) > 1e-4 else unit(np.cross(u, np.asarray(c[f'elbow_{sd}'], float)))
            Du = frame(u, hinge) @ frame(u0, hinge0).T
            Df = frame(f, hinge) @ frame(f0, hinge0).T
            med = chest @ np.array([-sg, 0.0, 0.0])
            m = med - f * np.dot(med, f)
            m = unit(m) if np.linalg.norm(m) > 0.05 else unit(chest @ np.array([0.0, 0, 1]) - f * np.dot(chest @ np.array([0.0, 0, 1]), f))
            dwn = np.cross(f, m) * sg
            pr = math.radians(c[f'pron_{sd}'])
            palm = math.cos(pr) * m + math.sin(pr) * dwn
            ex = math.radians(c[f'wrist_{sd}'])
            fwd = math.cos(ex) * f - math.sin(ex) * palm
            Dh = frame(fwd, math.cos(ex) * palm + math.sin(ex) * f) @ L['hand0'].T
            tw = twist_about(Df.T @ Dh, f0)
            D[f'upperarm01.{sd}'] = D[f'upperarm02.{sd}'] = Du
            D[f'lowerarm01.{sd}'] = Df @ axis_rot(f0, tw * 0.2)
            D[f'lowerarm02.{sd}'] = Df @ axis_rot(f0, tw * 0.6)
            D[f'wrist.{sd}'] = Dh
            palm0 = L['hand0'][:, 1]
            curl = c[f'fist_{sd}']
            for fb in FINGERS + ['finger1-1', 'finger1-2', 'finger1-3']:
                b = f'{fb}.{sd}'
                d0 = unit(self.R[b][1] - h[b])
                seg = int(fb[-1])
                ang = (THUMB if fb.startswith('finger1') else CURL)[seg] * curl
                pb = par[b]
                D[b] = D.get(pb, Dh) @ axis_rot(np.cross(d0, palm0), ang)
            # ---- leg
            l1, l2, u0, f0 = L['leg']
            Hp = place(f'upperleg01.{sd}')
            yaw, heel, free = c[f'toe_{sd}'], c[f'heel_{sd}'], c[f'free_{sd}']
            flat = rz(yaw) @ FOOT_FWD @ L['foot0'].T
            planted = rz(yaw) @ rx(heel) @ FOOT_FWD @ L['foot0'].T   # heel up: the foot tips forward about the ball
            ball = np.asarray(c[f'foot_{sd}'], float) * s + np.array([0, 0, L['ball'][2]])
            ankle = ball + planted @ (L['ankle'] - L['ball'])
            K, A = self.ik(Hp, ankle, l1, l2, c[f'knee_{sd}'])
            u, f = unit(K - Hp), unit(A - K)
            hinge0 = unit(np.cross(u0, f0))
            hinge = np.cross(u, f)
            hinge = unit(hinge) if np.linalg.norm(hinge) > 1e-4 else unit(np.cross(u, np.asarray(c[f'knee_{sd}'], float)))
            Dt = frame(u, hinge) @ frame(u0, hinge0).T
            Ds = frame(f, hinge) @ frame(f0, hinge0).T
            D[f'upperleg01.{sd}'] = D[f'upperleg02.{sd}'] = Dt
            D[f'lowerleg01.{sd}'] = D[f'lowerleg02.{sd}'] = Ds
            loose = Ds @ axis_rot(hinge0, c[f'point_{sd}'])
            Dfoot = slerp_mat(planted, loose, free) if free > 0 else planted
            D[f'foot.{sd}'] = Dfoot
            D[f'toe1-1.{sd}'] = slerp_mat(flat, Dfoot, free) if heel > 0 else Dfoot
        local = {}
        for b in self.order:
            if b not in D:
                continue
            p = par[b]
            Dp = self._inherit(D, p) if p is not None else np.eye(3)
            local[b] = M[b].T @ Dp.T @ D[b] @ M[b]
        for b in self.order:
            place(b)
        return local, (root_pos - h['root']), pos

    def _inherit(self, D, b):
        while b is not None and b not in D:
            b = self.parent[b]
        return D[b] if b is not None else np.eye(3)


# ---------------------------------------------------------------- timelines
def ease(t, kind):
    if kind == 'lin':
        return t
    if kind == 'in':      # slow start: wind-ups releasing
        return t * t
    if kind == 'out':     # fast start, soft landing: recoveries
        return 1 - (1 - t) ** 2
    if kind == 'snap':    # strikes: nearly all the travel in the first third
        return 1 - (1 - t) ** 3.2
    if kind == 'heavy':   # a weighty settle
        return 1 - (1 - t) ** 4 if t > 0 else 0
    return t * t * (3 - 2 * t)   # 'io'


def timeline(base, keys, fps=30, loop=False):
    """keys: [(time s, {control: value}, ease into this key)]. Unlisted controls hold the base pose's value
    (not the previous key's), so every key reads as 'the base pose, except...'. Returns one controls dict per frame."""
    full = []
    for t, over, e in keys:
        p = dict(base)
        p.update(over)
        full.append((t, {k: np.asarray(v, float) for k, v in p.items()}, e))
    dur = full[-1][0]
    n = max(1, int(round(dur * fps)))
    frames = []
    for i in range(n + (0 if loop else 1)):
        t = i / fps
        j = max(k for k in range(len(full)) if full[k][0] <= t + 1e-6)
        if j >= len(full) - 1:
            frames.append({k: v.copy() for k, v in full[-1][1].items()})
            continue
        (t0, a, _), (t1, b, e) = full[j], full[j + 1]
        w = ease((t - t0) / (t1 - t0), e)
        frames.append({k: a[k] * (1 - w) + b[k] * w for k in a})
    return frames


def soften(frames, passes=1, loop=False):
    """a light blur over time: takes the corners off linear key-to-key motion without moving the keys much"""
    for _ in range(passes):
        out = []
        n = len(frames)
        for i in range(n):
            a = frames[(i - 1) % n] if loop else frames[max(i - 1, 0)]
            b = frames[(i + 1) % n] if loop else frames[min(i + 1, n - 1)]
            out.append({k: 0.25 * a[k] + 0.5 * frames[i][k] + 0.25 * b[k] for k in frames[i]})
        frames = out
    return frames
