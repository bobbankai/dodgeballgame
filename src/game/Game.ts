import * as THREE from 'three';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import adaUrl from '../assets/models/ada.glb?url';
import { audio } from '../audio/Audio';
import { loadGLTF } from '../core/Assets';
import { Input } from '../core/Input';
import { G, setBoil } from '../render/Globals';
import { Particles } from '../render/Particles';
import { Pipeline } from '../render/Pipeline';
import { UI } from '../ui/UI';
import { CameraRig } from './CameraRig';
import { Collision } from './Collision';
import { Director } from './Director';
import { Player } from './Player';

export interface Level {
  readonly name: string;
  load(game: Game): Promise<void>;
  update(dt: number, time: number): void;
  dispose?(): void;
}

/** Something Ada can use: read, talk to, or hold the button to ink in. */
export interface Interactable {
  label: string;
  /** Distance from Ada at which it becomes available. */
  reach: number;
  where: (p: THREE.Vector3) => number;
  hold?: boolean;
  enabled?: () => boolean;
  onPress?: () => void;
  onHold?: (dt: number) => void;
  progress?: () => number;
  /** Point Ada turns to face while using it. */
  focus?: (p: THREE.Vector3) => THREE.Vector3;
}

/** Owns the renderer, the world, Ada and the frame loop. Levels plug into it. */
export class Game {
  readonly pipe: Pipeline;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  readonly rig = new CameraRig(this.camera);
  readonly input: Input;
  readonly ui: UI;
  readonly collision = new Collision();
  readonly sun = new SunLight(0xfff1dc, 1.0);
  readonly particles = new Particles();
  readonly director: Director;
  readonly interactables = new Set<Interactable>();
  player!: Player;
  level: Level | null = null;
  time = 0;
  paused = false;
  private timer = new THREE.Timer();
  private active: Interactable | null = null;
  /** Called with a checkpoint's name when Ada reaches it (saving). */
  onCheckpoint?: (name: string) => void;
  /** Called when the pause button is pressed. */
  onPause?: () => void;
  /** Per-frame hooks (UI, story scripts...). */
  readonly onUpdate = new Set<(dt: number, t: number) => void>();

  constructor(readonly container: HTMLElement) {
    this.pipe = new Pipeline(container);
    this.input = new Input(this.pipe.renderer.domElement);
    this.ui = new UI(this.input);
    this.ui.onType = (s) => audio.type(s);
    this.director = new Director(this);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.far = 60;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.setSun(new THREE.Vector3(0.55, 0.8, 0.35));
    this.scene.add(this.sun);
    this.pipe.overlay.add(this.particles.mesh);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.pipe.renderer.domElement.addEventListener('click', () => {
      audio.unlock();
      if (!this.paused) this.input.requestLock();
    });
    window.addEventListener('keydown', () => audio.unlock(), { once: true });
  }

  setSun(dir: THREE.Vector3, color = 0xfff1dc, intensity = 1) {
    this.sun.position.copy(dir).normalize();
    this.sun.color.set(color);
    this.sun.intensity = intensity;
    G.uSunDir.value.copy(dir).normalize();
  }

  async init() {
    this.player = new Player(await loadGLTF(adaUrl));
    this.scene.add(this.player.root);
    this.player.onLand = (k) => {
      this.rig.addShake(k * 0.3);
      this.particles.dust(this.player.position, 4 + Math.round(k * 6), 0.16 + k * 0.1);
      audio.land(0.4 + k * 0.6);
    };
    this.player.onStep = () => audio.footstep(this.player.velocity.length() > 2 ? 1 : 0.6);
  }

  async loadLevel(level: Level) {
    if (this.level) {
      this.level.dispose?.();
      for (const o of [...this.scene.children]) if (o !== this.sun && o !== this.player.root) this.scene.remove(o);
      for (const o of [...this.pipe.overlay.children]) if (o !== this.particles.mesh) this.pipe.overlay.remove(o);
      this.collision.clear();
      this.interactables.clear();
      this.onUpdate.clear();
      this.director.reset();
      G.uBloomCount.value = 0;
      G.uColorBase.value = 0;
      G.uEraseCount.value = 0;
    }
    this.level = level;
    await level.load(this);
    this.collision.build();
  }

  overlayRemove(o: THREE.Object3D) {
    o.parent?.remove(o);
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

  /** Pick what Ada can use right now, show its prompt, and handle the button. */
  private interact(dt: number) {
    const p = this.player;
    let best: Interactable | null = null;
    let bestD = Infinity;
    const free = p.inputEnabled && !this.director.cutscene && !this.ui.inDialogue && p.grounded && !p.busy;
    if (free) {
      for (const it of this.interactables) {
        if (it.enabled && !it.enabled()) continue;
        const d = it.where(p.position);
        if (d < it.reach && d < bestD) {
          best = it;
          bestD = d;
        }
      }
    }
    // keep drawing while the button is held, even if Ada drifts a little
    if (this.active && this.active.hold && this.input.down('interact') && free && this.active.where(p.position) < this.active.reach + 0.8) best = this.active;
    this.active = best;
    if (!best) {
      this.ui.prompt(null);
      if (p.mode === 'trace') p.mode = 'free';
      audio.scratchOn(false);
      return;
    }
    if (best.hold) {
      const holding = this.input.down('interact');
      this.ui.prompt(best.label, 'E', best.progress?.() ?? -1);
      if (holding) {
        p.mode = 'trace';
        if (best.focus) p.face(best.focus(p.position), dt);
        best.onHold?.(dt);
        audio.scratchOn(true);
      } else {
        if (p.mode === 'trace') p.mode = 'free';
        audio.scratchOn(false);
      }
    } else {
      this.ui.prompt(best.label, 'E');
      if (this.input.justPressed('interact')) best.onPress?.();
    }
  }

  step(dt: number, render = true) {
    this.input.poll();
    if (this.input.justPressed('pause')) this.onPause?.();
    if (!this.paused) {
      this.time += dt;
      setBoil(this.time);
      this.player.speaking = this.ui.talking && this.director.speaker === 'Ada';
      this.player.update(dt, this.input, this.rig.yaw, this.collision);
      this.interact(dt);
      this.level?.update(dt, this.time);
      for (const f of this.onUpdate) f(dt, this.time);
      this.director.update(dt);
      this.rig.update(dt, this.director.cutscene ? null : this.input, this.player.position, this.player.velocity, this.collision, this.time);
      this.particles.update(dt);
    }
    this.ui.update(dt);
    if (render) this.pipe.render(this.scene, this.camera);
    this.input.endFrame();
  }
}
