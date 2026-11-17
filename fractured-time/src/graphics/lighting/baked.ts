import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * Lighting model for lightmapped static surfaces. Their diffuse light (direct + every bounce) is in the Cycles lightmap, so
 * real-time lights must add only what the bake cannot hold: view-dependent specular (the long highlights of strip lights
 * on metal and polished concrete, the lamps in a wet street). The diffuse term of each real-time light goes to a sink.
 * Indirect specular (reflection probe, SSR) is untouched.
 */
const T = TSL as any;

export class BakedLightingModel extends (THREE as any).PhysicalLightingModel {
  direct(input: any, builder: any) {
    const sink = T.vec3(0).toVar();
    super.direct({ ...input, reflectedLight: { ...input.reflectedLight, directDiffuse: sink } }, builder);
  }

  directRectArea(input: any, builder: any) {
    const sink = T.vec3(0).toVar();
    super.directRectArea({ ...input, reflectedLight: { ...input.reflectedLight, directDiffuse: sink } }, builder);
  }
}

/** Make a node material use the baked model (`coat` when it carries a clear coat: lacquer, a water film). */
export function useBakedLighting(m: THREE.Material, coat: boolean): void {
  const mm = m as any;
  if (!mm.isMeshStandardNodeMaterial) return;
  mm.setupLightingModel = () => new (BakedLightingModel as any)(coat, !!mm.sheen, !!mm.iridescence, !!mm.anisotropy, false, false);
}
