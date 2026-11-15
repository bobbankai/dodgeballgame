"""
City kit (Chapter 1 surface, Chapter 2 Fractured District): towers from several eras, timeline fractures, street furniture.

The fractured city's visual rule: one skyline, several histories. A tower can be modern glass at street level and an older brick block
above a seam, shifted sideways where the timelines failed to line up; the seam glows chronal cyan and pieces of both hang frozen in the
air around it. Everything is real geometry (piers, floor slabs, recessed glazing, parapets) so the Cycles lightmap bake gives true
depth and occlusion; the far skyline uses cheaper massing.

Geometry is accumulated per material in `Batch` (one bmesh per material) and turned into a few objects, so a whole district builds fast.
Coordinates are Blender's (x, y, z), metres.
"""
import json
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

import envkit as K


class Batch:
    """Boxes accumulated per material into single meshes (bevelled, smooth with sharp edges, metric UVs applied later)."""

    def __init__(self, name):
        self.name = name
        self.bms = {}

    def box(self, material, size, loc, rot_z=0.0, bevel=0.02, rot=None):
        bm = self.bms.setdefault(material.name, (bmesh.new(), material))[0]
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        bmesh.ops.scale(tmp, vec=Vector(size), verts=tmp.verts)
        if bevel > 0:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=min(bevel, min(size) * 0.4), segments=1, profile=0.5, affect='EDGES')
        R = Matrix.Rotation(rot_z, 4, 'Z') if rot is None else rot
        bmesh.ops.transform(tmp, matrix=Matrix.Translation(Vector(loc)) @ R, verts=tmp.verts)
        me = bpy.data.meshes.new('_tmp')
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def pane(self, material, corners, k):
        """A window pane (4 corners, counter-clockwise from bottom-left as seen from outside) whose WIN uv spans [k, k+1] x [0, 1]:
        continuous inside the window, a different integer cell per window (the engine's interior-mapping seed)."""
        lst = self.__dict__.setdefault('panes', {}).setdefault(material.name, ([], material))[0]
        lst.append((corners, k))

    def objects(self):
        out = []
        for key, (lst, mat) in self.__dict__.pop('panes', {}).items():
            verts, faces, uvs = [], [], []
            for corners, k in lst:
                b = len(verts)
                verts += [tuple(c) for c in corners]
                faces.append((b, b + 1, b + 2, b + 3))
                uvs += [(k, 0.0), (k + 1.0, 0.0), (k + 1.0, 1.0), (k, 1.0)]
            me = bpy.data.meshes.new(f'{self.name}_{key}')
            me.from_pydata(verts, [], faces)
            base = me.uv_layers.new(name='UVMap')
            win = me.uv_layers.new(name='WIN')
            flat = [c for uv in uvs for c in uv]
            base.data.foreach_set('uv', flat)
            win.data.foreach_set('uv', flat)
            me.materials.append(mat)
            ob = bpy.data.objects.new(f'{self.name}_{key}', me)
            bpy.context.scene.collection.objects.link(ob)
            out.append(ob)
        for key, (bm, mat) in self.bms.items():
            me = bpy.data.meshes.new(f'{self.name}_{key}')
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new(f'{self.name}_{key}', me)
            bpy.context.scene.collection.objects.link(ob)
            me.materials.append(mat)
            for p in me.polygons:
                p.use_smooth = True
            me.set_sharp_from_angle(angle=math.radians(40))
            out.append(ob)
        self.bms = {}
        return out


ERAS = ('modern', 'concrete', 'brick', 'ruin', 'overgrown')


def era_mats(M, era):
    """(pier/frame material, slab material, glazing material) for an era."""
    return {
        'modern': (M['c_frame'], M['c_frame'], M['c_glass']),
        'concrete': (M['c_concrete'], M['c_concrete'], M['c_window']),
        'brick': (M['c_brick'], M['c_stone'], M['c_window']),
        'ruin': (M['c_ruin'], M['c_ruin'], M['c_void']),
        'overgrown': (M['c_moss'], M['c_ruin'], M['c_void']),
    }[era]


# Dusk: lit windows (share of windows with the lights on, per era; whole office floors cluster). Level scripts set it.
LIT = {'modern': 0.0, 'concrete': 0.0, 'brick': 0.0, 'ruin': 0.0, 'overgrown': 0.0}
DUSK_LIT = {'modern': 0.3, 'concrete': 0.26, 'brick': 0.3, 'ruin': 0.012, 'overgrown': 0.0}


_PANES = [0]


def window_mat(era):
    """The window panes of an era: the engine draws rooms behind them (interior mapping); `lit` is the share with lights on."""
    key = f'winpane_{era}'
    if key not in K.MATS:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (0.05, 0.06, 0.07, 1)
        b.inputs['Roughness'].default_value = 0.08
        m['ft'] = json.dumps({'type': 'window', 'era': era, 'lit': LIT.get(era, 0.0), 'night': 1.0 if LIT.get(era, 0.0) > 0 else 0.0})
        K.MATS[key] = m
    return K.MATS[key]


def lit_windows(B, M, era, put, w, d, z0, z1, nf, rng, bay, cx=0.0, cy=0.0, R=None):
    """A glass pane in every window bay, just proud of the glazing core: the engine draws a room behind each (blinds, curtains,
    furniture masses with parallax, the lights on in a share of them at dusk). Ruined eras keep their black, broken openings."""
    if era in ('ruin', 'overgrown'):
        return
    mat = window_mat(era)
    h = (z1 - z0) / nf
    for k in range(nf):
        zb = z0 + k * h + 0.45
        zt = z0 + (k + 1) * h - 0.45
        for along, across, horiz in ((w, d, True), (d, w, False)):
            n = max(2, int(along / bay) + 1)
            ts = [-along / 2 + 0.25 + (along - 0.5) * i / (n - 1) for i in range(n)]
            for i in range(n - 1):
                ta, tb = ts[i] + 0.3, ts[i + 1] - 0.3
                if tb - ta < 0.4:
                    continue
                for side in (-1, 1):
                    o = side * (across / 2 - 0.35 + 0.012)
                    # counter-clockwise seen from outside (the face normal points out of the building)
                    if horiz:
                        a_, b_ = (ta, tb) if side < 0 else (tb, ta)
                        loc = [(a_, o, zb), (b_, o, zb), (b_, o, zt), (a_, o, zt)]
                    else:
                        a_, b_ = (ta, tb) if side > 0 else (tb, ta)
                        loc = [(o, a_, zb), (o, b_, zb), (o, b_, zt), (o, a_, zt)]
                    pts = [(R @ Vector(p_)) if R is not None else Vector(p_) for p_ in loc]
                    _PANES[0] += 1
                    B.pane(mat, [(cx + p_.x, cy + p_.y, p_.z) for p_ in pts], _PANES[0] % 4096)


def storeys(B, M, era, cx, cy, w, d, z0, z1, rng, rot_z=0.0, floor_h=3.6, bay=3.2, broken=0.0, parapet=True):
    """Facade block from z0 to z1: recessed glazing core, piers every `bay`, floor slabs every storey, a parapet on top.
    `broken` (0..1): fraction of piers and slab segments missing (ruined era)."""
    frame, slab, glaze = era_mats(M, era)
    R = Matrix.Rotation(rot_z, 4, 'Z')

    def put(mat, size, loc, bevel=0.03):
        p = R @ Vector(loc)
        B.box(mat, size, (cx + p.x, cy + p.y, p.z), rot_z=rot_z, bevel=bevel)
    h = z1 - z0
    # the recessed glazing / inner wall
    put(glaze, (w - 0.7, d - 0.7, h), (0, 0, z0 + h / 2), bevel=0.0)
    # piers on every face
    for sx, length, other in ((1, w, d), (0, d, w)):
        n = max(2, int(length / bay) + 1)
        for i in range(n):
            t = -length / 2 + 0.25 + (length - 0.5) * i / (n - 1)
            for side in (-1, 1):
                if broken and rng.random() < broken * 0.5 and 0 < i < n - 1:
                    top = z0 + h * rng.uniform(0.2, 0.8)
                    if top - z0 > 0.5:
                        loc = (t, side * (other / 2 - 0.25), z0 + (top - z0) / 2) if sx else (side * (other / 2 - 0.25), t, z0 + (top - z0) / 2)
                        put(frame, (0.5, 0.5, top - z0), loc)
                    continue
                loc = (t, side * (other / 2 - 0.25), z0 + h / 2) if sx else (side * (other / 2 - 0.25), t, z0 + h / 2)
                put(frame, (0.5, 0.5, h), loc)
    # floor slabs: a band around the building at every storey
    nf = max(1, int(h / floor_h))
    lit_windows(B, M, era, put, w, d, z0, z1, nf, random.Random(rng.random()), bay, cx, cy, R)
    for k in range(1, nf + 1):
        z = z0 + k * h / nf
        for side in (-1, 1):
            for along, across, horiz in ((w, d, True), (d, w, False)):
                if broken and rng.random() < broken * 0.35:
                    continue
                size = (along + 0.3, 0.42, 0.32) if horiz else (0.42, along + 0.3, 0.32)
                loc = (0, side * (across / 2 - 0.05), z - 0.16) if horiz else (side * (across / 2 - 0.05), 0, z - 0.16)
                put(slab, size, loc)
    if not parapet:
        return
    # parapet
    for side in (-1, 1):
        put(slab, (w + 0.2, 0.3, 1.1), (0, side * (d / 2 - 0.05), z1 + 0.55))
        put(slab, (0.3, d + 0.2, 1.1), (side * (w / 2 - 0.05), 0, z1 + 0.55))
    put(slab, (w - 0.4, d - 0.4, 0.3), (0, 0, z1 + 0.15), bevel=0.0)


def roof_clutter(B, M, cx, cy, w, d, z, rng, rot_z=0.0):
    """HVAC units, a water tank, vents, an antenna mast: rooftops read from the deck and in the vista."""
    R = Matrix.Rotation(rot_z, 4, 'Z')
    for _ in range(rng.randint(2, 4)):
        sx, sy = rng.uniform(1.2, 3.0), rng.uniform(1.2, 2.6)
        p = R @ Vector((rng.uniform(-w / 2 + 2, w / 2 - 2), rng.uniform(-d / 2 + 2, d / 2 - 2), 0))
        B.box(M['c_metal'], (sx, sy, rng.uniform(0.9, 1.8)), (cx + p.x, cy + p.y, z + 0.9), rot_z=rot_z, bevel=0.04)
    if rng.random() < 0.6:
        p = R @ Vector((rng.uniform(-w / 3, w / 3), rng.uniform(-d / 3, d / 3), 0))
        B.box(M['c_metal'], (0.12, 0.12, rng.uniform(4, 9)), (cx + p.x, cy + p.y, z + 3), bevel=0.0)


def tower(B, M, cx, cy, w, d, z0, z1, era, seed, rot_z=0.0, clutter=True):
    rng = random.Random(seed)
    storeys(B, M, era, cx, cy, w, d, z0, z1, rng, rot_z=rot_z, broken=0.45 if era in ('ruin', 'overgrown') else 0.0)
    if clutter:
        roof_clutter(B, M, cx, cy, w, d, z1 + 0.3, rng, rot_z)


def fractured_tower(B, M, cx, cy, w, d, z0, zc, z1, era_lo, era_hi, seed, shift=(1.6, -0.8), twist=4.0, gap=1.4, chunks=14):
    """Two timelines in one tower: era_lo up to the cut, era_hi above it, displaced and twisted, a glowing seam between, debris of both
    frozen in the air around the seam."""
    rng = random.Random(seed)
    storeys(B, M, era_lo, cx, cy, w, d, z0, zc, rng, broken=0.3 if era_lo in ('ruin', 'overgrown') else 0.0)
    tw = math.radians(twist)
    storeys(B, M, era_hi, cx + shift[0], cy + shift[1], w, d, zc + gap, z1, rng, rot_z=tw, broken=0.3 if era_hi in ('ruin', 'overgrown') else 0.0)
    roof_clutter(B, M, cx + shift[0], cy + shift[1], w, d, z1 + 0.3, rng, tw)
    # the seam: a thin plane of chronal light where the two histories fail to meet
    B.box(M['c_seam'], (w * 0.92, d * 0.92, 0.12), (cx + shift[0] * 0.5, cy + shift[1] * 0.5, zc + gap * 0.5), rot_z=tw * 0.5, bevel=0.0)
    for _ in range(chunks):
        s = rng.uniform(0.3, 1.6)
        m = rng.choice(era_mats(M, era_lo)[:2] + era_mats(M, era_hi)[:2])
        a = rng.uniform(0, math.tau)
        r = rng.uniform(w * 0.55, w * 1.1)
        rot = Matrix.Rotation(rng.uniform(0, 1), 4, Vector((rng.random(), rng.random(), rng.random())).normalized())
        B.box(m, (s, s * rng.uniform(0.5, 1.2), s * rng.uniform(0.4, 1.0)),
              (cx + math.cos(a) * r, cy + math.sin(a) * r, zc + rng.uniform(-3, gap + 4)), bevel=0.05, rot=rot)


def street(B, M, x0, x1, y0, y1, z):
    """Asphalt with kerbs and pavements around a block."""
    B.box(M['c_asphalt'], (x1 - x0, y1 - y0, 0.4), ((x0 + x1) / 2, (y0 + y1) / 2, z - 0.2), bevel=0.0)


_LAMPS = [0]
LAMP_COLOR = (1.0, 0.84, 0.64)   # warm-white LED street lighting
LAMP_POWER = 340.0


def lamp_post(B, M, x, y, z, rot_z=0.0, fallen=False, lit=None):
    """Street light: pole, outreach arm, a luminaire at its end. `lit` (default: on at dusk) gives it its lens and a real light."""
    if fallen:
        B.box(M['c_metal'], (0.16, 7.0, 0.16), (x, y, z + 0.1), rot_z=rot_z, bevel=0.02)
        return
    B.box(M['c_metal'], (0.16, 0.16, 7.0), (x, y, z + 3.5), bevel=0.02)
    p = Matrix.Rotation(rot_z, 4, 'Z') @ Vector((0, -0.8, 0))
    B.box(M['c_metal'], (0.12, 1.7, 0.12), (x + p.x * 0.5, y + p.y * 0.5, z + 6.9), rot_z=rot_z, bevel=0.02)
    # luminaire at the far end of the arm
    hx, hy = x + p.x * 1.45, y + p.y * 1.45
    B.box(M['c_metal'], (0.3, 0.62, 0.11), (hx, hy, z + 6.86), rot_z=rot_z, bevel=0.03)
    on = LIT['concrete'] > 0 if lit is None else lit
    B.box(M['lamp_lens'] if on else M['dark'], (0.22, 0.5, 0.02), (hx, hy, z + 6.80), rot_z=rot_z, bevel=0.005)
    if on:
        _LAMPS[0] += 1
        K.area_light(f'lamp{_LAMPS[0]}', (hx, hy, z + 6.77), (0.22, 0.5), LAMP_POWER, LAMP_COLOR, rot=(0, 0, rot_z))


# --- signage ---------------------------------------------------------------------------------------------------------------

_SIGNS = [0]


def _facing_rot(dx, dy):
    """Euler for a text mesh (Blender text faces +Z, reads along +X) standing upright facing (dx, dy)."""
    return (math.pi / 2, 0.0, math.atan2(dx, -dy))


def neon_sign(S, B, M, text, x, y, z, facing, color, size=0.42, strength=22.0, board=True, light=1.0, missing=''):
    """Storefront lettering in bent neon on a dark fascia board, with a soft coloured light thrown on the pavement and the wet
    street in front of it. `missing`: letters that are dark (a dead sign)."""
    _SIGNS[0] += 1
    n = _SIGNS[0]
    dx, dy = facing
    neon = K.emissive_mat(f'neon_{color[0]:.2f}_{color[1]:.2f}_{color[2]:.2f}_{strength:.0f}', color, strength)
    width = len(text) * size * 0.66 + 0.5
    if board:
        # the fascia: a shallow dark box the letters stand on, with a lit top edge
        bx, by = x - dx * 0.06, y - dy * 0.06
        bsize = (abs(dy) * width + abs(dx) * 0.1, abs(dx) * width + abs(dy) * 0.1, size * 1.7)
        B.box(M['dark'], bsize, (bx, by, z + size * 0.32), bevel=0.02)
    lit_text = ''.join(c if c not in missing else ' ' for c in text)
    if lit_text.strip():
        ob = K.sign(f'neon{n}', lit_text, (x + dx * 0.02, y + dy * 0.02, z), _facing_rot(dx, dy), size, neon, depth=0.012)
        S.add(ob)
    dead = ''.join(c if c in missing else ' ' for c in text)
    if dead.strip():
        ob = K.sign(f'neond{n}', dead, (x + dx * 0.02, y + dy * 0.02, z), _facing_rot(dx, dy), size, M['dark'], depth=0.012)
        S.add(ob)
    if light > 0 and lit_text.strip():
        K.area_light(f'neon{n}_l', (x + dx * 0.35, y + dy * 0.35, z + size * 0.3), (width * 0.8, size * 0.8),
                     40.0 * width * light * len(lit_text.replace(' ', '')) / max(1, len(text.replace(' ', ''))), color,
                     rot=(math.pi / 2, 0.0, math.atan2(-dx, dy)))


def shopfront(S, B, M, x, y, facing, width, z=0.0, interior=(1.0, 0.86, 0.68), sign=None, neon=(1.0, 0.3, 0.6), strength=2.6,
              awning=True):
    """A lit shop window at street level in a facade facing (dx, dy): a glowing interior plane recessed behind mullions, shelf
    silhouettes, a canopy, the shop's neon name on the fascia above, and the window's light spilling onto the pavement."""
    dx, dy = facing
    ax, ay = -dy, dx  # along the facade
    key = f'shop_{interior[0]:.2f}_{interior[1]:.2f}_{interior[2]:.2f}_{strength:.1f}'
    glow = K.emissive_mat(key, interior, strength)
    sz = lambda along, out, up: (abs(ax) * along + abs(dx) * out, abs(ay) * along + abs(dy) * out, up)  # noqa: E731
    B.box(glow, sz(width, 0.02, 2.5), (x - dx * 0.05, y - dy * 0.05, z + 1.45), bevel=0.0)
    # shelves seen through the glass
    for k, h in enumerate((0.6, 1.15, 1.7)):
        B.box(M['dark'], sz(width * 0.86, 0.06, 0.05), (x + dx * 0.0, y + dy * 0.0, z + h), bevel=0.0)
    # mullions + transom
    nm = max(2, int(width / 1.4) + 1)
    for i in range(nm):
        t = -width / 2 + width * i / (nm - 1)
        B.box(M['c_metal'], sz(0.07, 0.1, 2.6), (x + ax * t + dx * 0.04, y + ay * t + dy * 0.04, z + 1.4), bevel=0.01)
    B.box(M['c_metal'], sz(width + 0.1, 0.1, 0.08), (x + dx * 0.04, y + dy * 0.04, z + 2.72), bevel=0.01)
    B.box(M['c_metal'], sz(width + 0.1, 0.12, 0.2), (x + dx * 0.04, y + dy * 0.04, z + 0.12), bevel=0.01)
    if awning:
        B.box(M['dark'], sz(width + 0.6, 1.1, 0.08), (x + dx * 0.6, y + dy * 0.6, z + 2.95), bevel=0.02)
    if sign:
        neon_sign(S, B, M, sign, x + dx * 0.12, y + dy * 0.12, z + 3.25, facing, neon, size=0.4)
    K.area_light(f'shop{_SIGNS[0]}_{x:.0f}_{y:.0f}', (x + dx * 0.25, y + dy * 0.25, z + 1.5), (width * 0.9, 2.2), 70.0 * width,
                 interior, rot=(math.pi / 2, 0.0, math.atan2(-dx, dy)))


def barrier(B, M, x, y, z, rot_z=0.0, tipped=0.0):
    """Concrete jersey barrier (trapezoid made of two boxes), optionally tipped over."""
    rot = Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Rotation(tipped, 4, 'Y')
    B.box(M['c_concrete'], (0.6, 3.0, 0.45), (x, y, z + 0.22), bevel=0.06, rot=rot)
    up = rot @ Vector((0, 0, 0.62))
    B.box(M['c_concrete'], (0.3, 3.0, 0.6), (x + up.x, y + up.y, z + up.z), bevel=0.06, rot=rot)


def crate(B, M, x, y, z, s=1.2, rot_z=0.0):
    B.box(M['c_crate'], (s, s, s), (x, y, z + s / 2), rot_z=rot_z, bevel=0.05)
