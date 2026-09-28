/**
 * Developer tool: renders characters frozen at specific clip times so animation
 * poses can be inspected from screenshots. URL params:
 *   clips=charge@0.22,throw@0.07   (clip@time, or gait@speed:dirDeg:phase)
 *   view=front|side|back|three     camera angle
 *   hair=spiky,... app variants
 *   lookY=1.6&camY=1.7            frame the heads instead of the whole body
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCharacter } from '../character/CharacterBuilder';
import { Animator, defaultAnimInput } from '../character/Animator';
import { defaultAppearance, HairStyle, SKIN_TONES, HAIR_COLORS } from '../character/Appearance';
import { ClipName } from '../character/Clips';

const params = new URLSearchParams(location.search);
const specs = (params.get('clips') ?? 'idle').split(',');
const view = params.get('view') ?? 'three';
const hairs = (params.get('hair') ?? 'short,spiky,ponytail,afro,mohawk,bun,swept,buzz').split(',') as HairStyle[];

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2f38);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xfff1e0, 2.2);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -10;
sun.shadow.camera.right = 10;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -2;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3024, 0.6));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.6 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const n = specs.length;
const spacing = 1.3;
const animators: { anim: Animator; spec: string }[] = [];
specs.forEach((spec, i) => {
  const app = defaultAppearance();
  app.hairStyle = hairs[i % hairs.length];
  app.skin = SKIN_TONES[i % SKIN_TONES.length];
  app.hair = HAIR_COLORS[i % HAIR_COLORS.length];
  app.headband = i % 3 === 1;
  if (params.get('team') === 'red') {
    app.jersey = 0xd8403a;
    app.trim = 0x1b1b22;
  }
  const rig = buildCharacter(app);
  const off = (i - (n - 1) / 2) * spacing;
  if (view === 'side') rig.root.position.z = -off;
  else if (view === 'back') rig.root.position.x = -off;
  else rig.root.position.x = off;
  scene.add(rig.root);
  const anim = new Animator(rig);
  animators.push({ anim, spec });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe0452e, roughness: 0.5 }));
  ball.castShadow = true;
  scene.add(ball);
  (anim as any)._ball = ball;
  (anim as any)._rig = rig;
});

const cam = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
const dist = Math.max(4.5, n * spacing * 1.9) * Number(params.get('zoom') ?? 1);
if (view === 'front') cam.position.set(0, 1.2, dist);
else if (view === 'back') cam.position.set(0, 1.4, -dist);
else if (view === 'side') cam.position.set(dist, 1.2, 0.01);
else if (view === 'top') cam.position.set(0, dist, 0.5);
else cam.position.set(dist * 0.55, 1.6, dist * 0.85);
if (params.get('camY')) cam.position.y = Number(params.get('camY'));
cam.lookAt(0, Number(params.get('lookY') ?? 0.9), 0);

// Pose everything
for (const { anim, spec } of animators) {
  const inp = defaultAnimInput();
  let holding = spec.includes('+ball');
  const s = spec.replace('+ball', '');
  if (s.startsWith('gait')) {
    const [, rest] = s.split('@');
    const [speed, dir, phase] = (rest ?? '0:0:0').split(':').map(Number);
    inp.velX = Math.sin((dir * Math.PI) / 180) * speed;
    inp.velZ = Math.cos((dir * Math.PI) / 180) * speed;
    inp.holding = holding;
    for (let k = 0; k < 60; k++) anim.update(1 / 60, inp);
    anim.phase = phase;
    // one more tiny step to apply the phase without advancing much
    const save = inp.velX, save2 = inp.velZ;
    anim.update(0.0001, inp);
    inp.velX = save;
    inp.velZ = save2;
  } else if (s === 'idle') {
    inp.holding = holding;
    for (let k = 0; k < 60; k++) anim.update(1 / 60, inp);
  } else {
    const [name, tStr] = s.split('@');
    inp.holding = holding;
    for (let k = 0; k < 30; k++) anim.update(1 / 60, inp);
    anim.play(name as ClipName, { fade: 0, hold: true, manual: true, time: Number(tStr ?? 0) });
    anim.update(0.0001, inp);
  }
  const rig = (anim as any)._rig;
  rig.root.updateMatrixWorld(true);
  const ball = (anim as any)._ball as THREE.Mesh;
  if (holding) rig.sockets.handR.getWorldPosition(ball.position);
  else ball.visible = false;
}

renderer.render(scene, cam);
(window as any).__ready = true;
