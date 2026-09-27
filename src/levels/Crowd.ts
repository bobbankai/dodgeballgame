import * as THREE from 'three';
import { ARM_PIVOT, SPECTATOR_VARIANTS, spectatorGeometry } from './Spectator';

/**
 * Instanced spectators animated entirely on the GPU: idle sway, clapping and
 * arm-raising cheers driven by a global "hype" uniform that reacts to big plays.
 */
export class Crowd {
  /** stand sections (one instanced draw each) so stands behind the camera are frustum-culled */
  readonly mesh = new THREE.Group();
  readonly uniforms = {
    uTime: { value: 0 },
    uHype: { value: 0 },
    uWave: { value: 0 },
  };
  private hype = 0;
  private hypeTarget = 0;
  private burst = 0;

  constructor(seats: { pos: THREE.Vector3; yaw: number }[], palette: number[], skin: number[] = [0xf1c9a5, 0xd9a47c, 0xb07a52, 0x7a4e32, 0x4f3322], standing = false, ghost = false) {
    const count = seats.length;
    // sculpted spectators in a few looks (short hair, long hair, team cap)
    const variants = Array.from({ length: SPECTATOR_VARIANTS }, (_, v) => spectatorGeometry(standing, v));
    const seatVariant = seats.map(() => Math.floor(Math.random() * SPECTATOR_VARIANTS));
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
    const perInstance = { aPhase: [aPhase, 1], aSkin: [aSkin, 3], aExcite: [aExcite, 1] } as const;

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
attribute float aAO;
attribute float aPhase;
attribute vec3 aSkin;
attribute float aExcite;
uniform float uTime;
uniform float uHype;
uniform float uWave;
varying vec3 vSkinC;
varying vec3 vAltC;
flat varying float vPartC;
varying float vAO;
varying vec3 vLocal;
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// arms (sleeves + hands) swing about the shoulder: idle, clapping, cheering
float crowdArmAngle(out float side) {
  bool left = (aPart > 1.5 && aPart < 2.5) || (aPart > 6.5 && aPart < 7.5);
  bool right = (aPart > 2.5 && aPart < 3.5) || (aPart > 7.5 && aPart < 8.5);
  side = left ? 1.0 : -1.0;
  if (!left && !right) return 0.0;
  float h = clamp(uHype * aExcite, 0.0, 1.0);
  float t = uTime + aPhase;
  float idle = 0.06 + 0.04 * sin(t * 1.3);
  float cheer = h * (2.4 + 0.35 * sin(t * (7.0 + aExcite * 4.0)));
  float clap = (1.0 - h) * smoothstep(0.1, 0.5, uHype) * 0.5 * (0.5 + 0.5 * sin(t * 12.0));
  return (idle + cheer + clap) * side;
}`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
{
  float sideN;
  float angN = crowdArmAngle(sideN);
  if (angN != 0.0) objectNormal.xy = rot2(angN) * objectNormal.xy;
}`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vSkinC = aSkin;
vPartC = aPart;
vAO = aAO;
vLocal = position;
{
  // per-spectator trousers / hair / shoes from a hash of the phase
  float r1 = fract(aPhase * 0.6180339 + 0.13);
  float r2 = fract(aPhase * 0.4142135 + 0.71);
  vec3 pants = r1 < 0.35 ? vec3(0.05, 0.08, 0.16) : r1 < 0.6 ? vec3(0.025, 0.025, 0.03) : r1 < 0.8 ? vec3(0.2, 0.16, 0.1) : vec3(0.09, 0.095, 0.1);
  vec3 hair = r2 < 0.3 ? vec3(0.02, 0.013, 0.01) : r2 < 0.55 ? vec3(0.06, 0.03, 0.017) : r2 < 0.75 ? vec3(0.14, 0.07, 0.03) : r2 < 0.9 ? vec3(0.42, 0.26, 0.1) : vec3(0.18, 0.18, 0.2);
  vec3 shoes = r2 < 0.5 ? vec3(0.8, 0.8, 0.78) : vec3(0.03, 0.03, 0.035);
  vAltC = aPart > 4.5 && aPart < 5.5 ? hair : aPart > 8.5 ? shoes : pants;
}
float h = clamp(uHype * aExcite, 0.0, 1.0);
float t = uTime + aPhase;
{
  float side;
  float ang = crowdArmAngle(side);
  if (ang != 0.0) {
    vec2 pivot = vec2(${ARM_PIVOT.x.toFixed(3)} * side, ${ARM_PIVOT.y.toFixed(3)});
    transformed.xy = rot2(ang) * (transformed.xy - pivot) + pivot;
  }
}
float bounce = abs(sin(t * (5.0 + aExcite * 3.0))) * 0.07 * h + sin(t * 0.8) * 0.01;
float wave = smoothstep(0.0, 1.0, 1.0 - abs(fract((instanceMatrix[3].x * 0.08) - uWave) - 0.5) * 6.0) * step(0.001, uWave);
transformed.y += bounce + wave * 0.35;
transformed.xz = rot2(sin(t * 0.37) * 0.12 * (1.0 - h)) * transformed.xz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSkinC;\nvarying vec3 vAltC;\nflat varying float vPartC;\nvarying float vAO;\nvarying vec3 vLocal;')
        .replace(
          '#include <color_fragment>',
          ghost
            ? '#include <color_fragment>'
            : `#include <color_fragment>
{
  float p = vPartC;
  if ((p > 0.5 && p < 1.5) || (p > 6.5 && p < 8.5)) {
    diffuseColor.rgb = vSkinC;
    // a simple painted face: eyes and brows
    if (p < 1.5 && vLocal.z > 0.06 && vLocal.y > 0.66) {
      float ax = abs(vLocal.x);
      float eye = 1.0 - smoothstep(0.0075, 0.0105, length(vec2(ax - 0.032, (vLocal.y - 0.702) * 0.8)));
      float by = vLocal.y - 0.727 + (ax - 0.032) * 0.18;
      float brow = (1.0 - smoothstep(0.0028, 0.0048, abs(by))) * (1.0 - smoothstep(0.014, 0.02, abs(ax - 0.034)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.02, 0.02), max(eye, brow * 0.85));
    }
  }
  else if ((p > 3.5 && p < 5.5) || p > 8.5) diffuseColor.rgb = vAltC;
  else if (p > 5.5 && p < 6.5) diffuseColor.rgb *= 0.8;
  diffuseColor.rgb *= mix(1.0, vAO, 0.85);
}`,
        );
    };
    mat.customProgramCacheKey = () => (ghost ? 'crowd-ghost-v3' : 'crowd-v3');

    // cluster seats into angular sectors around the arena centre
    const SECTORS = 8;
    const sectors: number[][] = Array.from({ length: SECTORS }, () => []);
    seats.forEach((seat, i) => {
      const a = Math.atan2(seat.pos.z, seat.pos.x) + Math.PI;
      sectors[Math.min(SECTORS - 1, Math.floor((a / (Math.PI * 2)) * SECTORS))].push(i);
    });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    // one instanced draw per (sector, look)
    const groups: number[][] = [];
    for (const sec of sectors) for (let v = 0; v < SPECTATOR_VARIANTS; v++) groups.push(sec.filter((si) => seatVariant[si] === v));
    for (let gi = 0; gi < groups.length; gi++) {
      const idx = groups[gi];
      if (!idx.length) continue;
      const base = variants[gi % SPECTATOR_VARIANTS];
      // shares the sculpted vertex data; per-instance attributes follow this group's order
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'aPart', 'aAO']) g.setAttribute(name, base.getAttribute(name));
      g.setIndex(base.getIndex());
      for (const [name, [src, size]] of Object.entries(perInstance)) {
        const arr = new Float32Array(idx.length * size);
        idx.forEach((si, k) => arr.set(src.subarray(si * size, (si + 1) * size), k * size));
        g.setAttribute(name, new THREE.InstancedBufferAttribute(arr, size));
      }
      const inst = new THREE.InstancedMesh(g, mat, idx.length);
      idx.forEach((si, k) => {
        const seat = seats[si];
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seat.yaw + (Math.random() - 0.5) * 0.3);
        const sc = 0.92 + Math.random() * 0.16;
        s.set(sc, sc, sc);
        m.compose(seat.pos, q, s);
        inst.setMatrixAt(k, m);
        c.setHex(palette[Math.floor(Math.random() * palette.length)]);
        c.offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.12);
        inst.setColorAt(k, c);
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.castShadow = false;
      inst.receiveShadow = true;
      // bounds padded for the cheering animation (arms up, bounce, stadium wave)
      inst.computeBoundingSphere();
      if (inst.boundingSphere) inst.boundingSphere.radius += 1.2;
      inst.frustumCulled = true;
      this.mesh.add(inst);
    }
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
