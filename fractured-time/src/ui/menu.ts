/**
 * Front end: title screen (Continue / New Game / Chapters / Settings / Credits), loading screen, pause menu, settings and saves.
 * Keyboard, mouse and gamepad navigate every menu (arrows / stick to move, Enter / A to choose, Esc / B to go back).
 * Settings and progress persist in localStorage (wrapped: private windows and blocked storage just do not persist).
 */
export interface Settings {
  quality: 'ultra' | 'high' | 'balanced' | 'performance';
  master: number; music: number; sfx: number; voice: number;
  sensitivity: number; invertY: boolean; subtitles: boolean; subtitleSize: number; shake: number;
}
export interface SaveData { chapter: number; at: string; when: number; reached: number }

export const CHAPTERS = [
  { n: 1, title: 'The Incident', place: 'HELIX Underground Research Facility', beats: ['wake', 'checkpoint', 'lab', 'servers', 'engine', 'surface'] },
  { n: 2, title: 'The Other World', place: 'The Fractured District', beats: ['rooftops', 'street', 'cafe'] },
  { n: 3, title: 'The Doppelganger', place: 'HELIX Corporate Arcology', beats: [] },
  { n: 4, title: 'The Paradox', place: 'Four timelines at once', beats: [] },
  { n: 5, title: 'The Final Timeline', place: 'The Temporal Nexus', beats: [] },
];

const DEFAULTS: Settings = { quality: 'high', master: 0.9, music: 0.7, sfx: 0.9, voice: 1.0, sensitivity: 1, invertY: false, subtitles: true,
  subtitleSize: 1, shake: 1 };

function load<T>(k: string, d: T): T {
  try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; }
}
function store(k: string, v: unknown): void { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }

export const settings = {
  get(): Settings { return load('ft.settings', DEFAULTS); },
  set(s: Settings): void { store('ft.settings', s); },
};
export const saves = {
  get(): SaveData | null { const s = load<SaveData | null>('ft.save', null as any); return s && s.chapter ? s : null; },
  set(chapter: number, at: string): void {
    const prev = saves.get();
    store('ft.save', { chapter, at, when: Date.now(), reached: Math.max(chapter, prev?.reached ?? 1) });
  },
};

type Item = { label: string; sub?: string; disabled?: boolean; act: () => void };

/** A vertical menu with keyboard / mouse / gamepad focus. */
class MenuList {
  el = document.createElement('div');
  private idx = 0;
  private items: Item[] = [];
  constructor(cls = 'menu-list') { this.el.className = cls; }
  set(items: Item[]): void {
    this.items = items;
    this.el.innerHTML = '';
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'menu-item' + (it.disabled ? ' disabled' : '');
      b.innerHTML = `<span class="l">${it.label}</span>${it.sub ? `<span class="s">${it.sub}</span>` : ''}`;
      b.addEventListener('mouseenter', () => this.focus(i));
      b.addEventListener('click', () => { if (!it.disabled) it.act(); });
      this.el.appendChild(b);
    });
    this.idx = Math.max(0, items.findIndex((it) => !it.disabled));
    this.focus(this.idx);
  }
  focus(i: number): void {
    this.idx = i;
    [...this.el.children].forEach((c, k) => c.classList.toggle('focus', k === i));
  }
  move(d: number): void {
    if (!this.items.length) return;
    let i = this.idx;
    for (let n = 0; n < this.items.length; n++) { i = (i + d + this.items.length) % this.items.length; if (!this.items[i].disabled) break; }
    this.focus(i);
  }
  choose(): void { const it = this.items[this.idx]; if (it && !it.disabled) it.act(); }
}

/** Shared navigation: one listener routes keys / pad to whichever menu is on top. */
class Nav {
  stack: { list: MenuList; back?: () => void }[] = [];
  private padPrev: boolean[] = [];
  constructor() {
    addEventListener('keydown', (e) => {
      const top = this.stack[this.stack.length - 1];
      if (!top) return;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { top.list.move(1); e.preventDefault(); }
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') { top.list.move(-1); e.preventDefault(); }
      else if (e.code === 'Enter' || e.code === 'Space') { top.list.choose(); e.preventDefault(); }
      else if (e.code === 'Escape' || e.code === 'Backspace') { top.back?.(); e.preventDefault(); }
    });
    const poll = () => {
      const top = this.stack[this.stack.length - 1];
      const pad = navigator.getGamepads?.()[0];
      if (top && pad) {
        const b = pad.buttons.map((x) => x.pressed);
        const edge = (i: number) => b[i] && !this.padPrev[i];
        const ax = pad.axes[1] ?? 0;
        if (edge(13) || (ax > 0.6 && !this.padPrev[99])) top.list.move(1);
        if (edge(12) || (ax < -0.6 && !this.padPrev[98])) top.list.move(-1);
        if (edge(0)) top.list.choose();
        if (edge(1)) top.back?.();
        this.padPrev = b;
        this.padPrev[99] = ax > 0.6;
        this.padPrev[98] = ax < -0.6;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }
  push(list: MenuList, back?: () => void): void { this.stack.push({ list, back }); }
  pop(): void { this.stack.pop(); }
}
const nav = new Nav();

function panel(title: string): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = 'menu-panel';
  root.innerHTML = `<div class="menu-head">${title}</div>`;
  const body = document.createElement('div');
  body.className = 'menu-body';
  root.appendChild(body);
  return { root, body };
}

/** Settings panel (title and pause share it). `apply` pushes live changes into the running game. */
export function openSettings(host: HTMLElement, apply: (s: Settings) => void, onClose: () => void): void {
  const s = settings.get();
  const { root, body } = panel('SETTINGS');
  const list = new MenuList('menu-list settings');
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const cycle = <T,>(vals: T[], cur: T) => vals[(vals.indexOf(cur) + 1) % vals.length];
  const rebuild = () => {
    list.set([
      { label: 'Graphics quality', sub: s.quality.toUpperCase() + ' (applies on restart)', act: () => { s.quality = cycle(['ultra', 'high', 'balanced', 'performance'], s.quality) as Settings['quality']; save(); } },
      { label: 'Master volume', sub: pct(s.master), act: () => { s.master = cycle([0, 0.25, 0.5, 0.75, 0.9, 1], s.master); save(); } },
      { label: 'Music', sub: pct(s.music), act: () => { s.music = cycle([0, 0.25, 0.5, 0.7, 0.85, 1], s.music); save(); } },
      { label: 'Effects', sub: pct(s.sfx), act: () => { s.sfx = cycle([0, 0.25, 0.5, 0.75, 0.9, 1], s.sfx); save(); } },
      { label: 'Voices', sub: pct(s.voice), act: () => { s.voice = cycle([0, 0.25, 0.5, 0.75, 1], s.voice); save(); } },
      { label: 'Camera sensitivity', sub: s.sensitivity.toFixed(2), act: () => { s.sensitivity = cycle([0.5, 0.75, 1, 1.25, 1.5, 2], s.sensitivity); save(); } },
      { label: 'Invert camera Y', sub: s.invertY ? 'ON' : 'OFF', act: () => { s.invertY = !s.invertY; save(); } },
      { label: 'Subtitles', sub: s.subtitles ? 'ON' : 'OFF', act: () => { s.subtitles = !s.subtitles; save(); } },
      { label: 'Subtitle size', sub: pct(s.subtitleSize), act: () => { s.subtitleSize = cycle([0.85, 1, 1.25, 1.5], s.subtitleSize); save(); } },
      { label: 'Camera shake', sub: pct(s.shake), act: () => { s.shake = cycle([0, 0.5, 1], s.shake); save(); } },
      { label: 'Back', act: close },
    ]);
  };
  const save = () => { settings.set(s); apply(s); const i = (list as any).idx; rebuild(); list.focus(i); };
  const close = () => { nav.pop(); root.remove(); onClose(); };
  rebuild();
  body.appendChild(list.el);
  host.appendChild(root);
  nav.push(list, close);
}

/** The title screen. Resolves when the player picks where to start. */
export function titleScreen(): Promise<{ chapter: number; at: string }> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'title-screen';
    root.innerHTML = `
      <div class="title-art"></div><canvas class="title-fx"></canvas>
      <div class="title-brand"><div class="title-name">FRACTURED <b>TIME</b></div><div class="title-tag">One man. Every version of the world.</div></div>
      <div class="title-foot">v1 &middot; WebGPU</div>`;
    document.body.appendChild(root);
    fractureFx(root.querySelector('canvas')!);
    const main = new MenuList();
    root.appendChild(main.el);
    const sv = saves.get();
    const go = (chapter: number, at: string) => { nav.pop(); root.classList.add('leaving'); setTimeout(() => { root.remove(); resolve({ chapter, at }); }, 600); };
    const chaptersMenu = () => {
      const { root: pr, body } = panel('CHAPTERS');
      const list = new MenuList('menu-list chapters');
      const reached = sv?.reached ?? 1;
      list.set([
        ...CHAPTERS.map((c) => ({ label: `${c.n}  ${c.title}`, sub: c.n <= reached && c.beats.length ? c.place : c.beats.length ? 'Locked' : 'In production',
          disabled: c.n > reached || !c.beats.length, act: () => { nav.pop(); pr.remove(); go(c.n, c.beats[0]); } })),
        { label: 'Back', act: () => { nav.pop(); pr.remove(); } },
      ]);
      body.appendChild(list.el);
      root.appendChild(pr);
      nav.push(list, () => { nav.pop(); pr.remove(); });
    };
    const credits = () => {
      const { root: pr, body } = panel('CREDITS');
      body.innerHTML = `<div class="credits">
        <p><b>FRACTURED TIME</b></p>
        <p>Game, code, characters, environments, animation, sound and music: built for the owner of this project with Claude Code</p>
        <p>Human base meshes: MakeHuman / MPFB (CC0 assets)<br>Photoscanned materials and skies: Poly Haven (CC0)<br>
        Motion capture: CMU Graphics Lab Motion Capture Database<br>Voices: Kokoro-82M (Apache-2.0)<br>Engine: three.js (WebGPU), Rapier</p></div>`;
      const list = new MenuList();
      list.set([{ label: 'Back', act: () => { nav.pop(); pr.remove(); } }]);
      body.appendChild(list.el);
      root.appendChild(pr);
      nav.push(list, () => { nav.pop(); pr.remove(); });
    };
    main.set([
      { label: 'Continue', sub: sv ? `Chapter ${sv.chapter}  ·  ${CHAPTERS[sv.chapter - 1]?.title ?? ''}` : undefined, disabled: !sv, act: () => go(sv!.chapter, sv!.at) },
      { label: 'New Game', act: () => go(1, 'wake') },
      { label: 'Chapters', act: chaptersMenu },
      { label: 'Settings', act: () => openSettings(root, () => {}, () => {}) },
      { label: 'Credits', act: credits },
    ]);
    nav.push(main);
  });
}

/** Full-screen loading card between the menu and a chapter. */
export function loadingScreen(chapter: number): { done: () => void; progress: (k: number) => void; ready: () => Promise<void> } {
  const c = CHAPTERS[chapter - 1];
  const el = document.createElement('div');
  el.className = 'loading-screen';
  el.innerHTML = `<div class="ld-num">CHAPTER ${chapter}</div><div class="ld-title">${c?.title ?? ''}</div><div class="ld-place">${c?.place ?? ''}</div>
    <div class="ld-bar"><div class="ld-fill"></div></div><div class="ld-tip">Block just before a hit lands to parry. A parry opens the enemy to a counter.</div>`;
  document.body.appendChild(el);
  const fill = el.querySelector('.ld-fill') as HTMLDivElement;
  return {
    progress: (k) => { fill.style.width = `${Math.round(k * 100)}%`; },
    done: () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 900); },
    // "press any key": the gesture browsers require before audio and pointer lock
    ready: () => new Promise<void>((res) => {
      const go = document.createElement('div');
      go.className = 'ld-go';
      go.textContent = 'Press any key';
      el.insertBefore(go, el.querySelector('.ld-tip'));
      const fire = () => { removeEventListener('keydown', fire); removeEventListener('pointerdown', fire); res(); };
      addEventListener('keydown', fire);
      addEventListener('pointerdown', fire);
    }),
  };
}

/** The pause menu. */
export function pauseMenu(opts: { resume: () => void; restart: () => void; quit: () => void; apply: (s: Settings) => void }): void {
  const root = document.createElement('div');
  root.className = 'pause-menu';
  const { root: pr, body } = panel('PAUSED');
  root.appendChild(pr);
  const list = new MenuList();
  const close = (f: () => void) => () => { nav.pop(); root.remove(); f(); };
  list.set([
    { label: 'Resume', act: close(opts.resume) },
    { label: 'Restart from checkpoint', act: close(opts.restart) },
    { label: 'Settings', act: () => openSettings(root, opts.apply, () => {}) },
    { label: 'Quit to title', act: close(opts.quit) },
  ]);
  body.appendChild(list.el);
  document.body.appendChild(root);
  nav.push(list, close(opts.resume));
}

/** Title backdrop: slow drifting shards of light with cyan fracture lines (2D canvas; the key art sits under it). */
function fractureFx(cv: HTMLCanvasElement): void {
  const ctx = cv.getContext('2d')!;
  const shards = Array.from({ length: 34 }, () => ({ x: Math.random(), y: Math.random(), r: 0.02 + Math.random() * 0.08, a: Math.random() * 6.28,
    s: (Math.random() - 0.5) * 0.0004, v: 0.00004 + Math.random() * 0.0001 }));
  const draw = () => {
    if (!cv.isConnected) return;
    cv.width = innerWidth; cv.height = innerHeight;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of shards) {
      p.a += p.s * 16; p.y -= p.v * 16; if (p.y < -0.1) p.y = 1.1;
      const x = p.x * cv.width, y = p.y * cv.height, r = p.r * cv.height;
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.a);
      ctx.beginPath(); ctx.moveTo(-r, -r * 0.3); ctx.lineTo(r * 0.7, -r * 0.5); ctx.lineTo(r, r * 0.4); ctx.lineTo(-r * 0.4, r * 0.6); ctx.closePath();
      ctx.strokeStyle = 'rgba(90,216,255,0.10)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(90,216,255,0.015)'; ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(draw);
  };
  draw();
}
