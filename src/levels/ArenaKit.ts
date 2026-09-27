import * as THREE from 'three';
import { heightToNormal, makeCanvasTexture } from '../rendering/Textures';

/** Shared procedural building blocks for arenas. */

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SurfaceTextures {
  map: THREE.Texture;
  normal?: THREE.Texture;
  rough?: THREE.Texture;
}

/** Hardwood planks. Tile covers `tileSize` metres. */
export function woodTextures(palette: [string, string, string] = ['#d6a468', '#c99357', '#e2b47a'], seed = 7): SurfaceTextures {
  const S = 512;
  const R = rand(seed);
  const planks = 20;
  const pw = S / planks;
  const height = new Float32Array(S * S);
  const roughArr = new Uint8ClampedArray(S * S * 4);
  const map = makeCanvasTexture(S, S, (g) => {
    const img = g.createImageData(S, S);
    const cols = palette.map((h) => new THREE.Color(h));
    const plankCol: THREE.Color[] = [];
    const joints: number[][] = [];
    for (let p = 0; p < planks; p++) {
      const c = cols[Math.floor(R() * cols.length)].clone();
      c.offsetHSL((R() - 0.5) * 0.015, (R() - 0.5) * 0.06, (R() - 0.5) * 0.07);
      plankCol.push(c);
      joints.push([R() * S, R() * S]);
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const p = Math.floor(x / pw);
        const lx = x - p * pw;
        const c = plankCol[p];
        const grain = Math.sin((y * 0.045 + Math.sin(y * 0.013 + p * 3.1) * 2.5 + lx * 0.35) * 3.0) * 0.5 + 0.5;
        const fine = Math.sin(y * 0.9 + lx * 1.7 + p) * 0.5 + 0.5;
        let k = 0.9 + grain * 0.12 + fine * 0.03;
        let h = 0.5;
        if (lx < 1 || lx > pw - 1) {
          k *= 0.62;
          h = 0;
        }
        for (const j of joints[p]) {
          if (Math.abs(y - j) < 1) {
            k *= 0.7;
            h = 0.1;
          }
        }
        const i = (y * S + x) * 4;
        img.data[i] = c.r * 255 * k;
        img.data[i + 1] = c.g * 255 * k;
        img.data[i + 2] = c.b * 255 * k;
        img.data[i + 3] = 255;
        height[y * S + x] = h + grain * 0.05;
        const rr = 60 + grain * 30 + (R() < 0.002 ? 80 : 0);
        roughArr[i] = roughArr[i + 1] = roughArr[i + 2] = rr;
        roughArr[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  const rough = new THREE.DataTexture(new Uint8Array(roughArr.buffer), S, S);
  rough.needsUpdate = true;
  const normal = heightToNormal(height, S, S, 2.0);
  for (const t of [map, normal, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { map, normal, rough };
}

/** Asphalt / concrete style noisy surface. */
export function noiseSurface(base: string, variation: number, seed = 3, cracks = 0, speckle = 0.08): SurfaceTextures {
  const S = 512;
  const R = rand(seed);
  const height = new Float32Array(S * S);
  const map = makeCanvasTexture(S, S, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    // value noise layers
    const grid = (n: number) => {
      const arr = new Float32Array((n + 1) * (n + 1));
      for (let i = 0; i < arr.length; i++) arr[i] = R();
      return (x: number, y: number) => {
        const fx = (x / S) * n, fy = (y / S) * n;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const w = n + 1;
        const a = arr[(iy % n) * w + (ix % n)], b = arr[(iy % n) * w + ((ix + 1) % n)];
        const c = arr[((iy + 1) % n) * w + (ix % n)], d = arr[((iy + 1) % n) * w + ((ix + 1) % n)];
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      };
    };
    const n1 = grid(8), n2 = grid(32), n3 = grid(96);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = n1(x, y) * 0.5 + n2(x, y) * 0.3 + n3(x, y) * 0.2;
        const sp = R() < speckle ? (R() - 0.5) * 0.5 : 0;
        const k = 1 + (v - 0.5) * variation + sp;
        const i = (y * S + x) * 4;
        img.data[i] *= k;
        img.data[i + 1] *= k;
        img.data[i + 2] *= k;
        height[y * S + x] = v * 0.6 + (sp > 0 ? 0.3 : 0);
      }
    }
    g.putImageData(img, 0, 0);
    if (cracks > 0) {
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 1.2;
      for (let c = 0; c < cracks; c++) {
        let x = R() * S, y = R() * S;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 12; k++) {
          x += (R() - 0.5) * 40;
          y += (R() - 0.5) * 40;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  });
  const normal = heightToNormal(height, S, S, 3.0);
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { map, normal };
}

/** Modular sport tiles (rooftop / pro courts). */
export function tileSurface(a: string, b: string, seed = 5): SurfaceTextures {
  const S = 512;
  const R = rand(seed);
  const height = new Float32Array(S * S);
  const n = 16;
  const ts = S / n;
  const map = makeCanvasTexture(S, S, (g) => {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const c = new THREE.Color((x + y) % 2 === 0 ? a : b);
        c.offsetHSL(0, 0, (R() - 0.5) * 0.03);
        g.fillStyle = `#${c.getHexString()}`;
        g.fillRect(x * ts, y * ts, ts, ts);
      }
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * ts, 0);
      g.lineTo(i * ts, S);
      g.moveTo(0, i * ts);
      g.lineTo(S, i * ts);
      g.stroke();
    }
    // perforation dots
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        for (let k = 0; k < 9; k++) {
          const px = x * ts + ((k % 3) + 0.5) * (ts / 3), py = y * ts + (Math.floor(k / 3) + 0.5) * (ts / 3);
          g.beginPath();
          g.arc(px, py, 1.4, 0, Math.PI * 2);
          g.fill();
        }
  });
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const lx = x % ts, ly = y % ts;
      height[y * S + x] = lx < 1 || ly < 1 ? 0 : 0.6;
    }
  const normal = heightToNormal(height, S, S, 2.2);
  for (const t of [map, normal]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, normal };
}

export interface LineStyle {
  line: string;
  center: string;
  homeTint: string;
  awayTint: string;
  tintAlpha: number;
  logo?: string;
  logoColor?: string;
  logoSub?: string;
  circle?: string;
  glow?: boolean;
  /** Painted court surface (acrylic) drawn under the lines, extends `fillMargin` past the boundary. */
  courtFill?: string;
  fillMargin?: number;
  /** Second fill colour for the out-of-bounds border. */
  borderFill?: string;
}

/** Court markings drawn into a transparent texture covering (2*hw+2m) x (2*hl+2m). */
export function courtLines(hw: number, hl: number, style: LineStyle) {
  const margin = 1;
  const W = (hw + margin) * 2, L = (hl + margin) * 2;
  const ppm = 48;
  const cw = Math.round(W * ppm), ch = Math.round(L * ppm);
  const tex = makeCanvasTexture(cw, ch, (g) => {
    g.clearRect(0, 0, cw, ch);
    const X = (x: number) => (x + W / 2) * ppm;
    if (style.courtFill) {
      const fm = style.fillMargin ?? 0.8;
      if (style.borderFill) {
        g.fillStyle = style.borderFill;
        g.fillRect(X(-hw - fm), (L / 2 - hl - fm) * ppm, (hw + fm) * 2 * ppm, (hl + fm) * 2 * ppm);
      }
      g.fillStyle = style.courtFill;
      g.fillRect(X(-hw), (L / 2 - hl) * ppm, hw * 2 * ppm, hl * 2 * ppm);
      // wear: speckle and scuffs
      const img = g.getImageData(0, 0, cw, ch);
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] === 0) continue;
        const n = (Math.random() - 0.5) * 16;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let k = 0; k < 80; k++) {
        g.beginPath();
        g.ellipse(X((Math.random() - 0.5) * hw * 2), (L / 2 + (Math.random() - 0.5) * hl * 2) * ppm, 10 + Math.random() * 40, 3 + Math.random() * 8, Math.random() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    // canvas top (row 0) = far/away end (-Z); flipY maps it to v = 1 which the shader puts at z = -L/2
    const Z = (z: number) => (z + L / 2) * ppm;
    // team tints (subtle wash on each half)
    const wash = (z0: number, z1: number, col: string) => {
      const grad = g.createLinearGradient(0, Z(z0), 0, Z(z1));
      grad.addColorStop(0, col + '00');
      grad.addColorStop(1, col);
      g.globalAlpha = style.tintAlpha;
      g.fillStyle = grad;
      g.fillRect(X(-hw), Math.min(Z(z0), Z(z1)), hw * 2 * ppm, Math.abs(Z(z1) - Z(z0)));
      g.globalAlpha = 1;
    };
    wash(0.5, hl, style.homeTint);
    wash(-0.5, -hl, style.awayTint);
    g.strokeStyle = style.line;
    g.lineCap = 'butt';
    const lw = 0.06 * ppm;
    g.lineWidth = lw;
    const inset = 0.35;
    g.strokeRect(X(-hw + inset), Z(-hl + inset), (hw - inset) * 2 * ppm, (hl - inset) * 2 * ppm);
    // attack lines
    for (const s of [1, -1]) {
      g.beginPath();
      g.setLineDash([0.3 * ppm, 0.2 * ppm]);
      g.moveTo(X(-hw + inset), Z(s * 3));
      g.lineTo(X(hw - inset), Z(s * 3));
      g.stroke();
      g.setLineDash([]);
    }
    // centre line
    g.strokeStyle = style.center;
    g.lineWidth = 0.12 * ppm;
    if (style.glow) {
      g.shadowColor = style.center;
      g.shadowBlur = 0.3 * ppm;
    }
    g.beginPath();
    g.moveTo(X(-hw), Z(0));
    g.lineTo(X(hw), Z(0));
    g.stroke();
    g.shadowBlur = 0;
    // centre circle
    g.strokeStyle = style.circle ?? style.line;
    g.lineWidth = lw;
    g.beginPath();
    g.arc(X(0), Z(0), 1.9 * ppm, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(X(0), Z(0), 0.6 * ppm, 0, Math.PI * 2);
    g.stroke();
    // logos in each half
    if (style.logo) {
      g.save();
      g.fillStyle = style.logoColor ?? style.line;
      g.globalAlpha = 0.85;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `italic 800 ${1.25 * ppm}px "Barlow Condensed", Arial Narrow, sans-serif`;
      for (const s of [1, -1]) {
        g.save();
        g.translate(X(0), Z(s * (hl * 0.55)));
        g.rotate(0);
        g.fillText(style.logo, 0, 0);
        if (style.logoSub) {
          g.font = `600 ${0.36 * ppm}px "Barlow Condensed", Arial Narrow, sans-serif`;
          g.fillText(style.logoSub, 0, 0.95 * ppm);
        }
        g.restore();
      }
      g.restore();
    }
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, size: new THREE.Vector2(W, L) };
}

/** Enclosure boards along the court boundary with ad panels. */
export function buildBoards(hw: number, hl: number, opts: {
  height: number;
  padColor: number;
  railColor: number;
  railEmissive?: number;
  ads: { text: string; bg: string; fg: string }[];
  glass?: boolean;
}): { group: THREE.Group; rails: THREE.Mesh[] } {
  const group = new THREE.Group();
  const t = 0.18;
  const h = opts.height;
  const pad = new THREE.MeshStandardMaterial({ color: opts.padColor, roughness: 0.62 });
  const railMat = new THREE.MeshStandardMaterial({ color: opts.railColor, roughness: 0.35, metalness: 0.3, emissive: opts.railColor, emissiveIntensity: opts.railEmissive ?? 0 });
  let adCursor = 0;
  /** Each wall gets its own strip with ~3.2m wide ad panels so text never overlaps. */
  const adMaterialFor = (len: number) => {
    const n = Math.max(2, Math.round(len / 3.2));
    const tex = makeCanvasTexture(256 * n, 128, (g, w, hh) => {
      const seg = w / n;
      for (let i = 0; i < n; i++) {
        const ad = opts.ads[(adCursor + i) % opts.ads.length];
        g.fillStyle = ad.bg;
        g.fillRect(i * seg, 0, seg, hh);
        g.fillStyle = ad.fg;
        let size = hh * 0.56;
        g.font = `italic 800 ${size}px "Barlow Condensed", Arial Narrow, sans-serif`;
        while (g.measureText(ad.text).width > seg * 0.88 && size > 20) {
          size -= 2;
          g.font = `italic 800 ${size}px "Barlow Condensed", Arial Narrow, sans-serif`;
        }
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(ad.text, i * seg + seg / 2, hh * 0.54);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(i * seg, 0, 3, hh);
      }
    });
    adCursor += n;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
  };
  const rails: THREE.Mesh[] = [];
  const addWall = (len: number, x: number, z: number, rotY: number) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, h, t), pad);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.1, h * 0.62), adMaterialFor(len));
    panel.position.set(0, h * 0.5, -t / 2 - 0.004);
    panel.rotation.y = Math.PI;
    g.add(panel);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.07, t + 0.06), railMat);
    rail.position.y = h + 0.035;
    g.add(rail);
    rails.push(rail);
    if (opts.glass) {
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(len, 1.2, 0.03),
        new THREE.MeshPhysicalMaterial({ color: 0xdfefff, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.12, depthWrite: false }),
      );
      glass.position.y = h + 0.65;
      g.add(glass);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    group.add(g);
  };
  // panels face the court (their -Z local side faces inward after rotation)
  addWall(hl * 2 + t * 2, hw + t / 2, 0, -Math.PI / 2);
  addWall(hl * 2 + t * 2, -hw - t / 2, 0, Math.PI / 2);
  addWall(hw * 2, 0, hl + t / 2, 0);
  addWall(hw * 2, 0, -hl - t / 2, Math.PI);
  return { group, rails };
}

export function buildBench(length: number, color = 0x6b4a2e): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.4, metalness: 0.7 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, length), wood);
  seat.position.y = 0.46;
  seat.castShadow = true;
  seat.receiveShadow = true;
  g.add(seat);
  for (const z of [-length / 2 + 0.2, length / 2 - 0.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 0.05), metal);
    leg.position.set(0, 0.22, z);
    leg.castShadow = true;
    g.add(leg);
  }
  return g;
}

/** Wall-mounted scoreboard with a live canvas texture. */
export class Scoreboard {
  readonly group = new THREE.Group();
  private tex: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private last = '';
  constructor(width: number, private homeName: string, private awayName: string, private accent: string, housing = 0x16181d) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const h = width * 0.375;
    const box = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, h + 0.3, 0.35), new THREE.MeshStandardMaterial({ color: housing, roughness: 0.5, metalness: 0.4 }));
    this.group.add(box);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(width, h),
      new THREE.MeshStandardMaterial({ map: this.tex, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 1.6, roughness: 0.3, color: 0x000000 }),
    );
    screen.position.z = 0.18;
    this.group.add(screen);
    this.set(0, 0, '1:40', 1);
  }
  set(home: number, away: number, clock: string, round: number) {
    const key = `${home}|${away}|${clock}|${round}`;
    if (key === this.last) return;
    this.last = key;
    const g = this.canvas.getContext('2d')!;
    const W = 1024, H = 384;
    g.fillStyle = '#050608';
    g.fillRect(0, 0, W, H);
    // LED dot texture
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < H; y += 6) for (let x = 0; x < W; x += 6) g.fillRect(x, y, 2, 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 700 46px "Barlow Condensed", Arial Narrow, sans-serif';
    g.fillStyle = '#e8e3d6';
    g.fillText(this.homeName, W * 0.2, 60);
    g.fillText(this.awayName, W * 0.8, 60);
    g.font = '800 170px "Barlow Condensed", Arial Narrow, sans-serif';
    g.fillStyle = '#ffb347';
    g.fillText(String(home), W * 0.2, 210);
    g.fillText(String(away), W * 0.8, 210);
    g.fillStyle = '#ff4a3a';
    g.font = '700 110px "Barlow Condensed", Arial Narrow, sans-serif';
    g.fillText(clock, W * 0.5, 170);
    g.fillStyle = this.accent;
    g.font = 'italic 700 44px "Barlow Condensed", Arial Narrow, sans-serif';
    g.fillText(`ROUND ${round}`, W * 0.5, 300);
    this.tex.needsUpdate = true;
  }
}

/** Soft additive light shaft (fake volumetric) from a point toward a direction. */
export function lightShaft(from: THREE.Vector3, to: THREE.Vector3, width: number, color: number, opacity: number): THREE.Mesh {
  const len = from.distanceTo(to);
  const geo = new THREE.CylinderGeometry(width * 0.5, width, len, 16, 1, true);
  geo.translate(0, -len / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float fall = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
      float dust = 0.85 + 0.15*sin(vUv.y*40.0 + uTime*0.7 + vUv.x*30.0);
      gl_FragColor = vec4(uColor, edge * fall * uOpacity * dust); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(from);
  const dir = new THREE.Vector3().subVectors(to, from).normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  m.renderOrder = 5;
  return m;
}

/** Hanging vertical banner with printed text. */
export function banner(w: number, h: number, bg: string, fg: string, title: string, sub = '', accent = '#ffffff'): THREE.Mesh {
  const tex = makeCanvasTexture(256, Math.round((256 * h) / w), (g, cw, ch) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = accent;
    g.fillRect(0, ch - 22, cw, 8);
    g.fillRect(0, 12, cw, 5);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `italic 800 ${cw * 0.24}px "Barlow Condensed", Arial Narrow, sans-serif`;
    const words = title.split(' ');
    words.forEach((wd, i) => g.fillText(wd, cw / 2, ch * 0.28 + i * cw * 0.25));
    g.font = `600 ${cw * 0.1}px "Barlow Condensed", Arial Narrow, sans-serif`;
    g.fillText(sub, cw / 2, ch * 0.82);
    // pennant cut
  });
  const geo = new THREE.PlaneGeometry(w, h, 4, 8);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  return m;
}

export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
