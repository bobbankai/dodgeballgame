import * as THREE from 'three';

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
  };
  (m as any).floorUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
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
vec4 floorLines;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec2 luv = vec2(vWorldPosF.x / uLinesSize.x + 0.5, 0.5 + vWorldPosF.z / uLinesSize.y);
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
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += floorLines.rgb * floorLines.a * uLinesEmissive * (0.85 + 0.15 * sin(uTime * 2.0 + vWorldPosF.z * 0.6));`,
      );
  };
  m.customProgramCacheKey = () => 'court-floor-v1';
  return m;
}
