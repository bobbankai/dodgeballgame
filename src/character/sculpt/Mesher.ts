import { evalList, evalOwner, len3, Op, Prim } from './Sdf';

/**
 * Surface-nets mesher for the SDF clay.
 *
 * A coarse pass finds the band around the surface, the fine grid is only evaluated inside it,
 * vertices are projected onto the true surface (Newton steps) and shaded with the analytic
 * field gradient, so even modest grids give smooth, sculpted-looking results.
 * Per vertex it also bakes: palette slot, 4 skin weights, ambient occlusion and curvature.
 * Triangles that straddle two palette slots are cut along the exact boundary, so trims,
 * hairlines and panels get clean edges instead of a per-vertex staircase.
 */

export interface MeshPart {
  prims: Prim[];
  /** fine cell size in metres */
  cell: number;
  /** bone-weight falloff between neighbouring primitives (metres) */
  sigma?: number;
  /** extra shapes that occlude this part (for AO only) */
  aoContext?: Prim[][];
  /** override the slot after the owning primitive is found */
  paint?: (slot: number, x: number, y: number, z: number, owner: Prim | null) => number;
  /** cut triangles along slot boundaries (default); off for far-away meshes drawn with flat slots */
  splitSlots?: boolean;
  /** surface flow direction (hair strands) at a vertex; null = none */
  flow?: (x: number, y: number, z: number, nx: number, ny: number, nz: number, owner: Prim | null) => [number, number, number] | null;
}

export class MeshOut {
  pos: number[] = [];
  nrm: number[] = [];
  slot: number[] = [];
  skinIdx: number[] = [];
  skinW: number[] = [];
  detail: number[] = []; // ao, curvature
  flow: number[] = []; // unit strand direction (hair), zero elsewhere
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  /** Typed-array form (transferable from a worker, cheap to merge). */
  pack(): PackedMesh {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      slot: new Float32Array(this.slot),
      detail: new Float32Array(this.detail),
      flow: Int8Array.from(this.flow, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 127)),
      skinIdx: new Uint16Array(this.skinIdx),
      skinW: new Float32Array(this.skinW),
      idx: new Uint32Array(this.idx),
    };
  }
}

export interface PackedMesh {
  pos: Float32Array;
  nrm: Float32Array;
  slot: Float32Array;
  detail: Float32Array;
  flow: Int8Array;
  skinIdx: Uint16Array;
  skinW: Float32Array;
  idx: Uint32Array;
}

export function packedBuffers(p: PackedMesh): ArrayBuffer[] {
  return [p.pos, p.nrm, p.slot, p.detail, p.flow, p.skinIdx, p.skinW, p.idx].map((a) => a.buffer as ArrayBuffer);
}

const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const C = 4; // coarse factor
/** reach of the AO rays; the pruned primitive lists stay exact within this distance of the surface */
const AO_REACH = 0.056;
const AO_STEPS = [0.01, 0.022, 0.036, 0.052];
// tetrahedral stencil: gradient, value and Laplacian from four samples
const TK = [1, -1, -1, -1, -1, 1, -1, 1, -1, 1, 1, 1];

export function meshPart(part: MeshPart, out: MeshOut) {
  const prims = part.prims;
  for (const p of prims) p.finalize();
  const ctx = part.aoContext ?? [];
  for (const l of ctx) for (const p of l) p.finalize();
  const h = part.cell;

  // ------------------------------------------------ bounds
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of prims) {
    if (p.op !== Op.Union || p.br > 1e8) continue;
    minX = Math.min(minX, p.bcx - p.br);
    minY = Math.min(minY, p.bcy - p.br);
    minZ = Math.min(minZ, p.bcz - p.br);
    maxX = Math.max(maxX, p.bcx + p.br);
    maxY = Math.max(maxY, p.bcy + p.br);
    maxZ = Math.max(maxZ, p.bcz + p.br);
  }
  const pad = h * 2;
  minX -= pad;
  minY -= pad;
  minZ -= pad;
  maxX += pad;
  maxY += pad;
  maxZ += pad;

  // ------------------------------------------------ spatial pruning
  // Blocks of space each keep only the primitives that can matter within `margin` of them;
  // everything else is provably too far to change the field near the surface.
  const band = h * C * 1.25;
  const margin = Math.max(band + h, AO_REACH);
  const BS = h * C * 2;
  const bx0 = minX - AO_REACH, by0 = minY - AO_REACH, bz0 = minZ - AO_REACH;
  const bnx = Math.ceil((maxX - minX + 2 * AO_REACH) / BS);
  const bny = Math.ceil((maxY - minY + 2 * AO_REACH) / BS);
  const bnz = Math.ceil((maxZ - minZ + 2 * AO_REACH) / BS);
  const rb = (BS * Math.sqrt(3)) / 2;
  const prune = (list: Prim[], cx: number, cy: number, cz: number): Prim[] => {
    const res: Prim[] = [];
    for (const p of list) {
      if (p.op === Op.Intersect || p.br > 1e8) {
        res.push(p);
        continue;
      }
      const lb = len3(cx - p.bcx, cy - p.bcy, cz - p.bcz) - p.br - rb;
      if (lb <= margin + p.k) res.push(p);
    }
    return res;
  };
  const nb = bnx * bny * bnz;
  const blockLists: (Prim[] | undefined)[] = new Array(nb);
  const blockCtx: (Prim[][] | undefined)[] = new Array(nb);
  const blockOf = (x: number, y: number, z: number) => {
    let i = Math.floor((x - bx0) / BS), j = Math.floor((y - by0) / BS), k = Math.floor((z - bz0) / BS);
    i = i < 0 ? 0 : i >= bnx ? bnx - 1 : i;
    j = j < 0 ? 0 : j >= bny ? bny - 1 : j;
    k = k < 0 ? 0 : k >= bnz ? bnz - 1 : k;
    return i + bnx * (j + bny * k);
  };
  const blockCentre = (b: number, o: number[]) => {
    const i = b % bnx, j = Math.floor(b / bnx) % bny, k = Math.floor(b / (bnx * bny));
    o[0] = bx0 + (i + 0.5) * BS;
    o[1] = by0 + (j + 0.5) * BS;
    o[2] = bz0 + (k + 0.5) * BS;
  };
  const tmpC = [0, 0, 0];
  const listAt = (x: number, y: number, z: number): Prim[] => {
    const b = blockOf(x, y, z);
    let l = blockLists[b];
    if (!l) {
      blockCentre(b, tmpC);
      l = blockLists[b] = prune(prims, tmpC[0], tmpC[1], tmpC[2]);
    }
    return l;
  };
  const ctxAt = (x: number, y: number, z: number): Prim[][] => {
    const b = blockOf(x, y, z);
    let l = blockCtx[b];
    if (!l) {
      blockCentre(b, tmpC);
      l = blockCtx[b] = ctx.map((c) => prune(c, tmpC[0], tmpC[1], tmpC[2]));
    }
    return l;
  };
  const field = (x: number, y: number, z: number) => evalList(listAt(x, y, z), x, y, z);

  // ------------------------------------------------ grid
  const ncx = Math.ceil((maxX - minX) / (h * C));
  const ncy = Math.ceil((maxY - minY) / (h * C));
  const ncz = Math.ceil((maxZ - minZ) / (h * C));
  const nx = ncx * C + 1, ny = ncy * C + 1, nz = ncz * C + 1;
  const vals = new Float32Array(nx * ny * nz).fill(NaN);
  const I = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const X = (i: number) => minX + i * h;
  const Y = (j: number) => minY + j * h;
  const Z = (k: number) => minZ + k * h;
  const at = (i: number, j: number, k: number) => {
    const id = I(i, j, k);
    let v = vals[id];
    if (v !== v) {
      v = field(X(i), Y(j), Z(k));
      vals[id] = v;
    }
    return v;
  };

  // coarse pass → active coarse cells
  const active: number[] = [];
  for (let ck = 0; ck < ncz; ck++)
    for (let cj = 0; cj < ncy; cj++)
      for (let ci = 0; ci < ncx; ci++) {
        let neg = false, pos = false, minAbs = Infinity;
        for (let c = 0; c < 8; c++) {
          const v = at((ci + (c & 1)) * C, (cj + ((c >> 1) & 1)) * C, (ck + ((c >> 2) & 1)) * C);
          if (v < 0) neg = true;
          else pos = true;
          const a = v < 0 ? -v : v;
          if (a < minAbs) minAbs = a;
        }
        if ((neg && pos) || minAbs < band) active.push(ci, cj, ck);
      }

  // fine cells → vertices
  const cnx = nx - 1, cny = ny - 1;
  const cellVert = new Int32Array(cnx * cny * (nz - 1)).fill(-1);
  const CI = (i: number, j: number, k: number) => i + cnx * (j + cny * k);
  const vpos: number[] = [];
  const cv = new Float64Array(8);
  const cellsWithVerts: number[] = [];
  for (let a = 0; a < active.length; a += 3) {
    const i0 = active[a] * C, j0 = active[a + 1] * C, k0 = active[a + 2] * C;
    for (let k = k0; k < k0 + C; k++)
      for (let j = j0; j < j0 + C; j++)
        for (let i = i0; i < i0 + C; i++) {
          let mask = 0;
          for (let c = 0; c < 8; c++) {
            const v = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
            cv[c] = v;
            if (v < 0) mask |= 1 << c;
          }
          if (mask === 0 || mask === 255) continue;
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (const [e0, e1] of EDGES) {
            const a0 = cv[e0], a1 = cv[e1];
            if (a0 < 0 === a1 < 0) continue;
            const t = a0 / (a0 - a1);
            sx += (e0 & 1) + ((e1 & 1) - (e0 & 1)) * t;
            sy += ((e0 >> 1) & 1) + (((e1 >> 1) & 1) - ((e0 >> 1) & 1)) * t;
            sz += ((e0 >> 2) & 1) + (((e1 >> 2) & 1) - ((e0 >> 2) & 1)) * t;
            n++;
          }
          cellVert[CI(i, j, k)] = vpos.length / 3;
          cellsWithVerts.push(i, j, k);
          vpos.push(X(i) + (sx / n) * h, Y(j) + (sy / n) * h, Z(k) + (sz / n) * h);
        }
  }

  // ------------------------------------------------ project onto the surface, shade with the gradient
  const nv = vpos.length / 3;
  const normals = new Float32Array(nv * 3);
  const curv = new Float32Array(nv);
  const eps = h * 0.3;
  const ce = Math.max(h, 0.004) * 0.6;
  const g = [0, 0, 0, 0]; // normal xyz, value
  /** tetrahedral samples: unit gradient into g[0..2], mean value into g[3]; returns the sample sum */
  const tetra = (x: number, y: number, z: number, e: number, list: Prim[]) => {
    let gx = 0, gy = 0, gz = 0, s = 0;
    for (let q = 0; q < 12; q += 3) {
      const f = evalList(list, x + TK[q] * e, y + TK[q + 1] * e, z + TK[q + 2] * e);
      gx += TK[q] * f;
      gy += TK[q + 1] * f;
      gz += TK[q + 2] * f;
      s += f;
    }
    const l = len3(gx, gy, gz) || 1;
    g[0] = gx / l;
    g[1] = gy / l;
    g[2] = gz / l;
    g[3] = s / 4;
    return s;
  };
  for (let v = 0; v < nv; v++) {
    let x = vpos[v * 3], y = vpos[v * 3 + 1], z = vpos[v * 3 + 2];
    const x0 = x, y0 = y, z0 = z;
    const list = listAt(x, y, z);
    for (let it = 0; it < 2; it++) {
      tetra(x, y, z, eps, list);
      x -= g[0] * g[3];
      y -= g[1] * g[3];
      z -= g[2] * g[3];
    }
    // stay near the original cell so thin features don't collapse
    const dx = x - x0, dy = y - y0, dz = z - z0;
    const dl = len3(dx, dy, dz);
    if (dl > h) {
      x = x0 + (dx / dl) * h;
      y = y0 + (dy / dl) * h;
      z = z0 + (dz / dl) * h;
    }
    vpos[v * 3] = x;
    vpos[v * 3 + 1] = y;
    vpos[v * 3 + 2] = z;
    tetra(x, y, z, eps, list);
    normals[v * 3] = g[0];
    normals[v * 3 + 1] = g[1];
    normals[v * 3 + 2] = g[2];
    // curvature: Laplacian of the field (≈ 2 × mean curvature) from a wider stencil
    const f0 = g[3];
    const sum = tetra(x, y, z, ce, list);
    curv[v] = (sum - 4 * f0) / (2 * ce * ce);
  }

  // ------------------------------------------------ faces
  const tris: number[] = [];
  const quad = (c0: number, c1: number, c2: number, c3: number) => {
    const a = cellVert[c0], b = cellVert[c1], c = cellVert[c2], d = cellVert[c3];
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    tri(a, b, c);
    tri(a, c, d);
  };
  const tri = (a: number, b: number, c: number) => {
    const ax = vpos[a * 3], ay = vpos[a * 3 + 1], az = vpos[a * 3 + 2];
    const e1x = vpos[b * 3] - ax, e1y = vpos[b * 3 + 1] - ay, e1z = vpos[b * 3 + 2] - az;
    const e2x = vpos[c * 3] - ax, e2y = vpos[c * 3 + 1] - ay, e2z = vpos[c * 3 + 2] - az;
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const snx = normals[a * 3] + normals[b * 3] + normals[c * 3];
    const sny = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
    const snz = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
    if (fx * snx + fy * sny + fz * snz >= 0) tris.push(a, b, c);
    else tris.push(a, c, b);
  };
  for (let c = 0; c < cellsWithVerts.length; c += 3) {
    const i = cellsWithVerts[c], j = cellsWithVerts[c + 1], k = cellsWithVerts[c + 2];
    const s0 = vals[I(i, j, k)] < 0;
    if (j > 0 && k > 0 && s0 !== vals[I(i + 1, j, k)] < 0) quad(CI(i, j - 1, k - 1), CI(i, j, k - 1), CI(i, j, k), CI(i, j - 1, k));
    if (i > 0 && k > 0 && s0 !== vals[I(i, j + 1, k)] < 0) quad(CI(i - 1, j, k - 1), CI(i, j, k - 1), CI(i, j, k), CI(i - 1, j, k));
    if (i > 0 && j > 0 && s0 !== vals[I(i, j, k + 1)] < 0) quad(CI(i - 1, j - 1, k), CI(i, j - 1, k), CI(i, j, k), CI(i - 1, j, k));
  }

  // ------------------------------------------------ per-vertex attributes
  const sigma = part.sigma ?? 0.014;
  let maxBone = 0;
  for (const p of prims) {
    for (const [b] of p.bonesA) maxBone = Math.max(maxBone, b);
    if (p.bonesB) for (const [b] of p.bonesB) maxBone = Math.max(maxBone, b);
  }
  const acc = new Float64Array(maxBone + 1);
  const es = new Float64Array(prims.length);
  const slotAt = (x: number, y: number, z: number) => {
    const owner = evalOwner(listAt(x, y, z), x, y, z);
    const s = owner ? owner.slot : 0;
    return part.paint ? part.paint(s, x, y, z, owner) : s;
  };
  const slots = new Int8Array(nv);
  const flows = new Float32Array(nv * 3);
  const skinI = new Uint8Array(nv * 4);
  const skinW = new Float32Array(nv * 4);
  const ao = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const x = vpos[v * 3], y = vpos[v * 3 + 1], z = vpos[v * 3 + 2];
    const nxv = normals[v * 3], nyv = normals[v * 3 + 1], nzv = normals[v * 3 + 2];
    {
      const owner = evalOwner(listAt(x, y, z), x, y, z);
      const s0 = owner ? owner.slot : 0;
      slots[v] = part.paint ? part.paint(s0, x, y, z, owner) : s0;
      const f = part.flow ? part.flow(x, y, z, nxv, nyv, nzv, owner) : null;
      if (f) {
        // keep it in the tangent plane
        const dn = f[0] * nxv + f[1] * nyv + f[2] * nzv;
        const fx = f[0] - dn * nxv, fy = f[1] - dn * nyv, fz = f[2] - dn * nzv;
        // unit direction scaled by the requested strength (the callback's vector length, ≤ 1)
        const fl = (len3(fx, fy, fz) || 1) / Math.min(1, len3(f[0], f[1], f[2]) || 1);
        flows[v * 3] = fx / fl;
        flows[v * 3 + 1] = fy / fl;
        flows[v * 3 + 2] = fz / fl;
      }
    }

    // skin weights: soft competition between nearby primitives
    const list = listAt(x, y, z);
    let emin = Infinity;
    for (let q = 0; q < list.length; q++) {
      const p = list[q];
      es[q] = Infinity;
      if (p.op !== Op.Union || p.bonesA.length === 0) continue;
      const lb = len3(x - p.bcx, y - p.bcy, z - p.bcz) - p.br;
      if (lb > emin + sigma * 6) continue;
      const e = p.dist(x, y, z);
      es[q] = e;
      if (e < emin) emin = e;
    }
    acc.fill(0);
    for (let q = 0; q < list.length; q++) {
      const e = es[q];
      if (e === Infinity || e - emin > sigma * 6) continue;
      const w = Math.exp(-(e - emin) / sigma);
      const p = list[q];
      if (p.bonesB) {
        const t = p.axisT(x, y, z);
        const s = t <= p.t0 ? 0 : t >= p.t1 ? 1 : smooth((t - p.t0) / (p.t1 - p.t0));
        for (const [b, bwv] of p.bonesA) acc[b] += bwv * w * (1 - s);
        for (const [b, bwv] of p.bonesB) acc[b] += bwv * w * s;
      } else for (const [b, bwv] of p.bonesA) acc[b] += bwv * w;
    }
    // top 4
    let tot = 0;
    for (let q = 0; q < 4; q++) {
      let best = -1, bv = 1e-4;
      for (let b = 0; b <= maxBone; b++) if (acc[b] > bv) {
        bv = acc[b];
        best = b;
      }
      if (best < 0) break;
      skinI[v * 4 + q] = best;
      skinW[v * 4 + q] = bv;
      tot += bv;
      acc[best] = 0;
    }
    for (let q = 0; q < 4; q++) skinW[v * 4 + q] /= tot || 1;

    // ambient occlusion along the normal (classic SDF AO), including neighbouring parts
    const cl = ctxAt(x, y, z);
    let occ = 0;
    let scale = 1;
    for (const hs of AO_STEPS) {
      const px = x + nxv * hs, py = y + nyv * hs, pz = z + nzv * hs;
      let d = field(px, py, pz);
      for (const l of cl) if (l.length) d = Math.min(d, evalList(l, px, py, pz));
      if (d < hs) occ += (hs - d) * scale;
      scale *= 0.6;
    }
    ao[v] = Math.max(0.22, Math.min(1, 1 - occ * 6.5));
  }

  // ------------------------------------------------ emit, cutting triangles along slot boundaries
  const emitVertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number, slot: number, a: number, cu: number, si: ArrayLike<number>, sw: ArrayLike<number>, fx: number, fy: number, fz: number) => {
    out.pos.push(x, y, z);
    out.flow.push(fx, fy, fz);
    const l = len3(nx, ny, nz) || 1;
    out.nrm.push(nx / l, ny / l, nz / l);
    out.slot.push(slot);
    out.detail.push(a, Math.max(-1, Math.min(1, cu * 0.012)));
    for (let q = 0; q < 4; q++) {
      out.skinIdx.push(si[q]);
      out.skinW.push(sw[q]);
    }
    return out.count - 1;
  };
  const vOut = new Int32Array(nv);
  for (let v = 0; v < nv; v++)
    vOut[v] = emitVertex(
      vpos[v * 3], vpos[v * 3 + 1], vpos[v * 3 + 2],
      normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2],
      slots[v], ao[v], curv[v],
      skinI.subarray(v * 4, v * 4 + 4), skinW.subarray(v * 4, v * 4 + 4),
      flows[v * 3], flows[v * 3 + 1], flows[v * 3 + 2],
    );

  // boundary points: found by bisection on the slot classifier along the edge
  interface EdgePt {
    t: number;
    a: number;
    b: number;
    ids: Map<number, number>;
  }
  const edgePts = new Map<number, EdgePt>();
  const edgePoint = (a: number, b: number): EdgePt => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * nv + hi;
    let e = edgePts.get(key);
    if (!e) {
      const sa = slots[lo];
      let t0 = 0, t1 = 1;
      for (let it = 0; it < 6; it++) {
        const tm = (t0 + t1) / 2;
        const x = vpos[lo * 3] + (vpos[hi * 3] - vpos[lo * 3]) * tm;
        const y = vpos[lo * 3 + 1] + (vpos[hi * 3 + 1] - vpos[lo * 3 + 1]) * tm;
        const z = vpos[lo * 3 + 2] + (vpos[hi * 3 + 2] - vpos[lo * 3 + 2]) * tm;
        if (slotAt(x, y, z) === sa) t0 = tm;
        else t1 = tm;
      }
      e = { t: (t0 + t1) / 2, a: lo, b: hi, ids: new Map() };
      edgePts.set(key, e);
    }
    return e;
  };
  const wI = [0, 0, 0, 0], wW = [0, 0, 0, 0];
  /** blend of vertices (weights ws) emitted with the given slot */
  const blendVertex = (vs: number[], ws: number[], slot: number) => {
    let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0, a = 0, cu = 0, fx = 0, fy = 0, fz = 0;
    acc.fill(0);
    for (let q = 0; q < vs.length; q++) {
      const v = vs[q], w = ws[q];
      x += vpos[v * 3] * w;
      y += vpos[v * 3 + 1] * w;
      z += vpos[v * 3 + 2] * w;
      nx += normals[v * 3] * w;
      ny += normals[v * 3 + 1] * w;
      nz += normals[v * 3 + 2] * w;
      a += ao[v] * w;
      cu += curv[v] * w;
      fx += flows[v * 3] * w;
      fy += flows[v * 3 + 1] * w;
      fz += flows[v * 3 + 2] * w;
      for (let r = 0; r < 4; r++) acc[skinI[v * 4 + r]] += skinW[v * 4 + r] * w;
    }
    let tot = 0;
    for (let q = 0; q < 4; q++) {
      let best = -1, bv = 1e-5;
      for (let b = 0; b <= maxBone; b++) if (acc[b] > bv) {
        bv = acc[b];
        best = b;
      }
      wI[q] = best < 0 ? 0 : best;
      wW[q] = best < 0 ? 0 : bv;
      tot += best < 0 ? 0 : bv;
      if (best >= 0) acc[best] = 0;
    }
    for (let q = 0; q < 4; q++) wW[q] /= tot || 1;
    // keep the blended strength, renormalise only the direction
    const fl = len3(fx, fy, fz);
    let str = 0;
    for (let q = 0; q < vs.length; q++) str += len3(flows[vs[q] * 3], flows[vs[q] * 3 + 1], flows[vs[q] * 3 + 2]) * ws[q];
    if (fl > 1e-6) {
      fx *= str / fl;
      fy *= str / fl;
      fz *= str / fl;
    }
    return emitVertex(x, y, z, nx, ny, nz, slot, a, cu, wI, wW, fx, fy, fz);
  };
  const edgeVertex = (a: number, b: number, slot: number) => {
    const e = edgePoint(a, b);
    let id = e.ids.get(slot);
    if (id === undefined) {
      id = blendVertex([e.a, e.b], [1 - e.t, e.t], slot);
      e.ids.set(slot, id);
    }
    return id;
  };
  const idx = out.idx;
  for (let f = 0; f < tris.length; f += 3) {
    const a = tris[f], b = tris[f + 1], c = tris[f + 2];
    const sa = slots[a], sb = slots[b], sc = slots[c];
    if ((sa === sb && sb === sc) || part.splitSlots === false) {
      idx.push(vOut[a], vOut[b], vOut[c]);
      continue;
    }
    if (sa !== sb && sb !== sc && sa !== sc) {
      // three slots meet: split through the centre
      const ab = edgePoint(a, b), bc = edgePoint(b, c), ca = edgePoint(c, a);
      const tAB = ab.a === a ? ab.t : 1 - ab.t, tBC = bc.a === b ? bc.t : 1 - bc.t, tCA = ca.a === c ? ca.t : 1 - ca.t;
      // barycentric centre of the three boundary points
      const wa = (1 - tAB + tCA) / 3, wb = (tAB + 1 - tBC) / 3, wc = (tBC + 1 - tCA) / 3;
      const mA = blendVertex([a, b, c], [wa, wb, wc], sa);
      const mB = blendVertex([a, b, c], [wa, wb, wc], sb);
      const mC = blendVertex([a, b, c], [wa, wb, wc], sc);
      const pabA = edgeVertex(a, b, sa), pabB = edgeVertex(a, b, sb);
      const pbcB = edgeVertex(b, c, sb), pbcC = edgeVertex(b, c, sc);
      const pcaC = edgeVertex(c, a, sc), pcaA = edgeVertex(c, a, sa);
      idx.push(vOut[a], pabA, mA, vOut[a], mA, pcaA);
      idx.push(vOut[b], pbcB, mB, vOut[b], mB, pabB);
      idx.push(vOut[c], pcaC, mC, vOut[c], mC, pbcC);
      continue;
    }
    // two slots: rotate so `p` is the odd vertex out
    let p = a, q = b, r = c;
    if (sb !== sa && sb !== sc) {
      p = b;
      q = c;
      r = a;
    } else if (sc !== sa && sc !== sb) {
      p = c;
      q = a;
      r = b;
    }
    const sp = slots[p], sq = slots[q];
    const pqP = edgeVertex(p, q, sp), prP = edgeVertex(p, r, sp);
    const pqQ = edgeVertex(p, q, sq), prQ = edgeVertex(p, r, sq);
    idx.push(vOut[p], pqP, prP);
    idx.push(pqQ, vOut[q], vOut[r], pqQ, vOut[r], prQ);
  }
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}
