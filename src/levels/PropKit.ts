import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import propsUrl from '../assets/models/props.glb?url';
import { TUNING } from '../config/tuning';
import { ballTextures } from '../rendering/Textures';

/**
 * Arena props modelled in Blender (tools/blender/build_props.py): bevelled, with occlusion baked
 * into vertex colours. Loaded once at boot; arenas clone them synchronously and fall back to
 * their simple built-in props if the kit is unavailable.
 *
 * Every prop faces +Z with its origin on the floor (the hoop's origin is on the wall at rim height;
 * wall-mounted props have their back on the wall).
 * Geometry and materials here are shared between arenas and flagged `userData.shared` so that
 * Arena.dispose leaves them alone.
 */
export type PropName =
  | 'hoop' | 'ball_cart' | 'cooler' | 'cone' | 'mat_stack' | 'bench' | 'double_door'
  | 'van' | 'streetlight' | 'wheelie_bin' | 'pallet_stack' | 'rollup_door' | 'container';

/** Seat length of the bench as modelled. */
const BENCH_LEN = 2.4;

let kit: Map<string, THREE.Object3D> | null = null;
let loading: Promise<void> | null = null;

function share(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    // untextured: dropping UVs gives every part the same attributes so they batch together
    m.geometry.deleteAttribute('uv');
    m.geometry.userData.shared = true;
    (m.material as THREE.Material).userData.shared = true;
  });
}

/** Starts loading the kit; resolves when it is ready (or failed, in which case arenas fall back). */
export function propKitReady(): Promise<void> {
  loading ??= new GLTFLoader().loadAsync(propsUrl).then(
    (gltf) => {
      const map = new Map<string, THREE.Object3D>();
      for (const root of [...gltf.scene.children]) {
        share(root);
        map.set(root.name, root);
      }
      kit = map;
    },
    (e) => console.warn('[props] prop kit unavailable, using simple props', e),
  );
  return loading;
}

/** A fresh instance of a kit prop, or null if the kit didn't load. */
export function prop(name: PropName): THREE.Object3D | null {
  const src = kit?.get(name);
  if (!src) return null;
  const o = src.clone();
  if (name === 'ball_cart') fillCart(o);
  return o;
}

/** Instance a prop and place it (rotation about Y); null if the kit didn't load. */
export function placeProp(parent: THREE.Object3D, name: PropName, x: number, y: number, z: number, ry = 0) {
  const o = prop(name);
  if (!o) return null;
  o.position.set(x, y, z);
  o.rotation.y = ry;
  parent.add(o);
  return o;
}

// ------------------------------------------------------------------ ball cart
let ballGeo: THREE.SphereGeometry | null = null;
let ballMat: THREE.MeshStandardMaterial | null = null;

/**
 * Match balls in the cart's slots, each turned a different way. They skip the ball's object-space
 * normal map (it would need each ball's own rotation), so they can be batched into one draw.
 */
function fillCart(cart: THREE.Object3D) {
  if (!ballGeo || !ballMat) {
    const tex = ballTextures();
    ballGeo = new THREE.SphereGeometry(TUNING.ball.radius, 24, 16);
    ballMat = new THREE.MeshStandardMaterial({ map: tex.map, aoMap: tex.orm, roughnessMap: tex.orm, roughness: 1, metalness: 0 });
    ballGeo.userData.shared = true;
    ballMat.userData.shared = true;
  }
  const slots: THREE.Object3D[] = [];
  cart.traverse((o) => {
    if (o.name.startsWith('ball_slot')) slots.push(o);
  });
  slots.forEach((slot, i) => {
    const b = new THREE.Mesh(ballGeo!, ballMat!);
    b.rotation.set(i * 1.7, i * 2.3, i * 0.9);
    b.castShadow = true;
    b.receiveShadow = true;
    slot.add(b);
  });
}

// ------------------------------------------------------------------ benches
const stretchCache = new Map<string, THREE.BufferGeometry>();
const tintCache = new Map<string, THREE.Material>();

/** Lengthen a bench part by pushing everything off-centre outward (bevels and legs stay intact). */
function stretched(geo: THREE.BufferGeometry, dx: number) {
  const key = `${geo.uuid}|${dx.toFixed(3)}`;
  let g = stretchCache.get(key);
  if (!g) {
    g = geo.clone();
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setX(i, x + Math.sign(x) * dx);
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData.shared = true;
    stretchCache.set(key, g);
  }
  return g;
}

function tinted(mat: THREE.MeshStandardMaterial, color: number) {
  const key = `${mat.uuid}|${color}`;
  let m = tintCache.get(key);
  if (!m) {
    const c = mat.clone();
    c.color.set(color);
    c.userData.shared = true;
    tintCache.set(key, (m = c));
  }
  return m;
}

/** Recolour named materials of a prop instance, e.g. `{ bin_green: 0x2d5fa0 }` (cached, shared). */
export function tintProp(o: THREE.Object3D, colors: Record<string, number>) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    const col = colors[mat.name];
    if (col !== undefined) m.material = tinted(mat, col);
  });
  return o;
}

/** A slatted bench `length` metres long along Z, facing +X; null if the kit didn't load. */
export function kitBench(length: number, color: number): THREE.Group | null {
  const b = prop('bench');
  if (!b) return null;
  const dx = Math.max(0, (length - BENCH_LEN) / 2);
  if (dx > 0) {
    b.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry = stretched(m.geometry, dx);
    });
  }
  tintProp(b, { bench_wood: color });
  b.rotation.y = Math.PI / 2;
  const g = new THREE.Group();
  g.add(b);
  return g;
}
