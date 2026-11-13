"""Procedural detail sets for worked metal, written next to the Poly Haven sets in public/assets/tex.

  python eclipse/tools/tex/gen_metal.py

Poly Haven's metal scans are industrial (tread plate, corrugated sheet), wrong for hand-forged
armour, so these are synthesised instead, tileable by construction (noise is shaped in the
frequency domain on a torus):

  gen_forged_steel  hammer-planished plate: overlapping shallow peen dents, long polishing streaks,
                    fine scratches in two directions, a little pitting. Neutral grey; the character
                    compositor tints it per material (steel, dark steel, gold, bronze).
  gen_chainmail     riveted rings in a 4-in-1 weave (each ring through four neighbours), with
                    height, occlusion between rings and wear on the ring tops.
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'tex')
N = 1024
rng = np.random.default_rng(7)


def spectral(n, lo, hi, aniso=1.0, angle=0.0, seed=0):
    """Tileable band-limited noise: white noise filtered to wavelengths between n/hi and n/lo."""
    r = np.random.default_rng(seed)
    f = np.fft.fftfreq(n) * n
    fy, fx = np.meshgrid(f, f, indexing='ij')
    c, s = np.cos(angle), np.sin(angle)
    u = fx * c + fy * s
    v = (-fx * s + fy * c) * aniso
    k = np.sqrt(u * u + v * v)
    band = np.exp(-((np.log(k + 1e-6) - np.log((lo + hi) / 2)) ** 2) / (2 * 0.6 ** 2)) * (k >= lo * 0.5) * (k <= hi * 2)
    w = np.fft.fft2(r.standard_normal((n, n))) * band
    out = np.real(np.fft.ifft2(w))
    return out / (out.std() + 1e-9)


def dents(n, count, rmin, rmax, seed=1):
    """Shallow hammer peens: spherical-cap dimples, wrapped so the tile repeats seamlessly."""
    r = np.random.default_rng(seed)
    h = np.zeros((n, n), np.float32)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    for _ in range(count):
        cx, cy = r.random(2) * n
        rad = r.uniform(rmin, rmax)
        dx = (xx - cx + n / 2) % n - n / 2
        dy = (yy - cy + n / 2) % n - n / 2
        d2 = (dx * dx + dy * dy) / (rad * rad)
        cap = np.clip(1 - d2, 0, None)
        h = np.minimum(h, -cap ** 1.5 * r.uniform(0.6, 1.0))
    return h


def scratches(n, count, seed=3, angle=0.2, spread=0.35):
    r = np.random.default_rng(seed)
    img = np.zeros((n, n), np.float32)
    for _ in range(count):
        a = angle + r.normal(0, spread)
        length = r.uniform(30, 260)
        x0, y0 = r.random(2) * n
        steps = int(length)
        t = np.arange(steps)
        xs = ((x0 + np.cos(a) * t) % n).astype(int)
        ys = ((y0 + np.sin(a) * t) % n).astype(int)
        img[ys, xs] = np.maximum(img[ys, xs], r.uniform(0.3, 1.0))
    # soften to sub-pixel width
    f = np.fft.fft2(img)
    k = np.fft.fftfreq(n)
    ky, kx = np.meshgrid(k, k, indexing='ij')
    img = np.real(np.fft.ifft2(f * np.exp(-(kx * kx + ky * ky) * (n * 0.9) ** 2 / 2 / (n / 2.2) ** 2)))
    return np.clip(img / (img.max() + 1e-6), 0, 1)


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


def save(name, rgb):
    Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name + '.webp'), quality=92)


def forged_steel():
    planish = dents(N, 1600, 12, 34, seed=11)
    planish = (planish - planish.mean()) / (planish.std() + 1e-6)
    waves = spectral(N, 2, 6, seed=2)
    streak = spectral(N, 30, 200, aniso=12, angle=0.15, seed=4)
    fine = scratches(N, 1600, seed=5, angle=0.15, spread=0.08)
    cross = scratches(N, 500, seed=6, angle=1.4, spread=0.6)
    pits = np.clip(spectral(N, 180, 400, seed=8) - 2.4, 0, None)
    h = planish * 0.55 + waves * 0.35 + streak * 0.05 - (fine * 0.5 + cross * 0.6) * 0.6 - pits * 0.8
    n = normal_from_height(h, 1.6)
    mottling = spectral(N, 3, 12, seed=9) * 0.022 + spectral(N, 20, 60, seed=10) * 0.015
    lum = 0.62 + mottling + streak * 0.008 + (fine + cross * 0.8) * 0.045 - pits * 0.12 + planish * 0.012
    rough = np.clip(0.3 + spectral(N, 4, 14, seed=12) * 0.06 + streak * 0.02 - (fine + cross) * 0.12 + pits * 0.25 + planish * 0.02, 0.05, 1)
    ao = np.clip(1 - pits * 0.4 - np.clip(-planish, 0, None) * 0.03, 0, 1)
    save('gen_forged_steel_c', np.repeat(lum[..., None], 3, -1))
    save('gen_forged_steel_n', n)
    save('gen_forged_steel_orm', np.stack([ao, rough, np.ones_like(ao)], -1))


def chainmail():
    """4-in-1 mail: rows of rings, alternate rows offset by half a ring; each ring is a torus seen
    from above, tilted so its upper edge rides over the next row."""
    rings_x = 32
    p = N / rings_x
    h = np.full((N, N), -1.0, np.float32)
    # every ring centre is evaluated over the pixels it can touch; the highest surface wins
    rr = p * 0.62
    tube = p * 0.16
    for j in range(-1, rings_x * 2 + 1):
        cy = j * p * 0.5
        off = (j % 2) * 0.5
        for i in range(-1, rings_x + 1):
            cx = (i + off) * p
            x0, x1 = int(cx - rr - tube - 2), int(cx + rr + tube + 3)
            y0, y1 = int(cy - rr - tube - 2), int(cy + rr + tube + 3)
            ys = np.arange(y0, y1) % N
            xs = np.arange(x0, x1) % N
            gy, gx = np.meshgrid(np.arange(y0, y1), np.arange(x0, x1), indexing='ij')
            dx = gx - cx
            dy = (gy - cy) * 1.15
            d = np.sqrt(dx * dx + dy * dy)
            t = np.clip(1 - ((d - rr) / tube) ** 2, 0, None)
            # the ring leans: its lower half sits higher, riding over the row below
            lean = (dy / rr) * 0.25 + 0.75
            ringh = np.sqrt(t) * lean
            sub = h[np.ix_(ys, xs)]
            h[np.ix_(ys, xs)] = np.where((ringh > 0) & (ringh > sub), ringh, sub)
    gap = h < 0
    h = np.where(gap, -0.6, h)
    blur = np.real(np.fft.ifft2(np.fft.fft2(h) * gauss(N, 2.5)))
    cavity = np.clip((blur - h) * 1.5, 0, 1)
    n = normal_from_height(h, 5.0)
    top = np.clip(h, 0, 1)
    lum = np.where(gap, 0.08, 0.45 + top * 0.35 + spectral(N, 20, 80, seed=21) * 0.03)
    rough = np.where(gap, 0.9, np.clip(0.45 - top * 0.2 + spectral(N, 10, 40, seed=22) * 0.05, 0.1, 1))
    ao = np.where(gap, 0.25, np.clip(1 - cavity * 0.6, 0.3, 1))
    save('gen_chainmail_c', np.repeat(lum[..., None], 3, -1))
    save('gen_chainmail_n', n)
    save('gen_chainmail_orm', np.stack([ao, rough, np.where(gap, 0.0, 1.0)], -1))


def gauss(n, sigma):
    k = np.fft.fftfreq(n)
    ky, kx = np.meshgrid(k, k, indexing='ij')
    return np.exp(-(kx * kx + ky * ky) * (2 * np.pi * sigma) ** 2 / 2)


if __name__ == '__main__':
    import sys
    if 'mail' not in sys.argv[1:]:
        forged_steel()
    if 'steel' not in sys.argv[1:]:
        chainmail()
    print('wrote gen_forged_steel, gen_chainmail')
