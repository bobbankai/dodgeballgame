"""
Vowbreaker's animation library, authored on the reference rig (Itsuki) and shared by every character.

  blender -b assets-raw/vowbreaker/itsuki.blend -P vowbreaker/tools/blender/anims.py -- [--export] [--sheet out.png] [--only a,b]
  blender -b assets-raw/vowbreaker/<name>.blend -P vowbreaker/tools/blender/anims.py -- --char <name> [--export] [--sheet out.png]

With --char, the character's own clips (anim/<name>.py: their stance, strings, techniques, walk and
acting) are keyed on their own rig and exported to anims/<name>.glb; the game lays them over the
shared library by name.

Poses are dictionaries of bone rotations in degrees about the ARMATURE axes, applied to each bone
relative to its parent as if at rest (vbanim.Keyer):
  rx +  bends an upward bone forward / swings a downward bone back (arms forward = rx -)
  ry +  leans an upward bone to the character's left; lowers the LEFT arm toward the body
  rz +  turns toward the character's left (yaw); swings the LEFT arm back
  'hips_t' is the hips' offset in metres (x left, y back, z up).
A clip is a list of (frame, pose) keys at 30 fps; between keys a shape-preserving cubic holds
extremes (no overshoot). Right-side channels mirror the left where a pose is built with mirror helpers.
The game plays these on 2s/3s (stepped) for the limited-animation look, so strong key poses matter
more than in-betweens: anticipation, a sharp contact pose, a held recovery.
"""
import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import vbanim  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'anims')

BODY = ['root', 'hips', 'spine', 'chest', 'neck', 'head'] + [f'{b}_{s}' for s in 'LR' for b in
                                                             ('shoulder', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe')]


def mirror_name(b):
    if b.endswith('_L'):
        return b[:-2] + '_R'
    if b.endswith('_R'):
        return b[:-2] + '_L'
    return b


def mirror_pose(p):
    """Mirror a whole pose left <-> right (for strafes, the other-hand versions of moves)."""
    out = {}
    for b, v in p.items():
        if b == 'hips_t':
            out[b] = (-v[0], v[1], v[2])
        else:
            out[mirror_name(b)] = (v[0], -v[1], -v[2])
    return out


def over(base, **kw):
    """A pose: `base` with some bones replaced (values are (rx, ry, rz) or hips_t (x, y, z))."""
    p = dict(base)
    p.update(kw)
    return p


def sym(**kw):
    """Pose helper: bone_L=(..) also writes the mirrored bone_R."""
    p = {}
    for b, v in kw.items():
        p[b] = v
        if b.endswith('_L'):
            p[b[:-2] + '_R'] = (v[0], -v[1], -v[2])
    return p


def blend(a, b, t):
    keys = set(a) | set(b)
    out = {}
    for k in keys:
        va = a.get(k, (0, 0, 0))
        vb = b.get(k, (0, 0, 0))
        out[k] = tuple(x + (y - x) * t for x, y in zip(va, vb))
    return out


# =============================================================================== poses

REST = {}

# relaxed standing (cutscenes): arms down at the sides, weight a little on one leg
STAND = sym(upperarm_L=(4, 36, 2), forearm_L=(-12, 0, 0), hand_L=(-4, 0, 0), thigh_L=(0, 0, 0), shin_L=(2, 0, 0))
STAND.update({'hips': (0, -2, 0), 'hips_t': (0.0, 0.0, -0.005), 'spine': (2, 0, 0), 'chest': (1, 0, 0), 'neck': (-2, 0, 0), 'head': (1, 0, 0),
              'thigh_R': (-3, 3, -4), 'shin_R': (6, 0, 0), 'foot_R': (-3, 0, 0)})

# fighting stance: left side leading, fists up, knees bent
STANCE = {
    'hips': (0, 0, -26), 'hips_t': (0.0, 0.02, -0.07),
    'spine': (6, 0, 6), 'chest': (8, 0, 12), 'neck': (-6, 0, 4), 'head': (-6, 0, 4),
    'thigh_L': (-26, -4, 12), 'shin_L': (30, 0, 0), 'foot_L': (-4, 0, -10),
    'thigh_R': (16, 8, 14), 'shin_R': (26, 0, 0), 'foot_R': (-20, 0, 0),
    'shoulder_L': (0, 0, -4), 'upperarm_L': (-58, 30, -14), 'forearm_L': (-104, 0, 0), 'hand_L': (-14, 0, 0),
    'shoulder_R': (0, 0, 4), 'upperarm_R': (-42, -38, 22), 'forearm_R': (-122, 0, 0), 'hand_R': (-10, 0, 0),
}
STANCE_B = over(STANCE, hips_t=(0.0, 0.02, -0.08), chest=(10, 0, 12), upperarm_L=(-60, 30, -14), upperarm_R=(-44, -38, 22))

GUARD = over(STANCE, chest=(14, 0, 6), head=(4, 0, 2), hips_t=(0, 0.04, -0.09),
             upperarm_L=(-80, 20, -24), forearm_L=(-120, 0, 0), hand_L=(-20, 0, 0),
             upperarm_R=(-74, -22, 30), forearm_R=(-126, 0, 0), hand_R=(-20, 0, 0))


# --- strikes ---------------------------------------------------------------------------------
JAB_LOAD = over(STANCE, chest=(8, 0, 18), upperarm_L=(-55, 30, -6), forearm_L=(-115, 0, 0))
JAB = over(STANCE, hips=(0, 0, -34), chest=(10, 0, -4), head=(-4, 0, 10), hips_t=(0, -0.01, -0.07),
           shoulder_L=(0, 0, -14), upperarm_L=(-88, 6, -28), forearm_L=(-6, 0, 0), hand_L=(0, 0, 0))
CROSS_LOAD = over(STANCE, hips=(0, 0, -34), chest=(8, 0, 22), upperarm_R=(-38, -36, 34), forearm_R=(-125, 0, 0))
CROSS = over(STANCE, hips=(0, 0, 8), hips_t=(0, -0.05, -0.08), chest=(14, 0, -26), head=(-4, 0, -6), neck=(-6, 0, -8),
             thigh_R=(10, 6, 0), shin_R=(14, 0, 0), foot_R=(-34, 0, 0),
             shoulder_R=(0, 0, 18), upperarm_R=(-88, -8, 36), forearm_R=(-4, 0, 0), hand_R=(0, 0, 0),
             upperarm_L=(-50, 30, 6), forearm_L=(-118, 0, 0))
HOOK_LOAD = over(STANCE, hips=(0, 0, -6), chest=(10, 0, 30), upperarm_L=(-60, -10, 20), forearm_L=(-95, 0, 0))
HOOK = over(STANCE, hips=(0, 0, -50), hips_t=(0, -0.02, -0.09), chest=(14, 0, -36), head=(-2, 0, 18),
            upperarm_L=(-86, -42, -62), forearm_L=(-96, 0, 0), hand_L=(-6, 0, 0), shoulder_L=(0, 0, -18),
            upperarm_R=(-46, -40, 24), forearm_R=(-124, 0, 0))
KICK_LOAD = over(STANCE, hips=(0, 6, -10), hips_t=(0, 0.0, -0.05), chest=(4, 6, 20),
                 thigh_R=(-60, 4, 30), shin_R=(110, 0, 0), foot_R=(30, 0, 0), thigh_L=(-6, -6, 6), shin_L=(14, 0, 0))
KICK = over(STANCE, hips=(0, 24, 30), hips_t=(0, 0.0, -0.03), spine=(0, 22, 0), chest=(-6, 16, -10), head=(0, -20, -14),
            thigh_R=(-82, -64, 30), shin_R=(6, 0, 0), foot_R=(36, 0, 0), thigh_L=(-2, -10, 0), shin_L=(10, 0, 0), foot_L=(-8, 0, 0),
            upperarm_L=(-40, 46, -10), forearm_L=(-90, 0, 0), upperarm_R=(-20, -10, 40), forearm_R=(-60, 0, 0))
UPPER_LOAD = over(STANCE, hips_t=(0, 0.04, -0.2), spine=(16, 0, 10), chest=(16, 0, 24), head=(-8, 0, 0),
                  thigh_L=(-50, -4, 12), shin_L=(72, 0, 0), thigh_R=(30, 8, 14), shin_R=(56, 0, 0),
                  upperarm_R=(-20, -30, 30), forearm_R=(-120, 0, 0), hand_R=(-20, 0, 0))
UPPER = over(STANCE, hips=(0, 0, 10), hips_t=(0, -0.03, 0.04), spine=(-10, 0, -6), chest=(-16, 0, -22), head=(-18, 0, -6),
             thigh_L=(-14, -4, 12), shin_L=(8, 0, 0), foot_L=(10, 0, 0), thigh_R=(6, 8, 0), shin_R=(6, 0, 0), foot_R=(30, 0, 0),
             shoulder_R=(0, 0, 10), upperarm_R=(-160, -10, 10), forearm_R=(-60, 0, 0), hand_R=(-10, 0, 0),
             upperarm_L=(-30, 40, -10), forearm_L=(-90, 0, 0))
SPIN_LOAD = over(STANCE, hips=(0, 0, -90), chest=(6, 0, -40), head=(-6, 0, 70), hips_t=(0, 0.02, -0.1))
SPIN_KICK = over(STANCE, hips=(0, -20, -200), hips_t=(0, 0.0, -0.02), spine=(-4, -20, -20), chest=(-6, -12, -20), head=(0, 10, 230),
                 thigh_R=(-70, 70, -20), shin_R=(4, 0, 0), foot_R=(40, 0, 0), thigh_L=(-4, 10, 0), shin_L=(10, 0, 0),
                 upperarm_L=(-10, 10, 40), forearm_L=(-60, 0, 0), upperarm_R=(-40, -50, 0), forearm_R=(-90, 0, 0))
LUNGE = over(CROSS, hips_t=(0, -0.1, -0.15), thigh_L=(-60, -4, 12), shin_L=(60, 0, 0), thigh_R=(40, 8, 10), shin_R=(20, 0, 0), spine=(20, 0, 0))

AIR = over(STANCE, hips_t=(0, 0, 0), thigh_L=(-60, -4, 6), shin_L=(90, 0, 0), thigh_R=(-30, 6, 6), shin_R=(100, 0, 0),
           foot_L=(20, 0, 0), foot_R=(20, 0, 0))
AIR_PUNCH = over(AIR, chest=(16, 0, -20), upperarm_R=(-80, -10, 30), forearm_R=(-6, 0, 0), hand_R=(0, 0, 0))
AXE_LOAD = over(AIR, chest=(-20, 0, 0), thigh_R=(-150, 0, 0), shin_R=(10, 0, 0), foot_R=(30, 0, 0), upperarm_L=(-100, 20, 0), upperarm_R=(-100, -20, 0))
AXE = over(AIR, chest=(30, 0, 0), spine=(14, 0, 0), thigh_R=(-30, 0, 0), shin_R=(4, 0, 0), foot_R=(20, 0, 0),
           upperarm_L=(10, 50, 0), upperarm_R=(10, -50, 0), forearm_L=(-30, 0, 0), forearm_R=(-30, 0, 0))

# --- techniques -----------------------------------------------------------------------------------
PALM_LOAD = over(STANCE, hips=(0, 0, -10), chest=(4, 0, 30), hips_t=(0, 0.06, -0.12),
                 upperarm_R=(-20, -44, 40), forearm_R=(-130, 0, 0), hand_R=(30, 0, 0),
                 upperarm_L=(-70, 20, -30), forearm_L=(-40, 0, 0), hand_L=(-60, 0, 0))
PALM = over(STANCE, hips=(0, 0, 14), chest=(10, 0, -24), hips_t=(0, -0.08, -0.12), thigh_L=(-44, -4, 12), shin_L=(46, 0, 0),
            thigh_R=(30, 8, 10), shin_R=(10, 0, 0), foot_R=(-30, 0, 0),
            shoulder_R=(0, 0, 20), upperarm_R=(-90, -4, 40), forearm_R=(-2, 0, 0), hand_R=(-70, 0, 0),
            upperarm_L=(-40, 40, -10), forearm_L=(-60, 0, 0))
RAISE_LOAD = over(STAND, hips_t=(0, 0.02, -0.12), chest=(20, 0, 0), head=(20, 0, 0),
                  **sym(upperarm_L=(-20, 30, 20), forearm_L=(-110, 0, 0), hand_L=(-30, 0, 0), thigh_L=(-14, -6, 4), shin_L=(28, 0, 0)))
RAISE = over(STAND, hips_t=(0, 0.0, 0.0), chest=(-16, 0, 0), head=(-24, 0, 0), spine=(-6, 0, 0),
             **sym(upperarm_L=(-150, -20, -10), forearm_L=(-14, 0, 0), hand_L=(-20, 0, 0), thigh_L=(-4, -8, 4), shin_L=(4, 0, 0)))
SLAM_LOAD = over(RAISE, hips_t=(0, 0.0, 0.05), **sym(upperarm_L=(-170, 10, 0), forearm_L=(-50, 0, 0)))
SLAM = over(STAND, hips_t=(0, -0.06, -0.42), spine=(40, 0, 0), chest=(30, 0, 0), head=(-10, 0, 0),
            **sym(thigh_L=(-80, -10, 6), shin_L=(110, 0, 0), foot_L=(-20, 0, 0), upperarm_L=(-50, 30, 0), forearm_L=(-20, 0, 0), hand_L=(-40, 0, 0)))
THROW_LOAD = over(STANCE, hips=(0, 0, -50), chest=(-4, 0, 30), upperarm_R=(-130, -30, 60), forearm_R=(-90, 0, 0))
THROW = over(STANCE, hips=(0, 0, 6), chest=(20, 0, -30), hips_t=(0, -0.06, -0.09), upperarm_R=(-96, -4, 20), forearm_R=(-4, 0, 0), hand_R=(-20, 0, 0))
SIGN = over(STAND, hips_t=(0, 0, -0.03), chest=(4, 0, 0), head=(4, 0, 0),
            **sym(upperarm_L=(-60, 46, -50), forearm_L=(-116, 0, 30), hand_L=(-10, 0, -40)))
SIGN_B = over(SIGN, head=(-14, 0, 0), chest=(-6, 0, 0))

# --- reactions --------------------------------------------------------------------------------------
HIT_HIGH = over(STANCE, hips_t=(0, 0.06, -0.08), spine=(-10, 0, 0), chest=(-16, 0, 4), neck=(-14, 0, 0), head=(-18, 0, 10),
                upperarm_L=(-40, 40, 10), forearm_L=(-80, 0, 0), upperarm_R=(-30, -40, 20), forearm_R=(-90, 0, 0))
HIT_BODY = over(STANCE, hips_t=(0, 0.08, -0.12), spine=(24, 0, 0), chest=(20, 0, 0), head=(10, 0, 0),
                upperarm_L=(-20, 30, 10), forearm_L=(-100, 0, 0), upperarm_R=(-10, -30, 0), forearm_R=(-110, 0, 0))
STAGGER = over(STANCE, hips=(0, 0, -10), hips_t=(0, 0.16, -0.14), spine=(-18, 8, 0), chest=(-20, 10, 0), head=(-20, -10, 0),
               thigh_L=(-36, -4, 6), shin_L=(20, 0, 0), thigh_R=(30, 8, 8), shin_R=(40, 0, 0),
               upperarm_L=(-10, -10, 30), forearm_L=(-40, 0, 0), upperarm_R=(-6, 6, -30), forearm_R=(-30, 0, 0))
LAUNCH = over(STAND, hips=(-30, 0, 0), spine=(-16, 0, 0), chest=(-14, 0, 0), head=(-20, 0, 0),
              **sym(upperarm_L=(-60, -20, 30), forearm_L=(-40, 0, 0), thigh_L=(-40, -6, 0), shin_L=(60, 0, 0)))
TUMBLE = over(LAUNCH, hips=(-120, 0, 0), spine=(-10, 0, 0))
DOWN = over(STAND, hips=(-88, 0, 0), hips_t=(0, 0.25, -0.82), spine=(-2, 0, 0), chest=(0, 0, 0), head=(-6, 0, 20),
            **sym(upperarm_L=(10, -20, 30), forearm_L=(-20, 0, 0), thigh_L=(-6, -6, 0), shin_L=(10, 0, 0), foot_L=(20, 0, 0)))
FALLING = over(STAND, hips=(-40, 0, 0), hips_t=(0, 0.2, -0.4), spine=(-10, 0, 0), head=(20, 0, 0),
               **sym(upperarm_L=(-70, -10, 20), forearm_L=(-30, 0, 0), thigh_L=(-50, -6, 0), shin_L=(60, 0, 0)))
GETUP_KNEEL = over(STAND, hips_t=(0, 0.05, -0.5), spine=(30, 0, 0), chest=(20, 0, 0), head=(-10, 0, 0),
                   thigh_L=(-90, -6, 6), shin_L=(90, 0, 0), foot_L=(-10, 0, 0), thigh_R=(10, 6, 0), shin_R=(120, 0, 0), foot_R=(40, 0, 0),
                   upperarm_L=(-30, 40, 0), forearm_L=(-40, 0, 0), upperarm_R=(-10, -30, 0), forearm_R=(-10, 0, 0), hand_R=(60, 0, 0))
KNEEL = over(STAND, hips_t=(0, 0.06, -0.48), spine=(24, 0, 0), chest=(18, 0, 0), neck=(16, 0, 0), head=(24, 0, 0),
             thigh_L=(-92, -6, 6), shin_L=(92, 0, 0), foot_L=(-6, 0, 0), thigh_R=(2, 6, 0), shin_R=(128, 0, 0), foot_R=(50, 0, 0),
             **{k: v for k, v in sym(upperarm_L=(-14, 30, 0), forearm_L=(-30, 0, 0), hand_L=(-10, 0, 0)).items()})
DEFEAT = over(KNEEL, spine=(40, 0, 0), chest=(30, 0, 0), head=(30, 0, 0),
              **sym(upperarm_L=(-50, 36, 0), forearm_L=(-10, 0, 0), hand_L=(60, 0, 0)))

# --- cutscene acting ----------------------------------------------------------------------------------
TALK_A = over(STAND, chest=(0, 0, 4), head=(2, 3, 6), upperarm_R=(-26, -30, 16), forearm_R=(-70, 0, -20), hand_R=(-10, 0, 0))
TALK_B = over(STAND, chest=(2, 0, -3), head=(-2, -2, -4), upperarm_L=(-30, 26, -20), forearm_L=(-64, 0, 20), hand_L=(-14, 0, 0))
ARMS_X = over(STAND, chest=(-2, 0, 0), head=(-3, 0, 0),
              **sym(upperarm_L=(-26, 40, -34), forearm_L=(-112, 0, -24), hand_L=(-10, 0, 0)))
GRIEF = over(KNEEL, spine=(30, 0, 0), chest=(20, 0, 0), neck=(20, 0, 0), head=(30, 0, 0),
             **sym(upperarm_L=(-60, 30, -30), forearm_L=(-120, 0, -10), hand_L=(-30, 0, 0)))
CRY = over(STAND, spine=(14, 0, 0), chest=(10, 0, 0), neck=(12, 0, 0), head=(20, 0, 0),
           **sym(upperarm_L=(-60, 30, -30), forearm_L=(-128, 0, -14), hand_L=(-30, 0, 0)))
LOOK_DOWN = over(STAND, neck=(14, 0, 0), head=(22, 0, 0), chest=(6, 0, 0))
POINT = over(STAND, chest=(0, 0, -10), head=(0, 0, -6), upperarm_R=(-86, -10, 24), forearm_R=(-6, 0, 0), hand_R=(0, 0, 0))
REACH = over(STAND, spine=(10, 0, 0), chest=(10, 0, 0), head=(-8, 0, 0), upperarm_R=(-78, -16, 14), forearm_R=(-14, 0, 0), hand_R=(-10, 0, 0))
EMBRACE = over(STAND, spine=(8, 0, 0), chest=(6, 0, 0), head=(10, 0, 0),
               **sym(upperarm_L=(-70, 10, -40), forearm_L=(-70, 0, -30), hand_L=(-20, 0, 0)))
HURT = over(STAND, spine=(16, 6, 0), chest=(12, 6, 0), head=(10, 0, 0), upperarm_L=(-26, 30, -40), forearm_L=(-100, 0, -20),
            upperarm_R=(-10, -40, 0), forearm_R=(-30, 0, 0), thigh_R=(-10, 4, -4), shin_R=(16, 0, 0))
HOVER = over(STAND, hips_t=(0, 0, 0.0), spine=(6, 0, 0), head=(14, 0, 0),
             **sym(upperarm_L=(-10, 10, 0), forearm_L=(-30, 0, 0), hand_L=(20, 0, 0), thigh_L=(-14, -4, 0), shin_L=(40, 0, 0), foot_L=(40, 0, 0)))
CRAWL_A = over(STAND, hips=(60, 0, 0), hips_t=(0, -0.1, -0.55), spine=(14, 0, 0), chest=(4, 0, 0), head=(-60, 0, 0),
               upperarm_L=(-60, 30, 10), forearm_L=(-20, 0, 0), upperarm_R=(-20, -30, -10), forearm_R=(-10, 0, 0),
               thigh_L=(-80, -10, 0), shin_L=(110, 0, 0), thigh_R=(-40, 10, 0), shin_R=(110, 0, 0))
CRAWL_B = mirror_pose(CRAWL_A)
VICTORY = over(STAND, chest=(-6, 0, -10), head=(-8, 0, -10), hips_t=(0, 0, 0.0),
               upperarm_R=(-170, -20, 0), forearm_R=(-30, 0, 0), hand_R=(0, 0, 0), upperarm_L=(-10, 40, 20), forearm_L=(-60, 0, 0))
CHARGE = over(STANCE, hips_t=(0, 0.04, -0.16), spine=(10, 0, 0), chest=(16, 0, 0), head=(6, 0, 0),
              **sym(upperarm_L=(-30, 40, 20), forearm_L=(-100, 0, 0), hand_L=(-30, 0, 0), thigh_L=(-40, -10, 10), shin_L=(50, 0, 0)))
CHARGE_B = over(CHARGE, chest=(-10, 0, 0), head=(-20, 0, 0), **sym(upperarm_L=(-20, -10, 40), forearm_L=(-30, 0, 0), hand_L=(-40, 0, 0)))


# =============================================================================== walk cycles

def walk(stride=26, bob=0.025, arm=22, lean=4, base=None, crouch=0.0, n=32):
    """Two-step cycle: contact, down, passing, up for each leg."""
    b = dict(base or STAND)
    keys = []
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        s = math.sin(ph * 2 * math.pi)
        c = math.cos(ph * 2 * math.pi)
        p = over(b,
                 hips=(0, 0, 4 * s), hips_t=(0, 0, -crouch - bob * (1 - abs(c))),
                 spine=(lean, 0, -3 * s), chest=(2, 0, -6 * s),
                 thigh_L=(-stride * c, -2, 0), shin_L=(10 + 26 * max(0.0, s), 0, 0), foot_L=(6 * c, 0, 0),
                 thigh_R=(stride * c, 2, 0), shin_R=(10 + 26 * max(0.0, -s), 0, 0), foot_R=(-6 * c, 0, 0),
                 upperarm_L=(arm * c, 34, 2), forearm_L=(-20 - 10 * max(0.0, -c), 0, 0),
                 upperarm_R=(-arm * c, -34, -2), forearm_R=(-20 - 10 * max(0.0, c), 0, 0))
        keys.append((f, p))
    return keys


def run_cycle(n=20):
    keys = []
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        s = math.sin(ph * 2 * math.pi)
        c = math.cos(ph * 2 * math.pi)
        p = over(STAND, hips=(0, 0, 6 * s), hips_t=(0, -0.02, -0.06 + 0.05 * abs(s)), spine=(14, 0, -5 * s), chest=(6, 0, -10 * s), head=(-10, 0, 6 * s),
                 thigh_L=(-44 * c, -2, 0), shin_L=(30 + 70 * max(0.0, s), 0, 0), foot_L=(10 * c, 0, 0),
                 thigh_R=(44 * c, 2, 0), shin_R=(30 + 70 * max(0.0, -s), 0, 0), foot_R=(-10 * c, 0, 0),
                 upperarm_L=(50 * c, 30, 0), forearm_L=(-90, 0, 0), upperarm_R=(-50 * c, -30, 0), forearm_R=(-90, 0, 0))
        keys.append((f, p))
    return keys


def stance_walk(direction, n=28):
    """Shuffling footwork in the fighting stance: forward / back / left / right."""
    keys = []
    for f, ph in ((0, 0.0), (n // 4, 0.25), (n // 2, 0.5), (3 * n // 4, 0.75), (n, 1.0)):
        s = math.sin(ph * 2 * math.pi)
        c = math.cos(ph * 2 * math.pi)
        p = dict(STANCE)
        if direction in ('fwd', 'back'):
            k = 1 if direction == 'fwd' else -1
            p.update(thigh_L=(-26 - 14 * k * c, -4, 12), shin_L=(30 + 16 * max(0.0, s), 0, 0),
                     thigh_R=(16 + 12 * k * c, 8, 14), shin_R=(26 + 16 * max(0.0, -s), 0, 0),
                     hips_t=(0, 0.02, -0.07 - 0.015 * abs(s)))
        else:
            k = 1 if direction == 'left' else -1
            p.update(thigh_L=(-26, -4 - 14 * k * c, 12), shin_L=(30 + 14 * max(0.0, s), 0, 0),
                     thigh_R=(16, 8 - 14 * k * c, 14), shin_R=(26 + 14 * max(0.0, -s), 0, 0),
                     hips=(0, 4 * k * s, -26), hips_t=(0, 0.02, -0.07 - 0.015 * abs(s)))
        keys.append((f, p))
    return keys


def breathe(base, n=60, amount=1.0, sway=0.0):
    keys = []
    for f in (0, n // 2, n):
        t = 0 if f in (0, n) else 1
        p = over(base, chest=tuple(a + b for a, b in zip(base.get('chest', (0, 0, 0)), (-2.0 * amount * t, sway * t, 0))),
                 hips_t=tuple(a + b for a, b in zip(base.get('hips_t', (0, 0, 0)), (0, 0, -0.01 * amount * t))),
                 head=tuple(a + b for a, b in zip(base.get('head', (0, 0, 0)), (1.5 * amount * t, 0, 0))))
        keys.append((f, p))
    return keys


# =============================================================================== the clip table

def clips():
    C = {}

    def add(name, keys, loop=False, root=None):
        C[name] = (keys, loop, root)

    add('idle_fight', breathe(STANCE, 48, 1.4), True)
    add('idle_relaxed', breathe(STAND, 90, 1.0, 0.6), True)
    add('walk_fwd', stance_walk('fwd', 28), True)
    add('walk_back', stance_walk('back', 32), True)
    add('strafe_L', stance_walk('left', 28), True)
    add('strafe_R', stance_walk('right', 28), True)
    add('walk', walk(), True)
    add('walk_sad', walk(stride=18, bob=0.012, arm=8, lean=10, n=44), True)
    add('run', run_cycle(), True)
    add('dash_fwd', [(0, STANCE), (3, over(LUNGE, hips_t=(0, -0.05, -0.16), upperarm_L=(-60, 30, -14), forearm_L=(-104, 0, 0))), (9, over(STANCE, hips_t=(0, 0, -0.12))), (12, STANCE)])
    add('dash_back', [(0, STANCE), (3, over(STANCE, hips_t=(0, 0.1, -0.04), spine=(-10, 0, 6), thigh_L=(-10, -4, 12), thigh_R=(30, 8, 14))), (9, over(STANCE, hips_t=(0, 0.02, -0.11))), (12, STANCE)])
    add('jump', [(0, STANCE), (3, over(STANCE, hips_t=(0, 0.02, -0.18), thigh_L=(-40, -4, 12), shin_L=(60, 0, 0), thigh_R=(30, 8, 14), shin_R=(56, 0, 0))), (6, over(AIR, hips_t=(0, 0, 0.04), thigh_L=(-20, -4, 6), shin_L=(30, 0, 0))), (10, AIR)])
    add('fall', [(0, AIR), (10, over(AIR, thigh_L=(-50, -4, 6), shin_L=(70, 0, 0))), (20, AIR)], True)
    add('land', [(0, AIR), (2, over(STANCE, hips_t=(0, 0.03, -0.22), thigh_L=(-50, -4, 12), shin_L=(70, 0, 0), thigh_R=(36, 8, 14), shin_R=(66, 0, 0))), (8, STANCE)])
    add('guard', [(0, GUARD), (10, over(GUARD, hips_t=(0, 0.04, -0.1))), (20, GUARD)], True)
    add('guard_hit', [(0, GUARD), (2, over(GUARD, hips_t=(0, 0.12, -0.1), chest=(-4, 0, 6), head=(-10, 0, 2))), (10, GUARD)])
    # string: jab, cross, hook, roundhouse
    add('light1', [(0, STANCE), (2, JAB_LOAD), (4, JAB), (7, JAB), (14, STANCE)])
    add('light2', [(0, STANCE), (3, CROSS_LOAD), (5, CROSS), (9, CROSS), (16, STANCE)])
    add('light3', [(0, STANCE), (4, HOOK_LOAD), (7, HOOK), (11, HOOK), (18, STANCE)])
    add('light4', [(0, STANCE), (5, KICK_LOAD), (9, KICK), (14, KICK), (24, STANCE)])
    add('heavy', [(0, STANCE), (7, UPPER_LOAD), (10, UPPER), (16, UPPER), (26, STANCE)])
    add('heavy2', [(0, STANCE), (7, SPIN_LOAD), (12, SPIN_KICK), (18, SPIN_KICK), (30, STANCE)])
    add('dash_attack', [(0, STANCE), (4, CROSS_LOAD), (7, LUNGE), (13, LUNGE), (20, STANCE)])
    add('air_light', [(0, AIR), (3, over(AIR, upperarm_R=(-60, -30, 40), forearm_R=(-120, 0, 0))), (5, AIR_PUNCH), (9, AIR_PUNCH), (14, AIR)])
    add('air_heavy', [(0, AIR), (6, AXE_LOAD), (10, AXE), (16, AXE), (22, AIR)])
    add('throw', [(0, STANCE), (5, over(REACH, hips_t=(0, -0.08, -0.1))), (12, over(CROSS_LOAD, chest=(-10, 0, 50))), (18, over(THROW, upperarm_R=(-60, -20, 60))), (30, STANCE)])
    # techniques
    add('cast_palm', [(0, STANCE), (8, PALM_LOAD), (12, PALM), (20, PALM), (30, STANCE)])
    add('cast_raise', [(0, STANCE), (10, RAISE_LOAD), (16, RAISE), (28, RAISE), (36, STANCE)])
    add('cast_slam', [(0, STANCE), (8, RAISE), (14, SLAM_LOAD), (18, SLAM), (26, SLAM), (34, STANCE)])
    add('cast_throw', [(0, STANCE), (7, THROW_LOAD), (11, THROW), (16, THROW), (24, STANCE)])
    add('domain', [(0, STANCE), (10, SIGN), (40, SIGN_B), (60, SIGN_B)])
    add('charge', [(0, CHARGE), (12, CHARGE_B), (24, CHARGE)], True)
    # reactions
    add('hit_high', [(0, STANCE), (2, HIT_HIGH), (6, HIT_HIGH), (14, STANCE)])
    add('hit_body', [(0, STANCE), (2, HIT_BODY), (6, HIT_BODY), (14, STANCE)])
    add('stagger', [(0, STANCE), (3, STAGGER), (16, over(STAGGER, hips_t=(0, 0.12, -0.12))), (24, STANCE)])
    add('launched', [(0, LAUNCH), (10, TUMBLE), (20, LAUNCH)], True)
    add('knockdown', [(0, STAGGER), (6, FALLING), (14, DOWN), (18, over(DOWN, hips_t=(0, 0.25, -0.78))), (30, DOWN)])
    add('down', [(0, DOWN), (20, over(DOWN, chest=(2, 0, 0))), (40, DOWN)], True)
    add('getup', [(0, DOWN), (10, over(DOWN, hips=(-50, 0, 0), hips_t=(0, 0.1, -0.7))), (18, GETUP_KNEEL), (30, STANCE)])
    add('stun', [(0, STAGGER), (20, over(STAGGER, head=(-20, 10, 10), chest=(-20, -6, 0))), (40, STAGGER)], True)
    add('defeat', [(0, STANCE), (8, HURT), (24, KNEEL), (50, DEFEAT)])
    add('victory', [(0, STANCE), (12, over(STAND, chest=(10, 0, 0))), (24, VICTORY), (60, VICTORY)])
    # acting
    add('talk', [(0, STAND), (15, TALK_A), (35, TALK_A), (50, TALK_B), (70, TALK_B), (90, STAND)], True)
    add('arms_crossed', breathe(ARMS_X, 90, 0.8), True)
    add('kneel_grief', [(0, GRIEF), (30, over(GRIEF, chest=(26, 0, 0), head=(36, 0, 0))), (60, GRIEF)], True)
    add('kneel', breathe(KNEEL, 80, 0.8), True)
    add('cry', [(0, CRY), (15, over(CRY, chest=(14, 0, 0), spine=(18, 0, 0))), (30, CRY)], True)
    add('look_down', breathe(LOOK_DOWN, 90, 0.8), True)
    add('point', [(0, STAND), (10, POINT), (40, POINT)])
    add('reach', [(0, STAND), (20, REACH), (60, over(REACH, upperarm_R=(-74, -16, 14)))])
    add('embrace', breathe(EMBRACE, 70, 1.2), True)
    add('hurt', breathe(HURT, 50, 1.8), True)
    add('hover', [(0, HOVER), (30, over(HOVER, hips_t=(0, 0, 0.06), head=(10, 0, 0))), (60, HOVER)], True)
    add('crawl', [(0, CRAWL_A), (12, CRAWL_B), (24, CRAWL_A)], True)
    add('stand', breathe(STAND, 90, 0.6), True)
    return C


# =============================================================================== authoring

ARM_BONES = [f'{b}_{s}' for b in ('upperarm', 'forearm', 'hand') for s in 'LR']
HINGE = {}


def setup_hinges(arm):
    """Arms rest in an A-pose, so armature X is not their elbow hinge. For arm bones the first value
    of a pose is a rotation about the bone's own hinge axis (perpendicular to the bone and to the
    forward direction; positive swings it back, negative forward, like X for a hanging bone);
    the other two stay about armature Y and Z. Converted here to armature-space XYZ eulers."""
    from mathutils import Vector
    for b in ARM_BONES:
        if b in arm.data.bones:
            bone = arm.data.bones[b]
            d = (bone.tail_local - bone.head_local).normalized()
            h = d.cross(Vector((0, -1, 0))).normalized()
            HINGE[b] = -h


def arm_euler(b, v):
    from mathutils import Matrix
    R = Matrix.Rotation(math.radians(v[2]), 3, 'Z') @ Matrix.Rotation(math.radians(v[1]), 3, 'Y') @ Matrix.Rotation(math.radians(v[0]), 3, HINGE[b])
    e = R.to_euler('XYZ')
    return (math.degrees(e.x), math.degrees(e.y), math.degrees(e.z))


def to_channels(keys):
    """[(frame, pose)] -> channel dict {bone: {'rx': [(f, v)], ...}} for vbanim."""
    bones = set()
    for _, p in keys:
        bones |= set(p)
    ch = {}
    for b in bones:
        if b == 'hips_t':
            continue
        c = {'rx': [], 'ry': [], 'rz': []}
        prev = None
        for f, p in keys:
            v = p.get(b, (0, 0, 0))
            if b in HINGE:
                v = arm_euler(b, v)
                if prev is not None:
                    # keep eulers continuous between keys (no 360 degree flips)
                    v = tuple(x + 360.0 * round((pv - x) / 360.0) for x, pv in zip(v, prev))
                prev = v
            c['rx'].append((f, v[0]))
            c['ry'].append((f, v[1]))
            c['rz'].append((f, v[2]))
        ch[b] = c
    hips = ch.setdefault('hips', {'rx': 0.0, 'ry': 0.0, 'rz': 0.0})
    for i, ax in enumerate(('tx', 'ty', 'tz')):
        hips[ax] = [(f, p.get('hips_t', (0, 0, 0))[i]) for f, p in keys]
    return ch


def author(arm, only=None, table=None):
    setup_hinges(arm)
    parent = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
    body = [b for b in BODY if b in arm.data.bones]
    keyer = vbanim.Keyer(arm)
    meta = {}
    for name, (keys, loop, _) in (table if table is not None else clips()).items():
        if only and name not in only:
            continue
        N = keys[-1][0]
        keyer.clip(name, N, to_channels(keys), body, loop=loop)
        meta[name] = {'frames': N, 'fps': 30, 'loop': loop}
    return meta


def sheet(arm, mesh, out, names, frames=4, size=(220, 300)):
    """Contact sheet: a few frames of each clip, rendered with Workbench in vertex colours."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 6
    scene.cycles.use_denoising = False
    scene.render.resolution_x, scene.render.resolution_y = size
    w = bpy.data.worlds.new('w')
    scene.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.8, 0.82, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(45), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 40
    scene.collection.objects.link(cam)
    scene.camera = cam
    from mathutils import Vector
    hz = arm.data.bones['hips'].head_local.z
    t = Vector((0, 0, hz * 0.95))
    yaw, pitch, dist = math.radians(-35), math.radians(6), hz * 4.3
    cam.location = t + Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    paths = []
    ad = arm.animation_data
    for name in names:
        act = bpy.data.actions.get(name)
        if act is None:
            continue
        ad.action = act
        N = int(act.frame_range[1])
        for k in range(frames):
            f = round(k * N / max(frames - 1, 1))
            scene.frame_set(f)
            p = out.replace('.png', f'_{name}_{k}.png')
            scene.render.filepath = p
            bpy.ops.render.render(write_still=True)
            paths.append(p)
    ad.action = None
    return paths


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
    bpy.context.scene.render.fps = 30
    char = argv[argv.index('--char') + 1] if '--char' in argv else None
    table = None
    if char:
        import importlib
        table = importlib.import_module(f'anim.{char}').clips(sys.modules[__name__])
    meta = author(arm, only, table)
    if '--sheet' in argv:
        out = argv[argv.index('--sheet') + 1]
        paths = sheet(arm, mesh, out, only or list(meta))
        print('SHEET', len(paths))
    if '--export' in argv:
        os.makedirs(OUT, exist_ok=True)
        for pb in arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        bpy.ops.object.select_all(action='DESELECT')
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        path = os.path.join(OUT, f'{char or "humanoid"}.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                                  export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
                                  export_frame_step=1, export_skins=True, export_morph=False, export_materials='NONE',
                                  export_def_bones=False, export_optimize_animation_size=False, export_anim_single_armature=True)
        hips = arm.data.bones['hips'].head_local
        json.dump({'clips': meta, 'refHipHeight': hips.z}, open(os.path.join(OUT, f'{char or "humanoid"}.json'), 'w'), indent=1)
        if char:
            mpath = os.path.join(OUT, 'manifest.json')
            man = json.load(open(mpath)) if os.path.exists(mpath) else {'models': {}}
            man['models'][char] = sorted(meta)
            json.dump(man, open(mpath, 'w'), indent=1)
        print('wrote', path, os.path.getsize(path) // 1024, 'KB')
