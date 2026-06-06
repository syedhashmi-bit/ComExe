// Tiny in-memory TTL caches shared by the API routes. Replaces the ad-hoc
// `let cache: { data; ts } | null` objects (and a few per-key Map variants)
// that were copy-pasted across ~15 routes, each with its own TTL constant and
// its own freshness check.

export interface TTLCache<T> {
  // Cached value while fresh, else null.
  get(): T | null;
  set(data: T): void;
  invalidate(): void;
}

// Single-value cache (one payload per route).
export function createTTLCache<T>(ttlMs: number): TTLCache<T> {
  let entry: { data: T; ts: number } | null = null;
  return {
    get: () => (entry && Date.now() - entry.ts < ttlMs ? entry.data : null),
    set: (data: T) => { entry = { data, ts: Date.now() }; },
    invalidate: () => { entry = null; },
  };
}

export interface KeyedTTLCache<T> {
  get(key: string): T | null;
  set(key: string, data: T): void;
  // Drop one key, or all keys when called with no argument.
  invalidate(key?: string): void;
}

// Per-key cache with an insertion-order size cap (oldest evicted past the cap).
// Replaces the per-query Map caches (e.g. custom-cards/query).
export function createKeyedTTLCache<T>(ttlMs: number, maxEntries = 100): KeyedTTLCache<T> {
  const map = new Map<string, { data: T; ts: number }>();
  return {
    get(key) {
      const e = map.get(key);
      if (e && Date.now() - e.ts < ttlMs) return e.data;
      if (e) map.delete(key); // stale — drop so size stays bounded
      return null;
    },
    set(key, data) {
      map.set(key, { data, ts: Date.now() });
      if (map.size > maxEntries) {
        const oldest = map.keys().next().value; // Map preserves insertion order
        if (oldest !== undefined) map.delete(oldest);
      }
    },
    invalidate(key) {
      if (key === undefined) map.clear();
      else map.delete(key);
    },
  };
}
