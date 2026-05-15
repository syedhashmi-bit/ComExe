// ── Historical metric persistence ───────────────────────────────────────────
// Append-only JSONL ring buffer at data/history.jsonl. Rotated at MAX_SIZE_MB
// or MAX_AGE_DAYS, whichever comes first. Exposed via /api/history.
//
// Each line is a JSON object with { ts, cpu, mem, net_rx, net_tx, gpu, disk_pct }.
// Kept intentionally slim — one line per poll cycle (~every 3s), so 7 days of
// 3s polls ≈ 200k lines ≈ ~30MB uncompressed.
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR      = path.join(process.cwd(), "data");
const HISTORY_PATH  = path.join(DATA_DIR, "history.jsonl");
const MAX_SIZE_MB   = 50;
const MAX_AGE_DAYS  = 7;

export interface HistoryPoint {
  ts:       number;   // epoch ms
  cpu:      number | null;
  mem:      number | null;   // used %
  net_rx:   number | null;   // bytes/sec
  net_tx:   number | null;   // bytes/sec
  gpu:      number | null;   // utilization %
  disk_pct: number | null;   // worst mount %
}

// Append a single data point. Creates the file + dir on first write.
export async function appendHistory(point: HistoryPoint): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const line = JSON.stringify(point) + "\n";
    await fs.appendFile(HISTORY_PATH, line, "utf8");
  } catch {
    // Non-fatal — history is best-effort
  }
}

// Read history, optionally filtered by metric and time range.
export async function readHistory(opts?: {
  metric?: keyof Omit<HistoryPoint, "ts">;
  rangeMs?: number;   // only points within this many ms from now
  limit?: number;     // max points to return (tail)
}): Promise<HistoryPoint[]> {
  let raw: string;
  try {
    raw = await fs.readFile(HISTORY_PATH, "utf8");
  } catch {
    return [];
  }

  const cutoff = opts?.rangeMs ? Date.now() - opts.rangeMs : 0;
  const lines = raw.trim().split("\n");
  const points: HistoryPoint[] = [];

  for (const line of lines) {
    if (!line) continue;
    try {
      const p = JSON.parse(line) as HistoryPoint;
      if (p.ts >= cutoff) points.push(p);
    } catch { /* skip corrupt lines */ }
  }

  if (opts?.limit && points.length > opts.limit) {
    return points.slice(-opts.limit);
  }
  return points;
}

// Downsample points for charting — average into buckets of `bucketMs` width.
export function downsample(points: HistoryPoint[], bucketMs: number): HistoryPoint[] {
  if (points.length === 0 || bucketMs <= 0) return points;

  const result: HistoryPoint[] = [];
  let bucketStart = points[0].ts;
  let bucket: HistoryPoint[] = [];

  for (const p of points) {
    if (p.ts - bucketStart >= bucketMs && bucket.length > 0) {
      result.push(avgBucket(bucket));
      bucket = [];
      bucketStart = p.ts;
    }
    bucket.push(p);
  }
  if (bucket.length > 0) result.push(avgBucket(bucket));
  return result;
}

function avgBucket(bucket: HistoryPoint[]): HistoryPoint {
  const n = bucket.length;
  const avg = (key: keyof Omit<HistoryPoint, "ts">): number | null => {
    const vals = bucket.map(b => b[key]).filter((v): v is number => v !== null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    ts:       Math.round(bucket.reduce((s, b) => s + b.ts, 0) / n),
    cpu:      avg("cpu"),
    mem:      avg("mem"),
    net_rx:   avg("net_rx"),
    net_tx:   avg("net_tx"),
    gpu:      avg("gpu"),
    disk_pct: avg("disk_pct"),
  };
}

// Rotate: delete lines older than MAX_AGE_DAYS or truncate if > MAX_SIZE_MB.
export async function rotateHistory(): Promise<void> {
  try {
    const stat = await fs.stat(HISTORY_PATH);
    const sizeMB = stat.size / (1024 * 1024);
    if (sizeMB < MAX_SIZE_MB * 0.8) return; // only rotate near the limit

    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    const raw = await fs.readFile(HISTORY_PATH, "utf8");
    const lines = raw.trim().split("\n");
    const kept: string[] = [];

    for (const line of lines) {
      try {
        const p = JSON.parse(line) as { ts: number };
        if (p.ts >= cutoff) kept.push(line);
      } catch { /* drop corrupt */ }
    }

    await fs.writeFile(HISTORY_PATH, kept.join("\n") + "\n", "utf8");
  } catch {
    // Non-fatal
  }
}
