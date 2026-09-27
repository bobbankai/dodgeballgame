import * as THREE from 'three';
import { REFLECT_LAYER } from '../rendering/FloorReflection';

export interface EmitOpts {
  pos: THREE.Vector3;
  count: number;
  /** base direction (normalised) — omit for spherical */
  dir?: THREE.Vector3;
  spread?: number; // radians cone half-angle (π = sphere)
  speed: [number, number];
  life: [number, number];
  size: [number, number]; // start, end
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
  /** velocity stretch factor for sparks */
  stretch?: number;
  /** random position jitter radius */
  jitter?: number;
  /** 0 = soft round, 1 = hard spark core, 2 = ring */
  shape?: number;
  /** multiply emitted velocity by */
  inherit?: THREE.Vector3;
  floor?: boolean;
}

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec3 iParams; // size, stretch, shape
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  vUv = position.xy;
  vColor = iColor;
  vShape = iParams.z;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
  float size = iParams.x;
  vec2 corner = position.xy;
  vec2 dir = vv.xy;
  float sp = length(dir);
  if (iParams.y > 0.0 && sp > 0.001) {
    dir /= sp;
    vec2 nrm = vec2(-dir.y, dir.x);
    float len = size + sp * iParams.y;
    vec2 off = dir * corner.y * len + nrm * corner.x * size * 0.5;
    mv.xy += off;
  } else {
    mv.xy += corner * size;
  }
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  float r = length(vUv) * 2.0;
  float a;
  if (vShape < 0.5) a = pow(max(0.0, 1.0 - r), 1.6);
  else if (vShape < 1.5) a = pow(max(0.0, 1.0 - r), 3.0) * 1.6;
  else a = smoothstep(0.55, 0.8, r) * (1.0 - smoothstep(0.85, 1.0, r)) * 1.5;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

/**
 * Pooled billboard particles rendered as one instanced draw call per blend mode.
 * CPU simulated (cheap: positions + velocities with drag and gravity).
 */
export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private max: number;
  private count = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  private col0: Float32Array;
  private col1: Float32Array;
  private alpha: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private stretch: Float32Array;
  private shape: Float32Array;
  private floor: Uint8Array;
  private aPos: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aPar: THREE.InstancedBufferAttribute;
  scale = 1;

  constructor(max: number, additive: boolean) {
    this.max = max;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.col0 = new Float32Array(max * 3);
    this.col1 = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.stretch = new Float32Array(max);
    this.shape = new Float32Array(max);
    this.floor = new Uint8Array(max);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iColor', this.aCol);
    geo.setAttribute('iParams', this.aPar);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.geo = geo;
    geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.layers.enable(REFLECT_LAYER);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
  }

  emit(o: EmitOpts) {
    const n = Math.max(1, Math.round(o.count * this.scale));
    const c0 = new THREE.Color(o.color);
    const c1 = new THREE.Color(o.color2 ?? o.color);
    const dir = o.dir ?? null;
    const spread = o.spread ?? Math.PI;
    const tmp = new THREE.Vector3();
    const perpA = new THREE.Vector3(), perpB = new THREE.Vector3();
    if (dir) {
      perpA.set(1, 0, 0);
      if (Math.abs(dir.x) > 0.9) perpA.set(0, 1, 0);
      perpA.crossVectors(dir, perpA).normalize();
      perpB.crossVectors(dir, perpA).normalize();
    }
    for (let k = 0; k < n; k++) {
      if (this.count >= this.max) this.kill(0);
      const i = this.count++;
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      if (dir) {
        const a = Math.random() * Math.PI * 2;
        const th = Math.acos(1 - Math.random() * (1 - Math.cos(spread)));
        tmp.copy(dir).multiplyScalar(Math.cos(th)).addScaledVector(perpA, Math.sin(th) * Math.cos(a)).addScaledVector(perpB, Math.sin(th) * Math.sin(a));
      } else {
        tmp.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      }
      tmp.multiplyScalar(sp);
      if (o.inherit) tmp.add(o.inherit);
      const j = o.jitter ?? 0;
      this.pos[i * 3] = o.pos.x + (Math.random() - 0.5) * j * 2;
      this.pos[i * 3 + 1] = o.pos.y + (Math.random() - 0.5) * j * 2;
      this.pos[i * 3 + 2] = o.pos.z + (Math.random() - 0.5) * j * 2;
      this.vel[i * 3] = tmp.x;
      this.vel[i * 3 + 1] = tmp.y;
      this.vel[i * 3 + 2] = tmp.z;
      const life = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.size0[i] = o.size[0] * (0.7 + Math.random() * 0.6);
      this.size1[i] = o.size[1];
      this.col0.set([c0.r, c0.g, c0.b], i * 3);
      this.col1.set([c1.r, c1.g, c1.b], i * 3);
      this.alpha[i] = o.alpha ?? 1;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1;
      this.stretch[i] = o.stretch ?? 0;
      this.shape[i] = o.shape ?? 0;
      this.floor[i] = o.floor ? 1 : 0;
    }
  }

  private kill(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.col0.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.col1.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size0[i] = this.size0[last];
    this.size1[i] = this.size1[last];
    this.alpha[i] = this.alpha[last];
    this.grav[i] = this.grav[last];
    this.drag[i] = this.drag[last];
    this.stretch[i] = this.stretch[last];
    this.shape[i] = this.shape[last];
    this.floor[i] = this.floor[last];
  }

  update(dt: number) {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.floor[i] && this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.3;
        this.vel[i * 3] *= 0.6;
        this.vel[i * 3 + 2] *= 0.6;
      }
    }
    const P = this.aPos.array as Float32Array, V = this.aVel.array as Float32Array, C = this.aCol.array as Float32Array, A = this.aPar.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];
      P[i * 3] = this.pos[i * 3];
      P[i * 3 + 1] = this.pos[i * 3 + 1];
      P[i * 3 + 2] = this.pos[i * 3 + 2];
      V[i * 3] = this.vel[i * 3];
      V[i * 3 + 1] = this.vel[i * 3 + 1];
      V[i * 3 + 2] = this.vel[i * 3 + 2];
      const fadeIn = Math.min(1, t * 12);
      const fadeOut = 1 - t * t;
      C[i * 4] = this.col0[i * 3] + (this.col1[i * 3] - this.col0[i * 3]) * t;
      C[i * 4 + 1] = this.col0[i * 3 + 1] + (this.col1[i * 3 + 1] - this.col0[i * 3 + 1]) * t;
      C[i * 4 + 2] = this.col0[i * 3 + 2] + (this.col1[i * 3 + 2] - this.col0[i * 3 + 2]) * t;
      C[i * 4 + 3] = this.alpha[i] * fadeIn * fadeOut;
      A[i * 3] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      A[i * 3 + 1] = this.stretch[i];
      A[i * 3 + 2] = this.shape[i];
    }
    this.geo.instanceCount = this.count;
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aCol.needsUpdate = this.aPar.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.geo.instanceCount = 0;
  }
}
