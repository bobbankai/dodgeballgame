/** Tagged console logging; `?debug` raises verbosity. Errors are kept so the test harness can read them. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
let threshold: Level = params.has('debug') ? 'debug' : 'info';

export const recentErrors: string[] = [];

function emit(level: Level, msg: string, extra: unknown[]): void {
  if (order[level] < order[threshold]) return;
  const line = `[eclipse] ${msg}`;
  if (level === 'error' || level === 'warn') {
    const text = [line, ...extra.map((e) => (e instanceof Error ? e.stack ?? e.message : String(e)))].join(' ');
    if (level === 'error') recentErrors.push(text);
    if (recentErrors.length > 50) recentErrors.shift();
  }
  const fn = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error;
  fn(line, ...extra);
}

export const log = {
  debug: (msg: string, ...extra: unknown[]) => emit('debug', msg, extra),
  info: (msg: string, ...extra: unknown[]) => emit('info', msg, extra),
  warn: (msg: string, ...extra: unknown[]) => emit('warn', msg, extra),
  error: (msg: string, ...extra: unknown[]) => emit('error', msg, extra),
  setLevel(l: Level): void {
    threshold = l;
  },
};
