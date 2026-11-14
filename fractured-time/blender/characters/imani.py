"""
Dr. Imani Reyes (cast): lead temporal physicist, 38, Afro-Latina; sharp, warm, guarded. Built with the shared realistic-person pipeline.
  blender -b --factory-startup --python-exit-code 1 -P blender/characters/imani.py -- [--review outdir [--face-only|--body-only]] [--export]
Distinct from Ethan at a glance: a rounded natural afro (shells up to 55 mm with tight coils), a softer oval face with high cheekbones
and full lips, and civilian field clothes in slate teal and olive instead of an operator's kit.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import numpy as np  # noqa: E402

import imani_kit  # noqa: E402
import person  # noqa: E402
from person import sm  # noqa: E402


def mask(c, n, top):
    hz = c[:, 2] - top
    front = np.clip(-c[:, 1] / 0.09, 0, 1)
    thr = -0.128 + 0.046 * front         # hairline: low at the nape, a soft rounded line low on the forehead
    temple = sm(0.05, 0.07, np.abs(c[:, 0])) * sm(0.2, 0.7, front)
    thr = thr + temple * 0.006            # the afro comes down over the temples (no shaved sides)
    ears = sm(0.066, 0.074, np.abs(c[:, 0])) * (1 - sm(-0.135, -0.11, hz))
    return sm(thr, thr + 0.01, hz) * (1 - ears) * (n[:, 2] > -0.4)


def length(c, top):
    # a rounded afro: nearly the same length everywhere (the head's own roundness makes the dome), a little shorter at the nape
    hz = c[:, 2] - top
    return 0.036 + 0.01 * sm(-0.13, -0.06, hz)


def comb(c, n):
    return n * 1.0  # coily hair grows outward: the volume follows the head


SPEC = {
    'name': 'imani',
    'macro': {'gender': 0.0, 'age': 0.6, 'muscle': 0.5, 'weight': 0.46, 'proportions': 0.72, 'height': 0.52,
              'race': {'african': 0.62, 'caucasian': 0.26, 'asian': 0.12}},
    'targets': {
        'head-oval': 0.4, 'l-cheek-bones-incr': 0.4, 'r-cheek-bones-incr': 0.4, 'l-cheek-volume-decr': 0.15, 'r-cheek-volume-decr': 0.15,
        'chin-prominent-incr': 0.12, 'chin-width-decr': 0.12, 'mouth-upperlip-volume-incr': 0.18, 'mouth-lowerlip-volume-incr': 0.15,
        'mouth-cupidsbow-incr': 0.2, 'nose-point-width-decr': 0.1, 'nose-flaring-decr': 0.1, 'nose-scale-vert-decr': 0.06,
        'l-eye-scale-incr': 0.08, 'r-eye-scale-incr': 0.08, 'l-eye-corner1-up': 0.12, 'r-eye-corner1-up': 0.12,
        'neck-scale-horiz-decr': 0.12,
    },
    'skin': 'middleage_african_female',
    'brows': 'eyebrow006',
    'lashes': 'eyelashes03',
    'eye': 'brown_eye.png',
    'stubble': 0.0,
    'skin_params': {'sss_radius': (1.0, 0.36, 0.2), 'sss_scale': 0.0042, 'sat': 0.97, 'value': 0.98, 'scalp_color': (0.12, 0.085, 0.07)},
    'pore_strength': 0.42,
    'skin_spec': 0.29,
    'hair': {'mask': mask, 'length': length, 'comb': comb, 'curl': 1.0, 'curl_freq': 6.5, 'count': 120000, 'segments': 10,
             'melanin': 0.95, 'redness': 0.22, 'rough': 0.4, 'seed': 23, 'color': (0.024, 0.016, 0.012), 'shells': 30, 'max_len': 0.06,
             'cards': False, 'look': {'strandSpacing': 0.00055, 'coilRadius': 0.0007, 'coilTurns': 7.0}},
    'kit': lambda h, rig, PH: imani_kit.build_kit(h, rig, PH),
}

if __name__ == '__main__':
    person.main(SPEC)
