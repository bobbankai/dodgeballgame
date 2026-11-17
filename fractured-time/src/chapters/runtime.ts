import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import { loadLevel, captureProbe, type Marker, type LoadedLevel } from '@/world/level';
import { LightPool } from '@/world/lightpool';
import { ProbeField, CharacterLight } from '@/world/probes';

/** eye adaptation (`ChapterRuntime.adapt`): the light level that shows at exposure 1, how much of a change the eye takes up, limits */
const ADAPT_REF = 0.3;
const ADAPT_K = 0.4;
const ADAPT_MIN = 0.5;
const ADAPT_MAX = 6;
import { setWeather, weather } from '@/graphics';
import { Sea, SEA_LAYER } from '@/world/sea';
import { plantSection } from '@/world/foliage';
import type { GradeName } from '@/graphics';
import { loadVolume, INTERIOR_FOG, EXTERIOR_FOG, type LightVolume, type FogSettings } from '@/graphics/atmosphere/fog';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Sky } from '@/graphics/atmosphere/sky';
import { DynamicShadows } from '@/graphics/lighting/dynamicShadows';
import { assetUrl } from '@/graphics';
import { timeScale } from '@/core/loop';
import * as TSL from 'three/tsl';
const TSLx = TSL as any;
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
const _sz = new THREE.Vector3();
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
    // doors travel back in time with Ethan (a shutter that slammed when he was seen is open again after a rewind)
    g.temporal.register({ snapshot: () => ({ o: this.open01, t: this.target, s: this.state, c: this.cycleT }),
      restore: (x: any) => { this.open01 = x.o; this.target = x.t; this.state = x.s; this.cycleT = x.c; } } as any);
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
      // closed 1.8 s, snaps open 0.08 s, open 0.1 s, slams 0.06 s: passable only for ~0.14 s at normal speed (crossing the frame takes
      // ~0.13 s at a sprint, so it is a coin toss), ~0.55 s of Ethan's time with time slow (world x0.26)
      const before = this.cycleT;
      this.cycleT = (this.cycleT + wdt) % 2.04;
      const t = this.cycleT;
      if (before < 1.8 && t >= 1.8) this.g.sfx.play('door_open', { at: this.center, volume: 0.6, pitch: 1.6 });
      if (before < 1.98 && t >= 1.98) this.g.sfx.play('door_slam', { at: this.center });
      this.open01 = t < 1.8 ? 0 : t < 1.88 ? (t - 1.8) / 0.08 : t < 1.98 ? 1 : 1 - (t - 1.98) / 0.06;
    } else {
      const sp = this.target > this.open01 ? 1.6 : 2.4;
      this.open01 += Math.sign(this.target - this.open01) * Math.min(Math.abs(this.target - this.open01), wdt * sp);
    }
    for (const l of this.leaves) l.obj.position.copy(l.base).addScaledVector(l.slide, this.open01);
    const closing = this.open01 < 0.72;
    if (closing && !this.collider) this.crush();
    this.block(closing);
  }

  /** The leaves are closing on Ethan: shove him out of the frame (to the side he is nearer) and hurt him; never trap him inside. */
  private crush(): void {
    const p = this.g.player;
    const along = this.horiz ? p.pos.x - this.center.x : p.pos.z - this.center.z;
    const across = this.horiz ? p.pos.z - this.center.z : p.pos.x - this.center.x;
    if (Math.abs(along) > this.width / 2 + 0.3 || Math.abs(across) > 0.55) return;
    const out = Math.sign(across || 1) * 0.75;
    const to = p.pos.clone();
    if (this.horiz) to.z = this.center.z + out; else to.x = this.center.x + out;
    (this.g.physics as any).teleport(p.body, { x: to.x, y: to.y + 0.3, z: to.z });
    p.pos.copy(to);
    const dir = new THREE.Vector3(this.horiz ? 0 : Math.sign(out), 0, this.horiz ? Math.sign(out) : 0);
    p.receiveHit({ attacker: null, damage: 18, stagger: 1.0, heavy: true, guardbreak: true, launch: 0, point: p.pos.clone(), dir, unblockable: true,
      clip: 'heavy1' } as any);
    this.g.camera.addShake(0.5);
  }
}

/**
 * A HELIX laser sweep: a vertical plane of light that slides back and forth across a corridor on world time (time slow slows it).
 * Its phase is rewindable, so pulling Ethan's timeline back pulls the sweep back with him.
 */
export class LaserSweep {
  t: number;
  seenThisPass = false;
  readonly mesh: THREE.Mesh;
  constructor(private g: Game, readonly id: string, readonly center: THREE.Vector3, readonly width: number, readonly height: number,
              readonly sweep: number, readonly period: number, phase: number) {
    this.t = phase;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const T = TSLx;
    const v = T.uv();
    // a bright core line with a soft falloff, faint scan bands moving down the plane
    const core = T.float(1).sub(T.abs(v.x.sub(0.5)).mul(2)).pow(8);
    const bands = T.sin(v.y.mul(60).add(T.time.mul(9))).mul(0.15).add(0.85);
    m.colorNode = T.vec3(1.0, 0.12, 0.06).mul(core.mul(3.0).add(0.12)).mul(bands);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, height), m);
    this.mesh.rotation.y = 0; // the plane spans x (the corridor's width) ... scaled below
    this.mesh.scale.set(width / 0.5, 1, 1);
    g.scene.add(this.mesh);
    g.temporal.register({ snapshot: () => this.t, restore: (s: unknown) => { this.t = s as number; } } as any);
  }

  get z(): number { return this.center.z + Math.sin((this.t / this.period) * Math.PI * 2) * this.sweep; }

  /** Advance on world time; returns true the moment the beam touches Ethan. */
  tick(dt: number): boolean {
    this.t += dt * timeScale.world;
    this.mesh.position.set(this.center.x, this.center.y, this.z);
    const p = this.g.player.pos;
    const hit = Math.abs(p.z - this.z) < 0.22 && Math.abs(p.x - this.center.x) < this.width / 2 && p.y < this.center.y + this.height / 2;
    const fresh = hit && !this.seenThisPass;
    this.seenThisPass = hit;
    return fresh;
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
  sections: { path: string; lv: LoadedLevel; box: THREE.Box3; inScene: boolean;
    /** reflection probes captured from the lit section, one per reality where the two differ (a ruin must not mirror 2101's sky) */
    probes: { a?: THREE.Texture; b?: THREE.Texture };
    /** baked light volumes for the volumetric fog (timeline b has its own where the geometry differs) */
    vol: { a: LightVolume | null; b: LightVolume | null } }[] = [];
  current = -1;
  readonly pool: LightPool;
  /** baked SH light probes of every section; each character carries its own blended probe */
  readonly probes = new ProbeField();
  readonly lasers: LaserSweep[] = [];
  private plates: { m: Marker; door: string; hold: number; until: number; ring: THREE.Mesh }[] = [];
  /** called when a laser sweep sees Ethan (scripts hook the alarm here) */
  onSeen: ((laser: LaserSweep) => void) | null = null;
  private charLights = new WeakMap<THREE.Object3D, CharacterLight>();

  /** open sea, when a section of the chapter has one */
  readonly sea: Sea;

  constructor(readonly g: Game) {
    this.pool = new LightPool(g.scene);
    this.sea = new Sea(g);
    g.beforeRender.add((dt) => this.sea.frame(dt));
    // Timeline Shift: swap every section's timeline-tagged geometry and collision (state 0 = timeline a, 1 = b)
    g.temporal.onShift((state) => this.setTimeline(state === 0 ? 'a' : 'b'));
  }

  timeline: 'a' | 'b' = 'a';
  setTimeline(t: 'a' | 'b'): void {
    this.timeline = t;
    this.pool.timeline = t;
    this.probes.timeline = t;
    for (const s of this.sections) {
      for (const sw of s.lv.lmSwap) (sw.m as any).lightMap = t === 'b' ? sw.b : sw.a;
      for (const ol of s.lv.ownLights) ol.light.intensity = !ol.timeline || ol.timeline === t ? ol.intensity : 0;
      for (const k of ['a', 'b'] as const) {
        const on = k === t;
        for (const m of s.lv.timeline[k].meshes) m.visible = on;
        for (const c of s.lv.timeline[k].colliders) (c as any).setEnabled?.(on);
      }
    }
    this.g.gfx.look.fracture.value = 1; // the shift ripple
    this.applyVolume();
    this.refreshAtmosphere();
    this.useProbe();
  }

  /** The light volume of the current section in the current timeline. */
  private applyVolume(): void {
    const cur = this.sections[this.current];
    if (!cur) return;
    const v = this.timeline === 'b' && cur.vol.b ? cur.vol.b : cur.vol.a;
    this.g.fog.setVolume(v);
    const fu = this.g.fog.u as any;
    // under the storm's closed deck there is no sun to scatter (the bake's HDRI had one low in the west: a bright disc of haze)
    if (this.stormy) fu.sunCol.value.setRGB(0, 0, 0);
    // nor in the Nexus: its sky holds the Engine as a bright blob the bake took for a sun. The Engine's light is already in the
    // level (its fixtures, the volume's light); scattered forward again as a sun it laid a white veil over every view of it
    if (this.nexus) fu.sunCol.value.setRGB(0, 0, 0);
    // outdoors the air above and beyond the volume is lit like the air at its lid (the fog colour alone was darker: every view
    // down a street showed the box's far top edge as a lit dome on the sky)
    // (not in the Nexus: its volume holds the Engine's light, and the void beyond the platforms is a dark starfield; lifted, the
    // whole void glowed white and swallowed the bridge and the arena)
    if (this.outdoors && v && !this.nexus) {
      const fb = fu.fallback.value as THREE.Vector4;
      const base = this.skyFog;
      fb.set(Math.max(base.r, v.top[0]), Math.max(base.g, v.top[1]), Math.max(base.b, v.top[2]), fb.w);
      this.captureFogBase();
      this.sky.haze.value.setRGB(fb.x, fb.y, fb.z); // the sky's horizon meets that air
    }
    this.sea.setPlace(this.current, this.timeline, v?.header.sun ? new THREE.Vector3(...v.header.sun.dir) : null,
      new THREE.Color(fu.fallback.value.x, fu.fallback.value.y, fu.fallback.value.z));
  }

  byId(id: string): Marker | undefined { return this.markers.find((m) => m.data.id === id); }

  async loadSection(path: string): Promise<void> {
    const lv = await loadLevel(path, this.g.physics, null);
    for (const o of lv.dynamic) DynamicShadows.cast(o); // doors and moving props shadow the baked world
    lv.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(lv.root).expandByScalar(0.5);
    const vols = await Promise.all([loadVolume(assetUrl(path.replace(/\.glb$/, '_vol.bin'))),
      lv.timeline.b.meshes.length ? loadVolume(assetUrl(path.replace(/\.glb$/, '_vol_b.bin'))) : Promise.resolve(null)]);
    this.sections.push({ path, lv, box, inScene: false, probes: {}, vol: { a: vols[0], b: vols[1] } });
    await this.probes.load(path.replace(/\.glb$/, '_probes.json'), this.sections.length - 1, box, lv.timeline.b.meshes.length ? 'a' : undefined);
    if (lv.timeline.b.meshes.length) await this.probes.load(path.replace(/\.glb$/, '_probes_b.json'), this.sections.length - 1, box, 'b');
    this.pool.add(lv.lightDefs);
    const ms = lv.markers;
    // foliage: instanced plants (each reality's own group follows Timeline Shift)
    try {
      const r = await fetch(assetUrl(path.replace(/\.glb$/, '_foliage.json')));
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
        const data = (await r.json()) as Record<string, Record<string, number[][]>>;
        for (const [tl, group] of Object.entries(data)) {
          const holder = new THREE.Group();
          holder.name = `foliage_${tl || 'shared'}`;
          lv.root.add(holder);
          await plantSection(holder, group, this.g.fog);
          if (tl === 'a' || tl === 'b') {
            lv.timeline[tl].meshes.push(holder as any);
            holder.visible = tl === this.timeline;
          }
        }
      }
    } catch (e) { console.warn('[foliage]', path, e); }
    // the place's skies (both realities') load with the section, behind the loading screen
    for (const m of ms.filter((x) => x.name === 'sky')) {
      for (const k of ['hdri', 'hdri_b']) {
        // (the storm is procedural: its HDRI only lit the bakes)
        if (m.data[k] && !/approaching_storm/.test(String(m.data[k]))) await this.loadSky(String(m.data[k])).catch((e) => console.warn('[sky]', m.data[k], e));
      }
    }
    const seaM = ms.find((m) => m.name === 'sea');
    if (seaM) {
      this.sea.register(seaM, this.sections.length - 1, ms.filter((m) => m.name === 'searock'));
      // the section's structure shows in the sea's mirror
      lv.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.layers.enable(SEA_LAYER); });
    }
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
    // pressure plates: a door that stays open while Ethan, or one of his echoes, stands on the plate (and `hold` s after)
    for (const m of ms.filter((x) => x.name === 'plate')) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 48), new THREE.MeshBasicNodeMaterial({ color: 0x5ad8ff, transparent: true,
        opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(m.pos).setY(m.pos.y - 0.02);
      lv.root.add(ring);
      this.plates.push({ m, door: String(m.data.door), hold: Number(m.data.hold ?? 2), until: -1, ring });
    }
    for (const m of ms.filter((x) => x.name === 'trigger')) {
      const id = String(m.data.id);
      const size = parse(m.data.size) as number[];
      const half = { x: Math.abs(size[0]) / 2, y: Math.abs(size[2]) / 2, z: Math.abs(size[1]) / 2 };
      this.g.physics.addSensor({ x: m.pos.x, y: m.pos.y, z: m.pos.z }, half, id, () => this.fire(id));
    }
    for (const m of ms.filter((x) => x.name === 'interact')) this.interactables.set(String(m.data.id), { m, used: false });
    for (const m of ms.filter((x) => x.name === 'anomaly')) this.anomalies.push({ pos: m.pos.clone() });
    // a section loads in the current timeline
    for (const k of ['a', 'b'] as const) {
      for (const m of lv.timeline[k].meshes) m.visible = k === this.timeline;
      for (const c of lv.timeline[k].colliders) (c as any).setEnabled?.(k === this.timeline);
    }
    for (const m of ms.filter((x) => x.name === 'laser')) {
      this.lasers.push(new LaserSweep(this.g, String(m.data.id), m.pos.clone(), Number(m.data.width ?? 6), Number(m.data.height ?? 2.8),
        Number(m.data.sweep ?? 4), Number(m.data.period ?? 3), Number(m.data.phase ?? 0)));
    }
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

  /** A trigger that can fire again (falls, hazards): `fn` runs each time Ethan enters it; it re-arms once `fn` has finished. */
  repeat(id: string, fn: () => Promise<void> | void): void {
    const arm = () => { void this.trigger(id).then(async () => { await fn(); this.fired.delete(id); arm(); }); };
    arm();
  }

  /** Make a used interactable usable again (a console that did nothing in this timeline). */
  rearm(id: string): void {
    const it = this.interactables.get(id);
    if (it) it.used = false;
  }

  /** Put Ethan somewhere without touching the checkpoint (a fall back onto the platform). */
  place(pos: THREE.Vector3, yaw?: number): void {
    const p = this.g.player;
    (this.g.physics as any).teleport(p.body, { x: pos.x, y: pos.y + 0.3, z: pos.z });
    p.pos.copy(pos); p.prev.copy(pos);
    (p as any).vel?.set(0, 0, 0);
    if (yaw !== undefined) p.yaw = yaw;
    this.g.gfx.cut();
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

  /** Dev / test: place Ethan at a marker (checkpoint, trigger or boss) and make it the checkpoint, as if he had walked there. */
  jumpTo(id: string): void {
    const m = this.byId(id);
    if (!m) return;
    const pos = m.pos.clone();
    pos.y = Math.max(pos.y, 0) + 0.05;
    if (m.name === 'boss') pos.z += 6;
    this.g.setCheckpoint(pos, m.yaw);
    this.g.respawn();
    this.stream(pos);
  }

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

  /** Spawn the boss at its 'boss' marker (dormant until the script wakes it; falls back to the heavy guard for unbuilt bosses). */
  async spawnBoss(id: string): Promise<{ alive: boolean; wake?: () => void; dormant?: boolean; pos: THREE.Vector3; root: THREE.Object3D }> {
    const m = this.byId(id);
    if (!m) throw new Error(`boss marker ${id} missing`);
    if (id === 'marshal') {
      const { RiftMarshal } = await import('@/bosses/marshal');
      const b = await RiftMarshal.createMarshal(this.g, m.pos.clone(), m.yaw);
      this.g.enemies.push(b);
      this.g.scene.add(b.root);
      return b as any;
    }
    if (id === 'voss') {
      const { VossBoss } = await import('@/bosses/voss');
      const e = await VossBoss.createVoss(this.g, m.pos.clone(), m.yaw);
      e.held = true;
      this.g.enemies.push(e);
      this.g.scene.add(e.root);
      return e as any;
    }
    if (id === 'nyx') {
      const { NyxBoss } = await import('@/bosses/nyx');
      const e = await NyxBoss.createNyx(this.g, m.pos.clone(), m.yaw);
      e.held = true;
      this.g.enemies.push(e);
      this.g.scene.add(e.root);
      return e as any;
    }
    if (id === 'echo') {
      const { EchoBoss } = await import('@/bosses/echo');
      const e = await EchoBoss.createEcho(this.g, m.pos.clone(), m.yaw);
      e.held = true;
      this.g.enemies.push(e);
      this.g.scene.add(e.root);
      return e as any;
    }
    if (id === 'sentinel') {
      const { SentinelBoss } = await import('@/bosses/sentinel');
      const s = await SentinelBoss.create(this.g, m.pos.clone(), m.yaw);
      s.dormant = true;
      this.g.enemies.push(s);
      this.g.scene.add(s.root);
      return s;
    }
    return this.g.spawnEnemy({ def: 'heavy', pos: m.pos.clone(), yaw: m.yaw }) as any;
  }

  /** Resolve once `cond` holds (checked on game time). */
  async until(cond: () => boolean, every = 0.25): Promise<void> {
    while (!cond()) await this.g.wait(every);
  }

  /** Boss encounter with no cinematic: spawn, wake, fight to the end. */
  async boss(id: string): Promise<void> {
    const b = await this.spawnBoss(id);
    b.wake?.();
    await this.until(() => !b.alive);
  }

  /** A camera marker (Blender: location + target) in three space. */
  cameraKey(id: string, fov = 45): { pos: THREE.Vector3; target: THREE.Vector3; fov: number } {
    const m = this.byId(id);
    if (!m) throw new Error(`camera ${id} missing`);
    const t = parse(m.data.target) as number[];
    return { pos: m.pos.clone(), target: b2t(t), fov };
  }

  /** Dialogue lines [who, text, seconds?]: subtitles in sequence (voiced lines play through the audio system when present). */
  async say(lines: [string, string, number?][]): Promise<void> {
    for (const [who, text, sec] of lines) {
      // a recorded line plays now and sets the pace; otherwise the subtitle is timed from its length
      const voiced = this.g.testMode ? await this.g.sfx.voices.duration(who, text) : await this.g.sfx.voices.play(who, text);
      const t = (sec ? Math.max(sec, voiced + 0.25) : voiced ? voiced + 0.35 : Math.max(2.2, text.length * 0.065)) * this.g.dialogueRate;
      this.g.hud.showSubtitle(who, text, t);
      await this.g.wait(t + 0.25 * this.g.dialogueRate);
    }
  }

  // --- per tick ----------------------------------------------------------------------------------------------------------------

  /** Section streaming: keep the section the player is in and its neighbours resident; free the GPU copies of the rest. */
  stream(at: THREE.Vector3): void {
    // the smallest section box holding the point (the skyline's box spans the whole map, the rooms it contains are the real place)
    let k = -1;
    let vol = Infinity;
    this.sections.forEach((s, i) => {
      if (!s.box.containsPoint(at)) return;
      const v = s.box.getSize(_sz).x * _sz.y * _sz.z;
      if (v < vol) { vol = v; k = i; }
    });
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
    this.atmosphere(cur.lv.markers.find((m) => m.name === 'sky'), cur.box);
    this.applyVolume();
    this.useProbe();
  }

  /** The current section's reflection probe in the current reality, captured the first time it is needed. `recapture`: the
   *  place changed after its capture (its image sky finished loading). */
  private useProbe(recapture = false): void {
    const cur = this.sections[this.current];
    if (!cur) return;
    const two = cur.lv.timeline.b.meshes.length > 0 || !!cur.lv.markers.find((m) => m.name === 'sky')?.data.hdri_b;
    const k = two ? this.timeline : 'a';
    if (!cur.probes[k] || recapture) {
      cur.probes[k]?.dispose();
      cur.probes[k] = captureProbe(this.g.gfx.renderer, this.g.scene, cur.box.getCenter(new THREE.Vector3()).setY(1.6));
    }
    this.g.scene.environment = cur.probes[k]!;
  }

  private skies = new Map<string, Promise<THREE.Texture>>();
  private skyReady = new Map<string, THREE.Texture>();
  private sky = new Sky();
  /** the place's own fog colour (the sky marker's), before the light volume lifts it */
  private skyFog = new THREE.Color();
  private airColor = new THREE.Color();
  /** the current place is under the procedural storm */
  private stormy = false;
  /** the sky the current place wants (a load finishing after Ethan has moved on must not overwrite the next place's) */
  private wantSky = '';

  /** An HDRI sky, loaded once per chapter (sections preload theirs, so a place's sky is ready before it is seen). */
  private loadSky(path: string): Promise<THREE.Texture> {
    let p = this.skies.get(path);
    if (!p) {
      p = new HDRLoader().loadAsync(assetUrl(path)).then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        this.skyReady.set(path, t);
        return t;
      });
      this.skies.set(path, p);
    }
    return p;
  }
  private outdoors = false;
  private thunderAt = 6;
  private lightning = 0;
  /** the current place is the Nexus (no storm: reality cracks instead) */
  private nexus = false;
  private flashPulse = 0;
  private skyBase = 1;
  private fogBase = new THREE.Vector4();
  /** eye adaptation target: from the baked light where Ethan stands (see `adapt`) */
  private exposure = 1;
  private adaptIn = 0;
  private readonly adaptSH = Array.from({ length: 9 }, () => new THREE.Vector3());
  private shadowDir = new THREE.Vector3(0, 1, 0);
  private shadowAmount = 0;
  private readonly adaptAt = new THREE.Vector3();

  /** Sky + fog of the section Ethan is in: exteriors carry a 'sky' marker (HDRI, intensity, fog colour + density); interiors get a
   * dark, faint haze that gives long rooms their depth. */
  private atmosphere(skyMarker: Marker | undefined, box: THREE.Box3): void {
    const sc = this.g.scene;
    // a section whose two realities have different skies carries the second set with a _b suffix (Chapter 4's terrace)
    let sky = skyMarker;
    if (sky && this.timeline === 'b' && sky.data.hdri_b) {
      const d = sky.data;
      sky = { ...sky, data: { ...d, hdri: d.hdri_b, intensity: d.intensity_b, fog: d.fog_b, exposure: d.exposure_b, rain: d.rain_b, grade: d.grade_b } };
    }
    this.outdoors = !!sky;
    const vf = this.g.gfx.volumetric;
    this.g.fog.u.on.value = vf ? 1 : 0;
    this.g.rain.intensity = sky && !new URLSearchParams(location.search).has('norain') ? Number(sky.data.rain ?? 1) : 0; // ?norain: test switch
    this.nexus = !!sky?.data.nexus;
    if (sky) setWeather(Number(sky.data.rain ?? 1) > 0 ? 'storm' : 'dry');
    // the place's grade
    const isEngine = /s6\.glb$/.test(this.sections[this.current]?.path ?? '');
    this.g.gfx.grade(sky ? ((sky.data.grade as GradeName | undefined) ?? 'dusk_storm')
      : this.g.chapterNumber === 3 ? (this.timeline === 'b' ? 'arcology_ruin' : 'arcology') : isEngine ? 'engine' : 'facility');
    if (!sky) {
      this.wantSky = '';
      this.stormy = false;
      (sc as any).backgroundNode = null;
      sc.background = new THREE.Color(0x000000);
      // volumetric: dusty air lit by the fixtures (the classic exponential haze when the preset has no volumetrics)
      sc.fog = vf ? null : new THREE.FogExp2(0x0a0d11, 0.016);
      // the engine chamber is a dusty drum: thicker air, so the fixtures and the engine throw visible beams
      // the arcology's ruin is open to the storeys above through its breaches: dusty, still air, so the light falling through
      // stands in the room as shafts (at the facility's clean-room density it reached the floor without lighting the air)
      const ruin = this.g.chapterNumber === 3 && this.timeline === 'b';
      if (vf) this.g.fog.apply({ ...INTERIOR_FOG, baseY: box.min.y + 0.5, ...(isEngine ? { density: 0.0042 } : {}),
        ...(ruin ? { density: 0.011, heightFalloff: 0.02, noise: 0.7 } : {}), ...this.fogOverride() });
      this.captureFogBase();
      this.g.sfx.ambience('amb_facility', this.current === this.sections.findIndex((x) => /s6\.glb$/.test(x.path)) ? 'hall' : 'interior');
      return;
    }
    this.g.sfx.ambience(this.nexus ? 'amb_facility' : 'amb_storm', this.nexus ? 'hall' : undefined);
    const path = String(sky.data.hdri);
    const f = (parse(sky.data.fog) as number[] | undefined) ?? [0.3, 0.34, 0.4, 0.004];
    // the sky is our own background node (`rendering/sky.ts`). Assigning the HDRI as `scene.background` while it was still
    // loading left every sky black: three converts an equirect background to a cube map the first frame it sees it and keeps
    // that cube, here the 1x1 placeholder
    const haze = new THREE.Color(f[0], f[1], f[2]);
    this.skyFog.copy(haze);
    const storm = /approaching_storm/.test(path);
    this.stormy = storm;
    this.wantSky = path;
    sc.background = haze;
    if (storm) {
      // the storm at nightfall is procedural; over the ruined future terrace no one is left to light the city under it
      // (`?nostorm`: the fog colour instead, a test switch)
      (sc as any).backgroundNode = new URLSearchParams(location.search).has('nostorm') ? null
        : this.sky.storm({ haze, glow: sky.data.id === 'future' ? 0.08 : 1 });
    } else {
      const ready = this.skyReady.get(path);
      (sc as any).backgroundNode = ready ? this.sky.image(ready, { haze }) : null;
      if (!ready) {
        void this.loadSky(path).then((t) => {
          if (this.wantSky !== path) return;
          (this.g.scene as any).backgroundNode = this.sky.image(t, { haze });
          this.useProbe(true); // captured against the empty sky while it loaded
        }).catch(() => {});
      }
    }
    const intensity = storm ? 1 : Number(sky.data.intensity ?? 1);
    (sc as any).backgroundIntensity = intensity;
    this.skyBase = intensity;
    sc.fog = vf ? null : new THREE.FogExp2(new THREE.Color(f[0], f[1], f[2]), f[3]);
    if (vf) {
      // outside the light volume the air is lit by the open sky: the marker's fog colour is that in-scatter
      // the Nexus is a void lit by the Engine itself: its light volumes carry bounce now, and at the marker's density the air
      // whited out every view toward the Engine (forward scattering); the void reads thinner so the platform and the ring hold
      const nexusThin = sky.data.nexus ? 0.55 : 1;
      this.g.fog.apply({ ...EXTERIOR_FOG, density: f[3] * 1.1 * nexusThin, baseY: box.min.y + 0.3,
        fallback: new THREE.Vector4(f[0], f[1], f[2], 1), ...this.fogOverride() });
    }
    this.captureFogBase();
  }

  private captureFogBase(): void { this.fogBase.copy(this.g.fog.u.fallback.value as THREE.Vector4); }

  /** After a quality change (volumetric fog on/off). */
  refreshAtmosphere(): void {
    const cur = this.sections[this.current];
    if (cur) { this.atmosphere(cur.lv.markers.find((m) => m.name === 'sky'), cur.box); this.applyVolume(); }
  }

  /** Scripts can thicken or tint the air for a beat (smoke, dust, a storm front); cleared with `fogOverride = {}`. */
  fogTweak: Partial<FogSettings> = {};
  private fogOverride(): Partial<FogSettings> { return this.fogTweak; }

  /** Figures outside the actor lists (NPCs, the Echo in cinematics) lit like everyone else. */
  private litRoots = new Set<THREE.Object3D>();
  lightRoot(root: THREE.Object3D): void { this.litRoots.add(root); }

  /** Characters: their own SH probe from the baked field (at chest height) + the real-time pool. */
  private lightCharacters(dt: number): void {
    if (!this.probes.size) return;
    const shared = [...this.pool.rects, ...this.pool.points];
    const at = new THREE.Vector3();
    for (const r of this.litRoots) if (!r.parent) this.litRoots.delete(r);
    const extra = [...this.litRoots].map((root) => ({ root, pos: root.position }));
    const camPos = this.g.camera.camera.position;
    const fb = (this.g.fog.u as any).fallback.value as THREE.Vector4;
    this.airColor.setRGB(fb.x, fb.y, fb.z);
    for (const a of [this.g.player, ...this.g.enemies, ...this.g.echoes, ...extra]) {
      const root = (a as any).root as THREE.Object3D | undefined;
      if (!root) continue;
      let cl = this.charLights.get(root);
      if (!cl) { cl = new CharacterLight(root, shared); this.charLights.set(root, cl); DynamicShadows.cast(root); }
      cl.update(this.probes, at.copy(a.pos).setY(a.pos.y + 1.1), dt, this.outdoors ? this.flashPulse : 0);
      cl.rig(at, camPos, this.exposure, this.outdoors ? this.airColor : null); // the probe meter: stable, and what the rig was tuned with
      cl.apply();
    }
  }

  /**
   * Eye adaptation, as a camera's auto exposure: the mean radiance of the baked light around Ethan (the probe field's SH DC, the
   * same linear scale as the lightmaps) sets the exposure, (ADAPT_REF / L)^ADAPT_K. Partial on purpose (K < 1): the light of the
   * places spans a hundredfold (a ruined office at 0.005, the daylit terrace at 0.5, the crucible at 2), the eye takes up most
   * of it and a dark place still reads darker than a bright one. Places used to carry a fixed exposure each, tuned while every
   * lightmap was stored through the sRGB curve (its shadows and bounce lifted several times); with linear maps those values
   * left the dim interiors black.
   */
  private adapt(dt: number): void {
    this.adaptIn -= dt;
    if (this.adaptIn > 0 || !this.probes.size) return;
    this.adaptIn = 0.25;
    const p = this.g.player.pos;
    if (!this.probes.sample(this.adaptAt.copy(p).setY(p.y + 1.1), this.adaptSH, 8)) return;
    const c = this.adaptSH[0];
    // the dominant direction of the light here (the SH L1 band: y, z, x) and how directional it is (1 = a single lamp,
    // 0 = light from everywhere): it aims the shadows of moving things and sets how much light they take away
    const lum = (v: THREE.Vector3) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
    this.shadowDir.set(lum(this.adaptSH[3]), lum(this.adaptSH[1]), lum(this.adaptSH[2]));
    const l0 = Math.max(1e-5, lum(c));
    this.shadowAmount = THREE.MathUtils.clamp(this.shadowDir.length() / (1.73 * l0), 0, 1);
    if (this.shadowDir.lengthSq() < 1e-10) this.shadowDir.set(0, 1, 0);
    const L = Math.max(1e-4, (0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z) * 0.282095);
    this.exposure = THREE.MathUtils.clamp(Math.pow(ADAPT_REF / L, ADAPT_K), ADAPT_MIN, ADAPT_MAX);
  }

  tick(dt: number): void {
    this.stream(this.g.player.pos);
    // the temporal storm: lightning, then the thunder a moment later (distance), every 8-22 s while Ethan is outside
    if (this.outdoors) {
      this.thunderAt -= dt;
      if (this.thunderAt <= 0) {
        this.thunderAt = 8 + Math.random() * 14;
        this.g.gfx.look.flash.value = Math.max(this.g.gfx.look.flash.value, 0.08 + Math.random() * 0.08);
        this.lightning = 1;
        // in the Nexus the sky does not thunder: reality cracks (the shift's sound, low)
        if (this.nexus) { this.g.sfx.play('shift', { volume: 0.5, pitch: 0.5 }); this.g.gfx.look.fracture.value = Math.max(this.g.gfx.look.fracture.value, 0.35); }
        else void this.g.wait(0.4 + Math.random() * 1.2).then(() => this.g.sfx.play('thunder', { volume: 0.9 }));
      }
    }
    // lightning: the sky and the air light up in a few flickering pulses; the eye adapts to the place (dark storm -> exposure up)
    if (this.lightning > 0) this.lightning = Math.max(0, this.lightning - dt * 2.6);
    const pulse = this.lightning > 0 ? this.lightning * (0.55 + 0.45 * Math.sin(this.lightning * 41) * Math.sin(this.lightning * 17)) : 0;
    this.flashPulse = pulse;
    const sc = this.g.scene as any;
    sc.backgroundIntensity = this.skyBase * (1 + 9 * pulse);
    const fb = this.g.fog.u.fallback.value as THREE.Vector4;
    fb.set(this.fogBase.x * (1 + 14 * pulse), this.fogBase.y * (1 + 14 * pulse), this.fogBase.z * (1 + 15 * pulse), fb.w);
    this.adapt(dt);
    // a character under a single lamp casts a real shadow; in light from everywhere, a soft dimming
    this.g.gfx.shadows?.aim(this.shadowDir, 0.3 + 0.45 * this.shadowAmount, dt);
    // the probe meter is the exposure on devices without the GPU histogram (and its fallback everywhere)
    this.g.gfx.exposure.meter(this.exposure);
    // characters soak through in a couple of minutes of rain and dry far more slowly inside
    const soakTo = this.outdoors ? weather.rain.value : 0;
    const sk = weather.soak as any;
    sk.value += (soakTo - sk.value) * Math.min(1, dt * (soakTo > sk.value ? 0.03 : 0.004));
    this.pool.update(this.g.player.pos);
    this.lightCharacters(dt);
    for (const pl of this.plates) {
      const on = [this.g.player, ...this.g.echoes].some((a) => Math.hypot(a.pos.x - pl.m.pos.x, a.pos.z - pl.m.pos.z) < 0.85
        && Math.abs(a.pos.y - pl.m.pos.y) < 1.2);
      const door = this.doors.get(pl.door);
      if (on) {
        if (door && door.state !== 'open') door.open();
        pl.until = this.g.time + pl.hold;
      } else if (door && door.state === 'open' && pl.until > 0 && this.g.time > pl.until) { door.close(); pl.until = -1; }
      const mat = pl.ring.material as THREE.MeshBasicNodeMaterial;
      mat.opacity += ((on ? 1 : pl.until > this.g.time ? 0.6 : 0.3) - mat.opacity) * Math.min(1, dt * 8);
    }
    for (const d of this.doors.values()) d.tick(dt);
    for (const l of this.lasers) if (l.tick(dt)) this.onSeen?.(l);
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
      this.g.hud.setPrompt(`[E] ${String(it.m.data.prompt ?? 'Use')}`);
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
