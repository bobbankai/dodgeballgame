// Particles and combat effects. One instanced quad draw for every particle in the scene; shapes and
// colours are procedural (tbParticle.wgsl). Emitters are named effects used by the combat code.
import { MeshBuilder, ShaderMaterial, ShaderLanguage, Constants, Vector3, Matrix } from '@babylonjs/core';
import type { Mesh } from '@babylonjs/core';
import type { Renderer } from './Renderer';

export const SHAPE = { glow: 0, star: 1, ring: 2, smoke: 3, streak: 4, wind: 5, drop: 6, shard: 7, ink: 8, warn: 9, glyph: 10 } as const;
type ShapeName = keyof typeof SHAPE;

interface P {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  size: number; grow: number; rot: number; spin: number; life: number; age: number;
  shape: number; mode: number; stretch: number; r: number; g: number; b: number; a: number;
  drag: number; gravity: number; follow?: { pos: Vector3 };
}

const MAX = 4096;

export interface FighterLike { pos: Vector3; center: Vector3; forward: Vector3; height: number; yaw: number }

export class Vfx {
  private ps: P[] = [];
  private mesh: Mesh;
  private pdata = new Float32Array(MAX * 4);
  private pvel = new Float32Array(MAX * 4);
  private pinfo = new Float32Array(MAX * 4);
  private pcol = new Float32Array(MAX * 4);
  private rng = 1;

  constructor(readonly r: Renderer) {
    const mesh = MeshBuilder.CreatePlane('vfx', { size: 1 }, r.scene);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    const mats = new Float32Array(MAX * 16);
    const id = Matrix.Identity().toArray();
    for (let i = 0; i < MAX; i++) mats.set(id, i * 16);
    mesh.thinInstanceSetBuffer('matrix', mats, 16, true);
    mesh.thinInstanceSetBuffer('pdata', this.pdata, 4, false);
    mesh.thinInstanceSetBuffer('pvel', this.pvel, 4, false);
    mesh.thinInstanceSetBuffer('pinfo', this.pinfo, 4, false);
    mesh.thinInstanceSetBuffer('pcol', this.pcol, 4, false);
    mesh.thinInstanceCount = 0;
    const m = new ShaderMaterial('vfxMat', r.scene, { vertex: 'tbParticle', fragment: 'tbParticle' }, {
      attributes: ['position', 'pdata', 'pvel', 'pinfo', 'pcol'], uniforms: ['world', 'viewProjection', 'view'], uniformBuffers: ['globals'],
      shaderLanguage: ShaderLanguage.WGSL, needAlphaBlending: true,
    });
    m.setUniformBuffer('globals', r.globals.ubo);
    m.alphaMode = Constants.ALPHA_ONEONE;
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
    mesh.material = m;
    this.mesh = mesh;
  }

  rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng & 0xffff) / 65536;
  }
  private rs(a: number): number { return (this.rand() * 2 - 1) * a; }

  spawn(o: Partial<P> & { x: number; y: number; z: number }, shape: ShapeName = 'glow'): void {
    if (this.ps.length >= MAX) this.ps.shift();
    this.ps.push({
      vx: 0, vy: 0, vz: 0, size: 0.3, grow: 0, rot: 0, spin: 0, life: 0.5, age: 0, mode: 0, stretch: 0,
      r: 1, g: 1, b: 1, a: 1, drag: 0, gravity: 0, ...o, shape: SHAPE[shape],
    } as P);
  }

  update(dt: number): void {
    const out: P[] = [];
    for (const p of this.ps) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy = p.vy * d - p.gravity * dt; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.follow) { p.x = p.follow.pos.x; p.z = p.follow.pos.z; }
      p.size += p.grow * dt;
      p.rot += p.spin * dt;
      out.push(p);
    }
    this.ps = out;
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const p = out[i];
      const o = i * 4;
      this.pdata[o] = p.x; this.pdata[o + 1] = p.y; this.pdata[o + 2] = p.z; this.pdata[o + 3] = Math.max(0, p.size);
      this.pvel[o] = p.vx; this.pvel[o + 1] = p.vy; this.pvel[o + 2] = p.vz; this.pvel[o + 3] = p.mode;
      this.pinfo[o] = p.rot; this.pinfo[o + 1] = p.age / p.life; this.pinfo[o + 2] = p.shape; this.pinfo[o + 3] = p.stretch;
      this.pcol[o] = p.r; this.pcol[o + 1] = p.g; this.pcol[o + 2] = p.b; this.pcol[o + 3] = p.a;
    }
    this.mesh.thinInstanceCount = Math.max(n, 0);
    if (n > 0) {
      for (const k of ['pdata', 'pvel', 'pinfo', 'pcol']) this.mesh.thinInstanceBufferUpdated(k);
    }
  }

  clear(): void { this.ps = []; }

  // ------------------------------------------------------------------------------------------ effects
  burst(at: Vector3, color: [number, number, number], count: number, speed: number, shape: ShapeName = 'star', size = 0.18, life = 0.35, gravity = 0): void {
    for (let i = 0; i < count; i++) {
      const th = this.rand() * Math.PI * 2, ph = (this.rand() - 0.3) * Math.PI;
      const s = speed * (0.4 + this.rand() * 0.8);
      this.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(th) * Math.cos(ph) * s, vy: Math.sin(ph) * s, vz: Math.sin(th) * Math.cos(ph) * s,
        size: size * (0.6 + this.rand() * 0.8), life: life * (0.7 + this.rand() * 0.6), r: color[0], g: color[1], b: color[2], a: 1, drag: 4, gravity,
        mode: shape === 'streak' ? 2 : 0, stretch: shape === 'streak' ? 3 : 0, rot: this.rand() * 6.28, spin: this.rs(6) }, shape);
    }
  }

  /** Anime hit spark: ink splash + star + ring + streaks, scaled by strength. */
  impact(at: Vector3, strength = 1, color: [number, number, number] = [2.2, 1.9, 1.2]): void {
    const s = strength;
    this.spawn({ x: at.x, y: at.y, z: at.z, size: 0.5 * s, grow: 3 * s, life: 0.14, r: 3, g: 3, b: 2.8, a: 1, rot: this.rand() * 6 }, 'ink');
    this.spawn({ x: at.x, y: at.y, z: at.z, size: 0.9 * s, grow: 1.5, life: 0.16, r: color[0] * 1.5, g: color[1] * 1.5, b: color[2] * 1.5, a: 1, rot: this.rand() * 6 }, 'star');
    this.spawn({ x: at.x, y: at.y, z: at.z, size: 0.3 * s, grow: 7 * s, life: 0.22, r: color[0], g: color[1], b: color[2], a: 0.9 }, 'ring');
    this.burst(at, color, Math.round(8 * s), 9 * s, 'streak', 0.12 * s, 0.25);
  }

  gale(at: Vector3, dir: Vector3, strength = 1): void {
    for (let i = 0; i < 5; i++) {
      const o = dir.scale(0.3 * i);
      this.spawn({ x: at.x + o.x, y: at.y + o.y + this.rs(0.2), z: at.z + o.z, vx: dir.x * 6, vy: 0, vz: dir.z * 6, size: (0.7 + i * 0.25) * strength,
        grow: 2.5, life: 0.3 + i * 0.03, r: 0.6, g: 1.6, b: 2.0, a: 0.7, rot: Math.atan2(dir.x, dir.z) + i, spin: 9 }, 'wind');
    }
    this.burst(at, [0.6, 1.7, 2.1], 10, 7, 'streak', 0.1, 0.3);
  }

  shock(at: Vector3, radius: number, color: [number, number, number] = [1.6, 1.2, 0.8]): void {
    this.spawn({ x: at.x, y: at.y + 0.05, z: at.z, size: 0.5, grow: radius * 4, life: 0.4, r: color[0], g: color[1], b: color[2], a: 1, mode: 1 }, 'ring');
    this.spawn({ x: at.x, y: at.y + 0.06, z: at.z, size: 0.3, grow: radius * 2.6, life: 0.5, r: color[0] * 0.6, g: color[1] * 0.6, b: color[2] * 0.6, a: 0.8, mode: 1 }, 'ring');
    for (let i = 0; i < 14; i++) {
      const th = (i / 14) * Math.PI * 2;
      this.spawn({ x: at.x + Math.cos(th) * 0.4, y: at.y + 0.2, z: at.z + Math.sin(th) * 0.4, vx: Math.cos(th) * radius * 3, vy: 1 + this.rand() * 2, vz: Math.sin(th) * radius * 3,
        size: 0.6 + this.rand() * 0.5, grow: 1.5, life: 0.7, r: 0.55, g: 0.5, b: 0.45, a: 0.55, drag: 3, rot: this.rand() * 6 }, 'smoke');
    }
  }

  dust(at: Vector3, n = 6): void {
    for (let i = 0; i < n; i++) {
      const th = this.rand() * Math.PI * 2;
      this.spawn({ x: at.x + Math.cos(th) * 0.2, y: at.y + 0.08, z: at.z + Math.sin(th) * 0.2, vx: Math.cos(th) * 1.6, vy: 0.4 + this.rand() * 0.6, vz: Math.sin(th) * 1.6,
        size: 0.35 + this.rand() * 0.3, grow: 0.9, life: 0.6 + this.rand() * 0.3, r: 0.55, g: 0.52, b: 0.48, a: 0.45, drag: 3, rot: this.rand() * 6 }, 'smoke');
    }
  }

  splash(at: Vector3, n = 14): void {
    for (let i = 0; i < n; i++) {
      const th = this.rand() * Math.PI * 2;
      const s = 2 + this.rand() * 4;
      this.spawn({ x: at.x, y: at.y + 0.1, z: at.z, vx: Math.cos(th) * s * 0.4, vy: 3 + this.rand() * 4, vz: Math.sin(th) * s * 0.4, size: 0.08 + this.rand() * 0.08,
        life: 0.8, r: 0.8, g: 1.0, b: 1.2, a: 0.9, gravity: 14 }, 'drop');
    }
    this.spawn({ x: at.x, y: at.y + 0.05, z: at.z, size: 0.3, grow: 4, life: 0.5, r: 0.7, g: 0.9, b: 1.0, a: 0.7, mode: 1 }, 'ring');
  }

  telegraph(f: FighterLike, def: { aoe?: boolean; reach: number; telegraph?: number; unblockable?: boolean }): void {
    const head = f.pos.add(new Vector3(0, f.height * 0.9, 0)).add(f.forward.scale(0.18));
    const red = def.unblockable ? [3.2, 0.3, 0.2] : [2.6, 1.6, 0.3];
    this.spawn({ x: head.x, y: head.y, z: head.z, size: 0.25, grow: 2.5, life: Math.max(0.25, (def.telegraph ?? 0.3) * 0.8), r: red[0], g: red[1], b: red[2], a: 1, spin: 5 }, 'star');
    if (def.aoe) {
      this.spawn({ x: f.pos.x, y: f.pos.y + 0.04, z: f.pos.z, size: def.reach * 2, grow: 0, life: def.telegraph ?? 0.5, r: red[0] * 0.6, g: red[1] * 0.4, b: red[2] * 0.4, a: 0.9, mode: 1 }, 'warn');
    }
  }

  warnCircle(at: Vector3, radius: number, time: number): void {
    this.spawn({ x: at.x, y: at.y + 0.05, z: at.z, size: radius * 2, life: time, r: 2.4, g: 0.35, b: 0.25, a: 0.9, mode: 1 }, 'warn');
  }

  aura(at: Vector3, color: [number, number, number], n = 2): void {
    for (let i = 0; i < n; i++) {
      this.spawn({ x: at.x + this.rs(0.35), y: at.y + this.rand() * 1.6, z: at.z + this.rs(0.35), vy: 1.5 + this.rand(), size: 0.12 + this.rand() * 0.12, life: 0.6,
        r: color[0], g: color[1], b: color[2], a: 0.8, spin: this.rs(4) }, this.rand() < 0.5 ? 'glow' : 'glyph');
    }
  }

  trail(at: Vector3, vel: Vector3, color: [number, number, number], size = 0.3): void {
    this.spawn({ x: at.x, y: at.y, z: at.z, vx: vel.x * 0.15, vy: vel.y * 0.15, vz: vel.z * 0.15, size, life: 0.18, r: color[0], g: color[1], b: color[2], a: 0.8, mode: 2, stretch: 6 }, 'streak');
  }
}

export function v3(x: number, y: number, z: number): Vector3 { return new Vector3(x, y, z); }
