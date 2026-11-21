import { AbstractMesh, Color3, ShaderLanguage, ShaderMaterial, Vector4 } from '@babylonjs/core';
import type { Lighting, Materials } from './Materials';

/** Stage-wide settings for the environment shader. */
export class EnvSettings {
  wetness = 0;
  hatching = 0.5;
  threshold = 0.5;
  bump = 1;
  puddles = 0.55;
  glowBoost = 0;
  saturation = 1;
  glowColor = new Color3(1.0, 0.62, 0.3);
  tint = new Vector4(1, 1, 1, 0);
  wind = 1;
  /** up to 8 floor cracks: x, z, radius, palette (-1 = none) */
  cracks = new Float32Array(32).fill(-1);
}

const UNIFORMS = ['world', 'viewProjection', 'view', 'cameraPosition', 'envTime', 'sunDir', 'sunColor', 'skyColor', 'groundColor', 'shadowColor',
  'lightViewProj', 'shadowParams', 'pointPos', 'pointCol', 'envParams', 'envParams2', 'glowColor', 'tintColor', 'cracks', 'domainParams'];

export function envMaterial(mats: Materials, mesh: AbstractMesh, settings: EnvSettings): ShaderMaterial {
  // vertex colour alpha carries pattern ids, not transparency
  mesh.hasVertexAlpha = false;
  const attributes = ['position', 'normal'];
  const defines: string[] = [];
  if (mesh.isVerticesDataPresent('uv')) {
    attributes.push('uv');
    defines.push('UV1');
  }
  const mat = new ShaderMaterial('env_' + mesh.name, mats.scene, { vertex: 'env', fragment: 'env' }, {
    attributes, defines, uniforms: UNIFORMS.slice(), samplers: ['shadowMap'], shaderLanguage: ShaderLanguage.WGSL,
  });
  mat.backFaceCulling = false;
  mat.setTexture('shadowMap', mats.lighting.shadowMap ?? mats.dummy);
  const push = (l: Lighting) => {
    mat.setVector4('envTime', new Vector4(l.time, settings.wind, l.windDir.x, l.windDir.z));
    mat.setVector3('sunDir', l.sunDir);
    mat.setColor3('sunColor', l.sunColor);
    mat.setColor3('skyColor', l.skyColor);
    mat.setColor3('groundColor', l.groundColor);
    mat.setColor3('shadowColor', l.shadowColor);
    mat.setMatrix('lightViewProj', l.lightViewProj);
    mat.setVector4('shadowParams', new Vector4(l.shadowSize, l.shadowBias * 1.5, 1.2, l.shadowMap ? l.shadowsOn : 0));
    mat.setArray4('pointPos', Array.from(l.pointPos));
    mat.setArray4('pointCol', Array.from(l.pointCol));
    mat.setVector4('envParams', new Vector4(l.time, settings.wetness, settings.hatching, settings.threshold));
    mat.setVector4('envParams2', new Vector4(settings.bump, settings.puddles, settings.glowBoost, settings.saturation));
    mat.setColor3('glowColor', settings.glowColor);
    mat.setVector4('tintColor', settings.tint);
    mat.setArray4('cracks', Array.from(settings.cracks));
    mat.setVector4('domainParams', new Vector4(l.domainAmount, l.domainPalette, 0, 0));
    if (l.shadowMap) mat.setTexture('shadowMap', l.shadowMap);
  };
  push(mats.lighting);
  const off = mats.onUpdate(push);
  mat.onDisposeObservable.addOnce(off);
  mats.registerEnv(mat);
  return mat;
}
