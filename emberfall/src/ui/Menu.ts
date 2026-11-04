// Title screen, pause menu, settings, chapter select, credits.
import type { QualityName } from '../render/Quality';

const CSS = `
#menu { position: fixed; inset: 0; z-index: 9; display: none; color: #efe4cf; font-family: 'Cormorant Garamond', Georgia, serif; }
#menu.on { display: block; }
#menu .shade { position: absolute; inset: 0; background: radial-gradient(ellipse at 30% 50%, rgba(0,0,0,.15), rgba(0,0,0,.78)); }
#menu.pause .shade { background: rgba(5,4,6,.72); backdrop-filter: blur(4px); }
#menu .panel { position: absolute; left: max(7vw, env(safe-area-inset-left)); top: 50%; transform: translateY(-50%); width: min(520px, 86vw); }
#menu .logo { font-family: Cinzel, serif; font-weight: 700; font-size: clamp(46px, 8vw, 104px); letter-spacing: .12em; line-height: 1; background: linear-gradient(180deg, #fff3d6 10%, #ffb262 60%, #c24a1a); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 22px rgba(255,120,40,.35)); }
#menu .tag { font-style: italic; font-size: clamp(16px, 1.8vw, 22px); opacity: .8; margin: 10px 0 36px 4px; }
#menu h2 { font-family: Cinzel, serif; font-weight: 500; letter-spacing: .3em; font-size: 18px; color: #d9b26a; margin: 0 0 18px; }
#menu button { display: block; width: 100%; text-align: left; background: none; border: none; color: inherit; font: 500 clamp(19px, 2.1vw, 26px) Cinzel, serif; letter-spacing: .14em; padding: 9px 0 9px 4px; cursor: pointer; opacity: .78; transition: opacity .15s, padding .15s, color .15s; }
#menu button:hover, #menu button:focus { opacity: 1; padding-left: 18px; color: #ffcf7a; outline: none; }
#menu button[disabled] { opacity: .3; pointer-events: none; }
#menu .row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 7px 0; font-size: 19px; }
#menu .row select, #menu .row input[type=range] { width: 52%; accent-color: #ff8a3a; background: #1a1513; color: #efe4cf; border: 1px solid #5a4630; font: 16px 'Cormorant Garamond', serif; padding: 4px; }
#menu .credits { max-height: 64vh; overflow: auto; font-size: 17px; line-height: 1.45; padding-right: 8px; }
#menu .credits b { font-family: Cinzel, serif; font-weight: 500; letter-spacing: .12em; color: #d9b26a; display: block; margin-top: 14px; font-size: 14px; }
#menu .hint { position: absolute; left: max(7vw, env(safe-area-inset-left)); bottom: max(5vh, env(safe-area-inset-bottom)); font-size: 15px; opacity: .55; font-style: italic; }
`;

export interface Settings {
  quality: QualityName;
  music: number;
  sfx: number;
  sensitivity: number;
  invertY: boolean;
  subtitles: boolean;
  stats: boolean;
  motionBlur: boolean;
}

export function loadSettings(defaultQ: QualityName): Settings {
  const d: Settings = { quality: defaultQ, music: 0.55, sfx: 0.9, sensitivity: 1, invertY: false, subtitles: true, stats: false, motionBlur: true };
  try {
    const s = JSON.parse(localStorage.getItem('emberfall.settings') ?? '{}');
    return { ...d, ...s };
  } catch { return d; }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem('emberfall.settings', JSON.stringify(s)); } catch { /* ignore */ }
}

export interface MenuHooks {
  newGame(): void;
  continueGame(): void;
  hasSave(): boolean;
  chapters(): { id: string; title: string; unlocked: boolean }[];
  startChapter(id: string): void;
  resume(): void;
  restartCheckpoint(): void;
  quitToTitle(): void;
  applySettings(s: Settings): void;
}

export class Menu {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  mode: 'title' | 'pause' | 'off' = 'off';

  constructor(private hooks: MenuHooks, public settings: Settings) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.innerHTML = '<div class="shade"></div><div class="panel"></div><div class="hint"></div>';
    document.body.appendChild(this.root);
    this.panel = this.root.querySelector('.panel')!;
  }

  private btn(label: string, fn: () => void, disabled = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    this.panel.appendChild(b);
    return b;
  }

  hide(): void { this.mode = 'off'; this.root.className = ''; }

  title(): void {
    this.mode = 'title';
    this.root.className = 'on title';
    this.panel.innerHTML = '<div class="logo">EMBERFALL</div><div class="tag">The last ember remembers every vow.</div>';
    (this.root.querySelector('.hint') as HTMLElement).textContent = 'Best with headphones. Keyboard & mouse, gamepad or touch.';
    if (this.hooks.hasSave()) this.btn('Continue', () => this.hooks.continueGame());
    this.btn('New Game', () => this.hooks.newGame());
    this.btn('Chapters', () => this.chapters());
    this.btn('Settings', () => this.settingsPanel(() => this.title()));
    this.btn('Credits', () => this.credits(() => this.title()));
    (this.panel.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  pause(): void {
    this.mode = 'pause';
    this.root.className = 'on pause';
    this.panel.innerHTML = '<h2>PAUSED</h2>';
    (this.root.querySelector('.hint') as HTMLElement).textContent = 'Strike: LMB / J · Heavy: K · Dodge: Space · Guard: RMB / L · Art: R / 1-3 · Heal: F · Lock: Q / MMB · Use: E';
    this.btn('Resume', () => this.hooks.resume());
    this.btn('Settings', () => this.settingsPanel(() => this.pause()));
    this.btn('Restart from Checkpoint', () => this.hooks.restartCheckpoint());
    this.btn('Quit to Title', () => this.hooks.quitToTitle());
    (this.panel.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private chapters(): void {
    this.panel.innerHTML = '<h2>CHAPTERS</h2>';
    for (const c of this.hooks.chapters()) this.btn(c.title, () => this.hooks.startChapter(c.id), !c.unlocked);
    this.btn('Back', () => this.title());
  }

  private settingsPanel(back: () => void): void {
    const s = this.settings;
    this.panel.innerHTML = '<h2>SETTINGS</h2>';
    const row = (label: string, input: HTMLElement) => {
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = `<span>${label}</span>`;
      r.appendChild(input);
      this.panel.appendChild(r);
    };
    const sel = (opts: [string, string][], val: string, on: (v: string) => void) => {
      const e = document.createElement('select');
      for (const [v, l] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; e.appendChild(o); }
      e.value = val;
      e.addEventListener('change', () => { on(e.value); this.commit(); });
      return e;
    };
    const range = (min: number, max: number, step: number, val: number, on: (v: number) => void) => {
      const e = document.createElement('input');
      e.type = 'range'; e.min = String(min); e.max = String(max); e.step = String(step); e.value = String(val);
      e.addEventListener('input', () => { on(+e.value); this.commit(); });
      return e;
    };
    const yes = (val: boolean, on: (v: boolean) => void) => sel([['1', 'On'], ['0', 'Off']], val ? '1' : '0', (v) => on(v === '1'));
    row('Graphics', sel([['ultra', 'Ultra'], ['high', 'High'], ['performance', 'Performance']], s.quality, (v) => { s.quality = v as QualityName; }));
    row('Music', range(0, 1, 0.05, s.music, (v) => { s.music = v; }));
    row('Effects', range(0, 1, 0.05, s.sfx, (v) => { s.sfx = v; }));
    row('Camera speed', range(0.3, 2.5, 0.05, s.sensitivity, (v) => { s.sensitivity = v; }));
    row('Invert Y', yes(s.invertY, (v) => { s.invertY = v; }));
    row('Motion blur', yes(s.motionBlur, (v) => { s.motionBlur = v; }));
    row('Subtitles', yes(s.subtitles, (v) => { s.subtitles = v; }));
    row('Performance overlay', yes(s.stats, (v) => { s.stats = v; }));
    this.btn('Back', back);
  }

  private commit(): void {
    saveSettings(this.settings);
    this.hooks.applySettings(this.settings);
  }

  credits(back: () => void): void {
    this.panel.innerHTML = `<h2>CREDITS</h2><div class="credits">
      <b>EMBERFALL</b>A story action game made with three.js, Blender and code.
      <b>CHARACTERS</b>Bodies, skins, hair, eyes and base clothing from the MakeHuman / MPFB2 asset library (CC0; some packs CC-BY: see assets/CREDITS.md), shaped, armoured and rigged in Blender.
      <b>ENVIRONMENTS</b>Photoscanned textures, models and props from Poly Haven (CC0).
      <b>MOTION</b>Locomotion, get-ups and gestures from the Carnegie Mellon University Motion Capture Database (mocap.cs.cmu.edu), retargeted; combat animation keyed with an IK sword rig.
      <b>SOUND</b>RPG Sound Pack by artisticdude; CC0 SFX packs by rubberduck; Forest Ambience (all CC0, OpenGameArt). Music performed with the GeneralUser GS SoundFont by S. Christian Collins.
      <b>FONTS</b>Cinzel and Cormorant Garamond (SIL Open Font License).
      <b>ENGINE</b>three.js, postprocessing, N8AO, three-mesh-bvh.
      </div>`;
    this.btn('Back', back);
  }
}
