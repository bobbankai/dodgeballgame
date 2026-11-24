"""Runs a character through the production stages (see polychar.py for the stage list) and writes the
stage renders to docs/art/<name>/ so every asset ships with its visual evidence."""
import math
import os
import time
import json
import numpy as np
import bpy
from mathutils import Vector, Euler, Matrix, Quaternion
from . import sdf, skin, cage, polymodel as pm, polychar as pc, bl
from .sdf import Union, Intersect
from .character import build_armature, _set_uv, CLS, srgb, sdf_ao, vertex_normals


class Garment:
    """Extracted from the body topology and inflated onto `base` (its outer surface) where cut < 0."""

    def __init__(self, name, base, cut, color, cls='cloth', thickness=0.004, paint=None, covers=True,
                 relax=2, region=None, weights='body', snap=True, cover_margin=0.006, refine=True, folds=1.0, displace=None,
                 soft=2):
        self.name, self.base, self.cut, self.color, self.cls = name, base, cut, color, cls
        self.thickness, self.paint, self.covers, self.relax = thickness, paint, covers, relax
        self.region, self.weights, self.snap, self.cover_margin = region, weights, snap, cover_margin
        self.refine, self.folds = refine, folds
        # displace(V, N) -> offset along the surface normal per vertex (sculpted detail such as hair strands)
        self.displace = displace
        # extra weight smoothing passes: loose cloth bends over a wider band than the skin under it
        self.soft = soft


class Part:
    """A directly modelled piece (tube, quad sphere, bevelled box...)."""

    def __init__(self, name, V, F, color, cls='cloth', weights='body', paint=None, field=None, smooth=True, subdiv=0):
        self.name, self.V, self.F, self.color, self.cls = name, np.asarray(V, float), [tuple(f) for f in F], color, cls
        self.weights, self.paint, self.field, self.smooth, self.subdiv = weights, paint, field, smooth, subdiv


class Spec:
    def __init__(self, name, skel, body, skin_color, garments, parts, reference, skin_paint=None, subdiv=1,
                 lod_ratio=0.45, face=None):
        self.name, self.skel, self.body = name, skel, body
        self.skin_color, self.skin_paint = skin_color, skin_paint
        self.garments, self.parts, self.reference = garments, parts, reference
        self.subdiv, self.lod_ratio, self.face = subdiv, lod_ratio, face or {}


LOG = []


def log(msg):
    print('[pipe]', msg)
    LOG.append(msg)


def _color(c, V, N):
    if callable(c):
        return c(V, N)
    return np.tile(np.asarray(c, float), (len(V), 1))


# ------------------------------------------------------------------------------------------ stage 1

def write_reference(spec, art):
    r = spec.reference
    sk = spec.skel
    H = sk.s['height']
    heads = H / sk.s['head']
    lines = [f"# {r.get('title', spec.name)} — reference analysis", '',
             r.get('summary', ''), '',
             '## Proportions', '',
             '| measure | value |', '|---|---|',
             f'| height | {H:.2f} m ({heads:.1f} heads) |',
             f"| head (chin to crown) | {sk.s['head']:.3f} m |",
             f"| shoulder half-width | {sk.s['shoulder']:.3f} m |",
             f"| leg length (hip joint) | {sk.s['leg']:.3f} m ({sk.s['leg'] / H * 100:.0f}% of height) |",
             f"| arm (upper + fore + hand) | {sk.s['upperarm'] + sk.s['forearm'] + sk.s['hand']:.3f} m |", '',
             '## Silhouette and shape language', '']
    lines += [f'- {s}' for s in r.get('shapes', [])]
    lines += ['', '## Palette', '', '| part | colour |', '|---|---|']
    lines += [f'| {k} | `{v}` |' for k, v in r.get('palette', {}).items()]
    lines += ['', '## Animation notes', '']
    lines += [f'- {s}' for s in r.get('motion', [])]
    with open(os.path.join(art, 'reference.md'), 'w') as f:
        f.write('\n'.join(lines) + '\n')


# ------------------------------------------------------------------------------------------ renders

def _render(art, tag, target, dist, views=None, lens=60):
    bl.render_views(os.path.join(art, tag), target=target, dist=dist, views=views, lens=lens)


def _clear_objects(keep=()):
    for ob in list(bpy.data.objects):
        if ob.name not in keep:
            bpy.data.objects.remove(ob)


def _checker_object(name, V, F, c1=(0.75, 0.75, 0.78), c2=(0.45, 0.5, 0.62)):
    """Flat per-face checker colours show the quad flow / edge loops in a render."""
    V2 = np.concatenate([V[list(f)] for f in F])
    F2, i = [], 0
    for f in F:
        F2.append(tuple(range(i, i + len(f))))
        i += len(f)
    cols = []
    for k, f in enumerate(F):
        c = c1 if (k + (k // 7)) % 2 == 0 else c2
        cols += [c] * len(f)
    ob = bl.make_mesh(name, V2, np.array(F2, dtype=object) if len(set(len(f) for f in F2)) > 1 else np.array(F2), colors=np.array(cols), smooth=False)
    return ob


def _make(name, V, F, smooth=True):
    if len(set(len(f) for f in F)) == 1:
        return bl.make_mesh(name, V, np.array(F), smooth=smooth)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in V], [], [tuple(f) for f in F])
    me.update()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------------------------------------ build

# ------------------------------------------------------------------------------------------ garment refinement
def boundary_neighbours(F):
    """For each boundary vertex, its neighbours along boundary edges (edges used by one face)."""
    cnt = {}
    for f in F:
        for i in range(len(f)):
            e = tuple(sorted((f[i], f[(i + 1) % len(f)])))
            cnt[e] = cnt.get(e, 0) + 1
    nb = {}
    for (a, b), c in cnt.items():
        if c == 1:
            nb.setdefault(a, []).append(b)
            nb.setdefault(b, []).append(a)
    return nb


def smooth_hem(V, F, base, iters=4, amount=0.5):
    """Hems as clean curves: Laplacian smoothing along each boundary loop, re-projected onto the garment."""
    nb = boundary_neighbours(F)
    if not nb:
        return V
    idx = np.array(sorted(nb))
    V = V.copy()
    for _ in range(iters):
        avg = np.array([V[nb[i]].mean(0) for i in idx])
        V[idx] = V[idx] * (1 - amount) + avg * amount
        V[idx] = pm.project(base, V[idx], 2)
    return V


def hem_rings(F, nv, max_ring=5):
    """For each vertex, how many edge rings it sits from the mesh boundary (0 on a hem), capped."""
    nb = boundary_neighbours(F)
    ring = np.full(nv, max_ring + 1, int)
    if not nb:
        return ring
    adj = [[] for _ in range(nv)]
    for f in F:
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            adj[a].append(b)
            adj[b].append(a)
    front = list(nb)
    for i in front:
        ring[i] = 0
    for r in range(1, max_ring + 1):
        nxt = []
        for i in front:
            for j in adj[i]:
                if ring[j] > r:
                    ring[j] = r
                    nxt.append(j)
        front = nxt
    return ring


def trim_paint(col, ring):
    """Hems read as finished edges: a darker, richer piping on the outer two rings and a light stitch line
    just inside it."""
    col = col.copy()
    lum = col.mean(1, keepdims=True)
    rich = np.clip(lum + (col - lum) * 1.35, 0, 1) * 0.58
    pip = ring <= 2
    col[pip] = rich[pip]
    st = ring == 3
    col[st] = np.clip(col[st] * 1.22 + 0.04, 0, 1)
    return col


TRIM_SKIP = ('belt', 'sash', 'strap', 'band', 'wrap', 'glove', 'buckle', 'skin', 'haircap')


def neck_shadow(body, V, N):
    """Anime neck shadow: how deep each skin point lies in the shadow the jaw casts down the neck under a light
    from above and in front, as 0..1 with the shadow's edge on the 0.5 contour (so it stays crisp when the
    renderer interpolates it). Measured by marching toward the light and taking the head's nearest approach:
    negative when the ray passes through the head."""
    fa = body.face_anchor
    u = fa['u']
    head = body.head_field
    out = np.zeros(len(V))
    nz = body.sk.j['neck'][2]
    # the neck only: not the head itself (its own lighting shades the jaw), not the chest below
    sel = np.nonzero((head.eval(V) > 0.004 * u) & (V[:, 2] > nz - 0.05 * u) & (V[:, 2] < fa['chin'] + 0.12 * u))[0]
    if not len(sel):
        return out
    d = np.array([0.0, -0.32, 1.0])
    d /= np.linalg.norm(d)
    P0 = V[sel] + N[sel] * 0.003
    m = np.full(len(sel), np.inf)
    for t in np.linspace(0.006, 0.18 * u, 44):
        m = np.minimum(m, head.eval(P0 + d * t))
    s = np.clip(0.5 - m / (0.012 * u), 0, 1)
    # fades out down the neck rather than stopping at a line
    s *= np.clip((V[sel, 2] - (nz - 0.05 * u)) / (0.03 * u), 0, 1)
    out[sel] = s
    return out


def cel_normals(V, F, N, iters=12, amount=0.6):
    """Shading normals for cel-shaded cloth: the mesh normals averaged over the surface, so the hard light/shadow
    edge follows the garment's big forms instead of every small bump (which reads as shiny plastic)."""
    nb = pm.adjacency(F, len(V))
    M = N.copy()
    for _ in range(iters):
        avg = np.array([M[n].mean(0) if len(n) else M[i] for i, n in enumerate(nb)])
        M = M * (1 - amount) + avg * amount
        M /= np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-9)
    return M


def transfer_weights(Vsrc, Wsrc, Vdst, k=3):
    """Inverse-distance blend of the k nearest source vertices' weights (keeps the body-derived weights
    that stop trousers webbing between the legs)."""
    from mathutils.kdtree import KDTree
    from mathutils import Vector
    kd = KDTree(len(Vsrc))
    for i, p in enumerate(Vsrc):
        kd.insert(Vector(p), i)
    kd.balance()
    W = np.zeros((len(Vdst), Wsrc.shape[1]))
    for i, p in enumerate(Vdst):
        hits = kd.find_n(Vector(p), k)
        ws = np.array([1.0 / max(d, 1e-5) for _, _, d in hits])
        ids = [j for _, j, _ in hits]
        W[i] = (Wsrc[ids] * ws[:, None]).sum(0) / ws.sum()
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    return W


def joint_folds(sk, V, base, waist_z, amp=1.0):
    """Cloth folds where fabric bunches: spiralling rings round elbows, knees and the armpits, vertical
    gathers at the waist, and bunching above the ankle. Displaced along the garment's surface normal."""
    if amp <= 0:
        return V
    j = sk.j
    N = sdf.gradient(base, V, 0.002)
    off = np.zeros(len(V))
    U = sk.s['height'] / 1.7

    def ring(J, A, sigma, lam, a, reach, seed):
        A = A / np.linalg.norm(A)
        ref = np.cross(A, [0, 0, 1.0]) if abs(A[2]) < 0.9 else np.cross(A, [1.0, 0, 0])
        ref /= np.linalg.norm(ref)
        ref2 = np.cross(A, ref)
        d = V - J
        s = d @ A
        r = d - s[:, None] * A
        rl = np.linalg.norm(r, axis=1)
        th = np.arctan2(r @ ref2, r @ ref)
        w = np.exp(-(s / sigma) ** 2) * np.clip(1 - rl / reach, 0, 1) ** 0.5
        f = np.sin(2 * np.pi * s / lam + 1.4 * np.sin(th * 2 + seed)) * (0.6 + 0.4 * np.cos(th * 3 + seed * 1.7))
        return a * w * f

    for side, sx in (('L', 1), ('R', -1)):
        sh, el, wr = (np.array(j[f'{k}.{side}']) for k in ('shoulder', 'elbow', 'wrist'))
        hp, kn, an = (np.array(j[f'{k}.{side}']) for k in ('hip', 'knee', 'ankle'))
        off += ring(el, wr - sh, 0.06 * U, 0.055 * U, 0.0042 * U, 0.09 * U, 1.0 + sx)
        off += ring(sh + (el - sh) * 0.25, el - sh, 0.05 * U, 0.06 * U, 0.0028 * U, 0.08 * U, 2.0 + sx)
        off += ring(kn, an - hp, 0.07 * U, 0.06 * U, 0.0045 * U, 0.11 * U, 3.0 + sx)
        off += ring(an + np.array([0, 0, 0.13 * U]), np.array([0, 0, 1.0]), 0.06 * U, 0.045 * U, 0.0035 * U, 0.1 * U, 4.0 + sx)
        off += ring(hp, kn - hp, 0.05 * U, 0.06 * U, 0.002 * U, 0.12 * U, 5.0 + sx)
    # waist gathers: vertical folds above and below a belt line
    th = np.arctan2(V[:, 1], V[:, 0])
    gz = np.exp(-((V[:, 2] - waist_z) / (0.05 * U)) ** 2)
    off += 0.0025 * U * gz * np.sin(th * 15 + np.sin(th * 3) * 1.5) * (0.5 + 0.5 * np.cos(th * 4))
    return V + N * (off * amp)[:, None]


def build(spec, out_glb, art, renders=True):
    t0 = time.time()
    LOG.clear()
    os.makedirs(art, exist_ok=True)
    bl.reset()
    bl.setup_preview()
    sk, body = spec.skel, spec.body
    H = sk.s['height']
    fa = body.face_anchor
    full = body.field()
    tgt, dist = (0, 0, H * 0.52), H * 2.15
    face_tgt = (0, -0.04, fa['chin'] + 0.12 * fa['u'])

    # 1 reference
    write_reference(spec, art)
    log('stage 1 reference analysis written')

    # 2 blockout: capsules on the bones + head ellipsoid
    if renders:
        caps = []
        for bname, h, t, parent, up, deform in sk.bones:
            if not deform or bname.startswith(('index', 'middle', 'ring', 'pinky', 'thumb')):
                continue
            r = 0.05 if bname in ('hips', 'spine', 'chest') else 0.035
            caps.append(sdf.Capsule(h, t, r))
        caps.append(sdf.Ellipsoid(fa['cranium'], np.array([0.1, 0.11, 0.12]) * fa['u']))
        Vb, Qb = sdf.mesh_field(Union(caps), res=0.012, verbose=False)
        bl.make_mesh('blockout', Vb, Qb, colors=np.tile([0.6, 0.62, 0.66, 1], (len(Vb), 1)))
        _render(art, '02_blockout', tgt, dist, views=[('front', 0, 4), ('side', 90, 4)])
        _clear_objects()
    log('stage 2 parametric blockout')

    # 3 direct polygon modeling
    V, F, tag = cage.build_cage(body)
    bad, ne = pm.check_manifold(F)
    log(f'stage 3 cage: {len(V)} verts, {len(F)} quads, non-manifold edges {bad}')
    if renders:
        _checker_object('cage', V, [tuple(f) for f in F])
        _render(art, '03_cage', tgt, dist, views=[('front', 0, 4), ('q3', 35, 8), ('side', 90, 4)])
        _clear_objects()

    # 4 detail sculpting: subdivide and project onto the sculpt
    Vs, Fs = pc.subdivide(V, F, spec.subdiv, 'body_sub')
    Vs = pm.project(full, Vs, 4)
    log(f'stage 4 subdivided x{spec.subdiv} + projected: {len(Vs)} verts')
    # 5 topology refinement
    Vs = pm.relax(full, Vs, Fs, iters=3, amount=0.45)
    bad, ne = pm.check_manifold(Fs)
    dev = np.abs(full.eval(Vs))
    log(f'stage 5 relaxed: non-manifold {bad}, surface deviation mean {dev.mean() * 1000:.2f} mm max {dev.max() * 1000:.1f} mm')
    if renders:
        _checker_object('skin_topo', Vs, Fs)
        _render(art, '05_topology', tgt, dist, views=[('front', 0, 4), ('q3', 35, 8)])
        _render(art, '05_topology_face', face_tgt, 0.75 * fa['u'], views=[('front', 0, 3), ('q3', 38, 6)])
        _clear_objects()

    # stage 7 (part 1): skin weights on the refined body; garments inherit them from their source vertices
    bnames, W_body = skin.body_weights(sk, body.parts, Vs)
    W_body = pc.smooth_weights(W_body, Fs, iters=2, amount=0.45)
    # garments by extract & inflate
    pieces = []   # (name, V, F, color, cls, weights, paint, thickness, W)
    covered = np.zeros(len(Fs), bool)
    C = pc.face_centers(Vs, Fs)
    for g in spec.garments:
        sel = lambda c, g=g: (g.cut.eval(c) < 0) & (g.base.eval(c) < 0) & (g.region(c) if g.region else True)
        Vg, Fg, src = pc.extract(Vs, Fs, sel)
        if len(Fg) == 0:
            log(f'  garment {g.name}: nothing selected')
            continue
        def far(X):
            return float(np.abs(full.eval(X)).max())
        Vg = pm.project(g.base, Vg, 5)
        f1 = far(Vg)
        if g.relax:
            Vg = pm.relax(g.base, Vg, Fg, iters=g.relax, amount=0.4, keep=None)
        f2 = far(Vg)
        if g.snap:
            Vg = pc.snap_boundary(Vg, Fg, g.base, g.cut)
        f3 = far(Vg)
        if max(f1, f2, f3) > 0.08:
            log(f'  !! {g.name}: max distance from body after project {f1:.3f} relax {f2:.3f} snap {f3:.3f}')
        if g.covers:
            inside = (g.cut.eval(C) < -g.cover_margin) & (g.base.eval(C) < -0.002)
            if g.region:
                inside &= g.region(C)
            covered |= inside
        Wg = W_body[src] if g.weights == 'body' else None
        n0 = len(Fg)
        if g.refine:
            # clean hems, one more subdivision level, weights carried over, folds where cloth bunches
            Vg = smooth_hem(Vg, Fg, g.base)
            Vr, Fr = pc.subdivide(Vg, Fg, 1, f'{g.name}_ref')
            Vr = pm.project(g.base, Vr, 3)
            Vr = smooth_hem(Vr, Fr, g.base, iters=3)
            if Wg is not None:
                Wg = transfer_weights(Vg, Wg, Vr)
                if g.soft:
                    Wg = pc.smooth_weights(Wg, Fr, iters=g.soft, amount=0.5)
            if g.folds and g.cls not in ('hair', 'metal'):
                Vr = joint_folds(sk, Vr, g.base, sk.j['spine'][2] - 0.04 * H / 1.7, g.folds)
            Vg, Fg = Vr, Fr
        if g.displace is not None:
            Ng = sdf.gradient(g.base, Vg, 0.002)
            Ng /= np.maximum(np.linalg.norm(Ng, axis=1, keepdims=True), 1e-9)
            Vg = Vg + Ng * g.displace(Vg, Ng)[:, None]
        pieces.append((g.name, Vg, Fg, g.color, g.cls, g.weights, g.paint, g.thickness, Wg))
        log(f'  garment {g.name}: {n0} quads extracted, {len(Fg)} after refinement')
    # skin minus covered faces (keep a rim so there are no gaps)
    keep = np.nonzero(~covered)[0]
    Fk = [Fs[i] for i in keep]
    used = sorted({v for f in Fk for v in f})
    remap = {v: i for i, v in enumerate(used)}
    Vk = Vs[used]
    Fk = [tuple(remap[v] for v in f) for f in Fk]
    log(f'  skin after culling hidden faces: {len(Fk)} of {len(Fs)} quads')
    pieces.insert(0, ('skin', Vk, Fk, spec.skin_color, 'skin', 'body', spec.skin_paint, 0, W_body[used]))
    for p in spec.parts:
        Vp, Fp = p.V, p.F
        pieces.append((p.name, Vp, Fp, p.color, p.cls, p.weights, p.paint, 0, None))

    # 6 materials, 7 rigging
    ao_field = Union([full] + [Intersect([g.base, g.cut]) for g in spec.garments] + [p.field for p in spec.parts if p.field is not None])
    arm = build_armature(sk)
    objs = []
    for name, Vp, Fp, color, cls, weights, paint, thick, Wsrc in pieces:
        trim = None
        if cls in ('cloth', 'leather') and not any(k in name for k in TRIM_SKIP):
            trim = hem_rings(Fp, len(Vp))
        if thick and thick > 0:
            Vp, Fp = pc.shell(Vp, Fp, thick)
            if Wsrc is not None:
                Wsrc = np.concatenate([Wsrc, Wsrc])
            if trim is not None:
                trim = np.concatenate([trim, trim])
        ob = _make(f'{spec.name}_{name}', Vp, Fp)
        Vp2, F2 = pc.mesh_to_arrays(ob)
        fd = float(np.abs(full.eval(Vp2)).max())
        if fd > 0.12:
            log(f'  !! piece {name}: max distance from body {fd:.3f} after solidify')
        me = ob.data
        me.calc_loop_triangles()
        T = np.empty(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get('vertices', T)
        N = vertex_normals(Vp2, T.reshape(-1, 3))
        col = _color(color, Vp2, N)
        if paint:
            col = paint(Vp2, N, col)
        if trim is not None and len(trim) == len(col):
            col = trim_paint(col, trim)
        ao = sdf_ao(ao_field, Vp2 + N * 0.0015, N)
        u = fa['u']
        clsv = np.full(len(Vp2), CLS[cls] / 10.0)
        if name == 'skin':
            # the painted shadow under the jaw rides in the class channel's fraction (tbToon decodes it)
            clsv = clsv + 0.04 * neck_shadow(body, Vp2, N)
        if name == 'skin':
            fwd = np.clip((-N[:, 1] - 0.15) / 0.5, 0, 1)
            inface = ((Vp2[:, 2] > fa['chin'] - 0.01) & (Vp2[:, 2] < fa['chin'] + 0.2 * u) & (Vp2[:, 1] < fa['cranium'][1] - 0.04 * u)).astype(float)
            mask = fwd * inface
        else:
            mask = np.zeros(len(Vp2))
        bl.set_colors(me, np.concatenate([col, mask[:, None]], 1))
        if name == 'skin':
            # anime face shading: blend face normals toward an egg-shaped head normal so light reads as
            # clean shapes (no nose/eye-socket shadow blotches)
            hc = fa['cranium'] + np.array([0, 0.02, -0.03]) * u
            hn = (Vp2 - hc) / (np.array([0.095, 0.11, 0.13]) * u) ** 2
            hn /= np.maximum(np.linalg.norm(hn, axis=1), 1e-9)[:, None]
            on_head = np.clip((Vp2[:, 2] - (fa['chin'] - 0.005)) / (0.03 * u), 0, 1)
            wgt = (np.clip(mask * 1.6, 0, 1) * 0.85 + 0.25 * on_head * (mask < 0.05))[:, None] * on_head[:, None]
            Ns = N * (1 - wgt) + hn * wgt
            Ns /= np.maximum(np.linalg.norm(Ns, axis=1), 1e-9)[:, None]
            me.normals_split_custom_set_from_vertices([tuple(x) for x in Ns])
        elif cls in ('cloth', 'leather', 'white'):
            Fc = T.reshape(-1, 3).tolist()
            me.normals_split_custom_set_from_vertices([tuple(x) for x in cel_normals(Vp2, Fc, N)])
        elif cls == 'hair':
            # hair shades as one smooth volume round the head (clean highlight band), its locks keep a little
            # of their own form
            hc = fa['cranium'] + np.array([0, 0.01, -0.01]) * u
            sph = Vp2 - hc
            sph /= np.maximum(np.linalg.norm(sph, axis=1, keepdims=True), 1e-9)
            Nh = N * 0.4 + sph * 0.6
            Nh /= np.maximum(np.linalg.norm(Nh, axis=1, keepdims=True), 1e-9)
            me.normals_split_custom_set_from_vertices([tuple(x) for x in Nh])
        _set_uv(me, 'UVMap', np.stack([Vp2[:, 0] / u, (Vp2[:, 2] - fa['chin']) / u], 1))
        _set_uv(me, 'UV1', np.stack([ao, clsv], 1))
        # weights
        if Wsrc is not None and len(Wsrc) == len(Vp2):
            bn, W = bnames, Wsrc.copy()
        elif weights == 'body':
            bn, W = skin.body_weights(sk, body.parts, Vp2)
            W = pc.smooth_weights(W, F2, iters=2, amount=0.45)
        elif weights[0] == 'custom':
            bn, W = weights[1](Vp2)
            W = skin._finish(W, 4)
        elif weights[0] == 'rigid':
            bn, W = skin.rigid_weights(sk, weights[1], Vp2)
        elif weights[0] == 'chain':
            bn, W = skin.chain_weights(sk, weights[1], Vp2)
        else:
            raise ValueError(weights)
        zero = W.sum(1) < 1e-6
        if zero.any():
            _, W2 = skin.body_weights(sk, body.parts, Vp2[zero])
            W[zero] = W2
        for bi, b in enumerate(bn):
            idx = np.nonzero(W[:, bi] > 1e-4)[0]
            if len(idx) == 0:
                continue
            vg = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
            for w in np.unique(np.round(W[idx, bi], 3)):
                sel = idx[np.round(W[idx, bi], 3) == w]
                vg.add(sel.tolist(), float(w), 'REPLACE')
        # refined garments are dense: collapse-decimate them back toward the original budget (vertex groups,
        # colours and UVs survive the collapse; the skin keeps its custom face normals untouched)
        if name != 'skin' and len(Fp) > 400 and any(g.name == name and g.refine for g in spec.garments):
            dec = ob.modifiers.new('dec', 'DECIMATE')
            dec.ratio = 0.42
            dec.use_collapse_triangulate = False
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier='dec')
        objs.append(ob)
    log('stage 6 materials (albedo, class, AO, face UVs) + stage 7 weights')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    mesh_ob = bpy.context.view_layer.objects.active
    mesh_ob.name = spec.name
    for b in sk.deform_names():
        if b not in mesh_ob.vertex_groups:
            mesh_ob.vertex_groups.new(name=b)
    mod = mesh_ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    mesh_ob.parent = arm
    mesh_ob.data.materials.append(bpy.data.materials.new(spec.name + '_mat'))
    tris = sum(len(p.vertices) - 2 for p in mesh_ob.data.polygons)
    log(f'rig: {len(sk.deform_names())} deform bones; mesh {len(mesh_ob.data.vertices)} verts, {tris} tris')

    # 9 visual testing
    if renders:
        _render(art, '09_final', tgt, dist)
        _render(art, '09_face', face_tgt, 0.85 * fa['u'], views=[('front', 0, 3), ('q3', 38, 6), ('side', 90, 3)])
        for pose_name, pose in DEFORM_TESTS.items():
            apply_pose(arm, pose)
            bpy.context.view_layer.update()
            _render(art, f'09_deform_{pose_name}', tgt, dist, views=[('q3', 30, 8)])
        apply_pose(arm, {})

    # 10 optimization: LOD1
    lod = mesh_ob.copy()
    lod.data = mesh_ob.data.copy()
    lod.name = spec.name + '_LOD1'
    bpy.context.scene.collection.objects.link(lod)
    for m in list(lod.modifiers):
        if m.type == 'ARMATURE':
            continue
        lod.modifiers.remove(m)
    dec = lod.modifiers.new('dec', 'DECIMATE')
    dec.ratio = spec.lod_ratio
    dec.use_collapse_triangulate = True
    dec.use_symmetry = True
    bpy.context.view_layer.objects.active = lod
    # decimate must apply before the armature: move it to the top
    while lod.modifiers.find('dec') > 0:
        bpy.ops.object.modifier_move_up(modifier='dec')
    bpy.ops.object.modifier_apply(modifier='dec')
    lod_tris = sum(len(p.vertices) - 2 for p in lod.data.polygons)
    log(f'stage 10 LOD1: {lod_tris} tris (LOD0 {tris})')
    if out_glb:
        os.makedirs(os.path.dirname(out_glb), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        for o in (mesh_ob, lod, arm):
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_vertex_color='ACTIVE',
                                  export_all_vertex_colors=False, export_animations=False, export_skins=True,
                                  export_yup=True, export_apply=False, export_def_bones=False, export_normals=True,
                                  export_tangents=False, export_materials='EXPORT')
        log(f'exported {out_glb} ({os.path.getsize(out_glb) // 1024} KB) in {time.time() - t0:.0f}s')
    with open(os.path.join(art, 'pipeline.log'), 'w') as f:
        f.write('\n'.join(LOG) + '\n')
    return mesh_ob, arm


# ------------------------------------------------------------------------------------------ posing

DEFORM_TESTS = {
    # armature-space euler degrees per bone (X bends an upward bone forward / a downward bone back)
    'arm_raised': {'upperarm.L': (0, -60, 0), 'upperarm.R': (0, 60, 0)},
    'elbow_bent': {'upperarm.L': (-40, 0, 20), 'forearm.L': (0, 0, 110), 'upperarm.R': (-40, 0, -20), 'forearm.R': (0, 0, -110)},
    'knee_bent': {'thigh.L': (-80, 0, 0), 'shin.L': (100, 0, 0), 'thigh.R': (-30, 0, 0), 'shin.R': (40, 0, 0)},
    'action': {'hips': (0, 0, 25), 'spine': (10, 0, -10), 'chest': (10, 0, -20), 'head': (-5, 0, 15),
               'upperarm.R': (-70, 0, -30), 'forearm.R': (0, 0, -90), 'upperarm.L': (40, 30, 0), 'forearm.L': (0, 0, 60),
               'thigh.L': (-60, 0, 10), 'shin.L': (70, 0, 0), 'thigh.R': (25, 0, -10), 'shin.R': (30, 0, 0)},
}


def apply_pose(arm, pose):
    """Sets pose-bone rotations from armature-space eulers (degrees), converted into each bone's frame."""
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    for name, (rx, ry, rz) in pose.items():
        pb = arm.pose.bones.get(name)
        if not pb:
            continue
        R = pb.bone.matrix_local.to_3x3()
        q = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_quaternion()
        ql = (R.inverted() @ q.to_matrix() @ R).to_quaternion()
        pb.rotation_quaternion = ql
