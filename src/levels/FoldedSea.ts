import * as THREE from 'three';
import levelUrl from '../assets/levels/folded_sea.glb?url';
import craneUrl from '../assets/models/crane.glb?url';
import pipUrl from '../assets/models/pip.glb?url';
import { audio } from '../audio/Audio';
import { inkify, loadGLTF } from '../core/Assets';
import { Boat } from '../game/Boat';
import { Companion } from '../game/Companion';
import type { Game, Level } from '../game/Game';
import { Keeper } from '../game/Keeper';
import { scatter } from '../game/Scatter';
import { Sea, seaHeight } from '../game/Sea';
import { Smudge } from '../game/Smudge';
import { Storm } from '../game/Storm';
import { TraceTarget } from '../game/Trace';
import { Beam } from '../render/Beam';
import { G } from '../render/Globals';
import { inkMaterial } from '../render/InkMaterial';
import { P } from '../render/Particles';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = THREE.MathUtils.lerp;
/** Ink line id baked into the terrain's vertex alpha (tools/blender/folded_sea.py). */
const TERRAIN_LINE_ID = 7;

/** Where a chapter can be started from (saves and ?at=), in story order. */
const STARTS: Record<string, string> = { arrival: 'spawn_shore', shore: 'cp_shore', headland: 'cp_headland', gallery: 'cp_gallery', pier: 'cp_pier',
  sea1: 'cp_sea1', sea2: 'cp_sea2', sea3: 'cp_sea3', island: 'cp_island' };
const ORDER = Object.keys(STARTS);
const SEA_CPS = ['sea1', 'sea2', 'sea3'];

const NOTES: Record<string, { title: string; body: string }> = {
  bottle_1: {
    title: 'rolled up in a bottle, bobbing by the first stack',
    body: 'Our first holiday by the sea. Ada filled a whole bucket with "blue" and cried when it came out clear.<br><br>I told her the sea keeps its blue to itself. So I drew her one that would share.',
  },
  bottle_2: {
    title: 'in a green bottle, a long way from anywhere',
    body: 'Folding paper waves is slow. Every one is a crease you can\'t take back.<br><br>A bit like being a mum, I think. You fold, and you hope it holds.',
  },
  bottle_3: {
    title: 'the last bottle, its cork sealed with wax',
    body: 'If I can\'t finish this book, someone will have to. I\'ve left a little fox in the corner of page forty-one to keep her company.<br><br>I put a bit of myself into him. I hope that\'s allowed.',
  },
};

interface Bottle {
  key: string;
  mesh: THREE.Group;
  at: THREE.Vector3;
  read: boolean;
  phase: number;
}

/** A corked glass bottle, small enough to fish out of the water with one hand. */
function bottleMesh() {
  const g = new THREE.Group();
  const profile = [[0, 0], [0.085, 0], [0.1, 0.025], [0.1, 0.2], [0.086, 0.245], [0.042, 0.29], [0.036, 0.36], [0.043, 0.375], [0, 0.375]];
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 14),
    inkMaterial({ color: 0x8fc8b6, alwaysColor: true, emissive: 0.18, hatch: 0.25, soft: 0.2 }));
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 0.07, 8), inkMaterial({ color: 0xa47a4c, alwaysColor: true, hatch: 0.4 }));
  cork.position.y = 0.39;
  const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.15, 10, 1, true), inkMaterial({ color: 0xf6eed6, alwaysColor: true, emissive: 0.35, hatch: 0, side: THREE.DoubleSide }));
  scroll.position.y = 0.42;
  scroll.scale.set(0.6, 0.6, 0.6);
  g.add(glass, cork, scroll);
  g.scale.setScalar(3.4);
  return g;
}

/** Chapter Two: the Folded Sea. */
export class FoldedSea implements Level {
  readonly name = 'folded_sea';
  private game!: Game;
  private m = new Map<string, THREE.Vector3>();
  private traces = new Map<string, TraceTarget>();
  pip!: Companion;
  private keeper!: Keeper;
  private boat!: Boat;
  private beam = new Beam(240, 12);
  private beamYaw = 0;
  private beamSpin = 0.75;
  /** When set, the beam swings round to this heading and holds it (the way to the island). */
  private beamLock: number | null = null;
  private lamp = new THREE.PointLight(0xffd59a, 0, 28, 1.1);
  private glow!: THREE.Mesh;
  private lensMat: THREE.ShaderMaterial | null = null;
  private storm!: Storm;
  private smudge!: Smudge;
  private bottles: Bottle[] = [];
  private flags = new Set<string>();
  private checkpoint = v3();
  private seaCp = 'sea1';
  private bloom = 0;
  private respawning = false;
  private reading = false;
  private sailing = false;
  private pigment: THREE.Group | null = null;
  /** Evening light: 0 afternoon .. 1 dusk, eased towards `duskTarget`. */
  private dusk = 0;
  private duskTarget = 0;
  /** How much of the sky's blue is back. */
  private skyBlue = 0;
  /** Distance haze: start, end, strength (pulled back for the long view to the island). */
  private fog = new THREE.Vector3(45, 175, 0.9);
  constructor(private start = 'arrival') {}

  private at(name: string) {
    const p = this.m.get(name);
    if (!p) throw new Error('missing marker ' + name);
    return p.clone();
  }

  /** A point beside the lantern, `turn` radians round from where Ada stands. */
  private besideLamp(turn: number, r: number, up: number) {
    const lamp = this.at('lamp'), p = this.game.player.position;
    const a = Math.atan2(p.z - lamp.z, p.x - lamp.x) + turn;
    return v3(lamp.x + Math.cos(a) * r, lamp.y + up, lamp.z + Math.sin(a) * r);
  }

  /** The way from the lamp to the island, as a heading for the beam. */
  private get islandYaw() {
    const l = this.at('lamp'), i = this.at('pigment_blue');
    return Math.atan2(i.x - l.x, i.z - l.z);
  }

  async load(game: Game) {
    this.game = game;
    const [gltf, pipGltf, craneGltf] = await Promise.all([loadGLTF(levelUrl), loadGLTF(pipUrl), loadGLTF(craneUrl)]);
    const root = gltf.scene;
    game.scene.add(root);
    const mats = inkify(root, (name) => {
      if (name.startsWith('terrain')) return { hatch: 0.45, soft: 0.14 };
      // the lens is the Keeper's magic: it keeps its colour (warm glass) before the gold is back
      if (name === 'lens') return { hatch: 0, soft: 0.3, emissive: 0.05, alwaysColor: true };
      if (name === 'glass') return { hatch: 0.1, soft: 0.3, emissive: 0.08 };
      return {};
    });
    for (const m of mats.values()) if (m.name === 'lens') this.lensMat = m;
    root.traverse((o) => {
      if (/^(spawn_|pip_|cp_|crane_|lamp$|boat_|stack_|bottle_|storm_|pigment_|island_)/.test(o.name)) this.m.set(o.name, o.getWorldPosition(v3()));
    });
    for (const name of ['terrain', 'terrain_island']) {
      const t = root.getObjectByName(name)!;
      game.collision.add(t);
      t.traverse((o) => (o.castShadow = false));
    }
    for (const o of root.children) if (/^scenery_-?\d/.test(o.name)) game.collision.add(o);

    // grass on the clifftops and the headland, wherever the ground is painted green
    const terrain = root.getObjectByName('terrain') as THREE.Mesh;
    const tm = terrain.isMesh ? terrain : (terrain.children[0] as THREE.Mesh);
    game.scene.add(scatter(tm, {
      count: 2600,
      min: new THREE.Vector2(-62, 22),
      max: new THREE.Vector2(62, 84),
      accept: (c, n) => c.g > c.r * 1.12 && c.g > c.b * 1.3 && n.y > 0.8,
    }, 5, TERRAIN_LINE_ID));

    // the sea itself: folded paper pushed about by the same waves the boat rides
    const sea = new Sea(new THREE.Vector2(0, -60), new THREE.Vector2(300, 330));
    game.scene.add(sea.mesh);

    // the things Ada has to finish
    const traceDefs: [string, boolean, number][] = [['trace_steps', true, 2.6], ['trace_lens', false, 2.8], ['trace_boat', false, 3.4], ['trace_label', false, 3.6]];
    for (const [name, solid, reach] of traceDefs) {
      const t = new TraceTarget(game, name, root.getObjectByName(name)!, solid, reach);
      // the label is high on the inkwell's side: it is drawn from the ground in front of it
      const high = name === 'trace_label';
      this.traces.set(name, t);
      game.interactables.add({
        label: 'Hold to ink it in',
        reach: t.reach,
        hold: true,
        where: (p) => (high ? Math.hypot(p.x - t.center.x, p.z - t.center.z) - 1.0 : t.distanceTo(p)),
        enabled: () => !t.done && t.enabled,
        onHold: (dt) => t.hold(dt),
        progress: () => t.progress,
        focus: (p) => t.focus(p),
      });
    }
    for (const n of ['trace_lens', 'trace_boat', 'trace_label']) this.traces.get(n)!.enabled = false;

    // the boat Ada draws turns into a real one: give it a pivot at the berth so it can sail
    const pivot = new THREE.Group();
    pivot.position.copy(this.at('boat_berth'));
    game.scene.add(pivot);
    pivot.attach(root.getObjectByName('trace_boat')!);
    this.boat = new Boat(pivot);

    // the lamp: dark until the lens is drawn
    this.lamp.position.copy(this.at('lamp'));
    game.scene.add(this.lamp);
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), inkMaterial({ color: 0xffe3a6, alwaysColor: true, emissive: 1.4, hatch: 0 }));
    this.glow.position.copy(this.lamp.position);
    this.glow.visible = false;
    game.scene.add(this.glow);
    this.beam.group.position.copy(this.lamp.position);
    this.beam.group.rotation.order = 'YXZ';
    game.pipe.overlay.add(this.beam.group);

    // bottles adrift between the stacks
    Object.keys(NOTES).forEach((key, i) => {
      const at = this.at(key);
      const mesh = bottleMesh();
      mesh.position.copy(at);
      game.scene.add(mesh);
      const b: Bottle = { key, mesh, at, read: false, phase: i * 2.1 };
      this.bottles.push(b);
      game.interactables.add({
        label: 'Fish out the bottle',
        reach: 5,
        where: (p) => Math.hypot(p.x - b.mesh.position.x, p.z - b.mesh.position.z),
        enabled: () => !b.read && this.sailing,
        onPress: () => this.readBottle(b),
      });
    });

    this.pip = new Companion(pipGltf);
    game.scene.add(this.pip.root);
    game.director.pip = this.pip;
    this.keeper = new Keeper(craneGltf);
    game.scene.add(this.keeper.root);
    game.director.actors.set('Keeper', this.keeper);
    this.smudge = new Smudge(game);
    this.smudge.onCatch = () => this.capsized();
    this.storm = new Storm(game);

    // on the lighthouse stair the camera stays outside the tower, a little below Ada, looking up
    // the steps ahead of her (a follow camera would swing into the wall as she winds round)
    const axis = this.at('lamp');
    const foot = this.at('crane_home').y;
    game.rig.guide = (p) => {
      const dx = p.x - axis.x, dz = p.z - axis.z;
      const r = Math.hypot(dx, dz);
      if (r > 3.6 || p.y < foot + 0.4 || game.player.riding) return null;
      const th = Math.atan2(dz, dx);
      // outward from the axis, and back down the stair (it climbs anticlockwise seen from above)
      const ox = Math.cos(th) + Math.sin(th) * 0.75, oz = Math.sin(th) - Math.cos(th) * 0.75;
      return { yaw: Math.atan2(ox, oz), pitch: p.y > axis.y - 1.6 ? 0.42 : 0.2, distance: 5.2 };
    };

    // the look of the chapter: late afternoon on a grey sea; green is back, blue is not
    game.setSun(v3(-0.55, 0.5, -0.45), 0xffe2bf, 1.05);
    G.uPigment.value.set(1, 0, 0);
    G.uBloomCount.value = 0;
    G.uStorm.value = 0;
    G.uFog.value.set(45, 175, 0.9);
    G.uShadowTint.value.setRGB(0.58, 0.58, 0.76);
    game.pipe.uniforms.uBloom.value = 1.0;
    game.rig.interior(false);

    // starting further in (saves, testing): earlier beats count as done
    const si = Math.max(0, ORDER.indexOf(this.start));
    const f = this.flags;
    if (si >= 1) f.add('intro');
    if (si >= 3) {
      f.add('metKeeper').add('stepsDone').add('keeperUp');
      this.traces.get('trace_steps')!.finish();
      this.dusk = this.duskTarget = 0.6;
    }
    if (si >= 4) {
      f.add('galleryTalk').add('lightScene').add('lit');
      this.traces.get('trace_lens')!.finish();
      this.light(1);
      this.beamLock = this.beamYaw = this.islandYaw;
      this.dusk = this.duskTarget = 1;
    }
    if (si >= 5) {
      f.add('pierTalk').add('boatDone').add('launched');
      this.traces.get('trace_boat')!.finish();
    }
    if (si >= 6) f.add('storm');
    if (si >= 8) f.add('stormOver').add('landed');

    const sp = this.at(STARTS[ORDER[si]]);
    this.checkpoint.copy(sp);
    this.keeper.place(this.at(si >= 4 ? 'cp_pier' : si >= 3 ? 'crane_gallery' : 'crane_home').add(si >= 4 ? v3(-1.1, 0, -1.4) : v3()), Math.PI);
    if (si >= 5 && si < 8) {
      this.seaCp = ORDER[si];
      this.board(sp);
      if (si >= 6) {
        this.storm.target = 1;
        this.storm.captureBase();
        this.smudgeBehind(34);
        this.smudge.speed = 4;
        audio.play('storm');
        audio.ambience('rain');
      } else {
        audio.play('sea');
        audio.ambience('sea');
      }
      this.boat.control = true;
      this.sailing = true;
      return;
    }
    if (si >= 8) {
      this.beachBoat();
      this.traces.get('trace_label')!.enabled = true;
    }
    game.player.teleport(sp, Math.PI);
    game.rig.snap(sp, 0);
    this.pip.place(si === 0 ? this.at('pip_shore') : si === 3 ? this.at('cp_headland').add(v3(1.2, 0, 1.6)) : sp.clone().add(v3(1.4, 0, 1)));
    if (si === 3) this.pip.follow = false;
    if (si === 0) {
      this.pip.follow = false;
      this.intro();
    } else {
      audio.play('sea');
      audio.ambience('sea');
    }
  }

  // --- helpers --------------------------------------------------------------------------------

  /** Light the lamp (k = 1) or put it out. */
  private light(k: number) {
    this.lamp.intensity = 2.4 * k;
    this.glow.visible = k > 0.05;
    this.glow.scale.setScalar(0.3 + 0.7 * k);
    if (this.lensMat) this.lensMat.uniforms.uEmissive.value = 0.05 + 0.6 * k;
    this.beam.intensity = k;
  }

  /** Put Ada at the tiller and Pip in the bow, the boat at `at` heading out to sea. */
  private board(at: THREE.Vector3, heading = Math.PI) {
    const g = this.game, b = this.boat;
    b.position.set(at.x, 0, at.z);
    b.heading = heading;
    b.speed = 0;
    b.obj.position.copy(b.position);
    b.obj.quaternion.setFromAxisAngle(v3(0, 1, 0), heading);
    b.obj.updateMatrixWorld(true);
    g.player.ride(b.seatAda, 'tiller');
    g.player.syncRide();
    this.pip.riding = b.seatPip;
    g.rig.sailing(true);
    g.rig.snap(b.position, heading + Math.PI);
  }

  /** Run the boat up onto the island's beach (and leave it there). */
  private beachBoat() {
    const b = this.boat, l = this.at('island_landing');
    b.control = false;
    b.autoThrottle = 0;
    b.speed = 0;
    b.position.set(l.x + 1.5, 0, l.z + 2);
    b.heading = Math.PI + 0.25;
    b.obj.position.copy(b.position);
    b.obj.rotation.set(0, b.heading, 0);
  }

  private smudgeBehind(dist: number) {
    const b = this.boat;
    const back = v3(-Math.sin(b.heading), 0, -Math.cos(b.heading));
    this.smudge.scale = 2.6;
    this.smudge.maxSpeed = 6.2;
    this.smudge.spawn(b.position.clone().addScaledVector(back, dist).setY(2));
    this.smudge.clearTrail();
  }

  /** The evening and the sky, eased every frame (the storm takes over while it blows). */
  private applyLight(dt: number) {
    const g = this.game, u = g.pipe.uniforms;
    this.dusk += (this.duskTarget - this.dusk) * (1 - Math.exp(-dt * 0.12));
    const k = this.dusk, s = this.skyBlue;
    u.uTint.value.setRGB(lerp(0.99, 0.76, k), lerp(0.97, 0.76, k), lerp(0.96, 0.88, k));
    u.uContrast.value = lerp(1.2, 1.32, k);
    const grey = _c1.setRGB(lerp(0.8, 0.6, k), lerp(0.8, 0.61, k), lerp(0.79, 0.68, k));
    const blue = _c2.setRGB(lerp(0.6, 0.4, k), lerp(0.75, 0.52, k), lerp(0.9, 0.76, k));
    u.uSkyTop.value.copy(grey).lerp(blue, s);
    g.sun.intensity = lerp(1.05, 0.8, k);
    g.sun.color.setRGB(1.0, lerp(0.88, 0.78, k), lerp(0.75, 0.7, k));
    G.uAmbient.value.setRGB(lerp(0.56, 0.42, k), lerp(0.57, 0.45, k), lerp(0.6, 0.6, k));
    G.uFog.value.copy(this.fog);
    this.storm.captureBase();
  }

  /** Low and side-on to Ada and Pip, from the side away from the inkwell. */
  private twoShot() {
    const g = this.game, d = g.director;
    const ada = g.player.position, pip = this.pip.position;
    const mid = ada.clone().lerp(pip, 0.45);
    const line = v3().subVectors(pip, ada).setY(0);
    if (line.lengthSq() < 0.01) line.set(1, 0, 0);
    line.normalize();
    const perp = v3(-line.z, 0, line.x);
    const ink = this.at('pigment_blue');
    if (perp.dot(v3().subVectors(mid, ink).setY(0)) < 0) perp.negate();
    g.player.face(pip, 1);
    this.pip.lookAt = ada;
    d.shot(mid.clone().addScaledVector(perp, 3.4).add(v3(0, 0.9, 0)), mid.clone().add(v3(0, 0.75, 0)), 38);
    d.focus(() => this.game.player.position.clone().lerp(this.pip.position, 0.5).add(v3(0, 0.6, 0)), 0.5);
  }

  // --- story ----------------------------------------------------------------------------------

  private async intro() {
    const g = this.game, d = g.director;
    const sp = this.at('spawn_shore');
    const lamp = this.at('lamp');
    d.begin();
    await g.ui.fade(1, 0.01);
    audio.play('none');
    audio.ambience('sea');
    g.player.teleport(sp, Math.PI);
    g.player.root.visible = false;
    this.pip.root.visible = false;
    d.cinematic(true);
    // from far out over the folded waves, in towards the lighthouse and the beach below it
    const fly = d.rail({
      path: [v3(-34, 5, -70), v3(-22, 7.5, -24), v3(-10, 8.5, 18), sp.clone().add(v3(-5, 4.5, -11)), sp.clone().add(v3(2.4, 1.7, -4.2))],
      look: [lamp.clone().add(v3(0, -4, 0)), lamp.clone().add(v3(-10, -10, 0)), v3(0, 2, 50), sp.clone().add(v3(0, 1, 0))],
      duration: 13,
      fov: [40, 44],
      roll: [0.03, 0],
    });
    g.rig.update(0, null, g.player.position, g.player.velocity, g.collision, g.time);
    await d.wait(0.3);
    g.ui.fade(0, 2.6);
    audio.play('title');
    await d.wait(2.6);
    g.ui.title('Chapter Two', 'The Folded Sea', 4.0);
    await fly;
    d.focus(() => sp.clone().add(v3(0, 1, 0)), 0.5);
    audio.play('none');
    g.player.root.visible = true;
    this.pip.root.visible = true;
    audio.pageTurn();
    for (let i = 0; i < 5; i++) g.particles.sparkles(sp.clone().add(v3(0, 1.4, 0)), 0xfff3c4, 6, 1.2, 0.14);
    g.player.perform('land');
    g.particles.dust(g.player.position, 10, 0.3);
    g.particles.dust(this.pip.position, 6, 0.24);
    await d.wait(1.6);
    this.pip.lookAt = g.player.position;
    await d.talk([
      ['Ada', 'Sand. Real sand.'],
      ['Ada', '...Well. Pencil sand.'],
    ]);
    // the sea, as she sees it: grey folds all the way to the edge of the page
    d.focus(null);
    d.shot(sp.clone().add(v3(-1.7, 1.55, 2.2)), v3(4, 0.5, -40), 46);
    await d.wait(1.4);
    await d.talk([
      ['Pip', 'The Folded Sea. She folded every one of these waves by hand, you know. One crease at a time.'],
      ['Ada', "It's grey. All of it."],
      ['Pip', 'The blue is out there, in her inkwell, on the island past the stacks. Nobody has crossed since the light went out.'],
      ['Ada', 'What light?'],
    ]);
    // low under the headland, up at the dark lantern
    d.focus(lamp, 0.35);
    d.shot(sp.clone().add(v3(5, 0.9, -3)), lamp.clone().add(v3(0, -3, 0)), 34);
    await d.wait(1.2);
    await d.talk([
      ['Pip', "The Keeper's. Up on the headland."],
      ['Pip', "He'll know what to do. Come on!"],
    ]);
    this.pip.lookAt = null;
    this.pip.follow = true;
    d.end();
    this.flags.add('intro');
    audio.play('sea');
    g.ui.toast('Follow the beach to the lighthouse on the headland', 6);
  }

  private async meetKeeper() {
    const g = this.game, d = g.director, k = this.keeper;
    const home = this.at('crane_home');
    d.begin();
    d.cinematic(true);
    k.place(home, Math.PI * 0.85);
    k.lookAt = null;
    // Ada comes up behind him; he is looking out to sea
    const toAda = v3().subVectors(g.player.position, home).setY(0).normalize();
    const stand = home.clone().addScaledVector(toAda, 2.3);
    this.pip.goal = home.clone().addScaledVector(toAda, 2.6).add(v3(toAda.z * 1.3, 0, -toAda.x * 1.3));
    // over Ada's shoulder: the Keeper's back, the sea beyond him
    const side0 = v3(-toAda.z, 0, toAda.x);
    d.focus(() => k.root.position.clone().add(v3(0, 0.9, 0)), 0.55);
    d.shot(stand.clone().addScaledVector(toAda, 1.9).addScaledVector(side0, 0.8).add(v3(0, 1.55, 0)), home.clone().add(v3(0, 0.8, 0)), 40);
    const walk = d.walk(stand);
    await d.wait(2.2);
    await d.say('Keeper', 'Footsteps. On my headland. I had nearly forgotten the sound.');
    await walk;
    g.player.face(home, 1);
    k.lookAt = g.player.position;
    await d.wait(0.6);
    // two-shot, the sea behind them
    const side = v3(-toAda.z, 0, toAda.x);
    d.shot(home.clone().lerp(stand, 0.5).addScaledVector(side, 4.2).add(v3(0, 1.3, 0)), home.clone().lerp(stand, 0.5).add(v3(0, 0.9, 0)), 42);
    d.focus(() => k.root.position.clone().lerp(g.player.position, 0.5).add(v3(0, 1, 0)), 0.4);
    await d.talk([
      ['Pip', "Keeper! It's me, Pip. And this is Ada."],
    ]);
    // close on the Keeper as he takes her in, and bows
    d.shot(stand.clone().addScaledVector(toAda, 0.5).addScaledVector(side, 0.9).add(v3(0, 1.2, 0)), home.clone().add(v3(0, 0.95, 0)), 34);
    d.focus(() => k.root.position.clone().add(v3(0, 1.0, 0)), 0.9);
    await d.wait(1.0);
    await d.say('Keeper', 'Ada.');
    k.bow();
    await d.wait(2.2);
    await d.talk([
      ['Keeper', 'Her daughter. You have her way of standing. As if you are about to argue with the weather.'],
    ]);
    d.overShoulder(k.root.position.clone().add(v3(0, 0.5, 0)), 40);
    d.focus(() => k.root.position.clone().add(v3(0, 1.0, 0)), 0.5);
    await d.talk([
      ['Ada', 'You knew my mum?'],
      ['Keeper', 'She drew me. On a Tuesday, I believe, out of the corner of a shopping list.'],
      ['Keeper', 'Then the Smudge came for the blue, and my light went out with it. No light, no crossing. In the dark the sea folds itself into knots.'],
      ['Ada', "Can't you light it again?"],
      ['Keeper', 'The stair up to the lantern was never finished. She always said she would come back to it.'],
      ['Pip', 'She said that about bridges, too.'],
      ['Keeper', 'Finish the stair, child. I will meet you at the top.'],
      ['Pip', "I'll wait down here. Foxes and spiral staircases don't mix."],
    ]);
    k.lookAt = null;
    d.end();
    this.flags.add('metKeeper');
    this.pip.follow = false;
    this.pip.goal = this.at('cp_headland').add(v3(1.2, 0, 1.6));
    g.ui.toast('Climb the lighthouse stair and ink in the missing steps', 6);
  }

  private async keeperFlight() {
    const g = this.game, d = g.director, k = this.keeper;
    const lamp = this.at('lamp');
    const base = v3(lamp.x, this.at('crane_home').y, lamp.z);
    const top = this.at('crane_gallery');
    d.begin();
    d.cinematic(true);
    await d.wait(0.6);
    // he takes off from the headland and spirals up past Ada to the gallery
    const flight = k.flyTo(top, 4.4);
    const from = k.root.position.clone();
    const orbit = [0, 0.33, 0.66, 1].map((t) => {
      const a = Math.atan2(from.z - base.z, from.x - base.x) - 0.6 + t * 1.6;
      return v3(base.x + Math.cos(a) * (11 - t * 3), base.y + 2 + t * 14, base.z + Math.sin(a) * (11 - t * 3));
    });
    d.focus(() => k.root.position.clone().add(v3(0, 0.6, 0)), 0.4);
    const move = d.rail({ path: orbit, look: [from.clone().add(v3(0, 1.5, 0)), from.clone().lerp(top, 0.5).add(v3(0, 3, 0)), top.clone().add(v3(0, 1, 0))], duration: 4.6, fov: [46, 40] });
    await flight;
    await move;
    k.lookAt = g.player.position;
    // from just off the gallery on Ada's side of the tower, looking down the stair at her
    const pa = Math.atan2(g.player.position.z - lamp.z, g.player.position.x - lamp.x) + 0.35;
    d.shot(v3(lamp.x + Math.cos(pa) * 3.6, top.y + 1.2, lamp.z + Math.sin(pa) * 3.6), g.player.position.clone().add(v3(0, 0.8, 0)), 46);
    d.focus(() => g.player.position.clone().add(v3(0, 1, 0)), 0.3);
    await d.wait(0.8);
    await d.talk([['Keeper', 'Well drawn! Mind the last few. They creak.']]);
    d.end();
    this.flags.add('keeperUp');
    this.duskTarget = 0.6;
  }

  private async galleryTalk() {
    const g = this.game, d = g.director, k = this.keeper;
    d.begin();
    d.cinematic(true);
    k.lookAt = g.player.position;
    g.player.face(k.root.position, 1);
    d.overShoulder(k.root.position.clone().add(v3(0, 0.5, 0)), 44);
    d.focus(() => k.root.position.clone().add(v3(0, 1, 0)), 0.45);
    await d.talk([
      ['Keeper', 'Welcome to the top of the world. Or the top of page sixty, at any rate.'],
    ]);
    // inside the glass: the lamp, and nothing round it to throw its light
    const lamp = this.at('lamp');
    d.shot(this.besideLamp(0.75, 3.3, 0.6), lamp.clone().add(v3(0, -0.2, 0)), 36);
    d.focus(lamp, 0.6);
    await d.talk([
      ['Keeper', 'There is the lamp. And there is where the lens should be: seven rings of glass to throw the light across the sea.'],
      ['Ada', 'She drew the lamp but not the glass.'],
      ['Keeper', 'Glass is hard to draw. You have to draw what is not there.'],
    ]);
    d.end();
    this.flags.add('galleryTalk');
    this.traces.get('trace_lens')!.enabled = true;
    g.ui.toast("Ink in the lantern's lens", 5);
  }

  private async lightScene() {
    const g = this.game, d = g.director, k = this.keeper;
    const lamp = this.at('lamp');
    d.begin();
    d.cinematic(true);
    audio.play('none');
    this.duskTarget = 1;
    // close on the lamp through the glass, as it catches
    d.shot(this.besideLamp(0.75, 6.2, 1.3), lamp.clone().add(v3(0, 0.4, 0)), 34, true);
    d.focus(lamp, 0.35);
    await d.wait(1.0);
    audio.pigment();
    for (let t = 0; t <= 1.001; t += 1 / 40) {
      this.light(t * t * (1 - 0.3 * Math.sin(t * 40) * (1 - t)));
      if (Math.random() < 0.5) g.particles.sparkles(lamp, 0xffe6a8, 2, 0.5, 0.12);
      await d.wait(1 / 30);
    }
    this.light(1);
    g.rig.addShake(0.15);
    this.beamYaw = this.islandYaw + Math.PI * 0.7;
    this.beamSpin = 0.75;
    audio.play('wonder');
    await d.wait(1.0);
    // out on the water, looking back: the beam swings round across the page and over the camera
    d.focus(null);
    await d.rail({
      path: [v3(-4, 2.2, 14), v3(-9, 3.4, 4), v3(-14, 5, -8)],
      look: lamp.clone().add(v3(0, -3, 0)),
      duration: 8.5,
      fov: [36, 40],
      ease: 'linear',
    });
    // it settles on the island: looking along the beam from behind the lantern
    this.beamLock = this.islandYaw;
    const isle = this.at('pigment_blue');
    const along = v3().subVectors(isle, lamp).setY(0).normalize();
    const side = v3(-along.z, 0, along.x);
    this.fog.set(150, 430, 0.8);
    d.shot(lamp.clone().addScaledVector(side, 3.0).addScaledVector(along, 1.6).add(v3(0, 0.5, 0)), isle.clone().add(v3(0, -3, 0)), 18, true);
    d.focus(isle, 0.25);
    await d.wait(2.5);
    k.lookAt = g.player.position;
    await d.talk([
      ['Keeper', 'Do you see it? Out past the stacks. The inkwell, where she kept her blue.'],
      ['Ada', "It's so far."],
    ]);
    this.fog.set(45, 175, 0.9);
    d.overShoulder(k.root.position.clone().add(v3(0, 0.5, 0)), 42);
    d.focus(() => k.root.position.clone().add(v3(0, 1, 0)), 0.45);
    await d.talk([
      ['Keeper', 'Then you will want a boat. She left one at the end of the pier. Well. The idea of one.'],
      ['Pip', 'Ada can draw ANYTHING!'],
      ['Ada', '...Mostly anything.'],
      ['Keeper', 'The quick way down is a great deal quicker than the slow way. Hold on to my legs.'],
    ]);
    await g.ui.fade(1, 0.8);
    const head = this.at('cp_headland');
    g.player.teleport(head, Math.PI * 0.75);
    this.keeper.place(this.at('cp_pier').add(v3(-1.1, 0, -1.4)), Math.PI);
    this.keeper.lookAt = null;
    this.pip.place(head.clone().add(v3(1.2, 0, 1.2)));
    this.pip.follow = true;
    g.rig.snap(head, Math.PI * 0.75 + Math.PI);
    d.end();
    await d.wait(0.4);
    await g.ui.fade(0, 1.0);
    this.flags.add('lit');
    this.checkpoint.copy(head);
    g.onCheckpoint?.('pier');
    audio.play('sea');
    g.ui.toast('Go down to the pier and draw the boat', 6);
  }

  private async pierTalk() {
    const d = this.game.director;
    this.keeper.lookAt = this.game.player.position;
    await d.talk([
      ['Pip', 'There! Or... there-ish.'],
      ['Keeper', 'A hull, a mast, a sail and a tiller. She always did the tiller last.'],
    ]);
    this.keeper.lookAt = null;
    this.traces.get('trace_boat')!.enabled = true;
    this.game.ui.toast('Ink in the boat beside the pier', 5);
  }

  private async launchScene() {
    const g = this.game, d = g.director, b = this.boat, k = this.keeper;
    d.begin();
    d.cinematic(true);
    // the new boat drops onto the water and bobs
    const berth = this.at('boat_berth');
    g.particles.dust(berth.clone().add(v3(0, 0.2, 0)), 14, 0.4);
    audio.splash();
    d.shot(berth.clone().add(v3(5, 2.2, -4)), berth.clone().add(v3(0, 0.8, 0)), 44);
    d.focus(berth, 0.4);
    await d.wait(1.6);
    await g.ui.fade(1, 0.6);
    this.board(berth.clone().add(v3(0.6, 0, -3)));
    b.control = false;
    k.lookAt = g.player.position;
    d.focus(null);
    await d.wait(0.3);
    g.ui.fade(0, 0.9);
    // close behind Ada at the tiller, then rising and falling back as they pull away
    b.autoThrottle = 0.45;
    const fwd = v3(Math.sin(b.heading), 0, Math.cos(b.heading));
    const start = b.position.clone();
    const shot = d.rail({
      path: [start.clone().addScaledVector(fwd, -3.6).add(v3(1.0, 1.9, 0)), start.clone().addScaledVector(fwd, -2).add(v3(5, 6, 0)), start.clone().addScaledVector(fwd, -1).add(v3(9, 12, 0))],
      look: [start.clone().addScaledVector(fwd, 4).add(v3(0, 1, 0)), start.clone().addScaledVector(fwd, 14).add(v3(0, 0.5, 0)), start.clone().addScaledVector(fwd, 30)],
      duration: 10,
      fov: [44, 50],
    });
    await d.wait(1.5);
    await d.talk([
      ['Keeper', 'Follow the light, and mind the stacks.'],
      ['Keeper', 'And Ada? If the sea starts folding the wrong way... sail faster.'],
    ]);
    await shot;
    k.lookAt = null;
    b.autoThrottle = 0;
    b.control = true;
    d.end();
    g.rig.snap(b.position, b.heading + Math.PI);
    this.sailing = true;
    this.flags.add('launched');
    this.seaCp = 'sea1';
    audio.play('sea');
    g.ui.toast(g.input.device === 'gamepad' ? 'Left stick up to fill the sail  ·  left / right to steer  ·  follow the beam' : 'W to fill the sail  ·  A / D to steer  ·  follow the beam to the island', 7);
  }

  private async readBottle(bt: Bottle) {
    const g = this.game;
    bt.read = true;
    this.reading = true;
    this.boat.control = false;
    g.particles.dust(bt.mesh.position, 8, 0.25);
    g.particles.sparkles(bt.mesh.position, 0xfff3c4, 10, 0.5, 0.14);
    bt.mesh.visible = false;
    audio.splash();
    audio.paper();
    g.player.inputEnabled = false;
    await g.ui.note(NOTES[bt.key].title, NOTES[bt.key].body);
    g.player.inputEnabled = true;
    this.boat.control = !g.director.cutscene;
    this.reading = false;
    const count = this.bottles.filter((x) => x.read).length;
    g.ui.counter(`Mum's notes ${count} / ${this.bottles.length}`);
    g.ui.later(4, () => g.ui.counter(null));
  }

  private async stormScene() {
    const g = this.game, d = g.director, b = this.boat;
    this.flags.add('storm');
    d.begin();
    d.cinematic(true);
    b.control = false;
    b.autoThrottle = 0.35;
    audio.play('none');
    audio.ambience('rain');
    this.storm.captureBase();
    this.storm.target = 1;
    const fwd = v3(Math.sin(b.heading), 0, Math.cos(b.heading));
    const side = v3(fwd.z, 0, -fwd.x);
    // low on the water off the stern, looking back the way they came: something rises there
    this.smudgeBehind(30);
    this.smudge.speed = 0;
    const sm = () => this.smudge.position.clone().add(v3(0, 0.5, 0));
    d.focus(sm, 0.4);
    d.shot(b.position.clone().addScaledVector(fwd, -3.2).addScaledVector(side, 1.6).add(v3(0, 1.1, 0)), sm(), 40, true);
    await d.wait(2.5);
    this.storm.strike();
    await d.talk([['Pip', 'Ada... the sea is folding the wrong way.']]);
    // Ada turns to look
    d.shot(b.position.clone().addScaledVector(fwd, 1.4).addScaledVector(side, -1.1).add(v3(0, 1.5, 0)), g.player.position.clone().add(v3(0, 1.0, 0)), 36, true);
    d.focus(() => g.player.position.clone().add(v3(0, 1.0, 0)), 0.9);
    g.rig.addShake(0.3);
    await d.wait(0.6);
    await d.say('Ada', 'It followed us!');
    // wide and high: the little boat, the dark folds, the Smudge towering behind
    this.smudge.speed = 1.5;
    d.focus(null);
    const wide = d.rail({
      path: [b.position.clone().addScaledVector(side, 20).addScaledVector(fwd, -4).add(v3(0, 6, 0)), b.position.clone().addScaledVector(side, 22).addScaledVector(fwd, 4).add(v3(0, 9, 0))],
      look: [b.position.clone().addScaledVector(fwd, -14).add(v3(0, 2.5, 0)), b.position.clone().addScaledVector(fwd, -6).add(v3(0, 1.5, 0))],
      duration: 5,
      fov: [56, 52],
    });
    this.storm.strike();
    await d.talk([
      ['Pip', 'The Smudge! Fill the sail, Ada! Keep to the light and DON\'T let it catch us!'],
    ]);
    await wide;
    b.autoThrottle = 0;
    b.control = true;
    d.end();
    g.rig.snap(b.position, b.heading + Math.PI);
    this.smudge.speed = 4;
    audio.play('storm');
    g.ui.toast('Outrun the Smudge! Steer between the stacks.', 5);
  }

  private async capsized() {
    if (this.respawning) return;
    this.respawning = true;
    const g = this.game, b = this.boat;
    b.control = false;
    g.rig.addShake(0.7);
    audio.splash();
    g.particles.dust(b.position.clone().add(v3(0, 0.4, 0)), 18, 0.5);
    audio.pageTurn();
    await g.ui.fade(1, 0.5);
    this.board(this.at('cp_' + this.seaCp));
    this.smudgeBehind(34);
    this.smudge.speed = 3.5;
    await g.director.wait(0.4);
    await g.ui.fade(0, 0.7);
    b.control = true;
    this.respawning = false;
    g.ui.toast('Keep the sail full and steer clear of the rocks!', 4);
  }

  private async stormOver() {
    this.flags.add('stormOver');
    this.smudge.dismiss();
    this.storm.target = 0;
    audio.ambience('sea');
    audio.play('sea');
    await this.game.director.talk([
      ['Pip', "...It's stopped. It won't come any closer to the island."],
      ['Ada', 'Like at the Tree.'],
      ['Pip', 'Like at the Tree.'],
    ]);
  }

  private async landScene() {
    const g = this.game, d = g.director;
    this.flags.add('landed');
    d.begin();
    d.cinematic(true);
    this.boat.control = false;
    await g.ui.fade(1, 0.8);
    this.sailing = false;
    this.beachBoat();
    g.player.ride(null);
    this.pip.riding = null;
    g.rig.sailing(false);
    const cp = this.at('cp_island');
    const ink = this.at('pigment_blue');
    g.player.teleport(cp, Math.PI);
    this.pip.place(cp.clone().add(v3(1.3, 0, 0.6)), Math.PI);
    this.pip.follow = true;
    g.rig.snap(cp, 0);
    this.checkpoint.copy(cp);
    g.onCheckpoint?.('island');
    // up from the sand to the great inkwell on the rocks
    d.focus(() => g.player.position.clone().add(v3(0, 1, 0)), 0.4);
    const tilt = d.rail({
      path: [cp.clone().add(v3(2.5, 0.6, 3.5)), cp.clone().add(v3(1.6, 1.4, 4.2))],
      look: [cp.clone().add(v3(0, 1.0, -1)), ink.clone().add(v3(0, -2, 0))],
      duration: 7,
      fov: [40, 46],
    });
    await d.wait(0.3);
    await g.ui.fade(0, 1.2);
    await tilt;
    d.focus(ink, 0.3);
    await d.talk([
      ['Pip', 'The inkwell. Her inkwell.'],
      ['Ada', "It's the one from her desk. The one with the chipped lid. It's... enormous."],
      ['Ada', 'And empty.'],
      ['Pip', 'Not empty. Asleep. Look at the label.'],
      ['Ada', "That's her writing."],
    ]);
    d.end();
    this.traces.get('trace_label')!.enabled = true;
    audio.play('sea');
    g.ui.toast('Ink in the writing on the label', 5);
  }

  private async blueScene() {
    const g = this.game, d = g.director;
    const heart = this.at('pigment_blue');
    d.begin();
    audio.play('none');
    d.shot(g.player.position.clone().add(v3(3, 2.5, 4)), heart.clone().add(v3(0, -1, 0)), 40);
    d.focus(heart, 0.4);
    await d.wait(1.5);
    // the blue wakes at the bottom of the inkwell and wells up out of its mouth
    const drop = new THREE.Group();
    const dm = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), inkMaterial({ color: 0x2f74c8, alwaysColor: true, emissive: 0.7, hatch: 0 }));
    dm.scale.set(1, 1.25, 1);
    drop.add(dm);
    drop.position.copy(heart).add(v3(0, -2, 0));
    g.scene.add(drop);
    this.pigment = drop;
    audio.pigment();
    for (let t = 0; t < 1; t += 1 / 45) {
      drop.position.y = heart.y - 2 + t * 2.4;
      if (Math.random() < 0.6) g.particles.sparkles(drop.position, 0x7fb6f0, 1, 0.3, 0.12);
      await d.wait(1 / 30);
    }
    const ada = g.player.position.clone();
    const to = ada.clone().add(v3(Math.sin(g.player.yaw) * 0.6, 1.0, Math.cos(g.player.yaw) * 0.6));
    const from = drop.position.clone();
    // wide and low behind Ada: the inkwell above her, the drop coming down to her
    const toInk = v3().subVectors(heart, ada).setY(0).normalize();
    const across = v3(-toInk.z, 0, toInk.x);
    d.shot(ada.clone().addScaledVector(toInk, -5).addScaledVector(across, 2.2).add(v3(0, 1.4, 0)), ada.clone().lerp(heart, 0.45).add(v3(0, 1.5, 0)), 50);
    d.focus(() => drop.position, 0.35);
    for (let t = 0; t < 1; t += 1 / 80) {
      drop.position.lerpVectors(from, to, t * t * (3 - 2 * t));
      drop.position.y += Math.sin(t * Math.PI) * 1.4;
      if (Math.random() < 0.5) g.particles.sparkles(drop.position, 0x7fb6f0, 1, 0.3, 0.12);
      await d.wait(1 / 30);
    }
    g.player.perform('pickup');
    await d.wait(0.45);
    g.scene.remove(drop);
    this.pigment = null;
    audio.pigment();
    audio.play('wonder');
    g.particles.sparkles(to, 0x7fb6f0, 60, 1.5, 0.25);
    // the blue runs out from the island across the whole sea, all the way back to the lighthouse
    G.uBloomCount.value = 1;
    G.uBlooms.value[0].set(heart.x, heart.y - 4, heart.z, 0);
    G.uBloomTint.value[0].set(0, 1, 0);
    this.bloom = 0.001;
    d.focus(null);
    const lamp = this.at('lamp');
    const camFrom = g.camera.position.clone();
    // the Keeper comes gliding in over the new blue
    this.keeper.place(heart.clone().add(v3(-26, 6, 34)), 0);
    const land = this.at('island_view').add(v3(-1.6, 0, 0.8));
    void this.keeper.flyTo(land, 9);
    await d.rail({
      path: [camFrom, heart.clone().add(v3(-6, 4, 14)), heart.clone().add(v3(-10, 14, 40)), heart.clone().add(v3(-8, 22, 75))],
      look: [heart.clone(), heart.clone().add(v3(0, -4, 20)), lamp.clone().add(v3(0, -14, -80)), lamp.clone().add(v3(0, -8, 0))],
      duration: 12,
      fov: [44, 56],
      roll: [0, 0.035],
    });
    await d.wait(1.0);
    this.twoShot();
    await d.talk([
      ['Ada', 'Blue.'],
      ['Pip', "That's two."],
      ['Ada', 'Pip... how did you know where she kept it? The inkwell. The boat. The steps.'],
      ['Pip', "I... don't know. I just did. Like remembering a dream you had a long, long time ago."],
      ['Pip', 'Gold is the last one. It is on the very last page. The one she never got to finish.'],
      ['Ada', "Then we'll finish it for her."],
    ]);
    this.pip.lookAt = null;
    d.end();
    this.flags.add('blue');
    await this.chapterEnd();
  }

  private async chapterEnd() {
    const g = this.game, d = g.director, k = this.keeper;
    d.begin();
    d.cinematic(true);
    await g.ui.fade(1, 1.2);
    // later: the three of them on the island's slope, the lighthouse turning across the blue
    const seat = this.at('cp_island').add(v3(3, 0, 4));
    seat.y = g.collision.groundAt(seat.clone().add(v3(0, 4, 0)), 10) ?? seat.y;
    g.player.teleport(seat, 0);
    g.player.setPose('sit');
    this.pip.place(seat.clone().add(v3(1.0, 0, 0.1)), 0);
    this.pip.follow = false;
    this.pip.pose = 'sit';
    k.place(seat.clone().add(v3(-1.6, 0, 0.5)), 0.3);
    k.root.position.y = g.collision.groundAt(k.root.position.clone().add(v3(0, 3, 0)), 8) ?? seat.y;
    k.lookAt = null;
    this.beamLock = null;
    this.beamSpin = 0.45;
    g.setSun(v3(0.2, 0.16, 0.97), 0xffe9d2, 0.85);
    const lamp = this.at('lamp');
    d.focus(() => g.player.position.clone().add(v3(0, 0.7, 0)), 0.5);
    // low behind the three of them, the sea and the turning light above their heads
    const push = d.rail({
      path: [seat.clone().add(v3(0.7, 0.85, -4.6)), seat.clone().add(v3(0.5, 0.8, -3.4))],
      look: [seat.clone().add(v3(0.3, 1.35, 9)), seat.clone().add(v3(0.3, 1.45, 9))],
      duration: 18,
      fov: [42, 38],
      ease: 'linear',
    });
    await d.wait(0.8);
    await g.ui.fade(0, 2);
    await d.wait(1.5);
    // rack focus out across the water to the light
    d.focus(lamp, 0.4);
    await d.talk([
      ['Keeper', 'She used to sit just there, you know. Drawing the light going round.'],
      ['Ada', 'She never told me about any of this.'],
      ['Keeper', 'Perhaps she was saving it. For when you were ready to finish it with her.'],
      ['Ada', 'It should be orange. Sunsets are supposed to be orange.'],
      ['Pip', "Then let's go and find the gold."],
    ]);
    await push;
    audio.play('title');
    await g.ui.fade(1, 2.5);
    g.player.setPose(null);
    this.pip.pose = null;
    await g.ui.title('End of Chapter Two', 'The Folded Sea', 4);
    window.dispatchEvent(new CustomEvent('chapter-complete', { detail: 2 }));
  }

  private async fell() {
    if (this.respawning) return;
    this.respawning = true;
    const g = this.game;
    audio.splash();
    g.particles.dust(g.player.position, 10, 0.3);
    g.player.inputEnabled = false;
    await g.ui.fade(1, 0.35);
    g.player.teleport(this.checkpoint, g.player.yaw);
    g.rig.snap(this.checkpoint);
    await g.director.wait(0.3);
    await g.ui.fade(0, 0.5);
    g.player.inputEnabled = true;
    this.respawning = false;
  }

  // --- per frame ------------------------------------------------------------------------------

  update(dt: number, time: number) {
    const g = this.game, p = g.player.position, f = this.flags;
    // the boat first, so Ada and Pip sit exactly on it this frame
    if (this.traces.get('trace_boat')!.done) {
      const steer = this.boat.control && !this.reading && !g.director.cutscene && !g.ui.inDialogue;
      this.boat.update(dt, steer ? g.input : null, g.collision, g.particles);
      g.player.rideVelocity.copy(this.boat.velocity);
      g.player.syncRide();
    }
    this.pip.update(dt, g.player, g.collision);
    this.keeper.update(dt);
    for (const t of this.traces.values()) t.update(dt);
    if (!this.storm.active) this.applyLight(dt);
    this.storm.update(dt);
    if (!this.reading) this.smudge.update(dt, p, g.collision);
    if (this.pigment) this.pigment.rotation.y += dt * 2;

    // the lighthouse: the lamp breathes, the beam turns (or holds on the island)
    if (this.beam.intensity > 0) {
      if (this.beamLock !== null) {
        let dy = this.beamLock - this.beamYaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.beamYaw += dy * (1 - Math.exp(-dt * 1.2));
      } else this.beamYaw += dt * this.beamSpin;
      this.beam.group.rotation.set(0.065, this.beamYaw, 0);
      this.lamp.intensity = 2.4 * this.beam.intensity * (1 + 0.05 * Math.sin(time * 9) + 0.03 * Math.sin(time * 23));
    }
    this.beam.update();

    // bottles ride the folds
    for (const b of this.bottles) {
      if (b.read) continue;
      const m = b.mesh;
      m.position.set(b.at.x, seaHeight(b.at.x, b.at.z) + 0.08, b.at.z);
      m.rotation.set(Math.PI / 2 * 0.92 + Math.sin(time * 1.3 + b.phase) * 0.15, time * 0.2 + b.phase, Math.sin(time * 1.7 + b.phase) * 0.2);
      // a glint now and then, big enough to steer for from a long way off
      if (Math.random() < dt * 4) g.particles.spawn(P.Sparkle, m.position.clone().add(v3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8)), { life: 1.1, size: 0.16 + Math.random() * 0.14, color: 0xfff0b0, vel: v3(0, 0.4, 0) });
    }

    // the blue running out across the sea
    if (this.bloom > 0 && this.bloom < 1) {
      this.bloom = Math.min(1, this.bloom + dt / 12);
      const k = this.bloom;
      G.uBlooms.value[0].w = 4 + 250 * k * k;
      this.skyBlue = THREE.MathUtils.smoothstep(k, 0.25, 0.95);
      if (k >= 1) {
        G.uPigment.value.y = 1;
        G.uBloomCount.value = 0;
      }
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2;
        const c = G.uBlooms.value[0];
        const r = Math.min(c.w * (0.85 + Math.random() * 0.15), 40);
        g.particles.spawn(P.Sparkle, v3(c.x + Math.cos(a) * r, 0.6 + Math.random() * 2, c.z + Math.sin(a) * r), { life: 1.6, size: 0.18, color: 0x8cc2f2, vel: v3(Math.cos(a), 0.6, Math.sin(a)) });
      }
    }

    // checkpoints on foot, and at sea the furthest one passed
    if (!g.player.riding) {
      for (const key of ['shore', 'headland', 'gallery', 'pier']) {
        const c = this.at(STARTS[key]);
        if (key === 'gallery' && !f.has('stepsDone')) continue;
        if (key === 'pier' && !f.has('lit')) continue;
        if (p.distanceTo(c) < 4 && g.player.grounded && !this.checkpoint.equals(c)) {
          this.checkpoint.copy(c);
          g.onCheckpoint?.(key);
        }
      }
      // stepping off the beach or the pier into the sea
      if (p.y < -0.6) this.fell();
    } else if (this.sailing) {
      const i = SEA_CPS.indexOf(this.seaCp);
      const next = SEA_CPS[i + 1];
      if (next && this.boat.position.z < this.at('cp_' + next).z) {
        this.seaCp = next;
        g.onCheckpoint?.(next);
      }
    }

    if (g.director.cutscene || g.ui.inDialogue || this.reading) return;
    // story beats, in order
    const steps = this.traces.get('trace_steps')!, lens = this.traces.get('trace_lens')!;
    const boatT = this.traces.get('trace_boat')!, label = this.traces.get('trace_label')!;
    if (f.has('intro') && !f.has('metKeeper') && p.distanceTo(this.at('cp_headland')) < 7 && g.player.grounded) {
      this.meetKeeper();
    } else if (steps.done && !f.has('stepsDone')) {
      f.add('stepsDone');
      this.keeperFlight();
    } else if (f.has('keeperUp') && !f.has('galleryTalk') && p.distanceTo(this.at('cp_gallery')) < 3.5 && g.player.grounded) {
      this.galleryTalk();
    } else if (lens.done && !f.has('lightScene')) {
      f.add('lightScene');
      this.lightScene();
    } else if (f.has('lit') && !f.has('pierTalk') && p.distanceTo(this.at('cp_pier')) < 7) {
      f.add('pierTalk');
      this.pierTalk();
    } else if (boatT.done && !f.has('boatDone')) {
      f.add('boatDone');
      this.launchScene();
    } else if (this.sailing && !f.has('storm') && this.boat.position.z < this.at('storm_start').z) {
      this.stormScene();
    } else if (this.sailing && f.has('storm') && !f.has('stormOver') && this.boat.position.distanceTo(this.at('island_landing')) < 32) {
      this.stormOver();
    } else if (this.sailing && f.has('stormOver') && !f.has('landed') && this.boat.position.distanceTo(this.at('island_landing')) < 9) {
      this.landScene();
    } else if (label.done && !f.has('blueScene')) {
      f.add('blueScene');
      this.blueScene();
    }
  }
}

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
