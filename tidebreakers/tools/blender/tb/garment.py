"""Clothing, hair and accessory fields built around a Body.

Garments are offset shells of the body's own parts, so they fit exactly and deform with the same
weights. Cuts are half-spaces and slabs; folds are small displacements. Hair is a scalp cap plus
flattened tapered clumps (FlatTube) — the sculpted anime look.
"""
import math
import numpy as np
from . import sdf
from .sdf import Ellipsoid, RoundCone, Sphere, Box, Union, Intersect, Subtract, Offset, Shell, Plane, Func, FlatTube, look_rot


def v(*a):
    return np.array(a, float)


def norm(a):
    return a / np.linalg.norm(a)


def slab(axis, lo, hi):
    """Solid between two planes perpendicular to `axis` (world axis vector) at offsets lo..hi."""
    a = norm(np.asarray(axis, float))
    return Intersect([Plane(a, a * hi), Plane(-a, a * lo)])


def below(z):
    return Plane(v(0, 0, 1), v(0, 0, z))


def above(z):
    return Plane(v(0, 0, -1), v(0, 0, z))


def flare(f, base, grow, z_top, z_bot):
    """Offset of f that grows linearly from `base` at z_top to `base+grow` at z_bot (loose trousers, skirts)."""
    def g(p):
        t = np.clip((z_top - p[:, 2]) / max(z_top - z_bot, 1e-6), 0, 1)
        return f.eval(p) - (base + grow * t)
    return Func(g, f.lo - base - grow, f.hi + base + grow)


def folds(f, amp=0.004, freq=40.0, axis=(0, 0, 1), noise=0.5, seed=0):
    """Soft cloth folds: ripples across `axis` broken up by noise."""
    ax = norm(np.asarray(axis, float))

    def g(p):
        s = p @ ax
        n = sdf.fbm(p, 9.0, 3, seed)
        return amp * (np.sin(s * freq + n * 4.0 * noise) * 0.6 + n * 0.8)
    return sdf.Displace(f, g, amp * 1.5)


def wraps(f, a, b, amp=0.0025, bands=9):
    """Cloth wrapping bands along a limb segment a->b (gauntlet wraps, bandages)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    L = np.linalg.norm(d)
    d = d / L

    def g(p):
        t = ((p - a) @ d) / L
        ph = t * bands * 2 * math.pi + np.arctan2(p[:, 1] - a[1], p[:, 0] - a[0]) * 0.5
        return -amp * np.maximum(np.sin(ph), 0) ** 0.5
    return sdf.Displace(f, g, amp)


# ---------------------------------------------------------------------------------------------- hair

def scalp_point(anchor, theta, phi, rad_scale=1.0, lift=0.0):
    """Point on the cranium ellipsoid. theta: azimuth (0 = front, +90 = character's left), phi: elevation
    from the horizontal (90 = crown). Returns (point, outward normal)."""
    c = anchor['cranium']
    u = anchor['u']
    r = v(0.1, 0.114, 0.092) * u * rad_scale
    th, ph = math.radians(theta), math.radians(phi)
    d = v(math.sin(th) * math.cos(ph), -math.cos(th) * math.cos(ph), math.sin(ph))
    p = c + d * r
    n = norm(d / (r * r))
    return p + n * lift, n


def clump(anchor, theta, phi, length, width, direction, curl=0.0, thick=0.45, twist=0.0, steps=7, lift=0.004, droop=0.0):
    return FlatTube(*clump_data(anchor, theta, phi, length, width, direction, curl, thick, twist, steps, lift, droop))


def clump_data(anchor, theta, phi, length, width, direction, curl=0.0, thick=0.45, twist=0.0, steps=7, lift=0.004, droop=0.0):
    """One anime hair clump: rooted on the scalp, heading in `direction` (world vector, blended with the
    scalp normal), tapering to a point. curl bends it around the scalp normal; droop pulls it down."""
    u = anchor['u']
    root, n = scalp_point(anchor, theta, phi, lift=lift)
    d = norm(np.asarray(direction, float))
    pts, ws, ts, ns = [], [], [], []
    p = root.copy()
    seg = length * u / (steps - 1)
    cur = norm(d * 0.85 + n * 0.15)
    for i in range(steps):
        t = i / (steps - 1)
        pts.append(p.copy())
        # width: full near the root, tapering to a point with a slight belly
        w = width * u * (1 - t) ** 0.85 * (1 + 0.35 * math.sin(t * math.pi))
        ws.append(max(w, 0.0008))
        ts.append(max(w * thick, 0.0006))
        # flat direction: the clump lies along the head, so its thin axis follows the scalp normal
        fn = norm(n - cur * np.dot(n, cur))
        if twist:
            side = np.cross(cur, fn)
            fn = norm(fn * math.cos(twist * t) + side * math.sin(twist * t))
        ns.append(fn)
        # advance: curl toward the scalp normal's opposite (hugging the head) and droop under gravity
        cur = norm(cur - n * curl * 0.35 + v(0, 0, -1) * droop * 0.25)
        p = p + cur * seg
    return np.array(pts), np.array(ws), np.array(ts), np.array(ns)


def hair_cap(body, thickness=0.012, front=0.14, sides=0.10, back=0.03, k=0.006):
    """Scalp volume: the head offset outward, kept above a hairline (front height, temple height,
    nape height above the chin, in reference head units)."""
    a = body.face_anchor
    u = a['u']
    chin = a['chin']
    head = body.head_field
    cap = Offset(head, thickness * u)

    def hairline(p):
        # hairline height varies with azimuth around the head: front -> sides -> back
        rel = p - a['cranium']
        ang = np.arctan2(rel[:, 0], -rel[:, 1])  # 0 front, +-pi back
        c = np.abs(ang) / math.pi
        ta = np.clip(c / 0.5, 0, 1)
        tb = np.clip((c - 0.5) / 0.5, 0, 1)
        h = np.where(c < 0.5, front + (sides - front) * ta ** 1.5, sides + (back - sides) * tb ** 0.8)
        return (chin + h * u) - p[:, 2]
    hl = Func(hairline)
    return Intersect([cap, hl], k * u)
