import * as THREE from 'three';
import levelUrl from '../assets/levels/unfinished_page.glb?url';
import mumUrl from '../assets/models/mum.glb?url';
import pipUrl from '../assets/models/pip.glb?url';
import { audio } from '../audio/Audio';
import { inkify, loadGLTF } from '../core/Assets';
import { Companion } from '../game/Companion';
import { DrawnPath, type PathKind } from '../game/DrawnPath';
import type { Game, Level } from '../game/Game';
import { Mum } from '../game/Mum';
import { Smudge } from '../game/Smudge';
import { G } from '../render/Globals';
import { inkMaterial } from '../render/InkMaterial';
import { P } from '../render/Particles';
import { Portrait } from '../render/Portrait';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = THREE.MathUtils.lerp;

/** Where the chapter can be started from (saves and ?at=), in story order. */
const STARTS: Record<string, string> = { arrival: 'spawn_door', kitchen: 'cp_kitchen', garden: 'cp_garden', studio: 'cp_studio', page: 'cp_page' };
const ORDER = Object.keys(STARTS);
const PATHS: PathKind[] = ['planks', 'stones', 'books', 'ribbon'];

const NOTES: Record<string, { title: string; body: string }> = {
  kitchen: {
    title: 'tucked under the big mug',
    body: 'Sunday mornings: pancakes, then drawing at this table until lunch. Ada always wanted the blue crayon, and I always let her have it.<br><br>I would have given her every crayon in the world.',
  },
  garden: {
    title: 'tied to the swing rope with a bit of wool',
    body: '"Higher! HIGHER!" Ada, aged five, all summer long. I drew her a hundred times on this swing and never once got her quite right.<br><br>Some things you can only draw from memory.',
  },
  studio: {
    title: 'on the desk, under a jar of pencils',
    body: 'Not much time now, they say. I keep sitting down to draw the last page, and I keep getting up again.<br><br>If I finish it, the book is done. I am not ready for it to be done.',
  },
};

interface Note {
  key: string;
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  read: boolean;
}

/** Chapter Three: the Unfinished Page. */
export class UnfinishedPage implements Level {
  readonly name = 'unfinished_page';
  private game!: Game;
  private m = new Map<string, THREE.Vector3>();
  private extras = new Map<string, Record<string, number>>();
  pip!: Companion;
  private mum!: Mum;
  private smudge!: Smudge;
  private paths: DrawnPath[] = [];
  private notes: Note[] = [];
  private portrait = new Portrait();
  private canvasMesh!: THREE.Mesh;
  private flags = new Set<string>();
  private checkpoint = v3();
  private respawning = false;
  /** Drawing with the Smudge: how much of it has become shading (0..1). */
  private shade = 0;
  private shading = false;
  /** The last page being drawn by Ada (0..1, after the shading). */
  private drawing = 0;
  private bloom = 0;
  /** How much of the gold is back (warms the light and the sky). */
  private gold = 0;
  private lowest = 0;
  constructor(private start = 'arrival') {}

  private at(name: string) {
    const p = this.m.get(name);
    if (!p) throw new Error('missing marker ' + name);
    return p.clone();
  }

  async load(game: Game) {
    this.game = game;
    const [gltf, pipGltf, mumGltf] = await Promise.all([loadGLTF(levelUrl), loadGLTF(pipUrl), loadGLTF(mumUrl)]);
    const root = gltf.scene;
    game.scene.add(root);
    inkify(root, (name) => (name === 'pg_ground' ? { hatch: 0.4, soft: 0.16 } : { hatch: 0.5, soft: 0.12 }));
    root.traverse((o) => {
      if (/^(spawn_|pip_|cp_|note_|path\d_|canvas$|ada_draw|mum_spot|hug_spot|smudge_spawn|studio_view)/.test(o.name)) {
        this.m.set(o.name, o.getWorldPosition(v3()));
        if (o.userData && Object.keys(o.userData).length) this.extras.set(o.name, o.userData as Record<string, number>);
      }
    });
    for (const o of root.children) {
      if (/^frag_/.test(o.name)) {
        game.collision.add(o);
        o.traverse((c) => (c.castShadow = false));
      }
      if (/^scenery_-?\d/.test(o.name)) game.collision.add(o);
    }
    this.lowest = Math.min(...['cp_kitchen', 'cp_garden'].map((n) => this.at(n).y)) - 5;

    // the paths Ada draws between the pieces of page
    for (let i = 0; i < PATHS.length; i++) {
      const p = new DrawnPath(game, `path${i + 1}`, this.at(`path${i + 1}_a`), this.at(`path${i + 1}_b`), PATHS[i], i + 3);
      this.paths.push(p);
      game.interactables.add({
        label: 'Hold to draw a path',
        reach: 2.4,
        hold: true,
        where: (q) => p.distanceTo(q),
        enabled: () => !p.done && p.enabled,
        onHold: (dt) => p.hold(dt),
        progress: () => p.progress,
        focus: () => p.end,
      });
    }

    // Mum's notes
    for (const key of Object.keys(NOTES)) {
      const pos = this.at(`note_${key}`);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.36), inkMaterial({ color: 0xf6efda, alwaysColor: true, side: THREE.DoubleSide, emissive: 0.25, hatch: 0 }));
      mesh.position.copy(pos);
      game.scene.add(mesh);
      const note: Note = { key, mesh, base: pos, read: false };
      this.notes.push(note);
      game.interactables.add({
        label: 'Read',
        reach: 2.2,
        where: (p) => Math.hypot(p.x - pos.x, p.z - pos.z) + Math.max(0, Math.abs(p.y + 1 - pos.y) - 1.5),
        enabled: () => true,
        onPress: () => this.readNote(note),
      });
    }

    // the last page on its easel: blank until the end
    const c = this.at('canvas');
    const ex = this.extras.get('canvas') ?? {};
    this.canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(ex.w ?? 1.7, ex.h ?? 1.25),
      inkMaterial({ map: this.portrait.texture, alwaysColor: true, hatch: 0, soft: 0.6, emissive: 0.25, lineId: 140 }));
    this.canvasMesh.position.copy(c);
    this.canvasMesh.rotation.x = ex.tilt ?? 0;
    game.scene.add(this.canvasMesh);
    game.interactables.add({
      label: 'Hold to draw the last page',
      reach: 1.8,
      hold: true,
      where: (p) => Math.hypot(p.x - this.at('ada_draw').x, p.z - this.at('ada_draw').z),
      enabled: () => this.flags.has('canDraw') && !this.flags.has('drawn'),
      onHold: (dt) => this.drawPage(dt),
      progress: () => this.drawing,
      focus: () => c,
    });
    game.interactables.add({
      label: 'Hold to draw with it',
      reach: 7,
      hold: true,
      where: (p) => p.distanceTo(this.smudge.position) - 2,
      enabled: () => this.shading,
      onHold: (dt) => this.shadeWith(dt),
      progress: () => this.shade,
      focus: () => this.smudge.position,
    });

    this.pip = new Companion(pipGltf);
    game.scene.add(this.pip.root);
    game.director.pip = this.pip;
    this.mum = new Mum(mumGltf);
    game.scene.add(this.mum.root);
    game.director.actors.set('Mum', this.mum);
    this.smudge = new Smudge(game);
    this.smudge.onCatch = () => this.caught();

    // the look: blank page, soft high light; green and blue are back, gold is not
    game.setSun(v3(0.35, 0.85, 0.3), 0xffffff, 0.95);
    G.uPigment.value.set(1, 1, 0);
    G.uBloomCount.value = 0;
    G.uStorm.value = 0;
    G.uFog.value.set(40, 150, 0.95);
    G.uShadowTint.value.setRGB(0.6, 0.6, 0.74);
    G.uAmbient.value.setRGB(0.6, 0.6, 0.62);
    game.pipe.uniforms.uBloom.value = 1.0;
    game.rig.interior(false);
    this.applyLight();

    const si = Math.max(0, ORDER.indexOf(this.start));
    const f = this.flags;
    if (si >= 1) f.add('intro').add('kitchen');
    for (let i = 0; i < si; i++) this.paths[i].finish();
    // (starting at the garden replays the Smudge appearing; at the studio, Pip's confession)
    if (si >= 3) f.add('garden').add('chase');
    if (si >= 4) {
      f.add('studioScene').add('studio');
      this.smudge.scale = 4.5;
      this.smudge.spawn(this.at('smudge_spawn').add(v3(0, 0.5, 0)));
      this.smudge.speed = this.smudge.maxSpeed = 0;
    }
    const sp = this.at(STARTS[ORDER[si]]);
    this.checkpoint.copy(sp);
    game.player.teleport(sp, Math.PI);
    game.rig.snap(sp, 0);
    this.pip.place(si === 0 ? this.at('pip_door') : sp.clone().add(v3(1.3, 0, 1)), Math.PI);
    if (si === 0) {
      this.pip.follow = false;
      this.intro();
    } else {
      audio.play('night');
      audio.ambience('none');
    }
  }

  /** Light and sky, warming as the gold comes back. */
  private applyLight() {
    const g = this.game, u = g.pipe.uniforms, k = this.gold;
    u.uContrast.value = lerp(1.12, 1.2, k);
    u.uTint.value.setRGB(lerp(0.98, 1.04, k), lerp(0.98, 0.98, k), lerp(1.0, 0.9, k));
    u.uSkyTop.value.setRGB(lerp(0.86, 0.98, k), lerp(0.86, 0.83, k), lerp(0.84, 0.6, k));
    g.sun.color.setRGB(1, lerp(1, 0.9, k), lerp(1, 0.74, k));
    G.uAmbient.value.setRGB(lerp(0.6, 0.66, k), lerp(0.6, 0.6, k), lerp(0.62, 0.52, k));
  }

  private async readNote(n: Note) {
    const g = this.game;
    audio.paper();
    g.player.inputEnabled = false;
    await g.ui.note(NOTES[n.key].title, NOTES[n.key].body);
    g.player.inputEnabled = true;
    if (!n.read) {
      n.read = true;
      g.ui.counter(`Mum's notes ${this.notes.filter((x) => x.read).length} / ${this.notes.length}`);
      g.ui.later(4, () => g.ui.counter(null));
    }
  }

  // --- story ------------------------------------------------------------------------------------

  private async intro() {
    const g = this.game, d = g.director;
    const sp = this.at('spawn_door');
    const far = this.at('canvas');
    d.begin();
    await g.ui.fade(1, 0.01, '#f7f1e3');
    audio.play('none');
    g.player.teleport(sp, Math.PI);
    g.player.root.visible = false;
    this.pip.root.visible = false;
    d.cinematic(true);
    // nothing, then pieces of page drifting in the white, then the door
    const fly = d.rail({
      path: [far.clone().add(v3(-30, 26, 40)), v3(-26, 18, -30), v3(-12, 10, 10), sp.clone().add(v3(-4, 3.5, -8)), sp.clone().add(v3(2.2, 1.6, -4.4))],
      look: [far.clone(), v3(0, 2, -45), v3(2, 1, -15), sp.clone().add(v3(0, 1, 0))],
      duration: 14,
      fov: [46, 44],
      roll: [-0.03, 0],
    });
    g.rig.update(0, null, g.player.position, g.player.velocity, g.collision, g.time);
    await d.wait(0.4);
    g.ui.fade(0, 3.0, '#f7f1e3');
    audio.play('night');
    await d.wait(3.2);
    g.ui.title('Chapter Three', 'The Unfinished Page', 4.2);
    await fly;
    d.focus(() => sp.clone().add(v3(0, 1, 0)), 0.5);
    g.player.root.visible = true;
    this.pip.root.visible = true;
    audio.pageTurn();
    for (let i = 0; i < 5; i++) g.particles.sparkles(sp.clone().add(v3(0, 1.3, 1)), 0xfff3c4, 6, 1.2, 0.14);
    g.player.perform('land');
    g.particles.dust(g.player.position, 8, 0.3);
    await d.wait(1.6);
    // looking out over the blank
    d.shot(sp.clone().add(v3(-1.5, 1.6, 2.6)), sp.clone().add(v3(1, 0.8, -14)), 50);
    d.focus(null);
    await d.wait(1.0);
    await d.talk([
      ['Ada', "It's... empty."],
      ['Pip', 'The last page. She never finished it.'],
      ['Ada', "There's nothing to go over. No lines at all."],
    ]);
    this.pip.lookAt = g.player.position;
    d.overShoulder(this.pip.position.clone().add(v3(0, 0.3, 0)), 40);
    await d.talk([
      ['Pip', 'Then you will have to draw it yourself.'],
      ['Ada', 'Draw what?'],
      ['Pip', 'Whatever gets you to the other side.'],
    ]);
    this.pip.lookAt = null;
    this.pip.follow = true;
    d.end();
    this.flags.add('intro');
    audio.play('night');
    g.ui.toast('Stand at the edge of the page and hold E to draw your own way across', 7);
  }

  private async kitchenTalk() {
    await this.game.director.talk([
      ['Ada', 'Our kitchen table.'],
      ['Ada', 'We drew here every Sunday. She always let me have the blue crayon.'],
      ['Pip', 'She remembered. She remembered all of it.'],
    ]);
  }

  private async gardenTalk() {
    const g = this.game, d = g.director;
    await d.talk([
      ['Ada', 'My swing...'],
      ['Pip', 'Ada. Behind us.'],
    ]);
    // it wells up out of the blank, between them and the way they came
    this.smudge.scale = 1.6;
    this.smudge.spawn(this.smudgeBack().add(v3(0, -1, 0)));
    this.smudge.speed = 1.1;
    this.smudge.maxSpeed = 1.5;
    g.rig.addShake(0.3);
    audio.play('chase');
    this.flags.add('chase');
    g.ui.toast('Draw a way up to the next page before it reaches you!', 5);
  }

  /** Where the Smudge comes up out of the blank behind the garden: back along the way Ada came. */
  private smudgeBack() {
    const a = this.at('path2_a'), b = this.at('path2_b');
    return b.clone().add(a.sub(b).setY(0).normalize().multiplyScalar(9)).add(v3(0, 1, 0));
  }

  private async caught() {
    if (this.respawning) return;
    this.respawning = true;
    const g = this.game;
    g.player.inputEnabled = false;
    g.rig.addShake(0.6);
    audio.pageTurn();
    await g.ui.fade(1, 0.5, '#f7f1e3');
    g.player.teleport(this.checkpoint, g.player.yaw);
    this.pip.place(this.checkpoint.clone().add(v3(1.2, 0, 1)));
    g.rig.snap(this.checkpoint);
    if (this.flags.has('page')) {
      // at the last page it only ever drifts back to where it waits
      this.smudge.position.copy(this.at('smudge_spawn')).add(v3(0, 2, 0));
      this.shade = Math.max(0, this.shade - 0.15);
    } else {
      this.smudge.spawn(this.smudgeBack());
      this.smudge.speed = 1.1;
    }
    this.smudge.clearTrail();
    await g.director.wait(0.4);
    await g.ui.fade(0, 0.7, '#f7f1e3');
    g.player.inputEnabled = true;
    this.respawning = false;
  }

  private async studioScene() {
    const g = this.game, d = g.director;
    this.smudge.dismiss();
    audio.play('none');
    d.begin();
    d.cinematic(true);
    const view = this.at('studio_view');
    await d.walk(view);
    this.pip.goal = view.clone().add(v3(1.1, 0, -0.4));
    await d.until(() => this.pip.goal === null);
    g.player.face(this.pip.position, 1);
    this.pip.lookAt = g.player.position;
    this.pip.pose = 'sit';
    // low and close on the two of them by her desk
    const mid = g.player.position.clone().lerp(this.pip.position, 0.5);
    const across = v3().subVectors(this.pip.position, g.player.position).setY(0).normalize();
    const out = v3(-across.z, 0, across.x);
    if (out.dot(v3().subVectors(mid, this.at('note_studio')).setY(0)) < 0) out.negate();
    // low behind Pip, looking up past him at Ada: the fox in the corner of the frame
    d.shot(this.pip.position.clone().addScaledVector(across, 1.5).addScaledVector(out, 0.7).add(v3(0, 0.55, 0)), mid.clone().lerp(g.player.position, 0.6).add(v3(0, 0.75, 0)), 40);
    d.focus(() => g.player.position.clone().add(v3(0, 1.0, 0)), 0.5);
    audio.play('attic');
    await d.talk([
      ['Ada', "Mum's desk. Her stool. Her pencils."],
      ['Pip', 'Ada... I have to tell you something.'],
      ['Pip', "I wasn't folded from the corner of page forty-one."],
      ['Pip', 'I was drawn on the back of this page. The last one.'],
    ]);
    d.shot(this.pip.position.clone().addScaledVector(out, 1.1).add(v3(0, 0.45, 0)), this.pip.position.clone().add(v3(0, 0.35, 0)), 32);
    await d.talk([
      ['Pip', 'Your mum always drew herself as a fox. In the margins. On birthday cards. On the notes in your lunchbox.'],
      ['Ada', 'The fox on my lunchbox notes...'],
      ['Pip', 'I am the bit of her she left in the book. To keep you company until you got here.'],
    ]);
    d.shot(g.player.position.clone().addScaledVector(out, 1.3).addScaledVector(across, 0.4).add(v3(0, 1.15, 0)), g.player.position.clone().add(v3(0, 1.1, 0)), 32);
    d.focus(() => g.player.position.clone().add(v3(0, 1.1, 0)), 0.8);
    await d.talk([
      ['Ada', 'Pip... are you... Mum?'],
      ['Pip', 'Only a little bit of her.'],
      ['Pip', 'The best bit, she would say.'],
    ]);
    // far off, at the last page, the grey gathers
    const page = this.at('smudge_spawn');
    d.shot(g.player.position.clone().add(v3(-1.2, 1.7, 2.4)), page.clone().add(v3(0, 2, 0)), 30);
    d.focus(page, 0.3);
    this.smudge.scale = 4.5;
    this.smudge.spawn(page.clone().add(v3(0, 0.5, 0)));
    this.smudge.speed = 0;
    this.smudge.maxSpeed = 0;
    g.rig.addShake(0.2);
    await d.wait(1.5);
    await d.talk([
      ['Pip', 'It is waiting for us. At the last page.'],
      ['Ada', 'Then that is where we are going.'],
    ]);
    this.pip.pose = null;
    this.pip.lookAt = null;
    d.end();
    this.flags.add('studio');
    audio.play('night');
  }

  private async pageScene() {
    const g = this.game, d = g.director;
    d.begin();
    d.cinematic(true);
    audio.play('none');
    const sm = this.at('smudge_spawn');
    const ada = g.player.position.clone();
    const dir = v3().subVectors(sm, ada).setY(0).normalize();
    const side = v3(-dir.z, 0, dir.x);
    this.smudge.speed = 0;
    g.player.face(sm, 1);
    // low behind Ada, the Smudge towering over the easel
    d.focus(() => this.smudge.position, 0.4);
    await d.rail({
      path: [ada.clone().addScaledVector(dir, -3.2).addScaledVector(side, 1.2).add(v3(0, 0.6, 0)), ada.clone().addScaledVector(dir, -2.2).addScaledVector(side, 0.9).add(v3(0, 0.9, 0))],
      look: [sm.clone().add(v3(0, 3, 0)), sm.clone().add(v3(0, 4.5, 0))],
      duration: 5,
      fov: [44, 38],
    });
    audio.play('chase');
    g.rig.addShake(0.3);
    this.pip.goal = ada.clone().addScaledVector(side, 1.2);
    await d.talk([
      ['Ada', 'Pip, what IS it?'],
    ]);
    d.overShoulder(this.pip.position.clone().add(v3(0, 0.3, 0)), 40);
    d.focus(() => this.pip.position.clone().add(v3(0, 0.3, 0)), 0.5);
    audio.play('none');
    await d.talk([
      ['Pip', 'Every eraser mark in the book. Every line she rubbed out because it was not good enough.'],
      ['Pip', 'Every evening she sat down to draw this page and could not.'],
      ['Pip', 'It is what is left when you want to undo something that cannot be undone.'],
      ['Ada', '...Like missing someone.'],
      ['Pip', 'You cannot outrun it. Nobody can.'],
      ['Pip', 'But you can draw WITH it. Every drawing needs its shadows, Ada.'],
    ]);
    d.end();
    this.flags.add('page');
    this.shading = true;
    this.smudge.speed = 0.5;
    this.smudge.maxSpeed = 0.7;
    // it only takes her if it gets right on top of her
    this.smudge.catchRadius = 0.6;
    audio.play('night');
    g.ui.toast('Hold E facing the Smudge: draw with it', 6);
  }

  /** Holding the pencil towards the Smudge: its scribble streams onto the page as shading. */
  private shadeWith(dt: number) {
    const g = this.game, sm = this.smudge;
    this.shade = Math.min(1, this.shade + dt / 10);
    sm.scale = lerp(4.5, 0.4, this.shade);
    this.portrait.paint(this.shade * this.portrait.shadeFraction);
    // graphite crumbs pulled from it to the easel
    if (Math.random() < 0.8) {
      const from = sm.position.clone().add(v3((Math.random() - 0.5) * sm.scale, (Math.random() - 0.5) * sm.scale, (Math.random() - 0.5) * sm.scale));
      const to = this.at('canvas');
      g.particles.spawn(P.Ink, from, { vel: to.sub(from).multiplyScalar(1.4), life: 0.7, size: 0.06 + Math.random() * 0.05, drag: 0.4 });
    }
    audio.scratchWiggle(Math.random());
    if (this.shade >= 1 && !this.flags.has('shaded')) {
      this.flags.add('shaded');
      this.shading = false;
      this.transformScene();
    }
  }

  private async transformScene() {
    const g = this.game, d = g.director, mum = this.mum;
    this.smudge.dismiss();
    G.uEraseCount.value = 0;
    d.begin();
    d.cinematic(true);
    audio.play('none');
    const spot = this.at('mum_spot');
    const hug = this.at('hug_spot');
    // quiet: the page has its shadows now
    d.shot(this.at('canvas').add(v3(1.6, 0.4, 3.2)), this.at('canvas'), 34);
    d.focus(this.at('canvas'), 0.4);
    await d.wait(2.0);
    g.player.teleport(hug.clone().add(v3(0, 0, 1.4)), Math.PI);
    this.pip.place(spot, 0);
    this.pip.follow = false;
    this.pip.lookAt = g.player.position;
    d.overShoulder(spot.clone().add(v3(0, 0.3, 0)), 38);
    d.focus(() => this.pip.position.clone().add(v3(0, 0.3, 0)), 0.5);
    await d.talk([
      ['Ada', 'It is gone.'],
      ['Pip', 'Not gone. Drawn in. It is part of the picture now. It always will be.'],
      ['Pip', 'There is one more thing, Ada. The gold.'],
      ['Pip', 'It was never lost. I kept it. Right here.'],
    ]);
    g.ui.hideDialogue();
    // Pip unfolds into light
    audio.play('wonder');
    d.shot(spot.clone().add(v3(1.8, 1.0, 2.6)), spot.clone().add(v3(0, 0.7, 0)), 40);
    d.focus(() => spot.clone().add(v3(0, 0.8, 0)), 0.5);
    for (let t = 0; t < 1; t += 1 / 60) {
      const k = t * t;
      this.pip.root.rotation.y += 0.25 + k * 0.6;
      this.pip.position.y = spot.y + k * 0.8;
      this.pip.root.scale.setScalar(Math.max(0.01, 1 - k));
      g.particles.sparkles(this.pip.position.clone().add(v3(0, 0.25, 0)), 0xffd36a, 2, 0.4 + k, 0.14);
      await d.wait(1 / 30);
    }
    this.pip.root.visible = false;
    g.particles.sparkles(spot.clone().add(v3(0, 0.8, 0)), 0xffd36a, 80, 1.4, 0.22);
    g.rig.addShake(0.2);
    // and she is drawn in, from the feet up, in a line of gold
    mum.place(spot, 0);
    mum.pose = 'idle';
    mum.lookAt = g.player.position;
    for (let t = 0; t <= 1.0001; t += 1 / 105) {
      mum.drawn = t;
      if (Math.random() < 0.7) g.particles.sparkles(spot.clone().add(v3((Math.random() - 0.5) * 0.6, mum.cut.value - spot.y, (Math.random() - 0.5) * 0.4)), 0xffd36a, 1, 0.2, 0.1);
      await d.wait(1 / 30);
    }
    mum.drawn = 1;
    await d.wait(0.6);
    d.shot(spot.clone().add(v3(0.9, 1.55, 1.9)), spot.clone().add(v3(0, 1.55, 0)), 30);
    d.focus(() => spot.clone().add(v3(0, 1.55, 0)), 0.8);
    await d.say('Mum', 'Hello, sweetheart.');
    g.ui.hideDialogue();
    // Ada's face
    const ada = g.player.position.clone();
    d.shot(ada.clone().add(v3(0.5, 1.15, -1.3)), ada.clone().add(v3(0, 1.1, 0)), 30);
    d.focus(() => g.player.position.clone().add(v3(0, 1.1, 0)), 0.9);
    await d.wait(0.8);
    await d.say('Ada', '...Mum?');
    g.ui.hideDialogue();
    // she runs to her; Mum kneels and catches her
    d.shot(spot.clone().add(v3(4.2, 1.3, 1.2)), spot.clone().add(v3(0, 0.8, 1.2)), 40);
    d.focus(() => spot.clone().add(v3(0, 0.9, 0.6)), 0.4);
    mum.pose = 'kneel_hug';
    // (in front of her and a touch to her right, clear of the knee she kneels up on)
    await d.walk(spot.clone().add(v3(-0.12, 0, 0.34)), 3.4);
    g.player.face(spot, 1);
    g.player.setPose('hug');
    g.particles.sparkles(spot.clone().add(v3(0, 1.0, 0.3)), 0xffd36a, 50, 1.0, 0.18);
    // the gold runs out from the two of them over the whole page
    G.uBloomCount.value = 1;
    G.uBlooms.value[0].set(spot.x, spot.y, spot.z, 0);
    G.uBloomTint.value[0].set(0, 0, 1);
    this.bloom = 0.001;
    audio.pigment();
    // a slow circle round them
    const orbit = [0, 0.25, 0.5, 0.75, 1].map((k) => {
      const a = 0.4 + k * 1.3;
      return v3(spot.x + Math.cos(a) * (3.2 - k * 0.6), spot.y + 1.1 + k * 0.5, spot.z + 0.3 + Math.sin(a) * (3.2 - k * 0.6));
    });
    d.focus(() => spot.clone().add(v3(0, 1.0, 0.3)), 0.6);
    const ring = d.rail({ path: orbit, look: spot.clone().add(v3(0, 0.95, 0.3)), duration: 22, fov: [38, 34], ease: 'linear' });
    await d.wait(3.0);
    await d.talk([
      ['Mum', 'Look at you. You came all this way.'],
      ['Ada', "I missed you. I miss you all the time."],
      ['Mum', 'I know, love. I know.'],
      ['Mum', "I'm sorry I didn't finish it. The book."],
      ['Ada', "Why didn't you?"],
      ['Mum', 'Because finishing it meant saying goodbye. And I couldn\'t. Not to you.'],
    ]);
    await ring;
    // kneeling, holding her hands, face to face
    mum.pose = 'kneel_hold';
    g.player.setPose(null);
    // side on, the two of them face to face: Mum kneeling, holding Ada's hands
    await d.wait(0.6);
    const mumFace = mum.face();
    const adaFace = g.player.position.clone().add(v3(0, 1.15, 0));
    const between = mumFace.clone().lerp(adaFace, 0.5);
    const across = v3().subVectors(adaFace, mumFace).setY(0).normalize();
    const side = v3(-across.z, 0, across.x);
    if (side.x < 0) side.negate();
    // (aimed low, so their faces sit high in the frame, clear of the dialogue)
    d.shot(between.clone().addScaledVector(side, 1.85).add(v3(0, -0.06, 0)), between.clone().add(v3(0, -0.16, 0)), 40);
    d.focus(() => mum.face().lerp(g.player.position.clone().add(v3(0, 1.15, 0)), 0.5), 0.7);
    await d.talk([
      ['Mum', 'But you can. That is the thing about you, Ada. You always finish what you start.'],
      ['Ada', "I don't want to say goodbye."],
      ['Mum', 'Then don\'t. Draw us instead. Then it isn\'t goodbye.'],
      ['Mum', "It's a picture you get to keep."],
      ['Mum', 'The last page is yours, love.'],
    ]);
    // she stands, and goes back into the page as gold
    mum.pose = 'idle';
    await d.wait(1.2);
    d.shot(spot.clone().add(v3(2.4, 1.3, 2.6)), spot.clone().add(v3(0, 1.0, 0)), 42);
    for (let t = 1; t >= 0; t -= 1 / 120) {
      mum.drawn = t;
      if (Math.random() < 0.8) {
        const from = spot.clone().add(v3((Math.random() - 0.5) * 0.5, mum.cut.value - spot.y, (Math.random() - 0.5) * 0.4));
        g.particles.spawn(P.Sparkle, from, { vel: this.at('canvas').sub(from).multiplyScalar(0.6), life: 1.6, size: 0.12, color: 0xffd36a, drag: 0.2 });
      }
      await d.wait(1 / 30);
    }
    mum.drawn = 0;
    await d.wait(1.0);
    await d.talk([['Ada', '...Okay.']]);
    d.end();
    this.flags.add('canDraw');
    audio.play('title');
    g.ui.toast('Stand at the easel and hold E to draw the last page', 6);
  }

  private drawPage(dt: number) {
    const sf = this.portrait.shadeFraction;
    this.drawing = Math.min(1, this.drawing + dt / 12);
    this.portrait.paint(sf + (1 - sf) * this.drawing);
    if (Math.random() < 0.3) this.game.particles.inkBurst(this.at('canvas').add(v3((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.0, 0.05)), 1, 0.6, 0.03);
    if (this.drawing >= 1 && !this.flags.has('drawn')) {
      this.flags.add('drawn');
      this.endingScene();
    }
  }

  private async endingScene() {
    const g = this.game, d = g.director;
    const c = this.at('canvas');
    d.begin();
    d.cinematic(true);
    g.player.face(c, 1);
    // the picture, then Ada looking at it, then up and away over the whole golden page
    // square on to the picture, from just in front of her
    d.shot(c.clone().add(v3(0.0, 0.02, 1.05)), c, 50, true);
    d.focus(c, 0.3);
    await d.wait(3.5);
    // her face, lit by it
    d.shot(c.clone().add(v3(-0.75, -0.45, 0.5)), g.player.position.clone().add(v3(0, 1.15, 0)), 34);
    d.focus(() => g.player.position.clone().add(v3(0, 1.1, 0)), 0.6);
    await d.talk([
      ['Ada', 'Mum and me.'],
      ['Ada', 'There. Finished.'],
    ]);
    d.focus(null);
    const from = g.camera.position.clone();
    await d.rail({
      path: [from, c.clone().add(v3(-2.5, 1.5, 4)), c.clone().add(v3(-10, 12, 26)), c.clone().add(v3(-18, 34, 70))],
      look: [c.clone(), c.clone().add(v3(0, -0.5, 3)), c.clone().add(v3(0, -4, 28)), c.clone().add(v3(0, -8, 60))],
      duration: 14,
      fov: [40, 54],
    });
    await g.ui.fade(1, 3, '#f7f1e3');
    await g.ui.title('End of Chapter Three', 'The Unfinished Page', 4);
    window.dispatchEvent(new CustomEvent('chapter-complete', { detail: 3 }));
  }

  private async fell() {
    if (this.respawning) return;
    this.respawning = true;
    const g = this.game;
    g.player.inputEnabled = false;
    audio.pageTurn();
    await g.ui.fade(1, 0.4, '#f7f1e3');
    g.player.teleport(this.checkpoint, g.player.yaw);
    this.pip.place(this.checkpoint.clone().add(v3(1.2, 0, 1)));
    g.rig.snap(this.checkpoint);
    await g.director.wait(0.3);
    await g.ui.fade(0, 0.6, '#f7f1e3');
    g.player.inputEnabled = true;
    this.respawning = false;
  }

  // --- per frame -----------------------------------------------------------------------------------

  update(dt: number, time: number) {
    const g = this.game, p = g.player.position, f = this.flags;
    if (this.pip.root.visible) this.pip.update(dt, g.player, g.collision);
    this.mum.update(dt);
    for (const path of this.paths) path.update(dt);
    // at the last page it comes no closer than arm's length: it waits to be drawn
    if (this.shading) this.smudge.speed = Math.hypot(this.smudge.position.x - p.x, this.smudge.position.z - p.z) > 4 ? 0.5 : 0;
    this.smudge.update(dt, p, g.collision);
    for (const n of this.notes) {
      n.mesh.position.copy(n.base).add(v3(0, Math.sin(time * 1.6) * 0.06, 0));
      n.mesh.rotation.set(0.15 * Math.sin(time * 1.1), time * 0.8, 0.1 * Math.sin(time * 1.3));
      if (!n.read && Math.random() < dt * 3) g.particles.spawn(P.Sparkle, n.mesh.position.clone().add(v3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4)), { life: 0.8, size: 0.06, color: 0xfff0b0, vel: v3(0, 0.25, 0) });
    }

    // the gold running out over the page, warming the light as it goes
    if (this.bloom > 0 && this.bloom < 1) {
      this.bloom = Math.min(1, this.bloom + dt / 16);
      const k = this.bloom;
      G.uBlooms.value[0].w = 3 + 170 * k * k;
      this.gold = THREE.MathUtils.smoothstep(k, 0.1, 0.9);
      if (k >= 1) {
        G.uPigment.value.z = 1;
        G.uBloomCount.value = 0;
      }
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2;
        const c = G.uBlooms.value[0];
        const r = Math.min(c.w * (0.85 + Math.random() * 0.15), 20);
        g.particles.spawn(P.Sparkle, v3(c.x + Math.cos(a) * r, c.y + 0.3 + Math.random() * 2, c.z + Math.sin(a) * r), { life: 1.6, size: 0.16, color: 0xffd36a, vel: v3(Math.cos(a), 0.5, Math.sin(a)) });
      }
    }
    this.applyLight();

    // checkpoints
    for (const key of ['kitchen', 'garden', 'studio', 'page']) {
      const c = this.at(STARTS[key]);
      if (p.distanceTo(c) < 4 && g.player.grounded && !this.checkpoint.equals(c)) {
        this.checkpoint.copy(c);
        g.onCheckpoint?.(key);
      }
    }
    // stepping off the page: back to the last checkpoint
    if (p.y < this.lowest) this.fell();

    if (g.director.cutscene || g.ui.inDialogue) return;
    const near = (name: string, r: number) => p.distanceTo(this.at(name)) < r && g.player.grounded;
    if (f.has('intro') && !f.has('kitchen') && near('cp_kitchen', 6)) {
      f.add('kitchen');
      this.kitchenTalk();
    } else if (f.has('kitchen') && !f.has('garden') && near('cp_garden', 6)) {
      f.add('garden');
      this.gardenTalk();
    } else if (f.has('chase') && !f.has('studioScene') && near('cp_studio', 5)) {
      f.add('studioScene');
      this.studioScene();
    } else if (f.has('studio') && !f.has('pageScene') && near('cp_page', 6)) {
      f.add('pageScene');
      this.pageScene();
    }
  }
}
