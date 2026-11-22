"""
Mikami's own motion: he has nothing left to prove. He fights upright with his left hand in his coat
pocket and his right loose at chest height, two fingers raised; he barely moves until he does, and
then once, precisely: a palm heel, an elbow, a low kick, a high roundhouse. Stillwater is quiet --
a palm lowered as if onto water, a two-fingered tap, a single clap. He walks slowly with both hands
in his pockets and his head a little down.
"""
import math

from anim._kit import shift, sway


def clips(A):
    o, sym = A.over, A.sym
    POCKET_L = dict(upperarm_L=(16, 26, 18), forearm_L=(-32, 0, 14), hand_L=(10, 0, 0))
    STANCE = o(A.STAND, hips=(0, 0, -18), hips_t=(0.0, 0.0, -0.02), chest=(2, 0, 8), head=(4, 0, 6),
               thigh_L=(-10, -4, 6), shin_L=(8, 0, 0), thigh_R=(6, 6, 10), shin_R=(10, 0, 0),
               upperarm_R=(-44, -30, 30), forearm_R=(-100, 0, -10), hand_R=(-10, 0, 0), **POCKET_L)
    SLOUCH = o(A.STAND, spine=(4, 0, 0), chest=(3, 0, 0), head=(8, 4, -6), hips=(0, -4, 0),
               **sym(upperarm_L=(16, 26, 18), forearm_L=(-32, 0, 14), hand_L=(10, 0, 0)), thigh_R=(-6, 4, -6), shin_R=(10, 0, 0))
    GUARD = o(STANCE, upperarm_R=(-80, -10, 40), forearm_R=(-120, 0, -40), hand_R=(-20, 0, 0), chest=(8, 0, 0), hips_t=(0, 0.03, -0.05))
    PALMHEEL = o(STANCE, hips=(0, 0, 0), hips_t=(0, -0.05, -0.04), chest=(8, 0, -14),
                 upperarm_R=(-88, -4, 28), forearm_R=(-4, 0, 0), hand_R=(-74, 0, 0), thigh_L=(-26, -4, 6), shin_L=(20, 0, 0))
    ELBOW_L = o(STANCE, chest=(0, 0, 30), upperarm_R=(-60, -50, 50), forearm_R=(-140, 0, 0))
    ELBOW = o(STANCE, hips=(0, 0, 20), hips_t=(0, -0.05, -0.05), chest=(10, 0, -40), head=(0, 0, -20),
              upperarm_R=(-86, -50, -30), forearm_R=(-150, 0, 0), hand_R=(-10, 0, 0))
    LOWKICK = o(STANCE, hips=(0, 10, 10), hips_t=(0, 0.0, -0.04), chest=(4, 8, 0),
                thigh_R=(-46, -40, 20), shin_R=(14, 0, 0), foot_R=(30, 0, 0), thigh_L=(-6, -8, 0), shin_L=(14, 0, 0))
    ROUND_L = o(STANCE, hips=(0, 6, -20), thigh_R=(-50, 10, 30), shin_R=(100, 0, 0), chest=(0, 6, 14))
    ROUND = o(STANCE, hips=(0, 30, 40), hips_t=(0, 0.0, -0.02), spine=(0, 26, 0), chest=(-8, 18, -20), head=(0, -26, -20),
              thigh_R=(-90, -76, 30), shin_R=(6, 0, 0), foot_R=(40, 0, 0), thigh_L=(-2, -12, 0), shin_L=(8, 0, 0),
              upperarm_R=(-30, -10, 40), forearm_R=(-60, 0, 0))
    SPIN_L = o(STANCE, hips=(0, 0, -90), chest=(6, 0, -40), head=(-6, 0, 70), hips_t=(0, 0.02, -0.08))
    HEEL = o(STANCE, hips=(0, -24, -210), hips_t=(0, 0.0, -0.02), spine=(-4, -24, -20), chest=(-6, -14, -20), head=(0, 10, 230),
             thigh_L=(-80, 76, -20), shin_L=(4, 0, 0), foot_L=(40, 0, 0), thigh_R=(-4, 10, 0), shin_R=(10, 0, 0),
             upperarm_R=(-40, -50, 0), forearm_R=(-90, 0, 0))
    LOWER_L = o(STANCE, chest=(-6, 0, 0), head=(-6, 0, 0), upperarm_R=(-130, -20, 10), forearm_R=(-30, 0, 0), hand_R=(30, 0, 0))
    LOWER = o(STANCE, hips_t=(0, 0.0, -0.06), chest=(8, 0, 0), head=(12, 0, 0),
              upperarm_R=(-64, -10, 10), forearm_R=(-10, 0, 0), hand_R=(60, 0, 0))
    TAP_L = o(STANCE, upperarm_R=(-70, -30, 40), forearm_R=(-130, 0, 0), hand_R=(-20, 0, 0))
    TAP = o(STANCE, hips=(0, 0, -6), hips_t=(0, -0.08, -0.04), chest=(6, 0, -10),
            upperarm_R=(-90, -6, 30), forearm_R=(-2, 0, 0), hand_R=(-6, 0, 0))
    CLAP_L = o(A.STAND, hips_t=(0, 0.02, -0.04), chest=(-4, 0, 0), **sym(upperarm_L=(-70, -20, -20), forearm_L=(-30, 0, 0), hand_L=(-20, 0, 0)))
    CLAP = o(A.STAND, hips_t=(0, -0.02, -0.06), chest=(10, 0, 0), head=(6, 0, 0),
             **sym(upperarm_L=(-80, 26, -40), forearm_L=(-60, 0, -40), hand_L=(-10, 0, 30)))
    SIGN = o(STANCE, head=(14, 0, 0), chest=(0, 0, 0), upperarm_R=(-60, -20, -40), forearm_R=(-124, 0, -60), hand_R=(-10, 0, 80))
    SIGN_UP = o(SIGN, head=(-10, 0, 0))
    GLOVE = o(SLOUCH, head=(16, 0, 0), upperarm_R=(-50, -20, -30), forearm_R=(-120, 0, -50), hand_R=(-10, 0, 0),
              upperarm_L=(-46, 24, -30), forearm_L=(-110, 0, -40), hand_L=(-10, 0, 0))
    TALK = o(SLOUCH, head=(4, 0, 8), upperarm_R=(-20, -30, 10), forearm_R=(-74, 0, -10), hand_R=(-20, 0, 0))

    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_fight', [(0, STANCE), (40, shift(A, STANCE, hips_t=(0, 0, -0.006), chest=(-1.5, 0, 0), hand_R=(-6, 0, 0))), (80, STANCE)], True)
    add('idle_relaxed', sway(A, SLOUCH, 120, 2.0, 1.0, 3.0, 0.004), True)
    add('stand', sway(A, SLOUCH, 140, 1.5, 0.8, 2.0, 0.003), True)
    add('walk', A.walk(stride=27, bob=0.014, arm=3, lean=5, base=SLOUCH, n=40), True)
    add('walk_sad', A.walk(stride=18, bob=0.008, arm=2, lean=10, base=o(SLOUCH, head=(20, 0, 0)), n=50), True)
    add('talk', [(0, SLOUCH), (18, TALK), (50, TALK), (70, SLOUCH)], True)
    add('guard', [(0, GUARD), (16, shift(A, GUARD, hips_t=(0, 0, -0.008))), (32, GUARD)], True)
    add('light1', [(0, STANCE), (3, o(STANCE, upperarm_R=(-60, -30, 40), forearm_R=(-130, 0, 0))), (5, PALMHEEL), (9, PALMHEEL), (16, STANCE)])
    add('light2', [(0, STANCE), (3, ELBOW_L), (6, ELBOW), (10, ELBOW), (17, STANCE)])
    add('light3', [(0, STANCE), (4, o(STANCE, thigh_R=(-30, -10, 20), shin_R=(50, 0, 0))), (7, LOWKICK), (11, LOWKICK), (18, STANCE)])
    add('light4', [(0, STANCE), (5, ROUND_L), (9, ROUND), (14, ROUND), (24, STANCE)])
    add('heavy', [(0, STANCE), (7, SPIN_L), (12, HEEL), (18, HEEL), (30, o(STANCE, hips=(0, 0, -378)))])
    add('heavy2', [(0, STANCE), (8, TAP_L), (12, TAP), (20, TAP), (30, STANCE)])
    add('dash_attack', [(0, STANCE), (4, TAP_L), (7, PALMHEEL), (13, PALMHEEL), (20, STANCE)])
    add('cast_raise', [(0, STANCE), (12, LOWER_L), (30, LOWER), (44, LOWER), (56, STANCE)])
    add('cast_palm', [(0, STANCE), (8, TAP_L), (12, TAP), (22, TAP), (32, STANCE)])
    add('cast_slam', [(0, STANCE), (10, CLAP_L), (14, CLAP), (26, CLAP), (36, STANCE)])
    add('cast_throw', [(0, STANCE), (6, o(STANCE, upperarm_R=(-120, -40, 60), forearm_R=(-110, 0, 0))), (10, TAP), (16, TAP), (24, STANCE)])
    add('domain', [(0, STANCE), (14, SIGN), (40, SIGN), (54, SIGN_UP), (60, SIGN_UP)])
    add('victory', [(0, STANCE), (16, SLOUCH), (34, GLOVE), (60, GLOVE), (76, SLOUCH)])
    return C
