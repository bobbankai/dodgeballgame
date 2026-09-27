import * as THREE from 'three';
import { makeCanvasTexture } from '../rendering/Textures';
import { lightShaft } from './ArenaKit';

/** Gradient sky dome with sun / moon / eclipse disc, stars and soft clouds. */
export function skyDome(opts: {
  top: number;
  mid: number;
  horizon: number;
  bottom?: number;
  sunDir: THREE.Vector3;
  sunColor: number;
  sunSize: number;
  sunGlow: number;
  stars?: number;
  clouds?: number;
  cloudColor?: number;
  eclipse?: boolean;
  radius?: number;
}): { mesh: THREE.Mesh; uniforms: Record<string, { value: any }> } {
  const uniforms = {
    uTop: { value: new THREE.Color(opts.top) },
    uMid: { value: new THREE.Color(opts.mid) },
    uHorizon: { value: new THREE.Color(opts.horizon) },
    uBottom: { value: new THREE.Color(opts.bottom ?? opts.horizon) },
    uSunDir: { value: opts.sunDir.clone().normalize() },
    uSunColor: { value: new THREE.Color(opts.sunColor) },
    uSunSize: { value: opts.sunSize },
    uSunGlow: { value: opts.sunGlow },
    uStars: { value: opts.stars ?? 0 },
    uClouds: { value: opts.clouds ?? 0 },
    uCloudColor: { value: new THREE.Color(opts.cloudColor ?? 0xffffff) },
    uEclipse: { value: opts.eclipse ? 1 : 0 },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon, uBottom, uSunColor, uCloudColor;
      uniform vec3 uSunDir;
      uniform float uSunSize, uSunGlow, uStars, uClouds, uEclipse, uTime;
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uHorizon, uMid, smoothstep(0.0, 0.25, h)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.2, h));
        col = mix(col, uTop, smoothstep(0.25, 0.9, h));
        float sd = dot(d, normalize(uSunDir));
        float glow = pow(max(sd, 0.0), 8.0) * uSunGlow + pow(max(sd, 0.0), 64.0) * uSunGlow * 1.5;
        col += uSunColor * glow;
        float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.85, sd);
        if (uEclipse > 0.5) {
          float ring = smoothstep(1.0 - uSunSize * 1.35, 1.0 - uSunSize * 1.02, sd) - disc;
          float rays = 0.6 + 0.4 * noise(vec3(atan(d.x - uSunDir.x, d.y - uSunDir.y) * 6.0, uTime * 0.2, 0.0));
          col += uSunColor * ring * 6.0 * rays;
          col = mix(col, vec3(0.0), disc);
        } else {
          col += uSunColor * disc * 3.0;
        }
        if (uClouds > 0.0) {
          vec3 p = d / max(h + 0.15, 0.05);
          float n = noise(p * 2.0 + vec3(uTime * 0.01, 0.0, 0.0)) * 0.6 + noise(p * 5.0) * 0.4;
          float c = smoothstep(0.55, 0.8, n) * smoothstep(0.02, 0.25, h) * uClouds;
          vec3 cc = uCloudColor * (0.6 + 0.8 * pow(max(sd, 0.0), 3.0));
          col = mix(col, cc, c * 0.8);
        }
        if (uStars > 0.0 && h > 0.0) {
          vec3 sp = floor(d * 400.0);
          float s = step(0.9975, hash(sp)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(sp + 1.0) * 30.0));
          col += vec3(s) * uStars * smoothstep(0.05, 0.4, h);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(opts.radius ?? 400, 48, 24), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/** Window-grid texture for skyline buildings (emissive map). */
function windowTexture(lit: number, warm: boolean, seed: number) {
  let s = seed;
  const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return makeCanvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const cols = 8, rows = 24;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (R() > lit) continue;
        const c = warm ? (R() < 0.8 ? '#ffd7a0' : '#bfe3ff') : R() < 0.7 ? '#bfe3ff' : '#ffe2b0';
        g.fillStyle = c;
        g.globalAlpha = 0.5 + R() * 0.5;
        g.fillRect(x * (w / cols) + 3, y * (h / rows) + 3, w / cols - 6, h / rows - 5);
      }
    g.globalAlpha = 1;
  });
}

/** Instanced city skyline ring around the arena. */
export function skyline(opts: { inner: number; outer: number; count: number; minH: number; maxH: number; color: number; lit: number; warm?: boolean; seed?: number; blink?: boolean; avoid?: (x: number, z: number) => boolean }): THREE.Group {
  const group = new THREE.Group();
  let s = opts.seed ?? 5;
  const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const variants = [0, 1, 2].map((i) => {
    const tex = windowTexture(opts.lit, !!opts.warm, (opts.seed ?? 5) + i * 17);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ color: opts.color, roughness: 0.8, metalness: 0.2, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.4 });
  });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const perVariant = Math.ceil(opts.count / variants.length);
  const blinkers: THREE.Vector3[] = [];
  variants.forEach((mat, vi) => {
    const inst = new THREE.InstancedMesh(geo, mat, perVariant);
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < perVariant * 3 && n < perVariant; i++) {
      const a = R() * Math.PI * 2;
      const r = opts.inner + R() * (opts.outer - opts.inner);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (opts.avoid?.(x, z)) continue;
      const w = 6 + R() * 14, d = 6 + R() * 14;
      const hgt = opts.minH + Math.pow(R(), 2.2) * (opts.maxH - opts.minH);
      m.compose(new THREE.Vector3(x, -2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(w, hgt, d));
      inst.setMatrixAt(n++, m);
      if (hgt > opts.maxH * 0.6) blinkers.push(new THREE.Vector3(x, hgt - 1.5, z));
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    // texture scale to building size is approximated by the repeat
    (mat.emissiveMap as THREE.Texture).repeat.set(1, 2 + vi);
    group.add(inst);
  });
  if (opts.blink && blinkers.length) {
    const bgeo = new THREE.SphereGeometry(0.6, 8, 6);
    const bmat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    const b = new THREE.InstancedMesh(bgeo, bmat, blinkers.length);
    const m = new THREE.Matrix4();
    blinkers.forEach((p, i) => b.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    b.userData.blink = true;
    group.add(b);
  }
  return group;
}

/** Chain-link fence panels (alpha-tested texture). */
export function chainFence(points: THREE.Vector2[], height: number, color = 0x9aa3ad): THREE.Group {
  const g = new THREE.Group();
  const tex = makeCanvasTexture(128, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#ffffff';
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(w, h);
    c.moveTo(w, 0);
    c.lineTo(0, h);
    c.stroke();
  }, false);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const post = new THREE.MeshStandardMaterial({ color: 0x6b727c, roughness: 0.5, metalness: 0.7 });
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = a.distanceTo(b);
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 0.12, height / 0.12);
    const mat = new THREE.MeshStandardMaterial({ color, alphaMap: t, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.8 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, height), mat);
    m.position.set((a.x + b.x) / 2, height / 2, (a.y + b.y) / 2);
    m.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
    m.castShadow = true;
    g.add(m);
    const segs = Math.max(1, Math.round(len / 3));
    for (let k = 0; k <= segs; k++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, height + 0.1, 8), post);
      p.position.set(a.x + ((b.x - a.x) * k) / segs, (height + 0.1) / 2, a.y + ((b.y - a.y) * k) / segs);
      p.castShadow = true;
      g.add(p);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), post);
    rail.position.set((a.x + b.x) / 2, height, (a.y + b.y) / 2);
    rail.rotation.z = Math.PI / 2;
    rail.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
    g.add(rail);
  }
  return g;
}

/** Glowing neon sign made of text on a dark backing. */
export function neonSign(text: string, color: string, width: number, opts: { backing?: boolean; font?: string } = {}): THREE.Mesh {
  const W = 1024, H = Math.round((1024 * 0.28));
  const tex = makeCanvasTexture(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    g.font = opts.font ?? `italic 800 ${H * 0.62}px "Barlow Condensed", Arial Narrow, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 30;
    g.strokeStyle = color;
    g.lineWidth = 10;
    g.strokeText(text, W / 2, H / 2);
    g.shadowBlur = 0;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    g.strokeText(text, W / 2, H / 2);
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.28), mat);
  m.renderOrder = 6;
  if (opts.backing) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, width * 0.3, 0.1), new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.6 }));
    b.position.z = -0.08;
    m.add(b);
  }
  return m;
}

/** Catenary strings of glowing bulbs. */
export function stringLights(a: THREE.Vector3, b: THREE.Vector3, bulbs: number, sag: number, color = 0xffd9a0): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.01, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  g.add(wire);
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), toneMapped: false });
  const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), bulbMat, bulbs);
  const m = new THREE.Matrix4();
  for (let i = 0; i < bulbs; i++) {
    const t = (i + 0.5) / bulbs;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * sag + 0.08;
    inst.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
  }
  g.add(inst);
  return g;
}

/** Floodlight tower/rig with glowing lamp heads and optional fake light shaft. */
export function floodRig(pos: THREE.Vector3, target: THREE.Vector3, heads: number, shaft: boolean, color = 0xf4f7ff): { group: THREE.Group; shaftMat: THREE.ShaderMaterial | null } {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, metalness: 0.8 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, pos.y, 10), metal);
  pole.position.set(pos.x, pos.y / 2, pos.z);
  pole.castShadow = true;
  g.add(pole);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(heads * 0.7, 0.12, 0.12), metal);
  bar.position.copy(pos);
  bar.lookAt(target.x, pos.y, target.z);
  bar.rotateY(Math.PI / 2);
  g.add(bar);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4), toneMapped: false });
  const housing = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.4, metalness: 0.7 });
  const dir = new THREE.Vector3().subVectors(target, pos).normalize();
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  let shaftMat: THREE.ShaderMaterial | null = null;
  for (let i = 0; i < heads; i++) {
    const off = (i - (heads - 1) / 2) * 0.7;
    const hp = pos.clone().addScaledVector(right, off).add(new THREE.Vector3(0, 0.3, 0));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.3), housing);
    box.position.copy(hp);
    box.lookAt(target);
    g.add(box);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), lampMat);
    lens.position.copy(hp).addScaledVector(dir, 0.16);
    lens.lookAt(hp.clone().addScaledVector(dir, 2));
    g.add(lens);
  }
  if (shaft) {
    const s = lightShaft(pos.clone().addScaledVector(dir, 0.3), target, 5, color, 0.05);
    shaftMat = s.material as THREE.ShaderMaterial;
    g.add(s);
  }
  return { group: g, shaftMat };
}

/** Corrugated shipping container. */
export function container(color: number, len = 6): THREE.Group {
  const g = new THREE.Group();
  const tex = makeCanvasTexture(256, 64, (c, w, h) => {
    const col = new THREE.Color(color);
    for (let x = 0; x < w; x += 8) {
      const k = 0.85 + 0.15 * Math.sin(x * 0.8);
      c.fillStyle = `rgb(${col.r * 255 * k},${col.g * 255 * k},${col.b * 255 * k})`;
      c.fillRect(x, 0, 8, h);
    }
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 30; i++) c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 1 + Math.random() * 3);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(len / 3, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.5 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 2.44), mat);
  m.position.y = 1.3;
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return g;
}

/** Graffiti / mural texture for walls. */
export function graffitiTexture(words: string[], palette: string[], base: string, seed = 3): THREE.Texture {
  let s = seed;
  const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return makeCanvasTexture(1024, 512, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // brick courses
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 2;
    for (let y = 0; y < h; y += 22) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      for (let x = (y / 22) % 2 ? 0 : 30; x < w; x += 60) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 22);
        g.stroke();
      }
    }
    // paint blobs
    for (let i = 0; i < 14; i++) {
      g.fillStyle = palette[Math.floor(R() * palette.length)];
      g.globalAlpha = 0.55;
      g.beginPath();
      g.ellipse(R() * w, R() * h, 30 + R() * 120, 15 + R() * 60, R() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    words.forEach((word, i) => {
      g.save();
      g.translate(120 + (i * w) / words.length + R() * 60, h * (0.35 + R() * 0.35));
      g.rotate((R() - 0.5) * 0.25);
      g.font = `italic 900 ${90 + R() * 50}px "Barlow Condensed", Impact, sans-serif`;
      g.lineWidth = 14;
      g.strokeStyle = '#111';
      g.strokeText(word, 0, 0);
      g.fillStyle = palette[i % palette.length];
      g.fillText(word, 0, 0);
      g.lineWidth = 3;
      g.strokeStyle = '#fff';
      g.strokeText(word, 0, 0);
      g.restore();
    });
  });
}

/** Animated water plane (harbour). */
export function water(size: number, color: number): { mesh: THREE.Mesh; time: { value: number } } {
  const time = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.6 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWp;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float a = sin(vWp.x * 0.35 + uTime * 0.9) * 0.5 + sin(vWp.z * 0.5 - uTime * 1.3) * 0.5 + sin((vWp.x + vWp.z) * 1.3 + uTime * 2.1) * 0.25;
          float b = cos(vWp.z * 0.4 + uTime * 0.7) * 0.5 + cos((vWp.x - vWp.z) * 1.1 - uTime * 1.7) * 0.3;
          normal = normalize(normal + vec3(a, 0.0, b) * 0.12);
        }`,
      );
  };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  return { mesh: m, time };
}
