import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { assetUrl } from '../core/resources';

/**
 * Lightmaps: the Cycles bakes (linear Radiance HDR, diffuse direct + every bounce, on UV1). Loaded once per key, halved on
 * load where the device's memory budget asks for it (`setLightmapLimit`).
 */
const hdr = new HDRLoader();

/**
 * Phones load lightmaps at half size (a 2048 map is 32 MB as half floats, and a section and its neighbours hold a dozen: more than
 * a mobile browser's tab survives). Box-filtered 2x2; the bake's 6-texel island margin keeps island edges clean at half size.
 */
let LM_LIMIT = Infinity;
export function setLightmapLimit(px: number): void { LM_LIMIT = px; }
let HALF: Float32Array | null = null;
function shrinkLightmap(t: THREE.DataTexture): void {
  const img = t.image as { width: number; height: number; data: Uint16Array | Float32Array };
  let { width: w, height: h, data } = img;
  if (w <= LM_LIMIT) return;
  const isHalf = data instanceof Uint16Array;
  if (isHalf && !HALF) {
    HALF = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) HALF[i] = THREE.DataUtils.fromHalfFloat(i);
  }
  while (w > LM_LIMIT && w % 2 === 0 && h % 2 === 0) {
    const W = w / 2, H = h / 2;
    const out = isHalf ? new Uint16Array(W * H * 4) : new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i0 = (2 * y * w + 2 * x) * 4, i1 = i0 + 4, i2 = i0 + w * 4, i3 = i2 + 4, o = (y * W + x) * 4;
        for (let c = 0; c < 4; c++) {
          if (isHalf) {
            const H_ = HALF!;
            const v = (H_[data[i0 + c]] + H_[data[i1 + c]] + H_[data[i2 + c]] + H_[data[i3 + c]]) * 0.25;
            out[o + c] = THREE.DataUtils.toHalfFloat(v);
          } else out[o + c] = (data[i0 + c] + data[i1 + c] + data[i2 + c] + data[i3 + c]) * 0.25;
        }
      }
    }
    data = out;
    w = W;
    h = H;
  }
  t.image = { data, width: w, height: h } as any;
  t.needsUpdate = true;
}
export function loadLightmap(key: string): Promise<THREE.DataTexture> {
  return hdr.loadAsync(assetUrl(key)).then((t) => { shrinkLightmap(t as THREE.DataTexture); return t as THREE.DataTexture; });
}

