import * as THREE from 'three/webgpu';
import { createGfx, buildEnvironment } from '@/rendering/gfx';
import { PostFX } from '@/rendering/postfx';
import { surface } from '@/rendering/materials';
import { instantiateCharacter } from '@/assets/loader';
import { CharacterAnimator } from '@/animation/animator';
import { QUALITY, type QualityName } from '@/rendering/quality';

declare global { interface Window { __probe: any } }
const out: Record<string, unknown> = {};
window.__probe = out;

async function main() {
  const qs = new URLSearchParams(location.search);
  const q = (qs.get('quality') as QualityName) || 'high';
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
  const gfx = await createGfx(canvas, q);
  out.backend = gfx.backend;
  (gfx.renderer.backend as any).device?.lost?.then((i: any) => { out.deviceLost = (i.message || '') + ' @' + Math.round(performance.now()); });
  if (qs.has('cube')) {
    const sc = new THREE.Scene(); sc.background = new THREE.Color(0x203040);
    const cm = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 50); cm.position.set(2, 1.5, 3); cm.lookAt(0, 0, 0);
    sc.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial({ color: 0xff8844 })), new THREE.DirectionalLight(0xffffff, 3), new THREE.AmbientLight(0xffffff, 0.4));
    for (let i = 0; i < 3; i++) { gfx.renderer.render(sc, cm); await new Promise((r) => setTimeout(r, 100)); }
    out.rendered = true; return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);
  scene.fog = new THREE.FogExp2(0x0b1016, 0.035);
  scene.environment = buildEnvironment(gfx, { top: 0x1a2430, bottom: 0x05070a, panels: [0x7fd0ff, 0xffb070, 0xffffff, 0x7fd0ff] });
  scene.environmentIntensity = 0.6;

  const simple = qs.has('simple');
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), simple ? new THREE.MeshStandardNodeMaterial({ color: 0x3a4048, roughness: 0.55, metalness: 0.4 }) : surface({ base: 0x3a4048, rough: 0.55, metal: 0.4, panel: 1.0, grime: 0.7 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 0.5), simple ? new THREE.MeshStandardNodeMaterial({ color: 0x56606a, roughness: 0.7 }) : surface({ base: 0x56606a, rough: 0.7, metal: 0.2, panel: 1.2, grime: 0.9, accent: 0x2a8fff }));
  wall.position.set(0, 3, -4); wall.receiveShadow = true; wall.castShadow = true; scene.add(wall);

  const key = new THREE.SpotLight(0xcfe8ff, 110, 30, 0.7, 0.6, 1.6);
  key.position.set(3.5, 5.5, 3.5); key.target.position.set(0, 1, 0); key.castShadow = true;
  key.shadow.mapSize.set(QUALITY[q].shadowMap, QUALITY[q].shadowMap); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.PointLight(0xff9040, 14, 12, 1.6); rim.position.set(-3, 2.2, -2.5); scene.add(rim);
  const cyan = new THREE.PointLight(0x4fd0ff, 8, 10, 1.6); cyan.position.set(2.5, 1.2, -2.5); scene.add(cyan);

  const eth = await instantiateCharacter('characters/ethan.glb');
  scene.add(eth.root);
  const anim = new CharacterAnimator(eth);
  const clip = qs.get('clip') || 'idle_combat';
  anim.play(clip, { fade: 0 });
  out.clips = [...eth.clips.keys()].length;

  const cam = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.05, 200);
  const view = qs.get('view') || 'full';
  if (view === 'face') { cam.position.set(0.5, 1.72, 0.95); cam.lookAt(0, 1.7, 0); cam.fov = 24; }
  else if (view === 'back') { cam.position.set(0.6, 1.9, -3.4); cam.lookAt(0, 1.2, 0); }
  else { cam.position.set(2.2, 1.45, 3.2); cam.lookAt(0, 1.0, 0); }
  cam.updateProjectionMatrix();
  anim.mixer.setTime(Number(qs.get('t') || 0.25));
  eth.root.updateMatrixWorld(true);

  const nofx = qs.has('nofx');
  const qq = { ...QUALITY[q] } as any;
  for (const k of (qs.get('off') || '').split(',').filter(Boolean)) { if (k === 'ao') qq.ao = 'none'; else if (k === 'aa') qq.antialias = 'none'; else qq[k] = false; }
  const post = nofx ? null : new PostFX(gfx, scene, cam, qq);
  out.features = post ? post.describe() : 'direct';
  const draw = () => (post ? post.render() : gfx.renderer.render(scene, cam));
  const t0 = performance.now();
  for (let i = 0; i < 4; i++) { anim.update(1 / 60); draw(); }
  await new Promise((r) => setTimeout(r, 400));
  draw();
  out.renderMs = Math.round(performance.now() - t0);
  out.rendered = true;
}
main().catch((e) => { out.error = String(e && (e.stack || e)); console.error(e); });
