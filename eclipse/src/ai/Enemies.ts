import { Vector3 } from '@babylonjs/core';
import { Enemy, type AiContext } from './Enemy';
import { archetype, type EnemyArchetype } from './Archetypes';
import { Boss, type BossDef } from './Boss';
import { Character } from '../character/Character';
import { attachWeapon } from '../character/Weapons';
import type { AssetManager } from '../assets/AssetManager';
import type { CharacterMaterials } from '../character/CharacterMaterials';
import type { AnimLibrary } from '../anim/AnimLibrary';
import type { Lighting } from '../render/Lighting';
import { log } from '../core/Log';

export interface SpawnOptions {
  yaw?: number;
  patrol?: Vector3[];
  /** Starts already hunting the player (ambushes, arena waves). */
  aggro?: boolean;
  name?: string;
}

/**
 * Spawns and owns the enemies of the current level: loads each archetype's model and weapon, runs
 * them every step, and forwards the player's attacks so enemies can read them.
 */
export class Enemies {
  readonly list: Enemy[] = [];
  /** Models that failed to load, so the warning is printed once. */
  private missing = new Set<string>();
  private serial = 0;
  /** Called for every enemy and boss spawned (audio and other systems hook in here). */
  onSpawn: ((e: Enemy) => void) | null = null;

  constructor(private ctx: AiContext, private assets: AssetManager, private mats: CharacterMaterials, private lib: AnimLibrary, private lighting: Lighting) {}

  async spawn(id: string, at: Vector3, o: SpawnOptions = {}): Promise<Enemy> {
    const def = archetype(id);
    const char = await this.loadCharacter(def);
    const e = new Enemy(this.ctx, def, char, at, o.yaw ?? 0, o.name);
    this.adopt(e, at, o);
    return e;
  }

  /** A god: loads its model and weapon and returns the Boss (the level wires its hooks and HUD bar). */
  async spawnBoss(def: BossDef, at: Vector3, yaw = 0): Promise<Boss> {
    const char = await this.loadCharacter(def.archetype);
    const b = new Boss(this.ctx, def, char, at, yaw);
    this.adopt(b, at, {});
    return b;
  }

  private adopt(e: Enemy, at: Vector3, o: SpawnOptions): void {
    if (o.patrol) e.patrol = o.patrol;
    if (o.aggro) {
      const p = this.ctx.player();
      if (p) e.alert(at, p);
    }
    this.list.push(e);
    this.onSpawn?.(e);
    e.events.on('removed', () => {
      const i = this.list.indexOf(e);
      if (i >= 0) this.list.splice(i, 1);
    });
  }

  private async loadCharacter(def: EnemyArchetype): Promise<Character> {
    const name = `${def.id}_${this.serial++}`;
    let char: Character;
    try {
      char = await Character.create(this.ctx.scene, this.assets, this.mats, this.lib, def.model, name);
    } catch (e) {
      // until an archetype's own model is built, stand it in with the hero's (dev only)
      if (!this.missing.has(def.model)) log.warn(`enemy model ${def.model} missing, using stand-in`, e);
      this.missing.add(def.model);
      char = await Character.create(this.ctx.scene, this.assets, this.mats, this.lib, 'kael', name);
    }
    for (const m of char.meshes) this.lighting.addCaster(m, false);
    if (def.weapon) {
      try {
        await attachWeapon(this.ctx.scene, this.assets, char, def.weapon, 'weapon_r', this.lighting);
      } catch {
        if (!this.missing.has(def.weapon)) log.warn(`weapon ${def.weapon} missing, using stand-in`);
        this.missing.add(def.weapon);
        await attachWeapon(this.ctx.scene, this.assets, char, 'oathkeeper', 'weapon_r', this.lighting);
      }
    }
    return char;
  }

  update(dt: number): void {
    for (const e of [...this.list]) e.update(dt);
  }

  /** The player began an attack: enemies that see it coming may block or dodge. */
  threatened(by: import('../combat/Types').Combatant): void {
    for (const e of this.list) e.threatened(by);
  }

  get alive(): Enemy[] {
    return this.list.filter((e) => e.alive);
  }

  clear(): void {
    for (const e of [...this.list]) e.remove();
    this.list.length = 0;
  }
}
