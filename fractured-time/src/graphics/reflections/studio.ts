import * as THREE from 'three/webgpu';

/**
 * A procedural studio environment for test rooms and the lab: a vertical gradient dome with a ring of emissive panels,
 * pre-filtered into a PMREM cube. Gives metal, glass and skin highlights something with shape to reflect.
 */
export function studioEnvironment(pmrem: THREE.PMREMGenerator, opts: { top: number; bottom: number; panels: number[]; intensity?: number }): THREE.Texture {
  const s = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, vertexColors: true }));
  const pos = dome.geometry.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(opts.top), bot = new THREE.Color(opts.bottom), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.lerpColors(bot, top, THREE.MathUtils.smoothstep(pos.getY(i) / 50, -1, 1));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  dome.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  s.add(dome);
  const k = opts.intensity ?? 1;
  opts.panels.forEach((col, i) => {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(10 + (i % 3) * 4, 3 + (i % 2) * 2),
      new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(col).multiplyScalar(6 * k), side: THREE.DoubleSide }));
    const a = (i / opts.panels.length) * Math.PI * 2;
    panel.position.set(Math.cos(a) * 18, 7 + (i % 3) * 3, Math.sin(a) * 18);
    panel.lookAt(0, 3, 0);
    s.add(panel);
  });
  const rt = pmrem.fromScene(s, 0.02);
  s.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return rt.texture;
}
