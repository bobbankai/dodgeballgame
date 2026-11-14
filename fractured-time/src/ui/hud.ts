import * as THREE from 'three/webgpu';
import type { Player } from '@/player/player';
import type { Enemy } from '@/ai/enemy';

/**
 * In-game HUD (DOM overlay). Minimal during exploration; a lock-on marker and the target's health bar appear in combat; boss bar at the bottom.
 * Styling is in `hud.css` (consistent sci-fi look: thin geometric linework, cyan chronal accents, HELIX orange for hostile).
 */
/** Speaker colours in subtitles (one per character, consistent everywhere). */
const SPEAKER: Record<string, string> = {
  'ETHAN': 'ethan', 'THE ECHO': 'echo', 'COMMANDER NYX': 'nyx', 'DIRECTOR VOSS': 'voss', 'HELIX SYSTEM': 'helix', 'HELIX TROOPER': 'helix',
  'IMANI': 'imani', 'DR. IMANI REYES': 'imani',
};

export class Hud {
  private root = document.createElement('div');
  private health = document.createElement('div');
  private stamina = document.createElement('div');
  private energy = document.createElement('div');
  private guard = document.createElement('div');
  private marker = document.createElement('div');
  private targetBar = document.createElement('div');
  private targetFill = document.createElement('div');
  private prompt = document.createElement('div');
  private objective = document.createElement('div');
  private subtitle = document.createElement('div');
  private subTimer = 0;
  private bossWrap = document.createElement('div');
  private bossName = document.createElement('div');
  private bossFill = document.createElement('div');
  private abilities: HTMLElement[] = [];
  private tmp = new THREE.Vector3();
  private stateEl = document.createElement('div');

  constructor() {
    this.root.className = 'hud';
    const bars = document.createElement('div');
    bars.className = 'hud-bars';
    const mk = (cls: string, label: string, el: HTMLElement) => {
      const row = document.createElement('div');
      row.className = `bar ${cls}`;
      row.innerHTML = `<span class="lbl">${label}</span><div class="track"></div>`;
      el.className = 'fill';
      row.querySelector('.track')!.appendChild(el);
      bars.appendChild(row);
    };
    mk('health', 'VITAL', this.health);
    mk('guard', 'GUARD', this.guard);
    mk('stamina', 'STAM', this.stamina);
    mk('energy', 'CHRONAL', this.energy);
    this.root.appendChild(bars);

    const ab = document.createElement('div');
    ab.className = 'hud-abilities';
    for (const [k, n] of [['1', 'SLOW'], ['2', 'REWIND'], ['3', 'ECHO'], ['4', 'SHIFT']]) {
      const el = document.createElement('div');
      el.className = 'ability';
      el.innerHTML = `<b>${k}</b><span>${n}</span>`;
      ab.appendChild(el);
      this.abilities.push(el);
    }
    this.root.appendChild(ab);

    this.marker.className = 'lock-marker';
    this.targetBar.className = 'target-bar';
    this.targetFill.className = 'fill';
    this.targetBar.appendChild(this.targetFill);
    this.prompt.className = 'prompt';
    this.objective.className = 'objective';
    this.subtitle.className = 'subtitle';
    this.bossWrap.className = 'boss';
    this.bossName.className = 'boss-name';
    const bt = document.createElement('div');
    bt.className = 'boss-track';
    this.bossFill.className = 'fill';
    const trail = document.createElement('div');
    trail.className = 'trail';
    const phase = document.createElement('div');
    phase.className = 'phase';
    bt.append(trail, this.bossFill, phase);
    this.bossWrap.append(this.bossName, bt);
    this.stateEl.className = 'debug';
    this.root.append(this.marker, this.targetBar, this.prompt, this.objective, this.subtitle, this.bossWrap, this.stateEl);
    document.body.appendChild(this.root);
  }

  /** A new objective is announced (a tag and a sweep), then settles into the corner. Controls in [brackets] become key glyphs. */
  setObjective(text: string): void {
    const esc = (t: string) => t.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
    const glyphs = (t: string) => esc(t).replace(/\[([^\]]+)\]/g, (_m, inner: string) => `<span class="keys">${inner.replace(/\b(LMB|RMB|[A-Z0-9])\b/g, '<kbd>$1</kbd>')}</span>`);
    if (text && text !== this.objText) {
      this.objective.innerHTML = `<span class="tag">New objective</span><span class="txt">${glyphs(text)}</span>`;
      this.objective.classList.remove('fresh');
      void this.objective.offsetWidth; // restart the reveal animation
      this.objective.classList.add('fresh');
    }
    this.objText = text;
    this.objective.style.opacity = text ? '1' : '0';
  }
  private objText = '';
  setPrompt(text: string): void {
    const m = /^\[(\w+)\]\s*(.*)$/.exec(text);
    this.prompt.innerHTML = m ? `<kbd>${m[1]}</kbd><span>${m[2]}</span>` : text;
    this.prompt.style.opacity = text ? '1' : '0';
  }
  showSubtitle(who: string, text: string, seconds: number): void {
    const cls = SPEAKER[who] ?? 'other';
    this.subtitle.innerHTML = `<span class="who ${cls}">${who}</span>${text}`;
    this.subtitle.style.opacity = '1';
    this.subTimer = seconds;
  }
  private bossTrail = 1;
  setBoss(e: Enemy | null): void {
    if (!e || !e.alive) { this.bossWrap.style.opacity = '0'; this.bossTrail = 1; return; }
    this.bossWrap.style.opacity = '1';
    const k = Math.max(0, e.health / e.maxHealth);
    this.bossName.innerHTML = `${e.def.display.toUpperCase()}<span class="sub">${(e.def as any).title ?? ''}</span>`;
    this.bossFill.style.width = `${k * 100}%`;
    // the damage trail: a pale bar that catches up with the real one after a beat
    this.bossTrail = Math.max(k, this.bossTrail - 0.004);
    (this.bossWrap.querySelector('.trail') as HTMLElement | null)?.style.setProperty('width', `${this.bossTrail * 100}%`);
  }
  setDebug(text: string): void { this.stateEl.textContent = text; }
  show(v: boolean): void { this.root.style.display = v ? '' : 'none'; }

  update(dt: number, player: Player, camera: THREE.Camera, w: number, h: number, abilityReady: boolean[]): void {
    const pct = (v: number, m: number) => `${Math.max(0, Math.min(100, (v / m) * 100))}%`;
    this.health.style.width = pct(player.health, player.maxHealth);
    this.guard.style.width = pct(player.guard, 100);
    this.stamina.style.width = pct(player.stamina, 100);
    this.energy.style.width = pct(player.energy, 100);
    this.abilities.forEach((el, i) => el.classList.toggle('ready', abilityReady[i] ?? false));
    this.abilities[0]?.classList.toggle('active', player.slowActive);
    this.root.classList.toggle('opening', player.openingActive);
    if (this.subTimer > 0) { this.subTimer -= dt; if (this.subTimer <= 0) this.subtitle.style.opacity = '0'; }

    const t = player.lockTarget as Enemy | null;
    if (t && t.alive) {
      const p = this.tmp.copy(t.pos).setY(t.pos.y + t.height * 0.7).project(camera);
      const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
      const vis = p.z < 1 && p.z > -1;
      this.marker.style.opacity = vis ? '1' : '0';
      this.marker.style.transform = `translate(${x}px, ${y}px)`;
      this.targetBar.style.opacity = vis ? '1' : '0';
      this.targetBar.style.transform = `translate(${x - 40}px, ${y - 34}px)`;
      this.targetFill.style.width = pct(t.health, t.maxHealth);
    } else {
      this.marker.style.opacity = '0';
      this.targetBar.style.opacity = '0';
    }
  }
}
