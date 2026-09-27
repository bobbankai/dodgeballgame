import * as THREE from 'three';

export interface PlayOpts {
  pos?: THREE.Vector3;
  volume?: number;
  pitch?: number;
}

type Recipe = (e: AudioEngine, out: AudioNode, t: number, o: Required<Pick<PlayOpts, 'volume' | 'pitch'>>) => number;

export type MusicTrack = 'menu' | 'match' | 'boss' | 'final' | 'none';

/**
 * Procedural audio: every sound is synthesised with Web Audio so the game ships
 * without assets. Categories route through separate buses (sfx/ui/music/ambience)
 * and gameplay sounds are positional. `registerSample` lets real recordings
 * replace any recipe later without touching gameplay code.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ui!: GainNode;
  private musicBus!: GainNode;
  amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private crowdLevel = 0.12;
  private crowdBoost = 0;
  private samples = new Map<string, AudioBuffer>();
  private recipes = new Map<string, Recipe>();
  private lastPlay = new Map<string, number>();
  volumes = { master: 0.8, sfx: 0.9, music: 0.55, ui: 0.8, ambience: 0.7 };
  private music: Sequencer | null = null;
  private pendingTrack: MusicTrack = 'none';
  crowdEnabled = true;

  constructor() {
    this.defineRecipes();
    const unlock = () => {
      this.init();
      if (this.ctx?.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  init() {
    if (this.ctx) return;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.ui = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.amb = ctx.createGain();
    for (const g of [this.sfx, this.ui, this.musicBus, this.amb]) g.connect(this.master);
    this.applyVolumes();
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startCrowd();
    this.music = new Sequencer(this, this.musicBus);
    if (this.pendingTrack !== 'none') this.music.play(this.pendingTrack);
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfx.gain.value = this.volumes.sfx;
    this.ui.gain.value = this.volumes.ui;
    this.musicBus.gain.value = this.volumes.music * 0.5;
    this.amb.gain.value = this.volumes.ambience;
  }

  registerSample(name: string, buf: AudioBuffer) {
    this.samples.set(name, buf);
  }

  setListener(cam: THREE.Camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.position;
    const f = new THREE.Vector3();
    cam.getWorldDirection(f);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02);
      l.upY.setTargetAtTime(u.y, t, 0.02);
      l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      (l as any).setPosition(p.x, p.y, p.z);
      (l as any).setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  play(name: string, o: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // rate-limit identical sounds
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.025) return;
    this.lastPlay.set(name, now);
    const isUi = name.startsWith('ui');
    let out: AudioNode = isUi ? this.ui : this.sfx;
    let panner: PannerNode | null = null;
    if (o.pos && !isUi) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 4;
      panner.rolloffFactor = 0.9;
      panner.maxDistance = 60;
      panner.positionX.value = o.pos.x;
      panner.positionY.value = o.pos.y;
      panner.positionZ.value = o.pos.z;
      panner.connect(out);
      out = panner;
    }
    const vol = o.volume ?? 1;
    const pitch = o.pitch ?? 1;
    const sample = this.samples.get(name);
    let dur = 0.5;
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = pitch;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(out);
      src.start(now);
      dur = sample.duration / pitch;
    } else {
      const r = this.recipes.get(name);
      if (!r) return;
      dur = r(this, out, now, { volume: vol, pitch });
    }
    if (panner) setTimeout(() => panner!.disconnect(), (dur + 0.5) * 1000);
  }

  crowd(amount: number) {
    this.crowdBoost = Math.min(1.5, this.crowdBoost + amount * 0.6);
    if (!this.ctx || !this.crowdEnabled) return;
    if (amount > 0.6) this.play('cheer', { volume: Math.min(1, amount * 0.6) });
  }
  setCrowdLevel(v: number) {
    this.crowdLevel = v;
  }

  playMusic(track: MusicTrack) {
    this.pendingTrack = track;
    this.music?.play(track);
  }
  setMusicIntensity(v: number) {
    this.music?.setIntensity(v);
  }
  stinger(kind: 'victory' | 'defeat' | 'levelup' | 'unlock') {
    this.play(`sting_${kind}`, { volume: 0.9 });
  }

  update(dt: number) {
    if (!this.ctx || !this.crowdGain || !this.crowdFilter) return;
    this.crowdBoost *= Math.exp(-dt * 0.8);
    const lvl = this.crowdEnabled ? this.crowdLevel * (1 + this.crowdBoost * 2.2) : 0;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(lvl, t, 0.15);
    this.crowdFilter.frequency.setTargetAtTime(600 + this.crowdBoost * 900, t, 0.2);
    this.music?.tick();
  }

  // ------------------------------------------------------------ building blocks
  noise(out: AudioNode, t: number, dur: number, opts: { type?: BiquadFilterType; f0: number; f1?: number; q?: number; gain: number; attack?: number; curve?: number }) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(out: AudioNode, t: number, dur: number, opts: { type?: OscillatorType; f0: number; f1?: number; gain: number; attack?: number; detune?: number; lp?: number }) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(10, opts.f1), t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (opts.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lp;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private startCrowd() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(f2).connect(g).connect(this.amb);
    src.start();
    this.crowdGain = g;
    this.crowdFilter = f;
  }

  private defineRecipes() {
    const R = this.recipes;
    R.set('throw', (e, out, t, o) => {
      e.noise(out, t, 0.24, { f0: 900 * o.pitch, f1: 3200 * o.pitch, q: 1.4, gain: 0.5 * o.volume, attack: 0.03 });
      e.noise(out, t + 0.05, 0.2, { f0: 2600, f1: 700, q: 0.8, gain: 0.25 * o.volume });
      return 0.3;
    });
    R.set('throwQuick', (e, out, t, o) => {
      e.noise(out, t, 0.16, { f0: 1400 * o.pitch, f1: 3600, q: 1.2, gain: 0.4 * o.volume, attack: 0.015 });
      return 0.2;
    });
    R.set('throwPower', (e, out, t, o) => {
      e.noise(out, t, 0.45, { f0: 400, f1: 4200, q: 0.9, gain: 0.8 * o.volume, attack: 0.02 });
      e.tone(out, t, 0.4, { type: 'sawtooth', f0: 90, f1: 45, gain: 0.35 * o.volume, lp: 400 });
      e.tone(out, t, 0.25, { f0: 60, f1: 30, gain: 0.6 * o.volume });
      return 0.5;
    });
    R.set('pass', (e, out, t, o) => {
      e.noise(out, t, 0.18, { f0: 800, f1: 1600, q: 1, gain: 0.2 * o.volume, attack: 0.04 });
      return 0.2;
    });
    R.set('hit', (e, out, t, o) => {
      e.tone(out, t, 0.16, { f0: 160 * o.pitch, f1: 55, gain: 0.9 * o.volume });
      e.noise(out, t, 0.08, { f0: 1500, q: 0.9, gain: 0.9 * o.volume, attack: 0.001 });
      e.noise(out, t, 0.2, { type: 'lowpass', f0: 700, q: 0.5, gain: 0.35 * o.volume, attack: 0.001 });
      return 0.25;
    });
    R.set('hitHeavy', (e, out, t, o) => {
      e.tone(out, t, 0.35, { f0: 120, f1: 32, gain: 1 * o.volume });
      e.tone(out, t, 0.3, { type: 'square', f0: 90, f1: 40, gain: 0.25 * o.volume, lp: 600 });
      e.noise(out, t, 0.12, { f0: 1100, q: 0.7, gain: 1 * o.volume, attack: 0.001 });
      e.noise(out, t, 0.6, { type: 'lowpass', f0: 500, f1: 120, q: 0.4, gain: 0.5 * o.volume, attack: 0.002 });
      return 0.65;
    });
    R.set('catch', (e, out, t, o) => {
      e.noise(out, t, 0.06, { f0: 2000, q: 1.2, gain: 0.9 * o.volume, attack: 0.001 });
      e.tone(out, t, 0.12, { f0: 200, f1: 90, gain: 0.6 * o.volume });
      return 0.15;
    });
    R.set('catchPerfect', (e, out, t, o) => {
      e.noise(out, t, 0.07, { f0: 2400, q: 1.3, gain: 1 * o.volume, attack: 0.001 });
      e.tone(out, t, 0.14, { f0: 220, f1: 90, gain: 0.7 * o.volume });
      [880, 1318.5, 1760, 2637].forEach((f, i) => e.tone(out, t + 0.03 + i * 0.045, 0.6, { type: 'triangle', f0: f, gain: 0.18 * o.volume }));
      e.noise(out, t, 0.9, { type: 'highpass', f0: 6000, q: 0.5, gain: 0.08 * o.volume, attack: 0.05 });
      return 1;
    });
    R.set('passCatch', (e, out, t, o) => {
      e.noise(out, t, 0.05, { f0: 1600, q: 1, gain: 0.4 * o.volume, attack: 0.001 });
      return 0.08;
    });
    R.set('bounce', (e, out, t, o) => {
      e.tone(out, t, 0.12, { f0: 210 * o.pitch, f1: 110, gain: 0.55 * o.volume });
      e.noise(out, t, 0.04, { f0: 900, q: 1, gain: 0.3 * o.volume, attack: 0.001 });
      return 0.15;
    });
    R.set('wall', (e, out, t, o) => {
      e.noise(out, t, 0.09, { f0: 1300 * o.pitch, q: 1.5, gain: 0.7 * o.volume, attack: 0.001 });
      e.tone(out, t, 0.12, { f0: 140, f1: 70, gain: 0.5 * o.volume });
      return 0.15;
    });
    R.set('dodge', (e, out, t, o) => {
      e.noise(out, t, 0.22, { f0: 2400, f1: 500, q: 0.9, gain: 0.35 * o.volume, attack: 0.01 });
      e.noise(out, t, 0.08, { type: 'lowpass', f0: 500, q: 0.5, gain: 0.25 * o.volume, attack: 0.001 });
      return 0.25;
    });
    R.set('perfectDodge', (e, out, t, o) => {
      e.noise(out, t, 0.35, { f0: 400, f1: 5000, q: 1.5, gain: 0.35 * o.volume, attack: 0.25 });
      [1568, 2093].forEach((f, i) => e.tone(out, t + 0.1 + i * 0.06, 0.5, { type: 'sine', f0: f, gain: 0.14 * o.volume }));
      return 0.7;
    });
    R.set('pickup', (e, out, t, o) => {
      e.tone(out, t, 0.08, { type: 'triangle', f0: 520, f1: 700, gain: 0.2 * o.volume });
      e.noise(out, t, 0.04, { f0: 1200, gain: 0.2 * o.volume, attack: 0.001 });
      return 0.1;
    });
    R.set('step', (e, out, t, o) => {
      e.noise(out, t, 0.05, { type: 'lowpass', f0: 600 * o.pitch, q: 0.7, gain: 0.35 * o.volume, attack: 0.002 });
      e.noise(out, t, 0.02, { f0: 3000 * o.pitch, q: 2, gain: 0.08 * o.volume, attack: 0.001 });
      return 0.06;
    });
    R.set('fumble', (e, out, t, o) => {
      e.tone(out, t, 0.2, { f0: 130, f1: 60, gain: 0.7 * o.volume });
      e.noise(out, t, 0.1, { f0: 900, q: 0.8, gain: 0.6 * o.volume, attack: 0.001 });
      return 0.2;
    });
    R.set('block', (e, out, t, o) => {
      e.noise(out, t, 0.08, { f0: 1100, q: 1.2, gain: 0.8 * o.volume, attack: 0.001 });
      e.tone(out, t, 0.1, { f0: 180, f1: 90, gain: 0.5 * o.volume });
      return 0.12;
    });
    R.set('reflect', (e, out, t, o) => {
      e.noise(out, t, 0.08, { f0: 1500, q: 1.2, gain: 0.9 * o.volume, attack: 0.001 });
      e.tone(out, t, 0.35, { type: 'sawtooth', f0: 400, f1: 1600, gain: 0.2 * o.volume, lp: 3000 });
      return 0.4;
    });
    R.set('whiff', (e, out, t, o) => {
      e.noise(out, t, 0.18, { f0: 700, f1: 300, q: 0.7, gain: 0.25 * o.volume, attack: 0.02 });
      return 0.2;
    });
    R.set('fake', (e, out, t, o) => {
      e.noise(out, t, 0.12, { f0: 1400, f1: 900, q: 1, gain: 0.25 * o.volume, attack: 0.02 });
      return 0.15;
    });
    R.set('clash', (e, out, t, o) => {
      [523, 740, 1109, 1567, 2489].forEach((f, i) => e.tone(out, t, 0.9 - i * 0.12, { type: i % 2 ? 'square' : 'sine', f0: f * (1 + Math.random() * 0.02), gain: 0.12 * o.volume, lp: 5000 }));
      e.noise(out, t, 0.15, { f0: 2500, q: 0.8, gain: 0.8 * o.volume, attack: 0.001 });
      e.tone(out, t, 0.3, { f0: 110, f1: 50, gain: 0.7 * o.volume });
      return 1;
    });
    R.set('ko', (e, out, t, o) => {
      e.tone(out, t, 0.5, { f0: 90, f1: 35, gain: 0.8 * o.volume });
      e.noise(out, t, 0.5, { f0: 2000, f1: 300, q: 0.7, gain: 0.25 * o.volume, attack: 0.02 });
      return 0.6;
    });
    R.set('revive', (e, out, t, o) => {
      [392, 523, 659, 784, 1046].forEach((f, i) => e.tone(out, t + i * 0.06, 0.5, { type: 'triangle', f0: f, gain: 0.14 * o.volume }));
      e.noise(out, t, 0.6, { f0: 800, f1: 6000, q: 1, gain: 0.15 * o.volume, attack: 0.3 });
      return 0.9;
    });
    R.set('shockwave', (e, out, t, o) => {
      e.tone(out, t, 0.9, { f0: 70, f1: 24, gain: 1 * o.volume });
      e.noise(out, t, 0.9, { type: 'lowpass', f0: 1200, f1: 80, q: 0.5, gain: 0.8 * o.volume, attack: 0.002 });
      e.noise(out, t, 0.25, { f0: 3000, f1: 600, q: 0.6, gain: 0.4 * o.volume, attack: 0.002 });
      return 1;
    });
    R.set('chargeStart', (e, out, t, o) => {
      e.tone(out, t, 0.25, { type: 'sine', f0: 300, f1: 520, gain: 0.08 * o.volume, attack: 0.05 });
      return 0.3;
    });
    R.set('chargeReady', (e, out, t, o) => {
      e.tone(out, t, 0.35, { type: 'triangle', f0: 1318.5, gain: 0.2 * o.volume });
      e.tone(out, t + 0.04, 0.35, { type: 'sine', f0: 1975.5, gain: 0.12 * o.volume });
      return 0.4;
    });
    R.set('perfectRelease', (e, out, t, o) => {
      e.tone(out, t, 0.3, { type: 'triangle', f0: 1760, f1: 2349, gain: 0.16 * o.volume });
      return 0.3;
    });
    R.set('countdown', (e, out, t, o) => {
      e.tone(out, t, 0.25, { type: 'square', f0: 660, gain: 0.12 * o.volume, lp: 2000 });
      return 0.3;
    });
    R.set('go', (e, out, t, o) => {
      // referee whistle
      const ctx = e.ctx!;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 2900;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 28;
      const lg = ctx.createGain();
      lg.gain.value = 120;
      lfo.connect(lg).connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18 * o.volume, t + 0.02);
      g.gain.setValueAtTime(0.18 * o.volume, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(g).connect(out);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 0.6);
      lfo.stop(t + 0.6);
      e.noise(out, t, 0.5, { f0: 3000, q: 3, gain: 0.05 * o.volume, attack: 0.02 });
      return 0.6;
    });
    R.set('cheer', (e, out, t, o) => {
      e.noise(e.amb, t, 1.6, { f0: 900, f1: 1300, q: 0.7, gain: 0.35 * o.volume, attack: 0.12 });
      e.noise(e.amb, t + 0.1, 1.4, { f0: 2200, f1: 1800, q: 1.4, gain: 0.12 * o.volume, attack: 0.15 });
      return 1.8;
    });
    R.set('roundWin', (e, out, t, o) => {
      [523, 659, 784, 1046].forEach((f, i) => e.tone(out, t + i * 0.09, 0.6, { type: 'triangle', f0: f, gain: 0.16 * o.volume }));
      return 1;
    });
    R.set('roundLose', (e, out, t, o) => {
      [392, 330, 262].forEach((f, i) => e.tone(out, t + i * 0.12, 0.6, { type: 'triangle', f0: f, gain: 0.15 * o.volume }));
      return 1;
    });
    R.set('ability', (e, out, t, o) => {
      e.tone(out, t, 0.5, { type: 'sawtooth', f0: 200, f1: 800, gain: 0.18 * o.volume, lp: 2500, attack: 0.05 });
      e.noise(out, t, 0.5, { f0: 500, f1: 4000, q: 1.2, gain: 0.2 * o.volume, attack: 0.3 });
      return 0.6;
    });
    R.set('ultimateRise', (e, out, t, o) => {
      e.tone(out, t, 1.4, { type: 'sawtooth', f0: 80, f1: 640, gain: 0.25 * o.volume, lp: 1800, attack: 0.3 });
      e.tone(out, t, 1.4, { type: 'sawtooth', f0: 81, f1: 648, gain: 0.2 * o.volume, lp: 1800, attack: 0.3, detune: 12 });
      e.noise(out, t, 1.4, { f0: 300, f1: 6000, q: 0.8, gain: 0.3 * o.volume, attack: 1.2 });
      return 1.5;
    });
    R.set('ultimateImpact', (e, out, t, o) => {
      e.tone(out, t, 1.4, { f0: 60, f1: 20, gain: 1 * o.volume });
      e.noise(out, t, 1.2, { type: 'lowpass', f0: 2500, f1: 60, q: 0.4, gain: 1 * o.volume, attack: 0.002 });
      [220, 330, 440].forEach((f) => e.tone(out, t, 1.6, { type: 'sawtooth', f0: f, f1: f * 0.5, gain: 0.08 * o.volume, lp: 1500 }));
      return 1.6;
    });
    R.set('blink', (e, out, t, o) => {
      e.noise(out, t, 0.25, { f0: 6000, f1: 800, q: 2, gain: 0.3 * o.volume, attack: 0.01 });
      e.tone(out, t, 0.2, { type: 'sine', f0: 1200, f1: 300, gain: 0.15 * o.volume });
      return 0.3;
    });
    // UI
    R.set('uiClick', (e, out, t, o) => {
      e.tone(out, t, 0.06, { type: 'triangle', f0: 1200, f1: 900, gain: 0.12 * o.volume });
      return 0.08;
    });
    R.set('uiHover', (e, out, t, o) => {
      e.tone(out, t, 0.04, { type: 'sine', f0: 1800, gain: 0.04 * o.volume });
      return 0.05;
    });
    R.set('uiConfirm', (e, out, t, o) => {
      e.tone(out, t, 0.12, { type: 'triangle', f0: 880, gain: 0.12 * o.volume });
      e.tone(out, t + 0.07, 0.18, { type: 'triangle', f0: 1318.5, gain: 0.12 * o.volume });
      return 0.3;
    });
    R.set('uiBack', (e, out, t, o) => {
      e.tone(out, t, 0.12, { type: 'triangle', f0: 700, f1: 500, gain: 0.1 * o.volume });
      return 0.15;
    });
    R.set('uiUnlock', (e, out, t, o) => {
      [659, 880, 1109, 1318].forEach((f, i) => e.tone(out, t + i * 0.05, 0.4, { type: 'triangle', f0: f, gain: 0.12 * o.volume }));
      e.noise(out, t, 0.4, { f0: 3000, f1: 8000, q: 1, gain: 0.08 * o.volume, attack: 0.1 });
      return 0.6;
    });
    R.set('sting_victory', (e, out, t, o) => {
      const notes = [523, 659, 784, 1046, 784, 1046, 1318];
      notes.forEach((f, i) => e.tone(out, t + i * 0.1, 0.5 + (i === notes.length - 1 ? 0.8 : 0), { type: 'triangle', f0: f, gain: 0.16 * o.volume }));
      e.tone(out, t + 0.6, 1.2, { type: 'sawtooth', f0: 130.8, gain: 0.1 * o.volume, lp: 900 });
      return 2;
    });
    R.set('sting_defeat', (e, out, t, o) => {
      [440, 415, 392, 330].forEach((f, i) => e.tone(out, t + i * 0.22, 0.7, { type: 'triangle', f0: f, gain: 0.14 * o.volume }));
      return 1.6;
    });
    R.set('sting_levelup', (e, out, t, o) => {
      [523, 784, 1046, 1568].forEach((f, i) => e.tone(out, t + i * 0.08, 0.6, { type: 'triangle', f0: f, gain: 0.15 * o.volume }));
      e.noise(out, t, 0.8, { f0: 2000, f1: 9000, q: 0.8, gain: 0.1 * o.volume, attack: 0.3 });
      return 1.2;
    });
    R.set('sting_unlock', (e, out, t, o) => {
      [392, 523, 659, 784, 1046, 1318].forEach((f, i) => e.tone(out, t + i * 0.07, 0.8, { type: 'triangle', f0: f, gain: 0.14 * o.volume }));
      return 1.4;
    });
  }
}

// ---------------------------------------------------------------------------
// Generative music sequencer
// ---------------------------------------------------------------------------

interface TrackDef {
  bpm: number;
  root: number; // midi
  scale: number[];
  chords: number[][]; // scale degrees
  kick: string;
  snare: string;
  hat: string;
  bass: string; // x = root of chord, o = fifth, - rest
  arp: boolean;
  pad: boolean;
  lead: boolean;
  swing: number;
}

const TRACKS: Record<Exclude<MusicTrack, 'none'>, TrackDef> = {
  menu: { bpm: 96, root: 45, scale: [0, 2, 3, 5, 7, 8, 10], chords: [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]], kick: 'x-------x-x-----', snare: '----x-------x---', hat: '--x---x---x---x-', bass: 'x-----x---o-----', arp: true, pad: true, lead: false, swing: 0.1 },
  match: { bpm: 124, root: 40, scale: [0, 2, 3, 5, 7, 8, 10], chords: [[0, 2, 4], [0, 2, 4], [5, 0, 2], [6, 1, 3]], kick: 'x---x---x---x-x-', snare: '----x-------x---', hat: 'x-x-x-x-x-x-xxx-', bass: 'x-xox-x-x-xox-x-', arp: true, pad: true, lead: false, swing: 0 },
  boss: { bpm: 136, root: 38, scale: [0, 1, 3, 5, 7, 8, 10], chords: [[0, 2, 4], [1, 3, 5], [0, 2, 4], [6, 1, 3]], kick: 'x--xx---x--xx-x-', snare: '----x-------x-xx', hat: 'xxxxxxxxxxxxxxxx', bass: 'xxoxxxoxxxoxxxox', arp: true, pad: true, lead: true, swing: 0 },
  final: { bpm: 140, root: 41, scale: [0, 2, 3, 5, 7, 8, 11], chords: [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]], kick: 'x-x-x-x-x-x-x-x-', snare: '----x--x----x-x-', hat: 'x-xxx-xxx-xxx-xx', bass: 'x-xox-xox-xox-xo', arp: true, pad: true, lead: true, swing: 0 },
};

class Sequencer {
  private track: TrackDef | null = null;
  private name: MusicTrack = 'none';
  private step = 0;
  private nextTime = 0;
  private bar = 0;
  private intensity = 0.6;
  private gain: GainNode;
  private fade: GainNode;

  constructor(private e: AudioEngine, out: AudioNode) {
    const ctx = e.ctx!;
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.gain = ctx.createGain();
    this.gain.gain.value = 1;
    this.gain.connect(this.fade).connect(out);
  }

  play(name: MusicTrack) {
    if (name === this.name) return;
    const ctx = this.e.ctx!;
    const t = ctx.currentTime;
    this.fade.gain.cancelScheduledValues(t);
    this.fade.gain.setTargetAtTime(0, t, 0.3);
    setTimeout(() => {
      this.name = name;
      this.track = name === 'none' ? null : TRACKS[name];
      this.step = 0;
      this.bar = 0;
      this.nextTime = ctx.currentTime + 0.1;
      if (this.track) this.fade.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    }, 700);
  }

  setIntensity(v: number) {
    this.intensity = v;
  }

  private midi(n: number) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  tick() {
    const tr = this.track;
    const ctx = this.e.ctx;
    if (!tr || !ctx) return;
    const spb = 60 / tr.bpm / 4; // 16th
    while (this.nextTime < ctx.currentTime + 0.15) {
      const t = this.nextTime + (this.step % 2 === 1 ? spb * tr.swing : 0);
      this.schedule(tr, this.step, t, spb);
      this.nextTime += spb;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  private schedule(tr: TrackDef, s: number, t: number, spb: number) {
    const e = this.e;
    const out = this.gain;
    const I = this.intensity;
    const chord = tr.chords[Math.floor(this.bar / 2) % tr.chords.length];
    const deg = (d: number, oct = 0) => tr.root + tr.scale[((d % 7) + 7) % 7] + 12 * (oct + Math.floor(d / 7));
    if (tr.kick[s] === 'x' && I > 0.15) {
      e.tone(out, t, 0.28, { f0: 150, f1: 42, gain: 0.55 });
      e.noise(out, t, 0.02, { f0: 3000, q: 1, gain: 0.08, attack: 0.001 });
    }
    if (tr.snare[s] === 'x' && I > 0.3) {
      e.noise(out, t, 0.16, { f0: 1800, q: 0.7, gain: 0.22, attack: 0.001 });
      e.tone(out, t, 0.1, { f0: 220, f1: 160, gain: 0.15 });
    }
    if (tr.hat[s] === 'x' && I > 0.4) e.noise(out, t, s % 4 === 2 ? 0.08 : 0.035, { type: 'highpass', f0: 8000, q: 0.5, gain: s % 4 === 2 ? 0.07 : 0.045, attack: 0.001 });
    const b = tr.bass[s];
    if (b !== '-' && b !== undefined) {
      const n = deg(chord[0], -1) + (b === 'o' ? 7 : 0);
      e.tone(out, t, spb * 1.8, { type: 'sawtooth', f0: this.midi(n), gain: 0.13, lp: 380 + I * 500 });
      e.tone(out, t, spb * 1.8, { type: 'sine', f0: this.midi(n - 12), gain: 0.16 });
    }
    if (tr.pad && s === 0 && this.bar % 2 === 0) {
      for (const d of chord) {
        e.tone(out, t, spb * 30, { type: 'sawtooth', f0: this.midi(deg(d, 1)), gain: 0.028, lp: 1200, attack: 0.4, detune: (Math.random() - 0.5) * 14 });
        e.tone(out, t, spb * 30, { type: 'triangle', f0: this.midi(deg(d, 1)), gain: 0.03, attack: 0.5 });
      }
    }
    if (tr.arp && I > 0.5 && s % 2 === 0) {
      const d = chord[(s / 2) % chord.length] + (s >= 8 ? 7 : 0);
      e.tone(out, t, spb * 1.5, { type: 'square', f0: this.midi(deg(d, 2)), gain: 0.028, lp: 2400 });
    }
    if (tr.lead && I > 0.75 && (s === 0 || s === 6 || s === 10) && this.bar % 4 >= 2) {
      const d = chord[s % chord.length] + 7;
      e.tone(out, t, spb * 4, { type: 'sawtooth', f0: this.midi(deg(d, 2)), gain: 0.035, lp: 3200, attack: 0.02 });
    }
  }
}
