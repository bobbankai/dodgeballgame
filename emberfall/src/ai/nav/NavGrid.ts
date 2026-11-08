// The navigation grid: a 2.5D grid over the playable area, sampled from the collision world.
//
// Every column of the grid is probed with downward rays from above the level. Each upward-facing surface the
// rays meet is a candidate layer (a bridge deck and the river bed beneath it, a courtyard under a gate's
// lintel); a layer is walkable when its slope is gentle and it has headroom up to the surface above it.
// Up to `layers` walkable layers are kept per column, so the grid handles bridges, overhangs and thin roofs
// without the voxel machinery of a full navmesh.
//
// Nodes are (column, layer). Links to the eight neighbouring columns are worked out lazily and cached: the
// neighbour layer must be within a step of this one, the straight line between them must be clear at knee
// height (walls, fences, rocks, tree trunks), and diagonals may not cut corners. Tiles of 16 x 16 columns
// are sampled on first use, so a level pays only for the ground its agents actually walk on; warm() spends a
// time budget each frame preparing tiles around agents before they need them.
import * as THREE from 'three';

/** what the grid samples: the collision world (World implements this) */
export interface NavSource {
  /** highest surface below (x, y, z) within maxDrop, or null; `normal` receives that surface's normal */
  ground(x: number, y: number, z: number, maxDrop?: number, normal?: THREE.Vector3): number | null;
  /** distance along a ray to the first hit (`far` when nothing is hit) */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): number;
}

export interface NavConfig {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** metres per cell */
  cell?: number;
  /** cells per tile side */
  tile?: number;
  /** walkable layers kept per column */
  layers?: number;
  /** probes start here (above everything) and give up below `bottom` */
  top?: number;
  bottom?: number;
  /** steepest walkable slope, degrees */
  maxSlope?: number;
  /** largest height change between neighbouring cells an agent can step */
  step?: number;
  /** headroom an agent needs */
  clearance?: number;
  /** playable area test (the level's bounds) */
  inside?: (x: number, z: number) => boolean;
}

/** neighbour offsets, counter-clockwise from +x: E, NE, N, NW, W, SW, S, SE (N = +z) */
export const DIRS: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const OPPOSITE = [4, 5, 6, 7, 0, 1, 2, 3];
const LINK_UNKNOWN = 255;
const LINK_NONE = 254;

interface Tile {
  /** height of each layer (NaN = no layer), [cell * L + layer] */
  heights: Float32Array;
  /** neighbour layer per direction, or LINK_NONE / LINK_UNKNOWN, [(cell * L + layer) * 8 + dir] */
  links: Uint8Array;
  /** blocked links around each node (for the wall-hugging penalty), 255 = not yet counted */
  walls: Uint8Array;
}

export interface NavStats { tiles: number; tilesTotal: number; rays: number; linkTests: number; buildMs: number }

const tmpN = new THREE.Vector3();
const tmpO = new THREE.Vector3();
const tmpD = new THREE.Vector3();

export class NavGrid {
  readonly cell: number;
  readonly tileN: number;
  readonly L: number;
  /** grid size in cells */
  readonly W: number;
  readonly H: number;
  readonly minX: number;
  readonly minZ: number;
  readonly step: number;
  readonly clearance: number;
  private readonly tilesX: number;
  private readonly tilesZ: number;
  private readonly top: number;
  private readonly bottom: number;
  private readonly cosSlope: number;
  private readonly inside: (x: number, z: number) => boolean;
  private readonly tiles: (Tile | null)[];
  /** tiles queued for warming, nearest first */
  private warmQueue: number[] = [];
  private warmSet = new Set<number>();
  readonly stats: NavStats = { tiles: 0, tilesTotal: 0, rays: 0, linkTests: 0, buildMs: 0 };
  /** bumped whenever tiles are dropped (paths computed before may be stale) */
  version = 0;

  constructor(private src: NavSource, c: NavConfig) {
    this.cell = c.cell ?? 0.5;
    this.tileN = c.tile ?? 16;
    this.L = c.layers ?? 3;
    this.minX = c.minX;
    this.minZ = c.minZ;
    this.W = Math.max(1, Math.ceil((c.maxX - c.minX) / this.cell));
    this.H = Math.max(1, Math.ceil((c.maxZ - c.minZ) / this.cell));
    this.tilesX = Math.ceil(this.W / this.tileN);
    this.tilesZ = Math.ceil(this.H / this.tileN);
    this.top = c.top ?? 200;
    this.bottom = c.bottom ?? -50;
    this.cosSlope = Math.cos(THREE.MathUtils.degToRad(c.maxSlope ?? 46));
    this.step = c.step ?? 0.5;
    this.clearance = c.clearance ?? 1.7;
    this.inside = c.inside ?? (() => true);
    this.tiles = new Array(this.tilesX * this.tilesZ).fill(null);
    this.stats.tilesTotal = this.tiles.length;
  }

  // ------------------------------------------------------------------ ids and coordinates
  /** node id of a column and layer */
  id(ix: number, iz: number, layer: number): number { return (iz * this.W + ix) * this.L + layer; }
  ixOf(id: number): number { return Math.floor(id / this.L) % this.W; }
  izOf(id: number): number { return Math.floor(Math.floor(id / this.L) / this.W); }
  layerOf(id: number): number { return id % this.L; }
  inGrid(ix: number, iz: number): boolean { return ix >= 0 && iz >= 0 && ix < this.W && iz < this.H; }
  /** column containing a world position (may be outside the grid) */
  colX(x: number): number { return Math.floor((x - this.minX) / this.cell); }
  colZ(z: number): number { return Math.floor((z - this.minZ) / this.cell); }
  /** world x / z of a column's centre */
  cx(ix: number): number { return this.minX + (ix + 0.5) * this.cell; }
  cz(iz: number): number { return this.minZ + (iz + 0.5) * this.cell; }
  /** total node id space (for searches sizing their arrays) */
  get nodeCount(): number { return this.W * this.H * this.L; }

  private tileIndex(ix: number, iz: number): number {
    return Math.floor(iz / this.tileN) * this.tilesX + Math.floor(ix / this.tileN);
  }

  private local(ix: number, iz: number): number {
    return (iz % this.tileN) * this.tileN + (ix % this.tileN);
  }

  /** the tile holding a column, sampled now if it never was */
  private tileOf(ix: number, iz: number): Tile {
    const ti = this.tileIndex(ix, iz);
    return this.tiles[ti] ?? this.buildTile(ti);
  }

  isBuilt(ix: number, iz: number): boolean { return !!this.tiles[this.tileIndex(ix, iz)]; }

  // ------------------------------------------------------------------ sampling
  private buildTile(ti: number): Tile {
    const t0 = performance.now();
    const T = this.tileN, L = this.L;
    const tile: Tile = {
      heights: new Float32Array(T * T * L).fill(NaN),
      links: new Uint8Array(T * T * L * 8).fill(LINK_UNKNOWN),
      walls: new Uint8Array(T * T * L).fill(255),
    };
    const tx = ti % this.tilesX, tz = Math.floor(ti / this.tilesX);
    const hits: { h: number; up: boolean; ny: number }[] = [];
    for (let lz = 0; lz < T; lz++) {
      for (let lx = 0; lx < T; lx++) {
        const ix = tx * T + lx, iz = tz * T + lz;
        if (!this.inGrid(ix, iz)) continue;
        const x = this.cx(ix), z = this.cz(iz);
        if (!this.inside(x, z)) continue;
        // probe downwards through every surface in the column
        hits.length = 0;
        let y = this.top;
        for (let k = 0; k < 8 && y > this.bottom; k++) {
          this.stats.rays++;
          const h = this.src.ground(x, y, z, y - this.bottom, tmpN);
          if (h === null) break;
          hits.push({ h, up: tmpN.y > 0, ny: Math.abs(tmpN.y) });
          y = h - 0.03;
        }
        let n = 0;
        for (let i = 0; i < hits.length && n < L; i++) {
          const s = hits[i];
          if (!s.up || s.ny < this.cosSlope) continue;
          // headroom: the nearest surface above this one (any orientation)
          const above = i > 0 ? hits[i - 1].h : Infinity;
          if (above - s.h < this.clearance) continue;
          tile.heights[this.local(ix, iz) * L + n] = s.h;
          n++;
        }
      }
    }
    this.tiles[ti] = tile;
    this.stats.tiles++;
    this.stats.buildMs += performance.now() - t0;
    return tile;
  }

  /** layer heights of a column (NaN where there is no layer) */
  heightOf(ix: number, iz: number, layer: number): number {
    if (!this.inGrid(ix, iz)) return NaN;
    return this.tileOf(ix, iz).heights[this.local(ix, iz) * this.L + layer];
  }

  walkable(id: number): boolean {
    const ix = this.ixOf(id), iz = this.izOf(id);
    return !Number.isNaN(this.heightOf(ix, iz, this.layerOf(id)));
  }

  /** world position of a node's centre */
  pos(id: number, out = new THREE.Vector3()): THREE.Vector3 {
    const ix = this.ixOf(id), iz = this.izOf(id);
    return out.set(this.cx(ix), this.heightOf(ix, iz, this.layerOf(id)), this.cz(iz));
  }

  /** the walkable layer of a column nearest to height y (within tol), or -1 */
  layerNear(ix: number, iz: number, y: number, tol: number): number {
    if (!this.inGrid(ix, iz)) return -1;
    const t = this.tileOf(ix, iz);
    const base = this.local(ix, iz) * this.L;
    let best = -1, bd = tol;
    for (let l = 0; l < this.L; l++) {
      const h = t.heights[base + l];
      if (Number.isNaN(h)) continue;
      const d = Math.abs(h - y);
      if (d <= bd) { bd = d; best = l; }
    }
    return best;
  }

  /**
   * the node an agent standing at `p` is on: the layer nearest its feet in its own column, else the nearest
   * walkable node within `search` cells (agents brushing a wall stand over unwalkable columns)
   */
  nodeAt(p: THREE.Vector3, search = 4, tol = 1.6): number {
    const ix = this.colX(p.x), iz = this.colZ(p.z);
    const l = this.layerNear(ix, iz, p.y, tol);
    if (l >= 0) return this.id(ix, iz, l);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= search; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const jx = ix + dx, jz = iz + dz;
          const lj = this.layerNear(jx, jz, p.y, tol);
          if (lj < 0) continue;
          const ddx = this.cx(jx) - p.x, ddz = this.cz(jz) - p.z, ddy = this.heightOf(jx, jz, lj) - p.y;
          const d = ddx * ddx + ddz * ddz + ddy * ddy * 0.25;
          if (d < bd) { bd = d; best = this.id(jx, jz, lj); }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // ------------------------------------------------------------------ links
  /** the neighbour node in direction d, or -1 when the way is blocked */
  neighbor(id: number, d: number): number {
    const ix = this.ixOf(id), iz = this.izOf(id), l = this.layerOf(id);
    const t = this.tileOf(ix, iz);
    const li = (this.local(ix, iz) * this.L + l) * 8 + d;
    let v = t.links[li];
    if (v === LINK_UNKNOWN) {
      v = this.testLink(ix, iz, l, d);
      t.links[li] = v;
      // links are symmetric: store the way back too
      if (v !== LINK_NONE) {
        const jx = ix + DIRS[d][0], jz = iz + DIRS[d][1];
        const tj = this.tileOf(jx, jz);
        tj.links[(this.local(jx, jz) * this.L + v) * 8 + OPPOSITE[d]] = l;
      }
    }
    if (v === LINK_NONE) return -1;
    return this.id(ix + DIRS[d][0], iz + DIRS[d][1], v);
  }

  private testLink(ix: number, iz: number, l: number, d: number): number {
    this.stats.linkTests++;
    const ha = this.heightOf(ix, iz, l);
    if (Number.isNaN(ha)) return LINK_NONE;
    const dx = DIRS[d][0], dz = DIRS[d][1];
    const jx = ix + dx, jz = iz + dz;
    if (!this.inGrid(jx, jz)) return LINK_NONE;
    const lb = this.layerNear(jx, jz, ha, this.step * (dx && dz ? 1.414 : 1));
    if (lb < 0) return LINK_NONE;
    const hb = this.heightOf(jx, jz, lb);
    // diagonals may not squeeze between two blocked orthogonals (no corner cutting)
    if (dx !== 0 && dz !== 0) {
      if (this.neighbor(this.id(ix, iz, l), dx > 0 ? 0 : 4) < 0) return LINK_NONE;
      if (this.neighbor(this.id(ix, iz, l), dz > 0 ? 2 : 6) < 0) return LINK_NONE;
    }
    // the straight line between the two cell centres must be clear at knee height
    const knee = this.step + 0.2;
    tmpO.set(this.cx(ix), ha + knee, this.cz(iz));
    tmpD.set(this.cx(jx), hb + knee, this.cz(jz)).sub(tmpO);
    const len = tmpD.length();
    tmpD.divideScalar(len);
    this.stats.rays++;
    if (this.src.raycast(tmpO, tmpD, len) < len - 1e-3) return LINK_NONE;
    return lb;
  }

  /** how many of a node's eight links are blocked (0..8): open ground is 0, a corridor 4 or more */
  wallCount(id: number): number {
    const ix = this.ixOf(id), iz = this.izOf(id), l = this.layerOf(id);
    const t = this.tileOf(ix, iz);
    const wi = this.local(ix, iz) * this.L + l;
    let w = t.walls[wi];
    if (w === 255) {
      w = 0;
      for (let d = 0; d < 8; d++) if (this.neighbor(id, d) < 0) w++;
      t.walls[wi] = w;
    }
    return w;
  }

  /** cost of stepping from a node in direction d (Euclidean in the plane plus a climb term) */
  stepCost(a: number, b: number, d: number): number {
    const base = (d & 1 ? Math.SQRT2 : 1) * this.cell;
    const ha = this.heightOf(this.ixOf(a), this.izOf(a), this.layerOf(a));
    const hb = this.heightOf(this.ixOf(b), this.izOf(b), this.layerOf(b));
    return base + Math.abs(hb - ha) * 0.6;
  }

  // ------------------------------------------------------------------ line of sight over the grid
  /**
   * can an agent walk straight from node a to the world point (x, z)? Walks the columns the segment crosses
   * (a supercover traversal, so no corner is skipped) and follows links column to column, so the answer
   * respects steps, walls and layers. Returns the node reached at the end, or -1 when the way is blocked.
   */
  walkLine(a: number, x1: number, z1: number, maxCells = 512, fromX?: number, fromZ?: number): number {
    let ix = this.ixOf(a), iz = this.izOf(a);
    let node = a;
    // the line starts at the given point inside the start column (its centre by default)
    const x0 = fromX ?? this.cx(ix), z0 = fromZ ?? this.cz(iz);
    const ex = this.colX(x1), ez = this.colZ(z1);
    const dx = x1 - x0, dz = z1 - z0;
    const sx = Math.sign(dx), sz = Math.sign(dz);
    const tdx = sx !== 0 ? this.cell / Math.abs(dx) : Infinity;
    const tdz = sz !== 0 ? this.cell / Math.abs(dz) : Infinity;
    // parametric distance to the first column boundary in each axis
    let tmx = sx !== 0 ? (this.minX + (sx > 0 ? ix + 1 : ix) * this.cell - x0) / dx : Infinity;
    let tmz = sz !== 0 ? (this.minZ + (sz > 0 ? iz + 1 : iz) * this.cell - z0) / dz : Infinity;
    for (let n = 0; n < maxCells; n++) {
      // in the end column, or the next boundary lies beyond the end point (an end exactly on a cell
      // corner would otherwise be stepped over diagonally)
      if ((ix === ex && iz === ez) || Math.min(tmx, tmz) >= 1) return node;
      let d: number;
      if (Math.abs(tmx - tmz) < 1e-9) {
        // exactly through a corner: both orthogonal neighbours must be passable
        const dX = sx > 0 ? 0 : 4, dZ = sz > 0 ? 2 : 6;
        if (this.neighbor(node, dX) < 0 || this.neighbor(node, dZ) < 0) return -1;
        d = DIRS.findIndex(([a1, b1]) => a1 === sx && b1 === sz);
        tmx += tdx;
        tmz += tdz;
      } else if (tmx < tmz) {
        d = sx > 0 ? 0 : 4;
        tmx += tdx;
      } else {
        d = sz > 0 ? 2 : 6;
        tmz += tdz;
      }
      const nb = this.neighbor(node, d);
      if (nb < 0) return -1;
      node = nb;
      ix += DIRS[d][0];
      iz += DIRS[d][1];
    }
    return -1;
  }

  // ------------------------------------------------------------------ warming and invalidation
  /** queue the tiles within `radius` metres of p for background sampling */
  want(p: THREE.Vector3, radius: number): void {
    const r = Math.ceil(radius / (this.cell * this.tileN));
    const tx0 = Math.floor(this.colX(p.x) / this.tileN), tz0 = Math.floor(this.colZ(p.z) / this.tileN);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = tx0 + dx, tz = tz0 + dz;
        if (tx < 0 || tz < 0 || tx >= this.tilesX || tz >= this.tilesZ) continue;
        const ti = tz * this.tilesX + tx;
        if (this.tiles[ti] || this.warmSet.has(ti)) continue;
        this.warmSet.add(ti);
        this.warmQueue.push(ti);
      }
    }
  }

  /** sample queued tiles for up to `ms` milliseconds; returns how many remain */
  warm(ms: number): number {
    const end = performance.now() + ms;
    while (this.warmQueue.length && performance.now() < end) {
      const ti = this.warmQueue.shift()!;
      this.warmSet.delete(ti);
      if (!this.tiles[ti]) this.buildTile(ti);
    }
    return this.warmQueue.length;
  }

  /** forget the tiles overlapping a box (something moved: a gate opened, a bridge fell) */
  invalidate(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const t0x = Math.max(0, Math.floor(this.colX(minX) / this.tileN) - 1), t1x = Math.min(this.tilesX - 1, Math.floor(this.colX(maxX) / this.tileN) + 1);
    const t0z = Math.max(0, Math.floor(this.colZ(minZ) / this.tileN) - 1), t1z = Math.min(this.tilesZ - 1, Math.floor(this.colZ(maxZ) / this.tileN) + 1);
    for (let tz = t0z; tz <= t1z; tz++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const ti = tz * this.tilesX + tx;
        if (this.tiles[ti]) { this.tiles[ti] = null; this.stats.tiles--; }
      }
    }
    this.version++;
  }

  /** every built node (for debug drawing) */
  forEachBuilt(cb: (id: number, x: number, y: number, z: number) => void): void {
    const T = this.tileN;
    for (let ti = 0; ti < this.tiles.length; ti++) {
      const t = this.tiles[ti];
      if (!t) continue;
      const tx = ti % this.tilesX, tz = Math.floor(ti / this.tilesX);
      for (let lz = 0; lz < T; lz++) {
        for (let lx = 0; lx < T; lx++) {
          const ix = tx * T + lx, iz = tz * T + lz;
          if (!this.inGrid(ix, iz)) continue;
          for (let l = 0; l < this.L; l++) {
            const h = t.heights[(lz * T + lx) * this.L + l];
            if (!Number.isNaN(h)) cb(this.id(ix, iz, l), this.cx(ix), h, this.cz(iz));
          }
        }
      }
    }
  }
}

/** point in polygon (even-odd), polygon in the x / z plane as Vector2(x, z) */
export function pointInPolygon(x: number, z: number, poly: readonly THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** distance from a point to the polygon's boundary */
export function distanceToPolygon(x: number, z: number, poly: readonly THREE.Vector2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ex = b.x - a.x, ez = b.y - a.y;
    const L = ex * ex + ez * ez;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.y) * ez) / L)) : 0;
    const px = a.x + ex * t - x, pz = a.y + ez * t - z;
    best = Math.min(best, Math.hypot(px, pz));
  }
  return best;
}
