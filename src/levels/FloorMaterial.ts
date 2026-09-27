import * as THREE from 'three';
import { reflectionUniforms } from '../rendering/FloorReflection';

/**
 * Court floor: tiled surface texture + court-line overlay sampled in court space.
 * Lines live in the same material (no decal z-fighting) and get their own roughness.
 */
export function createFloorMaterial(opts: {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  lines: THREE.Texture;
  /** size of the area the lines texture covers (x, z) */
  linesSize: THREE.Vector2;
  tileSize: number;
  roughness: number;
  linesRoughness?: number;
  emissiveLines?: number;
  color?: THREE.ColorRepresentation;
  metalness?: number;
  envIntensity?: number;
  /** planar reflection strength (0 = none, 1 = physically weighted, >1 = extra polish) */
  reflect?: number;
}) {
  const m = new THREE.MeshStandardMaterial({
    map: opts.map,
    normalMap: opts.normalMap ?? null,
    roughnessMap: opts.roughnessMap ?? null,
    roughness: opts.roughness,
    metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
    envMapIntensity: opts.envIntensity ?? 1,
  });
  if (opts.normalMap) m.normalScale.set(0.35, 0.35);
  const uniforms = {
    uLines: { value: opts.lines },
    uLinesSize: { value: opts.linesSize },
    uLinesRough: { value: opts.linesRoughness ?? 0.45 },
    uLinesEmissive: { value: opts.emissiveLines ?? 0 },
    uTime: { value: 0 },
    uReflStrength: { value: opts.reflect ?? 0 },
  };
  (m as any).floorUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, reflectionUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosF;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPosF = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPosF;
uniform sampler2D uLines;
uniform vec2 uLinesSize;
uniform float uLinesRough;
uniform float uLinesEmissive;
uniform float uTime;
uniform sampler2D uRefl;
uniform mat4 uReflMatrix;
uniform float uReflOn;
uniform float uReflStrength;
vec4 floorLines;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec2 luv = vec2(vWorldPosF.x / uLinesSize.x + 0.5, 0.5 - vWorldPosF.z / uLinesSize.y);
  floorLines = vec4(0.0);
  if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) floorLines = texture2D(uLines, luv);
  diffuseColor.rgb = mix(diffuseColor.rgb, floorLines.rgb, floorLines.a);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, uLinesRough, floorLines.a);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
if (uReflOn > 0.5 && uReflStrength > 0.0) {
  // planar reflection: projective lookup, rippled by the normal map, blurred by roughness
  vec4 rc = uReflMatrix * vec4(vWorldPosF, 1.0);
  vec2 ruv = rc.xy / rc.w;
  #ifndef FLAT_SHADED
  ruv += (normal.xy - normalize(vNormal).xy) * 0.045;
  #endif
  float lod = clamp(pow(roughnessFactor, 1.35) * 7.0, 0.0, 6.5);
  vec4 refl = textureLod(uRefl, ruv, lod);
  refl += textureLod(uRefl, ruv + vec2(0.0035, 0.002) * (1.0 + lod), lod);
  refl += textureLod(uRefl, ruv - vec2(0.0035, 0.002) * (1.0 + lod), lod);
  refl /= 3.0;
  float edge = smoothstep(0.0, 0.04, ruv.x) * smoothstep(1.0, 0.96, ruv.x) * smoothstep(0.0, 0.04, ruv.y) * smoothstep(1.0, 0.96, ruv.y);
  float NdV = saturate(dot(normal, normalize(vViewPosition)));
  float fr = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  float gloss = 1.0 - roughnessFactor * 0.8;
  float s = min(uReflStrength, 1.0) * edge;
  float boost = max(uReflStrength - 1.0, 0.0);
  // premultiplied: objects occlude the (static) environment reflection behind them
  reflectedLight.indirectSpecular = reflectedLight.indirectSpecular * (1.0 - refl.a * s * 0.85)
    + refl.rgb * (fr * gloss) * (s + boost * edge);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += floorLines.rgb * floorLines.a * uLinesEmissive * (0.85 + 0.15 * sin(uTime * 2.0 + vWorldPosF.z * 0.6));`,
      );
  };
  m.customProgramCacheKey = () => 'court-floor-v2';
  return m;
}
