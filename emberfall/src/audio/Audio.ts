// Audio engine (WebAudio): buses (music, sfx, ambience, voice) -> compressor -> out.
//  * sfx: named sounds with variants (assets/audio/sfx/manifest.json), random variant + pitch jitter,
//    positional (equal-power pan + distance rolloff + air absorption low-pass), voice limiting
//  * music: tracks crossfade; combat intensity crossfades between an exploration and a combat track
//  * ambience: looping beds with per-bed gain
//  * ducking under dialogue / big moments
import * as THREE from 'three';

type Buffers = Map<string, AudioBuffer[]>;

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private voiceBus!: GainNode;
  private buffers: Buffers = new Map();
  private manifest: Record<string, number> = {};
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private listener = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);
  private music: { name: string; src: AudioBufferSourceNode; gain: GainNode }[] = [];
  private ambience = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private voices = 0;
  private duck = 1;
  volumes = { master: 0.9, music: 0.55, sfx: 0.9, ambience: 0.7, voice: 1 };
  muted = false;
  private lastPlayed = new Map<string, number>();

  /** must be called from a user gesture */
  async start(): Promise<void> {
    // resume() only settles after a user gesture: never let a level load wait on it
    const settle = (p: Promise<void>) => Promise.race([p, new Promise<void>((r) => window.setTimeout(r, 800))]);
    if (this.ctx) { if (this.ctx.state !== 'running') await settle(this.ctx.resume()); return; }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.musicBus = c.createGain();
    this.sfxBus = c.createGain();
    this.ambBus = c.createGain();
    this.voiceBus = c.createGain();
    for (const b of [this.musicBus, this.sfxBus, this.ambBus, this.voiceBus]) b.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(c.destination);
    this.applyVolumes();
    try {
      this.manifest = await fetch('assets/audio/sfx/manifest.json').then((r) => r.json());
    } catch { this.manifest = {}; }
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : this.volumes.master;
    this.master.gain.setTargetAtTime(m, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * this.duck, t, 0.3);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.volumes.ambience * (0.5 + 0.5 * this.duck), t, 0.3);
    this.voiceBus.gain.setTargetAtTime(this.volumes.voice, t, 0.05);
  }

  setDuck(k: number): void { this.duck = k; this.applyVolumes(); }

  private async decode(url: string): Promise<AudioBuffer | null> {
    let p = this.loading.get(url);
    if (!p) {
      p = (async () => {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          const ab = await r.arrayBuffer();
          return await this.ctx!.decodeAudioData(ab);
        } catch { return null; }
      })();
      this.loading.set(url, p);
    }
    return p;
  }

  /** preload sfx variants */
  async preload(names: string[]): Promise<void> {
    if (!this.ctx) return;
    await Promise.all(names.map((n) => this.variants(n)));
  }

  private async variants(name: string): Promise<AudioBuffer[]> {
    const have = this.buffers.get(name);
    if (have) return have;
    const n = this.manifest[name] ?? 0;
    const list: AudioBuffer[] = [];
    this.buffers.set(name, list);
    const bufs = await Promise.all(Array.from({ length: n }, (_, i) => this.decode(`assets/audio/sfx/${name}_${i}.mp3`)));
    for (const b of bufs) if (b) list.push(b);
    return list;
  }

  setListener(pos: THREE.Vector3, right: THREE.Vector3): void {
    this.listener.copy(pos);
    this.listenerRight.copy(right).normalize();
  }

  /** play a named sound (optionally at a world position) */
  sfx(name: string, pos?: THREE.Vector3 | null, vol = 1, opts: { pitch?: number; jitter?: number; bus?: 'sfx' | 'voice' | 'ambience'; minGap?: number } = {}): void {
    const c = this.ctx;
    if (!c || this.muted) return;
    const now = c.currentTime;
    const gap = opts.minGap ?? 0.03;
    if ((this.lastPlayed.get(name) ?? -1) > now - gap) return;
    this.lastPlayed.set(name, now);
    if (this.voices > 28) return;
    let gain = vol;
    let pan = 0;
    let lp = 20000;
    if (pos) {
      const d = pos.distanceTo(this.listener);
      gain *= 1 / (1 + Math.max(0, d - 2) * 0.18);
      if (gain < 0.02) return;
      const dir = pos.clone().sub(this.listener);
      pan = THREE.MathUtils.clamp(dir.dot(this.listenerRight) / Math.max(d, 1), -1, 1) * 0.8;
      lp = 20000 / (1 + d * 0.06);
    }
    const list = this.buffers.get(name);
    if (!list) { void this.variants(name).then(() => undefined); this.fallback(name, gain, pan); return; }
    if (!list.length) { this.fallback(name, gain, pan); return; }
    const buf = list[Math.floor(Math.random() * list.length)];
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (opts.jitter ?? 0.06));
    const g = c.createGain();
    g.gain.value = gain;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(opts.bus === 'voice' ? this.voiceBus : opts.bus === 'ambience' ? this.ambBus : this.sfxBus);
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start();
  }

  /** procedural stand-in so missing files never mean silence */
  private fallback(name: string, gain: number, pan: number): void {
    const c = this.ctx!;
    const dur = name.includes('swing') || name.includes('whoosh') ? 0.25 : 0.15;
    const n = Math.floor(c.sampleRate * dur);
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) { const t = i / n; d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t) * (1 - t); }
    const src = c.createBufferSource();
    src.buffer = b;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = name.includes('clang') || name.includes('parry') ? 2500 : 900;
    const g = c.createGain();
    g.gain.value = gain * 0.3;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.sfxBus);
    src.start();
  }

  /** crossfade to a music track (assets/audio/music/<name>.mp3), looping */
  async playMusic(name: string | null, fade = 2.5, vol = 1): Promise<void> {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const cur = this.music.find((m) => m.name === name);
    for (const m of this.music) {
      if (m === cur) continue;
      m.gain.gain.cancelScheduledValues(t);
      m.gain.gain.setValueAtTime(m.gain.gain.value, t);
      m.gain.gain.linearRampToValueAtTime(0, t + fade);
      const s = m.src;
      window.setTimeout(() => { try { s.stop(); } catch { /* ok */ } }, (fade + 0.2) * 1000);
    }
    this.music = cur ? [cur] : [];
    if (!name) return;
    if (cur) {
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(vol, t + fade);
      return;
    }
    const [buf, man] = await Promise.all([this.decode(`assets/audio/music/${name}.mp3`), this.musicManifest()]);
    if (!buf || !this.ctx) return;
    // another request may have superseded this one while it decoded
    if (this.music.some((m) => m.name === name)) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const info = man[name];
    src.loop = info ? info.loop : true;
    if (info?.loop) {
      // exact loop length: mp3 frames pad the end, so loop on the composed bar line, not the file end
      src.loopStart = 0;
      src.loopEnd = Math.min(buf.duration, info.length);
    }
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(vol, c.currentTime + fade);
    src.connect(g).connect(this.musicBus);
    src.start();
    this.music.push({ name, src, gain: g });
  }

  private musicMan: Promise<Record<string, { loop: boolean; length: number }>> | null = null;
  private musicManifest(): Promise<Record<string, { loop: boolean; length: number }>> {
    this.musicMan ??= fetch('assets/audio/music/manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    return this.musicMan;
  }

  get currentMusic(): string | null { return this.music.length ? this.music[this.music.length - 1].name : null; }

  /** looping ambience bed */
  async ambient(name: string, vol: number, fade = 2): Promise<void> {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const have = this.ambience.get(name);
    if (have) {
      have.gain.gain.cancelScheduledValues(t);
      have.gain.gain.setValueAtTime(have.gain.gain.value, t);
      have.gain.gain.linearRampToValueAtTime(vol, t + fade);
      if (vol <= 0) {
        window.setTimeout(() => { try { have.src.stop(); } catch { /* ok */ } this.ambience.delete(name); }, (fade + 0.1) * 1000);
      }
      return;
    }
    if (vol <= 0) return;
    const list = await this.variants(name);
    if (!list.length || !this.ctx) return;
    const src = c.createBufferSource();
    src.buffer = list[0];
    src.loop = true;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(vol, c.currentTime + fade);
    src.connect(g).connect(this.ambBus);
    src.start(0, Math.random() * list[0].duration);
    this.ambience.set(name, { src, gain: g });
  }

  stopAmbience(fade = 1.5): void {
    for (const k of [...this.ambience.keys()]) void this.ambient(k, 0, fade);
  }
}
