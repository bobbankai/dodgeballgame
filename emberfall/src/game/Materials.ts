// Runtime material setup for characters, weapons and props exported by the Blender pipeline.
// Clothing / armour materials carry glTF extras {tex, tint, scale, rough_fixed, metal, sheen, normal}:
// the shared tiling texture sets in assets/tex are bound here (one GPU copy for the whole cast).
import * as THREE from 'three';
import { texLoader } from '../core/Assets';
import { windDepthMaterial, type FXOptions } from '../render/MaterialFX';

interface TexSet { c: THREE.Texture; n: THREE.Texture; orm: THREE.Texture }
const sets = new Map<string, TexSet>();
const scaled = new Map<string, TexSet>();

function baseSet(name: string): TexSet {
  let s = sets.get(name);
  if (!s) {
    const c = texLoader.load(`assets/tex/${name}_c.webp`);
    c.colorSpace = THREE.SRGBColorSpace;
    const n = texLoader.load(`assets/tex/${name}_n.webp`);
    const orm = texLoader.load(`assets/tex/${name}_orm.webp`);
    for (const t of [c, n, orm]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
    }
    s = { c, n, orm };
    sets.set(name, s);
  }
  return s;
}

/** a texture set at a given repeat (clones share the image) */
export function tilingSet(name: string, repeat: number): TexSet {
  const key = `${name}@${repeat}`;
  let s = scaled.get(key);
  if (!s) {
    const b = baseSet(name);
    const cl = (t: THREE.Texture) => {
      const x = t.clone();
      x.repeat.set(repeat, repeat);
      x.needsUpdate = true;
      return x;
    };
    s = { c: cl(b.c), n: cl(b.n), orm: cl(b.orm) };
    scaled.set(key, s);
  }
  return s;
}

let poreTex: THREE.Texture | null = null;
/** skin micro-detail: a tiling normal map of pores and fine creases (generated once) */
export function skinDetail(): THREE.Texture {
  if (poreTex) return poreTex;
  const N = 256;
  const h = new Float32Array(N * N);
  const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // pores: random small pits; creases: two directional sine fields
  for (let k = 0; k < 2600; k++) {
    const cx = rnd(k) * N, cy = rnd(k + 999) * N, r = 0.8 + rnd(k + 5) * 1.6, d = 0.4 + rnd(k + 7) * 0.6;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
      const px = ((Math.floor(cx) + x) % N + N) % N, py = ((Math.floor(cy) + y) % N + N) % N;
      const dd = Math.hypot(x + (cx % 1), y + (cy % 1)) / r;
      if (dd < 1) h[py * N + px] -= d * (1 - dd * dd);
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
    h[y * N + x] += 0.12 * Math.sin(u * 9 + Math.sin(v * 3) * 2) + 0.08 * Math.sin(v * 13 + u * 2);
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
    const hy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
    const v = new THREE.Vector3(-hx * 1.2, -hy * 1.2, 1).normalize();
    const i = (y * N + x) * 4;
    data[i] = (v.x * 0.5 + 0.5) * 255; data[i + 1] = (v.y * 0.5 + 0.5) * 255; data[i + 2] = (v.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  poreTex = t;
  return t;
}

/** bind a shared tiling set from the material's glTF extras {tex, tint, scale, normal, rough_fixed, metal} */
export function bindTiling(std: THREE.MeshStandardMaterial, ex: Record<string, unknown>): void {
  const set = tilingSet(ex.tex as string, Number(ex.scale ?? 1));
  const tint = (ex.tint as number[]) ?? [1, 1, 1];
  std.color.setRGB(tint[0], tint[1], tint[2]);
  std.map = set.c;
  std.normalMap = set.n;
  const ns = Number(ex.normal ?? 1);
  std.normalScale.set(ns, ns);
  if (ex.rough_fixed !== undefined) {
    std.roughnessMap = null;
    std.roughness = Number(ex.rough_fixed);
  } else {
    std.roughnessMap = set.orm;
    std.roughness = 1;
  }
  std.aoMap = set.orm;
  std.aoMapIntensity = 0.8;
  std.metalness = Number(ex.metal ?? 0);
  std.metalnessMap = null;
  std.needsUpdate = true;
}

const foliage = new Map<string, { c: THREE.Texture; n: THREE.Texture }>();
function foliageSet(name: string): { c: THREE.Texture; n: THREE.Texture } {
  let f = foliage.get(name);
  if (!f) {
    const c = texLoader.load(`assets/tex/foliage_${name}_c.png`);
    c.colorSpace = THREE.SRGBColorSpace;
    const n = texLoader.load(`assets/tex/foliage_${name}_n.webp`);
    for (const t of [c, n]) t.anisotropy = 8;
    f = { c, n };
    foliage.set(name, f);
  }
  return f;
}

export interface EnvMat { mat: THREE.Material; fx: FXOptions; depth?: THREE.Material }

/** shared emissive of every rice-paper wall: levels light it (fires burning inside the houses) */
export const paperGlow = new THREE.Color(0, 0, 0);
/** shared ember colour of smouldering charred wood */
export const charGlow = new THREE.Color(1.5, 0.34, 0.07);

/**
 * Environment props / trees: tiling sets for `tex` materials, foliage cards for `leaf` materials (alpha to
 * coverage, translucency, wind). `base` = the level's weather features (wet, snow); `tree` = sway height.
 * Materials of a shared GLB are set up once.
 */
export function setupEnvMaterial(m: THREE.Material, msaa: boolean, base: FXOptions = {}, tree?: { height: number }): EnvMat {
  const cached = m.userData.env as EnvMat | undefined;
  if (cached) return cached;
  const std = m as THREE.MeshStandardMaterial;
  const ex = (m.userData ?? {}) as Record<string, unknown>;
  let r: EnvMat;
  if (typeof ex.leaf === 'string') {
    const f = foliageSet(ex.leaf);
    std.map = f.c;
    std.normalMap = f.n;
    std.normalScale.set(0.6, 0.6);
    std.alphaTest = 0.4;
    std.alphaToCoverage = msaa;
    std.transparent = false;
    std.side = THREE.DoubleSide;
    std.roughness = 0.62;
    std.metalness = 0;
    std.color.setRGB(1, 1, 1);
    std.needsUpdate = true;
    const fx: FXOptions = { foliage: { trans: 1 }, snow: base.snow, wind: tree ? { mode: 'leaves', height: tree.height } : undefined };
    r = { mat: std, fx, depth: windDepthMaterial(std, fx) };
  } else if (ex.paper) {
    std.roughness = 0.9;
    std.emissive = paperGlow;
    std.side = THREE.DoubleSide;
    r = { mat: std, fx: { ...base } };
  } else {
    if (typeof ex.tex === 'string') bindTiling(std, ex);
    const fx: FXOptions = { ...base };
    if (ex.cracks) fx.cracks = { color: charGlow, scale: 1.9, width: 0.028, world: true };
    if (tree) fx.wind = { mode: 'tree', height: tree.height };
    r = { mat: std, fx, depth: tree ? windDepthMaterial(std, fx) : undefined };
  }
  m.userData.env = r;
  return r;
}

export interface CharMatInfo { fx: FXOptions; transparentOrder?: number }

/**
 * Prepare one character material in place (may return a replacement). Returns shader features.
 */
export function setupCharacterMaterial(m: THREE.Material, msaa: boolean): { mat: THREE.Material; fx: FXOptions } {
  const std = m as THREE.MeshStandardMaterial;
  const ex = (m.userData ?? {}) as Record<string, unknown>;
  const name = m.name;
  if (typeof ex.tex === 'string') {
    bindTiling(std, ex);
    const fx: FXOptions = { hit: true, dissolve: true, rim: 0.25 };
    if (ex.cracks) fx.cracks = { color: new THREE.Color(2.4, 0.7, 0.2), scale: 4.2, width: 0.035 };
    return { mat: std, fx };
  }
  if (name === 'skin') {
    std.roughness = 1;
    const fx: FXOptions = { skin: {}, hit: true, dissolve: true, detail: { map: skinDetail(), scale: 48, strength: 0.35 }, rim: 0.2 };
    if (ex.glow) {
      std.emissive.setRGB(2.2, 0.65, 0.2);
      fx.pulse = { speed: 2.2, min: 0.45 };
    }
    return { mat: std, fx };
  }
  if (name === 'cornea') {
    const c = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    c.name = 'cornea';
    return { mat: c, fx: {} };
  }
  if (name === 'eyes') {
    std.roughness = 0.3;
    if (ex.glow) { std.emissiveIntensity = 1; return { mat: std, fx: { pulse: { speed: 3, min: 0.6 } } }; }
    return { mat: std, fx: {} };
  }
  if (name === 'hair' || name === 'brows' || name === 'lashes') {
    std.alphaTest = name === 'hair' ? 0.35 : 0.45;
    std.transparent = false;
    std.alphaToCoverage = msaa;
    std.side = THREE.DoubleSide;
    std.roughness = name === 'hair' ? 0.55 : 0.7;
    std.metalness = 0;
    if (name === 'hair') return { mat: std, fx: { hit: true, dissolve: true, hair: { shift: 0.08 } } };
    return { mat: std, fx: { hit: true, dissolve: true } };
  }
  if (name === 'teeth') std.roughness = 0.25;
  return { mat: std, fx: { hit: true, dissolve: true } };
}
