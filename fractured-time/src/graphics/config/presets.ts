/**
 * Graphics settings: five presets and the independent settings they are made of. A preset is only a starting point; any
 * setting can be changed on its own (the preset then reads "custom"). Everything the renderer does is decided here, so a
 * preset change is one object swap and a frame-graph rebuild.
 */
export type PresetName = 'ultra' | 'high' | 'medium' | 'low' | 'performance';
export const PRESET_NAMES: PresetName[] = ['ultra', 'high', 'medium', 'low', 'performance'];

export type AntiAliasing = 'taa' | 'smaa' | 'fxaa' | 'none';
export type AmbientOcclusion = 'ssgi' | 'gtao' | 'off';
export type Reflections = 'full' | 'half' | 'off';
export type ToneMapper = 'agx' | 'aces' | 'neutral' | 'filmic';

export interface GraphicsSettings {
  /** the preset these settings came from ('custom' once anything was changed by hand) */
  preset: PresetName | 'custom';
  // --- resolution ---------------------------------------------------------------------------------------------------
  /** render resolution as a fraction of the display (desktop; touch devices use `touchLines`) */
  renderScale: number;
  /** cap on devicePixelRatio (desktop) */
  maxPixelRatio: number;
  /** render height in lines on phones and tablets (a pixel-ratio cap smears a 3x phone screen) */
  touchLines: number;
  /** lower the render scale when frames run long, raise it again when there is headroom */
  dynamicResolution: boolean;
  /** the frame rate dynamic resolution defends */
  targetFps: number;
  /** dynamic resolution never goes below this fraction of the preset's own scale */
  minDynamicScale: number;
  // --- anti-aliasing ------------------------------------------------------------------------------------------------
  antialias: AntiAliasing;
  /** contrast-adaptive sharpening after the temporal resolve (0 = off .. 1 = strong) */
  sharpen: number;
  // --- lighting -----------------------------------------------------------------------------------------------------
  /** screen-space indirect light: SSGI (bounce + AO), GTAO (AO only) or none */
  ao: AmbientOcclusion;
  /** resolution of the AO / GI buffers (fraction of the render) */
  aoScale: number;
  /** screen-space reflections */
  ssr: Reflections;
  /** screen-space contact shadows for the dominant light */
  contactShadows: boolean;
  /** shadows of moving objects (characters, doors) cast onto the baked world: 0 = off, else the shadow map size */
  dynamicShadows: number;
  /** soft capsule shadows under characters (the skeleton as capsules) */
  capsuleShadows: boolean;
  // --- atmosphere ---------------------------------------------------------------------------------------------------
  /** volumetric fog samples per pixel (0 = analytic distance fog only) */
  fogSteps: number;
  // --- post ---------------------------------------------------------------------------------------------------------
  autoExposure: boolean;
  toneMapper: ToneMapper;
  bloom: boolean;
  depthOfField: boolean;
  motionBlur: boolean;
  chromaticAberration: boolean;
  filmGrain: boolean;
  // --- materials ----------------------------------------------------------------------------------------------------
  /** parallax occlusion steps on scanned surfaces (0 = flat) */
  pomSteps: number;
  /** hair shell layers (coily hair) */
  hairShells: number;
  /** texture anisotropy */
  anisotropy: number;
  /** largest lightmap edge kept in memory (px); larger maps are halved on load */
  lightmapLimit: number;
  // --- effects ------------------------------------------------------------------------------------------------------
  /** particle count multiplier (sparks, rain) */
  particles: number;
}

const base: Omit<GraphicsSettings, 'preset'> = {
  renderScale: 1, maxPixelRatio: 1.5, touchLines: 900, dynamicResolution: true, targetFps: 60, minDynamicScale: 0.7,
  antialias: 'taa', sharpen: 0.25,
  ao: 'gtao', aoScale: 0.5, ssr: 'half', contactShadows: true, dynamicShadows: 2048, capsuleShadows: true,
  fogSteps: 32,
  autoExposure: true, toneMapper: 'agx', bloom: true, depthOfField: true, motionBlur: false, chromaticAberration: true, filmGrain: true,
  pomSteps: 16, hairShells: 22, anisotropy: 8, lightmapLimit: 4096,
  particles: 0.75,
};

export const PRESETS: Record<PresetName, GraphicsSettings> = {
  ultra: {
    ...base, preset: 'ultra', maxPixelRatio: 2, touchLines: 1080, ao: 'ssgi', aoScale: 0.75, ssr: 'full', dynamicShadows: 4096,
    fogSteps: 48, motionBlur: true, pomSteps: 24, hairShells: 30, anisotropy: 16, particles: 1, sharpen: 0.2,
  },
  high: { ...base, preset: 'high' },
  medium: {
    ...base, preset: 'medium', renderScale: 0.85, maxPixelRatio: 1.25, touchLines: 720, aoScale: 0.4, ssr: 'off', dynamicShadows: 1024,
    fogSteps: 18, depthOfField: false, chromaticAberration: false, pomSteps: 10, hairShells: 16, particles: 0.5, sharpen: 0.35,
  },
  low: {
    ...base, preset: 'low', renderScale: 0.75, maxPixelRatio: 1, touchLines: 630, antialias: 'fxaa', sharpen: 0, aoScale: 0.3, ssr: 'off',
    contactShadows: false, dynamicShadows: 1024, fogSteps: 10, depthOfField: false, chromaticAberration: false, filmGrain: false,
    pomSteps: 0, hairShells: 14, anisotropy: 4, lightmapLimit: 2048, particles: 0.35,
  },
  performance: {
    ...base, preset: 'performance', renderScale: 0.67, maxPixelRatio: 1, touchLines: 540, antialias: 'fxaa', sharpen: 0, ao: 'off',
    aoScale: 0.25, ssr: 'off', contactShadows: false, dynamicShadows: 0, fogSteps: 0, bloom: false, depthOfField: false,
    chromaticAberration: false, filmGrain: false, pomSteps: 0, hairShells: 12, anisotropy: 4, lightmapLimit: 1024, particles: 0.25,
  },
};

/** Older saves stored four presets; 'balanced' became 'medium'. */
export function normalisePreset(name: string | null | undefined): PresetName | null {
  if (!name) return null;
  if (name === 'balanced') return 'medium';
  return (PRESET_NAMES as string[]).includes(name) ? (name as PresetName) : null;
}

const KEY = 'ft.gfx';

/** Settings saved on this device: a preset plus any settings changed by hand. */
export function loadSettings(fallback: PresetName): GraphicsSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as { preset?: string; overrides?: Partial<GraphicsSettings> };
      const p = normalisePreset(j.preset) ?? fallback;
      const s = { ...PRESETS[p], ...(j.overrides ?? {}) };
      if (j.overrides && Object.keys(j.overrides).length) s.preset = 'custom';
      return s;
    }
    const old = normalisePreset(localStorage.getItem('ft.quality'));
    if (old) return { ...PRESETS[old] };
  } catch { /* storage unavailable */ }
  return { ...PRESETS[fallback] };
}

export function saveSettings(s: GraphicsSettings, from: PresetName): void {
  const overrides: Partial<GraphicsSettings> = {};
  const ref = PRESETS[from] as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(s)) if (k !== 'preset' && ref[k] !== v) (overrides as Record<string, unknown>)[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify({ preset: from, overrides })); } catch { /* storage unavailable */ }
}

/** `?gfx.<setting>=<value>` overrides for tests (e.g. `?gfx.ao=off&gfx.fogSteps=0`). */
export function urlOverrides(qs: URLSearchParams): Partial<GraphicsSettings> {
  const out: Record<string, unknown> = {};
  const ref = PRESETS.high as unknown as Record<string, unknown>;
  for (const [k, v] of qs) {
    if (!k.startsWith('gfx.')) continue;
    const name = k.slice(4);
    if (!(name in ref)) continue;
    const t = typeof ref[name];
    out[name] = t === 'number' ? Number(v) : t === 'boolean' ? v !== '0' && v !== 'false' : v;
  }
  return out as Partial<GraphicsSettings>;
}
