import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { formatTime } from '../core/math';
import type { Athlete } from '../game/Athlete';
import type { PlayerController } from '../game/PlayerController';
import type { World } from '../game/World';
import { h, ICONS, svg } from './dom';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

interface Tag {
  el: HTMLElement;
  hp: HTMLElement;
  nm: HTMLElement;
  athlete: Athlete;
  lastHearts: number;
  lastMax: number;
}

/** In-match HUD. Minimal, readable, driven every frame from game state. */
export class HUD {
  readonly el: HTMLElement;
  private homeScore!: HTMLElement;
  private awayScore!: HTMLElement;
  private homeName!: HTMLElement;
  private awayName!: HTMLElement;
  private homePips!: HTMLElement;
  private awayPips!: HTMLElement;
  private clock!: HTMLElement;
  private roundEl!: HTMLElement;
  private objective!: HTMLElement;
  private hearts!: HTMLElement;
  private playerName!: HTMLElement;
  private stamina!: HTMLElement;
  private staminaFill!: HTMLElement;
  private dodges!: HTMLElement;
  private abilitySlot!: HTMLElement;
  private abilityRing!: SVGCircleElement;
  private abilityLabel!: HTMLElement;
  private ultSlot!: HTMLElement;
  private ultRing!: SVGCircleElement;
  private chargeSvg!: SVGElement;
  private chargeFg!: SVGCircleElement;
  private catchWin!: HTMLElement;
  private noBall!: HTMLElement;
  private reticle!: HTMLElement;
  private lock!: HTMLElement;
  private threats!: HTMLElement;
  private announceEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private tags: Tag[] = [];
  private tagLayer!: HTMLElement;
  private lastHearts = -1;
  private pipCache = '';
  showFps = false;
  abilityInfo: { name: string; cost: number; icon: string } | null = null;
  ultInfo: { name: string } | null = null;

  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'hud' });
    this.build();
    parent.appendChild(this.el);
  }

  private build() {
    const E = this.el;
    // top scoreboard
    this.homeScore = h('div', { class: 'hud-score' }, '0');
    this.awayScore = h('div', { class: 'hud-score' }, '0');
    this.homeName = h('div', { class: 'hud-team-name' }, 'HOME');
    this.awayName = h('div', { class: 'hud-team-name' }, 'AWAY');
    this.homePips = h('div', { class: 'hud-pips' });
    this.awayPips = h('div', { class: 'hud-pips' });
    this.clock = h('div', { class: 'hud-clock' }, '1:40');
    this.roundEl = h('div', { class: 'hud-round' }, 'Round 1');
    E.append(
      h(
        'div',
        { class: 'hud-top' },
        h('div', { class: 'hud-team home' }, this.homeName, this.homePips, this.homeScore),
        h('div', { class: 'hud-center' }, this.clock, this.roundEl),
        h('div', { class: 'hud-team away' }, this.awayName, this.awayPips, this.awayScore),
      ),
    );
    this.objective = h('div', { class: 'hud-objective' });
    E.append(this.objective);

    // player panel
    this.playerName = h('div', { class: 'hud-player-name' });
    this.hearts = h('div', { class: 'hud-hearts' });
    this.staminaFill = h('div');
    this.stamina = h('div', { class: 'hud-bar stamina' }, this.staminaFill);
    this.dodges = h('div', { class: 'hud-dodges' });
    E.append(h('div', { class: 'hud-player' }, this.playerName, this.hearts, h('div', { class: 'hud-bars' }, this.stamina), this.dodges));

    // ability slots
    const ring = (r: number) =>
      svg(`<svg class="ring" viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="${r}"/><circle class="fg" cx="50" cy="50" r="${r}" stroke-dasharray="${(2 * Math.PI * r).toFixed(1)}" stroke-dashoffset="0"/></svg>`);
    const aRing = ring(44);
    this.abilityRing = aRing.querySelector('.fg') as SVGCircleElement;
    this.abilityLabel = h('div', { class: 'hud-slot-label' }, 'Ability');
    this.abilitySlot = h('div', { class: 'hud-slot' }, aRing, h('div', { class: 'core', html: ICONS.bolt }), h('div', { class: 'hud-key' }, 'Q'), this.abilityLabel);
    const uRing = ring(44);
    uRing.insertAdjacentHTML('afterbegin', '<defs><linearGradient id="ultGrad" x1="0" x2="1"><stop offset="0" stop-color="#ff6a3d"/><stop offset="1" stop-color="#ffd166"/></linearGradient></defs>');
    this.ultRing = uRing.querySelector('.fg') as SVGCircleElement;
    this.ultSlot = h('div', { class: 'hud-slot ult' }, uRing, h('div', { class: 'core', html: ICONS.sun }), h('div', { class: 'hud-key' }, 'R'), h('div', { class: 'hud-slot-label' }, 'Ultimate'));
    E.append(h('div', { class: 'hud-abilities' }, this.abilitySlot, this.ultSlot));

    // reticle
    this.chargeSvg = svg(`<svg class="charge" viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44" stroke-dasharray="276.5" stroke-dashoffset="276.5"/></svg>`);
    this.chargeFg = this.chargeSvg.querySelector('.fg') as SVGCircleElement;
    this.catchWin = h('div', { class: 'catchwin' });
    this.noBall = h('div', { class: 'noball' });
    this.reticle = h('div', { class: 'reticle' }, h('div', { class: 'brackets' }, h('i'), h('i'), h('i'), h('i')), h('div', { class: 'dot' }), this.chargeSvg, this.catchWin, this.noBall);
    E.append(this.reticle);
    this.lock = h('div', { class: 'lock' }, svg(`<svg viewBox="0 0 60 60"><path d="M6 20V6h14M40 6h14v14M54 40v14H40M20 54H6V40"/></svg>`));
    E.append(this.lock);
    this.threats = h('div', { class: 'threats' });
    E.append(this.threats);
    this.tagLayer = h('div');
    E.append(this.tagLayer);
    this.announceEl = h('div', { class: 'announce' });
    E.append(this.announceEl);
    this.hintEl = h('div', { class: 'hint' });
    E.append(this.hintEl);
    this.fpsEl = h('div', { class: 'fps' });
    E.append(this.fpsEl);
  }

  show(on: boolean) {
    this.el.classList.toggle('visible', on);
  }

  setTeams(homeName: string, awayName: string) {
    this.homeName.textContent = homeName;
    this.awayName.textContent = awayName;
  }

  setObjective(text: string) {
    this.objective.textContent = text;
  }

  announce(text: string, sub = '', style = 'info') {
    const item = h('div', { class: `a-item ${style}` }, h('div', { class: 'a-main' }, text), sub ? h('div', { class: 'a-sub' }, sub) : null);
    // replace current (keep only the latest to stay readable)
    this.announceEl.innerHTML = '';
    this.announceEl.append(item);
  }

  hint(html: string | null, sub?: string) {
    if (!html) {
      this.hintEl.classList.remove('on');
      return;
    }
    this.hintEl.innerHTML = html + (sub ? `<span class="sub">${sub}</span>` : '');
    this.hintEl.classList.add('on');
  }

  buildTags(world: World) {
    this.tagLayer.innerHTML = '';
    this.tags = [];
    for (const a of world.athletes) {
      if (a.isPlayer) continue;
      const nm = h('div', { class: 'nm' }, a.name);
      const hp = h('div', { class: 'hp' });
      const el = h('div', { class: `nametag ${a.team === 0 ? 'home' : 'away'}` }, nm, hp);
      this.tagLayer.append(el);
      this.tags.push({ el, hp, nm, athlete: a, lastHearts: -1, lastMax: -1 });
    }
  }

  update(world: World, player: Athlete | null, pc: PlayerController | null, camera: THREE.PerspectiveCamera, fps: number) {
    const m = world.match;
    if (!m) return;
    const W = window.innerWidth, H = window.innerHeight;
    this.homeScore.textContent = String(m.score[0]);
    this.awayScore.textContent = String(m.score[1]);
    const tl = m.config.timeLimit > 0 ? m.timeRemaining : 0;
    this.clock.textContent = m.config.mode === 'tutorial' ? 'PRACTICE' : m.config.mode === 'survival' ? `W${m.wave + 1}` : m.suddenDeath ? 'SD' : formatTime(tl);
    this.clock.classList.toggle('low', m.config.timeLimit > 0 && tl < 10 && m.phase === 'playing');
    this.roundEl.textContent = m.config.mode === 'tutorial' ? 'Coach Marla' : m.config.mode === 'timeAttack' ? 'Time attack' : m.config.mode === 'survival' ? `Wave ${m.wave + 1}/${m.config.waves?.length ?? 1}` : `Round ${m.round} · First to ${m.config.roundsToWin}`;

    // team pips
    const pipKey = [...m.home, ...m.away].map((a) => `${a.hearts}/${a.maxHearts}/${a.active ? 1 : 0}`).join(',') + m.away.length;
    if (pipKey !== this.pipCache) {
      this.pipCache = pipKey;
      const pips = (list: Athlete[], el: HTMLElement) => {
        el.innerHTML = '';
        for (const a of list) {
          const p = h('div', { class: `hud-pip${a.active ? '' : ' out'}${a.isPlayer ? ' player' : ''}`, title: a.name });
          for (let i = 0; i < a.maxHearts; i++) p.append(h('i', { class: i < a.hearts ? '' : 'empty' }));
          el.append(p);
        }
      };
      pips(m.home, this.homePips);
      pips(m.away, this.awayPips);
    }

    if (player) {
      if (this.lastHearts !== player.hearts * 10 + player.maxHearts) {
        const hit = this.lastHearts > player.hearts * 10 + player.maxHearts;
        this.lastHearts = player.hearts * 10 + player.maxHearts;
        this.hearts.innerHTML = '';
        for (let i = 0; i < player.maxHearts; i++) {
          const s = svg(ICONS.heart);
          if (i >= player.hearts) s.classList.add('empty');
          if (hit && i === player.hearts) s.classList.add('hit');
          this.hearts.append(s);
        }
        this.playerName.innerHTML = `${player.name}<small>#${player.profile.number ?? 7}</small>`;
      }
      const st = player.stamina / player.stats.staminaMax;
      this.staminaFill.style.transform = `scaleX(${st.toFixed(3)})`;
      this.stamina.classList.toggle('low', st < 0.25);
      const dc = player.stats.dodgeCharges;
      if (this.dodges.childElementCount !== dc + 1) {
        this.dodges.innerHTML = '';
        this.dodges.append(h('span', {}, 'DODGE'));
        for (let i = 0; i < dc; i++) this.dodges.append(h('div', { class: 'hud-dodge' }, h('div')));
      }
      const fills = this.dodges.querySelectorAll('.hud-dodge > div');
      fills.forEach((f, i) => {
        let v = i < player.dodgeCharges ? 1 : i === player.dodgeCharges ? 1 - player.dodgeRecharge / player.stats.dodgeRecharge : 0;
        v = Math.max(0, Math.min(1, v));
        (f as HTMLElement).style.transform = `scaleX(${v.toFixed(3)})`;
        (f as HTMLElement).style.opacity = i < player.dodgeCharges ? '1' : '0.45';
      });

      // abilities
      const circ = 2 * Math.PI * 44;
      if (this.abilityInfo) {
        this.abilitySlot.classList.remove('locked');
        const e = Math.min(1, player.energy / this.abilityInfo.cost);
        this.abilityRing.style.strokeDashoffset = String(circ * (1 - e));
        this.abilitySlot.classList.toggle('ready', e >= 1 || player.powerArmed || player.phantomArmed);
        this.abilityLabel.textContent = this.abilityInfo.name;
        const core = this.abilitySlot.querySelector('.core')!;
        if (core.getAttribute('data-ic') !== this.abilityInfo.icon) {
          core.innerHTML = (ICONS as any)[this.abilityInfo.icon] ?? ICONS.bolt;
          core.setAttribute('data-ic', this.abilityInfo.icon);
        }
      } else {
        this.abilitySlot.classList.add('locked');
        this.abilityRing.style.strokeDashoffset = String(circ);
        this.abilityLabel.textContent = 'Locked';
      }
      if (this.ultInfo) {
        this.ultSlot.classList.remove('locked');
        const u = player.ult / TUNING.ult.max;
        this.ultRing.style.strokeDashoffset = String(circ * (1 - u));
        this.ultSlot.classList.toggle('ready', u >= 1);
      } else {
        this.ultSlot.classList.add('locked');
        this.ultRing.style.strokeDashoffset = String(circ);
      }

      // reticle
      const charging = player.state === 'charging' || player.state === 'power';
      this.chargeSvg.classList.toggle('on', charging);
      if (charging) {
        const c = player.charge;
        this.chargeFg.style.strokeDashoffset = String(276.5 * (1 - c));
        const perfect = player.fullTime >= 0 && player.fullTime <= player.stats.perfectReleaseWindow;
        this.chargeFg.classList.toggle('full', c >= 1 && !perfect);
        this.chargeFg.classList.toggle('perfect', perfect);
        this.chargeFg.classList.toggle('power', player.state === 'power');
      }
      const inWindow = player.state === 'catching';
      this.catchWin.classList.toggle('on', inWindow);
      const br = this.reticle.querySelector('.brackets') as HTMLElement;
      const spread = 38 + Math.hypot(player.vel.x, player.vel.z) * 4 - (charging ? 10 * player.charge : 0);
      br.style.width = br.style.height = `${spread}px`;
      br.style.margin = `${-spread / 2}px 0 0 ${-spread / 2}px`;
      this.noBall.textContent = player.ball ? '' : player.active ? (player.state === 'catching' ? 'CATCH!' : '') : '';
      this.reticle.style.opacity = player.active ? '1' : '0';
    }

    // lock target
    const lt = pc?.lockTarget;
    if (lt && player?.active && player.ball) {
      lt.chestPos(_v);
      _v.project(camera);
      if (_v.z < 1) {
        this.lock.style.left = `${(_v.x * 0.5 + 0.5) * W}px`;
        this.lock.style.top = `${(-_v.y * 0.5 + 0.5) * H}px`;
        this.lock.classList.add('on');
      } else this.lock.classList.remove('on');
    } else this.lock.classList.remove('on');

    // threat indicators for live balls heading at the player
    this.updateThreats(world, player, camera);

    // nametags
    for (const t of this.tags) {
      const a = t.athlete;
      const visible = !a.isOut && a.dissolve < 0.5 && a.state !== 'out';
      if (!visible) {
        t.el.style.opacity = '0';
        continue;
      }
      _v.set(a.pos.x, a.pos.y + a.y + 2.05 * a.rig.height, a.pos.z);
      _v.project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) {
        t.el.style.opacity = '0';
        continue;
      }
      const dist = camera.position.distanceTo(a.pos);
      t.el.style.opacity = String(Math.max(0.35, Math.min(1, 1.4 - dist / 26)));
      t.el.style.left = `${(_v.x * 0.5 + 0.5) * W}px`;
      t.el.style.top = `${(-_v.y * 0.5 + 0.5) * H}px`;
      const hk = a.hearts * 100 + a.maxHearts * 10 + (a.ball ? 1 : 0) + (a.isWindingUp ? 2 : 0);
      if (hk !== t.lastHearts) {
        t.lastHearts = hk;
        t.hp.innerHTML = '';
        for (let i = 0; i < a.maxHearts; i++) t.hp.append(h('i', { class: i < a.hearts ? '' : 'e' }));
        t.nm.innerHTML = '';
        t.nm.append(document.createTextNode(a.name));
        if (a.ball) t.nm.append(h('span', { class: `ballic${a.isWindingUp && a.team === 1 ? ' winding' : ''}` }));
      }
    }

    this.fpsEl.textContent = this.showFps ? `${fps.toFixed(0)} fps` : '';
  }

  private updateThreats(world: World, player: Athlete | null, camera: THREE.PerspectiveCamera) {
    const items: { ang: number; urgent: boolean }[] = [];
    if (player && player.active) {
      player.chestPos(_v2);
      for (const b of world.balls.balls) {
        if (!b.live || !b.thrower || b.thrower.team === player.team || b.hiddenTimer > 0) continue;
        const rel = _v.copy(_v2).sub(b.pos);
        const dist = rel.length();
        const sp = b.vel.length();
        if (sp < 1) continue;
        const closing = rel.dot(b.vel) / (dist * sp);
        if (closing < 0.9) continue;
        const tti = dist / sp;
        if (tti > 1.3) continue;
        // direction on screen: project ball relative to camera
        const p = b.pos.clone().project(camera);
        let ang: number;
        if (p.z < 1 && Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9) ang = Math.atan2(p.x, p.y);
        else {
          const local = b.pos.clone().applyMatrix4(camera.matrixWorldInverse);
          ang = Math.atan2(local.x, local.y + (local.z > 0 ? -1 : 0));
          if (local.z > 0) ang = Math.PI - ang;
        }
        items.push({ ang, urgent: tti < 0.45 });
      }
    }
    while (this.threats.childElementCount < items.length) this.threats.append(h('div', { class: 'threat' }, h('i')));
    const kids = Array.from(this.threats.children) as HTMLElement[];
    kids.forEach((k, i) => {
      const it = items[i];
      if (!it) {
        k.style.display = 'none';
        return;
      }
      k.style.display = '';
      k.style.transform = `rotate(${it.ang}rad)`;
      k.classList.toggle('urgent', it.urgent);
    });
  }
}
