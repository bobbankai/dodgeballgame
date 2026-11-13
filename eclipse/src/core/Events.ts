/**
 * A small typed event bus. Systems publish gameplay facts (an enemy died, a boss changed phase, a
 * quest step finished) and other systems (audio, UI, quests, achievements) subscribe without the
 * publisher knowing about them.
 */
export type Handler<T> = (payload: T) => void;

export class EventBus<M extends { [K in keyof M]: unknown }> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof M>(type: K, fn: Handler<M[K]>): void {
    this.handlers.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) (fn as Handler<M[K]>)(payload);
  }

  /** Resolves the next time `type` is emitted and `pred` (if given) accepts the payload. */
  wait<K extends keyof M>(type: K, pred?: (p: M[K]) => boolean): Promise<M[K]> {
    return new Promise((resolve) => {
      const off = this.on(type, (p) => {
        if (pred && !pred(p)) return;
        off();
        resolve(p);
      });
    });
  }

  clear(): void {
    this.handlers.clear();
  }
}
