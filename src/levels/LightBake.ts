import * as THREE from 'three';
import { LightProbeGridWebGL } from 'three/examples/jsm/lighting/LightProbeGridWebGL.js';
import type { Arena } from './Arena';

/**
 * Baked diffuse global illumination for arenas.
 *
 * Offline (`npm run bake:lighting`), each arena is exported from the running game
 * (`exportArenaForBake`) and lit in Blender Cycles: bounce light from the real-time lamps, light
 * from emissive surfaces, and the sky/fill light with true occlusion, all gathered in a grid of
 * probes and stored as L2 spherical harmonics. At runtime the grid is loaded into three.js's
 * light-probe volume, which every lit material samples per pixel — athletes included — and the
 * flat hemisphere fill it replaces is switched off.
 */

// ------------------------------------------------------------------ runtime
interface BakeMeta {
  version: number;
  arena: string;
  /** probe grid corners (three.js world space) */
  min: [number, number, number];
  max: [number, number, number];
  res: [number, number, number];
  /** multiplier applied to the stored coefficients */
  scale: number;
}

const metas = import.meta.glob<BakeMeta>('../assets/lighting/*.json', { eager: true, import: 'default' });
const bins = import.meta.glob<string>('../assets/lighting/*.bin', { eager: true, query: '?url', import: 'default' });
const cache = new Map<string, Promise<THREE.Data3DTexture | null>>();

function assetFor(id: string) {
  const meta = Object.entries(metas).find(([k]) => k.endsWith(`/${id}.json`))?.[1];
  const url = Object.entries(bins).find(([k]) => k.endsWith(`/${id}.bin`))?.[1];
  return meta && url ? { meta, url } : null;
}

export function hasBakedLighting(id: string) {
  return !!assetFor(id);
}

/** 27 half floats per probe (9 RGB SH coefficients) → three.js's padded 7-sub-volume atlas. */
function buildAtlas(meta: BakeMeta, coeffs: Uint16Array): THREE.Data3DTexture {
  const [nx, ny, nz] = meta.res;
  const padded = nz + 2;
  const depth = 7 * padded;
  const data = new Uint16Array(nx * ny * depth * 4);
  const scale = meta.scale;
  const toHalf = THREE.DataUtils.toHalfFloat, fromHalf = THREE.DataUtils.fromHalfFloat;
  for (let iz = 0; iz < nz; iz++)
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const p = (ix + nx * (iy + ny * iz)) * 27;
        for (let t = 0; t < 7; t++) {
          const dst = (s: number) => (ix + nx * (iy + ny * s)) * 4;
          for (let c = 0; c < 4; c++) {
            const k = t * 4 + c;
            const v = k < 27 ? toHalf(fromHalf(coeffs[p + k]) * scale) : 0;
            data[dst(t * padded + 1 + iz) + c] = v;
            if (iz === 0) data[dst(t * padded) + c] = v;
            if (iz === nz - 1) data[dst(t * padded + nz + 1) + c] = v;
          }
        }
      }
  const tex = new THREE.Data3DTexture(data, nx, ny, depth);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapR = tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

function loadTexture(id: string): Promise<THREE.Data3DTexture | null> {
  let p = cache.get(id);
  if (!p) {
    const a = assetFor(id);
    p = !a
      ? Promise.resolve(null)
      : fetch(a.url)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
          .then((buf) => buildAtlas(a.meta, new Uint16Array(buf)))
          .catch((e) => {
            console.warn('[LightBake] could not load baked lighting for', id, e);
            return null;
          });
    cache.set(id, p);
  }
  return p;
}

/**
 * Attach the arena's baked GI volume (if one exists). The hemisphere fill fades out as the volume
 * fades in, so nothing pops.
 */
export function applyBakedLighting(arena: Arena, id: string): Promise<boolean> {
  const a = assetFor(id);
  if (!a) return Promise.resolve(false);
  return loadTexture(id).then((tex) => {
    if (!tex || arena.disposed) return false;
    const { min, max, res } = a.meta;
    const grid = new LightProbeGridWebGL(max[0] - min[0], max[1] - min[1], max[2] - min[2], res[0], res[1], res[2]);
    grid.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    grid.updateBoundingBox();
    grid.texture = tex;
    grid.name = 'bakedGI';
    // the grid adds to irradiance: fade the texture's contribution in and the flat fill out
    const hemis: { l: THREE.HemisphereLight; i: number }[] = [];
    arena.root.traverse((o) => {
      if ((o as THREE.HemisphereLight).isHemisphereLight) hemis.push({ l: o as THREE.HemisphereLight, i: (o as THREE.HemisphereLight).intensity });
    });
    arena.root.add(grid);
    arena.bakedGI = grid;
    grid.userData.hemis = hemis;
    let t = 0;
    arena.updaters.push((dt) => {
      if (t >= 1 || !grid.visible) return;
      t = Math.min(1, t + dt / 0.6);
      for (const h of hemis) h.l.intensity = h.i * (1 - t);
    });
    return true;
  });
}

/** Switch between the baked volume and the flat hemisphere fill (debugging / comparisons). */
export function setBakedGIEnabled(arena: Arena, on: boolean) {
  const grid = arena.bakedGI;
  if (!grid) return;
  grid.visible = on;
  for (const h of grid.userData.hemis as { l: THREE.HemisphereLight; i: number }[]) h.l.intensity = on ? 0 : h.i;
}

// ------------------------------------------------------------------ export (bake tool only)
export interface BakeExport {
  meta: {
    arena: string;
    bounds: { min: number[]; max: number[] };
    materials: { albedo: number[]; emission: number[] }[];
    meshes: { material: number; vertexStart: number; vertexCount: number; indexStart: number; indexCount: number }[];
    lights: Record<string, unknown>[];
  };
  positions: Float32Array;
  indices: Uint32Array;
}

const _avgCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
/** Average colour of a texture (linear), or white if its pixels can't be read. */
function averageColor(tex: THREE.Texture | null | undefined, out: THREE.Color): THREE.Color {
  out.setRGB(1, 1, 1);
  const img = tex?.image as CanvasImageSource & { width?: number; height?: number; data?: ArrayLike<number> } | undefined;
  if (!tex || !img || !_avgCanvas) return out;
  try {
    const S = 16;
    _avgCanvas.width = _avgCanvas.height = S;
    const g = _avgCanvas.getContext('2d', { willReadFrequently: true })!;
    g.clearRect(0, 0, S, S);
    g.drawImage(img, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      r += (d[i] / 255) * a;
      gg += (d[i + 1] / 255) * a;
      b += (d[i + 2] / 255) * a;
      n++;
    }
    out.setRGB(r / n, gg / n, b / n);
    if (tex.colorSpace === THREE.SRGBColorSpace) out.convertSRGBToLinear();
  } catch {
    /* unreadable (e.g. data textures): leave white */
  }
  return out;
}

/** Everything Cycles needs: static geometry (world space), diffuse albedo/emission, and lights. */
export function exportArenaForBake(arena: Arena, id: string): BakeExport {
  const root = arena.root;
  root.updateMatrixWorld(true);
  const positions: number[] = [];
  const indices: number[] = [];
  const materials: BakeExport['meta']['materials'] = [];
  const matIndex = new Map<string, number>();
  const meshes: BakeExport['meta']['meshes'] = [];
  const lights: Record<string, unknown>[] = [];
  const c = new THREE.Color(), e = new THREE.Color(), tmp = new THREE.Color();
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  const box = new THREE.Box3();
  const bounds = new THREE.Box3();
  const m4 = new THREE.Matrix4();

  const addMesh = (geo: THREE.BufferGeometry, matrix: THREE.Matrix4, mi: number) => {
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const base = positions.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      positions.push(v.x, v.y, v.z);
    }
    const i0 = indices.length;
    const idx = geo.getIndex();
    if (idx) for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
    else for (let i = 0; i < pos.count; i++) indices.push(base + i);
    meshes.push({ material: mi, vertexStart: base, vertexCount: pos.count, indexStart: i0, indexCount: indices.length - i0 });
  };

  root.traverse((o) => {
    if (!o.visible) return;
    const L = o as THREE.Light;
    if (L.isLight) {
      const col = L.color.clone();
      const base = { color: [col.r, col.g, col.b], intensity: L.intensity };
      o.getWorldPosition(v);
      if ((L as THREE.HemisphereLight).isHemisphereLight) {
        const g = (L as THREE.HemisphereLight).groundColor;
        lights.push({ type: 'hemi', ...base, ground: [g.r, g.g, g.b] });
      } else if ((L as THREE.AmbientLight).isAmbientLight) lights.push({ type: 'ambient', ...base });
      else if ((L as THREE.DirectionalLight).isDirectionalLight) {
        (L as THREE.DirectionalLight).target.getWorldPosition(w);
        lights.push({ type: 'sun', ...base, dir: w.sub(v).normalize().toArray() });
      } else if ((L as THREE.SpotLight).isSpotLight) {
        const s = L as THREE.SpotLight;
        s.target.getWorldPosition(w);
        lights.push({ type: 'spot', ...base, pos: v.toArray(), dir: w.sub(v).normalize().toArray(), angle: s.angle, penumbra: s.penumbra, distance: s.distance, decay: s.decay });
      } else if ((L as THREE.PointLight).isPointLight) {
        const p = L as THREE.PointLight;
        lights.push({ type: 'point', ...base, pos: v.toArray(), distance: p.distance, decay: p.decay });
      }
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh && (mesh as THREE.InstancedMesh).count * mesh.geometry.getAttribute('position').count > 60000) return;
    const mat = mesh.material as THREE.Material;
    if (Array.isArray(mesh.material) || !mat || mat.visible === false) return;
    if ((mat as THREE.ShaderMaterial).isShaderMaterial || (mat.transparent && mat.opacity < 0.95) || mat.blending === THREE.AdditiveBlending || mat.side === THREE.BackSide) return;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    if (mesh.geometry.boundingSphere!.radius > 150) return;
    const sm = mat as THREE.MeshStandardMaterial;
    const isBasic = (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
    c.copy((sm.color as THREE.Color | undefined) ?? tmp.setRGB(1, 1, 1)).multiply(averageColor(sm.map, tmp));
    if (isBasic) {
      // unlit surfaces are what they show: pure emitters
      e.copy(c);
      c.setRGB(0, 0, 0);
    } else if (sm.emissive) {
      e.copy(sm.emissive).multiplyScalar(sm.emissiveIntensity ?? 1);
      if (sm.emissiveMap) e.multiply(averageColor(sm.emissiveMap, tmp));
    } else e.setRGB(0, 0, 0);
    const key = [c.r, c.g, c.b, e.r, e.g, e.b].map((x) => x.toFixed(3)).join(',');
    let mi = matIndex.get(key);
    if (mi === undefined) {
      mi = materials.length;
      matIndex.set(key, mi);
      materials.push({ albedo: [c.r, c.g, c.b], emission: [e.r, e.g, e.b] });
    }
    const inst = mesh as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      for (let k = 0; k < inst.count; k++) {
        inst.getMatrixAt(k, m4);
        addMesh(mesh.geometry, m4.premultiply(mesh.matrixWorld), mi);
      }
    } else addMesh(mesh.geometry, mesh.matrixWorld, mi);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    if (box.getCenter(v).length() < 60) bounds.union(box);
  });
  // probe volume: where athletes, the floor and the stands are
  const lim = new THREE.Box3(new THREE.Vector3(-34, -0.2, -40), new THREE.Vector3(34, 15, 40));
  bounds.intersect(lim);
  bounds.min.y = Math.max(bounds.min.y, -0.2);
  return {
    meta: { arena: id, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, materials, meshes, lights },
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}
