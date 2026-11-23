// HTML overlay: HUD (health, storm meter, boss bar, combo), dialogue with typewriter text, chapter
// cards, hints, fades, pause menu, title screen and credits.
import '@fontsource/bangers/400.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './ui.css';

export interface Speaker { name: string; color: string }

export class UI {
  root: HTMLElement;
  private hud: HTMLElement;
  private hp: HTMLElement;
  private hpLag: HTMLElement;
  private storm: HTMLElement;
  private stormGlow: HTMLElement;
  private boss: HTMLElement;
  private bossFill: HTMLElement;
  private bossLag: HTMLElement;
  private bossName: HTMLElement;
  private combo: HTMLElement;
  private dlg: HTMLElement;
  private dlgName: HTMLElement;
  private dlgText: HTMLElement;
  private dlgNext: HTMLElement;
  private card: HTMLElement;
  private hint: HTMLElement;
  private fadeEl: HTMLElement;
  private subtitle: HTMLElement;
  private objective: HTMLElement;
  private pauseEl: HTMLElement;
  private typing: { full: string; shown: number; done: boolean } | null = null;
  private advanceResolve: (() => void) | null = null;
  autoAdvance = 0;   // seconds; test mode moves dialogue on by itself
  private autoT = 0;
  textSpeed = 42;    // characters per second
  onAdvance?: () => void;
  onBlip?: (speaker: string) => void;

  constructor() {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = `
      <div class="hud" id="hud">
        <div class="hero"><div class="portrait" id="hudPortrait">K</div>
          <div class="bars"><div class="name" id="hudName">KAI</div>
            <div class="bar hp"><div class="lag" id="hpLag"></div><div class="fill" id="hpFill"></div></div>
            <div class="bar storm"><div class="fill" id="stormFill"></div><div class="glow" id="stormGlow"></div><i style="left:30%"></i><i style="left:60%"></i></div>
          </div></div>
        <div class="combo" id="combo"></div>
        <div class="objective" id="objective"></div>
      </div>
      <div class="boss" id="boss"><div class="bname" id="bossName"></div><div class="bbar"><div class="lag" id="bossLag"></div><div class="fill" id="bossFill"></div></div></div>
      <div class="dialogue" id="dlg"><div class="dname" id="dlgName"></div><div class="dtext" id="dlgText"></div><div class="dnext" id="dlgNext">&#9660;</div></div>
      <div class="card" id="card"></div>
      <div class="subtitle" id="subtitle"></div>
      <div class="hint" id="hint"></div>
      <div class="fade" id="fade"></div>
      <div class="pause" id="pause"></div>`;
    const $ = (id: string) => document.getElementById(id)!;
    this.hud = $('hud'); this.hp = $('hpFill'); this.hpLag = $('hpLag'); this.storm = $('stormFill'); this.stormGlow = $('stormGlow');
    this.boss = $('boss'); this.bossFill = $('bossFill'); this.bossLag = $('bossLag'); this.bossName = $('bossName');
    this.combo = $('combo'); this.dlg = $('dlg'); this.dlgName = $('dlgName'); this.dlgText = $('dlgText'); this.dlgNext = $('dlgNext');
    this.card = $('card'); this.hint = $('hint'); this.fadeEl = $('fade'); this.subtitle = $('subtitle'); this.objective = $('objective');
    this.pauseEl = $('pause');
    this.dlg.addEventListener('pointerdown', () => this.advance());
  }

  // ------------------------------------------------------------------------------------------ HUD
  showHud(v: boolean): void { this.hud.classList.toggle('show', v); }

  setHealth(hp: number, max: number): void {
    const p = Math.max(0, hp / max) * 100;
    this.hp.style.width = `${p}%`;
    const lag = parseFloat(this.hpLag.style.width || '100');
    this.hpLag.style.width = `${Math.max(p, lag - 0.6)}%`;
    this.hp.classList.toggle('low', p < 30);
  }

  setStorm(v: number, max: number): void {
    const p = Math.max(0, Math.min(1, v / max)) * 100;
    this.storm.style.width = `${p}%`;
    this.stormGlow.classList.toggle('full', p >= 99.9);
  }

  setBoss(name: string | null, hp = 1, max = 1): void {
    this.boss.classList.toggle('show', !!name);
    if (!name) return;
    this.bossName.textContent = name;
    const p = Math.max(0, hp / max) * 100;
    this.bossFill.style.width = `${p}%`;
    const lag = parseFloat(this.bossLag.style.width || '100');
    this.bossLag.style.width = `${Math.max(p, lag - 0.4)}%`;
  }

  setCombo(n: number): void {
    if (n < 2) { this.combo.classList.remove('show'); return; }
    this.combo.innerHTML = `<b>${n}</b><span>HITS</span>`;
    this.combo.classList.remove('pop');
    void this.combo.offsetWidth;
    this.combo.classList.add('show', 'pop');
  }

  setObjective(text: string | null): void {
    this.objective.textContent = text ?? '';
    this.objective.classList.toggle('show', !!text);
  }

  showHint(text: string | null, dur = 0): void {
    this.hint.innerHTML = text ?? '';
    this.hint.classList.toggle('show', !!text);
    if (text && dur > 0) setTimeout(() => { if (this.hint.innerHTML === text) this.showHint(null); }, dur * 1000);
  }

  // ------------------------------------------------------------------------------------------ dialogue
  private lineAuto = 0;

  /** `auto` > 0: the line moves on by itself after that many seconds (walk-and-talk). */
  say(sp: Speaker, text: string, auto = 0): Promise<void> {
    this.lineAuto = auto;
    this.dlg.classList.toggle('walk', auto > 0);
    this.dlg.classList.add('show');
    this.dlgName.textContent = sp.name;
    this.dlgName.style.background = sp.color;
    this.dlgText.textContent = '';
    this.dlgNext.classList.remove('show');
    this.typing = { full: text, shown: 0, done: false };
    this.autoT = 0;
    return new Promise((res) => { this.advanceResolve = res; });
  }

  get talking(): boolean { return !!this.typing && !this.typing.done; }

  hideDialogue(): void { this.dlg.classList.remove('show'); this.typing = null; }

  advance(): void {
    if (!this.typing) return;
    if (!this.typing.done) {
      this.typing.shown = this.typing.full.length;
      this.typing.done = true;
      this.dlgText.textContent = this.typing.full;
      this.dlgNext.classList.add('show');
      return;
    }
    const r = this.advanceResolve;
    this.advanceResolve = null;
    this.typing = null;
    r?.();
    this.onAdvance?.();
  }

  update(dt: number): void {
    const t = this.typing;
    if (t && !t.done) {
      const before = Math.floor(t.shown);
      t.shown += dt * this.textSpeed;
      const n = Math.min(t.full.length, Math.floor(t.shown));
      if (n !== before) {
        this.dlgText.textContent = t.full.slice(0, n);
        if (n % 3 === 0 && /[a-zA-Z]/.test(t.full[n - 1] ?? '')) this.onBlip?.(this.dlgName.textContent ?? '');
      }
      if (n >= t.full.length) { t.done = true; this.dlgNext.classList.add('show'); }
    }
    const aa = this.autoAdvance > 0 ? this.autoAdvance : this.lineAuto;
    if (t && aa > 0) {
      this.autoT += dt;
      if (t.done && this.autoT > aa) this.advance();
      else if (!t.done && this.autoT > aa * 3) this.advance();
    }
  }

  /** Drops whatever the previous level left on screen (a pending line is abandoned, not resolved). */
  reset(): void {
    this.typing = null;
    this.advanceResolve = null;
    this.dlg.classList.remove('show');
    this.setObjective(null);
    this.showHint(null);
    this.setBoss(null);
    this.setCombo(0);
    this.showSubtitle(null);
    this.card.classList.remove('show', 'credits');
  }

  // ------------------------------------------------------------------------------------------ cards / fades
  chapterCard(num: string, title: string, sub: string, dur = 4): Promise<void> {
    this.card.innerHTML = `<div class="num">${num}</div><div class="title">${title}</div><div class="sub">${sub}</div>`;
    this.card.classList.add('show');
    return new Promise((res) => setTimeout(() => { this.card.classList.remove('show'); setTimeout(res, 800); }, dur * 1000));
  }

  showSubtitle(text: string | null): void {
    this.subtitle.innerHTML = text ?? '';
    this.subtitle.classList.toggle('show', !!text);
  }

  fade(to: number, dur = 0.6, color = '#000'): Promise<void> {
    this.fadeEl.style.background = color;
    this.fadeEl.style.transition = `opacity ${dur}s ease`;
    this.fadeEl.style.opacity = String(to);
    return new Promise((res) => setTimeout(res, dur * 1000));
  }

  // ------------------------------------------------------------------------------------------ menus
  menu(title: string, items: { label: string; action: () => void; disabled?: boolean }[], extra = ''): void {
    this.pauseEl.innerHTML = `<div class="ptitle">${title}</div>${extra}<div class="pitems">${items.map((it, i) =>
      `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.label}</button>`).join('')}</div>`;
    this.pauseEl.classList.add('show');
    this.pauseEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => items[+b.dataset.i!].action()));
    (this.pauseEl.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.focus();
  }

  closeMenu(): void { this.pauseEl.classList.remove('show'); }
  get menuOpen(): boolean { return this.pauseEl.classList.contains('show'); }

  title(onStart: () => void, onContinue: (() => void) | null, onChapters: () => void): void {
    this.pauseEl.innerHTML = `<div class="logo"><span>TIDE</span><span>BREAKERS</span></div><div class="tag">The Song Beneath the Sea</div>
      <div class="pitems"><button id="tStart">New Voyage</button>${onContinue ? '<button id="tCont">Continue</button>' : ''}<button id="tCh">Chapters</button></div>
      <div class="controls">Move <b>WASD</b> &middot; Camera <b>Mouse</b> &middot; Attack <b>LMB / J</b> &middot; Heavy <b>RMB / K</b> (hold to charge) &middot; Jump <b>Space</b> &middot; Dodge <b>Shift</b> &middot; Guard / Parry <b>Q</b> &middot; Gale Burst <b>E</b> &middot; Tempest Dash <b>R</b> &middot; Hurricane <b>F</b> &middot; Lock-on <b>Tab</b> &middot; Gamepad supported</div>`;
    this.pauseEl.classList.add('show', 'titlescreen');
    document.getElementById('tStart')!.addEventListener('click', () => { this.pauseEl.classList.remove('titlescreen'); this.closeMenu(); onStart(); });
    if (onContinue) document.getElementById('tCont')!.addEventListener('click', () => { this.pauseEl.classList.remove('titlescreen'); this.closeMenu(); onContinue(); });
    document.getElementById('tCh')!.addEventListener('click', () => { this.pauseEl.classList.remove('titlescreen'); onChapters(); });
  }

  credits(lines: string[]): Promise<void> {
    this.card.innerHTML = `<div class="roll">${lines.map((l) => l.startsWith('#') ? `<h2>${l.slice(1)}</h2>` : `<p>${l}</p>`).join('')}</div>`;
    this.card.classList.add('show', 'credits');
    return new Promise((res) => setTimeout(() => { this.card.classList.remove('show', 'credits'); res(); }, 34000));
  }
}
