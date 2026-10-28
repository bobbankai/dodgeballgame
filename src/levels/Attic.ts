import * as THREE from 'three';
import levelUrl from '../assets/levels/attic.glb?url';
import { audio } from '../audio/Audio';
import { inkify, loadGLTF } from '../core/Assets';
import type { Game, Level } from '../game/Game';
import { G } from '../render/Globals';
import { inkMaterial } from '../render/InkMaterial';
import { Portrait } from '../render/Portrait';
import { SketchLines, type Segments } from '../render/Sketch';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const LOOKS: Record<string, string[]> = {
  look_window: ["It hasn't stopped raining since Tuesday.", 'Mum liked rain. She said it made the colours outside look freshly painted.'],
  look_drawing: ['The Great Tree. Mum drew this for me when I was six.', 'It lived on the fridge for years. Six big branches, one for each year.'],
  look_boxes: ['"Art things." "Letters." "Misc." All in her writing.', 'Dad says we have to decide what to keep. I want to keep all of it.'],
  look_fox: ['A little paper fox. She folded it out of a drawing that went wrong.', 'She said every page deserves a second life.'],
  look_easel: ["She never let anyone see a painting before it was finished.", "I don't think I want to know what's under the sheet. Not yet."],
};

/** The Prologue: the attic on a rainy night, and Mum's sketchbook. */
export class Attic implements Level {
  readonly name = 'attic';
  private game!: Game;
  private m = new Map<string, THREE.Vector3>();
  private rain!: SketchLines;
  private seg!: Segments;
  private drops: { x: number; y: number; len: number; speed: number }[] = [];
  private lastBoil = -1;
  private lightning = 6;
  private flash = 0;
  private lamp!: THREE.PointLight;
  private seen = new Set<string>();
  private done = false;
  /** Resolves when Ada opens the sketchbook. */
  readonly finished: Promise<void>;
  private finish!: () => void;
  /** Title-screen mode: no player control, a slow drifting shot. */
  titleMode = false;
  /** The epilogue: the morning after, the rain stopped. */
  morning = false;
  private sheet: THREE.Object3D | null = null;
  private fox: THREE.Object3D | null = null;
  private epilogueSeen = new Set<string>();

  constructor() {
    this.finished = new Promise((r) => (this.finish = r));
  }

  async load(game: Game) {
    this.game = game;
    const gltf = await loadGLTF(levelUrl);
    const root = gltf.scene;
    game.scene.add(root);
    const mats = inkify(root, (name) => (name === 'scenery' ? { hatch: 0.55, soft: 0.12 } : { hatch: 0.4 }));
    root.traverse((o) => {
      if (/^(spawn|look|lamp|bulb|easel|book)_/.test(o.name)) this.m.set(o.name, o.getWorldPosition(v3()));
    });
    this.sheet = root.getObjectByName('easel_sheet') ?? null;
    this.fox = root.getObjectByName('paper_fox') ?? null;
    if (this.morning) {
      await this.loadMorning(game, mats);
      return;
    }
    for (const o of root.children) if (/^attic_/.test(o.name) && !/_glass$/.test(o.name)) game.collision.add(o);
    const book = root.getObjectByName('sketchbook')!;
    game.collision.add(book);

    // night in the attic: moonlight through the window, the desk lamp's warm pool
    game.setSun(v3(0.2, 0.55, -1), 0x8fa6d8, 0.35);
    this.lamp = new THREE.PointLight(0xffc27a, 1.4, 7, 1.1);
    this.lamp.position.copy(this.m.get('lamp_light')!);
    game.scene.add(this.lamp);
    const bulb = new THREE.PointLight(0xffd9a0, 0.18, 5, 1.2);
    bulb.position.copy(this.m.get('bulb_light')!);
    game.scene.add(bulb);
    game.pipe.uniforms.uContrast.value = 1.5;
    game.pipe.uniforms.uBloom.value = 1.6;
    game.pipe.uniforms.uTint.value.setRGB(0.9, 0.95, 1.12);
    G.uPigment.value.set(1, 1, 1);
    G.uAmbient.value.setRGB(0.16, 0.18, 0.3);
    G.uShadowTint.value.setRGB(0.3, 0.32, 0.52);
    G.uFog.value.set(60, 200, 0);
    game.pipe.uniforms.uSkyTop.value.setRGB(0.2, 0.24, 0.36);

    // rain running down the round window
    const n = 70;
    this.seg = { a: new Float32Array(n * 3), b: new Float32Array(n * 3), seed: new Float32Array(n * 2), count: n };
    for (let i = 0; i < n; i++) this.drops.push(this.newDrop(true));
    this.rain = new SketchLines(this.seg, { width: 1.2, wobble: 0, color: 0xc9d6ec, alpha: 0.6 });
    game.pipe.overlay.add(this.rain);

    // things to look at
    for (const [key, lines] of Object.entries(LOOKS)) {
      const p = this.m.get(key)!;
      game.interactables.add({
        label: 'Look',
        reach: key === 'look_window' ? 2.2 : 1.6,
        where: (q) => Math.hypot(q.x - p.x, q.z - p.z),
        enabled: () => !this.done,
        onPress: () => this.look(key, lines),
      });
    }
    const bp = this.m.get('look_book')!;
    game.interactables.add({
      label: "Open Mum's sketchbook",
      reach: 1.5,
      where: (q) => Math.hypot(q.x - bp.x, q.z - bp.z),
      enabled: () => !this.done,
      onPress: () => this.openBook(),
    });

    const sp = this.m.get('spawn_attic')!;
    game.player.teleport(sp, Math.PI);
    game.rig.snap(sp, 0);
    // a tight room: closer, wider, a little lower
    game.rig.interior(true);
    audio.ambience('rain');
  }

  /** The morning after: sun through the round window, birds outside, no rain. */
  private async loadMorning(game: Game, mats: Map<THREE.Material, THREE.ShaderMaterial>) {
    for (const m of mats.values()) {
      if (m.name === 'attic_glass') {
        m.uniforms.uColor.value.setRGB(0.82, 0.9, 0.98);
        m.uniforms.uEmissive.value = 0.9;
      }
    }
    game.setSun(v3(0.15, 0.5, -1), 0xfff0d6, 1.35);
    const fill = new THREE.PointLight(0xffe2b8, 0.5, 8, 1.2);
    fill.position.copy(this.m.get('look_window')!).add(v3(0, -0.2, 1.2));
    game.scene.add(fill);
    game.pipe.uniforms.uContrast.value = 1.22;
    game.pipe.uniforms.uBloom.value = 1.3;
    game.pipe.uniforms.uTint.value.setRGB(1.04, 1.0, 0.93);
    G.uPigment.value.set(1, 1, 1);
    G.uAmbient.value.setRGB(0.58, 0.54, 0.5);
    G.uShadowTint.value.setRGB(0.62, 0.58, 0.72);
    G.uFog.value.set(60, 200, 0);
    game.pipe.uniforms.uSkyTop.value.setRGB(0.72, 0.84, 0.96);

    // what is under the sheet: Mum's own painting of the two of them
    const face = this.m.get('easel_face')!;
    const painting = new Portrait('Ada & me', '— Mum');
    painting.paint(1);
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.74), inkMaterial({ map: painting.texture, alwaysColor: true, hatch: 0, soft: 0.6, emissive: 0.2, lineId: 141 }));
    canvas.position.copy(face).add(v3(0, 0, 0.004));
    canvas.rotation.x = 0.12;
    game.scene.add(canvas);

    const easel = this.m.get('look_easel')!;
    game.interactables.add({
      label: 'Lift the sheet',
      reach: 1.6,
      where: (q) => Math.hypot(q.x - easel.x, q.z - easel.z),
      enabled: () => !this.epilogueSeen.has('easel') && !this.done,
      onPress: () => this.liftSheet(),
    });
    const bp = this.m.get('look_book')!;
    game.interactables.add({
      label: "Open Mum's sketchbook",
      reach: 1.5,
      where: (q) => Math.hypot(q.x - bp.x, q.z - bp.z),
      enabled: () => !this.epilogueSeen.has('book') && !this.done,
      onPress: () => this.lastPage(),
    });
    const sp = this.m.get('spawn_morning')!;
    game.player.teleport(sp, 0);
    game.rig.snap(sp, Math.PI);
    game.rig.interior(true);
    audio.ambience('meadow');
  }

  /** The epilogue: resolves when Ada has seen both pictures and the morning is over. */
  async epilogue() {
    const g = this.game, d = g.director;
    const win = this.m.get('look_window')!;
    d.begin();
    d.cinematic(true);
    g.ui.fade(1, 0.01, '#f7f1e3');
    audio.play('none');
    // the round window full of morning, then Ada in front of it
    d.shot(win.clone().add(v3(-0.8, -0.3, 2.6)), win.clone(), 44, true);
    await d.wait(0.5);
    g.ui.fade(0, 3.5, '#f7f1e3');
    await d.wait(3.0);
    audio.play('title');
    g.player.face(win, 1);
    d.shot(g.player.position.clone().add(v3(0.9, 1.2, 1.4)), g.player.position.clone().add(v3(-0.2, 1.15, -1)), 40);
    d.focus(() => g.player.position.clone().add(v3(0, 1.1, 0)), 0.6);
    await d.wait(2.0);
    await d.talk([
      ['Ada', "The rain's stopped."],
      ['Ada', 'Mum would have said the colours outside look freshly painted.'],
    ]);
    d.end();
    g.ui.toast('Her sketchbook is on the desk. Her easel is by the shelf.', 6);
    await new Promise<void>((done) => (this.morningDone = done));
    await this.finale();
  }

  private morningDone: (() => void) | null = null;

  private async lastPage() {
    const g = this.game, d = g.director;
    this.epilogueSeen.add('book');
    const bp = this.m.get('look_book')!;
    d.begin();
    g.player.face(bp, 1);
    d.shot(bp.clone().add(v3(0.5, 0.7, 0.8)), bp.clone().add(v3(0, -0.05, 0)), 38);
    await d.wait(1.0);
    audio.paper();
    const page = new Portrait();
    page.paint(1);
    await g.ui.note('the last page', `<img src="${page.canvas.toDataURL('image/jpeg', 0.9)}" style="width:100%;border-radius:2px;display:block">`, '');
    await d.talk([['Ada', "It's still there. Mum and me."]]);
    d.end();
    this.checkMorning();
  }

  private async liftSheet() {
    const g = this.game, d = g.director;
    this.epilogueSeen.add('easel');
    const easel = this.m.get('easel_face')!;
    d.begin();
    d.cinematic(true);
    g.player.face(easel, 1);
    d.shot(easel.clone().add(v3(1.3, 0.1, 1.6)), easel.clone(), 40);
    await d.wait(1.0);
    g.player.perform('pickup');
    await d.wait(0.4);
    audio.paper();
    // the sheet slides off and drops to the floor
    const sheet = this.sheet;
    if (sheet) {
      const from = sheet.position.clone();
      for (let t = 0; t < 1; t += 1 / 30) {
        sheet.position.set(from.x + t * 0.5, from.y + Math.sin(t * Math.PI) * 0.35 - t * t * 0.5, from.z + t * 0.3);
        sheet.rotation.z = -t * 0.6;
        await d.wait(1 / 30);
      }
      sheet.visible = false;
      g.particles.dust(easel.clone().add(v3(0.4, -0.9, 0.4)), 8, 0.25);
    }
    d.shot(easel.clone().add(v3(0.15, 0.05, 1.25)), easel.clone(), 42);
    d.focus(easel, 0.5);
    await d.wait(2.5);
    await d.talk([
      ['Ada', '...She was painting us.'],
      ['Ada', 'The same picture. The whole time.'],
      ['Ada', 'She did finish it. She just needed me to do my half.'],
    ]);
    d.end();
    this.checkMorning();
  }

  private checkMorning() {
    if (this.epilogueSeen.has('book') && this.epilogueSeen.has('easel')) {
      this.done = true;
      this.morningDone?.();
    }
  }

  /** The paper fox on the shelf, the window, the morning: and out. */
  private async finale() {
    const g = this.game, d = g.director;
    d.begin();
    d.cinematic(true);
    const fox = this.fox;
    const foxAt = this.m.get('look_fox')!;
    d.shot(foxAt.clone().add(v3(0.9, 0.25, 0.5)), foxAt.clone().add(v3(0, 0.05, 0)), 30);
    d.focus(foxAt, 0.9);
    await d.wait(2.0);
    await d.talk([['Ada', 'Thank you, Pip.']]);
    g.ui.hideDialogue();
    await d.wait(0.6);
    // ...and the little paper fox turns its head, just once
    if (fox) {
      const pivot = foxAt.clone();
      const base = fox.position.clone();
      for (let t = 0; t < 1; t += 1 / 24) {
        const a = Math.sin(t * Math.PI) * 0.35;
        fox.position.copy(base).sub(pivot).applyAxisAngle(v3(0, 1, 0), a).add(pivot);
        fox.rotation.y = a;
        await d.wait(1 / 30);
      }
      fox.position.copy(base);
      fox.rotation.y = 0;
    }
    g.particles.sparkles(foxAt.clone().add(v3(0, 0.1, 0)), 0xffd36a, 16, 0.2, 0.08);
    audio.pigment();
    await d.wait(1.5);
    // up and out of the round window into the morning
    const win = this.m.get('look_window')!;
    d.focus(null);
    await d.rail({
      path: [g.camera.position.clone(), win.clone().add(v3(0, 0.2, 2.0)), win.clone().add(v3(0, 0.3, 0.3))],
      look: [foxAt, win.clone(), win.clone().add(v3(0, 0.6, -6))],
      duration: 7,
      fov: [36, 60],
    });
    await g.ui.fade(1, 2.5, '#f7f1e3');
    d.end();
  }

  private newDrop(anywhere = false) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.55;
    return { x: Math.cos(a) * r, y: anywhere ? Math.sin(a) * r : 0.6, len: 0.03 + Math.random() * 0.07, speed: 0.15 + Math.random() * 0.5 };
  }

  async begin() {
    const g = this.game, d = g.director;
    audio.play('attic');
    d.begin(false);
    g.ui.fade(1, 0.01, '#120f14');
    await d.wait(0.3);
    g.ui.fade(0, 2.5);
    await d.wait(2.0);
    await d.talk([
      ['Ada', 'Dad said I could pick one thing of hers to keep.'],
      ['Ada', 'Just one.'],
    ]);
    d.end();
    g.ui.toast(g.input.device === 'gamepad' ? 'Left stick to move  ·  X to look at things' : 'WASD to move  ·  E to look at things  ·  click, then move the mouse to look', 7);
  }

  private async look(key: string, lines: string[]) {
    const g = this.game, d = g.director;
    this.seen.add(key);
    g.player.face(this.m.get(key)!, 1);
    g.player.inputEnabled = false;
    for (const l of lines) await d.say('Ada', l);
    g.ui.hideDialogue();
    g.player.inputEnabled = true;
    if (this.seen.size === 3) g.ui.toast('The sketchbook on the desk...', 4);
  }

  private async openBook() {
    if (this.done) return;
    this.done = true;
    const g = this.game, d = g.director;
    const bp = this.m.get('look_book')!;
    d.begin();
    g.player.face(bp, 1);
    d.shot(bp.clone().add(v3(0.6, 0.75, 0.9)), bp.clone().add(v3(0, -0.05, 0)), 38);
    await d.wait(1.2);
    audio.paper();
    await g.ui.note('a label on the cover', 'For Ada &mdash;<br>when you\'re ready.', '');
    await d.talk([
      ['Ada', "I don't know if I'm ready."],
      ['Ada', '...But I want to see.'],
    ]);
    for (let i = 0; i < 4; i++) {
      audio.pageTurn();
      g.particles.spawn(1, bp.clone().add(v3((Math.random() - 0.5) * 0.3, 0.05, (Math.random() - 0.5) * 0.3)), { life: 0.8, size: 0.05, color: 0xfff3c4, vel: v3(0, 0.3, 0) });
      await d.wait(0.45);
    }
    await d.say('Ada', "The last page... it's a door. She drew a door.");
    g.ui.hideDialogue();
    audio.play('none');
    // the page fills the screen and the door draws itself
    await g.ui.doorTransition(() => audio.pageTurn());
    this.finish();
  }

  update(dt: number) {
    if (this.morning) return;
    // rain: short streaks sliding down the glass, re-drawn on the boil
    const win = v3(0, 1.95, -4.17);
    for (const dr of this.drops) {
      dr.y -= dr.speed * dt;
      if (dr.y < -0.6 || dr.x * dr.x + dr.y * dr.y > 0.36) Object.assign(dr, this.newDrop());
    }
    if (G.uBoil.value !== this.lastBoil) {
      this.lastBoil = G.uBoil.value;
      this.drops.forEach((dr, i) => {
        this.seg.a.set([win.x + dr.x, win.y + dr.y + dr.len, win.z], i * 3);
        this.seg.b.set([win.x + dr.x + 0.004, win.y + dr.y, win.z], i * 3);
        this.seg.seed[i * 2] = Math.random() * 100;
        this.seg.seed[i * 2 + 1] = 2;
      });
      this.rain.setSegments(this.seg);
    }
    // lightning now and then, thunder a moment later
    this.lightning -= dt;
    if (this.lightning <= 0) {
      this.lightning = 9 + Math.random() * 10;
      this.flash = 1;
      window.setTimeout(() => audio.thunder(), 700 + Math.random() * 1200);
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    const f = this.flash > 0.75 || (this.flash > 0.3 && this.flash < 0.45) ? 1 : 0;
    this.game.sun.intensity = 0.35 + f * 2.2;
    this.lamp.intensity = 1.4 * (1 + Math.sin(this.game.time * 13) * 0.01);
    if (this.titleMode) {
      const t = this.game.time * 0.05;
      this.game.director.shot(v3(Math.sin(t) * 1.2, 1.5, -1.0 + Math.cos(t) * 0.4), v3(0, 1.1, -3.6), 46);
    }
  }
}
