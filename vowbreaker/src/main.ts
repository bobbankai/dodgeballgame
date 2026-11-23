import { Renderer } from './render/Renderer';
import { shaderStats } from './render/ShaderLib';
import { AdaptiveScale } from './render/AdaptiveScale';
import { device, graphicsFor, loadPrefs } from './core/Device';

declare global {
  interface Window {
    __ready?: boolean;
    __advance?: (t: number, render: boolean) => Promise<void>;
    __r?: Renderer;
    __game?: unknown;
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  const dev = device(params);
  if (!navigator.gpu) {
    document.getElementById('ui')!.innerHTML = `<p style="color:#eee;font:20px/1.5 sans-serif;padding:40px;max-width:640px">Vowbreaker needs WebGPU. ${dev.tier === 'desktop'
      ? 'Use a recent Chrome, Edge or Safari.'
      : 'On a phone or tablet that means Chrome on Android 12 or later, or Safari on iOS 26 or later.'}</p>`;
    return;
  }
  const gfx = graphicsFor(dev.tier);
  const r = await Renderer.create(canvas, { dprCap: gfx.dprCap, maxScale: gfx.maxScale, shadowSize: gfx.shadowSize, msaa: gfx.msaa });
  window.__r = r;
  r.post.settings.quality = loadPrefs().quality ?? gfx.quality;
  // if the GPU is taken away (a phone under memory pressure), say so rather than freezing
  const gpuDevice = (r.engine as unknown as { _device?: GPUDevice })._device;
  void gpuDevice?.lost.then((info) => {
    if (info.reason === 'destroyed') return;
    document.getElementById('ui')!.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:grid;place-content:center;gap:18px;text-align:center;background:#07060aee;color:#eee;font:20px/1.5 sans-serif;z-index:99;pointer-events:auto">'
      + '<div>The graphics were interrupted.</div><button onclick="location.reload()" style="font:inherit;padding:10px 26px">Reload</button></div>');
  });
  let update: (dt: number) => void = () => {};
  const view = params.get('view');
  if (view === 'chars') {
    const m = await import('./dev/CharView');
    update = await m.charView(r, params);
  } else {
    const { Game } = await import('./game/Game');
    const game = new Game(r, params);
    window.__game = game;
    await game.start();
    update = (dt) => game.update(dt);
  }
  let time = 0;
  const step = (dt: number) => {
    time += dt;
    r.lighting.time = time;
    update(dt);
  };
  await r.ready();
  console.log('shaders', JSON.stringify(shaderStats()));
  if (params.has('test')) {
    window.__advance = async (dt: number, render: boolean) => {
      const n = Math.max(1, Math.round(dt * 60));
      for (let i = 0; i < n; i++) step(1 / 60);
      if (render) {
        r.engine.beginFrame();
        r.render(dt);
        r.engine.endFrame();
        await new Promise((res) => requestAnimationFrame(() => res(null)));
      }
    };
    window.__ready = true;
  } else {
    // phones and tablets tune their own resolution to hold the frame rate
    const scaler = gfx.adaptive ? new AdaptiveScale(r) : null;
    r.engine.runRenderLoop(() => {
      const dt = Math.min(r.engine.getDeltaTime() / 1000, 1 / 20);
      step(dt);
      r.render(dt);
      scaler?.tick(performance.now());
    });
  }
  // turning a phone, the address bar sliding away, fullscreen: the canvas follows
  window.addEventListener('resize', () => r.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => r.resize(), 250));
}

void boot();
