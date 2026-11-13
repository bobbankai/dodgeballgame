import * as THREE from 'three/webgpu';
import type { Player } from '@/player/player';
import type { Enemy } from '@/ai/enemy';

/**
 * In-game HUD (DOM overlay). Minimal during exploration; a lock-on marker and the target's health bar appear in combat; boss bar at the bottom.
 * Styling is in `hud.css` (consistent sci-fi look: thin geometric linework, cyan chronal accents, HELIX orange for hostile).
 */
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
    bt.appendChild(this.bossFill);
    this.bossWrap.append(this.bossName, bt);
    this.stateEl.className = 'debug';
    this.root.append(this.marker, this.targetBar, this.prompt, this.objective, this.subtitle, this.bossWrap, this.stateEl);
    document.body.appendChild(this.root);
  }

  setObjective(text: string): void { this.objective.textContent = text ? `OBJECTIVE  ${text}` : ''; this.objective.style.opacity = text ? '1' : '0'; }
  setPrompt(text: string): void { this.prompt.textContent = text; this.prompt.style.opacity = text ? '1' : '0'; }
  showSubtitle(who: string, text: string, seconds: number): void {
    this.subtitle.innerHTML = `<span class="who">${who}</span>${text}`;
    this.subtitle.style.opacity = '1';
    this.subTimer = seconds;
  }
  setBoss(e: Enemy | null): void {
    if (!e || !e.alive) { this.bossWrap.style.opacity = '0'; return; }
    this.bossWrap.style.opacity = '1';
    this.bossName.textContent = e.def.display.toUpperCase();
    this.bossFill.style.width = `${Math.max(0, (e.health / e.maxHealth) * 100)}%`;
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
