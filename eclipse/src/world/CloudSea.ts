import { Color3, Mesh, PBRMaterial, VertexData, type Scene } from '@babylonjs/core';

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Billowy cumulus height: rounded (squared) noise lobes at three scales, flat between the domes. */
function billow(x: number, z: number): number {
  let h = 0;
  let amp = 1;
  let f = 0.012;
  for (let o = 0; o < 4; o++) {
    const n = noise(x * f + o * 17.3, z * f - o * 9.1);
    h += Math.pow(Math.max(0, n - 0.35) / 0.65, 1.6) * amp;
    amp *= 0.45;
    f *= 2.3;
  }
  return h;
}

/**
 * The sea of cloud under the sky islands: a wide heightfield of rounded cumulus domes (finer near
 * the middle, coarse out to the horizon), soft white with cool blue in its hollows (vertex colours),
 * lit by the sun and fogged by the atmosphere like any other ground, so it sits in the depth buffer.
 */
export function buildCloudSea(scene: Scene, center: [number, number], y: number, radius: number, height = 14): Mesh {
  // polar grid: rings packed tighter near the centre
  const rings = 90;
  const segs = 160;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const hAt = (x: number, z: number) => billow(x, z) * height;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = radius * t * t;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2 + (r % 2) * (Math.PI / segs);
      const x = center[0] + Math.cos(a) * rad;
      const z = center[1] + Math.sin(a) * rad;
      const h = hAt(x, z) * (1 - Math.pow(t, 6) * 0.5);
      pos.push(x, y + h, z);
      // hollows cool and shaded, domes bright
      const k = Math.min(1, h / (height * 0.7));
      col.push(0.62 + 0.36 * k, 0.66 + 0.33 * k, 0.78 + 0.22 * k, 1);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * segs + s;
      const b = r * segs + ((s + 1) % segs);
      const c = (r + 1) * segs + s;
      const d = (r + 1) * segs + ((s + 1) % segs);
      idx.push(a, c, b, b, c, d);
    }
  }
  // normals from the height function (always up-facing, smooth)
  const nrm: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const z = pos[i + 2];
    const e = 1.5;
    const gx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e);
    const gz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e);
    const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
    nrm.push(-gx * inv, inv, -gz * inv);
  }
  const mesh = new Mesh('cloudSea', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = nrm;
  vd.colors = col;
  vd.applyToMesh(mesh, false);
  mesh.hasVertexAlpha = false;
  mesh.isPickable = false;
  const m = new PBRMaterial('cloudSeaMat', scene);
  m.albedoColor = new Color3(0.92, 0.93, 0.96);
  m.metallic = 0;
  m.roughness = 1;
  m.environmentIntensity = 1.1;
  // light scattered through the cloud body: never fully dark on its shadowed side
  m.emissiveColor = new Color3(0.06, 0.065, 0.08);
  m.backFaceCulling = false;
  mesh.material = m;
  return mesh;
}
