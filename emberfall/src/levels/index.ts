import type { Level } from '../game/Game';
import { Arena } from './Arena';
import { Cinders } from './Cinders';
import { Drowned } from './Drowned';
import { Frostwake } from './Frostwake';
import { HeartForge } from './HeartForge';
import { HollowCrown } from './HollowCrown';

export const LEVELS: Record<string, () => Level> = {
  arena: () => new Arena(),
  cinders: () => new Cinders(),
  drowned: () => new Drowned(),
  frostwake: () => new Frostwake(),
  heartforge: () => new HeartForge(),
  hollowcrown: () => new HollowCrown(),
};

/** the story, in order (filled as chapters are built) */
export const CHAPTER_ORDER: string[] = ['cinders', 'drowned', 'frostwake', 'heartforge', 'hollowcrown'];
