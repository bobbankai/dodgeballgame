// An indexed binary min-heap over integer ids with float keys, backed by typed arrays. A* pushes far more
// nodes than it settles, so the heap supports decrease-key in place (each id is in the heap at most once)
// instead of pushing duplicates. Positions are tracked per id in a Map so ids may be sparse.

export class BinaryHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  private size_ = 0;
  private pos = new Map<number, number>();

  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  get size(): number { return this.size_; }
  get empty(): boolean { return this.size_ === 0; }

  clear(): void {
    this.size_ = 0;
    this.pos.clear();
  }

  has(id: number): boolean { return this.pos.has(id); }

  /** the key an id is queued with (undefined if not queued) */
  keyOf(id: number): number | undefined {
    const i = this.pos.get(id);
    return i === undefined ? undefined : this.keys[i];
  }

  /** insert, or lower the key of an id already queued (a higher key is ignored) */
  push(id: number, key: number): void {
    const at = this.pos.get(id);
    if (at !== undefined) {
      if (key < this.keys[at]) {
        this.keys[at] = key;
        this.up(at);
      }
      return;
    }
    if (this.size_ === this.ids.length) this.grow();
    const i = this.size_++;
    this.ids[i] = id;
    this.keys[i] = key;
    this.pos.set(id, i);
    this.up(i);
  }

  /** the id with the smallest key (-1 when empty), without removing it */
  peek(): number { return this.size_ ? this.ids[0] : -1; }

  peekKey(): number { return this.size_ ? this.keys[0] : Infinity; }

  /** remove and return the id with the smallest key (-1 when empty) */
  pop(): number {
    if (!this.size_) return -1;
    const top = this.ids[0];
    this.pos.delete(top);
    const last = --this.size_;
    if (last > 0) {
      this.ids[0] = this.ids[last];
      this.keys[0] = this.keys[last];
      this.pos.set(this.ids[0], 0);
      this.down(0);
    }
    return top;
  }

  /** remove a queued id (no-op if absent) */
  remove(id: number): void {
    const i = this.pos.get(id);
    if (i === undefined) return;
    this.pos.delete(id);
    const last = --this.size_;
    if (i === last) return;
    this.ids[i] = this.ids[last];
    this.keys[i] = this.keys[last];
    this.pos.set(this.ids[i], i);
    this.up(i);
    this.down(this.pos.get(this.ids[i]) ?? i);
  }

  private grow(): void {
    const n = this.ids.length * 2;
    const ids = new Int32Array(n);
    const keys = new Float64Array(n);
    ids.set(this.ids);
    keys.set(this.keys);
    this.ids = ids;
    this.keys = keys;
  }

  private swap(a: number, b: number): void {
    const ia = this.ids[a], ib = this.ids[b];
    const ka = this.keys[a];
    this.ids[a] = ib; this.keys[a] = this.keys[b];
    this.ids[b] = ia; this.keys[b] = ka;
    this.pos.set(ib, a);
    this.pos.set(ia, b);
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  private down(i: number): void {
    const n = this.size_;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < n && this.keys[l] < this.keys[m]) m = l;
      if (r < n && this.keys[r] < this.keys[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }
}
