// Chapter Two — Ashport. A mining port under orange smog at dusk. Children haul coal for Baron Gorrick
// Vane; Mira Sorrel has been sabotaging his mines alone for three years since he sealed a flooded tunnel
// with her little brother inside. Kai and Mira fight down through the foundry and the mine to the sealed
// tunnel, where Teo's chalk drawings wait for her, and then face Gorrick at the ore furnace.
import { Vector3 } from '@babylonjs/core';
import { Level, V, type LookDef } from './Level';
import { fbm, lerp, smoothstep, pathDist, plateau } from '../world/Noise';
import type { Fighter } from '../game/Fighter';
import { Boat, WREN } from '../world/Boat';

// the quay is along z = -40; the town climbs north to a hill holding the open-cut mine (the pit)
const PIT = { x: 0, z: 120, r: 26 };
const CANYON: [number, number][] = [[0, 56], [0, 70], [4, 84], [2, 96]];

/** The open-cut pit: a floor, and walls cut into benches (flat ledges and steep rock faces) up to the hill. */
const BENCH = 6.2;
const PIT_FLOOR = 1.6;
function pitRaw(top: number, dp: number): number {
  return lerp(PIT_FLOOR, top, Math.min(1, Math.max(0, (dp - (PIT.r - 2)) / 22)));
}
function pitWall(top: number, dp: number, n: number): number {
  const raw = pitRaw(top, dp) - PIT_FLOOR;
  const k = Math.floor(raw / BENCH);
  const f = raw / BENCH - k;
  // each bench: flat for most of its width, then a steep face up to the next
  const stepped = PIT_FLOOR + BENCH * (k + smoothstep(0.66, 0.97, f));
  // blend back into the hill at the rim
  const rim = smoothstep(PIT.r + 17, PIT.r + 20, dp);
  return lerp(stepped, top, rim) + n * 0.3 * (1 - smoothstep(PIT.r - 4, PIT.r, dp));
}
/** Distance from the pit centre to the middle of bench ledge `k` (k = 1 is the first ledge above the floor). */
function benchRadius(k: number, top = 28): number {
  let lo = PIT.r - 2, hi = PIT.r + 20;
  const want = BENCH * (k + 0.33);
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (pitRaw(top, m) - PIT_FLOOR < want) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

function height(x: number, z: number): number {
  const n = fbm(x * 0.04, z * 0.04, 3, 21);
  // town shelf
  let h = lerp(-8, 2.2, smoothstep(-48, -42, z)) + n * 0.15;
  // the hill and its pit
  const hill = plateau(x, z, 0, 112, 36, 62, 26, 1.25, 1.0) + fbm(x * 0.03, z * 0.03, 4, 8) * 3 * smoothstep(40, 70, z);
  h = Math.max(h, 2.2 + hill);
  const dp = Math.hypot(x - PIT.x, z - PIT.z);
  if (dp < PIT.r + 20) h = pitWall(h, dp, n);
  // the canyon cut from the headframe into the pit
  const [dc] = pathDist(x, z, CANYON);
  if (dc < 8) h = lerp(2.0, h, smoothstep(3.0, 7.5, dc));
  // limits of the town
  h = Math.max(h, 2.2 + 14 * smoothstep(48, 70, Math.abs(x)));
  return h;
}

function mask(x: number, z: number, h: number): [number, number, number, number] {
  const street = (Math.abs(x) < 3.2 && z > -40 && z < 46) || (Math.abs(z + 8) < 3 && Math.abs(x) < 40) || (Math.abs(z - 22) < 3 && Math.abs(x) < 34) ? 1 : 0;
  const [dc] = pathDist(x, z, CANYON);
  const pit = Math.hypot(x - PIT.x, z - PIT.z) < PIT.r - 1 ? 0.6 : 0;
  return [Math.max(street, dc < 3 ? 0.8 : 0, pit), 0.2 + 0.2 * fbm(x * 0.1, z * 0.1, 2, 4), h > 5 ? 0.8 : 0.35, 0];
}

export const ASHPORT_LOOK: LookDef = {
  sun: [0.75, 0.22, -0.4], sunIntensity: 0.95, sunColor: [1.0, 0.62, 0.36],
  sky: { zenith: '#4a3a5a', horizon: '#f08a4a', glow: '#ff7a3a', cloudLit: '#ffb27a', cloudShade: '#8a5a62', cover: 0.55, cloudHeight: 0.9, sunSize: 0.004, stars: 0, moon: false },
  skyColor: [0.5, 0.38, 0.42], groundColor: [0.3, 0.19, 0.14], shadowTint: [0.36, 0.26, 0.58, 0.5], rim: [1.0, 0.65, 0.4, 0.8],
  fog: [0.62, 0.38, 0.28, 0.0042], fogParams: [0.04, 0, 30, 0.9],
  sea: { color: [0.06, 0.07, 0.1, 0.5], shallow: [0.22, 0.2, 0.18, 0.6], level: 0, amp: 0.5, chop: 0.8, storm: 0 },
  grade: [0.98, 1.02, 1.16, 0.35], wind: [0.6, 0, 0.2],
  fx: { bloom: 0.45, vignette: 0.4, grain: 0.2, gain: [1.04, 0.97, 0.9], lift: [0.0, 0.0, 0.015] },
};

export class Ashport extends Level {
  readonly id = 'ashport';
  readonly beats = ['arrival', 'streets', 'foundry', 'lift', 'tunnels', 'sealed', 'boss', 'daylight'];
  private wren: Boat | null = null;
  private smoke: Vector3[] = [];
  private vents: Vector3[] = [];

  async build(): Promise<void> {
    this.setLook(ASHPORT_LOOK);
    this.makeTerrain(height, -110, -90, 230, 300, {
      grassLight: '#7a6a4a', grassDark: '#4a3e30', sand: '#5a5048', rock: '#5e5650', dirt: '#6a5a48', sandHeight: 0.6, beach: 0.5, rockSlope: 0.45, path: 1.0,
    }, mask);
    this.makeSea();
    const col = this.game.collision;
    col.wallBelow = -0.9;
    col.minY = -12;
    await this.loadKits('common', 'gulls', 'ashport', 'ships');
    const H = (x: number, z: number) => height(x, z);
    // the quay
    for (let x = -36; x <= 36; x += 12) this.putAt('boardwalk', x, 2.1, -43.5, Math.PI / 2, [1, 1, 1.5], 'none');
    col.addPlatform(0, -43.5, 40, 2.2, 2.2);
    this.wren = new Boat(this.kit, WREN, this.sea, col, V(10, 0.35, -50), Math.PI / 2);
    this.wren.bob = 0.4;
    this.put('crane', -14, -41, 0.2, 1, 'circle');
    this.put('crane', 22, -41, -0.3, 1, 'circle');
    for (const [x, z] of [[-6, -38], [-4, -37], [16, -38], [24, -36]] as const) this.put('crate', x, z, x, 1, 'box');
    this.put('coal', -24, -36, 0.4, 1.4, 'circle');
    this.put('sacks', 4, -37.5, 0.2, 1, 'box');
    // the main street: terraced houses facing it
    const houses = ['rowhouseA', 'rowhouseB', 'rowhouseC'];
    let i = 0;
    for (let z = -32; z <= 40; z += 5.2) {
      if (Math.abs(z + 8) < 4 || Math.abs(z - 22) < 4) continue;
      this.put(houses[i % 3], -7.5, z, Math.PI / 2, 1, 'box');
      this.put(houses[(i + 1) % 3], 7.5, z, -Math.PI / 2, 1, 'box');
      i++;
    }
    for (const [x, z] of [[-4.8, -26], [4.8, -18], [-4.8, -2], [4.8, 10], [-4.8, 30]] as const) { this.put('lamppost', x, z, x > 0 ? Math.PI : 0, 1, 'none'); col.addCircle(x, z, 0.15); this.light(V(x + (x > 0 ? -0.42 : 0.42), H(x, z) + 2.5, z), 6, [1, 0.6, 0.3], 0.8); }
    // cross street: warehouses
    this.put('warehouse', -24, -8, Math.PI / 2, 1, 'box');
    this.put('warehouse2', 24, -10, -Math.PI / 2, 1, 'box');
    this.put('pipes', -14, -3, 0, 1, 'box');
    // the foundry yard
    this.put('foundry', -22, 26, Math.PI / 2, 1, 'box');
    this.put('stack', 22, 30, 0, 1, 'circle');
    this.put('stack_s', 30, 18, 0, 1, 'circle');
    this.put('coal', 12, 18, 0, 1.6, 'circle');
    this.put('coal', 16, 26, 1, 1.2, 'circle');
    this.put('minecart', 8, 30, 0.3, 1, 'box');
    this.put('sacks', -8, 17, 1, 1, 'box');
    this.put('pipes', 14, 33, Math.PI / 2, 1, 'box');
    this.smoke.push(V(22, H(22, 30) + 22.6, 30), V(30, H(30, 18) + 14.6, 18), V(-22 - 3, H(-22, 26) + 21, 26 + 6), V(-22 + 4, H(-22, 26) + 21, 26 - 4.5));
    // the mine: headframe, the gate, the canyon tunnels
    this.put('headframe', 0, 50, 0, 1, 'none');
    for (const [x, z] of [[1.8, 48.4], [-1.8, 48.4], [1.8, 51.6], [-1.8, 51.6]] as const) col.addCircle(x, z, 0.3);
    this.put('irongate', 0, 44, 0, 1, 'none');
    col.addBox(-5.5, 44, 1.2, 0.6);
    col.addBox(5.5, 44, 1.2, 0.6);
    const segs: [number, number, number][] = [[0, 62, 0], [0, 68, 0], [1.5, 76, -0.25], [3.5, 83, -0.1], [3.5, 89, 0.1], [2.5, 95, 0.15]];
    segs.forEach(([x, z, r], k) => this.putAt(k % 2 ? 'tunnel_b' : 'tunnel', x, H(x, z), z, r, 1, 'none'));
    for (const [x, z, r] of segs) this.putAt('rails', x, H(x, z), z, r, 1, 'none');
    // walls of the canyon keep you in the tunnel
    this.put('minecart', -0.5, 66, 0.1, 1, 'box');
    // Teo's chalk trail through the tunnels
    this.chalk('boat', V(1.7, H(1.7, 70.5), 70.5), 0, 0.75);
    this.chalk('sun', V(1.2, H(1.2, 77.2), 77.2), -0.2, 0.8);
    this.chalk('nine', V(-3.5, H(-3.5, 100.5), 100.5), -0.9, 0.9);
    // the pit: the furnace, vents, carts, the sealed tunnel with Teo's drawings
    this.put('furnace', 0, 128, Math.PI, 1, 'circle');
    // a working open-cut mine: rails along the benches with ore carts, lamps on posts, timber chutes, spoil
    // heaps and loose rock on the floor
    const benchAt = (k: number, a: number) => { const r = benchRadius(k, H(PIT.x + Math.cos(a) * 50, PIT.z + Math.sin(a) * 50)); return V(PIT.x + Math.cos(a) * r, 0, PIT.z + Math.sin(a) * r); };
    for (let k = 1; k <= 2; k++) {
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2 + k * 0.17;
        if (Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))) < 0.5) continue;   // the canyon entrance (south)
        const p = benchAt(k, a);
        const y = H(p.x, p.z);
        this.putAt('rails', p.x, y, p.z, -a, [1, 1.0, 1], 'none');
        if ((i + k) % 5 === 0) this.putAt('minecart', p.x, y + 0.05, p.z, -a, 1, 'none');
        if ((i + k) % 4 === 1) {
          const q = benchAt(k, a + 0.09);
          const out = V(Math.cos(a), 0, Math.sin(a)).scale(1.4);
          this.putAt('lamppost', q.x + out.x, H(q.x + out.x, q.z + out.z), q.z + out.z, -a - Math.PI / 2, 1, 'none');
          this.light(V(q.x + out.x * 0.7, H(q.x + out.x, q.z + out.z) + 2.6, q.z + out.z * 0.7), 7, [1, 0.62, 0.3], 1.1);
        }
        if ((i + k * 3) % 7 === 2) this.putAt('coal', p.x, H(p.x, p.z), p.z, a, 0.9 + 0.3 * ((i * 7) % 3), 'none');
      }
    }
    // loose rock and spoil on the floor, kept out of the fighting circle's middle
    const rocks: [number, number, string, number][] = [[-17, 111, 'rock2', 1.3], [16, 114, 'rock3', 0.8], [-12, 137, 'rock1', 1.6], [19, 128, 'rock2', 1.1],
      [-20, 120, 'rock1', 1.2], [8, 141, 'rock3', 0.7], [-6, 101, 'rock1', 1.0], [21, 120, 'rock1', 1.4]];
    for (const [x, z, r, s] of rocks) this.put(r, x, z, x * 0.3, s, 'circle');
    for (const [x, z] of [[-9, 106], [12, 134], [-16, 128]] as const) this.put('coal', x, z, z, 1.4, 'circle');
    // timber chutes down the faces
    for (const a of [0.7, 2.3, 3.9]) {
      const p = benchAt(1, a);
      this.putAt('pipes', p.x, H(p.x, p.z), p.z, -a, [1, 1.3, 1], 'none');
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      const p = V(Math.cos(a) * 12, 0, 120 + Math.sin(a) * 12);
      p.y = H(p.x, p.z);
      this.putAt('vent', p.x, p.y, p.z, a, 1, 'none');
      this.vents.push(p);
    }
    this.put('chalkwall', -22, 112, Math.PI / 2 + 0.35, 1, 'box');
    this.addFire(V(0, H(0, 123), 123), 1.3);
    for (const [x, z, r] of [[14, 104, 0.6], [-14, 132, 2.2], [18, 134, 1.1]] as const) this.put('minecart', x, z, r, 1, 'box');
    for (const [x, z] of [[20, 112], [-18, 124], [10, 140]] as const) this.put('coal', x, z, x, 1.2, 'circle');
    this.light(V(0, H(0, 123) + 3, 123.5), 16, [1, 0.5, 0.2], 2.2);
    for (const [x, z] of [[2, 58], [3, 80], [3, 92]] as const) this.light(V(x + 1.3, H(x, z) + 3, z), 6, [1, 0.75, 0.45], 1.2);
    // the Armada keeps a frigate in the roads
    this.putAt('frigate', -70, 1.6, -120, 0.9, 1, 'none');
  }

  tick(dt: number): void {
    this.wren?.update(this.game.time, dt, this.game);
    const vfx = this.game.vfx;
    for (const s of this.smoke) {
      if (Math.random() < dt * 6) {
        vfx.spawn({ x: s.x + (Math.random() - 0.5), y: s.y, z: s.z + (Math.random() - 0.5), vx: 1.5 + Math.random(), vy: 1.4 + Math.random(), vz: 0.4, size: 2.2, grow: 2.5, life: 7, r: 0.18, g: 0.15, b: 0.15, a: 0.55, drag: 0.1, rot: Math.random() * 6 }, 'smoke');
      }
    }
    // embers drifting through the streets
    if (Math.random() < dt * 8) {
      const c = this.game.cam.cam.position;
      vfx.spawn({ x: c.x + (Math.random() - 0.5) * 30, y: c.y - 2 + Math.random() * 6, z: c.z + (Math.random() - 0.5) * 30, vx: 0.8, vy: 0.4, vz: 0.2, size: 0.06, life: 4, r: 3, g: 1.2, b: 0.3, a: 0.9 }, 'glow');
    }
  }

  // ------------------------------------------------------------------------------------------ story
  /** Mira kneels at one of Teo's drawings with Kai beside her. Shots stay inside the tunnel: a high shot from
   *  beyond the drawing (it in the foreground, their faces behind it), then front close-ups on whoever speaks. */
  private async drawing(mira: Fighter | null, at: Vector3, yaw: number, lines: [string, string, string][]): Promise<void> {
    const d = this.dir, kai = this.kai;
    const f = V(Math.sin(yaw), 0, Math.cos(yaw)), r = V(Math.cos(yaw), 0, -Math.sin(yaw)), up = V(0, 1, 0);
    const mp = at.subtract(f.scale(0.9)).subtract(r.scale(0.85));
    // beside her, wherever the tunnel leaves him room to stand (some drawings are close under the roof's edge)
    const spots = [[1.25, 0.9], [1.3, 0.6], [1.4, 0.3], [1.6, 0.0], [1.1, 1.2], [1.8, 0.6]].map(([b, s]) => at.subtract(f.scale(b)).add(r.scale(s)));
    let kp = spots[0];
    for (const s of spots) {
      const g = s.clone();
      g.y = this.game.collision.groundAt(s.x, s.z, s.y + 1);
      if (this.headroom(g)) { kp = s; break; }
    }
    d.cine(true);
    if (mira) {
      d.place(mira, mp, yaw + 0.35);
      d.act(mira, 'kneel_hold', true);
      d.listen('kai', 'mira');
    }
    d.place(kai, kp, yaw - 0.3);
    d.face(kai, at, true);
    // the drawing seen over their shoulders from behind and above (pulled in past any tunnel timbers)
    const wide = () => d.wide(at.add(up.scale(0.1)), yaw + Math.PI + 0.35, 2.7, 2.2, 0, 0.7);
    const overChalk = (a: Fighter, s: number, dist: number, low = 0.28) => {
      const to = at.subtract(a.pos);
      to.y = 0;
      to.normalize();
      const side = new Vector3(to.z, 0, -to.x).scale(s);
      const h = () => d.headOf(a);
      const t = h().add(up.scale(-0.04));
      // (the tunnel timbers stand near some drawings: the other side, or higher, when one is in the way)
      d.clearShot(t, [
        t.add(to.scale(dist)).add(side.scale(0.45)).add(up.scale(-low)),
        t.add(to.scale(dist)).add(side.scale(-0.45)).add(up.scale(-low)),
        t.add(to.scale(dist * 0.9)).add(side.scale(0.9)).add(up.scale(0.1)),
        t.add(to.scale(dist * 0.9)).add(side.scale(-0.9)).add(up.scale(0.1)),
      ], 0.5, h);
      // the listener keeps looking at the chalk, not at the lens
      a.proc.lookTarget = at.add(up.scale(0.05));
      a.proc.lookWeight = 0.6;
    };
    wide();
    d.focus(2.8, 1.6, 0.5);
    await d.wait(1.4);
    let k = 0;
    for (const [who, text, e] of lines) {
      if (k > 0 && k % 3 === 0) wide();
      // close shots from the drawing's side, below the eyeline: both of them are looking down at it
      else if (who === 'mira' && mira) overChalk(mira, -1, 1.25, 0.46);  // (kneeling, head bowed: from below her fringe)
      else if (who === 'kai') overChalk(kai, 1, 1.5);
      await d.say(who, text, e);
      k++;
    }
    d.focus(0, 1, 0);
    if (mira) { d.release(mira); d.act(mira, 'idle', true); }
    d.cine(false);
  }

  async script(): Promise<void> {
    const d = this.dir, ui = this.ctx.ui, audio = this.ctx.audio, g = this.game, kai = this.kai, pc = this.ctx.pc, flags = this.ctx.flow.flags;
    const H = (x: number, z: number) => height(x, z);
    const P = (x: number, z: number) => V(x, H(x, z), z);
    pc.specialsUnlocked = { burst: true, dash: true, super: !!flags.super };
    audio.ambience('wind');
    let mira: Fighter | null = null;
    const kids: Fighter[] = [];
    const kidLook = (k: number) => ({ look: { face: { eyeStyle: 0, eyeSize: 1.1 }, tint: [[0.9, 0.85, 0.8], [0.75, 0.7, 0.68], [1.0, 0.92, 0.85]][k % 3] as [number, number, number] } });

    // ---------------------------------------------------------------- arrival
    if (this.from('arrival')) {
      this.checkpoint('arrival', P(4, -38), 0);
      kai.place(V(4, 2.2, -42), 0);
      d.cine(true);
      audio.play('mine');
      d.drift(V(-40, 30, -90), V(-30, 22, -70), V(0, 12, 10), 9);
      await d.card('CHAPTER TWO', 'Ashport', 'The town that burns its children for coal.');
      for (let k = 0; k < 3; k++) {
        const kid = await this.npc('teo', `kid${k}`, P(-3 + k * 1.4, -30 - k * 0.8), Math.PI, kidLook(k));
        kid.anims = { ...kid.anims, walk: 'sad_walk', relaxed: 'sad' };
        kids.push(kid);
        void d.walk(kid, P(-2 + k * 1.2, -14 + k), false);
      }
      const thug = await this.npc('thug', 'thug', P(2, -24), Math.PI);
      d.shot(P(6, -34).add(V(0, 1.6, 0)), P(0, -26).add(V(0, 1.1, 0)), 0, 0.6);
      await d.wait(2);
      await d.say('thug', 'Move it, rats! The Baron pays by the sack, not by the sniffle!', 'angry', 'point');
      d.face(kai, P(0, -26));
      d.close(kai, 1);
      await d.say('kai', 'Those are kids. Those are KIDS carrying that.', 'angry');
      // a harpoon pins the thug's sleeve to a post
      g.sfx('blade_heavy');
      g.shake(0.3);
      g.vfx.burst(thug.center, [0.6, 2.4, 1.6], 16, 6, 'star', 0.2, 0.4);
      d.act(thug, 'hit_front');
      // (she steps out from between the houses: clear of their walls, or no camera can see her face)
      mira = await this.npc('mira', 'mira', this.standAt(P(-6, -20)), Math.PI * 0.85);
      d.two(thug, mira, -1, 0, { dist: 4 });
      await d.say('mira', 'He said move it. So move it. Away from them.', 'determined');
      await d.say('thug', 'Sorrel! You crazy... the Baron\'s gonna hang you off a stack!', 'shock');
      d.act(mira, 'thrust');
      await d.wait(0.4);
      d.act(thug, 'knockdown');
      g.sfx('heavy_hit');
      await d.wait(0.8);
      d.release(thug);
      thug.team = 'neutral';
      // she recovers from the lunge (held, the pose left her head a metre forward, inside the house wall)
      d.act(mira, 'idle', true, 0.4);
      void d.walk(thug, P(30, -20), true);
      d.listen('kai', 'mira');
      await d.walk(kai, P(-2, -24), false);
      d.face(kai, mira);
      d.face(mira, kai);
      d.two(kai, mira, 1, 0);
      await d.say('kai', 'That was AMAZING. I\'m Kai. I\'m going to be a pirate. Want to be on my crew?', 'grin');
      d.close(mira, -1);
      await d.say('mira', 'You\'re going to be dead, talking like that in Ashport.', 'smirk');
      await d.say('mira', 'Go home, storm-boy. The Baron owns this town, and the Armada keeps a ship in the roads to make sure it stays owned.', 'calm');
      await d.say('kai', 'Is that a no?', 'smile');
      d.face(mira, P(-2, -14));
      await d.say('mira', '...Look at them. They all look like him.', 'sad');
      await d.say('kai', 'Like who?', 'worried');
      d.close(mira, 1);
      await d.say('mira', 'Nobody. Somebody I was too late for.', 'sad');
      d.act(mira, 'idle', true);
      g.removeFighter(thug);
      void d.walk(mira, P(0, -6), true);
      await d.wait(1.2);
      d.cine(false);
      g.removeFighter(mira);
      mira = null;
      for (const k of kids) g.removeFighter(k);
      kids.length = 0;
    }

    // ---------------------------------------------------------------- the streets
    if (this.from('streets')) {
      this.checkpoint('streets', P(0, -20), 0);
      if (this.starting('streets')) kai.place(P(0, -20), 0);
      await this.reach(P(0, -12), 5, 'Follow the harpoon girl');
      await this.fight({
        center: P(0, -8), radius: 13, objective: 'Fight through the cross street', music: 'battle', after: 'mine',
        waves: [
          [['thug', -6, -4], ['thug', 6, -12], ['thug', -10, -8], ['thug', 10, -6]],
          [['thug', -4, 2], ['thug', 4, 2], ['marine', 0, 4]],
          [['brute', 0, 4], ['thug', -8, -2], ['rifleman', 8, -12], ['thug', 7, 0]],
        ],
      });
    }

    // ---------------------------------------------------------------- the foundry yard: Mira joins
    if (this.from('foundry')) {
      this.checkpoint('foundry', P(0, 8), 0);
      if (this.starting('foundry')) kai.place(P(0, 8), 0);
      await this.reach(P(0, 16), 5, 'Find the foundry');
      mira = await this.addCrew('mira', P(-6, 22), 2.2);
      d.cine(true);
      d.face(kai, mira);
      d.face(mira, kai);
      d.listen('kai', 'mira');
      d.two(kai, mira, 1, 0);
      await d.say('mira', 'You followed me. Through thirty of the Baron\'s men.', 'shock');
      await d.say('kai', 'Twenty-six. I counted. Where are we going?', 'grin');
      await d.say('mira', 'There\'s a tunnel under this town. Number Nine. I\'m going to see what\'s behind the wall they built across it.', 'determined');
      d.close(mira, -1);
      await d.say('mira', '...You can come. If you stop grinning like that.', 'embarrassed');
      d.cine(false);
      ui.showHint('<b>C</b>: call your crew for an assist. Mira hooks an enemy to you.', 7);
      await this.fight({
        center: P(2, 24), radius: 14, objective: 'Break the foundry guard', music: 'battle', after: 'mine',
        waves: [
          [['thug', -6, 30], ['thug', 8, 30], ['rifleman', 12, 18], ['thug', -8, 18]],
          [['brute', 0, 34], ['thug', 10, 26], ['rifleman', -12, 22]],
          [['elite', -6, 32], ['thug', 9, 22], ['thug', -10, 26], ['rifleman', 12, 30]],
        ],
      });
    }

    // ---------------------------------------------------------------- the lift
    if (this.from('lift')) {
      if (!mira) mira = await this.addCrew('mira', P(-2, 36), 0);
      this.checkpoint('lift', P(0, 38), 0);
      if (this.starting('lift')) kai.place(P(0, 38), 0);
      await this.reach(P(0, 42), 4, 'Get into the mine');
      await this.fight({
        center: P(0, 50), radius: 9, objective: 'The overseers hold the headframe', music: 'battle', after: 'mine',
        waves: [[['elite', 0, 56], ['thug', -5, 54], ['thug', 5, 54]], [['brute', 0, 57], ['rifleman', 5, 46]]],
      });
    }

    // ---------------------------------------------------------------- the tunnels
    if (this.from('tunnels')) {
      if (!mira) mira = await this.addCrew('mira', P(-1, 54), 0);
      this.checkpoint('tunnels', P(0, 56), 0);
      if (this.starting('tunnels')) kai.place(P(0, 56), 0);
      audio.ambience('cave');
      void d.say('mira', 'Number Nine is past the old pit. Keep your head down, the ceiling\'s older than I am.', 'calm');
      // Teo's chalk trail: the drawings he left so he could find his way back
      await this.reach(P(1.6, 69), 2.4, 'Follow the chalk marks');
      await this.drawing(mira, P(1.7, 70.5), 0, [
        ['kai', 'Mira, look. Somebody drew on the floor.', 'shock'],
        ['mira', 'Chalk. He always had chalk. He stole it off the foreman\'s tally board, a stub at a time.', 'sad'],
        ['kai', 'That\'s a boat. With two people in it.', 'tender'],
        ['mira', 'Me and him. He was going to buy us a boat with the coal money. Twelve years old and he had it worked out to the penny.', 'tender'],
        ['kai', 'And a really big sun.', 'smile'],
        ['mira', 'Everything he drew had a big sun. You don\'t see it much, down here.', 'sad'],
      ]);
      await this.reach(P(1.2, 76), 2.4, 'Follow the chalk marks');
      await this.drawing(mira, P(1.2, 77.2), -0.2, [
        ['kai', 'Is that... a sun with a moustache?', 'worried'],
        ['mira', 'Ha! That\'s Papa.', 'laugh'],
        ['mira', 'He worked nights at the furnace. Teo thought if he drew him as the sun, he\'d finally get to see some daylight.', 'tender'],
        ['kai', 'Did he? See it?', 'worried'],
        ['mira', 'The furnace took him the winter before the Baron took Teo. After that I stopped drawing suns.', 'cry'],
        ['kai', 'Then I\'ll draw them for you. Badly. Every day, if you want.', 'determined'],
        ['mira', '...You would, too. Idiot.', 'embarrassed'],
      ]);
      await this.reach(P(3, 84), 4, 'Down the tunnels');
      await this.fight({
        center: P(3, 84), radius: 6, objective: 'Clear the tunnel', music: 'battle', after: 'mine',
        waves: [[['thug', 3, 90], ['thug', 3, 78], ['thug', 4, 92]], [['elite', 2, 94], ['thug', 3, 76]]],
      });
      await this.reach(P(-3.2, 99.2), 2.6, 'Follow the chalk marks');
      await this.drawing(mira, P(-3.5, 100.5), -0.9, [
        ['mira', 'An arrow. And nine marks, one for every tunnel.', 'shock'],
        ['mira', 'He counted them so he could always find his way back up to me. He never got lost. Not once.', 'cry'],
        ['kai', 'Then he\'s still showing us the way. Come on. We\'ll go together.', 'determined'],
        ['mira', '...Together.', 'sad'],
      ]);
      await this.reach(P(-14, 108), 6, 'Find Tunnel Nine');
    }

    // ---------------------------------------------------------------- the sealed tunnel
    if (this.from('sealed')) {
      if (!mira) mira = await this.addCrew('mira', P(-12, 106), 0);
      this.checkpoint('sealed', P(-14, 108), 0);
      const wall = P(-22, 112);
      d.cine(true);
      audio.play('sad');
      d.place(mira, wall.add(V(2.5, 0, -2.8)), 0);
      d.place(kai, wall.add(V(4.5, 0, -2.6)), -0.6);
      d.face(mira, wall);
      d.face(kai, wall);
      d.listen('kai', 'mira');
      d.drift(wall.add(V(9, 3, -7)), wall.add(V(7, 2.2, -5)), wall.add(V(0, 1.4, 0)), 8);
      await d.wait(2);
      await d.say('mira', 'This is where they sealed it. The Baron said the water came too fast. He said it like he was talking about the weather.', 'sad');
      d.release(mira);
      await d.walk(mira, wall.add(V(1.4, 0, -1.4)), false, 0.25);
      d.face(mira, wall, true);
      d.act(mira, 'kneel_hold', true);
      d.shot(wall.add(V(2.4, 1.6, -2.4)), wall.add(V(-0.3, 1.1, 0)), 0, 0.55);
      await d.say('kai', 'There are drawings. Somebody drew on the rock.', 'worried');
      d.close(mira, 1, 0, { dist: 1.3, height: -0.1 });
      await d.say('mira', '...That\'s me. With the harpoon. He always drew me bigger than I am.', 'cry');
      await d.say('kai', 'What does it say? Under the boats?', 'sad');
      d.shot(wall.add(V(1.0, 1.4, -2.2)), wall.add(V(0.8, 1.2, 0)), 0, 0.45);
      await d.say('mira', '"Mira will come."', 'sob');
      d.act(mira, 'cry', true);
      d.close(mira, -1, 0, { dist: 1.5 });
      await d.say('mira', 'He waited. He sat in the dark and drew pictures and waited for me, and I...', 'sob');
      await d.say('mira', 'Three years I\'ve been blowing up the Baron\'s mines one bolt at a time. And I never once came down here. I was so scared of what I\'d find.', 'sob');
      d.release(kai);
      await d.walk(kai, mira.pos.add(V(1.0, 0, -0.2)), false, 0.25);
      d.face(kai, wall, true);
      d.act(kai, 'kneel_hold', true);
      d.two(kai, mira, 1, 0, { dist: 2.4, height: 0.9 });
      await d.say('kai', 'Then we came. Both of us. Now.', 'tender');
      d.act(mira, 'kneel_hold', true);
      await d.say('mira', '...Both of us.', 'cry');
      await d.wait(1.2);
      await d.say('mira', 'Hold still. He\'d want you in it.', 'tender');
      await d.say('kai', 'Make the hair bigger.', 'smile');
      mira.model.face.set('laugh');
      await d.say('mira', 'Ha... it can\'t GET any bigger, idiot.', 'laugh');
      await d.wait(1);
      // Gorrick's voice through the pit
      g.sfx('slam'); g.shake(0.5);
      audio.play('tension');
      d.wide(P(0, 124).add(V(0, 4, 0)), Math.PI + 0.5, 22, 7, 0, 0.6);
      await d.say('gorrick', 'SORREL! Come for the little rat at last, have you? You\'re three years late, girl!', 'laugh');
      d.close(mira, 1);
      mira.model.face.set('angry');
      await d.say('mira', 'Gorrick.', 'angry');
      d.cine(false);
      d.release(mira);
      d.release(kai);
    }

    // ---------------------------------------------------------------- Baron Gorrick
    if (this.from('boss')) {
      if (!mira) mira = await this.addCrew('mira', P(-8, 112), 0);
      this.checkpoint('boss', P(-6, 110), 0.6);
      kai.place(P(-6, 110), 0.6);
      const { f: gor, brain } = await this.addBoss('gorrick', P(0, 120), Math.PI, 640);
      brain.active = false;
      d.cine(true);
      d.face(gor, kai, true);
      d.listen('kai', 'mira', 'gorrick');
      d.two(kai, gor, -1, 0, { dist: 7 });
      await d.say('gorrick', 'Do you know what a flooded seam costs, girl? Six months of ore. I sealed one tunnel and saved the whole town\'s winter.', 'smirk', 'talk');
      d.close(kai, 1);
      await d.say('kai', 'You sealed a kid in the dark and called it arithmetic.', 'angry');
      await d.say('gorrick', 'I call it business. Smash them both. Shovel what\'s left into the furnace.', 'laugh', 'taunt');
      d.cine(false);
      gor.floorHp = Math.round(gor.maxHp * 0.5);
      const half = new Promise<void>((res) => { gor.onFloor = res; });
      g.collision.arena = { x: 0, z: 120, r: 19 };
      g.combatActive = true;
      brain.active = true;
      audio.play('boss');
      ui.setObjective('Defeat Baron Gorrick');
      ui.showHint('Gorrick erupts the furnace vents: watch for red circles and keep moving.', 7);
      await half;
      gor.floorHp = 0;
      gor.onFloor = undefined;
      // phase two: the iron arm
      g.combatActive = false;
      brain.active = false;
      d.cine(true);
      d.act(gor, 'taunt');
      g.vfx.impact(gor.center, 2.2, [3, 1.2, 0.4]);
      g.sfx('roar');
      d.close(gor, -1);
      await d.say('gorrick', 'You think a harpoon frightens me? I put my own arm in that furnace to keep this mine open!', 'shout');
      d.close(mira, 1);
      await d.say('mira', 'Then you know how it feels. Kai, his arm! Break it!', 'determined');
      d.cine(false);
      brain.setPhase(2);
      g.combatActive = true;
      brain.active = true;
      this.addFire(this.vents[1], 0.8);
      this.addFire(this.vents[4], 0.8);
      await d.until(() => !gor.alive);
      g.combatActive = false;
      g.collision.arena = null;
      ui.setObjective(null);
      g.slow(0.25, 1.4);
      this.boss = null;
      await d.wait(2.2);
    }

    // ---------------------------------------------------------------- daylight
    if (this.from('daylight')) {
      if (!mira) mira = await this.addCrew('mira', P(-3, 112), 0);
      this.checkpoint('daylight', P(0, 112), 0);
      audio.play('triumph');
      d.cine(true);
      // the smog breaks
      this.r.globals.setSunDir(new Vector3(0.55, 0.45, -0.5), 1.25);
      this.r.globals.set('fogColor', 0.95, 0.75, 0.55, 0.004);
      this.r.globals.set('sunColor', 1.0, 0.82, 0.6, 0.05);
      const gor = await this.npc('gorrick', 'gorrick', P(2, 116), Math.PI);
      d.act(gor, 'sit', true);
      d.place(kai, P(-1.5, 112.5), 0.3);
      d.place(mira, P(0.8, 113.4), 0.5);
      d.face(mira, gor, true);
      d.listen('kai', 'mira', 'gorrick');
      mira.model.props.forEach((p) => p.setEnabled(true));
      d.two(mira, gor, 1, 0, { dist: 3.4 });
      await d.say('gorrick', 'Go on, then. Do it. You\'ve wanted to for three years.', 'tired');
      d.close(mira, -1);
      await d.say('mira', 'I have.', 'angry');
      d.act(mira, 'thrust');
      g.sfx('blade_heavy');
      g.shake(0.3);
      await d.wait(0.6);
      d.close(gor, 1, 0, { dist: 1.4 });
      gor.model.face.set('shock');
      await d.wait(0.8);
      d.two(mira, gor, -1, 0, { dist: 3.2 });
      await d.say('mira', 'That was the furnace\'s chain, not your neck. Teo drew me as a hero. I\'m not going to make him a liar.', 'determined');
      await d.say('mira', 'Every child in this mine walks out. Today. And you\'re going to open every sealed tunnel in Ashport with your own iron hand, so their families can bring them home.', 'angry', 'point');
      d.act(gor, 'sit', true);
      await d.say('gorrick', '...All of them?', 'tired');
      await d.say('mira', 'All of them.', 'determined');
      await d.fade(1, 1.2);
      g.removeFighter(gor);
      // the children come out into the light
      const q = P(0, 50);
      d.place(kai, q.add(V(-2.5, 0, -6)), 0);
      d.place(mira, q.add(V(1.0, 0, -6.5)), 0);
      for (let k = 0; k < 5; k++) {
        const kid = await this.npc('teo', `kid${k}`, q.add(V(-2 + k, 0, 1 + (k % 2))), Math.PI, kidLook(k));
        kids.push(kid);
        void d.walk(kid, q.add(V(-6 + k * 2.6, 0, -14)), false);
      }
      d.drift(q.add(V(6, 2, -12)), q.add(V(4, 1.6, -9)), q.add(V(0, 1.3, -2)), 9);
      void d.fade(0, 1.5);
      await d.wait(3);
      await d.say('kai', 'Look at them. Look at all of them.', 'joy');
      d.close(mira, -1);
      await d.say('mira', 'He\'d have been at the front. Telling everyone where to stand.', 'tender');
      d.two(kai, mira, 1, 0);
      await d.say('kai', 'So. My crew. Still a no?', 'grin');
      await d.say('mira', 'I need a ship that goes where the Armada goes. And somebody has to keep you alive.', 'smirk');
      await d.say('mira', '...Yes, idiot. It\'s a yes.', 'smile');
      d.act(kai, 'victory');
      g.sfx('confirm');
      await d.wait(2.4);
      flags.mira = true;
      await d.fade(1, 2);
      d.cine(false);
    }
  }
}
