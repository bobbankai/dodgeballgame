// HUD: DOM overlay. Health / ember / guard, heal charges, current art, boss bar, enemy bars, lock-on
// reticle, interaction prompt, subtitles, toasts, objective, chapter title cards, fades, death screen.
import * as THREE from 'three';
import '@fontsource/cinzel/latin-500.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/cormorant-garamond/latin-600.css';

const CSS = `
:root { --ember: #ff8a3a; --ember2: #ffcf7a; --blood: #b3242a; --ink: #0b0a0c; --paper: #efe4cf; --gold: #d9b26a; }
#hud { position: fixed; inset: 0; pointer-events: none; font-family: 'Cormorant Garamond', Georgia, serif; color: var(--paper); user-select: none; z-index: 5; }
#hud .bars { position: absolute; left: max(28px, env(safe-area-inset-left)); top: max(24px, env(safe-area-inset-top)); width: min(360px, 42vw); transition: opacity .6s; }
#hud .bar { position: relative; height: 10px; margin-bottom: 7px; background: rgba(10,8,10,.55); border: 1px solid rgba(217,178,106,.45); box-shadow: 0 0 12px rgba(0,0,0,.6); }
#hud .bar i { position: absolute; inset: 1px; transform-origin: left; transition: transform .12s; }
#hud .bar b { position: absolute; inset: 1px; transform-origin: left; background: rgba(255,240,220,.55); transition: transform .9s .35s; }
#hud .hp i { background: linear-gradient(90deg, #6d1218, #c7302f 70%, #e8584a); }
#hud .ember { height: 6px; width: 78%; }
#hud .ember i { background: linear-gradient(90deg, #8a2a05, var(--ember) 70%, var(--ember2)); box-shadow: 0 0 10px rgba(255,140,60,.8); }
#hud .ember.full i { animation: emberPulse 1.2s ease-in-out infinite; }
@keyframes emberPulse { 50% { filter: brightness(1.45); } }
#hud .guard { height: 4px; width: 55%; opacity: 0; transition: opacity .4s; }
#hud .guard i { background: linear-gradient(90deg, #8a8f9a, #e5e9f0); }
#hud .heals { display: flex; gap: 6px; margin-top: 8px; }
#hud .heals span { width: 14px; height: 18px; clip-path: polygon(50% 0, 100% 40%, 80% 100%, 20% 100%, 0 40%); background: linear-gradient(#ffd38a, #ff6a1a); box-shadow: 0 0 8px #ff7a2a; }
#hud .heals span.used { background: rgba(80,60,50,.6); box-shadow: none; }
#hud .status { display: flex; gap: 6px; margin-top: 8px; min-height: 22px; }
#hud .status .st { position: relative; width: 22px; height: 22px; border-radius: 4px; overflow: hidden; background: rgba(10,8,8,.55); border: 1px solid rgba(255,255,255,.18); }
#hud .status .st i { position: absolute; left: 0; right: 0; bottom: 0; transform-origin: bottom; }
#hud .status .st b { position: absolute; inset: 0; display: grid; place-items: center; font: 600 11px/1 'Cinzel', serif; color: #fff; text-shadow: 0 1px 2px #000; }
#hud .status .st.burn i { background: linear-gradient(#ffb347, #ff4a10); }
#hud .status .st.bleed i { background: linear-gradient(#ff5a5a, #7a0010); }
#hud .status .st.frost i { background: linear-gradient(#d8f4ff, #4aa8ff); }
#hud .status .st.blight i { background: linear-gradient(#c070ff, #2a0030); }
#hud .status .st.on { animation: stpulse .8s ease-in-out infinite alternate; }
@keyframes stpulse { from { box-shadow: 0 0 2px rgba(255,180,120,.4); } to { box-shadow: 0 0 10px rgba(255,180,120,.9); } }
#hud .art { position: absolute; left: max(28px, env(safe-area-inset-left)); bottom: max(28px, env(safe-area-inset-bottom)); font-family: Cinzel, serif; font-size: 15px; letter-spacing: .12em; opacity: .9; text-shadow: 0 0 8px #000; }
#hud .art small { display: block; font-family: 'Cormorant Garamond', serif; font-size: 13px; letter-spacing: 0; opacity: .7; }
#hud .boss { position: absolute; left: 50%; bottom: max(64px, calc(env(safe-area-inset-bottom) + 40px)); width: min(760px, 78vw); transform: translateX(-50%); opacity: 0; transition: opacity .8s; }
#hud .boss .name { font-family: Cinzel, serif; font-size: 18px; letter-spacing: .18em; margin-bottom: 6px; text-shadow: 0 0 10px #000, 0 0 2px #000; }
#hud .boss .bar { height: 9px; }
#hud .boss .bar i { background: linear-gradient(90deg, #5c0e12, #b5262a 60%, #e04a3c); }
#hud .boss .poise { height: 3px; margin-top: -4px; border: none; background: transparent; box-shadow: none; }
#hud .boss .poise i { background: linear-gradient(90deg, #ffd27a, #fff3c8); opacity: .9; }
#hud .lock { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 2px solid rgba(255,190,120,.9); border-radius: 50%; box-shadow: 0 0 10px rgba(255,140,60,.9); display: none; }
#hud .lock::after { content: ''; position: absolute; inset: 7px; border-radius: 50%; background: rgba(255,200,140,.9); }
#hud .ebar { position: absolute; width: 70px; height: 4px; margin-left: -35px; background: rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.18); display: none; }
#hud .ebar i { position: absolute; inset: 0; background: #c2302c; transform-origin: left; }
#hud .ebar.stagger { border-color: #ffd27a; box-shadow: 0 0 8px #ffc36a; }
#hud .prompt { position: absolute; left: 50%; bottom: 26%; transform: translateX(-50%); font-family: Cinzel, serif; font-size: 16px; letter-spacing: .12em; padding: 8px 18px; background: radial-gradient(ellipse at center, rgba(0,0,0,.55), rgba(0,0,0,0) 75%); opacity: 0; transition: opacity .3s; text-shadow: 0 0 6px #000; }
#hud .prompt kbd { font-family: Cinzel, serif; border: 1px solid var(--gold); padding: 1px 7px; margin-right: 8px; border-radius: 3px; color: var(--ember2); }
#hud .subs { position: absolute; left: 50%; bottom: max(12%, 90px); transform: translateX(-50%); width: min(980px, 88vw); text-align: center; font-size: clamp(18px, 2.3vw, 27px); line-height: 1.35; text-shadow: 0 2px 6px #000, 0 0 2px #000; opacity: 0; transition: opacity .35s; }
#hud .subs .who { display: block; font-family: Cinzel, serif; font-size: .62em; letter-spacing: .25em; color: var(--ember2); margin-bottom: 4px; }
#hud .toast { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); font-family: Cinzel, serif; font-size: 15px; letter-spacing: .15em; opacity: 0; transition: opacity .4s; text-shadow: 0 0 8px #000; }
#hud .obj { position: absolute; right: max(28px, env(safe-area-inset-right)); top: max(26px, env(safe-area-inset-top)); text-align: right; font-style: italic; font-size: 19px; max-width: 34vw; opacity: 0; transition: opacity .8s; text-shadow: 0 0 8px #000; }
#hud .obj::before { content: 'OBJECTIVE'; display: block; font-family: Cinzel, serif; font-style: normal; font-size: 11px; letter-spacing: .3em; color: var(--gold); }
#hud .card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; transition: opacity 1.4s; text-align: center; }
#hud .card .ch { font-family: Cinzel, serif; font-size: clamp(13px, 1.4vw, 17px); letter-spacing: .6em; color: var(--gold); margin-bottom: 14px; }
#hud .card .t { font-family: Cinzel, serif; font-size: clamp(36px, 6vw, 78px); letter-spacing: .14em; text-shadow: 0 0 30px rgba(255,140,60,.35), 0 4px 18px #000; }
#hud .card .s { font-style: italic; font-size: clamp(16px, 1.8vw, 24px); margin-top: 12px; opacity: .85; }
#hud .card .line { width: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--gold), transparent); margin: 18px 0; transition: width 2s .4s; }
#hud .card.on .line { width: min(520px, 60vw); }
#fade { position: fixed; inset: 0; background: #000; pointer-events: none; opacity: 1; z-index: 8; transition: opacity 1s; }
#hud .letterbox::before, #hud .letterbox::after { content: ''; position: absolute; left: 0; right: 0; height: 0; background: #000; transition: height .9s; }
#hud .letterbox::before { top: 0; } #hud .letterbox::after { bottom: 0; }
#hud .letterbox.on::before, #hud .letterbox.on::after { height: 10vh; }
#hud .death { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(40,0,0,.35), rgba(0,0,0,.85)); opacity: 0; transition: opacity 1.6s; }
#hud .death .t { font-family: Cinzel, serif; font-size: clamp(42px, 7vw, 92px); letter-spacing: .3em; color: #c63a33; text-shadow: 0 0 30px rgba(200,40,30,.6); }
#hud .death .s { margin-top: 18px; font-size: 20px; font-style: italic; opacity: .8; }
#hud .stats { position: absolute; right: 10px; bottom: 8px; font: 11px/1.3 ui-monospace, monospace; color: #9f9; text-align: right; text-shadow: 0 0 3px #000; display: none; white-space: pre; }
#hud.hidden .bars, #hud.hidden .art, #hud.hidden .obj { opacity: 0 !important; }
@media (max-width: 760px) { #hud .bars { width: 46vw; } #hud .obj { font-size: 15px; max-width: 46vw; } #hud .art { bottom: auto; top: 92px; } }
`;

function el(tag: string, cls: string, parent: HTMLElement, html = ''): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

export interface HudPlayer { hp: number; maxHp: number; ember: number; maxEmber: number; guard: number; heals: number; maxHeals: number; act: string | null; artIndex: number; artsUnlocked: number; status?: { view(): { kind: string; value: number; active: boolean }[] } }
export interface HudEnemy { hp: number; maxHp: number; dead: boolean; staggered: boolean; center(out?: THREE.Vector3): THREE.Vector3; poise: number; def: { poise: number; boss?: boolean; name: string } }

export class HUD {
  readonly root: HTMLElement;
  private hp: HTMLElement; private hpLag: HTMLElement; private ember: HTMLElement; private emberBar: HTMLElement;
  private guard: HTMLElement; private guardBar: HTMLElement; private heals: HTMLElement; private art: HTMLElement;
  private boss: HTMLElement; private bossName: HTMLElement; private bossHp: HTMLElement; private bossLag: HTMLElement; private bossPoise: HTMLElement;
  private lock: HTMLElement; private prompt: HTMLElement; private subs: HTMLElement; private toastEl: HTMLElement;
  private obj: HTMLElement; private card: HTMLElement; private fadeEl: HTMLElement; private letter: HTMLElement; private death: HTMLElement;
  stats: HTMLElement;
  private ebars: HTMLElement[] = [];
  private statusEl!: HTMLElement;
  private statusKey = '';
  private toastT = 0;
  bossTarget: HudEnemy | null = null;
  artNames: string[] = [];
  private lastHeals = -1;

  constructor() {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root = el('div', '', document.body);
    this.root.id = 'hud';
    const bars = el('div', 'bars', this.root);
    const hpb = el('div', 'bar hp', bars, '<b></b><i></i>');
    this.hpLag = hpb.querySelector('b')!;
    this.hp = hpb.querySelector('i')!;
    this.emberBar = el('div', 'bar ember', bars, '<i></i>');
    this.ember = this.emberBar.querySelector('i')!;
    this.guardBar = el('div', 'bar guard', bars, '<i></i>');
    this.guard = this.guardBar.querySelector('i')!;
    this.heals = el('div', 'heals', bars);
    this.statusEl = el('div', 'status', bars);
    this.art = el('div', 'art', this.root);
    this.boss = el('div', 'boss', this.root, '<div class="name"></div><div class="bar"><b></b><i></i></div><div class="bar poise"><i></i></div>');
    this.bossName = this.boss.querySelector('.name')!;
    this.bossHp = this.boss.querySelector('.bar i')!;
    this.bossLag = this.boss.querySelector('.bar b')!;
    this.bossPoise = this.boss.querySelector('.poise i')!;
    this.lock = el('div', 'lock', this.root);
    for (let i = 0; i < 8; i++) this.ebars.push(el('div', 'ebar', this.root, '<i></i>'));
    this.prompt = el('div', 'prompt', this.root);
    this.subs = el('div', 'subs', this.root);
    this.toastEl = el('div', 'toast', this.root);
    this.obj = el('div', 'obj', this.root);
    this.letter = el('div', 'letterbox', this.root);
    this.letter.style.cssText = 'position:absolute;inset:0;';
    this.card = el('div', 'card', this.root);
    this.death = el('div', 'death', this.root, '<div class="t">FALLEN</div><div class="s">The ember still burns. Rising again&hellip;</div>');
    this.stats = el('div', 'stats', this.root);
    this.fadeEl = document.createElement('div');
    this.fadeEl.id = 'fade';
    document.body.appendChild(this.fadeEl);
  }

  setVisible(v: boolean): void { this.root.classList.toggle('hidden', !v); }

  fade(to: number, dur = 1): Promise<void> {
    this.fadeEl.style.transition = `opacity ${dur}s`;
    this.fadeEl.style.opacity = String(to);
    return new Promise((r) => window.setTimeout(r, dur * 1000));
  }

  letterbox(on: boolean): void { this.letter.classList.toggle('on', on); }

  toast(text: string, dur = 2.2): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    this.toastT = dur;
  }

  objective(text: string | null): void {
    if (!text) { this.obj.style.opacity = '0'; return; }
    this.obj.innerHTML = '';
    this.obj.appendChild(document.createTextNode(text));
    this.obj.style.opacity = '1';
  }

  setPrompt(text: string | null, key = 'E'): void {
    if (!text) { this.prompt.style.opacity = '0'; return; }
    this.prompt.innerHTML = `<kbd>${key}</kbd>${text}`;
    this.prompt.style.opacity = '1';
  }

  say(who: string | null, text: string | null): void {
    if (!text) { this.subs.style.opacity = '0'; return; }
    this.subs.innerHTML = (who ? `<span class="who">${who}</span>` : '') + text;
    this.subs.style.opacity = '1';
  }

  async chapterCard(ch: string, title: string, sub: string, hold = 4): Promise<void> {
    this.card.innerHTML = `<div class="ch">${ch}</div><div class="t">${title}</div><div class="line"></div><div class="s">${sub}</div>`;
    this.card.style.opacity = '1';
    requestAnimationFrame(() => this.card.classList.add('on'));
    await new Promise((r) => window.setTimeout(r, hold * 1000));
    this.card.style.opacity = '0';
    this.card.classList.remove('on');
  }

  showDeath(on: boolean): void { this.death.style.opacity = on ? '1' : '0'; }

  setBoss(e: HudEnemy | null): void {
    this.bossTarget = e;
    this.boss.style.opacity = e ? '1' : '0';
    if (e) this.bossName.textContent = e.def.name;
  }

  update(dt: number, p: HudPlayer, cam: THREE.Camera, enemies: HudEnemy[], lock: HudEnemy | null, w: number, h: number): void {
    this.hp.style.transform = `scaleX(${Math.max(0, p.hp / p.maxHp)})`;
    this.hpLag.style.transform = `scaleX(${Math.max(0, p.hp / p.maxHp)})`;
    this.ember.style.transform = `scaleX(${p.ember / p.maxEmber})`;
    this.emberBar.classList.toggle('full', p.ember >= 35);
    this.guard.style.transform = `scaleX(${p.guard / 100})`;
    this.guardBar.style.opacity = p.act === 'block' || p.guard < 99 ? '1' : '0';
    if (this.lastHeals !== p.heals) {
      this.lastHeals = p.heals;
      this.heals.innerHTML = Array.from({ length: p.maxHeals }, (_, i) => `<span class="${i < p.heals ? '' : 'used'}"></span>`).join('');
    }
    // status effects: a chip each, filled by how far along it is
    if (p.status) {
      const v = p.status.view();
      const key = v.map((x) => `${x.kind}${x.active ? '!' : ''}${Math.round(x.value * 20)}`).join(',');
      if (key !== this.statusKey) {
        this.statusKey = key;
        const label: Record<string, string> = { burn: 'B', bleed: 'Bl', frost: 'F', blight: 'X' };
        this.statusEl.innerHTML = v.map((x) => `<div class="st ${x.kind}${x.active ? ' on' : ''}" title="${x.kind}"><i style="height:${Math.round(x.value * 100)}%"></i><b>${label[x.kind] ?? ''}</b></div>`).join('');
      }
    }
    const an = this.artNames[p.artIndex] ?? '';
    this.art.innerHTML = p.artsUnlocked > 0 ? `${an}<small>${p.artsUnlocked > 1 ? 'Art ' + (p.artIndex + 1) + ' of ' + p.artsUnlocked : 'Ember art'}</small>` : '';
    if (this.bossTarget) {
      const b = this.bossTarget;
      this.bossHp.style.transform = `scaleX(${Math.max(0, b.hp / b.maxHp)})`;
      this.bossLag.style.transform = `scaleX(${Math.max(0, b.hp / b.maxHp)})`;
      this.bossPoise.style.transform = `scaleX(${b.staggered ? 1 : Math.max(0, 1 - b.poise / b.def.poise)})`;
      if (b.dead) this.setBoss(null);
    }
    const v = new THREE.Vector3();
    const project = (p3: THREE.Vector3): [number, number, boolean] => {
      v.copy(p3).project(cam);
      return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, v.z < 1];
    };
    if (lock && !lock.dead) {
      const [x, y, vis] = project(lock.center());
      this.lock.style.display = vis ? 'block' : 'none';
      this.lock.style.left = x + 'px';
      this.lock.style.top = y + 'px';
    } else this.lock.style.display = 'none';
    let k = 0;
    for (const e of enemies) {
      if (k >= this.ebars.length) break;
      if (e.dead || e.def.boss || (e.hp >= e.maxHp && !e.staggered)) continue;
      const c = e.center();
      c.y += 0.75;
      const [x, y, vis] = project(c);
      if (!vis) continue;
      const b = this.ebars[k++];
      b.style.display = 'block';
      b.style.left = x + 'px';
      b.style.top = y + 'px';
      b.classList.toggle('stagger', e.staggered);
      (b.firstChild as HTMLElement).style.transform = `scaleX(${Math.max(0, e.hp / e.maxHp)})`;
    }
    for (; k < this.ebars.length; k++) this.ebars[k].style.display = 'none';
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.style.opacity = '0';
    }
  }
}
