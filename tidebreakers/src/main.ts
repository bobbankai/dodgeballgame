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
import { spawn, updateBrains, brains } from './game/Spawn';
import { Flow, type LevelId } from './Flow';
import { PlayBot } from './test/PlayBot';

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

async function story(r: Renderer, input: Input, ui: UI, audio: Audio): Promise<Step> {
  const lib = await AnimLibrary.load(r.scene);
  const game = new Game(r, input, lib);
  const kai = await spawn(game, 'kai', new Vector3(0, 0, 0), 0);
  game.player = kai;
  brains.delete(kai);
  const pc = new PlayerController(kai, game, input);
  const flow = new Flow(r, game, ui, audio, input, pc);
  flow.test = TEST;
  await flow.init();
  game.hooks = {
    sfx: (n, p, v) => audio.sfx(n, p, v),
    combo: (n) => ui.setCombo(n),
    hud: () => {
      ui.setHealth(kai.hp, kai.maxHp);
      ui.setStorm(game.storm, game.stormMax);
      const b = flow.level?.boss;
      if (b && game.combatActive && b.f.alive && !flow.level?.dir.cineActive) ui.setBoss(b.f.name, b.f.hp, b.f.maxHp); else ui.setBoss(null);
    },
  };
  Object.assign(window as any, { __game: game, __kai: kai, __pc: pc, __flow: flow, __audio: audio });
  const lvl = params.get('level');
  // not awaited: the level's fades run on the frame clock, which only ticks once the loop is running
  if (lvl) void flow.start(lvl as LevelId, params.get('at') ?? '');
  else flow.title();
  // test bot: walks to objectives, ends fights, so whole chapters can be played through headless
  const bot = (w: any) => {
    const L = flow.level;
    if (!w.__autoplay || !L) return;
    // (to just inside the objective's radius, from the side he is coming from, as a player arrives: placed on
    // the marker itself he stood inside whoever was waiting there)
    if (L.marker && !L.dir.cineActive) {
      const d = kai.pos.subtract(L.marker); d.y = 0;
      const k = Math.min(d.length(), L.markerR * 0.7, 1.6);
      kai.place(d.length() > 0.01 ? L.marker.add(d.normalize().scale(k)) : L.marker, kai.yaw);
    }
    if (game.combatActive && !L.dir.cineActive) {
      for (const e of game.enemies()) {
        if (e.floorHp > 0 && e.onFloor) { e.hp = e.floorHp; const cb = e.onFloor; e.onFloor = undefined; cb(); continue; }
        if (e.floorHp > 0) continue;
        e.hp = 0; e.die(new Vector3(0, 0, 0), 2);
      }
    }
    if (!kai.alive) kai.hp = kai.maxHp;
  };
  // play-bot: plays with the controls at a person's pace, to measure play time (window.__playbot = true)
  let player: PlayBot | null = null;
  const playbot = (w: any, dt: number) => {
    if (!w.__playbot) return;
    if (!player) { player = new PlayBot(flow, game, kai, pc, input, ui); w.__bot = player; ui.autoAdvance = 0; }
    player.update(dt);
  };
  return (dt) => {
    if (TEST) playbot(window as any, dt);
    input.update(dt);
    if (TEST) bot(window as any);
    if (!flow.paused) {
      pc.update(dt);
      updateBrains(dt);
      flow.update(dt);
      game.step(dt);
      audio.listener = kai.pos;
      for (const f of game.fighters) {
        if (!flow.level?.dir.cineActive) autoFace(f, game.combatActive);
        f.model.face.update(dt, game.time);
      }
    } else flow.update(dt);
  };
}

/** Faces follow the fight when no scene is directing them. */
function autoFace(f: import('./game/Fighter').Fighter, combat: boolean): void {
  const face = f.model.face;
  switch (f.state) {
    case 'hit': case 'knock': face.set('hit', 14); break;
    case 'down': face.set('pain', 6); break;
    case 'dead': face.set('dead', 6); break;
    case 'attack': face.set(f.team === 'player' ? (f.attack?.cost ? 'shout' : 'effort') : 'angry', 12); break;
    case 'guard': face.set('determined', 10); break;
    default: if (combat && f.team !== 'neutral') face.set(f.team === 'enemy' ? 'angry' : 'determined', 4);
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const r = new Renderer(canvas, TEST);
  let q = params.get('quality');
  try { q = q ?? localStorage.getItem('tidebreakers.quality'); } catch { /* */ }
  await r.init((q as any) ?? 'high');
  const input = new Input(canvas);
  const ui = new UI();
  const audio = new Audio();
  if (TEST) { audio.enabled = false; ui.autoAdvance = 0.4; }
  const unlock = () => { audio.start(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  const update = params.has('view') ? await viewer(r) : await story(r, input, ui, audio);
  let time = 0;
  const step = (dt: number) => { time += dt; update(dt, time); ui.update(dt); };
  const w = window as any;
  w.__r = r;
  w.__ui = ui;
  if (TEST) w.BABYLON = BABYLON;
  w.__shaderStats = shaderStats;
  if (TEST) {
    // let story-script continuations (promise microtasks) run between frames, as they do in real play
    w.__advance = async (t: number) => {
      const n = Math.round(t * 60);
      for (let i = 0; i < n; i++) { step(1 / 60); for (let k = 0; k < 6; k++) await Promise.resolve(); }
    };
    w.__frame = async () => { r.render(time, 1 / 60); await presentHeadless(); };
    // warm up (shader compiles) and let a level named in the url finish loading; only the UI clock runs
    // meanwhile, so the level's script starts on the first stepped frame as before
    const flow = w.__flow as Flow | undefined;
    for (let i = 0; i < 40 || (flow && (flow.isLoading || (params.has('level') && !flow.level))); i++) {
      r.render(time, 1 / 60);
      ui.update(1 / 60);
      await new Promise((res) => setTimeout(res, 30));
    }
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
