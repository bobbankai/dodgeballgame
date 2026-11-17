import * as THREE from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { GraphicsSystem } from '../core/GraphicsSystem';
import { surface, emissivePanel, PRESETS } from '../materials/library';
import { studioEnvironment } from '../reflections/studio';
import { makeGrade } from '../postprocessing/grade';
import type { DebugView } from '../postprocessing/FrameGraph';

/**
 * Renderer validation scenes (graphics.html?scene=...&view=...&quality=...):
 *   materials  every procedural preset on a sphere and a cube under a studio rig (key area light, fill, rim, environment)
 *   chart      exposure and tone-curve chart: a grey ramp in stops (-8 .. +8 EV around mid grey), saturated patches at
 *              three exposures, and emitters at 1-1000x (does the curve keep hue to white, does bloom stay contained)
 * `view` selects a debug view (luminance, clipping, normals, ...). Sets window.__probe = { rendered, features } for tools/shot.cjs.
 */
const out: Record<string, unknown> = {};
(window as any).__probe = out;

async function main() {
  const qs = new URLSearchParams(location.search);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const gfx = await GraphicsSystem.create(canvas, { preset: qs.get('quality') || 'high', test: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0d10);
  const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 200);
  (THREE as any).RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  const kind = qs.get('scene') || 'materials';
  if (kind === 'materials') {
    scene.environment = studioEnvironment(gfx.pmrem, { top: 0x2a3440, bottom: 0x0a0b0d, panels: [0xfff1dd, 0xcfe2ff, 0xffffff, 0xffe0c0], intensity: 0.6 });
    scene.environmentIntensity = 0.5;
    const names = Object.keys(PRESETS) as (keyof typeof PRESETS)[];
    const cols = 6;
    names.forEach((n, i) => {
      const x = (i % cols - (cols - 1) / 2) * 1.6, z = -Math.floor(i / cols) * 1.8;
      const mat = n === 'lightPanel' ? emissivePanel(0xdfeeff, 3) : surface(PRESETS[n]);
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 64, 32), mat);
      s.position.set(x - 0.3, 0.5, z);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), mat);
      b.position.set(x + 0.42, 0.275, z + 0.3);
      b.rotation.y = 0.6;
      scene.add(s, b);
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), surface({ ...PRESETS.concrete, base: 0x3a3a3c }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const key = new THREE.RectAreaLight(0xfff2e0, 18, 3, 2);
    key.position.set(-4, 5, 4); key.lookAt(0, 0, -1);
    const rim = new THREE.RectAreaLight(0xcfe0ff, 14, 4, 1);
    rim.position.set(3, 4, -6); rim.lookAt(0, 0.5, -1);
    scene.add(key, rim, new THREE.HemisphereLight(0x9fb4c8, 0x1a1612, 0.25));
    cam.position.set(0, 4.2, 6.5);
    cam.lookAt(0, 0.2, -1.6);
  } else {
    // the chart: emissive patches (exact scene-linear values, no lighting) seen at exposure 1
    const patch = (x: number, y: number, w: number, h: number, c: THREE.Color) => {
      const m = new THREE.MeshBasicNodeMaterial({ color: c });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      p.position.set(x, y, 0);
      scene.add(p);
    };
    for (let i = 0; i <= 16; i++) patch(-8 + i, 2.2, 0.95, 1.2, new THREE.Color(1, 1, 1).multiplyScalar(0.18 * 2 ** (i - 8)));
    const hues = [0xff2010, 0xff9a10, 0xf0e020, 0x30e040, 0x20b0ff, 0x4030ff, 0xe030e0];
    hues.forEach((h, j) => [0.25, 2, 16].forEach((k, e) => patch(-6 + j * 2, 0.4 - e * 1.3, 1.6, 1.1, new THREE.Color(h).multiplyScalar(k * 0.18))));
    [1, 10, 100, 1000].forEach((k, j) => patch(-3 + j * 2, -3.6, 0.5, 0.5, new THREE.Color(0.4, 0.8, 1.0).multiplyScalar(k)));
    cam.position.set(0, -0.3, 13);
    cam.lookAt(0, -0.3, 0);
    gfx.exposure.lock(1);
  }
  const g = qs.get('grade');
  gfx.grader.to(makeGrade(g === 'neutral' || !g ? {} : {}));
  gfx.grader.snap();
  gfx.set({ depthOfField: false, filmGrain: false, chromaticAberration: false });
  if (qs.get('view')) gfx.setDebugView(qs.get('view') as DebugView);
  gfx.attach(scene, cam);
  out.features = gfx.describe();
  out.backend = gfx.backend;
  gfx.settle(6);
  await new Promise((r) => setTimeout(r, 800));
  gfx.settle(Number(qs.get('frames') || 16));
  out.rendered = true;
}
main().catch((e) => { out.error = String((e && (e.stack || e)) || e); console.error(e); });
