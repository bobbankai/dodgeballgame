import manifest from '../assets/voices/manifest.json';
import { audio } from './Audio';
import { lineKey } from './lineKey';

/** A recorded line (tools/voices): how long it is and how loud it is over time (40 steps a second). */
export interface Recording {
  key: string;
  speaker: string;
  duration: number;
  env: Float32Array;
  /** How far through the words the speech is at each envelope step (0..1): text follows the voice. */
  words: Float32Array;
}

const FPS = 40;
const URLS: Record<string, string> = {};
const files = import.meta.glob('../assets/voices/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
for (const [path, url] of Object.entries(files)) URLS[path.slice(path.lastIndexOf('/') + 1, -4)] = url;
const M = manifest as Record<string, { d: number; e: string }>;

/**
 * The cast's recorded voices: finds a line's recording, fetches and decodes it ahead of time,
 * plays it, and says how loud it is right now (for the mouth) and how far through the words it
 * has got (for the typewriter). Pauses with the game. Lines without a recording are left to the
 * babbling voice in Audio.
 */
class Speech {
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private cur: {
    rec: Recording;
    buf: AudioBuffer;
    play: ReturnType<typeof audio.playVoice> | null;
    startedAt: number;
    offset: number;
    done: boolean;
  } | null = null;
  private recs = new Map<string, Recording | null>();
  /** Bumped by every start and stop, so a line that arrives late doesn't talk over the next. */
  private token = 0;
  /** Off: everyone babbles instead (the pause menu switches it; remembered). */
  enabled = (() => {
    try {
      return localStorage.getItem('inkbound.voices') !== '0';
    } catch {
      return true;
    }
  })();

  find(speaker: string, text: string): Recording | null {
    const key = lineKey(speaker, text);
    let r = this.recs.get(key);
    if (r !== undefined) return r;
    const m = M[key];
    r = null;
    if (m && URLS[key]) {
      const env = new Float32Array(m.e.length);
      for (let i = 0; i < env.length; i++) env[i] = parseInt(m.e[i], 36) / 35;
      // the words move on while there is voice, and wait through the pauses between phrases
      const words = new Float32Array(env.length);
      let sum = 0;
      for (let i = 0; i < env.length; i++) {
        sum += env[i] > 0.12 ? 1 : 0.04;
        words[i] = sum;
      }
      for (let i = 0; i < env.length; i++) words[i] /= sum || 1;
      r = { key, speaker, duration: m.d, env, words };
    }
    this.recs.set(key, r);
    return r;
  }

  /** Fetch and decode a recording (once); null if it can't be had. */
  load(rec: Recording): Promise<AudioBuffer | null> {
    const ctx = audio.ctx;
    if (!ctx) return Promise.resolve(null);
    let p = this.buffers.get(rec.key);
    if (!p) {
      p = fetch(URLS[rec.key])
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => new Promise<AudioBuffer>((ok, fail) => ctx.decodeAudioData(b, ok, fail)))
        .catch(() => {
          this.buffers.delete(rec.key);
          return null;
        });
      this.buffers.set(rec.key, p);
    }
    return p;
  }

  /** Start fetching the recordings for some lines that are coming up. */
  prefetch(lines: [string, string][]) {
    if (!audio.ctx || !this.enabled) return;
    for (const [w, t] of lines) {
      const r = this.find(w, t);
      if (r) void this.load(r);
    }
  }

  /**
   * Play a line if it has a recording: resolves with it once it has started (waiting at most
   * `patience` seconds for it to arrive), or null if the line will have to be babbled.
   */
  async start(speaker: string, text: string, patience = 1.5): Promise<Recording | null> {
    this.stop();
    const token = this.token;
    // a context that isn't running (not yet allowed, or interrupted) would hold the words back
    if (!this.enabled || audio.ctx?.state !== 'running') return null;
    const rec = this.find(speaker, text);
    if (!rec) return null;
    const buf = await Promise.race([this.load(rec), new Promise<null>((ok) => setTimeout(() => ok(null), patience * 1000))]);
    if (!buf || !audio.ctx || token !== this.token) return null;
    this.cur = { rec, buf, play: null, startedAt: 0, offset: 0, done: false };
    this.resume();
    return rec;
  }

  /** Seconds into the line being spoken. */
  get position() {
    const c = this.cur;
    if (!c) return 0;
    if (!c.play) return c.offset;
    return Math.min(c.buf.duration, c.offset + audio.now - c.startedAt);
  }

  /** Something is being said right now. */
  get speaking() {
    return !!this.cur && !this.cur.done;
  }

  get speaker() {
    return this.cur?.rec.speaker ?? '';
  }

  /** How loud the voice is now (0..1): how far the mouth opens. */
  level() {
    const c = this.cur;
    if (!c || c.done || !c.play) return 0;
    const i = this.position * FPS;
    const a = Math.floor(i), env = c.rec.env;
    if (a >= env.length - 1) return 0;
    return env[a] + (env[a + 1] - env[a]) * (i - a);
  }

  /** How far through the line's words the voice is (0..1). */
  progress() {
    const c = this.cur;
    if (!c) return 1;
    if (c.done) return 1;
    const i = this.position * FPS, w = c.rec.words;
    const a = Math.min(w.length - 1, Math.floor(i));
    return a >= w.length - 1 ? 1 : w[a] + (w[a + 1] - w[a]) * (i - a);
  }

  /** Every frame: notices the end of a line. */
  update() {
    const c = this.cur;
    if (c && !c.done && c.play && this.position >= c.buf.duration - 0.01) c.done = true;
  }

  /** The game paused: hold the line where it is. */
  pause() {
    const c = this.cur;
    if (!c || !c.play || c.done) return;
    c.offset = this.position;
    c.play.stop(0.03);
    c.play = null;
  }

  resume() {
    const c = this.cur;
    if (!c || c.play || c.done || !audio.ctx) return;
    c.play = audio.playVoice(c.buf, c.offset, c.rec.speaker);
    c.startedAt = audio.now;
  }

  /** Stop talking (the line was moved on, or the scene ended). */
  stop() {
    this.token++;
    const c = this.cur;
    if (!c) return;
    c.play?.stop();
    this.cur = null;
  }
}

export const speech = new Speech();
