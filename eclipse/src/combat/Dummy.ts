import { Color3, CreateCylinder, Vector3, type Mesh, type PBRMaterial, type Scene } from '@babylonjs/core';
import type { Combatant, DamageInfo, HitResult, HurtCapsule, Team } from './Types';
import type { CombatWorld } from './CombatWorld';
import type { MaterialLibrary } from '../render/Materials';

/** A training post for the playground: takes hits, shows them, never dies. */
export class TrainingDummy implements Combatant {
  readonly id: number;
  readonly team: Team = 'enemy';
  readonly name = 'Training post';
  readonly radius = 0.35;
  readonly height = 1.8;
  readonly heavy = true;
  readonly targetable = true;
  readonly alive = true;
  readonly mesh: Mesh;
  hits = 0;
  lastDamage = 0;
  private flash = 0;
  private cap: HurtCapsule;
  private mat: PBRMaterial;

  constructor(scene: Scene, world: CombatWorld, mats: MaterialLibrary, at: Vector3) {
    this.id = world.newId();
    this.mesh = CreateCylinder(`dummy_${this.id}`, { height: this.height, diameterTop: 0.5, diameterBottom: 0.6, tessellation: 24 }, scene);
    this.mesh.position.copyFrom(at).addInPlaceFromFloats(0, this.height / 2, 0);
    this.mat = mats.surface({ set: 'ash_wood', tile: 1 }).clone(`dummyMat_${this.id}`);
    this.mesh.material = this.mat;
    this.cap = { a: at.add(new Vector3(0, 0.3, 0)), b: at.add(new Vector3(0, 1.6, 0)), radius: 0.3, mult: 1, part: 'body' };
    world.add(this);
  }

  get position(): Vector3 {
    return this.mesh.position.subtract(new Vector3(0, this.height / 2, 0));
  }

  hurtboxes(): HurtCapsule[] {
    return [this.cap];
  }

  aimPoint(out: Vector3): Vector3 {
    return out.copyFrom(this.mesh.position);
  }

  receive(hit: DamageInfo): HitResult {
    this.hits++;
    this.lastDamage = hit.amount;
    this.flash = 1;
    return 'hit';
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 5);
    this.mat.emissiveColor = new Color3(1, 0.5, 0.2).scale(this.flash * 2);
  }
}
