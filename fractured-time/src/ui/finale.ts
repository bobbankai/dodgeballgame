import './finale.css';

/**
 * The end of the story: the choice at the Engine, and the credits. Both are plain DOM over the (letterboxed) game.
 * The choice reads keyboard (1 / 2, arrows + Enter), mouse and gamepad (d-pad + A); tests can call `window.__choose(1|2)`.
 */
export type Ending = 'A' | 'B';

const OPTIONS: { key: Ending; title: string; line: string; cost: string }[] = [
  { key: 'A', title: 'Restore the original timeline', line: 'Close every fracture. The world goes back to the night before the Incident.',
    cost: 'Every reality born from the fracture is undone, and everyone who lives only in them.' },
  { key: 'B', title: 'Preserve the fractured worlds', line: 'Let each timeline stand on its own, sealed from the others.',
    cost: 'Nothing is undone. Humanity lives with many histories, and with what Voss already broke.' },
];

declare global { interface Window { __choose?: (n: number) => void } }

export function chooseEnding(): Promise<Ending> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'finale-choice';
    root.innerHTML = `<div class="fc-head">THE ENGINE</div><div class="fc-ask">What will you do with it?</div><div class="fc-cards"></div>
      <div class="fc-hint">[1] / [2] or arrows + Enter</div>`;
    const cards = root.querySelector('.fc-cards')!;
    let sel = 0;
    const els = OPTIONS.map((o, i) => {
      const b = document.createElement('button');
      b.className = 'fc-card';
      b.innerHTML = `<div class="fc-n">${i + 1}</div><div class="fc-t">${o.title}</div><div class="fc-l">${o.line}</div><div class="fc-c">${o.cost}</div>`;
      b.addEventListener('mouseenter', () => { sel = i; paint(); });
      b.addEventListener('click', () => done(i));
      cards.appendChild(b);
      return b;
    });
    const paint = () => els.forEach((e, i) => e.classList.toggle('on', i === sel));
    let pad = 0;
    const poll = () => {
      const gp = navigator.getGamepads?.()[0];
      if (gp) {
        const l = gp.buttons[14]?.pressed, r = gp.buttons[15]?.pressed, a = gp.buttons[0]?.pressed;
        const now = (l ? 1 : 0) | (r ? 2 : 0) | (a ? 4 : 0);
        if (now & ~pad & 1) { sel = 0; paint(); }
        if (now & ~pad & 2) { sel = 1; paint(); }
        if (now & ~pad & 4) { done(sel); return; }
        pad = now;
      }
      raf = requestAnimationFrame(poll);
    };
    let raf = requestAnimationFrame(poll);
    const key = (e: KeyboardEvent) => {
      if (e.key === '1') done(0);
      else if (e.key === '2') done(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { sel = 0; paint(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { sel = 1; paint(); }
      else if (e.key === 'Enter' || e.key === ' ') done(sel);
    };
    const done = (i: number) => {
      removeEventListener('keydown', key);
      cancelAnimationFrame(raf);
      delete window.__choose;
      root.classList.add('leaving');
      setTimeout(() => root.remove(), 700);
      resolve(OPTIONS[i].key);
    };
    addEventListener('keydown', key);
    window.__choose = (n: number) => done(n - 1);
    document.exitPointerLock?.();
    paint();
    document.body.appendChild(root);
  });
}

const CREDITS: [string, string[]][] = [
  ['FRACTURED TIME', []],
  ['Story, design, code, models, animation, sound', ['Built with Claude Code for its owner, scene by scene, in this repository']],
  ['Engine', ['three.js (WebGPU, TSL)', 'Rapier physics', 'Vite, TypeScript']],
  ['Content tools', ['Blender 5.3 (Cycles bakes, every model, rig and level written as scripts)', 'MPFB 2 / MakeHuman (CC0 bodies)']],
  ['Voices', ['Kokoro-82M neural voices, run locally']],
  ['Scanned materials and skies', ['Poly Haven (CC0)', 'ambientCG (CC0)']],
  ['Motion', ['CMU Graphics Lab Motion Capture Database']],
  ['', ['Thank you for playing.']],
];

/** Roll the credits; resolves when they finish (any key or click skips ahead after a moment). */
export function rollCredits(ending: Ending, fast = false): Promise<void> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'finale-credits';
    const tag = ending === 'A' ? 'The original timeline' : 'The many histories';
    root.innerHTML = `<div class="cr-roll"><div class="cr-ending">${tag}</div>${CREDITS.map(([h, ls]) =>
      `<div class="cr-block"><div class="cr-h">${h}</div>${ls.map((l) => `<div class="cr-l">${l}</div>`).join('')}</div>`).join('')}</div>`;
    document.body.appendChild(root);
    const dur = fast ? 3000 : 42000;
    (root.querySelector('.cr-roll') as HTMLElement).style.animationDuration = `${dur}ms`;
    let finished = false;
    const end = () => { if (finished) return; finished = true; root.classList.add('leaving'); setTimeout(() => { root.remove(); resolve(); }, 900); };
    setTimeout(end, dur);
    setTimeout(() => { addEventListener('keydown', end, { once: true }); addEventListener('pointerdown', end, { once: true }); }, 2500);
  });
}
