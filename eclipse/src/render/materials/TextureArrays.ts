import { Constants, RawTexture2DArray, Texture, type Scene } from '@babylonjs/core';
import { assetUrl } from '../../assets/paths';

/** Decodes an image URL into RGBA pixels at the given size. */
async function pixels(url: string, size: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', imageOrientation: 'flipY' });
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, size, size).data;
}

/**
 * Packs several texture sets (albedo / normal / ORM) into three 2D texture arrays, so a terrain or
 * blended surface can sample many layers with only three samplers.
 */
export interface LayerArrays {
  albedo: RawTexture2DArray;
  normal: RawTexture2DArray;
  orm: RawTexture2DArray;
  layers: string[];
}

const cache = new Map<string, Promise<LayerArrays>>();

export function loadLayerArrays(scene: Scene, sets: string[], size = 1024): Promise<LayerArrays> {
  const key = `${sets.join(',')}@${size}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const make = async (suffix: string) => {
        const data = new Uint8Array(size * size * 4 * sets.length);
        const imgs = await Promise.all(sets.map((s) => pixels(assetUrl(`tex/${s}_${suffix}.webp`), size)));
        imgs.forEach((px, i) => data.set(px, i * size * size * 4));
        const t = new RawTexture2DArray(data, size, size, sets.length, Constants.TEXTUREFORMAT_RGBA, scene, true, false,
          Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
        t.wrapU = Texture.WRAP_ADDRESSMODE;
        t.wrapV = Texture.WRAP_ADDRESSMODE;
        t.anisotropicFilteringLevel = 8;
        return t;
      };
      const [albedo, normal, orm] = await Promise.all([make('c'), make('n'), make('orm')]);
      return { albedo, normal, orm, layers: sets };
    })();
    cache.set(key, p);
  }
  return p;
}

export function clearLayerArrays(): void {
  for (const p of cache.values()) {
    p.then((a) => {
      a.albedo.dispose();
      a.normal.dispose();
      a.orm.dispose();
    }).catch(() => undefined);
  }
  cache.clear();
}
