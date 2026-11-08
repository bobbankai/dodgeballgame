import type { Game } from '../game/Game';
import type { Level } from '../world/Level';
import { Playground } from './Playground';

/** Level ids -> constructors. Chapters register here as they are built. */
const LEVELS: Record<string, (g: Game) => Level> = {
  playground: (g) => new Playground(g),
};

export function createLevel(game: Game, id: string): Level {
  const make = LEVELS[id] ?? LEVELS.playground;
  return make(game);
}

export function registerLevel(id: string, make: (g: Game) => Level): void {
  LEVELS[id] = make;
}
