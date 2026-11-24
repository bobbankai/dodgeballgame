"""Motion capture: CMU ASF/AMC import and retargeting onto the Tidebreakers humanoid rig.

Pipeline (per clip):
  parse      ASF skeleton (directions, lengths, axis frames, dofs, hierarchy) and AMC frames (120 fps)
  FK         world-space rotation delta from the rest (T) pose for every CMU segment, and joint positions
             (the standard ASF/AMC convention: R_b = R_parent . C . M(dofs) . C^-1)
  normalise  resample to 30 fps, turn the clip to face -Y on average, scale root motion by leg length,
             optionally strip travel (in-place cycles) or recentre (acting clips)
  retarget   each of our bones takes the world delta of its CMU segment applied on top of its own rest
             orientation, after a per-bone alignment that turns our A-pose rest onto the CMU T-pose rest;
             local (basis) rotations come out analytically from the armature-space orientations
  loop       for cycles, pick the segment whose end pose best matches its start and crossfade the seam
  feet       contact frames (low and slow feet) are pinned with two-bone IK against our leg lengths
The output is a list of per-frame {bone: quaternion} plus a hips location, written straight into fcurves.
"""
import math
import os
import numpy as np

UNIT = (1.0 / 0.45) * 0.0254          # ASF length units -> metres
T = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)   # CMU (x, y, z) -> Blender (x, -z, y)
TI = T.T


# ------------------------------------------------------------------------------------------ math
def euler(ax, ay, az, order='XYZ'):
    """Rotation matrix for angles in degrees applied in `order` (static axes, ASF convention)."""
    rx, ry, rz = np.radians([ax, ay, az])
    X = np.array([[1, 0, 0], [0, math.cos(rx), -math.sin(rx)], [0, math.sin(rx), math.cos(rx)]])
    Y = np.array([[math.cos(ry), 0, math.sin(ry)], [0, 1, 0], [-math.sin(ry), 0, math.cos(ry)]])
    Z = np.array([[math.cos(rz), -math.sin(rz), 0], [math.sin(rz), math.cos(rz), 0], [0, 0, 1]])
    M = {'X': X, 'Y': Y, 'Z': Z}
    R = np.eye(3)
    for a in order:              # first axis applied first (static frame): R = A3 A2 A1
        R = M[a] @ R
    return R


def axis_angle(ax, a):
    """Rotation matrix of angle `a` (radians) about the unit axis `ax` (right-handed)."""
    x, y, z = ax
    c, s, C = math.cos(a), math.sin(a), 1 - math.cos(a)
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def arc(u, v):
    """Minimal rotation taking unit vector u onto v."""
    u = u / np.linalg.norm(u)
    v = v / np.linalg.norm(v)
    c = float(np.dot(u, v))
    w = np.cross(u, v)
    s = np.linalg.norm(w)
    if s < 1e-8:
        if c > 0:
            return np.eye(3)
        p = np.array([1.0, 0, 0]) if abs(u[0]) < 0.9 else np.array([0, 1.0, 0])
        a = np.cross(u, p)
        a /= np.linalg.norm(a)
        return 2 * np.outer(a, a) - np.eye(3)
    k = w / s
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    ang = math.atan2(s, c)
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K


def mat_to_quat(m):
    t = np.trace(m)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        return np.array([0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s])
    i = int(np.argmax([m[0, 0], m[1, 1], m[2, 2]]))
    if i == 0:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        return np.array([(m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s])
    if i == 1:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        return np.array([(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s])
    s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
    return np.array([(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s])


def quat_to_mat(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def slerp(a, b, t):
    if np.dot(a, b) < 0:
        b = -b
    d = float(np.clip(np.dot(a, b), -1, 1))
    if d > 0.9995:
        r = a + (b - a) * t
        return r / np.linalg.norm(r)
    th = math.acos(d)
    return (math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th)


# ------------------------------------------------------------------------------------------ ASF / AMC
class ASF:
    def __init__(self, path):
        self.bones = {}
        self.children = {}
        self.root_order = ['TX', 'TY', 'TZ', 'RX', 'RY', 'RZ']
        self.root_axis = 'XYZ'
        sec = None
        cur = None
        for raw in open(path, encoding='latin-1'):
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith(':'):
                sec = line.split()[0]
                continue
            tok = line.split()
            if sec == ':root':
                if tok[0] == 'order':
                    self.root_order = [t.upper() for t in tok[1:]]
                elif tok[0] == 'axis':
                    self.root_axis = tok[1].upper()
            elif sec == ':bonedata':
                if tok[0] == 'begin':
                    cur = {'dof': [], 'axis': np.zeros(3), 'order': 'XYZ', 'dir': np.zeros(3), 'len': 0.0}
                elif tok[0] == 'end':
                    self.bones[cur['name']] = cur
                elif tok[0] == 'name':
                    cur['name'] = tok[1]
                elif tok[0] == 'direction':
                    cur['dir'] = np.array([float(x) for x in tok[1:4]])
                elif tok[0] == 'length':
                    cur['len'] = float(tok[1]) * UNIT
                elif tok[0] == 'axis':
                    cur['axis'] = np.array([float(x) for x in tok[1:4]])
                    cur['order'] = tok[4].upper()
                elif tok[0] == 'dof':
                    cur['dof'] = [t.lower() for t in tok[1:]]
            elif sec == ':hierarchy':
                if tok[0] in ('begin', 'end'):
                    continue
                self.children[tok[0]] = tok[1:]
        self.parent = {c: p for p, cs in self.children.items() for c in cs}
        for b in self.bones.values():
            C = euler(*b['axis'], order=b['order'])
            b['C'] = C
            b['Ci'] = C.T
        # traversal order (parents first)
        self.order = []
        stack = ['root']
        while stack:
            n = stack.pop(0)
            if n != 'root':
                self.order.append(n)
            stack.extend(self.children.get(n, []))


def read_amc(path):
    frames = []
    cur = None
    for raw in open(path, encoding='latin-1'):
        line = raw.strip()
        if not line or line.startswith('#') or line.startswith(':'):
            continue
        tok = line.split()
        if tok[0].isdigit() and len(tok) == 1:
            cur = {}
            frames.append(cur)
            continue
        if cur is not None:
            cur[tok[0]] = [float(x) for x in tok[1:]]
    return frames


def fk(asf, fr):
    """World rotation deltas R[b] (CMU frame) and joint end positions P[b] (metres) for one AMC frame."""
    vals = fr.get('root', [0] * 6)
    pos = np.zeros(3)
    rot = [0.0, 0.0, 0.0]
    for i, ch in enumerate(asf.root_order):
        if ch.startswith('T'):
            pos['XYZ'.index(ch[1])] = vals[i] * UNIT
        else:
            rot['XYZ'.index(ch[1])] = vals[i]
    R = {'root': euler(*rot, order=asf.root_axis)}
    P = {'root': pos}
    for b in asf.order:
        bd = asf.bones[b]
        p = asf.parent[b]
        ang = [0.0, 0.0, 0.0]
        v = fr.get(b, [])
        for i, d in enumerate(bd['dof']):
            if i < len(v):
                ang['xyz'.index(d[1])] = v[i]
        M = euler(*ang, order='XYZ')
        R[b] = R[p] @ bd['C'] @ M @ bd['Ci']
        P[b] = P[p] + R[b] @ (bd['dir'] * bd['len'])
    return R, P


# ------------------------------------------------------------------------------------------ mapping
MAP = {
    'hips': 'root', 'spine': 'upperback', 'chest': 'thorax', 'neck': 'upperneck', 'head': 'head',
    'shoulder.L': 'lclavicle', 'upperarm.L': 'lhumerus', 'forearm.L': 'lradius', 'hand.L': 'lhand',
    'shoulder.R': 'rclavicle', 'upperarm.R': 'rhumerus', 'forearm.R': 'rradius', 'hand.R': 'rhand',
    'thigh.L': 'lfemur', 'shin.L': 'ltibia', 'foot.L': 'lfoot', 'toe.L': 'ltoes',
    'thigh.R': 'rfemur', 'shin.R': 'rtibia', 'foot.R': 'rfoot', 'toe.R': 'rtoes',
}
# how much of a CMU segment's motion each of our bones takes (spine: lower back folded in)
CHAIN = {'spine': [('lowerback', 0.5), ('upperback', 0.5)], 'neck': [('lowerneck', 0.5), ('upperneck', 0.5)]}


class Rig:
    """Rest data of our armature (armature space, Blender)."""

    def __init__(self, arm_ob):
        self.names = [b.name for b in arm_ob.data.bones]
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in arm_ob.data.bones}
        self.R = {b.name: np.array(b.matrix_local.to_3x3()) for b in arm_ob.data.bones}
        self.head = {b.name: np.array(b.head_local) for b in arm_ob.data.bones}
        self.tail = {b.name: np.array(b.tail_local) for b in arm_ob.data.bones}
        self.order = []
        todo = [b.name for b in arm_ob.data.bones if not b.parent]
        while todo:
            n = todo.pop(0)
            self.order.append(n)
            todo.extend(c.name for c in arm_ob.data.bones[n].children)

    def dir(self, n):
        d = self.tail[n] - self.head[n]
        return d / np.linalg.norm(d)


class Clip:
    def __init__(self, name, frames, hips, speed=0.0, loop=False):
        self.name, self.frames, self.hips, self.speed, self.loop = name, frames, hips, speed, loop


def load(asf_path, amc_path, start=0, end=None, step=4):
    asf = ASF(asf_path)
    amc = read_amc(amc_path)[start:end:step]
    return asf, [fk(asf, f) for f in amc]


def retarget(rig, asf, poses, name, inplace=False, loop=False, recenter=True, face=None, fingers=None, smooth=1, head_up=0.0,
             gaze=None):
    """poses: list of (R, P) in CMU space. Returns Clip with per-frame basis quaternions.
    gaze=(pitch, keep[, yaw_keep]): re-aims the head so its pitch averages `pitch` degrees (+ up) over the clip,
    keeping `keep` of the performer's own nods around that average (applied after head_up); yaw_keep likewise
    keeps that share of the head's turning left and right of the chest (an idle performer looks about a lot,
    which in a close-up reads as an actor turning away from the lens)."""
    # rest pose of the CMU skeleton (all dofs zero) for directions and leg length
    R0, P0 = fk(asf, {})
    floor0 = min(P0['ltoes'][1], P0['rtoes'][1], P0['lfoot'][1], P0['rfoot'][1])
    cmu_hip_h = -floor0
    our_hip_h = rig.head['hips'][2]
    k = our_hip_h / cmu_hip_h
    # heading: average facing of the root over the clip (CMU +z is forward)
    if face is None:
        fs = np.array([R['root'] @ np.array([0, 0, 1.0]) for R, _ in poses])
        f = fs.mean(0)
        face = math.atan2(f[0], f[2])
    H = euler(0, -math.degrees(face), 0)
    # alignment of our rest onto the CMU rest (per bone, Blender space)
    A = {}
    for ours, cmu in MAP.items():
        if ours not in rig.R:
            continue
        if cmu == 'root':
            A[ours] = np.eye(3)
            continue
        u_cmu = T @ asf.bones[cmu]['dir']
        A[ours] = arc(rig.dir(ours), u_cmu)
    n = len(poses)
    world = []
    root_pos = []
    for R, P in poses:
        Rw = {}
        for ours, cmu in MAP.items():
            if ours not in rig.R:
                continue
            if ours in CHAIN:
                q = np.array([1.0, 0, 0, 0])
                acc = None
                for seg, wgt in CHAIN[ours]:
                    qq = mat_to_quat(T @ H @ R[seg] @ TI)
                    acc = qq if acc is None else slerp(acc, qq, wgt)
                D = quat_to_mat(acc if acc is not None else q)
            else:
                D = T @ H @ R[cmu] @ TI
            Rw[ours] = D @ A[ours] @ rig.R[ours]
        # captured performers often look at the floor: lift the gaze (half at the neck, all of it at the head)
        if head_up:
            for b, k in (('neck', 0.5), ('head', 1.0)):
                if b in Rw:
                    Rw[b] = euler(-head_up * k, 0, 0) @ Rw[b]
        world.append(Rw)
        root_pos.append(T @ H @ P['root'] * k)
    if gaze and 'head' in rig.R:
        # the head's facing (rest facing is -Y) and its pitch in every frame
        fwd = [Rw['head'] @ rig.R['head'].T @ np.array([0, -1.0, 0]) for Rw in world]
        pitch = np.degrees(np.arcsin(np.clip([f[2] for f in fwd], -1, 1)))
        target = gaze[0] + (pitch - pitch.mean()) * gaze[1]
        for Rw, f, p0, p1 in zip(world, fwd, pitch, target):
            ax = np.cross(f, np.array([0, 0, 1.0]))
            if np.linalg.norm(ax) < 1e-6:
                continue
            ax /= np.linalg.norm(ax)
            for b, share in (('neck', 0.4), ('head', 1.0)):
                if b in Rw:
                    Rw[b] = axis_angle(ax, math.radians((p1 - p0) * share)) @ Rw[b]
        if len(gaze) > 2 and 'chest' in rig.R:
            def yaw_of(Rw, b):
                f = Rw[b] @ rig.R[b].T @ np.array([0, -1.0, 0])
                return math.atan2(f[0], -f[1])
            rel = np.array([math.atan2(math.sin(yaw_of(Rw, 'head') - yaw_of(Rw, 'chest')), math.cos(yaw_of(Rw, 'head') - yaw_of(Rw, 'chest')))
                            for Rw in world])
            want = (rel - rel.mean()) * gaze[2]   # (centred: on average the head faces where the chest does)
            up = np.array([0, 0, 1.0])
            for Rw, r0, r1 in zip(world, rel, want):
                for b, share in (('neck', 0.4), ('head', 1.0)):
                    if b in Rw:
                        Rw[b] = axis_angle(up, (r1 - r0) * share) @ Rw[b]
    root_pos = np.array(root_pos)
    # the clip's floor: where the feet actually are (low percentile of the lowest foot joint)
    feet = np.array([min(P['ltoes'][1], P['rtoes'][1], P['lfoot'][1], P['rfoot'][1]) for _, P in poses])
    floor = float(np.percentile(feet, 3)) * k
    base = np.array([0, 0, 0.0])
    speed = 0.0
    t = np.arange(n)
    if inplace:
        slopes = []
        for ax in (0, 1):
            c = np.polyfit(t, root_pos[:, ax], 1)
            slopes.append(c[0])
            root_pos[:, ax] -= np.polyval(c, t)
        speed = float(np.hypot(*slopes)) * 30.0
    elif recenter:
        root_pos[:, 0] -= root_pos[0, 0]
        root_pos[:, 1] -= root_pos[0, 1]
    # vertical: height of the CMU root above its floor, scaled, relative to our rest hips height
    root_pos[:, 2] = (root_pos[:, 2] - floor) - our_hip_h
    hips_off = root_pos + base
    # local (basis) rotations, parents first; bones we don't drive keep their rest relative to the parent
    frames = []
    for i in range(n):
        Rw = world[i]
        Ra = {}
        out = {}
        for b in rig.order:
            p = rig.parent[b]
            Rr = rig.R[b]
            if b in Rw:
                Ra[b] = Rw[b]
            elif p is None:
                Ra[b] = Rr
            elif fingers and b in fingers:
                # hand-keyed finger pose (basis rotation), carried by the captured hand
                Ra[b] = Ra[p] @ rig.R[p].T @ Rr @ quat_to_mat(fingers[b])
            else:
                Ra[b] = Ra[p] @ rig.R[p].T @ Rr
            Rpr = rig.R[p] if p else np.eye(3)
            Rpa = Ra[p] if p else np.eye(3)
            Rb = Rr.T @ Rpr @ Rpa.T @ Ra[b]
            out[b] = mat_to_quat(Rb)
        frames.append(out)
    # temporal smoothing of the quaternions (light, keeps contacts)
    if smooth:
        for _ in range(smooth):
            sm = []
            for i in range(n):
                a, b_, c = frames[max(0, i - 1)], frames[i], frames[min(n - 1, i + 1)]
                sm.append({k_: slerp(slerp(a[k_], c[k_], 0.5), b_[k_], 0.5) for k_ in b_})
            frames = sm
    hips_loc = []
    for i in range(n):
        # basis location of hips in its rest frame (parent 'root' is unposed)
        d = hips_off[i]
        hips_loc.append(rig.R['hips'].T @ d)
    clip = Clip(name, frames, np.array(hips_loc), speed=speed, loop=loop)
    if loop:
        make_loop(clip)
    return clip


def pose_distance(a, b):
    s = 0.0
    for k in ('thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'upperarm.L', 'upperarm.R', 'hips', 'spine'):
        if k in a:
            s += 1 - abs(float(np.dot(a[k], b[k])))
    return s


def find_cycle(clip, min_len=20, max_len=48):
    """Best loop [i, j) in frames: pose at j close to pose at i."""
    f = clip.frames
    n = len(f)
    best = (1e9, 0, min(n, max_len))
    for i in range(0, max(1, n - min_len), 2):
        for j in range(i + min_len, min(n, i + max_len)):
            d = pose_distance(f[i], f[j]) + 0.5 * np.linalg.norm(clip.hips[i] - clip.hips[j])
            if d < best[0]:
                best = (d, i, j)
    return best


def trim(clip, i, j):
    clip.frames = clip.frames[i:j]
    clip.hips = clip.hips[i:j]


def make_loop(clip, blend=6):
    """Crossfade the last `blend` frames toward the first ones so the cycle joins seamlessly."""
    n = len(clip.frames)
    if n < blend * 2:
        return
    first = clip.frames[0]
    for k in range(blend):
        i = n - blend + k
        t = (k + 1) / (blend + 1)
        t = t * t * (3 - 2 * t)
        clip.frames[i] = {b: slerp(q, first[b], t) for b, q in clip.frames[i].items()}
        clip.hips[i] = clip.hips[i] * (1 - t) + clip.hips[0] * t


def fetch(subject, trial, cache):
    """Download a CMU subject's ASF and a trial's AMC into `cache` (once)."""
    import urllib.request
    os.makedirs(cache, exist_ok=True)
    s = f'{subject:02d}'
    asf = os.path.join(cache, f'{s}.asf')
    amc = os.path.join(cache, f'{s}_{trial:02d}.amc')
    for path, url in ((asf, f'http://mocap.cs.cmu.edu/subjects/{s}/{s}.asf'), (amc, f'http://mocap.cs.cmu.edu/subjects/{s}/{s}_{trial:02d}.amc')):
        if not os.path.exists(path) or os.path.getsize(path) < 100:
            urllib.request.urlretrieve(url, path)
    return asf, amc


def write_action(arm_ob, clip, action_name=None):
    """Writes the clip into a new action on arm_ob (quaternion rotation for every bone, hips location)."""
    import bpy
    act = bpy.data.actions.new(action_name or clip.name)
    act.use_fake_user = True
    arm_ob.animation_data_create()
    arm_ob.animation_data.action = act
    try:                                   # Blender 4.4+: layered actions
        slot = act.slots.new('OBJECT', arm_ob.name)
        arm_ob.animation_data.action_slot = slot
        strip = act.layers.new('Layer').strips.new(type='KEYFRAME')
        bag = strip.channelbag(slot, ensure=True)
        new_fc = lambda path, i, grp: bag.fcurves.new(path, index=i, group_name=grp)  # noqa
    except AttributeError:
        new_fc = lambda path, i, grp: act.fcurves.new(path, index=i, action_group=grp)  # noqa
    n = len(clip.frames)
    for pb in arm_ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    for b in clip.frames[0]:
        pb = arm_ob.pose.bones.get(b)
        if pb is None:
            continue
        path = f'pose.bones["{b}"].rotation_quaternion'
        qs = np.array([clip.frames[i][b] for i in range(n)])
        # keep quaternion signs continuous
        for i in range(1, n):
            if np.dot(qs[i], qs[i - 1]) < 0:
                qs[i] = -qs[i]
        for c in range(4):
            fc = new_fc(path, c, b)
            fc.keyframe_points.add(n)
            co = np.empty(n * 2)
            co[0::2] = np.arange(1, n + 1)
            co[1::2] = qs[:, c]
            fc.keyframe_points.foreach_set('co', co)
            fc.update()
    path = 'pose.bones["hips"].location'
    for c in range(3):
        fc = new_fc(path, c, 'hips')
        fc.keyframe_points.add(n)
        co = np.empty(n * 2)
        co[0::2] = np.arange(1, n + 1)
        co[1::2] = clip.hips[:, c]
        fc.keyframe_points.foreach_set('co', co)
        fc.update()
    act.frame_range = (1, n)
    return act
