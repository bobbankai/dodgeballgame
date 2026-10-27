import * as THREE from 'three';
import { G } from './Globals';
import { NOISE } from './glsl';

export const P = { Ink: 0, Sparkle: 1, Dust: 2, Leaf: 3 } as const;
export type P = (typeof P)[keyof typeof P];

interface Particle {
  type: P;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  age: number;
  size: number;
  grow: number;
  color: THREE.Color;
  alpha: number;
  rot: number;
  spin: number;
  gravity: number;
  drag: number;
}

const MAX = 800;

/** Overlay colours go straight to the screen: take hex values as display colours. */
function screenColor(c: THREE.ColorRepresentation) {
  return typeof c === 'number' ? new THREE.Color().setHex(c, THREE.LinearSRGBColorSpace) : new THREE.Color(c);
}

/** Billboard particles drawn on the finished page: ink splats, pigment sparkles, dust, leaves. */
export class Particles {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private list: Particle[] = [];
  private aPos = new Float32Array(MAX * 3);
  private aCol = new Float32Array(MAX * 4);
  private aMisc = new Float32Array(MAX * 4);

  constructor() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.aCol, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMisc', new THREE.InstancedBufferAttribute(this.aMisc, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec4 aCol; attribute vec4 aMisc;
        varying vec2 vUv; varying vec4 vCol; varying vec4 vMisc;
        void main() {
          vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
          float c = cos(aMisc.z), s = sin(aMisc.z);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          mv.xy += q * aMisc.y;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy; vCol = aCol; vMisc = aMisc;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tPaper; uniform float uBoil;
        varying vec2 vUv; varying vec4 vCol; varying vec4 vMisc;
        ${NOISE}
        void main() {
          float t = vMisc.x, seed = vMisc.w;
          float r = length(vUv);
          float a = 0.0;
          if (t < 0.5) {
            // ink splat: a ragged blob
            float edge = 0.7 + 0.25 * ibNoise(vec3(vUv * 3.0, seed));
            a = smoothstep(edge, edge - 0.08, r);
          } else if (t < 1.5) {
            // sparkle: a four-pointed star with a soft core
            float star = max(0.0, 1.0 - abs(vUv.x * vUv.y) * 40.0 - r * 0.9);
            a = clamp(star + smoothstep(0.35, 0.0, r), 0.0, 1.0);
          } else if (t < 2.5) {
            // dust: a soft puff with a pencil-thin outline
            float e = 0.75 + 0.15 * ibNoise(vec3(vUv * 2.5, seed + uBoil * 0.2));
            a = smoothstep(e, e - 0.3, r) * 0.45 + smoothstep(0.06, 0.0, abs(r - e + 0.04)) * 0.4;
          } else {
            // leaf: a pointed oval
            float l = length(vUv * vec2(1.0, 2.2));
            a = smoothstep(1.0, 0.9, l + abs(vUv.y) * 0.3);
          }
          float grain = texture2D(tPaper, gl_FragCoord.xy / 512.0).g;
          gl_FragColor = vec4(vCol.rgb, a * vCol.a * mix(0.7, 1.0, grain));
        }`,
      uniforms: { tPaper: G.tPaper, uBoil: G.uBoil },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  spawn(type: P, pos: THREE.Vector3, o: Partial<{ vel: THREE.Vector3; life: number; size: number; grow: number; color: THREE.ColorRepresentation; alpha: number; gravity: number; drag: number; spin: number }> = {}) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({
      type,
      pos: pos.clone(),
      vel: o.vel?.clone() ?? new THREE.Vector3(),
      life: o.life ?? 1,
      age: 0,
      size: o.size ?? 0.1,
      grow: o.grow ?? 0,
      color: screenColor(o.color ?? 0x15121a),
      alpha: o.alpha ?? 1,
      rot: Math.random() * Math.PI * 2,
      spin: o.spin ?? 0,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 0.5,
    });
  }

  /** A burst of ink drops flung outwards, the way a nib spatters. */
  inkBurst(at: THREE.Vector3, n = 16, speed = 3, size = 0.07) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.spawn(P.Ink, at, { vel: v, life: 0.5 + Math.random() * 0.5, size: size * (0.5 + Math.random()), gravity: 9, drag: 1.5, grow: -0.05 });
    }
  }

  sparkles(at: THREE.Vector3, color: THREE.ColorRepresentation, n = 12, spread = 0.6, size = 0.12) {
    for (let i = 0; i < n; i++) {
      const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread));
      this.spawn(P.Sparkle, p, { vel: new THREE.Vector3(0, 0.4 + Math.random() * 0.6, 0), life: 0.6 + Math.random() * 0.8, size: size * (0.5 + Math.random()), color, drag: 1, spin: (Math.random() - 0.5) * 3 });
    }
  }

  dust(at: THREE.Vector3, n = 6, size = 0.18) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a), 0.3, Math.sin(a)).multiplyScalar(0.8 + Math.random() * 0.8);
      this.spawn(P.Dust, at.clone().add(new THREE.Vector3(0, 0.05, 0)), { vel: v, life: 0.5 + Math.random() * 0.3, size: size * (0.6 + Math.random() * 0.6), grow: 0.25, color: 0xefe8d6, alpha: 0.9, drag: 4 });
    }
  }

  update(dt: number) {
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.size = Math.max(0.005, p.size + p.grow * dt);
      p.rot += p.spin * dt;
      list[w++] = p;
    }
    list.length = w;
    for (let i = 0; i < w; i++) {
      const p = list[i];
      const k = p.age / p.life;
      const fade = Math.min(1, k * 8) * (1 - THREE.MathUtils.smoothstep(k, 0.6, 1));
      this.aPos.set([p.pos.x, p.pos.y, p.pos.z], i * 3);
      this.aCol.set([p.color.r, p.color.g, p.color.b, p.alpha * fade], i * 4);
      this.aMisc.set([p.type, p.size, p.rot, (i * 7.31) % 100], i * 4);
    }
    const g = this.mesh.geometry;
    g.instanceCount = w;
    g.attributes.aPos.needsUpdate = g.attributes.aCol.needsUpdate = g.attributes.aMisc.needsUpdate = true;
  }
}
