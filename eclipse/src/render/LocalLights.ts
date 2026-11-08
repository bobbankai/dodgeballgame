import { ClusteredLightContainer, Color3, PointLight, Vector3, type Light, type Scene } from '@babylonjs/core';
import { log } from '../core/Log';

export interface LocalLightOptions {
  color: [number, number, number];
  intensity: number;
  range: number;
  /** Fire flicker amount (0 = steady). */
  flicker?: number;
  /** Flicker speed multiplier. */
  speed?: number;
}

interface Managed {
  light: PointLight;
  base: number;
  flicker: number;
  speed: number;
  seed: number;
}

/**
 * Many small lights (fires, braziers, lava, lanterns, spell flashes) through Babylon's clustered
 * lighting: the container counts as a single light in every material, and the GPU only shades the
 * lights whose range touches each screen tile and depth slice. Fires flicker with layered noise.
 * Falls back to plain point lights (capped) where clustering is unsupported.
 */
export class LocalLights {
  private container: ClusteredLightContainer | null = null;
  private lights: Managed[] = [];
  private time = 0;
  /** Without clustering, only this many point lights are created. */
  fallbackMax = 2;

  constructor(private scene: Scene) {
    try {
      const c = new ClusteredLightContainer('localLights', [], scene);
      if (c.isSupported) {
        c.maxRange = 40;
        this.container = c;
      } else {
        c.dispose();
      }
    } catch (e) {
      log.warn('clustered lights unavailable', e);
    }
  }

  get clustered(): boolean {
    return this.container !== null;
  }

  add(at: Vector3, o: LocalLightOptions): PointLight | null {
    if (!this.container && this.lights.length >= this.fallbackMax) return null;
    const l = new PointLight(`ll${this.lights.length}`, at.clone(), this.scene);
    l.diffuse = new Color3(...o.color);
    l.specular = l.diffuse.scale(0.6);
    l.intensity = o.intensity;
    l.range = o.range;
    l.shadowEnabled = false;
    if (this.container) this.container.addLight(l);
    this.lights.push({ light: l, base: o.intensity, flicker: o.flicker ?? 0, speed: o.speed ?? 1, seed: Math.random() * 100 });
    return l;
  }

  remove(l: Light): void {
    const i = this.lights.findIndex((m) => m.light === l);
    if (i < 0) return;
    this.container?.removeLight(l);
    l.dispose();
    this.lights.splice(i, 1);
  }

  /** Changes a light's resting brightness (flashes, fading fires). */
  setIntensity(l: Light, v: number): void {
    const m = this.lights.find((x) => x.light === l);
    if (m) m.base = v;
    l.intensity = v;
  }

  update(dt: number): void {
    this.time += dt;
    for (const m of this.lights) {
      // steady lights are left alone (spell flashes drive their own intensity)
      if (m.flicker <= 0) continue;
      const t = this.time * m.speed + m.seed;
      // three incommensurate waves plus a fast jitter: reads as fire, never as a loop
      const n = 0.5 * Math.sin(t * 7.3) + 0.3 * Math.sin(t * 13.7 + 1.3) + 0.2 * Math.sin(t * 23.1 + 4.1);
      m.light.intensity = Math.max(0, m.base * (1 + m.flicker * n * 0.6));
    }
  }

  clear(): void {
    for (const m of this.lights) {
      this.container?.removeLight(m.light);
      m.light.dispose();
    }
    this.lights = [];
  }
}
