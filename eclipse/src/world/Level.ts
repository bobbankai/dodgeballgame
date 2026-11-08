import type { Color3, Vector3 } from '@babylonjs/core';
import type { Game } from '../game/Game';
import type { LightingProfile } from '../render/Lighting';
import type { SkyParams } from '../render/Sky';
import type { LookParams } from '../render/Pipeline';

/** The visual and atmospheric setup of an area. */
export interface Atmos {
  lighting: LightingProfile;
  sky: Partial<SkyParams>;
  look: Partial<LookParams>;
  weather?: { wetness?: number; cover?: number; coverColor?: Color3; wind?: number; windDir?: [number, number] };
}

/**
 * A level: loads its scenery, enemies, triggers and story beats into the shared scene and removes
 * them again on dispose. Chapters are levels; the camp interlude and dev stages are levels too.
 */
export abstract class Level {
  abstract readonly id: string;
  abstract readonly title: string;
  /** Asset scope name, released when the level unloads. */
  get scope(): string {
    return `level:${this.id}`;
  }

  constructor(protected game: Game) {}

  /** Build the scenery and systems. `checkpoint` names where to start. */
  abstract load(checkpoint?: string): Promise<void>;

  /** Where the player starts (after load). */
  abstract spawn(checkpoint?: string): { position: Vector3; yaw: number };

  abstract atmosphere(): Atmos;

  /** Called every fixed step while the level is active. */
  update(_dt: number): void {}

  dispose(): void {}
}
