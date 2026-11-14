import type { AudioEngine } from './engine';

/**
 * Sound design, synthesised. Each recipe schedules a small node graph at time t into `out` (already positioned + reverb-sent).
 * Layering follows how game hits are built: a transient (the click that says "contact"), a body (the thump: weight), a tail (texture),
 * and for chronal events a tonal layer in the game's key (D minor: D, F, A) so abilities and the score feel related.
 */
type Recipe = (a: AudioEngine, out: GainNode, t: number, pitch: number) => void;

function env(g: GainNode, t: number, peak: number, attack: number, decay: number, curve = 'exp'): void {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  else g.gain.linearRampToValueAtTime(0, t + attack + decay);
}

function tone(a: AudioEngine, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.002): OscillatorNode {
  const ctx = a.ctx!;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, peak, attack, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
  return o;
}

function hiss(a: AudioEngine, out: AudioNode, t: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1 = f0, q = 0.8, attack = 0.002,
  pink = false): void {
  const ctx = a.ctx!;
  const s = ctx.createBufferSource();
  s.buffer = a.noise(pink);
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
  const g = ctx.createGain();
  env(g, t, peak, attack, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 1.5);
  s.stop(t + attack + dur + 0.05);
}

/** A soft-clipped bus for crunch (heavy hits, slams). */
function drive(a: AudioEngine, out: AudioNode, amount = 2.5): WaveShaperNode {
  const ws = a.ctx!.createWaveShaper();
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  ws.curve = c;
  ws.connect(out);
  return ws;
}

/** Inharmonic metal: a few detuned partials with their own decays (blocks, clangs, the parry ring). */
function metal(a: AudioEngine, out: AudioNode, t: number, base: number, partials: number[], dur: number, peak: number): void {
  partials.forEach((r, i) => tone(a, out, t, 'sine', base * r, base * r * 0.998, dur * (1 - i * 0.12), peak / (1 + i * 0.6), 0.001));
}

const D = 73.42; // D2: the score's root

export const RECIPES: Record<string, Recipe> = {
  hit_light: (a, o, t, p) => {
    hiss(a, o, t, 0.035, 0.7, 'bandpass', 2400 * p, 1400, 1.2);                 // contact snap
    tone(a, o, t, 'sine', 150 * p, 62, 0.11, 0.9);                                // body
    hiss(a, o, t + 0.01, 0.12, 0.25, 'lowpass', 900, 300, 0.7, 0.004, true);      // cloth / flesh tail
  },
  hit_heavy: (a, o, t, p) => {
    const d = drive(a, o, 3);
    hiss(a, d, t, 0.05, 0.9, 'bandpass', 1800 * p, 700, 1.0);
    tone(a, d, t, 'sine', 110 * p, 38, 0.24, 1.1);
    tone(a, d, t, 'triangle', 220 * p, 70, 0.08, 0.4);
    hiss(a, o, t + 0.015, 0.3, 0.4, 'lowpass', 1400, 180, 0.7, 0.006, true);
  },
  block: (a, o, t, p) => {
    hiss(a, o, t, 0.03, 0.5, 'highpass', 3000, 3000, 0.7);
    metal(a, o, t, 520 * p, [1, 2.58, 4.25, 6.1], 0.32, 0.38);
    tone(a, o, t, 'sine', 140, 80, 0.08, 0.4);
  },
  parry: (a, o, t, p) => {
    // a bright ring in key (A) over a reversed chronal swell that resolves into it: the "you nailed it" sound
    hiss(a, o, t - 0.0, 0.025, 0.7, 'highpass', 4000, 4000, 0.7);
    metal(a, o, t, 880 * p, [1, 2.0, 2.99, 4.2], 0.9, 0.42);
    tone(a, o, t, 'sine', D * 8, D * 8, 1.2, 0.18, 0.01);
    tone(a, o, t, 'sine', D * 6, D * 6 * 1.003, 1.4, 0.12, 0.01);
  },
  whoosh: (a, o, t, p) => { hiss(a, o, t, 0.2, 0.32, 'bandpass', 420 * p, 2600 * p, 1.6, 0.05, true); },
  dodge: (a, o, t, p) => {
    hiss(a, o, t, 0.28, 0.35, 'bandpass', 300 * p, 1600 * p, 1.2, 0.04, true);
    tone(a, o, t, 'sine', D * 4, D * 2, 0.25, 0.08, 0.02);
  },
  jump: (a, o, t) => { hiss(a, o, t, 0.12, 0.25, 'lowpass', 900, 400, 0.7, 0.005, true); tone(a, o, t, 'sine', 120, 90, 0.06, 0.25); },
  land: (a, o, t) => { tone(a, o, t, 'sine', 95, 45, 0.14, 0.7); hiss(a, o, t, 0.1, 0.35, 'lowpass', 1200, 300, 0.7, 0.002, true); },
  step: (a, o, t, p) => {
    hiss(a, o, t, 0.045, 0.22, 'bandpass', 1800 * p, 900 * p, 1.4, 0.002);
    tone(a, o, t, 'sine', 90 * p, 55, 0.05, 0.22);
  },
  door_open: (a, o, t) => {
    hiss(a, o, t, 0.45, 0.3, 'highpass', 3500, 1500, 0.7, 0.01);                  // pneumatic release
    const ctx = a.ctx!;
    const s = ctx.createOscillator();                                             // servo
    s.type = 'sawtooth';
    s.frequency.setValueAtTime(70, t + 0.05);
    s.frequency.linearRampToValueAtTime(130, t + 0.75);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = ctx.createGain(); env(g, t + 0.05, 0.16, 0.08, 0.8, 'lin');
    s.connect(f).connect(g).connect(o); s.start(t + 0.05); s.stop(t + 1.0);
    tone(a, o, t + 0.85, 'sine', 120, 50, 0.16, 0.6);                             // the stop
    hiss(a, o, t + 0.85, 0.08, 0.3, 'lowpass', 1500, 400);
  },
  door_slam: (a, o, t) => {
    const d = drive(a, o, 4);
    tone(a, d, t, 'sine', 90, 32, 0.35, 1.2);
    hiss(a, d, t, 0.12, 0.8, 'lowpass', 3000, 500, 0.8);
    metal(a, o, t, 140, [1, 2.7, 5.2], 0.6, 0.18);
  },
  slow_on: (a, o, t) => {
    // the world drops out: a downward tape-stop sweep, a low swell
    tone(a, o, t, 'sawtooth', 220, 40, 0.6, 0.12, 0.01);
    hiss(a, o, t, 0.7, 0.3, 'lowpass', 4000, 200, 1.0, 0.01, true);
    tone(a, o, t, 'sine', D * 2, D, 0.9, 0.35, 0.05);
  },
  slow_off: (a, o, t) => {
    tone(a, o, t, 'sawtooth', 50, 260, 0.35, 0.1, 0.01);
    hiss(a, o, t, 0.4, 0.25, 'lowpass', 300, 5000, 1.0, 0.01, true);
  },
  rewind_on: (a, o, t) => {
    // a reversed swell (rising noise + rising tones) that pulls everything backwards
    hiss(a, o, t, 0.9, 0.35, 'bandpass', 200, 5000, 2.0, 0.85);
    tone(a, o, t, 'triangle', D * 2, D * 8, 0.9, 0.16, 0.8);
    tone(a, o, t, 'sine', D * 3, D * 12, 0.9, 0.1, 0.8);
  },
  rewind_off: (a, o, t) => { hiss(a, o, t, 0.25, 0.4, 'bandpass', 5000, 600, 1.5); tone(a, o, t, 'sine', D * 8, D * 4, 0.4, 0.15); },
  echo_on: (a, o, t) => {
    const ctx = a.ctx!;
    const dl = ctx.createDelay(1.0); dl.delayTime.value = 0.13;
    const fb = ctx.createGain(); fb.gain.value = 0.55;
    dl.connect(fb).connect(dl); dl.connect(o);
    [1, 1.5, 2, 3].forEach((r, i) => tone(a, dl, t + i * 0.035, 'sine', D * 4 * r, D * 4 * r, 0.5, 0.12, 0.01));
    hiss(a, o, t, 0.4, 0.15, 'highpass', 6000, 3000);
  },
  shift: (a, o, t) => {
    const d = drive(a, o, 2);
    tone(a, d, t, 'sine', 60, 30, 0.8, 1.0, 0.01);
    hiss(a, o, t, 0.6, 0.35, 'bandpass', 2500, 150, 1.2, 0.02);
    tone(a, o, t, 'sine', D * 4, D * 4.02, 1.0, 0.12, 0.02);
  },
  deny: (a, o, t) => { tone(a, o, t, 'square', 330, 330, 0.07, 0.07); tone(a, o, t + 0.09, 'square', 247, 247, 0.12, 0.07); },
  alert: (a, o, t) => { tone(a, o, t, 'sawtooth', 880, 880, 0.06, 0.06); tone(a, o, t + 0.08, 'sawtooth', 1175, 1175, 0.1, 0.06); },
  interact: (a, o, t) => { tone(a, o, t, 'sine', 1320, 1320, 0.05, 0.12); tone(a, o, t + 0.06, 'sine', 1760, 1760, 0.12, 0.1); },
  boss_slam: (a, o, t) => {
    const d = drive(a, o, 5);
    tone(a, d, t, 'sine', 70, 24, 0.7, 1.4);
    hiss(a, d, t, 0.35, 1.0, 'lowpass', 2500, 120, 0.8, 0.004);
    metal(a, o, t, 95, [1, 2.4, 4.9], 1.2, 0.2);
    hiss(a, o, t + 0.05, 1.4, 0.25, 'lowpass', 600, 80, 0.7, 0.02, true);         // debris settling
  },
  boss_servo: (a, o, t, p) => {
    const ctx = a.ctx!;
    const s = ctx.createOscillator();
    s.type = 'sawtooth';
    s.frequency.setValueAtTime(110 * p, t);
    s.frequency.exponentialRampToValueAtTime(220 * p, t + 0.35);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
    const g = ctx.createGain(); env(g, t, 0.14, 0.04, 0.4);
    s.connect(f).connect(g).connect(o); s.start(t); s.stop(t + 0.5);
  },
  boss_charge: (a, o, t) => { hiss(a, o, t, 0.8, 0.5, 'bandpass', 150, 1400, 1.4, 0.4); tone(a, o, t, 'sawtooth', 55, 110, 0.8, 0.2, 0.3); },
  boss_pulse: (a, o, t) => {
    tone(a, o, t, 'sine', 40, 25, 1.2, 1.0, 0.01);
    hiss(a, o, t, 0.9, 0.4, 'bandpass', 3000, 200, 1.0, 0.01);
    tone(a, o, t, 'sine', D * 4, D * 2, 1.0, 0.2, 0.01);
  },
  boss_shed: (a, o, t) => {
    const d = drive(a, o, 4);
    hiss(a, d, t, 0.5, 1.0, 'lowpass', 5000, 300, 0.7);
    tone(a, d, t, 'sine', 80, 30, 0.6, 1.0);
    metal(a, o, t + 0.05, 210, [1, 2.3, 3.9, 6.7], 1.4, 0.25);
    metal(a, o, t + 0.3, 170, [1, 2.6, 4.4], 1.2, 0.2);
  },
  boss_death: (a, o, t) => {
    const d = drive(a, o, 3);
    tone(a, d, t, 'sawtooth', 160, 20, 2.5, 0.4, 0.05);                          // power-down
    tone(a, d, t + 1.6, 'sine', 70, 25, 0.8, 1.2);                                 // it hits the floor
    hiss(a, d, t + 1.6, 0.5, 0.9, 'lowpass', 2500, 150, 0.8);
    metal(a, o, t + 1.62, 120, [1, 2.5, 4.1], 1.6, 0.25);
  },
  thunder: (a, o, t) => {
    hiss(a, o, t, 0.15, 0.7, 'lowpass', 3000, 800, 0.7, 0.003);                   // the crack
    hiss(a, o, t + 0.1, 4.5, 0.9, 'lowpass', 400, 60, 0.7, 0.4, true);             // the roll
    tone(a, o, t + 0.1, 'sine', 45, 28, 3.0, 0.5, 0.3);
  },
};

/** The mix: per-sound gain normalising each recipe's measured peak (src/audio/check.ts) to its place in the loudness hierarchy:
 * slams and boss hits on top, hits and abilities next, movement and UI cues underneath. */
export const MIX: Record<string, number> = {
  hit_light: 0.866,
  hit_heavy: 0.9,
  block: 0.644,
  parry: 0.531,
  whoosh: 5.0,
  dodge: 1.923,
  jump: 1.456,
  land: 0.702,
  step: 1.646,
  door_open: 0.904,
  door_slam: 0.652,
  slow_on: 1.304,
  slow_off: 4.124,
  rewind_on: 2.12,
  rewind_off: 1.271,
  echo_on: 2.294,
  shift: 0.667,
  deny: 5.469,
  alert: 7.368,
  interact: 2.991,
  boss_slam: 0.73,
  boss_servo: 3.896,
  boss_charge: 2.899,
  boss_pulse: 0.685,
  boss_shed: 0.656,
  boss_death: 0.646,
  thunder: 0.855,
};

/** Long-running layers: return a stopper. */
export const LOOPS: Record<string, (a: AudioEngine, out: GainNode) => (t?: number) => void> = {
  /** time slow: a low sustained drone in D with a slow beating, the world muffled */
  slow_drone: (a, out) => {
    const ctx = a.ctx!;
    const os = [D, D * 1.5, D * 2.003].map((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = [0.35, 0.12, 0.08][i];
      o.connect(g).connect(out); o.start(); return o;
    });
    return (t) => os.forEach((o) => o.stop(t));
  },
  /** the Sentinel's hover: a gravity-core hum with a slow wobble */
  boss_hum: (a, out) => {
    const ctx = a.ctx!;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 48;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 3;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 1.7;
    const lg = ctx.createGain(); lg.gain.value = 60;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain(); g.gain.value = 0.5;
    o.connect(f).connect(g).connect(out); o.start(); lfo.start();
    return (t) => { o.stop(t); lfo.stop(t); };
  },
  /** facility bed: ventilation (pink noise, low-passed), mains hum, a faint electrical whine */
  amb_facility: (a, out) => {
    const ctx = a.ctx!;
    const s = ctx.createBufferSource(); s.buffer = a.noise(true); s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.6;
    s.connect(f).connect(g).connect(out); s.start();
    const h1 = ctx.createOscillator(); h1.frequency.value = 50; const hg = ctx.createGain(); hg.gain.value = 0.05; h1.connect(hg).connect(out); h1.start();
    const h2 = ctx.createOscillator(); h2.frequency.value = 100; const hg2 = ctx.createGain(); hg2.gain.value = 0.025; h2.connect(hg2).connect(out); h2.start();
    return (t) => { s.stop(t); h1.stop(t); h2.stop(t); };
  },
  /** surface bed: gusting wind (band-passed noise with a slow random gust envelope) + a distant city rumble */
  amb_storm: (a, out) => {
    const ctx = a.ctx!;
    const s = ctx.createBufferSource(); s.buffer = a.noise(true); s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lg = ctx.createGain(); lg.gain.value = 0.35;
    lfo.connect(lg).connect(g.gain);
    const lf2 = ctx.createOscillator(); lf2.frequency.value = 0.13;
    const lg2 = ctx.createGain(); lg2.gain.value = 300;
    lf2.connect(lg2).connect(f.frequency);
    s.connect(f).connect(g).connect(out); s.start(); lfo.start(); lf2.start();
    const r = ctx.createBufferSource(); r.buffer = a.noise(true); r.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 90;
    const rg = ctx.createGain(); rg.gain.value = 0.8;
    r.connect(rf).connect(rg).connect(out); r.start();
    return (t) => { s.stop(t); lfo.stop(t); lf2.stop(t); r.stop(t); };
  },
};
