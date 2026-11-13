import { Vector3 } from '@babylonjs/core';
import type { Enemies } from '../ai/Enemies';
import type { Enemy } from '../ai/Enemy';

export interface SpawnDef {
  id: string;
  at: Vector3;
  yaw?: number;
  patrol?: Vector3[];
  aggro?: boolean;
}

export interface EncounterDef {
  id: string;
  /** Where the fight happens; enemies are spawned when the player comes within `spawnRange`. */
  at: Vector3;
  spawnRange?: number;
  spawns: SpawnDef[];
  onClear?: () => void;
}

interface Running {
  def: EncounterDef;
  state: 'waiting' | 'loading' | 'active' | 'cleared';
  enemies: Enemy[];
}

/**
 * A level's fights: each group of enemies is spawned (idle, patrolling or already hunting) when the
 * player first comes within range, so only nearby fights cost anything, and reports when every
 * enemy in it is dead (doors open, checkpoints save, music settles).
 */
export class Encounters {
  private list: Running[] = [];

  constructor(private enemies: Enemies) {}

  add(def: EncounterDef): void {
    this.list.push({ def, state: 'waiting', enemies: [] });
  }

  /** Marks an encounter as already done (loading from a later checkpoint). */
  skip(id: string): void {
    const r = this.list.find((x) => x.def.id === id);
    if (r) r.state = 'cleared';
  }

  update(player: Vector3): void {
    for (const r of this.list) {
      if (r.state === 'waiting') {
        const range = r.def.spawnRange ?? 45;
        if (Vector3.DistanceSquared(player, r.def.at) < range * range) {
          r.state = 'loading';
          void this.start(r);
        }
      } else if (r.state === 'active' && r.enemies.every((e) => !e.alive)) {
        r.state = 'cleared';
        r.def.onClear?.();
      }
    }
  }

  private async start(r: Running): Promise<void> {
    for (const s of r.def.spawns) {
      const e = await this.enemies.spawn(s.id, s.at, { yaw: s.yaw, patrol: s.patrol, aggro: s.aggro });
      r.enemies.push(e);
    }
    r.state = 'active';
  }

  cleared(id: string): boolean {
    return this.list.find((x) => x.def.id === id)?.state === 'cleared';
  }

  get active(): number {
    return this.list.filter((r) => r.state === 'active').length;
  }
}
