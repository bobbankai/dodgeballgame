// Story characters (not enemies): Oren, Ren, Mika, villagers. They stand, pose, walk to points on the
// ground, look at people, talk (Face lip flaps via Game.say) and can be carried by another character.
import * as THREE from 'three';
import type { Game } from './Game';
import { Character } from './Character';

export interface NPCOptions {
  name: string;
  url: string;
  pos: THREE.Vector3;
  yaw?: number;
  /** looping base pose / idle clip */
  idle?: string;
  walk?: string;
  run?: string;
  weapon?: string | null;
  sheathed?: boolean;
  scale?: number;
  mood?: string;
}

export class NPC {
  readonly name: string;
  char!: Character;
  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  private goal: THREE.Vector3 | null = null;
  private goalSpeed = 1.2;
  private arrive: (() => void) | null = null;
  private lookTarget: THREE.Object3D | THREE.Vector3 | null = null;
  private carrier: { char: Character; socket: string; offset: THREE.Matrix4 } | null = null;
  private turnTo: number | null = null;
  private game: Game;

  private constructor(game: Game, name: string) {
    this.game = game;
    this.name = name;
  }

  static async create(game: Game, o: NPCOptions): Promise<NPC> {
    const n = new NPC(game, o.name);
    n.char = await Character.load(game.pipe, { url: o.url, weapon: o.weapon ?? null, sheathed: o.sheathed, scale: o.scale });
    const a = n.char.animator;
    const walk = o.walk ?? 'walk_relaxed';
    const moves = [walk, o.run ?? 'run_relaxed'].filter((m) => a.has(m));
    a.setLocomotion(a.has(o.idle ?? 'idle_relaxed') ? (o.idle ?? 'idle_relaxed') : 'idle', moves);
    n.pos.copy(o.pos);
    const gy = game.world.ground(o.pos.x, o.pos.y + 2, o.pos.z);
    if (gy !== null) n.pos.y = gy;
    n.yaw = o.yaw ?? 0;
    n.char.face.set(o.mood ?? 'calm');
    game.pipe.scene.add(n.char.root);
    n.place();
    game.npcs.push(n);
    return n;
  }

  /** loop a pose clip (kneel, sit_wounded, cower...) or play a one-shot (point, gesture) */
  pose(clip: string, opts: { fade?: number; loop?: boolean } = {}): void {
    this.char.animator.play(clip, { fade: opts.fade ?? 0.4, loop: opts.loop });
  }

  /** back to the idle / locomotion blend */
  release(fade = 0.4): void { this.char.animator.stop(fade); }

  /** walk (or run) to a point on the ground; resolves on arrival */
  walkTo(p: THREE.Vector3, speed = 1.2): Promise<void> {
    this.release(0.3);
    this.goal = p.clone();
    this.goalSpeed = speed;
    return new Promise((res) => { this.arrive = res; });
  }

  /** turn on the spot to face a point */
  face(p: THREE.Vector3): void { this.turnTo = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }

  lookAt(t: THREE.Object3D | THREE.Vector3 | null): void { this.lookTarget = t; }

  teleport(p: THREE.Vector3, yaw?: number): void {
    this.pos.copy(p);
    const gy = this.game.world.ground(p.x, p.y + 2, p.z);
    if (gy !== null) this.pos.y = gy;
    if (yaw !== undefined) this.yaw = yaw;
    this.goal = null;
    this.place();
  }

  /** hang this character on another one's socket (Ren over Gorran's shoulder) */
  carriedBy(char: Character | null, socket = 'socket_back', offset = new THREE.Matrix4()): void {
    this.carrier = char ? { char, socket, offset } : null;
    this.char.gaze.enabled = !char;
  }

  get head(): THREE.Vector3 {
    const h = this.char.bones.get('head');
    return h ? h.getWorldPosition(new THREE.Vector3()) : this.pos.clone().setY(this.pos.y + 1.6);
  }

  update(dt: number): void {
    if (this.goal) {
      const d = new THREE.Vector3(this.goal.x - this.pos.x, 0, this.goal.z - this.pos.z);
      const dist = d.length();
      if (dist < 0.15) {
        this.goal = null;
        this.speed = 0;
        const r = this.arrive;
        this.arrive = null;
        r?.();
      } else {
        const want = Math.atan2(d.x, d.z);
        let dy = want - this.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.yaw += dy * Math.min(1, dt * 6);
        // ease in, slow on arrival
        const target = Math.min(this.goalSpeed, dist * 1.5 + 0.3);
        this.speed += (target - this.speed) * Math.min(1, dt * 4);
        const step = Math.min(dist, this.speed * dt);
        this.pos.addScaledVector(d.normalize(), step);
        const gy = this.game.world.ground(this.pos.x, this.pos.y + 1.0, this.pos.z, 3);
        if (gy !== null) this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12);
      }
    } else {
      this.speed += (0 - this.speed) * Math.min(1, dt * 6);
      if (this.turnTo !== null) {
        let dy = this.turnTo - this.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.yaw += dy * Math.min(1, dt * 4);
        if (Math.abs(dy) < 0.01) this.turnTo = null;
      }
    }
    this.char.animator.locomote(this.speed, dt);
    // gaze
    const lt = this.lookTarget;
    if (lt) {
      const tp = lt instanceof THREE.Vector3 ? lt : (lt as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      this.char.gaze.target = (this.char.gaze.target ?? new THREE.Vector3()).copy(tp);
    } else this.char.gaze.target = null;
    this.place();
    this.char.update(dt);
  }

  private place(): void {
    const r = this.char.root;
    if (this.carrier) {
      const s = this.carrier.char.sockets.get(this.carrier.socket) ?? this.carrier.char.root;
      s.updateWorldMatrix(true, false);
      const m = s.matrixWorld.clone().multiply(this.carrier.offset);
      m.decompose(r.position, r.quaternion, r.scale);
      r.scale.setScalar(1);
      return;
    }
    r.position.copy(this.pos);
    r.rotation.set(0, this.yaw, 0);
  }

  dispose(): void {
    this.char.root.removeFromParent();
  }
}
