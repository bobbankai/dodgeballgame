import { WebGPUEngine } from '@babylonjs/core';
import { Scene } from '@babylonjs/core';
import { ArcRotateCamera } from '@babylonjs/core';
import { Vector3, Color4 } from '@babylonjs/core';
import { MeshBuilder } from '@babylonjs/core';
import { ShaderMaterial } from '@babylonjs/core';
import { ShaderLanguage } from '@babylonjs/core';
import { MultiRenderTarget } from '@babylonjs/core';
import { Constants } from '@babylonjs/core';
import { EffectRenderer, EffectWrapper } from '@babylonjs/core';
import { UniformBuffer } from '@babylonjs/core';
import { registerShaders } from './render/shaderRegistry';
import { installHeadlessShim, presentHeadless } from './core/headlessShim';
const TEST = new URLSearchParams(location.search).has('test');
if (TEST) installHeadlessShim();

async function boot() {
  registerShaders();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const engine = new WebGPUEngine(canvas, { antialias: false, adaptToDeviceRatio: true });
  await engine.initAsync();
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);
  const cam = new ArcRotateCamera('cam', 0.8, 1.1, 6, Vector3.Zero(), scene);
  cam.minZ = 0.1;

  const globals = new UniformBuffer(engine, undefined, true, 'globals');
  globals.addUniform('sunDir', 4);
  globals.addUniform('time', 4);
  globals.create();
  const sun = new Vector3(0.5, 0.8, 0.3).normalize();
  globals.updateFloat4('sunDir', sun.x, sun.y, sun.z, 0);
  globals.updateFloat4('time', 0, 0, 0, 0);
  globals.update();

  const mat = new ShaderMaterial('probe', scene, { vertex: 'tbProbe', fragment: 'tbProbe' }, {
    attributes: ['position', 'normal'],
    uniforms: ['world', 'viewProjection', 'view'],
    uniformBuffers: ['globals'],
    shaderLanguage: ShaderLanguage.WGSL,
  });
  mat.setUniformBuffer('globals', globals);
  const knot = MeshBuilder.CreateTorusKnot('knot', { radius: 1, tube: 0.35, radialSegments: 128 }, scene);
  knot.material = mat;

  const mrt = new MultiRenderTarget('main', { width: engine.getRenderWidth(), height: engine.getRenderHeight() }, 2, scene, {
    types: [Constants.TEXTURETYPE_HALF_FLOAT, Constants.TEXTURETYPE_HALF_FLOAT],
    samples: 4,
    generateDepthBuffer: true,
  });
  cam.outputRenderTarget = mrt;

  const fx = new EffectRenderer(engine);
  const blit = new EffectWrapper({ engine, name: 'blit', fragmentShader: 'tbBlit', useShaderStore: true, samplerNames: ['colorTex', 'gbufTex'], uniformNames: [], shaderLanguage: ShaderLanguage.WGSL });
  blit.onApplyObservable.add(() => {
    blit.effect.setTexture('colorTex', mrt.textures[0]);
    blit.effect.setTexture('gbufTex', mrt.textures[1]);
  });

  const frame = () => {
    engine.beginFrame();
    scene.render();
    if (blit.isReady()) { engine.restoreDefaultFramebuffer(); fx.render(blit); }
    engine.endFrame();
  };
  const w = window as any;
  w.__advance = async (t: number) => { knot.rotation.y += t; };
  w.__ready = false;
  scene.executeWhenReady(() => {
    // give the effects a few frames to compile
    let n = 0;
    const tick = () => { frame(); if (++n < 30) requestAnimationFrame(tick); else w.__ready = true; };
    tick();
  });
  w.__frame = async () => { frame(); if (TEST) await presentHeadless(); };
}

boot().catch((e) => { console.error(e); document.body.innerText = 'Boot failed: ' + e; });
