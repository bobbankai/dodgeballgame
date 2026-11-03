import * as THREE from 'three';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import adaUrl from '../assets/models/ada.glb?url';
import { audio } from '../audio/Audio';
import { noteText } from '../audio/lineKey';
import { speech } from '../audio/Speech';
import { disposeTree, loadGLTF } from '../core/Assets';
import { Input } from '../core/Input';
import { G, setBoil } from '../render/Globals';
import { Particles } from '../render/Particles';
import { Pipeline } from '../render/Pipeline';
import { UI, type Speaker } from '../ui/UI';
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

const _fwd = new THREE.Vector3();
const _upv = new THREE.Vector3();
const _lookAda = new THREE.Vector3();
const _lookAdaT = new THREE.Vector3();
const _lookA = new THREE.Vector3();
const _lookB = new THREE.Vector3();
const _lookC = new THREE.Vector3();

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
    audio.onPigment = () => {
      this.director.feel('Ada', 'joy', 3.5);
      this.director.feel('Pip', 'joy', 3.5);
    };
    this.ui.onType = (s, c) => {
      // a recorded line moves the mouth itself; the rest babble along as they type
      if (speech.speaking) return;
      this.director.faceOf(s)?.letter(c);
      audio.voice(s, c);
    };
    // Mum reads her notes aloud
    this.ui.onNote = (body, sign) => {
      if (sign && !sign.includes('Mum')) return;
      const text = noteText(body);
      if (!text) return;
      void speech.start('Mum', text);
      return () => speech.stop();
    };
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
    this.player.onStep = () => audio.footstep(this.player.velocity.length() > 2 ? 1 : 0.6, this.collision.surfaceBelow(this.player.position));
  }

  async loadLevel(level: Level) {
    audio.stopEmitters();
    audio.scratchOn(false);
    audio.smudgeLevel(0);
    // (the title's attic counts too: whatever the last level was, nothing of it carries over)
    const old = this.level ?? this.loaded;
    if (old) {
      old.dispose?.();
      for (const o of [...this.scene.children]) {
        if (o === this.sun || o === this.player.root) continue;
        this.scene.remove(o);
        disposeTree(o);
      }
      for (const o of [...this.pipe.overlay.children]) {
        if (o === this.particles.mesh) continue;
        this.pipe.overlay.remove(o);
        disposeTree(o);
      }
      this.collision.clear();
      this.interactables.clear();
      this.onUpdate.clear();
      G.uBloomCount.value = 0;
      for (const t of G.uBloomTint.value) t.set(1, 1, 1);
      G.uEraseCount.value = 0;
      G.uStorm.value = 0;
    }
    this.director.reset();
    this.rig.guide = null;
    this.rig.setShot(null, true);
    this.rig.sailing(false);
    this.pipe.uniforms.uVignette.value = 0;
    this.pipe.uniforms.uAperture.value = 0;
    this.player.reset();
    this.ui.reset();
    this.active = null;
    // the frame loop keeps running while a level loads: it only gets the level once it is ready
    this.level = null;
    this.loaded = level;
    await level.load(this);
    this.collision.build();
    this.level = level;
  }

  /**
   * Who looks at what: in a conversation everyone looks at whoever is talking (and the one talking
   * at whoever they answer); walking about, Ada glances at what she can use and at Pip nearby.
   */
  private looks(dt: number) {
    const d = this.director, p = this.player;
    const others: Speaker[] = ['Pip', 'Mum', 'Keeper'];
    const talking = this.ui.inDialogue ? d.speaker : '';
    const adaHead = d.headOf('Ada', _lookAda);
    // Ada
    let ada: THREE.Vector3 | null = null;
    if (talking && talking !== 'Ada') ada = d.headOf(talking, _lookA);
    else if (talking === 'Ada') ada = (d.lastOther && d.headOf(d.lastOther, _lookA)) || this.nearestHead(others, adaHead!, 6, _lookA);
    else if (!d.cutscene) {
      if (this.active?.focus && p.mode !== 'trace') ada = _lookA.copy(this.active.focus(p.position));
      else if (p.velocity.lengthSq() < 0.1) ada = this.nearestHead(['Pip'], adaHead!, 2.6, _lookA) ?? this.glance(adaHead!, dt);
    }
    if (ada || p.velocity.lengthSq() >= 0.1 || d.cutscene) this.glanceIn = Math.max(this.glanceIn, 3);
    p.life.look = ada ? _lookAdaT.copy(ada) : null;
    // the others: at the speaker, or at Ada when she is close
    for (const who of others) {
      const life = who === 'Pip' ? d.pip?.life : d.actors.get(who)?.life;
      if (!life) continue;
      const me = d.headOf(who, _lookB);
      let t: THREE.Vector3 | null = null;
      if (talking && talking !== who) t = d.headOf(talking, _lookC);
      else if (talking === who) t = adaHead;
      else if (me && adaHead && me.distanceTo(adaHead) < 7) t = adaHead;
      life.look = t ? (life.look ?? new THREE.Vector3()).copy(t) : null;
    }
  }

  /** Standing about with nothing to look at, Ada glances round now and then. */
  private glanceIn = 4;
  private glanceHold = 0;
  private glanceAt = new THREE.Vector3();
  private glance(head: THREE.Vector3, dt: number): THREE.Vector3 | null {
    if (this.glanceHold > 0) {
      this.glanceHold -= dt;
      return this.glanceAt;
    }
    this.glanceIn -= dt;
    if (this.glanceIn > 0) return null;
    this.glanceIn = 4 + Math.random() * 5;
    this.glanceHold = 1.2 + Math.random() * 1.6;
    const a = this.player.yaw + (Math.random() - 0.5) * 2.2;
    this.glanceAt.set(head.x + Math.sin(a) * 4, head.y + (Math.random() - 0.4) * 1.6, head.z + Math.cos(a) * 4);
    return this.glanceAt;
  }

  private nearestHead(who: Speaker[], from: THREE.Vector3, within: number, out: THREE.Vector3) {
    let best: THREE.Vector3 | null = null, bd = within;
    for (const w of who) {
      const h = this.director.headOf(w, _lookB);
      if (h && h.distanceTo(from) < bd) {
        bd = h.distanceTo(from);
        best = out.copy(h);
      }
    }
    return best;
  }

  /** The level being loaded or played (level is only set once it is ready). */
  private loaded: Level | null = null;

  overlayRemove(o: THREE.Object3D) {
    o.parent?.remove(o);
  }

  /** Render scale on top of the device pixel ratio, tuned by the frame rate (see start()). */
  private renderScale = 1;
  private frameAvg = 1 / 60;
  private scaleCool = 0;

  resize() {
    // phones have very dense screens: 1.5x is plenty and keeps them cool
    const dpr = Math.min(window.devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2);
    this.pipe.setSize(window.innerWidth, window.innerHeight, Math.max(0.6, dpr * this.renderScale));
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  start() {
    const frame = () => {
      requestAnimationFrame(frame);
      this.timer.update();
      const raw = this.timer.getDelta();
      const dt = Math.min(raw, 1 / 20);
      // a bad frame is logged, not fatal: the loop must survive it
      try {
        this.step(dt);
      } catch (e) {
        console.error(e);
      }
      this.adaptResolution(raw);
    };
    frame();
  }

  /**
   * Dynamic resolution: if frames run long for a couple of seconds, render a little smaller; when
   * there's headroom again, step back up. Lines are sized in screen pixels so the look holds.
   */
  private adaptResolution(raw: number) {
    if (raw > 0.25) return; // tab switches and hitches aren't the GPU's fault
    this.frameAvg += (raw - this.frameAvg) * 0.05;
    this.scaleCool -= raw;
    if (this.scaleCool > 0) return;
    let next = this.renderScale;
    if (this.frameAvg > 1 / 45) next = Math.max(0.55, this.renderScale - 0.1);
    else if (this.frameAvg < 1 / 58 && this.renderScale < 1) next = Math.min(1, this.renderScale + 0.05);
    if (next !== this.renderScale) {
      this.renderScale = next;
      this.resize();
      this.scaleCool = 2;
    }
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
    if (this.paused) speech.pause();
    else {
      this.time += dt;
      setBoil(this.time);
      this.player.speaking = this.ui.talking && this.director.speaker === 'Ada';
      this.player.update(dt, this.input, this.rig.yaw, this.collision);
      this.interact(dt);
      this.level?.update(dt, this.time);
      for (const f of this.onUpdate) f(dt, this.time);
      this.director.update(dt);
      this.looks(dt);
      speech.resume();
      speech.update();
      if (speech.speaking && this.director.speaker === speech.speaker) this.director.faceOf(this.director.speaker)?.level(speech.level());
      this.rig.update(dt, this.director.cutscene ? null : this.input, this.player.position, this.player.velocity, this.collision, this.time);
      this.particles.update(dt);
    }
    // the ears go where the camera goes
    const c = this.camera;
    _fwd.set(0, 0, -1).applyQuaternion(c.quaternion);
    _upv.set(0, 1, 0).applyQuaternion(c.quaternion);
    audio.listen(c.position.x, c.position.y, c.position.z, _fwd.x, _fwd.y, _fwd.z, _upv.x, _upv.y, _upv.z);
    this.ui.tapToAdvance = this.director.cutscene || !this.player.inputEnabled;
    this.ui.update(dt);
    if (render) this.pipe.render(this.scene, this.camera);
    this.input.endFrame();
  }
}
