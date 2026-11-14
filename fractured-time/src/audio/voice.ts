import type { AudioEngine } from './engine';

/**
 * Recorded dialogue (tools/voices/record.py: Kokoro neural voices, one blend per character). Each line plays through its speaker's
 * treatment: comms are band-limited with a squelch at either end, HELIX SYSTEM is a facility PA (narrow band + a short metallic
 * slap), the Echo is Ethan's voice doubled by a slightly slower ghost of itself, memories sit far back in a soft room. Music ducks
 * under every line.
 */
type Fx = 'dry' | 'radio' | 'pa' | 'echo' | 'memory';
const FX: Record<string, Fx> = {
  'HELIX SYSTEM': 'pa', 'COMMANDER NYX': 'radio', 'HELIX TROOPER': 'radio', 'THE ECHO': 'echo', 'DIRECTOR VOSS': 'memory',
};

async function sha1(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

export class Voices {
  private manifest: Record<string, { who: string; text: string; dur: number }> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** per-scene overrides (Nyx in person in later chapters: 'dry') */
  fx: Record<string, Fx> = { ...FX };

  constructor(private a: AudioEngine, private base: string) {}

  async load(): Promise<void> {
    if (this.manifest) return;
    try {
      const r = await fetch(`${this.base}voices/manifest.json`);
      this.manifest = r.ok ? await r.json() : {};
    } catch { this.manifest = {}; }
  }

  /** Duration of a recorded line (seconds), or 0 if it has not been recorded yet. */
  async duration(who: string, text: string): Promise<number> {
    await this.load();
    return this.manifest![await sha1(`${who}|${text}`)]?.dur ?? 0;
  }

  private buffer(k: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(k);
    if (!p) {
      p = fetch(`${this.base}voices/${k}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => (ab && this.a.ctx ? this.a.ctx.decodeAudioData(ab) : null)).catch(() => null);
      this.buffers.set(k, p);
    }
    return p;
  }

  /** Play a line now (if recorded and the audio is running). Resolves with its duration (0 when silent). */
  async play(who: string, text: string): Promise<number> {
    await this.load();
    const k = await sha1(`${who}|${text}`);
    const m = this.manifest![k];
    if (!m || !this.a.ctx) return m?.dur ?? 0;
    const buf = await this.buffer(k);
    if (!buf) return m.dur;
    const ctx = this.a.ctx;
    const t = ctx.currentTime + 0.03;
    const fx = this.fx[who] ?? 'dry';
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let head: AudioNode = src;
    const chain = (n: AudioNode) => { head.connect(n); head = n; return n; };
    const bq = (type: BiquadFilterType, f: number, q = 0.7, gain = 0) => {
      const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return chain(b);
    };
    if (fx === 'radio' || fx === 'pa') {
      bq('highpass', fx === 'radio' ? 380 : 260);
      bq('lowpass', fx === 'radio' ? 3100 : 5200);
      bq('peaking', 1900, 1.2, fx === 'radio' ? 5 : 3);
      const ws = ctx.createWaveShaper();
      const c = new Float32Array(512);
      for (let i = 0; i < 512; i++) { const x = (i / 511) * 2 - 1; c[i] = Math.tanh(x * (fx === 'radio' ? 2.2 : 1.3)); }
      ws.curve = c;
      chain(ws);
    }
    const g = ctx.createGain();
    g.gain.value = fx === 'memory' ? 0.8 : 1;
    chain(g);
    g.connect(this.a.voice);
    const send = ctx.createGain();
    send.gain.value = { dry: 0.15, radio: 0.02, pa: 0.5, echo: 0.6, memory: 0.9 }[fx];
    g.connect(send).connect(this.a.verbIn);
    if (fx === 'pa') {
      // a short metallic slap: the voice off the facility walls
      const d = ctx.createDelay(0.2); d.delayTime.value = 0.045;
      const fb = ctx.createGain(); fb.gain.value = 0.3;
      g.connect(d).connect(fb).connect(d);
      fb.connect(this.a.voice);
    }
    if (fx === 'radio') {
      // squelch: a burst of band-limited static at either end of the transmission
      for (const at of [t - 0.02, t + buf.duration + 0.02]) {
        const n = ctx.createBufferSource(); n.buffer = this.a.noise();
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.8;
        const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, at); ng.gain.linearRampToValueAtTime(0.12, at + 0.01);
        ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
        n.connect(f).connect(ng).connect(this.a.voice); n.start(at, Math.random()); n.stop(at + 0.1);
      }
    }
    if (fx === 'echo') {
      // the ghost: the same take, a little slower and later, panned off-centre
      const s2 = ctx.createBufferSource(); s2.buffer = buf; s2.playbackRate.value = 0.985;
      const p = ctx.createStereoPanner(); p.pan.value = 0.35;
      const g2 = ctx.createGain(); g2.gain.value = 0.42;
      s2.connect(p).connect(g2).connect(this.a.voice);
      g2.connect(this.a.verbIn);
      s2.start(t + 0.022);
    }
    src.start(t);
    // duck the score under the line
    this.a.music.gain.setTargetAtTime(0.2, t - 0.02, 0.08);
    this.a.music.gain.setTargetAtTime(0.42, t + buf.duration + 0.2, 0.5);
    return m.dur;
  }
}
