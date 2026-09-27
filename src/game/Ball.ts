import * as THREE from 'three';
import { REFLECT_LAYER } from '../rendering/FloorReflection';
import { TUNING } from '../config/tuning';
import { ballTextures, blobTexture } from '../rendering/Textures';
import type { Athlete } from './Athlete';
import type { ThrowInfo } from './types';

const shellVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vP = position;
  gl_Position = projectionMatrix * mv;
}`;

const shellFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
  float flick = 0.75 + 0.25 * sin(uTime * 40.0 + vP.y * 60.0 + vP.x * 40.0);
  float band = 0.5 + 0.5 * sin(vP.y * 90.0 - uTime * 25.0);
  float a = (f * 1.4 + 0.12 + band * 0.12 * uIntensity) * uIntensity * flick;
  gl_FragColor = vec4(uColor * (1.5 + uIntensity * 2.5), a);
}`;

let sharedGeo: THREE.SphereGeometry | null = null;
const _dv = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** squash spring: ~0.2 s period, lightly damped so it jiggles once */
const SQ_W = 30;
const SQ_Z = 0.32;
let shellGeo: THREE.SphereGeometry | null = null;

export type BallState = 'loose' | 'held' | 'thrown';

export class Ball {
  private static nextId = 1;
  readonly id = Ball.nextId++;
  readonly group = new THREE.Group();
  /** squash / stretch frame (the spinning core and the energy shell live inside it) */
  private readonly deform = new THREE.Object3D();
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly shell: THREE.Mesh;
  readonly shellMat: THREE.ShaderMaterial;
  readonly shadow: THREE.Mesh;
  readonly radius = TUNING.ball.radius;

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  prev = new THREE.Vector3();
  angVel = new THREE.Vector3();
  quat = new THREE.Quaternion();

  state: BallState = 'loose';
  live = false;
  holder: Athlete | null = null;
  thrower: Athlete | null = null;
  info: ThrowInfo | null = null;
  grounded = true;
  /** Visual energy 0..1 (charge glow / power shots). */
  energy = 0;
  energyTarget = 0;
  energyColor = new THREE.Color(1, 0.55, 0.2);
  /** Phantom throws hide the real ball briefly. */
  hiddenTimer = 0;
  noPickupTimer = 0;
  /** Athletes already processed for this throw (avoid double hits). */
  ignore = new Set<Athlete>();
  /** Id of the trail currently attached (managed by VFX). */
  trail: number | null = null;
  airTime = 0;
  /** Last team that touched it (for possession stats). */
  lastTeam: 0 | 1 | -1 = -1;
  /** Decoy balls are visual only. */
  decoy = false;
  // squash-and-stretch state
  private sq = 0;
  private sqV = 0;
  private readonly sqN = new THREE.Vector3(0, 1, 0);
  private readonly lastVel = new THREE.Vector3();
  private lastState: BallState = 'loose';

  constructor() {
    const tex = ballTextures();
    sharedGeo ??= new THREE.SphereGeometry(this.radius, 32, 20);
    shellGeo ??= new THREE.SphereGeometry(this.radius * 1.32, 24, 16);
    this.material = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.52,
      metalness: 0,
      emissive: new THREE.Color(0, 0, 0),
    });
    this.mesh = new THREE.Mesh(sharedGeo, this.material);
    this.mesh.castShadow = true;
    this.group.add(this.deform);
    this.deform.add(this.mesh);

    this.shellMat = new THREE.ShaderMaterial({
      vertexShader: shellVert,
      fragmentShader: shellFrag,
      uniforms: { uColor: { value: new THREE.Color(1, 0.5, 0.2) }, uIntensity: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shell = new THREE.Mesh(shellGeo, this.shellMat);
    this.mesh.layers.enable(REFLECT_LAYER);
    this.shell.layers.enable(REFLECT_LAYER);
    this.shell.visible = false;
    this.deform.add(this.shell);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.5, color: 0x000000 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
    scene.add(this.shadow);
  }

  /** Remove from the scene and free per-ball GPU resources (geometry of the core/shell is shared). */
  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.shadow);
    this.material.dispose();
    this.shellMat.dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }

  get speed() {
    return this.vel.length();
  }

  setLoose() {
    this.state = 'loose';
    this.live = false;
    this.holder = null;
    this.info = null;
    this.ignore.clear();
    this.energyTarget = 0;
  }

  syncVisual(dt: number, t: number) {
    // integrate visual spin
    const w = this.angVel.length();
    if (w > 1e-4 && this.state !== 'held') {
      const q = new THREE.Quaternion().setFromAxisAngle(this.angVel.clone().divideScalar(w), w * dt);
      this.quat.premultiply(q);
    }
    this.group.position.copy(this.pos);
    this.updateDeform(dt);
    this.energy += (this.energyTarget - this.energy) * (1 - Math.exp(-10 * dt));
    const e = this.energy;
    this.shell.visible = e > 0.02;
    this.shellMat.uniforms.uIntensity.value = e;
    this.shellMat.uniforms.uTime.value = t;
    (this.shellMat.uniforms.uColor.value as THREE.Color).copy(this.energyColor);
    this.shell.scale.setScalar(1 + e * 0.25 + Math.sin(t * 30) * 0.03 * e);
    this.material.emissive.copy(this.energyColor).multiplyScalar(e * 0.9);
    this.group.visible = this.hiddenTimer <= 0;

    // contact shadow
    const h = Math.max(0, this.pos.y - this.radius);
    const s = 0.34 + h * 0.08;
    this.shadow.position.set(this.pos.x, 0.012, this.pos.z);
    this.shadow.scale.setScalar(s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = this.group.visible ? Math.max(0.08, 0.55 - h * 0.09) : 0;
  }

  /**
   * Squash on every sudden change of velocity (bounces, hits, catches, the release) along
   * the direction of the change, and stretch along the flight path at speed.
   */
  private updateDeform(dt: number) {
    const jump = _dv.subVectors(this.vel, this.lastVel).length();
    if (jump > 2.5 && dt > 0) {
      // the release reads as a push, not a splat
      const amt = Math.min(0.3, jump / 65) * (this.lastState === 'held' ? 0.5 : 1);
      if (amt > Math.abs(this.sq) * 0.6) {
        this.sqN.copy(_dv).divideScalar(jump);
        this.sqV = amt * SQ_W * 1.35;
      }
    }
    this.lastVel.copy(this.vel);
    this.lastState = this.state;
    if (dt > 0) {
      const h = Math.min(dt, 1 / 30);
      this.sqV += (-SQ_W * SQ_W * this.sq - 2 * SQ_Z * SQ_W * this.sqV) * h;
      this.sq += this.sqV * h;
    }
    const speed = this.state === 'thrown' ? this.vel.length() : 0;
    const st = Math.min(0.13, Math.max(0, (speed - 12) / 90));
    let along = 1, perp = 1;
    if (Math.abs(this.sq) > st * 0.5) {
      _axis.copy(this.sqN);
      const s = THREE.MathUtils.clamp(this.sq, -0.25, 0.3);
      along = 1 - s;
      perp = 1 + s * 0.5;
    } else if (st > 0.001) {
      _axis.copy(this.vel).divideScalar(speed);
      along = 1 + st;
      perp = 1 / Math.sqrt(along);
    }
    if (along === 1) {
      this.deform.quaternion.identity();
      this.deform.scale.setScalar(1);
      this.mesh.quaternion.copy(this.quat);
      return;
    }
    _q.setFromUnitVectors(UP, _axis);
    this.deform.quaternion.copy(_q);
    this.deform.scale.set(perp, along, perp);
    // keep the spin in world space inside the rotated deform frame
    this.mesh.quaternion.copy(_qi.copy(_q).invert().multiply(this.quat));
  }
}
