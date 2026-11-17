/**
 * Material-side quality knobs, set from the graphics settings before materials are built (a change rebuilds what uses them).
 */
export const materialQuality = {
  /** parallax occlusion steps on scanned relief (0 = flat) */
  pomSteps: 16,
  /** anti-tiling on large scanned repeats */
  antiTiling: true,
  /** hair shell layers (coily hair) */
  hairShells: 22,
  /** 2K maps for the sets that ship them (`hires.ts`) */
  textureResolution: '2k' as '2k' | '1k',
};

export function setMaterialQuality(q: Partial<typeof materialQuality>): void {
  Object.assign(materialQuality, q);
}
