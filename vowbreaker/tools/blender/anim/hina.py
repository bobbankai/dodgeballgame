"""
Hina's own motion: six, at the festival, delighted. She holds her fan up by her face and bobs on her
toes; she toddles in her geta with short quick steps; when she talks she waves the fan; she looks up
at the lanterns with her whole body.
"""
from anim._kit import shift, skip, sway


def clips(A):
    o, sym = A.over, A.sym
    FAN = o(A.STAND, chest=(-2, 0, 0), head=(-4, 6, 6),
            upperarm_L=(-60, 20, -30), forearm_L=(-110, 0, -20), hand_L=(-20, 0, 0),
            upperarm_R=(2, 32, 4), forearm_R=(-20, 0, 0))
    LOOKUP = o(FAN, chest=(-10, 0, 0), neck=(-10, 0, 0), head=(-26, 0, 0), upperarm_R=(-30, -20, 0), forearm_R=(-20, 0, 0))
    WAVE = o(FAN, upperarm_L=(-90, 10, -20), forearm_L=(-80, 0, 0), hand_L=(-30, 0, 40))
    CRY = o(A.CRY, **sym(upperarm_L=(-70, 26, -30), forearm_L=(-134, 0, -14), hand_L=(-40, 0, 0)))
    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_relaxed', [(0, FAN), (10, shift(A, FAN, hips_t=(0, 0, 0.012), head=(-2, 0, 0))), (20, FAN), (40, shift(A, FAN, hips=(0, 4, 0))), (60, FAN)], True)
    add('stand', sway(A, FAN, 60, 5.0, 2.0, 5.0, 0.01), True)
    add('walk', A.walk(stride=20, bob=0.02, arm=10, lean=2, base=FAN, n=20), True)
    add('run', skip(A, FAN, 16, 0.04, 30.0, 30.0), True)
    add('talk', [(0, FAN), (8, WAVE), (16, FAN), (24, WAVE), (40, FAN)], True)
    add('look_down', [(0, LOOKUP), (40, shift(A, LOOKUP, head=(-4, 4, 0))), (80, LOOKUP)], True)
    add('cry', [(0, CRY), (12, shift(A, CRY, chest=(8, 0, 0))), (24, CRY)], True)
    return C
