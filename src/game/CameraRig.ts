import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Collision } from './Collision';

const _off = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _d = new THREE.Vector2();
const _o = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _ds = [0, 0, 0, 0, 0];

/**
 * How far the camera can sit from `from` along `dir` before scenery gets in the way. Five rays
 * (centre and a cross around it) vote, and the middle answer wins: a wall blocks them all, but a
 * railing, a post or a branch only catches one or two and is looked past instead of jumped in front of.
 */
function clearance(col: Collision, from: THREE.Vector3, dir: THREE.Vector3, far: number) {
  _r.crossVectors(dir, Math.abs(dir.y) > 0.95 ? _r.set(1, 0, 0) : _u.set(0, 1, 0)).normalize();
  _u.crossVectors(_r, dir).normalize();
  const s = 0.28;
  for (let i = 0; i < 5; i++) {
    _o.copy(from);
    if (i === 1) _o.addScaledVector(_r, s);
    else if (i === 2) _o.addScaledVector(_r, -s);
    else if (i === 3) _o.addScaledVector(_u, s);
    else if (i === 4) _o.addScaledVector(_u, -s);
    const d = col.raycast(_o, dir, far, _hit);
    _ds[i] = d ?? Infinity;
  }
  _ds.sort((a, b) => a - b);
  return _ds[2];
}

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
  /** Camera roll in radians (a slight dutch angle). */
  roll?: number;
}

/** Where a level would like the camera to sit for the place Ada is in (a spiral stair...). */
export interface CameraGuide {
  yaw: number;
  pitch?: number;
  distance?: number;
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
  /** The camera never dips below this height (the sea's surface while sailing). */
  floor = -Infinity;
  /** Levels can steer the camera in awkward places; the player can still look about. */
  guide: ((focus: THREE.Vector3) => CameraGuide | null) | null = null;
  private guideK = 0;
  private guidePitch = 0.32;
  private guideDist = 4.3;
  private maxZoom = 7;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Closer, wider framing for small rooms (and back). */
  interior(on: boolean) {
    this.distance = this.zoomTarget = this.actual = on ? 2.3 : 4.3;
    this.baseFov = on ? 62 : 50;
    this.pitch = on ? 0.18 : 0.32;
    this.height = on ? 1.0 : 1.15;
    this.floor = -Infinity;
    this.maxZoom = 7;
  }

  /** Further back and higher, to see the boat, the sail and the water ahead (and back). */
  sailing(on: boolean) {
    this.interior(false);
    if (!on) return;
    this.distance = this.zoomTarget = this.actual = 8;
    this.baseFov = 54;
    this.pitch = 0.22;
    this.height = 1.7;
    this.floor = 2.2;
    this.maxZoom = 12;
  }

  snap(focus: THREE.Vector3, yaw = this.yaw) {
    this.target.copy(focus);
    this.yaw = yaw;
    this.actual = this.distance;
  }

  /** Hand the camera a fixed shot (eased into), or with `cut` jump straight to it. */
  setShot(shot: Shot | null, cut = false) {
    this.shot = shot;
    if (shot) this.lastShot = shot;
    if (cut) this.blend = shot ? 1 : 0;
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
      this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget + input.zoom() * 0.45, 2.4, this.maxZoom);
    }
    this.distance += (this.zoomTarget - this.distance) * (1 - Math.exp(-dt * 6));

    // a level's guide eases the camera round to its preferred side (unless the player is looking about)
    const gd = !this.shot && this.guide ? this.guide(focus) : null;
    this.guideK += ((gd ? 1 : 0) - this.guideK) * (1 - Math.exp(-dt * 2.5));
    if (gd) {
      if (this.idleLook > 1.2) this.yaw += angleTo(this.yaw, gd.yaw) * (1 - Math.exp(-dt * 3));
      this.guidePitch = gd.pitch ?? this.pitch;
      this.guideDist = gd.distance ?? this.distance;
    }
    const pitch = THREE.MathUtils.lerp(this.pitch, this.guidePitch, this.guideK);
    const distance = THREE.MathUtils.lerp(this.distance, this.guideDist, this.guideK);

    // drift behind her when she has been running a while without the player steering the camera
    const hs = Math.hypot(vel.x, vel.z);
    if (hs > 0.5 && this.idleLook > 0.9 && !this.shot && !gd) {
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
    _off.set(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    // pull in if something is between the camera and her (fast in, slow out)
    let want = distance;
    const hit = clearance(col, _look, _dir.copy(_off), distance + 0.3);
    if (hit < Infinity) want = Math.max(0.6, hit - 0.3);
    this.actual += (want - this.actual) * (1 - Math.exp(-dt * (want < this.actual ? 20 : 3)));
    _pos.copy(_look).addScaledVector(_off, this.actual);
    _pos.y = Math.max(_pos.y, this.floor);

    // blend towards a cutscene shot
    this.blend += ((this.shot ? 1 : 0) - this.blend) * (1 - Math.exp(-dt * 2.2));
    const cam = this.camera;
    const shot = this.lastShot;
    if (shot && this.blend > 0.001) {
      const b = THREE.MathUtils.smootherstep(this.blend, 0, 1);
      // close cutscene shots also pull in front of anything in the way (long shots are framed by
      // hand, and their subject is often inside something, like a lamp behind glass)
      _dir.subVectors(shot.position, shot.look);
      const len = _dir.length();
      _dir.normalize();
      const sh = len < 12 ? clearance(col, shot.look, _dir, len) : Infinity;
      const sp = sh < Infinity ? _hit.copy(shot.look).addScaledVector(_dir, Math.max(0.5, sh - 0.35)) : shot.position;
      _pos.lerp(sp, b);
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
    if (shot && this.blend > 0.001 && shot.roll) cam.rotateZ(shot.roll * this.blend);
    cam.updateProjectionMatrix();
  }
}
