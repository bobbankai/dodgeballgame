import * as THREE from 'three';

/** Most watercolour blooms (colour restored around a point) a scene can hold. */
export const MAX_BLOOMS = 8;

/**
 * Uniforms shared by every ink material and the composite pass. Materials reference these
 * objects directly, so changing a value here updates the whole frame.
 */
export const G = {
  uTime: { value: 0 },
  /** Hand-drawn "boil": a step that ticks ~8 times a second, so lines and hatching jitter like animation frames. */
  uBoil: { value: 0 },
  /** Watercolour blooms: xyz centre, w radius (metres). */
  uBlooms: { value: Array.from({ length: MAX_BLOOMS }, () => new THREE.Vector4(0, -1e4, 0, 0)) },
  uBloomCount: { value: 0 },
  /** 0 = whole scene in graphite unless bloomed, 1 = everything in colour. */
  uColorBase: { value: 0 },
  uPaper: { value: new THREE.Color(0.94, 0.9, 0.81) },
  uGraphite: { value: new THREE.Color(0.2, 0.19, 0.2) },
  uShadowTint: { value: new THREE.Color(0.56, 0.55, 0.72) },
  uAmbient: { value: new THREE.Color(0.55, 0.55, 0.58) },
  uFog: { value: new THREE.Vector3(30, 140, 0.85) },
};

export function setBoil(time: number) {
  G.uTime.value = time;
  G.uBoil.value = Math.floor(time * 8);
}
