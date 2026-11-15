import type * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { createWindowMaterial } from './windowMaterial.tsl.js';
import type { Recipe } from '@/rendering/charmat';

/**
 * Window panes of the city's towers (citykit.lit_windows): the interior-mapping kit (`.claude/skills/interior-mapping`) draws a room
 * behind every pane, from the pane's own window coordinates (a third UV set: each window spans one unit, its integer cell is its
 * seed): the sash and glazing bars, blinds or curtains a few centimetres behind the glass, a blurred room with furniture masses
 * further back, all in parallax; after dark a share of the rooms have their lights on, warm homes and mixed office lighting.
 * The pane is part of the baked static mesh, so its frame and dressing take the lightmap like the facade around it, and the glass
 * mirrors the section's environment probe (the kit's own fake sky is off: it is for scenes without an environment).
 * Once one window shrinks below a couple of pixels the per-window pattern gives way to the mean of all windows (the kit's
 * level-of-detail note), blended by the screen-space size of the window grid so nothing pops and distant facades do not shimmer.
 */
export function windowMaterial(r: Recipe): THREE.Material {
  const office = r.era === 'modern';
  const lit = Math.min(0.9, Math.max(0, Number(r.lit ?? 0.3)));
  const m = createWindowMaterial({
    coords: (TSL as any).uv(2),
    unitsPerMeter: 1,
    night: Number(r.night ?? 0),
    litRatio: lit,
    // offices after hours: warm LED panels, some cold fluorescent floors; homes: incandescent and the odd television
    warm: office ? 0xffe0b5 : 0xffb066,
    cool: office ? 0xcfdcff : 0x9fc4ff,
    coolChance: office ? 0.4 : 0.12,
    lightLevel: office ? 1.0 : 1.25,
    transmission: 0.3,
    dressing: office ? { venetian: 2, roller: 1.2, bare: 1.6 } : { curtains: 2, roller: 1, venetian: 1, bare: 0.6 },
    dressingColorA: office ? 0xb9b6ae : 0xc4b7a2,
    dressingColorB: office ? 0x6f6d68 : 0x7e6d5a,
    dropMin: 0.25,
    sheerChance: office ? 0.05 : 0.4,
    panes: office ? [3, 1] : [2, 2],
    frameColor: office ? 0x2b2e33 : 0xcfc8bb,
    interiorTint: office ? 0x7f8285 : 0x8f887c,
    interiorDepth: office ? 3.2 : 2.6,
    ambient: 0.35,
    haze: office ? 0.1 : 0.04,
    reflection: 0,
    glassReflectance: 0.08,
    seed: office ? 3 : r.era === 'brick' ? 11 : 7,
  });
  // far facades: the average window (a dark room by day's end, a faint glow of the lit share at night)
  const w = (m as any).userData.window;
  const T = TSL as any;
  const cells = T.fwidth(T.uv(2));
  const far = T.smoothstep(0.3, 0.7, T.max(cells.x, cells.y));
  const nightMean = w.uWinWarm.mul(w.uWinLitRatio.mul(w.uWinLightLevel).mul(0.12));
  const mean = T.mix(T.vec3(0.03), nightMean, w.uWinNight);
  (m as any).emissiveNode = T.mix((m as any).emissiveNode, mean, far);
  m.name = `window_${r.era}`;
  return m;
}
