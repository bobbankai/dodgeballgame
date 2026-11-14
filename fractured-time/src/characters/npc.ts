import * as THREE from 'three/webgpu';
import { instantiateCharacter } from '@/assets/loader';
import { FaceRig } from './face';
import type { Game } from '@/game';

/**
 * A story character standing in the world (Imani in the cafe, later Nyx and Voss): her own model and idle, a living face (blinks,
 * lip-sync to her recorded lines, expressions), and she turns to face Ethan as he moves around her (body first, slowly, like a person).
 */
export class Npc {
  readonly face: FaceRig;
  private mixer: THREE.AnimationMixer;
  private clips: Map<string, THREE.AnimationClip>;
  private current: THREE.AnimationAction | null = null;
  facePlayer = true;

  private constructor(private g: Game, readonly who: string, readonly root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.face = new FaceRig(root);
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = clips;
    this.play('idle');
  }

  /** Cross-fade to a clip from the shared library ('idle', 'run', 'walk', 'guard'...). */
  play(name: string, fade = 0.25): void {
    const c = this.clips.get(name) ?? this.clips.get('idle') ?? [...this.clips.values()][0];
    if (!c) return;
    const a = this.mixer.clipAction(c);
    if (a === this.current) return;
    a.reset().play();
    if (this.current) this.current.crossFadeTo(a, fade, false);
    this.current = a;
  }

  static async spawn(g: Game, model: string, who: string, pos: THREE.Vector3, yaw: number): Promise<Npc> {
    const inst = await instantiateCharacter(`characters/${model}/${model}.glb`);
    inst.root.position.copy(pos);
    inst.root.rotation.y = yaw;
    g.scene.add(inst.root);
    const n = new Npc(g, who, inst.root, inst.clips);
    g.tickers.add((dt) => n.update(dt));
    return n;
  }

  update(dt: number): void {
    this.mixer.update(dt);
    const sp = this.g.sfx.voices.speaking;
    this.face.listen(sp && sp.who === this.who && this.g.sfx.engine.now < sp.until ? sp.analyser : null);
    this.face.update(dt);
    if (this.facePlayer) {
      const p = this.g.player.pos;
      const want = Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z);
      let d = want - this.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 0.35) this.root.rotation.y += Math.sign(d) * Math.min(Math.abs(d) - 0.3, dt * 1.6);
    }
  }

  dispose(): void { this.g.scene.remove(this.root); }
}
