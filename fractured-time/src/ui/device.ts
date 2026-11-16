/**
 * What the device is, for the choices that depend on it: touch controls, the render resolution and memory budgets of phones.
 * `?touch` forces the touch layer on (tests on a desktop browser).
 */
const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

/** A touch-first device (no hovering mouse): phones and tablets. */
export function isTouch(): boolean {
  if (qs.has('touch')) return true;
  if (typeof matchMedia === 'undefined') return false;
  return matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches;
}

/** A phone or tablet: a mobile GPU with a browser's tight memory limit (lightmaps load at half size, render height is capped). */
export function isMobile(): boolean {
  if (qs.has('touch')) return true;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (isTouch() && navigator.maxTouchPoints > 1);
}
