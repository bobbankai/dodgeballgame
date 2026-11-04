#!/usr/bin/env python3
"""Foliage card textures from Poly Haven (CC0) scans (run with /opt/venv/bin/python).

Poly Haven's 1k foliage atlases are JPEG on black: alpha is recovered from luminance / saturation.
Outputs RGBA colour + OpenGL normal maps into public/assets/tex/foliage_<name>_{c,n}.png|webp:
  pine     a needle twig (pine_tree_01)          -> clustered into a pad sprite
  leaves   a broadleaf cluster (island_tree_01)  -> tinted per use (maple red, summer green)
  grass    grass clumps (grass_medium_01)
"""
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

PH = '/opt/raw/ph/model'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'tex')
rng = np.random.default_rng(11)


def load(p):
    return np.asarray(Image.open(os.path.join(PH, p)).convert('RGB'), dtype=np.float32) / 255.0


def alpha_from(rgb, lo=0.035, hi=0.11):
    lum = rgb.max(axis=2)
    a = np.clip((lum - lo) / (hi - lo), 0, 1)
    return a


def components(a, min_area=400):
    lab, n = ndimage.label(a > 0.5)
    objs = ndimage.find_objects(lab)
    out = []
    for i, sl in enumerate(objs):
        area = (lab[sl] == i + 1).sum()
        if area >= min_area:
            out.append((area, sl, i + 1))
    out.sort(key=lambda x: -x[0])
    return lab, out


def normal_from(rgba, strength=2.5):
    lum = rgba[..., :3].mean(axis=2) * rgba[..., 3]
    lum = ndimage.gaussian_filter(lum, 1.0)
    gx = ndimage.sobel(lum, axis=1)
    gy = ndimage.sobel(lum, axis=0)
    n = np.stack([-gx * strength, gy * strength, np.ones_like(lum)], axis=-1)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return (n * 0.5 + 0.5)


def bleed(rgb, a):
    """dilate colour into transparent texels so mips don't halo black"""
    rgb = rgb.copy()
    mask = a > 0.3
    for _ in range(12):
        if mask.all():
            break
        blur = ndimage.uniform_filter(rgb * mask[..., None], (5, 5, 1))
        w = ndimage.uniform_filter(mask.astype(np.float32), 5)
        fill = (~mask) & (w > 0.01)
        rgb[fill] = blur[fill] / w[fill, None]
        mask = mask | fill
    return rgb


def save(name, rgb, a, size):
    rgb = bleed(rgb, a)
    img = Image.fromarray((np.dstack([np.clip(rgb, 0, 1), a]) * 255).astype('uint8'), 'RGBA').resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, f'foliage_{name}_c.png'))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    n = normal_from(arr)
    Image.fromarray((n * 255).astype('uint8'), 'RGB').save(os.path.join(OUT, f'foliage_{name}_n.webp'), quality=92)
    print('ok', name)


def paste(dst_rgb, dst_a, src_rgb, src_a, x, y, angle, scale):
    s = Image.fromarray((np.dstack([src_rgb, src_a]) * 255).astype('uint8'), 'RGBA')
    w, h = s.size
    s = s.resize((max(2, int(w * scale)), max(2, int(h * scale))), Image.LANCZOS).rotate(angle, expand=True, resample=Image.BICUBIC)
    arr = np.asarray(s, dtype=np.float32) / 255.0
    H, W = dst_a.shape
    sh, sw = arr.shape[:2]
    x0, y0 = int(x - sw / 2), int(y - sh / 2)
    xs, ys = max(0, x0), max(0, y0)
    xe, ye = min(W, x0 + sw), min(H, y0 + sh)
    if xe <= xs or ye <= ys:
        return
    sub = arr[ys - y0:ye - y0, xs - x0:xe - x0]
    al = sub[..., 3:4]
    dst_rgb[ys:ye, xs:xe] = dst_rgb[ys:ye, xs:xe] * (1 - al) + sub[..., :3] * al
    dst_a[ys:ye, xs:xe] = np.maximum(dst_a[ys:ye, xs:xe], al[..., 0])


def pine():
    rgb = load('pine_tree_01/textures/pine_tree_01_twig_diff_1k.jpg')
    a = alpha_from(rgb)
    # the needle twigs are the bright green, elongated components
    lab, comps = components(a, 1500)
    twigs = []
    for area, sl, i in comps:
        crop = rgb[sl]
        m = (lab[sl] == i).astype(np.float32) * a[sl]
        g = (crop[..., 1] * m).sum() / max(m.sum(), 1)
        r = (crop[..., 0] * m).sum() / max(m.sum(), 1)
        hgt, wid = m.shape
        if g > r * 0.95 and max(hgt, wid) > 1.8 * min(hgt, wid):
            twigs.append((crop, m))
    if not twigs:
        twigs = [(rgb[comps[0][1]], (lab[comps[0][1]] == comps[0][2]).astype(np.float32))]
    # a dense pad: twigs radiating from the centre, top-down view
    N = 1024
    out_rgb = np.zeros((N, N, 3), np.float32)
    out_a = np.zeros((N, N), np.float32)
    for k in range(70):
        crop, m = twigs[k % len(twigs)]
        ang = rng.uniform(0, 360)
        r = rng.uniform(0, 0.3) * N
        cx = N / 2 + np.cos(np.radians(ang)) * r
        cy = N / 2 + np.sin(np.radians(ang)) * r
        shade = 0.75 + 0.35 * rng.random()
        paste(out_rgb, out_a, np.clip(crop * shade, 0, 1), m, cx, cy, -ang + 90 + rng.uniform(-25, 25), 0.55 * N / max(crop.shape))
    # soft round falloff
    yy, xx = np.mgrid[0:N, 0:N] / N - 0.5
    out_a *= np.clip(1.2 - np.hypot(xx, yy) * 2.3, 0, 1) ** 0.5
    save('pine', out_rgb, out_a, 512)


def leaves():
    rgb = load('island_tree_01/textures/island_tree_01_leaves_diff_1k.jpg')
    a = alpha_from(rgb, 0.05, 0.14)
    lab, comps = components(a, 800)
    ls = [(rgb[sl], (lab[sl] == i).astype(np.float32) * a[sl]) for _, sl, i in comps[:10]]
    N = 1024
    out_rgb = np.zeros((N, N, 3), np.float32)
    out_a = np.zeros((N, N), np.float32)
    for k in range(48):
        crop, m = ls[k % len(ls)]
        ang = rng.uniform(0, 360)
        r = rng.uniform(0.0, 0.32) * N
        cx = N / 2 + np.cos(np.radians(ang)) * r
        cy = N / 2 + np.sin(np.radians(ang)) * r
        shade = 0.7 + 0.4 * rng.random()
        paste(out_rgb, out_a, np.clip(crop * shade, 0, 1), m, cx, cy, -ang + 90 + rng.uniform(-40, 40), 0.3 * N / max(crop.shape))
    yy, xx = np.mgrid[0:N, 0:N] / N - 0.5
    out_a *= np.clip(1.25 - np.hypot(xx, yy) * 2.3, 0, 1) ** 0.5
    # neutral-ish so maple red / summer green can be tinted from vertex colour + material
    save('leaves', out_rgb, out_a, 512)


def grass():
    rgb = load('grass_medium_01/textures/grass_medium_01_diff_1k.jpg')
    a = alpha_from(rgb, 0.05, 0.13)
    # bottom-right quadrant holds full clumps
    H, W = a.shape
    sub_rgb = rgb[int(H * 0.72):, int(W * 0.45):]
    sub_a = a[int(H * 0.72):, int(W * 0.45):]
    lab, comps = components(sub_a, 2000)
    crop_rgb = sub_rgb[comps[0][1]]
    crop_a = (lab[comps[0][1]] == comps[0][2]).astype(np.float32) * sub_a[comps[0][1]]
    # pad to square, base at the bottom
    h, w = crop_a.shape
    S = max(h, w)
    out_rgb = np.zeros((S, S, 3), np.float32)
    out_a = np.zeros((S, S), np.float32)
    x0 = (S - w) // 2
    out_rgb[S - h:, x0:x0 + w] = crop_rgb
    out_a[S - h:, x0:x0 + w] = crop_a
    save('grass', out_rgb, out_a, 512)


def bamboo():
    """bamboo sprays: narrow lanceolate leaves fanning from a thin twig (drawn, then shaded)"""
    from PIL import ImageDraw
    N = 1024
    S = 4  # supersample
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    for spray in range(3):
        ox, oy = N * (0.25 + 0.25 * spray), N * (0.92 - 0.05 * spray)
        twig_len = N * 0.75
        ang0 = np.radians(-90 + (spray - 1) * 14)
        d = ImageDraw.Draw(img)
        tx, ty = ox + np.cos(ang0) * twig_len, oy + np.sin(ang0) * twig_len
        d.line([(ox, oy), (tx, ty)], fill=(88, 96, 40, 255), width=5)
        for k in range(7):
            t = 0.2 + 0.8 * k / 6
            bx, by = ox + (tx - ox) * t, oy + (ty - oy) * t
            side = 1 if k % 2 else -1
            a = ang0 + side * np.radians(rng.uniform(28, 55))
            L = N * rng.uniform(0.28, 0.4) * (1.1 - 0.3 * t)
            W = L * rng.uniform(0.11, 0.15)
            # leaf outline: tapered at both ends, widest a third of the way along
            pts_l, pts_r = [], []
            for i in range(25):
                u = i / 24
                w = W * (np.sin(np.pi * u ** 0.75)) * (1 - u * 0.15)
                cx, cy = bx + np.cos(a) * L * u, by + np.sin(a) * L * u
                nx, ny = -np.sin(a), np.cos(a)
                droop = (u ** 2) * L * 0.12 * side
                pts_l.append((cx + nx * (w + droop), cy + ny * (w + droop)))
                pts_r.append((cx - nx * (w - droop), cy - ny * (w - droop)))
            g = rng.uniform(0.85, 1.15)
            col = (int(70 * g), int(118 * g), int(38 * g), 255)
            d.polygon(pts_l + pts_r[::-1], fill=col)
            # midrib
            d.line([(bx, by), (bx + np.cos(a) * L * 0.95, by + np.sin(a) * L * 0.95 + (L * 0.1 * side) * 0)], fill=(int(120 * g), int(150 * g), int(70 * g), 255), width=2)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    rgb, a = arr[..., :3], arr[..., 3]
    # subtle shading: darker towards the twig, lighter tips, fine noise
    yy, xx = np.mgrid[0:N, 0:N] / N
    shade = 0.85 + 0.25 * (1 - yy) + ndimage.gaussian_filter(rng.random((N, N)), 2) * 0.2 - 0.1
    rgb = np.clip(rgb * shade[..., None], 0, 1)
    a = ndimage.gaussian_filter(a, 0.6)
    save('bamboo', rgb, a, 512)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    pine()
    leaves()
    grass()
    bamboo()
