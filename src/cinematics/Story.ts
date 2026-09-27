import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { AthleteProfile, Athlete } from '../game/Athlete';
import type { MatchConfig } from '../game/Match';
import { Shot } from './CinematicDirector';
import { Stage } from './Stage';
import { COACH } from '../data/campaign';
import { filler, KITS } from '../data/roster';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface StoryCtx {
  player: AthleteProfile;
}

/** Camera placement that frames two actors side by side. */
function twoShot(a: Athlete, b: Athlete, dist: number, side: number) {
  const mid = new THREE.Vector3().addVectors(a.pos, b.pos).multiplyScalar(0.5);
  const line = new THREE.Vector3().subVectors(b.pos, a.pos).setY(0).normalize();
  const perp = new THREE.Vector3(line.z, 0, -line.x);
  // pick the side that faces the court centre (more interesting background)
  if (perp.dot(mid) > 0) perp.negate();
  const pos = mid.clone().addScaledVector(perp, dist).addScaledVector(line, dist * side * 0.2);
  pos.y = 1.45;
  return { pos, look: new THREE.Vector3(mid.x, 1.3, mid.z) };
}

/** Generic pre-match presentation: establishing shot, opponents, then the player. */
export function matchIntroShots(game: Game, cfg: MatchConfig): Shot[] {
  const w = game.world;
  const m = w.match!;
  const hl = w.court.halfLength;
  const lead = m.away[0];
  const player = m.player ?? m.home[0];
  const arena = game.arena!;
  const opp = lead?.profile.title ?? cfg.subtitle ?? 'Opponents';
  const shots: Shot[] = [
    {
      dur: 2.2,
      pos: V(-hl * 0.9, 7.5, hl * 1.1),
      pos2: V(-hl * 0.4, 5.2, hl * 0.95),
      look: V(0, 0.5, 0),
      look2: V(0, 1, -2),
      fov: 50,
      title: { t1: arena.info.name, t2: cfg.title, t3: cfg.mode === 'survival' ? 'Survive every wave' : `vs ${opp}` },
      ease: 'inOutSine',
    },
  ];
  if (lead) {
    shots.push({
      dur: 1.9,
      pos: { at: lead, off: [-1.6, 1.4, 3.4] },
      pos2: { at: lead, off: [1.4, 1.5, 3.1] },
      look: { at: lead, off: [0, 1.3, 0] },
      fov: 42,
      dof: { range: 2.5, bokeh: 2.5 },
      onStart: () => {
        for (const a of m.away) a.anim.play(Math.random() < 0.5 ? 'point' : 'celebrate', { fade: 0.3 });
      },
    });
  }
  if (player) {
    shots.push({
      dur: 1.5,
      pos: { at: player, off: [0.9, 1.0, 2.6] },
      pos2: { at: player, off: [0.6, 1.7, -3.2] },
      look: { at: player, off: [0, 1.4, 0] },
      look2: V(0, 1.2, -hl * 0.5),
      fov: 46,
      fov2: 60,
      ease: 'inOutCubic',
    });
  }
  return shots;
}

/** Victory / defeat outro around the celebrating team. */
export function matchOutroShots(game: Game, won: boolean): Shot[] {
  const m = game.world.match!;
  const focus: Athlete | undefined = won ? (m.player && !m.player.isOut ? m.player : m.home.find((a) => !a.isOut)) : m.away.find((a) => !a.isOut);
  if (!focus) return [];
  const yaw = focus.yaw;
  return [
    {
      dur: 3.2,
      orbit: { center: { at: focus, off: [0, 1.2, 0] }, radius: 3.6, radius2: 3.0, height: 0.5, from: yaw + 0.5, to: yaw - 0.6 },
      look: { at: focus, off: [0, 1.35, 0] },
      fov: 44,
      dof: { range: 2.2, bokeh: 3 },
      title: won ? { t1: 'Match won', t2: 'Victory', t3: `${m.score[0]} – ${m.score[1]}` } : { t1: 'Match lost', t2: 'Defeat', t3: `${m.score[0]} – ${m.score[1]}` },
    },
  ];
}

/** Story cutscenes. Each builds its own stage (or uses the match roster) and resolves when done. */
export async function playStory(id: string, game: Game, ctx: StoryCtx): Promise<void> {
  const d = game.director;
  const w = game.world;
  const m = w.match;
  switch (id) {
    // ------------------------------------------------------------------ INTRO (standalone)
    case 'intro': {
      game.loadArena('rec');
      const st = new Stage(game);
      const p = st.spawn(ctx.player, 0, V(0.5, 0, 4.5), Math.PI);
      st.giveBall(p);
      st.play(p, 'ballSpin');
      const coach = st.spawn(COACH(), 0, V(5.5, 0, 16.5), Math.PI);
      game.cam.mode = 'cinematic';
      await d.play(
        [
          {
            dur: 4.2,
            pos: V(-10, 6.2, -13),
            pos2: V(-6.5, 4.2, -3),
            look: V(0, 0.6, 2),
            look2: V(0.4, 1.1, 4.2),
            fov: 50,
            title: { t1: 'Maplewood, Eastside · 6:40 AM', t2: 'Rec League', t3: 'Chapter 1' },
            subtitle: { text: 'Every legend starts somewhere.' },
          },
          {
            dur: 4,
            orbit: { center: { at: p, off: [0, 1.3, 0] }, radius: 3.4, radius2: 2.6, height: 0.2, from: Math.PI + 0.9, to: Math.PI - 0.5 },
            look: { at: p, off: [0, 1.4, 0] },
            fov: 42,
            dof: { range: 2, bokeh: 3 },
            subtitle: { text: 'For you it’s here. Scuffed floors. A busted scoreboard. A dream the size of a stadium.' },
            onStart: () => st.walk(coach, V(2.6, 0, 8), 0.34, Math.PI),
          },
          {
            dur: 3.4,
            pos: { at: p, off: [-0.6, 1.5, -2.2] },
            look: { at: coach, off: [0, 1.4, 0] },
            fov: 40,
            dof: { range: 3, bokeh: 2.5 },
            subtitle: { who: 'Coach Marla', text: 'Here before the lights again, rookie?' },
            onStart: () => {
              st.stopClip(p);
              p.faceYaw = Math.atan2(coach.pos.x - p.pos.x, coach.pos.z - p.pos.z);
            },
          },
          {
            // two-shot framed from the actors' live positions (perpendicular to their sightline)
            dur: 4,
            pos: () => twoShot(p, coach, 5.2, 0.35).pos,
            look: () => twoShot(p, coach, 5.2, 0.35).look,
            fov: 40,
            dof: { range: 3, bokeh: 2 },
            subtitle: { who: 'Coach Marla', text: 'Talent gets you noticed. Fundamentals win games. Let’s see what you’ve got.' },
            onStart: () => {
              coach.faceYaw = Math.atan2(p.pos.x - coach.pos.x, p.pos.z - coach.pos.z);
              st.play(coach, 'point', { fade: 0.3 });
            },
          },
        ],
        { skippable: true, restore: false, hideHud: true },
      );
      st.dispose();
      return;
    }
    // ------------------------------------------------------------------ RIVAL (match roster)
    case 'rival':
    case 'rematch': {
      if (!m) return;
      const jax = m.away[0];
      const player = m.player!;
      const st = new Stage(game);
      st.adopt(jax);
      const rematch = id === 'rematch';
      await d.play(
        [
          {
            dur: 2.6,
            pos: V(8, 3.5, -12),
            pos2: V(5, 2.6, -9),
            look: { at: jax, off: [0, 1.2, 0] },
            fov: 45,
            title: rematch ? { t1: 'Skyline Rooftop · City League', t2: 'Rival Rematch' } : { t1: 'Harbor Street Court', t2: 'The Rival' },
          },
          {
            dur: 3.2,
            pos: { at: jax, off: [0.5, 1.2, 2.4] },
            pos2: { at: jax, off: [0.3, 1.35, 1.9] },
            look: { at: jax, off: [0, 1.55, 0] },
            fov: 38,
            dof: { range: 1.5, bokeh: 3 },
            subtitle: { who: 'Jax', text: rematch ? 'Look who climbed all the way up here. The rec-center kid.' : 'So you’re the rec-center kid everyone keeps talking about.' },
            onStart: () => st.play(jax, 'point', { fade: 0.3 }),
          },
          {
            dur: 3,
            pos: { at: jax, off: [0.7, 1.7, -1.4] },
            look: { at: player, off: [0, 1.4, 0] },
            fov: 36,
            dof: { range: 3, bokeh: 3 },
            subtitle: { who: 'Jax', text: rematch ? 'No more luck. Rooftop rules: the walls are mine.' : 'Out here the walls are part of the game. Try to keep up.' },
          },
          {
            dur: 2.4,
            orbit: { center: { at: jax, off: [0, 1.3, 0] }, radius: 3, height: 0.4, from: jax.yaw + 0.7, to: jax.yaw - 0.4 },
            look: { at: jax, off: [0, 1.35, 0] },
            fov: 40,
            title: { t1: 'Rival', t2: "Jax 'Ricochet' Rourke", t3: 'Banks every throw off the boards' },
            onStart: () => st.play(jax, 'ballSpin', { fade: 0.3 }),
          },
        ],
        { skippable: true, restore: false, hideHud: true },
      );
      st.dispose();
      return;
    }
    // ------------------------------------------------------------------ BOSSES (match roster)
    case 'brick':
    case 'vanta':
    case 'regina':
    case 'monarch': {
      if (!m) return;
      const boss = m.away[0];
      const st = new Stage(game);
      st.adopt(boss);
      const info: Record<string, { sub: string; line: string; who: string; clip: 'fistPump' | 'ballSpin' | 'block' | 'point' }> = {
        brick: { sub: 'Power shots break ordinary catches', line: 'You catch like a rec kid. Let’s see you catch THIS.', who: 'Brick', clip: 'fistPump' },
        vanta: { sub: 'Blinks across the court · leaves afterimages', line: 'You’ll never hit what you can’t find.', who: 'Vanta', clip: 'point' },
        regina: { sub: 'Reflects throws straight back', line: 'Six years. Nobody has taken this crown from me.', who: 'Regina', clip: 'block' },
        monarch: { sub: 'Undefeated · four hearts · an ultimate of their own', line: 'Every throne needs a challenger. Every challenger needs a lesson.', who: 'The Monarch', clip: 'ballSpin' },
      };
      const i = info[id];
      if (i.clip === 'ballSpin' || i.clip === 'block') st.giveBall(boss);
      const shots: Shot[] = [
        {
          dur: 2.6,
          pos: { at: boss, off: [-2.4, 0.4, 4.2] },
          pos2: { at: boss, off: [-1.1, 0.9, 2.7] },
          look: { at: boss, off: [0, 1.5, 0] },
          fov: 44,
          dof: { range: 2, bokeh: 3 },
          onStart: () => {
            st.play(boss, i.clip, { fade: 0.3, hold: i.clip === 'block' });
            if (id === 'vanta') {
              for (let k = 0; k < 4; k++) setTimeout(() => game.abilities.ghosts.spawn(boss, 0x22d3ee, 0.9, 0.45, new THREE.Vector3((k - 1.5) * 0.8, 0, 0)), k * 220);
            }
            if (id === 'monarch') game.renderer.pulseVignette(0.6, 0xf59e0b);
          },
        },
        {
          dur: 3.2,
          pos: { at: boss, off: [0.5, 1.4, 2.1] },
          look: { at: boss, off: [0, 1.6, 0] },
          fov: 36,
          dof: { range: 1.4, bokeh: 3.5 },
          subtitle: { who: i.who, text: i.line },
        },
        {
          dur: 2.6,
          orbit: { center: { at: boss, off: [0, 1.3, 0] }, radius: 3.4, height: 0.2, from: boss.yaw - 0.6, to: boss.yaw + 0.6 },
          look: { at: boss, off: [0, 1.4, 0] },
          fov: 42,
          title: { t1: id === 'monarch' ? 'Final boss' : 'Boss', t2: boss.profile.title ?? boss.name, t3: i.sub },
        },
      ];
      await d.play(shots, { skippable: true, restore: false, hideHud: true });
      st.dispose();
      return;
    }
    // ------------------------------------------------------------------ CHAPTER OPENERS (match roster)
    case 'invitational':
    case 'championship':
    case 'eclipse': {
      if (!m) return;
      const hl = w.court.halfLength;
      const player = m.player!;
      const texts: Record<string, { t1: string; t2: string; t3: string; line: string }> = {
        invitational: { t1: 'Westbrook Fieldhouse', t2: 'Regional Invitational', t3: 'Chapter 3', line: 'Eight teams. One trophy. And for the first time — a crowd that knows your name.' },
        championship: { t1: 'Crown Arena', t2: 'The Crown Championship', t3: 'Chapter 6', line: 'Twenty thousand people. Every one of them came to see a king fall — or a rookie crash.' },
        eclipse: { t1: 'Beyond the Crown', t2: 'The Eclipse', t3: 'Chapter 7', line: 'Past the final. Past the crowd. A court at the edge of the world, under a black sun.' },
      };
      const t = texts[id];
      const st = new Stage(game);
      for (const a of m.home) st.adopt(a);
      if (id === 'championship') {
        // walk-out from the tunnel mark
        const tunnel = game.arena?.marks.entrance ?? V(0, 0, hl + 4);
        m.home.forEach((a, k) => {
          const dest = a.pos.clone();
          st.place(a, tunnel.clone().add(V((k - 1) * 1.1, 0, k * 0.8)), Math.PI);
          setTimeout(() => st.walk(a, dest, 0.45, Math.PI), 300 + k * 250);
        });
      }
      game.arena?.hype(1);
      game.audio.crowd(1.2);
      await d.play(
        [
          {
            dur: 3.4,
            pos: V(-hl * 1.1, 9, hl * 0.2),
            pos2: V(-hl * 0.6, 6, hl * 0.9),
            look: V(0, 1, 0),
            look2: V(0, 1, 2),
            fov: 55,
            title: { t1: t.t1, t2: t.t2, t3: t.t3 },
            subtitle: { text: t.line },
            onStart: () => game.arena?.crowd?.wave(true),
          },
          {
            dur: 3.2,
            pos: { at: player, off: [1.8, 0.6, 3.6] },
            pos2: { at: player, off: [0.9, 1.2, 2.4] },
            look: { at: player, off: [0, 1.4, 0] },
            fov: 40,
            dof: { range: 2.2, bokeh: 3 },
            onStart: () => game.arena?.hype(1.2),
          },
        ],
        { skippable: true, restore: false, hideHud: true },
      );
      game.arena?.crowd?.wave(false);
      st.dispose();
      return;
    }
    // ------------------------------------------------------------------ AWAKENING (standalone)
    case 'awakening': {
      game.loadArena('rooftop');
      const st = new Stage(game);
      const p = st.spawn(ctx.player, 0, V(0, 0, 2), Math.PI);
      const ball = st.giveBall(p);
      const col = new THREE.Color(0xffb13b);
      let glow = 0;
      const tick = (_dt: number, realDt: number) => {
        glow = Math.min(1, glow + realDt * 0.18);
        ball.energyTarget = glow;
        ball.energyColor.copy(col);
        p.rig.material.u.uEnergy.value = glow * 0.7;
        p.rig.material.u.uEnergyColor.value.copy(col);
        if (Math.random() < glow) game.vfx.energyMotes(ball.pos, col, 2, 1.2);
      };
      game.tickers.add(tick);
      await d.play(
        [
          {
            dur: 3.6,
            pos: V(-9, 4, 9),
            pos2: V(-6, 2.6, 6.5),
            look: V(0, 1.2, 2),
            fov: 50,
            subtitle: { text: 'The City League is yours. But something followed you up here.' },
          },
          {
            dur: 4.2,
            orbit: { center: { at: p, off: [0, 1.3, 0] }, radius: 3.2, radius2: 2.2, height: 0.1, from: Math.PI + 1.2, to: Math.PI - 0.8 },
            look: { at: p, off: [0, 1.3, 0] },
            fov: 42,
            dof: { range: 1.6, bokeh: 3.5 },
            subtitle: { text: 'A pressure behind your eyes. The whole court holding its breath.' },
            onStart: () => st.play(p, 'ballSpin', { fade: 0.4 }),
          },
          {
            dur: 3.4,
            pos: { at: p, off: [1.5, 0.6, 2.6] },
            pos2: { at: p, off: [1.0, 1.1, 1.8] },
            look: { at: p, off: [0, 1.6, 0] },
            fov: 40,
            shake: 0.3,
            title: { t1: 'New ultimate', t2: 'OVERTHROW', t3: 'Fill the meter · Press R' },
            onStart: () => {
              st.play(p, 'ultimateJump', { hold: true, fade: 0.3 });
              p.vy = 5;
              game.audio.play('ultimateRise', { volume: 0.9 });
              game.renderer.pulseRadial(1.2);
            },
            events: [
              {
                t: 1.6,
                fn: () => {
                  game.vfx.shockwave(V(p.pos.x, 0.05, p.pos.z), 4, 0xffb13b);
                  game.renderer.flashScreen(0.3, 0xffd9a0);
                  game.audio.play('ultimateImpact', { volume: 0.9 });
                  game.audio.stinger('unlock');
                },
              },
            ],
          },
        ],
        { skippable: true, restore: false, hideHud: true },
      );
      game.tickers.delete(tick);
      st.dispose();
      return;
    }
    // ------------------------------------------------------------------ ENDING (standalone)
    case 'ending': {
      game.loadArena('eclipse');
      const st = new Stage(game);
      const p = st.spawn(ctx.player, 0, V(0, 0, 1.5), Math.PI);
      const mates = [filler(KITS.player, 0, 5, 'defender', 22), filler(KITS.player, 1, 5, 'aggressor', 22)];
      const a1 = st.spawn(mates[0], 0, V(-1.8, 0, 3.2), Math.PI);
      const a2 = st.spawn(mates[1], 0, V(1.8, 0, 3.4), Math.PI);
      st.play(p, 'victory');
      st.play(a1, 'fistPump', { hold: true });
      st.play(a2, 'victory');
      const conf = setInterval(() => {
        for (let k = 0; k < 3; k++)
          game.vfx.add.emit({ pos: V((Math.random() - 0.5) * 10, 7, (Math.random() - 0.5) * 8), count: 6, dir: V(0, -1, 0), spread: 0.6, speed: [1, 3], life: [2, 3.5], size: [0.08, 0.08], color: [0xffd166, 0x27e0d0, 0xff6a3d, 0xffffff][k % 4], gravity: 1, drag: 0.8, shape: 1 });
      }, 120);
      game.arena?.hype(1.5);
      await d.play(
        [
          { dur: 4, pos: V(0, 2.2, -8), pos2: V(0, 1.6, -4.5), look: { at: p, off: [0, 1.3, 0] }, fov: 48, subtitle: { text: 'From a busted rec center to the edge of the world.' } },
          { dur: 4.5, orbit: { center: { at: p, off: [0, 1.3, 0] }, radius: 3.6, radius2: 2.8, height: 0.3, from: 0.4, to: -1.2 }, look: { at: p, off: [0, 1.5, 0] }, fov: 40, dof: { range: 2, bokeh: 3 }, subtitle: { text: 'You didn’t just win the game.' } },
          { dur: 4.5, pos: V(0, 0.8, -3.6), pos2: V(0, 3.2, -7.5), look: { at: p, off: [0, 1.6, 0] }, look2: V(0, 5, 0), fov: 44, title: { t1: 'Champion of the Eclipse', t2: ctx.player.name, t3: 'You overthrew them all' } },
        ],
        { skippable: true, restore: false, hideHud: true },
      );
      clearInterval(conf);
      st.dispose();
      return;
    }
  }
}

