import * as THREE from 'three/webgpu';

/**
 * The audio engine (Web Audio). Every sound is synthesised at runtime (no sample library), routed through mix buses:
 *   sfx (3D positioned, HRTF) -> reverb send     music (the adaptive score)     ambience (beds per space)     voice
 *   all -> master -> soft-knee compressor (glue) -> destination
 * The reverb is a generated impulse response that changes with the space (`setSpace`: interior halls ring, exteriors are open).
 * The context starts on the first user gesture (browser autoplay policy); before that, calls are dropped.
 */
export type Space = 'interior' | 'hall' | 'exterior';

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  amb!: GainNode;
  voice!: GainNode;
  verbIn!: GainNode;
  private verb!: ConvolverNode;
  private noiseBuf: AudioBuffer | null = null;
  private pinkBuf: AudioBuffer | null = null;
  private space: Space | null = null;
  private loops = new Map<string, { stop: (t?: number) => void; gain: GainNode; panner?: PannerNode }>();

  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp).connect(ctx.destination);
    const bus = (v: number) => { const g = ctx.createGain(); g.gain.value = v; g.connect(this.master); return g; };
    this.sfx = bus(0.9); this.music = bus(0.42); this.amb = bus(0.5); this.voice = bus(1.0);
    this.verb = ctx.createConvolver();
    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 0.32;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.9;
    this.verbIn.connect(this.verb).connect(verbOut).connect(this.master);
    this.setSpace('interior');
  }

  get now(): number { return this.ctx ? this.ctx.currentTime : 0; }

  /** White / pink noise buffers (shared, 2 s, looped by sources that need more). */
  noise(pink = false): AudioBuffer {
    const ctx = this.ctx!;
    if (pink ? this.pinkBuf : this.noiseBuf) return (pink ? this.pinkBuf : this.noiseBuf)!;
    const n = ctx.sampleRate * 2;
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (pink) { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else d[i] = w;
    }
    if (pink) this.pinkBuf = b; else this.noiseBuf = b;
    return b;
  }

  /** The room: a generated impulse response (decaying filtered noise; early reflections denser indoors). */
  setSpace(space: Space): void {
    if (!this.ctx || this.space === space) return;
    this.space = space;
    const ctx = this.ctx;
    const len = { interior: 1.6, hall: 3.2, exterior: 0.9 }[space];
    const damp = { interior: 0.55, hall: 0.35, exterior: 0.8 }[space];
    const n = Math.floor(ctx.sampleRate * len);
    const ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        const env = Math.exp(-t * (6.9 / len));
        const w = (Math.random() * 2 - 1) * env;
        lp += (w - lp) * (1 - damp * Math.min(1, t * 2)); // high frequencies die first
        d[i] = lp * (space === 'exterior' && t < 0.05 ? 0.2 : 1);
      }
    }
    this.verb.buffer = ir;
    this.verbIn.gain.setTargetAtTime(space === 'exterior' ? 0.12 : space === 'hall' ? 0.42 : 0.3, ctx.currentTime, 0.3);
  }

  /** An output for one sound: positioned (HRTF panner) when `at` is given, with a reverb send. */
  out(opts: { at?: THREE.Vector3; volume?: number; bus?: GainNode; dry?: number; wet?: number } = {}): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    let tail: AudioNode = g;
    if (opts.at) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 2.5;
      p.rolloffFactor = 1.1;
      p.positionX.value = opts.at.x; p.positionY.value = opts.at.y; p.positionZ.value = opts.at.z;
      g.connect(p);
      tail = p;
    }
    const dry = ctx.createGain();
    dry.gain.value = opts.dry ?? 1;
    tail.connect(dry).connect(opts.bus ?? this.sfx);
    const wet = ctx.createGain();
    wet.gain.value = opts.wet ?? 1;
    tail.connect(wet).connect(this.verbIn);
    return g;
  }

  /** The listener follows the camera. */
  listen(cam: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.getWorldPosition(new THREE.Vector3());
    const f = cam.getWorldDirection(new THREE.Vector3());
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    }
  }

  /** A named loop (drones, hums, beds): started once, faded out by `stopLoop`. */
  startLoop(id: string, make: (out: GainNode) => (t?: number) => void, opts: { at?: THREE.Vector3; volume?: number; bus?: GainNode; fade?: number } = {}): void {
    if (!this.ctx || this.loops.has(id)) return;
    const g = this.out({ at: opts.at, volume: 0, bus: opts.bus, wet: opts.bus === this.amb ? 0.4 : 1 });
    const stop = make(g);
    g.gain.setTargetAtTime(opts.volume ?? 1, this.ctx.currentTime, (opts.fade ?? 0.6) / 3);
    this.loops.set(id, { stop, gain: g });
  }

  stopLoop(id: string, fade = 0.8): void {
    const l = this.loops.get(id);
    if (!l || !this.ctx) return;
    this.loops.delete(id);
    l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    l.stop(this.ctx.currentTime + fade + 0.1);
  }

  hasLoop(id: string): boolean { return this.loops.has(id); }

  setLoopVolume(id: string, v: number, tc = 0.3): void {
    const l = this.loops.get(id);
    if (l && this.ctx) l.gain.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }
}
