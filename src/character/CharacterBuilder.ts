import * as THREE from 'three';
import { Appearance, SLOT } from './Appearance';
import { BONE_DEFS, BONE_INDEX, BoneName, bindPositions } from './Skeleton';
import { CharacterMaterial } from './CharacterMaterial';

/** Accumulates skinned, palette-slotted geometry. Each vertex has up to 2 bone influences. */
class GeoAccum {
  pos: number[] = [];
  nrm: number[] = [];
  slot: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  count = 0;

  v(px: number, py: number, pz: number, nx: number, ny: number, nz: number, slot: number, b0: number, b1: number, w0: number) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(px, py, pz);
    this.nrm.push(nx / l, ny / l, nz / l);
    this.slot.push(slot);
    this.si.push(b0, b1, 0, 0);
    this.sw.push(w0, 1 - w0, 0, 0);
    return this.count++;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aSlot', new THREE.Float32BufferAttribute(this.slot, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

interface Ring {
  y: number;
  cx: number;
  cz: number;
  rx: number;
  rzF: number;
  rzB: number;
  slot: number;
  b0: number;
  b1: number;
  w0: number;
}

const B = BONE_INDEX;

/**
 * Lofted tube through horizontal elliptical rings (bottom → top) with analytic normals.
 * Rings at the same height form hard palette seams; optional hemispherical domes cap the ends.
 */
function tube(g: GeoAccum, input: Ring[], radial: number, opts: { domeBottom?: number; domeTop?: number } = {}) {
  // Rings may be authored top→bottom (limbs); normalise to bottom→top so winding faces outward.
  if (input[0].y > input[input.length - 1].y) input = [...input].reverse();
  const rings: Ring[] = [];
  const domeSteps = 4;
  if (opts.domeBottom) {
    const r0 = input[0];
    for (let k = domeSteps; k >= 1; k--) {
      const a = (k / domeSteps) * (Math.PI / 2);
      const s = Math.cos(a);
      rings.push({ ...r0, y: r0.y - opts.domeBottom * Math.sin(a), rx: r0.rx * s, rzF: r0.rzF * s, rzB: r0.rzB * s });
    }
  }
  rings.push(...input);
  if (opts.domeTop) {
    const r1 = input[input.length - 1];
    for (let k = 1; k <= domeSteps; k++) {
      const a = (k / domeSteps) * (Math.PI / 2);
      const s = Math.cos(a);
      rings.push({ ...r1, y: r1.y + opts.domeTop * Math.sin(a), rx: r1.rx * s, rzF: r1.rzF * s, rzB: r1.rzB * s });
    }
  }

  const n = rings.length;
  const findPrev = (i: number) => {
    for (let k = i - 1; k >= 0; k--) if (Math.abs(rings[k].y - rings[i].y) > 1e-5) return k;
    return i;
  };
  const findNext = (i: number) => {
    for (let k = i + 1; k < n; k++) if (Math.abs(rings[k].y - rings[i].y) > 1e-5) return k;
    return i;
  };
  const start: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = rings[i];
    const p = rings[findPrev(i)];
    const q = rings[findNext(i)];
    const dy = q.y - p.y || 1;
    const drx = (q.rx - p.rx) / dy;
    const drzF = (q.rzF - p.rzF) / dy;
    const drzB = (q.rzB - p.rzB) / dy;
    const dcx = (q.cx - p.cx) / dy;
    const dcz = (q.cz - p.cz) / dy;
    start.push(g.count);
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const front = s >= 0;
      const rz = front ? r.rzF : r.rzB;
      const drz = front ? drzF : drzB;
      const px = r.cx + r.rx * c;
      const pz = r.cz + rz * s;
      let nx: number, ny: number, nz: number;
      if (r.rx < 1e-5 && rz < 1e-5) {
        nx = 0;
        nz = 0;
        ny = i === n - 1 ? 1 : -1;
      } else {
        const d = r.rx * 0 + drx * c + dcx;
        const f = drz * s + dcz;
        nx = rz * c;
        nz = r.rx * s;
        ny = -r.rx * s * f - rz * c * d;
      }
      g.v(px, r.y, pz, nx, ny, nz, r.slot, r.b0, r.b1, r.w0);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a0 = start[i];
    const a1 = start[i + 1];
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      const a = a0 + j, b = a0 + j1, c = a1 + j, d = a1 + j1;
      g.tri(a, c, b);
      g.tri(b, c, d);
    }
  }
}

interface EllipsoidOpts {
  center: [number, number, number];
  radii: [number, number, number];
  slot: number;
  b0: number;
  b1?: number;
  w0?: number;
  segU?: number;
  segV?: number;
  /** Max polar angle per longitude (hair lines). θ: 0=+X, π/2=+Z(front). */
  phiMax?: (theta: number) => number;
  phiMin?: number;
  thetaRange?: [number, number];
  /** Radial displacement multiplier (1 = none). */
  scale?: (theta: number, phi: number) => number;
  /** Clamp vertices below this absolute y (flat soles). */
  floorY?: number;
  rot?: THREE.Euler;
  /** Use numeric normals (for displaced shapes). */
  numericNormals?: boolean;
}

function ellipsoid(g: GeoAccum, o: EllipsoidOpts) {
  const segU = o.segU ?? 20;
  const segV = o.segV ?? 14;
  const [cx, cy, cz] = o.center;
  const [rx, ry, rz] = o.radii;
  const b1 = o.b1 ?? o.b0;
  const w0 = o.w0 ?? 1;
  const phiMin = o.phiMin ?? 0;
  const closed = !o.thetaRange;
  const cols = closed ? segU : segU + 1;
  const m = o.rot ? new THREE.Matrix4().makeRotationFromEuler(o.rot) : null;
  const p = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const base = g.count;
  const pts: THREE.Vector3[] = [];
  const surf = (th: number, ph: number, out: THREE.Vector3) => {
    const k = o.scale ? o.scale(th, ph) : 1;
    out.set(rx * Math.sin(ph) * Math.cos(th) * k, ry * Math.cos(ph) * k, rz * Math.sin(ph) * Math.sin(th) * k);
    return out;
  };
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), q = new THREE.Vector3();
  for (let j = 0; j < cols; j++) {
    const th = o.thetaRange ? o.thetaRange[0] + (o.thetaRange[1] - o.thetaRange[0]) * (j / segU) : (j / segU) * Math.PI * 2;
    const pmax = o.phiMax ? o.phiMax(th) : Math.PI;
    for (let i = 0; i <= segV; i++) {
      const ph = phiMin + (pmax - phiMin) * (i / segV);
      surf(th, ph, p);
      if (o.numericNormals) {
        const h = 0.01;
        surf(th + h, ph, e1).sub(p);
        surf(th, Math.min(Math.PI - 1e-3, ph + h), e2).sub(p);
        if (ph < 1e-3) {
          nv.set(0, 1, 0);
        } else {
          nv.crossVectors(e2, e1).normalize();
          if (nv.dot(p) < 0) nv.negate();
        }
      } else {
        nv.set(p.x / (rx * rx), p.y / (ry * ry), p.z / (rz * rz));
        if (nv.lengthSq() < 1e-12) nv.set(0, ph < 1 ? 1 : -1, 0);
        nv.normalize();
      }
      if (m) {
        p.applyMatrix4(m);
        nv.transformDirection(m);
      }
      q.set(p.x + cx, p.y + cy, p.z + cz);
      if (o.floorY !== undefined && q.y < o.floorY) {
        q.y = o.floorY;
        nv.set(nv.x * 0.3, -1, nv.z * 0.3);
      }
      pts.push(q.clone());
      g.v(q.x, q.y, q.z, nv.x, nv.y, nv.z, o.slot, o.b0, b1, w0);
    }
  }
  const rowLen = segV + 1;
  const quadCols = closed ? segU : segU;
  for (let j = 0; j < quadCols; j++) {
    const j1 = closed ? (j + 1) % segU : j + 1;
    for (let i = 0; i < segV; i++) {
      const a = base + j * rowLen + i;
      const b = base + j1 * rowLen + i;
      const c = base + j * rowLen + i + 1;
      const d = base + j1 * rowLen + i + 1;
      // θ increases toward +Z from +X; φ increases downward.
      g.tri(a, b, c);
      g.tri(b, d, c);
    }
  }
}

export interface CharacterRig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  material: CharacterMaterial;
  bones: THREE.Bone[];
  boneByName: Record<BoneName, THREE.Bone>;
  sockets: {
    handR: THREE.Object3D;
    handL: THREE.Object3D;
    chest: THREE.Object3D;
    head: THREE.Object3D;
    hips: THREE.Object3D;
  };
  height: number;
}

export function buildCharacter(app: Appearance): CharacterRig {
  const g = new GeoAccum();
  const bulk = app.bulk;
  const limb = 1 + (bulk - 1) * 0.75;
  const bp = bindPositions();
  const R = (y: number, rx: number, rzF: number, rzB: number, slot: number, b0: number, b1: number, w0: number, cx = 0, cz = 0): Ring => ({
    y, cx, cz, rx, rzF, rzB, slot, b0, b1, w0,
  });

  // ---------------- torso ----------------
  const T = (r: number) => r * bulk;
  const J = SLOT.jersey, SH = SLOT.shorts, AC = SLOT.accent, TR = SLOT.trim, SK = SLOT.skin;
  tube(
    g,
    [
      R(0.845, T(0.13), T(0.09), T(0.1), SH, B.hips, B.hips, 1),
      R(0.9, T(0.163), T(0.104), T(0.124), SH, B.hips, B.hips, 1),
      R(0.975, T(0.16), T(0.099), T(0.113), SH, B.hips, B.spine, 0.9),
      R(0.975, T(0.16), T(0.099), T(0.113), TR, B.hips, B.spine, 0.9),
      R(1.0, T(0.156), T(0.097), T(0.108), TR, B.hips, B.spine, 0.75),
      R(1.0, T(0.158), T(0.099), T(0.11), J, B.hips, B.spine, 0.75),
      R(1.1, T(0.149), T(0.101), T(0.1), J, B.spine, B.hips, 0.8),
      R(1.2, T(0.16), T(0.118), T(0.104), J, B.spine, B.chest, 0.5),
      R(1.3, T(0.176), T(0.13), T(0.11), J, B.chest, B.spine, 0.85),
      R(1.38, T(0.184), T(0.126), T(0.11), J, B.chest, B.chest, 1),
      R(1.44, T(0.17), T(0.105), T(0.1), J, B.chest, B.chest, 1),
      R(1.49, T(0.118), T(0.084), T(0.085), J, B.chest, B.neck, 0.9),
      R(1.49, T(0.118), T(0.084), T(0.085), TR, B.chest, B.neck, 0.9),
      R(1.515, 0.074, 0.068, 0.068, TR, B.chest, B.neck, 0.7),
    ],
    24,
    { domeBottom: 0.035, domeTop: 0.01 },
  );

  // ---------------- neck ----------------
  const neckZ = -0.005;
  tube(
    g,
    [
      R(1.45, 0.056, 0.056, 0.056, SK, B.chest, B.neck, 0.8, 0, neckZ),
      R(1.52, 0.05, 0.05, 0.052, SK, B.neck, B.chest, 0.7, 0, neckZ),
      R(1.58, 0.047, 0.047, 0.05, SK, B.neck, B.head, 0.5, 0, neckZ),
      R(1.64, 0.045, 0.045, 0.048, SK, B.head, B.head, 1, 0, neckZ + 0.005),
    ],
    14,
  );

  // ---------------- head ----------------
  const hp = bp[B.head];
  const HC: [number, number, number] = [0, hp[1] + 0.115, 0.015];
  const HR: [number, number, number] = [0.108, 0.128, 0.118];
  const headShape = (th: number, ph: number) => {
    // taper the jaw and widen the cranium slightly
    const lower = Math.max(0, Math.cos(Math.PI - ph));
    const side = Math.abs(Math.cos(th));
    return 1 - lower * 0.16 * side - lower * 0.05;
  };
  ellipsoid(g, { center: HC, radii: HR, slot: SK, b0: B.head, segU: 28, segV: 18, scale: headShape, numericNormals: true });

  const headSurfaceZ = (x: number, y: number) => {
    const nx = x / HR[0], ny = (y - HC[1]) / HR[1];
    return HC[2] + HR[2] * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  };
  // eyes: white + iris
  for (const side of [1, -1]) {
    const ex = 0.039 * side, ey = HC[1] + 0.012;
    const ez = headSurfaceZ(ex, ey) - 0.004;
    ellipsoid(g, { center: [ex, ey, ez], radii: [0.02, 0.013, 0.007], slot: SLOT.sole, b0: B.head, segU: 12, segV: 8 });
    ellipsoid(g, { center: [ex - 0.002 * side, ey, ez + 0.005], radii: [0.0095, 0.011, 0.005], slot: SLOT.eyes, b0: B.head, segU: 10, segV: 6 });
    // brows
    const browTilt = app.brow === 'angry' ? 0.3 : app.brow === 'calm' ? -0.08 : app.brow === 'raised' ? -0.22 : 0.05;
    const by = ey + (app.brow === 'raised' ? 0.03 : 0.024);
    ellipsoid(g, {
      center: [ex, by, headSurfaceZ(ex, by) + 0.001],
      radii: [0.023, 0.0055, 0.006],
      slot: SLOT.hair,
      b0: B.head,
      segU: 10,
      segV: 6,
      rot: new THREE.Euler(-0.25, 0, -browTilt * side),
    });
    // ears
    ellipsoid(g, { center: [0.106 * side, HC[1] - 0.004, HC[2] - 0.012], radii: [0.013, 0.025, 0.018], slot: SK, b0: B.head, segU: 10, segV: 8 });
  }
  // nose + mouth
  ellipsoid(g, { center: [0, HC[1] - 0.012, headSurfaceZ(0, HC[1] - 0.012) + 0.004], radii: [0.012, 0.019, 0.014], slot: SK, b0: B.head, segU: 10, segV: 8 });
  ellipsoid(g, { center: [0, HC[1] - 0.05, headSurfaceZ(0, HC[1] - 0.05) - 0.002], radii: [0.02, 0.004, 0.005], slot: SLOT.eyes, b0: B.head, segU: 10, segV: 6, rot: new THREE.Euler(0.15, 0, 0) });

  // ---------------- hair ----------------
  buildHair(g, app, HC, HR);

  if (app.headband) {
    const hy = HC[1] + 0.052;
    const t = app.hairStyle === 'bald' ? 0.004 : app.hairStyle === 'afro' ? 0.075 : 0.022;
    const k = Math.sqrt(1 - Math.pow((hy - HC[1]) / HR[1], 2));
    tube(
      g,
      [
        R(hy - 0.016, HR[0] * k + t, HR[2] * k + t, HR[2] * k + t, AC, B.head, B.head, 1, 0, HC[2]),
        R(hy + 0.014, HR[0] * k * 0.97 + t, HR[2] * k * 0.97 + t, HR[2] * k * 0.97 + t, AC, B.head, B.head, 1, 0, HC[2]),
      ],
      28,
    );
  }
  if (app.visor) {
    ellipsoid(g, {
      center: [HC[0], HC[1] + 0.012, HC[2] + 0.004],
      radii: [HR[0] + 0.012, HR[1] * 0.99, HR[2] + 0.014],
      slot: SLOT.visor,
      b0: B.head,
      segU: 16,
      segV: 5,
      thetaRange: [0.35, Math.PI - 0.35],
      phiMin: 1.28,
      phiMax: () => 1.72,
    });
  }

  // ---------------- arms ----------------
  for (const side of [1, -1] as const) {
    const up = side === 1 ? B.upperArmL : B.upperArmR;
    const fore = side === 1 ? B.foreArmL : B.foreArmR;
    const hand = side === 1 ? B.handL : B.handR;
    const clav = side === 1 ? B.clavL : B.clavR;
    const a = bp[up];
    const ax = a[0] + side * 0.008, ay = a[1], az = a[2];
    const L = (r: number) => r * limb;
    const sleeve = app.sleeveless ? SK : J;
    const rings: Ring[] = [
      R(ay - 0.0, L(0.07), L(0.066), L(0.066), sleeve, up, clav, 0.7, ax, az),
      R(ay - 0.06, L(0.069), L(0.064), L(0.064), sleeve, up, up, 1, ax, az),
      R(ay - 0.13, L(0.066), L(0.061), L(0.061), sleeve, up, up, 1, ax, az),
    ];
    if (!app.sleeveless) {
      rings.push(R(ay - 0.13, L(0.051), L(0.047), L(0.047), sleeve, up, up, 1, ax, az));
      rings.push(R(ay - 0.13, L(0.051), L(0.047), L(0.047), SK, up, up, 1, ax, az));
    }
    rings.push(
      R(ay - 0.2, L(0.049), L(0.045), L(0.045), SK, up, up, 1, ax, az),
      R(ay - 0.255, L(0.042), L(0.039), L(0.039), SK, up, fore, 0.78, ax, az),
      R(ay - 0.28, L(0.04), L(0.038), L(0.038), SK, up, fore, 0.5, ax, az - 0.002),
      R(ay - 0.305, L(0.042), L(0.04), L(0.04), SK, fore, up, 0.8, ax, az),
      R(ay - 0.36, L(0.045), L(0.041), L(0.041), SK, fore, fore, 1, ax, az),
    );
    if (app.wristbands) {
      rings.push(
        R(ay - 0.455, L(0.035), L(0.032), L(0.032), SK, fore, fore, 1, ax, az),
        R(ay - 0.455, L(0.039), L(0.036), L(0.036), AC, fore, fore, 1, ax, az),
        R(ay - 0.505, L(0.037), L(0.034), L(0.034), AC, fore, hand, 0.8, ax, az),
        R(ay - 0.505, L(0.032), L(0.03), L(0.03), SK, fore, hand, 0.8, ax, az),
      );
    } else {
      rings.push(R(ay - 0.46, L(0.034), L(0.031), L(0.031), SK, fore, fore, 1, ax, az));
    }
    rings.push(R(ay - 0.53, L(0.03), L(0.028), L(0.028), SK, hand, fore, 0.55, ax, az));
    tube(g, rings, 14, { domeTop: 0.055, domeBottom: 0.012 });

    // hand (mitten + thumb)
    const hy = bp[hand][1];
    const hx = a[0];
    ellipsoid(g, { center: [hx - side * 0.004, hy - 0.058, az + 0.004], radii: [0.028 * limb, 0.058, 0.044 * limb], slot: SK, b0: hand, segU: 14, segV: 10 });
    ellipsoid(g, {
      center: [hx - side * 0.022, hy - 0.035, az + 0.03],
      radii: [0.016, 0.03, 0.017],
      slot: SK,
      b0: hand,
      segU: 10,
      segV: 8,
      rot: new THREE.Euler(0.5, 0, side * 0.5),
    });
  }

  // ---------------- legs ----------------
  for (const side of [1, -1] as const) {
    const th = side === 1 ? B.thighL : B.thighR;
    const sh = side === 1 ? B.shinL : B.shinR;
    const ft = side === 1 ? B.footL : B.footR;
    const t = bp[th];
    const lx = t[0], ly = t[1], lz = t[2];
    const L = (r: number) => r * limb;
    tube(
      g,
      [
        R(ly + 0.04, L(0.1), L(0.095), L(0.105), SH, B.hips, th, 0.65, lx * 0.9, lz),
        R(ly - 0.03, L(0.098), L(0.094), L(0.1), SH, th, B.hips, 0.75, lx, lz),
        R(ly - 0.175, L(0.091), L(0.088), L(0.09), SH, th, th, 1, lx, lz),
        R(ly - 0.175, L(0.069), L(0.066), L(0.07), SH, th, th, 1, lx, lz),
        R(ly - 0.175, L(0.069), L(0.066), L(0.07), SK, th, th, 1, lx, lz),
        R(ly - 0.26, L(0.066), L(0.064), L(0.066), SK, th, th, 1, lx, lz),
        R(ly - 0.36, L(0.056), L(0.056), L(0.054), SK, th, sh, 0.9, lx, lz),
        R(ly - 0.41, L(0.05), L(0.052), L(0.048), SK, th, sh, 0.62, lx, lz + 0.004),
        R(ly - 0.43, L(0.049), L(0.051), L(0.047), SK, th, sh, 0.5, lx, lz + 0.004),
        R(ly - 0.46, L(0.05), L(0.049), L(0.052), SK, sh, th, 0.85, lx, lz),
        R(ly - 0.54, L(0.055), L(0.05), L(0.068), SK, sh, sh, 1, lx, lz),
        R(ly - 0.63, L(0.047), L(0.045), L(0.052), SK, sh, sh, 1, lx, lz),
        R(ly - 0.66, L(0.045), L(0.044), L(0.048), SK, sh, sh, 1, lx, lz),
        R(ly - 0.66, L(0.05), L(0.049), L(0.052), SLOT.socks, sh, sh, 1, lx, lz),
        R(ly - 0.7, L(0.046), L(0.045), L(0.048), SLOT.socks, sh, sh, 1, lx, lz),
        R(ly - 0.8, L(0.039), L(0.038), L(0.04), SLOT.socks, sh, sh, 1, lx, lz),
        R(ly - 0.84, L(0.037), L(0.036), L(0.038), SLOT.socks, sh, ft, 0.5, lx, lz),
      ],
      16,
      { domeBottom: 0.02 },
    );

    // shoe
    const f = bp[ft];
    const fz = f[2] + 0.045;
    ellipsoid(g, { center: [f[0], 0.066, fz], radii: [0.054, 0.056, 0.132], slot: SLOT.shoes, b0: ft, segU: 20, segV: 12, floorY: 0.03 });
    ellipsoid(g, { center: [f[0], 0.028, fz + 0.002], radii: [0.059, 0.028, 0.14], slot: SLOT.sole, b0: ft, segU: 20, segV: 8, floorY: 0.0 });
    // side stripe
    ellipsoid(g, {
      center: [f[0] + side * 0.048, 0.062, fz - 0.01],
      radii: [0.01, 0.018, 0.07],
      slot: SLOT.accent,
      b0: ft,
      segU: 10,
      segV: 6,
      rot: new THREE.Euler(0.25, 0, 0),
    });
    // ankle collar
    tube(
      g,
      [
        R(0.1, 0.047, 0.05, 0.052, SLOT.shoes, ft, ft, 1, f[0], f[2] - 0.005),
        R(0.125, 0.043, 0.046, 0.048, SLOT.shoes, ft, sh, 0.9, f[0], f[2] - 0.008),
      ],
      14,
    );
  }

  const geom = g.build();
  const material = new CharacterMaterial(app);

  // ---------------- skeleton ----------------
  const bones: THREE.Bone[] = [];
  const byName = {} as Record<BoneName, THREE.Bone>;
  for (const d of BONE_DEFS) {
    const b = new THREE.Bone();
    b.name = d.name;
    b.position.set(...d.offset);
    bones.push(b);
    byName[d.name] = b;
    if (d.parent) byName[d.parent].add(b);
  }
  const root = new THREE.Group();
  root.name = 'athlete';
  root.add(bones[0]);
  const mesh = new THREE.SkinnedMesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const mk = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const sockets = {
    handR: mk(byName.handR, 0.075, -0.075, 0.03),
    handL: mk(byName.handL, -0.075, -0.075, 0.03),
    chest: mk(byName.chest, 0, 0.06, 0.08),
    head: mk(byName.head, 0, 0.12, 0),
    hips: mk(byName.hips, 0, 0, 0),
  };
  root.scale.setScalar(app.height);
  return { root, mesh, material, bones, boneByName: byName, sockets, height: app.height };
}

function buildHair(g: GeoAccum, app: Appearance, HC: [number, number, number], HR: [number, number, number]) {
  const style = app.hairStyle;
  if (style === 'bald') return;
  const H = SLOT.hair;
  const frontF = (th: number) => (1 + Math.sin(th)) / 2; // 1 at front, 0 at back
  const phiMaxStd = (th: number) => {
    const f = Math.pow(frontF(th), 0.7);
    return 2.08 + (1.0 - 2.08) * f;
  };
  const shell = (thickTop: number, thickEdge: number, phiMax: (t: number) => number, extra?: (th: number, ph: number) => number) => {
    ellipsoid(g, {
      center: HC,
      radii: HR,
      slot: H,
      b0: B.head,
      segU: 30,
      segV: 12,
      phiMax,
      numericNormals: true,
      scale: (th, ph) => {
        const pm = phiMax(th);
        const k = Math.min(1, ph / pm);
        const t = thickTop + (thickEdge - thickTop) * k;
        const r = (HR[0] + HR[1] + HR[2]) / 3;
        return 1 + t / r + (extra ? extra(th, ph) : 0);
      },
    });
  };
  switch (style) {
    case 'buzz':
      shell(0.007, 0.004, phiMaxStd);
      break;
    case 'short':
      shell(0.024, 0.006, phiMaxStd);
      break;
    case 'swept':
      shell(0.03, 0.006, phiMaxStd, (th, ph) => {
        const f = frontF(th);
        return f * f * 0.26 * Math.max(0, Math.cos(ph * 1.4)) + 0.02 * Math.sin(th * 9 + ph * 4) * (1 - ph / 2);
      });
      break;
    case 'spiky':
      shell(0.02, 0.006, phiMaxStd, (th, ph) => {
        const s = Math.max(0, Math.sin(th * 7) * Math.sin(ph * 7 + 0.5));
        return Math.pow(s, 2.2) * 0.35 * Math.max(0, 1 - ph / 1.6);
      });
      break;
    case 'mohawk':
      shell(0.006, 0.004, phiMaxStd);
      ellipsoid(g, {
        center: [HC[0], HC[1] + 0.07, HC[2] - 0.01],
        radii: [0.02, 0.085, 0.125],
        slot: H,
        b0: B.head,
        segU: 14,
        segV: 10,
        rot: new THREE.Euler(-0.2, 0, 0),
      });
      break;
    case 'afro':
      shell(0.075, 0.03, (th) => phiMaxStd(th) * 1.02, (th, ph) => 0.04 * Math.sin(th * 13) * Math.sin(ph * 11));
      break;
    case 'bun':
      shell(0.018, 0.006, phiMaxStd);
      ellipsoid(g, { center: [HC[0], HC[1] + 0.1, HC[2] - 0.09], radii: [0.048, 0.044, 0.046], slot: H, b0: B.head, segU: 14, segV: 10 });
      break;
    case 'ponytail':
      shell(0.02, 0.006, phiMaxStd);
      ellipsoid(g, {
        center: [HC[0], HC[1] - 0.03, HC[2] - 0.15],
        radii: [0.034, 0.1, 0.034],
        slot: H,
        b0: B.head,
        segU: 12,
        segV: 10,
        rot: new THREE.Euler(0.45, 0, 0),
      });
      ellipsoid(g, { center: [HC[0], HC[1] + 0.035, HC[2] - 0.125], radii: [0.024, 0.02, 0.02], slot: SLOT.accent, b0: B.head, segU: 10, segV: 6 });
      break;
  }
}
