// Default order of the metric grid cards. Settings.cardOrder overrides this
// per-browser via localStorage. Adding a new card here keeps backward compat
// because page.tsx merges saved order + DEFAULT_CARD_ORDER (saved first, then
// any new keys appended).

export const DEFAULT_CARD_ORDER = [
  "cpu", "memory", "filesystems",
  "network", "gpu", "speedtest",
  "system", "grafana",
] as const;

export type CardKey = (typeof DEFAULT_CARD_ORDER)[number];

const STORAGE_KEY = "comexe:card-order";

// Load saved order, merging in any new keys from DEFAULT_CARD_ORDER that
// aren't yet persisted (so adding a card doesn't strand it off the grid).
export function loadCardOrder(): string[] {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const seen = new Set(parsed.filter((x: unknown) => typeof x === "string"));
        const result = parsed.filter((x: unknown) => typeof x === "string") as string[];
        for (const k of DEFAULT_CARD_ORDER) {
          if (!seen.has(k)) result.push(k);
        }
        return result;
      }
    }
  } catch { /* fall through */ }
  return [...DEFAULT_CARD_ORDER];
}

export function saveCardOrder(order: string[]): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); } catch { /* swallow */ }
}

export function resetCardOrder(): string[] {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* swallow */ }
  return [...DEFAULT_CARD_ORDER];
}

// Move `key` to the position currently occupied by `targetKey`. Returns a new
// array; original is unchanged. If either key is missing, returns input.
export function reorder(order: string[], key: string, targetKey: string): string[] {
  if (key === targetKey) return order;
  const from = order.indexOf(key);
  const to   = order.indexOf(targetKey);
  if (from < 0 || to < 0) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}
