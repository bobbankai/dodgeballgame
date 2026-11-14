import * as THREE from 'three/webgpu';
import { setHairShellCap } from './charmat';
import { QUALITY, type Quality, type QualityName } from './quality';

export type Backend = 'webgpu' | 'webgl2';

export interface Gfx {
  renderer: THREE.WebGPURenderer;
  backend: Backend;
  canvas: HTMLCanvasElement;
  quality: Quality;
  pmrem: THREE.PMREMGenerator;
  setQuality(name: QualityName): void;
  resize(): void;
  dispose(): void;
}

/**
 * Creates the renderer. WebGPU is the primary backend; WebGPURenderer falls back to its WebGL2 backend on its own when
 * WebGPU is unavailable (or when `?webgl` is passed to force it for testing).
 */
export async function createGfx(canvas: HTMLCanvasElement, qualityName: QualityName): Promise<Gfx> {
  setHairShellCap({ ultra: 30, high: 22, balanced: 16, performance: 12 }[qualityName] ?? 22);
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false, // anti-aliasing is part of the post pipeline
    powerPreference: 'high-performance',
    forceWebGL,
  });
  await renderer.init();
  const backend: Backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

  renderer.toneMapping = THREE.AgXToneMapping; // matches the Cycles look-dev (AgX) the art is approved in
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const pmrem = new THREE.PMREMGenerator(renderer);
  let quality = QUALITY[qualityName];

  const gfx: Gfx = {
    renderer,
    backend,
    canvas,
    quality,
    pmrem,
    setQuality(name) {
      quality = QUALITY[name];
      gfx.quality = quality;
      try { localStorage.setItem('ft.quality', name); } catch { /* ignore */ }
      gfx.resize();
    },
    resize() {
      const w = canvas.clientWidth || innerWidth;
      const h = canvas.clientHeight || innerHeight;
      const pr = Math.min(devicePixelRatio || 1, quality.maxPixelRatio) * quality.resolutionScale;
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
    },
    dispose() {
      renderer.dispose();
    },
  };
  gfx.resize();
  addEventListener('resize', () => gfx.resize());
  return gfx;
}

/**
 * Procedural image-based lighting: a small studio of emissive panels rendered into a PMREM cube. Gives metal and glass
 * something to reflect that matches the chapter's mood without shipping HDR files.
 */
export function buildEnvironment(gfx: Gfx, opts: { top: number; bottom: number; panels: number[]; intensity?: number }): THREE.Texture {
  const s = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, vertexColors: true }),
  );
  const pos = sky.geometry.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(opts.top), bot = new THREE.Color(opts.bottom), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.lerpColors(bot, top, THREE.MathUtils.clamp(pos.getY(i) / 50 * 0.5 + 0.5, 0, 1));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  sky.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  s.add(sky);
  const k = opts.intensity ?? 1;
  opts.panels.forEach((col, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10 + (i % 3) * 4, 3 + (i % 2) * 2), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(col).multiplyScalar(6 * k), side: THREE.DoubleSide }));
    const a = (i / opts.panels.length) * Math.PI * 2;
    m.position.set(Math.cos(a) * 18, 7 + (i % 3) * 3, Math.sin(a) * 18);
    m.lookAt(0, 3, 0);
    s.add(m);
  });
  const rt = gfx.pmrem.fromScene(s, 0.02);
  return rt.texture;
}
