"""Scenery kits for chapters 2-5 (built with envkit's helpers; see envkit.py for the vertex format).

ashport   brick warehouses and terraced houses, the foundry and its stacks, mine headframe and lift,
          tunnel segments, rails and carts, the ore furnace, vent grates, coal, pipes, gates
market    hull-houses and barges lashed together, plank bridges, lantern strings, the soup kitchen
shoals    sea stacks, wrecks, Nell's little light, bottles, the Weeping Maw (head, plates, lure, tail)
citadel   marble columns and colonnades, floor slabs, grand stairs, the gate, braziers, banners, the
          Crown altar; Ys-Marrow: coral towers, domes, broken arches
"""
import math
import numpy as np
from envkit import Piece, box, cyl, prism_roof, rock_mesh, blob_mesh, hull, v, srgb, sdf, pc, E  # noqa: F401
from tb.wardrobe import disc

BRICK = '#9a4a32'
BRICK_D = '#6e3324'
SOOT = '#3a3330'
IRON = '#3c3f45'
TIMBER = '#5a3f2a'
MARBLE = '#f1ede4'
GOLD = '#d8ad48'


# ============================================================================================ Ashport
def windows_row(p, x0, x1, z, y, n, w=0.5, h=0.8, lit=0.5, face=-1, seed=0):
    rng = np.random.default_rng(seed)
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        glow = rng.random() < lit
        p.add(*box(v(x, y + face * 0.03, z), (w / 2, 0.05, h / 2), bevel=0.02), '#ffb050' if glow else '#2a2f3a', 'glow' if glow else 'plain')
        p.add(*box(v(x, y + face * 0.08, z - h / 2 - 0.05), (w / 2 + 0.08, 0.1, 0.05), bevel=0.02), '#b8a890', 'stone')
        p.add(*box(v(x, y + face * 0.07, z + h / 2 + 0.06), (w / 2 + 0.06, 0.08, 0.07), bevel=0.02), BRICK_D, 'brick')


def warehouse(name='warehouse', w=12.0, d=8.0, h=6.0, seed=0):
    p = Piece(name)
    p.add(*box(v(0, 0, 0.3), (w / 2 + 0.15, d / 2 + 0.15, 0.3), bevel=0.05), '#6f6a62', 'stone')
    p.add(*box(v(0, 0, 0.6 + h / 2), (w / 2, d / 2, h / 2), bevel=0.05), BRICK, 'brick')
    # pilasters
    for x in np.linspace(-w / 2, w / 2, 5):
        for sy in (1, -1):
            p.add(*box(v(x, sy * (d / 2 + 0.08), 0.6 + h / 2), (0.25, 0.12, h / 2 + 0.05), bevel=0.03), BRICK_D, 'brick')
    p.add(*box(v(0, 0, 0.6 + h + 0.12), (w / 2 + 0.2, d / 2 + 0.2, 0.15), bevel=0.04), '#8a7a66', 'stone')
    # big doors and windows on the front (-Y)
    p.add(*box(v(0, -d / 2 - 0.05, 0.6 + 1.9), (1.6, 0.08, 1.9), bevel=0.04), TIMBER, 'wood')
    for sx in (-0.8, 0.8):
        p.add(*box(v(sx, -d / 2 - 0.12, 0.6 + 1.9), (0.04, 0.05, 1.85), bevel=0.01), IRON, 'metal')
    windows_row(p, -w / 2, -2.2, 0.6 + 2.0, -d / 2, 2, lit=0.3, seed=seed)
    windows_row(p, 2.2, w / 2, 0.6 + 2.0, -d / 2, 2, lit=0.3, seed=seed + 1)
    windows_row(p, -w / 2, w / 2, 0.6 + 4.6, -d / 2, 6, w=0.45, h=0.7, lit=0.4, seed=seed + 2)
    # saw-tooth metal roof
    for i in range(3):
        x = -w / 2 + w * (i + 0.5) / 3
        for r in prism_roof(v(x, 0, 0.6 + h + 0.2), w / 3 - 0.1, d, 1.6, over=0.25, thick=0.12):
            p.add(*r, '#4a5058', 'metal')
    p.add(*box(v(w / 2 - 1.2, d / 4, 0.6 + h + 1.4), (0.35, 0.35, 1.4), bevel=0.04), BRICK_D, 'brick')
    p.add(*cyl(v(-w / 2 + 0.3, -d / 2 - 0.25, 0.4), v(-w / 2 + 0.3, -d / 2 - 0.25, 0.6 + h), 0.09, n=8), IRON, 'metal')
    return p


def rowhouse(name='rowhouse', w=4.0, d=5.0, h=6.2, wall='#a8553a', roof='#3a3d44', seed=0):
    p = Piece(name)
    p.add(*box(v(0, 0, 0.25), (w / 2 + 0.05, d / 2 + 0.05, 0.25), bevel=0.04), '#6f6a62', 'stone')
    p.add(*box(v(0, 0, 0.5 + h / 2), (w / 2, d / 2, h / 2), bevel=0.04), wall, 'brick')
    p.add(*box(v(0, 0, 0.5 + 3.0), (w / 2 + 0.08, d / 2 + 0.08, 0.1), bevel=0.03), '#8a7a66', 'stone')
    p.add(*box(v(-w * 0.22, -d / 2 - 0.04, 0.5 + 1.05), (0.5, 0.06, 1.05), bevel=0.03), ['#2f4a5a', '#5a2a2a', '#2f4a32'][seed % 3], 'wood')
    p.add(*box(v(-w * 0.22, -d / 2 - 0.4, 0.5 + 2.25), (0.75, 0.42, 0.06), bevel=0.02), '#3a3d44', 'metal')
    windows_row(p, 0.2, w / 2, 0.5 + 1.4, -d / 2, 1, lit=0.6, seed=seed)
    windows_row(p, -w / 2, w / 2, 0.5 + 4.2, -d / 2, 2, lit=0.55, seed=seed + 3)
    for r in prism_roof(v(0, 0, 0.5 + h), w, d, 1.7, over=0.3, thick=0.14):
        p.add(*r, roof, 'roof')
    p.add(*box(v(w * 0.3, d * 0.2, 0.5 + h + 1.3), (0.28, 0.4, 1.0), bevel=0.04), BRICK_D, 'brick')
    for k in range(3):
        p.add(*cyl(v(w * 0.3 - 0.15 + k * 0.15, d * 0.2, 0.5 + h + 2.3), v(w * 0.3 - 0.15 + k * 0.15, d * 0.2, 0.5 + h + 2.6), 0.06, n=6), '#7a4a3a', 'brick')
    return p


def chimney_stack(name='stack', h=22.0, r=1.3):
    p = Piece(name)
    p.add(*box(v(0, 0, 1.5), (r + 0.6, r + 0.6, 1.5), bevel=0.06), '#6f6a62', 'stone')
    p.add(*cyl(v(0, 0, 3.0), v(0, 0, h), r, r * 0.72, n=18, caps=False), BRICK, 'brick')
    for z in np.linspace(5, h - 1, 5):
        rr = r - (r - r * 0.72) * (z - 3) / (h - 3)
        p.add(*cyl(v(0, 0, z - 0.2), v(0, 0, z + 0.2), rr + 0.08, n=18, caps=False), BRICK_D, 'brick')
    p.add(*cyl(v(0, 0, h), v(0, 0, h + 0.6), r * 0.72 + 0.18, r * 0.75 + 0.12, n=18), SOOT, 'stone')
    return p


def foundry():
    p = Piece('foundry')
    W, D, H = 18.0, 12.0, 8.0
    p.add(*box(v(0, 0, 0.3), (W / 2 + 0.2, D / 2 + 0.2, 0.3), bevel=0.05), '#5f5a54', 'stone')
    p.add(*box(v(0, 0, 0.6 + H / 2), (W / 2, D / 2, H / 2), bevel=0.06), '#8a3f2c', 'brick')
    for x in np.linspace(-W / 2, W / 2, 7):
        p.add(*box(v(x, -D / 2 - 0.1, 0.6 + H / 2), (0.3, 0.14, H / 2 + 0.1), bevel=0.03), BRICK_D, 'brick')
    # glowing arched furnace windows
    for x in np.linspace(-W / 2 + 1.5, W / 2 - 1.5, 6):
        p.add(*box(v(x, -D / 2 - 0.03, 0.6 + 3.2), (0.7, 0.06, 1.6), bevel=0.05), '#ff7a2a', 'glow')
        p.add(*cyl(v(x, -D / 2 - 0.03, 0.6 + 4.8), v(x, -D / 2 - 0.1, 0.6 + 4.8), 0.7, n=12), '#ff8a3a', 'glow')
    p.add(*box(v(0, -D / 2 - 0.06, 0.6 + 1.6), (2.2, 0.08, 1.6), bevel=0.04), '#ff6a20', 'glow')
    for r in prism_roof(v(0, 0, 0.6 + H), W, D, 2.4, over=0.3, thick=0.16):
        p.add(*r, '#3a3d44', 'metal')
    for x in (-W / 3, W / 4):
        p.add(*cyl(v(x, D / 4, 0.6 + H), v(x, D / 4, 0.6 + H + 12), 0.9, 0.7, n=16, caps=False), BRICK, 'brick')
        p.add(*cyl(v(x, D / 4, 0.6 + H + 12), v(x, D / 4, 0.6 + H + 12.5), 0.95, n=16), SOOT, 'stone')
    # pipes along the wall
    for z in (2.2, 6.4):
        p.add(*cyl(v(-W / 2, -D / 2 - 0.5, z), v(W / 2, -D / 2 - 0.5, z), 0.18, n=10), '#5a5e66', 'metal')
    return p


def headframe():
    """Mine lift headframe: timber tower with a wheel, over a shaft cage."""
    p = Piece('headframe')
    for sx in (1, -1):
        for sy in (1, -1):
            p.add(*cyl(v(sx * 1.8, sy * 1.6, 0), v(sx * 1.1, sy * 1.0, 11.0), 0.18, 0.15, n=8), TIMBER, 'wood')
    for z in (3.5, 7.0, 10.5):
        for sy in (1, -1):
            p.add(*box(v(0, sy * (1.6 - z * 0.055), z), (1.9 - z * 0.065, 0.1, 0.1), bevel=0.02), TIMBER, 'wood')
        for sx in (1, -1):
            p.add(*box(v(sx * (1.8 - z * 0.065), 0, z), (0.1, 1.7 - z * 0.055, 0.1), bevel=0.02), TIMBER, 'wood')
    p.add(*disc(v(0, 0, 11.6), 1.3, 1.05, axis=(1, 0, 0), n=24, thick=0.18), IRON, 'metal')
    for k in range(6):
        a = k * math.pi / 3
        p.add(*cyl(v(0, 0, 11.6), v(0, math.cos(a) * 1.1, 11.6 + math.sin(a) * 1.1), 0.05, n=5), IRON, 'metal')
    p.add(*cyl(v(0, 0, 11.6), v(0, 0, 1.0), 0.03, n=5), '#8a8a80', 'metal')
    # the cage
    p.add(*box(v(0, 0, 0.05), (1.2, 1.2, 0.08), bevel=0.02), '#4a4038', 'wood')
    for sx in (1, -1):
        for sy in (1, -1):
            p.add(*cyl(v(sx * 1.15, sy * 1.15, 0), v(sx * 1.15, sy * 1.15, 2.6), 0.05, n=6), IRON, 'metal')
    p.add(*box(v(0, 0, 2.6), (1.2, 1.2, 0.06), bevel=0.02), IRON, 'metal')
    for z in (0.9, 1.8):
        for sx in (1, -1):
            p.add(*box(v(sx * 1.15, 0, z), (0.03, 1.15, 0.03), bevel=0.01), IRON, 'metal')
        p.add(*box(v(0, 1.15, z), (1.15, 0.03, 0.03), bevel=0.01), IRON, 'metal')
    return p


def tunnel(name='tunnel', L=6.0, W=5.0, H=4.2, seed=0):
    """A mine tunnel segment along Y: rough rock walls and ceiling with timber sets. Open ends."""
    p = Piece(name)
    n = 14
    rings = 7
    rng = np.random.default_rng(seed)
    V, F = [], []
    for i in range(rings):
        y = -L / 2 + L * i / (rings - 1)
        for k in range(n):
            a = math.pi * k / (n - 1)
            rx = W / 2 * (1 + 0.08 * rng.standard_normal())
            rz = H * (1 + 0.06 * rng.standard_normal())
            x = -math.cos(a) * rx
            z = min(math.sin(a) ** 0.55 * rz, rz) if k not in (0, n - 1) else -0.3
            V.append(v(x, y, z))
    for i in range(rings - 1):
        for k in range(n - 1):
            a = i * n + k
            F.append((a, a + n, a + n + 1, a + 1))
    Vs, Fs = pc.shell(np.array(V), F, 0.4)
    p.add(Vs, Fs, '#5a4e44', 'rock')
    for y in (-L / 2 + 0.6, L / 2 - 0.6):
        for sx in (1, -1):
            p.add(*cyl(v(sx * (W / 2 - 0.45), y, 0), v(sx * (W / 2 - 0.55), y, H - 0.7), 0.17, n=8), TIMBER, 'wood')
        p.add(*box(v(0, y, H - 0.55), (W / 2 - 0.3, 0.17, 0.17), bevel=0.03), TIMBER, 'wood')
    p.add(*cyl(v(W / 2 - 0.9, -L / 2, H - 0.9), v(W / 2 - 0.9, L / 2, H - 0.9), 0.025, n=5), '#2a2a2a', 'metal')
    p.add(*cyl(v(W / 2 - 0.9, 0, H - 1.0), v(W / 2 - 0.9, 0, H - 1.35), 0.12, 0.09, n=8), '#ffc870', 'glow')
    return p


def rails(L=6.0):
    p = Piece('rails')
    for sx in (0.55, -0.55):
        p.add(*box(v(sx, 0, 0.12), (0.04, L / 2, 0.05), bevel=0.01), '#55585e', 'metal')
    for y in np.linspace(-L / 2 + 0.3, L / 2 - 0.3, 9):
        p.add(*box(v(0, y, 0.04), (0.8, 0.11, 0.05), bevel=0.015), '#4a3a2a', 'wood')
    return p


def minecart():
    p = Piece('minecart')
    V, F = pc.box_mesh(v(0, 0, 0.75), (0.65, 0.9, 0.42), bevel=0.04)
    p.add(V, F, '#6a4a32', 'wood')
    p.add(*box(v(0, 0, 1.12), (0.6, 0.85, 0.06), bevel=0.02), '#1e1c1c', 'rock')
    for sy in (0.55, -0.55):
        for sx in (0.62, -0.62):
            p.add(*disc(v(sx, sy, 0.3), 0.28, 0.0, axis=(1, 0, 0), n=12, thick=0.08), IRON, 'metal')
    for z in (0.5, 1.0):
        p.add(*box(v(0, 0, z), (0.68, 0.93, 0.04), bevel=0.01), IRON, 'metal')
    V, F = blob_mesh([v(0, -0.3, 1.2), v(0.2, 0.3, 1.25), v(-0.2, 0.1, 1.22)], [0.35, 0.3, 0.32], res=0.06, k=0.2, seed=4, noise=0.08)
    p.add(V, F, '#2a2726', 'rock')
    return p


def ore_furnace():
    """The boss arena centrepiece: a domed brick furnace with a glowing mouth, bellows and pipes."""
    p = Piece('furnace')
    p.add(*cyl(v(0, 0, 0), v(0, 0, 1.2), 5.2, 5.0, n=28), '#4a4440', 'stone')
    p.add(*cyl(v(0, 0, 1.2), v(0, 0, 7.0), 4.6, 3.6, n=28, caps=False), '#8a3f2c', 'brick')
    for z in (2.2, 4.4, 6.4):
        r = 4.6 - (z - 1.2) / 5.8
        p.add(*cyl(v(0, 0, z - 0.18), v(0, 0, z + 0.18), r + 0.12, n=28, caps=False), IRON, 'metal')
    p.add(*cyl(v(0, 0, 7.0), v(0, 0, 9.5), 3.6, 1.2, n=28), BRICK_D, 'brick')
    p.add(*cyl(v(0, 0, 9.5), v(0, 0, 18), 1.2, 0.95, n=16, caps=False), BRICK, 'brick')
    # glowing mouth facing -Y
    p.add(*box(v(0, -4.4, 2.6), (1.6, 0.4, 1.3), bevel=0.1), '#ff7020', 'glow')
    p.add(*cyl(v(0, -4.5, 3.9), v(0, -4.8, 3.9), 1.6, n=16), '#ff9030', 'glow')
    p.add(*box(v(0, -4.75, 1.25), (2.0, 0.4, 0.12), bevel=0.04), IRON, 'metal')
    for sx in (1, -1):
        p.add(*cyl(v(sx * 4.0, -1, 3), v(sx * 7.5, -3, 0.5), 0.35, n=10), '#5a5e66', 'metal')
    return p


def vent():
    p = Piece('vent')
    p.add(*cyl(v(0, 0, -0.05), v(0, 0, 0.12), 1.4, 1.35, n=20), IRON, 'metal')
    p.add(*cyl(v(0, 0, 0.0), v(0, 0, 0.1), 1.15, n=20), '#ff6a20', 'glow')
    for k in range(-3, 4):
        p.add(*box(v(k * 0.3, 0, 0.13), (0.05, 1.1 * math.sqrt(max(0.05, 1 - (k * 0.3 / 1.15) ** 2)), 0.04), bevel=0.01), '#2a2b2f', 'metal')
    return p


def coal_pile():
    p = Piece('coal')
    V, F = blob_mesh([v(0, 0, 0.1), v(0.8, 0.3, 0), v(-0.7, -0.2, 0), v(0.2, 0.6, 0.1)], [1.0, 0.8, 0.75, 0.6], res=0.07, k=0.4, seed=8, noise=0.12)
    V[:, 2] = np.maximum(V[:, 2], -0.05)
    p.add(V, F, '#242222', 'rock')
    return p


def sacks():
    p = Piece('sacks')
    for i, (x, y, z) in enumerate([(0, 0, 0.25), (0.62, 0.05, 0.25), (0.3, 0.1, 0.7), (-0.6, 0.0, 0.25)]):
        p.add(*pc.quad_sphere(v(x, y, z), (0.32, 0.26, 0.24), res=3), '#9a8a6a', 'cloth')
    return p


def gate_iron(w=6.0, h=4.0):
    p = Piece('irongate')
    for sx in (1, -1):
        p.add(*box(v(sx * (w / 2 + 0.4), 0, h / 2 + 0.3), (0.45, 0.45, h / 2 + 0.3), bevel=0.05), BRICK_D, 'brick')
    for x in np.linspace(-w / 2 + 0.2, w / 2 - 0.2, 12):
        p.add(*cyl(v(x, 0, 0), v(x, 0, h), 0.04, n=6), IRON, 'metal')
        p.add(*cyl(v(x, 0, h), v(x, 0, h + 0.25), 0.05, 0.0, n=6), IRON, 'metal')
    for z in (0.4, h * 0.5, h - 0.2):
        p.add(*box(v(0, 0, z), (w / 2, 0.04, 0.05), bevel=0.01), IRON, 'metal')
    return p


def dock_crane():
    p = Piece('crane')
    p.add(*box(v(0, 0, 0.4), (1.2, 1.2, 0.4), bevel=0.05), '#5f5a54', 'stone')
    p.add(*cyl(v(0, 0, 0.8), v(0, 0, 7.5), 0.25, 0.2, n=10), TIMBER, 'wood')
    p.add(*cyl(v(0, 0, 7.0), v(0, -6.5, 8.5), 0.18, 0.12, n=8), TIMBER, 'wood')
    p.add(*cyl(v(0, 0, 3.5), v(0, -6.5, 8.4), 0.04, n=5), '#2a2a2a', 'metal')
    p.add(*cyl(v(0, -6.4, 8.4), v(0, -6.4, 3.5), 0.025, n=5), '#2a2a2a', 'metal')
    p.add(*box(v(0, -6.4, 3.2), (0.6, 0.6, 0.35), bevel=0.04), '#7a5a3a', 'wood')
    return p


def pipes():
    p = Piece('pipes')
    for k, z in enumerate((0.5, 1.1)):
        p.add(*cyl(v(-3, 0, z), v(3, 0, z), 0.2 - k * 0.05, n=10), '#5a5e66', 'metal')
        for x in (-2.5, 0, 2.5):
            p.add(*cyl(v(x, 0, z - 0.03), v(x, 0, z + 0.03), 0.24 - k * 0.05, n=10), '#3a3d44', 'metal')
    for x in (-2.6, 2.6):
        p.add(*box(v(x, 0, 0.4), (0.06, 0.25, 0.4), bevel=0.01), IRON, 'metal')
    return p


def chalk_wall():
    """Teo's drawings: a flat rock face with chalk figures painted as glow-free light strokes."""
    p = Piece('chalkwall')
    p.add(*box(v(0, 0, 1.4), (2.6, 0.25, 1.4), bevel=0.12), '#4e443c', 'rock')
    strokes = [((-1.6, 1.4), (-1.6, 0.6)), ((-1.6, 1.2), (-1.9, 0.95)), ((-1.6, 1.2), (-1.3, 0.95)), ((-1.6, 0.6), (-1.85, 0.25)), ((-1.6, 0.6), (-1.35, 0.25)),
               ((-0.9, 1.25), (-0.9, 0.6)), ((-0.9, 1.1), (-1.1, 0.9)), ((-0.9, 1.1), (-1.3, 1.15)), ((-0.9, 0.6), (-1.05, 0.3)), ((-0.9, 0.6), (-0.75, 0.3)),
               ((0.2, 2.2), (1.8, 2.2)), ((0.3, 1.9), (1.7, 1.9)), ((0.4, 1.6), (1.4, 1.6)), ((-0.2, 0.4), (2.0, 0.4)), ((0.6, 0.4), (1.0, 1.1)), ((1.0, 1.1), (1.4, 0.4))]
    for (a, b) in strokes:
        p.add(*cyl(v(a[0], -0.27, a[1]), v(b[0], -0.27, b[1]), 0.025, n=4), '#f2efe6', 'plain')
    for c, r in (((-1.6, 1.55), 0.15), ((-0.9, 1.4), 0.13), ((2.1, 2.5), 0.3)):
        ring = [v(c[0] + math.cos(t) * r, -0.27, c[1] + math.sin(t) * r) for t in np.linspace(0, 2 * math.pi, 10)]
        p.add(*pc.tube(np.array(ring), [0.022] * 10, n=4), '#f2efe6', 'plain')
    return p


# ============================================================================================ Drowned Market
def hullhouse(name='hullhouse', length=10.0, beam=4.2, color='#7a5a3a', shack='#c88a4a', roof='#4a6a8a', seed=0):
    p = Piece(name)
    p.add(*hull(length, beam, 1.8, sheer=0.4), color, 'wood')
    p.add(*box(v(0, 0, 0.0), (length / 2 - 0.6, beam / 2 - 0.2, 0.08), bevel=0.02), '#a07a52', 'wood')
    sw = length * 0.45
    p.add(*box(v(-length * 0.12, 0, 1.25), (sw / 2, beam / 2 - 0.45, 1.2), bevel=0.04), shack, 'wood')
    for r in prism_roof(v(-length * 0.12, 0, 2.45), sw, beam - 0.9, 1.0, over=0.35, thick=0.1):
        p.add(*r, roof, 'roof')
    p.add(*box(v(-length * 0.12 + sw / 2 + 0.02, 0, 1.0), (0.06, 0.45, 0.9), bevel=0.02), '#3a2a20', 'wood')
    for x in (-length * 0.12 - sw * 0.25, -length * 0.12 + sw * 0.15):
        p.add(*box(v(x, -(beam / 2 - 0.42), 1.5), (0.35, 0.05, 0.3), bevel=0.02), '#ffc060', 'glow')
    p.add(*cyl(v(length * 0.32, 0, 0), v(length * 0.32, 0, 4.5), 0.08, n=6), '#6a4a30', 'wood')
    rng = np.random.default_rng(seed)
    for i in range(4):
        x = length * 0.18 + rng.uniform(-0.6, 0.6)
        y = rng.uniform(-beam / 2 + 0.8, beam / 2 - 0.8)
        p.add(*box(v(x, y, 0.3), (0.3, 0.3, 0.3), bevel=0.02), '#9a7a52', 'wood')
    for x in np.linspace(-length / 2 + 1.0, length / 2 - 1.0, 7):
        for sy in (1, -1):
            p.add(*cyl(v(x, sy * (beam / 2 - 0.12), 0.0), v(x, sy * (beam / 2 - 0.15), 0.6), 0.04, n=5), '#6a4a30', 'wood')
    return p


def barge(name='barge', length=14.0, beam=7.0, stalls=True):
    p = Piece(name)
    p.add(*box(v(0, 0, -0.6), (length / 2, beam / 2, 0.7), bevel=0.15), '#5a4a3a', 'wood')
    p.add(*box(v(0, 0, 0.12), (length / 2 - 0.15, beam / 2 - 0.15, 0.05), bevel=0.02), '#a8845a', 'wood')
    for x in (-length / 2 + 0.2, length / 2 - 0.2):
        p.add(*box(v(x, 0, 0.35), (0.12, beam / 2, 0.25), bevel=0.03), '#6a4a30', 'wood')
    for i, (x, y) in enumerate([(-4, -2), (0, 2.2), (4, -2)] if stalls else []):
        for sx in (1, -1):
            for sy in (1, -1):
                p.add(*cyl(v(x + sx * 1.1, y + sy * 0.8, 0.15), v(x + sx * 1.1, y + sy * 0.8, 2.4), 0.05, n=6), '#6a4a30', 'wood')
        av = np.array([[x - 1.3, y - 1.1, 2.2], [x + 1.3, y - 1.1, 2.2], [x + 1.3, y + 1.0, 2.6], [x - 1.3, y + 1.0, 2.6]], float)
        Va, Fa = pc.shell(av, [(0, 1, 2, 3)], 0.03)
        col = ['#c84a3a', '#3a7a9a', '#d8a03a'][i]
        stripes = np.where((np.floor((Va[:, 0] - x + 2) * 2.5) % 2 == 0)[:, None], srgb(col), srgb('#f4ecd8'))
        p.add(Va, Fa, stripes, 'cloth', sway=0.15)
        p.add(*box(v(x, y - 0.4, 0.95), (1.2, 0.45, 0.05), bevel=0.02), '#8a6a48', 'wood')
    return p


def plank_bridge(L=4.0):
    p = Piece('plankbridge')
    for i, y in enumerate(np.linspace(-L / 2 + 0.15, L / 2 - 0.15, int(L / 0.3))):
        p.add(*box(v(0.02 * math.sin(i * 1.7), y, 0.04 * math.sin(i * 0.9)), (0.75, 0.13, 0.04), bevel=0.012), '#9a7a52' if i % 3 else '#8a6a48', 'wood')
    for sx in (0.7, -0.7):
        p.add(*box(v(sx, 0, -0.08), (0.06, L / 2, 0.06), bevel=0.01), '#5a4030', 'wood')
        rope = [v(sx, y, 0.9 - 0.15 * math.cos(math.pi * (y / L))) for y in np.linspace(-L / 2, L / 2, 8)]
        p.add(*pc.tube(np.array(rope), [0.025] * 8, n=4), '#c8b48a', 'cloth')
        for y in (-L / 2, L / 2):
            p.add(*cyl(v(sx, y, -0.1), v(sx, y, 1.0), 0.05, n=6), '#5a4030', 'wood')
    return p


def lantern_string(L=10.0, sag=1.2, n=7, seed=0):
    p = Piece(f'lanterns{seed}')
    rng = np.random.default_rng(seed)
    pts = [v(x, 0, -sag * (1 - (2 * x / L) ** 2)) for x in np.linspace(-L / 2, L / 2, 14)]
    p.add(*pc.tube(np.array(pts), [0.015] * 14, n=4), '#3a3028', 'cloth')
    cols = ['#ff9a4a', '#ffcf5a', '#ff6a5a', '#ffb070', '#ff8ac0']
    for i in range(n):
        x = -L / 2 + L * (i + 0.5) / n
        z = -sag * (1 - (2 * x / L) ** 2) - 0.3
        Vq, Fq = pc.quad_sphere(v(x, 0, z), (0.2, 0.2, 0.26), res=2)
        p.add(Vq, Fq, cols[int(rng.integers(len(cols)))], 'glow', sway=0.6)
    return p


def soup_pot():
    p = Piece('souppot')
    pts = [v(0, 0, 0.1), v(0, 0, 0.5), v(0, 0, 0.95)]
    p.add(*pc.tube(np.array(pts), [0.5, 0.62, 0.58], n=16, cap_root=True, cap_tip=False), '#2e2c2a', 'metal')
    p.add(*cyl(v(0, 0, 0.82), v(0, 0, 0.86), 0.56, n=16), '#c8783a', 'plain')
    for k in range(3):
        a = k * 2 * math.pi / 3
        p.add(*cyl(v(math.cos(a) * 0.5, math.sin(a) * 0.5, 0.15), v(math.cos(a) * 0.62, math.sin(a) * 0.62, -0.2), 0.04, n=5), '#2e2c2a', 'metal')
    p.add(*box(v(0, 0, -0.15), (0.45, 0.45, 0.06), bevel=0.02), '#ff6a20', 'glow')
    for k in range(5):
        a = k * 1.25
        p.add(*cyl(v(math.cos(a) * 0.35, math.sin(a) * 0.35, -0.18), v(math.cos(a + 2) * 0.35, math.sin(a + 2) * 0.35, -0.12), 0.06, n=5), '#4a3020', 'wood')
    # benches and a table
    for y in (-1.6, 1.6):
        p.add(*box(v(1.6, y, 0.45), (1.2, 0.18, 0.05), bevel=0.02), '#8a6a48', 'wood')
        for x in (0.7, 2.5):
            p.add(*box(v(x, y, 0.22), (0.05, 0.15, 0.22), bevel=0.01), '#6a4a30', 'wood')
    p.add(*box(v(1.6, 0, 0.78), (1.3, 0.6, 0.05), bevel=0.02), '#9a7a52', 'wood')
    for x in (0.6, 2.6):
        for y in (-0.45, 0.45):
            p.add(*box(v(x, y, 0.38), (0.05, 0.05, 0.38), bevel=0.01), '#6a4a30', 'wood')
    for i in range(4):
        p.add(*cyl(v(1.0 + i * 0.4, -0.2 + (i % 2) * 0.4, 0.83), v(1.0 + i * 0.4, -0.2 + (i % 2) * 0.4, 0.93), 0.09, 0.11, n=8), '#d8cfb8', 'plain')
    return p


def mooring_post():
    p = Piece('mooring')
    p.add(*cyl(v(0, 0, -3), v(0, 0, 1.4), 0.22, 0.2, n=10), '#5a4030', 'wood')
    p.add(*cyl(v(0, 0, 1.4), v(0, 0, 1.55), 0.25, 0.15, n=10), '#4a3020', 'wood')
    for z in (0.5, 0.65):
        p.add(*cyl(v(0, 0, z - 0.04), v(0, 0, z + 0.04), 0.24, n=10, caps=False), '#c8b48a', 'cloth')
    return p


# ============================================================================================ Weeping Shoals
def sea_stack(seed=0, h=14.0, r=3.5):
    p = Piece(f'stack{seed}')
    rng = np.random.default_rng(seed + 50)
    cs = [v(rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), z) for z in np.linspace(-3, h, 6)]
    rs = [r * (1.0 - 0.45 * (i / 5)) * rng.uniform(0.85, 1.1) for i in range(6)]
    f = sdf.Union([sdf.Sphere(c, rr) for c, rr in zip(cs, rs)], 1.6)
    f = sdf.Displace(f, lambda q: sdf.fbm(q, 0.7, 4, seed) * 0.9 + np.abs(np.sin(q[..., 2] * 1.3 if q.ndim > 1 else q[2] * 1.3)) * 0.25, 1.4)
    f = sdf.Intersect([f, sdf.Plane(v(0, 0, -1), v(0, 0, -3.2))])
    V, Q = sdf.mesh_field(f, res=0.28, verbose=False)
    col = np.where((V[:, 2] < 0.8)[:, None], srgb('#3a4a48'), srgb('#5a5c62'))
    col = np.where((V[:, 2] > h - 1.0)[:, None], srgb('#7a8278'), col)
    p.add(V, [tuple(q) for q in Q], col, 'rock')
    return p


def wreck(name='wreck', length=16.0):
    p = Piece(name)
    V, F = hull(length, 5.0, 2.8, sheer=0.7, n=14, rings=12)
    keep = V[:, 0] < length * 0.2
    # broken: drop the bow third, tilt
    idx = np.where(keep)[0]
    remap = {int(i): k for k, i in enumerate(idx)}
    F2 = [tuple(remap[i] for i in f) for f in F if all(i in remap for i in f)]
    V2 = V[idx]
    R = sdf.rot_y(0.35) @ sdf.rot_x(0.25)
    V2 = V2 @ R.T
    p.add(V2, F2, '#4a3a30', 'wood')
    for x in np.linspace(length * 0.2, length * 0.42, 4):
        rib = [R @ v(x, -math.cos(a) * 2.3, -math.sin(a) * 2.4 + 0.3) for a in np.linspace(0, math.pi, 7)]
        p.add(*pc.tube(np.array(rib), [0.12] * 7, n=5), '#3a2e26', 'wood')
    p.add(*cyl(R @ v(-1, 0, 0), R @ v(-1.5, 0.4, 7.5), 0.25, 0.15, n=8), '#3a2e26', 'wood')
    return p


def nell_light():
    """Nell's little lighthouse: a squat stone tower with a lamp room, a lean-to and a rain barrel."""
    p = Piece('nelllight')
    p.add(*cyl(v(0, 0, 0), v(0, 0, 7.0), 2.0, 1.6, n=18, caps=False), '#d8d2c4', 'stone')
    for z in (2.3, 4.6):
        p.add(*cyl(v(0, 0, z - 0.25), v(0, 0, z + 0.25), 1.95 - z * 0.055, n=18, caps=False), '#2f6a8a', 'plaster')
    p.add(*cyl(v(0, 0, 7.0), v(0, 0, 7.25), 1.9, n=18), '#2a2a30', 'metal')
    p.add(*cyl(v(0, 0, 7.25), v(0, 0, 8.6), 1.0, n=12, caps=False), '#ffe9a8', 'glow')
    for k in range(6):
        a = k * math.pi / 3
        p.add(*cyl(v(math.cos(a) * 1.02, math.sin(a) * 1.02, 7.25), v(math.cos(a) * 1.02, math.sin(a) * 1.02, 8.6), 0.04, n=5), '#2a2a30', 'metal')
    p.add(*cyl(v(0, 0, 8.6), v(0, 0, 9.4), 1.25, 0.1, n=12), '#2f6a8a', 'metal')
    p.add(*box(v(0, -1.85, 1.0), (0.5, 0.3, 0.95), bevel=0.04), '#6a4a30', 'wood')
    p.add(*box(v(2.6, 0, 1.0), (1.1, 1.4, 1.0), bevel=0.04), '#8a7a62', 'wood')
    for r in prism_roof(v(2.6, 0, 2.0), 2.2, 2.8, 0.7, over=0.2, thick=0.08):
        p.add(*r, '#5a6a72', 'roof')
    p.add(*cyl(v(-2.2, -1.0, 0), v(-2.2, -1.0, 0.9), 0.35, 0.32, n=10), '#6a4a30', 'wood')
    return p


def bottle():
    p = Piece('bottle')
    pts = [v(0, 0, 0), v(0, 0, 0.18), v(0, 0, 0.24), v(0, 0, 0.32)]
    p.add(*pc.tube(np.array(pts), [0.06, 0.06, 0.025, 0.022], n=10, cap_root=True, cap_tip=True), '#5fa89a', 'glow')
    p.add(*cyl(v(0, 0, 0.31), v(0, 0, 0.35), 0.024, n=6), '#8a6a48', 'wood')
    p.add(*box(v(0, 0, 0.1), (0.03, 0.03, 0.07), bevel=0.01), '#f4ecd8', 'plain')
    return p


def maw_head():
    """The Weeping Maw's head: a long armoured skull, open jaws, a lantern lure on a stalk, weeping eyes.
    Faces +X (Blender) = engine -X; pivot at the neck."""
    p = Piece('maw_head')
    f = sdf.Union([
        sdf.Ellipsoid(v(1.6, 0, 0.6), v(2.6, 1.35, 1.0)),
        sdf.Ellipsoid(v(3.6, 0, 0.45), v(1.6, 0.95, 0.65)),
        sdf.Ellipsoid(v(0.2, 0, 0.4), v(1.4, 1.3, 1.2)),
    ], 0.6)
    brow = sdf.Union([sdf.Ellipsoid(v(2.0, s * 0.85, 1.2), v(1.2, 0.35, 0.35)) for s in (1, -1)], 0.2)
    f = sdf.Union([f, brow], 0.25)
    f = sdf.Displace(f, lambda q: sdf.fbm(q, 2.2, 3, 7) * 0.12, 0.2)
    V, Q = sdf.mesh_field(f, res=0.09, verbose=False)
    col = np.where((V[:, 2] > 0.75)[:, None], srgb('#2f4a5a'), srgb('#8aa8a0'))
    p.add(V, [tuple(q) for q in Q], col, 'coral')
    # lower jaw, open
    jaw = sdf.Ellipsoid(v(2.6, 0, -0.55), v(2.4, 0.85, 0.45))
    Vj, Qj = sdf.mesh_field(jaw, res=0.09, verbose=False)
    Rj = sdf.rot_y(0.35)
    Vj = (Vj - v(0.6, 0, -0.2)) @ Rj.T + v(0.6, 0, -0.2)
    p.add(Vj, [tuple(q) for q in Qj], '#7a9890', 'coral')
    # teeth
    for i in range(9):
        x = 1.6 + i * 0.42
        for s in (1, -1):
            y = s * (0.7 - i * 0.05)
            p.add(*cyl(v(x, y, 0.05), v(x + 0.05, y, -0.4), 0.09, 0.0, n=5), '#efe8d8', 'plain')
            jp = Rj @ (v(x, y * 0.95, -0.35) - v(0.6, 0, -0.2)) + v(0.6, 0, -0.2)
            p.add(*cyl(jp, jp + v(0.04, 0, 0.38), 0.08, 0.0, n=5), '#efe8d8', 'plain')
    # weeping eyes (glow) with streaks
    for s in (1, -1):
        p.add(*pc.quad_sphere(v(2.4, s * 1.1, 1.0), (0.32, 0.18, 0.26), res=2), '#bff4ff', 'glow')
        streak = [v(2.4 - k * 0.1, s * (1.15 + k * 0.02), 0.85 - k * 0.32) for k in range(5)]
        p.add(*pc.tube(np.array(streak), [0.07, 0.06, 0.05, 0.04, 0.02], n=4), '#7fdcff', 'glow')
    # the lure
    stalk = [v(1.2, 0, 1.6), v(1.8, 0, 2.6), v(2.8, 0, 3.2), v(3.8, 0, 3.1), v(4.4, 0, 2.6)]
    p.add(*pc.tube(np.array(stalk), [0.16, 0.12, 0.09, 0.07, 0.06], n=6), '#2f4a5a', 'coral', sway=0.3)
    p.add(*pc.quad_sphere(v(4.5, 0, 2.3), (0.4, 0.4, 0.45), res=3), '#fff2a0', 'glow')
    # crest spines
    for i in range(6):
        x = 0.0 + i * 0.5
        p.add(*cyl(v(x, 0, 1.3 - i * 0.05), v(x - 0.5, 0, 2.3 - i * 0.12), 0.14, 0.0, n=5), '#2a3a48', 'coral')
    return p


def maw_segment():
    """One barnacled body segment (repeated along the serpent's spine)."""
    p = Piece('maw_seg')
    f = sdf.Ellipsoid(v(0, 0, 0), v(1.3, 1.25, 1.2))
    f = sdf.Displace(f, lambda q: sdf.fbm(q, 2.5, 3, 11) * 0.09, 0.15)
    V, Q = sdf.mesh_field(f, res=0.1, verbose=False)
    col = np.where((V[:, 2] > 0.25)[:, None], srgb('#2f4a5a'), srgb('#9ab8ae'))
    p.add(V, [tuple(q) for q in Q], col, 'coral')
    # dorsal plate and spines
    p.add(*box(v(0, 0, 1.15), (0.9, 0.7, 0.18), bevel=0.12, R=sdf.rot_y(0.15)), '#1f3442', 'coral')
    p.add(*cyl(v(0, 0, 1.2), v(-0.5, 0, 2.1), 0.18, 0.0, n=5), '#1a2a36', 'coral')
    rng = np.random.default_rng(3)
    for k in range(7):
        a = rng.uniform(0, 2 * math.pi)
        b = rng.uniform(0.2, 1.2)
        c = v(math.cos(a) * 0.9, math.sin(a) * 1.0, b * 0.7)
        p.add(*pc.quad_sphere(c, (0.16, 0.16, 0.1), res=2), '#d8d2c0', 'coral')
    return p


def maw_tail():
    p = Piece('maw_tail')
    pts = [v(0, 0, 0), v(-1.2, 0, 0.1), v(-2.4, 0, 0.25), v(-3.2, 0, 0.35)]
    p.add(*pc.tube(np.array(pts), [1.0, 0.75, 0.45, 0.2], n=12), '#2f4a5a', 'coral')
    fin = np.array([[-2.0, 0, 0.3], [-4.6, 0, 2.2], [-4.2, 0, 0.3], [-4.6, 0, -1.6]], float)
    p.add(*pc.shell(fin, [(0, 1, 2, 3)], 0.06), '#4a7a8a', 'coral', sway=0.4)
    return p


# ============================================================================================ citadel / Ys-Marrow
def column(name='column', h=9.0, r=0.55, broken=False, coral=False):
    p = Piece(name)
    p.add(*box(v(0, 0, 0.25), (r + 0.35, r + 0.35, 0.25), bevel=0.05), MARBLE, 'marble')
    p.add(*cyl(v(0, 0, 0.5), v(0, 0, 0.75), r + 0.2, r + 0.1, n=20), MARBLE, 'marble')
    top = h * (0.6 if broken else 1.0)
    # fluted shaft
    n = 24
    rings = 10
    V, F = [], []
    for i in range(rings):
        z = 0.75 + (top - 0.75 - (0 if broken else 0.8)) * i / (rings - 1)
        rr = r * (1 - 0.06 * (z / h))
        for k in range(n):
            a = 2 * math.pi * k / n
            fl = 1 - 0.07 * (0.5 + 0.5 * math.cos(a * 12))
            V.append(v(math.cos(a) * rr * fl, math.sin(a) * rr * fl, z))
    for i in range(rings - 1):
        for k in range(n):
            a0 = i * n + k
            a1 = i * n + (k + 1) % n
            F.append((a0, a1, a1 + n, a0 + n))
    p.add(np.array(V), F, MARBLE if not coral else '#d8d0c0', 'marble')
    if not broken:
        p.add(*cyl(v(0, 0, h - 0.8), v(0, 0, h - 0.5), r * 0.95, r + 0.3, n=20), GOLD, 'metal')
        p.add(*box(v(0, 0, h - 0.25), (r + 0.45, r + 0.45, 0.25), bevel=0.05), MARBLE, 'marble')
    else:
        V2, F2 = blob_mesh([v(0.1, 0, top), v(-0.2, 0.2, top - 0.2)], [r * 0.9, r * 0.7], res=0.08, k=0.2, seed=5, noise=0.2)
        p.add(V2, F2, MARBLE, 'marble')
    if coral:
        rng = np.random.default_rng(int(h * 10))
        cs = [v(math.cos(a) * r, math.sin(a) * r, z) for a, z in zip(rng.uniform(0, 6.28, 8), rng.uniform(0.5, top, 8))]
        V3, F3 = blob_mesh(cs, rng.uniform(0.25, 0.5, 8), res=0.07, k=0.25, seed=9, noise=0.12)
        p.add(V3, F3, '#e0785a', 'coral')
    return p


def floor_slab(name='slab', s=6.0, color=MARBLE, inlay=GOLD):
    p = Piece(name)
    p.add(*box(v(0, 0, -0.25), (s / 2, s / 2, 0.25), bevel=0.03), color, 'marble')
    for k in (-1, 1):
        p.add(*box(v(0, k * (s / 2 - 0.1), 0.005), (s / 2 - 0.1, 0.05, 0.01), bevel=0.0), inlay, 'metal')
        p.add(*box(v(k * (s / 2 - 0.1), 0, 0.005), (0.05, s / 2 - 0.1, 0.01), bevel=0.0), inlay, 'metal')
    return p


def grand_stairs(w=10.0, steps=8, rise=0.25, run=0.5):
    p = Piece('grandstairs')
    for i in range(steps):
        p.add(*box(v(0, i * run + run / 2, (i + 1) * rise / 2), (w / 2, run / 2 + 0.01, (i + 1) * rise / 2), bevel=0.02), MARBLE, 'marble')
    for sx in (1, -1):
        p.add(*box(v(sx * (w / 2 + 0.3), steps * run / 2, steps * rise / 2 + 0.3), (0.3, steps * run / 2 + 0.1, steps * rise / 2 + 0.3), bevel=0.04), '#e4ddd0', 'marble')
    return p


def citadel_gate(w=8.0, h=10.0):
    p = Piece('citadelgate')
    for sx in (1, -1):
        p.add(*box(v(sx * (w / 2 + 1.5), 0, h / 2 + 1), (1.5, 1.6, h / 2 + 1), bevel=0.08), MARBLE, 'marble')
        p.add(*box(v(sx * (w / 2 + 1.5), 0, h + 2.3), (1.8, 1.9, 0.3), bevel=0.05), GOLD, 'metal')
    # arch
    pts = [v(math.cos(a) * w / 2, 0, h - 1 + math.sin(a) * 2.2) for a in np.linspace(0, math.pi, 12)]
    p.add(*pc.tube(np.array(pts), [0.7] * 12, n=8, normals=np.tile(v(0, 1, 0), (12, 1)), flat=1.6), MARBLE, 'marble')
    for sx in (1, -1):
        p.add(*box(v(sx * w / 4, -0.2, (h - 1) / 2), (w / 4 - 0.05, 0.25, (h - 1) / 2), bevel=0.04), '#f6f2ea', 'marble')
        p.add(*disc(v(sx * w / 4, -0.47, h * 0.55), 1.0, 0.0, axis=(0, 1, 0), n=20, thick=0.08), GOLD, 'metal')
        for k in range(8):
            a = k * math.pi / 4
            p.add(*cyl(v(sx * w / 4 + math.cos(a) * 1.0, -0.47, h * 0.55 + math.sin(a) * 1.0), v(sx * w / 4 + math.cos(a) * 1.5, -0.47, h * 0.55 + math.sin(a) * 1.5), 0.12, 0.0, n=4), GOLD, 'metal')
    return p


def brazier():
    p = Piece('brazier')
    p.add(*cyl(v(0, 0, 0), v(0, 0, 0.2), 0.45, 0.4, n=12), MARBLE, 'marble')
    p.add(*cyl(v(0, 0, 0.2), v(0, 0, 1.0), 0.12, 0.1, n=10), GOLD, 'metal')
    pts = [v(0, 0, 1.0), v(0, 0, 1.25), v(0, 0, 1.45)]
    p.add(*pc.tube(np.array(pts), [0.2, 0.5, 0.62], n=14, cap_root=True, cap_tip=False), GOLD, 'metal')
    p.add(*cyl(v(0, 0, 1.38), v(0, 0, 1.42), 0.55, n=14), '#ff9a30', 'glow')
    return p


def banner(color='#f4f0e6', emblem=GOLD):
    p = Piece('banner')
    p.add(*cyl(v(-0.9, 0, 6.0), v(0.9, 0, 6.0), 0.05, n=6), GOLD, 'metal')
    bv = np.array([[-0.8, 0, 5.95], [0.8, 0, 5.95], [0.8, 0, 1.5], [0.0, 0, 1.0], [-0.8, 0, 1.5]], float)
    V, F = pc.shell(bv[[0, 1, 2, 4]], [(0, 1, 2, 3)], 0.02)
    sway = np.clip((5.95 - V[:, 2]) / 4.5, 0, 1) * 0.6
    cols = np.where((np.hypot(V[:, 0], V[:, 2] - 4.0) < 0.5)[:, None], srgb(emblem), srgb(color))
    p.add(V, F, cols, 'cloth', sway=sway)
    return p


def altar():
    p = Piece('altar')
    p.add(*cyl(v(0, 0, 0), v(0, 0, 0.4), 3.0, 2.8, n=24), MARBLE, 'marble')
    p.add(*cyl(v(0, 0, 0.4), v(0, 0, 0.8), 2.2, 2.0, n=24), '#e8e1d4', 'marble')
    p.add(*cyl(v(0, 0, 0.8), v(0, 0, 2.0), 0.5, 0.4, n=16), MARBLE, 'marble')
    p.add(*cyl(v(0, 0, 2.0), v(0, 0, 2.2), 0.8, n=16), GOLD, 'metal')
    for k in range(8):
        a = k * math.pi / 4
        p.add(*cyl(v(math.cos(a) * 2.6, math.sin(a) * 2.6, 0.4), v(math.cos(a) * 2.6, math.sin(a) * 2.6, 0.5), 0.15, n=8), '#9fe6ff', 'glow')
    return p


def coral_tower(seed=0, h=18.0):
    p = Piece(f'coraltower{seed}')
    rng = np.random.default_rng(seed + 70)
    p.add(*cyl(v(0, 0, -2), v(0, 0, h), 2.6, 1.8, n=20, caps=False), '#d8d0c0', 'marble')
    for z in np.linspace(2, h - 2, 4):
        for k in range(6):
            a = k * math.pi / 3 + z
            r = 2.6 - 0.8 * z / h
            p.add(*box(v(math.cos(a) * r, math.sin(a) * r, z), (0.25, 0.25, 0.6), bevel=0.05, R=sdf.rot_z(a)), '#1a2a3a', 'plain')
    # dome
    V, Q = sdf.mesh_field(sdf.Intersect([sdf.Ellipsoid(v(0, 0, h), v(2.4, 2.4, 2.8)), sdf.Plane(v(0, 0, -1), v(0, 0, h))]), res=0.12, verbose=False)
    p.add(V, [tuple(q) for q in Q], '#5aa8a0', 'marble')
    cs = [v(math.cos(a) * 2.3, math.sin(a) * 2.3, z) for a, z in zip(rng.uniform(0, 6.28, 14), rng.uniform(-1, h, 14))]
    V2, F2 = blob_mesh(cs, rng.uniform(0.4, 0.9, 14), res=0.1, k=0.3, seed=seed, noise=0.2)
    p.add(V2, F2, np.where((rng.random((len(V2), 1)) < 0.5), srgb('#e0785a'), srgb('#c85a8a')), 'coral')
    return p


def broken_arch(seed=0):
    p = Piece(f'brokenarch{seed}')
    for sx in (1, -1):
        p.add(*box(v(sx * 3.0, 0, 3.0), (0.6, 0.6, 3.0), bevel=0.06), '#d8d0c0', 'marble')
    pts = [v(math.cos(a) * 3.0, 0, 6.0 + math.sin(a) * 2.0) for a in np.linspace(0, math.pi * 0.62, 8)]
    p.add(*pc.tube(np.array(pts), [0.55] * 8, n=8, normals=np.tile(v(0, 1, 0), (8, 1)), flat=1.4), '#d8d0c0', 'marble')
    rng = np.random.default_rng(seed + 3)
    cs = [v(rng.uniform(-3.4, 3.4), rng.uniform(-0.6, 0.6), rng.uniform(0, 6.5)) for _ in range(8)]
    V2, F2 = blob_mesh(cs, rng.uniform(0.3, 0.6, 8), res=0.08, k=0.25, seed=seed + 1, noise=0.15)
    p.add(V2, F2, '#e0785a', 'coral')
    return p


def kelp(seed=0):
    p = Piece(f'kelp{seed}')
    rng = np.random.default_rng(seed + 90)
    for k in range(5):
        x, y = rng.uniform(-0.8, 0.8, 2)
        h = rng.uniform(2.5, 5)
        pts = [v(x + 0.3 * math.sin(t * 3 + k), y, t * h) for t in np.linspace(0, 1, 7)]
        V, F = pc.tube(np.array(pts), [0.12 * (1 - 0.6 * t) for t in np.linspace(0, 1, 7)], n=4, normals=np.tile(v(1, 0, 0), (7, 1)), flat=0.25)
        p.add(V, F, '#3a7a4a', 'foliage', sway=np.clip(V[:, 2] / h, 0, 1))
    return p


KITS = {
    'ashport': lambda: [warehouse(), warehouse('warehouse2', 10, 7, 5, seed=4), rowhouse('rowhouseA', seed=0), rowhouse('rowhouseB', 3.6, 5, 7.0, '#7a5a4a', '#2f3238', 1),
                        rowhouse('rowhouseC', 4.4, 5, 5.6, '#b8774a', '#41464e', 2), chimney_stack(), chimney_stack('stack_s', 14, 0.9), foundry(), headframe(),
                        tunnel('tunnel', seed=0), tunnel('tunnel_b', seed=3), rails(), minecart(), ore_furnace(), vent(), coal_pile(), sacks(), gate_iron(), dock_crane(), pipes(), chalk_wall()],
    'market': lambda: [hullhouse('hullhouseA', seed=0), hullhouse('hullhouseB', 9, 3.8, '#5a4a6a', '#d8b070', '#8a3a3a', 1), hullhouse('hullhouseC', 11, 4.4, '#3a5a4a', '#c86a4a', '#3a4a6a', 2),
                       barge(), barge('barge_open', stalls=False), plank_bridge(), lantern_string(10, 1.2, 7, 0), lantern_string(14, 1.8, 9, 1), soup_pot(), mooring_post()],
    'shoals': lambda: [sea_stack(0), sea_stack(1, 18, 4.2), sea_stack(2, 9, 2.6), wreck(), wreck('wreck_b', 12), nell_light(), bottle(), maw_head(), maw_segment(), maw_tail()],
    'citadel': lambda: [column(), column('column_broken', broken=True), column('column_coral', coral=True), column('column_coral_b', broken=True, coral=True),
                        floor_slab(), floor_slab('slab_dark', 6, '#cfc8bc', '#9fe6ff'), grand_stairs(), citadel_gate(), brazier(), banner(), altar(),
                        coral_tower(0), coral_tower(1, 24), broken_arch(0), broken_arch(1), kelp(0), kelp(1)],
}
