import * as THREE from 'three';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import adaUrl from '../assets/models/ada.glb?url';
import { loadGLTF } from '../core/Assets';
import { Input } from '../core/Input';
import { G, setBoil } from '../render/Globals';
import { Pipeline } from '../render/Pipeline';
import { CameraRig } from './CameraRig';
import { Collision } from './Collision';
import { Player } from './Player';

export interface Level {
  readonly name: string;
  load(game: Game): Promise<void>;
  update(dt: number, time: number): void;
  dispose?(): void;
}

/** Owns the renderer, the world, Ada and the frame loop. Levels plug into it. */
export class Game {
  readonly pipe: Pipeline;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  readonly rig = new CameraRig(this.camera);
  readonly input: Input;
  readonly collision = new Collision();
  readonly sun = new SunLight(0xfff1dc, 1.0);
  player!: Player;
  level: Level | null = null;
  time = 0;
  paused = false;
  private timer = new THREE.Timer();
  /** Per-frame hooks (UI, story scripts...). */
  readonly onUpdate = new Set<(dt: number, t: number) => void>();

  constructor(readonly container: HTMLElement) {
    this.pipe = new Pipeline(container);
    this.input = new Input(this.pipe.renderer.domElement);
    this.sun.position.set(0.55, 0.8, 0.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.far = 60;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.pipe.renderer.domElement.addEventListener('click', () => {
      if (!this.paused) this.input.requestLock();
    });
  }

  async init() {
    this.player = new Player(await loadGLTF(adaUrl));
    this.scene.add(this.player.root);
    this.player.onLand = (k) => this.rig.addShake(k * 0.35);
  }

  async loadLevel(level: Level) {
    if (this.level) {
      this.level.dispose?.();
      for (const o of [...this.scene.children]) if (o !== this.sun && o !== this.player.root) this.scene.remove(o);
      this.collision.clear();
      G.uBloomCount.value = 0;
      G.uColorBase.value = 0;
    }
    this.level = level;
    await level.load(this);
    this.collision.build();
  }

  resize() {
    this.pipe.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  start() {
    const frame = () => {
      this.timer.update();
      const dt = Math.min(this.timer.getDelta(), 1 / 20);
      this.step(dt);
      requestAnimationFrame(frame);
    };
    frame();
  }

  step(dt: number, render = true) {
    this.input.poll();
    if (!this.paused) {
      this.time += dt;
      setBoil(this.time);
      this.player.update(dt, this.input, this.rig.yaw, this.collision);
      this.level?.update(dt, this.time);
      for (const f of this.onUpdate) f(dt, this.time);
      this.rig.update(dt, this.input, this.player.position, this.player.velocity, this.collision, this.time);
    }
    if (render) this.pipe.render(this.scene, this.camera);
    this.input.endFrame();
  }
}
