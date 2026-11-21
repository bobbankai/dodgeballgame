import { Renderer } from './render/Renderer';
import { shaderStats } from './render/ShaderLib';

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
  if (!navigator.gpu) {
    document.getElementById('ui')!.innerHTML = '<p style="color:#eee;font:20px sans-serif;padding:40px">Vowbreaker needs WebGPU (a recent Chrome, Edge or Safari).</p>';
    return;
  }
  const r = await Renderer.create(canvas);
  window.__r = r;
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
    r.engine.runRenderLoop(() => {
      const dt = Math.min(r.engine.getDeltaTime() / 1000, 1 / 20);
      step(dt);
      r.render(dt);
    });
  }
  window.addEventListener('resize', () => r.resize());
}

void boot();
