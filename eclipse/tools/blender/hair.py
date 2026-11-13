"""Hair cards: strand textures and groomed card meshes grown over a scalp.

`strand_texture()` paints an RGBA atlas of N clump columns (alpha = strands, root at the top).
`grow_cards()` samples roots on a masked region of a head mesh, grows each strand along a groom
direction field while keeping it a set height above the skin (via a BodyField), and builds a
tapered ribbon per strand with UVs into a random clump column.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import mesh_from_arrays


def strand_texture(path, res=1024, cols=8, seed=5, base=(0.09, 0.065, 0.05), grey=0.12, tip=(0.16, 0.12, 0.09)):
    """Albedo + alpha strand atlas. Each column is a clump of ~120 wavy strands."""
    rng = np.random.default_rng(seed)
    col_w = res // cols
    alpha = Image.new('L', (res * 2, res * 2), 0)
    color = Image.new('RGB', (res * 2, res * 2), (0, 0, 0))
    da = ImageDraw.Draw(alpha)
    dc = ImageDraw.Draw(color)
    for c in range(cols):
        x0 = c * col_w * 2
        n = 110 + int(rng.integers(0, 40))
        for _ in range(n):
            # strands start near the top (root) and end at varying lengths
            sx = x0 + col_w * (0.12 + 0.76 * rng.random()) * 2
            length = res * 2 * (0.55 + 0.45 * rng.random())
            amp = rng.uniform(1.5, 7.0)
            freq = rng.uniform(1.5, 4.0)
            ph = rng.random() * 6.28
            drift = rng.uniform(-14, 14)
            width = rng.uniform(1.4, 3.2)
            is_grey = rng.random() < grey
            pts = []
            for k in range(40):
                t = k / 39
                y = t * length
                x = sx + math.sin(t * freq * 6.28 + ph) * amp + drift * t * t
                pts.append((x, y))
            shade = rng.uniform(0.7, 1.25)
            for k in range(len(pts) - 1):
                t = k / (len(pts) - 1)
                a = int(255 * (1.0 - 0.75 * t ** 2.2))
                w = max(1, int(width * (1.0 - 0.55 * t)))
                da.line([pts[k], pts[k + 1]], fill=a, width=w)
                if is_grey:
                    rgb = (0.52, 0.5, 0.48)
                else:
                    rgb = tuple(base[i] * (1 - t) + tip[i] * t for i in range(3))
                dc.line([pts[k], pts[k + 1]], fill=tuple(int(min(1, v * shade) * 255) for v in rgb), width=w + 2)
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8)).resize((res, res), Image.Resampling.LANCZOS)
    color = color.filter(ImageFilter.GaussianBlur(1.2)).resize((res, res), Image.Resampling.LANCZOS)
    # dilate colour under transparent areas so filtering never pulls in black
    c = np.asarray(color, np.float32)
    a = np.asarray(alpha, np.float32) / 255
    mean = (c * a[..., None]).sum((0, 1)) / max(a.sum(), 1)
    c = c * a[..., None] + mean * (1 - a[..., None])
    out = np.dstack([c, a * 255]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(path)
    return path


def sample_region(verts, tris, weights, n, seed=0):
    """Area-weighted random points (and interpolated normals) where per-vertex weights > 0.5."""
    v = np.asarray(verts, float)
    t = np.asarray(tris, int)
    w = np.asarray(weights, float)
    keep = (w[t].mean(1) > 0.5)
    t = t[keep]
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    cr = np.cross(b - a, c - a)
    area = np.linalg.norm(cr, axis=1) * 0.5
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(t), size=n, p=area / area.sum())
    r1, r2 = rng.random(n), rng.random(n)
    s = np.sqrt(r1)
    u, ww = 1 - s, s * (1 - r2)
    vv = s * r2
    pts = a[pick] * u[:, None] + b[pick] * ww[:, None] + c[pick] * vv[:, None]
    nrm = cr[pick] / np.maximum(np.linalg.norm(cr[pick], axis=1, keepdims=True), 1e-12)
    wt = w[t[pick, 0]] * u + w[t[pick, 1]] * ww + w[t[pick, 2]] * vv
    return pts, nrm, wt


def grow_cards(name, roots, normals, field, flow, length, width, offset, segments=5, cols=8, seed=1,
               clump=0.004, taper=0.45, lift=None, coll=None):
    """Build card ribbons.

    roots, normals: (N, 3). field: BodyField of the head (keeps strands above the skin).
    flow(p, n) -> (N, 3) groom directions. length / width / offset: scalars or (N,) arrays;
    `offset` is the height above the skin at the tip (roots sit at 1 mm).
    """
    rng = np.random.default_rng(seed)
    N = len(roots)
    L = np.broadcast_to(np.asarray(length, float), (N,)) * (0.8 + 0.4 * rng.random(N))
    W = np.broadcast_to(np.asarray(width, float), (N,)) * (0.8 + 0.4 * rng.random(N))
    H = np.broadcast_to(np.asarray(offset, float), (N,))
    pos = np.zeros((N, segments + 1, 3))
    pos[:, 0] = roots + normals * 0.001
    p = pos[:, 0].copy()
    jitter = rng.normal(0, 1, (N, 3)) * clump
    for k in range(1, segments + 1):
        t = k / segments
        d = flow(p, normals)
        d = d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        p = p + d * (L / segments)[:, None] + jitter * (1.0 / segments)
        # keep each strand at its target height above the skin (more volume towards the tip)
        target = 0.001 + H * (t ** 0.8)
        if lift is not None:
            target = target + lift * t
        dist = field(p)
        nn = field.nearest_normal(p)
        p = p + nn * (target - dist)[:, None]
        pos[:, k] = p
    verts = []
    uvs = []
    faces = []
    for i in range(N):
        col = rng.integers(0, cols)
        u0, u1 = col / cols + 0.004, (col + 1) / cols - 0.004
        base = len(verts)
        for k in range(segments + 1):
            t = k / segments
            if k < segments:
                tang = pos[i, k + 1] - pos[i, k]
            else:
                tang = pos[i, k] - pos[i, k - 1]
            tang /= max(np.linalg.norm(tang), 1e-9)
            nrm = field.nearest_normal(pos[i, k][None])[0]
            side = np.cross(tang, nrm)
            side /= max(np.linalg.norm(side), 1e-9)
            w = W[i] * (1.0 - taper * t)
            verts.append(pos[i, k] - side * w * 0.5)
            verts.append(pos[i, k] + side * w * 0.5)
            v = 1.0 - t * 0.98
            uvs.append((u0, v))
            uvs.append((u1, v))
        for k in range(segments):
            a = base + k * 2
            faces.append((a, a + 1, a + 3, a + 2))
    obj = mesh_from_arrays(name, np.array(verts), faces, coll)
    me = obj.data
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = uvs[vi]
    for poly in me.polygons:
        poly.use_smooth = True
    return obj
