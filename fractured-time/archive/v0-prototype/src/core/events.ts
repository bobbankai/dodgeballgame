/** Tiny typed event bus. Systems talk through events so none of them import each other. */
type Handler<T> = (payload: T) => void;

export class Emitter<Events extends object> {
  private map = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (set) for (const fn of [...set]) fn(payload);
  }

  clear(): void {
    this.map.clear();
  }
}

export interface GameEvents {
  hit: { attacker: unknown; target: unknown; damage: number; heavy: boolean; point: [number, number, number]; blocked: boolean; parried: boolean };
  parry: { by: unknown; against: unknown };
  death: { actor: unknown };
  ability: { name: 'slow' | 'rewind' | 'echo' | 'shift' | 'counter'; phase: 'start' | 'end' };
  checkpoint: { id: string };
  objective: { id: string; text: string };
  flag: { key: string; value: unknown };
  subtitle: { who: string; text: string; duration: number };
  cutscene: { id: string; phase: 'start' | 'end' };
  chapter: { id: number; phase: 'start' | 'end' };
  log: { text: string };
}

export const bus = new Emitter<GameEvents>();
