import { Color3, Vector3 } from '@babylonjs/core';
import type { Director } from './Director';
import type { FighterSpec } from '../game/Fight';
import { DUSK } from '../render/Sky';
import { PAL } from '../game/Effects';

export interface Chapter {
  num: string;
  title: string;
  sub: string;
  run: (d: Director) => Promise<void>;
}

/** [speaker, line, expression?, camera?] — camera: c close-up, o over the listener's shoulder,
 *  t two-shot, w keep the wide shot, n narration, h thought (no camera change for n / h). */
type Line = [string, string, string?, string?];

const CURSE_TINT: [number, number, number] = [0.18, 0.12, 0.2];

/** Play a conversation with automatic coverage: the camera cuts to whoever speaks. */
async function talk(d: Director, lines: Line[], listener?: string): Promise<void> {
  let last = listener ?? '';
  let i = 0;
  for (const [who, text, emo, cam] of lines) {
    if (d.skipping) return;
    if (cam === 'n') {
      await d.narrate(text);
      continue;
    }
    const actor = d.cast.has(who) && d.get(who).visible;
    const other = last && last !== who && d.cast.has(last) && d.get(last).visible ? last : '';
    const mode = cam ?? (actor ? (other ? (i % 3 === 2 ? 't' : i % 2 ? 'o' : 'c') : 'c') : 'w');
    if (actor && cam !== 'h') {
      if (mode === 'c') d.closeUp(who, 0.45 * (i % 2 ? -1 : 1));
      else if (mode === 'o' && other) d.over(other, who);
      else if (mode === 't' && other) d.twoShot(who, other, 3.6, 1.5, i % 2 ? 1 : -1);
      if (other) d.look(who, other);
    }
    if (cam === 'h') await d.think(who, text, emo);
    else await d.say(who, text, emo);
    if (actor && who !== last) last = who;
    i++;
  }
}

/** Wide establishing shot drifting slowly. */
function establish(d: Director, from: [number, number, number], to: [number, number, number], target: [number, number, number], dur = 6): Promise<void> {
  return d.rail({ pos: new Vector3(...from), target: new Vector3(...target), fov: 0.8 }, { pos: new Vector3(...to), target: new Vector3(...target), fov: 0.75 }, dur);
}

async function open(d: Director, stage: string, num: string, title: string, sub: string, music: string): Promise<void> {
  d.r.post.settings.fadeBlack = 1;
  await d.setStage(stage);
  d.music(music as never);
  d.letterbox(true);
  await d.card(num, title, sub);
  await d.fade(false, 1.2);
}

const grunt = (id: string, model: string, kit: string, x: number, z: number, hp?: number, tint = true): FighterSpec => ({
  id, model, kit, team: 1, pos: [x, z], ai: 'grunt', health: hp, opts: tint && model === 'mudhand' ? { tint: CURSE_TINT.map((v) => v * 4) as [number, number, number] } : {},
});

const player = (id: string, model: string, x = 0, z = -4, extra: Partial<FighterSpec> = {}): FighterSpec => ({ id, model, kit: model === 'sojin_young' ? 'sojin' : model, team: 0, pos: [x, z], ...extra });

// =====================================================================================================
// PROLOGUE
// =====================================================================================================

async function prologue(d: Director): Promise<void> {
  d.r.post.settings.fadeBlack = 1;
  await d.setStage('alley');
  d.music('memory');
  d.flashback(true, 0.0);
  await d.wait(0.8);
  await d.narrate('Three years ago, it rained like this.');
  const it = await d.actor('itsuki');
  d.place('itsuki', 2, 6, Math.PI);
  it.anim.play('stand', 0);
  it.face.set('smile');
  await d.fade(false, 2);
  await establish(d, [6, 2.2, -2], [4, 1.8, 1], [2, 1.4, 6], 5);
  await talk(d, [
    ['mio', '"Onii-chan? Cram school finished early. Are you coming to get me?"', undefined, 'n'],
    ['itsuki', 'Twenty minutes, Mio. I\'m with the guys. Walk home and wait inside, okay?', 'smile'],
    ['mio', '"Okay. I\'ll ring my bell when I get in, so you know I\'m home."', undefined, 'n'],
    ['itsuki', 'Yeah, yeah. Ring your little bell. Twenty minutes.', 'smile'],
    ['narrator', 'It wasn\'t twenty minutes. It was two hours.', undefined, 'n'],
    ['narrator', 'I didn\'t hear the sirens over the music. I didn\'t hear anything.', undefined, 'n'],
  ]);
  await d.fade(true, 1.2);
  await d.setStage('apartment');
  d.flashback(true, 0.02);
  const mio = await d.actor('mio');
  d.place('mio', 0, 3, Math.PI);
  mio.anim.play('kneel_grief', 0);
  mio.face.set('closed');
  d.place('itsuki', 0, -2, 0);
  it.anim.play('walk_sad', 0);
  it.face.set('fear');
  d.shot([3, 1.2, -4], [0, 1, 2]);
  await d.fade(false, 1.5);
  d.audio.sfx('bell');
  await talk(d, [
    ['itsuki', 'Mio...? MIO!', 'shout', 'c'],
    ['mio', 'Onii-chan... I rang the bell... did you hear it...?', 'grief', 'c'],
    ['itsuki', 'I\'m here. I\'m here, I\'m sorry, I\'m here—', 'grief', 'c'],
  ]);
  it.anim.play('kneel_grief', 0.4);
  d.closeUp('itsuki', 0.3, 1.4);
  await d.wait(1.2);
  await d.white(0.8);
  d.flashback(false);
  d.remove('mio');
  // --- the present --------------------------------------------------------------------------------
  await d.setStage('alley');
  d.music('tense');
  d.place('itsuki', 0, -6, 0);
  it.anim.play('walk', 0);
  it.face.set('cold');
  await d.card('PROLOGUE', 'The Bell That Didn\'t Ring', 'Shiomi · three years later', 2.8);
  void d.walk('itsuki', 0, -1, 1.2);
  await establish(d, [-5, 1.6, -9], [-3, 1.9, -4], [0, 1.4, -2], 4.5);
  d.audio.sfx('bell');
  await talk(d, [
    ['itsuki', 'There it is again. A bell, where there isn\'t one.', 'cold', 'h'],
    ['itsuki', 'Every time I hear it, something rotten is crawling out of somebody\'s grief.', 'determined', 'h'],
    ['itsuki', 'Come on, then. I\'m not going anywhere tonight.', 'determined', 'c'],
  ]);
  // --- tutorial fight ---------------------------------------------------------------------------
  const res = await d.battle({
    player: 'itsuki', intro: 'CURSES', introSub: '呪',
    fighters: [player('itsuki', 'itsuki', 0, -1), grunt('g1', 'mudhand', 'mudhand', -3, 5), grunt('g2', 'mudhand', 'mudhand', 3, 5)],
    waves: [[grunt('g3', 'mudhand', 'mudhand', -4, 6), grunt('g4', 'mudhand', 'mudhand', 4, 6), grunt('g5', 'mudhand', 'mudhand', 0, 7)]],
    tutorial: [
      { html: 'Move with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>. The camera keeps your target in view.', time: 5 },
      { html: 'Strike with <kbd>J</kbd>. Press it again as a blow lands to chain up to four hits.', done: (f) => f.stats.hits >= 4, time: 14 },
      { html: '<kbd>K</kbd> is a heavy blow that launches. Hit <kbd>Space</kbd> after it lands to follow them into the air.', done: (f) => f.stats.hits >= 8, time: 14 },
      { html: '<kbd>L</kbd> guards. Press it just as a blow arrives for a <b>perfect guard</b>.', time: 10 },
      { html: '<kbd>Shift</kbd> dashes, untouchable for a moment. <kbd>U</kbd> <kbd>I</kbd> <kbd>O</kbd> spend cursed energy on techniques.', time: 12 },
    ],
  });
  if (d.quit) return;
  void res;
  // --- Red Umbrella -----------------------------------------------------------------------------
  const um = await d.actor('umbrella', 'umbrella');
  d.place('umbrella', 0, 9, Math.PI);
  um.anim.play('hover', 0);
  d.place('itsuki', 0, 0, 0);
  d.shot([2, 0.6, -2.5], [0, 2.6, 9], 0.6);
  d.audio.sfx('toll');
  await talk(d, [
    ['umbrella', 'Itsss raining... ssso you\'ll ssstay... sstay inside... ssstay...', undefined, 'w'],
    ['itsuki', 'That one\'s bigger than the usual.', 'fear', 'c'],
  ]);
  await d.battle({
    player: 'itsuki', intro: 'RED UMBRELLA', introSub: '赤傘', canLose: false,
    fighters: [player('itsuki', 'itsuki', 0, 0, { energy: 70 }), { id: 'umbrella', model: 'umbrella', kit: 'umbrella', team: 1, pos: [0, 7], ai: 'boss', health: 1100 }],
    until: { id: 'umbrella', hp: 0.45 }, survive: 80,
  });
  if (d.quit) return;
  // --- Mikami ------------------------------------------------------------------------------------
  const mk = await d.actor('mikami');
  d.place('itsuki', -0.5, -1, 0.3);
  it.anim.play('hurt', 0.2);
  d.place('umbrella', 0.5, 4, Math.PI);
  um.anim.play('stun', 0.1);
  d.place('mikami', 3, -5, -0.4);
  mk.anim.play('stand', 0);
  d.shot([5, 1.2, -9], 'mikami', 0.55);
  await talk(d, [
    ['mikami', 'Still Point.', 'cold', 'w'],
  ]);
  d.burst('umbrella', PAL[2].body, 3);
  d.r.post.settings.heatHaze = 0.6;
  d.aura('mikami', 1, 2);
  await d.wait(0.6);
  d.burst('umbrella', PAL[2].core, 4);
  d.get('umbrella').look.energy.set(0, 2, 0, 0.01);
  await d.task((dt) => {
    const l = d.get('umbrella').look;
    l.energy.w = Math.min(1, l.energy.w + dt * 0.7);
    return l.energy.w >= 1;
  });
  d.hide('umbrella');
  d.aura('mikami', 0);
  await d.walk('mikami', 1, -2.5, 1.2);
  d.look('mikami', 'itsuki');
  d.look('itsuki', 'mikami');
  it.anim.play('stand', 0.3);
  await talk(d, [
    ['mikami', 'Huh. You\'ve been doing this alone? Every night?', 'tired'],
    ['itsuki', 'Who are you?', 'angry'],
    ['mikami', 'Mikami. I teach at a school for people like you. Bad sleepers. Bell-hearers.', 'gentle'],
    ['itsuki', 'How do you know about the bell?', 'surprised'],
    ['mikami', 'Every sorcerer\'s technique wears the shape of something. Yours rings.', 'gentle'],
    ['mikami', 'Curses are made of grief, kid. Of things people couldn\'t let go of.', 'tired'],
    ['mikami', 'And some of them are made of things we didn\'t do.', 'sad'],
    ['itsuki', '...', 'sad'],
    ['mikami', 'Come to Hakuro. Learn to hit them properly, before one of them hits you properly.', 'smile'],
    ['itsuki', 'And if I say no?', 'cold'],
    ['mikami', 'Then you\'ll be out here again tomorrow. Alone. In the rain. Listening for a bell.', 'tired'],
    ['itsuki', '...Fine.', 'determined'],
  ]);
  await d.fade(true, 1.5);
  d.clearCast();
}

// =====================================================================================================
// CHAPTER ONE — HAKURO
// =====================================================================================================

async function hakuro(d: Director): Promise<void> {
  await open(d, 'academy', 'CHAPTER ONE', 'Hakuro', 'the academy in the western hills', 'calm');
  const it = await d.actor('itsuki');
  const mk = await d.actor('mikami');
  const sy = await d.actor('sayo');
  d.place('itsuki', -1, -16, 0);
  d.place('mikami', 1, -16, 0);
  d.place('sayo', 0, 3, Math.PI);
  sy.anim.play('cast_raise', 0);
  void d.walk('itsuki', -1, -4, 1.3);
  void d.walk('mikami', 1, -4, 1.3);
  await establish(d, [-14, 6, -22], [-8, 4, -14], [0, 2, 0], 6);
  sy.anim.play('arms_crossed', 0.4);
  d.look('sayo', 'mikami');
  await talk(d, [
    ['sayo', 'Another stray, Mikami-sensei?', 'cold'],
    ['mikami', 'Itsuki Kagari. Itsuki, this is Sayo Tachibana. Second year. Folds paper. Scares first years.', 'smile'],
    ['sayo', 'He\'s soaked in cursed energy. You can smell it from here.', 'cold'],
    ['itsuki', 'Nice to meet you too.', 'angry'],
    ['mikami', 'Spar with him, Sayo. Don\'t break him. I need him in one piece for the paperwork.', 'tired'],
    ['sayo', 'One piece is a promise I can\'t make.', 'determined'],
  ]);
  await d.battle({
    player: 'itsuki', intro: 'SPARRING', introSub: '稽古', canLose: false, difficulty: 0.8,
    fighters: [player('itsuki', 'itsuki', 0, -4, { energy: 100, domain: 0 }), { id: 'sayo', model: 'sayo', kit: 'sayo', team: 1, pos: [0, 3], ai: 'rookie', health: 900 }],
    until: { id: 'sayo', hp: 0.3 },
    tutorial: [
      { html: 'Sayo fights from range. <kbd>Shift</kbd> dash through her cranes, then close in.', time: 10 },
      { html: '<b>BLACK SPARK</b>: land a <kbd>J</kbd> strike, then press <kbd>K</kbd> within a heartbeat after the impact. Timing is everything.', done: (f) => f.stats.sparks > 0, time: 22 },
      { html: '<kbd>U</kbd> <b>Toll</b>: a palm that sets a bell seal. Strike a sealed foe again to make it ring for extra damage.', time: 14 },
    ],
  });
  if (d.quit) return;
  d.place('itsuki', -1, -1.5, 0);
  d.place('sayo', 1, 1.5, Math.PI);
  it.anim.play('hurt', 0.2);
  sy.anim.play('stand', 0.2);
  await talk(d, [
    ['sayo', '...You fight like someone who\'s been losing for years.', 'cold'],
    ['itsuki', 'Is that a compliment?', 'tired'],
    ['sayo', 'It means you don\'t stay down. That\'s rarer than talent.', 'gentle'],
    ['mikami', 'Lesson over. Go eat. You both look like curses.', 'smile', 'w'],
  ]);
  await d.fade(true, 1.2);
  // --- evening on the roof ---------------------------------------------------------------------------
  d.r.sky.mood = DUSK;
  const L = d.r.lighting;
  L.sunDir = new Vector3(0.7, 0.25, 0.6).normalize();
  L.sunColor = new Color3(1.6, 0.85, 0.5);
  d.r.post.settings.splitStrength = 0.3;
  d.ambient.set('petals', 0.8);
  d.place('itsuki', -0.6, 0, 0.6);
  d.place('sayo', 0.8, 0.2, -0.4);
  it.anim.play('look_down', 0);
  sy.anim.play('stand', 0);
  d.music('sad');
  await d.fade(false, 1.5);
  d.twoShot('itsuki', 'sayo', 5, 2.2);
  await d.wait(1.5);
  await talk(d, [
    ['sayo', 'Mikami-sensei told me. About your sister.', 'sad'],
    ['itsuki', 'Of course he did.', 'cold'],
    ['sayo', 'He tells everyone something. It\'s how he makes you stay.', 'gentle'],
    ['itsuki', 'What did he tell you about?', 'tired'],
  ]);
  sy.anim.play('reach', 0.4);
  await talk(d, [
    ['sayo', 'This. A crane. My brother folded it when we were eight.', 'sad', 'c'],
    ['itsuki', 'Where is he now?', 'gentle'],
    ['sayo', 'Somewhere I can\'t fold my way to. Not yet.', 'sad'],
    ['sayo', 'Every sorcerer here is carrying someone, Kagari. Learn to carry yours without dropping the rest of us.', 'determined'],
  ]);
  d.place('mikami', -4, -3, 0.8);
  mk.anim.play('stand', 0);
  await talk(d, [
    ['mikami', 'Philosophy on the roof. My favourite.', 'smile'],
    ['mikami', 'Since you\'re both awake: domains. Vows. The two things that get sorcerers killed.', 'tired'],
    ['mikami', 'A domain is your heart turned inside out over the world. Inside it, your technique can\'t miss.', 'gentle'],
    ['mikami', 'A vow is a promise that binds you. Give something up, and you get something back. Break it, and it breaks you.', 'cold'],
    ['itsuki', 'I made a promise once. Twenty minutes.', 'sad', 'h'],
    ['mikami', 'Below a third of your strength, you can swear a Vow in a fight. No guard, double the damage. Use it like a last breath.', 'determined'],
  ]);
  d.audio.sfx('select');
  await talk(d, [
    ['mikami', '...Yes. Understood.', 'cold'],
    ['mikami', 'Old chapel on the Shiomi cliffs. Something in a wedding dress has been dragging fishermen into the sea.', 'tired'],
    ['mikami', 'Get some sleep. Tomorrow, you two meet a bride.', 'determined'],
  ]);
  await d.fade(true, 1.5);
}

// =====================================================================================================
// CHAPTER TWO — THE WEEPING BRIDE
// =====================================================================================================

async function bride(d: Director): Promise<void> {
  await open(d, 'chapel', 'CHAPTER TWO', 'The Weeping Bride', 'the chapel on the Shiomi cliffs', 'tense');
  const it = await d.actor('itsuki');
  const sy = await d.actor('sayo');
  const mk = await d.actor('mikami');
  d.place('itsuki', -1, -12, 0);
  d.place('sayo', 1, -12, 0);
  d.place('mikami', 0, -15, 0);
  void d.walk('itsuki', -1, -5, 1.1);
  void d.walk('sayo', 1.2, -5, 1.1);
  void d.walk('mikami', 0, -9, 1.0);
  await establish(d, [10, 7, -18], [6, 4, -12], [0, 2, 4], 6);
  d.audio.sfx('toll');
  await talk(d, [
    ['itsuki', 'The bell\'s so loud here I can barely think.', 'fear'],
    ['sayo', 'Then don\'t think. Watch my cranes and stay out of their way.', 'cold'],
    ['mikami', 'I\'ll be back here watching your backs. Mostly your backs.', 'tired', 'c'],
    ['itsuki', 'You\'re not fighting?', 'surprised'],
    ['mikami', 'I\'m teaching. Teaching looks a lot like standing still.', 'smile'],
  ]);
  await d.battle({
    player: 'itsuki', intro: 'THE CHAPEL', introSub: '礼拝堂',
    fighters: [player('itsuki', 'itsuki', -1, -4, { energy: 60 }), { id: 'sayo', model: 'sayo', kit: 'sayo', team: 0, pos: [1, -4], ai: 'ally' },
      grunt('g1', 'mudhand', 'mudhand', -3, 4), grunt('g2', 'mudhand', 'mudhand', 3, 4), grunt('g3', 'mudhand', 'mudhand', 0, 6)],
    waves: [[grunt('g4', 'mudhand', 'mudhand', -4, 5, 220), grunt('g5', 'mudhand', 'mudhand', 4, 5, 220), grunt('g6', 'mudhand', 'mudhand', 0, 7, 220)]],
  });
  if (d.quit) return;
  // --- her memory -------------------------------------------------------------------------------------
  const br = await d.actor('bride', 'bride');
  d.place('bride', 0, 13, Math.PI);
  br.anim.play('stand', 0);
  d.hide('itsuki');
  d.hide('sayo');
  d.hide('mikami');
  d.flashback(true, 0.0);
  d.music('memory');
  d.shot([4, 1.6, 6], [0, 2.2, 13], 0.55);
  await talk(d, [
    ['narrator', 'Forty years ago, a woman stood at this altar in a white kimono, and waited.', undefined, 'n'],
    ['narrator', 'The guests went home at noon. The priest at dusk. She waited until the candles burned down.', undefined, 'n'],
    ['bride', 'He said he would come. He said, wait for me. So I waited.', 'sad', 'w'],
    ['narrator', 'When the tide came in that night, she walked out to meet it.', undefined, 'n'],
  ]);
  br.anim.play('hover', 0.5);
  await d.fade(true, 1);
  d.flashback(false);
  it.setVisible(true);
  sy.setVisible(true);
  mk.setVisible(true);
  d.place('itsuki', -1, -2, 0);
  d.place('sayo', 1.4, -2, 0);
  d.place('bride', 0, 8, Math.PI);
  d.music('boss');
  await d.fade(false, 0.8);
  d.shot([0, 1.2, -6], [0, 2.4, 8], 0.65);
  await talk(d, [
    ['bride', 'Is it you? Did you finally come?', 'sad', 'w'],
    ['itsuki', 'I\'m not him. I\'m sorry.', 'sad', 'c'],
    ['bride', 'THEN WHY ARE YOU HERE?!', 'shout', 'w'],
  ]);
  await d.battle({
    player: 'itsuki', intro: 'THE WEEPING BRIDE', introSub: '泣き花嫁',
    fighters: [player('itsuki', 'itsuki', -1, -3, { energy: 70, domain: 50 }), { id: 'sayo', model: 'sayo', kit: 'sayo', team: 0, pos: [1.5, -3], ai: 'ally' },
      { id: 'bride', model: 'bride', kit: 'bride', team: 1, pos: [0, 6], ai: 'boss', health: 1400 }],
  });
  if (d.quit) return;
  // --- release -----------------------------------------------------------------------------------------
  d.music('sad');
  br.setVisible(true);
  d.place('bride', 0, 3, Math.PI);
  br.anim.play('kneel', 0.2);
  d.place('itsuki', 0, 0.8, 0);
  it.anim.play('stand', 0.2);
  d.closeUp('bride', 0.4, 2.2, 0.55);
  await talk(d, [
    ['bride', 'He never came... I waited and waited and he never came...', 'grief', 'w'],
    ['itsuki', 'I know. I know what waiting does.', 'sad', 'c'],
    ['itsuki', 'It wasn\'t your fault. You can stop waiting now.', 'gentle', 'c'],
    ['bride', '...Stop... waiting...', 'sad', 'w'],
  ]);
  br.look.energy.set(0, 1, 0, 0.01);
  await d.task((dt) => {
    br.look.energy.w = Math.min(1, br.look.energy.w + dt * 0.45);
    return br.look.energy.w >= 1;
  });
  d.hide('bride');
  // --- a lantern --------------------------------------------------------------------------------------
  const sj = await d.actor('sojin');
  d.place('sojin', -8, 15, Math.PI * 0.8);
  sj.anim.play('stand', 0);
  d.fx.sprites.spawn({ kind: 9, pos: new Vector3(0, 2.5, 3), size: 0.9, color: PAL[3].body, intensity: 1.6, life: 3, vel: new Vector3(-2.6, 1.4, 4) });
  d.shot([-4, 2, 6], [-8, 2.5, 15], 0.5);
  await talk(d, [
    ['sojin', 'Forty years of waiting. Grief this old shouldn\'t be wasted.', 'cold', 'w'],
    ['itsuki', 'Who the hell are you?!', 'angry', 'c'],
    ['sojin', 'Someone who keeps what the world throws away. Good night, bell-ringer.', 'gentle', 'w'],
  ]);
  d.hide('sojin');
  d.burst('sojin', PAL[3].body, 2);
  d.place('mikami', 2, -2, 0.2);
  d.closeUp('mikami', 0.3, 1.2, 0.5);
  await talk(d, [
    ['mikami', '...Sōjin.', 'fear', 'w'],
    ['sayo', 'Sensei? You know him?', 'surprised'],
    ['mikami', 'Once. A long time ago. Back when I still thought standing still was the same as being loyal.', 'sad'],
  ]);
  await d.fade(true, 1.5);
}

// =====================================================================================================
// CHAPTER THREE — UNDERPASS
// =====================================================================================================

async function underpass(d: Director): Promise<void> {
  await open(d, 'subway', 'CHAPTER THREE', 'Underpass', 'Shinjuku line · the last train', 'tense');
  const it = await d.actor('itsuki');
  const sy = await d.actor('sayo');
  d.place('itsuki', -2, -4, 0.4);
  d.place('sayo', 0, -5, 0.1);
  it.anim.play('stand', 0);
  sy.anim.play('arms_crossed', 0);
  await establish(d, [-20, 3, -6], [-12, 2.6, -4], [0, 1.6, 0], 5);
  await talk(d, [
    ['sayo', 'Eleven people missing from this platform in a month. All after the last train.', 'cold'],
    ['itsuki', 'And not a single curse on the cameras.', 'determined'],
    ['sayo', 'Because it isn\'t a curse taking them.', 'fear'],
  ]);
  const ry = await d.actor('ryoga');
  d.place('ryoga', 3, 6, Math.PI);
  ry.anim.play('stand', 0);
  d.audio.sfx('gravity');
  d.shot([1, 0.8, -1], 'ryoga', 0.55);
  await talk(d, [
    ['ryoga', 'Not a curse. A collector.', 'smile', 'w'],
    ['ryoga', 'So you\'re the bell boy. Sensei said I\'d hear you coming. He didn\'t say you\'d be this loud.', 'smile'],
    ['itsuki', 'Your sensei talks a lot about me for someone I\'ve never met.', 'angry'],
    ['ryoga', 'He talks about everyone who matters. You\'re lucky you matter.', 'cold'],
    ['sayo', 'White uniform. Violet energy. Ryōga Hoshino, the one the council\'s been hunting.', 'cold'],
    ['ryoga', 'Hunting is a strong word for running in circles. Shall we?', 'smile'],
  ]);
  await d.battle({
    player: 'itsuki', intro: 'RYŌGA HOSHINO', introSub: '星野 凌牙', canLose: true,
    fighters: [player('itsuki', 'itsuki', 0, -4, { energy: 60, domain: 40 }), { id: 'ryoga', model: 'ryoga', kit: 'ryoga', team: 1, pos: [0, 4], ai: 'rival', health: 1100 }],
    until: { id: 'ryoga', hp: 0.25 },
  });
  if (d.quit) return;
  d.place('itsuki', -1, -1, 0);
  d.place('ryoga', 1, 2.5, Math.PI);
  ry.anim.play('hurt', 0.2);
  it.anim.play('idle_fight', 0.2);
  await talk(d, [
    ['ryoga', 'Ha... you hit like a funeral bell.', 'pain'],
    ['itsuki', 'Where are the eleven people?', 'angry'],
  ]);
  const sj = await d.actor('sojin');
  const mk = await d.actor('mikami');
  d.place('sojin', 0, 8, Math.PI);
  sj.anim.play('stand', 0);
  d.burst('sojin', PAL[3].body, 3);
  d.music('boss');
  d.shot([0, 0.6, 2], [0, 2.2, 8], 0.5);
  await talk(d, [
    ['sojin', 'They\'re safe. Their grief is safe. Both are more than this city ever gave them.', 'cold', 'w'],
    ['ryoga', 'Sensei.', 'gentle'],
    ['sojin', 'You did well, Ryōga. Stand behind me.', 'gentle'],
  ]);
  d.place('mikami', -3, -6, 0.4);
  mk.anim.play('stand', 0);
  await d.walk('mikami', -1.5, -3, 1.6);
  d.look('mikami', 'sojin');
  d.look('sojin', 'mikami');
  await talk(d, [
    ['mikami', 'Sōjin.', 'cold'],
    ['sojin', 'Genjirō. You\'ve got old.', 'gentle'],
    ['mikami', 'One of us had to. Give the people back.', 'angry'],
    ['sojin', 'You still say "give back" as if anyone ever gave anything back to us.', 'cold'],
    ['sojin', 'Twenty years, and you\'re still standing where the council told you to stand.', 'cold'],
    ['sojin', 'You stayed put then, too.', 'angry', 'c'],
    ['mikami', '...', 'sad', 'c'],
    ['sojin', 'On the night of the lanterns, this city will finally grieve properly. You should come and watch.', 'smile'],
  ]);
  d.burst('sojin', PAL[3].body, 4);
  d.hide('sojin');
  d.hide('ryoga');
  d.fx.particles.burst({ kind: 1, pos: new Vector3(0, 1.5, 6), count: 120, speed: 5, spread: 1, color: [1, 0.3, 0.1, 1], size: [0.05, 0.1], life: [0.5, 1.5] });
  d.music('sad');
  await talk(d, [
    ['itsuki', 'Sensei. What did he mean? "You stayed put then, too"?', 'angry'],
    ['mikami', 'Tomorrow. I\'ll tell you both tomorrow. About a village called Amagiri.', 'tired'],
    ['sayo', 'Sensei—', 'sad'],
    ['mikami', 'Tomorrow, Sayo. Tonight I just want to remember him the way he was.', 'sad'],
  ]);
  await d.fade(true, 1.5);
  void it;
  void sy;
}

// =====================================================================================================
// CHAPTER FOUR — HINA (twenty years ago)
// =====================================================================================================

async function hina(d: Director): Promise<void> {
  await open(d, 'village', 'CHAPTER FOUR', 'Hina', 'Amagiri · twenty years ago', 'festival');
  d.flashback(true, 0.02);
  d.r.post.settings.flashbackPaper = 0.5;
  d.r.post.settings.flashbackHalftone = 0.15;
  const sj = await d.actor('sojin_young');
  const hn = await d.actor('hina');
  d.place('sojin_young', 0, -4, 0);
  d.place('hina', 0.9, -3.5, 0);
  sj.anim.play('stand', 0);
  hn.anim.play('stand', 0);
  hn.face.set('smile');
  void d.walk('sojin_young', 0, 2, 0.9);
  void d.walk('hina', 0.9, 2.5, 0.9);
  await establish(d, [-10, 5, -14], [-6, 3, -6], [0, 2.5, 4], 6);
  d.look('sojin_young', 'hina');
  d.look('hina', 'sojin_young');
  hn.anim.play('point', 0.3);
  await talk(d, [
    ['hina', 'Papa! Papa, look, the lanterns! They\'re so pretty!', 'smile'],
    ['sojin_young', 'They are. Do you know why we light them, Hina?', 'gentle'],
    ['hina', 'So the dead can find their way home!', 'smile'],
    ['sojin_young', 'That\'s right. Everyone who\'s gone gets a light, so nobody has to be lost in the dark.', 'gentle'],
    ['hina', 'When I\'m old, will you light one for me?', 'gentle'],
    ['sojin_young', 'When you\'re very, very old. And I\'ll be long gone by then, so you\'ll have to light mine first.', 'smile'],
    ['hina', 'Okay! I\'ll make yours the biggest one!', 'smile'],
  ]);
  const mk = await d.actor('mikami_young', 'mikami');
  d.place('mikami_young', -3, 6, Math.PI);
  mk.anim.play('stand', 0);
  await d.walk('mikami_young', -1.5, 3.8, 1.2);
  d.look('mikami_young', 'sojin_young');
  d.look('sojin_young', 'mikami_young');
  await talk(d, [
    ['mikami_young', 'Sōjin. Sorry I\'m late. The council kept me.', 'tired'],
    ['sojin_young', 'Genjirō. Did they read my report? The curse signs on the north ridge?', 'fear'],
    ['mikami_young', 'They read it. They said they\'ll send people next week.', 'sad'],
    ['sojin_young', 'Next week. This village defied the Kurose clan over the dam, and now help comes "next week".', 'angry'],
    ['mikami_young', 'I know. I\'ll be on the ridge with you. Whatever comes, two of us is enough.', 'determined'],
    ['hina', 'Uncle Genjirō! Do you want a candy apple?', 'smile'],
    ['mikami_young', 'Always, princess.', 'smile'],
  ]);
  d.audio.sfx('select');
  await talk(d, [
    ['mikami_young', '...Orders. The council wants me back at headquarters. Tonight.', 'fear'],
    ['sojin_young', 'Tonight? Genjirō, the ridge—', 'fear'],
    ['mikami_young', 'I\'ll argue. I\'ll come straight back. I promise.', 'determined'],
  ]);
  void d.walk('mikami_young', -6, 10, 1.6);
  await d.wait(1.5);
  d.hide('mikami_young');
  // --- the night they came ----------------------------------------------------------------------------
  d.music('boss');
  d.r.sky.mood = { ...d.r.sky.mood, festival: 1.6 };
  d.audio.sfx('toll');
  d.hide('hina');
  d.place('sojin_young', 0, -2, 0);
  d.shot([0, 1, -6], [0, 2.4, 8], 0.7);
  await talk(d, [
    ['sojin_young', 'They\'re coming down the ridge. Dozens of them. Hundreds.', 'fear', 'w'],
    ['sojin_young', 'Hina, go home! Lock the door and don\'t open it for anyone but me!', 'shout'],
    ['hina', 'Papa?!', 'fear', 'n'],
    ['sojin_young', 'Genjirō will come. Genjirō will come back. I just have to hold until then.', 'determined', 'h'],
  ]);
  const swarm = (n: number, wave: number): FighterSpec[] => Array.from({ length: n }, (_, i) =>
    grunt(`s${wave}_${i}`, i % 3 === 2 ? 'acolyte' : 'mudhand', i % 3 === 2 ? 'acolyte' : 'mudhand', Math.cos(i * 2.1) * 6, 6 + Math.sin(i * 1.7) * 3, 200));
  await d.battle({
    player: 'sojin_young', intro: 'HOLD THE LINE', introSub: '二十年前', canLose: false, survive: 75,
    fighters: [player('sojin_young', 'sojin_young', 0, -2, { energy: 100, health: 1300 }), ...swarm(3, 0)],
    waves: [swarm(4, 1), swarm(4, 2), swarm(5, 3), swarm(5, 4), swarm(6, 5)],
  });
  if (d.quit) return;
  // --- home ----------------------------------------------------------------------------------------------
  await d.fade(true, 1.2);
  await d.setStage('village_burning');
  d.flashback(true, 0.02);
  d.music('memory');
  d.place('sojin_young', -2, -3, 0.6);
  d.place('hina', 0, 0, 0);
  hn.setVisible(true);
  hn.anim.play('down', 0);
  hn.face.set('closed');
  sj.anim.play('walk_sad', 0);
  await d.fade(false, 1.5);
  await d.walk('sojin_young', -0.4, -0.7, 0.8, 'walk_sad');
  sj.anim.play('kneel_grief', 0.4);
  d.closeUp('sojin_young', 0.6, 1.3, 0.5);
  await talk(d, [
    ['sojin_young', 'Hina... Hina, I\'m here. Papa\'s here. Look at me.', 'grief', 'c'],
    ['hina', 'Papa... I opened the door... I thought it was you...', 'grief', 'w'],
    ['sojin_young', 'It\'s alright. It\'s alright. Stay with me.', 'grief'],
    ['hina', 'Papa... the lanterns... are pretty...', 'gentle', 'w'],
  ]);
  hn.face.set('closed');
  await d.wait(2);
  await talk(d, [
    ['sojin_young', 'Hina...? Hina!', 'grief', 'c'],
  ]);
  d.r.post.settings.desatPulse = 0.9;
  await d.wait(1.5);
  const mk2 = d.get('mikami_young');
  mk2.setVisible(true);
  d.place('mikami_young', -6, -8, 0.6);
  await d.walk('mikami_young', -3.5, -4.5, 2.2);
  await talk(d, [
    ['mikami_young', 'Sōjin... I— they ordered me to stay. I argued, I— I\'m sorry. I\'m so sorry.', 'grief'],
    ['sojin_young', 'You stayed.', 'grief', 'c'],
    ['mikami_young', 'I...', 'sad'],
    ['sojin_young', 'You stayed put.', 'angry', 'c'],
  ]);
  sj.anim.play('cast_raise', 0.3);
  d.aura('sojin_young', 1, 3);
  d.burst('sojin_young', PAL[3].body, 3);
  d.fx.sprites.spawn({ kind: 9, pos: d.at('sojin_young', 1.2), size: 1.2, color: PAL[3].body, intensity: 2, life: 6 });
  await talk(d, [
    ['narrator', 'That night Sōjin Amagiri swallowed the curse that killed his daughter, and it did not kill him.', undefined, 'n'],
    ['narrator', 'It became the first lantern.', undefined, 'n'],
    ['sojin_young', 'Then I\'ll keep them. Every grief this world throws away.', 'cold', 'c'],
    ['sojin_young', 'And one day the people who threw them away will carry every single one.', 'angry', 'c'],
  ]);
  await d.fade(true, 2);
  d.flashback(false);
  d.r.post.settings.flashbackPaper = 0.8;
  d.r.post.settings.flashbackHalftone = 0.3;
}

// =====================================================================================================
// CHAPTER FIVE — STILLWATER
// =====================================================================================================

async function stillwater(d: Director): Promise<void> {
  await open(d, 'academy_night', 'CHAPTER FIVE', 'Stillwater', 'Hakuro · the night of the attack', 'sad');
  const it = await d.actor('itsuki');
  const sy = await d.actor('sayo');
  const mk = await d.actor('mikami');
  d.place('mikami', 0, 2, Math.PI);
  d.place('itsuki', -1.2, -1, 0);
  d.place('sayo', 1.2, -1, 0);
  mk.anim.play('look_down', 0);
  it.anim.play('stand', 0);
  sy.anim.play('stand', 0);
  d.twoShot('mikami', 'itsuki', 4, 1.6);
  await talk(d, [
    ['mikami', 'That\'s the man we\'re fighting. Sōjin Amagiri. My partner. My friend.', 'sad'],
    ['mikami', 'I argued with the council for six hours that night. And then I did what they told me.', 'grief'],
    ['itsuki', 'You couldn\'t have known.', 'sad'],
    ['mikami', 'I knew. That\'s the part I can\'t put down, Itsuki. I knew, and I stayed put.', 'grief', 'c'],
    ['sayo', 'Sensei...', 'sad'],
  ]);
  d.audio.sfx('toll');
  d.music('boss');
  await talk(d, [
    ['mikami', '...The wards just broke. Both of you, inside. Now.', 'fear', 'c'],
    ['itsuki', 'We can fight!', 'angry'],
    ['mikami', 'I know you can. Tonight, let me.', 'determined', 'c'],
  ]);
  d.hide('itsuki');
  d.hide('sayo');
  const ac = (i: number, w: number): FighterSpec => grunt(`a${w}_${i}`, 'acolyte', 'acolyte', Math.cos(i * 2.4) * 7, Math.sin(i * 2.4) * 7, 260);
  await d.battle({
    player: 'mikami', intro: 'STILLWATER', introSub: '止水',
    fighters: [player('mikami', 'mikami', 0, 0, { energy: 80, domain: 60 }), ac(0, 0), ac(1, 0), ac(2, 0)],
    waves: [[ac(0, 1), ac(1, 1), ac(2, 1), ac(3, 1)], [{ id: 'umbrella2', model: 'umbrella', kit: 'umbrella', team: 1, pos: [0, 7], ai: 'boss', health: 900 }, ac(0, 2), ac(1, 2)]],
    tutorial: [{ html: 'You are Mikami. <kbd>I</kbd> <b>Still Point</b> slows every enemy inside the ripple. <kbd>P</kbd> unveils his domain when the gauge is full.', time: 12 }],
  });
  if (d.quit) return;
  const sj = await d.actor('sojin');
  d.place('sojin', 0, 9, Math.PI);
  d.place('mikami', 0, 0, 0);
  sj.anim.play('stand', 0);
  d.shot([3, 1.4, -4], [0, 2.2, 9], 0.6);
  await talk(d, [
    ['sojin', 'Genjirō. You came out to meet me. That\'s new.', 'gentle', 'w'],
    ['mikami', 'Twenty years late, but I\'m learning.', 'determined', 'c'],
    ['sojin', 'Step aside. I only want the bell boy. His grief is the purest I\'ve heard in years.', 'cold'],
    ['mikami', 'He\'s seventeen, Sōjin. He\'s Hina\'s age, if she\'d lived ten more years.', 'angry'],
    ['sojin', 'Don\'t you say her name.', 'angry', 'c'],
  ]);
  await d.battle({
    player: 'mikami', intro: 'SŌJIN AMAGIRI', introSub: '天霧 宗仁', canLose: false,
    fighters: [player('mikami', 'mikami', 0, -4, { energy: 100, domain: 100 }), { id: 'sojin', model: 'sojin', kit: 'sojin', team: 1, pos: [0, 5], ai: 'master', health: 1600, domain: 60 }],
    until: { id: 'sojin', hp: 0.55 }, survive: 120,
  });
  if (d.quit) return;
  // --- the domain clash and the end of Genjirō Mikami ------------------------------------------------------
  d.place('mikami', 0, -2, 0);
  d.place('sojin', 0, 4, Math.PI);
  mk.anim.play('idle_fight', 0.2);
  sj.anim.play('domain', 0.2);
  d.aura('sojin', 1, 3);
  d.closeUp('sojin', 0.3, 1.3);
  await talk(d, [
    ['sojin', 'Domain Unveiling.', 'cold', 'w'],
    ['sojin', 'Night Parade Without End.', 'angry', 'w'],
  ]);
  d.domain.show(3, d.get('sojin').position.clone());
  d.r.post.settings.domainActive = 1;
  d.r.post.settings.domainCenter.copyFrom(d.get('sojin').position);
  await d.task((dt) => {
    d.domain.reveal = Math.min(1, d.domain.reveal + dt / 2);
    d.r.post.settings.domainProgress = d.domain.reveal;
    return d.domain.reveal >= 1;
  });
  mk.anim.play('domain', 0.2);
  d.aura('mikami', 1, 2);
  d.closeUp('mikami', -0.3, 1.3);
  await talk(d, [
    ['mikami', 'Then I\'ll answer you. One last time.', 'determined', 'w'],
    ['mikami', 'Domain Unveiling. Mirror Lake of Ten Thousand Moons.', 'determined', 'w'],
  ]);
  d.burst('mikami', PAL[2].core, 5);
  d.r.post.settings.domainTwist = 0.3;
  d.twoShot('mikami', 'sojin', 7, 1.7);
  // the two domains push against each other along a breaking seam; the Night Parade slowly wins
  await d.domainClash({ domain: 3, who: 'sojin', palette: 3 }, { domain: 2, who: 'mikami', palette: 2 }, 4.5,
    (t) => Math.sin(t * 14) * 0.25 + 0.35 - t * 1.1);
  d.r.post.settings.domainTwist = 0;
  d.domain.id = 3;
  d.fx.impactFrame(3, 0.15);
  d.domain.hide();
  d.r.post.settings.domainActive = 0;
  it.setVisible(true);
  sy.setVisible(true);
  d.place('itsuki', -4, -8, 0.3);
  d.place('sayo', -2.5, -8.5, 0.3);
  it.anim.play('run', 0);
  await talk(d, [
    ['itsuki', 'SENSEI!', 'shout', 'c'],
    ['mikami', 'Sayo. Take him and run.', 'pain', 'c'],
    ['sayo', 'No! We can—', 'grief'],
    ['mikami', 'Itsuki. Listen to me.', 'gentle', 'c'],
    ['mikami', 'Don\'t stay put. Not for me. Not for anyone. Not ever again.', 'gentle', 'c'],
  ]);
  mk.anim.play('cast_raise', 0.2);
  d.aura('mikami', 1, 2);
  d.burst('mikami', PAL[2].body, 6);
  d.r.post.settings.heatHaze = 0.8;
  d.fx.sprites.spawn({ kind: 16, pos: d.get('mikami').position.clone(), size: 16, color: PAL[2].body, intensity: 1.5, life: 4, mode: 1 });
  sj.anim.play('stun', 0.2);
  await talk(d, [
    ['mikami', 'Still Point. Everything stops. Even you, old friend.', 'determined', 'c'],
    ['sojin', 'Genjirō... you fool...', 'fear'],
  ]);
  for (let i = 0; i < 5; i++) d.fx.sprites.spawn({ kind: 9, pos: d.at('sojin', 1.1).add(new Vector3(Math.cos(i) * 1.5, Math.sin(i * 2) * 0.4, Math.sin(i) * 1.5)), size: 0.8, color: PAL[3].body, intensity: 2, life: 1.2, vel: d.at('mikami').subtract(d.at('sojin', 1.1)).scale(0.9) });
  await d.wait(1.0);
  d.fx.impactFrame(3, 0.2);
  d.audio.sfx('ko');
  mk.anim.play('defeat', 0.1);
  mk.face.set('tired');
  await d.wait(1.6);
  d.music('sad');
  d.closeUp('mikami', 0.5, 1.4, 0.45);
  await talk(d, [
    ['mikami', '...Huh. I finally didn\'t stay put.', 'gentle', 'w'],
    ['mikami', 'Tell Sōjin... the lanterns really were pretty.', 'closed', 'w'],
  ]);
  await d.wait(1.5);
  d.aura('mikami', 0);
  sj.anim.play('stand', 0.3);
  d.closeUp('sojin', 0.4, 1.6, 0.5);
  await talk(d, [
    ['sojin', 'You finally came out to meet me, Genjirō.', 'sad', 'w'],
    ['sojin', 'You were always too late. Even for this.', 'grief', 'w'],
  ]);
  d.shot([-5, 1.2, -11], [-3, 1.5, -8], 0.5);
  await talk(d, [
    ['itsuki', 'NOOOOO!', 'shout', 'w'],
  ]);
  await d.fade(true, 2.5);
  d.clearCast();
}

// =====================================================================================================
// CHAPTER SIX — THOUSAND FOLDS
// =====================================================================================================

async function folds(d: Director): Promise<void> {
  await open(d, 'estate', 'CHAPTER SIX', 'Thousand Folds', 'the Tachibana estate', 'tense');
  const sy = await d.actor('sayo');
  const el = await d.actor('elder', 'acolyte', { tint: [1.0, 0.92, 0.85] });
  d.place('sayo', 0, -8, 0);
  d.place('elder', 0, 8, Math.PI);
  el.anim.play('stand', 0);
  await d.walk('sayo', 0, 2, 1.1);
  sy.anim.play('stand', 0.3);
  await establish(d, [-12, 6, -18], [-8, 3, -6], [0, 1.6, 4], 4);
  await talk(d, [
    ['elder', 'The girl who left. Come back to beg?', 'cold'],
    ['sayo', 'Mikami-sensei is dead. Sōjin Amagiri is going to curse the whole city on the night of the lanterns.', 'determined'],
    ['sayo', 'I need the Tachibana seal. I need Shiragami\'s paper.', 'determined', 'c'],
    ['elder', 'Shiragami does not lend itself. It takes. You know this better than anyone.', 'cold'],
    ['sayo', 'Yes. I know exactly what it takes.', 'angry', 'c'],
  ]);
  d.music('memory');
  d.flashback(true, 0.97);
  const ko = await d.actor('kota');
  d.place('kota', 1, 6, Math.PI);
  ko.anim.play('stand', 0);
  ko.face.set('gentle');
  d.place('sayo', -0.5, 4, 0.3);
  d.closeUp('kota', 0.3, 1.2);
  await talk(d, [
    ['narrator', 'Ten years ago, the clan made a vow with its guardian. Shiragami would protect the Tachibana for a hundred years.', undefined, 'n'],
    ['narrator', 'The price was a child of the main line. A child "without cursed energy". A child the elders could spare.', undefined, 'n'],
    ['kota', 'Sayo, don\'t cry. It\'s only for a little while, they said.', 'gentle'],
    ['kota', 'I\'ll fold you a crane every day. Every single day. So you\'ll know I\'m still there.', 'smile'],
    ['narrator', 'The cranes stopped coming after the first week.', undefined, 'n'],
  ]);
  d.hide('kota');
  d.flashback(false);
  d.music('boss');
  d.place('sayo', 0, 0, 0);
  await talk(d, [
    ['elder', 'If you want Shiragami\'s paper, pass through its servants. And then through Shiragami.', 'cold'],
    ['sayo', 'Gladly.', 'determined', 'c'],
  ]);
  d.hide('elder');
  const servant = (i: number, w: number): FighterSpec => ({ ...grunt(`p${w}_${i}`, 'acolyte', 'acolyte', Math.cos(i * 2) * 6, 4 + Math.sin(i * 2) * 3, 240), opts: { tint: [1.2, 1.2, 1.15] } });
  await d.battle({
    player: 'sayo', intro: 'PAPER SERVANTS', introSub: '紙の従者',
    fighters: [player('sayo', 'sayo', 0, -3, { energy: 80 }), servant(0, 0), servant(1, 0), servant(2, 0)],
    waves: [[servant(0, 1), servant(1, 1), servant(2, 1), servant(3, 1)]],
    tutorial: [{ html: 'You are Sayo. <kbd>U</kbd> <b>Crane Volley</b> homes in; <kbd>I</kbd> <b>Paper Wolf</b> runs along the ground and launches.', time: 10 }],
  });
  if (d.quit) return;
  const sg = await d.actor('shiragami', 'shiragami');
  d.place('shiragami', 0, 9, Math.PI);
  sg.anim.play('hover', 0);
  d.shot([0, 0.5, -3], [0, 3.5, 9], 0.7);
  d.audio.sfx('paper');
  await talk(d, [
    ['shiragami', 'TACHIBANA. THE VOW STANDS. WHAT DO YOU OFFER.', undefined, 'w'],
    ['sayo', 'Nothing. I came to take something back.', 'angry', 'c'],
  ]);
  await d.battle({
    player: 'sayo', intro: 'SHIRAGAMI', introSub: '白紙神',
    fighters: [player('sayo', 'sayo', 0, -3, { energy: 100, domain: 70 }), { id: 'shiragami', model: 'shiragami', kit: 'shiragami', team: 1, pos: [0, 6], ai: 'boss', health: 1700 }],
  });
  if (d.quit) return;
  d.music('sad');
  sg.setVisible(true);
  d.place('shiragami', 0, 5, Math.PI);
  sg.anim.play('kneel', 0.3);
  sg.look.energy.set(0, 1, 0, 0.01);
  await d.task((dt) => {
    sg.look.energy.w = Math.min(1, sg.look.energy.w + dt * 0.4);
    return sg.look.energy.w >= 1;
  });
  d.hide('shiragami');
  for (let i = 0; i < 40; i++) d.fx.sprites.spawn({ kind: 8, pos: new Vector3((Math.random() - 0.5) * 6, 1 + Math.random() * 4, 4 + (Math.random() - 0.5) * 4), size: 0.4, color: [1, 1, 1], life: 4, vel: new Vector3(Math.random() - 0.5, 0.8, Math.random() - 0.5) });
  ko.setVisible(true);
  d.place('kota', 0, 2.5, Math.PI);
  ko.look.energy.set(0.6, 1, 0, 0);
  ko.anim.play('stand', 0);
  d.place('sayo', 0, 0, 0);
  sy.anim.play('kneel', 0.4);
  d.twoShot('sayo', 'kota', 3, 1.0);
  await talk(d, [
    ['kota', 'Sayo? Is that you? You got so tall.', 'smile'],
    ['sayo', 'Kōta... you stopped sending cranes. I waited and you stopped.', 'grief'],
    ['kota', 'I kept folding them. Shiragami kept them all. Thousands. I think it liked them.', 'gentle'],
    ['kota', 'It\'s alright now. Every crane you throw, I\'ll be in the wind behind it.', 'smile'],
    ['sayo', 'Don\'t go. Please. Not again.', 'grief', 'c'],
    ['kota', 'I\'m not going. I\'m just not staying in one place anymore. Isn\'t that better?', 'gentle'],
  ]);
  ko.look.energy.set(1, 1, 0, 0.01);
  await d.task((dt) => {
    ko.look.energy.w = Math.min(1, ko.look.energy.w + dt * 0.3);
    return ko.look.energy.w >= 1;
  });
  d.hide('kota');
  sy.anim.play('stand', 0.5);
  d.closeUp('sayo', 0.4);
  await talk(d, [
    ['sayo', '...Thank you, little brother.', 'gentle'],
    ['sayo', 'Itsuki. Wherever you are, don\'t you dare do this alone.', 'determined', 'h'],
  ]);
  await d.fade(true, 2);
  d.clearCast();
}

// =====================================================================================================
// CHAPTER SEVEN — MIO
// =====================================================================================================

async function mio(d: Director): Promise<void> {
  await open(d, 'alley', 'CHAPTER SEVEN', 'Mio', 'the bell that rang', 'memory');
  const it = await d.actor('itsuki');
  d.place('itsuki', 0, 0, 0);
  it.anim.play('kneel_grief', 0);
  it.face.set('grief');
  d.closeUp('itsuki', 0.4, 2.2, 0.55);
  await talk(d, [
    ['itsuki', 'Twenty minutes. I said twenty minutes.', 'grief', 'h'],
    ['itsuki', 'Mio waited. The bride waited. Sensei waited twenty years to stop standing still, and the day he did...', 'grief', 'h'],
    ['itsuki', 'Everyone I\'m late for dies waiting.', 'grief', 'h'],
  ]);
  d.audio.sfx('bell');
  await d.wait(1);
  d.audio.sfx('bell');
  await talk(d, [['itsuki', 'The bell... it\'s inside me. It was always inside me.', 'fear', 'h']]);
  await d.white(1.2);
  await d.setStage('apartment');
  const lb = await d.actor('littlebell', 'mio', { tint: [0.2, 0.15, 0.2] });
  d.place('littlebell', 0, 4, Math.PI);
  lb.anim.play('stand', 0);
  lb.look.energy.set(0.8, 0, 0, 0);
  d.place('itsuki', 0, -3, 0);
  it.anim.play('stand', 0);
  d.music('boss');
  d.shot([2, 1, -6], [0, 1.2, 4], 0.6);
  await talk(d, [
    ['littlebell', 'Onii-chan. You came home.', 'smile', 'w'],
    ['itsuki', 'You\'re not her. You\'re what I made out of her.', 'fear', 'c'],
    ['littlebell', 'I\'m everything you didn\'t do. Every night you went out to fight so you wouldn\'t have to come home.', 'cold', 'w'],
    ['littlebell', 'You promised. Twenty minutes. I\'ve been waiting three years. Stay with me now.', 'sad', 'w'],
    ['itsuki', 'I can\'t stay. Sensei told me not to stay put.', 'determined', 'c'],
    ['littlebell', 'THEN I\'LL MAKE YOU.', 'shout', 'w'],
  ]);
  await d.battle({
    player: 'itsuki', intro: 'THE LITTLE BELL', introSub: '小さな鈴', canLose: false,
    fighters: [player('itsuki', 'itsuki', 0, -3, { energy: 80, domain: 60 }), { id: 'littlebell', model: 'mio', kit: 'littlebell', team: 1, pos: [0, 4], ai: 'boss', health: 1300, opts: { tint: [0.2, 0.15, 0.2] } }],
    until: { id: 'littlebell', hp: 0.2 }, survive: 150,
  });
  if (d.quit) return;
  d.music('memory');
  d.place('littlebell', 0, 2, Math.PI);
  lb.anim.play('cry', 0.2);
  d.place('itsuki', 0, -0.5, 0);
  it.anim.play('stand', 0.3);
  await talk(d, [
    ['littlebell', 'Why won\'t you stay... why won\'t anyone ever stay...', 'grief', 'w'],
    ['itsuki', '...I\'m not going to fight you anymore.', 'sad', 'c'],
  ]);
  await d.walk('itsuki', 0, 1.3, 0.7);
  it.anim.play('embrace', 0.4);
  lb.anim.play('stand', 0.4);
  d.twoShot('itsuki', 'littlebell', 2.4, 1.2);
  d.dof(2.4, 0.8);
  await talk(d, [
    ['itsuki', 'I\'m sorry I was late. I\'m sorry I didn\'t come home.', 'grief'],
    ['itsuki', 'I\'m sorry you waited alone in the dark with your little bell, and nobody came.', 'grief'],
    ['itsuki', 'It wasn\'t your job to wait. It was mine to come. I\'m here now.', 'grief'],
  ]);
  d.flashback(true, 0.0);
  await talk(d, [
    ['mio', '"Onii-chan. I rang the bell so you\'d find me."', undefined, 'n'],
    ['mio', '"And you did. You keep finding me. Every time you hear it."', undefined, 'n'],
    ['mio', '"So stop being sad about being late. You\'re never late now."', undefined, 'n'],
  ]);
  d.flashback(false);
  lb.look.energy.set(1, 0, 0, 0.01);
  d.burst('littlebell', PAL[0].body, 4);
  await d.task((dt) => {
    lb.look.energy.w = Math.min(1, lb.look.energy.w + dt * 0.35);
    return lb.look.energy.w >= 1;
  });
  d.hide('littlebell');
  d.fx.particles.burst({ kind: 9, pos: d.at('itsuki', 0.7), count: 200, speed: 3, spread: 1, up: 2, color: [1, 0.8, 0.35, 1], size: [0.04, 0.09], life: [1, 3] });
  it.anim.play('stand', 0.5);
  d.aura('itsuki', 0.8, 0);
  d.closeUp('itsuki', 0.3);
  await talk(d, [
    ['itsuki', 'Hollow Bell was never a curse.', 'gentle'],
    ['itsuki', 'It\'s her. Telling me where to go.', 'determined'],
    ['narrator', 'Domain unlocked: Temple of the Unrung Bell.', undefined, 'n'],
  ]);
  d.aura('itsuki', 0);
  await d.fade(true, 2);
  d.clearCast();
}

// =====================================================================================================
// CHAPTER EIGHT — GRAVEBRAND
// =====================================================================================================

async function gravebrand(d: Director): Promise<void> {
  await open(d, 'crossing', 'CHAPTER EIGHT', 'Gravebrand', 'Shinjuku · the night of the lanterns', 'finale');
  const it = await d.actor('itsuki');
  await d.actor('sayo');
  d.place('itsuki', -1, -10, 0);
  d.place('sayo', 1, -10, 0);
  void d.walk('itsuki', -1, -4, 1.5);
  void d.walk('sayo', 1, -4, 1.5);
  await establish(d, [-16, 3, -20], [-10, 8, -14], [0, 6, 20], 6);
  await talk(d, [
    ['sayo', 'The whole sky is bleeding.', 'fear'],
    ['itsuki', 'He\'s pulling every grief in Tokyo into that tower. I can hear all of them ringing.', 'fear'],
    ['sayo', 'You came back different. Calmer.', 'gentle'],
    ['itsuki', 'I stopped running from the bell. You came back different too.', 'gentle'],
    ['sayo', 'I stopped waiting for cranes.', 'smile'],
    ['itsuki', 'Then let\'s go and be late for nothing.', 'determined', 'c'],
  ]);
  const ac = (i: number, w: number): FighterSpec => grunt(`c${w}_${i}`, i % 2 ? 'acolyte' : 'mudhand', i % 2 ? 'acolyte' : 'mudhand', Math.cos(i * 1.9) * 7, 3 + Math.sin(i * 1.9) * 5, 260);
  await d.battle({
    player: 'itsuki', intro: 'THE NIGHT OF LANTERNS', introSub: '灯籠の夜',
    fighters: [player('itsuki', 'itsuki', -1, -4, { energy: 80, domain: 60 }), { id: 'sayo', model: 'sayo', kit: 'sayo', team: 0, pos: [1, -4], ai: 'ally' }, ac(0, 0), ac(1, 0), ac(2, 0), ac(3, 0)],
    waves: [[ac(0, 1), ac(1, 1), ac(2, 1), ac(3, 1), ac(4, 1)]],
  });
  if (d.quit) return;
  const ry = await d.actor('ryoga');
  d.place('ryoga', 0, 7, Math.PI);
  ry.anim.play('stand', 0);
  d.place('itsuki', -1, -1, 0);
  d.place('sayo', 1.2, -1.5, 0);
  d.shot([1, 0.8, -3], 'ryoga', 0.55);
  await talk(d, [
    ['ryoga', 'Bell boy. I hoped you\'d stay home tonight.', 'sad', 'w'],
    ['itsuki', 'He killed Mikami-sensei, Ryōga.', 'angry', 'c'],
    ['ryoga', 'I know. I was there. I watched your teacher smile when he died. I\'ve never seen anyone do that.', 'sad'],
    ['ryoga', 'Sensei saved me when I was seven. A curse had my whole family, and he walked out of the fire carrying me.', 'gentle'],
    ['ryoga', 'Whatever he is, I owe him everything. So you don\'t go up that tower.', 'determined'],
  ]);
  await d.battle({
    player: 'itsuki', intro: 'GRAVEBRAND', introSub: '墓標', canLose: true,
    fighters: [player('itsuki', 'itsuki', 0, -4, { energy: 70, domain: 60 }), { id: 'ryoga', model: 'ryoga', kit: 'ryoga', team: 1, pos: [0, 4], ai: 'master', health: 1300 }],
    until: { id: 'ryoga', hp: 0.2 },
  });
  if (d.quit) return;
  d.place('ryoga', 0.5, 2, Math.PI);
  ry.anim.play('kneel', 0.2);
  d.place('itsuki', -0.5, -0.5, 0);
  it.anim.play('stand', 0.2);
  const sj = await d.actor('sojin');
  d.place('sojin', 0, 30, Math.PI);
  sj.setVisible(false);
  await talk(d, [
    ['sojin', '"Ryōga. It\'s time. Come up to me."', undefined, 'n'],
    ['ryoga', 'Sensei? I held them, I—', 'fear', 'c'],
    ['sojin', '"Every grief needs a heart to live in. I raised you to be that heart."', undefined, 'n'],
    ['sojin', '"Thirteen years I fed you my lanterns, a little at a time, so your body would bear it. Come and be the vessel, my son."', undefined, 'n'],
    ['ryoga', 'Vessel...?', 'fear', 'c'],
    ['ryoga', 'All this time... the medicine. The training. The "you\'re special, Ryōga"...', 'grief', 'c'],
  ]);
  d.look('itsuki', 'ryoga');
  await talk(d, [
    ['itsuki', 'He\'s doing to you what the council did to him. Spending someone he loves because it\'s convenient.', 'sad'],
    ['itsuki', 'You don\'t owe anyone your whole life, Ryōga. Not even the person who saved it.', 'gentle', 'c'],
  ]);
  ry.anim.play('stand', 0.5);
  await talk(d, [
    ['ryoga', '...Go. I\'ll hold the acolytes at the bottom of the tower.', 'determined'],
    ['ryoga', 'Go break his vow, Bell Boy. Tell him... tell him I said thank you. And no.', 'sad', 'c'],
  ]);
  await d.fade(true, 1.5);
  d.clearCast();
}

// =====================================================================================================
// CHAPTER NINE — VOWBREAKER
// =====================================================================================================

async function vowbreaker(d: Director): Promise<void> {
  await open(d, 'tower', 'CHAPTER NINE', 'Vowbreaker', 'the top of the lantern tower', 'finale');
  const it = await d.actor('itsuki');
  const sy = await d.actor('sayo');
  const sj = await d.actor('sojin');
  d.place('sojin', 0, 6, Math.PI);
  sj.anim.play('stand', 0);
  d.place('itsuki', -0.8, -4, 0);
  d.place('sayo', 1.2, -4.5, 0);
  d.aura('sojin', 0.6, 3);
  await establish(d, [10, 2, -10], [6, 3, -6], [0, 2, 6], 4);
  await talk(d, [
    ['sojin', 'Itsuki Kagari. The boy whose grief sounds like a bell.', 'gentle'],
    ['itsuki', 'Ryōga said thank you. And no.', 'determined', 'c'],
    ['sojin', '...Did he. Then I\'ll need a new heart for all of this.', 'sad'],
    ['sojin', 'Listen to them, Itsuki. A whole city of people who lost someone and were told to get over it.', 'cold'],
    ['sojin', 'I\'m giving their grief a master. Something big enough to hold it. Something that will make the world kneel and finally apologise.', 'angry'],
    ['itsuki', 'Grief doesn\'t need a master. It\'s just love with nowhere left to go.', 'determined', 'c'],
    ['itsuki', 'You don\'t fix it by making it bigger. You fix it by letting it ring.', 'determined', 'c'],
    ['sojin', 'Pretty words from a child who\'s lost one sister.', 'angry'],
    ['sayo', 'And a teacher. And a brother. Count properly.', 'angry', 'c'],
  ]);
  await d.battle({
    player: 'itsuki', intro: 'SŌJIN AMAGIRI', introSub: '最終決戦',
    fighters: [player('itsuki', 'itsuki', -0.8, -4, { energy: 100, domain: 70 }), { id: 'sayo', model: 'sayo', kit: 'sayo', team: 0, pos: [1.5, -4.5], ai: 'ally' },
      { id: 'sojin', model: 'sojin', kit: 'sojin', team: 1, pos: [0, 5], ai: 'master', health: 2000 }],
    until: { id: 'sojin', hp: 0.5 },
  });
  if (d.quit) return;
  // --- his domain -------------------------------------------------------------------------------------------
  d.place('sojin', 0, 4, Math.PI);
  sj.anim.play('domain', 0.2);
  d.aura('sojin', 1, 3);
  d.hide('sayo');
  d.closeUp('sojin', 0.3, 1.3);
  await talk(d, [
    ['sojin', 'Domain Unveiling.', 'cold', 'w'],
    ['sojin', 'Night Parade Without End.', 'shout', 'w'],
  ]);
  d.domain.show(3, d.get('sojin').position.clone());
  await d.task((dt) => {
    d.domain.reveal = Math.min(1, d.domain.reveal + dt / 2);
    return d.domain.reveal >= 1;
  });
  d.place('itsuki', 0, -3, 0);
  d.closeUp('itsuki', 0.3, 1.3);
  await talk(d, [
    ['itsuki', 'Sayo\'s outside. It\'s just us in here, isn\'t it.', 'determined'],
    ['sojin', 'Just us, and every lantern I ever lit.', 'cold'],
    ['itsuki', 'Then I\'ll ring them out. Every one.', 'determined', 'c'],
  ]);
  await d.battle({
    player: 'itsuki', intro: 'NIGHT PARADE WITHOUT END', introSub: '百夜行', canLose: true,
    fighters: [player('itsuki', 'itsuki', 0, -3, { energy: 100, domain: 100 }), { id: 'sojin', model: 'sojin', kit: 'sojin', team: 1, pos: [0, 4], ai: 'master', health: 1300, power: 1.15 }],
    tutorial: [{ html: 'Your domain is ready. Press <kbd>P</kbd>: <b>Temple of the Unrung Bell</b>. Below a third of your health, <kbd>Y</kbd> swears a Vow.', time: 10 }],
  });
  if (d.quit) return;
  d.endDomain();
  // --- the lanterns go home -----------------------------------------------------------------------------------
  d.music('sad');
  sy.setVisible(true);
  d.place('sayo', 3, -3, -0.5);
  d.place('sojin', 0, 2, Math.PI);
  sj.anim.play('kneel', 0.3);
  sj.face.set('tired');
  d.place('itsuki', 0, -0.5, 0);
  it.anim.play('stand', 0.3);
  d.closeUp('sojin', 0.5, 1.5, 0.5);
  await talk(d, [
    ['sojin', 'Twenty years... and a boy with a bell...', 'tired'],
    ['sojin', 'I swore I\'d make them carry it. Every grief. Every one.', 'grief'],
    ['itsuki', 'That vow\'s broken. You can put it down now.', 'gentle', 'c'],
  ]);
  const hn = await d.actor('hina');
  d.place('hina', -0.6, 4, Math.PI);
  hn.look.energy.set(0.7, 3, 0, 0);
  hn.anim.play('stand', 0);
  hn.face.set('smile');
  d.fx.sprites.spawn({ kind: 9, pos: d.at('sojin', 1.3), size: 1.4, color: PAL[3].core, intensity: 2, life: 2.5, vel: new Vector3(-0.2, 0.4, 0.8) });
  d.twoShot('sojin', 'hina', 3.4, 1.1);
  await talk(d, [
    ['hina', 'Papa.', 'smile'],
    ['sojin', 'Hina...? No. No, you\'re another lantern. You\'re just another—', 'fear'],
    ['hina', 'You kept me in the first one. The whole time. It was warm in there.', 'gentle'],
    ['sojin', 'I wasn\'t there. I was on the ridge. I wasn\'t there when you opened the door.', 'grief', 'c'],
    ['hina', 'You were. You\'ve been holding my light for twenty years. That\'s being there, Papa.', 'gentle'],
    ['hina', 'Look. They\'re all going home now. Aren\'t they pretty?', 'smile'],
  ]);
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 14;
    d.fx.sprites.spawn({ kind: 9, pos: new Vector3(Math.cos(a) * r, 0.5 + Math.random() * 3, Math.sin(a) * r), size: 0.5 + Math.random() * 0.6,
      color: PAL[0].body, intensity: 1.5, life: 6 + Math.random() * 3, vel: new Vector3(0, 1.2 + Math.random(), 0) });
  }
  d.shot([0, 0.6, -6], [0, 6, 10], 0.9);
  await d.wait(2.5);
  // the sky clears to dawn
  d.r.sky.mood = { ...d.r.sky.mood, cursed: 0.2 };
  d.r.lighting.sunColor = new Color3(1.4, 0.95, 0.7);
  d.closeUp('sojin', 0.5, 1.5, 0.5);
  await talk(d, [
    ['sojin', '...They are. They\'re very pretty, Hina.', 'gentle'],
    ['sojin', 'Itsuki. Tell Genjirō\'s grave I\'m sorry I called him late.', 'tired'],
    ['itsuki', 'Tell him yourself. I think you\'ll get there first.', 'sad', 'c'],
    ['sojin', 'Ha... Vowbreaker. You\'re a cruel boy.', 'smile'],
  ]);
  sj.anim.play('defeat', 0.5);
  sj.face.set('closed');
  hn.look.energy.set(1, 3, 0, 0.01);
  await d.task((dt) => {
    hn.look.energy.w = Math.min(1, hn.look.energy.w + dt * 0.3);
    return hn.look.energy.w >= 1;
  });
  d.hide('hina');
  await d.wait(1.5);
  await d.fade(true, 3);
  d.clearCast();
}

// =====================================================================================================
// EPILOGUE — SPRING
// =====================================================================================================

async function spring(d: Director): Promise<void> {
  await open(d, 'graves', 'EPILOGUE', 'Spring', 'the hill above Shiomi', 'calm');
  const it = await d.actor('itsuki');
  d.place('itsuki', 0, -4, 0);
  void d.walk('itsuki', 0, 0.8, 0.9, 'walk_sad');
  await establish(d, [-12, 4, -14], [-6, 2.5, -6], [0, 1.4, 3], 6);
  it.anim.play('stand', 0.3);
  d.look('itsuki', [3.5, 2.5]);
  await talk(d, [
    ['itsuki', 'Hey, Mio. Sorry. I\'m late again.', 'smile', 'c'],
    ['itsuki', 'Not by much, this time.', 'gentle'],
  ]);
  d.look('itsuki', [-3.5, 2.5]);
  await talk(d, [
    ['itsuki', 'Sensei. They put you next to her. I hope you don\'t mind. She talks a lot.', 'gentle', 'c'],
    ['itsuki', 'I\'m not standing still anymore. Not for anyone.', 'determined'],
  ]);
  d.audio.sfx('bell');
  const sy = await d.actor('sayo');
  const ry = await d.actor('ryoga');
  d.place('sayo', -3, -8, 0);
  d.place('ryoga', 3, -8, 0);
  void d.walk('sayo', -1.4, -1.6, 1.1);
  await d.walk('ryoga', 1.6, -1.8, 1.1);
  d.look('itsuki', 'sayo');
  await talk(d, [
    ['sayo', 'You rang it again.', 'smile'],
    ['itsuki', 'Habit.', 'smile'],
    ['ryoga', 'The council wants to "evaluate" me. Ten years of probation, maybe.', 'smile'],
    ['itsuki', 'Better than being a vessel.', 'smile'],
    ['ryoga', 'Better than being alone. Sensei\'s lanterns are on the river tonight. Will you come?', 'gentle'],
    ['sayo', 'All three of us. Kōta likes crowds, now.', 'gentle'],
    ['itsuki', 'Yeah. Give me a minute.', 'gentle', 'c'],
  ]);
  void d.walk('sayo', -2, -10, 1.0);
  void d.walk('ryoga', 2, -10, 1.0);
  d.closeUp('itsuki', 0.3, 1.6, 0.5);
  await talk(d, [
    ['itsuki', 'Curses are made of grief. Of things we couldn\'t let go.', 'gentle', 'h'],
    ['itsuki', 'But grief is just love that\'s still looking for somewhere to go.', 'gentle', 'h'],
    ['itsuki', 'So I\'ll keep listening for the bell. And I\'ll keep going where it sends me.', 'determined', 'h'],
    ['itsuki', 'I won\'t be late.', 'smile'],
  ]);
  d.audio.sfx('bell');
  await d.rail({ pos: d.at('itsuki').add(new Vector3(0, 0.2, -2)), target: d.at('itsuki'), fov: 0.6 }, { pos: new Vector3(0, 14, -26), target: new Vector3(0, 2, 6), fov: 0.8 }, 7);
  await d.fade(true, 3);
  void sy;
  void ry;
  d.clearCast();
}

export const CHAPTERS: Chapter[] = [
  { num: 'PROLOGUE', title: 'The Bell That Didn\'t Ring', sub: 'Shiomi · three years later', run: prologue },
  { num: 'CHAPTER ONE', title: 'Hakuro', sub: 'the academy in the western hills', run: hakuro },
  { num: 'CHAPTER TWO', title: 'The Weeping Bride', sub: 'the chapel on the Shiomi cliffs', run: bride },
  { num: 'CHAPTER THREE', title: 'Underpass', sub: 'Shinjuku line · the last train', run: underpass },
  { num: 'CHAPTER FOUR', title: 'Hina', sub: 'Amagiri · twenty years ago', run: hina },
  { num: 'CHAPTER FIVE', title: 'Stillwater', sub: 'Hakuro · the night of the attack', run: stillwater },
  { num: 'CHAPTER SIX', title: 'Thousand Folds', sub: 'the Tachibana estate', run: folds },
  { num: 'CHAPTER SEVEN', title: 'Mio', sub: 'the bell that rang', run: mio },
  { num: 'CHAPTER EIGHT', title: 'Gravebrand', sub: 'Shinjuku · the night of the lanterns', run: gravebrand },
  { num: 'CHAPTER NINE', title: 'Vowbreaker', sub: 'the top of the lantern tower', run: vowbreaker },
  { num: 'EPILOGUE', title: 'Spring', sub: 'the hill above Shiomi', run: spring },
];
