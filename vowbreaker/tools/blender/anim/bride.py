"""
The Weeping Bride's motion: she never touches the floor. She hangs in the air with her face in her
hands, rising and sinking as she sobs; she drifts toward you without stepping; she lashes with a
long sleeve, opens her arms wide to embrace you, and throws her head back to wail.
"""
from anim._kit import hover, shift


def clips(A):
    o, sym = A.over, A.sym
    WEEP = o(A.HOVER, hips_t=(0, 0, 0.1), spine=(10, 0, 0), chest=(10, 0, 0), neck=(16, 0, 0), head=(24, 0, 0),
             **sym(upperarm_L=(-70, 24, -34), forearm_L=(-136, 0, -14), hand_L=(-40, 0, 0), thigh_L=(-6, -2, 0), shin_L=(20, 0, 0), foot_L=(50, 0, 0)))
    FLOAT = o(A.HOVER, hips_t=(0, 0, 0.12), head=(10, 0, 0), **sym(upperarm_L=(-20, 30, 0), forearm_L=(-20, 0, 0), hand_L=(20, 0, 0),
                                                                    thigh_L=(-6, -2, 0), shin_L=(20, 0, 0), foot_L=(50, 0, 0)))
    LASH_L = o(FLOAT, chest=(-6, 0, 30), upperarm_R=(-150, -50, 40), forearm_R=(-30, 0, 0))
    LASH = o(FLOAT, chest=(10, 0, -30), upperarm_R=(-70, -20, -40), forearm_R=(-4, 0, 0), hand_R=(-20, 0, 0))
    LASH2_L = o(FLOAT, chest=(-6, 0, -30), upperarm_L=(-150, 50, -40), forearm_L=(-30, 0, 0))
    LASH2 = o(FLOAT, chest=(10, 0, 30), upperarm_L=(-70, 20, 40), forearm_L=(-4, 0, 0), hand_L=(-20, 0, 0))
    OPEN = o(FLOAT, chest=(-8, 0, 0), head=(-8, 0, 0), **sym(upperarm_L=(-90, -60, 20), forearm_L=(-10, 0, 0), hand_L=(-20, 0, 0)))
    HOLD = o(FLOAT, hips_t=(0, -0.1, 0.1), chest=(14, 0, 0), **sym(upperarm_L=(-80, 10, -50), forearm_L=(-80, 0, -30), hand_L=(-20, 0, 0)))
    WAIL = o(FLOAT, hips_t=(0, 0.04, 0.2), spine=(-10, 0, 0), chest=(-20, 0, 0), neck=(-16, 0, 0), head=(-36, 0, 0),
             **sym(upperarm_L=(-40, -30, 40), forearm_L=(-10, 0, 0), hand_L=(30, 0, 0)))
    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_fight', hover(A, WEEP, 80, 0.05, 5.0, 2.0), True)
    add('idle_relaxed', hover(A, WEEP, 90, 0.05, 5.0, 2.0), True)
    add('stand', hover(A, WEEP, 90, 0.05, 5.0, 2.0), True)
    add('hover', hover(A, FLOAT, 80, 0.06, 4.0, 2.0), True)
    for name, n in (('walk_fwd', 60), ('walk_back', 60), ('strafe_L', 60), ('strafe_R', 60), ('walk', 70), ('run', 40)):
        add(name, hover(A, o(FLOAT, spine=(8, 0, 0)), n, 0.04, 3.0, 2.0), True)
    add('light1', [(0, FLOAT), (5, LASH_L), (8, LASH), (13, LASH), (22, FLOAT)])
    add('light2', [(0, FLOAT), (5, LASH2_L), (8, LASH2), (13, LASH2), (22, FLOAT)])
    add('light3', [(0, FLOAT), (5, LASH_L), (7, LASH), (10, LASH2_L), (13, LASH2), (24, FLOAT)])
    add('heavy', [(0, FLOAT), (10, OPEN), (16, HOLD), (26, HOLD), (36, FLOAT)])
    add('cast_raise', [(0, FLOAT), (10, WEEP), (16, WAIL), (32, WAIL), (42, FLOAT)])
    add('cast_slam', [(0, FLOAT), (10, WEEP), (16, WAIL), (32, WAIL), (42, FLOAT)])
    add('cast_palm', [(0, FLOAT), (10, OPEN), (20, OPEN), (30, FLOAT)])
    add('cast_throw', [(0, FLOAT), (6, LASH_L), (9, LASH), (14, LASH), (24, FLOAT)])
    return C
