/**
 * All sound is synthesised: a soft felt piano, pads, bells and plucks for the score, filtered noise
 * for pencils, paper, rain and wind. Music is generative around one recurring theme (Mum's lullaby).
 */

const NOTE: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

export function midi(name: string) {
  const m = /^([A-G][b#]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(name);
  return NOTE[m[1]] + (parseInt(m[2]) + 1) * 12;
}
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

type Piece = 'none' | 'attic' | 'village' | 'chase' | 'wonder' | 'title' | 'night' | 'sea' | 'storm';

interface Chord {
  root: string;
  notes: string[];
}

// Mum's lullaby, 3/4: [note, beats]
const THEME: [string, number][] = [
  ['C5', 2], ['A4', 1], ['F4', 2], ['G4', 1], ['A4', 1], ['Bb4', 1], ['C5', 1], ['G4', 3],
  ['C5', 2], ['A4', 1], ['F4', 2], ['D4', 1], ['E4', 1], ['G4', 1], ['Bb4', 1], ['F4', 3],
];
const THEME_CHORDS: Chord[] = [
  { root: 'F2', notes: ['F3', 'A3', 'C4'] }, { root: 'D2', notes: ['D3', 'F3', 'A3'] }, { root: 'Bb1', notes: ['Bb2', 'D3', 'F3'] },
  { root: 'C2', notes: ['C3', 'E3', 'G3'] }, { root: 'F2', notes: ['F3', 'A3', 'C4'] }, { root: 'D2', notes: ['D3', 'F3', 'A3'] },
  { root: 'C2', notes: ['C3', 'E3', 'Bb3'] }, { root: 'F2', notes: ['F3', 'A3', 'C4'] },
];

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private verb!: ConvolverNode;
  private verbSend!: GainNode;
  private noise!: AudioBuffer;
  private piece: Piece = 'none';
  private nextTime = 0;
  private bar = 0;
  private beat = 0;
  private sched: number | null = null;
  private scratch: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private smudge: { gain: GainNode; hi: GainNode; nodes: AudioNode[] } | null = null;
  private amb: { stop: () => void } | null = null;
  musicVolume = 0.55;
  sfxVolume = 0.8;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(3.2, 2.6);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.5;
    this.verbSend.connect(this.verb).connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.verbSend);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);
    const sfxVerb = ctx.createGain();
    sfxVerb.gain.value = 0.25;
    this.sfxBus.connect(sfxVerb).connect(this.verbSend);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.5;
    this.ambBus.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.sched = window.setInterval(() => this.schedule(), 90);
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        // darker as it decays, like a wooden room
        const t = i / n;
        lp += (Math.random() * 2 - 1 - lp) * (0.6 - 0.45 * t);
        d[i] = lp * Math.pow(1 - t, decay);
      }
    }
    return b;
  }

  get now() {
    return this.ctx?.currentTime ?? 0;
  }

  // --- instruments -----------------------------------------------------------------------------

  /** A soft felt piano: a few decaying partials through a gentle low-pass. */
  piano(m: number, t: number, vel = 0.5, dur = 1.5, bus?: AudioNode) {
    const ctx = this.ctx!;
    const f = hz(m);
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + 2600 * vel;
    lp.Q.value = 0.3;
    out.connect(lp).connect(bus ?? this.musicBus);
    const parts = [1, 2, 3, 4.01, 5.03, 6.05];
    const amps = [1, 0.38, 0.16, 0.08, 0.04, 0.02];
    const decay = Math.min(6, 2.2 + 400 / f);
    parts.forEach((p, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * p * (1 + (Math.random() - 0.5) * 0.0015);
      const g = ctx.createGain();
      const a = amps[i] * vel * 0.16;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.005);
      g.gain.exponentialRampToValueAtTime(a * 0.35, t + 0.08 + 0.1 / (i + 1));
      g.gain.exponentialRampToValueAtTime(1e-4, t + decay / (1 + i * 0.6));
      // release damper when the note ends
      g.gain.setTargetAtTime(1e-4, t + dur, 0.25);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + Math.min(decay, dur + 1.5) + 0.1);
    });
    // the felt hammer: a tiny noise thump
    this.noiseBurst(t, 0.03, 2200, 1.2, vel * 0.05, out);
  }

  pad(notes: number[], t: number, dur: number, vol = 0.05, bright = 900) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = bright;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(1.5, dur * 0.4));
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.8);
    lp.connect(g).connect(this.musicBus);
    for (const m of notes) {
      for (const det of [-6, 0, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.33;
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(t + dur + 1);
      }
    }
  }

  bell(m: number, t: number, vol = 0.12, bus?: AudioNode) {
    const ctx = this.ctx!;
    const f = hz(m);
    [1, 2.76, 5.4, 8.93].forEach((p, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * p;
      const g = ctx.createGain();
      const a = vol / (1 + i * 1.6);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.003);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 2.4 / (1 + i));
      o.connect(g).connect(bus ?? this.musicBus);
      o.start(t);
      o.stop(t + 2.6);
    });
  }

  pluck(m: number, t: number, vol = 0.12) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(m);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.7);
    o.connect(lp).connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.8);
  }

  private noiseBurst(t: number, dur: number, freq: number, q: number, vol: number, dest?: AudioNode, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    s.connect(f).connect(g).connect(dest ?? this.sfxBus);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return f;
  }

  // --- music -----------------------------------------------------------------------------------

  play(piece: Piece) {
    if (!this.ctx || piece === this.piece) {
      this.piece = piece;
      return;
    }
    const prev = this.musicBus.gain;
    const t = this.now;
    prev.cancelScheduledValues(t);
    prev.setValueAtTime(prev.value, t);
    prev.linearRampToValueAtTime(0.0001, t + 1.2);
    prev.linearRampToValueAtTime(this.musicVolume, t + 1.6);
    this.piece = piece;
    this.nextTime = t + 1.6;
    this.bar = 0;
    this.beat = 0;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || this.piece === 'none') return;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.35) {
      this.tick(this.nextTime);
    }
  }

  /** Schedule one beat of the current piece at time t and advance. */
  private tick(t: number) {
    const p = this.piece;
    const rnd = Math.random;
    if (p === 'village' || p === 'title' || p === 'attic' || p === 'night') {
      const bpm = p === 'village' ? 84 : p === 'title' ? 72 : 60;
      const spb = 60 / bpm;
      const chord = THEME_CHORDS[this.bar % 8];
      const themeBar = Math.floor(this.bar / 8) % 2 === 0 || p === 'title';
      if (this.beat === 0) {
        if (p !== 'attic') this.piano(midi(chord.root), t, 0.45, spb * 3);
        if (p === 'village' || p === 'title') this.pad(chord.notes.map(midi), t, spb * 3, p === 'title' ? 0.03 : 0.022, 700);
        if (p === 'attic' || p === 'night') this.piano(midi(chord.notes[0]) - 12, t, 0.3, spb * 3);
      }
      // waltz accompaniment
      if (this.beat > 0 && p === 'village') {
        for (const n of chord.notes.slice(this.beat === 1 ? 0 : 1)) this.piano(midi(n), t, 0.22, spb * 0.9);
      }
      // the melody: the theme every other phrase, gentle variations in between
      if (themeBar) {
        let acc = 0;
        const idx = (this.bar % 8) * 3 + this.beat;
        for (const [n, beats] of THEME) {
          if (acc === idx) this.piano(midi(n) + (p === 'attic' ? 12 : 0), t, p === 'attic' ? 0.32 : 0.5, beats * spb);
          acc += beats;
        }
      } else if (rnd() < (p === 'attic' ? 0.25 : 0.55)) {
        const pool = chord.notes.map(midi).map((m) => m + 12);
        this.piano(pool[Math.floor(rnd() * pool.length)] + (rnd() < 0.3 ? 2 : 0), t, 0.32, spb);
      }
      this.nextTime += spb;
    } else if (p === 'sea') {
      // a lilting 6/8 in D: rolling broken chords like swell, the theme a fifth up every other phrase
      const spb = 60 / 132;
      const prog = [['D2', 'D3', 'F#3', 'A3', 'D4'], ['B1', 'B2', 'D3', 'F#3', 'B3'], ['G1', 'G2', 'B2', 'D3', 'G3'], ['A1', 'A2', 'C#3', 'E3', 'A3']];
      const c = prog[Math.floor(this.bar / 2) % 4];
      const e = this.beat;
      if (e === 0) {
        this.piano(midi(c[0]), t, 0.5, spb * 6);
        this.pad(c.slice(2).map(midi), t, spb * 6, 0.02, 800);
      }
      const roll = [1, 2, 3, 4, 3, 2];
      this.piano(midi(c[roll[e]]) + 12, t, e === 0 || e === 3 ? 0.34 : 0.22, spb * 1.5);
      if (Math.floor(this.bar / 8) % 2 === 1 && (e === 0 || e === 3) && rnd() < 0.8) {
        const idx = (this.bar % 8) * 2 + (e === 3 ? 1 : 0);
        const [n] = THEME[idx % THEME.length];
        this.piano(midi(n) + 7, t, 0.42, spb * 2.5);
      }
      this.nextTime += spb;
      this.beat = (this.beat + 1) % 6;
      if (this.beat === 0) this.bar++;
      return;
    } else if (p === 'storm') {
      const spb = 60 / 144 / 2;
      const prog = [['D1', 'D2', 'A2', 'F3'], ['Bb0', 'Bb1', 'F2', 'D3'], ['C1', 'C2', 'G2', 'E3'], ['A0', 'A1', 'E2', 'C#3']];
      const c = prog[Math.floor(this.bar / 2) % 4];
      const e = this.beat;
      this.piano(midi(c[1]) + (e % 2 ? 12 : 0), t, e % 4 === 0 ? 0.66 : 0.42, spb * 0.8);
      if (e === 0) {
        this.piano(midi(c[0]), t, 0.7, spb * 8);
        this.pad([midi(c[2]), midi(c[3]), midi(c[3]) + 12], t, spb * 8, 0.04, 1000);
      }
      if (e % 2 === 1 && rnd() < 0.5) this.piano(midi(c[3]) + 12 + [0, 1, 3, 5][Math.floor(rnd() * 4)], t, 0.35, spb);
      if (e % 4 === 2) this.noiseBurst(t, 0.12, 300, 0.7, 0.08, this.musicBus);
      this.nextTime += spb;
      this.beat = (this.beat + 1) % 8;
      if (this.beat === 0) this.bar++;
      return;
    } else if (p === 'chase') {
      const spb = 60 / 138 / 2; // eighth notes
      const prog = [['A1', 'A2', 'E3', 'C4'], ['F1', 'F2', 'C3', 'A3'], ['G1', 'G2', 'D3', 'B3'], ['E1', 'E2', 'B2', 'G#3']];
      const c = prog[Math.floor(this.bar / 2) % 4];
      const e = this.beat;
      // driving low ostinato
      this.piano(midi(c[1]) + (e % 2 ? 12 : 0), t, e % 4 === 0 ? 0.62 : 0.4, spb * 0.8);
      if (e === 0) {
        this.piano(midi(c[0]), t, 0.6, spb * 8);
        this.pad([midi(c[2]), midi(c[3])], t, spb * 8, 0.03, 1400);
      }
      if (e % 2 === 1 && rnd() < 0.6) this.piano(midi(c[3]) + 12 + [0, 2, 3, 5][Math.floor(rnd() * 4)], t, 0.4, spb);
      if (e % 4 === 2) this.noiseBurst(t, 0.06, 4500, 1.5, 0.05, this.musicBus);
      this.nextTime += spb;
      this.beat = (this.beat + 1) % 8;
      if (this.beat === 0) this.bar++;
      return;
    } else if (p === 'wonder') {
      const spb = 60 / 66;
      const prog = [['F2', 'F3', 'A3', 'C4', 'F4'], ['A1', 'E3', 'A3', 'C4', 'E4'], ['Bb1', 'F3', 'Bb3', 'D4', 'F4'], ['C2', 'G3', 'C4', 'E4', 'G4']];
      const c = prog[this.bar % 4];
      if (this.beat === 0) {
        this.piano(midi(c[0]), t, 0.55, spb * 4);
        this.pad(c.slice(1).map(midi), t, spb * 4, 0.04, 1600);
        this.bell(midi(c[4]) + 12, t + spb * 2, 0.06);
      }
      // rising arpeggio
      for (let i = 0; i < 2; i++) this.piano(midi(c[1 + ((this.beat * 2 + i) % 4)]) + 12, t + i * spb * 0.5, 0.3, spb);
      this.nextTime += spb;
      this.beat = (this.beat + 1) % 4;
      if (this.beat === 0) this.bar++;
      return;
    } else this.nextTime += 0.5;
    this.beat = (this.beat + 1) % 3;
    if (this.beat === 0) this.bar++;
  }

  // --- sound effects ---------------------------------------------------------------------------

  footstep(soft = 1) {
    if (!this.ctx) return;
    this.noiseBurst(this.now, 0.07, 700 + Math.random() * 500, 1.4, 0.07 * soft);
  }

  jump() {
    if (!this.ctx) return;
    const f = this.noiseBurst(this.now, 0.25, 600, 1.2, 0.05);
    f.frequency.exponentialRampToValueAtTime(2200, this.now + 0.2);
  }

  land(k: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, this.now);
    o.frequency.exponentialRampToValueAtTime(45, this.now + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18 * k, this.now);
    g.gain.exponentialRampToValueAtTime(1e-4, this.now + 0.2);
    o.connect(g).connect(this.sfxBus);
    o.start();
    o.stop(this.now + 0.25);
    this.noiseBurst(this.now, 0.12, 500, 0.8, 0.1 * k);
  }

  /** The pencil scratching while Ada traces. */
  scratchOn(on: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.scratch) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200;
      bp.Q.value = 0.9;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 11;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.5;
      lfo.connect(lfoG).connect(am.gain);
      src.connect(bp).connect(am).connect(gain).connect(this.sfxBus);
      src.start();
      lfo.start();
      gain.gain.setTargetAtTime(0.12, this.now, 0.05);
      this.scratch = { src, gain, lfo };
    } else if (!on && this.scratch) {
      const s = this.scratch;
      s.gain.gain.setTargetAtTime(0, this.now, 0.05);
      s.src.stop(this.now + 0.3);
      s.lfo.stop(this.now + 0.3);
      this.scratch = null;
    }
  }

  /** Vary the scratch so it sounds like strokes, not a hiss. */
  scratchWiggle(v: number) {
    if (this.scratch) this.scratch.lfo.frequency.setTargetAtTime(7 + v * 10, this.now, 0.05);
  }

  /** Something drawn in ink comes to life. */
  inked() {
    if (!this.ctx) return;
    const t = this.now;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(130, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.3);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.35);
    [72, 76, 79, 84].forEach((m, i) => this.bell(m, t + 0.06 + i * 0.07, 0.07, this.sfxBus));
  }

  pigment() {
    if (!this.ctx) return;
    const t = this.now;
    [65, 69, 72, 77, 81, 84, 89].forEach((m, i) => this.bell(m, t + i * 0.11, 0.09, this.sfxBus));
  }

  pageTurn() {
    if (!this.ctx) return;
    const f = this.noiseBurst(this.now, 0.6, 400, 0.7, 0.16);
    f.frequency.exponentialRampToValueAtTime(3500, this.now + 0.45);
  }

  paper() {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) this.noiseBurst(this.now + i * 0.05, 0.1, 2500 + Math.random() * 2000, 1, 0.05);
  }

  thunder() {
    if (!this.ctx) return;
    const f = this.noiseBurst(this.now, 3.2, 180, 0.6, 0.5, undefined, 'lowpass');
    f.frequency.exponentialRampToValueAtTime(60, this.now + 3);
    this.noiseBurst(this.now + 0.05, 0.4, 900, 0.8, 0.12);
  }

  splash() {
    if (!this.ctx) return;
    const f = this.noiseBurst(this.now, 0.7, 2000, 0.5, 0.3, undefined, 'lowpass');
    f.frequency.exponentialRampToValueAtTime(300, this.now + 0.6);
  }

  /** A soft pencil tick per typed letter; each speaker has their own pitch. */
  type(speaker: string) {
    if (!this.ctx) return;
    const base = speaker === 'Pip' ? 3800 : speaker === 'Ada' ? 2600 : 2000;
    this.noiseBurst(this.now, 0.025, base + Math.random() * 400, 3, 0.025);
  }

  /** The Smudge: rumble plus frantic scribbling, louder as it closes in (0..1). */
  smudgeLevel(level: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (level > 0.01 && !this.smudge) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.sfxBus);
      const rum = ctx.createBufferSource();
      rum.buffer = this.noise;
      rum.loop = true;
      rum.playbackRate.value = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 140;
      const rg = ctx.createGain();
      rg.gain.value = 1.4;
      rum.connect(lp).connect(rg).connect(gain);
      const sc = ctx.createBufferSource();
      sc.buffer = this.noise;
      sc.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 1.2;
      const hi = ctx.createGain();
      hi.gain.value = 0.3;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 9;
      const lg = ctx.createGain();
      lg.gain.value = 0.3;
      lfo.connect(lg).connect(hi.gain);
      sc.connect(bp).connect(hi).connect(gain);
      rum.start();
      sc.start();
      lfo.start();
      this.smudge = { gain, hi, nodes: [rum, sc, lfo] };
    }
    if (this.smudge) {
      this.smudge.gain.gain.setTargetAtTime(level * 0.5, this.now, 0.15);
      if (level <= 0.01) {
        const s = this.smudge;
        this.smudge = null;
        window.setTimeout(() => s.nodes.forEach((n) => (n as AudioScheduledSourceNode).stop()), 800);
      }
    }
  }

  /** Background ambience: rain on a skylight, or wind and birds outdoors. */
  ambience(kind: 'none' | 'rain' | 'meadow' | 'sea') {
    if (!this.ctx) return;
    this.amb?.stop();
    this.amb = null;
    if (kind === 'none') return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, this.now, 1.5);
    gain.connect(this.ambBus);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const timers: number[] = [];
    if (kind === 'rain') {
      f.type = 'lowpass';
      f.frequency.value = 2600;
      g.gain.value = 0.16;
      timers.push(window.setInterval(() => this.noiseBurst(this.now + Math.random() * 0.2, 0.03, 3000 + Math.random() * 3000, 4, 0.03 + Math.random() * 0.03, gain), 120));
    } else {
      f.type = 'lowpass';
      f.frequency.value = kind === 'sea' ? 700 : 380;
      g.gain.value = kind === 'sea' ? 0.3 : 0.12;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = kind === 'sea' ? 0.12 : 0.07;
      const lg = ctx.createGain();
      lg.gain.value = kind === 'sea' ? 0.18 : 0.06;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      if (kind === 'meadow') timers.push(window.setInterval(() => Math.random() < 0.35 && this.bird(gain), 1400));
    }
    src.connect(f).connect(g).connect(gain);
    src.start();
    this.amb = {
      stop: () => {
        timers.forEach(clearInterval);
        gain.gain.setTargetAtTime(0, this.now, 0.6);
        src.stop(this.now + 3);
      },
    };
  }

  private bird(dest: AudioNode) {
    const ctx = this.ctx!;
    const t = this.now;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const s = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), s + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.02, s + 0.01);
      g.gain.exponentialRampToValueAtTime(1e-4, s + 0.08);
      o.connect(g).connect(dest);
      o.start(s);
      o.stop(s + 0.1);
    }
  }

  dispose() {
    if (this.sched) clearInterval(this.sched);
    this.ctx?.close();
  }
}

export const audio = new Sound();
