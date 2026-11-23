"""
Mio's own motion -- and the Little Bell's, which wears her shape. As herself: hands behind her back,
swaying on her heels; she skips rather than walks; she runs with her arms everywhere. As the Little
Bell: she floats a hand's breadth off the floor with her head on one side and her arms hanging,
slaps and claws like a child in a tantrum, and screams with her head thrown back.
"""
import math

from anim._kit import hover, shift, skip, sway


def clips(A):
    o, sym = A.over, A.sym
    BEHIND = o(A.STAND, chest=(-4, 0, 0), head=(-2, 6, 4),
               **sym(upperarm_L=(30, 20, 30), forearm_L=(-50, 0, 30), hand_L=(10, 0, 0)))
    FLOAT = o(A.HOVER, hips_t=(0, 0, 0.08), head=(10, 22, 10), neck=(4, 8, 0), chest=(6, 0, 0),
              **sym(upperarm_L=(8, 34, 6), forearm_L=(-8, 0, 0), hand_L=(20, 0, 0)))
    SLAP_L = o(FLOAT, chest=(-4, 0, 30), upperarm_R=(-140, -40, 40), forearm_R=(-40, 0, 0))
    SLAP = o(FLOAT, chest=(10, 0, -30), head=(10, 0, -10), upperarm_R=(-70, -10, -20), forearm_R=(-10, 0, 0), hand_R=(-40, 0, 0))
    CLAW_L = o(FLOAT, chest=(-4, 0, -30), upperarm_L=(-140, 40, -40), forearm_L=(-40, 0, 0))
    CLAW = o(FLOAT, chest=(10, 0, 30), upperarm_L=(-70, 10, 20), forearm_L=(-10, 0, 0), hand_L=(-40, 0, 0))
    BOTH_L = o(FLOAT, chest=(-16, 0, 0), head=(-10, 0, 0), **sym(upperarm_L=(-160, -10, 0), forearm_L=(-30, 0, 0)))
    BOTH = o(FLOAT, hips_t=(0, -0.06, 0.02), chest=(20, 0, 0), head=(10, 0, 0), **sym(upperarm_L=(-60, 10, 0), forearm_L=(-10, 0, 0), hand_L=(-40, 0, 0)))
    SCREAM = o(FLOAT, hips_t=(0, 0.04, 0.12), spine=(-10, 0, 0), chest=(-20, 0, 0), neck=(-14, 0, 0), head=(-34, 0, 0),
               **sym(upperarm_L=(20, -10, 40), forearm_L=(-10, 0, 0), hand_L=(30, 0, 0)))
    CURL = o(FLOAT, spine=(30, 0, 0), chest=(20, 0, 0), head=(30, 0, 0), **sym(upperarm_L=(-60, 30, -30), forearm_L=(-130, 0, -20)),
             **{k: v for k, v in sym(thigh_L=(-70, -4, 0), shin_L=(110, 0, 0)).items()})
    TALK = o(BEHIND, head=(4, -6, 8), upperarm_R=(-40, -20, 10), forearm_R=(-80, 0, -20), hand_R=(-20, 0, 0))

    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_relaxed', sway(A, BEHIND, 70, 5.0, 2.0, 5.0, 0.01), True)
    add('stand', sway(A, BEHIND, 80, 4.0, 1.5, 4.0, 0.008), True)
    add('walk', skip(A, A.STAND, 24, 0.05, 30.0, 40.0), True)
    add('run', skip(A, o(A.STAND, spine=(10, 0, 0)), 18, 0.07, 42.0, 60.0), True)
    add('talk', [(0, BEHIND), (12, TALK), (36, TALK), (48, BEHIND)], True)
    add('idle_fight', hover(A, FLOAT, 72, 0.04, 6.0, 4.0), True)
    add('hover', hover(A, FLOAT, 72, 0.05, 6.0, 4.0), True)
    add('walk_fwd', hover(A, o(FLOAT, spine=(10, 0, 0)), 40, 0.03, 4.0, 2.0), True)
    add('walk_back', hover(A, o(FLOAT, spine=(-6, 0, 0)), 40, 0.03, 4.0, 2.0), True)
    add('strafe_L', hover(A, o(FLOAT, hips=(0, 10, 0)), 40, 0.03, 4.0, 2.0), True)
    add('strafe_R', hover(A, o(FLOAT, hips=(0, -10, 0)), 40, 0.03, 4.0, 2.0), True)
    add('light1', [(0, FLOAT), (3, SLAP_L), (5, SLAP), (9, SLAP), (16, FLOAT)])
    add('light2', [(0, FLOAT), (3, CLAW_L), (5, CLAW), (9, CLAW), (16, FLOAT)])
    add('light3', [(0, FLOAT), (4, SLAP_L), (6, SLAP), (8, CLAW_L), (10, CLAW), (18, FLOAT)])
    add('light4', [(0, FLOAT), (5, BOTH_L), (9, BOTH), (14, BOTH), (24, FLOAT)])
    add('heavy', [(0, FLOAT), (7, BOTH_L), (11, BOTH), (17, BOTH), (28, FLOAT)])
    add('cast_raise', [(0, FLOAT), (10, CURL), (16, SCREAM), (30, SCREAM), (40, FLOAT)])
    add('cast_palm', [(0, FLOAT), (8, BOTH_L), (12, BOTH), (22, BOTH), (32, FLOAT)])
    add('cast_slam', [(0, FLOAT), (10, CURL), (16, SCREAM), (30, SCREAM), (40, FLOAT)])
    add('cast_throw', [(0, FLOAT), (6, SLAP_L), (10, SLAP), (16, SLAP), (24, FLOAT)])
    return C
