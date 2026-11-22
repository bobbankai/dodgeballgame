"""
Young Sōjin's own motion: twenty years before -- quick, warm, a little proud. A light, open stance;
fast palm combinations; he folds his arms into his sleeves when he talks and laughs with his head
back. The same techniques as the man he becomes, but thrown with a smile.
"""
import math

from anim._kit import bounce, shift, sway
import anim.sojin as old


def clips(A):
    o, sym = A.over, A.sym
    base = old.clips(A)
    STANCE = o(A.STANCE, hips_t=(0.0, 0.02, -0.08), chest=(6, 0, 10), head=(-4, 0, 6),
               upperarm_R=(-70, -20, 20), forearm_R=(-90, 0, -30), hand_R=(-10, 0, 60),
               upperarm_L=(-50, 30, -10), forearm_L=(-100, 0, 0), hand_L=(-10, 0, 0))
    SLEEVES = o(A.STAND, chest=(-2, 0, 0), head=(-2, 0, 0),
                **sym(upperarm_L=(-36, 24, -36), forearm_L=(-108, 0, -30), hand_L=(-10, 0, 0)))
    LAUGH = o(SLEEVES, chest=(-12, 0, 0), head=(-22, 0, 0))
    TALK = o(SLEEVES, head=(2, 4, 8), upperarm_R=(-30, -30, 10), forearm_R=(-80, 0, -20), hand_R=(-10, 0, 0))
    C = dict(base)

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_fight', bounce(A, STANCE, 28, 0.02, 6.0, 2.0), True)
    add('idle_relaxed', sway(A, SLEEVES, 100, 2.0, 1.0, 3.0, 0.005), True)
    add('stand', sway(A, SLEEVES, 110, 1.5, 0.8, 2.0, 0.004), True)
    add('walk', A.walk(stride=25, bob=0.02, arm=14, lean=3, n=32), True)
    add('talk', [(0, SLEEVES), (14, TALK), (40, TALK), (52, LAUGH), (64, SLEEVES)], True)
    add('victory', [(0, STANCE), (12, SLEEVES), (24, LAUGH), (50, LAUGH), (64, SLEEVES)])
    return C
