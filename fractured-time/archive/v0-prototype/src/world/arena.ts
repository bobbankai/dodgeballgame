import * as THREE from 'three/webgpu';
import type { Game, LevelBuild } from '@/game';
import { buildEnvironment } from '@/rendering/gfx';
import { surface, emissive } from '@/rendering/materials';
import { QUALITY } from '@/rendering/quality';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Block {
  pos: [number, number, number];
  size: [number, number, number];
  mat: THREE.Material;
  collide?: boolean;
  rotY?: number;
  cast?: boolean;
}

function block(g: Game, b: Block): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...b.size), b.mat);
  m.position.set(...b.pos);
  m.rotation.y = b.rotY ?? 0;
  m.castShadow = b.cast ?? true;
  m.receiveShadow = true;
  g.scene.add(m);
  if (b.collide !== false) g.physics.addBox({ x: b.pos[0], y: b.pos[1], z: b.pos[2] }, { x: b.size[0] / 2, y: b.size[1] / 2, z: b.size[2] / 2 }, b.rotY ?? 0);
  return m;
}

/**
 * Combat test arena: a research-hall sized room with architecture dressed enough to judge lighting, materials, shadows and camera collision.
 * (The real chapters replace this with Blender-authored kit pieces.)
 */
export async function buildArena(g: Game): Promise<LevelBuild> {
  const { scene, gfx } = g;
  const q = QUALITY[gfx.quality.name];
  scene.background = new THREE.Color(0x070b10);
  scene.fog = new THREE.FogExp2(0x0a1016, 0.018);
  scene.environment = buildEnvironment(gfx, { top: 0x1b2a38, bottom: 0x06090c, panels: [0x7fd0ff, 0xffa060, 0xdfeeff, 0x7fd0ff, 0xffa060] });
  scene.environmentIntensity = 0.32;

  const floor = surface({ base: 0x2c3238, rough: 0.5, metal: 0.55, panel: 1.5, grime: 0.8, scratch: 0.7 });
  const wall = surface({ base: 0x59636d, rough: 0.74, metal: 0.2, panel: 1.8, grime: 0.9, bump: 0.8 });
  const trim = surface({ base: 0x1c2024, rough: 0.45, metal: 0.8, panel: 0.9, grime: 0.6, scratch: 0.8 });
  const beam = surface({ base: 0x353b42, rough: 0.55, metal: 0.65, panel: 2.4, grime: 0.7 });
  const hazard = surface({ base: 0xc7861e, rough: 0.6, metal: 0.3, panel: 0.6, grime: 0.8 });

  const W = 30, H = 10.5;
  // floor + collision
  block(g, { pos: [0, -0.25, 0], size: [W, 0.5, W], mat: floor, cast: false });
  // walls with thick base trim and wainscot band
  for (const s of [-1, 1]) {
    block(g, { pos: [s * (W / 2 + 0.5), H / 2, 0], size: [1, H, W + 2], mat: wall });
    block(g, { pos: [0, H / 2, s * (W / 2 + 0.5)], size: [W + 2, H, 1], mat: wall });
    block(g, { pos: [s * (W / 2 - 0.1), 0.35, 0], size: [0.3, 0.7, W - 1], mat: trim, collide: false });
    block(g, { pos: [0, 0.35, s * (W / 2 - 0.1)], size: [W - 1, 0.7, 0.3], mat: trim, collide: false });
    block(g, { pos: [s * (W / 2 - 0.1), H - 0.6, 0], size: [0.3, 1.2, W - 1], mat: trim, collide: false });
    block(g, { pos: [0, H - 0.6, s * (W / 2 - 0.1)], size: [W - 1, 1.2, 0.3], mat: trim, collide: false });
  }
  // ceiling slab + I-beams
  block(g, { pos: [0, H + 0.5, 0], size: [W + 2, 1, W + 2], mat: wall, collide: false });
  for (let i = -3; i <= 3; i++) {
    block(g, { pos: [i * 4.5, H - 0.9, 0], size: [0.5, 1.4, W], mat: beam, collide: false });
    block(g, { pos: [i * 4.5, H - 1.55, 0], size: [1.3, 0.2, W], mat: beam, collide: false });
  }
  // columns with emissive strips (also camera-collision test)
  for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9], [0, 13], [0, -13]]) {
    block(g, { pos: [x, H / 2, z], size: [1.4, H, 1.4], mat: beam });
    block(g, { pos: [x, 0.5, z], size: [1.9, 1, 1.9], mat: trim });
    block(g, { pos: [x, H / 2, z - 0.72], size: [0.12, H - 1.6, 0.06], mat: emissive(0x6fd8ff, 3.2), collide: false, cast: false });
    block(g, { pos: [x, H / 2, z + 0.72], size: [0.12, H - 1.6, 0.06], mat: emissive(0x6fd8ff, 3.2), collide: false, cast: false });
  }
  // central dais with a chronal ring
  block(g, { pos: [0, 0.12, 0], size: [8, 0.24, 8], mat: trim });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.05, 12, 96), emissive(0x56d6ff, 3.5));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.27; scene.add(ring);
  // cover and props
  block(g, { pos: [-6.5, 0.6, 3], size: [2.4, 1.2, 1.1], mat: hazard, rotY: 0.2 });
  block(g, { pos: [6.2, 0.6, -2], size: [1.8, 1.2, 1.8], mat: hazard, rotY: -0.4 });
  block(g, { pos: [-4, 0.45, -6], size: [3, 0.9, 0.7], mat: trim, rotY: 0.5 });
  block(g, { pos: [11, 1.2, 6], size: [3.2, 2.4, 2.2], mat: beam, rotY: 0.1 });
  block(g, { pos: [11, 2.55, 6], size: [3.0, 0.3, 2.0], mat: emissive(0xff8a2a, 1.6), collide: false, cast: false });
  // wall-mounted light panels and a hazard stripe floor guide
  for (let i = -2; i <= 2; i++) {
    block(g, { pos: [i * 5.5, H - 0.3, -W / 2 + 0.12], size: [2.6, 0.18, 0.1], mat: emissive(0xdfeeff, 2.4), collide: false, cast: false });
    block(g, { pos: [i * 5.5, H - 0.3, W / 2 - 0.12], size: [2.6, 0.18, 0.1], mat: emissive(0xdfeeff, 2.4), collide: false, cast: false });
  }

  // lighting: one shadow-casting key, warm fills with no shadows, cool accent
  const key = new THREE.SpotLight(0xe6efff, 900, 0, 0.95, 0.75, 2);
  key.position.set(0, H - 1, 0); key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.03; key.shadow.radius = 3;
  scene.add(key, key.target);
  const fills: Array<[number, number, number, number, number]> = [
    [-12, 3.5, -12, 0xffb27a, 38], [12, 3.5, -12, 0xffb27a, 38], [-12, 3.5, 12, 0xffb27a, 38], [12, 3.5, 12, 0xffb27a, 38],
    [0, 3, 12, 0x6fd8ff, 30], [0, 3, -12, 0x6fd8ff, 30],
  ];
  for (const [x, y, z, c, i] of fills) {
    const l = new THREE.PointLight(c, i, 0, 2);
    l.position.set(x, y, z);
    scene.add(l);
  }
  const hemi = new THREE.HemisphereLight(0x9bb6d0, 0x1a1410, 0.22);
  scene.add(hemi);

  return {
    spawn: V(0, 0.3, -11), yaw: 0,
    objective: 'Combat arena: defeat the HELIX unit',
    enemies: [
      { def: 'trooper', pos: V(-3, 0.3, 4), yaw: Math.PI },
    ],
  };
}
