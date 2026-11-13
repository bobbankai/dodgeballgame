import type { Sfx as SfxApi } from '@/gameplay/ctx';
import type * as THREE from 'three/webgpu';

/**
 * Sound effect front door. The synthesised sound design (impacts, foley, temporal ability sounds, ambience, layered music) plugs in behind
 * `play`. Until that audio pass lands this records calls only (tests assert on them) and makes no sound: it is NOT finished sound design.
 */
export class Sfx implements SfxApi {
  enabled = true;
  log: Array<{ name: string; t: number }> = [];
  private t0 = performance.now();

  play(name: string, _opts?: { at?: THREE.Vector3; volume?: number; pitch?: number }): void {
    if (!this.enabled) return;
    this.log.push({ name, t: performance.now() - this.t0 });
    if (this.log.length > 400) this.log.splice(0, 200);
  }
}
