import * as THREE from 'three';
import type { QualityProfile } from '../../config/quality';
import { Arena } from '../Arena';
import { box, buildBench, buildBoards, courtLines, noiseSurface, Scoreboard } from '../ArenaKit';
import { Crowd } from '../Crowd';
import { chainFence, container, graffitiTexture, skyDome, skyline, water } from '../Environment';
import { createFloorMaterial } from '../FloorMaterial';

/** Harbor Street Court: waterfront asphalt court at golden hour. */
export function buildStreet(q: QualityProfile, hw: number, hl: number): Arena {
  const arena = new Arena({ id: 'street', name: 'Harbor Street Court', location: 'Harbor District', tagline: 'Respect is earned on the waterfront.', court: { halfWidth: hw, halfLength: hl } }, q);
  const R = arena.root;

  // ---------------- sky + distant city ----------------
  const sunDir = new THREE.Vector3(0.9, 0.16, -0.35).normalize();
  const sky = skyDome({ top: 0x2a2f6b, mid: 0x7a5aa0, horizon: 0xffa66b, bottom: 0x3a2a3a, sunDir, sunColor: 0xffb070, sunSize: 0.012, sunGlow: 0.9, clouds: 0.7, cloudColor: 0xffc49a });
  R.add(sky.mesh);
  arena.timeUniforms.push(sky.uniforms.uTime);
  const city = skyline({ inner: 150, outer: 260, count: 90, minH: 20, maxH: 110, color: 0x2a2530, lit: 0.18, warm: true, seed: 21, avoid: (x) => x > 60 });
  R.add(city);

  // ---------------- ground + court ----------------
  const asphalt = noiseSurface('#3b3a3f', 0.35, 9, 26, 0.06);
  const tile = 4;
  asphalt.map.repeat.set(160 / tile, 160 / tile);
  asphalt.normal!.repeat.set(160 / tile, 160 / tile);
  const lines = courtLines(hw, hl, {
    line: '#f2efe6',
    center: '#ff7a3d',
    homeTint: '#27e0d0',
    awayTint: '#ff4a3a',
    tintAlpha: 0.12,
    logo: 'HARBOR ST.',
    logoSub: 'COURT 9 · EST. 1984',
    logoColor: 'rgba(242,239,230,0.45)',
    courtFill: '#2c6b66',
    borderFill: '#9c4a34',
    fillMargin: 0.9,
  });
  const floorMat = createFloorMaterial({ map: asphalt.map, normalMap: asphalt.normal, lines: lines.tex, linesSize: lines.size, tileSize: tile, roughness: 0.9, linesRoughness: 0.7 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  R.add(floor);

  // harbour water beyond the pier edge (+X)
  const wx = hw + 16;
  const wat = water(260, 0x1d3b52);
  wat.mesh.position.set(wx + 130, -1.2, 0);
  R.add(wat.mesh);
  arena.timeUniforms.push(wat.time);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.9 });
  R.add(box(1, 1.3, 160, concrete, wx, -0.55, 0));
  // bollards along the pier
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.5, metalness: 0.6 });
  for (let z = -30; z <= 30; z += 6) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.7, 12), bollardMat);
    b.position.set(wx - 0.6, 0.35, z);
    b.castShadow = true;
    R.add(b);
  }
  // container cranes silhouettes across the water
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6, metalness: 0.5 });
  for (const [cx, cz] of [
    [wx + 70, -40],
    [wx + 90, 25],
  ]) {
    const c = new THREE.Group();
    for (const ox of [-6, 6]) for (const oz of [-5, 5]) c.add(box(0.8, 34, 0.8, craneMat, ox, 17, oz, false));
    c.add(box(14, 1.4, 1.2, craneMat, 0, 34, 0, false));
    c.add(box(1.2, 1.4, 52, craneMat, 0, 36, -8, false));
    c.position.set(cx, 0, cz);
    R.add(c);
  }
  // stacked containers on the dock
  const conts = [0xb03a2e, 0x1f6f8b, 0xd6a53a, 0x2e7d4f, 0x6b4ea0];
  for (let i = 0; i < 8; i++) {
    const c = container(conts[i % conts.length]);
    c.position.set(wx - 5 + (i % 2) * 0.1, (Math.floor(i / 4) % 2) * 2.6, -hl - 10 + (i % 4) * 2.6);
    c.rotation.y = Math.PI / 2;
    R.add(c);
  }

  // ---------------- warehouse wall with graffiti (-X) ----------------
  const gw = -(hw + 8);
  const graf = graffitiTexture(['HARBOR', 'DODGE', 'RICOCHET', 'EAST'], ['#ff5a3d', '#27e0d0', '#ffd166', '#b56cff', '#7cf29a'], '#7a4a3a', 12);
  graf.wrapS = THREE.RepeatWrapping;
  graf.repeat.set(2, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: graf, roughness: 0.9 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 60), wallMat);
  wall.position.set(gw - 0.5, 4.5, 0);
  wall.receiveShadow = true;
  R.add(wall);
  R.add(box(1.4, 0.4, 60, new THREE.MeshStandardMaterial({ color: 0x3b2a24, roughness: 0.8 }), gw - 0.4, 9.2, 0, false));
  // roll-up doors
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.5, metalness: 0.6 });
  for (const z of [-14, 14]) R.add(box(0.2, 4.2, 5, doorMat, gw + 0.05, 2.1, z, false));

  // ---------------- enclosure, fence, benches ----------------
  const boards = buildBoards(hw, hl, {
    height: 1.0,
    padColor: 0x1e3b2f,
    railColor: 0xff7a3d,
    ads: [
      { text: 'PIER 9 PIZZA', bg: '#c0392b', fg: '#fff3dc' },
      { text: 'HARBOR HUSTLE', bg: '#1b1b22', fg: '#ffd166' },
      { text: 'DOCKSIDE AUTO', bg: '#2c6b66', fg: '#ffffff' },
      { text: 'FRESH CATCH', bg: '#f2efe6', fg: '#1d3b52' },
      { text: 'NIGHT MARKET', bg: '#6b4ea0', fg: '#ffffff' },
    ],
  });
  R.add(boards.group);
  const fx = hw + 3.2, fz = hl + 4.5;
  R.add(chainFence([new THREE.Vector2(-fx, -fz), new THREE.Vector2(fx, -fz), new THREE.Vector2(fx, fz), new THREE.Vector2(2.5, fz)], 3.6));
  R.add(chainFence([new THREE.Vector2(-2.5, fz), new THREE.Vector2(-fx, fz), new THREE.Vector2(-fx, -fz)], 3.6));
  for (const s of [1, -1]) {
    const b = buildBench(4.2, 0x7a5a3a);
    b.position.set(-(hw + 1.45), 0, s * 3.9);
    R.add(b);
  }

  // ---------------- spectators along the fence ----------------
  const seats: { pos: THREE.Vector3; yaw: number }[] = [];
  const density = q.crowdDensity;
  for (let i = 0; i < 70; i++) {
    if (Math.random() > density) continue;
    const side = Math.random() < 0.55 ? 1 : -1;
    const z = (Math.random() - 0.5) * (hl * 2 + 6);
    const x = side > 0 ? fx + 0.8 + Math.random() * 2.5 : -fx - 0.8 - Math.random() * 2;
    seats.push({ pos: new THREE.Vector3(x, 0.8, z), yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
  }
  for (let i = 0; i < 20; i++) {
    if (Math.random() > density) continue;
    seats.push({ pos: new THREE.Vector3((Math.random() - 0.5) * fx * 1.6, 0.8, -fz - 1 - Math.random() * 3), yaw: 0 });
  }
  if (seats.length) {
    arena.crowd = new Crowd(seats, [0x2c6b66, 0xff7a3d, 0x1b1b22, 0xf2efe6, 0x6b4ea0, 0xd6a53a, 0x3b5b92, 0x8c3b3b], undefined, true);
    R.add(arena.crowd.mesh);
  }

  // ---------------- street lamps + props ----------------
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd18a, emissiveIntensity: 3.5 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.5, metalness: 0.7 });
  const lampSpots: THREE.Vector3[] = [];
  for (const [x, z] of [
    [-fx - 0.5, -hl * 0.6],
    [-fx - 0.5, hl * 0.6],
    [fx + 0.5, -hl * 0.6],
    [fx + 0.5, hl * 0.6],
  ]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6.5, 8), poleMat);
    pole.position.set(x, 3.25, z);
    pole.castShadow = true;
    R.add(pole);
    const arm = box(1.4, 0.08, 0.08, poleMat, x - Math.sign(x) * 0.6, 6.4, z, false);
    R.add(arm);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.18, 12), lampMat);
    head.position.set(x - Math.sign(x) * 1.2, 6.3, z);
    R.add(head);
    lampSpots.push(head.position.clone());
  }
  for (const p of lampSpots.slice(0, 2)) {
    const l = new THREE.PointLight(0xffc78a, 18, 14, 1.8);
    l.position.copy(p).add(new THREE.Vector3(0, -0.4, 0));
    R.add(l);
  }
  const sb = new Scoreboard(2.2, 'HOME', 'AWAY', '#ffd166', 0x1b1b22);
  sb.group.position.set(-fx + 0.1, 3.8, -hl * 0.2);
  sb.group.rotation.y = Math.PI / 2;
  R.add(sb.group);
  const sbPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), poleMat);
  sbPole.position.set(-fx + 0.05, 1.5, -hl * 0.2);
  R.add(sbPole);
  arena.scoreboards.push(sb);
  // van + bins + pallets
  const vanMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.4, metalness: 0.3 });
  const van = new THREE.Group();
  van.add(box(5, 2.2, 2.1, vanMat, 0, 1.4, 0));
  van.add(box(1.4, 1.4, 2.0, new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.1, metalness: 0.8 }), 2.4, 1.9, 0));
  for (const ox of [-1.6, 1.6]) for (const oz of [-1.05, 1.05]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 16), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
    wh.rotation.x = Math.PI / 2;
    wh.position.set(ox, 0.4, oz);
    van.add(wh);
  }
  van.position.set(gw + 3, 0, -hl - 1);
  van.rotation.y = 0.3;
  R.add(van);
  const binMat = new THREE.MeshStandardMaterial({ color: 0x2e5a3a, roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < 3; i++) R.add(box(0.8, 1.1, 0.8, binMat, gw + 1.2, 0.55, 8 + i * 1));
  const palletMat = new THREE.MeshStandardMaterial({ color: 0x9a7a55, roughness: 0.8 });
  for (let i = 0; i < 4; i++) R.add(box(1.2, 0.14, 1.0, palletMat, fx + 2.5, 0.07 + i * 0.14, -hl + 1));

  // ---------------- lighting ----------------
  R.add(new THREE.HemisphereLight(0x8a7ab8, 0x5a3a2a, 0.9));
  const sun = new THREE.DirectionalLight(0xffb27a, 3.0);
  sun.position.copy(sunDir).multiplyScalar(40);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -hl - 6;
  sc.right = hl + 6;
  sc.top = hl + 8;
  sc.bottom = -hl - 8;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  R.add(sun, sun.target);
  arena.keyLight = sun;
  const fill = new THREE.DirectionalLight(0x9fb4ff, 0.5);
  fill.position.set(-20, 15, 10);
  R.add(fill);

  arena.look = {
    background: new THREE.Color(0x7a5aa0),
    fog: new THREE.Fog(0xd08a78, 60, 240),
    grade: { exposure: 1.02, contrast: 1.08, saturation: 1.06, tint: new THREE.Color(1.03, 0.99, 0.96) },
    bloom: 0.8,
    envIntensity: 0.85,
    probe: new THREE.Vector3(0, 3, 0),
  };
  arena.cameraBounds.set(new THREE.Vector3(-fx + 0.4, 0.35, -fz + 0.4), new THREE.Vector3(fx - 0.4, 12, fz - 0.4));
  arena.marks.entrance = new THREE.Vector3(0, 0, fz + 2);
  arena.updaters.push((_dt, t) => {
    const blink = city.children.find((c) => c.userData.blink) as THREE.InstancedMesh | undefined;
    if (blink) blink.visible = Math.sin(t * 2.2) > 0;
  });
  return arena;
}
