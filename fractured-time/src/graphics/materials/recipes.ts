import type * as THREE from 'three/webgpu';

/**
 * A material recipe: written by the Blender scripts into each material's glTF extras (`userData.ft`, a JSON string or an
 * object), read here to rebuild the material for the engine. `type` selects the template; the other keys are its
 * parameters (documented on each template).
 */
export interface Recipe { type: string; [k: string]: any }

/** The recipe on a material, or null. */
export function recipeOf(m: THREE.Material | null | undefined): Recipe | null {
  const raw = (m?.userData as any)?.ft;
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

/** The recipe type on a material ('' when it has none). */
export const recipeType = (m: THREE.Material | null | undefined): string => recipeOf(m)?.type ?? '';
