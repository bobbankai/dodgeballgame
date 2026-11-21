import type { Director } from './Director';

export interface Chapter {
  num: string;
  title: string;
  sub: string;
  run: (d: Director) => Promise<void>;
}

export const CHAPTERS: Chapter[] = [
  { num: 'PROLOGUE', title: 'The Bell That Didn\'t Ring', sub: 'Shiomi, three years later', run: async (d) => { await d.setStage('alley'); } },
];
