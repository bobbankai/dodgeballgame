"""Skin: the head gets its own UV space and texture, then albedo / normal / ORM are painted with numpy
from baked position, normal and occlusion maps. Everything is a function of the 3D position, so the
head and body textures agree at the neck and no UV seam shows."""
import os
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc
from PIL import Image, ImageDraw
import bpy
import tex
from tex import blob, blur, fbm, smooth, vnoise
from human import MPFB_SRC, group_mask

MASKS = os.path.join(MPFB_SRC, 'data', 'textures')
BODY_SIZE = (2048, 2048)
HEAD_SIZE = (1024, 2048)


def split_head(body):
    """Material slots: 0 body skin, 1 head skin, 2 inside of the mouth. The head UV island is stretched over
    the whole 0..1 square. Returns the island's old bounding box (u0, v0, u1, v1)."""
    for n in ('skin_body', 'skin_head', 'mouth'):
        body.data.materials.append(bpy.data.materials.new(n))
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv.active
    bm.verts.ensure_lookup_table()
    scalp = group_mask(body, 'scalp')
    # UV islands: faces joined across edges whose two sides share the same UVs
    seen, islands = set(), []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        isl, stack = [], [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            isl.append(f)
            for l in f.loops:
                for o in l.link_loops:
                    g = o.face
                    if g.index in seen:
                        continue
                    if (o.link_loop_next[uvl].uv - l[uvl].uv).length < 1e-5 and (o[uvl].uv - l.link_loop_next[uvl].uv).length < 1e-5:
                        seen.add(g.index)
                        stack.append(g)
        islands.append(isl)
    head = max(islands, key=lambda isl: sum(scalp[v.index] for f in isl for v in f.verts))
    us = [l[uvl].uv for f in head for l in f.loops]
    u0, u1 = min(u.x for u in us), max(u.x for u in us)
    v0, v1 = min(u.y for u in us), max(u.y for u in us)
    pad = 0.01
    for f in head:
        f.material_index = 1
        for l in f.loops:
            l[uvl].uv = Vector((pad + (1 - 2 * pad) * (l[uvl].uv.x - u0) / (u1 - u0), pad + (1 - 2 * pad) * (l[uvl].uv.y - v0) / (v1 - v0)))
    for isl in islands:  # the mouth cavity: the island whose centre sits at about (0.755, 0.12) in the stock layout
        c = np.mean([l[uvl].uv for f in isl for l in f.loops], 0) if isl is not head else (0, 0)
        if abs(c[0] - 0.755) < 0.05 and abs(c[1] - 0.12) < 0.06:
            for f in isl:
                f.material_index = 2
    bm.to_mesh(body.data)
    bm.free()
    return (u0, v0, u1, v1), pad


def _mask(name, box, pad):
    """an MPFB mask (stock UV layout) as (body array, head array)"""
    m = tex.load(os.path.join(MASKS, f'mpfb_{name}.jpg'), None, 'L')
    H, W = m.shape
    u0, v0, u1, v1 = box
    crop = m[int(v0 * H):int(v1 * H), int(u0 * W):int(u1 * W)]
    hw, hh = HEAD_SIZE
    inner = np.asarray(Image.fromarray((crop * 255).astype(np.uint8)).resize((int(hw * (1 - 2 * pad)), int(hh * (1 - 2 * pad))), Image.LANCZOS), np.float32) / 255
    head = np.zeros((hh, hw), np.float32)
    oy, ox = (hh - inner.shape[0]) // 2, (hw - inner.shape[1]) // 2
    head[oy:oy + inner.shape[0], ox:ox + inner.shape[1]] = inner
    body = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(BODY_SIZE, Image.LANCZOS), np.float32) / 255
    return body, head


class Painter:
    """Draws strokes given in 3D onto the head texture (brows, lash lines, scars)."""

    def __init__(self, body):
        self.me = body.data
        bm = bmesh.new()
        bm.from_mesh(self.me)
        self.bvh = BVHTree.FromBMesh(bm)
        bm.free()
        self.uv = self.me.uv_layers.active.data

    def uv_at(self, p, slot=1):
        loc, _n, fi, _d = self.bvh.find_nearest(Vector(p))
        poly = self.me.polygons[fi]
        if poly.material_index != slot:
            return None
        w = poly_3d_calc([self.me.vertices[v].co for v in poly.vertices], loc)
        u = sum((self.uv[li].uv * wi for li, wi in zip(poly.loop_indices, w)), Vector((0, 0)))
        return u.x, u.y

    def project(self, x, z, y_from=-1.0):
        """the first surface point met going back (+Y) from in front of the face"""
        loc, _n, _i, _d = self.bvh.ray_cast(Vector((x, y_from, z)), Vector((0, 1, 0)))
        return loc

    def strokes(self, lines, size, width):
        """lines: list of 3D polylines. Returns a coverage mask (h, w) in UV space."""
        ss = 2
        im = Image.new('L', (size[0] * ss, size[1] * ss), 0)
        d = ImageDraw.Draw(im)
        for line in lines:
            pts = [self.uv_at(p) for p in line]
            pts = [(u * size[0] * ss, (1 - v) * size[1] * ss) for u, v in (q for q in pts if q)]
            if len(pts) > 1 and max(abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in zip(pts, pts[1:])) < 60 * ss:
                d.line(pts, fill=255, width=max(1, round(width * ss)))
        return np.asarray(im.resize(size, Image.LANCZOS), np.float32)[::-1] / 255


def paint(body, rig_rest, spec, box, pad, name):
    """Returns {slot: (albedo path, normal path, orm path)} for the body (0) and head (1)."""
    rng = np.random.default_rng(spec.get('seed', 1))
    seed = spec.get('seed', 1)
    sizes = [BODY_SIZE, HEAD_SIZE, (8, 8)]
    P = tex.bake(body, sizes, 'pos')
    N = tex.bake(body, sizes, 'nor')
    AO = tex.bake(body, sizes, 'ao', samples=48)
    R = rig_rest
    eyeL, eyeR = R['eye.L'][0], R['eye.R'][0]
    co = np.array([v.co[:] for v in body.data.vertices])
    lips_v = co[group_mask(body, 'lips')]
    mouth = lips_v.mean(0)
    mid = co[(np.abs(co[:, 0]) < 0.006) & (co[:, 2] > mouth[2] + 0.012) & (co[:, 2] < eyeL[2] - 0.004)]
    nose = mid[np.argmin(mid[:, 1])]
    sk = spec['skin']
    tone = tex.hexc(sk['tone'])
    dark = float(1 - np.clip(tone.mean() * 3.2, 0, 1))  # 0 pale .. 1 deep: how melanin-rich the skin is
    lip_col = tex.hexc(sk['lips'])
    hair_col = tex.hexc(spec['hair_color'])
    painter = Painter(body)
    masks = {k: _mask(k, box, pad) for k in ('lips', 'eyelids', 'fingernails', 'toenails', 'aureolae', 'ears')}
    scalp_attr = None
    if spec.get('scalp'):  # painted stubble / shaved hair
        col = body.data.color_attributes.new('_mask', 'FLOAT_COLOR', 'POINT')
        sm = group_mask(body, 'scalp')
        col.data.foreach_set('color', np.repeat(sm.astype(np.float32), 4))
        scalp_attr = tex.bake(body, sizes, 'attr:_mask')
        body.data.color_attributes.remove(col)
    out = {}
    for slot in (0, 1):
        p, n, ao = P[slot], N[slot], AO[slot][..., 0]
        size = sizes[slot]
        m = {k: v[slot] for k, v in masks.items()}
        # ---------- albedo
        big = fbm(p, 9, 4, seed)            # blotches a hand wide
        fine = fbm(p, 90, 3, seed + 5)      # mottling
        alb = tone * (0.90 + 0.20 * big)[..., None] * (0.955 + 0.09 * fine)[..., None]
        red = np.array([1.0, 0.56, 0.47], np.float32)  # blood showing through: multiplies towards red
        flush = np.zeros(p.shape[:2], np.float32)
        occl = 1 - smooth(0.25, 0.95, ao)
        flush += 0.55 * occl                  # creases are redder and darker
        if slot == 1:
            for s in (-1, 1):
                eye = eyeL if s > 0 else eyeR
                flush += 0.55 * blob(p, (s * abs(eye[0]) * 1.55, eye[1] + 0.012, (eye[2] + mouth[2]) / 2 + 0.006), 0.036)  # cheek
                flush += 0.35 * blob(p, eye + np.array([0, 0.004, -0.012]), 0.022)   # under the eye
                flush += 0.30 * blob(p, eye + np.array([0, 0.0, 0.004]), 0.018)      # lid
            flush += 0.45 * blob(p, nose, 0.022) + 0.2 * blob(p, (0, mouth[1] + 0.008, mouth[2] - 0.045), 0.03)
            flush += 0.5 * m['ears']
        else:
            for b in R:  # knuckles, elbows, knees
                if b.startswith(('finger', 'lowerarm01', 'lowerleg01')) and not b.startswith('finger1'):
                    rad = 0.012 if b.startswith('finger') else 0.06
                    flush += (0.5 if b.startswith('finger') else 0.3) * blob(p, R[b][0], rad)
        flush *= (1 - 0.45 * dark)
        alb = alb * (1 + (red - 1) * np.clip(flush, 0, 1)[..., None] * 0.5)
        alb *= (1 - 0.10 * occl)[..., None]
        # palms and soles are paler, most visibly on deep skin
        pal = np.zeros(p.shape[:2], np.float32)
        if slot == 0:
            for s, side in ((1, 'L'), (-1, 'R')):
                w0 = R[f'wrist.{side}'][0]
                fw = R[f'finger3-1.{side}'][0] - w0
                fw /= np.linalg.norm(fw)
                th = R[f'finger1-1.{side}'][0] - w0
                pn = np.cross(fw, th) * s
                pn /= np.linalg.norm(pn)
                along = (p - w0) @ fw
                hand = smooth(-0.01, 0.02, along) * (np.linalg.norm(p - w0, axis=-1) < 0.24)
                pal += hand * smooth(0.15, 0.6, n @ pn)
            pal += smooth(0.45, 0.8, -n[..., 2]) * (p[..., 2] < 0.05)
            pal = np.clip(pal, 0, 1)
            pale = tex.hexc(sk.get('palm', '#d9a48c'))
            alb = alb * (1 - pal[..., None] * (0.25 + 0.6 * dark)) + pale * pal[..., None] * (0.25 + 0.6 * dark) * (0.9 + 0.2 * fine[..., None])
        # lips: the colour deepens towards the seam, the lower lip is pinker in the middle
        lm = np.clip(m['lips'] * 1.15, 0, 1)
        if slot == 1:
            pink = lip_col * (0.85 + 0.3 * vnoise(p, (900, 60, 60), seed + 9))[..., None]
            lower = smooth(0.0, 0.008, mouth[2] - p[..., 2])[..., None] * blob(p, (0, mouth[1] - 0.01, mouth[2] - 0.007), 0.016)[..., None]
            pink = pink * (1 + 0.35 * lower)
            alb = alb * (1 - lm[..., None] * 0.92) + pink * lm[..., None] * 0.92
        nails = np.clip(m['fingernails'] + m['toenails'], 0, 1)
        alb = alb * (1 - nails[..., None] * 0.8) + tex.hexc(sk.get('nail', '#d8b0a4')) * nails[..., None] * 0.8
        ar = m['aureolae'][..., None]
        alb = alb * (1 - ar * 0.7) + lip_col * 0.7 * ar * 0.7
        height = np.zeros(p.shape[:2], np.float32)
        rough = 0.52 + 0.10 * (fine - 0.5) + 0.06 * pal
        # moles and freckles
        fr = sk.get('freckles', 0.0)
        spots = smooth(0.80 - 0.10 * fr, 0.86, vnoise(p, 600, seed + 21)) * smooth(0.45, 0.75, fbm(p, 14, 2, seed + 22)) * fr
        moles = smooth(0.9965, 0.9995, vnoise(p, 150, seed + 23)) * 0.8
        alb *= (1 - np.clip(spots * 0.35 + moles * 0.6, 0, 0.75))[..., None]
        # ---------- hair painted on the skin: shaved scalp, stubble, brows, lash line
        if scalp_attr is not None:
            sc = blur(scalp_attr[slot][..., 0], 6)
            sc = smooth(0.35, 0.75, sc + 0.25 * (fbm(p, 60, 2, seed + 31) - 0.5)) * spec['scalp']
            style = spec.get('scalp_style', 'buzz')
            # tight styles flow round the head's front-to-back axis and gather at the back
            lon = np.arctan2(p[..., 2] - (eyeL[2] + 0.045), p[..., 0])
            if style == 'rows':      # cornrows: braided ridges with scalp showing in the partings
                wave = np.sin(lon * 15)
                ridge = np.abs(wave)
                twist = 0.5 + 0.5 * np.sin(p[..., 1] * 300 + np.sign(wave) * ridge * 3.0)
                k = sc * (1 - 0.8 * smooth(0.2, 0.0, ridge))
                alb = alb * (1 - k[..., None]) + hair_col * 1.25 * (0.7 + 0.3 * twist)[..., None] * k[..., None]
                height += sc * (1.3 * ridge ** 0.6 * (0.65 + 0.35 * twist) - 0.2)
                rough += 0.2 * sc
            elif style == 'sleek':   # combed back: streaks that only vary across the flow
                flow = np.stack([lon * 26, np.zeros_like(lon), p[..., 1] * 3], -1)
                streak = fbm(flow, 1.0, 3, seed + 33)
                alb = alb * (1 - sc[..., None]) + hair_col * (0.75 + 0.9 * streak)[..., None] * sc[..., None]
                height += sc * 0.7 * (streak - 0.5)
                rough -= 0.12 * sc
            else:                    # buzz cut: stippled
                grain = 0.55 + 0.45 * smooth(0.3, 0.7, vnoise(p, 2200, seed + 32))
                k = sc * grain
                alb = alb * (1 - k[..., None]) + hair_col * 1.3 * k[..., None]
                height += 0.4 * k
                rough += 0.12 * sc
        if slot == 0:
            for br in spec.get('bruises', []):   # {'bone', 'off', 'r'}: old purple in the middle, yellowing at the rim
                c = R[br['bone']][0] + np.array(br['off'], np.float32)
                edge = 0.5 + 0.9 * (fbm(p, 45, 3, seed + 81) - 0.5)
                core = smooth(br['r'] * 0.75, br['r'] * 0.15, np.linalg.norm(p - c, axis=-1) * edge)
                halo = smooth(br['r'] * 1.25, br['r'] * 0.55, np.linalg.norm(p - c, axis=-1) * edge) - core
                alb = alb * (1 + (np.array([0.62, 0.42, 0.62], np.float32) - 1) * core[..., None] * br.get('a', 0.8))
                alb = alb * (1 + (np.array([1.0, 0.92, 0.55], np.float32) - 1) * np.clip(halo, 0, 1)[..., None] * 0.55 * br.get('a', 0.8))
            for tt in spec.get('tattoos', []):   # an image wrapped round a limb: {'bone', 'end', 't': (from, to), 'angle', 'span', 'image'}
                a, b = R[tt['bone']][0], R[tt['end']][0]
                ax = (b - a) / np.linalg.norm(b - a)
                t = ((p - a) @ ax) / np.linalg.norm(b - a)
                radial = (p - a) - ((p - a) @ ax)[..., None] * ax
                ref = np.cross(ax, np.array([0, 0, 1], np.float32))
                ref /= np.linalg.norm(ref)
                ang = np.degrees(np.arctan2(radial @ np.cross(ax, ref), radial @ ref))
                da = (ang - tt['angle'] + 180) % 360 - 180
                u = (t - tt['t'][0]) / (tt['t'][1] - tt['t'][0])
                v = da / tt['span'] + 0.5
                near = np.linalg.norm(radial, axis=-1) < 0.09
                ink = np.asarray(tt['image'].convert('L'), np.float32) / 255
                ih, iw = ink.shape
                ok = (u >= 0) & (u < 1) & (v >= 0) & (v < 1) & near
                smp = np.zeros_like(u)
                smp[ok] = ink[np.clip((v[ok] * ih).astype(int), 0, ih - 1), np.clip((u[ok] * iw).astype(int), 0, iw - 1)]
                smp = smp * (0.85 + 0.15 * fine) * tt.get('a', 0.85)
                alb = alb * (1 - smp[..., None]) + tex.hexc(tt.get('color', '#101820')) * smp[..., None]
        if slot == 1:
            st = spec.get('stubble', 0)
            if st:
                jaw = smooth(mouth[2] + 0.028, mouth[2] + 0.005, p[..., 2]) * smooth(0.02, -0.03, p[..., 1] - mouth[1] - 0.075)
                jaw *= 1 - np.clip(lm * 3, 0, 1)
                jaw = np.clip(jaw + 0.9 * blob(p, (0, mouth[1], mouth[2] + 0.012), 0.03) * (1 - np.clip(lm * 3, 0, 1)), 0, 1) * smooth(0.2, 0.6, fbm(p, 25, 2, seed + 41) + 0.25)
                dots = smooth(0.42, 0.62, vnoise(p, 2600, seed + 42))
                k = jaw * st * (0.45 + 0.55 * dots)
                alb = alb * (1 - k[..., None] * 0.8) + hair_col * 1.2 * k[..., None] * 0.8
                height += 0.5 * jaw * st * dots
            # brows: a few hundred hairs each, combed outwards
            bw = spec.get('brows', {})
            lines = []
            for s in (-1, 1):
                eye = eyeL if s > 0 else eyeR
                for _ in range(int(300 * bw.get('density', 1))):
                    t = rng.random() ** 0.85
                    thick = (0.0030 * (1 - t) ** 0.6 + 0.0008) * bw.get('thick', 1)
                    arch = bw.get('arch', 1) * (0.0075 * np.sin(min(t / 0.62, 1) * np.pi / 2) - 0.007 * max(0, t - 0.62) / 0.38)
                    x = eye[0] + s * (-0.017 + 0.049 * t)
                    z = eye[2] + 0.0195 + bw.get('raise', 0) + arch + (rng.random() - 0.5) * 2 * thick
                    ang = np.radians(55 * (1 - t) ** 2 + 4 + rng.normal(0, 9))  # inner hairs stand up, the tail lies flat
                    ln = 0.004 + 0.003 * rng.random()
                    pts = []
                    for q in (0, 0.5, 1):
                        hit = painter.project(x + s * np.cos(ang) * ln * q, z + np.sin(ang) * ln * q * (1 - 0.3 * q))
                        if hit is None:
                            break
                        pts.append(hit)
                    if len(pts) == 3:
                        lines.append(pts)
            bm_ = painter.strokes(lines, size, 1.0)
            bm_ = np.clip(bm_ * 1.1 + blur(bm_, 2) * 0.3, 0, 1) * bw.get('alpha', 0.92)
            alb = alb * (1 - bm_[..., None]) + hair_col * 1.1 * bm_[..., None]
            height += 0.6 * bm_
            rough += 0.1 * bm_
            # lash line: skin within a millimetre or two of the lid margins, heavier on the upper lid
            rim = spec.get('_rim')
            if rim is not None and len(rim):
                near = (np.linalg.norm(p - eyeL, axis=-1) < 0.032) | (np.linalg.norm(p - eyeR, axis=-1) < 0.032)
                pts = p[near]
                dm = np.linalg.norm(pts[:, None, :] - rim[None], axis=-1)
                upper = rim[np.argmin(dm, 1), 2] > eyeL[2] - 0.0005
                lmask = np.zeros(p.shape[:2], np.float32)
                lmask[near] = smooth(0.0026, 0.0007, dm.min(1)) * np.where(upper, 0.95, 0.5)
                lmask = lmask * spec.get('liner', 1)
                alb = alb * (1 - lmask[..., None]) + np.array([0.012, 0.009, 0.008], np.float32) * lmask[..., None]
            for sc_ in spec.get('scars', []):  # [(x, z) ...] polyline on the face, width in mm
                pts = [painter.project(x, z) for x, z in sc_['line']]
                dense = [list(np.array(a) + (np.array(b) - np.array(a)) * q) for a, b in zip(pts, pts[1:]) for q in np.linspace(0, 1, 8)]
                dense = [painter.project(q[0], q[2]) for q in dense]
                sm_ = painter.strokes([dense], size, sc_.get('width', 2.5) * 1.6)
                sm_ = np.clip(blur(sm_, 1) * 1.4, 0, 1) * (0.75 + 0.25 * vnoise(p, 900, seed + 51))
                alb = alb * (1 - sm_[..., None] * 0.75) + tex.hexc(sc_.get('color', '#c98f84')) * sm_[..., None] * 0.75
                height -= 0.9 * sm_
                rough -= 0.12 * sm_
            # brow ridge, forehead lines and crow's feet with age
            age = spec.get('wrinkles', 0)
            if age:
                fh = smooth(eyeL[2] + 0.028, eyeL[2] + 0.045, p[..., 2]) * smooth(eyeL[2] + 0.095, eyeL[2] + 0.07, p[..., 2]) * smooth(0.075, 0.045, np.abs(p[..., 0])) * (n[..., 1] < -0.3)
                lines_ = np.abs(np.sin((p[..., 2] + 0.004 * fbm(p, (40, 40, 8), 2, seed + 61)) * 520)) ** 0.35
                height -= age * 0.55 * fh * (1 - lines_)
                for s in (-1, 1):
                    eye = eyeL if s > 0 else eyeR
                    cf = blob(p, eye + np.array([s * 0.026, 0.012, -0.002]), 0.016)
                    ray = np.abs(np.sin(np.arctan2(p[..., 2] - eye[2], (p[..., 0] - eye[0]) * s) * 9)) ** 0.4
                    height -= age * 0.5 * cf * (1 - ray)
        # ---------- fine relief and roughness
        height += 0.10 * (vnoise(p, 1400, seed + 71) - 0.5) + 0.05 * (fine - 0.5)
        if slot == 1:
            crease = vnoise(p, (1300, 120, 120), seed + 72)
            height += lm * (0.5 * (crease - 0.5) - 0.1)
            tz = blob(p, (0, nose[1], eyeL[2] + 0.035), 0.05) + blob(p, nose, 0.03)   # forehead and nose shine
            rough -= 0.10 * np.clip(tz, 0, 1)
        rough = rough * (1 - lm * 0.45) * (1 - nails * 0.6)
        height += 0.35 * nails
        nor = tex.height_to_normal(blur(height, 1), spec.get('bump', 2.6) * size[1] / 2048)
        orm = np.stack([np.clip(0.35 + 0.65 * ao, 0, 1), np.clip(rough, 0.12, 0.95), np.zeros_like(ao)], -1)
        sfx = f'{name}_{"body" if slot == 0 else "head"}'
        out[slot] = (tex.save(alb, sfx + '_alb', linear=False), tex.save(nor, sfx + '_nor'), tex.save(orm, sfx + '_orm'))
    return out


def detail_map(path):
    """Tiling pore detail for PBRMaterial.detailMap (Babylon layout): R albedo, G normal y, B roughness, A normal x."""
    s = 512
    rng = np.random.default_rng(7)
    pts = rng.random((900, 2)) * s
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    f1 = np.full((s, s), 1e9, np.float32)
    for px, py in pts:  # worley distance on a torus: pores as cells
        dx = np.minimum(np.abs(xx - px), s - np.abs(xx - px))
        dy = np.minimum(np.abs(yy - py), s - np.abs(yy - py))
        f1 = np.minimum(f1, dx * dx + dy * dy)
    h = np.sqrt(f1)
    h = h / h.max()
    nrm = tex.height_to_normal(blur(h, 1), 9.0)
    img = np.stack([0.5 + 0.25 * (h - h.mean()), nrm[..., 1], 0.5 - 0.35 * (h - h.mean()), nrm[..., 0]], -1)
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), 'RGBA').save(path)
