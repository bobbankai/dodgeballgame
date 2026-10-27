import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Collision } from './Collision';

const _off = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _d = new THREE.Vector2();

function angleTo(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface Shot {
  position: THREE.Vector3;
  look: THREE.Vector3;
  fov?: number;
}

/**
 * Third-person orbit camera: mouse / right stick orbit, drifts back behind Ada while she runs,
 * pulls in when scenery gets between them. Cutscenes hand it fixed shots to ease towards.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.32;
  distance = 4.3;
  private zoomTarget = 4.3;
  private actual = 4.3;
  private target = new THREE.Vector3();
  private idleLook = 0;
  private shot: Shot | null = null;
  private lastShot: Shot | null = null;
  private blend = 0;
  private shake = 0;
  baseFov = 50;
  /** Extra height above Ada's feet that the camera looks at. */
  height = 1.15;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  snap(focus: THREE.Vector3, yaw = this.yaw) {
    this.target.copy(focus);
    this.yaw = yaw;
    this.actual = this.distance;
  }

  setShot(shot: Shot | null) {
    this.shot = shot;
    if (shot) this.lastShot = shot;
  }

  get inShot() {
    return this.shot !== null;
  }

  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(dt: number, input: Input | null, focus: THREE.Vector3, vel: THREE.Vector3, col: Collision, time: number) {
    // orbit input
    if (input && !this.shot) {
      input.lookDelta(dt, _d);
      if (_d.lengthSq() > 0) this.idleLook = 0;
      else this.idleLook += dt;
      this.yaw -= _d.x;
      this.pitch = THREE.MathUtils.clamp(this.pitch + _d.y, -0.3, 1.15);
      this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget + input.zoom() * 0.45, 2.4, 7);
    }
    this.distance += (this.zoomTarget - this.distance) * (1 - Math.exp(-dt * 6));

    // drift behind her when she has been running a while without the player steering the camera
    const hs = Math.hypot(vel.x, vel.z);
    if (hs > 0.5 && this.idleLook > 0.9 && !this.shot) {
      const behind = Math.atan2(-vel.x, -vel.z);
      const d = angleTo(this.yaw, behind);
      if (Math.abs(d) < 2.3) this.yaw += d * (1 - Math.exp(-dt * 0.9 * Math.min(1, hs / 3.4)));
    }

    // follow: quick vertically when falling, softer horizontally so she leads the frame a little
    const k = 1 - Math.exp(-dt * 9);
    this.target.x += (focus.x - this.target.x) * k;
    this.target.z += (focus.z - this.target.z) * k;
    const ky = 1 - Math.exp(-dt * (focus.y < this.target.y - 0.5 ? 12 : 5));
    this.target.y += (focus.y - this.target.y) * ky;

    _look.copy(this.target).y += this.height;
    _off.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    // pull in if something is between the camera and her (fast in, slow out)
    let want = this.distance;
    const hit = col.raycast(_look, _dir.copy(_off), this.distance + 0.3, _hit);
    if (hit !== null) want = Math.max(0.6, hit - 0.3);
    this.actual += (want - this.actual) * (1 - Math.exp(-dt * (want < this.actual ? 20 : 3)));
    _pos.copy(_look).addScaledVector(_off, this.actual);

    // blend towards a cutscene shot
    this.blend += ((this.shot ? 1 : 0) - this.blend) * (1 - Math.exp(-dt * 2.2));
    const cam = this.camera;
    const shot = this.lastShot;
    if (shot && this.blend > 0.001) {
      const b = THREE.MathUtils.smootherstep(this.blend, 0, 1);
      _pos.lerp(shot.position, b);
      _look.lerp(shot.look, b);
      cam.fov = THREE.MathUtils.lerp(this.baseFov, shot.fov ?? this.baseFov, b);
    } else cam.fov = this.baseFov;
    cam.position.copy(_pos);
    // a gentle handheld breathing, plus impact shake
    const br = 0.006, s = this.shake * 0.06;
    cam.position.x += Math.sin(time * 0.7) * br + (Math.random() - 0.5) * s;
    cam.position.y += Math.sin(time * 0.9 + 1) * br + (Math.random() - 0.5) * s;
    this.shake *= Math.exp(-dt * 7);
    cam.lookAt(_look);
    cam.updateProjectionMatrix();
  }
}
