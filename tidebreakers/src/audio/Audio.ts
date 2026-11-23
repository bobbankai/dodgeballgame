// All audio is synthesised with WebAudio: a small instrument set (pluck, piano, pad, strings, brass,
// flute, bells, choir, bass, drums), a generative score per mood built around one leitmotif (Seren's
// lullaby, "The Song Beneath the Sea"), procedural combat sounds, ambiences and dialogue babble.
import type { Vector3 } from '@babylonjs/core';

type Mood = 'none' | 'title' | 'island' | 'battle' | 'boss' | 'sad' | 'tension' | 'storm' | 'triumph' | 'lullaby' | 'market' | 'mine' | 'citadel';

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// Seren's lullaby (MIDI notes, beats)
const MOTIF: [number, number][] = [[69, 1], [72, 1], [76, 2], [74, 1], [72, 1], [69, 2], [67, 1], [69, 1], [72, 1.5], [71, 0.5], [69, 3]];

interface MoodDef { bpm: number; key: number; scale: number[]; prog: number[][]; drums: number; pad: string; lead: string; motif: number; bass: boolean; perc: string }

const MAJ = [0, 2, 4, 5, 7, 9, 11];
const MIN = [0, 2, 3, 5, 7, 8, 10];
const MOODS: Record<Exclude<Mood, 'none'>, MoodDef> = {
  title: { bpm: 84, key: 62, scale: MAJ, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], drums: 0, pad: 'strings', lead: 'flute', motif: 0.6, bass: true, perc: 'none' },
  island: { bpm: 100, key: 62, scale: MAJ, prog: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]], drums: 1, pad: 'pad', lead: 'pluck', motif: 0.25, bass: true, perc: 'shaker' },
  market: { bpm: 92, key: 57, scale: MAJ, prog: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], drums: 1, pad: 'pad', lead: 'pluck', motif: 0.2, bass: true, perc: 'shaker' },
  battle: { bpm: 146, key: 64, scale: MIN, prog: [[0, 3, 7], [8, 12, 15], [5, 8, 12], [7, 10, 14]], drums: 3, pad: 'strings', lead: 'brass', motif: 0.15, bass: true, perc: 'taiko' },
  boss: { bpm: 156, key: 62, scale: MIN, prog: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [10, 14, 17]], drums: 4, pad: 'choir', lead: 'brass', motif: 0.2, bass: true, perc: 'taiko' },
  sad: { bpm: 62, key: 57, scale: MIN, prog: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], drums: 0, pad: 'strings', lead: 'piano', motif: 0.55, bass: true, perc: 'none' },
  lullaby: { bpm: 70, key: 57, scale: MIN, prog: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [7, 10, 14]], drums: 0, pad: 'pad', lead: 'bells', motif: 1, bass: false, perc: 'none' },
  tension: { bpm: 90, key: 59, scale: MIN, prog: [[0, 3, 7], [1, 4, 8], [0, 3, 6], [0, 3, 7]], drums: 2, pad: 'pad', lead: 'none', motif: 0, bass: true, perc: 'heart' },
  storm: { bpm: 120, key: 60, scale: MIN, prog: [[0, 3, 7], [8, 12, 15], [10, 14, 17], [7, 11, 14]], drums: 3, pad: 'choir', lead: 'strings', motif: 0.2, bass: true, perc: 'taiko' },
  triumph: { bpm: 112, key: 62, scale: MAJ, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], drums: 2, pad: 'strings', lead: 'brass', motif: 0.5, bass: true, perc: 'snare' },
  mine: { bpm: 104, key: 61, scale: MIN, prog: [[0, 3, 7], [5, 8, 12], [8, 12, 15], [7, 10, 14]], drums: 2, pad: 'pad', lead: 'pluck', motif: 0.1, bass: true, perc: 'anvil' },
  citadel: { bpm: 96, key: 60, scale: MIN, prog: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [7, 11, 14]], drums: 1, pad: 'choir', lead: 'bells', motif: 0.35, bass: true, perc: 'none' },
};

const VOICES: Record<string, { pitch: number; spread: number; vowel: number }> = {
  KAI: { pitch: 210, spread: 60, vowel: 0.9 }, INES: { pitch: 250, spread: 40, vowel: 0.6 }, MIRA: { pitch: 300, spread: 70, vowel: 1.1 },
  BRAM: { pitch: 120, spread: 30, vowel: 0.7 }, NELL: { pitch: 380, spread: 90, vowel: 1.2 }, HALVARD: { pitch: 140, spread: 25, vowel: 0.75 },
  GORRICK: { pitch: 105, spread: 40, vowel: 0.6 }, VALE: { pitch: 150, spread: 20, vowel: 0.8 }, HANA: { pitch: 280, spread: 40, vowel: 1.0 },
  TEO: { pitch: 360, spread: 60, vowel: 1.2 }, SEREN: { pitch: 270, spread: 30, vowel: 0.9 },
};

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  mood: Mood = 'none';
  private next = 0;
  private beat = 0;
  timer: number | null = null;
  private ambNodes: AudioNode[] = [];
  volume = { master: 0.85, music: 0.55, sfx: 0.9 };
  listener: Vector3 | null = null;
  enabled = true;

  start(): void {
    if (this.ctx || !this.enabled) return;
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.4);
    const rv = ctx.createGain(); rv.gain.value = 0.32;
    this.reverb.connect(rv).connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.volume.music;
    this.musicBus.connect(this.master); this.musicBus.connect(this.reverb);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.volume.sfx;
    this.sfxBus.connect(this.master);
    const sr = ctx.createGain(); sr.gain.value = 0.15; this.sfxBus.connect(sr).connect(this.reverb);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.5; this.ambBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.timer = window.setInterval(() => this.schedule(), 30);
  }

  private impulse(sec: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  setVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volume.master;
    this.musicBus.gain.value = this.volume.music;
    this.sfxBus.gain.value = this.volume.sfx;
  }

  // ------------------------------------------------------------------------------------------ music
  play(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (!this.ctx) return;
    const g = this.musicBus.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0001, t + 0.6);
    g.linearRampToValueAtTime(this.volume.music, t + 1.4);
    this.next = t + 0.7;
    this.beat = 0;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.mood === 'none') return;
    const m = MOODS[this.mood];
    const spb = 60 / m.bpm;
    while (this.next < ctx.currentTime + 0.15) {
      this.playBeat(m, this.beat, this.next, spb);
      this.next += spb / 2;   // eighth notes
      this.beat++;
    }
  }

  private playBeat(m: MoodDef, b: number, t: number, spb: number): void {
    const bar = Math.floor(b / 8);
    const step = b % 8;
    const chord = m.prog[bar % m.prog.length];
    const root = m.key;
    // pad / strings on the bar
    if (step === 0) {
      for (const c of chord) this.voice(m.pad, NOTE(root + c - 12), t, spb * 4, 0.05);
      if (m.bass) this.voice('bass', NOTE(root + chord[0] - 24), t, spb * 1.8, 0.14);
    }
    if (m.bass && step === 4) this.voice('bass', NOTE(root + chord[(bar % 2) ? 2 : 0] - 24), t, spb * 1.5, 0.11);
    // drums
    if (m.drums > 0) {
      if (m.drums >= 3) { if (step % 4 === 0 || (step === 6 && bar % 2)) this.drum('kick', t); if (step === 4) this.drum('snare', t); this.drum('hat', t, step % 2 ? 0.25 : 0.45); }
      else if (m.drums === 2) { if (step === 0 || step === 5) this.drum('kick', t); if (step === 4) this.drum('snare', t, 0.6); }
      else if (step % 4 === 0) this.drum('soft', t);
      if (m.perc === 'taiko' && (step === 0 || step === 3 || step === 6)) this.drum('taiko', t, 0.7);
      if (m.perc === 'shaker') this.drum('shaker', t, step % 2 ? 0.2 : 0.35);
      if (m.perc === 'heart' && (step === 0 || step === 1)) this.drum('kick', t, 0.5);
      if (m.perc === 'anvil' && step === 2 && bar % 2 === 0) this.voice('bells', NOTE(root + 24), t, 0.3, 0.05);
    }
    // arpeggio / pluck accompaniment
    if (m.lead === 'pluck' || this.mood === 'title' || this.mood === 'lullaby' || this.mood === 'sad') {
      const arp = chord[[0, 1, 2, 1, 0, 2, 1, 2][step]] + 12;
      this.voice(this.mood === 'sad' ? 'piano' : this.mood === 'lullaby' ? 'harp' : 'pluck', NOTE(root + arp), t, spb, 0.07);
    }
    // melody: the leitmotif every few bars, else a generated line
    const phraseBar = bar % 8;
    if (m.motif > 0 && phraseBar < 4 && (bar % 16 < 8 || m.motif >= 0.5)) {
      let acc = 0;
      const beatPos = (phraseBar * 8 + step) / 2;
      for (const [n, d] of MOTIF) {
        if (Math.abs(acc - beatPos) < 1e-3) this.voice(m.lead === 'none' ? 'flute' : m.lead, NOTE(n - 69 + root + 12), t, d * spb * 0.95, 0.09);
        acc += d;
      }
    } else if (m.lead !== 'none' && m.lead !== 'pluck' && step % 2 === 0 && this.hash(b) < 0.55) {
      const deg = Math.floor(this.hash(b * 7 + 3) * 7);
      const n = root + 12 + m.scale[deg] + (this.hash(b * 13) < 0.3 ? 12 : 0);
      this.voice(m.lead, NOTE(n), t, spb * (this.hash(b + 9) < 0.5 ? 1 : 2) * 0.9, 0.06);
    }
  }

  private hash(n: number): number { const x = Math.sin(n * 12.9898 + this.mood.length * 7.1) * 43758.5453; return x - Math.floor(x); }

  private env(g: GainNode, t: number, a: number, peak: number, dur: number, rel: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(peak * 0.6, t + a, dur * 0.4);
    g.gain.setTargetAtTime(0.0001, t + dur, rel);
  }

  voice(kind: string, f: number, t: number, dur: number, vol: number, bus: AudioNode = this.musicBus): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = ctx.createGain();
    g.connect(bus);
    const stop = t + dur + 1.5;
    const osc = (type: OscillatorType, freq: number, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune; o.start(t); o.stop(stop); return o; };
    const lp = (fq: number, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = fq; b.Q.value = q; return b; };
    switch (kind) {
      case 'pluck': case 'harp': {
        const o = osc(kind === 'harp' ? 'triangle' : 'sawtooth', f); const fl = lp(f * 4);
        fl.frequency.setValueAtTime(f * 8, t); fl.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.3);
        o.connect(fl).connect(g); this.env(g, t, 0.004, vol, 0.05, kind === 'harp' ? 0.5 : 0.18); break;
      }
      case 'piano': {
        for (const [h, a] of [[1, 1], [2, 0.35], [3, 0.15], [4, 0.08]]) { const o = osc('sine', f * h); const gg = ctx.createGain(); gg.gain.value = a; o.connect(gg).connect(g); }
        this.env(g, t, 0.005, vol, 0.1, 0.9); break;
      }
      case 'pad': case 'strings': case 'choir': {
        const fl = lp(kind === 'choir' ? 1600 : kind === 'strings' ? 2200 : 900, kind === 'choir' ? 4 : 0.7);
        for (const dt of [-9, 0, 8]) osc(kind === 'choir' ? 'triangle' : 'sawtooth', f, dt).connect(fl);
        fl.connect(g);
        const a = kind === 'strings' ? 0.25 : 0.6;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.setTargetAtTime(0.0001, t + dur, 0.6); break;
      }
      case 'brass': {
        const fl = lp(400, 2); fl.frequency.setValueAtTime(400, t); fl.frequency.linearRampToValueAtTime(f * 5, t + 0.08);
        osc('sawtooth', f).connect(fl); osc('sawtooth', f, 7).connect(fl); fl.connect(g); this.env(g, t, 0.04, vol, dur, 0.15); break;
      }
      case 'flute': {
        const o = osc('sine', f); const v = ctx.createOscillator(); v.frequency.value = 5; const vg = ctx.createGain(); vg.gain.value = f * 0.01; v.connect(vg).connect(o.frequency); v.start(t); v.stop(stop);
        o.connect(g); this.env(g, t, 0.08, vol, dur, 0.2); break;
      }
      case 'bells': {
        for (const [h, a] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) { const o = osc('sine', f * h); const gg = ctx.createGain(); gg.gain.value = a; o.connect(gg).connect(g); }
        this.env(g, t, 0.002, vol, 0.05, 1.2); break;
      }
      case 'bass': {
        const fl = lp(f * 3); osc('triangle', f).connect(fl); osc('sine', f / 2).connect(fl); fl.connect(g); this.env(g, t, 0.01, vol, dur, 0.15); break;
      }
      default: return;
    }
  }

  private noise(t: number, dur: number, bus: AudioNode, filt: BiquadFilterType, f0: number, f1: number, vol: number, q = 1): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const b = ctx.createBiquadFilter(); b.type = filt; b.Q.value = q;
    b.frequency.setValueAtTime(f0, t); b.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(b).connect(g).connect(bus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  private tone(t: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine', bus: AudioNode = this.sfxBus): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }

  private drum(kind: string, t: number, vol = 1): void {
    const bus = this.musicBus;
    switch (kind) {
      case 'kick': this.tone(t, 140, 42, 0.22, 0.5 * vol, 'sine', bus); break;
      case 'soft': this.tone(t, 90, 50, 0.18, 0.18 * vol, 'sine', bus); break;
      case 'snare': this.noise(t, 0.16, bus, 'bandpass', 1800, 900, 0.3 * vol); this.tone(t, 220, 160, 0.08, 0.15 * vol, 'triangle', bus); break;
      case 'hat': this.noise(t, 0.04, bus, 'highpass', 8000, 9000, 0.12 * vol); break;
      case 'shaker': this.noise(t, 0.06, bus, 'bandpass', 6000, 5000, 0.1 * vol, 2); break;
      case 'taiko': this.tone(t, 110, 55, 0.4, 0.5 * vol, 'sine', bus); this.noise(t, 0.08, bus, 'lowpass', 600, 200, 0.2 * vol); break;
    }
  }

  // ------------------------------------------------------------------------------------------ sfx
  sfx(name: string, pos?: Vector3, vol = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    let v = vol;
    if (pos && this.listener) {
      const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      v *= Math.max(0.12, 1 - d / 40);
    }
    const t = ctx.currentTime + 0.005;
    const b = this.sfxBus;
    const r = () => 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'punch': this.noise(t, 0.09, b, 'lowpass', 2400 * r(), 300, 0.7 * v); this.tone(t, 150 * r(), 60, 0.12, 0.6 * v); break;
      case 'heavy_hit': case 'dash_hit': this.noise(t, 0.22, b, 'lowpass', 3500, 150, 0.9 * v); this.tone(t, 110, 38, 0.3, 0.9 * v); this.noise(t, 0.05, b, 'highpass', 4000, 6000, 0.3 * v); break;
      case 'whoosh_hit': this.noise(t, 0.16, b, 'bandpass', 900, 3000, 0.35 * v, 2); this.sfx('punch', pos, vol); break;
      case 'whoosh': this.noise(t, 0.14, b, 'bandpass', 600 * r(), 2600, 0.18 * v, 1.5); break;
      case 'dodge': this.noise(t, 0.2, b, 'bandpass', 400, 2200, 0.3 * v, 1.2); break;
      case 'jump': this.noise(t, 0.12, b, 'bandpass', 500, 1500, 0.2 * v); break;
      case 'land': this.tone(t, 90, 50, 0.1, 0.3 * v); this.noise(t, 0.08, b, 'lowpass', 900, 200, 0.25 * v); break;
      case 'thud': this.tone(t, 80, 35, 0.25, 0.6 * v); this.noise(t, 0.15, b, 'lowpass', 600, 100, 0.4 * v); break;
      case 'block': this.tone(t, 1400 * r(), 900, 0.12, 0.25 * v, 'triangle'); this.noise(t, 0.05, b, 'highpass', 3000, 5000, 0.3 * v); break;
      case 'parry': this.tone(t, 2600, 1900, 0.5, 0.25 * v, 'sine'); this.tone(t, 1300, 1250, 0.7, 0.2 * v, 'triangle'); this.noise(t, 0.25, b, 'bandpass', 1500, 6000, 0.3 * v, 2); break;
      case 'blade': case 'blade_heavy': this.noise(t, name === 'blade' ? 0.18 : 0.3, b, 'bandpass', 3000, 1200, 0.4 * v, 3); this.tone(t, 2400, 1800, 0.2, 0.08 * v, 'sawtooth'); break;
      case 'slam': this.tone(t, 70, 28, 0.6, 1.0 * v); this.noise(t, 0.5, b, 'lowpass', 1200, 60, 0.8 * v); break;
      case 'shot': this.noise(t, 0.12, b, 'highpass', 1500, 400, 0.6 * v); this.tone(t, 300, 80, 0.1, 0.4 * v, 'square'); break;
      case 'wind_blast': this.noise(t, 0.8, b, 'bandpass', 300, 2500, 0.8 * v, 0.8); this.tone(t, 200, 60, 0.6, 0.5 * v); break;
      case 'hurricane': case 'super_start': this.noise(t, 1.6, b, 'bandpass', 200, 3000, 0.8 * v, 0.6); this.tone(t, 120, 480, 1.4, 0.3 * v, 'sawtooth'); break;
      case 'charge': this.tone(t, 180, 720, 0.6, 0.15 * v, 'sawtooth'); this.noise(t, 0.6, b, 'bandpass', 400, 1800, 0.15 * v, 3); break;
      case 'splash': this.noise(t, 0.5, b, 'bandpass', 1200, 400, 0.6 * v, 0.6); break;
      case 'chain': for (let i = 0; i < 5; i++) this.tone(t + i * 0.04, 1800 + i * 200, 1600, 0.06, 0.15 * v, 'square'); break;
      case 'denied': this.tone(t, 300, 200, 0.15, 0.2 * v, 'square'); break;
      case 'ui': this.tone(t, 900, 1200, 0.06, 0.15 * v, 'triangle'); break;
      case 'confirm': this.tone(t, 660, 990, 0.12, 0.2 * v, 'triangle'); break;
      case 'thunder': this.noise(t, 2.5, b, 'lowpass', 900, 60, 1.0 * v, 0.5); this.tone(t, 60, 30, 2, 0.6 * v); break;
      case 'heal': for (let i = 0; i < 4; i++) this.tone(t + i * 0.07, 600 * (1 + i * 0.25), 650 * (1 + i * 0.25), 0.3, 0.12 * v, 'sine'); break;
      case 'roar': this.noise(t, 1.4, b, 'bandpass', 160, 500, 0.9 * v, 2); this.tone(t, 70, 45, 1.3, 0.6 * v, 'sawtooth'); break;
      case 'cannon': this.tone(t, 60, 25, 0.9, 1 * v); this.noise(t, 0.9, b, 'lowpass', 2000, 80, 0.9 * v); break;
    }
  }

  /** Dialogue babble: a short vowel-like blip in the speaker's voice. */
  blip(speaker: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const vdef = VOICES[speaker.toUpperCase()] ?? { pitch: 220, spread: 50, vowel: 1 };
    const t = ctx.currentTime;
    const f = vdef.pitch + (Math.random() - 0.5) * vdef.spread;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (0.9 + Math.random() * 0.2), t + 0.07);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 700 * vdef.vowel + Math.random() * 400; f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1800 * vdef.vowel + Math.random() * 600; f2.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.1);
  }

  // ------------------------------------------------------------------------------------------ ambience
  ambience(kind: 'sea' | 'wind' | 'rain' | 'cave' | 'none'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const n of this.ambNodes) { try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* */ } n.disconnect(); }
    this.ambNodes = [];
    if (kind === 'none') return;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const lfo = ctx.createOscillator(); const lg = ctx.createGain();
    if (kind === 'sea') { f.type = 'lowpass'; f.frequency.value = 700; g.gain.value = 0.35; lfo.frequency.value = 0.12; lg.gain.value = 0.25; }
    else if (kind === 'wind') { f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.8; g.gain.value = 0.25; lfo.frequency.value = 0.08; lg.gain.value = 0.18; }
    else if (kind === 'rain') { f.type = 'highpass'; f.frequency.value = 1500; g.gain.value = 0.3; lfo.frequency.value = 0.3; lg.gain.value = 0.05; }
    else { f.type = 'lowpass'; f.frequency.value = 300; g.gain.value = 0.2; lfo.frequency.value = 0.05; lg.gain.value = 0.08; }
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(this.ambBus);
    src.start(); lfo.start();
    this.ambNodes.push(src, lfo, f, g, lg);
    if (kind === 'sea') {
      // gulls now and then
      const gull = () => { if (!this.ambNodes.length) return; const t = ctx.currentTime; this.tone(t, 1800, 1100, 0.25, 0.05, 'sine', this.ambBus); this.tone(t + 0.3, 1900, 1200, 0.2, 0.04, 'sine', this.ambBus); };
      const id = window.setInterval(gull, 7000);
      this.ambNodes.push({ disconnect: () => clearInterval(id) } as unknown as AudioNode);
    }
  }
}
