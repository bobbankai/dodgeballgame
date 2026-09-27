type Handler<T> = (payload: T) => void;

/** Minimal typed event bus. */
export class EventBus<Events extends object> {
  private map = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]) {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[events] handler for ${String(type)} failed`, e);
      }
    }
  }

  clear() {
    this.map.clear();
  }
}
