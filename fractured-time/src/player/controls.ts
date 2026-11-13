import * as THREE from 'three/webgpu';
import type { Input, Action } from '@/input/input';
import type { CameraRig } from '@/camera/rig';

/** One simulation tick of intent. Movement is already camera-relative (world X/Z). */
export interface ControlFrame {
  dx: number;
  dz: number;
  sprint: boolean;
  held: Action[];
  pressed: Action[];
  /** -1 / +1: switch lock-on target left/right (stick flick or Q/E style keys) */
  switchTarget: number;
}

export interface Controls {
  next(): ControlFrame;
}

/** Live input: keyboard/mouse/gamepad/touch resolved through the camera. */
export class LiveControls implements Controls {
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  enabled = true;

  constructor(private input: Input, private camera: CameraRig) {}

  next(): ControlFrame {
    if (!this.enabled) {
      this.input.takePressed();
      return { dx: 0, dz: 0, sprint: false, held: [], pressed: [], switchTarget: 0 };
    }
    this.camera.groundForward(this.fwd);
    this.camera.groundRight(this.right);
    const x = this.input.moveX, y = this.input.moveY;
    const dx = this.fwd.x * y + this.right.x * x;
    const dz = this.fwd.z * y + this.right.z * x;
    return { dx, dz, sprint: this.input.isHeld('sprint'), held: [...this.input.held], pressed: this.input.takePressed(), switchTarget: 0 };
  }
}

/** Replays a recorded stream (Temporal Echo, tests, scripted cutscene actions). */
export class ReplayControls implements Controls {
  private i = 0;
  constructor(private frames: ControlFrame[]) {}
  get done(): boolean { return this.i >= this.frames.length; }
  next(): ControlFrame {
    const f = this.frames[this.i++];
    return f ?? { dx: 0, dz: 0, sprint: false, held: [], pressed: [], switchTarget: 0 };
  }
}

/** Test / scripted controls: set fields from outside; `press()` queues an edge for the next tick. */
export class ScriptedControls implements Controls {
  dx = 0;
  dz = 0;
  sprint = false;
  held = new Set<Action>();
  private queue: Action[] = [];
  press(a: Action): void { this.queue.push(a); this.held.add(a); }
  release(a: Action): void { this.held.delete(a); }
  next(): ControlFrame {
    const pressed = this.queue;
    this.queue = [];
    return { dx: this.dx, dz: this.dz, sprint: this.sprint, held: [...this.held], pressed, switchTarget: 0 };
  }
}
