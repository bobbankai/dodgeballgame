// Particles: a CPU-simulated pool rendered as soft point sprites (one additive system for sparks,
// embers and fire; one alpha system for smoke, dust and ash), plus GPU-only weather (rain streaks,
// snow) that wraps around the camera. Colours are HDR so hot particles bloom.
import * as THREE from 'three';
import { G } from './MaterialFX';

export type Kind = 'spark' | 'ember' | 'fire' | 'blaze' | 'smoke' | 'dust' | 'ash' | 'flash' | 'blood' | 'magic' | 'ice' | 'heal';

interface Spec {
  life: [number, number];
  speed: [number, number];
  size: [number, number];
  grav: number;
  drag: number;
  color: [THREE.Color, THREE.Color];
  additive: boolean;
  grow: number;
  spread: number;
  up: number;
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const SPECS: Record<Kind, Spec> = {
  spark: { life: [0.18, 0.45], speed: [4, 10], size: [0.025, 0.05], grav: 9, drag: 2.5, color: [C(9, 5, 1.6), C(3, 0.6, 0.1)], additive: true, grow: -0.5, spread: 0.9, up: 0.3 },
  ember: { life: [1.2, 3.2], speed: [0.2, 1.0], size: [0.02, 0.05], grav: -0.6, drag: 0.6, color: [C(6, 2.2, 0.5), C(1.5, 0.2, 0.02)], additive: true, grow: -0.3, spread: 1, up: 0.8 },
  fire: { life: [0.35, 0.8], speed: [0.4, 1.6], size: [0.18, 0.4], grav: -2.8, drag: 1.4, color: [C(3.0, 1.15, 0.28), C(0.7, 0.1, 0.01)], additive: true, grow: 0.8, spread: 0.6, up: 1 },
  blaze: { life: [0.5, 1.1], speed: [0.6, 2.0], size: [0.55, 1.25], grav: -3.2, drag: 1.2, color: [C(1.9, 0.62, 0.12), C(0.45, 0.05, 0.0)], additive: true, grow: 0.5, spread: 0.5, up: 1 },
  smoke: { life: [2.5, 5.0], speed: [0.3, 0.9], size: [0.6, 1.2], grav: -0.45, drag: 0.7, color: [C(0.06, 0.055, 0.05), C(0.14, 0.135, 0.13)], additive: false, grow: 2.2, spread: 0.6, up: 1 },
  dust: { life: [0.6, 1.4], speed: [0.6, 2.2], size: [0.2, 0.45], grav: 0.4, drag: 2.5, color: [C(0.35, 0.3, 0.24), C(0.3, 0.27, 0.22)], additive: false, grow: 1.6, spread: 1, up: 0.25 },
  ash: { life: [0.8, 2.0], speed: [0.6, 2.5], size: [0.03, 0.08], grav: 1.5, drag: 1.2, color: [C(0.05, 0.05, 0.06), C(0.12, 0.12, 0.13)], additive: false, grow: 0, spread: 1, up: 0.6 },
  flash: { life: [0.08, 0.12], speed: [0, 0], size: [0.9, 1.3], grav: 0, drag: 0, color: [C(12, 9, 6), C(4, 1.6, 0.4)], additive: true, grow: 1.5, spread: 0, up: 0 },
  blood: { life: [0.4, 0.9], speed: [1.5, 4], size: [0.03, 0.07], grav: 9, drag: 1, color: [C(0.15, 0.17, 0.2), C(0.05, 0.05, 0.07)], additive: false, grow: 0, spread: 0.7, up: 0.3 },
  magic: { life: [0.5, 1.2], speed: [0.5, 2], size: [0.04, 0.1], grav: -1, drag: 1.5, color: [C(1.2, 3.5, 6), C(0.2, 0.5, 1.5)], additive: true, grow: -0.4, spread: 1, up: 0.6 },
  ice: { life: [0.4, 1.0], speed: [2, 6], size: [0.03, 0.08], grav: 6, drag: 1.5, color: [C(3, 4.5, 6), C(0.6, 0.9, 1.6)], additive: true, grow: -0.5, spread: 0.9, up: 0.4 },
  heal: { life: [0.8, 1.6], speed: [0.3, 1.0], size: [0.03, 0.07], grav: -2.2, drag: 1.2, color: [C(6, 3, 0.8), C(2, 0.5, 0.1)], additive: true, grow: -0.2, spread: 1, up: 1 },
};

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aSeed;
uniform float uScale;
varying vec4 vColor;
varying float vSeed;
void main() {
  vColor = aColor;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.05);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying vec4 vColor;
varying float vSeed;
uniform float uSoft, uTime, uWisp;
float pHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float pNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1, 0)), f.x), mix(pHash(i + vec2(0, 1)), pHash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  // each particle turns slowly, so overlapping sprites never line up
  float ang = vSeed * 6.2831 + uTime * (vSeed - 0.5) * 0.6;
  c = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c;
  float r = dot(c, c);
  if (uWisp <= 0.0) {
    // flame tongue: narrow, tall, pointed at the top (point-coord y runs down the sprite)
    vec2 f = gl_PointCoord * 2.0 - 1.0;
    float w = 0.55 + 0.35 * (f.y + 1.0) * 0.5;
    r = (f.x * f.x) / (w * w) + (f.y + 0.15) * (f.y + 0.15) * 0.75;
  }
  if (r > 1.0) discard;
  float a = pow(1.0 - r, uSoft);
  if (uWisp > 0.0) {
    // billowing smoke / mist: break the disc up with drifting noise
    vec2 q = c * 1.6 + vSeed * 17.0;
    float n = pNoise(q * 1.7 + uTime * 0.12) * 0.6 + pNoise(q * 3.9 - uTime * 0.2) * 0.4;
    a *= smoothstep(0.18, 0.75, n * (0.55 + 0.45 * (1.0 - r)) + (1.0 - r) * 0.25) * uWisp;
  } else {
    // flames / sparks: a hot core, ragged rim
    vec2 f = gl_PointCoord * 2.0 - 1.0;
    float n = pNoise(vec2(f.x * 3.0, f.y * 2.0) + vSeed * 9.0 + vec2(0.0, uTime * 4.0));
    a *= smoothstep(0.15, 0.6, n * (1.0 - r * 0.6) + (1.0 - r) * 0.45);
  }
  gl_FragColor = vec4(vColor.rgb * a * vColor.a, a * vColor.a);
}`;

class Pool {
  readonly points: THREE.Points;
  private n: number;
  pos: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array; size0: Float32Array;
  col: Float32Array; c0: Float32Array; c1: Float32Array; grav: Float32Array; drag: Float32Array; grow: Float32Array; seed: Float32Array;
  private next = 0;
  private geo: THREE.BufferGeometry;
  /** peak opacity: hot additive particles go over 1 (bloom); smoke stays translucent */
  alphaK: number;

  constructor(n: number, additive: boolean) {
    this.n = n;
    this.alphaK = additive ? 1.6 : 0.55;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    this.size = new Float32Array(n); this.size0 = new Float32Array(n);
    this.col = new Float32Array(n * 4); this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.grow = new Float32Array(n);
    this.seed = new Float32Array(n).map(() => Math.random());
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
      uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 2.2 : 1.1 }, uTime: G.uTime, uWisp: { value: additive ? 0 : 1 } },
    });
    if (!additive) {
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 60 : 55;
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, s: Spec, scale: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const r = (a: [number, number]) => a[0] + Math.random() * (a[1] - a[0]);
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.max[i] = r(s.life);
    this.life[i] = this.max[i];
    this.size0[i] = r(s.size) * scale;
    this.grav[i] = s.grav; this.drag[i] = s.drag; this.grow[i] = s.grow;
    this.c0.set([s.color[0].r, s.color[0].g, s.color[0].b], i * 3);
    this.c1.set([s.color[1].r, s.color[1].g, s.color[1].b], i * 3);
  }

  update(dt: number, wind: THREE.Vector3): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const k = 1 - Math.max(0, this.life[i]) / this.max[i];
      const d = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] = this.vel[j] * d + wind.x * dt * 0.6;
      this.vel[j + 1] = this.vel[j + 1] * d - this.grav[i] * dt;
      this.vel[j + 2] = this.vel[j + 2] * d + wind.z * dt * 0.6;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = this.size0[i] * Math.max(0, 1 + this.grow[i] * k);
      const fade = Math.min(1, k * 8) * (1 - k);
      this.col[i * 4] = this.c0[j] + (this.c1[j] - this.c0[j]) * k;
      this.col[i * 4 + 1] = this.c0[j + 1] + (this.c1[j + 1] - this.c0[j + 1]) * k;
      this.col[i * 4 + 2] = this.c0[j + 2] + (this.c1[j + 2] - this.c0[j + 2]) * k;
      this.col[i * 4 + 3] = fade * this.alphaK;
    }
    this.geo.attributes.position.needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  setScale(px: number): void { (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px; }
}

export class Particles {
  readonly group = new THREE.Group();
  private add: Pool;
  private alpha: Pool;
  readonly wind = new THREE.Vector3(0.6, 0, 0.2);
  scale = 1;
  private emitters: { kind: Kind; pos: THREE.Vector3; rate: number; acc: number; radius: number; dir?: THREE.Vector3; on: boolean }[] = [];

  constructor(budget = 1) {
    this.add = new Pool(Math.round(5000 * budget), true);
    this.alpha = new Pool(Math.round(1200 * budget), false);
    this.group.add(this.add.points, this.alpha.points);
  }

  burst(kind: Kind, pos: THREE.Vector3, count: number, dir?: THREE.Vector3, sizeScale = 1): void {
    const s = SPECS[kind];
    const pool = s.additive ? this.add : this.alpha;
    const n = Math.max(1, Math.round(count * this.scale));
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const sp = s.speed[0] + Math.random() * (s.speed[1] - s.speed[0]);
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(s.spread);
      v.y += s.up;
      if (dir) v.addScaledVector(dir, 1.2);
      v.normalize().multiplyScalar(sp);
      pool.spawn(pos, v, s, sizeScale);
    }
  }

  /** continuous emitter (campfires, burning houses, ember drift around the player) */
  emitter(kind: Kind, pos: THREE.Vector3, rate: number, radius = 0.2, dir?: THREE.Vector3): { on: boolean; pos: THREE.Vector3 } {
    const e = { kind, pos: pos.clone(), rate, acc: 0, radius, dir, on: true };
    this.emitters.push(e);
    return e;
  }

  clearEmitters(): void { this.emitters.length = 0; }

  update(dt: number, viewportHeight: number, fovDeg: number): void {
    const px = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.add.setScale(px);
    this.alpha.setScale(px);
    const p = new THREE.Vector3();
    for (const e of this.emitters) {
      if (!e.on) continue;
      e.acc += e.rate * dt * this.scale;
      while (e.acc >= 1) {
        e.acc -= 1;
        p.copy(e.pos).add(new THREE.Vector3((Math.random() - 0.5) * 2 * e.radius, Math.random() * e.radius * 0.5, (Math.random() - 0.5) * 2 * e.radius));
        this.burst(e.kind, p, 1, e.dir);
      }
    }
    this.add.update(dt, this.wind);
    this.alpha.update(dt, this.wind);
  }
}

// ---------------------------------------------------------------------------------------------
// Weather: rain streaks / snow, fully animated in the vertex shader inside a box that follows the
// camera (no CPU work, no popping). Rain is drawn as thin camera-facing streaks lit by the sky.
// ---------------------------------------------------------------------------------------------
const RAIN_VERT = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;
uniform float uTime, uBox, uSpeed, uLen;
uniform vec3 uCam, uWind;
varying float vFade;
varying float vEnd;
void main() {
  vec3 p = aSeed * uBox;
  float fall = uTime * uSpeed;
  p.y = mod(aSeed.y * uBox * 2.0 - fall, uBox * 2.0) - uBox * 0.5;
  p.xz += uWind.xz * (p.y / uSpeed);
  vec3 base = uCam + vec3(mod(p.x - uCam.x, uBox) - uBox * 0.5, p.y, mod(p.z - uCam.z, uBox) - uBox * 0.5);
  base.y += uCam.y;
  vec3 dir = normalize(vec3(uWind.x, -uSpeed, uWind.z));
  vec3 wp = base + dir * uLen * aEnd;
  vEnd = aEnd;
  float d = length(wp.xz - uCam.xz);
  vFade = smoothstep(uBox * 0.5, uBox * 0.2, d) * smoothstep(0.4, 1.5, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
varying float vEnd;
void main() {
  float a = vFade * uOpacity * (0.4 + 0.6 * vEnd);
  gl_FragColor = vec4(uColor * a, a);
}`;

const SNOW_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime, uBox, uSpeed, uSize;
uniform vec3 uCam, uWind;
varying float vFade;
void main() {
  vec3 p = aSeed * uBox;
  float t = uTime * uSpeed * (0.6 + aSeed.x * 0.8);
  p.y = mod(aSeed.y * uBox - t, uBox) - uBox * 0.4;
  p.x += sin(t * 0.7 + aSeed.z * 30.0) * 0.6 + uWind.x * t * 0.3;
  p.z += cos(t * 0.5 + aSeed.x * 25.0) * 0.6 + uWind.z * t * 0.3;
  vec3 wp = uCam + vec3(mod(p.x - uCam.x, uBox) - uBox * 0.5, p.y, mod(p.z - uCam.z, uBox) - uBox * 0.5);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float d = length(wp - uCam);
  vFade = smoothstep(uBox * 0.55, uBox * 0.25, d) * smoothstep(0.3, 1.2, d);
  gl_PointSize = uSize * (0.6 + aSeed.z * 0.8) / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = (1.0 - r) * vFade;
  gl_FragColor = vec4(uColor * a, a);
}`;

export class Weather {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments | null = null;
  private snow: THREE.Points | null = null;
  private time = 0;

  setRain(count: number, opacity = 0.35): void {
    if (this.rain) { this.group.remove(this.rain); this.rain.geometry.dispose(); this.rain = null; }
    if (count <= 0) return;
    const seed = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      seed.set(s, i * 6); seed.set(s, i * 6 + 3);
      end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uBox: { value: 24 }, uSpeed: { value: 16 }, uLen: { value: 0.55 }, uCam: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector3(1.5, 0, 0.6) }, uColor: { value: new THREE.Color(0.55, 0.62, 0.75) }, uOpacity: { value: opacity } },
    });
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  setSnow(count: number): void {
    if (this.snow) { this.group.remove(this.snow); this.snow.geometry.dispose(); this.snow = null; }
    if (count <= 0) return;
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    const m = new THREE.ShaderMaterial({
      vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uBox: { value: 26 }, uSpeed: { value: 1.2 }, uSize: { value: 60 }, uCam: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector3(1.2, 0, 0.3) }, uColor: { value: new THREE.Color(1.6, 1.7, 1.9) } },
    });
    this.snow = new THREE.Points(g, m);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
  }

  update(dt: number, cam: THREE.Camera, wind: THREE.Vector3): void {
    this.time += dt;
    for (const o of [this.rain, this.snow]) {
      if (!o) continue;
      const u = (o.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = this.time;
      u.uCam.value.copy(cam.position);
      u.uWind.value.copy(wind);
    }
  }
}
