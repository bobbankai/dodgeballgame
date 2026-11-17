import * as THREE from 'three/webgpu';
import { Ocean } from '@/graphics/water/ocean';
import type { Game } from '@/game';
import type { Marker } from './level';

/** The layer the sea's mirror renders (the section's structure; the sky background always reflects). */
export const SEA_LAYER = 4;

/**
 * Open sea (`graphics/water/ocean.ts`): a camera-following Gerstner sheet with a planar mirror, depth colour over a seabed,
 * crest and shore foam, sun glints. A level places it with a 'sea' marker (level, sea state per reality); rocks marked
 * 'searock' rise out of the seabed so foam wraps them.
 */
export class Sea {
  private ocean: Ocean | null = null;
  private def: { marker: Marker; section: number } | null = null;
  private rocks: { x: number; z: number; r: number }[] = [];
  private on = false;
  private sunDir = new THREE.Vector3(0.4, 0.6, 0.3).normalize();
  private fogColor = new THREE.Color(0.62, 0.7, 0.8);
  private sunCol = new THREE.Color(0, 0, 0);

  constructor(private g: Game) {}

  /** A section's sea marker (one sea per chapter) and its rocks. */
  register(marker: Marker, section: number, rocks: Marker[]): void {
    this.def = { marker, section };
    for (const r of rocks) this.rocks.push({ x: r.pos.x, z: r.pos.z, r: Number(r.data.r ?? 6) });
  }

  private build(): void {
    if (this.ocean || !this.def) return;
    const m = this.def.marker;
    const level = m.pos.y;
    this.ocean = new Ocean(this.g.scene, {
      seaLevel: level,
      preset: String(m.data.preset ?? 'Coastal breeze'),
      // a deep sea floor with the rocks rising out of it
      heightAt: (x: number, z: number) => {
        let h = level - 45;
        for (const r of this.rocks) {
          const d = Math.hypot(x - r.x, z - r.z);
          if (d < r.r * 1.6) h = Math.max(h, level + 0.4 - (d / (r.r * 1.6)) * 30);
        }
        return h;
      },
      air: this.fogColor,
      mirrorScale: this.g.gfx.settings.preset === 'ultra' ? 0.5 : 0.35,
    });
    this.ocean.setReflectionLayers(1 << SEA_LAYER);
    this.ocean.bakeBedNow(this.g.camera.camera.position.x, this.g.camera.camera.position.z);
  }

  /** Show the sea while Ethan is in (or next to) its section, in the current reality's mood. */
  setPlace(current: number, timeline: 'a' | 'b', sun: THREE.Vector3 | null, fog: THREE.Color | null, sunCol: THREE.Color | null = null): void {
    if (!this.def) return;
    this.on = Math.abs(current - this.def.section) <= 1;
    if (!this.on) { if (this.ocean) this.ocean.mesh.visible = false; return; }
    this.build();
    const o = this.ocean!;
    o.mesh.visible = true;
    const m = this.def.marker;
    o.applyPreset(String((timeline === 'b' ? m.data.preset_b : m.data.preset) ?? 'Coastal breeze'));
    if (sun && sun.lengthSq() > 0) this.sunDir.copy(sun).normalize();
    if (fog) this.fogColor.copy(fog);
    this.sunCol.copy(sunCol ?? new THREE.Color(0, 0, 0));
  }

  /** Per rendered frame, before the scene pass. */
  frame(dt: number): void {
    if (!this.ocean || !this.on) return;
    const cam = this.g.camera.camera;
    this.ocean.update(cam, dt, this.sunDir, this.sunCol, this.fogColor);
  }
}
