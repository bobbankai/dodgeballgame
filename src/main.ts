import * as THREE from 'three';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import { Pipeline } from './render/Pipeline';
import { G, setBoil } from './render/Globals';
import { inkMaterial } from './render/InkMaterial';

// Look-development scene: primitives under the ink-and-wash pipeline.
const app = document.getElementById('app')!;
const pipe = new Pipeline(app);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

const sun = new SunLight(0xfff1dc, 1.0);
sun.position.set(0.55, 0.8, 0.35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.far = 70;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), inkMaterial({ color: 0x8fb86a, hatch: 0.4 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o = {}) => {
  const m = new THREE.Mesh(geo, inkMaterial({ color, ...o }));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return m;
};
add(new THREE.BoxGeometry(2.4, 2, 2.4), 0xe8d9b8, 0, 1, 0);
add(new THREE.ConeGeometry(2.1, 1.6, 4), 0xb2553f, 0, 2.8, 0).rotation.y = Math.PI / 4;
for (let i = 0; i < 7; i++) {
  const a = (i / 7) * Math.PI * 2;
  const x = Math.cos(a) * 7, z = Math.sin(a) * 7;
  add(new THREE.CylinderGeometry(0.15, 0.22, 1.6, 8), 0x7a5a3c, x, 0.8, z);
  add(new THREE.IcosahedronGeometry(1.1, 2), 0x5f9a4a, x, 2.3, z);
}
add(new THREE.SphereGeometry(0.5, 32, 16), 0xf2c24b, 2.5, 0.5, 2.5, { alwaysColor: true });

G.uBloomCount.value = 1;
G.uBlooms.value[0].set(0, 0, 0, 6);

function resize() {
  pipe.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
function frame() {
  timer.update();
  const t = timer.getElapsed();
  setBoil(t);
  const a = t * 0.08 + 0.6;
  camera.position.set(Math.cos(a) * 14, 6.5, Math.sin(a) * 14);
  camera.lookAt(0, 1.2, 0);
  G.uBlooms.value[0].w = 5 + Math.sin(t * 0.5) * 3;
  pipe.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { __ready: boolean }).__ready = true;
