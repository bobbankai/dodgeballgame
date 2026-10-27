import * as THREE from 'three';
import type { Game, Level } from '../game/Game';
import { G } from '../render/Globals';
import { inkMaterial } from '../render/InkMaterial';

/** A movement test bed: steps, a ramp, ledges and a few props. */
export class Playground implements Level {
  readonly name = 'playground';

  async load(game: Game) {
    const s = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, ry = 0, o = {}) => {
      const m = new THREE.Mesh(geo, inkMaterial({ color, ...o }));
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = m.receiveShadow = true;
      s.add(m);
      return m;
    };
    const ground = add(new THREE.CircleGeometry(60, 64), 0x8fb86a, 0, 0, 0, 0, { hatch: 0.4 });
    ground.rotation.x = -Math.PI / 2;
    add(new THREE.BoxGeometry(2.4, 2, 2.4), 0xe8d9b8, 0, 1, -6);
    add(new THREE.ConeGeometry(2.1, 1.6, 4), 0xb2553f, 0, 2.8, -6, Math.PI / 4);
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(1.6, 0.2 + i * 0.2, 0.6), 0xcfc3a8, 5, 0.1 + i * 0.1, -2 - i * 0.6);
    const ramp = add(new THREE.BoxGeometry(2, 0.2, 5), 0xb9a07a, -5, 0.8, -3);
    ramp.rotation.x = 0.32;
    add(new THREE.BoxGeometry(3, 1.6, 3), 0xb9a07a, -5, 0.8, -6.9);
    add(new THREE.BoxGeometry(1.4, 0.6, 1.4), 0xd9c9a0, 3, 0.3, 3);
    add(new THREE.BoxGeometry(1.4, 1.2, 1.4), 0xd9c9a0, 5, 0.6, 4.5);
    add(new THREE.BoxGeometry(1.4, 1.8, 1.4), 0xd9c9a0, 7, 0.9, 6);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * 14, z = Math.sin(a) * 14;
      add(new THREE.CylinderGeometry(0.15, 0.22, 1.6, 8), 0x7a5a3c, x, 0.8, z);
      add(new THREE.IcosahedronGeometry(1.1, 2), 0x5f9a4a, x, 2.3, z);
    }
    game.scene.add(s);
    game.collision.add(s);
    G.uPigment.value.set(0, 0, 0);
    G.uBloomCount.value = 1;
    G.uBlooms.value[0].set(0, 0, 0, 9);
    game.player.teleport(new THREE.Vector3(0, 0, 4), Math.PI);
    game.rig.snap(game.player.position, 0);
  }

  update() {}
}
