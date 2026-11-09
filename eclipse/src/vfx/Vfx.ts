import {
  Color3, Color4, ParticleSystem, Vector3, type AbstractMesh, type Scene, type Texture, type TransformNode,
} from '@babylonjs/core';
import { fxTextures } from './Textures';
import type { LocalLights } from '../render/LocalLights';

/** How one particle layer of an effect looks and moves. Times in seconds, distances in metres. */
interface Layer {
  tex: 'soft' | 'spark' | 'smoke' | 'flame' | 'ring';
  add: boolean;
  count: number;
  life: [number, number];
  size: [number, number];
  /** Size multiplier over life (pairs of [t, k]). */
  grow?: [number, number][];
  power: [number, number];
  /** Emission directions: 'burst' (all round), 'up', 'ring' (outward on the ground), 'cone' (along dir). */
  shape: 'burst' | 'up' | 'ring' | 'cone' | 'box';
  spread?: number;
  /** Emission volume half-size (box) or radius (ring/up). */
  extent?: number;
  height?: number;
  gravity?: number;
  drag?: number;
  color: [number, number, number, number];
  color2?: [number, number, number, number];
  dead: [number, number, number, number];
  stretched?: boolean;
  spin?: number;
  /** Continuous emitters: particles per second (0 = one burst). */
  rate?: number;
  capacity?: number;
}

interface Preset {
  layers: Layer[];
  light?: { color: [number, number, number]; intensity: number; range: number; time: number };
}

const HOT: [number, number, number, number] = [4.5, 2.4, 0.9, 1];
const EMBER: [number, number, number, number] = [3.2, 1.1, 0.25, 1];
const EMBER_DEAD: [number, number, number, number] = [0.6, 0.05, 0, 0];

/** The game's effect library. Each preset is a few particle layers and an optional light flash. */
export const PRESETS: Record<string, Preset> = {
  sparks: {
    layers: [
      { tex: 'spark', add: true, count: 28, life: [0.12, 0.4], size: [0.025, 0.06], power: [4, 12], shape: 'cone', spread: 0.9, gravity: -9.8, drag: 1.5, color: HOT, dead: [1, 0.25, 0, 0], stretched: true },
      { tex: 'soft', add: true, count: 1, life: [0.07, 0.07], size: [0.5, 0.5], power: [0, 0], shape: 'box', color: [3, 2, 1.2, 1], dead: [1, 0.4, 0.1, 0] },
    ],
    light: { color: [1, 0.6, 0.3], intensity: 18, range: 4, time: 0.12 },
  },
  blocked: {
    layers: [
      { tex: 'spark', add: true, count: 40, life: [0.1, 0.35], size: [0.02, 0.05], power: [5, 14], shape: 'cone', spread: 1.3, gravity: -9.8, drag: 2, color: [5, 4, 2.6, 1], dead: [1, 0.5, 0.1, 0], stretched: true },
    ],
    light: { color: [1, 0.85, 0.6], intensity: 22, range: 4, time: 0.1 },
  },
  parry: {
    layers: [
      { tex: 'spark', add: true, count: 70, life: [0.15, 0.5], size: [0.03, 0.07], power: [6, 16], shape: 'burst', gravity: -6, drag: 2.5, color: [6, 5, 3, 1], dead: [1, 0.6, 0.2, 0], stretched: true },
      { tex: 'ring', add: true, count: 1, life: [0.25, 0.25], size: [0.4, 0.4], grow: [[0, 0.3], [1, 3.2]], power: [0, 0], shape: 'box', color: [4, 3.4, 2, 1], dead: [1, 0.8, 0.4, 0] },
      { tex: 'soft', add: true, count: 1, life: [0.12, 0.12], size: [1.2, 1.2], power: [0, 0], shape: 'box', color: [4, 3.5, 2.5, 1], dead: [1, 0.8, 0.5, 0] },
    ],
    light: { color: [1, 0.9, 0.7], intensity: 60, range: 7, time: 0.22 },
  },
  ash: {
    layers: [
      { tex: 'smoke', add: false, count: 8, life: [0.5, 1.1], size: [0.18, 0.4], grow: [[0, 0.6], [1, 2.2]], power: [0.4, 1.6], shape: 'cone', spread: 1.2, gravity: 0.6, drag: 2.5, color: [0.18, 0.16, 0.15, 0.55], dead: [0.25, 0.23, 0.22, 0], spin: 1 },
      { tex: 'soft', add: true, count: 14, life: [0.4, 1.0], size: [0.02, 0.05], power: [1, 4], shape: 'cone', spread: 1.1, gravity: 1.2, drag: 1.5, color: EMBER, dead: EMBER_DEAD },
    ],
  },
  embers: {
    layers: [
      { tex: 'soft', add: true, count: 30, life: [0.6, 1.6], size: [0.02, 0.06], power: [0.5, 3], shape: 'up', extent: 0.4, gravity: 1.6, drag: 1.2, color: EMBER, dead: EMBER_DEAD },
    ],
  },
  dust: {
    layers: [
      { tex: 'smoke', add: false, count: 10, life: [0.5, 1.0], size: [0.25, 0.5], grow: [[0, 0.5], [1, 2]], power: [1, 2.6], shape: 'ring', extent: 0.25, gravity: 0.2, drag: 3, color: [0.32, 0.29, 0.26, 0.45], dead: [0.35, 0.32, 0.3, 0], spin: 0.6 },
    ],
  },
  emberSlam: {
    layers: [
      { tex: 'smoke', add: false, count: 26, life: [0.7, 1.4], size: [0.45, 0.9], grow: [[0, 0.5], [1, 2.4]], power: [3, 7], shape: 'ring', extent: 0.5, gravity: 0.4, drag: 3.5, color: [0.2, 0.17, 0.15, 0.6], dead: [0.28, 0.25, 0.23, 0], spin: 0.5 },
      { tex: 'soft', add: true, count: 60, life: [0.6, 1.5], size: [0.03, 0.08], power: [2, 7], shape: 'up', extent: 1.0, gravity: -4, drag: 1, color: EMBER, dead: EMBER_DEAD },
      { tex: 'ring', add: true, count: 1, life: [0.35, 0.35], size: [1, 1], grow: [[0, 0.2], [1, 4.5]], power: [0, 0], shape: 'box', color: [3, 1.2, 0.3, 1], dead: [1, 0.2, 0, 0] },
    ],
    light: { color: [1, 0.45, 0.15], intensity: 70, range: 9, time: 0.35 },
  },
  fireBurst: {
    layers: [
      { tex: 'flame', add: true, count: 34, life: [0.25, 0.55], size: [0.35, 0.8], grow: [[0, 0.6], [1, 1.6]], power: [2, 6], shape: 'burst', gravity: 3, drag: 4, color: [3.5, 1.6, 0.5, 1], color2: [2.8, 0.9, 0.2, 1], dead: [0.4, 0.05, 0, 0], spin: 2 },
      { tex: 'smoke', add: false, count: 10, life: [0.8, 1.5], size: [0.4, 0.8], grow: [[0, 0.5], [1, 2.2]], power: [0.5, 2], shape: 'burst', gravity: 1.5, drag: 2, color: [0.12, 0.1, 0.09, 0.5], dead: [0.2, 0.18, 0.17, 0], spin: 0.5 },
      { tex: 'soft', add: true, count: 24, life: [0.5, 1.2], size: [0.02, 0.06], power: [2, 6], shape: 'burst', gravity: -3, drag: 1, color: EMBER, dead: EMBER_DEAD },
    ],
    light: { color: [1, 0.5, 0.2], intensity: 45, range: 7, time: 0.3 },
  },
  firePillar: {
    layers: [
      { tex: 'flame', add: true, count: 130, life: [0.35, 0.8], size: [0.5, 1.2], grow: [[0, 0.5], [0.4, 1.2], [1, 0.6]], power: [6, 13], shape: 'up', extent: 1.0, gravity: 2, drag: 1.5, color: [3.6, 1.6, 0.45, 1], color2: [3, 0.9, 0.2, 1], dead: [0.3, 0.04, 0, 0], spin: 2 },
      { tex: 'soft', add: true, count: 70, life: [0.8, 1.8], size: [0.03, 0.08], power: [4, 12], shape: 'up', extent: 1.2, gravity: -2, drag: 0.8, color: EMBER, dead: EMBER_DEAD },
      { tex: 'smoke', add: false, count: 20, life: [1.2, 2.2], size: [0.6, 1.2], grow: [[0, 0.5], [1, 2.5]], power: [3, 7], shape: 'up', extent: 1.0, gravity: 0.5, drag: 1.2, color: [0.1, 0.08, 0.07, 0.5], dead: [0.15, 0.13, 0.12, 0], spin: 0.4 },
    ],
    light: { color: [1, 0.5, 0.18], intensity: 110, range: 11, time: 0.7 },
  },
  fireTrail: {
    layers: [
      { tex: 'flame', add: true, count: 0, rate: 70, capacity: 90, life: [0.18, 0.32], size: [0.22, 0.4], grow: [[0, 1], [1, 0.3]], power: [0.2, 0.8], shape: 'burst', gravity: 1, drag: 2, color: [3.6, 1.8, 0.6, 1], color2: [3, 1, 0.25, 1], dead: [0.5, 0.06, 0, 0], spin: 3 },
      { tex: 'soft', add: true, count: 0, rate: 25, capacity: 50, life: [0.4, 0.9], size: [0.02, 0.05], power: [0.3, 1.5], shape: 'burst', gravity: -1, drag: 1, color: EMBER, dead: EMBER_DEAD },
    ],
  },
  aether: {
    layers: [
      { tex: 'soft', add: true, count: 40, life: [0.3, 0.8], size: [0.04, 0.1], power: [2, 7], shape: 'burst', gravity: 0, drag: 3, color: [1.2, 2.2, 5, 1], dead: [0.1, 0.2, 1, 0] },
      { tex: 'ring', add: true, count: 1, life: [0.3, 0.3], size: [0.6, 0.6], grow: [[0, 0.3], [1, 3]], power: [0, 0], shape: 'box', color: [1, 2, 4, 1], dead: [0.2, 0.4, 1, 0] },
    ],
    light: { color: [0.5, 0.7, 1], intensity: 40, range: 7, time: 0.3 },
  },
  deathAsh: {
    layers: [
      { tex: 'smoke', add: false, count: 0, rate: 30, capacity: 80, life: [0.8, 1.6], size: [0.15, 0.35], grow: [[0, 0.6], [1, 2]], power: [0.2, 0.8], shape: 'box', extent: 0.3, height: 1.7, gravity: 1.4, drag: 1, color: [0.16, 0.14, 0.13, 0.5], dead: [0.25, 0.23, 0.22, 0], spin: 0.5 },
      { tex: 'soft', add: true, count: 0, rate: 60, capacity: 140, life: [0.8, 1.8], size: [0.02, 0.05], power: [0.3, 1.2], shape: 'box', extent: 0.3, height: 1.7, gravity: 1.8, drag: 0.6, color: EMBER, dead: EMBER_DEAD },
    ],
  },
  tellGlint: {
    layers: [
      { tex: 'spark', add: true, count: 2, life: [0.32, 0.32], size: [0.42, 0.42], grow: [[0, 0.1], [0.3, 1], [1, 0]], power: [0, 0], shape: 'box', color: [2.6, 2.3, 1.8, 1], dead: [0.4, 0.35, 0.3, 0], spin: 6 },
      { tex: 'soft', add: true, count: 1, life: [0.3, 0.3], size: [0.2, 0.2], power: [0, 0], shape: 'box', color: [2.2, 2, 1.6, 1], dead: [0.3, 0.3, 0.3, 0] },
    ],
  },
  tellRed: {
    layers: [
      { tex: 'spark', add: true, count: 2, life: [0.45, 0.45], size: [0.6, 0.6], grow: [[0, 0.1], [0.3, 1], [1, 0]], power: [0, 0], shape: 'box', color: [4, 0.45, 0.2, 1], dead: [0.5, 0, 0, 0], spin: 5 },
      { tex: 'soft', add: true, count: 1, life: [0.45, 0.45], size: [0.35, 0.35], power: [0, 0], shape: 'box', color: [3, 0.3, 0.12, 1], dead: [0.5, 0, 0, 0] },
    ],
    light: { color: [1, 0.15, 0.05], intensity: 15, range: 4, time: 0.45 },
  },
  // ambient: grey flakes drifting down in a wide box that follows the camera
  ashfall: {
    layers: [
      { tex: 'soft', add: false, count: 0, rate: 140, capacity: 1100, life: [5, 8], size: [0.02, 0.05], power: [0.2, 0.6], shape: 'box', extent: 22, height: 14, gravity: -0.35, drag: 0.4, color: [0.55, 0.53, 0.5, 0.5], dead: [0.45, 0.43, 0.41, 0], spin: 2 },
    ],
  },
  emberDrift: {
    layers: [
      { tex: 'soft', add: true, count: 0, rate: 30, capacity: 260, life: [3, 6], size: [0.02, 0.045], power: [0.2, 0.8], shape: 'box', extent: 18, height: 6, gravity: 0.35, drag: 0.3, color: [3.5, 1.3, 0.3, 1], dead: [0.6, 0.06, 0, 0] },
    ],
  },
  // a building on fire: tall tongues of flame, sparks and heavy smoke
  bonfire: {
    layers: [
      { tex: 'flame', add: true, count: 0, rate: 60, capacity: 160, life: [0.5, 1.1], size: [0.8, 1.8], grow: [[0, 0.5], [0.3, 1], [1, 0.4]], power: [1.5, 3.5], shape: 'up', extent: 1.4, height: 0.4, gravity: 1.5, drag: 1, color: [3.2, 1.4, 0.4, 1], color2: [2.6, 0.8, 0.18, 1], dead: [0.3, 0.04, 0, 0], spin: 1.5 },
      { tex: 'soft', add: true, count: 0, rate: 25, capacity: 120, life: [1.5, 3], size: [0.02, 0.05], power: [2, 5], shape: 'up', extent: 1.2, gravity: 0.6, drag: 0.4, color: [3.5, 1.3, 0.3, 1], dead: [0.6, 0.06, 0, 0] },
      { tex: 'smoke', add: false, count: 0, rate: 9, capacity: 90, life: [4, 7], size: [1.5, 2.6], grow: [[0, 0.5], [1, 3]], power: [2, 3.5], shape: 'up', extent: 1.2, height: 1.5, gravity: 0.3, drag: 0.2, color: [0.08, 0.07, 0.065, 0.55], dead: [0.12, 0.11, 0.1, 0], spin: 0.3 },
    ],
  },
  smokeColumn: {
    layers: [
      { tex: 'smoke', add: false, count: 0, rate: 5, capacity: 80, life: [10, 16], size: [4, 7], grow: [[0, 0.5], [1, 3]], power: [3, 5], shape: 'up', extent: 3, height: 2, gravity: 0.2, drag: 0.1, color: [0.1, 0.09, 0.085, 0.5], dead: [0.16, 0.15, 0.14, 0], spin: 0.15 },
    ],
  },
  heal: {
    layers: [
      { tex: 'soft', add: true, count: 50, life: [0.8, 1.5], size: [0.03, 0.08], power: [0.5, 1.6], shape: 'box', extent: 0.4, height: 1.6, gravity: 1.2, drag: 1, color: [3.4, 2.2, 0.9, 1], dead: [1, 0.5, 0.1, 0] },
    ],
    light: { color: [1, 0.7, 0.35], intensity: 20, range: 5, time: 0.8 },
  },
};

class Pool {
  readonly systems: ParticleSystem[][] = [];
  next = 0;
  constructor(readonly preset: Preset) {}
}

/** A running continuous effect (projectile trails, burning bodies); call stop() to let it die out. */
export interface FxHandle {
  stop(): void;
  move(p: Vector3): void;
}

interface Flash {
  light: import('@babylonjs/core').PointLight;
  t: number;
  dur: number;
  peak: number;
}

/**
 * Pooled particle effects and light flashes. Bursts reuse a few systems per preset (round robin);
 * continuous effects get their own systems. Particle time follows game time (frozen in hit-stop,
 * slowed in slow motion): the scene runs particles at a constant animation ratio and the update
 * speed is set from the game's step each frame, so lifetimes and speeds here are in seconds.
 */
export class Vfx {
  private textures: Record<string, Texture>;
  private pools = new Map<string, Pool>();
  private live = new Set<ParticleSystem>();
  private flashes: Flash[] = [];
  /** Scales particle counts (quality presets). */
  density = 1;
  /** Called for every burst (the game maps effects to sounds). */
  onBurst: ((name: string, at: Vector3, scale: number) => void) | null = null;
  private dt = 1 / 60;

  constructor(private scene: Scene, local: LocalLights, lights = 6) {
    this.textures = fxTextures(scene);
    scene.useConstantAnimationDeltaTime = true;
    // flash lights live in the clustered container (dark until an effect borrows one)
    for (let i = 0; i < (local.clustered ? lights : 2); i++) {
      const l = local.add(new Vector3(0, -100, 0), { color: [1, 1, 1], intensity: 0, range: 6 });
      if (l) this.flashes.push({ light: l, t: 1, dur: 1, peak: 0 });
    }
  }

  private build(layer: Layer, burst: boolean): ParticleSystem {
    const capacity = layer.capacity ?? Math.max(8, Math.ceil(layer.count * 3 * this.density));
    const ps = new ParticleSystem('fx', capacity, this.scene);
    ps.particleTexture = this.textures[layer.tex];
    ps.blendMode = layer.add ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    ps.minLifeTime = layer.life[0];
    ps.maxLifeTime = layer.life[1];
    ps.minSize = layer.size[0];
    ps.maxSize = layer.size[1];
    ps.minEmitPower = layer.power[0];
    ps.maxEmitPower = layer.power[1];
    ps.gravity = new Vector3(0, layer.gravity ?? 0, 0);
    ps.color1 = new Color4(...layer.color);
    ps.color2 = new Color4(...(layer.color2 ?? layer.color));
    ps.colorDead = new Color4(...layer.dead);
    if (layer.grow) for (const [t, k] of layer.grow) ps.addSizeGradient(t, k);
    if (layer.drag) {
      ps.addDragGradient(0, Math.min(1, layer.drag * 0.05));
      ps.addDragGradient(1, Math.min(1, layer.drag * 0.05));
    }
    if (layer.spin) {
      ps.minAngularSpeed = -layer.spin;
      ps.maxAngularSpeed = layer.spin;
      ps.minInitialRotation = 0;
      ps.maxInitialRotation = Math.PI * 2;
    }
    if (layer.stretched) ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    const e = layer.extent ?? 0.05;
    ps.minEmitBox = new Vector3(-e, 0, -e);
    ps.maxEmitBox = new Vector3(e, layer.height ?? (layer.shape === 'up' ? 0.2 : e), e);
    ps.updateSpeed = 1 / 60;
    ps.emitRate = burst ? 0 : (layer.rate ?? 0) * this.density;
    ps.manualEmitCount = burst ? 0 : -1;
    ps.preventAutoStart = true;
    ps.isLocal = false;
    ps.start();
    this.live.add(ps);
    return ps;
  }

  private aim(ps: ParticleSystem, layer: Layer, dir: Vector3, scale: number): void {
    const s = layer.spread ?? 1;
    switch (layer.shape) {
      case 'burst':
        ps.direction1.set(-1, -1, -1);
        ps.direction2.set(1, 1, 1);
        break;
      case 'up':
        ps.direction1.set(-0.25, 1, -0.25);
        ps.direction2.set(0.25, 1, 0.25);
        break;
      case 'ring':
        ps.direction1.set(-1, 0.05, -1);
        ps.direction2.set(1, 0.25, 1);
        break;
      case 'cone':
        ps.direction1.set(dir.x - s, dir.y - s * 0.5, dir.z - s);
        ps.direction2.set(dir.x + s, dir.y + s, dir.z + s);
        break;
      case 'box':
        ps.direction1.set(-0.05, 0.1, -0.05);
        ps.direction2.set(0.05, 0.2, 0.05);
        break;
    }
    const e = (layer.extent ?? 0.05) * scale;
    ps.minEmitBox.set(-e, 0, -e);
    ps.maxEmitBox.set(e, (layer.height ?? (layer.shape === 'up' ? 0.2 : layer.extent ?? 0.05)) * scale, e);
    ps.minSize = layer.size[0] * scale;
    ps.maxSize = layer.size[1] * scale;
  }

  /** A one-shot effect at a point; `dir` orients cones (sparks fly back along the blow). */
  burst(name: string, at: Vector3, dir: Vector3 = Vector3.Up(), scale = 1): void {
    const preset = PRESETS[name];
    if (!preset) return;
    let pool = this.pools.get(name);
    if (!pool) {
      pool = new Pool(preset);
      this.pools.set(name, pool);
    }
    const slot = pool.next;
    pool.next = (pool.next + 1) % 4;
    if (!pool.systems[slot]) pool.systems[slot] = preset.layers.map((l) => this.build(l, true));
    preset.layers.forEach((layer, i) => {
      const ps = pool.systems[slot][i];
      ps.emitter = at.clone();
      this.aim(ps, layer, dir, scale);
      ps.manualEmitCount = Math.max(1, Math.round(layer.count * (layer.count > 2 ? this.density : 1)));
    });
    if (preset.light) this.flash(at, preset.light.color, preset.light.intensity * scale, preset.light.range * Math.sqrt(scale), preset.light.time);
    this.onBurst?.(name, at, scale);
  }

  /** A continuous effect that follows a node or a point until stopped. */
  attach(name: string, target: TransformNode | Vector3, scale = 1): FxHandle {
    const preset = PRESETS[name];
    const systems = preset ? preset.layers.map((l) => {
      const ps = this.build(l, false);
      this.aim(ps, l, Vector3.Up(), scale);
      ps.emitter = target instanceof Vector3 ? target.clone() : (target as AbstractMesh);
      return ps;
    }) : [];
    return {
      stop: () => {
        for (const ps of systems) {
          ps.emitRate = 0;
          // dispose once the last particles have faded
          setTimeout(() => {
            this.live.delete(ps);
            ps.dispose();
          }, ps.maxLifeTime * 1000 * 4 + 500);
        }
      },
      move: (p: Vector3) => {
        for (const ps of systems) if (ps.emitter instanceof Vector3) (ps.emitter as Vector3).copyFrom(p);
      },
    };
  }

  /** Brief point-light flash (borrows the oldest light in the pool). */
  flash(at: Vector3, color: [number, number, number], intensity: number, range: number, time: number): void {
    let f = this.flashes[0];
    for (const x of this.flashes) if (x.t / x.dur > f.t / f.dur) f = x;
    f.light.position.copyFrom(at).addInPlaceFromFloats(0, 0.3, 0);
    f.light.diffuse = new Color3(...color);
    f.light.specular = f.light.diffuse;
    f.light.range = range;
    f.peak = intensity;
    f.t = 0;
    f.dur = time;
  }

  /** `dt`: game seconds simulated this frame (0 while paused or in hit-stop). */
  update(dt: number): void {
    this.dt = dt;
    for (const ps of this.live) ps.updateSpeed = Math.max(dt, 1e-5);
    for (const f of this.flashes) {
      if (f.t >= f.dur) {
        f.light.intensity = 0;
        continue;
      }
      f.t += dt;
      const k = Math.max(0, 1 - f.t / f.dur);
      f.light.intensity = f.peak * k * k;
    }
  }

  get frameDt(): number {
    return this.dt;
  }

  clear(): void {
    for (const ps of this.live) ps.dispose();
    this.live.clear();
    this.pools.clear();
  }
}
