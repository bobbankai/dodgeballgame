import { log } from './Log';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface GraphicsSettings {
  preset: QualityPreset;
  /** 0.5 - 1, fraction of native resolution; adaptive resolution moves below this when needed. */
  resolution: number;
  adaptiveResolution: boolean;
  shadows: 0 | 1 | 2 | 3;
  ambientOcclusion: boolean;
  reflections: boolean;
  volumetrics: boolean;
  bloom: boolean;
  motionBlur: boolean;
  depthOfField: boolean;
  antiAliasing: 'fxaa' | 'taa' | 'msaa';
  filmGrain: boolean;
  chromaticAberration: boolean;
  fpsLimit: 0 | 30 | 60;
  showFps: boolean;
}

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  ambience: number;
}

export interface ControlSettings {
  mouseSensitivity: number;
  stickSensitivity: number;
  invertY: boolean;
  /** action name -> key codes (KeyboardEvent.code, or Mouse0/Mouse1/Mouse2) */
  bindings: Record<string, string[]>;
  holdToBlock: boolean;
  autoLockOn: boolean;
  vibration: boolean;
}

export interface AccessibilitySettings {
  subtitles: boolean;
  subtitleSize: 'small' | 'medium' | 'large';
  speakerNames: boolean;
  cameraShake: number;
  flashReduction: boolean;
  highContrastHud: boolean;
  difficulty: 'story' | 'normal' | 'hard';
}

export interface SettingsData {
  version: number;
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlSettings;
  access: AccessibilitySettings;
}

export const DEFAULT_BINDINGS: Record<string, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  light: ['Mouse0', 'KeyJ'],
  heavy: ['Mouse2', 'KeyK'],
  dodge: ['Space'],
  jump: ['KeyF'],
  block: ['KeyQ', 'KeyL'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  lockOn: ['Mouse1', 'Tab'],
  interact: ['KeyE'],
  ability1: ['Digit1'],
  ability2: ['Digit2'],
  ability3: ['Digit3'],
  ability4: ['Digit4'],
  ultimate: ['KeyR'],
  heal: ['KeyH'],
  walk: ['ControlLeft'],
  pause: ['Escape'],
  journal: ['KeyN'],
  map: ['KeyM'],
  skills: ['KeyY'],
  inventory: ['KeyI'],
};

export function presetGraphics(preset: QualityPreset): GraphicsSettings {
  const base: GraphicsSettings = {
    preset,
    resolution: 1,
    adaptiveResolution: true,
    shadows: 2,
    ambientOcclusion: true,
    reflections: true,
    volumetrics: true,
    bloom: true,
    motionBlur: false,
    depthOfField: true,
    antiAliasing: 'msaa',
    filmGrain: true,
    chromaticAberration: true,
    fpsLimit: 0,
    showFps: false,
  };
  switch (preset) {
    case 'ultra':
      return { ...base, shadows: 3, antiAliasing: 'taa', motionBlur: true };
    case 'high':
      return base;
    case 'medium':
      return { ...base, shadows: 1, reflections: false, resolution: 0.85, antiAliasing: 'fxaa', chromaticAberration: false };
    case 'low':
      return {
        ...base, shadows: 1, ambientOcclusion: false, reflections: false, volumetrics: false, resolution: 0.7,
        antiAliasing: 'fxaa', depthOfField: false, filmGrain: false, chromaticAberration: false, fpsLimit: 30,
      };
  }
}

export function detectPreset(): QualityPreset {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  if (mobile) return 'low';
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mem >= 8 && cores >= 8) return 'high';
  return 'medium';
}

function defaults(): SettingsData {
  return {
    version: 1,
    graphics: presetGraphics(detectPreset()),
    audio: { master: 0.9, music: 0.7, sfx: 0.9, voice: 1, ambience: 0.8 },
    controls: {
      mouseSensitivity: 1,
      stickSensitivity: 1,
      invertY: false,
      bindings: structuredClone(DEFAULT_BINDINGS),
      holdToBlock: true,
      autoLockOn: false,
      vibration: true,
    },
    access: {
      subtitles: true,
      subtitleSize: 'medium',
      speakerNames: true,
      cameraShake: 1,
      flashReduction: false,
      highContrastHud: false,
      difficulty: 'normal',
    },
  };
}

const KEY = 'eclipse.settings.v1';

/** Settings persisted in localStorage. Listeners run when any value changes. */
export class Settings {
  data: SettingsData;
  private listeners = new Set<(s: SettingsData) => void>();

  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = merge(defaults(), JSON.parse(raw) as Partial<SettingsData>);
    } catch (e) {
      log.warn('settings: could not read saved settings', e);
    }
    const q = new URLSearchParams(location.search).get('quality') as QualityPreset | null;
    if (q && ['low', 'medium', 'high', 'ultra'].includes(q)) this.data.graphics = presetGraphics(q);
    // Developer override of single graphics options: ?gfx=ambientOcclusion:0,antiAliasing:fxaa
    const gfx = new URLSearchParams(location.search).get('gfx');
    if (gfx) {
      const g = this.data.graphics as unknown as Record<string, unknown>;
      for (const pair of gfx.split(',')) {
        const [k, v] = pair.split(':');
        if (!(k in g)) continue;
        g[k] = typeof g[k] === 'boolean' ? v === '1' || v === 'true' : typeof g[k] === 'number' ? Number(v) : v;
      }
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage can be unavailable (private mode); settings then last for the session */
    }
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn: (s: SettingsData) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  applyPreset(p: QualityPreset): void {
    this.data.graphics = presetGraphics(p);
    this.save();
  }

  resetControls(): void {
    this.data.controls.bindings = structuredClone(DEFAULT_BINDINGS);
    this.save();
  }
}

function merge<T>(base: T, over: Partial<T>): T {
  if (typeof base !== 'object' || base === null) return (over ?? base) as T;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over as object)) {
    const b = (base as Record<string, unknown>)[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = merge(b, v as Partial<typeof b>);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}
