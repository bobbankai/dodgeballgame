import type { ProgressState } from '../progression/Progression';

/** One save slot: where the player is in the story and everything they have earned. */
export interface SaveData {
  version: number;
  /** Level id and checkpoint to resume from. */
  level: string;
  checkpoint: string;
  /** Chapters reached (for chapter select). */
  chapters: string[];
  progress: ProgressState;
  flasks: number;
  /** Encounters and story beats already done, per level. */
  flags: Record<string, string[]>;
  playtime: number;
  savedAt: number;
}

const KEY = 'eclipse.save.v1';

/**
 * Saves to localStorage: automatically at checkpoints (a fight won, a chapter started, a god
 * fallen) and when quitting to the title. A single slot; loading resumes at the last checkpoint.
 */
export class Save {
  data: SaveData | null = null;

  constructor() {
    this.data = Save.read();
  }

  static read(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      return d.version === 1 ? d : null;
    } catch {
      return null;
    }
  }

  static fresh(): SaveData {
    return {
      version: 1, level: 'ashen', checkpoint: '', chapters: ['ashen'],
      progress: { xp: 0, level: 1, points: 0, skills: [], sparks: [] },
      flasks: 3, flags: {}, playtime: 0, savedAt: Date.now(),
    };
  }

  write(d: SaveData): void {
    d.savedAt = Date.now();
    this.data = d;
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      // storage full or disabled: the session continues unsaved
    }
  }

  clear(): void {
    this.data = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  }
}
