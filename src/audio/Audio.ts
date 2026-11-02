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

/** Each speaker's voice: pitch, how bright (formants scaled), the waveform, loudness, syllable length. */
const VOICES: Record<string, { f0: number; formant: number; wave: OscillatorType; vol: number; len: number }> = {
  Ada: { f0: 290, formant: 1.08, wave: 'sawtooth', vol: 0.1, len: 0.1 },
  Pip: { f0: 450, formant: 1.25, wave: 'square', vol: 0.07, len: 0.075 },
  Mum: { f0: 215, formant: 0.95, wave: 'sawtooth', vol: 0.085, len: 0.12 },
  Keeper: { f0: 118, formant: 0.82, wave: 'sawtooth', vol: 0.1, len: 0.14 },
};
/** How a feeling bends a voice: pitch (semitones), glide through a syllable, pace, loudness, wobble. */
const MOODS: Record<string, { semis: number; glide: number; speed: number; vol: number; jitter: number }> = {
  neutral: { semis: 0, glide: 0, speed: 1, vol: 1, jitter: 0.8 },
  happy: { semis: 2, glide: 0.5, speed: 1.05, vol: 1.05, jitter: 1.2 },
  joy: { semis: 4, glide: 1, speed: 1.15, vol: 1.15, jitter: 1.8 },
  tender: { semis: -1, glide: -0.3, speed: 0.85, vol: 0.8, jitter: 0.5 },
  sad: { semis: -3, glide: -1, speed: 0.8, vol: 0.75, jitter: 0.4 },
  worried: { semis: 1, glide: 0.3, speed: 1.05, vol: 0.9, jitter: 1.2 },
  scared: { semis: 3, glide: 0.8, speed: 1.25, vol: 1.1, jitter: 2 },
  surprised: { semis: 4, glide: 2, speed: 1.1, vol: 1.1, jitter: 1 },
  wonder: { semis: 2, glide: 1, speed: 0.9, vol: 0.95, jitter: 0.8 },
  angry: { semis: -2, glide: -0.5, speed: 1.1, vol: 1.2, jitter: 1 },
  determined: { semis: -1, glide: 0, speed: 1, vol: 1.05, jitter: 0.6 },
  curious: { semis: 2, glide: 1.2, speed: 1, vol: 1, jitter: 1 },
};
/** The two lowest formants of each vowel (Hz): what makes an "a" sound like an "a". */
const FORMANTS: Record<string, [number, number]> = { a: [750, 1250], e: [450, 1900], i: [300, 2250], o: [470, 850], u: [330, 800], y: [300, 2100] };

/** A sound placed in the world (a stream, a windmill, the surf): move it, fade it, stop it. */
export interface Emitter {
  at(x: number, y: number, z: number): void;
  level(v: number): void;
  stop(): void;
}
export type EmitterKind = 'stream' | 'windmill' | 'surf' | 'chimes' | 'clock' | 'lapping';

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private voiceBus!: GainNode;
  private duckGain!: GainNode;
  private voiceT = -1;
  private mood = 'neutral';
  private listener = { x: 0, y: 0, z: 0 };
  private emitters = new Set<Emitter>();
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
  /** Called when a pigment chime plays (faces light up). */
  onPigment?: () => void;
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
    // the score dips a little while someone speaks
    this.duckGain = ctx.createGain();
    this.musicBus.connect(this.duckGain).connect(this.master);
    this.duckGain.connect(this.verbSend);
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 1;
    this.voiceBus.connect(this.master);
    const voiceVerb = ctx.createGain();
    voiceVerb.gain.value = 0.18;
    this.voiceBus.connect(voiceVerb).connect(this.verbSend);
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
        d[i] = lp * Math.pow(1 - t, decay) * Math.min(1, i / (ctx.sampleRate * 0.03));
      }
      // early reflections off nearby walls, a little different in each ear
      for (const [ms, g] of [[11, 0.5], [17, 0.38], [23, 0.3], [31, 0.24], [43, 0.16], [57, 0.1]]) {
        const k = Math.floor(ctx.sampleRate * (ms + c * 2.3) / 1000);
        if (k < n) d[k] += (Math.random() < 0.5 ? -1 : 1) * g;
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
    // low notes to the left, high to the right, as if sitting at the keyboard
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.6, Math.min(0.6, (m - 62) / 36));
    out.connect(lp).connect(pan).connect(bus ?? this.musicBus);
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

  /** A string section: each note four players slightly apart in tune and seat, bowing in slowly,
   * vibrato arriving a moment after the note, the tone opening as the bow digs in. */
  pad(notes: number[], t: number, dur: number, vol = 0.05, bright = 900) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(bright * 0.6, t);
    lp.frequency.linearRampToValueAtTime(bright * 1.3, t + Math.min(2, dur * 0.5));
    lp.frequency.linearRampToValueAtTime(bright * 0.8, t + dur + 0.8);
    // a gentle body resonance, like a wooden instrument
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 420;
    body.Q.value = 1.2;
    body.gain.value = 3;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(1.5, dur * 0.4));
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.8);
    lp.connect(body).connect(g).connect(this.musicBus);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.linearRampToValueAtTime(7, t + 0.9);
    vib.connect(vibDepth);
    vib.start(t);
    vib.stop(t + dur + 1);
    for (const m of notes) {
      [-9, -3, 4, 10].forEach((det, i) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det + (Math.random() - 0.5) * 4;
        vibDepth.connect(o.detune);
        const og = ctx.createGain();
        og.gain.value = 0.22;
        const pan = ctx.createStereoPanner();
        pan.pan.value = (i / 3 - 0.5) * 1.1;
        o.connect(og).connect(pan).connect(lp);
        o.start(t + Math.random() * 0.05);
        o.stop(t + dur + 1);
      });
    }
  }

  /** A wooden flute: a breathy sine with a touch of the octave, vibrato after the attack. */
  flute(m: number, t: number, dur: number, vol = 0.07) {
    const ctx = this.ctx!;
    const f = hz(m);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vol, t + 0.07);
    out.gain.setValueAtTime(vol * 0.9, t + Math.max(0.1, dur - 0.1));
    out.gain.linearRampToValueAtTime(0, t + dur + 0.15);
    const pan = ctx.createStereoPanner();
    pan.pan.value = 0.18;
    out.connect(pan).connect(this.musicBus);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.4;
    const vd = ctx.createGain();
    vd.gain.setValueAtTime(0, t);
    vd.gain.linearRampToValueAtTime(f * 0.006, t + 0.35);
    vib.connect(vd);
    [[1, 1], [2, 0.12], [3, 0.04]].forEach(([p, a]) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * p;
      vd.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.3);
    });
    vib.start(t);
    vib.stop(t + dur + 0.3);
    // breath: a little noise sitting on the note, stronger as it starts
    const b = this.noiseBurst(t, dur + 0.1, f * 2, 1.5, vol * 0.25, out);
    b.Q.value = 2;
  }

  /** A harp string: bright when plucked, ringing on, placed a little to the left. */
  harp(m: number, t: number, vol = 0.1) {
    const ctx = this.ctx!;
    const f = hz(m);
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.3 + (m % 7) * 0.08;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.6);
    lp.connect(pan).connect(this.musicBus);
    [[1, 1], [2, 0.35], [3, 0.12], [4, 0.06]].forEach(([p, a], i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * p;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * a, t + 0.004);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 2.2 / (1 + i * 0.7));
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + 2.4);
    });
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
        // every other time round in the village the flute takes the tune
        const onFlute = p === 'village' && Math.floor(this.bar / 16) % 2 === 1;
        for (const [n, beats] of THEME) {
          if (acc === idx) {
            if (onFlute) this.flute(midi(n) + 12, t, beats * spb * 0.95, 0.04);
            else this.piano(midi(n) + (p === 'attic' ? 12 : 0), t, p === 'attic' ? 0.32 : 0.5, beats * spb);
          }
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
      // the swell rolls on the piano, then on a harp
      if (Math.floor(this.bar / 4) % 2 === 0) this.piano(midi(c[roll[e]]) + 12, t, e === 0 || e === 3 ? 0.34 : 0.22, spb * 1.5);
      else this.harp(midi(c[roll[e]]) + 12, t, e === 0 || e === 3 ? 0.1 : 0.07);
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
      // rising arpeggio, on the harp
      for (let i = 0; i < 2; i++) this.harp(midi(c[1 + ((this.beat * 2 + i) % 4)]) + 12, t + i * spb * 0.5, 0.09);
      this.nextTime += spb;
      this.beat = (this.beat + 1) % 4;
      if (this.beat === 0) this.bar++;
      return;
    } else this.nextTime += 0.5;
    this.beat = (this.beat + 1) % 3;
    if (this.beat === 0) this.bar++;
  }

  // --- sound effects ---------------------------------------------------------------------------

  /** A step, sounding like what it lands on. */
  footstep(soft = 1, surface: string | null = 'grass') {
    if (!this.ctx) return;
    const t = this.now, ctx = this.ctx, r = Math.random;
    const thump = (f: number, len: number, vol: number) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.55, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * soft, t);
      g.gain.exponentialRampToValueAtTime(1e-4, t + len);
      o.connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + len + 0.02);
    };
    switch (surface) {
      case 'wood':
        // a hollow knock and the board's ring
        thump(150 + r() * 40, 0.09, 0.12);
        thump(380 + r() * 60, 0.05, 0.04);
        this.noiseBurst(t, 0.03, 1200, 2.5, 0.05 * soft);
        break;
      case 'stone':
        this.noiseBurst(t, 0.025, 3200 + r() * 800, 1.2, 0.07 * soft, undefined, 'highpass');
        thump(260 + r() * 40, 0.04, 0.05);
        break;
      case 'sand':
        // grains crunching
        for (let i = 0; i < 4; i++) this.noiseBurst(t + i * 0.014 + r() * 0.01, 0.02, 3500 + r() * 2000, 3, 0.03 * soft);
        thump(90, 0.06, 0.04);
        break;
      case 'paper':
        this.noiseBurst(t, 0.07, 4200 + r() * 1500, 0.6, 0.05 * soft);
        break;
      case 'water':
        this.noiseBurst(t, 0.2, 900 + r() * 400, 0.8, 0.09 * soft);
        break;
      default:
        // grass: a soft swish and a muffled footfall
        this.noiseBurst(t, 0.1, 2200 + r() * 900, 0.7, 0.05 * soft);
        thump(80, 0.07, 0.05);
    }
  }

  // --- voices ----------------------------------------------------------------------------------

  /** The feeling of the line being spoken: voices rise, fall, hurry or slow with it. */
  setMood(m: string) {
    this.mood = m;
  }

  /** One typed letter of a line: vowels are sung as little formant syllables in the speaker's voice. */
  voice(speaker: string, c: string) {
    if (!this.ctx) return;
    const v = VOICES[speaker];
    const t = this.now;
    if (!v) {
      if (/\S/.test(c)) this.noiseBurst(t, 0.025, 2000 + Math.random() * 400, 3, 0.025);
      return;
    }
    const md = MOODS[this.mood] ?? MOODS.neutral;
    const f = FORMANTS[c.toLowerCase()];
    if (!f) {
      // consonants: a soft breath or tick now and then
      if (/[a-z]/i.test(c) && Math.random() < 0.3) this.noiseBurst(t, 0.02, 2600 * v.formant, 2, v.vol * 0.3, this.voiceBus);
      return;
    }
    if (t - this.voiceT < (v.len * 0.8) / md.speed) return;
    this.voiceT = t;
    const ctx = this.ctx;
    const semis = md.semis + (Math.random() - 0.5) * 2 * md.jitter;
    const f0 = v.f0 * Math.pow(2, semis / 12);
    const dur = (v.len / md.speed) * (0.85 + Math.random() * 0.3);
    const o = ctx.createOscillator();
    o.type = v.wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * Math.pow(2, md.glide / 12), t + dur);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(v.vol * md.vol, t + 0.012);
    out.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.25);
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 3200 * v.formant;
    out.connect(warm).connect(this.voiceBus);
    ([[f[0], 5, 1], [f[1], 9, 0.6]] as [number, number, number][]).forEach(([fq, q, a]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq * v.formant;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = a * 2.2;
      o.connect(bp).connect(g).connect(out);
    });
    o.start(t);
    o.stop(t + dur + 0.3);
    // the score steps back while someone speaks
    const dg = this.duckGain.gain;
    dg.cancelScheduledValues(t);
    dg.setTargetAtTime(0.62, t, 0.04);
    dg.setTargetAtTime(1, t + 0.45, 0.4);
  }

  // --- sound in the world ----------------------------------------------------------------------

  /** Where the ears are (the camera): sounds placed in the world pan and fade around it. */
  listen(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) {
    this.listener.x = px;
    this.listener.y = py;
    this.listener.z = pz;
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      const t = this.now;
      L.positionX.setTargetAtTime(px, t, 0.03);
      L.positionY.setTargetAtTime(py, t, 0.03);
      L.positionZ.setTargetAtTime(pz, t, 0.03);
      L.forwardX.setTargetAtTime(fx, t, 0.03);
      L.forwardY.setTargetAtTime(fy, t, 0.03);
      L.forwardZ.setTargetAtTime(fz, t, 0.03);
      L.upX.setTargetAtTime(ux, t, 0.03);
      L.upY.setTargetAtTime(uy, t, 0.03);
      L.upZ.setTargetAtTime(uz, t, 0.03);
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  private panner(x: number, y: number, z: number, ref = 3) {
    return new PannerNode(this.ctx!, {
      panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1.1, maxDistance: 400,
      positionX: x, positionY: y, positionZ: z,
    });
  }

  private loopNoise(rate = 1) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(this.now, Math.random() * 1.5);
    return s;
  }

  /** A sound source in the world. Everything stops when the level changes (stopEmitters). */
  emitter(kind: EmitterKind, x = 0, y = 0, z = 0): Emitter {
    const dummy: Emitter = { at() {}, level() {}, stop() {} };
    if (!this.ctx) return dummy;
    const ctx = this.ctx;
    const r = Math.random;
    const pn = this.panner(x, y, z, kind === 'surf' ? 6 : kind === 'clock' || kind === 'lapping' ? 1.5 : 3);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, this.now, 1.2);
    pn.connect(out).connect(this.ambBus);
    const sources: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];
    const every = (lo: number, hi: number, fn: () => void) => {
      const go = () => {
        fn();
        timers.push(window.setTimeout(go, (lo + r() * (hi - lo)) * 1000));
      };
      timers.push(window.setTimeout(go, r() * hi * 1000));
    };
    if (kind === 'stream') {
      // running water: a band of noise that wavers, sparkle on top, little bubbles popping
      const n = this.loopNoise(0.9);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = 0.22;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.31;
      const lg = ctx.createGain();
      lg.gain.value = 0.07;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      n.connect(bp).connect(g).connect(pn);
      const n2 = this.loopNoise(1.3);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3800;
      const g2 = ctx.createGain();
      g2.gain.value = 0.05;
      n2.connect(hp).connect(g2).connect(pn);
      sources.push(n, n2, lfo);
      every(0.05, 0.16, () => {
        const t = this.now, o = ctx.createOscillator(), gg = ctx.createGain();
        const f = 320 + r() * 700;
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.04);
        gg.gain.setValueAtTime(0.025 + r() * 0.02, t);
        gg.gain.exponentialRampToValueAtTime(1e-4, t + 0.05);
        o.connect(gg).connect(pn);
        o.start(t);
        o.stop(t + 0.06);
      });
    } else if (kind === 'windmill') {
      // the sails sweeping past, and the old timber creaking as the cap turns
      const n = this.loopNoise(0.6);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 480;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.9;
      const lg = ctx.createGain();
      lg.gain.value = 0.045;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      n.connect(bp).connect(g).connect(pn);
      sources.push(n, lfo);
      every(2.2, 3.4, () => {
        const t = this.now;
        for (let k = 0; k < (r() < 0.4 ? 2 : 1); k++) {
          const s = t + k * 0.32, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), gg = ctx.createGain();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(70 + r() * 40, s);
          o.frequency.linearRampToValueAtTime(95 + r() * 50, s + 0.3);
          f.type = 'bandpass';
          f.frequency.value = 650 + r() * 300;
          f.Q.value = 4;
          gg.gain.setValueAtTime(0, s);
          gg.gain.linearRampToValueAtTime(0.09, s + 0.05);
          gg.gain.exponentialRampToValueAtTime(1e-4, s + 0.38);
          o.connect(f).connect(gg).connect(pn);
          o.start(s);
          o.stop(s + 0.42);
        }
      });
    } else if (kind === 'surf') {
      // the wash, and every few seconds a wave gathering, breaking, drawing back over the sand
      const n = this.loopNoise(0.7);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 800;
      const g = ctx.createGain();
      g.gain.value = 0.14;
      n.connect(lp).connect(g).connect(pn);
      sources.push(n);
      every(4.5, 8, () => {
        const t = this.now, s = this.loopNoise(0.8), f = ctx.createBiquadFilter(), gg = ctx.createGain();
        f.type = 'bandpass';
        f.Q.value = 0.6;
        f.frequency.setValueAtTime(350, t);
        f.frequency.linearRampToValueAtTime(1800, t + 1.6);
        f.frequency.exponentialRampToValueAtTime(500, t + 4.5);
        gg.gain.setValueAtTime(0, t);
        gg.gain.linearRampToValueAtTime(0.32, t + 1.6);
        gg.gain.setTargetAtTime(0.0001, t + 1.75, 1.1);
        s.connect(f).connect(gg).connect(pn);
        s.stop(t + 6);
      });
    } else if (kind === 'chimes') {
      const notes = [84, 86, 88, 91, 93, 96];
      every(1.5, 5, () => {
        const t = this.now;
        const k = 1 + Math.floor(r() * 3);
        for (let i = 0; i < k; i++) this.bell(notes[Math.floor(r() * notes.length)], t + i * (0.12 + r() * 0.2), 0.035, pn);
      });
    } else if (kind === 'clock') {
      let tick = false;
      every(0.5, 0.5, () => {
        tick = !tick;
        this.noiseBurst(this.now, 0.018, tick ? 3200 : 2400, 6, 0.06, pn);
      });
    } else if (kind === 'lapping') {
      // water slapping the hull
      every(0.35, 0.9, () => {
        const f = this.noiseBurst(this.now, 0.18 + r() * 0.12, 500 + r() * 300, 0.9, 0.08 + r() * 0.06, pn, 'lowpass');
        f.frequency.exponentialRampToValueAtTime(250, this.now + 0.2);
      });
    }
    const e: Emitter = {
      at: (px, py, pz) => {
        const t = this.now;
        pn.positionX.setTargetAtTime(px, t, 0.1);
        pn.positionY.setTargetAtTime(py, t, 0.1);
        pn.positionZ.setTargetAtTime(pz, t, 0.1);
      },
      level: (v) => out.gain.setTargetAtTime(v, this.now, 0.3),
      stop: () => {
        timers.forEach(clearTimeout);
        out.gain.setTargetAtTime(0, this.now, 0.4);
        window.setTimeout(() => sources.forEach((s) => s.stop()), 2500);
        this.emitters.delete(e);
      },
    };
    this.emitters.add(e);
    return e;
  }

  /** Silence every placed sound (a new level is loading). */
  stopEmitters() {
    for (const e of [...this.emitters]) e.stop();
  }

  /** A gull crying somewhere overhead. */
  private gull(dest: AudioNode) {
    const ctx = this.ctx!;
    const t = this.now;
    const L = this.listener;
    const pn = this.panner(L.x + (Math.random() - 0.5) * 60, L.y + 8 + Math.random() * 10, L.z + (Math.random() - 0.5) * 60, 8);
    pn.connect(dest);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.32 + Math.random() * 0.1);
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(1050, s);
      o.frequency.linearRampToValueAtTime(1500, s + 0.06);
      o.frequency.exponentialRampToValueAtTime(820, s + 0.26);
      f.type = 'bandpass';
      f.frequency.value = 1500;
      f.Q.value = 2.5;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.05, s + 0.04);
      g.gain.exponentialRampToValueAtTime(1e-4, s + 0.28);
      o.connect(f).connect(g).connect(pn);
      o.start(s);
      o.stop(s + 0.3);
    }
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
    this.onPigment?.();
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
      // the wind gusts: its strength and colour wander
      timers.push(window.setInterval(() => {
        const t = this.now;
        f.frequency.setTargetAtTime((kind === 'sea' ? 600 : 300) + Math.random() * 500, t, 1.2);
        g.gain.setTargetAtTime((kind === 'sea' ? 0.24 : 0.08) + Math.random() * (kind === 'sea' ? 0.14 : 0.1), t, 1.5);
      }, 2200));
      if (kind === 'meadow') timers.push(window.setInterval(() => Math.random() < 0.4 && this.bird(gain), 1300));
      if (kind === 'sea') timers.push(window.setInterval(() => Math.random() < 0.3 && this.gull(gain), 3000));
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

  /** A bird somewhere in the trees around: a chirp, a trill, or a two-note whistle. */
  private bird(dest: AudioNode) {
    const ctx = this.ctx!;
    const t = this.now;
    const L = this.listener;
    const pn = this.panner(L.x + (Math.random() - 0.5) * 50, L.y + 4 + Math.random() * 6, L.z + (Math.random() - 0.5) * 50, 5);
    pn.connect(dest);
    const kind = Math.random();
    const note = (s: number, f0: number, f1: number, len: number, vol: number) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f0, s);
      o.frequency.exponentialRampToValueAtTime(f1, s + len * 0.7);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + 0.01);
      g.gain.exponentialRampToValueAtTime(1e-4, s + len);
      o.connect(g).connect(pn);
      o.start(s);
      o.stop(s + len + 0.02);
    };
    const base = 2400 + Math.random() * 1800;
    if (kind < 0.5) {
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) note(t + i * (0.09 + Math.random() * 0.05), base, base * (1.3 + Math.random() * 0.4), 0.08, 0.03);
    } else if (kind < 0.8) {
      // a trill: quick alternating notes
      for (let i = 0; i < 10; i++) note(t + i * 0.045, i % 2 ? base : base * 1.18, i % 2 ? base * 1.05 : base * 1.22, 0.04, 0.022);
    } else {
      // a slow two-note whistle
      note(t, base * 0.6, base * 0.62, 0.3, 0.03);
      note(t + 0.38, base * 0.5, base * 0.47, 0.35, 0.028);
    }
  }

  dispose() {
    if (this.sched) clearInterval(this.sched);
    this.ctx?.close();
  }
}

export const audio = new Sound();
