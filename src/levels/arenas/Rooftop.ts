import * as THREE from 'three';
import type { QualityProfile } from '../../config/quality';
import { Arena } from '../Arena';
import { box, buildBench, buildBoards, courtLines, noiseSurface, Scoreboard, tileSurface } from '../ArenaKit';
import { Crowd, standSeats } from '../Crowd';
import { floodRig, neonSign, skyDome, skyline, stringLights } from '../Environment';
import { createFloorMaterial } from '../FloorMaterial';

/** Skyline Rooftop: tiled court forty floors up, city lights all around. */
export function buildRooftop(q: QualityProfile, hw: number, hl: number): Arena {
  const arena = new Arena({ id: 'rooftop', name: 'Skyline Rooftop', location: 'Downtown · Floor 40', tagline: 'The city league plays under the lights.', court: { halfWidth: hw, halfLength: hl } }, q);
  const R = arena.root;

  const moonDir = new THREE.Vector3(-0.4, 0.5, -0.75).normalize();
  const sky = skyDome({ top: 0x05070f, mid: 0x0d1430, horizon: 0x3a2a4a, bottom: 0x120d18, sunDir: moonDir, sunColor: 0xcfdcff, sunSize: 0.006, sunGlow: 0.25, stars: 1, clouds: 0.25, cloudColor: 0x2a2f55 });
  R.add(sky.mesh);
  arena.timeUniforms.push(sky.uniforms.uTime);
  const city = skyline({ inner: 70, outer: 240, count: 180, minH: -10, maxH: 120, color: 0x151a26, lit: 0.34, warm: false, seed: 41, blink: true });
  R.add(city);

  // ---------------- roof + sport deck ----------------
  const RX = hw + 7.5, RZ = hl + 9;
  const roofTex = noiseSurface('#5d6068', 0.28, 17, 10, 0.1);
  roofTex.map.repeat.set((RX * 2) / 4, (RZ * 2) / 4);
  roofTex.normal!.repeat.set((RX * 2) / 4, (RZ * 2) / 4);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), new THREE.MeshStandardMaterial({ map: roofTex.map, normalMap: roofTex.normal, roughness: 0.92 }));
  roof.rotation.x = -Math.PI / 2;
  roof.position.y = -0.02;
  roof.receiveShadow = true;
  R.add(roof);
  const tiles = tileSurface('#1f3f8f', '#23479e', 23);
  const deckW = hw + 2.2, deckL = hl + 2.6;
  tiles.map.repeat.set((deckW * 2) / 4, (deckL * 2) / 4);
  tiles.normal!.repeat.set((deckW * 2) / 4, (deckL * 2) / 4);
  const lines = courtLines(hw, hl, {
    line: '#f4f7ff',
    center: '#b6ff3b',
    homeTint: '#27e0d0',
    awayTint: '#b6ff3b',
    tintAlpha: 0.14,
    logo: 'CITY LEAGUE',
    logoSub: 'SKYLINE DIVISION',
    logoColor: 'rgba(255,255,255,0.35)',
    borderFill: '#15296b',
    fillMargin: 1.2,
    courtFill: 'rgba(0,0,0,0)',
  });
  const deckMat = createFloorMaterial({ map: tiles.map, normalMap: tiles.normal, lines: lines.tex, linesSize: lines.size, tileSize: 4, roughness: 0.55, linesRoughness: 0.45, reflect: 0.85 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW * 2, 0.08, deckL * 2), deckMat);
  deck.position.y = -0.04;
  deck.receiveShadow = true;
  R.add(deck);
  // parapet + glass railing at the roof edge
  const para = new THREE.MeshStandardMaterial({ color: 0x3b3e46, roughness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfd8ff, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false });
  const rail = new THREE.MeshStandardMaterial({ color: 0xaab3c0, roughness: 0.3, metalness: 0.9 });
  for (const [w, x, z, ry] of [
    [RX * 2, 0, -RZ, 0],
    [RX * 2, 0, RZ, 0],
    [RZ * 2, -RX, 0, Math.PI / 2],
    [RZ * 2, RX, 0, Math.PI / 2],
  ] as [number, number, number, number][]) {
    const g = new THREE.Group();
    g.add(box(w, 0.6, 0.4, para, 0, 0.3, 0));
    const gl = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 0.03), glass);
    gl.position.y = 1.15;
    g.add(gl);
    g.add(box(w, 0.06, 0.08, rail, 0, 1.72, 0, false));
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    R.add(g);
  }

  // ---------------- boards, benches ----------------
  const boards = buildBoards(hw, hl, {
    height: 1.1,
    padColor: 0x101624,
    railColor: 0xb6ff3b,
    railEmissive: 0.8,
    glass: q.envDetail > 0.5,
    ads: [
      { text: 'SKYLINE LEAGUE', bg: '#0f172a', fg: '#b6ff3b' },
      { text: 'METRO TRANSIT', bg: '#1e3a8a', fg: '#ffffff' },
      { text: 'NEON NOODLE', bg: '#be185d', fg: '#ffffff' },
      { text: 'VOLT ENERGY', bg: '#b6ff3b', fg: '#0f172a' },
      { text: 'CITY LEAGUE', bg: '#111827', fg: '#27e0d0' },
    ],
  });
  R.add(boards.group);
  for (const s of [1, -1]) {
    const b = buildBench(4.2, 0x3a3f47);
    b.position.set(-(hw + 1.45), 0, s * 3.9);
    R.add(b);
  }

  // ---------------- small bleachers + crowd ----------------
  const bleachMat = new THREE.MeshStandardMaterial({ color: 0x3b414c, roughness: 0.6, metalness: 0.5 });
  const bx0 = hw + 2.6;
  const rows = 4;
  const bLen = hl * 1.6;
  for (let r = 0; r < rows; r++) R.add(box(0.55, 0.06, bLen, bleachMat, bx0 + r * 0.62, 0.36 + r * 0.36, 0));
  const seats = standSeats({ origin: new THREE.Vector3(bx0 + 0.05, 0.42, 0), along: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(1, 0, 0), rows, length: bLen - 0.6, rowDepth: 0.62, rowRise: 0.36, spacing: 0.62, density: 0.65 * q.crowdDensity, facingYaw: -Math.PI / 2 });
  for (let i = 0; i < 40; i++) {
    if (Math.random() > q.crowdDensity) continue;
    seats.push({ pos: new THREE.Vector3(-RX + 1 + Math.random() * 2.5, 0.8, (Math.random() - 0.5) * RZ * 1.6), yaw: Math.PI / 2 });
  }
  if (seats.length) {
    arena.crowd = new Crowd(seats, [0x0f9d58, 0xb6ff3b, 0x1e3a8a, 0xdc2626, 0x111827, 0xf8fafc, 0x7c3aed]);
    R.add(arena.crowd.mesh);
  }

  // ---------------- rooftop props ----------------
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.45, metalness: 0.8 });
  for (const [x, z] of [
    [-RX + 2.5, -RZ + 3],
    [-RX + 2.5, -RZ + 6.5],
    [RX - 2.5, RZ - 3],
  ]) {
    const hvac = new THREE.Group();
    hvac.add(box(2.4, 1.6, 2, metal, 0, 0.8, 0));
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.6 }));
    fan.position.y = 1.65;
    hvac.add(fan);
    hvac.position.set(x, 0, z);
    R.add(hvac);
  }
  // water tower
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a35, roughness: 0.85 });
  const tower = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3.2, 24), wood);
  tank.position.y = 5.2;
  tank.castShadow = true;
  tower.add(tank);
  const roofCone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.3, 24), new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.8 }));
  roofCone.position.y = 7.45;
  tower.add(roofCone);
  for (const [ox, oz] of [
    [-1.4, -1.4],
    [1.4, -1.4],
    [-1.4, 1.4],
    [1.4, 1.4],
  ])
    tower.add(box(0.18, 3.6, 0.18, metal, ox, 1.8, oz));
  tower.position.set(RX - 3.5, 0, -RZ + 3.5);
  R.add(tower);

  // neon billboard on a steel frame behind the away end
  const sign = neonSign('SKYLINE LEAGUE', '#b6ff3b', 12, { backing: true });
  sign.position.set(0, 9.5, -RZ - 3);
  R.add(sign);
  for (const ox of [-5, 5]) R.add(box(0.3, 9, 0.3, metal, ox, 4.5, -RZ - 3.2));
  const sign2 = neonSign('CITY LEAGUE', '#ff4fd8', 6, { backing: true });
  sign2.position.set(-RX - 0.3, 5.5, 4);
  sign2.rotation.y = Math.PI / 2;
  R.add(sign2);
  const neonLight = new THREE.PointLight(0xb6ff3b, 20, 22, 1.6);
  neonLight.position.set(0, 7, -RZ + 1);
  R.add(neonLight);

  // string lights across the court
  if (q.envDetail > 0.3) {
    for (const z of [-hl * 0.66, 0, hl * 0.66]) R.add(stringLights(new THREE.Vector3(-hw - 2.5, 6.5, z), new THREE.Vector3(hw + 2.5, 6.5, z + 1.5), 26, 1.2));
    for (const s of [-1, 1]) for (const z of [-hl * 0.66, 0, hl * 0.66]) {
      R.add(box(0.1, 6.6, 0.1, metal, s * (hw + 2.5), 3.3, z + (s > 0 ? 1.5 : 0)));
    }
  }
  // flood rigs at the corners
  const shafts: THREE.ShaderMaterial[] = [];
  for (const [x, z] of [
    [-RX + 1, -RZ + 1],
    [RX - 1, -RZ + 1],
    [-RX + 1, RZ - 1],
    [RX - 1, RZ - 1],
  ]) {
    const r = floodRig(new THREE.Vector3(x, 11, z), new THREE.Vector3(x * 0.2, 0, z * 0.2), 3, q.envDetail > 0.5, 0xeaf1ff);
    R.add(r.group);
    if (r.shaftMat) shafts.push(r.shaftMat);
  }
  for (const s of shafts) arena.timeUniforms.push(s.uniforms.uTime);

  const sb = new Scoreboard(3, 'HOME', 'AWAY', '#b6ff3b', 0x0b0f1a);
  sb.group.position.set(0, 6.2, -RZ + 0.6);
  R.add(sb.group);
  arena.scoreboards.push(sb);

  // ---------------- lighting ----------------
  R.add(new THREE.HemisphereLight(0x3a4a8a, 0x1a1418, 0.55));
  const key = new THREE.DirectionalLight(0xeef3ff, 2.4);
  key.position.set(8, 22, 10);
  key.target.position.set(0, 0, 0);
  key.castShadow = q.shadows;
  key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  const sc = key.shadow.camera;
  sc.left = -hw - 4;
  sc.right = hw + 4;
  sc.top = hl + 5;
  sc.bottom = -hl - 5;
  sc.near = 1;
  sc.far = 60;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  R.add(key, key.target);
  arena.keyLight = key;
  const moon = new THREE.DirectionalLight(0x7f95ff, 0.6);
  moon.position.copy(moonDir).multiplyScalar(40);
  R.add(moon);
  const city2 = new THREE.PointLight(0xff9a5a, 10, 60, 1.2);
  city2.position.set(0, 3, RZ + 20);
  R.add(city2);

  arena.look = {
    background: new THREE.Color(0x0a0e1c),
    fog: new THREE.Fog(0x141a33, 80, 300),
    grade: { exposure: 1.05, contrast: 1.1, saturation: 1.1, tint: new THREE.Color(0.97, 1.0, 1.05) },
    lens: { strength: 0.38 },
    bloom: 1.05,
    envIntensity: 0.9,
    probe: new THREE.Vector3(0, 3, 0),
  };
  arena.cameraBounds.set(new THREE.Vector3(-RX + 0.6, 0.35, -RZ + 0.6), new THREE.Vector3(RX - 0.6, 14, RZ - 0.6));
  arena.marks.entrance = new THREE.Vector3(RX - 2, 0, RZ - 2);
  arena.hypeHandlers.push((a) => {
    neonLight.intensity = 20 + a * 20;
  });
  arena.updaters.push((_dt, t) => {
    const blink = city.children.find((c) => c.userData.blink) as THREE.InstancedMesh | undefined;
    if (blink) blink.visible = Math.sin(t * 2.2) > 0;
    neonLight.intensity = Math.max(12, neonLight.intensity * 0.98 + (Math.random() < 0.01 ? -8 : 0.4));
  });
  return arena;
}
