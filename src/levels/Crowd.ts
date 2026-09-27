import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Instanced spectators animated entirely on the GPU: idle sway, clapping and
 * arm-raising cheers driven by a global "hype" uniform that reacts to big plays.
 */
export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  readonly uniforms = {
    uTime: { value: 0 },
    uHype: { value: 0 },
    uWave: { value: 0 },
  };
  private hype = 0;
  private hypeTarget = 0;
  private burst = 0;

  constructor(seats: { pos: THREE.Vector3; yaw: number }[], palette: number[], skin: number[] = [0xf1c9a5, 0xd9a47c, 0xb07a52, 0x7a4e32, 0x4f3322], standing = false, ghost = false) {
    const parts: THREE.BufferGeometry[] = [];
    const tag = (g: THREE.BufferGeometry, part: number) => {
      const n = g.attributes.position.count;
      g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
      return g;
    };
    const torso = new THREE.CylinderGeometry(0.17, 0.2, 0.55, 8, 1);
    torso.translate(0, 0.27, 0);
    const head = new THREE.SphereGeometry(0.11, 10, 8);
    head.translate(0, 0.67, 0);
    const armL = new THREE.CylinderGeometry(0.045, 0.04, 0.46, 6, 1);
    armL.translate(0.23, 0.26, 0);
    const armR = armL.clone();
    armR.translate(-0.46, 0, 0);
    const legs = standing ? new THREE.BoxGeometry(0.3, 0.8, 0.2) : new THREE.BoxGeometry(0.34, 0.14, 0.36);
    if (standing) {
      legs.translate(0, -0.4, 0);
      for (const g of [torso, head, armL, armR]) g.translate(0, 0.0, 0);
    } else legs.translate(0, 0.02, 0.14);
    parts.push(tag(torso, 0), tag(head, 1), tag(armL, 2), tag(armR, 3), tag(legs, 4));
    const geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;

    const count = seats.length;
    const aPhase = new Float32Array(count);
    const aSkin = new Float32Array(count * 3);
    const aExcite = new Float32Array(count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      aPhase[i] = Math.random() * 100;
      aExcite[i] = 0.4 + Math.random() * 0.6;
      c.setHex(skin[Math.floor(Math.random() * skin.length)]);
      aSkin.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(aSkin, 3));
    geo.setAttribute('aExcite', new THREE.InstancedBufferAttribute(aExcite, 1));

    const mat = ghost
      ? new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2, color: 0x000000, emissive: 0x6d4bd8, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 })
      : new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aPart;
attribute float aPhase;
attribute vec3 aSkin;
attribute float aExcite;
uniform float uTime;
uniform float uHype;
uniform float uWave;
varying vec3 vSkinC;
varying float vPartC;
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vSkinC = aSkin;
vPartC = aPart;
float h = clamp(uHype * aExcite, 0.0, 1.0);
float t = uTime + aPhase;
// arms: raise and wave around the shoulder pivot
if (aPart > 1.5 && aPart < 3.5) {
  float side = aPart < 2.5 ? 1.0 : -1.0;
  vec2 pivot = vec2(0.23 * side, 0.48);
  float idle = 0.1 + 0.05 * sin(t * 1.3);
  float cheer = h * (2.4 + 0.35 * sin(t * (7.0 + aExcite * 4.0)));
  float clap = (1.0 - h) * smoothstep(0.1, 0.5, uHype) * 0.6 * (0.5 + 0.5 * sin(t * 12.0));
  float ang = (idle + cheer) * side + clap * side;
  vec2 p = transformed.xy - pivot;
  p = rot2(ang) * p;
  transformed.xy = p + pivot;
}
float bounce = abs(sin(t * (5.0 + aExcite * 3.0))) * 0.07 * h + sin(t * 0.8) * 0.01;
float wave = smoothstep(0.0, 1.0, 1.0 - abs(fract((instanceMatrix[3].x * 0.08) - uWave) - 0.5) * 6.0) * step(0.001, uWave);
transformed.y += bounce + wave * 0.35;
transformed.xz = rot2(sin(t * 0.37) * 0.12 * (1.0 - h)) * transformed.xz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSkinC;\nvarying float vPartC;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if (vPartC > 0.5 && vPartC < 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, vSkinC, step(0.01, dot(diffuseColor.rgb, vec3(1.0))));
if (vPartC > 3.5) diffuseColor.rgb *= 0.35;`,
        );
    };
    mat.customProgramCacheKey = () => (ghost ? 'crowd-ghost-v1' : 'crowd-v1');

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    seats.forEach((seat, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seat.yaw + (Math.random() - 0.5) * 0.3);
      const sc = 0.92 + Math.random() * 0.16;
      s.set(sc, sc, sc);
      m.compose(seat.pos, q, s);
      this.mesh.setMatrixAt(i, m);
      c.setHex(palette[Math.floor(Math.random() * palette.length)]);
      c.offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.12);
      this.mesh.setColorAt(i, c);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** Short hype spike (hits, KOs); base hype rises with match tension. */
  cheer(amount: number) {
    this.burst = Math.min(1.4, this.burst + amount);
  }
  setBase(v: number) {
    this.hypeTarget = v;
  }
  wave(on: boolean) {
    this.uniforms.uWave.value = on ? 0.001 : 0;
  }

  update(dt: number, t: number) {
    this.burst *= Math.exp(-dt * 0.9);
    this.hype += (this.hypeTarget + this.burst - this.hype) * (1 - Math.exp(-dt * 4));
    this.uniforms.uTime.value = t;
    this.uniforms.uHype.value = Math.min(1, this.hype);
    if (this.uniforms.uWave.value > 0) this.uniforms.uWave.value = ((t * 0.25) % 1) + 0.001;
  }
}

/** Generates seat positions on stepped stands. */
export function standSeats(opts: {
  origin: THREE.Vector3;
  /** direction along the row (unit) */
  along: THREE.Vector3;
  /** direction up the stand (away from court, unit, horizontal) */
  back: THREE.Vector3;
  rows: number;
  length: number;
  rowDepth: number;
  rowRise: number;
  spacing: number;
  density: number;
  facingYaw: number;
  gaps?: number[];
}): { pos: THREE.Vector3; yaw: number }[] {
  const seats: { pos: THREE.Vector3; yaw: number }[] = [];
  const perRow = Math.floor(opts.length / opts.spacing);
  for (let r = 0; r < opts.rows; r++) {
    for (let i = 0; i < perRow; i++) {
      if (Math.random() > opts.density) continue;
      const u = (i + 0.5) * opts.spacing - opts.length / 2;
      if (opts.gaps?.some((g) => Math.abs(u - g) < 0.9)) continue;
      const p = opts.origin
        .clone()
        .addScaledVector(opts.along, u + (Math.random() - 0.5) * 0.12)
        .addScaledVector(opts.back, r * opts.rowDepth + 0.1);
      p.y += r * opts.rowRise;
      seats.push({ pos: p, yaw: opts.facingYaw });
    }
  }
  return seats;
}
