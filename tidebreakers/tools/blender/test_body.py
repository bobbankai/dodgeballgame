import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from tb import sdf, skeleton, body, bl
out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp/body'
bl.reset()
sk = skeleton.Skeleton()
bd = body.Body(sk, face='boy', build=0.55)
t = time.time()
V, Q = sdf.mesh_field(bd.field(), res=0.005)
print('mesh time', time.time() - t)
ob = bl.make_mesh('body', V, Q, colors=np.tile([0.85, 0.62, 0.5, 1], (len(V), 1)))
bl.setup_preview()
bl.render_views(out, target=(0, 0, 0.88), dist=3.6, lens=60)
bl.render_views(out + '_face', target=(0, -0.03, 1.57), dist=0.75, lens=60, views=[('front', 0, 2), ('q3', 35, 4), ('side', 90, 2)])
