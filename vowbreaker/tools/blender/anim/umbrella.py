"""
Red Umbrella's motion: tall and wrong. It sways from the ankles like something hung, its long
clawed hands dangling in front; it does not walk so much as slide, knees locked; it rakes with one
long arm from high to low, spins like an opened umbrella with both arms out, and raises its arms to
call the rain down.
"""
import math

from anim._kit import glide, shift


def clips(A):
    o, sym = A.over, A.sym
    HANG = o(A.STAND, spine=(10, 0, 0), chest=(14, 0, 0), neck=(10, 0, 0), head=(14, 10, 10),
             **sym(upperarm_L=(-26, 28, 0), forearm_L=(-14, 0, 0), hand_L=(20, 0, 0)))
    RAKE_L = o(HANG, chest=(-10, 0, 20), head=(0, 0, 0), upperarm_R=(-170, -20, 20), forearm_R=(-20, 0, 0), hand_R=(-20, 0, 0))
    RAKE = o(HANG, chest=(24, 0, -20), spine=(16, 0, 0), upperarm_R=(-40, -20, -20), forearm_R=(-6, 0, 0), hand_R=(40, 0, 0))
    RAKE2_L = o(HANG, chest=(-10, 0, -20), upperarm_L=(-170, 20, -20), forearm_L=(-20, 0, 0), hand_L=(-20, 0, 0))
    RAKE2 = o(HANG, chest=(24, 0, 20), spine=(16, 0, 0), upperarm_L=(-40, 20, 20), forearm_L=(-6, 0, 0), hand_L=(40, 0, 0))
    OPEN = o(HANG, chest=(0, 0, 0), head=(0, 0, 0), **sym(upperarm_L=(-90, -50, 0), forearm_L=(-6, 0, 0), hand_L=(-20, 0, 0)))
    SPIN = o(OPEN, hips=(0, 0, -300), head=(0, 0, 0))
    CALL = o(HANG, spine=(-10, 0, 0), chest=(-20, 0, 0), head=(-30, 0, 0), **sym(upperarm_L=(-170, -10, 0), forearm_L=(-10, 0, 0)))
    C = {}

    def add(name, keys, loop=False):
        C[name] = (keys, loop, None)

    sw = [(0, HANG), (30, shift(A, HANG, hips=(0, 4, 0), spine=(0, 4, 0), head=(0, -8, 0))), (60, HANG),
          (90, shift(A, HANG, hips=(0, -4, 0), spine=(0, -4, 0), head=(0, 8, 0))), (120, HANG)]
    add('idle_fight', sw, True)
    add('idle_relaxed', sw, True)
    add('stand', sw, True)
    for name, n in (('walk_fwd', 44), ('walk_back', 48), ('strafe_L', 44), ('strafe_R', 44), ('walk', 50), ('run', 30)):
        add(name, glide(A, HANG, n, 6.0, 0.004, 4.0), True)
    add('light1', [(0, HANG), (5, RAKE_L), (8, RAKE), (13, RAKE), (22, HANG)])
    add('light2', [(0, HANG), (5, RAKE2_L), (8, RAKE2), (13, RAKE2), (22, HANG)])
    add('light3', [(0, HANG), (5, RAKE_L), (7, RAKE), (10, RAKE2_L), (13, RAKE2), (24, HANG)])
    add('heavy', [(0, HANG), (8, OPEN), (16, SPIN), (22, o(OPEN, hips=(0, 0, -360))), (34, o(HANG, hips=(0, 0, -360)))])
    add('heavy2', [(0, HANG), (8, OPEN), (16, SPIN), (22, o(OPEN, hips=(0, 0, -360))), (34, o(HANG, hips=(0, 0, -360)))])
    add('cast_raise', [(0, HANG), (12, CALL), (30, CALL), (40, HANG)])
    add('cast_throw', [(0, HANG), (6, RAKE_L), (9, RAKE), (14, RAKE), (24, HANG)])
    add('cast_palm', [(0, HANG), (8, OPEN), (20, OPEN), (30, HANG)])
    add('cast_slam', [(0, HANG), (10, CALL), (16, RAKE), (28, RAKE), (38, HANG)])
    return C
