import * as THREE from 'three';
import type { QualityProfile } from '../../config/quality';
import { makeCanvasTexture } from '../../rendering/Textures';
import { Arena } from '../Arena';
import { banner, box, buildBench, buildBoards, courtLines, lightShaft, Scoreboard, woodTextures } from '../ArenaKit';
import { Crowd, standSeats } from '../Crowd';
import { placeProp, tintProp } from '../PropKit';
import { createFloorMaterial } from '../FloorMaterial';

export interface GymStyle {
  id: string;
  name: string;
  location: string;
  tagline: string;
  wallLower: string;
  wallUpper: string;
  stripe: string;
  logo: string;
  logoSub: string;
  homeTint: string;
  awayTint: string;
  crowdDensity: number;
  crowdPalette: number[];
  banners: { title: string; sub: string; bg: string; fg: string }[];
  ads: { text: string; bg: string; fg: string }[];
  homeName: string;
  awayName: string;
  /** late afternoon sun (rec) vs. evening gym lights (school) */
  evening: boolean;
  bleacherRows: number;
  hw: number;
  hl: number;
}

function blockWallTexture(lower: string, upper: string, stripe: string) {
  const W = 512, H = 1024; // 2m x 4m tile... rendered as 2 x 9m wall
  return makeCanvasTexture(W, H, (g) => {
    const bandTop = H * (1 - 1.7 / 9);
    g.fillStyle = upper;
    g.fillRect(0, 0, W, H);
    g.fillStyle = lower;
    g.fillRect(0, bandTop, W, H - bandTop);
    g.fillStyle = stripe;
    g.fillRect(0, bandTop - 18, W, 14);
    // blocks: 0.4 x 0.2 m → W/5 x H/45
    const bw = W / 5, bh = H / 45;
    g.strokeStyle = 'rgba(0,0,0,0.13)';
    g.lineWidth = 2;
    for (let r = 0; r < 45; r++) {
      const off = r % 2 ? bw / 2 : 0;
      g.beginPath();
      g.moveTo(0, r * bh);
      g.lineTo(W, r * bh);
      g.stroke();
      for (let c = -1; c < 6; c++) {
        g.beginPath();
        g.moveTo(c * bw + off, r * bh);
        g.lineTo(c * bw + off, (r + 1) * bh);
        g.stroke();
      }
    }
    const img = g.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 10;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  });
}

export function buildGym(style: GymStyle, q: QualityProfile): Arena {
  const hw = style.hw, hl = style.hl;
  const arena = new Arena({ id: style.id, name: style.name, location: style.location, tagline: style.tagline, court: { halfWidth: hw, halfLength: hl } }, q);
  const R = arena.root;
  const GW = hw + 6.5; // gym half width (walls)
  const GL = hl + 7.5; // gym half length
  const H = 9;

  // ---------------- floor ----------------
  const wood = woodTextures(style.evening ? ['#c89e70', '#bd9166', '#d1aa7e'] : ['#cfab82', '#c49f77', '#d9b88f'], 11);
  const tile = 2;
  for (const t of [wood.map, wood.normal!, wood.rough!]) t.repeat.set((GW * 2) / tile, (GL * 2) / tile);
  const lines = courtLines(hw, hl, {
    line: '#f7f2e8',
    center: '#e0452c',
    homeTint: style.homeTint,
    awayTint: style.awayTint,
    tintAlpha: 0.32,
    logo: style.logo,
    logoSub: style.logoSub,
    logoColor: 'rgba(40,30,25,0.55)',
  });
  const floorMat = createFloorMaterial({ map: wood.map, normalMap: wood.normal, roughnessMap: wood.rough, lines: lines.tex, linesSize: lines.size, tileSize: tile, roughness: 0.55, linesRoughness: 0.4, reflect: 1.1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(GW * 2, GL * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  R.add(floor);

  // ---------------- walls ----------------
  const wallTex = blockWallTexture(style.wallLower, style.wallUpper, style.stripe);
  const makeWall = (len: number) => {
    const t = wallTex.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(len / 2, 1);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
  };
  const wallLong = makeWall(GL * 2);
  const wallEnd = makeWall(GW * 2);
  const addWall = (w: number, mat: THREE.Material, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), mat);
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    R.add(m);
  };
  addWall(GL * 2, wallLong, GW, 0, -Math.PI / 2);
  addWall(GL * 2, wallLong, -GW, 0, Math.PI / 2);
  addWall(GW * 2, wallEnd, 0, -GL, 0);
  addWall(GW * 2, wallEnd, 0, GL, Math.PI);

  // ceiling + trusses + lamps
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(GW * 2, GL * 2), new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  R.add(ceil);
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.5, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: style.evening ? 0xfff0d8 : 0xfff6ea, emissiveIntensity: style.evening ? 5 : 2.2 });
  const lampHousing = new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.4, metalness: 0.7 });
  for (let z = -GL + 3; z <= GL - 3; z += 4) {
    R.add(box(GW * 2, 0.35, 0.18, steel, 0, H - 0.6, z, false));
    R.add(box(GW * 2, 0.08, 0.3, steel, 0, H - 0.9, z, false));
    for (let x = -GW + 3.5; x <= GW - 3.5; x += 4.5) {
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.36, 16, 1, true), lampHousing);
      housing.position.set(x, H - 1.25, z);
      R.add(housing);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.38, 20), lampMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(x, H - 1.44, z);
      R.add(lens);
      R.add(box(0.03, 0.7, 0.03, steel, x, H - 0.75, z, false));
    }
  }

  // ---------------- windows + light shafts ----------------
  const skyTex = makeCanvasTexture(64, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    if (style.evening) {
      gr.addColorStop(0, '#1a2448');
      gr.addColorStop(1, '#3a3160');
    } else {
      gr.addColorStop(0, '#bfe3ff');
      gr.addColorStop(1, '#fff3da');
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  const winMat = new THREE.MeshStandardMaterial({ map: skyTex, emissive: 0xffffff, emissiveMap: skyTex, emissiveIntensity: style.evening ? 0.5 : 2.4, color: 0x000000 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.5, metalness: 0.5 });
  const winY = 6.7, winH = 2.2, winW = 2.6;
  for (const side of [1, -1]) {
    for (let z = -GL + 3.5; z <= GL - 3.5; z += 4) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), winMat);
      w.position.set(side * (GW - 0.02), winY, z);
      w.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      R.add(w);
      // frame + mullions
      R.add(box(0.1, winH + 0.2, 0.12, frameMat, side * (GW - 0.06), winY, z - winW / 2, false));
      R.add(box(0.1, winH + 0.2, 0.12, frameMat, side * (GW - 0.06), winY, z + winW / 2, false));
      R.add(box(0.1, 0.1, winW, frameMat, side * (GW - 0.06), winY + winH / 2, z, false));
      R.add(box(0.1, 0.1, winW, frameMat, side * (GW - 0.06), winY - winH / 2, z, false));
      R.add(box(0.08, winH, 0.06, frameMat, side * (GW - 0.06), winY, z, false));
      R.add(box(0.08, 0.06, winW, frameMat, side * (GW - 0.06), winY, z, false));
      if (!style.evening && side > 0 && q.envDetail > 0.5) {
        const from = new THREE.Vector3(GW - 0.2, winY, z);
        const to = new THREE.Vector3(GW - 7.5, 0, z - 1.8);
        const shaft = lightShaft(from, to, 2.2, 0xffe6bf, 0.07);
        R.add(shaft);
        arena.timeUniforms.push((shaft.material as THREE.ShaderMaterial).uniforms.uTime);
      }
    }
  }

  // ---------------- enclosure + benches ----------------
  const boards = buildBoards(hw, hl, { height: 1.15, padColor: 0x1d2a44, railColor: 0xe0452c, ads: style.ads });
  R.add(boards.group);
  for (const s of [1, -1]) {
    const b = buildBench(4.2);
    b.position.set(-(hw + 1.45), 0, s * 3.9);
    R.add(b);
  }

  // ---------------- bleachers + crowd ----------------
  const rows = style.bleacherRows;
  const bleachMat = new THREE.MeshStandardMaterial({ color: 0xb98c5a, roughness: 0.7 });
  const bleachFrame = new THREE.MeshStandardMaterial({ color: 0x3c424c, roughness: 0.5, metalness: 0.6 });
  const bx0 = hw + 2.4;
  const bLen = GL * 2 - 6;
  for (let r = 0; r < rows; r++) {
    const x = bx0 + r * 0.62;
    const y = 0.38 + r * 0.36;
    R.add(box(0.5, 0.06, bLen, bleachMat, x, y, 0));
    R.add(box(0.06, y, bLen, bleachFrame, x + 0.26, y / 2, 0, false));
    R.add(box(0.36, 0.04, bLen, bleachMat, x - 0.2, y - 0.3, 0, false));
  }
  const seats = standSeats({
    origin: new THREE.Vector3(bx0 + 0.05, 0.42, 0),
    along: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(1, 0, 0),
    rows,
    length: bLen - 1,
    rowDepth: 0.62,
    rowRise: 0.36,
    spacing: 0.62,
    density: style.crowdDensity * q.crowdDensity,
    facingYaw: -Math.PI / 2,
    gaps: [0],
  });
  if (seats.length) {
    arena.crowd = new Crowd(seats, style.crowdPalette);
    R.add(arena.crowd.mesh);
  }

  // ---------------- end walls: hoops, scoreboard, banners, doors ----------------
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.2, metalness: 0.1 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe35b1f, roughness: 0.4, metalness: 0.4 });
  for (const s of [1, -1]) {
    // wall-mounted hoop: origin on the wall at rim height, facing the court
    if (placeProp(R, 'hoop', 0, 4.2, s * GL, s > 0 ? Math.PI : 0)) continue;
    const z = s * (GL - 0.9);
    const bb = box(1.8, 1.05, 0.05, glassMat, 0, 4.6, z, false);
    R.add(bb);
    const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), new THREE.MeshBasicMaterial({ color: 0xe35b1f, wireframe: false }));
    sq.position.set(0, 4.45, z - s * 0.03);
    sq.rotation.y = s > 0 ? Math.PI : 0;
    R.add(sq);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.018, 8, 24), orange);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 4.2, z - s * 0.28);
    R.add(rim);
    R.add(box(0.12, 0.12, 0.9, steel, 0, 4.9, s * (GL - 0.45), false));
  }
  const sb = new Scoreboard(3.4, style.homeName, style.awayName, '#ffd166');
  sb.group.position.set(0, 6.6, -GL + 0.25);
  R.add(sb.group);
  arena.scoreboards.push(sb);
  const sb2 = new Scoreboard(2.4, style.homeName, style.awayName, '#ffd166');
  sb2.group.position.set(-GW + 0.25, 5.6, -4);
  sb2.group.rotation.y = Math.PI / 2;
  R.add(sb2.group);
  arena.scoreboards.push(sb2);

  style.banners.forEach((b, i) => {
    const m = banner(1.3, 2.6, b.bg, b.fg, b.title, b.sub, style.stripe);
    const onLeft = i % 2 === 0;
    m.position.set(onLeft ? -GW + 0.05 : GW - 0.05, 5.9, -GL + 6 + i * 5.5);
    m.rotation.y = onLeft ? Math.PI / 2 : -Math.PI / 2;
    R.add(m);
  });

  // exit doors with glowing signs
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3c4a5c, roughness: 0.5, metalness: 0.3 });
  const exitHousing = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.5 });
  const exitTex = makeCanvasTexture(256, 96, (g, w, h) => {
    g.fillStyle = '#140404';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff3a22';
    g.font = '800 72px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('EXIT', w / 2, h / 2 + 3);
  });
  const exitFace = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: exitTex, emissiveIntensity: 3 });
  for (const s of [1, -1]) {
    // exit doors painted in the school colour
    const door = placeProp(R, 'double_door', 5.5 * s, 0, GL, Math.PI);
    if (door) tintProp(door, { door_paint: new THREE.Color(style.stripe).multiplyScalar(0.85).getHex() });
    else R.add(box(2.2, 2.4, 0.08, doorMat, 5.5 * s, 1.2, GL - 0.04, false));
    R.add(box(0.7, 0.25, 0.06, exitHousing, 5.5 * s, 2.75, GL - 0.06, false));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.2), exitFace);
    face.position.set(5.5 * s, 2.75, GL - 0.092);
    face.rotation.y = Math.PI;
    R.add(face);
  }
  arena.marks.entrance = new THREE.Vector3(5.5, 0, GL - 1.5);
  arena.marks.awayEntrance = new THREE.Vector3(-5.5, 0, -GL + 1.5);

  // props: ball cart, mats, cooler, cones
  if (placeProp(R, 'mat_stack', -GW + 1.3, 0, GL - 3)) {
    placeProp(R, 'cooler', -(hw + 1.45), 0, 7.1, Math.PI / 2);
    placeProp(R, 'ball_cart', -(hw + 1.6), 0, -7.2, 0.12);
    for (let i = 0; i < 5; i++) placeProp(R, 'cone', -GW + 0.6 + (i % 2) * 0.3, 0, -GL + 1.2 + i * 0.35, i * 0.7);
  } else {
    const matBlue = new THREE.MeshStandardMaterial({ color: 0x2a58a8, roughness: 0.75 });
    for (let i = 0; i < 4; i++) R.add(box(2, 0.12, 1.2, matBlue, -GW + 1.3, 0.06 + i * 0.12, GL - 3 + (i % 2) * 0.05));
    const cooler = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 20), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.4 }));
    cooler.position.set(-(hw + 1.45), 0.75, 7.1);
    cooler.castShadow = true;
    R.add(cooler);
    R.add(box(0.5, 0.5, 0.5, bleachFrame, -(hw + 1.45), 0.25, 7.1));
    const cartMetal = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.3, metalness: 0.8 });
    const cart = new THREE.Group();
    cart.add(box(1.0, 0.04, 0.6, cartMetal, 0, 0.35, 0));
    for (const cx of [-0.48, 0.48]) for (const cz of [-0.28, 0.28]) cart.add(box(0.03, 0.9, 0.03, cartMetal, cx, 0.45, cz));
    const cartBall = new THREE.MeshStandardMaterial({ color: 0xd9432c, roughness: 0.55 });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), cartBall);
      s.position.set(-0.3 + (i % 3) * 0.3, 0.5 + Math.floor(i / 3) * 0.2, -0.12 + Math.floor(i / 3) * 0.2);
      s.castShadow = true;
      cart.add(s);
    }
    cart.position.set(-(hw + 1.6), 0, -7.2);
    R.add(cart);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.5 });
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 12), coneMat);
      c.position.set(-GW + 0.6 + (i % 2) * 0.3, 0.15, -GL + 1.2 + i * 0.35);
      c.castShadow = true;
      R.add(c);
    }
  }

  // ---------------- lights ----------------
  const hemi = new THREE.HemisphereLight(style.evening ? 0xe4e8ff : 0xfff4e4, 0x6a4a30, style.evening ? 0.55 : 0.75);
  R.add(hemi);
  const sun = new THREE.DirectionalLight(style.evening ? 0xfff0dc : 0xffead0, style.evening ? 1.6 : 2.7);
  sun.position.set(style.evening ? 3 : 14, 18, style.evening ? 2 : -4);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -hw - 3;
  sc.right = hw + 3;
  sc.top = hl + 4;
  sc.bottom = -hl - 4;
  sc.near = 1;
  sc.far = 50;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  R.add(sun);
  R.add(sun.target);
  arena.keyLight = sun;
  for (const z of [-hl * 0.5, hl * 0.5]) {
    const sp = new THREE.SpotLight(0xfff1dc, style.evening ? 60 : 30, 22, 0.75, 0.6, 1.4);
    sp.position.set(0, H - 1.5, z);
    sp.target.position.set(0, 0, z);
    R.add(sp);
    R.add(sp.target);
  }

  arena.look = {
    background: new THREE.Color(style.evening ? 0x14161c : 0x9aa3ad),
    fog: new THREE.Fog(style.evening ? 0x1a1c22 : 0xcfc2ad, 30, 70),
    grade: style.evening
      ? { exposure: 1.0, contrast: 1.08, saturation: 1.08, tint: new THREE.Color(1.0, 0.98, 0.96) }
      : { exposure: 1.0, contrast: 1.06, saturation: 0.98, tint: new THREE.Color(1.01, 1.0, 0.97) },
    bloom: style.evening ? 0.9 : 0.6,
    envIntensity: 0.9,
    probe: new THREE.Vector3(0, 2.5, 0),
  };
  arena.cameraBounds.set(new THREE.Vector3(-GW + 0.6, 0.35, -GL + 0.6), new THREE.Vector3(GW - 0.6, H - 0.8, GL - 0.6));
  // bleachers block the camera on +X side
  arena.blockers.push(new THREE.Box3(new THREE.Vector3(bx0 - 0.3, 0, -bLen / 2), new THREE.Vector3(GW, 0.4 + rows * 0.36, bLen / 2)));
  arena.hypeHandlers.push((a) => {
    lampMat.emissiveIntensity = (style.evening ? 5 : 2.2) * (1 + a * 0.15);
  });
  return arena;
}
