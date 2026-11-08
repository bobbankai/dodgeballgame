"""Hinoka village kit: blender -b --factory-startup -P village.py -- [--preview out.png] [names...]

Japanese mountain-village architecture built from code: minka houses (thatched hip roofs or tiled gable
roofs with a concave sori curve and upturned eaves), their burnt ruins, the shrine hall, torii, stone
lanterns, shrine stairs, an arched bridge, fences, a well, rice-drying racks, the Ember brazier, a cart,
a training dummy and dry-stone terrace walls.

Every piece is bevelled boxes / tubes / lofted surfaces with world-scale UVs (wood grain follows each
member's long axis; roof tiles run along the eaves and down the slope) using the shared tiling PBR sets
in assets/tex (bound at runtime). Vertex colour 'Col' carries per-member tint variation and grime at
the base. Blender (x, y, z) -> three (x, z, -y): fronts face Blender -Y (three +Z).
"""
import bpy
import bmesh
import math
import os
import sys
import random
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(__file__))
import outfit as O  # noqa
import charlib  # noqa

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'env', 'village')
Z = Vector((0, 0, 1))

# material key -> (texture set, tint, metres per texture tile, extra kwargs)
MATSPEC = {
    'post': ('wood_beam', (0.42, 0.33, 0.25), 1.5, {}),
    'plank': ('wood_weathered', (0.9, 0.85, 0.8), 2.0, {}),
    'cedar': ('wood_cedar', (0.85, 0.75, 0.62), 2.0, {}),
    'floor': ('wood_floor_dark', (0.8, 0.7, 0.6), 2.0, {}),
    'shutter': ('wood_shutter', (0.75, 0.66, 0.55), 2.0, {}),
    'plaster': ('plaster_white', (0.93, 0.9, 0.84), 2.5, {}),
    'clay': ('plaster_clay', (0.95, 0.88, 0.78), 2.5, {}),
    'kawara': ('roof_kawara', (0.5, 0.52, 0.56), 2.0, {}),
    'thatch': ('roof_thatch', (0.95, 0.88, 0.75), 2.5, {}),
    'straw': ('roof_thatch', (1.15, 1.0, 0.7), 1.2, {}),
    'stone': ('stone_rustic', (0.85, 0.85, 0.82), 2.0, {}),
    'stone_wall': ('japanese_stone_wall', (0.9, 0.9, 0.88), 3.0, {}),
    'stone_tiles': ('stone_tiles', (0.85, 0.84, 0.8), 2.0, {}),
    'lacquer_red': ('lacquer_worn', (0.62, 0.09, 0.04), 2.0, {'coat': 0.5, 'coat_rough': 0.35}),
    'lacquer_black': ('lacquer_worn', (0.03, 0.03, 0.03), 2.0, {'coat': 0.5, 'coat_rough': 0.3}),
    'charred': ('wood_beam', (0.05, 0.042, 0.036), 1.5, {}),
    'ash_plaster': ('plaster_white', (0.16, 0.15, 0.14), 2.5, {}),
    'ash_thatch': ('roof_thatch', (0.12, 0.1, 0.08), 2.5, {}),
    'iron': ('metal_rust', (0.6, 0.55, 0.5), 1.0, {'metal': 0.8}),
    'bamboo': ('bamboo_wall', (0.85, 0.9, 0.7), 1.5, {}),
    'steel': ('steel_gray', (0.36, 0.35, 0.34), 1.0, {'metal': 0.95}),
    'leather': ('leather_brown', (0.62, 0.46, 0.34), 1.0, {}),
    'gold': ('steel_gray', (0.95, 0.68, 0.3), 1.0, {'metal': 1.0}),
}
_mats = {}


def mat(key):
    if key in _mats:
        return _mats[key]
    if key == 'paper':
        m = bpy.data.materials.new('paper')
        m.use_fake_user = True
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (0.93, 0.9, 0.8, 1)
        b.inputs['Roughness'].default_value = 0.9
        m['paper'] = 1  # translucent rice paper: the game lights it from inside when a level asks
        _mats[key] = m
        return m
    tex, tint, size, kw = MATSPEC[key]
    m = O.tiling_material(key, tex, tint, scale=1.0, **kw)
    m['tile'] = size
    if key == 'charred':
        m['cracks'] = 1  # embers smouldering in the char
    _mats[key] = m
    return m


class Kit:
    """Accumulates primitives in one bmesh; per-face material keys; UVs in metres / tile size."""

    def __init__(self, name, seed=1):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.color.new('Col')
        self.keys = []
        self.rnd = random.Random(seed)

    def _mi(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def _tile(self, key):
        return 2.5 if key == 'paper' else MATSPEC[key][2]

    def _begin(self):
        """each primitive is built in its own bmesh (bmesh reuses freed slots, so 'faces after index n'
        is not 'this primitive's faces' once an op deletes geometry), then merged by _commit"""
        bm = bmesh.new()
        bm.loops.layers.uv.new('UVMap')
        bm.loops.layers.color.new('Col')
        return bm

    def _commit(self, bm):
        me = bpy.data.meshes.new('tmp')
        bm.to_mesh(me)
        bm.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def _finish_faces(self, bm, key, grain=None, tint=None, uv=True, uv_faces=None):
        """material, box-projected UVs (v along `grain`, a world vector), vertex colour; then merge"""
        uvl = bm.loops.layers.uv['UVMap']
        coll = bm.loops.layers.color['Col']
        mi = self._mi(key)
        size = self._tile(key)
        t = tint if tint is not None else self.rnd.uniform(0.86, 1.06)
        off = Vector((self.rnd.random() * 7, self.rnd.random() * 7, 0))
        boxuv = set(uv_faces) if uv_faces is not None else None
        bm.normal_update()
        for f in bm.faces:
            f.material_index = mi
            f.smooth = True
            n = f.normal
            fuv = uv or (boxuv is not None and f in boxuv)
            if fuv:
                if grain is not None and abs(n.dot(grain)) < 0.7:
                    vax = grain.normalized()
                    uax = n.cross(vax).normalized()
                else:
                    a = max(range(3), key=lambda i: abs(n[i]))
                    if a == 2:
                        uax, vax = Vector((1, 0, 0)), Vector((0, 1, 0))
                    else:
                        vax = Vector((0, 0, 1))
                        uax = n.cross(vax).normalized()
            for l in f.loops:
                co = l.vert.co
                if fuv:
                    l[uvl].uv = (co.dot(uax) / size + off.x, co.dot(vax) / size + off.y)
                # grime: darker near the ground
                g = 0.62 + 0.38 * min(1.0, max(0.0, co.z / 0.9))
                l[coll] = (t * g, t * g, t * g, 1)
        self._commit(bm)

    # ---- primitives
    def box(self, key, c, s, rz=0.0, bevel=0.012, grain=None, tilt=None, tint=None):
        """axis box of size s centred at c, rotated rz about Z (and optional tilt Matrix); edges bevelled"""
        bm = self._begin()
        r = bmesh.ops.create_cube(bm, size=1.0)
        vs = r['verts']
        for v in vs:
            v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]))
        if bevel > 0:
            es = list({e for v in vs for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=vs + es, offset=min(bevel, min(s) * 0.3), segments=2, affect='EDGES', profile=0.5)
        M = Matrix.Translation(Vector(c)) @ Matrix.Rotation(rz, 4, 'Z')
        if tilt is not None:
            M = M @ tilt
        for v in bm.verts:
            v.co = M @ v.co
        g = None
        if grain is not None:
            g = (M.to_3x3() @ Vector(grain)).normalized()
        self._finish_faces(bm, key, g, tint)

    def beam(self, key, p0, p1, w, h=None, up=Z, bevel=0.012, tint=None):
        """rectangular member from p0 to p1 (w across, h along `up`); grain along the member"""
        p0, p1 = Vector(p0), Vector(p1)
        h = h or w
        d = p1 - p0
        L = d.length
        x = d.normalized()
        y = up.cross(x)
        if y.length < 1e-4:
            y = Vector((0, 1, 0)).cross(x)
        y.normalize()
        z = x.cross(y).normalized()
        R = Matrix((x, y, z)).transposed().to_4x4()
        bm = self._begin()
        r = bmesh.ops.create_cube(bm, size=1.0)
        vs = r['verts']
        for v in vs:
            v.co = Vector((v.co.x * L, v.co.y * w, v.co.z * h))
        if bevel > 0:
            es = list({e for v in vs for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=vs + es, offset=min(bevel, w * 0.3, h * 0.3), segments=2, affect='EDGES', profile=0.5)
        M = Matrix.Translation((p0 + p1) * 0.5) @ R
        for v in bm.verts:
            v.co = M @ v.co
        self._finish_faces(bm, key, x, tint)

    def cyl(self, key, p0, p1, r0, r1=None, sides=12, cap=True, tint=None, grain=True):
        p0, p1 = Vector(p0), Vector(p1)
        r1 = r0 if r1 is None else r1
        d = (p1 - p0)
        x = d.normalized()
        a = x.orthogonal().normalized()
        b = x.cross(a).normalized()
        bm = self._begin()
        uvl = bm.loops.layers.uv['UVMap']
        rings = []
        for p, r in ((p0, r0), (p1, r1)):
            rings.append([bm.verts.new(p + (a * math.cos(2 * math.pi * k / sides) + b * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)])
        side_faces = []
        for k in range(sides):
            k2 = (k + 1) % sides
            side_faces.append(bm.faces.new((rings[0][k], rings[0][k2], rings[1][k2], rings[1][k])))
        if cap:
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        # cylindrical UVs on the side so the grain wraps cleanly (box UVs on the caps)
        size = self._tile(key)
        circ = 2 * math.pi * max(r0, r1)
        cu = circ / size
        for f in side_faces:
            for l in f.loops:
                rel = l.vert.co - p0
                ang = math.atan2(rel.dot(b), rel.dot(a)) % (2 * math.pi)
                l[uvl].uv = (ang / (2 * math.pi) * cu, rel.dot(x) / size)
            us = [l[uvl].uv.x for l in f.loops]
            if max(us) - min(us) > cu * 0.5:
                for l in f.loops:
                    if l[uvl].uv.x < cu * 0.5:
                        l[uvl].uv.x += cu
        sf = set(side_faces)
        self._finish_faces(bm, key, x if grain else None, tint, uv=False, uv_faces=[f for f in bm.faces if f not in sf])

    def surface(self, key, grid, uvs, thick=0.0, tint=None, close=False, flip=False):
        """a lofted surface from a 2D grid of points [i][j] with UVs in metres. `flip` reverses the winding so
        the front faces the right way; `thick` builds an explicit shell (offset sheet + rims) behind it."""
        bm = self._begin()
        uvl = bm.loops.layers.uv['UVMap']
        ni, nj = len(grid), len(grid[0])
        size = self._tile(key)
        jmax = nj if close else nj - 1

        def sheet(points, back):
            vs = [[bm.verts.new(points[i][j]) for j in range(nj)] for i in range(ni)]
            for i in range(ni - 1):
                for j in range(jmax):
                    j2 = (j + 1) % nj
                    idx = [(i, j), (i + 1, j), (i + 1, j2), (i, j2)]
                    if flip != back:
                        idx.reverse()
                    try:
                        f = bm.faces.new([vs[a][b] for a, b in idx])
                    except ValueError:
                        continue
                    for l, (a, b) in zip(f.loops, idx):
                        u, v = uvs[a][b]
                        if close and b == 0 and j2 == 0:
                            # closing seam: extrapolate from the last two columns so the texture doesn't jump
                            (u1, v1), (u2, v2) = uvs[a][nj - 2], uvs[a][nj - 1]
                            u, v = 2 * u2 - u1, 2 * v2 - v1
                        l[uvl].uv = (u / size, v / size)
            return vs

        top = sheet(grid, False)
        if thick > 0:
            bm.normal_update()
            back = []
            for i in range(ni):
                row = []
                for j in range(nj):
                    n = top[i][j].normal
                    if n.length < 1e-6:
                        n = Vector((0, 0, 1))
                    row.append(top[i][j].co - n * thick)
                back.append(row)
            bot = sheet(back, True)
            # rims along the open borders, each turned to face away from the sheet
            def rim(pairs, inner):
                for ((a0, b0), (a1, b1)), (ia, ib) in zip(pairs, inner):
                    q = [top[a0][b0], top[a1][b1], bot[a1][b1], bot[a0][b0]]
                    try:
                        f = bm.faces.new(q)
                    except ValueError:
                        continue
                    f.normal_update()
                    if f.normal.dot(f.calc_center_median() - top[ia][ib].co) < 0:
                        f.normal_flip()
                    for l in f.loops:
                        co = l.vert.co
                        l[uvl].uv = ((co.x + co.y) / size, co.z / size)
            js = list(range(jmax))
            if ni > 1:
                rim([((0, j), (0, (j + 1) % nj)) for j in js], [(1, j) for j in js])
                rim([((ni - 1, j), (ni - 1, (j + 1) % nj)) for j in js], [(ni - 2, j) for j in js])
            if not close and nj > 1:
                rim([((i, 0), (i + 1, 0)) for i in range(ni - 1)], [(i, 1) for i in range(ni - 1)])
                rim([((i, nj - 1), (i + 1, nj - 1)) for i in range(ni - 1)], [(i, nj - 2) for i in range(ni - 1)])
        self._finish_faces(bm, key, None, tint, uv=False)

    def finish(self):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for k in self.keys:
            me.materials.append(mat(k))
        # weighted normals: bevelled boxes keep flat faces flat and round only their edges
        wn = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
        wn.keep_sharp = True
        wn.weight = 100
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.ops.object.modifier_apply(modifier='wn')
        return ob


# ------------------------------------------------------------------ roofs

def hip_roof(k, key, w, d, wall_z, slope, over, thick, sag=0.0, upturn=0.0, n_long=10, n_short=6, rings=8):
    """hipped roof over a w x d footprint: concentric rectangles from the ridge line out to the eaves.
    UV u runs along the eaves, v down the slope (so thatch / tiles lie the right way on every face)."""
    hw, hd = w / 2, d / 2
    lr = max(0.3, hw - hd)  # ridge half-length (equal slopes on all four sides)
    D = hd + over
    grid, uvs = [], []
    for ri in range(rings + 1):
        t = ri / rings
        dd = D * t
        ex, ey = lr + dd, dd
        # perimeter points (counter-clockwise from the +x,-y corner), corners exact so hips are crisp
        pts = []
        sides = [((ex, -ey), (ex, ey), n_short), ((ex, ey), (-ex, ey), n_long), ((-ex, ey), (-ex, -ey), n_short), ((-ex, -ey), (ex, -ey), n_long)]
        for (ax, ay), (bx, by), n in sides:
            for i in range(n):
                s = i / n
                pts.append((ax + (bx - ax) * s, ay + (by - ay) * s))
        row, urow = [], []
        acc = 0.0
        prev = None
        for (x, y) in pts:
            z = wall_z + slope * (hd - dd) - sag * math.sin(math.pi * t) * t
            # eave corners turn up
            cx = abs(x) / max(ex, 1e-3)
            cy = abs(y) / max(ey, 1e-3) if ey > 1e-3 else 0
            z += upturn * (min(cx, cy) ** 6) * t ** 2
            p = Vector((x, y, z))
            if prev is not None:
                acc += ((p.x - prev.x) ** 2 + (p.y - prev.y) ** 2) ** 0.5 * (D / max(dd, 0.3) if False else 1)
            prev = p
            row.append(p)
            urow.append((acc * (D / max(dd + 0.5, 0.5)) * 0.0 + (x if abs(y) >= ey - 1e-6 else y) , dd * (1 + slope * slope) ** 0.5))
        grid.append(row)
        uvs.append(urow)
    # top surface faces up: grid rows are rings from ridge outwards
    k.surface(key, grid, uvs, thick=thick, close=True)


def gable_roof(k, key, w, d, wall_z, slope, over_eave, over_gable, thick, sag=0.1, upturn=0.18, nx=14, ny=8):
    """gable roof, ridge along x; concave slope (sori) and upturned eave corners"""
    hd = d / 2
    D = hd + over_eave
    X = w / 2 + over_gable
    for side in (-1, 1):
        grid, uvs = [], []
        for j in range(ny + 1):
            t = j / ny
            dd = D * t
            row, urow = [], []
            for i in range(nx + 1):
                x = -X + 2 * X * i / nx
                z = wall_z + slope * (hd - dd) - sag * math.sin(math.pi * t) * 0.5
                z += upturn * (abs(x) / X) ** 6 * t ** 2
                row.append(Vector((x, side * dd, z)))
                urow.append((x, dd * (1 + slope * slope) ** 0.5))
            if side < 0:
                row.reverse()
                urow.reverse()
            grid.append(row)
            uvs.append(urow)
        k.surface(key, grid, uvs, thick=thick, flip=True)
        if key == 'kawara':
            # noki-gawara: a row of round tile ends along the eave, each pointing down the slope
            n_t = max(4, int(2 * X / 0.27))
            for i in range(n_t + 1):
                x = -X + 2 * X * i / n_t
                z = wall_z + slope * (hd - D) + upturn * (abs(x) / X) ** 6
                d = Vector((0, side * 1.0, -slope)).normalized()
                p = Vector((x, side * D, z - 0.02))
                k.cyl('kawara', p - d * 0.1, p + d * 0.035, 0.085, 0.09, sides=8, tint=0.62)
    ridge_z = wall_z + slope * hd
    if key == 'kawara':
        # a rounded ridge cap over the ridge beam
        k.cyl('kawara', (-X + 0.25, 0, ridge_z + 0.27), (X - 0.25, 0, ridge_z + 0.27), 0.17, sides=10, tint=0.55)
    return ridge_z, X


# ------------------------------------------------------------------ buildings

def posts_along(a, b, spacing=1.8):
    n = max(1, round((b - a) / spacing))
    return [a + (b - a) * i / n for i in range(n + 1)]


def minka(name, w=8.0, d=6.0, roof='thatch', burnt=False, seed=1, shoji=True):
    k = Kit(name, seed)
    R = k.rnd
    FL = 0.55
    WH = FL + 2.45
    hw, hd = w / 2, d / 2
    post = 'charred' if burnt else 'post'
    plaster = 'ash_plaster' if burnt else ('plaster' if roof == 'kawara' else 'clay')
    plank = 'charred' if burnt else 'plank'
    xs = posts_along(-hw, hw)
    ys = posts_along(-hd, hd)
    perim = set()
    for x in xs:
        perim.add((x, -hd))
        perim.add((x, hd))
    for y in ys:
        perim.add((-hw, y))
        perim.add((hw, y))
    # foundation stones + posts
    for (x, y) in perim:
        k.box('stone', (x, y, 0.12), (0.42, 0.42, 0.3), rz=R.uniform(-0.3, 0.3), bevel=0.06)
        if burnt and R.random() < 0.25 and abs(x) < hw - 0.1:
            # a post burnt through: a stump
            k.box(post, (x, y, 0.27 + 0.45), (0.17, 0.17, 0.9), grain=(0, 0, 1))
            continue
        lean = Matrix.Rotation(R.uniform(-0.06, 0.06), 4, 'X') if burnt else None
        k.box(post, (x, y, (0.27 + WH) / 2), (0.17, 0.17, WH - 0.27), grain=(0, 0, 1), tilt=lean)
    # floor and sill
    k.box('floor', (0, 0, FL - 0.06), (w - 0.1, d - 0.1, 0.12), grain=(1, 0, 0), bevel=0.01)
    for y in (-hd, hd):
        k.beam(post, (-hw, y, FL - 0.02), (hw, y, FL - 0.02), 0.15, 0.16)
        k.beam(post, (-hw - 0.15, y, WH), (hw + 0.15, y, WH), 0.18, 0.22)  # keta
        k.beam(post, (-hw, y, FL + 1.9), (hw, y, FL + 1.9), 0.1, 0.14)  # nageshi
    for x in (-hw, hw):
        k.beam(post, (x, -hd, FL - 0.02), (x, hd, FL - 0.02), 0.15, 0.16)
        k.beam(post, (x, -hd - 0.15, WH), (x, hd + 0.15, WH), 0.18, 0.22)
        k.beam(post, (x, -hd, FL + 1.9), (x, hd, FL + 1.9), 0.1, 0.14)
    # tie beams across (visible under the eaves, structural for burnt ruins)
    for x in xs[1:-1]:
        k.beam(post, (x, -hd + 0.1, WH - 0.05), (x, hd - 0.1, WH - 0.05), 0.16, 0.2)

    # wall panels between posts
    def wall(p0, p1, front):
        a, b = Vector(p0), Vector(p1)
        L = (b - a).length
        mid = (a + b) / 2
        rz = math.atan2(b.y - a.y, b.x - a.x)
        inner = L - 0.17
        if burnt and R.random() < 0.45:
            # gone: just a charred lower board or nothing
            if R.random() < 0.5:
                k.box(plank, (mid.x, mid.y, FL + 0.3), (inner, 0.05, 0.5), rz=rz, grain=(1, 0, 0))
            return
        door = front and shoji and abs(mid.x) < w * 0.3
        if door and not burnt:
            # sliding doors: wooden lower rail, paper shoji with lattice
            k.box('shutter', (mid.x, mid.y, FL + 0.95), (inner, 0.05, 1.8), rz=rz, grain=(0, 0, 1)) if R.random() < 0.35 else None
            ox, oy = math.cos(rz), math.sin(rz)
            k.box('paper', (mid.x, mid.y, FL + 0.95), (inner, 0.02, 1.75), rz=rz, bevel=0.0)
            nx, nz = 4, 6
            for i in range(1, nx):
                s = -inner / 2 + inner * i / nx
                k.box('cedar', (mid.x + ox * s, mid.y + oy * s, FL + 0.95), (0.025, 0.05, 1.75), rz=rz, bevel=0.004, grain=(0, 0, 1))
            for j in range(0, nz + 1):
                zz = FL + 0.08 + 1.75 * j / nz
                k.box('cedar', (mid.x, mid.y, zz), (inner, 0.05, 0.025 if 0 < j < nz else 0.06), rz=rz, bevel=0.004, grain=(1, 0, 0))
            return
        k.box(plank, (mid.x, mid.y, FL + 0.48), (inner, 0.06, 0.86), rz=rz, grain=(0, 0, 1), bevel=0.006)
        top = WH - 0.12
        k.box(plaster, (mid.x, mid.y, (FL + 0.92 + top) / 2), (inner, 0.08, top - FL - 0.92), rz=rz, bevel=0.01)
        if not front and R.random() < 0.35:
            # small barred window
            k.box('cedar', (mid.x, mid.y, FL + 1.45), (min(0.9, inner * 0.6), 0.1, 0.06), rz=rz, bevel=0.005, grain=(1, 0, 0))
            for i in range(5):
                s = (i - 2) * 0.14
                ox, oy = math.cos(rz), math.sin(rz)
                k.box('cedar', (mid.x + ox * s, mid.y + oy * s, FL + 1.25), (0.035, 0.11, 0.4), rz=rz, bevel=0.004, grain=(0, 0, 1))

    for i in range(len(xs) - 1):
        wall((xs[i], -hd), (xs[i + 1], -hd), True)
        wall((xs[i], hd), (xs[i + 1], hd), False)
    for i in range(len(ys) - 1):
        wall((-hw, ys[i]), (-hw, ys[i + 1]), False)
        wall((hw, ys[i]), (hw, ys[i + 1]), False)

    # engawa veranda along the front
    if not burnt or R.random() < 0.6:
        ev = 'charred' if burnt else 'floor'
        k.box(ev, (0, -hd - 0.5, FL - 0.04), (w + 0.3, 0.9, 0.07), grain=(1, 0, 0), bevel=0.01)
        for x in posts_along(-hw, hw, 2.0):
            k.box('stone', (x, -hd - 0.85, 0.1), (0.25, 0.25, 0.2), bevel=0.04)
            k.box(post, (x, -hd - 0.85, (0.2 + FL) / 2), (0.1, 0.1, FL - 0.2), grain=(0, 0, 1))
        # a stepping stone
        k.box('stone', (R.uniform(-1, 1), -hd - 1.25, 0.12), (0.7, 0.45, 0.24), rz=R.uniform(-0.15, 0.15), bevel=0.06)

    # roof
    if roof == 'thatch':
        if burnt:
            # the thatch burnt away: blackened rafters and a few clumps
            lr = max(0.3, hw - hd)
            ridge = WH + 1.0 * hd
            k.beam('charred', (-lr, 0, ridge), (lr, 0, ridge), 0.16, 0.18)
            for x in posts_along(-hw, hw, 0.9):
                if R.random() < 0.3:
                    continue
                xr = max(-lr, min(lr, x))
                for side in (-1, 1):
                    tip = Vector((x * 1.1, side * (hd + 0.8), WH - 0.8 + R.uniform(-0.2, 0.2)))
                    if R.random() < 0.25:
                        tip.z -= R.uniform(0.6, 1.5)
                    k.beam('charred', (xr, 0, ridge), tip, 0.09, 0.09)
            for _ in range(5):
                # collapsed thatch lying in heaps on the floor
                c = Vector((R.uniform(-hw, hw) * 0.8, R.uniform(-hd, hd) * 0.7, FL + 0.12))
                k.box('ash_thatch', c, (R.uniform(0.8, 1.6), R.uniform(0.6, 1.2), 0.3), rz=R.uniform(0, 3), tilt=Matrix.Rotation(R.uniform(-0.15, 0.15), 4, 'X'), bevel=0.1)
            # fallen beams inside
            for _ in range(3):
                a = Vector((R.uniform(-hw, hw) * 0.8, R.uniform(-hd, hd) * 0.7, FL + 0.1))
                b = a + Vector((R.uniform(-2, 2), R.uniform(-1.5, 1.5), R.uniform(0.4, 1.8)))
                k.beam('charred', a, b, 0.14, 0.14)
        else:
            hip_roof(k, 'thatch', w + 0.3, d + 0.3, WH + 0.1, 0.95, 0.85, 0.5, sag=0.15, upturn=0.0)
            lr = max(0.3, (w - d) / 2)
            ridge = WH + 0.1 + 0.95 * (d + 0.3) / 2
            # ridge cap: a bound log with crossed karasu-odori pieces
            k.cyl('cedar', (-lr - 0.5, 0, ridge + 0.05), (lr + 0.5, 0, ridge + 0.05), 0.22, sides=10)
            for x in posts_along(-lr - 0.3, lr + 0.3, 0.9):
                for s in (-1, 1):
                    k.beam('post', (x, 0, ridge + 0.05), (x, s * 0.45, ridge - 0.25), 0.06, 0.06)
    else:
        th = 0.2
        if burnt:
            ridge_z, X = WH + 0.55 * hd, hw + 0.6
            k.beam('charred', (-X + 0.3, 0, ridge_z), (X - 0.3, 0, ridge_z), 0.18, 0.2)
            for x in posts_along(-hw, hw, 0.8):
                if R.random() < 0.35:
                    continue
                for side in (-1, 1):
                    tip = Vector((x, side * (hd + 0.9), WH - 0.4))
                    if R.random() < 0.3:
                        tip.z -= R.uniform(0.5, 1.6)
                    k.beam('charred', (x, 0, ridge_z), tip, 0.08, 0.08)
            # a surviving patch of tiles on one side
            gable_roof(k, 'kawara', w * 0.45, d, WH + 0.12, 0.55, 0.9, 0.2, th)
        else:
            ridge_z, X = gable_roof(k, 'kawara', w, d, WH + 0.12, 0.55, 0.95, 0.65, th, sag=0.12, upturn=0.2)
            k.box('kawara', (0, 0, ridge_z + 0.12), (2 * X - 0.3, 0.42, 0.3), grain=(1, 0, 0), bevel=0.04, tint=0.7)
            for s in (-1, 1):
                k.box('kawara', (s * (X - 0.15), 0, ridge_z + 0.25), (0.25, 0.5, 0.55), bevel=0.05, tint=0.6)
            # gable triangles with exposed frame
            for s in (-1, 1):
                x = s * hw
                tri = [(x, -hd, WH + 0.1), (x, hd, WH + 0.1), (x, 0, ridge_z - 0.05)]
                bm = k._begin()
                vs = [bm.verts.new(Vector(p)) for p in tri]
                vs2 = [bm.verts.new(Vector(p) - Vector((s * 0.08, 0, 0))) for p in tri]
                bm.faces.new(vs)
                bm.faces.new(vs2[::-1])
                for i in range(3):
                    j = (i + 1) % 3
                    bm.faces.new((vs[j], vs[i], vs2[i], vs2[j]))
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
                k._finish_faces(bm, plaster)
                k.beam('post', (x + s * 0.02, -hd, WH + 0.5), (x + s * 0.02, hd, WH + 0.5), 0.1, 0.14)
                k.beam('post', (x + s * 0.02, 0, WH + 0.1), (x + s * 0.02, 0, ridge_z), 0.12, 0.12)
    return k.finish()


def shrine_hall(name='shrine_hall', seed=5):
    """haiden on a stone platform: vermilion posts, white walls, latticed doors, a deep tiled roof with a
    strong sori, the offering box and a shimenawa rope with paper streamers"""
    k = Kit(name, seed)
    R = k.rnd
    w, d = 9.0, 7.0
    PH = 1.0  # platform height
    hw, hd = w / 2, d / 2
    # platform: stone walls + paved top, steps at the front
    k.box('stone_wall', (0, 0, PH / 2), (w + 3, d + 3, PH), bevel=0.05)
    k.box('stone_tiles', (0, 0, PH + 0.03), (w + 3.1, d + 3.1, 0.08), bevel=0.02)
    for i in range(5):
        h = PH * (i + 1) / 5
        k.box('stone_tiles', (0, -(d + 3) / 2 - 1.6 + i * 0.35, h / 2), (3.6, 0.42, h), bevel=0.02)
    FL = PH + 0.7
    WH = FL + 3.0
    # raised floor + veranda
    k.box('floor', (0, 0, FL - 0.06), (w + 1.6, d + 1.6, 0.12), grain=(1, 0, 0))
    for i in range(3):
        k.box('cedar', (0, -hd - 1.0 - i * 0.3, PH + 0.12 + i * 0.2 + 0.1), (2.6, 0.32, 0.08 + 0.2 * (3 - i)), grain=(1, 0, 0))
    # posts (round, vermilion) on stone bases
    xs = posts_along(-hw, hw, 2.2)
    ys = posts_along(-hd, hd, 2.2)
    for x in xs:
        for y in ys:
            if abs(x) < hw - 0.01 and abs(y) < hd - 0.01:
                continue
            k.cyl('stone', (x, y, PH + 0.05), (x, y, PH + 0.35), 0.32, 0.28, sides=8)
            k.cyl('lacquer_red', (x, y, PH + 0.35), (x, y, WH), 0.17, 0.16, sides=14)
    # outer veranda posts
    for x in posts_along(-hw - 0.8, hw + 0.8, 2.4):
        k.cyl('lacquer_red', (x, -hd - 0.8, PH + 0.2), (x, -hd - 0.8, WH - 0.1), 0.12, sides=12)
    # beams
    for y in (-hd, hd, -hd - 0.8):
        k.beam('lacquer_red', (-hw - 1.0, y, WH), (hw + 1.0, y, WH), 0.2, 0.28)
        k.beam('lacquer_red', (-hw - 0.9, y, FL + 0.6 if y != -hd - 0.8 else FL + 0.9), (hw + 0.9, y, FL + 0.6 if y != -hd - 0.8 else FL + 0.9), 0.12, 0.1)
    for x in (-hw, hw):
        k.beam('lacquer_red', (x, -hd - 1.0, WH), (x, hd + 0.9, WH), 0.2, 0.28)
    # walls: white plaster sides/back, latticed doors in front
    for i in range(len(xs) - 1):
        x0, x1 = xs[i], xs[i + 1]
        mid = (x0 + x1) / 2
        L = x1 - x0 - 0.3
        k.box('plaster', (mid, hd, (FL + WH) / 2), (L, 0.1, WH - FL - 0.2))
        # front: lattice doors (shitomi-do): dark frame + grid
        k.box('lacquer_black', (mid, -hd, (FL + WH - 0.4) / 2), (L, 0.06, WH - FL - 0.5), bevel=0.01)
        for j in range(1, 9):
            zz = FL + (WH - FL - 0.4) * j / 9
            k.box('lacquer_red', (mid, -hd - 0.04, zz), (L, 0.04, 0.035), bevel=0.005, grain=(1, 0, 0))
        for j in range(1, 7):
            xx = x0 + 0.15 + L * j / 7
            k.box('lacquer_red', (xx, -hd - 0.04, (FL + WH - 0.4) / 2), (0.035, 0.04, WH - FL - 0.5), bevel=0.005, grain=(0, 0, 1))
    for i in range(len(ys) - 1):
        y0, y1 = ys[i], ys[i + 1]
        for x in (-hw, hw):
            k.box('plaster', (x, (y0 + y1) / 2, (FL + WH) / 2), (0.1, y1 - y0 - 0.3, WH - FL - 0.2))
    # bracket blocks (tokyo) on the post heads
    for x in xs:
        for y in (-hd, hd):
            k.box('lacquer_black', (x, y, WH + 0.25), (0.42, 0.42, 0.22), bevel=0.02)
    # the roof: deep eaves, strong curve
    ridge_z, X = gable_roof(k, 'kawara', w + 1.2, d + 1.2, WH + 0.45, 0.62, 1.7, 1.2, 0.28, sag=0.35, upturn=0.55, nx=20, ny=12)
    k.box('kawara', (0, 0, ridge_z + 0.2), (2 * X - 0.5, 0.6, 0.45), grain=(1, 0, 0), bevel=0.05, tint=0.6)
    for s in (-1, 1):
        k.box('kawara', (s * (X - 0.3), 0, ridge_z + 0.45), (0.35, 0.7, 0.9), bevel=0.06, tint=0.5)
    # gable boards (hafu)
    for s in (-1, 1):
        # hafu bargeboards just outside the gable ends, following the roof edge
        x = s * (X + 0.05)
        for side in (-1, 1):
            k.beam('lacquer_black', (x, 0, ridge_z + 0.12), (x, side * ((d + 1.2) / 2 + 1.7), WH + 0.45 - 0.62 * ((d + 1.2) / 2 + 1.7) + 0.62 * (d + 1.2) / 2 + 0.06), 0.08, 0.32)
    # gable triangles
    for s in (-1, 1):
        x = s * (w / 2 + 0.6)
        bm = k._begin()
        pts = [(x, -hd - 0.6, WH + 0.4), (x, hd + 0.6, WH + 0.4), (x, 0, ridge_z - 0.1)]
        vs = [bm.verts.new(p) for p in pts]
        vs2 = [bm.verts.new((p[0] - s * 0.1, p[1], p[2])) for p in pts]
        bm.faces.new(vs)
        bm.faces.new(vs2[::-1])
        for i in range(3):
            j = (i + 1) % 3
            bm.faces.new((vs[j], vs[i], vs2[i], vs2[j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        k._finish_faces(bm, 'plaster')
    # offering box + bell rope + shimenawa
    k.box('cedar', (0, -hd - 1.9, PH + 0.45), (1.6, 0.7, 0.75), grain=(1, 0, 0), bevel=0.02)
    for i in range(9):
        k.box('lacquer_black', (-0.7 + i * 0.175, -hd - 1.9, PH + 0.83), (0.05, 0.62, 0.03), bevel=0.005)
    rope = []
    for i in range(17):
        t = i / 16
        x = -2.4 + 4.8 * t
        rope.append(Vector((x, -hd - 0.85, WH - 0.35 - 0.35 * math.sin(math.pi * t) - 0.0)))
    rad = [0.06 + 0.12 * math.sin(math.pi * i / 16) for i in range(17)]
    for i in range(16):
        k.cyl('straw', rope[i], rope[i + 1], rad[i], rad[i + 1], sides=10, cap=False)
    for t in (0.2, 0.4, 0.6, 0.8):
        p = rope[int(t * 16)]
        # shide: zigzag paper
        for z in range(4):
            k.box('paper', (p.x + (0.05 if z % 2 else -0.05), p.y, p.z - 0.25 - z * 0.13), (0.1, 0.01, 0.12), bevel=0.0)
    k.cyl('straw', (0.6, -hd - 1.0, WH - 0.6), (0.6, -hd - 1.6, PH + 1.1), 0.035, sides=8)
    k.cyl('iron', (0.6, -hd - 1.0, WH - 0.5), (0.6, -hd - 1.0, WH - 0.85), 0.22, 0.26, sides=14)
    return k.finish()


def torii(name='torii', h=4.6, span=4.2, seed=3):
    k = Kit(name, seed)
    hs = span / 2
    for s in (-1, 1):
        k.cyl('lacquer_red', (s * hs, 0, 0.6), (s * hs * 0.97, 0, h), 0.24, 0.21, sides=18)
        k.cyl('lacquer_black', (s * hs, 0, -0.2), (s * hs, 0, 0.6), 0.27, 0.27, sides=18)  # kamaki
    # nuki tie beam
    k.beam('lacquer_red', (-hs - 0.55, 0, h - 1.0), (hs + 0.55, 0, h - 1.0), 0.18, 0.32)
    # gakuzuka strut
    k.box('lacquer_red', (0, 0, h - 0.6), (0.24, 0.16, 0.6), bevel=0.01)
    # shimaki + kasagi: curved top beams (lofted with the ends lifting)
    for (key, zb, th, dep, ext) in (('lacquer_red', h - 0.05, 0.28, 0.42, 1.25), ('lacquer_black', h + 0.23, 0.22, 0.52, 1.45)):
        n = 24
        X = hs + ext
        grid, uvs = [], []
        prof = [(-dep / 2, 0), (dep / 2, 0), (dep / 2, th), (-dep / 2, th)]
        for i in range(n + 1):
            x = -X + 2 * X * i / n
            lift = 0.32 * (abs(x) / X) ** 2.6
            row = [Vector((x, py, zb + pz + lift)) for py, pz in prof]
            grid.append(row)
            uvs.append([(x, j * 0.3) for j in range(4)])
        k.surface(key, grid, uvs, close=True, flip=True)
        # end caps
        for i in (0, n):
            bm = k._begin()
            vs = [bm.verts.new(p) for p in grid[i]]
            f = bm.faces.new(vs)
            f.normal_update()
            if f.normal.x * (1 if i == n else -1) < 0:
                f.normal_flip()
            k._finish_faces(bm, key)
    return k.finish()


def lantern(name='lantern_stone', seed=4):
    """kasuga-style stone lantern"""
    k = Kit(name, seed)
    def hexa(r, z0, z1, r1=None, key='stone'):
        r1 = r if r1 is None else r1
        bm = k._begin()
        bot = [bm.verts.new((math.cos(i * math.pi / 3) * r, math.sin(i * math.pi / 3) * r, z0)) for i in range(6)]
        top = [bm.verts.new((math.cos(i * math.pi / 3) * r1, math.sin(i * math.pi / 3) * r1, z1)) for i in range(6)]
        for i in range(6):
            j = (i + 1) % 6
            bm.faces.new((bot[i], bot[j], top[j], top[i]))
        bm.faces.new(list(reversed(bot)))
        bm.faces.new(top)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        k._finish_faces(bm, key, None, 0.9 + k.rnd.random() * 0.1)
    hexa(0.42, 0, 0.18)
    hexa(0.36, 0.18, 0.3, 0.3)
    k.cyl('stone', (0, 0, 0.3), (0, 0, 1.15), 0.13, 0.11, sides=12)
    hexa(0.3, 1.15, 1.32, 0.38)
    # fire box: corner pillars, the opening glows in game (a point light)
    for i in range(6):
        a = i * math.pi / 3
        k.box('stone', (math.cos(a) * 0.24, math.sin(a) * 0.24, 1.55), (0.08, 0.08, 0.45), rz=a, bevel=0.01)
    hexa(0.2, 1.32, 1.36)
    # roof with up-turned corners
    bm = k._begin()
    ring = []
    for i in range(12):
        a = i * math.pi / 6
        corner = i % 2 == 0
        r = 0.55 if corner else 0.47
        ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, 1.8 + (0.08 if corner else 0.0))))
    ring_t = [bm.verts.new((v.co.x, v.co.y, v.co.z + 0.06)) for v in ring]
    apex = bm.verts.new((0, 0, 2.12))
    for i in range(12):
        j = (i + 1) % 12
        bm.faces.new((ring[i], ring[j], ring_t[j], ring_t[i]))
        bm.faces.new((ring_t[i], ring_t[j], apex))
    bm.faces.new(list(reversed(ring)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    k._finish_faces(bm, 'stone', None, 0.85)
    k.cyl('stone', (0, 0, 2.1), (0, 0, 2.2), 0.09, 0.06, sides=10)
    k.cyl('stone', (0, 0, 2.2), (0, 0, 2.34), 0.07, 0.0, sides=10)
    return k.finish()


def stairs(name='stairs_stone', n=10, width=4.0, rise=0.18, run=0.38, seed=6):
    k = Kit(name, seed)
    R = k.rnd
    for i in range(n):
        z = rise * (i + 1)
        y = run * i
        k.box('stone_tiles', (R.uniform(-0.02, 0.02), y + run / 2, z / 2), (width + R.uniform(-0.05, 0.05), run + 0.02, z), rz=R.uniform(-0.01, 0.01), bevel=0.03)
    # side walls following the slope
    L = run * n
    H = rise * n
    for s in (-1, 1):
        x = s * (width / 2 + 0.3)
        pts = [(0, 0), (L + 0.3, 0), (L + 0.3, H + 0.35), (0, 0.35)]
        bm = k._begin()
        a = [bm.verts.new((x - 0.3, p[0], p[1])) for p in pts]
        b = [bm.verts.new((x + 0.3, p[0], p[1])) for p in pts]
        bm.faces.new(a[::-1])
        bm.faces.new(b)
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        k._finish_faces(bm, 'stone_wall')
    return k.finish()


def bridge(name='bridge_arched', L=9.0, W=2.4, rise=0.9, seed=7):
    k = Kit(name, seed)
    R = k.rnd
    n = 26
    def zat(x):
        return 0.6 + rise * (1 - (2 * x / L) ** 2)
    # deck planks across
    for i in range(n):
        x = -L / 2 + L * (i + 0.5) / n
        z = zat(x)
        slope = -8 * rise * x / (L * L)
        k.box('cedar', (x, 0, z), (L / n - 0.02, W, 0.07), tilt=Matrix.Rotation(-math.atan(slope), 4, 'Y'), grain=(0, 1, 0), bevel=0.008)
    # stringers
    for y in (-W / 2 + 0.2, W / 2 - 0.2):
        for i in range(n):
            x0 = -L / 2 + L * i / n
            x1 = -L / 2 + L * (i + 1) / n
            k.beam('post', (x0, y, zat(x0) - 0.14), (x1, y, zat(x1) - 0.14), 0.16, 0.2, bevel=0.0)
    # piers
    for x in (-L * 0.3, 0, L * 0.3):
        for y in (-W / 2 + 0.2, W / 2 - 0.2):
            k.cyl('post', (x, y, -1.5), (x, y, zat(x) - 0.2), 0.12, sides=10)
        k.beam('post', (x, -W / 2 + 0.1, zat(x) - 0.35), (x, W / 2 - 0.1, zat(x) - 0.35), 0.14, 0.14)
    # railings with giboshi caps
    for y in (-W / 2, W / 2):
        xs = posts_along(-L / 2, L / 2, 1.5)
        for x in xs:
            z = zat(x)
            k.box('lacquer_red', (x, y, z + 0.45), (0.13, 0.13, 0.9), grain=(0, 0, 1))
            k.cyl('iron', (x, y, z + 0.9), (x, y, z + 1.08), 0.08, 0.0, sides=10)
        for i in range(len(xs) - 1):
            for hh in (0.4, 0.8):
                k.beam('lacquer_red', (xs[i], y, zat(xs[i]) + hh), (xs[i + 1], y, zat(xs[i + 1]) + hh), 0.07, 0.07)
    return k.finish()


def fence(name='fence_wood', L=4.0, seed=8):
    k = Kit(name, seed)
    R = k.rnd
    for x in (-L / 2, L / 2):
        k.box('post', (x, 0, 0.6), (0.12, 0.12, 1.4), grain=(0, 0, 1))
    for z in (0.35, 0.95):
        k.beam('post', (-L / 2, 0.08, z), (L / 2, 0.08, z), 0.06, 0.1)
    x = -L / 2 + 0.12
    while x < L / 2 - 0.1:
        hgt = R.uniform(1.15, 1.3)
        k.box('plank', (x, 0.13, hgt / 2 - 0.05), (0.13, 0.025, hgt), rz=R.uniform(-0.02, 0.02), grain=(0, 0, 1), bevel=0.004)
        x += 0.15
    return k.finish()


def well(name='well', seed=9):
    k = Kit(name, seed)
    R = k.rnd
    # stone drum
    for ring in range(4):
        for i in range(12):
            a = (i + ring * 0.5) * math.pi * 2 / 12
            k.box('stone', (math.cos(a) * 0.7, math.sin(a) * 0.7, 0.12 + ring * 0.2), (0.24, 0.42, 0.2), rz=a, bevel=0.03)
    k.cyl('lacquer_black', (0, 0, 0.0), (0, 0, 0.55), 0.55, sides=16)  # dark water inside
    for s in (-1, 1):
        k.box('post', (s * 0.85, 0, 1.2), (0.12, 0.12, 2.4), grain=(0, 0, 1))
    k.beam('post', (-1.0, 0, 2.3), (1.0, 0, 2.3), 0.12, 0.12)
    k.cyl('cedar', (-0.2, 0, 2.05), (0.2, 0, 2.05), 0.1, sides=10)
    k.cyl('straw', (0, 0, 2.0), (0, 0, 1.0), 0.012, sides=6)
    k.cyl('cedar', (0, 0, 0.8), (0, 0, 1.05), 0.14, 0.16, sides=12)
    # little roof
    gable_roof(k, 'plank', 2.0, 1.4, 2.35, 0.7, 0.35, 0.2, 0.05, sag=0.0, upturn=0.0, nx=6, ny=4)
    return k.finish()


def hay_rack(name='hay_rack', L=5.0, seed=10, burning=False):
    k = Kit(name, seed)
    R = k.rnd
    for x in posts_along(-L / 2, L / 2, 1.7):
        for s in (-1, 1):
            k.cyl('post', (x, s * 0.3, 0), (x, -s * 0.05, 2.2), 0.05, sides=8)
    for z in (1.2, 1.9):
        k.cyl('post', (-L / 2 - 0.2, 0, z), (L / 2 + 0.2, 0, z), 0.04, sides=8)
        x = -L / 2 + 0.15
        while x < L / 2:
            key = 'ash_thatch' if burning and R.random() < 0.6 else 'straw'
            for s in (-1, 1):
                k.box(key, (x, s * 0.15, z - 0.3), (0.16, 0.12, 0.62), tilt=Matrix.Rotation(s * 0.25, 4, 'X'), bevel=0.04)
            x += 0.18
    return k.finish()


def brazier(name='brazier', seed=11):
    k = Kit(name, seed)
    k.cyl('stone', (0, 0, 0), (0, 0, 0.2), 0.75, 0.7, sides=8)
    k.cyl('stone', (0, 0, 0.2), (0, 0, 0.9), 0.32, 0.26, sides=8)
    # bowl: lofted
    grid, uvs = [], []
    prof = [(0.2, 0.9), (0.55, 0.95), (0.85, 1.15), (0.95, 1.35), (0.88, 1.38), (0.75, 1.2), (0.3, 1.05), (0.0, 1.02)]
    n = 16
    for (r, z) in prof:
        row, urow = [], []
        for i in range(n):
            a = 2 * math.pi * i / n
            row.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
            urow.append((a * 0.9, z))
        grid.append(row)
        uvs.append(urow)
    k.surface('iron', grid, uvs, close=True, flip=True)
    # coals (emissive in game via the ember material)
    for _ in range(14):
        a = k.rnd.uniform(0, 6.28)
        r = k.rnd.uniform(0, 0.55)
        k.box('charred', (math.cos(a) * r, math.sin(a) * r, 1.1), (0.22, 0.18, 0.12), rz=a, bevel=0.04)
    return k.finish()


def dummy(name='dummy', seed=12):
    k = Kit(name, seed)
    k.cyl('post', (0, 0, -0.3), (0, 0, 1.9), 0.06, sides=8)
    k.cyl('straw', (0, 0, 0.75), (0, 0, 1.6), 0.2, 0.17, sides=12)
    k.cyl('straw', (0, 0, 1.6), (0, 0, 1.85), 0.12, 0.1, sides=10)
    k.cyl('post', (-0.55, 0, 1.4), (0.55, 0, 1.4), 0.045, sides=8)
    for z in (0.9, 1.2, 1.5):
        k.cyl('straw', (0, 0, z - 0.02), (0, 0, z + 0.02), 0.215, sides=12)  # bindings
    return k.finish()


def cart(name='cart', seed=13):
    k = Kit(name, seed)
    k.box('plank', (0, 0, 0.7), (1.2, 2.0, 0.08), grain=(0, 1, 0))
    for s in (-1, 1):
        k.box('plank', (s * 0.6, 0, 0.85), (0.05, 2.0, 0.3), grain=(0, 1, 0))
        k.beam('post', (s * 0.45, 1.0, 0.68), (s * 0.4, 2.6, 0.6), 0.07, 0.07)
        # wheel
        cx = s * 0.72
        k.cyl('post', (cx - 0.05 * s, 0, 0.45), (cx + 0.05 * s, 0, 0.45), 0.08, sides=10)
        rim = []
        for i in range(20):
            a = 2 * math.pi * i / 20
            rim.append(Vector((cx, math.cos(a) * 0.45, 0.45 + math.sin(a) * 0.45)))
        for i in range(20):
            k.beam('post', rim[i], rim[(i + 1) % 20], 0.08, 0.06, up=Vector((1, 0, 0)), bevel=0.0)
        for i in range(0, 20, 4):
            k.beam('post', Vector((cx, 0, 0.45)), rim[i], 0.04, 0.04, up=Vector((1, 0, 0)))
    k.beam('post', (-0.75, 0, 0.45), (0.75, 0, 0.45), 0.06, 0.06)
    for i in range(3):
        k.box('straw', (k.rnd.uniform(-0.3, 0.3), k.rnd.uniform(-0.6, 0.6), 0.9), (0.4, 0.6, 0.3), rz=k.rnd.uniform(0, 3), bevel=0.08)
    return k.finish()


def terrace_wall(name='terrace_wall', L=6.0, H=1.6, seed=14):
    """battered dry-stone wall (ishigaki) with a capping course; one segment, place end to end"""
    k = Kit(name, seed)
    batter = 0.25
    nx, nz = 18, 6
    grid, uvs = [], []
    for j in range(nz + 1):
        t = j / nz
        row, urow = [], []
        for i in range(nx + 1):
            x = -L / 2 + L * i / nx
            y = -batter * (1 - t) - 0.0
            z = -0.4 + (H + 0.4) * t
            row.append(Vector((x, y, z)))
            urow.append((x, z))
        grid.append(row)
        uvs.append(urow)
    k.surface('stone_wall', grid, uvs, thick=0.6, flip=True)
    for i in range(int(L / 0.6)):
        x = -L / 2 + 0.3 + i * 0.6
        k.box('stone', (x + k.rnd.uniform(-0.03, 0.03), 0.15, H + 0.08), (0.58, 0.7, 0.2), rz=k.rnd.uniform(-0.05, 0.05), bevel=0.05)
    return k.finish()


def bell_tower(name='bell_tower', seed=16):
    """shoro: four splayed vermilion posts on a stone base, a tiled hip roof and a great bronze bell"""
    k = Kit(name, seed)
    k.box('stone_wall', (0, 0, 0.45), (5.2, 5.2, 0.9), bevel=0.05)
    k.box('stone_tiles', (0, 0, 0.93), (5.3, 5.3, 0.08), bevel=0.02)
    for i in range(3):
        k.box('stone_tiles', (0, -2.6 - 0.35 - i * 0.35, (i + 1) * 0.3 / 2 + 0.0), (2.0, 0.36, 0.9 - i * 0.3), bevel=0.02)
    top = 5.6
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.cyl('stone', (sx * 1.9, sy * 1.9, 0.95), (sx * 1.9, sy * 1.9, 1.25), 0.3, 0.26, sides=8)
            k.cyl('lacquer_red', (sx * 1.9, sy * 1.9, 1.25), (sx * 1.6, sy * 1.6, top), 0.16, 0.14, sides=14)
    for z in (2.2, top - 0.1):
        for a, b in (((-1.9, -1.9), (1.9, -1.9)), ((1.9, -1.9), (1.9, 1.9)), ((1.9, 1.9), (-1.9, 1.9)), ((-1.9, 1.9), (-1.9, -1.9))):
            f = (z - 1.25) / (top - 1.25)
            s0 = 1 - 0.16 * f
            k.beam('lacquer_red', (a[0] * s0, a[1] * s0, z), (b[0] * s0, b[1] * s0, z), 0.14, 0.18)
    k.beam('lacquer_black', (-1.8, 0, top - 0.35), (1.8, 0, top - 0.35), 0.2, 0.24)
    # the bell: a lofted bronze profile
    prof = [(0.0, top - 0.55), (0.25, top - 0.6), (0.55, top - 0.8), (0.62, top - 1.6), (0.68, top - 2.45), (0.75, top - 2.6), (0.7, top - 2.62), (0.55, top - 2.5)]
    grid, uvs = [], []
    n = 20
    for (r, z) in prof:
        row, urow = [], []
        for i in range(n):
            a = 2 * math.pi * i / n
            row.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
            urow.append((a * 0.6, z))
        grid.append(row)
        uvs.append(urow)
    k.surface('iron', grid, uvs, close=True, flip=True)
    k.cyl('iron', (0, 0, top - 0.55), (0, 0, top - 0.35), 0.12, sides=8)
    # the striker log on ropes
    k.cyl('cedar', (-2.2, 0.9, 3.4), (-0.85, 0.9, 3.4), 0.13, sides=10)
    for x in (-1.9, -1.2):
        k.cyl('straw', (x, 0.9, 3.4), (x, 0.9, top - 0.3), 0.02, sides=6)
    hip_roof(k, 'kawara', 5.6, 5.6, top + 0.15, 0.62, 1.1, 0.24, sag=0.25, upturn=0.5)
    k.box('kawara', (0, 0, top + 0.15 + 0.62 * 2.8 + 0.2), (0.6, 0.6, 0.5), bevel=0.05, tint=0.6)
    return k.finish()


def _loft_rings(k, key, rings, flip=True, thick=0.0, tint=None):
    """loft closed cross-section rings [(points), ...] (each ring CCW about the loft direction)"""
    grid, uvs = [], []
    for ring in rings:
        grid.append([Vector(p) for p in ring])
        acc, row = 0.0, []
        for j, p in enumerate(ring):
            if j:
                acc += (Vector(p) - Vector(ring[j - 1])).length
            row.append((acc, Vector(p).x + Vector(p).z))
        uvs.append(row)
    k.surface(key, grid, uvs, close=True, flip=flip, thick=thick, tint=tint)


def _rrect(cx, cy, z, w, d, r, n=3):
    """rounded rectangle ring (CCW seen from +Z) at height z"""
    pts = []
    r = min(r, w / 2 - 1e-3, d / 2 - 1e-3)
    for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ccx, ccy = cx + qx * (w / 2 - r), cy + qy * (d / 2 - r)
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((ccx + math.cos(a) * r, ccy + math.sin(a) * r, z))
    return pts


def anvil(name='anvil', seed=21):
    """a London-pattern smith's anvil on an elm stump, a hammer resting on the face, tongs against the stump"""
    k = Kit(name, seed)
    # the stump: a short log with bark rings and a sawn top
    k.cyl('post', (0, 0, 0), (0, 0, 0.5), 0.34, 0.31, sides=16)
    for z in (0.12, 0.31):
        k.cyl('iron', (0, 0, z), (0, 0, z + 0.035), 0.345 - z * 0.06, sides=16)
    z0 = 0.5
    # body: feet -> waist -> face, lofted from rounded rectangles
    prof = [(0.44, 0.3, 0.0), (0.42, 0.28, 0.045), (0.3, 0.2, 0.08), (0.2, 0.12, 0.15), (0.21, 0.13, 0.2), (0.38, 0.15, 0.25), (0.46, 0.16, 0.3)]
    _loft_rings(k, 'steel', [_rrect(0, 0, z0 + z, w, d, 0.025) for (w, d, z) in prof])
    k.box('steel', (0, 0, z0 + 0.315), (0.47, 0.165, 0.035), bevel=0.008)  # the hardened face
    k.box('steel', (-0.29, 0, z0 + 0.29), (0.13, 0.13, 0.06), bevel=0.012)  # heel
    # the horn: a tapering cone out of the front, its top flush with the face
    rings = []
    for i in range(9):
        t = i / 8
        x = 0.2 + t * 0.32
        r = 0.075 * (1 - t) ** 0.85 + 0.004
        zc = z0 + 0.33 - r - 0.004 - t * t * 0.03
        rings.append([(x, math.cos(2 * math.pi * j / 12) * r, zc + math.sin(2 * math.pi * j / 12) * r) for j in range(12)])
    _loft_rings(k, 'steel', rings)
    # hammer on the face, tongs leaning on the stump
    k.cyl('post', (-0.12, -0.02, z0 + 0.36), (0.18, -0.24, z0 + 0.36), 0.016, sides=8)
    k.box('steel', (-0.14, 0.0, z0 + 0.37), (0.05, 0.13, 0.05), rz=-0.64, bevel=0.008)
    for s in (-1, 1):
        k.cyl('iron', (0.3, -0.25 + s * 0.012, 0.0), (0.34, -0.28 + s * 0.02, 0.55), 0.008, sides=6)
    return k.finish()


def forge_hearth(name='forge_hearth', seed=22):
    """a smith's forge: stone hearth with a glowing coal bed, a clay hood and chimney, leather bellows"""
    k = Kit(name, seed)
    R = k.rnd
    k.box('stone_wall', (0, 0, 0.42), (2.2, 1.5, 0.84), bevel=0.03)
    for y in (-0.62, 0.62):
        k.box('stone', (0, y, 0.9), (2.3, 0.32, 0.13), bevel=0.03)
    for x in (-0.98, 0.98):
        k.box('stone', (x, 0, 0.9), (0.36, 0.95, 0.13), bevel=0.03)
    k.box('charred', (0, 0, 0.86), (1.62, 0.95, 0.06), bevel=0.02)
    for _ in range(22):
        a = R.uniform(0, 6.28)
        k.box('charred', (R.uniform(-0.7, 0.7), R.uniform(-0.38, 0.38), 0.93), (R.uniform(0.08, 0.16), R.uniform(0.07, 0.13), 0.08), rz=a, bevel=0.025)
    # back wall the hood leans on
    k.box('stone_wall', (0, 0.62, 1.75), (2.2, 0.3, 1.8), bevel=0.03)
    # hood: a clay frustum from the hearth up to the flue
    hood = [_rrect(0, 0.08, z, w, d, 0.08) for (w, d, z) in ((2.1, 1.45, 1.75), (1.9, 1.25, 1.95), (1.0, 0.75, 2.8), (0.72, 0.6, 3.1))]
    _loft_rings(k, 'clay', hood, thick=0.05, tint=0.42)  # soot-blackened clay
    k.box('stone_wall', (0, 0.12, 4.0), (0.74, 0.62, 1.8), bevel=0.03)
    k.box('stone', (0, 0.12, 4.95), (0.86, 0.74, 0.12), bevel=0.03)
    for x in (-1.0, 1.0):
        k.cyl('iron', (x, -0.66, 0.96), (x * 1.02, -0.62, 1.76), 0.025, sides=8)
    k.beam('iron', (-1.06, -0.62, 1.76), (1.06, -0.62, 1.76), 0.05, 0.05)
    # bellows on the right: two boards with a leather bag between, the nozzle into the hearth
    bx = 1.75
    for zz in (0.62, 1.02):
        k.box('plank', (bx, 0, zz), (0.55, 0.85, 0.04), bevel=0.01, grain=(0, 1, 0))
    bag = []
    for i in range(7):
        t = i / 6
        z = 0.64 + t * 0.36
        bulge = 0.2 + 0.07 * math.sin(math.pi * t)
        ring = []
        for j in range(14):
            a = 2 * math.pi * j / 14
            ring.append((bx + math.cos(a) * bulge * 1.1, -0.05 + math.sin(a) * bulge * 1.6, z))
        bag.append(ring)
    _loft_rings(k, 'leather', bag)
    k.cyl('iron', (bx - 0.25, 0.2, 0.82), (1.05, 0.2, 0.82), 0.04, 0.03, sides=8)
    k.cyl('post', (bx, 0.4, 1.04), (bx, 1.0, 1.4), 0.025, sides=8)
    # tools on the hearth edge
    k.cyl('iron', (-1.1, -0.7, 0.98), (-0.5, -0.45, 0.98), 0.012, sides=6)
    k.cyl('iron', (-1.1, -0.6, 0.98), (-0.45, -0.38, 0.99), 0.012, sides=6)
    return k.finish()


def barrel(name='barrel', seed=23):
    """a smith's quench tub: staves bound with iron hoops, dark water"""
    k = Kit(name, seed)
    n = 18
    for i in range(n):
        a = 2 * math.pi * i / n
        rows = []
        for t in (0.0, 0.5, 1.0):
            r = 0.36 + 0.05 * math.sin(math.pi * t)
            rows.append((math.cos(a) * r, math.sin(a) * r, t * 0.8))
        for j in range(2):
            k.beam('plank', rows[j], rows[j + 1], 0.125, 0.03, up=Vector((math.cos(a), math.sin(a), 0)), bevel=0.004)
    for z, r in ((0.12, 0.385), (0.68, 0.385)):
        k.cyl('iron', (0, 0, z), (0, 0, z + 0.04), r, sides=n)
    k.cyl('lacquer_black', (0, 0, 0.0), (0, 0, 0.7), 0.35, sides=n)
    return k.finish()


def chain_hang(name='chain_hang', L=3.0, seed=24):
    """a hanging iron chain with a hook (forge rigging, Ren's fetters)"""
    k = Kit(name, seed)
    pitch, lw, ll, rr = 0.075, 0.05, 0.1, 0.011
    n = int(L / pitch)
    for i in range(n):
        zc = -i * pitch
        rot = (i % 2) * math.pi / 2
        path = []
        for j in range(12):
            a = 2 * math.pi * j / 12
            path.append(Vector((math.cos(a) * (lw / 2 - rr), 0, zc + math.sin(a) * (ll / 2 - rr))))
        rings = []
        for j in range(13):
            c = path[j % 12]
            tng = (path[(j + 1) % 12] - path[(j - 1) % 12]).normalized()
            out = Vector((c.x, 0, c.z - zc)).normalized()
            side = tng.cross(out).normalized()
            ring = []
            for m in range(6):
                b = 2 * math.pi * m / 6
                p = c + (out * math.cos(b) + side * math.sin(b)) * rr
                p = Vector((p.x * math.cos(rot), p.x * math.sin(rot), p.z))
                ring.append(p)
            rings.append(ring)
        _loft_rings(k, 'iron', rings)
    # hook
    zc = -n * pitch - 0.04
    pts = [(0, 0, zc), (0, 0, zc - 0.12)] + [(0.06 * math.sin(a), 0, zc - 0.18 - 0.06 * math.cos(a) + 0.06) for a in (0.6, 1.4, 2.2, 3.0, 3.8)]
    for a, b in zip(pts, pts[1:]):
        k.cyl('iron', a, b, 0.016, sides=8)
    return k.finish()


# ------------------------------------------------------------------ the castle (Chapter Five)

def ishigaki(k, cx, cy, w, d, h, batter=0.18, base=0.0, sides=(1, 1, 1, 1), n=10):
    """a battered dry-stone castle base: each face leans in (and curves out at the foot, the
    'fan slope' of Japanese castle walls); sides = which of +y, +x, -y, -x faces to build"""
    hw, hd = w / 2, d / 2
    faces = [((-hw, hd), (hw, hd), (0, 1)), ((hw, hd), (hw, -hd), (1, 0)), ((hw, -hd), (-hw, -hd), (0, -1)), ((-hw, -hd), (-hw, hd), (-1, 0))]
    for on, ((ax, ay), (bx, by), (nx, ny)) in zip(sides, faces):
        if not on:
            continue
        L = math.hypot(bx - ax, by - ay)
        nu = max(4, int(L / 0.8))
        grid, uvs = [], []
        for j in range(n + 1):
            t = j / n
            # the curve: steep at the top, flaring at the foot
            out = h * batter * (1 - t) ** 1.8
            row, urow = [], []
            for i in range(nu + 1):
                s = i / nu
                x = ax + (bx - ax) * s + nx * out
                y = ay + (by - ay) * s + ny * out
                row.append(Vector((cx + x, cy + y, base + h * t)))
                urow.append((s * L, h * t))
            grid.append(row)
            uvs.append(urow)
        k.surface('stone_wall', grid, uvs, thick=0.5)
    k.box('stone', (cx, cy, base + h + 0.08), (w + 0.1, d + 0.1, 0.16), bevel=0.04)


def plaster_storey(k, cx, cy, w, d, z0, z1, windows=True, band=0.45):
    """a white plastered storey with black weatherboarding (shitamiban) on its lower part and barred windows"""
    k.box('plaster', (cx, cy, (z0 + z1) / 2), (w, d, z1 - z0), bevel=0.02)
    zb = z0 + (z1 - z0) * band
    for (sx, sy, L, rz) in ((0, 1, w, 0.0), (0, -1, w, 0.0), (1, 0, d, math.pi / 2), (-1, 0, d, math.pi / 2)):
        px, py = cx + sx * (w / 2 + 0.03), cy + sy * (d / 2 + 0.03)
        nb = max(2, int((zb - z0) / 0.24))
        for i in range(nb):
            z = z0 + (i + 0.5) * (zb - z0) / nb
            k.box('lacquer_black', (px, py, z), (L + 0.06 if rz == 0 else 0.05, 0.05 if rz == 0 else L + 0.06, (zb - z0) / nb + 0.02),
                  tilt=Matrix.Rotation(0.12 * (1 if (sx + sy) > 0 else -1), 4, 'X' if rz == 0 else 'Y'), bevel=0.006, grain=(1, 0, 0) if rz == 0 else (0, 1, 0))
        k.box('lacquer_black', (px, py, zb + 0.05), (L + 0.1 if rz == 0 else 0.08, 0.08 if rz == 0 else L + 0.1, 0.1), bevel=0.01)
        if windows:
            nw = max(1, int(L / 3.2))
            for i in range(nw):
                o = -L / 2 + L * (i + 0.5) / nw
                wx, wy = (px + o, py) if rz == 0 else (px, py + o)
                wz = (zb + z1) / 2 + 0.1
                ww, wh = 1.1, 0.75
                k.box('lacquer_black', (wx, wy, wz), (ww if rz == 0 else 0.06, 0.06 if rz == 0 else ww, wh), bevel=0.01)
                for b in range(5):
                    bo = -ww / 2 + ww * (b + 0.5) / 5
                    bx, by = (wx + bo, wy + sy * 0.05) if rz == 0 else (wx + sx * 0.05, wy + bo)
                    k.box('post', (bx, by, wz), (0.05, 0.05, wh), bevel=0.008, grain=(0, 0, 1))


def castle_wall(name='castle_wall', L=8.0, seed=31):
    """dobei: a plastered earthen wall on a stone base, black boards below, loopholes, a tiled coping roof"""
    k = Kit(name, seed)
    ishigaki(k, 0, 0, L, 1.6, 1.6, batter=0.2, sides=(1, 0, 1, 0))
    z0, z1 = 1.76, 3.7
    k.box('plaster', (0, 0, (z0 + z1) / 2), (L, 0.5, z1 - z0), bevel=0.02)
    for sy in (-1, 1):
        for i in range(4):
            z = z0 + (i + 0.5) * 0.22
            k.box('lacquer_black', (0, sy * 0.28, z), (L, 0.04, 0.24), tilt=Matrix.Rotation(sy * 0.1, 4, 'X'), bevel=0.005, grain=(1, 0, 0))
        k.box('lacquer_black', (0, sy * 0.28, z0 + 0.92), (L, 0.06, 0.07), bevel=0.01)
        # loopholes: alternating triangles and squares
        for i in range(int(L / 1.6)):
            x = -L / 2 + 0.8 + i * 1.6
            if i % 2:
                k.box('lacquer_black', (x, sy * 0.255, z0 + 1.35), (0.22, 0.02, 0.22), bevel=0.0)
            else:
                k.box('lacquer_black', (x, sy * 0.255, z0 + 1.32), (0.2, 0.02, 0.2), rz=0.0, tilt=Matrix.Rotation(math.pi / 4, 4, 'Y'), bevel=0.0)
    gable_roof(k, 'kawara', L, 0.6, z1, 0.55, 0.42, 0.0, 0.06, sag=0.02, upturn=0.0, nx=int(L * 2), ny=3)
    return k.finish()


def castle_gate(name='castle_gate', seed=32):
    """yaguramon: a two-storey gatehouse bridging a passage between stone bastions; heavy doors stand open"""
    k = Kit(name, seed)
    PW = 4.4  # passage width
    BW, BD, BH = 4.2, 7.0, 3.6
    for s in (-1, 1):
        ishigaki(k, s * (PW / 2 + BW / 2), 0, BW, BD, BH, batter=0.16)
    # the passage frame: great posts and a lintel
    for s in (-1, 1):
        for y in (-BD / 2 + 0.4, BD / 2 - 0.4):
            k.box('post', (s * (PW / 2 - 0.2), y, BH / 2 + 0.1), (0.4, 0.4, BH + 0.2), grain=(0, 0, 1), bevel=0.02)
        k.beam('post', (s * (PW / 2 - 0.2), -BD / 2 + 0.4, 0.3), (s * (PW / 2 - 0.2), BD / 2 - 0.4, 0.3), 0.3, 0.3)
    for y in (-BD / 2 + 0.4, BD / 2 - 0.4):
        k.beam('post', (-PW / 2 - 0.3, y, BH + 0.1), (PW / 2 + 0.3, y, BH + 0.1), 0.45, 0.5)
    # the doors, swung open against the passage walls, iron-banded and studded
    for s in (-1, 1):
        cx = s * (PW / 2 - 0.35)
        k.box('plank', (cx, -0.6, 1.6), (0.14, 2.1, 3.1), grain=(0, 0, 1), bevel=0.01)
        for z in (0.5, 1.6, 2.7):
            k.box('iron', (cx - s * 0.08, -0.6, z), (0.03, 2.12, 0.14), bevel=0.005)
            for i in range(7):
                k.cyl('iron', (cx - s * 0.09, -1.55 + i * 0.32, z), (cx - s * 0.13, -1.55 + i * 0.32, z), 0.025, sides=6)
    # the upper storey spans bastions and passage
    W = PW + 2 * BW + 0.4
    plaster_storey(k, 0, 0, W - 0.6, BD - 1.0, BH + 0.4, BH + 3.2)
    k.box('post', (0, 0, BH + 0.35), (W, BD - 0.6, 0.3), bevel=0.02, grain=(1, 0, 0))
    hip_roof(k, 'kawara', W - 0.6, BD - 1.0, BH + 3.25, 0.55, 1.15, 0.22, sag=0.25, upturn=0.45)
    rz = BH + 3.25 + 0.55 * (BD - 1.0) / 2
    k.cyl('kawara', (-(W - BD) / 2 - 0.2, 0, rz + 0.2), ((W - BD) / 2 + 0.2, 0, rz + 0.2), 0.2, sides=10, tint=0.55)
    return k.finish()


def tenshu(name='tenshu', seed=33):
    """the keep: a tall battered stone base and three diminishing plastered storeys under flaring tiled hip
    roofs, chidori gables on the first roof, gold shachihoko on the ridge"""
    k = Kit(name, seed)
    BH = 5.2
    ishigaki(k, 0, 0, 15.0, 12.5, BH, batter=0.2, n=12)
    storeys = [(12.6, 10.2, 3.6, 1.35), (9.6, 7.8, 3.1, 1.1), (6.8, 5.6, 2.8, 0.95)]
    z = BH + 0.16
    for i, (w, d, h, over) in enumerate(storeys):
        plaster_storey(k, 0, 0, w, d, z, z + h, band=0.42 if i == 0 else 0.35)
        k.box('post', (0, 0, z + h + 0.12), (w + 0.4, d + 0.4, 0.24), bevel=0.02, grain=(1, 0, 0))
        hip_roof(k, 'kawara', w, d, z + h + 0.25, 0.55, over, 0.24, sag=0.3, upturn=0.55)
        if i == 0:
            # chidori gables: small triangular gables set into the first roof, front and back
            for sy in (-1, 1):
                gy = sy * (d / 2 - 0.2)
                gz = z + h + 0.25 + 0.55 * 0.2 + 0.05
                grid = [[Vector((-1.6, gy, gz - 0.1)), Vector((1.6, gy, gz - 0.1))], [Vector((-0.02, gy, gz + 1.2)), Vector((0.02, gy, gz + 1.2))]]
                k.surface('plaster', grid, [[(0, 0), (3.2, 0)], [(1.6, 1.3), (1.6, 1.3)]], thick=0.08, flip=sy < 0)
                for s in (-1, 1):
                    k.beam('lacquer_black', (s * 1.9, gy + sy * 0.15, gz - 0.25), (0, gy + sy * 0.15, gz + 1.45), 0.18, 0.28)
        z += h + 0.55 * d / 2 * 0.5
    # the ridge with its golden shachihoko
    w, d, h, _ = storeys[-1]
    top = z - 0.55 * d / 2 * 0.5 + 0.25 + 0.55 * d / 2
    rl = max(0.3, (w - d) / 2)
    k.cyl('kawara', (-rl - 0.3, 0, top + 0.2), (rl + 0.3, 0, top + 0.2), 0.22, sides=10, tint=0.55)
    for s in (-1, 1):
        x = s * (rl + 0.35)
        k.cyl('gold', (x, 0, top + 0.2), (x + s * 0.15, 0, top + 0.95), 0.2, 0.08, sides=10)
        k.cyl('gold', (x + s * 0.15, 0, top + 0.95), (x - s * 0.15, 0, top + 1.35), 0.09, 0.02, sides=8)
    return k.finish()


PIECES = {
    'castle_wall': castle_wall,
    'castle_gate': castle_gate,
    'tenshu': tenshu,
    'anvil': anvil,
    'forge_hearth': forge_hearth,
    'barrel': barrel,
    'chain_hang': chain_hang,
    'bell_tower': bell_tower,
    'minka_thatch': lambda: minka('minka_thatch', 8.0, 6.0, 'thatch', seed=1),
    'minka_thatch_small': lambda: minka('minka_thatch_small', 6.4, 5.2, 'thatch', seed=2),
    'minka_tile': lambda: minka('minka_tile', 7.2, 5.6, 'kawara', seed=3),
    'minka_tile_long': lambda: minka('minka_tile_long', 10.0, 5.6, 'kawara', seed=4),
    'minka_burnt_a': lambda: minka('minka_burnt_a', 8.0, 6.0, 'thatch', burnt=True, seed=5),
    'minka_burnt_b': lambda: minka('minka_burnt_b', 7.2, 5.6, 'kawara', burnt=True, seed=6),
    'shrine_hall': shrine_hall,
    'torii': torii,
    'lantern_stone': lantern,
    'stairs_stone': stairs,
    'bridge_arched': bridge,
    'fence_wood': fence,
    'well': well,
    'hay_rack': hay_rack,
    'hay_rack_burnt': lambda: hay_rack('hay_rack_burnt', burning=True, seed=15),
    'brazier': brazier,
    'dummy': dummy,
    'cart': cart,
    'terrace_wall': terrace_wall,
}


def export(ob, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    charlib.strip_tiling_textures()
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_extras=True,
                              export_vertex_color='NAME', export_vertex_color_name='Col', export_all_vertex_colors=False)
    charlib.pack(path)


def preview(objs, path):
    import trees
    scn = bpy.context.scene
    x = 0
    for o in objs:
        dims = o.dimensions
        o.location.x = x + dims.x / 2
        x += dims.x + 2.0
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scn.collection.objects.link(cam)
    cam.data.lens = 30
    cam.location = (x / 2, -max(22, x * 0.62), 9)
    cam.rotation_euler = (math.radians(76), 0, 0)
    scn.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
    scn.collection.objects.link(sun)
    w = bpy.data.worlds.new('w')
    scn.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.58, 0.7, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    bpy.ops.mesh.primitive_plane_add(size=400)
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 24
    scn.cycles.use_denoising = True
    scn.render.resolution_x = 1800
    scn.render.resolution_y = 700
    for o in objs:
        for m in o.data.materials:
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            b = nt.nodes.get('Principled BSDF')
            if not b.inputs['Base Color'].links:
                continue
            src = b.inputs['Base Color'].links[0].from_node
            out = [o2 for o2 in src.outputs if o2.type == 'RGBA' and o2.enabled] or [src.outputs[0]]
            vc = nt.nodes.new('ShaderNodeVertexColor')
            vc.layer_name = 'Col'
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1
            nt.links.new(out[0], mix.inputs['A'])
            nt.links.new(vc.outputs['Color'], mix.inputs['B'])
            nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    # tiling scale: the material Mapping node takes UVs in tiles already (Kit divides by tile size)
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    prev = None
    if '--preview' in argv:
        prev = argv[argv.index('--preview') + 1]
        argv = [a for a in argv if a not in ('--preview', prev)]
    names = argv or list(PIECES)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    built = []
    for n in names:
        ob = PIECES[n]()
        if prev:
            built.append(ob)
            continue
        export(ob, os.path.join(OUT, f'{n}.glb'))
        bpy.data.objects.remove(ob)
        print('EXPORTED', n)
    if prev:
        preview(built, prev)
        print('PREVIEW', prev)
