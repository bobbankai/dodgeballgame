"""
Animation authoring helpers shared by every humanoid (Ethan, the Echo, enemies).

Poses are dicts {bone: {'rx','ry','rz' degrees about the armature axes, 'tx','ty','tz' metres}} written for
the LEFT side; `both(L, R)` adds an explicitly authored right side, `mirror` flips a left spec to the right.
`ax` on a foot is its absolute pitch (+ = toes down) so feet stay flat whatever the leg is doing.

A clip is a list of (frame, pose) keys; every channel is smoothed by lib.clip's clamped Hermite spline, so
poses hold their values instead of overshooting. Frame rate is 30.
Events (hit windows, cancel windows, footsteps...) are returned in a sidecar dict and written to JSON.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
sys.path.insert(0, os.path.join(HERE, '..', 'characters'))
import ftlib as lib  # noqa: E402
import humanoid  # noqa: E402

FPS = 30
BODY = humanoid.BODY_BONES
PARENT = humanoid.PARENT
FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')
CHANNELS = ('rx', 'ry', 'rz', 'tx', 'ty', 'tz', 'ax')


def mirror(spec):
    """Mirror a {bone: {channel: value}} pose across the body: swap _L/_R, negate roll (ry), yaw (rz), side offset (tx).
    Bones without a side keep their name (their values are mirrored too)."""
    out = {}
    for bone, ch in spec.items():
        if bone.endswith('_L'):
            name = bone[:-2] + '_R'
        elif bone.endswith('_R'):
            name = bone[:-2] + '_L'
        else:
            name = bone
        out[name] = {k: (-v if k in ('ry', 'rz', 'tx') else v) for k, v in ch.items()}
    return out


def merge(*specs):
    out = {}
    for sp in specs:
        for b, c in sp.items():
            out.setdefault(b, {}).update(c)
    return out


def hand(curl, thumb=None, side='L'):
    """Finger curl in degrees (0 open .. 85 fist). Thumb follows at 0.5 unless given."""
    th = curl * 0.5 if thumb is None else thumb
    out = {}
    for f in ('index', 'middle', 'ring', 'pinky'):
        k = {'index': 0.9, 'middle': 1.0, 'ring': 1.05, 'pinky': 1.1}[f]
        out[f'{f}_1_{side}'] = {'ry': curl * 0.8 * k}
        out[f'{f}_2_{side}'] = {'ry': curl * 0.95 * k}
    out[f'thumb_1_{side}'] = {'ry': th * 0.5, 'rz': -th * 0.35}
    out[f'thumb_2_{side}'] = {'ry': th * 0.7}
    return out


def both(L=None, R=None, mirror_L=False):
    """Combine a left spec (names ending _L) and a right spec; mirror_L derives the right from the left."""
    L = L or {}
    if mirror_L:
        return merge(L, mirror(L))
    return merge(L, R or {})


def keyed(name, N, keys, loop=False, events=None):
    """Build channel splines from (frame, pose) keys and write the action. Returns the clip record."""
    bones = sorted({b for _, pose in keys for b in pose}, key=lambda b: BODY.index(b) if b in BODY else 999)
    ch = {}
    for b in bones:
        chans = {c for _, pose in keys for c in pose.get(b, {})}
        ch[b] = {}
        for c in chans:
            default = 0.0
            ch[b][c] = [(f, pose.get(b, {}).get(c, default)) for f, pose in keys]
    return dict(name=name, N=N, ch=ch, loop=loop, sym=None, events=events or {})


def author(arm, clips):
    """Key every clip into the armature as an Action (stored in an NLA track, like the Inkbound pipeline)."""
    p = lib.Poser(arm)
    meta = {}
    for c in clips:
        lib.clip(p, c['name'], c['N'], c['ch'], BODY, PARENT, loop=c['loop'], sym=c.get('sym'))
        meta[c['name']] = {'frames': c['N'], 'fps': FPS, 'loop': c['loop'], **c.get('meta', {}), 'events': c['events']}
    return meta
