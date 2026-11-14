import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createGfx } from '@/rendering/gfx';
import { PostFX } from '@/rendering/postfx';
import { QUALITY, type QualityName } from '@/rendering/quality';
import { dressCharacter, assetUrl, texturesReady } from '@/rendering/charmat';
import { ClipLibrary } from '@/animation/library';

/**
 * Character look-dev lab: the exported character under studio lighting (HDRI + key/fill/rim), matching the Cycles review setup, so the
 * real-time result can be compared side by side with the offline render and with reference B.
 * URL: lab.html?char=ethan&view=face|face34|full|back&quality=high
 */
const out: Record<string, unknown> = {};
(window as any).__probe = out;

async function main() {
  const qs = new URLSearchParams(location.search);
  const q = (qs.get('quality') as QualityName) || 'high';
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
  const gfx = await createGfx(canvas, q);
  out.backend = gfx.backend;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0e10);
  const hdr = await new HDRLoader().loadAsync(assetUrl('hdri/studio_small_09_2k.hdr'));
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = gfx.pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = Number(qs.get('env') || 0.12); // the Cycles review has a dark backdrop, not an HDRI: keep the ambient low
  gfx.renderer.toneMapping = THREE.AgXToneMapping;
  gfx.renderer.toneMappingExposure = 1.0;

  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardNodeMaterial({ color: 0x141518, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // The Cycles review rig (blender/common/studio.py), converted exactly: Blender (x, y, z) -> three (x, z, -y). Area lights give the
  // same broad soft highlights; the key is split between a shadow-casting spot (form shadows) and its area light (soft specular).
  // Intensities keep Blender's per-area brightness ratios (W / m^2), scaled by one exposure constant.
  (THREE as any).RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  const k = Number(qs.get('light') || 0.32);
  const area = (name: string, b: [number, number, number], look: [number, number, number], watts: number, size: number, col: number) => {
    const l = new THREE.RectAreaLight(col, (k * watts) / (size * size), size, size);
    l.name = name;
    l.position.set(b[0], b[2], -b[1]);
    l.lookAt(look[0], look[2], -look[1]);
    scene.add(l);
    return l;
  };
  const keyCol = new THREE.Color(1.0, 0.95, 0.9).getHex();
  area('key', [-1.6, -2.6, 2.4], [0, 0, 1.55], 120 * 0.45, 1.8, keyCol);
  area('fill', [2.4, -2.2, 1.6], [0, 0, 1.4], 26, 3.0, new THREE.Color(0.88, 0.93, 1.0).getHex());
  area('rim', [1.2, 2.4, 2.6], [0, 0, 1.6], 140, 1.0, new THREE.Color(0.92, 0.96, 1.0).getHex());
  area('hair', [-0.6, 1.6, 3.2], [0, 0, 1.7], 90, 0.8, 0xffffff);
  const key = new THREE.SpotLight(keyCol, k * 120 * 0.55 * Number(qs.get('spot') || 0.6), 0, 0.5, 1.0, 2);
  key.position.set(-1.6, 2.4, 2.6);
  key.target.position.set(0, 1.55, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 6;
  key.shadow.camera.near = 0.5;
  scene.add(key, key.target);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const name = qs.get('char') || 'ethan';
  const t0 = performance.now();
  const gltf = await loader.loadAsync(assetUrl(qs.get('path') || `characters/${name}/${name}.glb`)); // ?path= any asset (bosses, props)
  out.loadMs = Math.round(performance.now() - t0);
  const root = gltf.scene;
  out.materials = dressCharacter(root, { hide: (qs.get('hide') || '').split(',').filter(Boolean) });
  await texturesReady();
  if (qs.has('echo')) (await import('@/characters/echo')).echoify(root); // ?echo: the Echo's treatment on this model
  let tris = 0;
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
  out.tris = Math.round(tris);
  if (qs.has('meshes')) {
    root.updateMatrixWorld(true);
    const list: string[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const b = new THREE.Box3().setFromObject(m);
      const mat = m.material as THREE.MeshStandardMaterial;
      list.push(`${m.name}|${mat.name}|vis=${m.visible}|skinned=${(m as any).isSkinnedMesh}|y=${b.min.y.toFixed(3)}..${b.max.y.toFixed(3)}|z=${b.max.z.toFixed(3)}|aT=${mat.alphaTest}|tr=${mat.transparent}|map=${!!mat.map}|morph=${Object.keys(m.morphTargetDictionary || {}).length}`);
    });
    out.meshes = list;
  }
  scene.add(root);
  // ?anim=<clip>&t=<seconds>: pose the character from the shared clip library
  const animName = qs.get('anim');
  if (animName) {
    const lib = await ClipLibrary.load();
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(lib.forCharacter(animName, lib.hipHeight));
    action.play();
    mixer.setTime(Number(qs.get('t') || 0));
    root.updateMatrixWorld(true);
    out.clip = { name: animName, ...lib.meta[animName] };
  }
  const box = new THREE.Box3().setFromObject(root);
  const top = box.max.y;
  out.height = +top.toFixed(3);

  const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.02, 100);
  const view = qs.get('view') || 'face';
  const shot = (tgt: THREE.Vector3, dist: number, yawDeg: number, pitchDeg: number, fov: number) => {
    const y = THREE.MathUtils.degToRad(yawDeg), p = THREE.MathUtils.degToRad(pitchDeg);
    cam.position.set(tgt.x + Math.sin(y) * Math.cos(p) * dist, tgt.y + Math.sin(p) * dist, tgt.z + Math.cos(y) * Math.cos(p) * dist);
    cam.lookAt(tgt);
    cam.fov = fov;
    cam.updateProjectionMatrix();
  };
  // identical framing to blender/common/studio.py review_set (Blender sensor 36 mm, fit to the larger image side), so the real-time
  // render can be laid next to the Cycles one. Same yaw convention (Blender -Y forward == three +Z forward).
  const lensFov = (mm: number) => {
    const fitLarger = 2 * Math.atan(18 / mm);
    const a = innerWidth / innerHeight;
    return THREE.MathUtils.radToDeg(a >= 1 ? 2 * Math.atan(Math.tan(fitLarger / 2) / a) : fitLarger);
  };
  const faceY = top - 0.12;
  if (view === 'face') shot(new THREE.Vector3(0, faceY, 0.02), 0.62, -8, 3, lensFov(85));
  else if (view === 'face34') shot(new THREE.Vector3(0, faceY, 0.02), 0.7, -38, 3, lensFov(85));
  else if (view === 'eyes') {
    const eyeBox = new THREE.Box3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && String((m.material as THREE.Material).userData?.ft ?? '').includes('"eye"')) eyeBox.expandByObject(m);
    });
    const c = eyeBox.getCenter(new THREE.Vector3());
    shot(new THREE.Vector3(c.x + 0.032, c.y, eyeBox.max.z), 0.16, 8, 2, lensFov(85));
  }
  else if (view === 'chest') shot(new THREE.Vector3(0, top * 0.72, 0), 1.0, -20, 4, lensFov(50));
  else if (view === 'neck') shot(new THREE.Vector3(0, top - 0.3, 0.02), 0.55, -25, 6, lensFov(85));
  else if (view === 'hair') shot(new THREE.Vector3(0, top - 0.04, 0.06), 0.3, 25, 22, lensFov(85));
  else if (view === 'side') shot(new THREE.Vector3(0, top * 0.5, 0), top * 1.75, -90, 2, lensFov(50)); // forward = screen right
  else if (view === 'back') shot(new THREE.Vector3(0, top * 0.5, 0), top * 1.75, 180, 2, lensFov(50));
  else if (view === 'front') shot(new THREE.Vector3(0, top * 0.5, 0), top * 1.75, 0, 2, lensFov(50));
  else shot(new THREE.Vector3(0, top * 0.52, 0), top * 1.6, -32, 6, lensFov(50));

  const qq = { ...QUALITY[q], dof: false } as any;
  const post = new PostFX(gfx, scene, cam, qq);
  post.u.vignette.value = 0.18;
  post.u.grain.value = 0.12;
  post.u.contrast.value = Number(qs.get('contrast') || 1.1); // Cycles review uses AgX 'Medium High Contrast'
  out.features = post.describe();
  post.settle(4);
  await new Promise((r) => setTimeout(r, 1200)); // textures finish decoding
  post.settle(Number(qs.get('frames') || 24));
  out.rendered = true;
}
main().catch((e) => { out.error = String((e && (e.stack || e)) || e); console.error(e); });
