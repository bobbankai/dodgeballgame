import * as THREE from 'three/webgpu';
import type { Physics } from '@/physics/physics';
import { G } from '@/physics/physics';

const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const dampAngle = (a: number, b: number, lambda: number, dt: number) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
};

export interface CinematicShot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  roll?: number;
}

export interface LockTarget {
  /** world position to frame (chest height) */
  focusPoint(out: THREE.Vector3): THREE.Vector3;
}

/**
 * Over-the-shoulder camera. Exploration: free orbit with damped follow. Lock-on: the camera swings behind the player so both the
 * player and the target stay in frame. Collision: a ray from the pivot to the desired position against static geometry shortens the arm
 * (smoothly in, quickly out) so it never clips walls. Shake is trauma-based. A cinematic shot overrides everything with a blend.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.22;
  distance = 4.1;
  shoulder = 0.85;
  height = 1.6;
  fov = 58;
  sensitivity = 1;
  lock: LockTarget | null = null;
  /** extra framing offset for bosses (m) */
  bossFraming = 0;

  private arm = 3.5;
  private pivot = new THREE.Vector3();
  private pivotInit = false;
  private trauma = 0;
  private shakeT = 0;
  private shot: CinematicShot | null = null;
  private shotBlend = 0;
  private fovCur = 58;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private rightV = new THREE.Vector3();
  private lookAtP = new THREE.Vector3();
  private posCur = new THREE.Vector3();
  private posInit = false;
  fovKick = 0;

  constructor(aspect: number, private physics: Physics | null = null) {
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.05, 400);
  }

  setPhysics(p: Physics): void {
    this.physics = p;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  cinematic(shot: CinematicShot | null, blendTime = 0): void {
    this.shot = shot;
    if (!shot) this.shotBlend = 0;
    if (shot && blendTime <= 0) this.shotBlend = 1;
  }

  get inCinematic(): boolean {
    return this.shot !== null;
  }

  /** Camera forward direction projected on the ground (for camera-relative movement). */
  groundForward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  groundRight(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  reset(yaw: number, feet: THREE.Vector3): void {
    this.yaw = yaw;
    this.pivot.copy(feet).y += this.height;
    this.pivotInit = true;
    this.posInit = false;
  }

  update(dt: number, feet: THREE.Vector3, playerYaw: number, look: { dx: number; dy: number }, opts: { sprinting?: boolean; locked?: boolean } = {}): void {
    const cam = this.camera;
    // --- orbit input
    if (!this.lock) {
      this.yaw -= look.dx * 0.0024 * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch + look.dy * 0.0021 * this.sensitivity, -0.55, 1.15);
    }

    // --- pivot: damped follow so footsteps and steps do not jitter the view
    const wantPivot = this.tmp.copy(feet).setY(feet.y + this.height);
    if (!this.pivotInit) { this.pivot.copy(wantPivot); this.pivotInit = true; }
    this.pivot.x = damp(this.pivot.x, wantPivot.x, 16, dt);
    this.pivot.z = damp(this.pivot.z, wantPivot.z, 16, dt);
    this.pivot.y = damp(this.pivot.y, wantPivot.y, 9, dt);

    let dist = this.distance + this.bossFraming;
    let pivot = this.tmp2.copy(this.pivot);
    // --- lock-on framing
    if (this.lock) {
      const tp = this.lock.focusPoint(new THREE.Vector3());
      const toT = new THREE.Vector3().subVectors(tp, this.pivot);
      const flat = Math.hypot(toT.x, toT.z);
      const wantYaw = Math.atan2(toT.x, toT.z);
      this.yaw = dampAngle(this.yaw, wantYaw, 5.5, dt);
      const wantPitch = THREE.MathUtils.clamp(0.2 + 0.05 * Math.max(0, 6 - flat) - toT.y * 0.04, 0.08, 0.5);
      this.pitch = damp(this.pitch, wantPitch, 4, dt);
      // pull the pivot toward the target so both stay framed; widen the arm for distant targets
      pivot.lerp(tp, 0.22);
      dist += THREE.MathUtils.clamp(flat * 0.16, 0, 1.6);
    }

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.fwd.set(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp);
    this.rightV.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const shoulder = this.lock ? this.shoulder * 0.75 : this.shoulder;
    const desired = new THREE.Vector3().copy(pivot).addScaledVector(this.fwd, -dist).addScaledVector(this.rightV, shoulder);

    // --- collision: ray from the pivot toward the desired position
    let arm = dist;
    if (this.physics) {
      const dir = new THREE.Vector3().subVectors(desired, pivot);
      const len = dir.length();
      dir.divideScalar(len);
      const hit = this.physics.raycast(pivot, dir, len + 0.35, G.STATIC | G.CAMERA_BLOCK);
      if (hit !== null) arm = Math.max(0.35, (hit - 0.3) * (dist / len));
    }
    this.arm = arm < this.arm ? damp(this.arm, arm, 30, dt) : damp(this.arm, arm, 4, dt);
    const finalPos = new THREE.Vector3().copy(pivot).addScaledVector(this.fwd, -this.arm).addScaledVector(this.rightV, shoulder * Math.min(1, this.arm / dist));

    if (!this.posInit) { this.posCur.copy(finalPos); this.posInit = true; }
    this.posCur.copy(finalPos);
    this.lookAtP.copy(pivot).addScaledVector(this.fwd, 6).addScaledVector(this.rightV, shoulder * 0.55);
    this.lookAtP.y = pivot.y + 0.1 - this.fwd.y * 0 ;

    // --- fov: wider while sprinting, with a kick on heavy impacts
    const targetFov = this.fov + (opts.sprinting ? 7 : 0) + this.fovKick;
    this.fovCur = damp(this.fovCur, targetFov, 7, dt);
    this.fovKick = damp(this.fovKick, 0, 9, dt);

    // --- cinematic override
    if (this.shot) {
      this.shotBlend = Math.min(1, this.shotBlend + dt * 2.2);
      const k = this.shotBlend * this.shotBlend * (3 - 2 * this.shotBlend);
      this.posCur.lerp(this.shot.position, k);
      this.lookAtP.lerp(this.shot.target, k);
      this.fovCur = THREE.MathUtils.lerp(this.fovCur, this.shot.fov, k);
    }

    cam.position.copy(this.posCur);
    cam.lookAt(this.lookAtP);

    // --- shake (trauma^2, small, decays quickly)
    if (this.trauma > 0.001) {
      this.shakeT += dt * 38;
      const a = this.trauma * this.trauma * 0.07;
      cam.rotation.z += Math.sin(this.shakeT * 1.3) * a * 0.6;
      cam.position.x += Math.sin(this.shakeT * 2.1 + 1.0) * a;
      cam.position.y += Math.sin(this.shakeT * 1.7 + 2.0) * a;
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
    }
    if (Math.abs(cam.fov - this.fovCur) > 0.01) {
      cam.fov = this.fovCur;
      cam.updateProjectionMatrix();
    }
    void playerYaw;
  }
}
