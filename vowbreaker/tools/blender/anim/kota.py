"""
Kōta's own motion: he already knows. He stands very still with the crane cupped in both hands at his
chest and his head down; he walks slowly, short steps, not looking up; when he speaks he lifts his
head only a little.
"""
from anim._kit import shift, sway


def clips(A):
    o, sym = A.over, A.sym
    CUP = o(A.STAND, chest=(4, 0, 0), neck=(10, 0, 0), head=(18, 0, 0),
            **sym(upperarm_L=(-40, 16, -30), forearm_L=(-110, 0, -40), hand_L=(-20, 0, -10)))
    TALK = o(CUP, head=(6, 0, 0), neck=(4, 0, 0))
    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_relaxed', sway(A, CUP, 140, 0.8, 1.0, 1.0, 0.002), True)
    add('stand', sway(A, CUP, 160, 0.6, 0.8, 0.8, 0.002), True)
    add('walk', A.walk(stride=14, bob=0.008, arm=1, lean=6, base=CUP, n=44), True)
    add('walk_sad', A.walk(stride=12, bob=0.006, arm=1, lean=8, base=CUP, n=50), True)
    add('talk', [(0, CUP), (20, TALK), (60, TALK), (80, CUP)], True)
    return C
