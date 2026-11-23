"""
Mudhand's motion: it never stands up. It crouches on its knuckles, swaying; it crawls everywhere,
dragging itself, quicker than it should be; it swipes with one arm and then the other, lunges with
both, pounces, and retches tar forward with its whole body.
"""
import math

from anim._kit import crawl, shift


def clips(A):
    o, sym = A.over, A.sym
    HUNCH = o(A.STAND, hips=(50, 0, 0), hips_t=(0, -0.06, -0.42), spine=(20, 0, 0), chest=(10, 0, 0), neck=(-30, 0, 0), head=(-34, 0, 0),
              **sym(upperarm_L=(-70, 20, 10), forearm_L=(-10, 0, 0), hand_L=(60, 0, 0), thigh_L=(-100, -10, 0), shin_L=(120, 0, 0), foot_L=(10, 0, 0)))
    A_ = o(A.CRAWL_A, hips_t=(0, -0.1, -0.48))
    B_ = o(A.CRAWL_B, hips_t=(0, -0.1, -0.48))
    SWIPE_L = o(HUNCH, chest=(0, 0, 30), upperarm_R=(-150, -30, 40), forearm_R=(-40, 0, 0))
    SWIPE = o(HUNCH, chest=(20, 0, -30), upperarm_R=(-60, -40, -40), forearm_R=(-10, 0, 0), hand_R=(40, 0, 0))
    SWIPE2_L = o(HUNCH, chest=(0, 0, -30), upperarm_L=(-150, 30, -40), forearm_L=(-40, 0, 0))
    SWIPE2 = o(HUNCH, chest=(20, 0, 30), upperarm_L=(-60, 40, 40), forearm_L=(-10, 0, 0), hand_L=(40, 0, 0))
    COIL = o(HUNCH, hips_t=(0, 0.06, -0.5), spine=(30, 0, 0), **sym(thigh_L=(-120, -10, 0), shin_L=(140, 0, 0)))
    POUNCE = o(HUNCH, hips=(20, 0, 0), hips_t=(0, -0.3, -0.1), spine=(0, 0, 0), head=(-10, 0, 0),
               **sym(upperarm_L=(-140, 10, 10), forearm_L=(-10, 0, 0), hand_L=(-20, 0, 0), thigh_L=(-20, -10, 0), shin_L=(40, 0, 0)))
    RETCH = o(HUNCH, spine=(40, 0, 0), chest=(30, 0, 0), neck=(10, 0, 0), head=(10, 0, 0), hips_t=(0, -0.1, -0.44))
    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_fight', [(0, HUNCH), (20, shift(A, HUNCH, hips=(0, 6, 0), chest=(4, 4, 0), head=(4, -8, 0))), (40, HUNCH), (60, shift(A, HUNCH, hips=(0, -6, 0), head=(4, 8, 0))), (80, HUNCH)], True)
    add('idle_relaxed', [(0, HUNCH), (40, shift(A, HUNCH, chest=(4, 0, 0))), (80, HUNCH)], True)
    for name, n in (('walk_fwd', 24), ('walk_back', 30), ('strafe_L', 26), ('strafe_R', 26), ('walk', 28), ('run', 16)):
        add(name, crawl(A, A_, B_, n), True)
    add('light1', [(0, HUNCH), (4, SWIPE_L), (7, SWIPE), (11, SWIPE), (18, HUNCH)])
    add('light2', [(0, HUNCH), (4, SWIPE2_L), (7, SWIPE2), (11, SWIPE2), (18, HUNCH)])
    add('light3', [(0, HUNCH), (4, SWIPE_L), (6, SWIPE), (9, SWIPE2_L), (12, SWIPE2), (20, HUNCH)])
    add('heavy', [(0, HUNCH), (8, COIL), (12, POUNCE), (18, POUNCE), (28, HUNCH)])
    add('dash_attack', [(0, HUNCH), (4, COIL), (8, POUNCE), (14, POUNCE), (22, HUNCH)])
    add('cast_throw', [(0, HUNCH), (8, o(HUNCH, spine=(0, 0, 0), head=(-50, 0, 0))), (12, RETCH), (24, RETCH), (32, HUNCH)])
    add('cast_palm', [(0, HUNCH), (8, COIL), (12, POUNCE), (20, POUNCE), (30, HUNCH)])
    add('cast_raise', [(0, HUNCH), (8, o(HUNCH, spine=(0, 0, 0), head=(-50, 0, 0))), (12, RETCH), (24, RETCH), (32, HUNCH)])
    return C
