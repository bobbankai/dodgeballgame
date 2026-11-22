"""
Itsuki's own motion: a street brawler who learned to box. High guard, bouncing on the balls of his
feet; short, fast hands; everything he does ends with his weight still forward. Out of a fight his
hands go in his pockets and his head goes down. His techniques are the bell: a stamping palm that
rings, a chain of seals whipped up from the ground, a jumping two-handed slam that tolls.
"""
from anim._kit import bounce, shift, sway


def clips(A):
    o, sym = A.over, A.sym
    STANCE = o(A.STANCE, hips_t=(0.0, 0.02, -0.085), chest=(10, 0, 14), head=(-4, 0, 6),
               upperarm_L=(-60, 26, -16), forearm_L=(-108, 0, 0), hand_L=(-16, 0, 0),
               upperarm_R=(-46, -32, 24), forearm_R=(-118, 0, 0), hand_R=(-12, 0, 0))
    POCKETS = o(A.STAND, spine=(6, 0, 0), chest=(4, 0, 0), neck=(6, 0, 0), head=(10, 0, -4), hips=(0, -3, 0),
                **sym(upperarm_L=(14, 28, 16), forearm_L=(-34, 0, 12), hand_L=(10, 0, 0)),
                thigh_R=(-4, 4, -6), shin_R=(8, 0, 0))
    GUARD = o(STANCE, chest=(16, 0, 4), head=(8, 0, 0), hips_t=(0, 0.05, -0.1),
              upperarm_L=(-84, 14, -34), forearm_L=(-128, 0, 20), upperarm_R=(-80, -14, 34), forearm_R=(-128, 0, -20))
    # strikes
    JAB = o(STANCE, hips=(0, 0, -32), chest=(10, 0, -6), head=(-4, 0, 10), hips_t=(0, -0.02, -0.08),
            shoulder_L=(0, 0, -14), upperarm_L=(-90, 6, -28), forearm_L=(-4, 0, 0), hand_L=(0, 0, 0))
    CROSS_L = o(STANCE, hips=(0, 0, -36), chest=(8, 0, 26), upperarm_R=(-40, -34, 34), forearm_R=(-126, 0, 0))
    CROSS = o(STANCE, hips=(0, 0, 10), hips_t=(0, -0.06, -0.09), chest=(14, 0, -28), head=(-4, 0, -8),
              thigh_R=(12, 6, 0), shin_R=(16, 0, 0), foot_R=(-36, 0, 0),
              shoulder_R=(0, 0, 18), upperarm_R=(-90, -8, 38), forearm_R=(-3, 0, 0), hand_R=(0, 0, 0))
    LIVER_L = o(STANCE, hips_t=(0, 0.02, -0.14), chest=(20, 0, 26), upperarm_L=(-40, -20, 16), forearm_L=(-100, 0, 0),
                thigh_L=(-40, -4, 12), shin_L=(50, 0, 0))
    LIVER = o(STANCE, hips=(0, 0, -46), hips_t=(0, -0.03, -0.15), spine=(14, 0, 0), chest=(20, 0, -34), head=(0, 0, 18),
              upperarm_L=(-58, -36, -56), forearm_L=(-92, 0, 0), hand_L=(-6, 0, 0),
              thigh_L=(-44, -4, 12), shin_L=(54, 0, 0), thigh_R=(24, 8, 14), shin_R=(40, 0, 0))
    SPIN_L = o(STANCE, hips=(0, 0, 30), chest=(6, 0, 50), head=(-6, 0, -40), hips_t=(0, 0.0, -0.1))
    BACKFIST = o(STANCE, hips=(0, 0, -170), hips_t=(0, -0.04, -0.09), chest=(4, 0, -30), head=(-4, 0, 190),
                 upperarm_R=(-86, -70, 10), forearm_R=(-14, 0, 0), hand_R=(-20, 0, 0), upperarm_L=(-50, 40, 10), forearm_L=(-110, 0, 0))
    CROUCH = o(STANCE, hips_t=(0, 0.04, -0.26), spine=(18, 0, 10), chest=(20, 0, 28), head=(-14, 0, 0),
               thigh_L=(-62, -4, 12), shin_L=(86, 0, 0), thigh_R=(34, 8, 14), shin_R=(70, 0, 0),
               upperarm_R=(-16, -30, 36), forearm_R=(-124, 0, 0), hand_R=(-24, 0, 0))
    TOLL = o(STANCE, hips=(0, 0, 14), hips_t=(0, -0.04, 0.1), spine=(-14, 0, -6), chest=(-20, 0, -26), head=(-22, 0, -8),
             thigh_L=(-10, -4, 12), shin_L=(4, 0, 0), foot_L=(14, 0, 0), thigh_R=(-30, 8, 0), shin_R=(70, 0, 0), foot_R=(30, 0, 0),
             shoulder_R=(0, 0, 12), upperarm_R=(-168, -6, 10), forearm_R=(-40, 0, 0), hand_R=(-10, 0, 0),
             upperarm_L=(-30, 40, -10), forearm_L=(-90, 0, 0))
    HAMMER_UP = o(STANCE, hips_t=(0, 0.02, -0.04), chest=(-18, 0, 0), head=(-14, 0, 0),
                  **sym(upperarm_L=(-176, -8, -6), forearm_L=(-60, 0, 0), hand_L=(-20, 0, 0)))
    HAMMER = o(STANCE, hips_t=(0, -0.05, -0.2), spine=(30, 0, 0), chest=(26, 0, 0), head=(-8, 0, 0),
               thigh_L=(-56, -4, 12), shin_L=(64, 0, 0), thigh_R=(30, 8, 14), shin_R=(56, 0, 0),
               **sym(upperarm_L=(-62, 6, -10), forearm_L=(-30, 0, 0), hand_L=(-30, 0, 0)))
    TACKLE = o(STANCE, hips=(0, 0, -40), hips_t=(0, -0.12, -0.16), spine=(26, 0, -10), chest=(20, 0, -20), head=(-20, 0, 26),
               upperarm_L=(-30, 10, -50), forearm_L=(-120, 0, 0), upperarm_R=(-60, -30, 40), forearm_R=(-120, 0, 0),
               thigh_L=(-56, -4, 12), shin_L=(56, 0, 0), thigh_R=(36, 8, 14), shin_R=(20, 0, 0), foot_R=(-30, 0, 0))
    # techniques
    STAMP_L = o(STANCE, hips_t=(0, 0.04, -0.02), thigh_L=(-76, -4, 12), shin_L=(96, 0, 0), foot_L=(10, 0, 0),
                chest=(4, 0, 30), upperarm_R=(-20, -46, 44), forearm_R=(-132, 0, 0), hand_R=(30, 0, 0))
    STAMP = o(A.PALM, hips_t=(0, -0.1, -0.16), thigh_L=(-52, -4, 12), shin_L=(54, 0, 0), foot_L=(-6, 0, 0),
              upperarm_R=(-92, -2, 42), forearm_R=(-2, 0, 0), hand_R=(-76, 0, 0))
    WHIP_L = o(STANCE, hips_t=(0, 0.04, -0.24), spine=(24, 0, -10), chest=(20, 0, -24),
               upperarm_R=(-6, -50, -10), forearm_R=(-10, 0, 0), hand_R=(10, 0, 0), thigh_L=(-56, -4, 12), shin_L=(80, 0, 0))
    WHIP = o(STANCE, hips_t=(0, -0.02, 0.0), spine=(-12, 0, 10), chest=(-18, 0, 30), head=(-16, 0, 10),
             upperarm_R=(-178, -20, 30), forearm_R=(-6, 0, 0), hand_R=(-20, 0, 0), upperarm_L=(-30, 40, 0), forearm_L=(-80, 0, 0))
    JUMP_UP = o(A.AIR, hips_t=(0, 0, 0.18), chest=(-24, 0, 0), head=(-16, 0, 0),
                **sym(upperarm_L=(-178, -12, -4), forearm_L=(-40, 0, 0), hand_L=(-20, 0, 0)))
    REQUIEM = o(A.SLAM, hips_t=(0, -0.08, -0.4), **sym(upperarm_L=(-40, 20, 0), forearm_L=(-10, 0, 0), hand_L=(-60, 0, 0)))
    SEAL_L = o(STANCE, hips=(0, 0, -60), chest=(-2, 0, 40), upperarm_R=(-110, -50, 70), forearm_R=(-100, 0, 0), hand_R=(30, 0, 0))
    SEAL = o(STANCE, hips=(0, 0, 10), chest=(18, 0, -34), hips_t=(0, -0.06, -0.1),
             upperarm_R=(-84, 10, 30), forearm_R=(-2, 0, 0), hand_R=(-30, 0, 0))
    PRAYER = o(A.STAND, hips_t=(0, 0, -0.02), chest=(2, 0, 0), head=(18, 0, 0),
               upperarm_R=(-56, -10, -40), forearm_R=(-118, 0, -60), hand_R=(-10, 0, 80),
               upperarm_L=(4, 34, 4), forearm_L=(-10, 0, 0))
    PRAYER_UP = o(PRAYER, head=(-14, 0, 0), chest=(-8, 0, 0))
    BELL_LOOK = o(A.STAND, head=(20, 0, 0), neck=(10, 0, 0), chest=(6, 0, 0),
                  upperarm_R=(-48, -20, -20), forearm_R=(-120, 0, -30), hand_R=(-20, 0, 0))
    TALK = o(POCKETS, head=(4, 2, 6), upperarm_R=(-20, -30, 10), forearm_R=(-70, 0, -10), hand_R=(-10, 0, 0))

    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    add('idle_fight', bounce(A, STANCE, 24, 0.028), True)
    add('idle_relaxed', sway(A, POCKETS, 96, 2.5, 1.5, 4.0), True)
    add('stand', sway(A, POCKETS, 110, 1.5, 1.0, 2.0), True)
    add('walk', A.walk(stride=24, bob=0.022, arm=5, lean=7, base=POCKETS, n=32), True)
    add('walk_sad', A.walk(stride=16, bob=0.01, arm=3, lean=12, base=o(POCKETS, head=(24, 0, 0), neck=(12, 0, 0)), n=46), True)
    add('talk', [(0, POCKETS), (14, TALK), (40, TALK), (56, o(TALK, upperarm_R=(-30, -30, 0), forearm_R=(-90, 0, 0))), (80, POCKETS)], True)
    add('guard', [(0, GUARD), (10, shift(A, GUARD, hips_t=(0, 0, -0.012))), (20, GUARD)], True)
    add('light1', [(0, STANCE), (2, o(STANCE, upperarm_L=(-60, 26, -6), forearm_L=(-118, 0, 0))), (3, JAB), (6, JAB), (11, STANCE)])
    add('light2', [(0, STANCE), (2, CROSS_L), (4, CROSS), (8, CROSS), (14, STANCE)])
    add('light3', [(0, STANCE), (4, LIVER_L), (7, LIVER), (11, LIVER), (18, STANCE)])
    add('light4', [(0, STANCE), (4, SPIN_L), (8, BACKFIST), (13, BACKFIST), (22, o(STANCE, hips=(0, 0, -386)))])
    add('heavy', [(0, STANCE), (7, CROUCH), (10, TOLL), (16, TOLL), (26, STANCE)])
    add('heavy2', [(0, STANCE), (8, HAMMER_UP), (12, HAMMER), (18, HAMMER), (28, STANCE)])
    add('dash_attack', [(0, STANCE), (3, CROSS_L), (6, TACKLE), (12, TACKLE), (20, STANCE)])
    add('cast_palm', [(0, STANCE), (7, STAMP_L), (11, STAMP), (20, STAMP), (30, STANCE)])
    add('cast_raise', [(0, STANCE), (9, WHIP_L), (14, WHIP), (24, WHIP), (34, STANCE)])
    add('cast_slam', [(0, STANCE), (6, CROUCH), (12, JUMP_UP), (17, REQUIEM), (26, REQUIEM), (36, STANCE)])
    add('cast_throw', [(0, STANCE), (6, SEAL_L), (10, SEAL), (15, SEAL), (24, STANCE)])
    add('domain', [(0, STANCE), (10, PRAYER), (40, PRAYER), (54, PRAYER_UP), (60, PRAYER_UP)])
    add('victory', [(0, STANCE), (14, o(A.STAND, head=(10, 0, 0))), (30, BELL_LOOK), (60, BELL_LOOK), (80, o(BELL_LOOK, head=(26, 0, 0), chest=(10, 0, 0)))])
    add('run', _run(A, o), True)
    return C


def _run(A, o):
    keys = []
    import math
    n = 18
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        s = math.sin(ph * 2 * math.pi)
        c = math.cos(ph * 2 * math.pi)
        p = o(A.STAND, hips=(0, 0, 7 * s), hips_t=(0, -0.03, -0.07 + 0.06 * abs(s)), spine=(22, 0, -6 * s), chest=(8, 0, -12 * s), head=(-16, 0, 6 * s),
              thigh_L=(-50 * c, -2, 0), shin_L=(34 + 76 * max(0.0, s), 0, 0), foot_L=(12 * c, 0, 0),
              thigh_R=(50 * c, 2, 0), shin_R=(34 + 76 * max(0.0, -s), 0, 0), foot_R=(-12 * c, 0, 0),
              upperarm_L=(56 * c, 26, 0), forearm_L=(-100, 0, 0), hand_L=(-20, 0, 0), upperarm_R=(-56 * c, -26, 0), forearm_R=(-100, 0, 0), hand_R=(-20, 0, 0))
        keys.append((f, p))
    return keys
