import * as BABYLON from '@babylonjs/core';
import { ArcRotateCamera, Vector3, MeshBuilder } from '@babylonjs/core';
import { installHeadlessShim, presentHeadless } from './core/headlessShim';
import { Renderer } from './render/Renderer';
import { skyMaterial, toonMaterial } from './render/materials';
import { CharacterModel } from './game/CharacterModel';
import { AnimLibrary, Animator } from './game/Animator';
import { Procedural } from './game/Procedural';
import { shaderStats } from './render/shaderRegistry';
import { Input } from './core/Input';
import { UI } from './ui/UI';
import { Audio } from './audio/Audio';
import { Game } from './game/Game';
import { PlayerController } from './game/Player';
import { spawn, updateBrains } from './game/Spawn';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
if (TEST) { installHeadlessShim(); (window as any).__testMode = true; }

type Step = (dt: number, t: number) => void;

async function viewer(r: Renderer): Promise<Step> {
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
  const ground = MeshBuilder.CreateDisc('ground', { radius: 6, tessellation: 64 }, scene);
  ground.rotation.x = Math.PI / 2;
  ground.material = toonMaterial('groundMat', r);
  const ch = await CharacterModel.load(r, name, { face: { eyeStyle: 0 } });
  ch.face.snap(params.get('expr') ?? 'neutral');
  r.shadowCenter.set(0, 1, 0);
  const lib = await AnimLibrary.load(scene);
  const animator = new Animator(ch, lib);
  const proc = new Procedural(ch);
  animator.play(params.get('anim') ?? 'guard', { loop: true, fade: 0 });
  Object.assign(window as any, { __char: ch, __anim: animator, __proc: proc, __lib: lib });
  return (dt, t) => { animator.update(dt); proc.update(dt); ch.face.update(dt, t); };
}

async function arena(r: Renderer, input: Input, ui: UI, audio: Audio): Promise<Step> {
  const scene = r.scene;
  const lib = await AnimLibrary.load(scene);
  const game = new Game(r, input, lib);
  r.globals.setSunDir(new Vector3(-0.45, 0.8, -0.4), 1.15);
  r.setSky(skyMaterial(r, { zenith: '#3f86d8', horizon: '#c4e6f6', glow: '#ffd9a0', cloudLit: '#ffffff', cloudShade: '#9db3da',
    cover: 0.45, cloudHeight: 1, sunSize: 0.0015, stars: 0, moon: false }));
  const ground = MeshBuilder.CreateGround('ground', { width: 80, height: 80, subdivisions: 4 }, scene);
  const gm = toonMaterial('groundMat', r);
  gm.setVector4('tint', new BABYLON.Vector4(1.05, 0.92, 0.7, 0));
  ground.material = gm;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const rock = MeshBuilder.CreateSphere(`rock${i}`, { diameter: 2.2, segments: 8 }, scene);
    rock.position.set(Math.cos(a) * 11, 0.6, Math.sin(a) * 11);
    rock.scaling.set(1, 0.7, 1.2);
    const rm = toonMaterial(`rockMat${i}`, r);
    rm.setVector4('tint', new BABYLON.Vector4(0.6, 0.6, 0.65, 0));
    rock.material = rm;
    r.addCaster(rock);
    game.collision.addCircle(rock.position.x, rock.position.z, 1.1);
  }
  const kai = await spawn(game, 'kai', new Vector3(0, 0, -4), 0);
  game.player = kai;
  const pc = new PlayerController(kai, game, input);
  game.combatActive = true;
  game.storm = 100;
  game.checkpoint = { pos: new Vector3(0, 0, -4), yaw: 0 };
  for (const [k, x, z] of [['marine', -2, 4], ['marine', 2, 5], ['rifleman', 0, 9], ['brute', 4, 2]] as const) {
    await spawn(game, k, new Vector3(x, 0, z), Math.PI);
  }
  game.hooks = {
    sfx: (n, p, v) => audio.sfx(n, p, v),
    combo: (n) => ui.setCombo(n),
    hud: () => { ui.setHealth(kai.hp, kai.maxHp); ui.setStorm(game.storm, game.stormMax); },
  };
  ui.showHud(true);
  audio.play('battle');
  audio.ambience('sea');
  game.cam.yaw = 0;
  Object.assign(window as any, { __game: game, __kai: kai, __pc: pc });
  return (dt) => {
    input.update(dt);
    pc.update(dt);
    updateBrains(dt);
    game.step(dt);
    audio.listener = kai.pos;
    kai.model.face.update(dt, game.time);
  };
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const r = new Renderer(canvas, TEST);
  await r.init((params.get('quality') as any) ?? 'high');
  const input = new Input(canvas);
  const ui = new UI();
  const audio = new Audio();
  if (TEST) { audio.enabled = false; ui.autoAdvance = 0.4; }
  const unlock = () => { audio.start(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  const update = params.has('view') ? await viewer(r) : await arena(r, input, ui, audio);
  let time = 0;
  const step = (dt: number) => { time += dt; update(dt, time); ui.update(dt); };
  const w = window as any;
  w.__r = r;
  w.__ui = ui;
  if (TEST) w.BABYLON = BABYLON;
  w.__shaderStats = shaderStats;
  if (TEST) {
    w.__advance = async (t: number) => { const n = Math.round(t * 60); for (let i = 0; i < n; i++) step(1 / 60); };
    w.__frame = async () => { r.render(time, 1 / 60); await presentHeadless(); };
    for (let i = 0; i < 40; i++) { r.render(time, 1 / 60); await new Promise((res) => setTimeout(res, 30)); }
    w.__ready = true;
  } else {
    let last = performance.now();
    let acc = 0;
    r.engine.runRenderLoop(() => {
      const now = performance.now();
      const frame = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += frame;
      while (acc >= 1 / 60) { step(1 / 60); acc -= 1 / 60; }
      r.render(time, frame);
    });
  }
}

boot().catch((e) => { console.error(e); document.body.innerText = 'Boot failed: ' + e; });
