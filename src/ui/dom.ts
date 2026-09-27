type Attrs = Record<string, any> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

/** Tiny hyperscript helper for building UI without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign(el.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function svg(markup: string): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGElement;
}

export function clearEl(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export const ICONS = {
  heart: `<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 4.2 2.4h2c.6-1.2 2.1-2.4 4.2-2.4 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>`,
  ball: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3.5 10.5h17M12 3v18" stroke="rgba(255,255,255,.6)" stroke-width="1.6" fill="none"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>`,
  star: `<svg viewBox="0 0 24 24"><path d="m12 2 3 6.6 7 .8-5.2 4.8 1.4 7-6.2-3.6-6.2 3.6 1.4-7L2 9.4l7-.8z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0z"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="m9 16.2-3.5-3.5L4 14.2l5 5 11-11-1.5-1.4z"/></svg>`,
  crown: `<svg viewBox="0 0 24 24"><path d="M3 18h18l-1.5-10-4.5 4-3-7-3 7-4.5-4z"/></svg>`,
  shield: `<svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5z"/></svg>`,
  wind: `<svg viewBox="0 0 24 24"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/></svg>`,
  eye: `<svg viewBox="0 0 24 24"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="2"/></svg>`,
  target: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4"/></svg>`,
};
