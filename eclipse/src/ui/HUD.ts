import { Matrix, Vector3, type Scene } from '@babylonjs/core';
import type { Player } from '../player/Player';
import type { Combatant } from '../combat/Types';
import type { Stats } from '../combat/Stats';

function el(tag: string, cls: string, parent?: HTMLElement, html?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

export interface BossInfo {
  name: string;
  title: string;
  stats: Stats;
  /** Health fractions where phases change (drawn as marks). */
  phases: number[];
}

/**
 * The in-game HUD: vitals (health with a trailing chip, stamina, aether, flasks), ability slots,
 * boss bar, lock-on reticle, prompts, tutorial hints, subtitles, toasts, chapter banners, damage
 * numbers, letterbox and fades. Plain DOM over the canvas, updated each rendered frame.
 */
export class HUD {
  readonly root: HTMLElement;
  private bars: Record<string, { bar: HTMLElement; fill: HTMLElement; chip?: HTMLElement }> = {};
  private flasks: HTMLElement;
  private status: HTMLElement;
  private statusKey = '';
  private slots: { el: HTMLElement; ico: HTMLElement; cd: HTMLElement }[] = [];
  private boss: HTMLElement;
  private bossName: HTMLElement;
  private bossMarks: HTMLElement;
  private reticle: HTMLElement;
  private prompt: HTMLElement;
  private hint: HTMLElement;
  private subtitle: HTMLElement;
  private toasts: HTMLElement;
  private banner: HTMLElement;
  private hurt: HTMLElement;
  readonly fadeEl: HTMLElement;
  bossInfo: BossInfo | null = null;
  private tmp = new Vector3();

  constructor(private scene: Scene, host: HTMLElement) {
    this.root = el('div', 'ec-hud', host);
    const v = el('div', 'ec-vitals', this.root);
    for (const k of ['health', 'stamina', 'aether']) {
      const bar = el('div', `ec-bar ${k}${k === 'health' ? '' : ' thin'}`, v);
      const chip = k === 'health' ? el('div', 'chip', bar) : undefined;
      const fill = el('div', 'fill', bar);
      this.bars[k] = { bar, fill, chip };
    }
    this.flasks = el('div', 'ec-flasks', v);
    this.status = el('div', 'ec-status', v);
    const ab = el('div', 'ec-abilities', this.root);
    ['1', '2', '3', '4', 'R'].forEach((key) => {
      const s = el('div', 'ec-slot empty', ab);
      const ico = el('div', 'ico', s);
      const cd = el('div', 'cd', s);
      el('div', 'key', s, key);
      this.slots.push({ el: s, ico, cd });
    });
    this.boss = el('div', 'ec-boss', this.root);
    this.bossName = el('div', 'name', this.boss);
    const bb = el('div', 'ec-bar health', this.boss);
    this.bars.boss = { bar: bb, chip: el('div', 'chip', bb), fill: el('div', 'fill', bb) };
    this.bossMarks = el('div', 'marks', bb);
    const bp = el('div', 'ec-bar stamina thin poise', this.boss);
    this.bars.bossPoise = { bar: bp, fill: el('div', 'fill', bp) };
    this.reticle = el('div', 'ec-reticle', this.root);
    this.prompt = el('div', 'ec-prompt', this.root);
    this.hint = el('div', 'ec-hint', this.root);
    this.subtitle = el('div', 'ec-subtitle', host);
    this.toasts = el('div', 'ec-toast', this.root);
    this.banner = el('div', 'ec-banner', host);
    this.hurt = el('div', 'ec-vignette-hurt', host);
    this.fadeEl = el('div', 'ec-fade', host);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  private setBar(k: string, frac: number, chip?: number): void {
    const b = this.bars[k];
    b.fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    if (b.chip && chip !== undefined) b.chip.style.width = `${Math.max(0, Math.min(1, chip)) * 100}%`;
  }

  update(player: Player | null): void {
    if (player) {
      const s = player.stats;
      this.setBar('health', s.health / s.maxHealth, s.displayed / s.maxHealth);
      this.bars.health.bar.classList.toggle('low', s.health / s.maxHealth < 0.25);
      this.bars.health.bar.style.width = `${Math.min(100, (s.maxHealth / 260) * 72)}%`;
      this.setBar('stamina', s.stamina / s.maxStamina);
      this.bars.stamina.bar.style.width = `${Math.min(100, (s.maxStamina / 110) * 60)}%`;
      this.setBar('aether', s.aether / s.maxAether);
      this.bars.aether.bar.style.width = `${Math.min(100, (s.maxAether / 100) * 52)}%`;
      if (this.flasks.childElementCount !== player.maxFlasks) {
        this.flasks.innerHTML = '';
        for (let i = 0; i < player.maxFlasks; i++) el('div', 'ec-flask', this.flasks);
      }
      [...this.flasks.children].forEach((f, i) => f.classList.toggle('full', i < player.flasks));
      const all = [...player.abilities, player.ultimate];
      all.forEach((a, i) => {
        const slot = this.slots[i];
        slot.el.classList.toggle('empty', !a);
        if (!a) return;
        slot.ico.textContent = a.name;
        const now = player.now;
        const left = Math.max(0, a.ready - now);
        slot.cd.style.transform = `scaleY(${a.cooldown > 0 ? left / a.cooldown : 0})`;
        slot.el.classList.toggle('ready', left <= 0 && s.aether >= a.cost);
      });
      const st = player.statusTime;
      const bd = player.statusBuild;
      const key = (['burn', 'soak'] as const).map((k) => `${k}${st[k] > 0 ? 1 : 0}${Math.round(bd[k] / 10)}`).join() + (player.wardHp > 0 ? 'w' : '');
      if (key !== this.statusKey) {
        this.statusKey = key;
        const chip = (k: 'burn' | 'soak', name: string) => (st[k] > 0 ? `<span class="on ${k}">${name}</span>` : bd[k] > 5 ? `<span class="${k}"><i style="width:${Math.min(100, bd[k])}%"></i>${name}</span>` : '');
        this.status.innerHTML = chip('burn', 'Burning') + chip('soak', 'Soaked') + (player.wardHp > 0 ? '<span class="on ward">Warded</span>' : '');
      }
      this.hurt.style.opacity = s.sinceHit < 0.5 ? String((0.5 - s.sinceHit) * 1.6) : s.health / s.maxHealth < 0.2 ? '0.35' : '0';
      this.updateReticle(player.target);
    }
    const b = this.bossInfo;
    this.boss.classList.toggle('on', !!b && b.stats.alive);
    if (b) {
      this.setBar('boss', b.stats.health / b.stats.maxHealth, b.stats.displayed / b.stats.maxHealth);
      this.setBar('bossPoise', b.stats.poise / b.stats.maxPoise);
    }
  }

  showBoss(info: BossInfo | null): void {
    this.bossInfo = info;
    if (!info) return;
    this.bossName.innerHTML = `${info.name}<small>${info.title}</small>`;
    this.bossMarks.innerHTML = info.phases.map((p) => `<i style="left:${p * 100}%"></i>`).join('');
  }

  private updateReticle(t: Combatant | null): void {
    if (!t || !t.alive) {
      this.reticle.classList.remove('on');
      return;
    }
    t.aimPoint(this.tmp);
    const engine = this.scene.getEngine();
    const cam = this.scene.activeCamera!;
    const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const p = Vector3.Project(this.tmp, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), vp);
    const sx = p.x / engine.getRenderWidth() * window.innerWidth;
    const sy = p.y / engine.getRenderHeight() * window.innerHeight;
    const visible = p.z > 0 && p.z < 1;
    this.reticle.classList.toggle('on', visible);
    this.reticle.classList.toggle('exec', !!(t as Combatant & { executable?: boolean }).executable);
    this.reticle.style.left = `${sx}px`;
    this.reticle.style.top = `${sy}px`;
  }

  /** Floating damage number at a world position. */
  damageNumber(at: Vector3, amount: number, crit: boolean): void {
    const engine = this.scene.getEngine();
    const cam = this.scene.activeCamera!;
    const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const p = Vector3.Project(at, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), vp);
    if (p.z <= 0 || p.z >= 1) return;
    const d = el('div', `ec-dmg${crit ? ' crit' : ''}`, this.root, String(Math.round(amount)));
    d.style.left = `${p.x / engine.getRenderWidth() * window.innerWidth + (Math.random() - 0.5) * 30}px`;
    d.style.top = `${p.y / engine.getRenderHeight() * window.innerHeight}px`;
    setTimeout(() => d.remove(), 950);
  }

  showPrompt(html: string | null): void {
    if (html) this.prompt.innerHTML = html;
    this.prompt.classList.toggle('on', !!html);
  }

  showHint(title: string | null, body = ''): void {
    if (title) this.hint.innerHTML = `<b>${title}</b>${body}`;
    this.hint.classList.toggle('on', !!title);
  }

  showSubtitle(who: string | null, text: string | null, size = 'medium', names = true): void {
    this.subtitle.className = `ec-subtitle ${size}${text ? ' on' : ''}`;
    if (text) this.subtitle.innerHTML = `${who && names ? `<span class="who">${who}</span>` : ''}${text}`;
  }

  toast(text: string): void {
    const t = el('div', '', this.toasts, text);
    setTimeout(() => t.remove(), 4100);
  }

  showBanner(title: string | null, sub = ''): void {
    if (title) this.banner.innerHTML = `<div class="t">${title}</div><div class="rule"></div><div class="s">${sub}</div>`;
    this.banner.classList.toggle('on', !!title);
  }

  fade(on: boolean): void {
    this.fadeEl.classList.toggle('on', on);
  }
}
