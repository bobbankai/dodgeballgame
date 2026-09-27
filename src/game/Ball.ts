import * as THREE from 'three';
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
let shellGeo: THREE.SphereGeometry | null = null;

export type BallState = 'loose' | 'held' | 'thrown';

export class Ball {
  private static nextId = 1;
  readonly id = Ball.nextId++;
  readonly group = new THREE.Group();
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
    this.group.add(this.mesh);

    this.shellMat = new THREE.ShaderMaterial({
      vertexShader: shellVert,
      fragmentShader: shellFrag,
      uniforms: { uColor: { value: new THREE.Color(1, 0.5, 0.2) }, uIntensity: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shell = new THREE.Mesh(shellGeo, this.shellMat);
    this.shell.visible = false;
    this.group.add(this.shell);

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

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.shadow);
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
    this.mesh.quaternion.copy(this.quat);
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
}
