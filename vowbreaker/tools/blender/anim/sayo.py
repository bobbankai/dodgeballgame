"""
Sayo's own motion: trained from childhood, every line of her is correct. She fights side-on, upright,
weight on the back foot, her right hand raised by her cheek with talismans fanned between the
fingers and her left hand held out low, palm open, to measure distance. Knife-hands and crescent
kicks; she flicks talismans from the wrist, folds cranes with both hands, draws a paper blade from
her hip like a sword. At rest her hands fold in front of her; she walks with small, quiet steps.
"""
import math

from anim._kit import shift, sway


def clips(A):
    o, sym = A.over, A.sym
    STANCE = o(A.STAND, hips=(0, 0, -40), hips_t=(0.0, 0.03, -0.05), spine=(2, 0, 8), chest=(0, 0, 14), neck=(-2, 0, 6), head=(-4, 0, 14),
               thigh_L=(-22, -6, 10), shin_L=(16, 0, 0), foot_L=(-6, 0, -16), thigh_R=(12, 10, 18), shin_R=(24, 0, 0), foot_R=(-14, 0, 0),
               upperarm_L=(-52, 34, -26), forearm_L=(-24, 0, 0), hand_L=(-30, 0, 0),
               upperarm_R=(-44, -44, 30), forearm_R=(-108, 0, 0), hand_R=(-30, 0, 20))
    FORMAL = o(A.STAND, chest=(-2, 0, 0), head=(4, 0, 0),
               **sym(upperarm_L=(-14, 30, -26), forearm_L=(-70, 0, -40), hand_L=(-10, 0, -10)))
    GUARD = o(STANCE, hips_t=(0, 0.06, -0.08), chest=(8, 0, 6), upperarm_L=(-80, 10, -40), forearm_L=(-110, 0, 30),
              upperarm_R=(-80, -10, 40), forearm_R=(-112, 0, -30), hand_L=(-20, 0, 0), hand_R=(-20, 0, 0))
    CHOP_L = o(STANCE, chest=(-6, 0, 30), upperarm_R=(-150, -30, 30), forearm_R=(-70, 0, 0), hand_R=(-40, 0, 0))
    CHOP = o(STANCE, hips=(0, 0, -10), hips_t=(0, -0.04, -0.07), chest=(14, 0, -20), head=(0, 0, 0),
             upperarm_R=(-84, -6, 26), forearm_R=(-6, 0, 0), hand_R=(10, 0, 0))
    PALM = o(STANCE, hips=(0, 0, -60), hips_t=(0, -0.05, -0.08), chest=(8, 0, 10),
             shoulder_L=(0, 0, -12), upperarm_L=(-88, 2, -24), forearm_L=(-2, 0, 0), hand_L=(-74, 0, 0))
    CRESC_L = o(STANCE, hips_t=(0, 0.02, -0.04), thigh_R=(-30, 20, 30), shin_R=(80, 0, 0), chest=(0, 4, 20))
    CRESCENT = o(STANCE, hips=(0, 16, 20), hips_t=(0, 0.0, -0.02), spine=(0, 16, 0), chest=(-8, 12, -10),
                 thigh_R=(-100, -40, -10), shin_R=(4, 0, 0), foot_R=(40, 0, 0), thigh_L=(-4, -8, 0), shin_L=(8, 0, 0),
                 upperarm_L=(-40, 50, -20), forearm_L=(-60, 0, 0), upperarm_R=(-30, -60, 30), forearm_R=(-60, 0, 0))
    SLASH_L = o(STANCE, hips=(0, 0, -80), chest=(0, 0, 50), upperarm_R=(-90, -80, 90), forearm_R=(-60, 0, 0))
    SLASH = o(STANCE, hips=(0, 0, 10), hips_t=(0, -0.06, -0.1), chest=(10, 0, -46), head=(0, 0, -10),
              upperarm_R=(-90, -30, -60), forearm_R=(-4, 0, 0), hand_R=(0, 0, 30))
    KNEE = o(STANCE, hips=(0, 0, -10), hips_t=(0, -0.04, 0.03), chest=(-6, 0, 0), thigh_R=(-110, 4, 0), shin_R=(130, 0, 0), foot_R=(40, 0, 0),
             upperarm_L=(-70, 30, -40), forearm_L=(-120, 0, 0), upperarm_R=(-60, -30, 40), forearm_R=(-120, 0, 0))
    HIGHKICK = o(STANCE, hips=(-14, 0, 0), hips_t=(0, 0.02, -0.02), spine=(-14, 0, 0), chest=(-10, 0, 0), head=(10, 0, 0),
                 thigh_R=(-150, 0, 0), shin_R=(6, 0, 0), foot_R=(30, 0, 0), thigh_L=(4, -4, 0), shin_L=(4, 0, 0),
                 upperarm_L=(-30, 60, -10), forearm_L=(-40, 0, 0), upperarm_R=(-20, -60, 10), forearm_R=(-40, 0, 0))
    PUSH_L = o(STANCE, hips=(0, 0, -20), chest=(4, 0, 10), hips_t=(0, 0.04, -0.1),
               **sym(upperarm_L=(-40, 30, -10), forearm_L=(-120, 0, 0), hand_L=(30, 0, 0)))
    PUSH = o(STANCE, hips=(0, 0, 0), chest=(12, 0, 0), hips_t=(0, -0.08, -0.1), thigh_L=(-40, -4, 0), shin_L=(40, 0, 0),
             **sym(upperarm_L=(-86, 10, -8), forearm_L=(-4, 0, 0), hand_L=(-70, 0, 0)))
    FLICK_L = o(STANCE, chest=(-4, 0, 34), upperarm_R=(-120, -50, 60), forearm_R=(-130, 0, 0), hand_R=(40, 0, 0))
    FLICK = o(STANCE, hips=(0, 0, -20), chest=(10, 0, -16), hips_t=(0, -0.04, -0.06),
              upperarm_R=(-92, -14, 30), forearm_R=(-10, 0, 0), hand_R=(-50, 0, 0))
    FOLD = o(A.STAND, hips_t=(0, 0.02, -0.06), chest=(6, 0, 0), head=(10, 0, 0),
             **sym(upperarm_L=(-58, 20, -36), forearm_L=(-110, 0, -40), hand_L=(-20, 0, -20)))
    RELEASE = o(A.STAND, hips_t=(0, 0, 0.0), chest=(-14, 0, 0), head=(-20, 0, 0),
                **sym(upperarm_L=(-150, -30, -10), forearm_L=(-20, 0, 0), hand_L=(-30, 0, 0)))
    WOLF_L = o(STANCE, hips_t=(0, 0.06, -0.24), chest=(16, 0, 10), upperarm_R=(-150, -10, 20), forearm_R=(-40, 0, 0))
    WOLF = o(A.KNEEL, hips_t=(0, 0.02, -0.44), spine=(30, 0, 0), chest=(24, 0, 0), head=(-14, 0, 0),
             upperarm_R=(-60, -10, 10), forearm_R=(-6, 0, 0), hand_R=(-80, 0, 0), upperarm_L=(-20, 40, -10), forearm_L=(-60, 0, 0))
    DRAW_L = o(STANCE, hips=(0, 0, -70), hips_t=(0, 0.04, -0.18), spine=(14, 0, 20), chest=(12, 0, 30), head=(-4, 0, -40),
               thigh_L=(-50, -6, 10), shin_L=(70, 0, 0), thigh_R=(30, 10, 18), shin_R=(60, 0, 0),
               upperarm_R=(-40, -10, -60), forearm_R=(-110, 0, -40), hand_R=(-10, 0, 0),
               upperarm_L=(-10, 10, -40), forearm_L=(-80, 0, -20), hand_L=(-10, 0, 0))
    DRAW = o(STANCE, hips=(0, 0, 30), hips_t=(0, -0.16, -0.2), spine=(10, 0, -10), chest=(8, 0, -40), head=(0, 0, -20),
             thigh_L=(-64, -6, 10), shin_L=(64, 0, 0), thigh_R=(40, 10, 18), shin_R=(16, 0, 0), foot_R=(-30, 0, 0),
             upperarm_R=(-86, -60, -40), forearm_R=(-2, 0, 0), hand_R=(0, 0, 0), upperarm_L=(-10, 50, 0), forearm_L=(-40, 0, 0))
    SIGN = o(A.STAND, hips_t=(0, 0, -0.02), chest=(2, 0, 0), head=(16, 0, 0),
             **sym(upperarm_L=(-50, 24, -44), forearm_L=(-120, 0, -50), hand_L=(-20, 0, -60)))
    SIGN_UP = o(SIGN, head=(-10, 0, 0), chest=(-6, 0, 0))
    HAIR = o(FORMAL, head=(-4, -6, -10), upperarm_R=(-120, -30, 40), forearm_R=(-140, 0, -40), hand_R=(-20, 0, 0))
    TALK = o(FORMAL, head=(2, 4, 6), upperarm_R=(-30, -26, 10), forearm_R=(-80, 0, -20), hand_R=(-20, 0, 10))

    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_fight', [(0, STANCE), (24, shift(A, STANCE, hips_t=(0, 0, -0.008), hand_R=(-10, 0, 0), chest=(-1.5, 0, 0))), (48, STANCE)], True)
    add('idle_relaxed', sway(A, FORMAL, 110, 1.5, 0.8, 2.0, 0.006), True)
    add('stand', sway(A, FORMAL, 120, 1.0, 0.6, 1.5, 0.004), True)
    add('walk', A.walk(stride=19, bob=0.012, arm=5, lean=0, base=FORMAL, n=34), True)
    add('walk_sad', A.walk(stride=14, bob=0.008, arm=3, lean=6, base=o(FORMAL, head=(18, 0, 0)), n=44), True)
    add('talk', [(0, FORMAL), (16, TALK), (44, TALK), (60, FORMAL)], True)
    add('guard', [(0, GUARD), (12, shift(A, GUARD, hips_t=(0, 0, -0.01))), (24, GUARD)], True)
    add('light1', [(0, STANCE), (3, CHOP_L), (5, CHOP), (9, CHOP), (15, STANCE)])
    add('light2', [(0, STANCE), (2, o(STANCE, upperarm_L=(-40, 40, -10), forearm_L=(-110, 0, 0))), (4, PALM), (8, PALM), (14, STANCE)])
    add('light3', [(0, STANCE), (4, CRESC_L), (8, CRESCENT), (12, CRESCENT), (20, STANCE)])
    add('light4', [(0, STANCE), (4, SLASH_L), (7, SLASH), (12, SLASH), (22, STANCE)])
    add('heavy', [(0, STANCE), (6, KNEE), (10, HIGHKICK), (16, HIGHKICK), (26, STANCE)])
    add('heavy2', [(0, STANCE), (7, PUSH_L), (11, PUSH), (18, PUSH), (28, STANCE)])
    add('dash_attack', [(0, STANCE), (4, DRAW_L), (8, DRAW), (14, DRAW), (22, STANCE)])
    add('cast_throw', [(0, STANCE), (5, FLICK_L), (8, FLICK), (13, FLICK), (20, STANCE)])
    add('cast_raise', [(0, STANCE), (10, FOLD), (18, FOLD), (24, RELEASE), (32, RELEASE), (40, STANCE)])
    add('cast_palm', [(0, STANCE), (8, WOLF_L), (13, WOLF), (24, WOLF), (34, STANCE)])
    add('cast_slam', [(0, STANCE), (10, DRAW_L), (16, DRAW), (28, DRAW), (38, STANCE)])
    add('domain', [(0, STANCE), (12, SIGN), (40, SIGN), (54, SIGN_UP), (60, SIGN_UP)])
    add('victory', [(0, STANCE), (12, FORMAL), (26, HAIR), (50, HAIR), (66, FORMAL)])
    add('run', _run(A, o, FORMAL), True)
    return C


def _run(A, o, base):
    keys = []
    n = 20
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        s = math.sin(ph * 2 * math.pi)
        c = math.cos(ph * 2 * math.pi)
        p = o(A.STAND, hips=(0, 0, 5 * s), hips_t=(0, -0.02, -0.05 + 0.045 * abs(s)), spine=(10, 0, -4 * s), chest=(4, 0, -8 * s), head=(-6, 0, 4 * s),
              thigh_L=(-42 * c, -2, 0), shin_L=(30 + 68 * max(0.0, s), 0, 0), foot_L=(10 * c, 0, 0),
              thigh_R=(42 * c, 2, 0), shin_R=(30 + 68 * max(0.0, -s), 0, 0), foot_R=(-10 * c, 0, 0),
              upperarm_L=(30 * c, 36, 0), forearm_L=(-60, 0, 0), upperarm_R=(-30 * c, -36, 0), forearm_R=(-60, 0, 0))
        keys.append((f, p))
    return keys
