import type { AudioEngine } from './engine';

/**
 * The adaptive score: dark synth in D minor, built from layers that cross-fade with the game's intensity.
 *   0 explore : slow pad chords (Dm9 - Bbmaj7 - Fmaj7/A - Csus2, 8 s each), a sub drone, sparse high plucks through a long delay
 *   1 combat  : + a 16th-note bass ostinato with a filter envelope, kick on the beat, ticking hats, a tremolo string cluster (110 bpm)
 *   2 boss    : + low toms, brass-like stabs on the bar, the pad opens up
 * Scheduled ahead on the audio clock (look-ahead scheduler), so timing never depends on frame rate.
 */
const MIDI = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// chords as MIDI notes (pad voicing) + their roots for the bass
const CHORDS: { pad: number[]; root: number }[] = [
  { pad: [50, 53, 57, 64], root: 38 },   // Dm9 (D F A E)
  { pad: [46, 53, 57, 62], root: 34 },   // Bbmaj7 (Bb F A D)
  { pad: [45, 53, 57, 60], root: 41 },   // Fmaj7/A
  { pad: [48, 55, 60, 62], root: 36 },   // Csus2
];
const BAR = 60 / 110 * 4; // seconds per bar at 110 bpm
const CHORD_LEN = 8.0;

export class Score {
  intensity = 0;
  private level = [1, 0, 0]; // current layer gains
  private bus: Record<'pad' | 'pluck' | 'combat' | 'boss', GainNode> | null = null;
  private delay: DelayNode | null = null;
  private nextChord = 0;
  private chordIdx = 0;
  private next16 = 0;
  private step = 0;
  private nextPluck = 0;
  private timer: number | null = null;
  private padVoices: { stop: (t: number) => void }[] = [];

  constructor(private a: AudioEngine) {}

  start(): void {
    const a = this.a;
    if (!a.ctx || this.bus) return;
    const ctx = a.ctx;
    const mk = (v: number) => { const g = ctx.createGain(); g.gain.value = v; g.connect(a.music); return g; };
    this.bus = { pad: mk(0.5), pluck: mk(0.35), combat: mk(0), boss: mk(0) };
    // long tempo-synced delay for the plucks (dotted eighth), fed back through a low-pass: the plucks smear into the pad
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = (60 / 110) * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.45;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    this.delay.connect(lp).connect(fb).connect(this.delay);
    lp.connect(this.bus.pluck);
    this.bus.pluck.connect(a.verbIn);
    this.bus.pad.connect(a.verbIn);
    const t = ctx.currentTime + 0.1;
    this.nextChord = t; this.next16 = t; this.nextPluck = t + 2;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  stop(): void { if (this.timer !== null) window.clearInterval(this.timer); this.timer = null; }

  private schedule(): void {
    const a = this.a, ctx = a.ctx!, bus = this.bus!;
    const ahead = ctx.currentTime + 0.25;
    // layer gains follow intensity (slow in, slower out)
    const want = [1, this.intensity >= 1 ? 1 : 0, this.intensity >= 2 ? 1 : 0];
    for (let i = 0; i < 3; i++) this.level[i] += (want[i] - this.level[i]) * (want[i] > this.level[i] ? 0.06 : 0.02);
    bus.combat.gain.setTargetAtTime(this.level[1] * 0.55, ctx.currentTime, 0.2);
    bus.boss.gain.setTargetAtTime(this.level[2] * 0.6, ctx.currentTime, 0.2);
    bus.pluck.gain.setTargetAtTime(0.35 * (1 - this.level[1] * 0.7), ctx.currentTime, 0.4);
    while (this.nextChord < ahead) { this.chord(this.nextChord); this.nextChord += CHORD_LEN; }
    while (this.next16 < ahead) { this.sixteenth(this.next16, this.step); this.step++; this.next16 += BAR / 16; }
    while (this.nextPluck < ahead) {
      this.pluck(this.nextPluck);
      this.nextPluck += 0.7 + Math.random() * 1.6;
    }
  }

  private chord(t: number): void {
    const a = this.a, ctx = a.ctx!, bus = this.bus!;
    const c = CHORDS[this.chordIdx % CHORDS.length];
    this.chordIdx++;
    for (const v of this.padVoices) v.stop(t + 2.5);
    this.padVoices = [];
    const open = 700 + this.level[2] * 1200;
    for (const n of c.pad) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7;
      f.frequency.setValueAtTime(open * 0.6, t); f.frequency.linearRampToValueAtTime(open, t + CHORD_LEN * 0.5);
      f.frequency.linearRampToValueAtTime(open * 0.7, t + CHORD_LEN);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 2.2);
      const os = [-7, 0, 6].map((det) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = MIDI(n); o.detune.value = det;
        o.connect(f); o.start(t); return o;
      });
      f.connect(g).connect(bus.pad);
      this.padVoices.push({ stop: (te: number) => { g.gain.setTargetAtTime(0.0001, te - 2.4, 0.8); os.forEach((o) => o.stop(te + 0.5)); } });
    }
    // sub drone on the root
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = MIDI(c.root - 12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 1.5);
    g.gain.setTargetAtTime(0.0001, t + CHORD_LEN - 0.5, 0.4);
    o.connect(g).connect(bus.pad); o.start(t); o.stop(t + CHORD_LEN + 1.5);
  }

  private pluck(t: number): void {
    const a = this.a, ctx = a.ctx!;
    const c = CHORDS[(this.chordIdx + CHORDS.length - 1) % CHORDS.length];
    const n = c.pad[Math.floor(Math.random() * c.pad.length)] + (Math.random() < 0.5 ? 12 : 24);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = MIDI(n);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = MIDI(n) * 2.001;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2).connect(g);
    g.connect(this.bus!.pluck); g.connect(this.delay!);
    o.start(t); o2.start(t); o.stop(t + 2.3); o2.stop(t + 2.3);
  }

  private sixteenth(t: number, s: number): void {
    if (this.level[1] < 0.02 && this.level[2] < 0.02) return;
    const a = this.a, ctx = a.ctx!, bus = this.bus!;
    const c = CHORDS[(this.chordIdx + CHORDS.length - 1) % CHORDS.length];
    const i = s % 16;
    // bass ostinato: root on 16ths with accents, a filter envelope per note
    const pattern = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1];
    if (pattern[i]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = MIDI(c.root + (i === 14 ? 7 : 0));
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
      f.frequency.setValueAtTime(i % 4 === 0 ? 1400 : 700, t); f.frequency.exponentialRampToValueAtTime(160, t + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(f).connect(g).connect(bus.combat); o.start(t); o.stop(t + 0.15);
    }
    if (i % 4 === 0) { // kick
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(bus.combat); o.start(t); o.stop(t + 0.32);
    }
    if (i % 2 === 1) { // hats
      const s_ = ctx.createBufferSource(); s_.buffer = a.noise();
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = ctx.createGain(); g.gain.setValueAtTime(i % 4 === 3 ? 0.06 : 0.035, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      s_.connect(f).connect(g).connect(bus.combat); s_.start(t, Math.random()); s_.stop(t + 0.05);
    }
    if (i === 0 && (s / 16) % 2 === 0) { // tremolo string cluster over two bars
      for (const n of [c.root + 24, c.root + 25, c.root + 31]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = MIDI(n);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
        const trem = ctx.createOscillator(); trem.frequency.value = 7.5;
        const tg = ctx.createGain(); tg.gain.value = 0.02;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + BAR);
        g.gain.linearRampToValueAtTime(0.0001, t + BAR * 2);
        trem.connect(tg).connect(g.gain);
        o.connect(f).connect(g).connect(bus.combat); o.start(t); trem.start(t); o.stop(t + BAR * 2 + 0.1); trem.stop(t + BAR * 2 + 0.1);
      }
    }
    // boss: toms on a syncopated figure, brass-like stab on each bar
    if (this.level[2] > 0.02) {
      if ([0, 3, 6, 10, 12].includes(i)) {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(i === 0 ? 95 : 120, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.55, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        o.connect(g).connect(bus.boss); o.start(t); o.stop(t + 0.5);
      }
      if (i === 0) {
        for (const n of c.pad.slice(0, 3)) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = MIDI(n - 12);
          const f = ctx.createBiquadFilter(); f.type = 'lowpass';
          f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(2200, t + 0.08); f.frequency.exponentialRampToValueAtTime(400, t + 0.6);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
          o.connect(f).connect(g).connect(bus.boss); o.start(t); o.stop(t + 0.85);
        }
      }
    }
  }
}
