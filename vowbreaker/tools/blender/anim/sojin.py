"""
Sōjin's own motion: a big man who has made himself still. He fights from a deep horse stance with
his right hand raised before him, palm edge forward like half a prayer, his left at his hip by the
lantern. Palm strikes, an elbow, a two-handed push; a sumo-like stamp that shakes the ground; a
sweep of the arm that throws the sleeve like a wave. His lanterns rise from his raised left hand; he
releases curses with an open palm, and slams both palms down to open the Night Parade. At rest
he holds his hands together in prayer.
"""
import math

from anim._kit import shift, sway


def clips(A):
    o, sym = A.over, A.sym
    STANCE = o(A.STAND, hips=(0, 0, -16), hips_t=(0.0, 0.03, -0.14), spine=(6, 0, 4), chest=(4, 0, 8), head=(-2, 0, 6),
               thigh_L=(-36, -20, 10), shin_L=(50, 0, 0), foot_L=(-10, 0, -14), thigh_R=(6, 22, 16), shin_R=(46, 0, 0), foot_R=(-12, 0, 10),
               upperarm_R=(-70, -20, 20), forearm_R=(-80, 0, -40), hand_R=(-10, 0, 80),
               upperarm_L=(-10, 30, 30), forearm_L=(-70, 0, 20), hand_L=(-20, 0, 0))
    GASSHO = o(A.STAND, chest=(2, 0, 0), head=(10, 0, 0),
               **sym(upperarm_L=(-52, 16, -40), forearm_L=(-114, 0, -56), hand_L=(-10, 0, 76)))
    GUARD = o(STANCE, chest=(10, 0, 0), upperarm_R=(-84, -10, 40), forearm_R=(-120, 0, -40), upperarm_L=(-84, 10, -40), forearm_L=(-120, 0, 40))
    PALM_R = o(STANCE, hips=(0, 0, 10), hips_t=(0, -0.06, -0.15), chest=(10, 0, -14),
               upperarm_R=(-90, -4, 30), forearm_R=(-4, 0, 0), hand_R=(-76, 0, 0))
    PALM_L = o(STANCE, hips=(0, 0, -36), hips_t=(0, -0.05, -0.15), chest=(10, 0, 22),
               upperarm_L=(-90, 4, -30), forearm_L=(-4, 0, 0), hand_L=(-76, 0, 0), upperarm_R=(-40, -30, 20), forearm_R=(-90, 0, 0))
    ELBOW = o(STANCE, hips=(0, 0, 26), hips_t=(0, -0.06, -0.16), chest=(14, 0, -36),
              upperarm_R=(-90, -40, -30), forearm_R=(-150, 0, 0))
    PUSH = o(STANCE, hips=(0, 0, 0), hips_t=(0, -0.1, -0.16), chest=(14, 0, 0), thigh_L=(-50, -16, 10), shin_L=(50, 0, 0),
             **sym(upperarm_L=(-88, 6, -8), forearm_L=(-4, 0, 0), hand_L=(-76, 0, 0)))
    STAMP_UP = o(STANCE, hips=(0, -14, 0), hips_t=(0.04, 0.02, -0.06), chest=(6, -10, 0), thigh_L=(-60, -50, 10), shin_L=(70, 0, 0),
                 thigh_R=(10, 10, 16), shin_R=(30, 0, 0), **sym(upperarm_L=(-30, 50, 0), forearm_L=(-20, 0, 0)))
    STAMP = o(STANCE, hips_t=(0, 0.0, -0.2), thigh_L=(-40, -24, 10), shin_L=(60, 0, 0), thigh_R=(4, 24, 16), shin_R=(60, 0, 0),
              chest=(16, 0, 0), **sym(upperarm_L=(-20, 30, 10), forearm_L=(-30, 0, 0), hand_L=(60, 0, 0)))
    SWEEP_L = o(STANCE, hips=(0, 0, -50), chest=(0, 0, 40), upperarm_R=(-100, -80, 100), forearm_R=(-30, 0, 0))
    SWEEP = o(STANCE, hips=(0, 0, 30), hips_t=(0, -0.04, -0.15), chest=(10, 0, -50), upperarm_R=(-90, -30, -70), forearm_R=(-10, 0, 0), hand_R=(0, 0, 30))
    LANTERN_UP = o(STANCE, hips_t=(0, 0.02, -0.08), chest=(-14, 0, 0), head=(-20, 0, 0),
                   upperarm_L=(-170, 10, -10), forearm_L=(-20, 0, 0), hand_L=(-30, 0, 0))
    RELEASE = o(STANCE, hips_t=(0, -0.06, -0.15), chest=(12, 0, -10), upperarm_R=(-92, -10, 30), forearm_R=(-2, 0, 0), hand_R=(-80, 0, 0))
    PARADE_L = o(A.RAISE, hips_t=(0, 0.0, -0.05), **sym(upperarm_L=(-160, -20, -20), forearm_L=(-30, 0, 0)))
    PARADE = o(A.SLAM, hips_t=(0, -0.04, -0.46), **sym(upperarm_L=(-50, 26, 0), forearm_L=(-4, 0, 0), hand_L=(-80, 0, 0)))
    OPEN = o(A.STAND, chest=(-12, 0, 0), head=(-16, 0, 0), **sym(upperarm_L=(-90, -40, 40), forearm_L=(-10, 0, 0), hand_L=(-20, 0, 0)))
    BOW = o(GASSHO, spine=(20, 0, 0), chest=(10, 0, 0), head=(16, 0, 0))
    TALK = o(GASSHO, head=(6, 0, 6), upperarm_R=(-40, -20, 0), forearm_R=(-80, 0, -20), hand_R=(-20, 0, 40))

    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_fight', [(0, STANCE), (36, shift(A, STANCE, hips_t=(0, 0, -0.012), chest=(-2.5, 0, 0))), (72, STANCE)], True)
    add('idle_relaxed', sway(A, GASSHO, 140, 1.0, 1.5, 1.5, 0.003), True)
    add('stand', sway(A, GASSHO, 160, 0.8, 1.0, 1.0, 0.002), True)
    add('walk', A.walk(stride=21, bob=0.01, arm=2, lean=3, base=GASSHO, n=46), True)
    add('talk', [(0, GASSHO), (20, TALK), (54, TALK), (74, GASSHO)], True)
    add('guard', [(0, GUARD), (14, shift(A, GUARD, hips_t=(0, 0, -0.01))), (28, GUARD)], True)
    add('light1', [(0, STANCE), (4, o(STANCE, upperarm_R=(-50, -30, 40), forearm_R=(-130, 0, 0))), (7, PALM_R), (11, PALM_R), (19, STANCE)])
    add('light2', [(0, STANCE), (4, o(STANCE, upperarm_L=(-50, 30, -40), forearm_L=(-130, 0, 0))), (7, PALM_L), (11, PALM_L), (19, STANCE)])
    add('light3', [(0, STANCE), (4, o(STANCE, chest=(0, 0, 30))), (8, ELBOW), (12, ELBOW), (20, STANCE)])
    add('light4', [(0, STANCE), (6, o(STANCE, **sym(upperarm_L=(-40, 30, -10), forearm_L=(-120, 0, 0)))), (10, PUSH), (16, PUSH), (26, STANCE)])
    add('heavy', [(0, STANCE), (10, STAMP_UP), (14, STAMP), (22, STAMP), (32, STANCE)])
    add('heavy2', [(0, STANCE), (8, SWEEP_L), (13, SWEEP), (19, SWEEP), (30, STANCE)])
    add('dash_attack', [(0, STANCE), (4, PALM_L), (8, PUSH), (14, PUSH), (22, STANCE)])
    add('cast_raise', [(0, STANCE), (12, LANTERN_UP), (28, LANTERN_UP), (38, STANCE)])
    add('cast_palm', [(0, STANCE), (8, o(STANCE, upperarm_R=(-40, -30, 40), forearm_R=(-130, 0, 0))), (12, RELEASE), (22, RELEASE), (32, STANCE)])
    add('cast_slam', [(0, STANCE), (12, PARADE_L), (18, PARADE), (30, PARADE), (40, STANCE)])
    add('cast_throw', [(0, STANCE), (8, SWEEP_L), (12, SWEEP), (18, SWEEP), (28, STANCE)])
    add('domain', [(0, STANCE), (14, GASSHO), (36, GASSHO), (52, OPEN), (60, OPEN)])
    add('victory', [(0, STANCE), (16, GASSHO), (34, BOW), (60, BOW), (76, GASSHO)])
    return C
