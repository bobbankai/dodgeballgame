import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { Fx } from '@/gameplay/ctx';

/**
 * Impact and temporal effects: hit sparks and shock rings.
 *
 * Sparks live in four instanced buffers (position + life, velocity + lifetime, colour + size, gravity / drag / ground
 * height), integrated on the CPU each simulation step (gravity, drag, a bounce on the ground they were born over) and
 * uploaded while any are alive; the GPU draws each as a camera-facing streak stretched along its screen-space velocity, HDR
 * and additive (bloom catches it). A few hundred sparks at most are alive, so the CPU step costs microseconds.
 * (A compute-shader path was tried: its spawn pass wrote nothing on the test device; see docs/RENDERER.md.)
 * Shock rings (parries, ability pulses) are soft radial bands on pooled quads, coloured by uniforms (no recompiles).
 * Everything steps in simulation time, so hit-stop and time-slow freeze the sparks too.
 */
const T = TSL as any;
const { Fn, uniform, instancedBufferAttribute, float, vec2, vec3, vec4, max, min, length, normalize, smoothstep, uv,
  cameraViewMatrix, cameraProjectionMatrix, positionGeometry, varying, select } = T;

const N = 2048;

interface Ring { mesh: THREE.Mesh; life: number; max: number; from: number; to: number; alive: boolean; col: any; alpha: any }

export class Particles implements Fx {
  readonly group = new THREE.Group();
  /** particle count multiplier (quality preset) */
  density = 1;
  private pos = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  private vel = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  private look = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  private phys = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  private fresh = false;
  private head = 0;

  private alive = 0; // CPU estimate of live sparks (seconds of the longest life left)
  private rings: Ring[] = [];
  private q = new THREE.Quaternion();
  private z = new THREE.Vector3(0, 0, 1);

  constructor() {
    for (const a of [this.pos, this.vel, this.look, this.phys]) a.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.buildSparks());
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < 10; i++) {
      const col = uniform(new THREE.Color(1, 1, 1));
      const alpha = uniform(0);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      // a soft band at the rim, a faint wash inside it
      const d = length(uv().mul(2.0).sub(1.0));
      const band = smoothstep(0.91, 0.975, d).mul(smoothstep(1.0, 0.975, d));
      m.colorNode = vec3(col).mul(band.add(smoothstep(1.0, 0.3, d).mul(0.012))).mul(alpha);
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, from: 0.1, to: 2, alive: false, col, alpha });
    }
  }

  private buildSparks(): THREE.Mesh {
    const read = (a: THREE.InstancedBufferAttribute) => instancedBufferAttribute(a);
    const p = read(this.pos), v = read(this.vel), l = read(this.look);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    // a camera-facing streak along the screen-space velocity, collapsed when dead
    m.vertexNode = Fn(() => {
      const viewPos = cameraViewMatrix.mul(vec4(p.xyz, 1.0)).xyz;
      const vv = cameraViewMatrix.mul(vec4(v.xyz, 0.0)).xy;
      const speed = length(v.xyz);
      const axis = select(length(vv).greaterThan(1e-4), normalize(vv), vec2(1.0, 0.0));
      const perp = vec2(axis.y.negate(), axis.x);
      const stretch = float(1).add(min(speed.mul(0.16), 5.0));
      const size = l.w.mul(2.2).mul(select(p.w.greaterThan(0.0), float(1), float(0)));
      const off = axis.mul(positionGeometry.x.mul(size).mul(stretch)).add(perp.mul(positionGeometry.y.mul(size)));
      return cameraProjectionMatrix.mul(vec4(viewPos.add(vec3(off, 0.0)), 1.0));
    })();
    const fade = varying(min(p.w.div(max(v.w, 1e-3)).mul(1.6), 1.0));
    const tint = varying(l.xyz);
    const q = uv().sub(0.5).mul(2.0);
    const core = float(1).sub(smoothstep(0.0, 1.0, length(q)));
    m.colorNode = tint.mul(core.pow(1.6)).mul(fade).mul(3.0);
    m.opacityNode = core;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.instanceCount = N;
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    return mesh;
  }

  private emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, col: THREE.Color, grav: number, drag: number, ground: number): void {
    const i = this.head;
    this.head = (this.head + 1) % N;
    this.alive = Math.max(this.alive, life);
    const w = (a: THREE.InstancedBufferAttribute, x: number, y: number, z: number, ww: number) => {
      const arr = a.array as Float32Array;
      arr[i * 4] = x; arr[i * 4 + 1] = y; arr[i * 4 + 2] = z; arr[i * 4 + 3] = ww;
    };
    w(this.pos, pos.x, pos.y, pos.z, life);
    w(this.vel, vel.x, vel.y, vel.z, life);
    w(this.look, col.r, col.g, col.b, size);
    w(this.phys, grav, drag, ground, 0);
    this.fresh = true;
  }

  private ring(pos: THREE.Vector3, normal: THREE.Vector3, col: THREE.Color, from: number, to: number, life: number): void {
    const r = this.rings.find((x) => !x.alive);
    if (!r) return;
    r.alive = true; r.life = r.max = life; r.from = from; r.to = to;
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    r.mesh.quaternion.copy(this.q.setFromUnitVectors(this.z, normal));
    r.col.value.copy(col).multiplyScalar(1.5);
  }

  hit(point: THREE.Vector3, dir: THREE.Vector3, o: { heavy: boolean; blocked: boolean; parried: boolean }): void {
    const n = Math.round((o.heavy ? 26 : 14) * this.density);
    const base = o.parried ? new THREE.Color(0.35, 0.9, 1.0) : o.blocked ? new THREE.Color(1.0, 0.75, 0.35) : new THREE.Color(1.0, 0.55, 0.2);
    const ground = point.y - 1.2; // roughly the floor under a strike at chest height
    for (let i = 0; i < n; i++) {
      const a = new THREE.Vector3(THREE.MathUtils.randFloatSpread(1.4), THREE.MathUtils.randFloat(-0.2, 1.1), THREE.MathUtils.randFloatSpread(1.4));
      a.addScaledVector(dir, o.blocked ? 0.9 : 1.6).normalize().multiplyScalar(THREE.MathUtils.randFloat(2.5, o.heavy ? 9 : 6.5));
      const c = base.clone().lerp(new THREE.Color(1, 1, 1), Math.random() * 0.5);
      this.emit(point, a, THREE.MathUtils.randFloat(0.12, o.heavy ? 0.45 : 0.3), THREE.MathUtils.randFloat(0.018, 0.034), c, 10, 2.2, ground);
    }
    this.ring(point, dir.clone().setY(0.2).normalize(), base, 0.05, o.heavy ? 0.9 : 0.55, 0.16);
  }

  pulse(point: THREE.Vector3, kind: 'parry' | 'slow' | 'rewind' | 'shift' | 'echo'): void {
    const col = { parry: new THREE.Color(0.4, 0.9, 1), slow: new THREE.Color(0.4, 0.6, 1), rewind: new THREE.Color(1, 0.45, 0.9), shift: new THREE.Color(0.9, 0.95, 1), echo: new THREE.Color(0.3, 1, 0.85) }[kind];
    const size = { parry: 1.8, slow: 3.6, rewind: 4.2, shift: 7, echo: 2.0 }[kind];
    const life = { parry: 0.35, slow: 0.7, rewind: 0.8, shift: 1.0, echo: 0.6 }[kind];
    this.ring(point, new THREE.Vector3(0, 1, 0), col, 0.1, size, life);
    this.ring(point, new THREE.Vector3(1, 0, 0), col, 0.1, size * 0.8, life * 0.9);
    this.ring(point, new THREE.Vector3(0, 0, 1), col, 0.1, size * 0.8, life * 0.9);
    const n = Math.round((kind === 'parry' ? 30 : 60) * this.density);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(THREE.MathUtils.randFloat(1.5, size * 1.4));
      this.emit(point, v, THREE.MathUtils.randFloat(0.3, 0.8), THREE.MathUtils.randFloat(0.02, 0.045), col, 0, 1.6, -1e4);
    }
  }

  /** Advance in simulation time. */
  step(dt: number): void {
    if (this.alive > 0 || this.fresh) {
      this.integrate(dt);
      this.alive -= dt;
      this.fresh = false;
    }
    for (const r of this.rings) {
      if (!r.alive) continue;
      r.life -= dt;
      if (r.life <= 0) { r.alive = false; r.mesh.visible = false; continue; }
      const t = 1 - r.life / r.max;
      r.mesh.scale.setScalar(THREE.MathUtils.lerp(r.from, r.to, 1 - (1 - t) * (1 - t)));
      r.alpha.value = 1 - t;
    }
  }

  private integrate(dt: number): void {
    const p = this.pos.array as Float32Array, v = this.vel.array as Float32Array, s = this.phys.array as Float32Array;
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      if (p[o + 3] <= 0) continue;
      const damp = Math.max(0, 1 - s[o + 1] * dt);
      v[o + 1] -= s[o] * dt;
      v[o] *= damp; v[o + 1] *= damp; v[o + 2] *= damp;
      p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
      if (p[o + 1] < s[o + 2]) { p[o + 1] = s[o + 2]; v[o] *= 0.55; v[o + 1] = Math.abs(v[o + 1]) * 0.3; v[o + 2] *= 0.55; }
      p[o + 3] -= dt;
    }
    for (const attr of [this.pos, this.vel, this.look, this.phys]) attr.needsUpdate = true;
  }

  /** Per rendered frame (kept for the game's frame order; the sparks face the camera in their own vertex stage). */
  update(_camera: THREE.Camera): void { /* nothing per frame */ }
}
