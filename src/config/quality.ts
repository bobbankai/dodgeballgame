export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  level: QualityLevel;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  softShadows: boolean;
  bloom: boolean;
  smaa: boolean;
  msaa: number;
  screenFx: boolean;
  dof: boolean;
  /** Multiplier for particle counts. */
  particles: number;
  /** 0..1 fraction of spectator seats filled. */
  crowdDensity: number;
  /** Planar floor reflections. */
  reflections: boolean;
  reflectionScale: number;
  /** Extra decorative environment props. */
  envDetail: number;
  /** Afterimage ghosts, extra ribbons. */
  extraVfx: boolean;
  /** Screen-space ambient occlusion and its resolution scale. */
  ao: boolean;
  aoResolution: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityProfile> = {
  low: {
    level: 'low', maxPixelRatio: 1, shadows: false, shadowMapSize: 512, softShadows: false,
    bloom: false, smaa: false, msaa: 0, screenFx: false, dof: false, particles: 0.45,
    crowdDensity: 0.35, reflections: false, reflectionScale: 0.25, envDetail: 0.4, extraVfx: false, ao: false, aoResolution: 0.5,
  },
  medium: {
    level: 'medium', maxPixelRatio: 1.25, shadows: true, shadowMapSize: 1024, softShadows: false,
    bloom: true, smaa: true, msaa: 0, screenFx: true, dof: false, particles: 0.75,
    crowdDensity: 0.65, reflections: false, reflectionScale: 0.3, envDetail: 0.75, extraVfx: true, ao: false, aoResolution: 0.5,
  },
  high: {
    level: 'high', maxPixelRatio: 1.5, shadows: true, shadowMapSize: 2048, softShadows: true,
    bloom: true, smaa: true, msaa: 0, screenFx: true, dof: true, particles: 1,
    crowdDensity: 0.9, reflections: true, reflectionScale: 0.35, envDetail: 1, extraVfx: true, ao: true, aoResolution: 0.5,
  },
  ultra: {
    level: 'ultra', maxPixelRatio: 2, shadows: true, shadowMapSize: 4096, softShadows: true,
    bloom: true, smaa: true, msaa: 4, screenFx: true, dof: true, particles: 1.25,
    crowdDensity: 1, reflections: true, reflectionScale: 0.5, envDetail: 1, extraVfx: true, ao: true, aoResolution: 0.6,
  },
};
