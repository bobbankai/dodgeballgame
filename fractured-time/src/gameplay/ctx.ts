import type * as THREE from 'three/webgpu';
import type { Physics } from '@/physics/physics';
import type { Input } from '@/input/input';
import type { CameraRig } from '@/camera/rig';
import type { PostFX } from '@/rendering/postfx';
import type { Actor } from './actor';

export interface Fx {
  /** impact burst at a world point; heavy = larger */
  hit(point: THREE.Vector3, dir: THREE.Vector3, opts: { heavy: boolean; blocked: boolean; parried: boolean }): void;
  /** brief afterimage / distortion pulse */
  pulse(point: THREE.Vector3, kind: 'parry' | 'slow' | 'rewind' | 'shift' | 'echo'): void;
}

export interface Sfx {
  play(name: string, opts?: { at?: THREE.Vector3; volume?: number; pitch?: number }): void;
}

/** Shared services every actor can see. Systems depend on this interface, not on each other. */
export interface GameCtx {
  physics: Physics;
  input: Input;
  camera: CameraRig;
  post: PostFX;
  scene: THREE.Scene;
  fx: Fx;
  sfx: Sfx;
  /** simulated seconds since the level started */
  time: number;
  player: Actor & { energy: number };
  enemies: Actor[];
  /** Temporal echoes (player-side bodies enemies may attack) */
  readonly echoes: Actor[];
  /** nearest live enemy within range and a frontal cone (radians), or null */
  findTarget(from: THREE.Vector3, facing: THREE.Vector3, range: number, cone: number, exclude?: Actor | null): Actor | null;
  /** enemies that want to attack must hold a token; keeps group fights readable */
  tokens: { request(a: Actor, cost?: number): boolean; release(a: Actor): void };
  /** world-state flags (story progress and puzzle state) */
  flags: Map<string, unknown>;
  /** temporal hazards: drag the player's own time for a while */
  slowPlayer?(seconds: number): void;
  /** is the ground clear between two points (line of sight for AI) */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean;
}
