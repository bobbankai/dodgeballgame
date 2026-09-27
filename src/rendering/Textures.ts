import * as THREE from 'three';

/** Procedural canvas textures (no external assets needed). */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Height field → tangent-space normal map. */
export function heightToNormal(height: Float32Array, w: number, h: number, strength: number, wrap = true): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  const at = (x: number, y: number) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else {
      x = Math.max(0, Math.min(w - 1, x));
      y = Math.max(0, Math.min(h - 1, y));
    }
    return height[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

let ballTex: { map: THREE.Texture; normal: THREE.Texture } | null = null;

/** Classic playground dodgeball: pebbled red rubber with two cream stripes (makes spin readable). */
export function ballTextures() {
  if (ballTex) return ballTex;
  const W = 512, H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#c8341f');
  grad.addColorStop(0.5, '#e24a2e');
  grad.addColorStop(1, '#c8341f');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // stripes (two great circles-ish in equirect: horizontal band + meridian bands)
  g.fillStyle = '#f3e6cf';
  g.fillRect(0, H * 0.47, W, H * 0.06);
  g.fillRect(W * 0.235, 0, W * 0.03, H);
  g.fillRect(W * 0.735, 0, W * 0.03, H);
  // seam lines
  g.strokeStyle = 'rgba(80,10,5,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, H * 0.465);
  g.lineTo(W, H * 0.465);
  g.moveTo(0, H * 0.535);
  g.lineTo(W, H * 0.535);
  g.stroke();
  // speckle variation
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n * 0.6));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.5));
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  // pebble normal map
  const NW = 256, NH = 128;
  const hgt = new Float32Array(NW * NH);
  const dots = 1800;
  for (let k = 0; k < dots; k++) {
    const cx = Math.random() * NW, cy = Math.random() * NH, r = 1.2 + Math.random() * 1.4;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1) {
          const xx = (x + NW) % NW, yy = (y + NH) % NH;
          hgt[yy * NW + xx] = Math.max(hgt[yy * NW + xx], Math.cos(d * Math.PI * 0.5));
        }
      }
    }
  }
  const normal = heightToNormal(hgt, NW, NH, 0.9);
  ballTex = { map, normal };
  return ballTex;
}

/** Soft radial blob used for contact shadows and glows. */
let blobTex: THREE.Texture | null = null;
export function blobTexture() {
  if (blobTex) return blobTex;
  const c = canvas(128, 128);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

let glowTex: THREE.Texture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = canvas(128, 128);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** Ring texture for ground markers. */
let ringTex: THREE.Texture | null = null;
export function ringTexture() {
  if (ringTex) return ringTex;
  const c = canvas(256, 256);
  const g = c.getContext('2d')!;
  g.strokeStyle = 'white';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 110, 0, Math.PI * 2);
  g.stroke();
  const grad = g.createRadialGradient(128, 128, 60, 128, 128, 118);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.35)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 118, 0, Math.PI * 2);
  g.fill();
  ringTex = new THREE.CanvasTexture(c);
  return ringTex;
}

export function makeCanvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
