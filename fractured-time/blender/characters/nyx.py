"""
Commander Nyx (cast): leader of HELIX temporal security, 35, Ethan's recurring rival; precise, controlled, carrying something personal.
  blender -b --factory-startup --python-exit-code 1 -P blender/characters/nyx.py -- [--review outdir [--face-only|--body-only]] [--export]
Read at a glance: a cropped undercut, a lean athletic build, graphite command armour with crimson chronal light (HELIX's own colour
turned dark), no helmet: her face is the point.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import numpy as np  # noqa: E402

import nyx_kit  # noqa: E402
import person  # noqa: E402
from person import sm  # noqa: E402


def mask(c, n, top):
    hz = c[:, 2] - top
    front = np.clip(-c[:, 1] / 0.09, 0, 1)
    thr = -0.11 + 0.044 * front
    ears = sm(0.062, 0.07, np.abs(c[:, 0])) * (1 - sm(-0.115, -0.085, hz))
    return sm(thr, thr + 0.01, hz) * (1 - ears) * (n[:, 2] > -0.35)


def length(c, top):
    # undercut: clipped short on the sides and the back, longer on top (swept by the shell look into a short crop)
    hz = c[:, 2] - top
    return 0.003 + 0.024 * sm(-0.06, -0.025, hz)


def comb(c, n):
    d = n * 0.4
    d[:, 1] += 0.8
    return d


SPEC = {
    'name': 'nyx',
    'macro': {'gender': 0.0, 'age': 0.56, 'muscle': 0.66, 'weight': 0.4, 'proportions': 0.75, 'height': 0.6,
              'race': {'african': 0.1, 'caucasian': 0.45, 'asian': 0.45}},
    'targets': {
        'head-square': 0.15, 'l-cheek-bones-incr': 0.45, 'r-cheek-bones-incr': 0.45, 'l-cheek-volume-decr': 0.35, 'r-cheek-volume-decr': 0.35,
        'chin-prominent-incr': 0.18, 'chin-width-incr': 0.08, 'nose-hump-incr': 0.1, 'nose-point-width-decr': 0.12,
        'mouth-scale-horiz-decr': 0.08, 'mouth-lowerlip-volume-decr': 0.05, 'eyebrows-trans-down': 0.12,
        'l-eye-corner2-up': 0.1, 'r-eye-corner2-up': 0.1, 'neck-scale-horiz-decr': 0.05,
    },
    'skin': 'young_caucasian_female',
    'brows': 'eyebrow009',
    'lashes': 'eyelashes01',
    'eye': 'grey_eye.png',
    'stubble': 0.0,
    'skin_params': {'sss_radius': (1.0, 0.38, 0.22), 'sss_scale': 0.0045, 'sat': 0.9, 'value': 1.0, 'scalp_color': (0.06, 0.05, 0.045)},
    'pore_strength': 0.45,
    'skin_spec': 0.32,
    'hair': {'mask': mask, 'length': length, 'comb': comb, 'curl': 0.05, 'curl_freq': 1.0, 'count': 90000, 'segments': 6,
             'melanin': 0.92, 'redness': 0.05, 'rough': 0.32, 'seed': 31, 'color': (0.016, 0.014, 0.013), 'shells': 22, 'max_len': 0.03,
             'card_every': 8, 'look': {'strandSpacing': 0.0004, 'coilRadius': 0.00006, 'coilTurns': 0.3}},
    'kit': lambda h, rig, PH: nyx_kit.build_kit(h, rig, PH),
}

if __name__ == '__main__':
    person.main(SPEC)
