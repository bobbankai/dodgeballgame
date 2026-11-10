// The surface plugin: one piece of shader code injected into every PBR material in the game. It adds what the
// stock PBR shader does not know about a fight: rain (wet darkening, gloss, ripples on anything facing up),
// skin that bruises, flushes and sweats, a back-light rim, and the white flash of a clean hit.
import { Color3, MaterialDefines, MaterialPluginBase, PBRBaseMaterial, ShaderLanguage, UniformBuffer } from '@babylonjs/core';
import { NOISE, sl } from './sl';

export type SurfaceKind = 'skin' | 'cloth' | 'hair' | 'fuzz' | 'hard' | 'ground';

/** Scene-wide inputs, set by the stage and the weather. */
export const surfaceGlobals = { wet: 0, time: 0, rim: new Color3(0, 0, 0), rimPower: 3.0 };

const DEFS = NOISE + `
// expanding rings where drops land: a grid of cells, each firing at its own phase
fn tbRipple(p: V2, t: F) -> V2 {
  var n: V2 = V2(0.0, 0.0);
  for (var k: I = 0; k < 2; k++) {
    let sc: F = 5.0 + 3.7 * F(k);
    let cell: V2 = floor(p * sc); let h: F = tbHash(cell + 7.3 * F(k));
    let ph: F = fract(t * (0.7 + 0.6 * h) + h * 9.0);
    let c: V2 = fract(p * sc) - 0.5 - 0.3 * (V2(tbHash(cell + 3.1), tbHash(cell + 5.7)) - 0.5);
    let d: F = length(c);
    let w: F = sin((d - ph * 0.5) * 48.0) * smoothstep(0.08, 0.0, abs(d - ph * 0.5)) * (1.0 - ph);
    n += c / max(d, 0.001) * w;
  }
  return n;
}
// where a face takes its bruises: two blotches under the eyes and one on the brow, in head UV space
fn tbBruise(uv: V2, amount: F) -> F {
  let n: F = tbFbm(uv * 26.0);
  let a: F = smoothstep(0.075, 0.02, length((uv - V2(0.335, 0.435)) * V2(1.0, 0.55)) * (0.7 + 0.6 * n));
  let b: F = smoothstep(0.075, 0.02, length((uv - V2(0.335, 0.565)) * V2(1.0, 0.55)) * (0.7 + 0.6 * n));
  let c: F = smoothstep(0.05, 0.01, length((uv - V2(0.245, 0.455)) * V2(1.0, 0.6)) * (0.7 + 0.6 * n));
  return saturate((a * smoothstep(0.15, 0.55, amount) + b * smoothstep(0.4, 0.85, amount) + c * smoothstep(0.6, 1.0, amount)) * 0.85);
}
`;

const ALBEDO = `
#ifdef TB_FUZZ
  // soft hair has no hard outline: wear the silhouette away with noise that sticks to the surface
  #ifdef ALBEDO
  let tbFz: V2 = IN.vAlbedoUV;
  #elif defined(BUMP)
  let tbFz: V2 = IN.vBumpUV;
  #else
  let tbFz: V2 = IN.vPositionW.xy * 20.0;
  #endif
  if (abs(dot(normalW, viewDirectionW)) + (tbNoise(tbFz * 9.0) - 0.5) * 0.55 + (tbNoise(tbFz * 31.0) - 0.5) * 0.25 < U.tbMat.w) { discard; }
#endif
let tbUp: F = saturate(normalW.y * 1.4);
let tbWetK: F = U.tbEnv.x * (0.3 + 0.7 * tbUp);
#ifdef TB_SKIN
  #ifdef ALBEDO
  let tbBr: F = tbBruise(IN.vAlbedoUV, U.tbFx.y) * U.tbFx.z;
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * V3(0.50, 0.26, 0.40) + V3(0.02, 0.0, 0.015), tbBr);
  #endif
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * V3(1.16, 0.88, 0.84), saturate(U.tbFx.y * 0.6));
  surfaceAlbedo = surfaceAlbedo * (1.0 - 0.10 * tbWetK);
#else
  surfaceAlbedo = surfaceAlbedo * (1.0 - 0.38 * tbWetK * U.tbMat.x);
#endif
`;

const ROUGH = `
#ifdef TB_SKIN
  let tbBeads: F = smoothstep(0.62, 0.9, tbNoise(IN.vPositionW.xy * 190.0 + IN.vPositionW.z * 90.0));
  roughness = mix(roughness, 0.16, saturate(U.tbEnv.x * 0.75 + U.tbFx.y * 0.45 * (0.5 + 0.5 * tbBeads)));
#else
  roughness = mix(roughness, 0.06 + 0.25 * (1.0 - U.tbMat.y), saturate(tbWetK * (0.55 + 0.6 * tbFbm(IN.vPositionW.xz * 1.7)) * U.tbMat.y * 1.5));
#endif
microSurface = 1.0 - roughness;
`;

const NORMAL = `
#ifdef TB_GROUND
  normalW = normalize(normalW + V3(1.0, 0.0, 0.0) * tbRipple(IN.vPositionW.xz, U.tbEnv.y).x * 0.35 * U.tbEnv.x * tbUp + V3(0.0, 0.0, 1.0) * tbRipple(IN.vPositionW.xz, U.tbEnv.y).y * 0.35 * U.tbEnv.x * tbUp);
#endif
`;

const FINAL = `
let tbFres: F = pow(1.0 - saturate(dot(normalW, viewDirectionW)), U.tbEnv.z);
finalColor = V4(finalColor.rgb + U.tbRim * tbFres * U.tbMat.z + V3(1.0, 0.92, 0.82) * U.tbFx.x * (0.35 + 0.65 * tbFres), finalColor.a);
`;

export class SurfacePlugin extends MaterialPluginBase {
  /** hit flash 0..1 */ flash = 0;
  /** how hurt the fighter is, 0..1: bruises, flush, sweat */ damage = 0;
  /** how much of the material darkens when wet (cloth, concrete: 1; metal, skin: 0) */ porous = 1;
  /** how glossy rain makes it */ sheen = 1;
  /** rim light strength */ rim = 1;
  /** only the head material shows bruises */ bruises = 0;
  /** fuzz: how far in from the outline the surface is worn away (0..1 of facing ratio) */ erode = 0.3;

  constructor(material: PBRBaseMaterial, public kind: SurfaceKind) {
    super(material, 'TbSurface', 200, { TB_SKIN: false, TB_GROUND: false, TB_FUZZ: false });
    this._enable(true);
  }

  getClassName() { return 'SurfacePlugin'; }
  isCompatible() { return true; }

  prepareDefines(defines: MaterialDefines) {
    defines.TB_SKIN = this.kind === 'skin';
    defines.TB_GROUND = this.kind === 'ground';
    defines.TB_FUZZ = this.kind === 'fuzz';
  }

  getUniforms() {
    return {
      ubo: [{ name: 'tbEnv', size: 4, type: 'vec4' }, { name: 'tbFx', size: 4, type: 'vec4' }, { name: 'tbMat', size: 4, type: 'vec4' }, { name: 'tbRim', size: 3, type: 'vec3' }],
      fragment: 'uniform vec4 tbEnv; uniform vec4 tbFx; uniform vec4 tbMat; uniform vec3 tbRim;',
    };
  }

  bindForSubMesh(ubo: UniformBuffer) {
    const g = surfaceGlobals;
    ubo.updateFloat4('tbEnv', g.wet, g.time, g.rimPower, 0);
    ubo.updateFloat4('tbFx', this.flash, this.damage, this.bruises, 0);
    ubo.updateFloat4('tbMat', this.porous, this.sheen, this.rim, this.erode);
    ubo.updateColor3('tbRim', g.rim);
  }

  getCustomCode(shaderType: string, lang: ShaderLanguage) {
    if (shaderType !== 'fragment') return null;
    const w = lang === ShaderLanguage.WGSL;
    const rough = w ? '!var roughness: f32=reflectivityOut\\.roughness;' : '!float roughness=reflectivityOut\\.roughness;';
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: sl(DEFS, w),
      CUSTOM_FRAGMENT_UPDATE_ALPHA: sl(ALBEDO, w),
      [rough]: '$0\n' + sl(ROUGH, w),
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: sl(NORMAL, w),
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: sl(FINAL, w),
    };
  }
}
