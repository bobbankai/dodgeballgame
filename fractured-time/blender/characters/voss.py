"""
Director Soren Voss (cast): HELIX's director, 58; composed, persuasive, certain. Publicly restoring reality; privately the architect.
  blender -b --factory-startup --python-exit-code 1 -P blender/characters/voss.py -- [--review outdir [--face-only|--body-only]] [--export]
Read at a glance: tall, lean, an older Nordic face with deep-set eyes and a long jaw, silver hair swept back short, a tailored charcoal coat.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import numpy as np  # noqa: E402

import person  # noqa: E402
import voss_kit  # noqa: E402
from person import sm  # noqa: E402


def scalp(c, n, top):
    hz = c[:, 2] - top
    front = np.clip(-c[:, 1] / 0.09, 0, 1)
    thr = -0.11 + 0.052 * front          # a slightly receding hairline
    temple = sm(0.045, 0.07, np.abs(c[:, 0])) * sm(0.3, 0.8, front)
    thr = thr + temple * 0.024
    ears = sm(0.062, 0.07, np.abs(c[:, 0])) * (1 - sm(-0.115, -0.085, hz))
    return sm(thr, thr + 0.012, hz) * (1 - ears) * (n[:, 2] > -0.35)


def beard(c, n, top):
    """A short, boxed beard kept by a barber: jaw, chin and moustache joined, a crisp cheek line and neckline (the skin's stubble
    zone, lookdev.region_masks, with harder edges)."""
    hz = c[:, 2] - (top - 0.24)
    front = -c[:, 1]
    ax = np.abs(c[:, 0])
    jaw = sm(-0.042, -0.02, hz) * (1 - sm(0.04, 0.062, hz)) * sm(-0.025, 0.01, front) * (1 - sm(0.062, 0.08, ax))
    # the cheek line climbs toward the sideburns, which join the scalp hair in front of the ears
    side = sm(0.04, 0.068, ax) * sm(0.04, 0.11, hz) * (1 - sm(0.115, 0.13, hz)) * sm(-0.035, -0.01, front) * (1 - sm(0.02, 0.04, front))
    moust = sm(0.052, 0.059, hz) * (1 - sm(0.07, 0.079, hz)) * sm(0.068, 0.086, front) * (1 - sm(0.026, 0.04, ax))
    return np.maximum(np.maximum(jaw, side), moust)


def mask(c, n, top):
    return np.maximum(scalp(c, n, top), beard(c, n, top))


def length(c, top):
    hz = c[:, 2] - top
    head = 0.006 + 0.016 * sm(-0.08, -0.03, hz)   # short at the back and sides, a little longer on top to sweep back
    # beard: 8 mm on the jaw, 12 mm at the chin, 6 mm on the moustache and the neck
    hzb = c[:, 2] - (top - 0.24)
    chin = (1 - sm(0.012, 0.03, np.abs(c[:, 0]))) * (1 - sm(0.0, 0.03, hzb))
    bl = 0.011 + 0.006 * chin - 0.003 * sm(0.054, 0.058, hzb) - 0.003 * (1 - sm(-0.03, -0.01, hzb))
    w = beard(c, np.zeros_like(c), top)
    return np.where(w > 0.02, bl, head)


def comb(c, n, top=None):
    d = n * 0.08
    d[:, 1] += 0.9   # swept straight back, lying close to the head
    d[:, 2] -= 0.15 * np.clip((np.abs(c[:, 0]) - 0.04) / 0.03, 0, 1)  # the sides combed down a little
    if top is None:
        return d
    w = beard(c, n, top)[:, None]
    # beard hair lies down the face and a little outward; the moustache sweeps down and to the sides
    hzb = c[:, 2] - (top - 0.24)
    must = (sm(0.054, 0.058, hzb) * (1 - sm(0.072, 0.077, hzb)))[:, None]
    bd = n * 0.35 + np.array([0.0, 0.0, -0.85])
    bd[:, 0] += np.sign(c[:, 0]) * 0.25 * must[:, 0]
    return d * (1 - w) + bd * w


SPEC = {
    'name': 'voss',
    'macro': {'gender': 1.0, 'age': 0.78, 'muscle': 0.5, 'weight': 0.42, 'proportions': 0.7, 'height': 0.8,
              'race': {'african': 0.0, 'caucasian': 0.95, 'asian': 0.05}},
    'targets': {
        'head-rectangular': 0.3, 'chin-height-incr': 0.2, 'chin-prominent-incr': 0.25, 'chin-width-decr': 0.1,
        'l-cheek-bones-incr': 0.3, 'r-cheek-bones-incr': 0.3, 'l-cheek-volume-decr': 0.45, 'r-cheek-volume-decr': 0.45,
        'nose-hump-incr': 0.25, 'nose-scale-vert-incr': 0.12, 'nose-point-down': 0.1, 'mouth-upperlip-volume-decr': 0.3,
        'mouth-lowerlip-volume-decr': 0.2, 'eyebrows-trans-down': 0.3, 'l-eye-bag-incr': 0.3, 'r-eye-bag-incr': 0.3,
        'l-eye-height2-decr': 0.15, 'r-eye-height2-decr': 0.15,
    },
    'skin': 'old_caucasian_male',
    'brows': 'eyebrow004',
    'lashes': 'eyelashes01',
    'eye': 'blue_eye.png',
    'stubble': 0.25,
    'skin_params': {'sss_radius': (1.0, 0.4, 0.24), 'sss_scale': 0.0045, 'sat': 0.85, 'value': 1.0, 'scalp_color': (0.45, 0.42, 0.4)},
    'pore_strength': 0.6,
    'skin_spec': 0.3,
    'hair': {'mask': mask, 'length': length, 'comb': comb, 'comb_top': True, 'curl': 0.06, 'curl_freq': 1.2, 'count': 100000, 'segments': 6,
             'melanin': 0.24, 'redness': 0.0, 'random_color': 0.7, 'direct_color': (0.22, 0.22, 0.23), 'rough': 0.34, 'seed': 41, 'color': (0.3, 0.29, 0.28), 'shells': 20, 'max_len': 0.03,
             'card_every': 8, 'look': {'strandSpacing': 0.00035, 'coilRadius': 0.00004, 'coilTurns': 0.2, 'grey': 0.5}},
    'kit': lambda h, rig, PH: voss_kit.build_kit(h, rig, PH),
}

if __name__ == '__main__':
    person.main(SPEC)
