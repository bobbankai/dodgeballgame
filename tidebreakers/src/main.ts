import * as BABYLON from '@babylonjs/core';
import { ArcRotateCamera, Vector3, MeshBuilder } from '@babylonjs/core';
import { installHeadlessShim, presentHeadless } from './core/headlessShim';
import { Renderer } from './render/Renderer';
import { skyMaterial, toonMaterial } from './render/materials';
import { CharacterModel } from './game/CharacterModel';
import { AnimLibrary, Animator } from './game/Animator';
import { Procedural } from './game/Procedural';
import { shaderStats } from './render/shaderRegistry';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
if (TEST) installHeadlessShim();

async function viewer(r: Renderer): Promise<(dt: number, t: number) => void> {
  const scene = r.scene;
  const name = params.get('view') ?? 'kai';
  const cam = new ArcRotateCamera('cam', -Math.PI / 2 + (+(params.get('yaw') ?? 20)) * Math.PI / 180, 1.42, +(params.get('dist') ?? 3.4),
    new Vector3(0, +(params.get('ty') ?? 0.95), 0), scene);
  cam.minZ = 0.05;
  cam.fov = +(params.get('fov') ?? 0.7);
  if (!TEST) cam.attachControl(r.canvas, true);
  scene.activeCamera = cam;
  r.globals.setSunDir(new Vector3(-0.5, 0.75, -0.55), 1.15);
  r.setSky(skyMaterial(r, { zenith: '#3f86d8', horizon: '#bfe2f5', glow: '#ffd9a0', cloudLit: '#ffffff', cloudShade: '#9db3da',
    cover: 0.5, cloudHeight: 1, sunSize: 0.0015, stars: 0, moon: false }));
  r.globals.set('fogColor', 0.62, 0.78, 0.92, 0);
  const ground = MeshBuilder.CreateDisc('ground', { radius: 6, tessellation: 64 }, scene);
  ground.rotation.x = Math.PI / 2;
  ground.material = toonMaterial('groundMat', r);
  const ch = await CharacterModel.load(r, name, { face: { eyeStyle: 0 } });
  ch.face.snap(params.get('expr') ?? 'neutral');
  r.shadowCenter.set(0, 1, 0);
  const lib = await AnimLibrary.load(scene);
  const animator = new Animator(ch, lib);
  const proc = new Procedural(ch);
  const clip = params.get('anim') ?? 'guard';
  animator.play(clip, { loop: true, fade: 0 });
  Object.assign(window as any, { __char: ch, __anim: animator, __proc: proc, __lib: lib });
  return (dt, t) => { animator.update(dt); proc.update(dt); ch.face.update(dt, t); };
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const r = new Renderer(canvas, TEST);
  await r.init((params.get('quality') as any) ?? 'high');
  const update = await viewer(r);
  let time = 0;
  const step = (dt: number) => { time += dt; update(dt, time); };
  const w = window as any;
  w.__r = r;
  if (TEST) w.BABYLON = BABYLON;
  w.__shaderStats = shaderStats;
  if (TEST) {
    w.__advance = async (t: number) => { const n = Math.round(t * 60); for (let i = 0; i < n; i++) step(1 / 60); };
    w.__frame = async () => { r.render(time, 1 / 60); await presentHeadless(); };
    // warm up: let effects compile
    for (let i = 0; i < 40; i++) { r.render(time, 1 / 60); await new Promise((res) => setTimeout(res, 30)); }
    w.__ready = true;
  } else {
    let last = performance.now();
    r.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt);
      r.render(time, dt);
    });
  }
}

boot().catch((e) => { console.error(e); document.body.innerText = 'Boot failed: ' + e; });
