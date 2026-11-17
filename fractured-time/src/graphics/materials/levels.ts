import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { recipeOf, recipeType } from './recipes';
import { scanned, plain, screen, glass, chronalLight, practical, PRACTICAL_NAMES } from './environment';
import { water, type WaterRecipe } from './water';
import { windowMaterial } from './windows';
import { wetSurface } from '../shaders/surfaceLayers';
import { useBakedLighting } from '../lighting/baked';
import { activeShadowFactor } from '../lighting/dynamicShadows';
import { activeCapsuleFactor } from '../lighting/capsuleShadows';

/**
 * Level surfaces: recipe -> material, then the static-surface finish (the lightmap, the section's real-time lights for
 * specular only, the weather layer outdoors).
 */
const T = TSL as any;

/** `?nowin`: plain dark glass instead of interior-mapped panes (a test switch). */
const TEST_NOWIN = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nowin');

/** The engine material for one exported level material (the original when it carries no recipe). */
/** `owner`: the level section (its textures leave the GPU while it is hidden). */
export function levelMaterial(old: THREE.Material, owner = 'global'): THREE.Material {
  const r = recipeOf(old);
  if (!r) return old;
  let m: THREE.Material;
  switch (r.type) {
    case 'pbr': m = scanned(r, owner); break;
    case 'emissive': m = PRACTICAL_NAMES.test(old.name) ? practical(r, old.name) : chronalLight(r); break;
    case 'screen': m = screen(r, owner); break;
    case 'plain': m = plain(r); break;
    case 'glass': m = glass(r); break;
    case 'water': m = water(r as WaterRecipe); break;
    case 'window': m = TEST_NOWIN ? plain({ type: 'plain', color: [0.03, 0.035, 0.04], rough: 0.1 }) : windowMaterial(r); break;
    default: m = old;
  }
  m.name = old.name;
  m.userData.ft = (old.userData as any).ft;
  return m;
}

/** The weather layer on an exposed static surface. False when the material cannot take it. */
export function weatherproof(m: THREE.Material): boolean {
  const pm = m as THREE.MeshPhysicalNodeMaterial;
  if (!(pm as any).isMeshPhysicalNodeMaterial || pm.userData.wet) return false;
  pm.userData.wet = true;
  const w = wetSurface({
    color: (pm.colorNode ?? T.materialColor).rgb,
    roughness: pm.roughnessNode ?? T.materialRoughness,
    normal: pm.normalNode ?? T.normalViewGeometry,
    flatNormal: T.normalViewGeometry,
    pos: T.positionWorld,
    up: T.normalWorldGeometry.y,
  });
  pm.colorNode = w.color;
  pm.roughnessNode = w.roughness;
  pm.normalNode = w.normal;
  pm.clearcoat = 1;
  pm.clearcoatNode = w.coat;
  pm.clearcoatRoughnessNode = w.coatRoughness;
  pm.clearcoatNormalNode = w.coatNormal;
  pm.needsUpdate = true;
  return true;
}

export interface StaticFinish {
  lightMap: THREE.Texture | null;
  /** the section's fixtures as real-time lights (specular on baked surfaces) */
  lights: unknown;
  outdoors: boolean;
}

/** Finish a static (baked) surface material: lightmap, specular-only real-time lights, weather. */
export function finishStatic(m: THREE.Material, f: StaticFinish): void {
  const type = recipeType(m);
  if (type === 'glass' || type === 'water') return;
  const sm = m as THREE.MeshStandardNodeMaterial;
  // Cycles' diffuse bake is irradiance without the 1/pi of the Lambert BRDF. Window panes take none: the room behind the
  // glass is lit by its own model and the glass reflects the probe
  if (f.lightMap && 'lightMap' in sm && type !== 'window') {
    sm.lightMap = f.lightMap;
    sm.lightMapIntensity = Math.PI;
  }
  (sm as any).lightsNode = f.lights;
  // moving things' shadows on the baked light: they take away the share of it that came from the dominant direction
  const caps = activeCapsuleFactor();
  const direct = activeShadowFactor();
  const shadow = caps && direct ? direct.mul(caps) : (caps ?? direct);
  if (shadow && !m.userData.shadowed && type !== 'emissive' && type !== 'screen' && type !== 'window' && (sm as any).isMeshStandardNodeMaterial) {
    m.userData.shadowed = true;
    sm.colorNode = (sm.colorNode ?? T.materialColor).rgb.mul(shadow);
  }
  if ((sm as any).isMeshStandardNodeMaterial && type !== 'emissive' && type !== 'screen') {
    const wet = f.outdoors && type !== 'window' && weatherproof(m);
    useBakedLighting(m, wet || !!m.userData.wet || !!(sm as any).clearcoat);
  }
  sm.needsUpdate = true;
}
