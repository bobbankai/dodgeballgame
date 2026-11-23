/**
 * What the game is running on: decides the touch controls, the graphics defaults and the layout.
 * `?device=phone|tablet|desktop` overrides the guess (for testing) and `?touch=1|0` forces the
 * on-screen controls on or off.
 */
export type Tier = 'phone' | 'tablet' | 'desktop';

export interface DeviceInfo {
  /** the primary pointer is a finger (phones, tablets, not a laptop's touchscreen) */
  coarse: boolean;
  tier: Tier;
  /** ?touch=1 / ?touch=0, or null to decide from the device */
  forceTouch: boolean | null;
}

function detect(params: URLSearchParams): DeviceInfo {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const side = Math.min(screen.width || 0, screen.height || 0);
  const uaMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile === true
    || /Android|iPhone|iPod/i.test(navigator.userAgent);
  // iPadOS reports itself as a Mac: a Mac with a touchscreen is an iPad
  const ipad = /iPad/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  let tier: Tier = 'desktop';
  if (uaMobile || (coarse && side > 0 && side < 600)) tier = 'phone';
  else if (ipad || coarse) tier = 'tablet';
  const t = params.get('touch');
  const d = params.get('device');
  if (d === 'phone' || d === 'tablet' || d === 'desktop') tier = d;
  return { coarse: coarse || tier !== 'desktop', tier, forceTouch: t === '1' ? true : t === '0' ? false : null };
}

let info: DeviceInfo | null = null;

export function device(params: URLSearchParams = new URLSearchParams(location.search)): DeviceInfo {
  if (!info) info = detect(params);
  return info;
}

/** The graphics defaults for a tier: render scale cap, shadow map size, MSAA, starting quality. */
export function graphicsFor(tier: Tier): { dprCap: number; maxScale: number; shadowSize: number; msaa: 1 | 4; quality: 'high' | 'medium' | 'low'; adaptive: boolean } {
  switch (tier) {
    // phones start at one render pixel per CSS pixel and sharpen toward 1.5 if the frame rate allows
    case 'phone':
      return { dprCap: 1, maxScale: 1.5, shadowSize: 1024, msaa: 1, quality: 'low', adaptive: true };
    case 'tablet':
      return { dprCap: 1.25, maxScale: 2, shadowSize: 2048, msaa: 1, quality: 'medium', adaptive: true };
    default:
      return { dprCap: 1.5, maxScale: 1.5, shadowSize: 2048, msaa: 4, quality: 'high', adaptive: false };
  }
}

const KEY = 'vowbreaker.settings.v1';

export interface Prefs {
  quality?: 'high' | 'medium' | 'low';
  music?: number;
  sfx?: number;
  /** keep the screen awake and go fullscreen on the first touch (default on for phones) */
  fullscreen?: boolean;
}

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (p && typeof p === 'object') return p;
  } catch {
    /* private mode */
  }
  return {};
}

export function savePrefs(patch: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* ignore */
  }
}
