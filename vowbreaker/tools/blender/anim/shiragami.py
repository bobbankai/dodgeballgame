"""
Shiragami's motion: enormous and stiff, a thing of folded paper that moves in jerks between poses
(its keys are close together, its holds long). It lumbers, arms hanging; slaps with the back of a
hand; brings both hands down together; spreads its arms wide and tips its head back to call the
paper down; pushes with an open palm.
"""
from anim._kit import shift


def clips(A):
    o, sym = A.over, A.sym
    LUMBER = o(A.STAND, hips_t=(0, 0.02, -0.04), spine=(8, 0, 0), chest=(10, 0, 0), head=(6, 0, 0),
               **sym(upperarm_L=(-10, 26, 0), forearm_L=(-20, 0, 0), hand_L=(10, 0, 0), thigh_L=(-8, -4, 0), shin_L=(14, 0, 0)))
    SLAP_L = o(LUMBER, chest=(0, 0, -40), upperarm_R=(-90, -40, -60), forearm_R=(-60, 0, 0))
    SLAP = o(LUMBER, chest=(10, 0, 40), upperarm_R=(-80, -60, 60), forearm_R=(-4, 0, 0), hand_R=(30, 0, 0))
    UP = o(LUMBER, chest=(-14, 0, 0), head=(-10, 0, 0), **sym(upperarm_L=(-172, -6, -6), forearm_L=(-20, 0, 0)))
    DOWN = o(LUMBER, hips_t=(0, -0.04, -0.14), spine=(26, 0, 0), chest=(24, 0, 0), **sym(upperarm_L=(-56, 8, -10), forearm_L=(-10, 0, 0), hand_L=(-40, 0, 0)))
    WIDE = o(LUMBER, chest=(-12, 0, 0), head=(-26, 0, 0), **sym(upperarm_L=(-90, -56, 20), forearm_L=(-4, 0, 0), hand_L=(-20, 0, 0)))
    PALM = o(LUMBER, chest=(10, 0, -10), hips_t=(0, -0.06, -0.06), upperarm_R=(-90, -4, 30), forearm_R=(-4, 0, 0), hand_R=(-76, 0, 0))
    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_fight', [(0, LUMBER), (40, LUMBER), (44, shift(A, LUMBER, head=(0, 10, 10), chest=(0, 4, 0))), (90, shift(A, LUMBER, head=(0, 10, 10), chest=(0, 4, 0))), (94, LUMBER), (120, LUMBER)], True)
    add('idle_relaxed', [(0, LUMBER), (60, shift(A, LUMBER, chest=(3, 0, 0))), (120, LUMBER)], True)
    for name, n, stride in (('walk_fwd', 48, 18), ('walk_back', 52, 14), ('strafe_L', 48, 12), ('strafe_R', 48, 12), ('walk', 56, 18), ('run', 36, 24)):
        add(name, A.walk(stride=stride, bob=0.02, arm=6, lean=8, base=LUMBER, crouch=0.02, n=n), True)
    add('light1', [(0, LUMBER), (8, SLAP_L), (10, SLAP), (18, SLAP), (28, LUMBER)])
    add('light2', [(0, LUMBER), (8, o(SLAP_L, chest=(0, 0, 40), upperarm_L=(-90, 40, 60), forearm_L=(-60, 0, 0))),
                   (10, o(LUMBER, chest=(10, 0, -40), upperarm_L=(-80, 60, -60), forearm_L=(-4, 0, 0))), (18, o(LUMBER, chest=(10, 0, -40), upperarm_L=(-80, 60, -60), forearm_L=(-4, 0, 0))), (28, LUMBER)])
    add('heavy', [(0, LUMBER), (12, UP), (16, DOWN), (26, DOWN), (38, LUMBER)])
    add('heavy2', [(0, LUMBER), (12, UP), (16, DOWN), (26, DOWN), (38, LUMBER)])
    add('cast_raise', [(0, LUMBER), (14, WIDE), (36, WIDE), (46, LUMBER)])
    add('cast_slam', [(0, LUMBER), (12, UP), (16, DOWN), (30, DOWN), (42, LUMBER)])
    add('cast_palm', [(0, LUMBER), (10, PALM), (24, PALM), (34, LUMBER)])
    add('cast_throw', [(0, LUMBER), (8, SLAP_L), (10, SLAP), (18, SLAP), (28, LUMBER)])
    add('domain', [(0, LUMBER), (14, WIDE), (60, WIDE)])
    return C
