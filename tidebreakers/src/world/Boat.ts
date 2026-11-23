// A hull riding the sea: bobs and rolls with the CPU mirror of the waves, carries a walkable deck
// platform with it, and keeps whoever stands on the deck standing on it.
import { Vector3 } from '@babylonjs/core';
import type { InstancedMesh } from '@babylonjs/core';
import type { EnvKit, Sea } from './World';
import type { Collision, Platform } from '../game/Collision';
import type { Game } from '../game/Game';

export interface BoatSpec { piece: string; deckY: number; deckHalf: [number, number]; length: number; beam: number; draft?: number }

export const WREN: BoatSpec = { piece: 'wren', deckY: 0.0, deckHalf: [1.6, 5.0], length: 11, beam: 3.6 };
export const ROWBOAT: BoatSpec = { piece: 'rowboat', deckY: -0.1, deckHalf: [0.6, 1.8], length: 4.2, beam: 1.5 };

export class Boat {
  inst: InstancedMesh;
  plat: Platform;
  pos: Vector3;
  yaw: number;
  pitch = 0;
  roll = 0;
  heave = 0;
  bob = 1;
  private y0: number;

  constructor(kit: EnvKit, readonly spec: BoatSpec, readonly sea: Sea | null, readonly col: Collision, pos: Vector3, yaw: number) {
    this.inst = kit.instance(spec.piece)!;
    this.pos = pos.clone();
    this.y0 = pos.y;
    this.yaw = yaw;
    this.plat = { x: pos.x, z: pos.z, hx: spec.deckHalf[0], hz: spec.deckHalf[1], rot: -yaw, top: pos.y + spec.deckY + 0.08, tag: 'boat' };
    col.platforms.push(this.plat);
    this.update(0, 0, null);
  }

  /** Engine yaw for a hull whose length runs along the piece's local X (Blender). */
  private get hullYaw(): number { return this.yaw + Math.PI / 2; }

  update(t: number, _dt: number, game: Game | null): void {
    const L = this.spec.length * 0.4, B = this.spec.beam * 0.4;
    const f = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = new Vector3(f.z, 0, -f.x);
    let hc = 0, hb = 0, hs = 0, hp = 0, hsb = 0;
    if (this.sea) {
      const at = (p: Vector3) => this.sea!.heightAt(p.x, p.z, t);
      hc = at(this.pos);
      hb = at(this.pos.add(f.scale(L)));
      hs = at(this.pos.add(f.scale(-L)));
      hp = at(this.pos.add(r.scale(-B)));
      hsb = at(this.pos.add(r.scale(B)));
    }
    const y = this.y0 + ((hc + hb + hs + hp + hsb) / 5) * this.bob + this.heave;
    this.pitch = Math.atan2(hb - hs, 2 * L) * this.bob;
    this.roll = Math.atan2(hsb - hp, 2 * B) * this.bob;
    this.inst.position.set(this.pos.x, y, this.pos.z);
    // yaw, then roll about the hull's length (local X) and pitch about its beam (local Z)
    this.inst.rotation.set(this.roll, this.hullYaw, -this.pitch);
    const oldTop = this.plat.top;
    this.plat.x = this.pos.x;
    this.plat.z = this.pos.z;
    this.plat.rot = -this.yaw;   // Collision's platform rotation runs the other way
    this.plat.top = y + this.spec.deckY + 0.08;
    // carry the crew with the deck
    if (game) {
      const dy = this.plat.top - oldTop;
      for (const fi of game.fighters) {
        if (!fi.onGround) continue;
        if (Math.abs(fi.pos.y - oldTop) < 0.12 && this.onDeck(fi.pos)) fi.pos.y += dy;
      }
    }
  }

  onDeck(p: Vector3): boolean {
    const c = Math.cos(-this.plat.rot), s = Math.sin(-this.plat.rot);
    const dx = p.x - this.plat.x, dz = p.z - this.plat.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) <= this.plat.hx && Math.abs(lz) <= this.plat.hz;
  }

  /** A point on deck: x across (port -, starboard +), z along (stern -, bow +). */
  deck(x: number, z: number): Vector3 {
    const f = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = new Vector3(f.z, 0, -f.x);
    return this.pos.add(f.scale(z)).add(r.scale(x)).add(new Vector3(0, this.plat.top - this.pos.y, 0));
  }
}
