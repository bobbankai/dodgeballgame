// Graphics presets. Every effect has a cheaper fallback rather than simply switching off, so the
// game keeps its look on Performance (see docs/RENDERING.md for what each one costs).

export type QualityName = 'ultra' | 'high' | 'performance';

export interface Quality {
  name: QualityName;
  /** device pixel ratio cap; the adaptive scaler works below this */
  maxPixelRatio: number;
  /** lowest render scale the adaptive resolution may drop to */
  minScale: number;
  msaa: number;
  smaa: boolean;
  shadowSize: number;
  cascades: number;
  shadowFar: number;
  /** soft shadow filter radius in texels */
  shadowRadius: number;
  ao: boolean;
  aoHalfRes: boolean;
  aoSamples: number;
  /** ray-marched sun shafts through the fog (else analytic height fog only) */
  volumetric: boolean;
  volSteps: number;
  bloom: boolean;
  dof: boolean;
  motionBlur: boolean;
  /** screen-space reflections on wet / polished surfaces (else probe reflections only) */
  ssr: boolean;
  grassDensity: number;
  particleScale: number;
  anisotropy: number;
  planarReflection: number; // render-target scale for water mirrors, 0 = env map only
  envSize: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  ultra: {
    name: 'ultra', maxPixelRatio: 2, minScale: 0.75, msaa: 4, smaa: true,
    shadowSize: 4096, cascades: 4, shadowFar: 160, shadowRadius: 3,
    ao: true, aoHalfRes: false, aoSamples: 16, volumetric: true, volSteps: 48,
    bloom: true, dof: true, motionBlur: true, ssr: true, grassDensity: 1, particleScale: 1,
    anisotropy: 16, planarReflection: 0.75, envSize: 512,
  },
  high: {
    name: 'high', maxPixelRatio: 1.5, minScale: 0.7, msaa: 2, smaa: true,
    shadowSize: 2048, cascades: 3, shadowFar: 120, shadowRadius: 2.5,
    ao: true, aoHalfRes: true, aoSamples: 12, volumetric: true, volSteps: 28,
    bloom: true, dof: true, motionBlur: true, ssr: false, grassDensity: 0.65, particleScale: 0.75,
    anisotropy: 8, planarReflection: 0.5, envSize: 256,
  },
  performance: {
    name: 'performance', maxPixelRatio: 1, minScale: 0.6, msaa: 0, smaa: true,
    shadowSize: 1024, cascades: 2, shadowFar: 70, shadowRadius: 2,
    ao: false, aoHalfRes: true, aoSamples: 8, volumetric: false, volSteps: 12,
    bloom: true, dof: false, motionBlur: false, ssr: false, grassDensity: 0.3, particleScale: 0.45,
    anisotropy: 4, planarReflection: 0, envSize: 128,
  },
};

export function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
}

export function initialQuality(): QualityName {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'ultra' || q === 'high' || q === 'performance') return q;
  try {
    const saved = localStorage.getItem('emberfall.quality');
    if (saved === 'ultra' || saved === 'high' || saved === 'performance') return saved;
  } catch { /* storage blocked */ }
  return isMobile() ? 'performance' : 'high';
}
