import * as THREE from 'three';
import type { QualityProfile } from '../../config/quality';
import { makeCanvasTexture } from '../../rendering/Textures';
import { Arena } from '../Arena';
import { box, buildBench, buildBoards, courtLines, lightShaft, noiseSurface, Scoreboard } from '../ArenaKit';
import { Crowd } from '../Crowd';
import { chainFence, container, graffitiTexture, neonSign } from '../Environment';
import { createFloorMaterial } from '../FloorMaterial';

/** The Pit: invitation-only underground league in a flooded-out industrial hall. */
export function buildUnderground(q: QualityProfile, hw: number, hl: number): Arena {
  const arena = new Arena({ id: 'underground', name: 'The Pit', location: 'Old Foundry · Level B3', tagline: 'Play for keeps.', court: { halfWidth: hw, halfLength: hl } }, q);
  const R = arena.root;
  const HX = hw + 9, HZ = hl + 9, H = 11;

  // ---------------- floor ----------------
  const conc = noiseSurface('#4a4a4e', 0.42, 31, 40, 0.1);
  conc.map.repeat.set((HX * 2) / 4, (HZ * 2) / 4);
  conc.normal!.repeat.set((HX * 2) / 4, (HZ * 2) / 4);
  const lines = courtLines(hw, hl, {
    line: '#e8e2d4',
    center: '#ff2a1a',
    homeTint: '#27e0d0',
    awayTint: '#ff2a1a',
    tintAlpha: 0.12,
    logo: 'THE PIT',
    logoSub: 'NO RULES BUT THE LINE',
    logoColor: 'rgba(255,42,26,0.5)',
    courtFill: 'rgba(28,28,32,0.72)',
    borderFill: '#c9a227',
    fillMargin: 0.6,
    glow: true,
  });
  const floorMat = createFloorMaterial({ map: conc.map, normalMap: conc.normal, lines: lines.tex, linesSize: lines.size, tileSize: 4, roughness: 0.75, linesRoughness: 0.6, emissiveLines: 0.12 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  R.add(floor);
  // puddles (glossy patches)
  const puddle = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.75 });
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.6 + Math.random() * 1.4, 24), puddle);
    p.rotation.x = -Math.PI / 2;
    const side = Math.random() < 0.5 ? 1 : -1;
    p.position.set(side * (hw + 2 + Math.random() * 5), 0.006, (Math.random() - 0.5) * HZ * 1.6);
    p.scale.set(1, 0.6 + Math.random() * 0.6, 1);
    R.add(p);
  }

  // ---------------- hall shell ----------------
  const wallTex = graffitiTexture(['THE PIT', 'B3', 'PLAY 4 KEEPS', 'IRON'], ['#ff2a1a', '#c9a227', '#27e0d0', '#9b5cff'], '#3a3a3e', 77);
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.repeat.set(3, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  const endMat = new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.9 });
  for (const [w, x, z, ry, m] of [
    [HZ * 2, -HX, 0, Math.PI / 2, wallMat],
    [HZ * 2, HX, 0, -Math.PI / 2, wallMat],
    [HX * 2, 0, -HZ, 0, endMat],
    [HX * 2, 0, HZ, Math.PI, endMat],
  ] as [number, number, number, number, THREE.Material][]) {
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(w, H), m);
    wm.position.set(x, H / 2, z);
    wm.rotation.y = ry;
    wm.receiveShadow = true;
    R.add(wm);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), new THREE.MeshStandardMaterial({ color: 0x151518, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  R.add(ceil);
  const steel = new THREE.MeshStandardMaterial({ color: 0x3d3f45, roughness: 0.55, metalness: 0.8 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x6b3f2a, roughness: 0.8, metalness: 0.4 });
  // columns + girders
  for (const x of [-HX + 1, HX - 1]) for (let z = -HZ + 3; z <= HZ - 3; z += 6) R.add(box(0.5, H, 0.5, steel, x, H / 2, z));
  for (let z = -HZ + 3; z <= HZ - 3; z += 6) R.add(box(HX * 2, 0.6, 0.35, rust, 0, H - 0.8, z, false));
  // pipes along walls
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.4, metalness: 0.9 });
  for (const s of [-1, 1]) for (const y of [7.2, 7.8, 8.6]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, HZ * 2, 10), pipeMat);
    p.rotation.x = Math.PI / 2;
    p.position.set(s * (HX - 0.4), y, 0);
    R.add(p);
  }
  // mezzanine catwalk with standing crowd (+X side and away end)
  const catY = 4.2;
  const grate = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.6, metalness: 0.8 });
  R.add(box(3.2, 0.15, HZ * 2 - 2, grate, HX - 2.2, catY, 0));
  R.add(box(HX * 2 - 2, 0.15, 3, grate, 0, catY, -HZ + 2));
  for (const z of [-HZ + 1.3, HZ - 1.3]) R.add(box(0.15, 1.1, 0.15, steel, HX - 3.8, catY + 0.55, z, false));
  R.add(box(0.08, 0.08, HZ * 2 - 2, steel, HX - 3.8, catY + 1.1, 0, false));
  R.add(box(HX * 2 - 2, 0.08, 0.08, steel, 0, catY + 1.1, -HZ + 3.5, false));
  for (let z = -HZ + 3; z <= HZ - 3; z += 6) R.add(box(0.2, catY, 0.2, steel, HX - 3.8, catY / 2, z));
  const seats: { pos: THREE.Vector3; yaw: number }[] = [];
  for (let i = 0; i < 110; i++) {
    if (Math.random() > q.crowdDensity) continue;
    if (Math.random() < 0.6) seats.push({ pos: new THREE.Vector3(HX - 2.2 + (Math.random() - 0.5) * 2.4, catY + 0.9, (Math.random() - 0.5) * (HZ * 2 - 4)), yaw: -Math.PI / 2 });
    else seats.push({ pos: new THREE.Vector3((Math.random() - 0.5) * (HX * 2 - 4), catY + 0.9, -HZ + 2 + (Math.random() - 0.5) * 2), yaw: 0 });
  }
  // ground-level crowd behind the cage on -X
  for (let i = 0; i < 40; i++) {
    if (Math.random() > q.crowdDensity) continue;
    seats.push({ pos: new THREE.Vector3(-hw - 4.2 - Math.random() * 3, 0.8, (Math.random() - 0.5) * hl * 2), yaw: Math.PI / 2 });
  }
  if (seats.length) {
    arena.crowd = new Crowd(seats, [0x2b2b2e, 0xb91c1c, 0x3f3f46, 0x52525b, 0x1f2937, 0xc9a227, 0x4c1d95], undefined, true);
    R.add(arena.crowd.mesh);
  }

  // ---------------- cage + boards + cover ----------------
  const boards = buildBoards(hw, hl, {
    height: 1.0,
    padColor: 0x1a1a1d,
    railColor: 0xff2a1a,
    railEmissive: 0.6,
    ads: [
      { text: 'IRON SYNDICATE', bg: '#18181b', fg: '#ef4444' },
      { text: 'B3 SCRAPWORKS', bg: '#c9a227', fg: '#18181b' },
      { text: 'NIGHT SHIFT', bg: '#27272a', fg: '#e4e4e7' },
      { text: 'THE PIT', bg: '#7f1d1d', fg: '#fde68a' },
    ],
  });
  R.add(boards.group);
  const cx = hw + 2.6, cz = hl + 3.2;
  R.add(chainFence([new THREE.Vector2(-cx, -cz), new THREE.Vector2(cx, -cz), new THREE.Vector2(cx, cz), new THREE.Vector2(-cx, cz), new THREE.Vector2(-cx, -cz)], 5, 0x8a8f96));
  for (const s of [1, -1]) {
    const b = buildBench(4.2, 0x3f3f46);
    b.position.set(-(hw + 1.45), 0, s * 3.9);
    R.add(b);
  }
  // concrete barrier cover (2 per half) — real gameplay obstacles
  const barrierTex = makeCanvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#8c8a86';
    g.fillRect(0, 0, w, h);
    for (let x = -h; x < w; x += 40) {
      g.fillStyle = '#e0b020';
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 20, h);
      g.lineTo(x + 20 + h * 0.4, h * 0.6);
      g.lineTo(x + h * 0.4, h * 0.6);
      g.fill();
    }
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 30;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  });
  const barrierMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.85 });
  const bw = 1.5, bh = 0.95, bd = 0.55;
  for (const sz of [1, -1]) for (const sx of [1, -1]) {
    const x = sx * Math.min(hw * 0.45, 2.9);
    const z = sz * hl * 0.5;
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), barrierMat);
    m.position.set(x, bh / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    R.add(m);
    arena.obstacles.push({ min: new THREE.Vector3(x - bw / 2, 0, z - bd / 2), max: new THREE.Vector3(x + bw / 2, bh, z + bd / 2) });
  }

  // ---------------- containers, props, signage ----------------
  const cols = [0x7f1d1d, 0x1f2937, 0x3f6212, 0x78350f];
  for (let i = 0; i < 6; i++) {
    const c = container(cols[i % cols.length], 6);
    c.position.set(-HX + 2.2, (i % 2) * 2.6, -HZ + 4 + Math.floor(i / 2) * 3);
    c.rotation.y = Math.PI / 2;
    R.add(c);
  }
  const sign = neonSign('THE PIT', '#ff2a1a', 7, { backing: true });
  sign.position.set(0, 7.5, -HZ + 0.3);
  R.add(sign);
  const sb = new Scoreboard(2.8, 'HOME', 'AWAY', '#ef4444', 0x111114);
  sb.group.position.set(0, 5.4, -HZ + 0.4);
  R.add(sb.group);
  arena.scoreboards.push(sb);
  // hanging lamps with shafts + red warning beacons
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff2d8, emissiveIntensity: 4 });
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 3 });
  const shaftMats: THREE.ShaderMaterial[] = [];
  for (const [x, z] of [
    [-hw * 0.5, -hl * 0.5],
    [hw * 0.5, -hl * 0.5],
    [-hw * 0.5, hl * 0.5],
    [hw * 0.5, hl * 0.5],
    [0, 0],
  ]) {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.5, 20, 1, true), steel);
    shade.position.set(x, H - 2.6, z);
    R.add(shade);
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), lampMat);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(x, H - 2.84, z);
    R.add(bulb);
    R.add(box(0.03, 2.4, 0.03, steel, x, H - 1.2, z, false));
    if (q.envDetail > 0.4) {
      const sh = lightShaft(new THREE.Vector3(x, H - 2.9, z), new THREE.Vector3(x, 0, z), 3.4, 0xfff0d0, 0.06);
      shaftMats.push(sh.material as THREE.ShaderMaterial);
      R.add(sh);
    }
  }
  for (const s of shaftMats) arena.timeUniforms.push(s.uniforms.uTime);
  const beacons: THREE.PointLight[] = [];
  for (const [x, z] of [
    [-HX + 0.6, -HZ * 0.4],
    [HX - 0.6, HZ * 0.4],
  ]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), beaconMat);
    b.position.set(x, 6, z);
    R.add(b);
    const l = new THREE.PointLight(0xff2010, 8, 12, 1.6);
    l.position.set(x * 0.95, 6, z);
    R.add(l);
    beacons.push(l);
  }

  // ---------------- lighting ----------------
  R.add(new THREE.HemisphereLight(0x5a6070, 0x201818, 0.45));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
  key.position.set(3, 24, 4);
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
  const court = new THREE.SpotLight(0xffe9c8, 60, 30, 0.9, 0.6, 1.5);
  court.position.set(0, H - 1, 0);
  court.target.position.set(0, 0, 0);
  R.add(court, court.target);

  arena.look = {
    background: new THREE.Color(0x0d0d10),
    fog: new THREE.FogExp2(0x1a1718, 0.028),
    grade: { exposure: 1.08, contrast: 1.12, saturation: 0.95, tint: new THREE.Color(1.04, 0.99, 0.95) },
    bloom: 0.95,
    envIntensity: 0.75,
    probe: new THREE.Vector3(0, 3, 0),
  };
  arena.cameraBounds.set(new THREE.Vector3(-cx + 0.3, 0.35, -cz + 0.3), new THREE.Vector3(cx - 0.3, H - 1.5, cz - 0.3));
  arena.marks.entrance = new THREE.Vector3(0, 0, HZ - 2);
  arena.updaters.push((_dt, t) => {
    beacons.forEach((b, i) => (b.intensity = 5 + 5 * Math.max(0, Math.sin(t * 3 + i * 1.5))));
  });
  return arena;
}
