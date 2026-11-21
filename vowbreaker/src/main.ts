import { ArcRotateCamera, Color3, Color4, MeshBuilder, Scene, Vector3, WebGPUEngine } from '@babylonjs/core';
import { registerShaders, shaderStats } from './render/ShaderLib';
import { CharacterLook, Lighting, Materials, makeOutline } from './render/Materials';
import { GBufferPass, ShadowPass } from './render/Passes';
import { PostChain } from './render/PostChain';

declare global {
  interface Window {
    __ready?: boolean;
    __advance?: (t: number, render: boolean) => Promise<void>;
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  if (!navigator.gpu) {
    document.getElementById('ui')!.innerHTML = '<p style="color:#eee;font:20px sans-serif;padding:40px">Vowbreaker needs WebGPU (Chrome, Edge or another WebGPU browser).</p>';
    return;
  }
  const engine = new WebGPUEngine(canvas, { antialias: true, stencil: true });
  await engine.initAsync();
  registerShaders();
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.05, 0.05, 0.08, 1);
  const cam = new ArcRotateCamera('cam', -Math.PI / 2.4, 1.15, 7, new Vector3(0, 0.8, 0), scene);
  cam.attachControl(canvas, true);
  const lighting = new Lighting();
  const mats = new Materials(scene, lighting);
  mats.screenW = engine.getRenderWidth();
  mats.screenH = engine.getRenderHeight();
  const shadow = new ShadowPass(scene, mats, lighting, 1024);
  shadow.extent = 6;

  const gbuf = new GBufferPass(scene, mats, cam, 1);
  const ground = MeshBuilder.CreateGround('ground', { width: 12, height: 12, subdivisions: 4 }, scene);
  const gl = new CharacterLook();
  gl.tint.set(0.6, 0.62, 0.66, 1);
  ground.material = mats.toon(ground, gl);
  shadow.addCaster(ground);
  gbuf.add(ground);
  const colors: [number, number, number][] = [[0.9, 0.3, 0.25], [0.25, 0.5, 0.9], [0.95, 0.8, 0.6]];
  colors.forEach((c, i) => {
    const s = MeshBuilder.CreateSphere('s' + i, { diameter: 1.2, segments: 32 }, scene);
    s.position.set(-1.6 + i * 1.6, 0.7, 0);
    const look = new CharacterLook();
    look.tint.set(c[0], c[1], c[2], 1);
    look.toon.w = 1;
    s.material = mats.toon(s, look);
    makeOutline(mats, s, look);
    shadow.addCaster(s);
    gbuf.add(s);
    if (i === 1) { look.energy.set(0.9, 0, 0, 0); }
  });

  const post = new PostChain(engine, scene, cam, gbuf, lighting);
  lighting.setPoint(0, new Vector3(0, 1.6, 1.2), 4, new Color3(1, 0.5, 0.1), 2.5);
  let t = 0;
  const step = (dt: number) => {
    t += dt;
    lighting.time = t;
    shadow.update();
    mats.update();
  };
  const test = new URLSearchParams(location.search).has('test');
  if (test) {
    window.__advance = async (dt: number, render: boolean) => {
      const n = Math.max(1, Math.round(dt * 60));
      for (let i = 0; i < n; i++) step(1 / 60);
      if (render) {
        engine.beginFrame();
        scene.render();
        post.render(dt);
        engine.endFrame();
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    };
    await scene.whenReadyAsync();
    for (let i = 0; i < 200 && !post.isReady(); i++) await new Promise((r) => setTimeout(r, 50));
    window.__ready = true;
  } else {
    engine.runRenderLoop(() => {
      const dt = engine.getDeltaTime() / 1000;
      step(dt);
      scene.render();
      post.render(dt);
    });
  }
  window.addEventListener('resize', () => engine.resize());
  console.log('shaders', JSON.stringify(shaderStats()));
}

void boot();
