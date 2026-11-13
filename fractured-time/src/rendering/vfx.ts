import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { Fx } from '@/gameplay/ctx';

const { color, instanceColor, uv, length, smoothstep, float, vec3, time, sin, mix, attribute } = TSL as any;

interface Spark {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  col: THREE.Color;
  grav: number;
  drag: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  from: number;
  to: number;
  alive: boolean;
}

const MAX_SPARKS = 768;

/**
 * Impact and temporal effects. Hit sparks are velocity-stretched additive streaks with per-particle colour; shock rings carry the parry and ability pulses.
 * Particle counts scale with the quality preset. Everything is CPU-stepped in the fixed tick and billboarded per frame (small counts, no GPU compute required),
 * so the same code runs on the WebGPU and WebGL2 backends.
 */
export class Vfx implements Fx {
  readonly group = new THREE.Group();
  private sparks: Spark[] = [];
  private mesh: THREE.InstancedMesh;
  private rings: Ring[] = [];
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private z = new THREE.Vector3(0, 0, 1);
  density = 1;

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const p = uv().sub(0.5).mul(2);
    // soft streak: bright core, fast falloff along both axes
    const core = float(1).sub(smoothstep(0.0, 1.0, length(p.mul(vec3(1, 1.0, 1).xy))));
    mat.colorNode = instanceColor.mul(core.pow(1.6)).mul(3.0);
    mat.opacityNode = core;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX_SPARKS);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
    for (let i = 0; i < MAX_SPARKS; i++) this.sparks.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 0.05, col: new THREE.Color(), grav: 0, drag: 0 });

    const ringGeo = new THREE.RingGeometry(0.94, 1, 64);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, m);
      ring.visible = false;
      ring.frustumCulled = false;
      this.group.add(ring);
      this.rings.push({ mesh: ring, life: 0, max: 1, from: 0.1, to: 2, alive: false });
    }
  }

  private emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, col: THREE.Color, grav = 9, drag = 2.5): void {
    const s = this.sparks.find((x) => !x.alive);
    if (!s) return;
    s.alive = true; s.pos.copy(pos); s.vel.copy(vel); s.life = s.max = life; s.size = size; s.col.copy(col); s.grav = grav; s.drag = drag;
  }

  private ring(pos: THREE.Vector3, normal: THREE.Vector3, col: THREE.Color, from: number, to: number, life: number): void {
    const r = this.rings.find((x) => !x.alive);
    if (!r) return;
    r.alive = true; r.life = r.max = life; r.from = from; r.to = to;
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    this.tmpQ.setFromUnitVectors(this.z, normal);
    r.mesh.quaternion.copy(this.tmpQ);
    const m = r.mesh.material as THREE.MeshBasicNodeMaterial;
    m.colorNode = color(col).mul(1.5);
  }

  hit(point: THREE.Vector3, dir: THREE.Vector3, o: { heavy: boolean; blocked: boolean; parried: boolean }): void {
    const n = Math.round((o.heavy ? 26 : 14) * this.density);
    const base = o.parried ? new THREE.Color(0.35, 0.9, 1.0) : o.blocked ? new THREE.Color(1.0, 0.75, 0.35) : new THREE.Color(1.0, 0.55, 0.2);
    for (let i = 0; i < n; i++) {
      const a = new THREE.Vector3(THREE.MathUtils.randFloatSpread(1.4), THREE.MathUtils.randFloat(-0.2, 1.1), THREE.MathUtils.randFloatSpread(1.4));
      a.addScaledVector(dir, o.blocked ? 0.9 : 1.6).normalize().multiplyScalar(THREE.MathUtils.randFloat(2.5, o.heavy ? 9 : 6.5));
      const c = base.clone().lerp(new THREE.Color(1, 1, 1), Math.random() * 0.5);
      this.emit(point, a, THREE.MathUtils.randFloat(0.12, o.heavy ? 0.4 : 0.28), THREE.MathUtils.randFloat(0.018, 0.034), c, 10, 2.2);
    }
    // impact flash ring facing the camera-ish (the attacker's direction)
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
      this.emit(point, v, THREE.MathUtils.randFloat(0.3, 0.8), THREE.MathUtils.randFloat(0.02, 0.045), col, 0, 1.6);
    }
  }

  /** advance in simulation time (so hit-stop freezes the sparks too) */
  step(dt: number): void {
    for (const s of this.sparks) {
      if (!s.alive) continue;
      s.life -= dt;
      if (s.life <= 0) { s.alive = false; continue; }
      s.vel.y -= s.grav * dt;
      s.vel.multiplyScalar(Math.max(0, 1 - s.drag * dt));
      s.pos.addScaledVector(s.vel, dt);
    }
    for (const r of this.rings) {
      if (!r.alive) continue;
      r.life -= dt;
      if (r.life <= 0) { r.alive = false; r.mesh.visible = false; continue; }
      const t = 1 - r.life / r.max;
      const e = 1 - (1 - t) * (1 - t);
      r.mesh.scale.setScalar(THREE.MathUtils.lerp(r.from, r.to, e));
      (r.mesh.material as THREE.MeshBasicNodeMaterial).opacity = 1 - t;
    }
  }

  /** billboard + stretch along velocity; call every rendered frame */
  update(camera: THREE.Camera): void {
    let n = 0;
    const camPos = camera.position;
    for (const s of this.sparks) {
      if (!s.alive) continue;
      const speed = s.vel.length();
      const stretch = 1 + Math.min(speed * 0.06, 5);
      // face the camera; long axis along the velocity projected on the view plane
      const toCam = this.tmpV.subVectors(camPos, s.pos).normalize();
      const axis = s.vel.clone().normalize();
      const right = new THREE.Vector3().crossVectors(axis, toCam).normalize();
      const fwd = new THREE.Vector3().crossVectors(right, toCam).normalize();
      if (!Number.isFinite(right.x) || speed < 1e-3) { right.set(1, 0, 0); fwd.set(0, 1, 0); }
      this.tmpM.makeBasis(fwd, right, toCam);
      this.tmpM.setPosition(s.pos);
      this.tmpS.set(s.size * stretch * 2.2, s.size * 2.2, 1);
      this.tmpM.scale(this.tmpS);
      this.mesh.setMatrixAt(n, this.tmpM);
      const f = Math.min(1, s.life / s.max * 1.6);
      this.mesh.setColorAt(n, new THREE.Color(s.col.r * f, s.col.g * f, s.col.b * f));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    void this.up; void mix; void vec3; void time; void sin; void attribute;
  }
}
