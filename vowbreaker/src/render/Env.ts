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
  /** how lived-in the place is: moss, stains, rust, cracks (0..1) */
  age = 0.5;
  /** posters and graffiti on walls (city stages) */
  urban = 0;
  /** 0 spring petals .. 0.5 summer leaves .. 1 autumn leaves */
  season = 0;
  /** fallen leaves and petals collecting in corners */
  litter = 0;
  rain = 0;
  snow = 0;
  ash = 0;
  frost = 0;
  /** cloud shadows sliding across the ground (0 = none) */
  clouds = 0;
  /** dappled light through leaves */
  dapples = 0;
  /** lit windows throwing light on the street at night */
  windows = 0;
  /** lightning flash brightness this frame (animated by the stage) */
  lightning = 0;
  moon = 0;
  /** the burning village's fire: position, radius, strength */
  fire = new Vector4(0, 2, 0, 0);
  fireStrength = 0;
  /** a passing train's light on the platform: front x, track z, dir * length, amount */
  train = new Vector4(0, 0, 0, 0);
}

const UNIFORMS = ['world', 'viewProjection', 'view', 'cameraPosition', 'envTime', 'sunDir', 'sunColor', 'skyColor', 'groundColor', 'shadowColor',
  'lightViewProj', 'shadowParams', 'pointPos', 'pointCol', 'envParams', 'envParams2', 'envParams3', 'envParams4', 'envParams5', 'envParams6', 'firePos',
  'glowColor', 'tintColor', 'cracks', 'domainParams', 'marksParams', 'trainLight', 'envTransform', 'envTransformPos'];

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
    attributes, defines, uniforms: UNIFORMS.slice(), samplers: ['shadowMap', 'marksA', 'marksB', 'marksRot'], shaderLanguage: ShaderLanguage.WGSL,
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
    mat.setVector4('envParams3', new Vector4(settings.age, settings.urban, settings.season, settings.litter));
    mat.setVector4('envParams4', new Vector4(settings.rain, settings.snow, settings.ash, settings.frost));
    mat.setVector4('envParams5', new Vector4(settings.clouds, settings.dapples, settings.windows, settings.lightning));
    mat.setVector4('envParams6', new Vector4(settings.moon, settings.fireStrength, l.windDir.x * settings.wind, l.windDir.z * settings.wind));
    mat.setVector4('firePos', settings.fire);
    mat.setColor3('glowColor', settings.glowColor);
    mat.setVector4('tintColor', settings.tint);
    mat.setArray4('cracks', Array.from(settings.cracks));
    mat.setVector4('trainLight', settings.train);
    mat.setVector4('envTransform', l.envTransform);
    mat.setVector4('envTransformPos', l.envTransformPos);
    mat.setVector4('domainParams', new Vector4(l.domainAmount, l.domainPalette, 0, 0));
    if (l.shadowMap) mat.setTexture('shadowMap', l.shadowMap);
    const mk = mats.marks;
    mat.setTexture('marksA', mk ? mk.texA : mats.dummy);
    mat.setTexture('marksB', mk ? mk.texB : mats.dummy);
    mat.setTexture('marksRot', mk ? mk.texRot : mats.dummy);
    mat.setVector4('marksParams', mk ? mk.params : new Vector4(0, 0, 0, 0));
  };
  push(mats.lighting);
  const off = mats.onUpdate(push);
  mat.onDisposeObservable.addOnce(off);
  mats.registerEnv(mat);
  return mat;
}
