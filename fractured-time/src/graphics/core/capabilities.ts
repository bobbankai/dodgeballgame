/**
 * What this device can do. Measured twice: before the renderer exists (to choose a backend and a first preset) and after
 * (the device the backend actually got: its features and limits). Nothing here guesses a GPU model from a string to pick
 * effects; the tier only seeds the first-run preset and every setting stays available.
 */
export type Backend = 'webgpu' | 'webgl2';

export interface Capabilities {
  /** WebGPU adapter available in this browser (before init) */
  webgpuAvailable: boolean;
  /** the backend the renderer runs on (after init) */
  backend: Backend;
  features: Set<string>;
  timestampQuery: boolean;
  float32Filterable: boolean;
  shaderF16: boolean;
  /** compute shaders and storage buffers (WebGPU backend) */
  compute: boolean;
  maxTexture2D: number;
  maxTexture3D: number;
  maxColorAttachments: number;
  touch: boolean;
  mobile: boolean;
  /** navigator.deviceMemory (GB), null where browsers hide it */
  memoryGB: number | null;
  cores: number;
  gpu: { vendor: string; architecture: string; description: string };
  reducedMotion: boolean;
  /** coarse class for the first-run preset only */
  tier: 'high' | 'mid' | 'low';
}

const qs = () => (typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams());

export function isTouchDevice(): boolean {
  if (qs().has('touch')) return true;
  if (typeof matchMedia === 'undefined') return false;
  return matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches;
}

export function isMobileDevice(): boolean {
  if (qs().has('touch')) return true;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (isTouchDevice() && navigator.maxTouchPoints > 1);
}

function isPhone(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Android|iPhone|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 600);
}

/** Before the renderer: is there a WebGPU adapter, and what is it. */
export async function probeCapabilities(): Promise<Capabilities> {
  const nav = navigator as Navigator & { gpu?: any; deviceMemory?: number };
  let adapter: any = null;
  if (nav.gpu && !qs().has('webgl')) {
    try { adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch { adapter = null; }
  }
  const info = adapter?.info ?? {};
  const features = new Set<string>(adapter ? [...adapter.features] : []);
  const touch = isTouchDevice();
  const mobile = isMobileDevice();
  const memoryGB = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  const cores = nav.hardwareConcurrency ?? 4;
  const tier: Capabilities['tier'] = mobile || (memoryGB !== null && memoryGB <= 4) ? 'low'
    : !adapter || /intel|integrated/i.test(`${info.vendor} ${info.architecture} ${info.description}`) ? 'mid' : 'high';
  return {
    webgpuAvailable: !!adapter,
    backend: adapter ? 'webgpu' : 'webgl2',
    features,
    timestampQuery: features.has('timestamp-query'),
    float32Filterable: features.has('float32-filterable'),
    shaderF16: features.has('shader-f16'),
    compute: !!adapter,
    maxTexture2D: adapter?.limits?.maxTextureDimension2D ?? 4096,
    maxTexture3D: adapter?.limits?.maxTextureDimension3D ?? 256,
    maxColorAttachments: adapter?.limits?.maxColorAttachments ?? 4,
    touch, mobile, memoryGB, cores,
    gpu: { vendor: info.vendor ?? '', architecture: info.architecture ?? '', description: info.description ?? '' },
    reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    tier,
  };
}

/** After init: the backend the renderer really runs on and the device's own features and limits. */
export function refineCapabilities(caps: Capabilities, renderer: { backend: any }): Capabilities {
  const be = renderer.backend;
  const webgpu = !!be?.isWebGPUBackend;
  const out = { ...caps, backend: (webgpu ? 'webgpu' : 'webgl2') as Backend, compute: webgpu };
  if (webgpu && be.device) {
    const d = be.device;
    out.features = new Set<string>([...d.features]);
    out.timestampQuery = out.features.has('timestamp-query');
    out.float32Filterable = out.features.has('float32-filterable');
    out.shaderF16 = out.features.has('shader-f16');
    out.maxTexture2D = d.limits.maxTextureDimension2D;
    out.maxTexture3D = d.limits.maxTextureDimension3D;
    out.maxColorAttachments = d.limits.maxColorAttachments;
  } else if (!webgpu) {
    out.features = new Set();
    out.timestampQuery = false;
    const gl = be?.gl as WebGL2RenderingContext | undefined;
    if (gl) {
      out.maxTexture2D = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      out.maxTexture3D = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
      out.maxColorAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS);
      out.float32Filterable = !!gl.getExtension('OES_texture_float_linear');
    }
  }
  return out;
}

/** First-run preset from the device (the player can change it in Settings). */
export function suggestPreset(caps: Capabilities): 'high' | 'medium' | 'performance' {
  if (isPhone()) return 'performance';
  if (caps.mobile || caps.tier === 'low') return 'medium';
  return 'high';
}

/** First-run preset without a probed adapter (menus, before the renderer exists). */
export function defaultPreset(): 'high' | 'medium' | 'performance' {
  if (typeof navigator === 'undefined') return 'high';
  if (isPhone()) return 'performance';
  return navigator.maxTouchPoints > 1 && typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
}
