import * as THREE from 'three';
import type { QualityProfile } from '../../config/quality';
import { Arena } from '../Arena';
import { buildBench, courtLines, lightShaft, noiseSurface, Scoreboard } from '../ArenaKit';
import { Crowd, standSeats } from '../Crowd';
import { skyDome } from '../Environment';
import { createFloorMaterial } from '../FloorMaterial';

const barrierFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uPulse;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }
void main() {
  vec2 uv = vUv * vec2(24.0, 3.0);
  vec2 r = vec2(1.0, 1.732);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  float edge = smoothstep(0.42, 0.5, hexDist(g));
  float scan = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 3.0);
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float fall = smoothstep(1.0, 0.0, vUv.y);
  // mostly transparent: bright only at the hex edges near the floor, fades with height
  float alpha = (edge * 0.35 + fres * 0.12 + scan * 0.03) * fall * fall + uPulse * 0.25 * fall;
  gl_FragColor = vec4(uColor * (1.0 + uPulse * 2.0), alpha * 0.45);
}`;

/** Eclipse Court: a floating obsidian platform under a black sun. */
export function buildEclipse(q: QualityProfile, hw: number, hl: number): Arena {
  const arena = new Arena({ id: 'eclipse', name: 'The Eclipse Court', location: 'Beyond the Crown', tagline: 'The court no one returns from.', court: { halfWidth: hw, halfLength: hl } }, q);
  const R = arena.root;

  // ---------------- sky ----------------
  const sunDir = new THREE.Vector3(0, 0.34, -1).normalize();
  const sky = skyDome({ top: 0x05030b, mid: 0x160a2c, horizon: 0x3b1250, bottom: 0x040208, sunDir, sunColor: 0xffb347, sunSize: 0.03, sunGlow: 0.55, stars: 1.4, clouds: 0.45, cloudColor: 0x5b2a7a, eclipse: true });
  R.add(sky.mesh);
  arena.timeUniforms.push(sky.uniforms.uTime);

  // ---------------- platform ----------------
  const PR = Math.max(hw, hl) + 5.5;
  const obs = noiseSurface('#141019', 0.5, 99, 18, 0.02);
  obs.map.repeat.set(8, 8);
  obs.normal!.repeat.set(8, 8);
  const lines = courtLines(hw, hl, {
    line: '#b69cff',
    center: '#ffb347',
    homeTint: '#27e0d0',
    awayTint: '#a78bfa',
    tintAlpha: 0.18,
    logo: 'ECLIPSE',
    logoSub: 'WHERE CROWNS FALL',
    logoColor: 'rgba(167,139,250,0.55)',
    circle: '#ffb347',
    glow: true,
    courtFill: 'rgba(10,6,18,0.55)',
  });
  const floorMat = createFloorMaterial({ map: obs.map, normalMap: obs.normal, lines: lines.tex, linesSize: lines.size, tileSize: 4, roughness: 0.22, metalness: 0.35, linesRoughness: 0.3, emissiveLines: 1.6, reflect: 1.35 });
  arena.timeUniforms.push((floorMat as any).floorUniforms.uTime);
  const top = new THREE.Mesh(new THREE.CircleGeometry(PR, 8), floorMat);
  top.rotation.x = -Math.PI / 2;
  top.rotation.z = Math.PI / 8;
  top.receiveShadow = true;
  R.add(top);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x1a1522, roughness: 0.85, metalness: 0.1 });
  const under = new THREE.Mesh(new THREE.ConeGeometry(PR, PR * 1.6, 8, 3), rockMat);
  under.rotation.x = Math.PI;
  under.rotation.y = Math.PI / 8;
  under.position.y = -PR * 0.8 - 0.02;
  R.add(under);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xa78bfa, emissiveIntensity: 2.2 });
  const edge = new THREE.Mesh(new THREE.TorusGeometry(PR * 1.0, 0.06, 6, 8), edgeMat);
  edge.rotation.x = Math.PI / 2;
  edge.rotation.z = Math.PI / 8;
  edge.position.y = 0.03;
  R.add(edge);
  // rune circle
  const rune = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.55, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2, 0.8), transparent: true, opacity: 0.6, toneMapped: false }));
  rune.rotation.x = -Math.PI / 2;
  rune.position.y = 0.01;
  R.add(rune);

  // ---------------- energy barriers (replace boards) ----------------
  const bUniforms = { uColor: { value: new THREE.Color(0x8b5cf6) }, uTime: { value: 0 }, uPulse: { value: 0 } };
  const bMat = new THREE.ShaderMaterial({
    uniforms: bUniforms,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalMatrix*normal; vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: barrierFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  arena.timeUniforms.push(bUniforms.uTime);
  const wallH = 1.7;
  for (const [w, x, z, ry] of [
    [hl * 2, hw, 0, Math.PI / 2],
    [hl * 2, -hw, 0, Math.PI / 2],
    [hw * 2, 0, hl, 0],
    [hw * 2, 0, -hl, 0],
  ] as [number, number, number, number][]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, wallH), bMat);
    m.position.set(x, wallH / 2, z);
    m.rotation.y = ry;
    m.renderOrder = 8;
    R.add(m);
    const base = new THREE.Mesh(new THREE.BoxGeometry(ry ? 0.2 : w, 0.12, ry ? w : 0.2), edgeMat);
    base.position.set(x, 0.06, z);
    R.add(base);
  }
  for (const s of [1, -1]) {
    const b = buildBench(4.2, 0x1a1522);
    b.position.set(-(hw + 1.45), 0, s * 3.9);
    R.add(b);
  }

  // ---------------- pillars with crystals + beams ----------------
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0e0b14, roughness: 0.35, metalness: 0.4 });
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb347, emissiveIntensity: 3 });
  const crystals: THREE.Mesh[] = [];
  const pillarLights: THREE.PointLight[] = [];
  const pd = PR - 1.4;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const x = Math.sin(a) * pd, z = Math.cos(a) * pd;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 9, 6), pillarMat);
    p.position.set(x, 4.5, z);
    p.castShadow = true;
    R.add(p);
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), crystalMat);
    c.position.set(x, 10, z);
    R.add(c);
    crystals.push(c);
    if (q.envDetail > 0.4) {
      const beam = lightShaft(new THREE.Vector3(x, 10.5, z), new THREE.Vector3(x, 60, z), 1.2, 0xffb347, 0.12);
      R.add(beam);
      arena.timeUniforms.push((beam.material as THREE.ShaderMaterial).uniforms.uTime);
    }
    if (i < 2) {
      const l = new THREE.PointLight(0xa78bfa, 25, 18, 1.6);
      l.position.set(x * 0.9, 6, z * 0.9);
      R.add(l);
      pillarLights.push(l);
    }
  }

  // ---------------- floating rocks + spectral crowd tiers ----------------
  const floaters: { m: THREE.Object3D; base: number; phase: number; speed: number }[] = [];
  const crackMat = new THREE.MeshStandardMaterial({ color: 0x15111c, roughness: 0.9, emissive: 0x3b1f6b, emissiveIntensity: 0.4, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = PR + 8 + Math.random() * 40;
    const s = 0.8 + Math.random() * 4;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), crackMat);
    m.position.set(Math.sin(a) * r, -6 + Math.random() * 22, Math.cos(a) * r);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    R.add(m);
    floaters.push({ m, base: m.position.y, phase: Math.random() * 6, speed: 0.2 + Math.random() * 0.4 });
  }
  const seats: { pos: THREE.Vector3; yaw: number }[] = [];
  const tierMat = new THREE.MeshStandardMaterial({ color: 0x120e1a, roughness: 0.7, emissive: 0x2a1650, emissiveIntensity: 0.25 });
  for (const s of [1, -1]) {
    const tier = new THREE.Group();
    for (let r = 0; r < 4; r++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, hl * 2.2), tierMat);
      t.position.set(s * (PR + 6 + r * 2.2), 1 + r * 1.2, 0);
      tier.add(t);
    }
    R.add(tier);
    floaters.push({ m: tier, base: 0, phase: s, speed: 0.25 });
    seats.push(
      ...standSeats({ origin: new THREE.Vector3(s * (PR + 6), 1.25, 0), along: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(s, 0, 0), rows: 4, length: hl * 2, rowDepth: 2.2, rowRise: 1.2, spacing: 0.7, density: 0.55 * q.crowdDensity, facingYaw: s > 0 ? -Math.PI / 2 : Math.PI / 2 }),
    );
  }
  if (seats.length) {
    arena.crowd = new Crowd(seats, [0x000000], [0x000000], false, true);
    R.add(arena.crowd.mesh);
  }

  // rising motes
  const moteCount = Math.round(500 * q.particles);
  const mg = new THREE.BufferGeometry();
  const mp = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    mp[i * 3] = (Math.random() - 0.5) * 60;
    mp[i * 3 + 1] = Math.random() * 25;
    mp[i * 3 + 2] = (Math.random() - 0.5) * 60;
  }
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const moteMat = new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.1, 2.2), size: 0.09, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  const motes = new THREE.Points(mg, moteMat);
  R.add(motes);

  const sb = new Scoreboard(3, 'CHALLENGER', 'MONARCH', '#ffb347', 0x07050b);
  sb.group.position.set(0, 7.5, -PR - 1);
  R.add(sb.group);
  arena.scoreboards.push(sb);

  // ---------------- lighting ----------------
  R.add(new THREE.HemisphereLight(0x3a2a6a, 0x0a0610, 0.5));
  const rim = new THREE.DirectionalLight(0xffc27a, 2.4);
  rim.position.copy(sunDir).multiplyScalar(40).add(new THREE.Vector3(6, 14, 0));
  rim.target.position.set(0, 0, 0);
  rim.castShadow = q.shadows;
  rim.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  const sc = rim.shadow.camera;
  sc.left = -hw - 5;
  sc.right = hw + 5;
  sc.top = hl + 6;
  sc.bottom = -hl - 6;
  sc.near = 1;
  sc.far = 90;
  rim.shadow.bias = -0.0005;
  rim.shadow.normalBias = 0.03;
  R.add(rim, rim.target);
  arena.keyLight = rim;
  const front = new THREE.DirectionalLight(0x9a8cff, 0.9);
  front.position.set(0, 12, 20);
  R.add(front);

  arena.look = {
    background: new THREE.Color(0x07040d),
    fog: new THREE.Fog(0x12081f, 50, 160),
    grade: { exposure: 1.1, contrast: 1.12, saturation: 1.12, tint: new THREE.Color(1.0, 0.97, 1.06) },
    lens: { strength: 0.5, tint: new THREE.Color(0.85, 0.55, 1.0) },
    bloom: 1.2,
    envIntensity: 1.0,
    probe: new THREE.Vector3(0, 3, 0),
  };
  arena.cameraBounds.set(new THREE.Vector3(-PR + 0.6, 0.35, -PR + 0.6), new THREE.Vector3(PR - 0.6, 14, PR - 0.6));
  arena.marks.entrance = new THREE.Vector3(0, 0, PR - 1.5);
  arena.hypeHandlers.push((a) => {
    bUniforms.uPulse.value = Math.min(1, bUniforms.uPulse.value + a * 0.5);
  });
  arena.updaters.push((dt, t) => {
    bUniforms.uPulse.value *= Math.exp(-dt * 2.5);
    for (const f of floaters) f.m.position.y = f.base + Math.sin(t * f.speed + f.phase) * 0.6;
    crystals.forEach((c, i) => {
      c.rotation.y += dt * 0.8;
      c.position.y = 10 + Math.sin(t * 1.3 + i) * 0.25;
    });
    pillarLights.forEach((l, i) => (l.intensity = 22 + Math.sin(t * 2 + i * 2) * 6));
    rune.rotation.z += dt * 0.15;
    const p = motes.geometry.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += dt * (0.3 + (i % 7) * 0.05);
      if (arr[i + 1] > 25) arr[i + 1] = 0;
    }
    p.needsUpdate = true;
  });
  return arena;
}
