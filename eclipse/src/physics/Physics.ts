import {
  HavokPlugin, PhysicsAggregate, PhysicsMotionType, PhysicsShapeType, Vector3, type AbstractMesh, type Scene,
  type Mesh, PhysicsShapeMesh, PhysicsBody, type PhysicsShape, PhysicsShapeBox, Quaternion, type TransformNode,
  PhysicsRaycastResult,
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import { log } from '../core/Log';

/** Collision filter groups (bit masks) shared by physics bodies and gameplay queries. */
export const enum Layer {
  World = 1 << 0,
  Player = 1 << 1,
  Enemy = 1 << 2,
  Debris = 1 << 3,
  Trigger = 1 << 4,
  Boss = 1 << 5,
  Water = 1 << 6,
}

let havokInstance: unknown | null = null;

export interface RayHit {
  hit: boolean;
  point: Vector3;
  normal: Vector3;
  distance: number;
}

/**
 * Havok Physics V2. Gameplay (combat, AI, abilities) runs on its own fixed step; Havok is stepped
 * by the same clock through `step()` so physics stays deterministic in tests.
 */
export class Physics {
  readonly plugin: HavokPlugin;
  readonly scene: Scene;
  readonly gravity = new Vector3(0, -19.6, 0);
  private statics: PhysicsAggregate[] = [];
  private bodies: PhysicsBody[] = [];
  private rayResult = new PhysicsRaycastResult();

  private constructor(scene: Scene, plugin: HavokPlugin) {
    this.scene = scene;
    this.plugin = plugin;
  }

  static async create(scene: Scene): Promise<Physics> {
    if (!havokInstance) {
      havokInstance = await HavokPhysics({ locateFile: () => havokWasmUrl });
      log.info('physics: Havok ready');
    }
    // useDeltaForWorldStep=false: we pass a fixed timestep ourselves.
    const plugin = new HavokPlugin(false, havokInstance);
    const p = new Physics(scene, plugin);
    scene.enablePhysics(p.gravity, plugin);
    plugin.setTimeStep(1 / 60);
    // scene.render() would step physics with the frame time; we step it from the fixed game clock.
    scene.physicsEnabled = false;
    return p;
  }

  /** Static triangle-mesh collider for level geometry (one body per collision mesh). */
  addStaticMesh(mesh: Mesh, friction = 0.8): PhysicsAggregate {
    const agg = new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction, restitution: 0 }, this.scene);
    agg.body.setMotionType(PhysicsMotionType.STATIC);
    agg.shape.filterMembershipMask = Layer.World;
    this.statics.push(agg);
    return agg;
  }

  /** Static box collider (walls, invisible arena bounds). */
  addStaticBox(node: TransformNode, size: Vector3, center = Vector3.Zero(), layer = Layer.World): PhysicsBody {
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    const shape = new PhysicsShapeBox(center, Quaternion.Identity(), size, this.scene);
    shape.filterMembershipMask = layer;
    body.shape = shape;
    this.bodies.push(body);
    return body;
  }

  /** A dynamic rigid body (debris, barrels, falling rubble). */
  addDynamic(mesh: AbstractMesh, type: PhysicsShapeType, mass: number, opts: { friction?: number; restitution?: number } = {}): PhysicsAggregate {
    const agg = new PhysicsAggregate(mesh, type, { mass, friction: opts.friction ?? 0.6, restitution: opts.restitution ?? 0.15 }, this.scene);
    agg.shape.filterMembershipMask = Layer.Debris;
    agg.shape.filterCollideMask = Layer.World | Layer.Debris | Layer.Player | Layer.Enemy;
    return agg;
  }

  /** Kinematic (animated) body: moving platforms, rotating rings, a boss's collision hull. */
  addAnimated(node: TransformNode, shape: PhysicsShape): PhysicsBody {
    const body = new PhysicsBody(node, PhysicsMotionType.ANIMATED, false, this.scene);
    body.shape = shape;
    body.disablePreStep = false; // follow the node's transform every step
    this.bodies.push(body);
    return body;
  }

  meshShape(mesh: Mesh): PhysicsShapeMesh {
    return new PhysicsShapeMesh(mesh, this.scene);
  }

  step(dt: number): void {
    const engine = this.scene.getPhysicsEngine();
    if (!engine) return;
    this.plugin.setTimeStep(dt);
    engine._step(dt);
  }

  /** Ray cast against world geometry (by collision layer). */
  raycast(from: Vector3, to: Vector3, mask: number = Layer.World): RayHit {
    const res = this.rayResult;
    this.plugin.raycast(from, to, res, { collideWith: mask });
    if (!res.hasHit) return { hit: false, point: to.clone(), normal: Vector3.Up(), distance: -1 };
    return { hit: true, point: res.hitPointWorld.clone(), normal: res.hitNormalWorld.clone(), distance: Vector3.Distance(from, res.hitPointWorld) };
  }

  clearLevel(): void {
    for (const a of this.statics) a.dispose();
    for (const b of this.bodies) b.dispose();
    this.statics = [];
    this.bodies = [];
  }

  dispose(): void {
    this.clearLevel();
    this.scene.disablePhysicsEngine();
  }
}
