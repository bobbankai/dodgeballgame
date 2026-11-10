// All sound is synthesised: impacts, whooshes, the bell, rain, thunder, a crowd, and a small generative score
// built round one four-bar theme (the lullaby their father hummed), played sad, driven, and at last in the major.

type Mood = 'none' | 'theme' | 'fight' | 'boss' | 'dawn' | 'dread';
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
// the theme in D minor: [midi, beats]
const THEME: [number, number][] = [[62, 1], [65, 1], [69, 1.5], [67, 0.5], [65, 1], [64, 1], [62, 2], [58, 1], [62, 1], [65, 1.5], [64, 0.5], [62, 1], [61, 1], [62, 2]];
const CHORDS = [[38, 50, 57, 62, 65], [34, 46, 53, 58, 62], [31, 43, 50, 55, 58], [33, 45, 52, 57, 61]];   // Dm Bb Gm A

export class Sound {
  ctx!: AudioContext;
  private out!: GainNode; private sfx!: GainNode; private music!: GainNode; private amb!: GainNode; private wet!: GainNode;
  private noise!: AudioBuffer;
  private mood: Mood = 'none'; private seq = 0; private nextT = 0; private themeI = 0; private themeT = 0;
  private loops = new Map<string, { g: GainNode; stop: () => void }>();
  /** 0..1 how hard the fight score is pushing */ intensity = 0.5;
  enabled = true;
  private ready = false;

  /** Browsers only allow sound after a gesture: call from the first click or key. */
  start() {
    if (this.ready) { void this.ctx.resume(); return; }
    this.ready = true;
    const c = this.ctx = new AudioContext();
    this.out = c.createGain(); this.out.gain.value = this.enabled ? 0.9 : 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.out.connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.music = c.createGain(); this.amb = c.createGain();
    this.music.gain.value = 0.5; this.amb.gain.value = 0.6;
    for (const g of [this.sfx, this.music, this.amb]) g.connect(this.out);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // a room: noise that dies away, as an impulse response
    const ir = c.createBuffer(2, c.sampleRate * 2.4, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const r = ir.getChannelData(ch); for (let i = 0; i < r.length; i++) r[i] = (Math.random() * 2 - 1) * (1 - i / r.length) ** 3.2; }
    const conv = c.createConvolver(); conv.buffer = ir;
    this.wet = c.createGain(); this.wet.gain.value = 0.22;
    this.wet.connect(conv).connect(this.out);
    this.sfx.connect(this.wet); this.music.connect(this.wet);
  }

  setEnabled(on: boolean) { this.enabled = on; if (this.ready) this.out.gain.value = on ? 0.9 : 0; }
  private get t() { return this.ctx.currentTime; }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(freq: number, to: number, dur: number, vol: number, type: OscillatorType = 'sine', dest: AudioNode = this.sfx, at = this.t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    this.env(g, at, 0.004, vol, dur);
    o.connect(g).connect(dest); o.start(at); o.stop(at + dur + 0.05);
  }

  private burst(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = 'bandpass', dest: AudioNode = this.sfx, at = this.t, sweep = 0) {
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise; s.loop = true;
    f.type = type; f.frequency.setValueAtTime(freq, at); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, at + dur);
    this.env(g, at, 0.003, vol, dur);
    s.connect(f).connect(g).connect(dest); s.start(at, Math.random() * 1.5); s.stop(at + dur + 0.05);
  }

  hit(kind: 'light' | 'heavy' | 'kick' | 'bell', power = 1) {
    if (!this.ready) return;
    const p = Math.min(1.4, power);
    if (kind === 'light') { this.tone(190, 70, 0.09, 0.5 * p); this.burst(1900, 1.2, 0.05, 0.45 * p); }
    else if (kind === 'kick') { this.tone(150, 48, 0.13, 0.7 * p); this.burst(2600, 0.9, 0.06, 0.5 * p); this.burst(700, 1, 0.09, 0.35 * p); }
    else { this.tone(120, 38, 0.2, 0.9 * p); this.burst(900, 0.8, 0.1, 0.6 * p); this.burst(3200, 1.5, 0.03, 0.4 * p); }
    if (kind === 'bell') { this.bell(196, 0.55, 2.2); this.tone(70, 30, 0.5, 0.9); }
  }
  block() { if (this.ready) { this.burst(420, 0.9, 0.07, 0.5, 'lowpass'); this.tone(240, 150, 0.05, 0.2, 'triangle'); } }
  parry() { if (this.ready) { this.tone(1400, 2100, 0.12, 0.28, 'triangle'); this.burst(5200, 3, 0.1, 0.3); } }
  whoosh(power = 1) { if (this.ready) this.burst(380, 1.6, 0.16 + 0.05 * power, 0.14 * power, 'bandpass', this.sfx, this.t, 2100); }
  step() { if (this.ready) this.burst(260, 0.7, 0.05, 0.1, 'lowpass'); }
  thud() { if (this.ready) { this.tone(90, 34, 0.3, 0.9); this.burst(300, 0.7, 0.2, 0.5, 'lowpass'); } }
  ui() { if (this.ready) this.tone(880, 660, 0.06, 0.12, 'triangle'); }
  cheer(power = 1) { if (this.ready) { this.burst(1100, 0.5, 0.9, 0.16 * power, 'bandpass', this.amb); this.burst(2400, 0.7, 0.7, 0.08 * power, 'bandpass', this.amb); } }

  /** A struck bell: inharmonic partials over a hum. */
  bell(freq = 131, vol = 0.6, dur = 5, at?: number) {
    if (!this.ready) return;
    const t = at ?? this.t;
    for (const [mult, v, d] of [[0.5, 0.5, 1], [1, 1, 0.85], [2.0, 0.6, 0.6], [2.76, 0.42, 0.42], [3.96, 0.26, 0.3], [5.4, 0.16, 0.2], [6.8, 0.1, 0.12]] as const) {
      this.tone(freq * mult, freq * mult * 0.997, dur * d, vol * v * 0.5, 'sine', this.sfx, t);
    }
    this.burst(freq * 9, 2, 0.03, vol * 0.5, 'bandpass', this.sfx, t);
  }

  thunder() {
    if (!this.ready) return;
    this.burst(90, 0.4, 2.6, 1.0, 'lowpass', this.amb, this.t + 0.25, 40);
    this.burst(1800, 0.5, 0.25, 0.3, 'bandpass', this.amb);
  }

  /** A continuous bed: 'rain' | 'crowd' | 'room' | 'wind'. level 0 fades it out. */
  bed(name: string, level: number, fade = 1.5) {
    if (!this.ready) return;
    let l = this.loops.get(name);
    if (!l && level > 0) {
      const c = this.ctx, s = c.createBufferSource(), g = c.createGain();
      s.buffer = this.noise; s.loop = true;
      const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
      if (name === 'rain') { f1.type = 'highpass'; f1.frequency.value = 1400; f2.type = 'lowpass'; f2.frequency.value = 9000; }
      else if (name === 'crowd') { f1.type = 'bandpass'; f1.frequency.value = 520; f1.Q.value = 0.5; f2.type = 'lowpass'; f2.frequency.value = 1800; }
      else if (name === 'wind') { f1.type = 'bandpass'; f1.frequency.value = 300; f1.Q.value = 0.8; f2.type = 'lowpass'; f2.frequency.value = 900; }
      else { f1.type = 'lowpass'; f1.frequency.value = 180; f2.type = 'lowpass'; f2.frequency.value = 400; }
      const lfo = c.createOscillator(), lg = c.createGain();   // slow swell so it breathes
      lfo.frequency.value = name === 'crowd' ? 0.23 : 0.11; lg.gain.value = name === 'room' ? 0 : 0.25;
      g.gain.value = 0.0001;
      lfo.connect(lg).connect(g.gain);
      s.connect(f1).connect(f2).connect(g).connect(this.amb);
      s.start(0, Math.random()); lfo.start();
      l = { g, stop: () => { s.stop(); lfo.stop(); } };
      this.loops.set(name, l);
    }
    if (!l) return;
    l.g.gain.cancelScheduledValues(this.t);
    l.g.gain.setTargetAtTime(Math.max(0.0001, level), this.t, fade / 3);
    if (level <= 0) { const ll = l; this.loops.delete(name); setTimeout(() => ll.stop(), fade * 1500); }
  }

  // ---------------------------------------------------------------- score
  setMood(m: Mood) {
    if (m === this.mood) return;
    this.mood = m; this.seq = 0; this.themeI = 0; this.themeT = 0;
    if (this.ready) this.nextT = this.t + 0.15;
  }

  private piano(midi: number, at: number, vol: number, dur = 2.2) {
    const f = hz(midi);
    this.tone(f, f, dur, vol, 'triangle', this.music, at);
    this.tone(f * 2, f * 2, dur * 0.5, vol * 0.3, 'sine', this.music, at);
    this.tone(f * 3.01, f * 3.01, dur * 0.25, vol * 0.12, 'sine', this.music, at);
  }

  private pad(notes: number[], at: number, dur: number, vol: number, bright = 700) {
    const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.value = bright; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, at + dur * 1.15);
    f.connect(g).connect(this.music);
    for (const n of notes) for (const det of [-6, 5]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det;
      o.connect(f); o.start(at); o.stop(at + dur * 1.2);
    }
  }

  /** Schedule what is due. Call every frame. */
  update() {
    if (!this.ready || this.mood === 'none') return;
    const t = this.t;
    if (this.nextT < t - 0.5) this.nextT = t + 0.05;
    while (this.nextT < t + 0.25) {
      const m = this.mood, at = this.nextT, s = this.seq;
      const major = m === 'dawn';
      const tr = (n: number) => (major && (n % 12 === 5 || n % 12 === 10 || n % 12 === 0) ? n + 1 : n) + (m === 'boss' ? -2 : 0);   // F Bb C -> F# B C#: D major
      if (m === 'theme' || m === 'dawn' || m === 'dread') {
        const beat = m === 'dread' ? 1.25 : 1.0;   // seconds per beat: slow
        if (this.themeT <= 0) {
          const [n, len] = THEME[this.themeI % THEME.length];
          if (m !== 'dread' || this.themeI % 2 === 0) this.piano(tr(n) + (m === 'dread' ? -12 : 0), at, m === 'dread' ? 0.12 : 0.2, 2.6);
          if (this.themeI % THEME.length === 0 || this.themeI % THEME.length === 7) {
            const ch = CHORDS[this.themeI % THEME.length === 0 ? 0 : 1].map(tr);
            this.pad(ch.slice(0, 4), at, beat * 7.5, m === 'dawn' ? 0.035 : 0.028, m === 'dawn' ? 1400 : 600);
          }
          this.themeI++; this.themeT = len;
        }
        this.themeT -= 0.5;
        this.nextT += beat * 0.5;
      } else {
        const bpm = m === 'boss' ? 138 : 124, six = 60 / bpm / 4, bar = Math.floor(s / 16) % 4, i = s % 16;
        const ch = CHORDS[bar].map(tr), k = this.intensity;
        if (i === 0) this.pad(ch.slice(1, 4), at, six * 16, 0.02 + 0.02 * k, 500 + 900 * k);
        if (i % 8 === 0 || (k > 0.6 && i === 10)) { this.tone(110, 38, 0.22, 0.55, 'sine', this.music, at); }
        if ((i === 4 || i === 12) && k > 0.25) this.burst(1700, 0.8, 0.09, 0.2, 'bandpass', this.music, at);
        if (i % 2 === 0) this.burst(7000, 1.2, 0.03, i % 4 === 2 ? 0.07 : 0.035, 'highpass', this.music, at);
        if ([0, 3, 6, 8, 11, 14].includes(i)) this.tone(hz(ch[0] + (i === 11 ? 7 : 0)), hz(ch[0]), six * 1.6, 0.22, 'sawtooth', this.lowpass(260 + 500 * k), at);
        if (k > 0.5 && [2, 5, 9, 13].includes(i)) this.tone(160 - 12 * (i % 3), 70, 0.14, 0.3, 'sine', this.music, at);   // toms
        if (k > 0.75 && i % 4 === 0) { const n = THEME[(Math.floor(s / 4)) % THEME.length][0]; this.tone(hz(tr(n) + 12), hz(tr(n) + 12), six * 3.5, 0.06, 'square', this.lowpass(1800), at); }
        this.nextT += six;
      }
      this.seq++;
    }
  }

  private lp = new Map<number, BiquadFilterNode>();
  private lowpass(freq: number) {
    const key = Math.round(freq / 100);
    let f = this.lp.get(key);
    if (!f) { f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = key * 100; f.connect(this.music); this.lp.set(key, f); }
    return f;
  }
}
