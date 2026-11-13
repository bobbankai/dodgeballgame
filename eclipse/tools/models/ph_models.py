#!/usr/bin/env python3
"""Download CC0 models from Poly Haven (glTF + 1k textures) into the raw cache (outside the repo).

  python3 eclipse/tools/models/ph_models.py <id> [<id> ...] [--res 1k]
  python3 eclipse/tools/models/ph_models.py forest        # the Forgotten Sanctuary's set

Models land in $ECLIPSE_RAW/phm/<id>/ (the .gltf, its .bin and textures/). Then
tools/blender/import_models.py decimates them to game budgets and writes GLBs with WebP textures.
Every asset on Poly Haven is CC0 (https://polyhaven.com/license).
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tex'))
from ph_fetch import API, RAW, fetch, get_json  # noqa: E402

SETS = {
    'forest': ['fern_02', 'shrub_02', 'shrub_03', 'shrub_04', 'tree_stump_01', 'tree_stump_02', 'root_cluster_02', 'single_root',
               'dead_tree_trunk', 'dead_tree_trunk_02', 'moss_01', 'boulder_01', 'stone_01', 'nettle_plant', 'weed_plant_02',
               'dry_branches_medium_01', 'pine_roots'],
}


def download(mid, res='1k'):
    files = get_json(f'{API}/files/{mid}')
    g = files['gltf'][res]['gltf']
    out = os.path.join(RAW, 'phm', mid)
    jobs = [(g['url'], os.path.join(out, os.path.basename(g['url'])), g.get('md5'))]
    for rel, info in g.get('include', {}).items():
        jobs.append((info['url'], os.path.join(out, rel), info.get('md5')))
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(lambda j: fetch(*j), jobs))
    print('downloaded', mid, len(jobs), 'files')
    return out


if __name__ == '__main__':
    A = sys.argv[1:]
    res = A[A.index('--res') + 1] if '--res' in A else '1k'
    ids = []
    for a in A:
        if a.startswith('--') or a == res:
            continue
        ids += SETS.get(a, [a])
    for mid in ids:
        download(mid, res)
