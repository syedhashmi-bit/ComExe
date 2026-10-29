// ── Chart seeding from saved history ────────────────────────────────────────
// The dashboard's sparklines are in-memory buffers, so every reload used to
// start them empty ("collecting data…" for the next few minutes). The server
// already keeps a point every 10–30 s in history.jsonl; this turns the recent
// stretch of it into those buffers. Pure, client-safe.
//
// Memory is deliberately not seeded: history.jsonl stores total − available,
// while the card charts total − available − SReclaimable (the ZFS-aware
// figure), so a seeded line would jump when the first live sample arrived.

export interface SavedPoint {
  ts:     number;
  cpu:    number | null;
  gpu:    number | null;
  net_rx: number | null;
  net_tx: number | null;
}

export interface ChartSeed {
  cpu:   number[];
  gpu:   number[];
  rx:    number[];
  tx:    number[];
  times: number[];   // one per rx/tx sample
}

// `before`: ignore points at or after this time — the live feed covers them,
// and a point from the same fetch would otherwise appear twice. `max`: keep the
// newest this many.
export function seedFromHistory(points: SavedPoint[], before: number, max: number): ChartSeed {
  const recent = points.filter(p => p.ts < before).slice(-max);
  const net = recent.filter(p => p.net_rx != null && p.net_tx != null);
  return {
    cpu:   recent.flatMap(p => (p.cpu != null ? [p.cpu] : [])),
    gpu:   recent.flatMap(p => (p.gpu != null ? [p.gpu] : [])),
    rx:    net.map(p => p.net_rx!),
    tx:    net.map(p => p.net_tx!),
    times: net.map(p => p.ts),
  };
}
