import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ghostMaterial } from './ghost';

/**
 * Afterimages: Ethan's silhouette left behind in chronal light when he dodges, rewinds or bends time. A small pool of ghost copies is
 * made once (so spawning one costs no allocation and no shader compile); spawning copies the player's current pose bone by bone into
 * the oldest copy, which then fades out. Hair, eyes and teeth are left out of the copies (they would read as noise in a silhouette).
 */
interface Ghost { root: THREE.Object3D; map: [THREE.Object3D, THREE.Object3D][]; fade: any; life: number; dur: number }

export class Afterimages {
  private pool: Ghost[] = [];
  private next = 0;

  constructor(private scene: THREE.Scene, source: THREE.Object3D, count = 4, tint = 0x5ad8ff) {
    const srcBones = new Map<string, THREE.Object3D>();
    source.traverse((o) => { if ((o as THREE.Bone).isBone) srcBones.set(o.name, o); });
    for (let i = 0; i < count; i++) {
      const root = cloneSkinned(source) as THREE.Object3D;
      const g = ghostMaterial(tint);
      const map: [THREE.Object3D, THREE.Object3D][] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const ft = String((m.material as THREE.Material)?.userData?.ft ?? '');
          if (/hair|"eye"|cornea|teeth/.test(ft) || /hair|eye|teeth|lash|brow/i.test(m.name)) { m.visible = false; return; }
          m.material = g.material;
          m.castShadow = m.receiveShadow = false;
          m.frustumCulled = false;
        }
        if ((o as THREE.Bone).isBone && srcBones.has(o.name)) map.push([srcBones.get(o.name)!, o]);
      });
      g.fade.value = 0;
      root.visible = false;
      root.matrixAutoUpdate = true;
      scene.add(root);
      this.pool.push({ root, map, fade: g.fade, life: 0, dur: 1 });
    }
  }

  /** Leave a copy of the current pose (world transform of `actorRoot`), fading over `dur` seconds from `strength`. */
  spawn(actorRoot: THREE.Object3D, strength = 0.6, dur = 0.45): void {
    const g = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    actorRoot.updateMatrixWorld(true);
    actorRoot.matrixWorld.decompose(g.root.position, g.root.quaternion, g.root.scale);
    for (const [s, d] of g.map) { d.position.copy(s.position); d.quaternion.copy(s.quaternion); d.scale.copy(s.scale); }
    g.root.visible = true;
    g.life = dur;
    g.dur = dur;
    g.fade.value = strength;
    (g as any).strength = strength;
  }

  step(dt: number): void {
    for (const g of this.pool) {
      if (!g.root.visible) continue;
      g.life -= dt;
      const k = Math.max(0, g.life / g.dur);
      g.fade.value = (g as any).strength * k * k;
      if (g.life <= 0) g.root.visible = false;
    }
  }
}
