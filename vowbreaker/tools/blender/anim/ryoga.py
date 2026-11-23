"""
Ryōga's own motion: low, loose and showing off. He fights in a wide crouch with his hands hanging
open, rolling his head, bouncing; strikes come from odd angles -- a looping hook, a spinning hook
kick, a sweep along the ground, a cartwheeling armada kick, a dropping axe kick. Gravebrand is a
palm slammed into the floor, a finger pointed down to crush, an overhand fling of the mark. Out of
a fight he stands hip-cocked with a hand on his belt and walks with a swagger.
"""
import math

from anim._kit import bounce, shift, sway


def clips(A):
    o, sym = A.over, A.sym
    STANCE = o(A.STANCE, hips=(0, 0, -20), hips_t=(0.0, 0.03, -0.17), spine=(16, 0, 4), chest=(10, 0, 8), neck=(-12, 0, 0), head=(-10, 8, 10),
               thigh_L=(-44, -14, 14), shin_L=(64, 0, 0), foot_L=(-10, 0, -10), thigh_R=(24, 16, 16), shin_R=(56, 0, 0), foot_R=(-20, 0, 0),
               upperarm_L=(-30, 30, -10), forearm_L=(-50, 0, 0), hand_L=(10, 0, 0),
               upperarm_R=(-20, -26, 20), forearm_R=(-60, 0, 0), hand_R=(10, 0, 0))
    COCKY = o(A.STAND, hips=(0, -6, 6), hips_t=(-0.015, 0.0, -0.006), chest=(-4, 4, -4), head=(-4, 10, 8),
              upperarm_L=(-6, 20, 30), forearm_L=(-90, 0, 30), hand_L=(-10, 0, 0),
              upperarm_R=(4, 34, 2), forearm_R=(-10, 0, 0), thigh_L=(-4, 6, 8), shin_L=(12, 0, 0), thigh_R=(2, -2, 0))
    GUARD = o(STANCE, chest=(18, 0, 0), upperarm_L=(-76, 18, -30), forearm_L=(-126, 0, 0), upperarm_R=(-72, -18, 30), forearm_R=(-126, 0, 0))
    HOOK_L = o(STANCE, chest=(8, 0, 36), upperarm_R=(-40, -10, 40), forearm_R=(-90, 0, 0))
    HOOK = o(STANCE, hips=(0, 0, 30), hips_t=(0, -0.04, -0.16), chest=(14, 0, -40), head=(-4, 0, -20),
             upperarm_R=(-86, 40, 60), forearm_R=(-96, 0, 0), hand_R=(-6, 0, 0))
    HOOKKICK_L = o(STANCE, hips=(0, 0, -100), hips_t=(0, 0.0, -0.12), chest=(4, 0, -40), head=(-6, 0, 80))
    HOOKKICK = o(STANCE, hips=(0, -30, -230), hips_t=(0, 0.0, -0.04), spine=(-4, -24, -20), chest=(-10, -20, -20), head=(0, 14, 240),
                 thigh_L=(-84, 70, -10), shin_L=(60, 0, 0), foot_L=(30, 0, 0), thigh_R=(-6, 10, 0), shin_R=(14, 0, 0),
                 upperarm_L=(-20, 10, 40), forearm_L=(-50, 0, 0), upperarm_R=(-40, -60, 0), forearm_R=(-70, 0, 0))
    SWEEP_L = o(STANCE, hips_t=(0, 0.04, -0.4), spine=(30, 0, 0), chest=(20, 0, 30), thigh_L=(-100, -10, 10), shin_L=(130, 0, 0),
                thigh_R=(10, 30, 30), shin_R=(30, 0, 0), upperarm_R=(-40, -20, 0), forearm_R=(-20, 0, 0), hand_R=(80, 0, 0))
    SWEEP = o(SWEEP_L, hips=(0, 0, -160), chest=(20, 0, -20), head=(0, 0, 150), thigh_R=(-10, 80, 0), shin_R=(4, 0, 0), foot_R=(30, 0, 0))
    ARMADA_L = o(STANCE, hips=(0, 0, -120), hips_t=(0, 0.0, -0.06), chest=(10, 0, -30), head=(-10, 0, 100),
                 upperarm_L=(-50, 70, 0), forearm_L=(-20, 0, 0), upperarm_R=(-50, -70, 0), forearm_R=(-20, 0, 0))
    ARMADA = o(STANCE, hips=(30, -40, -260), hips_t=(0, 0.0, 0.04), spine=(20, -20, -20), chest=(10, -14, -20), head=(-20, 20, 260),
               thigh_L=(-150, 40, 0), shin_L=(10, 0, 0), foot_L=(40, 0, 0), thigh_R=(-10, 10, 0), shin_R=(20, 0, 0),
               upperarm_L=(-120, 40, 0), forearm_L=(-20, 0, 0), upperarm_R=(-120, -40, 0), forearm_R=(-20, 0, 0))
    AXE_L = o(STANCE, hips_t=(0, 0.0, 0.0), chest=(-16, 0, 0), thigh_R=(-170, 0, 0), shin_R=(6, 0, 0), foot_R=(30, 0, 0),
              upperarm_L=(-120, 40, 0), upperarm_R=(-120, -40, 0))
    AXE = o(STANCE, hips_t=(0, -0.06, -0.12), chest=(26, 0, 0), spine=(16, 0, 0), thigh_R=(-60, 0, 0), shin_R=(4, 0, 0), foot_R=(20, 0, 0),
            upperarm_L=(-20, 60, 0), upperarm_R=(-20, -60, 0), forearm_L=(-60, 0, 0), forearm_R=(-60, 0, 0))
    KNEE_L = o(STANCE, hips_t=(0, 0.02, -0.26), thigh_L=(-70, -10, 10), shin_L=(100, 0, 0))
    KNEE = o(A.AIR, hips_t=(0, -0.1, 0.16), chest=(10, 0, 0), thigh_R=(-120, 0, 0), shin_R=(140, 0, 0), thigh_L=(10, 0, 0), shin_L=(40, 0, 0),
             upperarm_L=(-110, 20, 0), forearm_L=(-90, 0, 0), upperarm_R=(-110, -20, 0), forearm_R=(-90, 0, 0))
    BRAND_L = o(STANCE, hips_t=(0, 0.04, 0.02), chest=(-20, 0, 0), head=(-16, 0, 0), upperarm_R=(-170, -10, 10), forearm_R=(-20, 0, 0), hand_R=(0, 0, 0))
    BRAND = o(A.SLAM, hips_t=(0, -0.08, -0.5), upperarm_R=(-40, -20, 0), forearm_R=(-4, 0, 0), hand_R=(-90, 0, 0),
              upperarm_L=(-30, 60, -20), forearm_L=(-30, 0, 0))
    POINT_L = o(STANCE, hips_t=(0, 0.0, -0.1), chest=(-6, 0, 0), upperarm_R=(-160, -20, 20), forearm_R=(-10, 0, 0))
    POINT = o(STANCE, hips_t=(0, 0.0, -0.14), chest=(14, 0, -10), head=(10, 0, -10), upperarm_R=(-96, -10, 30), forearm_R=(-30, 0, 0), hand_R=(60, 0, 0))
    FLING_L = o(STANCE, hips=(0, 0, -60), chest=(-10, 0, 40), upperarm_R=(-150, -40, 60), forearm_R=(-100, 0, 0))
    FLING = o(STANCE, hips=(0, 0, 20), chest=(26, 0, -40), hips_t=(0, -0.08, -0.16), upperarm_R=(-70, -10, 20), forearm_R=(-4, 0, 0), hand_R=(-20, 0, 0))
    LAUGH = o(COCKY, chest=(-14, 0, 0), head=(-26, 0, 0), **sym(upperarm_L=(-60, -40, 30), forearm_L=(-30, 0, 0), hand_L=(-30, 0, 0)))
    TALK = o(COCKY, head=(-2, 12, 14), upperarm_R=(-40, -20, 20), forearm_R=(-70, 0, -20), hand_R=(10, 0, 0))

    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_fight', bounce(A, STANCE, 30, 0.02, 6.0, 4.0), True)
    add('idle_relaxed', sway(A, COCKY, 90, 3.0, 1.0, 4.0, 0.008), True)
    add('stand', sway(A, COCKY, 110, 2.0, 0.8, 3.0, 0.006), True)
    add('walk', _swagger(A, o, COCKY), True)
    add('talk', [(0, COCKY), (14, TALK), (40, TALK), (56, COCKY)], True)
    add('guard', [(0, GUARD), (10, shift(A, GUARD, hips_t=(0, 0, -0.012))), (20, GUARD)], True)
    add('light1', [(0, STANCE), (3, HOOK_L), (6, HOOK), (10, HOOK), (17, STANCE)])
    add('light2', [(0, STANCE), (5, HOOKKICK_L), (10, HOOKKICK), (15, HOOKKICK), (25, o(STANCE, hips=(0, 0, -380)))])
    add('light3', [(0, STANCE), (4, SWEEP_L), (9, SWEEP), (14, SWEEP), (24, o(STANCE, hips=(0, 0, -380)))])
    add('light4', [(0, STANCE), (5, ARMADA_L), (11, ARMADA), (16, ARMADA), (28, o(STANCE, hips=(0, 0, -380)))])
    add('heavy', [(0, STANCE), (8, AXE_L), (12, AXE), (18, AXE), (28, STANCE)])
    add('heavy2', [(0, STANCE), (6, KNEE_L), (10, KNEE), (16, KNEE), (26, STANCE)])
    add('dash_attack', [(0, STANCE), (4, KNEE_L), (8, KNEE), (14, KNEE), (22, STANCE)])
    add('cast_palm', [(0, STANCE), (8, BRAND_L), (13, BRAND), (22, BRAND), (32, STANCE)])
    add('cast_slam', [(0, STANCE), (6, KNEE_L), (12, BRAND_L), (17, BRAND), (26, BRAND), (36, STANCE)])
    add('cast_raise', [(0, STANCE), (8, POINT_L), (14, POINT), (26, POINT), (36, STANCE)])
    add('cast_throw', [(0, STANCE), (6, FLING_L), (10, FLING), (15, FLING), (24, STANCE)])
    add('victory', [(0, STANCE), (10, COCKY), (22, LAUGH), (50, LAUGH), (64, COCKY)])
    return C


def _swagger(A, o, base, n=30):
    keys = []
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        s = math.sin(ph * 2 * math.pi)
        c = math.cos(ph * 2 * math.pi)
        p = o(base, hips=(0, 6 * s, 8 * s), hips_t=(0.012 * s, 0, -0.02 * (1 - abs(c))), spine=(2, -3 * s, -4 * s), chest=(-2, -4 * s, -10 * s), head=(-4, 8, 6 * s),
              thigh_L=(-28 * c, -2, 4), shin_L=(10 + 30 * max(0.0, s), 0, 0), foot_L=(6 * c, 0, 0),
              thigh_R=(28 * c, 2, -4), shin_R=(10 + 30 * max(0.0, -s), 0, 0), foot_R=(-6 * c, 0, 0),
              upperarm_R=(-26 * c, -36, -6), forearm_R=(-14, 0, 0))
        keys.append((f, p))
    return keys
