import { Constants, Mesh, RawTexture, Texture, VertexData, type PBRMaterial, type Scene } from '@babylonjs/core';
import { createTerrainMaterial, type TerrainOptions } from '../render/materials/Terrain';

export interface HeightField {
  /** World XZ of the minimum corner and the extent (metres). */
  origin: [number, number];
  size: [number, number];
  /** Vertices per metre. */
  density: number;
  height(x: number, z: number): number;
  /**
   * Splat weights for layers 0..3 at a point (layer 3 is the cliff rock, which the shader also
   * adds on steep slopes by itself). Need not be normalised.
   */
  splat(x: number, z: number, h: number, slope: number): [number, number, number, number];
  /** Splat map resolution (texels per metre). */
  splatDensity?: number;
}

export interface BuiltTerrain {
  mesh: Mesh;
  material: PBRMaterial;
  height(x: number, z: number): number;
}

/**
 * Outdoor ground: a heightfield mesh from a level's height function (roads carved, building plots
 * flattened, hills shaped with noise), with smooth normals, and a splat map painted from the same
 * function for the four-layer terrain material (height-blended, anti-tiled, biplanar cliffs).
 */
export async function buildTerrain(scene: Scene, name: string, hf: HeightField, layers: TerrainOptions['layers'], tiles: TerrainOptions['tiles'],
  extra: Partial<TerrainOptions> = {}): Promise<BuiltTerrain> {
  const [ox, oz] = hf.origin;
  const [sx, sz] = hf.size;
  const nx = Math.max(2, Math.round(sx * hf.density) + 1);
  const nz = Math.max(2, Math.round(sz * hf.density) + 1);
  const pos = new Float32Array(nx * nz * 3);
  const hgt = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = ox + (i / (nx - 1)) * sx;
      const z = oz + (j / (nz - 1)) * sz;
      const h = hf.height(x, z);
      const k = j * nx + i;
      hgt[k] = h;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // alternate the diagonal so slopes do not show a directional grain
      // counter-clockwise seen from above (front faces in Babylon's right-handed mode)
      if ((i + j) & 1) {
        idx.set([a, b, c, b, d, c], n);
      } else {
        idx.set([a, d, c, a, b, d], n);
      }
      n += 6;
    }
  }
  // normals straight from the heightfield (central differences): always up-facing and smooth,
  // whatever the triangle winding convention
  const normals = new Float32Array(pos.length);
  const dx = sx / (nx - 1);
  const dz = sz / (nz - 1);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const hl = hgt[j * nx + Math.max(0, i - 1)];
      const hr = hgt[j * nx + Math.min(nx - 1, i + 1)];
      const hd = hgt[Math.max(0, j - 1) * nx + i];
      const hu = hgt[Math.min(nz - 1, j + 1) * nx + i];
      const gx = (hr - hl) / (dx * (i > 0 && i < nx - 1 ? 2 : 1));
      const gz = (hu - hd) / (dz * (j > 0 && j < nz - 1 ? 2 : 1));
      const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
      normals[k * 3] = -gx * inv;
      normals[k * 3 + 1] = inv;
      normals[k * 3 + 2] = -gz * inv;
    }
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = normals;
  vd.applyToMesh(mesh, false);
  mesh.receiveShadows = true;
  mesh.isPickable = false;

  // splat map
  const sd = hf.splatDensity ?? 2;
  const tw = Math.min(2048, Math.round(sx * sd));
  const th = Math.min(2048, Math.round(sz * sd));
  const data = new Uint8Array(tw * th * 4);
  const sample = (x: number, z: number) => {
    const fi = Math.min(nx - 1.001, Math.max(0, ((x - ox) / sx) * (nx - 1)));
    const fj = Math.min(nz - 1.001, Math.max(0, ((z - oz) / sz) * (nz - 1)));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const k = j * nx + i;
    return (hgt[k] * (1 - u) + hgt[k + 1] * u) * (1 - v) + (hgt[k + nx] * (1 - u) + hgt[k + nx + 1] * u) * v;
  };
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const x = ox + ((i + 0.5) / tw) * sx;
      const z = oz + ((j + 0.5) / th) * sz;
      const h = sample(x, z);
      const e = 0.5;
      const gx = (sample(x + e, z) - sample(x - e, z)) / (2 * e);
      const gz = (sample(x, z + e) - sample(x, z - e)) / (2 * e);
      const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
      const w = hf.splat(x, z, h, slope);
      const sum = Math.max(1e-4, w[0] + w[1] + w[2] + w[3]);
      const o = (j * tw + i) * 4;
      for (let c = 0; c < 4; c++) data[o + c] = Math.round((w[c] / sum) * 255);
    }
  }
  const splat = new RawTexture(data, tw, th, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  splat.wrapU = Texture.CLAMP_ADDRESSMODE;
  splat.wrapV = Texture.CLAMP_ADDRESSMODE;
  const material = await createTerrainMaterial(scene, `${name}:mat`, { layers, tiles, splat, origin: hf.origin, size: hf.size, ...extra });
  mesh.material = material;
  return { mesh, material, height: sample };
}
