"""Motion generators shared by the per-character animation sets (keys are (frame, pose) lists)."""
import math


def add_t(p, key, d):
    v = p.get(key, (0.0, 0.0, 0.0))
    return tuple(a + b for a, b in zip(v, d))


def shift(A, pose, **delta):
    """A pose with some channels offset (rather than replaced)."""
    out = dict(pose)
    for k, d in delta.items():
        out[k] = add_t(pose, k, d)
    return out


def bounce(A, base, n=24, depth=0.03, knees=8.0, head=2.0):
    """A boxer's bounce on the balls of the feet: two dips per loop."""
    keys = []
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        k = (math.cos(ph * 4 * math.pi) * 0.5 + 0.5)
        p = shift(A, base, hips_t=(0, 0, -depth * k), thigh_L=(-knees * k, 0, 0), shin_L=(knees * 1.6 * k, 0, 0),
                  thigh_R=(-knees * k * 0.6, 0, 0), shin_R=(knees * 1.4 * k, 0, 0), head=(head * k, 0, 0), chest=(1.5 * k, 0, 0))
        keys.append((f, p))
    return keys


def sway(A, base, n=80, side=3.0, chest=2.0, head=3.0, hips=0.01):
    """A slow weight shift from foot to foot."""
    keys = []
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        s = math.sin(ph * 2 * math.pi)
        c = math.cos(ph * 2 * math.pi)
        p = shift(A, base, hips=(0, side * s, 0), hips_t=(hips * s, 0, -0.004 * (1 - c)), chest=(chest * (1 - c) * 0.5, -side * s * 0.6, 0),
                  head=(head * (1 - c) * 0.3, -side * s * 0.4, head * s * 0.3))
        keys.append((f, p))
    return keys


def hover(A, base, n=60, bob=0.05, tilt=4.0, sway_=2.0):
    """Floating: the whole body rises and sinks, the head lags."""
    keys = []
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        s = math.sin(ph * 2 * math.pi)
        p = shift(A, base, hips_t=(0, 0, bob * s), head=(tilt * -s, 0, sway_ * math.cos(ph * 2 * math.pi)), chest=(tilt * 0.5 * s, 0, 0))
        keys.append((f, p))
    return keys


def glide(A, base, n=40, step=8.0, bob=0.01, lean=2.0):
    """Walking without walking: the legs barely shift, the body slides (ghosts, the Umbrella)."""
    keys = []
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        c = math.cos(ph * 2 * math.pi)
        s = math.sin(ph * 2 * math.pi)
        p = shift(A, base, thigh_L=(-step * c, 0, 0), thigh_R=(step * c, 0, 0), hips_t=(0, 0, -bob * abs(s)), spine=(lean, 0, 0), head=(0, 0, 2 * s))
        keys.append((f, p))
    return keys


def crawl(A, a, b, n=24, lunge=0.0):
    """A four-legged crawl alternating between two mirrored poses."""
    pa = shift(A, a, hips_t=(0, -lunge, 0))
    return [(0, pa), (n // 2, b), (n, pa)]


def skip(A, base, n=24, hop=0.06, stride=30.0, arm=40.0):
    """A child's skip: hop-step on each foot, arms swinging wide."""
    keys = []
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        c = math.cos(ph * 2 * math.pi)
        s = math.sin(ph * 2 * math.pi)
        up = abs(math.sin(ph * 4 * math.pi))
        p = A.over(base, hips_t=(0, 0, hop * up - 0.02), hips=(0, 0, 6 * s),
                   thigh_L=(-stride * c - 20 * max(0, s), -2, 0), shin_L=(20 + 60 * max(0.0, s), 0, 0),
                   thigh_R=(stride * c - 20 * max(0, -s), 2, 0), shin_R=(20 + 60 * max(0.0, -s), 0, 0),
                   upperarm_L=(arm * c, 26, 0), forearm_L=(-40, 0, 0), upperarm_R=(-arm * c, -26, 0), forearm_R=(-40, 0, 0),
                   chest=(0, 0, -8 * s), head=(-4, 0, 4 * s))
        keys.append((f, p))
    return keys


def strike(seq):
    """seq: [(frame, pose)] -- returned as is; a marker for readability."""
    return list(seq)


def held(pose, n=60, breath=1.0, A=None):
    return A.breathe(pose, n, breath)
