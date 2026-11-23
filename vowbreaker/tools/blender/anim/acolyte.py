"""
The acolytes' motion: drilled, joyless, identical. They stand with their hands hidden in their
sleeves and their masks bowed; they fight from a stiff ritual stance with two fingers raised before
the mask; their strikes are short and mechanical; they lift their lanterns to loose a wisp. They
walk in small even steps without swinging their arms.
"""
from anim._kit import glide, shift, sway


def clips(A):
    o, sym = A.over, A.sym
    SLEEVES = o(A.STAND, chest=(2, 0, 0), head=(12, 0, 0), **sym(upperarm_L=(-36, 24, -36), forearm_L=(-108, 0, -30), hand_L=(-10, 0, 0)))
    STANCE = o(A.STAND, hips=(0, 0, -20), hips_t=(0.0, 0.02, -0.06), chest=(4, 0, 10), head=(6, 0, 6),
               thigh_L=(-20, -8, 10), shin_L=(24, 0, 0), thigh_R=(12, 8, 14), shin_R=(24, 0, 0),
               upperarm_R=(-60, -10, -30), forearm_R=(-122, 0, -50), hand_R=(-10, 0, 70),
               upperarm_L=(-20, 30, -20), forearm_L=(-100, 0, -20))
    PALM = o(STANCE, hips=(0, 0, 6), hips_t=(0, -0.05, -0.06), chest=(10, 0, -10), upperarm_R=(-90, -4, 30), forearm_R=(-4, 0, 0), hand_R=(-76, 0, 0))
    CHOP = o(STANCE, chest=(12, 0, -20), upperarm_L=(-90, 6, -40), forearm_L=(-6, 0, 0), hand_L=(10, 0, 0))
    LIFT = o(STANCE, chest=(-10, 0, 0), head=(-10, 0, 0), upperarm_L=(-160, 10, -10), forearm_L=(-30, 0, 0), hand_L=(-20, 0, 0))
    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_relaxed', sway(A, SLEEVES, 150, 0.5, 0.6, 0.5, 0.001), True)
    add('stand', sway(A, SLEEVES, 150, 0.5, 0.6, 0.5, 0.001), True)
    add('idle_fight', [(0, STANCE), (30, shift(A, STANCE, hips_t=(0, 0, -0.006))), (60, STANCE)], True)
    add('walk', A.walk(stride=16, bob=0.006, arm=0, lean=2, base=SLEEVES, n=36), True)
    add('walk_fwd', glide(A, STANCE, 36, 10.0, 0.006), True)
    add('walk_back', glide(A, STANCE, 40, 8.0, 0.006), True)
    add('light1', [(0, STANCE), (4, PALM), (8, PALM), (16, STANCE)])
    add('light2', [(0, STANCE), (4, CHOP), (8, CHOP), (16, STANCE)])
    add('light3', [(0, STANCE), (4, PALM), (7, CHOP), (11, CHOP), (18, STANCE)])
    add('cast_raise', [(0, STANCE), (12, LIFT), (28, LIFT), (38, STANCE)])
    add('cast_throw', [(0, STANCE), (6, LIFT), (10, PALM), (16, PALM), (24, STANCE)])
    add('cast_palm', [(0, STANCE), (8, PALM), (18, PALM), (28, STANCE)])
    return C
