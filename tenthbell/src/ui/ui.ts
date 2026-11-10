// Everything drawn over the game: the fight HUD, subtitles and story cards, menus, and the touch controls.
import '@fontsource/anton/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600.css';
import { Input } from '../game/input';
import { Button } from '../game/moves';

const CSS = `
#ui { position: fixed; inset: 0; pointer-events: none; color: #f3efe6; font-family: 'Barlow Condensed', system-ui, sans-serif; overflow: hidden;
  --pad: max(14px, env(safe-area-inset-left)); --u: clamp(9px, 1.55vmin, 18px); }
#ui * { box-sizing: border-box; }
#ui .layer { position: absolute; inset: 0; }
#fade { background: #000; opacity: 1; transition: opacity 0.6s linear; }
#flash { background: #fff; opacity: 0; }
#bars::before, #bars::after { content: ''; position: absolute; left: 0; right: 0; height: 11vh; background: #000; transition: transform 0.7s cubic-bezier(.3,.7,.2,1); }
#bars::before { top: 0; transform: translateY(-101%); } #bars::after { bottom: 0; transform: translateY(101%); }
#bars.on::before, #bars.on::after { transform: none; }

/* ---- fight HUD */
#hud { opacity: 0; transition: opacity 0.4s; padding: calc(var(--u) * 1.2) var(--pad); }
#hud.on { opacity: 1; }
#hud .top { display: grid; grid-template-columns: 1fr auto 1fr; gap: calc(var(--u) * 1.4); align-items: start; }
#hud .side { display: flex; flex-direction: column; gap: calc(var(--u) * 0.35); }
#hud .side.r { align-items: flex-end; }
#hud .name { font-weight: 700; font-size: calc(var(--u) * 1.7); letter-spacing: 0.14em; text-shadow: 0 2px 8px #000; white-space: nowrap; }
#hud .hp { position: relative; width: 100%; height: calc(var(--u) * 1.55); background: rgba(10,10,12,0.72); transform: skewX(-18deg); outline: 1px solid rgba(255,255,255,0.28); overflow: hidden; }
#hud .r .hp { transform: skewX(18deg); }
#hud .hp i { position: absolute; top: 0; bottom: 0; left: 0; width: 100%; transform-origin: left; }
#hud .r .hp i { left: auto; right: 0; transform-origin: right; }
#hud .hp .ghost { background: #f4e9c8; transition: transform 0.7s 0.35s cubic-bezier(.5,0,.5,1); }
#hud .hp .fill { background: linear-gradient(180deg, #ffd9a0 0%, #e8552e 45%, #a8201c 100%); transition: transform 0.08s linear; }
#hud .hp.low .fill { animation: low 0.5s steps(2) infinite; }
@keyframes low { 50% { filter: brightness(1.7); } }
#hud .guard { width: 62%; height: calc(var(--u) * 0.42); background: rgba(10,10,12,0.6); overflow: hidden; }
#hud .guard i { display: block; height: 100%; background: #9fd0e6; transform-origin: left; transition: transform 0.1s linear; }
#hud .r .guard i { transform-origin: right; }
#hud .pips { display: flex; gap: calc(var(--u) * 0.5); }
#hud .pips b { width: calc(var(--u) * 1.0); height: calc(var(--u) * 1.0); border: 2px solid rgba(255,255,255,0.75); border-radius: 50% 50% 46% 46%; background: transparent; }
#hud .pips b.won { background: #e7b24a; border-color: #ffe6ae; box-shadow: 0 0 10px #e7b24a; }
#hud .clock { font-family: Anton, sans-serif; font-size: calc(var(--u) * 3.6); line-height: 0.9; min-width: 2.2ch; text-align: center; text-shadow: 0 3px 14px #000; }
#hud .bottom { position: absolute; left: var(--pad); right: var(--pad); bottom: calc(var(--u) * 1.3); display: flex; justify-content: space-between; align-items: flex-end; }
#hud .meter { width: 30%; }
#hud .meter span { font-weight: 700; letter-spacing: 0.22em; font-size: calc(var(--u) * 1.05); opacity: 0.85; }
#hud .meter div { height: calc(var(--u) * 0.75); background: rgba(10,10,12,0.7); outline: 1px solid rgba(255,255,255,0.22); position: relative; overflow: hidden; }
#hud .meter div::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: rgba(0,0,0,0.8); }
#hud .meter i { display: block; height: 100%; background: linear-gradient(90deg, #7a5a18, #f0c35a); transform-origin: left; transition: transform 0.12s linear; }
#hud .meter.r { text-align: right; } #hud .meter.r i { transform-origin: right; background: linear-gradient(270deg, #7a5a18, #f0c35a); }
#hud .meter.ready i { filter: brightness(1.5) drop-shadow(0 0 6px #f0c35a); }
#hud .call { position: absolute; top: 24%; font-family: Anton, sans-serif; font-size: calc(var(--u) * 2.6); letter-spacing: 0.05em; text-shadow: 0 3px 12px #000; opacity: 0; }
#hud .call.l { left: var(--pad); } #hud .call.r { right: var(--pad); text-align: right; }
#hud .call small { display: block; font-family: 'Barlow Condensed'; font-weight: 700; font-size: 0.5em; letter-spacing: 0.25em; color: #f0c35a; }
#hud .call.show { animation: call 1.1s ease-out forwards; }
@keyframes call { 0% { opacity: 0; transform: scale(1.5); } 12% { opacity: 1; transform: none; } 75% { opacity: 1; } 100% { opacity: 0; } }
#announce { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
#announce b { font-family: Anton, sans-serif; font-weight: 400; font-size: clamp(44px, 13vmin, 150px); letter-spacing: 0.06em; line-height: 1; text-shadow: 0 6px 30px rgba(0,0,0,0.9); opacity: 0; }
#announce em { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: clamp(18px, 3.4vmin, 34px); opacity: 0; margin-top: 0.4em; text-shadow: 0 2px 10px #000; }
#announce.show b { animation: ann var(--d, 1.4s) cubic-bezier(.2,.9,.3,1) forwards; } #announce.show em { animation: ann var(--d, 1.4s) 0.15s cubic-bezier(.2,.9,.3,1) forwards; }
#announce.ko b { color: #ffd9a0; font-size: clamp(60px, 22vmin, 240px); }
@keyframes ann { 0% { opacity: 0; transform: scale(2.2); letter-spacing: 0.4em; } 14% { opacity: 1; transform: none; letter-spacing: 0.06em; } 80% { opacity: 1; } 100% { opacity: 0; transform: scale(0.96); } }

/* ---- story */
#sub { display: flex; align-items: flex-end; justify-content: center; padding: 0 8vw 13vh; }
#sub div { max-width: 46em; text-align: center; opacity: 0; transition: opacity 0.25s; }
#sub.on div { opacity: 1; }
#sub span { display: block; font-weight: 700; letter-spacing: 0.3em; font-size: clamp(12px, 1.9vmin, 18px); margin-bottom: 0.35em; }
#sub p { margin: 0; font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: clamp(19px, 3.6vmin, 36px); line-height: 1.25; text-shadow: 0 2px 6px #000, 0 0 22px rgba(0,0,0,0.9); }
#sub p.thought { font-style: italic; font-weight: 500; }
#card { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; opacity: 0; transition: opacity 1.2s; }
#card.on { opacity: 1; }
#card small { font-weight: 700; letter-spacing: 0.5em; font-size: clamp(12px, 2vmin, 20px); color: #e7b24a; }
#card b { font-family: Anton, sans-serif; font-weight: 400; font-size: clamp(34px, 9vmin, 110px); letter-spacing: 0.1em; margin: 0.15em 0; }
#card em { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: clamp(17px, 3.2vmin, 32px); max-width: 30em; opacity: 0.9; white-space: pre-line; }
#hint { display: flex; justify-content: center; align-items: flex-start; padding-top: 19vh; }
#hint div { background: rgba(8,8,10,0.72); border-left: 3px solid #e7b24a; padding: 0.55em 1.1em; font-size: clamp(15px, 2.6vmin, 24px); font-weight: 500; letter-spacing: 0.06em; opacity: 0; transition: opacity 0.3s; max-width: 80vw; }
#hint.on div { opacity: 1; } #hint kbd { font: inherit; font-weight: 700; color: #f0c35a; border: 1px solid rgba(240,195,90,0.6); padding: 0 0.4em; border-radius: 4px; margin: 0 0.15em; }
#skip { position: absolute; right: var(--pad); bottom: 3vh; font-weight: 500; letter-spacing: 0.2em; font-size: clamp(11px, 1.7vmin, 15px); opacity: 0; transition: opacity 0.4s; pointer-events: auto; background: none; border: 0; color: inherit; font-family: inherit; padding: 1em; cursor: pointer; }
#skip.on { opacity: 0.6; }

/* ---- menus */
#menu { display: none; flex-direction: column; justify-content: center; padding: 0 9vw; pointer-events: auto; background: linear-gradient(90deg, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.55) 46%, rgba(0,0,0,0) 78%); }
#menu.on { display: flex; }
#menu.center { align-items: center; text-align: center; background: rgba(0,0,0,0.78); }
#menu h1 { font-family: Anton, sans-serif; font-weight: 400; font-size: clamp(40px, 12vmin, 150px); letter-spacing: 0.08em; line-height: 0.95; margin: 0; }
#menu h1 i { font-style: normal; color: #e7b24a; }
#menu h2 { font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 500; font-size: clamp(16px, 3vmin, 30px); margin: 0.5em 0 1.6em; opacity: 0.85; }
#menu button { display: block; background: none; border: 0; color: inherit; font-family: inherit; font-weight: 700; font-size: clamp(18px, 3.6vmin, 34px); letter-spacing: 0.22em; padding: 0.32em 0; cursor: pointer; opacity: 0.62; text-align: inherit; transition: opacity 0.15s, transform 0.15s, color 0.15s; }
#menu button small { display: block; font-weight: 500; font-size: 0.5em; letter-spacing: 0.12em; opacity: 0.8; }
#menu button.sel, #menu button:hover { opacity: 1; color: #f0c35a; transform: translateX(0.5em); }
#menu.center button.sel, #menu.center button:hover { transform: scale(1.06); }
#menu .foot { position: absolute; left: 9vw; bottom: 4vh; font-size: clamp(11px, 1.6vmin, 15px); letter-spacing: 0.18em; opacity: 0.5; }
#load { display: flex; align-items: flex-end; justify-content: flex-end; padding: 6vh var(--pad); font-weight: 500; letter-spacing: 0.3em; font-size: clamp(12px, 1.8vmin, 16px); opacity: 0; transition: opacity 0.3s; }
#load.on { opacity: 0.85; } #load::after { content: ''; width: 1em; height: 1em; margin-left: 1em; border: 2px solid #e7b24a; border-top-color: transparent; border-radius: 50%; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---- touch */
#touch { display: none; pointer-events: none; }
#touch.on { display: block; }
#touch button { position: absolute; pointer-events: auto; touch-action: none; border-radius: 50%; border: 2px solid rgba(255,255,255,0.4); background: rgba(12,12,14,0.38); color: #fff; font-family: inherit; font-weight: 700;
  letter-spacing: 0.08em; font-size: clamp(11px, 2.6vmin, 18px); width: 15vmin; height: 15vmin; max-width: 96px; max-height: 96px; -webkit-tap-highlight-color: transparent; }
#touch button.dn { background: rgba(240,195,90,0.5); border-color: #f0c35a; }
#touch .dl { left: calc(var(--pad) + 1vmin); bottom: 9vmin; } #touch .dr { left: calc(var(--pad) + 19vmin); bottom: 9vmin; }
#touch .bL { right: calc(var(--pad) + 18vmin); bottom: 17vmin; } #touch .bK { right: calc(var(--pad) + 9vmin); bottom: 3vmin; }
#touch .bH { right: calc(var(--pad) + 1vmin); bottom: 20vmin; } #touch .bS { right: calc(var(--pad) + 10vmin); bottom: 35vmin; border-color: #f0c35a; color: #f0c35a; }
#touch .bG { right: calc(var(--pad) + 27vmin); bottom: 2vmin; border-radius: 18%; } #touch .bD { left: calc(var(--pad) + 10vmin); bottom: 27vmin; width: 12vmin; height: 12vmin; }
#touch .bP { right: var(--pad); top: 16vmin; width: 9vmin; height: 9vmin; font-size: 2.4vmin; opacity: 0.7; }
@media (orientation: portrait) { #rotate { display: flex !important; } }
#rotate { display: none; align-items: center; justify-content: center; background: #050507; font-weight: 700; letter-spacing: 0.3em; font-size: 4vmin; text-align: center; }
`;

const HTML = `
<div class="layer" id="bars"></div>
<div class="layer" id="hud">
  <div class="top">
    <div class="side l"><div class="name"></div><div class="hp"><i class="ghost"></i><i class="fill"></i></div><div class="guard"><i></i></div><div class="pips"></div></div>
    <div class="clock">60</div>
    <div class="side r"><div class="name"></div><div class="hp"><i class="ghost"></i><i class="fill"></i></div><div class="guard"><i></i></div><div class="pips"></div></div>
  </div>
  <div class="call l"></div><div class="call r"></div>
  <div class="bottom"><div class="meter l"><span>RESOLVE</span><div><i></i></div></div><div class="meter r"><span>RESOLVE</span><div><i></i></div></div></div>
</div>
<div class="layer" id="announce"><b></b><em></em></div>
<div class="layer" id="hint"><div></div></div>
<div class="layer" id="flash"></div>
<div class="layer" id="fade"></div>
<div class="layer" id="card"><small></small><b></b><em></em></div>
<div class="layer" id="sub"><div><span></span><p></p></div></div>
<button id="skip">HOLD TO SKIP ▸▸</button>
<div class="layer" id="touch">
  <button class="dl" data-dir="-1">◀</button><button class="dr" data-dir="1">▶</button><button class="bD" data-b="D">DASH</button>
  <button class="bS" data-b="S">BELL</button><button class="bH" data-b="H">HEAVY</button><button class="bL" data-b="L">JAB</button><button class="bK" data-b="K">KICK</button>
  <button class="bG" data-hold="1">GUARD</button><button class="bP" data-pause="1">II</button>
</div>
<div class="layer" id="menu"></div>
<div class="layer" id="load">LOADING</div>
<div class="layer" id="rotate">TURN YOUR DEVICE<br>SIDEWAYS</div>
`;

export const SPEAKERS: Record<string, string> = { KESSA: '#f0655c', DEE: '#e3c87c', ROOK: '#b0bb86', WREN: '#5cc4c6', CRANE: '#c2c8d4' };
export interface Bars { hp: number; max: number; guard: number; meter: number; rounds: number }
export interface MenuItem { id: string; label: string; sub?: string }

export class UI {
  root: HTMLElement;
  private q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
  /** held: the skip button is being pressed */ skipHeld = false;

  constructor(private input: Input) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = HTML;
    const t = this.q('#touch');
    for (const b of Array.from(t.querySelectorAll('button'))) {
      const up = () => { b.classList.remove('dn'); if (b.dataset.dir) input.touchAxis = 0; if (b.dataset.hold) input.touchBlock = false; };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('dn');
        if (b.dataset.dir) { input.touchAxis = +b.dataset.dir; input.tap(+b.dataset.dir); }
        else if (b.dataset.hold) input.touchBlock = true;
        else if (b.dataset.pause) input.pause();
        else input.press(b.dataset.b as Button);
      });
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    }
    const skip = this.q('#skip');
    skip.addEventListener('pointerdown', () => { this.skipHeld = true; });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) skip.addEventListener(ev, () => { this.skipHeld = false; });
    // a tap anywhere outside a control advances dialogue
    window.addEventListener('pointerdown', (e) => { if (!(e.target as HTMLElement).closest('button')) input.confirm(); });
    input.onTouch = () => this.touch(this.wantTouch);
  }

  private wantTouch = false;
  /** show the on-screen controls (only on a device that has been touched) */
  touch(on: boolean) { this.wantTouch = on; this.q('#touch').classList.toggle('on', on && this.input.touch); }

  hud(on: boolean, names?: [string, string], need = 2) {
    this.q('#hud').classList.toggle('on', on);
    if (names) {
      this.root.querySelectorAll('#hud .name').forEach((n, i) => { n.textContent = names[i]; });
      this.root.querySelectorAll('#hud .pips').forEach((p) => { p.innerHTML = '<b></b>'.repeat(need); });
    }
  }

  bars(a: Bars, b: Bars, time: number) {
    [a, b].forEach((s, i) => {
      const side = this.root.querySelectorAll('#hud .side')[i] as HTMLElement;
      const f = Math.max(0, s.hp / s.max);
      (side.querySelector('.fill') as HTMLElement).style.transform = `scaleX(${f})`;
      (side.querySelector('.ghost') as HTMLElement).style.transform = `scaleX(${f})`;
      side.querySelector('.hp')!.classList.toggle('low', f < 0.25);
      (side.querySelector('.guard i') as HTMLElement).style.transform = `scaleX(${Math.max(0, s.guard / 100)})`;
      side.querySelectorAll('.pips b').forEach((p, k) => p.classList.toggle('won', k < s.rounds));
      const m = this.root.querySelectorAll('#hud .meter')[i] as HTMLElement;
      (m.querySelector('i') as HTMLElement).style.transform = `scaleX(${s.meter / 100})`;
      m.classList.toggle('ready', s.meter >= 50);
    });
    this.q('#hud .clock').textContent = time === Infinity ? '∞' : String(Math.max(0, Math.ceil(time)));
  }

  private restart(el: HTMLElement, cls: string) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  announce(text: string, sub = '', dur = 1.4, ko = false) {
    const a = this.q('#announce');
    a.querySelector('b')!.textContent = text; a.querySelector('em')!.textContent = sub;
    a.style.setProperty('--d', dur + 's'); a.classList.toggle('ko', ko);
    this.restart(a, 'show');
  }

  call(side: 0 | 1, text: string, sub = '') {
    const c = this.root.querySelectorAll('#hud .call')[side] as HTMLElement;
    c.innerHTML = `${text}<small>${sub}</small>`;
    this.restart(c, 'show');
  }

  /** subtitle; null hides it. A line starting with * is a thought (italic, no speaker). */
  say(who: string | null, text = '') {
    const s = this.q('#sub');
    s.classList.toggle('on', who !== null);
    if (who === null) return;
    const sp = s.querySelector('span') as HTMLElement, p = s.querySelector('p') as HTMLElement;
    sp.textContent = who; sp.style.color = SPEAKERS[who] ?? '#d8d2c4';
    p.textContent = text; p.classList.toggle('thought', who === '');
  }

  card(on: boolean, small = '', big = '', em = '') {
    const c = this.q('#card');
    if (on) { c.querySelector('small')!.textContent = small; c.querySelector('b')!.textContent = big; c.querySelector('em')!.textContent = em; }
    c.classList.toggle('on', on);
  }

  hint(html: string | null) {
    const h = this.q('#hint');
    if (html) h.querySelector('div')!.innerHTML = html;
    h.classList.toggle('on', !!html);
  }

  letterbox(on: boolean) { this.q('#bars').classList.toggle('on', on); }
  skip(on: boolean) { this.q('#skip').classList.toggle('on', on); if (!on) this.skipHeld = false; }
  loading(on: boolean) { this.q('#load').classList.toggle('on', on); }

  /** black overlay: opacity 0..1 over seconds */
  fade(alpha: number, seconds = 0.6) {
    const f = this.q('#fade');
    f.style.transitionDuration = seconds + 's';
    void f.offsetWidth;
    f.style.opacity = String(alpha);
  }

  flash(alpha: number, seconds = 0.25) {
    const f = this.q('#flash');
    f.style.transition = 'none'; f.style.opacity = String(alpha);
    void f.offsetWidth;
    f.style.transition = `opacity ${seconds}s ease-out`; f.style.opacity = '0';
  }

  /** A list to choose from (keyboard, pad confirm or tap). Resolves with the item's id. */
  menu(title: string, subtitle: string, items: MenuItem[], center = false, foot = ''): Promise<string> {
    const m = this.q('#menu');
    m.className = 'layer on' + (center ? ' center' : '');
    m.innerHTML = `<h1>${title}</h1><h2>${subtitle}</h2>` + items.map((it) => `<button data-id="${it.id}">${it.label}${it.sub ? `<small>${it.sub}</small>` : ''}</button>`).join('') + `<div class="foot">${foot}</div>`;
    const btns = Array.from(m.querySelectorAll('button'));
    let sel = 0;
    const paint = () => btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
    paint();
    return new Promise((resolve) => {
      const done = (id: string) => { window.removeEventListener('keydown', key); m.className = 'layer'; m.innerHTML = ''; this.input.clear(); resolve(id); };
      const key = (e: KeyboardEvent) => {
        if (e.code === 'ArrowDown' || e.code === 'KeyS') sel = (sel + 1) % btns.length;
        else if (e.code === 'ArrowUp' || e.code === 'KeyW') sel = (sel + btns.length - 1) % btns.length;
        else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') return done(btns[sel].dataset.id!);
        paint();
      };
      window.addEventListener('keydown', key);
      btns.forEach((b, i) => { b.addEventListener('pointerenter', () => { sel = i; paint(); }); b.addEventListener('click', () => done(b.dataset.id!)); });
      this.menuPick = (i: number) => done(btns[i].dataset.id!);
    });
  }
  /** for tests and gamepads: choose the nth item of the open menu */
  menuPick: ((i: number) => void) | null = null;
}
