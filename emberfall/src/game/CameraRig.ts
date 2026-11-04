// Third-person camera: orbit around the player with a shoulder offset, spring-damped follow, lock-on
// framing (keeps player and target in view, swings behind the player), collision pull-in, trauma
// based shake (Perlin-ish, decays), FOV punch on heavy hits / sprint, and scripted cinematic shots.
import * as THREE from 'three';
import type { World } from './World';

function damp(a: number, b: number, k: number, dt: number): number { return b + (a - b) * Math.exp(-k * dt); }
function dampAngle(a: number, b: number, k: number, dt: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-k * dt));
}

export interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov?: number;
  /** blend time into this shot */
  blend?: number;
  dof?: number;
  focus?: number;
}

export class CameraRig {
  yaw = 0;
  pitch = 0.18;
  distance = 3.6;
  baseDistance = 3.6;
  shoulder = 0.42;
  height = 1.55;
  fovBase = 52;
  fovKick = 0;
  private trauma = 0;
  private shakeT = 0;
  readonly target = new THREE.Vector3(); // smoothed focus (player chest)
  lockTarget: THREE.Vector3 | null = null;
  private curDist = 3.6;
  shot: Shot | null = null;
  private shotBlend = 1;
  private shotFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 52 };
  private lastPos = new THREE.Vector3();
  private lastLook = new THREE.Vector3();
  private initialized = false;
  sensitivity = 1;
  /** gentle auto-recentre behind the player when moving and not looking around */
  autoCenter = true;
  private idleLook = 0;

  constructor(private cam: THREE.PerspectiveCamera, private world: World) {}

  addTrauma(k: number): void { this.trauma = Math.min(1, this.trauma + k); }
  punch(fov: number): void { this.fovKick = Math.max(this.fovKick, fov); }

  setShot(s: Shot | null): void {
    this.shotFrom.pos.copy(this.cam.position);
    this.shotFrom.look.copy(this.lastLook);
    this.shotFrom.fov = this.cam.fov;
    this.shot = s;
    this.shotBlend = s && (s.blend ?? 0) > 0 ? 0 : 1;
  }

  snapBehind(playerYaw: number): void {
    this.yaw = playerYaw + Math.PI;
    this.initialized = false;
  }

  update(dt: number, player: THREE.Vector3, playerYaw: number, look: THREE.Vector2, moving: boolean): void {
    const cam = this.cam;
    // input
    if (!this.shot) {
      if (Math.abs(look.x) + Math.abs(look.y) > 1e-5) this.idleLook = 0;
      else this.idleLook += dt;
      this.yaw -= look.x * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch + look.y * this.sensitivity, -0.55, 0.95);
    }
    const focus = new THREE.Vector3(player.x, player.y + this.height, player.z);
    if (!this.initialized) { this.target.copy(focus); this.curDist = this.distance; }
    this.target.x = damp(this.target.x, focus.x, 14, dt);
    this.target.z = damp(this.target.z, focus.z, 14, dt);
    this.target.y = damp(this.target.y, focus.y, 8, dt);

    if (this.lockTarget) {
      // yaw so the camera sits behind the player, looking at the midpoint
      const to = this.lockTarget.clone().sub(player);
      const want = Math.atan2(-to.x, -to.z);
      this.yaw = dampAngle(this.yaw, want, 6, dt);
      const flat = Math.hypot(to.x, to.z);
      const wantPitch = THREE.MathUtils.clamp(0.22 - (this.lockTarget.y - player.y - 1.2) / Math.max(flat, 2) * 0.6, -0.1, 0.6);
      this.pitch = damp(this.pitch, wantPitch, 4, dt);
    } else if (this.autoCenter && moving && this.idleLook > 1.2) {
      this.yaw = dampAngle(this.yaw, playerYaw + Math.PI, 0.8, dt);
    }

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = this.target.clone().addScaledVector(right, this.shoulder);
    // collision: pull in when something is between the pivot and the camera
    const want = this.distance;
    const hit = this.world.raycast(pivot, back, want + 0.3) - 0.3;
    const d = Math.max(0.6, Math.min(want, hit));
    this.curDist = d < this.curDist ? d : damp(this.curDist, d, 3, dt);
    const pos = pivot.clone().addScaledVector(back, this.curDist);
    let lookAt = pivot.clone().addScaledVector(back, -3);
    if (this.lockTarget) {
      const mid = this.lockTarget.clone().add(this.target).multiplyScalar(0.5);
      mid.y = THREE.MathUtils.lerp(this.target.y, this.lockTarget.y + 0.6, 0.35);
      lookAt = lookAt.lerp(mid, 0.55);
    }
    let fov = this.fovBase + this.fovKick;
    this.fovKick = damp(this.fovKick, 0, 5, dt);

    if (this.shot) {
      this.shotBlend = Math.min(1, this.shotBlend + dt / Math.max(0.001, this.shot.blend ?? 0.001));
      const k = this.shotBlend * this.shotBlend * (3 - 2 * this.shotBlend);
      pos.copy(this.shotFrom.pos).lerp(this.shot.pos, k);
      lookAt.copy(this.shotFrom.look).lerp(this.shot.look, k);
      fov = THREE.MathUtils.lerp(this.shotFrom.fov, this.shot.fov ?? this.fovBase, k);
    }
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeT += dt * 30;
    const s = this.trauma * this.trauma;
    const n = (o: number) => Math.sin(this.shakeT * 1.1 + o) * 0.6 + Math.sin(this.shakeT * 2.3 + o * 2.1) * 0.4;
    pos.x += n(1) * s * 0.12;
    pos.y += n(7) * s * 0.09;
    lookAt.x += n(3) * s * 0.06;
    lookAt.y += n(5) * s * 0.06;
    cam.position.copy(pos);
    cam.lookAt(lookAt);
    cam.rotateZ(n(11) * s * 0.03);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.lastPos.copy(pos);
    this.lastLook.copy(lookAt);
    this.initialized = true;
  }

  /** world-space move direction from stick input relative to the camera */
  moveDir(input: THREE.Vector2, out = new THREE.Vector3()): THREE.Vector3 {
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return out.set(0, 0, 0).addScaledVector(f, input.y).addScaledVector(r, input.x);
  }
}
