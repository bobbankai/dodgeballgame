import { Vector3 } from '@babylonjs/core';
import type { Game } from './Game';
import { Save, type SaveData } from './Save';
import { Menus, type MenuItem, type Screen } from '../ui/Menus';
import { Progression, SKILLS } from '../progression/Progression';
import { ABILITIES, equipAbilities } from '../progression/Abilities';
import { presetGraphics, type QualityPreset } from '../core/Settings';

const CHAPTERS: { id: string; name: string; sub: string }[] = [
  { id: 'ashen', name: 'The Ashen Kingdom', sub: 'Chapter One' },
  { id: 'drowned', name: 'The Drowned Empire', sub: 'Chapter Two' },
  { id: 'sky', name: 'The Shattered Sky', sub: 'Chapter Three' },
  { id: 'forest', name: 'The Forgotten Sanctuary', sub: 'Chapter Four' },
  { id: 'eclipse', name: 'The Eternal Eclipse', sub: 'Chapter Five' },
];

const CREDITS = `ECLIPSE: FALLEN GODS

Design, code, art, animation, music and sound
built from scratch in Babylon.js, Blender and Python

Engine — Babylon.js (WebGPU / WebGL 2), Havok Physics, Recast & Detour
Characters — MakeHuman / MPFB2 base meshes (CC0), sculpted and rigged by script
Textures and photoscanned plants — Poly Haven (CC0), and procedural metal
Voices — Kokoro-82M (Apache 2.0), recorded locally
Music — rendered with FluidSynth and the FluidR3 GM soundfont (MIT)
Fonts — Cinzel and Cormorant Garamond (SIL Open Font License)

Thank you for playing.`;

/**
 * The game's flow around the levels: the title screen (over a slow flight across Varn Keld),
 * new game / continue / chapter select, pause, settings, the skill tree, death and respawn at the
 * last checkpoint, autosaves, and XP from kills. In `?test` / `?level=` dev mode the title is skipped.
 */
export class Flow {
  readonly save = new Save();
  readonly progress = new Progression();
  readonly menus: Menus;
  data: SaveData;
  private titleOrbit = 0;
  private onTitle = false;
  private deathShown = false;
  private playStart = performance.now();

  constructor(private g: Game) {
    this.menus = new Menus(document.getElementById('ui')!, g.input);
    this.menus.onMove = () => g.audio.play('ui_move');
    this.menus.onConfirm = () => g.audio.play('ui_confirm');
    this.data = this.save.data ?? Save.fresh();
    this.progress.state = structuredClone(this.data.progress);
    this.progress.events.on('levelUp', ({ level }) => {
      g.hud.toast(`Level ${level} — a skill point to spend`);
      g.audio.play('aether');
    });
    g.combat.events.on('death', ({ victim, killer }) => {
      if (killer !== g.player) return;
      const def = (victim as { def?: { xp: number } }).def;
      if (def) this.progress.addXp(def.xp, g.player);
    });
  }

  /** Called once the player exists (after the first level load). */
  attachPlayer(): void {
    const p = this.g.player!;
    this.progress.applyAll(p);
    p.flasks = Math.min(p.maxFlasks, this.data.flasks);
    equipAbilities(this.g, p, this.progress.state.sparks);
    p.events.on('death', () => {
      if (this.deathShown) return;
      this.deathShown = true;
      this.g.hazards.after(2.6, () => this.showDeath());
    });
  }

  // ------------------------------------------------------------------ title
  showTitle(): void {
    const g = this.g;
    this.onTitle = true;
    g.hud.setVisible(false);
    g.rig.cinematic = true;
    if (g.player) g.player.char.root.setEnabled(false);
    void g.audio.music('ashen');
    g.audio.setState('explore');
    this.menus.push(this.titleScreen());
  }

  private titleScreen(): Screen {
    const hasSave = !!this.save.data;
    return {
      id: 'title', title: 'ECLIPSE<br>FALLEN GODS', subtitle: 'The sun is dying', overlay: 'clear',
      footer: 'Arrows / stick to choose · Enter / A to confirm',
      items: () => [
        { label: 'Continue', disabled: !hasSave, detail: hasSave ? this.describeSave() : '', action: () => void this.continueGame() },
        { label: 'New Game', action: () => (hasSave ? this.menus.push(this.confirmNew()) : void this.newGame()) },
        { label: 'Chapters', disabled: !hasSave, action: () => this.menus.push(this.chapterScreen()) },
        { label: 'Settings', action: () => this.menus.push(this.settingsScreen()) },
        { label: 'Credits', action: () => this.menus.push(this.creditsScreen()) },
      ],
      back: () => undefined,
    };
  }

  private describeSave(): string {
    const d = this.save.data!;
    const ch = CHAPTERS.find((c) => c.id === d.level);
    return `${ch?.name ?? d.level} · Level ${d.progress.level}`;
  }

  private confirmNew(): Screen {
    return {
      id: 'confirm', title: 'Begin anew?', subtitle: 'Your saved journey will be lost', items: () => [
        { label: 'Begin', action: () => void this.newGame() },
        { label: 'Cancel', action: () => this.menus.pop() },
      ],
    };
  }

  private chapterScreen(): Screen {
    return {
      id: 'chapters', title: 'Chapters', items: () => CHAPTERS.map((c) => ({
        label: c.name, detail: c.sub, disabled: !this.data.chapters.includes(c.id),
        action: () => void this.startLevel(c.id, ''),
      })),
    };
  }

  private creditsScreen(): Screen {
    return { id: 'credits', title: 'Credits', items: () => [{ label: `<div class="ec-credits">${CREDITS}</div>`, disabled: true }, { label: 'Back', action: () => this.menus.pop() }] };
  }

  private leaveTitle(): void {
    this.onTitle = false;
    this.menus.close();
    const g = this.g;
    g.rig.cinematic = false;
    if (g.player) g.player.char.root.setEnabled(true);
    g.hud.setVisible(true);
    this.playStart = performance.now();
  }

  async newGame(): Promise<void> {
    this.save.clear();
    this.data = Save.fresh();
    this.progress.state = structuredClone(this.data.progress);
    await this.startLevel('ashen', '');
  }

  async continueGame(): Promise<void> {
    const d = this.save.data;
    if (!d) return;
    this.data = d;
    this.progress.state = structuredClone(d.progress);
    await this.startLevel(d.level, d.checkpoint);
  }

  private async startLevel(level: string, checkpoint: string): Promise<void> {
    const g = this.g;
    this.leaveTitle();
    g.hud.fade(true);
    await new Promise((r) => setTimeout(r, 700));
    await g.loadLevel(level, checkpoint || undefined, true);
    this.rebuildPlayer();
    g.hud.fade(false);
  }

  /** Applies the saved progression to the player (after a reload or respawn). */
  private rebuildPlayer(): void {
    const p = this.g.player;
    if (!p) return;
    p.revive();
    p.mods = { damage: 1, staminaCost: 1, parryWindow: 0.2, aetherGain: 1, poiseDamage: 1, flinchResist: 0, dodgeDistance: 1, executionHeal: 0, abilityCost: 1, abilityDamage: 1 };
    p.maxFlasks = 3;
    p.stats.maxHealth = 260;
    p.stats.maxStamina = 110;
    this.progress.applyAll(p);
    p.stats.health = p.stats.maxHealth;
    p.flasks = p.maxFlasks;
    equipAbilities(this.g, p, this.progress.state.sparks);
    this.deathShown = false;
  }

  // ------------------------------------------------------------------ saving
  checkpoint(level: string, checkpoint: string, flag?: string): void {
    const d = this.data;
    d.level = level;
    d.checkpoint = checkpoint;
    if (!d.chapters.includes(level)) d.chapters.push(level);
    if (flag) (d.flags[level] ??= []).includes(flag) || d.flags[level].push(flag);
    d.progress = structuredClone(this.progress.state);
    d.flasks = this.g.player?.flasks ?? d.flasks;
    d.playtime += (performance.now() - this.playStart) / 1000;
    this.playStart = performance.now();
    this.save.write(d);
    this.g.hud.toast('Progress saved');
  }

  /**
   * A chapter's god has fallen: after a pause the next chapter loads (saved at its start), or the
   * credits roll after the last one.
   */
  chapterComplete(level: string): void {
    const i = CHAPTERS.findIndex((c) => c.id === level);
    const next = CHAPTERS[i + 1];
    const g = this.g;
    g.hazards.after(6, () => {
      if (g.level?.id !== level || g.player?.alive === false) return;
      if (!next) {
        this.menus.push(this.creditsScreen());
        return;
      }
      this.checkpoint(next.id, '');
      void this.startLevel(next.id, '');
    });
  }

  claimSpark(god: string): void {
    if (!this.progress.state.sparks.includes(god)) this.progress.state.sparks.push(god);
    const p = this.g.player;
    if (p) equipAbilities(this.g, p, this.progress.state.sparks);
    const granted = Object.values(ABILITIES).filter((a) => a.spark === god).map((a) => a.name);
    if (granted.length) this.g.hud.toast(`New abilities: ${granted.join(', ')}`);
    this.progress.state.points += 2;
  }

  // ------------------------------------------------------------------ pause and death
  togglePause(): void {
    const g = this.g;
    if (this.onTitle || g.cine.running) return;
    if (this.menus.open) {
      this.resume();
      return;
    }
    g.paused = true;
    this.menus.push(this.pauseScreen());
  }

  private resume(): void {
    this.menus.close();
    this.g.paused = false;
  }

  private pauseScreen(): Screen {
    return {
      id: 'pause', title: 'Paused', back: () => this.resume(), items: () => [
        { label: 'Resume', action: () => this.resume() },
        { label: 'Skills', detail: this.progress.state.points ? `${this.progress.state.points} point${this.progress.state.points > 1 ? 's' : ''}` : '', action: () => this.menus.push(this.skillScreen()) },
        { label: 'Settings', action: () => this.menus.push(this.settingsScreen()) },
        { label: 'Return to Title', action: () => this.quitToTitle() },
      ],
    };
  }

  private quitToTitle(): void {
    this.checkpoint(this.data.level, this.data.checkpoint);
    location.reload();
  }

  private showDeath(): void {
    const g = this.g;
    g.paused = true;
    this.menus.push({
      id: 'death', title: 'The Light Fades', subtitle: 'Rise again, Vessel', back: () => undefined, items: () => [
        { label: 'Rise Again', action: () => void this.respawn() },
        { label: 'Return to Title', action: () => location.reload() },
      ],
    });
  }

  private async respawn(): Promise<void> {
    this.menus.close();
    this.g.paused = false;
    await this.startLevel(this.data.level, this.data.checkpoint);
  }

  // ------------------------------------------------------------------ skills
  private skillScreen(): Screen {
    const p = this.g.player;
    const pr = this.progress;
    const items: MenuItem[] = SKILLS.map((sk) => {
      const learned = pr.state.skills.includes(sk.id);
      const can = pr.canLearn(sk.id);
      return {
        label: sk.name, detail: learned ? 'Learned' : `${sk.cost} point${sk.cost > 1 ? 's' : ''}`,
        hint: `${sk.desc}${sk.requires.length && !learned ? `<br><i>Requires ${sk.requires.map((r) => SKILLS.find((x) => x.id === r)?.name).join(', ')}</i>` : ''}`,
        state: learned ? 'learned' : can ? 'available' : 'locked',
        action: () => { if (pr.learn(sk.id, p)) this.g.audio.play('aether'); },
      } as MenuItem;
    });
    const abil = Object.values(ABILITIES).filter((a) => pr.state.sparks.includes(a.spark));
    return {
      id: 'skills', title: 'Skills', subtitle: `Level ${pr.state.level} · ${pr.state.points} point${pr.state.points === 1 ? '' : 's'} · ${pr.state.xp}/${pr.nextAt} xp`,
      items: () => items.map((it, i) => ({ ...it, state: pr.state.skills.includes(SKILLS[i].id) ? 'learned' : pr.canLearn(SKILLS[i].id) ? 'available' : 'locked', detail: pr.state.skills.includes(SKILLS[i].id) ? 'Learned' : it.detail })),
      columns: [
        { name: 'Blade', filter: (_i, k) => SKILLS[k].branch === 'blade' },
        { name: 'Bulwark', filter: (_i, k) => SKILLS[k].branch === 'bulwark' },
        { name: 'Godspark', filter: (_i, k) => SKILLS[k].branch === 'godspark' },
      ],
      footer: abil.length ? `Abilities: ${abil.map((a, i) => `[${i + 1}] ${a.name}`).join(' · ')}` : 'Defeat a god to claim its abilities.',
    };
  }

  // ------------------------------------------------------------------ controls
  /** Rebinding: pick an action, press the new key or mouse button. A key another action had swaps over to it. */
  private controlsScreen(): Screen {
    const g = this.g;
    const s = g.settings;
    const ROWS: [string, string][] = [
      ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Move left'], ['right', 'Move right'],
      ['light', 'Light attack'], ['heavy', 'Heavy attack'], ['dodge', 'Dodge'], ['block', 'Block and parry'], ['jump', 'Jump'],
      ['sprint', 'Sprint'], ['lockOn', 'Lock on'], ['interact', 'Interact'], ['heal', 'Flask'],
      ['ability1', 'Ability 1'], ['ability2', 'Ability 2'], ['ability3', 'Ability 3'], ['ability4', 'Ability 4'], ['ultimate', 'Ultimate'],
      ['walk', 'Walk'], ['skills', 'Skills'], ['journal', 'Journal'], ['map', 'Map'], ['inventory', 'Inventory'],
    ];
    const NAMES: Record<string, string> = { Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Space: 'Space', Escape: 'Esc',
      ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', ArrowUp: 'Up', ArrowDown: 'Down',
      ArrowLeft: 'Left', ArrowRight: 'Right' };
    const name = (code: string) => NAMES[code] ?? code.replace(/^(Key|Digit|Numpad)/, (m) => (m === 'Numpad' ? 'Num ' : '')).replace(/([a-z])([A-Z])/g, '$1 $2');
    let waiting: string | null = null;
    const bindings = () => s.data.controls.bindings;
    /**
     * The new key takes this action's primary slot (its secondary stays). If another action was using that
     * key it gets this action's old primary in return, so nothing is left unbound or doubled up.
     */
    const rebind = (action: string, code: string): void => {
      const b = bindings();
      const old = b[action] ?? [];
      const give = old[0];
      for (const [other, keys] of Object.entries(b)) {
        if (other === action || !keys.includes(code)) continue;
        const rest = keys.filter((k) => k !== code);
        b[other] = give && !rest.includes(give) ? [...rest, give].slice(0, 2) : rest;
      }
      b[action] = [code, ...old.slice(1).filter((k) => k !== code)].slice(0, 2);
      s.save();
    };
    return {
      id: 'controls', title: 'Controls', subtitle: 'Pick an action, then press the new key (Esc cancels)',
      items: () => [
        ...ROWS.map(([action, label]): MenuItem => ({
          label,
          detail: waiting === action ? 'Press a key...' : (bindings()[action] ?? []).map(name).join(' / ') || 'Unbound',
          action: () => {
            waiting = action;
            this.menus.refresh();
            // after the key that confirmed this row has been released
            setTimeout(() => g.input.captureNext((code) => {
              if (code) rebind(action, code);
              waiting = null;
              this.menus.refresh();
            }), 0);
          },
        })),
        { label: 'Reset to defaults', action: () => { s.resetControls(); this.menus.refresh(); } },
        { label: 'Back', action: () => this.menus.pop() },
      ],
    };
  }

  // ------------------------------------------------------------------ settings
  private settingsScreen(): Screen {
    const g = this.g;
    const s = g.settings;
    const cycle = <T>(list: T[], cur: T, dir: number): T => list[(list.indexOf(cur) + dir + list.length) % list.length];
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const vol = (key: keyof typeof s.data.audio, label: string): MenuItem => ({
      label, value: { get: () => pct(s.data.audio[key]), step: (d) => { s.data.audio[key] = Math.min(1, Math.max(0, Math.round((s.data.audio[key] + d * 0.1) * 10) / 10)); s.save(); g.audio.applySettings(); } },
    });
    const toggle = (get: () => boolean, set: (v: boolean) => void, label: string, rebuild = false): MenuItem => ({
      label, value: { get: () => (get() ? 'On' : 'Off'), step: () => { set(!get()); s.save(); if (rebuild) g.pipe.build(s.data.graphics); } },
    });
    const gr = s.data.graphics;
    return {
      id: 'settings', title: 'Settings', items: () => [
        { label: 'Quality', value: { get: () => gr.preset[0].toUpperCase() + gr.preset.slice(1), step: (d) => { const p = cycle<QualityPreset>(['low', 'medium', 'high', 'ultra'], s.data.graphics.preset, d); s.data.graphics = presetGraphics(p); Object.assign(gr, s.data.graphics); s.save(); g.pipe.build(s.data.graphics); g.host.renderScale = s.data.graphics.resolution; } } },
        { label: 'Resolution', value: { get: () => pct(gr.resolution), step: (d) => { gr.resolution = Math.min(1, Math.max(0.5, Math.round((gr.resolution + d * 0.05) * 100) / 100)); s.save(); g.host.renderScale = gr.resolution; } } },
        toggle(() => gr.volumetrics, (v) => { gr.volumetrics = v; }, 'Volumetric fog', true),
        toggle(() => gr.ambientOcclusion, (v) => { gr.ambientOcclusion = v; }, 'Ambient occlusion', true),
        toggle(() => gr.depthOfField, (v) => { gr.depthOfField = v; }, 'Depth of field', true),
        toggle(() => gr.motionBlur, (v) => { gr.motionBlur = v; }, 'Motion blur', true),
        vol('master', 'Master volume'), vol('music', 'Music'), vol('sfx', 'Effects'), vol('voice', 'Voices'), vol('ambience', 'Ambience'),
        { label: 'Camera sensitivity', value: { get: () => s.data.controls.mouseSensitivity.toFixed(1), step: (d) => { s.data.controls.mouseSensitivity = Math.min(3, Math.max(0.2, Math.round((s.data.controls.mouseSensitivity + d * 0.1) * 10) / 10)); s.save(); } } },
        toggle(() => s.data.controls.invertY, (v) => { s.data.controls.invertY = v; }, 'Invert camera Y'),
        toggle(() => s.data.access.subtitles, (v) => { s.data.access.subtitles = v; }, 'Subtitles'),
        { label: 'Camera shake', value: { get: () => pct(s.data.access.cameraShake), step: (d) => { s.data.access.cameraShake = Math.min(1, Math.max(0, Math.round((s.data.access.cameraShake + d * 0.25) * 4) / 4)); g.rig.shakeScale = s.data.access.cameraShake; s.save(); } } },
        { label: 'Controls', detail: 'Rebind keys', action: () => this.menus.push(this.controlsScreen()) },
        { label: 'Difficulty', value: { get: () => s.data.access.difficulty, step: (d) => { s.data.access.difficulty = cycle<'story' | 'normal' | 'hard'>(['story', 'normal', 'hard'], s.data.access.difficulty, d); s.save(); } } },
        { label: 'Back', action: () => this.menus.pop() },
      ],
    };
  }

  /** Every rendered frame: menus, the title flight, pause. */
  update(dt: number): void {
    const g = this.g;
    g.touch.setVisible(!this.menus.open && !this.onTitle && !g.cine.running);
    if (this.menus.open) {
      g.input.update(performance.now() / 1000);
      this.menus.update(dt);
    }
    if (g.input.pressed('pause') && !this.onTitle && !this.deathShown) this.togglePause();
    if (this.onTitle) {
      // a slow flight over the burning town
      this.titleOrbit += dt * 0.025;
      const c = new Vector3(0, 6, 120);
      const r = 75;
      g.camera.position.set(c.x + Math.sin(this.titleOrbit) * r, 28, c.z - Math.cos(this.titleOrbit) * r);
      g.camera.setTarget(c.add(new Vector3(0, 10, 0)));
    }
  }
}
