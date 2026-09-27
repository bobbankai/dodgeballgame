import * as THREE from 'three';
import { buildPart, LodName, PART_KINDS, PartKind, partKey, partShape, ShapeApp } from './Anatomy';
import { meshPart, MeshOut, PackedMesh } from './Mesher';

/**
 * Sculpted character geometry, cached at two levels:
 *  - parts (body / head / hands / shoes) as typed arrays, shared by every athlete that needs
 *    them — all athletes share hands and shoes, heads vary by hairstyle, bodies by build;
 *  - merged, GPU-ready geometries per appearance, reference counted so a roster change frees
 *    what nobody uses any more.
 * Parts can be built synchronously (the lighter gameplay mesh, needed immediately) or in a
 * small worker pool (the close-up mesh, swapped in when it arrives).
 */

const PART_CAP = 72;
const IDLE_GEO_CAP = 10;

const parts = new Map<string, PackedMesh>();
const pendingParts = new Map<string, Promise<PackedMesh>>();

interface GeoEntry {
  geo: THREE.BufferGeometry;
  refs: number;
}
const geos = new Map<string, GeoEntry>();
const pendingGeos = new Map<string, Promise<THREE.BufferGeometry>>();

function touch<K, V>(m: Map<K, V>, k: K, v: V) {
  m.delete(k);
  m.set(k, v);
}

function storePart(key: string, p: PackedMesh) {
  touch(parts, key, p);
  while (parts.size > PART_CAP) parts.delete(parts.keys().next().value!);
}

function partSync(kind: PartKind, lod: LodName, app: ShapeApp): PackedMesh {
  const key = partKey(kind, lod, app);
  const hit = parts.get(key);
  if (hit) {
    touch(parts, key, hit);
    return hit;
  }
  const out = new MeshOut();
  meshPart(buildPart(kind, lod, app), out);
  const p = out.pack();
  storePart(key, p);
  return p;
}

// ------------------------------------------------------------------ worker pool
interface Job {
  kind: PartKind;
  lod: LodName;
  app: ShapeApp;
  resolve: (p: PackedMesh) => void;
}
let workers: Worker[] | null = null;
const load: number[] = [];
const jobs = new Map<number, Job>();
let nextJob = 1;

function pool(): Worker[] {
  if (workers) return workers;
  workers = [];
  try {
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./sculpt.worker.ts', import.meta.url), { type: 'module' });
      const wi = i;
      w.onmessage = (e: MessageEvent<{ id: number; part: PackedMesh }>) => {
        const job = jobs.get(e.data.id);
        if (!job) return;
        jobs.delete(e.data.id);
        load[wi]--;
        job.resolve(e.data.part);
      };
      w.onerror = () => failPool();
      workers.push(w);
      load.push(0);
    }
  } catch {
    failPool();
  }
  return workers;
}

/** Workers unavailable (or crashed): finish everything on the main thread. */
function failPool() {
  for (const w of workers ?? []) w.terminate();
  workers = [];
  const left = [...jobs.values()];
  jobs.clear();
  for (const j of left) j.resolve(partSync(j.kind, j.lod, j.app));
}

function partAsync(kind: PartKind, lod: LodName, app: ShapeApp): Promise<PackedMesh> {
  const key = partKey(kind, lod, app);
  const hit = parts.get(key);
  if (hit) return Promise.resolve(hit);
  const pend = pendingParts.get(key);
  if (pend) return pend;
  const ws = pool();
  let pr: Promise<PackedMesh>;
  if (!ws.length) {
    // no workers: still defer, so the caller's frame isn't blocked by a burst of builds
    pr = new Promise((res) => setTimeout(() => res(partSync(kind, lod, app)), 0));
  } else {
    let wi = 0;
    for (let i = 1; i < ws.length; i++) if (load[i] < load[wi]) wi = i;
    const id = nextJob++;
    load[wi]++;
    pr = new Promise((resolve) => {
      jobs.set(id, { kind, lod, app: partShape(kind, app), resolve });
      ws[wi].postMessage({ id, kind, lod, app: partShape(kind, app) });
    });
  }
  pr = pr.then((p) => {
    pendingParts.delete(key);
    storePart(key, p);
    return p;
  });
  pendingParts.set(key, pr);
  return pr;
}

// ------------------------------------------------------------------ merged geometries
function geoKey(lod: LodName, app: ShapeApp) {
  return PART_KINDS.map((k) => partKey(k, lod, app)).join('#');
}

function merge(list: PackedMesh[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const p of list) {
    nv += p.pos.length / 3;
    ni += p.idx.length;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), slot = new Float32Array(nv), detail = new Float32Array(nv * 2);
  const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, i = 0;
  for (const p of list) {
    const n = p.pos.length / 3;
    pos.set(p.pos, v * 3);
    nrm.set(p.nrm, v * 3);
    slot.set(p.slot, v);
    detail.set(p.detail, v * 2);
    si.set(p.skinIdx, v * 4);
    sw.set(p.skinW, v * 4);
    for (let k = 0; k < p.idx.length; k++) idx[i + k] = p.idx[k] + v;
    v += n;
    i += p.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
  g.setAttribute('aDetail', new THREE.BufferAttribute(detail, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  // shared between athletes: released through the cache, never disposed by one athlete
  g.userData.shared = true;
  return g;
}

function adopt(key: string, geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const e = geos.get(key);
  if (e) {
    e.refs++;
    touch(geos, key, e);
    if (e.geo !== geo) geo.dispose();
    return e.geo;
  }
  geos.set(key, { geo, refs: 1 });
  geo.userData.cacheKey = key;
  return geo;
}

/** Merged geometry for an appearance, sculpting any missing parts right now. */
export function acquireGeometry(lod: LodName, app: ShapeApp): THREE.BufferGeometry {
  const key = geoKey(lod, app);
  const e = geos.get(key);
  if (e) {
    e.refs++;
    touch(geos, key, e);
    return e.geo;
  }
  return adopt(key, merge(PART_KINDS.map((k) => partSync(k, lod, app))));
}

/** Same, with missing parts sculpted in the background. */
export function acquireGeometryAsync(lod: LodName, app: ShapeApp): Promise<THREE.BufferGeometry> {
  const key = geoKey(lod, app);
  const e = geos.get(key);
  if (e) {
    e.refs++;
    touch(geos, key, e);
    return Promise.resolve(e.geo);
  }
  let pend = pendingGeos.get(key);
  if (!pend) {
    pend = Promise.all(PART_KINDS.map((k) => partAsync(k, lod, app))).then((list) => {
      pendingGeos.delete(key);
      return merge(list);
    });
    pendingGeos.set(key, pend);
  }
  return pend.then((g) => adopt(key, g));
}

/** Drop one reference; unused geometries are kept for a while in case the build returns. */
export function releaseGeometry(geo: THREE.BufferGeometry) {
  const key = geo.userData.cacheKey as string | undefined;
  const e = key ? geos.get(key) : undefined;
  if (!e || e.geo !== geo) return;
  e.refs = Math.max(0, e.refs - 1);
  let idle = 0;
  for (const x of geos.values()) if (x.refs === 0) idle++;
  for (const [k, x] of geos) {
    if (idle <= IDLE_GEO_CAP) break;
    if (x.refs === 0) {
      x.geo.dispose();
      geos.delete(k);
      idle--;
    }
  }
}

/** Warm the part cache in the background (e.g. for the next roster). */
export function prefetch(lod: LodName, app: ShapeApp): Promise<unknown> {
  return Promise.all(PART_KINDS.map((k) => partAsync(k, lod, app)));
}
