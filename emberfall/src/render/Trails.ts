// Sword trails: a ribbon between the blade base and tip, sampled every frame, smoothed with
// Catmull-Rom so fast swings draw clean arcs, aged out over ~0.12 s. Additive HDR (feeds bloom).
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aAge;
attribute float aSide;
varying float vAge;
varying float vSide;
void main() {
  vAge = aAge;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uIntensity;
uniform float uTime;
varying float vAge;
varying float vSide;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float a = 1.0 - vAge;
  // brightest along the tip edge, streaky fade toward the base
  float tipK = smoothstep(0.0, 1.0, vSide);
  float streak = 0.75 + 0.25 * sin(vAge * 40.0 + vSide * 7.0 + uTime * 30.0);
  vec3 col = mix(uEdge, uCore, pow(tipK, 3.0) * a);
  float alpha = a * a * (0.25 + 0.75 * tipK) * streak;
  gl_FragColor = vec4(col * alpha * uIntensity, alpha);
}`;

interface Sample { base: THREE.Vector3; tip: THREE.Vector3; t: number }

export class SwordTrail {
  readonly mesh: THREE.Mesh;
  private samples: Sample[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private age: Float32Array;
  private side: Float32Array;
  private maxSeg = 64;
  life = 0.14;
  active = false;
  private time = 0;
  readonly mat: THREE.ShaderMaterial;

  constructor(core = new THREE.Color(6, 4.2, 2.4), edge = new THREE.Color(2.2, 0.55, 0.12)) {
    this.geo = new THREE.BufferGeometry();
    const n = (this.maxSeg + 1) * 2;
    this.pos = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.side = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < this.maxSeg; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uCore: { value: core }, uEdge: { value: edge }, uIntensity: { value: 1 }, uTime: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
  }

  setColors(core: THREE.Color, edge: THREE.Color, intensity = 1): void {
    this.mat.uniforms.uCore.value.copy(core);
    this.mat.uniforms.uEdge.value.copy(edge);
    this.mat.uniforms.uIntensity.value = intensity;
  }

  push(base: THREE.Vector3, tip: THREE.Vector3): void {
    this.samples.push({ base: base.clone(), tip: tip.clone(), t: this.time });
    if (this.samples.length > 24) this.samples.shift();
  }

  update(dt: number, base: THREE.Vector3 | null, tip: THREE.Vector3 | null): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.active && base && tip) this.push(base, tip);
    while (this.samples.length && this.time - this.samples[0].t > this.life) this.samples.shift();
    const S = this.samples;
    if (S.length < 2) { this.geo.setDrawRange(0, 0); return; }
    // Catmull-Rom subdivision between samples
    const seg = Math.min(this.maxSeg, (S.length - 1) * 4);
    const cr = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, u: number, out: THREE.Vector3) => {
      const u2 = u * u, u3 = u2 * u;
      out.set(0, 0, 0)
        .addScaledVector(p0, -0.5 * u3 + u2 - 0.5 * u)
        .addScaledVector(p1, 1.5 * u3 - 2.5 * u2 + 1)
        .addScaledVector(p2, -1.5 * u3 + 2 * u2 + 0.5 * u)
        .addScaledVector(p3, 0.5 * u3 - 0.5 * u2);
      return out;
    };
    const vb = new THREE.Vector3(), vt = new THREE.Vector3();
    for (let i = 0; i <= seg; i++) {
      const f = (i / seg) * (S.length - 1);
      const k = Math.min(S.length - 2, Math.floor(f));
      const u = f - k;
      const a = S[Math.max(0, k - 1)], b = S[k], c = S[k + 1], d = S[Math.min(S.length - 1, k + 2)];
      cr(a.base, b.base, c.base, d.base, u, vb);
      cr(a.tip, b.tip, c.tip, d.tip, u, vt);
      const t = b.t + (c.t - b.t) * u;
      const ag = Math.min(1, (this.time - t) / this.life);
      this.pos.set([vb.x, vb.y, vb.z], i * 6);
      this.pos.set([vt.x, vt.y, vt.z], i * 6 + 3);
      this.age[i * 2] = ag; this.age[i * 2 + 1] = ag;
      this.side[i * 2] = 0; this.side[i * 2 + 1] = 1;
    }
    this.geo.attributes.position.needsUpdate = true;
    (this.geo.attributes.aAge as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSide as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, seg * 6);
  }

  clear(): void { this.samples.length = 0; }
}
