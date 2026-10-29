// ── Storage insight: fill-up forecast, pool state, ZFS cache ────────────────
// The logic behind /api/storage. Unlike the per-refresh metrics it runs a
// 7-day deriv() subquery and a 30-day range query, and the answers change over
// days, not seconds — so it's cached for 10 minutes and the Filesystems card
// fetches it on its own slow timer instead of riding the 10s metrics stream.
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { promScalar, promVector, promRange, resolveNamed } from "@/app/lib/prometheus";
import { createTTLCache } from "@/app/lib/cache";
import { loadConfig, type ResolvedConfig } from "@/app/lib/server-config";
import { getMetrics, peekMetrics, type MetricsPayload } from "@/app/lib/metrics";
import type { StorageInsight } from "@/app/lib/types";

const DAY = 86_400_000;
const FS_EXCLUDE = `fstype!~"tmpfs|devtmpfs|overlay|squashfs|ramfs"`;

// The disk warning threshold (diskAlertLevel in lib/alerts.ts).
export const WARN_PCT = 85;

// Below this the pool is treated as flat: logs and snapshot churn move a pool
// by tens of MB a day, which would otherwise forecast "full in 300 years".
const MIN_GROWTH_PER_DAY = 100e6;

// Days until `pct` of the pool is used at a constant growth rate. 0 when it
// already is; null when the pool isn't meaningfully growing.
export function daysUntil(usedBytes: number, totalBytes: number, growthPerDay: number | null, pct: number): number | null {
  if (!(totalBytes > 0)) return null;
  const target = (totalBytes * pct) / 100;
  if (usedBytes >= target) return 0;
  if (growthPerDay == null || growthPerDay < MIN_GROWTH_PER_DAY) return null;
  return (target - usedBytes) / growthPerDay;
}

// A path as an anchored PromQL regex matching it and everything below it.
// Regex-escaped, then escaped again for the double-quoted PromQL string.
export function subtreeRegex(p: string): string {
  const re = p.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `${re}(/.*)?`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Usually already fetched by the stream or the collector; fetch only if not.
async function currentMetrics(): Promise<MetricsPayload | null> {
  return peekMetrics() ?? getMetrics().catch(() => null);
}

const cache = createTTLCache<StorageInsight>(10 * 60_000);
let inflight: Promise<StorageInsight> | null = null;

export async function getStorageInsight(): Promise<StorageInsight> {
  const cached = cache.get();
  if (cached) return cached;
  if (!inflight) {
    inflight = loadConfig()
      .then(fetchStorageInsight)
      .then((v) => { cache.set(v); return v; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

async function fetchStorageInsight(cfg: ResolvedConfig): Promise<StorageInsight> {
  const base = cfg.prometheusUrl;
  const now = Date.now();
  // Every dataset in a ZFS pool reports the pool's shared free space as its
  // "available", so the max over the pool's mounts is the pool's free space
  // whether or not the root dataset itself is exported.
  const poolAvail = `max(node_filesystem_avail_bytes{mountpoint=~"${subtreeRegex(cfg.poolPath)}"})`;

  const r = await resolveNamed({
    poolGrowth:    promScalar(base, `-deriv(${poolAvail}[7d:1h])`),
    datasetGrowth: promVector(base, `deriv((node_filesystem_size_bytes{${FS_EXCLUDE}} - node_filesystem_avail_bytes{${FS_EXCLUDE}})[7d:1h])`),
    availHistory:  promRange(base, poolAvail, now - 30 * DAY, now, 6 * 3600),
    zpoolStates:   promVector(base, `node_zfs_zpool_state == 1`),
    arcHits:       promScalar(base, `rate(node_zfs_arc_hits[1h])`),
    arcMisses:     promScalar(base, `rate(node_zfs_arc_misses[1h])`),
    arcSize:       promScalar(base, `node_zfs_arc_size`),
    // Pool size and current usage, computed the same way as the card's headline.
    metrics:       currentMetrics(),
  });

  const poolUsed  = r.metrics?.pool?.used  ?? null;
  const poolTotal = r.metrics?.pool?.total ?? null;
  const poolPct = poolUsed != null && poolTotal ? (poolUsed / poolTotal) * 100 : null;

  const growthPerDay = r.poolGrowth != null && isFinite(r.poolGrowth) ? r.poolGrowth * 86_400 : null;

  const history = poolTotal
    ? (r.availHistory[0]?.values ?? []).map((p) => ({
        ts: p.ts,
        pct: Math.round(Math.min(100, Math.max(0, ((poolTotal - p.value) / poolTotal) * 100)) * 10) / 10,
      }))
    : [];

  const datasets = r.datasetGrowth
    .filter((d) => d.metric.mountpoint?.startsWith(cfg.fsPathPrefix) && isFinite(d.value))
    .map((d) => ({ mountpoint: d.metric.mountpoint, growthPerDay: d.value * 86_400 }))
    .sort((a, b) => b.growthPerDay - a.growthPerDay);

  // node_zfs_zpool_state is one series per (zpool, state) with value 1 for the
  // current state. Prefer the pool POOL_PATH points at.
  const poolName = cfg.poolPath.replace(/\/+$/, "").split("/").pop() ?? "";
  const stateSeries = r.zpoolStates.find((s) => s.metric.zpool === poolName)
    ?? (r.zpoolStates.length === 1 ? r.zpoolStates[0] : undefined);

  const arcTotal = (r.arcHits ?? 0) + (r.arcMisses ?? 0);

  return {
    poolPct,
    growthPerDay,
    daysToWarn: poolUsed != null && poolTotal ? daysUntil(poolUsed, poolTotal, growthPerDay, WARN_PCT) : null,
    daysToFull: poolUsed != null && poolTotal ? daysUntil(poolUsed, poolTotal, growthPerDay, 100) : null,
    history,
    datasets,
    poolState: stateSeries?.metric.state ?? null,
    arcHitPct: r.arcHits != null && arcTotal > 0 ? (r.arcHits / arcTotal) * 100 : null,
    arcSizeBytes: r.arcSize,
    timestamp: now,
  };
}
