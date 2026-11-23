import { Vector3 } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import type { Input } from '../core/Input';
import { Character, CharacterOptions } from './Character';
import { Combat } from './Combat';
import { Fighter } from './Fighter';
import { getKit } from './Moves';
import { AI, PROFILES, Tokens } from './AI';
import type { CameraRig } from './CameraRig';
import { PAL, type Effects } from './Effects';
import type { HUD } from '../ui/UI';
import type { Stage } from './Stage';

export interface FighterSpec {
  id: string;
  model: string;
  kit: string;
  team: 0 | 1;
  pos: [number, number];
  ai?: string;
  health?: number;
  power?: number;
  opts?: CharacterOptions;
  /** start the fight with this much energy / domain gauge */
  energy?: number;
  domain?: number;
}

export interface FightSpec {
  fighters: FighterSpec[];
  player: string;
  /** later waves of enemies, sent in when the previous wave is down */
  waves?: FighterSpec[][];
  /** end the fight (as 'scripted') when this fighter drops below this health fraction */
  until?: { id: string; hp: number };
  /** end after this many seconds (unwinnable fights in flashbacks) */
  survive?: number;
  canLose?: boolean;
  intro?: string;
  introSub?: string;
  /** tutorial prompts shown one after another, each until its test passes or it times out */
  tutorial?: { html: string; done?: (f: Fight) => boolean; time?: number }[];
  /** AI difficulty multiplier */
  difficulty?: number;
}

export type FightResult = 'win' | 'lose' | 'scripted';

/** One battle: the fighters, the combat world, the camera on them and the HUD over it. */
export class Fight {
  readonly combat: Combat;
  fighters: Fighter[] = [];
  player!: Fighter;
  private ais: AI[] = [];
  /** grunts take turns: one attacks at a time against a lone fighter, two when the player has an ally */
  private tokens = new Tokens(1);
  private waveIdx = 0;
  /** a wave is still loading: its fighters aren't in the fight yet, so the field only looks clear */
  private waveLoading = false;
  time = 0;
  result: FightResult | null = null;
  private endT = 0;
  private tutIdx = 0;
  private tutT = 0;
  private created: Character[] = [];
  /** set by the game: plays the domain cinematic, resolves when the domain is up */
  onDomain: ((f: Fighter) => Promise<void>) | null = null;
  private domainBusy = false;
  stats = { hits: 0, damage: 0, maxCombo: 0, sparks: 0, perfect: 0 };
  private comboRun = 0;
  /** test autopilot: an AI drives the player's fighter instead of the keyboard */
  autopilot: AI | null = null;

  constructor(private r: Renderer, readonly spec: FightSpec, private input: Input, readonly cam: CameraRig, readonly fx: Effects,
    readonly hud: HUD, private stage: Stage, private cast: Map<string, Character>) {
    this.combat = new Combat(fx);
    this.combat.arenaRadius = stage.def.arena;
    // the floor breaks into chunks of its own colour, a shade darker inside
    const fl = stage.def.floor ?? [0.5, 0.48, 0.45, 0];
    fx.ground = { color: [fl[0] * 0.85, fl[1] * 0.85, fl[2] * 0.85], kind: 0 };
  }

  async setup(): Promise<void> {
    for (const s of this.spec.fighters) await this.spawn(s);
    this.player = this.fighters.find((f) => f.id === this.spec.player)!;
    this.tokens.max = this.spec.fighters.filter((s) => s.team === 0).length > 1 ? 2 : 1;
    this.fx.player = this.player;
    this.cam.player = { pos: this.player.pos, height: this.player.height };
    this.hud.bindTechs(this.player);
    this.fx.onHitHud = (a, t, dmg, res, spark) => {
      if (res === 'hit' && a === this.player) {
        this.stats.hits++;
        this.stats.damage += dmg;
        this.comboRun = t.comboTaken;
        this.stats.maxCombo = Math.max(this.stats.maxCombo, this.comboRun);
        if (spark) {
          this.stats.sparks++;
          this.hud.banner('BLACK SPARK', 'red', '黒閃');
        }
      }
      if (res === 'perfect' && t === this.player) {
        this.stats.perfect++;
        this.hud.banner('PERFECT GUARD', 'gold', '', 0.9);
      }
      this.hud.onHit(a === this.player && res === 'hit', dmg);
    };
    this.fx.onVowFx = (f) => {
      if (f === this.player) this.hud.banner('BINDING VOW', 'red', 'no guard · double damage', 1.6);
    };
    this.cam.fight();
    if (this.spec.intro) this.hud.banner(this.spec.intro, '', this.spec.introSub ?? '', 1.8);
    // the versus strokes sweep in, each in its fighter's colour
    const s = this.r.post.settings;
    const pa = PAL[this.player.kit.palette] ?? PAL[0];
    const pb = PAL[this.enemy?.kit.palette ?? 3] ?? PAL[3];
    s.fightColA.set(pa.body[0], pa.body[1], pa.body[2]);
    s.fightColB.set(pb.body[0], pb.body[1], pb.body[2]);
    s.fightVersus = 0;
    s.fightEndKind = 0;
    s.fightEnd = 0;
  }

  private async spawn(s: FighterSpec): Promise<Fighter> {
    let ch = this.cast.get(s.id);
    if (!ch) {
      ch = await Character.create(this.r, s.model, s.id, s.opts);
      this.created.push(ch);
      this.cast.set(s.id, ch);
    }
    ch.setVisible(true);
    const kit = getKit(s.kit);
    if (s.health) kit.health = s.health;
    const f = new Fighter(ch, kit, s.team, this.combat);
    f.pos.set(s.pos[0], 0, s.pos[1]);
    f.power = s.power ?? 1;
    f.energy = s.energy ?? 50;
    f.domainGauge = s.domain ?? 0;
    ch.anim.play('idle_fight', 0.2);
    this.combat.add(f);
    this.fighters.push(f);
    if (s.ai) {
      const ai = new AI(f, PROFILES[s.ai] ?? PROFILES.grunt, s.ai === 'grunt' ? this.tokens : null);
      ai.difficulty = this.spec.difficulty ?? 1;
      this.ais.push(ai);
    }
    // face the middle of the arena
    f.faceToward(new Vector3(0, 0, 0), 1);
    return f;
  }

  /** The current enemy for the HUD: the player's target. */
  get enemy(): Fighter | null {
    return this.player?.target ?? this.fighters.find((f) => f.team !== this.player.team && f.alive) ?? null;
  }

  private playerCommand(): void {
    const p = this.player;
    const c = p.cmd;
    const inp = this.input;
    // camera-relative movement on the ground plane
    const cf = this.cam.lookAt.subtract(this.cam.position);
    cf.y = 0;
    cf.normalize();
    const cr = new Vector3(cf.z, 0, -cf.x);
    c.move.copyFrom(cf.scale(inp.moveY).add(cr.scale(inp.moveX)));
    if (c.move.length() > 1) c.move.normalize();
    const take = (a: Parameters<Input['wasPressed']>[0]) => {
      const v = inp.wasPressed(a);
      if (v) inp.consume(a);
      return v;
    };
    c.light = take('light');
    c.heavy = take('heavy');
    c.guard = inp.isDown('guard');
    c.guardPressed = inp.wasPressed('guard', 0.02);
    c.dash = take('dash');
    c.jump = take('jump');
    c.tech = take('tech1') ? 0 : take('tech2') ? 1 : take('tech3') ? 2 : -1;
    c.domain = take('domain');
    c.vow = take('vow');
    c.run = false;
  }

  update(dt: number): void {
    const ps = this.r.post.settings;
    if (ps.fightVersus >= 0) {
      ps.fightVersus += dt / 1.6;
      if (ps.fightVersus >= 1) ps.fightVersus = -1;
    }
    // near the end of their strength the frame's edges bleed for the player
    const hp = Math.max(0, this.player.hp) / Math.max(1, this.player.maxHp);
    const danger = this.result ? 0 : Math.max(0, (0.25 - hp) / 0.25);
    ps.fightDanger += (danger - ps.fightDanger) * Math.min(1, dt * 4);
    if (this.result) {
      this.endT += dt;
      ps.fightEnd = Math.min(1, this.endT / 1.6);
      this.combat.update(dt);
      return;
    }
    this.time += dt;
    if (!this.domainBusy) {
      if (this.autopilot) this.autopilot.update(dt);
      else this.playerCommand();
      for (const ai of this.ais) ai.update(dt * this.combat.slowmo);
    }
    this.combat.update(dt);
    this.stage.setCracks(this.combat.cracks);
    // domain requests
    if (this.combat.domainRequest && !this.domainBusy) {
      const f = this.combat.domainRequest;
      this.combat.domainRequest = null;
      this.domainBusy = true;
      this.combat.paused = true;
      const done = this.onDomain ? this.onDomain(f) : Promise.resolve();
      void done.then(() => {
        this.combat.paused = false;
        this.combat.startDomain(f);
        this.domainBusy = false;
        this.cam.fight();
      });
    }
    // camera target: the player's current target
    const e = this.enemy;
    this.cam.target = e ? { pos: e.pos, height: e.height } : null;
    // tutorial prompts
    const tut = this.spec.tutorial;
    if (tut && this.tutIdx < tut.length) {
      const step = tut[this.tutIdx];
      this.tutT += dt;
      this.hud.setPrompt(step.html);
      if ((step.done && step.done(this) && this.tutT > 0.8) || this.tutT > (step.time ?? 12)) {
        this.tutIdx++;
        this.tutT = 0;
        this.hud.setPrompt(null);
      }
    }
    // waves
    const foes = this.fighters.filter((f) => f.team !== this.player.team);
    if (!this.waveLoading && foes.every((f) => !f.alive) && this.spec.waves && this.waveIdx < this.spec.waves.length) {
      const wave = this.spec.waves[this.waveIdx++];
      this.waveLoading = true;
      void Promise.all(wave.map((s) => this.spawn(s))).finally(() => {
        this.waveLoading = false;
      });
      this.hud.banner(`WAVE ${this.waveIdx + 1}`, '', '', 1);
      // a breath between waves: back a quarter of the health bar and some energy (one bar against
      // every wave was a wall)
      for (const f of this.fighters) {
        if (f.team !== this.player.team || !f.alive) continue;
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.25);
        f.energy = Math.min(100, f.energy + 25);
      }
    }
    // end conditions
    const u = this.spec.until;
    if (u) {
      const f = this.fighters.find((x) => x.id === u.id);
      if (f && f.hp <= f.maxHp * u.hp) this.finish('scripted');
    }
    if (this.spec.survive && this.time >= this.spec.survive) this.finish('scripted');
    if (!this.player.alive) this.finish(this.spec.canLose === false ? 'scripted' : 'lose');
    const pending = this.waveLoading || (this.spec.waves ? this.waveIdx < this.spec.waves.length : false);
    if (!pending && foes.length && foes.every((f) => !f.alive) && !this.result) this.finish('win');
  }

  private finish(r: FightResult): void {
    if (this.result) return;
    this.result = r;
    this.combat.slowmo = 0.35;
    this.hud.setPrompt(null);
    this.r.post.settings.fightEndKind = r === 'win' ? 1 : r === 'lose' ? 2 : 0;
    this.r.post.settings.fightEnd = 0;
    if (r === 'win') this.hud.banner('VICTORY', 'gold', '祓', 2);
    if (r === 'lose') this.hud.banner('DEFEATED', 'red', '', 2);
  }

  /** True once the ending beat has played out. */
  get over(): boolean {
    return this.result !== null && this.endT > 1.6;
  }

  /** Tidy up: stop combat state, drop fighters created only for this fight. */
  dispose(keep: Set<string>): void {
    const ps = this.r.post.settings;
    ps.fightVersus = -1;
    ps.fightEndKind = 0;
    ps.fightEnd = 0;
    ps.fightDanger = 0;
    this.combat.clear();
    this.fx.clear();
    for (const f of this.fighters) {
      f.ch.look.energy.set(0, f.kit.palette, 0, 0);
      f.ch.look.flash.w = 0;
    }
    for (const ch of this.created) {
      if (!keep.has(ch.id)) {
        ch.dispose();
        this.cast.delete(ch.id);
      }
    }
    this.hud.setPrompt(null);
  }
}
