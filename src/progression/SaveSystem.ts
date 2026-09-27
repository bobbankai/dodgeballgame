import type { QualityLevel } from '../config/quality';
import { ATTRIBUTE_KEYS, Attributes, baseAttributes } from '../game/Stats';

export interface Settings {
  quality: QualityLevel;
  autoQuality: boolean;
  mouseSensitivity: number;
  padSensitivity: number;
  invertY: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  cameraShake: number;
  showFps: boolean;
  subtitles: boolean;
}

export interface CampaignProgress {
  completed: Record<string, { stars: number; bestTime: number; wins: number }>;
  seenCinematics: string[];
  lastChapter: number;
}

export interface LifetimeStats {
  matches: number;
  wins: number;
  hits: number;
  catches: number;
  perfectCatches: number;
  kos: number;
  perfectDodges: number;
  throws: number;
  ultimates: number;
}

export interface Look {
  skin: number;
  hair: number;
  hairStyle: string;
  number: number;
  headband: boolean;
}

export interface SaveData {
  version: number;
  created: number;
  updated: number;
  name: string;
  look: Look;
  level: number;
  xp: number;
  cred: number;
  attrPoints: number;
  attributes: Attributes;
  skills: string[];
  equippedAbility: string | null;
  ultimateUnlocked: boolean;
  campaign: CampaignProgress;
  settings: Settings;
  stats: LifetimeStats;
  tutorialDone: boolean;
  newGame: boolean;
}

export const SAVE_VERSION = 2;
const KEY = 'overthrow.save';
const BACKUP_KEY = 'overthrow.save.bak';

export function defaultSettings(): Settings {
  return {
    quality: 'high',
    autoQuality: true,
    mouseSensitivity: 1,
    padSensitivity: 1,
    invertY: false,
    masterVolume: 0.8,
    musicVolume: 0.55,
    sfxVolume: 0.9,
    cameraShake: 1,
    showFps: false,
    subtitles: true,
  };
}

export function defaultSave(): SaveData {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    created: now,
    updated: now,
    name: 'ACE',
    look: { skin: 0xd29a70, hair: 0x1b1411, hairStyle: 'swept', number: 7, headband: false },
    level: 1,
    xp: 0,
    cred: 0,
    attrPoints: 0,
    attributes: baseAttributes(2),
    skills: [],
    equippedAbility: null,
    ultimateUnlocked: false,
    campaign: { completed: {}, seenCinematics: [], lastChapter: 0 },
    settings: defaultSettings(),
    stats: { matches: 0, wins: 0, hits: 0, catches: 0, perfectCatches: 0, kos: 0, perfectDodges: 0, throws: 0, ultimates: 0 },
    tutorialDone: false,
    newGame: true,
  };
}

function checksum(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const k = '__overthrow_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

/** Coerce anything parsed from storage into a valid SaveData, keeping good fields. */
function sanitize(raw: any): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const num = (v: any, def: number, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
  const out: SaveData = { ...d };
  out.created = num(raw.created, d.created);
  out.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 14).toUpperCase() : d.name;
  if (raw.look && typeof raw.look === 'object') {
    out.look = {
      skin: num(raw.look.skin, d.look.skin, 0, 0xffffff),
      hair: num(raw.look.hair, d.look.hair, 0, 0xffffff),
      hairStyle: typeof raw.look.hairStyle === 'string' ? raw.look.hairStyle : d.look.hairStyle,
      number: num(raw.look.number, d.look.number, 0, 99),
      headband: !!raw.look.headband,
    };
  }
  out.level = Math.floor(num(raw.level, 1, 1, 60));
  out.xp = num(raw.xp, 0, 0);
  out.cred = Math.floor(num(raw.cred, 0, 0));
  out.attrPoints = Math.floor(num(raw.attrPoints, 0, 0, 200));
  out.attributes = baseAttributes(2);
  if (raw.attributes && typeof raw.attributes === 'object') for (const k of ATTRIBUTE_KEYS) out.attributes[k] = Math.floor(num(raw.attributes[k], 2, 1, 10));
  out.skills = Array.isArray(raw.skills) ? raw.skills.filter((s: any) => typeof s === 'string') : [];
  out.equippedAbility = typeof raw.equippedAbility === 'string' ? raw.equippedAbility : null;
  out.ultimateUnlocked = !!raw.ultimateUnlocked;
  out.campaign = { completed: {}, seenCinematics: [], lastChapter: 0 };
  if (raw.campaign && typeof raw.campaign === 'object') {
    const c = raw.campaign;
    if (c.completed && typeof c.completed === 'object') {
      for (const [k, v] of Object.entries<any>(c.completed)) {
        if (v && typeof v === 'object') out.campaign.completed[k] = { stars: Math.floor(num(v.stars, 1, 0, 3)), bestTime: num(v.bestTime, 0, 0), wins: Math.floor(num(v.wins, 1, 0)) };
      }
    }
    out.campaign.seenCinematics = Array.isArray(c.seenCinematics) ? c.seenCinematics.filter((s: any) => typeof s === 'string') : [];
    out.campaign.lastChapter = Math.floor(num(c.lastChapter, 0, 0, 20));
  }
  out.settings = { ...defaultSettings() };
  if (raw.settings && typeof raw.settings === 'object') {
    const s = raw.settings;
    if (['low', 'medium', 'high', 'ultra'].includes(s.quality)) out.settings.quality = s.quality;
    out.settings.autoQuality = s.autoQuality !== undefined ? !!s.autoQuality : true;
    out.settings.mouseSensitivity = num(s.mouseSensitivity, 1, 0.1, 4);
    out.settings.padSensitivity = num(s.padSensitivity, 1, 0.1, 4);
    out.settings.invertY = !!s.invertY;
    out.settings.masterVolume = num(s.masterVolume, 0.8, 0, 1);
    out.settings.musicVolume = num(s.musicVolume, 0.55, 0, 1);
    out.settings.sfxVolume = num(s.sfxVolume, 0.9, 0, 1);
    out.settings.cameraShake = num(s.cameraShake, 1, 0, 1.5);
    out.settings.showFps = !!s.showFps;
    out.settings.subtitles = s.subtitles !== undefined ? !!s.subtitles : true;
  }
  if (raw.stats && typeof raw.stats === 'object') for (const k of Object.keys(d.stats) as (keyof LifetimeStats)[]) out.stats[k] = Math.floor(num(raw.stats[k], 0, 0));
  out.tutorialDone = !!raw.tutorialDone;
  out.newGame = raw.newGame !== undefined ? !!raw.newGame : false;
  out.version = SAVE_VERSION;
  return out;
}

/** Version migrations (raw JSON → raw JSON of the next version). */
function migrate(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  let v = typeof raw.version === 'number' ? raw.version : 1;
  if (v < 2) {
    // v1 stored attributes under "stats" and had no look
    if (raw.stats && raw.stats.power !== undefined && !raw.attributes) {
      raw.attributes = raw.stats;
      raw.stats = undefined;
    }
    v = 2;
  }
  raw.version = v;
  return raw;
}

export type LoadStatus = 'ok' | 'new' | 'recovered' | 'corrupt' | 'unavailable';

/**
 * localStorage persistence with checksum validation, a rolling backup slot,
 * schema sanitising and migrations. Never throws: worst case falls back to a
 * fresh profile and reports the status so the UI can tell the player.
 */
export class SaveSystem {
  data: SaveData;
  status: LoadStatus = 'new';
  private store = storage();
  private dirty = false;
  private timer: number | null = null;

  constructor() {
    this.data = this.load();
  }

  private readSlot(key: string): SaveData | null {
    if (!this.store) return null;
    const txt = this.store.getItem(key);
    if (!txt) return null;
    const env = JSON.parse(txt);
    if (!env || typeof env !== 'object' || typeof env.payload !== 'string') throw new Error('bad envelope');
    if (checksum(env.payload) !== env.sum) throw new Error('checksum mismatch');
    return sanitize(migrate(JSON.parse(env.payload)));
  }

  load(): SaveData {
    if (!this.store) {
      this.status = 'unavailable';
      return defaultSave();
    }
    try {
      const d = this.readSlot(KEY);
      if (d) {
        this.status = 'ok';
        return d;
      }
      this.status = 'new';
      return defaultSave();
    } catch (e) {
      console.warn('[save] primary slot unreadable, trying backup', e);
      try {
        const b = this.readSlot(BACKUP_KEY);
        if (b) {
          this.status = 'recovered';
          return b;
        }
      } catch (e2) {
        console.warn('[save] backup unreadable', e2);
      }
      this.status = 'corrupt';
      return defaultSave();
    }
  }

  /** Debounced write. */
  save(immediate = false) {
    this.dirty = true;
    if (immediate) {
      this.flush();
      return;
    }
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || !this.store) return;
    this.dirty = false;
    this.data.updated = Date.now();
    const payload = JSON.stringify(this.data);
    const env = JSON.stringify({ sum: checksum(payload), payload });
    try {
      const prev = this.store.getItem(KEY);
      if (prev) this.store.setItem(BACKUP_KEY, prev);
      this.store.setItem(KEY, env);
    } catch (e) {
      console.warn('[save] write failed', e);
    }
  }

  reset() {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save(true);
  }

  get hasProgress() {
    return this.status !== 'new' && (!this.data.newGame || this.data.tutorialDone || Object.keys(this.data.campaign.completed).length > 0);
  }

  exportString() {
    return btoa(unescape(encodeURIComponent(JSON.stringify(this.data))));
  }
}
