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


def mask(c, n, top):
    hz = c[:, 2] - top
    front = np.clip(-c[:, 1] / 0.09, 0, 1)
    thr = -0.11 + 0.052 * front          # a slightly receding hairline
    temple = sm(0.045, 0.07, np.abs(c[:, 0])) * sm(0.3, 0.8, front)
    thr = thr + temple * 0.024
    ears = sm(0.062, 0.07, np.abs(c[:, 0])) * (1 - sm(-0.115, -0.085, hz))
    return sm(thr, thr + 0.012, hz) * (1 - ears) * (n[:, 2] > -0.35)


def length(c, top):
    hz = c[:, 2] - top
    return 0.006 + 0.022 * sm(-0.08, -0.03, hz)


def comb(c, n):
    d = n * 0.25
    d[:, 1] += 0.9   # swept straight back
    return d


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
    'hair': {'mask': mask, 'length': length, 'comb': comb, 'curl': 0.06, 'curl_freq': 1.2, 'count': 80000, 'segments': 6,
             'melanin': 0.12, 'redness': 0.02, 'rough': 0.34, 'seed': 41, 'color': (0.36, 0.35, 0.34), 'shells': 20, 'max_len': 0.03,
             'card_every': 8, 'look': {'strandSpacing': 0.00035, 'coilRadius': 0.00004, 'coilTurns': 0.2}},
    'kit': lambda h, rig, PH: voss_kit.build_kit(h, rig, PH),
}

if __name__ == '__main__':
    person.main(SPEC)
