import * as THREE from 'three';
import levelUrl from '../assets/levels/margin_village.glb?url';
import pipUrl from '../assets/models/pip.glb?url';
import { audio } from '../audio/Audio';
import { inkify, loadGLTF } from '../core/Assets';
import { Companion } from '../game/Companion';
import type { Game, Level } from '../game/Game';
import { scatter } from '../game/Scatter';
import { Smudge } from '../game/Smudge';
import { TraceTarget } from '../game/Trace';
import { G } from '../render/Globals';
import { inkMaterial } from '../render/InkMaterial';
import { P } from '../render/Particles';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** Ink line id baked into the terrain's vertex alpha (tools/blender/margin_village.py). */
const TERRAIN_LINE_ID = 7;

const CHECKPOINTS: [string, string][] = [['stream', 'cp_bridge_south'], ['bridge', 'cp_bridge_north'], ['village', 'cp_village'],
  ['terrace1', 'cp_terrace1'], ['terrace2', 'cp_terrace2'], ['terrace3', 'cp_terrace3'], ['plateau', 'cp_plateau']];

const NOTES: Record<string, { title: string; body: string }> = {
  board: {
    title: 'pinned to the village notice board',
    body: 'Every village needs a well, so wishes have somewhere to go.<br><br>I asked Ada what she would wish for. She thought very hard and said: "More pages."',
  },
  shed: {
    title: 'tucked behind the shed door',
    body: "The windmill doesn't grind anything. I only drew it because Ada liked the sound of the word <i>sails</i>.<br><br>She said it for a week. Sails, sails, sails.",
  },
  tree: {
    title: 'carved, very small, into the Great Tree',
    body: 'Green was your first word. Not Mum, not Dad &mdash; <i>"geen"</i>, pointing at the garden.<br><br>I have never been prouder of anything in my life.',
  },
};

interface Note {
  key: string;
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  read: boolean;
  shown: boolean;
}

/** Chapter One: the Margin Village. */
export class MarginVillage implements Level {
  readonly name = 'margin_village';
  private game!: Game;
  private m = new Map<string, THREE.Vector3>();
  private traces = new Map<string, TraceTarget>();
  private notes: Note[] = [];
  pip!: Companion;
  private smudge!: Smudge;
  private sails: THREE.Object3D | null = null;
  private checkpoint = v3();
  private flags = new Set<string>();
  private pigment: THREE.Group | null = null;
  private bloom = 0;
  private respawning = false;
  /** Where to start (debug): a checkpoint name. */
  constructor(private start = 'arrival') {}

  private at(name: string) {
    const p = this.m.get(name);
    if (!p) throw new Error('missing marker ' + name);
    return p.clone();
  }

  async load(game: Game) {
    this.game = game;
    const [gltf, pipGltf] = await Promise.all([loadGLTF(levelUrl), loadGLTF(pipUrl)]);
    const root = gltf.scene;
    game.scene.add(root);
    inkify(root, (name) => {
      if (name === 'terrain') return { hatch: 0.45, soft: 0.14 };
      if (name === 'water') return { hatch: 0.1, soft: 0.4, emissive: 0.1, water: true };
      if (name === 'kit_lamp') return { emissive: 0.45, hatch: 0 };
      if (name.startsWith('kit_leaf')) return { hatch: 0.75, soft: 0.16 };
      return {};
    });
    root.traverse((o) => {
      const n = o.name;
      if (/^(spawn|pip|cp|note|chase|smudge|pigment)_/.test(n)) this.m.set(n, o.getWorldPosition(v3()));
      if (n === 'windmill_sails') this.sails = o;
      if ((o as THREE.Mesh).isMesh && /^(water|windmill_sails)/.test(o.parent?.name ?? o.name)) o.castShadow = false;
    });
    const terrain = root.getObjectByName('terrain') as THREE.Mesh;
    game.collision.add(terrain);
    // the ground receives shadows but drawing it into the shadow maps costs more than it gives
    terrain.traverse((o) => (o.castShadow = false));
    for (const o of root.children) if (/^scenery_-?\d/.test(o.name)) game.collision.add(o);

    // grass and flowers wherever the ground is painted green
    const tm = (terrain.isMesh ? terrain : (terrain.children[0] as THREE.Mesh));
    game.scene.add(
      scatter(tm, {
        count: 5200,
        min: new THREE.Vector2(-48, -112),
        max: new THREE.Vector2(48, 66),
        accept: (c, n) => c.g > c.r * 1.12 && c.g > c.b * 1.3 && n.y > 0.8,
      }, 3, TERRAIN_LINE_ID),
    );

    // things Ada has to finish
    for (const name of ['trace_bridge', 'trace_stairs', 'trace_branch1', 'trace_branch2', 'trace_branch3']) {
      const obj = root.getObjectByName(name)!;
      const branch = name.startsWith('trace_branch');
      const t = new TraceTarget(game, name, obj, !branch, branch ? 9 : 2.6);
      this.traces.set(name, t);
      game.interactables.add({
        label: 'Hold to ink it in',
        reach: t.reach,
        hold: true,
        where: (p) => (branch ? Math.hypot(p.x - t.center.x, p.z - t.center.z) * 0.9 : t.distanceTo(p)),
        enabled: () => !t.done && t.enabled,
        onHold: (dt) => t.hold(dt),
        progress: () => t.progress,
        focus: (p) => t.focus(p),
      });
    }
    for (const b of [1, 2, 3]) this.traces.get(`trace_branch${b}`)!.enabled = false;

    // Mum's notes: slips of paper fluttering where she left them
    for (const [key, n] of Object.entries(NOTES)) {
      void n;
      const pos = this.at(`note_${key}`);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.36), inkMaterial({ color: 0xf6efda, alwaysColor: true, side: THREE.DoubleSide, emissive: 0.25, hatch: 0 }));
      mesh.position.copy(pos);
      game.scene.add(mesh);
      const note: Note = { key, mesh, base: pos, read: false, shown: key !== 'tree' };
      mesh.visible = note.shown;
      this.notes.push(note);
      game.interactables.add({
        label: 'Read',
        reach: 2.2,
        where: (p) => Math.hypot(p.x - pos.x, p.z - pos.z) + Math.max(0, Math.abs(p.y + 1 - pos.y) - 1.5),
        enabled: () => note.shown,
        onPress: () => this.readNote(note),
      });
    }

    this.pip = new Companion(pipGltf);
    game.scene.add(this.pip.root);
    game.director.pip = this.pip;
    this.smudge = new Smudge(game);
    this.smudge.onCatch = () => this.caught();

    // the look of the chapter: a pencil world, afternoon sun, paper sky
    game.setSun(v3(-0.5, 0.78, 0.42), 0xfff1dc, 1.0);
    G.uPigment.value.set(0, 0, 0);
    G.uColorBase.value = 0;
    G.uBloomCount.value = 0;
    G.uFog.value.set(35, 150, 0.85);
    G.uAmbient.value.setRGB(0.55, 0.55, 0.58);
    game.pipe.uniforms.uContrast.value = 1.18;
    game.pipe.uniforms.uBloom.value = 0.9;
    game.pipe.uniforms.uTint.value.setRGB(1.0, 1.0, 1.0);
    G.uShadowTint.value.setRGB(0.6, 0.56, 0.74);
    game.pipe.uniforms.uSkyTop.value.setRGB(0.84, 0.82, 0.78);

    const cps: Record<string, string> = { arrival: 'spawn_arrival', stream: 'cp_bridge_south', bridge: 'cp_bridge_north', village: 'cp_village',
      terrace1: 'cp_terrace1', terrace2: 'cp_terrace2', terrace3: 'cp_terrace3', plateau: 'cp_plateau' };
    const order = Object.keys(cps);
    const si = Math.max(0, order.indexOf(this.start));
    // when starting further in (for testing), earlier beats count as done
    if (si >= 1) this.flags.add('intro').add('metPip');
    if (si >= 2) {
      this.traces.get('trace_bridge')!.finish();
      this.flags.add('bridgeTalk').add('bridgeDone');
    }
    if (si >= 3) this.flags.add('village');
    if (si >= 4) {
      this.traces.get('trace_stairs')!.finish();
      this.flags.add('stairsDone');
    }
    if (si >= 6) this.flags.add('chase').add('chaseDone');
    const sp = this.at(cps[this.start]);
    this.checkpoint.copy(sp);
    // face up the page, towards the Great Tree
    game.player.teleport(sp, Math.PI);
    game.rig.interior(false);
    game.rig.snap(sp, 0);
    this.pip.place(si === 0 ? this.at('pip_arrival') : sp.clone().add(v3(1.5, 0, 1)));
    if (si === 0) {
      this.pip.follow = false;
      this.intro();
    } else {
      audio.play('village');
      audio.ambience('meadow');
    }
  }

  private async readNote(n: Note) {
    const g = this.game;
    audio.paper();
    g.player.inputEnabled = false;
    await g.ui.note(NOTES[n.key].title, NOTES[n.key].body);
    g.player.inputEnabled = true;
    if (!n.read) {
      n.read = true;
      const count = this.notes.filter((x) => x.read).length;
      g.ui.counter(`Mum's notes ${count} / ${this.notes.length}`);
      g.ui.later(4, () => g.ui.counter(null));
    }
  }

  // --- story --------------------------------------------------------------------------------

  private async intro() {
    const g = this.game, d = g.director;
    const door = this.at('spawn_arrival');
    d.begin();
    await g.ui.fade(1, 0.01);
    audio.play('none');
    audio.ambience('meadow');
    // the page, seen from above: a long glide down from the hill, over the village and the stream
    g.player.teleport(door.clone().add(v3(0, 0, -0.8)), Math.PI);
    g.player.root.visible = false;
    this.pip.root.visible = false;
    d.cinematic(true);
    const tree = this.at('pigment_green');
    const fly = d.rail({
      path: [tree.clone().add(v3(-16, 16, 30)), v3(-12, 20, -8), v3(-6, 13, 22), door.clone().add(v3(-2, 6, -12)), door.clone().add(v3(2.6, 1.6, -4.2))],
      look: [tree.clone().add(v3(0, 2, 0)), v3(0, 3, 6), v3(0, 1, 34), door.clone().add(v3(0, 1.0, 0))],
      duration: 11,
      fov: [52, 42],
    });
    g.rig.update(0, null, g.player.position, g.player.velocity, g.collision, g.time);
    await d.wait(0.3);
    g.ui.fade(0, 2.6);
    audio.play('title');
    await d.wait(2.4);
    g.ui.title('Chapter One', 'The Margin Village', 4.0);
    await fly;
    d.focus(() => door.clone().add(v3(0, 1, 0)), 0.5);
    audio.play('none');
    g.player.root.visible = true;
    audio.pageTurn();
    // the doorway still shimmers from being stepped through
    for (let i = 0; i < 6; i++) g.particles.sparkles(door.clone().add(v3(0, 1.2, 0.9)), 0xfff3c4, 6, 1.2, 0.14);
    await d.wait(1.2);
    g.player.perform('land');
    g.particles.dust(g.player.position, 10, 0.3);
    await d.wait(1.4);
    await d.say('Ada', 'Ow.');
    await d.say('Ada', "Where... where am I?");
    g.ui.hideDialogue();
    d.shot(door.clone().add(v3(-6, 3.5, -9)), door.clone().add(v3(0, 1, -12)), 50);
    await d.wait(2.2);
    await d.say('Ada', "It's all pencil. Like the drawings in Mum's sketchbook.");
    g.ui.hideDialogue();
    // Pip comes bounding over the meadow
    this.pip.root.visible = true;
    this.pip.goal = door.clone().add(v3(1.4, 0, -2.2));
    d.focus(() => this.pip.position, 0.45);
    this.pip.lookAt = g.player.position;
    d.shot(door.clone().add(v3(3.5, 1.6, -4)), door.clone().add(v3(0.8, 0.6, -1.6)), 40);
    await d.until(() => this.pip.goal === null);
    g.player.face(this.pip.position, 1);
    d.overShoulder(this.pip.position.clone().add(v3(0, 0.3, 0)));
    await d.talk([
      ['Pip', "Oh! Oh, you're in colour! You must be her!"],
      ['Ada', 'Her? ...Who are you?'],
      ['Pip', 'Pip. Folded from the corner of page forty-one. I have been waiting for you, Ada.'],
      ['Ada', 'You know my name?'],
      ['Pip', 'Everybody in the margins knows your name. She wrote it on every page.'],
      ['Ada', 'Mum...'],
      ['Pip', 'Something has been rubbing the colour out of her book. The Smudge. Green, blue, gold. All gone grey.'],
      ['Pip', "But you've got her pencil. Whatever you go over in ink, stays."],
      ['Pip', 'The village is just over the stream. Come on!'],
    ]);
    this.pip.lookAt = null;
    this.pip.follow = true;
    d.end();
    this.flags.add('intro').add('metPip');
    audio.play('village');
    g.ui.toast(g.input.device === 'gamepad' ? 'Left stick to move  ·  A to jump  ·  right stick to look' : 'WASD to move  ·  Space to jump  ·  click, then move the mouse to look', 7);
  }

  private async bridgeTalk() {
    const d = this.game.director;
    this.pip.goal = this.at('cp_bridge_south').add(v3(1.2, 0, 0.5));
    await d.talk([
      ['Pip', "Ah. The bridge. She never finished bridges, she always said she'd come back to them."],
      ['Pip', "Go on, you do it. Stand close and hold the button. Go over her pencil lines."],
    ]);
    this.game.ui.toast('Hold E near a pencil sketch to ink it in', 6);
  }

  private async villageTalk() {
    const d = this.game.director;
    await d.talk([
      ['Pip', 'Margin Village! It is usually much busier than this.'],
      ['Ada', "Where is everyone?"],
      ['Pip', "Not drawn yet. Or rubbed out. It's hard to tell, in the grey."],
      ['Pip', "There's something pinned to the board by the well. That's her handwriting, I'd know it anywhere."],
      ['Pip', 'And the green went to sleep in the Great Tree, up the hill. The steps are behind the village.'],
    ]);
  }

  private async chaseScene() {
    const g = this.game, d = g.director;
    d.begin();
    d.cinematic(true);
    const sp = this.at('smudge_spawn');
    const ada = g.player.position.clone();
    const dir = v3().subVectors(sp, ada).setY(0).normalize();
    const side = v3(-dir.z, 0, dir.x);
    // it wells up out of the ground, rubbing the page out around it
    this.smudge.spawn(sp.clone().add(v3(0, -1.5, 0)));
    this.smudge.speed = 0;
    audio.play('none');
    g.player.face(sp, 1);
    d.focus(() => this.smudge.position, 0.75);
    await d.rail({
      path: [ada.clone().addScaledVector(dir, -2.4).addScaledVector(side, 0.9).add(v3(0, 1.6, 0)),
        ada.clone().addScaledVector(dir, -0.9).addScaledVector(side, 0.7).add(v3(0, 1.35, 0)),
        ada.clone().addScaledVector(dir, 1.2).addScaledVector(side, 0.45).add(v3(0, 1.3, 0))],
      look: [sp.clone().add(v3(0, 0.4, 0)), sp.clone().add(v3(0, 1.2, 0))],
      duration: 4.5,
      fov: [46, 32],
    });
    // cut: Ada's face
    g.player.setPose('surprise');
    g.rig.addShake(0.25);
    d.shot(ada.clone().addScaledVector(dir, 1.7).addScaledVector(side, -0.45).add(v3(0, 1.22, 0)), ada.clone().add(v3(0, 1.12, 0)), 32, true);
    d.focus(() => g.player.position.clone().add(v3(0, 1.1, 0)), 1.0);
    await d.wait(0.5);
    await d.say('Ada', 'What is THAT?');
    // wide: the Smudge looming over the two of them
    d.shot(ada.clone().addScaledVector(dir, -4.5).addScaledVector(side, 2.2).add(v3(0, 1.0, 0)), sp.clone().lerp(ada, 0.45).add(v3(0, 1.0, 0)), 52, true);
    d.focus(null);
    await d.talk([
      ['Pip', "The Smudge! Don't let it touch you, it rubs out everything it touches!"],
      ['Pip', "RUN, Ada! Up the rocks! It won't follow us near the Tree!"],
    ]);
    g.player.setPose(null);
    d.end();
    this.flags.add('chase');
    this.smudge.speed = 2.2;
    audio.play('chase');
  }

  private async caught() {
    if (this.respawning) return;
    this.respawning = true;
    const g = this.game;
    g.player.inputEnabled = false;
    g.rig.addShake(0.6);
    audio.pageTurn();
    await g.ui.fade(1, 0.5);
    const cp = this.at('cp_terrace2');
    g.player.teleport(cp, g.player.yaw);
    this.pip.place(cp.clone().add(v3(1.2, 0, 1)));
    this.smudge.spawn(this.at('smudge_spawn').add(v3(0, 1.2, 0)));
    this.smudge.speed = 1.6;
    this.smudge.clearTrail();
    g.rig.snap(cp);
    await g.director.wait(0.4);
    await g.ui.fade(0, 0.7);
    g.player.inputEnabled = true;
    this.respawning = false;
    g.ui.toast('Keep running! Jump up the rocks to reach the hilltop.', 4);
  }

  private async chaseOver() {
    this.flags.add('chaseDone');
    this.smudge.dismiss();
    audio.play('village');
    await this.game.director.talk([
      ['Pip', "...It's stopped. It won't come any closer to the Tree."],
      ['Ada', "Why not?"],
      ['Pip', "I don't know. Maybe it's afraid of what it would find here."],
    ]);
  }

  private async treeScene() {
    const g = this.game, d = g.director;
    const tree = this.at('pigment_green');
    const base = tree.y - 3.4;
    d.begin();
    d.cinematic(true);
    // a slow rising orbit: the trunk, then the bare places where branches should be
    const a0 = Math.atan2(g.player.position.z - tree.z, g.player.position.x - tree.x);
    const orbit = [0, 0.25, 0.5, 0.75, 1].map((k) => {
      const a = a0 + k * 1.5, r = 15 - k * 3;
      return v3(tree.x + Math.cos(a) * r, base + 1.5 + k * 7.5, tree.z + Math.sin(a) * r);
    });
    d.focus(tree, 0.3);
    const move = d.rail({ path: orbit, look: [tree.clone().add(v3(0, -1, 0)), tree.clone().add(v3(0, 6, 0))], duration: 9, fov: [50, 44] });
    await d.wait(2.5);
    await d.say('Pip', 'The Great Tree. Or half of it.');
    await move;
    await d.talk([
      ['Ada', 'Mum drew this. It was on our fridge for years. It had six big branches.'],
      ['Pip', 'Then you know how it goes. Finish it, Ada.'],
    ]);
    d.end();
    for (const b of [1, 2, 3]) this.traces.get(`trace_branch${b}`)!.enabled = true;
    g.ui.toast('Ink in the three missing branches', 6);
  }

  private async pigmentScene() {
    const g = this.game, d = g.director;
    const heart = this.at('pigment_green');
    d.begin();
    audio.play('none');
    d.shot(heart.clone().add(v3(-4, 0.5, 5)), heart, 40);
    await d.wait(1.5);
    // the green wakes in the tree's hollow and drifts down to Ada
    const drop = new THREE.Group();
    const dm = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), inkMaterial({ color: 0x5fbf4a, alwaysColor: true, emissive: 0.6, hatch: 0 }));
    dm.scale.set(1, 1.25, 1);
    drop.add(dm);
    drop.position.copy(heart);
    g.scene.add(drop);
    this.pigment = drop;
    audio.pigment();
    g.particles.sparkles(heart, 0x9fe07a, 30, 1, 0.2);
    await d.wait(1.5);
    const ada = g.player.position.clone();
    const to = ada.clone().add(v3(Math.sin(g.player.yaw) * 0.6, 1.0, Math.cos(g.player.yaw) * 0.6));
    const from = drop.position.clone();
    d.overShoulder(heart, 44);
    for (let t = 0; t < 1; t += 1 / 75) {
      drop.position.lerpVectors(from, to, t * t * (3 - 2 * t));
      drop.position.y += Math.sin(t * Math.PI) * 0.8;
      if (Math.random() < 0.5) g.particles.sparkles(drop.position, 0x9fe07a, 1, 0.3, 0.12);
      await d.wait(1 / 30);
    }
    g.player.perform('pickup');
    await d.wait(0.45);
    g.scene.remove(drop);
    this.pigment = null;
    audio.pigment();
    audio.play('wonder');
    // colour floods out across the whole page
    g.particles.sparkles(to, 0x9fe07a, 60, 1.5, 0.25);
    G.uBloomCount.value = 1;
    G.uBlooms.value[0].set(heart.x, heart.y - 3, heart.z, 0);
    G.uPigment.value.set(1, 0, 0);
    this.bloom = 0.001;
    // crane up and away as the green runs out across the whole page
    d.focus(null);
    const camFrom = g.camera.position.clone();
    await d.rail({
      path: [camFrom, heart.clone().add(v3(-9, 6, 12)), heart.clone().add(v3(-22, 17, 26)), heart.clone().add(v3(-30, 27, 34))],
      look: [heart.clone(), heart.clone().add(v3(0, -2, 4)), heart.clone().add(v3(0, -4, 14)), heart.clone().add(v3(0, -6, 30))],
      duration: 10,
      fov: [42, 58],
      roll: [0, -0.04],
    });
    await d.wait(1.0);
    await d.talk([
      ['Ada', 'Green...'],
      ['Pip', "That's one. Blue is out past the edge of the page, in the Folded Sea."],
      ['Ada', "Then we'll need a boat."],
      ['Pip', 'Can you draw a boat?'],
      ['Ada', 'I can draw anything she taught me.'],
    ]);
    const note = this.notes.find((n) => n.key === 'tree')!;
    note.shown = true;
    note.mesh.visible = true;
    g.particles.sparkles(note.base, 0xfff3c4, 14, 0.6, 0.14);
    d.end();
    this.flags.add('pigment');
    audio.play('village');
    g.ui.toast('Something new is tucked into the Great Tree...', 6);
    await d.until(() => note.read);
    await d.wait(1.0);
    await this.chapterEnd();
  }

  private async chapterEnd() {
    const g = this.game, d = g.director;
    d.begin();
    d.cinematic(true);
    await g.ui.fade(1, 1.2);
    // later: the two of them on the edge of the hilltop, looking out over the green
    const tree = this.at('pigment_green');
    const edge = v3(tree.x + 1.5, tree.y + 4, tree.z + 10.5);
    const gy = g.collision.groundAt(edge, 10) ?? tree.y - 3.4;
    edge.y = gy;
    g.player.teleport(edge, 0);
    g.player.setPose('sit');
    this.pip.place(edge.clone().add(v3(1.0, 0, 0.15)), 0);
    this.pip.follow = false;
    this.pip.pose = 'sit';
    const look = edge.clone().add(v3(-2, -6, 40));
    d.focus(() => g.player.position.clone().add(v3(0, 0.6, 0)), 0.5);
    const push = d.rail({
      path: [edge.clone().add(v3(1.4, 1.5, -3.6)), edge.clone().add(v3(1.1, 1.3, -2.6))],
      look: [look, look.clone().add(v3(0, 1, 0))],
      duration: 16,
      fov: [44, 40],
      ease: 'linear',
    });
    await d.wait(0.8);
    await g.ui.fade(0, 2);
    await d.wait(1.5);
    // rack focus out to the valley
    d.focus(look.clone().add(v3(0, 4, -18)), 0.5);
    await d.talk([
      ['Ada', '...'],
      ['Pip', 'Ada? Are you all right?'],
      ['Ada', "I'm fine. I just... I miss her handwriting. Isn't that silly?"],
      ['Pip', "No. It isn't silly at all."],
    ]);
    await push;
    audio.play('title');
    await g.ui.fade(1, 2.5);
    g.player.setPose(null);
    this.pip.pose = null;
    await g.ui.title('End of Chapter One', 'The Margin Village', 4);
    window.dispatchEvent(new CustomEvent('chapter-complete', { detail: 1 }));
  }

  // --- per frame ---------------------------------------------------------------------------

  update(dt: number, time: number) {
    const g = this.game, p = g.player.position, f = this.flags;
    this.pip.update(dt, g.player, g.collision);
    for (const t of this.traces.values()) t.update(dt);
    if (this.sails) this.sails.rotateOnAxis(v3(0, 0, 1), dt * 0.35);
    for (const n of this.notes) {
      if (!n.shown) continue;
      n.mesh.position.copy(n.base).add(v3(0, Math.sin(time * 1.6) * 0.06, 0));
      n.mesh.rotation.set(0.15 * Math.sin(time * 1.1), time * 0.8, 0.1 * Math.sin(time * 1.3));
      if (!n.read && Math.random() < dt * 3) g.particles.spawn(P.Sparkle, n.mesh.position.clone().add(v3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4)), { life: 0.8, size: 0.06, color: 0xfff0b0, vel: v3(0, 0.25, 0) });
    }
    this.smudge.update(dt, p, g.collision);
    if (this.pigment) this.pigment.rotation.y += dt * 2;

    // the colour bloom from the Great Tree
    if (this.bloom > 0 && this.bloom < 1) {
      this.bloom = Math.min(1, this.bloom + dt / 9);
      const k = this.bloom;
      G.uBlooms.value[0].w = 4 + 190 * k * k;
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        const r = G.uBlooms.value[0].w * (0.7 + Math.random() * 0.3);
        const c = G.uBlooms.value[0];
        g.particles.spawn(P.Leaf, v3(c.x + Math.cos(a) * Math.min(r, 25), c.y + 2 + Math.random() * 6, c.z + Math.sin(a) * Math.min(r, 25)), { life: 3, size: 0.12, color: 0x7fbf55, vel: v3(Math.cos(a), -0.5, Math.sin(a)), spin: 2, drag: 0.3 });
      }
    }

    // checkpoints: the last one Ada stood near (and the game saves there)
    for (const [key, name] of CHECKPOINTS) {
      const c = this.m.get(name)!;
      if (p.distanceTo(c) < 4 && g.player.grounded && !this.checkpoint.equals(c)) {
        this.checkpoint.copy(c);
        g.onCheckpoint?.(key);
      }
    }

    // falling in the stream or off the world: back to the last checkpoint
    if ((p.y < -0.65 && p.distanceTo(this.at('cp_bridge_south')) < 30) || p.y < -12) this.fell();

    if (g.director.cutscene || g.ui.inDialogue) return;
    // story beats, in order
    if (f.has('metPip') && !f.has('bridgeTalk') && p.distanceTo(this.at('cp_bridge_south')) < 12) {
      f.add('bridgeTalk');
      this.bridgeTalk();
    } else if (this.traces.get('trace_bridge')!.done && !f.has('bridgeDone')) {
      f.add('bridgeDone');
      g.director.talk([['Pip', 'Ha! Look at that. Proper ink!']]);
    } else if (!f.has('village') && p.distanceTo(this.at('cp_village')) < 9) {
      f.add('village');
      this.villageTalk();
    } else if (this.traces.get('trace_stairs')!.done && !f.has('stairsDone')) {
      f.add('stairsDone');
      g.director.talk([['Pip', 'Up we go!']]);
    } else if (!f.has('chase') && p.distanceTo(this.at('cp_terrace2')) < 5 && g.player.grounded) {
      this.chaseScene();
    } else if (f.has('chase') && !f.has('chaseDone') && p.y > this.at('cp_terrace3').y - 0.5 && p.distanceTo(this.at('cp_terrace3')) < 12) {
      this.chaseOver();
    } else if (f.has('chaseDone') && !f.has('tree') && p.distanceTo(this.at('cp_plateau')) < 6) {
      f.add('tree');
      this.treeScene();
    } else if (f.has('tree') && !f.has('pigmentScene') && [1, 2, 3].every((b) => this.traces.get(`trace_branch${b}`)!.done)) {
      f.add('pigmentScene');
      this.pigmentScene();
    }
  }

  private async fell() {
    if (this.respawning) return;
    this.respawning = true;
    const g = this.game;
    audio.splash();
    g.particles.dust(g.player.position, 10, 0.3);
    g.player.inputEnabled = false;
    await g.ui.fade(1, 0.35);
    // come back on whichever bank is nearer
    let best = this.checkpoint;
    if (g.player.position.distanceTo(this.at('cp_bridge_south')) < 30) {
      const s = this.at('cp_bridge_south'), n = this.at('cp_bridge_north');
      best = g.player.position.distanceTo(s) < g.player.position.distanceTo(n) ? s : n;
    }
    g.player.teleport(best, g.player.yaw);
    g.rig.snap(best);
    await g.director.wait(0.3);
    await g.ui.fade(0, 0.5);
    g.player.inputEnabled = true;
    this.respawning = false;
  }
}
