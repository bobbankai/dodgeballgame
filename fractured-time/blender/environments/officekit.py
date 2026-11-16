"""Office and lab dressing: workstation pods, task chairs, monitors, wall storage, in a working state or ruined.

Desks, cabinets, shelving, binders, clipboards, boxes, plants and lab kit are Poly Haven CC0 scans (`envkit.prop`, licences in
docs/ASSETS.md); task chairs and monitors are built here from bevelled boxes (Poly Haven has no modern office chair or flat
screen). Blender coordinates (z up); a desk's user sits on its -Y side at yaw 0.
"""
import math
import random

from mathutils import Matrix, Vector

import envkit as K

DESK_W, DESK_D, DESK_H = 2.0, 0.95, 0.79
# triangles per prop (whole prop): seen from a third-person camera across a room, a desk needs ~2.5k, a binder a few hundred
BUDGET = {'metal_office_desk': 2600, 'drawer_cabinet': 2200, 'steel_frame_shelves_02': 1600, 'binder_notebook': 700, 'clipboard': 500,
          'cardboard_box_01': 500, 'potted_plant_01': 3000, 'potted_plant_02': 2600, 'korean_fire_extinguisher_01': 900,
          'industrial_microscope': 1800, 'chemistry_set': 3500, 'circuit_board': 500}


def prop(S, asset, loc, yaw=0.0, **kw):
    """envkit.prop with the kit's triangle budget for the asset."""
    kw.setdefault('budget', BUDGET.get(asset, 2000))
    return K.prop(S, asset, loc, yaw, **kw)


def _mats(M):
    if 'ok_fabric' not in M:
        M['ok_fabric'] = K.plain_mat('ok_fabric', (0.055, 0.06, 0.068), rough=0.92)
        M['ok_plastic'] = K.plain_mat('ok_plastic', (0.045, 0.047, 0.05), rough=0.45)
        M['ok_alu'] = K.plain_mat('ok_alu', (0.55, 0.56, 0.58), rough=0.3, metal=1.0)
        M['ok_deadscreen'] = K.plain_mat('ok_deadscreen', (0.012, 0.013, 0.015), rough=0.12)
    return M


def _place(B, mat, size, cx, cy, yaw, local, bevel=0.01, extra=None):
    """A box at `local` (x, y, z) in a frame at (cx, cy) turned by yaw; `extra` (a 4x4 Matrix) tips it about its own centre."""
    R = Matrix.Rotation(yaw, 4, 'Z')
    p = R @ Vector(local)
    rot = R if extra is None else R @ extra
    B.box(mat, size, (cx + p.x, cy + p.y, p.z), rot=rot, bevel=bevel)


def task_chair(B, M, x, y, yaw, fallen=False, seed=0):
    """A five-star task chair: castors, gas lift, upholstered seat and back. `fallen`: on its side, rolled away."""
    _mats(M)
    rng = random.Random(seed)
    if fallen:
        # on its side: the whole chair tipped 90 degrees about its forward axis, lying on the floor
        tip = Matrix.Rotation(math.radians(88), 4, 'Y')
        base_z = 0.26
    else:
        tip = None
        base_z = 0.0
    yaw = yaw + rng.uniform(-0.35, 0.35)

    def put(mat, size, loc, bevel=0.01):
        lx, ly, lz = loc
        if tip is not None:
            v = tip @ Vector((lx, ly, lz - 0.45))
            lx, ly, lz = v.x, v.y, v.z + base_z
        _place(B, mat, size, x, y, yaw, (lx, ly, lz), bevel=bevel, extra=tip)
    for k in range(5):
        a = k / 5 * math.tau
        R = Matrix.Rotation(a, 4, 'Z')
        c = R @ Vector((0.16, 0, 0))
        e = R @ Vector((0.31, 0, 0))
        lx, ly = c.x, c.y
        if tip is None:
            _place(B, M['ok_plastic'], (0.32, 0.045, 0.03), x, y, yaw + a, (0.16, 0, 0.075), bevel=0.01)
            _place(B, M['ok_plastic'], (0.05, 0.03, 0.05), x, y, yaw, (e.x, e.y, 0.025), bevel=0.012)
        else:
            put(M['ok_plastic'], (0.32, 0.045, 0.03), (lx, ly, 0.075))
    put(M['ok_alu'], (0.05, 0.05, 0.34), (0, 0, 0.26))
    put(M['ok_plastic'], (0.26, 0.24, 0.04), (0, 0, 0.43))
    put(M['ok_fabric'], (0.5, 0.48, 0.08), (0, 0, 0.49), bevel=0.03)
    put(M['ok_plastic'], (0.05, 0.05, 0.36), (0, 0.24, 0.62))
    put(M['ok_fabric'], (0.46, 0.07, 0.48), (0, 0.27, 0.86), bevel=0.03)
    for sx in (-1, 1):
        put(M['ok_plastic'], (0.05, 0.24, 0.03), (sx * 0.27, 0.02, 0.68))
        put(M['ok_plastic'], (0.03, 0.03, 0.16), (sx * 0.27, 0.08, 0.6))


def monitor(B, M, x, y, z, yaw, screen, smashed=False):
    """A flat screen on a stand (faces -Y at yaw 0). `screen`: the lit material; `smashed`: face down on the desk, dark."""
    _mats(M)
    if smashed:
        _place(B, M['ok_plastic'], (0.58, 0.36, 0.03), x, y, yaw + 0.4, (0, 0, z + 0.016), bevel=0.006)
        _place(B, M['ok_plastic'], (0.22, 0.18, 0.015), x, y, yaw + 1.1, (0.3, 0.15, z + 0.008), bevel=0.004)
        return
    _place(B, M['ok_alu'], (0.24, 0.19, 0.012), x, y, yaw, (0, 0.04, z + 0.006), bevel=0.004)
    _place(B, M['ok_alu'], (0.045, 0.03, 0.3), x, y, yaw, (0, 0.08, z + 0.16), bevel=0.006)
    _place(B, M['ok_plastic'], (0.58, 0.035, 0.36), x, y, yaw, (0, 0.05, z + 0.38), bevel=0.008)
    _place(B, screen, (0.55, 0.004, 0.32), x, y, yaw, (0, 0.031, z + 0.385), bevel=0.0)


def workstation_pod(S, B, M, cx, cy, yaw, tl, seed, screens=('screen0', 'screen1'), ruined=False, collide=True):
    """Four desks back to back (two rows facing out), a chair at each, one or two monitors per desk, the clutter of people
    working (binders, a clipboard, boxes, a plant at the pod's end). Ruined: desks shoved, two tipped onto their backs, chairs on
    their sides across the floor, monitors face down, binders and boxes spilled."""
    _mats(M)
    rng = random.Random(seed)
    R = Matrix.Rotation(yaw, 4, 'Z')

    def at(lx, ly):
        v = R @ Vector((lx, ly, 0))
        return cx + v.x, cy + v.y
    for row in (-1, 1):
        for col in (-1, 1):
            lx, ly = col * DESK_W / 2, row * DESK_D / 2
            dyaw = yaw + (0.0 if row < 0 else math.pi)   # each row's users sit on the pod's outside
            k = (row + 1) * 2 + (col + 1) // 2
            if ruined:
                jx, jy = rng.uniform(-0.6, 0.6), rng.uniform(-0.5, 0.5)
                x, y = at(lx + jx, ly + jy + row * 0.4)
                if rng.random() < 0.5:   # on its back, legs toward the room
                    prop(S, 'metal_office_desk', (x, y, DESK_D / 2), dyaw + rng.uniform(-0.4, 0.4), timeline=tl, collide=False,
                           rot=Matrix.Rotation(math.radians(90 * -row), 4, 'X'))
                else:
                    prop(S, 'metal_office_desk', (x, y, 0.0), dyaw + rng.uniform(-0.5, 0.5), timeline=tl, collide=False)
                    monitor(B, M, x, y, DESK_H, dyaw, None, smashed=True)
                cxh, cyh = at(lx + rng.uniform(-1.2, 1.2), ly + row * rng.uniform(1.4, 2.6))
                task_chair(B, M, cxh, cyh, rng.uniform(0, math.tau), fallen=True, seed=seed * 10 + k)
                bx, by = at(lx + rng.uniform(-1.0, 1.0), ly + row * rng.uniform(1.0, 2.2))
                prop(S, 'binder_notebook', (bx, by, 0.0), rng.uniform(0, math.tau), node='binder_notebook', timeline=tl, collide=False)
                continue
            x, y = at(lx, ly)
            prop(S, 'metal_office_desk', (x, y, 0.0), dyaw, timeline=tl, collide=False)
            ux, uy = at(lx, ly + row * 0.95)
            task_chair(B, M, ux, uy, dyaw + math.pi, seed=seed * 10 + k)
            two = rng.random() < 0.45
            for j, off in enumerate((-0.33, 0.33) if two else (0.0,)):
                mx, my = at(lx + off * (1 if row < 0 else -1), ly + row * -0.22)
                monitor(B, M, mx, my, DESK_H, dyaw + (0.18 if two and j == 0 else -0.18 if two else 0.0) * (1 if row < 0 else -1),
                        M[screens[(k + j) % len(screens)]])
            # the desk's clutter, toward the user's side
            r = rng.random()
            px, py = at(lx + rng.uniform(-0.75, -0.35) * (1 if row < 0 else -1), ly + row * 0.12)
            if r < 0.5:
                prop(S, 'binder_notebook', (px, py, DESK_H), dyaw + rng.uniform(-0.3, 0.3), node='binder_notebook_closed', timeline=tl,
                       collide=False)
            elif r < 0.8:
                prop(S, 'clipboard', (px, py, DESK_H), dyaw + rng.uniform(-0.4, 0.4), timeline=tl, collide=False)
            if rng.random() < 0.3:
                qx, qy = at(lx + 0.75 * (1 if row < 0 else -1), ly + row * 0.6)
                prop(S, 'cardboard_box_01', (qx, qy, 0.0), rng.uniform(0, math.tau), timeline=tl, collide=False)
    if not ruined:
        ex, ey = at(DESK_W + 0.45, 0.0)
        prop(S, 'potted_plant_01' if rng.random() < 0.5 else 'potted_plant_02', (ex, ey, 0.0), rng.uniform(0, math.tau), timeline=tl,
               collide=False)
    if collide:
        w, d = 2 * DESK_W, 2 * DESK_D
        size = (w, d, 0.9) if abs(math.sin(yaw)) < 0.5 else (d, w, 0.9)
        K.collide_box(S, f'pod_{seed}_{tl}', size, (cx, cy, 0.45), timeline=tl)


def wall_storage(S, M, x, y, yaw, tl, n=3, seed=0, ruined=False):
    """Along a wall: filing cabinets and a steel shelf unit with archive boxes and binders. Ruined: a cabinet face down, boxes
    split across the floor. The scans' fronts face -Y at yaw 0: on a west wall yaw = +pi/2, on an east wall -pi/2."""
    rng = random.Random(seed)
    R = Matrix.Rotation(yaw, 4, 'Z')
    for i in range(n):
        v = R @ Vector(((i - (n - 1) / 2) * 1.2, 0, 0))
        px, py = x + v.x, y + v.y
        if i % 3 == 2:
            prop(S, 'steel_frame_shelves_02', (px, py, 0.0), yaw, timeline=tl, collide=False)
            for z in (0.36, 0.98, 1.6):
                if rng.random() < 0.8 and not (ruined and z > 1):
                    prop(S, 'cardboard_box_01', (px, py, z), yaw + rng.uniform(-0.2, 0.2), scale=0.85, timeline=tl, collide=False)
        elif ruined and rng.random() < 0.5:
            prop(S, 'drawer_cabinet', (px, py, 0.25), yaw, timeline=tl, collide=False,
                   rot=Matrix.Rotation(math.radians(-90), 4, 'X'))
        else:
            prop(S, 'drawer_cabinet', (px, py, 0.0), yaw + (rng.uniform(-0.15, 0.15) if ruined else 0.0), timeline=tl, collide=False)
    w = n * 1.2
    size = (w, 0.6, 2.0) if abs(math.sin(yaw)) < 0.5 else (0.6, w, 2.0)
    K.collide_box(S, f'store_{seed}_{tl}', size, (x, y, 1.0), timeline=tl)
