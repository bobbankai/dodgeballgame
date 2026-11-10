"""Eyes, teeth, tongue and lashes. Eyeballs are built here; the mouth parts and lash strips reuse the base
mesh's helper geometry (it follows the face morphs and the jaw)."""
import math
import os
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from PIL import Image, ImageDraw, ImageFilter
import tex
from tex import fbm, smooth
from human import group_mask, split_off

IRIS_R, PUPIL_R = 0.392, 0.20  # in texture radius units; the map is azimuthal: radius = sqrt(angle from the pupil / pi)


def iris_texture(name, color, cloudy=0.0, seed=0):
    s = 512
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    u, v = (xx / (s - 1)) * 2 - 1, (yy / (s - 1)) * 2 - 1
    r, phi = np.hypot(u, v), np.arctan2(v, u)
    col = np.array([int(color.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)
    back = smooth(0.5, 1.0, r)[..., None]
    img = np.array([0.83, 0.80, 0.76], np.float32) * (1 - 0.3 * back) + np.array([0.55, 0.25, 0.22], np.float32) * back * 0.3
    veins = Image.new('L', (s, s), 0)
    d = ImageDraw.Draw(veins)
    rng = np.random.default_rng(seed + 3)
    for _ in range(26):  # thin vessels wandering in from the back of the eye
        a, rr = rng.random() * math.tau, 0.98
        pts = []
        while rr > 0.47 + rng.random() * 0.2:
            pts.append(((0.5 + 0.5 * rr * math.cos(a)) * s, (0.5 + 0.5 * rr * math.sin(a)) * s))
            a += rng.normal(0, 0.06)
            rr -= 0.02
        if len(pts) > 1:
            d.line(pts, fill=int(90 + 100 * rng.random()), width=1)
    vm = np.asarray(veins.filter(ImageFilter.GaussianBlur(0.8)), np.float32)[..., None] / 255
    img = img * (1 - vm * 0.5) + np.array([0.6, 0.12, 0.1], np.float32) * vm * 0.5
    p = np.stack([np.cos(phi) * 7, np.sin(phi) * 7, r * 5], -1)
    fib = fbm(p, (6, 6, 1.2), 4, seed) * 0.75 + 0.25 * fbm(p, (22, 22, 2), 2, seed + 4)
    iris = col[None, None] * (0.45 + 1.3 * fib)[..., None]
    inner = (1 - smooth(PUPIL_R, 0.30, r))[..., None]
    iris = iris * (1 - inner * 0.5) + (col * 1.9 + np.array([0.10, 0.05, 0.0], np.float32)) * inner * 0.5 * (0.6 + 0.8 * fib[..., None])
    iris *= (1 - 0.8 * smooth(0.325, IRIS_R, r))[..., None]         # limbal ring
    iris *= smooth(PUPIL_R - 0.012, PUPIL_R + 0.012, r)[..., None]  # pupil
    if cloudy:
        iris = iris * (1 - cloudy) + np.array([0.60, 0.66, 0.70], np.float32) * cloudy * (0.8 + 0.4 * fib[..., None])
    im = smooth(IRIS_R + 0.012, IRIS_R - 0.012, r)[..., None]
    img = img * (1 - im) + iris * im
    os.makedirs(tex.TMP, exist_ok=True)
    path = os.path.join(tex.TMP, f'{name}.png')
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(path)
    return path


def eyes(base, rig, spec):
    """Two eyeballs with a corneal bulge, each bound to its eye bone. spec['eyes']: {'color', 'L'/'R': overrides}."""
    co = np.array([v.co[:] for v in base.data.vertices])
    es = spec.get('eyes', {})
    objs = []
    for side in 'LR':
        pts = co[group_mask(base, f'helper-{side.lower()}-eye')]
        c = (pts.max(0) + pts.min(0)) / 2
        rad = float((pts.max(0) - pts.min(0)).max() / 2) * 0.985
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=rad)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'))  # pole to -Y
        uvl = bm.loops.layers.uv.new('UVMap')
        for vtx in bm.verts:
            ang = math.acos(max(-1, min(1, -vtx.co.y / rad)))
            if ang < 0.62:  # cornea
                vtx.co.y -= rad * 0.075 * math.cos(ang / 0.62 * math.pi / 2) ** 2
        for f in bm.faces:
            f.smooth = True
            for l in f.loops:
                d = l.vert.co.normalized()
                ang = math.acos(max(-1, min(1, -d.y)))
                ph = math.atan2(d.z, d.x)
                rr = math.sqrt(ang / math.pi)
                l[uvl].uv = (0.5 + 0.5 * rr * math.cos(ph), 0.5 + 0.5 * rr * math.sin(ph))
        bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
        me = bpy.data.meshes.new(f'eye_{side}')
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(f'eye_{side}', me)
        bpy.context.scene.collection.objects.link(o)
        o.vertex_groups.new(name=f'eye.{side}').add(range(len(me.vertices)), 1.0, 'REPLACE')
        e = {**es, **es.get(side, {})}
        key = f"iris_{e.get('color', '#3a2414').lstrip('#')}_{int(e.get('cloudy', 0) * 100)}"
        me.materials.append(bpy.data.materials.get('eye_' + key) or tex.material('eye_' + key, base=iris_texture(key, e.get('color', '#3a2414'), e.get('cloudy', 0)), rough=0.18))
        objs.append(o)
    return objs


def mouth_parts(base):
    teeth = split_off(base, group_mask(base, 'helper-upper-teeth') | group_mask(base, 'helper-lower-teeth'), 'teeth')
    tongue = split_off(base, group_mask(base, 'helper-tongue'), 'tongue')
    for o, col, rough in ((teeth, (0.78, 0.73, 0.64), 0.22), (tongue, (0.50, 0.16, 0.17), 0.38)):
        o.data.materials.clear()
        o.data.materials.append(tex.material(o.name, base=col, rough=rough))
        for p in o.data.polygons:
            p.use_smooth = True
    return [teeth, tongue]


def lash_texture():
    w, h, ss = 256, 128, 4
    im = Image.new('L', (w * ss, h * ss), 0)
    d = ImageDraw.Draw(im)
    rng = np.random.default_rng(5)
    for i in range(46):
        x = (i + rng.random() * 0.8) / 46 * w * ss
        lean, ln = rng.normal(0, 0.18), (0.55 + 0.45 * rng.random()) * h * ss
        pts = [(x + lean * ln * q + 0.25 * ln * lean * q * q, h * ss - ln * q) for q in np.linspace(0, 1, 6)]
        for (a, b, q) in zip(pts, pts[1:], np.linspace(1, 0.15, 5)):
            d.line([a, b], fill=255, width=max(1, int(2.6 * ss * q)))
    a = np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255
    a[-10:] = np.maximum(a[-10:], np.linspace(0.3, 1, 10)[:, None])  # a solid line at the root
    rgba = np.dstack([np.full((h, w, 3), 10, np.uint8), (np.clip(a * 1.2, 0, 1) * 255).astype(np.uint8)])
    path = os.path.join(tex.TMP, 'lashes.png')
    os.makedirs(tex.TMP, exist_ok=True)
    Image.fromarray(rgba, 'RGBA').save(path)
    return path


def lashes(base, body_rim):
    """The four helper strips, re-mapped: v runs root to tip, u along the lid. body_rim: eyelid rim points."""
    mask = np.zeros(len(base.data.vertices), bool)
    for n in LASH_HELPERS:
        mask |= group_mask(base, n)
    o = split_off(base, mask, 'lashes')
    me = o.data
    co = np.array([v.co[:] for v in me.vertices])
    rim = np.array(body_rim)
    dist = np.array([np.min(np.linalg.norm(rim - c, axis=1)) for c in co])
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    seen = set()
    for f0 in bm.faces:  # each strip separately: normalise its own root-to-tip distance
        if f0.index in seen:
            continue
        isl, stack = [], [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            isl.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        vs = {v.index for f in isl for v in f.verts}
        dmin, dmax = min(dist[i] for i in vs), max(dist[i] for i in vs)
        xs = [co[i][0] for i in vs]
        for f in isl:
            f.smooth = True
            for l in f.loops:
                i = l.vert.index
                l[uvl].uv = ((co[i][0] - min(xs)) / (max(xs) - min(xs)) * 2.0, (dist[i] - dmin) / max(dmax - dmin, 1e-6))
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    me.materials.append(tex.material('lashes', base=lash_texture(), alpha='base', blend='BLEND', rough=0.6, double=True))
    return o


LASH_HELPERS = ('helper-l-eyelashes-1', 'helper-l-eyelashes-2', 'helper-r-eyelashes-1', 'helper-r-eyelashes-2')


def eyelid_rim(base):
    """Points along the lid margins: the skin vertices the lash helper strips are rooted on."""
    body = group_mask(base, 'body')
    co = np.array([v.co[:] for v in base.data.vertices], np.float32)
    skin_co = co[body]
    rim = []
    for n in LASH_HELPERS:
        for c in co[group_mask(base, n)]:
            d = np.linalg.norm(skin_co - c, axis=1)
            i = int(np.argmin(d))
            if d[i] < 0.0025:
                rim.append(skin_co[i])
    return np.unique(np.round(np.array(rim, np.float32), 5), axis=0)
