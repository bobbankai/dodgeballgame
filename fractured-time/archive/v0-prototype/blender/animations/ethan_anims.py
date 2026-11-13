"""
Humanoid animation library (30 fps). Used for Ethan, the Echo and, with tweaks, every human enemy.

Conventions (armature axes, degrees): for an upward bone +X bends it forward, for a downward bone +X swings it
back. Left leg/arm abduct with -Y; the mirrored right side flips Y and Z. Feet use `ax` (absolute pitch, + = toes down).
Character faces -Y; spine yaw rz > 0 turns to the character's left.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from anim_lib import both, hand, keyed, merge, mirror  # noqa: E402


def T(keys, k):
    """Scale the key times of a channel."""
    return [(t * k, v) for t, v in keys]


def relaxed_arms(curl=22):
    L = {'upperarm_L': {'rx': 4, 'ry': 25}, 'forearm_L': {'rx': -14, 'ry': 3}, 'hand_L': {'rx': -4}, **hand(curl)}
    return both(L, mirror_L=True)


# --- stances -----------------------------------------------------------------------------------------------

def guard(dz=0.0, dy=0.0, yaw=0.0, lead=None, rear=None, lean=0.0):
    """Orthodox fighting stance: left side leads. dz crouch, dy weight forward (negative = forward)."""
    body = {
        'hips': {'tz': -0.060 + dz, 'ty': dy, 'rz': -10 + yaw * 0.5, 'rx': 4},
        'spine': {'rx': 6 + lean, 'rz': -8 + yaw * 0.3},
        'chest': {'rx': 3, 'rz': -6 + yaw * 0.2},
        'neck': {'rx': -4, 'rz': 7},
        'head': {'rx': -5 - lean * 0.5, 'rz': 15 - yaw * 0.4},
        'thigh_L': {'rx': -17, 'ry': -4, 'rz': 8},
        'shin_L': {'rx': 24},
        'foot_L': {'ax': 0},
        'thigh_R': {'rx': 10, 'ry': 6, 'rz': 8},
        'shin_R': {'rx': 24},
        'foot_R': {'ax': 8},
    }
    arm_l = {'upperarm_L': {'rx': -34, 'ry': 31, 'rz': -6}, 'forearm_L': {'rx': -112, 'ry': -10}, 'hand_L': {'rx': -6}, **hand(62)}
    arm_r = mirror({'upperarm_L': {'rx': -42, 'ry': 35, 'rz': -10}, 'forearm_L': {'rx': -124, 'ry': -14}, 'hand_L': {'rx': -6}, **hand(62)})
    return merge(body, arm_l, arm_r, lead or {}, rear or {})


def relaxed(dz=0.0, rz=0.0):
    p = {'hips': {'tz': dz, 'rz': rz}, 'spine': {'rx': 2}, 'head': {'rx': -2},
         'thigh_L': {'ry': -2}, 'thigh_R': {'ry': 2, 'rx': -2}, 'shin_R': {'rx': 4}, 'foot_L': {'ax': 0}, 'foot_R': {'ax': 0}}
    return merge(p, relaxed_arms())


# --- loops: written for the left side, phase-copied to the right (sym) ------------------------------------

def loops():
    out = []

    def loop(name, N, ch, sym, meta=None, events=None):
        out.append(dict(name=name, N=N, ch=ch, loop=True, sym=sym, events=events or {}, meta=meta or {}))

    arms = {'upperarm_L': {'rx': [(0, 16), (16, -18)], 'ry': 25}, 'forearm_L': {'rx': [(0, -12), (16, -30)]}, 'hand_L': {'rx': -4}}
    loop('idle', 96, {
        'hips': {'tz': [(0, -0.004), (48, -0.012)], 'tx': [(0, 0.006), (48, -0.003)], 'ry': [(0, -1.2), (48, 1.0)]},
        'spine': {'rx': [(0, 2.0), (48, 3.2)]}, 'chest': {'rx': [(0, 0.5), (48, -2.5)]},
        'neck': {'rx': [(0, -1.0), (48, 0.0)]},
        'head': {'rx': [(0, -2.0), (48, -0.5)], 'rz': [(0, 3.0), (40, -3.0), (70, -1.0)], 'ry': [(0, -1.5), (48, 1.5)]},
        'upperarm_L': {'rx': [(0, 4.0), (48, 2.0)], 'ry': [(0, 20.0), (48, 19.0)]},
        'forearm_L': {'rx': [(0, -14.0), (48, -12.0)], 'ry': 3}, 'hand_L': {'rx': -4},
        'thigh_L': {'ry': -2.0}, 'thigh_R': {'ry': 2.0, 'rx': -2.0}, 'shin_R': {'rx': 4.0}, 'foot_L': {'ax': 0.0}, 'foot_R': {'ax': 0.0},
        'shoulder_L': {'ry': [(0, 0.0), (48, -2.0)]},
        **hand(22),
    }, sym=0)

    # idle_combat: stance with a bounce on the balls of the feet and a hand flick
    gp = guard()
    ch = {b: {c: v for c, v in cs.items()} for b, cs in gp.items() if b.endswith('_L') or b in ('hips', 'spine', 'chest', 'neck', 'head')}
    ch['hips'] = {**ch['hips'], 'tz': [(0, -0.060), (12, -0.080), (24, -0.060)], 'ty': [(0, 0.0), (12, -0.01), (24, 0.0)]}
    ch['spine'] = {**ch['spine'], 'rx': [(0, 6.0), (12, 8.0), (24, 6.0)]}
    ch['head'] = {**ch['head'], 'rz': [(0, 15.0), (12, 13.0), (24, 15.0)]}
    ch['upperarm_L'] = {**ch['upperarm_L'], 'rx': [(0, -36.0), (12, -39.0), (24, -36.0)]}
    for b in ('thigh_R', 'shin_R', 'foot_R', 'upperarm_R', 'forearm_R', 'hand_R'):
        ch[b] = gp[b]
    for b in [x for x in gp if x.endswith('_R') and x not in ch]:
        ch[b] = gp[b]
    loop('idle_combat', 24, ch, sym=None, meta={'kind': 'stance'})

    # walk: two 0.78 m steps per cycle
    k = 32 / 28
    loop('walk', 32, {
        'hips': {'tz': [(0, -0.026), (8, 0.002), (16, -0.026), (24, 0.002)], 'tx': [(0, 0.0), (8, 0.012), (16, 0.0), (24, -0.012)],
                 'rz': [(0, -6.0), (16, 6.0)], 'ry': [(8, -3.0), (24, 3.0)], 'rx': 3.0},
        'spine': {'rx': 4.0, 'rz': [(0, 4.0), (16, -4.0)], 'ry': [(8, 1.5), (24, -1.5)]},
        'chest': {'rx': 1.0, 'rz': [(0, 5.0), (16, -5.0)]},
        'neck': {'rx': -2.0, 'rz': [(0, -2.0), (16, 2.0)]}, 'head': {'rx': -3.0, 'rz': [(0, -2.0), (16, 2.0)]},
        'thigh_L': {'rx': T([(0, -26), (7, -4), (14, 16), (17, 20), (21, -4), (25, -28)], k), 'ry': -2.0},
        'shin_L': {'rx': T([(0, 4), (3, 16), (7, 6), (12, 8), (16, 30), (19, 52), (22, 46), (25, 16)], k)},
        'foot_L': {'ax': T([(0, -18), (4, 0), (12, 0), (14, 12), (17, 35), (19, 20), (22, 0), (25, -15)], k)},
        'toe_L': {'rx': T([(0, 0), (14, 6), (17, 18), (22, 0)], k)},
        **arms, **hand(22)}, sym=16, meta={'speed': 1.55})

    k = 20 / 18
    loop('run', 20, {
        'hips': {'tz': T([(0, -0.025), (2, -0.050), (5, -0.010), (7, 0.018), (9, -0.025), (11, -0.050), (14, -0.010), (16, 0.018)], k),
                 'rx': 9.0, 'rz': [(0, -10.0), (10, 10.0)], 'ry': [(5, -4.0), (15, 4.0)], 'tx': [(5, 0.010), (15, -0.010)]},
        'spine': {'rx': 11.0, 'rz': [(0, 7.0), (10, -7.0)]}, 'chest': {'rx': 6.0, 'rz': [(0, 7.0), (10, -7.0)]},
        'neck': {'rx': -7.0}, 'head': {'rx': -13.0, 'rz': [(0, -3.0), (10, 3.0)]},
        'thigh_L': {'rx': T([(0, -34), (2, -22), (5, 6), (7, 30), (9, 32), (11, 18), (13, -16), (15, -48), (17, -42)], k), 'ry': -2.0},
        'shin_L': {'rx': T([(0, 14), (2, 40), (5, 28), (7, 18), (9, 62), (11, 104), (13, 108), (15, 62), (17, 24)], k)},
        'foot_L': {'ax': T([(0, -4), (2, 0), (5, 12), (7, 42), (9, 46), (11, 30), (13, 10), (15, -10), (17, -12)], k)},
        'toe_L': {'rx': T([(0, 0), (7, 16), (9, 24), (13, 0)], k)},
        'upperarm_L': {'rx': [(0, 34), (10, -34)], 'ry': 28}, 'forearm_L': {'rx': [(0, -82), (6, -92), (10, -108), (16, -92)], 'ry': -4},
        'hand_L': {'rx': -14}, **hand(60)}, sym=10, meta={'speed': 4.6})

    k = 16 / 18
    loop('sprint', 16, {
        'hips': {'tz': T([(0, -0.030), (2, -0.060), (5, -0.010), (7, 0.025), (9, -0.030), (11, -0.060), (14, -0.010), (16, 0.025)], k),
                 'rx': 16.0, 'rz': [(0, -12.0), (8, 12.0)], 'ry': [(4, -4.0), (12, 4.0)]},
        'spine': {'rx': 16.0, 'rz': [(0, 8.0), (8, -8.0)]}, 'chest': {'rx': 8.0, 'rz': [(0, 8.0), (8, -8.0)]},
        'neck': {'rx': -10.0}, 'head': {'rx': -16.0},
        'thigh_L': {'rx': T([(0, -44), (2, -28), (5, 8), (7, 38), (9, 40), (11, 22), (13, -20), (15, -58), (17, -52)], k), 'ry': -2.0},
        'shin_L': {'rx': T([(0, 18), (2, 46), (5, 32), (7, 20), (9, 70), (11, 116), (13, 122), (15, 70), (17, 28)], k)},
        'foot_L': {'ax': T([(0, -6), (2, 0), (5, 14), (7, 46), (9, 50), (11, 32), (13, 10), (15, -12), (17, -14)], k)},
        'toe_L': {'rx': T([(0, 0), (7, 18), (9, 26), (13, 0)], k)},
        'upperarm_L': {'rx': [(0, 44), (8, -42)], 'ry': 28}, 'forearm_L': {'rx': [(0, -88), (5, -98), (8, -118), (13, -98)], 'ry': -4},
        'hand_L': {'rx': -14}, **hand(72)}, sym=8, meta={'speed': 6.4})

    # combat locomotion: guard upper body, short stepping legs
    def cwalk(name, N, leg_ch, meta):
        g = guard(dz=0.01)
        ch = {b: dict(cs) for b, cs in g.items() if b not in ('thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R') and not b.endswith('_R')}
        ch['hips'] = {**ch['hips'], 'tz': [(0, -0.07), (N // 4, -0.05), (N // 2, -0.07), (3 * N // 4, -0.05)]}
        ch.update(leg_ch)
        for b in [x for x in g if x.endswith('_R') and x.split('_')[0] not in ('thigh', 'shin', 'foot')]:
            ch[b] = g[b]
        out.append(dict(name=name, N=N, ch=ch, loop=True, sym=None, events={}, meta=meta))

    def two_legs(Lthigh, Lshin, Lfoot, Rthigh, Rshin, Rfoot, extra=None):
        d = {'thigh_L': Lthigh, 'shin_L': Lshin, 'foot_L': Lfoot, 'thigh_R': Rthigh, 'shin_R': Rshin, 'foot_R': Rfoot}
        d.update(extra or {})
        return d
    N = 28
    cwalk('combat_walk_F', N, two_legs(
        {'rx': [(0, -34), (7, -18), (14, -8), (21, -18)], 'ry': -5, 'rz': 8}, {'rx': [(0, 22), (7, 44), (14, 34), (21, 26)]}, {'ax': [(0, -10), (7, 0), (14, 8), (21, -4)]},
        {'rx': [(0, 4), (7, 24), (14, 26), (21, 8)], 'ry': 7, 'rz': 8}, {'rx': [(0, 32), (7, 26), (14, 36), (21, 40)]}, {'ax': [(0, 14), (7, 10), (14, 0), (21, 20)]}), {'speed': 1.7})
    cwalk('combat_walk_B', N, two_legs(
        {'rx': [(0, -10), (7, -22), (14, -34), (21, -22)], 'ry': -5, 'rz': 8}, {'rx': [(0, 30), (7, 30), (14, 26), (21, 36)]}, {'ax': [(0, 6), (7, 0), (14, -6), (21, 4)]},
        {'rx': [(0, 20), (7, 8), (14, 4), (21, 14)], 'ry': 7, 'rz': 8}, {'rx': [(0, 24), (7, 36), (14, 30), (21, 22)]}, {'ax': [(0, 10), (7, 18), (14, 12), (21, 8)]}), {'speed': 1.5})
    cwalk('combat_strafe_L', N, two_legs(
        {'rx': -22, 'ry': [(0, -24), (7, -14), (14, 0), (21, -10)], 'rz': 8}, {'rx': [(0, 26), (7, 38), (14, 28), (21, 30)]}, {'ax': [(0, 0), (7, -6), (14, 0), (21, 0)]},
        {'rx': 14, 'ry': [(0, 0), (7, 12), (14, 22), (21, 14)], 'rz': 8}, {'rx': [(0, 28), (7, 26), (14, 38), (21, 30)]}, {'ax': [(0, 10), (7, 10), (14, 4), (21, 10)]}), {'speed': 1.6})
    cwalk('combat_strafe_R', N, two_legs(
        {'rx': -22, 'ry': [(0, 2), (7, 10), (14, 22), (21, 10)], 'rz': 8}, {'rx': [(0, 28), (7, 26), (14, 38), (21, 30)]}, {'ax': [(0, 0), (7, 0), (14, 0), (21, 0)]},
        {'rx': 14, 'ry': [(0, 18), (7, 8), (14, -4), (21, 8)], 'rz': 8}, {'rx': [(0, 32), (7, 40), (14, 28), (21, 28)]}, {'ax': [(0, 10), (7, 4), (14, 12), (21, 10)]}), {'speed': 1.6})

    # fall loop
    fl = merge(relaxed(dz=0.0), {
        'hips': {'tz': 0.0, 'rx': 6}, 'thigh_L': {'rx': -20, 'ry': -6}, 'thigh_R': {'rx': 8, 'ry': 6}, 'shin_L': {'rx': 36}, 'shin_R': {'rx': 46},
        'foot_L': {'ax': 18}, 'foot_R': {'ax': 22},
        'upperarm_L': {'rx': -10, 'ry': -26}, 'forearm_L': {'rx': -30},
        **mirror({'upperarm_L': {'rx': -10, 'ry': -26}, 'forearm_L': {'rx': -30}})})
    loop('fall', 24, {b: {c: ([(0, v), (12, v * 1.0 + (3 if c == 'rx' else 0)), (24, v)]) for c, v in cs.items()} for b, cs in fl.items() if b.endswith('_L') or b in ('hips', 'spine', 'head', 'neck', 'chest')} | {
        b: {c: v for c, v in cs.items()} for b, cs in fl.items() if b.endswith('_R')}, sym=None)
    return out


# --- one-shot clips ---------------------------------------------------------------------------------------

def shots():
    clips = []
    G = guard

    def add(name, N, keys, events=None, meta=None, loop=False):
        c = keyed(name, N, keys, loop=loop, events=events)
        c['meta'] = meta or {}
        clips.append(c)

    # --- jump / land
    add('jump', 14, [(0, relaxed(dz=-0.06)), (4, merge(relaxed(dz=-0.12), {'thigh_L': {'rx': -26}, 'shin_L': {'rx': 52}, 'thigh_R': {'rx': -26}, 'shin_R': {'rx': 52},
                                                                              'spine': {'rx': 10}, 'foot_L': {'ax': 0}, 'foot_R': {'ax': 0}})),
                     (8, merge(relaxed(dz=0.02), {'thigh_L': {'rx': 8, 'ry': -4}, 'shin_L': {'rx': 14}, 'thigh_R': {'rx': 8, 'ry': 4}, 'shin_R': {'rx': 14}, 'foot_L': {'ax': 38}, 'foot_R': {'ax': 38}})),
                     (14, merge(relaxed(), {'thigh_L': {'rx': -16}, 'shin_L': {'rx': 30}, 'thigh_R': {'rx': -10}, 'shin_R': {'rx': 40}}))],
        events={'launch': 5})
    add('land', 16, [(0, merge(relaxed(dz=-0.04), {'thigh_L': {'rx': -16}, 'shin_L': {'rx': 30}, 'thigh_R': {'rx': -10}, 'shin_R': {'rx': 40}})),
                     (4, merge(relaxed(dz=-0.17), {'thigh_L': {'rx': -52, 'ry': -6}, 'shin_L': {'rx': 96}, 'thigh_R': {'rx': -48, 'ry': 6}, 'shin_R': {'rx': 92},
                                                    'spine': {'rx': 18}, 'chest': {'rx': 6}, 'head': {'rx': -12}, 'foot_L': {'ax': 0}, 'foot_R': {'ax': 0},
                                                    'upperarm_L': {'rx': -18, 'ry': -20}, **mirror({'upperarm_L': {'rx': -18, 'ry': -20}})})),
                     (16, relaxed())], events={'impact': 3})

    # --- light attacks (lead jab, rear cross, lead hook, rear front-kick)
    jab_ext = {'upperarm_L': {'rx': -86, 'ry': 4}, 'forearm_L': {'rx': -6, 'ry': 0}, 'hand_L': {'rx': 0}, **hand(80)}
    add('light1', 20, [
        (0, G()),
        (3, G(yaw=-6, lead={'upperarm_L': {'rx': -22, 'ry': 22}, 'forearm_L': {'rx': -128}})),
        (6, G(yaw=14, dy=-0.05, lean=3, lead=jab_ext, rear={'thigh_L': {'rx': -30}})),
        (9, G(yaw=14, dy=-0.05, lean=3, lead=jab_ext, rear={'thigh_L': {'rx': -30}})),
        (20, G())],
        events={'hit': [6, 9], 'cancel': 12, 'striker': 'hand_L', 'damage': 1.0, 'stagger': 0.35, 'reach': 0.35, 'lunge': 0.45})
    cross_ext = mirror({'upperarm_L': {'rx': -88, 'ry': 8}, 'forearm_L': {'rx': -4}, 'hand_L': {'rx': 0}, **hand(80)})
    add('light2', 22, [
        (0, G()),
        (4, G(yaw=-10, rear=mirror({'upperarm_L': {'rx': -26, 'ry': 28}, 'forearm_L': {'rx': -134}}), lead={'thigh_L': {'rx': -26}})),
        (7, G(yaw=34, dy=-0.07, lean=5, rear=cross_ext, lead={'thigh_L': {'rx': -28}, 'shin_L': {'rx': 34}}, )),
        (10, G(yaw=34, dy=-0.07, lean=5, rear=cross_ext)),
        (22, G())],
        events={'hit': [7, 10], 'cancel': 14, 'striker': 'hand_R', 'damage': 1.3, 'stagger': 0.5, 'reach': 0.4, 'lunge': 0.55})
    add('light3', 26, [
        (0, G()),
        (5, G(yaw=-20, lead={'upperarm_L': {'rx': -40, 'ry': -44}, 'forearm_L': {'rx': -100, 'rz': 30}})),
        (9, G(yaw=-30, dy=-0.04, lead={'upperarm_L': {'rx': -52, 'ry': -78}, 'forearm_L': {'rx': -98, 'rz': -20}})),
        (12, G(yaw=40, dy=-0.06, lean=4, lead={'upperarm_L': {'rx': -56, 'ry': -42}, 'forearm_L': {'rx': -92, 'rz': -50}, 'hand_L': {'rx': 0}, **hand(80)})),
        (26, G())],
        events={'hit': [9, 12], 'cancel': 17, 'striker': 'hand_L', 'damage': 1.6, 'stagger': 0.7, 'reach': 0.4, 'lunge': 0.4})
    kick_r = mirror({'thigh_L': {'rx': -96, 'ry': 8}, 'shin_L': {'rx': 8}, 'foot_L': {'ax': 20}, 'toe_L': {'rx': 12}})
    add('light4', 30, [
        (0, G()),
        (5, G(lean=-4, rear=mirror({'thigh_L': {'rx': -60}, 'shin_L': {'rx': 100}, 'foot_L': {'ax': 10}}), lead={'shin_L': {'rx': 38}})),
        (10, G(lean=-12, rear=kick_r, lead={'shin_L': {'rx': 40}, 'thigh_L': {'rx': -20}})),
        (14, G(lean=-12, rear=kick_r, lead={'shin_L': {'rx': 40}, 'thigh_L': {'rx': -20}})),
        (30, G())],
        events={'hit': [10, 14], 'cancel': 21, 'striker': 'foot_R', 'damage': 2.2, 'stagger': 1.0, 'reach': 0.55, 'lunge': 0.55, 'launch': 0.0})

    # --- heavy attacks
    oh = {'upperarm_L': {'rx': -120, 'ry': -10}, 'forearm_L': {'rx': -90}}
    oh_hit = {'upperarm_L': {'rx': -52, 'ry': 4}, 'forearm_L': {'rx': -10}, **hand(86)}
    add('heavy1', 40, [
        (0, G()),
        (10, G(yaw=-16, dz=-0.04, lean=-6, lead=oh, rear=mirror({'upperarm_L': {'rx': -90, 'ry': -10}, 'forearm_L': {'rx': -80}}))),
        (17, G(yaw=-16, dz=-0.04, lean=-8, lead=oh, rear=mirror({'upperarm_L': {'rx': -90, 'ry': -10}, 'forearm_L': {'rx': -80}}))),
        (21, G(yaw=26, dz=-0.14, dy=-0.12, lean=22, lead=oh_hit, rear=mirror({'upperarm_L': {'rx': -60, 'ry': 6}, 'forearm_L': {'rx': -50}}))),
        (26, G(yaw=26, dz=-0.14, dy=-0.12, lean=22, lead=oh_hit)),
        (40, G())],
        events={'hit': [20, 24], 'cancel': 32, 'striker': 'hand_L', 'damage': 3.2, 'stagger': 1.6, 'reach': 0.5, 'lunge': 0.9, 'guardbreak': True})
    rh = mirror({'thigh_L': {'rx': -78, 'ry': -50, 'rz': -30}, 'shin_L': {'rx': 12}, 'foot_L': {'ax': 12}})
    add('heavy2', 42, [
        (0, G()),
        (10, G(yaw=-12, lean=-6, rear=mirror({'thigh_L': {'rx': -40, 'ry': -26}, 'shin_L': {'rx': 96}, 'foot_L': {'ax': 14}}))),
        (16, G(yaw=-12, lean=-6, rear=mirror({'thigh_L': {'rx': -40, 'ry': -26}, 'shin_L': {'rx': 96}, 'foot_L': {'ax': 14}}))),
        (20, G(yaw=60, lean=-14, rear=rh, lead={'shin_L': {'rx': 44}})),
        (24, G(yaw=60, lean=-14, rear=rh, lead={'shin_L': {'rx': 44}})),
        (42, G())],
        events={'hit': [19, 24], 'cancel': 33, 'striker': 'foot_R', 'damage': 3.6, 'stagger': 2.0, 'reach': 0.7, 'lunge': 0.7, 'guardbreak': True})
    upc = {'upperarm_L': {'rx': -150, 'ry': -6}, 'forearm_L': {'rx': -44}, **hand(86)}
    add('heavy3', 36, [
        (0, G()),
        (9, G(dz=-0.20, lean=14, yaw=-12, lead={'upperarm_L': {'rx': 10, 'ry': 12}, 'forearm_L': {'rx': -24}})),
        (14, G(dz=-0.20, lean=14, yaw=-12, lead={'upperarm_L': {'rx': 10, 'ry': 12}, 'forearm_L': {'rx': -24}})),
        (18, G(dz=0.08, lean=-14, yaw=22, dy=-0.06, lead=upc, rear={'thigh_L': {'rx': -10}, 'shin_L': {'rx': 12}, 'thigh_R': {'rx': 6}, 'shin_R': {'rx': 8}, 'foot_L': {'ax': 36}, 'foot_R': {'ax': 36}})),
        (22, G(dz=0.08, lean=-14, yaw=22, dy=-0.06, lead=upc)),
        (36, G())],
        events={'hit': [17, 22], 'cancel': 28, 'striker': 'hand_L', 'damage': 3.0, 'stagger': 1.2, 'reach': 0.5, 'lunge': 0.4, 'launch': 1.0})

    # --- defence
    blockL = {'upperarm_L': {'rx': -64, 'ry': 34}, 'forearm_L': {'rx': -128, 'ry': -26}, 'hand_L': {'rx': -10}, **hand(70)}
    blockR = mirror({'upperarm_L': {'rx': -72, 'ry': 34}, 'forearm_L': {'rx': -134, 'ry': -30}, 'hand_L': {'rx': -10}, **hand(70)})
    BG = lambda: G(dz=-0.05, lean=6, lead=blockL, rear=blockR)  # noqa: E731
    add('block_start', 8, [(0, G()), (4, BG()), (8, BG())])
    add('block_hold', 24, [(0, BG()), (12, merge(BG(), {'spine': {'rx': 8}, 'hips': {'tz': -0.08}})), (24, BG())], loop=True)
    add('block_hit', 14, [(0, BG()), (3, merge(BG(), {'spine': {'rx': 2}, 'hips': {'tz': -0.03, 'ty': 0.05}, 'head': {'rx': -10}})), (14, BG())])
    parry_arm = {'upperarm_L': {'rx': -78, 'ry': -8}, 'forearm_L': {'rx': -66, 'rz': 40}, 'hand_L': {'rx': 8}, **hand(10)}
    add('parry', 16, [(0, G()), (3, G(yaw=18, lead=parry_arm)), (6, G(yaw=30, lead={**parry_arm, 'forearm_L': {'rx': -66, 'rz': -30}})), (16, G())],
        events={'window': [2, 8], 'cancel': 9})
    add('counter', 26, [
        (0, G(yaw=30, lead={**parry_arm, 'forearm_L': {'rx': -66, 'rz': -30}})),
        (5, G(yaw=-24, dz=-0.12, lean=10, rear=mirror({'upperarm_L': {'rx': -30, 'ry': 24}, 'forearm_L': {'rx': -126}}))),
        (8, G(yaw=44, dz=-0.10, dy=-0.12, lean=10, rear=cross_ext, lead={'thigh_L': {'rx': -42}, 'shin_L': {'rx': 50}})),
        (12, G(yaw=44, dz=-0.10, dy=-0.12, lean=10, rear=cross_ext, lead={'thigh_L': {'rx': -42}, 'shin_L': {'rx': 50}})),
        (26, G())],
        events={'hit': [8, 12], 'cancel': 18, 'striker': 'hand_R', 'damage': 4.0, 'stagger': 3.0, 'reach': 0.5, 'lunge': 0.8})

    def dodge(name, N, travel, lean, legs, extra=None):
        base = G(dz=-0.14, lean=lean, **(legs or {}))
        add(name, N, [(0, G()), (4, merge(base, extra or {})), (N // 2 + 2, merge(base, extra or {})), (N, G())],
            events={'iframes': [2, N - 7], 'travel': travel, 'cancel': N - 6})
    dodge('dodge_F', 22, [0, -1, 0], 22, {'rear': {'thigh_R': {'rx': -12}, 'shin_R': {'rx': 70}}, 'lead': {'thigh_L': {'rx': -52}, 'shin_L': {'rx': 66}}})
    dodge('dodge_B', 22, [0, 1, 0], -10, {'rear': {'thigh_R': {'rx': -12}, 'shin_R': {'rx': 70}}, 'lead': {'thigh_L': {'rx': -52}, 'shin_L': {'rx': 66}}}, {'hips': {'ty': 0.1}})
    dodge('dodge_L', 22, [1, 0, 0], 8, {'lead': {'thigh_L': {'rx': -30, 'ry': -42}, 'shin_L': {'rx': 52}}}, {'hips': {'tx': 0.10, 'ry': 12}})
    dodge('dodge_R', 22, [-1, 0, 0], 8, {'lead': {'thigh_L': {'rx': -40, 'ry': 14}, 'shin_L': {'rx': 60}}, 'rear': {'thigh_R': {'rx': 4, 'ry': 40}, 'shin_R': {'rx': 50}}}, {'hips': {'tx': -0.10, 'ry': -12}})

    hurt_l = {'hips': {'tz': -0.04, 'ty': 0.04}, 'spine': {'rx': 12, 'rz': 10}, 'chest': {'rx': 8}, 'head': {'rx': 14, 'rz': -10}, 'neck': {'rx': 8}}
    add('hit_light', 16, [(0, G()), (3, merge(G(), hurt_l, {'upperarm_L': {'rx': -10, 'ry': 34}, 'forearm_L': {'rx': -60}})), (16, G())])
    add('hit_heavy', 26, [
        (0, G()),
        (4, merge(G(), {'hips': {'tz': -0.10, 'ty': 0.12, 'rx': -10}, 'spine': {'rx': -14, 'rz': 14}, 'chest': {'rx': -10}, 'head': {'rx': 24},
                        'upperarm_L': {'rx': 20, 'ry': -40}, **mirror({'upperarm_L': {'rx': 20, 'ry': -40}}), 'forearm_L': {'rx': -30}, 'forearm_R': {'rx': -30}})),
        (26, G())])
    add('stagger', 54, [
        (0, G()),
        (6, merge(G(), {'hips': {'tz': -0.16, 'ty': 0.06}, 'spine': {'rx': 28, 'rz': 6}, 'chest': {'rx': 12}, 'head': {'rx': 18},
                        'thigh_L': {'rx': -40}, 'shin_L': {'rx': 68}, 'thigh_R': {'rx': -14}, 'shin_R': {'rx': 46},
                        'upperarm_L': {'rx': -5, 'ry': 26}, 'forearm_L': {'rx': -30}, **mirror({'upperarm_L': {'rx': -5, 'ry': 26}, 'forearm_L': {'rx': -30}})})),
        (30, merge(G(), {'hips': {'tz': -0.16, 'ty': 0.06}, 'spine': {'rx': 24, 'rz': -6}, 'chest': {'rx': 10}, 'head': {'rx': 22, 'rz': 8},
                         'thigh_L': {'rx': -40}, 'shin_L': {'rx': 68}, 'thigh_R': {'rx': -14}, 'shin_R': {'rx': 46}})),
        (54, G())], events={'cancel': 40})
    add('defeat', 60, [(0, G()), (10, merge(G(), {'hips': {'tz': -0.30}, 'spine': {'rx': 30}, 'head': {'rx': 24}, 'thigh_L': {'rx': -80}, 'shin_L': {'rx': 120},
                                                  'thigh_R': {'rx': -70}, 'shin_R': {'rx': 130}})),
                       (36, merge(relaxed(), {'hips': {'tz': -0.62, 'rx': 40}, 'spine': {'rx': 38}, 'chest': {'rx': 16}, 'head': {'rx': 30}, 'thigh_L': {'rx': -96}, 'shin_L': {'rx': 130},
                                              'thigh_R': {'rx': -96}, 'shin_R': {'rx': 130}, 'foot_L': {'ax': 20}, 'foot_R': {'ax': 20}})),
                       (60, merge(relaxed(), {'hips': {'tz': -0.62, 'rx': 40}, 'spine': {'rx': 44}, 'chest': {'rx': 20}, 'head': {'rx': 36}, 'thigh_L': {'rx': -96}, 'shin_L': {'rx': 130},
                                              'thigh_R': {'rx': -96}, 'shin_R': {'rx': 130}, 'foot_L': {'ax': 20}, 'foot_R': {'ax': 20}}))])

    # --- chronal abilities
    palm_out = {'upperarm_L': {'rx': -78, 'ry': -26}, 'forearm_L': {'rx': -22, 'ry': 8, 'rz': 0}, 'hand_L': {'rx': 0, 'ry': -14}, **hand(0)}
    pal = both(palm_out, mirror_L=True)
    add('time_slow', 30, [(0, G()), (6, merge(G(dz=-0.1, lean=-4), {'upperarm_L': {'rx': -30, 'ry': 40}, 'forearm_L': {'rx': -100}, **mirror({'upperarm_L': {'rx': -30, 'ry': 40}, 'forearm_L': {'rx': -100}})})),
                          (14, merge(G(dz=-0.05, lean=-6, yaw=-6), pal, {'head': {'rx': -8}})), (22, merge(G(dz=-0.05, lean=-6), pal)), (30, G())],
        events={'activate': 14, 'cancel': 20})
    rew_arm = {'upperarm_L': {'rx': -58, 'ry': -44}, 'forearm_L': {'rx': -40, 'rz': 30}, 'hand_L': {'rx': 0}, **hand(18)}
    add('rewind', 34, [(0, G()), (8, G(yaw=-40, lean=-6, dz=-0.08, lead=rew_arm, rear=mirror({'upperarm_L': {'rx': -40, 'ry': 40}, 'forearm_L': {'rx': -90}}))),
                       (18, G(yaw=-56, lean=-10, dz=-0.10, lead={**rew_arm, 'upperarm_L': {'rx': -62, 'ry': -60}, 'forearm_L': {'rx': -26, 'rz': 70}})),
                       (26, G(yaw=-56, lean=-10, dz=-0.10, lead={**rew_arm, 'upperarm_L': {'rx': -62, 'ry': -60}, 'forearm_L': {'rx': -26, 'rz': 70}})), (34, G())],
        events={'activate': 18, 'cancel': 26})
    cast = {'upperarm_L': {'rx': -92, 'ry': 2}, 'forearm_L': {'rx': -10}, 'hand_L': {'rx': 0}, **hand(0)}
    add('echo', 28, [(0, G()), (6, G(yaw=-20, dz=-0.1, lead={'upperarm_L': {'rx': -30, 'ry': 40}, 'forearm_L': {'rx': -120}})),
                     (12, G(yaw=24, dz=-0.1, dy=-0.04, lead=cast)), (20, G(yaw=24, dz=-0.1, dy=-0.04, lead=cast)), (28, G())],
        events={'activate': 12, 'cancel': 18})
    sweep = {'upperarm_L': {'rx': -40, 'ry': -86}, 'forearm_L': {'rx': -12}, 'hand_L': {'rx': 0}, **hand(0)}
    add('timeline_shift', 36, [(0, G()), (10, merge(G(dz=-0.12, lean=8), pal, {'head': {'rx': -10}})),
                               (20, merge(G(dz=0.02, lean=-8), both(sweep, mirror_L=True), {'head': {'rx': -14}})), (28, merge(G(dz=0.02, lean=-8), both(sweep, mirror_L=True))), (36, G())],
        events={'activate': 20, 'cancel': 28})
    add('temporal_counter', 24, [(0, G(yaw=30, lead={**parry_arm, 'forearm_L': {'rx': -66, 'rz': -30}})),
                                 (5, G(yaw=-30, dz=-0.16, lean=14, rear=mirror({'upperarm_L': {'rx': -40, 'ry': 26}, 'forearm_L': {'rx': -126}}))),
                                 (8, G(yaw=54, dz=-0.10, dy=-0.16, lean=14, rear=cross_ext, lead={'thigh_L': {'rx': -50}, 'shin_L': {'rx': 56}})),
                                 (12, G(yaw=54, dz=-0.10, dy=-0.16, lean=14, rear=cross_ext)), (24, G())],
        events={'hit': [7, 12], 'striker': 'hand_R', 'damage': 6.0, 'stagger': 4.0, 'reach': 0.6, 'lunge': 1.4, 'cancel': 16})

    # --- exploration / story
    add('talk', 90, [
        (0, relaxed()),
        (22, merge(relaxed(), {'upperarm_L': {'rx': -44, 'ry': 22}, 'forearm_L': {'rx': -70, 'rz': 10}, 'hand_L': {'rx': -8}, **hand(10), 'head': {'rx': -3, 'rz': 5}, 'spine': {'rx': 3}})),
        (45, merge(relaxed(), {'upperarm_L': {'rx': -30, 'ry': 24}, 'forearm_L': {'rx': -82, 'rz': -8}, 'hand_L': {'rx': -8}, 'head': {'rx': -1, 'rz': -4}})),
        (70, merge(relaxed(), {'upperarm_R': {'rx': -38, 'ry': -20}, 'forearm_R': {'rx': -76, 'rz': 10}, 'head': {'rx': -2, 'rz': 3}})),
        (90, relaxed())], loop=True)
    add('interact', 44, [
        (0, relaxed()),
        (12, merge(relaxed(dz=-0.04), {'spine': {'rx': 10}, 'head': {'rx': 8}, 'upperarm_L': {'rx': -66, 'ry': 8}, 'forearm_L': {'rx': -52}, 'hand_L': {'rx': 8}, **hand(24)})),
        (26, merge(relaxed(dz=-0.04), {'spine': {'rx': 12}, 'head': {'rx': 10}, 'upperarm_L': {'rx': -76, 'ry': 8}, 'forearm_L': {'rx': -46}, 'hand_L': {'rx': 8}, **hand(60)})),
        (44, relaxed())], events={'use': 24})
    add('look_around', 100, [(0, relaxed()), (30, merge(relaxed(), {'head': {'rz': 38, 'rx': -3}, 'neck': {'rz': 14}, 'spine': {'rz': 10}})),
                             (60, merge(relaxed(), {'head': {'rz': -34, 'rx': 2}, 'neck': {'rz': -12}, 'spine': {'rz': -9}})), (100, relaxed())], loop=True)
    add('shock', 40, [(0, relaxed()), (7, merge(relaxed(dz=-0.03), {'spine': {'rx': -8}, 'head': {'rx': -10}, 'hips': {'ty': 0.04},
                                                                  'upperarm_L': {'rx': -30, 'ry': -10}, 'forearm_L': {'rx': -80}, **mirror({'upperarm_L': {'rx': -30, 'ry': -10}, 'forearm_L': {'rx': -80}})})), (40, relaxed())])
    return clips


def all_clips():
    return loops() + shots()
