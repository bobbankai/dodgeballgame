import * as THREE from 'three/webgpu';
const out: Record<string, unknown> = {}; (window as any).__probe = out;
(async () => {
  const qs = new URLSearchParams(location.search);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
  const opts: any = { canvas, antialias: false };
  if (qs.has('pp')) opts.powerPreference = 'high-performance';
  const r = new THREE.WebGPURenderer(opts);
  await r.init();
  (r.backend as any).device?.lost?.then((i: any) => { out.deviceLost = (i.message || '') + ' @' + Math.round(performance.now()); });
  if (qs.has('tm')) { r.toneMapping = THREE.ACESFilmicToneMapping; }
  if (qs.has('sh')) { r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; }
  if (qs.has('pm')) { new THREE.PMREMGenerator(r); }
  if (qs.has('pr')) { r.setPixelRatio(0.67); }
  r.setSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, false);
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x203040);
  const cm = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 50); cm.position.set(2, 1.5, 3); cm.lookAt(0, 0, 0);
  sc.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial({ color: 0xff8844 })), new THREE.DirectionalLight(0xffffff, 3));
  for (let i = 0; i < 3; i++) { r.render(sc, cm); await new Promise((x) => setTimeout(x, 100)); }
  out.rendered = true;
})().catch((e) => { out.error = String(e); });
