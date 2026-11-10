import { Color3, LoadAssetContainerAsync, MeshBuilder, PBRMaterial, Vector3 } from '@babylonjs/core';
import { aimKey, createGfx, Quality, setEnvironment } from './engine/gfx';
import { applyLibrary } from './engine/matlib';
import { surfaceGlobals } from './engine/surface';

const q = new URLSearchParams(location.search);
const test = q.has('test');
const canvas = document.getElementById('game') as HTMLCanvasElement;

async function boot() {
  const g = await createGfx(canvas, (q.get('quality') as Quality) ?? 'high', q.has('gl'));
  const { scene, engine } = g;
  let update: (dt: number) => void = () => {};
  if (q.has('view')) update = await viewer(g, q.get('view')!);
  // WebGPU acquires and submits the swap chain in begin/endFrame: every manual frame needs both
  const frame = () => { engine.beginFrame(); scene.render(); engine.endFrame(); };
  const w = window as any;
  w.__g = g;
  if (test) {
    scene.useConstantAnimationDeltaTime = true;
    w.__advance = async (t: number) => {
      const n = Math.max(1, Math.round(t * 60));
      for (let i = 0; i < n; i++) { update(1 / 60); frame(); }
      await new Promise((r) => requestAnimationFrame(r));
    };
    // shaders and textures arrive asynchronously: draw until everything in view is ready
    w.__settle = async () => {
      for (let i = 0, ok = 0; i < 400 && ok < 3; i++) {
        frame();
        await new Promise((r) => setTimeout(r, 25));
        ok = scene.isReady(true) ? ok + 1 : 0;
      }
      frame();
      await new Promise((r) => requestAnimationFrame(r));
    };
  } else {
    engine.runRenderLoop(() => { update(Math.min(engine.getDeltaTime() / 1000, 0.05)); scene.render(); });
  }
  window.addEventListener('resize', () => engine.resize());
  await scene.whenReadyAsync();
  w.__ready = true;
}

/** Look-dev: ?view=chars/kessa[&clip=name] shows one model under the game's lighting. */
async function viewer(g: Awaited<ReturnType<typeof createGfx>>, name: string) {
  const { scene } = g;
  await setEnvironment(g, 'assets/env/studio.hdr', 0.9);
  aimKey(g, new Vector3(-0.45, -1, -0.6), new Vector3(0, 1, 0), 2.5);
  const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene);
  const gm = new PBRMaterial('ground', scene);
  gm.albedoColor = new Color3(0.18, 0.18, 0.19); gm.roughness = 0.75; gm.metallic = 0;
  ground.material = gm; ground.receiveShadows = true;
  const c = await LoadAssetContainerAsync(`assets/${name}.glb`, scene);
  applyLibrary(c, scene);
  c.addAllToScene();
  for (const m of c.meshes) { g.shadow.addShadowCaster(m); m.receiveShadows = true; m.alwaysSelectAsActiveMesh = true; }
  c.animationGroups.forEach((a) => a.stop());
  const clip = c.animationGroups.find((a) => a.name === q.get('clip'));
  clip?.start(true);
  const w = window as any;
  w.__c = c;
  w.__sg = surfaceGlobals;
  // __cam(yawDeg, pitchDeg, dist, targetY, fov)
  w.__cam = (yaw = 0, pitch = 5, dist = 4, ty = 1, fov = 0.6) => {
    const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
    g.camera.position.set(Math.sin(y) * Math.cos(p) * dist, ty + Math.sin(p) * dist, Math.cos(y) * Math.cos(p) * dist);
    g.camera.setTarget(new Vector3(0, ty, 0));
    g.camera.fov = fov;
  };
  w.__cam();
  // __pose(clip, seconds): freeze one clip at a time (for contact sheets)
  w.__pose = (clip: string, t: number) => {
    c.animationGroups.forEach((a) => a.stop());
    const a = c.animationGroups.find((x) => x.name === clip);
    if (!a) return 'no clip ' + clip;
    a.start(false, 1, a.from, a.to);
    a.goToFrame(a.from + t * 60);
    a.pause();
    return a.to;
  };
  console.log('clips', c.animationGroups.map((a) => a.name).join(' '), 'meshes', c.meshes.length, 'bones', c.skeletons[0]?.bones.length);
  return () => {};
}

boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:0;color:#f88;padding:2em;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`); });
