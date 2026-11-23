import { Color3, Mesh, MeshBuilder, ShaderLanguage, ShaderMaterial, Vector4 } from '@babylonjs/core';
import type { Renderer } from './Renderer';

/** A train line through a station: which track, how often a train passes and how fast. */
export interface TrainDef {
  /** the track's line (world z) and the rails' height (world y) */
  z: number;
  y: number;
  cars?: number;
  carLength?: number;
  /** seconds between trains */
  period?: number;
  /** m/s */
  speed?: number;
}

const HEIGHT = 3.4;
const WIDTH = 3.0;
const GAP = 0.6;

/**
 * The passing train (vb_train): every so often a train rushes along the near track out of one
 * tunnel and into the other. Its cars are boxes drawn by train.vertex/fragment (steel, stripe, lit
 * windows with passengers, doors, headlights, tail lights, smeared at speed); the light from its
 * windows and headlights falls on the platform through the environment shader (`light`).
 */
export class Train {
  private cars: Mesh[] = [];
  private mats: ShaderMaterial[] = [];
  private off: () => void;
  private t: number;
  private dir = 1;
  /** the front of the train (world x) */
  x = -1e4;
  readonly length: number;
  private readonly carLen: number;
  private readonly speed: number;
  private readonly period: number;
  /** how near the train is to the middle of the station (0 gone .. 1 right here), for the gust */
  nearness = 0;
  /** for the environment shader: front x, track z, dir * length, amount */
  readonly light = new Vector4(0, 0, 0, 0);

  constructor(private r: Renderer, private def: TrainDef) {
    const scene = r.scene;
    const n = def.cars ?? 4;
    this.carLen = def.carLength ?? 18;
    this.speed = def.speed ?? 30;
    this.period = def.period ?? 32;
    this.length = n * this.carLen + (n - 1) * GAP;
    this.t = this.period * 0.4;
    for (let i = 0; i < n; i++) {
      const m = MeshBuilder.CreateBox('trainCar' + i, { width: this.carLen, height: HEIGHT, depth: WIDTH }, scene);
      const mat = new ShaderMaterial('trainMat' + i, scene, { vertex: 'train', fragment: 'train' }, {
        attributes: ['position', 'normal'],
        uniforms: ['world', 'viewProjection', 'carSize', 'trainParams', 'trainDir', 'sunDir', 'sunColor', 'skyColor', 'bodyColor', 'stripeColor', 'windowColor'],
        shaderLanguage: ShaderLanguage.WGSL,
      });
      mat.setColor3('bodyColor', new Color3(0.78, 0.8, 0.83));
      mat.setColor3('stripeColor', new Color3(0.1, 0.55, 0.35));
      mat.setColor3('windowColor', new Color3(1.6, 1.55, 1.35));
      mat.setVector4('carSize', new Vector4(this.carLen, HEIGHT, WIDTH, i));
      m.material = mat;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.setEnabled(false);
      r.shadow.addCaster(m);
      r.gbuffer.add(m, undefined, 950 + i);
      this.cars.push(m);
      this.mats.push(mat);
    }
    this.off = r.mats.onUpdate((l) => {
      this.mats.forEach((mat, i) => {
        mat.setVector4('trainParams', new Vector4(this.speed, l.time, i === 0 ? 1 : 0, i === this.mats.length - 1 ? 1 : 0));
        mat.setFloat('trainDir', this.dir);
        mat.setVector3('sunDir', l.sunDir);
        mat.setColor3('sunColor', l.sunColor);
        mat.setColor3('skyColor', l.skyColor);
      });
    });
  }

  update(dt: number): void {
    this.t += dt;
    const travel = 2 * 110 + this.length;
    const runTime = travel / this.speed;
    if (this.t >= this.period) {
      // the next train, from alternating ends
      this.t = 0;
      this.dir = -this.dir;
    }
    const running = this.t < runTime;
    this.x = running ? -this.dir * 110 + this.dir * this.t * this.speed : -1e4;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      c.setEnabled(running);
      if (!running) continue;
      const cx = this.x - this.dir * (this.carLen / 2 + i * (this.carLen + GAP));
      c.position.set(cx, this.def.y + HEIGHT / 2 + 0.15, this.def.z);
    }
    // how close the middle of the train is to the station's middle
    const mid = this.x - this.dir * this.length / 2;
    this.nearness = running ? Math.max(0, 1 - Math.abs(mid) / (this.length * 0.5 + 25)) : 0;
    this.light.set(this.x, this.def.z, this.dir * this.length, running ? 1 : 0);
  }

  dispose(): void {
    this.off();
    for (const c of this.cars) {
      this.r.shadow.removeCaster(c);
      c.material?.dispose();
      c.dispose();
    }
    this.cars = [];
  }
}

