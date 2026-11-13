"""Pose library for Kael (and every human on the game_engine skeleton). See animlib for axes."""
from animlib import mirror

FING = ['index', 'middle', 'ring', 'pinky']

TEST = {
    'rest': {},
    'arms_y40': mirror({'upperarm_l': (0, 40, 0)}),
    'elbow_x40': mirror({'upperarm_l': (0, 40, 0), 'lowerarm_l': (40, 0, 0)}),
    'curl_lx': mirror({'upperarm_l': (0, 40, 0), **{f'{f}_0{i}_l': {'local': (45, 0, 0)} for f in FING for i in (1, 2, 3)}}),
    'curl_lz': mirror({'upperarm_l': (0, 40, 0), **{f'{f}_0{i}_l': {'local': (0, 0, 45)} for f in FING for i in (1, 2, 3)}}),
    'leg': {'thigh_l': (-40, 0, 0), 'calf_l': (60, 0, 0), 'foot_l': (-20, 0, 0), 'spine_02': (15, 0, 20)},
    'thumb': mirror({'upperarm_l': (0, 40, 0), 'thumb_01_l': {'local': (0, 0, 40)}, 'thumb_02_l': {'local': (40, 0, 0)}}),
    'hand': mirror({'upperarm_l': (0, 40, 0), 'hand_l': (30, 0, 0)}),
}
