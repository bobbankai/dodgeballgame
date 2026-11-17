import type * as THREE from 'three/webgpu';

/**
 * Frame timing: CPU time between frames (what the player feels), GPU time per frame from timestamp queries where the device
 * has them, and the slow tail (the 99th percentile frame of the last ~2 s), which is what hitches look like.
 */
export class FrameTiming {
  /** smoothed frame interval (ms) */
  frameMs = 16.7;
  /** smoothed GPU render time (ms); null where timestamps are unavailable */
  gpuMs: number | null = null;
  /** 99th percentile frame interval over the window (ms) */
  p99Ms = 16.7;
  private last = 0;
  private window: number[] = [];
  private resolving = false;

  constructor(private renderer: THREE.WebGPURenderer) {
    this.timestamps = !!(renderer.backend as any)?.trackTimestamp;
  }

  private timestamps: boolean;

  /** Call once per rendered frame, after the render. */
  frame(): void {
    const now = performance.now();
    if (this.last) {
      const dt = Math.min(250, now - this.last);
      this.frameMs += (dt - this.frameMs) * 0.08;
      this.window.push(dt);
      if (this.window.length > 120) this.window.shift();
      if (this.window.length % 15 === 0) {
        const s = [...this.window].sort((a, b) => a - b);
        this.p99Ms = s[Math.min(s.length - 1, Math.floor(s.length * 0.99))];
      }
    }
    this.last = now;
    if (this.timestamps && !this.resolving) {
      this.resolving = true;
      void this.renderer.resolveTimestampsAsync('render' as any).then((ms: unknown) => {
        const v = typeof ms === 'number' ? ms : (this.renderer.info.render as any).timestamp;
        if (typeof v === 'number' && v > 0) this.gpuMs = this.gpuMs === null ? v : this.gpuMs + (v - this.gpuMs) * 0.1;
      }).catch(() => { this.timestamps = false; }).finally(() => { this.resolving = false; });
    }
  }

  get fps(): number { return 1000 / Math.max(1e-3, this.frameMs); }
}
