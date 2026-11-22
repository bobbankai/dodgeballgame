"""
Builds Vowbreaker's characters. Each one is its own module in chars/ (its own head, face, hair,
clothes, props and colours); this only runs them.

  blender -b -P vowbreaker/tools/blender/vbcast.py -- <name|a,b|all> [--preview out.png] [--export] [--save]
"""
import importlib
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(__file__))
import vbbody as B  # noqa: E402
import vbcore as core  # noqa: E402

CAST = {
    'itsuki': ('itsuki', {}), 'sayo': ('sayo', {}), 'mikami': ('mikami', {}), 'ryoga': ('ryoga', {}),
    'sojin': ('sojin', {}), 'sojin_young': ('sojin', {'young': True}),
    'mio': ('mio', {}), 'hina': ('hina', {}), 'kota': ('kota', {}), 'acolyte': ('acolyte', {}),
    'mudhand': ('mudhand', {}), 'umbrella': ('umbrella', {}), 'bride': ('bride', {}), 'shiragami': ('shiragami', {}),
}


def make(name):
    mod, kw = CAST[name]
    m = importlib.import_module(f'chars.{mod}')
    return m.build(**kw)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = argv[0].split(',') if argv and not argv[0].startswith('--') else ['itsuki']
    if names == ['all']:
        names = list(CAST)
    for name in names:
        core.reset()
        try:
            C = make(name)
            arm, body = B.finish(C)
        except Exception:
            traceback.print_exc()
            print('FAILED', name)
            continue
        if '--preview' in argv:
            out = argv[argv.index('--preview') + 1].replace('.png', f'_{name}.png')
            B.preview(C, arm, out, os.environ.get('VIEWS', 'front,face3q,back'))
        if '--export' in argv:
            B.export(C, arm, body)
        if '--save' in argv:
            import bpy
            os.makedirs(core.RAW, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(core.RAW, f'{name}.blend'))
