export type QualityName = 'ultra' | 'high' | 'balanced' | 'performance';

export interface Quality {
  name: QualityName;
  /** Render resolution as a fraction of the display size (before devicePixelRatio cap). */
  resolutionScale: number;
  maxPixelRatio: number;
  shadowMap: number;
  shadowCascades: number;
  ao: 'none' | 'gtao' | 'ssgi';
  aoScale: number;
  ssr: boolean;
  bloom: boolean;
  dof: boolean;
  motionBlur: boolean;
  chromatic: boolean;
  grain: boolean;
  particles: number; // multiplier
  fog: boolean;
  antialias: 'none' | 'fxaa' | 'smaa' | 'taa';
}

export const QUALITY: Record<QualityName, Quality> = {
  ultra: {
    name: 'ultra', resolutionScale: 1, maxPixelRatio: 2, shadowMap: 4096, shadowCascades: 3, ao: 'ssgi', aoScale: 0.75, ssr: true,
    bloom: true, dof: true, motionBlur: true, chromatic: true, grain: true, particles: 1, fog: true, antialias: 'smaa',
  },
  high: {
    name: 'high', resolutionScale: 1, maxPixelRatio: 1.5, shadowMap: 2048, shadowCascades: 3, ao: 'gtao', aoScale: 0.5, ssr: false,
    bloom: true, dof: true, motionBlur: false, chromatic: true, grain: true, particles: 0.75, fog: true, antialias: 'smaa',
  },
  balanced: {
    name: 'balanced', resolutionScale: 0.85, maxPixelRatio: 1.25, shadowMap: 1024, shadowCascades: 2, ao: 'gtao', aoScale: 0.35, ssr: false,
    bloom: true, dof: false, motionBlur: false, chromatic: false, grain: false, particles: 0.5, fog: true, antialias: 'fxaa',
  },
  performance: {
    name: 'performance', resolutionScale: 0.67, maxPixelRatio: 1, shadowMap: 1024, shadowCascades: 1, ao: 'none', aoScale: 0.25, ssr: false,
    bloom: false, dof: false, motionBlur: false, chromatic: false, grain: false, particles: 0.25, fog: false, antialias: 'fxaa',
  },
};

export function detectQuality(): QualityName {
  const q = new URLSearchParams(location.search).get('quality') as QualityName | null;
  if (q && q in QUALITY) return q;
  try {
    const saved = localStorage.getItem('ft.quality') as QualityName | null;
    if (saved && saved in QUALITY) return saved;
  } catch { /* storage unavailable */ }
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
  return mobile ? 'performance' : 'high';
}
