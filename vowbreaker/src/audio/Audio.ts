import type { Vector3 } from '@babylonjs/core';

export type Mood = 'none' | 'title' | 'calm' | 'tense' | 'battle' | 'boss' | 'sad' | 'festival' | 'domain' | 'memory' | 'finale';

// Japanese "in" scale (miyako-bushi) and natural minor, as semitone offsets
const IN_SCALE = [0, 1, 5, 7, 8, 12, 13, 17, 19, 20, 24];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24];
const MOODS: Record<Mood, { bpm: number; root: number; scale: number[]; drums: number; pad: number; pluck: number; piano: number; flute: number; bells: number; chords?: number[][] }> = {
  none: { bpm: 80, root: 57, scale: MINOR, drums: 0, pad: 0, pluck: 0, piano: 0, flute: 0, bells: 0 },
  title: { bpm: 70, root: 52, scale: IN_SCALE, drums: 0.2, pad: 0.7, pluck: 0.4, piano: 0, flute: 0.5, bells: 0.4 },
  calm: { bpm: 76, root: 57, scale: MINOR, drums: 0, pad: 0.5, pluck: 0.5, piano: 0.5, flute: 0.3, bells: 0.2, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]] },
  tense: { bpm: 92, root: 50, scale: IN_SCALE, drums: 0.45, pad: 0.6, pluck: 0.4, piano: 0, flute: 0.2, bells: 0.3 },
  battle: { bpm: 140, root: 50, scale: IN_SCALE, drums: 1, pad: 0.5, pluck: 0.9, piano: 0, flute: 0.3, bells: 0.2 },
  boss: { bpm: 150, root: 48, scale: IN_SCALE, drums: 1, pad: 0.8, pluck: 1, piano: 0, flute: 0.4, bells: 0.5 },
  sad: { bpm: 64, root: 57, scale: MINOR, drums: 0, pad: 0.6, pluck: 0, piano: 1, flute: 0.25, bells: 0.1, chords: [[0, 3, 7], [-4, 0, 3], [-9, -5, -2], [-2, 2, 5]] },
  festival: { bpm: 104, root: 55, scale: IN_SCALE, drums: 0.7, pad: 0.3, pluck: 0.7, piano: 0, flute: 0.8, bells: 0.6 },
  domain: { bpm: 120, root: 47, scale: IN_SCALE, drums: 0.6, pad: 1, pluck: 0.5, piano: 0, flute: 0, bells: 1 },
  memory: { bpm: 60, root: 59, scale: MINOR, drums: 0, pad: 0.8, pluck: 0, piano: 0.8, flute: 0, bells: 0.5, chords: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -2, 2]] },
  finale: { bpm: 156, root: 50, scale: MINOR, drums: 1, pad: 1, pluck: 1, piano: 0.3, flute: 0.5, bells: 0.7, chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-7, -3, 0]] },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Character voices: pitch (Hz) and formant brightness for the dialogue babble. */
export const VOICES: Record<string, { pitch: number; bright: number; speed: number }> = {
  itsuki: { pitch: 150, bright: 1.0, speed: 1.0 }, sayo: { pitch: 230, bright: 1.2, speed: 1.0 }, mikami: { pitch: 105, bright: 0.8, speed: 0.85 },
  sojin: { pitch: 90, bright: 0.7, speed: 0.8 }, ryoga: { pitch: 140, bright: 1.1, speed: 1.1 }, mio: { pitch: 320, bright: 1.4, speed: 1.15 },
  hina: { pitch: 340, bright: 1.4, speed: 1.15 }, kota: { pitch: 300, bright: 1.3, speed: 1.1 }, elder: { pitch: 110, bright: 0.7, speed: 0.8 },
  bride: { pitch: 200, bright: 0.6, speed: 0.6 }, curse: { pitch: 70, bright: 0.5, speed: 0.7 }, narrator: { pitch: 120, bright: 0.9, speed: 0.9 },
};

/**
 * Everything audible is synthesized here with WebAudio: impact and technique sounds, a generative
 * score per mood, rain and wind, and the characters' voice babble under subtitles.
 */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  enabled = true;
  musicVolume = 0.6;
  sfxVolume = 0.9;
  mood: Mood = 'none';
  private nextBeat = 0;
  private beat = 0;
  private bar = 0;
  private rain: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  listener: Vector3 | null = null;
  private duck = 1;

  /** Create the context on the first user gesture (browsers require it). */
  unlock(): void {
    if (this.ctx || !this.enabled) {
      void this.ctx?.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.5;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);
    const sfxVerb = ctx.createGain();
    sfxVerb.gain.value = 0.25;
    this.sfxBus.connect(sfxVerb).connect(this.reverb);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.5;
    this.ambBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextBeat = ctx.currentTime + 0.1;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (this.ctx) {
      this.musicBus.gain.value = music * 0.5 * this.duck;
      this.sfxBus.gain.value = sfx;
    }
  }

  // --- building blocks ---------------------------------------------------------------------------------

  private env(g: GainNode, t: number, a: number, peak: number, dec: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, gain: number, out: AudioNode, sweepTo?: number, detune = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    this.env(g, t, 0.005, gain, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseHit(t: number, dur: number, gain: number, freq: number, q: number, out: AudioNode, type: BiquadFilterType = 'bandpass', sweep?: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.003, gain, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  /** A struck bell: inharmonic partials with long decays (the Hollow Bell technique). */
  private bell(freq: number, t: number, gain: number, out: AudioNode, length = 3): void {
    const partials = [[1, 1], [2.0, 0.6], [2.76, 0.45], [5.4, 0.25], [8.93, 0.12], [0.5, 0.5]];
    for (const [r, a] of partials) this.osc('sine', freq * r, t, length * (r < 1 ? 1.4 : 1 / Math.sqrt(r)), gain * a, out);
    this.noiseHit(t, 0.05, gain * 0.5, freq * 4, 2, out);
  }

  private pluck(freq: number, t: number, gain: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 8, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.25);
    f.Q.value = 4;
    const g = ctx.createGain();
    this.env(g, t, 0.002, gain, 0.6);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.7);
  }

  private pianoNote(freq: number, t: number, gain: number, out: AudioNode, dur = 2.5): void {
    this.osc('triangle', freq, t, dur, gain * 0.6, out);
    this.osc('sine', freq * 2, t, dur * 0.6, gain * 0.25, out);
    this.osc('sine', freq * 3, t, dur * 0.3, gain * 0.1, out);
    this.noiseHit(t, 0.02, gain * 0.15, freq * 6, 1, out);
  }

  private flute(freq: number, t: number, dur: number, gain: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.12);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = ctx.createGain();
    lg.gain.value = freq * 0.012;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.15);
    g.gain.linearRampToValueAtTime(gain * 0.7, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
    this.noiseHit(t, dur * 0.8, gain * 0.15, freq * 2, 3, out);
  }

  private pad(freqs: number[], t: number, dur: number, gain: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(out);
    for (const fr of freqs) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  private drum(t: number, kind: 'taiko' | 'rim' | 'shime', gain: number, out: AudioNode): void {
    if (kind === 'taiko') {
      this.osc('sine', 95, t, 0.5, gain, out, 45);
      this.noiseHit(t, 0.12, gain * 0.5, 300, 1, out, 'lowpass');
    } else if (kind === 'shime') {
      this.osc('triangle', 320, t, 0.08, gain * 0.4, out, 240);
      this.noiseHit(t, 0.05, gain * 0.4, 2500, 2, out);
    } else {
      this.noiseHit(t, 0.03, gain * 0.5, 4000, 3, out);
    }
  }

  // --- music ----------------------------------------------------------------------------------------------

  setMood(m: Mood): void {
    this.mood = m;
  }

  /** Lower the music under dialogue. */
  setDuck(d: number): void {
    this.duck = d;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.5 * d, this.ctx.currentTime, 0.2);
  }

  private schedule(): void {
    const ctx = this.ctx!;
    const M = MOODS[this.mood];
    if (this.mood === 'none') {
      this.nextBeat = ctx.currentTime + 0.1;
      return;
    }
    const spb = 60 / M.bpm / 2; // eighth notes
    while (this.nextBeat < ctx.currentTime + 0.2) {
      const t = this.nextBeat;
      const b = this.beat % 16;
      const out = this.musicBus;
      // drums
      if (M.drums > 0) {
        if (b === 0 || b === 6 || b === 10 || (this.mood === 'boss' && b === 14)) this.drum(t, 'taiko', 0.7 * M.drums, out);
        if (M.drums > 0.5 && (b % 4 === 2)) this.drum(t, 'shime', 0.5 * M.drums, out);
        if (M.drums > 0.8 && b % 2 === 1 && Math.random() < 0.6) this.drum(t, 'rim', 0.3 * M.drums, out);
      }
      // chords / pad every bar
      if (b === 0) {
        const chord = M.chords ? M.chords[this.bar % M.chords.length] : [0, 7, 12];
        if (M.pad > 0) this.pad(chord.map((c) => midi(M.root - 12 + c)), t, spb * 16, 0.06 * M.pad, out);
        if (M.piano > 0) {
          const ch = chord.map((c) => midi(M.root + c));
          ch.forEach((f, i) => this.pianoNote(f, t + i * spb * 0.5, 0.18 * M.piano, out, 3));
        }
      }
      // melody: plucked koto lines on the scale, sparse flute phrases
      if (M.pluck > 0 && (b % 2 === 0 || (M.bpm > 120 && Math.random() < 0.4)) && Math.random() < 0.55 * M.pluck + 0.2) {
        const deg = M.scale[Math.floor(Math.random() * M.scale.length)];
        this.pluck(midi(M.root + deg), t, 0.2 * M.pluck, out);
      }
      if (M.piano > 0 && b % 4 === 2 && Math.random() < 0.5) {
        const deg = M.scale[Math.floor(Math.random() * Math.min(8, M.scale.length))];
        this.pianoNote(midi(M.root + 12 + deg), t, 0.12 * M.piano, out, 2);
      }
      if (M.flute > 0 && b === 8 && Math.random() < 0.5 * M.flute + 0.2) {
        const deg = M.scale[2 + Math.floor(Math.random() * 6)];
        this.flute(midi(M.root + 12 + deg), t, spb * 6, 0.1 * M.flute, out);
      }
      if (M.bells > 0 && b === 0 && this.bar % 2 === 0 && Math.random() < M.bells) {
        this.bell(midi(M.root + 24 + M.scale[Math.floor(Math.random() * 5)]), t, 0.06 * M.bells, out, 4);
      }
      this.nextBeat += spb;
      this.beat++;
      if (this.beat % 16 === 0) this.bar++;
    }
  }

  // --- ambience --------------------------------------------------------------------------------------------

  setRain(amount: number): void {
    if (!this.ctx) return;
    if (!this.rain) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.ambBus);
      s.start();
      this.rain = s;
      this.rainGain = g;
    }
    this.rainGain!.gain.setTargetAtTime(amount * 0.35, this.ctx.currentTime, 0.5);
  }

  setWind(amount: number): void {
    if (!this.ctx) return;
    if (!this.wind) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.12;
      const lg = this.ctx.createGain();
      lg.gain.value = 250;
      lfo.connect(lg).connect(f.frequency);
      lfo.start();
      const g = this.ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.ambBus);
      s.start();
      this.wind = s;
      this.windGain = g;
    }
    this.windGain!.gain.setTargetAtTime(amount * 0.5, this.ctx.currentTime, 0.8);
  }

  // --- sound effects ------------------------------------------------------------------------------------------

  sfx(name: string, _at?: Vector3, strength = 1): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.sfxBus;
    const s = strength;
    switch (name) {
      case 'punch':
      case 'hit':
        this.noiseHit(t, 0.08, 0.6 * s, 1200, 1.2, o);
        this.osc('sine', 160, t, 0.12, 0.5 * s, o, 60);
        break;
      case 'kick':
        this.noiseHit(t, 0.1, 0.6, 900, 1, o);
        this.osc('sine', 130, t, 0.16, 0.6, o, 50);
        break;
      case 'heavy':
      case 'heavyhit':
        this.noiseHit(t, 0.22, 0.8, 700, 0.8, o, 'lowpass', 120);
        this.osc('sine', 120, t, 0.35, 0.8, o, 35);
        this.noiseHit(t + 0.01, 0.06, 0.5, 3500, 2, o);
        break;
      case 'block':
        this.osc('square', 900, t, 0.06, 0.15, o, 600);
        this.noiseHit(t, 0.05, 0.4, 2500, 3, o);
        break;
      case 'parry':
        this.bell(1400, t, 0.15, o, 0.8);
        this.osc('sine', 2200, t, 0.3, 0.2, o, 3000);
        break;
      case 'whoosh':
        this.noiseHit(t, 0.16 * (0.6 + s * 0.4), 0.25 * s, 800, 0.7, o, 'bandpass', 2400);
        break;
      case 'dash':
        this.noiseHit(t, 0.2, 0.3, 500, 0.7, o, 'bandpass', 2000);
        break;
      case 'thud':
        this.osc('sine', 80, t, 0.3, 0.6, o, 40);
        this.noiseHit(t, 0.15, 0.4, 300, 1, o, 'lowpass');
        break;
      case 'bell':
        this.bell(523, t, 0.2, o, 2.5);
        break;
      case 'toll':
        this.bell(196, t, 0.3, o, 4);
        this.bell(392, t + 0.01, 0.12, o, 3);
        break;
      case 'blackspark':
        this.noiseHit(t, 0.5, 1.0, 200, 0.5, o, 'lowpass', 60);
        this.osc('sawtooth', 60, t, 0.5, 0.5, o, 30);
        for (let i = 0; i < 6; i++) this.noiseHit(t + i * 0.03, 0.04, 0.5, 5000, 4, o);
        break;
      case 'vow':
        this.osc('sawtooth', 55, t, 1.4, 0.4, o, 110);
        this.bell(110, t, 0.2, o, 3);
        break;
      case 'ko':
        this.noiseHit(t, 0.8, 0.9, 300, 0.5, o, 'lowpass', 50);
        this.bell(262, t + 0.1, 0.15, o, 3);
        break;
      case 'cast':
      case 'gravity':
        this.osc('sine', 220, t, 0.5, 0.25, o, name === 'gravity' ? 55 : 660);
        this.noiseHit(t, 0.4, 0.2, 1500, 2, o, 'bandpass', 400);
        break;
      case 'fire':
        this.noiseHit(t, 0.7, 0.5, 600, 0.6, o, 'lowpass', 200);
        break;
      case 'paper':
        for (let i = 0; i < 4; i++) this.noiseHit(t + i * 0.04, 0.05, 0.25, 4000, 2, o);
        break;
      case 'water':
      case 'still':
        this.osc('sine', 880, t, 0.6, 0.15, o, 440);
        this.bell(660, t, 0.06, o, 2);
        break;
      case 'slash':
        this.noiseHit(t, 0.15, 0.4, 3000, 1, o, 'bandpass', 6000);
        break;
      case 'claw':
        this.noiseHit(t, 0.12, 0.5, 1800, 2, o, 'bandpass', 600);
        break;
      case 'select':
        this.osc('triangle', 880, t, 0.08, 0.12, o);
        break;
      case 'confirm':
        this.bell(784, t, 0.1, o, 1.2);
        break;
      case 'page':
        this.noiseHit(t, 0.18, 0.2, 2500, 0.6, o, 'bandpass', 1200);
        break;
      default:
        this.noiseHit(t, 0.08, 0.3, 1000, 1, o);
    }
  }

  /** Dialogue babble: one formant blip per syllable, shaped by the speaker's voice. */
  voice(who: string, text: string, emotionPitch = 1): number {
    if (!this.ctx) return 0;
    const v = VOICES[who] ?? VOICES.narrator;
    const ctx = this.ctx;
    const syll = Math.max(1, Math.round(text.replace(/[^a-zA-Z]/g, '').length / 3));
    let t = ctx.currentTime + 0.02;
    const step = 0.085 / v.speed;
    for (let i = 0; i < Math.min(syll, 40); i++) {
      const f = v.pitch * emotionPitch * (0.92 + Math.random() * 0.16);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const fl = ctx.createBiquadFilter();
      fl.type = 'bandpass';
      fl.frequency.value = (600 + Math.random() * 1200) * v.bright;
      fl.Q.value = 3;
      const g = ctx.createGain();
      this.env(g, t, 0.01, 0.05, step * 0.9);
      o.connect(fl).connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + step + 0.05);
      t += step * (0.8 + Math.random() * 0.4);
    }
    return t - ctx.currentTime;
  }

  update(): void {
    if (!this.ctx) return;
    this.schedule();
  }
}
