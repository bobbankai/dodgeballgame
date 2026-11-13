import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import { loadLevel, captureProbe, type Marker, type LoadedLevel } from '@/world/level';
import { LightPool } from '@/world/lightpool';
import { timeScale } from '@/core/loop';
import { G } from '@/physics/physics';

/**
 * The chapter runtime: turns baked level sections + their markers into gameplay, and gives chapter scripts a small vocabulary:
 *   await ch.trigger('s3_enter')        the player walks into a trigger volume
 *   await ch.interact('s1_console')     the player uses something (prompt + interact animation)
 *   await ch.fight('s3_fight')          an encounter group spawns and is defeated
 *   ch.door('s1_door').open()           doors: locked / open / cycling (the time-slow puzzle)
 *   ch.objective('...'), ch.checkpoint('cp_s3'), await ch.say([...]) for dialogue
 * Marker data is authored in Blender (blender/environments/ch*_level.py); sizes and points there are Blender axes and converted here.
 */
type Json = Record<string, unknown>;
const parse = (v: unknown): any => (typeof v === 'string' && /^[[{]/.test(v) ? JSON.parse(v) : v);
/** Blender (x, y, z) -> three (x, z, -y) */
const b2t = (v: number[]) => new THREE.Vector3(v[0], v[2] ?? 0, -(v[1] ?? 0));

export class Door {
  open01 = 0;
  target = 0;
  state: 'locked' | 'closed' | 'open' | 'cycling';
  private collider: unknown = null;
  private cycleT = 0;

  constructor(private g: Game, readonly id: string, readonly leaves: { obj: THREE.Object3D; base: THREE.Vector3; slide: THREE.Vector3 }[],
              readonly center: THREE.Vector3, readonly horiz: boolean, readonly width: number, state: string) {
    this.state = (state as Door['state']) || 'closed';
    this.block(true);
  }

  private block(on: boolean) {
    const ph = this.g.physics as any;
    if (on && !this.collider) {
      const half = this.horiz ? { x: this.width / 2, y: 1.5, z: 0.15 } : { x: 0.15, y: 1.5, z: this.width / 2 };
      this.collider = ph.addBox({ x: this.center.x, y: 1.5, z: this.center.z }, half, 0, G.STATIC);
    } else if (!on && this.collider) {
      ph.world.removeCollider(this.collider, false);
      this.collider = null;
    }
  }

  open(): void { this.state = 'open'; this.target = 1; this.g.sfx.play('door_open', { at: this.center }); }
  close(): void { this.state = 'closed'; this.target = 0; }
  lock(): void { this.state = 'locked'; this.target = 0; }

  tick(dt: number): void {
    const wdt = dt * timeScale.world; // doors live in the world's time (time slow slows them)
    if (this.state === 'cycling') {
      // closed 1.6 s, snaps open 0.15 s, open 0.35 s, slams 0.12 s: too fast to pass at normal speed, easy with time slow
      this.cycleT = (this.cycleT + wdt) % 2.22;
      const t = this.cycleT;
      this.open01 = t < 1.6 ? 0 : t < 1.75 ? (t - 1.6) / 0.15 : t < 2.1 ? 1 : 1 - (t - 2.1) / 0.12;
    } else {
      const sp = this.target > this.open01 ? 1.6 : 2.4;
      this.open01 += Math.sign(this.target - this.open01) * Math.min(Math.abs(this.target - this.open01), wdt * sp);
    }
    for (const l of this.leaves) l.obj.position.copy(l.base).addScaledVector(l.slide, this.open01);
    this.block(this.open01 < 0.72);
  }
}

export class ChapterRuntime {
  markers: Marker[] = [];
  doors = new Map<string, Door>();
  private fired = new Set<string>();
  private waiters = new Map<string, (() => void)[]>();
  private interactables = new Map<string, { m: Marker; resolve?: () => void; used: boolean }>();
  private anomalies: { pos: THREE.Vector3; obj?: THREE.Object3D }[] = [];
  /** streamed sections: only the current one and its neighbours are in the scene / on the GPU */
  sections: { path: string; lv: LoadedLevel; box: THREE.Box3; inScene: boolean; probe: THREE.Texture | null }[] = [];
  current = -1;
  readonly pool: LightPool;

  constructor(readonly g: Game) {
    this.pool = new LightPool(g.scene);
  }

  byId(id: string): Marker | undefined { return this.markers.find((m) => m.data.id === id); }

  async loadSection(path: string): Promise<void> {
    const lv = await loadLevel(path, this.g.physics, null);
    lv.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(lv.root).expandByScalar(0.5);
    this.sections.push({ path, lv, box, inScene: false, probe: null });
    this.pool.add(lv.lightDefs);
    const ms = lv.markers;
    this.markers.push(...ms);
    // doors: leaves are dynamic objects named <door>_leaf±1 with their slide vectors
    for (const m of ms.filter((x) => x.name === 'door')) {
      const id = String(m.data.id);
      const leaves = lv.dynamic.filter((o) => o.userData?.door === id).map((o) => {
        const s = parse(o.userData.slide) as number[];
        return { obj: o, base: o.position.clone(), slide: new THREE.Vector3(s[0], 0, -s[2]) };
      });
      this.doors.set(id, new Door(this.g, id, leaves, m.pos.clone(), !!m.data.horiz, Number(m.data.width ?? 2.4), String(m.data.state ?? 'closed')));
    }
    for (const m of ms.filter((x) => x.name === 'trigger')) {
      const id = String(m.data.id);
      const size = parse(m.data.size) as number[];
      const half = { x: Math.abs(size[0]) / 2, y: Math.abs(size[2]) / 2, z: Math.abs(size[1]) / 2 };
      this.g.physics.addSensor({ x: m.pos.x, y: m.pos.y, z: m.pos.z }, half, id, () => this.fire(id));
    }
    for (const m of ms.filter((x) => x.name === 'interact')) this.interactables.set(String(m.data.id), { m, used: false });
    for (const m of ms.filter((x) => x.name === 'anomaly')) this.anomalies.push({ pos: m.pos.clone() });
  }

  // --- script vocabulary -----------------------------------------------------------------------------------------------------

  private fire(id: string): void {
    if (this.fired.has(id)) return;
    this.fired.add(id);
    for (const w of this.waiters.get(id) ?? []) w();
    this.waiters.delete(id);
  }

  trigger(id: string): Promise<void> {
    if (this.fired.has(id)) return Promise.resolve();
    return new Promise((r) => this.waiters.set(id, [...(this.waiters.get(id) ?? []), r]));
  }

  interact(id: string): Promise<void> {
    const it = this.interactables.get(id);
    if (!it) return Promise.resolve();
    if (it.used) return Promise.resolve();
    return new Promise((r) => { it.resolve = r; });
  }

  door(id: string): Door {
    const d = this.doors.get(id);
    if (!d) throw new Error(`door ${id} missing`);
    return d;
  }

  objective(text: string): void { this.g.hud.setObjective(text); }

  checkpoint(id: string): void {
    const m = this.byId(id);
    if (m) this.g.setCheckpoint(m.pos, m.yaw);
  }

  /** Spawn an encounter group (marker 'enemies', group = [[type, x, y(blender), yaw]...]); resolves when all are defeated. */
  async fight(id: string): Promise<void> {
    const m = this.byId(id);
    if (!m) return;
    const group = parse(m.data.group) as [string, number, number, number][];
    const spawned = [];
    for (const [def, x, y, yaw] of group) spawned.push(await this.g.spawnEnemy({ def, pos: b2t([x, y, 0.05]), yaw }));
    while (!spawned.every((e) => !e.alive)) await this.g.wait(0.25);
  }

  /** Boss encounter at a 'boss' marker: spawns the boss definition (falls back to the heavy guard while its model is in production). */
  async boss(id: string): Promise<void> {
    const m = this.byId(id);
    if (!m) return;
    let b: { alive: boolean };
    if (id === 'sentinel') {
      const { SentinelBoss } = await import('@/bosses/sentinel');
      const s = await SentinelBoss.create(this.g, m.pos.clone(), m.yaw);
      this.g.enemies.push(s);
      this.g.scene.add(s.root);
      b = s;
    } else {
      b = await this.g.spawnEnemy({ def: 'heavy', pos: m.pos.clone(), yaw: m.yaw });
    }
    while (b.alive) await this.g.wait(0.25);
  }

  /** Dialogue lines [who, text, seconds?]: subtitles in sequence (voiced lines play through the audio system when present). */
  async say(lines: [string, string, number?][]): Promise<void> {
    for (const [who, text, sec] of lines) {
      const t = sec ?? Math.max(2.2, text.length * 0.065);
      this.g.hud.showSubtitle(who, text, t);
      await this.g.wait(t + 0.25);
    }
  }

  // --- per tick ----------------------------------------------------------------------------------------------------------------

  /** Section streaming: keep the section the player is in and its neighbours resident; free the GPU copies of the rest. */
  stream(at: THREE.Vector3): void {
    let k = this.sections.findIndex((s) => s.box.containsPoint(at));
    if (k < 0) {
      let best = Infinity;
      this.sections.forEach((s, i) => { const d = s.box.distanceToPoint(at); if (d < best) { best = d; k = i; } });
    }
    if (k === this.current) return;
    this.current = k;
    this.sections.forEach((s, i) => {
      const want = Math.abs(i - k) <= 1;
      if (want && !s.inScene) { this.g.scene.add(s.lv.root); s.inScene = true; }
      else if (!want && s.inScene) {
        this.g.scene.remove(s.lv.root);
        s.inScene = false;
        s.lv.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
        for (const t of s.lv.lightmaps) t.dispose();
      }
    });
    const cur = this.sections[k];
    if (!cur.probe) cur.probe = captureProbe(this.g.gfx.renderer, this.g.scene, cur.box.getCenter(new THREE.Vector3()).setY(1.6));
    this.g.scene.environment = cur.probe;
  }

  tick(dt: number): void {
    this.stream(this.g.player.pos);
    this.pool.update(this.g.player.pos);
    for (const d of this.doors.values()) d.tick(dt);
    // interaction prompt: nearest unused interactable within reach and roughly in front
    const p = this.g.player;
    let best: { id: string; d: number } | null = null;
    for (const [id, it] of this.interactables) {
      if (it.used || !it.resolve) continue;
      const dx = it.m.pos.x - p.pos.x, dz = it.m.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.8 && (!best || d < best.d)) best = { id, d };
    }
    if (best) {
      const it = this.interactables.get(best.id)!;
      this.g.hud.setPrompt(`[E]  ${String(it.m.data.prompt ?? 'Use')}`);
      if (this.g.input.justPressed('interact') || this.g.forceInteract) {
        this.g.forceInteract = false;
        it.used = true;
        this.g.hud.setPrompt('');
        this.g.player.faceTowards(it.m.pos);
        this.g.player.playAction('interact');
        const r = it.resolve!;
        void this.g.wait(0.9).then(r);
      }
    } else this.g.hud.setPrompt('');
  }
}

export type { Json };
