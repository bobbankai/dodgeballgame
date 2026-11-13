import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { STEP } from '@/core/loop';

/** Collision membership bits. A collider collides with another when each one's filter includes the other's membership. */
export const G = { STATIC: 1, PLAYER: 2, ENEMY: 4, PROP: 8, TRIGGER: 16, CAMERA_BLOCK: 32 } as const;
const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;

export interface CharacterBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  radius: number;
  height: number;
}

export interface MoveResult {
  movement: THREE.Vector3;
  grounded: boolean;
}

export class Physics {
  readonly R = RAPIER;
  readonly world: RAPIER.World;
  private sensors: Array<{ collider: RAPIER.Collider; onEnter?: () => void; onExit?: () => void; inside: boolean; tag: string }> = [];

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  step(): void {
    this.world.step();
  }

  // --- static geometry -------------------------------------------------------------------------------------------

  addBox(center: THREE.Vector3Like, half: THREE.Vector3Like, rotY = 0, member: number = G.STATIC): RAPIER.Collider {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const desc = this.R.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCollisionGroups(groups(member, G.PLAYER | G.ENEMY | G.PROP | G.CAMERA_BLOCK))
      .setFriction(0.8);
    return this.world.createCollider(desc);
  }

  /** Collision from a render mesh (kit pieces use simplified collision meshes exported alongside them). */
  addTrimesh(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, member: number = G.STATIC): RAPIER.Collider {
    const pos = geo.getAttribute('position');
    const v = new THREE.Vector3();
    const verts = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      verts.set([v.x, v.y, v.z], i * 3);
    }
    let idx: Uint32Array;
    if (geo.index) idx = Uint32Array.from(geo.index.array as ArrayLike<number>);
    else idx = Uint32Array.from({ length: pos.count }, (_, i) => i);
    const desc = this.R.ColliderDesc.trimesh(verts, idx).setCollisionGroups(groups(member, G.PLAYER | G.ENEMY | G.PROP | G.CAMERA_BLOCK)).setFriction(0.8);
    return this.world.createCollider(desc);
  }

  /** A trigger volume. `tag` is for debugging. Callbacks fire when the player's collider centre enters / leaves. */
  addSensor(center: THREE.Vector3Like, half: THREE.Vector3Like, tag: string, onEnter?: () => void, onExit?: () => void): { remove(): void; collider: RAPIER.Collider } {
    const desc = this.R.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setSensor(true).setCollisionGroups(groups(G.TRIGGER, G.PLAYER));
    const collider = this.world.createCollider(desc);
    const s = { collider, onEnter, onExit, inside: false, tag };
    this.sensors.push(s);
    return { collider, remove: () => { this.world.removeCollider(collider, false); this.sensors = this.sensors.filter((x) => x !== s); } };
  }

  /** Call once per tick with the player position to drive sensor enter/exit. */
  updateSensors(p: THREE.Vector3): void {
    for (const s of this.sensors) {
      const t = s.collider.translation();
      const h = s.collider.halfExtents() ?? { x: 0, y: 0, z: 0 };
      const inside = Math.abs(p.x - t.x) <= h.x && Math.abs(p.y - t.y) <= h.y && Math.abs(p.z - t.z) <= h.z;
      if (inside && !s.inside) s.onEnter?.();
      if (!inside && s.inside) s.onExit?.();
      s.inside = inside;
    }
  }

  // --- characters ------------------------------------------------------------------------------------------------

  createCharacter(pos: THREE.Vector3Like, radius: number, height: number, member: number): CharacterBody {
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + height / 2, pos.z));
    const half = Math.max(0.01, height / 2 - radius);
    const filter = member === G.PLAYER ? G.STATIC | G.ENEMY | G.PROP : G.STATIC | G.PLAYER | G.PROP | G.ENEMY;
    const collider = this.world.createCollider(this.R.ColliderDesc.capsule(half, radius).setCollisionGroups(groups(member, filter)), body);
    const controller = this.world.createCharacterController(0.02);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.enableAutostep(0.32, 0.18, false);
    controller.enableSnapToGround(0.25);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((62 * Math.PI) / 180);
    controller.setSlideEnabled(true);
    controller.setApplyImpulsesToDynamicBodies(true);
    return { body, collider, controller, radius, height };
  }

  removeCharacter(c: CharacterBody): void {
    this.world.removeCollider(c.collider, false);
    this.world.removeRigidBody(c.body);
    this.world.removeCharacterController(c.controller);
  }

  /** Move a character by `desired` (world units this tick). Returns the resolved movement and ground contact. */
  move(c: CharacterBody, desired: THREE.Vector3): MoveResult {
    // honour the character's collision groups (player and echoes pass through each other) and ignore trigger volumes
    c.controller.computeColliderMovement(
      c.collider,
      { x: desired.x, y: desired.y, z: desired.z },
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      c.collider.collisionGroups(),
    );
    const m = c.controller.computedMovement();
    const t = c.body.translation();
    c.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    return { movement: new THREE.Vector3(m.x, m.y, m.z), grounded: c.controller.computedGrounded() };
  }

  /** Feet position of a character body. */
  feet(c: CharacterBody, out = new THREE.Vector3()): THREE.Vector3 {
    const t = c.body.translation();
    return out.set(t.x, t.y - c.height / 2, t.z);
  }

  teleport(c: CharacterBody, feet: THREE.Vector3Like): void {
    c.body.setTranslation({ x: feet.x, y: feet.y + c.height / 2, z: feet.z }, true);
    c.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + c.height / 2, z: feet.z });
  }

  // --- queries ---------------------------------------------------------------------------------------------------

  /** Distance to the first static surface along a ray, or null. Used by the camera and line-of-sight checks. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask: number = G.STATIC | G.CAMERA_BLOCK): number | null {
    const ray = new this.R.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(0xffff, mask));
    return hit ? hit.timeOfImpact : null;
  }

  groundHeight(x: number, z: number, from = 50): number | null {
    const d = this.raycast(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0), from + 20, G.STATIC);
    return d === null ? null : from - d;
  }
}
