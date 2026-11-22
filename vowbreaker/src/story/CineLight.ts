import type { Camera } from '@babylonjs/core';
import type { Lighting } from '../render/Materials';

type V3 = [number, number, number];

/** A cutscene light rig (vb_cine_light). Directions are camera-relative: x right, y up, z away. */
export interface CineRig {
  amount: number;
  /** 0 none, 1 blinds, 2 leaves, 3 window, 4 rain on glass, 5 caustics, 6 shoji, 7 fire, 8 stained glass */
  gobo: number;
  goboScale: number;
  flicker: number;
  key: V3;
  keyColor: V3;
  rim: V3;
  rimColor: V3;
  rimWidth: number;
  fill: V3;
  contrast: number;
  under: number;
  halo: number;
  eyeLight: number;
}

const BASE: CineRig = {
  amount: 0.85, gobo: 0, goboScale: 1, flicker: 0, key: [0.7, 0.4, -0.5], keyColor: [0.5, 0.47, 0.42], rim: [-0.6, 0.3, 0.9],
  rimColor: [0.6, 0.7, 1.0], rimWidth: 0.2, fill: [0.3, 0.32, 0.5], contrast: 0.35, under: 0, halo: 0, eyeLight: 0.6,
};

const P = (o: Partial<CineRig>): CineRig => ({ ...BASE, ...o });

/** The looks a cutscene can light its actors with. */
export const CINE: Record<string, CineRig> = {
  // hard side key, cold rim, the shadow side sinking into blue
  drama: P({ key: [0.85, 0.35, -0.4], keyColor: [0.55, 0.5, 0.45], rim: [-0.7, 0.3, 0.9], rimColor: [0.6, 0.8, 1.25], rimWidth: 0.24, fill: [0.22, 0.25, 0.45], contrast: 0.65 }),
  // memories: soft warm light, gold rims, a glow round everyone, no hard shadows
  memory: P({ key: [0.3, 0.6, -0.6], keyColor: [0.42, 0.33, 0.22], rim: [0, 0.4, 1], rimColor: [1.0, 0.8, 0.45], rimWidth: 0.3, fill: [0.95, 0.8, 0.65], contrast: 0.12, halo: 0.75, eyeLight: 1 }),
  // light through venetian blinds
  blinds: P({ gobo: 1, goboScale: 1.6, key: [0.9, 0.3, -0.2], keyColor: [0.75, 0.62, 0.45], rimColor: [0.5, 0.6, 0.9], fill: [0.28, 0.28, 0.42], contrast: 0.5 }),
  // sun through leaves
  leaves: P({ gobo: 2, goboScale: 1.2, key: [0.4, 0.8, -0.3], keyColor: [0.55, 0.52, 0.4], rimColor: [0.8, 0.9, 0.7], rimWidth: 0.16, fill: [0.45, 0.55, 0.5], contrast: 0.35 }),
  // moonlight through a window
  window: P({ gobo: 3, goboScale: 0.6, key: [-0.7, 0.45, 0.2], keyColor: [0.42, 0.52, 0.8], rim: [0.7, 0.3, 0.9], rimColor: [0.5, 0.6, 1.0], fill: [0.13, 0.16, 0.32], contrast: 0.55 }),
  // a rainy night: cold light rippling through wet glass, a neon rim
  rain: P({ gobo: 4, goboScale: 1.0, key: [0.6, 0.4, -0.4], keyColor: [0.38, 0.45, 0.68], rim: [-0.6, 0.2, 1.0], rimColor: [1.0, 0.35, 0.7], rimWidth: 0.22, fill: [0.13, 0.15, 0.28], contrast: 0.5 }),
  // firelight: from below and the side, breathing and stuttering, an orange rim
  fire: P({ gobo: 7, flicker: 0.6, under: 0.55, key: [0.4, -0.15, -0.6], keyColor: [0.75, 0.36, 0.12], rim: [-0.5, 0.3, 0.9], rimColor: [1.0, 0.42, 0.15], rimWidth: 0.26, fill: [0.22, 0.07, 0.06], contrast: 0.55 }),
  // light off water
  water: P({ gobo: 5, goboScale: 0.8, key: [0.2, 0.9, -0.2], keyColor: [0.4, 0.6, 0.7], rimColor: [0.5, 0.9, 1.0], fill: [0.2, 0.33, 0.42], contrast: 0.25 }),
  // through a shoji screen
  shoji: P({ gobo: 6, goboScale: 1.0, key: [0.85, 0.3, 0.1], keyColor: [0.62, 0.56, 0.45], rimColor: [0.9, 0.8, 0.6], fill: [0.33, 0.3, 0.4], contrast: 0.4 }),
  // light through a chapel's stained glass, coloured pane by pane
  glass: P({ gobo: 8, goboScale: 0.9, key: [-0.6, 0.5, 0.3], keyColor: [0.55, 0.55, 0.6], rim: [0.7, 0.3, 0.9], rimColor: [0.6, 0.65, 1.0], fill: [0.15, 0.17, 0.32], contrast: 0.5 }),
  // lantern-lit festival night: warm and soft
  lantern: P({ gobo: 7, flicker: 0.2, key: [0.5, 0.5, -0.5], keyColor: [0.6, 0.42, 0.25], rim: [-0.6, 0.3, 0.9], rimColor: [1.0, 0.55, 0.85], fill: [0.25, 0.2, 0.35], contrast: 0.3 }),
  // a stand-off: red rim from one side, the shadow side in blue
  confront: P({ key: [0.1, 0.5, -0.85], keyColor: [0.4, 0.35, 0.33], rim: [-0.9, 0.2, 0.6], rimColor: [1.2, 0.25, 0.18], rimWidth: 0.26, fill: [0.18, 0.22, 0.5], contrast: 0.6 }),
};

/** Which look each place lights its cutscenes with (none: the stage's own light only). */
const STAGE_CINE: Record<string, string> = {
  village_burning: 'fire', apartment: 'fire', alley: 'rain', academy_night: 'rain', chapel: 'glass', graves: 'leaves',
  estate: 'shoji', academy: 'leaves', village: 'lantern', subway: 'drama', crossing: 'confront', tower: 'confront',
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/**
 * The cutscene light rig: eases toward the look it is given, turns its camera-relative lights into
 * world directions every frame (the lights stay where the shot wants them as the camera cuts),
 * and writes the toon shader's `cine` uniform array.
 */
export class CineLight {
  private cur: CineRig = { ...BASE, amount: 0 };
  private target: CineRig = { ...BASE, amount: 0 };
  private rate = 1.5;
  /** the look of the current place, restored after memories, domains and fights */
  stageLook: string | null = null;

  set(look: string | CineRig | null, over: Partial<CineRig> = {}, fade = 0.7): void {
    const base = typeof look === 'string' ? CINE[look] : look;
    this.target = base ? { ...base, ...over } : { ...this.cur, amount: 0 };
    this.rate = 1 / Math.max(0.05, fade);
    // discrete things (the gobo's shape) switch at once; everything else eases
    if (base) {
      this.cur.gobo = this.target.gobo;
      this.cur.goboScale = this.target.goboScale;
    }
  }

  /** Back to the place's own look (or none). */
  restore(fade = 0.8): void {
    this.set(this.stageLook, {}, fade);
  }

  setStage(id: string): void {
    this.stageLook = STAGE_CINE[id] ?? null;
    this.set(this.stageLook, {}, 0.05);
  }

  update(dt: number, cam: Camera, l: Lighting): void {
    const k = Math.min(1, dt * this.rate * 3);
    const c = this.cur;
    const t = this.target;
    c.amount = lerp(c.amount, t.amount, k);
    c.flicker = lerp(c.flicker, t.flicker, k);
    c.key = lerp3(c.key, t.key, k);
    c.keyColor = lerp3(c.keyColor, t.keyColor, k);
    c.rim = lerp3(c.rim, t.rim, k);
    c.rimColor = lerp3(c.rimColor, t.rimColor, k);
    c.rimWidth = lerp(c.rimWidth, t.rimWidth, k);
    c.fill = lerp3(c.fill, t.fill, k);
    c.contrast = lerp(c.contrast, t.contrast, k);
    c.under = lerp(c.under, t.under, k);
    c.halo = lerp(c.halo, t.halo, k);
    c.eyeLight = lerp(c.eyeLight, t.eyeLight, k);
    // camera-relative to world
    const m = cam.getWorldMatrix();
    const right = { x: m.m[0], y: m.m[1], z: m.m[2] };
    const up = { x: m.m[4], y: m.m[5], z: m.m[6] };
    const fwd = { x: m.m[8], y: m.m[9], z: m.m[10] };
    const world = (v: V3): V3 => [
      right.x * v[0] + up.x * v[1] + fwd.x * v[2],
      right.y * v[0] + up.y * v[1] + fwd.y * v[2],
      right.z * v[0] + up.z * v[1] + fwd.z * v[2],
    ];
    const kd = world(c.key);
    const rd = world(c.rim);
    l.cine.set([
      c.amount < 0.005 ? 0 : c.amount, c.gobo, c.goboScale, c.flicker,
      kd[0], kd[1], kd[2], c.rimWidth,
      c.keyColor[0], c.keyColor[1], c.keyColor[2], c.eyeLight,
      rd[0], rd[1], rd[2], c.contrast,
      c.rimColor[0], c.rimColor[1], c.rimColor[2], c.under,
      c.fill[0], c.fill[1], c.fill[2], c.halo,
    ]);
  }
}
