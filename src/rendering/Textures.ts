import * as THREE from 'three';
import ballAlbedoUrl from '../assets/textures/ball_albedo.png';
import ballNormalUrl from '../assets/textures/ball_normal.png';
import ballOrmUrl from '../assets/textures/ball_orm.png';

/** Procedural canvas textures, plus the few maps baked offline in Blender. */

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

let ballTex: { map: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture } | null = null;

/**
 * The dodgeball, baked in Blender (tools/blender/bake_ball.py): pebbled foam rubber with grooved
 * seams between red panels and cream stripes (the stripes make spin readable). Object-space
 * normals, packed occlusion/roughness, and a printed logo composited onto the albedo.
 */
export function ballTextures() {
  if (ballTex) return ballTex;
  const W = 1024, H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#d6412a';
  g.fillRect(0, 0, W, H);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const img = new Image();
  img.onload = () => {
    g.drawImage(img, 0, 0, W, H);
    // printed logo on two opposite panels (pre-stretched: equirect squeezes rows by sin θ)
    const logo = (u: number, v: number, flip: boolean) => {
      const sinT = Math.sin(v * Math.PI);
      g.save();
      g.translate(u * W, v * H);
      if (flip) g.rotate(Math.PI);
      g.scale(1 / sinT, 1);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'italic 800 30px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillStyle = 'rgba(244, 232, 208, 0.88)';
      g.fillText('OVERTHROW', 0, 0);
      g.font = '600 10px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillStyle = 'rgba(244, 232, 208, 0.7)';
      g.fillText('OFFICIAL MATCH BALL', 0, 20);
      g.restore();
    };
    logo(0.5, 0.29, false);
    logo(0.0, 0.71, true);
    logo(1.0, 0.71, true);
    map.needsUpdate = true;
  };
  img.src = ballAlbedoUrl;
  const load = (url: string) => {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  ballTex = { map, normal: load(ballNormalUrl), orm: load(ballOrmUrl) };
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
