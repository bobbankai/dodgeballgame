// Creating fighters: model + stats + controller for each character kind.
import { Vector3 } from '@babylonjs/core';
import { CharacterModel, type CharacterLook } from './CharacterModel';
import { Fighter, HERO_ANIMS, type AnimSet } from './Fighter';
import type { Game } from './Game';
import { makeBrain, type Archetype, type Brain } from '../ai/EnemyAI';

export interface Kind {
  model: string;
  look?: CharacterLook;
  hp: number;
  team: Fighter['team'];
  anims?: Partial<AnimSet>;
  archetype?: Archetype;
  runSpeed?: number;
  walkSpeed?: number;
  radius?: number;
  height?: number;
  poise?: number;
  name: string;
}

const SWORD_ANIMS: Partial<AnimSet> = { idle: 'sword_idle', block: 'block' };
const SHIELD_ANIMS: Partial<AnimSet> = { idle: 'shield_idle', block: 'shield_idle' };
const RIFLE_ANIMS: Partial<AnimSet> = { idle: 'aim' };

export const KINDS: Record<string, Kind> = {
  kai: { model: 'kai', hp: 160, team: 'player', name: 'Kai', look: { face: { eyeStyle: 0, irisTop: [0.42, 0.18, 0.03], irisBottom: [1.0, 0.72, 0.22] } } },
  marine: { model: 'marine', hp: 55, team: 'enemy', archetype: 'marine', anims: SWORD_ANIMS, runSpeed: 4.6, name: 'Armada Marine', look: { face: { eyeStyle: 1 } } },
  rifleman: { model: 'rifleman', hp: 40, team: 'enemy', archetype: 'rifleman', anims: RIFLE_ANIMS, runSpeed: 4.8, name: 'Armada Rifleman', look: { face: { eyeStyle: 1 } } },
  brute: { model: 'brute', hp: 150, team: 'enemy', archetype: 'brute', anims: SHIELD_ANIMS, runSpeed: 3.6, radius: 0.6, height: 2.2, poise: 30, name: 'Armada Bulwark', look: { face: { eyeStyle: 3 } } },
  thug: { model: 'thug', hp: 42, team: 'enemy', archetype: 'thug', runSpeed: 5.0, name: 'Ashport Thug', look: { face: { eyeStyle: 1 } } },
  elite: { model: 'elite', hp: 90, team: 'enemy', archetype: 'elite', anims: SWORD_ANIMS, runSpeed: 5.2, name: 'Gilded Elite', look: { face: { eyeStyle: 1 } } },
  wrecker: { model: 'wrecker', hp: 50, team: 'enemy', archetype: 'wrecker', anims: SWORD_ANIMS, runSpeed: 5.0, name: 'Wrecker', look: { face: { eyeStyle: 1 } } },
  // crew
  mira: { model: 'mira', hp: 120, team: 'ally', runSpeed: 5.8, name: 'Mira', anims: { idle: 'sword_idle' }, look: { face: { eyeStyle: 2, irisTop: [0.05, 0.3, 0.2], irisBottom: [0.35, 0.85, 0.55] } } },
  bram: { model: 'bram', hp: 200, team: 'ally', runSpeed: 5.0, radius: 0.6, height: 2.15, poise: 40, name: 'Bram', look: { face: { eyeStyle: 3, irisTop: [0.25, 0.15, 0.06], irisBottom: [0.6, 0.42, 0.2] } } },
  nell: { model: 'nell', hp: 90, team: 'ally', runSpeed: 5.6, radius: 0.34, height: 1.35, name: 'Nell', look: { face: { eyeStyle: 0, eyeSize: 1.12, irisTop: [0.3, 0.2, 0.05], irisBottom: [0.95, 0.75, 0.25] } } },
  // story
  ines: { model: 'ines', hp: 100, team: 'neutral', walkSpeed: 1.2, runSpeed: 3.2, name: 'Ines', look: { face: { eyeStyle: 3, irisTop: [0.2, 0.18, 0.3], irisBottom: [0.5, 0.45, 0.7] } } },
  seren: { model: 'seren', hp: 100, team: 'neutral', name: 'Seren', look: { face: { eyeStyle: 2, irisTop: [0.42, 0.18, 0.03], irisBottom: [1.0, 0.72, 0.22] } } },
  teo: { model: 'teo', hp: 60, team: 'neutral', radius: 0.32, height: 1.3, name: 'Teo', look: { face: { eyeStyle: 0, eyeSize: 1.1 } } },
  hana: { model: 'hana', hp: 60, team: 'neutral', name: 'Hana', look: { face: { eyeStyle: 2, irisTop: [0.15, 0.08, 0.1], irisBottom: [0.55, 0.3, 0.35] } } },
  villager: { model: 'villager', hp: 60, team: 'neutral', name: 'Villager', look: { face: { eyeStyle: 1 } } },
  // bosses
  halvard: { model: 'halvard', hp: 420, team: 'enemy', anims: { idle: 'sword_idle', block: 'block' }, runSpeed: 5.0, radius: 0.5, height: 1.95, poise: 45, name: 'Commodore Halvard Crane', look: { face: { eyeStyle: 1, irisTop: [0.1, 0.15, 0.3], irisBottom: [0.4, 0.55, 0.8] } } },
  gorrick: { model: 'gorrick', hp: 520, team: 'enemy', anims: { idle: 'guard' }, runSpeed: 4.0, radius: 0.75, height: 2.1, poise: 70, name: 'Baron Gorrick Vane', look: { face: { eyeStyle: 3 } } },
  vale: { model: 'vale', hp: 640, team: 'enemy', anims: { idle: 'sword_idle', block: 'block' }, runSpeed: 5.8, radius: 0.45, height: 1.9, poise: 50, name: 'Grand Admiral Severin Vale', look: { face: { eyeStyle: 1, irisTop: [0.25, 0.3, 0.35], irisBottom: [0.7, 0.8, 0.9] } } },
};

export const brains = new Map<Fighter, Brain>();

export async function spawn(game: Game, kindName: string, pos: Vector3, yaw = 0, override: Partial<Kind> = {}): Promise<Fighter> {
  const kind = { ...(KINDS[kindName] ?? KINDS.marine), ...override };
  let model: CharacterModel;
  try {
    model = await CharacterModel.load(game.r, kind.model, kind.look ?? {});
  } catch {
    // fallback while a model is missing: Kai, tinted
    model = await CharacterModel.load(game.r, 'kai', { ...(kind.look ?? {}), tint: [1.1, 0.55, 0.5] });
  }
  const f = new Fighter(game, model, game.lib, kind.name);
  f.team = kind.team;
  f.hp = f.maxHp = kind.hp;
  f.anims = { ...HERO_ANIMS, ...(kind.anims ?? {}) };
  if (kind.runSpeed) f.runSpeed = kind.runSpeed;
  if (kind.walkSpeed) f.walkSpeed = kind.walkSpeed;
  if (kind.radius) f.radius = kind.radius;
  if (kind.height) f.height = kind.height;
  if (kind.poise) { f.maxPoise = kind.poise; f.poise = kind.poise; }
  f.play(f.anims.idle, true, 0);
  f.place(pos, yaw);
  game.addFighter(f);
  if (kind.archetype) brains.set(f, makeBrain(kind.archetype, f, game));
  return f;
}

export function updateBrains(dt: number): void {
  for (const [f, b] of brains) {
    if (f.removed) { brains.delete(f); continue; }
    b.update(dt);
  }
}
