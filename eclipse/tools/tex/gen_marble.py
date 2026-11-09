"""Procedural veined white marble, for statues, columns and dressed stone (the `sun_marble` set).

  /opt/bvenv/bin/python eclipse/tools/tex/gen_marble.py

Poly Haven's marble scans are tiled floors (grout lines every half metre) or raw cliff faces; a
statue or a column drum needs uncut slab stone, so this set is synthesised instead, tileable by
construction (every term is periodic over the tile):

  - a warm white ground with soft clouding (band-limited noise),
  - two systems of veins: a sine stripe whose phase is pushed around by turbulence, kept only near its
    zero crossings, so the lines wander, braid and fade like real metamorphic veining,
  - fine crackle veins (|noise - 1/2| small), a little darker where they cross the main veins,
  - polish: low roughness on the ground, duller veins, faint pitting in the normal map.

Writes sun_marble_{c,n,orm}.webp and updates the set's entry in tex/manifest.json.
"""
import json
import os

import numpy as np

from gen_metal import spectral, normal_from_height, save, OUT

N = 1024


def turbulence(n, seed, octaves=4, lo=1.0):
    t = np.zeros((n, n))
    amp = 1.0
    for o in range(octaves):
        t += amp * spectral(n, lo * 2 ** o, lo * 2 ** (o + 1), seed=seed + o)
        amp *= 0.5
    return t / 1.875


def vein_system(n, k, warp, width, seed):
    """Lines along a periodic stripe (k = whole cycles across the tile in x and y), warped."""
    yy, xx = np.mgrid[0:n, 0:n] / n
    phase = 2 * np.pi * (k[0] * xx + k[1] * yy) + warp * turbulence(n, seed)
    s = np.abs(np.sin(phase))
    # width itself wanders, so veins swell and pinch out
    w = width * np.clip(0.55 + 0.6 * spectral(n, 1, 3, seed=seed + 40), 0.05, 1.6)
    return np.clip(1 - s / np.maximum(w, 1e-4), 0, 1) ** 1.6


def marble():
    ground = 0.5 + 0.5 * np.tanh(spectral(N, 1, 3, seed=21) * 0.8)
    cloud = spectral(N, 2, 6, seed=22)
    fade = lambda seed, bias: np.clip(bias + 0.55 * spectral(N, 1, 2.5, seed=seed), 0, 1)
    major = vein_system(N, (1, 2), 1.15, 0.05, seed=30) * fade(35, 0.75)
    minor = vein_system(N, (2, -3), 1.5, 0.03, seed=50) * fade(55, 0.35)
    crackle = vein_system(N, (5, 3), 3.0, 0.016, seed=70) * fade(75, 0.05)
    halo = np.clip(vein_system(N, (1, 2), 1.15, 0.4, seed=30) * fade(35, 0.75) - major, 0, 1)   # the stain bleeding round a vein

    white = np.array([0.89, 0.87, 0.83])
    cream = np.array([0.86, 0.82, 0.74])
    grey = np.array([0.42, 0.41, 0.4])
    smoke = np.array([0.66, 0.65, 0.63])
    gold = np.array([0.62, 0.55, 0.42])
    col = white[None, None] * (1 - ground[..., None] * 0.6) + cream[None, None] * (ground[..., None] * 0.6)
    col *= (1 + 0.012 * cloud)[..., None]
    col = col * (1 - 0.3 * halo[..., None] ** 1.5) + smoke[None, None] * (0.3 * halo[..., None] ** 1.5)
    col = col * (1 - 0.55 * minor[..., None]) + smoke[None, None] * (0.55 * minor[..., None])
    vcol = grey[None, None] * (1 - ground[..., None] * 0.5) + gold[None, None] * (ground[..., None] * 0.5)
    col = col * (1 - 0.85 * major[..., None]) + vcol * (0.85 * major[..., None])
    col = col * (1 - 0.5 * crackle[..., None]) + grey[None, None] * (0.5 * crackle[..., None])

    pits = np.clip(spectral(N, 180, 360, seed=90) - 2.2, 0, None)
    height = -0.6 * major - 0.25 * minor - 0.3 * crackle - 0.5 * pits + 0.15 * spectral(N, 6, 24, seed=91)
    nrm = normal_from_height(height, 1.2)
    rough = np.clip(0.2 + 0.05 * cloud + 0.14 * major + 0.08 * crackle + 0.3 * np.clip(pits, 0, 1), 0.08, 0.6)
    ao = np.clip(1 - 0.18 * major - 0.1 * crackle - 0.4 * np.clip(pits, 0, 1), 0, 1)
    save('sun_marble_c', col)
    save('sun_marble_n', nrm)
    save('sun_marble_orm', np.stack([ao, rough, np.zeros_like(ao)], -1))

    mpath = os.path.join(OUT, 'manifest.json')
    man = json.load(open(mpath))
    man['sun_marble'] = {'albedo': [round(float(v), 4) for v in col.reshape(-1, 3).mean(0)], 'height': False, 'id': 'sun_marble',
                         'region': 'eclipse', 'roughness': round(float(rough.mean()), 3), 'size': N, 'src': 'gen_marble.py'}
    json.dump(man, open(mpath, 'w'), indent=1, sort_keys=True)


if __name__ == '__main__':
    marble()
    print('wrote sun_marble')
