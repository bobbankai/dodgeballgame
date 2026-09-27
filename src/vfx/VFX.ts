import * as THREE from 'three';
import { ParticleSystem } from './Particles';
import { glowTexture, blobTexture } from '../rendering/Textures';
import type { Ball } from '../game/Ball';

const trailVert = /* glsl */ `
attribute float aT;
attribute float aSide;
varying float vT;
varying float vSide;
void main() {
  vT = aT;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const trailFrag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uIntensity;
varying float vT;
varying float vSide;
void main() {
  float along = pow(1.0 - vT, 1.6);
  float across = 1.0 - vSide * vSide;
  float core = pow(across, 6.0);
  vec3 c = mix(uColor, uCore, core * 0.8);
  gl_FragColor = vec4(c * (1.0 + core), along * across * uIntensity);
}`;

class Trail {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private readonly N: number;
  private pts: THREE.Vector3[] = [];
  private times: number[] = [];
  private count = 0;
  private clock = 0;
  private posAttr: THREE.BufferAttribute;
  private tAttr: THREE.BufferAttribute;
  ball: Ball | null = null;
  width = 0.14;
  /** Seconds of history shown (trail length scales with ball speed). */
  life = 0.15;
  fade = 0;
  active = false;

  constructor(n = 40) {
    this.N = n;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 2 * 3);
    const aT = new Float32Array(n * 2);
    const aSide = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      aSide[i * 2] = -1;
      aSide[i * 2 + 1] = 1;
      this.pts.push(new THREE.Vector3());
      this.times.push(0);
      if (i < n - 1) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.tAttr = new THREE.BufferAttribute(aT, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aT', this.tAttr);
    geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: trailVert,
      fragmentShader: trailFrag,
      uniforms: { uColor: { value: new THREE.Color(1, 0.5, 0.2) }, uCore: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 18;
  }

  start(ball: Ball, color: THREE.Color, width: number, intensity: number, life: number) {
    this.ball = ball;
    this.active = true;
    this.fade = 1;
    this.width = width;
    this.life = life;
    (this.mat.uniforms.uColor.value as THREE.Color).copy(color);
    this.mat.uniforms.uIntensity.value = intensity;
    this.count = 0;
    this.clock = 0;
    this.mesh.visible = true;
  }

  update(dt: number, camPos: THREE.Vector3) {
    if (!this.mesh.visible) return;
    this.clock += dt;
    const b = this.ball;
    if (b && this.active) {
      // push newest sample at index 0
      if (this.count < this.N) this.count++;
      const recycled = this.pts.pop()!;
      this.pts.unshift(recycled.copy(b.pos));
      this.times.pop();
      this.times.unshift(this.clock);
    } else {
      this.fade -= dt * 4;
      if (this.fade <= 0) {
        this.mesh.visible = false;
        this.ball = null;
        return;
      }
    }
    // drop samples older than the trail lifetime
    while (this.count > 2 && this.clock - this.times[this.count - 1] > this.life) this.count--;
    const P = this.posAttr.array as Float32Array;
    const TT = this.tAttr.array as Float32Array;
    const tangent = new THREE.Vector3(), view = new THREE.Vector3(), side = new THREE.Vector3();
    const n = Math.max(2, this.count);
    for (let i = 0; i < this.N; i++) {
      const j = Math.min(i, n - 1);
      const p = this.pts[j];
      const a = this.pts[Math.max(0, j - 1)], c = this.pts[Math.min(n - 1, j + 1)];
      tangent.subVectors(a, c);
      if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
      view.subVectors(camPos, p);
      side.crossVectors(tangent, view).normalize();
      const age = Math.min(1, (this.clock - this.times[j]) / this.life);
      const t = i >= n ? 1 : age;
      const w = this.width * (1 - t * 0.8) * Math.max(0, this.fade);
      P[i * 6] = p.x - side.x * w;
      P[i * 6 + 1] = p.y - side.y * w;
      P[i * 6 + 2] = p.z - side.z * w;
      P[i * 6 + 3] = p.x + side.x * w;
      P[i * 6 + 4] = p.y + side.y * w;
      P[i * 6 + 5] = p.z + side.z * w;
      TT[i * 2] = TT[i * 2 + 1] = t;
    }
    this.posAttr.needsUpdate = true;
    this.tAttr.needsUpdate = true;
  }
}

const ringFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uThick;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(1.0 - uThick, 1.0 - uThick * 0.4, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float inner = (1.0 - smoothstep(0.0, 1.0, r)) * 0.15;
  gl_FragColor = vec4(uColor * 2.0, (ring + inner) * uAlpha);
}`;

interface Timed {
  obj: THREE.Object3D;
  t: number;
  life: number;
  size0: number;
  size1: number;
  alpha: number;
  kind: 'ring' | 'flash' | 'decal';
  mat: THREE.Material & { opacity?: number };
}

/**
 * Visual effects hub: particles (additive + alpha), ball trails, ground rings,
 * flashes, scorch decals and a small pool of impact lights.
 */
export class VFX {
  readonly root = new THREE.Group();
  readonly add: ParticleSystem;
  readonly alpha: ParticleSystem;
  private trails: Trail[] = [];
  private timed: Timed[] = [];
  private ringPool: THREE.Mesh[] = [];
  private flashPool: THREE.Sprite[] = [];
  private decalPool: THREE.Mesh[] = [];
  private lights: { light: THREE.PointLight; t: number; life: number; peak: number }[] = [];
  private scale = 1;

  constructor(particleScale = 1, maxLights = 3) {
    this.scale = particleScale;
    this.add = new ParticleSystem(3000, true);
    this.alpha = new ParticleSystem(1500, false);
    this.add.scale = this.alpha.scale = particleScale;
    this.root.add(this.add.mesh, this.alpha.mesh);
    for (let i = 0; i < 10; i++) {
      const t = new Trail();
      this.trails.push(t);
      this.root.add(t.mesh);
    }
    for (let i = 0; i < maxLights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      l.visible = true;
      this.root.add(l);
      this.lights.push({ light: l, t: 0, life: 0, peak: 0 });
    }
  }

  setScale(s: number) {
    this.scale = s;
    this.add.scale = this.alpha.scale = s;
  }

  // ---------------------------------------------------------------- trails
  trailFor(ball: Ball, color: THREE.Color, width: number, intensity: number, life = 0.14) {
    const existing = this.trails.find((t) => t.ball === ball && t.active);
    if (existing) {
      (existing.mat.uniforms.uColor.value as THREE.Color).copy(color);
      existing.mat.uniforms.uIntensity.value = intensity;
      existing.width = width;
      existing.life = life;
      return;
    }
    const free = this.trails.find((t) => !t.mesh.visible) ?? this.trails[0];
    free.start(ball, color, width, intensity, life);
  }
  endTrail(ball: Ball) {
    for (const t of this.trails) if (t.ball === ball) t.active = false;
  }

  // ---------------------------------------------------------------- primitives
  ring(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, life = 0.5, thick = 0.18, alpha = 1, vertical?: THREE.Vector3) {
    let m = this.ringPool.pop();
    if (!m) {
      m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
          fragmentShader: ringFrag,
          uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uThick: { value: 0.2 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      m.renderOrder = 19;
      this.root.add(m);
    }
    const mat = m.material as THREE.ShaderMaterial;
    (mat.uniforms.uColor.value as THREE.Color).set(color);
    mat.uniforms.uThick.value = thick;
    m.visible = true;
    m.position.copy(pos);
    if (vertical) {
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vertical);
    } else {
      m.rotation.set(-Math.PI / 2, 0, 0);
      m.position.y = Math.max(0.03, pos.y);
    }
    this.timed.push({ obj: m, t: 0, life, size0: radius * 0.15, size1: radius * 2, alpha, kind: 'ring', mat });
  }

  flash(pos: THREE.Vector3, size: number, color: THREE.ColorRepresentation, life = 0.18, alpha = 1) {
    let s = this.flashPool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.renderOrder = 21;
      this.root.add(s);
    }
    (s.material as THREE.SpriteMaterial).color.set(color);
    s.visible = true;
    s.position.copy(pos);
    this.timed.push({ obj: s, t: 0, life, size0: size * 0.5, size1: size, alpha, kind: 'flash', mat: s.material });
  }

  decal(pos: THREE.Vector3, size: number, color: THREE.ColorRepresentation, life = 6) {
    let m = this.decalPool.pop();
    if (!m) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.root.add(m);
    }
    (m.material as THREE.MeshBasicMaterial).color.set(color);
    m.visible = true;
    m.position.set(pos.x, 0.013, pos.z);
    m.rotation.z = Math.random() * 6;
    this.timed.push({ obj: m, t: 0, life, size0: size, size1: size * 1.05, alpha: 0.6, kind: 'decal', mat: m.material as THREE.MeshBasicMaterial });
  }

  light(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, life = 0.25, distance = 8) {
    if (!this.lights.length) return;
    const slot = this.lights.reduce((a, b) => (a.t / Math.max(a.life, 1e-3) > b.t / Math.max(b.life, 1e-3) ? a : b));
    slot.light.position.copy(pos);
    slot.light.color.set(color);
    slot.light.distance = distance;
    slot.t = 0;
    slot.life = life;
    slot.peak = intensity;
  }

  // ---------------------------------------------------------------- composite effects
  impact(point: THREE.Vector3, dir: THREE.Vector3, power: number, color: THREE.ColorRepresentation, importance = 1) {
    const p = Math.min(2.5, power) * importance;
    const back = dir.clone().negate().normalize();
    this.add.emit({ pos: point, count: 18 + p * 22, dir: back, spread: 1.2, speed: [4, 10 + p * 6], life: [0.15, 0.4], size: [0.06, 0.01], color: 0xfff1c9, color2: color, gravity: 9, drag: 3, stretch: 0.035, shape: 1 });
    this.add.emit({ pos: point, count: 6 + p * 6, speed: [0.5, 2], life: [0.2, 0.5], size: [0.35 + p * 0.2, 0.9 + p * 0.4], color, alpha: 0.5, drag: 4, shape: 0 });
    this.alpha.emit({ pos: point, count: 5 + p * 4, speed: [0.3, 1.2], life: [0.4, 0.9], size: [0.25, 0.7], color: 0xd9d2c5, alpha: 0.35, drag: 2, gravity: -0.4 });
    this.flash(point, 0.9 + p * 0.9, color, 0.14 + p * 0.04);
    this.flash(point, 0.5 + p * 0.4, 0xffffff, 0.08);
    this.ring(point, 0.5 + p * 0.5, color, 0.3, 0.25, 0.8, back);
    this.light(point, color, 10 * p, 0.2, 5 + p * 2);
  }

  catchBurst(point: THREE.Vector3, perfect: boolean, color: THREE.ColorRepresentation, importance = 1) {
    const k = importance;
    this.add.emit({ pos: point, count: (perfect ? 50 : 20) * k, speed: [2, perfect ? 8 : 5], life: [0.2, 0.5], size: [0.06, 0.01], color: perfect ? 0xffffff : color, color2: color, drag: 4, stretch: 0.03, shape: 1 });
    this.ring(point, (perfect ? 1.1 : 0.6) * k, perfect ? 0xfff2a8 : color, perfect ? 0.4 : 0.28, 0.2, 0.9, new THREE.Vector3(0, 0, 1));
    this.flash(point, (perfect ? 1.8 : 1.0) * k, perfect ? 0xfff2c0 : color, perfect ? 0.25 : 0.14, 0.8);
    if (perfect) {
      this.ring(new THREE.Vector3(point.x, 0.04, point.z), 1.8 * k, 0xffe38a, 0.55, 0.12, 0.8);
      this.light(point, 0xffe8a8, 16 * k, 0.3, 6);
    }
  }

  dust(pos: THREE.Vector3, amount: number, color: THREE.ColorRepresentation = 0xcbb89a, dir?: THREE.Vector3) {
    this.alpha.emit({
      pos: new THREE.Vector3(pos.x, 0.08, pos.z),
      count: 3 + amount * 6,
      dir: dir ?? new THREE.Vector3(0, 1, 0),
      spread: dir ? 0.9 : 1.2,
      speed: [0.4, 1.4 + amount],
      life: [0.35, 0.8],
      size: [0.12, 0.45 + amount * 0.2],
      color,
      alpha: 0.28 + amount * 0.1,
      drag: 3.5,
      gravity: -0.3,
      jitter: 0.15,
    });
  }

  sparks(pos: THREE.Vector3, dir: THREE.Vector3, count: number, color: THREE.ColorRepresentation, speed = 8) {
    this.add.emit({ pos, count, dir, spread: 0.9, speed: [speed * 0.4, speed], life: [0.15, 0.45], size: [0.05, 0.01], color: 0xffffff, color2: color, gravity: 12, drag: 2, stretch: 0.04, shape: 1, floor: true });
  }

  shockwave(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation) {
    const g = new THREE.Vector3(pos.x, 0.05, pos.z);
    this.ring(g, radius, color, 0.55, 0.14, 1);
    this.ring(g, radius * 0.6, 0xffffff, 0.35, 0.3, 0.8);
    this.alpha.emit({ pos: g, count: 26, dir: new THREE.Vector3(0, 1, 0), spread: 1.5, speed: [3, 8], life: [0.4, 0.9], size: [0.3, 1.1], color: 0xc9bca6, alpha: 0.4, drag: 3, jitter: 0.4 });
    this.add.emit({ pos, count: 40, speed: [4, 12], life: [0.2, 0.5], size: [0.08, 0.02], color: 0xffffff, color2: color, drag: 2.5, stretch: 0.04, shape: 1, gravity: 4 });
    this.decal(pos, radius * 0.9, 0x1a1410, 7);
    this.light(new THREE.Vector3(pos.x, 1, pos.z), color, 35, 0.4, 10);
  }

  energyMotes(pos: THREE.Vector3, color: THREE.ColorRepresentation, count = 3, radius = 0.6) {
    // particles converging on a point (charging)
    for (let i = 0; i < count; i++) {
      const off = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(radius);
      this.add.emit({ pos: pos.clone().add(off), count: 1, dir: off.clone().negate().normalize(), spread: 0.1, speed: [radius * 2.5, radius * 3.5], life: [0.22, 0.3], size: [0.05, 0.1], color, drag: 0, stretch: 0.02, shape: 1 });
    }
  }

  update(dt: number, camera: THREE.Camera) {
    this.add.update(dt);
    this.alpha.update(dt);
    const cp = camera.position;
    for (const t of this.trails) t.update(dt, cp);
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const e = this.timed[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.life);
      if (k >= 1) {
        e.obj.visible = false;
        this.timed.splice(i, 1);
        if (e.kind === 'ring') this.ringPool.push(e.obj as THREE.Mesh);
        else if (e.kind === 'flash') this.flashPool.push(e.obj as THREE.Sprite);
        else this.decalPool.push(e.obj as THREE.Mesh);
        continue;
      }
      const ease = 1 - Math.pow(1 - k, 3);
      const s = e.size0 + (e.size1 - e.size0) * ease;
      e.obj.scale.set(s, s, s);
      const a = e.kind === 'decal' ? e.alpha * (1 - k * k) : e.alpha * (1 - k);
      if (e.kind === 'ring') (e.mat as THREE.ShaderMaterial).uniforms.uAlpha.value = a;
      else (e.mat as any).opacity = a;
    }
    for (const l of this.lights) {
      if (l.life <= 0) {
        l.light.intensity = 0;
        continue;
      }
      l.t += dt;
      const k = Math.min(1, l.t / l.life);
      l.light.intensity = l.peak * (1 - k) * (1 - k);
      if (k >= 1) l.life = 0;
    }
  }

  clear() {
    this.add.clear();
    this.alpha.clear();
    for (const t of this.trails) {
      t.mesh.visible = false;
      t.ball = null;
    }
  }
}
