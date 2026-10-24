// Small in-process TTL cache.
//
// - Entries expire after `ttlMs`; `ttlMs <= 0` disables caching entirely (every
//   call goes to the loader), which makes it a safe off-switch via env config.
// - The map is bounded: when full, the oldest entry is evicted, so it can never
//   grow without limit.
// - `getOrLoad` is single-flight: concurrent misses for the same key share one
//   loader call instead of stampeding the database when an entry expires.
// - `delete`/`clear` also stop an in-flight load from repopulating the cache
//   with a value that was fetched before the invalidation.
//
// In-process only: with several app instances each keeps its own copy, so an
// invalidation on one instance reaches the others only when their TTL lapses.

interface Entry<V> {
  value: V;
  expires: number;
}

export default class TtlCache<V> {
  private store = new Map<string, Entry<V>>();
  private pending = new Map<string, Promise<V>>();
  // Bumped on every invalidation; a load only caches its result if no
  // invalidation happened while it was running.
  private epoch = 0;

  constructor(private readonly ttlMs: number, private readonly maxEntries = 5000) {}

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (!this.enabled) return;
    this.store.delete(key); // re-insert so insertion order tracks recency
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  async getOrLoad(key: string, loader: () => Promise<V>): Promise<V> {
    if (!this.enabled) return loader();

    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const startedAt = this.epoch;
    const load = loader()
      .then((value) => {
        // Only cache real values (loaders return null for "not found"), and only
        // if nothing was invalidated while we were waiting on the database.
        if (value !== null && value !== undefined && this.epoch === startedAt) this.set(key, value);
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === load) this.pending.delete(key);
      });
    this.pending.set(key, load);
    return load;
  }

  delete(key: string): void {
    this.epoch++;
    this.store.delete(key);
    this.pending.delete(key);
  }

  clear(): void {
    this.epoch++;
    this.store.clear();
    this.pending.clear();
  }
}
