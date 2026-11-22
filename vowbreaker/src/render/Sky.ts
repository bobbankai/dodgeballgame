import { Color3, Mesh, MeshBuilder, Scene, ShaderLanguage, ShaderMaterial, Vector3, Vector4 } from '@babylonjs/core';
import type { Lighting } from './Materials';

export interface SkyMood {
  zenith: Color3;
  horizon: Color3;
  ground: Color3;
  sunColor: Color3;
  moonDir?: Vector3;
  moonColor?: Color3;
  cloudColor: Color3;
  cloudShadow: Color3;
  cloudCover: number;
  stars: number;
  sunSize: number;
  moonPhase?: number;
  horizonGlow: number;
  cursed?: number;
  cursedColor?: Color3;
  festival?: number;
  festivalColor?: Color3;
  /** thin high wisps */
  cirrus?: number;
  /** light fingers through cloud gaps */
  fingers?: number;
  /** fireworks over the festival */
  fireworks?: number;
  /** a rainbow opposite the sun */
  rainbow?: number;
  /** sky lanterns rising (the Night Parade) */
  lanterns?: number;
  shootingStars?: number;
  /** curtains of aurora in the north (cold clear nights) */
  aurora?: number;
  /** a flock of crows wheeling (dusk) */
  crows?: number;
  /** rays fanning from a low sun behind clouds */
  sunburst?: number;
}

/** The sky dome (vb sky shader): follows the camera, drawn behind everything. */
export class Sky {
  /** a lightning flash in the sky right now (0..1) and the strike it belongs to */
  lightning = 0;
  boltSeed = 0;
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  mood: SkyMood;

  constructor(scene: Scene, private lighting: Lighting) {
    this.mesh = MeshBuilder.CreateSphere('sky', { diameter: 900, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mat = new ShaderMaterial('skyMat', scene, { vertex: 'sky', fragment: 'sky' }, {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'zenith', 'horizon', 'ground', 'sunDir', 'sunColor', 'moonDir', 'moonColor', 'cloudColor', 'cloudShadow',
        'skyParams', 'skyParams2', 'skyParams3', 'skyParams4', 'skyParams5', 'skyParams6', 'cursedColor', 'festivalColor'],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mesh.material = this.mat;
    this.mesh.renderingGroupId = 0;
    this.mood = DUSK;
  }

  update(): void {
    const m = this.mood;
    const t = this.mat;
    t.setColor3('zenith', m.zenith);
    t.setColor3('horizon', m.horizon);
    t.setColor3('ground', m.ground);
    t.setVector3('sunDir', this.lighting.sunDir);
    t.setColor3('sunColor', m.sunColor);
    t.setVector3('moonDir', (m.moonDir ?? new Vector3(0.3, 0.5, 0.8)).normalizeToNew());
    t.setColor3('moonColor', m.moonColor ?? new Color3(0, 0, 0));
    t.setColor3('cloudColor', m.cloudColor);
    t.setColor3('cloudShadow', m.cloudShadow);
    t.setVector4('skyParams', new Vector4(this.lighting.time, m.cloudCover, m.stars, m.sunSize));
    t.setVector4('skyParams2', new Vector4(m.moonPhase ?? 0, m.horizonGlow, m.cursed ?? 0, m.festival ?? 0));
    t.setVector4('skyParams3', new Vector4(m.cirrus ?? 0.3, m.fingers ?? 0, m.fireworks ?? 0, m.rainbow ?? 0));
    t.setVector4('skyParams4', new Vector4(m.lanterns ?? 0, m.shootingStars ?? 0, 0, 0));
    t.setVector4('skyParams5', new Vector4(this.lightning, this.boltSeed, m.aurora ?? 0, m.crows ?? 0));
    t.setVector4('skyParams6', new Vector4(m.sunburst ?? 0, 0, 0, 0));
    t.setColor3('cursedColor', m.cursedColor ?? new Color3(0.8, 0.05, 0.05));
    t.setColor3('festivalColor', m.festivalColor ?? new Color3(1, 0.45, 0.15));
  }
}

const c = (r: number, g: number, b: number) => new Color3(r, g, b);

export const DUSK: SkyMood = {
  zenith: c(0.12, 0.16, 0.38), horizon: c(1.0, 0.55, 0.32), ground: c(0.12, 0.1, 0.12), sunColor: c(1.6, 0.9, 0.5),
  cloudColor: c(1.0, 0.62, 0.48), cloudShadow: c(0.42, 0.3, 0.45), cloudCover: 0.45, stars: 0.0, sunSize: 0.035, horizonGlow: 0.8, cirrus: 0.5, fingers: 0.5, crows: 1, sunburst: 0.4,
};

export const DAWN: SkyMood = {
  zenith: c(0.28, 0.42, 0.78), horizon: c(1.0, 0.8, 0.66), ground: c(0.25, 0.24, 0.26), sunColor: c(1.4, 1.05, 0.8),
  cloudColor: c(1.05, 0.92, 0.88), cloudShadow: c(0.62, 0.6, 0.75), cloudCover: 0.4, stars: 0, sunSize: 0.03, horizonGlow: 0.5, cirrus: 0.6, fingers: 0.6,
};

export const NIGHT_RAIN: SkyMood = {
  zenith: c(0.02, 0.025, 0.05), horizon: c(0.1, 0.11, 0.16), ground: c(0.03, 0.03, 0.04), sunColor: c(0.3, 0.35, 0.5),
  moonColor: c(0, 0, 0), cloudColor: c(0.12, 0.13, 0.17), cloudShadow: c(0.04, 0.045, 0.06), cloudCover: 0.95, stars: 0, sunSize: 0.0, horizonGlow: 0.15,
  festival: 0.4, festivalColor: c(0.6, 0.25, 0.5),
};

export const MOONLIT: SkyMood = {
  zenith: c(0.015, 0.03, 0.08), horizon: c(0.12, 0.18, 0.32), ground: c(0.03, 0.04, 0.06), sunColor: c(0.5, 0.6, 0.85),
  moonDir: new Vector3(-0.4, 0.45, 0.8), moonColor: c(1.2, 1.25, 1.4), cloudColor: c(0.3, 0.35, 0.5), cloudShadow: c(0.08, 0.1, 0.16),
  cloudCover: 0.35, stars: 1, sunSize: 0.0, moonPhase: 0.25, horizonGlow: 0.2, cirrus: 0.4, shootingStars: 0.6, aurora: 0.7,
};

export const FESTIVAL: SkyMood = {
  zenith: c(0.02, 0.02, 0.07), horizon: c(0.25, 0.12, 0.2), ground: c(0.04, 0.03, 0.05), sunColor: c(0.4, 0.3, 0.5),
  moonDir: new Vector3(0.5, 0.6, -0.6), moonColor: c(1.3, 1.1, 0.9), cloudColor: c(0.2, 0.15, 0.25), cloudShadow: c(0.06, 0.04, 0.08),
  cloudCover: 0.25, stars: 0.8, sunSize: 0.0, moonPhase: 0.0, horizonGlow: 0.3, festival: 1.0, festivalColor: c(1.2, 0.5, 0.18), fireworks: 1, lanterns: 0.4,
};

export const CURSED: SkyMood = {
  zenith: c(0.05, 0.0, 0.01), horizon: c(0.6, 0.08, 0.05), ground: c(0.05, 0.01, 0.01), sunColor: c(1.2, 0.2, 0.1),
  cloudColor: c(0.3, 0.05, 0.05), cloudShadow: c(0.08, 0.0, 0.01), cloudCover: 0.0, stars: 0, sunSize: 0.0, horizonGlow: 0.4,
  cursed: 1, cursedColor: c(0.85, 0.07, 0.06), festival: 0.6, festivalColor: c(1.0, 0.3, 0.1), lanterns: 1,
};

export const DAY: SkyMood = {
  zenith: c(0.18, 0.38, 0.85), horizon: c(0.75, 0.85, 1.0), ground: c(0.3, 0.3, 0.28), sunColor: c(1.5, 1.4, 1.25),
  cloudColor: c(1.2, 1.2, 1.25), cloudShadow: c(0.65, 0.7, 0.85), cloudCover: 0.45, stars: 0, sunSize: 0.03, horizonGlow: 0.2, cirrus: 0.5,
};

export const SPRING: SkyMood = {
  zenith: c(0.3, 0.5, 0.9), horizon: c(1.0, 0.85, 0.82), ground: c(0.3, 0.28, 0.3), sunColor: c(1.5, 1.3, 1.1),
  cloudColor: c(1.2, 1.12, 1.15), cloudShadow: c(0.75, 0.7, 0.85), cloudCover: 0.35, stars: 0, sunSize: 0.03, horizonGlow: 0.35, cirrus: 0.4, rainbow: 1, fingers: 0.3,
};

export const FIRE: SkyMood = {
  zenith: c(0.05, 0.01, 0.0), horizon: c(0.9, 0.3, 0.05), ground: c(0.1, 0.03, 0.01), sunColor: c(1.0, 0.4, 0.1),
  cloudColor: c(0.25, 0.1, 0.06), cloudShadow: c(0.06, 0.02, 0.01), cloudCover: 0.8, stars: 0, sunSize: 0.0, horizonGlow: 1.0,
  festival: 1.0, festivalColor: c(1.4, 0.4, 0.05),
};
