import * as THREE from 'three';
import type { QualityProfile } from '../../config/quality';
import { makeCanvasTexture } from '../../rendering/Textures';
import { Arena } from '../Arena';
import { box, buildBench, buildBoards, courtLines, lightShaft, Scoreboard, woodTextures } from '../ArenaKit';
import { Crowd, standSeats } from '../Crowd';
import { createFloorMaterial } from '../FloorMaterial';

/** Crown Arena: 20,000-seat championship bowl. */
export function buildStadium(q: QualityProfile, hw: number, hl: number): Arena {
  const arena = new Arena({ id: 'stadium', name: 'Crown Arena', location: 'Crown Championship', tagline: 'Twenty thousand fans. One trophy.', court: { halfWidth: hw, halfLength: hl } }, q);
  const R = arena.root;
  const PX = hw + 5, PZ = hl + 6.5; // playing floor extents
  const H = 26;

  // ---------------- floor ----------------
  const wood = woodTextures(['#9a5b33', '#8e532f', '#a66a3e'], 29);
  wood.map.repeat.set((PX * 2) / 2, (PZ * 2) / 2);
  wood.normal!.repeat.set((PX * 2) / 2, (PZ * 2) / 2);
  wood.rough!.repeat.set((PX * 2) / 2, (PZ * 2) / 2);
  const lines = courtLines(hw, hl, {
    line: '#f7f1e3',
    center: '#c8a14a',
    homeTint: '#27e0d0',
    awayTint: '#c8a14a',
    tintAlpha: 0.08,
    logo: 'CROWN',
    logoSub: 'CHAMPIONSHIP SERIES',
    logoColor: 'rgba(200,161,74,0.8)',
    circle: '#c8a14a',
    borderFill: '#1a1330',
    fillMargin: 1.4,
  });
  const floorMat = createFloorMaterial({ map: wood.map, normalMap: wood.normal, roughnessMap: wood.rough, lines: lines.tex, linesSize: lines.size, tileSize: 2, roughness: 0.32, linesRoughness: 0.25 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(PX * 2, PZ * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  R.add(floor);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(PX * 2 + 8, PZ * 2 + 8), new THREE.MeshStandardMaterial({ color: 0x0f0c18, roughness: 0.7 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  R.add(apron);

  // ---------------- boards with LED ribbons ----------------
  const boards = buildBoards(hw, hl, {
    height: 1.1,
    padColor: 0x141028,
    railColor: 0xc8a14a,
    railEmissive: 0.4,
    glass: true,
    ads: [
      { text: 'CROWN CHAMPIONSHIP', bg: '#140f24', fg: '#c8a14a' },
      { text: 'ROYAL AIRWAYS', bg: '#c8a14a', fg: '#140f24' },
      { text: 'VOLT ENERGY', bg: '#0f172a', fg: '#b6ff3b' },
      { text: 'SUMMIT BANK', bg: '#1e3a8a', fg: '#ffffff' },
      { text: 'CITY TRANSIT', bg: '#dc2626', fg: '#ffffff' },
    ],
  });
  R.add(boards.group);
  for (const s of [1, -1]) {
    const b = buildBench(4.6, 0x241c3d);
    b.position.set(-(hw + 1.45), 0, s * 3.9);
    R.add(b);
  }

  // ---------------- stands (4 sides) ----------------
  const standMat = new THREE.MeshStandardMaterial({ color: 0x1b1530, roughness: 0.8 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x3b3355, roughness: 0.4, metalness: 0.6 });
  const rows = 14;
  const rowD = 0.85, rowH = 0.52;
  const seats: { pos: THREE.Vector3; yaw: number }[] = [];
  const density = 0.92 * q.crowdDensity;
  const sides: { origin: THREE.Vector3; along: THREE.Vector3; back: THREE.Vector3; len: number; yaw: number; gap?: number[] }[] = [
    { origin: new THREE.Vector3(PX + 0.8, 0, 0), along: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(1, 0, 0), len: PZ * 2 + 2, yaw: -Math.PI / 2 },
    { origin: new THREE.Vector3(-PX - 0.8, 0, 0), along: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(-1, 0, 0), len: PZ * 2 + 2, yaw: Math.PI / 2 },
    { origin: new THREE.Vector3(0, 0, -PZ - 0.8), along: new THREE.Vector3(1, 0, 0), back: new THREE.Vector3(0, 0, -1), len: PX * 2 + 2, yaw: 0 },
    { origin: new THREE.Vector3(0, 0, PZ + 0.8), along: new THREE.Vector3(1, 0, 0), back: new THREE.Vector3(0, 0, 1), len: PX * 2 + 2, yaw: Math.PI, gap: [0] },
  ];
  for (const sd of sides) {
    for (let r = 0; r < rows; r++) {
      const y0 = 1.2 + r * rowH;
      const c = sd.origin.clone().addScaledVector(sd.back, r * rowD + rowD / 2);
      const geoW = sd.along.x !== 0 ? sd.len : rowD;
      const geoD = sd.along.x !== 0 ? rowD : sd.len;
      const m = new THREE.Mesh(new THREE.BoxGeometry(geoW, y0, geoD), standMat);
      m.position.set(c.x, y0 / 2, c.z);
      m.receiveShadow = true;
      R.add(m);
    }
    const front = sd.origin.clone().addScaledVector(sd.back, 0.05);
    R.add(box(sd.along.x !== 0 ? sd.len : 0.1, 1.25, sd.along.x !== 0 ? 0.1 : sd.len, railMat, front.x, 0.62, front.z, false));
    seats.push(
      ...standSeats({ origin: sd.origin.clone().add(new THREE.Vector3(0, 1.25, 0)).addScaledVector(sd.back, 0.3), along: sd.along, back: sd.back, rows, length: sd.len - 1, rowDepth: rowD, rowRise: rowH, spacing: 0.62, density, facingYaw: sd.yaw, gaps: sd.gap }),
    );
  }
  // upper ring wall + roof
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(PX, PZ) + rows * rowD + 6, Math.max(PX, PZ) + rows * rowD + 6, H, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x0b0914, roughness: 0.9, side: THREE.BackSide }));
  outer.position.y = H / 2;
  R.add(outer);
  const roofM = new THREE.Mesh(new THREE.CircleGeometry(Math.max(PX, PZ) + rows * rowD + 6, 48), new THREE.MeshStandardMaterial({ color: 0x07060b, roughness: 1, side: THREE.BackSide }));
  roofM.rotation.x = -Math.PI / 2;
  roofM.position.y = H;
  R.add(roofM);
  if (seats.length) {
    arena.crowd = new Crowd(seats, [0xc8a14a, 0x27e0d0, 0xf5f0e1, 0x1e1b4b, 0x7c3aed, 0xdc2626, 0x0f172a, 0xc8a14a, 0x27e0d0]);
    R.add(arena.crowd.mesh);
  }

  // ---------------- light rings, truss, jumbotron ----------------
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff4e0, emissiveIntensity: 3.2 });
  for (const [r, y] of [
    [PZ + 4, H - 5],
    [PZ + 10, H - 3],
  ]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 8, 64), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    R.add(ring);
  }
  const truss = new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.5, metalness: 0.7 });
  for (const s of [-1, 1]) R.add(box(0.4, 0.4, PZ * 2 + 12, truss, s * 4, H - 6.2, 0, false));
  for (const s of [-1, 1]) R.add(box(PX * 2 + 12, 0.4, 0.4, truss, 0, H - 6.2, s * 4, false));
  const jumbo = new THREE.Group();
  const housing = new THREE.MeshStandardMaterial({ color: 0x0c0a16, roughness: 0.4, metalness: 0.6 });
  jumbo.add(box(7.4, 4.6, 7.4, housing, 0, 0, 0, false));
  const faces: Scoreboard[] = [];
  for (let i = 0; i < 4; i++) {
    const sb = new Scoreboard(6.6, 'HOME', 'AWAY', '#c8a14a', 0x0c0a16);
    const a = (i * Math.PI) / 2;
    sb.group.position.set(Math.sin(a) * 3.6, 0, Math.cos(a) * 3.6);
    sb.group.rotation.y = a;
    jumbo.add(sb.group);
    faces.push(sb);
  }
  const jRing = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.12, 8, 48), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xc8a14a, emissiveIntensity: 3 }));
  jRing.rotation.x = Math.PI / 2;
  jRing.position.y = -2.5;
  jumbo.add(jRing);
  jumbo.position.set(0, H - 9, 0);
  R.add(jumbo);
  arena.scoreboards.push(...faces);

  // player tunnel at the home end
  const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x07060b, roughness: 1 });
  const tz = PZ + 0.8 + rows * rowD * 0.35;
  R.add(box(4, 3.4, rows * rowD * 0.7, tunnelMat, 0, 1.7, tz, false));
  const frame = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x27e0d0, emissiveIntensity: 2.4 });
  R.add(box(4.3, 0.15, 0.2, frame, 0, 3.45, PZ + 0.75, false));
  for (const s of [-1, 1]) R.add(box(0.15, 3.45, 0.2, frame, s * 2.1, 1.72, PZ + 0.75, false));
  arena.marks.entrance = new THREE.Vector3(0, 0, PZ + 1.5);

  // banners hanging from the roof
  const bannerCols = [
    ['#140f24', '#c8a14a', 'CHAMPIONS'],
    ['#c8a14a', '#140f24', 'CROWN'],
    ['#1e3a8a', '#ffffff', 'LEGACY'],
    ['#7f1d1d', '#fde68a', 'GLORY'],
  ];
  bannerCols.forEach(([bg, fg, t], i) => {
    const tex = makeCanvasTexture(128, 384, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.font = 'italic 800 44px "Barlow Condensed", Arial Narrow, sans-serif';
      g.textAlign = 'center';
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(-Math.PI / 2);
      g.fillText(t, 0, 14);
      g.restore();
      g.fillRect(0, h - 18, w, 6);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 6), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
    const a = (i / bannerCols.length) * Math.PI * 2 + 0.4;
    m.position.set(Math.sin(a) * (PZ + 7), H - 7, Math.cos(a) * (PZ + 7));
    m.lookAt(0, H - 7, 0);
    R.add(m);
  });

  // roving spotlights (visual beams)
  const beams: THREE.Mesh[] = [];
  if (q.envDetail > 0.4) {
    for (let i = 0; i < 4; i++) {
      const from = new THREE.Vector3(Math.sin(i * 1.6) * 12, H - 4, Math.cos(i * 1.6) * 14);
      const beam = lightShaft(from, new THREE.Vector3(0, 0, 0), 3.2, i % 2 ? 0xc8a14a : 0x9fd8ff, 0.07);
      beams.push(beam);
      R.add(beam);
      arena.timeUniforms.push((beam.material as THREE.ShaderMaterial).uniforms.uTime);
    }
  }

  // ---------------- lighting ----------------
  R.add(new THREE.HemisphereLight(0x8078b0, 0x1a1024, 0.55));
  const key = new THREE.DirectionalLight(0xfff6ea, 2.8);
  key.position.set(-6, 26, 8);
  key.target.position.set(0, 0, 0);
  key.castShadow = q.shadows;
  key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  const sc = key.shadow.camera;
  sc.left = -hw - 4;
  sc.right = hw + 4;
  sc.top = hl + 5;
  sc.bottom = -hl - 5;
  sc.near = 1;
  sc.far = 70;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  R.add(key, key.target);
  arena.keyLight = key;
  const gold = new THREE.PointLight(0xc8a14a, 30, 30, 1.5);
  gold.position.set(0, 10, -PZ);
  R.add(gold);
  const teal = new THREE.PointLight(0x27e0d0, 18, 30, 1.5);
  teal.position.set(0, 10, PZ);
  R.add(teal);

  arena.look = {
    background: new THREE.Color(0x07060b),
    fog: new THREE.Fog(0x120e1f, 40, 110),
    grade: { exposure: 1.06, contrast: 1.1, saturation: 1.08, tint: new THREE.Color(1.0, 0.99, 1.02) },
    bloom: 1.0,
    envIntensity: 1.0,
    probe: new THREE.Vector3(0, 3, 0),
  };
  arena.cameraBounds.set(new THREE.Vector3(-PX + 0.6, 0.35, -PZ + 0.6), new THREE.Vector3(PX - 0.6, 16, PZ + 0.4));
  arena.blockers.push(new THREE.Box3(new THREE.Vector3(-PX - 30, 0, PZ + 0.8), new THREE.Vector3(PX + 30, 12, PZ + 30)));
  arena.hypeHandlers.push((a) => {
    ringMat.emissiveIntensity = 3.2 + a * 1.2;
  });
  arena.updaters.push((dt, t) => {
    jumbo.rotation.y += dt * 0.05;
    beams.forEach((b, i) => {
      const target = new THREE.Vector3(Math.sin(t * 0.4 + i * 1.7) * hw * 0.8, 0, Math.cos(t * 0.3 + i) * hl * 0.8);
      const dir = new THREE.Vector3().subVectors(target, b.position).normalize();
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    });
    ringMat.emissiveIntensity += (3.2 - ringMat.emissiveIntensity) * Math.min(1, dt * 2);
  });
  return arena;
}
