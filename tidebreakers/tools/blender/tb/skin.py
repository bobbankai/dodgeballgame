"""Skin weights from the sculpt itself (pure numpy).

Each body Part belongs to a bone. For a vertex, every part's distance is measured; weights are a softmin
over those distances (parts the vertex lies on dominate, neighbours blend in across the joint), restricted
to the nearest bone's relatives so a thigh never pulls the other thigh and fingers never pull each other.
Garment vertices use the same parts, so clothing deforms exactly like the skin beneath it.
"""
import numpy as np

TAU = {'finger': 0.0055, 'hand': 0.011, 'default': 0.02, 'head': 0.012, 'neck': 0.018}


def _tau(bone):
    b = bone.split('.')[0]
    if b[:-1] in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        return TAU['finger']
    if b == 'hand':
        return TAU['hand']
    if b in ('head', 'neck'):
        return TAU[b]
    return TAU['default']


def _smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def torso_split(skel, V):
    """Weights of the torso loft over hips / spine / chest / neck by height along the spine."""
    zs = skel.head_of('spine')[2]
    zc = skel.head_of('chest')[2]
    zn = skel.head_of('neck')[2]
    z = V[:, 2]
    wc = _smooth(z, zc - 0.07, zc + 0.05)
    wh = 1 - _smooth(z, zs - 0.06, zs + 0.05)
    wn = _smooth(z, zn - 0.015, zn + 0.035)
    wc = wc * (1 - wn)
    ws = np.clip(1 - wh - wc - wn, 0, 1)
    return {'hips': wh, 'spine': ws, 'chest': wc, 'neck': wn}


def body_weights(skel, parts, V, max_inf=4):
    """Returns (bone_names, W (N, B)) for vertices V near the body."""
    bones = skel.deform_names()
    bi = {b: i for i, b in enumerate(bones)}
    N = len(V)
    D = np.full((N, len(parts)), 1e3)
    for k, p in enumerate(parts):
        f = p.field
        bd = np.sqrt((np.maximum(f.lo - V, 0) ** 2 + np.maximum(V - f.hi, 0) ** 2).sum(1))
        sel = bd < 0.12
        if sel.any():
            idx = np.nonzero(sel)[0]
            D[idx, k] = f.eval(V[idx])
    dmin = D.min(1)
    near = D.argmin(1)
    W = np.zeros((N, len(bones)))
    tsplit = torso_split(skel, V)
    part_bone = [p.bone for p in parts]
    for k, p in enumerate(parts):
        tau = _tau(p.bone if p.bone != 'torso' else 'spine')
        w = np.exp(-np.maximum(D[:, k] - dmin, 0) / tau)
        w[D[:, k] - dmin > 5 * tau] = 0
        if p.bone == 'torso':
            for b, f in tsplit.items():
                W[:, bi[b]] += w * f
        else:
            W[:, bi[p.bone]] += w
    # restrict to the nearest bone's family
    allowed = np.zeros_like(W, bool)
    fam_cache = {}
    for k in np.unique(near):
        b = part_bone[k]
        if b == 'torso':
            fam = {'hips', 'spine', 'chest', 'neck', 'shoulder.L', 'shoulder.R', 'upperarm.L', 'upperarm.R', 'thigh.L', 'thigh.R'}
        else:
            if b not in fam_cache:
                fam = set(skel.relatives(b))
                # the torso loft's bones are always family of anything attached to the trunk
                if b.split('.')[0] in ('thigh', 'shoulder', 'upperarm', 'neck', 'hips', 'spine', 'chest'):
                    fam |= {'hips', 'spine', 'chest'}
                fam_cache[b] = fam
            fam = fam_cache[b]
        rows = near == k
        for f in fam:
            if f in bi:
                allowed[rows, bi[f]] = True
    W = W * allowed
    return bones, _finish(W, max_inf)


def _finish(W, max_inf):
    if W.shape[1] > max_inf:
        idx = np.argsort(-W, axis=1)[:, max_inf:]
        np.put_along_axis(W, idx, 0, axis=1)
    s = W.sum(1, keepdims=True)
    W = np.where(s > 1e-9, W / np.maximum(s, 1e-9), 0)
    return W


def chain_weights(skel, chain, V, root_blend=0.03):
    """Weights along a bone chain (hair, tails): by projection onto the chain's segments, blending
    across segment boundaries; near the root, blend into the chain's parent bone."""
    bones = skel.deform_names()
    bi = {b: i for i, b in enumerate(bones)}
    W = np.zeros((len(V), len(bones)))
    heads = np.array([skel.head_of(b) for b in chain])
    tails = np.array([skel.tail_of(b) for b in chain])
    # arclength parameter along the chain for each vertex
    best = np.full(len(V), np.inf)
    s = np.zeros(len(V))
    acc = 0.0
    lens = np.linalg.norm(tails - heads, axis=1)
    starts = np.concatenate([[0], np.cumsum(lens)[:-1]])
    for i, (a, b) in enumerate(zip(heads, tails)):
        ab = b - a
        t = np.clip(((V - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        c = a + t[:, None] * ab
        d = np.linalg.norm(V - c, axis=1)
        m = d < best
        best = np.where(m, d, best)
        s = np.where(m, starts[i] + t * lens[i], s)
        acc += lens[i]
    # hat functions centred at each bone's midpoint
    mids = starts + lens * 0.5
    for i, b in enumerate(chain):
        lo = mids[i - 1] if i > 0 else -1e9
        hi = mids[i + 1] if i < len(chain) - 1 else 1e9
        w = np.where(s <= mids[i], np.clip((s - lo) / max(mids[i] - lo, 1e-6), 0, 1), np.clip((hi - s) / max(hi - mids[i], 1e-6), 0, 1))
        W[:, bi[b]] = w
    parent = skel.parent_of(chain[0])
    if parent and parent in bi:
        pr = np.clip(1 - s / root_blend, 0, 1)
        W[:, bi[parent]] += pr
        W[:, bi[chain[0]]] *= (1 - pr * 0.6)
    return bones, _finish(W, 4)


def rigid_weights(skel, bone, V):
    bones = skel.deform_names()
    W = np.zeros((len(V), len(bones)))
    W[:, bones.index(bone)] = 1
    return bones, W
