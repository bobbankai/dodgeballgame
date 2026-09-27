import * as THREE from 'three';
import knitUrl from '../assets/textures/knit.png';
import twillUrl from '../assets/textures/twill.png';
import skinUrl from '../assets/textures/skin.png';
import pebbleUrl from '../assets/textures/pebble.png';

/**
 * Tileable micro-detail maps baked in Blender (tools/blender/bake_details.py):
 * tangent-space normal in RGB, occlusion in A. Shared by every material that uses them.
 */
export interface DetailSet {
  knit: THREE.Texture;
  twill: THREE.Texture;
  skin: THREE.Texture;
  pebble: THREE.Texture;
}

let cache: DetailSet | null = null;
let pending: Promise<void>[] = [];

function load(url: string): THREE.Texture {
  let done!: () => void;
  pending.push(new Promise<void>((res) => (done = res)));
  const t = new THREE.TextureLoader().load(url, () => done(), undefined, () => done());
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

export function detailTextures(): DetailSet {
  if (!cache) cache = { knit: load(knitUrl), twill: load(twillUrl), skin: load(skinUrl), pebble: load(pebbleUrl) };
  return cache;
}

/** Resolves once the detail images have downloaded (used during boot to avoid pop-in). */
export function detailTexturesReady(): Promise<void> {
  detailTextures();
  const p = Promise.all(pending).then(() => undefined);
  pending = [];
  return p;
}

/** Detail kinds as used by the character shader. */
export const DETAIL = { none: 0, knit: 1, twill: 2, skin: 3, pebble: 4 } as const;
