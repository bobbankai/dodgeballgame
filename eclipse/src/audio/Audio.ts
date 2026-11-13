import { Vector3 } from '@babylonjs/core';
import { assetUrl } from '../assets/paths';
import { log } from '../core/Log';

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  ambience: number;
}

/** audio/manifest.json: sound name -> variant files (picked at random) and mix defaults. */
interface SoundDef {
  files: string[];
  volume?: number;
  /** Random pitch spread (+/- semitones). */
  pitch?: number;
  /** Distance (m) at which the sound has fallen to half. */
  ref?: number;
  bus?: 'sfx' | 'voice' | 'ambience' | 'ui';
}

interface Manifest {
  sounds: Record<string, SoundDef>;
  music: Record<string, { stems: Record<string, string>; bpm: number; bars: number }>;
}

export interface PlayOptions {
  at?: Vector3;
  volume?: number;
  /** Semitone offset (plus the sound's own random spread). */
  pitch?: number;
  delay?: number;
}

export interface LoopHandle {
  setVolume(v: number, time?: number): void;
  move(at: Vector3): void;
  stop(fade?: number): void;
}

type MusicState = 'silence' | 'explore' | 'combat' | 'boss';

/**
 * The game's sound: Web Audio buses (master > music / sfx / voice / ambience / ui, gains from the
 * settings), HRTF-spatialised one-shots with variant and pitch randomisation, positional loops
 * (fires, lava, wind), and adaptive music. Music is authored as synchronised stems of one piece per
 * area (`explore` pads and melody, `combat` percussion and brass, ...); the state machine fades
 * stems in and out on the beat grid, so a fight swells the same music rather than cutting to another.
 *
 * The context starts suspended until the first user gesture (browser policy); nothing is lost before
 * that, sounds simply do not play.
 */
export class Audio {
  readonly ctx: AudioContext;
  private master: GainNode;
  private buses: Record<string, GainNode> = {};
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private manifest: Manifest | null = null;
  private musicStems: { name: string; src: AudioBufferSourceNode; gain: GainNode }[] = [];
  private musicPiece = '';
  private state: MusicState = 'silence';
  /** 0..1 how intense the current fight is (enemies engaged, boss phase). */
  intensity = 0;
  enabled = true;

  constructor(private settings: AudioSettings) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    // a gentle bus compressor keeps big fights from clipping
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(this.ctx.destination);
    for (const b of ['music', 'sfx', 'voice', 'ambience', 'ui']) {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    this.applySettings();
    const resume = () => {
      if (this.ctx.state !== 'running') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }

  applySettings(): void {
    const s = this.settings;
    this.master.gain.value = s.master;
    this.buses.music.gain.value = s.music;
    this.buses.sfx.gain.value = s.sfx;
    this.buses.voice.gain.value = s.voice;
    this.buses.ambience.gain.value = s.ambience;
    this.buses.ui.gain.value = s.sfx;
  }

  async load(): Promise<void> {
    try {
      const r = await fetch(assetUrl('audio/manifest.json'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.manifest = await r.json();
    } catch (e) {
      log.warn('no audio manifest', e);
    }
  }

  private buffer(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = fetch(assetUrl(`audio/${file}`))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((a) => this.ctx.decodeAudioData(a))
        .catch((e) => {
          log.warn(`audio ${file}`, e);
          return null;
        });
      this.buffers.set(file, p);
    }
    return p;
  }

  /** Decodes every variant of the given sounds ahead of time (level load). */
  async preload(names: string[]): Promise<void> {
    if (!this.manifest) return;
    const files = names.flatMap((n) => this.manifest!.sounds[n]?.files ?? []);
    await Promise.all(files.map((f) => this.buffer(f)));
  }

  /** Listener follows the camera (position + orientation). */
  setListener(pos: Vector3, forward: Vector3, up: Vector3): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    }
  }

  private panner(at: Vector3, ref: number): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = 200;
    p.rolloffFactor = 1.1;
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
    return p;
  }

  play(name: string, o: PlayOptions = {}): void {
    if (!this.enabled || !this.manifest || this.ctx.state !== 'running') return;
    const def = this.manifest.sounds[name];
    if (!def || !def.files.length) return;
    const file = def.files[Math.floor(Math.random() * def.files.length)];
    void this.buffer(file).then((buf) => {
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const semis = (o.pitch ?? 0) + (Math.random() * 2 - 1) * (def.pitch ?? 1);
      src.playbackRate.value = Math.pow(2, semis / 12);
      const g = this.ctx.createGain();
      g.gain.value = (def.volume ?? 1) * (o.volume ?? 1);
      let node: AudioNode = src.connect(g);
      if (o.at) node = node.connect(this.panner(o.at, def.ref ?? 4));
      node.connect(this.buses[def.bus ?? 'sfx']);
      src.start(this.ctx.currentTime + (o.delay ?? 0));
    });
  }

  /** A positional (or global) loop, e.g. a fire or the wind. */
  loop(name: string, at?: Vector3, volume = 1): LoopHandle {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    let pan: PannerNode | null = null;
    let src: AudioBufferSourceNode | null = null;
    const def = this.manifest?.sounds[name];
    let stopped = false;
    if (def && def.files.length) {
      void this.buffer(def.files[0]).then((buf) => {
        if (!buf || stopped) return;
        src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        let node: AudioNode = src.connect(g);
        if (at) {
          pan = this.panner(at, def.ref ?? 6);
          node = node.connect(pan);
        }
        node.connect(this.buses[def.bus ?? 'ambience']);
        // start at a random point so identical loops never phase together
        src.start(ctx.currentTime, Math.random() * buf.duration);
        g.gain.setTargetAtTime((def.volume ?? 1) * volume, ctx.currentTime, 0.5);
      });
    }
    return {
      setVolume: (v, time = 0.5) => g.gain.setTargetAtTime((def?.volume ?? 1) * v, ctx.currentTime, time),
      move: (p) => {
        if (!pan) return;
        pan.positionX.value = p.x;
        pan.positionY.value = p.y;
        pan.positionZ.value = p.z;
      },
      stop: (fade = 0.6) => {
        stopped = true;
        g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
        const s = src;
        if (s) setTimeout(() => s.stop(), fade * 1000 + 100);
      },
    };
  }

  // ------------------------------------------------------------------ adaptive music
  /** Starts an area's piece: every stem begins together and loops; levels are set by the state. */
  async music(piece: string): Promise<void> {
    if (piece === this.musicPiece || !this.manifest) return;
    const def = this.manifest.music[piece];
    if (!def) return;
    this.stopMusic(2);
    this.musicPiece = piece;
    const stems = await Promise.all(Object.entries(def.stems).map(async ([name, file]) => [name, await this.buffer(file)] as const));
    if (this.musicPiece !== piece) return;
    const t0 = this.ctx.currentTime + 0.1;
    for (const [name, buf] of stems) {
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.buses.music);
      src.start(t0);
      this.musicStems.push({ name, src, gain });
    }
    this.applyMusic(3);
  }

  stopMusic(fade = 2): void {
    const t = this.ctx.currentTime;
    for (const s of this.musicStems) {
      s.gain.gain.setTargetAtTime(0, t, fade / 3);
      const src = s.src;
      setTimeout(() => src.stop(), fade * 1000 + 200);
    }
    this.musicStems = [];
    this.musicPiece = '';
  }

  setState(s: MusicState): void {
    if (s === this.state) return;
    this.state = s;
    this.applyMusic(s === 'combat' || s === 'boss' ? 1.2 : 4);
  }

  /** Stem levels for the current state: stems are named for the layer they belong to. */
  private applyMusic(fade: number): void {
    const t = this.ctx.currentTime;
    const want = (name: string): number => {
      const st = this.state;
      if (st === 'silence') return 0;
      if (name.startsWith('explore')) return st === 'explore' ? 1 : st === 'combat' ? 0.55 : 0.0;
      if (name.startsWith('combat')) return st === 'combat' ? 0.6 + 0.4 * this.intensity : 0;
      if (name.startsWith('boss')) return st === 'boss' ? 1 : 0;
      return 1;
    };
    for (const s of this.musicStems) s.gain.gain.setTargetAtTime(want(s.name), t, fade / 3);
  }

  /** Re-evaluates stem levels when the intensity changes during a fight. */
  updateIntensity(v: number): void {
    if (Math.abs(v - this.intensity) < 0.05) return;
    this.intensity = v;
    if (this.state === 'combat') this.applyMusic(1.5);
  }
}
