"""
Tileable micro-detail textures for characters and the ball.

Knit and twill are modelled as real yarn (Bezier tubes) and baked with Cycles onto a flat tile
(tangent-space normal in RGB, ambient occlusion in A). Skin and pebbled rubber are periodic
height fields converted analytically. Every texture tiles seamlessly.

Run: blender -b -P tools/blender/bake_details.py [-- --size 1024 --only knit,skin]
Writes to src/assets/textures/.
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402


def parse():
    args = lib.script_args()
    opts = {'size': 512, 'only': None}
    for i, a in enumerate(args):
        if a == '--size':
            opts['size'] = int(args[i + 1])
        if a == '--only':
            opts['only'] = set(args[i + 1].split(','))
    return opts


# ------------------------------------------------------------------ knit (stockinette)
def knit(size):
    """Jersey knit: rows of interlocking V-shaped stitches, 8 columns x 10 rows per tile."""
    lib.reset_scene()
    C, R = 8, 10
    w, h = 1 / C, 1 / R
    r = w * 0.2
    strands = []

    def stitch(i, j):
        cx, cy = (i + 0.5) * w, (j + 0.5) * h
        for s in (-1, 1):
            # each leg rises from under the row below, arches over, and dives under the next row
            top = (cx + s * w * 0.42, cy + h * 0.62, r * 0.25)
            mid = (cx + s * w * 0.24, cy + h * 0.05, r * 1.25)
            bot = (cx + s * w * 0.04, cy - h * 0.55, r * 0.3)
            strands.append([top, mid, bot])

    for i in range(-1, C + 1):
        for j in range(-1, R + 1):
            stitch(i, j)
    yarn = lib.bezier_yarn('knit', strands, r)
    return lib.bake_tile([yarn], size, 'knit', samples=24, ao_distance=w * 0.6)


# ------------------------------------------------------------------ twill (shorts)
def twill(size):
    """Fine diagonal twill: 2/1 weave ribs at 45 degrees with a gentle over-under undulation."""
    lib.reset_scene()
    N = 14
    r = 0.5 / N * 0.72
    strands = []
    for k in range(-N - 2, 2 * N + 2):
        pts = []
        steps = 48
        for s in range(steps + 1):
            t = -0.15 + 1.3 * s / steps
            x = k / N + t
            y = t
            z = r * (0.55 + 0.45 * math.sin(2 * math.pi * t * N * 1.0))
            pts.append((x - 0.5, y, z))
        strands.append(pts)
    yarn = lib.bezier_yarn('twill', strands, r, resolution=2)
    return lib.bake_tile([yarn], size, 'twill', samples=16, ao_distance=r * 3)


# ------------------------------------------------------------------ skin
def skin(size):
    """Pores and fine creases: a soft cellular pattern plus low-frequency undulation."""
    f1, f2, _ = lib.periodic_voronoi(size, 900, seed=11)
    pores = -np.exp(-(f1 * size / 2.2) ** 2)          # small round dimples
    crease = lib.periodic_noise(size, 6, seed=3, octaves=3)
    fine = lib.periodic_noise(size, 40, seed=5, octaves=2)
    height = pores * 1.0 + crease * 0.9 + fine * 0.35
    n = lib.height_to_normal(height, strength=size / 360)
    ao = lib.cavity_from_height(height, 4) * 0.4 + 0.6
    return np.dstack([n, ao])


# ------------------------------------------------------------------ pebbled rubber (ball, grips)
def pebble(size):
    """Foam-rubber pebble grain: rounded cells separated by shallow grooves."""
    f1, f2, cid = lib.periodic_voronoi(size, 420, seed=7, jitter=1.0)
    # distance to the cell border → a rounded dome per cell with a narrow groove between
    t = 2 * f1 / (f1 + f2)            # 0 at the cell centre, 1 on its border
    dome = np.sqrt(np.clip(1 - t ** 2.4, 0, 1))
    rng = np.random.default_rng(3)
    cell_h = rng.random(420)[cid] * 0.2 + 0.8
    height = dome * cell_h + lib.periodic_noise(size, 28, seed=9, octaves=2) * 0.05
    n = lib.height_to_normal(height, strength=size / 90)
    ao = lib.cavity_from_height(height, 3) * 0.5 + 0.5
    return np.dstack([n, ao])


def main():
    opts = parse()
    size = opts['size']
    jobs = {'knit': knit, 'twill': twill, 'skin': skin, 'pebble': pebble}
    for name, fn in jobs.items():
        if opts['only'] and name not in opts['only']:
            continue
        rgba = fn(size)
        lib.save_rgba(os.path.join(lib.TEX_OUT, f'{name}.png'), rgba)


main()
